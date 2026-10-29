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
// A VXL section's voxels live on a grid (X right, Y forward/depth, Z up). The
// section TAILER carries a scale + a 3x4 transform; the HVA carries a per-frame
// 3x4 matrix. The retail pipeline is: for each voxel, take its grid-centre point,
// apply the section transform, apply the HVA frame matrix, then the model is
// oriented for the unit's facing by rotating about the vertical (Z) axis, and
// finally projected with the RA2 dimetric camera.
//
// We fold this into: worldPoint = HVA * (sectionTransform * (scale * gridPoint)),
// then rotate that point about Z by the facing angle, then project.
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

import type { Palette } from '../index.js';
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
 * (verified against retail htnk*.vxl: (maxBounds-minBounds)/c ≈ 0.98). The section
 * `scale` is a separate DISPLAY scale applied on top. So the correct way to place
 * two parts in one frame is by their bounds boxes, and a part's rotation pivot is
 * its bounds-box center. Pure — no game data needed.
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

/**
 * The turret's rotation PIVOT, expressed in the BODY's local render frame (the
 * same centered, `scale`-scaled space the body atlas is rendered in), as a 3D
 * vector (x right, y forward, z up). Derivation (documented, no rules needed):
 *
 *   * Retail HTNK has an EMPTY rules `TurretOffset=`, so the pivot is taken from
 *     the model transforms — specifically the parts' bounds boxes, which is where
 *     RA2 stores each part's placement in the shared world space.
 *   * The body atlas renders voxel `v` at `(v - (cBody-1)/2)*scaleBody`, i.e.
 *     centered on the body grid center and scaled by the body's display `scale`.
 *     That center corresponds to the body's BOUNDS center in world space.
 *   * A world (bounds-space) point `w` therefore maps into the body frame as
 *     `(w - bodyBoundsCenter) * (scaleBody / bodyStep)` where `bodyStep` is the
 *     body's bounds-units-per-grid-step — this converts the ~1.0/step bounds space
 *     into the body's `scale`/step display space so the pivot is in the SAME units
 *     as the body atlas geometry.
 *
 * The turret pivot is the turret bounds center mapped through that transform. The
 * render layer rotates this vector by the BODY facing (the pivot is fixed on the
 * hull) and projects it to place the turret quad; the vertical (z) component lifts
 * straight up on screen (turret sits atop the hull). Pure function.
 */
