const process = require('process');
const fs = require('fs');
const path = require('path');
const argparse = require('./utils/argparse.js');
const { clear, indent, unitref } = require('./utils/format.js');

const test_directory = path.resolve(__dirname, '../test');
const exclude_patterns = [/\.git$/, /node_modules/, /dist/, /\.?build$/, /\.?test_build$/];
const test_pattern = /.*?\.test.js$/;


const fmt = (n, s) => `\x1b[${n}m${s}\x1b[0m`;

class TestEnv {
    constructor () {
        this.indent = 0;
        this.current_module = null;
        this.current_test = '';
        this.stat_modules = 0;
        this.stat_tests = 0;
        this.stat_tests_pass = 0;
        this.stat_run_perf = true;
        this.stat_perf_skipped = false;
        this.printing_summary_on_exit = false;
        this.wasm_modules = {};
    }

    wasm_test_module_path_for(m) {
        return this.wasm_modules[m];
    }

    wasm_test_module_relative_path_for(cwd, m) {
        return path.relative(cwd, this.wasm_modules[m]);
    }

    print (v) {
        return JSON.stringify(v, null, 2);
    }

    fg = {
        blk(s) { return fmt(30, s); },
        red(s) { return fmt(31, s); },
        grn(s) { return fmt(32, s); },
        ylo(s) { return fmt(33, s); },
        blu(s) { return fmt(34, s); },
        mag(s) { return fmt(35, s); },
        cyn(s) { return fmt(36, s); },
        wht(s) { return fmt(37, s); },
    }
    bg = {
        blk(s) { return fmt(40, s); },
        red(s) { return fmt(41, s); },
        grn(s) { return fmt(42, s); },
        ylo(s) { return fmt(43, s); },
        blu(s) { return fmt(44, s); },
        mag(s) { return fmt(45, s); },
        cyn(s) { return fmt(46, s); },
        wht(s) { return fmt(47, s); },
    }

    b(s) { return fmt(1, s); }
    f(s) { return fmt(2, s); }
    i(s) { return fmt(3, s); }
    u(s) { return fmt(4, s); }
    r(s) { return fmt(7, s); }

    dec(v) { return v.toString(); }
    hex(v) { return v.toString(16); }
    bin(v) { return v.toString(2); }

};

const E = new TestEnv();

exports.CurrentTestEnv = E;

function printm(m, rec, exp, diff, idx) {
    return (`${E.bg.blk(m)}`
            + (idx == null ? ''  : `\n  at index : ${E.i(idx)}`)
            + (exp == null ? ''  : `\n  Expected : ${E.fg.ylo(E.print(exp))}`)
            + (rec == null ? ''  : `\n  Received : ${E.fg.ylo(E.print(rec))}`)
            + (diff == null ? '' : `\n      Diff : ${diff}`));
}

function textb(f, rel) {
    return (a, b) => {
        if (f(a, b)) {
            return { pass: true };
        } else {
            return {
                pass: false,
                message: printm(`Failed relation: ${a} ${rel} ${b}`, a, b)
            };
        }
    };
}

function textu(f, b) {
    return (a) => {
        if (f(a)) {
            return { pass: true };
        } else {
            return {
                pass: false,
                message: printm(`Failed: ${a} should be ${b}`, a)
            };
        }
    };
}


// -----------------------------------------------------------------------------
// ----- Checks -----
// -----------------------------------------------------------------------------

let check = {};

check.is = textb((a, b) => Object.is(a, b), 'is');
check.eq = textb((a, b) => a === b, '===');
check.not_eq = textb((a, b) => a !== b, '!==');
check.gt = textb((a, b) => a > b, '>');
check.ge = textb((a, b) => a >= b, '>=');
check.lt = textb((a, b) => a < b, '<');
check.le = textb((a, b) => a <= b, '<=');
check.true = textu(a => a, 'true');
check.false = textu(a => !a, 'false');


check.array_close_to = (received, expected, tol) => {
    tol = (tol == null) ? 1e-10 : tol;
    if (!(Array.isArray(received) && Array.isArray(expected))) {
        return {
            pass: false,
            message: printm('Expected arguments to be Arrays'),
        };
    }
    let nr = received.length;
    let ne = expected.length;
    if (nr !== ne) {
        return {
            pass: false,
            message: printm('Expected arguments to be Arrays of same length'),
        };
    }
    for (let i = 0; i < ne; ++i) {
        let ei = expected[i];
        let ri = received[i];
        let d = Math.abs(ei - ri);
        if (d > tol) {
            return {
                pass: false,
                message: printm(`Expected results to be within tolerance (${tol})`, ri, ei, d, i)
            };
        }
    }
    return { pass: true };
};

