import { EMBERFALL, buildEmberfall, cellCenter, id } from '@loreengine/fixtures';
import type { Action, Condition, Id, Project, TriggerDef } from '@loreengine/schema';
import { emptyInput } from '../src/index.ts';
import { createSim } from '../src/runtime.ts';
import type { RuntimeOptions } from '../src/runtime.ts';
import type { Sim } from '../src/sim.ts';

export { EMBERFALL, cellCenter, id };

/** Emberfall with its triggers removed: entities and variables, nothing scripted. */
export function bareProject(mutate?: (p: Project) => void): Project {
  const p = buildEmberfall();
  p.triggers = [];
  p.maps[0]!.triggers = [];
  if (mutate) mutate(p);
  return p;
}

export const OPTS: RuntimeOptions = { seed: 1234, clockMode: 'continuous' };

export function bareSim(mutate?: (p: Project) => void, opts: Partial<RuntimeOptions> = {}): Sim {
  return createSim(bareProject(mutate), null, { ...OPTS, ...opts });
}

/** Variable ids of the Emberfall fixture. */
export const V = {
  talked: id('variable', 'talked_to_elder'),
  enraged: id('variable', 'boss_enraged'),
  pulses: id('variable', 'ember_pulses'),
  lucky: id('variable', 'lucky_pulses'),
  visits: id('variable', 'arena_visits'), // session scope
  greeting: id('variable', 'elder_greeting'), // readonly string
};

export const KEYS = {
  elder: id('placement', 'elder'),
  sentry: id('placement', 'sentry'),
  warden: id('placement', 'warden'),
};

let counter = 0;
/** A trigger with a fresh id. */
export function trigger(when: TriggerDef['when'], then: Action[], opts: { given?: Condition[]; once?: boolean; enabled?: boolean; name?: string } = {}): TriggerDef {
  return {
    id: id('trigger', opts.name ?? `test-${counter++}`) as Id<'trigger'>,
    when,
    given: opts.given ?? [],
    then,
    once: opts.once ?? false,
    enabled: opts.enabled ?? true,
  };
}

export const setVar = (variableId: Id<'variable'>, value: boolean | number | string): Action => ({
  type: 'set-variable',
  variableId,
  op: { kind: 'set', value },
});
export const addVar = (variableId: Id<'variable'>, value: number): Action => ({ type: 'set-variable', variableId, op: { kind: 'add', value } });

/** Step a sim `n` ticks with empty input. */
export function run(sim: Sim, n: number): void {
  const frame = emptyInput();
  for (let i = 0; i < n; i++) {
    sim.input.set(frame);
    sim.step();
  }
}

/** Every presentation event raised so far, as plain objects. */
export function presented(sim: Sim): { kind: string; a: number; b: number; s: string; n: number; tick: number }[] {
  const out: { kind: string; a: number; b: number; s: string; n: number; tick: number }[] = [];
  sim.presentation.since(0, (e) => void out.push({ kind: e.kind, a: e.a, b: e.b, s: e.s, n: e.n, tick: e.tick }));
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Phase 4 helpers                                                           */
/* -------------------------------------------------------------------------- */

import { MapPainter } from '@loreengine/fixtures';
import { checkProject } from '@loreengine/schema';
import type { ArchetypeDef, ComponentData, EntityPlacement, MapDef } from '@loreengine/schema';
import type { InputFrame } from '../src/index.ts';

export const TERRAIN = { grass: 0, dirt: 1, stone: 2, lava: 3, water: 4, rock: 5 } as const;

export interface Stage {
  project: Project;
  /** Add a placement of an existing archetype (by name) at a cell or a point. */
  place(name: string, archetype: string, at: { col: number; row: number } | { x: number; y: number }, overrides?: ComponentData): Id<'placement'>;
  /** Add a new archetype. */
  archetype(name: string, components: ComponentData, tags?: string[]): Id<'archetype'>;
  /** Add a region made of the given cells, in that order. */
  region(name: string, cells: [col: number, row: number][]): Id<'region'>;
}

/**
 * A one-map project over Emberfall's content, painted by `paint`, with the
 * player starting at `start`. Emberfall's own map, triggers and placements
 * are gone; its archetypes, attacks, brains and factions remain.
 */
export function stage(width: number, height: number, start: { col: number; row: number }, build?: (m: MapPainter, s: Stage) => void): Project {
  const project = buildEmberfall();
  project.triggers = [];
  const painter = new MapPainter(width, height);
  painter.fill({ col: 0, row: 0, w: width, h: height }, TERRAIN.grass, 0);
  const placements: EntityPlacement[] = [];
  const regions: MapDef['regions'] = [];
  const s: Stage = {
    project,
    place(name, archetype, at, overrides) {
      const p = 'col' in at ? cellCenter(at.col, at.row) : at;
      const key = id('placement', name) as Id<'placement'>;
      placements.push({ key, archetypeId: project.archetypes.find((a) => a.name === archetype)!.id, x: p.x, y: p.y, facing: 0, overrides });
      return key;
    },
    region(name, cells) {
      const packed = new Int16Array(cells.length * 2);
      cells.forEach(([col, row], k) => {
        packed[k * 2] = col - (row - (row & 1)) / 2;
        packed[k * 2 + 1] = row;
      });
      const regionId = id('region', name) as Id<'region'>;
      regions.push({ id: regionId, name, cells: packed });
      return regionId;
    },
    archetype(name, components, tags = []) {
      const def: ArchetypeDef = { id: id('archetype', name) as Id<'archetype'>, name, tags, components };
      project.archetypes.push(def);
      return def.id;
    },
  };
  if (build) build(painter, s);
  const c = cellCenter(start.col, start.row);
  const def: MapDef = {
    ...project.maps[0]!,
    id: id('map', 'stage') as Id<'map'>,
    name: 'Stage',
    width,
    height,
    layers: painter.layers(),
    playerStart: { x: c.x, y: c.y, facing: 0 },
    placements,
    regions,
    triggers: [],
  };
  project.maps = [def];
  project.startMapId = def.id;
  const issues = checkProject(project);
  if (issues.length > 0) throw new Error(`stage project is invalid: ${issues[0]!.path}: ${issues[0]!.message}`);
  return project;
}

export function stageSim(width: number, height: number, start: { col: number; row: number }, build?: (m: MapPainter, s: Stage) => void, mutate?: (p: Project) => void): Sim {
  const project = stage(width, height, start, build);
  if (mutate) mutate(project);
  return createSim(project, null, OPTS);
}

/** Step with one input frame repeated `n` times. */
export function runWith(sim: Sim, n: number, frame: Partial<InputFrame>): void {
  const full: InputFrame = { ...emptyInput(), ...frame };
  for (let i = 0; i < n; i++) {
    sim.input.set(full);
    sim.step();
  }
}

/** Step once with a frame, then `n - 1` times with empty input (a click, then waiting). */
export function click(sim: Sim, frame: Partial<InputFrame>, n = 1): void {
  runWith(sim, 1, frame);
  if (n > 1) run(sim, n - 1);
}

export const indexOfKey = (sim: Sim, name: string): number => sim.entities.indexOfPlacement(id('placement', name));
export const cellOfEntity = (sim: Sim, index: number): number => sim.world!.cellAt(sim.entities.x[index]!, sim.entities.y[index]!);
