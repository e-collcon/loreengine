/**
 * Canvas commands (spec 8.7): paint, elevation, ramps, placements, regions.
 * Each records what it needs to undo itself exactly; a brush stroke is one
 * command. Database edits do not go through here: they use Save and Cancel.
 */
import type { EntityPlacement, Id, MapDef, Project, RegionDef } from '@loreengine/schema';

export interface Command {
  readonly label: string;
  readonly mapId: string;
  apply(project: Project): void;
  revert(project: Project): void;
}

export function mapOf(project: Project, mapId: string): MapDef {
  const map = project.maps.find((m) => m.id === mapId);
  if (!map) throw new Error(`No map ${mapId}`);
  return map;
}

/** Layer values for a set of cells, before and after. Built by a stroke; applied cell by cell. */
export class LayerEdit implements Command {
  constructor(
    readonly label: string,
    readonly mapId: string,
    readonly cells: Int32Array,
    readonly before: { terrain: Uint16Array; level: Uint8Array; ramp: Uint8Array },
    readonly after: { terrain: Uint16Array; level: Uint8Array; ramp: Uint8Array },
    /** A terrain this stroke appended to the map's palette, removed again on undo. */
    readonly paletteAdded: Id<'terrain'> | null,
  ) {}

  apply(project: Project): void {
    const map = mapOf(project, this.mapId);
    if (this.paletteAdded !== null) map.terrainPalette.push(this.paletteAdded);
    this.write(map, this.after);
  }

  revert(project: Project): void {
    const map = mapOf(project, this.mapId);
    this.write(map, this.before);
    if (this.paletteAdded !== null) {
      const last = map.terrainPalette.pop();
      if (last !== this.paletteAdded) throw new Error('Palette changed out of order');
    }
  }

  private write(map: MapDef, values: LayerEdit['before']): void {
    const { terrain, level, ramp } = map.layers;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]!;
      terrain[cell] = values.terrain[i]!;
      level[cell] = values.level[i]!;
      ramp[cell] = values.ramp[i]!;
    }
  }
}

export class AddPlacement implements Command {
  readonly label = 'Place';
  constructor(
    readonly mapId: string,
    readonly placement: EntityPlacement,
    readonly index = -1,
  ) {}
  apply(project: Project): void {
    const list = mapOf(project, this.mapId).placements;
    const at = this.index < 0 || this.index > list.length ? list.length : this.index;
    list.splice(at, 0, structuredClone(this.placement));
  }
  revert(project: Project): void {
    const list = mapOf(project, this.mapId).placements;
    const at = list.findIndex((p) => p.key === this.placement.key);
    if (at >= 0) list.splice(at, 1);
  }
}

export class RemovePlacement implements Command {
  readonly label = 'Delete placement';
  private removed: { placement: EntityPlacement; index: number } | null = null;
  constructor(
    readonly mapId: string,
    readonly key: string,
  ) {}
  apply(project: Project): void {
    const list = mapOf(project, this.mapId).placements;
    const index = list.findIndex((p) => p.key === this.key);
    if (index < 0) throw new Error(`No placement ${this.key}`);
    this.removed = { placement: list[index]!, index };
    list.splice(index, 1);
  }
  revert(project: Project): void {
    if (!this.removed) return;
    mapOf(project, this.mapId).placements.splice(this.removed.index, 0, this.removed.placement);
  }
}

/** Replaces a placement's fields (move, facing, overrides) with a snapshot. */
export class UpdatePlacement implements Command {
  constructor(
    readonly label: string,
    readonly mapId: string,
    readonly before: EntityPlacement,
    readonly after: EntityPlacement,
  ) {}
  apply(project: Project): void {
    this.write(project, this.after);
  }
  revert(project: Project): void {
    this.write(project, this.before);
  }
  private write(project: Project, value: EntityPlacement): void {
    const list = mapOf(project, this.mapId).placements;
    const index = list.findIndex((p) => p.key === value.key);
    if (index < 0) throw new Error(`No placement ${value.key}`);
    list[index] = structuredClone(value);
  }
}

/** A region's whole cell list, before and after a stroke. */
export class RegionEdit implements Command {
  constructor(
    readonly label: string,
    readonly mapId: string,
    readonly regionId: string,
    readonly before: Int16Array,
    readonly after: Int16Array,
  ) {}
  apply(project: Project): void {
    this.region(project).cells = this.after.slice();
  }
  revert(project: Project): void {
    this.region(project).cells = this.before.slice();
  }
  private region(project: Project): RegionDef {
    const region = mapOf(project, this.mapId).regions.find((r) => r.id === this.regionId);
    if (!region) throw new Error(`No region ${this.regionId}`);
    return region;
  }
}

export class AddRegion implements Command {
  readonly label = 'Add region';
  constructor(
    readonly mapId: string,
    readonly region: RegionDef,
  ) {}
  apply(project: Project): void {
    mapOf(project, this.mapId).regions.push({ ...this.region, cells: this.region.cells.slice() });
  }
  revert(project: Project): void {
    const list = mapOf(project, this.mapId).regions;
    const index = list.findIndex((r) => r.id === this.region.id);
    if (index >= 0) list.splice(index, 1);
  }
}

/** Runs canvas commands with undo and redo, keeping the newest 200 (spec 8.7, 9.2). */
export class CommandStack {
  static readonly CAP = 200;
  private readonly done: Command[] = [];
  private readonly undone: Command[] = [];

  /** Apply and record. */
  run(project: Project, command: Command): void {
    command.apply(project);
    this.push(command);
  }

  /** Record a command whose effect is already in the project (a live stroke). */
  push(command: Command): void {
    this.done.push(command);
    if (this.done.length > CommandStack.CAP) this.done.shift();
    this.undone.length = 0;
  }

  undo(project: Project): Command | null {
    const command = this.done.pop();
    if (!command) return null;
    command.revert(project);
    this.undone.push(command);
    return command;
  }

  redo(project: Project): Command | null {
    const command = this.undone.pop();
    if (!command) return null;
    command.apply(project);
    this.done.push(command);
    return command;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  get size(): number {
    return this.done.length;
  }
  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
  }
}
