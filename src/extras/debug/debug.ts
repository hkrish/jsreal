import { current_kernel } from "../../kernels/kernel";
import { LongFloat } from "../../longfloat";


function curry (f: (...a: any[]) => any, as: any[] = []): (...a: any[]) => any {
    return (...b: any[]) => {
        let args = as.concat(b);
        return (args.length >= f.length) ? f(...args) : curry(f, args);
    };
}

function tostr (a: any): string {
    if (typeof a === 'string') {
        return a;
    } else if (typeof a === 'number') {
        return a.toString();
    } else if (Array.isArray(a)) {
        return `[${a.toString()}]`;
    } else if (typeof a.toString === 'function') {
        return a.toString();
    } else {
        return JSON.stringify(a, null, 2);
    }
}

const repeat = curry((c: any, n: number) => new Array(Math.max(0, n)).fill(c).join(''));

const spaces: (n: number) => string = repeat(' ');

const lines = (s: any) => tostr(s).split(/\r?\n/);

const indent = (w: number, s: string) => lines(s).map(
    (l: string) => spaces(w) + l).join('\n');

const indent_next = (w: number, s: string) => {
    let lns = lines(s).map((l: string) => spaces(w) + l);
    lns[0] = lns[0].trim();
    return lns.join('\n');
};

const prwid = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

type AlignF = (w: number, s: string) => string;

const alignl_p = curry((pad: string, w: number, s: string) =>
    lines(s).map((l: string) => l + repeat(pad, w - prwid(l))).join('\n'));

const alignl: AlignF = alignl_p(' ');

const alignr_p = curry((pad: string, w: number, s: string) =>
    lines(s).map((l: string) => repeat(pad, w - prwid(l)) + l).join('\n'));

const alignr: AlignF = alignr_p(' ');

const align0: AlignF = alignr_p('0');

const alignc = (w: number, s: string) => lines(s).map((l: string) => {
    let w1 = Math.floor((w - prwid(l)) / 2);
    return spaces(w1) + l + spaces(w - w1);
}).join('\n');

const groups = curry((n: number, arr: any[]): any[][] => {
    let gs: any[][] = [];
    let g: any[] = [];
    for (let i = 0; i < arr.length; ++i) {
        if (i > 0 && i % n === 0) {
            gs.push(g);
            g = [arr[i]];
        } else {
            g.push(arr[i]);
        }
    }
    if (g.length > 0) {
        gs.push(g);
    }
    return gs;
});

const octets = groups(8);
const hexes = groups(2);


function getbase (): number {
    return window.__print_base;
}

export function setbase (n: number) {
    n = n || 10;
    window.__print_base = n | 0;
}

// printargs('i32', 'u32', 'f32')
// printargs(2, 'i32', 'f32')
// ...
export function printargs (...args: any[]) {
    let K = current_kernel();
    let dv = K.mem_dv;
    let opts;
    if (typeof args[args.length - 1] === 'object') {
        opts = args.pop();
    }
    let offset = (opts == null || opts.offset == null) ? K.layout.offset_arg : opts.offset;
    let kprec = LongFloat.working_precision;
    kprec = (opts == null || opts.prec == null) ? kprec : opts.prec;
    let argtypes: [string, number][] = args.reduce((ats, a) => {
        if (typeof a === 'number') {
            ats.push(['_', a]);
        } else if (typeof a === 'string') {
            if (ats.length === 0 || ats[ats.length - 1][0] !== '_') {
                ats.push([a, 1]);
            } else {
                ats[ats.length - 1][0] = a;
            }
        } else {
            throw `expected: string or number. Given ${a}`;
        }
        return ats;
    }, []);
    let wids = new Array(kprec + 1).fill(0);
    let lines = [];
    for (let i = 0; i < argtypes.length; ++i) {
        let a = argtypes[i];
        let fn: keyof DataView;
        switch (a[0]) {
            case 'i32': fn = 'getInt32'; break;
            case 'i64': fn = 'getBigInt64'; break;
            case 'u64': fn = 'getBigUint64'; break;
            case 'f64': fn = 'getFloat64'; break;
            case 'u32':
            default:
                fn = 'getUint32';
        }
        let sz = fn.endsWith('64') ? 8 : 4;
        for (let j = 0; j < a[1]; ++j) {
            let n = offset.toString();
            wids[0] = Math.max(wids[0], n.length);
            let args = [n];
            for (let k = 0; k < kprec; ++k) {
                let n = dv[fn](offset + (k * sz), true).toString(getbase());
                wids[k + 1] = Math.max(wids[k + 1], n.length);
                args.push(n)
            }
            lines.push(args);
            offset += kprec * sz;
        }
    }
    for (let i = 0; i < lines.length; ++i) {
        let ln = lines[i];
        for (let j = 0; j <= kprec; ++j) {
            ln[j] = alignr(wids[j], ln[j]);
        }
        let offset = ln.shift();
        console.log(`${offset}:[ ${ln.join(', ')} ]`);
    }
}


export const print = curry((base: number, n: number) => {
    let ng = 3;
    let w = 10;
    switch (base) {
        case 2: ng = 4; w = 32; break;
        case 8: ng = 3; w = 16; break;
        case 10: ng = 3; w = 10; break;
        case 16: ng = 4; w = 8; break;
    }
    let sign = n < 0 ? '-' : '';
    let str = Math.abs(n).toString(base);
    let narr = str.length;
    while (w < narr) {
        w *= 2;
    }
    if (w - narr > 0) {
        str = repeat('0', w - narr) + str;
    }
    let arr = [...str];
    return sign + (groups(ng, arr.reverse())
        .reverse()
        .map((g: any[]) => g.reverse().join(''))
        .join('_'));
});

export const pr = print(10);
export const prbin = print(2);
export const prhex = print(16);
