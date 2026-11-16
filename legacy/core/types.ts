/**
 * ============================================================================
 *  LoreBrix — Core Data Model (Phase 1)
 *  schemaVersion: 1
 * ============================================================================
 *  This file is the single source of truth for every data shape in LoreBrix.
 *  Phases 2–5 import from here and MUST NOT redefine these types.
 *
 *  Key architectural decisions (see ARCHITECTURE.md for rationale):
 *   1. Discriminated unions everywhere: TileMap.kind, entity .kind,
 *      GameplayRule.mode, GridPos.kind. Engines switch on the discriminant.
 *   2. Terrain is TILE DATA, not an entity. Per-cell properties live on
 *      TerrainTile; the runtime (Phase 3) reads them for collision/damage.
 *   3. Entities are embedded per-map. Reusable blueprints live in
 *      Project.templates.
 *   4. Hex maps store cells in a rectangular array using odd-r OFFSET
 *      coordinates; math is done in cube coordinates (Phase 2 converts).
 * ============================================================================
 */

/* ========================================================================== */
/*  PRIMITIVES                                                                */
/* ========================================================================== */

/** UUID v4 string. Every persistent object carries one. */
export type UUID = string;

/**
 * Reference to an asset. In v1 (single-file portability) this is a data URL.
 * When LoreBrix platform storage lands, this becomes an asset-service key —
 * only the resolver changes, never this type.
 */
export type AssetRef = string;

export interface Vec2 {
  x: number;
  y: number;
}

export type Direction4 = 'up' | 'down' | 'left' | 'right';

/**
 * Position on a map grid. The discriminant matches the owning map's kind.
 *  - square: integer tile coords, origin top-left, +x right, +y down.
 *  - hex:    axial coordinates (pointy-top). Cube s is derived: s = -q - r.
 */
export type GridPos =
  | { kind: 'square'; x: number; y: number }
  | { kind: 'hex'; q: number; r: number };

/* ========================================================================== */
/*  ASSETS                                                                    */
/* ========================================================================== */

export interface TilesetAsset {
  id: UUID;
  name: string;
  src: AssetRef;
  tileWidth: number;
  tileHeight: number;
  /** Grid dimensions of the source image after slicing. */
  columns: number;
  rows: number;
}

/**
 * One animation on a spritesheet.
 * frames are indices into the sheet (row-major, left→right, top→bottom).
 */
export interface AnimationClip {
  frames: number[];
  fps: number;
  loop: boolean;
}

/**
 * Canonical animation keys for combat-capable sprites.
 * Sheets may define extras, but these names are the contract the
 * runtime (Phase 3) and playtest loop (Phase 5) rely on.
 */
export const CORE_ANIM_KEYS = [
  'idle',
  'walk-up',
  'walk-down',
  'walk-left',
  'walk-right',
  'attack',
  'hurt',
  'death',
] as const;
export type CoreAnimKey = (typeof CORE_ANIM_KEYS)[number];

export interface SpritesheetAsset {
  id: UUID;
  name: string;
  src: AssetRef;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, AnimationClip>;
}

export interface AudioAsset {
  id: UUID;
  name: string;
  src: AssetRef;
  kind: 'bgm' | 'sfx';
}

export interface AssetManifest {
  tilesets: TilesetAsset[];
  spritesheets: SpritesheetAsset[];
  audio: AudioAsset[];
}

/* ========================================================================== */
/*  TILES                                                                     */
/* ========================================================================== */

/** Points at one cell of a sliced tileset. */
export interface TileRef {
  tilesetId: UUID;
  /** Row-major index into the sliced tileset. */
  index: number;
}

/** A placed tile instance inside a layer. */
export interface Tile {
  /** null ref = intentionally empty cell that still carries overrides. */
  ref: TileRef | null;
  rotation?: 0 | 90 | 180 | 270;
  flipX?: boolean;
  flipY?: boolean;
}

/** Gameplay-relevant, per-cell physical properties. */
export interface TerrainProperties {
  walkable: boolean;
  swimmable: boolean;
  flyable: boolean;
  /** Pathfinding weight. 1 = normal. Ignored when cell is impassable. */
  moveCost: number;
  /** e.g. lava, poison swamp. Applied by the runtime on enter / per tick. */
  damageOnEnter?: {
    amount: number;
    /** Free-form damage type tag, e.g. 'fire', 'poison'. */
    type: string;
    /** If set, damage repeats every N ms while standing on the cell. */
    tickMs?: number;
  };
  /** Optional looping animation shown on this cell (water shimmer etc.). */
  transitionAnim?: { spritesheetId: UUID; clip: string };
}

