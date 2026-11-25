# Dordogne terrain · Batch 1 proof

The four ground sources and one cliff source are seamless at 1024 × 1024. Ground textures are straight top-down. The limestone cliff is drawn face-on. Decoration is drawn for the 55° camera and uses a zero-radius ground anchor and layered translucent contact ellipses.

| Terrain or use | Surface | Cliff | Decoration |
| --- | --- | --- | --- |
| Grassland · flat-vector trial | `ground/grassland.svg` | `cliff/limestone.svg` | `decor/grassland/tuft-a.svg` |
| Grassland · painted trial | `ground/grassland.png` | `cliff/limestone.svg` | `decor/grassland/tuft-a.svg` |
| Meadow | `ground/meadow.svg` | `cliff/limestone.svg` | Use the ground texture for this trial |
| Woods | `ground/woods-floor.svg` | `cliff/limestone.svg` | `decor/woods/oak-a.svg`, `decor/woods/oak-b.svg` |
| Limestone decoration trial | Use an available ground in the elevation fixture | `cliff/limestone.svg` | `decor/limestone/boulder-a.svg` |

## Grassland and tree comparisons

Use one grassland source for each fixture run. The two sources have closely matched average color and the same short-grass scale. The vector source has flat facets and tapered blades. The painted source uses soft pigment strokes on the same grassland study. Switch the grassland source with the camera and decoration placement held fixed.

| Decoration | Canvas | Ground anchor | Art size |
| --- | --- | --- | --- |
| Oak A | 108 × 147 px | 53, 130 | Broad crown, about 128 px from crown to anchor |
| Oak B | 112 × 180 px | 55, 162 | Taller silhouette, about 159 px from crown to anchor |
| Boulder A | 64 × 62 px | 32, 49 | About 56 px across |
| Tuft A | 32 × 30 px | 16, 22 | About 30 px across |

Oak dimensions refer to the visible tree from crown to ground anchor. The taller SVG canvases accommodate the shadows. Shadow ellipses use the 5:4 ratio and opacity, so judge their softness and placement in the atlas bake. The 55° rendering is a visual approximation for the fixture.

## Verification

All SVG texture shapes crossing an edge have an exact opposite-edge copy. The painted source was offset 512 px on both axes, blended at the exposed joins, and offset back. The final painted PNG has matching opposite-edge pixels. I reviewed five 3 × 3 repeats and checked the SVG dimensions and anchors. The five repeat previews are separate files accompanying the archive. Live import and atlas bake are pending.
