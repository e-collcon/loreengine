import { describe, expect, it } from 'vitest';
import { ELEVATION, EMBERFALL, buildElevation, buildEmberfall } from '@loreengine/fixtures';
import type { Project } from '@loreengine/schema';
import { NO_ENTITY, STATUS_UNTARGETABLE, WAYPOINT_STRIDE } from '../src/entities.ts';
import { ACQUISITION_INTERVAL } from '../src/brains.ts';
import { MAX_PATH_REQUESTS_PER_TICK, REPATH_TICKS } from '../src/pathing.ts';
import { createSim } from '../src/runtime.ts';
import { HIT_ENTITY, HIT_NONE, HIT_TERRAIN } from '../src/sight.ts';
import type { Sim } from '../src/sim.ts';
import { OPTS, TERRAIN, cellCenter, cellOfEntity, indexOfKey, run, stageSim } from './helpers.ts';

const T = TERRAIN;
const A = ELEVATION.terraces;

/** Waypoints of an entity's current path, as cell indices. */
function pathCells(sim: Sim, index: number): number[] {
  const e = sim.entities;
  const out: number[] = [];
  for (let k = 0; k < e.pathCount[index]!; k++) out.push(sim.world!.cellAt(e.waypoints[index * WAYPOINT_STRIDE + k * 2]!, e.waypoints[index * WAYPOINT_STRIDE + k * 2 + 1]!));
  return out;
}
/** Request a path and walk it; returns every cell the entity stood on. */
function walkTo(sim: Sim, index: number, x: number, y: number, maxTicks = 2000): number[] {
  sim.paths.request(index, x, y);
  const visited: number[] = [];
  for (let t = 0; t < maxTicks; t++) {
    run(sim, 1);
    const cell = cellOfEntity(sim, index);
    if (visited[visited.length - 1] !== cell) visited.push(cell);
    if (!sim.paths.busy(index) && sim.entities.hasGoal[index] === 0) break;
  }
  return visited;
}
const noDummies = (p: Project): Project => {
  p.maps[0]!.placements = [];
  return p;
};

describe('[P4A.path.ramps-route] ★ ramps route', () => {
  const at = (c: { col: number; row: number }) => c.row * A.width + c.col;

  it('A* from low ground to the plateau goes through the ramp', () => {
    const sim = createSim(noDummies(buildElevation()), null, OPTS);
    const goal = cellCenter(A.plateauEdge.col, A.plateauEdge.row);
    const visited = walkTo(sim, 0, goal.x, goal.y);
    expect(sim.paths.lastStatus).toBe('found');
    expect(visited).toContain(at(A.rampLow));
    expect(visited).toContain(at(A.rampHigh));
    expect(visited.indexOf(at(A.rampLow))).toBeLessThan(visited.indexOf(at(A.rampHigh)));
    expect(cellOfEntity(sim, 0)).toBe(at(A.plateauEdge));
    expect(sim.entities.z[0]).toBe(1);
    // It arrives on the exact point asked for, not merely somewhere in the cell.
    expect(Math.hypot(sim.entities.x[0]! - goal.x, sim.entities.y[0]! - goal.y)).toBeLessThan(1e-6);
    // Every step of the way was across a connecting edge.
    for (let k = 1; k < visited.length; k++) expect(sim.world!.connects(visited[k - 1]!, visited[k]!, 'walk')).toBe(true);
  });

  it('with the ramp removed, there is no path: the walker stops at the closest reachable point', () => {
    const p = noDummies(buildElevation());
    const layers = p.maps[0]!.layers;
    for (const ramp of [A.rampLow, A.rampHigh]) {
      layers.ramp[at(ramp)] = 0;
      layers.level[at(ramp)] = 0;
    }
    const sim = createSim(p, null, OPTS);
    const goal = cellCenter(A.plateauEdge.col, A.plateauEdge.row);
    const visited = walkTo(sim, 0, goal.x, goal.y);
    expect(sim.paths.lastStatus).toBe('unreachable');
    for (const cell of visited) expect(sim.world!.level[cell]).toBe(0);
    // It walked to the foot of the cliff below the goal, as near as walking gets.
    expect(Math.hypot(sim.entities.x[0]! - goal.x, sim.entities.y[0]! - goal.y)).toBeLessThan(2.5);
    expect(sim.entities.hasGoal[0]).toBe(0);
  });

  it('Emberfall: the plateau is reached over its two stacked ramps', () => {
    const p = buildEmberfall();
    p.maps[0]!.placements = [];
    p.maps[0]!.triggers = [];
    p.triggers = [];
    const sim = createSim(p, null, OPTS);
    const goal = cellCenter(EMBERFALL.sentry.col, EMBERFALL.sentry.row);
    const visited = walkTo(sim, 0, goal.x, goal.y, 4000);
    const cell = (c: { col: number; row: number }) => c.row * EMBERFALL.width + c.col;
    expect(visited).toContain(cell(EMBERFALL.rampLow));
    expect(visited).toContain(cell(EMBERFALL.rampHigh));
    expect(sim.world!.level[cellOfEntity(sim, 0)]).toBe(2);
  });
});

