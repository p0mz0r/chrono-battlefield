// PROTOTYPE dev server: serves this folder at / and the RA2 install at /ra2/.
// Also the "localhost static server" route from issue #4.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const RA2_DIR = process.env.RA2_DIR ?? 'D:/GAMES/Origin/Command and Conquer Red Alert II';
const HERE = import.meta.dirname;
const PORT = Number(process.env.PORT ?? 5173);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const [base, rel] = path.startsWith('/ra2/') ? [RA2_DIR, path.slice(5)] : [HERE, path === '/' ? 'index.html' : path.slice(1)];
  const file = resolve(join(base, rel));
  if (!file.startsWith(resolve(base) + sep)) return res.writeHead(403).end();
  try {
    const { size } = statSync(file);
    res.writeHead(200, { 'content-length': size, 'content-type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`PROTOTYPE on http://localhost:${PORT}/  (install: ${RA2_DIR})`));
