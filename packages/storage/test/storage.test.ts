import { IDBFactory } from 'fake-indexeddb';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { EMPTY_BLOB_ID, V060_PROJECT, buildEmberfall, id } from '@loreengine/fixtures';
import { createRuntime, emptyInput } from '@loreengine/runtime';
import { defaultPrefs, serializeProject } from '@loreengine/schema';
import type { Id, Project, SaveKind, SaveState } from '@loreengine/schema';
import { Storage, StorageError, exportProjectFile, exportSave, importProjectFile, importSave, referencedBlobIds, sha256Hex, sha256HexSync } from '../src/index.ts';

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** A fresh in-memory database, with a clock that advances one second per save. */
async function open(options: { autosaveLimit?: number } = {}): Promise<Storage> {
  let clock = Date.UTC(2026, 10, 17, 1, 0, 0);
  let n = 0;
  return Storage.open({
    indexedDB: new IDBFactory(),
    now: () => new Date((clock += 1000)),
    newId: () => `save-${String(++n).padStart(4, '0')}`,
    ...options,
  });
}

function makeSave(kind: SaveKind, ticks = 5): SaveState {
  const rt = createRuntime(buildEmberfall(), null, { seed: 7, clockMode: 'continuous' });
  for (let i = 0; i < ticks; i++) rt.tick(emptyInput());
  return rt.snapshot({ kind });
}

/** Emberfall with one real blob-backed image asset. */
async function projectWithBlob(storage: Storage, text = 'pixel data'): Promise<{ project: Project; blobId: string }> {
  const ref = await storage.putBlob(ascii(text), 'image/png', { width: 2, height: 2 });
  const project = buildEmberfall();
  project.assets.images.push({ id: id('asset', `img-${text}`) as Id<'asset'>, name: 'pixel', ref });
  return { project, blobId: ref.blobId };
}

