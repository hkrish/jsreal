import { current_kernel, IKernel } from "./kernels/kernel";
import { LFSpecial, LongFloat } from "./longfloat";

// Import some macros
//! import './macros/debug.jsmacro';
//! import './macros/jsreal.jsmacro';


// ErrorEstimate - A simple evaluation of error as 32-bit mantissa and 32-bit exponent.
//   Operations give results that are always greater than or equal to the actual result.
//   Note the exponent in a ErrorEstimate is in bits, not in words as in a LongFloat, and
//   the mantissa always has 1 in its most significant bit.


export enum RoundingMode {
    Down = 0,
    Up = 1,
};


const MINUS_INF = -0x7FFFFFFF;
const PLUS_INF = 0x7FFFFFFF;


export class ErrorEstimate {
    private static kernel: IKernel;
    private static kfns: WKernel;

    // error = mts * 2 ^ (exp - 32)
    // Mantissa, >= 2^31
    mts: number;        // uint32_t
    // Exponent, power of 2**32
    exp: number;        // int32_t

    constructor(mts: number = 0, exp: number = 0) {
        mts = $_lo32(mts);
        exp = exp | 0;
        if (mts === 0) {
            this.mts = mts;
            this.exp = MINUS_INF;
        } else {
            let lz = ErrorEstimate.kfns.clz(mts);
            this.mts = mts * (2 ** lz);
            this.exp = exp - lz;
        }
    }

    static initialize () {
        this.kernel = current_kernel();
        this.kfns = this.kernel.internal;
    }

    private set_mts (mts: number): this {
        mts = $_lo32(mts);
        let exp = this.exp;
        if (mts === 0) {
            this.mts = mts;
            this.exp = MINUS_INF;
        } else {
            let lz = ErrorEstimate.kfns.clz(mts);
            this.mts = mts * (2 ** lz);
            this.exp = exp - lz;
        }
        return this;
    }

    clone (): ErrorEstimate {
        return new ErrorEstimate(this.mts, this.exp);
    }


    // ----- Helpers -----

    // Add mantissas of ErrorEstimates, round up
    static do_ee_mts_add (full: number, part: number, start: number): [number, boolean] {
        let mmts;
        if (start >= 32) {
            mmts = ++full;
        } else {
            // See if we need to round up
            if (part & ((2 ** start) - 1)) {
                part = (part >>> start) + 1;
            } else {
                part = (part >>> start);
            }
            mmts = full + part;
        }
        // true, if we have carry
        return [$_lo32(mmts), ($_hi32(mmts) !== 0)];
    }


    // ----- Arithmetic -----

    // Round-up addition
    add_self (rhs: ErrorEstimate): this {
        let mts: number;
        let exp: number;
        let carry: boolean;
        // Handle special cases
        if (this.exp >= PLUS_INF || rhs.exp <= MINUS_INF) {
            return this;
        } else if (rhs.exp >= PLUS_INF || this.exp <= MINUS_INF) {
            this.exp = rhs.exp;
            this.set_mts(rhs.mts);
            return this;
        }
        // Do addition
        if (this.exp === rhs.exp) {
            exp = this.exp;
            mts = this.mts + rhs.mts;
            carry = true;
        } else if (this.exp > rhs.exp) {
            exp = this.exp;
            [mts, carry] = ErrorEstimate.do_ee_mts_add(this.mts, rhs.mts, this.exp - rhs.exp);
        } else {
            exp = rhs.exp;
            [mts, carry] = ErrorEstimate.do_ee_mts_add(rhs.mts, this.mts, rhs.exp - this.exp);
        }
        // Update if carry
        if (carry) {
            if (mts & 1) {
                ++mts;
            }
            mts = (mts >>> 1) | (2 ** 31);
            exp = exp + 1;
        }
        this.exp = rhs.exp;
        this.set_mts(rhs.mts);
        return this;
    }

