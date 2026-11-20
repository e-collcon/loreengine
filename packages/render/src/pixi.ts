/**
 * The PixiJS renderer (spec 6.6, Q3). It reads the runtime view and never
 * writes it. This is the only module that imports `pixi.js`; projection,
 * geometry, depth order, and picking are pure modules beside it.
 *
 * Spike scope: terrain strips with cliff faces, placeholder vector sprites,
 * row-strip depth order, picking, camera, the tint seam. Atlas textures,
 * animation playback, feedback, particles, and the occlusion silhouette
 * arrive with the rest of Phase 3B.
 */
import { Application, Container, Graphics, Mesh, MeshGeometry, Rectangle, Sprite, Texture } from 'pixi.js';
import type { AnimationSetDef, AssetRef, AtlasDef, AttackDef } from '@loreengine/schema';
import type { RuntimeView } from '@loreengine/runtime/view';
import { spriteFrame } from './animation.ts';
import { AtlasIndex } from './atlas.ts';
import type { AtlasFrame } from './atlas.ts';
import { rasterToCanvas } from './bake-browser.ts';
import type { Raster } from './bake.ts';
import { DrawList, ITEM_STRIP } from './drawlist.ts';
import type { Feedback } from './feedback.ts';
import { pickEntity, pickTerrain } from './picking.ts';
import type { TerrainPick } from './picking.ts';
import { ISO_RATIO, clampZoom, createCamera, projectX, projectY } from './projection.ts';
import type { Camera } from './projection.ts';
import { silhouettes } from './silhouette.ts';
import { colorOf, shade, spriteMetrics } from './sprites.ts';
import { buildStrip, maxSurface } from './terrain.ts';
import type { StripGeometry } from './terrain.ts';

/**
 * Resolves an AssetRef to its bytes. The client injects it; the renderer
 * never imports `storage`, so swapping the storage backend changes no
 * renderer code. Unused until atlas pages exist (chunk 7).
 */
export type AssetResolver = (ref: AssetRef) => Promise<Uint8Array | null>;

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  resolveAsset?: AssetResolver;
  background?: number;
  /** Device pixel ratio to render at. Default 1. */
  resolution?: number;
}

interface EntitySprite {
  id: number;
  root: Container;
  /** The placeholder figure's facing dot; null for a textured sprite. */
  nose: Graphics | null;
  noseRadius: number;
  noseHeight: number;
  /** The atlas sprite and its animation set, when the entity's art is baked. */
  art: Sprite | null;
  set: AnimationSetDef | null;
  scale: number;
}

/** UV of a hex top's seven vertices inside its frame: the center, then corners 0..5. */
/** Rises (terraced slopes, blended corners) are drawn a little darker, so terraces read as steps. */
const RISE_TINT = 0xd6d2c8;

/**
 * Destroy a display tree and what its nodes own: a Mesh's geometry (its GPU
 * buffers) and a Graphics' own context. PixiJS's `destroy({ children: true })`
 * keeps both, which a long-lived renderer would pile up with every rebuilt
 * strip (D163). Textures are not touched: frames and pages have owners.
 */
export function release(node: Container): void {
  const visit = (n: Container): void => {
    for (const child of n.children) visit(child);
    if (n instanceof Mesh) n.geometry.destroy(true); // true: its buffers too
  };
  visit(node);
  node.destroy({ children: true, context: true });
}

/** Atlas pages as textures, owned by whoever made them; renderers borrow them (`useSharedArt`). */
export class SharedArt {
  readonly pages = new Map<string, Texture>();
  private destroyed = false;

  constructor(
    readonly atlases: readonly AtlasDef[],
    pages: ReadonlyMap<string, Raster>,
  ) {
    for (const [blobId, raster] of pages) this.pages.set(blobId, Texture.from(rasterToCanvas(raster)));
  }

  get size(): number {
    return this.pages.size;
  }

