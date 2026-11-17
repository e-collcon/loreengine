/**
 * Database editors (spec 8.6): a list on the left, a generated form on the
 * right, edits staged until Save, discarded by Cancel, validated inline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { hitboxOutline } from '@loreengine/render';
import type { Action, AnimationSetDef, AttackDef, FactionDef, Project, TerrainDef, TriggerDef } from '@loreengine/schema';
import { saveDatabase, saveSettings, saveTriggers, itemIssues } from '../core/staging.ts';
import type { SaveIssue, SaveResult } from '../core/staging.ts';
import { DATABASES, atlasFrames, itemName, itemSchema, nameOfId, referenceOptions, settingsSchema, triggerSchema } from '../forms/databases.ts';
import type { DatabaseKey } from '../forms/databases.ts';
import { FormBuilder, defaultValue } from '../forms/model.ts';
import type { FieldSpec } from '../forms/model.ts';
import { SchemaForm } from '../forms/SchemaForm.tsx';
import type { FormContext } from '../forms/SchemaForm.tsx';
import type { PlaytestPreview } from './playtest.ts';
import type { EditorSession } from './session.ts';

const builder = new FormBuilder();

function useFormContext(session: EditorSession, issues: ReadonlyMap<string, string>): FormContext {
  const project = session.project;
  const map = project.maps.find((m) => m.id === session.state.mapId);
  return useMemo(() => {
    const options = referenceOptions(project, map);
    const frames = atlasFrames(project);
    return { options, frames, issues, nameOf: nameOfId(project, map), newId: session.doc.newId, firstId: (ref) => options(ref)[0]?.id ?? '', firstFrame: (a) => frames(a)[0] ?? '' };
  }, [project, map, issues, session.doc.newId, session.changes]); // eslint-disable-line react-hooks/exhaustive-deps
}

function IssueList({ issues, names }: { issues: SaveIssue[]; names: (index: number) => string }) {
  if (issues.length === 0) return null;
  return (
    <div className="save-issues" role="alert">
      <strong>Not saved:</strong>
      <ul>
        {issues.slice(0, 8).map((i, k) => (
          <li key={k}>
            {i.index >= 0 ? `${names(i.index)} · ` : ''}
            <code>{i.path || '(item)'}</code> {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One database: the list, the form for the selected item, extras, Save and Cancel. */
