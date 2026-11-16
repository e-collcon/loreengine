import { describe, expect, it } from 'vitest';
import { ELEVATION, EMPTY_BLOB_ID, buildElevation, cellCenter, id } from '@loreengine/fixtures';
import { parseSave, serializeSave } from '@loreengine/schema';
import type { Action, Id, Project } from '@loreengine/schema';
import { F_PERSISTENT, F_SPAWNED, NO_ENTITY } from '../src/entities.ts';
import { createRuntime, emptyInput } from '../src/index.ts';
import { createSim } from '../src/runtime.ts';
import type { Sim } from '../src/sim.ts';
import { OPTS, V, addVar, presented, run, trigger } from './helpers.ts';

const A = ELEVATION.terraces;
const B = ELEVATION.cellar;
const TERRACES = id('map', 'terraces');
const CELLAR = id('map', 'cellar');
const K = {
  behindCliff: id('placement', 'behind-cliff'),
  plateauEdge: id('placement', 'plateau-edge'),
  onRamp: id('placement', 'on-ramp'),
  guard: id('placement', 'cellar-guard'),
};
const DUMMY = id('archetype', 'dummy');

function elevation(mutate?: (p: Project) => void): Project {
  const p = buildElevation();
  if (mutate) mutate(p);
  return p;
}
const start = (mutate?: (p: Project) => void): Sim => createSim(elevation(mutate), null, OPTS);
const act = (sim: Sim, ...actions: Action[]): void => {
  sim.enqueue({ type: 'test-actions', actions });
  run(sim, 1);
};
const toCellar = (sim: Sim): void => {
  const c = cellCenter(B.arrival.col, B.arrival.row);
  act(sim, { type: 'teleport', target: { by: 'player' }, mapId: CELLAR, x: c.x, y: c.y });
};
const toTerraces = (sim: Sim): void => {
  const c = cellCenter(A.arrival.col, A.arrival.row);
  act(sim, { type: 'teleport', target: { by: 'player' }, mapId: TERRACES, x: c.x, y: c.y });
};
const idx = (sim: Sim, key: string): number => sim.entities.indexOfPlacement(key);

describe('[P3A.lifecycle.player-spawn] spawning the player', () => {
  it('a new session spawns playerArchetypeId at the start map\'s playerStart, as entity 0', () => {
    const sim = start();
    const e = sim.entities;
    const at = cellCenter(A.playerStart.col, A.playerStart.row);
    expect(sim.map!.def.id).toBe(sim.project.startMapId);
    expect(sim.playerIndex()).toBe(0);
    expect(sim.project.archetypes[e.archetype[0]!]!.id).toBe(sim.project.settings.playerArchetypeId);
    expect([e.x[0], e.y[0], e.z[0], e.facing[0]]).toEqual([at.x, at.y, 0, -Math.PI / 2]);
    expect(e.placementKey[0]).toBe(''); // never a placement
    expect(e.flags[0]! & F_PERSISTENT).toBe(F_PERSISTENT);
  });

  it('stands on the surface: a playerStart on the plateau spawns at its height', () => {
    const top = cellCenter(A.plateauEdge.col, A.plateauEdge.row - 2);
    const sim = start((p) => void (p.maps[0]!.playerStart = { x: top.x, y: top.y, facing: 0 }));
    expect(sim.entities.z[0]).toBe(1);
  });

  it('reloading the start map never creates a second player', () => {
    const sim = start();
    const playerId = sim.entities.idAt(0);
    toCellar(sim);
    toTerraces(sim);
    toCellar(sim);
    toTerraces(sim);
    const e = sim.entities;
    let players = 0;
    for (let i = 0; i < e.highWater; i++) if (e.alive[i] === 1 && e.data[i]!.playerControlled) players++;
    expect(players).toBe(1);
    expect(e.idAt(sim.playerIndex())).toBe(playerId);
    expect(e.count).toBe(4); // the player and the three terrace dummies
  });
});

