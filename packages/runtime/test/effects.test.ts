import { describe, expect, it } from 'vitest';
import { EMBERFALL, buildEmberfall } from '@loreengine/fixtures';
import { parseSave, serializeSave } from '@loreengine/schema';
import type { ComponentData, Id, Project, StatusEffectDef } from '@loreengine/schema';
import { FX_AIRBORNE, MAX_EFFECTS, PHASE_ACTIVE, PHASE_NONE, RESTRICT_ACT, RESTRICT_ATTACK, RESTRICT_DODGE, RESTRICT_MOVE, STATUS_INVULNERABLE, STATUS_UNTARGETABLE } from '../src/entities.ts';
import { ROLE_ATTACK_PRIMARY, ROLE_ATTACK_SECONDARY, ROLE_CLICK, ROLE_DODGE, ROLE_INTERACT, createRuntime, emptyInput } from '../src/index.ts';
import type { InputFrame, Runtime } from '../src/index.ts';
import { createSim } from '../src/runtime.ts';
import type { Sim } from '../src/sim.ts';
import { KEYS, OPTS, TERRAIN, V, addVar, cellCenter, cellOfEntity, id, indexOfKey, presented, run, runWith, stageSim, trigger } from './helpers.ts';
import type { Stage } from './helpers.ts';

const T = TERRAIN;
const HERO = { col: 6, row: 6 };
const here = cellCenter(HERO.col, HERO.row);
const NOBODY = { subject: -1, other: -1 };
const BODY: ComponentData = { collider: { radius: 0.4, height: 1.6, solid: true }, health: { max: 100 }, motion: { mass: 1, friction: 12 } };

function status(name: string, fields: Partial<StatusEffectDef>): StatusEffectDef {
  return {
    id: id('status', name) as Id<'status'>,
    name,
    duration: { kind: 'ms', value: 1000 },
    stackMode: 'refresh',
    maxStacks: undefined,
    stackScope: 'global',
    restricts: undefined,
    flags: undefined,
    periodic: undefined,
    ...fields,
  };
}
/** A flat stage with the hero and one hostile body 'a' beside it; `statuses` are added to the project. */
function lab(statuses: StatusEffectDef[] = [], build?: (s: Stage) => void, mutate?: (p: Project) => void): Sim {
  return stageSim(
    30,
    14,
    HERO,
    (_m, s) => {
      s.project.statusEffects.push(...statuses);
      s.archetype('Body', { ...BODY, faction: { factionId: s.project.factions[1]!.id } }, ['body']);
      s.place('a', 'Body', { x: here.x + 1.2, y: here.y });
      if (build) build(s);
    },
    mutate,
  );
}
const apply = (sim: Sim, name: string, target: number, source = -1): void => sim.effects.apply(target, sim.effects.indexOf(id('status', name)), source);
const instances = (sim: Sim, index: number): { ticks: number; stacks: number; source: number }[] => {
  const e = sim.entities;
  return Array.from({ length: e.fxCount[index]! }, (_, k) => ({ ticks: e.fxTicks[index * MAX_EFFECTS + k]!, stacks: e.fxStacks[index * MAX_EFFECTS + k]!, source: e.fxSource[index * MAX_EFFECTS + k]! }));
};

