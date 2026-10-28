import { Container as PixiContainer, Graphics, Point, Text, type Application, type Container } from 'pixi.js';
import type { CellGrid } from '../battlefield/grid.js';
import { courseSlug, mapHash, type CourseFile } from './course.js';
import { exportCourse } from './courseFile.js';
import { inspectCourse } from './editorModel.js';

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
  panel.style.cssText = 'position:fixed;top:8px;right:8px;width:350px;max-height:calc(100vh - 30px);overflow:auto;padding:10px;background:#071019ed;color:#eef;font:13px/1.5 sans-serif;overflow-wrap:anywhere;border:1px solid #6a8;z-index:5';
  panel.innerHTML = `<b>Course editor</b> <small>(dev only)</small><br>
    <label>Open <select name="open"><option value="">Saved course or new course…</option></select></label><br>
    <label>Name <input name="name" style="width:220px"></label><br>
    <label>Author <input name="author" style="width:210px"></label><br>
    <label>Source link <input name="link" style="width:190px"></label><br>
    <small>Map: <span class="map"></span></small><hr>
    <button data-mode="start">Start cells</button> <button data-mode="finish">Finish</button>
    <button data-mode="waypoint">Add waypoint</button> <button data-mode="bridge">Bridge</button><br>
    <small>Click cells to place; drag a marker to move it. Wheel zooms; middle drag pans.</small>
    <h4>Start grid <small>(10 cells)</small></h4><div class="starts"></div>
    <h4>Waypoints</h4><div class="waypoints"></div>
    <h4>Lap sections</h4><div class="laps"></div><button name="add-lap">Add lap</button>
    <h4>Bridges in play</h4><div class="bridges"></div><button name="suggest">Use suggested order</button>
    <h4>Validation</h4><div class="report" role="status" aria-live="polite"></div>
    <button name="save">Save course</button> <button name="save-as">Save as…</button> <button name="export">Export course</button> <span class="saved" role="status"></span><hr>
    <label>Custom map (.map/.yrm/.mpr) <input name="map-file" type="file" accept=".map,.yrm,.mpr"></label>
    <button name="use-map">Use custom map</button>`;
  document.body.append(panel);
  const $ = <T extends Element = HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const input = (name: string) => $<HTMLInputElement>(`[name="${name}"]`);
  input('name').value = file.name; input('author').value = file.author; input('link').value = file.link;
  $('.map').textContent = `${file.map} (${file.source})`;
  const art = new Graphics(); world.addChild(art);
  const labels = new PixiContainer(); world.addChild(labels);
  let mode: 'start' | 'finish' | 'waypoint' | 'bridge' | 'insert' = 'waypoint', insertAt = 0;
  let startAt = 0;
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
  const marker = (p: [number, number], color: number, label: string) => {
    const s = xy(p);
    art.circle(s.x, s.y, 8 / world.scale.x).fill({ color, alpha: 0.9 });
    const text = new Text({ text: label, style: { fill: 0x101010, fontFamily: 'sans-serif', fontWeight: 'bold', fontSize: 12 / world.scale.x } });
    text.anchor.set(0.5);
    text.position.set(s.x, s.y);
    labels.addChild(text);
  };
  const refresh = () => {
    const result = inspectCourse(file, bytes, grid);
    const report = $('.report');
    report.replaceChildren();
    if (result.errors.length) for (const error of result.errors) {
      const row = document.createElement('div'); row.textContent = `✗ ${error}`; row.style.color = '#faa'; report.append(row);
    } else report.textContent = `✓ Valid · ideal ${result.course!.length.toFixed(0)} cells · estimated ${Math.ceil(result.seconds!)} s`;
    input('save').disabled = input('export').disabled = result.errors.length > 0;
    art.clear();
    labels.removeChildren().forEach((label) => label.destroy());
    if (result.course) {
      result.course.line.forEach((p, i) => { const s = toScreen(p.x, p.y, grid.level[Math.floor(p.y) * grid.width + Math.floor(p.x)] ?? 0); i ? art.lineTo(s.x, s.y) : art.moveTo(s.x, s.y); });
      art.stroke({ color: 0xffffff, width: 2 / world.scale.x, alpha: 0.8 });
    }
    file.startGrid.forEach((p) => marker(p, 0x39dfff, 'S'));
    file.waypoints.forEach((p, i) => marker(p, 0xff40e0, String(i + 1)));
    marker(file.finish, 0xffffff, 'F');
    file.bridges.forEach((p, i) => marker(p, 0xffaa33, `B${i + 1}`));
    const starts = $('.starts'); starts.replaceChildren();
    file.startGrid.forEach((p, i) => {
      const row = document.createElement('div'); row.textContent = `${i + 1}. ${p.join(', ')} `;
      const move = document.createElement('button'); move.textContent = 'Move'; move.onclick = () => { mode = 'start'; startAt = i; modes(); };
      const del = document.createElement('button'); del.textContent = '×'; del.onclick = () => { file.startGrid.splice(i, 1); startAt = Math.min(startAt, file.startGrid.length); refresh(); };
      row.append(move, del); starts.append(row);
    });
    const waypoints = $('.waypoints'); waypoints.replaceChildren();
    file.waypoints.forEach((p, i) => {
      const row = document.createElement('div'); row.textContent = `${i + 1}. ${p.join(', ')} `;
      const before = document.createElement('button'); before.textContent = 'Insert before'; before.onclick = () => { mode = 'insert'; insertAt = i; modes(); };
      const del = document.createElement('button'); del.textContent = 'Delete'; del.onclick = () => {
        file.waypoints.splice(i, 1);
        for (const lap of file.laps) { if (lap.from > i) lap.from--; if (lap.to >= i) lap.to--; }
        refresh();
      };
      row.append(before, del); waypoints.append(row);
    });
    const laps = $('.laps'); laps.replaceChildren();
    file.laps.forEach((lap, i) => {
      const row = document.createElement('div');
      for (const key of ['from', 'to', 'count'] as const) {
        const label = document.createElement('label'); label.textContent = `${key} `;
        const field = document.createElement('input'); field.type = 'number'; field.min = key === 'count' ? '2' : '1'; field.style.width = '45px';
        field.value = String(key === 'count' ? lap[key] : lap[key] + 1);
        field.onchange = () => { lap[key] = Number(field.value) - (key === 'count' ? 0 : 1); refresh(); };
        label.append(field); row.append(label);
      }
      const del = document.createElement('button'); del.textContent = '×'; del.onclick = () => { file.laps.splice(i, 1); refresh(); };
      row.append(del); laps.append(row);
    });
    const bridges = $('.bridges'); bridges.replaceChildren();
    file.bridges.forEach((p, i) => {
      const row = document.createElement('div'); row.textContent = `B${i + 1}: ${p.join(', ')} `;
      for (const [label, step] of [['↑', -1], ['↓', 1], ['×', 0]] as const) {
        const button = document.createElement('button'); button.textContent = label;
        button.onclick = () => { if (!step) file.bridges.splice(i, 1); else if (file.bridges[i + step]) [file.bridges[i], file.bridges[i + step]] = [file.bridges[i + step]!, file.bridges[i]!]; refresh(); };
        row.append(button);
      }
      bridges.append(row);
    });
    input('suggest').textContent = `Use suggested order (${result.suggestedBridges.length})`;
  };
  const modes = () => panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.style.background = button.dataset.mode === mode ? '#67a' : '');
  panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.onclick = () => { mode = button.dataset.mode as typeof mode; modes(); });
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
    if (mode === 'start') { if (file.startGrid.length < 10) file.startGrid.push(p); else file.startGrid[startAt] = p; startAt = (startAt + 1) % 10; }
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
  modes(); refresh();
}
