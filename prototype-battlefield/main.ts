// PROTOTYPE, throwaway (issue #5). Reads a local RA2 + YR install, draws one
// battlefield with its theater art and drives prerendered Rhino voxels over it.
// Parsers and the voxel prerenderer are vendored from openra2 (GPL-3.0), which
// is fine for a throwaway branch only; see issue #12 for the real licence call.

import { Application, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { HvaFile, IniFile, MapFile, MixFile, Palette, ShpFile, TmpFile, Vfs, VxlFile } from './vendor/formats/index.js';
import { buildTileSlots, clearTileGlobalNum, theaterArtExt, theaterIniName } from './vendor/dev/theater.js';
import { facingAngle, projectModelPoint, renderTurretToSprite, renderVoxelToSprite } from './vendor/dev/voxelRender.js';
import type { ConvertedSprite } from './vendor/dev/sprite.js';

// Calibration knob: where the install lives when the page runs as an OBS "Local file".
const OBS_INSTALL = 'http://absolute/D:/GAMES/Origin/Command and Conquer Red Alert II';
const DEFAULT_MAP = "Maps/Yuri's Revenge/4_strip_mine.map";
const TOP_MIXES = ['ra2.mix', 'ra2md.mix', 'expandmd01.mix'];
// Mounted in this order; later mounts win (YR over RA2).
const NESTED: Record<string, string[]> = {
  'ra2.mix': ['local', 'cache', 'conquer', 'generic', 'isogen', 'temperat', 'isotemp', 'tem', 'snow', 'isosnow', 'sno', 'urban', 'isourb', 'urb'],
  'ra2md.mix': ['localmd', 'cachemd', 'conqmd', 'genermd', 'isogenmd', 'temperatmd', 'isotemmd', 'snowmd', 'isosnomd', 'urbanmd', 'isourbmd',
    'desert', 'isodes', 'desertmd', 'isodesmd', 'des', 'urbann', 'isoubn', 'urbannmd', 'isoubnmd', 'ubn', 'lunar', 'isolun', 'lunarmd', 'isolunmd', 'lun'],
};
const THEATER_LETTER: Record<string, string> = { temperate: 't', snow: 'a', urban: 'u', desert: 'd', newurban: 'n', lunar: 'l' };
const CHUNK = 2048;

const params = new URLSearchParams(location.search);
const log = document.getElementById('log')!;
const stats: string[] = [];
const t0 = performance.now();
function note(msg: string) {
  stats.push(`${((performance.now() - t0) / 1000).toFixed(1)}s  ${msg}`);
  log.textContent = stats.join('\n');
  console.log(msg);
}

// ---------- getting the files ----------

type Source = (name: string) => Promise<Uint8Array>;

function installRoot(): string | null {
  if (params.get('root')) return params.get('root');
  if (location.hostname === 'absolute') return OBS_INSTALL; // OBS browser source, Local file mode
  if (location.protocol.startsWith('http')) return '/ra2'; // server.mjs
  return null; // file:// in a normal browser: use the picker
}

function urlSource(root: string): Source {
  return async (name) => {
    const res = await fetch(`${root}/${name.split('/').map(encodeURIComponent).join('/')}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
}

function pickerSource(): Promise<{ src: Source; map: string }> {
  const picker = document.getElementById('picker')!;
  picker.hidden = false;
  return new Promise((resolve) => {
    const input = picker.querySelector('input')!;
    input.onchange = () => {
      const files = new Map([...input.files!].map((f) => [f.name.toLowerCase(), f]));
      const map = [...files.keys()].find((n) => /\.(map|yrm|mpr)$/.test(n));
      if (!map || !TOP_MIXES.every((m) => files.has(m))) {
        alert(`Pick ${TOP_MIXES.join(', ')} and one .map/.yrm file together.`);
        return;
      }
      picker.hidden = true;
      resolve({ map, src: async (name) => new Uint8Array(await files.get(name.toLowerCase())!.arrayBuffer()) });
    };
  });
}

// ---------- drawing helpers ----------

function textureFromIndexed(w: number, h: number, put: (img: Uint8ClampedArray, rgb: Uint8Array) => void, pal: Palette): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  put(img.data, pal.rgb);
  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}

function textureFromRgba(w: number, h: number, rgba: Uint8Array): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return Texture.from(canvas);
}

function frameTextures(s: ConvertedSprite): Texture[] {
  const base = textureFromRgba(s.atlasWidth, s.atlasHeight, s.colorRgba);
  return s.frames.map((f) => new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
}

/** Frame 0 of a SHP on its full SHP canvas, so the CNCMaps centring rule applies. */
function shpTexture(shp: ShpFile, pal: Palette): Texture {
  const f = shp.frame(0);
  return textureFromIndexed(shp.cx, shp.cy, (out, rgb) => {
    for (let y = 0; y < f.cy; y++) {
      for (let x = 0; x < f.cx; x++) {
        const v = f.pixels[y * f.cx + x]!;
        if (v === 0) continue;
        const o = ((f.y + y) * shp.cx + f.x + x) * 4;
        out[o] = rgb[v * 3]!;
        out[o + 1] = rgb[v * 3 + 1]!;
        out[o + 2] = rgb[v * 3 + 2]!;
        out[o + 3] = 255;
      }
    }
  }, pal);
}

// ---------- main ----------

async function main() {
  const root = installRoot();
  let src: Source;
  let mapName = params.get('map') ?? DEFAULT_MAP;
  if (root) {
    src = urlSource(root);
    note(`reading from ${root}`);
  } else {
    const picked = await pickerSource();
    src = picked.src;
    mapName = picked.map;
    note('reading picked files');
  }

  const vfs = new Vfs();
  for (const top of TOP_MIXES) {
    const bytes = await src(top);
    note(`fetched ${top} (${(bytes.length / 1e6).toFixed(0)} MB)`);
    const mix = vfs.mountData(bytes);
    const mounted = (NESTED[top] ?? []).filter((n) => vfs.mountNested(mix, `${n}.mix`));
    if (mounted.length) note(`  mounted ${mounted.join(', ')}`);
  }
  const open = (name: string) => vfs.openFile(name);
  const ini = (...names: string[]) => {
    for (const n of names) {
      const b = open(n);
      if (b) return IniFile.parse(b);
    }
    throw new Error(`missing ${names.join(' / ')}`);
  };

  const map = MapFile.parse(await src(mapName));
  const theater = map.theater.toLowerCase();
  const ext = theaterArtExt(theater);
  note(`map ${mapName}: theater ${theater}, ${map.tiles.length} cells`);

  const theaterIni = ini(theaterIniName(theater));
  const rules = ini('rulesmd.ini', 'rules.ini');
  const art = ini('artmd.ini', 'art.ini');
  const isoPal = Palette.parse(open(`iso${ext}.pal`)!);
  const unitPal = Palette.parse(open(`unit${ext}.pal`)!);

  const app = new Application();
  await app.init({ resizeTo: window, background: '#000', antialias: false });
  document.body.appendChild(app.canvas);
  const world = new Container();
  const ground = new Container();
  const things = new Container();
  things.sortableChildren = true;
  world.addChild(ground, things);
  app.stage.addChild(world);

  // --- terrain: paint every cell's TMP into 2048px chunk textures ---
  const slots = buildTileSlots(theaterIni, theater);
  const clearNum = clearTileGlobalNum(theaterIni) ?? 0;
  const tmpCache = new Map<string, TmpFile | null>();
  const tmp = (file: string) => {
    if (!tmpCache.has(file)) {
      const b = open(file);
      tmpCache.set(file, b ? TmpFile.parse(b) : null);
    }
    return tmpCache.get(file)!;
  };
  const heightAt = new Map<number, number>();
  const tiles = [...map.tiles].sort((a, b) => a.x + a.y - (b.x + b.y) || a.z - b.z);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) {
    heightAt.set(t.y * 1000 + t.x, t.z);
    const sx = (t.x - t.y) * 30, sy = (t.x + t.y - t.z) * 15;
    minX = Math.min(minX, sx - 60); minY = Math.min(minY, sy - 120);
    maxX = Math.max(maxX, sx + 120); maxY = Math.max(maxY, sy + 120);
  }
  const W = maxX - minX, H = maxY - minY;
  const cols = Math.ceil(W / CHUNK), rows = Math.ceil(H / CHUNK);
  const chunks: (Uint8ClampedArray | undefined)[] = new Array(cols * rows);
  const rgb = isoPal.rgb;
  const put = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const ci = Math.floor(y / CHUNK) * cols + Math.floor(x / CHUNK);
    const buf = (chunks[ci] ??= new Uint8ClampedArray(CHUNK * CHUNK * 4));
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
  chunks.forEach((buf, i) => {
    if (!buf) return;
    const c = document.createElement('canvas');
    c.width = c.height = CHUNK;
    c.getContext('2d')!.putImageData(new ImageData(buf, CHUNK, CHUNK), 0, 0);
    const s = new Sprite(Texture.from(c));
    s.position.set((i % cols) * CHUNK, Math.floor(i / cols) * CHUNK);
    ground.addChild(s);
  });
  note(`terrain ${W}x${H}px in ${ground.children.length} chunks, ${tmpCache.size} TMP files, ${missing} cells missing art`);

  // Screen position of a cell's tile-bitmap top-left (CNCMaps: Dx*30, (Dy-Z)*15).
  const cellX = (rx: number, ry: number) => (rx - ry) * 30 - minX;
  const cellY = (rx: number, ry: number) => (rx + ry - (heightAt.get(ry * 1000 + rx) ?? 0)) * 15 - minY;

  // --- buildings and terrain objects (trees): SHP frame 0, depth-sorted with the tanks ---
  const shpCache = new Map<string, Texture | null>();
  const shpTex = (names: string[], pal: Palette) => {
    for (const n of names) {
      if (!shpCache.has(n)) {
        const b = open(n);
        shpCache.set(n, b ? shpTexture(ShpFile.parse(b), pal) : null);
      }
      if (shpCache.get(n)) return shpCache.get(n)!;
    }
    return null;
  };
  const place = (tex: Texture, rx: number, ry: number, dy: number, z: number) => {
    const s = new Sprite(tex);
    s.position.set(cellX(rx, ry) + 30 - Math.floor(tex.width / 2), cellY(rx, ry) + dy - Math.floor(tex.height / 2));
    s.zIndex = z;
    things.addChild(s);
  };
  let drawn = 0, skipped = new Set<string>();
  const letter = THEATER_LETTER[theater] ?? 't';
  for (const obj of map.structures) {
    if (obj.x === undefined || obj.y === undefined) continue;
    const image = (rules.getSection(obj.type)?.getString('Image') || obj.type).toLowerCase();
    const a = art.getSection(image);
    const names = a?.getBool('Theater') ? [`${image}.${ext}`] : [`${image}.shp`];
    if (a?.getBool('NewTheater')) names.unshift(`${image[0]}${letter}${image.slice(2)}.shp`, `${image[0]}g${image.slice(2)}.shp`);
    const tex = shpTex(names, unitPal);
    if (!tex) { skipped.add(obj.type); continue; }
    const [fw, fh] = (a?.getString('Foundation') || '1x1').split(/x/i).map(Number);
    place(tex, obj.x, obj.y, 0, (obj.x + obj.y + (fw ?? 1) + (fh ?? 1)) * 15);
    drawn++;
  }
  for (const obj of map.terrainObjects) {
    const image = (rules.getSection(obj.type)?.getString('Image') || obj.type).toLowerCase();
    const pal = rules.getSection(obj.type)?.getBool('SpawnsTiberium') ? unitPal : isoPal; // ore trees use the unit palette (CNCMaps)
    const tex = shpTex([`${image}.${ext}`, `${image}.shp`, `${image[0]}${letter}${image.slice(2)}.shp`], pal);
    if (!tex) { skipped.add(obj.type); continue; }
    place(tex, obj.x, obj.y, 15, (obj.x + obj.y + 2) * 15);
    drawn++;
  }
  note(`${drawn} buildings/trees drawn; no art for: ${[...skipped].join(', ') || 'none'}`);

  // --- the Rhino: prerender 32 body facings + 32 turret facings once ---
  const vxl = (n: string) => VxlFile.parse(open(`${n}.vxl`)!);
  const hva = (n: string) => HvaFile.parse(open(`${n}.hva`)!);
  const tv = performance.now();
  const bodyVxl = vxl('htnk');
  const bodyTex = frameTextures(renderVoxelToSprite('htnk', bodyVxl, hva('htnk'), unitPal));
  const turret = renderTurretToSprite('htnktur', bodyVxl, vxl('htnktur'), hva('htnktur'), unitPal, vxl('htnkbarl'), hva('htnkbarl'));
  const turretTex = frameTextures(turret.sprite);
  note(`Rhino prerendered (2x32 facings) in ${(performance.now() - tv).toFixed(0)} ms`);

  // --- tanks: drive between random cells, turn toward the target, turret wanders ---
  const cells = tiles.map((t) => [t.x, t.y] as const);
  type Tank = { c: Container; body: Sprite; tur: Sprite; x: number; y: number; tx: number; ty: number; facing: number; turretOff: number };
  const tanks: Tank[] = [];
  const pickTarget = (k: Tank) => {
    const [x, y] = cells[(Math.random() * cells.length) | 0]!;
    k.tx = x + 0.5; k.ty = y + 0.5;
  };
  const addTanks = (n: number) => {
    for (let i = 0; i < n; i++) {
      const [x, y] = cells[(Math.random() * cells.length) | 0]!;
      const body = new Sprite(bodyTex[0]); body.anchor.set(0.5);
      const tur = new Sprite(turretTex[0]); tur.anchor.set(0.5);
      const c = new Container(); c.addChild(body, tur); things.addChild(c);
      const k: Tank = { c, body, tur, x: x + 0.5, y: y + 0.5, tx: 0, ty: 0, facing: 0, turretOff: 0 };
      pickTarget(k);
      tanks.push(k);
    }
  };
  const clearTanks = () => { tanks.splice(0).forEach((k) => k.c.destroy()); };

  const SPEED = 2.5; // cells per second
  const ROT = 16; // facings per second
  app.ticker.add((tk) => {
    const dt = tk.deltaMS / 1000;
    for (const k of tanks) {
      const dx = k.tx - k.x, dy = k.ty - k.y, d = Math.hypot(dx, dy);
      if (d < 0.1) { pickTarget(k); continue; }
      // facing 0 = north (-y), clockwise, 32 steps
      const want = ((Math.atan2(dx, -dy) / (2 * Math.PI)) * 32 + 32) % 32;
      let diff = ((want - k.facing + 48) % 32) - 16;
      const turn = Math.sign(diff) * Math.min(Math.abs(diff), ROT * dt);
      k.facing = (k.facing + turn + 32) % 32;
      if (Math.abs(diff) < 2) { k.x += (dx / d) * Math.min(d, SPEED * dt); k.y += (dy / d) * Math.min(d, SPEED * dt); }
      k.turretOff = Math.sin(performance.now() / 900 + k.tx) * 4;
      const f = Math.round(k.facing) % 32, tf = (Math.round(k.facing + k.turretOff) + 32) % 32;
      k.body.texture = bodyTex[f]!;
      k.tur.texture = turretTex[tf]!;
      const ang = facingAngle(f), [px, py, pz] = turret.pivot;
      const p = projectModelPoint(px * Math.cos(ang) - py * Math.sin(ang), px * Math.sin(ang) + py * Math.cos(ang), pz);
      k.tur.position.set(p.sx, p.sy);
      const rx = Math.floor(k.x), ry = Math.floor(k.y), z = heightAt.get(ry * 1000 + rx) ?? 0;
      k.c.position.set((k.x - k.y) * 30 - minX + 30, (k.x + k.y - z) * 15 - minY);
      k.c.zIndex = (k.x + k.y) * 15 + 15;
    }
  });

  // --- camera: drag to pan, wheel to zoom ---
  const startCell = map.waypoints.find((w) => w.number === 0) ?? { x: cells[0]![0], y: cells[0]![1] };
  world.position.set(app.screen.width / 2 - cellX(startCell.x, startCell.y), app.screen.height / 2 - cellY(startCell.x, startCell.y));
  let drag: { x: number; y: number } | null = null;
  app.canvas.addEventListener('pointerdown', (e) => (drag = { x: e.clientX - world.x, y: e.clientY - world.y }));
  addEventListener('pointerup', () => (drag = null));
  addEventListener('pointermove', (e) => drag && world.position.set(e.clientX - drag.x, e.clientY - drag.y));
  app.canvas.addEventListener('wheel', (e) => {
    const s = Math.min(3, Math.max(0.15, world.scale.x * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const k = s / world.scale.x;
    world.position.set(e.clientX - (e.clientX - world.x) * k, e.clientY - (e.clientY - world.y) * k);
    world.scale.set(s);
  });

  // --- HUD: frame rate and controls ---
  const fpsEl = document.getElementById('fps')!;
  const frames: number[] = [];
  app.ticker.add((tk) => {
    frames.push(tk.deltaMS);
    if (frames.length > 120) frames.shift();
  });
  setInterval(() => {
    const sorted = [...frames].sort((a, b) => b - a);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    fpsEl.textContent = `${(1000 / avg).toFixed(0)} fps avg, ${(1000 / (sorted[1] ?? avg)).toFixed(0)} fps 1% low, ${tanks.length} Rhinos, ${app.renderer.name}`;
  }, 500);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-add]')) b.onclick = () => addTanks(Number(b.dataset.add));
  document.getElementById('clear')!.onclick = clearTanks;
  addTanks(Number(params.get('tanks') ?? 8));
  note('ready: drag to pan, wheel to zoom');
}

main().catch((e) => { note(`FAILED: ${e?.stack ?? e}`); });
