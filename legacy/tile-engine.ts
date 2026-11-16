/**
 * ============================================================================
 *  LoreBrix — Tile Engine (Phase 2)
 * ============================================================================
 *  Canvas-based renderer for LoreBrix maps. Zero UI-framework dependencies.
 *
 *  Renders both map kinds from the Phase 1 schema (src/core/types.ts):
 *    'square'  — orthographic 2D grid, tile sizes 16/32/48/64 px
 *    'hex-iso' — pointy-top hexagons squashed by isoRatio into an isometric
 *                projection; all hex math done in cube/axial coordinates
 *
 *  Responsibilities (per ARCHITECTURE.md):
 *    rendering · camera pan/zoom · coordinate math · tile picking ·
 *    grid overlay · tileset slicing · tile editing (paint/erase/fill) ·
 *    PNG export · map (de)serialization · pointer/wheel interactions
 *
 *  The engine does NOT know about entities. Phase 5 injects a render hook
 *  via setEntityRenderHook(); it is invoked between the midground and
 *  foreground layer passes, with the context already in world space.
 *
 *  Coordinate spaces:
 *    screen — canvas pixels (pointer events, after CSS-scale correction)
 *    world  — map pixels at zoom 1 (all drawing happens here)
 *    cell   — GridPos: {kind:'square',x,y} or {kind:'hex',q,r} (axial)
 *  Hex storage is odd-r offset in the dense layer array
 *  (index = row * width + col); conversions live in this file.
 * ============================================================================
 */

import type {
  AssetManifest,
  CameraState,
  GridPos,
  HexIsoTileMap,
  HexTile,
  SquareTileMap,
  TerrainTile,
  Tile,
  TileLayer,
  TileMap,
  TileRef,
  TilesetAsset,
  UUID,
  Vec2,
} from './core/types';

/* ========================================================================== */
/*  CONSTANTS                                                                 */
/* ========================================================================== */

const SQRT3 = Math.sqrt(3);
const DEG2RAD = Math.PI / 180;

/** Axial-direction offsets for the six neighbors of a pointy-top hex. */
export const AXIAL_DIRS: ReadonlyArray<{ q: number; r: number }> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/* ========================================================================== */
/*  PURE HEX / GRID MATH (exported for reuse by Phases 3 & 5, and for tests)  */
/* ========================================================================== */

/**
 * Convert odd-r offset storage coordinates (col, row) to axial (q, r).
 * Odd rows are shifted +half-hex to the right; `row & 1` yields the
 * mathematically correct parity for negative rows too.
 */
export function offsetToAxial(col: number, row: number): { q: number; r: number } {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

/** Convert axial (q, r) back to odd-r offset storage coordinates. */
export function axialToOffset(q: number, r: number): { col: number; row: number } {
  return { col: q + (r - (r & 1)) / 2, row: r };
}

/**
 * Round fractional cube coordinates to the nearest valid hex, preserving
 * the cube invariant q + r + s = 0 by re-deriving the component with the
 * largest rounding error.
 */
export function cubeRound(
  qf: number,
  rf: number,
  sf: number,
): { q: number; r: number; s: number } {
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  else s = -q - r;
  return { q, r, s };
}

/**
 * Axial hex (q, r) → world-space pixel center for a pointy-top hex of
 * radius `size`, with vertical iso squash applied.
 */
export function hexToPixel(q: number, r: number, size: number, isoRatio: number): Vec2 {
  return {
    x: size * (SQRT3 * q + (SQRT3 / 2) * r),
    y: size * 1.5 * r * isoRatio,
  };
}

/**
 * World-space pixel → nearest axial hex (q, r). Inverse of hexToPixel:
 * un-squashes y, solves the fractional axial coords, then cube-rounds.
 */
export function pixelToHex(
  x: number,
  y: number,
  size: number,
  isoRatio: number,
): { q: number; r: number } {
  const uy = y / isoRatio;
  const qf = ((SQRT3 / 3) * x - (1 / 3) * uy) / size;
  const rf = ((2 / 3) * uy) / size;
  const { q, r } = cubeRound(qf, rf, -qf - rf);
  return { q, r };
}

/**
 * The six corner points of a pointy-top hex centered at (cx, cy), radius
 * `size`, with iso squash applied to the vertical axis. Corner 0 is the
 * upper-right; corners proceed clockwise.
 */
export function hexCorners(cx: number, cy: number, size: number, isoRatio: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = DEG2RAD * (60 * i - 30);
    pts.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle) * isoRatio,
    });
  }
  return pts;
}

