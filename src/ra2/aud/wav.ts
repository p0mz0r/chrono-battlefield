import { decodeImaBlock } from './adpcm.js';
import type { DecodedAudio } from './audioBank.js';

/** Decodes the install's mono IMA-ADPCM RIFF WAV announcements to signed 16-bit PCM. */
export function decodeWav(bytes: Uint8Array): DecodedAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('WAV: missing RIFF/WAVE header');
  const end = view.getUint32(4, true) + 8;
  if (end < 12 || end > bytes.length) throw new Error('WAV: invalid RIFF size');
  let format: DataView | undefined, data: Uint8Array | undefined, count: number | undefined;
  for (let at = 12; at < end;) {
    if (at + 8 > end) throw new Error('WAV: truncated chunk header');
    const size = view.getUint32(at + 4, true), start = at + 8;
    if (start + size + (size & 1) > end) throw new Error('WAV: truncated chunk');
    if (tag(at) === 'fmt ') format = new DataView(bytes.buffer, bytes.byteOffset + start, size);
    if (tag(at) === 'data') data = bytes.subarray(start, start + size);
    if (tag(at) === 'fact') {
      if (size < 4) throw new Error('WAV: truncated fact');
      count = view.getUint32(start, true);
    }
    at = start + size + (size & 1);
  }
  if (!format || format.byteLength < 20 || !data) throw new Error('WAV: missing fmt or data');
  const sampleRate = format.getUint32(4, true), blockSize = format.getUint16(12, true), perBlock = format.getUint16(18, true);
  if (format.getUint16(0, true) !== 0x11 || format.getUint16(2, true) !== 1 || format.getUint16(14, true) !== 4) throw new Error('WAV: expected mono IMA-ADPCM');
  if (!sampleRate || blockSize < 4 || format.getUint16(16, true) < 2 || perBlock !== (blockSize - 4) * 2 + 1) throw new Error('WAV: invalid IMA format');
  const blocks = Math.floor(data.length / blockSize), tail = data.length % blockSize;
  if (tail > 0 && tail < 4) throw new Error('WAV: truncated IMA block');
  const capacity = blocks * perBlock + (tail ? (tail - 4) * 2 + 1 : 0);
  if (count !== undefined && count > capacity) throw new Error('WAV: fact exceeds decoded length');
  const samples = new Int16Array(capacity), body = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let out = 0;
  for (let at = 0; at < data.length; at += blockSize) {
    const state = { predictor: body.getInt16(at, true), index: data[at + 2]! };
    if (state.index > 88 || data[at + 3] !== 0) throw new Error('WAV: invalid IMA block header');
    samples[out++] = state.predictor;
    out += decodeImaBlock(data, at + 4, Math.min(blockSize, data.length - at) - 4, state, samples, out);
  }
  return { samples: samples.subarray(0, count ?? out), sampleRate, channels: 1 };
}
