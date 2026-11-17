/**
 * The editor session: the document, its EditorState, persistence (IndexedDB
 * through @loreengine/storage, autosaved), and the baked art that the canvas
 * and every playtest draw from (DECISIONS N9).
 */
import { buildEmberfall, emberfallBlobs } from '@loreengine/fixtures';
import { bakeProjectArt } from '@loreengine/player';
import { SharedArt } from '@loreengine/render';
import type { AssetRef, Project } from '@loreengine/schema';
import { Storage } from '@loreengine/storage';
import { Autosaver, EditorDocument } from '../core/document.ts';
import { initialState } from '../core/state.ts';
import type { EditorState } from '../core/state.ts';

export type SessionListener = () => void;

export class EditorSession {
  state: EditorState;
  art: SharedArt | null = null;
  /** A playtest is running: the canvas ignores keys and the overlay has the screen. */
  playing = false;
  /** What the status bar says about persistence. */
  storageStatus: string;
  private readonly listeners = new Set<SessionListener>();
  private readonly saver: Autosaver | null;
  private readonly fallbackBlobs = emberfallBlobs();

  private constructor(
    readonly doc: EditorDocument,
    readonly storage: Storage | null,
    status: string,
  ) {
    this.storageStatus = status;
    this.state = initialState(doc.project.startMapId);
    const storage_ = storage;
    this.saver = storage_
      ? new Autosaver(doc, async (project) => {
          await storage_.putProject(project);
          this.storageStatus = `Saved revision ${project.contentRevision}`;
          this.emit();
        })
      : null;
    doc.onChange(() => this.emit());
  }

  /** Open the last project in IndexedDB, or start from Emberfall. */
  static async open(): Promise<EditorSession> {
    const newId = (): string => crypto.randomUUID();
    let storage: Storage | null = null;
    let project: Project | null = null;
    let status = 'Not saved: IndexedDB is not available';
    try {
      storage = await Storage.open();
      const list = await storage.listProjects();
      if (list.length > 0) project = await storage.getProject(list[0]!.id);
      status = project ? `Opened revision ${project.contentRevision}` : 'New project from Emberfall';
    } catch (error) {
      console.warn('LoreEngine: storage unavailable', error);
      storage = null;
    }
    if (!project) project = buildEmberfall();
    const session = new EditorSession(new EditorDocument(project, newId), storage, status);
    if (storage) {
      // The fixture's art and sounds, so the project's asset refs resolve from storage.
      for (const { bytes, mime } of session.fallbackBlobs.values()) await storage.putBlob(bytes, mime);
      if (status.startsWith('New')) await storage.putProject(project);
    }
    return session;
  }

  get project(): Project {
    return this.doc.project;
  }

  readonly resolveAsset = async (ref: AssetRef): Promise<Uint8Array | null> => {
    const stored = this.storage ? await this.storage.getBlob(ref.blobId).catch(() => null) : null;
    return stored ?? this.fallbackBlobs.get(ref.blobId)?.bytes ?? null;
  };

  /** Bake the project's art once; the canvas and playtests borrow it. */
  async bakeArt(): Promise<SharedArt | null> {
    const baked = await bakeProjectArt(this.project, this.resolveAsset);
    if (baked.atlases.length === 0) return null;
    this.art?.destroy();
    this.art = new SharedArt(baked.atlases, baked.pages);
    this.emit();
    return this.art;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Bumped on every emit: what React's external-store snapshot compares. */
  changes = 0;

  emit(): void {
    this.changes++;
    for (const listener of this.listeners) listener();
  }

  setState(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Save now (before a reload, or on demand). */
  async saveNow(): Promise<void> {
    await this.saver?.flush();
  }
}
