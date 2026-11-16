/**
 * ============================================================================
 *  LoreBrix — Entity & Sprite System (Phase 3)
 * ============================================================================
 *  Runtime layer that brings Phase 1 entity data to life. Zero UI-framework
 *  dependencies; renders through the Phase 2 TileEngine's entity hook.
 *
 *  Design contract (per ARCHITECTURE.md and the Phase 1/2 handoffs):
 *   · Persisted state stays PLAIN DATA (src/core/types.ts). This module
 *     wraps that data in runtime classes — it never redefines the shapes.
 *   · map.entities remains the source of truth: EntityManager binds to a
 *     map, wraps its entity array in place, and add/remove keep the array
 *     in sync. Saving a project needs no extra sync step.
 *   · Terrain is tile data, not an entity. TerrainService reads
 *     TerrainProperties off map layers; the manager enforces passability
 *     and applies damage-on-enter / damage ticks to combatants. This
 *     fulfills the "TerrainTile acting as entity" duty without
 *     duplicating storage.
 *   · Sprites anchor bottom-center on their cell's world center
 *     (projector.cellToWorld). renderPos lerps between cells at
 *     moveSpeed tiles/sec, so movement is smooth while logic stays
 *     grid-based.
 *
 *  Module map:
 *    AnimationPlayer      — clip playback (loop / one-shot / hold-last)
 *    TerrainService       — walkability, move cost, damage lookup
 *    createAStarPathfinder— working A* over TerrainService (4/6-connected)
 *    BaseEntity           — abstract runtime wrapper
 *      CombatantEntity    — movement, facing, HP, path following
 *        PlayerEntity     — kind 'player'
 *        NPCEntity        — kind 'npc': patrol, dialogue/behavior access
 *      PropEntity         — kind 'prop': collider, interactable
 *      DoodadEntity       — kind 'doodad': ambient anim + wind wobble
 *    EntityManager        — CRUD, spatial hash, events, scatter tool,
 *                           update loop, render hook
 * ============================================================================
 */

import type {
  AnimationClip,
  AnyEntity,
  AssetManifest,
  Direction4,
  DoodadSprite,
  GridPos,
  NPCSprite,
  PlayerSprite,
  PropSprite,
  SpritesheetAsset,
  TerrainProperties,
  TileMap,
  UUID,
  Vec2,
} from './core/types';
import { AXIAL_DIRS, axialToOffset, offsetToAxial } from './tile-engine';

/* ========================================================================== */
/*  SHARED RUNTIME TYPES                                                      */
/* ========================================================================== */

/**
 * Minimal projection surface the entity system needs. The Phase 2
 * TileEngine satisfies this structurally — pass the engine instance
 * straight in as the projector.
 */
export interface WorldProjector {
  cellToWorld(pos: GridPos): Vec2;
  worldToCell(worldX: number, worldY: number): GridPos | null;
}

/** A registered spritesheet; image may be null in headless contexts. */
export interface LoadedSheet {
  asset: SpritesheetAsset;
  image: HTMLImageElement | null;
}

/**
 * Services the manager injects into every attached entity. Entities never
 * reach around this interface to touch the manager directly.
 */
export interface EntityRuntime {
  readonly projector: WorldProjector;
  getSheet(id: UUID): LoadedSheet | undefined;
  /** World pixels spanned by n tiles on the bound map. */
  tilesToPixels(tiles: number): number;
  /** Optional shared pathfinder (see setPathfinder on the manager). */
  getPathfinder(): Pathfinder | null;
  /** Report a state change so the manager can emit onEntityUpdated. */
  markUpdated(entity: BaseEntity): void;
}

export type Unsubscribe = () => void;
export type EntityHandler = (entity: BaseEntity) => void;

/** A* compatible pathfinding contract (see createAStarPathfinder). */
export interface Pathfinder {
  /**
   * Path from `from` to `to` as a list of cells EXCLUDING the start and
   * INCLUDING the goal, or null when unreachable.
   */
  findPath(from: GridPos, to: GridPos): GridPos[] | null;
}

/* ========================================================================== */
/*  SMALL HELPERS                                                             */
/* ========================================================================== */

/** UUID v4 via Web Crypto, with a plain-random fallback. */
export function genId(): UUID {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  let out = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)];
  return (
    out.slice(0, 8) +
    '-' +
    out.slice(8, 12) +
    '-4' +
    out.slice(13, 16) +
    '-a' +
    out.slice(17, 20) +
    '-' +
    out.slice(20)
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('EntitySystem: failed to load spritesheet image'));
    img.src = src;
  });
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Storage-cell key ("col,row") for any GridPos — the spatial-hash key. */
export function cellKey(pos: GridPos): string {
  if (pos.kind === 'square') return pos.x + ',' + pos.y;
  const o = axialToOffset(pos.q, pos.r);
  return o.col + ',' + o.row;
}

function sameCell(a: GridPos, b: GridPos): boolean {
  return cellKey(a) === cellKey(b);
}

/* ========================================================================== */
/*  ANIMATION PLAYER                                                          */
/* ========================================================================== */

/**
 * Plays one AnimationClip at a time. Looping clips wrap; one-shot clips
 * hold their last frame and report `finished` (callers decide what plays
 * next — CombatantEntity auto-returns to 'idle' for everything except
 * 'death', which holds).
 */
export class AnimationPlayer {
  private clip: AnimationClip | null = null;
  private clipName = '';
  private time = 0;

  /** Currently playing clip name ('' when none). */
  get current(): string {
    return this.clipName;
  }

  /** True when a non-looping clip has played through. */
  get finished(): boolean {
    if (!this.clip || this.clip.loop) return false;
    return this.time * this.clip.fps >= this.clip.frames.length;
  }

  /**
   * Switch to a clip. Re-playing the same name is a no-op unless
   * `restart` is true.
   */
  play(name: string, clip: AnimationClip, restart = false): void {
    if (name === this.clipName && !restart) return;
    this.clip = clip;
    this.clipName = name;
    this.time = 0;
  }

  stop(): void {
    this.clip = null;
    this.clipName = '';
    this.time = 0;
  }

