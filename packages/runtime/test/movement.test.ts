import { describe, expect, it } from 'vitest';
import { ELEVATION, buildElevation } from '@loreengine/fixtures';
import { RESTRICT_MOVE } from '../src/entities.ts';
import { createSim } from '../src/runtime.ts';
import type { Sim } from '../src/sim.ts';
import { MODE_FLY, MODE_SWIM, MODE_WALK } from '../src/world.ts';
import { OPTS, TERRAIN, V, addVar, cellCenter, cellOfEntity, id, indexOfKey, run, runWith, stageSim, trigger } from './helpers.ts';

const T = TERRAIN;
const HERO_SPEED = 4.5;
const STEP = HERO_SPEED / 60;
const APOTHEM = Math.sqrt(3) / 2;

/** Push an entity with a knockback velocity and let it come to rest. */
function knock(sim: Sim, index: number, vx: number, vy: number, ticks = 40): void {
  sim.entities.vx[index] = vx;
  sim.entities.vy[index] = vy;
  run(sim, ticks);
}

describe('[P4A.movement.speed] intent becomes velocity at movement.speed', () => {
  it('moves speed / 60 world units per tick along the intent', () => {
    const sim = stageSim(20, 10, { col: 5, row: 5 });
    const e = sim.entities;
    const x0 = e.x[0]!;
    runWith(sim, 30, { move: { x: 1, y: 0 } });
    expect(e.x[0]! - x0).toBeCloseTo(30 * STEP, 9);
    expect(e.y[0]).toBeCloseTo(cellCenter(5, 5).y, 12);
    // prev* hold the previous tick's position, for interpolation.
    expect(e.x[0]! - e.prevX[0]!).toBeCloseTo(STEP, 9);
  });

  it('a diagonal is not faster, and an over-long intent is clamped to full speed', () => {
    const sim = stageSim(20, 12, { col: 8, row: 6 });
    const e = sim.entities;
    const [x0, y0] = [e.x[0]!, e.y[0]!];
    runWith(sim, 10, { move: { x: 1, y: 1 } }); // the mapper normalizes; the runtime clamps too
    expect(Math.hypot(e.x[0]! - x0, e.y[0]! - y0)).toBeCloseTo(10 * STEP, 9);
    const half = stageSim(20, 12, { col: 8, row: 6 });
    runWith(half, 10, { move: { x: 0.5, y: 0 } });
    expect(half.entities.x[0]! - x0).toBeCloseTo(5 * STEP, 2); // quantized to 1/127
  });

  it('is scaled by speedScale, and zero while restricted from moving or in hitstop', () => {
    const sim = stageSim(20, 10, { col: 5, row: 5 });
    const e = sim.entities;
    let x = e.x[0]!;
    e.speedScale[0] = 0.4; // an attack marked `slowed`
    runWith(sim, 10, { move: { x: 1, y: 0 } });
    expect(e.x[0]! - x).toBeCloseTo(10 * STEP * 0.4, 9);
    e.speedScale[0] = 1;
    x = e.x[0]!;
    e.restrict[0] = RESTRICT_MOVE;
    runWith(sim, 10, { move: { x: 1, y: 0 } });
    expect(e.x[0]).toBe(x);
    e.restrict[0] = 0;
    e.hitstop[0] = 1_000_000;
    e.vx[0] = 5; // knockback waits out hitstop too
    runWith(sim, 10, { move: { x: 1, y: 0 } });
    expect(e.x[0]).toBe(x);
    expect(e.vx[0]).toBe(5);
  });

  it('an entity with no movement component ignores intent', () => {
    const sim = stageSim(20, 10, { col: 5, row: 5 }, (_m, s) => {
      s.archetype('Statue', { collider: { radius: 0.4, height: 2, solid: true } });
      s.place('statue', 'Statue', { col: 10, row: 5 });
    });
    const i = indexOfKey(sim, 'statue');
    const x = sim.entities.x[i]!;
    sim.entities.intentX[i] = 1;
    run(sim, 10);
    expect(sim.entities.x[i]).toBe(x);
  });
});

