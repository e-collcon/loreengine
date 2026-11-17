/**
 * The game client: one runtime, one renderer, one input mapper, and the
 * loop that joins them (spec 5.3). The client keeps the accumulator, calls
 * `tick` as many times as real time requires (at most 5 per frame, so a
 * stall never spirals), and renders with the leftover fraction as
 * interpolation. The editor's playtest embeds this same client.
 */
import { AudioMixer, soundsForMap } from '@loreengine/audio';
import { Feedback, PixiRenderer, bakeAtlas, browserBakeTools, followCamera } from '@loreengine/render';
import type { Raster, TerrainPick } from '@loreengine/render';
import { MS_PER_TICK, ROLE_BITS, createRuntime } from '@loreengine/runtime';
import type { ClickAction, ClickOrder, Runtime } from '@loreengine/runtime';
import { defaultPrefs, sha256HexSync } from '@loreengine/schema';
import type { AssetRef, AtlasDef, PlayerPrefs, Project, SaveState } from '@loreengine/schema';
import { Hud } from './hud.ts';
import { InputMapper, mouseCode } from './input.ts';

export const MAX_TICKS_PER_FRAME = 5;
/** World units the player may drift from the screen center before the camera follows. */
export const CAMERA_DEADZONE = 1.5;
/** Holding the click button re-issues a ground order this often. */
export const REISSUE_TICKS = 6;
/** Placeholder cursors until chunk 7's cursor art: sword, hand, arrow. */
const CURSORS: Record<ClickAction, string> = { attack: 'crosshair', use: 'pointer', 'move-to': 'cell', none: 'default' };

export interface ClientOptions {
  host: HTMLElement;
  project: Project;
  save?: SaveState | null;
  seed?: number;
  record?: boolean;
  /** The bytes behind the project's assets, by blob id: SVG sources and sounds. */
  resolveAsset?: (ref: AssetRef) => Promise<Uint8Array | null>;
  /** The player's preferences (shake, flashing, volumes). */
  prefs?: PlayerPrefs;
  /** Start with the camera following the player. Default true. */
  follow?: boolean;
  zoom?: number;
  /** Called after each rendered frame. */
  onFrame?: (client: Client) => void;
}

export interface Client {
  readonly runtime: Runtime;
  readonly renderer: PixiRenderer;
  readonly input: InputMapper;
  readonly feedback: Feedback;
  /** Null where the browser has no Web Audio. */
  readonly mixer: AudioMixer | null;
  /** Counts the playtest leak gate compares (spec 9.5): renderer textures and audio nodes. */
  stats(): { textures: number; audioNodes: number };
  /** The terrain under the cursor as of the last pointer move, or null. */
  readonly hover: TerrainPick | null;
  /** The last terrain the player clicked, or null. */
  readonly lastPick: TerrainPick | null;
  /** Index of the entity under the cursor, or -1. */
  readonly hoverEntity: number;
  follow: boolean;
  paused: boolean;
  /** Frames rendered and ticks simulated so far. */
  readonly frames: number;
  /** Render one frame now, without advancing time (used for screenshots). */
  renderNow(): void;
  stop(): void;
}

