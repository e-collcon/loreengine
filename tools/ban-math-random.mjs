// Spec 5.8: `Math.random` is banned in `runtime` (and in everything the
// runtime is built from), so the simulation's only randomness is its seeded
// stream. `Date.now` and `performance.now` are banned for the same reason:
// wall-clock time must arrive as input.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const banned = [/\bMath\s*\.\s*random\b/, /\bDate\s*\.\s*now\b/, /\bnew\s+Date\s*\(/, /\bperformance\s*\.\s*now\b/];
const packages = ['runtime', 'algorithms', 'hexmath', 'schema'];
const offenders = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.ts')) {
      readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (banned.some((re) => re.test(code))) offenders.push(`${full.slice(root.length)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
};
for (const pkg of packages) walk(join(root, 'packages', pkg, 'src'));
if (offenders.length) {
  console.error('Nondeterministic calls in headless packages:\n' + offenders.join('\n'));
  process.exit(1);
}
console.log(`ok    no Math.random / Date.now / performance.now in ${packages.join(', ')}`);
