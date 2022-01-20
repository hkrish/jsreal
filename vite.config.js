const path = require('path');
const { defineConfig } = require('vite');
const jsmacro = require('./tools/jsmacro.min.js');

// import Inspect from 'vite-plugin-inspect';


function jsmacro_expand() {
    return {
        name: 'jsmacro-expand',
        transform(src, id) {
            if (/\.(jsmacro)$/.test(id)) {
                return {code: '', map: null};
            } else if (/\.(ts)$/.test(id)) {
                let expenv = new jsmacro.Expander();
                let imprgx = /^\s*\/\/!\s*import\s+['"](.*?\.jsmacro)['"];$/mg;
                let imports = src.matchAll(imprgx);
                for(let f of imports) {
                    let fname = path.join(path.dirname(id), f[1]);
                    let typedefs = path.join(path.dirname(fname), path.basename(f[1]) + '.d.ts');
                    expenv.load_module(fname);
                    expenv.save_types(typedefs);
                }
                src = expenv.expand_macros_full_parse(src);
                return {
                    code: src,
                    map: null
                };
            }
            return undefined;
        }
    };
}


module.exports = defineConfig(({command, mode}) => {
    let config = {
        plugins: [
            // Inspect(),
            jsmacro_expand()
        ],
        esbuild: { legalComments: 'eof' }
    };
    if (mode === 'production') {
        config.build = {
            minify: true,
            lib: {
                entry: path.resolve(__dirname, 'src/jsreal.ts'),
                name: 'scenery',
                fileName: (format) => `jsreal.${format}.js`,
            },
            terserOptions: {
                compress: {
                    keep_infinity: true
                }
            }
        };
    }
    return config;
});