describe('active effects', () => {
  it('[P4B.effects.duration] durations are converted to ticks once: ms, turns through msPerTurn, and null for permanent', () => {
    const sim = lab([
      status('short', { duration: { kind: 'ms', value: 500 } }),
      status('turn', { duration: { kind: 'turns', value: 2 } }),
      status('forever', { duration: null }),
    ]);
    const a = indexOfKey(sim, 'a');
    apply(sim, 'short', a);
    apply(sim, 'turn', a);
    apply(sim, 'forever', a);
    expect(instances(sim, a).map((i) => i.ticks)).toEqual([30, 360, -1]); // 2 turns x 3000 ms
    run(sim, 29);
    expect(sim.entities.fxCount[a]).toBe(3);
    run(sim, 1);
    expect(sim.entities.fxCount[a]).toBe(2); // 'short' lasted exactly 30 ticks
    run(sim, 330);
    expect(sim.entities.fxCount[a]).toBe(1);
    run(sim, 5000);
    expect(instances(sim, a)).toEqual([{ ticks: -1, stacks: 1, source: -1 }]);
  });

  it('[P4B.effects.stacking] refresh renews the duration and never adds an instance', () => {
    const sim = lab([status('r', { stackMode: 'refresh' })]);
    const a = indexOfKey(sim, 'a');
    apply(sim, 'r', a);
    run(sim, 40);
    expect(instances(sim, a)).toEqual([{ ticks: 20, stacks: 1, source: -1 }]);
    apply(sim, 'r', a);
    expect(instances(sim, a)).toEqual([{ ticks: 60, stacks: 1, source: -1 }]);
  });

  it('[P4B.effects.stacking] stack adds a stack up to maxStacks and renews the duration; periodic runs once per stack', () => {
    const tick = { interval: { kind: 'ms' as const, value: 100 }, actions: [{ type: 'modify-health' as const, target: { by: 'subject' as const }, delta: -1 }] };
    const sim = lab([status('poison', { stackMode: 'stack', maxStacks: 3, duration: { kind: 'ms', value: 2000 }, periodic: tick })]);
    const a = indexOfKey(sim, 'a');
    for (let k = 0; k < 5; k++) apply(sim, 'poison', a);
    expect(instances(sim, a)).toEqual([{ ticks: 120, stacks: 3, source: -1 }]); // capped at maxStacks
    expect(sim.effects.stacks(a, sim.effects.indexOf(id('status', 'poison')))).toBe(3);
    run(sim, 60); // ten intervals of 6 ticks
    expect(sim.entities.hp[a]).toBe(100 - 10 * 3);
    // One stack hurts a third as much.
    const one = lab([status('poison', { stackMode: 'stack', maxStacks: 3, duration: { kind: 'ms', value: 2000 }, periodic: tick })]);
    apply(one, 'poison', indexOfKey(one, 'a'));
    run(one, 60);
    expect(one.entities.hp[indexOfKey(one, 'a')]).toBe(90);
  });

  it('[P4B.effects.stacking] ignore keeps the first instance untouched; independent always adds one', () => {
    const sim = lab([status('ward', { stackMode: 'ignore' }), status('mark', { stackMode: 'independent' })]);
    const a = indexOfKey(sim, 'a');
    apply(sim, 'ward', a);
    run(sim, 10);
    apply(sim, 'ward', a);
    expect(instances(sim, a)).toEqual([{ ticks: 50, stacks: 1, source: -1 }]); // not renewed
    apply(sim, 'mark', a);
    run(sim, 10);
    apply(sim, 'mark', a);
    expect(instances(sim, a).map((i) => i.ticks)).toEqual([40, 50, 60]); // two marks, each with its own clock
  });

  it('[P4B.effects.stacking] stackScope: per-source keeps one instance per source; global shares one', () => {
    const sim = lab([status('mine', { stackMode: 'stack', maxStacks: 9, stackScope: 'per-source' }), status('ours', { stackMode: 'stack', maxStacks: 9, stackScope: 'global' })]);
    const a = indexOfKey(sim, 'a');
    const [s1, s2] = [sim.entities.idAt(0), sim.entities.idAt(a)];
    apply(sim, 'mine', a, s1);
    apply(sim, 'mine', a, s2);
    apply(sim, 'mine', a, s1);
    expect(instances(sim, a).map((i) => [i.source, i.stacks])).toEqual([[s1, 2], [s2, 1]]);
    sim.effects.remove(a, sim.effects.indexOf(id('status', 'mine')));
    apply(sim, 'ours', a, s1);
    apply(sim, 'ours', a, s2);
    expect(instances(sim, a).map((i) => i.stacks)).toEqual([2]);
  });

  it('caps at 32 effects per entity: a further instance is refused with a diagnostic', () => {
    const sim = lab([status('mark', { stackMode: 'independent', duration: null })]);
    const a = indexOfKey(sim, 'a');
    for (let k = 0; k < 40; k++) apply(sim, 'mark', a);
    expect(sim.entities.fxCount[a]).toBe(32);
    expect(sim.diagnostics.countOf('effect-cap')).toBe(8);
  });

  it('[P4B.effects.restricts] each restriction has its reader: move, attack, dodge, act', () => {
    const sim = lab(
      [
        status('rooted', { restricts: ['move'] }),
        status('disarmed', { restricts: ['attack'] }),
        status('hobbled', { restricts: ['dodge'] }),
        status('silenced', { restricts: ['act'] }),
      ],
      (s) => s.place('elder', 'Elder', { x: here.x, y: here.y + 1.2 }, { brain: undefined }),
      (p) => void p.triggers.push(trigger({ type: 'interacted', target: { by: 'any' } }, [addVar(V.pulses, 1)])),
    );
    const e = sim.entities;
    const only = (name: string, bit: number): void => {
      for (const n of ['rooted', 'disarmed', 'hobbled', 'silenced']) sim.effects.remove(0, sim.effects.indexOf(id('status', n)));
      apply(sim, name, 0);
      expect(e.restrict[0]).toBe(bit);
    };
    // move: read by movement
    only('rooted', RESTRICT_MOVE);
    const x = e.x[0]!;
    runWith(sim, 10, { move: { x: -1, y: 0 } });
    expect(e.x[0]).toBe(x);
    // attack: read by attack start
    only('disarmed', RESTRICT_ATTACK);
    runWith(sim, 1, { pressed: ROLE_ATTACK_PRIMARY });
    expect(e.attackPhase[0]).toBe(PHASE_NONE);
    // dodge: read by dodge start
    only('hobbled', RESTRICT_DODGE);
    runWith(sim, 1, { pressed: ROLE_DODGE });
    expect(e.dodgeTicks[0]).toBe(0);
    // act: read by interact
    only('silenced', RESTRICT_ACT);
    e.facing[0] = Math.PI / 2; // toward the elder
    runWith(sim, 2, { pressed: ROLE_INTERACT });
    expect(sim.variables.get(V.pulses)).toBe(0);
    // With none of them, everything works again.
    sim.effects.remove(0, sim.effects.indexOf(id('status', 'silenced')));
    expect(e.restrict[0]).toBe(0);
    runWith(sim, 1, { pressed: ROLE_INTERACT });
    run(sim, 1);
    expect(sim.variables.get(V.pulses)).toBe(1);
    runWith(sim, 1, { pressed: ROLE_DODGE });
    expect(e.dodgeTicks[0]).toBeGreaterThan(0);
  });

  it('[P4B.effects.flags] invulnerable is read by attack contact; untargetable by acquisition and sight', () => {
    const sim = lab([status('shielded', { flags: ['invulnerable'] }), status('hidden', { flags: ['untargetable'] })], (s) => {
      s.place('watcher', 'Sentry', { x: here.x + 6, y: here.y }, { brain: undefined, movement: undefined, attacker: undefined });
    });
    const e = sim.entities;
    const a = indexOfKey(sim, 'a');
    const watcher = indexOfKey(sim, 'watcher');
    apply(sim, 'shielded', a);
    expect(e.status[a]).toBe(STATUS_INVULNERABLE);
    runWith(sim, 1, { pressed: ROLE_ATTACK_PRIMARY });
    run(sim, 25);
    expect(e.hp[a]).toBe(100); // the blow found nothing to hit
    // It wears off after its second, and the next blow lands.
    run(sim, 40);
    expect(e.status[a]).toBe(0);
    runWith(sim, 1, { pressed: ROLE_ATTACK_PRIMARY });
    run(sim, 25);
    expect(e.hp[a]).toBe(90);

    run(sim, 12);
    expect(e.target[watcher]).toBe(e.idAt(0)); // the sentry has acquired the hero
    apply(sim, 'hidden', 0);
    expect(e.status[0]).toBe(STATUS_UNTARGETABLE);
    expect(sim.sight.canSee(watcher, 0)).toBe(false);
    run(sim, 1);
    expect(e.target[watcher]).toBe(-1);
    run(sim, 30);
    expect(e.target[watcher]).toBe(-1); // and it cannot re-acquire while the effect lasts
    run(sim, 40);
    expect(e.target[watcher]).toBe(e.idAt(0));
  });

  it('periodic payloads run every interval with the bearer as subject and the source as other; effects tick through hitstop', () => {
    const sim = lab([
      status('burn', {
        duration: { kind: 'ms', value: 1000 },
        periodic: { interval: { kind: 'ms', value: 250 }, actions: [{ type: 'modify-health', target: { by: 'subject' }, delta: -2 }, { type: 'modify-health', target: { by: 'other' }, delta: -1 }] },
      }),
    ]);
    const e = sim.entities;
    const a = indexOfKey(sim, 'a');
    apply(sim, 'burn', a, e.idAt(0));
    sim.applyHitstop(a, 200); // frozen, but the effect is not
    run(sim, 60);
    expect(e.hp[a]).toBe(100 - 4 * 2); // at 250, 500, 750 and 1000 ms
    expect(e.hp[0]).toBe(100 - 4); // the source was `other`
    expect(e.fxCount[a]).toBe(0);
  });

  it('[P4B.act.apply-effect] apply-effect and remove-effect, with the action\'s subject as the source', () => {
    const sim = lab([status('mine', { stackMode: 'independent', stackScope: 'per-source' })]);
    const e = sim.entities;
    const a = indexOfKey(sim, 'a');
    const mine = id('status', 'mine') as Id<'status'>;
    sim.executor.run([{ type: 'apply-effect', target: { by: 'tag', tag: 'body' }, statusId: mine }], { subject: e.idAt(0), other: -1 });
    sim.executor.run([{ type: 'apply-effect', target: { by: 'other' }, statusId: mine }], { subject: -1, other: e.idAt(a) });
    expect(instances(sim, a).map((i) => i.source)).toEqual([e.idAt(0), -1]);
    expect(e.fxCount[0]).toBe(0); // only the tagged body was targeted
    sim.executor.run([{ type: 'remove-effect', target: { by: 'any' }, statusId: mine }], NOBODY);
    expect(e.fxCount[a]).toBe(0);
    // Emberfall's slam applies `stunned` on hit, which restricts move, attack and dodge.
    expect(sim.effects.compiled[sim.effects.indexOf(id('status', 'stunned'))]!.restrict).toBe(RESTRICT_MOVE | RESTRICT_ATTACK | RESTRICT_DODGE);
  });
});

