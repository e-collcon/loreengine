import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { colorOf } from '@loreengine/render';
import { ComponentDataSchema } from '@loreengine/schema';
import type { ComponentData, EntityPlacement, Id } from '@loreengine/schema';
import { BRUSH_SIZES } from '../core/brush.ts';
import type { BrushSize } from '../core/brush.ts';
import { AddRegion, SetPlayerStart, UpdatePlacement } from '../core/commands.ts';
import { OVERLAYS } from '../core/overlays.ts';
import type { Overlay } from '../core/overlays.ts';
import { PLAYER_START_KEY } from '../core/preview.ts';
import { TOOLS, TOOL_LABELS } from '../core/state.ts';
import type { Tool } from '../core/state.ts';
import { CanvasController } from './canvas.ts';
import { DEBUG_LABELS } from './draw.ts';
import type { DebugToggles } from './draw.ts';
import { PlaytestController } from './playtest.ts';
import type { PlaytestPreview } from './playtest.ts';
import { DatabaseEditor, SettingsEditor, TriggerEditor } from './Databases.tsx';
import { AssetPanel } from './Assets.tsx';
import { DATABASES, atlasFrames, nameOfId, referenceOptions } from '../forms/databases.ts';
import { FormBuilder } from '../forms/model.ts';
import { SchemaForm } from '../forms/SchemaForm.tsx';
import type { FormContext } from '../forms/SchemaForm.tsx';
import { itemIssues } from '../core/staging.ts';
import type { DatabaseKey } from '../forms/databases.ts';
import { REGION_COLORS } from './draw.ts';
import type { EditorSession } from './session.ts';

const OVERLAY_LABELS: Record<Overlay, string> = { levels: 'Levels', blocked: 'Blocked edges', lint: 'Lint', regions: 'Regions', sight: 'Sight' };
const TOOL_KEYS: Record<string, Tool> = { KeyB: 'terrain', KeyR: 'raise', KeyL: 'lower', KeyF: 'flatten', KeyG: 'region', KeyP: 'place', KeyV: 'select' };
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function useSession(session: EditorSession): number {
  return useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => session.changes,
  );
}

