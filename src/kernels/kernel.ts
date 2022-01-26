import kernel_data from './kernel_wasm.js';


class Kernel {
    private _precision: number;
    internal: WKernel;
    mem_dv: DataView;
    mem_u32: Uint32Array;
    mem_f64: Float64Array;
    layout: {
        ConvMaxSize: number,
        offset_arg: number,
        offset_scratch: number,
        offset_cwei: number,
        offset_cbr: number,
        offset_kernsc: number,
        memory_pages: number,
        size: number,
    };

    constructor() {
        this._precision = -1;
        this.internal = <WKernel><unknown>undefined;
        this.mem_dv = <DataView><unknown>undefined;
        this.mem_u32 = <Uint32Array><unknown>undefined;
        this.mem_f64 = <Float64Array><unknown>undefined;
        this.layout = {
            ConvMaxSize: -1,
            offset_arg: -1,
            offset_scratch: -1,
            offset_cwei: -1,
            offset_cbr: -1,
            offset_kernsc: -1,
            memory_pages: -1,
            size: -1,
        };
    }

    initialize (prec: number) {
        if ((<unknown>this.internal) == null) {
            throw "Kernel is not instantiated.";
        }
        this.internal.initialize(prec);
    }

    get precision (): number {
        return this._precision;
    }

    get __init_options () {
        return {
            functions: {
                sin: Math.sin,
                cos: Math.cos,
                raise: this.raise.bind(this),
                on_change_offsets: this.on_change_offsets.bind(this),
            }
        };
    }

    // ----- Callback from wasm module.: read current memory offsets -----
    private on_change_offsets (): void {
        this.layout.offset_arg = this.internal.offset_arg.value;
        this.layout.offset_scratch = this.internal.offset_scratch.value;
        this.layout.offset_cwei = this.internal.offset_cwei.value;
        this.layout.offset_cbr = this.internal.offset_cbr.value;
        this.layout.offset_kernsc = this.internal.offset_kernsc.value;
        this.layout.memory_pages = this.internal.memory_pages.value;
        this.layout.ConvMaxSize = this.internal.ConvMaxSize.value;
        this.layout.size = this.layout.memory_pages * 64 * 1024;
        this._precision = this.internal.kernel_precision.value;
        this.mem_dv = new DataView(this.internal.memory.buffer);
        this.mem_u32 = new Uint32Array(this.internal.memory.buffer);
        this.mem_f64 = new Float64Array(this.internal.memory.buffer);
    }

    // ----- wasm module helper: raise exceptions -----
    private raise (type: number, source: number, nargs: number): void {
        let reason = 'kernel: unknown error';
        let given;
        let expected;
        let expected_title = ' expected';
        let src = {
            1: 'internal/$init-memory-layout',
            2: 'convolve_init',
        }[source];
        switch (type) {
            case 2:
                reason = `[${src}]: Size must be a power of 2.`;
                if (nargs > 0 && this.mem_dv) {
                    given = `${this.mem_dv.getUint32(0, true)}`;
                }
                break;
            case 3:
                reason = `[${src}]: Out of memory.`;
                if (this.layout.size >= 0) {
                    expected = `size <= ${this.layout.ConvMaxSize}`;
                    if (nargs > 0 && this.mem_dv) {
                        given = `${this.mem_dv.getUint32(0, true)}`;
                    }
                } else {
                    expected = `wasm module memory to be initialized`;
                }
                break;
            case 4:
                reason = `[${src}]: Out of memory.`;
                if (this.layout.size >= 0) {
                    expected = `size <= ${this.layout.ConvMaxSize}`;
                    if (nargs > 0 && this.mem_dv) {
                        expected_title = 'requested';
                        expected = `${this.mem_dv.getUint32(0, true)}`;
                    }
                } else {
                    expected = `wasm module memory to be initialized`;
                }
                break;
        }
        throw (reason
            + (expected ? `\n\t${expected_title}: ` + expected : '')
            + (given ? '\n\t    given: ' + given : ''));
    }
}


export type IKernel = InstanceType<typeof Kernel>;


let __current_module: WebAssembly.Module | undefined;
let __current_kernel: Kernel | undefined;


export async function instantiate_kernel (): Promise<Kernel> {
    if (__current_kernel == null) {
        __current_kernel = new Kernel();
        const mod = await WebAssembly.compile(kernel_data);
        __current_module = mod;
        const inst = await WebAssembly.instantiate(mod, __current_kernel.__init_options);
        __current_kernel.internal = <WKernel><unknown>inst.exports;
    }
    return __current_kernel;
}

export function current_kernel_module (): WebAssembly.Module {
    if (__current_module == null) {
        throw "Kernel is not instantiated.";
    }
    return __current_module;
}

export function current_kernel (): Kernel {
    if (__current_kernel == null) {
        throw "Kernel is not instantiated.";
    }
    return __current_kernel;
}
