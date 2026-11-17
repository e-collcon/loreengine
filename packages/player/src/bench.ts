/**
 * The browser checks' page (spec 9.1 render budget, 9.5 playtest leak gate).
 * `tools/browser-checks.mjs` drives it through `window.__bench`; nothing here
 * runs on its own.
 */
import { MapPainter, buildEmberfall, cellCenter, emberfallBlobs } from '@loreengine/fixtures';
import type { Project } from '@loreengine/schema';
import { startClient } from './client.ts';
import type { Client } from './client.ts';

export interface RenderBenchResult {
  cells: number;
  frames: number;
  strips: number;
  sprites: number;
  /** Map rows on screen in the last frame. */
  rows: number;
  meanMs: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
}

declare global {
  interface Window {
    __bench?: {
      start(): Promise<{ textures: number; audioNodes: number }>;
      stats(): { textures: number; audioNodes: number; canvases: number };
      stop(): { textures: number; audioNodes: number; canvases: number };
      /** Start a paused client on a `size` x `size` map and wait for its art. */
      renderStart(size: number, zoom: number): Promise<void>;
      /** Time `frames` frames. With `finish`, each frame also waits for the GPU (`gl.finish`). */
      renderRun(frames: number, finish: boolean): RenderBenchResult;
      /** The live client's camera and visible rows. */
      camera(): { x: number; y: number; z: number; zoom: number; width: number; height: number; first: number; last: number; mapH: number };
    };
  }
}

const host = document.getElementById('app')!;
const blobs = emberfallBlobs();
const resolveAsset = async (ref: { blobId: string }): Promise<Uint8Array | null> => blobs.get(ref.blobId)?.bytes ?? null;
let client: Client | null = null;

/** Emberfall's content on one `size` x `size` map: plateaus, ramps and ponds repeated across it. */
function benchProject(size: number): Project {
  const project = buildEmberfall();
  const source = project.maps[0]!;
  // Palette indices in use on Emberfall, cycled so every terrain's art is drawn.
  const kinds = source.terrainPalette.length;
  const paint = new MapPainter(size, size);
  paint.fill({ col: 0, row: 0, w: size, h: size }, 0, 0);
  for (let row = 4; row + 8 < size; row += 14) {
    for (let col = 4; col + 10 < size; col += 16) {
      const n = (row / 14 + col / 16) | 0;
      paint.fill({ col, row, w: 9, h: 6 }, n % kinds, 1 + (n % 3));
      paint.fill({ col: col + 10, row: row + 2, w: 4, h: 3 }, (n + 1) % kinds, 0);
    }
  }
  const start = cellCenter(size >> 1, size >> 1);
  project.maps = [
    { ...source, width: size, height: size, layers: paint.layers(), playerStart: { x: start.x, y: start.y, facing: 0 }, placements: [], regions: [], triggers: [], bgm: undefined },
  ];
  project.triggers = [];
  return project;
}

const counts = (): { textures: number; audioNodes: number; canvases: number } => ({
  ...(client ? client.stats() : { textures: 0, audioNodes: 0 }),
  canvases: host.querySelectorAll('canvas').length,
});

window.__bench = {
  async start() {
    client = await startClient({ host, project: buildEmberfall(), resolveAsset });
    return client.stats();
  },
  stats: counts,
  stop() {
    const stopped = client;
    client = null;
    stopped?.stop();
    return { ...(stopped ? stopped.stats() : { textures: 0, audioNodes: 0 }), canvases: host.querySelectorAll('canvas').length };
  },
  async renderStart(size, zoom) {
    client = await startClient({ host, project: benchProject(size), resolveAsset, zoom });
    // Wait for the bake, so the frames measured draw the atlas art.
    for (let i = 0; i < 600 && client.stats().textures === 0; i++) await new Promise((r) => setTimeout(r, 50));
    client.paused = true;
    client.follow = false;
    for (let i = 0; i < 20; i++) client.renderNow();
  },
  camera() {
    const c = client!.renderer.camera;
    const l = client!.renderer.drawList;
    return { x: c.x, y: c.y, z: c.z, zoom: c.zoom, width: c.width, height: c.height, first: l.firstRow, last: l.lastRow, mapH: client!.runtime.view.world.height };
  },
  renderRun(frames, finish) {
    const bench = client!;
    const canvas = host.querySelector('canvas')!;
    const gl = finish ? (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) : null;
    const times = new Float64Array(frames);
    const begin = performance.now();
    for (let i = 0; i < frames; i++) {
      // Pan a little each frame, as following a walking player does.
      bench.renderer.camera.x += 0.05;
      const t0 = performance.now();
      bench.renderNow();
      gl?.finish();
      times[i] = performance.now() - t0;
    }
    const total = performance.now() - begin;
    const stats = bench.renderer.stats();
    const sorted = Array.from(times).sort((a, b) => a - b);
    return {
      cells: bench.runtime.view.world.width * bench.runtime.view.world.height,
      frames,
      strips: stats.strips,
      sprites: stats.sprites,
      rows: bench.renderer.drawList.lastRow - bench.renderer.drawList.firstRow + 1,
      // The page's clock is coarse (0.1 ms), so the mean comes from the whole run.
      meanMs: total / frames,
      p50Ms: sorted[frames >> 1]!,
      p99Ms: sorted[Math.min(frames - 1, Math.floor(frames * 0.99))]!,
      maxMs: sorted[frames - 1]!,
    };
  },
};
