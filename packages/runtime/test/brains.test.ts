import { describe, expect, it } from 'vitest';
import { EMBERFALL, buildEmberfall } from '@loreengine/fixtures';
import type { MapPainter } from '@loreengine/fixtures';
import { parseSave, serializeSave } from '@loreengine/schema';
import type { BrainDef, Condition, Id, Project } from '@loreengine/schema';
import { ORDER_ATTACK, ORDER_NONE, RESTRICT_ACT, STATUS_UNTARGETABLE } from '../src/entities.ts';
import { ROLE_CLICK, ROLE_INTERACT, createRuntime, emptyInput } from '../src/index.ts';
import { createSim } from '../src/runtime.ts';
import type { Sim } from '../src/sim.ts';
import { KEYS, OPTS, TERRAIN, V, addVar, cellCenter, cellOfEntity, click, id, indexOfKey, presented, run, runWith, stageSim, trigger } from './helpers.ts';
import type { Stage } from './helpers.ts';

const T = TERRAIN;
type State = BrainDef['states'][number];
const state = (sid: string, behavior: State['behavior'], transitions: State['transitions'] = [], onEnter?: State['onEnter']): State => ({ id: sid, behavior, onEnter, transitions });
const go = (to: string, when: Condition[] = [], afterMs?: number): State['transitions'][number] => ({ to, when, afterMs });

/** Add a brain and an archetype that carries it; returns the archetype's name. */
function creature(s: Stage, name: string, initial: string, states: State[], extra: Partial<Project['archetypes'][number]['components']> = {}): string {
  const brainId = id('brain', name) as Id<'brain'>;
  s.project.brains.push({ id: brainId, name, initial, states });
  const sentry = s.project.archetypes.find((a) => a.name === 'Sentry')!.components;
  s.archetype(name, { ...sentry, brain: { brainId }, ...extra }, ['creature']);
  return name;
}
const stateOf = (sim: Sim, name: string): string => sim.brains.stateOf(indexOfKey(sim, name));
const distanceHome = (sim: Sim, i: number): number => Math.hypot(sim.entities.x[i]! - sim.entities.homeX[i]!, sim.entities.y[i]! - sim.entities.homeY[i]!);

