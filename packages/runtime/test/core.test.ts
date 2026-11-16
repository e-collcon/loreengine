import { describe, expect, it } from 'vitest';
import { EVENT_CASCADE_ROUNDS, EVENT_QUEUE_CAP, Rng, TICK_SLOTS, durationToTicks, hashText, msToTicks, quantizeAim, quantizeInput, quantizeMove } from '../src/index.ts';
import { Diagnostics } from '../src/diagnostics.ts';
import { EntityStore, MAX_ENTITIES, NO_ENTITY } from '../src/entities.ts';
import { EventBus } from '../src/events.ts';
import { PRESENTATION_CAP, PresentationLog } from '../src/presentation.ts';
import { Scope } from '../src/scope.ts';
import { MAX_TIMERS, TimerStore } from '../src/timers.ts';
import { V, addVar, bareSim, presented, run, trigger } from './helpers.ts';

describe('[P2.rng.vectors] xoshiro128** seeded through SplitMix32', () => {
  it('matches the reference output for state (1, 2, 3, 4)', () => {
    const rng = new Rng(0);
    rng.setState([1, 2, 3, 4]);
    const got = Array.from({ length: 10 }, () => rng.nextU32());
    expect(got).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804]);
  });

  it('the same seed gives the same stream; different seeds differ', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 50 }, () => a.nextU32());
    expect(Array.from({ length: 50 }, () => b.nextU32())).toEqual(sa);
    expect(Array.from({ length: 50 }, () => c.nextU32())).not.toEqual(sa);
  });

  it('saves and restores its four-word state exactly', () => {
    const a = new Rng(7);
    for (let i = 0; i < 100; i++) a.nextU32();
    const state = a.getState();
    expect(state).toHaveLength(4);
    for (const word of state) expect(Number.isInteger(word) && word >= 0 && word <= 0xffffffff).toBe(true);
    const b = new Rng(0);
    b.setState(JSON.parse(JSON.stringify(state)));
    for (let i = 0; i < 100; i++) expect(b.nextU32()).toBe(a.nextU32());
  });

  it('never seeds the all-zero state, and floats stay in [0, 1)', () => {
    for (const seed of [0, 1, 0xffffffff, 0x9e3779b9]) {
      const rng = new Rng(seed);
      expect(rng.getState().some((w) => w !== 0)).toBe(true);
      let sum = 0;
      for (let i = 0; i < 5000; i++) {
        const f = rng.nextFloat();
        expect(f >= 0 && f < 1).toBe(true);
        sum += f;
      }
      expect(sum / 5000).toBeGreaterThan(0.45);
      expect(sum / 5000).toBeLessThan(0.55);
      expect(rng.nextInt(6)).toBeLessThan(6);
    }
  });
});

describe('[P2.duration.convert] authored durations become ticks once', () => {
  it('rounds milliseconds to 60 Hz ticks, never erasing a positive duration', () => {
    expect(msToTicks(0)).toBe(0);
    expect(msToTicks(-5)).toBe(0);
    expect(msToTicks(1)).toBe(1);
    expect(msToTicks(16.6667)).toBe(1);
    expect(msToTicks(100)).toBe(6);
    expect(msToTicks(1000)).toBe(60);
    expect(msToTicks(80)).toBe(5);
  });

  it('converts both Duration kinds; turns go through msPerTurn', () => {
    expect(durationToTicks({ kind: 'ms', value: 500 }, 3000)).toBe(30);
    expect(durationToTicks({ kind: 'turns', value: 1 }, 3000)).toBe(180);
    expect(durationToTicks({ kind: 'turns', value: 2 }, 1000)).toBe(120);
    expect(durationToTicks({ kind: 'turns', value: 0 }, 3000)).toBe(0);
  });
});

