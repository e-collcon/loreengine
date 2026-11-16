/**
 * Acquisition and brains (spec 7.7, 7.11): tick step 3.
 *
 * Acquisition: an entity with `acquisition` scans every 6 ticks, staggered
 * by entity index. It picks the nearest hostile it can see within range,
 * ties broken by entity index, and keeps the target until the target dies,
 * becomes untargetable, or goes unseen for `forgetMs`.
 *
 * Brains: each tick a brain checks its current state's transitions in
 * authored order. The first whose conditions hold, and whose `afterMs` has
 * elapsed, wins: its target state's `onEnter` actions run and
 * `brain-state-entered` fires. The state's behavior then produces intent.
 */
import type { BrainDef, Condition } from '@loreengine/schema';
import type { BrainContext, ConditionContext } from './conditions.ts';
import { F_DEAD, F_HEALTH, MAX_ENTITIES, NO_ENTITY, STATUS_UNTARGETABLE } from './entities.ts';
import { HOSTILE } from './factions.ts';
import type { MatchContext } from './match.ts';
import type { Sim } from './sim.ts';
import { TICK_HZ, msToTicks } from './time.ts';

export const ACQUISITION_INTERVAL = 6;
/** A wandering brain picks a new point every 2 to 4 s. */
const WANDER_MIN = 2 * TICK_HZ;
const WANDER_SPAN = 2 * TICK_HZ;
/** A chased target must move this far from the path's goal before a new path is asked for. */
const REPATH_DISTANCE = 1;
/** How close counts as "there" for patrol points and home. */
const ARRIVE = 0.3;

interface CompiledTransition {
  to: number;
  when: readonly Condition[];
  afterTicks: number;
}
interface CompiledState {
  def: BrainDef['states'][number];
  transitions: CompiledTransition[];
}
export interface CompiledBrain {
  def: BrainDef;
  states: CompiledState[];
  stateIndex: Map<string, number>;
  initial: number;
}

/** Optional hook: how the `attack` behavior swings. Installed by the combat system (chunk 6). */
export type AttackBehavior = (index: number, target: number, state: BrainDef['states'][number]) => void;

export class Brains {
  readonly compiled: CompiledBrain[];
  private readonly indexById = new Map<string, number>();
  private readonly buffer = new Int32Array(MAX_ENTITIES);
  private readonly brainCtx: BrainContext = { hasTarget: false, targetDistance: Infinity, homeDistance: 0 };
  private readonly ctx: ConditionContext = { subject: NO_ENTITY, other: NO_ENTITY, brain: this.brainCtx };
  private readonly actionCtx: MatchContext = { subject: NO_ENTITY, other: NO_ENTITY };
  attackBehavior: AttackBehavior | null = null;

  constructor(private readonly sim: Sim) {
    this.compiled = sim.project.brains.map((def) => {
      const stateIndex = new Map<string, number>();
      def.states.forEach((s, i) => stateIndex.set(s.id, i));
      return {
        def,
        stateIndex,
        initial: stateIndex.get(def.initial) ?? 0,
        states: def.states.map((s) => ({
          def: s,
          // Durations become ticks once, here.
          transitions: s.transitions.map((t) => ({ to: stateIndex.get(t.to) ?? 0, when: t.when, afterTicks: msToTicks(t.afterMs ?? 0) })),
        })),
      };
    });
    sim.project.brains.forEach((b, i) => this.indexById.set(b.id, i));
  }

  /** Give a freshly spawned entity its brain, in its initial state, at home where it stands. */
  attach(index: number): void {
    const e = this.sim.entities;
    const brain = e.data[index]!.brain;
    const which = brain ? (this.indexById.get(brain.brainId) ?? -1) : -1;
    e.brain[index] = which;
    if (which < 0) return;
    e.brainState[index] = this.compiled[which]!.initial;
    e.brainEntered[index] = this.sim.tick;
    e.wanderAt[index] = this.sim.tick;
  }

  /** The id of the state an entity's brain is in, or '' without a brain. */
  stateOf(index: number): string {
    const e = this.sim.entities;
    const which = e.brain[index]!;
    return which < 0 ? '' : this.compiled[which]!.states[e.brainState[index]!]!.def.id;
  }

  /** Enter a state by id (`set-brain-state`, or a transition). Returns false for an unknown state. */
  enter(index: number, stateId: string): boolean {
    const e = this.sim.entities;
    const which = e.brain[index]!;
    if (which < 0) return false;
    const to = this.compiled[which]!.stateIndex.get(stateId);
    if (to === undefined) return false;
    this.enterIndex(index, to);
    return true;
  }

