import { ExnType } from "./defs";
import { current_kernel, IKernel } from "./kernels/kernel";

// Import some macros
//! import './macros/debug.jsmacro';
//! import './macros/jsreal.jsmacro';


// LongFloat - arbitrary precision floating point value.
//   Consists of a 32-bit exponent, long mantissa, sign and special flag. Special values
//   are Zero, Infinity and Nan. The exponent is in words, and the most significant word
//   is never zero.
//
//   The mantissa is little endian, i.e. mts[0] is the least significant
//   word. (sign * SUM(mts[i] * 2 ** (32 * (exp - working_precision + i))))


export enum LFSpecial {
    Normal = 0,
    Zero,
    Infinity,
    Nan
};

export type Sign = -1 | 1;


export class LongFloat {
    // Current working precision
    private static _working_precision = 3;
    private static kernel: IKernel;
    private static kfns: WKernel;

    private sign: Sign;
    // !== LFSpecial.Normal only in special values
    private special: LFSpecial;
    // Needed precision. this is the point at which multiplication and division will stop
    private _precision: number;
    // Exponent, power of 2**32
    private exp: Int32Array;
    // Mantissa
    private mts: Mantissa;
    private _buffer: ArrayBuffer;

    // Default constructor: For private use mainly. Use one of the static constructors.
    constructor(exp: Int32Array, mts: Mantissa, sign: Sign, special: LFSpecial
        , precision: number = LongFloat._working_precision) {
        //--
        $_dassert(exp.buffer === mts.buffer,
            "Exponent, and mantissa have different ArrayBuffer.");
        this.exp = exp;
        this.mts = mts;
        this._buffer = exp.buffer;
        this.sign = <Sign>(sign | 0);
        this.special = special;
        this._precision = precision;
    }

    // Precision argument is the working precision and it must be >= 3
    static initialize (precision?: number) {
        LongFloat.kernel = current_kernel();
        LongFloat.kfns = LongFloat.kernel.internal;
        precision = ((precision == null || precision < 3) ? 3 : precision);
        LongFloat._working_precision = precision | 0;
        LongFloat.kernel.initialize(LongFloat._working_precision);
    }

    static get working_precision (): number {
        return this._working_precision | 0;
    }

    static set working_precision (val: number) {
        this._working_precision = val | 0;
    }

    static alloc (): ArrayBuffer {
        return new ArrayBuffer(4 * (this._working_precision + 1));
    }

    get precision (): number {
        return this._precision;
    }

    set precision (val: number) {
        val = val | 0;
        this._precision = ((val < LongFloat._working_precision)
            ? val
            : LongFloat._working_precision);
    }

    clone (): LongFloat {
        const buf = this._buffer.slice(0);
        const iv = new Int32Array(buf, 0, 1);
        const uv = new Uint32Array(buf, 4);
        return new LongFloat(iv, uv, this.sign, this.special, this._precision);
    }

    copy_from (rhs: LongFloat): this {
        this.sign = rhs.sign;
        this.special = rhs.special;
        this._precision = rhs._precision;
        const buf = rhs._buffer.slice(0);
        this._buffer = buf;
        this.exp = new Int32Array(buf, 0, 1);
        this.mts = new Uint32Array(buf, 4);
        return this;
    }

    is_negative (): boolean {
        return this.sign < 0;
    }

    is_zero (): boolean {
        return this.special === LFSpecial.Zero;
    }

    is_finite (): boolean {
        return this.special === LFSpecial.Normal;
    }

    is_infinite (): boolean {
        return this.special === LFSpecial.Infinity;
    }

    is_nan (): boolean {
        return this.special === LFSpecial.Nan;
    }

    get kind (): LFSpecial {
        return this.special;
    }

    get exponent (): number {
        return this.exp[0];
    }


    // ----- Arithmetic -----

    static mantissa_args (n = 1, bidx?: number): number[] {
        const K = LongFloat.kernel;
        let prec = LongFloat._working_precision * 4;
        bidx = bidx == null ? K.layout.offset_arg : bidx;
        let args: number[] = [bidx];
        for (let i = 1; i < n; ++i) {
            args.push(bidx + i * prec);
        }
        return args;
    }

    static clear_mantissa_args (n = 1, bidx?: number): number[] {
        const K = LongFloat.kernel;
        let mem_u32 = K.mem_u32;
        let prec = LongFloat._working_precision;
        bidx = bidx == null ? K.layout.offset_arg : bidx;
        let idx = bidx / 4;
        let nx = n * prec;
        mem_u32.fill(0, idx, idx + nx);
        prec *= 4;
        let args: number[] = [bidx];
        for (let i = 1; i < n; ++i) {
            args.push(bidx + i * prec);
        }
        return args;
    }

