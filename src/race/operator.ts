import { readInstall } from '../install/read.js';
import type { CourseFile } from './course.js';
import { markRemoved, readCourseFile, removeImported, saveImported, type ImportedCourse } from './courseFile.js';
import { BIG_EVENTS, CHAOS, endRace, openJoinWindow, simulateRace, type Race } from './race.js';
import type { Volume } from '../audio.js';
import type { CameraMode } from './view.js';
import type { RaceForms } from '../install/wizard.js';
import mark from '../../docs/brand/final/mark.png';
import '../panel.css';

const KEY = 'rhino-race-setup';
const VERBS = ['boost', 'shield', 'v3', 'missile', 'tesla', 'bridge'] as const;
export interface OperatorChoices {
  course: string;
  joinSeconds: number;
  finishSeconds: number;
  enabled: string[];
  /** Hype meter and paid events switched on. */
  chaos: string[];
  camera: CameraMode;
}

export function readChoices(): OperatorChoices {
  let saved: Partial<OperatorChoices> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<OperatorChoices>; } catch { /* malformed old settings */ }
  return {
    course: typeof saved.course === 'string' ? saved.course : '',
    joinSeconds: Number.isInteger(saved.joinSeconds) && saved.joinSeconds! > 0 ? saved.joinSeconds! : 90,
    finishSeconds: Number.isInteger(saved.finishSeconds) && saved.finishSeconds! > 0 ? saved.finishSeconds! : 60,
    enabled: Array.isArray(saved.enabled) ? saved.enabled.filter((v): v is string => typeof v === 'string' && VERBS.includes(v as typeof VERBS[number])) : [...VERBS],
    chaos: Array.isArray(saved.chaos) ? saved.chaos.filter((c): c is string => typeof c === 'string' && CHAOS.includes(c as typeof CHAOS[number])) : [...CHAOS],
    camera: saved.camera === 'director' ? 'director' : 'overview',
  };
}

// shortcut: waypoint distance ignores terrain and turns; use imported ideal lines if setup needs precise estimates.
function estimatedSeconds(file: CourseFile): number {
  const points: [number, number][] = [file.startGrid[0]!];
  for (let i = 0; i < file.waypoints.length; i++) {
    points.push(file.waypoints[i]!);
    const lap = file.laps.find((section) => section.to === i);
    if (lap) for (let repeat = 1; repeat < lap.count; repeat++) points.push(...file.waypoints.slice(lap.from, lap.to + 1));
  }
  points.push(file.finish);
  const cells = points.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - points[i]![0], y - points[i]![1]), 0);
  return Math.ceil(cells * 256 / (Math.floor(6 * 256 / 100) * 1.6 * 30) * 1.15);
}

/**
 * In-page operator controls. Selection reloads only when the chosen course needs another battlefield.
 * `courses` holds bundled and `imported` courses by id; the Courses screen adds and removes imported ones, and shows
 * `report` (what the courses folder import did). Returns the courses and race setup forms and the trial race, for setup's wizard to borrow.
 */
