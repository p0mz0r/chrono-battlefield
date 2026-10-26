import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { prerenderRhino } from './assets/rhino.js';
import { tileGrid } from './battlefield/passability.js';
import { CHUNK, bakeTerrain } from './battlefield/terrain.js';
import { readInstall } from './install/read.js';
import { createTank, isDriving, LEPTONS_PER_CELL, orderMove, tankCell, tick, TICK_HZ, type Cell } from './movement/index.js';
import { loadMap, mountTheater } from './ra2/mount.js';
import { facingAngle, projectModelPoint } from './ra2/render/voxelRender.js';
import type { ConvertedSprite } from './ra2/render/sprite.js';

// Dev page: one battlefield's terrain and one Rhino that drives to a clicked cell.
// `?map=<path inside the install>`, `?start=x,y`, `?to=x,y` (order on load), `?zoom=N` (follow the tank), `?grid=1` (show passability).
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

async function main() {
  const mapPath = params.get('map') ?? 'Hills.mmx';
  const map = await loadMap(readInstall, mapPath);
  const vfs = await mountTheater(readInstall, map.theater);
  const terrain = bakeTerrain(map, vfs);
  const grid = tileGrid(map, vfs);
  const rhino = prerenderRhino(vfs, map.theater);

  // Same offset bakeTerrain draws cells with. ponytail: duplicated so #36 owns terrain.ts; take it from there once exported.
  let minX = Infinity, minY = Infinity;
  for (const t of map.tiles) {
    minX = Math.min(minX, (t.x - t.y) * 30 - 60);
    minY = Math.min(minY, (t.x + t.y - t.z) * 15 - 120);
  }
  /** Battlefield px of a point in cell units (cell centre = x + 0.5). */
  const toScreen = (fx: number, fy: number, z: number) => ({ x: (fx - fy) * 30 + 30 - minX, y: (fx + fy - z) * 15 - minY });
  const toCell = (sx: number, sy: number): Cell => {
    let c = { x: 0, y: 0 };
    for (let i = 0, z = 0; i < 3; i++, z = grid.level(c.x, c.y)) {
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
  if (params.get('grid')) {
    const g = new Graphics();
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
      const s = grid.speed(x, y);
      if (s === 1) continue;
      const z = grid.level(x, y), p = [toScreen(x, y, z), toScreen(x + 1, y, z), toScreen(x + 1, y + 1, z), toScreen(x, y + 1, z)];
      g.poly(p.flatMap((q) => [q.x, q.y])).fill({ color: s === 0 ? 0xff0000 : 0xffff00, alpha: 0.25 });
    }
    world.addChild(g);
  }
  const trail = new Graphics();
  world.addChild(trail);

  // The Rhino.
  const bodyTex = frameTextures(rhino.body), turretTex = frameTextures(rhino.turret.sprite);
  const body = new Sprite(bodyTex[0]), turret = new Sprite(turretTex[0]);
  body.anchor.set(0.5);
  turret.anchor.set(0.5);
  const tankView = new Container();
  tankView.addChild(body, turret);
  world.addChild(tankView);

  const waypoint = map.waypoints.find((w) => w.number === 0);
  let start = cellParam('start') ?? (waypoint && { x: waypoint.x, y: waypoint.y }) ?? { x: grid.width >> 1, y: grid.height >> 1 };
  if (!grid.speed(start.x, start.y)) {
    let best = Infinity;
    const want = start;
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
      const d = Math.hypot(x - want.x, y - want.y);
      if (grid.speed(x, y) && d < best) [best, start] = [d, { x, y }];
    }
  }
  const tank = createTank(start);
  let prev = { x: tank.x, y: tank.y };
  const order = (to: Cell) => {
    const ok = orderMove(tank, grid, to);
    status.textContent = `${mapPath}: Rhino ${ok ? 'driving' : 'cannot reach'} ${to.x},${to.y}`;
  };

  const zoom = Number(params.get('zoom')) || 0;
  const fit = () => world.scale.set(zoom || Math.min(app.screen.width / terrain.width, app.screen.height / terrain.height));
  fit();
  app.renderer.on('resize', fit);
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (e) => {
    const p = world.toLocal(e.global);
    order(toCell(p.x, p.y));
  });

  // Fixed-step simulation, drawn interpolated.
  let acc = 0;
  app.ticker.add((t) => {
    acc += t.deltaMS / 1000;
    for (let n = 0; acc >= 1 / TICK_HZ && n < 10; n++, acc -= 1 / TICK_HZ) {
      prev = { x: tank.x, y: tank.y };
      tick(tank, grid);
    }
    const a = Math.min(acc * TICK_HZ, 1);
    const fx = (prev.x + (tank.x - prev.x) * a) / LEPTONS_PER_CELL, fy = (prev.y + (tank.y - prev.y) * a) / LEPTONS_PER_CELL;
    // The prerender's frame 0 looks along -x (screen up-left); movement facing 0 is -y (up-right).
    const f = (Math.round(tank.facing / 2048) + 8) % 32;
    body.texture = bodyTex[f]!;
    turret.texture = turretTex[f]!;
    const ang = facingAngle(f), [px, py, pz] = rhino.turret.pivot;
    const tp = projectModelPoint(px * Math.cos(ang) - py * Math.sin(ang), px * Math.sin(ang) + py * Math.cos(ang), pz);
    turret.position.set(tp.sx, tp.sy);
    const p = toScreen(fx, fy, grid.level(Math.floor(fx), Math.floor(fy)));
    tankView.position.set(p.x, p.y);
    if (params.get('grid') && isDriving(tank)) trail.circle(p.x, p.y, 1.5).fill(0x00ffff);
    if (zoom) world.position.set(app.screen.width / 2 - p.x * zoom, app.screen.height / 2 - p.y * zoom);
    const c = tankCell(tank);
    document.body.dataset.tank = `${c.x},${c.y},${isDriving(tank) ? "driving" : "stopped"}`;
    document.body.dataset.pose = `${tank.x},${tank.y},${tank.facing}`;
  });

  status.textContent = `${mapPath}: ${map.theater}, ${terrain.missing} missing tiles. Rhino at ${start.x},${start.y}; click a cell to drive.`;
  const to = cellParam('to');
  if (to) order(to);
  document.body.dataset.ready = String(terrain.missing === 0);
}

main().catch((err: unknown) => {
  status.textContent = String(err);
  status.style.color = '#f66';
  document.body.dataset.ready = 'error';
});
