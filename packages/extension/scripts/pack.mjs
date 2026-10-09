/* global console, process */
// Packages packages/extension/dist into a Chrome Web Store upload zip:
// parklet-extension-<manifest version>.zip (manifest.json at the archive root,
// source maps excluded). Requires the `zip` binary on PATH.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

let version;
try {
  version = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')).version;
} catch {
  console.error('dist/manifest.json not found — run `pnpm run build` first.');
  process.exit(1);
}

const out = join(root, `parklet-extension-${version}.zip`);
execFileSync('zip', ['-r', '-FS', out, '.', '-x', '*.map', '*.DS_Store'], {
  cwd: dist,
  stdio: 'inherit',
});
console.log(`extension package: ${out}`);
