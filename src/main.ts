import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { CellGrid } from './battlefield/grid.js';
import { openInstall, readInstall } from './install/read.js';
import { bindSetupKey, showSetup } from './install/setup.js';
import { LEPTONS_PER_CELL, spotLevel, tankCell, TICK_HZ, type Cell } from './movement/index.js';
import { loadCourse as loadCourseArt, type Sprite as CachedSprite } from './load.js';
import { loadSounds } from './audio.js';
import { facingAngle, projectModelPoint } from './ra2/render/voxelRender.js';
import { loadCourse, mapHash, type CourseFile } from './race/course.js';
import { chat, commandList, createRace, secondsLeft, standings, tickRace, type Race, type Racer } from './race/race.js';
import { directorShot, type Shot } from './race/camera.js';
import { mountStreamView, type CameraMode } from './race/view.js';
import { mountOperator, readChoices } from './race/operator.js';

// The race page: a bundled course over its battlefield, the race as the stream sees it (camera modes in race/camera.ts,
// overlay in race/view.ts; the dev panel's button switches Overview / Director).
// `?course=<file name without .json>`, `?seed=N` (race seed), `?zoom=N` (fixed zoom, following the leading tank), `?cell=x,y` (centre
// there). Dev only: `?grid=1` or `G` (passability, ideal line, waypoints), `?fast=N` runs N× game speed, and the
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
// Dev: Vite's server answers *.map as a source map (application/json), so an eager import broke the whole page; dev fetches /courses/maps instead.
// Lazy, so a map Vite cannot import only matters if it is the one requested.
const COURSE_MAPS = import.meta.glob<string>('../courses/maps/*', { query: '?url', import: 'default' });

/** World scale under which tank labels are number chips rather than names (Overview ≈ 0.7, Director ≥ 1.8). */
const CHIPS_BELOW = 1.2;

/** A cached WebP decoded straight into a texture; its pixels never sit in a JS buffer. */
const blobTexture = async (image: Blob) => Texture.from(await createImageBitmap(image));

async function frameTextures(s: CachedSprite): Promise<Texture[]> {
  const { source } = await blobTexture(s.image);
  return s.frames.map((f) => new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
}

/** An SHP animation's frames, each in its place on the full SHP canvas (anchor 0.5 = the SHP's centre). */
async function animTextures(s: CachedSprite): Promise<Texture[]> {
  const { source } = await blobTexture(s.image);
  const orig = new Rectangle(0, 0, s.spriteWidth, s.spriteHeight);
  return s.frames.map((f) => new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h), orig, trim: new Rectangle(f.offsetX, f.offsetY, f.w, f.h) }));
}

/** Stock animations play at 15 frames a second. */
const ANIM_FPS = 15;

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
    case 'cancelled': heading = `${name}: Race cancelled`; break;
  }
  const commands = commandList(race);
  return `${heading}\n${rows}${commands.length ? `\n\n${commands.join('  ')}` : ''}${race.phase === 'racing' && race.feed.length ? `\n\n${race.feed.join('\n')}` : ''}`;
}