  /** Advance playback. dt is in seconds. */
  update(dt: number): void {
    if (this.clip) this.time += dt;
  }

  /** Spritesheet frame index to draw right now (0 when nothing plays). */
  frame(): number {
    const clip = this.clip;
    if (!clip || clip.frames.length === 0) return 0;
    const raw = Math.floor(this.time * clip.fps);
    const idx = clip.loop
      ? raw % clip.frames.length
      : Math.min(raw, clip.frames.length - 1);
    return clip.frames[idx];
  }
}

/* ========================================================================== */
/*  SPRITE DRAW HELPERS                                                       */
/* ========================================================================== */

/**
 * Draw one spritesheet frame anchored bottom-center at (ax, ay).
 * Frames are addressed row-major; columns derive from the image width.
 */
function drawSheetFrame(
  ctx: CanvasRenderingContext2D,
  sheet: LoadedSheet,
  frameIndex: number,
  ax: number,
  ay: number,
): void {
  const img = sheet.image;
  const fw = sheet.asset.frameWidth;
  const fh = sheet.asset.frameHeight;
  if (!img) {
    drawMissingSprite(ctx, ax, ay, fw, fh);
    return;
  }
  const cols = Math.max(1, Math.floor(img.width / fw));
  const sx = (frameIndex % cols) * fw;
  const sy = Math.floor(frameIndex / cols) * fh;
  ctx.drawImage(img, sx, sy, fw, fh, ax - fw / 2, ay - fh, fw, fh);
}

/** Magenta placeholder box for a missing/unloaded spritesheet. */
function drawMissingSprite(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  fw: number,
  fh: number,
): void {
  ctx.save();
  ctx.fillStyle = '#ff00ff';
  ctx.globalAlpha = ctx.globalAlpha * 0.55;
  ctx.fillRect(ax - fw / 2, ay - fh, fw, fh);
  ctx.restore();
}

/* ========================================================================== */
/*  TERRAIN SERVICE                                                           */
/* ========================================================================== */

/**
 * Reads terrain straight off the bound map's tile layers — terrain is tile
 * data (Phase 1 decision), so nothing here duplicates storage. Rules:
 *   · Layers are scanned top-to-bottom (last drawn wins) for terrain data.
 *   · Any painted cell on a 'collision' layer blocks movement outright.
 *   · Cells without terrain data are walkable with move cost 1.
 *   · Out-of-bounds is always blocked.
 */
export class TerrainService {
  private map: TileMap;

  constructor(map: TileMap) {
    this.map = map;
  }

  /** Rebind to a different map (the manager calls this on setMap). */
  setMap(map: TileMap): void {
    this.map = map;
  }

  /** Storage col/row for a GridPos, or null when out of bounds. */
  private storageCell(pos: GridPos): { col: number; row: number } | null {
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
    if (col < 0 || row < 0 || col >= this.map.width || row >= this.map.height) {
      return null;
    }
    return { col, row };
  }

  /**
   * Topmost TerrainProperties at a cell (collision layers excluded), or
   * null when no layer carries terrain data there.
   */
  terrainAt(pos: GridPos): TerrainProperties | null {
    const cell = this.storageCell(pos);
    if (!cell) return null;
    const idx = cell.row * this.map.width + cell.col;
    for (let i = this.map.layers.length - 1; i >= 0; i--) {
      const layer = this.map.layers[i];
      if (layer.type === 'collision') continue;
      const tile = layer.data[idx];
      if (tile && 'terrain' in tile) return tile.terrain;
    }
    return null;
  }

  /** True when any collision layer has a painted cell here (or OOB). */
  collisionAt(pos: GridPos): boolean {
    const cell = this.storageCell(pos);
    if (!cell) return true;
    const idx = cell.row * this.map.width + cell.col;
    for (const layer of this.map.layers) {
      if (layer.type !== 'collision') continue;
      if (layer.data[idx]) return true;
    }
    return false;
  }

  /** Combined passability: collision layer first, then terrain.walkable. */
  isWalkable(pos: GridPos): boolean {
    if (this.collisionAt(pos)) return false;
    const t = this.terrainAt(pos);
    return t ? t.walkable : true;
  }

  /** Pathfinding weight, clamped to >= 1. No terrain data costs 1. */
  moveCost(pos: GridPos): number {
    const t = this.terrainAt(pos);
    return t ? Math.max(1, t.moveCost) : 1;
  }

  /** Damage-on-enter spec at a cell, or null. */
  damageAt(pos: GridPos): TerrainProperties['damageOnEnter'] | null {
    const t = this.terrainAt(pos);
    return t && t.damageOnEnter ? t.damageOnEnter : null;
  }
}

/* ========================================================================== */
/*  A* PATHFINDER                                                             */
/* ========================================================================== */

/** Compact binary min-heap used by the A* open set. */
class MinHeap<T> {
  private readonly items: { key: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: T): void {
    const items = this.items;
    items.push({ key, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].key <= items[i].key) break;
      const tmp = items[parent];
      items[parent] = items[i];
      items[i] = tmp;
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && items[l].key < items[smallest].key) smallest = l;
        if (r < items.length && items[r].key < items[smallest].key) smallest = r;
        if (smallest === i) break;
        const tmp = items[smallest];
        items[smallest] = items[i];
        items[i] = tmp;
        i = smallest;
      }
    }
    return top.value;
  }
}

export interface AStarOptions {
  /** Abort after exploring this many cells (safety valve). Default 20000. */
  maxExplored?: number;
}

/**
 * Working A* over a map + TerrainService: 4-connected on square maps,
 * 6-connected on hex maps, weighted by TerrainService.moveCost, with a
 * Manhattan (square) / cube-distance (hex) heuristic. Satisfies the
 * Pathfinder interface consumed by CombatantEntity.walkTo.
 */
