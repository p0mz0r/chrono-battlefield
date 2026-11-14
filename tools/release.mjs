// After `vite build`: credit shipped custom maps in the operator README (ADR 0006), refuse any EA file type,
// build the launcher with dist/ inside (ADR 0009, needs Go on PATH), and zip it with the README and LICENSE as
// release/rhino-race.zip (one rhino-race/ folder inside). The courses in release-courses/ (course files as in courses/, or
// exported .rhino-course.json files) ship as export files in rhino-race/courses/, which the game imports on every start (#161).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const courses = readdirSync('courses').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join('courses', f), 'utf8')));
const credits = courses.filter((c) => c.source === 'shipped').map((c) => `  ${c.map}, by ${c.author}: ${c.link} (course "${c.name}")`);
if (credits.length) writeFileSync('dist/README.txt', readFileSync('dist/README.txt', 'utf8') + `\n\nCUSTOM MAPS\n-----------\n\n${credits.join('\n')}\n`);

const walk = (dir) => readdirSync(dir).flatMap((f) => statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]);
const ea = walk('dist').filter((name) => /\.(mix|mmx|yro|bag|idx|shp|vxl|hva|tmp|tem|sno|urb|ubn|des|lun|pal|csf|wav|aud)$/i.test(name));
if (ea.length) throw new Error(`EA file types in the build: ${ea.map((name) => relative('dist', name)).join(', ')}`);

// The launcher embeds launcher/dist (go:embed); its .gitkeep lets it compile before a build.
rmSync('launcher/dist', { recursive: true, force: true });
cpSync('dist', 'launcher/dist', { recursive: true });
writeFileSync('launcher/dist/.gitkeep', '');
mkdirSync('release', { recursive: true });
execFileSync('go', ['build', '-ldflags', '-H windowsgui -s -w', '-o', '../release/rhino-race.exe', '.'], {
  cwd: 'launcher', stdio: 'inherit', env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' },
});
// A plain course on an install map becomes an export file by wrapping it; a custom map would have to travel inside it.
rmSync('release/courses', { recursive: true, force: true });
mkdirSync('release/courses');
const releaseCourses = (existsSync('release-courses') ? readdirSync('release-courses') : []).filter((f) => f.endsWith('.json')).map((f) => {
  const data = JSON.parse(readFileSync(join('release-courses', f), 'utf8')), name = `${f.replace(/(\.rhino-course)?\.json$/, '')}.rhino-course.json`;
  if (data.format !== 'rhino-course' && data.source !== 'install') throw new Error(`release-courses/${f}: export a custom-map course from the editor (Download course file)`);
  writeFileSync(join('release/courses', name), data.format === 'rhino-course' ? JSON.stringify(data) : JSON.stringify({ format: 'rhino-course', version: 1, course: data }));
  return name;
});
const files = [['rhino-race.exe', 'release/rhino-race.exe'], ['README.txt', 'dist/README.txt'], ['LICENSE', 'LICENSE'], ['courses/'],
  ...releaseCourses.map((f) => [`courses/${f}`, join('release/courses', f)])];

// Minimal zip: deflated entries, no extra fields, no zip64 (fine below 4 GB).
const local = [], central = [];
let offset = 0;
const now = new Date(), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
for (const [name, path] of files) {
  // A folder entry (no path) is stored empty, so the folder exists for course files the operator adds.
  const data = path ? readFileSync(path) : Buffer.alloc(0), packed = path ? deflateRawSync(data) : data, nameBytes = Buffer.from(`rhino-race/${name}`);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(path ? 8 : 0, 8); header.writeUInt16LE(date, 12);
  header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); header.copy(entry, 8, 6, 30); entry.writeUInt32LE(offset, 42);
  local.push(header, nameBytes, packed); central.push(entry, nameBytes);
  offset += header.length + nameBytes.length + packed.length;
}
const dir = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
writeFileSync('release/rhino-race.zip', Buffer.concat([...local, dir, end]));
console.log(`release/rhino-race.zip: ${files.length} entries, ${releaseCourses.length} release courses`);
