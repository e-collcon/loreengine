/**
 * The canvas's view of a map while authoring (spec 8.3): shaped like the
 * runtime's read-only view, so `PixiRenderer` draws it, but built from the
 * same headless `World` the game uses plus the map's placements. There is no
 * runtime: nothing ticks, entities stand where they are placed, idle.
 *
 * Entity index i is placement i; the last index is the player's start, drawn
 * as the player archetype.
 */
import { FLY_LEVELS, NO_ENTITY, World } from '@loreengine/runtime/view';
import type { DiagnosticsView, EntityId, EntityView, PresentationView, RuntimeView, WorldView } from '@loreengine/runtime/view';
import type { ComponentData, EntityPlacement, MapDef, Project } from '@loreengine/schema';

interface Slot {
  x: number;
  y: number;
  z: number;
  facing: number;
  archetype: number;
  data: ComponentData;
  key: string;
  id: EntityId;
}

export const PLAYER_START_KEY = 'player-start';

export class MapPreview implements RuntimeView {
  world!: WorldView;
  /** The headless world, rebuilt by `refresh`. */
  raw!: World;
  map!: MapDef;
  private slots: Slot[] = [];
  private readonly signatures: string[] = [];
  private readonly generations: number[] = [];
  readonly entities: EntityView;
  readonly presentation: PresentationView = { end: 0, since: () => 0 };
  readonly diagnostics: DiagnosticsView = { countOf: () => 0, counters: () => ({}), entries: () => [] };
  readonly tick = 0;
  readonly clockMode = 'continuous' as const;
  readonly pendingSteps = 0;
  readonly outcome = null;

  constructor(
    readonly project: Project,
    public currentMapId: string,
  ) {
    const self = this;
    const slot = (i: number): Slot => self.slots[i]!;
    this.entities = {
      get count() {
        return self.slots.length;
      },
      get highWater() {
        return self.slots.length;
      },
      alive: (i) => i >= 0 && i < self.slots.length,
      id: (i) => (i >= 0 && i < self.slots.length ? slot(i).id : NO_ENTITY),
      indexOf: (id) => self.slots.findIndex((s) => s.id === id),
      playerIndex: () => -1, // the start marker is not a live player
      x: (i) => slot(i).x,
      y: (i) => slot(i).y,
      z: (i) => slot(i).z,
      facing: (i) => slot(i).facing,
      prevX: (i) => slot(i).x,
      prevY: (i) => slot(i).y,
      prevZ: (i) => slot(i).z,
      hp: (i) => slot(i).data.health?.max ?? 0,
      hpMax: (i) => slot(i).data.health?.max ?? 0,
      dead: () => false,
      archetype: (i) => slot(i).archetype,
      data: (i) => slot(i).data,
      placementKey: (i) => slot(i).key,
      brainState: () => '',
      target: () => NO_ENTITY,
      clip: () => 'idle',
      frame: () => 0,
      attackPhase: () => 0,
      attack: () => -1,
      dodging: () => false,
      airborne: () => false,
      hitstop: () => 0,
      invulnerable: () => false,
      path: () => 0,
    };
    this.refresh();
  }

  /** Rebuild the world and the placements from the project: call after every edit. */
  refresh(): void {
    const map = this.project.maps.find((m) => m.id === this.currentMapId) ?? this.project.maps[0]!;
    this.map = map;
    this.currentMapId = map.id;
    const raw = new World(this.project, map);
    this.raw = raw;
    this.world = {
      loaded: true,
      width: raw.width,
      height: raw.height,
      cellAt: (x, y) => raw.cellAt(x, y),
      surfaceHeight: (x, y) => raw.surfaceHeight(x, y),
      edgeHeight: (cell, dir) => raw.edgeHeight(cell, dir),
      connects: (a, b, mode) => raw.connects(a, b, mode),
      level: (cell) => raw.level[cell]!,
      ramp: (cell) => raw.ramp[cell]!,
      terrain: (cell) => raw.terrainDef[cell]!,
      centerX: (cell) => raw.centerX(cell),
      centerY: (cell) => raw.centerY(cell),
      neighbor: (cell, dir) => raw.neighbor[cell * 6 + dir - 1]!,
      heightIn: (cell, x, y) => raw.surfaceHeightIn(cell, x, y),
    };

    const placed: EntityPlacement[] = [...map.placements];
    if (map.playerStart) {
      placed.push({ key: PLAYER_START_KEY as EntityPlacement['key'], archetypeId: this.project.settings.playerArchetypeId, x: map.playerStart.x, y: map.playerStart.y, facing: map.playerStart.facing });
    }
    const slots: Slot[] = [];
    placed.forEach((p, i) => {
      const archetype = Math.max(0, this.project.archetypes.findIndex((a) => a.id === p.archetypeId));
      const def = this.project.archetypes[archetype]!;
      const data: ComponentData = p.overrides ? { ...def.components, ...p.overrides } : def.components;
      // A new generation whenever what stands in this slot changes, so the renderer rebuilds its sprite.
      const signature = `${p.key}|${p.archetypeId}|${JSON.stringify(data.sprite ?? null)}|${JSON.stringify(data.collider ?? null)}`;
      if (this.signatures[i] !== signature) {
        this.signatures[i] = signature;
        this.generations[i] = (this.generations[i] ?? 0) + 1;
      }
      // Flyers hover as the runtime spawns them: FLY_LEVELS levels above the ground.
      const fly = data.movement?.startMode === 'fly';
      const ground = raw.surfaceHeight(p.x, p.y);
      slots.push({ x: p.x, y: p.y, z: fly ? ground + FLY_LEVELS * this.project.settings.levelHeight : ground, facing: p.facing, archetype, data, key: p.key, id: this.generations[i]! * 65536 + i });
    });
    this.slots = slots;
  }

  /** The entity index of a placement key, or -1. */
  indexOfKey(key: string): number {
    return this.slots.findIndex((s) => s.key === key);
  }

  variable(): undefined {
    return undefined;
  }
  clickAction(): 'none' {
    return 'none';
  }
  interactTarget(): number {
    return -1;
  }
  castSegment(): { hit: 'none'; t: number } {
    return { hit: 'none', t: 1 };
  }
  canSee(): boolean {
    return false;
  }
  stats(): { entities: number; subscriptions: number; timers: number; queuedEvents: number } {
    return { entities: this.slots.length, subscriptions: 0, timers: 0, queuedEvents: 0 };
  }
  stateHash(): string {
    return '';
  }
}