describe('health, death and terrain contact', () => {
  it('[P4B.act.modify-health] modify-health clamps to 0..max and ignores entities without health', () => {
    const sim = lab([], (s) => s.place('elder', 'Elder', { x: here.x + 4, y: here.y }, { brain: undefined }));
    const e = sim.entities;
    const a = indexOfKey(sim, 'a');
    const hurt = (delta: number) => sim.executor.run([{ type: 'modify-health', target: { by: 'any' }, delta }], NOBODY);
    hurt(-30);
    expect([e.hp[0], e.hp[a]]).toEqual([70, 70]);
    hurt(500);
    expect([e.hp[0], e.hp[a]]).toEqual([100, 100]); // not above max
    hurt(-1000);
    expect([e.hp[0], e.hp[a]]).toEqual([0, 0]); // not below zero
    expect(e.hp[indexOfKey(sim, 'elder')]).toBe(0); // no health component: stays at its zero
    expect(presented(sim).filter((x) => x.kind === 'hurt').map((x) => x.n)).toEqual([-30, -30, -100, -100]);
  });

  it('[P4B.events.health-crossed] health-crossed fires once per listened threshold the health falls across', () => {
    const sim = lab([], undefined, (p) => {
      const who = { by: 'tag' as const, tag: 'body' };
      p.triggers.push(
        trigger({ type: 'health-crossed', who, belowFraction: 0.5 }, [addVar(V.pulses, 1)]),
        trigger({ type: 'health-crossed', who, belowFraction: 0.25 }, [addVar(V.lucky, 1)]),
        trigger({ type: 'health-crossed', who: { by: 'player' }, belowFraction: 0.5 }, [addVar(V.visits, 1)]),
      );
    });
    const e = sim.entities;
    const a = indexOfKey(sim, 'a');
    const counts = () => [sim.variables.get(V.pulses), sim.variables.get(V.lucky), sim.variables.get(V.visits)];
    expect(sim.triggers.healthThresholds).toEqual([0.25, 0.5]);
    sim.health.modify(a, -49);
    run(sim, 2);
    expect(counts()).toEqual([0, 0, 0]); // 51%: not across
    sim.health.modify(a, -2);
    run(sim, 2);
    expect(counts()).toEqual([1, 0, 0]); // 49%
    sim.health.modify(a, 30);
    sim.health.modify(a, -5);
    run(sim, 2);
    expect(counts()).toEqual([1, 0, 0]); // rose, then fell without crossing: nothing
    sim.health.modify(a, -70);
    run(sim, 2);
    expect(counts()).toEqual([2, 1, 0]); // one blow from 74% to 4%: across both
    expect(e.hp[a]).toBe(4);
  });

  it('[P4B.events.entity-died] at zero the entity dies: entity-died with the killer as other, onDeath actions, the death feedback; [P4B.feedback-events.hurt-death]', () => {
    const sim = lab([], (s) => {
      const body = s.project.archetypes.find((x) => x.name === 'Body')!.components;
      body.onDeath = { actions: [{ type: 'set-variable', variableId: V.pulses, op: { kind: 'add', value: 1 } }, { type: 'modify-health', target: { by: 'other' }, delta: -3 }], despawnAfterMs: 500 };
      body.feedback = { onHurt: undefined, onDeath: id('feedback', 'death') as Id<'feedback'> };
    }, (p) => {
      p.triggers.push(trigger({ type: 'entity-died', who: { by: 'tag', tag: 'body' } }, [addVar(V.lucky, 1)], { given: [{ type: 'alive', who: { by: 'other' } }] }));
      p.attacks.find((x) => x.name === 'slash')!.onHit = [{ type: 'modify-health', target: { by: 'other' }, delta: -500 }];
    });
    const e = sim.entities;
    const a = indexOfKey(sim, 'a');
    const victim = e.idAt(a);
    runWith(sim, 1, { pressed: ROLE_ATTACK_PRIMARY });
    run(sim, 8);
    expect(e.hp[a]).toBe(0);
    expect(sim.matcher.test({ by: 'any' }, victim, NOBODY)).toBe(true); // still present: dying
    expect(sim.evaluator.evaluate({ type: 'alive', who: { by: 'placement', key: id('placement', 'a') as Id<'placement'> } }, { ...NOBODY, brain: null })).toBe(false);
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky)]).toEqual([1, 1]);
    expect(e.hp[0]).toBe(97); // onDeath ran with the killer as `other`
    const events = presented(sim);
    expect(events.filter((x) => x.kind === 'death').map((x) => [x.a, x.b])).toEqual([[victim, e.idAt(0)]]);
    expect(events.filter((x) => x.kind === 'feedback' && x.s === id('feedback', 'death')).map((x) => x.a)).toEqual([victim]);
    // A dead entity takes no more damage and is hit by nothing.
    sim.health.modify(a, 50);
    expect(e.hp[a]).toBe(0);
  });

  it('[P4B.death.despawn] the entity despawns after despawnAfterMs, and its placement key joins the save\'s removed list', () => {
    const sim = lab([], (s) => {
      s.project.archetypes.find((x) => x.name === 'Body')!.components.onDeath = { actions: [], despawnAfterMs: 500 };
      s.archetype('Wisp', { ...BODY }); // no onDeath component: gone at once
      s.place('wisp', 'Wisp', { x: here.x + 5, y: here.y });
    });
    const e = sim.entities;
    const a = e.idAt(indexOfKey(sim, 'a'));
    const wisp = e.idAt(indexOfKey(sim, 'wisp'));
    sim.health.modify(indexOfKey(sim, 'a'), -100);
    sim.health.modify(indexOfKey(sim, 'wisp'), -100);
    run(sim, 1);
    const died = sim.tick - 1;
    run(sim, 1);
    expect(e.isAlive(wisp)).toBe(false);
    expect(e.isAlive(a)).toBe(true);
    while (e.isAlive(a)) run(sim, 1);
    expect(sim.tick - 1 - died).toBe(30); // 500 ms
    const save = sim.snapshot('', 'manual');
    expect(save.maps[save.currentMapId]!.removed.sort()).toEqual([id('placement', 'a'), id('placement', 'wisp')].sort());
  });

  it('player death is handled by data: the hero archetype\'s onDeath ends the session in defeat', () => {
    const sim = lab();
    sim.health.modify(0, -100);
    run(sim, 2);
    expect(sim.outcome).toBe('defeat');
    expect(presented(sim).filter((x) => x.kind === 'session-ended').map((x) => x.s)).toEqual(['defeat']);
  });

  it('[P4B.terrain.contact] terrain contact runs its actions every everyMs while a walker stands on it', () => {
    // Emberfall's lava: -5 every 500 ms.
    const sim = stageSim(20, 10, { col: 4, row: 5 }, (m) => m.fill({ col: 8, row: 0, w: 4, h: 10 }, T.lava, 0));
    const e = sim.entities;
    run(sim, 120);
    expect(e.hp[0]).toBe(100); // grass does nothing
    const lava = cellCenter(9, 5);
    sim.place(0, lava.x, lava.y);
    run(sim, 2);
    expect(e.hp[0]).toBe(95); // at once on stepping in
    run(sim, 28);
    expect(e.hp[0]).toBe(95);
    run(sim, 1);
    expect(e.hp[0]).toBe(90); // 30 ticks later
    run(sim, 60);
    expect(e.hp[0]).toBe(80);
    const grass = cellCenter(4, 5);
    sim.place(0, grass.x, grass.y);
    run(sim, 120);
    expect(e.hp[0]).toBe(80);
    // A flyer over the lava is not standing on it.
    const flyer = stageSim(20, 10, { col: 9, row: 5 }, (m) => m.fill({ col: 8, row: 0, w: 4, h: 10 }, T.lava, 0), (p) => {
      p.archetypes[0]!.components.movement = { speed: 4, turnRate: 12, modes: ['fly'], startMode: 'fly' };
    });
    run(flyer, 120);
    expect(flyer.entities.hp[0]).toBe(100);
  });

  it('[P4B.act.apply-impulse] apply-impulse pushes away from the other entity, or along the pusher\'s facing, divided by mass', () => {
    const sim = lab([], (s) => s.archetype('Statue', { collider: { radius: 0.4, height: 2, solid: true }, health: { max: 10 } }));
    const e = sim.entities;
    const a = indexOfKey(sim, 'a');
    // 'other': the target is pushed directly away from the other entity.
    sim.executor.run([{ type: 'apply-impulse', target: { by: 'subject' }, strength: 6, away: 'other' }], { subject: e.idAt(a), other: e.idAt(0) });
    expect([e.vx[a], e.vy[a]]).toEqual([6, 0]); // the hero is due west of it
    e.vx[a] = 0;
    // 'facing': along the subject's facing.
    e.facing[0] = Math.PI / 2;
    sim.executor.run([{ type: 'apply-impulse', target: { by: 'other' }, strength: 6, away: 'facing' }], { subject: e.idAt(0), other: e.idAt(a) });
    expect(e.vx[a]).toBeCloseTo(0, 9);
    expect(e.vy[a]).toBeCloseTo(6, 9);
    // With no other entity, 'other' has nothing to push away from.
    sim.executor.run([{ type: 'apply-impulse', target: { by: 'player' }, strength: 6, away: 'other' }], NOBODY);
    expect(sim.diagnostics.countOf('impulse-no-source')).toBe(1);
    expect([e.vx[0], e.vy[0]]).toEqual([0, 0]);
  });

  it('[P4B.act.play-feedback] play-feedback raises a feedback presentation event on each target', () => {
    const sim = lab();
    const e = sim.entities;
    const fb = id('feedback', 'heavy-hit') as Id<'feedback'>;
    sim.executor.run([{ type: 'play-feedback', target: { by: 'any' }, feedbackId: fb }], { subject: e.idAt(0), other: -1 });
    expect(presented(sim).filter((x) => x.kind === 'feedback').map((x) => [x.a, x.b, x.s])).toEqual([
      [e.idAt(0), e.idAt(0), fb],
      [e.idAt(1), e.idAt(0), fb],
    ]);
  });
});

