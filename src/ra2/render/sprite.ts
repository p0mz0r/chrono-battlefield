// From openra2 apps/client/dev/sprite.ts @ 8ba59f0 (GPL-3.0-or-later); openra2's notice follows, changes since are ours.
// SHP -> SpriteAtlas conversion for the dev asset server (pure logic).
//
// Takes a parsed ShpFile and a Palette and produces:
//   * a color RGBA atlas (remap pixels rendered with the neutral palette ramp),
//   * an optional grayscale remap MASK atlas (present only if the sprite uses
//     any remap-range index),
//   * per-frame rects + offsets.
//
// The team-color contract is documented on SpriteAtlas in the render types:
// remap-range palette indices (16..31) are NOT baked to a player here. They are
// drawn with the neutral palette's own 16..31 gray ramp in the color atlas, and
// their RAMP POSITION (index-16 scaled to 0..255) is written into the mask so
// the renderer can tint per player at draw time.
//
// Pixel index 0 is the SHP sprite-transparent color -> fully transparent (a=0).
//
// This module imports only @vanguard/formats types (Palette, ShpFile) and the
// pure atlas packer, so it is unit-testable with a synthetic SHP+PAL.

import type { Palette } from '../index.js';
import { REMAP_INDEX_START, REMAP_INDEX_END, shadowFrameIndex } from '../index.js';
import type { ShpFile, ShpFrame } from '../index.js';
import { packAtlas, type PackInput } from './atlas.js';
import type { SequenceTable } from './sequence.js';

/** Fully-decoded, packed sprite: color + optional mask RGBA planes + geometry. */
export interface ConvertedSprite {
  readonly name: string;
  readonly frameCount: number;
  readonly spriteWidth: number;
  readonly spriteHeight: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  /** Color atlas RGBA bytes (`atlasWidth*atlasHeight*4`). */
  readonly colorRgba: Uint8Array;
  /**
   * Remap mask atlas RGBA bytes, or undefined when the sprite has no remap
   * pixels. Mask pixels: RGB = ramp position (index-16 scaled 0..255) in all
   * three channels; alpha = 255 for remap pixels, 0 elsewhere.
   */
  readonly maskRgba?: Uint8Array;
  readonly frames: readonly {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly offsetX: number;
    readonly offsetY: number;
  }[];
  /** True for a procedurally-generated VXL placeholder (see makeVehiclePlaceholder). */
  readonly placeholder?: boolean;
  /** True for a cameo composited from a techno's own art (see cameo.ts composeCameo). */
  readonly generatedCameo?: boolean;
  /**
   * When the SHP's SECOND-HALF shadow frames are POPULATED, this is `frameCount/2`
   * (the shadow of body frame `i` is frame `i + shadowFrameBase`). Undefined when
   * the shadow half is empty (e.g. cons.shp) or the frame count is odd — the render
   * layer then falls back to a synthetic blob shadow. See {@link shadowFrameIndex}.
   */
  readonly shadowFrameBase?: number;
  /** Infantry animation sequence (from artmd `Sequence=`), attached by the plugin. */
  readonly sequence?: SequenceTable;
  /**
   * On-screen scale multiplier the render layer applies to this atlas' frames
   * (default 1 when absent). Set by the HD-building route to shrink hi-dpi art to
   * the native footprint; SHP/VXL conversions never set it. See SpriteAtlas.renderScale.
   */
  readonly renderScale?: number;
  /**
   * SEPARATE TURRET part for a turreted voxel vehicle (HTNK etc.): its own 32-facing
   * atlas (turret + barrel composited) plus the rotation pivot in the body's render
   * frame. Present only on a body atlas whose model ships a `*tur.vxl`. The render
   * layer draws this atlas by the entity's turretFacing, offset by the pivot, over
   * the body. See voxelRender.ts renderTurretToSprite / turretPivotInBodyFrame.
   */
  readonly turret?: TurretPart;
}

/** A composited turret atlas + its body-frame pivot (see ConvertedSprite.turret). */
export interface TurretPart {
  /** Turret (+barrel) color atlas RGBA (`atlasWidth*atlasHeight*4`). */
  readonly colorRgba: Uint8Array;
  /** Turret remap mask RGBA, or undefined when the turret has no remap pixels. */
  readonly maskRgba?: Uint8Array;
  readonly frameCount: number;
  readonly spriteWidth: number;
  readonly spriteHeight: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly frames: ConvertedSprite['frames'];
  /** Turret pivot in the body render frame (x right, y forward, z up). */
  readonly pivot: readonly [number, number, number];
}

/** Number of shades in the remap ramp (indices 16..31 inclusive = 16). */
const REMAP_SHADES = REMAP_INDEX_END - REMAP_INDEX_START + 1;

/** True if a palette index falls in the player-remap ramp (16..31). */
function isRemapIndex(index: number): boolean {
  return index >= REMAP_INDEX_START && index <= REMAP_INDEX_END;
}

/**
 * Map a remap index (16..31) to its 0..255 ramp position. Index 16 -> 0
 * (darkest), index 31 -> 255 (lightest), evenly spaced across the 16 shades.
 */
export function remapRampPosition(index: number): number {
  const step = index - REMAP_INDEX_START; // 0..15
  return Math.round((step * 255) / (REMAP_SHADES - 1));
}

/**
 * Convert a SHP + palette into a packed color atlas and (if needed) a remap
 * mask atlas. `padding` gutters frames to avoid bilinear bleed (default 1).
 */
