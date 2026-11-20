/**
 * Helpers for authoring fixture projects in code. `fixtures` may import only
 * `schema` (spec 4.3), so the two hex formulas needed to place things are
 * restated here; `tests/fixtures.test.ts` checks them against `hexmath`.
 */
import { seededIdFactory } from '@loreengine/schema';
import type { AtlasDef, Id, MapDef } from '@loreengine/schema';

const SQRT3 = Math.sqrt(3);

/** A stable UUID v4 derived from a readable name, e.g. `id('map', 'emberfall')`. */
export function id<K extends string>(kind: K, name: string): Id<K> {
  // FNV-1a over "kind:name" seeds the generator, so ids do not depend on call order.
  let h = 0x811c9dc5;
  const text = `${kind}:${name}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return seededIdFactory(h)() as Id<K>;
}

/** World-plane center of offset cell (col, row). Pointy-top, odd-r. */
export function cellCenter(col: number, row: number, hexSize = 1): { x: number; y: number } {
  return { x: hexSize * SQRT3 * (col + 0.5 * (row & 1)), y: hexSize * 1.5 * row };
}

/** Axial (q, r) of an offset cell. */
export function axial(col: number, row: number): [number, number] {
  return [col - (row - (row & 1)) / 2, row];
}

export interface Rect {
  col: number;
  row: number;
  w: number;
  h: number;
}

/** Paints a map's layers by rectangle, in offset coordinates. */
export class MapPainter {
  readonly terrain: Uint16Array;
  readonly level: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.terrain = new Uint16Array(width * height);
    this.level = new Uint8Array(width * height);
  }

  private each(rect: Rect, fn: (index: number) => void): void {
    for (let row = rect.row; row < rect.row + rect.h; row++) {
      for (let col = rect.col; col < rect.col + rect.w; col++) {
        if (col < 0 || row < 0 || col >= this.width || row >= this.height) continue;
        fn(row * this.width + col);
      }
    }
  }

  fill(rect: Rect, paletteIndex: number, level?: number): this {
    this.each(rect, (i) => {
      this.terrain[i] = paletteIndex;
      if (level !== undefined) this.level[i] = level;
    });
    return this;
  }

  /** Paints only the outline of a rectangle. */
  frame(rect: Rect, paletteIndex: number, level?: number): this {
    this.fill({ col: rect.col, row: rect.row, w: rect.w, h: 1 }, paletteIndex, level);
    this.fill({ col: rect.col, row: rect.row + rect.h - 1, w: rect.w, h: 1 }, paletteIndex, level);
    this.fill({ col: rect.col, row: rect.row, w: 1, h: rect.h }, paletteIndex, level);
    this.fill({ col: rect.col + rect.w - 1, row: rect.row, w: 1, h: rect.h }, paletteIndex, level);
    return this;
  }

  layers(): MapDef['layers'] {
    return { terrain: this.terrain, level: this.level };
  }
}

/** Packed (q, r) pairs for every cell of a rectangle. */
export function regionCells(rect: Rect): Int16Array {
  const out = new Int16Array(rect.w * rect.h * 2);
  let n = 0;
  for (let row = rect.row; row < rect.row + rect.h; row++) {
    for (let col = rect.col; col < rect.col + rect.w; col++) {
      const [q, r] = axial(col, row);
      out[n++] = q;
      out[n++] = r;
    }
  }
  return out;
}

/** SHA-256 of zero bytes: the blob id of an atlas page that has not been baked yet. */
export const EMPTY_BLOB_ID = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * A placeholder atlas: every frame is a `cell` x `cell` square on a grid,
 * anchored bottom-center. Its page images are empty blobs until the Phase 3
 * bake replaces them; the renderer draws engine placeholder shapes for a
 * frame whose page cannot be resolved.
 */
export function placeholderAtlas(atlasId: Id<'atlas'>, frameNames: readonly string[], sourceIds: Id<'asset'>[] = [], cell = 64): AtlasDef {
  const perRow = 16;
  const tier = (scale: 1 | 2): AtlasDef['tiers'][number] => {
    const frames: AtlasDef['tiers'][number]['frames'] = {};
    frameNames.forEach((name, i) => {
      const size = cell * scale;
      frames[name] = {
        x: (i % perRow) * size,
        y: Math.floor(i / perRow) * size,
        w: size,
        h: size,
        anchorX: size / 2,
        anchorY: size,
      };
    });
    const rows = Math.max(1, Math.ceil(frameNames.length / perRow));
    return {
      scale,
      image: { blobId: EMPTY_BLOB_ID, mime: 'image/png', byteSize: 0, width: perRow * cell * scale, height: rows * cell * scale },
      frames,
    };
  };
  return { id: atlasId, sourceIds, tiers: [tier(1), tier(2)] };
}