describe('[P4B.act.scripted-jump] scripted jumps', () => {
  /** Low ground on the left, a level-4 plateau with no ramp on the right. */
  const gap = (mutate?: (p: Project) => void): Sim =>
    stageSim(20, 12, { col: 5, row: 6 }, (m, s) => {
      m.fill({ col: 9, row: 0, w: 11, h: 12 }, T.stone, 4);
      m.fill({ col: 9, row: 2, w: 1, h: 1 }, T.rock, 4);
      s.archetype('Body', { ...BODY, faction: { factionId: s.project.factions[1]!.id }, attacker: { attackIds: [id('attack', 'stab') as Id<'attack'>] } });
      s.place('guard', 'Body', { col: 12, row: 6 });
    }, mutate);
  const top = cellCenter(11, 6);
  const jump = (sim: Sim, to = top, durationMs = 500, apex = 1, clip?: string): void =>
    sim.executor.run([{ type: 'scripted-jump', target: { by: 'player' }, to, durationMs, apex, clip }], NOBODY);

  it('a jump crosses a cliff that A* cannot', () => {
    const sim = gap();
    sim.paths.request(0, top.x, top.y);
    run(sim, 300);
    expect(sim.paths.lastStatus).toBe('unreachable');
    expect(sim.entities.z[0]).toBe(0);
    jump(sim);
    run(sim, 40);
    expect(cellOfEntity(sim, 0)).toBe(6 * 20 + 11);
    expect(sim.entities.z[0]).toBe(2);
  });

  it('the target lands exactly on the surface at `to`, after durationMs, peaking apex above the higher end', () => {
    const sim = gap();
    const e = sim.entities;
    jump(sim, top, 500, 1.5);
    expect(e.airborne[0]).toBe(1);
    let peak = 0;
    let ticks = 0;
    while (e.airborne[0] === 1) {
      run(sim, 1);
      ticks++;
      peak = Math.max(peak, e.z[0]!);
    }
    expect(ticks).toBe(30); // 500 ms
    expect([e.x[0], e.y[0], e.z[0]]).toEqual([top.x, top.y, 2]);
    expect(peak).toBeGreaterThanOrEqual(2 + 1.5 - 1e-9); // apex above the higher end (the plateau, at 2)
    expect(peak).toBeLessThan(2 + 1.5 + 0.2);
    run(sim, 5);
    expect([e.x[0], e.y[0], e.z[0]]).toEqual([top.x, top.y, 2]); // and it stays put: standing on the surface
  });

  it('[P4B.events.jump-landed] landing raises jump-landed', () => {
    const sim = gap((p) => void p.triggers.push(trigger({ type: 'jump-landed', who: { by: 'player' } }, [addVar(V.pulses, 1)])));
    jump(sim);
    run(sim, 29);
    expect(sim.variables.get(V.pulses)).toBe(0);
    run(sim, 2);
    expect(sim.variables.get(V.pulses)).toBe(1);
  });

  it('while airborne it is invulnerable and restricted: an attack during flight makes no contact, and input is ignored', () => {
    const sim = gap();
    const e = sim.entities;
    const guard = indexOfKey(sim, 'guard');
    jump(sim, cellCenter(11, 6), 1000, 1);
    expect(sim.effects.has(0, FX_AIRBORNE)).toBe(true);
    expect(e.status[0]).toBe(STATUS_INVULNERABLE);
    expect(e.restrict[0]).toBe(RESTRICT_MOVE | RESTRICT_ATTACK | RESTRICT_DODGE | RESTRICT_ACT);
    // The guard swings while the hero passes through its reach.
    let swung = false;
    for (let t = 0; t < 59; t++) {
      if (t === 20) swung = sim.combat.start(guard, sim.combat.indexOf(id('attack', 'stab')), e.x[0]!, e.y[0]!);
      runWith(sim, 1, { move: { x: 0, y: -1 }, pressed: ROLE_ATTACK_PRIMARY | ROLE_DODGE, order: { kind: 'ground', x: 1, y: 1 } });
      expect(e.attackPhase[0]).toBe(PHASE_NONE);
      expect(e.dodgeTicks[0]).toBe(0);
      expect(e.orderKind[0]).toBe(0);
    }
    expect(swung).toBe(true);
    expect(e.hp[0]).toBe(100);
    expect(e.y[0]).toBeCloseTo(top.y, 6); // WASD did not bend the arc
    run(sim, 2);
    expect(e.airborne[0]).toBe(0);
    expect([e.status[0], e.restrict[0]]).toEqual([0, 0]); // the effect ends on landing
    // Now a swing connects.
    run(sim, 60);
    e.attackReady.fill(0); // skip the stab's cooldown
    expect(sim.combat.start(guard, sim.combat.indexOf(id('attack', 'stab')), e.x[0]!, e.y[0]!)).toBe(true);
    run(sim, 40);
    expect(e.hp[0]).toBe(92);
  });

  it('an impassable landing fails without moving anything', () => {
    const sim = gap();
    const e = sim.entities;
    const at = [e.x[0], e.y[0], e.z[0]];
    jump(sim, cellCenter(9, 2)); // rock
    jump(sim, { x: -50, y: -50 }); // off the map
    run(sim, 10);
    expect(e.airborne[0]).toBe(0);
    expect([e.x[0], e.y[0], e.z[0]]).toEqual(at);
    expect(sim.diagnostics.countOf('jump-landing-impassable')).toBe(2);
    expect(e.fxCount[0]).toBe(0);
  });

  it('the animator plays the jump\'s clip when one is given', () => {
    const sim = gap();
    jump(sim, top, 500, 1, 'dodge');
    run(sim, 5);
    expect(sim.entities.animClip[0]).toBe('dodge');
    run(sim, 40);
    expect(sim.entities.animClip[0]).toBe('idle');
  });

  it('a recorded jump replays identically, and a save taken in mid-air resumes to the same landing', () => {
    const project = (): Project => gap((p) => {
      p.maps[0]!.triggers.push(trigger({ type: 'interacted', target: { by: 'any' } }, [{ type: 'scripted-jump', target: { by: 'subject' }, to: top, durationMs: 700, apex: 2, clip: undefined }]));
      p.archetypes.push({ id: id('archetype', 'ledge') as Id<'archetype'>, name: 'Ledge', tags: [], components: { interactable: { radius: 3, prompt: 'Climb' } } });
      p.maps[0]!.placements.push({ key: id('placement', 'ledge') as Id<'placement'>, archetypeId: id('archetype', 'ledge') as Id<'archetype'>, x: cellCenter(6, 6).x, y: cellCenter(6, 6).y, facing: 0, overrides: undefined });
    }).project;
    // The authored case of spec 7.9c: a ledge the player uses; the trigger jumps the player (the subject).
    const frames: InputFrame[] = [];
    for (let t = 0; t < 120; t++) frames.push({ ...emptyInput(), pressed: t === 10 ? ROLE_INTERACT : 0, move: { x: t > 80 ? 1 : 0, y: 0 } });
    const play = (rt: Runtime, from: number, to: number) => {
      for (let t = from; t < to; t++) rt.tick(frames[t]!);
    };
    const a = createRuntime(project(), null, OPTS);
    play(a, 0, 120);
    expect(a.view.entities.z(0)).toBe(2);
    const b = createRuntime(project(), null, OPTS);
    play(b, 0, 30);
    expect(b.view.entities.airborne(0)).toBe(true);
    const save = parseSave(JSON.parse(serializeSave(b.snapshot())));
    if (!save.ok) throw new Error(JSON.stringify(save.issues));
    expect(save.save.persistent[0]!.state.jump).toBeDefined();
    const c = createRuntime(project(), save.save, OPTS);
    expect(c.view.stateHash()).toBe(b.view.stateHash());
    play(b, 30, 120);
    play(c, 30, 120);
    expect(b.view.stateHash()).toBe(a.view.stateHash());
    expect(c.view.stateHash()).toBe(a.view.stateHash());
  });
});

