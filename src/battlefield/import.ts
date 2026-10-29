import type { Vfs } from '../ra2/index.js';
import { loadMap, mountTheater, type ReadFile } from '../ra2/mount.js';
import { buildGrid, type CellGrid } from './grid.js';
import { placeObjects, type ObjectImage, type PlacedObject } from './objects.js';
import { Stock } from './stock.js';
import { bakeTerrain, tileLookup, type Terrain } from './terrain.js';

/** A map file imported as a battlefield: what the stream draws and what movement drives on. */
export interface Battlefield {
  theater: string;
  terrain: Terrain;
  images: ObjectImage[];
  objects: PlacedObject[];
  grid: CellGrid;
  /** Parts of the map that were dropped: units, rule overrides. */
  warnings: string[];
}

/** The support rule refused the map (docs/research/supported-battlefields.md §5). */
export class UnsupportedMapError extends Error {
  constructor(readonly path: string, readonly reasons: string[]) {
    super(`Unsupported map ${path}: ${reasons.join('; ')}`);
  }
}

const THEATERS = ['TEMPERATE', 'SNOW', 'URBAN', 'NEWURBAN', 'DESERT', 'LUNAR'];

// Type lists the map may extend; every other rulesmd section it carries is a rule override we ignore.
const HONOURED = new Set(['terraintypes', 'buildingtypes', 'overlaytypes']);

/**
 * Imports a map file from stock files only, applying the support rule: a known theater, and art in that theater
 * for every tile, overlay, tree and building. Throws UnsupportedMapError with the reasons otherwise.
 */
export async function importBattlefield(read: ReadFile, path: string, mounted?: Vfs): Promise<Battlefield> {
  const map = await loadMap(read, path);
  const theater = map.theater.toUpperCase();
  if (!THEATERS.includes(theater)) throw new UnsupportedMapError(path, [`Unknown theater: ${map.theater || '(none)'}`]);
  const stock = new Stock(map, mounted ?? await mountTheater(read, theater));

  const terrain = bakeTerrain(stock);
  const { images, objects, missingArt, unknownTypes, missingOverlays } = placeObjects(stock, terrain.originX, terrain.originY);
  const reasons: string[] = [];
  if (terrain.missing) reasons.push(`${terrain.missing} cells have no tile art in ${theater}`);
  if (missingArt.size) reasons.push(`no art in ${theater} for ${[...missingArt].join(', ')}`);
  if (unknownTypes.size) reasons.push(`types stock rules don't list: ${[...unknownTypes].join(', ')}`);
  if (reasons.length) throw new UnsupportedMapError(path, reasons);

  const warnings: string[] = [];
  const units = map.units.length + map.infantry.length + map.aircraft.length;
  if (missingOverlays.size) warnings.push(`no art in ${theater} for building overlays (skipped): ${[...missingOverlays].join(', ')}`);
  if (units) warnings.push(`dropped ${units} units, infantry and aircraft`);
  const countries = new Set(stock.typeList('Countries').map((c) => c.toLowerCase()));
  const overrides = map.ini.sectionNames().filter((name) => {
    const lower = name.toLowerCase();
    if (['specialflags', 'triggers', 'tags', 'events', 'actions', 'teamtypes', 'taskforces', 'scripttypes', 'aitriggertypes'].includes(lower)) return true;
    if (HONOURED.has(lower) || countries.has(lower) || !stock.rules.hasSection(name)) return false;
    return map.ini.getSection(name)!.entries.some((e) => e.key.toLowerCase() !== 'image');
  });
  if (overrides.length) warnings.push(`ignored rule overrides: ${overrides.join(', ')}`);

  return { theater, terrain, images, objects, grid: buildGrid(stock, tileLookup(stock)), warnings };
}
