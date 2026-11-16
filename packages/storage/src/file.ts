/**
 * The `.loreengine` file (spec 5.11): `project.json` plus the project's
 * blobs, zipped with fflate (Q14).
 *
 *   project.json
 *   blobs/<sha256>
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseProjectJson, serializeProject } from '@loreengine/schema';
import type { Project } from '@loreengine/schema';
import { sha256Hex } from './sha256.ts';
import { StorageError, referencedBlobIds } from './storage.ts';
import type { Storage } from './storage.ts';

export const PROJECT_FILE_EXTENSION = '.loreengine';

/** A blob source for export and sink for import; `Storage` satisfies it. */
export type BlobAccess = Pick<Storage, 'getBlob' | 'putBlob'>;

/**
 * Pack a project and every blob it references. A referenced blob that is
 * not in the store is left out (an unbaked placeholder atlas page, say)
 * and its id returned in `missing`.
 */
export async function exportProjectFile(project: Project, blobs: BlobAccess): Promise<{ bytes: Uint8Array; missing: string[] }> {
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(serializeProject(project)) };
  const missing: string[] = [];
  for (const blobId of [...referencedBlobIds(project)].sort()) {
    const bytes = await blobs.getBlob(blobId);
    if (bytes) files[`blobs/${blobId}`] = bytes;
    else missing.push(blobId);
  }
  // Stored, not deflated, and with a fixed timestamp: the same project exports to the same bytes.
  return { bytes: zipSync(files, { level: 0, mtime: new Date(1980, 0, 1) }), missing };
}

/**
 * Unpack and validate a `.loreengine` file, storing its blobs. Rejects a
 * file with no `project.json`, an invalid project (including schema 1), or
 * a blob whose bytes do not hash to its name.
 */
export async function importProjectFile(bytes: Uint8Array, blobs: BlobAccess): Promise<Project> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new StorageError('bad-archive', `Not a ${PROJECT_FILE_EXTENSION} file: it could not be unzipped.`);
  }
  const json = files['project.json'];
  if (!json) throw new StorageError('bad-archive', `Not a ${PROJECT_FILE_EXTENSION} file: project.json is missing.`);
  const parsed = parseProjectJson(strFromU8(json));
  if (!parsed.ok) throw new StorageError(parsed.issues[0]!.code, parsed.issues[0]!.message);

  const mimes = new Map<string, string>();
  const a = parsed.project.assets;
  for (const asset of [...a.vectorSources, ...a.images, ...a.audio]) mimes.set(asset.ref.blobId, asset.ref.mime);
  for (const atlas of a.atlases) for (const tier of atlas.tiers) mimes.set(tier.image.blobId, tier.image.mime);

  for (const name of Object.keys(files).sort()) {
    if (!name.startsWith('blobs/')) continue;
    const blobId = name.slice('blobs/'.length);
    const data = files[name]!;
    if ((await sha256Hex(data)) !== blobId) {
      throw new StorageError('blob-hash-mismatch', `Blob ${blobId} is corrupt: its bytes do not hash to its name.`);
    }
    if (!mimes.has(blobId)) continue; // not referenced by the project: do not import strays
    await blobs.putBlob(data, mimes.get(blobId)!);
  }
  return parsed.project;
}
