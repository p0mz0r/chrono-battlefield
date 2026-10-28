// From openra2 packages/formats/src/aud/adpcm.ts @ 8ba59f0 (GPL-3.0-or-later); openra2's notice follows, changes since are ours.
// Ported from the XCC library by Olaf van der Spek (GPLv3) — misc/aud_decode.cpp.
//
// IMA-ADPCM decoder for RA2/YR audio bag chunks.
//
// The step / index / code tables below are transcribed EXACTLY from aud_decode.cpp
// (the same constants IMA-ADPCM standardised in the IMA Digital Audio spec, which
// XCC reproduces). Getting a single table entry wrong silently corrupts every
// decoded sample, so they are kept verbatim and covered by golden-vector unit tests.

/**
 * IMA-ADPCM step-size table: 89 entries indexed by the running step index (0..88).
 * Transcribed verbatim from XCC aud_decode.cpp (`ima_step_table`).
 */
export const IMA_STEP_TABLE: readonly number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
  19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
  337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
  876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
  5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

/**
 * IMA-ADPCM index-adjust table: how the step index moves for each 4-bit code
 * (the low 3 bits are the magnitude; bit 3 is sign, so entries mirror 0..7).
 * Transcribed verbatim from XCC aud_decode.cpp (`ima_index_table`).
 */
export const IMA_INDEX_TABLE: readonly number[] = [
  -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
];

/** Clamp a 32-bit accumulator to the signed 16-bit PCM range. */
function clampS16(v: number): number {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v;
}

/**
 * Running state for an IMA-ADPCM stream: the current predicted sample and the
 * current step-table index. Both AUD (per-chunk reset) and the audio bank
 * (per-512-byte-block reset) drive the SAME nibble decoder over this state; the
 * container decides when to reset it.
 */
export interface ImaState {
  /** Current predicted sample (accumulates across nibbles). */
  predictor: number;
  /** Current index into {@link IMA_STEP_TABLE} (0..88). */
  index: number;
}

/** A fresh, zeroed IMA-ADPCM state (predictor 0, index 0). */
export function newImaState(): ImaState {
  return { predictor: 0, index: 0 };
}

/**
 * Decode ONE 4-bit IMA-ADPCM code into the next PCM sample, advancing `state`.
 * This is the exact inner step from XCC aud_decode.cpp: build the difference from
 * the current step size using the code's magnitude bits, apply the sign bit, clamp,
 * then move the step index by the index table (clamped to 0..88).
 */
export function decodeImaNibble(code: number, state: ImaState): number {
  const step = IMA_STEP_TABLE[state.index]!;
  // diff = step/8 + (b2?step/2:0) + (b1?step/4:0) + (b0?step/8 already in base).
  // XCC builds it additively from the high bit down; the equivalent bit tests:
  let diff = step >> 3;
  if (code & 1) diff += step >> 2;
  if (code & 2) diff += step >> 1;
  if (code & 4) diff += step;
  if (code & 8) diff = -diff;
  state.predictor = clampS16(state.predictor + diff);
  state.index += IMA_INDEX_TABLE[code & 0x0f]!;
  if (state.index < 0) state.index = 0;
  else if (state.index > 88) state.index = 88;
  return state.predictor;
}

/**
 * Decode a run of packed IMA-ADPCM bytes (two 4-bit codes per byte, low nibble
 * first) into `out` starting at `outPos`, over the shared {@link ImaState}. Returns
 * the number of samples written (== 2 * bytes). The caller resets `state` at the
 * boundaries its container defines (AUD chunk / WAV block / bag block).
 */
export function decodeImaBlock(
  data: Uint8Array,
  start: number,
  length: number,
  state: ImaState,
  out: Int16Array,
  outPos: number,
): number {
  let o = outPos;
  const end = start + length;
  for (let i = start; i < end; i++) {
    const byte = data[i]!;
    out[o++] = decodeImaNibble(byte & 0x0f, state);
    out[o++] = decodeImaNibble(byte >> 4, state);
  }
  return o - outPos;
}