describe('[P4A.path.move-cost] pathing costs and smoothing', () => {
  it('costs are scaled by terrain moveCost: the path goes round lava when the detour is cheaper', () => {
    const lavaStrip = (sim: Sim) => {
      const goal = cellCenter(12, 4);
      const visited = walkTo(sim, 0, goal.x, goal.y);
      return visited.filter((c) => sim.world!.cost[c]! > 1).length;
    };
    // A short strip of lava (cost 4) across the direct route, with open ground around it.
    const withDetour = stageSim(16, 9, { col: 2, row: 4 }, (m) => m.fill({ col: 7, row: 3, w: 1, h: 3 }, T.lava, 0));
    expect(lavaStrip(withDetour)).toBe(0);
    // When the lava spans the whole map there is no detour, and the path crosses it once.
    const noDetour = stageSim(16, 9, { col: 2, row: 4 }, (m) => m.fill({ col: 7, row: 0, w: 1, h: 9 }, T.lava, 0));
    expect(lavaStrip(noDetour)).toBe(1);
  });

  it('string-pulls open ground into one straight run', () => {
    const sim = stageSim(30, 20, { col: 3, row: 3 });
    const goal = cellCenter(22, 15);
    sim.paths.request(0, goal.x, goal.y);
    run(sim, 1);
    expect(sim.entities.pathCount[0]).toBe(1); // one waypoint: the goal itself
    const x0 = sim.entities.x[0]!;
    const y0 = sim.entities.y[0]!;
    run(sim, 60);
    // Heading straight at the goal.
    const heading = Math.atan2(sim.entities.y[0]! - y0, sim.entities.x[0]! - x0);
    expect(heading).toBeCloseTo(Math.atan2(goal.y - y0, goal.x - x0), 6);
  });

  it('keeps waypoints where the straight line would cross a blocked edge', () => {
    const sim = stageSim(20, 12, { col: 3, row: 6 }, (m) => m.fill({ col: 9, row: 0, w: 1, h: 9 }, T.rock, 0)); // a wall with a gap at the bottom
    const goal = cellCenter(16, 3);
    sim.paths.request(0, goal.x, goal.y);
    run(sim, 1);
    expect(sim.entities.pathCount[0]).toBeGreaterThan(1);
    const visited = walkTo(sim, 0, goal.x, goal.y);
    expect(visited.some((c) => Math.floor(c / 20) >= 9)).toBe(true); // went round through the gap
    expect(cellOfEntity(sim, 0)).toBe(3 * 20 + 16);
  });

  it('runs at most 8 searches per tick and queues the rest in request order', () => {
    const sim = stageSim(30, 20, { col: 1, row: 1 }, (_m, s) => {
      for (let k = 0; k < 20; k++) s.place(`walker-${k}`, 'Elder', { col: 2 + k, row: 10 }, { brain: undefined });
    });
    const goal = cellCenter(15, 2);
    const walkers = Array.from({ length: 20 }, (_, k) => indexOfKey(sim, `walker-${k}`));
    for (const i of walkers) sim.paths.request(i, goal.x, goal.y);
    expect(sim.paths.queued).toBe(20);
    const withPath = () => walkers.filter((i) => sim.entities.pathCount[i]! > 0);
    run(sim, 1);
    expect(withPath()).toEqual(walkers.slice(0, MAX_PATH_REQUESTS_PER_TICK)); // the first eight, in request order
    expect(sim.paths.queued).toBe(12);
    run(sim, 1);
    expect(withPath()).toEqual(walkers.slice(0, 16));
    run(sim, 1);
    expect(withPath()).toHaveLength(20);
    expect(sim.paths.queued).toBe(0);
  });

  it('caps a path at 256 cells and 64 waypoints', () => {
    // A serpentine corridor far longer than 256 cells.
    const sim = stageSim(40, 40, { col: 1, row: 1 }, (m) => {
      for (let row = 2; row < 39; row += 2) m.fill({ col: row % 4 === 2 ? 0 : 1, row, w: 39, h: 1 }, T.rock, 0);
    });
    const goal = cellCenter(1, 39);
    sim.paths.request(0, goal.x, goal.y);
    run(sim, 1);
    expect(sim.paths.lastStatus).toBe('found');
    expect(sim.entities.pathCount[0]).toBeLessThanOrEqual(64);
    expect(sim.entities.pathCount[0]).toBeGreaterThan(8);
    // The path was truncated to 256 cells, so its last waypoint is not the goal.
    const last = pathCells(sim, 0).pop()!;
    expect(last).not.toBe(sim.world!.cellAt(goal.x, goal.y));
  });

  it('a search that exhausts its 4,096 expansions walks the partial path and retries after 0.5 s', () => {
    const sim = stageSim(120, 120, { col: 2, row: 2 }, (m) => {
      // The goal is sealed in a room, so the search floods outward until the cap.
      m.frame({ col: 100, row: 100, w: 9, h: 9 }, T.rock, 0);
    });
    const goal = cellCenter(104, 104);
    sim.paths.request(0, goal.x, goal.y);
    run(sim, 1);
    expect(sim.paths.lastStatus).toBe('exhausted');
    expect(sim.paths.lastExplored).toBe(4096);
    expect(sim.entities.pathCount[0]).toBeGreaterThan(0); // it still sets off toward the goal
    expect(sim.entities.repathAt[0]).toBe(REPATH_TICKS);
    const d0 = Math.hypot(sim.entities.x[0]! - goal.x, sim.entities.y[0]! - goal.y);
    run(sim, 600);
    expect(Math.hypot(sim.entities.x[0]! - goal.x, sim.entities.y[0]! - goal.y)).toBeLessThan(d0 - 20); // and keeps making progress
  });

  it('repaths when blocked for more than 0.5 s', () => {
    const sim = stageSim(20, 9, { col: 2, row: 4 }, (_m, s) => {
      s.archetype('Boulder', { collider: { radius: 0.8, height: 2, solid: true } });
    });
    const goal = cellCenter(15, 4);
    sim.paths.request(0, goal.x, goal.y);
    run(sim, 20);
    // Drop an immovable boulder right in front of the walker.
    const ahead = { x: sim.entities.x[0]! + 1.0, y: sim.entities.y[0]! };
    sim.spawn(sim.archetypeIndexById.get(sim.project.archetypes.find((a) => a.name === 'Boulder')!.id)!, ahead.x, ahead.y, 0, null, true);
    let requests = 0;
    const original = sim.paths.request.bind(sim.paths);
    sim.paths.request = (i, x, y) => {
      requests++;
      original(i, x, y);
    };
    run(sim, 200);
    expect(requests).toBeGreaterThan(0);
  });
});

