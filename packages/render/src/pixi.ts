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
import { Application, Container, Graphics } from 'pixi.js';
import type { AssetRef } from '@loreengine/schema';
import type { RuntimeView } from '@loreengine/runtime/view';
import { DrawList, ITEM_STRIP } from './drawlist.ts';
import { pickEntity, pickTerrain } from './picking.ts';
import type { TerrainPick } from './picking.ts';
import { ISO_RATIO, clampZoom, createCamera, projectX, projectY } from './projection.ts';
import type { Camera } from './projection.ts';
import { colorOf, shade, spriteMetrics } from './sprites.ts';
import { buildStrip, maxSurface } from './terrain.ts';

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
  nose: Graphics;
  noseRadius: number;
  noseHeight: number;
}

export class PixiRenderer {
  readonly camera: Camera;
  readonly drawList = new DrawList();
  private readonly world = new Container();
  private readonly strips = new Map<number, Graphics>();
  private readonly sprites = new Map<number, EntitySprite>();
  private readonly highlight = new Graphics();
  private readonly metrics = { width: 0, height: 0 };
  private mapId = '';
  private top = 0;
  private highlighted = -1;
  private destroyed = false;

  private constructor(
    private readonly app: Application,
    private readonly view: RuntimeView,
    readonly resolveAsset: AssetResolver,
    width: number,
    height: number,
  ) {
    // The camera works in CSS pixels; the device pixel ratio is the renderer's business.
    this.camera = createCamera(width, height);
    this.world.sortableChildren = true;
    this.highlight.zIndex = 1_000_000;
    this.world.addChild(this.highlight);
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

  /** The tint seam (spec 6.6): multiplies the scene. Nothing calls it until Phase 14. */
  setWorldTint(rgb: number): void {
    this.world.tint = rgb;
  }

  /** Drop cached terrain geometry: call after the map's layers are edited. */
  invalidateTerrain(): void {
    for (const strip of this.strips.values()) strip.destroy();
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
    for (let i = 1; i < 7; i++) points.push(top.vertices[i * 2]!, top.vertices[i * 2 + 1]!);
    g.poly(points).fill({ color: 0xffffff, alpha: 0.28 }).stroke({ color: 0xfff27a, width: 3, alpha: 0.95 });
  }

  pickTerrain(sx: number, sy: number, out: TerrainPick): boolean {
    return pickTerrain(this.view.world, this.view.project.settings, this.camera, sx, sy, out);
  }

  /** The front-most entity under a screen point (as of the last rendered frame), or -1. */
  pickEntity(sx: number, sy: number): number {
    return pickEntity(this.drawList, sx, sy);
  }

  /** Draw one frame. `alpha` is the client's leftover tick fraction, 0..1. */
  render(alpha: number): void {
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

    const list = this.drawList;
    list.build(view, cam, alpha, this.top);

    for (const [row, strip] of this.strips) strip.visible = row >= list.firstRow && row <= list.lastRow;
    for (const sprite of this.sprites.values()) sprite.root.visible = false;

    const entities = view.entities;
    for (let i = 0; i < list.count; i++) {
      const ref = list.ref[i]!;
      if (list.kind[i] === ITEM_STRIP) {
        this.stripFor(ref).zIndex = i;
        continue;
      }
      const sprite = this.spriteFor(ref);
      sprite.root.visible = true;
      sprite.root.zIndex = i;
      // Screen -> world pixels, the space the world container's children live in.
      sprite.root.position.set((list.footX[ref]! - this.world.position.x) / cam.zoom, (list.footY[ref]! - this.world.position.y) / cam.zoom);
      sprite.root.alpha = entities.dead(ref) ? 0.35 : 1;
      const facing = entities.facing(ref);
      sprite.nose.position.set(Math.cos(facing) * sprite.noseRadius, Math.sin(facing) * sprite.noseRadius * ISO_RATIO - sprite.noseHeight);
    }

    // Release sprites of entities that no longer exist.
    for (const [index, sprite] of this.sprites) {
      if (!entities.alive(index) || entities.id(index) !== sprite.id) {
        sprite.root.destroy({ children: true });
        this.sprites.delete(index);
      }
    }
    this.app.render();
  }

  private stripFor(row: number): Graphics {
    let g = this.strips.get(row);
    if (g) return g;
    g = new Graphics();
    const strip = buildStrip(this.view.world, this.view.project, row);
    const points = new Array<number>(12);
    for (const top of strip.tops) {
      for (let i = 0; i < 6; i++) {
        points[i * 2] = top.vertices[(i + 1) * 2]!;
        points[i * 2 + 1] = top.vertices[(i + 1) * 2 + 1]!;
      }
      // Placeholder art: the frame's color, a little lighter with each cliff level.
      const color = shade(colorOf(top.frame.frame), 1 + top.level * 0.05);
      g.poly(points.slice()).fill({ color }).stroke({ color: shade(color, 0.72), width: 1.5, alpha: 0.55 });
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
    if (existing) existing.root.destroy({ children: true });

    const ppu = this.view.project.settings.pixelsPerUnit;
    const data = entities.data(index);
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
    const sprite: EntitySprite = { id, root, nose, noseRadius: w * 0.5, noseHeight: h * 0.42 };
    this.sprites.set(index, sprite);
    return sprite;
  }

  /** Counts the playtest leak gate compares (spec 9.5). */
  stats(): { strips: number; sprites: number; children: number } {
    return { strips: this.strips.size, sprites: this.sprites.size, children: this.world.children.length };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.strips.clear();
    this.sprites.clear();
    this.app.destroy(false, { children: true });
  }
}
