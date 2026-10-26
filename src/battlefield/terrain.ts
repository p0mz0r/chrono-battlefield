import { IniFile, TmpFile, type IsoTile, type TmpTile } from '../ra2/index.js';
import { buildTileSlots, clearTileGlobalNum, theaterIniName } from '../ra2/theater.js';
import type { Stock } from './stock.js';

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
  /** Battlefield pixel (0, 0) in CNCMaps screen space: a cell's tile sits at ((x-y)*30 - originX, (x+y-z)*15 - originY). */
  originX: number;
  originY: number;
  /** Cells whose tile art couldn't be found. */
  missing: number;
}

/** Resolves a map cell to the TMP tile that draws it in the theater, or undefined if its art is missing. */
export function tileLookup(stock: Stock): (t: IsoTile) => TmpTile | undefined {
  const theaterIni = IniFile.parse(stock.need(theaterIniName(stock.theater)));
  const slots = buildTileSlots(theaterIni, stock.theater);
  const clearNum = clearTileGlobalNum(theaterIni) ?? 0;
  const tmpCache = new Map<string, TmpFile | null>();
  const tmp = (file: string) => {
    if (!tmpCache.has(file)) {
      const bytes = stock.vfs.openFile(file);
      tmpCache.set(file, bytes ? TmpFile.parse(bytes) : null);
    }
    return tmpCache.get(file)!;
  };
  return (t) => {
    let num = t.tileNum, sub = t.subTile;
    if (num === 0xffff) num = clearNum;
    const slot = slots[num];
    if (!slot) return undefined;
    const file = tmp(slot.file);
    if (!file) return undefined;
    if (num === clearNum) sub = (t.x % file.blocksX) + (t.y % file.blocksY) * file.blocksX;
    return sub < file.tileCount ? file.getTile(sub) : undefined;
  };
}

/**
 * Paints every cell's TMP tile, cliff overhangs (`extra`) included, into CHUNK-sized RGBA buffers.
 * A cell sits at ((x-y)*30, (x+y-z)*15) like CNCMaps draws it; cells are painted back to front.
 */
export function bakeTerrain(stock: Stock): Terrain {
  const rgb = stock.palette('iso');
  const tileAt = tileLookup(stock);
  const tiles = [...stock.map.tiles].sort((a, b) => a.x + a.y - (b.x + b.y) || a.z - b.z);
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
    const tile = tileAt(t);
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
  return { width, height, chunks, originX: minX, originY: minY, missing };
}