export function createAStarPathfinder(
  map: TileMap,
  terrain: TerrainService,
  options?: AStarOptions,
): Pathfinder {
  const maxExplored = options?.maxExplored ?? 20000;
  const w = map.width;
  const h = map.height;

  const toIndex = (pos: GridPos): number => {
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
    if (col < 0 || row < 0 || col >= w || row >= h) return -1;
    return row * w + col;
  };

  const toPos = (idx: number): GridPos => {
    const col = idx % w;
    const row = Math.floor(idx / w);
    if (map.kind === 'square') return { kind: 'square', x: col, y: row };
    const a = offsetToAxial(col, row);
    return { kind: 'hex', q: a.q, r: a.r };
  };

  const neighborsOf = (idx: number): number[] => {
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
  };

  const heuristic = (aIdx: number, bIdx: number): number => {
    const ac = aIdx % w;
    const ar = Math.floor(aIdx / w);
    const bc = bIdx % w;
    const br = Math.floor(bIdx / w);
    if (map.kind === 'square') {
      return Math.abs(ac - bc) + Math.abs(ar - br);
    }
    const aa = offsetToAxial(ac, ar);
    const ba = offsetToAxial(bc, br);
    const dq = aa.q - ba.q;
    const dr = aa.r - ba.r;
    const ds = -aa.q - aa.r + ba.q + ba.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
  };

  return {
    findPath(from: GridPos, to: GridPos): GridPos[] | null {
      const start = toIndex(from);
      const goal = toIndex(to);
      if (start < 0 || goal < 0) return null;
      if (!terrain.isWalkable(to)) return null;
      if (start === goal) return [];

      const open = new MinHeap<number>();
      const gScore = new Map<number, number>();
      const cameFrom = new Map<number, number>();
      const closed = new Set<number>();

      gScore.set(start, 0);
      open.push(heuristic(start, goal), start);
      let explored = 0;

      while (open.size > 0) {
        const current = open.pop();
        if (current === undefined) break;
        if (closed.has(current)) continue;

        if (current === goal) {
          const path: GridPos[] = [];
          let node = goal;
          while (node !== start) {
            path.push(toPos(node));
            const prev = cameFrom.get(node);
            if (prev === undefined) return null;
            node = prev;
          }
          path.reverse();
          return path;
        }

        closed.add(current);
        if (++explored > maxExplored) return null;

        const g = gScore.get(current);
        if (g === undefined) continue;
        for (const n of neighborsOf(current)) {
          if (closed.has(n)) continue;
          const nPos = toPos(n);
          if (!terrain.isWalkable(nPos)) continue;
          const tentative = g + terrain.moveCost(nPos);
          const known = gScore.get(n);
          if (known === undefined || tentative < known) {
            gScore.set(n, tentative);
            cameFrom.set(n, current);
            open.push(tentative + heuristic(n, goal), n);
          }
        }
      }
      return null;
    },
  };
}

/* ========================================================================== */
/*  BASE ENTITY                                                               */
/* ========================================================================== */

/**
 * Abstract runtime wrapper around a Phase-1 entity data object. The data
 * object is held BY REFERENCE — when the manager binds a map, wrappers
 * share the exact objects inside map.entities, so edits persist into the
 * project with no sync step.
 */
export abstract class BaseEntity<T extends AnyEntity = AnyEntity> {
  /** The live Phase-1 data object (shared with map.entities). */
  readonly data: T;

  /** Smooth world-space draw position; sprites anchor bottom-center here. */
  renderPos: Vec2 = { x: 0, y: 0 };

  protected runtime: EntityRuntime | null = null;
  protected readonly anim = new AnimationPlayer();
  private cellDirty = false;

  constructor(data: T) {
    this.data = data;
  }

  get id(): UUID {
    return this.data.id;
  }

  get kind(): T['kind'] {
    return this.data.kind;
  }

  get name(): string {
    return this.data.name;
  }

  get pos(): GridPos {
    return this.data.pos;
  }

  /** Manager wiring; snaps renderPos onto the entity's cell. */
  attach(runtime: EntityRuntime): void {
    this.runtime = runtime;
    this.snapToCell();
    this.onAttached();
  }

  detach(): void {
    this.runtime = null;
  }

  /** Subclass hook, runs once after attach (start ambient clips etc.). */
  protected onAttached(): void {}

  /** Teleport to a cell (no walking). Reindexed on the next reconcile. */
  setPos(pos: GridPos): void {
    this.data.pos = pos;
    this.snapToCell();
    this.cellDirty = true;
    this.markUpdated();
  }

  protected snapToCell(): void {
    if (!this.runtime) return;
    const c = this.runtime.projector.cellToWorld(this.data.pos);
    this.renderPos = { x: c.x, y: c.y };
  }

  /** Manager-facing: read-and-clear the "changed cell" flag. */
  consumeCellDirty(): boolean {
    const v = this.cellDirty;
    this.cellDirty = false;
    return v;
  }

  protected setCellDirty(): void {
    this.cellDirty = true;
  }

  protected markUpdated(): void {
    if (this.runtime) this.runtime.markUpdated(this);
  }

  /** Deep-cloned snapshot of this entity's data. */
  toData(): T {
    return structuredClone(this.data);
  }

  /** Advance simulation. dt in seconds. */
  update(dt: number): void {
    this.anim.update(dt);
  }

  /**
   * Play a named clip from this entity's spritesheet. Returns false when
   * the sheet or clip is missing (draw falls back gracefully).
   */
  playAnim(name: string, restart = false): boolean {
    const sheet = this.runtime ? this.runtime.getSheet(this.data.spritesheetId) : undefined;
    const clip = sheet ? sheet.asset.animations[name] : undefined;
    if (!clip) return false;
    this.anim.play(name, clip, restart);
    this.data.currentAnim = name;
    return true;
  }

  /** Draw at renderPos (bottom-center anchor), honoring pixelOffset. */
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.data.visible || !this.runtime) return;
    const ox = this.data.pixelOffset ? this.data.pixelOffset.x : 0;
    const oy = this.data.pixelOffset ? this.data.pixelOffset.y : 0;
    const sheet = this.runtime.getSheet(this.data.spritesheetId);
    if (!sheet) {
      drawMissingSprite(ctx, this.renderPos.x + ox, this.renderPos.y + oy, 24, 32);
      return;
    }
    drawSheetFrame(ctx, sheet, this.currentFrame(sheet), this.renderPos.x + ox, this.renderPos.y + oy);
  }

  /** Frame index to draw; subclasses may override the clip source. */
  protected currentFrame(sheet: LoadedSheet): number {
    if (this.anim.current) return this.anim.frame();
    const clip = sheet.asset.animations[this.data.currentAnim];
    return clip && clip.frames.length > 0 ? clip.frames[0] : 0;
  }
}

