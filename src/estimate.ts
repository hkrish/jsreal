import { ExnDomain, ExnPrecision, MINIMUM_EXPONENT } from "./defs";
import { ErrorEstimate, RoundingMode } from "./error-estimate";
import { EstimateIvl } from "./estimate-ivl";
import { LFSpecial, LongFloat } from "./longfloat";

// Import some macros
//! import './macros/debug.jsmacro';
//! import './macros/jsreal.jsmacro';


//  Error maths, and value+error container.
//
//  Estimate - Combines a LongFloat with its ErrorEstimate.
//             The error is absolute: |value - real| < error.


const MINUS_INF = -0x7FFFFFFF;


// Constants
let E0_25: Estimate;
let E_0_25: Estimate;
let E0_5: Estimate;
let E_0_5: Estimate;
let E1: Estimate;
let E2: Estimate;
let E3: Estimate;
let E4: Estimate;
let E1_5: Estimate;
let RPI_y: Estimate;
let RPI_z: Estimate;
let SIN_C1: Estimate;
let SIN_C1m: Estimate;
let ASIN_C1: Estimate;
let ASIN_C1m: Estimate;


export class Estimate implements EstimateIvl<Estimate> {
    private _value: LongFloat;
    // Error, |m_Value - real| < m_Error
    private _error: ErrorEstimate;

    // Cache
    private static _cached_pi?: Readonly<Estimate>;
    private static _cached_ln2?: Readonly<Estimate>;

    constructor(val: LongFloat, err?: ErrorEstimate) {
        this._value = val;
        this._error = (err == null) ? new ErrorEstimate() : err;
        this.correct_zero();
    }

    static initialize () {
        E0_25 = <Estimate>Object.freeze(Estimate.from_double(0.25));
        E_0_25 = <Estimate>Object.freeze(Estimate.from_double(-0.25));
        E0_5 = <Estimate>Object.freeze(Estimate.from_double(0.5));
        E_0_5 = <Estimate>Object.freeze(Estimate.from_double(-0.5));
        E1 = <Estimate>Object.freeze(Estimate.from_double(1.0));
        E2 = <Estimate>Object.freeze(Estimate.from_double(2.0));
        E3 = <Estimate>Object.freeze(Estimate.from_double(3.0));
        E4 = <Estimate>Object.freeze(Estimate.from_double(4.0));
        E1_5 = <Estimate>Object.freeze(Estimate.from_double(1.5));
        RPI_y = <Estimate>Object.freeze(Estimate.sqrt(E2).sub(E1));
        RPI_z = <Estimate>Object.freeze(
            Estimate.sqrt(Estimate.sqrt(E1.sub(Estimate.sqrt(Estimate.sqrt(RPI_y))))));
        SIN_C1 = <Estimate>Object.freeze(Estimate.from_double(0.6125));
        SIN_C1m = <Estimate>Object.freeze(Estimate.from_double(-0.6125));
        ASIN_C1 = <Estimate>Object.freeze(Estimate.from_double(0.708));
        ASIN_C1m = <Estimate>Object.freeze(Estimate.from_double(-0.708));
    }

    // 0 should not be used in calculations. Substitute (0, e) with (e, 2e) and (0, 0)
    // with (2^-MAXINT, 2^-MAXINT * 2)
    correct_zero () {
        if (this._value.kind == LFSpecial.Zero) {
            if (this._error.exp == MINUS_INF) {
                this._error.exp = MINIMUM_EXPONENT + 1;
                this._error.mts = 2 ** 30;
                this._value = this._error.as_longfloat();
                this._error.mts = 2 ** 31;
            } else {
                this._value = this._error.as_longfloat();
                this._error = this._error.shl(1);
            }
        }
    }

    // Get a rough estimate of the precision.
    // - Used to determine the length of the approximations to functions.
    get precision (): number {
        return this._value.precision;
    }

    set precision (val: number) {
        this._value.precision = val;
    }

    static clear_cached_estimates () {
        this._cached_pi = undefined;
        this._cached_ln2 = undefined;
    }