/* ========================================================================== */
/*  PUBLIC TYPES                                                              */
/* ========================================================================== */

/** Any tile shape that can live in a layer's data array. */
export type AnyTile = Tile | TerrainTile | HexTile;

export interface TileEngineOptions {
  /** Zoom clamp floor. Default 0.25. */
  minZoom?: number;
  /** Zoom clamp ceiling. Default 4. */
  maxZoom?: number;
  /** Attach built-in pointer/wheel handlers (wheel zoom, middle-drag pan,
   *  click/hover picking). Default true. */
  interactive?: boolean;
  /** Grid overlay stroke color. Default 'rgba(255,255,255,0.16)'. */
  gridColor?: string;
  /** Fill color for occupied collision-layer cells.
   *  Default 'rgba(255,72,72,0.4)'. */
  collisionTint?: string;
  /** Canvas clear color when no map is loaded. Default '#101018'. */
  backgroundFallback?: string;
}

export type Unsubscribe = () => void;
export type TileClickHandler = (pos: GridPos, ev: PointerEvent) => void;
export type TileHoverHandler = (pos: GridPos | null, ev: PointerEvent) => void;
export type CameraMoveHandler = (camera: Readonly<CameraState>) => void;

/* ========================================================================== */
/*  INTERNAL TYPES                                                            */
/* ========================================================================== */

interface SlicedTileset {
  asset: TilesetAsset;
  image: HTMLImageElement;
}

interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CellRange {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

const DEFAULT_OPTIONS: Required<TileEngineOptions> = {
  minZoom: 0.25,
  maxZoom: 4,
  interactive: true,
  gridColor: 'rgba(255,255,255,0.16)',
  collisionTint: 'rgba(255,72,72,0.4)',
  backgroundFallback: '#101018',
};

/* ========================================================================== */
/*  TILE ENGINE                                                               */
/* ========================================================================== */

export class TileEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: Required<TileEngineOptions>;

  private map: TileMap | null = null;
  private readonly tilesets = new Map<UUID, SlicedTileset>();
  private camera: CameraState = { x: 0, y: 0, zoom: 1 };
  private gridVisible = true;
  private entityHook: ((ctx: CanvasRenderingContext2D) => void) | null = null;

  private rafId: number | null = null;
  private panning = false;
  private lastPointer: Vec2 = { x: 0, y: 0 };
  private lastHoverKey: string | null = null;

  private readonly clickHandlers = new Set<TileClickHandler>();
  private readonly hoverHandlers = new Set<TileHoverHandler>();
  private readonly cameraHandlers = new Set<CameraMoveHandler>();

  /**
   * @param canvas Host canvas. The engine draws in canvas-pixel space and
   *               corrects pointer events for any CSS scaling.
   * @param options See TileEngineOptions. Omitted fields use defaults.
   */
  constructor(canvas: HTMLCanvasElement, options?: TileEngineOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('TileEngine: 2d canvas context unavailable');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false; // crisp pixel art
    this.opts = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
    if (this.opts.interactive) this.attachListeners();
    this.requestRender();
  }

  /* ------------------------------------------------------------------ */
  /*  MAP LIFECYCLE & SERIALIZATION                                     */
  /* ------------------------------------------------------------------ */

  /** Load a map (by reference) and schedule a render. */
  loadMap(map: TileMap): void {
    this.map = map;
    this.lastHoverKey = null;
    this.requestRender();
  }

  /**
   * The live map reference, or null. If you mutate it directly instead of
   * using setTile/floodFill, call requestRender() afterwards.
   */
  getMap(): TileMap | null {
    return this.map;
  }

  /** Deep-copied snapshot of the current map state. Throws if none loaded. */
  toJSON(): TileMap {
    if (!this.map) throw new Error('TileEngine.toJSON: no map loaded');
    return structuredClone(this.map);
  }

  /**
   * Replace engine state from serialized map data (deep-copied on the way
   * in, so the caller's object is never shared). Validates map.kind.
   */
  fromJSON(map: TileMap): void {
    if (map.kind !== 'square' && map.kind !== 'hex-iso') {
      throw new Error('TileEngine.fromJSON: unknown map kind');
    }
    this.loadMap(structuredClone(map));
  }

  /* ------------------------------------------------------------------ */
  /*  ASSETS (tileset slicing)                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Decode a tileset image (data URL per schema v1) and register it for
   * slicing. Source cells are addressed row-major by TileRef.index using
   * the asset's tileWidth/tileHeight/columns.
   */
  async registerTileset(asset: TilesetAsset): Promise<void> {
    const image = await loadImage(asset.src);
    this.tilesets.set(asset.id, { asset, image });
    this.requestRender();
  }

  /** Register every tileset in a project's AssetManifest. */
  async registerAssets(manifest: AssetManifest): Promise<void> {
    await Promise.all(manifest.tilesets.map((t) => this.registerTileset(t)));
  }

  /* ------------------------------------------------------------------ */
  /*  CAMERA                                                            */
  /* ------------------------------------------------------------------ */

  /** Copy of the current camera state. */
  getCamera(): CameraState {
    return { ...this.camera };
  }

  /** Merge a partial camera state; zoom is clamped to [minZoom, maxZoom]. */
  setCamera(partial: Partial<CameraState>): void {
    this.camera = { ...this.camera, ...partial };
    this.camera.zoom = clamp(this.camera.zoom, this.opts.minZoom, this.opts.maxZoom);
    this.emitCameraMove();
    this.requestRender();
  }

  /**
   * Pan by a screen-pixel drag delta (content follows the drag direction,
   * i.e. dragging right moves the camera left).
   */
  pan(dxScreen: number, dyScreen: number): void {
    this.camera.x -= dxScreen / this.camera.zoom;
    this.camera.y -= dyScreen / this.camera.zoom;
    this.emitCameraMove();
    this.requestRender();
  }

  /**
   * Multiply zoom by `factor`, keeping the world point under the given
   * screen position fixed (zoom-toward-cursor).
   */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.camera.zoom = clamp(this.camera.zoom * factor, this.opts.minZoom, this.opts.maxZoom);
    this.camera.x = before.x - screenX / this.camera.zoom;
    this.camera.y = before.y - screenY / this.camera.zoom;
    this.emitCameraMove();
    this.requestRender();
  }

  /** Center the whole map in the viewport with the given pixel padding. */
  fitToView(padding = 32): void {
    const b = this.getWorldBounds();
    if (b.width <= 0 || b.height <= 0) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const zoom = clamp(
      Math.min((cw - padding * 2) / b.width, (ch - padding * 2) / b.height),
      this.opts.minZoom,
      this.opts.maxZoom,
    );
    this.camera = {
      zoom,
      x: b.x + b.width / 2 - cw / (2 * zoom),
      y: b.y + b.height / 2 - ch / (2 * zoom),
    };
    this.emitCameraMove();
    this.requestRender();
  }

  /* ------------------------------------------------------------------ */
  /*  COORDINATE CONVERSIONS & PICKING                                  */
  /* ------------------------------------------------------------------ */

  /** Screen (canvas-pixel) position → world position. */
  screenToWorld(screenX: number, screenY: number): Vec2 {
    return {
      x: screenX / this.camera.zoom + this.camera.x,
      y: screenY / this.camera.zoom + this.camera.y,
    };
  }

  /** World position → screen (canvas-pixel) position. */
  worldToScreen(worldX: number, worldY: number): Vec2 {
    return {
      x: (worldX - this.camera.x) * this.camera.zoom,
      y: (worldY - this.camera.y) * this.camera.zoom,
    };
  }

  /**
   * World-space center of a cell. Throws if the GridPos kind does not
   * match the loaded map's kind (that is always a caller bug).
   */
  cellToWorld(pos: GridPos): Vec2 {
    const map = this.map;
    if (!map) return { x: 0, y: 0 };
    if (map.kind === 'square' && pos.kind === 'square') {
      return {
        x: (pos.x + 0.5) * map.tileSize,
        y: (pos.y + 0.5) * map.tileSize,
      };
    }
    if (map.kind === 'hex-iso' && pos.kind === 'hex') {
      return hexToPixel(pos.q, pos.r, map.hexSize, map.isoRatio);
    }
    throw new Error('TileEngine.cellToWorld: GridPos kind does not match map kind');
  }

  /** World position → containing cell, or null if outside map bounds. */
  worldToCell(worldX: number, worldY: number): GridPos | null {
    const map = this.map;
    if (!map) return null;
    if (map.kind === 'square') {
      const x = Math.floor(worldX / map.tileSize);
      const y = Math.floor(worldY / map.tileSize);
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
      return { kind: 'square', x, y };
    }
    const { q, r } = pixelToHex(worldX, worldY, map.hexSize, map.isoRatio);
    const { col, row } = axialToOffset(q, r);
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) return null;
    return { kind: 'hex', q, r };
  }

  /**
   * Screen (canvas-pixel) position → cell under it, or null if off-map.
   * This is the picking primitive behind onTileClick / onTileHover.
   */
  pickTile(screenX: number, screenY: number): GridPos | null {
    const w = this.screenToWorld(screenX, screenY);
    return this.worldToCell(w.x, w.y);
  }

  /* ------------------------------------------------------------------ */
  /*  TILE EDITING                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Tile at a cell on a layer. Returns undefined when the layer id or
   * position is invalid, null when the cell is empty.
   */
  getTile(layerId: UUID, pos: GridPos): AnyTile | null | undefined {
    const layer = this.findLayer(layerId);
    if (!layer) return undefined;
    const idx = this.cellIndexForPos(pos);
    if (idx < 0) return undefined;
    return layer.data[idx] ?? null;
  }

  /**
   * Place (or erase, with null) a tile at a cell. The tile is deep-cloned
   * so one brush tile can stamp many cells without shared references.
   * Refuses locked layers. Returns true when a cell was written.
   */
  setTile(layerId: UUID, pos: GridPos, tile: AnyTile | null): boolean {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return false;
    const idx = this.cellIndexForPos(pos);
    if (idx < 0) return false;
    layer.data[idx] = tile === null ? null : structuredClone(tile);
    this.requestRender();
    return true;
  }

  /**
   * Bucket fill: replace the connected region of cells matching the start
   * cell's tile ref (4-connected on square maps, 6-connected on hex maps)
   * with `tile`. Refuses locked layers. Returns the number of cells changed.
   */
  floodFill(layerId: UUID, pos: GridPos, tile: AnyTile | null): number {
    const map = this.map;
    if (!map) return 0;
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return 0;
    const start = this.cellIndexForPos(pos);
    if (start < 0) return 0;

    const target = layer.data[start] ?? null;
    if (sameTileRef(target, tile)) return 0; // filling with itself

    const queue: number[] = [start];
    const seen = new Set<number>([start]);
    let changed = 0;

    while (queue.length > 0) {
      const idx = queue.pop();
      if (idx === undefined) break;
      layer.data[idx] = tile === null ? null : structuredClone(tile);
      changed++;
      for (const n of this.neighborIndices(idx, map)) {
        if (!seen.has(n) && sameTileRef(layer.data[n] ?? null, target)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    this.requestRender();
    return changed;
  }

  /* ------------------------------------------------------------------ */
  /*  DISPLAY TOGGLES & HOOKS                                           */
  /* ------------------------------------------------------------------ */

  /** Toggle the grid overlay (square lines or hex outlines). */
  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    this.requestRender();
  }

  /** Current grid overlay visibility. */
  getGridVisible(): boolean {
    return this.gridVisible;
  }

  /**
   * Install the entity render hook (Phase 3/5). Called every frame with
   * the context already transformed into world space, after background +
   * midground layers and before foreground layers. Pass null to remove.
   */
  setEntityRenderHook(hook: ((ctx: CanvasRenderingContext2D) => void) | null): void {
    this.entityHook = hook;
    this.requestRender();
  }

  /** Resize the backing canvas (canvas pixels) and re-render. */
  resize(width: number, height: number): void {
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
    // Setting canvas dimensions resets all context state:
    this.ctx.imageSmoothingEnabled = false;
    this.requestRender();
  }

  /* ------------------------------------------------------------------ */
  /*  EVENTS                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Fires on primary-button pointerdown over a cell. For drag-painting,
   * combine with onTileHover and check ev.buttons & 1 in the handler.
   */
  onTileClick(handler: TileClickHandler): Unsubscribe {
    this.clickHandlers.add(handler);
    return () => {
      this.clickHandlers.delete(handler);
    };
  }

  /**
   * Fires whenever the cell under the cursor changes (null when the
   * cursor leaves the map or the canvas).
   */
  onTileHover(handler: TileHoverHandler): Unsubscribe {
    this.hoverHandlers.add(handler);
    return () => {
      this.hoverHandlers.delete(handler);
    };
  }

  /** Fires after any camera change (pan, zoom, setCamera, fitToView). */
  onCameraMove(handler: CameraMoveHandler): Unsubscribe {
    this.cameraHandlers.add(handler);
    return () => {
      this.cameraHandlers.delete(handler);
    };
  }

  /* ------------------------------------------------------------------ */
  /*  EXPORT                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Render the entire map (all visible layers plus the entity hook, no
   * grid or collision overlays) into an offscreen canvas at zoom 1 and
   * return it as a PNG data URL. Very large maps produce very large
   * canvases; browsers cap dimensions around 16k px per side.
   */
  exportPNG(): string {
    const map = this.map;
    if (!map) throw new Error('TileEngine.exportPNG: no map loaded');
    const b = this.getWorldBounds();
    const w = Math.max(1, Math.ceil(b.width));
    const h = Math.max(1, Math.ceil(b.height));
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d');
    if (!octx) throw new Error('TileEngine.exportPNG: 2d context unavailable');
    octx.imageSmoothingEnabled = false;
    octx.fillStyle = map.backgroundColor;
    octx.fillRect(0, 0, w, h);
    octx.translate(-b.x, -b.y);
    this.drawScene(octx, map, b, false);
    return off.toDataURL('image/png');
  }

  /**
   * World-space bounding box of the loaded map ({0,0,0,0} when none).
   * Square: origin at (0,0). Hex-iso: includes the half-hex overhang of
   * row 0 / column 0 and the odd-row stagger.
   */
  getWorldBounds(): WorldRect {
    const map = this.map;
    if (!map) return { x: 0, y: 0, width: 0, height: 0 };
    if (map.kind === 'square') {
      return {
        x: 0,
        y: 0,
        width: map.width * map.tileSize,
        height: map.height * map.tileSize,
      };
    }
    const s = map.hexSize;
    const iso = map.isoRatio;
    const hexW = SQRT3 * s;
    const maxCenterX = (map.width - 1) * hexW + (map.height > 1 ? hexW / 2 : 0);
    return {
      x: -hexW / 2,
      y: -s * iso,
      width: maxCenterX + hexW,
      height: s * iso * (1.5 * map.height + 0.5),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  RENDER LOOP                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Schedule a redraw on the next animation frame. Safe to call many
   * times per frame; draws are coalesced. Call this after mutating the
   * map object directly.
   */
  requestRender(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.draw);
  }

  /** Detach listeners and cancel any pending frame. */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.opts.interactive) this.detachListeners();
    this.clickHandlers.clear();
    this.hoverHandlers.clear();
    this.cameraHandlers.clear();
  }

  private readonly draw = (): void => {
    this.rafId = null;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.map ? this.map.backgroundColor : this.opts.backgroundFallback;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const map = this.map;
    if (!map) return;
    const z = this.camera.zoom;
    ctx.setTransform(z, 0, 0, z, -this.camera.x * z, -this.camera.y * z);
    this.drawScene(ctx, map, this.getVisibleWorldRect(), true);
  };

  /**
   * Draw pipeline (shared by the live view and exportPNG):
   *   background + midground layers (array order preserved within pass)
   *   → entity hook → foreground layers
   *   → [editor only] collision tint → grid overlay
   */
  private drawScene(
    ctx: CanvasRenderingContext2D,
    map: TileMap,
    view: WorldRect,
    editorOverlays: boolean,
  ): void {
    for (const layer of map.layers) {
      if (layer.type === 'background' || layer.type === 'midground') {
        this.drawLayer(ctx, map, layer, view);
      }
    }
    if (this.entityHook) {
      ctx.save();
      this.entityHook(ctx);
      ctx.restore();
    }
    for (const layer of map.layers) {
      if (layer.type === 'foreground') this.drawLayer(ctx, map, layer, view);
    }
    if (editorOverlays) {
      for (const layer of map.layers) {
        if (layer.type === 'collision') this.drawCollisionLayer(ctx, map, layer, view);
      }
      if (this.gridVisible) this.drawGrid(ctx, map, view);
    }
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    map: TileMap,
    layer: TileLayer,
    view: WorldRect,
  ): void {
    if (!layer.visible || layer.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    const range = this.visibleCellRange(map, view);
    if (map.kind === 'square') this.drawSquareCells(ctx, map, layer, range);
    else this.drawHexCells(ctx, map, layer, range);
    ctx.restore();
  }

  private drawSquareCells(
    ctx: CanvasRenderingContext2D,
    map: SquareTileMap,
    layer: TileLayer,
    range: CellRange,
  ): void {
    const ts = map.tileSize;
    for (let row = range.r0; row <= range.r1; row++) {
      for (let col = range.c0; col <= range.c1; col++) {
        const tile = layer.data[row * map.width + col];
        if (tile && tile.ref) {
          this.drawSquareTile(ctx, tile, tile.ref, col * ts, row * ts, ts);
        }
      }
    }
  }

  private drawSquareTile(
    ctx: CanvasRenderingContext2D,
    tile: AnyTile,
    ref: TileRef,
    dx: number,
    dy: number,
    ts: number,
  ): void {
    const set = this.tilesets.get(ref.tilesetId);
    if (!set) {
      drawMissingRect(ctx, dx, dy, ts);
      return;
    }
    const tw = set.asset.tileWidth;
    const th = set.asset.tileHeight;
    const sx = (ref.index % set.asset.columns) * tw;
    const sy = Math.floor(ref.index / set.asset.columns) * th;
    if (!tile.rotation && !tile.flipX && !tile.flipY) {
      ctx.drawImage(set.image, sx, sy, tw, th, dx, dy, ts, ts);
      return;
    }
    ctx.save();
    ctx.translate(dx + ts / 2, dy + ts / 2);
    if (tile.rotation) ctx.rotate(tile.rotation * DEG2RAD);
    ctx.scale(tile.flipX ? -1 : 1, tile.flipY ? -1 : 1);
    ctx.drawImage(set.image, sx, sy, tw, th, -ts / 2, -ts / 2, ts, ts);
    ctx.restore();
  }

  private drawHexCells(
    ctx: CanvasRenderingContext2D,
    map: HexIsoTileMap,
    layer: TileLayer,
    range: CellRange,
  ): void {
    const s = map.hexSize;
    const iso = map.isoRatio;
    // Painter's order: rows ascend down the screen for pointy-top iso.
    for (let row = range.r0; row <= range.r1; row++) {
      for (let col = range.c0; col <= range.c1; col++) {
        const tile = layer.data[row * map.width + col];
        if (!tile || !tile.ref) continue;
        const a = offsetToAxial(col, row);
        const c = hexToPixel(a.q, a.r, s, iso);
        const lift = 'elevation' in tile ? (tile.elevation ?? 0) : 0;
        this.drawHexTile(ctx, tile.ref, c.x, c.y - lift, s, iso);
      }
    }
  }

  /**
   * Hex tiles are drawn as images centered on the hex, scaled to the hex
   * bounding box; source art is expected to carry its own transparency.
   * Per-tile rotation/flip flags are intentionally ignored in hex mode
   * (rotating a hex by 90° breaks the tessellation).
   */
  private drawHexTile(
    ctx: CanvasRenderingContext2D,
    ref: TileRef,
    cx: number,
    cy: number,
    size: number,
    isoRatio: number,
  ): void {
    const set = this.tilesets.get(ref.tilesetId);
    if (!set) {
      drawMissingHex(ctx, cx, cy, size, isoRatio);
      return;
    }
    const dw = SQRT3 * size;
    const dh = 2 * size * isoRatio;
    const tw = set.asset.tileWidth;
    const th = set.asset.tileHeight;
    const sx = (ref.index % set.asset.columns) * tw;
    const sy = Math.floor(ref.index / set.asset.columns) * th;
    ctx.drawImage(set.image, sx, sy, tw, th, cx - dw / 2, cy - dh / 2, dw, dh);
  }

  private drawCollisionLayer(
    ctx: CanvasRenderingContext2D,
    map: TileMap,
    layer: TileLayer,
    view: WorldRect,
  ): void {
    if (!layer.visible || layer.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.fillStyle = this.opts.collisionTint;
    const range = this.visibleCellRange(map, view);
    for (let row = range.r0; row <= range.r1; row++) {
      for (let col = range.c0; col <= range.c1; col++) {
        const tile = layer.data[row * map.width + col];
        if (!tile) continue;
        if (map.kind === 'square') {
          const ts = map.tileSize;
          ctx.fillRect(col * ts, row * ts, ts, ts);
        } else {
          const a = offsetToAxial(col, row);
          const c = hexToPixel(a.q, a.r, map.hexSize, map.isoRatio);
          const lift = 'elevation' in tile ? (tile.elevation ?? 0) : 0;
          tracePath(ctx, hexCorners(c.x, c.y - lift, map.hexSize, map.isoRatio));
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, map: TileMap, view: WorldRect): void {
    ctx.save();
    ctx.strokeStyle = this.opts.gridColor;
    ctx.lineWidth = 1 / this.camera.zoom;
    const range = this.visibleCellRange(map, view);
    ctx.beginPath();
    if (map.kind === 'square') {
      const ts = map.tileSize;
      for (let col = range.c0; col <= range.c1 + 1; col++) {
        ctx.moveTo(col * ts, range.r0 * ts);
        ctx.lineTo(col * ts, (range.r1 + 1) * ts);
      }
      for (let row = range.r0; row <= range.r1 + 1; row++) {
        ctx.moveTo(range.c0 * ts, row * ts);
        ctx.lineTo((range.c1 + 1) * ts, row * ts);
      }
    } else {
      for (let row = range.r0; row <= range.r1; row++) {
        for (let col = range.c0; col <= range.c1; col++) {
          const a = offsetToAxial(col, row);
          const c = hexToPixel(a.q, a.r, map.hexSize, map.isoRatio);
          const pts = hexCorners(c.x, c.y, map.hexSize, map.isoRatio);
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /*  INTERNAL HELPERS                                                  */
  /* ------------------------------------------------------------------ */

  private getVisibleWorldRect(): WorldRect {
    return {
      x: this.camera.x,
      y: this.camera.y,
      width: this.canvas.width / this.camera.zoom,
      height: this.canvas.height / this.camera.zoom,
    };
  }

  /** Clamp the view rect to storage rows/cols; hex gets a 1-cell margin. */
  private visibleCellRange(map: TileMap, view: WorldRect): CellRange {
    if (map.kind === 'square') {
      const ts = map.tileSize;
      return {
        c0: Math.max(0, Math.floor(view.x / ts)),
        c1: Math.min(map.width - 1, Math.floor((view.x + view.width) / ts)),
        r0: Math.max(0, Math.floor(view.y / ts)),
        r1: Math.min(map.height - 1, Math.floor((view.y + view.height) / ts)),
      };
    }
    const rowStep = 1.5 * map.hexSize * map.isoRatio;
    const hexW = SQRT3 * map.hexSize;
    return {
      c0: Math.max(0, Math.floor(view.x / hexW) - 1),
      c1: Math.min(map.width - 1, Math.ceil((view.x + view.width) / hexW) + 1),
      r0: Math.max(0, Math.floor(view.y / rowStep) - 1),
      r1: Math.min(map.height - 1, Math.ceil((view.y + view.height) / rowStep) + 1),
    };
  }

  private findLayer(layerId: UUID): TileLayer | undefined {
    return this.map?.layers.find((l) => l.id === layerId);
  }

  /** Dense-array index for a GridPos, or -1 when out of bounds/no map. */
  private cellIndexForPos(pos: GridPos): number {
    const map = this.map;
    if (!map) return -1;
    let col: number;
    let row: number;
    if (pos.kind === 'square') {
      col = pos.x;
      row = pos.y;
    } else {
      const o = axialToOffset(pos.q, pos.r);
      col = o.col;
      row = o.row;
    }
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) return -1;
    return row * map.width + col;
  }

  /** In-bounds neighbor indices: 4-connected (square) / 6-connected (hex). */
  private neighborIndices(idx: number, map: TileMap): number[] {
    const w = map.width;
    const h = map.height;
    const col = idx % w;
    const row = Math.floor(idx / w);
    const out: number[] = [];
    if (map.kind === 'square') {
      if (col > 0) out.push(idx - 1);
      if (col < w - 1) out.push(idx + 1);
      if (row > 0) out.push(idx - w);
      if (row < h - 1) out.push(idx + w);
      return out;
    }
    const a = offsetToAxial(col, row);
    for (const d of AXIAL_DIRS) {
      const o = axialToOffset(a.q + d.q, a.r + d.r);
      if (o.col >= 0 && o.row >= 0 && o.col < w && o.row < h) {
        out.push(o.row * w + o.col);
      }
    }
    return out;
  }

  private emitCameraMove(): void {
    const snapshot: Readonly<CameraState> = { ...this.camera };
    for (const h of this.cameraHandlers) h(snapshot);
  }

  /* ------------------------------------------------------------------ */
  /*  BUILT-IN INTERACTIONS                                             */
  /* ------------------------------------------------------------------ */

  private attachListeners(): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  private detachListeners(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }

  /** Pointer position in canvas pixels, corrected for CSS scaling. */
  private eventToCanvas(ev: MouseEvent): Vec2 {
    const scaleX = this.canvas.clientWidth > 0 ? this.canvas.width / this.canvas.clientWidth : 1;
    const scaleY =
      this.canvas.clientHeight > 0 ? this.canvas.height / this.canvas.clientHeight : 1;
    return { x: ev.offsetX * scaleX, y: ev.offsetY * scaleY };
  }

  private readonly handlePointerDown = (ev: PointerEvent): void => {
    const p = this.eventToCanvas(ev);
    if (ev.button === 1) {
      this.panning = true;
      this.lastPointer = p;
      this.canvas.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      return;
    }
    if (ev.button === 0) {
      const pos = this.pickTile(p.x, p.y);
      if (pos) for (const h of this.clickHandlers) h(pos, ev);
    }
  };

  private readonly handlePointerMove = (ev: PointerEvent): void => {
    const p = this.eventToCanvas(ev);
    if (this.panning) {
      this.pan(p.x - this.lastPointer.x, p.y - this.lastPointer.y);
      this.lastPointer = p;
      return;
    }
    const pos = this.pickTile(p.x, p.y);
    const key = pos === null ? null : posKey(pos);
    if (key !== this.lastHoverKey) {
      this.lastHoverKey = key;
      for (const h of this.hoverHandlers) h(pos, ev);
    }
  };

  private readonly handlePointerUp = (ev: PointerEvent): void => {
    if (ev.button === 1 && this.panning) {
      this.panning = false;
      if (this.canvas.hasPointerCapture(ev.pointerId)) {
        this.canvas.releasePointerCapture(ev.pointerId);
      }
    }
  };

  private readonly handlePointerLeave = (ev: PointerEvent): void => {
    if (this.lastHoverKey !== null) {
      this.lastHoverKey = null;
      for (const h of this.hoverHandlers) h(null, ev);
    }
  };

  private readonly handleWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const p = this.eventToCanvas(ev);
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomAt(p.x, p.y, factor);
  };
}

/* ========================================================================== */
/*  MODULE-PRIVATE HELPERS                                                    */
/* ========================================================================== */

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function posKey(pos: GridPos): string {
  return pos.kind === 'square' ? 's:' + pos.x + ',' + pos.y : 'h:' + pos.q + ',' + pos.r;
}

function sameTileRef(a: AnyTile | null, b: AnyTile | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.ref === null || b.ref === null) return a.ref === b.ref;
  return a.ref.tilesetId === b.ref.tilesetId && a.ref.index === b.ref.index;
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/** Magenta placeholder for a tile whose tileset is not registered. */
function drawMissingRect(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.fillStyle = '#ff00ff';
  ctx.globalAlpha = ctx.globalAlpha * 0.5;
  ctx.fillRect(x, y, size, size);
  ctx.restore();
}

function drawMissingHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  isoRatio: number,
): void {
  ctx.save();
  ctx.fillStyle = '#ff00ff';
  ctx.globalAlpha = ctx.globalAlpha * 0.5;
  tracePath(ctx, hexCorners(cx, cy, size, isoRatio));
  ctx.fill();
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('TileEngine: failed to load tileset image'));
    img.src = src;
  });
}