export async function startClient(options: ClientOptions): Promise<Client> {
  const { host, project } = options;
  const runtime = createRuntime(project, options.save ?? null, {
    seed: options.seed ?? 1,
    clockMode: 'continuous',
    record: options.record ?? false,
  });
  const view = runtime.view;

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  host.appendChild(canvas);
  const size = (): [number, number] => [Math.max(1, host.clientWidth), Math.max(1, host.clientHeight)];
  const [w0, h0] = size();
  const renderer = await PixiRenderer.create(view, { canvas, width: w0, height: h0, resolution: Math.min(2, window.devicePixelRatio || 1) });
  if (options.zoom !== undefined) renderer.setZoom(options.zoom);
  const input = new InputMapper(project.inputActions);
  const prefs = options.prefs ?? defaultPrefs();
  const resolve = options.resolveAsset ?? (async () => null);

  // Audio: suspended until the first gesture; sounds decode in the background.
  let mixer: AudioMixer | null = null;
  const AudioCtor = window.AudioContext;
  if (AudioCtor) {
    mixer = new AudioMixer(new AudioCtor(), project, resolve);
    mixer.setVolumes(prefs.volumes);
    mixer.preload(soundsForMap(project, view.currentMapId));
    const bgm = project.maps.find((m) => m.id === view.currentMapId)?.bgm;
    if (bgm !== undefined) mixer.changeBgm(bgm, 1000);
  }
  const feedback = new Feedback(project, view, { prefs, ...(mixer ? { audio: mixer } : {}) });
  host.style.position ||= 'relative';
  const hud = new Hud(host, view);
  const interactKey = (project.inputActions.find((a) => a.role === 'interact')?.defaultBindings[0] ?? '').replace(/^Key/, '');

  // Bake the project's vector sources into atlases (spec 6.7). Until that finishes, and for
  // any frame with no source, the renderer draws its placeholder shapes.
  const decoder = new TextDecoder();
  const baked: AtlasDef[] = [];
  const pages = new Map<string, Raster>();
  const bakeAll = async (): Promise<void> => {
    const tools = browserBakeTools(async (bytes, mime, extra) => ({ blobId: sha256HexSync(bytes), mime, byteSize: bytes.length, ...extra }));
    for (const atlas of project.assets.atlases) {
      const sources = [];
      for (const sourceId of atlas.sourceIds) {
        const asset = project.assets.vectorSources.find((a) => a.id === sourceId);
        const bytes = asset ? await resolve(asset.ref) : null;
        if (asset && bytes) sources.push({ assetId: asset.id, name: asset.name, svg: decoder.decode(bytes) });
      }
      if (sources.length === 0) continue;
      const result = await bakeAtlas(atlas.id, sources, tools);
      baked.push(...result.atlases);
      for (const [blobId, raster] of result.pages) pages.set(blobId, raster);
    }
    if (!stopped && baked.length > 0) renderer.setAtlases(baked, pages);
  };
  let mapId = view.currentMapId;

  let heldOnGround = false;
  let heldTicks = 0;
  let hover: TerrainPick | null = null;
  let hoverEntity = -1;
  let lastPick: TerrainPick | null = null;
  let frames = 0;
  let stopped = false;
  const scratch: TerrainPick = { cell: -1, x: 0, y: 0, z: 0 };

  const snapCamera = (): void => {
    const p = view.entities.playerIndex();
    if (p < 0) return;
    renderer.camera.x = view.entities.x(p);
    renderer.camera.y = view.entities.y(p);
    renderer.camera.z = view.entities.z(p);
  };
  snapCamera();

  const pointerAt = (event: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const updateHover = (event: MouseEvent): void => {
    const [sx, sy] = pointerAt(event);
    hover = renderer.pickTerrain(sx, sy, scratch) ? { ...scratch } : null;
    input.setPointer(hover ? { x: hover.x, y: hover.y } : null);
    // One resolver for click and hover: the cursor says what the click would do (spec 7.9b).
    hoverEntity = renderer.pickEntity(sx, sy);
    const action = hoverEntity >= 0 ? view.clickAction(view.entities.id(hoverEntity)) : 'none';
    canvas.style.cursor = CURSORS[action];
  };
  /** Entities first, front-most in draw order; then the height-aware terrain pick (spec 7.9b). */
  const orderAt = (event: MouseEvent): ClickOrder | null => {
    const [sx, sy] = pointerAt(event);
    const entity = renderer.pickEntity(sx, sy);
    if (entity >= 0 && entity !== view.entities.playerIndex()) return { kind: 'entity', entity: view.entities.id(entity) };
    if (!renderer.pickTerrain(sx, sy, scratch)) return null;
    lastPick = { ...scratch };
    renderer.setHighlight(scratch.cell);
    return { kind: 'ground', x: scratch.x, y: scratch.y };
  };

  const unlock = (): void => void mixer?.unlock();
  const onKeyDown = (event: KeyboardEvent): void => {
    unlock();
    if (input.isBound(event.code)) event.preventDefault();
    if (!event.repeat) input.press(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => input.release(event.code);
  const onMouseDown = (event: MouseEvent): void => {
    unlock();
    updateHover(event);
    const code = mouseCode(event.button);
    input.press(code);
    if (project.inputActions.some((a) => a.role === 'click' && a.defaultBindings.includes(code))) {
      const order = orderAt(event);
      input.setOrder(order);
      heldOnGround = order !== null && order.kind === 'ground';
      heldTicks = 0;
    }
  };
  const onMouseUp = (event: MouseEvent): void => input.release(mouseCode(event.button));
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    renderer.setZoom(renderer.camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  };
  const onBlur = (): void => input.releaseAll();
  const onContext = (event: Event): void => event.preventDefault();
  const onResize = (): void => renderer.resize(...size());

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onResize);
  canvas.addEventListener('mousemove', updateHover);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);

  let last = performance.now();
  let accumulator = 0;
  let raf = 0;

  const client: Client = {
    runtime,
    renderer,
    input,
    feedback,
    mixer,
    stats: () => ({ textures: renderer.stats().textures, audioNodes: mixer ? mixer.nodeCount : 0 }),
    get hover() {
      return hover;
    },
    get lastPick() {
      return lastPick;
    },
    get hoverEntity() {
      return hoverEntity;
    },
    follow: options.follow ?? true,
    paused: false,
    get frames() {
      return frames;
    },
    renderNow() {
      renderer.render(1, feedback);
      frames++;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mouseup', onMouseUp);
      hud.destroy();
      mixer?.dispose();
      renderer.destroy();
      runtime.dispose();
      canvas.remove();
    },
  };

  const frame = (now: number): void => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const elapsed = Math.min(now - last, 250);
    accumulator += elapsed;
    last = now;
    let ticks = 0;
    while (accumulator >= MS_PER_TICK && ticks < MAX_TICKS_PER_FRAME) {
      accumulator -= MS_PER_TICK;
      ticks++;
      if (client.paused) continue;
      // Holding the click button on terrain re-issues the move order every 6 ticks, as in Diablo (spec 7.9b).
      if (heldOnGround && hover && ++heldTicks % REISSUE_TICKS === 0) input.setOrder({ kind: 'ground', x: hover.x, y: hover.y });
      const inputFrame = input.frame();
      if ((inputFrame.held & ROLE_BITS.click) === 0) {
        heldOnGround = false;
        heldTicks = 0;
      }
      runtime.tick(inputFrame);
    }
    // A stall longer than five ticks is dropped, not replayed.
    if (accumulator >= MS_PER_TICK) accumulator = 0;
    if (client.follow) {
      const p = view.entities.playerIndex();
      if (p >= 0) followCamera(renderer.camera, view.entities.x(p), view.entities.y(p), view.entities.z(p), CAMERA_DEADZONE);
    }
    // Presentation: read what the ticks raised, advance it by real time, and draw.
    feedback.consume(view);
    if (!client.paused) feedback.update(elapsed);
    if (mixer) {
      mixer.update();
      if (view.currentMapId !== mapId) {
        mapId = view.currentMapId;
        mixer.preload(soundsForMap(project, mapId));
      }
    }
    renderer.render(client.paused ? 1 : accumulator / MS_PER_TICK, feedback);
    hud.update(view, renderer.drawList, interactKey, now);
    frames++;
    options.onFrame?.(client);
  };
  raf = requestAnimationFrame(frame);
  await bakeAll().catch((error) => console.warn('LoreEngine: the art bake failed; placeholder shapes stay.', error));
  return client;
}
