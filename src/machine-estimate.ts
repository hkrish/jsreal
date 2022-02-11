import { ExnDomain, ExnPrecision, Printer } from "./defs";
import { current_kernel, IKernel } from "./kernels/kernel";
import { EstimateIvl } from "./estimate-ivl";

// Import some macros
//! import './macros/debug.jsmacro';
//! import './macros/jsreal.jsmacro';


// MachineEstimate - Implements interval arithmetic on machine precision floats. To be
// used for the first fast stage of the evaluation.

const I32_MAX = 0x7FFFFFFF;
const I32_MIN = -0x80000000;
const ONEPEPS: number = (1 + Number.EPSILON);
const ONEMEPS: number = (1 - (Number.EPSILON * 0.5));

// u32 Constants[172];
const Consts_u32 = new Uint32Array([
    // #define CONSTS_COS 0
    0x00000001, 0x3ff00000, // coeff[0] rounded up
    0xffffffff, 0x3fefffff, // coeff[0] rounded down
    0x418cafdb, 0x40018bc4, // coeff[1], exact
    0x9e3185f6, 0x3fe9a7b2, // coeff[2], exact
    0x5d05165d, 0x3fbe0270, 0xa8e30653, 0x3f82ce22, 0x70426553, 0x3f3d5450, 0x749f656f,
    0x3eef2edc, 0x44c498c8, 0x3e979e4b,
    // #define CONSTS_RPI4 9
    // 1/(Pi*4), multiplication constant
    0x6dc9c883, 0x3fb45f30, 0x6dc9c882, 0x3fb45f30,
    // #define CONSTS_PI 11
    // Pi, proper interval
    0x54442d19, 0x400921fb, 0x54442d18, 0x400921fb,
    // #define CONSTS_SIN 13
    0x382d7366, 0x4000c152, 0x382d7365, 0x4000c152, 0x791049dc, 0x3ff87fb0, 0x3ea3fdb3,
    0x3fd57e24, 0x23972846, 0x3fa1f529, 0x62748c9e, 0x3f618133, 0x4e962080, 0x3f165652,
    0xe58a04cb, 0x3ec4189c, 0x3772c742, 0x3e6a705b,
    // #define CONSTS_EXPMASK 22
    0x00000000, 0x7ff00000,
    // #define CONSTS_EXPBIAS 23
    0x00000000, 0x3fe00000,
    // #define CONSTS_LOG 24
    0xed268e66, 0x3ca3df51, 0xb100afab, 0xbc2dcabb, 0x00000004, 0x3ff00000, 0xffffeeea,
    0x3fdfffff, 0x55550aa6, 0x3fd55555, 0x002a2505, 0x3fd00000, 0x9a79b04d, 0x3fc99999,
    0x0771c502, 0x3fc55555, 0xfc94cb71, 0x3fc24923, 0x35ec7035, 0x3fc00022, 0x9d9f4587,
    0x3fbc722e, 0xab47707f, 0x3fb98a39, 0xb4029d62, 0x3fb73291, 0x0deb07e2, 0x3fb7085a,
    0xa63cf31c, 0x3fb582e2,
    // #define CONSTS_SQRTSQRT2 39
    0xa31b716, 0x3ff306fe, 0xa31b715, 0x3ff306fe,
    // #define CONSTS_LN2 41
    0xfefa39f0, 0x3fe62e42, 0xfefa39ef, 0x3fe62e42,
    // #define CONSTS_LN2C 43
    0xfefa39f0, 0x3fe62e42, 0xfefa39ef, 0x3fe62e42,
    // #define CONSTS_LOG2E 45
    0x652b82ff, 0x3ff71547, 0x652b82fe, 0x3ff71547,
    // #define CONSTS_SIGN 47
    0x00000000, 0x80000000,
    // #define CONSTS_EXPLIMIT 48
    0x0, 0x408ff000,
    // #define CONSTS_EXP 49
    0x00000001, 0x40000000, 0xffffffff, 0x3fffffff, 0xfefa39f9, 0x3ff62e42, 0xff82bdb1,
    0x3fdebfbd, 0xd706fa97, 0x3fbc6b08, 0x6f5ef210, 0x3f93b2ab, 0xf7c7e6fd, 0x3f65d87f,
    0x5d0bd9c1, 0x3f34308f, 0x722cb340, 0x3efffd04, 0x43ec690a, 0x3ec628a6, 0xab63f5ed,
    0x3e8b898b, 0xdf1599b6, 0x3e4c140c, 0xc4fc16f9, 0x3e15a8b6,
    // #define CONSTS_ATAN 62
    0x00000001, 0x3ff00000, 0xffffffff, 0x3fefffff, 0x555553d2, 0xbfd55555, 0x9998037a,
    0x3fc99999, 0x91f33a63, 0xbfc24924, 0x09057800, 0x3fbc71c7, 0x1aa24579, 0xbfb745d0,
    0xf9b84bf5, 0x3fb3b12a, 0x01a930e2, 0xbfb11089, 0x556e5d85, 0x3fae177e, 0xa80e2f1b,
    0xbfaad32f, 0xa58c31d6, 0x3fa7ee71, 0x8b0ccaa5, 0xbfa4f50b, 0x6c6308fe, 0x3fa17309,
    0x2b4c52ee, 0xbf9a77d1, 0x7e19f3dd, 0x3f916913, 0xfa32033c, 0xbf82da21, 0xd33c5aff,
    0x3f6fb050, 0x6bed862f, 0xbf532726, 0x510269d4, 0x3f2d637e, 0x64cd132e, 0xbef5619e,
    // #define CONSTS_SQRT2 83
    // sqrt(2), mult. constant
    0x667f3bcd, 0x3ff6a09e, 0x667f3bcc, 0x3ff6a09e,
    // #define CONSTS_PI2 85
    // Pi*2 rounded up
    0x54442d19, 0x402921fb
]);

