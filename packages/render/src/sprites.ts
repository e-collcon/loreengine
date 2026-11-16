/**
 * Placeholder sprites (kickoff §3.6): until the bake pipeline lands, every
 * entity is drawn as a vector figure sized from its collider and
 * `sprite.scale`. These metrics are also the sprite bounds that entity
 * picking tests against.
 */
import type { ComponentData } from '@loreengine/schema';

export interface SpriteMetrics {
  /** Size in world units; multiply by pixelsPerUnit and zoom for pixels. */
  width: number;
  height: number;
}

const DEFAULT_RADIUS = 0.35;
const DEFAULT_HEIGHT = 1.4;

/** Size of an entity's placeholder sprite, anchored bottom-center at its feet. */
export function spriteMetrics(data: Readonly<ComponentData>, out: SpriteMetrics): void {
  const scale = data.sprite?.scale ?? 1;
  const radius = data.collider?.radius ?? DEFAULT_RADIUS;
  const height = data.collider?.height ?? DEFAULT_HEIGHT;
  out.width = radius * 2 * 1.3 * scale;
  out.height = height * scale;
}

/** The footprint radius used for depth sorting: the collider's, or a default. */
export function footprintRadius(data: Readonly<ComponentData>): number {
  return data.collider?.radius ?? DEFAULT_RADIUS;
}

/** A stable placeholder color for a name (an archetype, a terrain frame). */
export function colorOf(name: string): number {
  const known = PLACEHOLDER_COLORS[name.replace(/^terrain\//, '')];
  if (known !== undefined) return known;
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return hsl((h % 360) / 360, 0.45, 0.55);
}

const PLACEHOLDER_COLORS: Record<string, number> = {
  grass: 0x6a9e4f,
  dirt: 0xa5855c,
  stone: 0x8f95a0,
  lava: 0xe0622c,
  water: 0x3f86cc,
  rock: 0x5d5766,
  cliff: 0x7a6a58,
  Hero: 0x3d7bfd,
  Elder: 0xe3c35b,
  Sentry: 0xd24a43,
  'Ember Warden': 0x8e2bd0,
  Dummy: 0xd9d4c7,
};

/** Multiply a 0xRRGGBB color's channels by `k`, clamped. */
export function shade(color: number, k: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)));
  return (c((color >> 16) & 255) << 16) | (c((color >> 8) & 255) << 8) | c(color & 255);
}

function hsl(h: number, s: number, l: number): number {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}
