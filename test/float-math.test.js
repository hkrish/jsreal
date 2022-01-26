const fs = require('fs');
const process = require('process');
const path = require('path');
const winit = require('./wasm-init.js');
const { test_start_module, test_print_summary, test_print_summary_on_exit,
        $time, check, CurrentTestEnv } = require('../tools/tester.js');
const fwasm = CurrentTestEnv.wasm_test_module_path_for('kernel.wat');


const test = test_start_module(`Floating point math (WebAssembly) tests`,
                               `loaded: ${path.relative(process.cwd(), fwasm)}`);


const wasmdata = require(fwasm);

let wmemory, arg_off, arr_args, arr_argsI32, arr_ws, arr_br;

let [winst, offsets, opts] = winit.load_wasm(wasmdata, (off) => {
    offsets = off;
    wmemory = offsets.memory;
    arg_off = offsets.offset_arg;
    arr_args = new Float64Array(wmemory.buffer, arg_off);
    arr_argsI32 = new Int32Array(wmemory.buffer, arg_off);
    arr_ws = new Float64Array(wmemory.buffer, offsets.offset_cwei);
    arr_br = new Uint32Array(wmemory.buffer, offsets.offset_cbr);
});

let wfns = winst.exports;

wfns.initialize(128);

const frexp_res1 = [
    // ----- Sanity -----
    { x: -8.0668483905796808  , y: -0.50417802441123005 , e: 4  },
    { x: 4.3452398493383049   , y: 0.54315498116728811  , e: 3  },
    { x: -8.3814334275552493  , y: -0.52383958922220308 , e: 4  },
    { x: -6.5316735819134841  , y: -0.81645919773918552 , e: 3  },
    { x: 9.2670569669725857   , y: 0.57919106043578661  , e: 4  },
    { x: 0.66198589809950448  , y: 0.66198589809950448  , e: 0  },
    { x: -0.40660392238535531 , y: -0.81320784477071062 , e: -1 },
    { x: 0.56175974622072411  , y: 0.56175974622072411  , e: 0  },
    { x: 0.77415229659130369  , y: 0.77415229659130369  , e: 0  },
    { x: -0.67876370263940244 , y: -0.67876370263940244 , e: 0  },
];

const frexp_res2 = [
    // ----- Special -----
    { x : 0         , y : 0         , e : 0 },
    { x : -0        , y : -0        , e : 0 },
    { x : 0.5       , y : 0.5       , e : 0 },
    { x : -0.5      , y : -0.5      , e : 0 },
    { x : 1         , y : 0.5       , e : 1 },
    { x : -1        , y : -0.5      , e : 1 },
    { x : 2         , y : 0.5       , e : 2 },
    { x : -2        , y : -0.5      , e : 2 },
    // { x : Infinity  , y : Infinity  , e : 0 },
    // { x : -Infinity , y : -Infinity , e : 0 },
    // { x : NaN       , y : NaN       , e : 0 },
];


// ----- Initialisation -----

// ----- Tests -----

test('frexp / sanity tests', () => {
    let res;
    for(let i = 0; i < frexp_res1.length; ++i) {
        let t = frexp_res1[i];
        let y = wfns.frexp(t.x, arg_off);
        res = check.eq(y, t.y);
        if (!res.pass) {
            return res;
        }
        let e = arr_argsI32[0];
        res = check.eq(e, t.e);
        if (!res.pass) {
            return res;
        }
    }
    return res;
});


test('frexp / special cases', () => {
    let res;
    for(let i = 0; i < frexp_res2.length; ++i) {
        let t = frexp_res2[i];
        let y = wfns.frexp(t.x, arg_off);
        res = check.eq(y, t.y);
        if (!res.pass) {
            console.log(y, t);
            return res;
        }
        let e = arr_argsI32[0];
        res = check.eq(e, t.e);
        if (!res.pass) {
            console.log(y, e, t);
            return res;
        }
    }
    return res;
});


// ----- Performance -----

// ----- frexp -----
let d = Math.random() * 1000;
$time(() => {
    wfns.frexp(d, arg_off);
    return arr_argsI32[0];
}, `frexp`, 2);
