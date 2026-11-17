/**
 * Atlas lookup (spec 6.6, 6.7). A `FrameRef` names a frame of an atlas;
 * an atlas has one page per tier (1x and 2x). The tier used is the
 * smallest at or above the zoom, so art is never upscaled when a sharper
 * tier exists.
 */
import type { AssetRef, AtlasDef } from '@loreengine/schema';

export type AtlasTier = AtlasDef['tiers'][number];

export interface AtlasFrame {
  atlasId: string;
  /** The tier this frame was taken from. */
  scale: number;
  /** The page it is on. */
  image: AssetRef;
  /** Rectangle on the page, in page pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The anchor, in pixels from the frame's top-left corner. */
  anchorX: number;
  anchorY: number;
  /** The same rectangle as fractions of the page (0..1), from `image.width` and `image.height`. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** The smallest tier at or above `zoom`; the largest when none is. */
export function pickTier(tiers: readonly AtlasTier[], zoom: number): AtlasTier {
  let best: AtlasTier | null = null;
  let largest = tiers[0]!;
  for (const tier of tiers) {
    if (tier.scale > largest.scale) largest = tier;
    if (tier.scale >= zoom && (best === null || tier.scale < best.scale)) best = tier;
  }
  return best ?? largest;
}

export class AtlasIndex {
  private readonly byId = new Map<string, AtlasDef>();
  private readonly cache = new Map<string, AtlasFrame | null>();

  constructor(atlases: readonly AtlasDef[]) {
    for (const atlas of atlases) this.byId.set(atlas.id, atlas);
  }

  has(atlasId: string): boolean {
    return this.byId.has(atlasId);
  }

  /** Look up a frame at the tier for `zoom`. Null when the atlas or the frame does not exist. */
  frame(atlasId: string, name: string, zoom: number): AtlasFrame | null {
    const atlas = this.byId.get(atlasId);
    if (!atlas) return null;
    const tier = pickTier(atlas.tiers, zoom);
    const key = `${atlasId}\n${tier.scale}\n${name}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const f = tier.frames[name];
    let out: AtlasFrame | null = null;
    if (f) {
      const pageW = tier.image.width ?? f.x + f.w;
      const pageH = tier.image.height ?? f.y + f.h;
      out = {
        atlasId,
        scale: tier.scale,
        image: tier.image,
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        anchorX: f.anchorX,
        anchorY: f.anchorY,
        u0: f.x / pageW,
        v0: f.y / pageH,
        u1: (f.x + f.w) / pageW,
        v1: (f.y + f.h) / pageH,
      };
    }
    this.cache.set(key, out);
    return out;
  }
}
