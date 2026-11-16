import { describe, expect, it } from 'vitest';
import { buildEmberfall } from '@loreengine/fixtures';
import { parseSave, serializeProject, serializeSave } from '@loreengine/schema';
import type { SaveState } from '@loreengine/schema';
import { createRuntime, emptyInput } from '../src/index.ts';
import type { Runtime } from '../src/index.ts';
import { KEYS, OPTS, V, addVar, bareProject, id, setVar, trigger } from './helpers.ts';

const tick = (rt: Runtime, n: number): void => {
  const frame = emptyInput();
  for (let i = 0; i < n; i++) rt.tick(frame);
};
const roundTrip = (save: SaveState): SaveState => {
  const parsed = parseSave(JSON.parse(serializeSave(save)));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.save;
};

describe('[P2.clock.stepped] stepped mode: the turn-based seam', () => {
  it('no tick advances without a requested step; requestSteps(3) advances exactly three', () => {
    const rt = createRuntime(bareProject(), null, { seed: 1, clockMode: 'stepped' });
    tick(rt, 10);
    expect(rt.view.tick).toBe(0);
    rt.requestSteps(3);
    expect(rt.view.pendingSteps).toBe(3);
    tick(rt, 10);
    expect(rt.view.tick).toBe(3);
    expect(rt.view.pendingSteps).toBe(0);
    rt.requestSteps(1);
    rt.requestSteps(1);
    tick(rt, 1);
    expect(rt.view.tick).toBe(4);
    tick(rt, 5);
    expect(rt.view.tick).toBe(5);
  });

  it('a stepped tick is a whole tick: timers and triggers run', () => {
    const rt = createRuntime(
      bareProject((p) => {
        p.triggers.push(trigger({ type: 'map-loaded' }, [{ type: 'start-timer', timerId: 't', ms: 1, repeat: true }]));
        p.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.pulses, 1)]));
      }),
      null,
      { seed: 1, clockMode: 'stepped' },
    );
    rt.requestSteps(4);
    tick(rt, 100);
    expect(rt.view.variable(V.pulses)).toBe(3); // tick 1 starts the timer; ticks 2..4 fire it
  });

  it('continuous mode advances on every tick and ignores requestSteps', () => {
    const rt = createRuntime(bareProject(), null, OPTS);
    rt.requestSteps(5);
    tick(rt, 7);
    expect(rt.view.tick).toBe(7);
    expect(rt.view.pendingSteps).toBe(0);
    expect(rt.view.diagnostics.countOf('steps-in-continuous-mode')).toBe(1);
  });

  it('commands wait in stepped mode until a step runs', () => {
    const rt = createRuntime(bareProject(), null, { seed: 1, clockMode: 'stepped' });
    rt.enqueue({ type: 'test-actions', actions: [setVar(V.pulses, 9)] });
    tick(rt, 3);
    expect(rt.view.variable(V.pulses)).toBe(0);
    rt.requestSteps(1);
    tick(rt, 1);
    expect(rt.view.variable(V.pulses)).toBe(9);
  });
});

