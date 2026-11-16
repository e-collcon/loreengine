/**
 * Budget gates (spec 9.1, 9.4).
 *
 *   - Zero allocation in the hot paths: movement, collision, castSegment
 *     (and contact, once combat lands). This is a requirement and fails the
 *     build.
 *   - Simulation tick time on the large bench. The 4 ms figure is a target
 *     to verify: this test measures and reports; it does not tune to it.
 *
 * Run with `npx vitest run packages/runtime/test/budget.test.ts --disableConsoleIntercept`
 * to see the measured numbers.
 */
import { describe, expect, it } from 'vitest';
import type { BrainDef, Id } from '@loreengine/schema';
import { emptyInput } from '../src/index.ts';
import type { Sim } from '../src/sim.ts';
import { TERRAIN, cellCenter, id, stageSim } from './helpers.ts';

const T = TERRAIN;
const gc = (globalThis as { gc?: () => void }).gc;
const heap = (): number => process.memoryUsage().heapUsed;

/** A 64 x 64 arena with plateaus, ramps, ponds and rock, and `count` bodies scattered over it. */
function arena(count: number, withBrains: boolean): Sim {
  return stageSim(64, 64, { col: 32, row: 32 }, (m, s) => {
    for (const [col, row] of [[8, 8], [40, 10], [12, 40], [44, 44]] as const) {
      m.fill({ col, row, w: 9, h: 7 }, T.stone, 2);
      m.setRamp(col - 2, row + 3, T.dirt, 0, 1);
      m.setRamp(col - 1, row + 3, T.dirt, 1, 1);
    }
    m.fill({ col: 26, row: 20, w: 5, h: 4 }, T.water, 0);
    m.fill({ col: 30, row: 46, w: 3, h: 3 }, T.rock, 0);
    m.frame({ col: 0, row: 0, w: 64, h: 64 }, T.rock, 0);

    // Health high enough that nobody dies during a bench: the population stays at `count`.
    const body = { collider: { radius: 0.35, height: 1.6, solid: true }, movement: { speed: 4, turnRate: 12, modes: ['walk' as const], startMode: 'walk' as const }, motion: { mass: 1, friction: 12 }, health: { max: 1e9 } };
    const stab = id('attack', 'stab') as Id<'attack'>;
    s.archetype('Body', { ...body, sight: { range: 40, eyeHeight: 1.4 }, attacker: { attackIds: [stab] } });
    if (withBrains) {
      const wander = id('brain', 'bench-wander') as Id<'brain'>;
      const hunt = id('brain', 'bench-hunt') as Id<'brain'>;
      const brains: BrainDef[] = [
        { id: wander, name: 'bench wander', initial: 'roam', states: [{ id: 'roam', behavior: { kind: 'wander', radius: 6 }, onEnter: undefined, transitions: [] }] },
        {
          id: hunt,
          name: 'bench hunt',
          initial: 'look',
          states: [
            { id: 'look', behavior: { kind: 'wander', radius: 4 }, onEnter: undefined, transitions: [{ to: 'chase', when: [{ type: 'has-target' }], afterMs: undefined }] },
            {
              id: 'chase',
              behavior: { kind: 'chase' },
              onEnter: undefined,
              transitions: [
                { to: 'look', when: [{ type: 'not', of: { type: 'has-target' } }], afterMs: 500 },
                { to: 'fight', when: [{ type: 'target-within', distance: 1.3 }], afterMs: undefined },
              ],
            },
            {
              id: 'fight',
              behavior: { kind: 'attack', attackIds: [stab], pick: 'sequence' },
              onEnter: undefined,
              transitions: [{ to: 'chase', when: [{ type: 'not', of: { type: 'target-within', distance: 1.8 } }], afterMs: 300 }],
            },
          ],
        },
      ];
      s.project.brains.push(...brains);
      const [player, hostile] = s.project.factions.map((f) => f.id);
      s.archetype('Wanderer', { ...body, faction: { factionId: player! }, brain: { brainId: wander } });
      s.archetype('Hunter', {
        ...body,
        faction: { factionId: hostile! },
        sight: { range: 10, eyeHeight: 1.4 },
        acquisition: { range: 10, forgetMs: 3000 },
        attacker: { attackIds: [stab] },
        brain: { brainId: hunt },
      });
    }
    // A deterministic scatter over open ground.
    let seed = 99;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let placed = 0;
    while (placed < count) {
      const col = 2 + Math.floor(rnd() * 60);
      const row = 2 + Math.floor(rnd() * 60);
      const i = row * 64 + col;
      if (m.terrain[i] !== T.grass || m.level[i] !== 0) continue;
      const c = cellCenter(col, row);
      const archetype = !withBrains ? 'Body' : placed % 5 === 0 ? 'Hunter' : 'Wanderer';
      s.place(`body-${placed}`, archetype, { x: c.x + (rnd() - 0.5) * 0.8, y: c.y + (rnd() - 0.5) * 0.8 });
      placed++;
    }
  });
}

