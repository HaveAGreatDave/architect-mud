# The Leviathan Flying Base — Walkable MUD Cabin on a Flying Aircraft

## Context
Make the **Leviathan** a walkable, ownable, customizable **flying base**: real MUD zones you walk with
`n/s/e/w` while the plane flies, flyable by the owner/a player *or* an optional NPC pilot, with everyone
aboard roaming the cabin, using storage, and looking out the windows. Owning one turns it into a mobile
home base you can park anywhere in the world. Built in phases; this doc is the design + cost spec.

**North star: a persistent, living third-place (2b).** The end-goal is a base others can board and walk
*while the owner is offline* — a place in the world, not just a vehicle. We get there phase by phase, on a
foundation (2a) that carries the whole way, so the priciest slice (2b) is committed last, with data.

**The through-line:** the codebase already prefers *"static git-owned shell + per-entity runtime overlay"*
(occupants are player state, the cockpit is synthesized, NPC outfits are overlays). This feature is that
pattern applied to a room — which is exactly why it stays cheap and never breaks the git-owned-content rule.

## Design decisions (all locked)
- **Pilot control = flight-deck verbs.** Walk to the cockpit zone; `take controls` → the existing flight
  sim; `hand off` → an NPC pilot. Mirrors "take the helm" on the Echelon.
- **NPC pilot optional (both/neither).** Hire a persistent crew pilot who lives aboard, summon one
  on-demand per trip, or fly with none. No player at the controls + no pilot aboard ⇒ it doesn't fly (parked).
- **Access = open to anyone.** Anyone who reaches it can board and roam. The *space* is public; **stored
  gear lives in owner-locked containers** (the security boundary is the locker, not the room). Piloting +
  course stay owner-gated at the flight deck.
- **Destination (NPC-flown) = chart a course from the flight deck.** A NAV console picks any airfield,
  reusing the yacht's `chartCourse`/`sailto` A\* pattern.
- **Offline persistence — north star is 2b, on-ramp is 2a.** The **end-goal is 2b "persistent hangout":** the
  base is a place others can board and walk *while the owner is offline* — a real, living third-place in the
  world. We reach it in two commits: **2a "persistent landmark" ships first** (owner logs off → base parks in
  place at its last position, a visible world landmark; the walkable interior is live only when the owner is
  online), and **2b layers on top of it with zero rework** (2a's park/gangway/landmark are all load-bearing
  for 2b). 2b is *not* deferred-and-maybe — it's the destination; it's scheduled last because its cost is
  build-effort + a permanent moderation surface (see Persistence), not DB/server (which is cheap either way).
- **Capacity = seats + standing room.** ~6 seated (flight roles) + ~10 standing, so it works as a real
  party/hangout. One small new "standing capacity" concept over the type's seat count.
- **Stakes = insurable.** Reuse Halcyon hull insurance: a covered write-off returns the base **+ its
  storage**; uninsured is a genuine loss. No new system.
- **Acquisition = very expensive dealer buy.** Top-tier price, pure credit wall, no other gate. The sky-high
  price is what keeps the owned-instance count **bounded** — which is what keeps the DB/memory cost low.

## Why it's feasible (already-built substrate)
- **Charters already are server-authoritative NPC flight.** `plugins/flight/charter.js` boards a
  `charter_pilot` NPC as a real occupant and ticks the *real* grid position every 2.5 s (`charterTick`,
  `stepToward`). Passengers already get a live moving-world **CABIN WINDOW** view (`mountPassenger`,
  `cockpit.js:591`) fed by `mapWindow(a)` in `pushHud`/`gaugePayload` (`state.js:722-766`).
- **Non-pilot occupants get the moving window whether NPC- OR player-flown** — player-flown craft stream
  telemetry (`cmdFlightSync` → `reconcile`, `state.js:820`) which re-pushes the HUD to occupants. So
  "player flies while others walk around" reuses the same feed, no new sim.
