/**
 * Defaults applied when content is CREATED. The validator never fills
 * anything in (it rejects rather than repairs), so these are the one place
 * the spec's "default ..." comments become values.
 */
import { SCHEMA_MINOR, SCHEMA_VERSION } from './project.ts';
import type { FactionDef, Id, InputActionDef, MapDef, Project, ProjectSettings, TerrainDef } from './project.ts';

/** Produces fresh UUID v4 strings. The editor passes `crypto.randomUUID`. */
export type IdFactory = () => string;

/**
 * A deterministic UUID v4 factory for fixtures and tests (mulberry32).
 * Never use it for real content: two projects seeded alike would collide.
 */
export function seededIdFactory(seed: number): IdFactory {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const hex = (n: number, digits: number): string => (n >>> 0).toString(16).padStart(8, '0').slice(0, digits);
  return () => {
    const a = next();
    const b = next();
    const c = next();
    const d = next();
    const variant = (8 + (c >>> 30)).toString(16); // 8, 9, a or b
    return `${hex(a, 8)}-${hex(b, 4)}-4${hex(b << 16, 3)}-${variant}${hex(c << 2, 3)}-${hex(d, 8)}${hex(c << 14, 4)}`;
  };
}

export function defaultSettings(playerArchetypeId: Id<'archetype'>): ProjectSettings {
  return {
    playerArchetypeId,
    msPerTurn: 3000,
    hexSize: 1,
    levelHeight: 0.5,
    maxLevel: 15,
    pixelsPerUnit: 64,
    sight: { uphillBlocked: true, uphillRevealRange: 1.5 },
    friendlyFire: false,
  };
}

/** The three factions every new project is seeded with (spec 4.6). */
export function seedFactions(newId: IdFactory): FactionDef[] {
  const player = newId() as Id<'faction'>;
  const hostile = newId() as Id<'faction'>;
  const neutral = newId() as Id<'faction'>;
  return [
    { id: player, name: 'player', relations: { [hostile]: 'hostile' } },
    { id: hostile, name: 'hostile', relations: { [player]: 'hostile' } },
    { id: neutral, name: 'neutral', relations: {} },
  ];
}

/** Diablo-style click-to-act plus WASD (Q5). */
export function seedInputActions(newId: IdFactory): InputActionDef[] {
  const action = (
    name: string,
    kind: InputActionDef['kind'],
    role: NonNullable<InputActionDef['role']>,
    defaultBindings: string[],
  ): InputActionDef => ({ id: newId() as Id<'input'>, name, kind, role, defaultBindings });
  return [
    action('Move', 'axis2', 'move', ['KeyW', 'KeyA', 'KeyS', 'KeyD']),
    action('Aim', 'pointer', 'aim', ['Pointer']),
    action('Click', 'button', 'click', ['Mouse0']),
    action('Attack', 'button', 'attack-primary', ['KeyJ']),
    action('Heavy attack', 'button', 'attack-secondary', ['Mouse2', 'KeyK']),
    action('Dodge', 'button', 'dodge', ['Space']),
    action('Interact', 'button', 'interact', ['KeyE']),
  ];
}

/** `blocksSight` defaults to `!walk && !swim`; `blocksProjectiles` to `blocksSight`. */
export function terrainDefaults(
  passable: TerrainDef['passable'],
): Pick<TerrainDef, 'moveCost' | 'blocksSight' | 'blocksProjectiles'> {
  const blocksSight = !passable.walk && !passable.swim;
  return { moveCost: 1, blocksSight, blocksProjectiles: blocksSight };
}

/** An empty map: every cell terrain 0, level 0, no ramps. */
export function createMap(id: Id<'map'>, name: string, width: number, height: number, terrainId: Id<'terrain'>): MapDef {
  const cells = width * height;
  return {
    id,
    name,
    width,
    height,
    terrainPalette: [terrainId],
    layers: { terrain: new Uint16Array(cells), level: new Uint8Array(cells), ramp: new Uint8Array(cells) },
    playerStart: undefined,
    placements: [],
    regions: [],
    triggers: [],
    bgm: undefined,
  };
}

/** The envelope of a project; the caller supplies the content that makes it valid. */
export function projectEnvelope(id: Id<'project'>, name: string): Pick<Project, 'schemaVersion' | 'schemaMinor' | 'id' | 'name' | 'contentRevision'> {
  return { schemaVersion: SCHEMA_VERSION, schemaMinor: SCHEMA_MINOR, id, name, contentRevision: 0 };
}
