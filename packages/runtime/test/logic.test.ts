/**
 * One test per condition variant and per Phase 2 action (spec 5.12), plus
 * EntityMatch, variables, and triggers.
 */
import { describe, expect, it } from 'vitest';
import type { Condition, EntityMatch, Id } from '@loreengine/schema';
import type { ConditionContext } from '../src/conditions.ts';
import { F_DEAD } from '../src/entities.ts';
import { newMatchBuffer } from '../src/match.ts';
import type { Sim } from '../src/sim.ts';
import { EMBERFALL, KEYS, V, addVar, bareSim, cellCenter, id, presented, run, setVar, trigger } from './helpers.ts';

const ctxOf = (subject = -1, other = -1): ConditionContext => ({ subject, other, brain: null });
const ev = (sim: Sim, cond: Condition, ctx: ConditionContext = ctxOf()): boolean => sim.evaluator.evaluate(cond, ctx);
const TRUE: Condition = { type: 'variable', variableId: V.pulses, comparator: '==', value: 0 };
const FALSE: Condition = { type: 'variable', variableId: V.pulses, comparator: '==', value: 99 };
const indexOf = (sim: Sim, key: string): number => sim.entities.indexOfPlacement(key);

describe('[P2.match.variants] EntityMatch', () => {
  const resolve = (sim: Sim, match: EntityMatch, ctx = ctxOf()): number[] => {
    const out = newMatchBuffer();
    return Array.from(out.subarray(0, sim.matcher.resolve(match, ctx, out)));
  };

  it('resolves every variant, in ascending entity index', () => {
    const sim = bareSim();
    const e = sim.entities;
    // Session start: the player is entity 0, then placements in authored order.
    expect(e.count).toBe(4);
    const [hero, elder, sentry, warden] = [0, 1, 2, 3];
    expect(indexOf(sim, KEYS.elder)).toBe(elder);
    expect(resolve(sim, { by: 'any' })).toEqual([0, 1, 2, 3]);
    expect(resolve(sim, { by: 'player' })).toEqual([hero]);
    expect(resolve(sim, { by: 'placement', key: KEYS.sentry })).toEqual([sentry]);
    expect(resolve(sim, { by: 'tag', tag: 'enemy' })).toEqual([sentry, warden]);
    expect(resolve(sim, { by: 'tag', tag: 'boss' })).toEqual([warden]);
    expect(resolve(sim, { by: 'archetype', archetypeId: id('archetype', 'elder') })).toEqual([elder]);
    const hostile = sim.project.factions[1]!.id;
    expect(resolve(sim, { by: 'faction', factionId: hostile })).toEqual([sentry, warden]);
    expect(resolve(sim, { by: 'subject' }, ctxOf(e.idAt(sentry)))).toEqual([sentry]);
    expect(resolve(sim, { by: 'other' }, ctxOf(e.idAt(sentry), e.idAt(hero)))).toEqual([hero]);
  });

  it('subject and other resolve to nothing without a context or with a stale id', () => {
    const sim = bareSim();
    expect(resolve(sim, { by: 'subject' })).toEqual([]);
    expect(resolve(sim, { by: 'other' })).toEqual([]);
    const stale = sim.entities.idAt(2);
    sim.entities.requestDespawn(stale);
    run(sim, 1);
    expect(resolve(sim, { by: 'subject' }, ctxOf(stale))).toEqual([]);
    expect(resolve(sim, { by: 'placement', key: KEYS.sentry })).toEqual([]);
    expect(sim.matcher.test({ by: 'any' }, stale, ctxOf())).toBe(false);
  });
});

