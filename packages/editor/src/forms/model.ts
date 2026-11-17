/**
 * Forms generated from the schema (spec 8.6): every database form, every
 * union variant (conditions, actions, behaviors, payloads) and every trigger
 * part comes from walking the Zod source, so a new vocabulary entry gets a
 * form without anyone writing one. A test enumerates every variant and fails
 * if one has no form (8.10).
 */
import { z } from 'zod';

/** Which database an id field points into. */
export type RefKind =
  | 'terrain'
  | 'map'
  | 'archetype'
  | 'animationSet'
  | 'attack'
  | 'brain'
  | 'status'
  | 'feedback'
  | 'particle'
  | 'faction'
  | 'variable'
  | 'inputAction'
  | 'region'
  | 'placement'
  | 'trigger'
  | 'atlas'
  | 'asset'
  | 'project';

export type FieldSpec =
  | { kind: 'object'; name: string | undefined; fields: ObjectField[] }
  | { kind: 'variants'; name: string | undefined; discriminator: string; variants: Variant[] }
  | { kind: 'choice'; name: string | undefined; options: FieldSpec[] }
  | { kind: 'literal'; values: readonly (string | number | boolean | null)[] }
  | { kind: 'string'; minLength: number }
  | { kind: 'id'; ref: RefKind | 'self' }
  | { kind: 'number'; int: boolean; min: number | undefined; max: number | undefined; minExclusive: boolean }
  | { kind: 'boolean' }
  | { kind: 'array'; element: FieldSpec; minLength: number; maxLength: number | undefined }
  | { kind: 'record'; key: FieldSpec; value: FieldSpec }
  | { kind: 'tuple'; items: FieldSpec[] }
  | { kind: 'nullable'; inner: FieldSpec }
  | { kind: 'layer' }
  | { kind: 'unsupported'; type: string; path: string };

export interface ObjectField {
  key: string;
  optional: boolean;
  /** Built on first use: schemas are recursive (conditions inside conditions). */
  readonly spec: FieldSpec;
}

export interface Variant {
  /** The discriminator values this variant takes (a variant may cover several, e.g. apply/remove-effect). */
  values: readonly (string | number | boolean)[];
  spec: FieldSpec & { kind: 'object' };
  schema: z.ZodType;
}

interface AnyDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  keyType?: z.ZodType;
  valueType?: z.ZodType;
  options?: z.ZodType[];
  items?: z.ZodType[];
  discriminator?: string;
  values?: (string | number | boolean | null)[];
  getter?: () => z.ZodType;
  format?: string;
  checks?: { _zod: { def: { check: string; value?: number; minimum?: number; maximum?: number; inclusive?: boolean } } }[];
  in?: z.ZodType;
}

const defOf = (schema: z.ZodType): AnyDef => (schema as unknown as { def: AnyDef }).def;
export const schemaName = (schema: z.ZodType): string | undefined => z.globalRegistry.get(schema)?.id;

/**
 * Id fields by name: the schema's `id()` helper keeps its kind only in the
 * type system, so the editor names the database from the field's key. A test
 * fails if an id field in the schema is not in this table.
 */
export const REF_BY_KEY: Record<string, RefKind> = {
  terrainId: 'terrain',
  terrainPalette: 'terrain',
  startMapId: 'map',
  mapId: 'map',
  archetypeId: 'archetype',
  playerArchetypeId: 'archetype',
  animationSetId: 'animationSet',
  attackId: 'attack',
  attackIds: 'attack',
  brainId: 'brain',
  statusId: 'status',
  statusIds: 'status',
  feedbackId: 'feedback',
  particlePresetId: 'particle',
  particleId: 'particle',
  factionId: 'faction',
  variableId: 'variable',
  regionId: 'region',
  at: 'region',
  key: 'placement',
  atlasId: 'atlas',
  sourceIds: 'asset',
  assetId: 'asset',
  bgm: 'asset',
  sfx: 'asset',
  soundId: 'asset',
  sourceVariableId: 'variable',
  triggerId: 'trigger',
  presetId: 'particle',
  onHurt: 'feedback',
};

/** Id fields whose key alone is ambiguous, by their path in the schema. */
export const REF_BY_PATH: Record<string, RefKind> = {
  'Condition<relation>.a': 'faction',
  'Condition<relation>.b': 'faction',
  'AttackDef.feedback.windup': 'feedback',
  'AttackDef.feedback.hit': 'feedback',
  'ComponentData.feedback.onDeath': 'feedback',
};

export class FormBuilder {
  private readonly memo = new Map<z.ZodType, FieldSpec>();
  /** Id fields whose key is not in REF_BY_KEY: the coverage test reports them. */
  readonly unknownRefs = new Set<string>();

