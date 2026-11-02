/** Minimal static file server for local evidence capture and docs checks. Binds to 127.0.0.1 only. */
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Static file server with SPA fallback. Refuses paths that escape the root. */
export function serveStatic(root: string): Promise<{ server: Server; url: string }> {
  const rootAbs = resolve(root);
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = normalize(join(rootAbs, urlPath));
    if (!file.startsWith(rootAbs + sep) && file !== rootAbs) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || !extname(file)) file = join(rootAbs, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      ok({ server, url: `http://127.0.0.1:${port}/` });
    }),
  );
}