    convert_to_special_self (special: LFSpecial, sign: Sign): this {
        this.exp[0] = 0;
        this.mts.fill(0);
        this.special = special;
        this.sign = sign;
        return this;
    }

    neg_self (): this {
        this.sign = <Sign>(-1 * this.sign);
        return this;
    }

    neg (): LongFloat {
        return this.clone().neg_self();
    }

    add_self (rhs: LongFloat): this {
        if (this.sign !== rhs.sign) {
            return this.sub_self(rhs.neg());
        }
        switch (this.special) {
            case LFSpecial.Zero:
                return this.copy_from(rhs);
            case LFSpecial.Nan:
                return this;
            case LFSpecial.Infinity:
                switch (rhs.special) {
                    case LFSpecial.Nan:
                        return this.copy_from(rhs);
                    case LFSpecial.Zero:
                    case LFSpecial.Normal:
                    case LFSpecial.Infinity:
                        return this;
                }
            case LFSpecial.Normal:
                switch (rhs.special) {
                    case LFSpecial.Nan:
                    case LFSpecial.Infinity:
                        return this.copy_from(rhs);
                    case LFSpecial.Zero:
                        return this;
                    case LFSpecial.Normal:
                        //  Normal + Normal: add mantissas and adjust for carry
                        let expthis = this.exp[0];
                        let exprhs = rhs.exp[0];
                        let exp = Math.max(expthis, exprhs);
                        const K = LongFloat.kernel;
                        const KF = K.internal;
                        const KL = K.layout;
                        const argthis = KL.offset_arg;
                        const argrhs = K.write_mantissa_arg(this.mts, argthis);
                        const argout = K.write_mantissa_arg(rhs.mts, argrhs);
                        let carry: number;
                        if (expthis === exprhs) {
                            carry = KF.mantissa_add(argout, argthis, argrhs, 0);
                        } else if (expthis > exprhs) {
                            let i32sat = exp - exprhs;
                            let start = $_i32saturated(i32sat);
                            carry = KF.mantissa_add(argout, argthis, argrhs, start);
                        } else {
                            let i32sat = exp - expthis;
                            let start = $_i32saturated(i32sat);
                            carry = KF.mantissa_add(argout, argrhs, argthis, start);
                        }
                        if (carry) {
                            exp += KF.adjust_for_carry(argout, carry);
                        }
                        this.exp[0] = exp;
                        K.read_mantissa_arg(this.mts, argout);
                        this._precision = Math.min(this._precision, rhs._precision);
                        return this;
                }
        }
    }

    add (rhs: LongFloat): LongFloat {
        return this.clone().add_self(rhs);
    }

    sub_self (rhs: LongFloat): this {
        if (this.sign !== rhs.sign) {
            return this.add_self(rhs.neg());
        }
        switch (this.special) {
            case LFSpecial.Zero:
                return this.copy_from(rhs).neg_self();
            case LFSpecial.Nan:
                return this;
            case LFSpecial.Infinity:
                switch (rhs.special) {
                    case LFSpecial.Nan:
                        return this.copy_from(rhs);
                    case LFSpecial.Zero:
                    case LFSpecial.Normal:
                        return this;
                    case LFSpecial.Infinity:
                        return this.convert_to_special_self(LFSpecial.Nan, 1);
                }
            case LFSpecial.Normal:
                switch (rhs.special) {
                    case LFSpecial.Nan:
                        return this.copy_from(rhs);
                    case LFSpecial.Infinity:
                        return this.copy_from(rhs).neg_self();
                    case LFSpecial.Zero:
                        return this;
                    case LFSpecial.Normal:
                        //  Normal - Normal: sub mantissas, negate if necessary, normalise
                        const K = LongFloat.kernel;
                        const KF = K.internal;
                        const KL = K.layout;
                        const argthis = KL.offset_arg;
                        const argrhs = K.write_mantissa_arg(this.mts, argthis);
                        const argout = K.write_mantissa_arg(rhs.mts, argrhs);
                        let expthis = this.exp[0];
                        let exprhs = rhs.exp[0];
                        let carry: number;
                        let sign: Sign = this.sign;
                        let exp: number = expthis;
                        if (expthis === exprhs) {
                            carry = KF.mantissa_sub(argout, argthis, argrhs, 0);
                        } else if (expthis > exprhs) {
                            let i32sat = expthis - exprhs;
                            let start = $_i32saturated(i32sat);
                            carry = KF.mantissa_sub(argout, argthis, argrhs, start);
                        } else {
                            let i32sat = exprhs - expthis;
                            let start = $_i32saturated(i32sat);
                            carry = KF.mantissa_sub(argout, argrhs, argthis, start);
                            exp = exprhs;
                            sign = rhs.sign > 0 ? -1 : 1;
                        }
                        if (carry) {
                            KF.mantissa_neg(argout);
                            sign = sign > 0 ? -1 : 1;
                        }
                        let corr = KF.mantissa_normalize(argout);
                        if (corr === LongFloat._working_precision) {
                            return this.convert_to_special_self(LFSpecial.Zero, 1);
                        }
                        this.exp[0] = exp - corr;
                        K.read_mantissa_arg(this.mts, argout);
                        this.sign = sign;
                        this._precision = Math.min(this._precision, rhs._precision);
                        return this;
                }
        }
    }

