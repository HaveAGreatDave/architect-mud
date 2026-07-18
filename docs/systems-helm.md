# Helm & the Echelon Chase View (as built)

The **Helm** is a spectator/chase camera locked behind the Echelon (Cyd's yacht)
as she makes way across Coldwater Basin — boiling wake, bow-wash, charted
courses. It does **not** draw its own scene: it **reuses the flight renderer
wholesale**. The helm hands `paintWindshield` (`windshield.js`) a small open-water
map window centred on the yacht (the centre cell is `mark:'yacht'` carrying a live
`wake` + `heading`), flips on the external orbit camera (`external:true`,
`hideOwnShip:true`), and lets that centre cell be the framed subject. The real sim
weather field is streamed in (`setSky`) so clouds/rain match the flight sim; world
time comes from the shared `environment.js` clock.

## Verbs (`plugins/yacht/index.js` — admin-gated, bridge-only)

Every verb gates on the `echelon_bridge` zone flag.

- **`helm`** (`cmdHelmConsole`) — opens the visual console; a second call closes
  it (`helm close` is the deterministic ✕ exit). Sends `helm_open`.
- **`sail <dir> [bell%]`** (`cmdSail`) — manual one-tile nudge (`SAIL_TILES = 1`),
  stops short of non-water; this is "Get Underway" / cast off. Diagonals require
  both flanking orthogonals be water (no corner-cutting).
- **`sailto <x> <y> [bell%]`** (`cmdSailTo`) — charts an A\* water-only course
  (`chartCourse`) and steams the whole multi-leg path at the stately course pace.
- **`stop`** — the unified stop verb; the yacht plugin consumes the `player.stop`
  event and, for a bridge admin mid-passage, calls `haltEchelon()` ("stop the
  Echelon"). Added in `595cba16`.
- **`dock`** — lowers/retracts the gangway to an adjacent pier.
- **NAV console** — the on-screen chart popup (tap the NAV scope / 🗺) plots a
  course; "GET UNDERWAY" fires `sailto`. The bridge `zone.describeRoom` hook
  injects a clickable **"take the helm"** call-to-action.

## Files

- **Plugin (owner):** `plugins/yacht/index.js` (+ `plugin.json`) — transit state,
  passage timing, gangway docking, A\* course charting; streams `helm_underway` /
  `helm_arrived` / `helm_sky` / `helm_contacts` / `helm_close` / `helm_hold` to
  open viewers (`helmViewers`). Pace: `SAIL_MS_PER_TILE_SLOW/FULL = 2500`,
  `SAIL_MS_PER_TILE_COURSE = 5000`.
- **Console shell:** `client/game/js/panels/helm-mode.js` (`openHelm()`, brass/glass
  dash, telegraph, NAV scope; `isHelmActive()` gates room renders like
  `isFlightSimActive()`). Carries the same chrome pair as the flight sim: **⊟** collapses
  just the scrollback log, **⛶** fullscreens (log + command bar hidden); mutually exclusive.
- **Chase render:** `client/game/js/panels/helm-view.js` (`openHelmChase()` — the
  flight-renderer-reuse controller: wake/wash/knots, orbit cam, `sailT`, boat audio). The
  chase-cam pitch follows the dolly zoom (`pitchForZoom`): side-on near the water, tilting
  top-down as the camera pulls back.
- **Wheel:** `client/game/js/panels/helm-wheel.js`.
- **Renderer (shared with flight):** `windshield.js` (`paintWindshield`,
  `drawYacht`, `YACHT_SCALE`).
- **Dispatch:** `client/game/js/dispatch.js` wires the `helm_*` messages.

## `sailT` and the cast-off freeze fix

`sailT` (in `helm-view.js`) is `0..1` passage progress, **server-authoritative**
(seeded from `transitMs`/`total` so reopening mid-passage resumes correctly). For
a charted course it indexes the path polyline: `f = sailT * segs`, `i = floor(f)`,
interpolating `st.path[i] → st.path[i+1]`.

**The cast-off freeze bug:** `transitEnd` was stamped with `performance.now()` but
the frame's `now` is the rAF vsync timestamp, which can read slightly earlier — so
on the first frame after Get Underway `sailT` went a hair **negative** →
`floor(f) = -1` → `st.path[-1]` undefined → threw and permanently froze the
un-try/caught render loop. Fixed in two layers: `911016dd` wrapped the frame body
in a try/catch + guarded the index; `30501094` fixed it at the root by
**clamping `sailT` to `[0,1]`** (`Math.max(0, …)` is load-bearing), plus
non-finite guards on `f`/`spd`/`heading` (canvas gradients throw on non-finite args).

## Deck-cam landing cinematic (heli → Echelon)

In `client/game/js/panels/cockpit.js`. When the Echelon captures a hovering heli
(`yachtProximity`, `YACHT_CATCH_RADIUS`, `YACHT_CATCH_CEIL_FT = 300`), it hands
the windshield to a deck-cam (`stepDeckLanding`, physics/controls frozen).
`YACHT_SCALE = 0.4` / `DECK_PAD_Z` must stay in sync with windshield's
`YACHT_SCALE`. Three shots:

1. **WIDE** — on-deck camera forward of the pad looking aft, heli flies in over
   open water; the **auto-land guidance holo dome** (`padDome`, armed when
   `F.onYacht`) is shown over the helipad.
2. **DROP** — held low, heli drops the last ~75 ft straight down onto the pad.
3. **HOLD (inspect close-up, `595cba16`)** — camera arcs from dead-ahead to a
   three-quarter broadside and **dollies in** (`extZoom 0.30 → 0.16`, pitch eased
   to eye-level, water-skimming) — a *true* zoom where heli and pad scale together
   — while rotors spin down before hand-off to the hangar. Waterline framing tuned
   in `d1189b60` / `095a7cec`.

## Zones / owner / tablet status

- **`zone_echelon_bridge`** (`map_echelon`): flags `yacht`, `echelon`,
  **`echelon_bridge`** (the flag every helm verb gates on), `is_interior`,
  `always_lit`, `world_exit_zone`.
- **`zone_echelon_exterior`** (tile 897,898 on `map_world`): `yacht`, `echelon`,
  `naval_ambience`, `district:"water"`, `airfield_id:"echelon_helipad"`,
  `charter_vtol_only`, `hangar_interior_zone`. `open_sky` appears only on
  `zone_echelon_helipad` / `zone_echelon_sundeck`. No `venue` flag on any Echelon
  zone.
- **Owner "Cyd"** — code-level owner constant (`OWNER_HANDLE = 'Cyd'`, `isOwner`),
  a real player handle, **not a spawned NPC** (Cyd exists as poster/item content).
  On-deck NPCs are the charter pilot **Wren Halloran** and two dancers. See
  [[reference_cyd_owner]].
- **Standalone tablet Helm mount:** **pending / does not exist.** The helm takes
  over the **area pane** (like the flight sim), not a Tablet OS app. The only
  standalone surface is the dev harness `client/game/helm-chase-test.html`
  (`window.__helmCtrl` dev pose handle).