describe('the animator: the simulation owns animation time', () => {
  it('[P4B.animator.states] picks the clip by priority: death, dodge, attack phase, hurt, move, idle', () => {
    const sim = lab();
    const e = sim.entities;
    run(sim, 1);
    expect(e.animClip[0]).toBe('idle'); // stateClips.idle of the hero's animation set
    runWith(sim, 2, { move: { x: 0, y: 1 } });
    expect(e.animClip[0]).toBe('move');
    sim.health.modify(0, -1);
    runWith(sim, 1, { move: { x: 0, y: 1 } });
    expect(e.animClip[0]).toBe('hurt'); // hurt outranks move, for 200 ms
    runWith(sim, 12, { move: { x: 0, y: 1 } });
    expect(e.animClip[0]).toBe('move');
    runWith(sim, 1, { pressed: ROLE_ATTACK_PRIMARY, move: { x: 0, y: 1 } });
    expect(e.animClip[0]).toBe('slash-windup'); // an attack outranks hurt and move
    sim.health.modify(0, -1);
    run(sim, 1);
    expect(e.animClip[0]).toBe('slash-windup');
    run(sim, 30);
    runWith(sim, 1, { pressed: ROLE_DODGE });
    expect(e.animClip[0]).toBe('dodge');
    run(sim, 30);
    expect(e.animClip[0]).toBe('idle');
    sim.health.modify(0, -500);
    run(sim, 2);
    expect(e.animClip[0]).toBe('death'); // death outranks everything
    // An entity with no sprite component has no animator state.
    expect(e.animClip[indexOfKey(sim, 'a')]).toBe('');
  });

  it('[P4B.animator.clock] frames advance by frameMs on the simulation clock; looping clips wrap and one-shots hold their last frame', () => {
    const sim = lab([], (s) => s.place('sentry', 'Sentry', { x: here.x + 6, y: here.y + 3 }, { brain: undefined, acquisition: undefined }));
    const e = sim.entities;
    const sentry = indexOfKey(sim, 'sentry');
    // idle: 2 frames of 400 ms (24 ticks), looping.
    const frames: number[] = [];
    for (let t = 0; t < 96; t++) {
      run(sim, 1);
      frames.push(e.animFrame[0]!);
    }
    expect(frames.slice(0, 24).every((f) => f === 0)).toBe(true);
    expect(frames.slice(24, 48).every((f) => f === 1)).toBe(true);
    expect(frames.slice(48, 72).every((f) => f === 0)).toBe(true); // wrapped
    // death: 3 frames of 150 ms (9 ticks), not looping. (A sentry, not the hero: the hero's death ends the session.)
    sim.health.modify(sentry, -500);
    const death: number[] = [];
    for (let t = 0; t < 60; t++) {
      run(sim, 1);
      if (e.animClip[sentry] === 'death') death.push(e.animFrame[sentry]!);
    }
    expect(death.length).toBe(60);
    expect(death.slice(0, 9).every((f) => f === 0)).toBe(true);
    expect(death.slice(9, 18).every((f) => f === 1)).toBe(true);
    expect(death.slice(18).every((f) => f === 2)).toBe(true); // holds the last frame
  });

  it('[P4B.animator.attack-clips] attack-phase clips are stretched to the phase\'s duration, whatever their frameMs', () => {
    // thrust-windup has 2 frames; the windup is 16 ticks: 8 ticks a frame.
    const sim = lab();
    const e = sim.entities;
    runWith(sim, 1, { pressed: ROLE_ATTACK_SECONDARY });
    const seen: [string, number][] = [[e.animClip[0]!, e.animFrame[0]!]];
    let held = 0;
    for (let t = 0; t < 46; t++) {
      const before = `${e.animClip[0]}:${e.animTicks[0]}`;
      run(sim, 1);
      // The blow lands on `a`: five ticks of hitstop, during which the animator does not step
      // and the impact pose (the active clip, not the windup's last frame) holds.
      if (`${e.animClip[0]}:${e.animTicks[0]}` === before) {
        expect([e.animClip[0], e.animFrame[0]]).toEqual(['thrust-active', 0]);
        held++;
        continue;
      }
      seen.push([e.animClip[0]!, e.animFrame[0]!]);
    }
    expect(held).toBe(5);
    const of = (clip: string) => seen.filter((x) => x[0] === clip).map((x) => x[1]);
    expect(of('thrust-windup')).toEqual([...Array(8).fill(0), ...Array(8).fill(1)]);
    expect(of('thrust-active').every((f) => f === 0)).toBe(true);
    expect(of('thrust-active').length).toBeGreaterThan(0);
    expect(of('thrust-recovery')[0]).toBe(0);
    expect(of('thrust-recovery').pop()).toBe(1);
  });

  it('hitstop freezes the animator, and a frame that lands on a clip cue raises its presentation event', () => {
    const sim = lab([], undefined, (p) => {
      p.animationSets[0]!.clips['move']!.cues = [{ frame: 2, feedbackId: id('feedback', 'hit') as Id<'feedback'> }];
    });
    const e = sim.entities;
    run(sim, 30);
    sim.applyHitstop(0, 10);
    run(sim, 1); // the tick of the "hit": the animator still steps, then holds
    const frozen = [e.animClip[0], e.animTicks[0], e.animFrame[0]];
    run(sim, 10);
    expect([e.animClip[0], e.animTicks[0], e.animFrame[0]]).toEqual(frozen);
    run(sim, 1);
    expect(e.animTicks[0]).toBe((frozen[1] as number) + 1);
    // move: 4 frames of 120 ms; frame 2 carries a footstep cue.
    runWith(sim, 60, { move: { x: 1, y: 0 } });
    const cues = presented(sim).filter((x) => x.kind === 'cue');
    expect(cues.length).toBeGreaterThanOrEqual(2); // once each time the loop reaches frame 2
    expect(cues.every((x) => x.a === e.idAt(0) && x.s === id('feedback', 'hit'))).toBe(true);
  });
});