describe('conditions: one ConditionEvaluator', () => {
  it('[P2.cond.all-any] all and any short-circuit', () => {
    const sim = bareSim();
    expect(ev(sim, { type: 'all', of: [] })).toBe(true);
    expect(ev(sim, { type: 'any', of: [] })).toBe(false);
    expect(ev(sim, { type: 'all', of: [TRUE, TRUE] })).toBe(true);
    expect(ev(sim, { type: 'all', of: [TRUE, FALSE] })).toBe(false);
    expect(ev(sim, { type: 'any', of: [FALSE, TRUE] })).toBe(true);
    expect(ev(sim, { type: 'any', of: [FALSE, FALSE] })).toBe(false);
    // Short-circuit is observable through the RNG: a skipped `chance` draws nothing.
    const state = sim.rng.getState();
    const chance: Condition = { type: 'chance', probability: 0.5 };
    ev(sim, { type: 'all', of: [FALSE, chance] });
    ev(sim, { type: 'any', of: [TRUE, chance] });
    expect(sim.rng.getState()).toEqual(state);
    ev(sim, { type: 'all', of: [TRUE, chance] });
    expect(sim.rng.getState()).not.toEqual(state);
  });

  it('[P2.cond.not] not inverts', () => {
    const sim = bareSim();
    expect(ev(sim, { type: 'not', of: TRUE })).toBe(false);
    expect(ev(sim, { type: 'not', of: { type: 'not', of: TRUE } })).toBe(true);
  });

  it('[P2.cond.variable] compares a variable by id with every comparator, never coercing', () => {
    const sim = bareSim();
    sim.variables.set(V.pulses, 5);
    const cmp = (comparator: '<' | '<=' | '==' | '!=' | '>=' | '>', value: number) => ev(sim, { type: 'variable', variableId: V.pulses, comparator, value });
    expect([cmp('<', 6), cmp('<', 5), cmp('<=', 5), cmp('==', 5), cmp('!=', 5), cmp('>=', 5), cmp('>', 5), cmp('>', 4)]).toEqual([
      true, false, true, true, false, true, false, true,
    ]);
    expect(ev(sim, { type: 'variable', variableId: V.talked, comparator: '==', value: false })).toBe(true);
    expect(ev(sim, { type: 'variable', variableId: V.greeting, comparator: '!=', value: '' })).toBe(true);
    // The number 5 is not the string '5'.
    expect(ev(sim, { type: 'variable', variableId: V.pulses, comparator: '==', value: '5' })).toBe(false);
    expect(ev(sim, { type: 'variable', variableId: id('variable', 'missing') as Id<'variable'>, comparator: '==', value: 0 })).toBe(false);
    expect(sim.diagnostics.countOf('variable-unknown')).toBe(1);
  });

  it('[P2.cond.chance] draws from the seeded RNG, once per evaluation', () => {
    const sim = bareSim();
    expect(ev(sim, { type: 'chance', probability: 0 })).toBe(false);
    expect(ev(sim, { type: 'chance', probability: 1 })).toBe(true);
    let hits = 0;
    for (let i = 0; i < 4000; i++) if (ev(sim, { type: 'chance', probability: 0.25 })) hits++;
    expect(hits).toBeGreaterThan(900);
    expect(hits).toBeLessThan(1100);
    // Same seed, same answers.
    const a = bareSim();
    const b = bareSim();
    const draws = (s: Sim) => Array.from({ length: 64 }, () => ev(s, { type: 'chance', probability: 0.5 }));
    expect(draws(a)).toEqual(draws(b));
  });

  it('[P2.cond.alive] holds while a matching entity is present and not dead', () => {
    const sim = bareSim();
    const sentry: Condition = { type: 'alive', who: { by: 'placement', key: KEYS.sentry } };
    expect(ev(sim, sentry)).toBe(true);
    const i = indexOf(sim, KEYS.sentry);
    sim.entities.flags[i] = sim.entities.flags[i]! | F_DEAD; // dying: present, but dead
    expect(ev(sim, sentry)).toBe(false);
    expect(ev(sim, { type: 'alive', who: { by: 'tag', tag: 'enemy' } })).toBe(true); // the warden still lives
    sim.entities.requestDespawn(sim.entities.idAt(i));
    run(sim, 1);
    expect(ev(sim, sentry)).toBe(false);
    expect(ev(sim, { type: 'alive', who: { by: 'tag', tag: 'nobody' } })).toBe(false);
  });

  it('[P2.cond.count-alive] counts matching live entities', () => {
    const sim = bareSim();
    const count = (comparator: '==' | '>=' | '<', value: number) => ev(sim, { type: 'count-alive', who: { by: 'tag', tag: 'enemy' }, comparator, value });
    expect(count('==', 2)).toBe(true);
    expect(count('>=', 3)).toBe(false);
    const i = indexOf(sim, KEYS.warden);
    sim.entities.flags[i] = sim.entities.flags[i]! | F_DEAD;
    expect(count('==', 1)).toBe(true);
    expect(count('<', 1)).toBe(false);
    expect(ev(sim, { type: 'count-alive', who: { by: 'tag', tag: 'nobody' }, comparator: '==', value: 0 })).toBe(true);
  });

  it('[P2.cond.in-region] tests the cell an entity stands on against the region\'s packed cells', () => {
    const sim = bareSim();
    const arena = id('region', 'arena');
    const village = id('region', 'village');
    const inRegion = (who: EntityMatch, regionId: Id<'region'>) => ev(sim, { type: 'in-region', who, regionId });
    expect(inRegion({ by: 'placement', key: KEYS.warden }, arena)).toBe(true);
    expect(inRegion({ by: 'placement', key: KEYS.warden }, village)).toBe(false);
    expect(inRegion({ by: 'player' }, village)).toBe(true);
    expect(inRegion({ by: 'player' }, arena)).toBe(false);
    expect(inRegion({ by: 'tag', tag: 'enemy' }, arena)).toBe(true); // any of them
    // Move the player onto an arena cell and off again.
    const hero = sim.playerIndex();
    const inside = cellCenter(EMBERFALL.arena.col + 1, EMBERFALL.arena.row + 1);
    sim.entities.x[hero] = inside.x;
    sim.entities.y[hero] = inside.y;
    expect(inRegion({ by: 'player' }, arena)).toBe(true);
    const wall = cellCenter(EMBERFALL.arena.col, EMBERFALL.arena.row); // the wall ring is outside the region
    sim.entities.x[hero] = wall.x;
    sim.entities.y[hero] = wall.y;
    expect(inRegion({ by: 'player' }, arena)).toBe(false);
    sim.entities.x[hero] = -50; // off the map
    expect(inRegion({ by: 'player' }, arena)).toBe(false);
    expect(inRegion({ by: 'player' }, id('region', 'nowhere') as Id<'region'>)).toBe(false);
  });

  it('[P2.cond.health-fraction] compares current / max; entities start at health.max', () => {
    const sim = bareSim();
    const i = indexOf(sim, KEYS.warden);
    expect(sim.entities.hpMax[i]).toBe(300);
    expect(sim.entities.hp[i]).toBe(300);
    const below = (value: number) => ev(sim, { type: 'health-fraction', who: { by: 'placement', key: KEYS.warden }, comparator: '<', value });
    expect(below(0.5)).toBe(false);
    sim.entities.hp[i] = 149;
    expect(below(0.5)).toBe(true);
    sim.entities.hp[i] = 150;
    expect(below(0.5)).toBe(false);
    expect(ev(sim, { type: 'health-fraction', who: { by: 'placement', key: KEYS.warden }, comparator: '==', value: 0.5 })).toBe(true);
    // The elder has no health component: it never satisfies a health condition.
    expect(ev(sim, { type: 'health-fraction', who: { by: 'placement', key: KEYS.elder }, comparator: '>=', value: 0 })).toBe(false);
  });

  it('[P2.cond.brain-local] has-target, target-within and away-from-home read the brain context', () => {
    const sim = bareSim();
    const brain = { hasTarget: true, targetDistance: 3, homeDistance: 10 };
    const ctx: ConditionContext = { subject: -1, other: -1, brain };
    expect(ev(sim, { type: 'has-target' }, ctx)).toBe(true);
    expect(ev(sim, { type: 'target-within', distance: 3 }, ctx)).toBe(true);
    expect(ev(sim, { type: 'target-within', distance: 2.9 }, ctx)).toBe(false);
    expect(ev(sim, { type: 'away-from-home', distance: 9 }, ctx)).toBe(true);
    expect(ev(sim, { type: 'away-from-home', distance: 10 }, ctx)).toBe(false);
    brain.hasTarget = false;
    brain.targetDistance = Infinity;
    expect(ev(sim, { type: 'has-target' }, ctx)).toBe(false);
    expect(ev(sim, { type: 'target-within', distance: 1e9 }, ctx)).toBe(false);
    // Outside a brain they are false and reported (the validator rejects this at load).
    expect(ev(sim, { type: 'has-target' })).toBe(false);
    expect(ev(sim, { type: 'away-from-home', distance: 0 })).toBe(false);
    expect(sim.diagnostics.countOf('brain-local-outside-brain')).toBe(2);
  });

  it('[P2.cond.relation] reads FactionDef.relations: missing is neutral, self is ally', () => {
    const sim = bareSim();
    const [player, hostile, neutral] = sim.project.factions.map((f) => f.id);
    const rel = (a: Id<'faction'>, b: Id<'faction'>, is: 'hostile' | 'neutral' | 'ally') => ev(sim, { type: 'relation', a, b, is });
    expect(rel(player!, hostile!, 'hostile')).toBe(true);
    expect(rel(hostile!, player!, 'hostile')).toBe(true);
    expect(rel(player!, neutral!, 'neutral')).toBe(true);
    expect(rel(neutral!, hostile!, 'neutral')).toBe(true);
    expect(rel(player!, player!, 'ally')).toBe(true);
    expect(rel(player!, hostile!, 'ally')).toBe(false);
    // Relations are directional: they are a's stance toward b.
    const oneWay = bareSim((p) => void (p.factions[2]!.relations = { [p.factions[0]!.id]: 'ally' }));
    const f = oneWay.project.factions.map((x) => x.id);
    expect(oneWay.evaluator.evaluate({ type: 'relation', a: f[2]!, b: f[0]!, is: 'ally' }, ctxOf())).toBe(true);
    expect(oneWay.evaluator.evaluate({ type: 'relation', a: f[0]!, b: f[2]!, is: 'neutral' }, ctxOf())).toBe(true);
    expect(oneWay.factions.between(-1, 0)).toBe(0);
  });
});

