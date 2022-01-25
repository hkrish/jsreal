const process = require('process');
const cproc = require('child_process');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const argparse = require('./utils/argparse.js');
const { cfile, cgain, closs, cbold, cwht, clear, indent, unitref
        , alignr, printwidth, print_labelled } = require('./utils/format.js');


// -----------------------------------------------------------------------------
// ----- Globals  -----
// -----------------------------------------------------------------------------
// Editable options

const src_dirname = path.resolve(__dirname, '..', 'src/');
const default_wat_module = path.resolve(src_dirname, 'kernels', 'kernel.wat');
const testtempdir = path.join(__dirname, '.test_build');
const jsbuild_command = 'npx vite build -l error';

let emsdkpath = process.env.EMSDK;
let cmdwat2wasm = 'wat2wasm';
let cmdwasmopt = 'wasm-opt';
let cmdwasmopt_opts = ['-O4', '--converge', '--enable-mutable-globals', '--enable-bulk-memory'];
let watching = false;

// Make sure these functions are exported in the test build
let test_export_functions = [
    "$initialize",
    "$conv_init",
    "$fft_fwd_ip",
    "$fft_inv_ip",
    "$fft_fwd_ip_rc",
    "$fft_inv_ip_cr",
    "$convolve",
    "$is_multiplied_by_convolution",
    "$mantissa_normalize",
    "$mantissa_add",
    "$adjust_for_carry",
    "$mantissa_sub",
    "$mantissa_neg",
    "$mantissa_mul_direct",
    "$mantissa_mul",
    "$mantissa_div",
    "$mantissa_scale",
    "$mantissa_invscale",
    "$mantissa-bscale",
];

