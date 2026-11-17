/**
 * The asset panel's bookkeeping (spec 8.6): imported files become named
 * assets in the project (their bytes are blobs, stored by the caller), SVGs
 * are grouped into atlases, and a bake is written back into the project.
 */
import { unzipSync } from 'fflate';
import { checkProject } from '@loreengine/schema';
import type { AssetRef, AtlasDef, Id, Project } from '@loreengine/schema';
import type { EditorDocument } from './document.ts';
import type { SaveResult } from './staging.ts';

export type AssetKind = 'vectorSources' | 'images' | 'audio';
export const ASSET_KINDS: { kind: AssetKind; label: string }[] = [
  { kind: 'vectorSources', label: 'Vector art (SVG)' },
  { kind: 'images', label: 'Images' },
  { kind: 'audio', label: 'Audio' },
];

const MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
};

export function mimeOf(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return MIME[ext] ?? null;
}

export function kindOf(mime: string): AssetKind | null {
  if (mime === 'image/svg+xml') return 'vectorSources';
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

export interface ImportFile {
  /** The path inside a folder or zip, e.g. `hero/idle-0.svg`; the asset is named by it, minus the extension. */
  path: string;
  bytes: Uint8Array;
}

/** Files from a zip, skipping folders and anything that is not art or sound. */
export function unzipFiles(bytes: Uint8Array): ImportFile[] {
  const entries = unzipSync(bytes);
  return Object.entries(entries)
    .filter(([path, data]) => !path.endsWith('/') && !path.startsWith('__MACOSX/') && data.length > 0 && mimeOf(path) !== null)
    .map(([path, data]) => ({ path, bytes: data }));
}

export const assetName = (path: string): string => path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\.[^./]+$/, '');

/**
 * Add stored files to the project. A file with the name of an existing asset of
 * the same kind replaces its bytes (re-importing updated art keeps every
 * reference). Returns the ids of the assets added or updated.
 */
export function addAssets(doc: EditorDocument, stored: { path: string; ref: AssetRef }[]): string[] {
  const touched: string[] = [];
  for (const { path, ref } of stored) {
    const kind = kindOf(ref.mime);
    if (!kind) continue;
    const list = doc.project.assets[kind];
    // Named by the path, as the fixtures name theirs (the bake strips `.svg` for frame names);
    // matched with or without the extension, so re-importing updated art replaces it.
    const name = path.replace(/\\/g, '/').replace(/^\.?\//, '');
    const existing = list.find((a) => assetName(a.name) === assetName(name));
    if (existing) {
      existing.ref = ref;
      touched.push(existing.id);
    } else {
      const id = doc.newId() as Id<'asset'>;
      list.push({ id, name, ref });
      touched.push(id);
    }
  }
  if (touched.length > 0) doc.changed();
  return touched;
}

/** Remove an asset, unless something still uses it. */
export function removeAsset(doc: EditorDocument, kind: AssetKind, id: string): SaveResult {
  const candidate: Project = { ...doc.project, assets: { ...doc.project.assets, [kind]: doc.project.assets[kind].filter((a) => a.id !== id) } };
  const before = new Set(checkProject(doc.project).map((i) => `${i.path}:${i.message}`));
  const issues = checkProject(candidate)
    .filter((i) => !before.has(`${i.path}:${i.message}`))
    .map((i) => ({ index: -1, path: i.path, message: i.message }));
  if (issues.length > 0) return { ok: false, issues };
  doc.project.assets[kind] = candidate.assets[kind];
  doc.changed();
  return { ok: true };
}

/**
 * Put SVG sources into an atlas: an existing one, or a new one (null), which
 * gets a placeholder tier until it is baked. Returns the atlas id.
 */
export function assignToAtlas(doc: EditorDocument, atlasId: string | null, sourceIds: readonly string[], emptyBlob: AssetRef): string {
  const atlases = doc.project.assets.atlases;
  let atlas = atlasId === null ? undefined : atlases.find((a) => a.id === atlasId);
  if (!atlas) {
    atlas = { id: doc.newId() as Id<'atlas'>, sourceIds: [], tiers: [{ scale: 1, image: emptyBlob, frames: {} }] };
    atlases.push(atlas);
  }
  for (const id of sourceIds) {
    // A source lives in one atlas.
    for (const other of atlases) if (other !== atlas) other.sourceIds = other.sourceIds.filter((s) => s !== id);
    if (!atlas.sourceIds.includes(id as Id<'asset'>)) atlas.sourceIds.push(id as Id<'asset'>);
  }
  doc.changed();
  return atlas.id;
}

/**
 * Write a bake into the project: each baked atlas replaces the one with its
 * id, and an atlas that overflowed a page adds the extra ones it made (N8).
 */
export function writeBake(doc: EditorDocument, baked: readonly AtlasDef[]): void {
  const atlases = doc.project.assets.atlases;
  for (const def of baked) {
    const at = atlases.findIndex((a) => a.id === def.id);
    if (at >= 0) atlases[at] = structuredClone(def);
    else atlases.push(structuredClone(def));
  }
  doc.changed();
}
