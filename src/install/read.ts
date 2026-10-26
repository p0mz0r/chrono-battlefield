/**
 * Reads one file of the operator's RA2 + YR install, by its path inside the install folder
 * (`ra2.mix`, `Maps/Yuri's Revenge/x.map`). Every install read goes through here (ADR 0004).
 * Backend so far: the dev server's `/ra2/` middleware serving `RA2_DIR`.
 * The OBS `http://absolute/` and IndexedDB-upload backends come later.
 */
export async function readInstall(path: string): Promise<Uint8Array> {
  const res = await fetch(`/ra2/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!res.ok) throw new Error(`Missing install file: ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}
