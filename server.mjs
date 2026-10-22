import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(reqUrl.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const safePath = path.normalize(path.join(__dirname, pathname));
  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType };

    if (pathname === '/config.js') {
      headers['Cache-Control'] = 'no-store';
    } else if (pathname === '/sw.js') {
      headers['Cache-Control'] = 'no-cache';
    }

    res.writeHead(200, headers);
    fs.createReadStream(safePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AziCe? local server running at http://localhost:${PORT}`);
});
