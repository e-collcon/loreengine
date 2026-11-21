# LoreEngine v0.1 QA checklist

Human checks for chunks 1–9 and the N6 terrain rebuild (main @ 3db0e4d). Automated gates already cover the logic; these cover look, feel, sound and editor workflow.

**Live version (marks and notes save):** https://claude.ai/artifact/5myArj1Ln5ycQgjKDVPbgz (private to E; results are read from there). This file is the readable copy for other sessions; tick boxes here only if you are working offline.

75 checks. Pass = works as expected; Fail = note what you saw; Skip = not tested.

## Before you start — Set up on your Mac

Two terminals help: one for the player, one for the editor. Vite prints each URL; the second one gets the next port.

- [ ] **S1 Pull and install** _(Terminal)_
  - Run: `git pull origin main`
  - Run: `npm install`
  - **Expect:** `npm install` finishes without errors and `git log -1 --oneline` shows 3db0e4d or newer.
- [ ] **S2 Start the player** _(Terminal)_
  - Run: `npm run dev -w @loreengine/player`
  - **Expect:** Emberfall opens at the URL Vite prints. Add `?fixture=elevation` to the URL for the small terrain test map.
- [ ] **S3 Start the editor** _(Terminal)_
  - Run: `npm run dev -w @loreengine/editor`
  - **Expect:** The editor opens with Emberfall on the canvas.
- [ ] **S4 Tick bench on your machine** _(Terminal)_
  - Run: `npm run bench`
  - **Expect:** The `[bench] tick` line shows a mean well under 4 ms, and heap growth stays under 65,536 bytes. Paste the tick line into the note.
- [ ] **S5 Render bench, now without the 404** _(Terminal)_
  - Run: `npm run build`
  - Run: `npm run bench:render`
  - **Expect:** Ends with “browser checks passed” and no “console problems” section (the favicon 404 is fixed). Means stay far under 8 ms.

## Chunks 1–2 — Project data and saves

Chunks 1 and 2 are headless and fully covered by tests. These two checks are the parts you can see.

- [ ] **F1 Your old autosave still opens** _(Editor)_
  - Open the editor in the same browser you used before 20 Nov (your autosave predates the terrain rebuild).
  - **Expect:** Your project opens without an error. Cells that were ramps are now plain cells at their lower level; the warnings panel lists any area that became unreachable.
- [ ] **F2 First start seeds Emberfall** _(Editor)_
  - Open the editor URL in a private window (empty storage).
  - **Expect:** Emberfall appears as a new project, with one warning: the ledge at (4, 5).

## Chunk 3 + N6 — World and terrain

The terrain rebuild: one level apart is a walkable terraced slope, two or more is a cliff. Start with `?fixture=elevation` on the player URL.

- [ ] **W1 Terraces read as steps** _(Player · elevation map)_
  - Look around the stone plateau, the dirt step on its west side and the dirt terrace on its east side.
  - **Expect:** One-level edges show two terraced steps (the darker bands are the rises). Two-level edges are cliffs with a rock face on their south sides. No holes or cracks where three hexes meet. Note whether the slopes feel too thin at this camera.
- [ ] **W2 Walk up and down slopes** _(Player · elevation map)_
  - From the start, walk with WASD onto the dirt step, then onto the plateau, then down to the terrace.
  - **Expect:** The hero rises and falls smoothly with no pop; the readout’s z goes 0 → 0.5 → 1 and back.
- [ ] **W3 Cliffs stop you** _(Player · elevation map)_
  - Walk straight into the plateau’s south cliff from the ground.
  - **Expect:** The hero stops or slides along the edge; never climbs it or sinks into the face.
- [ ] **W4 Water and rock block walking** _(Player · elevation map)_
  - Walk into the pond (left) and the rock pillar (bottom middle).
  - **Expect:** The hero cannot enter either.
- [ ] **W5 Door to the cellar and back** _(Player · elevation map)_
  - Walk onto the door hex in the bottom-right corner.
  - In the cellar, walk onto the stairs (top-left).
  - **Expect:** You arrive in the Cellar, and the stairs bring you back to the Terraces. The camera follows each time.
- [ ] **W6 Emberfall’s plateau has one way up** _(Player · Emberfall)_
  - From the village, walk north-east to the stone plateau and circle it.
  - **Expect:** The only climbable spot is the two-hex step on its west side (around col 19, row 10). Everywhere else is cliff.
- [ ] **W7 The ledge cannot be reached** _(Player · Emberfall)_
  - Find the dirt ledge north of the village (around col 4, row 5).
  - **Expect:** Cliffs on every side; there is no way up.
