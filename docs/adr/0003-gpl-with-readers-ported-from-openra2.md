# GPL-3.0-or-later, reading RA2 files with readers ported from openra2

Rhino Race is licensed GPL-3.0-or-later so that it can read the game's files with TypeScript readers copied from [openra2](https://github.com/harshilmathur/openra2) at `8ba59f0`, the same code the [#5 prototype](https://github.com/p0mz0r/chrono-battlefield/issues/5) used to draw a real battlefield and a Rhino. No permissively licensed, maintained JS/TS parser exists ([#2](https://github.com/p0mz0r/chrono-battlefield/issues/2)), and the GPL costs us little: the game runs on one streamer's PC and its source goes along with it. We give up any closed or permissive release for good. We copy only the readers a battlefield and a Rhino need (MIX with Blowfish and CRC, INI, map with IsoMapPack, LZO, LCW and OverlayPack, TMP, SHP, VXL/HVA, PAL), keep openra2's notices on those files, and maintain them ourselves without tracking upstream. Each reader gets one small test that reads the real install from `RA2_DIR` and skips when it is unset, because EA files are never committed.

## Considered Options

- **Clean-room TypeScript readers**: keeps any licence open, but costs weeks of format work before any game code exists.
- **Apache-2.0 Rust `ra2.exe` compiled to wasm**: permissive and complete, but the crate isn't published, and it adds a Rust toolchain and a wasm boundary to a TypeScript + Vite project.
- **`@mixen/*`**: licensed for non-commercial use only, and the stream earns money (Twitch and YouTube partner: subs, bits, donations, Super Chats); that licence also can't be combined with GPL code.
- **`ts-redalert2`**: derived from Chrono Divide's closed client and forbids this kind of use.
