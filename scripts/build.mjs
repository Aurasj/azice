import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {buildConfig,configScript} from './config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// Explicit allowlist: never publish the whole repository.
const files = [
  'index.html',
  'styles.css',
  'app.js',
  'src/presentation.js',
  'src/auth-helpers.js',
  'src/image-processing.js',
  'src/demo.js',
  'src/cloud.js',
  'cloud.js',
  'demo.js',
  'config.js',
  'manifest.webmanifest',
  'sw.js',
  'push-sw.js',
];
const directories = ['assets'];

const args=process.argv.slice(2);
if(args.length>1||args.some(arg=>!['--production','--local'].includes(arg)))throw Error('Use no option (demo), --local or --production.');
const {mode,config}=buildConfig(root,{mode:args[0]?.slice(2)||'demo'});

for (const entry of [...files, ...directories]) {
  if (!existsSync(join(root, entry))) throw new Error(`Missing build input: ${entry}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const file of files) {
  const dest = join(dist, file);
  mkdirSync(dirname(dest), { recursive: true });
  if(file==='config.js')writeFileSync(dest,configScript(config));
  else copyFileSync(join(root, file), dest);
}
for (const dir of directories) {
  // Keep the approved source and editing master locally; publish optimized icon exports.
  const authoringAssets = new Set([join(root, 'assets', 'logo.png'), join(root, 'assets', 'azice-mascot-master-v2.png')]);
  cpSync(join(root, dir), join(dist, dir), { recursive: true, filter: source => !authoringAssets.has(source) });
}

console.log('AziCe? '+mode+' build complete: dist/ (public frontend files only)');
