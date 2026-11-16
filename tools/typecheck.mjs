// Gate 1 (spec 9.6): strict `tsc --noEmit` on every package, sources and tests.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(root, 'node_modules', '.bin', 'tsc');
let failed = false;
const run = (project) => {
  try {
    execFileSync(tsc, ['--noEmit', '-p', project], { stdio: 'pipe', encoding: 'utf8' });
    console.log(`ok    ${project.slice(root.length)}`);
  } catch (err) {
    failed = true;
    console.log(`FAIL  ${project.slice(root.length)}\n${err.stdout ?? ''}${err.stderr ?? ''}`);
  }
};
for (const pkg of readdirSync(join(root, 'packages')).sort()) {
  for (const config of ['tsconfig.json', 'tsconfig.test.json']) {
    const file = join(root, 'packages', pkg, config);
    if (existsSync(file)) run(file);
  }
}
run(join(root, 'tests', 'tsconfig.json'));
process.exit(failed ? 1 : 0);
