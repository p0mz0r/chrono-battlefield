// From openra2 apps/client/dev/voxelRender.ts @ 8ba59f0 (GPL-3.0-or-later); openra2's notice follows, changes since are ours.
// Software VXL voxel prerenderer for the dev asset server (pure, deterministic).
//
// Turns a parsed VxlFile + HvaFile + the theater unit palette into a 32-facing
// sprite atlas in the SAME shape (ConvertedSprite) the SHP pipeline emits, so the
// techno sprite route can serve real vehicle art instead of the colored-diamond
// placeholder. Everything here is integer/float math with no DOM or three.js — it
// runs in Node at asset-serve time and is unit-testable with synthetic voxels.
//
// COORDINATE SPACES
// -----------------
// A VXL section's voxels live on a grid (X right, Y forward/depth, Z up). RA2 sizes
// and places a section by its bounds: voxel `v`'s centre is `minBounds + (v+0.5)*step`
// (sectionGridStep, ~1.0), in bounds units shared by every part of a model. The
// HVA carries a per-frame 3x4 matrix whose translation, times the section's tailer
// `scale`, is in those bounds units too. The tailer's own 3x4 transform is a copy
// of HVA frame 0 (yaggun) or identity, so like OpenRA we ignore it.
//
// worldPoint = HVA * boundsPoint, minus the model's pivot, rotated about Z by the
// facing angle, times the model-fit scale (px per bounds unit), then projected.
//
// RA2 DIMETRIC PROJECTION
// -----------------------
// The terrain uses sx=(cx-cy)*30, sy=(cx+cy)*15 for a 60x30 tile (see
// @vanguard/render iso/transform.ts). Voxels use the SAME ground dimetric plus a
// vertical lift for Z (height rises straight up the screen):
//   screenX =  (px - py) * PX_PER_UNIT_X
//   screenY =  (px + py) * PX_PER_UNIT_Y  -  pz * PX_PER_UNIT_Z
// with a camera-depth key used for the z-buffer:
//   depth   =  (px + py) * ...            +  pz * ...     (closer-to-camera wins)
// The px/py/pz here are the world point AFTER the facing rotation. The per-unit
// pixel scales are derived so a ~60-voxel-long tank body reads at ~cell width on
// the 60x30 tile (see PX_PER_UNIT_* and deriveModelScale).
//
// LIGHTING
// --------
// Each voxel carries a surface-normal index into the section's normal table
// (@vanguard/formats normalTableFor). Brightness = ambient + diffuse *
// max(0, dot(rotatedNormal, lightDir)), with the light coming from the top-left
// (matching the XCC/CD look). The normal is rotated by the SAME facing rotation as
// the geometry so lighting turns with the model. The lit brightness scales the
// resolved palette RGB.
//
// TEAM COLOUR / REMAP
// -------------------
// Voxel colour indices in the unit-remap range (16..31) are the house-colour ramp,
// exactly like SHP art: the colour plane draws them with the neutral unit palette
// and a parallel MASK plane records the ramp position so the renderer tints per
// player at draw time. This reuses the ConvertedSprite contract unchanged.
//
// SUPERSAMPLING
// -------------
// We rasterize at SS x resolution (default 2) and box-downsample to the final
// frame for clean edges, matching the crisp look the quality bar demands.

import { Palette } from '../index.js';
import { REMAP_INDEX_START, REMAP_INDEX_END } from '../index.js';
import type { VxlFile, VxlSection, HvaFile, NormalVec } from '../index.js';
import { normalTableFor, lookupNormal } from '../index.js';
import { packAtlas, type PackInput } from './atlas.js';
import type { ConvertedSprite } from './sprite.js';
import { remapRampPosition } from './sprite.js';

/** Number of body facings to prerender (RA2 vehicles use 32). */
export const FACING_COUNT = 32;

/**
 * The bounds-space center of a VXL section: the midpoint of its `[minBounds,
 * maxBounds]` box. RA2 positions a model's parts (body / turret / barrel) in a
 * SHARED world space via those bounds — one voxel grid step is ~1.0 bounds unit
 * (verified against retail htnk*.vxl: (maxBounds-minBounds)/c ≈ 0.98). A vehicle's
 * part turns about its bounds-box center. Pure — no game data needed.
 */
export function sectionBoundsCenter(section: VxlSection): [number, number, number] {
  return [
    (section.minBounds[0] + section.maxBounds[0]) / 2,
    (section.minBounds[1] + section.maxBounds[1]) / 2,
    (section.minBounds[2] + section.maxBounds[2]) / 2,
  ];
}

