import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('server: serves index.html, static assets, and proper headers', async (t) => {
  const serverProcess = spawn(process.execPath, ['server.mjs'], {
    cwd: rootDir,
    env: { ...process.env, PORT: '5199' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  t.after(() => {
    serverProcess.kill('SIGTERM');
  });

  // Wait for server to start listening
  await new Promise((resolve, reject) => {
    serverProcess.stdout.on('data', data => {
      if (data.toString().includes('running at')) resolve();
    });
    serverProcess.stderr.on('data', data => {
      console.error('Server err:', data.toString());
    });
    serverProcess.on('error', reject);
    setTimeout(() => reject(new Error('Server start timeout')), 3000);
  });

  // Test root /
  const resRoot = await fetch('http://127.0.0.1:5199/');
  assert.equal(resRoot.status, 200);
  assert.match(resRoot.headers.get('content-type'), /text\/html/);
  const html = await resRoot.text();
  assert.ok(html.includes('<title>AziCe?</title>'));

  // Test styles.css
  const resCss = await fetch('http://127.0.0.1:5199/styles.css');
  assert.equal(resCss.status, 200);
  assert.match(resCss.headers.get('content-type'), /text\/css/);

  // Test config.js (Cache-Control: no-store)
  const resConfig = await fetch('http://127.0.0.1:5199/config.js');
  assert.equal(resConfig.status, 200);
  assert.equal(resConfig.headers.get('cache-control'), 'no-store');

  // Test manifest
  const resManifest = await fetch('http://127.0.0.1:5199/manifest.webmanifest');
  assert.equal(resManifest.status, 200);
  assert.match(resManifest.headers.get('content-type'), /application\/manifest\+json/);

  // Test 404
  const resNotFound = await fetch('http://127.0.0.1:5199/non-existent-file.xyz');
  assert.equal(resNotFound.status, 404);
});
