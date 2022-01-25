const jsreal = require("../dist/jsreal.umd.js");
const data = require('./data/conv.test-data.js');
const { test_start_module, test_print_summary, test_print_summary_on_exit,
        $time, check, CurrentTestEnv } = require('../tools/tester.js');


const ConvolutionDouble = jsreal.ConvolutionDouble;


let actualresults = {
    weights: [],
    input_128: [],
    fft_fwd_ip: [],
    fft_inv_ip: [],
    fft_fwd_ip_rc: [],
    fft_inv_ip_cr: [],
    convolve: []
};

const size = 128;
let conv;
const inp = new Array(size * 2);
const tol = 1e-11;

const id = i => i;
const reidx = i => (i * 2);
const imidx = i => (i * 2 + 1);


function store_result1 (size, dst, src, f=id, idx=id) {
    for (let i = 0; i < size; ++i) {
        dst.push(f(src[idx(i)]));
    }
}

function store_result2 (size, dst, src, f=id, ridx=reidx, iidx=imidx) {
    for (let i = 0; i < size; ++i) {
        dst.push([f(src[ridx(i)]), f(src[iidx(i)])]);
    }
}

function store_result3 (size, dst, idx, src, f=id, ridx=reidx, iidx=imidx) {
    f = (f == null) ? a => a : f;
    for (let i = 0; i < size; ++i) {
        dst.push([idx[i], f(src[ridx(i)]), f(src[iidx(i)])]);
    }
}

const test = test_start_module(`Convolution (JavaScript) tests`);


conv = new ConvolutionDouble(size * 2, Math.PI * 2);
for (let i = 0; i < size; ++i) {
    inp[reidx(i)] = i + 1;
    inp[imidx(i)] = -i;
}
store_result2(size, actualresults.input_128, inp);
store_result2(size, actualresults.weights, conv.weights);

// Forward FFT
ConvolutionDouble.fft_fwd_ip(size, conv.weights, inp, 2);
const breidx = i => reidx(conv.br[i]);
const bimidx = i => imidx(conv.br[i]);
store_result3(size, actualresults.fft_fwd_ip, conv.br, inp, id, breidx, bimidx);

// Inverse FFT
ConvolutionDouble.fft_inv_ip(size, conv.weights, inp, 2);
const fscalesize = a => a / size;
store_result2(size, actualresults.fft_inv_ip, inp, fscalesize);

// Forward FFT: complex to real
const sizer = size * 2;
for (let i = 0; i < sizer; ++i) {
    inp[i] = i;
}
ConvolutionDouble.fft_fwd_ip_rc(sizer, conv.weights, conv.br, inp, 1);
store_result3(size, actualresults.fft_fwd_ip_rc, conv.br, inp, id, breidx, bimidx);

// Inverse FFT: real to complex
const fscalesizer = a => a / (sizer * 2);
ConvolutionDouble.fft_inv_ip_cr(sizer, conv.weights, conv.br, inp, 1);
store_result1(sizer, actualresults.fft_inv_ip_cr, inp, fscalesizer);

// Convolution
let b = new Array(size * 2);
b[0] = 1;
b[1] = 1;
for (let i = 2; i < sizer; ++i) {
    b[i] = 0;
}
conv.convolve(inp, b);
store_result1(sizer, actualresults.convolve, inp, fscalesizer);

const reallib_results = data.reallib_test_results;

const {
    nested_array_close_to
    , array_close_to
} = check;

test('Operating on same input', () => {
    return nested_array_close_to(actualresults.input_128, reallib_results.input_128, tol);
});

test('Weights are computed exactly', () => {
    return nested_array_close_to(actualresults.weights, reallib_results.weights, tol);
});

test('Results of fft_fwd_ip match', () => {
    return nested_array_close_to(actualresults.fft_fwd_ip, reallib_results.fft_fwd_ip, tol);
});

test('Results of fft_inv_ip match', () => {
    return nested_array_close_to(actualresults.fft_inv_ip, reallib_results.fft_inv_ip, tol);
});

test('Results of fft_fwd_ip_rc match', () => {
    return nested_array_close_to(actualresults.fft_fwd_ip_rc, reallib_results.fft_fwd_ip_rc, tol);
});

test('Results of fft_inv_ip_cr match', () => {
    return array_close_to(actualresults.fft_inv_ip_cr, reallib_results.fft_inv_ip_cr, tol);
});

test('Results of convolution match', () => {
    return array_close_to(actualresults.convolve, reallib_results.convolve, tol);
});