describe('[P3A.lifecycle.placements] loading a map', () => {
  it('spawns each placement from its archetype at its x, y and facing, standing on the surface', () => {
    const sim = start();
    const e = sim.entities;
    const want: [string, { col: number; row: number }, number][] = [
      [K.behindCliff, A.behindCliff, 0],
      [K.plateauEdge, A.plateauEdge, 1], //  level 2
      [K.onRamp, A.onRamp, 0.75], //         halfway up the level 1 -> 2 ramp
    ];
    for (const [key, cell, z] of want) {
      const i = idx(sim, key);
      const c = cellCenter(cell.col, cell.row);
      expect(sim.project.archetypes[e.archetype[i]!]!.id).toBe(DUMMY);
      expect([e.x[i], e.y[i], e.facing[i]]).toEqual([c.x, c.y, Math.PI / 2]);
      expect(e.z[i]).toBeCloseTo(z, 12);
      expect(e.hp[i]).toBe(50);
    }
    expect([idx(sim, K.behindCliff), idx(sim, K.plateauEdge), idx(sim, K.onRamp)]).toEqual([1, 2, 3]); // authored order
  });

  it('placement overrides replace whole components of the archetype', () => {
    const sim = start((p) => {
      p.maps[0]!.placements[1]!.overrides = { health: { max: 500 }, faction: { factionId: p.factions[1]!.id } };
    });
    const tough = idx(sim, K.plateauEdge);
    const plain = idx(sim, K.behindCliff);
    expect(sim.entities.hpMax[tough]).toBe(500);
    expect(sim.entities.faction[tough]).toBe(1);
    expect(sim.entities.data[tough]!.collider).toEqual({ radius: 0.35, height: 1.6, solid: true }); // inherited
    expect(sim.entities.hpMax[plain]).toBe(50);
    expect(sim.entities.faction[plain]).toBe(-1);
    // The archetype itself is untouched (law L7).
    expect(sim.project.archetypes.find((a) => a.id === DUMMY)!.components.health).toEqual({ max: 50 });
  });
});

describe('[P3A.lifecycle.events] map-loaded and map-unloaded', () => {
  it('unload raises map-unloaded before the scope is disposed, so global triggers react; then map-loaded', () => {
    const sim = start((p) => {
      p.triggers.push(trigger({ type: 'map-loaded' }, [addVar(V.pulses, 1)]));
      // On unload, copy the load count: 1 if this ran before the next map-loaded, as it must.
      p.triggers.push(trigger({ type: 'map-unloaded' }, [{ type: 'set-variable', variableId: V.lucky, op: { kind: 'set-from', sourceVariableId: V.pulses } }]));
    });
    run(sim, 1);
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky)]).toEqual([1, 0]);
    toCellar(sim); // the map changes at the end of this tick; its events dispatch on the next
    expect(sim.map!.def.id).toBe(CELLAR);
    run(sim, 1);
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky)]).toEqual([2, 1]);
  });

  it('a map\'s own triggers and timers are released with it', () => {
    const sim = start((p) => {
      p.maps[0]!.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.pulses, 1)]));
    });
    act(sim, { type: 'start-timer', timerId: 't', ms: 1, repeat: true });
    run(sim, 3);
    expect(sim.variables.get(V.pulses)).toBe(4);
    toCellar(sim); // the terraces stay loaded until the end of this tick, so the timer fires once more
    const counted = sim.variables.get(V.pulses) as number;
    expect(counted).toBe(5);
    expect(sim.timers.count).toBe(0); // the map scope owned the timer
    act(sim, { type: 'start-timer', timerId: 't', ms: 1, repeat: true });
    run(sim, 5);
    expect(sim.variables.get(V.pulses)).toBe(counted); // the terraces trigger is no longer subscribed
  });

  it('[P3A.lifecycle.bgm] a map\'s bgm is requested when the map is entered, and again on resume', () => {
    const theme = id('asset', 'cellar-theme') as Id<'asset'>;
    const withMusic = (p: Project): void => {
      p.assets.audio.push({ id: theme, name: 'Cellar theme', ref: { blobId: EMPTY_BLOB_ID, mime: 'audio/wav', byteSize: 0 } });
      p.maps[1]!.bgm = theme;
    };
    const sim = start(withMusic);
    expect(presented(sim).filter((e) => e.kind === 'bgm')).toEqual([]); // the terraces have no music of their own
    toCellar(sim);
    expect(presented(sim).filter((e) => e.kind === 'bgm').map((e) => [e.s, e.n])).toEqual([[theme, 1000]]);
    expect(presented(sim).filter((e) => e.kind === 'map-changed').map((e) => e.s)).toEqual([TERRACES, CELLAR]);
    const resumed = createSim(elevation(withMusic), sim.snapshot('', 'manual'), OPTS);
    expect(presented(resumed).filter((e) => e.kind === 'bgm').map((e) => e.s)).toEqual([theme]);
  });
});

