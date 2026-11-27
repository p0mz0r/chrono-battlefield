import type { Snapshot } from '../src/chat/gameLink.js';
import { MAX_TANKS } from '../src/race/race.js';

/** Milliseconds without a snapshot before the rail draws nothing: the game re-sends every 5 s, so two missed means it's gone. */
const SILENCE = 10_000;

/** A button the rail can show, by the bare chat command it sends. */
export type Action = 'rhino' | 'shield' | 'v3' | 'boost' | 'missile' | 'tesla' | 'nuke';

/** The last snapshot the extension heard and when (ms). */
export interface Heard { snapshot: Snapshot; at: number }

/**
 * What the rail (and the phone view) draws. `shared`: the viewer has shared their Twitch identity, so their first press
 * needs no prompt from Twitch.
 */
export type Rail =
  | { state: 'none' }
  | { state: 'between' }
  | { state: 'join'; countdown: number; field: number; max: number; shared: boolean; join: boolean }
  /** `me`: the viewer's own tank; `ownTank`: Shield and V3 for it; `randomTank`: Boost, Missile, Tesla; `nuke`: while armed. */
  | { state: 'race'; field: number; me?: Snapshot['racers'][number]; shared: boolean; ownTank: Action[]; randomTank: Action[]; nuke: boolean };

const OWN_TANK: Action[] = ['shield', 'v3'], RANDOM_TANK: Action[] = ['boost', 'missile', 'tesla'];

/**
 * What to draw now (#187, seam 6) from the last snapshot heard, the viewer's Twitch user ID (null until they share
 * identity) and the clock. Nothing when there's no snapshot, the rail is hidden (trial race, game link offline) or the
 * game has gone quiet.
 */
export function rail(heard: Heard | undefined, viewer: string | null, now: number): Rail {
  const s = heard?.snapshot;
  if (!s?.show || now - heard!.at >= SILENCE) return { state: 'none' };
  const me = viewer === null ? undefined : s.racers.find((r) => r.id === viewer), shared = viewer !== null;
  switch (s.phase) {
    case 'idle': case 'results': case 'cancelled': return { state: 'between' };
    case 'join': return { state: 'join', countdown: s.countdown, field: s.field, max: MAX_TANKS, shared, join: !me };
  }
  // Interactions only work once racing (`chat()` ignores them before); the place shows from the countdown.
  const on = (a: Action) => s.phase === 'racing' && s.interactions.includes(a);
  return { state: 'race', field: s.field, me, shared, ownTank: me && !me.finished ? OWN_TANK.filter(on) : [], randomTank: RANDOM_TANK.filter(on), nuke: s.phase === 'racing' && s.armed };
}
