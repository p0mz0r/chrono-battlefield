import { GAME_LINK_URL } from '../src/chat/gameLink.js';
import { CHEER_PRICES, PAID_TITLES, type ChatResult, type PaidEvent } from '../src/race/race.js';
import { rail, TILES, type Action, type Heard, type Rail, type Reply } from './rail.js';

/** The parts of Twitch's extension helper the rail uses. */
declare const Twitch: { ext: {
  viewer: { id: string | null };
  actions: { requestIdShare(): void };
  onAuthorized(callback: (auth: { token: string }) => void): void;
  listen(target: 'broadcast', callback: (target: string, contentType: string, message: string) => void): void;
  features: { isBitsEnabled: boolean; onChanged(callback: (changed: string[]) => void): void };
  bits: {
    useBits(sku: string): void;
    /** Every viewer's page hears every purchase; `initiator` says whether this viewer made it. */
    onTransactionComplete(callback: (t: { initiator: 'current_user' | 'other'; transactionReceipt: string; product: { sku: string } }) => void): void;
  };
} };

/** The backend's press route, beside the game's link; it must be on the extension's URL fetching allowlist (#202). */
const PRESS_URL = GAME_LINK_URL.replace(/^wss:/, 'https:').replace(/\/game$/, '/press');
/** Its purchase route: the signed receipt, checked there before the game plays it. */
const BITS_URL = PRESS_URL.replace(/\/press$/, '/bits');
/** Milliseconds a press waits before "No answer": the backend's own 3 s wait for the game, plus naming the viewer. */
const PRESS_WAIT = 6000;

/** For a viewer who hasn't shared identity: what their first press makes Twitch ask. */
const share = (verb: string) => `<p>${verb} shares your Twitch name with Rhino Race. Twitch asks once.</p>`;
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const tile = (a: Action) => `<button type="button" class="${a}" data-action="${a}">${TILES[a][0] ? `<i>${TILES[a][0]}</i>` : ''}${TILES[a][1]}</button>`;
/** A failed press, under the top tile. */
const fail = (failure: string | undefined) => failure ? `<div class="fail">${escape(failure)}</div>` : '';
/** A big event for Bits: the event and its price, the SKU in `data-bits`. Never "cheer", "buy" or "spend" (#187). */
const bitsTile = (e: PaidEvent) => `<button type="button" class="bits" data-bits="${e}">${PAID_TITLES[e]}<small>${CHEER_PRICES[e]} Bits</small></button>`;
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
    const { me, ownTank, randomTank, bits } = r, progress = me?.finished ? 'finished' : `${me?.progress}%`;
    const place = me && `<big style="color:${colour(me.colour)}">P${me.place}</big>`;
    strip = (place ? `<div class="tile">${place}<small>${progress}</small></div>` : '<div class="tile"><b>RACE</b><br><small>on</small></div>')
      + fail(r.failure) + (r.nuke ? tile('nuke') : '')
      + ownTank.map(tile).join('') + (ownTank.length && randomTank.length ? '<div class="sep"></div>' : '') + randomTank.map(tile).join('')
      + (bits.length ? '<div class="sep"></div>' : '') + bits.map(bitsTile).join('');
    card = `<h3>${place ? `${place} of ${r.field} · ${progress}` : 'Race on'}</h3>`
      + (r.nuke ? '<p>☢ Nuke: the hype meter is armed.</p>' : '')
      + (ownTank.length ? `<p>${labels(ownTank)}: your own tank.</p>` : '') + (randomTank.length ? `<p>${labels(randomTank)}: a random tank.</p>` : '')
      + (bits.length ? `<p>${bits.map((e) => `${PAID_TITLES[e]} ${CHEER_PRICES[e]}`).join(', ')} Bits: a big event for the whole race.</p>` : '')
      + (!r.shared && (r.nuke || randomTank.length) ? share('Pressing') : '');
  }
  return `<div class="strip">${strip}</div><div class="card">${card}</div>`;
}

const root = document.getElementById('rail')!;
root.className = 'ext';
let heard: Heard | undefined, reply: Reply | undefined, token = '', drawn = '';
/** A press made before the viewer shared identity: sent once Twitch's prompt shares it, dropped if they decline. */
let awaitingShare: Action | undefined;
/** Presses made so far: only the latest one's answer shows. */
let presses = 0;
const NO_ANSWER: ChatResult = { ok: false, reason: 'No answer' };
function draw() {
  const next = html(rail(heard, Twitch.ext.viewer.id, reply, Date.now(), Twitch.ext.features.isBitsEnabled));
  if (next === drawn) return;
  // Kept across a redraw, so a scrolled rail on a short player stays where the viewer left it.
  const scrolled = root.querySelector('.strip')?.scrollTop ?? 0;
  root.innerHTML = drawn = next;
  root.querySelector('.strip')?.scrollTo(0, scrolled);
}

/** `body` to the backend's `url` as this viewer: what the game did, "No answer", or undefined on a 403 (no shared identity). */
async function send(url: string, body: object): Promise<ChatResult | undefined> {
  try {
    const answer = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(PRESS_WAIT) });
    if (answer.status === 403) return undefined;
    // Any other refusal: it never reached the game.
    if (answer.ok) return await answer.json();
  } catch { /* no reply in time, or none at all */ }
  return NO_ANSWER;
}
/** The answer to the viewer's press or purchase, unless a newer one came since: that one's answer is the one to show. */
function answered(mine: number, action: Reply['action'], result: ChatResult) {
  if (mine !== presses) return;
  reply = { action, result, at: Date.now() };
  draw();
}

/** A button press: the bare chat command to the backend, which answers with what the game did. Never retried. */
async function press(action: Action) {
  // The game knows a viewer by their Twitch user ID, which Twitch hands over only once they share it.
  const askToShare = () => { awaitingShare = action; Twitch.ext.actions.requestIdShare(); };
  if (Twitch.ext.viewer.id === null) return askToShare();
  const mine = ++presses, result = await send(PRESS_URL, { command: `!${action}` });
  // The backend sees no shared identity: the viewer took it back.
  if (!result) return askToShare();
  answered(mine, action, result);
}
root.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLElement>('[data-action], [data-bits]');
  if (button?.dataset.action) void press(button.dataset.action as Action);
  // Twitch runs the purchase; its receipt comes back through `onTransactionComplete`.
  if (button?.dataset.bits) Twitch.ext.bits.useBits(button.dataset.bits);
});
// A purchase this viewer made: the signed receipt to the backend, once. Lost if the game is offline (#173).
Twitch.ext.bits.onTransactionComplete(async (t) => {
  if (t.initiator !== 'current_user') return;
  const mine = ++presses;
  answered(mine, t.product.sku as PaidEvent, await send(BITS_URL, { receipt: t.transactionReceipt }) ?? NO_ANSWER);
});
Twitch.ext.features.onChanged(draw);

// Twitch authorizes again once the viewer shares identity, and whenever it renews the token.
Twitch.ext.onAuthorized((auth) => {
  token = auth.token;
  const waiting = awaitingShare;
  awaitingShare = undefined;
  if (waiting && Twitch.ext.viewer.id !== null) void press(waiting);
  draw();
});
Twitch.ext.listen('broadcast', (_target, _type, message) => {
  try { heard = { snapshot: JSON.parse(message), at: Date.now() }; } catch { return; }
  draw();
});
// The ~10 s silence clears the rail with nothing arriving to redraw it.
setInterval(draw, 1000);
