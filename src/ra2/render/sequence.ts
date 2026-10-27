// From openra2 apps/client/dev/sequence.ts @ 8ba59f0 (GPL-3.0-or-later); openra2's notice follows, changes since are ours.
// Infantry [Sequence] parsing for the dev asset server (pure logic).
//
// RA2/YR infantry SHPs (e.g. cons.shp for the Conscript) pack EVERY animation
// state — stand, walk, fire, die, cheer — into one big frame list. Which frames
// belong to which state, and how facing indexes into them, is described by an
// artmd.ini [Sequence] section that the techno's `Sequence=` key names. Verified
// against the real install (stage 3), the Conscript's `[ConSequence]` reads:
//
//   Ready=0,1,1        FireUp=164,6,6      Idle1=56,15,0,S
//   Guard=0,1,1        Down=260,2,2        Idle2=71,15,0,E
//   Walk=8,6,6         Crawl=86,6,6        Die1=134,15,0
//   Prone=86,1,6       Up=276,2,2          ...
//
// ENTRY GRAMMAR (ModEnc "Sequence"): `State=start,count,facingStride[,dir]`
//   * start  — first frame index of this state's run within the SHP.
//   * count  — number of ANIMATION frames per facing (the walk cycle length; 1 for
//              a static pose like Ready).
//   * facingStride — how many frames to advance PER FACING. For a directional state
//              this equals `count` (each of the 8 facings gets its own `count`-frame
//              run laid consecutively). A stride of 0 means the state is
//              NON-DIRECTIONAL (idle fidgets, deaths): all facings share one run.
//   * dir    — optional cardinal (S/E/…) fixing the facing for a non-directional
//              state; ignored for frame math, retained verbatim for completeness.
//
// FRAME FORMULA (the render layer's, documented here so the contract is one place):
//   frame(state, facingSector, animStep) =
//       start + facingSector * facingStride + (animStep % count)
//   where facingSector in [0,8) is the quantized 8-way facing (facing.ts) and
//   animStep is the render-clock tick. For facingStride 0 the facing term drops out.
//
// RA2 infantry use 8 facings; that count is fixed here (INFANTRY_FACINGS). This
// module imports only the INI types so it is unit-testable with synthetic text.

import type { IniFile } from '../index.js';

/** RA2/YR infantry directional sprites always provide 8 facings. */
export const INFANTRY_FACINGS = 8;

/** One parsed [Sequence] state: a run of frames + how facing strides through it. */
export interface SequenceState {
  /** First SHP frame index of this state's run. */
  readonly start: number;
  /** Animation frames per facing (walk-cycle length; 1 for a static pose). */
  readonly count: number;
  /**
   * Frames to advance per facing. Equals {@link count} for a directional state;
   * 0 for a non-directional one (all facings share the single run at {@link start}).
   */
  readonly facingStride: number;
  /** Optional fixed-facing cardinal (e.g. 'S') for non-directional states. */
  readonly dir?: string;
}

/**
 * A techno's parsed animation sequence: state name (lowercased) -> its run. The
 * render layer looks up `ready` for the idle pose and `walk` while moving; other
 * states are carried for completeness / future combat/death animation.
 */
export interface SequenceTable {
  /** Number of facings the directional states index across (always 8 for infantry). */
  readonly facings: number;
  /** State runs keyed by lowercased state name. */
  readonly states: Readonly<Record<string, SequenceState>>;
}

/**
 * Parse one `State=start,count,facingStride[,dir]` value. Returns undefined for a
 * value that has fewer than the three required integer fields or any non-integer
 * numeric field, so a malformed entry is skipped rather than poisoning the table.
 */
export function parseSequenceEntry(value: string): SequenceState | undefined {
  const parts = value.split(',').map((p) => p.trim());
  if (parts.length < 3) return undefined;
  const start = Number.parseInt(parts[0]!, 10);
  const count = Number.parseInt(parts[1]!, 10);
  const facingStride = Number.parseInt(parts[2]!, 10);
  if (!Number.isFinite(start) || !Number.isFinite(count) || !Number.isFinite(facingStride)) {
    return undefined;
  }
  if (Number.isNaN(start) || Number.isNaN(count) || Number.isNaN(facingStride)) return undefined;
  const dir = parts[3] !== undefined && parts[3].length > 0 ? parts[3] : undefined;
  return dir !== undefined
    ? { start, count, facingStride, dir }
    : { start, count, facingStride };
}

/**
 * Parse an artmd `[<sequenceName>]` section into a {@link SequenceTable}. Unknown
 * or malformed entries are skipped. Returns undefined when the section is absent so
 * the caller can fall back to a bare directional layout (frame = facing sector).
 */
export function parseSequenceSection(art: IniFile, sequenceName: string): SequenceTable | undefined {
  const sec = art.getSection(sequenceName);
  if (!sec) return undefined;
  const states: Record<string, SequenceState> = {};
  for (const e of sec.entries) {
    const parsed = parseSequenceEntry(e.value);
    if (parsed) states[e.key.toLowerCase()] = parsed;
  }
  if (Object.keys(states).length === 0) return undefined;
  return { facings: INFANTRY_FACINGS, states };
}

/**
 * Resolve the SHP frame to draw for a state at a facing sector + animation step.
 * `facingSector` is the quantized 8-way facing; `animStep` is the render-clock tick
 * (only its modulo `count` matters). For a non-directional state (facingStride 0)
 * the facing term drops out. Pure integer math — the render layer's single frame
 * selector, exported for direct unit testing.
 */
export function sequenceFrame(state: SequenceState, facingSector: number, animStep: number): number {
  const count = state.count > 0 ? state.count : 1;
  const anim = ((animStep % count) + count) % count;
  const facing = state.facingStride > 0 ? facingSector * state.facingStride : 0;
  return state.start + facing + anim;
}
