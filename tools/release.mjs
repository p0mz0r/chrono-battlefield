// After `vite build`: credit shipped custom maps in the operator README (ADR 0006), refuse any EA file type,
// and zip dist/ plus LICENSE as release/rhino-race.zip (one rhino-race/ folder inside).
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const courses = readdirSync('courses').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join('courses', f), 'utf8')));
const credits = courses.filter((c) => c.source === 'shipped').map((c) => `  ${c.map}, by ${c.author}: ${c.link} (course "${c.name}")`);
if (credits.length) writeFileSync('dist/README.txt', readFileSync('dist/README.txt', 'utf8') + `\n\nCUSTOM MAPS\n-----------\n\n${credits.join('\n')}\n`);

const walk = (dir) => readdirSync(dir).flatMap((f) => statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]);
const files = [...walk('dist').map((path) => [relative('dist', path).replaceAll('\\', '/'), path]), ['LICENSE', 'LICENSE']];
const ea = files.filter(([name]) => /\.(mix|mmx|yro|bag|idx|shp|vxl|hva|tmp|tem|sno|urb|ubn|des|lun|pal|csf|wav|aud)$/i.test(name));
if (ea.length) throw new Error(`EA file types in the build: ${ea.map(([name]) => name).join(', ')}`);

// Minimal zip: deflated entries, no extra fields, no zip64 (fine below 4 GB).
const local = [], central = [];
let offset = 0;
const now = new Date(), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
for (const [name, path] of files) {
  const data = readFileSync(path), packed = deflateRawSync(data), nameBytes = Buffer.from(`rhino-race/${name}`);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(date, 12);
  header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); header.copy(entry, 8, 6, 30); entry.writeUInt32LE(offset, 42);
  local.push(header, nameBytes, packed); central.push(entry, nameBytes);
  offset += header.length + nameBytes.length + packed.length;
}
const dir = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
mkdirSync('release', { recursive: true });
writeFileSync('release/rhino-race.zip', Buffer.concat([...local, dir, end]));
console.log(`release/rhino-race.zip: ${files.length} files`);