- **The Echelon proves coordinate-free walkable interiors on a moving vehicle** + a mannable station +
  A\* course charting + a runtime boarding gangway (`plugins/yacht/index.js`: `chartCourse:334`,
  `startPassage:537`, `cmdHelmConsole:700`, `dockTo`/`undockAll:379`). See [systems-helm.md](../systems-helm.md).
- **Multi-occupant + pilot/passenger split already work** (`liveAircraft.occupants` Set, `player.seat`,
  `pilotOf` `index.js:182`). **Interior-zone authoring** (`scripts/add-ensuite-bathroom.mjs`), **shared
  storage vaults** (chem-lab / vendor-safe furniture), **lighting** (`scripts/add-shop-lighting.mjs`),
  **auto-land recovery** (`autoReturn(live)`, `index.js:935`), and **hull insurance** (Halcyon) all exist.

## Core mechanic (shared by every phase)
The cabin is **coordinate-free interior zones (the Echelon trick)** — a static git-owned shell on a
dedicated map, bound to the *live* aircraft. On board, the occupant's `current_zone` goes INTO the cabin
(walk it freely); the door/`out` exit is **sealed at altitude** and opens on landing (Echelon
`zone_exit_overrides` gangway pattern). Because the interior is coordinate-free, the plane's grid position
advancing underneath is a non-issue. Per-aircraft privacy comes free from the **existing in-memory occupant
Set** — who you see is scoped to *your* aircraft, so two owners in the same shell template never collide,
with **zero runtime zone rows**.

Engine seams to change: `charter.js:386` embark (→ move into cabin, don't posture-freeze); `index.js:1079`
move gate (allow *intra-cabin* movement, keep world exits sealed airborne); door seal/unseal on
takeoff/touchdown; the `liveAircraft ↔ interior` binding; flight-deck `take controls`/`hand off` + NAV verbs.

## Data model (the part that keeps it cheap)
Everything per-owner rides the aircraft's existing `custom_data` jsonb (already holds `livery`, `loadout`,
`surfaces`, `operator`) — **no new column, no new table, no zone write.**

```jsonc
custom_data: {
  "livery":  { "base": "#2b3a52", "trim": "#c8a24a", "cabin": "#1a1410" },   // Degree-2 tint (reused)
  "home": {
    "name": "The Wandering Home", "tagline": "wheels-up since '71",          // Degree 1
    "welcome": "Mind the low bulkhead. Coffee's in the galley.",
    "rooms":  { "zone_leviathan_cabin": "The Parlor" },                       // per-room label overrides
    "slots":  { "lounge_corner": "decor_leather_sofa",                        // Degree 3: anchor → catalog id
                "strongbox": "decor_deck_locker" }
  }
}
```

- **Zone shell (git, immutable):** the cabin rooms declare fillable anchors in `flags.home_slots`
  (`[{ id, kind, label }]`) — e.g. `{ "id":"strongbox", "kind":"storage", "label":"the deck locker" }`.
- **Decor catalog (git content, immutable, shared):** new lightweight `decor` content class — one
  `content/decor/decor_*.json` per entry (`{ id, name, kind, price, fragment, function? }`). No `function` =
  flavor; a `function` points at an existing seam (`rest` → Solenne `rest_multiplier`, `storage` → vault
  furniture, `light` → fixture). **The only new content-registry class this whole feature needs.**
- **Storage = item rows keyed by `aircraft_id`** (inventory tier, firewalled from the content pipeline like
  inventory already is). Placing `decor_deck_locker` in the `strongbox` slot *is* how you get your locker;
  its `owner_locked` function is the security boundary.
- **Render:** honor a slot fill only if `slot.id ∈ zone.home_slots` **and** `catalog[fill].kind ===
  slot.kind` **and** the id is real → inject `fragment` into the room text + wire any `function`. The git
  shell is the contract; the overlay can only fill within it.