/**
 * The per-grid-step size (bounds units) of a section along each axis:
 * `(maxBounds-minBounds)/c`. Maps a grid coordinate `v` to a bounds-space point
 * `minBounds + v*step`. ~1.0 for retail voxels; kept per-axis/per-section so a
 * non-cubic grid still composites exactly.
 */
export function sectionGridStep(section: VxlSection): [number, number, number] {
  return [
    (section.maxBounds[0] - section.minBounds[0]) / Math.max(1, section.cx),
    (section.maxBounds[1] - section.minBounds[1]) / Math.max(1, section.cy),
    (section.maxBounds[2] - section.minBounds[2]) / Math.max(1, section.cz),
  ];
}

/** Supersample factor: render at SS x, then box-downsample to the frame. */
const SUPERSAMPLE = 2;

// Dimetric pixel scales for the projected model point (in world units). These
// match the terrain's 60x30 tile: a unit of ground X/Y contributes (±X, +Y) at a
// 2:1 ratio; Z lifts straight up. The absolute magnitude is set by the model-fit
// scale (deriveModelScale) so these are the RATIOS the projection uses.
//
// PX_PER_UNIT_Z is deliberately > the ground half-step so a vehicle's HEIGHT reads
// as a substantial SIDE profile, not a flat roof: RA2's voxel camera is pitched
// (FinalAlert2 renders each facing with an X-axis pitch of 300°/-60° via rotate_zxy
// — MissionEditorPackLib.cpp RenderVXLSection, orig. Olaf van der Spek's XCC voxel
// code), so the vertical axis contributes ~cos(pitch) of a full model-length to the
// screen rise while the ground plane foreshortens. We fold that pitch's vertical
// emphasis into PX_PER_UNIT_Z (~1.7× the ground Y half-step) inside the dimetric
// family the turret-pivot math shares, so hull height shows and the top foreshortens.
export const PX_PER_UNIT_X = 1; // horizontal spread of the ground plane
export const PX_PER_UNIT_Y = 0.5; // vertical component of the ground plane (2:1 iso)
export const PX_PER_UNIT_Z = 1.7; // screen rise per world Z unit (RA2 voxel camera pitch)

/**
 * gamemd's own voxel camera (CNCMaps VxlRenderer @56712d7: RotX(60)·RotZ(-45), one
 * bounds unit per pixel): a ground unit spans √½ px across and √⅛ down, a height
 * unit √¾ up. For voxels drawn beside SHP art at its true size (building turrets).
 */
export const GAMEMD_CAMERA = { modelScale: Math.SQRT1_2, pxPerUnitZ: Math.sqrt(1.5) } as const;

/** Target on-screen footprint: a vehicle body should read ~this wide (px). */
export const TARGET_FOOTPRINT_PX = 54;

/** Lighting: ambient floor and diffuse gain (ambient + diffuse <= ~1). */
const AMBIENT = 0.45;
const DIFFUSE = 0.75;

/**
 * Light direction, from the TOP-LEFT and slightly toward the camera, in the SAME
 * post-rotation world space the normals live in (X right, Y forward, Z up).
 * Normalized. Top-left + above: -X (left), -Y (toward camera/front), +Z (above).
 */
const LIGHT_DIR: NormalVec = normalizeVec([-0.5, -0.5, 0.7]);

/** True if a palette index is in the player-remap ramp (16..31). */
function isRemapIndex(index: number): boolean {
  return index >= REMAP_INDEX_START && index <= REMAP_INDEX_END;
}

/** A rotated, projected, lit voxel ready for the painter/z-buffer. */
interface ProjectedVoxel {
  /** Supersampled screen X (float, offset applied later). */
  sx: number;
  /** Supersampled screen Y (float). */
  sy: number;
  /** Camera depth key; larger = nearer the camera (drawn on top). */
  depth: number;
  /** Palette colour index (0..255). */
  color: number;
  /** Lighting multiplier in [0,1]. */
  light: number;
}

/** Multiply a 3x4 row-major matrix by a point (x,y,z,1) -> (x',y',z'). */
function transformPoint(m: readonly number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
    m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
    m[8]! * x + m[9]! * y + m[10]! * z + m[11]!,
  ];
}

/** Multiply a 3x4 matrix's rotation part (ignore translation) by a direction. */
function transformDir(m: readonly number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[1]! * y + m[2]! * z,
    m[4]! * x + m[5]! * y + m[6]! * z,
    m[8]! * x + m[9]! * y + m[10]! * z,
  ];
}

