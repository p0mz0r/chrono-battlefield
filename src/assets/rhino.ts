import { HvaFile, Palette, VxlFile, type Vfs } from '../ra2/index.js';
import { renderTurretToSprite, renderVoxelToSprite, type TurretRender } from '../ra2/render/voxelRender.js';
import type { ConvertedSprite } from '../ra2/render/sprite.js';
import { theaterArtExt } from '../ra2/theater.js';

/** On-screen Rhino hull width in px: the one size knob (ADR 0002). */
export const RHINO_FOOTPRINT_PX = 54;
/** On-screen V3 rocket / Dreadnought missile length in px (eyeballed). */
export const ROCKET_FOOTPRINT_PX = 30;

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
  };
}

/** Prerenders `<unit>`, `<unit>tur` and (when present) `<unit>barl` with the theater's unit palette. Pure, no DOM. */
export function prerenderTank(vfs: Files, theater: string, unit: string, footprintPx = RHINO_FOOTPRINT_PX): RhinoArt {
  const { has, vxl, hva, pal } = reader(vfs, theater);
  const hull = vxl(unit), palette = pal(), barrel = has(`${unit}barl`);
  return {
    body: renderVoxelToSprite(unit, hull, hva(unit), palette, { footprintPx }),
    turret: renderTurretToSprite(`${unit}tur`, hull, vxl(`${unit}tur`), hva(`${unit}tur`), palette,
      barrel ? vxl(`${unit}barl`) : undefined, barrel ? hva(`${unit}barl`) : undefined, { footprintPx }),
  };
}

export const prerenderRhino = (vfs: Files, theater: string, footprintPx = RHINO_FOOTPRINT_PX) => prerenderTank(vfs, theater, 'htnk', footprintPx);

/** 32 facings of the V3 rocket (`v3rocket`) or the Dreadnought missile (`dmisl`); each falls back to the other when missing. */
export function prerenderRocket(vfs: Files, theater: string, prefer: 'v3rocket' | 'dmisl', footprintPx = ROCKET_FOOTPRINT_PX): ConvertedSprite {
  const { has, vxl, hva, pal } = reader(vfs, theater);
  const other = prefer === 'dmisl' ? 'v3rocket' : 'dmisl';
  const name = has(prefer) || !has(other) ? prefer : other;
  return renderVoxelToSprite(name, vxl(name), hva(name), pal(), { footprintPx });
}
