import { GAME_LINK_URL } from '../src/chat/gameLink.js';
import { hear, rail, TILES, type Action, type Cooldown, type Heard, type PersonalReply, type Rail, type Reply } from './rail.js';

/** The parts of Twitch's extension helper the rail uses. */
declare const Twitch: { ext: {
  viewer: { id: string | null };
  actions: { requestIdShare(): void };
  onAuthorized(callback: (auth: { token: string }) => void): void;
  listen(target: 'broadcast', callback: (target: string, contentType: string, message: string) => void): void;
} };

/** The backend's press route, beside the game's link; it must be on the extension's URL fetching allowlist (#202). */
const PRESS_URL = GAME_LINK_URL.replace(/^wss:/, 'https:').replace(/\/game$/, '/press');
/** Milliseconds a press waits before "No answer": the backend's own 3 s wait for the game, plus naming the viewer. */
const PRESS_WAIT = 6000;

/** For a viewer who hasn't shared identity: what their first press makes Twitch ask. */
const share = (verb: string) => `<p>${verb} shares your Twitch name with Rhino Race. Twitch asks once.</p>`;
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const tile = (a: Action, back = false) => `<button type="button" class="${a}${back ? ' back' : ''}" data-action="${a}">${TILES[a][0] ? `<i>${TILES[a][0]}</i>` : ''}${TILES[a][1]}</button>`;
/** `back`: the tiles flash gold as they return from the cooldown ring. */
const tiles = (actions: Action[], back: boolean) => actions.map((a) => tile(a, back)).join('');
const caption = (c: Cooldown) => c.used ? [TILES[c.used][1], 'used'] : ['Cooldown'];
const seconds = (c: Cooldown) => Math.ceil(c.left / 1000);
/** The cooldown ring, closing clockwise: a CSS animation started as far in as the cooldown has run. */
const ring = (c: Cooldown) => `<div class="cdslot"><div class="ring" style="animation-duration:${c.total}ms;animation-delay:${c.left - c.total}ms">`
  + `<b>${seconds(c)}</b></div>${caption(c).join('<br>')}</div>`;
/** A failed press, under the top tile. */
const fail = (failure: string | undefined) => failure ? `<div class="fail">${escape(failure)}</div>` : '';
const labels = (actions: Action[]) => actions.map((a) => `${TILES[a][0]} ${TILES[a][1]}`).join(', ');
/** A house colour from the snapshot, only if it is one: it lands in a style attribute. */
const colour = (css: string) => /^#[0-9a-f]{6}$/i.test(css) ? css : '#fff';

/** The rail as HTML: the strip and its hover card, or nothing. */
function html(r: Rail): string {
  if (r.state === 'none') return '';
  let strip: string, card: string;
  if (r.state === 'between') {
    strip = '<div class="tile"><b>RHINO</b><br><small>next race soon</small></div>';
    card = '<h3>Rhino Race</h3><p>The next race opens here.</p>';
  } else if (r.state === 'join') {
    strip = `<div class="tile"><big class="countdown">${r.countdown}</big><small>${r.field} of ${r.max}</small></div>${fail(r.failure)}${r.join ? tile('rhino') : ''}`;
    card = `<h3>Join window · ${r.countdown} s</h3><p>${r.field} of ${r.max} racers.</p>`
      + (!r.join ? '<p>You have a tank in this race.</p>' : r.shared ? '<p>JOIN gets you a tank in this race.</p>' : share('Joining'));
  } else {
    const { me, ownTank, randomTank, cooldown } = r, progress = me?.finished ? 'finished' : `${me?.progress}%`;
    const place = me && `<big style="color:${colour(me.colour)}">P${me.place}</big>`;
    strip = (place ? `<div class="tile">${place}<small>${progress}</small></div>` : '<div class="tile"><b>RACE</b><br><small>on</small></div>')
      + fail(r.failure) + (r.nuke ? tile('nuke') : '')
      + (cooldown ? ring(cooldown) : '')
      + tiles(ownTank, r.back) + (ownTank.length && randomTank.length ? '<div class="sep"></div>' : '') + tiles(randomTank, r.back);
    card = `<h3>${place ? `${place} of ${r.field} · ${progress}` : 'Race on'}</h3>`
      + (r.nuke ? '<p>☢ Nuke: the hype meter is armed.</p>' : '')
      + (cooldown ? `<p class="cd">${caption(cooldown).join(' ')} · next in ${seconds(cooldown)} s</p>` : '')
      + (ownTank.length ? `<p>${labels(ownTank)}: your own tank.</p>` : '') + (randomTank.length ? `<p>${labels(randomTank)}: a random tank.</p>` : '')
      + (!r.shared && (r.nuke || randomTank.length) ? share('Pressing') : '');
  }
  return `<div class="strip">${strip}</div><div class="card">${card}</div>`;
}

const root = document.getElementById('rail')!;
root.className = 'ext';
let heard: Heard | undefined, reply: Reply | undefined, token = '', drawn = '';
/** The answer to the last personal press, even one a newer press overtook: the cooldown ring's only source. */
let personal: PersonalReply | undefined;
/** A press made before the viewer shared identity: sent once Twitch's prompt shares it, dropped if they decline. */
let awaitingShare: Action | undefined;
/** Presses made so far: only the latest one's answer shows. */
let presses = 0;
const NO_ANSWER = { ok: false, reason: 'No answer' };
const isPersonal = (r: Reply): r is PersonalReply => r.action !== 'rhino' && r.action !== 'nuke';
function draw() {
  const next = html(rail(heard, Twitch.ext.viewer.id, reply, Date.now(), personal));
  if (next === drawn) return;
  // Kept across a redraw, so a scrolled rail on a short player stays where the viewer left it.
  const scrolled = root.querySelector('.strip')?.scrollTop ?? 0;
  root.innerHTML = drawn = next;
  root.querySelector('.strip')?.scrollTo(0, scrolled);
}

/** A button press: the bare chat command to the backend, which answers with what the game did. Never retried. */
async function press(action: Action) {
  // The game knows a viewer by their Twitch user ID, which Twitch hands over only once they share it.
  const askToShare = () => { awaitingShare = action; Twitch.ext.actions.requestIdShare(); };
  if (Twitch.ext.viewer.id === null) return askToShare();
  const mine = ++presses;
  let result = NO_ANSWER;
  try {
    const answer = await fetch(PRESS_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ command: `!${action}` }), signal: AbortSignal.timeout(PRESS_WAIT) });
    // 403: the backend sees no shared identity (the viewer took it back). Any other refusal: the press never reached the game.
    if (answer.status === 403) return askToShare();
    if (answer.ok) result = await answer.json();
  } catch { /* no reply in time, or none at all */ }
  const answered = { action, result, at: Date.now() };
  if (isPersonal(answered)) personal = answered;
  if (mine !== presses) return draw(); // a newer press's answer is the one to show
  reply = answered;
  draw();
}
root.addEventListener('click', (e) => {
  const action = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action as Action | undefined;
  if (action) void press(action);
});

// Twitch authorizes again once the viewer shares identity, and whenever it renews the token.
Twitch.ext.onAuthorized((auth) => {
  token = auth.token;
  const waiting = awaitingShare;
  awaitingShare = undefined;
  if (waiting && Twitch.ext.viewer.id !== null) void press(waiting);
  draw();
});
Twitch.ext.listen('broadcast', (_target, _type, message) => {
  try { heard = hear(heard, JSON.parse(message), Date.now()); } catch { return; }
  draw();
});
// The silence and the ring's end come with nothing to redraw them; a quarter second keeps the ring and the flash on time.
setInterval(draw, 250);