describe('[P4A.sight.cast-segment] the one 3D segment cast', () => {
  const sim = createSim(noDummies(buildElevation()), null, OPTS);
  const world = sim.world!;
  const center = (c: { col: number; row: number }) => cellCenter(c.col, c.row);
  const cast = (from: { x: number; y: number }, fz: number, to: { x: number; y: number }, tz: number, projectile = false) =>
    sim.sight.cast(from.x, from.y, fz, to.x, to.y, tz, projectile, -1, false);

  it('open ground does not block', () => {
    expect(cast(center({ col: 1, row: 10 }), 1.4, center({ col: 12, row: 10 }), 0.8)).toBe(HIT_NONE);
    expect(sim.sight.t).toBe(1);
  });

  it('a segment that passes below a column\'s surface is blocked there', () => {
    // From low ground north of the plateau to low ground south of it, at head height.
    const from = center({ col: 7, row: 0 });
    const to = center({ col: 7, row: 10 });
    expect(cast(from, 0.9, to, 0.9)).toBe(HIT_TERRAIN);
    expect(world.level[sim.sight.cell]).toBe(2); // stopped by the plateau
    expect(sim.sight.t).toBeGreaterThan(0.1);
    expect(sim.sight.t).toBeLessThan(0.3); // at the plateau's northern face, not somewhere inside it
    // The same line above the plateau's top is clear.
    expect(cast(from, 1.2, to, 1.2)).toBe(HIT_NONE);
  });

  it('looking down from the plateau is clear; looking up from close under the cliff is blocked', () => {
    const top = center(A.plateauEdge);
    const far = { x: top.x, y: top.y + 6 };
    const under = { x: top.x, y: top.y + 1.6 }; // just below the cliff face
    expect(cast(top, 1 + 1.5, far, 0.8)).toBe(HIT_NONE);
    expect(cast(far, 1.4, top, 1 + 0.8)).toBe(HIT_NONE);
    // From under the cliff to a point well back on the plateau: the rim is in the way.
    const back = { x: top.x, y: top.y - 3 };
    expect(cast(under, 0.5, back, 1 + 0.3)).toBe(HIT_TERRAIN);
    expect(world.level[sim.sight.cell]).toBe(2);
  });

  it('terrain that blocks sight is an infinitely tall wall', () => {
    const west = center({ col: A.pillar.col - 2, row: A.pillar.row });
    const east = center({ col: A.pillar.col + 2, row: A.pillar.row });
    expect(cast(west, 1, east, 1)).toBe(HIT_TERRAIN);
    expect(sim.sight.cell).toBe(A.pillar.row * A.width + A.pillar.col);
    expect(cast(west, 500, east, 500)).toBe(HIT_TERRAIN); // however high
  });

  it('`mode` picks the flag: a terrain may stop projectiles but not sight, or the reverse', () => {
    const p = noDummies(buildElevation());
    const water = p.terrains.find((t) => t.name === 'water')!;
    water.blocksProjectiles = true; // a waterfall mist: seen through, not shot through
    const s = createSim(p, null, OPTS);
    const from = cellCenter(A.pond.col - 1, A.pond.row);
    const to = cellCenter(A.pond.col + 3, A.pond.row);
    expect(s.sight.cast(from.x, from.y, 1, to.x, to.y, 1, false, -1, false)).toBe(HIT_NONE);
    expect(s.sight.cast(from.x, from.y, 1, to.x, to.y, 1, true, -1, false)).toBe(HIT_TERRAIN);
    const rock = p.terrains.find((t) => t.name === 'rock')!;
    rock.blocksProjectiles = false;
    const s2 = createSim(p, null, OPTS);
    const w = cellCenter(A.pillar.col - 2, A.pillar.row);
    const e2 = cellCenter(A.pillar.col + 2, A.pillar.row);
    expect(s2.sight.cast(w.x, w.y, 1, e2.x, e2.y, 1, false, -1, false)).toBe(HIT_TERRAIN);
    expect(s2.sight.cast(w.x, w.y, 1, e2.x, e2.y, 1, true, -1, false)).toBe(HIT_NONE);
  });

  it('entity hits test each collider cylinder along the way, nearest first', () => {
    const s = stageSim(24, 8, { col: 1, row: 1 }, (_m, st) => {
      st.archetype('Post', { collider: { radius: 0.5, height: 2, solid: true } });
      st.place('near', 'Post', { col: 8, row: 4 });
      st.place('far', 'Post', { col: 14, row: 4 });
    });
    run(s, 1);
    const from = cellCenter(4, 4);
    const to = cellCenter(20, 4);
    const [near, far] = [indexOfKey(s, 'near'), indexOfKey(s, 'far')];
    expect(s.sight.cast(from.x, from.y, 1, to.x, to.y, 1, true, -1, true)).toBe(HIT_ENTITY);
    expect(s.sight.entity).toBe(near);
    // t is where the segment enters the cylinder: half a radius short of its center.
    const hitX = from.x + (to.x - from.x) * s.sight.t;
    expect(hitX).toBeCloseTo(s.entities.x[near]! - 0.5, 6);
    // Ignoring the near one finds the far one; ignoring neither with hitEntities off finds nothing.
    expect(s.sight.cast(from.x, from.y, 1, to.x, to.y, 1, true, near, true)).toBe(HIT_ENTITY);
    expect(s.sight.entity).toBe(far);
    expect(s.sight.cast(from.x, from.y, 1, to.x, to.y, 1, true, -1, false)).toBe(HIT_NONE);
    // Over their heads (cylinders are 2 tall) and beside them (radius 0.5) both miss.
    expect(s.sight.cast(from.x, from.y, 2.5, to.x, to.y, 2.5, true, -1, true)).toBe(HIT_NONE);
    expect(s.sight.cast(from.x, from.y + 0.6, 1, to.x, to.y + 0.6, 1, true, -1, true)).toBe(HIT_NONE);
    // The public form returns ids, as the spec's signature does.
    const result = s.sight.castSegment({ ...from, z: 1 }, { ...to, z: 1 }, { mode: 'projectile', hitEntities: true });
    expect(result).toMatchObject({ hit: 'entity', entity: s.entities.idAt(near) });
    expect(s.sight.castSegment({ ...from, z: 1 }, { ...to, z: 1 }, { mode: 'sight', hitEntities: true, ignore: s.entities.idAt(near) }).entity).toBe(s.entities.idAt(far));
  });

  it('terrain in front of an entity wins', () => {
    const s = stageSim(24, 8, { col: 1, row: 1 }, (m, st) => {
      m.fill({ col: 10, row: 0, w: 1, h: 8 }, T.grass, 6);
      st.archetype('Post', { collider: { radius: 0.5, height: 2, solid: true } });
      st.place('behind', 'Post', { col: 14, row: 4 });
    });
    run(s, 1);
    const from = cellCenter(4, 4);
    const to = cellCenter(20, 4);
    expect(s.sight.cast(from.x, from.y, 1, to.x, to.y, 1, true, -1, true)).toBe(HIT_TERRAIN);
  });
});

