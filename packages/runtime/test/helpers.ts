import { EMBERFALL, buildEmberfall, cellCenter, id } from '@loreengine/fixtures';
import type { Action, Condition, Id, Project, TriggerDef } from '@loreengine/schema';
import { emptyInput } from '../src/index.ts';
import { createSim } from '../src/runtime.ts';
import type { RuntimeOptions } from '../src/runtime.ts';
import type { Sim } from '../src/sim.ts';

export { EMBERFALL, cellCenter, id };

/** Emberfall with its triggers removed: entities and variables, nothing scripted. */
export function bareProject(mutate?: (p: Project) => void): Project {
  const p = buildEmberfall();
  p.triggers = [];
  p.maps[0]!.triggers = [];
  if (mutate) mutate(p);
  return p;
}

export const OPTS: RuntimeOptions = { seed: 1234, clockMode: 'continuous' };

export function bareSim(mutate?: (p: Project) => void, opts: Partial<RuntimeOptions> = {}): Sim {
  return createSim(bareProject(mutate), null, { ...OPTS, ...opts });
}

/** Variable ids of the Emberfall fixture. */
export const V = {
  talked: id('variable', 'talked_to_elder'),
  enraged: id('variable', 'boss_enraged'),
  pulses: id('variable', 'ember_pulses'),
  lucky: id('variable', 'lucky_pulses'),
  visits: id('variable', 'arena_visits'), // session scope
  greeting: id('variable', 'elder_greeting'), // readonly string
};

export const KEYS = {
  elder: id('placement', 'elder'),
  sentry: id('placement', 'sentry'),
  warden: id('placement', 'warden'),
};

let counter = 0;
/** A trigger with a fresh id. */
export function trigger(when: TriggerDef['when'], then: Action[], opts: { given?: Condition[]; once?: boolean; enabled?: boolean; name?: string } = {}): TriggerDef {
  return {
    id: id('trigger', opts.name ?? `test-${counter++}`) as Id<'trigger'>,
    when,
    given: opts.given ?? [],
    then,
    once: opts.once ?? false,
    enabled: opts.enabled ?? true,
  };
}

export const setVar = (variableId: Id<'variable'>, value: boolean | number | string): Action => ({
  type: 'set-variable',
  variableId,
  op: { kind: 'set', value },
});
export const addVar = (variableId: Id<'variable'>, value: number): Action => ({ type: 'set-variable', variableId, op: { kind: 'add', value } });

/** Step a sim `n` ticks with empty input. */
export function run(sim: Sim, n: number): void {
  const frame = emptyInput();
  for (let i = 0; i < n; i++) {
    sim.input.set(frame);
    sim.step();
  }
}

/** Every presentation event raised so far, as plain objects. */
export function presented(sim: Sim): { kind: string; a: number; b: number; s: string; n: number; tick: number }[] {
  const out: { kind: string; a: number; b: number; s: string; n: number; tick: number }[] = [];
  sim.presentation.since(0, (e) => void out.push({ kind: e.kind, a: e.a, b: e.b, s: e.s, n: e.n, tick: e.tick }));
  return out;
}
