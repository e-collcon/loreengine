/**
 * The vector art pipeline (spec 6.7). Vector art is baked, not drawn live:
 * thousands of SVG paths per frame would cost far more than one batched atlas.
 *
 *   1. Take a set of SVG sources. A frame's name is its path without the
 *      extension, e.g. `knight/attack-swing/dir2/03`.
 *   2. Rasterize each at 1x and 2x of pixelsPerUnit.
 *   3. Read the anchor from an element with id="anchor"; the default is
 *      bottom center.
 *   4. Pack into pages of at most 4096 x 4096, store the pages through the
 *      blob store, and write the AtlasDef.
 *
 * Sources stay in the project, so adding a tier is a re-bake, never a
 * re-draw. This module is pure: rasterizing, encoding, and storing are
 * injected (`bake-browser.ts` supplies the browser's).
 */
import type { AssetRef, AtlasDef, Id } from '@loreengine/schema';

export const MAX_PAGE = 4096;
export const TIER_SCALES = [1, 2] as const;

export interface SvgSource {
  /** The vector source asset this frame comes from. */
  assetId: Id<'asset'>;
  /** Its path, e.g. `hero/idle/0.svg`. */
  name: string;
  svg: string;
}

/** RGBA pixels, row by row. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface BakeTools {
  /** Draw an SVG into a raster of exactly this size. */
  rasterize(svg: string, width: number, height: number): Promise<Raster>;
  /** Encode a page as an image file (PNG in the browser). */
  encode(page: Raster): Promise<{ bytes: Uint8Array; mime: string }>;
  /** Store bytes and get back their AssetRef (`Storage.putBlob` fits). */
  putBlob(bytes: Uint8Array, mime: string, extra: { width: number; height: number }): Promise<AssetRef>;
}

export interface BakeResult {
  /**
   * The baked atlases. Normally one. The schema gives an atlas one page per
   * tier, so frames that overflow a 4096 x 4096 page go into further
   * atlases, whose ids come from `newId`.
   */
  atlases: AtlasDef[];
  /** The pages as rasters, by blob id, for a renderer that wants them without a round trip through storage. */
  pages: Map<string, Raster>;
}

/** A frame's name is its source's path without the `.svg` extension. */
export function frameNameOf(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\.svg$/i, '');
}

/** The size an SVG declares: its width and height attributes, or its viewBox. */
export function svgSize(svg: string): { width: number; height: number } {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const attr = (name: string): number | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9.]+)(?:px)?\\s*["']`, 'i').exec(open);
    return m ? Number(m[1]) : null;
  };
  let width = attr('width');
  let height = attr('height');
  if (width === null || height === null) {
    const box = /\bviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(open);
    if (box) {
      width ??= Number(box[1]);
      height ??= Number(box[2]);
    }
  }
  if (!width || !height) throw new Error('an SVG source needs a width and height, or a viewBox');
  return { width, height };
}

/**
 * The anchor of an SVG: the position of the element with id="anchor" (its
 * cx/cy, or x/y), in the SVG's own units. The default is bottom center.
 */