describe('brains: states, transitions, behaviors', () => {
  it('[P4A.brain.initial] an entity with a brain component starts in the brain\'s initial state, at home where it spawned', () => {
    const sim = stageSim(20, 10, { col: 2, row: 2 }, (_m, s) => {
      s.place('a', creature(s, 'Thinker', 'second', [state('first', { kind: 'idle' }), state('second', { kind: 'idle' })]), { col: 10, row: 5 });
      s.place('elder', 'Elder', { col: 14, row: 5 });
      s.archetype('Rock', { collider: { radius: 0.3, height: 1, solid: true } });
      s.place('rock', 'Rock', { col: 16, row: 5 });
    });
    expect(stateOf(sim, 'a')).toBe('second');
    expect(stateOf(sim, 'elder')).toBe('stand'); // the villager brain's initial
    expect(stateOf(sim, 'rock')).toBe(''); // no brain component, no brain
    expect(sim.brains.stateOf(0)).toBe(''); // the player has none either
    const i = indexOfKey(sim, 'a');
    const c = cellCenter(10, 5);
    expect([sim.entities.homeX[i], sim.entities.homeY[i]]).toEqual([c.x, c.y]);
  });

  it('[P4A.brain.transitions] checks transitions in authored order; the first whose conditions hold and whose afterMs has elapsed wins', () => {
    const sim = stageSim(20, 10, { col: 2, row: 2 }, (_m, s) => {
      const name = creature(s, 'Sequencer', 'a', [
        state('a', { kind: 'idle' }, [
          go('never', [{ type: 'variable', variableId: V.talked, comparator: '==', value: true }]), // fails
          go('late', [], 500), //   holds, but only after 500 ms = 30 ticks
          go('b', [], 100), //      holds after 100 ms = 6 ticks: this one wins first
        ]),
        state('b', { kind: 'idle' }, [go('late', [], 500), go('c', [], 500)]), // both hold at the same tick: authored order
        state('c', { kind: 'idle' }),
        state('late', { kind: 'idle' }),
        state('never', { kind: 'idle' }),
      ]);
      s.place('seq', name, { col: 10, row: 5 });
    });
    run(sim, 6);
    expect(stateOf(sim, 'seq')).toBe('a'); // elapsed ticks are 0..5: not yet 6
    run(sim, 1);
    expect(stateOf(sim, 'seq')).toBe('b');
    run(sim, 29);
    expect(stateOf(sim, 'seq')).toBe('b');
    run(sim, 1);
    expect(stateOf(sim, 'seq')).toBe('late'); // 'late' is listed before 'c'
  });

  it('[P4A.brain.idle] idle produces nothing', () => {
    const sim = stageSim(20, 10, { col: 2, row: 2 }, (_m, s) => s.place('idler', creature(s, 'Idler', 'rest', [state('rest', { kind: 'idle' })]), { col: 10, row: 5 }));
    const i = indexOfKey(sim, 'idler');
    const at = [sim.entities.x[i], sim.entities.y[i], sim.entities.facing[i]];
    const rng = sim.rng.getState();
    run(sim, 300);
    expect([sim.entities.x[i], sim.entities.y[i], sim.entities.facing[i]]).toEqual(at);
    expect(sim.rng.getState()).toEqual(rng);
  });

  it('[P4A.brain.wander] wander walks to seeded random points within the radius of home, every 2 to 4 s', () => {
    const sim = stageSim(30, 20, { col: 2, row: 2 }, (_m, s) => s.place('w', creature(s, 'Wanderer', 'roam', [state('roam', { kind: 'wander', radius: 3 })]), { col: 15, row: 10 }));
    const i = indexOfKey(sim, 'w');
    const e = sim.entities;
    let furthest = 0;
    let travelled = 0;
    const goals = new Set<string>();
    for (let t = 0; t < 1800; t++) {
      const [x, y] = [e.x[i]!, e.y[i]!];
      run(sim, 1);
      travelled += Math.hypot(e.x[i]! - x, e.y[i]! - y);
      furthest = Math.max(furthest, distanceHome(sim, i));
      if (e.hasGoal[i] === 1) goals.add(`${e.goalX[i]},${e.goalY[i]}`);
    }
    expect(travelled).toBeGreaterThan(5);
    expect(furthest).toBeLessThanOrEqual(3 + 1e-6);
    // 30 s at one point every 2 to 4 s: between 7 and 15 points.
    expect(goals.size).toBeGreaterThanOrEqual(7);
    expect(goals.size).toBeLessThanOrEqual(15);
    for (const g of goals) {
      const [gx, gy] = g.split(',').map(Number);
      expect(Math.hypot(gx! - e.homeX[i]!, gy! - e.homeY[i]!)).toBeLessThanOrEqual(3 + 1e-9);
    }
    // Seeded: the same project and seed wander the same way.
    const again = stageSim(30, 20, { col: 2, row: 2 }, (_m, s) => s.place('w', creature(s, 'Wanderer', 'roam', [state('roam', { kind: 'wander', radius: 3 })]), { col: 15, row: 10 }));
    run(again, 1800);
    expect([again.entities.x[i], again.entities.y[i]]).toEqual([e.x[i], e.y[i]]);
  });

  it('[P4A.brain.patrol] patrol visits the region\'s cells in stored order, looping', () => {
    const route: [number, number][] = [[6, 4], [12, 4], [12, 9], [6, 9]];
    const sim = stageSim(20, 14, { col: 2, row: 2 }, (_m, s) => {
      const regionId = s.region('route', route);
      s.place('guard', creature(s, 'Guard', 'walk', [state('walk', { kind: 'patrol', regionId })]), { col: 6, row: 4 });
    });
    const i = indexOfKey(sim, 'guard');
    const visited: number[] = [];
    for (let t = 0; t < 2400; t++) {
      run(sim, 1);
      for (let k = 0; k < route.length; k++) {
        const c = cellCenter(route[k]![0], route[k]![1]);
        if (Math.hypot(sim.entities.x[i]! - c.x, sim.entities.y[i]! - c.y) < 0.35 && visited[visited.length - 1] !== k) visited.push(k);
      }
    }
    expect(visited.slice(0, 9)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]); // stored order, then round again
  });

  it('[P4A.brain.chase] chase paths to the target and follows it when it moves; [P4A.brain.return-home] return-home paths home and clears the target', () => {
    const sim = stageSim(30, 14, { col: 4, row: 7 }, (_m, s) => {
      const name = creature(s, 'Hound', 'wait', [
        state('wait', { kind: 'idle' }, [go('hunt', [{ type: 'has-target' }])]),
        state('hunt', { kind: 'chase' }, [go('home', [{ type: 'not', of: { type: 'has-target' } }])]),
        state('home', { kind: 'return-home' }, [go('wait', [{ type: 'not', of: { type: 'away-from-home', distance: 0.4 } }])]),
      ]);
      s.place('hound', name, { col: 9, row: 7 }); // inside the sentry archetype's acquisition range of 11
    });
    const e = sim.entities;
    const h = indexOfKey(sim, 'hound');
    run(sim, 10);
    expect(stateOf(sim, 'hound')).toBe('hunt');
    expect(e.target[h]).toBe(e.idAt(0));
    run(sim, 220); // 8.7 world units at the sentry archetype's 3.4 per second
    // It ran to the player and is held off only by their colliders.
    expect(Math.hypot(e.x[h]! - e.x[0]!, e.y[h]! - e.y[0]!)).toBeLessThan(1.2);
    // The player walks away; the hound follows.
    runWith(sim, 120, { move: { x: 0, y: 1 } });
    // The player (4.5 per second) outruns it (3.4) by about 2.2 world units in two seconds.
    expect(Math.hypot(e.x[h]! - e.x[0]!, e.y[h]! - e.y[0]!)).toBeLessThan(3.5);
    expect(distanceHome(sim, h)).toBeGreaterThan(5);
    // The target vanishes: the hound goes home, forgets it, and waits again.
    e.status[0] = STATUS_UNTARGETABLE;
    run(sim, 400);
    expect(stateOf(sim, 'hound')).toBe('wait');
    expect(distanceHome(sim, h)).toBeLessThan(0.4);
    expect(e.target[h]).toBe(-1);
  });

  it('[P4A.brain.flee] flee moves directly away from the target while it is within the distance', () => {
    const sim = stageSim(40, 14, { col: 10, row: 7 }, (_m, s) => {
      const name = creature(s, 'Rabbit', 'graze', [
        state('graze', { kind: 'idle' }, [go('run', [{ type: 'has-target' }])]),
        state('run', { kind: 'flee', distance: 8 }),
      ]);
      s.place('rabbit', name, { col: 14, row: 7 });
    });
    const e = sim.entities;
    const r = indexOfKey(sim, 'rabbit');
    const y0 = e.y[r]!;
    run(sim, 300);
    expect(stateOf(sim, 'rabbit')).toBe('run');
    expect(e.y[r]).toBeCloseTo(y0, 6); // straight away along the line between them
    const gap = e.x[r]! - e.x[0]!;
    expect(gap).toBeGreaterThanOrEqual(8); // and no further than it needs
    expect(gap).toBeLessThan(8.2);
  });

  it('[P4A.events.brain-state] entering a state runs its onEnter actions and raises brain-state-entered', () => {
    const sim = stageSim(
      20,
      10,
      { col: 2, row: 2 },
      (_m, s) => {
        const name = creature(s, 'Announcer', 'quiet', [
          state('quiet', { kind: 'idle' }, [go('loud', [], 100)]),
          state('loud', { kind: 'idle' }, [], [addVar(V.pulses, 1), { type: 'show-message', text: 'Roar!', ms: 500 }]),
        ]);
        s.place('one', name, { col: 10, row: 5 });
        s.place('two', name, { col: 12, row: 5 });
      },
      (p) => {
        p.triggers.push(trigger({ type: 'brain-state-entered', who: { by: 'tag', tag: 'creature' }, state: 'loud' }, [addVar(V.lucky, 1)]));
        p.triggers.push(trigger({ type: 'brain-state-entered', who: { by: 'placement', key: id('placement', 'one') as Id<'placement'> }, state: 'loud' }, [addVar(V.visits, 1)]));
        p.triggers.push(trigger({ type: 'brain-state-entered', who: { by: 'any' }, state: 'quiet' }, [addVar(V.visits, 100)])); // the initial state is not "entered"
      },
    );
    run(sim, 8);
    expect(stateOf(sim, 'one')).toBe('loud');
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky), sim.variables.get(V.visits)]).toEqual([2, 2, 1]);
    expect(presented(sim).filter((x) => x.kind === 'message')).toHaveLength(2);
  });

  it('[P4A.act.set-brain-state] set-brain-state puts matching brains into a named state', () => {
    const sim = stageSim(20, 10, { col: 2, row: 2 }, (_m, s) => {
      const name = creature(s, 'Switch', 'off', [state('off', { kind: 'idle' }), state('on', { kind: 'idle' }, [], [addVar(V.pulses, 1)])]);
      s.place('one', name, { col: 10, row: 5 });
      s.place('two', name, { col: 12, row: 5 });
      s.place('elder', 'Elder', { col: 14, row: 5 });
    });
    sim.executor.run([{ type: 'set-brain-state', target: { by: 'placement', key: id('placement', 'one') as Id<'placement'> }, state: 'on' }], { subject: -1, other: -1 });
    expect([stateOf(sim, 'one'), stateOf(sim, 'two')]).toEqual(['on', 'off']);
    expect(sim.variables.get(V.pulses)).toBe(1); // onEnter ran
    // A state the brain does not have is reported; entities without a brain are skipped.
    sim.executor.run([{ type: 'set-brain-state', target: { by: 'any' }, state: 'on' }], { subject: -1, other: -1 });
    expect([stateOf(sim, 'one'), stateOf(sim, 'two'), stateOf(sim, 'elder')]).toEqual(['on', 'on', 'stand']);
    expect(sim.diagnostics.countOf('brain-state-unknown')).toBe(1);
  });
});

