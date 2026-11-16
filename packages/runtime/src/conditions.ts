/**
 * The one ConditionEvaluator (spec 5.6, law L6). It evaluates every
 * condition everywhere: triggers, brain transitions, and later dialogue and
 * quests. `all` and `any` short-circuit, and `chance` draws from the RNG
 * only when it is actually evaluated.
 *
 * Where an EntityMatch can name several entities, a condition holds when
 * ANY of them satisfies it; `count-alive` counts them.
 */
import type { Comparator, Condition, VariableValue } from '@loreengine/schema';
import type { Diagnostics } from './diagnostics.ts';
import { F_HEALTH } from './entities.ts';
import type { EntityStore } from './entities.ts';
import type { FactionTable } from './factions.ts';
import { newMatchBuffer } from './match.ts';
import type { MatchContext, Matcher } from './match.ts';
import type { Rng } from './rng.ts';
import type { VariableStore } from './variables.ts';

/** What a brain supplies so its transitions can use brain-local conditions. */
export interface BrainContext {
  hasTarget: boolean;
  /** World units to the target; Infinity without one. */
  targetDistance: number;
  /** World units from the brain's home. */
  homeDistance: number;
}

export interface ConditionContext extends MatchContext {
  /** Set only while evaluating a brain transition. */
  brain: BrainContext | null;
}

/** Is the entity at `index` inside region `regionId` of the current map? */
export type RegionTest = (regionId: string, index: number) => boolean;

export function compare(a: VariableValue, comparator: Comparator, b: VariableValue): boolean {
  switch (comparator) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>=':
      return a >= b;
    case '>':
      return a > b;
  }
}

export class ConditionEvaluator {
  private readonly buffer = newMatchBuffer();
  /** Supplied by the session: region membership needs the current map. */
  inRegion: RegionTest = () => false;

  constructor(
    private readonly variables: VariableStore,
    private readonly rng: Rng,
    private readonly entities: EntityStore,
    private readonly matcher: Matcher,
    private readonly factions: FactionTable,
    private readonly diagnostics: Diagnostics,
  ) {}

  /** True when every condition holds (an empty list holds). Stops at the first that fails. */
  all(conditions: readonly Condition[], ctx: ConditionContext): boolean {
    for (let i = 0; i < conditions.length; i++) if (!this.evaluate(conditions[i]!, ctx)) return false;
    return true;
  }

  evaluate(cond: Condition, ctx: ConditionContext): boolean {
    switch (cond.type) {
      case 'all':
        for (let i = 0; i < cond.of.length; i++) if (!this.evaluate(cond.of[i]!, ctx)) return false;
        return true;
      case 'any':
        for (let i = 0; i < cond.of.length; i++) if (this.evaluate(cond.of[i]!, ctx)) return true;
        return false;
      case 'not':
        return !this.evaluate(cond.of, ctx);
      case 'variable': {
        const value = this.variables.get(cond.variableId);
        if (value === undefined) {
          this.diagnostics.report('variable-unknown', `No variable ${cond.variableId}.`);
          return false;
        }
        if (typeof value !== typeof cond.value) return false; // never coerced
        return compare(value, cond.comparator, cond.value);
      }
      case 'chance':
        return this.rng.nextFloat() < cond.probability;
      case 'alive': {
        const n = this.matcher.resolve(cond.who, ctx, this.buffer);
        for (let i = 0; i < n; i++) if (this.entities.isActive(this.buffer[i]!)) return true;
        return false;
      }
      case 'count-alive': {
        const n = this.matcher.resolve(cond.who, ctx, this.buffer);
        let alive = 0;
        for (let i = 0; i < n; i++) if (this.entities.isActive(this.buffer[i]!)) alive++;
        return compare(alive, cond.comparator, cond.value);
      }
      case 'in-region': {
        const n = this.matcher.resolve(cond.who, ctx, this.buffer);
        for (let i = 0; i < n; i++) if (this.inRegion(cond.regionId, this.buffer[i]!)) return true;
        return false;
      }
      case 'health-fraction': {
        const e = this.entities;
        const n = this.matcher.resolve(cond.who, ctx, this.buffer);
        for (let i = 0; i < n; i++) {
          const index = this.buffer[i]!;
          if ((e.flags[index]! & F_HEALTH) === 0 || e.hpMax[index]! <= 0) continue;
          if (compare(e.hp[index]! / e.hpMax[index]!, cond.comparator, cond.value)) return true;
        }
        return false;
      }
      case 'has-target':
        return this.brain(ctx, cond.type)?.hasTarget ?? false;
      case 'target-within': {
        const brain = this.brain(ctx, cond.type);
        return brain !== null && brain.hasTarget && brain.targetDistance <= cond.distance;
      }
      case 'away-from-home': {
        const brain = this.brain(ctx, cond.type);
        return brain !== null && brain.homeDistance > cond.distance;
      }
      case 'relation':
        return this.factions.relation(cond.a, cond.b) === cond.is;
    }
  }

  private brain(ctx: ConditionContext, type: string): BrainContext | null {
    if (ctx.brain === null) {
      // The validator rejects this at load; reaching here means content bypassed it.
      this.diagnostics.report('brain-local-outside-brain', `"${type}" was evaluated outside a brain transition.`);
    }
    return ctx.brain;
  }
}
