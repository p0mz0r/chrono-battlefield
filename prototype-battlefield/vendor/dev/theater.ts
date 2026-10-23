// Theater tile-set resolution: maps a map's IsoMapPack tileNum -> the TMP file
// and sub-tile that draws it, using the theater INI's [TileSetNNNN] table.
//
// RA2 numbers terrain tiles GLOBALLY and sequentially across the theater's
// tile-sets: each `[TileSetNNNN]` section names a `FileName` base and a
// `TilesInSet` count; walking the sets in numeric order and counting assigns a
// global tileNum to each on-disk template file. Within a template's TMP file,
// the map's `subTile` selects the cell. (Verified against Hills.mmx: tileNum 143
// -> clat12.tem, etc.) A tileNum of 65535 is the engine's "clear/empty" sentinel
// and has no file.
//
// The on-disk tile file name is `<FileName><NN>.<ext>` where NN is the 1-based
// index within the set, zero-padded to 2 digits, and `<ext>` is the theater's
// tile extension (temperate -> `.tem`), matching FinalAlert2's loader.

import { IniFile } from '../formats/index.js';

/** One global tile slot: which file draws it (its sub-tiles live inside the file). */
export interface TileSlot {
  /** Global tile template index (the map's tileNum). */
  readonly tileNum: number;
  /** On-disk TMP file name for this template (e.g. `clat12.tem`). */
  readonly file: string;
}

/** The engine sentinel tileNum meaning "clear / no explicit tile". */
export const CLEAR_TILE_NUM = 0xffff;

/** Theater name -> tile file extension. */
const THEATER_EXT: Readonly<Record<string, string>> = {
  temperate: 'tem',
  snow: 'sno',
  urban: 'urb',
  newurban: 'ubn',
  lunar: 'lun',
  desert: 'des',
};

/** Theater name -> its INI file (holds the [TileSetNNNN] table). */
export const THEATER_INI: Readonly<Record<string, string>> = {
  temperate: 'temperatmd.ini',
  snow: 'snowmd.ini',
  urban: 'urbanmd.ini',
  newurban: 'urbannmd.ini',
  lunar: 'lunarmd.ini',
  desert: 'desertmd.ini',
};

/**
 * Build the global tileNum -> file table for a theater from its parsed INI. The
 * `[TileSetNNNN]` sections are walked in numeric order; each contributes
 * `TilesInSet` sequential global slots. Returns the slot array indexed by
 * tileNum (dense from 0).
 */
export function buildTileSlots(ini: IniFile, theater: string): TileSlot[] {
  const ext = THEATER_EXT[theater.toLowerCase()] ?? 'tem';
  const setNames = ini
    .sectionNames()
    .filter((s) => /^TileSet\d+$/i.test(s))
    .sort((a, b) => tileSetNumber(a) - tileSetNumber(b));

  const slots: TileSlot[] = [];
  let globalIndex = 0;
  for (const sn of setNames) {
    const sec = ini.getSection(sn);
    if (!sec) continue;
    const fileName = sec.getString('FileName').trim().toLowerCase();
    const count = sec.getInt('TilesInSet');
    if (!fileName || count <= 0) continue;
    for (let e = 1; e <= count; e++) {
      slots.push({
        tileNum: globalIndex,
        file: `${fileName}${String(e).padStart(2, '0')}.${ext}`,
      });
      globalIndex++;
    }
  }
  return slots;
}

/**
 * Resolve a TileSet FileName BASE (e.g. `glat`, `green`) to the EXACT global tileNums whose
 * slot file matches `^<base><digits>.<ext>`, in ascending order. Returns every match, NOT a
 * contiguous range — RA2 reuses a LAT FileName across several tilesets (the base set plus its
 * morphable duplicates), which are NOT adjacent in the global index, so a [start,count) range
 * would wrongly span the unrelated tiles between them. Used by the freeground LAT family
 * overwrite to target exactly its tiles without hard-coding install-specific indices.
 */
export function tileNumsForFileName(slots: readonly TileSlot[], base: string): number[] {
  const re = new RegExp(`^${base.toLowerCase()}\\d+\\.`);
  const out: number[] = [];
  for (const slot of slots) if (re.test(slot.file)) out.push(slot.tileNum);
  return out.sort((a, b) => a - b);
}

/** Numeric part of a `TileSetNNNN` section name (for stable ordering). */
function tileSetNumber(name: string): number {
  const m = /(\d+)/.exec(name);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}

/**
 * The GLOBAL tileNum of the theater's clear tileset ([General] ClearTile names a
 * TileSetNNNN number; vanilla temperate is 0). IsoMapPack stores the default
 * ground implicitly as 0xffff — the engine substitutes this tileset, varying the
 * sub-tile by cell position. Returns undefined when the set is absent/empty.
 */
export function clearTileGlobalNum(ini: IniFile): number | undefined {
  const clearSet = ini.getSection('General')?.getInt('ClearTile', 0) ?? 0;
  const setNames = ini
    .sectionNames()
    .filter((s) => /^TileSet\d+$/i.test(s))
    .sort((a, b) => tileSetNumber(a) - tileSetNumber(b));
  let globalIndex = 0;
  for (const sn of setNames) {
    const sec = ini.getSection(sn);
    if (!sec) continue;
    const fileName = sec.getString('FileName').trim().toLowerCase();
    const count = sec.getInt('TilesInSet');
    if (!fileName || count <= 0) continue;
    if (tileSetNumber(sn) === clearSet) return globalIndex;
    globalIndex += count;
  }
  return undefined;
}

/** The theater INI file name for a theater, defaulting to temperate. */
export function theaterIniName(theater: string): string {
  return THEATER_INI[theater.toLowerCase()] ?? THEATER_INI['temperate']!;
}

/**
 * The on-disk file EXTENSION for a theater's `Theater=yes` art (trees, rocks,
 * terrain objects), e.g. temperate -> `tem`, urban -> `urb`. RA2 stores these
 * neutral terrain SHPs with the theater extension rather than `.shp`. Defaults to
 * the temperate extension for unknown theaters.
 */
export function theaterArtExt(theater: string): string {
  return THEATER_EXT[theater.toLowerCase()] ?? THEATER_EXT['temperate']!;
}