  /** Only once no renderer draws from it any more. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const texture of this.pages.values()) texture.destroy(true);
    this.pages.clear();
  }
}

/**
 * A hitbox's outline on the ground, as world (x, y) pairs written into `out`,
 * for an attacker at (x, y) facing `facing`. Returns the number of points.
 * The telegraph and the editor's debug overlay draw the same shape.
 */
export function hitboxOutline(h: AttackDef['hitbox'], x: number, y: number, facing: number, out: number[]): number {
  out.length = 0;
  const at = (px: number, py: number): void => void out.push(px, py);
  if (h.shape === 'arc') {
    const half = (h.arcDeg * Math.PI) / 360;
    if (h.arcDeg < 360) at(x, y);
    for (let k = 0; k <= 24; k++) {
      const a = facing - half + (2 * half * k) / 24;
      at(x + Math.cos(a) * h.range, y + Math.sin(a) * h.range);
    }
  } else if (h.shape === 'circle') {
    const cx = x + Math.cos(facing) * h.offset;
    const cy = y + Math.sin(facing) * h.offset;
    for (let k = 0; k < 32; k++) at(cx + Math.cos((k * Math.PI) / 16) * h.radius, cy + Math.sin((k * Math.PI) / 16) * h.radius);
  } else {
    const nx = -Math.sin(facing) * (h.width / 2);
    const ny = Math.cos(facing) * (h.width / 2);
    at(x + nx, y + ny);
    at(x + Math.cos(facing) * h.length + nx, y + Math.sin(facing) * h.length + ny);
    at(x + Math.cos(facing) * h.length - nx, y + Math.sin(facing) * h.length - ny);
    at(x - nx, y - ny);
  }
  return out.length / 2;
}

export class PixiRenderer {
  readonly camera: Camera;
  readonly drawList = new DrawList();
  private readonly world = new Container();
  private readonly strips = new Map<number, Container>();
  private readonly sprites = new Map<number, EntitySprite>();
  private atlas: AtlasIndex | null = null;
  private readonly pages = new Map<string, Texture>();
  /** Pages from a `SharedArt`: drawn from, never destroyed here. */
  private readonly borrowed = new Set<string>();
  private readonly frames = new Map<string, Texture>();
  private readonly setById = new Map<string, AnimationSetDef>();
  private readonly particles: Sprite[] = [];
  private readonly ghosts: Sprite[] = [];
  private readonly ghostOf = new Int32Array(4);
  private readonly indicator = new Graphics();
  private readonly highlight = new Graphics();
  private readonly metrics = { width: 0, height: 0 };
  private readonly outline: number[] = [];
  private mapId = '';
  private top = 0;
  private highlighted = -1;
  private destroyed = false;

  private constructor(
    private readonly app: Application,
    private view: RuntimeView,
    readonly resolveAsset: AssetResolver,
    width: number,
    height: number,
  ) {
    // The camera works in CSS pixels; the device pixel ratio is the renderer's business.
    this.camera = createCamera(width, height);
    this.world.sortableChildren = true;
    this.highlight.zIndex = 1_000_000;
    this.world.addChild(this.highlight);
    this.world.addChild(this.indicator);
    for (const set of view.project.animationSets) this.setById.set(set.id, set);
    app.stage.addChild(this.world);
  }

  static async create(view: RuntimeView, options: RendererOptions): Promise<PixiRenderer> {
    const app = new Application();
    await app.init({
      canvas: options.canvas,
      width: options.width,
      height: options.height,
      background: options.background ?? 0x14161a,
      antialias: true,
      resolution: options.resolution ?? 1,
      autoDensity: true,
      autoStart: false, // the client drives frames
      preference: 'webgl',
    });
    return new PixiRenderer(app, view, options.resolveAsset ?? (async () => null), options.width, options.height);
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.camera.width = width;
    this.camera.height = height;
  }

  setZoom(zoom: number): void {
    this.camera.zoom = clampZoom(zoom);
  }

