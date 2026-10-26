import { IniFile, Palette, TmpFile, type MapFile, type Vfs } from '../ra2/index.js';
import { buildTileSlots, clearTileGlobalNum, theaterArtExt, theaterIniName } from '../ra2/theater.js';

export const CHUNK = 2048;

export interface TerrainChunk {
  /** Top-left of the chunk in battlefield pixels. */
  x: number;
  y: number;
  /** CHUNK×CHUNK RGBA pixels. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export interface Terrain {
  width: number;
  height: number;
  chunks: TerrainChunk[];
  /** Cells whose tile art couldn't be found. */
  missing: number;
}

/**
 * Paints every cell's TMP tile, cliff overhangs (`extra`) included, into CHUNK-sized RGBA buffers.
 * A cell sits at ((x-y)*30, (x+y-z)*15) like CNCMaps draws it; cells are painted back to front.
 */
export function bakeTerrain(map: MapFile, vfs: Vfs): Terrain {
  const theater = map.theater.toLowerCase();
  const need = (name: string) => {
    const bytes = vfs.openFile(name);
    if (!bytes) throw new Error(`Missing install file: ${name}`);
    return bytes;
  };
  const theaterIni = IniFile.parse(need(theaterIniName(theater)));
  const rgb = Palette.parse(need(`iso${theaterArtExt(theater)}.pal`)).rgb;
  const slots = buildTileSlots(theaterIni, theater);
  const clearNum = clearTileGlobalNum(theaterIni) ?? 0;

  const tmpCache = new Map<string, TmpFile | null>();
  const tmp = (file: string) => {
    if (!tmpCache.has(file)) {
      const bytes = vfs.openFile(file);
      tmpCache.set(file, bytes ? TmpFile.parse(bytes) : null);
    }
    return tmpCache.get(file)!;
  };

  const tiles = [...map.tiles].sort((a, b) => a.x + a.y - (b.x + b.y) || a.z - b.z);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) {
    const sx = (t.x - t.y) * 30, sy = (t.x + t.y - t.z) * 15;
    minX = Math.min(minX, sx - 60); minY = Math.min(minY, sy - 120);
    maxX = Math.max(maxX, sx + 120); maxY = Math.max(maxY, sy + 120);
  }
  const width = maxX - minX, height = maxY - minY;
  const cols = Math.ceil(width / CHUNK);
  const buffers: (Uint8ClampedArray<ArrayBuffer> | undefined)[] = [];
  const put = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const ci = Math.floor(y / CHUNK) * cols + Math.floor(x / CHUNK);
    const buf = (buffers[ci] ??= new Uint8ClampedArray(CHUNK * CHUNK * 4));
    const o = ((y % CHUNK) * CHUNK + (x % CHUNK)) * 4;
    buf[o] = rgb[v * 3]!; buf[o + 1] = rgb[v * 3 + 1]!; buf[o + 2] = rgb[v * 3 + 2]!; buf[o + 3] = 255;
  };

  let missing = 0;
  for (const t of tiles) {
    let num = t.tileNum, sub = t.subTile;
    if (num === 0xffff || num >= slots.length) num = clearNum;
    const file = tmp(slots[num]!.file);
    if (!file) { missing++; continue; }
    if (num === clearNum) sub = (t.x % file.blocksX) + (t.y % file.blocksY) * file.blocksX;
    const tile = sub < file.tileCount ? file.getTile(sub) : undefined;
    if (!tile) { missing++; continue; }
    const ox = (t.x - t.y) * 30 - minX, oy = (t.x + t.y - t.z) * 15 - minY;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 60; x++) {
      const v = tile.bitmap[y * 60 + x]!;
      if (v) put(ox + x, oy + y, v);
    }
    const e = tile.extra;
    if (e) {
      const ex = ox + e.x - tile.x, ey = oy + e.y - tile.y;
      for (let y = 0; y < e.height; y++) for (let x = 0; x < e.width; x++) {
        const v = e.bitmap[y * e.width + x]!;
        if (v) put(ex + x, ey + y, v);
      }
    }
  }

  const chunks: TerrainChunk[] = [];
  buffers.forEach((rgba, i) => {
    if (rgba) chunks.push({ x: (i % cols) * CHUNK, y: Math.floor(i / cols) * CHUNK, rgba });
  });
  return { width, height, chunks, missing };
}
