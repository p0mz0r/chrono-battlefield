import type { Snapshot } from '../src/chat/gameLink.js';
import { cooldownAfter, MAX_TANKS, type ChatResult } from '../src/race/race.js';

/** Milliseconds without a snapshot before the rail draws nothing: the game re-sends every 5 s, so two missed means it's gone. */
const SILENCE = 10_000;
/** Milliseconds the personal tiles flash gold as they come back from the cooldown ring. */
const FLASH = 600;
/** Milliseconds a failed press stays on the rail. */
const FAILURE_SHOWS = 8000;
/** Reasons the backend or the press itself gives, not the game: shown as they are, not as the button's failure. */
const BACKEND_REASONS = ['Game offline', 'No answer', "Twitch didn't answer"];

/** A button the rail can show, by the bare chat command it sends. */
export type Action = 'rhino' | Personal | 'nuke';
/** The five personal tiles: they share the viewer's cooldown. */
export type Personal = 'shield' | 'v3' | 'boost' | 'missile' | 'tesla';
/** Each button's icon and label, as in the #171 prototype. */
export const TILES: Record<Action, [icon: string, label: string]> = {
  rhino: ['', 'JOIN'], shield: ['⛨', 'Shield'], v3: ['⇉', 'V3'], boost: ['»', 'Boost'], missile: ['➶', 'Missile'], tesla: ['ϟ', 'Tesla'], nuke: ['☢', 'NUKE'],
};

/** The last snapshot the extension heard and when (ms); `since`: when it first heard the race now on (ms). */
export interface Heard { snapshot: Snapshot; at: number; since: number }
/** The answer to the viewer's last press and when it came (ms). */
export interface Reply { action: Action; result: ChatResult; at: number }
/** The answer to the viewer's last press of a personal tile: the cooldown ring's only source. */
export type PersonalReply = Reply & { action: Personal };

/**
 * The viewer's cooldown: the personal tiles fold into a ring for `left` of `total` ms. `used`: what started it, unknown
 * when a press bounced off a cooldown started in chat.
 */
export interface Cooldown { used?: Personal; left: number; total: number }

/**
 * What the rail (and the phone view) draws. `shared`: the viewer has shared their Twitch identity, so their first press
 * needs no prompt from Twitch. `failure`: why their last press failed, under the top tile for a few seconds.
 */
export type Rail =
  | { state: 'none' }
  | { state: 'between' }
  | { state: 'join'; countdown: number; field: number; max: number; shared: boolean; join: boolean; failure?: string }
  /**
   * `me`: the viewer's own tank; `ownTank`: Shield and V3 for it; `randomTank`: Boost, Missile, Tesla; `nuke`: while armed;
   * `cooldown`: the ring the personal tiles fold into; `back`: the ring has just closed, so the tiles flash as they return.
   */
  | { state: 'race'; field: number; me?: Snapshot['racers'][number]; shared: boolean; ownTank: Action[]; randomTank: Action[]; nuke: boolean; failure?: string; cooldown?: Cooldown; back: boolean };

/** Why `reply`'s press failed, as the rail words it ("Tesla failed: cooldown 12 s"), while it still shows. */
function failure(reply: Reply | undefined, now: number) {
  if (!reply || reply.result.ok || now - reply.at >= FAILURE_SHOWS) return undefined;
  const { action, result: { reason } } = reply, label = TILES[action][1];
  if (BACKEND_REASONS.includes(reason)) return reason;
  return reason === 'ignored' ? `${label} failed` : `${label} failed: ${reason}`;
}

const racing = (s: Snapshot) => s.phase === 'countdown' || s.phase === 'racing';

/**
 * What the extension knows after hearing `snapshot` at `at` (ms), from what it heard before. A race starts over at any
 * phase outside it; an offline snapshot (no phase) mid-race doesn't end it.
 */
export function hear(prev: Heard | undefined, snapshot: Snapshot, at: number): Heard {
  return { snapshot, at, since: !prev || (snapshot.phase && !racing(snapshot)) ? at : prev.since };
}

/**
 * The cooldown a reply started, `left` negative once it has run out. Real seconds, paused race or not: a press after the
 * ring closes too soon bounces again with what is really left. None once a new race is on (`since`), as the game clears
 * every cooldown when a join window opens.
 */
function cooldownRun(reply: PersonalReply | undefined, since: number, now: number): Cooldown | undefined {
  if (!reply || reply.at < since) return;
  const total = 1000 * cooldownAfter(reply.action, reply.result);
  return total ? { used: reply.result.ok ? reply.action : undefined, left: reply.at + total - now, total } : undefined;
}

const OWN_TANK: Personal[] = ['shield', 'v3'], RANDOM_TANK: Personal[] = ['boost', 'missile', 'tesla'];

/**
 * What to draw now (#187, seam 6) from the last snapshot heard, the viewer's Twitch user ID (null until they share
 * identity), the answer to their last press, the clock, and the answer to their last personal press: the cooldown ring's
 * only source, as no snapshot or whisper carries the viewer's cooldown. Nothing when there's no snapshot, the rail is hidden (trial
 * race, game link offline) or the game has gone quiet.
 */
export function rail(heard: Heard | undefined, viewer: string | null, reply: Reply | undefined, now: number, personal?: PersonalReply): Rail {
  const s = heard?.snapshot;
  if (!s?.show || now - heard!.at >= SILENCE) return { state: 'none' };
  const me = viewer === null ? undefined : s.racers.find((r) => r.id === viewer), shared = viewer !== null;
  switch (s.phase) {
    case 'idle': case 'results': case 'cancelled': return { state: 'between' };
    case 'join': return { state: 'join', countdown: s.countdown, field: s.field, max: MAX_TANKS, shared, join: !me, failure: failure(reply, now) };
  }
  // Interactions only work once racing (`chat()` ignores them before); the place shows from the countdown.
  const on = (a: Action) => s.phase === 'racing' && s.interactions.includes(a);
  const run = s.phase === 'racing' ? cooldownRun(personal, heard!.since, now) : undefined;
  const cooldown = run && run.left > 0 ? run : undefined;
  return { state: 'race', field: s.field, me, shared, ownTank: me && !me.finished && !cooldown ? OWN_TANK.filter(on) : [],
    randomTank: cooldown ? [] : RANDOM_TANK.filter(on), nuke: s.phase === 'racing' && s.armed, failure: failure(reply, now),
    ...cooldown && { cooldown }, back: !!run && run.left <= 0 && -run.left < FLASH };
}
