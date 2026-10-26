// Tests read the real install from RA2_DIR (EA files are never committed) and skip when it is unset.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe } from 'vitest';

const dir = process.env.RA2_DIR;

export const describeInstall = describe.skipIf(!dir);

export async function readFromDir(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(dir!, path)));
}
