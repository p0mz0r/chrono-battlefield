import { ShpFile } from '../ra2/index.js';
import { foundation, isHighBridge } from './grid.js';
import type { Stock } from './stock.js';

/** One decoded SHP frame, shared by every object that draws it. */
export interface ObjectImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** An overlay, tree or building to draw: an image at a battlefield pixel position, sorted by `z`. */
export interface PlacedObject {
  image: number;
  x: number;
  y: number;
  /** Draw order: larger is in front. Ore and other flat overlay sit at -1, below everything. */
  z: number;
  kind: 'overlay' | 'tree' | 'building';
  cellX: number;
  cellY: number;
}

export interface Objects {
  images: ObjectImage[];
  objects: PlacedObject[];
  /** Types drawn in this map with no art in its theater (the support rule refuses the map). */
  missingArt: Set<string>;
  /** Trees and buildings that no type list (stock or the map's) names. */
  unknownTypes: Set<string>;
  /** `<building>: <overlay>` for building overlays with no art in this theater: skipped, the base still draws. */
  missingOverlays: Set<string>;
}

// Art keys a building draws over (or, the bib, under) its base image; undamaged and powered, the battlefield has neither.
const BUILDING_PARTS = ['ActiveAnim', 'ActiveAnimTwo', 'ActiveAnimThree', 'ActiveAnimFour', 'BibShape'];

// CNCMaps' high-bridge frame variation for frames 0 and 9 (FrameDeciders.cs @56712d7).
const BRIDGE_VARIATION = [0, 1, 2, 3, 3, 2, 1, 0, 2, 3, 0, 1, 1, 0, 3, 2];

/**
 * Places overlay, trees and buildings the way CNCMaps draws them: the SHP canvas centred on the cell's tile
 * top-left plus (30, 0) for overlay and buildings, (30, 15) for trees. `originX/Y` is the terrain's origin.
 */
export function placeObjects(stock: Stock, originX: number, originY: number): Objects {
  const { map } = stock;
  const out: Objects = { images: [], objects: [], missingArt: new Set(), unknownTypes: new Set(), missingOverlays: new Set() };
  const level = new Map<number, number>();
  for (const t of map.tiles) level.set(t.y * 1000 + t.x, t.z);
  const shps = new Map<string, ShpFile>();
  const images = new Map<string, number>();

  const place = (
    type: string, cx: number, cy: number, frame: number, pal: 'iso' | 'unit' | 'theater',
    dx: number, dy: number, z: number, kind: PlacedObject['kind'],
  ) => {
    const file = stock.artFile(type);
    if (!file) { out.missingArt.add(type); return; }
    let shp = shps.get(file);
    if (!shp) { shp = ShpFile.parse(stock.need(file)); shps.set(file, shp); }
    if (frame >= shp.count) frame = 0;
    const key = `${file}:${frame}:${pal}`;
    let image = images.get(key);
    if (image === undefined) {
      const f = shp.frame(frame), rgb = stock.palette(pal);
      if (!f.pixels.length) return;
      const rgba = new Uint8ClampedArray(f.cx * f.cy * 4);
      for (let p = 0; p < f.pixels.length; p++) {
        const v = f.pixels[p]!;
        if (!v) continue;
        rgba[p * 4] = rgb[v * 3]!; rgba[p * 4 + 1] = rgb[v * 3 + 1]!; rgba[p * 4 + 2] = rgb[v * 3 + 2]!; rgba[p * 4 + 3] = 255;
      }
      image = out.images.push({ width: f.cx, height: f.cy, rgba }) - 1;
      images.set(key, image);
    }
    const h = shp.frameHeader(frame), z0 = level.get(cy * 1000 + cx) ?? 0;
    out.objects.push({
      image, kind, cellX: cx, cellY: cy, z,
      x: (cx - cy) * 30 - originX + dx - Math.floor(shp.cx / 2) + h.x,
      y: (cx + cy - z0) * 15 - originY + dy - Math.floor(shp.cy / 2) + h.y,
    });
  };

  for (let cy = 0; cy < 512; cy++) for (let cx = 0; cx < 512; cx++) {
    const id = map.overlay[cy * 512 + cx]!;
    if (id === 0xff) continue;
    const type = stock.overlayTypes[id];
    if (!type) { out.unknownTypes.add(`overlay #${id}`); continue; }
    const rules = stock.rulesOf(type);
    let frame = map.overlayData[cy * 512 + cx]!;
    const depth = (cx + cy + 1) * 15;
    if (rules?.getBool('Tiberium')) place(type, cx, cy, frame, 'theater', 30, 3, -1, 'overlay');
    else if (rules?.getBool('Wall')) place(type, cx, cy, frame, 'unit', 30, 3, depth, 'overlay');
    else if (isHighBridge(type)) {
      if (frame === 0 || frame === 9) frame += BRIDGE_VARIATION[(cx & 3) | ((cy & 3) << 2)]!;
      place(type, cx, cy, frame, 'iso', 30, frame <= 8 ? -1 : -16, (cx + cy + 4) * 15, 'overlay');
    } else place(type, cx, cy, frame, 'iso', 30, 0, depth, 'overlay');
  }

  const trees = new Set(stock.typeList('TerrainTypes'));
  for (const t of map.terrainObjects) {
    if (!trees.has(t.type)) { out.unknownTypes.add(t.type); continue; }
    if (stock.invisible(t.type)) continue;
    const pal = stock.rulesOf(t.type)?.getBool('SpawnsTiberium') ? 'unit' : 'iso';
    place(t.type, t.x, t.y, 0, pal, 30, 15, (t.x + t.y + 2) * 15, 'tree');
  }

  const buildings = new Set(stock.typeList('BuildingTypes'));
  for (const s of map.structures) {
    if (s.x === undefined || s.y === undefined) continue;
    if (!buildings.has(s.type)) { out.unknownTypes.add(s.type); continue; }
    if (stock.invisible(s.type)) continue;
    const [fw, fh] = foundation(stock, s.type), z = (s.x + s.y + fw + fh) * 15;
    place(s.type, s.x, s.y, 0, 'unit', 30, 0, z, 'building');
    // Overlays are centred like the base (CNCMaps); a still frame (LoopStart) is enough. The bib lies under the base.
    const art = stock.artOf(s.type);
    for (const [i, key] of BUILDING_PARTS.entries()) {
      const part = art?.getString(key);
      if (!part) continue;
      if (!stock.artFile(part)) { out.missingOverlays.add(`${s.type}: ${part}`); continue; }
      const bib = key === 'BibShape';
      place(part, s.x, s.y, bib ? 0 : stock.art.getSection(part)?.getInt('LoopStart') ?? 0, 'unit', 30, 0, bib ? z - 1 : z + (i + 1) / 8, 'building');
    }
  }
  return out;
}
