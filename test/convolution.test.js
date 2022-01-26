const fs = require('fs');
const process = require('process');
const path = require('path');
const data = require('./data/conv.test-data.js');
const winit = require('./wasm-init.js');
const { test_start_module, test_print_summary, test_print_summary_on_exit,
        $time, check, CurrentTestEnv } = require('../tools/tester.js');

const fwasm = CurrentTestEnv.wasm_test_module_path_for('kernel.wat');
const wasmdata = require(fwasm);

let wmemory, arg_off, arr_args, arr_ws, arr_br;

let [winst, offsets, opts] = winit.load_wasm(wasmdata, (off) => {
    offsets = off;
    wmemory = offsets.memory;
    arg_off = offsets.offset_arg;
    arr_args = new Float64Array(wmemory.buffer, arg_off);
    arr_ws = new Float64Array(wmemory.buffer, offsets.offset_cwei);
    arr_br = new Uint32Array(wmemory.buffer, offsets.offset_cbr);
});

let wfns = winst.exports;

wfns.initialize(128);

// ----- Result -helpers -----

let actualresults = {
    input_128: [],
    weights: [],
    brs: [],
    fft_fwd_ip: [],
    fft_inv_ip: [],
    fft_fwd_ip_rc: [],
    fft_inv_ip_cr: [],
    convolve: []
};


const id = i => i;
const reidx = (i) => (i * 2);
const imidx = (i) => (i * 2 + 1);

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

const test = test_start_module(`Convolution (WebAssembly) tests`,
                               `loaded: ${path.relative(process.cwd(), fwasm)}`);

// ----- Initialisation -----

const size = 128;
const tol = 1e-11;

wfns.conv_init(2 * size);

// Initialise arguments
for (let i = 0; i < size; ++i) {
    arr_args[reidx(i)] = i + 1;
    arr_args[imidx(i)] = -i;
}
store_result2(size, actualresults.input_128, arr_args);
store_result2(size, actualresults.weights, arr_ws);
store_result1(size, actualresults.brs, arr_br);

// Forward FFT
wfns.fft_fwd_ip(size, arg_off, 2);
const breidx = i => reidx(arr_br[i]);
const bimidx = i => imidx(arr_br[i]);
store_result3(size, actualresults.fft_fwd_ip, arr_br, arr_args, id, breidx, bimidx);

// Inverse FFT
wfns.fft_inv_ip(size, arg_off, 2);
const fscalesize = a => a / size;
store_result2(size, actualresults.fft_inv_ip, arr_args, fscalesize);

// Forward FFT: complex to real
const sizer = size * 2;
for (let i = 0; i < sizer; ++i) {
    arr_args[i] = i;
}
wfns.fft_fwd_ip_rc(sizer, arg_off, 1);
store_result3(size, actualresults.fft_fwd_ip_rc, arr_br, arr_args, id, breidx, bimidx);

// Inverse FFT: real to complex
const fscalesizer = a => a / (sizer * 2);
wfns.fft_inv_ip_cr(sizer, arg_off, 1);
store_result1(sizer, actualresults.fft_inv_ip_cr, arr_args, fscalesizer);

// Convolution
// argument b
arr_args[sizer + 0] = 1;
arr_args[sizer + 1] = 1;
for (let i = 2; i < sizer; ++i) {
    arr_args[sizer + i] = 0;
}
wfns.convolve(arg_off, arg_off + (sizer * 8), sizer);
store_result1(sizer, actualresults.convolve, arr_args, fscalesizer);


// ----- Tests -----

const {
    nested_array_close_to
    , array_close_to
} = check;

const reallib_results = data.reallib_test_results;

test('Operating on same input', () => {
    return nested_array_close_to(actualresults.input_128, reallib_results.input_128, tol);
});

test('Weights are computed exactly', () => {
    return nested_array_close_to(actualresults.weights, reallib_results.weights, tol);
});

test('Bit-reversed indices are computed exactly', () => {
    return array_close_to(actualresults.brs, reallib_results.brs, tol);
});

test('Results of fft_fwd_ip match', () => {
    return nested_array_close_to(actualresults.fft_fwd_ip, reallib_results.fft_fwd_ip, tol);
});

test('Results of fft_inv_ip match', () => {
    return nested_array_close_to(actualresults.fft_inv_ip, reallib_results.fft_inv_ip, tol);
});

test('Weights are unchanged', () => {
    return nested_array_close_to(actualresults.weights, reallib_results.weights, tol);
});

test('Bit-reversed indices are unchanged', () => {
    return array_close_to(actualresults.brs, reallib_results.brs, tol);
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


// ----- Performance -----

const scr_off = offsets.scratch_off;
let arr_scr = new Float64Array(wmemory.buffer, scr_off);
for (let i = 0; i < sizer; ++i) {
    arr_scr[i] = i;
    arr_scr[sizer + i] = 0;
}
arr_scr[sizer + 0] = 1;
arr_scr[sizer + 1] = 1;
// ----- Convolution -----
$time(() => {
    arr_args.copyWithin(arg_off, scr_off, scr_off + sizer * 2);
    wfns.convolve(arg_off, arg_off + (sizer * 8), sizer);
    return arr_args[1];
}, `convolve ${sizer} x Float64 x 2`);