/** Normalize a 3-vector (returns [0,1,0] for a zero vector). */
function normalizeVec(v: readonly [number, number, number]): NormalVec {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Facing -> rotation angle about the vertical (Z) axis, in radians. Facing 0 is
 * the sim's NORTH (away from camera); increasing facing turns CLOCKWISE (matching
 * @vanguard/sim BAM winding and the render facing.ts contract). We rotate the
 * model so its "front" (model +Y forward) points along the facing.
 */
export function facingAngle(facing: number): number {
  return (facing / FACING_COUNT) * 2 * Math.PI;
}

/**
 * Uphill direction in cell (x, y) of tilts 1–8: ramp types 1–4 straight, then the corners. Types 5–8, 9–12 and 13–16
 * each rise along the same 4 diagonals (docs/research/ra2-height-level-drawing.md §1), so they share a tilt.
 */
const UPHILL: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

/** Tilts prerendered: flat (0) and one per uphill direction. */
export const TILTS = 1 + UPHILL.length;

/** The tilt drawn on TMP ramp type `ramp`: 0 flat (types 0 and 17–20), 1–8 an uphill direction. */
export const tiltOf = (ramp: number) => (ramp >= 1 && ramp <= 4 ? ramp : ramp >= 5 && ramp <= 16 ? (ramp - 5) % 4 + 5 : 0);

/**
 * The owner's Phobos client tilts a voxel by the ground's own slope, atan(104/256) ≈ 22.1° (vanilla: ≈ 29°), which in
 * gamemd's camera lies along the drawn ramp: one level (15 px) up per cell (30 px across). Our camera lifts height
 * PX_PER_UNIT_Z, more than gamemd's, so the same lie along the ramp takes atan(15/30 / PX_PER_UNIT_Z) ≈ 16.4°.
 */
const TILT = Math.atan((15 / 30) * PX_PER_UNIT_X / PX_PER_UNIT_Z), TILT_COS = Math.cos(TILT), TILT_SIN = Math.sin(TILT);

/**
 * Tilts a post-facing model point (x right, y forward, z up) by `tilt` (see {@link tiltOf}): a rotation by the ramp's
 * slope that turns up toward the ground's normal, so the uphill side rises. Tilt 0 returns it as is.
 */
export function rampTilt(tilt: number, x: number, y: number, z: number): [number, number, number] {
  const up = UPHILL[tilt - 1];
  if (!up) return [x, y, z];
  // Cell +x and +y are model −x and −y (projectModelPoint), so the normal leans along the cell's uphill direction.
  const n = Math.hypot(up[0], up[1]), kx = -up[1] / n, ky = up[0] / n; // rotation axis: up × normal
  const c = TILT_COS, s = TILT_SIN, dot = (kx * x + ky * y) * (1 - c);
  // Rodrigues: v cos θ + (k × v) sin θ + k (k · v)(1 − cos θ), with k in the ground plane.
  return [x * c + ky * z * s + kx * dot, y * c - kx * z * s + ky * dot, z * c + (kx * y - ky * x) * s];
}

/** Rotate a point about the Z (up) axis by the angle with cosine `c` and sine `s`. */
function rotateZ(x: number, y: number, z: number, c: number, s: number): [number, number, number] {
  return [x * c - y * s, x * s + y * c, z];
}

/**
 * Project a post-rotation model point (x right, y forward, z up) into the reflected
 * dimetric screen space the atlas is baked in. Returns unscaled, unsupersampled
 * `{ sx, sy, depth }` (sy grows DOWN; depth larger = nearer camera / drawn on top).
 *
 * The reflection: model forward (+Y) at facing 0 (sim north) must project UP-RIGHT,
 * because sim north moves toward smaller cellY which the terrain map (cellToScreen)
 * sends up-right. Naive screenX=(x-y) sends +Y down-left — a 180° point reflection —
 * so BOTH axes are negated. Z uses the RA2 voxel-camera pitch (PX_PER_UNIT_Z). Pure;
 * the ONE place the projection direction lives, so a single test pins Fix 1.
 */
export function projectModelPoint(px: number, py: number, pz: number, pxPerUnitZ = PX_PER_UNIT_Z): { sx: number; sy: number; depth: number } {
  return {
    sx: (py - px) * PX_PER_UNIT_X,
    sy: -(px + py) * PX_PER_UNIT_Y - pz * pxPerUnitZ,
    depth: -(px + py) * PX_PER_UNIT_Y + pz * pxPerUnitZ,
  };
}