    // Round-up addition
    add (rhs: ErrorEstimate): ErrorEstimate {
        let mts: number;
        let exp: number;
        let carry: boolean;
        // Handle special cases
        if (this.exp >= PLUS_INF || rhs.exp <= MINUS_INF) {
            return this;
        } else if (rhs.exp >= PLUS_INF || this.exp <= MINUS_INF) {
            this.mts = rhs.mts;
            this.exp = rhs.exp;
            return this;
        }
        // Do addition
        if (this.exp === rhs.exp) {
            exp = this.exp;
            mts = this.mts + rhs.mts;
            carry = true;
        } else if (this.exp > rhs.exp) {
            exp = this.exp;
            [mts, carry] = ErrorEstimate.do_ee_mts_add(this.mts, rhs.mts, this.exp - rhs.exp);
        } else {
            exp = rhs.exp;
            [mts, carry] = ErrorEstimate.do_ee_mts_add(rhs.mts, this.mts, rhs.exp - this.exp);
        }
        // Update if carry
        if (carry) {
            if (mts & 1) {
                ++mts;
            }
            mts = (mts >>> 1) | (2 ** 31);
            exp = exp + 1;
        }
        return new ErrorEstimate(mts, exp);
    }

    // Round-down subtraction
    sub (rhs: ErrorEstimate): ErrorEstimate {
        // Handle special cases
        if (this.exp >= PLUS_INF || rhs.exp <= MINUS_INF) {
            return this;
        } else if (rhs.exp >= PLUS_INF || this.exp <= MINUS_INF) {
            return rhs;
        }
        // Errors are always positive, a negative result would mean error
        $_dassert(this.exp >= rhs.exp, "errors must always be positive");
        let full = this.mts;
        let part = rhs.mts;
        let start = this.exp - rhs.exp;
        let exp = this.exp;
        let mmts;
        if (start >= 32) {
            mmts = --full;
        } else {
            if (start > 0) {
                if (part & (2 ** start - 1)) {
                    part = (part >>> start) + 1;
                } else {
                    part = (part >>> start);
                }
            }
            mmts = full - part;
        }
        $_dassert($_lo32(mmts) <= full, 'mts <= full');
        return new ErrorEstimate(mmts, exp);
    }

    // Round-up multiplication
    mul (rhs: ErrorEstimate): ErrorEstimate {
        let e = ((this.exp | 0) + (rhs.exp | 0) - 1) | 0;
        // Handle overflow and special cases
        if (this.exp >= PLUS_INF || rhs.exp >= PLUS_INF || e >= PLUS_INF) {
            return new ErrorEstimate(0, PLUS_INF);
        } else if (this.exp <= MINUS_INF || rhs.exp <= MINUS_INF || e <= MINUS_INF) {
            return new ErrorEstimate(0, MINUS_INF);
        }
        // Multiply. the result will at least have 1 in 62nd position at most 1 in 63rd
        e = ErrorEstimate.kfns.ee_mul(this.mts, rhs.mts, e, 0);
        let mts = ErrorEstimate.kernel.mem_u32[0];
        return new ErrorEstimate(mts, e);
    }

    // Round-up <<
    shl (howmuch: number): ErrorEstimate {
        // Just add to exponent saturating
        let e = (this.exp | 0) + (howmuch | 0);
        return new ErrorEstimate(this.mts, $_i32saturated(e));
    }

    // Round-up reciprocal
    recip (): ErrorEstimate {
        if (this.exp >= PLUS_INF) {
            return new ErrorEstimate(0, MINUS_INF);
        } else if (this.exp <= (MINUS_INF + 2)) {
            return new ErrorEstimate(0, PLUS_INF);
        }
        // Calculate
        let exp = -(this.exp - 2);
        let mts = ErrorEstimate.kfns.ee_recip(this.mts);
        return new ErrorEstimate(mts, exp);
    }

    // Round-up division
    div (rhs: ErrorEstimate): ErrorEstimate {
        return this.mul(rhs.recip());
    }

    inc (): this {
        let mts = $_lo32(this.mts + 1);
        if (mts === 0) {
            mts = 2 ** 31;
            this.exp = (this.exp + 1) | 0;
        }
        this.mts = mts;
        return this;
    }


