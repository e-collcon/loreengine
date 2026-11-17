/**
 * The editor's document (spec 8.3, 8.7): the project being authored, the
 * canvas command stack, and change notification. The editor holds no runtime;
 * playtest makes its own from a clone.
 */
import type { IdFactory, Project } from '@loreengine/schema';
import { CommandStack } from './commands.ts';
import type { Command } from './commands.ts';

export type ChangeListener = (project: Project) => void;

export class EditorDocument {
  readonly stack = new CommandStack();
  /** Bumped on every change, saved or not: what views compare to know they are stale. */
  version = 0;
  /** Changes since the last save. */
  dirty = false;
  private readonly listeners = new Set<ChangeListener>();

  constructor(
    readonly project: Project,
    readonly newId: IdFactory,
  ) {}

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Something in the project changed (a command, a live stroke, a database Save). */
  changed(): void {
    this.version++;
    this.dirty = true;
    for (const listener of this.listeners) listener(this.project);
  }

  run(command: Command): void {
    this.stack.run(this.project, command);
    this.changed();
  }

  /** Record a command whose edits are already in the project (a finished stroke). */
  record(command: Command | null): void {
    if (command === null) return;
    this.stack.push(command);
    this.changed();
  }

  undo(): Command | null {
    const command = this.stack.undo(this.project);
    if (command) this.changed();
    return command;
  }

  redo(): Command | null {
    const command = this.stack.redo(this.project);
    if (command) this.changed();
    return command;
  }

  /** A save went through: the revision moves on (spec 8.7). Called by the autosaver before writing. */
  beginSave(): void {
    this.project.contentRevision++;
    this.dirty = false;
  }
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Saves the project 2 s after the last change (spec 8.7). */
export class Autosaver {
  static readonly DELAY_MS = 2000;
  private handle: unknown = null;
  private readonly off: () => void;
  saving: Promise<void> | null = null;
  saves = 0;
  lastError: unknown = null;

  constructor(
    private readonly doc: EditorDocument,
    private readonly write: (project: Project) => Promise<void>,
    private readonly timers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
  ) {
    this.off = doc.onChange(() => this.schedule());
  }

  private schedule(): void {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = this.timers.set(() => {
      this.handle = null;
      void this.flush();
    }, Autosaver.DELAY_MS);
  }

  /** Save now if anything changed. */
  async flush(): Promise<void> {
    if (this.handle !== null) {
      this.timers.clear(this.handle);
      this.handle = null;
    }
    if (!this.doc.dirty) return;
    this.doc.beginSave();
    this.saving = this.write(this.doc.project).then(
      () => {
        this.saves++;
      },
      (err: unknown) => {
        this.lastError = err;
        this.doc.dirty = true;
      },
    );
    await this.saving;
  }

  dispose(): void {
    this.off();
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }
}
