import { Container as PixiContainer, Graphics, Point, Text, type Application, type Container } from 'pixi.js';
import type { CellGrid } from '../battlefield/grid.js';
import { courseSlug, finishAreaOf, mapHash, type CourseFile, type LinePoint } from './course.js';
import { exportCourse } from './courseFile.js';
import { closestSegment, inspectCourse, type CourseDraft } from './editorModel.js';
import { simulateRace, type Race } from './race.js';
import './editor.css';

// Loaded only by the dev page. All edits stay in this draft until Save succeeds.
// `origin` is the course's own file name (`courses/<origin>.json`), empty for a new course.
export function mountEditor(app: Application, world: Container, grid: CellGrid, bytes: Uint8Array, original: CourseFile,
  toScreen: (x: number, y: number, z: number) => { x: number; y: number }, origin: string, race: Race): void {
  const fresh = !origin;
  const file: CourseDraft = structuredClone(original);
  file.forks ??= [];
  for (const fork of file.forks) { fork.to ??= fork.from + 1; fork.weight ??= 50; }
  if (fresh) { file.startGrid = []; delete file.finish; }
  file.mapHash = mapHash(bytes);
  const panel = document.createElement('section');
  panel.id = 'course-editor';
  panel.setAttribute('aria-label', 'Course editor');
  panel.innerHTML = `<div class="inner"><header><h1>Course editor</h1><small>dev only</small><span class="dirty" hidden>Unsaved</span></header><div class="scroll">
    <section><h2>Course</h2><div class="field">
      <label for="ce-open">Open</label><select id="ce-open" name="open"><option value="">Saved course or new course…</option></select>
      <label for="ce-name">Name</label><input id="ce-name" name="name">
      <label for="ce-author">Author</label><input id="ce-author" name="author">
      <label for="ce-link">Source link</label><input id="ce-link" name="link">
      <span class="label">Map</span><span class="map"></span></div></section>
    <section><h2>Tools</h2><div class="tools">
      <button class="tool" data-mode="select" data-key="1" aria-keyshortcuts="1"><kbd aria-hidden="true">1</kbd><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 3 13 9-6 1-2 7z"/></svg>Select</button>
      <button class="tool" data-mode="start" data-key="2" aria-keyshortcuts="2"><kbd aria-hidden="true">2</kbd><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 21 12 12 21 3 12z"/></svg>Start cells</button>
      <button class="tool" data-mode="waypoint" data-key="3" aria-keyshortcuts="3"><kbd aria-hidden="true">3</kbd><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>Waypoint</button>
      <button class="tool" data-mode="finish" data-key="4" aria-keyshortcuts="4"><kbd aria-hidden="true">4</kbd><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h12l-2 4 2 4H5"/></svg>Finish</button>
      <button class="tool" data-mode="bridge" data-key="5" aria-keyshortcuts="5"><kbd aria-hidden="true">5</kbd><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18M5 15c2-5 12-5 14 0M7 15v4M17 15v4"/></svg>Bridge</button>
    </div><p class="hint"></p><div class="cell-entry"><label>Cell X <input name="cell-x" type="number" min="0" step="1"></label><label>Y <input name="cell-y" type="number" min="0" step="1"></label><button name="place-cell">Place cell</button></div></section>
    <section><h2>Start grid <b class="start-count"></b></h2><div class="starts slots"></div></section>
    <section><h2>Waypoints <b class="waypoint-count"></b></h2><div class="waypoints list"></div></section>
    <section><h2>Forks</h2><div class="forks list"></div></section>
    <section><h2>Lap sections</h2><div class="laps"></div><div class="row"><button name="add-lap">Add lap section</button></div></section>
    <section><h2>Bridges in play <b class="bridge-count"></b></h2><div class="bridges list"></div><div class="row"><button name="suggest">Use suggested order</button></div></section>
    <section><h2>Validation</h2><div class="report" role="status" aria-live="polite"></div></section>
    <section><h2>Custom map</h2><div class="row"><input name="map-file" type="file" accept=".map,.yrm,.mpr" aria-label="Custom map file (.map, .yrm, .mpr)"><button name="use-map">Use custom map</button></div></section>
    </div><footer><div class="row"><button name="undo" disabled aria-keyshortcuts="Control+Z">Undo</button><button name="redo" disabled aria-keyshortcuts="Control+Y">Redo</button><button class="primary" name="save">Save course</button><button name="save-as">Save as…</button><button name="export">Download course file</button><button name="simulate">Simulate race (10 bots)</button></div><span class="save-reason"></span><span class="saved" role="status"></span></footer></div>`;
  document.body.append(panel);
  const $ = <T extends Element = HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const input = (name: string) => $<HTMLInputElement>(`[name="${name}"]`);
  const button = (text: string, onclick: () => void) => Object.assign(document.createElement('button'), { textContent: text, onclick });
  input('name').value = file.name; input('author').value = file.author; input('link').value = file.link;
  // Credit only matters for a custom map, which ships with its course (ADR 0006).
  if (file.source !== 'shipped') panel.querySelectorAll('[for=ce-author], #ce-author, [for=ce-link], #ce-link').forEach((field) => field.toggleAttribute('hidden', true));
  $('.map').innerHTML = '<b></b> · ';
  $('.map b').textContent = file.map;
  $('.map').append(file.source === 'shipped' ? 'custom map' : 'install map');
  const art = new Graphics(); world.addChild(art);
  const area = world.getChildByLabel('finish-area') as Graphics; // main.ts's chequer, under the buildings
  const labels = new PixiContainer(); world.addChild(labels);
  let mode: 'select' | 'start' | 'finish' | 'waypoint' | 'bridge' | 'insert' | 'fork' = 'select', insertAt = 0, forkAt = 0;
  let startAt = file.startGrid.length % 10, startSlotChosen = false;
  let drag: { kind: 'start' | 'finish' | 'waypoint' | 'fork' | 'bridge'; index: number; fork?: number } | undefined;
  let pan: { x: number; y: number; wx: number; wy: number } | undefined;
  const history = [JSON.stringify(file)];
  let historyAt = 0, clean = history[0]!, writing = false, lastLine: LinePoint[] | undefined;
  let typing = '', typed = ''; // the text field being typed in, and the one the last history step came from
  const restore = (step: number) => {
    historyAt = step; typed = '';
    for (const key of Object.keys(file)) delete file[key as keyof CourseDraft]; // a key the snapshot lacks (`finish`) must go too
    Object.assign(file, JSON.parse(history[step]!));
    input('name').value = file.name; input('author').value = file.author; input('link').value = file.link;
    mode = 'select'; modes();
  };
  const navigate = (url: string) => { if (JSON.stringify(file) === clean || confirm('Discard unsaved course changes?')) { writing = true; location.href = url; } };
  window.addEventListener('beforeunload', (event) => { if (!writing && JSON.stringify(file) !== clean) event.preventDefault(); });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { mode = 'select'; modes(); return; }
    const tool = !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) &&
      panel.querySelector<HTMLButtonElement>(`[data-key="${event.key}"]`);
    if (tool) { event.preventDefault(); tool.click(); return; }
    if (!(event.ctrlKey || event.metaKey) || !['z', 'y'].includes(event.key.toLowerCase()) ||
      event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const step = historyAt + (event.key.toLowerCase() === 'y' || event.shiftKey ? 1 : -1);
    if (step >= 0 && step < history.length) { event.preventDefault(); restore(step); }
  });
  const xy = (c: [number, number]) => toScreen(c[0] + 0.5, c[1] + 0.5, grid.level[c[1] * grid.width + c[0]] ?? 0);
  const forkPath = () => {
    const fork = file.forks![forkAt]!;
    return [file.waypoints[fork.from]!, ...fork.via, file.waypoints[fork.to!]!].map(xy);
  };
  const at = (event: PointerEvent): [number, number] | undefined => {
    const local = world.toLocal(new Point(event.clientX, event.clientY));
    let best: [number, number] = [0, 0], distance = Infinity;
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
      if (grid.speed[y * grid.width + x]! <= 0 && grid.deck[y * grid.width + x]! < 0) continue;
      const p = xy([x, y]), d = Math.hypot((p.x - local.x) / 30, (p.y - local.y) / 15);
      if (d < distance) { distance = d; best = [x, y]; }
    }
    return distance <= 1.8 ? best : undefined;
  };
  // A constant screen size at any zoom; each kind its own shape, all outlined dark so they read on sand and snow alike.
  const OUTLINE = 0x080b10;
  const marker = (p: [number, number], kind: 'start' | 'waypoint' | 'finish' | 'bridge' | 'fork', label: string) => {
    const s = xy(p), k = 1 / world.scale.x, r = 11 * k, stroke = { color: OUTLINE, width: 2.5 * k };
    if (badPoints.some(([x, y]) => x === p[0] && y === p[1])) art.circle(s.x, s.y, 20 * k).stroke({ color: 0xff5555, width: 4 * k });
    if (kind === 'start') art.poly([s.x, s.y - r * 1.2, s.x + r * 1.2, s.y, s.x, s.y + r * 1.2, s.x - r * 1.2, s.y]).fill(0x35d6ff).stroke(stroke);
    else if (kind === 'waypoint') art.circle(s.x, s.y, r * 1.15).fill(0xffd34e).stroke(stroke);
    else if (kind === 'fork') art.circle(s.x, s.y, r).fill(0x9de675).stroke(stroke);
    else if (kind === 'bridge') art.roundRect(s.x - 17 * k, s.y - 10 * k, 34 * k, 20 * k, 4 * k).fill(0xff9a2e).stroke(stroke);
    else {
      art.circle(s.x, s.y, r * 1.35).fill(0xffffff).stroke(stroke);
      const q = r * 0.45; // a 4×4 chequer inside the disc
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) art.rect(s.x + (i - 2) * q, s.y + (j - 2) * q, q, q).fill(OUTLINE);
      return;
    }
    const text = new Text({ text: label, style: { fill: OUTLINE, fontFamily: 'Segoe UI, sans-serif', fontWeight: '800', fontSize: 13 * k } });
    text.anchor.set(0.5);
    text.position.set(s.x, s.y);
    labels.addChild(text);
  };
  let badPoints: [number, number][] = [];
  const errorPoint = (message: string): [number, number] | undefined => {
    const n = Number(message.match(/\b(?:Start|Waypoint|Fork|Lap section|B)(?:\s*)(\d+)/i)?.[1]) - 1;
    if (message.startsWith('Start ')) return file.startGrid[n];
    if (message.startsWith('Waypoint ')) return file.waypoints[n];
    if (message.startsWith('Finish')) return file.finish;
    if (message.startsWith('Fork ')) return file.forks?.[n]?.via[0] ?? file.waypoints[file.forks?.[n]?.from ?? -1];
    if (message.startsWith('Lap section ')) return file.waypoints[file.laps[n]?.from ?? -1];
    if (/^B\d+/.test(message)) return file.bridges[n];
    const coords = message.match(/(-?\d+),(-?\d+) can't be reached/);
    return coords ? [Number(coords[1]), Number(coords[2])] : undefined;
  };
  const refresh = () => {
    const snapshot = JSON.stringify(file);
    // Typing in one field is one undo step, not one per key.
    if (!drag && snapshot !== history[historyAt]) {
      if (typing && typing === typed && historyAt === history.length - 1) history[historyAt] = snapshot;
      else { history.splice(historyAt + 1); history.push(snapshot); historyAt++; }
      typed = typing;
    }
    typing = '';
    input('undo').disabled = historyAt === 0;
    input('redo').disabled = historyAt === history.length - 1;
    $('.dirty').toggleAttribute('hidden', snapshot === clean);
    const result = inspectCourse(file, bytes, grid);
    if (result.course && !result.errors.length) lastLine = result.course.line;
    badPoints = result.errors.map(errorPoint).filter((p): p is [number, number] => !!p);
    const report = $('.report');
    report.replaceChildren();
    report.classList.toggle('bad', result.errors.length > 0);
    for (const line of result.errors.length ? result.errors : [`Valid · ideal ${result.course!.length.toFixed(0)} cells · estimated ${Math.ceil(result.seconds!)} s`]) {
      const p = errorPoint(line);
      const row = document.createElement(p ? 'button' : 'div'); row.textContent = line;
      if (p) row.addEventListener('click', () => {
        const s = xy(p);
        world.position.set((app.screen.width - panel.offsetWidth) / 2 - s.x * world.scale.x, app.screen.height / 2 - s.y * world.scale.y);
        refresh();
      });
      report.append(row);
    }
    input('save').disabled = input('save-as').disabled = input('export').disabled = input('simulate').disabled = result.errors.length > 0;
    $('.save-reason').textContent = result.errors.length ? `${result.errors.length} issue${result.errors.length === 1 ? '' : 's'} to fix before saving. See Validation above.` : '';
    art.clear();
    labels.removeChildren().forEach((label) => label.destroy());
    const linePoint = (p: LinePoint) => { const i = Math.floor(p.y) * grid.width + Math.floor(p.x); return toScreen(p.x, p.y, (p.deck ? grid.deck[i] : grid.level[i]) ?? 0); };
    if (lastLine) for (const [width, color, alpha] of [[5, OUTLINE, 0.5], [2.5, 0xffffff, result.errors.length ? 0.3 : 0.9]] as const) {
      lastLine.forEach((p, i) => { const s = linePoint(p); i ? art.lineTo(s.x, s.y) : art.moveTo(s.x, s.y); });
      art.stroke({ color, width: width / world.scale.x, alpha });
    }
    area.clear();
    if (file.finish) for (const i of finishAreaOf(grid, { x: file.finish[0], y: file.finish[1] })) {
      const x = i % grid.width, y = (i - x) / grid.width, p = toScreen(x, y, grid.level[i] ?? 0);
      area.poly([p.x, p.y, p.x + 30, p.y + 15, p.x, p.y + 30, p.x - 30, p.y + 15]).fill({ color: (x + y) % 2 ? 0xffffff : 0x111111, alpha: 0.6 });
    }
    if (result.course) for (const fork of result.course.forks.values()) {
      fork.line.forEach((p, i) => { const s = linePoint(p); i ? art.lineTo(s.x, s.y) : art.moveTo(s.x, s.y); });
      art.stroke({ color: 0x9de675, width: 3 / world.scale.x, alpha: 0.9 });
    }
    if (mode === 'fork') {
      forkPath().forEach((p, i) => { i ? art.lineTo(p.x, p.y) : art.moveTo(p.x, p.y); });
      art.stroke({ color: 0x35d6ff, width: 2 / world.scale.x, alpha: 0.9 });
    }
    file.startGrid.forEach((p, i) => marker(p, 'start', String(i + 1)));
    file.waypoints.forEach((p, i) => marker(p, 'waypoint', String(i + 1)));
    file.forks!.forEach((fork, i) => fork.via.forEach((p, j) => marker(p, 'fork', `${i + 1}.${j + 1}`)));
    file.bridges.forEach((p, i) => marker(p, 'bridge', `B${i + 1}`));
    if (file.finish) marker(file.finish, 'finish', '');
    $('.start-count').textContent = `${file.startGrid.length} / 10`;
    $('.start-count').classList.toggle('incomplete', file.startGrid.length < 10);
    $('.waypoint-count').textContent = String(file.waypoints.length);
    $('.bridge-count').textContent = String(file.bridges.length);
    // Ten slots: clicking one picks the cell the next map click places; × takes a placed cell out.
    $('.starts').replaceChildren(...Array.from({ length: 10 }, (_, i) => {
      const p = file.startGrid[i];
      const slot = button('', () => { mode = 'start'; startAt = Math.min(i, file.startGrid.length); startSlotChosen = true; modes(); });
      slot.className = `slot${p ? ' set' : ''}${mode === 'start' && i === startAt ? ' next' : ''}${p && badPoints.some(([x, y]) => x === p[0] && y === p[1]) ? ' invalid' : ''}`;
      slot.innerHTML = `<b>${i + 1}</b>`;
      slot.append(p ? p.join(',') : i === startAt ? 'next' : '–');
      slot.setAttribute('aria-label', `Set start ${i + 1}${p ? `, ${p.join(', ')}` : ''}`);
      const wrapper = document.createElement('div'); wrapper.className = 'slot-wrap'; wrapper.append(slot);
      if (p) {
        const remove = button('×', () => { file.startGrid.splice(i, 1); startAt = Math.min(startAt, file.startGrid.length); refresh(); });
        remove.className = 'remove'; remove.setAttribute('aria-label', `Remove start ${i + 1}`);
        wrapper.append(remove);
      }
      return wrapper;
    }));
    const row = (tag: string, round: boolean, p: [number, number] | string, ...buttons: HTMLButtonElement[]) => {
      const div = document.createElement('div'), n = document.createElement('span'), xy = document.createElement('span'), actions = document.createElement('span');
      n.className = round ? 'n' : 'n bridge'; n.textContent = tag;
      xy.className = 'xy'; xy.textContent = typeof p === 'string' ? p : p.join(', ');
      actions.className = 'row'; actions.append(...buttons);
      if (typeof p !== 'string' && badPoints.some(([x, y]) => x === p[0] && y === p[1])) div.classList.add('invalid');
      div.append(n, xy, actions);
      return div;
    };
    $('.waypoints').replaceChildren(...file.waypoints.map((p, i) => row(String(i + 1), true, p,
      button('Insert before', () => { mode = 'insert'; insertAt = i; modes(); }),
      ...(i < file.waypoints.length - 1 && !file.forks!.some((fork) => fork.from === i) ? [button('Add fork', () => {
        file.forks!.push({ from: i, to: i + 1, via: [], weight: 50 }); forkAt = file.forks!.length - 1; mode = 'fork'; modes();
      })] : []),
      button('Remove', () => {
        file.waypoints.splice(i, 1);
        file.forks = file.forks!.filter((fork) => fork.from !== i && fork.to !== i);
        for (const fork of file.forks) { if (fork.from > i) fork.from--; if (fork.to! > i) fork.to = fork.to! - 1; }
        for (const lap of file.laps) { if (lap.from > i) lap.from--; if (lap.to >= i) lap.to--; }
        mode = 'select'; modes();
      }))));
    $('.forks').replaceChildren(...file.forks!.map((fork, i) => {
      const edit = button(`Edit fork (${fork.via.length})`, () => { forkAt = i; mode = 'fork'; modes(); });
      edit.setAttribute('aria-pressed', String(mode === 'fork' && forkAt === i));
      const div = row(`${fork.from + 1}→${fork.to! + 1}`, false, `${fork.via.length} fork cell${fork.via.length === 1 ? '' : 's'}`,
        edit,
        ...fork.via.map((p, j) => button(`Remove ${j + 1}: ${p.join(',')}`, () => { fork.via.splice(j, 1); refresh(); })),
        button('Remove', () => { file.forks!.splice(i, 1); mode = 'select'; modes(); }));
      if (result.errors.some((error) => error.startsWith(`Fork ${i + 1} `))) div.classList.add('invalid');
      const merge = document.createElement('select');
      merge.setAttribute('aria-label', `Fork ${i + 1} merges at waypoint`);
      for (let target = fork.from + 1; target < file.waypoints.length; target++) merge.add(new Option(`Merge at waypoint ${target + 1}`, String(target)));
      merge.value = String(fork.to);
      merge.onchange = () => { fork.to = Number(merge.value); refresh(); };
      const weightLabel = document.createElement('label');
      weightLabel.textContent = 'Chance of taking the fork (%)';
      const weight = document.createElement('input');
      weight.type = 'number'; weight.min = '0'; weight.max = '100'; weight.step = '1'; weight.value = String(fork.weight);
      weight.onchange = () => { fork.weight = weight.value.trim() ? Number(weight.value) : NaN; refresh(); };
      weightLabel.append(weight);
      div.querySelector('.row')!.prepend(merge, weightLabel);
      return div;
    }));
    $('.laps').replaceChildren(...file.laps.map((lap, i) => {
      const div = document.createElement('div');
      if (result.errors.some((error) => error.startsWith(`Lap section ${i + 1} `))) div.classList.add('invalid');
      for (const [key, text] of [['from', 'From waypoint'], ['to', 'To waypoint'], ['count', 'Times to drive section']] as const) {
        const label = document.createElement('label'); label.textContent = text;
        const field = document.createElement('input'); field.type = 'number'; field.min = key === 'count' ? '2' : '1';
        field.value = String(key === 'count' ? lap[key] : lap[key] + 1);
        field.onchange = () => { lap[key] = Number(field.value) - (key === 'count' ? 0 : 1); refresh(); };
        label.append(field); div.append(label);
      }
      div.append(button('Remove', () => { file.laps.splice(i, 1); refresh(); }));
      return div;
    }));
    const swap = (i: number, j: number) => { if (file.bridges[j]) [file.bridges[i], file.bridges[j]] = [file.bridges[j]!, file.bridges[i]!]; refresh(); };
    $('.bridges').replaceChildren(...file.bridges.map((p, i) => row(`B${i + 1}`, false, p,
      button('Up', () => swap(i, i - 1)), button('Down', () => swap(i, i + 1)), button('Remove', () => { file.bridges.splice(i, 1); refresh(); }))));
    input('suggest').textContent = `Use suggested order (${result.suggestedBridges.length})`;
    $('.hint').textContent = `${{
      select: 'Select to inspect or drag markers. Choose a tool to place cells.',
      start: `Click a cell to place start ${startAt + 1}.`,
      waypoint: `Click a cell to add waypoint ${file.waypoints.length + 1} at the end.`,
      insert: `Click a cell to insert a waypoint before waypoint ${insertAt + 1}.`,
      fork: 'Click near the cyan line to add a fork cell between its nearest points. Drag green fork cells to move them.',
      finish: file.finish ? 'Click a cell to move the finish.' : 'Click a cell to place the finish.',
      bridge: 'Click a bridge to add it to the bridges in play.',
    }[mode]} Drag a marker to move it · wheel zooms · middle drag pans · 1–5 pick tools · Esc selects.`;
  };
  // The selected tool and what a click on the battlefield does with it.
  const modes = () => {
    panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((tool) => tool.setAttribute('aria-pressed', String(tool.dataset.mode === (mode === 'insert' ? 'waypoint' : mode))));
    refresh();
  };
  panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((tool) => tool.onclick = () => { mode = tool.dataset.mode as typeof mode; modes(); });
  for (const key of ['name', 'author', 'link'] as const) input(key).oninput = () => { file[key] = input(key).value; typing = key; refresh(); };
  input('undo').onclick = () => restore(historyAt - 1);
  input('redo').onclick = () => restore(historyAt + 1);
  input('add-lap').onclick = () => { file.laps.push({ from: 0, to: Math.max(0, file.waypoints.length - 1), count: 2 }); refresh(); };
  input('suggest').onclick = () => { file.bridges = inspectCourse(file, bytes, grid).suggestedBridges; refresh(); };
  const save = async (overwrite = false): Promise<void> => {
    const saved = $('.saved'); saved.textContent = 'Saving…';
    if (inspectCourse(file, bytes, grid).errors.length) { saved.textContent = 'Invalid course'; return; }
    const slug = courseSlug(file.name);
    sessionStorage.setItem('courseEditorNext', `?edit=1&course=${slug}`); // Vite reloads once the course file changes.
    writing = true;
    try {
      const res = await fetch(`/__course/save?origin=${encodeURIComponent(origin)}${overwrite ? '&overwrite=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(file) });
      if (res.status === 409) {
        sessionStorage.removeItem('courseEditorNext');
        writing = false;
        if (confirm(await res.text())) return save(true);
        saved.textContent = 'Not saved: choose another name.';
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      saved.textContent = `Saved ${await res.text()}`;
      clean = JSON.stringify(file);
      location.href = `?edit=1&course=${slug}`;
    } catch (error) { writing = false; sessionStorage.removeItem('courseEditorNext'); saved.textContent = error instanceof Error ? error.message : String(error); }
  };
  input('save').onclick = () => save();
  // Races the draft as it stands, unsaved; the HUD shows standings and results.
  input('simulate').onclick = () => { const { course } = inspectCourse(file, bytes, grid); if (course) simulateRace(race, course); };
  // One file to hand an operator (ADR 0007); its custom map travels inside.
  input('export').onclick = () => {
    if (file.source === 'shipped' && (!file.author.trim() || !file.link.trim())) { $('.saved').textContent = 'A custom map travels with its author and source link: fill both in to download the course file.'; return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([exportCourse(file as CourseFile, bytes)], { type: 'application/json' }));
    link.download = `${courseSlug(file.name)}.rhino-course.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  input('save-as').onclick = () => {
    const name = prompt('Save as a new course named:', file.name)?.trim();
    if (!name) return;
    file.name = input('name').value = name;
    refresh();
    void save();
  };
  void fetch('/__course/list').then((res) => res.json()).then(({ courses, installMaps, customMaps }: {
    courses: { file: string; name: string; map: string; source: string }[]; installMaps: string[]; customMaps: string[];
  }) => {
    const open = $<HTMLSelectElement>('[name="open"]');
    const group = (label: string, options: [string, string][]) => {
      if (!options.length) return;
      const g = document.createElement('optgroup'); g.label = label;
      for (const [text, value] of options) g.append(new Option(text, value));
      open.append(g);
    };
    for (const map of [...new Set(courses.map((c) => c.map))].sort()) {
      group(`Saved courses on ${map}`, courses.filter((c) => c.map === map).map((c) => [`${c.name}${c.file === origin ? ' (open)' : ''}`, `?edit=1&course=${encodeURIComponent(c.file)}`]));
    }
    group('New course on an install map', installMaps.map((m) => [m, `?edit=1&map=${encodeURIComponent(m)}`]));
    group('New course on a custom map', customMaps.map((m) => [m, `?edit=1&map=${encodeURIComponent(m)}&source=shipped`]));
    open.onchange = () => { if (open.value) navigate(open.value); open.value = ''; };
  });
  /** Uploads `selected` as `name`; a different map of that name is replaced only when the course maker keeps the name. Returns the name used. */
  const upload = async (selected: File, name: string, replace = false): Promise<string> => {
    sessionStorage.setItem('courseEditorNext', `?edit=1&map=${encodeURIComponent(name)}&source=shipped`); // Vite may reload as soon as the map file appears.
    writing = true;
    const res = await fetch(`/__course/map/${encodeURIComponent(name)}${replace ? '?replace=1' : ''}`, { method: 'PUT', body: selected });
    if (res.status === 409) {
      writing = false;
      const { message, suggested, usedBy } = await res.json() as { message: string; suggested: string; usedBy: string[] };
      const warning = usedBy.length ? ` Saved courses use it (${usedBy.join(', ')}); replacing it means they no longer match their map.` : '';
      const choice = prompt(`${message}${warning}

Save your file as (keep ${name} to replace it):`, suggested)?.trim();
      if (!choice) throw new Error('Upload cancelled.');
      return upload(selected, choice, choice === name);
    }
    if (!res.ok) throw new Error(await res.text());
    return name;
  };
  input('use-map').onclick = async () => {
    const selected = input('map-file').files?.[0]; if (!selected) return;
    if (JSON.stringify(file) !== clean && !confirm('Discard unsaved course changes and open the custom map?')) return;
    try {
      const name = await upload(selected, selected.name);
      sessionStorage.removeItem('courseEditorNext');
      clean = JSON.stringify(file);
      location.href = `?edit=1&map=${encodeURIComponent(name)}&source=shipped`;
    } catch (error) { writing = false; sessionStorage.removeItem('courseEditorNext'); $('.saved').textContent = error instanceof Error ? error.message : String(error); }
  };
  const place = (p: [number, number], local = xy(p)) => {
    $('.saved').textContent = '';
    if (mode === 'select') { $('.saved').textContent = 'Choose a placement tool first.'; return; }
    if (mode === 'start') {
      if (file.startGrid.length === 10 && !startSlotChosen) { $('.saved').textContent = 'All start cells are set. Select a numbered slot to replace it.'; return; }
      file.startGrid[startAt] = p; startAt = Math.min(file.startGrid.length, 9); startSlotChosen = false;
    }
    if (mode === 'finish') file.finish = p;
    if (mode === 'waypoint') file.waypoints.push(p);
    if (mode === 'fork') file.forks![forkAt]!.via.splice(closestSegment(forkPath(), local), 0, p);
    if (mode === 'insert') {
      file.waypoints.splice(insertAt, 0, p);
      for (const fork of file.forks!) { if (fork.from >= insertAt) fork.from++; if (fork.to! >= insertAt) fork.to = fork.to! + 1; }
      for (const lap of file.laps) { if (lap.from >= insertAt) lap.from++; if (lap.to >= insertAt) lap.to++; }
      mode = 'select'; modes();
    }
    if (mode === 'bridge') {
      const id = grid.bridge[p[1] * grid.width + p[0]];
      if (id !== undefined && id >= 0) file.bridges.push(p);
      else $('.saved').textContent = 'Select a bridge cell to add it.';
    }
    refresh();
  };
  input('place-cell').onclick = () => {
    const x = Number(input('cell-x').value), y = Number(input('cell-y').value);
    if (!input('cell-x').value || !input('cell-y').value || !Number.isInteger(x) || !Number.isInteger(y) ||
      x < 0 || y < 0 || x >= grid.width || y >= grid.height ||
      (grid.speed[y * grid.width + x]! <= 0 && grid.deck[y * grid.width + x]! < 0)) {
      $('.saved').textContent = 'Enter a drivable cell within the map bounds.'; return;
    }
    place([x, y]);
  };
  $('.cell-entry').onkeydown = (event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) input('place-cell').click(); };
  const canvas = app.canvas;
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.shiftKey) { world.position.set(world.x - event.deltaX, world.y - event.deltaY); return; }
    const before = world.toLocal(new Point(event.clientX, event.clientY));
    world.scale.set(Math.max(0.15, Math.min(4, world.scale.x * (event.deltaY < 0 ? 1.2 : 1 / 1.2))));
    const after = world.toLocal(new Point(event.clientX, event.clientY));
    world.position.set(world.x + (after.x - before.x) * world.scale.x, world.y + (after.y - before.y) * world.scale.y);
    refresh();
  }, { passive: false });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 1) { pan = { x: event.clientX, y: event.clientY, wx: world.x, wy: world.y }; canvas.setPointerCapture(event.pointerId); return; }
    if (event.button !== 0) return;
    const local = world.toLocal(new Point(event.clientX, event.clientY));
    const hits = [...file.startGrid.map((p, i) => ({ kind: 'start' as const, index: i, p })),
      ...file.waypoints.map((p, i) => ({ kind: 'waypoint' as const, index: i, p })),
      ...file.forks!.flatMap((fork, i) => fork.via.map((p, j) => ({ kind: 'fork' as const, index: j, fork: i, p }))),
      ...file.bridges.map((p, i) => ({ kind: 'bridge' as const, index: i, p })),
      ...(file.finish ? [{ kind: 'finish' as const, index: 0, p: file.finish }] : [])];
    drag = hits.find(({ p }) => { const s = xy(p); return Math.hypot(s.x - local.x, s.y - local.y) < 12 / world.scale.x; });
    if (drag?.kind === 'fork') { forkAt = drag.fork!; mode = 'fork'; modes(); }
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (pan) { world.position.set(pan.wx + event.clientX - pan.x, pan.wy + event.clientY - pan.y); return; }
    if (!drag) return;
    const p = at(event);
    if (!p || (drag.kind === 'bridge' && grid.bridge[p[1] * grid.width + p[0]]! < 0)) return;
    if (drag.kind === 'start') file.startGrid[drag.index] = p;
    else if (drag.kind === 'waypoint') file.waypoints[drag.index] = p;
    else if (drag.kind === 'fork') file.forks![drag.fork!]!.via[drag.index] = p;
    else if (drag.kind === 'bridge') file.bridges[drag.index] = p;
    else file.finish = p;
    refresh();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (pan) { pan = undefined; return; }
    if (drag) { drag = undefined; refresh(); return; }
    if (event.button !== 0) return;
    const p = at(event);
    if (!p) return;
    place(p, world.toLocal(new Point(event.clientX, event.clientY)));
  });
  modes();
}
