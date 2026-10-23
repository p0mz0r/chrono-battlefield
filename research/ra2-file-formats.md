# How browser RA2 engines read the game's files

Research for [#2](https://github.com/p0mz0r/chrono-battlefield/issues/2), part of [#1](https://github.com/p0mz0r/chrono-battlefield/issues/1). Researched 2026-10-22.

Labels used below:
- **[V]** verified: read in the primary source linked next to it (source code, first-party docs, spec).
- **[I]** inference: my reading or extrapolation, not stated by a source.

## TL;DR

1. Drawing a **battlefield** plus a Rhino **tank** takes about eight formats: **MIX** (archive, header sometimes Blowfish-encrypted), **INI** (rules/art/theater INIs, and the map file itself), the map's packed sections (**IsoMapPack5** = base64 + LZO1X, **OverlayPack/OverlayDataPack** = base64 + LCW/Format80), **TMP** (isometric terrain tiles), **SHP (TS/RA2)** (buildings, trees, overlay, infantry, animations), **VXL + HVA** (the Rhino is a voxel model: hull, turret and barrel), and **PAL** (256-colour palettes, 6-bit channels). **CSF** (string table) is only needed for display names. **[V]**, sources below.
2. **No permissively licensed, maintained JS/TS library covers these formats.** The TS options are GPL-3.0 (`harshilmathur/openra2`, about a week of commits in July 2026), non-commercial (`@mixen/*`), unlicensed or all-rights-reserved (`ra2web-studio`, Chrono Divide's client and `@chronodivide/game-api`), or of contested provenance (`huangkaoya/ts-redalert2`, which says it is derived from Chrono Divide's closed client and forbids exactly our kind of "danmaku Red Alert" use). The mature references (XCC, OpenRA, CNCMaps, EA's FinalAlert 2 source) are all GPL-3.0. The only permissive code base that covers all the formats is `rust-alert/ra2.exe` (Apache-2.0, Rust, has a wasm binding, crate not published). **[V]**
3. **How Chrono Divide does it [V]:** the user picks either a game folder (File System Access API directory handle) or an archive (`.7z/.zip/.exe/...`, unpacked in the browser with 7z-wasm, or fetched by URL, e.g. from the Internet Archive). The client copies **only `ra2.mix`, `language.mix`, `multi.mix`, `theme.mix`** (and `Taunts/`) into a private sandbox (**OPFS**, with IndexedDB / Cache API fallback via the `file-system-access` polyfill), CRC-checks `ra2.mix` and `multi.mix`, converts music to MP3 and the menu video (BIK) to WebM at import, and reads straight from that sandbox on later visits. **It is RA2 1.006 only; "Yuri's Revenge mods are NOT compatible."**
4. **Install layout:** RA2 needs `ra2.mix` (which nests `local.mix`, `cache.mix`, `conquer.mix`, `generic.mix`, `isogen.mix`, the theater mixes, ...), `language.mix`, and `multi.mix` for multiplayer maps. YR adds `ra2md.mix` (nests `localmd.mix`, `cachemd.mix`, `conqmd.mix`, `genermd.mix`, `isogenmd.mix`, the `*md` theater mixes), `langmd.mix`, `expandmd01.mix` (holds the 1.001 `rulesmd.ini`), and `multimd.mix`. Lookup is first match wins in a fixed priority order (table below). **[V]** (ModEnc)
5. **What this means for the decision [I]:** if any battlefield is a YR map (Desert, Lunar and NewUrban theaters exist only in YR), we cannot reuse Chrono Divide's approach as is. We need our own loader that also mounts the `*md` archives. The browser-side pattern (pick a folder or archive, copy the needed MIXes into OPFS, read from OPFS afterwards) carries over unchanged.

---

## 1. Formats needed for a battlefield and a Rhino

| Format | What it holds | Needed for | Where it lives (RA2 / YR) | Key facts |
|---|---|---|---|---|
| **MIX** | Archive of files indexed by a 32-bit ID, not a name | everything | top-level `.mix` in the install dir; MIXes nest inside MIXes | Two header variants: old C&C (first u16 ≠ 0) and RA/TS/RA2 (u16 0, then u16 flags; `0x2` = encrypted header, `0x1` = SHA-1 checksum footer). **[V]** [OpenRA MixFile.cs](https://github.com/OpenRA/OpenRA/blob/bleed/OpenRA.Mods.Cnc/FileSystem/MixFile.cs), [XCC mix_file.cpp](https://github.com/OlafvdSpek/xcc/blob/master/misc/mix_file.cpp) |
| MIX encryption | An 80-byte key block after the 4-byte header is decrypted with a public RSA-style key built into the game, giving a 56-byte Blowfish key that decrypts the index (in 8-byte blocks) | reading `ra2.mix`, `ra2md.mix`, ... | — | XCC hard-codes the public key string `AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V` and does bignum maths. The data section itself is not encrypted. **[V]** [XCC mix_decode.cpp](https://github.com/OlafvdSpek/xcc/blob/master/misc/mix_decode.cpp), [OpenRA MixFile.cs `DecryptHeader`](https://github.com/OpenRA/OpenRA/blob/bleed/OpenRA.Mods.Cnc/FileSystem/MixFile.cs) |
| MIX file IDs | TS/RA2/YR ID = CRC32 of the upper-cased name, padded to a multiple of 4 in a specific way | resolving `"htnk.vxl"` to an entry | — | **[V]** [XCC `Cmix_file::get_id`](https://github.com/OlafvdSpek/xcc/blob/master/misc/mix_file.cpp). Names are not stored, so you can only open files whose names you know (from INIs) or list them via a name database: the XCC "local mix database.dat" inside a MIX, or a global name list. **[V]** OpenRA `ParseIndex` |
| **INI** | `rules.ini`/`rulesmd.ini` (game logic), `art.ini`/`artmd.ini` (which image, voxel or turret, foundation), theater INIs, and the **map file** itself | battlefield + Rhino | RA2: `ra2.mix → local.mix`; YR: `ra2md.mix → localmd.mix`, YR 1.001 `rulesmd.ini`/`soundmd.ini` in `expandmd01.mix` | **[V]** [ModEnc MIX, "Location of files"](https://web.archive.org/web/2024/https://modenc.renegadeprojects.com/MIX) |
| Theater INI | Tile set list per theater (`temperat.ini`, `snow.ini`, `urban.ini`; YR `temperatmd.ini`, `snowmd.ini`, `urbanmd.ini`, `desertmd.ini`, `urbannmd.ini`, `lunarmd.ini`) mapping tile index to `.tem/.sno/...` filenames | battlefield | inside local/localmd | Theater INIs dictate how many tiles in a set the game can see. **[V]** [ModEnc Theaters](https://web.archive.org/web/2025/https://modenc.renegadeprojects.com/Theaters). Exact INI filenames per theater: **[I]** (standard community knowledge, not checked against the files) |
| **Map** (`.map/.mpr/.mmx/.yrm`) | INI text. `[Map] Theater=, Size=, LocalSize=`; `[IsoMapPack5]` = base64 of LZO1X blocks of 11-byte cell records (x, y, tile number, subtile, height, flags); `[OverlayPack]`/`[OverlayDataPack]` = base64 + LCW (Format80); `[Structures]`, `[Terrain]`, `[Units]`, `[Waypoints]` | battlefield (and waypoints for a course) | `multi.mix` / `multimd.mix`, or loose files | **[V]** EA's GPLv3 [FinalSun/FinalAlert 2 source](https://github.com/electronicarts/CNC_TS_and_RA2_Mission_Editor) (`DecodeIsoMapPack5`), cited by [openra2 isoMapPack.ts](https://github.com/harshilmathur/openra2/blob/master/packages/formats/src/map/isoMapPack.ts) |
| **TMP (TS/RA2)** | Isometric terrain tile templates: header `cblocks_x, cblocks_y, cx, cy` (RA2 cell 60×30), per-cell image + optional "extra" image, Z-data, height, damaged variant | battlefield ground | theater mixes (`isotemp.mix` / `isotemmd.mix`, ...), extension = theater (`.tem .sno .urb .des .ubn .lun`) | **[V]** [XCC cc_structures.h `t_tmp_ts_header`/`t_tmp_image_header`](https://github.com/OlafvdSpek/xcc/blob/master/misc/cc_structures.h), [ModEnc Theaters](https://web.archive.org/web/2025/https://modenc.renegadeprojects.com/Theaters). RA2 cell = 60×30 px: **[I]** (widely documented, not re-checked here) |
| **SHP (TS/RA2)** | Palette-indexed sprite frames: header `zero, cx, cy, count`; per-frame `x, y, cx, cy, compression, offset`; compression = raw or RLE-of-zeros | buildings, trees, overlay (ore, walls), infantry, animations, explosions | `conquer.mix`, `generic.mix`, `isogen.mix`, theater mixes (+ `md` variants) | **[V]** [XCC cc_structures.h `t_shp_ts_header`](https://github.com/OlafvdSpek/xcc/blob/master/misc/cc_structures.h) |
| **VXL** | Voxel model: header `"Voxel Animation"`, section (limb) headers/tailers, span data, normals index | **the Rhino** and all other vehicles | `ra2.mix → local.mix`, `ra2md.mix → localmd.mix` | **[V]** XCC `t_vxl_header`; ModEnc says voxels and their HVAs live in local/localmd |
| **HVA** | Per-frame 3×4 transform matrix per VXL section | positioning hull/turret/barrel | next to the VXL | **[V]** XCC `t_hva_header`, `t_hva_transform_matrix = float[3][4]` |
| Rhino parts | `htnk` (hull), `htnktur` (turret), `htnkbarl` (barrel) | the tank | local.mix | **[V]** [OpenRA ra2 voxels.yaml](https://github.com/OpenRA/ra2/blob/master/mods/ra2/sequences/voxels.yaml) (`htnk: turret: htnktur, barrel: htnkbarl`) |
| **PAL** | 768 bytes = 256 RGB triplets, 6-bit channels (scale `c*255/63`); indices 16–31 are the house-colour remap ramp | every sprite, tile and voxel | `cache.mix`/`cachemd.mix`, theater mixes; per-theater `iso<th>.pal` (tiles), `unit<th>.pal` (units/voxels), plus city/lib variants | **[V]** [OpenRA ra2 palettes.yaml](https://github.com/OpenRA/ra2/blob/master/mods/ra2/rules/palettes.yaml), [openra2 palFile.ts (ported from XCC)](https://github.com/harshilmathur/openra2/blob/master/packages/formats/src/pal/palFile.ts) |
| **CSF** | Unicode string table (`"CSF "`, `LBL `, `STR `/`STRW`; strings XOR-encoded) | unit and map display names only (optional) | loose: `ra2.csf` / `ra2md.csf` | **[V]** XCC `t_csf_header`, [XCC xcc_dirs.cpp](https://github.com/OlafvdSpek/xcc/blob/master/misc/xcc_dirs.cpp). XOR detail: **[I]** |
| VPL | Voxel lighting/shading lookup table | faithful voxel shading | — | Present in `rust-alert` ra-assets (`voxel/vpl.rs`). Whether we need it depends on how faithful voxel lighting has to be. **[I]** |

Not needed for our first slice **[I]**: AUD/BAG/IDX (sound), BIK (video), PCX, FNT, sidebar `sidec*.mix`, cameo mixes.

### Rendering notes (for whoever builds it) [I]
- The battlefield renderer has to combine theater INI → TMP lookup, per-cell height (Z level and ramps), overlay SHPs (ore, walls), terrain objects (trees, SHP), and buildings (SHP, `art.ini` foundation and `NewTheater` second-letter substitution, per ModEnc Theaters).
- Voxels need a software or GPU voxel rasteriser (32 facings in the original), or a Three.js mesh built from the voxels.
- CNCMaps ([zzattack/ccmaps-net](https://github.com/zzattack/ccmaps-net), GPL-3.0, C#, pushed 2026-10) is the most complete reference for drawing a whole map to an image: lighting, Z-ordering, building and overlay placement. **[V]** licence and activity; that it is the most complete reference is **[I]**.

## 2. Libraries that parse these formats

| Project | Lang | Licence | Formats | Maintenance | Usable for us? |
|---|---|---|---|---|---|
| [harshilmathur/openra2](https://github.com/harshilmathur/openra2) ("Vanguard Engine") `@vanguard/formats` | TS | **GPL-3.0-or-later** (ports XCC, FA2 source, minilzo-js) | MIX (+Blowfish), PAL, SHP, VXL/HVA, TMP, CSF, AUD, INI, MAP (IsoMapPack5, LZO, LCW) | created 2026-07-24, last push 2026-07-28, 15★ | Most complete TS code. Only if the project accepts GPL-3.0. Young, single author. **[V]** |
| [huangkaoya/ts-redalert2](https://github.com/huangkaoya/ts-redalert2) | TS + Three.js | GitHub reports "Other". README says GPL-3.0 plus a no-commercial-use clause | Full set (MIX, SHP, TMP, VXL, HVA, PAL, CSF, INI, MAP, VFS, importer) | active, ~1k★ | **Avoid.** README says it is "developed based on the analysis of" Chrono Divide's closed client, that rights belong to Chrono Divide's owner, and it names "developing a 'bullet-screen [danmaku] Red Alert' mode to profit from gifts" as infringement. That is close to Rhino Race. Useful only as a factual window on how CD's import works (cited in §3). **[V]** |
| [@mixen/core, @mixen/codecs, @mixen/compat-chronodivide](https://www.npmjs.com/package/@mixen/core) (Perpixel Kft.) | TS, browser ESM | **Mixen Non-Commercial License v1.0** | MIX (encrypted via `@mixen/core/crypto`, range reads), PAL, SHP, CSF | 0.1.2, Jan 2026 | Only if the stream is strictly non-commercial. Stream monetisation (bits, subs) could count as commercial. No VXL/TMP. **[V]** licence text in the npm tarball |
| [ra2web/ra2web-studio](https://github.com/ra2web/ra2web-studio) | TS | **none** (all rights reserved) | MIX/SHP/VXL/HVA/TMP/PAL/CSF/MAP viewer and editor, imports into OPFS | active 2026-09 | No (no licence). A good demo of the same browser pattern. **[V]** |
| Chrono Divide client, [@chronodivide/game-api](https://www.npmjs.com/package/@chronodivide/game-api) | JS | **UNLICENSED**, closed source | everything (RA2 only) | active | No. **[V]** ([ts-redalert2 README](https://github.com/huangkaoya/ts-redalert2): CD "has never open-sourced the game client code") |
| [rust-alert/ra2.exe](https://github.com/rust-alert/ra2.exe) `ra-assets` + `ra-wasm` | Rust → wasm | **Apache-2.0** | MIX (crypto, hash, names, VFS), SHP, TMP, PAL, CSF, PCX, FNT, VXL/HVA/VPL, INI, AUD/BAG | created 2026-09, very active, 323★; crate `publish = false` | Only permissive code base with every format we need. It would have to be vendored or extracted, and Rust+wasm adds build complexity. **[V]** |
| [rust-alert/ra2-remixer](https://github.com/rust-alert/ra2-remixer) | Rust | MPL-2.0 | MIX, SHP and other modding tools | last push 2025-11 | File-level copyleft. Possible. **[V]** |
| [OlafvdSpek/xcc](https://github.com/OlafvdSpek/xcc) | C++ | GPL-3.0 | The reference implementation for all formats, plus global mix DB | last push 2025-12 | Reference / porting source (GPL). **[V]** |
| [OpenRA/OpenRA](https://github.com/OpenRA/OpenRA) (`OpenRA.Mods.Cnc`) + [OpenRA/ra2](https://github.com/OpenRA/ra2) | C# | GPL-3.0 | MIX, SHP-TS, TMP-TS, VXL/HVA, PAL, XCC local DB | active | Reference (GPL). OpenRA's ra2 mod is RA2-only and converts rules to YAML. **[V]** |
| [electronicarts/CNC_TS_and_RA2_Mission_Editor](https://github.com/electronicarts/CNC_TS_and_RA2_Mission_Editor) | C++ | GPL-3.0 (released by EA) | Map pack codecs (IsoMapPack5/LZO, overlay LCW), INI tokeniser, voxel normals | 2024 drop, inactive | First-party reference for the map format. **[V]** |
| [zzattack/ccmaps-net](https://github.com/zzattack/ccmaps-net) (CNCMaps renderer) | C# | GPL-3.0 | Full map rendering | pushed 2026-10 | Reference for map rendering (GPL). **[V]** |
| [omarelarab/ra2-engine](https://github.com/omarelarab/ra2-engine) | C++ | 0BSD | "play with your own game files" | created 2026-10-14 | Too new to judge. 0BSD would allow anything. **[V]** licence and date only |
| [sk2233/ra2_mix](https://github.com/sk2233/ra2_mix) | Go | not checked | MIX, PAL, SHP | 2025 | Minor. |

Bottom line [I]: either (a) take GPL-3.0 and port or borrow from XCC/OpenRA/openra2, which makes the whole Rhino Race client GPL-3.0; (b) write our own small TS readers from the format descriptions (realistic: MIX+Blowfish, PAL, SHP, TMP, VXL/HVA, INI, IsoMapPack5+LZO, LCW together are a few hundred to low thousands of lines of TS, and LZO1X needs a clean implementation or a permissive port); or (c) vendor the Apache-2.0 Rust `ra-assets` compiled to wasm. Which licence the project takes is a separate decision (see "New questions").

## 3. How browser projects get the user's files in and cache them

### Chrono Divide (the reference) [V]
Sources: Chrono Divide's own [mod-sdk README](https://github.com/chronodivide/mod-sdk), plus the importer in [ts-redalert2 GameResImporter.ts](https://github.com/huangkaoya/ts-redalert2/blob/main/src/engine/gameRes/GameResImporter.ts) and [GameRes.ts](https://github.com/huangkaoya/ts-redalert2/blob/main/src/engine/gameRes/GameRes.ts). ts-redalert2 says it is reconstructed from CD's client, so read those two files as "very likely CD's behaviour".

- **Storage:** "The engine stores all game assets in a virtual file system, backed up by a browser storage layer, such as OPFS or IndexedDB … the web application has no access to the user's real file system and uses a private sandbox instead." (mod-sdk) The importer tries OPFS (`native` adapter) first, then IndexedDB, then Cache API, through the `file-system-access` polyfill, and migrates old IndexedDB/Cache storage into OPFS when space allows (`navigator.storage.estimate`).
- **Sandbox layout:** `/ra2.mix, multi.mix, language.mix`, `/music` (theme.mix converted to MP3), `/Taunts`, `/cache` (e.g. voxel models), `/maps`, `/mods/<id>`, `glsl.png` + `ra2ts_l.webm` (converted from SHP/BIK). (mod-sdk)
- **Import sources:** (1) a directory handle: `showDirectoryPicker`, then case-insensitive lookup of the 4 MIXes and `Taunts/`; (2) an archive: `showOpenFilePicker` accepting `.zip .7z .rar .tar .gz .bz2 .xz .exe .mix`, unpacked in the browser with **7z-wasm**, only the needed entries extracted; (3) a URL, downloaded with progress, through a CORS proxy if configured. That is how the Internet Archive link works. Press coverage confirms a "two clicks, ~200 MB" import ([heise](https://www.heise.de/en/news/Red-Alert-2-in-the-Browser-Fan-Project-Brings-Classic-to-the-Web-11087986.html)).
- **Required files:** `ra2.mix`, `language.mix`, `multi.mix` required; `theme.mix` optional. **Integrity:** CRC32 of `ra2.mix` and `multi.mix` checked against two known values each (the two retail releases, presumably **[I]**).
- **Startup:** builds a VFS from the root folder's loose files, `ecache/expand/elocal*.mix`, its own `ra2cd.mix` (downloaded from CD's server: CD-specific INIs and assets), then the original MIXes in a fixed priority order (mod-sdk "File loading priority").
- **Scope:** "mostly compatible with original RA2 (v1.006) mods … **Yuri's Revenge mods are NOT compatible.**" (mod-sdk). The importer never looks at `ra2md.mix`/`langmd.mix`. Requires a 64-bit browser, 4 GB RAM minimum, Firefox discouraged ([chronodivide.com](https://chronodivide.com/)).

### ra2web-studio [V]
Imports from a game directory or an archive (tar.gz/exe/7z/zip), keeps it in **OPFS** ("no re-import on page reload"), supports XCC global and local mix databases. Same pattern. ([README](https://github.com/ra2web/ra2web-studio))

### openra2 / Vanguard [V]
"Classic mode" reads the install through a **Node dev asset server** pointed at `RA2_DIR`, not through a browser picker. Fine for development, not a model for end users. ([README](https://github.com/harshilmathur/openra2))

### Browser API facts [V]
| API | Support | Notes |
|---|---|---|
| `window.showDirectoryPicker()` / `showOpenFilePicker()` (File System Access) | Chrome/Edge 86+. **Not in Firefox or Safari** ([MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json)) | Secure context plus user gesture required ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)) |
| Persisting handles | Handles can be stored in IndexedDB. Since Chrome 122, `requestPermission()` on a stored handle offers "Allow on every visit" ([Chrome blog](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)) | Lets you read the real install each visit instead of copying it, but Chromium only |
| `<input type="file" webkitdirectory>` | Baseline 2025, all major browsers ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory)) | Cross-browser folder picker, gives `File` objects with `webkitRelativePath`, no persistent handle, so you have to copy |
| OPFS `navigator.storage.getDirectory()` | Baseline, widely available since March 2023 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)) | Not visible to the user, no permission prompts, counts against quota, cleared with site data. Sync access handles in workers |
| `navigator.storage.persist()` | standard ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)) | Asks the browser not to evict. Not called in the code I read **[I]** |

**Recommended pattern for Rhino Race [I]:** `<input webkitdirectory>` (works in every browser), with `showDirectoryPicker` as an option on Chromium. Copy only the needed MIXes into OPFS and call `storage.persist()`. Verify by size and CRC against known retail values. Parse MIX indexes lazily with `File.slice()` range reads rather than loading 280 MB into memory (`@mixen/core` and CD both use range-backed readers). Zip/7z upload (7z-wasm) is an optional extra for users without an unpacked install.

## 4. Install layout: RA2 and YR

### Search order (first match wins), from [ModEnc MIX](https://web.archive.org/web/2024/https://modenc.renegadeprojects.com/MIX) [V]
`langmd.mix` → `language.mix` → `expandmd##.mix` (99→01) → `ra2md.mix` → `ra2.mix` → `cachemd.mix` → `cache.mix` → `localmd.mix` → `local.mix` → `audiomd.mix` → `ecache*.mix` → `elocal*.mix` → `conqmd.mix` → `genermd.mix` → `generic.mix` → `isogenmd.mix` → `isogen.mix` → `conquer.mix` → `cameomd.mix` → `cameo.mix` → `mapsmd03.mix` → `multimd.mix` → `thememd.mix` → `movmd03.mix` → theater mixes → `sidec##.mix`.

ModEnc also notes that "ecache*/elocal* order is not guaranteed" (WinAPI `FindNextFile`) and that `ra2md.mix`/`ra2.mix` contain most of the other MIXes nested inside. Chrono Divide uses its own RA2-only order (mod-sdk), with `multi.mix` and the theater mixes below `ra2.mix`.

### Top-level files a user must supply
| Game | Required for battlefield + Rhino | Nice to have |
|---|---|---|
| RA2 | `ra2.mix` (~282 MB; nests local, cache, conquer, generic, isogen, theater mixes), `language.mix`, `multi.mix` (MP maps) | `theme.mix`, `ra2.csf`, `audio.bag/.idx` |
| YR (installed into the same dir as RA2) | everything above **plus** `ra2md.mix` (nests localmd, cachemd, conqmd, genermd, isogenmd, `*md` theater mixes), `langmd.mix`, `expandmd01.mix` (1.001 `rulesmd.ini`), `multimd.mix` (YR MP maps) | `thememd.mix`, `ra2md.csf`, `mapsmd03.mix` |

Sources: ModEnc MIX table and "Location of files" **[V]**; `ra2.mix` size from [ts-redalert2 `REQUIRED_MIX_SIZES`](https://github.com/huangkaoya/ts-redalert2/blob/main/src/engine/gameRes/GameResImporter.ts) **[V]**. That YR installs into the RA2 folder and that the loose files carry these exact names in current digital releases (EA app / Steam "C&C Ultimate Collection") is **[I]**. It needs checking against the owner's install.

### Theater → MIX
Checked on the owner's Origin install (RA2 1.006 + YR 1.001) during the [#5 prototype](https://github.com/p0mz0r/chrono-battlefield/issues/5) **[V]**. RA2 MIXes are nested in `ra2.mix` and YR MIXes in `ra2md.mix`. Mount them all; later mounts (YR) win. ModEnc's table also lists `temperatmd`, `urbanmd`, `desertmd`, `urbannmd` and `lunarmd.mix`; **none of these exist** in this install. The YR-only theaters use `desert`, `urbann` and `lunar.mix` instead (no `md` suffix).

| Theater | Tile ext | In `ra2.mix` | In `ra2md.mix` |
|---|---|---|---|
| Temperate | `.tem` | `temperat`, `isotemp`, `tem` | `isotemmd` |
| Snow | `.sno` | `snow`, `isosnow`, `sno` | `snowmd`, `isosnomd` |
| Urban | `.urb` | `urban`, `isourb`, `urb` | `isourbmd` |
| Desert (YR) | `.des` | — | `desert`, `isodes`, `isodesmd`, `des` |
| NewUrban (YR) | `.ubn` | — | `urbann`, `isoubn`, `isoubnmd`, `ubn` |
| Lunar (YR) | `.lun` | — | `lunar`, `isolun`, `isolunmd`, `lun` |
| Generic | — | `generic`, `isogen` | `genermd`, `isogenmd` |

OpenRA's RA2 mod lists exactly the RA2 subset: `isosnow`, `isotemp`, `isourb`, `sno`, `snow`, `tem`, `temperat`, `urb`, `urban`, `generic`, `isogen`, `local`, `cache`, `conquer`, ... ([mod.yaml](https://github.com/OpenRA/ra2/blob/master/mods/ra2/mod.yaml)) **[V]**. Note that it also lists `snow.mix`/`temperat.mix`/`urban.mix` (theater SHP/palette mixes) separately from `sno/tem/urb.mix`; ModEnc's table merges these, so the exact split is **[I]**.

## 5. Legal guardrails (from sources, not legal advice)
- Every project here, Chrono Divide included, ships no EA data and makes the user supply it. **[V]**
- Chrono Divide *offers* an Internet Archive URL. Linking to third-party copies is a policy choice the project already ruled out ("never committed or redistributed"). **[I]**
- GPL code (XCC, OpenRA, CNCMaps, FA2, openra2) is fine to *read* for format facts. *Porting* it makes our code a derivative work. **[I]**

## New questions surfaced
1. **Will the battlefield set include YR maps or YR-only theaters?** If yes, YR files are required and Chrono Divide's RA2-only route can't be reused unchanged.
2. **Project licence:** is Rhino Race willing to be GPL-3.0? That decides between porting XCC/OpenRA/openra2, writing clean-room TS readers, or vendoring the Apache-2.0 Rust `ra-assets` via wasm.
3. **Is the stream commercial?** (bits, subs, sponsors.) That rules `@mixen/*` (non-commercial licence) in or out.
4. **Voxel rendering approach:** pre-render the Rhino's 32 facings to sprites at import time (as CD caches voxel models under `/cache`), or render the voxels live in WebGL?
5. **Which retail releases do we verify against?** We need size/CRC tables for RA2 1.006 and YR 1.001 MIXes from Origin/EA app/Steam/CD installs.
