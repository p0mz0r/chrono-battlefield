import { HvaFile, Palette, VxlFile, type Vfs } from '../ra2/index.js';
import { renderTurretToSprite, renderVoxelToSprite, type TurretRender } from '../ra2/render/voxelRender.js';
import type { ConvertedSprite } from '../ra2/render/sprite.js';
import { theaterArtExt } from '../ra2/theater.js';

/** On-screen Rhino hull width in px: the one size knob (ADR 0002). */
export const RHINO_FOOTPRINT_PX = 54;

export interface RhinoArt {
  /** 32 hull facings, frame i = facing i × 360°/32 clockwise from north (-y). */
  body: ConvertedSprite;
  /** 32 turret (+ barrel) facings and the turret pivot in the hull's frame. */
  turret: TurretRender;
}

/** Prerenders `htnk`, `htnktur`, `htnkbarl` with the theater's unit palette. Pure, no DOM. */
export function prerenderRhino(vfs: Vfs, theater: string, footprintPx = RHINO_FOOTPRINT_PX): RhinoArt {
  const open = (name: string) => {
    const bytes = vfs.openFile(name);
    if (!bytes) throw new Error(`Missing install file: ${name}`);
    return bytes;
  };
  const vxl = (n: string) => VxlFile.parse(open(`${n}.vxl`));
  const hva = (n: string) => HvaFile.parse(open(`${n}.hva`));
  const pal = Palette.parse(open(`unit${theaterArtExt(theater.toLowerCase())}.pal`));
  const hull = vxl('htnk');
  return {
    body: renderVoxelToSprite('htnk', hull, hva('htnk'), pal, { footprintPx }),
    turret: renderTurretToSprite('htnktur', hull, vxl('htnktur'), hva('htnktur'), pal, vxl('htnkbarl'), hva('htnkbarl'), { footprintPx }),
  };
}
