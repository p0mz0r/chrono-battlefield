import type { Snapshot } from '../src/chat/gameLink.js';
import { MAX_TANKS } from '../src/race/race.js';

/** Milliseconds without a snapshot before the rail draws nothing: the game re-sends every 5 s, so two missed means it's gone. */
export const SILENCE = 10_000;

/** A tile a viewer can press, by the bare chat command it sends. */
export type Action = 'rhino' | 'shield' | 'v3' | 'boost' | 'missile' | 'tesla' | 'nuke';

/** The last snapshot the extension heard and when (ms). */
export interface Heard { snapshot: Snapshot; at: number }

/** The viewer's own tank: place from 1, progress in whole %, house colour as CSS. */
export type Place = Snapshot['racers'][number];

/** What the rail (and the mobile view) draws. */
export type Rail =
  | { state: 'none' }
  | { state: 'between' }
  /** `shared`: the viewer has shared their Twitch identity, so a press needs no prompt. */
  | { state: 'join'; countdown: number; field: number; max: number; shared: boolean; actions: Action[] }
  | { state: 'race'; field: number; me?: Place; actions: Action[] };

/** Own-tank tiles first, then random-tank ones, as in the #171 prototype. */
const OWN: Action[] = ['shield', 'v3'], RANDOM: Action[] = ['boost', 'missile', 'tesla'];

/**
 * What to draw now (#187, seam 6) from the last snapshot heard, the viewer's Twitch user ID (null until they share
 * identity) and the clock. Nothing when there's no snapshot, the rail is hidden (trial race, game link offline) or the
 * game has gone quiet.
 */
export function rail(heard: Heard | undefined, viewer: string | null, now: number): Rail {
  const s = heard?.snapshot;
  if (!s?.show || now - heard!.at >= SILENCE) return { state: 'none' };
  const me = viewer === null ? undefined : s.racers.find((r) => r.id === viewer);
  switch (s.phase) {
    case 'idle': case 'results': case 'cancelled': return { state: 'between' };
    case 'join': return { state: 'join', countdown: s.countdown, field: s.field, max: MAX_TANKS, shared: viewer !== null, actions: me ? [] : ['rhino'] };
  }
  // Interactions only work once racing (`chat()` ignores them before); the place shows from the countdown.
  const on = (a: Action) => s.interactions.includes(a);
  const actions = s.phase !== 'racing' ? [] : [...(me && !me.finished ? OWN.filter(on) : []), ...RANDOM.filter(on), ...(s.armed ? ['nuke' as const] : [])];
  return { state: 'race', field: s.field, me, actions };
}
