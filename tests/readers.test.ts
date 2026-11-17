/**
 * ★ Reader coverage (spec 4.7). Every authored leaf field has a reader
 * manifest entry with a test id; adding a field without one fails here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProjectSchema, READERS, listLeafFields } from '@loreengine/schema';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Chunks that have landed. A manifest entry whose test id starts with one of
 * these prefixes must name a test that exists. Add a prefix when its chunk
 * is tagged green; never remove one.
 */
const BUILT_PREFIXES: readonly string[] = ['P1.', 'P2.', 'P3A.', 'P3B.', 'P4A.', 'P4B.', 'P3C.'];

function testFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) testFiles(full, out);
    else if (name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Every `[P1.some.id]` that appears in a test title anywhere in the repo. */
function existingTestIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of [...testFiles(join(ROOT, 'packages')), ...testFiles(join(ROOT, 'tests'))]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\[(P\d[A-Z]?\.[a-z0-9.-]+)\]/g)) ids.add(m[1]!);
  }
  return ids;
}

describe('[P1.readers.coverage] reader manifest', () => {
  const leaves = listLeafFields(ProjectSchema).map((f) => f.path);

  it('walks a schema of the expected size', () => {
    expect(new Set(leaves).size).toBe(leaves.length);
    expect(leaves.length).toBeGreaterThan(300);
  });

  it('★ every authored leaf field has a reader and a test id', () => {
    const missing = leaves.filter((path) => !READERS[path]);
    expect(missing, 'fields with no reader manifest entry').toEqual([]);
    for (const path of leaves) {
      const entry = READERS[path]!;
      expect(entry.reader, path).toMatch(/^[a-z]+\/[a-z-]+$/);
      expect(entry.test, path).toMatch(/^P\d[A-Z]?\.[a-z0-9.-]+$/);
    }
  });

  it('has no entry for a field that no longer exists', () => {
    const known = new Set(leaves);
    expect(Object.keys(READERS).filter((path) => !known.has(path))).toEqual([]);
  });

  it('every test id of a built chunk names a test that exists', () => {
    const exists = existingTestIds();
    const dangling = Object.entries(READERS)
      .filter(([, e]) => BUILT_PREFIXES.some((p) => e.test.startsWith(p)) && !exists.has(e.test))
      .map(([path, e]) => `${path} -> ${e.test}`);
    expect(dangling).toEqual([]);
  });

  it('a field added to the schema without a manifest entry is caught', () => {
    const Probe = z.strictObject({ name: z.string(), swimmable: z.boolean() }).meta({ id: 'ReaderProbe' });
    const paths = listLeafFields(Probe).map((f) => f.path);
    expect(paths).toEqual(['ReaderProbe.name', 'ReaderProbe.swimmable']);
    expect(paths.filter((path) => !READERS[path])).toEqual(paths);
  });

  it('walks unions, records, arrays and marker components', () => {
    expect(leaves).toContain('Action<apply-effect|remove-effect>.statusId');
    expect(leaves).toContain('AttackDef.hitbox<line>.width');
    expect(leaves).toContain('AtlasDef.tiers[].frames{}.anchorX');
    expect(leaves).toContain('ClipDef.frames[][]');
    expect(leaves).toContain('ComponentData.playerControlled');
    expect(leaves).toContain('Condition<all|any>.type');
  });
});
