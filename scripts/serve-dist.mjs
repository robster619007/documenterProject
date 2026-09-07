// Minimal static file server for the Lighthouse run. LHCI's own staticDistDir
// autodiscovery silently caps at ~5 pages, so instead we serve the public build on
// a fixed port and let lighthouserc.cjs list every URL explicitly. Serves the dir
// named by LH_DIST (the dev-free copy made by run-lh.mjs), defaulting to ./dist.
//
// Dev/test-only, and never part of the shipped site.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const dir = process.env.LH_DIST || './dist';
const port = Number(process.env.LH_PORT || 43210);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Resolves a request path to a file inside the served dir, mapping a trailing
// slash (or extension-less path) to that directory's index.html.
async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  let filePath = join(dir, clean);
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    if (extname(filePath) === '') filePath = join(dir, clean, 'index.html');
  }
  return filePath;
}

const server = createServer(async (req, res) => {
  try {
    const filePath = await resolveFile(req.url || '/');
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(port, () => {
  // run-lh/lhci waits for this line (startServerReadyPattern).
  console.log(`serving ${dir} on http://localhost:${port}`);
});