/**
 * Compute the model scale (px per bounds unit) so the model's XY footprint projects
 * to about {@link TARGET_FOOTPRINT_PX}. Measured from the bounds, the size RA2
 * draws, so all vehicles read at a consistent on-tile size whatever their grid.
 */
export function deriveModelScale(sections: readonly VxlSection[], footprintPx = TARGET_FOOTPRINT_PX): number {
  // The largest XY bounds span of any section.
  let maxSpan = 1;
  for (const s of sections) {
    const span = Math.max(s.maxBounds[0] - s.minBounds[0], s.maxBounds[1] - s.minBounds[1]);
    if (span > maxSpan) maxSpan = span;
  }
  // The projected ground width of `maxSpan` world units is maxSpan*PX_PER_UNIT_X*2
  // at worst diagonal; fit that to the target footprint.
  return footprintPx / (maxSpan * PX_PER_UNIT_X * 2);
}

/** One prerendered facing frame: RGBA color + optional remap mask + its size. */
interface RenderedFrame {
  width: number;
  height: number;
  /** Frame's top-left offset within the shared sprite bounding box. */
  offsetX: number;
  offsetY: number;
  color: Uint8Array; // width*height*4
  mask: Uint8Array; // width*height*4
  anyRemap: boolean;
}

/** Options controlling the prerender (mostly for tests). */
export interface VoxelRenderOptions {
  /** Number of facings (default 32). */
  readonly facingCount?: number;
  /** Supersample factor (default 2). */
  readonly supersample?: number;
  /** HVA frame index to pose (default 0). */
  readonly hvaFrame?: number;
  /** Tilts to prerender, 0 up to this (default 1, flat only; {@link TILTS} for all): frame `tilt × facingCount + facing`. */
  readonly tilts?: number;
  /** On-screen body width in px (default TARGET_FOOTPRINT_PX). */
  readonly footprintPx?: number;
  /** Px per bounds unit, in place of fitting `footprintPx` (see GAMEMD_CAMERA). */
  readonly modelScale?: number;
  /** Screen rise per height unit, relative to the ground step (default PX_PER_UNIT_Z). */
  readonly pxPerUnitZ?: number;
  /**
   * The bounds-space point the model turns about and the sprite's `origin` marks
   * (default: the bounds center of the model's first section, or of the turret).
   * Buildings pass RA2's pivot `[0, 0, 0]`.
   */
  readonly pivot?: readonly [number, number, number];
}

/**
 * Render every voxel of a facing into supersampled screen space, returning the
 * projected voxels plus the screen bounds. Pure geometry — no rasterization yet.
 *
 * Every section is placed in bounds units and turned about the shared bounds-space
 * `pivot`, so a multi-part model (or turret + barrel) composites in one frame.
 */
