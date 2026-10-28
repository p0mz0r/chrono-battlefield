import { Container as PixiContainer, Graphics, Point, Text, type Application, type Container } from 'pixi.js';
import type { CellGrid } from '../battlefield/grid.js';
import { courseSlug, mapHash, type CourseFile } from './course.js';
import { exportCourse } from './courseFile.js';
import { inspectCourse } from './editorModel.js';
import './editor.css';

// Loaded only by the dev page. All edits stay in this draft until Save succeeds.
// `origin` is the course's own file name (`courses/<origin>.json`), empty for a new course.
export function mountEditor(app: Application, world: Container, grid: CellGrid, bytes: Uint8Array, original: CourseFile,
  toScreen: (x: number, y: number, z: number) => { x: number; y: number }, origin: string): void {
  const fresh = !origin;
  const file: CourseFile = structuredClone(original);
  if (fresh) file.startGrid = [];
  file.mapHash = mapHash(bytes);
  const panel = document.createElement('section');
  panel.id = 'course-editor';
  panel.innerHTML = `<div class="inner"><header><h1>Course editor</h1><small>dev only</small></header><div class="scroll">
    <section><h2>Course</h2><div class="field">
      <label for="ce-open">Open</label><select id="ce-open" name="open"><option value="">Saved course or new course…</option></select>
      <label for="ce-name">Name</label><input id="ce-name" name="name">
      <label for="ce-author">Author</label><input id="ce-author" name="author">
      <label for="ce-link">Source link</label><input id="ce-link" name="link">
      <span class="label">Map</span><span class="map"></span></div></section>
    <section><h2>Tools</h2><div class="tools">
      <button class="tool" data-mode="start"><svg viewBox="0 0 24 24"><path d="M12 3 21 12 12 21 3 12z"/></svg>Start cells</button>
      <button class="tool" data-mode="waypoint"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>Waypoint</button>
      <button class="tool" data-mode="finish"><svg viewBox="0 0 24 24"><path d="M5 21V4h12l-2 4 2 4H5"/></svg>Finish</button>
      <button class="tool" data-mode="bridge"><svg viewBox="0 0 24 24"><path d="M3 15h18M5 15c2-5 12-5 14 0M7 15v4M17 15v4"/></svg>Bridge</button>
    </div><p class="hint"></p></section>
    <section><h2>Start grid <b class="start-count"></b></h2><div class="starts slots"></div></section>
    <section><h2>Waypoints <b class="waypoint-count"></b></h2><div class="waypoints list"></div></section>
    <section><h2>Lap sections</h2><div class="laps"></div><div class="row"><button name="add-lap">Add lap</button></div></section>
    <section><h2>Bridges in play <b class="bridge-count"></b></h2><div class="bridges list"></div><div class="row"><button name="suggest">Use suggested order</button></div></section>
    <section><h2>Validation</h2><div class="report" role="status" aria-live="polite"></div></section>
    <section><h2>Custom map</h2><div class="row"><input name="map-file" type="file" accept=".map,.yrm,.mpr" aria-label="Custom map file (.map, .yrm, .mpr)"><button name="use-map">Use custom map</button></div></section>
    </div><footer><button class="primary" name="save">Save course</button><button name="save-as">Save as…</button><button name="export">Export course</button><span class="saved" role="status"></span></footer></div>`;
  document.body.append(panel);
  const $ = <T extends Element = HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const input = (name: string) => $<HTMLInputElement>(`[name="${name}"]`);
  const button = (text: string, onclick: () => void) => Object.assign(document.createElement('button'), { textContent: text, onclick });
  input('name').value = file.name; input('author').value = file.author; input('link').value = file.link;
  $('.map').innerHTML = '<b></b> · ';
  $('.map b').textContent = file.map;
  $('.map').append(file.source === 'shipped' ? 'custom map' : 'install map');
  const art = new Graphics(); world.addChild(art);
  const labels = new PixiContainer(); world.addChild(labels);
  let mode: 'start' | 'finish' | 'waypoint' | 'bridge' | 'insert' = 'waypoint', insertAt = 0;
  let startAt = file.startGrid.length % 10;
  let drag: { kind: 'start' | 'finish' | 'waypoint'; index: number } | undefined;
  let pan: { x: number; y: number; wx: number; wy: number } | undefined;
  const xy = (c: [number, number]) => toScreen(c[0] + 0.5, c[1] + 0.5, grid.level[c[1] * grid.width + c[0]] ?? 0);
  const at = (event: PointerEvent): [number, number] => {
    const local = world.toLocal(new Point(event.clientX, event.clientY));
    let best: [number, number] = [0, 0], distance = Infinity;
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
      if (grid.speed[y * grid.width + x]! <= 0 && grid.deck[y * grid.width + x]! < 0) continue;
      const p = xy([x, y]), d = Math.hypot((p.x - local.x) / 30, (p.y - local.y) / 15);
      if (d < distance) { distance = d; best = [x, y]; }
    }
    return best;
  };
  // A constant screen size at any zoom; each kind its own shape, all outlined dark so they read on sand and snow alike.
  const OUTLINE = 0x080b10;
  const marker = (p: [number, number], kind: 'start' | 'waypoint' | 'finish' | 'bridge', label: string) => {
    const s = xy(p), k = 1 / world.scale.x, r = 11 * k, stroke = { color: OUTLINE, width: 2.5 * k };
    if (kind === 'start') art.poly([s.x, s.y - r * 1.2, s.x + r * 1.2, s.y, s.x, s.y + r * 1.2, s.x - r * 1.2, s.y]).fill(0x35d6ff).stroke(stroke);
    else if (kind === 'waypoint') art.circle(s.x, s.y, r * 1.15).fill(0xffd34e).stroke(stroke);
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
  const refresh = () => {
    const result = inspectCourse(file, bytes, grid);
    const report = $('.report');
    report.replaceChildren();
    report.classList.toggle('bad', result.errors.length > 0);
    for (const line of result.errors.length ? result.errors : [`Valid · ideal ${result.course!.length.toFixed(0)} cells · estimated ${Math.ceil(result.seconds!)} s`]) {
      const row = document.createElement('div'); row.textContent = line; report.append(row);
    }
    input('save').disabled = input('export').disabled = result.errors.length > 0;
    art.clear();
    labels.removeChildren().forEach((label) => label.destroy());
    if (result.course) for (const [width, color, alpha] of [[5, OUTLINE, 0.5], [2.5, 0xffffff, 0.9]] as const) {
      result.course.line.forEach((p, i) => { const s = toScreen(p.x, p.y, grid.level[Math.floor(p.y) * grid.width + Math.floor(p.x)] ?? 0); i ? art.lineTo(s.x, s.y) : art.moveTo(s.x, s.y); });
      art.stroke({ color, width: width / world.scale.x, alpha });
    }
    file.startGrid.forEach((p, i) => marker(p, 'start', String(i + 1)));
    file.waypoints.forEach((p, i) => marker(p, 'waypoint', String(i + 1)));
    file.bridges.forEach((p, i) => marker(p, 'bridge', `B${i + 1}`));
    marker(file.finish, 'finish', '');
    $('.start-count').textContent = `${file.startGrid.length} / 10`;
    $('.waypoint-count').textContent = String(file.waypoints.length);
    $('.bridge-count').textContent = String(file.bridges.length);
    // Ten slots: clicking one picks the cell the next map click places; × takes a placed cell out.
    $('.starts').replaceChildren(...Array.from({ length: 10 }, (_, i) => {
      const p = file.startGrid[i];
      const slot = button('', () => { mode = 'start'; startAt = Math.min(i, file.startGrid.length); modes(); });
      slot.className = `slot${p ? ' set' : ''}${mode === 'start' && i === startAt ? ' next' : ''}`;
      slot.innerHTML = `<b>${i + 1}</b>`;
      slot.append(p ? p.join(',') : i === startAt ? 'next' : '–');
      if (p) {
        const remove = button('×', () => { file.startGrid.splice(i, 1); startAt = Math.min(startAt, file.startGrid.length); refresh(); });
        remove.className = 'remove'; remove.setAttribute('aria-label', `Remove start ${i + 1}`);
        remove.addEventListener('click', (event) => event.stopPropagation());
        slot.append(remove);
      }
      return slot;
    }));
    const row = (tag: string, round: boolean, p: [number, number], ...buttons: HTMLButtonElement[]) => {
      const div = document.createElement('div'), n = document.createElement('span'), xy = document.createElement('span'), actions = document.createElement('span');
      n.className = round ? 'n' : 'n bridge'; n.textContent = tag;
      xy.className = 'xy'; xy.textContent = p.join(', ');
      actions.className = 'row'; actions.append(...buttons);
      div.append(n, xy, actions);
      return div;
    };
    $('.waypoints').replaceChildren(...file.waypoints.map((p, i) => row(String(i + 1), true, p,
      button('Insert before', () => { mode = 'insert'; insertAt = i; modes(); }),
      button('Delete', () => {
        file.waypoints.splice(i, 1);
        for (const lap of file.laps) { if (lap.from > i) lap.from--; if (lap.to >= i) lap.to--; }
        refresh();
      }))));
    $('.laps').replaceChildren(...file.laps.map((lap, i) => {
      const div = document.createElement('div');
      for (const [key, text] of [['from', 'From waypoint'], ['to', 'To waypoint'], ['count', 'Laps']] as const) {
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
      start: `Click a cell to place start ${startAt + 1}.`,
      waypoint: `Click a cell to add waypoint ${file.waypoints.length + 1} at the end.`,
      insert: `Click a cell to insert a waypoint before waypoint ${insertAt + 1}.`,
      finish: 'Click a cell to move the finish.',
      bridge: 'Click a bridge to add it to the bridges in play.',
    }[mode]} Drag a marker to move it · wheel zooms · middle drag pans.`;
  };
  // The selected tool and what a click on the battlefield does with it.
  const modes = () => {
    panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((tool) => tool.setAttribute('aria-pressed', String(tool.dataset.mode === (mode === 'insert' ? 'waypoint' : mode))));
    refresh();
  };
  panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((tool) => tool.onclick = () => { mode = tool.dataset.mode as typeof mode; modes(); });
  input('name').oninput = () => { file.name = input('name').value; refresh(); };
  input('author').oninput = () => { file.author = input('author').value; refresh(); };
  input('link').oninput = () => { file.link = input('link').value; refresh(); };
  input('add-lap').onclick = () => { file.laps.push({ from: 0, to: Math.max(0, file.waypoints.length - 1), count: 2 }); refresh(); };
  input('suggest').onclick = () => { file.bridges = inspectCourse(file, bytes, grid).suggestedBridges; refresh(); };
  const save = async (overwrite = false): Promise<void> => {
    const saved = $('.saved'); saved.textContent = 'Saving…';
    if (inspectCourse(file, bytes, grid).errors.length) { saved.textContent = 'Invalid course'; return; }
    const slug = courseSlug(file.name);
    sessionStorage.setItem('courseEditorNext', `?edit=1&course=${slug}`); // Vite reloads once the course file changes.
    try {
      const res = await fetch(`/__course/save?origin=${encodeURIComponent(origin)}${overwrite ? '&overwrite=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(file) });
      if (res.status === 409) {
        sessionStorage.removeItem('courseEditorNext');
        if (confirm(await res.text())) return save(true);
        saved.textContent = 'Not saved: choose another name.';
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      saved.textContent = `Saved ${await res.text()}`;
      location.href = `?edit=1&course=${slug}`;
    } catch (error) { sessionStorage.removeItem('courseEditorNext'); saved.textContent = error instanceof Error ? error.message : String(error); }
  };
  input('save').onclick = () => save();
  // One file to hand an operator (ADR 0007); its custom map travels inside.
  input('export').onclick = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([exportCourse(file, bytes)], { type: 'application/json' }));
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
    open.onchange = () => { if (open.value) location.href = open.value; };
  });
  /** Uploads `selected` as `name`; a different map of that name is replaced only when the user keeps the name. Returns the name used. */
  const upload = async (selected: File, name: string, replace = false): Promise<string> => {
    sessionStorage.setItem('courseEditorNext', `?edit=1&map=${encodeURIComponent(name)}&source=shipped`); // Vite may reload as soon as the map file appears.
    const res = await fetch(`/__course/map/${encodeURIComponent(name)}${replace ? '?replace=1' : ''}`, { method: 'PUT', body: selected });
    if (res.status === 409) {
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
    try {
      const name = await upload(selected, selected.name);
      sessionStorage.removeItem('courseEditorNext');
      location.href = `?edit=1&map=${encodeURIComponent(name)}&source=shipped`;
    } catch (error) { sessionStorage.removeItem('courseEditorNext'); $('.saved').textContent = error instanceof Error ? error.message : String(error); }
  };
  const canvas = app.canvas;
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); world.scale.set(Math.max(0.15, Math.min(4, world.scale.x * (event.deltaY < 0 ? 1.2 : 1 / 1.2)))); refresh(); }, { passive: false });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 1) { pan = { x: event.clientX, y: event.clientY, wx: world.x, wy: world.y }; canvas.setPointerCapture(event.pointerId); return; }
    if (event.button !== 0) return;
    const local = world.toLocal(new Point(event.clientX, event.clientY));
    const hits = [...file.startGrid.map((p, i) => ({ kind: 'start' as const, index: i, p })),
      ...file.waypoints.map((p, i) => ({ kind: 'waypoint' as const, index: i, p })), { kind: 'finish' as const, index: 0, p: file.finish }];
    drag = hits.find(({ p }) => { const s = xy(p); return Math.hypot(s.x - local.x, s.y - local.y) < 12 / world.scale.x; });
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (pan) { world.position.set(pan.wx + event.clientX - pan.x, pan.wy + event.clientY - pan.y); return; }
    if (!drag) return;
    const p = at(event);
    if (drag.kind === 'start') file.startGrid[drag.index] = p;
    else if (drag.kind === 'waypoint') file.waypoints[drag.index] = p;
    else file.finish = p;
    refresh();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (pan) { pan = undefined; return; }
    if (drag) { drag = undefined; refresh(); return; }
    if (event.button !== 0) return;
    const p = at(event);
    if (mode === 'start') { file.startGrid[startAt] = p; startAt = file.startGrid.length < 10 ? file.startGrid.length : (startAt + 1) % 10; }
    if (mode === 'finish') file.finish = p;
    if (mode === 'waypoint') file.waypoints.push(p);
    if (mode === 'insert') {
      file.waypoints.splice(insertAt, 0, p);
      for (const lap of file.laps) { if (lap.from >= insertAt) lap.from++; if (lap.to >= insertAt) lap.to++; }
      mode = 'waypoint'; modes();
    }
    if (mode === 'bridge') { const id = grid.bridge[p[1] * grid.width + p[0]]; if (id !== undefined && id >= 0) file.bridges.push(p); }
    refresh();
  });
  modes();
}
