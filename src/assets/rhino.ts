import { remapped } from '../battlefield/objects.js';
import { HvaFile, IniFile, Palette, REMAP_INDEX_START, ShpFile, VxlFile, type Vfs } from '../ra2/index.js';
import { renderTurretToSprite, renderVoxelToSprite, type TurretRender } from '../ra2/render/voxelRender.js';
import { convertShpToAtlas, type ConvertedSprite } from '../ra2/render/sprite.js';
import { theaterArtExt } from '../ra2/theater.js';

/** On-screen Rhino hull width in px: the one size knob (ADR 0002). */
export const RHINO_FOOTPRINT_PX = 54;
/** On-screen V3 rocket / Dreadnought missile length in px (eyeballed). */
export const ROCKET_FOOTPRINT_PX = 30;
/** On-screen Kirov airship and Kirov bomb length in px (eyeballed). */
export const KIROV_FOOTPRINT_PX = 140, BOMB_FOOTPRINT_PX = 16;

export interface RhinoArt {
  /** 32 hull facings, frame i = facing i × 360°/32 clockwise from north (-y). */
  body: ConvertedSprite;
  /** 32 turret (+ barrel) facings and the turret pivot in the hull's frame. */
  turret: TurretRender;
}

type Files = Pick<Vfs, 'openFile'>;

function reader(vfs: Files, theater: string) {
  const open = (name: string) => {
    const bytes = vfs.openFile(name);
    if (!bytes) throw new Error(`Missing install file: ${name}`);
    return bytes;
  };
  return {
    has: (n: string) => !!vfs.openFile(`${n}.vxl`) && !!vfs.openFile(`${n}.hva`),
    vxl: (n: string) => VxlFile.parse(open(`${n}.vxl`)),
    hva: (n: string) => HvaFile.parse(open(`${n}.hva`)),
    pal: () => Palette.parse(open(`unit${theaterArtExt(theater.toLowerCase())}.pal`)),
    open,
  };
}

/**
 * Prerenders `<unit>`, `<unit>tur` and (when present) `<unit>barl` with the theater's unit palette, its remap ramp
 * in `palette` when given. Pure, no DOM.
 */
export function prerenderTank(vfs: Files, theater: string, unit: string, footprintPx = RHINO_FOOTPRINT_PX, palette = reader(vfs, theater).pal()): RhinoArt {
  const { has, vxl, hva } = reader(vfs, theater);
  const hull = vxl(unit), barrel = has(`${unit}barl`);
  return {
    body: renderVoxelToSprite(unit, hull, hva(unit), palette, { footprintPx }),
    turret: renderTurretToSprite(`${unit}tur`, hull, vxl(`${unit}tur`), hva(`${unit}tur`), palette,
      barrel ? vxl(`${unit}barl`) : undefined, barrel ? hva(`${unit}barl`) : undefined, { footprintPx }),
  };
}

/**
 * The rulesmd `[Colors]` entries tanks race in, one per tank in join order, no two alike (`NeonGreen` is black, 0,0,0).
 * The greys are left out, as they vanish into the hull, and orange, as it reads as the stun tint. Bots fill every race to
 * 8, so the first 8 are in every race; cyan and green come last, as the shield ring and the boost tint come close to them,
 * though those cover the whole tank and the house colour only its panels.
 */
export const HOUSE_COLOURS = ['DarkRed', 'DarkBlue', 'Yellow', 'Purple', 'Magenta', 'NeonGreen', 'Red', 'Purple2', 'DarkSky', 'Green'];

/** A Rhino per house colour, in `HOUSE_COLOURS` order, each with its colour's brightest shade as 0xRRGGBB for the labels. */
export function prerenderRhinos(vfs: Files, theater: string, footprintPx = RHINO_FOOTPRINT_PX): (RhinoArt & { rgb: number })[] {
  const { open, pal } = reader(vfs, theater);
  const colors = IniFile.parse(open('rulesmd.ini')).getSection('Colors'), unitRgb = pal().rgb;
  return HOUSE_COLOURS.map((name) => {
    const hsv = colors?.getString(name);
    if (!hsv) throw new Error(`Missing install data: rulesmd.ini [Colors] ${name}`);
    const rgb = remapped(unitRgb, hsv.split(',').map(Number));
    // The ramp's first index is its brightest shade.
    return { ...prerenderTank(vfs, theater, 'htnk', footprintPx, Palette.fromRgb(rgb)), rgb: rgb[REMAP_INDEX_START * 3]! << 16 | rgb[REMAP_INDEX_START * 3 + 1]! << 8 | rgb[REMAP_INDEX_START * 3 + 2]! };
  });
}

/** 32 facings of the V3 rocket (`v3rocket`) or the Dreadnought missile (`dmisl`); each falls back to the other when missing. */
export function prerenderRocket(vfs: Files, theater: string, prefer: 'v3rocket' | 'dmisl', footprintPx = ROCKET_FOOTPRINT_PX): ConvertedSprite {
  const { has } = reader(vfs, theater);
  const other = prefer === 'dmisl' ? 'v3rocket' : 'dmisl';
  return prerenderAircraft(vfs, theater, has(prefer) || !has(other) ? prefer : other, footprintPx);
}

/** 32 facings of a voxel with no turret, such as the Kirov airship (`zep`) or its bomb (`zbomb`). */
export function prerenderAircraft(vfs: Files, theater: string, name: string, footprintPx: number): ConvertedSprite {
  const { vxl, hva, pal } = reader(vfs, theater);
  return renderVoxelToSprite(name, vxl(name), hva(name), pal(), { footprintPx });
}

/** `deso.shp` frames (start, count) from artmd.ini `[DesoSequence]`: Ready has 8 facings, the others one. */
export const DESO_SEQUENCE = { Ready: [0, 1], Deploy: [299, 15], DeployedFire: [292, 7] } as const;

/**
 * The Desolator's `deso.shp` frame `sinceLand` s from its radiation landing: standing at infantry `facing` (0–7),
 * deploying over the last second before, then erupting on a loop at 15 frames a second.
 */
export function desolatorFrame(sinceLand: number, facing: number): number {
  const { Ready, Deploy, DeployedFire } = DESO_SEQUENCE, frame = Math.floor(sinceLand * 15);
  if (frame < -Deploy[1]) return Ready[0] + facing;
  if (frame < 0) return Deploy[0] + Deploy[1] + frame;
  return DeployedFire[0] + frame % DeployedFire[1];
}

/**
 * A stock SHP animation (e.g. `chronofd`, `fire01`) in the theater-independent `anim.pal`; with `theater`, an SHP
 * projectile (e.g. `nkmsldn`) in that theater's unit palette.
 */
export function prerenderAnim(vfs: Files, name: string, theater?: string): ConvertedSprite {
  const { open, pal } = reader(vfs, theater ?? '');
  return convertShpToAtlas(name, ShpFile.parse(open(`${name}.shp`)), theater ? pal() : Palette.parse(open('anim.pal')));
}
