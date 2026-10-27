import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { CellGrid } from './battlefield/grid.js';
import { openInstall, readInstall } from './install/read.js';
import { bindSetupKey, showSetup } from './install/setup.js';
import { LEPTONS_PER_CELL, spotLevel, tankCell, TICK_HZ, type Cell } from './movement/index.js';
import { loadCourse as loadCourseArt, type Sprite as CachedSprite } from './load.js';
import { facingAngle, projectModelPoint } from './ra2/render/voxelRender.js';
import { loadCourse, mapHash, type CourseFile } from './race/course.js';
import { commandList, createRace, secondsLeft, standings, tickRace, type Race, type Racer } from './race/race.js';
import { mountStreamView, type CameraMode } from './race/view.js';

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
const COURSE_MAPS = import.meta.glob<string>('../courses/maps/*', { eager: true, query: '?url', import: 'default' });

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

/** Phase, countdown, standings and results as plain text. */
function hudText(race: Race): string {
  const left = secondsLeft(race), name = race.course.file.name;
  const rows = (race.phase === 'results' ? race.results : standings(race)).map((s, i) => {
    const state = s.finishTime !== undefined ? `${s.finishTime.toFixed(1)} s` : race.phase === 'results' ? 'DNF' : `${Math.floor(s.progress * 100)}%`;
    return `${String(i + 1).padStart(2)}. ${s.name.padEnd(16)}${s.bot ? ' bot' : '    '}  ${state}`;
  }).join('\n');
  let heading: string;
  switch (race.phase) {
    case 'idle': heading = `${name}\nNo race.`; break;
    case 'join': heading = `${name}: join window ${left} s`; break;
    case 'countdown': heading = `${name}\n${left}`; break;
    case 'racing': heading = `${name}${race.timer > 0 ? `: finish timer ${left} s` : ''}`; break;
    case 'results': heading = `${name}: results`; break;
  }
  const commands = commandList(race);
  return `${heading}\n${rows}${commands.length ? `\n\n${commands.join('  ')}` : ''}${race.phase === 'racing' && race.feed.length ? `\n\n${race.feed.join('\n')}` : ''}`;
}

