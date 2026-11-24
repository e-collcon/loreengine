# LoreEngine art contract

Written 24 Nov 2026 (Claudia) for v0.2 (`V0.2_PLAN.md` W5 and W8). This file is for artists, Lexie first. It says what the engine accepts, at what size, and named how, so art imports on the first try.

**What changed on 24 Nov:** terrain is now **Civ-style** (D205, `FOUNDATION_DESIGN.md` 6.6a). There are no per-hex tiles any more. Sections 1–3 are new. Section 4 (characters and props) is the earlier W5 contract, unchanged.

---

## 0. Numbers every piece shares

| Thing | Value |
| --- | --- |
| Screen scale | **64 px = 1 world unit** at zoom 1 (`pixelsPerUnit`). Atlas art is also baked at 2× (128 px per unit), so it must look clean at double size |
| A hex | Pointy-top, 1 unit from center to corner: about **111 px wide** on screen. Its flat inner part is 75% of that |
| Height | One level = 0.5 units. One level apart is a walkable slope; two or more is a cliff |
| Camera | Looks down at **55°**. The ground is foreshortened by the engine; sprites are drawn upright as they are |
| The hero | Drawn in a **96 × 128 px** box, feet at (48, 118). Use it as the scale reference for everything else |

---

## 1. Ground textures (one per terrain)

The engine tiles each ground texture across the whole map in world space and blends neighboring terrains across hex borders. **The art never sees a hex.** A ground texture is a patch of landscape, not a tile.

**Format**
- **PNG or WebP:** square, **1024 × 1024** (512 × 512 is accepted). Other sizes are refused.
- **SVG:** `width="1024" height="1024" viewBox="0 0 1024 1024"`. The engine rasterizes it once to 1024 × 1024.
- One file per terrain: `ground/<terrain>.png` (or `.webp`, `.svg`).

**Scale.** By default one texture covers **4 × 4 world units**. That is 256 texture pixels per unit, and a hex is about 443 px across. On screen at zoom 1, the texture is shown at a quarter of its size, so a detail under about 8 px disappears.
- A grass blade: 8–20 px.
- A pebble: 6–24 px.
- A leaf: 10–20 px.

**Must**
1. **Seamless on all four edges.** Anything that crosses an edge continues on the opposite edge. Check by laying the texture out 3 × 3: no seam, no visible grid.
2. **Straight top-down.** Orthographic, as if photographed from directly above. Do not squash it for the camera, and use no perspective and no horizon: the engine does the projection.
3. **No hex shapes, outlines, borders, vignettes, darkened edges or grid lines.** The grid is an engine overlay the player can turn on.
4. **Even, with no standouts.** The texture repeats every 4 units, so one memorable feature (a lone flower, a big rock, a puddle) shows up as a pattern across the map.
   - Keep the largest feature under about 1/8 of the texture (128 px).
   - Standouts belong in decoration (section 3).
5. **Narrow value range.** Keep brightness within a tight band around the texture's average, so tiling makes no blotches.
6. **Mid-values.** Avoid near-black and near-white. The engine blends neighboring textures, and a very dark texture next to a very light one makes a muddy band where they meet.
7. **No strong baked light.** The engine does not light the ground. If small things cast shadows, keep them soft and falling straight down the image (south).

**Should**
- **Make terrains easy to tell apart.** Distinct terrains should differ in hue and in average brightness. The texture's average color becomes the terrain's color on the area map and minimap.
- **Split the work with decoration.** The texture carries the fine grain (grass, leaf litter, gravel); decoration carries the things you notice (trees, boulders, flower clumps).

**The Dordogne demo set** (10 ground textures; the engine caps a project at 16 ground and cliff textures together):