describe('[P3A.lifecycle.persistent] persistent entities travel', () => {
  it('teleport across maps moves the player with its state intact', () => {
    const sim = start();
    const e = sim.entities;
    const playerId = e.idAt(0);
    e.hp[0] = 37;
    toCellar(sim);
    const c = cellCenter(B.arrival.col, B.arrival.row);
    expect(sim.map!.def.id).toBe(CELLAR);
    expect(e.idAt(sim.playerIndex())).toBe(playerId); // the same entity, not a copy
    expect(e.hp[0]).toBe(37);
    expect([e.x[0], e.y[0], e.z[0]]).toEqual([c.x, c.y, 0]);
    expect([e.prevX[0], e.prevY[0]]).toEqual([c.x, c.y]); // no interpolation across a teleport
    expect(idx(sim, K.guard)).toBeGreaterThan(0);
    expect(idx(sim, K.onRamp)).toBe(-1); // the terraces' entities are gone
    expect(sim.world!.width).toBe(B.width);
  });

  it('only entities with the persistent component cross; everything else belongs to its map', () => {
    const sim = start();
    sim.executor.run([{ type: 'teleport', target: { by: 'placement', key: K.onRamp }, mapId: CELLAR, x: 3, y: 3 }], { subject: NO_ENTITY, other: NO_ENTITY });
    run(sim, 1);
    expect(sim.map!.def.id).toBe(TERRACES);
    expect(sim.diagnostics.countOf('teleport-not-persistent')).toBe(1);
  });
});