    clone (): Estimate {
        return new Estimate(this._value.clone(), this._error.clone());
    }


    // ----- Truncation -----

    // Used to make sure only arguments within the domain of the function are processed
    // for the closed ends of the domain. To this end, truncates the approximation
    // interval so that the indicated real numbers are thrown out. If nothing remains,
    // raise a DomainException(origin).
    //
    // WARNING: An error in the approximation of the bound will be added to the error in
    // the end result, i.e. if (center 0, error 3) is truncated below (c 1, e 0.5), the
    // result will be (c 2, e 1.5) (i.e. the interval [0.5, 3.5]). To avoid problems, use
    // double arguments.

    // Removes the part of the approximation interval that is negative
    truncate_negative (): Estimate {
        if (this.is_negative()) {
            throw new ExnDomain(this);
        }
        if (this.is_positive()) {
            return this.clone();
        }
        // (the theory says we can't always give the correct DomainException, so we
        // shouldn't try)
        //
        // Get an interval centered at half the upper bound, with the same error.
        let center = (this._value.add(this._error.as_longfloat())).shr(1);
        let a = new Estimate(center, ErrorEstimate.from_longfloat(center));
        $_dassert(!a.is_positive(), 'a must be positive');
        return a;
    }

    // Removes the part of the approximation that is below a certain lower bound
    truncate_below (l: Estimate): Estimate {
        return this.sub(l).truncate_negative().add_self(l);
    }

    // Removes the part of the approximation that is above a certain upper bound
    truncate_above (h: Estimate): Estimate {
        return h.sub(h.sub(this).truncate_negative());
    }

    // Removes the part of the approximation outside the specified interval
    truncate_to (l: Estimate, h: Estimate): Estimate;
    truncate_to (l: number, h: number): Estimate;
    truncate_to (l: Estimate | number, h: Estimate | number): Estimate {
        if (!(l instanceof Estimate && h instanceof Estimate)) {
            h = Estimate.from_double(<number>h);
            l = Estimate.from_double(<number>l);
        }
        return h.sub(h.sub(l).sub(this.sub(l).truncate_negative())
            .truncate_negative());
    }


    // ----- Arithmetic -----

    neg (): Estimate {
        return new Estimate(this._value.neg(), this._error);
    }

    recip (): Estimate {
        if (!this.is_non_zero()) {
            throw new ExnPrecision(this);
        }
        let r = this._value.recip();
        let e = ErrorEstimate.from_longfloat(this._value, RoundingMode.Down);
        let re = ErrorEstimate.rounding_error(r, r.rounding_error_div());
        return new Estimate(r, this._error.div(e.sub(this._error)).div(e).add(re));
        // Multiplication in denominator would have the wrong rounding mode
    }

    add (rhs: Estimate): Estimate {
        let s = this._value.add(rhs._value);
        return new Estimate(s, this._error.add(rhs._error)
            .add(ErrorEstimate.rounding_error(s, s.rounding_error_add())));
    }

    add_self (rhs: Estimate): this {
        let s = this._value.add_self(rhs._value);
        this._error.add_self(rhs._error)
            .add_self(ErrorEstimate.rounding_error(s, s.rounding_error_add()));
        return this;
    }

    sub (rhs: Estimate): Estimate {
        let s = this._value.sub(rhs._value);
        return new Estimate(s, this._error.add(rhs._error)
            .add(ErrorEstimate.rounding_error(s, s.rounding_error_add())));
    }

    sub_self (rhs: Estimate): this {
        let s = this._value.sub_self(rhs._value);
        this._error.add_self(rhs._error)
            .add_self(ErrorEstimate.rounding_error(s, s.rounding_error_add()));
        return this;
    }

    mul (rhs: Estimate): Estimate {
        let r = this._value.mul(rhs._value);
        let e = this._error.mul(rhs._error)
            .add(this._error.mul(ErrorEstimate.from_longfloat(rhs._value)))
            .add(rhs._error.mul(ErrorEstimate.from_longfloat(this._value)));
        return new Estimate(r, e.add(ErrorEstimate.rounding_error(r, r.rounding_error_mul())));
    }