/**
 * A tile that carries terrain data. Terrain lives on the map, dense and
 * per-cell — it is NOT an entity (see file header, decision 2).
 */
export interface TerrainTile extends Tile {
  terrain: TerrainProperties;
}

/**
 * A tile on a hex-iso map. Storage position is implicit in the layer array
 * (odd-r offset); `elevation` lifts the cell visually in the iso projection.
 */
export interface HexTile extends Tile {
  elevation?: number;
}

/* ========================================================================== */
/*  LAYERS & MAPS                                                             */
/* ========================================================================== */

export type TileLayerType =
  | 'background'
  | 'midground'
  | 'foreground'
  | 'collision';

/**
 * Dense, row-major cell array of length width*height.
 * Square maps: index = y * width + x.
 * Hex maps:    index = row * width + col   (odd-r offset storage).
 * null = empty cell.
 */
export interface TileLayer {
  id: UUID;
  name: string;
  type: TileLayerType;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
  data: (Tile | TerrainTile | HexTile | null)[];
}

interface BaseTileMap {
  id: UUID;
  name: string;
  width: number;
  height: number;
  layers: TileLayer[];
  /** Entity instances placed on this map (decision 3). */
  entities: AnyEntity[];
  triggers: MapTrigger[];
  spawnPoint: GridPos;
  backgroundColor: string;
  bgm?: UUID; // AudioAsset id
}

export interface SquareTileMap extends BaseTileMap {
  kind: 'square';
  tileSize: 16 | 32 | 48 | 64;
}

export interface HexIsoTileMap extends BaseTileMap {
  kind: 'hex-iso';
  /** Hex radius in px (center → corner) before iso squash. */
  hexSize: number;
  /** v1 supports pointy-top only. */
  orientation: 'pointy';
  /** Vertical squash factor for the isometric look. Classic value ≈ 0.577. */
  isoRatio: number;
}

export type TileMap = SquareTileMap | HexIsoTileMap;

/* ========================================================================== */
/*  TRIGGERS & ACTIONS                                                        */
/* ========================================================================== */

export type TriggerZone =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'hexes'; cells: { q: number; r: number }[] };

export type TriggerAction =
  | { type: 'play-cutscene'; cutsceneId: UUID }
  | { type: 'spawn-enemy'; templateId: UUID; at: GridPos }
  | { type: 'open-shop'; merchantId: UUID }
  | { type: 'change-bgm'; audioId: UUID; fadeMs?: number }
  | { type: 'teleport-player'; mapId: UUID; to: GridPos }
  | { type: 'run-script'; script: string };

export interface MapTrigger {
  id: UUID;
  name: string;
  zone: TriggerZone;
  event: 'on-enter' | 'on-exit' | 'on-interact';
  actions: TriggerAction[];
  /** If true, the trigger disarms after firing once. */
  once: boolean;
}

/* ========================================================================== */
/*  ENTITIES / SPRITES                                                        */
/* ========================================================================== */

export type EntityKind = 'player' | 'npc' | 'prop' | 'doodad';

/** Shared by every placeable entity. ("Sprite (base)" from the brief.) */
export interface SpriteBase {
  id: UUID;
  kind: EntityKind;
  name: string;
  pos: GridPos;
  /** Fine-placement nudge in px, mostly for props/doodads. */
  pixelOffset?: Vec2;
  zIndex: number;
  visible: boolean;
  spritesheetId: UUID;
  /** Key into the sheet's animations record. */
  currentAnim: string;
  tags: string[];
}

export interface StatBlock {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  atk: number;
  def: number;
  spd: number;
  /** Creator-defined stats, e.g. { luck: 7 }. */
  custom: Record<string, number>;
}

export interface InventoryItem {
  id: UUID;
  name: string;
  icon?: AssetRef;
  qty: number;
  meta?: Record<string, unknown>;
}

