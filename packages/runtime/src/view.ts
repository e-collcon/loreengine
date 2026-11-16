/**
 * @loreengine/runtime/view — the read-only entry point (spec 4.3).
 * Renderer and audio see state and events through it; no mutating call is
 * reachable from here. Everything a `RuntimeView` returns is a value, a
 * read-only authored object, or a visitor callback.
 */
import type { ComponentData, Project, VariableValue } from '@loreengine/schema';
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
  readonly presentation: PresentationView;
  readonly diagnostics: DiagnosticsView;
  variable(id: string): VariableValue | undefined;
  stats(): RuntimeStats;
  /** Hash of everything a save would hold (minus its timestamp): the determinism tests compare these. */
  stateHash(): string;
}
