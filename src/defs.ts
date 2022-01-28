

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


// -----------------------------------------------------------------------------
// ----- Exception types -----
// -----------------------------------------------------------------------------

export class Exn extends Error {
    constructor(name: string, message: string, ...args: any[]) {
        message = `\n${indent(4, message)}\n`;
        if (args.length > 0) {
            message = `${message}${Exn.arguments_to_string(args)}`;
        }
        super(message);
        this.name = name;
    }

    private static arguments_to_string (args: any[]) {
        let nargs = args.length;
        if (args.length % 2 !== 0) {
            // `ExceptionInception'
            throw "ExceptionException: even number of `argument-name',"
            + " `argument-value' should be given";
        }
        let strs: string[] = [];
        let w = 0;
        for (let i = 0; i < nargs; i += 2) {
            w = Math.max(w, args[i].length);
        }
        for (let i = 0; i < nargs; i += 2) {
            let w2 = w + 8;
            let msg = indent_next(w2 + 3, args[i + 1]);
            strs.push(`${alignr(w2, args[i])} : ${msg}`);
        }
        return (strs.join('\n') + '\n');
    }
}

export class ExnNotImplemented extends Exn {
    constructor(name: string, rec?: string) {
        let recs = '';
        if (rec) {
            recs = `\n    Use "${rec}" instead.`
        }
        super('NotImplementedException',
            `method "${name}" is not implemented.${recs}`);
    }
}

export class ExnType extends Exn {
    constructor(message: string, ...args: any[]) {
        super('TypeError', message, ...args);
    }
}


// -----------------------------------------------------------------------------
// ----- Formatting -----
// -----------------------------------------------------------------------------

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

window.tostr = tostr;

const spaces = (n: number) => new Array(Math.max(0, n)).fill(' ').join('');

const lines = (s: any) => tostr(s).split(/\r?\n/);

const indent = (w: number, s: string) => lines(s).map(
    (l: string) => spaces(w) + l).join('\n');

const indent_next = (w: number, s: string) => {
    let lns = lines(s).map((l: string) => spaces(w) + l);
    lns[0] = lns[0].trim();
    return lns.join('\n');
};

const prwid = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

const alignl = (w: number, s: string) =>
    lines(s).map(l => l + spaces(w - prwid(l))).join('\n');

const alignr = (w: number, s: string) =>
    lines(s).map(l => spaces(w - prwid(l)) + l).join('\n');

const alignc = (w: number, s: string) => lines(s).map(l => {
    let w1 = Math.floor((w - prwid(l)) / 2);
    return spaces(w1) + l + spaces(w - w1);
}).join('\n');
