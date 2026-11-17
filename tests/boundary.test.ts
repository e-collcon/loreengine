/**
 * ★ Package boundary (spec 4.3, 4.7; law L1). The runtime compiles with no
 * DOM library, and every package's import graph stays inside its row of the
 * table in spec 4.3.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');

/** Spec 4.3: what each package may import. Bare specifiers only; relative imports stay inside the package. */
const ALLOWED: Record<string, readonly string[]> = {
  schema: ['zod'],
  hexmath: [],
  algorithms: ['@loreengine/hexmath'],
  runtime: ['@loreengine/schema', '@loreengine/hexmath', '@loreengine/algorithms'],
  storage: ['@loreengine/schema', 'fflate'],
  render: ['@loreengine/schema', '@loreengine/runtime/view', 'pixi.js'],
  audio: ['@loreengine/schema', '@loreengine/runtime/view'],
  fixtures: ['@loreengine/schema'],
  player: [
    '@loreengine/schema', '@loreengine/hexmath', '@loreengine/algorithms', '@loreengine/runtime', '@loreengine/runtime/view',
    '@loreengine/storage', '@loreengine/render', '@loreengine/audio', '@loreengine/fixtures',
  ],
  editor: [
    '@loreengine/schema', '@loreengine/hexmath', '@loreengine/algorithms', '@loreengine/runtime', '@loreengine/runtime/view',
    '@loreengine/storage', '@loreengine/render', '@loreengine/audio', '@loreengine/fixtures', '@loreengine/player',
    'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime',
    'zod', // generated forms read the schema source (spec 8.6, D179)
    'fflate', // the asset panel imports zip files (spec 8.6)
  ],
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Every module specifier a file imports or re-exports, including dynamic imports. */
function specifiers(text: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'"]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) out.push(m[1]!);
  return out;
}

describe('[P1.boundary.imports] package import graph', () => {
  for (const [pkg, allowed] of Object.entries(ALLOWED)) {
    it(`${pkg} imports only ${allowed.length ? allowed.join(', ') : 'nothing'}`, () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(join(ROOT, 'packages', pkg, 'src'))) {
        for (const spec of specifiers(readFileSync(file, 'utf8'))) {
          if (spec.startsWith('./') || spec.startsWith('../')) {
            // A relative import must not climb out of the package.
            const resolved = join(file, '..', spec);
            if (!resolved.startsWith(join(ROOT, 'packages', pkg) + '/')) offenders.push(`${file}: ${spec}`);
            continue;
          }
          if (!allowed.includes(spec)) offenders.push(`${file.slice(ROOT.length)}: ${spec}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it('the specifier scanner sees static, type-only, re-export and dynamic imports', () => {
    const text = `
      import { a } from 'pkg-a';
      import type { B } from "pkg-b";
      import 'pkg-c';
      export * from 'pkg-d';
      export type { E } from 'pkg-e';
      const f = await import('pkg-f');
      import g, {
        h,
      } from 'pkg-g';
    `;
    expect(specifiers(text).sort()).toEqual(['pkg-a', 'pkg-b', 'pkg-c', 'pkg-d', 'pkg-e', 'pkg-f', 'pkg-g']);
  });
});

describe('[P1.boundary.no-dom] headless packages compile without the DOM', () => {
  const headless = ['schema', 'hexmath', 'algorithms', 'runtime', 'fixtures'];

  it('their tsconfigs name no DOM lib and no ambient types', () => {
    for (const pkg of headless) {
      const config = JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'tsconfig.json'), 'utf8'));
      expect(config.compilerOptions.lib, pkg).toEqual(['ES2022']);
      expect(config.compilerOptions.types, pkg).toEqual([]);
    }
  });

  it('★ a runtime source file that touches window, document or console fails tsc', () => {
    const dir = mkdtempSync(join(ROOT, 'packages', 'runtime', 'src', '__probe-'));
    try {
      writeFileSync(
        join(dir, 'probe.ts'),
        `export const a = window.innerWidth;\nexport const b = document.title;\nexport const c = () => console.log('x');\nexport const d = (): HTMLElement | null => null;\n`,
      );
      let output = '';
      let failed = false;
      try {
        execFileSync(TSC, ['--noEmit', '-p', join(ROOT, 'packages', 'runtime')], { encoding: 'utf8', stdio: 'pipe' });
      } catch (err) {
        failed = true;
        output = String((err as { stdout?: string }).stdout ?? '');
      }
      expect(failed).toBe(true);
      expect(output).toMatch(/Cannot find name 'window'/);
      expect(output).toMatch(/Cannot find name 'document'/);
      expect(output).toMatch(/Cannot find name 'console'/);
      expect(output).toMatch(/Cannot find name 'HTMLElement'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the runtime compiles clean without the probe', () => {
    execFileSync(TSC, ['--noEmit', '-p', join(ROOT, 'packages', 'runtime')], { encoding: 'utf8', stdio: 'pipe' });
  });
});