export function App({ session }: { session: EditorSession }) {
  useSession(session);
  const host = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<CanvasController | null>(null);
  const [playtest, setPlaytest] = useState<{ start: { x: number; y: number } | null; preview?: PlaytestPreview } | null>(null);

  useEffect(() => {
    let alive = true;
    let made: CanvasController | null = null;
    void CanvasController.create(session, host.current!).then((c) => {
      if (!alive) c.dispose();
      else {
        made = c;
        setCanvas(c);
        (window as unknown as { __editor?: unknown }).__editor = { session, canvas: c };
      }
    });
    return () => {
      alive = false;
      made?.dispose();
    };
  }, [session]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      const t = ev.target as HTMLElement | null;
      if (session.playing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const tool = TOOL_KEYS[ev.code];
      if (tool) session.setState({ tool });
      if (ev.code === 'BracketLeft' || ev.code === 'BracketRight') {
        const i = BRUSH_SIZES.indexOf(session.state.brushSize);
        const next = BRUSH_SIZES[Math.max(0, Math.min(2, i + (ev.code === 'BracketRight' ? 1 : -1)))]!;
        session.setState({ brushSize: next });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const state = session.state;
  const project = session.project;
  const map = project.maps.find((m) => m.id === state.mapId) ?? project.maps[0]!;
  const doc = session.doc;
  const hover = canvas && canvas.hoverCell >= 0 ? canvas.hoverCell : -1;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">LoreEngine</span>
        {TOOLS.map((tool) => (
          <button key={tool} className="btn" aria-pressed={state.tool === tool} onClick={() => session.setState({ tool })} title={`${TOOL_LABELS[tool]} (${Object.entries(TOOL_KEYS).find(([, t]) => t === tool)![0].slice(3)})`}>
            {TOOL_LABELS[tool]}
          </button>
        ))}
        <span className="sep" />
        <span className="muted">Brush</span>
        {BRUSH_SIZES.map((size) => (
          <button key={size} className="btn small" aria-pressed={state.brushSize === size} onClick={() => session.setState({ brushSize: size as BrushSize })}>
            {size}
          </button>
        ))}
        <span className="sep" />
        <button className="btn" disabled={!doc.stack.canUndo} onClick={() => doc.undo()} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="btn" disabled={!doc.stack.canRedo} onClick={() => doc.redo()} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <span className="sep" />
        <button className="btn primary" onClick={() => setPlaytest({ start: null })} disabled={playtest !== null}>
          ▶ Play
        </button>
        <button className="btn" onClick={() => setPlaytest({ start: canvas ? canvas.playFromPoint() : null })} disabled={playtest !== null || !canvas} title="Start the player at the hovered cell, or the view's center">
          Play from here
        </button>
      </header>

      <aside className="panel">
        <Section title="Maps">
          <ul className="list">
            {project.maps.map((m) => (
              <li key={m.id} aria-selected={m.id === map.id} onClick={() => session.setState({ mapId: m.id, selection: null })}>
                {m.name}
                <span className="meta">
                  {m.width}×{m.height}
                  {m.id === project.startMapId ? ' · start' : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <ToolOptions session={session} />
        <Section title="Overlays">
          <div className="chips">
            {OVERLAYS.map((o) => (
              <button key={o} className="btn small" aria-pressed={state.overlays[o]} onClick={() => session.setState({ overlays: { ...state.overlays, [o]: !state.overlays[o] } })}>
                {OVERLAY_LABELS[o]}
              </button>
            ))}
          </div>
        </Section>
        <Section title={`Warnings (${canvas?.warnings.length ?? 0})`}>
          {canvas && canvas.warnings.length === 0 && <p className="muted">No lint warnings on this map.</p>}
          <ul className="list" data-testid="warnings">
            {canvas?.warnings.map((w, i) => (
              <li key={i} className="warning" onClick={() => w.focus && canvas.focus(w.focus.x, w.focus.y)} title="Show on the map">
                {w.message}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Databases">
          <ul className="list" data-testid="databases">
            {DATABASES.map(({ key, label }) => (
              <li key={key} aria-selected={state.panel === `db:${key}`} onClick={() => session.setState({ panel: `db:${key}` })}>
                {label}
                <span className="meta">{(project[key] as unknown[]).length}</span>
              </li>
            ))}
            <li aria-selected={state.panel === 'settings'} onClick={() => session.setState({ panel: 'settings' })}>
              Settings
            </li>
          </ul>
        </Section>
        <Section title="Logic and assets">
          <ul className="list">
            <li aria-selected={state.panel === `triggers:${map.id}`} onClick={() => session.setState({ panel: `triggers:${map.id}` })}>
              Triggers on {map.name}
              <span className="meta">{map.triggers.length}</span>
            </li>
            <li aria-selected={state.panel === 'triggers:global'} onClick={() => session.setState({ panel: 'triggers:global' })}>
              Global triggers
              <span className="meta">{project.triggers.length}</span>
            </li>
            <li aria-selected={state.panel === 'assets'} onClick={() => session.setState({ panel: 'assets' })}>
              Assets
              <span className="meta">{project.assets.vectorSources.length + project.assets.images.length + project.assets.audio.length}</span>
            </li>
          </ul>
        </Section>
      </aside>

      <main className="canvas-host" ref={host} />

      <aside className="inspector">
        <Inspector session={session} canvas={canvas} />
      </aside>

      {state.panel && (
        <section className="panel-view" aria-label="Editor panel">
          <div className="panel-view-bar">
            <button className="btn small" onClick={() => session.setState({ panel: null })}>
              ← Map
            </button>
            <span className="muted">Database edits are staged: Save keeps them, Cancel drops them. They are not on the undo stack.</span>
          </div>
          {state.panel.startsWith('db:') && <DatabaseEditor key={state.panel} session={session} dbKey={state.panel.slice(3) as DatabaseKey} onPreview={(preview) => setPlaytest({ start: null, preview })} />}
          {state.panel === 'settings' && <SettingsEditor session={session} />}
          {state.panel.startsWith('triggers:') && <TriggerEditor key={state.panel} session={session} mapId={state.panel === 'triggers:global' ? null : state.panel.slice(9)} />}
          {state.panel === 'assets' && <AssetPanel session={session} />}
        </section>
      )}

      <footer className="statusbar">
        <span>{hover >= 0 ? `cell (${hover % map.width}, ${Math.floor(hover / map.width)})  level ${map.layers.level[hover]}  ${project.terrains.find((t) => t.id === map.terrainPalette[map.layers.terrain[hover]!])?.name ?? ''}` : 'Pan: right-drag, Space+drag or arrows · Zoom: wheel'}</span>
        <span>{doc.stack.size} edit(s) to undo</span>
        <span>revision {project.contentRevision}</span>
        <span>{session.storageStatus}</span>
        {!session.art && <span className="muted">baking art…</span>}
      </footer>

      {playtest && (
        <Playtest
          session={session}
          start={playtest.start ? { mapId: map.id, x: playtest.start.x, y: playtest.start.y, facing: map.playerStart?.facing ?? 0 } : null}
          preview={playtest.preview ?? null}
          onClose={() => {
            setPlaytest(null);
            canvas?.invalidate();
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ToolOptions({ session }: { session: EditorSession }) {
  const state = session.state;
  const project = session.project;
  const map = project.maps.find((m) => m.id === state.mapId) ?? project.maps[0]!;
  const [name, setName] = useState('');
  if (state.tool === 'terrain') {
    return (
      <Section title="Terrain">
        <ul className="list">
          {project.terrains.map((t) => (
            <li key={t.id} aria-selected={state.terrainId === t.id} onClick={() => session.setState({ terrainId: t.id as Id<'terrain'> })}>
              <span className="swatch" style={{ background: hex(colorOf(t.top.frame)) }} />
              {t.name}
              <span className="meta">{t.passable.walk ? 'walk' : t.passable.swim ? 'swim' : 'blocks'}</span>
            </li>
          ))}
        </ul>
      </Section>
    );
  }
  if (state.tool === 'place') {
    return (
      <Section title="Archetype to place">
        <ul className="list">
          {project.archetypes.map((a) => (
            <li key={a.id} aria-selected={state.archetypeId === a.id} onClick={() => session.setState({ archetypeId: a.id as Id<'archetype'> })}>
              <span className="swatch" style={{ background: hex(colorOf(a.name)) }} />
              {a.name}
            </li>
          ))}
        </ul>
        <p className="muted">Click to place; drag to set facing.</p>
      </Section>
    );
  }
  if (state.tool === 'region') {
    return (
      <Section title="Regions">
        <ul className="list">
          {map.regions.map((r, i) => (
            <li key={r.id} aria-selected={state.regionId === r.id} onClick={() => session.setState({ regionId: r.id })}>
              <span className="swatch" style={{ background: REGION_COLORS[i % REGION_COLORS.length] }} />
              {r.name}
              <span className="meta">{r.cells.length / 2} cells</span>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input placeholder="New region name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <button
            className="btn small"
            disabled={name.trim() === ''}
            onClick={() => {
              const region = { id: session.doc.newId() as Id<'region'>, name: name.trim(), cells: new Int16Array(0) };
              session.doc.run(new AddRegion(map.id, region));
              session.setState({ regionId: region.id });
              setName('');
            }}
          >
            Add
          </button>
        </div>
        <label style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input type="checkbox" checked={state.eraseRegion} onChange={(e) => session.setState({ eraseRegion: e.target.checked })} /> Erase
        </label>
      </Section>
    );
  }
  const hints: Partial<Record<Tool, string>> = {
    raise: 'Each stroke raises a cell one level, up to the project’s maximum. One level apart is a walkable slope; two or more is a cliff.',
    lower: 'Each stroke lowers a cell one level.',
    flatten: 'Sets the brushed area to the level under the first click.',
    select: 'Click a placement or the player start to inspect it; drag to move. Delete removes, Ctrl+D duplicates.',
  };
  return (
    <Section title={TOOL_LABELS[state.tool]}>
      <p className="muted">{hints[state.tool]}</p>
    </Section>
  );
}

function Inspector({ session, canvas }: { session: EditorSession; canvas: CanvasController | null }) {
  const state = session.state;
  const project = session.project;
  const map = project.maps.find((m) => m.id === state.mapId) ?? project.maps[0]!;
  const key = state.selection;
  const placement = key && key !== PLAYER_START_KEY ? map.placements.find((p) => p.key === key) : undefined;
  const isStart = key === PLAYER_START_KEY && map.playerStart !== undefined;

  if (!placement && !isStart) {
    return (
      <>
        <Section title="Inspector">
          <p className="muted">Nothing selected. Use Select (V) and click a placement or the player start.</p>
        </Section>
        <Section title={`Placements (${map.placements.length})`}>
          <ul className="list">
            {map.placements.map((p) => (
              <li
                key={p.key}
                onClick={() => {
                  session.setState({ selection: p.key, tool: 'select' });
                  canvas?.focus(p.x, p.y);
                }}
              >
                <span className="swatch" style={{ background: hex(colorOf(project.archetypes.find((a) => a.id === p.archetypeId)?.name ?? '')) }} />
                {project.archetypes.find((a) => a.id === p.archetypeId)?.name ?? '?'}
                <span className="meta">
                  {p.x.toFixed(1)}, {p.y.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </>
    );
  }

  const position = placement ?? map.playerStart!;
  const update = (patch: Partial<EntityPlacement>): void => {
    if (placement) session.doc.run(new UpdatePlacement('Edit placement', map.id, structuredClone(placement), { ...structuredClone(placement), ...patch }));
    else if (map.playerStart) session.doc.run(new SetPlayerStart(map.id, { ...map.playerStart }, { ...map.playerStart, x: patch.x ?? map.playerStart.x, y: patch.y ?? map.playerStart.y, facing: patch.facing ?? map.playerStart.facing }));
  };
  const num = (label: string, value: number, apply: (v: number) => void, step = 0.1) => (
    <div className="field">
      <label>{label}</label>
      <input type="number" step={step} defaultValue={Number(value.toFixed(3))} key={`${key}-${label}-${value}`} onBlur={(e) => Number(e.target.value) !== value && Number.isFinite(Number(e.target.value)) && apply(Number(e.target.value))} />
    </div>
  );
  return (
    <>
      <Section title={placement ? 'Placement' : 'Player start'}>
        {placement && (
          <div className="field">
            <label>Archetype</label>
            <select value={placement.archetypeId} onChange={(e) => update({ archetypeId: e.target.value as Id<'archetype'> })}>
              {project.archetypes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {num('x', position.x, (x) => update({ x }))}
        {num('y', position.y, (y) => update({ y }))}
        {num('Facing °', (position.facing * 180) / Math.PI, (deg) => update({ facing: (deg * Math.PI) / 180 }), 15)}
        {canvas && <p className="muted">Stands at height {canvas.world.surfaceHeight(position.x, position.y).toFixed(2)} (snapped to the surface).</p>}
      </Section>
      {placement && <OverridesForm key={placement.key} session={session} mapId={map.id} placement={placement} />}
    </>
  );
}

const componentSpec = new FormBuilder().spec(ComponentDataSchema);

/** A placement's overrides: the archetype's components it replaces, as add/remove sections (spec 8.5, 8.6). */
function OverridesForm({ session, mapId, placement }: { session: EditorSession; mapId: string; placement: EntityPlacement }) {
  const [draft, setDraft] = useState<ComponentData>(() => structuredClone(placement.overrides ?? {}));
  useEffect(() => setDraft(structuredClone(placement.overrides ?? {})), [placement.overrides]);
  const issues = useMemo(() => itemIssues(ComponentDataSchema, draft), [draft]);
  const project = session.project;
  const map = project.maps.find((m) => m.id === mapId);
  const ctx = useMemo<FormContext>(() => {
    const options = referenceOptions(project, map);
    const frames = atlasFrames(project);
    return { options, frames, issues, nameOf: nameOfId(project, map), newId: session.doc.newId, firstId: (ref) => options(ref)[0]?.id ?? '', firstFrame: (a) => frames(a)[0] ?? '' };
  }, [project, map, issues, session.doc.newId]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(placement.overrides ?? {});
  const apply = (): void => {
    const before = structuredClone(placement);
    const { overrides: _old, ...rest } = structuredClone(placement);
    const after: EntityPlacement = Object.keys(draft).length > 0 ? { ...rest, overrides: structuredClone(draft) } : (rest as EntityPlacement);
    session.doc.run(new UpdatePlacement('Edit overrides', mapId, before, after));
  };
  return (
    <Section title="Overrides">
      <p className="muted">Components that replace the archetype’s for this placement. Apply is one undo step.</p>
      <div className="overrides-form">
        <SchemaForm spec={componentSpec} value={draft} onChange={(v) => setDraft(v as ComponentData)} ctx={ctx} />
      </div>
      {issues.size > 0 && <p className="error">{issues.size} problem(s)</p>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn small" disabled={!dirty} onClick={() => setDraft(structuredClone(placement.overrides ?? {}))}>
          Revert
        </button>
        <button className="btn small primary" disabled={!dirty || issues.size > 0} onClick={apply}>
          Apply overrides
        </button>
      </div>
    </Section>
  );
}

function Playtest({ session, start, preview, onClose }: { session: EditorSession; start: { mapId: string; x: number; y: number; facing: number } | null; preview: PlaytestPreview | null; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [controller, setController] = useState<PlaytestController | null>(null);
  const [stats, setStats] = useState({ tick: 0, tickMs: 0, entities: 0, queued: 0, paused: false, outcome: null as string | null });
  const [toggles, setToggles] = useState<DebugToggles | null>(null);
  const [run, setRun] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let made: PlaytestController | null = null;
    session.playing = true;
    void PlaytestController.start(session, stage.current!, start, preview).then((c) => {
      if (!alive) {
        c.stop();
        return;
      }
      made = c;
      let last = 0;
      c.onStats = (s) => {
        const now = performance.now();
        if (now - last > 200) {
          last = now;
          setStats(s);
        }
      };
      setToggles({ ...c.toggles });
      setController(c);
      (window as unknown as { __playtest?: unknown }).__playtest = c;
    }, (err: unknown) => setError(`The playtest could not start: ${(err as Error).message}`));
    return () => {
      alive = false;
      made?.stop();
      session.playing = false;
      (window as unknown as { __playtest?: unknown }).__playtest = undefined;
    };
  }, [session, start, preview, run]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="playtest" role="dialog" aria-label="Playtest">
      <div className="bar">
        <button className="btn" onClick={onClose} title="Esc">
          ■ Stop
        </button>
        <button className="btn" disabled={!controller} onClick={() => (controller!.paused ? controller!.resume() : controller!.pause())}>
          {stats.paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
        <button className="btn" disabled={!controller} onClick={() => controller!.step()} title="Advance one tick">
          Step
        </button>
        <button className="btn" disabled={!controller} onClick={() => setRun((r) => r + 1)}>
          Restart
        </button>
        <button className="btn" disabled={!controller} onClick={() => controller!.downloadRepro()} title="Project revision, seed and inputs, as one file">
          Save repro
        </button>
        {toggles &&
          (Object.keys(DEBUG_LABELS) as (keyof DebugToggles)[]).map((k) => (
            <button
              key={k}
              className="btn small"
              aria-pressed={toggles[k]}
              onClick={() => {
                const next = { ...toggles, [k]: !toggles[k] };
                setToggles(next);
                if (controller) controller.toggles = next;
              }}
            >
              {DEBUG_LABELS[k]}
            </button>
          ))}
        {preview && <span className="preview-tag">previewing {preview.label} on the player every 2 s</span>}
        {error && <span className="error">{error}</span>}
        <span className="readout">
          {stats.outcome ? `${stats.outcome.toUpperCase()} · ` : ''}tick {stats.tick} · {stats.tickMs.toFixed(2)} ms/tick · {stats.entities} entities · {stats.queued} queued
        </span>
      </div>
      <div className="stage" ref={stage} />
    </div>
  );
}
