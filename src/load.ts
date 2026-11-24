import { BOMB_FOOTPRINT_PX, KIROV_FOOTPRINT_PX, prerenderAircraft, prerenderAnim, prerenderRhinos, prerenderRocket, prerenderTank, type RhinoArt } from './assets/rhino.js';
import type { Battlefield } from './battlefield/import.js';
import type { ObjectImage } from './battlefield/objects.js';
import { importBattlefield } from './battlefield/import.js';
import { CHUNK, type Terrain, type TerrainChunk } from './battlefield/terrain.js';
import { cachedImport, importStore } from './install/cache.js';
import { crc32, type MapFile } from './ra2/index.js';
import { loadMap, mountTheater, type ReadFile } from './ra2/mount.js';
import type { ConvertedSprite } from './ra2/render/sprite.js';

type Encoded<T> = Omit<T, 'rgba'> & { image: Blob };
export type Sprite = Pick<ConvertedSprite, 'atlasWidth' | 'atlasHeight' | 'spriteWidth' | 'spriteHeight' | 'frames' | 'origin'> & { image: Blob };

/** A course's import output as cached: every image a lossless WebP, decoded only into GPU textures. */
export interface CourseArt {
  battlefield: Omit<Battlefield, 'terrain' | 'images'> & {
    terrain: Omit<Terrain, 'chunks'> & { chunks: (Omit<Encoded<TerrainChunk>, 'depth'> & { depth: Blob })[] };
    images: Encoded<ObjectImage>[];
  };
  /** A Rhino per house colour, indexed by `Racer.colour`, with the colour as 0xRRGGBB. */
  rhinos: (Tank & { rgb: number })[];
  /** Every Rhino's ground shadow, the same in every colour, laid out like its hull. */
  rhinoShadow: Sprite;
  /** The Tesla strike's tank, prerendered like the Rhino. */
  tesla: Tank;
  /** The V3 rocket and the homing missile (Dreadnought missile), 32 facings each. */
  v3: Sprite;
  missile: Sprite;
  /** Stock animations: the Chronosphere warp at the cell left (`ChronoBlast`) and the cell landed on (`ChronoBlastDest`), and a stunned tank's fire. */
  warpOut: Sprite;
  warpIn: Sprite;
  fire: Sprite;
  /** The nuke falling (`nkmsldn`) and its mushroom cloud (`nukeanim`). */
  nuke: Sprite;
  mushroom: Sprite;
  /** The Kirov airship (`zep`) and its bomb (`zbomb`), 32 facings each, and the bomb's blast (`explolrg`, from `BlimpHE`). */
  kirov: Sprite;
  bomb: Sprite;
  kirovBlast: Sprite;
  /** The Desolator (`deso`), every frame of its SHP, in the theater's unit palette. */
  desolator: Sprite;
}

type Tank = { body: Sprite; turret: Sprite; pivot: readonly [number, number, number] };

async function webp(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
  // Chromium encodes WebP losslessly at quality 1. Pixels are fully opaque or fully clear, so premultiplying loses nothing visible.
  return canvas.convertToBlob({ type: 'image/webp', quality: 1 });
}

/** Awaits every promise of `pending`, keeping its keys. */
async function settled<T extends Record<string, Promise<unknown>>>(pending: T): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  return Object.fromEntries(await Promise.all(Object.entries(pending).map(async ([key, value]) => [key, await value]))) as { [K in keyof T]: Awaited<T[K]> };
}

const tank = async (t: RhinoArt): Promise<Tank> => ({ ...await settled({ body: sprite(t.body), turret: sprite(t.turret.sprite) }), pivot: t.turret.pivot });

const sprite = async (s: ConvertedSprite): Promise<Sprite> =>
  ({ atlasWidth: s.atlasWidth, atlasHeight: s.atlasHeight, spriteWidth: s.spriteWidth, spriteHeight: s.spriteHeight, frames: s.frames, origin: s.origin, image: await webp(s.colorRgba, s.atlasWidth, s.atlasHeight) });

/**
 * Imports the course's battlefield and prerenders the Rhino, or takes both from the cache when this install
 * and map file were imported before. A miss reads only the MIX entries the import needs; a hit reads none.
 * A change to the prerendered art needs `IMPORT_VERSION` bumped in `src/install/cache.ts`.
 */
export async function loadCourse(read: ReadFile, mapPath: string): Promise<{ map: MapFile; mapBytes: Uint8Array; art: CourseArt; cached: boolean }> {
  const mapBytes = await read(mapPath);
  // The map file is read once; the import's own reads of it get these bytes.
  const readMapOnce: ReadFile = async (p, ...range) => (p === mapPath && !range.length ? mapBytes : read(p, ...range));
  const map = await loadMap(readMapOnce, mapPath);
  let cached = true;
  // ponytail: an edited map leaves its old entry behind until the install or import version changes.
  const art = await cachedImport<CourseArt>(importStore, read, `${mapPath}#${crc32(mapBytes).toString(16)}`, async () => {
    cached = false;
    const vfs = await mountTheater(read, map.theater);
    const { terrain, images, ...rest } = await importBattlefield(readMapOnce, mapPath, vfs);
    // The browser encodes WebP off the main thread, so each encode starts at once and runs while the next art prerenders.
    // Terrain chunks (16 MB of pixels each) go three at a time, so only a few chunks' encoder buffers are alive at once.
    let next = 0;
    const chunks: CourseArt['battlefield']['terrain']['chunks'] = [];
    const chunksDone = Promise.all(Array.from({ length: 3 }, async () => {
      while (next < terrain.chunks.length) {
        const at = next++, { rgba, depth, ...c } = terrain.chunks[at]!;
        chunks[at] = { ...c, ...await settled({ image: webp(rgba, CHUNK, CHUNK), depth: webp(depth, CHUNK, CHUNK) }) };
      }
    }));
    const encoded = Promise.all(images.map(async ({ rgba, ...i }) => ({ ...i, image: await webp(rgba, i.width, i.height) })));
    const rhinos = prerenderRhinos(vfs, map.theater);
    const art = await settled({
      rhinos: Promise.all(rhinos.map(async (r) => ({ ...await tank(r), rgb: r.rgb }))),
      rhinoShadow: sprite(rhinos[0]!.shadow),
      tesla: tank(prerenderTank(vfs, map.theater, 'ttnk')),
      v3: sprite(prerenderRocket(vfs, map.theater, 'v3rocket')),
      missile: sprite(prerenderRocket(vfs, map.theater, 'dmisl')),
      warpOut: sprite(prerenderAnim(vfs, 'chronofd')),
      warpIn: sprite(prerenderAnim(vfs, 'chronotg')),
      fire: sprite(prerenderAnim(vfs, 'fire01')),
      nuke: sprite(prerenderAnim(vfs, 'nkmsldn', map.theater)),
      mushroom: sprite(prerenderAnim(vfs, 'nukeanim')),
      kirov: sprite(prerenderAircraft(vfs, map.theater, 'zep', KIROV_FOOTPRINT_PX)),
      bomb: sprite(prerenderAircraft(vfs, map.theater, 'zbomb', BOMB_FOOTPRINT_PX)),
      kirovBlast: sprite(prerenderAnim(vfs, 'explolrg')),
      desolator: sprite(prerenderAnim(vfs, 'deso', map.theater)),
      images: encoded,
    });
    await chunksDone;
    const { images: objectImages, ...sprites } = art;
    return { battlefield: { ...rest, terrain: { ...terrain, chunks }, images: objectImages }, ...sprites };
  });
  return { map, mapBytes, art, cached };
}