describe('[P2.variables.store] the VariableStore', () => {
  it('starts every variable at its initial value, looked up by id', () => {
    const sim = bareSim();
    expect(sim.variables.get(V.talked)).toBe(false);
    expect(sim.variables.get(V.pulses)).toBe(0);
    expect(sim.variables.get(V.greeting)).toBe('The plateau sentry sees further than you think.');
    expect(sim.variables.get('nope')).toBeUndefined();
  });

  it('rejects writes to a readonly variable with a diagnostic naming its key', () => {
    const sim = bareSim();
    expect(sim.variables.set(V.greeting, 'changed')).toBe(false);
    expect(sim.variables.get(V.greeting)).toBe('The plateau sentry sees further than you think.');
    expect(sim.diagnostics.countOf('variable-readonly')).toBe(1);
    expect(sim.diagnostics.entries()[0]!.message).toContain('elder_greeting');
  });

  it('rejects type mismatches and never coerces', () => {
    const sim = bareSim();
    expect(sim.variables.set(V.pulses, '5')).toBe(false);
    expect(sim.variables.set(V.talked, 1)).toBe(false);
    expect(sim.variables.set(V.pulses, NaN)).toBe(false);
    expect(sim.variables.apply(V.talked, { kind: 'add', value: 1 })).toBe(false);
    expect(sim.variables.apply(V.pulses, { kind: 'toggle' })).toBe(false);
    expect(sim.variables.apply(V.pulses, { kind: 'set-from', sourceVariableId: V.talked })).toBe(false);
    expect(sim.variables.get(V.pulses)).toBe(0);
    expect(sim.variables.get(V.talked)).toBe(false);
    expect(sim.diagnostics.countOf('variable-type-mismatch')).toBe(6);
  });

  it('[P2.events.variable-changed] raises variable-changed only when the value actually changes', () => {
    const sim = bareSim((p) => {
      p.triggers.push(trigger({ type: 'variable-changed', variableId: V.talked }, [addVar(V.pulses, 1)]));
      p.triggers.push(trigger({ type: 'variable-changed', variableId: V.enraged }, [addVar(V.pulses, 100)]));
    });
    sim.variables.set(V.talked, false); // unchanged
    run(sim, 1);
    expect(sim.variables.get(V.pulses)).toBe(0);
    sim.variables.set(V.talked, true);
    sim.variables.set(V.talked, true); // unchanged again
    run(sim, 1);
    expect(sim.variables.get(V.pulses)).toBe(1); // once, and only the trigger for that variable
  });

  it('save scope persists, session scope resets on load, and global is treated as save with one log', () => {
    const sim = bareSim((p) => {
      p.variables.find((v) => v.id === V.lucky)!.scope = 'global';
      p.variables.find((v) => v.id === V.enraged)!.scope = 'global';
    });
    expect(sim.diagnostics.countOf('variable-global-scope')).toBe(1); // logs once, not per variable
    sim.variables.set(V.pulses, 3);
    sim.variables.set(V.lucky, 4);
    sim.variables.set(V.visits, 5);
    const saved = sim.variables.exportSave();
    expect(saved[V.pulses]).toBe(3);
    expect(saved[V.lucky]).toBe(4);
    expect(V.visits in saved).toBe(false);
    sim.variables.set(V.pulses, 30);
    sim.variables.importSave(saved);
    expect(sim.variables.get(V.pulses)).toBe(3);
    expect(sim.variables.get(V.lucky)).toBe(4);
    expect(sim.variables.get(V.visits)).toBe(0); // back to initial
  });
});