  /** The spec for a schema; `key` is the field it sits under (used to name id references). */
  spec(schema: z.ZodType, key = '', path = ''): FieldSpec {
    const def = defOf(schema);
    switch (def.type) {
      case 'optional':
        return this.spec(def.innerType!, key, path);
      case 'nullable':
        return { kind: 'nullable', inner: this.spec(def.innerType!, key, path) };
      case 'lazy':
        return this.spec(def.getter!(), key, path);
      case 'pipe':
        return { kind: 'layer' };
      case 'string':
        if (def.format === 'uuid') {
          if (key === 'id') return { kind: 'id', ref: 'self' };
          const ref = REF_BY_PATH[path] ?? REF_BY_KEY[key];
          if (!ref) {
            this.unknownRefs.add(`${path || '(root)'} (${key})`);
            return { kind: 'unsupported', type: 'uuid without a known database', path };
          }
          return { kind: 'id', ref };
        }
        return { kind: 'string', minLength: this.bound(def, 'min_length') ?? 0 };
      case 'number': {
        let min: number | undefined;
        let max: number | undefined;
        let minExclusive = false;
        for (const c of def.checks ?? []) {
          const d = c._zod.def;
          if (d.check === 'greater_than') {
            min = d.value;
            minExclusive = d.inclusive === false;
          } else if (d.check === 'less_than') max = d.value;
        }
        return { kind: 'number', int: def.format === 'safeint', min, max, minExclusive };
      }
      case 'boolean':
        return { kind: 'boolean' };
      case 'literal':
        return { kind: 'literal', values: def.values ?? [] };
      case 'enum':
        return { kind: 'literal', values: Object.values((def as unknown as { entries: Record<string, string> }).entries) };
      case 'array':
        return {
          kind: 'array',
          element: this.spec(def.element!, key, `${path}[]`),
          minLength: this.bound(def, 'min_length') ?? 0,
          maxLength: this.bound(def, 'max_length'),
        };
      case 'record':
        return { kind: 'record', key: this.spec(def.keyType!, key, `${path}{key}`), value: this.spec(def.valueType!, key, `${path}{}`) };
      case 'tuple':
        return { kind: 'tuple', items: (def.items ?? []).map((item, i) => this.spec(item, key, `${path}[${i}]`)) };
      case 'object':
        return this.object(schema, path);
      case 'union':
        return def.discriminator ? this.variants(schema, path) : { kind: 'choice', name: schemaName(schema), options: def.options!.map((o, i) => this.spec(o, key, `${path}|${i}`)) };
      default:
        return { kind: 'unsupported', type: def.type, path };
    }
  }

  private bound(def: AnyDef, check: string): number | undefined {
    for (const c of def.checks ?? []) {
      const d = c._zod.def;
      if (d.check === check) return check === 'min_length' ? d.minimum : d.maximum;
    }
    return undefined;
  }

  private object(schema: z.ZodType, path: string): FieldSpec & { kind: 'object' } {
    const memo = this.memo.get(schema);
    if (memo) return memo as FieldSpec & { kind: 'object' };
    const name = schemaName(schema);
    const spec: FieldSpec & { kind: 'object' } = { kind: 'object', name, fields: [] };
    this.memo.set(schema, spec);
    const shape = defOf(schema).shape!;
    for (const key of Object.keys(shape)) {
      const child = shape[key]!;
      const optional = defOf(child).type === 'optional';
      const builder = this;
      let built: FieldSpec | null = null;
      spec.fields.push({
        key,
        optional,
        get spec() {
          return (built ??= builder.spec(shape[key]!, key, `${name ?? path}.${key}`));
        },
      });
    }
    return spec;
  }

  private variants(schema: z.ZodType, path: string): FieldSpec {
    const memo = this.memo.get(schema);
    if (memo) return memo;
    const def = defOf(schema);
    const discriminator = def.discriminator!;
    const name = schemaName(schema);
    const spec: FieldSpec & { kind: 'variants' } = { kind: 'variants', name, discriminator, variants: [] };
    this.memo.set(schema, spec);
    for (const option of def.options!) {
      const tag = defOf(defOf(option).shape![discriminator]!);
      const values = (tag.values ?? []).filter((v): v is string | number | boolean => v !== null);
      spec.variants.push({ values, spec: this.object(option, `${name ?? path}<${values.join('|')}>`), schema: option });
    }
    return spec;
  }
}

