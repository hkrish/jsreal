// import { Convolution } from "./convolution";
// // import { IReal } from "./base-real";

// //! import './macros/debug.jsmacro';
// //! import './macros/jsreal.jsmacro';


// // convolution object for generic IReal types
// // c.f. convolution.ts for interface


// export class ConvolutionT<T extends IReal> extends Convolution<T>{

//     constructor(size: number, pi2: T) {
//         super(size);
//         let bits = (Math.log2(size) + 0.5) | 0;
//         const hs = size / 2;
//         for (let i = 0; i < hs; ++i) {
//             const tmp = i / size;
//             this.weights[$_reidx(i)] = <T>pi2.scale(tmp).cos();
//             this.weights[$_imidx(i)] = <T>pi2.scale(tmp).sin().neg();
//             this.br[i] = Convolution.bit_reverse(i, bits - 1, size / 2);
//         }
//     }

//     // In-place convolution.
//     // - argument `a' will contain the result.
//     // - argument `b' will be used as working space.
//     convolve (a: T[], b: T[], size = 0): void {
//         if (size === 0) {
//             size = this.size;
//         }
//         // forward ffts. remember rc multiplies both by additional factor of 2
//         const wstride = (this.size / size) | 0;
//         $_dbassert(wstride > 0);
//         ConvolutionT.fft_fwd_ip_rc(size, this.weights, this.br, a, wstride);
//         ConvolutionT.fft_fwd_ip_rc(size, this.weights, this.br, b, wstride);
//         // DC and Nyguest share one complex value
//         // should be multiplied separately
//         let tmp = 1.0 / (size * 4);
//         a[0] = <T>a[0].mul(b[0].scale(tmp));
//         a[1] = <T>a[1].mul(b[1].scale(tmp));
//         ConvolutionT.mul_complex(1, (size / 2) | 0, a, b, tmp);
//         // inverse fft
//         ConvolutionT.fft_inv_ip_cr(size, this.weights, this.br, a, wstride);
//     }

//     // multiply two complex vectors, in-place
//     private static mul_complex<T extends IReal> (sidx: number, size: number
//         , a: T[], b: T[], scale: number) {
//         //--
//         for (let i = sidx; i < size; ++i) {
//             let ri = $_reidx(i);
//             let ii = $_imidx(i);
//             let re = a[ri].mul(b[ri]).sub(a[ii].mul(b[ii]));
//             let im = a[ri].mul(b[ii]).add(a[ii].mul(b[ri]));
//             a[ri] = <T>re.scale(scale);
//             a[ii] = <T>im.scale(scale);
//         }
//     }


//     // gentleman-sande decimation-in-frequency forward in-place fft
//     private static fft_fwd_ip<T extends IReal> (size: number, weights: T[]
//         , a: T[], wstride: number): void {
//         //--
//         // TODO: After testing, extract reidx imidx variables
//         for (let L = size; L > 1; L >>= 1) {
//             let r = size / L;
//             let L2 = L >> 1;
//             for (let j = 0; j < L2; ++j) {
//                 let wr = weights[$_reidx(j * r * wstride)];
//                 let wi = weights[$_imidx(j * r * wstride)];
//                 for (let k = 0; k < r; ++k) {
//                     let cr = a[$_reidx(k * L + j)];
//                     let ci = a[$_imidx(k * L + j)];
//                     let dr = a[$_reidx(k * L + L2 + j)];
//                     let di = a[$_imidx(k * L + L2 + j)];
//                     a[$_reidx(k * L + j)] = <T>cr.add(dr);
//                     a[$_imidx(k * L + j)] = <T>ci.add(di);
//                     cr = <T>cr.sub(dr);
//                     ci = <T>ci.sub(di);
//                     a[$_reidx(k * L + L2 + j)] = <T>wr.mul(cr).sub(wi.mul(ci));
//                     a[$_imidx(k * L + L2 + j)] = <T>wr.mul(ci).add(wi.mul(cr));
//                 }
//             }
//         }
//         // permutation is skipped
//     }

//     // cooley-tukey decimation-in-time inverse in-place fft
//     private static fft_inv_ip<T extends IReal> (size: number, weights: T[], a: T[]
//         , wstride: number): void {
//         //--
//         // TODO: After testing, extract reidx imidx variables
//         // permutation is skipped
//         for (let L = 2; L <= size; L <<= 1) {
//             let r = size / L;
//             let L2 = L / 2;
//             for (let j = 0; j < L2; ++j) {
//                 let wr = weights[$_reidx(j * r * wstride)];
//                 let wi = weights[$_imidx(j * r * wstride)].neg(); // inverse
//                 for (let k = 0; k < r; ++k) {
//                     let cr = a[$_reidx(k * L + j)];
//                     let ci = a[$_imidx(k * L + j)];
//                     let dr = a[$_reidx(k * L + L2 + j)];
//                     let di = a[$_imidx(k * L + L2 + j)];
//                     let tr = <T>wr.mul(dr).sub(wi.mul(di));
//                     let ti = <T>wr.mul(di).add(wi.mul(dr));
//                     a[$_reidx(k * L + j)] = <T>cr.add(tr);
//                     a[$_imidx(k * L + j)] = <T>ci.add(ti);
//                     a[$_reidx(k * L + L2 + j)] = <T>cr.sub(tr);
//                     a[$_imidx(k * L + L2 + j)] = <T>ci.sub(ti);
//                 }
//             }
//         }
//     }

