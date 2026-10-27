import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { prerenderRhino } from './assets/rhino.js';
import { importBattlefield } from './battlefield/import.js';
import type { CellGrid } from './battlefield/grid.js';
import { CHUNK } from './battlefield/terrain.js';
import { openInstall, readInstall } from './install/read.js';
import { bindSetupKey, showSetup } from './install/setup.js';
import { LEPTONS_PER_CELL, spotLevel, tankCell, TICK_HZ, type Cell } from './movement/index.js';
import { mountTheater } from './ra2/mount.js';
import { facingAngle, projectModelPoint } from './ra2/render/voxelRender.js';
import type { ConvertedSprite } from './ra2/render/sprite.js';
import { loadCourse, type CourseFile } from './race/course.js';
import { createRace, secondsLeft, standings, tickRace, type Race, type Racer } from './race/race.js';

// The race page: a bundled course over its battlefield, the headless race drawn plainly (#45 does the stream view).
// `?course=<file name without .json>`, `?seed=N` (race seed), `?zoom=N` (follow the leading tank), `?cell=x,y` (centre
// there), `?grid=1` (passability, ideal line, waypoints). Dev only: `?fast=N` runs N× game speed, and the
// test-chat panel's URL shortcuts (race/devPanel.ts).
const status = document.getElementById('status')!;
const hud = document.getElementById('hud')!;
const params = new URLSearchParams(location.search);
const cellParam = (name: string): Cell | undefined => {
  const [x, y] = (params.get(name) ?? '').split(',').map(Number);
  return Number.isInteger(x) && Number.isInteger(y) ? { x: x!, y: y! } : undefined;
};

/** Courses bundled at build from `courses/*.json`. */
const COURSES = import.meta.glob<CourseFile>('../courses/*.json', { eager: true, import: 'default' });

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

/** Phase, countdown, standings and results as plain text. */
function hudText(race: Race): string {
  const left = secondsLeft(race), name = race.course.file.name;
  const rows = (race.phase === 'results' ? race.results : standings(race)).map((s, i) => {
    const state = s.finishTime !== undefined ? `${s.finishTime.toFixed(1)} s` : race.phase === 'results' ? 'DNF' : `${Math.floor(s.progress * 100)}%`;
    return `${String(i + 1).padStart(2)}. ${s.name.padEnd(16)}${s.bot ? ' bot' : '    '}  ${state}`;
  }).join('\n');
  switch (race.phase) {
    case 'idle': return `${name}\nNo race.`;
    case 'join': return `${name}: join window ${left} s. Type !rhino to join.\n${rows}`;
    case 'countdown': return `${name}\n${left}\n${rows}`;
    case 'racing': return `${name}${race.timer > 0 ? `: finish timer ${left} s` : ''}\n${rows}`;
    case 'results': return `${name}: results\n${rows}`;
  }
}

