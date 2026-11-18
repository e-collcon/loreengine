/**
 * 2D overlays drawn over the PixiJS canvas: the editor's (levels, blocked
 * edges, lint, regions, sight, brush) and the playtest's debug layer
 * (spec 8.5, 8.8). Everything is projected with the renderer's camera.
 */
import { cornerOffsetX, cornerOffsetY, dirUnitX, dirUnitY } from '@loreengine/hexmath';
import type { HexDir } from '@loreengine/hexmath';
import { hitboxOutline, screenX, screenY } from '@loreengine/render';
import type { Camera } from '@loreengine/render';
import { NO_ENTITY, PHASE_ACTIVE, PHASE_WINDUP } from '@loreengine/runtime/view';
import type { RuntimeView, World } from '@loreengine/runtime/view';
import type { Project } from '@loreengine/schema';
import type { WarningRow } from '../core/overlays.ts';

export interface Projector {
  cam: Camera;
  ppu: number;
  hexSize: number;
}

/** The six corners of a cell's top, on screen, following its surface. */
export function hexPath(ctx: CanvasRenderingContext2D, p: Projector, world: { centerX(c: number): number; centerY(c: number): number; heightIn(c: number, x: number, y: number): number }, cell: number, inset = 1): void {
  const cx = world.centerX(cell);
  const cy = world.centerY(cell);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const x = cx + cornerOffsetX(i, p.hexSize) * inset;
    const y = cy + cornerOffsetY(i, p.hexSize) * inset;
    const sx = screenX(p.cam, p.ppu, x);
    const sy = screenY(p.cam, p.ppu, y, world.heightIn(cell, x, y));
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
}

/** Cells whose center is on screen (with a margin), in draw order. */
export function visibleCells(p: Projector, world: World, margin = 80): number[] {
  const out: number[] = [];
  for (let cell = 0; cell < world.cells; cell++) {
    const x = world.centerX(cell);
    const y = world.centerY(cell);
    const sx = screenX(p.cam, p.ppu, x);
    if (sx < -margin || sx > p.cam.width + margin) continue;
    const sy = screenY(p.cam, p.ppu, y, world.surfaceHeightIn(cell, x, y));
    if (sy < -margin || sy > p.cam.height + margin) continue;
    out.push(cell);
  }
  return out;
}

const worldShape = (world: World) => ({
  centerX: (c: number) => world.centerX(c),
  centerY: (c: number) => world.centerY(c),
  heightIn: (c: number, x: number, y: number) => world.surfaceHeightIn(c, x, y),
});

export const REGION_COLORS = ['#3d8bfd', '#d63384', '#20c997', '#fd7e14', '#6f42c1', '#0dcaf0', '#ffc107', '#198754'];

export interface EditorOverlayInput {
  world: World;
  cells: number[];
  levels: boolean;
  blocked: Float64Array | null;
  warnings: WarningRow[] | null;
  regions: { cells: ReadonlySet<number>; color: string; selected: boolean }[] | null;
  sight: Uint8Array | null;
  brush: number[];
  brushColor: string;
  /** A ramp being dragged: its cell and the direction it would rise. */
  rampPreview: { cell: number; dir: number } | null;
}

