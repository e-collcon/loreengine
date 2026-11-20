/**
 * The map canvas (spec 8.4, 8.5): PixiRenderer drawing the map preview, a 2D
 * overlay on top, and the pointer tools. Edits go through strokes and
 * commands on the document; the canvas only reads the project.
 */
import { PixiRenderer } from '@loreengine/render';
import type { SharedArt } from '@loreengine/render';
import type { TerrainPick } from '@loreengine/render';
import type { World } from '@loreengine/runtime/view';
import type { EntityPlacement, Id } from '@loreengine/schema';
import { brushCells } from '../core/brush.ts';
import { AddPlacement, RemovePlacement, SetPlayerStart, UpdatePlacement } from '../core/commands.ts';
import { blockedEdges, visibleCells as sightCells, warningRows } from '../core/overlays.ts';
import type { WarningRow } from '../core/overlays.ts';
import { MapPreview, PLAYER_START_KEY } from '../core/preview.ts';
import { LayerStroke, RegionStroke, regionCellSet } from '../core/strokes.ts';
import { REGION_COLORS, drawEditorOverlays, drawSelection, visibleCells } from './draw.ts';
import type { Projector } from './draw.ts';
import type { EditorSession } from './session.ts';

type Drag =
  | { kind: 'layer'; stroke: LayerStroke; level: number }
  | { kind: 'region'; stroke: RegionStroke }
  | { kind: 'place'; placement: EntityPlacement }
  | { kind: 'move'; key: string; before: EntityPlacement | null; startBefore: { x: number; y: number; facing: number } | null; dx: number; dy: number; moved: boolean }
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number };

export class CanvasController {
  readonly preview: MapPreview;
  warnings: WarningRow[] = [];
  /** The cell under the pointer, or -1. */
  hoverCell = -1;
  private blocked: Float64Array = new Float64Array(0);
  private drag: Drag | null = null;
  private frame = 0;
  private readonly pick: TerrainPick = { cell: -1, x: 0, y: 0, z: 0 };
  private lastPointer = { x: 0, y: 0 };
  private readonly offDoc: () => void;
  private readonly offSession: () => void;
  private art: SharedArt | null = null;
  private disposed = false;
  private space = false;

  private constructor(
    readonly session: EditorSession,
    readonly renderer: PixiRenderer,
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLCanvasElement,
    preview: MapPreview,
  ) {
    this.preview = preview;
    this.recompute();
    this.offDoc = session.doc.onChange(() => this.changed());
    this.offSession = session.subscribe(() => this.sessionChanged());
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    this.renderer.setZoom(0.75); // authoring wants more of the map than play does
    this.centerOnStart();
    this.invalidate();
  }

  static async create(session: EditorSession, host: HTMLElement): Promise<CanvasController> {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;display:block';
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;inset:0;display:block;pointer-events:none';
    host.append(canvas, overlay);
    const preview = new MapPreview(session.project, session.state.mapId);
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const renderer = await PixiRenderer.create(preview, { canvas, width, height, resolution: Math.min(2, window.devicePixelRatio || 1), background: 0x1b1d22 });
    const controller = new CanvasController(session, renderer, host, canvas, overlay, preview);
    if (session.art) {
      controller.art = session.art;
      renderer.useSharedArt(session.art);
    }
    controller.sizeOverlay(width, height);
    return controller;
  }

  get world(): World {
    return this.preview.raw;
  }

  private get projector(): Projector {
    return { cam: this.renderer.camera, ppu: this.session.project.settings.pixelsPerUnit, hexSize: this.session.project.settings.hexSize };
  }

  centerOnStart(): void {
    const map = this.preview.map;
    const cam = this.renderer.camera;
    if (map.playerStart) {
      cam.x = map.playerStart.x;
      cam.y = map.playerStart.y;
    } else {
      const mid = Math.floor(map.height / 2) * map.width + Math.floor(map.width / 2);
      cam.x = this.world.centerX(mid);
      cam.y = this.world.centerY(mid);
    }
    cam.z = this.world.surfaceHeight(cam.x, cam.y);
    this.invalidate();
  }

  /** Click-to-focus (the warnings panel, the placements list). */
  focus(x: number, y: number): void {
    const cam = this.renderer.camera;
    cam.x = x;
    cam.y = y;
    cam.z = this.world.surfaceHeight(x, y);
    this.invalidate();
  }

