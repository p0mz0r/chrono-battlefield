import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { prerenderRhino } from './assets/rhino.js';
import { importBattlefield } from './battlefield/import.js';
import type { CellGrid } from './battlefield/grid.js';
import { CHUNK } from './battlefield/terrain.js';
import { openInstall, readInstall } from './install/read.js';
import { bindSetupKey, showSetup } from './install/setup.js';
import { addTank, createField, drivable, isDriving, LEPTONS_PER_CELL, orderMove, spotLevel, tankCell, tick, TICK_HZ, type Cell } from './movement/index.js';
import { loadMap, mountTheater } from './ra2/mount.js';
import { facingAngle, projectModelPoint } from './ra2/render/voxelRender.js';
import type { ConvertedSprite } from './ra2/render/sprite.js';

// Dev page: one battlefield's terrain and ten Rhinos that drive to a clicked cell.
// `?map=<path inside the install>`, `?start=x,y`, `?to=x,y` (order on load), `?tanks=N` (10), `?seed=N`,
// `?zoom=N` (follow the first tank), `?cell=x,y` (centre there), `?grid=1` (show passability).
const status = document.getElementById('status')!;
const params = new URLSearchParams(location.search);
const cellParam = (name: string): Cell | undefined => {
  const [x, y] = (params.get(name) ?? '').split(',').map(Number);
  return Number.isInteger(x) && Number.isInteger(y) ? { x: x!, y: y! } : undefined;
};

function frameTextures(s: ConvertedSprite): Texture[] {
  const canvas = document.createElement('canvas');
  canvas.width = s.atlasWidth;
  canvas.height = s.atlasHeight;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.colorRgba), s.atlasWidth, s.atlasHeight), 0, 0);
  const source = Texture.from(canvas).source;
  return s.frames.map((f) => new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
}

const canvasTexture = (rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return Texture.from(canvas);
};

/** Passability as movement sees it: red impassable or blocked, yellow slow, blue ramp, cyan high-bridge deck. */
function passability(grid: CellGrid, originX: number, originY: number): Graphics {
  const g = new Graphics();
  const diamond = (x: number, y: number, level: number) => {
    const sx = (x - y) * 30 - originX, sy = (x + y - level) * 15 - originY;
    return [sx + 30, sy, sx + 60, sy + 15, sx + 30, sy + 30, sx, sy + 15];
  };
  for (let i = 0; i < grid.width * grid.height; i++) {
    const x = i % grid.width, y = (i - x) / grid.width;
    const speed = grid.blocked[i] ? 0 : grid.speed[i]!;
    const color = speed === 0 ? 0xff2020 : speed < 1 ? 0xffd000 : grid.ramp[i] ? 0x3070ff : undefined;
    if (color !== undefined) g.poly(diamond(x, y, grid.level[i]!)).fill({ color, alpha: 0.4 });
    if (grid.deck[i]! >= 0) g.poly(diamond(x, y, grid.deck[i]!)).fill({ color: 0x00e0ff, alpha: 0.5 });
  }
  return g;
}

