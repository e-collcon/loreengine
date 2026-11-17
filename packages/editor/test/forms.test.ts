import { describe, expect, it } from 'vitest';
import { ProjectSchema, seededIdFactory } from '@loreengine/schema';
import { FormBuilder, allVariants, defaultValue, unsupportedIn } from '../src/forms/model.ts';

const newId = seededIdFactory(11);
const ctx = { newId, firstId: () => newId() };

describe('generated forms (spec 8.6, 8.10)', () => {
  const builder = new FormBuilder();
  const project = builder.spec(ProjectSchema);

  it('every id field in the schema names its database', () => {
    expect(unsupportedIn(project)).toEqual([]);
    expect([...builder.unknownRefs]).toEqual([]);
  });

  it('★ every variant authorable [P5B.forms.every-variant]: each union variant has a form, and its starting value is valid', () => {
    const variants = allVariants(builder, ProjectSchema);
    const unions = new Set(variants.map((v) => v.union));
    // Conditions, actions, behaviors, payloads, entity matches, hitboxes, effects' parts...
    expect(unions.size).toBeGreaterThanOrEqual(6);
    expect(variants.length).toBeGreaterThanOrEqual(40);
    const failures: string[] = [];
    for (const { union, variant } of variants) {
      const issues = unsupportedIn(variant.spec);
      if (issues.length > 0) failures.push(`${union}<${variant.values.join('|')}>: ${issues.join(', ')}`);
      for (const tag of variant.values) {
        const value = { ...(defaultValue(variant.spec, ctx) as object), [discriminatorOf(variant.spec, tag)]: tag };
        const parsed = variant.schema.safeParse(value);
        if (!parsed.success) failures.push(`${union}<${tag}> default does not parse: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

/** The discriminator key of a variant: the field whose literal values include the tag. */
function discriminatorOf(spec: ReturnType<FormBuilder['spec']> & { kind: 'object' }, tag: unknown): string {
  const field = spec.fields.find((f) => f.spec.kind === 'literal' && f.spec.values.includes(tag as never));
  return field?.key ?? 'type';
}
