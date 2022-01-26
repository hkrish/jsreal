import { ConvolutionDouble } from "./convolution-double";
import { CONVOLUTION_THRESHOLD } from "./defs";

//! import './macros/debug.jsmacro';
//! import './macros/jsreal.jsmacro';


// FIX:
// TODO: Find a better threshold for using convolution method.
// IDEA: Try compiling C++ to webassembly and see how it deals with bitwise ops

const pi2 = (2 * 3.14159265358979323846264338327950288419);

let kernel_initialized = false;
let kernel_precision = 0;
let convbufa: Maybe<number[]>;
let convbufb: Maybe<number[]>;
let conv: Maybe<ConvolutionDouble>;


// ----- Helper functions on mantissas -----


// ! kernels_initialize must be called before calling any of the arithmetic functions. !
export function kernels_initialize (prec: number): void {
    kernel_precision = prec;
    if (prec >= CONVOLUTION_THRESHOLD) {
        let prec2pow;
        // convolution will take 16 bits for a double. `size' should be at least twice the
        // number of 16-bit words
        for (prec2pow = 16; prec2pow < prec * 4; prec2pow <<= 1) { }
        convbufa = new Array(prec2pow);
        convbufb = new Array(prec2pow);
        conv = new ConvolutionDouble(prec2pow, pi2);
    }
    kernel_initialized = true;
}


export function kernels_finalize (): void {
    kernel_initialized = false;
    convbufa = undefined;
    convbufb = undefined;
    conv = undefined;
    kernel_precision = 0;
}


// mantissa_normalize: Subtraction can introduce zeroes in most significant positions of
// the mantissa. This function corrects such mantissas and returns the value that has to
// be subtracted from the exponent. If this value is equal to working precision, the
// subtraction function must recognize the value as Zero.
export function mantissa_normalize (man: Mantissa): number {
    let kprec = kernel_precision;
    let prec = kprec - 1;
    if (man[prec] !== 0) {
        return 0;
    }
    // find the first non-zero word
    while (--prec >= 0 && man[prec] === 0) { }
    // calculate needed offset
    prec = kprec - (prec + 1);
    // do we have something to save?
    if (prec !== kprec) {
        let u;
        for (u = kprec - 1; u >= prec; --u) {
            man[u] = man[u - prec];
        }
        for (; u >= 0; --u) {
            man[u] = 0;
        }
    }
    return prec;
}


// ----- FIX: DELETE {{{  -----
export const lo32 = (v64: number) => $_lo32(v64);

export const hi32 = (v64: number) => $_hi32(v64);

export const lsh = (a: number, n: number) => $_lsh(a, n);

export const rsh = (a: number, n: number) => $_rsh(a, n);
// ----- FIX: }}} DELETE  -----


// mantissa_add: Perform the actual addition.
// - Arguments:
//   - man   : Mantissa :: Destination, pre-initialized by a call to the default constructor
//   - full  : Mantissa :: The greater value
//   - part  : Mantissa :: The partial value...
//   - start : number   :: ...shifted by this many words
// - Returns:
//   - boolean  :: `true' if we have carry or not.
export function mantissa_add (man: Mantissa, full: Mantissa, part: Mantissa
    , start: number): boolean {
    //--
    let carry = 0;
    let kprec = kernel_precision;
    // start with carry if highest bit in what's left out is 1
    if (start !== 0 && start <= kprec) {
        carry = (part[start - 1] >= $_lsh(1, 31)) ? 1 : 0;
    }
    // add words
    let u;
    for (u = 0; u < kprec - start; ++u) {
        let v = full[u] + part[u + start] + carry;
        man[u] = $_lo32(v);     // u32(v & 0xFFFFFFFF)
        carry = $_hi32(v);      // u32(v >> 32);
    }
    // update for carry
    for (; carry && u < kprec; ++u) {
        man[u] = full[u] + carry;
        carry = (man[u] === 0) ? 1 : 0;
    }
    // just copy
    for (; u < kprec; ++u) {
        man[u] = full[u];
    }
    return !!carry;
}


// adjust_for_carry: Adjust for calculations that don't fit the preallocated space.
// an extra pass might be needed if the leftover word introduces more carry.
// - Arguments:
//   - man : Mantissa :: the mantissa
//   - msw : number   :: most significant word, the one that doesn't fit in
// - Returns:
//   - number :: number of shifts done
export function adjust_for_carry (man: Mantissa, msw: number): number {
    let kprec = kernel_precision;
    // round what's left over
    let carry = (man[0] >= $_lsh(1, 31));
    let u;
    // shift
    for (u = 1; u < kprec && carry; ++u) {
        man[u - 1] = man[u] + 1;
        carry = man[u - 1] === 0;
    }
    for (; u < kprec; ++u) {
        man[u - 1] = man[u];
    }
    // put new value
    man[u - 1] = msw + (carry ? 1 : 0);
    // reiterate if necessary
    if (man[u - 1] === 0) {
        return 1 + adjust_for_carry(man, 1);
    } else {
        return 1;
    }
}


