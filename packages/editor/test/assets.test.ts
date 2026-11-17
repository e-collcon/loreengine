import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { EMPTY_BLOB_ID, buildEmberfall } from '@loreengine/fixtures';
import { checkProject, seededIdFactory, sha256HexSync } from '@loreengine/schema';
import type { AssetRef, AtlasDef } from '@loreengine/schema';
import { addAssets, assignToAtlas, removeAsset, unzipFiles, writeBake } from '../src/core/assets.ts';
import { EditorDocument } from '../src/core/document.ts';

const svg = (w: number): Uint8Array => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}"><rect width="${w}" height="${w}"/></svg>`);
const ref = (bytes: Uint8Array, mime: string): AssetRef => ({ blobId: sha256HexSync(bytes), mime, byteSize: bytes.length });
const empty: AssetRef = { blobId: EMPTY_BLOB_ID, mime: 'image/png', byteSize: 0 };

describe('asset panel [P5B.assets]', () => {
  it('imports by name; re-importing a name replaces its bytes and keeps its id', () => {
    const doc = new EditorDocument(buildEmberfall(), seededIdFactory(9));
    const before = doc.project.assets.vectorSources.length;
    const [id] = addAssets(doc, [{ path: 'props/crate.svg', ref: ref(svg(32), 'image/svg+xml') }]);
    expect(doc.project.assets.vectorSources).toHaveLength(before + 1);
    expect(doc.project.assets.vectorSources.at(-1)).toMatchObject({ id, name: 'props/crate.svg' });
    const [again] = addAssets(doc, [{ path: 'props/crate.svg', ref: ref(svg(48), 'image/svg+xml') }]);
    expect(again).toBe(id);
    expect(doc.project.assets.vectorSources).toHaveLength(before + 1);
    expect(doc.project.assets.vectorSources.at(-1)!.ref.blobId).toBe(sha256HexSync(svg(48)));
    // The fixture's own art is matched the same way: re-importing a file replaces it.
    const hero = doc.project.assets.vectorSources[0]!;
    const count = doc.project.assets.vectorSources.length;
    expect(addAssets(doc, [{ path: `./${hero.name}`, ref: ref(svg(12), 'image/svg+xml') }])).toEqual([hero.id]);
    expect(doc.project.assets.vectorSources).toHaveLength(count);
    expect(checkProject(doc.project)).toEqual([]);
  });

  it('reads art and sound out of a zip, skipping everything else', () => {
    const zip = zipSync({ 'art/a.svg': svg(8), 'art/b.png': new Uint8Array([137, 80, 78, 71]), 'notes.txt': new TextEncoder().encode('hi'), 'sfx/hit.wav': new Uint8Array([82, 73, 70, 70]) });
    expect(unzipFiles(zip).map((f) => f.path).sort()).toEqual(['art/a.svg', 'art/b.png', 'sfx/hit.wav']);
  });

  it('an asset still in use cannot be removed; an unused one can', () => {
    const doc = new EditorDocument(buildEmberfall(), seededIdFactory(9));
    const bgm = doc.project.maps.find((m) => m.bgm)!.bgm!;
    expect(removeAsset(doc, 'audio', bgm).ok).toBe(false);
    expect(doc.project.assets.audio.some((a) => a.id === bgm)).toBe(true);
    const [id] = addAssets(doc, [{ path: 'unused.svg', ref: ref(svg(16), 'image/svg+xml') }]);
    expect(removeAsset(doc, 'vectorSources', id!)).toEqual({ ok: true });
  });

  it('SVGs go into one atlas at a time, and a bake replaces atlases by id', () => {
    const doc = new EditorDocument(buildEmberfall(), seededIdFactory(9));
    const ids = addAssets(doc, [
      { path: 'a.svg', ref: ref(svg(8), 'image/svg+xml') },
      { path: 'b.svg', ref: ref(svg(9), 'image/svg+xml') },
    ]);
    const atlasId = assignToAtlas(doc, null, ids, empty);
    const atlas = doc.project.assets.atlases.find((a) => a.id === atlasId)!;
    expect(atlas.sourceIds).toEqual(ids);
    expect(checkProject(doc.project)).toEqual([]);
    // Moving one into another atlas takes it out of the first.
    const other = doc.project.assets.atlases.find((a) => a.id !== atlasId)!;
    assignToAtlas(doc, other.id, [ids[0]!], empty);
    expect(doc.project.assets.atlases.find((a) => a.id === atlasId)!.sourceIds).toEqual([ids[1]]);

    const page = ref(new Uint8Array([1, 2, 3]), 'image/png');
    const baked: AtlasDef = { id: atlasId as AtlasDef['id'], sourceIds: [ids[1]! as AtlasDef['sourceIds'][number]], tiers: [{ scale: 1, image: page, frames: { b: { x: 0, y: 0, w: 9, h: 9, anchorX: 4.5, anchorY: 9 } } }] };
    const overflow: AtlasDef = { ...baked, id: doc.newId() as AtlasDef['id'] };
    const count = doc.project.assets.atlases.length;
    writeBake(doc, [baked, overflow]);
    expect(doc.project.assets.atlases).toHaveLength(count + 1);
    expect(doc.project.assets.atlases.find((a) => a.id === atlasId)!.tiers[0]!.image.blobId).toBe(page.blobId);
  });
});
