# MIX reading and browser storage

Research for [#15](https://github.com/p0mz0r/chrono-battlefield/issues/15), from the [#5 prototype](https://github.com/p0mz0r/chrono-battlefield/issues/5) (branch `prototype/battlefield-and-rhino`, commit `ce372d2`). Researched 2026-10-23. No code changed.

Labels: **[V]** verified in a primary source or measured here; **[I]** my inference; **UNVERIFIED** with the test that settles it (see the list at the end).

## 1. Where the 610 MB comes from

- `prototype-battlefield/main.ts:132-137` fetches each top-level MIX whole with `fetch(...).arrayBuffer()` (`urlSource`, `main.ts:46-52`). **[V]**
- `mixFile.ts` keeps that buffer alive; `readById` returns a `subarray`, and `vfs.mountNested` reads nested MIXes as `subarray`s of the outer buffer, so nested archives add no copy (`vendor/formats/mix/mixFile.ts:184-187`, `vfs.ts:41-45`). **[V]**
- Sizes of the three top-level MIXes on the owner's install (`stat`, read-only): `ra2.mix` 281,888,480 B, `ra2md.mix` 204,527,696 B, `expandmd01.mix` 4,813,968 B. Sum **491.2 MB**. **[V]**
- The reported ~610 MB JS heap (#5 comment) is that 491 MB plus about 120 MB of other allocations. Stage measurement (section 7, T7) puts about 100 MiB of it in the terrain chunks' raw pixel buffers (one 16 MiB buffer per 2048 px chunk). The browser breakdown is **UNVERIFIED**: canvas backing stores may sit outside the JS heap.

## 2. MIX layout (RA2/YR)

Read from the openra2 reader at `8ba59f0` (`packages/formats/src/mix/mixFile.ts`), which is byte-identical to the prototype's `vendor/formats/mix/mixFile.ts` (checked with `diff`). Cross-checked against XCC and OpenRA. **[V]**

- **Header:** `u32 flags` at offset 0. `0x10000` = 20-byte checksum footer; `0x20000` = encrypted header and index. All three top-level MIXes on the owner's install have flags `0x30000` (both bits set); probed by reading only the header and index. **[V]**
- **Encrypted header:** 80-byte key source at offset 4, turned into a 56-byte Blowfish key by `getBlowfishKey`; the 8-byte block at offset 84 decrypts to `u16 c_files` and `i32 body_size`. The index (12 bytes per entry: `u32 id`, `i32 offset`, `i32 size`) follows, padded to 8 bytes. Data starts at `92 + ((c_files*12 + 5) & ~7)`. Entry offsets are relative to that data start. **[V]** XCC `misc/mix_file.cpp:180-236` (`seek(4)`, key, `cb_f = cb_index + 5 & ~7`, `92 + cb_f`); OpenRA `MixFile.cs` `DecryptHeader`, `GetContent` (`SegmentStream` at `dataStart + entry.Offset`, lines 183-185).
- **Length check:** the prototype requires the file length to equal `dataBase + body_size (+20)` exactly (`mixFile.ts:91-93`, `130-132`). XCC checks the same (`mix_file.cpp:195`). Streaming readers can check it by counting bytes instead. **[V]**
- **Lookup by id:** id = reflected CRC-32 of the upper-cased name (`/` to `\`) with XCC's tail padding. The prototype's `crc.ts` follows `Cmix_file::get_id` (`mix_file.cpp:353-371`). Names are not stored; you ask for a known name and hash it. **[V]**
- **Index position:** the index is at the start of each archive. Measured dataBase (= header + index size): `ra2.mix` 348 B (21 entries), `ra2md.mix` 396 B (25 entries), `expandmd01.mix` 492 B (33 entries). A nested MIX's index sits at the start of its own entry. **[V]** (read-only probe, script kept in `/tmp`, not in the repo)
- **Nested archives are big:** `local.mix` 34.8 MB, `isotemp.mix` 29.2 MB, `isourb.mix` 31.8 MB, `isosnow.mix` 28.8 MB, `generic.mix` 15.8 MB, `conquer.mix` 16.3 MB; in `ra2md.mix`, `isodes.mix` 35.7 MB, `isoubn.mix` 32.4 MB. The `*.mix` entries needed for tiles and voxels are 20-35 MB each, not small. **[V]** (same probe)

**Conclusion:** a single entry can be read with a few small reads: the top-level index (under 0.5 KB), the nested index (a few hundred bytes at the nested offset), then the entry bytes. XCC and OpenRA both read this way (seek/read, not whole-file). **[V]**

## 3. How the install reaches the page in OBS (`http://absolute/`)

- Registration: `obs-browser-plugin.cpp:413` (`CefRegisterSchemeHandlerFactory("http", "absolute", ...)`). **[V]**, [obs-browser @ master](https://github.com/obsproject/obs-browser/blob/master/obs-browser-plugin.cpp)
- Handler: `browser-scheme.cpp:24-84` opens `CefStreamReader::CreateForFile(path)` and returns `new CefStreamResourceHandler(mimeType, stream)` (line 83). It parses no request headers. **[V]**, [browser-scheme.cpp](https://github.com/obsproject/obs-browser/blob/master/browser-scheme.cpp)
- CEF's handler (`libcef_dll/wrapper/cef_stream_resource_handler.cc`): `GetResponseHeaders` always sets status 200 and `response_length = -1` (no Content-Length); `Read` returns the stream in order; the file has no `Range` handling at all. **[V]** [cef_stream_resource_handler.cc:47-62, 64-85](https://github.com/chromiumembedded/cef/blob/master/libcef_dll/wrapper/cef_stream_resource_handler.cc)
- **So `fetch(url, {headers: {Range: ...}})` gets 200 with the whole file.** Byte-range reads are not possible over `http://absolute/`. Early stop is possible in principle: cancel the reader after N bytes, since `Cancel()` is a no-op and reads just stop (**UNVERIFIED**, test T2). A prefix read works only from the start of a file, so you can't jump to an offset without streaming past everything before it. **[I]**
- OBS maintainers, commit `6b6d45629207b6b01def7ef0c72e9d64a07c163b` (2026-10-05, "Additional restrictions on custom scheme handler"): "we should consider removing the http://absolute handler entirely in a future update". **[V]** This confirms the risk in #4 and #11.
- #5 comment (OBS 32.2.1): `fetch('http://absolute/D:/...ra2.mix')` of the three full archives worked; mounted in 1.0 s. **Reported by the author, not re-run here.** The transport works; the cost is memory.
- Version caveat: checked master of obs-browser and CEF master. T1 confirms Range is ignored on OBS 32.2.1 (section 7); OBS 33 RC is still **UNVERIFIED**.

## 4. Browser storage in the OBS Local-file page (non-secure context)

Secure-context rule: a page is a secure context when its origin is potentially trustworthy. `file:` origins are trustworthy, `localhost` and `*.localhost` are trustworthy, and other `http:` origins are not. `http://absolute` matches none of these. **[V]** [W3C Secure Contexts, section 3.1](https://w3c.github.io/webappsec-secure-contexts/). So the OBS page is **not** a secure context. **[I]** that OBS does not pass `--unsafely-treat-insecure-origin-as-secure` (test T4).

| API | Secure-context only? | Available on OBS `http://absolute`? | Source |
|---|---|---|---|
| IndexedDB | no (no SecureContext on MDN) | yes, verified on OBS 32.2.1 | MDN IndexedDB page; T3 |
| localStorage | no | yes, verified on OBS 32.2.1; **5 MiB** per origin | MDN "Storage quotas" (the same page also says 10 MiB in one place; use 5) |
| Cache Storage (`caches`) | **yes** | **no** | [MDN Cache](https://developer.mozilla.org/en-US/docs/Web/API/Cache) header |
| OPFS | **yes** | **no** | [MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) header |
| File System Access (`showDirectoryPicker`) | **yes** | **no** | [MDN showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker) header |
| `navigator.storage.estimate()` | **yes** | **no**, so quota can't be read; probe with writes | [MDN estimate](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate) header |

**Check of #4:** its claims hold. WebGL, IndexedDB and localStorage are the usable storage; OPFS, WebGPU and File System Access are blocked by the secure-context rule (verified above). IndexedDB and localStorage work in OBS 32.2.1 (T3, section 7). **[V]** for both sets.

**Persistence across OBS restarts [V]:** `obs-browser-plugin.cpp:359-363` sets `cache_path` and `root_cache_path` to the plugin config directory (`obs_module_config_path`, line 301). So the Chromium profile, including IndexedDB, lives on disk. A clean OBS restart keeps both localStorage and IndexedDB (T3, verified on 32.2.1). "Refresh cache of current page" calls `ReloadIgnoreCache()` (`obs-browser-source.cpp`, `Refresh`), which is a page reload, not a storage wipe **[I]**.

## 5. Cache sizes and quotas

- Chromium/Edge: an origin may store up to **60% of disk** in best-effort and persistent modes. [MDN, Storage quotas, "Chrome and Chromium-based browsers"](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria). **[V]** In OBS 32.2.1 the IndexedDB quota is above 2.1 GB (T3); the cap was not found.
- Decoded chunk textures are large: the prototype's terrain chunk is `2048 x 2048 x 4` = 16 MiB raw RGBA (`main.ts:23`, `191-230`). A map covering several chunks is tens to ~100 MiB of decoded pixels. **[V]** arithmetic; **UNVERIFIED** total for a real map. Store **encoded** images (PNG/WebP Blobs) and decode on demand; keep decoded textures in GPU memory only.
- Measured (T8, section 7): a 2048 px chunk is about 1.6 MB as PNG on average (96 MiB raw compresses to 9.6 MB for a six-chunk map). A Rhino's 64 facings are about 1.7 KB each for the body and 0.9 KB for the turret as PNG, so roughly 82 KB per Rhino.
- Voxel facings: 64 sprites per Rhino (32 hull + 32 turret, ADR 0002).

## 6. Recommendation

**Read: entries on demand, never whole archives.** Split `MixFile.parse` into `readIndex(read)` (header plus index only) and `readEntry(id)`. Keep the parser as is (it is the openra2 code). Put one seam, `readRange(file, offset, length)`, under the #11 "one install-read function". Backends:

1. **File / FileSystemFileHandle** (picker, Edge): `File.slice()` is native random access. Use it.
2. **Dev server** (`server.mjs`, and the #11 Vite middleware): add `Range` to the handler, returning 206 and `createReadStream({start, end})`. About 10 lines. Needed only if the dev server reads the install.
3. **OBS `http://absolute`**: no ranges. Read the top-level index with a prefix read (stop after the index bytes). For the entries, do **one streaming pass per cache miss**: copy only the wanted entries as their offsets go by, buffering a nested MIX only when it is wanted. Peak memory is about the largest wanted nested archive (`local.mix`, 34.8 MB) plus the wanted entries, not 491 MB. The pass reads the full 491 MB once; A plain streaming read of the 491 MB took about 1 s on OBS 32.2.1 with heap rising about 25 MB (T6, section 7). The length check becomes a byte count against `dataBase + body_size + 20` (flags `0x30000`).

**Cache: what the import produces, in IndexedDB, under one key.**

- Prerendered Rhino facings: 64 encoded images (or one atlas per model), key `<installKey>/rhino/<model>/<facing>`.
- Baked terrain chunks: encoded per map and chunk, key `<installKey>/map/<name>/<cx>,<cy>`.
- `installKey`: CRC-32 (`crc.ts` `crc32`) over the top-level index bytes plus the three `body_size` values. Changing the install changes the key. This avoids secure-context APIs.
- Settings: localStorage (#11), 5 MiB cap, so no artifacts there.
- **Not cached:** raw MIX bytes. They duplicate the install. The only exception is the #11 upload fallback (stored as uploaded).
- Do not use Cache Storage or OPFS in OBS (blocked). Use IndexedDB in both backends so there is one code path.

**Ceiling and upgrade path:**

1. OBS: one streaming pass (about 491 MB read) per install version. Peak memory is the largest wanted nested archive. Ceiling: a cache miss costs a full read.
2. IndexedDB quota in CEF: above 2.1 GB (T3), cap not found. The baked output grows per map, so this is the first limit to hit.
3. Removal of `http://absolute` (commit `6b6d456`): the localhost server becomes the backend behind `readRange`, with Range support (backend 2 above). Loopback is a secure context, so Cache Storage and OPFS come back if needed. Only the backend changes.
4. GPU/heap: keep encoded blobs, decode and evict chunk textures on demand. Decoded chunks are the main heap cost after the MIX fix.

## 7. Test results (OBS 32.2.1, 2026-10-23)

Run in OBS 32.2.1 (obs-browser 2.26.9, CEF 127.0.6533.120, obs-websocket 5.7.4) on the owner's machine. The test page and driver lived outside the repo. Each run used a temporary scene with a Local-file browser source; the input and scene were removed and the original scene restored afterwards. OBS was started for the tests and closed after. **OBS 33 RC was not tested.**

- **T1 (Range) [V]:** `fetch(..., {headers: {Range: 'bytes=0-15'}})` on `expandmd01.mix` returned status 200, no `content-range`, and a 4,813,968 B body (the full file). Ranges are ignored, as section 3 says. **Anomaly:** the response's `content-length` header reads `16`, which doesn't match the body. Don't size reads from Content-Length over `http://absolute`.
- **T2 (early stop) [partial]:** the first 64 KB of `ra2md.mix` arrived in 1–2 ms and `cancel()` returned. This shows the prefix read is quick to start. It doesn't show that cancel stops the transfer, since bytes sent after cancel weren't counted. Still needs a server-side byte counter.
- **T3 (storage) [V]:** `indexedDB` and `localStorage` both work. IndexedDB accepted 2,100 MB in 100 MB Blobs with no `QuotaExceededError`; the loop stopped at my 2 GB cap, so the real cap is above 2.1 GB and was not found. **Restart [V]:** a marker written before a clean OBS exit was read back after reopening OBS, in both localStorage and IndexedDB.
- **T4 (secure context) [V]:** `isSecureContext` is false; `caches`, `navigator.storage.getDirectory` and `crypto.subtle` are all undefined. This matches the table in section 4.
- **T5 (localhost / `file://`) [not completed]:** Edge headless printed no DOM output in this environment, across three attempts including a separate profile. Still needed.
- **T6 (streaming cost) [V, plain stream reader, not the prototype]:** streaming `ra2.mix` (281.9 MB) took 529–563 ms, `ra2md.mix` (204.5 MB) 385–396 ms, and `expandmd01.mix` 8–14 ms, over two runs. Heap rose 24–27 MB above the start and fell to 5–21 MB after GC. Discarding bytes as they stream is cheap, so the pass in section 6 is viable. The prototype-level cost is still unmeasured. Heap figures come from `performance.memory`, which is Chromium-only.
- **T7 (heap source) [partial, Node not the browser]:** the prototype's loading and painting code ran in Node (`vendor/` is DOM-free; `t8.ts`, temp copy of `prototype/battlefield-and-rhino`, not in the repo). Stage memory, after GC: after mounting the three top-level MIXes, 469 MiB of ArrayBuffers (= the 491 MB of archives); after the Rhino, 475 MiB; after terrain painting, 569 MiB (+94 MiB: the six 16 MiB chunk buffers, one per 2048 px chunk). So the terrain chunks account for most of the ~120 MB. Caveat: this is Node, not CEF, and `performance.memory` counts JS heap only. Whether CEF counts canvas backing stores there is **UNVERIFIED**, so the ~610 MB figure may be process memory rather than JS heap. A DevTools heap snapshot in Edge would settle it.
- **T8 (sprite and chunk sizes) [V, PNG only]:** a 4920×3450 px map (`4_strip_mine`, desert) has six drawn chunks. PNG (zlib level 9, RGBA): first chunk 2.2 MB, average 1.6 MB, 9.6 MB total for 96 MiB raw. Rhino body atlas 256×256, 45 KB PNG, 32 facings averaging 1.7 KB each. Turret atlas 22 KB, 0.9 KB per facing. WebP not measured; no encoder in the setup. PNG already sizes the budget well enough.
- **T9 (CEF) [partial]:** the OBS 32.2.1 log gives obs-browser 2.26.9 and CEF 127.0.6533.120, which matches the page's user agent. The #4 claim about OBS 31/32 wasn't checked, and OBS 33 RC wasn't checked.

## Sources

- openra2 `mixFile.ts` @ 8ba59f0: https://github.com/harshilmathur/openra2/blob/8ba59f0/packages/formats/src/mix/mixFile.ts
- XCC `misc/mix_file.cpp` (GPL-3.0): https://github.com/OlafvdSpek/xcc/blob/master/misc/mix_file.cpp
- OpenRA `OpenRA.Mods.Cnc/FileSystem/MixFile.cs` (GPL-3.0): https://github.com/OpenRA/OpenRA/blob/bleed/OpenRA.Mods.Cnc/FileSystem/MixFile.cs
- obs-browser `browser-scheme.cpp`, `obs-browser-plugin.cpp`, commit `6b6d456`: https://github.com/obsproject/obs-browser
- CEF `cef_stream_resource_handler.cc`: https://github.com/chromiumembedded/cef/blob/master/libcef_dll/wrapper/cef_stream_resource_handler.cc
- W3C Secure Contexts: https://w3c.github.io/webappsec-secure-contexts/
- MDN Storage quotas: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Repo: `prototype/battlefield-and-rhino` `prototype-battlefield/main.ts`, `vendor/formats/mix/mixFile.ts`, `vendor/formats/mix/vfs.ts`; `docs/adr/0002`, `0003`; `docs/agents/ra2-install.md`; issues #4, #5, #11.