**Customization ceiling:** Degrees 1–3 (name/text, palette, slot-fills) are in scope. **Free furniture
placement (Degree 4)** and **structural edits — add/remove rooms, rewire exits (Degree 5)** are OUT: the
latter *is* mutating zone content. Bigger base ⇒ a different, bigger authored aircraft, never a mutated one.

## Persistence, disconnect & lifecycle
- **DB/server cost at rest is free and identical to "just parking."** An offline base = one parked, empty,
  **idle-gated** aircraft row on existing columns (`grid_x/grid_y`, `parked_zone_id`). Nothing resident, no
  ticks, no queries. Occupied+flying costs exactly what any flown plane costs today (already idle-gated).
- **Disconnect today (verified):** the flight plugin does **not** listen for `player.logout`. A pilot who
  drops leaves the craft **frozen in place, burning fuel, with ghost occupants**, until an unattended sweep
  calls `autoReturn(live)` after **10 min** and lands it at the nearest field (`index.js:930-958, 935`).
- **2a's added build (over the free baseline):**
  1. **Park-in-place on owner logoff** — a `player.logout` hook that sets the base down at its *current*
     tile (NOT `autoReturn`, which flies it to a field — that's option-1 behavior we're deliberately not using).
  2. **Runtime boarding gangway** at an arbitrary tile — direct reuse of the Echelon `zone_exit_overrides`
     (wire an exit from the adjacent ground zone into the flight deck when parked; tear down on departure).
  3. **Landability check** — "is this a tile you can set a base down next to / with a standable ground zone."
  4. **Ghost-occupant prune** on the logout hook (a crowd surfaces the existing stale-occupant quirk).
  5. **Minimap landmark** — show the parked base to others (aircraft already render as contacts; extend to
     grounded-visible; mostly presentation).
- **Server-restart mid-air** reloads the craft still `airborne` at last-persisted position (~12s cadence);
  a hangar "flush" tool already handles this — for a base, make restart-recovery automatic. Minor.
