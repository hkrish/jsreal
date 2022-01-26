process = require('process');


function curry (f, as=[]) {
    return (...b) => {
        let args = as.concat(b);
        return (args.length >= f.length) ? f(...args) : curry(f, args);
    };
}

exports.curry = curry;

// ----- Formatting -----
const _fmt = (n, s) => `\x1b[${n}m${s}\x1b[0m`;

exports.cfile = (s) => { return _fmt(34, s); };
exports.cgain = (s) => { return _fmt('32;7', s); };
exports.closs = (s) => { return _fmt('37;41', s); };
exports.cbold = (s) => { return _fmt('1', s); };
exports.cwht = (s) => { return _fmt('37', s); };
exports.clear = () => process.stdout.write('\x1bc');

const spaces = n => new Array(Math.max(0, n)).fill(' ').join('');

const indent = (s, w) => s.split(/\r?\n/).map(l => spaces(w) + l).join('\n');
exports.indent = indent;

const prwid = s => s.replace(/\x1b\[[0-9;]*m/g, '').length;
exports.printwidth = prwid;

exports.alignl = (s, w) => s.split(/\r?\n/).map(l => l + spaces(w - prwid(l))).join('\n');

exports.alignr = (s, w) => s.split(/\r?\n/).map(l => spaces(w - prwid(l)) + l).join('\n');

exports.alignc = (s, w) => s.split(/\r?\n/).map(l => {
    let w1 = Math.floor((w - prwid(l)) / 2);
    return spaces(w1) + l + spaces(w - w1);
}).join('\n');

// Units must be an array of pairs in the form [multiplier, unit-string], sorted in
// increasing order of multipliers.
exports.unitref = curry((units, np, v) => {
    v = Number(v);
    for (let i = 0, j = 0; i < units.length; j=i, ++i) {
        if ((v / units[i][0]) < 1) {
            return (v / units[j][0]).toFixed(np) + units[j][1];
        }
    }
    return v.toFixed(np) + units[0][1];
});

exports.unitref_s = curry((units, np, v) => {
    v = Number(v);
    for (let i = 0, j = 0; i < units.length; j=i, ++i) {
        if ((v / units[i][0]) < 1) {
            return [(v / units[j][0]).toFixed(np), units[j][1]];
        }
    }
    return [v.toFixed(np), units[0][1]];
});

exports.print_labelled = (initindent, label, val='', gap=0, extraindent=0, is_err=false) => {
    const prf = is_err ? console.error : console.log;
    let val_lines = indent(val, initindent + prwid(label) + gap).split(/\r?\n/);
    let gapstr = spaces(gap);
    prf(indent(label + gapstr + val_lines.shift().trimStart(), initindent));
    if (val_lines.length > 0)
        prf(indent(val_lines.join('\n'), initindent + extraindent));
};
