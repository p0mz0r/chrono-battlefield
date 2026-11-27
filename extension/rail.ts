import type { Snapshot } from '../src/chat/gameLink.js';
import { MAX_TANKS, type ChatResult } from '../src/race/race.js';

/** Milliseconds without a snapshot before the rail draws nothing: the game re-sends every 5 s, so two missed means it's gone. */
const SILENCE = 10_000;
/** Milliseconds a failed press stays on the rail. */
const FAILURE_SHOWS = 8000;
/** Reasons the link gives, not the game: shown as they are, not as the button's failure. */
const LINK_REASONS = ['Game offline', 'No answer', "Twitch didn't answer"];

/** A button the rail can show, by the bare chat command it sends. */
export type Action = 'rhino' | 'shield' | 'v3' | 'boost' | 'missile' | 'tesla' | 'nuke';
/** Each button's icon and label, as in the #171 prototype. */
export const TILES: Record<Action, [icon: string, label: string]> = {
  rhino: ['', 'JOIN'], shield: ['⛨', 'Shield'], v3: ['⇉', 'V3'], boost: ['»', 'Boost'], missile: ['➶', 'Missile'], tesla: ['ϟ', 'Tesla'], nuke: ['☢', 'NUKE'],
};

/** The last snapshot the extension heard and when (ms). */
export interface Heard { snapshot: Snapshot; at: number }
/** The answer to the viewer's last press and when it came (ms). */
export interface Reply { action: Action; result: ChatResult; at: number }

/**
 * What the rail (and the phone view) draws. `shared`: the viewer has shared their Twitch identity, so their first press
 * needs no prompt from Twitch. `failure`: why their last press failed, under the top tile for a few seconds.
 */
export type Rail =
  | { state: 'none' }
  | { state: 'between' }
  | { state: 'join'; countdown: number; field: number; max: number; shared: boolean; join: boolean; failure?: string }
  /** `me`: the viewer's own tank; `ownTank`: Shield and V3 for it; `randomTank`: Boost, Missile, Tesla; `nuke`: while armed. */
  | { state: 'race'; field: number; me?: Snapshot['racers'][number]; shared: boolean; ownTank: Action[]; randomTank: Action[]; nuke: boolean; failure?: string };

/** Why `reply`'s press failed, as the rail words it ("Tesla failed: cooldown 12 s"), while it still shows. */
function failure(reply: Reply | undefined, now: number) {
  if (!reply || reply.result.ok || now - reply.at >= FAILURE_SHOWS) return undefined;
  const { action, result: { reason } } = reply, label = TILES[action][1];
  if (LINK_REASONS.includes(reason)) return reason;
  return reason === 'ignored' ? `${label} failed` : `${label} failed: ${reason}`;
}

const OWN_TANK: Action[] = ['shield', 'v3'], RANDOM_TANK: Action[] = ['boost', 'missile', 'tesla'];

/**
 * What to draw now (#187, seam 6) from the last snapshot heard, the viewer's Twitch user ID (null until they share
 * identity), the answer to their last press and the clock. Nothing when there's no snapshot, the rail is hidden (trial
 * race, game link offline) or the game has gone quiet.
 */
export function rail(heard: Heard | undefined, viewer: string | null, reply: Reply | undefined, now: number): Rail {
  const s = heard?.snapshot;
  if (!s?.show || now - heard!.at >= SILENCE) return { state: 'none' };
  const me = viewer === null ? undefined : s.racers.find((r) => r.id === viewer), shared = viewer !== null;
  switch (s.phase) {
    case 'idle': case 'results': case 'cancelled': return { state: 'between' };
    case 'join': return { state: 'join', countdown: s.countdown, field: s.field, max: MAX_TANKS, shared, join: !me, failure: failure(reply, now) };
  }
  // Interactions only work once racing (`chat()` ignores them before); the place shows from the countdown.
  const on = (a: Action) => s.phase === 'racing' && s.interactions.includes(a);
  return { state: 'race', field: s.field, me, shared, ownTank: me && !me.finished ? OWN_TANK.filter(on) : [], randomTank: RANDOM_TANK.filter(on), nuke: s.phase === 'racing' && s.armed, failure: failure(reply, now) };
}
