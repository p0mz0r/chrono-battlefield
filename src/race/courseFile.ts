import { idb } from '../install/read.js';
import { courseSlug, isCourseFile, mapHash, type CourseFile } from './course.js';

// One course, one file (ADR 0007): `<name>.rhino-course.json` carries a course to an operator, with its custom map inside.

const FORMAT = 'rhino-course';

/** An imported course as stored in the OBS profile; `map` holds a custom map's bytes. */
export interface ImportedCourse {
  id: string;
  course: CourseFile;
  map?: Uint8Array;
}

// btoa/atob over chunks: a 200 KB map spread into one call overflows the argument list.
function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The export file's text. A custom map (`source: 'shipped'`) travels inside it; an install map never does. */
export function exportCourse(course: CourseFile, mapBytes?: Uint8Array): string {
  return JSON.stringify({ format: FORMAT, version: 1, course, ...(course.source === 'shipped' ? { mapFile: toBase64(mapBytes!) } : {}) });
}

/**
 * Checks an export file named `fileName` and returns the course it carries, or throws a message for the operator.
 * `installMap` reads a map from the operator's install (undefined when it has none).
 */
export async function readCourseFile(fileName: string, text: string, installMap: (path: string) => Promise<Uint8Array | undefined>): Promise<ImportedCourse> {
  let data: { format?: unknown; version?: unknown; course?: unknown; mapFile?: unknown } | undefined;
  try { data = JSON.parse(text) as typeof data; } catch { /* reported below */ }
  if (data?.format !== FORMAT || data.version !== 1 || !isCourseFile(data.course)) throw new Error(`${fileName} is not a Rhino Race course file`);
  const course = data.course;
  const id = `imported/${courseSlug(course.name)}`;
  if (course.source === 'shipped') {
    if (!course.author.trim() || !course.link.trim()) throw new Error(`The custom map in ${fileName} has no author or source link`);
    let map: Uint8Array | undefined;
    try { map = typeof data.mapFile === 'string' ? fromBase64(data.mapFile) : undefined; } catch { /* reported below */ }
    if (!map || mapHash(map) !== course.mapHash) throw new Error(`The map inside ${fileName} doesn't match its course`);
    return { id, course, map };
  }
  const bytes = await installMap(course.map).catch(() => undefined);
  if (!bytes || mapHash(bytes) !== course.mapHash) {
    throw new Error(`${fileName} needs the install map ${course.map}, which your install doesn't have or has in a different version`);
  }
  return { id, course };
}

// Beside the import cache in the OBS profile, keyed by id; survives reloads, restarts and release updates.
const store = <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) => idb('rhino-race-courses', mode, run);
export const importedCourses = () => store<ImportedCourse[]>('readonly', (s) => s.getAll());
export const saveImported = (imported: ImportedCourse) => store('readwrite', (s) => s.put(imported, imported.id));
export const removeImported = (id: string) => store('readwrite', (s) => s.delete(id));