describe('[P4B.brain.attack] brains that fight', () => {
  /** A fighter whose brain swings the given attacks at the hero standing beside it. */
  const arena = (pick: 'sequence' | 'random', attacks: string[], gapX = 1.4): Sim =>
    stageSim(30, 14, HERO, (_m, s) => {
      const brainId = id('brain', 'fighter') as Id<'brain'>;
      const attackIds = attacks.map((n) => id('attack', n) as Id<'attack'>);
      s.project.brains.push({
        id: brainId,
        name: 'fighter',
        initial: 'wait',
        states: [
          { id: 'wait', behavior: { kind: 'idle' }, onEnter: undefined, transitions: [{ to: 'fight', when: [{ type: 'has-target' }], afterMs: undefined }] },
          { id: 'fight', behavior: { kind: 'attack', attackIds, pick }, onEnter: undefined, transitions: [] },
        ],
      });
      const sentry = s.project.archetypes.find((a) => a.name === 'Sentry')!.components;
      s.archetype('Fighter', { ...sentry, movement: undefined, brain: { brainId }, attacker: { attackIds } });
      s.place('fighter', 'Fighter', { x: here.x + gapX, y: here.y });
    }, (p) => {
      // Make the hero durable, and unable to be pushed out of reach.
      p.archetypes[0]!.components.health = { max: 100_000 };
      p.archetypes[0]!.components.motion = undefined;
      for (const a of p.attacks) a.onHit = a.onHit.filter((x) => x.type !== 'apply-effect');
    });
  /** The attacks the fighter started, in order. */
  const swings = (sim: Sim): string[] =>
    presented(sim)
      .filter((x) => x.kind === 'attack-windup' && x.a === sim.entities.idAt(indexOfKey(sim, 'fighter')))
      .map((x) => sim.project.attacks.find((a) => a.id === x.s)!.name);

  it('faces the target and swings its attacks in sequence', () => {
    const sim = arena('sequence', ['slam', 'sweep', 'stab']);
    run(sim, 900);
    const order = swings(sim);
    expect(order.length).toBeGreaterThanOrEqual(6);
    for (let k = 0; k < order.length; k++) expect(order[k]).toBe(['slam', 'sweep', 'stab'][k % 3]);
    const f = indexOfKey(sim, 'fighter');
    expect(Math.abs(sim.entities.facing[f]!)).toBeCloseTo(Math.PI, 3); // facing the hero, to its west
    expect(sim.entities.hp[0]).toBeLessThan(100_000);
  });

  it('or in seeded random order: the same seed picks the same attacks', () => {
    const a = arena('random', ['slam', 'sweep', 'stab']);
    const b = arena('random', ['slam', 'sweep', 'stab']);
    run(a, 1500);
    run(b, 1500);
    const order = swings(a);
    expect(order.length).toBeGreaterThanOrEqual(8);
    expect(new Set(order).size).toBe(3); // all three get used ...
    expect(order.join()).not.toBe(Array.from({ length: order.length }, (_, k) => ['slam', 'sweep', 'stab'][k % 3]).join()); // ... not in sequence
    expect(swings(b)).toEqual(order);
  });

  it('starts an attack only inside its aiRange (or the hitbox\'s reach when aiRange is not set)', () => {
    // stab: aiRange 1.3. The hero's radius is 0.35, so the swing starts within 1.65.
    const far = arena('sequence', ['stab'], 1.8);
    run(far, 300);
    expect(swings(far)).toEqual([]);
    const near = arena('sequence', ['stab'], 1.6);
    run(near, 300);
    expect(swings(near).length).toBeGreaterThan(0);
    // slash has no aiRange: its reach is the arc's range, 1.6 (+ 0.35).
    const reach = arena('sequence', ['slash'], 1.9);
    run(reach, 120);
    expect(swings(reach).length).toBeGreaterThan(0);
    const beyond = arena('sequence', ['slash'], 2.1);
    run(beyond, 120);
    expect(swings(beyond)).toEqual([]);
  });
});

