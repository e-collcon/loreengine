/**
 * The storage package (spec 5.11): projects, saves, blobs, and preferences
 * in IndexedDB. The runtime never imports it.
 *
 *   projects   project id                     one document per project
 *   saveMeta   save id, indexed by project    small rows the save list reads
 *   saveData   save id                        the SaveState body, read only on load
 *   blobs      SHA-256 of the decoded bytes   content-addressed, deduplicated
 *   prefs      'user'                         player preferences
 *
 * Manual saves are never capped; autosaves roll (default 3). Everything
 * read back is validated: a stored project or save that no longer parses is
 * rejected, never repaired.
 */
import { parsePrefs, parseProjectJson, parseSave, serializeProject, serializeSave } from '@loreengine/schema';
import type { AssetRef, PlayerPrefs, Project, SaveKind, SaveState } from '@loreengine/schema';
import { sha256Hex } from './sha256.ts';

export const DB_VERSION = 1;
export const DEFAULT_AUTOSAVE_LIMIT = 3;

export interface StorageOptions {
  /** Database name. Default 'loreengine'. */
  name?: string;
  /** The IndexedDB factory; defaults to the global one. Tests inject fake-indexeddb. */
  indexedDB?: IDBFactory;
  /** Rolling autosaves kept per project. Default 3. */
  autosaveLimit?: number;
  /** Clock for save timestamps; defaults to the system clock. */
  now?: () => Date;
  /** Id source for saves; defaults to `crypto.randomUUID`. */
  newId?: () => string;
  /** `crypto.subtle`, or null to force the pure-JS hash. */
  subtle?: SubtleCrypto | null;
}

/** A row of the save list. Reading the list never touches a save body. */
export interface SaveMeta {
  id: string;
  projectId: string;
  name: string;
  kind: Exclude<SaveKind, 'playtest'>;
  savedAt: string;
  /** Where the player was: the current map's id. */
  location: string;
  tick: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  contentRevision: number;
}

export class StorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Every blob id a project refers to. */
export function referencedBlobIds(project: Project): Set<string> {
  const ids = new Set<string>();
  const a = project.assets;
  for (const asset of [...a.vectorSources, ...a.images, ...a.audio]) ids.add(asset.ref.blobId);
  for (const atlas of a.atlases) for (const tier of atlas.tiers) ids.add(tier.image.blobId);
  return ids;
}

interface ProjectRow {
  id: string;
  name: string;
  contentRevision: number;
  json: string;
}
interface BlobRow {
  id: string;
  mime: string;
  bytes: Uint8Array;
}

