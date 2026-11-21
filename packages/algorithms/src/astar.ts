/**
 * A* ported from LoreBrix v0.6.0 `src/entity-system.ts`
 * (`createAStarPathfinder` and its private `MinHeap`).
 *
 * The search loop, the heap, the lazy-deletion closed set, the cost model
 * (entering a cell costs that cell's moveCost) and the cube-distance
 * heuristic are the v0.6.0 logic. Changes, each logged in
 * Context/DECISIONS_LOG.md:
 *   1. Square-grid branches removed (Q16: hex-iso only).
 *   2. Cells are dense indices (row * width + col) instead of `GridPos`
 *      objects: the adapter edge.
 *   3. `terrain.isWalkable(neighbor)` became `grid.connects(current, neighbor)`
 *      so slopes and cliffs decide passage (spec 6.3, 7.5). `grid.passable`
 *      keeps the v0.6.0 early-out on an unwalkable goal.
 *   4. `maxExplored` defaults to the spec's 4,096 expansion cap (9.2).
 *   5. The result reports why it stopped and, when the goal was not reached,
 *      the explored cell nearest the goal, so callers can truncate "to the
 *      nearest reachable cell" (9.2) without a second search.
 */
import { hexDistance, neighborIndex } from '@loreengine/hexmath';
import type { HexDir } from '@loreengine/hexmath';

/** What A* needs to know about a map. Supplied by `runtime/world`. */
export interface PathGrid {
  readonly width: number;
  readonly height: number;
  /** May anything of this movement mode stand on `cell`? */
  passable(cell: number): boolean;
  /** May it step from `a` to its neighbor `b`? (elevation-aware) */
  connects(a: number, b: number): boolean;
  /** Cost of entering `cell`; >= 1, which keeps the hex-distance heuristic admissible. */
  moveCost(cell: number): number;
}

export interface AStarOptions {
  /** Abort after expanding this many cells. Default 4096 (spec 9.2). */
  maxExplored?: number;
}

export type PathStatus = 'found' | 'unreachable' | 'exhausted' | 'invalid';

export interface PathResult {
  status: PathStatus;
  /**
   * Cells EXCLUDING the start and INCLUDING the last cell. When `status` is
   * 'found' the last cell is the goal; otherwise the path leads to the
   * explored cell nearest the goal (possibly empty: stay put).
   */
  path: number[];
  /** Total cost of `path`. */
  cost: number;
  /** Cells expanded. */
  explored: number;
}

interface HeapItem<T> {
  key: number;
  value: T;
}

/** Binary min-heap, ported verbatim. Ties pop in a deterministic order. */
class MinHeap<T> {
  private readonly items: HeapItem<T>[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: T): void {
    const items = this.items;
    items.push({ key, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.key <= items[i]!.key) break;
      const tmp = items[parent]!;
      items[parent] = items[i]!;
      items[i] = tmp;
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && items[l]!.key < items[smallest]!.key) smallest = l;
        if (r < items.length && items[r]!.key < items[smallest]!.key) smallest = r;
        if (smallest === i) break;
        const tmp = items[smallest]!;
        items[smallest] = items[i]!;
        items[i] = tmp;
        i = smallest;
      }
    }
    return top.value;
  }
}

export function findPath(grid: PathGrid, start: number, goal: number, options?: AStarOptions): PathResult {
  const maxExplored = options?.maxExplored ?? 4096;
  const w = grid.width;
  const h = grid.height;
  const cells = w * h;

  const heuristic = (aIdx: number, bIdx: number): number => {
    const ac = aIdx % w;
    const ar = Math.floor(aIdx / w);
    const bc = bIdx % w;
    const br = Math.floor(bIdx / w);
    return hexDistance(ac, ar, bc, br);
  };

  if (start < 0 || goal < 0 || start >= cells || goal >= cells) {
    return { status: 'invalid', path: [], cost: 0, explored: 0 };
  }
  if (start === goal) return { status: 'found', path: [], cost: 0, explored: 0 };

  const open = new MinHeap<number>();
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();

  const build = (status: PathStatus, end: number, explored: number): PathResult => {
    const path: number[] = [];
    let node = end;
    while (node !== start) {
      path.push(node);
      const prev = cameFrom.get(node);
      if (prev === undefined) return { status: 'invalid', path: [], cost: 0, explored };
      node = prev;
    }
    path.reverse();
    return { status, path, cost: gScore.get(end) ?? 0, explored };
  };

  gScore.set(start, 0);
  open.push(heuristic(start, goal), start);
  let explored = 0;
  // Nearest explored cell to the goal (change 5): lowest heuristic, then lowest cost.
  let best = start;
  let bestH = heuristic(start, goal);
  let bestG = 0;
  // v0.6.0 returned null at once for an unwalkable goal. The search still
  // runs here so the caller gets the nearest reachable cell, but such a goal
  // is never entered.
  const goalOpen = grid.passable(goal);

  while (open.size > 0) {
    const current = open.pop();
    if (current === undefined) break;
    if (closed.has(current)) continue;

    if (current === goal) return build('found', goal, explored);

    closed.add(current);
    if (++explored > maxExplored) return build('exhausted', best, explored - 1);

    const g = gScore.get(current);
    if (g === undefined) continue;

    const hc = heuristic(current, goal);
    if (hc < bestH || (hc === bestH && g < bestG)) {
      best = current;
      bestH = hc;
      bestG = g;
    }

    for (let dir = 1; dir <= 6; dir++) {
      const n = neighborIndex(current, dir as HexDir, w, h);
      if (n < 0) continue;
      if (closed.has(n)) continue;
      if (n === goal && !goalOpen) continue;
      if (!grid.connects(current, n)) continue;
      const tentative = g + grid.moveCost(n);
      const known = gScore.get(n);
      if (known === undefined || tentative < known) {
        gScore.set(n, tentative);
        cameFrom.set(n, current);
        open.push(tentative + heuristic(n, goal), n);
      }
    }
  }
  return build('unreachable', best, explored);
}