/* ========================================================================== */
/*  COMBATANT (shared by Player & NPC)                                        */
/* ========================================================================== */

/**
 * Movement + combat runtime shared by PlayerEntity and NPCEntity —
 * mirrors CombatantBase from the Phase 1 data model.
 *
 * Movement is grid-logical but renders smoothly: walkTo queues cells,
 * renderPos glides between cell centers at moveSpeed tiles/sec, data.pos
 * snaps forward as each cell is reached (which is what triggers spatial
 * reindexing and terrain-on-enter in the manager).
 */
export abstract class CombatantEntity<
  T extends PlayerSprite | NPCSprite = PlayerSprite | NPCSprite,
> extends BaseEntity<T> {
  private waypoints: GridPos[] = [];

  get stats(): T['stats'] {
    return this.data.stats;
  }

  get facing(): Direction4 {
    return this.data.facing;
  }

  get moving(): boolean {
    return this.waypoints.length > 0;
  }

  get alive(): boolean {
    return this.data.stats.hp > 0;
  }

  protected override onAttached(): void {
    if (!this.playAnim(this.data.currentAnim)) this.playAnim('idle');
  }

  /**
   * Walk to a target cell. Uses the given pathfinder, else the manager's
   * shared one; with no pathfinder at all the entity glides straight to
   * the target (cells in between are NOT entered — creators are
   * responsible for a clear route). Returns false when a pathfinder is
   * present but reports the target unreachable.
   */
  walkTo(target: GridPos, pathfinder?: Pathfinder): boolean {
    if (!this.alive) return false;
    if (sameCell(this.pos, target)) {
      this.waypoints = [];
      return true;
    }
    const pf = pathfinder ?? (this.runtime ? this.runtime.getPathfinder() : null);
    if (pf) {
      const path = pf.findPath(this.pos, target);
      if (!path) return false;
      this.waypoints = path;
      return true;
    }
    this.waypoints = [target];
    return true;
  }

  /** Cancel any in-progress walk (holds current cell). */
  stopWalking(): void {
    this.waypoints = [];
  }

  /**
   * Apply damage; HP clamps at 0. Plays 'hurt' (auto-returns to idle) or
   * 'death' (holds its last frame) and reports the update.
   */
  takeDamage(amount: number): void {
    if (!this.alive) return;
    const hp = Math.max(0, this.data.stats.hp - Math.max(0, amount));
    this.data.stats.hp = hp;
    if (hp <= 0) {
      this.stopWalking();
      this.playAnim('death', true);
    } else {
      this.playAnim('hurt', true);
    }
    this.markUpdated();
  }

  /** Heal up to maxHp. */
  heal(amount: number): void {
    const s = this.data.stats;
    s.hp = Math.min(s.maxHp, s.hp + Math.max(0, amount));
    this.markUpdated();
  }

  override update(dt: number): void {
    super.update(dt);
    if (!this.runtime) return;
    if (this.alive) this.stepMovement(dt);
    this.settleAnimation();
  }

  private stepMovement(dt: number): void {
    const rt = this.runtime;
    if (!rt || this.waypoints.length === 0) return;
    let budget = this.data.moveSpeed * rt.tilesToPixels(1) * dt; // px this frame
    while (budget > 0 && this.waypoints.length > 0) {
      const target = rt.projector.cellToWorld(this.waypoints[0]);
      const d = dist(this.renderPos.x, this.renderPos.y, target.x, target.y);
      if (d <= budget) {
        const next = this.waypoints.shift();
        if (!next) break;
        this.renderPos = { x: target.x, y: target.y };
        this.data.pos = next;
        this.setCellDirty();
        budget -= d;
      } else {
        this.setFacingFrom(target.x - this.renderPos.x, target.y - this.renderPos.y);
        const t = budget / d;
        this.renderPos = {
          x: this.renderPos.x + (target.x - this.renderPos.x) * t,
          y: this.renderPos.y + (target.y - this.renderPos.y) * t,
        };
        budget = 0;
      }
    }
  }

  private setFacingFrom(dx: number, dy: number): void {
    const facing: Direction4 =
      Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';
    if (facing !== this.data.facing) this.data.facing = facing;
  }

  /** Keep walk/idle clips in sync with movement; respect one-shots. */
  private settleAnimation(): void {
    if (!this.alive) return; // death holds
    const current = this.anim.current;
    const oneShotPlaying = (current === 'attack' || current === 'hurt') && !this.anim.finished;
    if (oneShotPlaying) return;
    if (this.moving) {
      this.playAnim('walk-' + this.data.facing);
    } else if (current !== 'idle') {
      this.playAnim('idle');
    }
  }
}

/* ========================================================================== */
/*  PLAYER                                                                    */
/* ========================================================================== */

/** The player character. All the heavy lifting lives in CombatantEntity. */
export class PlayerEntity extends CombatantEntity<PlayerSprite> {
  get inventory(): PlayerSprite['inventory'] {
    return this.data.inventory;
  }
}

/* ========================================================================== */
/*  NPC                                                                       */
/* ========================================================================== */

/**
 * NPC runtime: everything the player has, plus behavior mode, dialogue
 * access, interaction/aggro radii, and a patrol driver (loop, ping-pong,
 * once) with per-waypoint dwell.
 *
 * Full AI (chase/flee/attack) is authored as BehaviorStateMachines in
 * Phase 4 and driven by the playtest loop in Phase 5 — this class
 * provides the movement/interaction primitives those layers call into.
 */
export class NPCEntity extends CombatantEntity<NPCSprite> {
  private patrolIndex = 0;
  private patrolDir: 1 | -1 = 1;
  private patrolWait = 0;
  private patrolDone = false;
  /** Set true (e.g. by behavior AI) to suspend the patrol driver. */
  patrolSuspended = false;

