import type { CellGrid } from '../movement/index.js';
import { IniFile, TmpFile, type MapFile, type Vfs } from '../ra2/index.js';
import { buildTileSlots, clearTileGlobalNum, theaterIniName } from '../ra2/theater.js';

// ponytail: stopgap passability for #37 from tile terrain bytes, ore/wall overlays and trees only.
// #36's battlefield cell grid replaces this file (ramps/levels, cliff-back Rock, buildings, bridge decks).

/** rulesmd `Track=` per land type (docs/research/ra2-locomotion.md §3). */
const LAND_SPEED: Record<string, number> = {
  clear: 1, road: 1, rough: 1, railroad: 1, tunnel: 1, ice: 0.8, tiberium: 0.7, weeds: 0.7,
  water: 0, rock: 0, wall: 0, beach: 0,
};
/** TMP per-cell terrain byte → land type (OpenRA LegacyTilesetImporter.cs @25188e8; byte 10 "Beach" is water). */
const BYTE_LAND = [
  'clear', 'clear', 'ice', 'ice', 'ice', 'tunnel', 'railroad', 'rock',
  'rock', 'water', 'beach', 'road', 'road', 'clear', 'rough', 'rock',
];

export interface TileGrid extends CellGrid {
  /** Height level of a cell, for drawing. */
  level(x: number, y: number): number;
}

export function tileGrid(map: MapFile, vfs: Vfs): TileGrid {
  const theater = map.theater.toLowerCase();
  const ini = (name: string) => {
    const bytes = vfs.openFile(name);
    if (!bytes) throw new Error(`Missing install file: ${name}`);
    return IniFile.parse(bytes);
  };
  const theaterIni = ini(theaterIniName(theater));
  const rules = ini('rulesmd.ini');
  const slots = buildTileSlots(theaterIni, theater);
  const clearNum = clearTileGlobalNum(theaterIni) ?? 0;
  const tmps = new Map<string, TmpFile | null>();
  const tmp = (file: string) => {
    if (!tmps.has(file)) {
      const bytes = vfs.openFile(file);
      tmps.set(file, bytes ? TmpFile.parse(bytes) : null);
    }
    return tmps.get(file)!;
  };

  let width = 0, height = 0;
  for (const t of map.tiles) { width = Math.max(width, t.x + 1); height = Math.max(height, t.y + 1); }
  const speed = new Float32Array(width * height); // cells without a tile stay 0 = blocked
  const level = new Uint8Array(width * height);
  for (const t of map.tiles) {
    let num = t.tileNum, sub = t.subTile;
    if (num === 0xffff || num >= slots.length) num = clearNum;
    const file = tmp(slots[num]!.file);
    if (!file) continue;
    if (num === clearNum) sub = (t.x % file.blocksX) + (t.y % file.blocksY) * file.blocksX;
    const tile = sub < file.tileCount ? file.getTile(sub) : undefined;
    const i = t.y * width + t.x;
    speed[i] = LAND_SPEED[BYTE_LAND[tile?.terrainType ?? 0]!]!;
    level[i] = t.z;
  }

  // Overlays: the index is the position in rulesmd [OverlayTypes].
  const overlayTypes = rules.readRegistry('OverlayTypes');
  const overlaySpeed = overlayTypes.map((name) => {
    const s = rules.getSection(name);
    if (!s) return undefined;
    if (s.getBool('Wall')) return 0;
    const land = s.getString('Land').toLowerCase();
    if (land) return LAND_SPEED[land];
    return s.getBool('Tiberium') ? LAND_SPEED.tiberium : undefined;
  });
  const overlay = map.overlay;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = overlay[y * 512 + x]!;
    const s = o === 0xff ? undefined : overlaySpeed[o];
    if (s !== undefined) speed[y * width + x] = s;
  }
  for (const tree of map.terrainObjects) if (tree.x < width && tree.y < height) speed[tree.y * width + tree.x] = 0;

  return {
    width, height,
    speed: (x, y) => speed[y * width + x]!,
    level: (x, y) => level[y * width + x] ?? 0,
  };
}
