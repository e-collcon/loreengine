/**
 * The standalone player page. With no parameters it plays Emberfall.
 *
 *   ?fixture=elevation     the two-map elevation fixture (the render spike's scenes)
 *   ?zoom=1.5              initial zoom, 0.5 .. 2
 *   ?focus=8,6             center the camera on a cell and stop following the player
 *   ?pick=8,4              pick the terrain under that cell's top, as a click there would
 *   ?start=37,22           start the player on that cell
 *   ?hud=0                 hide the debug readout
 *
 * `window.__lore` exposes the client for the spike screenshot script.
 */
import { buildElevation, buildEmberfall, cellCenter, emberfallBlobs } from '@loreengine/fixtures';
import { screenX, screenY } from '@loreengine/render';
import type { TerrainPick } from '@loreengine/render';
import { startClient } from './client.ts';
import type { Client } from './client.ts';

declare global {
  interface Window {
    __lore?: { client: Client; ready: boolean; pickCell(col: number, row: number): TerrainPick | null };
  }
}

const params = new URLSearchParams(location.search);
const host = document.getElementById('app')!;
const project = params.get('fixture') === 'elevation' ? buildElevation() : buildEmberfall();

const hud = document.createElement('pre');
hud.style.cssText =
  'position:fixed;left:12px;top:10px;margin:0;padding:8px 10px;background:rgba(10,12,16,.72);color:#dfe5ee;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;border-radius:6px;pointer-events:none;white-space:pre';
const marker = document.createElement('div');
marker.style.cssText =
  'position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border:2px solid #fff27a;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.6);pointer-events:none;display:none';

// ?start=col,row moves the player's start (for demos and screenshots).
const startAt = params.get('start')?.split(',').map(Number);
if (startAt && startAt.length === 2) {
  const c = cellCenter(startAt[0]!, startAt[1]!);
  project.maps[0]!.playerStart = { x: c.x, y: c.y, facing: 0 };
}
const blobs = emberfallBlobs();

const client = await startClient({
  host,
  project,
  resolveAsset: async (ref) => blobs.get(ref.blobId)?.bytes ?? null,
  seed: Number(params.get('seed') ?? 1),
  zoom: params.has('zoom') ? Number(params.get('zoom')) : 1,
  onFrame: (c) => {
    if (hud.isConnected) hud.textContent = readout(c);
  },
});
if (params.get('hud') !== '0') document.body.appendChild(hud);
document.body.appendChild(marker);

const view = client.runtime.view;
const cellText = (cell: number): string => {
  const col = cell % view.world.width;
  const row = Math.floor(cell / view.world.width);
  const ramp = view.world.ramp(cell);
  return `(${col}, ${row})  level ${view.world.level(cell)}${ramp ? `  ramp toward ${ramp}` : ''}  ${project.terrains[view.world.terrain(cell)]!.name}`;
};

function readout(c: Client): string {
  const e = view.entities;
  const p = e.playerIndex();
  const lines = [
    `${project.name} — ${project.maps.find((m) => m.id === view.currentMapId)?.name ?? '?'}`,
    `tick ${view.tick}   entities ${e.count}   zoom ${c.renderer.camera.zoom.toFixed(2)}`,
  ];
  if (p >= 0) lines.push(`player  x ${e.x(p).toFixed(2)}  y ${e.y(p).toFixed(2)}  z ${e.z(p).toFixed(2)}`);
  lines.push(`hover   ${c.hover ? cellText(c.hover.cell) : '—'}`);
  if (c.hoverEntity >= 0 && e.alive(c.hoverEntity)) {
    const name = project.archetypes[e.archetype(c.hoverEntity)]!.name;
    const brain = e.brainState(c.hoverEntity);
    lines.push(`entity  ${name}  click: ${view.clickAction(e.id(c.hoverEntity))}${brain ? `  brain: ${brain}` : ''}  hp ${e.hp(c.hoverEntity)}/${e.hpMax(c.hoverEntity)}`);
  }
  lines.push(`pick    ${c.lastPick ? `${cellText(c.lastPick.cell)}  z ${c.lastPick.z.toFixed(2)}` : '—'}`);
  return lines.join('\n');
}

/** Pick the terrain at the screen point over a cell's top center, exactly as a click there would. */
function pickCell(col: number, row: number): TerrainPick | null {
  const cell = row * view.world.width + col;
  const x = view.world.centerX(cell);
  const y = view.world.centerY(cell);
  const ppu = project.settings.pixelsPerUnit;
  const sx = screenX(client.renderer.camera, ppu, x);
  const sy = screenY(client.renderer.camera, ppu, y, view.world.surfaceHeight(x, y));
  const rect = host.querySelector('canvas')!.getBoundingClientRect();
  host.querySelector('canvas')!.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + sx, clientY: rect.top + sy, button: 0, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  marker.style.display = 'block';
  marker.style.left = `${rect.left + sx}px`;
  marker.style.top = `${rect.top + sy}px`;
  return client.lastPick;
}

const focus = params.get('focus')?.split(',').map(Number);
if (focus && focus.length === 2) {
  const cell = focus[1]! * view.world.width + focus[0]!;
  client.follow = false;
  client.renderer.camera.x = view.world.centerX(cell);
  client.renderer.camera.y = view.world.centerY(cell);
  client.renderer.camera.z = view.world.surfaceHeight(client.renderer.camera.x, client.renderer.camera.y);
}
client.renderNow();
const pick = params.get('pick')?.split(',').map(Number);
if (pick && pick.length === 2) pickCell(pick[0]!, pick[1]!);

window.__lore = { client, ready: true, pickCell };
