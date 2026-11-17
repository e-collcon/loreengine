/**
 * Playtest in an overlay (spec 8.8): the player client on a clone of the
 * project, debug overlays drawn from its read-only view, pause and step
 * through the runtime's stepped mode, and repro capture.
 */
import { startClient } from '@loreengine/player';
import { PixiRenderer } from '@loreengine/render';
import type { Client } from '@loreengine/player';
import { serializeRepro } from '@loreengine/runtime';
import type { ReproFile, ReproStart } from '@loreengine/runtime';
import type { Action, Project } from '@loreengine/schema';
import { World } from '@loreengine/runtime/view';
import { blockedEdges } from '../core/overlays.ts';
import { captureRepro, planPlaytest } from '../core/playtest.ts';
import { MapPreview } from '../core/preview.ts';
import type { PlaytestPlan } from '../core/playtest.ts';
import { drawDebug } from './draw.ts';
import type { DebugToggles } from './draw.ts';
import type { EditorSession } from './session.ts';

/** A database preview: a draft put into the playtest's copy, and actions played on the player every two seconds. */
export interface PlaytestPreview {
  label: string;
  prepare?: (copy: Project) => void;
  actions: Action[];
}

export class PlaytestController {
  private nextPreviewTick = 30;
  preview: PlaytestPreview | null = null;
  toggles: DebugToggles = { coords: false, blocked: false, hitboxes: true, sight: true, brains: true, paths: true };
  private world: World | null = null;
  private blocked: Float64Array = new Float64Array(0);
  private mapId = '';
  private stopped = false;
  /** Called after each frame with the readout values. */
  onStats: ((stats: { tick: number; tickMs: number; entities: number; queued: number; paused: boolean; outcome: string | null }) => void) | null = null;

  private constructor(
    readonly session: EditorSession,
    readonly plan: PlaytestPlan,
    readonly client: Client,
    private readonly debug: HTMLCanvasElement,
    private readonly host: HTMLElement,
  ) {}

  static async start(session: EditorSession, host: HTMLElement, start: ReproStart | null, preview: PlaytestPreview | null = null): Promise<PlaytestController> {
    const seed = (Math.random() * 0x7fffffff) | 0; // a fresh session each Play; the repro keeps the seed
    const plan = planPlaytest(session.project, seed, start, preview?.prepare);
    const debug = document.createElement('canvas');
    debug.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2';
    let controller: PlaytestController | null = null;
    if (!session.playtestRenderer) {
      // Made once, from a preview of the project; each Play attaches its own runtime's view.
      const canvas = document.createElement('canvas');
      session.playtestRenderer = await PixiRenderer.create(new MapPreview(plan.project, plan.project.startMapId), {
        canvas,
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
        resolution: Math.min(2, window.devicePixelRatio || 1),
      });
    }
    const client = await startClient({
      renderer: session.playtestRenderer,
      host,
      project: plan.project,
      save: plan.save,
      seed: plan.seed,
      record: true,
      resolveAsset: session.resolveAsset,
      ...(session.art ? { art: session.art } : {}),
      onFrame: () => controller?.frame(),
    });
    host.appendChild(debug);
    controller = new PlaytestController(session, plan, client, debug, host);
    controller.preview = preview;
    return controller;
  }

  get paused(): boolean {
    return this.client.runtime.view.clockMode === 'stepped';
  }

  /** Pause: the runtime switches to stepped mode (spec 8.8). */
  pause(): void {
    this.client.runtime.setClockMode('stepped');
  }

  resume(): void {
    this.client.runtime.setClockMode('continuous');
  }

  /** One tick per press while paused. */
  step(): void {
    if (!this.paused) this.pause();
    this.client.runtime.requestSteps(1);
  }

  repro(): ReproFile {
    const runtime = this.client.runtime;
    return captureRepro(this.plan, runtime.recording()!, runtime.view.stateHash());
  }

  /** Offer the repro as a file download. */
  downloadRepro(): void {
    const repro = this.repro();
    const blob = new Blob([serializeRepro(repro)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.session.project.name.replace(/\W+/g, '-').toLowerCase()}-r${repro.contentRevision}-t${repro.frames.length}.repro.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private frame(): void {
    if (this.stopped) return;
    const view = this.client.runtime.view;
    if (this.preview && view.tick >= this.nextPreviewTick) {
      this.client.runtime.enqueue({ type: 'test-actions', actions: this.preview.actions });
      this.nextPreviewTick = view.tick + 120;
    }
    if (view.currentMapId !== this.mapId) {
      this.mapId = view.currentMapId;
      const map = this.plan.project.maps.find((m) => m.id === this.mapId);
      this.world = map ? new World(this.plan.project, map) : null;
      this.blocked = this.world ? blockedEdges(this.world) : new Float64Array(0);
    }
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.debug.width !== Math.round(width * dpr) || this.debug.height !== Math.round(height * dpr)) {
      this.debug.width = Math.round(width * dpr);
      this.debug.height = Math.round(height * dpr);
      this.debug.style.width = `${width}px`;
      this.debug.style.height = `${height}px`;
    }
    const ctx = this.debug.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (this.world) {
      const settings = this.plan.project.settings;
      drawDebug(ctx, { cam: this.client.renderer.camera, ppu: settings.pixelsPerUnit, hexSize: settings.hexSize }, view, this.world, this.blocked, this.toggles, this.plan.project);
    }
    this.onStats?.({ tick: view.tick, tickMs: this.client.tickMs, entities: view.entities.count, queued: view.stats().queuedEvents, paused: this.paused, outcome: view.outcome });
  }

  /** Leave: nothing is written back to the project. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.onStats = null;
    this.client.stop();
    this.debug.remove();
  }
}