  get behavior(): NPCSprite['behavior'] {
    return this.data.behavior;
  }

  get dialogue(): NPCSprite['dialogue'] {
    return this.data.dialogue;
  }

  /** Interaction radius in world pixels (data stores tiles). */
  interactionRadiusPx(): number {
    return this.runtime ? this.runtime.tilesToPixels(this.data.interactionRadius) : 0;
  }

  /** Aggro radius in world pixels (0 when unset). */
  aggroRadiusPx(): number {
    const r = this.data.aggroRadius === undefined ? 0 : this.data.aggroRadius;
    return this.runtime && r > 0 ? this.runtime.tilesToPixels(r) : 0;
  }

  /** Restart the patrol route from its first waypoint. */
  resetPatrol(): void {
    this.patrolIndex = 0;
    this.patrolDir = 1;
    this.patrolWait = 0;
    this.patrolDone = false;
  }

  override update(dt: number): void {
    super.update(dt);
    if (this.alive && !this.patrolSuspended) this.stepPatrol(dt);
  }

  private stepPatrol(dt: number): void {
    const patrol = this.data.patrol;
    if (!patrol || patrol.waypoints.length === 0 || this.patrolDone) return;
    if (this.moving) return;
    if (this.patrolWait > 0) {
      this.patrolWait -= dt;
      return;
    }
    const target = patrol.waypoints[this.patrolIndex];
    if (sameCell(this.pos, target)) {
      this.patrolWait = patrol.waitMs / 1000;
      this.advancePatrolIndex(patrol.waypoints.length, patrol.mode);
      return;
    }
    if (!this.walkTo(target)) {
      // Unreachable right now (map may change under us): dwell, retry.
      this.patrolWait = Math.max(0.5, patrol.waitMs / 1000);
    }
  }

  private advancePatrolIndex(count: number, mode: 'loop' | 'ping-pong' | 'once'): void {
    if (count <= 1) {
      if (mode === 'once') this.patrolDone = true;
      return;
    }
    if (mode === 'loop') {
      this.patrolIndex = (this.patrolIndex + 1) % count;
      return;
    }
    if (mode === 'once') {
      if (this.patrolIndex >= count - 1) this.patrolDone = true;
      else this.patrolIndex++;
      return;
    }
    let next = this.patrolIndex + this.patrolDir;
    if (next < 0 || next >= count) {
      this.patrolDir = this.patrolDir === 1 ? -1 : 1;
      next = this.patrolIndex + this.patrolDir;
    }
    this.patrolIndex = Math.max(0, Math.min(count - 1, next));
  }
}

/* ========================================================================== */
/*  PROP                                                                      */
/* ========================================================================== */

/** Static interactable/collidable object (chest, sign, door, torch). */
export class PropEntity extends BaseEntity<PropSprite> {
  get interactable(): boolean {
    return this.data.interactable;
  }

  protected override onAttached(): void {
    // Props may carry a looping clip (torch flicker); play it if present.
    this.playAnim(this.data.currentAnim);
  }

  /**
   * Collider in world space, or null for decorative props. BoundingBox
   * offsets are relative to the sprite's bottom-center anchor.
   */
  worldCollider(): { x: number; y: number; width: number; height: number } | null {
    const c = this.data.collider;
    if (!c) return null;
    const ax = this.renderPos.x + (this.data.pixelOffset ? this.data.pixelOffset.x : 0);
    const ay = this.renderPos.y + (this.data.pixelOffset ? this.data.pixelOffset.y : 0);
    return { x: ax + c.offsetX, y: ay + c.offsetY, width: c.width, height: c.height };
  }
}

/* ========================================================================== */
/*  DOODAD                                                                    */
/* ========================================================================== */

/**
 * Purely decorative WC3-style scenery: ambient loop, optional wind
 * wobble (horizontal skew anchored at the base, so roots stay planted
 * while the crown sways), never any collision.
 */
export class DoodadEntity extends BaseEntity<DoodadSprite> {
  /** Random per-instance phase so scattered doodads never sway in sync. */
  private readonly wobblePhase = Math.random() * Math.PI * 2;
  private clock = 0;

  get scatterGroupId(): UUID | undefined {
    return this.data.scatterGroupId;
  }

  protected override onAttached(): void {
    this.anim.play('ambient', this.data.ambientAnim, true);
  }

  override update(dt: number): void {
    super.update(dt);
    this.clock += dt;
  }

  protected override currentFrame(): number {
    return this.anim.frame();
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    if (!this.data.visible || !this.runtime) return;
    const w = this.data.wobble;
    if (!w || w.amplitude === 0) {
      super.draw(ctx);
      return;
    }
    const sheet = this.runtime.getSheet(this.data.spritesheetId);
    const fh = sheet ? sheet.asset.frameHeight : 32;
    const sway =
      Math.sin(this.clock * w.speedHz * Math.PI * 2 + this.wobblePhase) * w.amplitude;
    const ax = this.renderPos.x + (this.data.pixelOffset ? this.data.pixelOffset.x : 0);
    const ay = this.renderPos.y + (this.data.pixelOffset ? this.data.pixelOffset.y : 0);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.transform(1, 0, sway / fh, 1, 0, 0);
    ctx.translate(-ax, -ay);
    super.draw(ctx);
    ctx.restore();
  }
}

/* ========================================================================== */
/*  ENTITY FACTORY                                                            */
/* ========================================================================== */

export type AnyEntityWrapper = PlayerEntity | NPCEntity | PropEntity | DoodadEntity;

/** Wrap a Phase-1 entity data object in its runtime class. */
export function createEntity(data: AnyEntity): AnyEntityWrapper {
  switch (data.kind) {
    case 'player':
      return new PlayerEntity(data);
    case 'npc':
      return new NPCEntity(data);
    case 'prop':
      return new PropEntity(data);
    case 'doodad':
      return new DoodadEntity(data);
  }
}

/* ========================================================================== */
/*  ENTITY MANAGER                                                            */
/* ========================================================================== */