describe('[P4A.sight.high-ground] ★ high ground', () => {
  /** An archer on a plateau's southern edge and the player on low ground `gap` world units south of it. */
  function scene(gap: number, mutate?: (p: Project) => void): { sim: Sim; archer: number } {
    const sim = stageSim(
      20,
      16,
      { col: 9, row: 13 },
      (m, s) => {
        m.fill({ col: 5, row: 2, w: 10, h: 5 }, T.stone, 2);
        s.place('archer', 'Sentry', { col: 9, row: 6 }, { brain: undefined, movement: undefined });
      },
      mutate,
    );
    const archer = indexOfKey(sim, 'archer');
    sim.place(0, sim.entities.x[archer]!, sim.entities.y[archer]! + gap);
    return { sim, archer };
  }

  it('the plateau archer sees the player below', () => {
    const { sim, archer } = scene(6);
    expect(sim.entities.z[archer]).toBe(1);
    expect(sim.entities.z[0]).toBe(0);
    expect(sim.sight.canSee(archer, 0)).toBe(true);
  });

  it('the player cannot see the archer beyond the reveal range, but can from close under the cliff', () => {
    const far = scene(6);
    expect(far.sim.sight.canSee(0, far.archer)).toBe(false);
    // The line itself is clear: it is the high-ground rule that hides the archer.
    const e = far.sim.entities;
    expect(far.sim.sight.cast(e.x[0]!, e.y[0]!, 1.4, e.x[far.archer]!, e.y[far.archer]!, 1.85, false, -1, false)).toBe(HIT_NONE);
    const near = scene(1.4); // inside uphillRevealRange 1.5
    expect(near.sim.sight.canSee(0, near.archer)).toBe(true);
    expect(near.sim.sight.canSee(near.archer, 0)).toBe(true);
  });

  it('with uphillBlocked off, height alone hides nothing', () => {
    const { sim, archer } = scene(6, (p) => void (p.settings.sight.uphillBlocked = false));
    expect(sim.sight.canSee(0, archer)).toBe(true);
  });

  it('uphillRevealRange is read from the project', () => {
    const { sim, archer } = scene(6, (p) => void (p.settings.sight.uphillRevealRange = 7));
    expect(sim.sight.canSee(0, archer)).toBe(true);
  });

  it('a taller column between them blocks both', () => {
    const { sim, archer } = scene(6, (p) => {
      // A level-6 column on the low ground between the two.
      const map = p.maps[0]!;
      for (const col of [8, 9, 10]) map.layers.level[9 * map.width + col] = 6;
    });
    expect(sim.sight.canSee(archer, 0)).toBe(false);
    expect(sim.sight.canSee(0, archer)).toBe(false);
  });

  it('sight range and untargetable both apply', () => {
    const { sim, archer } = scene(6);
    const e = sim.entities;
    sim.place(0, e.x[archer]!, e.y[archer]! + 11.5); // the sentry's sight range is 11
    expect(sim.sight.canSee(archer, 0)).toBe(false);
    sim.place(0, e.x[archer]!, e.y[archer]! + 6);
    e.status[0] = STATUS_UNTARGETABLE;
    expect(sim.sight.canSee(archer, 0)).toBe(false);
  });
});