    // ----- Conversions -----

    as_double (): number {
        // this can very easily over or underflow
        let mts = (this.exp >= PLUS_INF) ? 1.0 : this.mts;
        return $_ldexp(mts, this.exp - 32);
    }

    as_longfloat (): LongFloat {
        // m_Man is u32, so we can't use LongFloat's i32 constructor go through double,
        // but separate the exponent to a remainder which can safely be applied to a
        // double, and a quotient which can very quickly be added to a
        // LongFloat's exponent.
        let expq = this.exp >>> 5;
        let expr = this.exp - (expq << 5);
        return (LongFloat.from_double($_ldexp(this.mts, expr))
            .add_to_exponent_self(expq - 1));
    }


    // ----- Comparisons -----

    // >= operator
    ge (rhs: ErrorEstimate): boolean {
        if (this.exp > rhs.exp) {
            return true;
        } else if ((this.exp === rhs.exp) && ((this.exp >= PLUS_INF)
            || (this.exp <= MINUS_INF) || (this.mts >= rhs.mts))) {
            return true;
        }
        return false;
    }

    // > operator
    gt (rhs: ErrorEstimate): boolean {
        if (this.exp > rhs.exp) {
            return true;
        } else if ((this.exp === rhs.exp) && ((this.exp < PLUS_INF)
            && (this.exp > MINUS_INF) && (this.mts > rhs.mts))) {
            return true;
        }
        return false;
    }

    static max (a: ErrorEstimate, b: ErrorEstimate): ErrorEstimate {
        return a.ge(b) ? a : b;
    }

    static min (a: ErrorEstimate, b: ErrorEstimate): ErrorEstimate {
        return a.ge(b) ? b : a;
    }

    // rounding error is assumed to be no more than one in the least significant bit of
    // the mantissa Note! Newton-Raphson reciprocal is incorrect in the least significant
    // word (handled by recip())
    static rounding_error (lf: LongFloat, re: number): ErrorEstimate {
        let exp = (lf.exponent | 0) * 32 + re + 1;
        if (exp <= MINUS_INF) {
            return new ErrorEstimate(0, MINUS_INF);
        } else if (exp >= PLUS_INF) {
            return new ErrorEstimate(0, PLUS_INF);
        } else {
            return new ErrorEstimate(2 ** 31, exp);
        }
    }


    // ----- Static constructors -----

    // Rounds up
    static from_double (err: number): ErrorEstimate {
        if (err === 0) {
            return new ErrorEstimate(0, MINUS_INF);
        } else if (Number.isFinite(err)) {
            // Split mantissa and exponent
            let mts = this.kfns.frexp(Math.abs(err), 0);
            mts = $_lo32(Math.trunc($_ldexp(mts, 32) + 1));
            let exp = this.kernel.mem_i32[0];
            // Correct for possible overflow
            if (mts === 0) {
                mts = 2 ** 31;
                ++exp;
            }
            return new ErrorEstimate(mts, exp);
        } else {
            return new ErrorEstimate(0, PLUS_INF);
        }
    }

    // Rounds up by default
    static from_longfloat (src: LongFloat, rmode: RoundingMode = RoundingMode.Up): ErrorEstimate {
        switch (src.kind) {
            case LFSpecial.Normal:
                // Convert mantissa to double to extract the 32 most significant bits
                let exp = src.exponent * 32;
                let mts = src.mantissa_as_double();
                mts = this.kfns.frexp(Math.abs(mts), 0);
                mts = $_lo32(Math.trunc($_ldexp(mts, 32) + rmode));
                exp += this.kernel.mem_i32[0];
                // Correct for possible overflow
                if (mts === 0) {
                    mts = 2 ** 31;
                    ++exp;
                }
                return new ErrorEstimate(mts, $_i32saturated(exp));
            case LFSpecial.Zero:
                return new ErrorEstimate(0, MINUS_INF);
            default:
                return new ErrorEstimate(0, PLUS_INF);
        }
    }
}
