/**
 * A* suite, written from scratch (the v0.6.0 suite was not recovered).
 * Optimality is checked against a brute-force Dijkstra on small random maps.
 */
import { describe, expect, it } from 'vitest';
import { neighborIndex } from '@loreengine/hexmath';
import type { HexDir } from '@loreengine/hexmath';
import { findPath } from '../src/index.ts';
import type { PathGrid } from '../src/index.ts';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface TestGrid extends PathGrid {
  blocked: Uint8Array;
  cost: Float64Array;
  /** Blocked directed edges, keyed a * cells + b. */
  walls: Set<number>;
}

function makeGrid(width: number, height: number): TestGrid {
  const cells = width * height;
  const g: TestGrid = {
    width,
    height,
    blocked: new Uint8Array(cells),
    cost: new Float64Array(cells).fill(1),
    walls: new Set(),
    passable: (c) => g.blocked[c] === 0,
    connects: (a, b) => g.blocked[a] === 0 && g.blocked[b] === 0 && !g.walls.has(a * cells + b),
    moveCost: (c) => g.cost[c]!,
  };
  return g;
}

/** Reference: O(n^2) Dijkstra with no heap and no heuristic. */
function bruteForce(g: TestGrid, start: number, goal: number): number {
  const cells = g.width * g.height;
  const dist = new Float64Array(cells).fill(Infinity);
  const done = new Uint8Array(cells);
  dist[start] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < cells; i++) if (!done[i] && dist[i]! < Infinity && (u === -1 || dist[i]! < dist[u]!)) u = i;
    if (u === -1) return Infinity;
    if (u === goal) return dist[u]!;
    done[u] = 1;
    for (let dir = 1; dir <= 6; dir++) {
      const n = neighborIndex(u, dir as HexDir, g.width, g.height);
      if (n < 0 || !g.connects(u, n)) continue;
      const d = dist[u]! + g.moveCost(n);
      if (d < dist[n]!) dist[n] = d;
    }
  }
}

function assertValidPath(g: TestGrid, start: number, path: number[]): number {
  let at = start;
  let cost = 0;
  for (const cell of path) {
    let adjacent = false;
    for (let dir = 1; dir <= 6; dir++) if (neighborIndex(at, dir as HexDir, g.width, g.height) === cell) adjacent = true;
    expect(adjacent).toBe(true);
    expect(g.connects(at, cell)).toBe(true);
    cost += g.moveCost(cell);
    at = cell;
  }
  return cost;
}

describe('[P1.astar.basics] A* basics', () => {
  it('returns an empty path when start is the goal', () => {
    const g = makeGrid(5, 5);
    expect(findPath(g, 7, 7)).toMatchObject({ status: 'found', path: [], cost: 0 });
  });

  it('excludes the start and includes the goal', () => {
    const g = makeGrid(8, 1);
    const r = findPath(g, 0, 4);
    expect(r.status).toBe('found');
    expect(r.path).toEqual([1, 2, 3, 4]);
    expect(r.cost).toBe(4);
  });

  it('rejects off-map endpoints', () => {
    const g = makeGrid(4, 4);
    expect(findPath(g, -1, 3).status).toBe('invalid');
    expect(findPath(g, 0, 16).status).toBe('invalid');
  });

  it('walks around a wall', () => {
    const g = makeGrid(7, 7);
    for (let row = 0; row < 6; row++) g.blocked[row * 7 + 3] = 1;
    const r = findPath(g, 0, 6);
    expect(r.status).toBe('found');
    assertValidPath(g, 0, r.path);
    expect(r.path.some((c) => Math.floor(c / 7) === 6)).toBe(true);
  });

  it('prefers a longer cheap route over a short expensive one', () => {
    const g = makeGrid(9, 3);
    for (let col = 1; col < 8; col++) g.cost[1 * 9 + col] = 10; // middle row is a swamp
    const r = findPath(g, 1 * 9 + 0, 1 * 9 + 8);
    expect(r.status).toBe('found');
    const cost = assertValidPath(g, 9, r.path);
    expect(cost).toBe(r.cost);
    expect(cost).toBe(bruteForce(g, 9, 17));
    expect(cost).toBeLessThan(8 * 10);
  });

  it('honors one-way edges through connects(a, b)', () => {
    const g = makeGrid(6, 1);
    g.walls.add(2 * 6 + 3); // cannot step 2 -> 3
    expect(findPath(g, 0, 5).status).toBe('unreachable');
    expect(findPath(g, 5, 0).status).toBe('found'); // 3 -> 2 is open
  });
});