describe('[P3A.lifecycle.save-delta] what a map remembers', () => {
  /** Change the terraces in every way that should or should not last. */
  function disturb(sim: Sim): void {
    const e = sim.entities;
    act(sim, { type: 'despawn', target: { by: 'placement', key: K.behindCliff } }); // gone
    e.hp[idx(sim, K.plateauEdge)] = 20; //                                              health lasts
    e.x[idx(sim, K.onRamp)] = e.x[idx(sim, K.onRamp)]! + 0.3; //                        position does not
    sim.executor.run([{ type: 'spawn', archetypeId: DUMMY, at: 'subject', count: 2 }], { subject: e.idAt(0), other: NO_ENTITY });
    run(sim, 1);
  }

  it('other maps keep only what lasts: who is gone, health, and spawned survivors', () => {
    const sim = start();
    // The two dummies spawn where the player stands. (Since chunk 5, separation then pushes the
    // player off them, so the reference point is taken before, not after.)
    const spawnedAt = [sim.entities.x[0], sim.entities.y[0]];
    disturb(sim);
    toCellar(sim);
    const delta = sim.mapDeltas.get(TERRACES)!;
    expect([...delta.removed]).toEqual([K.behindCliff]);
    expect([...delta.changed.keys()]).toEqual([K.plateauEdge]); // on-ramp's full health and moved position are not kept
    expect(delta.changed.get(K.plateauEdge)).toEqual({ health: { current: 20, dead: false } });
    expect(delta.spawned).toHaveLength(2);
    expect(delta.spawned[0]!.archetypeId).toBe(DUMMY);
    expect(delta.spawned[0]!.state.id).toBeUndefined();

    toTerraces(sim);
    const e = sim.entities;
    expect(idx(sim, K.behindCliff)).toBe(-1); // still gone
    expect(e.hp[idx(sim, K.plateauEdge)]).toBe(20);
    const ramp = cellCenter(A.onRamp.col, A.onRamp.row);
    expect(e.x[idx(sim, K.onRamp)]).toBe(ramp.x); // back at its placed position
    expect(e.hp[idx(sim, K.onRamp)]).toBe(50);
    const survivors: number[] = [];
    for (let i = 0; i < e.highWater; i++) if (e.alive[i] === 1 && (e.flags[i]! & F_SPAWNED) !== 0) survivors.push(i);
    expect(survivors).toHaveLength(2);
    for (const i of survivors) expect([e.x[i], e.y[i]]).toEqual(spawnedAt);
    expect(delta.spawned).toEqual([]); // moved back into the live map
  });

  it('a save holds the other maps\' deltas sparsely and the current map in full', () => {
    const sim = start();
    disturb(sim);
    toCellar(sim);
    const save = sim.snapshot('', 'manual');
    expect(save.currentMapId).toBe(CELLAR);
    expect(save.maps[TERRACES]!.removed).toEqual([K.behindCliff]);
    expect(save.maps[TERRACES]!.changed).toEqual({ [K.plateauEdge]: { health: { current: 20, dead: false } } });
    expect(save.maps[TERRACES]!.spawned).toHaveLength(2);
    expect(save.maps[CELLAR]!.changed[K.guard]!.id).toBeDefined();
    expect(save.maps[CELLAR]!.changed[K.guard]!.transform).toBeDefined();
    expect(parseSave(JSON.parse(serializeSave(save))).ok).toBe(true);
  });

  it('resuming a save taken on another map and walking back gives the same world as never having saved', () => {
    const a = start();
    disturb(a);
    toCellar(a);
    const parsed = parseSave(JSON.parse(serializeSave(a.snapshot('', 'manual'))));
    if (!parsed.ok) throw new Error('invalid save');
    const b = createSim(elevation(), parsed.save, OPTS);
    const hash = (sim: Sim) => JSON.stringify(sim.snapshot('', 'playtest'));
    expect(hash(b)).toBe(hash(a));
    for (const sim of [a, b]) {
      run(sim, 3);
      toTerraces(sim);
      run(sim, 3);
    }
    expect(hash(b)).toBe(hash(a));
    expect(idx(b, K.behindCliff)).toBe(-1);
    expect(b.entities.hp[idx(b, K.plateauEdge)]).toBe(20);
    expect(b.entities.count).toBe(5); // player, two placed dummies, two spawned survivors
  });

  it('a placement removed on one visit is removed in the save\'s `removed` list of the current map too', () => {
    const rt = createRuntime(elevation(), null, OPTS);
    rt.enqueue({ type: 'test-actions', actions: [{ type: 'despawn', target: { by: 'placement', key: K.onRamp } }] });
    rt.tick(emptyInput());
    const save = rt.snapshot();
    expect(save.maps[TERRACES]!.removed).toEqual([K.onRamp]);
    expect(Object.keys(save.maps[TERRACES]!.changed).sort()).toEqual([K.behindCliff, K.plateauEdge].sort());
    const resumed = createRuntime(elevation(), save, OPTS);
    expect(resumed.view.entities.count).toBe(3);
    expect(resumed.view.stateHash()).toBe(rt.view.stateHash());
  });
});