//     // real-to-complex step after fft_fwd
//     //  the result is multiplied by 2
//     private static fft_realtocomplex<T extends IReal> (size: number, weights: T[]
//         , br: number[], a: T[], wstride: number): void {
//         //--
//         // TODO: After testing, extract reidx imidx variables
//         let size2 = size / 2;
//         // calculate DC and Nyguest (the value at the center frequency) both are real
//         // numbers, to avoid needing extra space they share one complex point
//         let pr = a[$_reidx(0)];
//         let pi = a[$_imidx(0)];
//         a[$_reidx(0)] = <T>pr.add(pi).scale(2.0);
//         a[$_imidx(0)] = <T>pr.sub(pi).scale(2.0);
//         // this is in the middle, bitreverse(size/2) == 1
//         let mr = a[$_reidx(1)];
//         let mi = a[$_imidx(1)];
//         a[$_reidx(1)] = <T>mr.scale(2.0);
//         a[$_imidx(1)] = <T>mi.scale(-2.0);
//         // from here on, indexes are retrieved bit-reversed
//         //  br(i*wstride) is the proper br(i) when the size is divided by wstride
//         for (let i = wstride, j = (size - 1) * wstride; i < size2 * wstride;
//             (i += wstride), (j -= wstride)) {
//             pr = <T>a[$_reidx(br[i])].add(a[$_reidx(br[j])]);
//             pi = <T>a[$_imidx(br[i])].add(a[$_imidx(br[j])]);
//             mr = <T>a[$_reidx(br[i])].sub(a[$_reidx(br[j])]);
//             mi = <T>a[$_imidx(br[i])].sub(a[$_imidx(br[j])]);
//             a[$_reidx(br[i])] =
//                 <T>pr.add(weights[$_reidx(i)].mul(pi)).add(weights[$_imidx(i)].mul(mr));
//             a[$_imidx(br[i])] =
//                 <T>mi.sub(weights[$_reidx(i)].mul(mr)).add(weights[$_imidx(i)].mul(pi));
//             a[$_reidx(br[j])] =
//                 <T>pr.sub(weights[$_reidx(i)].mul(pi)).sub(weights[$_imidx(i)].mul(mr));
//             a[$_imidx(br[j])] =
//                 <T>weights[$_imidx(i)].mul(pi).sub(mi).sub(weights[$_reidx(i)].mul(mr));
//         }
//     }

//     // complex-to-real step before fft_inv
//     private static fft_complextoreal<T extends IReal> (size: number, weights: T[]
//         , br: number[], a: T[], wstride: number): void {
//         //--
//         // TODO: After testing, extract reidx imidx variables
//         let size2 = size / 2;
//         // DC and Nyquest were calculated using a different formula
//         let pr = a[$_reidx(0)];
//         let pi = a[$_imidx(0)];
//         a[$_reidx(0)] = <T>pr.add(pi);
//         a[$_imidx(0)] = <T>pr.sub(pi);
//         // this is in the middle, bitreverse(size/2) == 1
//         let mr = a[$_reidx(1)];
//         let mi = a[$_imidx(1)];
//         a[$_reidx(1)] = <T>mr.scale(2.0);
//         a[$_imidx(1)] = <T>mi.scale(-2.0);
//         // from here on, indexes are retrieved bit-reversed
//         for (let i = wstride, j = (size - 1) * wstride; i < size2 * wstride;
//             (i += wstride), (j -= wstride)) {
//             pr = <T>a[$_reidx(br[i])].add(a[$_reidx(br[j])]);
//             pi = <T>a[$_imidx(br[i])].sub(a[$_imidx(br[j])]);
//             mi = <T>a[$_reidx(br[i])].sub(a[$_reidx(br[j])]);
//             mr = <T>a[$_imidx(br[i])].add(a[$_imidx(br[j])]);
//             let zr = mr.mul(weights[$_reidx(i)]).sub(mi.mul(weights[$_imidx(i)]));
//             let zi = mi.mul(weights[$_reidx(i)]).add(mr.mul(weights[$_imidx(i)]));
//             a[$_reidx(br[i])] = <T>pr.sub(zr);
//             a[$_imidx(br[i])] = <T>pi.add(zi);
//             a[$_reidx(br[j])] = <T>pr.add(zr);
//             a[$_imidx(br[j])] = <T>zi.sub(pi);
//         }
//     }

//     private static fft_fwd_ip_rc<T extends IReal> (size: number, weights: T[]
//         , br: number[], a: T[], wstride: number): void {
//         //--
//         // perform a complex-to-complex fft on the data
//         this.fft_fwd_ip(size / 2, weights, a, 2 * wstride);
//         // then use an additional step to get the actual result
//         this.fft_realtocomplex(size / 2, weights, br, a, wstride);
//     }

//     private static fft_inv_ip_cr<T extends IReal> (size: number, weights: T[]
//         , br: number[], a: T[], wstride: number): void {
//         //--
//         // revert the operation of fft_realtocomplex
//         this.fft_complextoreal(size / 2, weights, br, a, wstride);
//         // perform a complex-to-complex fft
//         this.fft_inv_ip(size / 2, weights, a, 2 * wstride);
//     }

// }
