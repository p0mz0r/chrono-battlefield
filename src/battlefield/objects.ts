import { HvaFile, Palette, ShpFile, VxlFile, type IniSection } from '../ra2/index.js';
import { GAMEMD_CAMERA, renderTurretToSprite } from '../ra2/render/voxelRender.js';
import type { ConvertedSprite } from '../ra2/render/sprite.js';
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

// Art keys a building draws over (or, the bib, under) its base image: at rest (IdleAnim, not SpecialAnim), undamaged and powered.
const BUILDING_PARTS = ['ActiveAnim', 'ActiveAnimTwo', 'ActiveAnimThree', 'ActiveAnimFour', 'IdleAnim', 'IdleAnimTwo', 'BibShape'];

// CNCMaps' high-bridge frame variation for frames 0 and 9 (FrameDeciders.cs @56712d7).
const BRIDGE_VARIATION = [0, 1, 2, 3, 3, 2, 1, 0, 2, 3, 0, 1, 1, 0, 3, 2];

/**
 * gamemd's Y offset for an overlay off a high-bridge deck (0x5FDCC0 plus 0x480110), plus 15 for our tile-top anchor.
 * CNCMaps drew the plain case at 0, 15 px too high (docs/research/ra2-low-bridge-offset.md).
 */
export function overlayDy(rules: IniSection | undefined, id: number): number {
  let y = rules?.getBool('Tiberium') || rules?.getBool('Wall') || rules?.getBool('Crate') || id === 126 ? -12 : 0;
  if (rules?.getString('Land')?.toLowerCase() === 'railroad') y--;
  if (id === 126) y--;
  if (id === 239) y -= 15; // RUBBLE_OVERLAY
  return y + 15;
}

/**
 * The unit palette with its remap ramp (16..31, pure red in the file) recoloured to a `[Colors]` entry (H,S,V, 0-255 each).
 * ponytail: ramp brightness is the red ramp's own, scaled onto the colour's V; CNCMaps' exact ramp is not read.
 */
export function remapped(rgb: Uint8Array, hsv: number[]): Uint8Array {
  const out = rgb.slice(), [h, s, v] = [hsv[0]! / 255 * 6, hsv[1]! / 255, hsv[2]! / 255];
  for (let i = 16; i <= 31; i++) {
    const value = v * rgb[i * 3]! / 255, f = (n: number) => { const k = (n + h) % 6; return Math.round(255 * value * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))); };
    out[i * 3] = f(5); out[i * 3 + 1] = f(3); out[i * 3 + 2] = f(1);
  }
  return out;
}

/**
 * Places overlay, trees and buildings the way CNCMaps draws them: the SHP canvas centred on the cell's tile
 * top-left plus (30, 0) for buildings, (30, 15) for trees, and (30, `overlayDy`) for overlay. `originX/Y` is the terrain's origin.
 */