describe('[P2.input.quantize] input frames are quantized', () => {
  it('snaps move to 1/127 within -1..1 and aim to 1/64', () => {
    expect(quantizeMove(0.5)).toBe(Math.round(0.5 * 127) / 127);
    expect(quantizeMove(7)).toBe(1);
    expect(quantizeMove(-7)).toBe(-1);
    expect(quantizeMove(NaN)).toBe(-1);
    expect(quantizeAim(3.14159)).toBe(Math.round(3.14159 * 64) / 64);
    expect(quantizeAim(Infinity)).toBe(0);
  });

  it('quantizing is idempotent, so a recorded frame replays as itself', () => {
    const frame = { move: { x: 0.33333, y: -0.9 }, aim: { x: 12.3456, y: -7.891 }, order: { kind: 'ground' as const, x: 3.3333, y: 4.4444 }, pressed: 0xff, held: 3 };
    const q = quantizeInput(frame);
    expect(quantizeInput(q)).toEqual(q);
    expect(q.pressed).toBe(0b11111);
    expect(q).not.toBe(frame);
    expect(quantizeInput({ ...frame, aim: null, order: { kind: 'entity', entity: 65541 } })).toMatchObject({ aim: null, order: { kind: 'entity', entity: 65541 } });
  });
});

describe('[P2.entities.handles] generational handles', () => {
  const spawn = (s: EntityStore) => s.spawn(0, {}, -1, 0, 0, 0, 0, '', true);

  it('a stale id after despawn is not alive; reuse bumps the generation', () => {
    const s = new EntityStore();
    const a = spawn(s);
    expect(s.isAlive(a)).toBe(true);
    s.requestDespawn(a);
    expect(s.isAlive(a)).toBe(true); // deferred: still there until the end of the tick
    s.flushDespawns(() => {});
    expect(s.isAlive(a)).toBe(false);
    const b = spawn(s);
    expect(b & 0xffff).toBe(a & 0xffff); // same slot
    expect(b).not.toBe(a);
    expect(b >>> 16).toBe((a >>> 16) + 1);
    expect(s.isAlive(a)).toBe(false);
    expect(s.indexOf(a)).toBe(-1);
    expect(s.isAlive(b)).toBe(true);
  });

  it('always takes the lowest free index, and NO_ENTITY is never alive', () => {
    const s = new EntityStore();
    const ids = [spawn(s), spawn(s), spawn(s), spawn(s)];
    expect(ids.map((i) => i & 0xffff)).toEqual([0, 1, 2, 3]);
    s.requestDespawn(ids[2]!);
    s.requestDespawn(ids[0]!);
    s.requestDespawn(ids[0]!); // twice is harmless
    s.flushDespawns(() => {});
    expect(s.count).toBe(2);
    expect(spawn(s) & 0xffff).toBe(0);
    expect(spawn(s) & 0xffff).toBe(2);
    expect(spawn(s) & 0xffff).toBe(4);
    expect(s.isAlive(NO_ENTITY)).toBe(false);
    expect(s.indexOf(NO_ENTITY)).toBe(-1);
  });

  it('refuses a spawn at the 8,192 cap', () => {
    const s = new EntityStore();
    for (let i = 0; i < MAX_ENTITIES; i++) spawn(s);
    expect(s.count).toBe(8192);
    expect(spawn(s)).toBe(NO_ENTITY);
    s.requestDespawn(s.idAt(100));
    s.flushDespawns(() => {});
    expect(spawn(s) & 0xffff).toBe(100);
  });

  it('restores generations and forced ids exactly', () => {
    const s = new EntityStore();
    const a = spawn(s);
    s.requestDespawn(a);
    s.flushDespawns(() => {});
    const b = spawn(s); // slot 0, generation 1
    const c = spawn(s);
    const t = new EntityStore();
    t.importGenerations(s.exportGenerations());
    expect(t.spawn(0, {}, -1, 0, 0, 0, 0, '', false, c)).toBe(c);
    expect(t.spawn(0, {}, -1, 0, 0, 0, 0, '', false, b)).toBe(b);
    expect(t.spawn(0, {}, -1, 0, 0, 0, 0, '', false, b)).toBe(NO_ENTITY); // slot taken
    expect(spawn(t) & 0xffff).toBe(2);
  });
});