  /** Redraw on the next animation frame (coalesced). */
  invalidate(): void {
    if (this.frame !== 0 || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private recompute(): void {
    this.preview.refresh();
    this.blocked = blockedEdges(this.world);
    this.warnings = warningRows(this.session.project, this.preview.map, this.world);
  }

  private changed(): void {
    // The open map can be gone after an undo of its creation: fall back to the start map.
    if (!this.session.project.maps.some((m) => m.id === this.session.state.mapId)) this.session.setState({ mapId: this.session.project.startMapId });
    this.recompute();
    this.renderer.invalidateTerrain();
    this.invalidate();
  }

  private sessionChanged(): void {
    const s = this.session.state;
    if (this.preview.currentMapId !== s.mapId) {
      this.preview.currentMapId = s.mapId;
      this.recompute();
      this.renderer.invalidateTerrain();
      this.centerOnStart();
    }
    if (this.session.art !== this.art && this.session.art) {
      this.art = this.session.art;
      this.renderer.useSharedArt(this.art);
    }
    this.invalidate();
  }

  private sizeOverlay(width: number, height: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(width * dpr);
    this.overlay.height = Math.round(height * dpr);
    this.overlay.style.width = `${width}px`;
    this.overlay.style.height = `${height}px`;
  }

  private readonly onResize = (): void => {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.resize(width, height);
    this.sizeOverlay(width, height);
    this.invalidate();
  };

  /** Brush cells under the pointer for the current tool, for the cursor outline. */
  private brushUnder(cell: number): number[] {
    const s = this.session.state;
    const map = this.preview.map;
    if (cell < 0) return [];
    if (s.tool === 'place' || s.tool === 'select') return s.tool === 'select' ? [] : [cell];
    return brushCells(cell, s.brushSize, map.width, map.height);
  }

  draw(): void {
    if (this.disposed) return;
    const s = this.session.state;
    this.renderer.render(1, null);
    const ctx = this.overlay.getContext('2d')!;
    const dpr = this.overlay.width / Math.max(1, this.host.clientWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.host.clientWidth, this.host.clientHeight);
    const p = this.projector;
    const cells = visibleCells(p, this.world);
    const map = this.preview.map;
    const selected = s.selection === null ? -1 : this.preview.indexOfKey(s.selection);

    let sight: Uint8Array | null = null;
    if (s.overlays.sight && selected >= 0) {
      const e = this.preview.entities;
      const data = e.data(selected);
      const range = data.sight?.range ?? data.acquisition?.range ?? 0;
      if (range > 0) {
        const player = this.session.project.archetypes.find((a) => a.id === this.session.project.settings.playerArchetypeId);
        const height = player?.components.collider?.height ?? 1.6;
        sight = sightCells(this.session.project, this.world, e.x(selected), e.y(selected), e.z(selected) + (data.sight?.eyeHeight ?? 1.4), range, height);
      }
    }
    const regions = s.overlays.regions
      ? map.regions.map((r, i) => ({ cells: regionCellSet(r.cells, map.width, map.height), color: REGION_COLORS[i % REGION_COLORS.length]!, selected: r.id === s.regionId }))
      : null;
    const drag = this.drag;
    drawEditorOverlays(ctx, p, {
      world: this.world,
      cells,
      levels: s.overlays.levels,
      blocked: s.overlays.blocked ? this.blocked : null,
      warnings: s.overlays.lint ? this.warnings : null,
      regions,
      sight,
      brush: this.brushUnder(this.hoverCell),
      brushColor: s.tool === 'region' && s.eraseRegion ? '#ff6b5e' : '#fff27a',
    });
    if (selected >= 0) {
      const e = this.preview.entities;
      drawSelection(ctx, p, e.x(selected), e.y(selected), e.z(selected), e.facing(selected), e.data(selected).collider?.radius ?? 0.4);
    }
    if (drag?.kind === 'place') {
      const z = this.world.surfaceHeight(drag.placement.x, drag.placement.y);
      drawSelection(ctx, p, drag.placement.x, drag.placement.y, z, drag.placement.facing, 0.4);
    }
  }

  private pickAt(ev: PointerEvent | MouseEvent): boolean {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.pickTerrain(ev.clientX - rect.left, ev.clientY - rect.top, this.pick);
  }

  private readonly onContext = (ev: Event): void => ev.preventDefault();

  private readonly onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    this.renderer.setZoom(this.renderer.camera.zoom * (ev.deltaY > 0 ? 0.9 : 1.1));
    this.invalidate();
  };

  private readonly onDown = (ev: PointerEvent): void => {
    const cam = this.renderer.camera;
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    // Pan: middle or right button, or Space with the left.
    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && this.space)) {
      this.drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, cx: cam.x, cy: cam.y };
      return;
    }
    if (ev.button !== 0 || !this.pickAt(ev)) return;
    const s = this.session.state;
    const project = this.session.project;
    const map = this.preview.map;
    const cell = this.pick.cell;
    switch (s.tool) {
      case 'terrain':
      case 'raise':
      case 'lower':
      case 'flatten': {
        if (s.tool === 'terrain' && s.terrainId === null) return;
        const label = { terrain: 'Paint terrain', raise: 'Raise', lower: 'Lower', flatten: 'Flatten' }[s.tool];
        this.drag = { kind: 'layer', stroke: new LayerStroke(project, label, map.id), level: map.layers.level[cell]! };
        this.paint(cell);
        break;
      }
      case 'region': {
        if (s.regionId === null) return;
        const stroke = new RegionStroke(project, map.id, s.regionId);
        this.drag = { kind: 'region', stroke };
        stroke.paint(brushCells(cell, s.brushSize, map.width, map.height), s.eraseRegion);
        break;
      }
      case 'place': {
        if (s.archetypeId === null) return;
        this.drag = { kind: 'place', placement: { key: this.session.doc.newId() as Id<'placement'>, archetypeId: s.archetypeId, x: this.pick.x, y: this.pick.y, facing: 0 } };
        break;
      }
      case 'select': {
        const rect = this.canvas.getBoundingClientRect();
        const index = this.renderer.pickEntity(ev.clientX - rect.left, ev.clientY - rect.top);
        const key = index >= 0 ? this.preview.entities.placementKey(index) : null;
        this.session.setState({ selection: key });
        if (key === null) return;
        const before = key === PLAYER_START_KEY ? null : structuredClone(map.placements.find((p) => p.key === key)!);
        const start = key === PLAYER_START_KEY && map.playerStart ? { ...map.playerStart } : null;
        const ex = this.preview.entities.x(index);
        const ey = this.preview.entities.y(index);
        this.drag = { kind: 'move', key, before, startBefore: start, dx: ex - this.pick.x, dy: ey - this.pick.y, moved: false };
        break;
      }
    }
    this.changedLive();
  };

  private paint(cell: number): void {
    const drag = this.drag;
    if (drag?.kind !== 'layer') return;
    const s = this.session.state;
    const map = this.preview.map;
    const cells = brushCells(cell, s.brushSize, map.width, map.height);
    if (s.tool === 'terrain' && s.terrainId) drag.stroke.paintTerrain(cells, s.terrainId);
    else if (s.tool === 'raise') drag.stroke.raise(cells, 1);
    else if (s.tool === 'lower') drag.stroke.raise(cells, -1);
    else if (s.tool === 'flatten') drag.stroke.flatten(cells, drag.level);
  }

  /** A live stroke changed the project: refresh what is drawn, without a command yet. */
  private changedLive(): void {
    this.recompute();
    this.renderer.invalidateTerrain();
    this.invalidate();
  }

  private readonly onMove = (ev: PointerEvent): void => {
    const drag = this.drag;
    if (drag?.kind === 'pan') {
      const cam = this.renderer.camera;
      const ppu = this.session.project.settings.pixelsPerUnit;
      cam.x = drag.cx - (ev.clientX - drag.sx) / (ppu * cam.zoom);
      cam.y = drag.cy - (ev.clientY - drag.sy) / (ppu * cam.zoom * 0.5);
      cam.z = this.world.surfaceHeight(cam.x, cam.y);
      this.invalidate();
      return;
    }
    if (ev.target !== this.canvas && drag === null) return;
    const hit = this.pickAt(ev);
    const cell = hit ? this.pick.cell : -1;
    if (cell !== this.hoverCell) {
      this.hoverCell = cell;
      this.session.emit(); // the status bar shows the hovered cell
    }
    if (drag && hit) {
      const map = this.preview.map;
      switch (drag.kind) {
        case 'layer':
          this.paint(cell);
          this.changedLive();
          break;
        case 'region':
          drag.stroke.paint(brushCells(cell, this.session.state.brushSize, map.width, map.height), this.session.state.eraseRegion);
          this.changedLive();
          break;
        case 'place': {
          const dx = this.pick.x - drag.placement.x;
          const dy = this.pick.y - drag.placement.y;
          if (Math.hypot(dx, dy) > 0.2) drag.placement.facing = Math.atan2(dy, dx);
          break;
        }
        case 'move': {
          const x = this.pick.x + drag.dx;
          const y = this.pick.y + drag.dy;
          drag.moved = true;
          if (drag.key === PLAYER_START_KEY) {
            if (map.playerStart) map.playerStart = { ...map.playerStart, x, y };
          } else {
            const live = map.placements.find((p) => p.key === drag.key);
            if (live) {
              live.x = x;
              live.y = y;
            }
          }
          this.preview.refresh();
          break;
        }
      }
    }
    this.invalidate();
  };

  private readonly onUp = (): void => {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const doc = this.session.doc;
    const map = this.preview.map;
    switch (drag.kind) {
      case 'layer':
        doc.record(drag.stroke.finish());
        break;
      case 'region':
        doc.record(drag.stroke.finish());
        break;
      case 'place':
        doc.run(new AddPlacement(map.id, drag.placement));
        this.session.setState({ selection: drag.placement.key });
        break;
      case 'move':
        if (!drag.moved) break;
        if (drag.key === PLAYER_START_KEY) doc.record(new SetPlayerStart(map.id, drag.startBefore ?? undefined, map.playerStart ? { ...map.playerStart } : undefined));
        else if (drag.before) {
          const after = map.placements.find((p) => p.key === drag.key);
          if (after) doc.record(new UpdatePlacement('Move', map.id, drag.before, structuredClone(after)));
        }
        break;
      case 'pan':
        break;
    }
    this.invalidate();
  };

  private readonly onKey = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (this.session.playing) return;
    const doc = this.session.doc;
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.code === 'Space') this.space = true;
    if (mod && ev.code === 'KeyZ') {
      ev.preventDefault();
      if (ev.shiftKey) doc.redo();
      else doc.undo();
      return;
    }
    if (mod && ev.code === 'KeyY') {
      ev.preventDefault();
      doc.redo();
      return;
    }
    const key = this.session.state.selection;
    const map = this.preview.map;
    if ((ev.code === 'Delete' || ev.code === 'Backspace') && key && key !== PLAYER_START_KEY) {
      doc.run(new RemovePlacement(map.id, key));
      this.session.setState({ selection: null });
      return;
    }
    if (mod && ev.code === 'KeyD' && key && key !== PLAYER_START_KEY) {
      ev.preventDefault();
      const source = map.placements.find((p) => p.key === key);
      if (source) {
        const copy = { ...structuredClone(source), key: doc.newId() as Id<'placement'>, x: source.x + 1, y: source.y };
        doc.run(new AddPlacement(map.id, copy));
        this.session.setState({ selection: copy.key });
      }
      return;
    }
    // Arrow keys pan.
    const cam = this.renderer.camera;
    const step = 2 / cam.zoom;
    if (ev.code === 'ArrowLeft') cam.x -= step;
    else if (ev.code === 'ArrowRight') cam.x += step;
    else if (ev.code === 'ArrowUp') cam.y -= step;
    else if (ev.code === 'ArrowDown') cam.y += step;
    else return;
    cam.z = this.world.surfaceHeight(cam.x, cam.y);
    this.invalidate();
  };

  private readonly onKeyUp = (ev: KeyboardEvent): void => {
    if (ev.code === 'Space') this.space = false;
  };

  /** Where "Play from here" starts: the cell under the pointer when the menu opened, else the camera's focus. */
  playFromPoint(): { x: number; y: number } {
    if (this.hoverCell >= 0) return { x: this.world.centerX(this.hoverCell), y: this.world.centerY(this.hoverCell) };
    return { x: this.renderer.camera.x, y: this.renderer.camera.y };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.offDoc();
    this.offSession();
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    this.renderer.destroy();
    this.canvas.remove();
    this.overlay.remove();
  }
}
