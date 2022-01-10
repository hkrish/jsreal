const path = require('path');
const { defineConfig } = require('vite');


module.exports = defineConfig(({command, mode}) => {
    let config = {
        plugins: [],
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
