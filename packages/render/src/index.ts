/**
 * @loreengine/render — the PixiJS renderer. It imports only `schema` and
 * `@loreengine/runtime/view`: it reads runtime state and events and can
 * reach no mutating call.
 */
export { PixiRenderer, SharedArt, hitboxOutline } from './pixi.ts';
export type { RendererOptions, AssetResolver } from './pixi.ts';
export { DrawList, ITEM_STRIP, ITEM_ENTITY } from './drawlist.ts';
export { pickTerrain, pickEntity } from './picking.ts';
export type { TerrainPick } from './picking.ts';
export {
  ISO_RATIO,
  HEIGHT_RATIO,
  CAMERA_PITCH,
  DEFAULT_CAMERA_PITCH,
  setCameraPitch,
  setProjectionRatios,
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
export { buildStrip, maxSurface, CAMERA_FACING } from './terrain.ts';
export type { StripGeometry, TopMesh, FaceQuad } from './terrain.ts';
export { spriteMetrics, footprintRadius, colorOf, shade } from './sprites.ts';
export type { SpriteMetrics } from './sprites.ts';
export { AtlasIndex, pickTier } from './atlas.ts';
export type { AtlasFrame, AtlasTier } from './atlas.ts';
export { bakeAtlas, frameNameOf, packFrames, svgAnchor, svgSize, MAX_PAGE, TIER_SCALES } from './bake.ts';
export type { BakeResult, BakeTools, Raster, SvgSource, Placement } from './bake.ts';
export { directionRow, nearestDirection, spriteFrame } from './animation.ts';
export type { SpriteFrame } from './animation.ts';
export { Feedback, MAX_PARTICLES, MAX_SHAKE, MAX_INDICATORS } from './feedback.ts';
export type { AudioSink, GroundIndicator } from './feedback.ts';
export { isOccluded, silhouettes, MAX_SILHOUETTES } from './silhouette.ts';
export { browserBakeTools, rasterToCanvas } from './bake-browser.ts';