describe('[P2.save.header] the save boundary', () => {
  it('a snapshot carries the header, RNG words, tick, and clock mode', () => {
    const project = bareProject();
    const rt = createRuntime(project, null, OPTS);
    tick(rt, 12);
    const save = rt.snapshot({ savedAt: '2026-11-17T01:00:00.000Z', kind: 'manual' });
    expect(save.header).toEqual({
      schemaVersion: 2,
      projectId: project.id,
      contentRevision: project.contentRevision,
      savedAt: '2026-11-17T01:00:00.000Z',
      kind: 'manual',
    });
    expect(save.tick).toBe(12);
    expect(save.clockMode).toBe('continuous');
    expect(save.rng).toHaveLength(4);
    expect(save.currentMapId).toBe(project.startMapId);
    expect(rt.snapshot().header.kind).toBe('playtest');
    expect(parseSave(JSON.parse(serializeSave(save))).ok).toBe(true);
  });

  it('holds only what play changed: no authored data (law L7)', () => {
    const project = buildEmberfall();
    const rt = createRuntime(project, null, OPTS);
    tick(rt, 200);
    const text = serializeSave(rt.snapshot());
    // Names, attack definitions, brains, terrain and layers live in the project only.
    for (const authored of ['Ember Warden', 'windupMs', 'terrainPalette', 'layers', 'stateClips', 'transitions', 'passable', 'moveCost']) {
      expect(text).not.toContain(authored);
    }
    expect(text.length).toBeLessThan(serializeProject(project).length / 10);
  });

  it('the project is untouched by play: byte-identical after 2,000 ticks', () => {
    const project = buildEmberfall();
    const before = serializeProject(project);
    const rt = createRuntime(project, null, OPTS);
    rt.enqueue({ type: 'test-actions', actions: [setVar(V.talked, true)] });
    tick(rt, 2000);
    rt.snapshot();
    expect(serializeProject(project)).toBe(before);
    expect(project.contentRevision).toBe(1);
  });

  it('saves save-scope variables, timers, fired and toggled triggers; session scope stays out', () => {
    const rt = createRuntime(
      bareProject((p) => {
        p.triggers.push(trigger({ type: 'map-loaded' }, [{ type: 'start-timer', timerId: 'beat', ms: 500, repeat: true }], { once: true, name: 'boot' }));
        p.triggers.push(trigger({ type: 'timer-fired', timerId: 'never' }, [], { name: 'toggled' }));
      }),
      null,
      OPTS,
    );
    rt.enqueue({
      type: 'test-actions',
      actions: [setVar(V.pulses, 4), setVar(V.visits, 9), { type: 'set-trigger-enabled', triggerId: id('trigger', 'toggled'), enabled: false }],
    });
    tick(rt, 10);
    const save = rt.snapshot();
    expect(save.variables[V.pulses]).toBe(4);
    expect(V.visits in save.variables).toBe(false);
    expect(save.timers).toEqual([{ id: 'beat', ticksLeft: 21, repeatTicks: 30 }]);
    expect(save.triggers.fired).toEqual([id('trigger', 'boot')]);
    expect(save.triggers.enabled).toEqual({ [id('trigger', 'toggled')]: false });
  });

  it('the current map saves full state per placement; the player travels in `persistent`', () => {
    const project = bareProject();
    const rt = createRuntime(project, null, OPTS);
    tick(rt, 1);
    const save = rt.snapshot();
    expect(save.persistent).toHaveLength(1);
    expect(save.persistent[0]!.archetypeId).toBe(project.settings.playerArchetypeId);
    expect(save.persistent[0]!.state.id).toBe(0);
    expect(save.persistent[0]!.state.health).toEqual({ current: 100, dead: false });
    const map = save.maps[project.startMapId]!;
    expect(Object.keys(map.changed).sort()).toEqual([KEYS.elder, KEYS.sentry, KEYS.warden].sort());
    expect(map.changed[KEYS.warden]!.transform).toBeDefined();
    expect(map.changed[KEYS.warden]!.health).toEqual({ current: 300, dead: false });
    expect(map.changed[KEYS.elder]!.health).toBeUndefined(); // the elder has no health
    expect(map.removed).toEqual([]);
    expect(map.spawned).toEqual([]);
    expect(save.entityGenerations).toEqual([0, 0, 0, 0]);
  });
});