export function DatabaseEditor({ session, dbKey, onPreview }: { session: EditorSession; dbKey: DatabaseKey; onPreview: (preview: PlaytestPreview) => void }) {
  const project = session.project;
  const info = DATABASES.find((d) => d.key === dbKey)!;
  const schema = itemSchema(dbKey);
  const spec = builder.spec(schema) as FieldSpec;
  const [draft, setDraft] = useState<unknown[]>(() => structuredClone(project[dbKey] as unknown[]));
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    setDraft(structuredClone(project[dbKey] as unknown[]));
    setSelected(0);
    setResult(null);
  }, [dbKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = draft[selected];
  const inline = useMemo(() => (item === undefined ? new Map<string, string>() : itemIssues(schema, item)), [schema, item]);
  const ctx = useFormContext(session, inline);
  const dirty = JSON.stringify(draft) !== JSON.stringify(project[dbKey]);
  const setItem = (value: unknown): void => setDraft(draft.map((d, i) => (i === selected ? value : d)));

  const add = (): void => {
    const value = defaultValue(spec, ctx) as Record<string, unknown>;
    if ('name' in value) value['name'] = `New ${info.label.toLowerCase().replace(/s$/, '')}`;
    if ('key' in value) value['key'] = `new_${draft.length}`;
    setDraft([...draft, value]);
    setSelected(draft.length);
  };
  const duplicate = (): void => {
    const copy = structuredClone(item) as Record<string, unknown>;
    copy['id'] = session.doc.newId();
    if (typeof copy['name'] === 'string') copy['name'] = `${copy['name']} copy`;
    if (typeof copy['key'] === 'string') copy['key'] = `${copy['key']}_copy`;
    setDraft([...draft, copy]);
    setSelected(draft.length);
  };
  const remove = (): void => {
    setDraft(draft.filter((_, i) => i !== selected));
    setSelected(Math.max(0, selected - 1));
  };
  const save = (): void => setResult(saveDatabase(session.doc, dbKey, draft));
  const cancel = (): void => {
    setDraft(structuredClone(project[dbKey] as unknown[]));
    setResult(null);
  };

  const shown = draft.map((d, i) => ({ d, i })).filter(({ d }) => itemName(d).toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="db-editor" data-testid={`db-${dbKey}`}>
      <div className="db-list">
        <div className="db-list-head">
          <strong>{info.label}</strong>
          <span className="muted">{draft.length}</span>
        </div>
        <input type="search" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="list">
          {shown.map(({ d, i }) => (
            <li key={i} aria-selected={i === selected} onClick={() => setSelected(i)}>
              {itemName(d)}
            </li>
          ))}
        </ul>
        <div className="db-list-tools">
          <button className="btn small" onClick={add}>
            + New
          </button>
          <button className="btn small" onClick={duplicate} disabled={item === undefined}>
            Duplicate
          </button>
          <button className="btn small" onClick={remove} disabled={item === undefined}>
            Delete
          </button>
        </div>
      </div>
      <div className="db-form">
        {dbKey === 'terrains' && <TerrainMatrix draft={draft as TerrainDef[]} setDraft={setDraft} />}
        {dbKey === 'factions' && <FactionGrid draft={draft as FactionDef[]} setDraft={setDraft} />}
        {item !== undefined ? (
          <>
            {dbKey === 'attacks' && <AttackPreview attack={item as AttackDef} />}
            {dbKey === 'animationSets' && <AnimationPreview session={session} set={item as AnimationSetDef} />}
            {(dbKey === 'statusEffects' || dbKey === 'feedback' || dbKey === 'particlePresets') && (
              <div className="preview-bar">
                <button className="btn small" onClick={() => onPreview(previewFor(dbKey, item))} title="Play it on the player in a playtest, with your unsaved edits">
                  ▶ Preview on the player
                </button>
                <span className="muted">Runs a playtest on a copy that includes this draft.</span>
              </div>
            )}
            <SchemaForm spec={spec} value={item} onChange={setItem} ctx={ctx} />
          </>
        ) : (
          <p className="muted">No items. Use + New.</p>
        )}
      </div>
      <footer className="db-footer">
        {result && !result.ok && <IssueList issues={result.issues} names={(i) => itemName(draft[i])} />}
        {result?.ok && !dirty && <span className="saved">Saved</span>}
        {inline.size > 0 && <span className="error">{inline.size} problem(s) in this item</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={cancel} disabled={!dirty}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={!dirty}>
          Save
        </button>
      </footer>
    </div>
  );
}

function previewFor(dbKey: DatabaseKey, item: unknown): PlaytestPreview {
  const player = { by: 'player' } as const;
  const swap = (copy: Project): void => {
    const list = copy[dbKey] as { id: string }[];
    const at = list.findIndex((x) => x.id === (item as { id: string }).id);
    if (at >= 0) list[at] = structuredClone(item) as { id: string };
    else list.push(structuredClone(item) as { id: string });
  };
  const id = (item as { id: string }).id;
  if (dbKey === 'statusEffects') {
    return { label: 'effect', prepare: swap, actions: [{ type: 'apply-effect', target: player, statusId: id } as Action] };
  }
  if (dbKey === 'feedback') {
    return { label: 'feedback', prepare: swap, actions: [{ type: 'play-feedback', target: player, feedbackId: id } as Action] };
  }
  // A particle preset plays through a feedback made for the preview, in the copy only.
  const feedbackId = '00000000-0000-4000-8000-00000000f00d';
  return {
    label: 'particles',
    prepare: (copy) => {
      swap(copy);
      copy.feedback.push({ id: feedbackId, name: 'preview', particles: { presetId: id, count: 24 } } as Project['feedback'][number]);
    },
    actions: [{ type: 'play-feedback', target: player, feedbackId } as Action],
  };
}

/** Terrains: who can cross each one, all terrains at once (spec 8.6). */
function TerrainMatrix({ draft, setDraft }: { draft: TerrainDef[]; setDraft: (d: unknown[]) => void }) {
  const set = (i: number, patch: (t: TerrainDef) => TerrainDef): void => setDraft(draft.map((t, j) => (j === i ? patch(structuredClone(t)) : t)));
  const cols = [
    ['walk', (t: TerrainDef) => t.passable.walk, (t: TerrainDef, v: boolean) => ({ ...t, passable: { ...t.passable, walk: v } })],
    ['swim', (t: TerrainDef) => t.passable.swim, (t: TerrainDef, v: boolean) => ({ ...t, passable: { ...t.passable, swim: v } })],
    ['fly', (t: TerrainDef) => t.passable.fly, (t: TerrainDef, v: boolean) => ({ ...t, passable: { ...t.passable, fly: v } })],
    ['blocks sight', (t: TerrainDef) => t.blocksSight, (t: TerrainDef, v: boolean) => ({ ...t, blocksSight: v })],
    ['blocks shots', (t: TerrainDef) => t.blocksProjectiles, (t: TerrainDef, v: boolean) => ({ ...t, blocksProjectiles: v })],
  ] as const;
  return (
    <table className="matrix" data-testid="terrain-matrix">
      <caption>Passability</caption>
      <thead>
        <tr>
          <th />
          {cols.map(([name]) => (
            <th key={name}>{name}</th>
          ))}
          <th>cost</th>
        </tr>
      </thead>
      <tbody>
        {draft.map((t, i) => (
          <tr key={t.id}>
            <th>{t.name}</th>
            {cols.map(([name, get, put]) => (
              <td key={name}>
                <input type="checkbox" checked={get(t)} onChange={(e) => set(i, (x) => put(x, e.target.checked))} />
              </td>
            ))}
            <td>
              <input type="number" min={1} step="any" value={t.moveCost} onChange={(e) => set(i, (x) => ({ ...x, moveCost: Number(e.target.value) }))} style={{ width: 56 }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Factions: the N × N relation grid (spec 8.6). Row faction's view of the column faction. */
function FactionGrid({ draft, setDraft }: { draft: FactionDef[]; setDraft: (d: unknown[]) => void }) {
  const set = (i: number, other: string, relation: string): void =>
    setDraft(
      draft.map((f, j) => {
        if (j !== i) return f;
        const relations = { ...f.relations };
        if (relation === 'neutral') delete relations[other];
        else relations[other] = relation as FactionDef['relations'][string];
        return { ...f, relations };
      }),
    );
  return (
    <table className="matrix" data-testid="faction-grid">
      <caption>Relations (row toward column; missing = neutral, self = ally)</caption>
      <thead>
        <tr>
          <th />
          {draft.map((f) => (
            <th key={f.id}>{f.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {draft.map((row, i) => (
          <tr key={row.id}>
            <th>{row.name}</th>
            {draft.map((col) =>
              col.id === row.id ? (
                <td key={col.id} className="muted">
                  ally
                </td>
              ) : (
                <td key={col.id}>
                  <select value={row.relations[col.id] ?? 'neutral'} onChange={(e) => set(i, col.id, e.target.value)} className={`rel-${row.relations[col.id] ?? 'neutral'}`}>
                    <option value="hostile">hostile</option>
                    <option value="neutral">neutral</option>
                    <option value="ally">ally</option>
                  </select>
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Attacks: the hitbox on a small hex canvas, and the windup / active / recovery bar (spec 8.6). */
function AttackPreview({ attack }: { attack: AttackDef }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = 280;
    const h = 170;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const scale = 26; // px per world unit
    const ox = w * 0.38;
    const oy = h * 0.5;
    const px = (x: number): number => ox + x * scale;
    const py = (y: number): number => oy + y * scale * 0.5; // the game's iso squash
    // Hexes around the attacker, pointy-top, hexSize 1.
    ctx.strokeStyle = 'rgba(29,27,22,0.18)';
    for (let r = -4; r <= 4; r++) {
      for (let q = -6; q <= 6; q++) {
        const cx = Math.sqrt(3) * (q + r / 2);
        const cy = 1.5 * r;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 180) * (60 * k - 30);
          const x = px(cx + Math.cos(a));
          const y = py(cy + Math.sin(a));
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    const out: number[] = [];
    const n = hitboxOutline(attack.hitbox, 0, 0, 0, out);
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      if (k === 0) ctx.moveTo(px(out[0]!), py(out[1]!));
      else ctx.lineTo(px(out[k * 2]!), py(out[k * 2 + 1]!));
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(194, 65, 12, 0.35)';
    ctx.fill();
    ctx.strokeStyle = '#c2410c';
    ctx.lineWidth = 2;
    ctx.stroke();
    // The attacker, facing east.
    ctx.fillStyle = '#1d1b16';
    ctx.beginPath();
    ctx.ellipse(px(0), py(0), 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px(0), py(0));
    ctx.lineTo(px(0.8), py(0));
    ctx.stroke();
  }, [attack.hitbox]);
  const total = Math.max(1, attack.windupMs + attack.activeMs + attack.recoveryMs);
  const part = (ms: number): string => `${(100 * ms) / total}%`;
  return (
    <div className="attack-preview" data-testid="attack-preview">
      <canvas ref={canvas} style={{ width: 280, height: 170 }} />
      <div className="timeline" title="windup / active / recovery">
        <span style={{ width: part(attack.windupMs) }} className="t-windup">
          windup {attack.windupMs}
        </span>
        <span style={{ width: part(attack.activeMs) }} className="t-active">
          active {attack.activeMs}
        </span>
        <span style={{ width: part(attack.recoveryMs) }} className="t-recovery">
          recovery {attack.recoveryMs}
        </span>
      </div>
      <div className="muted">
        {total} ms per swing, then {attack.cooldownMs} ms cooldown
      </div>
    </div>
  );
}

/** Animation sets: each clip played per direction from the baked art (spec 8.6). */
function AnimationPreview({ session, set }: { session: EditorSession; set: AnimationSetDef }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clips = Object.keys(set.clips);
  const [clip, setClip] = useState(clips[0] ?? '');
  useEffect(() => {
    if (!clips.includes(clip)) setClip(clips[0] ?? '');
  }, [set]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = canvas.current;
    const def = set.clips[clip];
    const art = session.art;
    if (!c || !def) return;
    const bakedAtlas = art?.atlases.find((a) => a.id === set.atlasId);
    const tier = bakedAtlas?.tiers[0];
    const page = tier ? (art?.pages.get(tier.image.blobId)?.source.resource as CanvasImageSource | undefined) : undefined;
    const ctx = c.getContext('2d')!;
    const rows = def.frames.length;
    const cell = 72;
    c.width = cell * Math.max(1, rows);
    c.height = cell;
    let frame = 0;
    let raf = 0;
    let last = performance.now();
    const draw = (now: number): void => {
      raf = requestAnimationFrame(draw);
      if (now - last < (def.frameMs > 0 ? def.frameMs : 125)) return;
      last = now;
      ctx.clearRect(0, 0, c.width, c.height);
      for (let r = 0; r < rows; r++) {
        const names = def.frames[r]!;
        const name = names[frame % names.length]!;
        const rect = tier?.frames[name];
        ctx.strokeStyle = 'rgba(29,27,22,0.15)';
        ctx.strokeRect(r * cell + 0.5, 0.5, cell - 1, cell - 1);
        if (page && rect) {
          const s = Math.min((cell - 8) / rect.w, (cell - 8) / rect.h, 1.5);
          ctx.drawImage(page, rect.x, rect.y, rect.w, rect.h, r * cell + (cell - rect.w * s) / 2, (cell - rect.h * s) / 2, rect.w * s, rect.h * s);
        } else {
          ctx.fillStyle = '#7b7563';
          ctx.font = '10px ui-monospace, monospace';
          ctx.fillText(name.slice(0, 11), r * cell + 4, cell / 2);
        }
      }
      frame++;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [set, clip, session.art, session.project]);
  return (
    <div className="anim-preview" data-testid="anim-preview">
      <div className="chips">
        {clips.map((c) => (
          <button key={c} className="btn small" aria-pressed={c === clip} onClick={() => setClip(c)}>
            {c}
          </button>
        ))}
      </div>
      <canvas ref={canvas} style={{ height: 72 }} />
      <div className="muted">One cell per direction row{set.clips[clip] ? `, ${set.clips[clip]!.frameMs} ms per frame` : ''}.</div>
    </div>
  );
}

/** Project settings: one form, Save and Cancel. */
export function SettingsEditor({ session }: { session: EditorSession }) {
  const schema = settingsSchema();
  const spec = builder.spec(schema);
  const [draft, setDraft] = useState(() => structuredClone(session.project.settings));
  const [result, setResult] = useState<SaveResult | null>(null);
  const inline = useMemo(() => itemIssues(schema, draft), [schema, draft]);
  const ctx = useFormContext(session, inline);
  const dirty = JSON.stringify(draft) !== JSON.stringify(session.project.settings);
  return (
    <div className="db-editor single" data-testid="settings">
      <div className="db-form">
        <h3>Settings</h3>
        <SchemaForm spec={spec} value={draft} onChange={(v) => setDraft(v as Project['settings'])} ctx={ctx} />
      </div>
      <footer className="db-footer">
        {result && !result.ok && <IssueList issues={result.issues} names={() => 'settings'} />}
        {result?.ok && !dirty && <span className="saved">Saved</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={!dirty} onClick={() => setDraft(structuredClone(session.project.settings))}>
          Cancel
        </button>
        <button className="btn primary" disabled={!dirty} onClick={() => setResult(saveSettings(session.doc, draft))}>
          Save
        </button>
      </footer>
    </div>
  );
}

/** The trigger editor (spec 8.6): per map, or the project's global triggers; when, given, then. */
export function TriggerEditor({ session, mapId }: { session: EditorSession; mapId: string | null }) {
  const project = session.project;
  const source = (): TriggerDef[] => structuredClone(mapId === null ? project.triggers : (project.maps.find((m) => m.id === mapId)?.triggers ?? []));
  const schema = triggerSchema();
  const spec = builder.spec(schema);
  const [draft, setDraft] = useState<TriggerDef[]>(source);
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<SaveResult | null>(null);
  useEffect(() => {
    setDraft(source());
    setSelected(0);
    setResult(null);
  }, [mapId]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = draft[selected];
  const inline = useMemo(() => (item ? itemIssues(schema, item) : new Map<string, string>()), [schema, item]);
  const ctx = useFormContext(session, inline);
  const dirty = JSON.stringify(draft) !== JSON.stringify(mapId === null ? project.triggers : project.maps.find((m) => m.id === mapId)?.triggers);
  const title = mapId === null ? 'Global triggers' : `Triggers · ${project.maps.find((m) => m.id === mapId)?.name ?? ''}`;
  return (
    <div className="db-editor" data-testid="triggers">
      <div className="db-list">
        <div className="db-list-head">
          <strong>{title}</strong>
          <span className="muted">{draft.length}</span>
        </div>
        <ul className="list">
          {draft.map((t, i) => (
            <li key={t.id} aria-selected={i === selected} onClick={() => setSelected(i)}>
              {itemName(t)}
              <span className="meta">{t.enabled ? `${t.given.length}? → ${t.then.length}` : 'off'}</span>
            </li>
          ))}
        </ul>
        <div className="db-list-tools">
          <button
            className="btn small"
            onClick={() => {
              setDraft([...draft, defaultValue(spec, ctx) as TriggerDef]);
              setSelected(draft.length);
            }}
          >
            + New
          </button>
          <button
            className="btn small"
            disabled={!item}
            onClick={() => {
              setDraft(draft.filter((_, i) => i !== selected));
              setSelected(Math.max(0, selected - 1));
            }}
          >
            Delete
          </button>
        </div>
        {mapId === null && <p className="muted">Region events belong on a map&apos;s triggers.</p>}
      </div>
      <div className="db-form">
        {item ? <SchemaForm spec={spec} value={item} onChange={(v) => setDraft(draft.map((d, i) => (i === selected ? (v as TriggerDef) : d)))} ctx={ctx} /> : <p className="muted">No triggers. Use + New.</p>}
      </div>
      <footer className="db-footer">
        {result && !result.ok && <IssueList issues={result.issues} names={(i) => itemName(draft[i])} />}
        {result?.ok && !dirty && <span className="saved">Saved</span>}
        {inline.size > 0 && <span className="error">{inline.size} problem(s) in this trigger</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={!dirty} onClick={() => setDraft(source())}>
          Cancel
        </button>
        <button className="btn primary" disabled={!dirty} onClick={() => setResult(saveTriggers(session.doc, mapId, draft))}>
          Save
        </button>
      </footer>
    </div>
  );
}