  private enterIndex(index: number, to: number): void {
    const sim = this.sim;
    const e = sim.entities;
    const state = this.compiled[e.brain[index]!]!.states[to]!;
    e.brainState[index] = to;
    e.brainEntered[index] = sim.tick;
    e.wanderAt[index] = sim.tick;
    e.patrolIndex[index] = 0;
    sim.paths.clear(index); // whatever the old state was walking toward no longer applies
    const id = e.idAt(index);
    if (state.def.onEnter) {
      this.actionCtx.subject = id;
      this.actionCtx.other = e.isAlive(e.target[index]!) ? e.target[index]! : NO_ENTITY;
      sim.executor.run(state.def.onEnter, this.actionCtx);
    }
    sim.bus.raise('brain-state-entered', id, NO_ENTITY, state.def.id);
  }

  /** Tick step 3. */
  step(): void {
    const sim = this.sim;
    if (sim.world === null) return;
    const e = sim.entities;
    const end = e.highWater;
    for (let i = 0; i < end; i++) {
      if (e.alive[i] !== 1 || (e.flags[i]! & F_DEAD) !== 0) continue;
      if (e.data[i]!.acquisition !== undefined) this.acquire(i);
      if (e.brain[i]! >= 0) this.think(i);
    }
  }

  private acquire(i: number): void {
    const sim = this.sim;
    const e = sim.entities;
    const acquisition = e.data[i]!.acquisition!;
    let target = e.indexOf(e.target[i]!);
    // A target is dropped at once when it dies or becomes untargetable.
    if (e.target[i] !== NO_ENTITY && (target < 0 || (e.flags[target]! & F_DEAD) !== 0 || (e.status[target]! & STATUS_UNTARGETABLE) !== 0)) {
      e.target[i] = NO_ENTITY;
      target = -1;
    }
    if ((sim.tick + i) % ACQUISITION_INTERVAL !== 0) return; // staggered by entity index

    if (target >= 0) {
      if (sim.sight.canSee(i, target)) e.lastSeen[i] = sim.tick;
      else if (sim.tick - e.lastSeen[i]! > msToTicks(acquisition.forgetMs)) e.target[i] = NO_ENTITY;
      return;
    }

    const world = sim.world!;
    const hash = sim.hash!;
    const range = acquisition.range;
    const pitchX = Math.sqrt(3) * world.hexSize;
    const pitchY = 1.5 * world.hexSize;
    const n = hash.queryRange(
      Math.floor((e.x[i]! - range) / pitchX) - 1,
      Math.floor((e.y[i]! - range) / pitchY) - 1,
      Math.floor((e.x[i]! + range) / pitchX) + 1,
      Math.floor((e.y[i]! + range) / pitchY) + 1,
      this.buffer,
    );
    let best = -1;
    let bestD2 = range * range;
    const faction = e.faction[i]!;
    for (let k = 0; k < n; k++) {
      const j = this.buffer[k]!;
      if (j === i || (e.flags[j]! & F_DEAD) !== 0 || (e.flags[j]! & F_HEALTH) === 0) continue;
      if (sim.factions.between(faction, e.faction[j]!) !== HOSTILE) continue;
      const dx = e.x[j]! - e.x[i]!;
      const dy = e.y[j]! - e.y[i]!;
      const d2 = dx * dx + dy * dy;
      // Nearest first, ties to the lower index: independent of the order candidates arrive in.
      if (d2 > bestD2 || (d2 === bestD2 && best >= 0 && j > best)) continue;
      if (d2 === bestD2 && best < 0 && d2 === range * range) {
        // exactly at range: allowed
      }
      if (!sim.sight.canSee(i, j)) continue;
      best = j;
      bestD2 = d2;
    }
    if (best >= 0) {
      e.target[i] = e.idAt(best);
      e.lastSeen[i] = sim.tick;
    }
  }