- [ ] **W8 One Raise is a slope, two are a cliff** _(Editor)_
  - Turn on the Levels and Blocked edges overlays.
  - Raise a patch of flat ground once, then raise part of it a second time.
  - **Expect:** Levels read 1 and 2. Red blocked edges appear only where neighbors differ by two or more; edges one level apart show terraces and no red.

## Chunk 4 — Depth order and picking

The render spike’s question: does everything draw in the right order on cliffs, and does a click land on the hex you meant?

- [ ] **R1 The dummy behind the cliff** _(Player · elevation map)_
  - Open `?fixture=elevation&focus=8,2&zoom=1.7`.
  - **Expect:** The figure north of the plateau stands behind it: the plateau is drawn over it where it should be, and its feet are on the ground.
- [ ] **R2 Behind and in front of cliffs** _(Player)_
  - Walk along the north side of a plateau, then along its south rim on top.
  - **Expect:** Behind, the cliff covers the hero (a tinted silhouette shows through, see P5). On the rim, the hero draws over the cliff face below. No flicker between the two.
- [ ] **R3 Feet are never cut by the next row** _(Player)_
  - Walk slowly up and down across hex rows, on flat ground and on slopes.
  - **Expect:** The hero’s feet and legs are never clipped by the hex in front.
- [ ] **R4 Hover and click pick the right hex** _(Player)_
  - Move the mouse over raised hexes, slope bands and cliff faces; read “hover” in the top-left readout. Click a few.
  - **Expect:** The readout names the hex under the cursor, a cliff face picks the hex on top of it, and the outline matches.
- [ ] **R5 Zoom and pan without seams** _(Player)_
  - Mouse wheel from 0.5 to 2 while moving around.
  - **Expect:** No gaps between hexes, no flicker at terrace corners, and cliffs stay attached to their tops.

## Chunk 5 — Movement, sight and click orders

- [ ] **M1 WASD feels right** _(Player)_
  - Run around the village in all eight directions; brush against walls and units.
  - **Expect:** Starts and stops are responsive, diagonals are not faster, and the hero slides along obstacles instead of sticking.
- [ ] **M2 Click to move routes around cliffs** _(Player · Emberfall)_
  - Left-click a hex on top of the plateau while standing in the village.
  - Left-click the unreachable ledge.
  - **Expect:** The hero walks to the step and up; it never tries the cliff. For the ledge, it stops at the closest point it can reach.
- [ ] **M3 Clicking an enemy is an attack order** _(Player · Emberfall)_
  - Left-click the sentry on the plateau from below.
  - **Expect:** The hero paths up the step, closes to range and attacks.
- [ ] **M4 The sentry spots you first** _(Editor playtest)_
  - Press Play; turn on Sight + targets and Brain states.
  - Walk toward the plateau from the south.
  - **Expect:** The sentry targets you from the cliff edge before you reach it, then comes down the step to chase.
- [ ] **M5 Sight overlay from high ground** _(Editor)_
  - Turn on the Sight overlay and select the plateau’s Sentry.
  - **Expect:** Shaded hexes cover the low ground in range, but not the strip right under its own cliff.
- [ ] **M6 Bodies push apart** _(Player)_
  - Lure enemies together, or walk into the elder.
  - **Expect:** Units separate instead of stacking in one spot.

## Chunk 6 — Combat

Controls: J quick slash · K or right mouse heavy thrust · Space dodge · E interact.

- [ ] **C1 Quick slash** _(Player)_
  - Press J next to an enemy.
  - **Expect:** An arc in front of the hero hits enemies inside it and nothing behind; recovery is short.
- [ ] **C2 Heavy thrust** _(Player)_
  - Press K or the right mouse button.
  - **Expect:** A line attack with a longer windup, more damage and more knockback than the slash.
- [ ] **C3 Dodge through a hit** _(Player · Emberfall)_
  - Press Space as the boss slam lands.
  - **Expect:** A quick dash; timed right, the slam does no damage.
- [ ] **C4 The boss telegraphs its slam** _(Player · Emberfall)_
  - Enter the arena east of the village (gate on its west side).
  - **Expect:** “The Ember Warden stirs.” appears. The slam shows a red area on the ground for its whole windup; getting hit throws you back hard with a short freeze (hitstop).
- [ ] **C5 Enrage at half health** _(Player · Emberfall)_
  - Bring the boss below 50% health.
  - **Expect:** “The warden roars!” appears, and it attacks faster with its enraged moves.
- [ ] **C6 Victory** _(Player · Emberfall)_
  - Kill the boss.
  - **Expect:** A VICTORY banner.
- [ ] **C7 Defeat** _(Player · Emberfall)_
  - Let the hero die (lava or the boss).
  - **Expect:** A DEFEAT banner shortly after death.