check.nested_array_close_to = (received, expected, tol) => {
    tol = (tol == null) ? 1e-10 : tol;
    if (!(Array.isArray(received) && Array.isArray(expected))) {
        return {
            pass: false,
            message: printm('Expected arguments to be nested Arrays'),
        };
    }
    let nr = received.length;
    let ne = expected.length;
    if (nr !== ne) {
        return {
            pass: false,
            message: printm('Expected arguments to be nested Arrays of same length'),
        };
    }
    for (let i = 0; i < ne; ++i) {
        let ei = expected[i];
        let nei = ei.length;
        let ri = received[i];
        let nri = ri.length;
        if (!(Array.isArray(ri) && Array.isArray(ei)) || (nri !== nei)) {
            return {
                pass: false,
                message: printm(`Expected arguments to be nested Arrays of same length.`,
                                ri, ei, null, i)
            };
        }
        for (let j = 0; j < nei; ++j) {
            let d = Math.abs(ei[j] - ri[j]);
            if (d > tol) {
                return {
                    pass: false,
                    message: printm(`Expected results to be within tolerance (${tol})`,
                                    ri[j], ei[j], d, `${i}, ${j}`)
                };
            }
        }
    }
    return { pass: true };
};

exports.check = check;


// -----------------------------------------------------------------------------
// ----- Test functions -----
// -----------------------------------------------------------------------------

const test = (name, test, nindent) => {
    if (!current_opts.args['-t'].value) {
        return;
    }
    let okstr = E.fg.grn('[ OK ]') + ' ';
    let failstr = E.bg.red(E.fg.blk('[FAIL]')) + ' ';
    nindent = (nindent || 0) + E.indent;
    E.stat_tests += 1;
    let res = test();
    if (res && res.pass) {
        E.stat_tests_pass += 1;
        console.info(indent(okstr + name, nindent));
    } else {
        E.stat_run_perf = false;
        console.info(indent(failstr + name, nindent));
        let msg;
        if (typeof res.message === 'function') {
            msg = res.message();
        } else if (typeof res.message === 'string') {
            msg = res.message;
        }
        if (msg) {
            console.error(indent(msg + '\n', nindent + 10));
        }
    }
};

exports.test_start_module = (name, ...lns) => {
    E.stat_modules += 1;
    console.info(`\n [TEST]: ${E.u(name)}`);
    E.indent = 9;
    if (E.current_module && E.current_module !== '') {
        console.info(indent(
            `module: ${path.relative(process.cwd(), E.current_module)}`
            , E.indent));
    }
    if (lns.length > 0) {
        console.info(indent(`${E.f(lns.join('\n'))}`, E.indent));
    }
    console.info('');
    E.stat_run_perf = true;
    E.stat_perf_skipped = false;
    return test;
};

function test_print_summary () {
    let s_m = E.stat_modules === 1 ? '' : 's';
    let msg = `\n[Summary]: Tested ${E.stat_modules} module${s_m}`;
    let npassed = E.stat_tests_pass;
    let s_tp = npassed === 1 ? '' : 's';
    let msg2 = E.fg.grn(`${npassed} test${s_tp} passed.`);
    let nfailed = E.stat_tests - npassed;
    if (nfailed > 0) {
        let s_tf = nfailed === 1 ? '' : 's';
        msg2 = msg2 + `\n` + E.fg.red(`${nfailed} test${s_tf} failed.`);
    }
    console.info(indent(msg , 0));
    console.info(indent(msg2 + '\n' , 11));
    return (nfailed > 0) ? 1 : 0;
};

exports.test_print_summary = test_print_summary;

function test_print_summary_on_exit () {
    E.printing_summary_on_exit = true;
    process.on('beforeExit', () => {
        process.exit(test_print_summary());
    });
};

exports.test_print_summary_on_exit = test_print_summary_on_exit;


// -----------------------------------------------------------------------------
// ----- Basic performance benchmarks -----
// -----------------------------------------------------------------------------

function _sepint (n) {
    let ds = [...(`${Math.floor(n)}`)];
    for (let i = ds.length - 3; i > 0; i -= 3) {
        ds.splice(i, 0, ",");
    }
    return ds.join('');
}

const timeunit = unitref([[1.0, 'ns'], [1.0e3, 'µs'], [1.0e6, 'ms'], [1.0e9, 's']]);