// mantissa_sub: Perform the actual subtraction.
// - Arguments:
//   - man   : Mantissa :: Destination, pre-initialized by a call to the default constructor
//   - full  : Mantissa :: The greater value
//   - part  : Mantissa :: The partial value...
//   - start : number   :: ...shifted by this many words
// - Returns:
//   - boolean :: `true' if part was greater and the result must be negated
export function mantissa_sub (man: Mantissa, full: Mantissa, part: Mantissa
    , start: number): boolean {
    //--
    let kprec = kernel_precision;
    let carry = 0;
    // start with carry if highest bit in what's left out is 1
    if (start !== 0 && start <= kprec) {
        carry = (part[start - 1] >= $_lsh(1, 31)) ? 1 : 0;
    }
    // subtract words
    let u;
    for (u = 0; u < kprec - start; ++u) {
        let v = full[u] - part[u + start] - carry;
        man[u] = $_lo32(v);                // u32(v & 0xFFFFFFFF)
        carry = ($_hi32(v) !== 0) ? 1 : 0; // u32(v >> 32) !== 0
    }
    // update for carry
    for (; carry && u < kprec; ++u) {
        man[u] = full[u] - carry;
        carry = (man[u] === 0xffffffff) ? 1 : 0; // man[u] == u32(-1)
    }
    // just copy
    for (; u < kprec; ++u) {
        man[u] = full[u];
    }
    return !!carry;
}


// mantissa_neg: negate a mantissa. needed if SubMantissa returned true.
export function mantissa_neg (man: Mantissa): void {
    let prec = kernel_precision;
    let u;
    for (u = 0; u < prec && man[u] === 0; ++u) { }
    $_dassert(u < prec, 'u is greater than precision');
    man[u] = -man[u];
    for (++u; u < prec; ++u) {
        man[u] = ~man[u];
    }
}


// mantissa_mul_direct: Perform actual multiplication
//
// NOTE: !! Don't use this method. This function doesn't use convolution. `mantissa_mul'
//          is recommended for better performance.
//
// the most significant word of the result is not put in man. instead it is returned, so
// no precision will be lost if it is zero.
export function mantissa_mul_direct (man: Mantissa, a: Mantissa, b: Mantissa, inputstart: number
    , inputlen: number): number {
    //--
    let kprec = kernel_precision;
    let carry = 0;
    let u, w = 0;
    let i = kprec - (inputlen * 2) + 1;
    let j;
    let k = 0;
    // start by only calculating carry
    for (; i < 0 && k < inputlen; ++i, ++k) {
        w = $_lo32(w);
        w += $_lsh(carry, 32);
        carry = 0;
        for (j = 0; j <= k; ++j) {
            u = a[j + inputstart] * b[k - j + inputstart];
            w += u;
            if (w < u) {
                // TODO: Test this. I don't think if would work in JS
                // this is a trick to check for carry in u64s
                ++carry;
            }
        }
    }
    // alternatively
    for (j = 0; j < i; ++j) {
        man[j] = 0;
    }
    $_dassert(i >= 0, '');
    // we didn't write till now.
    // besides carry, we should add 1 if the previous value had 1 in MS bit
    if (w & 0x80000000) {
        w += $_lsh(1, 32);
    }
    // start writing
    for (; k < inputlen; ++i, ++k) {
        w = $_lo32(w);
        w += $_lsh(carry, 32);
        carry = 0;
        for (j = 0; j <= k; ++j) {
            u = a[j + inputstart] * b[k - j + inputstart];
            w += u;
            if (w < u) {
                ++carry;
            }
        }
        man[i] = $_lo32(w);
    }
    for (; i < kprec; ++i, ++k) {
        w = $_lo32(w);
        w += $_lsh(carry, 32);
        carry = 0;
        for (j = k - inputlen + 1; j < inputlen; ++j) {
            u = a[j + inputstart] * b[k - j + inputstart];
            w += u;
            if (w < u) {
                ++carry;
            }
        }
        man[i] = $_lo32(w);
    }
    $_dassert(!carry, 'carry should be 0');
    // leave the last word as return value
    return $_lo32(w);
}