- [ ] **C8 Lava hurts** _(Player · Emberfall)_
  - Step onto the lava strip at the south of the village.
  - **Expect:** Damage while you stand on it, with the hurt flash and sound.
- [ ] **C9 Talk to the elder** _(Player · Emberfall)_
  - Stand next to the elder and press E.
  - **Expect:** “The plateau sentry sees further than you think.”

## Chunk 7 — Art, feedback and sound

- [ ] **P1 Art bakes in at start** _(Player)_
  - Reload the player and watch the first seconds.
  - **Expect:** Placeholder shapes switch to the textured art within a second or two: grass, dirt, stone, water, rock faces, figures.
- [ ] **P2 Hit feedback** _(Player)_
  - Hit enemies and get hit.
  - **Expect:** A flash on the unit that was hit, particles, and a small screen shake on heavy hits. Clear without being noisy.
- [ ] **P3 Sound** _(Player)_
  - Click into the page first (browsers hold sound until you do).
  - **Expect:** Music loops; the hit, heavy and hurt sounds play; the levels sit well together.
- [ ] **P4 HUD** _(Player)_
  - Take damage; damage an enemy; walk up to the elder.
  - **Expect:** Your health bar (bottom-left) drops; damaged units get a bar overhead; messages show and fade.
- [ ] **P5 Silhouette behind cliffs** _(Player · elevation map)_
  - Walk behind the tall level-3 spire (top-left).
  - **Expect:** A tinted silhouette of the hero shows through the spire.
- [ ] **P6 Facing and animation** _(Player)_
  - Move in every direction; attack; dodge.
  - **Expect:** Units face where they move or aim, and the idle, walk and attack clips play at a sensible speed.

## Chunk 8 — Editor shell and playtest

Keys: B terrain · R raise · L lower · F flatten · G region · P place · V select · [ ] brush size · Ctrl+Z / Ctrl+Shift+Z.

- [ ] **E1 Three panels** _(Editor)_
  - Look at the editor at your usual window size, then a narrower one.
  - **Expect:** The left panel (maps, tools, overlays, warnings, databases), the canvas and the inspector all fit; nothing overlaps.
- [ ] **E2 Terrain brush and sizes** _(Editor)_
  - Press B, pick lava, paint; switch sizes with [ and ].
  - **Expect:** The outline previews 1, 7 or 19 hexes, and one stroke undoes as one step.
- [ ] **E3 Raise, Lower, Flatten** _(Editor)_
  - Make strokes with R and L; then F from a raised hex across flat ground.
  - **Expect:** One level per stroke, stopping at the maximum; Flatten sets the area to the level of the first hex you clicked.
- [ ] **E4 Region brush** _(Editor)_
  - Press G, pick a region, paint; tick Erase and erase part of it.
  - **Expect:** The Regions overlay shows exactly the painted hexes.
- [ ] **E5 Place with facing** _(Editor)_
  - Press P, pick Sentry, click and drag, once on flat ground and once on a slope.
  - **Expect:** It snaps to the ground height, its facing follows the drag, and the inspector shows it.
- [ ] **E6 Select, move, duplicate, delete** _(Editor)_
  - Press V; drag a placement; Ctrl+D; Delete.
  - **Expect:** Each works and each is one undo step.
- [ ] **E7 Undo and redo** _(Editor)_
  - Do a mix of edits, then Ctrl+Z back through all of them and Ctrl+Shift+Z forward.
  - **Expect:** Edits come back in order and the map ends as it was.
- [ ] **E8 Overlays** _(Editor)_
  - Toggle Levels, Blocked edges, Lint, Regions and Sight.
  - **Expect:** Each turns on and off by itself.
- [ ] **E9 Click a warning to focus it** _(Editor)_
  - Click the unreachable-ledge warning.
  - **Expect:** The canvas centers on the ledge at (4, 5).
- [ ] **E10 Autosave** _(Editor)_
  - Make an edit, wait three seconds, reload the page.
  - **Expect:** The edit is still there and the revision in the status bar went up.
- [ ] **E11 Play, then return unchanged** _(Editor playtest)_
  - Press Play; kill the sentry and take some damage; press Stop or Esc.
  - **Expect:** Back in the editor the sentry is still placed, nothing changed, and undo history is intact.
- [ ] **E12 Play from here** _(Editor playtest)_
  - Hover a hex and press Play from here.
  - **Expect:** The hero starts on that hex.
- [ ] **E13 Debug overlays** _(Editor playtest)_
  - Toggle Hex coords + levels, Blocked edges, Hitboxes, Sight + targets, Brain states, Paths.
  - **Expect:** Each draws, and the top-right readout shows tick time, entities and queued events.