describe('[P1.astar.nearest] unreachable and exhausted searches', () => {
  it('returns the nearest reachable cell when the goal is walled off', () => {
    const g = makeGrid(9, 1);
    g.blocked[5] = 1;
    const r = findPath(g, 0, 8);
    expect(r.status).toBe('unreachable');
    expect(r.path).toEqual([1, 2, 3, 4]);
    assertValidPath(g, 0, r.path);
  });

  it('never enters an impassable goal, and stops next to it', () => {
    const g = makeGrid(9, 1);
    g.blocked[8] = 1;
    const r = findPath(g, 0, 8);
    expect(r.status).toBe('unreachable');
    expect(r.path[r.path.length - 1]).toBe(7);
  });

  it('stops at the expansion cap and reports a partial path', () => {
    const g = makeGrid(64, 64);
    const r = findPath(g, 0, 64 * 64 - 1, { maxExplored: 50 });
    expect(r.status).toBe('exhausted');
    expect(r.explored).toBe(50);
    expect(r.path.length).toBeGreaterThan(0);
    assertValidPath(g, 0, r.path);
  });

  it('defaults to the 4,096 expansion cap', () => {
    const g = makeGrid(128, 128);
    // Seal the goal inside a ring so the search floods outward until the cap.
    const goal = 100 * 128 + 100;
    for (let dir = 1; dir <= 6; dir++) g.blocked[neighborIndex(goal, dir as HexDir, 128, 128)] = 1;
    const r = findPath(g, 20 * 128 + 20, goal);
    expect(r.status).toBe('exhausted');
    expect(r.explored).toBe(4096);
  });
});

describe('[P1.astar.optimality] optimal against brute force', () => {
  it('matches Dijkstra on 400 random small maps', () => {
    const rnd = lcg(2026);
    let found = 0;
    let blocked = 0;
    for (let trial = 0; trial < 400; trial++) {
      const width = 3 + Math.floor(rnd() * 10);
      const height = 3 + Math.floor(rnd() * 10);
      const cells = width * height;
      const g = makeGrid(width, height);
      for (let i = 0; i < cells; i++) {
        if (rnd() < 0.22) g.blocked[i] = 1;
        g.cost[i] = 1 + Math.floor(rnd() * 4);
      }
      // A few one-way cliffs.
      for (let k = 0; k < cells / 6; k++) {
        const a = Math.floor(rnd() * cells);
        const n = neighborIndex(a, (1 + Math.floor(rnd() * 6)) as HexDir, width, height);
        if (n >= 0) g.walls.add(a * cells + n);
      }
      const start = Math.floor(rnd() * cells);
      const goal = Math.floor(rnd() * cells);
      g.blocked[start] = 0;
      const want = bruteForce(g, start, goal);
      const got = findPath(g, start, goal);
      if (want === Infinity || g.blocked[goal]) {
        expect(got.status).toBe('unreachable');
        assertValidPath(g, start, got.path);
        blocked++;
      } else {
        expect(got.status).toBe('found');
        expect(assertValidPath(g, start, got.path)).toBe(want);
        expect(got.cost).toBe(want);
        if (start !== goal) expect(got.path[got.path.length - 1]).toBe(goal);
        found++;
      }
    }
    expect(found).toBeGreaterThan(100);
    expect(blocked).toBeGreaterThan(20);
  });

  it('is deterministic: the same request returns the same path', () => {
    const g = makeGrid(20, 20);
    const a = findPath(g, 3, 397);
    const b = findPath(g, 3, 397);
    expect(a.path).toEqual(b.path);
  });
});
