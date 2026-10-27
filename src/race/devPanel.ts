import { chat, endRace, openJoinWindow, type Race } from './race.js';

// Dev only (`npm run dev`): the test-chat panel (#8) and the operator's actions as buttons until #46.
// main.ts imports it behind `import.meta.env.DEV`, so production builds leave it out.

const FAKE_NAMES = ['Tanya', 'Boris', 'Yuri', 'Kane', 'Volkov', 'Zofia', 'Carville', 'Romanov', 'Einstein', 'Dasha', 'Sputnik', 'Lt_Eva', 'bot2', 'tanya'];
/** Chaos lines: valid commands plus noise that must stay silent. */
const CHAOS = ['!rhino', '!RHINO', ' !rhino ', '!rhinoo', '!rhino please', 'rhino', 'gg', 'lol', '!boost', '!missile Bot1', '!tesla', '!chrono kane', '!shield', '!v3 back', '!bridge B1'];

/** mulberry32 for the panel's own seeded stream (never the race's). */
function rng(seed: number) {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mountDevPanel(race: Race, params: URLSearchParams): void {
  const panel = document.createElement('div');
  panel.id = 'dev-panel';
  panel.style.cssText = 'position:fixed;right:8px;bottom:8px;width:330px;padding:8px;background:#000d;color:#ccc;font:12px/1.5 monospace;border:1px solid #444';
  panel.innerHTML = `
<b>Operator (dev)</b><br>
join <input name="join" size="3" value="${params.get('join') ?? 90}"> s, finish timer <input name="finish" size="3" value="${params.get('finish') ?? 60}"> s<br>
<button name="open">Open join window</button> <button name="end">End race</button>
<hr><b>Test chat</b><br>
<input name="name" size="10" value="p0mz0r"> <input name="text" size="20" placeholder="!rhino"> <button name="say">Say</button><br>
<button name="fake">Add</button> <input name="n" size="2" value="${params.get('fake') ?? 5}"> fake viewers<br>
<label><input type="checkbox" name="chaos"> chaos</label> <input name="rate" size="3" value="${params.get('chaos') ?? 3}"> msg/s, seed <input name="seed" size="4" value="${params.get('chatSeed') ?? 1}">
<pre class="log" style="margin:4px 0 0;max-height:12em;overflow:auto;white-space:pre-wrap"></pre>`;
  document.body.append(panel);
  const $ = (name: string) => panel.querySelector<HTMLInputElement>(`[name=${name}]`)!;
  const log = panel.querySelector('.log')!;
  const say = (viewerId: string, name: string, text: string) => {
    const r = chat(race, { viewerId, name, text });
    log.textContent = `${name}: ${text} → ${r.ok ? 'ok' : 'no'}, ${r.reason}\n${log.textContent}`.slice(0, 4000);
  };
  let random = rng(Number($('seed').value));
  let fakes = 0;
  const fakeViewer = () => {
    const n = ++fakes;
    return { id: `fake:${n}`, name: `${FAKE_NAMES[Math.floor(random() * FAKE_NAMES.length)]}${random() < 0.5 ? '' : n}` };
  };
  const viewers: { id: string; name: string }[] = [];

  $('open').onclick = () => openJoinWindow(race, { joinSeconds: Number($('join').value), finishSeconds: Number($('finish').value) });
  $('end').onclick = () => endRace(race);
  $('say').onclick = () => say(`test:${$('name').value}`, $('name').value, $('text').value);
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

  // URL shortcuts for headless runs: `?autoopen=1&fake=N&chaos=R` opens the window, adds N fake viewers, starts chaos.
  if (params.get('autoopen')) {
    $('open').click();
    if (params.get('fake')) $('fake').click();
    if (params.get('chaos')) {
      $('chaos').checked = true;
      $('chaos').dispatchEvent(new Event('change'));
    }
  }
}
