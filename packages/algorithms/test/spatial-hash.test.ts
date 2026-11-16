/** Spatial hash suite, written from scratch against a brute-force reference. */
import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../src/index.ts';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const sorted = (buf: Int32Array, n: number): number[] => Array.from(buf.subarray(0, n)).sort((a, b) => a - b);

describe('[P1.spatial-hash.ops] SpatialHash', () => {
  it('indexes, reindexes and unindexes one item', () => {
    const h = new SpatialHash(4, 4, 8);
    const out = new Int32Array(8);
    h.insert(3, 5);
    expect(h.size).toBe(1);
    expect(sorted(out, h.queryCell(5, out))).toEqual([3]);
    h.update(3, 6);
    expect(h.queryCell(5, out)).toBe(0);
    expect(sorted(out, h.queryCell(6, out))).toEqual([3]);
    expect(h.cellOfItem(3)).toBe(6);
    h.remove(3);
    expect(h.size).toBe(0);
    expect(h.queryCell(6, out)).toBe(0);
    expect(h.cellOfItem(3)).toBe(-1);
  });

  it('removing an unindexed item and re-inserting an indexed one are safe', () => {
    const h = new SpatialHash(2, 2, 4);
    const out = new Int32Array(4);
    h.remove(1);
    expect(h.size).toBe(0);
    h.insert(1, 0);
    h.insert(1, 3);
    expect(h.size).toBe(1);
    expect(h.queryCell(0, out)).toBe(0);
    expect(sorted(out, h.queryCell(3, out))).toEqual([1]);
  });

  it('holds many items on one cell and unlinks from head, middle and tail', () => {
    const h = new SpatialHash(2, 2, 8);
    const out = new Int32Array(8);
    for (const i of [0, 1, 2, 3, 4]) h.insert(i, 1);
    h.remove(4); // head
    h.remove(2); // middle
    h.remove(0); // tail
    expect(sorted(out, h.queryCell(1, out))).toEqual([1, 3]);
  });

  it('queryRange clamps to the map and stops when the buffer is full', () => {
    const h = new SpatialHash(4, 4, 16);
    for (let i = 0; i < 16; i++) h.insert(i, i);
    const out = new Int32Array(16);
    expect(sorted(out, h.queryRange(-5, -5, 1, 1, out))).toEqual([0, 1, 4, 5]);
    expect(h.queryRange(-9, -9, 99, 99, out)).toBe(16);
    expect(h.queryRange(0, 0, 3, 3, new Int32Array(5))).toBe(5);
    expect(h.queryRange(3, 3, 2, 2, out)).toBe(0);
  });

  it('clear() empties every bucket', () => {
    const h = new SpatialHash(3, 3, 9);
    for (let i = 0; i < 9; i++) h.insert(i, i % 3);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.queryRange(0, 0, 2, 2, new Int32Array(9))).toBe(0);
  });

  it('[P1.spatial-hash.reference] agrees with a brute-force reference over 20,000 random operations', () => {
    const rnd = lcg(42);
    const W = 16;
    const H = 12;
    const CAP = 200;
    const h = new SpatialHash(W, H, CAP);
    const ref = new Int32Array(CAP).fill(-1);
    const out = new Int32Array(CAP);
    for (let step = 0; step < 20000; step++) {
      const item = Math.floor(rnd() * CAP);
      const op = rnd();
      if (op < 0.5) {
        const cell = Math.floor(rnd() * W * H);
        if (ref[item] === -1 || rnd() < 0.5) h.insert(item, cell);
        else h.update(item, cell);
        ref[item] = cell;
      } else if (op < 0.7) {
        h.remove(item);
        ref[item] = -1;
      } else if (op < 0.85) {
        const cell = Math.floor(rnd() * W * H);
        const want: number[] = [];
        for (let i = 0; i < CAP; i++) if (ref[i] === cell) want.push(i);
        expect(sorted(out, h.queryCell(cell, out))).toEqual(want);
      } else {
        const c0 = Math.floor(rnd() * W) - 2;
        const r0 = Math.floor(rnd() * H) - 2;
        const c1 = c0 + Math.floor(rnd() * 8);
        const r1 = r0 + Math.floor(rnd() * 8);
        const want: number[] = [];
        for (let i = 0; i < CAP; i++) {
          const cell = ref[i]!;
          if (cell === -1) continue;
          const col = cell % W;
          const row = Math.floor(cell / W);
          if (col >= c0 && col <= c1 && row >= r0 && row <= r1) want.push(i);
        }
        expect(sorted(out, h.queryRange(c0, r0, c1, r1, out))).toEqual(want);
      }
    }
    let live = 0;
    for (let i = 0; i < CAP; i++) if (ref[i] !== -1) live++;
    expect(h.size).toBe(live);
  });
});
