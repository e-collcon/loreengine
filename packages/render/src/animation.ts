/**
 * Animation playback (spec 6.8). The runtime's animator says which clip,
 * which frame, and which facing. The renderer maps facing to the nearest of
 * the set's `directions`, flips when `mirror` is on, and draws the atlas frame.
 *
 * Direction k of N faces the angle k * 2 pi / N: 0 is east (+x), and angles
 * grow toward +y, which is down the screen. A clip's rows are its
 * directions in that order. With `mirror` on, only the right-facing and
 * vertical directions have rows (in ascending k); a left-facing direction
 * is drawn from its mirror image's row, flipped.
 */
import type { AnimationSetDef } from '@loreengine/schema';

export interface SpriteFrame {
  /** Atlas frame name. */
  frame: string;
  /** Draw it flipped left to right. */
  flip: boolean;
}

const TAU = Math.PI * 2;

/** The direction index, 0..N-1, nearest to `facing` (radians). */
export function nearestDirection(directions: number, facing: number): number {
  if (directions <= 1) return 0;
  const step = TAU / directions;
  return ((Math.round(facing / step) % directions) + directions) % directions;
}

/** Which row of a clip to draw for `facing`, and whether to flip it. */
export function directionRow(set: Pick<AnimationSetDef, 'directions' | 'mirror'>, facing: number): { row: number; flip: boolean } {
  const n = set.directions;
  if (n === 1) return { row: 0, flip: set.mirror && Math.cos(facing) < -1e-9 };
  let k = nearestDirection(n, facing);
  if (!set.mirror) return { row: k, flip: false };
  let flip = false;
  const leftFacing = Math.cos((k * TAU) / n) < -1e-9;
  if (leftFacing) {
    k = (((n / 2 - k) % n) + n) % n; // the mirror image about the vertical axis
    flip = true;
  }
  // Rows exist for directions whose cosine is >= 0, in ascending k.
  let row = 0;
  for (let d = 0; d < k; d++) if (Math.cos((d * TAU) / n) >= -1e-9) row++;
  return { row, flip };
}

/** The atlas frame to draw for a clip, a frame index, and a facing. Null when the set has no such clip. */
export function spriteFrame(set: AnimationSetDef, clipName: string, frameIndex: number, facing: number): SpriteFrame | null {
  const clip = set.clips[clipName];
  if (!clip) return null;
  const { row, flip } = directionRow(set, facing);
  const frames = clip.frames[row < clip.frames.length ? row : 0]!; // a clip with fewer rows uses its first
  const index = frameIndex < 0 ? 0 : frameIndex >= frames.length ? frames.length - 1 : frameIndex;
  return { frame: frames[index]!, flip };
}