    sub (rhs: LongFloat): LongFloat {
        return this.clone().sub_self(rhs);
    }

    // Binary scale: lf << howmuch
    shl_self (howmuch: number) {
        // Has no effect on special values
        if (howmuch === 0 || this.special !== LFSpecial.Normal) {
            return this;
        }
        // Split to exponent offset and BScale mantissa amount
        let exp = (((howmuch >= 0) ? howmuch : (howmuch - 31)) / 32) | 0;
        howmuch -= exp * 32;
        if (howmuch === 0) {
            this.exp[0] += exp;
            return this;
        }
        const K = LongFloat.kernel;
        const KF = K.internal;
        const KL = K.layout;
        const argthis = KL.offset_arg;
        const argout = K.write_mantissa_arg(this.mts, argthis);
        let carry = KF.mantissa_bscale(argout, argthis, howmuch);
        if (carry) {
            exp += KF.adjust_for_carry(argout, carry);
        }
        this.exp[0] += exp;
        K.read_mantissa_arg(this.mts, argout);
        return this;
    }

    shl (howmuch: number): LongFloat {
        return this.clone().shl_self(howmuch);
    }

    shr_self (howmuch: number): this {
        return this.shl_self(-howmuch);
    }

    shr (howmuch: number): LongFloat {
        return this.clone().shr_self(howmuch);
    }

    mul_self (rhs: LongFloat): this {
        const sign = (this.sign === rhs.sign) ? 1 : -1;
        switch (this.special) {
            case LFSpecial.Nan:
                return this.copy_from(rhs);
            case LFSpecial.Zero:
                switch (rhs.special) {
                    case LFSpecial.Nan:
                        return this.copy_from(rhs);
                    case LFSpecial.Infinity:
                        return this.convert_to_special_self(LFSpecial.Nan, 1);
                    case LFSpecial.Normal:
                    case LFSpecial.Zero:
                        return rhs.sign < 0 ? this : this.neg_self();
                }
            case LFSpecial.Infinity:
                switch (rhs.special) {
                    case LFSpecial.Nan:
                        return this.copy_from(rhs);
                    case LFSpecial.Zero:
                        return this.convert_to_special_self(LFSpecial.Nan, 1);
                    case LFSpecial.Infinity:
                    case LFSpecial.Normal:
                        return rhs.sign < 0 ? this : this.neg_self();
                }
            case LFSpecial.Normal:
                switch (rhs.special) {
                    case LFSpecial.Nan:
                        return this.copy_from(rhs);
                    case LFSpecial.Zero:
                    case LFSpecial.Infinity:
                        return rhs.sign < 0 ? this : this.neg_self();
                    case LFSpecial.Normal:
                        // Normal * Normal: add exponents, mul mantissas, adjust for carry
                        let exp = this.exp[0] + rhs.exp[0] - 1;
                        let K = LongFloat.kernel;
                        let KF = K.internal;
                        let KL = K.layout;
                        let argthis = KL.offset_arg;
                        let argrhs = K.write_mantissa_arg(this.mts, argthis);
                        let argout = K.write_mantissa_arg(rhs.mts, argrhs);
                        let carry = KF.mantissa_mul(argout, argthis, argrhs
                            , LongFloat._working_precision - this._precision
                            , this._precision);
                        if (carry) {
                            exp += KF.adjust_for_carry(argout, carry);
                        }
                        $_dbassert(K.mem_u32[argout / 4 + (LongFloat._working_precision - 1)] !== 0);
                        this.exp[0] = $_i32saturated(exp);
                        K.read_mantissa_arg(this.mts, argout);
                        this.sign = sign;
                        this._precision = Math.min(this._precision, rhs._precision);
                        return this;
                }
        }
    }