exports.$time = function (f, name, dur) {
    const timestamp =  process.hrtime.bigint;
    if (!current_opts.args['-p'].value) {
        return 0;
    }
    if (E.stat_perf_skipped) {
        return 0;
    }
    if (!E.stat_run_perf) {
        E.stat_perf_skipped = true;
        console.info(indent(
            `\n` + E.f(E.fg.red(`[PERF]`))
                + E.f(` Skipping performance tests due to failed tests`) , E.indent));
        return 0;
    }
    if (typeof name === 'number') {
        dur = name;
        name = f.name;
    }
    dur = dur || 0;
    dur = (dur < 1) ? 1 : (dur | 0);
    let durns = dur * 1e9;
    let count = 0;
    let ret = 0;
    let readings = [];
    console.info(indent(`\n` + E.fg.blu(`[PERF]`) + ` ${name} (for ${dur} seconds)`, E.indent));
    let tbegin = timestamp();
    do {
        let t0 = timestamp();
        ret += f();
        let td = timestamp() - t0;
        readings.push(td);
        ++count;
    } while ((timestamp() - tbegin) <= durns);
    let ops = _sepint(count / dur);
    let median;
    readings.sort();
    if (count % 2 === 0) {
        median = readings[(count / 2)];
    } else {
        median = ((readings[Math.floor(count / 2)] + readings[Math.ceil(count / 2)])
                  / BigInt(2));
    }
    console.info(indent(`${ops} ops/s  (median: ${timeunit(median)})`, E.indent + 7));
    return ret;
};


// -----------------------------------------------------------------------------
// ----- Main -----
// -----------------------------------------------------------------------------

let current_opts = {
    description: `Test utilities`,

    args: {
        '-w' : {
            description: `Original wasm module ${E.u('base name')}`,
            value: null,
            arg: '<file>',
            help_sort_key: 0,
        },
        '-m' : {
            description: `Test build filename for original wasm module`
                + ` (option ${E.fg.blu('-w')})`,
            value: null,
            arg: '<file>',
            help_sort_key: 5,
        },
        '-t' : {
            description: 'Toggle tests',
            value: true,
            toggle: true,
            help_sort_key: 10,
        },
        '-p' : {
            description: 'Toggle performance tests',
            value: true,
            toggle: true,
            help_sort_key: 20,
        },
        '-h' : {
            description: 'Print help',
            value: false,
            help_sort_key: 100,
        },
    }
};

function handle_set_files(opts) {
    if (opts.args['-w'].value == null || opts.args['-m'].value == null){
        console.error(`${E.bg.red(E.fg.wht('[!]'))} No wasm file to test.`
                      + ` Both ${E.fg.blu('-w -m')} options are required.`);
        return false;
    } else {
        let fname = path.resolve(opts.args['-m'].value);
        try {
            fs.accessSync(fname);
            let stats = fs.statSync(fname);
            if (!stats.isFile()) {
                console.error(`${E.bg.red(E.fg.wht('[!]'))} Not a file:`
                              + `\n    ${E.fg.blu(fname)}`);
            }
        } catch {
            console.error(`${E.bg.red(E.fg.wht('[!]'))} File not found:`
                          + `\n    ${E.fg.blu(fname)}`);
            return false;
        }
        opts.args['-m'].value = fname;
        E.wasm_modules[path.basename(opts.args['-w'].value)] = fname;
        return true;
    }
}

function get_test_files() {
    // Get files ordered alphabetically and by levels
    function flatten(arr) {
        function flat(arr, res) {
            for(let a of arr) {
                if (Array.isArray(a)) {
                    flat(a, res);
                } else {
                    res.push(a);
                }
            }
            return res;
        }
        return flat(arr, []);
    }
    function walk(dir) {
        let fils = [];
        let dirs = [];
        fs.readdirSync(dir).forEach(f => {
            if (exclude_patterns.some(ep => ep.test(f))) {
                return;
            }
            let fn = path.join(dir, f);
            let stats = fs.statSync(fn);
            if (stats.isDirectory()) {
                dirs.push(fn);
            } else if(stats.isFile() && test_pattern.test(f)) {
                fils.push(fn);
            }
        });
        return fils.sort().concat(dirs.sort().map(walk));
    }
    return flatten(walk(test_directory));
}

if (require.main === module) {
    current_opts = argparse.parse(process.argv, current_opts);
    if (!handle_set_files(current_opts)) {
        process.exit(1);
    }
    // Test builds should be available now. Otherwise call through builder.js
    // Find all test files
    let test_files = get_test_files();
    if (test_files.length < 1) {
        console.info(`No test files found`
                     + `\n  in directory: ${E.fg.blu(test_directory)}`
                     + `\n      matching: ${E.fg.ylo(test_pattern)}`);
        process.exit(0);
    }
    test_print_summary_on_exit();
    // DoIt
    for(let tf of test_files) {
        E.current_module = tf;
        require(tf);
        try {
        } catch (e) {
            console.error(e);
        } finally {
            E.current_module = null;
        }
    }
    if (!E.printing_summary_on_exit) {
        process.exit((E.stat_tests_pass < E.stat_tests) ? 1 : 0);
    }
}