// Regexp to create valid javascript function names from wasm function names
const wat_id_chars1 = /([#$%'*+.:<=>?@_`|~!^\\/-])/g;
const funcname_js = (n) => n.replace(/^\$/, '').replace(wat_id_chars1, '_');

// Characters to escape to create a matcher RegExp for each function
// TODO: which characters should be escaped for a valid js regexp?
const wat_id_chars2 = /([#$'*+.:<=>?`|~!^\\/-])/g;

function testbuild_wasm_export_functions(testfile, _inputfile) {
    let stats = fs.statSync(testfile);
    if(!stats.isFile()) {
        console.error(`${testfile}: Not a file`);
        process.exit(1);
    }
    let data = fs.readFileSync(testfile, 'utf8');
    for(let i = 0, n = test_export_functions.length; i < n; ++i) {
        let funcname = test_export_functions[i];
        let funcreg = funcname.replace(wat_id_chars2, "\\$1");
        let exp = new RegExp(`^\\s*\\(\\s*func\\s+${funcreg}\\s*\\(\\s*export\\s*"`, 'm');
        let match = data.match(exp);
        if (!match) {
            let exp2 = new RegExp(`^(\\s*)\\(\\s*func\\s+${funcreg}(\\s+)`, 'm');
            let match2 = data.match(exp2);
            if (!match2) {
                console.error(`${closs('[!]')} Function not in file: ${cfile(funcname)}`
                              + `\n    file: ${cfile(_inputfile)}`);
                process.exit(1);
            }
            data = data.replace(
                exp2, `$1(func ${funcname} (export "${funcname_js(funcname)}")$2`);
        }
    }
    fs.writeFileSync(testfile, data);
}

function findcommands() {
    // Needs `command' utility in $PATH
    let x;
    try {
        x = cproc.execSync(`command -v ${cmdwat2wasm}`);
    } catch (e) {
        console.error(`${closs('[!]')} Command not found: ${cfile(cmdwat2wasm)}`);
        cmdwat2wasm = null;
    }
    try {
        cproc.execSync(`command -v ${cmdwasmopt}`);
    } catch {
        if (emsdkpath) {
            try {
                let cmdwasmopt1 = path.join(emsdkpath, '/upstream/bin/', cmdwasmopt);
                cproc.execSync(`command -v ${cmdwasmopt1}`);
                cmdwasmopt = cmdwasmopt1;
            } catch {
                console.error(`${closs('[!]')} Command not found: ${cfile(cmdwasmopt)}`);
                cmdwasmopt = null;
            }
        } else {
            console.error(`${closs('[!]')} Command not found: ${cfile(cmdwasmopt)}`);
            cmdwasmopt = null;
        }
    }
    if (!cmdwat2wasm || !cmdwasmopt) {
        process.exit(1);
    }
}

const sizeunit = unitref([[1.0, 'B'], [1.0e3, 'KB'], [1.0e6, 'MB'], [1.0e9, 'GB']]);

function run_capture_stderr(cmd, args) {
    fs.mkdirSync(testtempdir, { recursive: true });
    let proc_errfile = path.join(testtempdir, 'err.tmp');
    let proc_errfd = fs.openSync(proc_errfile, 'w');
    let errout;
    try {
        fs.ftruncateSync(proc_errfd);
        cproc.execFileSync(cmd, args, { stdio: ['pipe', 'pipe', proc_errfd] });
        fs.closeSync(proc_errfd);
    } catch (e) {
        fs.closeSync(proc_errfd);
        errout = fs.readFileSync(proc_errfile);
    } finally {
        fs.rmSync(proc_errfile, {force: true});
    }
    return errout;
}

const cerrh = s => `\x1b[31m${s}\x1b[0m`;
const cgrnh = s => `\x1b[32m${s}\x1b[0m`;
const cerr = s => `\x1b[31;4m${s}\x1b[0m`;
const cmsg = s => `\x1b[40m${s}\x1b[0m`;
const crow = s => `\x1b[33m${s}\x1b[0m`;
const cunp = s => `\x1b[33m${s}\x1b[0m`;

function print_errors(d, filename, type) {
    d = d.toString();
    let lns;
    switch (type) {
    case 'wat2wasm':
        lns = d.split(filename).filter(l => l.trim().length > 0);
        for(let e of lns) {
            e = e.trim();
            let m1 = e.match(/^:(?<row>[0-9]+):(?<col>[0-9]+):\s+error:\s+(?<msg>.*)[\r\n](?<dots>\.\.\.)?(?<ii>\s*)(?<line>.+)[\r\n]\k<ii>(?<iii>\s*)(?<here>\S+)/);
            if (m1) {
                const g = m1.groups;
                let i1 = g.iii.length;
                let i2 = i1 + g.here.length;
                let line = (g.dots ? '...' : '') + g.line;
                let lb = line.substring(0, i1) + cerr(line.substring(i1,i2)) + line.substring(i2);
                console.error('');
                print_labelled(2, cerrh('[ERROR]'),
                               `:${crow(alignr(g.row, 4))}: ${cmsg(g.msg)}\n` + lb, 0, 5, true);
            } else {
                console.error(cunp(e));
            }
        }
        break;
    case 'wasm-opt':
        lns = d.split('[wasm-validator error ').filter(l => l.trim().length > 0);
        for(let e of lns) {
            e = e.trim();
            let mf = e.match(/^Fatal:\s*(?<rest>.*)$/sm);
            console.error('');
            if (mf) {
                const g = mf.groups;
                print_labelled(2, cerrh('[FATAL]'), `: ${cmsg(g.rest)}`, 0, 0, true);
                continue;
            } else {
                let m1 = e.match(/^.*?\]\s*(?<msg>.*?)[\r\n](?<rest>.*)$/sm);
                if (m1) {
                    const g = m1.groups;
                    let msg = g.msg.replace(/unexpected\s+(true|false):\s*/g, '');
                    let rest = g.rest.trim();
                    rest = rest.length > 0 ? '\n' + rest : '';
                    print_labelled(2, cerrh('[ERROR]'), `: ${cmsg(msg)}${rest}`, 0, 0, true);
                    continue;
                }
            }
            console.error(cunp(e));
        }
        break;
    default:
        console.error(cunp(d));
    }
    console.error('');
}

function buildwasm(infile) {
    const header = () => console.info(`[BUILD]: ${cfile(infile)}`);
    const [outfile, outoptfile] = wasm_filenames(infile);
    let errd_compile, errd_opt;
    errd_compile = run_capture_stderr(cmdwat2wasm, ['-o', outfile, infile]);
    if (errd_compile) {
        clear();
        header();
        print_errors(errd_compile, infile, 'wat2wasm');
    } else {
        let size = fs.statSync(outfile).size;
        errd_opt = run_capture_stderr(cmdwasmopt, [...cmdwasmopt_opts, '-o', outoptfile, outfile]);
        if (errd_opt) {
            header();
            print_errors(errd_opt, outfile, 'wasm-opt');
        } else {
            header();
            let sizeopt = fs.statSync(outoptfile).size;
            let c = (size === sizeopt) ? (x => x) : (size < sizeopt ? closs : cgain);
            let pcnt = c(' ' + ((sizeopt - size) * 100 / size).toFixed(1) + '% ');
            console.info(indent(`${sizeunit(size)} -> ${sizeunit(sizeopt)} (${pcnt})`, 9));
        }
    }
    const stat = (errd_compile || errd_opt);
    if (stat) {
        console.error(`${closs('[!]')} Errors while building WebAssembly module\n`);
    }
    return [!stat, outfile, outoptfile];
}

function handle_set_files(opts) {
    let fname = path.resolve(opts.args['-s'].value);
    try {
        fs.accessSync(fname);
        let stats = fs.statSync(fname);
        if (!stats.isFile()) {
            console.error(`${closs('[!]')} Not a file:\n    ${cfile(fname)}`);
        }
    } catch {
        console.error(`${closs('[!]')} File not found\n    ${cfile(fname)}`);
        return false;
    }
    opts.args['-s'].value = fname;
    if (opts.args['-t'].value) {
        let fname = path.resolve(opts.args['-d'].value);
        try {
            fs.accessSync(fname);
            let stats = fs.statSync(fname);
            if (!stats.isFile()) {
                console.error(`${closs('[!]')} Not a file:\n    ${cfile(fname)}`);
            }
        } catch {
            console.error(`${closs('[!]')} Tester runner script not found:`
                          + `\n    ${cfile(fname)}`);
            return false;
        }
        opts.args['-d'].value = fname;
    }
    return true;
}

function wasm_filenames(watfile) {
    let tfp = path.parse(watfile);
    return [path.join(tfp.dir, tfp.name + '.wasm')
            , path.join(tfp.dir, tfp.name + '.wasm')];
    // , path.join(tfp.dir, tfp.name + 'opt.wasm')];
}

function handle_clean(opts) {
    if (opts.args['-c'].value) {
        fs.rmSync(testtempdir, { recursive: true, force: true });
        const watfile = opts.args['-s'].value;
        const [outfile, outoptfile] = wasm_filenames(watfile);
        fs.rmSync(outfile, { recursive: true, force: true });
        fs.rmSync(outoptfile, { recursive: true, force: true });
    }
    return true;
}

function handle_build(opts, _build_js = false, _force=false) {
    let ret = true;
    if (opts.args['-b'].value || _force) {
        const watfile = opts.args['-s'].value;
        const [stat, wasmfile, wasmoptfile] = buildwasm(watfile);
        ret = stat;
        if (_build_js && ret) {
            try {
                console.info(`[BUILD]: ${cfile(jsbuild_command)}`);
                cproc.execSync(jsbuild_command, {
                    stdio: ['inherit', 'inherit', 'inherit']
                });
            } catch  {
                ret = false;
            }
        }
    }
    return ret;
}

function handle_test(opts) {
    let ret = true;
    if (opts.args['-t'].value) {
        fs.mkdirSync(testtempdir, { recursive: true });
        const watfile = opts.args['-s'].value;
        const test_watfile = path.join(testtempdir, path.basename(watfile));
        fs.copyFileSync(watfile, test_watfile);
        testbuild_wasm_export_functions(test_watfile, watfile);
        const [stat, test_wasmfile, test_wasmoptfile] = buildwasm(test_watfile);
        ret = stat;
        if (!opts.args['-b'].value) {
            // We need to do a normal build also, because the JS build may fail.
            handle_build(opts, true, true);
        }
        // Do the test
        const tester = path.relative(process.cwd(), opts.args['-d'].value);
        const testopts = `-w ${path.basename(watfile)} -m ${test_wasmoptfile}`;
        try {
            cproc.execSync(`node ${tester} ${testopts}`, {
                stdio: ['inherit', 'inherit', 'inherit']
            });
        } catch {};
    }
    return ret;
}

function handle_watch(opts) {
    let last_build;
    const dispatch_build = () => {
        if (last_build != null) {
            clearTimeout(last_build);
        }
        last_build = setTimeout(() => {
            handle_build(opts, false, true);
            last_build = null;
        }, 100);
    };
    if (opts.args['-w'].value) {
        watching = true;
        let wfile = path.relative(process.cwd(), opts.args['-s'].value);
        chokidar.watch(wfile).on('all', (event, path) => {
            dispatch_build();
        }).on('error', function(error) {
            let rest = error.stack.split(/\r?\n/).slice(1).join('\n');
            print_labelled(2, cerrh('\n[WATCH]'),
                           `: ${cmsg(error.message)}\n` + rest, 0, 5, true);
        }).once('ready', function() {
            print_labelled(0, cgrnh('[WATCH]'),
                           `: ${cmsg(`Watching ${cfile(wfile)}`)} `, 0, 0, true);
        });
    }
    return true;
}


// -----------------------------------------------------------------------------
// ----- Main -----
// -----------------------------------------------------------------------------

if (require.main === module) {
    findcommands();
    let opts = argparse.parse(
        process.argv,
        {
            description: `Compile a ${cfile(".wat")} file to a ${cfile(".wasm")} module.`
                + "\nCan watch for changes and rebuild or run tests on a different test build."
                + `\nOptimise the built module using ${cfile('wasm-opt')}, if installed.`,

            args: {
                '-b': {
                    description: "Build wasm files and exit",
                    value: false,
                    help_sort_key: 0,
                },
                '-t': {
                    description: "Run tests and exit",
                    value: false,
                    help_sort_key: 10,
                },
                '-w': {
                    description: "Watch source and rebuild continuously",
                    value: false,
                    help_sort_key: 20,
                },
                '-s': {
                    description: "Source file",
                    value: default_wat_module,
                    arg: '<file>',
                    help_sort_key: 30,
                },
                '-d': {
                    description: "Test runner script",
                    value: path.resolve(__dirname, 'tester.js'),
                    arg: '<file>',
                    help_sort_key: 40,
                },
                '-c': {
                    description: "Clean built files",
                    value: false,
                    toggle: true,
                    help_sort_key: 50,
                },
                '-h': {
                    description: "Print help",
                    value: false,
                    help_sort_key: 100,
                },
            }
        });
    if (!opts.args['-b'].value
        && !opts.args['-t'].value
        && !opts.args['-w'].value
        && !opts.args['-c'].value) {
        console.error(`Nothing to do. Need at least one of ${cfile('-b -t -w -c')}`);
        process.exit(0);
    }
    let ret = (handle_set_files(opts)
               && handle_clean(opts)
               && handle_build(opts)
               && handle_test(opts)
               && handle_watch(opts));
    if (!watching) {
        process.exit(ret ? 0 : 1);
    }
}