    // Has to be a 32 bit signed integer in JavaScript
    mul_int_self (rhs: number): this {
        if (!Number.isInteger(rhs) || (rhs | 0) !== rhs) {
            throw new ExnType('mul_int_self expects a 32bit integer', 'given', rhs);
        }
        let sign = this.sign;
        if (this.special !== LFSpecial.Normal) {
            if (rhs === 0 && this.special === LFSpecial.Infinity) {
                return this.convert_to_special_self(LFSpecial.Nan, 1);
            } else {
                return this;
            }
        }
        if (rhs === 0) {
            return this.convert_to_special_self(LFSpecial.Zero, 1);
        } else if (rhs === 1) {
            return this;
        } else if (rhs === -1) {
            return this.neg_self();
        }
        if (rhs < 0) {
            rhs = -rhs;
            sign = sign > 0 ? -1 : 1;
        }
        let exp = this.exp[0];
        let K = LongFloat.kernel;
        let KF = K.internal;
        let KL = K.layout;
        let argthis = KL.offset_arg;
        let argout = K.write_mantissa_arg(this.mts, argthis);
        let carry = KF.mantissa_scale(argout, argthis, rhs);
        if (carry) {
            exp += KF.adjust_for_carry(argout, carry);
        }
        this.exp[0] = exp;
        K.read_mantissa_arg(this.mts, argout);
        this.sign = sign;
        return this;
    }

    mul (rhs: LongFloat | number): LongFloat {
        if (rhs instanceof LongFloat) {
            return this.clone().mul_self(rhs);
        } else {
            return this.clone().mul_int_self(rhs);
        }
    }

    sq_self (): this {
        return this.mul_self(this);
    }

    sq (): LongFloat {
        return this.clone().sq_self();
    }

    // Use pow(a, 2*p) == pow(a*a, p)
    pow_self (pwr: number): this {
        if (!Number.isInteger(pwr) || (pwr | 0) !== pwr) {
            throw new ExnType('pow_self expects a 32bit integer', 'given', pwr);
        }
        let sign = 1;
        if (pwr < 0) {
            pwr = -pwr;
            sign = -1;
        }
        let acc = LongFloat.from_double(1);
        while (pwr) {
            if (pwr & 1) {
                acc.mul_self(this);
            }
            pwr = pwr >>> 1;
            this.sq_self();
        }
        return this.copy_from((sign < 0) ? acc.recip_self() : acc);
    }

    pow (pwr: number): LongFloat {
        return this.clone().pow_self(pwr);
    }


    // Computes multiply-accumulate operation : this.add_self(a.mul(b))
    // TODO: This can be done faster
    fma_self (a: LongFloat, b: LongFloat): this;
    fma_self (a: LongFloat, b: number): this;
    fma_self (a: LongFloat, b: LongFloat | number): this {
        return this.add_self(a.mul(b));
    }

    fma (a: LongFloat, b: LongFloat): LongFloat;
    fma (a: LongFloat, b: number): LongFloat;
    fma (a: LongFloat, b: LongFloat | number): LongFloat {
        return this.add(a.mul(b));
    }

    add_to_exponent_self (howmuch: number): this {
        if (!Number.isInteger(howmuch) || (howmuch | 0) !== howmuch) {
            throw new ExnType('add_to_exponent_self expects a 32bit integer',
                'given', howmuch);
        }
        this.exp[0] += howmuch;
        return this;
    }

    // Has to be a 32 bit signed integer in JavaScript
    div_int_self (rhs: number): this {
        if (!Number.isInteger(rhs) || (rhs | 0) !== rhs) {
            throw new ExnType('div_int_self expects a 32bit integer', 'given', rhs);
        }
        let sign = this.sign;
        if (this.special !== LFSpecial.Normal) {
            if (rhs === 0 && this.special === LFSpecial.Infinity) {
                return this.convert_to_special_self(LFSpecial.Nan, 1);
            } else {
                return this;
            }
        }
        if (rhs === 0) {
            return this.convert_to_special_self(LFSpecial.Zero, 1);
        } else if (rhs === 1) {
            return this;
        } else if (rhs === -1) {
            return this.neg_self();
        }
        if (rhs < 0) {
            rhs = -rhs;
            sign = sign > 0 ? -1 : 1;
        }
        let K = LongFloat.kernel;
        let KF = K.internal;
        let KL = K.layout;
        let argthis = KL.offset_arg;
        let argout = K.write_mantissa_arg(this.mts, argthis);
        let exp = this.exp[0] + KF.mantissa_invscale(argout, argthis, rhs);
        this.exp[0] = exp;
        K.read_mantissa_arg(this.mts, argout);
        this.sign = sign;
        return this;
    }

