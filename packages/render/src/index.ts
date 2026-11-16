/**
 * @loreengine/render — the PixiJS renderer. It imports only `schema` and
 * `@loreengine/runtime/view`: it reads runtime state and events and can
 * reach no mutating call.
 */
export { PixiRenderer } from './pixi.ts';
export type { RendererOptions, AssetResolver } from './pixi.ts';
export { DrawList, ITEM_STRIP, ITEM_ENTITY } from './drawlist.ts';
export { pickTerrain, pickEntity } from './picking.ts';
export type { TerrainPick } from './picking.ts';
export {
  ISO_RATIO,
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  createCamera,
  followCamera,
  projectX,
  projectY,
  screenX,
  screenY,
  worldXAt,
  worldYAt,
  visibleRows,
} from './projection.ts';
export type { Camera } from './projection.ts';
export { buildStrip, maxSurface, CAMERA_FACING, TOP_INDICES } from './terrain.ts';
export type { StripGeometry, TopMesh, FaceQuad } from './terrain.ts';
export { spriteMetrics, footprintRadius, colorOf, shade } from './sprites.ts';
export type { SpriteMetrics } from './sprites.ts';
