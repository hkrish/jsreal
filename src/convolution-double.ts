import { Convolution } from "./convolution";

//! import './macros/debug.jsmacro';
//! import './macros/jsreal.jsmacro';


// convolution object for JavaScript number type (Float64)
// c.f. convolution.ts for interface


export class ConvolutionDouble extends Convolution<number> {

    constructor(size: number, pi2?: number) {
        pi2 = (pi2 == null) ? (Math.PI * 2) : pi2;
        super(size);
        const hs = size / 2;
        let bits = (Math.log2(size) + 0.5) | 0;
        for (let i = 0; i < hs; ++i) {
            const tmp = i / size;
            this.weights[$_reidx(i)] = Math.cos(pi2 * tmp);
            this.weights[$_imidx(i)] = -Math.sin(pi2 * tmp);
            this.br[i] = Convolution.bit_reverse(i, bits - 1, size / 2);
        }
    }

    // In-place convolution.
    // - argument `a' will contain the result.
    // - argument `b' will be used as working space.
    convolve (a: number[], b: number[], size = 0): void {
        if (size === 0) {
            size = this.size;
        }
        // forward ffts. remember rc multiplies both by additional factor of 2
        const wstride = (this.size / size) | 0;
        $_dbassert(wstride > 0);
        ConvolutionDouble.fft_fwd_ip_rc(size, this.weights, this.br, a, wstride);
        ConvolutionDouble.fft_fwd_ip_rc(size, this.weights, this.br, b, wstride);
        // DC and Nyquist share one complex value
        // should be multiplied separately
        let tmp = 1.0 / (size * 4);
        a[0] *= b[0] * tmp;
        a[1] *= b[1] * tmp;
        ConvolutionDouble.mul_complex(1, size / 2, a, b, tmp);
        // inverse fft
        ConvolutionDouble.fft_inv_ip_cr(size, this.weights, this.br, a, wstride);
    }

    // multiply two complex vectors, in-place
    private static mul_complex (sidx: number, size: number, a: number[], b: number[]
        , scale: number) {
        //--
        for (let i = sidx; i < size; ++i) {
            let ri = $_reidx(i);
            let ii = $_imidx(i);
            let re = a[ri] * b[ri] - a[ii] * b[ii];
            let im = a[ri] * b[ii] + a[ii] * b[ri];
            a[ri] = re * scale;
            a[ii] = im * scale;
        }
    }

    // Gentleman-Sande decimation-in-frequency forward in-place fft
    private static fft_fwd_ip (size: number, weights: number[], a: number[]
        , wstride: number): void {
        //--
        // TODO: After testing, extract reidx imidx variables
        for (let L = size | 0; L > 1; L >>= 1) {
            let r = (size / L) | 0;
            let L2 = L >> 1;
            for (let j = 0 | 0; j < L2; ++j) {
                let wr = weights[$_reidx(j * r * wstride)];
                let wi = weights[$_imidx(j * r * wstride)];
                for (let k = 0 | 0; k < r; ++k) {
                    let ireklj = $_reidx(k * L + j);
                    let iimklj = $_imidx(k * L + j);
                    let irekl2j = $_reidx(k * L + L2 + j);
                    let iimkl2j = $_imidx(k * L + L2 + j);
                    let cr = a[ireklj];
                    let ci = a[iimklj];
                    let dr = a[irekl2j];
                    let di = a[iimkl2j];
                    a[ireklj] = cr + dr;
                    a[iimklj] = ci + di;
                    cr -= dr;
                    ci -= di;
                    a[irekl2j] = wr * cr - wi * ci;
                    a[iimkl2j] = wr * ci + wi * cr;
                }
            }
        }
        // permutation is skipped
    }

    // cooley-tukey decimation-in-time inverse in-place fft
    private static fft_inv_ip (size: number, weights: number[], a: number[]
        , wstride: number): void {
        //--
        // TODO: After testing, extract reidx imidx variables
        // permutation is skipped
        for (let L = 2; L <= size; L <<= 1) {
            let r = size / L;
            let L2 = L / 2;
            for (let j = 0; j < L2; ++j) {
                let wr = weights[$_reidx(j * r * wstride)];
                let wi = -weights[$_imidx(j * r * wstride)]; // inverse
                for (let k = 0; k < r; ++k) {
                    let cr = a[$_reidx(k * L + j)];
                    let ci = a[$_imidx(k * L + j)];
                    let dr = a[$_reidx(k * L + L2 + j)];
                    let di = a[$_imidx(k * L + L2 + j)];
                    let tr = wr * dr - wi * di;
                    let ti = wr * di + wi * dr;
                    a[$_reidx(k * L + j)] = cr + tr;
                    a[$_imidx(k * L + j)] = ci + ti;
                    a[$_reidx(k * L + L2 + j)] = cr - tr;
                    a[$_imidx(k * L + L2 + j)] = ci - ti;
                }
            }
        }
    }