    // Reciprocal
    recip_self (): this {
        switch (this.special) {
            case LFSpecial.Zero:
                return this.convert_to_special_self(LFSpecial.Infinity, this.sign);
            case LFSpecial.Infinity:
                return this.convert_to_special_self(LFSpecial.Nan, this.sign);
            case LFSpecial.Nan:
                return this;
            case LFSpecial.Normal:
                let K = LongFloat.kernel;
                let KF = K.internal;
                let il = this._precision;
                if (KF.is_multiplied_by_convolution(il)) {
                    // Newton-Raphson iterations:
                    // - separate mantissa and exponent
                    // - get the mantissa to double precision, calculate reciprocal
                    //   - this gets us >52 correct binary digits
                    // - for each iteration error = error * error * |y|,
                    //   - i.e. at least doubles the number of correct digits
                    let init = 1.0 / this.as_double();
                    // shouldn't I be using a mantissa directly ??
                    let two = LongFloat.from_32bit(2, 0);
                    let my = this.clone();
                    my.exp[0] = 0;
                    my.sign = -1;
                    let r = LongFloat.from_double(init);
                    for (let i = 52; ((i / 32) | 0) < il; i *= 2) {
                        let j = ((i + 32) / 16) | 0;
                        r.precision = j;
                        my.precision = j;
                        r.mul_self(two.fma(r, my));
                    }
                    let exp = this.exp[0];
                    this.exp = r.exp;
                    this.exp[0] -= exp;
                    this.mts = r.mts;
                    return this;
                } else {
                    // direct division with O(n*n) complexity
                    let is = LongFloat._working_precision - il;
                    let KL = K.layout;
                    let argthis = KL.offset_arg;
                    let argnext = K.write_mantissa_arg(this.mts, argthis);
                    let [a, t1, t2] = LongFloat.clear_mantissa_args(3, argnext);
                    K.mem_u32[(a / 4) + LongFloat._working_precision - 1] = 1;
                    // a = 1 * 2^-32;
                    let e = KF.mantissa_div(a, a, argthis, is, il, t1, t2);
                    // e is 0 only if this.mts is the same as a
                    this.exp[0] = 1 + e - this.exp[0];
                    K.read_mantissa_arg(this.mts, a);
                    return this;
                }
        }
    }

    recip (): LongFloat {
        return this.clone().recip_self();
    }

    div_self (rhs: LongFloat): LongFloat {
        let K = LongFloat.kernel;
        let KF = K.internal;
        if (KF.is_multiplied_by_convolution(this.precision) ||
            (this.special !== LFSpecial.Normal) ||
            (rhs.special !== LFSpecial.Normal)) {
            return this.mul(rhs.recip());
        }
        let KL = K.layout;
        let il = this.precision;
        let is = LongFloat._working_precision - il;
        let argthis = KL.offset_arg;
        let argrhs = K.write_mantissa_arg(this.mts, argthis);
        let argnext = K.write_mantissa_arg(rhs.mts, argrhs);
        let [argout, t1, t2] = LongFloat.mantissa_args(3, argnext);
        let e = KF.mantissa_div(argout, argthis, argrhs, is, il, t1, t2);
        K.read_mantissa_arg(this.mts, argout);
        this.exp[0] = this.exp[0] - rhs.exp[0] + e;
        this.sign = (this.sign === rhs.sign) ? 1 : -1;
        return this;
    }

    div (rhs: LongFloat | number): LongFloat {
        if (rhs instanceof LongFloat) {
            return this.clone().div_self(rhs);
        } else {
            return this.clone().div_int_self(rhs);
        }
    }

    // Rounding error functions. needed to minimize the dependancies of Estimate to the
    // actual LongFloat implementation.
    //
    // Return the index of the first possibly incorrect bit (provided the inputs were
    // correct)

    rounding_error_add (): number {
        return -LongFloat._working_precision * 32 - 1;
    }

    rounding_error_mul (): number {
        return -this.precision * 32 - 1;
    }

    rounding_error_div (): number {
        const mcov = LongFloat.kfns.is_multiplied_by_convolution(this.precision);
        return -(this.precision - (mcov ? 1 : 1)) * 32 + 2;
    }