| File | Terrain | Notes |
| --- | --- | --- |
| `ground/grassland` | Pasture | Short, even grass. Emberfall's `grass` |
| `ground/meadow` | Meadow | Longer grass with tiny flower specks only. Clumps of flowers are decoration |
| `ground/woods-floor` | Woods | Leaf litter, moss, twigs: the ground under trees. Trees are decoration |
| `ground/farmland` | Wheat or sunflower field | Rows are fine, but they run unbroken across neighboring farmland cells. A patchwork comes from painting `farmland` and `fallow` side by side |
| `ground/fallow` | Plowed or fallow field | Brown furrowed earth |
| `ground/dirt` | Path, bare earth | Packed, walked-on earth. Emberfall's `dirt`. Real roads along hex edges come later |
| `ground/limestone` | Rock ground | Flat, pale, weathered stone. Emberfall's `stone` and `rock` (the impassable one adds boulders as decoration) |
| `ground/gravel` | Riverbank | Sand and pebbles: the band between grass and water |
| `ground/water-shallow` | Shallow water | Clear green-blue with the riverbed showing. Slow scroll is set in the editor; do not draw foam or shorelines, which the blend makes |
| `ground/water-deep` | Deep water | Darker blue-green, no riverbed. Rivers along hex edges come later |

**Palette direction:** Dordogne in late summer. Limestone cream and ochre, olive and sage greens, walnut and chestnut browns, wheat gold, and a green-blue river. The palette should be quiet enough that the hero and enemies read on top of it.

---

## 2. Cliff textures

Cliff faces appear where neighboring cells differ by two or more levels. The engine tiles the cliff texture along the face, using the **upper** cell's terrain, and shades the two faces the camera sees in two tones.

**Format.** Same as ground textures: square PNG or WebP at 1024 (or 512), or SVG at 1024. One file per cliff: `cliff/<name>.png`.

**Scale.** By default one cliff texture covers **2 × 2 world units**: about two hex edges wide and four levels tall.

**Must**
1. **Seamless on all four edges.** Tall cliffs repeat the texture vertically.
2. **Face-on (front elevation)**, evenly lit. The engine adds the shading.
3. **No top lip and no bottom band.** Leave out a grass edge on top and a rubble strip at the bottom: the vertical repeat would turn any band into stripes. The ground surface covers the top edge.

**The Dordogne set**

| File | Notes | Used by |
| --- | --- | --- |
| `cliff/limestone` | Pale cream-gray limestone with ochre and dark streaks, and horizontal bedding, like the Vézère valley cliffs | limestone, grassland, meadow, woods (a grass plateau over a limestone cliff) |
| `cliff/earth` | A brown earth bank with roots and a few stones | dirt, farmland, fallow, gravel |

---

## 3. Decoration

Decoration is scattered over the ground by the engine, a few items per hex, always the same way for the same map. **It is visual only:** units walk through it, and it blocks nothing. Anything that should block movement or sight is a placed prop or a terrain flag, not decoration.

**Format.** SVG frames, baked into atlases like characters. The rules are in section 4, plus the ones below.
- **Naming:** `decor/<terrain>/<item>-<variant>.svg`, e.g. `decor/woods/oak-a.svg`.
- **Size:** the SVG's width and height are its size on screen at zoom 1 (64 px = 1 unit). Crop tightly to the drawing plus its shadow.

**Must**
1. **Draw it as the game sees it:** upright, seen from a little above. Show a little of the tops of rocks and canopies; not a straight side view, not top-down.
2. **Set the anchor where it touches the ground** (`<circle id="anchor" cx=".." cy=".." r="0"/>`). Without one, the anchor is bottom center.
3. **Give each item a soft contact shadow:** a semi-transparent ellipse at its base, inside the SVG. The engine casts no shadows.
4. **Light from above, not from one side.** The engine mirrors items at random and scales them between 90% and 110%.
5. **No lettering and no logos.**

**Sizes and sets** (1× pixels; the hero is 96 × 128 for reference)