// mantissa_mul: Perform actual multiplication using convolution
//
// the most significant word of the result is not put in man. instead it is returned, so
// no precision will be lost if it is zero.
export function mantissa_mul (man: Mantissa, a: Mantissa, b: Mantissa
    , inputstart: number, inputlen: number): number {
    //--
    $_dassert(kernel_initialized, "Must call `kernels_initialize'")
    let bufa: number[] = convbufa!;
    let bufb: number[] = convbufb!;
    // do it directly if it would be faster
    if (inputlen < CONVOLUTION_THRESHOLD) {
        return mantissa_mul_direct(man, a, b, inputstart, inputlen);
    }
    let i;
    let prec = inputlen;
    let prec2pow = 16;
    if (inputlen === kernel_precision) {
        prec2pow = conv!.size;
    } else {
        while (prec2pow < prec * 4) {
            prec2pow *= 2;
        }
    }
    // initialize buffers to input
    for (i = 0; i < inputlen; ++i) {
        bufa[i * 2] = a[i + inputstart] & 0xFFFF;
        bufa[i * 2 + 1] = (a[i + inputstart] >>> 16) & 0xFFFF;
    }
    i = i * 2 - 1;
    while (++i < prec2pow) {
        bufa[i] = 0;
    }
    for (i = 0; i < inputlen; ++i) {
        bufb[i * 2] = b[i + inputstart] & 0xFFFF;
        bufb[i * 2 + 1] = (b[i + inputstart] >>> 16) & 0xFFFF;
    }
    i = i * 2 - 1;
    while (++i < prec2pow) {
        bufb[i] = 0;
    }
    // convolve
    conv!.convolve(bufa, bufb, prec2pow);
    // make each value 16-bit
    let carry = 0, t;
    for (i = 0; i < inputlen - 1 - inputstart; ++i) {
        t = Math.floor(bufa[i] + carry + 0.5); // round it too
        carry = Math.floor($_ldexp(t, -16));
        bufa[i] = t - $_ldexp(carry, 16);
    }
    // from here on we start writing, one in MSB of previous word is carry
    if (bufa[i - 1] > (1 << 15)) {
        carry += 1;
    }
    for (; i < (prec + inputlen) * 2; ++i) {
        t = Math.floor(bufa[i] + carry + 0.5); // round it too
        carry = Math.floor($_ldexp(t, -16));
        bufa[i] = t - $_ldexp(carry, 16);
    }
    for (i = 0; i <= inputstart - inputlen; ++i) {
        man[i] = 0;
    }
    // write the result
    for (i = Math.max(0, inputlen - 1 - inputstart); i < prec + inputlen - 1; ++i) {
        man[i - inputlen + 1 + inputstart] =
            bufa[i * 2] + $_lo32(bufa[i * 2 + 1] << 16);
    }
    // leave the last word out
    return bufa[i * 2] + $_lo32(bufa[i * 2 + 1] << 16);
}


export function multiplied_by_convolution (inputlen: number): boolean {
    return (inputlen >= CONVOLUTION_THRESHOLD);
}


// sub_man_bscaled: Auxilliary function to help division.
// - Arguments:
//   - amsw (output) :: The most significant word of a.
//   - aofs :: How many words a is shifted, with the msw's taken as 0, the first
//             substituted by the amsw
//   - res (output) :: the result is shifted aofs words
//   - bscale :: assumed positive, < 32
// - Returns:
//   - boolean :: `false' is a was < b, possibly breaking with an incomplete res.
function sub_man_bscaled (res: Mantissa, a: Mantissa, b: Mantissa, amsw: Uint32Array
    , bscale: number, inputlen: number, inputstart: number, aofs: number): boolean {
    //--
    let carry = 0;
    let u, v;
    let s = $_combinewords(0, (b[inputstart]), bscale);
    for (u = inputstart; u < inputstart + aofs; ++u) {
        v = -s - carry;
        res[u] = $_lo32(v);
        carry = ($_hi32(v) !== 0) ? 1 : 0;
        s = $_combinewords(b[u], b[u + 1], bscale);
    }
    // subtract words
    for (u = 0; u < inputlen - 1; ++u) {
        v = a[u - aofs + inputstart] - s - carry;
        res[u + inputstart] = $_lo32(v);
        carry = ($_hi32(v) !== 0) ? 1 : 0;
        s = $_combinewords(b[inputstart + u], b[inputstart + u + 1], bscale);
    }
    {
        v = a[u - aofs + inputstart] - s - carry;
        res[u + inputstart] = $_lo32(v);
        carry = ($_hi32(v) !== 0) ? 1 : 0;
        s = $_combinewords(b[inputstart + u], 0, bscale);
    }
    v = amsw[0] - s - carry;
    carry = ($_hi32(v) !== 0) ? 1 : 0;
    if (carry) {
        return false;
    } else {
        amsw[0] = v;
        return true;
    }
}