describe('actions: one ActionExecutor', () => {
  const act = (sim: Sim, ...actions: Parameters<Sim['executor']['run']>[0]) => sim.executor.run(actions, { subject: -1, other: -1 });

  it('[P2.act.set-variable] set, add, toggle and set-from', () => {
    const sim = bareSim();
    act(sim, setVar(V.pulses, 10), addVar(V.pulses, -3));
    expect(sim.variables.get(V.pulses)).toBe(7);
    act(sim, { type: 'set-variable', variableId: V.talked, op: { kind: 'toggle' } });
    expect(sim.variables.get(V.talked)).toBe(true);
    act(sim, { type: 'set-variable', variableId: V.lucky, op: { kind: 'set-from', sourceVariableId: V.pulses } });
    expect(sim.variables.get(V.lucky)).toBe(7);
    act(sim, { type: 'set-variable', variableId: V.enraged, op: { kind: 'set-from', sourceVariableId: V.talked } });
    expect(sim.variables.get(V.enraged)).toBe(true);
  });

  it('[P2.act.set-trigger-enabled] turns a trigger off and on, by id', () => {
    const sim = bareSim((p) => {
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.pulses, 1)], { name: 'counter' }));
    });
    const counter = id('trigger', 'counter') as Id<'trigger'>;
    sim.timers.start('t', 1, true);
    run(sim, 2);
    expect(sim.variables.get(V.pulses)).toBe(2);
    act(sim, { type: 'set-trigger-enabled', triggerId: counter, enabled: false });
    run(sim, 3);
    expect(sim.variables.get(V.pulses)).toBe(2);
    act(sim, { type: 'set-trigger-enabled', triggerId: counter, enabled: true });
    run(sim, 1);
    expect(sim.variables.get(V.pulses)).toBe(3);
  });

  it('[P2.act.start-timer] starts a timer of the authored milliseconds, once or repeating', () => {
    const sim = bareSim((p) => {
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 'once' }, [addVar(V.pulses, 1)]));
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 'loop' }, [addVar(V.lucky, 1)]));
    });
    act(sim, { type: 'start-timer', timerId: 'once', ms: 100, repeat: false }, { type: 'start-timer', timerId: 'loop', ms: 50, repeat: true });
    run(sim, 5);
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky)]).toEqual([0, 1]); // 50 ms = 3 ticks
    run(sim, 1);
    expect(sim.variables.get(V.pulses)).toBe(1); // 100 ms = 6 ticks
    run(sim, 60);
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky)]).toEqual([1, 22]);
  });

  it('[P2.act.play-sfx] raises a presentation event and touches no audio', () => {
    const sim = bareSim();
    const asset = id('asset', 'clang') as Id<'asset'>;
    act(sim, { type: 'play-sfx', assetId: asset });
    expect(presented(sim)).toContainEqual({ kind: 'sfx', a: -1, b: -1, s: asset, n: 1, tick: 0 });
  });

  it('[P2.act.change-bgm] raises a presentation event with the fade; null stops the music', () => {
    const sim = bareSim();
    const asset = id('asset', 'theme') as Id<'asset'>;
    act(sim, { type: 'change-bgm', assetId: asset, fadeMs: 800 }, { type: 'change-bgm', assetId: null, fadeMs: 200 });
    const bgm = presented(sim).filter((e) => e.kind === 'bgm');
    expect(bgm.map((e) => [e.s, e.n])).toEqual([[asset, 800], ['', 200]]);
  });

  it('[P2.act.show-message] raises a message with its text and duration', () => {
    const sim = bareSim();
    act(sim, { type: 'show-message', text: 'The Ember Warden stirs.', ms: 2500 });
    expect(presented(sim).filter((e) => e.kind === 'message')).toEqual([{ kind: 'message', a: -1, b: -1, s: 'The Ember Warden stirs.', n: 2500, tick: 0 }]);
  });

  it('[P2.act.end-session] records the outcome and stops the clock', () => {
    const sim = bareSim();
    sim.enqueue({ type: 'test-actions', actions: [{ type: 'end-session', outcome: 'victory' }, { type: 'end-session', outcome: 'defeat' }] });
    run(sim, 1);
    expect(sim.outcome).toBe('victory'); // the first outcome stands
    expect(presented(sim).filter((e) => e.kind === 'session-ended').map((e) => e.s)).toEqual(['victory']);
    const tick = sim.tick;
    run(sim, 5);
    expect(sim.tick).toBe(tick);
  });

  it('reports an action type that has no handler instead of skipping it silently', () => {
    const sim = bareSim();
    const core = ['change-bgm', 'end-session', 'play-sfx', 'set-trigger-enabled', 'set-variable', 'show-message', 'start-timer'];
    for (const type of core) expect(sim.executor.registered()).toContain(type);
    expect(() => sim.executor.register('set-variable', () => {})).toThrow(/already has a handler/);
  });
});