describe('[P2.save.restore] resuming from a save', () => {
  it('rebuilds the same state and raises no events', () => {
    const project = bareProject((p) => {
      p.triggers.push(trigger({ type: 'map-loaded' }, [addVar(V.pulses, 1), { type: 'start-timer', timerId: 'beat', ms: 100, repeat: true }]));
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 'beat' }, [addVar(V.lucky, 1)], { given: [{ type: 'chance', probability: 0.5 }] }));
    });
    const a = createRuntime(project, null, OPTS);
    tick(a, 500);
    const save = roundTrip(a.snapshot());
    const b = createRuntime(project, save, { seed: 999, clockMode: 'stepped' }); // both ignored on resume
    expect(b.view.stateHash()).toBe(a.view.stateHash());
    expect(b.view.tick).toBe(500);
    expect(b.view.clockMode).toBe('continuous');
    expect(b.view.variable(V.pulses)).toBe(1);
    tick(a, 500);
    tick(b, 500);
    expect(b.view.variable(V.pulses)).toBe(1); // map-loaded did not fire again
    expect(b.view.stateHash()).toBe(a.view.stateHash());
    expect(b.view.stats()).toEqual(a.view.stats());
  });

  it('restores entity ids exactly, including freed slots and their generations', () => {
    const project = bareProject();
    const a = createRuntime(project, null, OPTS);
    // Despawn the sentry: its slot (2) is freed and its generation bumped.
    a.enqueue({ type: 'test-actions', actions: [] });
    tick(a, 1);
    const save0 = a.snapshot();
    expect(save0.entityGenerations).toEqual([0, 0, 0, 0]);
    const b = createRuntime(project, roundTrip(save0), OPTS);
    const ids = (rt: Runtime) => Array.from({ length: rt.view.entities.highWater }, (_, i) => (rt.view.entities.alive(i) ? rt.view.entities.id(i) : -1));
    expect(ids(b)).toEqual(ids(a));
    expect(b.view.entities.playerIndex()).toBe(0);
    expect(b.view.entities.placementKey(3)).toBe(KEYS.warden);
  });

  it('refuses a save from another project', () => {
    const a = createRuntime(bareProject(), null, OPTS);
    const save = a.snapshot();
    save.header.projectId = id('project', 'someone-else');
    expect(() => createRuntime(bareProject(), save, OPTS)).toThrow(/belongs to project/);
  });

  it('content changed since the save: loads with a warning, drops and reports what no longer exists', () => {
    const a = createRuntime(bareProject(), null, OPTS);
    a.enqueue({ type: 'test-actions', actions: [setVar(V.pulses, 6)] });
    tick(a, 5);
    const save = roundTrip(a.snapshot());
    const edited = bareProject((p) => {
      p.contentRevision = 2;
      p.maps[0]!.placements = p.maps[0]!.placements.filter((x) => x.key !== KEYS.sentry); // the sentry was deleted
      p.variables = p.variables.filter((x) => x.id !== V.lucky);
    });
    const b = createRuntime(edited, save, OPTS);
    expect(b.view.diagnostics.countOf('save-content-changed')).toBe(1);
    expect(b.view.diagnostics.countOf('save-dropped-placement')).toBe(1);
    expect(b.view.diagnostics.countOf('save-dropped-variable')).toBe(1);
    expect(b.view.variable(V.pulses)).toBe(6);
    expect(b.view.entities.count).toBe(3);
    expect(b.view.tick).toBe(5);
  });

  it('a placement added since the save spawns in a free slot, after the saved entities', () => {
    const a = createRuntime(bareProject(), null, OPTS);
    tick(a, 2);
    const save = roundTrip(a.snapshot());
    const edited = bareProject((p) => {
      const extra = { ...p.maps[0]!.placements[1]!, key: id('placement', 'second-sentry'), x: 30, y: 30 };
      p.maps[0]!.placements.unshift(extra); // authored first, but it must not steal a saved slot
    });
    const b = createRuntime(edited, save, OPTS);
    expect(b.view.entities.count).toBe(5);
    expect(b.view.entities.placementKey(4)).toBe(id('placement', 'second-sentry'));
    expect(b.view.entities.placementKey(1)).toBe(KEYS.elder);
  });

  it('rejects a schema 1 save and a save with unknown fields', () => {
    expect(parseSave({ schemaVersion: 1, player: {} })).toMatchObject({ ok: false, issues: [{ code: 'schema-v1' }] });
    expect(parseSave({ header: { schemaVersion: 1 } })).toMatchObject({ ok: false, issues: [{ code: 'schema-v1' }] });
    expect(parseSave({ header: { schemaVersion: 3 } })).toMatchObject({ ok: false, issues: [{ code: 'newer-version' }] });
    expect(parseSave(null)).toMatchObject({ ok: false, issues: [{ code: 'not-a-save' }] });
    const save = createRuntime(bareProject(), null, OPTS).snapshot() as SaveState & { player?: unknown };
    save.player = { hp: 3 };
    expect(parseSave(save).ok).toBe(false);
  });
});

