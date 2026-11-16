# LoreBrix — Feature Documentation

> **Historical — describes shipped v0.6.0.** The *LoreEngine Foundation — Phases 1–5* (formerly the LoreBrix Foundation Rewrite) (16 Nov 2026) replaces this architecture greenfield: a headless runtime with the editor as a client, composition instead of the entity class hierarchy, schema v2, hex-iso with cliff levels. Only the hex math, A\*, and spatial hash carry over, with their tests. Keep this file as the record of what v0.6.0 was.


**Version:** 0.5 (Editor MVP · Phases 1–5 complete)
**Owner:** ELMSCORP
**Status:** Build-verified, runnable, awaiting UI polish pass
**Purpose of this doc:** A complete map of what LoreBrix does today — for onboarding, design handoff, and marketing reference. Two audiences use the app: **Creators** (people building games) and **Players** (people playing finished games via Play Test). Features are grouped and labeled accordingly.

---

## What LoreBrix is

LoreBrix is a browser-based RPG creation engine. A creator can paint a world, populate it with characters, design a battle system visually, and press Play to walk around inside the result — all without writing code. Games save as a single portable file. It supports both classic square-tile 2D maps and hexagonal-isometric maps in one tool.

The app opens with a fully playable starter project (**Emberfall**) generated in code, so there is something alive to click the moment it loads.

---

## Part 1 — Creator Features

### 1.1 Map painting

The core loop of world-building. A creator selects a tile from the tileset panel and drags across the canvas to lay down terrain — grass, dirt, stone, water, and so on. Painting works identically on square-grid and hexagonal-isometric maps; the engine handles the coordinate math underneath. A single drag lays a continuous stroke of tiles.

### 1.2 Flood fill

The bucket tool fills a whole connected region of matching tiles in one click, instead of painting cell by cell. Filling a lake, a field, or a stone floor becomes instant. Works on both grid types (4-connected on square maps, 6-connected on hex).

### 1.3 Layer system

Every map is built from stacked layers with defined roles: **background** (the ground), **midground** (objects at character level), **foreground** (things that render *over* the character, like a tree canopy they walk behind), and **collision** (invisible walls). Creators can add, delete, rename (double-click), reorder (drag), hide, and lock layers. Locking prevents accidental edits to a finished layer — a small feature that saves real frustration.

### 1.4 Terrain behavior

Tiles carry gameplay meaning, not just appearance. A creator tags cells as **water** (blocks walking, allows swimming/flying), **lava** (walkable but deals damage on entry and while standing on it), or **mud** (walkable but slows movement / raises pathfinding cost). This is the bridge between "a painting" and "a game rule."

### 1.5 Asset import

- **Tilesets:** drag-drop an image (or use the import button); LoreBrix auto-slices it into a grid based on the tile dimensions the creator specifies.
- **Spritesheets:** import a character sheet, specify frame size, and it's ready to animate.
- **Audio:** import BGM/SFX files (stored and referenced by triggers; playback is post-MVP — see Known Limits).

All imported assets embed into the project file as data URLs, keeping each saved game fully self-contained and portable.

### 1.6 Animation definition

For any spritesheet, the creator defines named animation clips — which frame indices play, at what FPS, and whether they loop. This turns a static sheet into a moving character. The engine expects a canonical set of clip names for combat-capable sprites (idle, walk-up/down/left/right, attack, hurt, death), and the panel guides toward them.

### 1.7 Entity placement

In Entity mode, the creator clicks to place:
- **Player start point** — where the hero spawns.
- **NPCs** — characters with stats, behavior, and optional dialogue.
- **Props** — interactable or collidable objects like chests and signs.
- **Doodads** — purely decorative scenery like bushes and rocks.

Entities are placed from reusable templates; placing one deep-copies the template, so later edits to a template never silently mutate already-placed instances.

### 1.8 Doodad scatter tool

Instead of placing decorative objects one at a time, the scatter tool stamps a whole cluster with a single click — configurable radius and count, with each instance randomly offset and phase-shifted so foliage looks natural rather than grid-aligned. A whole scatter stroke shares a group ID so it can be undone or removed together. (This is the Warcraft 3 World Editor–style workflow from the original brief.)

### 1.9 NPC patrol routes

The creator selects an NPC, enters waypoint-recording mode, and clicks cells to define a walking path. Patrols run in **loop**, **ping-pong**, or **once** modes, with a configurable pause at each waypoint. The path renders on the canvas as a dashed line with dots while editing.

### 1.10 Visual damage-formula editor

A node-based canvas where the creator wires up combat math by dragging boxes and connecting ports — stat nodes (attacker ATK, defender DEF), constants, operators (add, subtract, multiply, divide, min, max), and random-range nodes. A **live preview** shows the resulting damage number against sample stats and updates as the graph changes. No code, no spreadsheet — the formula the creator sees in preview is the exact one the game runs.

### 1.11 Game mode selection

A toggle switches the whole project between two combat paradigms, each with its own config panel:
- **Turn-Based RPG:** turn order (speed/fixed/random), action points per turn, the damage-formula editor, status effects (Poison, Burn, Stun, etc., with duration, tick damage, and stat modifiers), and win/lose conditions.
- **Action RPG:** hit detection shape (circle/rectangle/pixel), cooldown system (global or per-skill), combo chains, knockback physics, and invincibility frames.

Both configurations are held in memory while editing — switching modes loses nothing; only the active mode is saved into the project.

### 1.12 Visual NPC behavior machines