    mul_self (rhs: Estimate): this {
        let m = this.mul(rhs);
        this._value = m._value;
        this._error = m._error;
        return this;
    }

    mul_fast (rhs: number): Estimate {
        rhs = rhs | 0;
        let r = this._value.mul(rhs);
        return new Estimate(r, this._error.mul(ErrorEstimate.from_double(rhs))
            .add(ErrorEstimate.rounding_error(r, r.rounding_error_add())));
    }

    mul_fast_self (rhs: number): this {
        let m = this.mul_fast(rhs);
        this._value = m._value;
        this._error = m._error;
        return this;
    }

    div (rhs: Estimate): Estimate {
        if (!rhs.is_non_zero()) {
            throw new ExnPrecision(rhs);
        }
        // This also assures e - rhs.m_Error > 0
        let r = this._value.div(rhs._value);
        let e = ErrorEstimate.from_longfloat(rhs._value, RoundingMode.Down);
        let n = ErrorEstimate.from_longfloat(this._value).mul(rhs._error)
            .add(ErrorEstimate.from_longfloat(rhs._value, RoundingMode.Up)
                .mul(this._error));
        n = n.div(e.sub(rhs._error)).div(e)
            .add(ErrorEstimate.rounding_error(r, r.rounding_error_div()));
        return new Estimate(r, n);
        // Multiplication in denominator would have the wrong rounding mode
    }

    div_self (rhs: Estimate): this {
        let m = this.div(rhs);
        this._value = m._value;
        this._error = m._error;
        return this;
    }

    div_fast (rhs: number): Estimate {
        rhs = rhs | 0;
        if (rhs === 0) {
            throw new ExnPrecision(rhs);
        }
        let r = this._value.div(rhs);
        return new Estimate(r, this._error.div(ErrorEstimate.from_double(rhs))
            .add(ErrorEstimate.rounding_error(r, r.rounding_error_add())));
    }

    div_fast_self (rhs: number): this {
        let m = this.div_fast(rhs);
        this._value = m._value;
        this._error = m._error;
        return this;
    }

    // = lhs / this;
    div_by (lhs: number): Estimate {
        return this.recip().mul_fast(lhs);
    }

    shl (howmuch: number): Estimate {
        let v = this._value.shl(howmuch);
        let e = this._error.shl(howmuch)
            .add(ErrorEstimate.rounding_error(v, v.rounding_error_add()));
        return new Estimate(v, e);
    }

    shr (howmuch: number): Estimate {
        return this.shl(-howmuch);
    }


    // ----- Static Maths Functions -----

    static pi (prec: number): Estimate {
        if (this._cached_pi && this._cached_pi.precision >= prec) {
            return <Estimate>this._cached_pi;
        }
        prec = LongFloat.working_precision;
        let v = rpi(prec).recip();
        this._cached_pi = Object.freeze(v);
        return v;
    }

    static ln2 (prec: number): Estimate {
        if (this._cached_ln2 && this._cached_ln2.precision >= prec) {
            return <Estimate>this._cached_ln2;
        }
        prec = LongFloat.working_precision;
        let v = log_primary(E2);
        this._cached_ln2 = Object.freeze(v);
        return v;
    }

    static abs (arg: Estimate): Estimate {
        if (arg.is_positive()) {
            return arg;
        } else if (arg.is_negative()) {
            return arg.neg();
        }
        let a = arg.weak_is_positive() ? arg : arg.neg();
        a = a.add(a.get_error()).div_fast(2);
        return a.set_error(a);
    }

    static sq (arg: Estimate): Estimate {
        let ee2 = arg._error.mul(ErrorEstimate.from_longfloat(arg._value)).shl(1);
        let r = arg._value.sq();
        let e = arg._error.mul(arg._error).add_self(ee2);
        return new Estimate(r, e.add_self(
            ErrorEstimate.rounding_error(r, r.rounding_error_mul())));
    }