function projectFacing(
  vxl: VxlFile,
  hva: HvaFile,
  facing: number,
  modelScale: number,
  ss: number,
  hvaFrame: number,
  pivot: readonly [number, number, number],
  pxPerUnitZ = PX_PER_UNIT_Z,
  tilt = 0,
  shadow = false,
): { voxels: ProjectedVoxel[]; minX: number; minY: number; maxX: number; maxY: number } {
  const cos = Math.cos(facingAngle(facing)), sin = Math.sin(facingAngle(facing));
  const voxels: ProjectedVoxel[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let si = 0; si < vxl.sections.length; si++) {
    if (shadow && si !== 0) continue; // art ShadowIndex: 0 for every tank drawn here
    const section = vxl.sections[si]!;
    const table = normalTableFor(section.normalsMode);
    // HVA(frame, section) with its translation times the tailer scale and the grid
    // step, in bounds units (CNCMaps' HVAMultiplier * ScaleX), and the pivot taken off
    // so the model turns about it.
    const step = sectionGridStep(section);
    const combined = (hva.sectionCount > si ? hva.matrix(si, hvaFrame) : IDENTITY_3X4)
      .map((m, i) => (i % 4 === 3 ? m * section.scale * step[i >> 2]! - pivot[i >> 2]! : m));
    const [minX0, minY0, minZ0] = section.minBounds;

    for (const v of section.voxels) {
      // Grid voxel -> its centre in bounds units, then the HVA transform.
      const [wx, wy, z] = transformPoint(combined,
        minX0 + (v.x + 0.5) * step[0], minY0 + (v.y + 0.5) * step[1], minZ0 + (v.z + 0.5) * step[2]);
      // A shadow voxel drops straight down onto the ground, bounds z 0, before the ramp tilts it.
      const wz = shadow ? -pivot[2] : z;
      // Facing rotation about Z, then model-fit scale.
      const [rx, ry, rz] = rampTilt(tilt, ...rotateZ(wx, wy, wz, cos, sin));
      const px = rx * modelScale;
      const py = ry * modelScale;
      const pz = rz * modelScale;

      // Reflected dimetric projection (SS pixels; y grows downward on screen). See
      // projectModelPoint — model forward (+Y) at facing 0 lands UP-RIGHT (sim north).
      const proj = projectModelPoint(px, py, pz, pxPerUnitZ);
      const sx = proj.sx * ss;
      const sy = proj.sy * ss;
      const depth = proj.depth;

      // Lighting: rotate the normal the same way, dot with the light dir.
      const nRaw = lookupNormal(table, v.normal);
      const [ndx, ndy, ndz] = transformDir(combined, nRaw[0], nRaw[1], nRaw[2]);
      const [nx, ny, nz] = rampTilt(tilt, ...rotateZ(ndx, ndy, ndz, cos, sin));
      const nlen = Math.hypot(nx, ny, nz) || 1;
      const dot = (nx * LIGHT_DIR[0] + ny * LIGHT_DIR[1] + nz * LIGHT_DIR[2]) / nlen;
      const light = Math.min(1, AMBIENT + DIFFUSE * Math.max(0, dot));

      voxels.push(shadow ? { sx, sy, depth, color: 0, light: 1 } : { sx, sy, depth, color: v.color, light });
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
  }

  return { voxels, minX, minY, maxX, maxY };
}

const IDENTITY_3X4: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/**
 * Rasterize one facing's projected voxels with a per-pixel z-buffer (nearest-to-camera
 * wins) at the supersample resolution, then box-downsample to the final frame, once per
 * palette: the z-buffer and the remap mask don't depend on the palette, so they are
 * worked out once and shared.
 *
 * Each voxel paints a 1x1 SS "splat" expanded to `ss x ss` so no gaps appear
 * between adjacent voxels at the supersample resolution.
 */
function rasterizeFacing(
  projected: ReturnType<typeof projectFacing>,
  palettes: readonly Palette[],
  ss: number,
  sharedMinX: number,
  sharedMinY: number,
  ssWidth: number,
  ssHeight: number,
): RenderedFrame[] {
  const zbuf = new Float64Array(ssWidth * ssHeight).fill(-Infinity);
  // The voxel that wins each SS pixel, or -1.
  const winner = new Int32Array(ssWidth * ssHeight).fill(-1);
  const { voxels } = projected;

  // Paint each voxel as an ss x ss splat so voxels tile without seams.
  for (let vi = 0; vi < voxels.length; vi++) {
    const v = voxels[vi]!;
    const baseX = Math.round(v.sx - sharedMinX);
    const baseY = Math.round(v.sy - sharedMinY);
    for (let dy = 0; dy < ss; dy++) {
      for (let dx = 0; dx < ss; dx++) {
        const x = baseX + dx;
        const y = baseY + dy;
        if (x < 0 || x >= ssWidth || y < 0 || y >= ssHeight) continue;
        const i = y * ssWidth + x;
        if (v.depth <= zbuf[i]!) continue;
        zbuf[i] = v.depth;
        winner[i] = vi;
      }
    }
  }

  // Box-downsample ss x ss -> 1 (alpha-weighted color average); the mask plane once,
  // the color plane per palette.
  const width = Math.ceil(ssWidth / ss);
  const height = Math.ceil(ssHeight / ss);
  const total = ss * ss;
  const mask = new Uint8Array(width * height * 4);
  const colors = palettes.map(() => new Uint8Array(width * height * 4));
  const sums = new Float64Array(palettes.length * 3);
  let anyRemap = false;
  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) {
      sums.fill(0);
      let aCount = 0;
      let mr = 0;
      let mCount = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const sxp = ox * ss + dx;
          const syp = oy * ss + dy;
          if (sxp >= ssWidth || syp >= ssHeight) continue;
          const vi = winner[syp * ssWidth + sxp]!;
          if (vi < 0) continue;
          const v = voxels[vi]!;
          aCount++;
          for (let k = 0; k < palettes.length; k++) {
            const c = palettes[k]!.color(v.color);
            sums[k * 3]! += clamp255(c.r * v.light);
            sums[k * 3 + 1]! += clamp255(c.g * v.light);
            sums[k * 3 + 2]! += clamp255(c.b * v.light);
          }
          if (isRemapIndex(v.color)) {
            // Lighting-scaled house-ramp position (see remapMaskValue): keeps team-color sections'
            // 3D directional shading after tinting instead of collapsing to one flat house color.
            mr += remapMaskValue(v.color, v.light);
            mCount++;
          }
        }
      }
      const oOff = (oy * width + ox) * 4;
      if (aCount > 0) {
        for (let k = 0; k < palettes.length; k++) {
          const color = colors[k]!;
          color[oOff] = Math.round(sums[k * 3]! / aCount);
          color[oOff + 1] = Math.round(sums[k * 3 + 1]! / aCount);
          color[oOff + 2] = Math.round(sums[k * 3 + 2]! / aCount);
          // Coverage-based alpha so edges anti-alias against the transparent void.
          color[oOff + 3] = Math.round((aCount / total) * 255);
        }
      }
      if (mCount > 0) {
        anyRemap = true;
        const ramp = Math.round(mr / mCount);
        mask[oOff] = ramp;
        mask[oOff + 1] = ramp;
        mask[oOff + 2] = ramp;
        mask[oOff + 3] = Math.round((mCount / total) * 255);
      }
    }
  }

  return colors.map((color) => ({ width, height, offsetX: 0, offsetY: 0, color, mask, anyRemap }));
}

