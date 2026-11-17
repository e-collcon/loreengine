// Browser checks against the production builds (spec 9.1, 9.5):
//   1. Playtest leak gate: 50 Play/Stop cycles in the editor return the
//      playtest's renderer textures and audio nodes to baseline, and the heap
//      after GC stays within 5%. The editor bakes its art once and every
//      playtest borrows it (DECISIONS N9).
//   2. The standalone player's client, 50 start/stop cycles on one page:
//      textures, audio nodes, canvases and camera size return to baseline (a
//      gate). Its heap growth is reported, not gated: each start bakes its own
//      art, and PixiJS keeps a little per new texture (N9).
//   1b. The database editors through the UI: a saved edit reaches the project,
//      an invalid one is refused, Cancel restores the draft (spec 8.6).
//   3. Render bench: frame time on a 128 x 128 map, full viewport. It measures
//      and reports; the 8 ms figure is a target to verify.
// Usage: npm run build && npm run check:browser (part of `npm run gates`)
//   --bench-only   skip the leak gates and the database smoke test
//   --gpu          run the render bench in a visible Chromium on this machine's GPU,
//                  not software WebGL (npm run bench:render does both)
// Exits non-zero if a gate fails.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BENCH_ONLY = process.argv.includes('--bench-only');
const GPU = process.argv.includes('--gpu');
const CYCLES = Number(process.env.LEAK_CYCLES ?? 50);
const WARM_CYCLES = 10; // heap baseline is taken after these, once caches and JIT have settled
const HEAP_TOLERANCE = 0.05;