    static rsqrt (a: Estimate): Estimate {
        if (a.is_negative()) {
            throw new ExnDomain(a);
        }
        if (!a.is_positive()) {
            throw new ExnPrecision(a);
        }
        let arg = a.clone();
        let exp = arg.weak_normalize();
        if (exp & 1) {
            exp--;
        }
        let d = 1.0 / Math.sqrt(arg.shr(exp).weak_as_double());
        let ei = Estimate.from_double(d).shr(Math.trunc(exp / 2));
        return nr_iter(arg.div_fast(2), nrif_rsqrt, ei, 45 * 2 - 3);
        // This should not be needed!
        //   Estimate err(arg.GetError() / res);
        //   return res.AddError(err / ((res - err) * res));
    }

    // Separate function because of the handling of zeroes
    static sqrt (a: Estimate): Estimate {
        // Ignore the negative part
        let arg = a.truncate_negative();
        let exp = arg.weak_normalize();
        if (exp & 1) {
            exp--;
        }
        let d = 1.0 / Math.sqrt(arg.shr(exp).weak_as_double());
        let ei = Estimate.from_double(d).shr(Math.trunc(exp / 2));
        return arg.mul_self(nr_iter(arg.div_fast(2), nrif_rsqrt, ei, 45 * 2 - 3));
        // This should not be needed!
        //   if (arg.IsPositive()) {
        //       return res.AddError(arg.GetError() / res);
        //   } else {
        //       return res.SetError(res);
        //   }
    }

    static pow (arg: Estimate, pwr: number): Estimate {
        if (pwr < 0) {
            pwr = -pwr;
            arg = arg.recip();
        }
        let acc = E1.clone();
        while (pwr) {
            if (pwr & 1) {
                acc = acc.mul(arg);
            }
            pwr >>= 1;
            arg = this.sq(arg);
        }
        return acc;
    }

    static log (arg: Estimate): Estimate {
        if (arg.is_negative()) {
            throw new ExnDomain(arg);
        } else if (!arg.is_positive()) {
            throw new ExnPrecision(arg);
        }
        let l = this.ln2(arg.precision);
        let x = arg.clone();
        let e = x.weak_normalize();
        return log_primary(x.shr(e)).add_self(l.mul_fast(e));
    }

    static exp (arg: Estimate): Estimate {
        let l = this.ln2(arg.precision);
        let x = arg.div(l);
        // let de = arg.sub(x.mul(l));
        let e = x.weak_round();
        // DomainError?
        x.sub_self(e).mul_self(l);
        let y = exp_primary(x);
        return y.shl(e.weak_as_double() | 0);
    }

    static sin (arg: Estimate): Estimate {
        let pi2 = this.pi(arg.precision).mul_fast(2);
        let x = arg.div(pi2);
        x.sub_self(x.weak_round());
        if (!x.lt(SIN_C1) || !x.gt(SIN_C1m)) {
            // alternatively, we could just return [-1, 1]
            throw new ExnPrecision(arg);
        }
        if (x.weak_gt(E0_25)) {
            x = E0_5.sub(x);
        } else if (x.weak_lt(E_0_25)) {
            x = E_0_5.sub(x);
        }
        return sin_primary(x.mul(pi2));
    }

    private static cos_from_sin (arg: Estimate): Estimate {
        return this.sqrt(E1.sub(this.sq(arg)));
    }

    static cos (arg: Estimate): Estimate {
        return this.sin(this.pi(arg.precision).div_fast(2).sub_self(arg));
    }

    static tan (arg: Estimate): Estimate {
        let pi2 = this.pi(arg.precision).mul_fast(2);
        let x = arg.div(pi2);
        x.sub_self(x.weak_round());
        let negc = false;
        if (x.gt(E0_25)) {
            x = E0_5.sub(x);
            negc = true;
        } else if (!x.lt(E0_25)) {
            throw new ExnPrecision(arg);
        } else if (x.lt(E_0_25)) {
            x = E_0_5.sub(x);
            negc = true;
        } else if (!x.gt(E_0_25)) {
            throw new ExnPrecision(arg);
        }
        let s = sin_primary(x.mul(pi2));
        if (negc) {
            return s.neg().div(this.cos_from_sin(s));
        } else {
            return s.div(this.cos_from_sin(s));
        }
    }