const Consts = new Float64Array(Consts_u32.buffer);

const CCOS = 0;
const CRPI4 = 9;                // 1/(Pi*4), multiplication constant
const CPI = 11;                 // Pi, proper interval
const CSIN = 13;
const CEXPMASK = 22;
const CEXPBIAS = 23;
const CLOG = 24;
const CSQRTSQRT2 = 39;
const CLN2 = 41;
const CLN2C = 43;
const CLOG2E = 45;
const CSIGN = 47;
const CEXPLIMIT = 48;
const CEXP = 49;
const CATAN = 62;
const CSQRT2 = 83;              // sqrt(2), mult. constant
const CPI2 = 85;                // Pi*2 rounded up


// TODO: Test (inlining) performance of methods vs functions for arithmetic
//       (add, mul etc.)

function round_up (v: number): number { return (v > 0) ? (v * ONEPEPS) : (v * ONEMEPS); }

function round_down (v: number): number { return (v > 0) ? (v * ONEMEPS) : (v * ONEPEPS); }

function round_to_zero (v: number): number { return (v * ONEMEPS); }

function round_from_zero (v: number): number { return (v * ONEPEPS); }


export class MachineEstimate implements EstimateIvl<MachineEstimate> {
    private static kernel: IKernel;
    private static kfns: WKernel;

    low: number;
    high: number;

    constructor(l: number, h: number) {
        this.low = l;
        this.high = h;
    }

    static initialize () {
        this.kernel = current_kernel();
        this.kfns = this.kernel.internal;
    }

    private sum (): number {
        return this.high + this.low;
    }

    private diff (): number {
        return this.high - this.low;
    }

    private interval (): number[] {
        return [this.low, this.high];
    }

    is_valid (): boolean {
        return (Number.isFinite(this.low) && Number.isFinite(this.high));
    }

    // Get a rough estimate of the precision. Used to determine the length of the
    // approximations to functions
    get precision (): number { return 3; }
    set precision (_prec: number) { }


    // ----- Truncation -----

    // Used to make sure only arguments within the domain of the function are processed
    // for the closed ends of the domain.
    //
    // To this end, truncates the approximation interval so that the indicated real
    // numbers are thrown out. If nothing remains, raise a DomainException(origin).