    // ----- Comparisons -----

    // >= operator: checks if difference is negative
    ge (rhs: LongFloat): boolean {
        return !(this.sub(rhs)).is_negative();
    }

    // == operator
    eq (rhs: LongFloat): boolean {
        return (this.sub(rhs)).special === LFSpecial.Zero;
    }

    // != operator
    ne (rhs: LongFloat): boolean { return !this.eq(rhs); }

    // > operator
    gt (rhs: LongFloat): boolean { return !rhs.ge(this); }

    // < operator
    lt (rhs: LongFloat): boolean { return !this.ge(rhs); }

    // <= operator
    le (rhs: LongFloat): boolean { return rhs.ge(this); }


    // ----- Rounding and Normalising -----

    // Truncates the mantissa at the point where exponent is zero
    round_toward_zero_self (): this {
        const wprec = LongFloat._working_precision;
        let exp = this.exp[0];
        if ((this.special !== LFSpecial.Normal) || (exp >= wprec)) {
            return this;
        } else if (exp <= 0) {
            return this.convert_to_special_self(LFSpecial.Zero, this.sign);
        }
        let mts = this.mts;
        let i = exp + 1;
        while (i <= wprec) {
            mts[wprec - i++] = 0;
        }
        return this;
    }

    round_toward_zero (): LongFloat {
        return this.clone().round_toward_zero_self();
    }

    // Round to nearest integer
    round (): LongFloat {
        const wprec = LongFloat._working_precision;
        let exp = this.exp[0];
        if ((this.special !== LFSpecial.Normal) || (exp >= wprec)) {
            return this;
        } else if (exp < 0) {
            return LongFloat.from_special(LFSpecial.Zero, this.sign);
        } else if (exp === 0) {
            if (this.mts[wprec - 1] >= (2 ** 31)) {
                return LongFloat.from_double(this.sign);
            } else {
                return LongFloat.from_special(LFSpecial.Zero, this.sign);
            }
        }
        let buf = LongFloat.alloc();
        let lfexp = new Int32Array(buf, 0);
        let lfman = new Uint32Array(buf, 4);
        let i;
        for (i = 1; i <= exp; ++i) {
            lfman[wprec - i] = this.mts[wprec - i];
        }
        let j = wprec - i;
        while (i <= wprec) {
            lfman[wprec - i++] = 0;
        }
        if (j >= 0 && this.mts[j] >= (2 ** 31)) {
            while (++j < wprec && !++lfman[j]) { }
            if (j === wprec) {
                const K = LongFloat.kernel;
                let argout = K.layout.offset_arg;
                K.write_mantissa_arg(lfman);
                exp += LongFloat.kfns.adjust_for_carry(argout, 1);
                K.read_mantissa_arg(lfman, argout);
            }
        }
        lfexp[0] = exp;
        return new LongFloat(lfexp, lfman, this.sign, LFSpecial.Normal, this.precision);
    }

    // Normalization: returns an exponent that would set the mantissa in the range:
    // - [0.5; 1)
    normalize (): number {
        if (this.special !== LFSpecial.Normal) {
            return 0;
        }
        let e = this.exp[0] * 32;
        let m = this.mts[LongFloat._working_precision - 1];
        $_dbassert(m !== 0);
        while (!(m & 0x80000000)) {
            m *= 2;
            e -= 1;
        }
        return $_i32saturated(e);
    }


    // ----- Conversions -----

    // Return the nearest double value
    as_double (): number {
        let v = 0;
        switch (this.special) {
            case LFSpecial.Zero:
                break;
            case LFSpecial.Infinity:
                v = Infinity;
                break;
            case LFSpecial.Nan:
                v = NaN;
                break;
            default:
                let prec = LongFloat._working_precision;
                if (this.exp[0] > -1024 / 32) {
                    if (this.exp[0] < 1024 / 32) {
                        let e = this.exp[0] * 32;
                        v = $_ldexp(this.mts[prec - 1], e - 32);
                        v += $_ldexp(this.mts[prec - 2], e - 64);
                        v += $_ldexp(this.mts[prec - 3], e - 96);
                    } else {
                        v = Infinity;
                    }
                }
        }
        return this.sign * v;
    }

    // Mantissa conversion. Don't care about any other attribute
    mantissa (): LongFloat {
        const buf = this._buffer.slice(0, this._buffer.byteLength);
        const iv = new Int32Array(buf, 0, 1);
        const uv = new Uint32Array(buf, 4);
        iv[0] = 0;
        return new LongFloat(iv, uv, 1, this.special, this._precision);
    }