export interface EntityManagerOptions {
  /** Shared pathfinder used by walkTo when none is passed explicitly. */
  pathfinder?: Pathfinder | null;
}

/**
 * Owns every entity on the bound map: CRUD, grid-bucketed spatial hash,
 * update loop, painter's-order rendering, scatter tool, spritesheet
 * registry, serialization, and the added/removed/updated event bus.
 *
 * map.entities is the source of truth: binding wraps the array's objects
 * in place, add() pushes into it, remove() splices out of it. Saving a
 * project therefore needs no separate sync step.
 *
 * Terrain policy: damage-on-enter (+ tickMs re-application) fires when a
 * combatant MOVES onto a cell during update(), and via the explicit
 * applyTerrainEnter() for gameplay teleports. moveEntity() is an editor
 * teleport and deliberately does NOT apply terrain damage; loading and
 * spawning don't either.
 */
export class EntityManager {
  /** Terrain queries for the bound map (shared with pathfinders). */
  readonly terrain: TerrainService;

  private map: TileMap;
  private readonly projector: WorldProjector;
  private pathfinder: Pathfinder | null;

  private readonly wrappers = new Map<UUID, AnyEntityWrapper>();
  private readonly sheets = new Map<UUID, LoadedSheet>();

  /** Spatial hash: storage-cell key ("col,row") -> entity ids on it. */
  private readonly buckets = new Map<string, Set<UUID>>();
  private readonly lastCellKeys = new Map<UUID, string>();

  /** Terrain tick bookkeeping: entity id -> next tick time (clock secs). */
  private readonly nextTerrainTick = new Map<UUID, number>();
  private clock = 0;

  private readonly addedHandlers = new Set<EntityHandler>();
  private readonly removedHandlers = new Set<EntityHandler>();
  private readonly updatedHandlers = new Set<EntityHandler>();

  private readonly runtime: EntityRuntime;

  constructor(map: TileMap, projector: WorldProjector, options?: EntityManagerOptions) {
    this.map = map;
    this.projector = projector;
    this.pathfinder = options && options.pathfinder ? options.pathfinder : null;
    this.terrain = new TerrainService(map);
    this.runtime = {
      projector,
      getSheet: (id) => this.sheets.get(id),
      tilesToPixels: (tiles) => this.tilesToPixels(tiles),
      getPathfinder: () => this.pathfinder,
      markUpdated: (entity) => this.emitUpdated(entity),
    };
    this.bindMapEntities();
  }

  /* ------------------------------------------------------------------ */
  /*  MAP BINDING                                                       */
  /* ------------------------------------------------------------------ */

  /** Rebind to a (new) map; wraps map.entities in place. */
  setMap(map: TileMap): void {
    this.clearRuntimeState();
    this.map = map;
    this.terrain.setMap(map);
    this.bindMapEntities();
  }

  getMap(): TileMap {
    return this.map;
  }

  private bindMapEntities(): void {
    for (const data of this.map.entities) this.wrap(data, false);
  }

  private clearRuntimeState(): void {
    for (const w of this.wrappers.values()) w.detach();
    this.wrappers.clear();
    this.buckets.clear();
    this.lastCellKeys.clear();
    this.nextTerrainTick.clear();
  }

  private wrap(data: AnyEntity, emit: boolean): AnyEntityWrapper {
    const wrapper = createEntity(data);
    wrapper.attach(this.runtime);
    this.wrappers.set(data.id, wrapper);
    this.indexEntity(wrapper);
    if (emit) this.emitAdded(wrapper);
    return wrapper;
  }

  /* ------------------------------------------------------------------ */
  /*  CRUD                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Add entity data to the bound map and wrap it. A missing or duplicate
   * id is replaced via genId() (the data object is mutated). Returns the
   * runtime wrapper.
   */
  add(data: AnyEntity): AnyEntityWrapper {
    if (!data.id || this.wrappers.has(data.id)) data.id = genId();
    this.map.entities.push(data);
    return this.wrap(data, true);
  }

  /** Remove an entity from the manager AND from map.entities. */
  remove(id: UUID): boolean {
    const wrapper = this.wrappers.get(id);
    if (!wrapper) return false;
    this.unindexEntity(id);
    this.wrappers.delete(id);
    this.nextTerrainTick.delete(id);
    wrapper.detach();
    const i = this.map.entities.findIndex((e) => e.id === id);
    if (i >= 0) this.map.entities.splice(i, 1);
    this.emitRemoved(wrapper);
    return true;
  }

  get(id: UUID): AnyEntityWrapper | undefined {
    return this.wrappers.get(id);
  }

  getAll(): AnyEntityWrapper[] {
    return Array.from(this.wrappers.values());
  }

  getByKind(kind: AnyEntity['kind']): AnyEntityWrapper[] {
    return this.getAll().filter((w) => w.kind === kind);
  }

  getByTag(tag: string): AnyEntityWrapper[] {
    return this.getAll().filter((w) => w.data.tags.indexOf(tag) >= 0);
  }

  count(): number {
    return this.wrappers.size;
  }

  /**
   * Editor-style teleport: moves, reindexes immediately, emits updated.
   * Does NOT apply terrain damage (see class docs; playtest teleports
   * should call applyTerrainEnter afterwards).
   */
  moveEntity(id: UUID, pos: GridPos): boolean {
    const wrapper = this.wrappers.get(id);
    if (!wrapper) return false;
    wrapper.setPos(pos);
    wrapper.consumeCellDirty();
    this.reindexEntity(wrapper);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /*  SPATIAL HASH & QUERIES                                            */
  /* ------------------------------------------------------------------ */

  private indexEntity(wrapper: AnyEntityWrapper): void {
    const key = cellKey(wrapper.pos);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new Set();
      this.buckets.set(key, bucket);
    }
    bucket.add(wrapper.id);
    this.lastCellKeys.set(wrapper.id, key);
  }

