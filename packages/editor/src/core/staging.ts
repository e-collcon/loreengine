/**
 * Database edits (spec 8.6, 8.7): staged on a draft until Save, discarded by
 * Cancel, never on the undo stack. Save checks each item against its schema
 * and the whole project with the draft in place; it is refused while the
 * draft adds a problem the project did not have.
 */
import { checkProject } from '@loreengine/schema';
import type { Project, TriggerDef } from '@loreengine/schema';
import type { z } from 'zod';
import type { EditorDocument } from './document.ts';
import type { DatabaseKey } from '../forms/databases.ts';
import { itemSchema, settingsSchema, triggerSchema } from '../forms/databases.ts';

export interface SaveIssue {
  /** Item index in the draft, or -1 for the project as a whole. */
  index: number;
  /** Path inside the item (`a.b.0`), or the project path for cross-item problems. */
  path: string;
  message: string;
}

export type SaveResult = { ok: true } | { ok: false; issues: SaveIssue[] };

/** Schema problems of one item, by path inside it (for inline messages). */
export function itemIssues(schema: z.ZodType, item: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const parsed = schema.safeParse(item);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join('.');
      if (!out.has(key)) out.set(key, issue.message);
    }
  }
  return out;
}

const issueKey = (i: { path: string; message: string }): string => `${i.path}: ${i.message}`;

/** Problems the candidate project has that the current one does not. */
function newProjectIssues(current: Project, candidate: Project): SaveIssue[] {
  const before = new Set(checkProject(current).map(issueKey));
  return checkProject(candidate)
    .filter((i) => !before.has(issueKey(i)))
    .map((i) => ({ index: -1, path: i.path, message: i.message }));
}

function itemsIssues(schema: z.ZodType, items: readonly unknown[]): SaveIssue[] {
  const out: SaveIssue[] = [];
  items.forEach((item, index) => {
    for (const [path, message] of itemIssues(schema, item)) out.push({ index, path, message });
  });
  return out;
}

/** Save a database's draft into the project. */
export function saveDatabase(doc: EditorDocument, key: DatabaseKey, draft: readonly unknown[]): SaveResult {
  const items = itemsIssues(itemSchema(key), draft);
  if (items.length > 0) return { ok: false, issues: items };
  const ids = new Set<string>();
  for (const [index, item] of draft.entries()) {
    const id = (item as { id: string }).id;
    if (ids.has(id)) return { ok: false, issues: [{ index, path: 'id', message: 'Two items share this id' }] };
    ids.add(id);
  }
  const candidate = { ...doc.project, [key]: draft } as Project;
  const issues = newProjectIssues(doc.project, candidate);
  if (issues.length > 0) return { ok: false, issues };
  (doc.project as unknown as Record<string, unknown>)[key] = structuredClone(draft);
  doc.changed();
  return { ok: true };
}

export function saveSettings(doc: EditorDocument, draft: Project['settings']): SaveResult {
  const items = itemsIssues(settingsSchema(), [draft]);
  if (items.length > 0) return { ok: false, issues: items };
  const issues = newProjectIssues(doc.project, { ...doc.project, settings: draft });
  if (issues.length > 0) return { ok: false, issues };
  doc.project.settings = structuredClone(draft);
  doc.changed();
  return { ok: true };
}

/** Save a trigger list: the project's global triggers (`mapId` null) or one map's. */
export function saveTriggers(doc: EditorDocument, mapId: string | null, draft: readonly TriggerDef[]): SaveResult {
  const items = itemsIssues(triggerSchema(), draft);
  if (items.length > 0) return { ok: false, issues: items };
  let candidate: Project;
  if (mapId === null) candidate = { ...doc.project, triggers: [...draft] };
  else candidate = { ...doc.project, maps: doc.project.maps.map((m) => (m.id === mapId ? { ...m, triggers: [...draft] } : m)) };
  const issues = newProjectIssues(doc.project, candidate);
  if (issues.length > 0) return { ok: false, issues };
  if (mapId === null) doc.project.triggers = structuredClone([...draft]);
  else doc.project.maps.find((m) => m.id === mapId)!.triggers = structuredClone([...draft]);
  doc.changed();
  return { ok: true };
}