    signed_mantissa (): LongFloat {
        const buf = this._buffer.slice(0, this._buffer.byteLength);
        const iv = new Int32Array(buf, 0, 1);
        const uv = new Uint32Array(buf, 4);
        iv[0] = 0;
        return new LongFloat(iv, uv, this.sign, this.special, this._precision);
    }

    // Mantissa conversion. Don't care about any other attribute
    mantissa_as_double (): number {
        let wprec = LongFloat._working_precision;
        let d = $_ldexp(this.mts[wprec - 1], -32);
        d += $_ldexp(this.mts[wprec - 2], -64);
        d += $_ldexp(this.mts[wprec - 3], -96);
        return d;
    }

    // mantissa_as_decimal: Convert the fraction to a decimal string.
    // - Returns a pair [ string, carry ]
    //   - Does not add the leading '.' to the first element
    //   - Second element is true if the rounding resulted in carry, i.e. the mantissa
    //     rounds to 1.(0)
    mantissa_as_decimal (len: number): [string, boolean] {
        let prec = LongFloat._working_precision - 1;
        const K = LongFloat.kernel;
        const KF = K.internal;
        const KL = K.layout;
        const arg0 = KL.offset_arg;
        const arg1 = K.write_mantissa_arg(this.mts, arg0);
        let digits = [];
        const czero = 48;       // '0'.charCodeAt(0)
        const cnine = 57;       // '9'.charCodeAt(0)
        // multiply by ten and output the carry
        digits.push(KF.mantissa_scale(arg1, arg0, 10) + czero);
        let i;
        for (i = 1; i < len; ++i) {
            digits.push(KF.mantissa_scale(arg1, arg1, 10) + czero);
        }
        if (K.mem_u32[arg1 / 4 + prec] >= (2 ** 31)) { // we should round up
            while (i--) {
                if (digits[i]++ === cnine) {
                    digits[i] = czero;
                } else {
                    break;
                }
            }
        }
        return [String.fromCharCode(...digits), (i === -1)];
    }

    // Output
    as_decimal (n = 20): string {
        $_dassert(n >= 10,
            'as_decimal the number digits should at least accommodate the exponent.');
        // The format chosen is "[-].<mantissa>e<+/-><exponent>"
        // - where mantissa has a leading non-zero decimal
        let strs = [];
        let a = this.clone();
        if (this.is_negative()) {
            strs.push('-');
            --n;
            a.neg_self();
        }
        // handle special values
        switch (this.special) {
            case LFSpecial.Nan:
                strs.push('NaN');
                break;
            case LFSpecial.Infinity:
                strs.push('Infinity');
                break;
            case LFSpecial.Zero:
                strs.push('Zero');
                break;
            default:
                // Calculate exponent: the least power of 10 that is greater than or equal
                // to the value.
                let pwr = Math.trunc(this.normalize() * (Math.LOG10E / Math.LOG2E));
                // Divide the value by the exponent to form decimal mantissa
                const one = LongFloat.from_double(1);
                const ten = LongFloat.from_double(10);
                a.div_self(ten.pow(pwr));
                // double-arithmetic can be wrong...
                if (a.gt(one)) {
                    a.div_self(ten);
                    pwr++;
                } else {
                    let b = a.mul(ten);
                    if (b.lt(one)) {
                        a = b;
                        pwr--;
                    }
                }
                const expstr = `${pwr >= 0 ? '+' : ''}${pwr}`;
                const explen = expstr.length;
                // When the value is power of ten, we can get two possible representations
                // of the mantissa: 0.(9) and 1.(0). This behavior is not an error as it
                // is consistent with the theory. The function used to convert the
                // mantissa will not display 1.(0) correctly. Thus we must handle the case
                // differently: just pretend it's 0.(9)
                if (a.eq(one)) {
                    let nines = new Array(Math.max(0, n - explen - 2)).fill('9');
                    strs.push(nines.join(''));
                } else {
                    strs.push(a.mantissa_as_decimal(n - explen - 1)[0]);
                }
                //  Write the exponent
                strs.push('e', expstr);
        }
        return strs.join('');
    }


    // ----- Static constructors -----

    // Exact conversion; set to man * 2**(32*exp)
    static from_32bit (mts: number, exp: number): LongFloat {
        let buf = LongFloat.alloc();
        const iv = new Int32Array(buf, 0, 1);
        const uv = new Uint32Array(buf, 4);
        const sign = mts < 0 ? -1 : 1;
        const prec = LongFloat._working_precision;
        let special: LFSpecial;
        if (mts === 0) {
            special = LFSpecial.Zero;
        } else {
            special = LFSpecial.Normal;
            iv[0] = exp + 1;
            uv[prec - 1] = Math.trunc(Math.abs(mts));
        }
        return new LongFloat(iv, uv, sign, special, prec);
    }