    // WARNING: An error in the approximation of the bound will be added to the error in
    // the end result, i.e. if [0, 3] is truncated below [1, 0.5], the result will be
    // [0.5, 3.5]. To avoid problems, use exact bounds (e.g. double)!

    // Removes the part of the approximation interval that is negative
    truncate_negative (): MachineEstimate {
        if (this.high < 0)
            throw new ExnDomain(this);
        else
            return new MachineEstimate(Math.max(this.low, 0.0), this.high);
    }

    // Removes the part of the approximation that is below a certain lower bound
    truncate_below (l: MachineEstimate | number): MachineEstimate {
        if (l instanceof MachineEstimate) {
            return this.sub(l).truncate_negative().add(l);
        } else {
            if (this.high < l) {
                throw new ExnDomain(this, 'l', l);
            } else {
                return new MachineEstimate(Math.max(this.low, l), this.high);
            }
        }
    }

    // Removes the part of the approximation that is above a certain upper bound
    truncate_above (h: MachineEstimate | number): MachineEstimate {
        if (h instanceof MachineEstimate) {
            return h.sub(h.sub(this).truncate_negative());
        } else {
            if (this.low > h) {
                throw new ExnDomain(this, 'h', h);
            } else {
                return new MachineEstimate(this.low, Math.min(this.high, h));
            }
        }
    }

    // Removes the part of the approximation outside the specified interval
    truncate_to (l: MachineEstimate, h: MachineEstimate): MachineEstimate;
    truncate_to (l: number, h: number): MachineEstimate;
    truncate_to (l: MachineEstimate | number, h: MachineEstimate | number): MachineEstimate {
        if (l instanceof MachineEstimate) {
            h = <MachineEstimate>h;
            // FIX: this is different from the one in estimate.ts?
            return h.sub(l).sub(this.sub(l).truncate_negative())
                .truncate_negative().add(l);
        } else {
            h = <number>h;
            l = <number>l;
            let e = new MachineEstimate(Math.max(l, this.low), Math.min(h, this.high));
            if (e.high < e.low) {
                throw new ExnDomain(this, 'l', l, 'h', h);
            } else {
                return e;
            }
        }
    }


    // ----- Arithmetic -----

    neg (): MachineEstimate {
        return new MachineEstimate(-this.high, -this.low);
    }

    recip (): MachineEstimate {
        if (!this.is_non_zero()) {
            throw new ExnPrecision(this);
        }
        let l = 1.0 / this.high;
        let h = 1.0 / this.low;
        return new MachineEstimate(round_down(l), round_up(h));
    }

    add (rhs: MachineEstimate): MachineEstimate {
        return new MachineEstimate(round_down(this.low + rhs.low)
            , round_up(this.high + rhs.high));
    }

    sub (rhs: MachineEstimate): MachineEstimate {
        return this.add(rhs.neg());
    }

    mul (rhs: MachineEstimate): MachineEstimate {
        let ll = this.low * rhs.low;
        let lh = this.low * rhs.high;
        let hl = this.high * rhs.low;
        let hh = this.high * rhs.high;
        return new MachineEstimate(round_down(Math.min(ll, lh, hl, hh))
            , round_up(Math.max(ll, lh, hl, hh)));
    }

    div (rhs: MachineEstimate): MachineEstimate {
        return this.mul(rhs.recip());
    }

    // Fast multiplication
    mul_fast (rhs: number): MachineEstimate {
        return new MachineEstimate(round_down(this.low * rhs)
            , round_up(this.high * rhs));
    }

    // Fast division
    div_fast (rhs: number): MachineEstimate {
        return new MachineEstimate(round_down(this.low / rhs)
            , round_up(this.high / rhs));
    }

    // = lhs / this;
    div_by (lhs: number): MachineEstimate {
        return this.recip().mul_fast(lhs);
    }

