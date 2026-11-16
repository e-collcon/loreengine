/**
 * Depth order (spec 6.6). The draw list is row strips, back to front. Each
 * entity is inserted after the strip containing its feet; within a strip,
 * terrain first, then entities by foot screen position. So a unit behind a
 * cliff is covered by the cliff's face, and a unit on the plateau draws
 * over the ground below it.
 *
 * "Its feet" is the entity's footprint, not a point: hex rows interlock, so
 * a unit standing in the lower part of its hex overlaps the tops of the
 * next row, and sorting by the footprint's front edge keeps those tops from
 * being drawn over its feet (DECISIONS_LOG D81).
 *
 * The list is built from the read-only runtime view and nothing else, so it
 * is testable without a GPU. Building it allocates nothing: all buffers are
 * preallocated for the entity cap.
 */
import { MAX_ENTITIES } from '@loreengine/runtime/view';
import type { RuntimeView } from '@loreengine/runtime/view';
import { screenX, screenY, visibleRows } from './projection.ts';
import type { Camera } from './projection.ts';
import { footprintRadius, spriteMetrics } from './sprites.ts';

export const ITEM_STRIP = 0;
export const ITEM_ENTITY = 1;

const SQRT1_2 = Math.SQRT1_2;

export class DrawList {
  /** Number of items; items are in draw order, back to front. */
  count = 0;
  /** ITEM_STRIP or ITEM_ENTITY. */
  readonly kind = new Uint8Array(MAX_ENTITIES + 256);
  /** The map row of a strip, or the entity index. */
  readonly ref = new Int32Array(MAX_ENTITIES + 256);

  /** Per entity index: interpolated foot position on screen, and sprite bounds. */
  readonly footX = new Float64Array(MAX_ENTITIES);
  readonly footY = new Float64Array(MAX_ENTITIES);
  readonly left = new Float64Array(MAX_ENTITIES);
  readonly top = new Float64Array(MAX_ENTITIES);
  readonly right = new Float64Array(MAX_ENTITIES);
  readonly bottom = new Float64Array(MAX_ENTITIES);
  /** Per entity index: the strip it is drawn after. */
  readonly sortRow = new Int32Array(MAX_ENTITIES);

  /** First and last visible map row of the last build. */
  firstRow = 0;
  lastRow = -1;

  private readonly visible = new Int32Array(MAX_ENTITIES);
  private visibleCount = 0;
  private readonly rows = { first: 0, last: -1 };
  private readonly metrics = { width: 0, height: 0 };
  private readonly order = (a: number, b: number): number => {
    const row = this.sortRow[a]! - this.sortRow[b]!;
    if (row !== 0) return row;
    const y = this.footY[a]! - this.footY[b]!;
    if (y !== 0) return y;
    return a - b; // a stable, deterministic tie-break
  };

  /**
   * Build the list for one frame. `alpha` is the client's leftover tick
   * fraction: positions are interpolated between the previous and current
   * tick (a teleport sets them equal, which skips it). `maxSurface` is the
   * highest surface on the map in world units.
   */
  build(view: RuntimeView, cam: Camera, alpha: number, maxSurface: number): void {
    const settings = view.project.settings;
    const ppu = settings.pixelsPerUnit;
    const world = view.world;
    const entities = view.entities;
    this.count = 0;
    this.visibleCount = 0;
    if (!world.loaded) {
      this.firstRow = 0;
      this.lastRow = -1;
      return;
    }
    visibleRows(cam, ppu, settings.hexSize, world.height, maxSurface, this.rows);
    const first = (this.firstRow = this.rows.first);
    const last = (this.lastRow = this.rows.last);

    const end = entities.highWater;
    for (let i = 0; i < end; i++) {
      if (!entities.alive(i)) continue;
      const x = entities.prevX(i) + (entities.x(i) - entities.prevX(i)) * alpha;
      const y = entities.prevY(i) + (entities.y(i) - entities.prevY(i)) * alpha;
      const z = entities.prevZ(i) + (entities.z(i) - entities.prevZ(i)) * alpha;
      const sx = screenX(cam, ppu, x);
      const sy = screenY(cam, ppu, y, z);
      const data = entities.data(i);
      spriteMetrics(data, this.metrics);
      const w = this.metrics.width * ppu * cam.zoom;
      const h = this.metrics.height * ppu * cam.zoom;
      // Cull anything whose sprite bounds miss the viewport.
      if (sx + w / 2 < 0 || sx - w / 2 > cam.width || sy < 0 || sy - h > cam.height) continue;
      this.footX[i] = sx;
      this.footY[i] = sy;
      this.left[i] = sx - w / 2;
      this.right[i] = sx + w / 2;
      this.top[i] = sy - h;
      this.bottom[i] = sy;

      // The frontmost row the footprint reaches, among cells it could be standing on.
      const r = footprintRadius(data);
      const d = r * SQRT1_2;
      let row = rowOf(world.cellAt(x, y), world.width);
      row = frontRow(world, x, y + r, z, row);
      row = frontRow(world, x - d, y + d, z, row);
      row = frontRow(world, x + d, y + d, z, row);
      row = frontRow(world, x - r, y, z, row);
      row = frontRow(world, x + r, y, z, row);
      this.sortRow[i] = row < first ? first : row > last ? last : row;
      this.visible[this.visibleCount++] = i;
    }
    const sorted = this.visible.subarray(0, this.visibleCount).sort(this.order);

    let next = 0;
    for (let row = first; row <= last; row++) {
      this.kind[this.count] = ITEM_STRIP;
      this.ref[this.count++] = row;
      while (next < sorted.length && this.sortRow[sorted[next]!] === row) {
        this.kind[this.count] = ITEM_ENTITY;
        this.ref[this.count++] = sorted[next++]!;
      }
    }
  }

  /** Position of the strip for `row` in the list, or -1 when it is not visible. */
  indexOfStrip(row: number): number {
    for (let i = 0; i < this.count; i++) if (this.kind[i] === ITEM_STRIP && this.ref[i] === row) return i;
    return -1;
  }

  /** Position of an entity in the list, or -1 when it was culled. */
  indexOfEntity(index: number): number {
    for (let i = 0; i < this.count; i++) if (this.kind[i] === ITEM_ENTITY && this.ref[i] === index) return i;
    return -1;
  }
}

function rowOf(cell: number, width: number): number {
  return cell < 0 ? -1 : (cell - (cell % width)) / width;
}

/**
 * The row of the cell under one footprint sample, if that is further front
 * than `row` and the entity could be standing on it (its surface is not a
 * step above the entity's feet).
 */
function frontRow(world: RuntimeView['world'], x: number, y: number, z: number, row: number): number {
  const cell = world.cellAt(x, y);
  if (cell < 0) return row;
  const r = rowOf(cell, world.width);
  if (r <= row) return row;
  return world.heightIn(cell, x, y) > z + 0.05 ? row : r;
}