  /**
   * Give the renderer baked atlases and their pages (by blob id). Frames
   * found in them are drawn from the atlas; anything else keeps its
   * engine placeholder shape.
   */
  /** The canvas this renderer draws into (a borrowed renderer moves it between hosts). */
  get canvas(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  /**
   * Draw another view from now on: the editor keeps one renderer for every
   * playtest, so PixiJS's per-renderer caches do not grow with each Play
   * (DECISIONS D162). Everything drawn for the previous view is released.
   */
  attach(view: RuntimeView): void {
    this.detach();
    this.view = view;
    this.setById.clear();
    for (const set of view.project.animationSets) this.setById.set(set.id, set);
  }

  /**
   * Release what was loaded for the current view: strips, sprites, frame
   * textures, owned pages, the atlas index. Borrowed pages stay with their owner.
   */
  detach(): void {
    if (this.destroyed) return;
    for (const strip of this.strips.values()) release(strip);
    this.strips.clear();
    for (const sprite of this.sprites.values()) release(sprite.root);
    this.sprites.clear();
    for (const sprite of [...this.particles, ...this.ghosts]) {
      sprite.visible = false;
      sprite.texture = Texture.EMPTY;
    }
    this.dropPages();
    this.atlas = null;
    this.indicator.clear();
    this.highlight.clear();
    this.highlighted = -1;
    this.mapId = '';
    this.world.tint = 0xffffff;
  }

  setAtlases(atlases: readonly AtlasDef[], pages: ReadonlyMap<string, Raster>): void {
    this.dropPages();
    for (const [blobId, raster] of pages) this.pages.set(blobId, Texture.from(rasterToCanvas(raster)));
    this.useAtlases(atlases);
  }

  /**
   * Draw from art someone else owns (the editor's, shared by every playtest:
   * DECISIONS N9). The renderer never destroys these pages, so their texture
   * ids stay the same from one renderer to the next.
   */
  useSharedArt(art: SharedArt): void {
    this.dropPages();
    for (const [blobId, texture] of art.pages) {
      this.pages.set(blobId, texture);
      this.borrowed.add(blobId);
    }
    this.useAtlases(art.atlases);
  }

  private dropPages(): void {
    for (const texture of this.frames.values()) texture.destroy(false);
    for (const [blobId, texture] of this.pages) if (!this.borrowed.has(blobId)) texture.destroy(true);
    this.frames.clear();
    this.pages.clear();
    this.borrowed.clear();
  }

  private useAtlases(atlases: readonly AtlasDef[]): void {
    this.atlas = new AtlasIndex(atlases);
    this.invalidateTerrain();
    for (const sprite of this.sprites.values()) release(sprite.root);
    this.sprites.clear();
  }

  /** The texture of one atlas frame at the current zoom's tier, or null when it is not baked. */
  private frameTexture(atlasId: string, name: string): { texture: Texture; frame: AtlasFrame } | null {
    if (this.atlas === null) return null;
    const frame = this.atlas.frame(atlasId, name, this.camera.zoom);
    if (frame === null) return null;
    const page = this.pages.get(frame.image.blobId);
    if (!page) return null;
    const key = `${frame.image.blobId}\n${name}`;
    let texture = this.frames.get(key);
    if (!texture) {
      texture = new Texture({ source: page.source, frame: new Rectangle(frame.x, frame.y, frame.w, frame.h) });
      this.frames.set(key, texture);
    }
    return { texture, frame };
  }

  /** The tint seam (spec 6.6): multiplies the scene. Nothing calls it until Phase 14. */
  setWorldTint(rgb: number): void {
    this.world.tint = rgb;
  }

  /** Drop cached terrain geometry: call after the map's layers are edited. */
  invalidateTerrain(): void {
    for (const strip of this.strips.values()) release(strip);
    this.strips.clear();
    this.top = this.view.world.loaded ? maxSurface(this.view.world, this.view.project.settings.levelHeight) : 0;
  }

  /** Outline one cell's top (the current pick), or -1 for none. */
  setHighlight(cell: number): void {
    if (cell === this.highlighted) return;
    this.highlighted = cell;
    const g = this.highlight;
    g.clear();
    const world = this.view.world;
    if (cell < 0 || !world.loaded) return;
    const strip = buildStrip(world, this.view.project, Math.floor(cell / world.width));
    const top = strip.tops[cell % world.width]!;
    const points: number[] = [];
    for (const v of top.outline) points.push(top.vertices[v * 2]!, top.vertices[v * 2 + 1]!);
    g.poly(points).fill({ color: 0xffffff, alpha: 0.28 }).stroke({ color: 0xfff27a, width: 3, alpha: 0.95 });
  }

  pickTerrain(sx: number, sy: number, out: TerrainPick): boolean {
    return pickTerrain(this.view.world, this.view.project.settings, this.camera, sx, sy, out);
  }

  /** The front-most entity under a screen point (as of the last rendered frame), or -1. */
  pickEntity(sx: number, sy: number): number {
    return pickEntity(this.drawList, sx, sy);
  }

  /** Draw one frame. `alpha` is the client's leftover tick fraction, 0..1; `feedback` supplies flash, shake, particles and telegraphs. */
  render(alpha: number, feedback: Feedback | null = null): void {
    if (this.destroyed) return;
    const view = this.view;
    const cam = this.camera;
    const ppu = view.project.settings.pixelsPerUnit;
    if (view.currentMapId !== this.mapId || !view.world.loaded) {
      this.mapId = view.world.loaded ? view.currentMapId : '';
      this.invalidateTerrain();
      this.highlighted = -2;
      this.setHighlight(-1);
    }

    // World pixels -> screen: scale by zoom about the camera's focus.
    this.world.scale.set(cam.zoom);
    this.world.position.set(cam.width / 2 - projectX(cam.x, ppu) * cam.zoom, cam.height / 2 - projectY(cam.y, cam.z, ppu) * cam.zoom);
    // The atlas tier follows the zoom: rebuild textured terrain when it crosses 1.
    const tier = cam.zoom > 1 ? 2 : 1;
    if (tier !== this.tier) {
      this.tier = tier;
      if (this.atlas !== null) this.invalidateTerrain();
    }

    const list = this.drawList;
    list.build(view, cam, alpha, this.top);

    for (const [row, strip] of this.strips) strip.visible = row >= list.firstRow && row <= list.lastRow;
    for (const sprite of this.sprites.values()) sprite.root.visible = false;

    const entities = view.entities;
    for (let i = 0; i < list.count; i++) {
      const ref = list.ref[i]!;
      if (list.kind[i] === ITEM_STRIP) {
        this.stripFor(ref).zIndex = i * 2;
        this.stripZ[ref & 255] = i * 2;
        continue;
      }
      const sprite = this.spriteFor(ref);
      sprite.root.visible = true;
      sprite.root.zIndex = i * 2;
      // Screen -> world pixels, the space the world container's children live in.
      sprite.root.position.set((list.footX[ref]! - this.world.position.x) / cam.zoom, (list.footY[ref]! - this.world.position.y) / cam.zoom);
      const facing = entities.facing(ref);
      const flash = feedback === null ? -1 : feedback.flashOf(entities.id(ref));
      if (sprite.art !== null && sprite.set !== null) {
        // Animation playback: the runtime says which clip and frame; draw that atlas frame.
        const pose = spriteFrame(sprite.set, entities.clip(ref), entities.frame(ref), facing);
        const found = pose === null ? null : this.frameTexture(sprite.set.atlasId, pose.frame);
        if (found !== null) {
          sprite.art.texture = found.texture;
          sprite.art.anchor.set(found.frame.anchorX / found.frame.w, found.frame.anchorY / found.frame.h);
          const k = sprite.scale / found.frame.scale;
          sprite.art.scale.set(pose!.flip ? -k : k, k);
        }
        sprite.art.tint = flash >= 0 ? flash : 0xffffff;
      } else if (sprite.nose !== null) {
        sprite.root.alpha = entities.dead(ref) ? 0.35 : 1;
        sprite.nose.position.set(Math.cos(facing) * sprite.noseRadius, Math.sin(facing) * sprite.noseRadius * ISO_RATIO - sprite.noseHeight);
      }
    }
    this.drawFeedback(feedback, list);

    // Release sprites of entities that no longer exist.
    for (const [index, sprite] of this.sprites) {
      if (!entities.alive(index) || entities.id(index) !== sprite.id) {
        release(sprite.root);
        this.sprites.delete(index);
      }
    }
    this.app.render();
  }

  private tier = 1;
  /** zIndex of each visible strip, by row, for things drawn on the ground. */
  private readonly stripZ = new Float64Array(256);

  /** Telegraphs, particles, shake, and occlusion silhouettes. */
  private drawFeedback(feedback: Feedback | null, list: DrawList): void {
    const view = this.view;
    const cam = this.camera;
    const ppu = view.project.settings.pixelsPerUnit;
    const entities = view.entities;
    const g = this.indicator;
    g.clear();
    let live = 0;
    if (feedback !== null) {
      // Screen shake: the whole world, by the summed and capped offset.
      this.world.position.x += feedback.shakeOffsetX * ppu * cam.zoom;
      this.world.position.y += feedback.shakeOffsetY * ppu * cam.zoom * ISO_RATIO;

      // Ground indicators: the attack's hitbox, drawn on the ground under the attacker.
      let z = 0;
      for (const ind of feedback.indicators) {
        if (!entities.alive(ind.entity)) continue;
        const ex = entities.x(ind.entity);
        const ey = entities.y(ind.entity);
        const ez = entities.z(ind.entity);
        const f = entities.facing(ind.entity);
        const points: number[] = [];
        const outline = hitboxOutline(ind.hitbox, ex, ey, f, this.outline);
        for (let k = 0; k < outline; k++) points.push(projectX(this.outline[k * 2]!, ppu), projectY(this.outline[k * 2 + 1]!, ez, ppu));
        const progress = 1 - ind.msLeft / ind.msTotal;
        g.poly(points).fill({ color: 0xff3b30, alpha: 0.18 + 0.3 * progress }).stroke({ color: 0xff6b5e, width: 2, alpha: 0.9 });
        const row = list.sortRow[ind.entity]! & 255;
        if (this.stripZ[row]! + 1 > z) z = this.stripZ[row]! + 1;
      }
      g.zIndex = z; // just above the terrain of the attacker's strip, below the entities standing in it

      // Particles, from the fixed pool.
      for (let i = 0; i < feedback.particleCount; i++) {
        const ref = feedback.particleFrame(i);
        const found = this.frameTexture(ref.atlasId, ref.frame);
        if (found === null) continue;
        let sprite = this.particles[live];
        if (!sprite) {
          sprite = new Sprite(found.texture);
          sprite.anchor.set(0.5);
          sprite.zIndex = 1_500_000;
          this.world.addChild(sprite);
          this.particles.push(sprite);
        }
        sprite.texture = found.texture;
        sprite.visible = true;
        sprite.position.set(projectX(feedback.px[i]!, ppu), projectY(feedback.py[i]!, feedback.pz[i]!, ppu));
        sprite.scale.set(feedback.pScale[i]! / found.frame.scale);
        sprite.alpha = feedback.particleAlpha(i);
        live++;
      }
    }
    for (let i = live; i < this.particles.length; i++) this.particles[i]!.visible = false;

    // Occlusion silhouettes: a tinted copy of a covered unit, drawn through whatever covers it.
    const n = silhouettes(view, cam, list, this.ghostOf);
    for (let k = 0; k < this.ghosts.length || k < n; k++) {
      let ghost = this.ghosts[k];
      const source = k < n ? this.sprites.get(this.ghostOf[k]!) : undefined;
      if (!source || source.art === null) {
        if (ghost) ghost.visible = false;
        continue;
      }
      if (!ghost) {
        ghost = new Sprite(source.art.texture);
        ghost.zIndex = 1_200_000;
        ghost.tint = 0x7fd4ff;
        ghost.alpha = 0.45;
        this.world.addChild(ghost);
        this.ghosts[k] = ghost;
      }
      ghost.visible = true;
      ghost.texture = source.art.texture;
      ghost.anchor.copyFrom(source.art.anchor);
      ghost.scale.copyFrom(source.art.scale);
      ghost.position.copyFrom(source.root.position);
    }
  }

  /** A strip drawn from the atlas: one textured mesh of hex tops, and one of cliff faces per facing. */
  private texturedStrip(strip: StripGeometry): Container | null {
    const first = strip.tops[0];
    if (!first) return null;
    const probe = this.frameTexture(first.frame.atlasId, first.frame.frame);
    if (probe === null) return null;
    const page = this.pages.get(probe.frame.image.blobId)!;
    const inset = 0.6; // half a texel and a bit, so neighbors on the page do not bleed in
    let vertexCount = 0;
    let flatCount = 0;
    let riseCount = 0;
    for (const top of strip.tops) {
      vertexCount += top.heights.length;
      flatCount += top.flat.length;
      riseCount += top.rise.length;
    }
    const positions = new Float32Array(vertexCount * 2);
    const uvs = new Float32Array(vertexCount * 2);
    const flat = new Uint32Array(flatCount);
    const rise = new Uint32Array(riseCount);
    let base = 0;
    let fi = 0;
    let ri = 0;
    for (const top of strip.tops) {
      const found = this.frameTexture(top.frame.atlasId, top.frame.frame);
      if (found === null || found.frame.image.blobId !== probe.frame.image.blobId) return null;
      const f = found.frame;
      const pw = f.w / (f.u1 - f.u0);
      const ph = f.h / (f.v1 - f.v0);
      positions.set(top.vertices, base * 2);
      const n = top.heights.length;
      for (let v = 0; v < n; v++) {
        // The top art covers the hex's bounding box: width sqrt(3) x size, height 2 x size.
        const u = 0.5 + top.local[v * 2]! / Math.sqrt(3);
        const w = 0.5 + top.local[v * 2 + 1]! / 2;
        uvs[(base + v) * 2] = (f.x + inset + u * (f.w - 2 * inset)) / pw;
        uvs[(base + v) * 2 + 1] = (f.y + inset + w * (f.h - 2 * inset)) / ph;
      }
      for (const k of top.flat) flat[fi++] = k + base;
      for (const k of top.rise) rise[ri++] = k + base;
      base += n;
    }
    const root = new Container();
    if (flat.length > 0) root.addChild(new Mesh({ geometry: new MeshGeometry({ positions, uvs, indices: flat }), texture: page }));
    if (rise.length > 0) {
      const mesh = new Mesh({ geometry: new MeshGeometry({ positions: positions.slice(), uvs: uvs.slice(), indices: rise }), texture: page });
      mesh.tint = RISE_TINT;
      root.addChild(mesh);
    }
    for (const dir of [5, 6] as const) {
      const faces = strip.faces.filter((face) => face.dir === dir);
      if (faces.length === 0) continue;
      const fp = new Float32Array(faces.length * 8);
      const fu = new Float32Array(faces.length * 8);
      const fi = new Uint32Array(faces.length * 6);
      let ok = true;
      faces.forEach((face, q) => {
        const cliff = face.frame ? this.frameTexture(face.frame.atlasId, face.frame.frame) : null;
        if (cliff === null || cliff.frame.image.blobId !== probe.frame.image.blobId) {
          ok = false;
          return;
        }
        const f = cliff.frame;
        const pw = f.w / (f.u1 - f.u0);
        const ph = f.h / (f.v1 - f.v0);
        fp.set(face.vertices, q * 8);
        const u0 = (f.x + inset) / pw;
        const u1 = (f.x + f.w - inset) / pw;
        const v0 = (f.y + inset) / ph;
        const v1 = (f.y + f.h - inset) / ph;
        fu.set([u0, v0, u1, v0, u1, v1, u0, v1], q * 8);
        fi.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
      });
      if (!ok) {
        release(root);
        return null;
      }
      const mesh = new Mesh({ geometry: new MeshGeometry({ positions: fp, uvs: fu, indices: fi }), texture: page });
      mesh.tint = dir === 5 ? 0xd0d0d0 : 0x909090; // two tones, so a column reads as a solid
      root.addChild(mesh);
    }
    return root;
  }

  private stripFor(row: number): Container {
    const cached = this.strips.get(row);
    if (cached) return cached;
    const strip = buildStrip(this.view.world, this.view.project, row);
    const textured = this.texturedStrip(strip);
    if (textured !== null) {
      this.strips.set(row, textured);
      this.world.addChild(textured);
      return textured;
    }
    const g = new Graphics();
    for (const top of strip.tops) {
      // Placeholder art: the frame's color, a little lighter with each level; rises a little darker.
      const color = shade(colorOf(top.frame.frame), 1 + top.level * 0.05);
      const tri = (list: Uint16Array, c: number) => {
        for (let k = 0; k < list.length; k += 3) {
          const p = [list[k]!, list[k + 1]!, list[k + 2]!].flatMap((v) => [top.vertices[v * 2]!, top.vertices[v * 2 + 1]!]);
          g.poly(p).fill({ color: c });
        }
      };
      tri(top.flat, color);
      tri(top.rise, shade(color, 0.86));
      const outline: number[] = [];
      for (const v of top.outline) outline.push(top.vertices[v * 2]!, top.vertices[v * 2 + 1]!);
      g.poly(outline).stroke({ color: shade(color, 0.72), width: 1.5, alpha: 0.55 });
    }
    for (const face of strip.faces) {
      const base = colorOf(face.frame ? face.frame.frame : 'cliff');
      const color = shade(base, face.dir === 5 ? 0.82 : 0.6); // two tones, so the column reads as a solid
      g.poly(Array.from(face.vertices)).fill({ color }).stroke({ color: shade(base, 0.4), width: 1, alpha: 0.6 });
    }
    this.strips.set(row, g);
    this.world.addChild(g);
    return g;
  }

  private spriteFor(index: number): EntitySprite {
    const entities = this.view.entities;
    const id = entities.id(index);
    const existing = this.sprites.get(index);
    if (existing && existing.id === id) return existing;
    if (existing) release(existing.root);

    const ppu = this.view.project.settings.pixelsPerUnit;
    const data = entities.data(index);
    // Baked art, when the entity's animation set and its idle frame are in an atlas.
    const set = data.sprite ? (this.setById.get(data.sprite.animationSetId) ?? null) : null;
    const idle = set ? spriteFrame(set, set.stateClips.idle, 0, 0) : null;
    const baked = set && idle ? this.frameTexture(set.atlasId, idle.frame) : null;
    if (set && baked) {
      const root = new Container();
      const art = new Sprite(baked.texture);
      root.addChild(art);
      this.world.addChild(root);
      const made: EntitySprite = { id, root, nose: null, noseRadius: 0, noseHeight: 0, art, set, scale: data.sprite!.scale ?? 1 };
      this.sprites.set(index, made);
      return made;
    }
    spriteMetrics(data, this.metrics);
    const w = this.metrics.width * ppu;
    const h = this.metrics.height * ppu;
    const color = colorOf(this.view.project.archetypes[entities.archetype(index)]!.name);
    const dark = shade(color, 0.45);

    const root = new Container();
    const body = new Graphics();
    body.ellipse(0, 0, w * 0.62, w * 0.62 * ISO_RATIO).fill({ color: 0x000000, alpha: 0.28 }); // ground shadow
    body.roundRect(-w / 2, -h * 0.74, w, h * 0.74, w * 0.38).fill({ color }).stroke({ color: dark, width: 2 });
    body.circle(0, -h * 0.8, w * 0.4).fill({ color: shade(color, 1.2) }).stroke({ color: dark, width: 2 });
    const nose = new Graphics();
    nose.circle(0, 0, Math.max(3, w * 0.13)).fill({ color: 0xffffff }).stroke({ color: dark, width: 1.5 });
    root.addChild(body, nose);
    this.world.addChild(root);
    const sprite: EntitySprite = { id, root, nose, noseRadius: w * 0.5, noseHeight: h * 0.42, art: null, set: null, scale: 1 };
    this.sprites.set(index, sprite);
    return sprite;
  }

  /** Counts the playtest leak gate compares (spec 9.5). */
  stats(): { strips: number; sprites: number; children: number; textures: number } {
    return { strips: this.strips.size, sprites: this.sprites.size, children: this.world.children.length, textures: this.pages.size - this.borrowed.size + this.frames.size };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.strips.clear();
    this.sprites.clear();
    // The scene and the renderer go first, so no shader still has a page bound when the pages are destroyed.
    this.app.destroy(false, { children: true });
    this.dropPages();
  }
}