/** Shared base for anything that fights or moves with intent. */
export interface CombatantBase extends SpriteBase {
  stats: StatBlock;
  facing: Direction4;
  /** Tiles per second in action mode; flavor-only in turn-based. */
  moveSpeed: number;
  inventory: InventoryItem[];
}

export interface PlayerSprite extends CombatantBase {
  kind: 'player';
}

export type NPCBehaviorMode =
  | 'passive'
  | 'aggressive'
  | 'merchant'
  | 'quest-giver'
  | 'guard';

export interface DialogueNode {
  id: string;
  speaker: string;
  text: string;
  /** Linear next node; null ends the conversation. Ignored if choices exist. */
  next?: string | null;
  choices?: {
    text: string;
    next: string | null;
    action?: TriggerAction;
  }[];
}

export interface DialogueTree {
  rootId: string;
  nodes: Record<string, DialogueNode>;
}

export interface PatrolPath {
  waypoints: GridPos[];
  mode: 'loop' | 'ping-pong' | 'once';
  /** Pause at each waypoint, ms. */
  waitMs: number;
}

export interface NPCSprite extends CombatantBase {
  kind: 'npc';
  behavior: NPCBehaviorMode;
  dialogue?: DialogueTree;
  patrol?: PatrolPath;
  /** Tiles within which the player can interact. */
  interactionRadius: number;
  /** Tiles within which an aggressive/guard NPC engages. */
  aggroRadius?: number;
  /** Links to a BehaviorStateMachine authored in the Rules UI (Phase 4). */
  behaviorMachineId?: UUID;
}