describe('[P4A.budget.zero-alloc] zero allocation in the hot paths', () => {
  it('movement, collision, separation, castSegment and attack contact allocate nothing over 10,000 ticks', () => {
    if (!gc) throw new Error('the allocation gate needs --expose-gc (see vitest.config.ts)');
    const sim = arena(300, false);
    const e = sim.entities;
    const frame = emptyInput();
    // Precomputed headings, so driving the bodies does not itself allocate.
    const headings = new Float64Array(1024);
    for (let i = 0; i < headings.length; i++) headings[i] = (i * 2.399963) % (Math.PI * 2);
    let casts = 0;
    let hits = 0;
    const stab = sim.combat.indexOf(id('attack', 'stab'));
    const hpBefore = e.hp[1]! * 300;
    const tick = (t: number): void => {
      const end = e.highWater;
      for (let i = 1; i < end; i++) {
        if (e.alive[i] !== 1) continue;
        const h = headings[(i * 7 + (t >> 6)) & 1023]!;
        e.intentX[i] = Math.cos(h);
        e.intentY[i] = Math.sin(h);
        // Now and then a knockback, so sliding along cliffs is exercised too.
        if (((t + i * 13) & 255) === 0) {
          e.vx[i] = Math.cos(h + 1) * 9;
          e.vy[i] = Math.sin(h + 1) * 9;
        }
        // And a swing every few seconds each: contact, onHit, knockback and hitstop.
        if (((t + i * 29) & 127) === 0) sim.combat.start(i, stab, e.x[i]! + Math.cos(h), e.y[i]! + Math.sin(h));
      }
      sim.input.set(frame);
      sim.step();
      // 60 sight casts a tick, with entity hits, and 60 canSee checks.
      for (let k = 0; k < 60; k++) {
        const a = 1 + ((t * 31 + k * 17) % 300);
        const b = 1 + ((t * 53 + k * 29) % 300);
        if (sim.sight.cast(e.x[a]!, e.y[a]!, e.z[a]! + 1.4, e.x[b]!, e.y[b]!, e.z[b]! + 0.8, (k & 1) === 1, a, true) !== 0) hits++;
        if (sim.sight.canSee(a, b)) hits++;
        casts += 2;
      }
    };

    // Spec 9.4: 1,000 warm-up ticks, collect, record, 10,000 ticks, collect, compare.
    for (let t = 0; t < 1000; t++) tick(t);
    gc();
    gc();
    const before = heap();
    for (let t = 1000; t < 11_000; t++) tick(t);
    gc();
    gc();
    const growth = heap() - before;
    console.log(`[bench] zero-alloc: heap growth over 10,000 ticks = ${growth} bytes (gate: < 65,536); ${casts} casts, ${hits} hits`);
    expect(casts).toBe(1_320_000);
    // Every cast toward a body ends on it or on terrain; canSee is true only with a clear line.
    expect(hits).toBeGreaterThan(660_000);
    expect(hits).toBeLessThan(1_320_000);
    expect(growth).toBeLessThan(64 * 1024);

    // Blows landed: the bodies have no faction, so everyone is fair game.
    let hpAfter = 0;
    for (let i = 1; i < e.highWater; i++) hpAfter += e.hp[i]!;
    expect(hpBefore - hpAfter).toBeGreaterThan(8 * 500);
    console.log(`[bench] zero-alloc: ${(hpBefore - hpAfter) / 8} stab hits landed`);
    // The scene really moved: bodies travelled and collided.
    let moved = 0;
    for (let i = 1; i < e.highWater; i++) if (Math.hypot(e.x[i]! - e.homeX[i]!, e.y[i]! - e.homeY[i]!) > 1) moved++;
    expect(moved).toBeGreaterThan(200);
  });

  it('a per-tick allocation would be caught: the same loop with one small retained object per tick fails the gate', () => {
    if (!gc) throw new Error('needs --expose-gc');
    const sim = arena(50, false);
    const frame = emptyInput();
    const leak: object[] = [];
    for (let t = 0; t < 1000; t++) {
      sim.input.set(frame);
      sim.step();
    }
    gc();
    gc();
    const before = heap();
    for (let t = 0; t < 10_000; t++) {
      sim.input.set(frame);
      sim.step();
      leak.push({ t });
    }
    gc();
    gc();
    expect(heap() - before).toBeGreaterThan(64 * 1024);
    expect(leak).toHaveLength(10_000);
  });
});

describe('[P4A.budget.tick-time] simulation tick on the large bench', () => {
  it('300 entities, 60 of them in combat: measures the tick (target 4 ms)', () => {
    const sim = arena(300, true);
    const frame = emptyInput();
    for (let t = 0; t < 600; t++) {
      sim.input.set(frame);
      sim.step();
    }
    const N = 3000;
    const samples = new Float64Array(N);
    for (let t = 0; t < N; t++) {
      const start = performance.now();
      sim.input.set(frame);
      sim.step();
      samples[t] = performance.now() - start;
    }
    const sorted = Array.from(samples).sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / N;
    const p50 = sorted[Math.floor(N * 0.5)]!;
    const p99 = sorted[Math.floor(N * 0.99)]!;
    const max = sorted[N - 1]!;
    const e = sim.entities;
    let hunting = 0;
    let walking = 0;
    let fighting = 0;
    let swings = 0;
    for (let i = 0; i < e.highWater; i++) {
      if (e.alive[i] !== 1) continue;
      if (e.target[i] !== -1) hunting++;
      if (e.pathCount[i]! > 0) walking++;
      if (sim.brains.stateOf(i) === 'fight') fighting++;
    }
    sim.presentation.since(0, (p) => {
      if (p.kind === 'attack-hit') swings++;
    });
    console.log(
      `[bench] tick: mean ${mean.toFixed(3)} ms, p50 ${p50.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${max.toFixed(3)} ms ` +
        `(target 4 ms); ${e.count} entities, ${hunting} with a target, ${fighting} in the fight state, ${walking} walking a path`,
    );
    expect(e.count).toBe(301);
    expect(hunting).toBeGreaterThan(10);
    expect(swings).toBeGreaterThan(0);
    // A sanity bound only: the 4 ms budget is reported, not enforced (kickoff §6).
    expect(mean).toBeLessThan(50);
  });
});
