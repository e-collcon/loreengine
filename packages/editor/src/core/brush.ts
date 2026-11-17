/**
 * Hex brushes (spec 8.5): 1, 7, or 19 hexes, the cells within distance 0, 1,
 * or 2 of the center.
 */
import { hexDistance } from '@loreengine/hexmath';

export const BRUSH_SIZES = [1, 7, 19] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number];

export function brushRadius(size: BrushSize): number {
  return size === 1 ? 0 : size === 7 ? 1 : 2;
}

/** The cell indices a brush of `size` covers around `center`, clipped to the map, in row-major order. */
export function brushCells(center: number, size: BrushSize, width: number, height: number): number[] {
  if (center < 0) return [];
  const radius = brushRadius(size);
  const col = center % width;
  const row = (center - col) / width;
  const out: number[] = [];
  for (let r = row - radius; r <= row + radius; r++) {
    if (r < 0 || r >= height) continue;
    for (let c = col - radius - 1; c <= col + radius + 1; c++) {
      if (c < 0 || c >= width) continue;
      if (hexDistance(col, row, c, r) <= radius) out.push(r * width + c);
    }
  }
  return out;
}