describe('[P2.runtime.api] the runtime surface', () => {
  it('refuses an invalid project', () => {
    expect(() => createRuntime(bareProject((p) => void (p.maps[0]!.playerStart = undefined)), null, OPTS)).toThrow(/not valid/);
  });

  it('records quantized frames and commands when asked, and replays them to the same hash', () => {
    const project = bareProject((p) => {
      p.triggers.push(trigger({ type: 'variable-changed', variableId: V.pulses }, [addVar(V.lucky, 1)], { given: [{ type: 'chance', probability: 0.5 }] }));
    });
    const a = createRuntime(project, null, { ...OPTS, record: true });
    for (let i = 0; i < 300; i++) {
      if (i % 37 === 0) a.enqueue({ type: 'test-actions', actions: [addVar(V.pulses, 1)] });
      a.tick({ move: { x: Math.sin(i), y: Math.cos(i) }, aim: { x: i * 0.123, y: 2 }, order: null, pressed: i % 5 === 0 ? 2 : 0, held: 0 });
    }
    const rec = a.recording()!;
    expect(rec.frames).toHaveLength(300);
    expect(rec.commands).toHaveLength(9);
    expect(rec.commands[1]!.frame).toBe(37);
    expect(rec.frames[3]!.move.x).toBe(Math.round(Math.sin(3) * 127) / 127);
    expect(createRuntime(project, null, OPTS).recording()).toBeNull();

    const b = createRuntime(project, null, { seed: rec.seed, clockMode: rec.clockMode });
    let next = 0;
    rec.frames.forEach((frame, i) => {
      while (next < rec.commands.length && rec.commands[next]!.frame === i) b.enqueue(rec.commands[next++]!.command);
      b.tick(frame);
    });
    expect(b.view.stateHash()).toBe(a.view.stateHash());
  });

  it('the view exposes no way to change the simulation', () => {
    const rt = createRuntime(bareProject(), null, OPTS);
    const names = (o: object): string[] => Object.keys(o).sort();
    expect(names(rt.view)).toEqual(
      ['clockMode', 'currentMapId', 'diagnostics', 'entities', 'outcome', 'pendingSteps', 'presentation', 'project', 'stateHash', 'stats', 'tick', 'variable'].sort(),
    );
    for (const key of [...names(rt.view), ...names(rt.view.entities), ...names(rt.view.presentation), ...names(rt.view.diagnostics)]) {
      expect(key).not.toMatch(/^(set|spawn|despawn|enqueue|step|apply|raise|dispose|restore|write|push)/);
    }
    const before = rt.view.stateHash();
    rt.view.entities.x(0);
    rt.view.presentation.since(0, () => {});
    rt.view.stats();
    expect(rt.view.stateHash()).toBe(before);
    expect(() => {
      (rt.view as { tick: number }).tick = 99;
    }).toThrow();
  });

  it('a disposed runtime releases everything and refuses further use', () => {
    const rt = createRuntime(buildEmberfall(), null, OPTS);
    tick(rt, 10);
    expect(rt.view.stats().subscriptions).toBeGreaterThan(0);
    rt.dispose();
    expect(rt.view.stats()).toEqual({ entities: 0, subscriptions: 0, timers: 0, queuedEvents: 0 });
    expect(() => rt.tick(emptyInput())).toThrow(/disposed/);
    expect(() => rt.snapshot()).toThrow(/disposed/);
    rt.dispose(); // twice is safe
  });
});
