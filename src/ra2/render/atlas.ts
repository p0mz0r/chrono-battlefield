// Pure atlas-packing math for the dev asset server.
//
// Packs a list of rectangular frames (SHP frames, or TMP tiles) into a single
// power-of-two atlas using a simple row (shelf) packer: frames are laid left to
// right on a shelf; when the next frame would overflow the atlas width, a new
// shelf starts below the tallest frame of the current one. The atlas width is
// chosen as the smallest power of two that fits the widest single frame and
// keeps a roughly square aspect; the height grows to the next power of two.
//
// This is deterministic and dependency-free so it can be unit-tested in
// isolation (see atlas.test.ts) without any game data.

/** A frame's intrinsic size before packing (0-area frames are allowed). */
export interface PackInput {
  readonly w: number;
  readonly h: number;
}

/** A frame's placement in the packed atlas. */
export interface PackedRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Result of packing: the atlas dimensions plus a rect per input (same order). */
export interface PackResult {
  readonly width: number;
  readonly height: number;
  readonly rects: readonly PackedRect[];
}

/** Smallest power of two >= n (min 1). */
export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Choose an atlas width (power of two). It must be at least the widest frame,
 * and we aim for a near-square atlas: start from the sqrt of the total frame
 * area and round up to a power of two, then widen if a single frame is wider.
 */
export function chooseAtlasWidth(inputs: readonly PackInput[], padding: number): number {
  let maxW = 1;
  let totalArea = 0;
  for (const it of inputs) {
    const w = it.w + padding;
    const h = it.h + padding;
    if (w > maxW) maxW = w;
    totalArea += w * h;
  }
  const squareSide = Math.ceil(Math.sqrt(totalArea));
  return nextPowerOfTwo(Math.max(maxW, squareSide));
}

/**
 * Shelf-pack `inputs` into a power-of-two atlas. `padding` (default 0) inserts a
 * transparent gutter to the right/below each frame to avoid bilinear bleed.
 * Zero-area frames get a `(0,0,0,0)` rect and consume no space. Rects are
 * returned in input order.
 */
export function packAtlas(inputs: readonly PackInput[], padding = 0): PackResult {
  if (inputs.length === 0) {
    return { width: 1, height: 1, rects: [] };
  }
  const width = chooseAtlasWidth(inputs, padding);
  const rects: PackedRect[] = new Array<PackedRect>(inputs.length);

  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;

  for (let i = 0; i < inputs.length; i++) {
    const it = inputs[i]!;
    if (it.w <= 0 || it.h <= 0) {
      // Empty/placeholder frame: no atlas area.
      rects[i] = { x: 0, y: 0, w: 0, h: 0 };
      continue;
    }
    const cellW = it.w + padding;
    const cellH = it.h + padding;
    if (cellW > width) {
      // A single frame wider than the chosen width should not happen because
      // chooseAtlasWidth accounts for the widest frame, but guard defensively.
      throw new Error(`frame ${i} width ${it.w} exceeds atlas width ${width}`);
    }
    if (shelfX + cellW > width) {
      // Move to a new shelf.
      shelfY += shelfHeight;
      shelfX = 0;
      shelfHeight = 0;
    }
    rects[i] = { x: shelfX, y: shelfY, w: it.w, h: it.h };
    shelfX += cellW;
    if (cellH > shelfHeight) shelfHeight = cellH;
  }

  const usedHeight = shelfY + shelfHeight;
  const height = nextPowerOfTwo(usedHeight);
  return { width, height, rects };
}
