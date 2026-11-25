# Dordogne terrain art

Lexie's art for the Civ-style terrain (D205). What artists deliver, and how, is in `Context/ART_CONTRACT.md`. The art belongs to Elmscorp.

## `batch1/`: the proof batch (25 Nov 2026)

**What it is:**
- grassland twice, once as a flat-vector SVG and once as a painted PNG, so E can choose the style;
- meadow and woods floor;
- the limestone cliff;
- oak A, oak B, a boulder and a grass tuft.

Lexie's own notes are in `batch1/README.md`.

**Status:** test art for workstream W8 (`Context/V0.2_PLAN.md`, step 7). No code loads it yet. Use one grassland source at a time.

**Checked by Claudia against the art contract (25 Nov).** The SVGs were rasterized in headless Chromium, as the bake does.

| Check | Result |
| --- | --- |
| Format: textures 1024 × 1024; SVGs use only `polygon`, `rect`, `circle` and `ellipse`; every decoration has its anchor; nothing forbidden; every file under 2 MB | Pass |
| Seamless on all four edges: the step across a wrap edge is 0.8–2 times a typical step between neighboring pixels, and 3 × 3 tilings show no grid | Pass |
| Even across the texture, mid values, no darkened edges; the cliff has no top lip or bottom band | Pass |
| Decoration drawn for the 55° camera, shadows exactly 5 : 4, canopies 98 and 101 px wide | Pass |

**Sizes next to the Emberfall hero**, whose figure is 88 px tall:

| Item | Visible size |
| --- | --- |
| Oak A | 129 px tall |
| Oak B | 161 px tall |
| Boulder | 56 × 50 px |
| Tuft | 27 × 20 px |

**Open for batch 2:**
- At game size the ground reads as flat paint: its fine detail varies by only 3–5 brightness steps of 255 (ART_CONTRACT section 1, rule 5).
- Meadow and grassland average almost the same color (#989c65 and #86945c).
- A smaller boulder is needed.

**E chooses:** painted or vector ground, and the tree scale.

**Harmless:** the painted PNG's opposite edges are identical pixels, so tiling repeats one row and one column.
