// Browser checks against the production build of the player (spec 9.1, 9.5):
//   1. Playtest leak gate: 50 start/stop cycles of the client return renderer
//      textures and audio nodes to baseline, and the heap stays within 5%.
//   2. Render bench: frame time on a 128 x 128 map, full viewport. This one
//      measures and reports; the 8 ms figure is a target to verify.
// Usage: npm run build -w @loreengine/player && npm run check:browser (part of `npm run gates`)
// Exits non-zero if the leak gate fails.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const CYCLES = Number(process.env.LEAK_CYCLES ?? 50);
const WARM_CYCLES = 10; // heap baseline is taken after these, once caches and JIT have settled
const HEAP_TOLERANCE = 0.05;

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'packages', 'player', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const body = await readFile(join(dist, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/bench.html`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(String(e)));
await page.goto(base);
await page.waitForFunction(() => window.__bench !== undefined, null, { timeout: 30_000 });

// The page's JS heap after a full GC, to the byte (performance.memory is bucketed and too coarse for a 5% gate).
const cdp = await page.context().newCDPSession(page);
const heapAfterGc = async () => {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  return (await cdp.send('Runtime.getHeapUsage')).usedSize;
};

/* ---- 1. playtest leak gate ------------------------------------------------ */
const failures = [];
const baseline = await page.evaluate(() => window.__bench.stats());
let heapBaseline = 0;
let peakTextures = 0;
let peakAudioNodes = 0;
const started = Date.now();
for (let cycle = 1; cycle <= CYCLES; cycle++) {
  await page.evaluate(() => window.__bench.start());
  // A real click: it unlocks audio, issues a move order, and plays a sound.
  await page.mouse.click(700 + (cycle % 5) * 20, 420);
  // Play until the art is baked into textures and a few dozen frames have been drawn.
  await page.waitForFunction(() => window.__bench.stats().textures > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(150);
  const live = await page.evaluate(() => window.__bench.stats());
  // Every client on the same host must see the whole viewport, not only the first.
  const cam = await page.evaluate(() => window.__bench.camera());
  if (cam.width !== 1280 || cam.height !== 800) failures.push(`cycle ${cycle}: camera ${cam.width} x ${cam.height}, viewport 1280 x 800`);
  peakTextures = Math.max(peakTextures, live.textures);
  peakAudioNodes = Math.max(peakAudioNodes, live.audioNodes);
  const after = await page.evaluate(() => window.__bench.stop());
  if (after.textures !== baseline.textures || after.audioNodes !== baseline.audioNodes || after.canvases !== baseline.canvases) {
    failures.push(`cycle ${cycle}: after stop ${JSON.stringify(after)}, baseline ${JSON.stringify(baseline)}`);
  }
  if (cycle === WARM_CYCLES) heapBaseline = await heapAfterGc();
}
const heapEnd = await heapAfterGc();
const heapGrowth = (heapEnd - heapBaseline) / heapBaseline;
if (heapGrowth > HEAP_TOLERANCE) failures.push(`heap grew ${(heapGrowth * 100).toFixed(1)}% between cycle ${WARM_CYCLES} and cycle ${CYCLES}`);
if (peakTextures === 0) failures.push('no textures were ever live: the gate measured nothing');
const contextLoss = problems.filter((p) => /WebGL context/i.test(p));
if (contextLoss.length > 0) failures.push(`WebGL contexts were not released: ${contextLoss[0]}`);

const mb = (n) => (n / 1048576).toFixed(2);
console.log(`playtest leak gate: ${CYCLES} start/stop cycles in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`  while playing: up to ${peakTextures} textures, ${peakAudioNodes} audio nodes`);
console.log(`  after every stop: textures ${baseline.textures}, audio nodes ${baseline.audioNodes}, canvases ${baseline.canvases} (baseline)`);
console.log(`  heap after GC: ${mb(heapBaseline)} MB at cycle ${WARM_CYCLES}, ${mb(heapEnd)} MB at cycle ${CYCLES} (${(heapGrowth * 100).toFixed(1)}%, limit +5%)`);

/* ---- 2. render bench ------------------------------------------------------ */
console.log('render bench: 128 x 128 map, 1280 x 800 viewport, software WebGL (SwiftShader) in headless Chromium');
const line = (label, r) =>
  console.log(`  ${label}: mean ${r.meanMs.toFixed(2)} ms, p50 ${r.p50Ms.toFixed(1)} ms, p99 ${r.p99Ms.toFixed(1)} ms, max ${r.maxMs.toFixed(1)} ms over ${r.frames} frames (${r.rows} rows on screen, ${r.strips} strips built)`);
for (const zoom of [1, 0.5]) {
  await page.evaluate(([z]) => window.__bench.renderStart(128, z), [zoom]);
  if (process.env.BENCH_SHOT) await page.screenshot({ path: `${process.env.BENCH_SHOT}-zoom-${zoom}.png` });
  // CPU side only: building and submitting the frame. The GPU's share cannot be measured here.
  line(`zoom ${zoom}, frame build and submit`, await page.evaluate(() => window.__bench.renderRun(600, false)));
  // With gl.finish: adds SwiftShader rasterizing the frame on the CPU, far slower than any GPU.
  line(`zoom ${zoom}, including software rasterization`, await page.evaluate(() => window.__bench.renderRun(300, true)));
  await page.evaluate(() => window.__bench.stop());
}

await browser.close();
server.close();
const other = problems.filter((p) => !/WebGL context/i.test(p));
if (other.length > 0) console.log(`console problems (${other.length}):\n  ${[...new Set(other)].slice(0, 8).join('\n  ')}`);
if (failures.length > 0) {
  console.error(`LEAK GATE FAILED:\n  ${failures.slice(0, 10).join('\n  ')}`);
  process.exit(1);
}
console.log('leak gate passed');