async function main() {
  if (import.meta.env.DEV) {
    const next = sessionStorage.getItem('courseEditorNext');
    if (next) { sessionStorage.removeItem('courseEditorNext'); location.href = next; return; }
  }
  let live: Race | undefined; // install setup stays off stream while a race runs
  bindSetupKey(() => !live || ['idle', 'results', 'cancelled'].includes(live.phase));
  const problems = await openInstall();
  if (problems.length) {
    status.textContent = 'RA2 + YR install not found';
    status.style.display = 'block';
    showSetup(problems);
    return;
  }
  const savedCourse = readChoices().course;
  const courseName = params.get('course') ?? (savedCourse && savedCourse !== 'random' ? savedCourse : undefined), edit = import.meta.env.DEV && params.get('edit') === '1';
  let file = Object.entries(COURSES).find(([path]) => !courseName || path === courseName || path.endsWith(`/${courseName}.json`))?.[1];
  if (!file && !edit) throw new Error(`No course ${courseName}`);
  const mapPath = edit && params.get('map') || file!.map;
  const source = edit && params.get('map') ? (params.get('source') === 'shipped' ? 'shipped' : 'install') : file!.source;
  const url = source !== 'shipped' ? undefined : import.meta.env.DEV ? `/courses/maps/${encodeURIComponent(mapPath)}` : await COURSE_MAPS[`../courses/maps/${mapPath}`]?.();
  if (source === 'shipped' && !url) throw new Error(`Missing shipped map ${mapPath}`);
  const read = source === 'shipped' ? async (path: string, offset?: number, length?: number) => {
    if (path !== mapPath) return readInstall(path, offset, length);
    const response = await fetch(url!);
    if (!response.ok) throw new Error(`Missing shipped map ${mapPath}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return offset === undefined ? bytes : bytes.subarray(offset, offset + length!);
  } : readInstall;
  const started = performance.now();
  const { map, mapBytes, art: { battlefield, rhino, tesla, v3, missile, warpOut, warpIn, fire }, cached } = await loadCourseArt(read, mapPath);
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
  live = race;
  const sounds = await loadSounds(read);

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
  // Interaction art over the battlefield: rockets, Tesla tanks, their effects.
  // ponytail: drawn above every object, not depth-sorted; #45 does proper sorting.
  const missiles = new Graphics(), fx = new Container();
  world.addChild(missiles, fx);
  const [v3Tex, missileTex, teslaBody, teslaTurret] = await Promise.all([frameTextures(v3), frameTextures(missile), frameTextures(tesla.body), frameTextures(tesla.turret)]);
  const [warpOutTex, warpInTex, fireTex] = await Promise.all([animTextures(warpOut), animTextures(warpIn), animTextures(fire)]);
  /** Prerender frame for a heading in cells (see the Rhino's `+ 8` below). */
  const frameOf = (dx: number, dy: number) => (Math.round((Math.atan2(dx, -dy) / (2 * Math.PI)) * 32) + 40) % 32;
  let fxUsed = 0;
  const put = (tex: Texture, x: number, y: number) => {
    const sprite = (fx.children[fxUsed++] as Sprite | undefined) ?? fx.addChild(new Sprite());
    sprite.anchor.set(0.5);
    Object.assign(sprite, { texture: tex, visible: true, alpha: 1, tint: 0xffffff });
    sprite.position.set(x, y);
    sprite.scale.set(1);
    return sprite;
  };
  /** Tesla strikes that went off (for the discharge and chronoshift out). */
  const zaps: { x: number; y: number; at: number }[] = [];
  let charging = new Set<Race['teslas'][number]>();
  const ring = (x: number, y: number, z: number, cells: number) => {
    const p = toScreen(x, y, z);
    return missiles.ellipse(p.x, p.y, cells * 30 * Math.SQRT2, cells * 15 * Math.SQRT2);
  };
  const arcs = (x: number, y: number, reach: number, n: number, color: number) => {
    for (let i = 0; i < n; i++) {
      let a = Math.random() * 2 * Math.PI, px = x, py = y;
      missiles.moveTo(px, py);
      for (let k = 0; k < 4; k++) {
        a += (Math.random() - 0.5) * 1.2;
        px += Math.cos(a) * reach / 4; py += Math.sin(a) * reach / 8;
        missiles.lineTo(px, py);
      }
    }
    missiles.stroke({ color, width: 2, alpha: 0.9 });
  };
  if (import.meta.env.DEV) { // the stream never shows the course line or waypoints
    const overlay = passability(grid, terrain.originX, terrain.originY);
    const linePoint = (p: { x: number; y: number }) => toScreen(p.x, p.y, level(Math.floor(p.x), Math.floor(p.y)));
    course.line.forEach((p, i) => (i ? overlay.lineTo(linePoint(p).x, linePoint(p).y) : overlay.moveTo(linePoint(p).x, linePoint(p).y)));
    overlay.stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
    for (const [x, y] of course.file.waypoints) overlay.poly(diamond(x, y)).fill({ color: 0xff00ff, alpha: 0.7 });
    overlay.visible = params.get('grid') === '1';
    world.addChild(overlay);
    addEventListener('keydown', (e) => { if (e.key === 'g' || e.key === 'G') overlay.visible = !overlay.visible; });
  }

  // The Rhinos: one view per racer once its tank is on the start grid, labelled with its name.
  const bodyTex = await frameTextures(rhino.body), turretTex = await frameTextures(rhino.turret);
  // Labels sit on their own layer over everything, at a constant screen size: number chips zoomed out, names zoomed in.
  const tags = new Container();
  world.addChild(tags);
  const views = new Map<Racer, { view: Container; body: Sprite; turret: Sprite; fire: Sprite; effects: Graphics; tag: Container; chip: Graphics; label: Text; prev: { x: number; y: number } }>();
  const viewOf = (r: Racer) => {
    let v = views.get(r);
    if (!v) {
      const body = new Sprite(bodyTex[0]), turret = new Sprite(turretTex[0]);
      body.anchor.set(0.5);
      turret.anchor.set(0.5);
      const label = new Text({ text: r.name, style: { fill: r.bot ? 0xdddddd : 0xffff80, fontSize: 20, fontWeight: '700', fontFamily: 'Segoe UI, sans-serif', stroke: { color: 0x000000, width: 4 } } });
      label.anchor.set(0.5, 1);
      const chip = new Graphics().circle(0, -16, 16).fill(r.bot ? 0x5d6b7d : 0xbd2020).stroke({ color: 0xffffff, width: 2 });
      const tag = new Container();
      tag.addChild(chip, label);
      tags.addChild(tag);
      const view = new Container();
      const effects = new Graphics(), fire = new Sprite(fireTex[0]);
      fire.anchor.set(0.5);
      view.addChild(effects, body, turret, fire);
      things.addChild(view);
      views.set(r, (v = { view, body, turret, fire, effects, tag, chip, label, prev: { x: r.tank!.x, y: r.tank!.y } }));
    }
    return v;
  };

  const focus = cellParam('cell');
  const zoom = Number(params.get('zoom')) || (focus ? 1 : 0);
  let cameraMode: CameraMode = 'overview';
  const drawOverlay = edit ? undefined : mountStreamView();
  if (edit) world.scale.set(Math.min(app.screen.width / terrain.width, app.screen.height / terrain.height));
  const bounds = course.line.map((point) => toScreen(point.x, point.y, level(Math.floor(point.x), Math.floor(point.y))));
  const minCourseX = Math.min(...bounds.map((p) => p.x)), maxCourseX = Math.max(...bounds.map((p) => p.x));
  const minCourseY = Math.min(...bounds.map((p) => p.y)), maxCourseY = Math.max(...bounds.map((p) => p.y));
  const overviewScale = () => Math.min((app.screen.width - 440) / (maxCourseX - minCourseX + 320), (app.screen.height - 160) / (maxCourseY - minCourseY + 320));
  let shot: Shot | undefined;

  // Fixed-step simulation, drawn interpolated.
  const fast = import.meta.env.DEV ? Number(params.get('fast')) || 1 : 1;
  let acc = 0;
  app.ticker.add((t) => {
    acc += (t.deltaMS / 1000) * fast;
    for (let n = 0; acc >= 1 / TICK_HZ && n < 10 * fast; n++, acc -= 1 / TICK_HZ) {
      for (const [r, v] of views) v.prev = { x: r.tank!.x, y: r.tank!.y };
      tickRace(race);
    }
    for (const cue of race.sounds.splice(0)) sounds.play(cue);
    for (const [r, v] of views) if (!race.racers.includes(r)) { // a new race
      v.view.destroy({ children: true });
      v.tag.destroy({ children: true });
      views.delete(r);
    }
    if (!edit) { // the camera, before anything is placed: labels counter-scale against it
    shot = cameraMode === 'director' && race.phase === 'racing' ? directorShot(race, shot) : undefined;
    const scale = zoom || (cameraMode === 'director' && race.phase === 'racing' ? Math.max(1.8, overviewScale() * 2.5) : overviewScale());
    // `?zoom` without `?cell` follows the leading unfinished tank.
    const followed = shot?.racer.tank ?? (zoom ? race.racers.find((r) => r.name === standings(race).find((s) => s.finishTime === undefined)?.name)?.tank : undefined);
    const target = focus ? toScreen(focus.x, focus.y, level(focus.x, focus.y)) : followed ? toScreen(followed.x / LEPTONS_PER_CELL, followed.y / LEPTONS_PER_CELL, spotLevel(grid, followed.cell)) : { x: (minCourseX + maxCourseX) / 2, y: (minCourseY + maxCourseY) / 2 };
    world.scale.set(scale);
    world.position.set((app.screen.width + (cameraMode === 'overview' ? 360 : 0)) / 2 - target.x * scale, app.screen.height / 2 - target.y * scale);
    }
    const a = Math.min(acc * TICK_HZ, 1);
    const ordered = standings(race);
    for (const r of race.racers) {
      const tank = r.tank;
      if (!tank) continue;
      const { view, body, turret, fire, effects, tag, chip, label, prev } = viewOf(r);
      view.visible = tag.visible = r.finishedAt === undefined; // finished tanks leave the battlefield
      const fx = (prev.x + (tank.x - prev.x) * a) / LEPTONS_PER_CELL, fy = (prev.y + (tank.y - prev.y) * a) / LEPTONS_PER_CELL;
      // The prerender's frame 0 looks along -x (screen up-left); movement facing 0 is -y (up-right).
      const f = (Math.round(tank.facing / 2048) + 8) % 32;
      body.texture = bodyTex[f]!;
      turret.texture = turretTex[f]!;
      const stunned = r.stunUntil > race.frame, shielded = r.shieldUntil > race.frame, boosted = r.boostUntil > race.frame;
      body.tint = turret.tint = stunned ? 0xff6030 : boosted ? 0x60ff60 : 0xffffff;
      fire.visible = stunned; // burning until the stun ends
      if (stunned) fire.texture = fireTex[Math.floor((race.frame + a) * ANIM_FPS / TICK_HZ) % fireTex.length]!;
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
      chip.visible = world.scale.x < CHIPS_BELOW;
      const text = chip.visible ? String(ordered.findIndex((s) => s.name === r.name) + 1) : r.name;
      if (label.text !== text) label.text = text;
      label.style.fontSize = chip.visible ? 18 : 20;
      label.y = chip.visible ? -4 : 0;
      tag.position.set(p.x, p.y - 22);
      tag.scale.set(1 / world.scale.x);
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
    fxUsed = 0;
    for (const m of race.missiles) {
      const t = m.target.tank!, tx = t.x / LEPTONS_PER_CELL, ty = t.y / LEPTONS_PER_CELL;
      const flight = Math.min((race.frame + a - m.launched) / (m.arrives - m.launched), 1);
      const x = m.x + (tx - m.x) * flight;
      const y = m.y + (ty - m.y) * flight;
      const p = toScreen(x, y, spotLevel(grid, t.cell));
      put(missileTex[frameOf(tx - m.x, ty - m.y)]!, p.x, p.y - 20 * Math.sin(flight * Math.PI));
    }
    const V3_STEP = 12 / (1.5 * TICK_HZ);
    for (const r of race.v3s) {
      const x = r.x + r.dx * V3_STEP * a, y = r.y + r.dy * V3_STEP * a;
      const lx = Math.min(Math.max(Math.floor(x), 0), grid.width - 1), ly = Math.min(Math.max(Math.floor(y), 0), grid.height - 1);
      const p = toScreen(x, y, level(lx, ly));
      put(v3Tex[frameOf(r.dx, r.dy)]!, p.x, p.y - 12);
    }
    // A chronosphere warps out of the cell the tank left and in at the cell it landed on.
    for (const r of race.racers) {
      if (!r.warp) continue;
      const shown = Math.floor((race.frame + a - r.warp.at) * ANIM_FPS / TICK_HZ);
      for (const [cell, tex] of [[r.warp.from, warpOutTex], [r.warp.to, warpInTex]] as const) {
        if (shown >= tex.length) continue;
        const p = toScreen(cell.x + 0.5, cell.y + 0.5, level(cell.x, cell.y));
        const sprite = put(tex[shown]!, p.x, p.y);
        sprite.alpha = 0.75; // translucent in RA2's art.ini
        sprite.scale.set(0.5); // drawn for the superweapon's 3×3 cells; one tank gets half
      }
    }
    for (const strike of charging) if (!race.teslas.includes(strike)) zaps.push({ x: strike.x, y: strike.y, at: race.frame });
    charging = new Set(race.teslas);
    const teslaAt = (x: number, y: number, alpha: number, tint: number) => {
      const z = level(Math.floor(x), Math.floor(y)), p = toScreen(x, y, z);
      // Beside the target: it takes no cell, so it is drawn half a cell off.
      const sx = p.x - 22, sy = p.y + 6;
      for (const tex of [teslaBody[8]!, teslaTurret[8]!]) {
        const sprite = put(tex, sx, sy);
        sprite.alpha = alpha;
        sprite.tint = tint;
      }
      const ang = facingAngle(8), [px, py, pz] = tesla.pivot;
      const tp = projectModelPoint(px * Math.cos(ang) - py * Math.sin(ang), px * Math.sin(ang) + py * Math.cos(ang), pz);
      fx.children[fxUsed - 1]!.position.set(sx + tp.sx, sy + tp.sy);
      return { x: sx + tp.sx, y: sy + tp.sy - 8, z };
    };
    for (const strike of race.teslas) {
      // Beside its target, interpolated like the target's own view.
      const v = views.get(strike.target), tk = strike.target.tank!;
      const follow = v && strike.target.finishedAt === undefined;
      const x = follow ? (v.prev.x + (tk.x - v.prev.x) * a) / LEPTONS_PER_CELL : strike.x, y = follow ? (v.prev.y + (tk.y - v.prev.y) * a) / LEPTONS_PER_CELL : strike.y;
      const left = (strike.arrives - race.frame - a) / (2 * TICK_HZ), charge = 1 - left;
      const shiftIn = Math.min(charge / 0.15, 1);
      const pulse = 0.5 + 0.5 * Math.sin(race.frame * 1.3);
      const top = teslaAt(x, y, shiftIn, shiftIn < 1 ? 0x80c0ff : 0xffffff);
      if (shiftIn < 1) ring(x, y, top.z, 1 - shiftIn).fill({ color: 0x80c0ff, alpha: 0.6 * (1 - shiftIn) });
      ring(x, y, top.z, 3).stroke({ color: 0x60b0ff, width: 1 + 2 * charge, alpha: 0.25 + 0.5 * charge * pulse });
      arcs(top.x, top.y, 10 + 40 * charge, 1 + Math.floor(charge * 4), 0xc8e8ff);
    }
    for (let i = zaps.length - 1; i >= 0; i--) {
      const zap = zaps[i]!, age = (race.frame + a - zap.at) / (0.6 * TICK_HZ);
      if (age >= 1) { zaps.splice(i, 1); continue; }
      const top = teslaAt(zap.x, zap.y, 1 - age, 0x80c0ff);
      ring(zap.x, zap.y, top.z, 3).fill({ color: 0x9fd8ff, alpha: 0.45 * (1 - age) }).stroke({ color: 0xffffff, width: 3, alpha: 1 - age });
      arcs(top.x, top.y, 3 * 30 * Math.SQRT2, 8, 0xffffff);
    }
    for (let i = fxUsed; i < fx.children.length; i++) fx.children[i]!.visible = false;
    drawOverlay?.(race, shot);
    hud.textContent = hudText(race);
    // For headless checks.
    Object.assign(document.body.dataset, {
      phase: race.phase, frame: String(race.frame),
      effects: `v3:${race.v3s.length} tesla:${race.teslas.length} zap:${zaps.length} sprites:${fxUsed}`,
      tanks: race.racers.filter((r) => r.tank && r.finishedAt === undefined).map((r) => {
        const c = tankCell(r.tank!);
        return `${r.name}@${c.x},${c.y}${c.deck ? 'd' : ''}${r.tank!.ghost ? 'g' : ''}:wp${r.next}`;
      }).join(' '),
    });
  });

  const loadMs = Math.round(performance.now() - started);
  document.body.dataset.load = `${loadMs},${cached ? 'cached' : 'imported'}`;
  status.textContent = `${course.file.name} on ${mapPath} (${map.theater}, ${cached ? 'from cache' : 'imported'} in ${loadMs} ms), ideal line ${course.length.toFixed(0)} cells. G: passability and ideal line.`;
  if (edit) (await import('./race/editor.js')).mountEditor(app, world, grid, mapBytes, file!, toScreen, params.has('map') ? '' : Object.entries(COURSES).find(([, c]) => c === file)![0].replace(/^.*\/|\.json$/g, ''));
  else {
    mountOperator(race, COURSES, Object.entries(COURSES).find(([, candidate]) => candidate === file)?.[0] ?? '', (mode) => { cameraMode = mode; }, sounds.mute);
    // Chat from outside the page (e.g. Streamer.bot via obs-websocket obs-browser emit_event): `chronoChat` with { viewerId, name, text }.
    addEventListener('chronoChat', (event) => {
      const { viewerId, name, text } = (event as CustomEvent).detail ?? {};
      if ([viewerId, name, text].every((v) => typeof v === 'string' && v.length <= 500)) chat(race, { viewerId, name, text });
    });
    if (import.meta.env.DEV) (await import('./race/devPanel.js')).mountDevPanel(race, params);
  }
  document.body.dataset.ready = String(terrain.missing === 0);
}

main().catch((err: unknown) => {
  status.textContent = String(err);
  status.style.display = 'block';
  status.style.color = '#f66';
  document.body.dataset.ready = 'error';
  if (/^Missing install file/.test(String((err as Error)?.message))) showSetup([(err as Error).message]);
});