async function main() {
  bindSetupKey();
  const problems = await openInstall();
  if (problems.length) {
    status.textContent = 'RA2 + YR install not found';
    showSetup(problems);
    return;
  }
  const mapPath = params.get('map') ?? 'Hills.mmx';
  const map = await loadMap(readInstall, mapPath);
  const vfs = await mountTheater(readInstall, map.theater);
  const battlefield = await importBattlefield(readInstall, mapPath);
  const { terrain, images, objects } = battlefield;
  const grid = battlefield.grid;
  const level = (x: number, y: number) => grid.level[y * grid.width + x] ?? 0;
  const rhino = prerenderRhino(vfs, map.theater);

  const { originX: minX, originY: minY } = terrain;
  /** Battlefield px of a point in cell units (cell centre = x + 0.5). */
  const toScreen = (fx: number, fy: number, z: number) => ({ x: (fx - fy) * 30 + 30 - minX, y: (fx + fy - z) * 15 - minY });
  const toCell = (sx: number, sy: number): Cell => {
    let c = { x: 0, y: 0 };
    for (let i = 0, z = 0; i < 3; i++, z = level(c.x, c.y)) {
      const a = (sx + minX - 30) / 30, b = (sy + minY) / 15 + z;
      c = { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) };
    }
    return c;
  };

  const app = new Application();
  await app.init({ resizeTo: window, background: '#000' });
  document.body.prepend(app.canvas);
  const world = new Container();
  app.stage.addChild(world);
  for (const chunk of terrain.chunks) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK;
    canvas.getContext('2d')!.putImageData(new ImageData(chunk.rgba, CHUNK, CHUNK), 0, 0);
    const sprite = new Sprite(Texture.from(canvas));
    sprite.position.set(chunk.x, chunk.y);
    world.addChild(sprite);
  }
  const textures = images.map((img) => canvasTexture(img.rgba, img.width, img.height));
  const things = new Container({ sortableChildren: true });
  for (const obj of objects) {
    const sprite = new Sprite(textures[obj.image]);
    sprite.position.set(obj.x, obj.y);
    sprite.zIndex = obj.z;
    things.addChild(sprite);
  }
  world.addChild(things);
  const overlay = passability(grid, terrain.originX, terrain.originY);
  overlay.visible = params.get('grid') === '1';
  world.addChild(overlay);
  addEventListener('keydown', (e) => { if (e.key === 'g' || e.key === 'G') overlay.visible = !overlay.visible; });

  const trail = new Graphics();
  world.addChild(trail);

  // The Rhinos.
  const bodyTex = frameTextures(rhino.body), turretTex = frameTextures(rhino.turret.sprite);
  /** Drivable ground cells, nearest to `c` first. */
  const nearest = (c: Cell, n: number): Cell[] => {
    const cells: [number, Cell][] = [];
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
      if (drivable(grid, x, y) && grid.deck[y * grid.width + x]! < 0) cells.push([Math.hypot(x - c.x, y - c.y), { x, y }]);
    }
    return cells.sort((a, b) => a[0] - b[0]).slice(0, n).map(([, cell]) => cell);
  };

  const waypoint = map.waypoints.find((w) => w.number === 0);
  const start = cellParam('start') ?? (waypoint && { x: waypoint.x, y: waypoint.y }) ?? { x: grid.width >> 1, y: grid.height >> 1 };
  const field = createField(grid, Number(params.get('seed') ?? 1));
  const tanks = nearest(start, Number(params.get('tanks') ?? 10)).map((c) => addTank(field, c));
  const views = tanks.map(() => {
    const body = new Sprite(bodyTex[0]), turret = new Sprite(turretTex[0]);
    body.anchor.set(0.5);
    turret.anchor.set(0.5);
    const view = new Container();
    view.addChild(body, turret);
    things.addChild(view);
    return { view, body, turret };
  });
  let prev = tanks.map((t) => ({ x: t.x, y: t.y }));
  /** Each tank to its own cell near `to`, farthest tank to the farthest goal so they don't cross. */
  const order = (to: Cell) => {
    const goals = nearest(to, tanks.length);
    const byDistance = [...tanks].sort((a, b) => Math.hypot(a.cell.x - to.x, a.cell.y - to.y) - Math.hypot(b.cell.x - to.x, b.cell.y - to.y));
    const ok = byDistance.filter((t, i) => goals[i] && orderMove(field, t, goals[i]!)).length;
    status.textContent = `${mapPath}: ${ok}/${tanks.length} Rhinos driving to ${to.x},${to.y}`;
  };

  const focus = cellParam('cell');
  const zoom = Number(params.get('zoom')) || (focus ? 1 : 0);
  const fit = () => world.scale.set(zoom || Math.min(app.screen.width / terrain.width, app.screen.height / terrain.height));
  fit();
  app.renderer.on('resize', fit);
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (e) => {
    const p = world.toLocal(e.global);
    order(toCell(p.x, p.y));
  });

  // Dev check for headless runs: frames in which two non-ghost tanks held the same spot.
  let overlaps = 0;
  const countOverlap = () => {
    const seen = new Set<string>();
    for (const t of tanks) for (const s of t.ghost ? [] : [t.cell, ...t.ahead]) {
      const k = `${s.x},${s.y},${s.deck}`;
      if (seen.has(k)) return overlaps++;
      seen.add(k);
    }
  };

  // Fixed-step simulation, drawn interpolated.
  let acc = 0;
  app.ticker.add((t) => {
    acc += t.deltaMS / 1000;
    for (let n = 0; acc >= 1 / TICK_HZ && n < 10; n++, acc -= 1 / TICK_HZ) {
      prev = tanks.map((t) => ({ x: t.x, y: t.y }));
      tick(field);
      countOverlap();
    }
    const a = Math.min(acc * TICK_HZ, 1);
    tanks.forEach((tank, i) => {
      const { view, body, turret } = views[i]!;
      const fx = (prev[i]!.x + (tank.x - prev[i]!.x) * a) / LEPTONS_PER_CELL, fy = (prev[i]!.y + (tank.y - prev[i]!.y) * a) / LEPTONS_PER_CELL;
      // The prerender's frame 0 looks along -x (screen up-left); movement facing 0 is -y (up-right).
      const f = (Math.round(tank.facing / 2048) + 8) % 32;
      body.texture = bodyTex[f]!;
      turret.texture = turretTex[f]!;
      const ang = facingAngle(f), [px, py, pz] = rhino.turret.pivot;
      const tp = projectModelPoint(px * Math.cos(ang) - py * Math.sin(ang), px * Math.sin(ang) + py * Math.cos(ang), pz);
      turret.position.set(tp.sx, tp.sy);
      const p = toScreen(fx, fy, spotLevel(grid, tank.cell));
      view.position.set(p.x, p.y);
      // ponytail: deck tanks draw over everything (bridge pieces' art overlaps several cells); #45 does proper sorting.
      view.zIndex = (fx + fy + 1) * 15 + (tank.cell.deck ? 1e6 : 0);
      view.alpha = tank.ghost ? 0.5 : 1;
      if (params.get('grid') && isDriving(tank)) trail.circle(p.x, p.y, 1.5).fill(0x00ffff);
    });
    const lead = tanks[0];
    const center = focus ? toScreen(focus.x, focus.y, level(focus.x, focus.y)) : lead && toScreen(lead.x / LEPTONS_PER_CELL, lead.y / LEPTONS_PER_CELL, spotLevel(grid, lead.cell));
    if (zoom && center) world.position.set(app.screen.width / 2 - center.x * zoom, app.screen.height / 2 - center.y * zoom);
    document.body.dataset.tanks = tanks.map((t) => {
      const c = tankCell(t);
      return `${c.x},${c.y},${c.deck ? 'deck' : 'ground'},${t.ghost ? 'ghost' : ''},${isDriving(t) ? 'driving' : 'stopped'}`;
    }).join(';');
    document.body.dataset.overlaps = String(overlaps);
    document.body.dataset.frame = String(field.frame);
  });

  status.textContent = `${mapPath}: ${map.theater}, ${terrain.missing} missing tiles. ${tanks.length} Rhinos at ${start.x},${start.y}; click a cell to send them. G: passability. ${battlefield.warnings.join('; ')}`;
  const to = cellParam('to');
  if (to) order(to);
  document.body.dataset.ready = String(terrain.missing === 0);
}

main().catch((err: unknown) => {
  status.textContent = String(err);
  status.style.color = '#f66';
  document.body.dataset.ready = 'error';
  if (/^Missing install file/.test(String((err as Error)?.message))) showSetup([(err as Error).message]);
});