    static asin (arg: Estimate): Estimate {
        let x = arg.truncate_to(-1, 1);
        // We still have a problem with the rsqrt if arg is close to one.
        // in this case, use the cos-sin identities
        if (x.weak_gt(ASIN_C1)) {
            return this.pi(arg.precision).div_fast(2).sub_self(asin_primary(this.cos_from_sin(x)));
        } else if (x.weak_lt(ASIN_C1m)) {
            return this.pi(arg.precision).div_fast(-2).add_self(asin_primary(this.cos_from_sin(x)));
        }
        return asin_primary(x);
    }

    static acos (arg: Estimate): Estimate {
        return this.pi(arg.precision).div_fast(2).sub_self(this.asin(arg));
    }

    static atan (arg: Estimate): Estimate {
        return this.asin(arg.mul(this.rsqrt(this.sq(arg).add_self(E1))))
    }

    static atan2 (y: Estimate, x: Estimate): Estimate {
        // This is atan with result over the full range depending on the signs of both
        // arguments. Normal atan takes care of the sign of y (the sine value). (0, 0) is
        // undefined, so we can just return 0 with error pi -- so that some complex
        // operations that use atan2 would work.
        let tpi = this.pi(x.precision);
        if (x.is_positive()) {
            return this.atan(y.div(x));
        } else if (x.is_negative()) {
            if (y.is_positive()) {
                return tpi.sub(this.atan(y.div(x.neg())));
            } else {
                return tpi.neg().sub_self(this.atan(y.div(x.neg())));
            }
        } else {
            // x cannot be distinguished from zero, but this does not stop us to give
            // estimates for the angle based on y and x's possible values
            if (y.is_positive()) {
                return tpi.div_fast(2).add_error(y.div(x.get_error().mul_fast(2)));
            } else if (y.is_negative()) {
                return tpi.div_fast(-2).add_error(y.div(x.get_error().mul_fast(2)));
            } else {
                return Estimate.from_double(0).set_error(tpi);
            }
        }
    }


    // ----- Error -----

    get_error (): Estimate {
        return new Estimate(this._error.as_longfloat());
    }

    set_error (val: Estimate): this {
        let ee = ErrorEstimate.from_longfloat(val._value);
        this._error = ee.add(val._error);
        return this;
    }

    set_error_zero (): this {
        this._error.mts = 0;
        this._error.exp = MINUS_INF;
        return this;
    }

    add_error (val: Estimate): this {
        this._error = (this._error.add(ErrorEstimate.from_longfloat(val._value))
            .add(val._error));
        return this;
    }

    // A lower bound on the correct binary digits.
    // - Uses the exponents of the value and error to calculate it quickly.
    get relative_error (): number {
        let ee = this._error.exp;
        let ev = this.weak_normalize();
        return $_i32saturated(ev - ee - 1);
    }

    // Among the weak operations is also rounding the returned Estimate is assumed exact
    // only to be used on periodic functions!
    weak_round (): Estimate {
        return new Estimate(this._value.round());
    }

    // Weak normalize, i.e. return an exponent such that,
    //  a >> a.weak_normalize() is in the range [0.5, 1).
    weak_normalize (): number {
        return this._value.normalize();
    }

    weak_center (): Estimate {
        return new Estimate(this._value, new ErrorEstimate());
    }


    // ----- Comparisons -----

    // These come in two flavors, Strong, and Weak
    // - Strong: is true if real is in relation to rhs
    // - Weak: is true if m_Value is in relation to rhs

    is_positive (): boolean {
        return (!this._value.is_negative() &&
            ErrorEstimate.from_longfloat(this._value).gt(this._error));
    }

    is_negative (): boolean {
        return (this._value.is_negative() &&
            ErrorEstimate.from_longfloat(this._value).gt(this._error));
    }