export function mountOperator(race: Race, courses: Record<string, CourseFile>, imported: ImportedCourse[], report: string[], current: string, switchCamera: (mode: CameraMode) => void, sound: { mute(): Volume; volume(step: number): Volume }, cutTo: (place: number) => void): RaceForms {
  const choices = readChoices();
  const save = () => localStorage.setItem(KEY, JSON.stringify(choices));
  switchCamera(choices.camera);
  const root = document.createElement('section');
  root.id = 'race-setup';
  root.hidden = true;
  root.innerHTML = `<div class="panel setup race"><div class="inner"><header><img class="mark" src="${mark}" alt=""><h1>Race setup</h1></header><div class="scroll race-form">
    <section><h2>Course</h2><select name="course" aria-label="Course"></select></section>
    <section><h2>Timers</h2><div class="timers"><label>Join window <input name="join" type="number" min="1" step="1"> s</label><label>Finish timer <input name="finish" type="number" min="1" step="1"> s</label></div></section>
    <section><h2>Audience interactions <b class="count"></b></h2><fieldset name="verbs" class="tiles" aria-label="Audience interactions"></fieldset></section>
    <section><h2>Chaos <b class="count"></b></h2><fieldset name="chaos" class="tiles" aria-label="Chaos"></fieldset></section>
    </div><footer><span class="keys"><kbd>S</kbd> race setup <kbd>P</kbd> pause <kbd>E E</kbd> end <kbd>C</kbd> camera <kbd>1</kbd>–<kbd>9</kbd> <kbd>0</kbd> cut to place <kbd>M</kbd> mute <kbd>−</kbd> <kbd>+</kbd> volume <kbd>F2</kbd> setup</span>
    <button type="button" name="import">Import courses…</button><button type="button" class="primary" name="start">Start race <kbd>Enter</kbd></button></footer></div></div>
    <div class="panel setup courses" hidden><div class="inner"><header><img class="mark" src="${mark}" alt=""><h1>Courses</h1></header><div class="scroll race-form">
    <section><h2>Import</h2><label>Course files (.rhino-course.json) <input name="files" type="file" multiple accept=".json"></label><div class="messages report" role="status"></div></section>
    <section><h2>Imported courses</h2><ul class="imported"></ul></section>
    </div><footer><button type="button" class="primary" name="back">Back to race setup</button></footer></div></div>
    <style>
      #race-setup { position: fixed; z-index: 5; inset: 0; display: grid; place-items: center; background: #0009; }
      #race-setup[hidden] { display: none; }
      #race-setup footer .keys { flex-basis: 100%; }
      #race-setup footer [name=import] { margin-left: auto; }
      #race-setup footer .primary kbd { margin-left: 6px; }
      /* .race-form: the forms setup's wizard borrows, styled wherever they sit. */
      .race-form .timers { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-top: 10px; }
      .race-form .timers label { display: flex; align-items: center; gap: 8px; }
      .race-form .timers input { width: 5.5em; }
      .race-form .tiles { grid-template-columns: repeat(3, 1fr); }
      .race-form label:has([type=file]) { display: block; margin-bottom: 10px; }
      .race-form input[type=file] { display: block; width: 100%; margin-top: 4px; }
      .race-form .messages { white-space: pre-line; }
      .race-form .imported { margin: 0; padding: 0; list-style: none; }
      .race-form .imported li { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid #ffffff14; }
      .race-form .imported li span { flex: 1; }
      .race-form .imported:empty::before { content: 'None yet.'; color: var(--dim); }
    </style>`;
  document.body.append(root);
  const select = root.querySelector<HTMLSelectElement>('[name=course]')!;
  const fill = () => {
    select.replaceChildren(new Option('Random course', 'random'));
    for (const [id, file] of Object.entries(courses)) select.add(new Option(`${file.name} · ${file.map} · ~${estimatedSeconds(file)} s${id.startsWith('imported/') ? ' · imported' : ''}`, id));
    select.value = choices.course || current;
    if (!select.value) select.value = current;
  };
  fill();
  const setup = root.querySelector<HTMLElement>('.race')!, screen = root.querySelector<HTMLElement>('.courses')!;
  const files = screen.querySelector<HTMLInputElement>('[name=files]')!, messages = screen.querySelector('.messages')!, list = screen.querySelector('ul')!;
  messages.textContent = report.join('\n');
  // The forms go back from setup's wizard into their own panels, after the header.
  const form = setup.querySelector<HTMLElement>('.race-form')!, coursesForm = screen.querySelector<HTMLElement>('.race-form')!;
  const showCourses = (open: boolean) => {
    setup.querySelector('header')!.after(form); screen.querySelector('header')!.after(coursesForm);
    setup.hidden = open; screen.hidden = !open;
  };
  const listImported = () => list.replaceChildren(...imported.map((entry) => {
    const item = document.createElement('li'), remove = document.createElement('button'), { course } = entry;
    // Custom maps keep their credit (ADR 0006); the link is text, so clicking can't navigate the OBS source away.
    item.append(Object.assign(document.createElement('span'), { textContent: `${course.name} · ${course.map}${course.source === 'shipped' ? ` · map by ${course.author}, ${course.link}` : ''}` }));
    remove.type = 'button'; remove.textContent = 'Remove';
    remove.onclick = async () => {
      await removeImported(entry.id);
      markRemoved(entry.id, true);
      imported.splice(imported.indexOf(entry), 1);
      delete courses[entry.id];
      listImported(); fill();
    };
    item.append(remove);
    return item;
  }));
  listImported();
  root.querySelector<HTMLButtonElement>('[name=import]')!.onclick = () => showCourses(true);
  screen.querySelector<HTMLButtonElement>('[name=back]')!.onclick = () => showCourses(false);
  files.onchange = async () => {
    const lines: string[] = [];
    for (const file of files.files ?? []) {
      try {
        const text = await file.text().catch(() => { throw new Error(`Couldn't read ${file.name}`); });
        const entry = await readCourseFile(file.name, text, (path) => readInstall(path));
        await saveImported(entry);
        markRemoved(entry.id, false);
        imported.splice(0, imported.length, ...imported.filter((other) => other.id !== entry.id), entry);
        courses[entry.id] = entry.course;
        lines.push(`Imported ${entry.course.name}`);
      } catch (error) { lines.push(error instanceof Error ? error.message : String(error)); }
    }
    messages.textContent = lines.join('\n');
    files.value = '';
    listImported(); fill();
  };
  const join = root.querySelector<HTMLInputElement>('[name=join]')!, finish = root.querySelector<HTMLInputElement>('[name=finish]')!;
  join.value = String(choices.joinSeconds); finish.value = String(choices.finishSeconds);
  const verbs = root.querySelector<HTMLFieldSetElement>('[name=verbs]')!, chaos = root.querySelector<HTMLFieldSetElement>('[name=chaos]')!;
  const toggles = (into: HTMLFieldSetElement, names: readonly string[], on: string[], text: (name: string) => string) => {
    for (const name of names) {
      const label = document.createElement('label'), box = document.createElement('input'), caption = document.createElement('span');
      label.className = 'tile'; box.type = 'checkbox'; box.name = name; box.checked = on.includes(name); caption.textContent = text(name);
      label.append(box, caption); into.append(label);
    }
  };
  toggles(verbs, VERBS, choices.enabled, (verb) => verb);
  toggles(chaos, CHAOS, choices.chaos, (c) => c === 'hype' ? 'hype meter & nuke' : BIG_EVENTS[c as keyof typeof BIG_EVENTS].label.toLowerCase());
  const checked = (set: HTMLFieldSetElement) => [...set.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.name);
  const valid = () => [choices.joinSeconds, choices.finishSeconds].every((n) => Number.isInteger(n) && n > 0);
  const count = () => { for (const set of [verbs, chaos]) set.closest('section')!.querySelector('.count')!.textContent = `${checked(set).length}/${set.elements.length}`; };
  count();
  const update = () => {
    choices.course = select.value;
    choices.joinSeconds = Number(join.value);
    choices.finishSeconds = Number(finish.value);
    choices.enabled = checked(verbs);
    choices.chaos = checked(chaos);
    count();
    if (valid()) save();
  };
  form.addEventListener('change', update);
  const start = () => {
    if (!root.hidden || race.phase === 'idle' || race.phase === 'results' || race.phase === 'cancelled') {
      update();
      if (!valid()) { root.hidden = false; showCourses(false); return; }
      const picked = choices.course === 'random' ? Object.keys(courses)[Math.floor(Math.random() * Object.keys(courses).length)]! : choices.course;
      if (picked !== current) {
        const url = new URL(location.href);
        url.searchParams.set('course', picked);
        url.searchParams.set('start', '1');
        location.href = url.href;
        return;
      }
      race.enabled = new Set(VERBS.filter((v) => choices.enabled.includes(v) && (v !== 'bridge' || race.course.file.bridges.length)));
      race.chaos = new Set(CHAOS.filter((c) => choices.chaos.includes(c)));
      openJoinWindow(race, { joinSeconds: choices.joinSeconds, finishSeconds: choices.finishSeconds });
      // Off stream, in rhino-race.log beside the launcher.
      const seedLine = `Rhino Race seed ${race.seed}: replay with ?course=${current.replace(/^.*\/|\.json$/g, '')}&seed=${race.seed}`;
      console.info(seedLine);
      if (!import.meta.env.DEV) navigator.sendBeacon('/__log', seedLine);
      root.hidden = true;
    }
  };
  root.querySelector<HTMLButtonElement>('[name=start]')!.onclick = start;
  // Setup's trial race: bots alone on the chosen course, which may need its battlefield loaded first.
  const trial = () => {
    update();
    const picked = choices.course === 'random' || !choices.course ? current : choices.course;
    if (picked !== current) {
      const url = new URL(location.href);
      url.searchParams.set('course', picked);
      url.searchParams.set('trial', '1');
      location.href = url.href;
      return;
    }
    simulateRace(race, race.course);
    root.hidden = true;
  };
  let endPromptUntil = 0;
  const prompt = document.createElement('div'); prompt.id = 'end-prompt'; document.body.append(prompt);
  // Volume indicator: right edge, between the event queue and the interaction feed, for 1.5 s after M, − or +.
  const indicator = document.createElement('div'); indicator.id = 'volume';
  const icon = document.createElement('span'), gauge = document.createElement('div'), label = document.createElement('span');
  gauge.append(document.createElement('div')); indicator.append(icon, gauge, label); document.body.append(indicator);
  let indicatorHide: ReturnType<typeof setTimeout> | undefined;
  const showVolume = ({ gain, muted }: Volume) => {
    const percent = muted ? 0 : Math.round(gain * 100);
    indicator.style.setProperty('--volume', `${percent}%`);
    icon.textContent = muted ? '🔇' : '🔊';
    label.textContent = muted ? 'Muted' : `${percent}%`;
    indicator.classList.add('on');
    clearTimeout(indicatorHide);
    indicatorHide = setTimeout(() => indicator.classList.remove('on'), 1500);
  };
  const act = (action: string) => {
    const now = performance.now();
    if (action === 'setup' && ['idle', 'results', 'cancelled'].includes(race.phase)) { root.hidden = false; showCourses(false); prompt.textContent = ''; }
    else if (action === 'start') start();
    else if (action === 'pause' && ['join', 'countdown', 'racing'].includes(race.phase)) race.paused = !race.paused;
    else if (action === 'end' && ['join', 'countdown', 'racing'].includes(race.phase)) {
      if (now < endPromptUntil) { endRace(race); endPromptUntil = 0; prompt.textContent = ''; }
      else { endPromptUntil = now + 3000; prompt.textContent = 'Press E again to end race'; setTimeout(() => { if (performance.now() >= endPromptUntil) prompt.textContent = ''; }, 3000); }
    } else if (action === 'camera') { choices.camera = choices.camera === 'overview' ? 'director' : 'overview'; switchCamera(choices.camera); save(); }
    else if (action === 'mute') showVolume(sound.mute());
    else if (action === 'quieter' || action === 'louder') showVolume(sound.volume(action === 'louder' ? 0.1 : -0.1));
  };
  addEventListener('keydown', (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, select, textarea') && (event.key !== 'Enter' || !root.contains(target))) return;
    if (document.querySelector('#setup[open]')) return; // setup's buttons take Enter; no race starts behind it
    const key = event.key.toLowerCase();
    const action = key === 's' ? 'setup' : event.key === 'Enter' ? 'start' : key === 'p' ? 'pause' : key === 'e' ? 'end' : key === 'c' ? 'camera' : key === 'm' ? 'mute' : key === '-' ? 'quieter' : key === '+' || key === '=' ? 'louder' : '';
    if (action) act(action);
    else if (/^[0-9]$/.test(event.key) && root.hidden) cutTo((Number(event.key) + 9) % 10); // 1 first … 9 ninth, 0 tenth
  });
  if (new URL(location.href).searchParams.has('trial')) {
    const url = new URL(location.href); url.searchParams.delete('trial'); history.replaceState(null, '', url);
    trial();
  }
  if (new URL(location.href).searchParams.has('start')) {
    const url = new URL(location.href); url.searchParams.delete('start'); history.replaceState(null, '', url);
    start();
  }
  return { courses: coursesForm, race: form, trial };
}