describe('[P4A.movement.turn-rate] facing', () => {
  it('turns toward movement at most turnRate / 60 radians per tick', () => {
    const sim = stageSim(20, 10, { col: 5, row: 5 });
    const e = sim.entities; // the hero's turnRate is 12 rad/s = 0.2 rad per tick
    expect(e.facing[0]).toBe(0);
    runWith(sim, 1, { move: { x: 0, y: 1 } }); // wants to face +pi/2
    expect(e.facing[0]).toBeCloseTo(0.2, 9);
    runWith(sim, 3, { move: { x: 0, y: 1 } });
    expect(e.facing[0]).toBeCloseTo(0.8, 9);
    runWith(sim, 10, { move: { x: 0, y: 1 } });
    expect(e.facing[0]).toBeCloseTo(Math.PI / 2, 9); // arrives and stops turning
  });

  it('turns toward the aim point when there is one, and takes the short way round', () => {
    const sim = stageSim(20, 10, { col: 5, row: 5 });
    const e = sim.entities;
    // Aim behind and slightly up-screen: the short way from 0 is through negative angles.
    runWith(sim, 1, { move: { x: 1, y: 0 }, aim: { x: e.x[0]! - 5, y: e.y[0]! - 0.5 } });
    expect(e.facing[0]).toBeCloseTo(-0.2, 9);
    runWith(sim, 30, { aim: { x: e.x[0]! - 5, y: e.y[0]! - 0.5 } }); // aiming turns even while standing still
    expect(e.facing[0]).toBeCloseTo(Math.atan2(-0.5, -5), 3); // the aim point is quantized to 1/64
  });
});

