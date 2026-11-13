// Contact sheets of prerendered atlases, for looking at voxel frames by eye (docs/agents/ra2-install.md).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { crc32 } from '../src/ra2/index.js';
import type { ConvertedSprite } from '../src/ra2/render/sprite.js';

/**
 * Writes `sprite`'s frames to `file` as a PNG grid, `cols` frames a row in frame order (32: one row per tilt of a
 * Rhino), each `scale` px per pixel, on a white ground.
 */
export function writeSheet(sprite: ConvertedSprite, file: string, cols = 32, scale = 2): void {
  const fw = sprite.spriteWidth, fh = sprite.spriteHeight, rows = Math.ceil(sprite.frames.length / cols);
  const w = fw * cols * scale, h = fh * rows * scale, rgb = new Uint8Array(w * h * 3).fill(255);
  sprite.frames.forEach((f, i) => {
    const ox = (i % cols) * fw, oy = Math.floor(i / cols) * fh;
    for (let y = 0; y < f.h * scale; y++) for (let x = 0; x < f.w * scale; x++) {
      const s = ((f.y + Math.floor(y / scale)) * sprite.atlasWidth + f.x + Math.floor(x / scale)) * 4, a = sprite.colorRgba[s + 3]! / 255;
      const d = ((oy * scale + y) * w + ox * scale + x) * 3;
      for (let c = 0; c < 3; c++) rgb[d + c] = Math.round(sprite.colorRgba[s + c]! * a + 255 * (1 - a));
    }
  });
  // PNG: 8-bit RGB, filter 0 on every row.
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]));
}