    is_non_zero (): boolean {
        return ErrorEstimate.from_longfloat(this._value).gt(this._error);
    }

    // Equality test is undecidable (i.e. would yield false for any precision)
    // - thus ==, <= and >= are not included
    // - also !(x<y) does not mean y<=x

    lt (rhs: Estimate): boolean {
        return this.sub(rhs).is_negative();
    }

    gt (rhs: Estimate): boolean {
        return this.sub(rhs).is_positive();
    }

    ne (rhs: Estimate): boolean {
        return this.sub(rhs).is_non_zero();
    }

    // Weak: (true if m_Value is in relation to rhs)
    //  should only be used if the transformation being applied would not differentiate on
    //  the two cases, e.g. to choose whether to evaluate sin(x) and sin(pi - x)

    weak_is_negative (): boolean {
        return this._value.kind === LFSpecial.Normal && this._value.is_negative();
    }

    weak_is_positive (): boolean {
        return this._value.kind === LFSpecial.Normal && !this._value.is_negative();
    }

    weak_is_non_zero (): boolean {
        // An Estimate cannot be weakly zero -- see the remark for `correct_zero'
        return true;
    }

    weak_lt (rhs: Estimate): boolean {
        return this._value < rhs._value;
    }

    weak_eq (rhs: Estimate): boolean {
        return this._value === rhs._value;
    }

    weak_gt (rhs: Estimate): boolean {
        return rhs.weak_lt(this);
    }

    weak_le (rhs: Estimate): boolean {
        return !this.weak_gt(rhs);
    }

    weak_ge (rhs: Estimate): boolean {
        return !this.weak_lt(rhs);
    }

    weak_ne (rhs: Estimate): boolean {
        return !this.weak_eq(rhs);
    }


    // ----- Conversions -----

    weak_as_double (): number {
        return this._value.as_double();
    }

    weak_as_decimal (buflen: number): string {
        return this._value.as_decimal(buflen);
    }


    // ----- Static constructors -----

    static from_double (v: number = 0): Estimate {
        return new Estimate(LongFloat.from_double(v));
    }

    static from_string (val: string): Estimate {
        let lf = LongFloat.from_string(val);
        let err = ErrorEstimate.rounding_error(lf, lf.rounding_error_div());
        return new Estimate(lf, err);
    }
}



// ----- Maths function helpers -----

type NewtonIterator = (arg: Estimate, est_out: Estimate, prec: number) => number;
type SeriesIterator = (arg: Estimate, workspace: Estimate, index: number) => Estimate;


// Newton-Raphson iterator
function nr_iter (arg: Estimate, iterf: NewtonIterator, est_out: Estimate, prec: number): Estimate {
    let targetprec = Math.trunc(arg.precision * 32) - 64;
    prec = Math.trunc(prec);
    while (prec < targetprec) {
        arg.precision = prec / 32 + 2;
        est_out.precision = prec / 32 + 2;
        est_out.set_error_zero();
        prec = iterf(arg, est_out, prec);
    }
    // This iteration should produce the actual error bound (caused by inexact functions
    // used in the iterations and the error in the input)
    arg.precision = targetprec / 32 + 2;
    est_out.precision = targetprec / 32 + 2;
    est_out.set_error_zero();
    //   let old: Estimate = est;
    prec = iterf(arg, est_out, prec);
    return est_out; //.add_error(old - est);
}

// Power series, summation
function ps_direct_iter (arg: Estimate, iterf: SeriesIterator, sum_out: Estimate
    , workspace: Estimate, indexstart: number, indexend: number): Estimate {
    for (let i = indexstart; i < indexend; ++i) {
        sum_out.add_self(iterf(arg, workspace, i));
    }
    return sum_out.add_error(workspace);
}

const nrif_rsqrt: NewtonIterator = (arg: Estimate, est_out: Estimate, prec: number) => {
    let ee = Estimate.sq(est_out).mul_self(arg);
    est_out.mul_self(E1_5.sub(ee));
    return prec * 2 - 3;
};