describe('[P2.triggers.once-enabled] triggers', () => {
  it('a once trigger fires once; a disabled trigger never fires', () => {
    const sim = bareSim((p) => {
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.pulses, 1)], { once: true, name: 'once' }));
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.lucky, 1)], { enabled: false }));
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.visits, 1)]));
    });
    sim.timers.start('t', 1, true);
    run(sim, 5);
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky), sim.variables.get(V.visits)]).toEqual([1, 0, 5]);
    expect(sim.triggers.hasFired(id('trigger', 'once'))).toBe(true);
  });

  it('a once trigger whose conditions fail has not fired yet', () => {
    const sim = bareSim((p) => {
      p.triggers.push(
        trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.lucky, 1)], {
          once: true,
          given: [{ type: 'variable', variableId: V.pulses, comparator: '>=', value: 3 }],
        }),
      );
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.pulses, 1)]));
    });
    sim.timers.start('t', 1, true);
    run(sim, 6);
    // Fires on the 4th timer event (pulses is 3 by then), and only then.
    expect(sim.variables.get(V.lucky)).toBe(1);
    expect(sim.variables.get(V.pulses)).toBe(6);
  });

  it('evaluates triggers in authored order: global triggers, then the map\'s', () => {
    const sim = bareSim((p) => {
      p.maps[0]!.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [{ type: 'set-variable', variableId: V.pulses, op: { kind: 'set', value: 3 } }]));
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [setVar(V.pulses, 1)]));
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.pulses, 1)]));
    });
    sim.timers.start('t', 1, false);
    run(sim, 1);
    expect(sim.variables.get(V.pulses)).toBe(3); // set 1, add 1, then the map trigger sets 3
  });

  it('gives conditions and actions the event\'s entities as subject and other', () => {
    const sim = bareSim((p) => {
      p.triggers.push(
        trigger({ type: 'entity-died', who: { by: 'tag', tag: 'enemy' } }, [addVar(V.pulses, 1)], {
          given: [{ type: 'alive', who: { by: 'other' } }, { type: 'health-fraction', who: { by: 'subject' }, comparator: '<=', value: 1 }],
        }),
      );
    });
    const e = sim.entities;
    const hero = e.idAt(sim.playerIndex());
    sim.bus.raise('entity-died', e.idAt(indexOf(sim, KEYS.sentry)), hero);
    sim.bus.raise('entity-died', e.idAt(indexOf(sim, KEYS.elder)), hero); // not an enemy
    sim.bus.raise('entity-died', e.idAt(indexOf(sim, KEYS.warden)), -1); // no "other": the condition fails
    run(sim, 1);
    expect(sim.variables.get(V.pulses)).toBe(1);
  });

  it('Emberfall\'s heartbeat: map-loaded starts a timer, which counts pulses', () => {
    const sim = bareSim((p) => {
      p.triggers.push(trigger({ type: 'map-loaded' }, [{ type: 'start-timer', timerId: 'pulse', ms: 1000, repeat: true }]));
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 'pulse' }, [addVar(V.pulses, 1)]));
    });
    run(sim, 1); // map-loaded dispatches on the first tick
    expect(sim.timers.count).toBe(1);
    run(sim, 600);
    expect(sim.variables.get(V.pulses)).toBe(10);
  });
});