    // Positive multiples, positive result
    mul_pos (v: MachineEstimate | number): MachineEstimate {
        if (v instanceof MachineEstimate) {
            return new MachineEstimate(round_to_zero(this.low * v.low)
                , round_from_zero(this.high * v.high));
        } else {
            return new MachineEstimate(round_to_zero(this.low * v)
                , round_from_zero(this.high * v));
        }
    }

    // Only the right hand-side is known to be positive, the result may be negative
    mul_pos_rhs (v: MachineEstimate | number): MachineEstimate {
        if (v instanceof MachineEstimate) {
            return new MachineEstimate(round_down(this.low * v.low)
                , round_up(this.high * v.high));
        } else {
            return new MachineEstimate(round_down(this.low * v)
                , round_up(this.high * v));
        }
    }

    // the result needs to be positive
    add_pos (v: MachineEstimate): MachineEstimate {
        return new MachineEstimate(round_to_zero(this.low + v.low)
            , round_from_zero(this.high + v.high));
    }

    // multiplication by double, no restrictions
    mul_double (v: number): MachineEstimate {
        return (v >= 0 ? this.mul_pos_rhs(v)
            : new MachineEstimate(round_down(this.high * v), round_up(this.low * v)));
    }

    add_product_pos (v: MachineEstimate | number): MachineEstimate {
        return this.add_pos(this.mul_pos(v));
    }

    sub_product_pos (v: MachineEstimate | number): MachineEstimate {
        return this.add_pos(this.mul_pos(v).neg());
    }

    add_product_pos_neg (pos: MachineEstimate, neg: number) {
        return new MachineEstimate(
            round_to_zero(this.low + round_from_zero(pos.low * neg)),
            round_from_zero(this.high + round_to_zero(pos.high * neg)));
    }

    shl (howmuch: number) {
        return new MachineEstimate($_ldexp(this.low, howmuch)
            , $_ldexp(this.high, howmuch));
    }

    shr (howmuch: number) {
        return this.shl(-howmuch);
    }


    // ----- Static Maths Functions -----

    static pi (_prec: number): MachineEstimate {
        return me_pi;
    }

    static ln2 (_prec: number): MachineEstimate {
        return me_ln2;
    }

    static abs (arg: MachineEstimate): MachineEstimate {
        if (arg.low >= 0) {
            return arg;
        } else if (arg.high <= 0) {
            return arg.neg();
        } else {
            return new MachineEstimate(0, Math.max(arg.high, -arg.low));
        }
    }

    static sq (arg: MachineEstimate): MachineEstimate {
        let a = this.abs(arg);
        let low = round_down(a.low * a.low);
        let high = round_up(a.high * a.high);
        return new MachineEstimate(low, high);
    }

    static sqrt (arg: MachineEstimate): MachineEstimate {
        let l = Math.sqrt(arg.low);
        if (!(l >= 0)) {
            // Not the same as (l < 0): unordered comparison (i.e. l >= 0 is false if l is
            // NaN, but l<0 is also false)
            l = 0;
        }
        return new MachineEstimate(round_down(l), round_up(Math.sqrt(arg.high)));
    }

    static rsqrt (arg: MachineEstimate): MachineEstimate {
        return this.sqrt(arg).recip();
    }

    static pow (arg: MachineEstimate, pwr: number): MachineEstimate {
        if (pwr < 0) {
            pwr = -pwr;
            arg = arg.recip();
        }
        let acc = MachineEstimate.from_double(1);
        while (pwr) {
            if (pwr & 1) {
                acc = acc.mul(arg);
            }
            pwr >>= 1;
            arg = this.sq(arg);
        }
        return acc;
    }

    static log (arg: MachineEstimate): MachineEstimate {
        return new MachineEstimate(round_down(Math.log(arg.low))
            , round_up(Math.log(arg.high)));
    }

    static exp (arg: MachineEstimate): MachineEstimate {
        return new MachineEstimate(round_down(Math.exp(arg.low))
            , round_up(Math.exp(arg.high)));
    }