describe('[P4A.movement.modes] movement modes', () => {
  const build = (modes: ('walk' | 'swim' | 'fly')[], startMode: 'walk' | 'swim' | 'fly') =>
    stageSim(16, 5, { col: 1, row: 2 }, (m, s) => {
      m.fill({ col: 5, row: 0, w: 3, h: 5 }, T.water, 0); //  a river across the map
      m.fill({ col: 10, row: 0, w: 1, h: 5 }, T.grass, 3); // a wall of cliffs
      m.fill({ col: 13, row: 0, w: 1, h: 5 }, T.rock, 0); //  rock: nothing passes, not even flyers
      const mover = s.archetype('Mover', { collider: { radius: 0.3, height: 1, solid: true }, movement: { speed: 6, turnRate: 12, modes, startMode } });
      void mover;
      s.place('mover', 'Mover', startMode === 'swim' ? { col: 6, row: 2 } : { col: 2, row: 2 });
    });
  const pushEast = (sim: Sim, ticks: number): number => {
    const i = indexOfKey(sim, 'mover');
    for (let t = 0; t < ticks; t++) {
      sim.entities.intentX[i] = 1;
      run(sim, 1);
    }
    return i;
  };

  it('a walker stops at water and never enters it', () => {
    const sim = build(['walk'], 'walk');
    const i = pushEast(sim, 200);
    expect(sim.entities.mode[i]).toBe(MODE_WALK);
    expect(cellOfEntity(sim, i) % 16).toBe(4); // the last grass column before the river
    expect(sim.entities.x[i]).toBeLessThan(cellCenter(4, 2).x + APOTHEM - 0.3 + 1e-6); // its collider stays on the bank
  });

  it('a swimmer moves through water and stops at the bank', () => {
    const sim = build(['swim'], 'swim');
    const i = pushEast(sim, 200);
    expect(sim.entities.mode[i]).toBe(MODE_SWIM);
    expect(cellOfEntity(sim, i) % 16).toBe(7); // the last water column
    expect(sim.entities.z[i]).toBe(0); // the water surface is the cell's level
  });

  it('a flyer crosses water and cliffs, holding two levels above the surface, and stops at rock', () => {
    const sim = build(['fly'], 'fly');
    const i = indexOfKey(sim, 'mover');
    expect(sim.entities.mode[i]).toBe(MODE_FLY);
    run(sim, 1);
    expect(sim.entities.z[i]).toBe(1); // two levels of 0.5 above level 0
    const seen = new Set<number>();
    for (let t = 0; t < 400; t++) {
      sim.entities.intentX[i] = 1;
      run(sim, 1);
      seen.add(cellOfEntity(sim, i) % 16);
      if (cellOfEntity(sim, i) % 16 === 10) expect(sim.entities.z[i]).toBe(2.5); // over the level-3 cliff
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(cellOfEntity(sim, i) % 16).toBe(12);
  });
});

describe('[P4A.collision.circles] collision', () => {
  it('the collider circle stops `radius` short of a blocked edge and slides along it', () => {
    // A cliff wall along the east; walk into it diagonally.
    const sim = stageSim(12, 12, { col: 4, row: 4 }, (m) => m.fill({ col: 7, row: 0, w: 5, h: 12 }, T.grass, 2));
    const e = sim.entities;
    const y0 = e.y[0]!;
    runWith(sim, 240, { move: { x: 1, y: 0.4 } });
    const cell = cellOfEntity(sim, 0);
    expect(sim.world!.level[cell]).toBe(0); // never up the cliff
    // It slid south along the cliff's edge until the zigzag of hex edges held it in a notch.
    expect(e.y[0]! - y0).toBeGreaterThan(0.8);
    expect(e.x[0]).toBeGreaterThan(cellCenter(6, 4).x - 0.6); // and it is up against the wall
    // Its circle touches no blocked edge of the cell it stands on.
    for (let d = 0; d < 6; d++) {
      if (sim.world!.linked(cell, d + 1, MODE_WALK)) continue;
      const cx = sim.world!.centerX(cell);
      const cy = sim.world!.centerY(cell);
      const ax = cx + sim.world!.edgeAX[d]!;
      const ay = cy + sim.world!.edgeAY[d]!;
      const bx = cx + sim.world!.edgeBX[d]!;
      const by = cy + sim.world!.edgeBY[d]!;
      const t = Math.max(0, Math.min(1, ((e.x[0]! - ax) * (bx - ax) + (e.y[0]! - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      expect(Math.hypot(e.x[0]! - (ax + (bx - ax) * t), e.y[0]! - (ay + (by - ay) * t))).toBeGreaterThanOrEqual(0.35 - 1e-6);
    }
  });

  it('the map border is a wall', () => {
    const sim = stageSim(6, 6, { col: 1, row: 1 });
    runWith(sim, 120, { move: { x: -1, y: -1 } });
    expect(cellOfEntity(sim, 0)).toBe(0);
    expect(sim.entities.x[0]).toBeGreaterThan(-APOTHEM + 0.34);
    expect(sim.entities.y[0]).toBeGreaterThan(-1 + 0.3);
  });

  it('walkers always stand on the surface: z follows a ramp continuously', () => {
    const p = buildElevation();
    const A = ELEVATION.terraces;
    const start = cellCenter(A.rampLow.col - 2, A.rampLow.row);
    p.maps[0]!.playerStart = { x: start.x, y: start.y, facing: 0 };
    p.maps[0]!.placements = [];
    const sim = createSim(p, null, OPTS);
    const e = sim.entities;
    let last = 0;
    let top = 0;
    for (let t = 0; t < 140; t++) {
      runWith(sim, 1, { move: { x: 1, y: 0 } });
      expect(e.z[0]).toBe(sim.world!.surfaceHeight(e.x[0]!, e.y[0]!));
      expect(e.z[0]! - last).toBeGreaterThanOrEqual(0);
      expect(e.z[0]! - last).toBeLessThan(0.03); // no step anywhere on the way up
      last = e.z[0]!;
      top = Math.max(top, e.z[0]!);
    }
    expect(top).toBe(1); // up both stacked ramps onto the level-2 plateau
  });

  it('overlapping solid colliders are pushed apart, weighted by mass', () => {
    const sim = stageSim(20, 10, { col: 3, row: 3 }, (_m, s) => {
      const body = (mass: number) => ({ collider: { radius: 0.5, height: 1.5, solid: true }, motion: { mass, friction: 12 } });
      s.archetype('Light', body(1));
      s.archetype('Heavy', body(3));
      const c = cellCenter(10, 5);
      s.place('light', 'Light', { x: c.x - 0.2, y: c.y });
      s.place('heavy', 'Heavy', { x: c.x + 0.2, y: c.y });
    });
    const e = sim.entities;
    const [l, h] = [indexOfKey(sim, 'light'), indexOfKey(sim, 'heavy')];
    const [lx, hx] = [e.x[l]!, e.x[h]!];
    run(sim, 1);
    // Overlap was 1.0 - 0.4 = 0.6: the light one takes 3/4 of it, the heavy one 1/4.
    expect(lx - e.x[l]!).toBeCloseTo(0.45, 9);
    expect(e.x[h]! - hx).toBeCloseTo(0.15, 9);
    expect(e.x[h]! - e.x[l]!).toBeCloseTo(1.0, 9); // exactly apart, in one pass
  });

  it('something with neither movement nor motion is immovable; non-solid colliders are not pushed', () => {
    const sim = stageSim(20, 10, { col: 3, row: 3 }, (_m, s) => {
      s.archetype('Pillar', { collider: { radius: 0.5, height: 2, solid: true } });
      s.archetype('Ghost', { collider: { radius: 0.5, height: 2, solid: false }, motion: { mass: 1, friction: 12 } });
      s.archetype('Crate', { collider: { radius: 0.5, height: 1, solid: true }, motion: { mass: 1, friction: 12 } });
      const c = cellCenter(10, 5);
      s.place('pillar', 'Pillar', c);
      s.place('crate', 'Crate', { x: c.x + 0.4, y: c.y });
      s.place('ghost', 'Ghost', { x: c.x, y: c.y + 0.3 });
    });
    const e = sim.entities;
    const before = ['pillar', 'ghost'].map((n) => [e.x[indexOfKey(sim, n)], e.y[indexOfKey(sim, n)]]);
    run(sim, 1);
    expect(['pillar', 'ghost'].map((n) => [e.x[indexOfKey(sim, n)], e.y[indexOfKey(sim, n)]])).toEqual(before);
    expect(e.x[indexOfKey(sim, 'crate')]! - e.x[indexOfKey(sim, 'pillar')]!).toBeCloseTo(1.0, 9); // the crate took all of it
  });

  it('entities on different levels do not push each other: only overlapping height ranges collide', () => {
    // A flyer hovers one world unit up. A short walker passes under it; a tall one bumps it.
    const sim = stageSim(20, 8, { col: 1, row: 1 }, (_m, s) => {
      s.archetype('Hoverer', { collider: { radius: 0.5, height: 0.5, solid: true }, movement: { speed: 0, turnRate: 0, modes: ['fly'], startMode: 'fly' }, motion: { mass: 1, friction: 12 } });
      s.archetype('Short', { collider: { radius: 0.5, height: 0.8, solid: true }, motion: { mass: 1, friction: 12 } });
      s.archetype('Tall', { collider: { radius: 0.5, height: 1.6, solid: true }, motion: { mass: 1, friction: 12 } });
      const a = cellCenter(6, 4);
      const b = cellCenter(14, 4);
      s.place('over-short', 'Hoverer', a);
      s.place('short', 'Short', { x: a.x + 0.3, y: a.y });
      s.place('over-tall', 'Hoverer', b);
      s.place('tall', 'Tall', { x: b.x + 0.3, y: b.y });
    });
    const e = sim.entities;
    run(sim, 1); // the flyers rise to two levels above the ground
    expect(e.z[indexOfKey(sim, 'over-short')]).toBe(1);
    const gap = (a: string, b: string) => Math.abs(e.x[indexOfKey(sim, a)]! - e.x[indexOfKey(sim, b)]!);
    run(sim, 3);
    expect(gap('over-short', 'short')).toBeCloseTo(0.3, 9); // heights 0..0.8 and 1..1.5: no contact
    expect(gap('over-tall', 'tall')).toBeCloseTo(1.0, 9); //   heights 0..1.6 and 1..1.5: pushed apart
  });

  it('knockback adds to movement, decays by friction, and slides along a cliff instead of crossing it', () => {
    const sim = stageSim(14, 10, { col: 3, row: 5 }, (m) => m.fill({ col: 8, row: 0, w: 6, h: 10 }, T.grass, 2));
    const e = sim.entities;
    const x0 = e.x[0]!;
    e.vx[0] = 6;
    run(sim, 1);
    expect(e.x[0]! - x0).toBeCloseTo(6 / 60, 9);
    expect(e.vx[0]).toBeCloseTo(6 * (1 - 12 / 60), 9); // the hero's friction is 12
    run(sim, 60);
    expect(e.vx[0]).toBe(0); // comes to rest
    knock(sim, 0, 30, 4, 120);
    expect(sim.world!.level[cellOfEntity(sim, 0)]).toBe(0);
    expect(e.y[0]).toBeGreaterThan(cellCenter(3, 5).y); // the tangential part carried on
  });
});

describe('[P4A.cliffs.hold] ★ cliffs hold', () => {
  it('10,000 seeded random knockbacks near plateau edges never carry an entity across a non-connecting edge, and walkers always stand on the surface', () => {
    const p = buildElevation();
    const A = ELEVATION.terraces;
    p.maps[0]!.placements = [];
    p.maps[0]!.triggers = [];
    const sim = createSim(p, null, OPTS);
    const world = sim.world!;
    const e = sim.entities;
    let s = 4242;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    // Spots hugging the plateau's rim (inside and outside), the ramps, and the terrace.
    const spots: [number, number][] = [];
    for (let col = A.plateau.col - 1; col <= A.plateau.col + A.plateau.w + 3; col++) {
      for (let row = A.plateau.row - 1; row <= A.plateau.row + A.plateau.h + 1; row++) {
        const cell = row * A.width + col;
        if (world.passable(cell, MODE_WALK)) spots.push([col, row]);
      }
    }
    let crossings = 0;
    let knocks = 0;
    let levelChanges = 0;
    for (let k = 0; k < 10_000; k++) {
      const [col, row] = spots[Math.floor(rnd() * spots.length)]!;
      const c = cellCenter(col, row);
      sim.place(0, c.x + (rnd() - 0.5) * 0.6, c.y + (rnd() - 0.5) * 0.6);
      const angle = rnd() * Math.PI * 2;
      const strength = 2 + rnd() * 40; // up to 40 units/s: far beyond any authored knockback
      e.vx[0] = Math.cos(angle) * strength;
      e.vy[0] = Math.sin(angle) * strength;
      knocks++;
      let cell = world.cellAt(e.x[0]!, e.y[0]!);
      const startLevel = world.level[cell]!;
      for (let t = 0; t < 12; t++) {
        run(sim, 1);
        const next = world.cellAt(e.x[0]!, e.y[0]!);
        if (next !== cell) {
          if (next < 0 || !world.connects(cell, next, 'walk')) crossings++;
          cell = next;
        }
        if (e.z[0] !== world.surfaceHeight(e.x[0]!, e.y[0]!)) throw new Error(`not on the surface at knock ${k}`);
      }
      if (world.level[cell] !== startLevel) levelChanges++;
    }
    expect(knocks).toBe(10_000);
    expect(crossings).toBe(0);
    // Levels do change, but only by way of the ramps.
    expect(levelChanges).toBeGreaterThan(0);
    expect(levelChanges).toBeLessThan(2000);
  });
});

describe('[P4A.events.region] region events', () => {
  const A = ELEVATION.terraces;
  /** The elevation fixture with a counting trigger pair on the plateau region. */
  const withCounters = () => {
    const p = buildElevation();
    const plateau = id('region', 'plateau');
    p.maps[0]!.placements = [];
    p.maps[0]!.triggers.push(
      trigger({ type: 'region-entered', regionId: plateau, who: { by: 'player' } }, [addVar(V.pulses, 1)]),
      trigger({ type: 'region-exited', regionId: plateau, who: { by: 'player' } }, [addVar(V.lucky, 1)]),
      trigger({ type: 'region-entered', regionId: plateau, who: { by: 'tag', tag: 'dummy' } }, [addVar(V.visits, 1)]),
    );
    const start = cellCenter(A.rampLow.col - 1, A.rampLow.row);
    p.maps[0]!.playerStart = { x: start.x, y: start.y, facing: 0 };
    return createSim(p, null, OPTS);
  };
  const counts = (sim: Sim) => [sim.variables.get(V.pulses), sim.variables.get(V.lucky), sim.variables.get(V.visits)];

  it('walking into a region raises region-entered once; walking out raises region-exited once', () => {
    const sim = withCounters();
    runWith(sim, 100, { move: { x: 1, y: 0 } }); // up the ramps onto the plateau
    expect(sim.world!.level[cellOfEntity(sim, 0)]).toBe(2);
    expect(counts(sim)).toEqual([1, 0, 0]);
    runWith(sim, 60, { move: { x: 1, y: 0 } }); // wandering inside changes nothing
    expect(counts(sim)).toEqual([1, 0, 0]);
    runWith(sim, 200, { move: { x: -1, y: 0 } }); // back down
    expect(counts(sim)).toEqual([1, 1, 0]);
  });

  it('spawning inside a region is not entering it; teleporting in is', () => {
    const sim = withCounters();
    const inside = cellCenter(A.plateau.col + 2, A.plateau.row + 2);
    sim.executor.run([{ type: 'spawn', archetypeId: id('archetype', 'dummy'), at: id('region', 'plateau'), count: 3 }], { subject: -1, other: -1 });
    run(sim, 2);
    expect(counts(sim)).toEqual([0, 0, 0]);
    sim.executor.run([{ type: 'teleport', target: { by: 'player' }, mapId: id('map', 'terraces'), x: inside.x, y: inside.y }], { subject: -1, other: -1 });
    run(sim, 2);
    expect(counts(sim)).toEqual([1, 0, 0]);
    const out = cellCenter(1, 10);
    sim.executor.run([{ type: 'teleport', target: { by: 'player' }, mapId: id('map', 'terraces'), x: out.x, y: out.y }], { subject: -1, other: -1 });
    run(sim, 2);
    expect(counts(sim)).toEqual([1, 1, 0]);
  });

  it('the fixture\'s door: walking into its region teleports the player to the cellar, and the stairs bring them back', () => {
    const p = buildElevation();
    const near = cellCenter(A.door.col - 2, A.door.row);
    p.maps[0]!.playerStart = { x: near.x, y: near.y, facing: 0 };
    const sim = createSim(p, null, OPTS);
    runWith(sim, 60, { move: { x: 1, y: 0 } });
    expect(sim.map!.def.name).toBe('Cellar');
    const arrival = cellCenter(ELEVATION.cellar.arrival.col, ELEVATION.cellar.arrival.row);
    expect(Math.hypot(sim.entities.x[0]! - arrival.x, sim.entities.y[0]! - arrival.y)).toBeLessThan(6);
    // Walk to the stairs in the cellar's corner.
    const stairs = cellCenter(ELEVATION.cellar.stairs.col, ELEVATION.cellar.stairs.row);
    for (let t = 0; t < 400 && sim.map!.def.name === 'Cellar'; t++) {
      const dx = stairs.x - sim.entities.x[0]!;
      const dy = stairs.y - sim.entities.y[0]!;
      const d = Math.hypot(dx, dy) || 1;
      runWith(sim, 1, { move: { x: dx / d, y: dy / d } });
    }
    expect(sim.map!.def.name).toBe('Terraces');
  });
});