A state-machine builder where the creator drags connections between behavior states (idle, patrol, chase, attack, flee, interact) and sets the condition that triggers each transition — distance to player, HP threshold, or line of sight. Clicking a state toggles it into or out of the machine; a star marks the initial state. Machines attach to NPCs by reference, so one "brain" can drive many characters. This is AI design without logic code.

### 1.13 Event triggers

Zone-based triggers fire on player **enter**, **exit**, or **interact**. Each trigger runs an ordered list of actions: play cutscene, spawn enemy, open shop, change BGM, teleport player, or run a custom script hook. Triggers can be set to fire once or every time. This is how a creator scripts the memorable *moments* of a game.

### 1.14 Multiple maps

A project holds many maps of either type. The creator switches the active map from the top bar and can create new ones (square or hex, any size up to 128×128) via a modal. The starter project ships with a square meadow and a hex cavern to demonstrate both.

### 1.15 Save, load, export

- **Save:** the whole project downloads as one portable `.lorebrix.json` file (schema-versioned).
- **Load:** reopen a project file; the schema version is validated on load.
- **Export PNG:** render the current map to an image.
- **Export Markdown:** generate a text summary of the project (maps, rules, behaviors, asset counts).

### 1.16 Undo / redo

Editor actions are snapshot-based and reversible (Ctrl+Z / Ctrl+Shift+Z), with a capped history. Play Test is excluded from the undo stack by design.

---

## Part 2 — Player Features (Play Test mode)

### 2.1 Enter and exit safely

One button drops the creator into their own game as a playable character. On entry, the project is deep-snapshotted; on exit, that snapshot is restored exactly. Nothing done while playing can corrupt the game being built — testing is always safe.

### 2.2 Movement

WASD or arrow keys on square maps; a six-direction Q/E/A/D/Z/C scheme on hex maps (with WASD aliased for comfort). The character is blocked by collision and impassable terrain, and slowed by high-cost terrain like mud. Movement is grid-logical but renders as smooth gliding between cells.

### 2.3 Dialogue

Walking up to an NPC and pressing Space opens its dialogue tree, including branching choice nodes where the player picks a response and the conversation reacts. Choices can carry actions (e.g. opening a shop).

### 2.4 Combat

Pressing the attack key resolves damage through the creator's configured rules:
- **Turn-based:** an ATB (active-time battle) bar charges from the player's Speed stat; when full, an attack strikes the nearest enemy in reach using the node-formula damage.
- **Action:** real-time swings with cooldowns, combo scaling (each chained hit adds damage), knockback, and invincibility frames. A hitbox flash shows the strike area.

Enemies chase, attack, and deal contact damage driven by their behavior machines.

### 2.5 Environmental danger

Terrain hazards are live in play: stepping into lava deals entry damage and continues ticking while the player stands in it. The player's HP bar is real and consequential.

### 2.6 Triggered events

Crossing into trigger zones fires the creator's scripted events in real time — a line of dialogue, an ambush spawn, a music change, a teleport — exactly as authored.

### 2.7 Win / lose and restart

Meeting a win condition (e.g. all enemies defeated) shows a Victory screen; a lose condition (player defeated) shows Defeat. From either, the player can restart the test instantly or return to the editor to iterate.

### 2.8 Heads-up display

A HUD shows the player's HP, the ATB or cooldown/combo state, a short event log of recent happenings, and a control reminder appropriate to the map type.

---

## Part 3 — Cross-cutting qualities

- **No-code throughout.** World, characters, combat math, AI, story beats, and win conditions are all authored visually. A complete playable RPG can be built without writing code.
- **One file, fully portable.** A saved game embeds its own assets; there are no loose files to manage or lose.
- **Two geometries, one tool.** Square and hex-isometric maps are first-class and interchangeable within a project.
- **Runs entirely in the browser.** No install, no backend required for the editor MVP.
- **Preview equals reality.** The damage the creator previews in the formula editor is computed by the same function the game runs at playtime.

---

## Part 4 — Known limits (v1, honest)

These are deliberate MVP boundaries, documented so nobody is surprised:

- **Audio playback** is not yet wired; audio imports are stored and `change-bgm` actions log the intended track rather than playing it.
- **Cross-map teleport during play** logs a note instead of switching maps mid-session (in-map teleport works).
- **Dialogue authoring** runs fully in play but is currently edited via the saved JSON, not yet a visual tree editor.
- **Win/lose conditions** enforce the two core types (all-enemies-defeated, player-defeated); the remaining condition types are authored-but-dormant.
- **The LoreBrix platform layer** — accounts, publishing, discovery (the Roblox/Steam-style vision) — is intentionally post-MVP. The project schema reserves space for it (`ProjectMeta.publishing`) so it can arrive without a data migration.

---

## Part 5 — Notes for the UI polish pass

The current interface is a functional dark-slate editor: a three-panel layout (left asset browser, center canvas with a tool rail, right context panel), a top command bar, and a bottom status bar. It is intentionally utilitarian — every control is wired to real behavior, and this doc's Part 1 and Part 2 enumerate what each surface does.

For the polish pass:
- **All styling is Tailwind utility classes**, with a small number of inline styles reserved strictly for dynamic geometry (canvas overlays, formula-node positions, tileset thumbnail offsets). These inline styles are computed from data and should be left intact.
- **Game logic lives in the engine modules, never in component styles** — the interface can be restyled freely without affecting how any game rule behaves.
- **Signature-moment opportunities** worth considering: the canvas as the visual hero, the Play button / mode transition, the formula-node editor (a natural showpiece), and the playtest HUD.
- The functional structure in Parts 1–2 is the contract; the visual language is open.

---

*LoreBrix v0.5 · built phase by phase · schema v1 · ELMSCORP*
