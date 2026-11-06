/**
 * Tiny dependency-free static file server for tests (Node built-ins only).
 * Serves the repo root over http://127.0.0.1:<random port> so pages load the
 * same way they do on the live host (self-hosted fonts need http, not file://).
 */
import http from 'http';
import { readFile, stat } from 'fs/promises';
import path from 'path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export function startStaticServer(root, port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(root)) throw new Error('outside root');
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      });
      res.end(await readFile(file));
    } catch {
      let body = 'Not found';
      try {
        body = await readFile(path.join(root, '404.html'));
      } catch {}
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ server, base: `http://127.0.0.1:${actual}` });
    });
  });
}
