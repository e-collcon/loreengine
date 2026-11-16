/**
 * @loreengine/runtime/view — the read-only entry point (spec 4.3).
 * Renderer and audio see state and events through it; no mutating call is
 * reachable from here. Everything a `RuntimeView` returns is a value, a
 * read-only authored object, or a visitor callback.
 */
import type { HexDir } from '@loreengine/hexmath';
import type { ComponentData, MovementMode, Project, VariableValue } from '@loreengine/schema';
import type { DiagnosticEntry } from './diagnostics.ts';
import type { EntityId } from './entities.ts';
import type { PresentationEvent } from './presentation.ts';
import type { ClockMode, Outcome } from './sim.ts';

export type { EntityId } from './entities.ts';
export type { PresentationEvent, PresentationKind } from './presentation.ts';
export type { DiagnosticEntry } from './diagnostics.ts';
export type { ClockMode, Outcome } from './sim.ts';
export { NO_ENTITY, MAX_ENTITIES } from './entities.ts';
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
  /** Height of a cell's edge in levels, or 'sloped' for a ramp's side edges. */
  edgeHeight(cell: number, dir: HexDir): number | 'sloped';
  connects(a: number, b: number, mode: MovementMode): boolean;
  /** Cliff level of a cell, 0..maxLevel. */
  level(cell: number): number;
  /** 0, or the HexDir a ramp rises toward. */
  ramp(cell: number): number;
  /** Index into `project.terrains`. */
  terrain(cell: number): number;
  centerX(cell: number): number;
  centerY(cell: number): number;
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
  stats(): RuntimeStats;
  /** Hash of everything a save would hold (minus its timestamp): the determinism tests compare these. */
  stateHash(): string;
}

export { World, edgeLevel, edgesConnect, modeBit, MODE_WALK, MODE_SWIM, MODE_FLY, SLOPED } from './world.ts';
export { lintMap, lintProject, MAX_UNREACHABLE_AREAS } from './lint.ts';
export type { LintWarning, LintCode } from './lint.ts';
