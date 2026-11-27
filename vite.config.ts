/// <reference types="vitest/config" />
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { importBattlefield } from './src/battlefield/import.js';
import { freeMapName, inspectCourse, mapUpload } from './src/race/editorModel.js';
import { courseSlug, isCourseFile, type CourseFile } from './src/race/course.js';

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
        const range = req.headers.range;
        const match = range && /^bytes=(\d+)-(\d+)$/.exec(range);
        if (range && (!match || Number(match[1]) > Number(match[2]) || Number(match[2]) >= stat.size)) {
          res.statusCode = 416;
          res.setHeader('Content-Range', `bytes */${stat.size}`);
          res.end();
          return;
        }
        const start = match ? Number(match[1]) : 0, end = match ? Number(match[2]) : stat.size - 1;
        if (match) {
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        }
        res.setHeader('Content-Length', end - start + 1);
        createReadStream(file, { start, end }).pipe(res);
      });
    },
  };
}

/** Every `courses/*.json`, with its file name (no `.json`). */
const savedCourses = () => readdirSync('courses').filter((name) => name.endsWith('.json'))
  .map((name) => ({ ...JSON.parse(readFileSync(resolve('courses', name), 'utf8')) as CourseFile, file: name.slice(0, -5) }));

/** The only write surface: a bounded JSON course or credited custom map inside courses/. Dev server only. */
function saveCourse(): Plugin {
  return {
    name: 'save-course',
    configureServer(server) {
      server.middlewares.use('/__course', (req, res) => {
        const url = new URL(req.url!, 'http://dev');
        if (req.method === 'GET' && url.pathname === '/list') { // read-only: the editor's Open menu
          const root = process.env.RA2_DIR, dir = resolve('courses/maps');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            courses: savedCourses().map(({ file, name, map, source }) => ({ file, name, map, source })),
            installMaps: root ? readdirSync(root).filter((name) => /\.(mmx|yro)$/i.test(name)) : [],
            customMaps: existsSync(dir) ? readdirSync(dir).filter((name) => /\.(map|yrm|mpr)$/i.test(name)) : [],
          }));
          return;
        }
        const mapName = url.pathname.startsWith('/map/') ? decodeURIComponent(url.pathname.slice(5)) : '';
        if (!((req.method === 'POST' && url.pathname === '/save') || (req.method === 'PUT' && mapName))) { res.statusCode = 404; res.end(); return; }
        const chunks: Buffer[] = []; let length = 0;
        req.on('data', (part: Buffer) => {
          length += part.length;
          if (length > 10 * 1024 * 1024) req.destroy(); else chunks.push(part);
        });
        req.on('end', async () => {
          try {
            if (mapName) {
              if (!/^[\w.-]+\.(map|yrm|mpr)$/i.test(mapName) || mapName.includes('..')) throw new Error('Invalid map name');
              const dir = resolve('courses/maps'), path = resolve(dir, mapName), bytes = new Uint8Array(Buffer.concat(chunks));
              mkdirSync(dir, { recursive: true });
              const decision = mapUpload(existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined, bytes);
              if (decision === 'conflict' && url.searchParams.get('replace') !== '1') {
                res.statusCode = 409;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  message: `A map named ${mapName} already exists, with different contents.`,
                  suggested: freeMapName(mapName, (name) => existsSync(resolve(dir, name))),
                  usedBy: savedCourses().filter((c) => c.source === 'shipped' && c.map.toLowerCase() === mapName.toLowerCase()).map((c) => c.name),
                }));
                return;
              }
              if (decision !== 'same') writeFileSync(path, bytes);
              res.end(mapName);
              return;
            }
            const file = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
            if (!isCourseFile(file)) throw new Error('Invalid course file');
            const slug = courseSlug(file.name);
            if (!slug) throw new Error('Name must contain a letter or number');
            if (file.source === 'shipped' && (!statSync(resolve('courses/maps', file.map), { throwIfNoEntry: false })?.isFile() || !file.author.trim() || !file.link.trim())) throw new Error('Custom map needs a saved map, author and source link');
            if (file.source === 'install' && !process.env.RA2_DIR) throw new Error('RA2_DIR is not set');
            const read = async (name: string, offset?: number, size?: number): Promise<Uint8Array> => {
              const path = resolve(name === file.map && file.source === 'shipped' ? resolve('courses/maps') : resolve(process.env.RA2_DIR!), name);
              const base = name === file.map && file.source === 'shipped' ? resolve('courses/maps') : resolve(process.env.RA2_DIR!);
              if (!path.startsWith(base + sep)) throw new Error('Invalid read path');
              if (offset === undefined) return new Uint8Array(await readFile(path));
              const handle = await open(path, 'r');
              try { const buffer = new Uint8Array(size!); const { bytesRead } = await handle.read(buffer, 0, size!, offset); return buffer.subarray(0, bytesRead); }
              finally { await handle.close(); }
            };
            const bytes = await read(file.map);
            const battlefield = await importBattlefield(read, file.map);
            const result = inspectCourse(file, bytes, battlefield.grid);
            if (result.errors.length) throw new Error(result.errors.join(' '));
            const path = resolve('courses', `${slug}.json`);
            // Same slug, different course: only over the editor's own file, or once the course maker agreed.
            if (existsSync(path) && slug !== url.searchParams.get('origin') && url.searchParams.get('overwrite') !== '1') {
              const other = JSON.parse(readFileSync(path, 'utf8')) as CourseFile;
              res.statusCode = 409;
              res.end(`Another course, "${other.name}" on ${other.map}, is saved as courses/${slug}.json. Replace it?`);
              return;
            }
            writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
            res.end(`courses/${slug}.json`);
          } catch (error) { res.statusCode = 400; res.end(error instanceof Error ? error.message : String(error)); }
        });
      });
    },
  };
}

// Relative asset URLs: OBS loads dist/index.html from http://absolute/<path>/.
export default defineConfig({ base: './', plugins: [serveInstall(), saveCourse()],
  // Only this checkout's tests: agent worktrees can sit inside the repo folder.
  test: { include: ['src/**/*.test.ts', 'extension-backend/src/**/*.test.ts'] } });