- **2b's added cost (the north-star upgrade, over 2a):** decoupling the base's aliveness from the owner's
  session. It needs a **new on-demand liveness lifecycle** (spin the live instance up when a guest boards an
  owner-absent base, evict when the last one leaves), **occupant persistence / restart recovery** (so guests
  aren't dumped on a restart), an **owner-rejoin handoff** (owner logs back into a guest-spun instance), and a
  **moderation surface** (kick/ban/visibility for strangers in your space). Est. **~2–3 weeks** on top of 2a,
  plus a permanent complexity/moderation tax. **DB/server cost is NOT the blocker** — verified cheap: bounded
  by the price-walled Leviathan count, no hot-path queries, per-instance ≈ a small occupied zone (cheaper than
  one plane aloft), dwarfed by existing standing systems (power/weather/NPC-AI). The only new DB write is an
  optional small occupancy table (board/leave, user-action-rate) for restart-safety.

## Phased roadmap
1. **Walkable cabin, NPC-flown (MVP, ~1 wk).** Authored singleton Leviathan cabin (flight-deck w/ NPC
   visibly flying via `paintPaxControls`, main cabin, galley, window rows, cargo hold; `is_interior`,
   `always_lit`). Board → walk → look out windows → deplane on landing. Proves cabin binding, move-gate
   relaxation, sealed-door, window view, deplane.
2. **Player flies while others walk + flight-deck control (~few days).** `take controls`/`hand off` + NAV
   course console (`chartCourse` reuse). Largely falls out of Phase 1.
3. **Owned base + 2a (the 2b on-ramp) (~1 wk + the 2a bits).** Very-expensive dealer buy; standing-room
   capacity; Halcyon-insurable; storage locker keyed to `aircraft_id`; **2a persistent-landmark** —
   park-in-place logoff + runtime gangway + landability + minimap landmark. Everything here is load-bearing
   for Phase 5.
4. **Customization Degrees 1–3 + decor catalog (~few days).** `custom_data.home` overlay; the `decor`
   content class; name/palette/slot-fill UI at the flight deck.
5. **2b — persistent hangout (the north star) (~2–3 wk).** Decouple aliveness from the owner's session:
   on-demand liveness lifecycle (spin-up-on-board / evict-when-empty), occupant persistence + restart
   recovery, owner-rejoin handoff, and moderation tooling (kick/ban/visibility). Turns the parked landmark
   into a place people walk into while you sleep. Scheduled last on purpose — build it once the earlier phases
   have proven players covet a base and want to visit each other's; it's the priciest, least-certain slice,
   and 2a already carries it.

## Costs summary
- **DB storage:** negligible (a few small `custom_data` blobs + item rows; bounded by the price wall).
- **Runtime/CPU at rest:** free (parked idle-gated rows). No per-move/per-tick DB cost — coordinate-free
  interior + reused ticks/feeds.
- **Only new infra:** the `decor` content-registry class. No new columns, no new tables, no runtime zones.
- **Build cost, one-time:** ~1 wk (Phase 1) + a few days each (2, 4) + ~1 wk incl. the 2a park/gangway
  bits (3). The 2a delta over the free "lands at a field on logoff" baseline is ~2–3 days.
- **2b (Phase 5) is the expensive slice:** ~2–3 wk of a new liveness/persistence subsystem + a permanent
  moderation tax — but its **DB/server cost is cheap** (bounded, no hot-path queries). 2b's price is *build
  effort + moderation*, not compute. Sequenced last so it's committed with data, not faith; zero rework over 2a.

## Files this touches
- **Content:** `content/zones/zone_leviathan_*` (cabin, on `map_aircraft_leviathan`) with `flags.home_slots`;
  `content/decor/decor_*`; a light-fixture furniture row. **Registry:** add `decor` class to
  `server/models/content-registry.js`.
- `plugins/flight/charter.js` — embark → cabin zone; touchdown → open door + deplane; live charter ↔ cabin link.
- `plugins/flight/index.js` — intra-cabin move-gate (~`:1079`); door seal/unseal; flight-deck
  `take controls`/`hand off`; `player.logout` hook (park-in-place + ghost prune); decor slot verbs.
- `plugins/flight/state.js` — cabin binding hooks; standing-room capacity; `mapWindow`/occupant feed already there.
- `client/game/js/panels/cockpit.js` — `window` view from a cabin room (reuse `mountPassenger`/`paintWindshield`).
- **Reuse:** `plugins/yacht/index.js` (`zone_exit_overrides` gangway + `chartCourse`), `add-ensuite-bathroom.mjs`
  (zone stamping), `add-shop-lighting.mjs` (lighting), chem-lab/vendor-safe vault furniture (storage),
  `autoReturn` (recovery), Halcyon insurance.

## Verification (per phase)
- **P1:** board an NPC-flown Leviathan → `look` shows a real cabin room; `n/s/e/w` walks between rooms; door
  sealed while airborne; grid position advances; window shows motion; touchdown opens the door + deplanes.
- **P3:** park anywhere → base persists as a landmark; owner logoff sets it down in place (not flown to a
  field); board it off-field via the gangway; storage is owner-locked; shootdown while insured returns base + gear.
- `npm run test:regress` green (flight + move-gate) + new `plugins/flight/regress.js` cases: intra-cabin
  movement, sealed-door-at-altitude, park-in-place-on-logout, owner-locked storage access.

## Out of scope (permanently)
*(2b is NOT here — it's the north star, scheduled as Phase 5.)*
- **Degree-4 free furniture placement** and **Degree-5 structural edits** — the latter breaks git-owned zones.
- **Per-owner *runtime instanced zones*** — explicitly avoided; per-aircraft privacy comes from the
  in-memory occupant Set on a shared authored shell, so no runtime zones are ever written (holds for 2b too).

## Status
Design/spec locked; **no code written yet.** North star = 2b (Phase 5); Phase 1 is the first slice when we
start, and every phase is load-bearing toward 2b with zero rework.
