

declare global {
    type Maybe<T> = T | null | undefined;

    type Mantissa = Uint32Array;
}


// direct multiplication will be used for precisions below this threshold and convolution
// for larger precision.
export const CONVOLUTION_THRESHOLD = 60;

// without this the system will not limit its recursion depth
// may run slightly faster but will probably cause errors
// for longer computations on the class Real
// recommended to keep this on
export const EVALUATION_DEPTH = 500;
