/**
 * EditorState (spec 8.3): what the editor is doing, apart from the project:
 * the open map, the tool and its settings, the selection, the overlays.
 * The camera lives in the canvas's renderer.
 */
import type { Id } from '@loreengine/schema';
import type { BrushSize } from './brush.ts';
import type { Overlay } from './overlays.ts';

export const TOOLS = ['terrain', 'raise', 'lower', 'flatten', 'region', 'place', 'select'] as const;
export type Tool = (typeof TOOLS)[number];

export const TOOL_LABELS: Record<Tool, string> = {
  terrain: 'Terrain',
  raise: 'Raise',
  lower: 'Lower',
  flatten: 'Flatten',
  region: 'Region',
  place: 'Place',
  select: 'Select',
};

export interface EditorState {
  mapId: string;
  tool: Tool;
  brushSize: BrushSize;
  terrainId: Id<'terrain'> | null;
  regionId: string | null;
  /** Region brush erases instead of painting. */
  eraseRegion: boolean;
  archetypeId: Id<'archetype'> | null;
  /** Selected placement key (or the player start's), for Select and the inspector. */
  selection: string | null;
  overlays: Record<Overlay, boolean>;
  /**
   * What covers the canvas and inspector, if anything: `db:<key>` a database,
   * `settings`, `triggers:global` or `triggers:<mapId>`, `assets`.
   */
  panel: string | null;
}

export function initialState(mapId: string): EditorState {
  return {
    mapId,
    tool: 'select',
    brushSize: 7,
    terrainId: null,
    regionId: null,
    eraseRegion: false,
    archetypeId: null,
    selection: null,
    overlays: { levels: false, blocked: true, lint: true, regions: true, sight: true },
    panel: null,
  };
}
