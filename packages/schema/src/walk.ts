/**
 * Walks the Zod schema source and lists every authored LEAF field.
 *
 * The reader-coverage test (law L4, spec 4.4) compares this list with the
 * reader manifest, so a field cannot be added without naming what reads it.
 * The editor's generated forms (Phase 5) walk the same structure.
 *
 * Path grammar:
 *   TypeName.field            a field of a named type (see `.meta({ id })`)
 *   .field                    a field of an inline object
 *   []                        array element
 *   {}                        record value
 *   <variant>                 one option of a discriminated union, named by
 *                             its discriminator value(s), e.g. Action<spawn>
 *
 * A reference to another named type is not a leaf: that type is walked once
 * under its own name. An empty object (a marker component such as
 * `playerControlled`) is a leaf, because its presence is the authored datum.
 */
import { z } from 'zod';

export interface LeafField {
  /** Stable path, e.g. `AttackDef.hitbox<arc>.range`. */
  path: string;
  /** The Zod type at the leaf: 'string', 'number', 'boolean', 'literal', 'union', 'tuple', 'pipe', 'object', 'custom'. */
  kind: string;
}

interface AnyDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  valueType?: z.ZodType;
  options?: z.ZodType[];
  discriminator?: string;
  values?: unknown[];
  getter?: () => z.ZodType;
}

const defOf = (schema: z.ZodType): AnyDef => (schema as unknown as { def: AnyDef }).def;
const nameOf = (schema: z.ZodType): string | undefined => z.globalRegistry.get(schema)?.id;

export function listLeafFields(root: z.ZodType): LeafField[] {
  const rootName = nameOf(root);
  if (!rootName) throw new Error('the root schema must be named with .meta({ id })');
  const out: LeafField[] = [];
  const seen = new Set<string>();
  const queue: z.ZodType[] = [root];

  const visit = (schema: z.ZodType, path: string, isRoot: boolean): void => {
    const def = defOf(schema);
    const name = nameOf(schema);
    if (name && !isRoot) {
      if (!seen.has(name)) {
        seen.add(name);
        queue.push(schema);
      }
      return;
    }
    switch (def.type) {
      case 'optional':
      case 'nullable':
        visit(def.innerType!, path, false);
        return;
      case 'lazy':
        visit(def.getter!(), path, false);
        return;
      case 'array':
        visit(def.element!, `${path}[]`, false);
        return;
      case 'record':
        visit(def.valueType!, `${path}{}`, false);
        return;
      case 'object': {
        const keys = Object.keys(def.shape!);
        if (keys.length === 0) {
          out.push({ path, kind: 'object' });
          return;
        }
        for (const key of keys) visit(def.shape![key]!, `${path}.${key}`, false);
        return;
      }
      case 'union': {
        if (def.discriminator) {
          for (const option of def.options!) {
            const tag = defOf(defOf(option).shape![def.discriminator]!).values!.join('|');
            visit(option, `${path}<${tag}>`, false);
          }
          return;
        }
        // A plain union is a leaf only when every option is (a value, or an id).
        for (const option of def.options!) {
          const t = defOf(option).type;
          if (t === 'object' || t === 'array' || t === 'record' || t === 'union') {
            throw new Error(`${path}: a non-discriminated union of structures cannot be walked`);
          }
        }
        out.push({ path, kind: 'union' });
        return;
      }
      default:
        out.push({ path, kind: def.type });
    }
  };

  seen.add(rootName);
  while (queue.length > 0) {
    const schema = queue.shift()!;
    visit(schema, nameOf(schema)!, true);
  }
  return out;
}