describe('[P4A.acquisition.range] factions and acquisition', () => {
  /** A sentry that only watches (no brain, no movement), with hostiles placed by `build`. */
  function watch(build: (place: (name: string, archetype: string, col: number, row: number) => void) => void, mutate?: (p: Project) => void): Sim {
    return stageSim(
      30,
      12,
      { col: 28, row: 10 },
      (_m, s) => {
        s.place('watcher', 'Sentry', { col: 10, row: 5 }, { brain: undefined, movement: undefined });
        build((name, archetype, col, row) => s.place(name, archetype, { col, row }, { brain: undefined, movement: undefined }));
      },
      mutate,
    );
  }
  const targetOf = (sim: Sim): number => sim.entities.indexOf(sim.entities.target[indexOfKey(sim, 'watcher')]!);

  it('scans every 6 ticks, staggered by entity index', () => {
    const sim = watch(() => {});
    const w = indexOfKey(sim, 'watcher');
    sim.place(0, sim.entities.x[w]! + 3, sim.entities.y[w]!);
    let acquiredAt = -1;
    for (let t = 0; t < 12 && acquiredAt < 0; t++) {
      run(sim, 1);
      if (targetOf(sim) === 0) acquiredAt = sim.tick - 1;
    }
    expect(acquiredAt).toBeGreaterThanOrEqual(0);
    expect((acquiredAt + w) % ACQUISITION_INTERVAL).toBe(0);
  });

  it('picks the nearest hostile it can see within range; neutrals and allies are ignored', () => {
    const sim = watch((place) => {
      place('ally', 'Sentry', 11, 5); //     closest of all, but its own faction
      place('bystander', 'Elder', 12, 5); // neutral
    });
    const w = indexOfKey(sim, 'watcher');
    sim.place(0, sim.entities.x[w]! + 5, sim.entities.y[w]!);
    run(sim, 8);
    expect(targetOf(sim)).toBe(0);
  });

  it('acquisition.range bounds the scan', () => {
    const sim = watch(() => {});
    const w = indexOfKey(sim, 'watcher');
    sim.place(0, sim.entities.x[w]! + 11.5, sim.entities.y[w]!); // the sentry's range is 11
    run(sim, 12);
    expect(targetOf(sim)).toBe(-1);
    sim.place(0, sim.entities.x[w]! + 10.5, sim.entities.y[w]!);
    run(sim, 12);
    expect(targetOf(sim)).toBe(0);
  });

  it('needs line of sight', () => {
    const sim = stageSim(30, 12, { col: 28, row: 10 }, (m, s) => {
      m.fill({ col: 13, row: 0, w: 1, h: 12 }, T.rock, 0);
      s.place('watcher', 'Sentry', { col: 10, row: 5 }, { brain: undefined, movement: undefined });
    });
    const w = indexOfKey(sim, 'watcher');
    sim.place(0, sim.entities.x[w]! + 7, sim.entities.y[w]!);
    run(sim, 12);
    expect(targetOf(sim)).toBe(-1);
  });

  it('keeps its target while a nearer hostile appears; ties go to the lower entity index', () => {
    const sim = watch((place) => {
      place('twin-a', 'Hero', 14, 5); // equidistant east and west of the watcher
      place('twin-b', 'Hero', 6, 5);
    });
    sim.place(0, 60, 60); // the real player is far away
    run(sim, 8);
    const first = targetOf(sim);
    expect(first).toBe(Math.min(indexOfKey(sim, 'twin-a'), indexOfKey(sim, 'twin-b')));
    const w = indexOfKey(sim, 'watcher');
    sim.place(0, sim.entities.x[w]! + 1.5, sim.entities.y[w]!); // now much nearer
    run(sim, 30);
    expect(targetOf(sim)).toBe(first);
  });

  it('forgets a target unseen for forgetMs, and drops one that dies or becomes untargetable at once', () => {
    const sim = watch(() => {});
    const e = sim.entities;
    const w = indexOfKey(sim, 'watcher');
    sim.place(0, e.x[w]! + 4, e.y[w]!);
    run(sim, 8);
    expect(targetOf(sim)).toBe(0);
    sim.place(0, e.x[w]! + 20, e.y[w]!); // out of sight; forgetMs is 4000 = 240 ticks
    run(sim, 200);
    expect(targetOf(sim)).toBe(0);
    run(sim, 60);
    expect(targetOf(sim)).toBe(-1);
    expect(e.target[w]).toBe(NO_ENTITY);

    sim.place(0, e.x[w]! + 4, e.y[w]!);
    run(sim, 8);
    expect(targetOf(sim)).toBe(0);
    e.status[0] = STATUS_UNTARGETABLE;
    run(sim, 1);
    expect(targetOf(sim)).toBe(-1);
    e.status[0] = 0;
    run(sim, 8);
    expect(targetOf(sim)).toBe(0);
    sim.entities.requestDespawn(e.idAt(0));
    run(sim, 2);
    expect(e.target[w]).toBe(NO_ENTITY);
  });
});
