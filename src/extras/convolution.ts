//! import '../macros/debug.jsmacro';
//! import '../macros/jsreal.jsmacro';


// real convolution object
//
// - `size' is the convolution size: for kernel length N and signal length M, (N + M - 1)
// - the inputs to Convolve are of length `size', padded with 0.
// - the output of Convolve is in a; b is destroyed.
//
// this object works only on size = 2 ^ k for an integer k


export abstract class Convolution<T> {
    protected weights: T[];     // pre-computed weights vector (exp(jpi2 * i/size))
    protected br: number[];     // pre-computed bit-reversed vector
    size: number;               // size of the operation

    constructor(size: number) {
        // verify size is correct. should be a power of 2
        $_dassert((size & (size - 1)) === 0, '');
        this.size = size;
        this.weights = new Array<T>(size * 2);
        const hs = size / 2;
        this.br = new Array(hs);
    }

    // In-place convolution.
    // - argument `a' will contain the result.
    // - argument `b' will be used as working space.
    convolve (_a: T[], _b: T[], _size: number): void { }

    // returns the reversed bits of z for size = 2 ^ bits
    protected static bit_reverse (z: number, bits: number, size: number): number {
        let r = 0 | 0;
        for (let i = 0; i < bits; ++i) {
            size >>= 1;
            if (z & 1)
                r += size;
            z >>= 1;
        }
        return r;
    }

}