- [ ] **E14 Pause, Step, Restart** _(Editor playtest)_
  - Pause; press Step a few times; Restart.
  - **Expect:** Pause freezes, each Step advances one tick, Restart starts the playtest over.
- [ ] **E15 Save repro** _(Editor playtest)_
  - Play for a bit, press Save repro.
  - **Expect:** A `.repro.json` file downloads, named with the revision and tick count.
- [ ] **E16 Placement overrides** _(Editor)_
  - Select a placement; under Overrides press + Add on Health; change it; Apply overrides; then try Revert on another change.
  - **Expect:** Apply is one undo step, Revert discards, and a playtest uses the override.

## Chunk 9 — Database editors, triggers, assets

- [ ] **D1 Save and Cancel** _(Editor · Databases)_
  - Open Attacks; change a number; Cancel. Change it again; Save.
  - **Expect:** Cancel puts the old value back; Save keeps the new one.
- [ ] **D2 Inline validation** _(Editor · Databases)_
  - In Attacks, set a windup to a negative number.
  - **Expect:** An inline message explains it, Save is refused, and the project is untouched.
- [ ] **D3 Attack preview** _(Editor · Attacks)_
  - Edit an attack’s hitbox and timings.
  - **Expect:** The small hex preview and the windup / active / recovery bar update as you type.
- [ ] **D4 Terrain matrix and art pickers** _(Editor · Terrains)_
  - Toggle passability in the matrix; pick top and cliff frames.
  - **Expect:** Changes show in the form; after Save, the map uses them.
- [ ] **D5 Faction grid** _(Editor · Factions)_
  - Change a relation in the N × N grid.
  - **Expect:** Rows act toward columns, and rows and columns show names, not ids.
- [ ] **D6 Archetype components** _(Editor · Archetypes)_
  - Add a component section to an archetype, remove another, Save.
  - **Expect:** Sections appear and disappear, and Save keeps them.
- [ ] **D7 Brains** _(Editor · Brains)_
  - Open the boss brain; read its states and transitions.
  - **Expect:** States are a list; each transition is a row of conditions; edits save.
- [ ] **D8 Preview on the player** _(Editor · Effects / Feedback / Particles)_
  - Edit one, then press ▶ Preview on the player.
  - **Expect:** A playtest shows the draft on the hero without saving it.
- [ ] **D9 Animation set playback** _(Editor · Animation sets)_
  - Switch between clips.
  - **Expect:** Each direction row animates at the clip’s speed.
- [ ] **D10 A new trigger works in play** _(Editor · Triggers on Emberfall)_
  - Add a trigger: when the player enters the Village region, show a message. Save, Play, walk into the village.
  - **Expect:** Your message appears.
- [ ] **D11 Asset panel** _(Editor · Assets)_
  - Import an SVG, a PNG and a sound (try files, a folder and a zip). Group SVGs into an atlas and Bake. Try to remove an asset that is in use.
  - **Expect:** Each shows a preview; Bake writes the atlas back; removing an asset in use is refused.
- [ ] **D12 Nothing breaks references** _(Editor · Databases / Settings)_
  - Delete a terrain or attack that is in use. In Settings, set the max level below the map’s highest level.
  - **Expect:** Both are refused with a message that says why.
- [ ] **D13 Edits reach the game** _(Editor)_
  - Raise the hero’s slash damage, Save, Play.
  - **Expect:** Enemies go down faster.

## Your call — Known limits to judge

These are known and logged. Pass means acceptable for now; Fail means it should be fixed before Phase 6.

- [ ] **K1 The silhouette also tints the visible part** _(Player · D151)_
  - During P5, look at the part of the hero that is not behind the spire.
  - **Expect:** It is lightly tinted too. Acceptable for now?
- [ ] **K2 Flashes are tints, not outlines** _(Player · D152)_
  - During P2, look at the hit flash.
  - **Expect:** The flash tints the whole sprite. Acceptable for now?
- [ ] **K3 Slopes do not slow paths** _(Player · D199)_
  - Click-move across a field with some slopes.
  - **Expect:** Paths go over slopes as freely as flat ground. Should they prefer flat ground, as in Catlike’s tutorial?
- [ ] **K4 Wide sprites can clip at the feet** _(Player · spike README)_
  - Watch the boss and any wide figure near row edges.
  - **Expect:** Art wider than its collider may lose a sliver at the feet. Acceptable with today’s art?
- [ ] **K5 Editor first load** _(Editor)_
  - Hard-reload the editor and time how long it takes.
  - **Expect:** It is one 900 KB bundle without code splitting. Fast enough for now?
