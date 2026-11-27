import { rail, type Action, type Heard, type Rail } from './rail.js';

/** The parts of Twitch's extension helper the rail uses. */
declare const Twitch: { ext: {
  viewer: { id: string | null };
  onAuthorized(callback: () => void): void;
  listen(target: 'broadcast', callback: (target: string, contentType: string, message: string) => void): void;
} };

/** Each tile's icon and label, as in the #171 prototype. */
const TILES: Record<Action, [icon: string, label: string]> = {
  rhino: ['', 'JOIN'], shield: ['⛨', 'Shield'], v3: ['⇉', 'V3'], boost: ['»', 'Boost'], missile: ['➶', 'Missile'], tesla: ['ϟ', 'Tesla'], nuke: ['☢', 'NUKE'],
};
/** For a viewer who hasn't shared identity: what their first press makes Twitch ask. */
const share = (verb: string) => `<p>${verb} shares your Twitch name with Rhino Race. Twitch asks once.</p>`;

// ponytail: tiles don't press yet; #198 sends them to the backend.
const tile = (a: Action) => `<button type="button" class="${a}">${TILES[a][0] ? `<i>${TILES[a][0]}</i>` : ''}${TILES[a][1]}</button>`;
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
    strip = `<div class="tile"><big class="countdown">${r.countdown}</big><small>${r.field} of ${r.max}</small></div>${r.join ? tile('rhino') : ''}`;
    card = `<h3>Join window · ${r.countdown} s</h3><p>${r.field} of ${r.max} racers.</p>`
      + (!r.join ? '<p>You have a tank in this race.</p>' : r.shared ? '<p>JOIN gets you a tank in this race.</p>' : share('Joining'));
  } else {
    const { me, ownTank, randomTank } = r, progress = me?.finished ? 'finished' : `${me?.progress}%`;
    const place = me && `<big style="color:${colour(me.colour)}">P${me.place}</big>`;
    strip = (place ? `<div class="tile">${place}<small>${progress}</small></div>` : '<div class="tile"><b>RACE</b><br><small>on</small></div>')
      + (r.nuke ? tile('nuke') : '')
      + ownTank.map(tile).join('') + (ownTank.length && randomTank.length ? '<div class="sep"></div>' : '') + randomTank.map(tile).join('');
    card = `<h3>${place ? `${place} of ${r.field} · ${progress}` : 'Race on'}</h3>`
      + (r.nuke ? '<p>☢ Nuke: the hype meter is armed.</p>' : '')
      + (ownTank.length ? `<p>${labels(ownTank)}: your own tank.</p>` : '') + (randomTank.length ? `<p>${labels(randomTank)}: a random tank.</p>` : '')
      + (!r.shared && (r.nuke || randomTank.length) ? share('Pressing') : '');
  }
  return `<div class="strip">${strip}</div><div class="card">${card}</div>`;
}

const root = document.getElementById('rail')!;
root.className = 'ext';
let heard: Heard | undefined, drawn = '';
function draw() {
  const next = html(rail(heard, Twitch.ext.viewer.id, Date.now()));
  if (next === drawn) return;
  // Kept across a redraw, so a scrolled rail on a short player stays where the viewer left it.
  const scrolled = root.querySelector('.strip')?.scrollTop ?? 0;
  root.innerHTML = drawn = next;
  root.querySelector('.strip')?.scrollTo(0, scrolled);
}

Twitch.ext.onAuthorized(draw);
Twitch.ext.listen('broadcast', (_target, _type, message) => {
  try { heard = { snapshot: JSON.parse(message), at: Date.now() }; } catch { return; }
  draw();
});
// The ~10 s silence clears the rail with nothing arriving to redraw it.
setInterval(draw, 1000);
