/**
 * The project's databases (spec 8.6) and the context their forms read:
 * which items a reference can choose from, frame names per atlas.
 */
import { z } from 'zod';
import { ProjectSchema } from '@loreengine/schema';
import type { MapDef, Project } from '@loreengine/schema';
import type { DefaultContext, RefKind } from './model.ts';

export const DATABASES = [
  { key: 'terrains', label: 'Terrains', ref: 'terrain' },
  { key: 'archetypes', label: 'Archetypes', ref: 'archetype' },
  { key: 'attacks', label: 'Attacks', ref: 'attack' },
  { key: 'brains', label: 'Brains', ref: 'brain' },
  { key: 'statusEffects', label: 'Effects', ref: 'status' },
  { key: 'feedback', label: 'Feedback', ref: 'feedback' },
  { key: 'particlePresets', label: 'Particles', ref: 'particle' },
  { key: 'animationSets', label: 'Animation sets', ref: 'animationSet' },
  { key: 'factions', label: 'Factions', ref: 'faction' },
  { key: 'variables', label: 'Variables', ref: 'variable' },
  { key: 'inputActions', label: 'Input actions', ref: 'inputAction' },
] as const;

export type DatabaseKey = (typeof DATABASES)[number]['key'];

type Shape = Record<string, z.ZodType>;
const shapeOf = (schema: z.ZodType): Shape => (schema as unknown as { def: { shape: Shape } }).def.shape;

/** The schema of one item of a database. */
export function itemSchema(key: DatabaseKey): z.ZodType {
  return (shapeOf(ProjectSchema)[key] as unknown as { def: { element: z.ZodType } }).def.element;
}

export function settingsSchema(): z.ZodType {
  return shapeOf(ProjectSchema)['settings']!;
}

export function triggerSchema(): z.ZodType {
  return (shapeOf(ProjectSchema)['triggers'] as unknown as { def: { element: z.ZodType } }).def.element;
}

/** What a list shows for an item. */
export function itemName(item: unknown): string {
  const o = item as Record<string, unknown>;
  if (typeof o['name'] === 'string' && o['name'] !== '') return o['name'];
  if (typeof o['key'] === 'string') return o['key'];
  if (o['when'] && typeof o['when'] === 'object') return `When ${(o['when'] as Record<string, unknown>)['type'] ?? '?'}`;
  return String(o['id'] ?? '?').slice(0, 8);
}

export function databaseItems(project: Project, key: DatabaseKey): unknown[] {
  return project[key] as unknown[];
}

/** Choices for each kind of reference, from the project and the open map. */
export function referenceOptions(project: Project, map: MapDef | undefined): (ref: RefKind) => { id: string; name: string }[] {
  const named = (items: readonly { id: string; name?: string; key?: string }[]): { id: string; name: string }[] =>
    items.map((i) => ({ id: i.id, name: i.name ?? i.key ?? i.id.slice(0, 8) }));
  const assets = [...project.assets.vectorSources, ...project.assets.images, ...project.assets.audio];
  return (ref) => {
    switch (ref) {
      case 'terrain':
        return named(project.terrains);
      case 'map':
        return named(project.maps);
      case 'archetype':
        return named(project.archetypes);
      case 'animationSet':
        return named(project.animationSets);
      case 'attack':
        return named(project.attacks);
      case 'brain':
        return named(project.brains);
      case 'status':
        return named(project.statusEffects);
      case 'feedback':
        return named(project.feedback);
      case 'particle':
        return named(project.particlePresets);
      case 'faction':
        return named(project.factions);
      case 'variable':
        return project.variables.map((v) => ({ id: v.id, name: v.key }));
      case 'inputAction':
        return named(project.inputActions);
      case 'region':
        return project.maps.flatMap((m) => m.regions.map((r) => ({ id: r.id, name: m === map ? r.name : `${m.name}: ${r.name}` })));
      case 'placement':
        return project.maps.flatMap((m) =>
          m.placements.map((p) => {
            const a = project.archetypes.find((x) => x.id === p.archetypeId)?.name ?? '?';
            return { id: p.key, name: `${m === map ? '' : `${m.name}: `}${a} (${p.x.toFixed(1)}, ${p.y.toFixed(1)})` };
          }),
        );
      case 'trigger':
        return [...project.triggers, ...project.maps.flatMap((m) => m.triggers)].map((t) => ({ id: t.id, name: itemName(t) }));
      case 'atlas':
        return project.assets.atlases.map((a) => ({
          id: a.id,
          name: a.sourceIds.length > 0 ? `${assets.find((s) => s.id === a.sourceIds[0])?.name ?? 'atlas'}${a.sourceIds.length > 1 ? ` +${a.sourceIds.length - 1}` : ''}` : a.id.slice(0, 8),
        }));
      case 'asset':
        return assets.map((a) => ({ id: a.id, name: a.name }));
      case 'project':
        return [{ id: project.id, name: project.name }];
    }
  };
}

/** The name of an item anywhere in the project, by id. */
export function nameOfId(project: Project, map: MapDef | undefined): (id: string) => string | undefined {
  const options = referenceOptions(project, map);
  const kinds = ['terrain', 'map', 'archetype', 'animationSet', 'attack', 'brain', 'status', 'feedback', 'particle', 'faction', 'variable', 'inputAction', 'region', 'trigger', 'asset'] as const;
  let index: Map<string, string> | null = null;
  return (id) => {
    index ??= new Map(kinds.flatMap((k) => options(k).map((o) => [o.id, o.name] as const)));
    return index.get(id);
  };
}

export function atlasFrames(project: Project): (atlasId: string) => string[] {
  return (atlasId) => {
    const atlas = project.assets.atlases.find((a) => a.id === atlasId);
    return atlas ? Object.keys(atlas.tiers[0]?.frames ?? {}).sort() : [];
  };
}

export function defaultContext(project: Project, map: MapDef | undefined, newId: () => string): DefaultContext {
  const options = referenceOptions(project, map);
  const frames = atlasFrames(project);
  return { newId, firstId: (ref) => options(ref)[0]?.id ?? '', firstFrame: (atlasId) => frames(atlasId)[0] ?? '' };
}