    static sin (arg: MachineEstimate): MachineEstimate {
        let c = arg.weak_as_double();
        let d = arg.get_error();
        c = Math.sin(c);
        return MachineEstimate.from_double(c).add_error(d);
    }

    static cos (arg: MachineEstimate): MachineEstimate {
        let c = arg.weak_as_double();
        let d = arg.get_error();
        c = Math.cos(c);
        return MachineEstimate.from_double(c).add_error(d);
    }

    static tan (arg: MachineEstimate): MachineEstimate {
        return this.sin(arg).div(this.cos(arg));
    }

    static asin (arg: MachineEstimate): MachineEstimate {
        let a = new MachineEstimate(arg.low, arg.high);
        if (a.low < -1.0) {
            a.low = -1.0;
        }
        if (a.high > 1.0) {
            a.high = 1.0;
        }
        return new MachineEstimate(round_down(Math.asin(a.low))
            , round_up(Math.asin(a.high)));
    }

    static acos (arg: MachineEstimate): MachineEstimate {
        return this.pi(arg.precision).div_fast(2).sub(this.asin(arg));
    }

    static atan (arg: MachineEstimate): MachineEstimate {
        return this.asin(arg.mul(
            this.rsqrt(this.sq(arg).add(new MachineEstimate(1, 1)))));
    }

    static atan2 (y: MachineEstimate, x: MachineEstimate): MachineEstimate {
        // This is atan with result over the full range depending on the signs of both
        // arguments. Normal atan takes care of the sign of y (the sine value). (0, 0) is
        // undefined, so we can just return 0 with error pi -- so that some complex
        // operations that use atan2 would work.
        let tpi = this.pi(53 /* x.precision */);
        if (x.is_positive()) {
            return this.atan(y.div(x));
        } else if (x.is_negative()) {
            if (y.is_positive()) {
                return tpi.sub(this.atan(y.div(x.neg())));
            } else {
                return tpi.neg().sub(this.atan(y.div(x.neg())));
            }
        } else {
            // x cannot be distinguished from zero, but this does not stop us to give
            // estimates for the angle based on y and x's possible values
            tpi = tpi.div_fast(2);
            if (y.is_positive()) {
                return tpi.add_error(y.div(x.get_error().mul_fast(2)));
            } else if (y.is_negative()) {
                return tpi.neg().add_error(y.div(x.get_error().mul_fast(2)));
            } else {
                return (new MachineEstimate(0, 0)).set_error(tpi);
            }
        }
    }


    // ----- Error -----

    get_error (): MachineEstimate {
        return MachineEstimate.from_double(round_up(this.high - this.low) * 0.5);
    }

    set_error (err: MachineEstimate): this {
        let s = (this.high + this.low) * 0.5;
        let e = Math.max(Math.abs(err.low), Math.abs(err.high));
        this.low = round_down(s - e);
        this.high = round_up(s + e);
        return this;
    }

    add_error (err: MachineEstimate): this {
        let e = Math.max(Math.abs(err.low), Math.abs(err.high));
        this.low = round_down(this.low - e);
        this.high = round_up(this.high + e);
        return this;
    }

    // A lower bound on the correct binary digits. Uses the exponents of the value and
    // error to calculate it quickly
    get relative_error (): number {
        if (this.high === this.low) {
            return I32_MAX;
        } else {
            let d = MachineEstimate.kfns.frexp(
                (this.high + this.low) / (this.high - this.low), 0);
            if (d === 0) {
                return I32_MIN;
            } else {
                return MachineEstimate.kernel.mem_i32[0];
            }
        }
    }

    // Among the weak operations is also rounding the returned Estimate is assumed exact
    // only to be used on periodic functions!
    weak_round (): MachineEstimate {
        return MachineEstimate.from_double(Math.floor((this.sum() + 1.0) * 0.5));
    }

    // Weak normalize, i.e. return an exponent such that,
    //  a >> a.weak_normalize() is in the range [0.5, 1).
    weak_normalize (): number {
        MachineEstimate.kfns.frexp(this.sum(), 0);
        return MachineEstimate.kernel.mem_i32[0] - 1;
    }

