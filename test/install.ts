// Tests read the real install from RA2_DIR (EA files are never committed) and skip when it is unset.
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe } from 'vitest';

const dir = process.env.RA2_DIR;

export const describeInstall = describe.skipIf(!dir);

/** A `ReadFile` over RA2_DIR: the whole file, or `length` bytes at `offset`. */
export async function readFromDir(path: string, offset?: number, length?: number): Promise<Uint8Array> {
  if (offset === undefined) return new Uint8Array(await readFile(join(dir!, path)));
  const file = await open(join(dir!, path));
  try {
    const buf = new Uint8Array(length!);
    const { bytesRead } = await file.read(buf, 0, length!, offset);
    return buf.subarray(0, bytesRead);
  } finally { await file.close(); }
}
