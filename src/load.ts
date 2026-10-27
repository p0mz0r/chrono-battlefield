import { prerenderRhino } from './assets/rhino.js';
import type { Battlefield } from './battlefield/import.js';
import { importBattlefield } from './battlefield/import.js';
import type { ObjectImage } from './battlefield/objects.js';
import { CHUNK, type Terrain, type TerrainChunk } from './battlefield/terrain.js';
import { cachedImport, importStore } from './install/cache.js';
import { crc32, type MapFile } from './ra2/index.js';
import { loadMap, mountTheater, type ReadFile } from './ra2/mount.js';
import type { ConvertedSprite } from './ra2/render/sprite.js';

type Encoded<T> = Omit<T, 'rgba'> & { image: Blob };
export type Sprite = Pick<ConvertedSprite, 'atlasWidth' | 'atlasHeight' | 'frames'> & { image: Blob };

/** A course's import output as cached: every image a lossless WebP, decoded only into GPU textures. */
export interface CourseArt {
  battlefield: Omit<Battlefield, 'terrain' | 'images'> & {
    terrain: Omit<Terrain, 'chunks'> & { chunks: Encoded<TerrainChunk>[] };
    images: Encoded<ObjectImage>[];
  };
  rhino: { body: Sprite; turret: Sprite; pivot: readonly [number, number, number] };
}

async function webp(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
  // Chromium encodes WebP losslessly at quality 1. Pixels are fully opaque or fully clear, so premultiplying loses nothing visible.
  return canvas.convertToBlob({ type: 'image/webp', quality: 1 });
}

const sprite = async (s: ConvertedSprite): Promise<Sprite> =>
  ({ atlasWidth: s.atlasWidth, atlasHeight: s.atlasHeight, frames: s.frames, image: await webp(s.colorRgba, s.atlasWidth, s.atlasHeight) });

/**
 * Imports the course's battlefield and prerenders the Rhino, or takes both from the cache when this install
 * and map file were imported before. A miss reads only the MIX entries the import needs; a hit reads none.
 */
export async function loadCourse(read: ReadFile, mapPath: string): Promise<{ map: MapFile; art: CourseArt; cached: boolean }> {
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
    const rhino = prerenderRhino(vfs, map.theater);
    const chunks: Encoded<TerrainChunk>[] = [];
    // One at a time, so at most one chunk's encoder buffers are alive.
    for (const { rgba, ...c } of terrain.chunks) chunks.push({ ...c, image: await webp(rgba, CHUNK, CHUNK) });
    const encoded: Encoded<ObjectImage>[] = [];
    for (const { rgba, ...i } of images) encoded.push({ ...i, image: await webp(rgba, i.width, i.height) });
    return {
      battlefield: { ...rest, terrain: { ...terrain, chunks }, images: encoded },
      rhino: { body: await sprite(rhino.body), turret: await sprite(rhino.turret.sprite), pivot: rhino.turret.pivot },
    };
  });
  return { map, art, cached };
}