export function placeObjects(stock: Stock, originX: number, originY: number): Objects {
  const { map } = stock;
  const out: Objects = { images: [], objects: [], missingArt: new Set(), unknownTypes: new Set(), missingOverlays: new Set() };
  const level = new Map<number, number>();
  for (const t of map.tiles) level.set(t.y * 1000 + t.x, t.z);
  const shps = new Map<string, ShpFile>();
  const images = new Map<string, number>();
  const ramps = new Map<string, Uint8Array>();
  const turrets = new Map<string, ConvertedSprite>();
  // The unit palette in an owner's house colour (rules `Color=` of its country or house, looked up in `[Colors]`), else as filed.
  const unitPalette = (owner: string) => {
    const hsv = map.ini.getSection(owner)?.getString('Color') || stock.rulesOf(owner)?.getString('Color');
    const value = hsv && stock.rules.getSection('Colors')?.getString(hsv);
    if (!value) return stock.palette('unit');
    let ramp = ramps.get(value);
    if (!ramp) ramps.set(value, ramp = remapped(stock.palette('unit'), value.split(',').map(Number)));
    return ramp;
  };

  const place = (
    type: string, cx: number, cy: number, frame: number, pal: 'iso' | 'unit' | 'theater',
    dx: number, dy: number, z: number, kind: PlacedObject['kind'], owner = '',
  ) => {
    const file = stock.artFile(type);
    if (!file) { out.missingArt.add(type); return; }
    let shp = shps.get(file);
    if (!shp) { shp = ShpFile.parse(stock.need(file)); shps.set(file, shp); }
    if (frame >= shp.count) frame = 0;
    const key = `${file}:${frame}:${pal}:${owner}`;
    let image = images.get(key);
    if (image === undefined) {
      const f = shp.frame(frame), rgb = pal === 'unit' && owner ? unitPalette(owner) : stock.palette(pal);
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
    if (rules?.getBool('Tiberium')) place(type, cx, cy, frame, 'theater', 30, overlayDy(rules, id), -1, 'overlay');
    else if (rules?.getBool('Wall')) place(type, cx, cy, frame, 'unit', 30, overlayDy(rules, id), depth, 'overlay');
    else if (isHighBridge(type)) {
      if (frame === 0 || frame === 9) frame += BRIDGE_VARIATION[(cx & 3) | ((cy & 3) << 2)]!;
      place(type, cx, cy, frame, 'iso', 30, frame <= 8 ? -1 : -16, (cx + cy + 4) * 15, 'overlay');
    } else place(type, cx, cy, frame, 'iso', 30, overlayDy(rules, id), depth, 'overlay');
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
    place(s.type, s.x, s.y, 0, 'unit', 30, 0, z, 'building', s.owner);
    // Overlays are centred like the base (CNCMaps); a still frame (LoopStart) is enough. The bib lies under the base.
    // ponytail: fixed depth just above the base, not RA2's ActiveAnim…YSort/ZAdjust; read those if an overlay sorts wrong against a neighbour.
    const art = stock.artOf(s.type);
    for (const [i, key] of BUILDING_PARTS.entries()) {
      const part = art?.getString(key);
      if (!part) continue;
      if (!stock.artFile(part)) { out.missingOverlays.add(`${s.type}: ${part}`); continue; }
      const bib = key === 'BibShape';
      place(part, s.x, s.y, bib ? 0 : stock.art.getSection(part)?.getInt('LoopStart') ?? 0, 'unit', 30, 0, bib ? z - 1 : z + (i + 1) / 8, 'building', s.owner);
    }
    // A voxel turret (the Grand Cannon's gun, with its `<Image>barl` barrel when there is one): its prerender at the
    // game's own voxel camera (CNCMaps BuildingDrawable), facing the map's facing (field 5, 0..255; frame 0 looks along -x, facing 0 along -y), its ground pivot TurretAnimX/Y px from the base's centre.
    // The map's own section of the type wins over stock rules.
    const rule = (key: string) => map.ini.getSection(s.type)?.getString(key) || stock.rulesOf(s.type)?.getString(key) || '';
    const tur = rule('TurretAnim').toLowerCase();
    if (!tur || !/^[yt1]/i.test(rule('TurretAnimIsVoxel'))) continue;
    if (!stock.vfs.exists(`${tur}.vxl`) || !stock.vfs.exists(`${tur}.hva`)) { out.missingOverlays.add(`${s.type}: ${tur}`); continue; }
    let sprite = turrets.get(`${tur}:${s.owner}`);
    if (!sprite) {
      const vxl = VxlFile.parse(stock.need(`${tur}.vxl`)), palette = Palette.parse(new Uint8Array(768));
      const barl = `${(rule('Image') || s.type).toLowerCase()}barl`, hasBarl = stock.vfs.exists(`${barl}.vxl`) && stock.vfs.exists(`${barl}.hva`);
      palette.rgb.set(s.owner ? unitPalette(s.owner) : stock.palette('unit'));
      sprite = renderTurretToSprite(tur, vxl, vxl, HvaFile.parse(stock.need(`${tur}.hva`)), palette,
        hasBarl ? VxlFile.parse(stock.need(`${barl}.vxl`)) : undefined, hasBarl ? HvaFile.parse(stock.need(`${barl}.hva`)) : undefined,
        { ...GAMEMD_CAMERA, pivot: [0, 0, 0] }).sprite;
      turrets.set(`${tur}:${s.owner}`, sprite);
    }
    // RA2 turns the turret about bounds (0, 0, 0): the sprite's origin.
    const pivot = sprite.origin!, facing = (Math.round(Number(s.fields[5] ?? 0) / 8) + 8) & 31, key = `${tur}.vxl:${facing}:${s.owner}`;
    const f = sprite.frames[facing]!;
    let image = images.get(key);
    if (image === undefined) {
      const rgba = new Uint8ClampedArray(f.w * f.h * 4);
      for (let y = 0; y < f.h; y++) rgba.set(sprite.colorRgba.subarray(((f.y + y) * sprite.atlasWidth + f.x) * 4, ((f.y + y) * sprite.atlasWidth + f.x + f.w) * 4), y * f.w * 4);
      image = out.images.push({ width: f.w, height: f.h, rgba }) - 1;
      images.set(key, image);
    }
    const z0 = level.get(s.y * 1000 + s.x) ?? 0;
    out.objects.push({
      image, kind: 'building', cellX: s.x, cellY: s.y, z: z + 1,
      x: (s.x - s.y) * 30 - originX + 30 + Number(rule('TurretAnimX') || 0) - Math.round(pivot[0]),
      y: (s.x + s.y - z0) * 15 - originY + Number(rule('TurretAnimY') || 0) - Math.round(pivot[1]),
    });
  }
  return out;
}
