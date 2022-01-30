import { current_kernel } from "../../kernels/kernel";
import { LongFloat } from "../../longfloat";



const spaces = (n: number) => new Array(Math.max(0, n)).fill(' ').join('');

const lines = (s: any) => s.split(/\r?\n/);

const indent = (w: number, s: string) => lines(s).map(
    (l: string) => spaces(w) + l).join('\n');

const indent_next = (w: number, s: string) => {
    let lns = lines(s).map((l: string) => spaces(w) + l);
    lns[0] = lns[0].trim();
    return lns.join('\n');
};

const prwid = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

const alignl = (w: number, s: string) =>
    lines(s).map((l: string) => l + spaces(w - prwid(l))).join('\n');

const alignr = (w: number, s: string) =>
    lines(s).map((l: string) => spaces(w - prwid(l)) + l).join('\n');

const alignc = (w: number, s: string) => lines(s).map((l: string) => {
    let w1 = Math.floor((w - prwid(l)) / 2);
    return spaces(w1) + l + spaces(w - w1);
}).join('\n');


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
