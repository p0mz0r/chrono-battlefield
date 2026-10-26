import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Dev only: serves the install in RA2_DIR under /ra2/ for readInstall (ADR 0004). */
function serveInstall(): Plugin {
  return {
    name: 'serve-install',
    configureServer(server) {
      server.middlewares.use('/ra2', (req, res) => {
        const root = process.env.RA2_DIR;
        if (!root) {
          res.statusCode = 500;
          res.end('RA2_DIR is not set');
          return;
        }
        const base = resolve(root);
        const file = resolve(base, '.' + decodeURIComponent(new URL(req.url!, 'http://x').pathname));
        const stat = file.startsWith(base + sep) ? statSync(file, { throwIfNoEntry: false }) : undefined;
        if (!stat?.isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Length', stat.size);
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Relative asset URLs: OBS loads dist/index.html from http://absolute/<path>/.
export default defineConfig({ base: './', plugins: [serveInstall()] });
