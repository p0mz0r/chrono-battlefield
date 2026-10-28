import type { CourseFile } from './course.js';
import { endRace, openJoinWindow, type Race } from './race.js';
import type { CameraMode } from './view.js';

const KEY = 'rhino-race-setup';
const VERBS = ['boost', 'shield', 'v3', 'missile', 'tesla', 'chrono', 'bridge'] as const;
export interface OperatorChoices {
  course: string;
  joinSeconds: number;
  finishSeconds: number;
  enabled: string[];
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

/** True when the same action already arrived from the other source (page key vs OBS hotkey) within 200 ms. */
export function duplicateFilter(): (action: string, source: string, now: number) => boolean {
  let lastAction = '', lastSource = '', lastAt = -Infinity;
  return (action, source, now) => {
    const duplicate = action === lastAction && source !== lastSource && now - lastAt < 200;
    if (!duplicate) { lastAction = action; lastSource = source; lastAt = now; }
    return duplicate;
  };
}

/** In-page operator controls. Selection reloads only when the chosen course needs another battlefield. */
export function mountOperator(race: Race, courses: Record<string, CourseFile>, current: string, switchCamera: (mode: CameraMode) => void, toggleMute: () => void): void {
  const choices = readChoices();
  const save = () => localStorage.setItem(KEY, JSON.stringify(choices));
  switchCamera(choices.camera);
  const root = document.createElement('section');
  root.id = 'race-setup';
  root.hidden = true;
  root.innerHTML = `<h1>RACE SETUP</h1><label>Course <select name="course"></select></label><label>Join window <input name="join" type="number" min="1" step="1"> s</label><label>Finish timer <input name="finish" type="number" min="1" step="1"> s</label><fieldset><legend>Audience interactions</legend></fieldset><p>Keys: S setup · Enter start · P pause · E E end · C camera · M mute · F2 install</p>`;
  document.body.append(root);
  const select = root.querySelector<HTMLSelectElement>('[name=course]')!;
  select.add(new Option('Random course', 'random'));
  for (const [id, file] of Object.entries(courses)) select.add(new Option(`${file.name} · ${file.map} · ~${estimatedSeconds(file)} s`, id));
  select.value = choices.course || current;
  if (!select.value) select.value = current;
  const join = root.querySelector<HTMLInputElement>('[name=join]')!, finish = root.querySelector<HTMLInputElement>('[name=finish]')!;
  join.value = String(choices.joinSeconds); finish.value = String(choices.finishSeconds);
  const fieldset = root.querySelector('fieldset')!;
  for (const verb of VERBS) {
    const label = document.createElement('label'), box = document.createElement('input');
    box.type = 'checkbox'; box.name = verb; box.checked = choices.enabled.includes(verb);
    label.append(box, ` ${verb}`); fieldset.append(label);
  }
  const update = () => {
    choices.course = select.value;
    choices.joinSeconds = Number(join.value);
    choices.finishSeconds = Number(finish.value);
    choices.enabled = [...fieldset.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.name);
    if (Number.isInteger(choices.joinSeconds) && choices.joinSeconds > 0 && Number.isInteger(choices.finishSeconds) && choices.finishSeconds > 0) save();
  };
  root.addEventListener('change', update);
  const start = () => {
    if (!root.hidden || race.phase === 'idle' || race.phase === 'results' || race.phase === 'cancelled') {
      update();
      if (!Number.isInteger(choices.joinSeconds) || choices.joinSeconds <= 0 || !Number.isInteger(choices.finishSeconds) || choices.finishSeconds <= 0) { root.hidden = false; return; }
      const picked = choices.course === 'random' ? Object.keys(courses)[Math.floor(Math.random() * Object.keys(courses).length)]! : choices.course;
      if (picked !== current) {
        const url = new URL(location.href);
        url.searchParams.set('course', picked);
        url.searchParams.set('start', '1');
        location.href = url.href;
        return;
      }
      race.enabled = new Set(VERBS.filter((v) => choices.enabled.includes(v) && (v !== 'bridge' || race.course.file.bridges.length)));
      openJoinWindow(race, { joinSeconds: choices.joinSeconds, finishSeconds: choices.finishSeconds });
      // Off stream, in the OBS log (Help > Log Files): obs-browser logs only console errors.
      console.error(`Rhino Race seed ${race.seed}: replay with ?course=${current.replace(/^.*\/|\.json$/g, '')}&seed=${race.seed}`);
      root.hidden = true;
    }
  };
  let endPromptUntil = 0;
  const prompt = document.createElement('div'); prompt.id = 'end-prompt'; document.body.append(prompt);
  const duplicate = duplicateFilter();
  const act = (action: string, source: string) => {
    const now = performance.now();
    if (duplicate(action, source, now)) return;
    if (action === 'setup' && ['idle', 'results', 'cancelled'].includes(race.phase)) { root.hidden = false; prompt.textContent = ''; }
    else if (action === 'start') {
      if (source === 'hotkey' && !choices.course && root.hidden) root.hidden = false;
      else start();
    }
    else if (action === 'pause' && ['join', 'countdown', 'racing'].includes(race.phase)) race.paused = !race.paused;
    else if (action === 'end' && ['join', 'countdown', 'racing'].includes(race.phase)) {
      if (now < endPromptUntil) { endRace(race); endPromptUntil = 0; prompt.textContent = ''; }
      else { endPromptUntil = now + 3000; prompt.textContent = 'Press E again to end race'; setTimeout(() => { if (performance.now() >= endPromptUntil) prompt.textContent = ''; }, 3000); }
    } else if (action === 'camera') { choices.camera = choices.camera === 'overview' ? 'director' : 'overview'; switchCamera(choices.camera); save(); }
    else if (action === 'mute') toggleMute();
  };
  addEventListener('chronoOperator', (event) => {
    const action = (event as CustomEvent).detail?.action;
    if (typeof action === 'string') act(action, 'hotkey');
  });
  addEventListener('keydown', (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, select, textarea') && (event.key !== 'Enter' || !root.contains(target))) return;
    const key = event.key.toLowerCase();
    const action = key === 's' ? 'setup' : event.key === 'Enter' ? 'start' : key === 'p' ? 'pause' : key === 'e' ? 'end' : key === 'c' ? 'camera' : key === 'm' ? 'mute' : '';
    if (action) act(action, 'key');
  });
  if (new URL(location.href).searchParams.has('start')) {
    const url = new URL(location.href); url.searchParams.delete('start'); history.replaceState(null, '', url);
    start();
  }
}
