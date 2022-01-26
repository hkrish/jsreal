const fs = require('fs');
const path = require('path');


// ----------------------------------------
// ----- Configuration options -----
// This is from ../simple.js
// Initially allocated max size. Will grow if necessary


let memlayout = {
    ConvMaxSize: -1,
    offset_arg: -1,
    offset_scratch: -1,
    offset_cwei: -1,
    offset_cbr: -1,
    offset_kernsc: -1,
    memory_pages: -1,
    size: -1,
    sizeh: '(not initialized)',
    memory: null,
};


function raise(type, source, nargs) {
    let memview = memlayout.memory ? new DataView(memlayout.memory.buffer) : null;
    let reason = 'kernel: unknown error';
    let given;
    let expected;
    let expected_title = ' expected';
    let src = {
        1: 'internal/$init-memory-layout',
        2: 'convolve_init',
    } [source];
    switch (type) {
    case 2:
        reason = `[${src}]: Size must be a power of 2.`;
        if (nargs > 0 && memview) {
            given = `${memview.getUint32(0, true)}`;
        }
        break;
    case 3:
        reason = `[${src}]: Out of memory.`;
        if (memlayout.size >= 0) {
            expected = `size <= ${memlayout.ConvMaxSize}`;
            if (nargs > 0 && memview) {
                given = `${memview.getUint32(0, true)}`;
            }
        } else {
            expected = `wasm module memory to be initialized`;
        }
        break;
    case 4:
        reason = `[${src}]: Out of memory.`;
        if (memlayout.size >= 0) {
            expected = `size <= ${memlayout.ConvMaxSize}`;
            if (nargs > 0 && memview) {
                expected_title = 'requested';
                expected = `${memview.getUint32(0, true)}`;
            }
        } else {
            expected = `wasm module memory to be initialized`;
        }
        break;
    }
    throw (reason
           + (expected ? `\n\t${expected_title}: ` + expected : '')
           + (given ?    '\n\t    given: ' + given : ''));
}


let winst;
let offset_change_handler;

function on_change_offsets() {
    let exports = winst.exports;
    // ----- Read current offsets -----
    memlayout.offset_arg = exports.offset_arg.value;
    memlayout.offset_scratch = exports.offset_scratch.value;
    memlayout.offset_cwei = exports.offset_cwei.value;
    memlayout.offset_cbr = exports.offset_cbr.value;
    memlayout.offset_kernsc = exports.offset_kernsc.value;
    memlayout.memory_pages = exports.memory_pages.value;
    memlayout.ConvMaxSize = exports.ConvMaxSize.value;
    memlayout.size = memlayout.memory_pages * 64 * 1024;
    memlayout.sizeh = memlayout.size;
    memlayout.memory = exports.memory;
    if (offset_change_handler) {
        offset_change_handler(memlayout);
    }
}


const wasm_init_options = {
    functions: {
        raise,
        sin: Math.sin,
        cos: Math.cos,
        on_change_offsets,
    }
};


// ----------------------------------------

exports.load_wasm = function load(data, on_change_offset_handler) {
    // fwasm = path.resolve(fwasm);
    // let data = fs.readFileSync(fwasm);
    offset_change_handler = on_change_offset_handler;
    let wmodule = new WebAssembly.Module(data);
    winst = new WebAssembly.Instance(wmodule, wasm_init_options);
    return [winst, memlayout, wasm_init_options];
};
