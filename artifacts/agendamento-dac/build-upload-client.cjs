const { build } = require('vite');

build({
    configFile: false,
    build: {
        outDir: 'dist/public',
        emptyOutDir: false,
        target: 'es2020',
        minify: true,
        lib: {
            entry: 'upload-client-entry.js',
            name: 'DacUploadClient',
            formats: ['iife'],
            fileName: () => 'upload-client.js'
        }
    }
}).catch(error => {
    console.error('Não foi possível criar o cliente de upload:', error);
    process.exitCode = 1;
});
