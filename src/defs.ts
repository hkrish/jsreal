

declare global {
    type Maybe<T> = T | null | undefined;

    type Mantissa = Uint32Array;
}

export const MINIMUM_EXPONENT = -(1 << 28);

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
    name = 'jsreal::Exception';

    constructor(name: string, message: string, ...args: any[]) {
        message = `\n${indent(4, message)}\n`;
        if (args.length > 0) {
            message = `${message}${Exn.arguments_to_string(args)}`;
        }
        super(message);
        this.name = name || this.name;
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
        super('jsreal::NotImplementedException',
            `method "${name}" is not implemented.${recs}`);
    }
}

export class ExnType extends Exn {
    constructor(message: string, ...args: any[]) {
        super('jsreal::TypeError', message, ...args);
    }
}

// TODO: The following exception types can have a standard arg labels?

export class ExnPrecision extends Exn {
    constructor(message: any, giv?: any) {
        if (giv == null) {
            if (typeof message === 'string') {
                super('jsreal::PrecisionException', message);
            } else {
                super('jsreal::PrecisionException', '', 'given', message);
            }
        } else {
            super('jsreal::PrecisionException', message, 'given', giv);
        }
    }
}

export class ExnDomain extends Exn {
    constructor(message: any, giv?: any, ...args: any[]) {
        if (giv == null) {
            if (typeof message === 'string') {
                super('jsreal::DomainException', message);
            } else {
                super('jsreal::DomainException', '', 'given', message);
            }
        } else {
            super('jsreal::DomainException', message, 'given', giv, ...args);
        }
    }
}


// -----------------------------------------------------------------------------
// ----- Printing & Formatting -----
// -----------------------------------------------------------------------------


export class PrinterO {
    private _base = 10;
    private _string: string;
    private _print_fn: string;

    constructor(opts?: any) {
        opts = opts || {};
        this._base = opts.base || 10;
        this._string = opts.string || '';
        this._print_fn = opts.print_fn || 'as_string';
    }

    get args (): any {
        return {
            base: this._base,
            string: this._string,
            print_fn: this._print_fn,
        };
    }

    make (o: any = {}): PrinterO {
        return new PrinterO(Object.assign(this.args, o));
    }

    get_base (): number {
        return this._base;
    }

    set_base (val: number) {
        this._base = val;;
    }

    base (val: number): PrinterO {
        return this.make({ base: val });
    }

    print_fn (val: string): PrinterO {
        return this.make({ print_fn: val });
    }

    newline (): PrinterO {
        return this.make({ string: this._string + '\n' });
    }

    print (a: any): PrinterO {
        let str = this._string;
        if (typeof a === 'string') {
            str += a;
        } else if (typeof a === 'number' || typeof a === 'bigint') {
            str += a.toString(this._base);
        } else if (Array.isArray(a)) {
            str += '[';
            let pr = this.make({ string: '' });
            for (let i = 0, na = a.length - 1; i < na; ++i) {
                str += pr.print(a[i]) + ', ';
            }
            if (a.length > 0) {
                str += pr.print(a[a.length - 1]);
            }
            str += ']';
        } else if (typeof a[this._print_fn] === 'function') {
            str += a[this._print_fn](this);
        } else if (typeof a.toString === 'function') {
            str += a.toString();
        } else {
            str += JSON.stringify(a, null, 2);
        }
        return this.make({ string: str });
    }

    get string (): string {
        return this.toString();
    }

    set_string (s: string) {
        this._string = s || '';
    }

    toString (): string {
        return this._string;
    }

    to_string (a: any): string {
        return this.print(a).toString();
    }
}

export const Printer = new PrinterO();


const spaces = (n: number) => new Array(Math.max(0, n)).fill(' ').join('');

const lines = (s: any) => Printer.to_string(s).split(/\r?\n/);

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
