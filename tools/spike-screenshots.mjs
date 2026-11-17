// Captures the render spike's review scenes into docs/spike/ (kickoff §3.4).
// Usage: npm run build -w @loreengine/player && node tools/spike-screenshots.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'packages', 'player', 'dist');
const out = join(root, 'docs', 'spike');
mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(dist, path === '/' || path === '\\' ? 'index.html' : path);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const scenes = [
  ['01-unit-behind-cliff', 'fixture=elevation&focus=8,2&zoom=1.7'],
  ['02-unit-on-plateau-edge', 'fixture=elevation&focus=8,6&zoom=1.7'],
  ['03-unit-on-ramp', 'fixture=elevation&focus=5,4&zoom=1.7'],
  ['04-pick-on-raised-hex', 'fixture=elevation&focus=8,4&zoom=1.4&pick=9,4'],
  ['05-terraces-overview', 'fixture=elevation&focus=8,5&zoom=0.95'],
  ['06-emberfall-plateau', 'focus=22,9&zoom=0.8'],
  ['07-emberfall-overview', 'focus=24,15&zoom=0.5'],
  // Chunk 7: the boss winds up its slam; the telegraph is the hitbox on the ground.
  ['08-boss-telegraph', 'start=38,22&zoom=1', 700],
];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(String(e)));

for (const [name, query, waitMs] of scenes) {
  await page.goto(`${base}?${query}`);
  // `ready` is set once the art has been baked into atlases.
  await page.waitForFunction(() => window.__lore?.ready === true, null, { timeout: 60_000 });
  // Let a few frames render so the camera and sprites have settled.
  await page.waitForFunction(() => window.__lore.client.frames > 6, null, { timeout: 30_000 });
  if (waitMs) await page.waitForTimeout(waitMs);
  const info = await page.evaluate(() => {
    const c = window.__lore.client;
    const v = c.runtime.view;
    return { tick: v.tick, entities: v.entities.count, pick: c.lastPick && { cell: c.lastPick.cell, level: v.world.level(c.lastPick.cell), z: c.lastPick.z } };
  });
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`${name}.png`, JSON.stringify(info));
}
await browser.close();
server.close();
if (problems.length) {
  console.error('Page errors:\n' + problems.join('\n'));
  process.exit(1);
}
