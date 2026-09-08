/* global console */
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, 'dist');

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  sourcemap: true,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...common,
    entryPoints: [join(root, 'src/background.ts')],
    outfile: join(outdir, 'background.js'),
  }),
  build({
    ...common,
    entryPoints: [join(root, 'src/content.ts')],
    outfile: join(outdir, 'content.js'),
  }),
  build({
    ...common,
    entryPoints: [join(root, 'src/popup.ts')],
    outfile: join(outdir, 'popup.js'),
  }),
]);

// 静态资源复制
for (const file of ['manifest.json', 'popup.html', 'popup.css']) {
  copyFileSync(join(root, file), join(outdir, file));
}

console.log('extension build: done →', outdir);