export interface BoundingBox {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface PropSprite extends SpriteBase {
  kind: 'prop';
  interactable: boolean;
  onInteract?: TriggerAction[];
  /** null = decorative prop with no collision. */
  collider: BoundingBox | null;
}

export interface DoodadSprite extends SpriteBase {
  kind: 'doodad';
  /** Doodads never collide (WC3-style). Promote to Prop if you need one to. */
  collider: null;
  /** Looping ambient animation; no game logic attached. */
  ambientAnim: AnimationClip;
  /** Wind/wobble hook, rendered by the engine (Phase 2/3). */
  wobble?: { amplitude: number; speedHz: number };
  /** Set on every doodad placed by one drag of the scatter tool. */
  scatterGroupId?: UUID;
}

export type AnyEntity = PlayerSprite | NPCSprite | PropSprite | DoodadSprite;

/* ========================================================================== */
/*  GAMEPLAY RULES ENGINE                                                     */
/* ========================================================================== */

export type GameMode = 'turn-based' | 'action';

export type StatKey =
  | 'hp'
  | 'mp'
  | 'atk'
  | 'def'
  | 'spd'
  | (string & {}); // custom stat names remain valid, core keys autocomplete

/** Nodes of the visual damage-formula graph (Phase 4 builds the editor). */
export type FormulaNode =
  | { id: string; op: 'stat'; stat: StatKey; target: 'attacker' | 'defender' }
  | { id: string; op: 'const'; value: number }
  | { id: string; op: 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max' }
  | { id: string; op: 'random'; min: number; max: number };

export interface FormulaEdge {
  from: string; // node id
  to: string; // node id
  /** Which input socket on the target node: 'a' | 'b'. */
  toInput: 'a' | 'b';
}

export interface FormulaGraph {
  nodes: FormulaNode[];
  edges: FormulaEdge[];
  outputNodeId: string;
}

export interface StatusEffectDef {
  id: UUID;
  name: string;
  icon?: AssetRef;
  durationTurns: number;
  /** Damage applied at the start of each affected turn. */
  tickDamage?: number;
  /** Additive stat deltas while active, e.g. { spd: -2 }. */
  statModifiers?: Partial<Record<'atk' | 'def' | 'spd', number>>;
  stackable: boolean;
}

export type Condition =
  | { type: 'all-enemies-defeated' }
  | { type: 'player-defeated' }
  | { type: 'entity-defeated'; entityId: UUID }
  | { type: 'reach-zone'; mapId: UUID; zone: TriggerZone }
  | { type: 'flag-set'; flag: string; value: boolean }
  | { type: 'turn-limit'; turns: number };

export interface TurnBasedRPGConfig {
  mode: 'turn-based';
  turnOrder: 'speed' | 'fixed' | 'random';
  /** 1–10 */
  actionPointsPerTurn: number;
  damageFormula: FormulaGraph;
  statusEffects: StatusEffectDef[];
  winConditions: Condition[];
  loseConditions: Condition[];
}

export interface ActionRPGConfig {
  mode: 'action';
  hitDetection: 'circle' | 'rect' | 'pixel';
  cooldown: { type: 'global' | 'per-skill'; globalMs?: number };
  combos: { enabled: boolean; windowMs?: number; maxChain?: number };
  knockback: { enabled: boolean; force: number };
  /** Invincibility frames after taking a hit, ms. */
  iframesMs: number;
  winConditions: Condition[];
  loseConditions: Condition[];
}

export type GameplayRule = TurnBasedRPGConfig | ActionRPGConfig;

/* ---- NPC behavior state machines (authored in Phase 4, run in Phase 3) --- */

export type BehaviorState =
  | 'idle'
  | 'patrol'
  | 'chase'
  | 'attack'
  | 'flee'
  | 'interact';

export type BehaviorCondition =
  | { type: 'distance'; comparator: '<' | '>'; tiles: number }
  | { type: 'hp-threshold'; comparator: '<' | '>'; percent: number }
  | { type: 'line-of-sight'; visible: boolean };

export interface BehaviorTransition {
  from: BehaviorState;
  to: BehaviorState;
  condition: BehaviorCondition;
}

export interface BehaviorStateMachine {
  id: UUID;
  name: string;
  initial: BehaviorState;
  states: BehaviorState[];
  transitions: BehaviorTransition[];
}

/* ========================================================================== */
/*  PROJECT (top-level container)                                             */
/* ========================================================================== */

export interface ProjectMeta {
  name: string;
  author: string;
  description: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /**
   * LoreBrix platform hooks — dormant in the editor MVP, but the shape is
   * reserved so publishing lands without a schema migration.
   */
  publishing?: {
    visibility: 'private' | 'unlisted' | 'public';
    coverArt?: AssetRef;
    publishedId?: string;
  };
}

/** Reusable blueprints. Placing one deep-copies it into map.entities. */
export interface TemplateLibrary {
  npcs: NPCSprite[];
  props: PropSprite[];
  doodads: DoodadSprite[];
}

export interface Project {
  schemaVersion: 1;
  id: UUID;
  meta: ProjectMeta;
  maps: TileMap[];
  activeMapId: UUID;
  /** The single player-character definition for v1. */
  player: PlayerSprite;
  templates: TemplateLibrary;
  rules: GameplayRule;
  behaviors: BehaviorStateMachine[];
  assets: AssetManifest;
}

/* ========================================================================== */
/*  EDITOR STATE (runtime only — never serialized except .project)            */
/* ========================================================================== */

export type ToolId =
  | 'select'
  | 'paint'
  | 'erase'
  | 'fill'
  | 'place-entity'
  | 'eyedropper'
  | 'ruler'
  | 'scatter';

export type EditorMode = 'map' | 'entity' | 'rules';

export interface CameraState {
  /** World-space px of the viewport's top-left corner. */
  x: number;
  y: number;
  /** 0.25 – 4.0 */
  zoom: number;
}

/**
 * Undoable command. Both closures must be pure w.r.t. everything except the
 * EditorState they were created against. Runtime-only, never serialized.
 */
export interface EditorCommand {
  label: string;
  apply: (state: EditorState) => void;
  revert: (state: EditorState) => void;
}

export interface EditorUIState {
  mode: EditorMode;
  activeTool: ToolId;
  activeLayerId: UUID | null;
  selectedEntityIds: UUID[];
  /** Tile currently loaded on the paint brush. */
  brushTile: TileRef | null;
  camera: CameraState;
  gridVisible: boolean;
}

export interface PlaytestState {
  active: boolean;
  /** Deep-frozen copy of the project taken when playtest starts. */
  snapshot: Project | null;
}

export interface EditorState {
  project: Project;
  ui: EditorUIState;
  playtest: PlaytestState;
  history: { undo: EditorCommand[]; redo: EditorCommand[] };
  dirty: boolean;
}

/* ========================================================================== */
/*  SERIALIZATION CONSTANTS                                                   */
/* ========================================================================== */

export const SCHEMA_VERSION = 1 as const;
export const LOREBRIX_FILE_EXT = '.lorebrix.json' as const;