export function convertShpToAtlas(
  name: string,
  shp: ShpFile,
  palette: Palette,
  padding = 1,
  sequence?: SequenceTable,
): ConvertedSprite {
  const frames: ShpFrame[] = shp.decodeAll();
  const inputs: PackInput[] = frames.map((f) => ({ w: f.cx, h: f.cy }));
  const pack = packAtlas(inputs, padding);

  const atlasPixels = pack.width * pack.height;
  const colorRgba = new Uint8Array(atlasPixels * 4);
  const maskRgba = new Uint8Array(atlasPixels * 4);
  let anyRemap = false;

  const outFrames: ConvertedSprite['frames'] = frames.map((frame, i) => {
    const rect = pack.rects[i]!;
    // Blit this frame's pixels into the atlas at (rect.x, rect.y).
    for (let py = 0; py < frame.cy; py++) {
      for (let px = 0; px < frame.cx; px++) {
        const idx = frame.pixels[py * frame.cx + px]!;
        const ax = rect.x + px;
        const ay = rect.y + py;
        const dst = (ay * pack.width + ax) * 4;
        if (idx === 0) {
          // Sprite-transparent: leave color and mask fully transparent (zeroed).
          continue;
        }
        // COLOR plane: resolve index through the palette. Remap-range indices
        // resolve to the NEUTRAL palette's own 16..31 gray ramp — not baked to
        // any player — so an un-tinted draw already looks sane.
        const c = palette.color(idx);
        colorRgba[dst] = c.r;
        colorRgba[dst + 1] = c.g;
        colorRgba[dst + 2] = c.b;
        colorRgba[dst + 3] = 0xff;

        // MASK plane: only remap-range pixels are recolored per player.
        if (isRemapIndex(idx)) {
          anyRemap = true;
          const ramp = remapRampPosition(idx);
          maskRgba[dst] = ramp;
          maskRgba[dst + 1] = ramp;
          maskRgba[dst + 2] = ramp;
          maskRgba[dst + 3] = 0xff;
        }
      }
    }
    return {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      offsetX: frame.x,
      offsetY: frame.y,
    };
  });

  // SHADOW HALF detection: the SHP stores shadows as the 2nd half of the frame
  // list. The half is USABLE only when the frame count is even AND at least one
  // shadow-half frame decoded to real pixels (buildings populate it; cons.shp
  // leaves it empty). `shadowFrameIndex` gives the split; we probe the decoded
  // frames for any nonzero shadow pixel to distinguish populated vs. empty.
  const shadowBase = shadowFrameIndex(0, frames.length); // frameCount/2, or undefined (odd)
  let shadowPopulated = false;
  if (shadowBase !== undefined) {
    for (let i = shadowBase; i < frames.length; i++) {
      if (frames[i]!.pixels.length > 0) {
        // any shadow-half frame with a body -> populated (pixel index 1 in probes)
        let anyPix = false;
        for (const p of frames[i]!.pixels) {
          if (p !== 0) { anyPix = true; break; }
        }
        if (anyPix) { shadowPopulated = true; break; }
      }
    }
  }

  const result: ConvertedSprite = {
    name,
    frameCount: frames.length,
    spriteWidth: shp.cx,
    spriteHeight: shp.cy,
    atlasWidth: pack.width,
    atlasHeight: pack.height,
    colorRgba,
    frames: outFrames,
    ...(anyRemap ? { maskRgba } : {}),
    ...(shadowPopulated && shadowBase !== undefined ? { shadowFrameBase: shadowBase } : {}),
    ...(sequence ? { sequence } : {}),
  };
  return result;
}

/**
 * FIDELITY: retail vehicles (SMCV, HARV, HTNK) are VXL voxel models, not SHP
 * sprites. v1 does not render VXL (deferred to M7+). For those units the dev
 * server serves this procedurally-generated placeholder: a single-frame
 * colored-diamond sprite, `size x size`, whose fill is entirely remap-range so
 * the whole shape recolors to the owning player. The color plane uses a neutral
 * mid-gray; the mask marks every body pixel as full-ramp (255) so it tints
 * solidly to the house color.
 *
 * The shape is an isometric diamond (matching a unit's ground footprint) with a
 * 1px darker outline, drawn without any palette so it needs no game data.
 */
export function makeVehiclePlaceholder(name: string, size = 32): ConvertedSprite {
  const atlas = Math.max(1, size);
  const colorRgba = new Uint8Array(atlas * atlas * 4);
  const maskRgba = new Uint8Array(atlas * atlas * 4);
  const cx = (atlas - 1) / 2;
  const cy = (atlas - 1) / 2;
  const rx = atlas / 2 - 1;
  const ry = atlas / 4; // half-height: isometric 2:1 diamond

  for (let y = 0; y < atlas; y++) {
    for (let x = 0; x < atlas; x++) {
      // Diamond test: |dx|/rx + |dy|/ry <= 1.
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const inside = dx / rx + dy / ry <= 1;
      if (!inside) continue;
      const dst = (y * atlas + x) * 4;
      // Edge (outline) when near the boundary.
      const edge = dx / rx + dy / ry > 0.8;
      const shade = edge ? 90 : 170;
      colorRgba[dst] = shade;
      colorRgba[dst + 1] = shade;
      colorRgba[dst + 2] = shade;
      colorRgba[dst + 3] = 0xff;
      // Entire body is remap: interior full-ramp, edge darker ramp position.
      const ramp = edge ? 60 : 255;
      maskRgba[dst] = ramp;
      maskRgba[dst + 1] = ramp;
      maskRgba[dst + 2] = ramp;
      maskRgba[dst + 3] = 0xff;
    }
  }

  return {
    name,
    frameCount: 1,
    spriteWidth: atlas,
    spriteHeight: atlas,
    atlasWidth: atlas,
    atlasHeight: atlas,
    colorRgba,
    maskRgba,
    frames: [{ x: 0, y: 0, w: atlas, h: atlas, offsetX: 0, offsetY: 0 }],
    placeholder: true,
  };
}
