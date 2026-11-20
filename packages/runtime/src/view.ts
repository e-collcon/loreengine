/**
 * @loreengine/runtime/view — the read-only entry point (spec 4.3).
 * Renderer and audio see state and events through it; no mutating call is
 * reachable from here. Everything a `RuntimeView` returns is a value, a
 * read-only authored object, or a visitor callback.
 */
import type { EdgeType } from './world.ts';
import type { HexDir } from '@loreengine/hexmath';
import type { ComponentData, MovementMode, Project, VariableValue } from '@loreengine/schema';
import type { DiagnosticEntry } from './diagnostics.ts';
import type { EntityId } from './entities.ts';
import type { PresentationEvent } from './presentation.ts';
import type { ClickAction } from './orders.ts';
import type { CastOptions, CastResult, Vec3 } from './sight.ts';
import type { ClockMode, Outcome } from './sim.ts';

export type { EntityId } from './entities.ts';
export type { PresentationEvent, PresentationKind } from './presentation.ts';
export type { DiagnosticEntry } from './diagnostics.ts';
export type { ClockMode, Outcome } from './sim.ts';
export type { ClickAction } from './orders.ts';
export type { CastOptions, CastResult, Vec3 } from './sight.ts';
export { NO_ENTITY, MAX_ENTITIES, PHASE_NONE, PHASE_WINDUP, PHASE_ACTIVE, PHASE_RECOVERY } from './entities.ts';
export { PRESENTATION_KINDS } from './presentation.ts';
export { TICK_HZ, MS_PER_TICK, SECONDS_PER_TICK } from './time.ts';

/** Entities, by index. Iterate `0 .. highWater - 1` and skip indices where `alive` is false. */
export interface EntityView {
  readonly count: number;
  readonly highWater: number;
  alive(index: number): boolean;
  /** The entity's id, for use in a click order. */
  id(index: number): EntityId;
  /** Index of a live entity, or -1 for a stale id. */
  indexOf(id: EntityId): number;
  /** Index of the player-controlled entity, or -1. */
  playerIndex(): number;
  x(index: number): number;
  y(index: number): number;
  z(index: number): number;
  facing(index: number): number;
  prevX(index: number): number;
  prevY(index: number): number;
  prevZ(index: number): number;
  hp(index: number): number;
  hpMax(index: number): number;
  dead(index: number): boolean;
  /** Index into `project.archetypes`. */
  archetype(index: number): number;
  /** The entity's effective authored components. */
  data(index: number): Readonly<ComponentData>;
  placementKey(index: number): string;
  /** The id of the brain state the entity is in, or '' without a brain. */
  brainState(index: number): string;
  /** The entity's acquired target, or NO_ENTITY. */
  target(index: number): EntityId;
  /** The clip the animator says is playing, and the frame within it (the renderer only draws them). */
  clip(index: number): string;
  frame(index: number): number;
  /** 0 none, 1 windup, 2 active, 3 recovery; and the index into `project.attacks` (-1 none). */
  attackPhase(index: number): number;
  attack(index: number): number;
  /** Is the entity dodging, airborne in a scripted jump, in hitstop, or invulnerable right now? */
  dodging(index: number): boolean;
  airborne(index: number): boolean;
  hitstop(index: number): number;
  invulnerable(index: number): boolean;
  /** Waypoints left on the entity's path, as (x, y) pairs written into `out`; returns how many. */
  path(index: number, out: Float64Array): number;
}

/** The loaded map's elevation model (spec 6.3): the same queries the simulation uses. */
export interface WorldView {
  /** False between maps; every query then answers as an empty map. */
  readonly loaded: boolean;
  readonly width: number;
  readonly height: number;
  /** Cell index under a world point, or -1 off the map. */
  cellAt(x: number, y: number): number;
  /** Surface height in world units. */
  surfaceHeight(x: number, y: number): number;
  /** The edge of a cell toward `dir`: flat, slope (one level apart), cliff (more), or 'none' off the map. */
  edgeType(cell: number, dir: HexDir): EdgeType | 'none';
  connects(a: number, b: number, mode: MovementMode): boolean;
  /** Cliff level of a cell, 0..maxLevel. */
  level(cell: number): number;
  /** Index into `project.terrains`. */
  terrain(cell: number): number;
  centerX(cell: number): number;
  centerY(cell: number): number;
  /** The neighbor of `cell` in direction `dir` (1..6), or -1 off the map. */
  neighbor(cell: number, dir: number): number;
  /** Surface height at (x, y) as `cell` defines it; the point may lie on the cell's border. */
  heightIn(cell: number, x: number, y: number): number;
}

export interface PresentationView {
  /** The cursor a new subscriber starts from. */
  readonly end: number;
  /** Visit events since `cursor`, oldest first; returns the new cursor. */
  since(cursor: number, visit: (event: Readonly<PresentationEvent>) => void): number;
}

export interface DiagnosticsView {
  countOf(code: string): number;
  counters(): Record<string, number>;
  entries(): DiagnosticEntry[];
}

/** Counts the leak gates compare against a baseline (spec 9.5). */
export interface RuntimeStats {
  entities: number;
  subscriptions: number;
  timers: number;
  queuedEvents: number;
}

export interface RuntimeView {
  readonly project: Readonly<Project>;
  readonly tick: number;
  readonly clockMode: ClockMode;
  readonly pendingSteps: number;
  readonly currentMapId: string;
  /** Set once `end-session` has run; the runtime then stops advancing. */
  readonly outcome: Outcome | null;
  readonly entities: EntityView;
  readonly world: WorldView;
  readonly presentation: PresentationView;
  readonly diagnostics: DiagnosticsView;
  variable(id: string): VariableValue | undefined;
  /**
   * What a click by the player on this entity would do (spec 7.9b). The
   * client calls it on hover to choose the cursor, so the cursor always
   * tells the truth about the click.
   */
  clickAction(entity: EntityId): ClickAction;
  /** The entity index the interact key would use right now, or -1: the HUD shows its prompt. */
  interactTarget(): number;
  /** The one 3D segment cast (spec 7.6), for debug overlays. */
  castSegment(from: Vec3, to: Vec3, opts: CastOptions): CastResult;
  /** Can entity `a` see entity `b`, by range, line of sight, and the high-ground rule? */
  canSee(a: EntityId, b: EntityId): boolean;
  stats(): RuntimeStats;
  /** Hash of everything a save would hold (minus its timestamp): the determinism tests compare these. */
  stateHash(): string;
}

export { World, edgeType, levelsConnect, terraceFraction, modeBit, MODE_WALK, MODE_SWIM, MODE_FLY, SOLID_FACTOR, TERRACES, EDGE_FLAT, EDGE_SLOPE, EDGE_CLIFF } from './world.ts';
export type { EdgeType } from './world.ts';
export { lintMap, lintProject, MAX_UNREACHABLE_AREAS } from './lint.ts';
export { castTerrain } from './sight.ts';
export { FLY_LEVELS } from './movement.ts';
export type { TerrainHit } from './sight.ts';
export type { LintWarning, LintCode } from './lint.ts';

// Hex geometry the renderer needs to build terrain meshes. `render` may import
// only `schema` and this entry point (spec 4.3), so the pure helpers pass through here.
export { HEX_DIRS, cornerOffsetX, cornerOffsetY, dirUnitX, dirUnitY, edgeCornerA, edgeCornerB, oppositeDir } from '@loreengine/hexmath';
export type { HexDir } from '@loreengine/hexmath';
