import { IniFile, Palette, type IniSection, type MapFile, type Vfs } from '../ra2/index.js';
import { theaterArtExt } from '../ra2/theater.js';

// The CNCMaps NewTheater letter and theater palette per theater (docs/research/supported-battlefields.md §1).
const LETTER: Record<string, string> = { temperate: 't', snow: 'a', urban: 'u', newurban: 'n', desert: 'd', lunar: 'l' };
const THEATER_PAL: Record<string, string> = {
  temperate: 'temperat', snow: 'snow', urban: 'urban', newurban: 'urbann', desert: 'desert', lunar: 'lunar',
};

/**
 * Stock rules and art for one map in its own theater: `rulesmd.ini` and `artmd.ini` from the mounted stock MIXes,
 * with the map's `Image=` and type lists honoured key by key. Nothing else from the map's rules is read.
 */
export class Stock {
  readonly theater: string;
  readonly ext: string;
  readonly rules: IniFile;
  readonly art: IniFile;
  /** `[OverlayTypes]` by position: a map's overlay byte indexes this list. */
  readonly overlayTypes: string[];
  private readonly palettes = new Map<string, Uint8Array>();

  constructor(readonly map: MapFile, readonly vfs: Vfs) {
    this.theater = map.theater.toLowerCase();
    this.ext = theaterArtExt(this.theater);
    this.rules = IniFile.parse(this.need('rulesmd.ini'));
    this.art = IniFile.parse(this.need('artmd.ini'));
    this.overlayTypes = this.typeList('OverlayTypes');
  }

  need(name: string): Uint8Array {
    const bytes = this.vfs.openFile(name);
    if (!bytes) throw new Error(`Missing install file: ${name}`);
    return bytes;
  }

  /** A type list (`[BuildingTypes]`…): rulesmd's, with the map's keys replacing or adding entries. */
  typeList(section: string): string[] {
    const list = new Map<string, string>();
    for (const ini of [this.rules, this.map.ini]) {
      for (const e of ini.getSection(section)?.entries ?? []) list.set(e.key, e.value);
    }
    return [...list.values()];
  }

  /** A rules key for a type, the map's value winning. Only used for keys the map may override (`Image`). */
  private ruleOrMap(type: string, key: string): string {
    return this.map.ini.getSection(type)?.getString(key) || this.rules.getSection(type)?.getString(key) || '';
  }

  rulesOf(type: string): IniSection | undefined {
    return this.rules.getSection(type);
  }

  artOf(type: string): IniSection | undefined {
    return this.art.getSection(this.ruleOrMap(type, 'Image') || type);
  }

  invisible(type: string): boolean {
    return !!(this.rulesOf(type)?.getBool('InvisibleInGame') || this.artOf(type)?.getBool('InvisibleInGame'));
  }

  /**
   * The art file that draws a type in this theater, or undefined if there is none. CNCMaps' rule: `Image=` from
   * rules then art, `Theater=yes` gives `<image>.<ext>`, and the NewTheater letter swap (then `G`, then the
   * original) applies whatever the art's `NewTheater=` says.
   */
  artFile(type: string): string | undefined {
    const artName = this.ruleOrMap(type, 'Image') || type;
    const art = this.art.getSection(artName);
    const image = (art?.getString('Image') || artName).toLowerCase();
    const file = `${image}.${art?.getBool('Theater') ? this.ext : 'shp'}`;
    if (/^[gncy][atudln]/i.test(artName)) {
      for (const letter of [LETTER[this.theater]!, 'g']) {
        const swapped = file[0] + letter + file.slice(2);
        if (this.vfs.exists(swapped)) return swapped;
      }
    }
    return this.vfs.exists(file) ? file : undefined;
  }

  /** RGB palette: `iso` (tiles, trees, most overlay), `unit` (buildings, walls) or `theater` (ore). */
  palette(kind: 'iso' | 'unit' | 'theater'): Uint8Array {
    let rgb = this.palettes.get(kind);
    if (!rgb) {
      const name = kind === 'theater' ? `${THEATER_PAL[this.theater]}.pal` : `${kind}${this.ext}.pal`;
      rgb = Palette.parse(this.need(name)).rgb;
      this.palettes.set(kind, rgb);
    }
    return rgb;
  }
}