describe('world actions', () => {
  it('[P3A.act.spawn] spawns `count` entities of an archetype at the subject', () => {
    const sim = start();
    const e = sim.entities;
    const at = idx(sim, K.plateauEdge);
    sim.executor.run([{ type: 'spawn', archetypeId: DUMMY, at: 'subject', count: 3 }], { subject: e.idAt(at), other: NO_ENTITY });
    expect(e.count).toBe(7);
    for (const i of [4, 5, 6]) {
      expect([e.x[i], e.y[i], e.z[i]]).toEqual([e.x[at], e.y[at], 1]);
      expect(e.flags[i]! & F_SPAWNED).toBe(F_SPAWNED);
      expect(e.placementKey[i]).toBe('');
      expect(e.hp[i]).toBe(50);
    }
    sim.executor.run([{ type: 'spawn', archetypeId: DUMMY, at: 'subject', count: 1 }], { subject: NO_ENTITY, other: NO_ENTITY });
    expect(e.count).toBe(7);
    expect(sim.diagnostics.countOf('spawn-no-subject')).toBe(1);
  });

  it('[P3A.act.spawn] spawns into a region\'s cells, drawing from the simulation RNG', () => {
    const plateau = id('region', 'plateau') as Id<'region'>;
    const spawnInto = (sim: Sim): [number, number][] => {
      sim.executor.run([{ type: 'spawn', archetypeId: DUMMY, at: plateau, count: 12 }], { subject: NO_ENTITY, other: NO_ENTITY });
      const out: [number, number][] = [];
      for (let i = 4; i < sim.entities.highWater; i++) out.push([sim.entities.x[i]!, sim.entities.y[i]!]);
      return out;
    };
    const a = start();
    const before = a.rng.getState();
    const spots = spawnInto(a);
    expect(spots).toHaveLength(12);
    expect(a.rng.getState()).not.toEqual(before);
    for (const [x, y] of spots) {
      const cell = a.world!.cellAt(x, y);
      expect(a.map!.regionMasks.get(plateau)![cell]).toBe(1);
      expect([x, y]).toEqual([a.world!.centerX(cell), a.world!.centerY(cell)]);
      expect(a.world!.surfaceHeight(x, y)).toBe(1);
    }
    expect(new Set(spots.map((s) => s.join())).size).toBeGreaterThan(3); // spread over the region
    expect(spawnInto(start())).toEqual(spots); // same seed, same places
    // A region of another map, and an empty one, spawn nothing and say so.
    a.executor.run([{ type: 'spawn', archetypeId: DUMMY, at: id('region', 'stairs') as Id<'region'>, count: 1 }], { subject: NO_ENTITY, other: NO_ENTITY });
    expect(a.diagnostics.countOf('spawn-no-region')).toBe(1);
    expect(a.entities.count).toBe(16);
  });

  it('[P3A.events.entity-spawned] every runtime spawn raises entity-spawned with the new entity as subject', () => {
    const sim = start((p) => {
      p.triggers.push(trigger({ type: 'entity-spawned', who: { by: 'archetype', archetypeId: DUMMY as Id<'archetype'> } }, [addVar(V.pulses, 1)]));
      p.triggers.push(trigger({ type: 'entity-spawned', who: { by: 'player' } }, [addVar(V.lucky, 1)]));
      p.triggers.push(trigger({ type: 'entity-spawned', who: { by: 'any' } }, [addVar(V.visits, 1)], { given: [{ type: 'alive', who: { by: 'subject' } }] }));
    });
    run(sim, 1);
    // The player's first spawn counts; placements at map load do not.
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky), sim.variables.get(V.visits)]).toEqual([0, 1, 1]);
    sim.executor.run([{ type: 'spawn', archetypeId: DUMMY, at: 'subject', count: 2 }], { subject: sim.entities.idAt(0), other: NO_ENTITY });
    run(sim, 1);
    expect([sim.variables.get(V.pulses), sim.variables.get(V.lucky), sim.variables.get(V.visits)]).toEqual([2, 1, 3]);
  });

  it('spawning stops at the 8,192 entity cap with a diagnostic', () => {
    const sim = start();
    sim.executor.run([{ type: 'spawn', archetypeId: DUMMY, at: 'subject', count: 9000 }], { subject: sim.entities.idAt(0), other: NO_ENTITY });
    expect(sim.entities.count).toBe(8192);
    expect(sim.diagnostics.countOf('entity-cap')).toBe(9000 - (8192 - 4));
    expect(sim.diagnostics.countOf('event-queue-overflow')).toBeGreaterThan(0); // 8,188 spawn events into a 4,096 queue
  });

  it('[P3A.act.despawn] removes its targets at the end of the tick; their ids go stale', () => {
    const sim = start();
    const e = sim.entities;
    const victim = e.idAt(idx(sim, K.onRamp));
    sim.executor.run([{ type: 'despawn', target: { by: 'archetype', archetypeId: DUMMY as Id<'archetype'> } }], { subject: NO_ENTITY, other: NO_ENTITY });
    expect(e.count).toBe(4); // deferred: nothing changes under a system mid-tick
    expect(e.isAlive(victim)).toBe(true);
    run(sim, 1);
    expect(e.count).toBe(1);
    expect(e.isAlive(victim)).toBe(false);
    expect([...sim.mapDeltas.get(TERRACES)!.removed].sort()).toEqual([K.behindCliff, K.onRamp, K.plateauEdge].sort());
    // The freed slots are reused, with a bumped generation.
    sim.executor.run([{ type: 'spawn', archetypeId: DUMMY, at: 'subject', count: 1 }], { subject: e.idAt(0), other: NO_ENTITY });
    expect(e.idAt(1)).toBe(65536 + 1);
  });

  it('[P3A.act.teleport] within a map moves at once, onto the surface, without interpolation', () => {
    const sim = start();
    const e = sim.entities;
    const top = cellCenter(A.plateauEdge.col, A.plateauEdge.row - 1);
    sim.executor.run([{ type: 'teleport', target: { by: 'player' }, mapId: TERRACES as Id<'map'>, x: top.x, y: top.y }], { subject: NO_ENTITY, other: NO_ENTITY });
    expect([e.x[0], e.y[0], e.z[0]]).toEqual([top.x, top.y, 1]);
    expect([e.prevX[0], e.prevY[0], e.prevZ[0]]).toEqual([top.x, top.y, 1]);
    expect(presented(sim).filter((p) => p.kind === 'teleported').map((p) => p.a)).toEqual([e.idAt(0)]);
    expect(sim.map!.def.id).toBe(TERRACES);
    // Any entity can be moved within its map.
    sim.executor.run([{ type: 'teleport', target: { by: 'placement', key: K.behindCliff }, mapId: TERRACES as Id<'map'>, x: 1, y: 0 }], { subject: NO_ENTITY, other: NO_ENTITY });
    expect(e.x[idx(sim, K.behindCliff)]).toBe(1);
  });

  it('[P3A.act.teleport] across maps is deferred to the end of the tick', () => {
    const sim = start();
    const seen: string[] = [];
    sim.onSlot = (slot) => {
      if (slot === 'events' || slot === 'input') seen.push(`${slot}:${sim.map!.def.name}`);
    };
    toCellar(sim);
    expect(seen).toEqual(['input:Terraces', 'events:Terraces']); // still on the old map throughout the tick
    expect(sim.map!.def.name).toBe('Cellar');
    expect(sim.pendingMapChange).toBeNull();
  });
});