  private think(i: number): void {
    const sim = this.sim;
    const e = sim.entities;
    const brain = this.compiled[e.brain[i]!]!;
    const target = e.indexOf(e.target[i]!);
    const b = this.brainCtx;
    b.hasTarget = target >= 0;
    b.targetDistance = target >= 0 ? Math.hypot(e.x[target]! - e.x[i]!, e.y[target]! - e.y[i]!) : Infinity;
    b.homeDistance = Math.hypot(e.homeX[i]! - e.x[i]!, e.homeY[i]! - e.y[i]!);
    this.ctx.subject = e.idAt(i);
    this.ctx.other = target >= 0 ? e.target[i]! : NO_ENTITY;

    // Transitions, in authored order: the first that holds wins.
    const transitions = brain.states[e.brainState[i]!]!.transitions;
    const elapsed = sim.tick - e.brainEntered[i]!;
    for (let t = 0; t < transitions.length; t++) {
      const transition = transitions[t]!;
      if (elapsed < transition.afterTicks) continue;
      if (!sim.evaluator.all(transition.when, this.ctx)) continue;
      this.enterIndex(i, transition.to);
      break;
    }

    const state = brain.states[e.brainState[i]!]!.def;
    const behavior = state.behavior;
    e.aiming[i] = 0;
    switch (behavior.kind) {
      case 'idle':
        break;
      case 'wander': {
        if (sim.tick < e.wanderAt[i]!) break;
        // A seeded random point within the radius of home, every 2 to 4 s.
        const angle = sim.rng.nextFloat() * Math.PI * 2;
        const distance = behavior.radius * Math.sqrt(sim.rng.nextFloat());
        e.wanderAt[i] = sim.tick + WANDER_MIN + sim.rng.nextInt(WANDER_SPAN + 1);
        const px = e.homeX[i]! + Math.cos(angle) * distance;
        const py = e.homeY[i]! + Math.sin(angle) * distance;
        if (sim.world!.passable(sim.world!.cellAt(px, py), e.mode[i]!)) sim.paths.request(i, px, py);
        break;
      }
      case 'patrol': {
        const cells = sim.map!.regionCells.get(behavior.regionId);
        if (cells === undefined || cells.length === 0) break; // the region belongs to another map
        const cell = cells[e.patrolIndex[i]! % cells.length]!;
        const px = sim.world!.centerX(cell);
        const py = sim.world!.centerY(cell);
        if (Math.hypot(px - e.x[i]!, py - e.y[i]!) <= ARRIVE) {
          e.patrolIndex[i] = (e.patrolIndex[i]! + 1) % cells.length;
        } else if (!sim.paths.busy(i) && e.hasGoal[i] === 0) {
          sim.paths.request(i, px, py);
        }
        break;
      }
      case 'chase': {
        if (target < 0) break;
        const drift = Math.hypot(e.goalX[i]! - e.x[target]!, e.goalY[i]! - e.y[target]!);
        if (e.hasGoal[i] === 0 || drift > REPATH_DISTANCE) {
          if (e.pathPending[i]! < 0 || drift > REPATH_DISTANCE) sim.paths.request(i, e.x[target]!, e.y[target]!);
        }
        break;
      }
      case 'return-home': {
        e.target[i] = NO_ENTITY; // the target is cleared
        if (b.homeDistance > ARRIVE && !sim.paths.busy(i) && e.hasGoal[i] === 0) sim.paths.request(i, e.homeX[i]!, e.homeY[i]!);
        break;
      }
      case 'flee': {
        if (target < 0 || b.targetDistance >= behavior.distance) break;
        // Movement directly away from the target.
        if (e.pathCount[i]! > 0 || e.hasGoal[i] === 1) sim.paths.clear(i);
        const d = b.targetDistance;
        if (d > 1e-9) {
          e.intentX[i] = (e.x[i]! - e.x[target]!) / d;
          e.intentY[i] = (e.y[i]! - e.y[target]!) / d;
        } else {
          e.intentX[i] = Math.cos(e.facing[i]!);
          e.intentY[i] = Math.sin(e.facing[i]!);
        }
        break;
      }
      case 'attack': {
        if (target < 0) break;
        // Face the target; the combat system starts the swing.
        e.aiming[i] = 1;
        e.aimX[i] = e.x[target]!;
        e.aimY[i] = e.y[target]!;
        if (this.attackBehavior !== null) this.attackBehavior(i, target, state);
        break;
      }
    }
  }
}

/** `set-brain-state`: put matching entities' brains into a named state. */
export function registerBrainActions(sim: Sim): void {
  const buffer = new Int32Array(sim.entities.capacity);
  sim.executor.register('set-brain-state', (a, ctx) => {
    const n = sim.matcher.resolve(a.target, ctx, buffer);
    for (let k = 0; k < n; k++) {
      const index = buffer[k]!;
      if (sim.entities.brain[index]! < 0) continue;
      if (!sim.brains.enter(index, a.state)) {
        sim.diagnostics.report('brain-state-unknown', `set-brain-state: "${sim.brains.compiled[sim.entities.brain[index]!]!.def.name}" has no state "${a.state}".`);
      }
    }
  });
}