export function turretPivotInBodyFrame(body: VxlSection, turret: VxlSection): [number, number, number] {
  const bodyCenter = sectionBoundsCenter(body);
  const turretCenter = sectionBoundsCenter(turret);
  const bodyStep = sectionGridStep(body);
  // Convert bounds-space delta to the body's display frame. Use each axis' own
  // body step so a non-uniform grid maps correctly; guard tiny/zero steps.
  const conv = (i: number): number => {
    const step = Math.abs(bodyStep[i]!) > 1e-6 ? bodyStep[i]! : 1;
    return ((turretCenter[i]! - bodyCenter[i]!) / step) * body.scale;
  };
  return [conv(0), conv(1), conv(2)];
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

/** Compose 3x4 matrices a∘b (apply b first, then a), returning row-major 3x4. */
function composeMatrix(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? a[r * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      out[r * 4 + c] = s;
    }
  }
  return out;
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

/** Rotate a point about the Z (up) axis by `angle` radians. */
function rotateZ(x: number, y: number, z: number, angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
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
export function projectModelPoint(px: number, py: number, pz: number): { sx: number; sy: number; depth: number } {
  return {
    sx: (py - px) * PX_PER_UNIT_X,
    sy: -(px + py) * PX_PER_UNIT_Y - pz * PX_PER_UNIT_Z,
    depth: -(px + py) * PX_PER_UNIT_Y + pz * PX_PER_UNIT_Z,
  };
}

/**
 * Compute the per-voxel model scale so the model's XY footprint projects to about
 * {@link TARGET_FOOTPRINT_PX}. Derived from the section grid + tailer scale so all
 * three vehicles read at a consistent on-tile size regardless of grid resolution.
 */
export function deriveModelScale(sections: readonly VxlSection[], footprintPx = TARGET_FOOTPRINT_PX): number {
  // The world-space XY extent after the section scale: use the largest grid span.
  let maxSpan = 1;
  for (const s of sections) {
    const span = Math.max(s.cx, s.cy) * s.scale;
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
  /** On-screen body width in px (default TARGET_FOOTPRINT_PX). */
  readonly footprintPx?: number;
}

/**
 * Per-section local-frame origin: the grid coordinate subtracted from each voxel
 * before the tailer scale, so a section rotates about that point. Returns the grid
 * coordinate of the origin (grid units, pre-scale).
 */
type SectionOrigin = (section: VxlSection) => readonly [number, number, number];

/**
 * The DEFAULT origin used by the body atlas: the section grid center `(c-1)/2` on
 * every axis, so the model rotates about its own centre. Keeping this the default
 * makes the body render path byte-for-byte identical to before turret support.
 */
const GRID_CENTER_ORIGIN: SectionOrigin = (s) => [(s.cx - 1) / 2, (s.cy - 1) / 2, (s.cz - 1) / 2];

/**
 * Render every voxel of a facing into supersampled screen space, returning the
 * projected voxels plus the screen bounds. Pure geometry — no rasterization yet.
 *
 * `origin` selects the per-section grid point voxels are centered on before the
 * tailer scale + facing rotation (default: the grid center — the body path). The
 * turret path passes a shared origin so a multi-part model composites in one frame.
 */
function projectFacing(
  vxl: VxlFile,
  hva: HvaFile,
  facing: number,
  modelScale: number,
  ss: number,
  hvaFrame: number,
  origin: SectionOrigin = GRID_CENTER_ORIGIN,
): { voxels: ProjectedVoxel[]; minX: number; minY: number; maxX: number; maxY: number } {
  const angle = facingAngle(facing);
  const voxels: ProjectedVoxel[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let si = 0; si < vxl.sections.length; si++) {
    const section = vxl.sections[si]!;
    const table = normalTableFor(section.normalsMode);
    // Combined per-voxel transform: HVA(frame,section) ∘ sectionTransform, with
    // the section grid pre-scaled by the tailer scale and the model-fit scale.
    // HVA translations are in bounds units; RA2 scales them by the section scale like the voxels (CNCMaps' HVAMultiplier).
    const hvaM = (hva.sectionCount > si ? hva.matrix(si, hvaFrame) : IDENTITY_3X4).map((m, i) => (i % 4 === 3 ? m * section.scale : m));
    const combined = composeMatrix(hvaM, section.transform);
    // The grid point voxels are centered on (rotation pivot), grid units.
    const [halfX, halfY, halfZ] = origin(section);

    for (const v of section.voxels) {
      // Grid point -> local (centered, tailer-scaled) coords.
      const lx = (v.x - halfX) * section.scale;
      const ly = (v.y - halfY) * section.scale;
      const lz = (v.z - halfZ) * section.scale;
      // Section + HVA transform.
      const [wx, wy, wz] = transformPoint(combined, lx, ly, lz);
      // Facing rotation about Z, then model-fit scale.
      const [rx, ry, rz] = rotateZ(wx, wy, wz, angle);
      const px = rx * modelScale;
      const py = ry * modelScale;
      const pz = rz * modelScale;

      // Reflected dimetric projection (SS pixels; y grows downward on screen). See
      // projectModelPoint — model forward (+Y) at facing 0 lands UP-RIGHT (sim north).
      const proj = projectModelPoint(px, py, pz);
      const sx = proj.sx * ss;
      const sy = proj.sy * ss;
      const depth = proj.depth;

      // Lighting: rotate the normal the same way, dot with the light dir.
      const nRaw = lookupNormal(table, v.normal);
      const [ndx, ndy, ndz] = transformDir(combined, nRaw[0], nRaw[1], nRaw[2]);
      const [nx, ny, nz] = rotateZ(ndx, ndy, ndz, angle);
      const nlen = Math.hypot(nx, ny, nz) || 1;
      const dot = (nx * LIGHT_DIR[0] + ny * LIGHT_DIR[1] + nz * LIGHT_DIR[2]) / nlen;
      const light = Math.min(1, AMBIENT + DIFFUSE * Math.max(0, dot));

      voxels.push({ sx, sy, depth, color: v.color, light });
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
 * Rasterize one facing's projected voxels into a supersampled RGBA buffer with a
 * per-pixel z-buffer (nearest-to-camera wins), then box-downsample to the final
 * frame. Returns the frame plus its offset within the shared bounding box.
 *
 * Each voxel paints a 1x1 SS "splat" expanded to `ss x ss` so no gaps appear
 * between adjacent voxels at the supersample resolution.
 */
function rasterizeFacing(
  projected: ReturnType<typeof projectFacing>,
  palette: Palette,
  ss: number,
  sharedMinX: number,
  sharedMinY: number,
  ssWidth: number,
  ssHeight: number,
): RenderedFrame {
  const zbuf = new Float64Array(ssWidth * ssHeight).fill(-Infinity);
  const colorSS = new Uint8Array(ssWidth * ssHeight * 4);
  const maskSS = new Uint8Array(ssWidth * ssHeight * 4);
  let anyRemap = false;

  // Paint each voxel as an ss x ss splat so voxels tile without seams.
  for (const v of projected.voxels) {
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
        const c = palette.color(v.color);
        const off = i * 4;
        colorSS[off] = clamp255(c.r * v.light);
        colorSS[off + 1] = clamp255(c.g * v.light);
        colorSS[off + 2] = clamp255(c.b * v.light);
        colorSS[off + 3] = 0xff;
        if (isRemapIndex(v.color)) {
          anyRemap = true;
          // Lighting-scaled house-ramp position (see remapMaskValue): keeps team-color sections'
          // 3D directional shading after tinting instead of collapsing to one flat house color.
          const ramp = remapMaskValue(v.color, v.light);
          maskSS[off] = ramp;
          maskSS[off + 1] = ramp;
          maskSS[off + 2] = ramp;
          maskSS[off + 3] = 0xff;
        } else {
          maskSS[off + 3] = 0;
        }
      }
    }
  }

  // Box-downsample ss x ss -> 1 for both planes (alpha-weighted color average).
  const width = Math.ceil(ssWidth / ss);
  const height = Math.ceil(ssHeight / ss);
  const color = new Uint8Array(width * height * 4);
  const mask = new Uint8Array(width * height * 4);
  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let aCount = 0;
      let mr = 0;
      let mCount = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const sxp = ox * ss + dx;
          const syp = oy * ss + dy;
          if (sxp >= ssWidth || syp >= ssHeight) continue;
          const off = (syp * ssWidth + sxp) * 4;
          if (colorSS[off + 3]! > 0) {
            r += colorSS[off]!;
            g += colorSS[off + 1]!;
            b += colorSS[off + 2]!;
            aCount++;
          }
          if (maskSS[off + 3]! > 0) {
            mr += maskSS[off]!;
            mCount++;
          }
        }
      }
      const oOff = (oy * width + ox) * 4;
      const total = ss * ss;
      if (aCount > 0) {
        color[oOff] = Math.round(r / aCount);
        color[oOff + 1] = Math.round(g / aCount);
        color[oOff + 2] = Math.round(b / aCount);
        // Coverage-based alpha so edges anti-alias against the transparent void.
        color[oOff + 3] = Math.round((aCount / total) * 255);
      }
      if (mCount > 0) {
        const ramp = Math.round(mr / mCount);
        mask[oOff] = ramp;
        mask[oOff + 1] = ramp;
        mask[oOff + 2] = ramp;
        mask[oOff + 3] = Math.round((mCount / total) * 255);
      }
    }
  }

  return {
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    color,
    mask,
    anyRemap,
  };
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
 * Assemble a set of per-facing projections into a packed {@link ConvertedSprite}.
 * Shared by the body and turret paths: projects every facing (via `project`),
 * finds the shared bounds, rasterizes into one canvas, and packs like the SHP
 * pipeline. Deterministic — same inputs, byte-identical output. The body path's
 * output is unchanged because it passes the exact same `project` it always did.
 */
function assembleSprite(
  name: string,
  facingCount: number,
  ss: number,
  palette: Palette,
  project: (facing: number) => ReturnType<typeof projectFacing>,
): ConvertedSprite {
  // First pass: project every facing to find the SHARED screen bounds so all
  // frames use one bounding box (frames align on facing change).
  const projections = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let f = 0; f < facingCount; f++) {
    const p = project(f);
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

  // Second pass: rasterize each facing into the shared canvas.
  const rendered: RenderedFrame[] = projections.map((p) =>
    rasterizeFacing(p, palette, ss, minX, minY, ssWidth, ssHeight),
  );

  const frameW = rendered[0]?.width ?? 1;
  const frameH = rendered[0]?.height ?? 1;

  // Pack the facing frames into one atlas (same packer the SHP path uses).
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
    origin: [-minX / ss, -minY / ss],
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
  const facingCount = options.facingCount ?? FACING_COUNT;
  const ss = options.supersample ?? SUPERSAMPLE;
  const hvaFrame = options.hvaFrame ?? 0;
  const modelScale = deriveModelScale(vxl.sections, options.footprintPx);
  return assembleSprite(name, facingCount, ss, palette, (f) =>
    projectFacing(vxl, hva, f, modelScale, ss, hvaFrame),
  );
}

/** A prerendered turret: its 32-facing atlas plus the body-frame pivot to draw at. */
export interface TurretRender {
  /** The turret (+ barrel) atlas, 32 facings, centered on the turret pivot. */
  readonly sprite: ConvertedSprite;
  /**
   * The turret rotation pivot in the BODY's render frame (x right, y forward, z
   * up), same units/scale as the body atlas. The render layer rotates (x,y) by the
   * BODY facing and projects it (with z lifting straight up) to place the turret
   * quad over the hull. See {@link turretPivotInBodyFrame}.
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
 * and centers each part on the TURRET bounds center (mapped into the body frame) so
 * the atlas frames are centered on the pivot — the render layer then just offsets
 * by the projected pivot. Deterministic: same inputs, byte-identical output.
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
  const facingCount = options.facingCount ?? FACING_COUNT;
  const ss = options.supersample ?? SUPERSAMPLE;
  const hvaFrame = options.hvaFrame ?? 0;
  // Share the BODY's fit-scale so the turret composites at the body's on-tile size.
  const modelScale = deriveModelScale(bodyVxl.sections, options.footprintPx);

  const bodySec = bodyVxl.sections[0]!;
  const turretSec = turret.sections[0]!;
  // Pivot in the body render frame (world units), then scaled by the body's
  // model-fit scale so it is in the SAME pixel units as the atlas frames. The
  // render layer rotates (x,y) by the body facing and applies the dimetric
  // projection (screenX=(x-y)*PX_X, screenY=(x+y)*PX_Y - z*PX_Z) — see PIVOT_* below.
  const rawPivot = turretPivotInBodyFrame(bodySec, turretSec);
  const pivot: [number, number, number] = [
    rawPivot[0] * modelScale,
    rawPivot[1] * modelScale,
    rawPivot[2] * modelScale,
  ];

  // Convert a section's bounds-space point into the body's display frame, then to
  // the GRID coordinate the projector subtracts as the rotation origin. We want the
  // turret (and barrel) centered on the TURRET bounds center so the atlas rotates
  // about the pivot. For a section `s`, the grid origin that places its bounds
  // center at the shared pivot is: gridOrigin = (turretBoundsCenter - s.minBounds)/s.step.
  const turretCenter = sectionBoundsCenter(turretSec);
  const originForSharedCenter: SectionOrigin = (s) => {
    const step = sectionGridStep(s);
    return [
      (turretCenter[0]! - s.minBounds[0]!) / (Math.abs(step[0]!) > 1e-6 ? step[0]! : 1),
      (turretCenter[1]! - s.minBounds[1]!) / (Math.abs(step[1]!) > 1e-6 ? step[1]! : 1),
      (turretCenter[2]! - s.minBounds[2]!) / (Math.abs(step[2]!) > 1e-6 ? step[2]! : 1),
    ];
  };

  const sprite = assembleSprite(name, facingCount, ss, palette, (f) => {
    const t = projectFacing(turret, turretHva, f, modelScale, ss, hvaFrame, originForSharedCenter);
    if (!barrel) return t;
    const b = projectFacing(barrel, barrelHva ?? turretHva, f, modelScale, ss, hvaFrame, originForSharedCenter);
    // Composite barrel voxels into the turret's projection (shared z-buffer at
    // rasterization time), and widen the shared screen bounds to include both.
    return {
      voxels: t.voxels.concat(b.voxels),
      minX: Math.min(t.minX, b.minX),
      minY: Math.min(t.minY, b.minY),
      maxX: Math.max(t.maxX, b.maxX),
      maxY: Math.max(t.maxY, b.maxY),
    };
  });

  return { sprite, pivot };
}
