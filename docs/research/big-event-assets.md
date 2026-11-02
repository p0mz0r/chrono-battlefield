# Big RA2/YR events, EVA lines and taunts: what the install has

Research for [#87](https://github.com/p0mz0r/chrono-battlefield/issues/87), part of [#85](https://github.com/p0mz0r/chrono-battlefield/issues/85). Researched 2026-11-02 against the owner's RA2 + YR install (`RA2_DIR`), read with the repo's own readers (`src/ra2/`).

Labels:
- **[V]** verified in the install: the INI line was read from the named file, and the art/sound file was found in the mounted MIXes and parsed by our reader.
- **[I]** inference, not checked against a source.

Sources are the install's own files. ModEnc (the usual secondary reference) returned HTTP 403 and the Wayback mirror was unreachable on this date, so nothing below rests on it.

## Answer

1. **Every candidate has its art and sound in a stock install, and our readers already parse all of the art.** Kirov, its bomb, the paradrop plane and the spy plane are **voxels** (VXL + HVA). Everything else is an **SHP** animation: nuke missile and mushroom cloud, Iron Curtain blast, storm clouds and bolts, Psychic Dominator, Chronosphere, chrono legionnaire warp, mind control, parachute, genetic mutator death, terror drone. The terror drone is an SHP in YR (`artmd.ini [DRON] Voxel=no`, no `dron.vxl`). **[V]**
2. **Every sound event below resolves through `soundmd.ini` to samples present in `audio.bag` / `audiomd.bag`.** `src/audio.ts` can play them by adding an entry to `EVENTS`. **[V]**
3. **EVA lines are not in the audio bags.** They are loose `.wav` files inside `langmd.mix > audiomd.mix` (`ceva###.wav` Allied, `csof###.wav` Soviet, `cyur###.wav` Yuri; also in `language.mix > audio.mix` for the RA2 lines). They are **IMA-ADPCM WAV** (format tag 17, mono, 22050 Hz, 4-bit). `evamd.ini` maps each event to its file names and display text. **[V]**
4. **Taunts** are 80 loose files in `RA2_DIR\Taunts\` (`tau<country>01-08.wav`, 10 countries), in the same IMA-ADPCM WAV format. **[V]**
5. **The one gap in our readers:** there is no reader for standalone WAV files. EVA and taunts need a small RIFF reader (find the `fmt ` block alignment and the `data` chunk) that feeds the IMA decoder we already have (`src/ra2/aud/adpcm.ts`, `decodeImaBlock`). Bag samples use the same Microsoft IMA block layout. **[V]** for the format tag; **[I]** that the existing block decoder needs no other change. Browsers' `decodeAudioData` does not reliably support IMA-ADPCM WAV **[I]**, so decode it ourselves.
6. **Engine-drawn parts with no art:** the Chrono Legionnaire beam (a line in `[AudioVisual] ChronoBeamColor=128,200,255`), the Iron Curtain tint on units (`IronCurtainColor`) and the mind-control link line. We would draw these ourselves. **[V]** for the keys.

The YR Psychic Dominator has no "activated" EVA line: `[EVA_PsychicDominatorActivated]` points to `Dummy` for all three sides. Its warning comes from the sound `PsychicDominatorActivate` (`$spsydom`). **[V]**

## Where things live

| What | INI that names it | Container | Format | Our reader |
|---|---|---|---|---|
| Game rules (superweapons, weapons, units) | `rulesmd.ini` (`expandmd01.mix`) | — | INI | `IniFile` |
| Art keys (voxel or SHP, rate, sounds on anims) | `artmd.ini` (`ra2md.mix > localmd.mix`) | — | INI | `IniFile` |
| Sound events → sample names | `soundmd.ini` (`expandmd01.mix`), RA2 `sound.ini` | — | INI | `IniFile` |
| EVA events → wav names + text | `evamd.ini` (`localmd.mix`) | — | INI | `IniFile` |
| SHP animations, infantry | — | `conqmd`/`genermd`/`conquer`/`generic` etc. (all found with `mountTheater(..., 'temperate')`) | SHP (TS/RA2), drawn with `anim.pal` | `ShpFile` |
| Voxels | — | same mounted MIXes | VXL + HVA, drawn with `unit<theater>.pal` | `VxlFile`, `HvaFile` |
| Sound effects, unit voices | `soundmd.ini` | `langmd.mix > audiomd.mix > audio.idx/.bag`, `language.mix > audio.mix > audio.idx/.bag` | IMA-ADPCM in a bag | `AudioBank` |
| EVA speech | `evamd.ini` | `langmd.mix > audiomd.mix` (740 entries) as loose `c{eva,sof,yur}NNN.wav` | IMA-ADPCM WAV | **none yet** |
| Taunts | — | `RA2_DIR\Taunts\tau{am,br,cu,fr,ge,ir,ko,li,ru,yu}0[1-8].wav` | IMA-ADPCM WAV | **none yet** |

Sources: `rulesmd.ini [General]` animation labels, `[SpecialWeapons]`, `[AudioVisual]`; `artmd.ini` sections below; `soundmd.ini` sections below; `evamd.ini [DialogList]` and per-event sections. **[V]**

## Candidates

"Readable" means the file is in the mounted MIXes and our reader parses it today (frame counts are from `ShpFile.parse`).

### Nuclear missile (`NukeSpecial`, silo `NAMISL`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Launch smoke at silo | `rulesmd [General] NukeTakeOff=NUKETO`; `artmd [NUKETO] StartSound=NukeLaunch`, translucent 75 | `nuketo.shp` (24 frames) | SHP | yes |
| Missile going up | `[NukeCarrier] Projectile=GiantNukeUp` → `[GiantNukeUp] Image=NKMSLUP`; trailer `NUKEPUFF` | `nkmslup.shp` (2), `nukepuff.shp` (20) | SHP | yes |
| Missile coming down | `[NukePayload] Projectile=GiantNukeDown` → `Image=NKMSLDN` | `nkmsldn.shp` (1) | SHP | yes |
| Mushroom cloud | `[NUKE] AnimList=NUKEANIM`; `artmd [NUKEANIM] Report=NukeExplosion` | `nukeanim.shp` (39) | SHP | yes |
| Infantry melting | `[General] InfantryNuked=NUKEDIE` | `nukedie.shp` (60) | SHP | yes |
| Sounds | `NukeLaunch` → `snuklaun`; `NukeExplosion` → `snukexpl`; `NukeSiren` → `snuksire` | bag | IMA bag | yes |
| EVA | `EVA_NuclearSiloDetected` (001), `EVA_NuclearMissileLaunched` "Warning: Nuclear Missile Launched." (002), `EVA_NuclearMissileReady` (003) | `ceva/csof/cyur00{1,2,3}.wav` | IMA WAV | no |

`NukeSiren` is only wired to `[AudioVisual] DigSound` in stock rules, with the comment "HACK: Nuke siren here since I believe this is unused". **[V]**

### Iron Curtain (`IronCurtainSpecial`, building `NAIRON`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Invocation blast | `[General] IronCurtainInvokeAnim=IRONBLST`; `artmd [IRONBLST] Report=IronCurtainBlast`, translucent 50 | `ironblst.shp` (22) | SHP | yes |
| Shot deflected | `WeaponNullifyAnim=IRONFX`; `Report=IronCurtainDeflect` | `ironfx.shp` (10) | SHP | yes |
| Red tint on units | `[AudioVisual] IronCurtainColor` | engine-drawn | — | n/a |
| Sounds | `IronCurtainBlast` → `siroon`; `IronCurtainDeflect` → `sirodefa..d` (random) | bag | IMA bag | yes |
| EVA | `EVA_IronCurtainDetected` (004), `EVA_IronCurtainActivated` (005), `EVA_IronCurtainReady` (006) | `c*00{4,5,6}.wav` | IMA WAV | no |

### Lightning storm (`LightningStormSpecial`, building `GAWEAT`, image `GAWETH`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Clouds | `[General] WeatherConClouds=WCCLOUD1,2,3`; `artmd Layer=Top AltPalette=yes` | `wccloud1-3.shp` (59/60/60) | SHP | yes |
| Bolts | `WeatherConBolts=WCLBOLT1,2,3` | `wclbolt1-3.shp` (3 each) | SHP | yes |
| Bolt impact | `WeatherConBoltExplosion=EXPLOLB` (crater, scorch) | `explolb.shp` (31) | SHP | yes |
| Sounds | `[AudioVisual] StormSound=WeatherIntro` → `sweaintr`; `LightningSounds=WeatherStrike` → `sweastra..d` | bag | IMA bag | yes |
| EVA | `EVA_WeatherDeviceReady` "Weather Control Device detected." (010), `EVA_LightningStormCreated` "Warning: Lightning Storm created." (011), `EVA_LightningStormReady` (012) | `c*01{0,1,2}.wav` | IMA WAV | no |

Timing in `rulesmd [General]`: `LightningStormDuration=180`, `LightningHitDelay=10`, `LightningScatterDelay=5`, `LightningCellSpread=10`, `LightningSeparation=3`, `LightningDeferment=250` frames. **[V]** `AltPalette=yes` on the clouds means they are not drawn with plain `anim.pal` **[I]** (which palette the engine uses was not checked).

### Chronosphere (`ChronoSphereSpecial`, building `GACSPH`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Source marked | `ChronoPlacement=CHRONOAR`, loops 11-17; `StartSound=ChronosphereSelect` | `chronoar.shp` (22) | SHP | yes |
| Source fires | `ChronoBlast=CHRONOFD` | `chronofd.shp` (17) | SHP | yes, already used (`src/load.ts` `warpOut`) |
| Destination | `ChronoBlastDest=CHRONOTG`; `StartSound=ChronosphereMove` | `chronotg.shp` (17) | SHP | yes, already used (`warpIn`) |
| Unused beam | `ChronoBeam=CHRONOBM` ("no longer used") | `chronobm.shp` (15) | SHP | yes |
| Sounds | `ChronosphereSelect` → `schrlo1, schrlo2a..c, schrlo3` (loop); `ChronosphereMove` → `schrmov` (already a cue in `src/audio.ts`) | bag | IMA bag | yes |
| EVA | `EVA_ChronosphereDetected` (007), `EVA_ChronosphereActivated` (008), `EVA_ChronosphereReady` (009) | `c*00{7,8,9}.wav` | IMA WAV | no |

### Chrono Legionnaire (`CLEG`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Infantry | `artmd [CLEG] Sequence=ClegSequence` | `cleg.shp` (346) | SHP | yes |
| Beam | `[NeutronRifle] IsRadBeam=yes`, colour `ChronoBeamColor=128,200,255` | engine-drawn | — | n/a |
| Target erased | `WarpAway=WARPAWAY`; `Report=ChronoLegionKill` | `warpaway.shp` (23) | SHP | yes |
| Being chrono'd | `ChronoSparkle1=CHRONOSK` | `chronosk.shp` (13) | SHP | yes |
| Teleport in/out | `WarpIn=WARPIN`, `WarpOut=WARPOUT` | `warpin.shp` (10), `warpout.shp` (21) | SHP | yes |
| Sounds | `ChronoLegionAttack` → `ichratta`; `ChronoLegionKill` → `ichrkill`; `ChronoLegionTeleport` → `ichrmova`; `ChronoLegionSelect` → `$ichrsea..e` | bag | IMA bag | yes |

### Psychic Dominator (`PsychicDominatorSpecial`, building `YAPPET`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Giant head | `[General] DominatorFirstAnim=PDFXCLD`, effect fires at 20 % (`DominatorFireAtPercentage`) | `pdfxcld.shp` (60) | SHP | yes |
| Ground ring | `DominatorSecondAnim=PDFXLOC` | `pdfxloc.shp` (21) | SHP | yes |
| Sound | `[AudioVisual] PsychicDominatorActivateSound=PsychicDominatorActivate` → `$spsydom` | bag | IMA bag | yes |
| EVA | `EVA_PsychicDominatorDetected` (125), `EVA_PsychicDominatorReady` (127); `…Activated` is `Dummy` | `c*12{5,7}.wav` | IMA WAV | no |

### Yuri mind control (`YURI`, Yuri Prime `YURIPR` image `YURIX`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Infantry | `artmd [YURI]`, `[YURIX]` | `yuri.shp` (632), `yurix.shp` (576) | SHP | yes |
| Control shot | `[MindControl] Anim=YURICNTL` | `yuricntl.shp` (21) | SHP | yes |
| Over controlled unit | `ControlledAnimationType=MINDANIM`, `PermaControlledAnimationType=MINDANIMR` | `mindanim.shp`, `mindanimr.shp` (8 each) | SHP | yes |
| Link line | engine-drawn (`MindControlAttackLineFrames=20`) | — | — | n/a |
| Psi wave (deploy) | `[PsiWave] Anim=RING1`, `Report=YuriDeploy` | `ring1.shp` (21) | SHP | yes |
| Sounds | `YuriMindControl` → `iyurat1a`; `MindCleared` → `gmindcle`; `YuriDeploy` → `iyurat2a`; voices `YuriCloneSelect`, `YuriPrimeSelect` | bag | IMA bag | yes |

### Genetic Mutator (`GeneticConverterSpecial`, building `YAGNTC`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Infantry mutating | `[General] InfantryMutate=GENDEATH`; `StartSound=GeneticMutatorActivate`, `Report=InfantryMelt` | `gendeath.shp` (60) | SHP | yes |
| Result | `MakeInfantry=0` → `[General] AnimToInfantry=BRUTE` (index 0, the Brute) | — | — | — |
| Sounds | `GeneticMutatorActivate` → `sgenon`; `InfantryMelt` → `igenmela..c` | bag | IMA bag | yes |
| EVA | `EVA_GeneticMutatorDetected` (128), `…Activated` (129), `…Ready` (130) | `c*12{8,9}.wav`, `c*130.wav` | IMA WAV | no |

### Kirov airship (`ZEP`) and its bombs

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Airship | `artmd [ZEP] Voxel=yes` | `zep.vxl` (1 section) + `zep.hva` | VXL | yes |
| Bomb | `[BlimpBomb] Projectile=BlimpBombP` → `Image=ZBOMB`; `artmd [ZBOMB] Voxel=yes` | `zbomb.vxl` + `.hva` | VXL | yes |
| Bomb hit | `[BlimpHE] AnimList=XGRYSML1,…,EXPLOLRG,TWLT070` | e.g. `twlt070.shp` (26) | SHP | yes |
| Sounds | `KirovSelect` → `$vkirseb..d` ("Kirov reporting" family); `KirovCreated` → `$vkirsea`; `KirovMove`, `KirovAttackCommand`; `KirovAttack` → `vkiratta` (bomb drop); `KirovMoveLoop` → `vkirlo*` (engine drone); `KirovDie`, `KirovVoiceDie`, `KirovCrash` | bag | IMA bag | yes |
| EVA | none for the unit itself; closest is `EVA_EnemyAirArmadaDetected` "Warning: Enemy Air Armada detected." (096) | `c*096.wav` | IMA WAV | no |

### Terror drone (`DRON`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Drone | `artmd [DRON] Voxel=no`, `WalkFrames=6`, `FiringFrames=4`; no `dron.vxl` in the install | `dron.shp` (176) | SHP | yes |
| Sounds | `TerrorDroneAttack` → `vteratta` (the leap); `TerrorDroneSelect` → `vtersela/b`; `TerrorDroneMoveLoop` → `vterlo*`; `TerrorDroneDie` → `vterdiea/b` | bag | IMA bag | yes |

### Paradrops (`ParaDropSpecial` / `AmericanParaDropSpecial`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Plane | `PDPLANE`, `artmd [PDPLANE] Voxel=yes` | `pdplane.vxl` + `.hva` | VXL | yes |
| Parachute | `[General] Parachute=PARACH`, loops 20-39, `AltPalette=yes` | `parach.shp` (140) | SHP | yes |
| Bomb parachute | `BombParachute=PARABOMB` | `parabomb.shp` (26) | SHP | yes |
| Drop zone flare | `DropZoneAnim=BEACON` | `beacon.shp` (10) | SHP | yes |
| Troopers | `AmerParaDropInf=E1`; Yuri `INIT` | `init.shp` (612). `e1.shp`/`e2.shp` were not found by those names (their art has an `Image=` alias **[I]**, not followed) | SHP | — |
| Sounds | `[AudioVisual] ChuteSound=ParachuteDrop` → `sparadra`; `PDPlaneMoveLoop` → `sparlo2a..c` | bag | IMA bag | yes |
| EVA | `EVA_ReinforcementsHaveArrived` (038), `EVA_ReinforcementsReady` (121) | `c*038.wav`, `c*121.wav` | IMA WAV | no |

### Spy plane (`SpyPlaneSpecial`, `SPYP`)

| Part | Source key | File | Type | Readable |
|---|---|---|---|---|
| Plane | `artmd [SPYP] Voxel=yes` | `spyp.vxl` (4 sections) + `.hva` | VXL | yes |
| Sounds | `SpyPlaneCamera=SpyPlaneSnapshot` → `vspysnap` (every 16 frames); `SpyPlaneMoveLoop` → `vspylo2a..c` | bag | IMA bag | yes |
| EVA | `EVA_SpyPlaneEnRoute` (142), `EVA_SpyPlaneReady` (153) | `c*142.wav`, `c*153.wav` | IMA WAV | no |

## Other EVA lines a race could use

All present for all three sides in `langmd.mix > audiomd.mix`, IMA WAV. **[V]**

| Event | Text (from `evamd.ini`) | File stem |
|---|---|---|
| `EVA_EstablishBattlefieldControl` | "Establishing battlefield control… standby." | 016 |
| `EVA_BattleControlTerminated` | "Battle control terminated." | 015 |
| `EVA_YouAreVictorious` | "You are victorious." | 022 |
| `EVA_YouHaveLost` | "You have lost." | 023 |
| `EVA_UnitLost` | "Unit lost." | 064 |
| `EVA_UnitPromoted` | "Unit promoted" | 079 |
| `EVA_UnitReady` | "Unit Ready." | 062 |
| `EVA_ConstructionComplete` | "Construction Complete." | 048 |
| `EVA_BridgeRepaired` | "Bridge repaired." | 046 |

The full list is `evamd.ini [DialogList]`. Some YR events have an empty `Text=` (for example the Dominator and Mutator lines); the spoken words are in the WAV only.

## Taunts

`RA2_DIR\Taunts\` holds 8 taunts for each of 10 countries: `am` America, `br` Britain, `cu` Cuba, `fr` France, `ge` Germany, `ir` Iraq, `ko` Korea, `li` Libya, `ru` Russia, `yu` Yuri **[I]** for the country names, from the file prefixes. All 80 are IMA-ADPCM WAV (tag 17), mono, 22050 Hz. They are loose files, not in a MIX. **[V]** Chrono Divide also copies the `Taunts/` folder at import (see `ra2-file-formats.md` TL;DR item 3).

## What our readers can't do yet

- **Standalone IMA-ADPCM WAV** (EVA, taunts): needs a RIFF chunk reader in front of `decodeImaBlock`. The rest of the pipeline (`AudioContext` buffer creation in `src/audio.ts`, the import cache) carries over.
- **`AltPalette=yes` anims** (storm clouds, parachute): which palette the engine swaps in was not checked.
- **Infantry `Image=` aliases** (`E1`, `E2`): not followed here; `src/ra2/` has no art-alias lookup beyond what `load.ts` hard-codes.

## Method

A throwaway Vitest file (deleted, not committed) mounted the stock MIXes with `mountTheater(readFromDir, 'temperate')`, then:
- read `rulesmd.ini`, `artmd.ini`, `soundmd.ini`, `sound.ini`, `evamd.ini` from the VFS;
- parsed each art file with `ShpFile`, `VxlFile`, `HvaFile`;
- resolved each sound event in `soundmd.ini` then `sound.ini` and looked its samples up in both `AudioBank` indexes;
- opened `langmd.mix > audiomd.mix` with `MixFile` and read each EVA WAV header;
- read every WAV header in `Taunts\`.

Only stock archives were mounted (`ra2.mix`, `ra2md.mix`, `expandmd01.mix`, `language.mix`, `langmd.mix`). The install also carries CnCNet/Ares files (`ares.mix`, `cncnet.mix`, `ra2mode.mix`), which change rules and were ignored, as in `src/ra2/mount.ts`.
