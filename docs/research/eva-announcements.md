# Nuclear EVA announcements

Issue: [#106](https://github.com/p0mz0r/chrono-battlefield/issues/106), part of [#101](https://github.com/p0mz0r/chrono-battlefield/issues/101).

Verified against the local install on 2026-11-05. `ra2md.mix > localmd.mix > evamd.ini` supplies the Allied EVA sample names; the WAVs live in `langmd.mix > audiomd.mix`. `loadSounds` exposes these cue names:

| Cue | EVA section | Sample | PCM samples |
| --- | --- | --- | --- |
| `nukeDetected` | `EVA_NuclearSiloDetected` | `ceva001.wav` | 49407 |
| `nukeReady` | `EVA_NuclearMissileReady` | `ceva003.wav` | 27037 |
| `nukeLaunch` | `EVA_NuclearMissileLaunched` | `ceva002.wav` | 49381 |

All three WAVs declare format 0x11 (IMA-ADPCM), mono, 22050 Hz, 512-byte blocks and 1017 samples per block. Each block starts with a signed 16-bit predictor, a step index and a reserved zero byte, followed by low-nibble-first codes. The `fact` sample count trims padding from the final block. The reader reuses the existing IMA decoder; it rejects other codecs and channel layouts.

Sources: the install files above, including each WAV's `fmt `, `fact` and `data` chunks. `src/ra2/aud/wav.test.ts` checks the sample counts and a manually decoded opening vector without shipping any install bytes. `src/audio.test.ts` checks playback from the import cache.