describe('[P3A.lifecycle.leak] lifecycle leak gate', () => {
  it('100 load and unload cycles return entities, subscriptions, and timers to baseline; heap within 5%', () => {
    const sim = start((p) => {
      p.triggers.push(trigger({ type: 'map-loaded' }, [{ type: 'start-timer', timerId: 'beat', ms: 50, repeat: true }]));
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 'beat' }, [addVar(V.pulses, 1)]));
      p.maps[0]!.triggers.push(trigger({ type: 'timer-fired', timerId: 'beat' }, [addVar(V.lucky, 1)]));
      p.maps[1]!.triggers.push(trigger({ type: 'timer-fired', timerId: 'beat' }, [addVar(V.visits, 1)]));
    });
    const stats = (): number[] => [sim.entities.count, sim.bus.subscriptionCount, sim.timers.count, sim.bus.queued, sim.entities.highWater];
    const cycle = (): void => {
      // Spawn something on each map and remove it again, so every cycle does real work.
      sim.executor.run([{ type: 'spawn', archetypeId: DUMMY, at: 'subject', count: 5 }], { subject: sim.entities.idAt(0), other: NO_ENTITY });
      run(sim, 4);
      sim.executor.run([{ type: 'despawn', target: { by: 'archetype', archetypeId: DUMMY as Id<'archetype'> } }], { subject: NO_ENTITY, other: NO_ENTITY });
      toCellar(sim);
      run(sim, 4);
      toTerraces(sim);
      run(sim, 4);
    };
    const gc = (globalThis as { gc?: () => void }).gc;
    cycle();
    cycle();
    const baseline = stats();
    gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100; i++) cycle();
    expect(stats()).toEqual(baseline);
    expect(sim.map!.def.id).toBe(TERRACES);
    if (gc) {
      gc();
      const growth = (process.memoryUsage().heapUsed - heapBefore) / heapBefore;
      expect(growth).toBeLessThan(0.05);
    } else {
      throw new Error('the leak gate needs --expose-gc (see vitest.config.ts)');
    }
    sim.dispose();
    expect([sim.entities.count, sim.bus.subscriptionCount, sim.timers.count]).toEqual([0, 0, 0]);
  });
});
