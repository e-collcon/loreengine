/**
 * The asset panel (spec 8.6): import SVGs (one by one, a folder, or a zip),
 * raster images and audio, each with a preview; group SVGs into atlases and
 * bake them (section 6.7), writing the atlases back into the project.
 */
import { useEffect, useState } from 'react';
import { EMPTY_BLOB_ID } from '@loreengine/fixtures';
import type { NamedAsset } from '@loreengine/schema';
import { ASSET_KINDS, addAssets, assignToAtlas, kindOf, mimeOf, removeAsset, unzipFiles } from '../core/assets.ts';
import type { AssetKind, ImportFile } from '../core/assets.ts';
import { referenceOptions } from '../forms/databases.ts';
import type { EditorSession } from './session.ts';

async function imageSize(bytes: Uint8Array, mime: string): Promise<{ width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}

async function audioLength(bytes: Uint8Array): Promise<{ durationMs?: number }> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
    return { durationMs: Math.round(buffer.duration * 1000) };
  } catch {
    return {};
  }
}

function Preview({ session, asset, kind }: { session: EditorSession; asset: NamedAsset; kind: AssetKind }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let alive = true;
    void session.resolveAsset(asset.ref).then((bytes) => {
      if (!alive || !bytes) return;
      made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: asset.ref.mime }));
      setUrl(made);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [session, asset.ref.blobId, asset.ref.mime]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!url) return <span className="thumb muted">…</span>;
  if (kind === 'audio') return <audio controls src={url} preload="none" style={{ height: 28, width: 180 }} />;
  return <img className="thumb" src={url} alt={asset.name} />;
}

export function AssetPanel({ session }: { session: EditorSession }) {
  const project = session.project;
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [atlasTarget, setAtlasTarget] = useState<string>('new');
  const atlases = referenceOptions(project, undefined)('atlas');

  const importFiles = async (files: ImportFile[]): Promise<void> => {
    setStatus(`Importing ${files.length} file(s)…`);
    const stored: { path: string; ref: Awaited<ReturnType<EditorSession['storeBlob']>> }[] = [];
    let skipped = 0;
    for (const file of files) {
      const mime = mimeOf(file.path);
      if (!mime || !kindOf(mime)) {
        skipped++;
        continue;
      }
      const extra = mime.startsWith('image/') && mime !== 'image/svg+xml' ? await imageSize(file.bytes, mime) : mime.startsWith('audio/') ? await audioLength(file.bytes) : {};
      stored.push({ path: file.path, ref: await session.storeBlob(file.bytes, mime, extra) });
    }
    const ids = addAssets(session.doc, stored);
    setSelected(new Set(ids.filter((id) => project.assets.vectorSources.some((a) => a.id === id))));
    setStatus(`Imported ${ids.length} asset(s)${skipped ? `, skipped ${skipped} file(s) that are not art or sound` : ''}. New SVGs are selected: add them to an atlas, then Bake.`);
  };

  const onFiles = async (list: FileList | null): Promise<void> => {
    if (!list) return;
    const files: ImportFile[] = [];
    for (const file of Array.from(list)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (file.name.toLowerCase().endsWith('.zip')) files.push(...unzipFiles(bytes));
      else files.push({ path, bytes });
    }
    await importFiles(files);
  };

  const bake = async (): Promise<void> => {
    setStatus('Baking…');
    try {
      await session.bakeArt(true);
      setStatus(`Baked ${project.assets.atlases.length} atlas(es) and wrote them into the project.`);
    } catch (error) {
      setStatus(`The bake failed: ${(error as Error).message}`);
    }
  };

  return (
    <div className="db-editor single assets" data-testid="assets">
      <div className="db-form">
        <h3>Assets</h3>
        <div className="asset-import">
          <label className="btn">
            Import files…
            <input type="file" multiple accept=".svg,.png,.jpg,.jpeg,.webp,.gif,.wav,.ogg,.mp3,.m4a,.zip" onChange={(e) => void onFiles(e.target.files)} hidden />
          </label>
          <label className="btn">
            Import a folder…
            <input type="file" multiple {...({ webkitdirectory: '' } as object)} onChange={(e) => void onFiles(e.target.files)} hidden />
          </label>
          <span className="muted">SVG, PNG/JPEG/WebP, WAV/OGG/MP3, or a zip of them. A file named like an existing asset replaces its bytes.</span>
        </div>
        {status && <p className="status-line">{status}</p>}

        <div className="asset-bake">
          <strong>Atlases</strong>
          <span className="muted">{project.assets.atlases.length} · baked pages: {project.assets.atlases.filter((a) => a.tiers[0]?.image.blobId !== EMPTY_BLOB_ID).length}</span>
          <select value={atlasTarget} onChange={(e) => setAtlasTarget(e.target.value)}>
            <option value="new">a new atlas</option>
            {atlases.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            className="btn small"
            disabled={selected.size === 0}
            onClick={() => {
              const id = assignToAtlas(session.doc, atlasTarget === 'new' ? null : atlasTarget, [...selected], { blobId: EMPTY_BLOB_ID, mime: 'image/png', byteSize: 0 });
              setAtlasTarget(id);
              setStatus(`${selected.size} SVG(s) are in the atlas now. Bake to rasterize them.`);
            }}
          >
            Add selected SVGs
          </button>
          <button className="btn small primary" onClick={() => void bake()}>
            Bake
          </button>
        </div>

        {ASSET_KINDS.map(({ kind, label }) => (
          <section key={kind} className="asset-section">
            <h4>
              {label} <span className="muted">({project.assets[kind].length})</span>
            </h4>
            <div className="asset-grid">
              {project.assets[kind].map((asset) => {
                const atlas = kind === 'vectorSources' ? project.assets.atlases.find((a) => a.sourceIds.includes(asset.id)) : undefined;
                return (
                  <div key={asset.id} className={`asset-card${selected.has(asset.id) ? ' selected' : ''}`}>
                    {kind === 'vectorSources' && (
                      <input
                        type="checkbox"
                        checked={selected.has(asset.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(asset.id);
                          else next.delete(asset.id);
                          setSelected(next);
                        }}
                      />
                    )}
                    <Preview session={session} asset={asset} kind={kind} />
                    <div className="asset-name" title={asset.name}>
                      {asset.name}
                    </div>
                    <div className="muted asset-meta">
                      {(asset.ref.byteSize / 1024).toFixed(1)} KB{asset.ref.width ? ` · ${asset.ref.width}×${asset.ref.height}` : ''}
                      {asset.ref.durationMs ? ` · ${(asset.ref.durationMs / 1000).toFixed(1)} s` : ''}
                      {kind === 'vectorSources' ? (atlas ? ' · in atlas' : ' · no atlas') : ''}
                    </div>
                    <button
                      className="btn small link"
                      title="Remove"
                      onClick={() => {
                        const result = removeAsset(session.doc, kind, asset.id);
                        setStatus(result.ok ? `Removed ${asset.name}.` : `${asset.name} is still used: ${result.issues[0]?.message ?? ''}`);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