/** Every discriminated union reachable from a root schema, each variant once. */
export function allVariants(builder: FormBuilder, root: z.ZodType): { union: string; variant: Variant }[] {
  const out: { union: string; variant: Variant }[] = [];
  const seen = new Set<FieldSpec>();
  const walk = (spec: FieldSpec, where: string): void => {
    if (seen.has(spec)) return;
    seen.add(spec);
    switch (spec.kind) {
      case 'object':
        for (const f of spec.fields) walk(f.spec, `${spec.name ?? where}.${f.key}`);
        return;
      case 'variants':
        for (const v of spec.variants) {
          out.push({ union: spec.name ?? where, variant: v });
          walk(v.spec, `${spec.name ?? where}<${v.values.join('|')}>`);
        }
        return;
      case 'choice':
        for (const o of spec.options) walk(o, where);
        return;
      case 'array':
        walk(spec.element, `${where}[]`);
        return;
      case 'record':
        walk(spec.value, `${where}{}`);
        return;
      case 'tuple':
        spec.items.forEach((item) => walk(item, where));
        return;
      case 'nullable':
        walk(spec.inner, where);
        return;
      default:
        return;
    }
  };
  walk(builder.spec(root), schemaName(root) ?? 'root');
  return out;
}

/** Unsupported nodes anywhere under a spec (the every-variant test wants none). */
export function unsupportedIn(spec: FieldSpec, seen = new Set<FieldSpec>()): string[] {
  if (seen.has(spec)) return [];
  seen.add(spec);
  switch (spec.kind) {
    case 'unsupported':
      return [`${spec.path}: ${spec.type}`];
    case 'object':
      return spec.fields.flatMap((f) => unsupportedIn(f.spec, seen));
    case 'variants':
      return spec.variants.flatMap((v) => unsupportedIn(v.spec, seen));
    case 'choice':
      return spec.options.flatMap((o) => unsupportedIn(o, seen));
    case 'array':
      return unsupportedIn(spec.element, seen);
    case 'record':
      return [...unsupportedIn(spec.key, seen), ...unsupportedIn(spec.value, seen)];
    case 'tuple':
      return spec.items.flatMap((i) => unsupportedIn(i, seen));
    case 'nullable':
      return unsupportedIn(spec.inner, seen);
    default:
      return [];
  }
}

export interface DefaultContext {
  newId(): string;
  /** The first id in a database, for a required reference; '' when it is empty. */
  firstId(ref: RefKind): string;
  /** The first frame name of an atlas, so a new FrameRef points at real art. */
  firstFrame?(atlasId: string): string;
}

/** A value a new item or a freshly chosen variant starts from. */
export function defaultValue(spec: FieldSpec, ctx: DefaultContext, depth = 0): unknown {
  switch (spec.kind) {
    case 'object': {
      if (spec.name === 'FrameRef') {
        const atlasId = ctx.firstId('atlas');
        return { atlasId, frame: ctx.firstFrame?.(atlasId) || 'frame' };
      }
      const out: Record<string, unknown> = {};
      for (const f of spec.fields) {
        if (f.optional) continue;
        out[f.key] = depth > 12 ? null : defaultValue(f.spec, ctx, depth + 1);
      }
      return out;
    }
    case 'variants': {
      const v = spec.variants[0]!;
      return { ...(defaultValue(v.spec, ctx, depth + 1) as object), [spec.discriminator]: v.values[0] };
    }
    case 'choice':
      return defaultValue(spec.options[0]!, ctx, depth + 1);
    case 'literal':
      return spec.values[0];
    case 'string':
      return spec.minLength > 0 ? 'new' : '';
    case 'id':
      return spec.ref === 'self' ? ctx.newId() : ctx.firstId(spec.ref);
    case 'number': {
      if (spec.min === undefined) return 0;
      if (spec.minExclusive) return spec.int ? spec.min + 1 : spec.min + 1;
      return spec.min;
    }
    case 'boolean':
      return false;
    case 'array':
      return Array.from({ length: spec.minLength }, () => defaultValue(spec.element, ctx, depth + 1));
    case 'record':
      return {};
    case 'tuple':
      return spec.items.map((i) => defaultValue(i, ctx, depth + 1));
    case 'nullable':
      return null;
    case 'layer':
      return null;
    case 'unsupported':
      return undefined;
  }
}

/** The variant a union value currently is, by its discriminator. */
export function variantOf(spec: FieldSpec & { kind: 'variants' }, value: unknown): Variant | undefined {
  const tag = (value as Record<string, unknown> | null)?.[spec.discriminator];
  return spec.variants.find((v) => v.values.includes(tag as string));
}

/** A readable label for a field key: `attackIds` -> "Attacks", `maxLevel` -> "Max level". */
export function labelOf(key: string): string {
  const base = key.replace(/Ids$/, 's').replace(/Id$/, '');
  const words = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