/** Clamp a float channel value to a 0..255 byte. */
function clamp255(v: number): number {
  const n = Math.round(v);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/**
 * The remap MASK byte for a palette index at a given per-facet lighting: the index's position on
 * the house dark->light ramp (remapRampPosition), SCALED by `light` so team-color sections keep
 * their 3D directional shading after tinting (textures.ts rampLerp). At `light === 1` this is the
 * bare base ramp; a shadowed facet (light < 1) yields a STRICTLY SMALLER byte than a lit one of the
 * SAME index — without the `* light` scaling every remap voxel of an index would collapse to one
 * flat house color (unlit blobs against the shaded body). Mirrors the color plane's `c * light`.
 * Pure — exported so the shading is unit-tested without a render surface.
 */
export function remapMaskValue(index: number, light: number): number {
  return clamp255(remapRampPosition(index) * light);
}

/**
 * Assemble a set of per-facing projections into a packed {@link ConvertedSprite} per palette.
 * Shared by the body and turret paths: projects every facing of every tilt (via
 * `project`), finds the shared bounds, rasterizes into one canvas, and packs like
 * the SHP pipeline. Deterministic — same inputs, byte-identical output.
 */
function assembleSprites(
  name: string,
  facingCount: number,
  ss: number,
  palettes: readonly Palette[],
  project: (facing: number, tilt: number) => ReturnType<typeof projectFacing>,
  tilts = 1,
): ConvertedSprite[] {
  // First pass: project every facing to find the SHARED screen bounds so all
  // frames use one bounding box (frames align on facing change).
  const projections = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let f = 0; f < facingCount * tilts; f++) {
    const p = project(f % facingCount, Math.floor(f / facingCount));
    projections.push(p);
    if (p.voxels.length > 0) {
      if (p.minX < minX) minX = p.minX;
      if (p.minY < minY) minY = p.minY;
      if (p.maxX > maxX) maxX = p.maxX;
      if (p.maxY > maxY) maxY = p.maxY;
    }
  }
  if (!Number.isFinite(minX)) {
    // No voxels at all — should not happen for real art; return a 1x1 empty.
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  // Supersampled shared canvas size (+1 slack for the splat width and rounding).
  const ssWidth = Math.max(1, Math.ceil(maxX - minX) + ss + 1);
  const ssHeight = Math.max(1, Math.ceil(maxY - minY) + ss + 1);

  // Second pass: rasterize each facing into the shared canvas, per palette.
  const perFrame = projections.map((p) => rasterizeFacing(p, palettes, ss, minX, minY, ssWidth, ssHeight));
  return palettes.map((_, k) => packSprite(name, perFrame.map((r) => r[k]!), [-minX / ss, -minY / ss]));
}

/** Pack rendered frames into one atlas (same packer the SHP path uses), `origin` marking the pivot. */
function packSprite(name: string, rendered: readonly RenderedFrame[], origin: [number, number]): ConvertedSprite {
  const frameW = rendered[0]?.width ?? 1;
  const frameH = rendered[0]?.height ?? 1;

  const inputs: PackInput[] = rendered.map((r) => ({ w: r.width, h: r.height }));
  const pack = packAtlas(inputs, 1);

  const atlasPixels = pack.width * pack.height;
  const colorRgba = new Uint8Array(atlasPixels * 4);
  const maskRgba = new Uint8Array(atlasPixels * 4);
  let anyRemap = false;

  const frames: ConvertedSprite['frames'] = rendered.map((r, i) => {
    const rect = pack.rects[i]!;
    if (r.anyRemap) anyRemap = true;
    for (let py = 0; py < r.height; py++) {
      for (let px = 0; px < r.width; px++) {
        const src = (py * r.width + px) * 4;
        const ax = rect.x + px;
        const ay = rect.y + py;
        const dst = (ay * pack.width + ax) * 4;
        colorRgba[dst] = r.color[src]!;
        colorRgba[dst + 1] = r.color[src + 1]!;
        colorRgba[dst + 2] = r.color[src + 2]!;
        colorRgba[dst + 3] = r.color[src + 3]!;
        maskRgba[dst] = r.mask[src]!;
        maskRgba[dst + 1] = r.mask[src + 1]!;
        maskRgba[dst + 2] = r.mask[src + 2]!;
        maskRgba[dst + 3] = r.mask[src + 3]!;
      }
    }
    return { x: rect.x, y: rect.y, w: r.width, h: r.height, offsetX: 0, offsetY: 0 };
  });

  const result: ConvertedSprite = {
    name,
    frameCount: rendered.length,
    spriteWidth: frameW,
    spriteHeight: frameH,
    atlasWidth: pack.width,
    atlasHeight: pack.height,
    colorRgba,
    frames,
    origin,
    ...(anyRemap ? { maskRgba } : {}),
  };
  return result;
}

/**
 * Prerender a VXL+HVA into a 32-facing {@link ConvertedSprite}. All facings share
 * one bounding box (so the frames align when the renderer swaps facing frames),
 * and the atlas packs them like any SHP-derived sprite. Deterministic: the same
 * inputs yield byte-identical output.
 */
export function renderVoxelToSprite(
  name: string,
  vxl: VxlFile,
  hva: HvaFile,
  palette: Palette,
  options: VoxelRenderOptions = {},
): ConvertedSprite {
  return renderVoxelToSprites(name, vxl, hva, [palette], options)[0]!;
}

/** {@link renderVoxelToSprite} in each of `palettes`, projecting the model once. */
export function renderVoxelToSprites(
  name: string,
  vxl: VxlFile,
  hva: HvaFile,
  palettes: readonly Palette[],
  options: VoxelRenderOptions = {},
): ConvertedSprite[] {
  const facingCount = options.facingCount ?? FACING_COUNT;
  const ss = options.supersample ?? SUPERSAMPLE;
  const hvaFrame = options.hvaFrame ?? 0;
  const modelScale = options.modelScale ?? deriveModelScale(vxl.sections, options.footprintPx);
  const pivot = options.pivot ?? sectionBoundsCenter(vxl.sections[0]!);
  return assembleSprites(name, facingCount, ss, palettes, (f, tilt) =>
    projectFacing(vxl, hva, f, modelScale, ss, hvaFrame, pivot, options.pxPerUnitZ, tilt), options.tilts);
}

const BLACK = Palette.fromRgb(new Uint8Array(768));

/**
 * The ground shadow of section 0 (art `ShadowIndex`, which no tank here sets), laid out like
 * {@link renderVoxelToSprite}: the section flattened onto the ground (bounds z 0) under each
 * facing, then tilted with the ramp, as RA2's `DrawVoxelShadow` does. Opaque black: the render
 * layer draws it translucent under the hull, its `origin` on the hull's.
 */
export function renderVoxelShadowToSprite(
  name: string,
  vxl: VxlFile,
  hva: HvaFile,
  options: VoxelRenderOptions = {},
): ConvertedSprite {
  const facingCount = options.facingCount ?? FACING_COUNT;
  const ss = options.supersample ?? SUPERSAMPLE;
  const modelScale = options.modelScale ?? deriveModelScale(vxl.sections, options.footprintPx);
  const pivot = options.pivot ?? sectionBoundsCenter(vxl.sections[0]!);
  return assembleSprites(name, facingCount, ss, [BLACK], (f, tilt) =>
    projectFacing(vxl, hva, f, modelScale, ss, options.hvaFrame ?? 0, pivot, options.pxPerUnitZ, tilt, true), options.tilts)[0]!;
}

/** A prerendered turret: its 32-facing atlas plus the body-frame pivot to draw at. */
export interface TurretRender {
  /** The turret (+ barrel) atlas, 32 facings, centered on the turret pivot. */
  readonly sprite: ConvertedSprite;
  /**
   * The turret rotation pivot in the BODY's render frame (x right, y forward, z
   * up), in px like the body atlas: its offset from the body's bounds center. The
   * render layer rotates (x,y) by the BODY facing and projects it (with z lifting
   * straight up) to place the turret quad over the hull.
   */
  readonly pivot: readonly [number, number, number];
}

/**
 * Prerender a turreted vehicle's TURRET (and barrel, if present) into a 32-facing
 * atlas rotating about the turret pivot, plus the pivot offset for compositing.
 *
 * `bodyVxl` is the body model (needed to derive the shared frame + pivot); `turret`
 * is the turret VXL and `turretHva` its HVA. `barrel`/`barrelHva`, when present,
 * are composited into the SAME atlas at the SAME scale/frame so the gun reads as
 * one turret assembly. Every facing is rendered by rotating the turret+barrel about
 * the turret pivot by the facing angle — so frame `i` is the turret aimed at sim
 * facing `i*(360/32)`, matching the 32-facing body layout.
 *
 * Uses the BODY's `modelScale` so body and turret composite at one on-tile size,
 * and turns every part about the TURRET bounds center (or `options.pivot`) so the
 * atlas frames are centered on the pivot — the render layer then just offsets by
 * the projected pivot. Deterministic: same inputs, byte-identical output.
 */
export function renderTurretToSprite(
  name: string,
  bodyVxl: VxlFile,
  turret: VxlFile,
  turretHva: HvaFile,
  palette: Palette,
  barrel?: VxlFile,
  barrelHva?: HvaFile,
  options: VoxelRenderOptions = {},
): TurretRender {
  const { sprites: [sprite], pivot } = renderTurretToSprites(name, bodyVxl, turret, turretHva, [palette], barrel, barrelHva, options);
  return { sprite: sprite!, pivot };
}

/** {@link renderTurretToSprite} in each of `palettes`, projecting the model once. */
export function renderTurretToSprites(
  name: string,
  bodyVxl: VxlFile,
  turret: VxlFile,
  turretHva: HvaFile,
  palettes: readonly Palette[],
  barrel?: VxlFile,
  barrelHva?: HvaFile,
  options: VoxelRenderOptions = {},
): { sprites: ConvertedSprite[]; pivot: readonly [number, number, number] } {
  const facingCount = options.facingCount ?? FACING_COUNT;
  const ss = options.supersample ?? SUPERSAMPLE;
  const hvaFrame = options.hvaFrame ?? 0;
  // Share the BODY's fit-scale so the turret composites at the body's on-tile size.
  const modelScale = options.modelScale ?? deriveModelScale(bodyVxl.sections, options.footprintPx);

  // Turret and barrel turn about the turret's bounds center (or options.pivot); the
  // render layer places it by its offset from the body's bounds center, in px.
  const turretPivot = options.pivot ?? sectionBoundsCenter(turret.sections[0]!);
  const bodyCenter = sectionBoundsCenter(bodyVxl.sections[0]!);
  const pivot = turretPivot.map((p, i) => (p - bodyCenter[i]!) * modelScale) as [number, number, number];

  const sprites = assembleSprites(name, facingCount, ss, palettes, (f, tilt) => {
    const t = projectFacing(turret, turretHva, f, modelScale, ss, hvaFrame, turretPivot, options.pxPerUnitZ, tilt);
    if (!barrel) return t;
    const b = projectFacing(barrel, barrelHva ?? turretHva, f, modelScale, ss, hvaFrame, turretPivot, options.pxPerUnitZ, tilt);
    // Composite barrel voxels into the turret's projection (shared z-buffer at
    // rasterization time), and widen the shared screen bounds to include both.
    return {
      voxels: t.voxels.concat(b.voxels),
      minX: Math.min(t.minX, b.minX),
      minY: Math.min(t.minY, b.minY),
      maxX: Math.max(t.maxX, b.maxX),
      maxY: Math.max(t.maxY, b.maxY),
    };
  }, options.tilts);

  return { sprites, pivot };
}