export function drawEditorOverlays(ctx: CanvasRenderingContext2D, p: Projector, o: EditorOverlayInput): void {
  const shape = worldShape(o.world);
  if (o.sight) {
    ctx.fillStyle = 'rgba(255, 236, 120, 0.28)';
    for (const cell of o.cells) {
      if (o.sight[cell] !== 1) continue;
      hexPath(ctx, p, shape, cell, 0.96);
      ctx.fill();
    }
  }
  if (o.regions) {
    for (const region of o.regions) {
      ctx.fillStyle = region.color + (region.selected ? '50' : '24');
      ctx.strokeStyle = region.color + (region.selected ? 'ff' : '66');
      ctx.lineWidth = region.selected ? 2 : 1;
      for (const cell of o.cells) {
        if (!region.cells.has(cell)) continue;
        hexPath(ctx, p, shape, cell, 0.9);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  if (o.blocked) {
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const b = o.blocked;
    for (let i = 0; i < b.length; i += 6) {
      const x0 = screenX(p.cam, p.ppu, b[i]!);
      const y0 = screenY(p.cam, p.ppu, b[i + 1]!, b[i + 2]!);
      const x1 = screenX(p.cam, p.ppu, b[i + 3]!);
      const y1 = screenY(p.cam, p.ppu, b[i + 4]!, b[i + 5]!);
      if ((x0 < 0 && x1 < 0) || (x0 > p.cam.width && x1 > p.cam.width) || (y0 < 0 && y1 < 0) || (y0 > p.cam.height && y1 > p.cam.height)) continue;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }
  if (o.levels && p.cam.zoom >= 0.6) {
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const cell of o.cells) {
      const x = o.world.centerX(cell);
      const y = o.world.centerY(cell);
      const sx = screenX(p.cam, p.ppu, x);
      const sy = screenY(p.cam, p.ppu, y, o.world.surfaceHeightIn(cell, x, y));
      const ramp = o.world.ramp[cell]!;
      const label = ramp ? `${o.world.level[cell]}↗${ramp}` : String(o.world.level[cell]);
      ctx.fillStyle = 'rgba(20, 22, 26, 0.65)';
      ctx.fillText(label, sx + 1, sy + 1);
      ctx.fillStyle = '#fffbe8';
      ctx.fillText(label, sx, sy);
    }
  }
  if (o.warnings) {
    ctx.strokeStyle = '#ff9f1c';
    ctx.lineWidth = 3;
    for (const w of o.warnings) {
      if (w.cell === undefined || w.cell < 0) continue;
      hexPath(ctx, p, shape, w.cell, 0.8);
      ctx.stroke();
    }
  }
  if (o.rampPreview && o.rampPreview.dir >= 1 && o.rampPreview.dir <= 6) {
    const { cell, dir } = o.rampPreview;
    const x = o.world.centerX(cell);
    const y = o.world.centerY(cell);
    const tx = x + dirUnitX(dir as HexDir) * p.hexSize * 0.8;
    const ty = y + dirUnitY(dir as HexDir) * p.hexSize * 0.8;
    ctx.strokeStyle = '#fff27a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(screenX(p.cam, p.ppu, x), screenY(p.cam, p.ppu, y, o.world.surfaceHeightIn(cell, x, y)));
    ctx.lineTo(screenX(p.cam, p.ppu, tx), screenY(p.cam, p.ppu, ty, o.world.surfaceHeightIn(cell, tx, ty)));
    ctx.stroke();
  }
  if (o.brush.length > 0) {
    ctx.strokeStyle = o.brushColor;
    ctx.lineWidth = 2;
    for (const cell of o.brush) {
      hexPath(ctx, p, shape, cell, 0.98);
      ctx.stroke();
    }
  }
}

/** A selection ring and facing tick around an entity's feet. */
export function drawSelection(ctx: CanvasRenderingContext2D, p: Projector, x: number, y: number, z: number, facing: number, radius: number): void {
  const sx = screenX(p.cam, p.ppu, x);
  const sy = screenY(p.cam, p.ppu, y, z);
  const r = radius * p.ppu * p.cam.zoom;
  ctx.strokeStyle = '#fff27a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(screenX(p.cam, p.ppu, x + Math.cos(facing) * radius * 1.6), screenY(p.cam, p.ppu, y + Math.sin(facing) * radius * 1.6, z));
  ctx.stroke();
}

export interface DebugToggles {
  coords: boolean;
  blocked: boolean;
  hitboxes: boolean;
  sight: boolean;
  brains: boolean;
  paths: boolean;
}

export const DEBUG_LABELS: Record<keyof DebugToggles, string> = {
  coords: 'Hex coords + levels',
  blocked: 'Blocked edges',
  hitboxes: 'Hitboxes',
  sight: 'Sight + targets',
  brains: 'Brain states',
  paths: 'Paths',
};

const pathScratch = new Float64Array(128);
const outlineScratch: number[] = [];

/** The playtest's debug layer (spec 8.8), read from the runtime's view only. */
export function drawDebug(ctx: CanvasRenderingContext2D, p: Projector, view: RuntimeView, world: World, blocked: Float64Array, t: DebugToggles, project: Project): void {
  const shape = worldShape(world);
  if (t.coords && p.cam.zoom >= 0.6) {
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const cell of visibleCells(p, world)) {
      const x = world.centerX(cell);
      const y = world.centerY(cell);
      const sx = screenX(p.cam, p.ppu, x);
      const sy = screenY(p.cam, p.ppu, y, world.surfaceHeightIn(cell, x, y));
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      hexPath(ctx, p, shape, cell);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${cell % world.width},${Math.floor(cell / world.width)}`, sx, sy - 6);
      ctx.fillText(`L${world.level[cell]}${world.ramp[cell] ? `↗${world.ramp[cell]}` : ''}`, sx, sy + 6);
    }
  }
  if (t.blocked) drawEditorOverlays(ctx, p, { world, cells: [], levels: false, blocked, warnings: null, regions: null, sight: null, brush: [], brushColor: '', rampPreview: null });

  const e = view.entities;
  for (let i = 0; i < e.highWater; i++) {
    if (!e.alive(i) || e.dead(i)) continue;
    const x = e.x(i);
    const y = e.y(i);
    const z = e.z(i);
    const sx = screenX(p.cam, p.ppu, x);
    const sy = screenY(p.cam, p.ppu, y, z);
    const data = e.data(i);
    if (t.paths) {
      const n = e.path(i, pathScratch);
      if (n > 0) {
        ctx.strokeStyle = 'rgba(90, 200, 250, 0.9)';
        ctx.fillStyle = 'rgba(90, 200, 250, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        for (let k = 0; k < n; k++) {
          const wx = pathScratch[k * 2]!;
          const wy = pathScratch[k * 2 + 1]!;
          ctx.lineTo(screenX(p.cam, p.ppu, wx), screenY(p.cam, p.ppu, wy, world.surfaceHeight(wx, wy)));
        }
        ctx.stroke();
        for (let k = 0; k < n; k++) {
          const wx = pathScratch[k * 2]!;
          const wy = pathScratch[k * 2 + 1]!;
          ctx.fillRect(screenX(p.cam, p.ppu, wx) - 2, screenY(p.cam, p.ppu, wy, world.surfaceHeight(wx, wy)) - 2, 4, 4);
        }
      }
    }
    if (t.hitboxes) {
      const phase = e.attackPhase(i);
      const attack = phase === PHASE_WINDUP || phase === PHASE_ACTIVE ? project.attacks[e.attack(i)] : undefined;
      if (attack) {
        const n = hitboxOutline(attack.hitbox, x, y, e.facing(i), outlineScratch);
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const px = screenX(p.cam, p.ppu, outlineScratch[k * 2]!);
          const py = screenY(p.cam, p.ppu, outlineScratch[k * 2 + 1]!, z);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        // Windup as an outline, active filled.
        if (phase === PHASE_ACTIVE) {
          ctx.fillStyle = 'rgba(255, 59, 48, 0.45)';
          ctx.fill();
        }
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    if (t.sight) {
      const target = e.target(i);
      const j = target === NO_ENTITY ? -1 : e.indexOf(target);
      if (j >= 0) {
        const eye = z + (data.sight ? data.sight.eyeHeight : 1);
        const other = e.data(j).collider;
        const seen = view.canSee(e.id(i), target);
        ctx.strokeStyle = seen ? 'rgba(52, 199, 89, 0.95)' : 'rgba(255, 149, 0, 0.95)';
        ctx.setLineDash(seen ? [] : [5, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, screenY(p.cam, p.ppu, y, eye));
        ctx.lineTo(screenX(p.cam, p.ppu, e.x(j)), screenY(p.cam, p.ppu, e.y(j), e.z(j) + (other ? other.height * 0.5 : 0.5)));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (t.brains) {
      const state = e.brainState(i);
      if (state) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const height = (data.collider?.height ?? 1.6) * project.settings.levelHeight;
        const ty = screenY(p.cam, p.ppu, y, z + height) - 14;
        const w = ctx.measureText(state).width + 8;
        ctx.fillStyle = 'rgba(20, 22, 26, 0.75)';
        ctx.fillRect(sx - w / 2, ty - 14, w, 15);
        ctx.fillStyle = '#ffe08a';
        ctx.fillText(state, sx, ty);
      }
    }
  }
}