describe('[P2.events.queue] event queue and scopes', () => {
  it('dispatches in raise order to handlers in subscription order', () => {
    const bus = new EventBus(new Diagnostics());
    const scope = new Scope('session');
    const seen: string[] = [];
    bus.subscribe(scope, 'timer-fired', (e) => void seen.push(`first:${e.s}`));
    bus.subscribe(scope, 'timer-fired', (e) => void seen.push(`second:${e.s}`));
    bus.raise('timer-fired', -1, -1, 'a');
    bus.raise('timer-fired', -1, -1, 'b');
    expect(seen).toEqual([]); // queued, not dispatched inline
    bus.dispatch();
    expect(seen).toEqual(['first:a', 'second:a', 'first:b', 'second:b']);
  });

  it('drops the newest event at the 4,096 cap and counts it', () => {
    const d = new Diagnostics();
    const bus = new EventBus(d);
    for (let i = 0; i < EVENT_QUEUE_CAP + 5; i++) bus.raise('timer-fired', -1, -1, String(i));
    expect(bus.queued).toBe(4096);
    expect(d.countOf('event-queue-overflow')).toBe(5);
    const scope = new Scope('session');
    let last = '';
    bus.subscribe(scope, 'timer-fired', (e) => void (last = e.s));
    bus.dispatch();
    expect(last).toBe('4095'); // the five newest were the ones dropped
  });

  it('disposing a scope removes its subscriptions; nothing subscribes without one', () => {
    const bus = new EventBus(new Diagnostics());
    const session = new Scope('session');
    const map = new Scope('map');
    let count = 0;
    bus.subscribe(session, 'map-loaded', () => void count++);
    bus.subscribe(map, 'map-loaded', () => void count++);
    expect(bus.subscriptionCount).toBe(2);
    map.dispose();
    expect(bus.subscriptionCount).toBe(1);
    bus.raise('map-loaded');
    bus.dispatch();
    expect(count).toBe(1);
    expect(() => bus.subscribe(map, 'map-loaded', () => {})).toThrow(/disposed/);
    session.dispose();
    session.dispose(); // twice is safe
    expect(bus.subscriptionCount).toBe(0);
  });

  it('[P2.events.cascade] a trigger that re-raises its own event stops at 8 rounds and resumes next tick', () => {
    const sim = bareSim((p) => {
      // ember_pulses changes -> add 1 to ember_pulses -> changes again ...
      p.triggers.push(trigger({ type: 'variable-changed', variableId: V.pulses }, [addVar(V.pulses, 1)]));
    });
    sim.enqueue({ type: 'test-actions', actions: [addVar(V.pulses, 1)] });
    run(sim, 1);
    // 1 from the command, then one more per dispatch round.
    expect(sim.variables.get(V.pulses)).toBe(1 + EVENT_CASCADE_ROUNDS);
    expect(sim.bus.queued).toBe(1); // the remainder carried over
    expect(sim.diagnostics.countOf('event-cascade-carried')).toBe(1);
    run(sim, 1);
    expect(sim.variables.get(V.pulses)).toBe(1 + 2 * EVENT_CASCADE_ROUNDS);
    expect(sim.diagnostics.countOf('event-cascade-carried')).toBe(2);
  });
});

describe('[P2.events.timer-fired] timers', () => {
  it('fires after its ticks, once, or repeatedly', () => {
    const d = new Diagnostics();
    const bus = new EventBus(d);
    const timers = new TimerStore(bus, d);
    const fired: string[] = [];
    bus.subscribe(new Scope('session'), 'timer-fired', (e) => void fired.push(e.s));
    timers.start('once', 3, false);
    timers.start('loop', 2, true);
    const at: Record<number, string[]> = {};
    for (let t = 1; t <= 7; t++) {
      timers.step();
      bus.dispatch();
      at[t] = fired.splice(0);
    }
    expect(at).toEqual({ 1: [], 2: ['loop'], 3: ['once'], 4: ['loop'], 5: [], 6: ['loop'], 7: [] });
    expect(timers.count).toBe(1);
  });

  it('restarting a timer resets it and keeps its place; the cap is 256', () => {
    const d = new Diagnostics();
    const timers = new TimerStore(new EventBus(d), d);
    timers.start('a', 5, false);
    timers.start('b', 5, false);
    timers.step();
    timers.start('a', 5, false);
    expect(timers.exportSave()).toEqual([
      { id: 'a', ticksLeft: 5, repeatTicks: null },
      { id: 'b', ticksLeft: 4, repeatTicks: null },
    ]);
    for (let i = 0; i < MAX_TIMERS; i++) timers.start(`t${i}`, 9, true);
    expect(timers.count).toBe(MAX_TIMERS);
    expect(d.countOf('timer-cap')).toBe(2);
  });

  it('a trigger listens for one timer id', () => {
    const sim = bareSim((p) => {
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 'mine' }, [addVar(V.pulses, 1)]));
    });
    sim.timers.start('mine', 2, true);
    sim.timers.start('other', 1, true);
    run(sim, 6);
    expect(sim.variables.get(V.pulses)).toBe(3);
  });
});

