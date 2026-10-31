import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const common = { bundle: true, sourcemap: true, logLevel: 'info', minify: !watch };

const targets = [
  {
    ...common,
    entryPoints: ['src/extension/extension.js'],
    outfile: 'dist/extension.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['vscode', 'pg-native'], // pg-native is an optional add-on of pg
  },
  {
    ...common,
    entryPoints: ['src/webview/main.js', 'src/webview/styles.css'],
    outdir: 'dist',
    entryNames: 'webview',
    platform: 'browser',
    format: 'iife',
    // The webview CSP allows no remote resources, so fonts and images are inlined.
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
  },
  {
    ...common,
    entryPoints: ['src/webview/runMain.js', 'src/webview/run.css'],
    outdir: 'dist',
    entryNames: 'run-webview',
    platform: 'browser',
    format: 'iife',
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
  },
  {
    ...common,
    entryPoints: ['src/webview/dmnMain.js', 'src/webview/dmn.css'],
    outdir: 'dist',
    entryNames: 'dmn-webview',
    platform: 'browser',
    format: 'iife',
    loader: { '.json': 'json' },
  },
];

for (const t of targets) {
  if (watch) await (await esbuild.context(t)).watch();
  else await esbuild.build(t);
}
