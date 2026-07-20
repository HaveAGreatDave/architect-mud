# Flight — Unified Authoritative Model

> Status: **In progress.** Ships 1–2 built & deployed; Ship 3 (optional vocab tidy) pending.
> This is the plan + implementation log for collapsing flight onto a single,
> server-authoritative model and giving stalls real teeth.
>
> Companion sources:
> - [docs/proposals/flight-overhaul.md](flight-overhaul.md) — the overhaul blueprint that
>   introduced the continuous energy sim + client-sim/server-reconcile authority.
> - [docs/systems-flight.md](../systems-flight.md) — flight **as built**.
> - `client/game/js/panels/flight-model.js` — the continuous energy integrator (the model).
> - `plugins/flight/state.js` (`reconcile`, `stalledState`), `plugins/flight/index.js`
>   (`flightTick`), `plugins/flight/hazards.js` (legacy banded hazards).

## What this is

The flight overhaul already built a real **continuous energy model** and shipped it to
the whole player fleet — but it landed *alongside* the old discrete **banded** model
rather than replacing it. Two dynamics models and one derived compat shim now coexist,
and the stall — beautifully modelled in the sim — has no server consequence. This work
**unifies onto the one model, makes the authority law explicit, and gives stalls teeth.**

It is **not** a physics rewrite (the integrator is done and good), **not** a schema or
content change, and it adds **no new DB queries** — it's plumbing and math behind an
already-running loop.

## The reality it's fixing (mapped 2026-07-20)

Three flight "modes" coexist today:

| Mode | Who flies it | Dynamics | Stall |
|---|---|---|---|
| **Continuous energy** | all 8 player airframes (`CONTINUOUS_TYPES`) | `flight-model.js` @60fps client → `reconcile()` | real energy stall (client *feel* only) |
| **Scripted charter** | NPC-flown charters | `charter.js` choreography (sets band/airborne directly; the physics tick skips it: `if (live.charter) continue`) | none — it's an animation |
| **Banded legacy** | nothing player-facing | server `advance()` + `rollHazards()` | probabilistic dice-roll + `recover` verb |

- The **banded path is vestigial**: every player-flyable type is in `CONTINUOUS_TYPES`, so
  the legacy branch in `flightTick` and the probabilistic STALL in `hazards.js` no longer
  fire for players. But the code still branches on it.
- `altitude_band` is a **derived compat shim** inside the continuous path — computed from
  altitude in `reconcile()` and read by fuel burn (`BAND_BURN`), combat band-gates
  (`firePass`, gun-pass), and spotting radius. It is *not* going away; it's a cheap read.
- **The stall had no teeth**: `reconcile()` stored `live.cont.stalled` and nothing read it
  for consequence. A modified client could report `stalled:false` and fly the stall regime
  free.

## The single law

> **One integrator. The client computes feel; the server owns consequences. Nothing else
> simulates flight.**

- `flight-model.js` is THE model — the only place airspeed/altitude/attitude/AoA/stall are
  produced. Client-side, 60fps.
- The server is authoritative over **outcomes, not attitude**: position, fuel, damage,
  crash, combat, airspace, contracts. It **validates** the reported energy state against a
  **lenient anti-spoof envelope** and rejects the impossible — it never re-runs physics.
- `charter.js` stays a **scripted overlay**, explicitly *not* the integrator.

## Cost (why this is cheap)

Measured against the read/write tiers in [architecture.md](../architecture.md):

- Server `flightTick` runs every `TICK_MS = 3000`, over the in-memory `liveAircraft` map only.
- Client→server `flight_sync` arrives every 1.2s (cruise) / 0.33s (≤5-tile traffic); each
  `reconcile()` is **pure in-memory**.
- The only DB write is `persist(live)`, throttled to every 4th tick (~1 `UPDATE` / 12s /
  airborne craft). Damage rides that throttle; a crash writes once.

Everything this plan adds is arithmetic on the live object. **Zero new `query()` on any hot
path.** Retiring the banded branch is *net-negative* cost (it deletes a per-tick
`skillCheck`).

## Decisions (locked with the author)

