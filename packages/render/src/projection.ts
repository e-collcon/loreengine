/**
 * The hex-iso projection (spec 6.6). The world plane is the un-squashed hex
 * plane in world units, seen by an orthographic camera pitched down from the
 * horizon by CAMERA_PITCH: depth on the ground shrinks by sin(pitch) and
 * height by cos(pitch), so a steeper camera shows rounder hexes and shorter
 * cliffs, as Civilization VI and Beyond Earth do.
 *
 *   screenX = (x - cam.x) * ppu * zoom + width / 2
 *   screenY = ((y - cam.y) * ISO_RATIO - (z - cam.z) * HEIGHT_RATIO) * ppu * zoom + height / 2
 *
 * Everything here is pure: the picking and depth-order tests run without a GPU.
 */

/**
 * The camera's angle above the horizon, in degrees. v0.6.0 authored a squash
 * per map (`isoRatio`); the foundation schema has no such field, so this is
 * an engine constant (DECISIONS_LOG N3). 55° after E's spike review (D192);
 * the spike's first angle was about 27° (squash 0.5, heights unscaled).
 */
export const DEFAULT_CAMERA_PITCH = 55;

/** sin(pitch): how much ground depth survives on screen. */
export let ISO_RATIO = Math.sin((DEFAULT_CAMERA_PITCH * Math.PI) / 180);
/** cos(pitch): how much height survives on screen. */
export let HEIGHT_RATIO = Math.cos((DEFAULT_CAMERA_PITCH * Math.PI) / 180);
export let CAMERA_PITCH = DEFAULT_CAMERA_PITCH;

/**
 * Set the two ratios directly. The spike's first camera was (0.5, 1): a squash
 * of 0.5 with heights unscaled, which no pitch reproduces exactly at the same
 * scale. Tests use it to keep the spike's original assertions (D192).
 */
export function setProjectionRatios(iso: number, height: number): void {
  ISO_RATIO = iso;
  HEIGHT_RATIO = height;
  CAMERA_PITCH = (Math.atan2(iso, height) * 180) / Math.PI;
}

/** Change the camera's angle (20°..80°), for comparing angles; call before a renderer is made. */
export function setCameraPitch(degrees: number): void {
  CAMERA_PITCH = Math.max(20, Math.min(80, degrees));
  ISO_RATIO = Math.sin((CAMERA_PITCH * Math.PI) / 180);
  HEIGHT_RATIO = Math.cos((CAMERA_PITCH * Math.PI) / 180);
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

export interface Camera {
  /** The world point shown at the center of the viewport. */
  x: number;
  y: number;
  z: number;
  /** 0.5 .. 2.0 */
  zoom: number;
  /** Viewport size in screen pixels. */
  width: number;
  height: number;
}

export function createCamera(width: number, height: number): Camera {
  return { x: 0, y: 0, z: 0, zoom: 1, width, height };
}

export function clampZoom(zoom: number): number {
  return zoom < MIN_ZOOM ? MIN_ZOOM : zoom > MAX_ZOOM ? MAX_ZOOM : zoom;
}

/** World point to "world pixels": the projection at zoom 1, before the camera. Terrain meshes are built in this space. */
export function projectX(x: number, ppu: number): number {
  return x * ppu;
}
export function projectY(y: number, z: number, ppu: number): number {
  return (y * ISO_RATIO - z * HEIGHT_RATIO) * ppu;
}

export function screenX(cam: Camera, ppu: number, x: number): number {
  return (x - cam.x) * ppu * cam.zoom + cam.width / 2;
}
export function screenY(cam: Camera, ppu: number, y: number, z: number): number {
  return ((y - cam.y) * ISO_RATIO - (z - cam.z) * HEIGHT_RATIO) * ppu * cam.zoom + cam.height / 2;
}

/** World x under screen column `sx` (independent of height). */
export function worldXAt(cam: Camera, ppu: number, sx: number): number {
  return (sx - cam.width / 2) / (ppu * cam.zoom) + cam.x;
}
/** World y of the point at height `z` that projects to screen row `sy`. */
export function worldYAt(cam: Camera, ppu: number, sy: number, z: number): number {
  return ((sy - cam.height / 2) / (ppu * cam.zoom) + (z - cam.z) * HEIGHT_RATIO) / ISO_RATIO + cam.y;
}

/**
 * The inclusive range of map rows whose strips can reach the screen. Raised
 * terrain appears higher than its ground position, so rows below the bottom
 * of the screen are included as far as `maxSurface` (world units) can lift them.
 */
export function visibleRows(cam: Camera, ppu: number, hexSize: number, mapHeight: number, maxSurface: number, out: { first: number; last: number }): void {
  const rowPitch = 1.5 * hexSize;
  const top = worldYAt(cam, ppu, 0, 0);
  const bottom = worldYAt(cam, ppu, cam.height, maxSurface);
  let first = Math.floor((top - hexSize) / rowPitch);
  let last = Math.ceil((bottom + hexSize) / rowPitch);
  if (first < 0) first = 0;
  if (last > mapHeight - 1) last = mapHeight - 1;
  out.first = first;
  out.last = last;
}

/**
 * Camera follow with a deadzone (spec 6.6): the camera moves only as far as
 * needed to keep the target within `deadzone` world units of the center on
 * each axis.
 */
export function followCamera(cam: Camera, x: number, y: number, z: number, deadzone: number): void {
  if (x - cam.x > deadzone) cam.x = x - deadzone;
  else if (cam.x - x > deadzone) cam.x = x + deadzone;
  if (y - cam.y > deadzone) cam.y = y - deadzone;
  else if (cam.y - y > deadzone) cam.y = y + deadzone;
  cam.z = z;
}