async function main() {
  bindSetupKey();
  const problems = await openInstall();
  if (problems.length) {
    status.textContent = 'RA2 + YR install not found';
    showSetup(problems);
    return;
  }
  const courseName = params.get('course');
  const file = Object.entries(COURSES).find(([path]) => !courseName || path.endsWith(`/${courseName}.json`))?.[1];
  if (!file) throw new Error(`No course ${courseName}`);
  // ponytail: shipped custom maps (courses/maps/, ADR 0006) arrive with the first course over one.
  if (file.source !== 'install') throw new Error(`Course "${file.name}": shipped maps aren't supported yet`);
  const mapPath = file.map;
  const battlefield = await importBattlefield(readInstall, mapPath);
  const course = loadCourse(file, await readInstall(mapPath), battlefield.grid);
  const { terrain, images, objects, grid } = battlefield;
  const level = (x: number, y: number) => grid.level[y * grid.width + x] ?? 0;
  const rhino = prerenderRhino(await mountTheater(readInstall, battlefield.theater), battlefield.theater);
  const race = createRace(course, grid, Number(params.get('seed') ?? Date.now() % 1e9));

  const { originX: minX, originY: minY } = terrain;
  /** Battlefield px of a point in cell units (cell centre = x + 0.5). */
  const toScreen = (fx: number, fy: number, z: number) => ({ x: (fx - fy) * 30 + 30 - minX, y: (fx + fy - z) * 15 - minY });
  const diamond = (x: number, y: number) => {
    const p = toScreen(x, y, level(x, y));
    return [p.x, p.y, p.x + 30, p.y + 15, p.x, p.y + 30, p.x - 30, p.y + 15];
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
  // The finish area, chequered.
  const finish = new Graphics();
  for (const i of course.finishArea) {
    const x = i % grid.width, y = (i - x) / grid.width;
    finish.poly(diamond(x, y)).fill({ color: (x + y) % 2 ? 0xffffff : 0x111111, alpha: 0.6 });
  }
  world.addChild(finish);
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
  const linePoint = (p: { x: number; y: number }) => toScreen(p.x, p.y, level(Math.floor(p.x), Math.floor(p.y)));
  course.line.forEach((p, i) => (i ? overlay.lineTo(linePoint(p).x, linePoint(p).y) : overlay.moveTo(linePoint(p).x, linePoint(p).y)));
  overlay.stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
  for (const [x, y] of course.file.waypoints) overlay.poly(diamond(x, y)).fill({ color: 0xff00ff, alpha: 0.7 });
  overlay.visible = params.get('grid') === '1';
  world.addChild(overlay);
  addEventListener('keydown', (e) => { if (e.key === 'g' || e.key === 'G') overlay.visible = !overlay.visible; });

  // The Rhinos: one view per racer once its tank is on the start grid, labelled with its name.
  const bodyTex = frameTextures(rhino.body), turretTex = frameTextures(rhino.turret.sprite);
  const views = new Map<Racer, { view: Container; body: Sprite; turret: Sprite; prev: { x: number; y: number } }>();
  const viewOf = (r: Racer) => {
    let v = views.get(r);
    if (!v) {
      const body = new Sprite(bodyTex[0]), turret = new Sprite(turretTex[0]);
      body.anchor.set(0.5);
      turret.anchor.set(0.5);
      const label = new Text({ text: r.name, style: { fill: r.bot ? 0xcccccc : 0xffff80, fontSize: 12, fontFamily: 'sans-serif', stroke: { color: 0x000000, width: 3 } } });
      label.anchor.set(0.5, 1);
      label.position.set(0, -14);
      const view = new Container();
      view.addChild(body, turret, label);
      things.addChild(view);
      views.set(r, (v = { view, body, turret, prev: { x: r.tank!.x, y: r.tank!.y } }));
    }
    return v;
  };

  const focus = cellParam('cell');
  const zoom = Number(params.get('zoom')) || (focus ? 1 : 0);
  const fit = () => world.scale.set(zoom || Math.min(app.screen.width / terrain.width, app.screen.height / terrain.height));
  fit();
  app.renderer.on('resize', fit);

  // Fixed-step simulation, drawn interpolated.
  const fast = import.meta.env.DEV ? Number(params.get('fast')) || 1 : 1;
  let acc = 0;
  app.ticker.add((t) => {
    acc += (t.deltaMS / 1000) * fast;
    for (let n = 0; acc >= 1 / TICK_HZ && n < 10 * fast; n++, acc -= 1 / TICK_HZ) {
      for (const [r, v] of views) v.prev = { x: r.tank!.x, y: r.tank!.y };
      tickRace(race);
    }
    for (const [r, v] of views) if (!race.racers.includes(r)) { // a new race
      v.view.destroy({ children: true });
      views.delete(r);
    }
    const a = Math.min(acc * TICK_HZ, 1);
    for (const r of race.racers) {
      const tank = r.tank;
      if (!tank) continue;
      const { view, body, turret, prev } = viewOf(r);
      view.visible = r.finishedAt === undefined; // finished tanks leave the battlefield
      const fx = (prev.x + (tank.x - prev.x) * a) / LEPTONS_PER_CELL, fy = (prev.y + (tank.y - prev.y) * a) / LEPTONS_PER_CELL;
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
    }
    const leading = standings(race).find((s) => s.finishTime === undefined);
    const leader = race.racers.find((r) => r.name === leading?.name)?.tank;
    const center = focus ? toScreen(focus.x, focus.y, level(focus.x, focus.y)) : leader && toScreen(leader.x / LEPTONS_PER_CELL, leader.y / LEPTONS_PER_CELL, spotLevel(grid, leader.cell));
    if (zoom && center) world.position.set(app.screen.width / 2 - center.x * zoom, app.screen.height / 2 - center.y * zoom);
    hud.textContent = hudText(race);
    // For headless checks.
    Object.assign(document.body.dataset, {
      phase: race.phase, frame: String(race.frame),
      tanks: race.racers.filter((r) => r.tank && r.finishedAt === undefined).map((r) => {
        const c = tankCell(r.tank!);
        return `${r.name}@${c.x},${c.y}${c.deck ? 'd' : ''}${r.tank!.ghost ? 'g' : ''}:wp${r.next}`;
      }).join(' '),
    });
  });

  status.textContent = `${course.file.name} on ${mapPath} (${battlefield.theater}), ideal line ${course.length.toFixed(0)} cells. G: passability and ideal line.`;
  if (import.meta.env.DEV) (await import('./race/devPanel.js')).mountDevPanel(race, params);
  document.body.dataset.ready = String(terrain.missing === 0);
}

main().catch((err: unknown) => {
  status.textContent = String(err);
  status.style.color = '#f66';
  document.body.dataset.ready = 'error';
  if (/^Missing install file/.test(String((err as Error)?.message))) showSetup([(err as Error).message]);
});