1. **Stall anti-spoof → lenient envelope.** Reject only the clearly-impossible ("not
   stalled" while plainly in the stall regime), with slack for sync lag — matches the
   existing shed-wing clamp. Zero risk of false-snapping a pilot fighting it down.
2. **No `recover` verb.** Recovery is what it already is in the sim — nose down, unload,
   power. More honest to the energy model. The banded `recover` retires with the banded path.

## Ships

### Ship 1 — Stalls with teeth — **SHIPPED `60abfaef`**

Purely additive (reconcile + flightTick + regress), no deletions.

- **`stalledState(type, d)`** (state.js) — the authoritative stall read. Honours the client's
  flag, but the unambiguous **slow + nose-up + sinking** signature reads as stalled whatever a
  modified client claims: `ias < cruise_speed*0.35 && pitch > 3 && vs < -400`. Pure + exported
  so regress pins it. Lenient by construction — sub-stall thresholds + required nose-up + required
  sink, so an honest slow/flapped approach or a recovering pilot (nose down) is never flagged.
  `reconcile()` routes `live.cont.stalled` through it.
- **`flightTick` consequence** — a **sustained** stall (`live.stallTicks >= 2`, ~6s at 3s ticks)
  bleeds `a.damage` (0.05/tick) and can destroy the airframe (`crash(live,'stall')`); a brief
  stall stays free; a stall carried into terrain is the existing emergent crash.
- **regress** — 5 checks pin the lenient envelope (client flag honoured; spoof caught; honest
  slow approach + nose-down recovery + grounded all NOT flagged).

### Ship 2 — Collapse the tick — **SHIPPED**

The audit found all 8 `aircraft_types` are in `CONTINUOUS_TYPES`, so the banded branch (and
`rollHazards`, called only from it) was **completely dead for players** — which meant engine
fire/overheat, bird-strike, weather-buffet and the thermal model had been **dormant** since the
overhaul. Per the author's call, those hazards were **ported into the continuous tick** before the
deletion, rather than dropped.

- **Ported to the continuous `flightTick`:** the thermal model (engine temp tracks throttle +
  cold-start bias — without it a continuous craft never runs hot, so overheat→fire could never
  arm) and `rollHazards(live)` (cold-start fire, weather buffeting, bird strike, overheat fire,
  and FIRE escalation). Fire/weather/birds are live for players again.
- **Deleted:** the banded `advance()` branch in `flightTick`; `rollHazards()`'s probabilistic
  STALL + the band-stepping escalation; the `recover` verb (unregistered from `plugin.json` +
  `commands`). Orphaned imports cleaned (`advance` in index.js, `BAND_LABEL` in hazards.js). A
  non-continuous airborne craft now falls through to a no-op with an explanatory comment.
- **Deferred (judgment call):** the `flightMode(live)` rename. `isContinuous()` is correct and
  widely read; renaming it across combat/contracts/index is churn with regression risk and no
  behaviour change — left for a later dedicated cleanup if ever wanted.
- **regress:** the 5 stall checks (Ship 1) + a **safety net** asserting every `aircraft_type` is
  in `CONTINUOUS_TYPES` (nothing can silently fall onto the deleted banded model). Also swapped the
  now-dead `recover` gate test for `extinguish`.
- Client: the warn-strip label `STALL — RECOVER` → `STALL — NOSE DOWN` (no verb to reference).
- Ran the source-of-truth sweep for lingering `recover`/`STALL`-hazard references (client + server).

### Ship 3 — Vocabulary tidy — **OPTIONAL**

- Single `band()` helper deriving `altitude_band` from `live.cont.altitude` for its handful of
  consumers. **Leave the DB column** as-is; do not rename. Scope-limited on purpose.

## Risks / notes

- **`altitude_band` stays.** The unified model is about *dynamics + authority*, not the altitude
  vocabulary. Ripping the column out is a separate, scope-creepy change and is explicitly out of
  scope.
- **Single writer of `live.cont.stalled`** is `reconcile()`. `charter.js` sets `stalled:false` on
  its *own* chase-readout object, not `live.cont`, and charters are skipped by the physics tick —
  so no double-source. Preserve that when adding `flightMode()`.
- **Stall damage is forgiving** by design: grace window + modest accrual, so normal flying and
  brief stalls cost nothing; the primary killer remains terrain impact. Tuning is a pure by-ear pass.