export function mantissa_div (man: Mantissa, a: Mantissa, b: Mantissa, inputstart: number
    , inputlen: number, temp1: Mantissa, temp2: Mantissa): number {
    //--
    let kprec = kernel_precision;
    let buf = new ArrayBuffer(2);
    let r = new Uint32Array(buf, 0, 1);
    let amsw = new Uint32Array(buf, 4, 1);
    let sc;
    let e = 1;
    let j = inputstart + inputlen - 1;
    let ofs = 0;
    man.fill(0, 0, inputstart);
    for (sc = 31; sc >= 0; --sc) {
        if (sub_man_bscaled(temp1, a, b, amsw, sc, inputlen, inputstart, 0)) {
            break;
        }
    }
    if (sc < 0) {
        e = 0;
        amsw[0] = a[inputlen - 1 + inputstart];
        for (sc = 31; sc >= 0; --sc) {
            if (sub_man_bscaled(temp1, a, b, amsw, sc, inputlen, inputstart, 1)) {
                break;
            }
        }
        $_dassert(sc >= 0, '');
    }
    r[0] |= 1 << sc;
    while (j >= inputstart) {
        while (--sc >= 0) {
            if (sub_man_bscaled(temp2, temp1, b, amsw, sc, inputlen, inputstart, 0)) {
                r[0] |= 1 << sc;
                $_swap(temp1, temp2);
            }
        }
        ofs = 0;
        while (sc < 0 && j >= inputstart) {
            ++ofs;
            sc = 32;
            man[j--] = r[0];
            if (j < inputstart) {
                break;
            }
            amsw[0] = temp1[inputlen - ofs + inputstart];
            r[0] = 0;
            for (sc = 31; sc >= 0; --sc) {
                if (sub_man_bscaled(temp2, temp1, b, amsw, sc, inputlen, inputstart, ofs)) {
                    r[0] |= 1 << sc;
                    $_swap(temp1, temp2);
                    break;
                }
            }
        }
    }
    // check if we need to round up
    if (sub_man_bscaled(temp2, temp1, b, amsw, 31, inputlen, inputstart, ofs)) {
        while (++j < kprec && ++man[j] === 0) { }
        if (j === kprec) {       // carry on msw means we have 1(0)
            ++e;
            man[j - 1] = 1;
        }
    }
    return e;
}


// mantissa_scale: multiplication by u32 multiplier
// - implemented for performance
export function mantissa_scale (man: Mantissa, src: Mantissa, multiplier: number): number {
    let kprec = kernel_precision;
    let v = 0;
    for (let i = 0; i < kprec; ++i) {
        v += src[i] * multiplier;
        man[i] = $_lo32(v);
        v = $_hi32(v);
    }
    return $_lo32(v);
}


export function InvScaleMantissa (man: Mantissa, src: Mantissa, divisor: number): number {
    let kprec = kernel_precision;
    let i = kprec - 1;
    let j = i;
    let e = 0;
    let v = src[i];
    if (v < divisor) {
        v = $_lsh(v, 32) + src[--i];
        e = -1;
    }
    while (i > 0) {
        man[j--] = $_lo32(v / divisor);
        v = $_lsh((v % divisor), 32) + src[--i];
    }
    man[j--] = $_lo32(v / divisor);
    if (j === 0) {               // this would happen if msw in src was < divisor
        v = $_lsh((v % divisor), 32);
        man[j--] = $_lo32(v / divisor);
    }
    // round the result; j is -1
    if ((v % divisor) > divisor / 2) {
        while (++j < kprec && ++man[j] === 0) { }
        if (j === kprec) {      // carry on msw means we have 1(0)
            ++e;
            man[j - 1] = 1;
        }
    }
    return e;
}


// binary scale mantissa, i.e. multiply by 1<<scale, where scale < 32
export function mantissa_bscale (man: Mantissa, src: Mantissa, scale: number): number {
    let kprec = kernel_precision;
    let v = 0;
    for (let i = 0; i < kprec; ++i) {
        man[i] = (src[i] << scale) | v;
        v = src[i] >> (32 - scale);
    }
    return $_lo32(v);
}
