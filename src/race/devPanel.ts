import { TICK_HZ } from '../movement/index.js';
import { CHEER_PRICES, chat, cheerEvent, openJoinWindow, paid, type PaidEvent, type Race } from './race.js';

// Dev only (`npm run dev`): the test-chat panel (#8).
// main.ts imports it behind `import.meta.env.DEV`, so production builds leave it out.

const FAKE_NAMES = ['Tanya', 'Boris', 'Yuri', 'Kane', 'Volkov', 'Zofia', 'Carville', 'Romanov', 'Einstein', 'Dasha', 'Sputnik', 'Lt_Eva', 'bot2', 'tanya'];
/** Chaos lines: valid commands plus noise that must stay silent. */
const CHAOS = ['!rhino', '!RHINO', ' !rhino ', '!rhinoo', '!rhino please', 'rhino', 'gg', 'lol', '!boost', '!missile Bot1', '!tesla', '!shield', '!v3 back', '!bridge B1'];

/** mulberry32 for the panel's own seeded stream (never the race's). */
function rng(seed: number) {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `drainSettlements`: no chat source is connected to take the race's settlements, so the panel logs them. */
export function mountDevPanel(race: Race, params: URLSearchParams, drainSettlements: boolean): void {
  const panel = document.createElement('div');
  panel.id = 'dev-panel';
  panel.style.cssText = 'position:fixed;right:8px;bottom:8px;width:330px;padding:8px;background:#000d;color:#ccc;font:12px/1.5 monospace;border:1px solid #444';
  panel.innerHTML = `
<b>Test chat</b><br>
<input name="name" size="10" value="p0mz0r"> <input name="text" size="20" placeholder="!rhino"> <button name="say">Say</button><br>
<button name="cheer">Cheer</button> <input name="bits" size="4" placeholder="10/20/50"> bits<br>
<button name="fake">Add</button> <input name="n" size="2" value="${params.get('fake') ?? 5}"> fake viewers<br>
<label><input type="checkbox" name="chaos"> chaos</label> <input name="rate" size="3" value="${params.get('chaos') ?? 3}"> msg/s, seed <input name="seed" size="4" value="${params.get('chatSeed') ?? 1}">
<pre class="log" style="margin:4px 0 0;max-height:12em;overflow:auto;white-space:pre-wrap"></pre>`;
  document.body.append(panel);
  const $ = (name: string) => panel.querySelector<HTMLInputElement>(`[name=${name}]`)!;
  const log = panel.querySelector('.log')!;
  const logLine = (text: string) => { log.textContent = `${text}\n${log.textContent}`.slice(0, 4000); };
  const say = (viewerId: string, name: string, text: string) => {
    const r = chat(race, { viewerId, name, text });
    logLine(`${name}: ${text} → ${r.ok ? 'ok' : 'no'}, ${r.reason}`);
  };
  let random = rng(Number($('seed').value));
  let fakes = 0;
  const fakeViewer = () => {
    const n = ++fakes;
    return { id: `fake:${n}`, name: `${FAKE_NAMES[Math.floor(random() * FAKE_NAMES.length)]}${random() < 0.5 ? '' : n}` };
  };
  const viewers: { id: string; name: string }[] = [];

  $('say').onclick = () => say(`test:${$('name').value}`, $('name').value, $('text').value);
  const cheer = (event: PaidEvent) => {
    const name = $('name').value;
    const r = paid(race, { viewerId: `test:${name}`, name, event, via: 'cheer', reference: '' });
    logLine(`${name} cheers ${CHEER_PRICES[event]} → ${r.ok ? 'ok' : 'no'}, ${r.reason}`);
  };
  // Like a chat source: the amount picks the event, any other amount sets off nothing.
  $('cheer').onclick = () => {
    const bits = Number($('bits').value || CHEER_PRICES.chronosphere), event = cheerEvent(bits);
    if (event) cheer(event);
    else logLine(`${$('name').value} cheers ${bits} → no, no event at that price`);
  };
  // Stands in for a chat source: drains the settlements a platform would get.
  if (drainSettlements) setInterval(() => {
    for (const s of race.settlements.splice(0)) logLine(`${s.reference} ${s.outcome}`);
  }, 250);
  $('text').onkeydown = (e) => { if (e.key === 'Enter') $('say').click(); };
  $('fake').onclick = () => {
    for (let i = 0; i < Number($('n').value); i++) {
      const v = fakeViewer();
      viewers.push(v);
      say(v.id, v.name, '!rhino');
    }
  };
  let chaos: ReturnType<typeof setInterval> | undefined;
  $('chaos').onchange = () => {
    clearInterval(chaos);
    if (!$('chaos').checked) return;
    random = rng(Number($('seed').value));
    chaos = setInterval(() => {
      const v = viewers.length && random() < 0.7 ? viewers[Math.floor(random() * viewers.length)]! : fakeViewer();
      if (!viewers.includes(v)) viewers.push(v);
      say(v.id, v.name, CHAOS[Math.floor(random() * CHAOS.length)]!);
    }, 1000 / Math.max(0.1, Number($('rate').value)));
  };

  // URL shortcuts for headless runs: `?autoopen=1&fake=N&chaos=R` opens the window, adds N fake viewers, starts chaos;
  // `&cheer=kirov@6` cheers for that paid event 6 s after GO.
  const [event, after] = (params.get('cheer') ?? '').split('@');
  if (event) {
    const due = setInterval(() => {
      if (race.phase !== 'racing' || race.frame < Number(after ?? 0) * TICK_HZ) return;
      clearInterval(due);
      cheer(event as PaidEvent);
    }, 100);
  }
  if (params.get('autoopen')) {
    openJoinWindow(race, { joinSeconds: Number(params.get('join') ?? 90), finishSeconds: Number(params.get('finish') ?? 60) });
    if (params.get('fake')) $('fake').click();
    if (params.get('chaos')) {
      $('chaos').checked = true;
      $('chaos').dispatchEvent(new Event('change'));
    }
  }
}