const psif_exp: SeriesIterator = (arg: Estimate, ws: Estimate, index: number) => {
    return ws.mul_self(arg).div_fast_self(index);
};

// For the primary interval [-1;1]
function exp_primary (arg: Estimate): Estimate {
    let i = Math.ceil(Math.sqrt(arg.precision * 32.0)) | 0;
    let x = arg.shr(i);
    let workspace = x.clone();
    let sum = x.add(E1);
    let indexend = i;
    ps_direct_iter(x, psif_exp, sum, workspace, 2, indexend);
    for (let k = 0; k < i; ++k) {
        sum.mul_self(sum);
    }
    return sum;
}

// Logarithm by exponent and newton
const nrif_ln = (arg: Estimate, est_out: Estimate, prec: number) => {
    let ex = exp_primary(est_out);
    est_out.add_self(arg.sub(ex).div(ex));
    return prec * 2 - 2;
};

// For the primary interval [1/e; e]
function log_primary (arg: Estimate): Estimate {
    let d = Math.log(arg.weak_as_double());
    return nr_iter(arg, nrif_ln, Estimate.from_double(d), 50 * 2 - 2);
}

// rpi: 1/pi
//   Using Borwein iterations that quadruple the number of correct digits at each step.
function rpi (prec: number): Estimate {
    let alpha = E2.sub(RPI_y.mul(E4));
    let one = E1;
    let y = one.sub(RPI_z).div(one.add(RPI_z));
    let oa = alpha;
    const sq = Estimate.sq;
    const sqrt = Estimate.sqrt;
    // alpha = sq(sq(y + one)) * alpha - 8 * y * (sq(y) + y + one);
    alpha = sq(sq(y.add(one))).mul(alpha).sub(
        Estimate.from_double(8.0).mul(y).mul(sq(y).add(y).add(one)));
    // OBS! This would not work if precision is greater that I32_MAX/128
    for (let i = 32; i < prec * 128; i *= 4) {
        let z = sqrt(sqrt(one.sub(sq(sq(y)))));
        y = one.sub(z).div(one.add(z));
        oa = alpha;
        alpha = sq(sq(y.add(one))).mul(alpha).sub(y.mul_fast(i).mul(sq(y).add(y).add(one)));
    }
    return alpha.add_error(alpha.sub(oa));
}

const psif_sin: SeriesIterator = (arg: Estimate, ws: Estimate, index: number) => {
    if (index < 30000) {
        return ws.mul_self(arg).div_fast_self(2 * index * (2 * index + 1));
    }
    return ws.mul_self(arg).div_fast_self(2 * index).div_fast_self(2 * index + 1);
};

// For the primary interval [-pi/2;pi/2]
function sin_primary (arg: Estimate) {
    // Here the strength reduction is done with base 3. This means about 20.1897521
    // reductions per 32-bit word. Additionally, 3^20 fits in u32, but not in i32, so use
    // 3^19 for the division factor (1162261467)
    let i = (Math.ceil(Math.sqrt(arg.precision * 20.2)) | 0) * 0.5;
    let j = (i % 19) | 0;
    let x = arg.div_fast(3 ** j);
    for (; j < i; j += 19) {
        x.div_fast_self(1162261467);
    }
    let sum = x.clone();
    let workspace = x.clone();
    let indexend = i * 2;
    ps_direct_iter(x.neg().mul(x), psif_sin, sum, workspace, 1, indexend);
    for (let k = 0; k < i; ++k) {
        sum.mul_self(E3.sub(E4.mul(sum).mul(sum)));
    }
    return sum;
}

// Arcsine by exponent and newton
const nrif_asin = (arg: Estimate, est_out: Estimate, prec: number) => {
    let ex = sin_primary(est_out);
    est_out.add_self(arg.sub(ex).mul(Estimate.rsqrt(E1.sub(Estimate.sq(ex)))));
    return prec * 2 - 2;
};

function asin_primary (arg: Estimate) {
    let d = Math.asin(arg.weak_as_double());
    return nr_iter(arg, nrif_asin, Estimate.from_double(d), 50 * 2 - 2);
}
