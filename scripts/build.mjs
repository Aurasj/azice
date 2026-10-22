import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// Explicit allowlist: never publish the whole repository.
const files = [
  'index.html',
  'styles.css',
  'app.js',
  'cloud.js',
  'demo.js',
  'config.js',
  'manifest.webmanifest',
  'sw.js',
];
const directories = ['assets'];

const config = readFileSync(join(root, 'config.js'), 'utf8');
if (!/supabaseUrl:\s*['"]https:\/\/[^'"]+\.supabase\.co['"]/.test(config)) {
  throw new Error('Build stopped: config.js has no valid Supabase project URL.');
}
if (!/supabasePublishableKey:\s*['"](?:sb_publishable_[^'"]+|eyJ[^'"]+)['"]/.test(config)) {
  throw new Error('Build stopped: config.js must contain only a public publishable/anon key.');
}
if (/sb_secret_|service_role|SUPABASE_SERVICE_ROLE_KEY/i.test(
  config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
)) {
  throw new Error('Build stopped: possible secret key in config.js.');
}

for (const entry of [...files, ...directories]) {
  if (!existsSync(join(root, entry))) throw new Error(`Missing build input: ${entry}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const file of files) {
  const dest = join(dist, file);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(root, file), dest);
}
for (const dir of directories) {
  cpSync(join(root, dir), join(dist, dir), { recursive: true });
}

console.log('AziCe? build complete: dist/ (public frontend files only)');
