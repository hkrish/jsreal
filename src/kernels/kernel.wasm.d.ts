
interface WKernel {
    memory: WebAssembly.Memory;

    ConvMaxSize: WebAssembly.Global;
    offset_arg: WebAssembly.Global;
    offset_scratch: WebAssembly.Global;
    offset_cwei: WebAssembly.Global;
    offset_cbr: WebAssembly.Global;
    offset_kernsc: WebAssembly.Global;
    memory_pages: WebAssembly.Global;
    kernel_precision: WebAssembly.Global;
    CVSz: WebAssembly.Global;
    convolution_threshold: WebAssembly.Global;

    initialize (precision: number): number;

    mantissa_normalize (manidx: number): number;

    mantissa_add (manidx: number, fullidx: number, partidx: number
        , start: number): number;

    adjust_for_carry (manidx: number, msw: number): number;

    mantissa_sub (manidx: number, fullidx: number, partidx: number
        , start: number): number;

    mantissa_neg (manidx: number): void;

    mantissa_mul (manidx: number, aidx: number, bidx: number, instart: number
        , inlen: number): number;

    is_multiplied_by_convolution (inlen: number): number;

    mantissa_div (manidx: number, aidx: number, bidx: number, instart: number
        , inlen: number, temp1idx: number, temp2idx: number): number;

    mantissa_scale (manidx: number, srcidx: number, multiplier: number): number;

    mantissa_invscale (manidx: number, srcidx: number, divisor: number): number;

    mantissa_bscale (manidx: number, srcidx: number, scale: number): number;

    convolve (aidx: number, bidx: number, size: number): void;
}