const root = fileURLToPath(new URL('..', import.meta.url));
const dists = { player: join(root, 'packages', 'player', 'dist'), editor: join(root, 'packages', 'editor', 'dist') };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const [, app, ...parts] = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '').split(/[/\\]/);
    const path = parts.join('/') || 'index.html';
    const body = await readFile(join(dists[app], path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const problems = [];
// Software WebGL everywhere, so the checks run the same in a container without a GPU.
const SOFTWARE_GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
async function launch(args, gpu = false) {
  // On the GPU: a visible window (headless Chromium may fall back to software), and no SwiftShader.
  const b = await chromium.launch(gpu ? { headless: false, args } : { args: [...SOFTWARE_GL, ...args] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  p.on('pageerror', (e) => problems.push(String(e)));
  return { b, p };
}
// The leak gates: --stress-flush-code makes V8 drop compiled code at every full GC, so the heap
// gates measure retained objects, not JIT code V8 would reclaim later anyway (D161). It slows
// code down, so the render bench runs in a second browser without it.
let { b: browser, p: page } = await launch(BENCH_ONLY ? [] : ['--js-flags=--stress-flush-code']);

// The page's JS heap after a full GC, to the byte (performance.memory is bucketed and too coarse for a 5% gate).
const cdp = await page.context().newCDPSession(page);
const heapAfterGc = async () => {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  return (await cdp.send('Runtime.getHeapUsage')).usedSize;
};
const failures = [];
const mb = (n) => (n / 1048576).toFixed(2);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

if (!BENCH_ONLY) {
/* ---- 1. the editor's playtest: the spec's leak gate ----------------------- */
{
  await page.goto(`${origin}/editor/`);
  await page.waitForFunction(() => window.__editor?.session.art, null, { timeout: 60_000 });
  const play = page.locator('button', { hasText: '▶ Play' });
  const stop = page.locator('.playtest button', { hasText: 'Stop' });
  const canvases = () => page.evaluate(() => document.querySelectorAll('canvas').length);
  const baselineCanvases = await canvases();
  let heapBaseline = 0;
  let peak = { textures: 0, audioNodes: 0 };
  const started = Date.now();
  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    await play.click();
    await page.waitForFunction(() => window.__playtest && window.__playtest.client.frames > 10 && window.__playtest.client.stats().textures > 0, null, { timeout: 60_000 });
    // A real click on the stage: it unlocks audio, issues a move order, and plays a sound.
    await page.mouse.click(700 + (cycle % 5) * 20, 460);
    await page.waitForTimeout(150);
    const live = await page.evaluate(() => {
      window.__lastClient = window.__playtest.client;
      return window.__lastClient.stats();
    });
    peak = { textures: Math.max(peak.textures, live.textures), audioNodes: Math.max(peak.audioNodes, live.audioNodes) };
    await stop.click();
    await page.waitForFunction(() => !document.querySelector('.playtest'), null, { timeout: 10_000 });
    const after = await page.evaluate(() => {
      const stats = window.__lastClient.stats();
      delete window.__lastClient;
      return stats;
    });
    const n = await canvases();
    if (after.textures !== 0 || after.audioNodes !== 0 || n !== baselineCanvases) {
      failures.push(`editor playtest cycle ${cycle}: after Stop ${JSON.stringify(after)}, ${n} canvases (baseline 0, 0, ${baselineCanvases})`);
    }
    if (cycle === WARM_CYCLES) heapBaseline = await heapAfterGc();
  }
  const heapEnd = await heapAfterGc();
  const growth = (heapEnd - heapBaseline) / heapBaseline;
  if (growth > HEAP_TOLERANCE) failures.push(`editor playtest: heap grew ${pct(growth)} between cycle ${WARM_CYCLES} and cycle ${CYCLES}`);
  if (peak.textures === 0) failures.push('editor playtest: no textures were ever live; the gate measured nothing');
  const unchanged = await page.evaluate(() => window.__editor.session.doc.stack.size === 0 && !window.__editor.session.doc.dirty);
  if (!unchanged) failures.push('editor playtest: the document changed during playtests');
  console.log(`playtest leak gate (editor, Play/Stop): ${CYCLES} cycles in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.log(`  while playing: up to ${peak.textures} renderer textures (the shared atlas pages are the editor's), ${peak.audioNodes} audio nodes`);
  console.log(`  after every Stop: textures 0, audio nodes 0, canvases ${baselineCanvases} (the editor's own)`);
  console.log(`  heap after GC: ${mb(heapBaseline)} MB at cycle ${WARM_CYCLES}, ${mb(heapEnd)} MB at cycle ${CYCLES} (${pct(growth)}, limit +5%)`);
}

/* ---- 1b. the database editors through the UI (spec 8.6) ------------------ */
{
  const footer = page.locator('.db-footer');
  await page.locator('[data-testid=databases] li', { hasText: 'Attacks' }).first().click();
  await page.locator('.db-form .field', { hasText: 'Windup ms' }).locator('input').first().fill('901');
  await footer.locator('button', { hasText: 'Save' }).click();
  const saved = await page.evaluate(() => window.__editor.session.project.attacks[0].windupMs);
  if (saved !== 901) failures.push(`database editor: a saved attack edit did not reach the project (windupMs ${saved})`);
  await page.locator('[data-testid=databases] li', { hasText: 'Terrains' }).first().click();
  const cost = page.locator('[data-testid=terrain-matrix] tbody tr').nth(1).locator('input[type=number]');
  const before = await cost.inputValue();
  await cost.fill('0');
  await footer.locator('button', { hasText: 'Save' }).click();
  const refused = (await footer.innerText()).includes('Not saved');
  const kept = await page.evaluate(() => window.__editor.session.project.terrains[1].moveCost);
  if (!refused || String(kept) !== before) failures.push(`database editor: an invalid terrain cost was not refused (cost now ${kept})`);
  await footer.locator('button', { hasText: 'Cancel' }).click();
  if ((await cost.inputValue()) !== before) failures.push('database editor: Cancel did not restore the draft');
  await page.locator('button', { hasText: '← Map' }).click();
  console.log(`database editors: an attack edit saved, an invalid terrain refused and cancelled${failures.some((f) => f.startsWith('database')) ? ' (FAILED)' : ''}`);
}

await page.goto(`${origin}/player/bench.html`);
await page.waitForFunction(() => window.__bench !== undefined, null, { timeout: 30_000 });

/* ---- 2. the standalone player's client ------------------------------------ */
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
if (peakTextures === 0) failures.push('player: no textures were ever live: the check measured nothing');
const contextLoss = problems.filter((p) => /WebGL context/i.test(p));
if (contextLoss.length > 0) failures.push(`WebGL contexts were not released: ${contextLoss[0]}`);

console.log(`standalone player client: ${CYCLES} start/stop cycles in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`  while playing: up to ${peakTextures} textures, ${peakAudioNodes} audio nodes`);
console.log(`  after every stop: textures ${baseline.textures}, audio nodes ${baseline.audioNodes}, canvases ${baseline.canvases} (baseline)`);
console.log(`  heap after GC: ${mb(heapBaseline)} MB at cycle ${WARM_CYCLES}, ${mb(heapEnd)} MB at cycle ${CYCLES} (${pct(heapGrowth)}; reported, not gated: each start bakes its own art, N9)`);

}

/* ---- 3. render bench ------------------------------------------------------ */
await browser.close();
({ b: browser, p: page } = await launch([], GPU));
await page.goto(`${origin}/player/bench.html`);
await page.waitForFunction(() => window.__bench !== undefined, null, { timeout: 30_000 });
const glRenderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
  if (!gl) return 'no WebGL';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
});
const software = /swiftshader|llvmpipe|software/i.test(glRenderer);
console.log(`render bench: 128 x 128 map, 1280 x 800 viewport, ${GPU ? 'visible' : 'headless'} Chromium`);
console.log(`  WebGL renderer: ${glRenderer}${software ? '  (software: these numbers are not a GPU measurement)' : ''}`);
const line = (label, r) =>
  console.log(`  ${label}: mean ${r.meanMs.toFixed(2)} ms, p50 ${r.p50Ms.toFixed(1)} ms, p99 ${r.p99Ms.toFixed(1)} ms, max ${r.maxMs.toFixed(1)} ms over ${r.frames} frames (${r.rows} rows on screen, ${r.strips} strips built)`);
for (const zoom of [1, 0.5]) {
  await page.evaluate(([z]) => window.__bench.renderStart(128, z), [zoom]);
  if (process.env.BENCH_SHOT) await page.screenshot({ path: `${process.env.BENCH_SHOT}-zoom-${zoom}.png` });
  // CPU side only: building and submitting the frame. The GPU's share cannot be measured here.
  line(`zoom ${zoom}, frame build and submit`, await page.evaluate(() => window.__bench.renderRun(600, false)));
  // With gl.finish: adds rasterizing the frame (on the GPU, or on the CPU under SwiftShader).
  line(`zoom ${zoom}, including rasterization`, await page.evaluate(() => window.__bench.renderRun(300, true)));
  await page.evaluate(() => window.__bench.stop());
}

await browser.close();
server.close();
const other = problems.filter((p) => !/WebGL context/i.test(p));
if (other.length > 0) console.log(`console problems (${other.length}):\n  ${[...new Set(other)].slice(0, 8).join('\n  ')}`);
if (failures.length > 0) {
  console.error(`BROWSER CHECKS FAILED:\n  ${failures.slice(0, 10).join('\n  ')}`);
  process.exit(1);
}
console.log('browser checks passed');
