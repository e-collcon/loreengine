/**
 * Spatial hash extracted from LoreBrix v0.6.0 `EntityManager`
 * ("SPATIAL HASH & QUERIES" block of `src/entity-system.ts`).
 *
 * v0.6.0 kept `Map<"col,row", Set<uuid>>` plus a `lastCellKeys` map, with
 * `indexEntity` / `unindexEntity` / `reindexEntity`, `entitiesAt(cell)` and
 * a cell-range scan for rect queries. Those five operations are kept one for
 * one. What changed, and why (logged in Context/DECISIONS_LOG.md):
 *   - Buckets are keyed by dense cell index and hold entity *indices*, in
 *     intrusive linked lists over preallocated Int32Arrays. v0.6.0 built a
 *     string key and could allocate a Set on every move; law L8 requires
 *     0 bytes per tick in movement and collision.
 *   - Queries visit ids in ascending order within a cell is NOT guaranteed
 *     by a linked list, so callers that need determinism sort or reduce
 *     order-independently. `queryRange` fills a caller-owned buffer.
 */
export class SpatialHash {
  readonly width: number;
  readonly height: number;
  readonly capacity: number;
  private readonly head: Int32Array; // per cell: first item, or -1
  private readonly next: Int32Array; // per item
  private readonly prev: Int32Array; // per item
  private readonly cellOf: Int32Array; // per item: its cell, or -1 when not indexed ("lastCellKeys")
  private count = 0;

  constructor(width: number, height: number, capacity: number) {
    this.width = width;
    this.height = height;
    this.capacity = capacity;
    this.head = new Int32Array(width * height).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.prev = new Int32Array(capacity).fill(-1);
    this.cellOf = new Int32Array(capacity).fill(-1);
  }

  /** Number of indexed items. */
  get size(): number {
    return this.count;
  }

  /** v0.6.0 `indexEntity`. `cell` must be on the map. */
  insert(item: number, cell: number): void {
    if (this.cellOf[item] !== -1) this.remove(item);
    const first = this.head[cell]!;
    this.next[item] = first;
    this.prev[item] = -1;
    if (first !== -1) this.prev[first] = item;
    this.head[cell] = item;
    this.cellOf[item] = cell;
    this.count++;
  }

  /** v0.6.0 `unindexEntity`. A no-op for an item that is not indexed. */
  remove(item: number): void {
    const cell = this.cellOf[item]!;
    if (cell === -1) return;
    const n = this.next[item]!;
    const p = this.prev[item]!;
    if (p !== -1) this.next[p] = n;
    else this.head[cell] = n;
    if (n !== -1) this.prev[n] = p;
    this.next[item] = -1;
    this.prev[item] = -1;
    this.cellOf[item] = -1;
    this.count--;
  }

  /** v0.6.0 `reindexEntity`, skipping the work when the cell is unchanged. */
  update(item: number, cell: number): void {
    if (this.cellOf[item] === cell) return;
    this.remove(item);
    this.insert(item, cell);
  }

  /** The cell an item is indexed under, or -1. */
  cellOfItem(item: number): number {
    return this.cellOf[item]!;
  }

  /** v0.6.0 `entitiesAt`: items on one cell, written to `out`; returns the count. */
  queryCell(cell: number, out: Int32Array): number {
    let n = 0;
    for (let i = this.head[cell]!; i !== -1 && n < out.length; i = this.next[i]!) out[n++] = i;
    return n;
  }

  /**
   * v0.6.0 `entitiesInRect` cell-range scan: items on cells in the inclusive
   * offset range [c0..c1] x [r0..r1] (clamped to the map), written to `out`.
   * Returns the count; stops when `out` is full.
   */
  queryRange(c0: number, r0: number, c1: number, r1: number, out: Int32Array): number {
    if (c0 < 0) c0 = 0;
    if (r0 < 0) r0 = 0;
    if (c1 > this.width - 1) c1 = this.width - 1;
    if (r1 > this.height - 1) r1 = this.height - 1;
    let n = 0;
    for (let row = r0; row <= r1; row++) {
      const base = row * this.width;
      for (let col = c0; col <= c1; col++) {
        for (let i = this.head[base + col]!; i !== -1; i = this.next[i]!) {
          if (n >= out.length) return n;
          out[n++] = i;
        }
      }
    }
    return n;
  }

  /** Remove everything (map unload). */
  clear(): void {
    this.head.fill(-1);
    this.next.fill(-1);
    this.prev.fill(-1);
    this.cellOf.fill(-1);
    this.count = 0;
  }
}