describe('[P2.storage.sha256] hashing', () => {
  it('pure-JS SHA-256 matches the standard vectors', () => {
    expect(sha256HexSync(ascii(''))).toBe(EMPTY_BLOB_ID);
    expect(sha256HexSync(ascii('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256HexSync(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256HexSync(new Uint8Array(1_000_000).fill(0x61))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('crypto.subtle and the fallback agree at every length around the block size', async () => {
    for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 255);
      expect(await sha256Hex(data)).toBe(sha256HexSync(data));
      expect(await sha256Hex(data, null)).toBe(sha256HexSync(data)); // a non-secure origin has no subtle
    }
  });
});

describe('[P2.storage.blobs] BlobStore', () => {
  it('put returns an AssetRef whose id is the hash of the bytes', async () => {
    const storage = await open();
    const ref = await storage.putBlob(ascii('abc'), 'text/plain', { width: 3, height: 1 });
    expect(ref).toEqual({ blobId: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', mime: 'text/plain', byteSize: 3, width: 3, height: 1 });
    expect(Array.from((await storage.getBlob(ref.blobId))!)).toEqual([97, 98, 99]);
    expect(await storage.hasBlob(ref.blobId)).toBe(true);
    expect(await storage.getBlob('0'.repeat(64))).toBeNull();
  });

  it('is content-addressed: the same bytes are stored once', async () => {
    const storage = await open();
    const a = await storage.putBlob(ascii('same'), 'image/png');
    const b = await storage.putBlob(ascii('same'), 'image/png');
    const c = await storage.putBlob(ascii('other'), 'image/png');
    expect(a.blobId).toBe(b.blobId);
    expect(c.blobId).not.toBe(a.blobId);
    expect(await storage.listBlobIds()).toHaveLength(2);
  });

  it('works without crypto.subtle', async () => {
    const storage = await Storage.open({ indexedDB: new IDBFactory(), subtle: null });
    expect((await storage.putBlob(ascii('abc'), 'text/plain')).blobId).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('blobs nothing references are pruned when a project saves', async () => {
    const storage = await open();
    const { project, blobId } = await projectWithBlob(storage);
    const stray = await storage.putBlob(ascii('nobody uses me'), 'image/png');
    await storage.putProject(project);
    expect(await storage.hasBlob(blobId)).toBe(true);
    expect(await storage.hasBlob(stray.blobId)).toBe(false);
    // Dropping the asset and saving again releases its blob.
    project.assets.images = [];
    await storage.putProject(project);
    expect(await storage.listBlobIds()).toEqual([]);
  });

  it('a blob shared by two projects survives until neither references it', async () => {
    const storage = await open();
    const { project: a, blobId } = await projectWithBlob(storage);
    const b = buildEmberfall();
    b.id = id('project', 'second');
    b.assets.images = a.assets.images.slice();
    await storage.putProject(a);
    await storage.putProject(b);
    await storage.deleteProject(a.id);
    expect(await storage.hasBlob(blobId)).toBe(true);
    await storage.deleteProject(b.id);
    expect(await storage.hasBlob(blobId)).toBe(false);
  });
});

describe('[P2.storage.projects] ProjectStore', () => {
  it('stores one document per project and validates it on every load', async () => {
    const storage = await open();
    const project = buildEmberfall();
    await storage.putProject(project);
    project.contentRevision = 2;
    project.name = 'Emberfall II';
    await storage.putProject(project);
    expect(await storage.listProjects()).toEqual([{ id: project.id, name: 'Emberfall II', contentRevision: 2 }]);
    const loaded = (await storage.getProject(project.id))!;
    expect(serializeProject(loaded)).toBe(serializeProject(project));
    expect(loaded.maps[0]!.layers.level).toBeInstanceOf(Uint8Array);
    expect(await storage.getProject(id('project', 'none'))).toBeNull();
  });

  it('refuses to store an invalid project', async () => {
    const storage = await open();
    const broken = buildEmberfall();
    (broken.settings as { hexSize: number }).hexSize = -1;
    await expect(storage.putProject(broken)).rejects.toThrow();
    expect(await storage.listProjects()).toEqual([]);
  });
});

describe('[P2.storage.saves] SaveStore', () => {
  it('manual saves are never capped', async () => {
    const storage = await open();
    const save = makeSave('manual');
    for (let i = 0; i < 40; i++) await storage.putSave(save, `Manual ${i}`);
    const list = await storage.listSaves(save.header.projectId);
    expect(list).toHaveLength(40);
    expect(list[0]!.name).toBe('Manual 39'); // newest first
    expect(list.every((m) => m.kind === 'manual')).toBe(true);
  });

  it('the fourth autosave evicts the oldest; manual saves are untouched', async () => {
    const storage = await open();
    const auto = makeSave('auto');
    await storage.putSave(makeSave('manual'), 'Before the boss');
    const metas = [];
    for (let i = 1; i <= 3; i++) metas.push(await storage.putSave(auto, `Auto ${i}`));
    expect((await storage.listSaves(auto.header.projectId)).filter((m) => m.kind === 'auto')).toHaveLength(3);
    await storage.putSave(auto, 'Auto 4');
    const list = await storage.listSaves(auto.header.projectId);
    expect(list.filter((m) => m.kind === 'auto').map((m) => m.name)).toEqual(['Auto 4', 'Auto 3', 'Auto 2']);
    expect(list.filter((m) => m.kind === 'manual').map((m) => m.name)).toEqual(['Before the boss']);
    await expect(storage.loadSave(metas[0]!.id)).rejects.toMatchObject({ code: 'no-save' }); // body evicted with its row
    await storage.putSave(auto, 'Auto 5');
    await storage.putSave(auto, 'Auto 6');
    expect((await storage.listSaves(auto.header.projectId)).filter((m) => m.kind === 'auto').map((m) => m.name)).toEqual(['Auto 6', 'Auto 5', 'Auto 4']);
  });

  it('the autosave limit is configurable and rolls per project', async () => {
    const storage = await open({ autosaveLimit: 1 });
    const a = makeSave('auto');
    const b: SaveState = { ...a, header: { ...a.header, projectId: id('project', 'other') } };
    await storage.putSave(a, 'A1');
    await storage.putSave(b, 'B1');
    await storage.putSave(a, 'A2');
    expect((await storage.listSaves(a.header.projectId)).map((m) => m.name)).toEqual(['A2']);
    expect((await storage.listSaves(b.header.projectId)).map((m) => m.name)).toEqual(['B1']);
  });

  it('the save list carries name, kind, time, location and tick, and loads a body only on request', async () => {
    const storage = await open();
    const save = makeSave('manual', 42);
    const meta = await storage.putSave(save, 'Village');
    expect(meta).toEqual({
      id: 'save-0001',
      projectId: save.header.projectId,
      name: 'Village',
      kind: 'manual',
      savedAt: '2026-11-17T01:00:01.000Z',
      location: save.currentMapId,
      tick: 42,
    });
    const loaded = await storage.loadSave(meta.id);
    expect(loaded.header.savedAt).toBe('2026-11-17T01:00:01.000Z'); // stamped by storage
    expect({ ...loaded, header: { ...loaded.header, savedAt: save.header.savedAt } }).toEqual(save);
    // The loaded save resumes.
    const rt = createRuntime(buildEmberfall(), loaded, { seed: 0, clockMode: 'continuous' });
    expect(rt.view.tick).toBe(42);
  });

  it('a schema 1 save is rejected', async () => {
    expect(() => importSave(JSON.stringify({ schemaVersion: 1, player: { hp: 10 } }))).toThrow(/v0\.6\.0/);
    expect(() => importSave(JSON.stringify({ header: { schemaVersion: 1 } }))).toThrowError(StorageError);
    expect(() => importSave('{ nope')).toThrow(/not valid JSON/);
    const storage = await open();
    const v1 = { ...makeSave('manual'), header: { ...makeSave('manual').header, schemaVersion: 1 } } as unknown as SaveState;
    await expect(storage.putSave(v1, 'old')).rejects.toMatchObject({ code: 'schema-v1' });
    expect(await storage.listSaves(v1.header.projectId)).toEqual([]);
  });

  it('playtest saves live in memory only', async () => {
    const storage = await open();
    await expect(storage.putSave(makeSave('playtest'), 'nope')).rejects.toMatchObject({ code: 'playtest-save' });
  });

  it('a save exports as JSON and imports back identical', () => {
    const save = makeSave('manual', 30);
    expect(importSave(exportSave(save))).toEqual(save);
  });

  it('deleting a project deletes its saves', async () => {
    const storage = await open();
    const project = buildEmberfall();
    await storage.putProject(project);
    await storage.putSave(makeSave('manual'), 'one');
    await storage.putSave(makeSave('auto'), 'two');
    await storage.deleteProject(project.id);
    expect(await storage.listSaves(project.id)).toEqual([]);
    expect(await storage.listProjects()).toEqual([]);
  });
});

describe('[P2.storage.prefs] player preferences', () => {
  it('default until set, then persist; malformed prefs fall back to defaults', async () => {
    const storage = await open();
    expect(await storage.getPrefs()).toEqual(defaultPrefs());
    await storage.setPrefs({ shake: 'half', flashing: 'outline', volumes: { master: 0.5, music: 0, effects: 1 } });
    expect(await storage.getPrefs()).toEqual({ shake: 'half', flashing: 'outline', volumes: { master: 0.5, music: 0, effects: 1 } });
    await storage.setPrefs({ shake: 'earthquake' } as never);
    expect(await storage.getPrefs()).toEqual(defaultPrefs());
  });
});

describe('[P2.storage.file] the .loreengine file', () => {
  it('exports project.json plus the blobs it references, and imports into another store', async () => {
    const source = await open();
    const { project, blobId } = await projectWithBlob(source, 'atlas page bytes');
    const { bytes, missing } = await exportProjectFile(project, source);
    // Not in this store: the unbaked placeholder atlas page, and the fixture's generated art and sound.
    expect(missing).toContain(EMPTY_BLOB_ID);
    expect(missing).not.toContain(blobId);
    expect(missing).toHaveLength(referencedBlobIds(project).size - 1);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([`blobs/${blobId}`, 'project.json']);

    const target = await open();
    const imported = await importProjectFile(bytes, target);
    expect(serializeProject(imported)).toBe(serializeProject(project));
    expect(Array.from((await target.getBlob(blobId))!)).toEqual(Array.from(ascii('atlas page bytes')));
  });

  it('the same project exports to the same bytes', async () => {
    const storage = await open();
    const { project } = await projectWithBlob(storage);
    const a = await exportProjectFile(project, storage);
    const b = await exportProjectFile(project, storage);
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });

  it('rejects a v0.6.0 project, a corrupt blob, and a file with no project.json', async () => {
    const storage = await open();
    await expect(importProjectFile(zipSync({ 'project.json': strToU8(JSON.stringify(V060_PROJECT)) }), storage)).rejects.toMatchObject({ code: 'schema-v1' });
    await expect(importProjectFile(zipSync({ 'readme.txt': strToU8('hi') }), storage)).rejects.toMatchObject({ code: 'bad-archive' });
    await expect(importProjectFile(ascii('not a zip'), storage)).rejects.toMatchObject({ code: 'bad-archive' });

    const { project, blobId } = await projectWithBlob(storage);
    const tampered = zipSync({ 'project.json': strToU8(serializeProject(project)), [`blobs/${blobId}`]: ascii('tampered') });
    const target = await open();
    await expect(importProjectFile(tampered, target)).rejects.toMatchObject({ code: 'blob-hash-mismatch' });
    expect(await target.listBlobIds()).toEqual([]);
  });

  it('referencedBlobIds lists every asset and atlas page', async () => {
    const storage = await open();
    const { project, blobId } = await projectWithBlob(storage);
    const ids = referencedBlobIds(project);
    expect(ids.has(blobId)).toBe(true); //         an image
    expect(ids.has(EMPTY_BLOB_ID)).toBe(true); //  the atlas pages
    for (const asset of [...project.assets.vectorSources, ...project.assets.audio]) expect(ids.has(asset.ref.blobId)).toBe(true);
    // Content-addressed: frames with identical art (two attacks sharing a pose) share one blob.
    const unique = new Set([...project.assets.vectorSources, ...project.assets.audio].map((a) => a.ref.blobId));
    expect(ids.size).toBe(1 + 1 + unique.size);
    expect(unique.size).toBeLessThan(project.assets.vectorSources.length + project.assets.audio.length);
  });
});
