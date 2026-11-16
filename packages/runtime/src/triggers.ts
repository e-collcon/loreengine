/**
 * Triggers (spec 5.5, 5.6). A trigger subscribes to its event type under a
 * scope: global triggers under the session, a map's triggers under that
 * map. When a matching event dispatches and its `given` conditions hold,
 * its `then` actions run with the event's entities as subject and other.
 *
 * Triggers are evaluated in authored order: global triggers (subscribed at
 * session start) before the current map's.
 */
import type { EventPattern, Project, SaveState, TriggerDef } from '@loreengine/schema';
import type { ActionExecutor } from './actions.ts';
import type { ConditionContext, ConditionEvaluator } from './conditions.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { EventBus, GameEvent } from './events.ts';
import type { Matcher } from './match.ts';
import type { Scope } from './scope.ts';

export class TriggerSystem {
  /** Ids of `once` triggers that have fired. */
  private readonly fired = new Set<string>();
  /** Trigger id -> enabled, only where play changed it from the authored value. */
  private readonly enabledOverride = new Map<string, boolean>();
  /** Every trigger in the project, by id (global and all maps). */
  private readonly defs = new Map<string, TriggerDef>();
  /** `belowFraction` of every bound `health-crossed` trigger, ascending. */
  private thresholds: number[] = [];
  private readonly bound: TriggerDef[] = [];
  private readonly ctx: ConditionContext = { subject: -1, other: -1, brain: null };

  constructor(
    project: Project,
    private readonly bus: EventBus,
    private readonly matcher: Matcher,
    private readonly evaluator: ConditionEvaluator,
    private readonly executor: ActionExecutor,
    private readonly diagnostics: Diagnostics,
  ) {
    for (const t of project.triggers) this.defs.set(t.id, t);
    for (const map of project.maps) for (const t of map.triggers) this.defs.set(t.id, t);
  }

  /** Subscribe a list of triggers, in authored order, for as long as `scope` lives. */
  bind(scope: Scope, triggers: readonly TriggerDef[]): void {
    for (const def of triggers) {
      this.bus.subscribe(scope, def.when.type, (event) => this.handle(def, event));
      this.bound.push(def);
    }
    this.rebuildThresholds();
    scope.own(() => {
      for (const def of triggers) {
        const at = this.bound.indexOf(def);
        if (at >= 0) this.bound.splice(at, 1);
      }
      this.rebuildThresholds();
    });
  }

  private rebuildThresholds(): void {
    const set = new Set<number>();
    for (const def of this.bound) if (def.when.type === 'health-crossed') set.add(def.when.belowFraction);
    this.thresholds = [...set].sort((a, b) => a - b);
  }

  /** Health fractions some bound trigger listens for; the health system raises `health-crossed` for these. */
  get healthThresholds(): readonly number[] {
    return this.thresholds;
  }

  isEnabled(def: TriggerDef): boolean {
    return this.enabledOverride.get(def.id) ?? def.enabled;
  }

  /** `set-trigger-enabled`. Works on any trigger in the project, loaded or not. */
  setEnabled(id: string, enabled: boolean): void {
    const def = this.defs.get(id);
    if (!def) {
      this.diagnostics.report('trigger-unknown', `No trigger ${id}.`);
      return;
    }
    if (enabled === def.enabled) this.enabledOverride.delete(id);
    else this.enabledOverride.set(id, enabled);
  }

  hasFired(id: string): boolean {
    return this.fired.has(id);
  }

  private matches(when: EventPattern, event: Readonly<GameEvent>): boolean {
    const ctx = this.ctx;
    switch (when.type) {
      case 'map-loaded':
      case 'map-unloaded':
        return true;
      case 'region-entered':
      case 'region-exited':
        return when.regionId === event.s && this.matcher.test(when.who, event.a, ctx);
      case 'interacted':
        return this.matcher.test(when.target, event.b, ctx);
      case 'attack-hit':
        return this.matcher.test(when.attacker, event.a, ctx) && this.matcher.test(when.victim, event.b, ctx);
      case 'health-crossed':
        return when.belowFraction === event.n && this.matcher.test(when.who, event.a, ctx);
      case 'entity-died':
      case 'entity-spawned':
      case 'jump-landed':
        return this.matcher.test(when.who, event.a, ctx);
      case 'brain-state-entered':
        return when.state === event.s && this.matcher.test(when.who, event.a, ctx);
      case 'variable-changed':
        return when.variableId === event.s;
      case 'timer-fired':
        return when.timerId === event.s;
    }
  }

  private handle(def: TriggerDef, event: Readonly<GameEvent>): void {
    if (!this.isEnabled(def)) return;
    if (def.once && this.fired.has(def.id)) return;
    const ctx = this.ctx;
    // A pattern has no context of its own: `subject` and `other` are what the event defines.
    ctx.subject = -1;
    ctx.other = -1;
    if (!this.matches(def.when, event)) return;
    ctx.subject = event.a;
    ctx.other = event.b;
    if (!this.evaluator.all(def.given, ctx)) return;
    if (def.once) this.fired.add(def.id);
    this.executor.run(def.then, ctx);
  }

  exportSave(): SaveState['triggers'] {
    const enabled: Record<string, boolean> = {};
    for (const id of [...this.enabledOverride.keys()].sort()) enabled[id] = this.enabledOverride.get(id)!;
    return { fired: [...this.fired].sort(), enabled };
  }

  importSave(saved: SaveState['triggers']): void {
    this.fired.clear();
    this.enabledOverride.clear();
    for (const id of saved.fired) {
      if (this.defs.has(id)) this.fired.add(id);
      else this.diagnostics.report('save-dropped-trigger', `The save refers to trigger ${id}, which no longer exists.`);
    }
    for (const id of Object.keys(saved.enabled)) {
      const def = this.defs.get(id);
      if (!def) this.diagnostics.report('save-dropped-trigger', `The save refers to trigger ${id}, which no longer exists.`);
      else if (saved.enabled[id] !== def.enabled) this.enabledOverride.set(id, saved.enabled[id]!);
    }
  }
}