describe('[P4A.brain.leash] leashing is a transition', () => {
  it('the Emberfall sentry chases, gives up when too far from home, and returns to guard', () => {
    // Flat ground, so the chase is a straight run.
    const sim = stageSim(60, 12, { col: 12, row: 6 }, (_m, s) => s.place('sentry', 'Sentry', { col: 6, row: 6 }));
    const e = sim.entities;
    const sentry = indexOfKey(sim, 'sentry');
    run(sim, 12);
    expect(stateOf(sim, 'sentry')).toBe('chase');
    // The player runs east, faster than the sentry; the leash is 16 world units.
    let leashedAt = -1;
    for (let t = 0; t < 1200 && leashedAt < 0; t++) {
      runWith(sim, 1, { move: { x: 1, y: 0 } });
      if (stateOf(sim, 'sentry') === 'return') leashedAt = distanceHome(sim, sentry);
    }
    expect(leashedAt).toBeGreaterThan(8); // it really went after the player
    expect(leashedAt).toBeLessThan(16.5);
    run(sim, 900);
    expect(stateOf(sim, 'sentry')).toBe('guard');
    expect(distanceHome(sim, sentry)).toBeLessThan(0.5);
    expect(e.target[sentry]).toBe(-1);
  });
});

describe('[P4A.emberfall.sentry] Emberfall: the sentry on the plateau', () => {
  const E = EMBERFALL;
  const cell = (c: { col: number; row: number }) => c.row * E.width + c.col;
  /** Emberfall with the player standing below the plateau's south-west corner, in the sentry's view. */
  function below(): Sim {
    const p = buildEmberfall();
    const spot = cellCenter(E.plateau.col + 1, E.plateau.row + E.plateau.h + 3);
    p.maps[0]!.playerStart = { x: spot.x, y: spot.y, facing: 0 };
    return createSim(p, null, OPTS);
  }

  it('spots the player from the cliff edge first, then descends the ramp to chase', () => {
    const sim = below();
    const e = sim.entities;
    const sentry = e.indexOfPlacement(KEYS.sentry);
    expect(e.z[sentry]).toBe(1);
    // The sentry sees down; the player, below and beyond the reveal range, does not see up.
    expect(sim.sight.canSee(sentry, 0)).toBe(true);
    expect(sim.sight.canSee(0, sentry)).toBe(false);
    run(sim, 12);
    expect(sim.brains.stateOf(sentry)).toBe('chase');

    const visited: number[] = [];
    let reached = false;
    for (let t = 0; t < 900 && !reached; t++) {
      run(sim, 1);
      const at = cellOfEntity(sim, sentry);
      if (visited[visited.length - 1] !== at) visited.push(at);
      reached = Math.hypot(e.x[sentry]! - e.x[0]!, e.y[sentry]! - e.y[0]!) < 1.4;
    }
    expect(reached).toBe(true);
    // The only way down is the pair of stacked ramps, top first.
    expect(visited).toContain(cell(E.rampHigh));
    expect(visited).toContain(cell(E.rampLow));
    expect(visited.indexOf(cell(E.rampHigh))).toBeLessThan(visited.indexOf(cell(E.rampLow)));
    expect(e.z[sentry]).toBe(0);
    run(sim, 30);
    expect(sim.brains.stateOf(sentry)).toBe('fight'); // target-within 1.3
  });

  it('a save taken mid-chase resumes to the identical state', () => {
    const p = () => {
      const project = buildEmberfall();
      const spot = cellCenter(E.plateau.col + 1, E.plateau.row + E.plateau.h + 3);
      project.maps[0]!.playerStart = { x: spot.x, y: spot.y, facing: 0 };
      return project;
    };
    const a = createRuntime(p(), null, OPTS);
    const frame = { ...emptyInput(), move: { x: -0.3, y: 0.2 } };
    for (let t = 0; t < 150; t++) a.tick(frame);
    const sentry = 2;
    expect(a.view.entities.brainState(sentry)).toBe('chase');
    const save = a.snapshot();
    // Mid-walk: a path, a goal, a target and a brain state are all in the save.
    const patch = save.maps[save.currentMapId]!.changed[KEYS.sentry]!;
    expect(patch.brain!.state).toBe('chase');
    expect(patch.target!.id).toBe(a.view.entities.id(0));
    expect(patch.path!.waypoints.length).toBeGreaterThan(0);
    const parsed = parseSave(JSON.parse(serializeSave(save)));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const b = createRuntime(p(), parsed.save, OPTS);
    expect(b.view.stateHash()).toBe(a.view.stateHash());
    for (let t = 0; t < 600; t++) {
      a.tick(frame);
      b.tick(frame);
      if (t % 100 === 0) expect(b.view.stateHash(), `tick ${t}`).toBe(a.view.stateHash());
    }
    expect(b.view.stateHash()).toBe(a.view.stateHash());
  });
});