  private unindexEntity(id: UUID): void {
    const key = this.lastCellKeys.get(id);
    if (key === undefined) return;
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.delete(id);
      if (bucket.size === 0) this.buckets.delete(key);
    }
    this.lastCellKeys.delete(id);
  }

  private reindexEntity(wrapper: AnyEntityWrapper): void {
    this.unindexEntity(wrapper.id);
    this.indexEntity(wrapper);
  }

  /** Entities standing on a cell (by logical pos, not render pos). */
  entitiesAt(pos: GridPos): AnyEntityWrapper[] {
    const bucket = this.buckets.get(cellKey(pos));
    if (!bucket) return [];
    const out: AnyEntityWrapper[] = [];
    for (const id of bucket) {
      const w = this.wrappers.get(id);
      if (w) out.push(w);
    }
    return out;
  }

  /** Entities whose renderPos lies within radiusPx of a world point. */
  entitiesInRadius(center: Vec2, radiusPx: number): AnyEntityWrapper[] {
    const rect = {
      x: center.x - radiusPx,
      y: center.y - radiusPx,
      width: radiusPx * 2,
      height: radiusPx * 2,
    };
    return this.entitiesInRect(rect).filter(
      (w) => dist(center.x, center.y, w.renderPos.x, w.renderPos.y) <= radiusPx,
    );
  }

  /** Entities whose renderPos lies inside a world-space rect. */
  entitiesInRect(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): AnyEntityWrapper[] {
    const out: AnyEntityWrapper[] = [];
    const range = this.cellRangeForWorldRect(rect);
    for (let row = range.r0; row <= range.r1; row++) {
      for (let col = range.c0; col <= range.c1; col++) {
        const bucket = this.buckets.get(col + ',' + row);
        if (!bucket) continue;
        for (const id of bucket) {
          const w = this.wrappers.get(id);
          if (!w) continue;
          if (
            w.renderPos.x >= rect.x &&
            w.renderPos.x <= rect.x + rect.width &&
            w.renderPos.y >= rect.y &&
            w.renderPos.y <= rect.y + rect.height
          ) {
            out.push(w);
          }
        }
      }
    }
    return out;
  }

  /**
   * Storage-cell range overlapping a world rect (mirrors Phase 2 culling
   * with an extra margin so render-pos offsets can't miss a bucket).
   */
  private cellRangeForWorldRect(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): { c0: number; c1: number; r0: number; r1: number } {
    const w = this.map.width;
    const h = this.map.height;
    if (this.map.kind === 'square') {
      const ts = this.map.tileSize;
      return {
        c0: Math.max(0, Math.floor(rect.x / ts) - 1),
        c1: Math.min(w - 1, Math.floor((rect.x + rect.width) / ts) + 1),
        r0: Math.max(0, Math.floor(rect.y / ts) - 1),
        r1: Math.min(h - 1, Math.floor((rect.y + rect.height) / ts) + 1),
      };
    }
    const hexW = Math.sqrt(3) * this.map.hexSize;
    const rowStep = 1.5 * this.map.hexSize * this.map.isoRatio;
    return {
      c0: Math.max(0, Math.floor(rect.x / hexW) - 2),
      c1: Math.min(w - 1, Math.ceil((rect.x + rect.width) / hexW) + 2),
      r0: Math.max(0, Math.floor(rect.y / rowStep) - 2),
      r1: Math.min(h - 1, Math.ceil((rect.y + rect.height) / rowStep) + 2),
    };
  }

  /** World pixels spanned by n tiles (square: tileSize; hex: center pitch). */
  tilesToPixels(tiles: number): number {
    if (this.map.kind === 'square') return tiles * this.map.tileSize;
    return tiles * Math.sqrt(3) * this.map.hexSize;
  }

  /**
   * Nearest interactable to a world point: living NPCs qualify inside
   * their own interactionRadius, interactable props inside one tile.
   */
  findInteractable(worldPos: Vec2): AnyEntityWrapper | null {
    let best: AnyEntityWrapper | null = null;
    let bestD = Infinity;
    for (const w of this.entitiesInRadius(worldPos, this.tilesToPixels(4))) {
      const d = dist(worldPos.x, worldPos.y, w.renderPos.x, w.renderPos.y);
      let reach = -1;
      if (w instanceof NPCEntity && w.alive) reach = w.interactionRadiusPx();
      else if (w instanceof PropEntity && w.interactable) reach = this.tilesToPixels(1);
      if (reach >= 0 && d <= reach && d < bestD) {
        best = w;
        bestD = d;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /*  SCATTER TOOL (WC3-style doodad painting)                          */
  /* ------------------------------------------------------------------ */

  /**
   * Stamp `count` copies of a doodad template onto random cells within
   * radiusTiles of a center cell — fresh ids, random sub-cell pixel
   * jitter, area-uniform distribution, one shared scatterGroupId (from
   * options, or freshly generated) so a whole brush stroke undoes as one.
   */
  scatterDoodads(
    template: DoodadSprite,
    center: GridPos,
    radiusTiles: number,
    count: number,
    options?: { jitterPx?: number; groupId?: UUID },
  ): DoodadEntity[] {
    const groupId = options && options.groupId ? options.groupId : genId();
    const jitter =
      options && options.jitterPx !== undefined ? options.jitterPx : this.tilesToPixels(0.35);
    const centerWorld = this.projector.cellToWorld(center);
    const radiusPx = this.tilesToPixels(radiusTiles);
    const placed: DoodadEntity[] = [];
    let attempts = 0;
    const maxAttempts = Math.max(count * 12, 24);
    while (placed.length < count && attempts < maxAttempts) {
      attempts++;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * radiusPx; // area-uniform
      const cell = this.projector.worldToCell(
        centerWorld.x + Math.cos(ang) * rad,
        centerWorld.y + Math.sin(ang) * rad,
      );
      if (!cell) continue;
      const data = structuredClone(template);
      data.id = genId();
      data.pos = cell;
      data.scatterGroupId = groupId;
      data.pixelOffset = {
        x: (Math.random() * 2 - 1) * jitter,
        y: (Math.random() * 2 - 1) * jitter,
      };
      const w = this.add(data);
      if (w instanceof DoodadEntity) placed.push(w);
    }
    return placed;
  }

  /** Remove every doodad in a scatter group. Returns how many. */
  removeScatterGroup(groupId: UUID): number {
    let n = 0;
    for (const w of this.getAll()) {
      if (w instanceof DoodadEntity && w.scatterGroupId === groupId) {
        if (this.remove(w.id)) n++;
      }
    }
    return n;
  }

  /* ------------------------------------------------------------------ */
  /*  UPDATE LOOP & TERRAIN EFFECTS                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Advance the world. dt in SECONDS. Ticks animations, movement and
   * patrols, reconciles the spatial hash for entities that changed
   * cells, and applies terrain damage (on-enter + tickMs) to living
   * combatants.
   */
  update(dt: number): void {
    this.clock += dt;
    for (const w of this.wrappers.values()) {
      w.update(dt);
      if (w.consumeCellDirty()) {
        this.reindexEntity(w);
        this.applyTerrainEnter(w);
        this.emitUpdated(w);
      } else {
        this.applyTerrainTick(w);
      }
    }
  }

  /** Apply on-enter terrain damage now (public for gameplay teleports). */
  applyTerrainEnter(wrapper: BaseEntity): void {
    if (!(wrapper instanceof CombatantEntity) || !wrapper.alive) return;
    const dmg = this.terrain.damageAt(wrapper.pos);
    if (!dmg) {
      this.nextTerrainTick.delete(wrapper.id);
      return;
    }
    wrapper.takeDamage(dmg.amount);
    if (dmg.tickMs && dmg.tickMs > 0) {
      this.nextTerrainTick.set(wrapper.id, this.clock + dmg.tickMs / 1000);
    } else {
      this.nextTerrainTick.delete(wrapper.id);
    }
  }

  private applyTerrainTick(wrapper: AnyEntityWrapper): void {
    if (!(wrapper instanceof CombatantEntity) || !wrapper.alive) return;
    const at = this.nextTerrainTick.get(wrapper.id);
    if (at === undefined || this.clock < at) return;
    const dmg = this.terrain.damageAt(wrapper.pos);
    if (!dmg || !dmg.tickMs) {
      this.nextTerrainTick.delete(wrapper.id);
      return;
    }
    wrapper.takeDamage(dmg.amount);
    this.nextTerrainTick.set(wrapper.id, this.clock + dmg.tickMs / 1000);
  }

  /* ------------------------------------------------------------------ */
  /*  RENDERING                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Draw all visible entities in painter's order (zIndex, then feet-y).
   * Bound arrow — hand it straight to TileEngine.setEntityRenderHook.
   */
  readonly renderHook = (ctx: CanvasRenderingContext2D): void => {
    const list = this.getAll().sort(
      (a, b) => a.data.zIndex - b.data.zIndex || a.renderPos.y - b.renderPos.y,
    );
    for (const w of list) w.draw(ctx);
  };

  /* ------------------------------------------------------------------ */
  /*  SPRITESHEETS                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Register spritesheet metadata with an optional pre-decoded image.
   * A null image is fine in headless contexts — sprites draw magenta
   * placeholders until the image arrives.
   */
  addSheet(asset: SpritesheetAsset, image: HTMLImageElement | null = null): void {
    this.sheets.set(asset.id, { asset, image });
  }

  /** Decode a spritesheet's data-URL image and register it. */
  async loadSheet(asset: SpritesheetAsset): Promise<void> {
    this.addSheet(asset, await loadImage(asset.src));
  }

  /** Load every spritesheet in a project's AssetManifest. */
  async registerAssets(manifest: AssetManifest): Promise<void> {
    await Promise.all(manifest.spritesheets.map((s) => this.loadSheet(s)));
  }

  getSheet(id: UUID): LoadedSheet | undefined {
    return this.sheets.get(id);
  }

  /* ------------------------------------------------------------------ */
  /*  PATHFINDING                                                       */
  /* ------------------------------------------------------------------ */

  /** Shared pathfinder used by walkTo when none is passed explicitly. */
  setPathfinder(pf: Pathfinder | null): void {
    this.pathfinder = pf;
  }

  getPathfinder(): Pathfinder | null {
    return this.pathfinder;
  }

  /* ------------------------------------------------------------------ */
  /*  SERIALIZATION                                                     */
  /* ------------------------------------------------------------------ */

  /** Deep-copied snapshot of every entity's data. */
  toJSON(): AnyEntity[] {
    return structuredClone(this.map.entities);
  }

  /** Replace the bound map's entities with deep copies of `list`. */
  fromJSON(list: AnyEntity[]): void {
    this.clearRuntimeState();
    this.map.entities.length = 0;
    for (const data of structuredClone(list)) this.map.entities.push(data);
    this.bindMapEntities();
  }

  /* ------------------------------------------------------------------ */
  /*  EVENT BUS                                                         */
  /* ------------------------------------------------------------------ */

  onEntityAdded(handler: EntityHandler): Unsubscribe {
    this.addedHandlers.add(handler);
    return () => {
      this.addedHandlers.delete(handler);
    };
  }

  onEntityRemoved(handler: EntityHandler): Unsubscribe {
    this.removedHandlers.add(handler);
    return () => {
      this.removedHandlers.delete(handler);
    };
  }

  /**
   * Fires on stat/position/state changes. Compound changes may fire this
   * more than once in a frame — treat it as "dirty", not as a diff.
   */
  onEntityUpdated(handler: EntityHandler): Unsubscribe {
    this.updatedHandlers.add(handler);
    return () => {
      this.updatedHandlers.delete(handler);
    };
  }

  private emitAdded(w: BaseEntity): void {
    for (const h of this.addedHandlers) h(w);
  }

  private emitRemoved(w: BaseEntity): void {
    for (const h of this.removedHandlers) h(w);
  }

  private emitUpdated(w: BaseEntity): void {
    for (const h of this.updatedHandlers) h(w);
  }

  /** Detach everything and clear all handlers. */
  destroy(): void {
    this.clearRuntimeState();
    this.addedHandlers.clear();
    this.removedHandlers.clear();
    this.updatedHandlers.clear();
  }
}
