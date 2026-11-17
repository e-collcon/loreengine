# Editor — review screenshots (chunks 8 and 9)

The editor (spec section 8) running its production build in headless Chromium at device pixel ratio 2, on a fresh Emberfall. The art is the fixtures' placeholder SVGs, baked once by the editor and lent to the canvas and every playtest (DECISIONS N9, D162).

| File | What to look at |
|---|---|
| `01-editor-overview.png` | The three panels (§8.4): maps, tool options, overlays, the lint warning for Emberfall's broken ramp (click it to focus), the databases (chunk 9); the map canvas; the inspector with the placements list. |
| `02-tools-raise-ramp-paint-place.png` | One stroke each of Raise, Ramp, Terrain (lava) and Place, with the Levels overlay: the raised block shows cliff faces and red blocked edges, the ramp reads `0↗2`, the new Sentry is selected with its facing tick. Each stroke is one undo step. |
| `03-sight-overlay-sentry.png` | Emberfall's plateau Sentry selected: the cells it can see are tinted. From the plateau it sees across the low ground, but not the strip right under its own cliff (the high-ground rule of §7.6, through the same `castTerrain` the game uses). |
| `04-playtest-debug-overlays.png` | Play from here beside the boss: the playtest overlay with its debug layer. The Ember Warden is in its `fight` state winding up the slam (the telegraph and the hitbox outline on the ground); the green line is its sight line to its target. Pause, Step, Restart and Save repro are on the bar; the readout shows tick time, entities and the event queue. |

### Chunk 9: database editors (§8.6)

| File | What to look at |
|---|---|
| `05-database-attacks.png` | The list-and-form pattern. The form is generated from the schema; above it, the hitbox drawn on a small hex grid and the windup / active / recovery bar. Save and Cancel at the bottom; edits are staged until Save. |
| `06-database-terrains-matrix.png` | The passability matrix for every terrain at once, then the selected terrain's form with atlas and frame pickers for its top and cliff art. |
| `07-database-factions-grid.png` | The N × N relation grid (row toward column). |
| `08-trigger-editor.png` | A map's triggers: `when` / `given` / `then`, each part a generated form (event, conditions, actions) with pickers for placements, variables and the rest. |
| `09-asset-panel.png` | Imported SVGs, images and sounds with previews; import from files, a folder or a zip; group SVGs into atlases and Bake (pages stored, atlases written back into the project). |
| `10-inspector-overrides.png` | A placement's overrides as component sections (here Health just added), applied as one undo step. |

## Run it

```bash
npm install
```

```bash
npm run dev -w @loreengine/editor
```

Tools: B terrain, R raise, L lower, F flatten, M ramp, G region, P place, V select; `[` `]` brush size; Ctrl+Z / Ctrl+Shift+Z; Delete; Ctrl+D duplicate; right-drag or Space+drag pans; the wheel zooms. Play, or Play from here (the hovered cell); Esc leaves the playtest. The project autosaves to IndexedDB 2 s after the last change. The databases, settings, triggers and assets open from the left panel; "← Map" returns to the canvas.