async function main() {
  if (import.meta.env.DEV) {
    const next = sessionStorage.getItem('courseEditorNextMap');
    if (next) { sessionStorage.removeItem('courseEditorNextMap'); location.href = next; return; }
  }
  bindSetupKey();
  const problems = await openInstall();
  if (problems.length) {
    status.textContent = 'RA2 + YR install not found';
    status.style.display = 'block';
    showSetup(problems);
    return;
  }
  const courseName = params.get('course'), edit = import.meta.env.DEV && params.get('edit') === '1';
  let file = Object.entries(COURSES).find(([path]) => !courseName || path.endsWith(`/${courseName}.json`))?.[1];
  if (!file && !edit) throw new Error(`No course ${courseName}`);
  const mapPath = edit && params.get('map') || file!.map;
  const source = edit && params.get('map') ? (params.get('source') === 'shipped' ? 'shipped' : 'install') : file!.source;
  const url = source === 'shipped' ? (COURSE_MAPS[`../courses/maps/${mapPath}`] ?? (edit ? `/courses/maps/${encodeURIComponent(mapPath)}` : undefined)) : undefined;
  if (source === 'shipped' && !url) throw new Error(`Missing shipped map ${mapPath}`);
  const read = source === 'shipped' ? async (path: string, offset?: number, length?: number) => {
    if (path !== mapPath) return readInstall(path, offset, length);
    const response = await fetch(url!);
    if (!response.ok) throw new Error(`Missing shipped map ${mapPath}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return offset === undefined ? bytes : bytes.subarray(offset, offset + length!);
  } : readInstall;
  const started = performance.now();
  const { map, mapBytes, art: { battlefield, rhino }, cached } = await loadCourseArt(read, mapPath);
  if (edit && params.get('map')) {
    const first = battlefield.grid.speed.findIndex((speed, i) => speed > 0 && !battlefield.grid.blocked[i] && battlefield.grid.deck[i]! < 0);
    if (first < 0) throw new Error('Map has no drivable ground cells');
    const p: [number, number] = [first % battlefield.grid.width, Math.floor(first / battlefield.grid.width)];
    file = { name: mapPath.replace(/\.[^.]+$/, ''), map: mapPath, mapHash: mapHash(mapBytes), source,
      author: source === 'install' ? 'Westwood Studios' : '', link: '', startGrid: Array.from({ length: 10 }, () => [...p] as [number, number]), waypoints: [], laps: [], finish: [...p], bridges: [] };
  }
  const course = loadCourse(file!, mapBytes, battlefield.grid);
  const { terrain, images, objects, grid } = battlefield;
  const level = (x: number, y: number) => grid.level[y * grid.width + x] ?? 0;
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
    const sprite = new Sprite(await blobTexture(chunk.image));
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
  const textures = await Promise.all(images.map((img) => blobTexture(img.image)));
  const things = new Container({ sortableChildren: true });
  const bridgeSprites = new Map<number, Sprite[]>();
  for (const obj of objects) {
    const sprite = new Sprite(textures[obj.image]);
    sprite.position.set(obj.x, obj.y);
    sprite.zIndex = obj.z;
    things.addChild(sprite);
    const bridge = obj.kind === 'overlay' ? grid.bridge[obj.cellY * grid.width + obj.cellX] ?? -1 : -1;
    if (bridge >= 0) {
      if (!bridgeSprites.has(bridge)) bridgeSprites.set(bridge, []);
      bridgeSprites.get(bridge)!.push(sprite);
    }
  }
  world.addChild(things);
  const bridgeEffects = course.file.bridges.map(([x, y]) => {
    const id = grid.bridge[y * grid.width + x]!, bridge = grid.bridges[id]!;
    const flash = new Graphics();
    for (const i of bridge.cells) {
      const cx = i % grid.width, cy = (i - cx) / grid.width;
      const z = bridge.kind === 'high' ? grid.level[i]! + 4 : grid.level[i]!;
      const p = toScreen(cx, cy, z);
      flash.poly([p.x, p.y, p.x + 30, p.y + 15, p.x, p.y + 30, p.x - 30, p.y + 15]).fill(0xffffff);
    }
    flash.visible = false;
    world.addChild(flash);
    return { id, flash, destroyed: !!bridge.destroyed, changedAt: -Infinity };
  });
  const missiles = new Graphics();
  world.addChild(missiles);
  const overlay = passability(grid, terrain.originX, terrain.originY);
  const linePoint = (p: { x: number; y: number }) => toScreen(p.x, p.y, level(Math.floor(p.x), Math.floor(p.y)));
  course.line.forEach((p, i) => (i ? overlay.lineTo(linePoint(p).x, linePoint(p).y) : overlay.moveTo(linePoint(p).x, linePoint(p).y)));
  overlay.stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
  for (const [x, y] of course.file.waypoints) overlay.poly(diamond(x, y)).fill({ color: 0xff00ff, alpha: 0.7 });
  overlay.visible = params.get('grid') === '1';
  world.addChild(overlay);
  addEventListener('keydown', (e) => { if (e.key === 'g' || e.key === 'G') overlay.visible = !overlay.visible; });

  // The Rhinos: one view per racer once its tank is on the start grid, labelled with its name.
  const bodyTex = await frameTextures(rhino.body), turretTex = await frameTextures(rhino.turret);
  const views = new Map<Racer, { view: Container; body: Sprite; turret: Sprite; effects: Graphics; chip: Graphics; label: Text; prev: { x: number; y: number } }>();
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
      const effects = new Graphics();
      const chip = new Graphics().circle(0, -21, 11).fill(r.bot ? 0x7b899b : 0xc52c2c);
      view.addChild(effects, body, turret, chip, label);
      things.addChild(view);
      views.set(r, (v = { view, body, turret, effects, chip, label, prev: { x: r.tank!.x, y: r.tank!.y } }));
    }
    return v;
  };

  const focus = cellParam('cell');
  const zoom = Number(params.get('zoom')) || (focus ? 1 : 0);
  let cameraMode: CameraMode = 'overview';
  const switchCamera = () => { cameraMode = cameraMode === 'overview' ? 'director' : 'overview'; };
  const drawOverlay = edit ? undefined : mountStreamView();
  if (edit) world.scale.set(Math.min(app.screen.width / terrain.width, app.screen.height / terrain.height));
  const bounds = course.line.map((point) => toScreen(point.x, point.y, level(Math.floor(point.x), Math.floor(point.y))));
  const minCourseX = Math.min(...bounds.map((p) => p.x)), maxCourseX = Math.max(...bounds.map((p) => p.x));
  const minCourseY = Math.min(...bounds.map((p) => p.y)), maxCourseY = Math.max(...bounds.map((p) => p.y));
  const overviewScale = () => Math.min((app.screen.width - 440) / (maxCourseX - minCourseX + 120), (app.screen.height - 160) / (maxCourseY - minCourseY + 120));
  let directorFocus: Racer | undefined, directorReason = 'Leader', cutAt = -Infinity, seenHit = -1;

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
    const ordered = standings(race);
    for (const r of race.racers) {
      const tank = r.tank;
      if (!tank) continue;
      const { view, body, turret, effects, chip, label, prev } = viewOf(r);
      view.visible = r.finishedAt === undefined; // finished tanks leave the battlefield
      const fx = (prev.x + (tank.x - prev.x) * a) / LEPTONS_PER_CELL, fy = (prev.y + (tank.y - prev.y) * a) / LEPTONS_PER_CELL;
      // The prerender's frame 0 looks along -x (screen up-left); movement facing 0 is -y (up-right).
      const f = (Math.round(tank.facing / 2048) + 8) % 32;
      body.texture = bodyTex[f]!;
      turret.texture = turretTex[f]!;
      const stunned = r.stunUntil > race.frame, shielded = r.shieldUntil > race.frame, boosted = r.boostUntil > race.frame;
      body.tint = turret.tint = stunned ? 0xff6030 : boosted ? 0x60ff60 : 0xffffff;
      effects.clear();
      if (shielded) effects.circle(0, -5, 22).stroke({ color: 0x50caff, width: 2, alpha: 0.9 });
      if (r.immunityUntil > race.frame && !stunned) effects.circle(0, -5, 25).stroke({ color: 0xffc030, width: 1, alpha: 0.8 });
      if (r.protectedUntil > race.frame) effects.circle(0, -5, 28).stroke({ color: 0xff55ff, width: 1, alpha: 0.7 });
      const ang = facingAngle(f), [px, py, pz] = rhino.pivot;
      const tp = projectModelPoint(px * Math.cos(ang) - py * Math.sin(ang), px * Math.sin(ang) + py * Math.cos(ang), pz);
      turret.position.set(tp.sx, tp.sy);
      const p = toScreen(fx, fy, spotLevel(grid, tank.cell));
      view.position.set(p.x, p.y);
      view.zIndex = (fx + fy + 1) * 15 + (tank.cell.deck ? 60 : 0);
      view.alpha = tank.ghost ? 0.5 : 1;
      const place = ordered.findIndex((s) => s.name === r.name) + 1;
      label.text = cameraMode === 'director' || zoom ? r.name : String(place);
      chip.visible = cameraMode === 'overview' && !zoom;
      label.style.fontSize = chip.visible ? 13 : 12;
    }
    for (const effect of bridgeEffects) {
      const destroyed = !!grid.bridges[effect.id]!.destroyed;
      if (destroyed !== effect.destroyed) {
        effect.destroyed = destroyed;
        effect.changedAt = race.frame;
        effect.flash.tint = destroyed ? 0xff8c32 : 0x50e8ff;
        for (const sprite of bridgeSprites.get(effect.id) ?? []) sprite.visible = !destroyed;
      }
      const age = race.frame - effect.changedAt;
      effect.flash.visible = age >= 0 && age < TICK_HZ;
      if (effect.flash.visible) effect.flash.alpha = 0.7 * (1 - age / TICK_HZ);
    }
    missiles.clear();
    for (const m of race.missiles) {
      const t = m.target.tank!;
      const flight = Math.min((race.frame + a - m.launched) / (m.arrives - m.launched), 1);
      const x = m.x + (t.x / LEPTONS_PER_CELL - m.x) * flight;
      const y = m.y + (t.y / LEPTONS_PER_CELL - m.y) * flight;
      const p = toScreen(x, y, spotLevel(grid, t.cell));
      missiles.circle(p.x, p.y - 20 * Math.sin(flight * Math.PI), 5).fill(0xffdd50);
    }
    if (!edit) {
    const live = ordered.map((s) => race.racers.find((r) => r.name === s.name)!).filter((r) => r.finishedAt === undefined);
    if (cameraMode === 'director' && race.phase === 'racing') {
      if (race.lastHit && race.lastHitFrame > seenHit && race.frame - cutAt > 2.5 * TICK_HZ) {
        seenHit = race.lastHitFrame;
        directorFocus = race.lastHit;
        directorReason = 'Just hit';
        cutAt = race.frame;
      } else if (live.length && (!directorFocus || directorFocus.finishedAt !== undefined || race.frame - cutAt >= 7 * TICK_HZ)) {
        if (directorReason === 'Leader' && live.length > 1) {
          let closest = 0;
          for (let i = 1; i < live.length - 1; i++) if (live[i]!.progress - live[i + 1]!.progress < live[closest]!.progress - live[closest + 1]!.progress) closest = i;
          directorFocus = live[closest + 1];
          directorReason = `Battle for P${closest + 1}`;
        } else {
          directorFocus = live[0];
          directorReason = 'Leader';
        }
        cutAt = race.frame;
      }
    }
    const scale = zoom || (cameraMode === 'director' && race.phase === 'racing' ? Math.max(1.8, overviewScale() * 2.5) : overviewScale());
    const target = focus ? toScreen(focus.x, focus.y, level(focus.x, focus.y)) : cameraMode === 'director' && race.phase === 'racing' && directorFocus?.tank ? toScreen(directorFocus.tank.x / LEPTONS_PER_CELL, directorFocus.tank.y / LEPTONS_PER_CELL, spotLevel(grid, directorFocus.tank.cell)) : { x: (minCourseX + maxCourseX) / 2, y: (minCourseY + maxCourseY) / 2 };
    world.scale.set(scale);
    world.position.set((app.screen.width + (cameraMode === 'overview' ? 360 : 0)) / 2 - target.x * scale, app.screen.height / 2 - target.y * scale);
    drawOverlay!(race, cameraMode, directorFocus, directorReason);
    }
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

  const loadMs = Math.round(performance.now() - started);
  document.body.dataset.load = `${loadMs},${cached ? 'cached' : 'imported'}`;
  status.textContent = `${course.file.name} on ${mapPath} (${map.theater}, ${cached ? 'from cache' : 'imported'} in ${loadMs} ms), ideal line ${course.length.toFixed(0)} cells. G: passability and ideal line.`;
  if (edit) (await import('./race/editor.js')).mountEditor(app, world, grid, mapBytes, file!, toScreen, params.has('map'));
  else if (import.meta.env.DEV) (await import('./race/devPanel.js')).mountDevPanel(race, params, switchCamera);
  document.body.dataset.ready = String(terrain.missing === 0);
}

main().catch((err: unknown) => {
  status.textContent = String(err);
  status.style.display = 'block';
  status.style.color = '#f66';
  document.body.dataset.ready = 'error';
  if (/^Missing install file/.test(String((err as Error)?.message))) showSetup([(err as Error).message]);
});