    static from_special (special: LFSpecial, sign: Sign): LongFloat {
        let buf = LongFloat.alloc();
        let iv = new Int32Array(buf, 0, 1);
        let uv = new Uint32Array(buf, 4);
        return new LongFloat(iv, uv, sign, special, LongFloat._working_precision);
    }

    // Exact conversion
    static from_double (d: number): LongFloat {
        let buf: ArrayBuffer = LongFloat.alloc();
        let iv = new Int32Array(buf, 0, 1);
        let uv = new Uint32Array(buf, 4);
        let sign: Sign = 1;
        let prec: number = LongFloat._working_precision;
        let special: LFSpecial;
        if (d < 0 || Object.is(d, -0)) {
            sign = -1;
            d = -d;
        }
        if (Number.isFinite(d) && d !== 0) {
            d = this.kernel.internal.frexp(d, this.kernel.layout.offset_arg);
            let exp = this.kernel.mem_i32[this.kernel.layout.offset_arg / 4];
            // our exponents are based on 2^32, correct for this
            const exp32 = (exp + 31) >> 5;
            iv[0] = exp32 | 0;
            // division by 32 can give negative remainder
            exp = exp - (exp32 << 5);
            $_dbassert(exp <= 0 && exp > -32);
            // shift one word and save the integer part
            d = $_ldexp(d, 32 + exp);
            let i = prec - 1;
            uv[i--] = d | 0;
            // shift the fractional part one word and save the integer part
            d = $_ldexp((d - Math.floor(d)), 32);
            uv[i--] = d | 0;
            // shift the fractional part one word and save the integer part
            d = $_ldexp((d - Math.floor(d)), 32);
            uv[i--] = d | 0;
            // by now fraction should be zero
            $_dbassert(d === Math.floor(d));
            special = LFSpecial.Normal;
        } else if (Number.isNaN(d)) {
            special = LFSpecial.Nan;
        } else if (d === 0) {
            special = LFSpecial.Zero;
        } else {
            special = LFSpecial.Infinity;
        }
        return new LongFloat(iv, uv, sign, special, prec);
    }

    // Initialise from string; set to closest representable value
    static from_string (s: string): LongFloat {
        s = s.trim();
        let val = [...s].map(c => c.charCodeAt(0));
        let i = 0;
        const cplus = 43;       // '+'.charCodeAt(0)
        const cminus = 45;      // '-'.charCodeAt(0)
        const czero = 48;       // '0'.charCodeAt(0)
        const cnine = 57;       // '9'.charCodeAt(0)
        const cperiod = 46;     // '.'.charCodeAt(0)
        const cee = 101;        // 'e'.charCodeAt(0)
        const cEE = 69;         // 'E'.charCodeAt(0)
        let neg = false;
        if (val[0] === cminus) {
            neg = true;
            ++i;
        } else if (val[0] === cplus) {
            neg = false;
            ++i;
        }
        let t = LongFloat.from_special(LFSpecial.Zero, 1);
        while (val[i] >= czero && val[i] <= cnine) {
            t = LongFloat.from_32bit(val[i] - czero, 0).fma(t, 10);
            ++i;
        }
        // On fractions we proceed as usual, only remember how many fractional digits
        // we've processed
        let expd = 0;
        if (val[i] === cperiod) {
            ++i;
            while (val[i] >= czero && val[i] <= cnine) {
                t = LongFloat.from_32bit(val[i] - czero, 0).fma(t, 10);
                expd -= 1;
                ++i;
            }
        }
        // Add the exponent to the one we've gathered until now
        if (val[i] === cee || val[i] === cEE) {
            ++i;
            let eneg = false;
            if (val[i] === cplus || val[i] === cminus) {
                eneg = (val[i] === cminus);
                ++i;
            }
            let expt = 0;
            while (val[i] >= czero && val[i] <= cnine) {
                expt = expt * 10 + (val[i] - czero);
                ++i;
            }
            expd += eneg ? -expt : expt;
        }
        // Multiply by the power of ten that is the exponent
        if (expd) {
            t.mul_self(LongFloat.from_double(10).pow($_i32saturated(expd)));
        }
        return neg ? t.neg_self() : t;
    }
}