    // real-to-complex step after fft_fwd
    //  the result is multiplied by 2
    private static fft_realtocomplex (size: number, weights: number[], br: number[], a: number[]
        , wstride: number): void {
        //--
        // TODO: After testing, extract reidx imidx variables
        let size2 = size / 2;
        // calculate DC and Nyquist (the value at the center frequency) both are real
        // numbers, to avoid needing extra space they share one complex point
        let pr = a[$_reidx(0)];
        let pi = a[$_imidx(0)];
        a[$_reidx(0)] = (pr + pi) * 2.0;
        a[$_imidx(0)] = (pr - pi) * 2.0;
        // this is in the middle, bitreverse(size/2) == 1
        let mr = a[$_reidx(1)];
        let mi = a[$_imidx(1)];
        a[$_reidx(1)] = mr * 2.0;
        a[$_imidx(1)] = mi * -2.0;
        // from here on, indexes are retrieved bit-reversed
        //  br(i*wstride) is the proper br(i) when the size is divided by wstride
        for (let i = wstride, j = (size - 1) * wstride; i < size2 * wstride;
            (i += wstride), (j -= wstride)) {
            pr = a[$_reidx(br[i])] + a[$_reidx(br[j])];
            pi = a[$_imidx(br[i])] + a[$_imidx(br[j])];
            mr = a[$_reidx(br[i])] - a[$_reidx(br[j])];
            mi = a[$_imidx(br[i])] - a[$_imidx(br[j])];
            a[$_reidx(br[i])] =
                pr + weights[$_reidx(i)] * pi + weights[$_imidx(i)] * mr;
            a[$_imidx(br[i])] =
                mi - weights[$_reidx(i)] * mr + weights[$_imidx(i)] * pi;
            a[$_reidx(br[j])] =
                pr - weights[$_reidx(i)] * pi - weights[$_imidx(i)] * mr;
            a[$_imidx(br[j])] =
                -mi - weights[$_reidx(i)] * mr + weights[$_imidx(i)] * pi;
        }
    }

    // complex-to-real step before fft_inv
    private static fft_complextoreal (size: number, weights: number[], br: number[], a: number[]
        , wstride: number): void {
        //--
        // TODO: After testing, extract reidx imidx variables
        let size2 = size / 2;
        // DC and Nyquist were calculated using a different formula
        let pr = a[$_reidx(0)];
        let pi = a[$_imidx(0)];
        a[$_reidx(0)] = (pr + pi);
        a[$_imidx(0)] = (pr - pi);
        // this is in the middle, bitreverse(size/2) == 1
        let mr = a[$_reidx(1)];
        let mi = a[$_imidx(1)];
        a[$_reidx(1)] = mr * 2.0;
        a[$_imidx(1)] = mi * -2.0;
        // from here on, indexes are retrieved bit-reversed
        for (let i = wstride, j = (size - 1) * wstride; i < size2 * wstride;
            (i += wstride), (j -= wstride)) {
            pr = a[$_reidx(br[i])] + a[$_reidx(br[j])];
            pi = a[$_imidx(br[i])] - a[$_imidx(br[j])];
            mi = a[$_reidx(br[i])] - a[$_reidx(br[j])];
            mr = a[$_imidx(br[i])] + a[$_imidx(br[j])];
            let zr = mr * weights[$_reidx(i)] - mi * weights[$_imidx(i)];
            let zi = mi * weights[$_reidx(i)] + mr * weights[$_imidx(i)];
            a[$_reidx(br[i])] = pr - zr;
            a[$_imidx(br[i])] = pi + zi;
            a[$_reidx(br[j])] = pr + zr;
            a[$_imidx(br[j])] = zi - pi;
        }
    }

    private static fft_fwd_ip_rc (size: number, weights: number[], br: number[], a: number[]
        , wstride: number): void {
        //--
        // perform a complex-to-complex fft on the data
        this.fft_fwd_ip(size / 2, weights, a, 2 * wstride);
        // then use an additional step to get the actual result
        this.fft_realtocomplex(size / 2, weights, br, a, wstride);
    }

    private static fft_inv_ip_cr (size: number, weights: number[], br: number[], a: number[]
        , wstride: number): void {
        //--
        // revert the operation of fft_realtocomplex
        this.fft_complextoreal(size / 2, weights, br, a, wstride);
        // perform a complex-to-complex fft
        this.fft_inv_ip(size / 2, weights, a, 2 * wstride);
    }
}