describe('[P4B.emberfall.boss] Emberfall plays headless', () => {
  const E = EMBERFALL;
  /** Emberfall with the hero just inside the boss arena's gate, tough enough to survive the scripted fight. */
  function fight(mutate?: (p: Project) => void, startCol = E.arenaGate.col + 2): Sim {
    const p = buildEmberfall();
    const gate = cellCenter(startCol, E.arenaGate.row);
    p.maps[0]!.playerStart = { x: gate.x, y: gate.y, facing: 0 };
    p.archetypes[0]!.components.health = { max: 2000 };
    if (mutate) mutate(p);
    return createSim(p, null, OPTS);
  }
  const boss = (sim: Sim): number => sim.entities.indexOfPlacement(KEYS.warden);
  /** One tick of the hero pressing the attack toward the boss: an attack order, with the click held. */
  const press = (sim: Sim): void => {
    const e = sim.entities;
    const b = boss(sim);
    if (b < 0) {
      run(sim, 1);
      return;
    }
    const order = e.orderKind[0] === 0 ? { kind: 'entity' as const, entity: e.idAt(b) } : null;
    runWith(sim, 1, { order, pressed: order ? ROLE_CLICK : 0, held: ROLE_CLICK });
  };

  it('the mini-boss telegraphs its slam: a long windup the player can see coming', () => {
    const sim = fight();
    const e = sim.entities;
    const b = boss(sim);
    let windupAt = -1;
    let activeAt = -1;
    for (let t = 0; t < 900 && activeAt < 0; t++) {
      run(sim, 1);
      if (windupAt < 0 && e.attackPhase[b] !== PHASE_NONE) windupAt = sim.tick - 1;
      if (e.attackPhase[b] === PHASE_ACTIVE) activeAt = sim.tick - 1;
    }
    expect(sim.brains.stateOf(b)).toBe('fight');
    const telegraph = presented(sim).find((x) => x.kind === 'attack-windup' && x.a === e.idAt(b))!;
    expect(telegraph.s).toBe(id('attack', 'slam'));
    expect(telegraph.n).toBe(54); // 900 ms
    // Hitstop can delay the blow, never hasten it.
    expect(activeAt - telegraph.tick).toBeGreaterThanOrEqual(54);
  });

  it('the player dodges through the slam: the same blow that lands on a standing player misses a dodging one', () => {
    const outcome = (dodge: boolean): number => {
      const sim = fight();
      const e = sim.entities;
      const b = boss(sim);
      const start = e.hp[0]!;
      let dodged = false;
      for (let t = 0; t < 1200; t++) {
        const slamming = e.attack[b] === sim.combat.indexOf(id('attack', 'slam'));
        // Dodge on the tick before the slam turns active: its i-frames cover the active window.
        const now = dodge && !dodged && slamming && e.attackPhase[b] === 1 && e.attackTicks[b] === 1;
        if (now) dodged = true;
        runWith(sim, 1, now ? { pressed: ROLE_DODGE, move: { x: 0, y: 1 } } : {});
        if (slamming && e.attackPhase[b] === 3) break; // the slam is over
      }
      return start - e.hp[0]!;
    };
    expect(outcome(false)).toBe(30); // slam: -30
    expect(outcome(true)).toBe(0);
  });

  it('at 50% health a trigger switches the boss to its enraged state, with shorter cooldowns', () => {
    const sim = fight();
    const e = sim.entities;
    const b = boss(sim);
    for (let t = 0; t < 6000 && e.hp[b]! >= 150; t++) press(sim);
    expect(e.hp[b]).toBeLessThan(150);
    run(sim, 30);
    expect(sim.variables.get(V.enraged)).toBe(true);
    expect(['enraged', 'rage-hunt', 'rage-fight']).toContain(sim.brains.stateOf(b));
    expect(presented(sim).some((x) => x.kind === 'message' && x.s === 'The warden roars!')).toBe(true);
    // From now on it swings only its enraged attacks.
    const from = sim.presentation.end;
    for (let t = 0; t < 900 && boss(sim) >= 0 && e.hp[b]! > 0; t++) press(sim);
    const names = new Set<string>();
    sim.presentation.since(from, (x) => {
      if (x.kind === 'attack-windup' && x.a === e.idAt(b)) names.add(sim.project.attacks.find((a) => a.id === x.s)!.name);
    });
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^enraged-/);
    // The trigger is `once`: it does not fire again.
    expect(sim.triggers.hasFired(id('trigger', 'warden-enrages'))).toBe(true);
  });

  it('the boss\'s death ends the session in victory', () => {
    const sim = fight(undefined, E.arenaGate.col - 2); // outside the gate: the attack order walks in
    for (let t = 0; t < 20_000 && sim.outcome === null; t++) press(sim);
    expect(sim.outcome).toBe('victory');
    expect(sim.variables.get(V.visits)).toBe(1); // the arena's region-entered trigger counted the visit
  });
});