    weak_center (): MachineEstimate {
        return MachineEstimate.from_double(this.weak_as_double());
    }


    // ----- Comparisons -----

    // These come in two flavors, Strong, and Weak
    // - Strong: is true if real is in relation to rhs
    // - Weak: is true if m_Value is in relation to rhs

    is_positive (): boolean {
        return this.low > 0;
    }

    is_negative (): boolean {
        return this.high < 0;
    }

    is_non_zero (): boolean {
        return (this.is_positive() || this.is_negative());
    }

    // Equality test is undecidable (i.e. would yield false for any precision)
    // - thus ==, <= and >= are not included
    // - also !(x<y) does not mean y<=x

    lt (rhs: MachineEstimate): boolean {
        return this.high < rhs.low;
    }

    gt (rhs: MachineEstimate): boolean {
        return this.low > rhs.high;
    }

    ne (rhs: MachineEstimate): boolean {
        return (this.lt(rhs) || this.gt(rhs));
    }

    // Weak: (true if m_Value is in relation to rhs)
    //  should only be used if the transformation being applied would not differentiate on
    //  the two cases, e.g. to choose whether to evaluate sin(x) and sin(pi - x)

    weak_is_negative (): boolean {
        return this.low < -this.high;
    }

    weak_is_positive (): boolean {
        return this.high > -this.low;
    }

    weak_is_non_zero (): boolean {
        return this.low === -this.high;
    }

    weak_lt (rhs: MachineEstimate): boolean {
        return this.sum() < rhs.sum();
    }

    weak_eq (rhs: MachineEstimate): boolean {
        return this.sum() === rhs.sum();
    }

    weak_gt (rhs: MachineEstimate): boolean {
        return rhs.weak_lt(this);
    }

    weak_le (rhs: MachineEstimate): boolean {
        return !this.weak_gt(rhs);
    }

    weak_ge (rhs: MachineEstimate): boolean {
        return !this.weak_lt(rhs);
    }

    weak_ne (rhs: MachineEstimate): boolean {
        return !this.weak_eq(rhs);
    }


    // ----- Conversions -----

    weak_as_double (): number {
        return this.sum() * 0.5;
    }

    weak_as_decimal (_buflen: number): string {
        return this.weak_as_double().toString();
    }


    // ----- Output -----

    as_string (): string {
        return Printer.base(10).print("(")
            .print(this.low).print(", ").print(this.high)
            .print(")").string;
    }

    as_string_hexdiff (): string {
        let af64 = new Float64Array(2);
        let au64 = new BigInt64Array(af64.buffer);
        af64[0] = this.low;
        af64[1] = this.high;
        return Printer.base(16).print("(hexdiff ")
            .print(au64[1] - au64[0]).print(")").string;
    }


    // ----- Static Constructors -----

    static from_double (v: number): MachineEstimate {
        return new MachineEstimate(v, v);
    }

    static from_string (val: string): MachineEstimate {
        let v = Number.parseFloat(val);
        return new MachineEstimate(round_down(v), round_up(v));
    }
}


const me_rpi4 = new MachineEstimate(Consts[CRPI4 + 1], Consts[CRPI4]);
const me_pi_over_2 = new MachineEstimate(Consts[CPI + 1] * 0.5, Consts[CPI] * 0.5);
const me_pi_over_4 = new MachineEstimate(Consts[CPI + 1] * 0.25, Consts[CPI] * 0.25);
const me_pi = new MachineEstimate(Consts[CPI + 1], Consts[CPI]);
const me_ln2 = new MachineEstimate(Consts[CLN2 + 1], Consts[CLN2]);
const me_upped_pi2 = Consts[CPI2];
const me_sqrt_2 = new MachineEstimate(Consts[CSQRT2 + 1], Consts[CSQRT2]);
const me_sqrt_sqrt_2 = new MachineEstimate(Consts[CSQRTSQRT2 + 1], Consts[CSQRTSQRT2]);
const me_log2e = new MachineEstimate(Consts[CLOG2E + 1], Consts[CLOG2E]);
