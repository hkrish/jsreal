const process = require('process');
const path = require('path');
const { cfile, cgain, closs, cbold, cwht, clear, indent } = require('./format.js');

function set_arg(opts, key, rest) {
    let keyf = closs(' ' + key + ' ');
    let msg_help = `\n  try: ${cfile(opts.cmdname + ' -h')} for help`;
    if (opts.args[key]) {
        let val;
        if (opts.args[key].arg) {
            val = rest.shift();
            if (val == null || val.startsWith('-')) {
                console.log(`Option ${keyf} needs a valid argument.`
                            + ` ${val == null ? '' : '(given: "' + val + '")'}`
                            + msg_help);
                process.exit(1);
            }
        } else if (opts.args[key].toggle) {
            val = !opts.args[key].value;
        } else {
            val = true;
        }
        Object.assign(opts.args[key], { value: val });
    } else {
        console.log(`Invalid option: ${keyf}` + msg_help);
        process.exit(1);
    }
}

function print_help(opts) {
    const labels = ['usage: ', 'description: ', 'options: '];
    let help_order = Object.keys(opts.args).sort((k1, k2) => {
        return (opts.args[k1].help_sort_key || 0) < (opts.args[k2].help_sort_key || 0);
    });
    const lwidth = Math.max(...labels.map(l => l.length));
    function print(labeli, val='', gap=0) {
        let label = labeli;
        if ((typeof label === 'number')) {
            label = indent(labels[labeli], lwidth - labels[labeli].length);
        }
        let val_lines = indent(val, label.length + gap).split(/\r?\n/);
        let gapstr = new Array(Math.max(0, gap)).fill(' ').join('');
        console.log(label + gapstr + val_lines.shift().trimStart());
        if (val_lines.length > 0)
            console.log(val_lines.join('\n'));
    }
    print(0, `${cwht(opts.cmdname)} [<option> ...]\n`);
    opts.description && print(1, opts.description + '\n');
    print(2, '');
    let oindent = lwidth;
    for (let k of help_order) {
        let opt = k + (opts.args[k].arg ? ' ' + opts.args[k].arg : '');
        let value = (k == '-h' || opts.args[k].value == null) ? null : opts.args[k].value;
        let description = opts.args[k].description
            + (value == null ? '' : `\n  value: ${cfile(value)}`);
        print(indent(opt, oindent));
        print('', description + '\n', oindent + 4);
    }
}

function handle_help(opts) {
    if (opts.args['-h'].value) {
        print_help(opts);
        process.exit(0);
    }
}

exports.parse = (argv, opts) => {
    const cmdname = `${process.argv0 || path.basename(argv[0])} ${path.basename(argv[1])}`;
    const cdir = __dirname;
    opts.cmdname = cmdname;
    const _push = (a, ls) => { ls.push(...a); return ls; };
    argv = argv || process.argv;
    let thisargs = argv.slice(2).reduce((as, a) =>
        _push(a.startsWith('-') ? [...a.substring(1)].map(k => '-' + k) : [a], as)
        , []);
    let aarg;
    while ((aarg = thisargs.shift())) {
        set_arg(opts, aarg, thisargs);
    }
    handle_help(opts);
    return opts;
};
