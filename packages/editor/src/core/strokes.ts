/**
 * Strokes: a brush stroke edits the map's layers live (so the canvas shows
 * it while dragging) and becomes one command when the pointer is released
 * (spec 8.5, 8.7).
 */
import { axialQ, offsetCol } from '@loreengine/hexmath';
import type { Id, MapDef, Project } from '@loreengine/schema';
import { LayerEdit, RegionEdit, mapOf } from './commands.ts';

/** Edits a map's terrain and level layers; remembers each touched cell's first value. */
export class LayerStroke {
  readonly map: MapDef;
  private readonly slot = new Map<number, number>();
  private readonly cells: number[] = [];
  private readonly beforeTerrain: number[] = [];
  private readonly beforeLevel: number[] = [];
  private paletteAdded: Id<'terrain'> | null = null;
  private done = false;

  constructor(
    project: Project,
    readonly label: string,
    readonly mapId: string,
    private readonly maxLevel = project.settings.maxLevel,
  ) {
    this.map = mapOf(project, mapId);
  }

  /** True when this stroke has already changed `cell`. */
  touched(cell: number): boolean {
    return this.slot.has(cell);
  }

  private touch(cell: number): void {
    if (this.slot.has(cell)) return;
    const { terrain, level } = this.map.layers;
    this.slot.set(cell, this.cells.length);
    this.cells.push(cell);
    this.beforeTerrain.push(terrain[cell]!);
    this.beforeLevel.push(level[cell]!);
  }

  /** The palette index for a terrain, appending it to the map's palette (once per stroke) when missing. */
  paletteIndex(terrainId: Id<'terrain'>): number {
    const palette = this.map.terrainPalette;
    let index = palette.indexOf(terrainId);
    if (index < 0) {
      if (this.paletteAdded !== null) throw new Error('One terrain per stroke');
      palette.push(terrainId);
      this.paletteAdded = terrainId;
      index = palette.length - 1;
    }
    return index;
  }

  paintTerrain(cells: readonly number[], terrainId: Id<'terrain'>): void {
    const index = this.paletteIndex(terrainId);
    for (const cell of cells) {
      this.touch(cell);
      this.map.layers.terrain[cell] = index;
    }
  }

  /** Raise (+1) or lower (-1) each cell once per stroke, clamped to 0..maxLevel. */
  raise(cells: readonly number[], delta: 1 | -1): void {
    const level = this.map.layers.level;
    for (const cell of cells) {
      if (this.slot.has(cell)) continue;
      this.touch(cell);
      level[cell] = Math.max(0, Math.min(this.maxLevel, level[cell]! + delta));
    }
  }

  /** Set cells to one level. */
  flatten(cells: readonly number[], to: number): void {
    const { level } = this.map.layers;
    const clamped = Math.max(0, Math.min(this.maxLevel, to));
    for (const cell of cells) {
      this.touch(cell);
      level[cell] = clamped;
    }
  }

  /** Undo the live edits and drop the stroke. */
  cancel(project: Project): void {
    if (this.done) return;
    this.done = true;
    const edit = this.edit(true);
    edit.revert(project);
  }

  /** End the stroke: the command to record, or null when nothing changed. */
  finish(): LayerEdit | null {
    if (this.done) return null;
    this.done = true;
    const edit = this.edit(false);
    if (edit.cells.length === 0) {
      if (this.paletteAdded !== null) this.map.terrainPalette.pop();
      return null;
    }
    return edit;
  }

  private edit(all: boolean): LayerEdit {
    const { terrain, level } = this.map.layers;
    const keep: number[] = [];
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]!;
      if (all || terrain[cell] !== this.beforeTerrain[i] || level[cell] !== this.beforeLevel[i]) keep.push(i);
    }
    const n = keep.length;
    const cells = new Int32Array(n);
    const before = { terrain: new Uint16Array(n), level: new Uint8Array(n) };
    const after = { terrain: new Uint16Array(n), level: new Uint8Array(n) };
    keep.forEach((i, k) => {
      const cell = this.cells[i]!;
      cells[k] = cell;
      before.terrain[k] = this.beforeTerrain[i]!;
      before.level[k] = this.beforeLevel[i]!;
      after.terrain[k] = terrain[cell]!;
      after.level[k] = level[cell]!;
    });
    // A palette entry only counts when some cell uses it; `cancel` reverts it either way.
    const added = this.paletteAdded !== null && (all || n > 0) ? this.paletteAdded : null;
    return new LayerEdit(this.label, this.mapId, cells, before, after, added);
  }
}

/** Cell index -> packed (q, r) and back, for region cell lists. */
export function regionCellSet(cells: Int16Array, width: number, height: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i + 1 < cells.length; i += 2) {
    const q = cells[i]!;
    const r = cells[i + 1]!;
    const col = offsetCol(q, r);
    if (col >= 0 && r >= 0 && col < width && r < height) out.add(r * width + col);
  }
  return out;
}

export function packRegionCells(set: ReadonlySet<number>, width: number): Int16Array {
  const sorted = [...set].sort((a, b) => a - b);
  const out = new Int16Array(sorted.length * 2);
  sorted.forEach((cell, k) => {
    const col = cell % width;
    const row = (cell - col) / width;
    out[k * 2] = axialQ(col, row);
    out[k * 2 + 1] = row;
  });
  return out;
}

/** Paints or erases a region's cells; one command per stroke. */
export class RegionStroke {
  private readonly before: Int16Array;
  private readonly set: Set<number>;
  private readonly map: MapDef;

  constructor(
    project: Project,
    readonly mapId: string,
    readonly regionId: string,
  ) {
    this.map = mapOf(project, mapId);
    const region = this.map.regions.find((r) => r.id === regionId);
    if (!region) throw new Error(`No region ${regionId}`);
    this.before = region.cells.slice();
    this.set = regionCellSet(region.cells, this.map.width, this.map.height);
  }

  paint(cells: readonly number[], erase: boolean): void {
    for (const cell of cells) {
      if (erase) this.set.delete(cell);
      else this.set.add(cell);
    }
    this.map.regions.find((r) => r.id === this.regionId)!.cells = packRegionCells(this.set, this.map.width);
  }

  cells(): ReadonlySet<number> {
    return this.set;
  }

  finish(): RegionEdit | null {
    const region = this.map.regions.find((r) => r.id === this.regionId)!;
    const after = region.cells;
    const original = regionCellSet(this.before, this.map.width, this.map.height);
    const same = original.size === this.set.size && [...original].every((cell) => this.set.has(cell));
    if (same) {
      region.cells = this.before.slice();
      return null;
    }
    return new RegionEdit('Paint region', this.mapId, this.regionId, this.before, after.slice());
  }
}