describe('[P2.presentation.log] presentation events', () => {
  it('each subscriber keeps its own cursor and misses nothing between reads', () => {
    const log = new PresentationLog();
    const a = log.end;
    log.raise('message', -1, -1, 'one', 100);
    log.raise('sfx', -1, -1, 'asset', 1);
    const seen: string[] = [];
    const next = log.since(a, (e) => void seen.push(`${e.seq}:${e.kind}:${e.s}`));
    expect(seen).toEqual(['0:message:one', '1:sfx:asset']);
    log.raise('bgm', -1, -1, '', 500);
    expect(log.since(next, (e) => void seen.push(e.kind))).toBe(3);
    expect(seen[2]).toBe('bgm');
    expect(log.since(3, () => void seen.push('none'))).toBe(3);
    expect(seen).toHaveLength(3);
  });

  it('keeps only the latest 1,024', () => {
    const log = new PresentationLog();
    for (let i = 0; i < PRESENTATION_CAP + 10; i++) log.raise('message', i);
    const firstSeen: number[] = [];
    log.since(0, (e) => void firstSeen.push(e.a));
    expect(firstSeen).toHaveLength(1024);
    expect(firstSeen[0]).toBe(10);
  });

  it('is never read by the simulation: draining it does not change the state hash', () => {
    const sim = bareSim();
    sim.enqueue({ type: 'test-actions', actions: [{ type: 'show-message', text: 'hi', ms: 100 }] });
    run(sim, 3);
    const before = hashText(JSON.stringify(sim.snapshot('', 'playtest')));
    expect(presented(sim).map((e) => e.kind)).toContain('message');
    expect(hashText(JSON.stringify(sim.snapshot('', 'playtest')))).toBe(before);
  });
});

describe('[P2.tick.order] the tick order is fixed', () => {
  it('names the twelve steps of spec 5.4, in order', () => {
    expect([...TICK_SLOTS]).toEqual([
      'commands', 'input', 'brains', 'attack-dodge', 'movement', 'contact',
      'effects', 'health', 'terrain-contact', 'animators', 'timers', 'events',
    ]);
  });

  it('runs every slot once per tick, in that order, with systems inside their slot', () => {
    const order: string[] = [];
    const sim = bareSim(undefined, { onSlot: (slot) => void order.push(slot) });
    for (const slot of [...TICK_SLOTS].reverse()) sim.addSystem(slot, () => void order.push(`sys:${slot}`));
    run(sim, 2);
    const oneTick = TICK_SLOTS.flatMap((slot) => [slot, `sys:${slot}`]);
    expect(order).toEqual([...oneTick, ...oneTick]);
  });

  it('applies commands in step 1, timers in step 11, and dispatch in step 12', () => {
    const sim = bareSim((p) => {
      p.triggers.push(trigger({ type: 'timer-fired', timerId: 't' }, [addVar(V.pulses, 10)]));
    });
    const seen: [string, unknown, number][] = [];
    sim.onSlot = (slot) => void seen.push([slot, sim.variables.get(V.pulses), sim.timers.count]);
    sim.enqueue({ type: 'test-actions', actions: [addVar(V.pulses, 1), { type: 'start-timer', timerId: 't', ms: 1, repeat: false }] });
    run(sim, 1);
    expect(seen.find((s) => s[0] === 'commands')).toEqual(['commands', 0, 0]); // not yet applied when the slot starts
    expect(seen.find((s) => s[0] === 'input')).toEqual(['input', 1, 1]); // applied during step 1
    expect(seen.find((s) => s[0] === 'events')).toEqual(['events', 1, 0]); // timer fired in step 11, not yet dispatched
    expect(sim.variables.get(V.pulses)).toBe(11); // dispatched in step 12
  });

  it('commands apply in enqueue order at the start of the next tick', () => {
    const sim = bareSim();
    sim.enqueue({ type: 'test-actions', actions: [{ type: 'set-variable', variableId: V.pulses, op: { kind: 'set', value: 5 } }] });
    sim.enqueue({ type: 'test-actions', actions: [addVar(V.pulses, 2)] });
    expect(sim.variables.get(V.pulses)).toBe(0);
    run(sim, 1);
    expect(sim.variables.get(V.pulses)).toBe(7);
  });
});
