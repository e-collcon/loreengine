/**
 * The hex-iso projection (spec 6.6). The world plane is the un-squashed hex
 * plane in world units. The projection places (x, y) with the vertical iso
 * squash; height lifts the point by `z * pixelsPerUnit * zoom` screen pixels.
 *
 *   screenX = (x - cam.x) * ppu * zoom + width / 2
 *   screenY = ((y - cam.y) * ISO_RATIO - (z - cam.z)) * ppu * zoom + height / 2
 *
 * Everything here is pure: the picking and depth-order tests run without a GPU.
 */

/**
 * Vertical squash of the world plane on screen. v0.6.0 authored this per
 * map (`isoRatio`); the foundation schema has no such field, so it is an
 * engine constant (DECISIONS_LOG N3).
 */
export const ISO_RATIO = 0.5;

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
  return (y * ISO_RATIO - z) * ppu;
}

export function screenX(cam: Camera, ppu: number, x: number): number {
  return (x - cam.x) * ppu * cam.zoom + cam.width / 2;
}
export function screenY(cam: Camera, ppu: number, y: number, z: number): number {
  return ((y - cam.y) * ISO_RATIO - (z - cam.z)) * ppu * cam.zoom + cam.height / 2;
}

/** World x under screen column `sx` (independent of height). */
export function worldXAt(cam: Camera, ppu: number, sx: number): number {
  return (sx - cam.width / 2) / (ppu * cam.zoom) + cam.x;
}
/** World y of the point at height `z` that projects to screen row `sy`. */
export function worldYAt(cam: Camera, ppu: number, sy: number, z: number): number {
  return ((sy - cam.height / 2) / (ppu * cam.zoom) + (z - cam.z)) / ISO_RATIO + cam.y;
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