export class Storage {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly autosaveLimit: number,
    private readonly now: () => Date,
    private readonly newId: () => string,
    private readonly subtle: SubtleCrypto | null | undefined,
  ) {}

  static async open(options: StorageOptions = {}): Promise<Storage> {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) throw new StorageError('no-indexeddb', 'IndexedDB is not available here.');
    const open = factory.open(options.name ?? 'loreengine', DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('saveMeta', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      db.createObjectStore('saveData');
      db.createObjectStore('blobs', { keyPath: 'id' });
      db.createObjectStore('prefs');
    };
    const db = await request(open);
    let counter = 0;
    const fallbackId = (): string => `save-${Date.now().toString(36)}-${(counter++).toString(36)}`;
    return new Storage(
      db,
      options.autosaveLimit ?? DEFAULT_AUTOSAVE_LIMIT,
      options.now ?? (() => new Date()),
      options.newId ?? (() => globalThis.crypto?.randomUUID?.() ?? fallbackId()),
      options.subtle === undefined ? globalThis.crypto?.subtle : options.subtle,
    );
  }

  close(): void {
    this.db.close();
  }

  /* ---- projects --------------------------------------------------------- */

  /**
   * Store a project (one document per project), then prune blobs that no
   * stored project references.
   */
  async putProject(project: Project): Promise<void> {
    const row: ProjectRow = { id: project.id, name: project.name, contentRevision: project.contentRevision, json: serializeProject(project) };
    const tx = this.db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(row);
    await done(tx);
    await this.pruneBlobs();
  }

  /** Load and validate a project. Null when there is none; throws when it no longer validates. */
  async getProject(id: string): Promise<Project | null> {
    const row = (await request(this.db.transaction('projects').objectStore('projects').get(id))) as ProjectRow | undefined;
    if (!row) return null;
    const parsed = parseProjectJson(row.json);
    if (!parsed.ok) throw new StorageError(parsed.issues[0]!.code, `Stored project ${id} is not valid: ${parsed.issues[0]!.message}`);
    return parsed.project;
  }

  async listProjects(): Promise<ProjectMeta[]> {
    const rows = (await request(this.db.transaction('projects').objectStore('projects').getAll())) as ProjectRow[];
    return rows.map(({ id, name, contentRevision }) => ({ id, name, contentRevision })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Delete a project, its saves, and any blobs only it referenced. */
  async deleteProject(id: string): Promise<void> {
    for (const meta of await this.listSaves(id)) await this.deleteSave(meta.id);
    const tx = this.db.transaction('projects', 'readwrite');
    tx.objectStore('projects').delete(id);
    await done(tx);
    await this.pruneBlobs();
  }

  /* ---- saves ------------------------------------------------------------ */

  /**
   * Store a save. Manual saves are never capped; storing an autosave beyond
   * the limit evicts the project's oldest autosave. Playtest saves live in
   * memory only and are refused.
   */
  async putSave(save: SaveState, name: string): Promise<SaveMeta> {
    const kind = save.header.kind;
    if (kind === 'playtest') throw new StorageError('playtest-save', 'Playtest saves live in memory only.');
    const checked = parseSave(save);
    if (!checked.ok) throw new StorageError(checked.issues[0]!.code, `The save is not valid: ${checked.issues[0]!.message}`);
    const savedAt = this.now().toISOString();
    const body: SaveState = { ...save, header: { ...save.header, savedAt } };
    const meta: SaveMeta = { id: this.newId(), projectId: save.header.projectId, name, kind, savedAt, location: save.currentMapId, tick: save.tick };
    const tx = this.db.transaction(['saveMeta', 'saveData'], 'readwrite');
    tx.objectStore('saveMeta').put(meta);
    tx.objectStore('saveData').put(serializeSave(body), meta.id);
    await done(tx);
    if (kind === 'auto') await this.rollAutosaves(meta.projectId);
    return meta;
  }

  private async rollAutosaves(projectId: string): Promise<void> {
    const autos = (await this.listSaves(projectId)).filter((m) => m.kind === 'auto').reverse(); // oldest first
    for (let i = 0; i < autos.length - this.autosaveLimit; i++) await this.deleteSave(autos[i]!.id);
  }

  /** The save list of a project, newest first. Reads `saveMeta` only. */
  async listSaves(projectId: string): Promise<SaveMeta[]> {
    const rows = (await request(this.db.transaction('saveMeta').objectStore('saveMeta').index('projectId').getAll(projectId))) as SaveMeta[];
    return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
  }

  /** Load and validate a save body. A schema 1 save is rejected. */
  async loadSave(saveId: string): Promise<SaveState> {
    const text = (await request(this.db.transaction('saveData').objectStore('saveData').get(saveId))) as string | undefined;
    if (text === undefined) throw new StorageError('no-save', `There is no save ${saveId}.`);
    return importSave(text);
  }

  async deleteSave(saveId: string): Promise<void> {
    const tx = this.db.transaction(['saveMeta', 'saveData'], 'readwrite');
    tx.objectStore('saveMeta').delete(saveId);
    tx.objectStore('saveData').delete(saveId);
    await done(tx);
  }

  /* ---- blobs ------------------------------------------------------------ */

  /**
   * Store bytes under their SHA-256 and return an AssetRef. Storing the
   * same bytes twice stores them once.
   */
  async putBlob(bytes: Uint8Array, mime: string, extra: Pick<AssetRef, 'width' | 'height' | 'durationMs'> = {}): Promise<AssetRef> {
    const blobId = await sha256Hex(bytes, this.subtle);
    const tx = this.db.transaction('blobs', 'readwrite');
    const row: BlobRow = { id: blobId, mime, bytes: new Uint8Array(bytes) };
    tx.objectStore('blobs').put(row);
    await done(tx);
    return { blobId, mime, byteSize: bytes.length, ...extra };
  }

  async getBlob(blobId: string): Promise<Uint8Array | null> {
    const row = (await request(this.db.transaction('blobs').objectStore('blobs').get(blobId))) as BlobRow | undefined;
    return row ? new Uint8Array(row.bytes) : null;
  }

  async hasBlob(blobId: string): Promise<boolean> {
    return (await request(this.db.transaction('blobs').objectStore('blobs').count(blobId))) > 0;
  }

  async listBlobIds(): Promise<string[]> {
    return ((await request(this.db.transaction('blobs').objectStore('blobs').getAllKeys())) as string[]).sort();
  }

  /** Delete blobs no stored project references. Returns how many were removed. */
  async pruneBlobs(): Promise<number> {
    const referenced = new Set<string>();
    const rows = (await request(this.db.transaction('projects').objectStore('projects').getAll())) as ProjectRow[];
    for (const row of rows) {
      const parsed = parseProjectJson(row.json);
      // A stored project that no longer validates keeps all blobs: nothing is deleted on a guess.
      if (!parsed.ok) return 0;
      for (const id of referencedBlobIds(parsed.project)) referenced.add(id);
    }
    const stale = (await this.listBlobIds()).filter((id) => !referenced.has(id));
    if (stale.length === 0) return 0;
    const tx = this.db.transaction('blobs', 'readwrite');
    for (const id of stale) tx.objectStore('blobs').delete(id);
    await done(tx);
    return stale.length;
  }

  /* ---- prefs ------------------------------------------------------------ */

  /** Player preferences; the defaults when none are stored or what is stored is malformed. */
  async getPrefs(): Promise<PlayerPrefs> {
    return parsePrefs(await request(this.db.transaction('prefs').objectStore('prefs').get('user')));
  }

  async setPrefs(prefs: PlayerPrefs): Promise<void> {
    const tx = this.db.transaction('prefs', 'readwrite');
    tx.objectStore('prefs').put(parsePrefs(prefs), 'user');
    await done(tx);
  }
}

/** A save exports as JSON. */
export function exportSave(save: SaveState): string {
  return serializeSave(save);
}

/** Parse and validate exported save text. Rejects schema 1 and anything malformed. */
export function importSave(text: string): SaveState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StorageError('bad-json', 'The save is not valid JSON.');
  }
  const parsed = parseSave(raw);
  if (!parsed.ok) throw new StorageError(parsed.issues[0]!.code, parsed.issues[0]!.message);
  return parsed.save;
}