| Set | Items, 2–3 variants each | Size |
| --- | --- | --- |
| `decor/woods` | Oak, walnut, chestnut. Single trees and clusters of two or three | 96–160 px tall, canopy under 112 px wide |
| `decor/woods` | Undergrowth: fern, bramble | 24–48 px |
| `decor/grassland` | Grass tufts, a lone small bush | 12–48 px |
| `decor/meadow` | Flower clumps (poppy, lavender, white wildflowers), tall grass | 16–40 px |
| `decor/limestone` | Boulders, small rocks, scrub | 16–64 px |
| `decor/farmland` | Haystack or sheaf, a lone walnut tree | 32–112 px |
| `decor/gravel` | Reeds, driftwood, pebbles | 16–48 px |

---

## 4. Characters, props and other atlas art (unchanged)

- **One SVG per frame,** named by its path without the extension. With one drawn direction, use `<set>/<clip>/<index>.svg`, e.g. `hero/idle/0.svg`. With more directions, use `knight/attack-swing/dir2/03.svg`.
- **Figures:**
  - Drawn facing **right** in a 96 × 128 box, feet at (48, 118).
  - Left-facing frames are mirrors.
  - Sets may have 1, 4, 6 or 8 directions.
- **Anchor:** on an element with `id="anchor"`; without one, bottom center.
- **The state clips every animation set needs:** `idle`, `move`, `dodge`, `hurt`, `death`. Each attack also needs `<attack>-windup`, `<attack>-active` and `<attack>-recovery`. Any frame count works; the Emberfall fixture uses:
  - idle 2, move 4, dodge 2, hurt 1, death 3;
  - windup 2, active 1, recovery 2 per attack.
  - Attack timing comes from the attack, and the engine stretches the clip to fit.
- **Props** that block (houses, walls, fences, chests) are placed entities with their own frames, not decoration. They follow these rules.
- **Baking:** atlases are baked at 1× and 2× of 64 px per unit, into pages of at most 4096 × 4096.

---

## 5. SVG rules (sections 1, 3 and 4)

The engine rasterizes SVGs in the browser as images. In that mode, anything outside the file does not load.

| Status | SVG features |
| --- | --- |
| **Proven in the engine** | Flat-filled `<polygon>`, `<path>`, `<rect>`, `<circle>`, strokes (Lexie's 563 Dordogne hexes, the Emberfall placeholders) |
| **Expected to work, not yet tested here** | Gradients, opacity, `<pattern>`, filters. For seamless noise, use `feTurbulence` with `stitchTiles="stitch"`. Send one test file first |
| **Not allowed** | Embedded or linked images, links to other files or URLs, web fonts, `<text>` (it renders in whatever font the machine has), scripts |

---

## 6. Do not send

- Per-hex tiles, hex-shaped art, or tiles with outlines, for the Civ-style look. The old per-hex mode still exists for other projects, but the demo does not use it.
- Transition or auto-tile sets (RPG Maker A2 blocks, 47-tile blob sets). The engine blends terrains itself.
- Ground drawn in isometric or perspective view.
- Rivers or roads painted into ground textures. They come later, as edge features.
- Textures with a single standout feature, or with darkened edges.
- PNGs that are not square, or not 512 or 1024 px.

---

## 7. Delivery

Use one folder or zip:

```
dordogne-terrain/
  ground/grassland.png   …
  cliff/limestone.png    …
  decor/woods/oak-a.svg  …
  README.md              which ground, cliff and decor set each terrain uses
```

**First batch (the proof):**
- 3 ground textures: grassland, meadow, woods-floor;
- 1 cliff texture: limestone;
- 4 decoration items: two trees, one boulder, one grass tuft.

Claudia-Code loads them into the elevation fixture as soon as the Civ-style terrain lands, and posts screenshots before the rest are drawn.

## 8. Open for E

1. **Tree scale.** In Civilization, trees are tiny next to units, because units there are tokens. In an action RPG the hero should read as smaller than a tree; the sizes above make a tree about 1 to 1.5 times the hero's height. E decides after the proof screenshots.
2. **Painted PNG or flat vector SVG for the ground.** Both are accepted. Painted textures are closer to Civilization VI; vector matches the characters' style.