describe('click orders (spec 7.9b)', () => {
  const groundOrder = (x: number, y: number) => ({ order: { kind: 'ground' as const, x, y }, pressed: ROLE_CLICK });
  const entityOrder = (sim: Sim, index: number) => ({ order: { kind: 'entity' as const, entity: sim.entities.idAt(index) }, pressed: ROLE_CLICK });

  it('[P4A.input.player] only an entity with playerControlled receives the input frame', () => {
    const sim = stageSim(20, 10, { col: 5, row: 5 }, (_m, s) => {
      const hero = s.project.archetypes.find((a) => a.name === 'Hero')!.components;
      s.archetype('Double', { ...hero, playerControlled: undefined, persistent: undefined, faction: undefined });
      s.place('double', 'Double', { col: 12, row: 5 });
    });
    const d = indexOfKey(sim, 'double');
    const x = sim.entities.x[d]!;
    runWith(sim, 30, { move: { x: 1, y: 0 } });
    expect(sim.entities.x[0]).toBeGreaterThan(cellCenter(5, 5).x + 2);
    expect(sim.entities.x[d]).toBe(x);
  });

  it('a click on terrain is a move order: path there, and the order ends on arrival', () => {
    const sim = stageSim(24, 12, { col: 3, row: 3 });
    const e = sim.entities;
    const goal = cellCenter(18, 9);
    click(sim, groundOrder(goal.x, goal.y));
    expect(e.orderKind[0]).not.toBe(ORDER_NONE);
    run(sim, 400);
    expect(Math.hypot(e.x[0]! - goal.x, e.y[0]! - goal.y)).toBeLessThan(0.02); // quantized to 1/64
    expect(e.orderKind[0]).toBe(ORDER_NONE);
  });

  it('WASD cancels a click order and takes over at once', () => {
    const sim = stageSim(24, 12, { col: 3, row: 6 });
    const e = sim.entities;
    const goal = cellCenter(20, 6);
    click(sim, groundOrder(goal.x, goal.y), 30);
    expect(e.x[0]).toBeGreaterThan(cellCenter(3, 6).x + 1);
    const x = e.x[0]!;
    const y = e.y[0]!;
    runWith(sim, 20, { move: { x: 0, y: -1 } });
    expect(e.orderKind[0]).toBe(ORDER_NONE);
    expect(e.hasGoal[0]).toBe(0);
    expect(e.x[0]).toBeCloseTo(x, 9); // no longer heading east
    expect(e.y[0]).toBeLessThan(y - 1);
    run(sim, 60);
    expect(e.y[0]).toBeCloseTo(y - 20 * (4.5 / 60), 9); // and it does not resume the old order
  });

  it('an unreachable click stops at the closest reachable point', () => {
    const sim = stageSim(20, 12, { col: 3, row: 6 }, (m: MapPainter) => m.fill({ col: 10, row: 0, w: 10, h: 12 }, T.grass, 3)); // a plateau with no ramp
    const e = sim.entities;
    const goal = cellCenter(14, 6);
    click(sim, groundOrder(goal.x, goal.y));
    run(sim, 400);
    expect(sim.world!.level[cellOfEntity(sim, 0)]).toBe(0);
    expect(cellOfEntity(sim, 0) % 20).toBe(9); // at the foot of the cliff, as near as walking gets
    expect(e.orderKind[0]).toBe(ORDER_NONE);
    const [x, y] = [e.x[0], e.y[0]];
    run(sim, 120);
    expect([e.x[0], e.y[0]]).toEqual([x, y]); // it stays there
  });

  it('a click on a hostile with health is an attack order: clicking an enemy on a plateau routes up the ramp and into range', () => {
    const p = buildEmberfall();
    const E = EMBERFALL;
    // The sentry stands still on the plateau; the player starts on low ground west of the ramps.
    p.maps[0]!.placements[1]!.overrides = { brain: undefined, acquisition: undefined };
    const spot = cellCenter(E.rampLow.col - 4, E.rampLow.row);
    p.maps[0]!.playerStart = { x: spot.x, y: spot.y, facing: 0 };
    const sim = createSim(p, null, OPTS);
    const e = sim.entities;
    const sentry = e.indexOfPlacement(KEYS.sentry);
    click(sim, entityOrder(sim, sentry));
    expect(e.orderKind[0]).toBe(ORDER_ATTACK);
    const visited = new Set<number>();
    for (let t = 0; t < 600; t++) {
      run(sim, 1);
      visited.add(cellOfEntity(sim, 0));
    }
    expect(visited.has(E.rampLow.row * E.width + E.rampLow.col)).toBe(true);
    expect(visited.has(E.rampHigh.row * E.width + E.rampHigh.col)).toBe(true);
    expect(e.z[0]).toBe(1);
    // It closed to attack-primary's range (slash: reach 1.6, plus the target's radius), faced the target,
    // and (since chunk 6) swung once: the sentry lost health and was knocked back a little.
    const d = Math.hypot(e.x[sentry]! - e.x[0]!, e.y[sentry]! - e.y[0]!);
    expect(d).toBeLessThanOrEqual(1.6 + 0.4 + 0.5);
    expect(e.facing[0]).toBeCloseTo(Math.atan2(e.y[sentry]! - e.y[0]!, e.x[sentry]! - e.x[0]!), 1);
    expect(e.hp[sentry]).toBe(30);
    expect(e.orderKind[0]).toBe(ORDER_NONE); // the button was not held: one swing, and the order is done
  });

  it('[P4A.orders.interact] a click on an interactable is a use order: path into its radius, then raise interacted', () => {
    const sim = stageSim(24, 10, { col: 3, row: 5 }, (_m, s) => s.place('elder', 'Elder', { col: 16, row: 5 }, { brain: undefined }), (p) => {
      p.triggers.push(trigger({ type: 'interacted', target: { by: 'placement', key: id('placement', 'elder') as Id<'placement'> } }, [addVar(V.pulses, 1)]));
    });
    const e = sim.entities;
    const elder = indexOfKey(sim, 'elder');
    click(sim, entityOrder(sim, elder));
    run(sim, 400);
    expect(sim.variables.get(V.pulses)).toBe(1); // once
    const d = Math.hypot(e.x[elder]! - e.x[0]!, e.y[elder]! - e.y[0]!);
    expect(d).toBeLessThanOrEqual(1.5 + 1e-6); // the elder's interactable.radius
    expect(d).toBeGreaterThan(1.3); // it stopped as soon as it was inside the radius
    expect(e.orderKind[0]).toBe(ORDER_NONE);
  });

  it('interactable.radius is what the order closes to, and the `act` restriction blocks use', () => {
    const sim = stageSim(24, 10, { col: 3, row: 5 }, (_m, s) => s.place('elder', 'Elder', { col: 16, row: 5 }, { brain: undefined, interactable: { radius: 4, prompt: 'Shout' } }), (p) => {
      p.triggers.push(trigger({ type: 'interacted', target: { by: 'any' } }, [addVar(V.pulses, 1)]));
    });
    const e = sim.entities;
    const elder = indexOfKey(sim, 'elder');
    e.restrict[0] = RESTRICT_ACT;
    click(sim, entityOrder(sim, elder));
    run(sim, 400);
    expect(Math.hypot(e.x[elder]! - e.x[0]!, e.y[elder]! - e.y[0]!)).toBeGreaterThan(3.8);
    expect(sim.variables.get(V.pulses)).toBe(0);
    e.restrict[0] = 0;
    click(sim, entityOrder(sim, elder), 5);
    expect(sim.variables.get(V.pulses)).toBe(1);
  });

  it('the interact key uses the nearest interactable within its radius in the front half-circle', () => {
    const sim = stageSim(24, 10, { col: 10, row: 5 }, (_m, s) => {
      const c = cellCenter(10, 5);
      s.place('ahead', 'Elder', { x: c.x + 1.2, y: c.y }, { brain: undefined });
      s.place('behind', 'Elder', { x: c.x - 0.9, y: c.y }, { brain: undefined }); // nearer, but behind
      s.place('far', 'Elder', { x: c.x + 6, y: c.y }, { brain: undefined });
    }, (p) => {
      for (const [name, v] of [['ahead', V.pulses], ['behind', V.lucky], ['far', V.visits]] as const) {
        p.triggers.push(trigger({ type: 'interacted', target: { by: 'placement', key: id('placement', name) as Id<'placement'> } }, [addVar(v, 1)]));
      }
    });
    const counts = () => [sim.variables.get(V.pulses), sim.variables.get(V.lucky), sim.variables.get(V.visits)];
    click(sim, { pressed: ROLE_INTERACT }, 2); // facing east (0)
    expect(counts()).toEqual([1, 0, 0]);
    sim.entities.facing[0] = Math.PI; // turn round
    click(sim, { pressed: ROLE_INTERACT }, 2);
    expect(counts()).toEqual([1, 1, 0]);
    run(sim, 30); // held is not pressed: nothing repeats
    expect(counts()).toEqual([1, 1, 0]);
  });

  it('[P4A.events.interacted] interacted gives triggers the interactor as subject and the thing used as other: Emberfall\'s elder', () => {
    const p = buildEmberfall();
    const elder = cellCenter(EMBERFALL.elder.col, EMBERFALL.elder.row);
    p.maps[0]!.playerStart = { x: elder.x + 1.1, y: elder.y, facing: Math.PI }; // inside the elder's radius of 1.5, facing them
    p.maps[0]!.triggers.push(
      trigger({ type: 'interacted', target: { by: 'tag', tag: 'villager' } }, [addVar(V.lucky, 100)], {
        given: [{ type: 'alive', who: { by: 'subject' } }, { type: 'in-region', who: { by: 'other' }, regionId: id('region', 'village') as Id<'region'> }],
      }),
    );
    const sim = createSim(p, null, OPTS);
    click(sim, { pressed: ROLE_INTERACT }, 3);
    expect(sim.variables.get(V.talked)).toBe(true);
    expect(presented(sim).filter((x) => x.kind === 'message').map((x) => x.s)).toContain('The plateau sentry sees further than you think.');
    expect(sim.variables.get(V.lucky)).toBeGreaterThanOrEqual(100);
  });

  it('a click on any other entity moves next to it', () => {
    const sim = stageSim(24, 10, { col: 3, row: 5 }, (_m, s) => {
      s.archetype('Crate', { collider: { radius: 0.5, height: 1, solid: true } });
      s.place('crate', 'Crate', { col: 15, row: 5 });
    });
    const e = sim.entities;
    const crate = indexOfKey(sim, 'crate');
    click(sim, entityOrder(sim, crate));
    run(sim, 400);
    const d = Math.hypot(e.x[crate]! - e.x[0]!, e.y[crate]! - e.y[0]!);
    expect(d).toBeLessThanOrEqual(0.35 + 0.5 + 0.2 + 1e-6);
    expect(d).toBeGreaterThanOrEqual(0.35 + 0.5 - 1e-6);
    expect(e.orderKind[0]).toBe(ORDER_NONE);
  });

  it('for every row, hover\'s cursor matches what the click does', () => {
    const project = (): Project => {
      const p = buildEmberfall();
      const sim0 = stageSim(24, 10, { col: 3, row: 5 }, (_m, s) => {
        s.archetype('Crate', { collider: { radius: 0.5, height: 1, solid: true } });
        s.place('enemy', 'Sentry', { col: 12, row: 2 }, { brain: undefined, acquisition: undefined });
        s.place('talker', 'Elder', { col: 12, row: 4 }, { brain: undefined });
        s.place('crate', 'Crate', { col: 12, row: 6 });
        s.place('corpse', 'Sentry', { col: 12, row: 8 }, { brain: undefined, acquisition: undefined });
      });
      void p;
      return sim0.project;
    };
    const expected: [string, 'attack' | 'use' | 'move-to' | 'none', number][] = [
      ['enemy', 'attack', ORDER_ATTACK],
      ['talker', 'use', 3],
      ['crate', 'move-to', 4],
      ['corpse', 'none', ORDER_NONE],
    ];
    for (const [name, action, kind] of expected) {
      const rt = createRuntime(project(), null, OPTS);
      const sim = createSim(project(), null, OPTS);
      const index = indexOfKey(sim, name);
      if (name === 'corpse') {
        sim.entities.flags[index] = sim.entities.flags[index]! | 64; // F_DEAD
      }
      // Hover: the read-only view answers what a click would do ...
      const hover = name === 'corpse' ? 'none' : rt.view.clickAction(rt.view.entities.id(index));
      expect(hover, name).toBe(action);
      // ... and the click does exactly that.
      click(sim, entityOrder(sim, index));
      expect(sim.entities.orderKind[0], name).toBe(kind);
    }
    // Clicking yourself, or a stale id, does nothing.
    const rt = createRuntime(project(), null, OPTS);
    expect(rt.view.clickAction(rt.view.entities.id(0))).toBe('none');
    expect(rt.view.clickAction(999_999)).toBe('none');
  });

  it('an order cancels when its target dies or becomes untargetable', () => {
    const sim = stageSim(30, 10, { col: 3, row: 5 }, (_m, s) => s.place('enemy', 'Sentry', { col: 24, row: 5 }, { brain: undefined, acquisition: undefined }));
    const e = sim.entities;
    const enemy = indexOfKey(sim, 'enemy');
    click(sim, entityOrder(sim, enemy), 30);
    expect(e.orderKind[0]).toBe(ORDER_ATTACK);
    e.status[enemy] = STATUS_UNTARGETABLE;
    run(sim, 2);
    expect(e.orderKind[0]).toBe(ORDER_NONE);
    const x = e.x[0]!;
    run(sim, 60);
    expect(e.x[0]).toBeCloseTo(x, 1); // it stopped walking
    e.status[enemy] = 0;
    click(sim, entityOrder(sim, enemy), 10);
    e.requestDespawn(e.idAt(enemy));
    run(sim, 3);
    expect(e.orderKind[0]).toBe(ORDER_NONE);
  });

  it('an entity order re-paths when the target moves more than 1 world unit', () => {
    const sim = stageSim(40, 16, { col: 3, row: 8 }, (_m, s) => s.place('enemy', 'Sentry', { col: 30, row: 8 }, { brain: undefined, acquisition: undefined }));
    const e = sim.entities;
    const enemy = indexOfKey(sim, 'enemy');
    click(sim, entityOrder(sim, enemy), 30);
    const goal0 = [e.goalX[0], e.goalY[0]];
    sim.place(enemy, e.x[enemy]! - 4, e.y[enemy]! + 6);
    run(sim, 3);
    expect([e.goalX[0], e.goalY[0]]).not.toEqual(goal0);
    expect([e.goalX[0], e.goalY[0]]).toEqual([e.x[enemy], e.y[enemy]]);
    run(sim, 700); // some 40 world units at 4.5 per second
    expect(Math.hypot(e.x[enemy]! - e.x[0]!, e.y[enemy]! - e.y[0]!)).toBeLessThanOrEqual(2.0 + 0.5); // in range, plus the swing's knockback
  });
});