export function svgAnchor(svg: string, width: number, height: number): { x: number; y: number } {
  const tag = /<[a-z]+\b[^>]*\bid\s*=\s*["']anchor["'][^>]*>/i.exec(svg)?.[0];
  if (tag) {
    const attr = (name: string): number | null => {
      const m = new RegExp(`\\b${name}\\s*=\\s*["']\\s*(-?[0-9.]+)\\s*["']`, 'i').exec(tag);
      return m ? Number(m[1]) : null;
    };
    const x = attr('cx') ?? attr('x');
    const y = attr('cy') ?? attr('y');
    if (x !== null && y !== null) return { x, y };
  }
  return { x: width / 2, y: height };
}

export interface Placement {
  index: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Shelf-pack rectangles into pages of at most `maxPage` square, tallest
 * first, with `padding` pixels between them. A rectangle larger than a page
 * is an error. Returns one placement per input, in input order, and each
 * page's used size.
 */
export function packFrames(sizes: readonly { w: number; h: number }[], maxPage = MAX_PAGE, padding = 1): { placements: Placement[]; pages: { width: number; height: number }[] } {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]!.h - sizes[a]!.h || sizes[b]!.w - sizes[a]!.w || a - b);
  const placements: Placement[] = new Array<Placement>(sizes.length);
  const pages: { width: number; height: number }[] = [];
  let page = -1;
  let x = 0;
  let y = 0;
  let shelf = 0;
  const open = (): void => {
    pages.push({ width: 0, height: 0 });
    page = pages.length - 1;
    x = 0;
    y = 0;
    shelf = 0;
  };
  open();
  for (const i of order) {
    const { w, h } = sizes[i]!;
    if (w > maxPage || h > maxPage) throw new Error(`a ${w} x ${h} frame does not fit a ${maxPage} x ${maxPage} page`);
    if (x + w > maxPage) {
      // Next shelf.
      y += shelf + padding;
      x = 0;
      shelf = 0;
    }
    if (y + h > maxPage) open(); // the packer opens a new page
    placements[i] = { index: i, page, x, y, w, h };
    x += w + padding;
    if (h > shelf) shelf = h;
    const p = pages[page]!;
    if (x - padding > p.width) p.width = x - padding;
    if (y + h > p.height) p.height = y + h;
  }
  return { placements, pages };
}

/** Bake SVG sources into an atlas with a 1x and a 2x tier. */
export async function bakeAtlas(
  atlasId: Id<'atlas'>,
  sources: readonly SvgSource[],
  tools: BakeTools,
  options: { maxPage?: number; scales?: readonly (1 | 2)[]; newId?: () => string } = {},
): Promise<BakeResult> {
  const maxPage = options.maxPage ?? MAX_PAGE;
  const scales = options.scales ?? TIER_SCALES;
  const base = sources.map((source) => {
    const size = svgSize(source.svg);
    return { source, name: frameNameOf(source.name), ...size, anchor: svgAnchor(source.svg, size.width, size.height) };
  });
  const names = new Set<string>();
  for (const b of base) {
    if (names.has(b.name)) throw new Error(`two sources bake to the same frame name "${b.name}"`);
    names.add(b.name);
  }

  // Pack at the largest tier, so every tier puts each frame on the same page.
  const top = Math.max(...scales);
  const packed = packFrames(base.map((b) => ({ w: Math.ceil(b.width * top), h: Math.ceil(b.height * top) })), maxPage);
  const pages = new Map<string, Raster>();
  const atlases: AtlasDef[] = [];

  for (let page = 0; page < packed.pages.length; page++) {
    const members = packed.placements.filter((p) => p.page === page);
    const tiers: AtlasDef['tiers'] = [];
    for (const scale of scales) {
      const k = scale / top;
      const width = Math.max(1, Math.ceil(packed.pages[page]!.width * k));
      const height = Math.max(1, Math.ceil(packed.pages[page]!.height * k));
      const raster: Raster = { width, height, data: new Uint8ClampedArray(width * height * 4) };
      const frames: AtlasDef['tiers'][number]['frames'] = {};
      for (const place of members) {
        const b = base[place.index]!;
        const w = Math.ceil(b.width * scale);
        const h = Math.ceil(b.height * scale);
        const x = Math.floor(place.x * k);
        const y = Math.floor(place.y * k);
        const tile = await tools.rasterize(b.source.svg, w, h);
        for (let row = 0; row < h; row++) {
          raster.data.set(tile.data.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * width + x) * 4);
        }
        frames[b.name] = { x, y, w, h, anchorX: b.anchor.x * scale, anchorY: b.anchor.y * scale };
      }
      const encoded = await tools.encode(raster);
      const image = await tools.putBlob(encoded.bytes, encoded.mime, { width, height });
      pages.set(image.blobId, raster);
      tiers.push({ scale, image, frames });
    }
    const id = page === 0 ? atlasId : ((options.newId?.() ?? `${atlasId}-${page}`) as Id<'atlas'>);
    atlases.push({ id, sourceIds: members.map((p) => base[p.index]!.source.assetId), tiers });
  }
  return { atlases, pages };
}
