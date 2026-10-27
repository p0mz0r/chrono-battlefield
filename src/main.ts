import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { CellGrid } from './battlefield/grid.js';
import { openInstall, readInstall } from './install/read.js';
import { bindSetupKey, showSetup } from './install/setup.js';
import { createTank, isDriving, LEPTONS_PER_CELL, orderMove, tankCell, tick, TICK_HZ, type Cell } from './movement/index.js';
import { loadCourse, type Sprite as CachedSprite } from './load.js';
import { facingAngle, projectModelPoint } from './ra2/render/voxelRender.js';

// Dev page: one battlefield's terrain and one Rhino that drives to a clicked cell.
// `?map=<path inside the install>`, `?start=x,y`, `?to=x,y` (order on load), `?zoom=N` (follow the tank), `?grid=1` (show passability).
const status = document.getElementById('status')!;
const params = new URLSearchParams(location.search);
const cellParam = (name: string): Cell | undefined => {
  const [x, y] = (params.get(name) ?? '').split(',').map(Number);
  return Number.isInteger(x) && Number.isInteger(y) ? { x: x!, y: y! } : undefined;
};

/** A cached WebP decoded straight into a texture; its pixels never sit in a JS buffer. */
const blobTexture = async (image: Blob) => Texture.from(await createImageBitmap(image));

async function frameTextures(s: CachedSprite): Promise<Texture[]> {
  const { source } = await blobTexture(s.image);
  return s.frames.map((f) => new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
}

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
  const started = performance.now();
  const { map, art, cached } = await loadCourse(readInstall, mapPath);
  const { battlefield, rhino } = art;
  const { terrain, images, objects } = battlefield;
  const cells = battlefield.grid;
  const grid = {
    width: cells.width, height: cells.height,
    speed: (x: number, y: number) => x < 0 || y < 0 || x >= cells.width || y >= cells.height ? 0 : cells.blocked[y * cells.width + x] ? 0 : cells.speed[y * cells.width + x] ?? 0,
    level: (x: number, y: number) => cells.level[y * cells.width + x] ?? 0,
  };

  const { originX: minX, originY: minY } = terrain;
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
    const sprite = new Sprite(await blobTexture(chunk.image));
    sprite.position.set(chunk.x, chunk.y);
    world.addChild(sprite);
  }
  const textures = await Promise.all(images.map((img) => blobTexture(img.image)));
  const things = new Container({ sortableChildren: true });
  for (const obj of objects) {
    const sprite = new Sprite(textures[obj.image]);
    sprite.position.set(obj.x, obj.y);
    sprite.zIndex = obj.z;
    things.addChild(sprite);
  }
  world.addChild(things);
  const overlay = passability(cells, terrain.originX, terrain.originY);
  overlay.visible = params.get('grid') === '1';
  world.addChild(overlay);
  addEventListener('keydown', (e) => { if (e.key === 'g' || e.key === 'G') overlay.visible = !overlay.visible; });

  const trail = new Graphics();
  world.addChild(trail);

  // The Rhino.
  const bodyTex = await frameTextures(rhino.body), turretTex = await frameTextures(rhino.turret);
  const body = new Sprite(bodyTex[0]), turret = new Sprite(turretTex[0]);
  body.anchor.set(0.5);
  turret.anchor.set(0.5);
  const tankView = new Container();
  tankView.addChild(body, turret);
  things.addChild(tankView);

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
    const ang = facingAngle(f), [px, py, pz] = rhino.pivot;
    const tp = projectModelPoint(px * Math.cos(ang) - py * Math.sin(ang), px * Math.sin(ang) + py * Math.cos(ang), pz);
    turret.position.set(tp.sx, tp.sy);
    const p = toScreen(fx, fy, grid.level(Math.floor(fx), Math.floor(fy)));
    tankView.position.set(p.x, p.y);
    tankView.zIndex = (fx + fy + 1) * 15;
    if (params.get('grid') && isDriving(tank)) trail.circle(p.x, p.y, 1.5).fill(0x00ffff);
    const center = focus ? toScreen(focus.x, focus.y, grid.level(focus.x, focus.y)) : p;
    if (zoom) world.position.set(app.screen.width / 2 - center.x * zoom, app.screen.height / 2 - center.y * zoom);
    const c = tankCell(tank);
    document.body.dataset.tank = `${c.x},${c.y},${isDriving(tank) ? "driving" : "stopped"}`;
    document.body.dataset.pose = `${tank.x},${tank.y},${tank.facing}`;
  });

  const loadMs = Math.round(performance.now() - started);
  document.body.dataset.load = `${loadMs},${cached ? 'cached' : 'imported'}`;
  status.textContent = `${mapPath}: ${map.theater}, ${cached ? 'from cache' : 'imported'} in ${loadMs} ms, ${terrain.missing} missing tiles. Rhino at ${start.x},${start.y}; click a cell to drive. G: passability. ${battlefield.warnings.join('; ')}`;
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
