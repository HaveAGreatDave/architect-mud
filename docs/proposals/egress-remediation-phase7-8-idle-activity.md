# Egress Remediation — Phases 7 & 8: Idle-Activity Gating

> **Status: SHIPPED, and generalised past what this doc proposed** (stamped 2026-07-24 by
> doc audit — this doc had no status line). `hasActivePlayers()` exists
> (`server/engine/world.js:1013`) and has ~25 call sites, but the live law is stronger than
> the per-tick gating designed here: `server/engine/scheduler.js:56-60` idle-gates **every**
> registered callback by default, with `{ runWhenEmpty: true }` as the deliberate opt-out.
> Read scheduler.js, not this doc, for how idle-gating works now.

> Part of a larger DB-egress remediation program (see
> `docs/proposals/egress-remediation-phase4b-cameras.md` for the same
> `tick != save` framing applied to power/cameras/spawns/player resources —
> that doc covers Phases 1-6). This file covers Phase 7 (gating several ticks
> on player activity/room-content change instead of elapsed time) and Phase 8
> (a follow-on weather/ambient-tick audit that surfaced one more concrete bug).
> Self-contained; doesn't require reading the Phase 1-6 doc first.

## The concern that started Phase 7

Even after diff-gating writes (Phases 1, 4, 6), several ticks still *fire* and
do work — including DB reads — on a fixed schedule regardless of whether the
server has any players connected at all: power ticks, camera buffer capture,
spawn queries, resource-tick saves. The question: can these be gated on actual
activity instead of elapsed time, without losing anything real (e.g. an
accurate record of NPC-only activity while no players are online)?

**Shared primitive for all of Phase 7:** add `hasActivePlayers()` to
`server/engine/world.js` — `world.players.size > 0` (a `Map`, already
populated at login via `setLivePlayer`, cleared at logout via
`removeLivePlayer`). O(1) check, no new state to maintain.

---

## Phase 7a — Camera capture: content-diff, not player-presence

**Important correction from the first draft of this idea:** a blanket "skip
capture while no players online" gate was considered and rejected, because it
would stop recording NPC-only activity — and the explicit requirement is that
recorded footage stay an accurate reflection of the room *even when nobody's
watching*. Player-presence is the wrong gate for this one.

**Actual fix:** gate on whether the room's content actually changed, one level
deeper than a player-presence check — same diff-gating philosophy already
used everywhere else in this program, just applied to frame content instead of
DB rows. `feedSnapshot` (`plugins/surveillance/index.js:54`) already returns a
comparable value (a text description built from `getZonePlayers`/
`getZoneNpcs`/`getZoneEnemies` for the zone). Compare the newly computed frame
against the *last frame already in that device's buffer* (the in-memory
`CameraBuffer` from Phase 4) — only push if it differs:

```js
push(frame) {
  const last = this.frames[this.frames.length - 1];
  if (last && last.text === frame.text) return;   // nothing changed in the room — don't churn the ring buffer
  this.frames.push(frame);
  while (this.frames.length > this.limit) this.frames.shift();
}
```

This gets both goals at once:
- **Accuracy preserved:** an NPC entering/leaving/acting changes the visible-actor
  set → `feedSnapshot`'s text changes → a new frame gets pushed, whether or
  not any player is online.
- **Waste eliminated:** a genuinely static, empty room (no players, no NPC
  activity) produces the same text tick after tick, so nothing new gets
  pushed — same practical reduction a player-gate would have given, correctly
  scoped to "nothing happened" instead of "nobody's watching."
- **Bonus:** also improves retention quality *with* players online — a
  duplicate "empty hallway" frame every 5s was previously eating into the
  fixed 500-frame `MAX_CAMERA_BUFFER` ceiling just as fast as a meaningful
  frame. Diff-gating means the buffer's limited capacity gets spent on actual
  events, extending how much real history `clip`/auto-clip footage can cover
  before old frames get evicted.

**Implementation note:** the frame's own `timestamp` must still be stamped
fresh every capture attempt regardless of whether the frame gets pushed, so a
*changed* frame right after a long static stretch carries an accurate
timestamp — the diff check only decides whether to append, not what the
frame's timestamp is when it does.

**What stays player-gated:** `pollSensors` and `scanActiveCrimes` (the other
two functions in `surveillanceTick`) still only matter relative to players —
motion alerts go to a player owner, crime detection only fires for live-player
candidates — so gating those two on `hasActivePlayers()` is correct and
unaffected by this change.

---

## Phase 7b — Spawn tick: skip entirely when idle

**File:** `server/engine/world.js`, `tickSpawns`.

Add `if (!hasActivePlayers()) return;` at the top. Safe because `nextSpawn`
timers are wall-clock-based (`now + respawn_seconds * 1000`) — skipping ticks
while idle doesn't corrupt anything; whichever timers have elapsed by the time
a player reconnects just spawn on the very next pass, same as a single busy
period naturally catching up several due respawns at once. No catch-up math
needed — this falls out of the existing timer design for free. (This slots
alongside the Phase 5 spawn-template-caching work already planned for this
same function.)

---

## Phase 7c — Resource tick: same guard, for consistency

**File:** `server/engine/gameLoop.js`, `resourceTick`.

Add the same guard at the top. Mostly symmetry/cleanliness — the tick already
loops `getAllLivePlayers()`, so with zero players the loop body never executes
today regardless. The guard just makes idle-safety explicit rather than
incidental, so it doesn't silently break if pre-loop work gets added later.
(Bundles with the Phase 6 diff-gating work already planned for this function.)

---

## Phase 7d — Power tick: explicitly *not* gated further

**Deliberate no-op**, documented so it doesn't get re-opened without new
evidence. `simulatePowerNetwork` already only runs on a 5-minute cadence (and
only when overloaded/storm), or once daily, and Phase 1's diff-gating already
makes an idle-but-ticking run nearly free (a handful of in-memory comparisons,
no writes). Adding an activity guard here would require designing correct
catch-up math for generator fuel burn and storm-recovery timers when ticking
resumes — real complexity for marginal additional savings on top of what
Phase 1 already delivers. If Phase 2's instrumentation later shows this still
matters, revisit; don't build the catch-up logic speculatively.

---

## Phase 8 — Weather & the 30s ambient tick (follow-on audit)

Triggered by asking the same question of the weather system specifically: does
it do wasted work while idle? Verdict, after reading `server/engine/environment.js:417-439`
function-by-function: **the weather simulation itself is already fine** — but
auditing it surfaced a real bug in a *sibling* function on the same tick.

### What's already fine (no fix needed)

- **`advectField()`** (`plugins/weather/index.js:399`) moves each active storm
  system by a fixed per-tick velocity (`s.x += s.vx`). Purely in-memory,
  O(systems) where systems is "single digits" per the existing code comment.
  No DB access. Skipping ticks while idle causes no discontinuity — systems
  simply don't move until the tick resumes, then continue normally.
- **`stepWeatherEvent()`** (`plugins/weather/index.js:287`) drives the named
  weather-event lifecycle (approach → peak → passing) off wall-clock
  timestamps (`activeEvent.phaseEndsAtMs`), with a `while` loop that already
  self-catches-up through any number of elapsed phases in one call if the tick
  was delayed. No DB access, already safe to skip while idle with zero
  additional catch-up logic needed.
- **`broadcastZoneWeather(occupied)`** (`server/engine/environment.js:1665`)
  and the `syncStreetlights(occupied)` call right after it are **already**
  scoped to `deps.getOccupiedZones()` — with zero players online, `occupied`
  is empty and both become no-ops already.

### The actual finding — `flickerOverloadedZones` (real bug)

`server/engine/environment.js:641-654`:

```js
async function flickerOverloadedZones() {
  const { broadcast, query } = deps;
  if (!broadcast || !query) return;
  for (const [zoneId, z] of state.zones) {
    if (z.powerStatus !== 'overloaded') continue;
    const { rows } = await query(
      `SELECT name FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1 LIMIT 3`,
      [zoneId]
    ).catch(() => ({ rows: [] }));
    const { text: nameStr, isSingular } = _fmtLightNames(rows.map(r => r.name));
    const pick = FLICKER_MSGS[Math.floor(Math.random() * FLICKER_MSGS.length)];
    broadcast(zoneId, { type: 'zone_event', message: `...` });
  }
}
```

Loops **every zone on the map** (not just occupied ones) and issues a `SELECT`
against `furniture` for every zone currently `overloaded`, unconditionally —
whether or not a player is standing there to see the resulting flicker
broadcast. `broadcast(zoneId, ...)` no-ops on an empty zone, but the query
already ran before that point. Same shape as every other bug in this program:
work tied to a timer, not to whether it's observable.

**Worse than a single cadence suggests:** this function is called from *two*
schedule sites — the 30s tick (env.js:418) *and* `tick1m()` (env.js:699). For
every overloaded zone map-wide, the query fires roughly every 30s *and* every
60s independently (not deduplicated) — an unoccupied overloaded zone gets
queried more often than the 30s cadence alone implies.

**This is the item in this phase that needs a code change.** Fix both call
sites with the same guard — fixing only the 30s tick and leaving `tick1m`'s
call unguarded leaves the problem at the 1-minute cadence.

#### Fix

Reuse the exact source of truth this same file already uses one function
away: `deps.getOccupiedZones()` (the same thing `broadcastZoneWeather`'s
caller precomputes right after this function runs in the 30s tick, env.js:426).
Don't introduce a second way to ask "who's in this zone":

```js
async function flickerOverloadedZones() {
  const { broadcast, query } = deps;
  if (!broadcast || !query) return;
  const occupied = deps.getOccupiedZones ? new Set(deps.getOccupiedZones()) : null;
  for (const [zoneId, z] of state.zones) {
    if (z.powerStatus !== 'overloaded') continue;
    if (occupied && !occupied.has(zoneId)) continue;   // nobody there to see the flicker — skip the query
    const { rows } = await query(
      `SELECT name FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1 LIMIT 3`,
      [zoneId]
    ).catch(() => ({ rows: [] }));
    // ...unchanged from here
  }
}
```

Apply at **both** call sites (env.js:418 and env.js:699). If
`flickerOverloadedZones` doesn't already receive `deps` with
`getOccupiedZones` attached at the `tick1m` call site, confirm it resolves the
same way there before assuming this is a single-function change.

**No behavior change** for any zone with a player in it — only empty
overloaded zones (which produce no observable effect today anyway) stop being
queried.

#### Secondary, lower-priority finding — `tick1m`'s temperature broadcast loop

`tick1m()` (env.js:664-700) also broadcasts `environment.zoneTempTick` to
**every zone in `state.zoneTemps`** unconditionally (lines 695-697), with no
occupancy filter — unlike `broadcastZoneWeather`, which is correctly scoped.
No DB query involved (it's an in-memory value pushed over the websocket
channel), so not an egress issue — but it iterates the full zone set and calls
`broadcast(zoneId, ...)` for every one of them every game-minute, most with no
listener. Cheap to fix in the same pass — wrap the loop in the same
`getOccupiedZones()` check used elsewhere in this file.

#### Verify

- `npm run test:regress` (touches a scheduled engine tick).
- Restart required (`environment.js` has no hot-reload path).
- Confirm impact via:
  ```sql
  SELECT query, calls FROM pg_stat_statements
  WHERE query ILIKE '%furniture%light_on%'
  ORDER BY calls DESC;
  ```
  Expect call count to track the number of *occupied* overloaded zones over
  time, not total overloaded zones map-wide.

### Explicitly not recommended (Phase 8)

- **Gating `advectField()`/`stepWeatherEvent()` on player presence** — safe
  (per the self-catch-up analysis above) but delivers effectively zero
  benefit, since both are already O(single digits) in-memory operations with
  no DB access. Mirrors the Phase 7d decision for the power tick: don't add
  gating where the cost is already negligible.
- **Gating the whole 30s `schedule` callback on `hasActivePlayers()`** — same
  reasoning, plus a coarser gate would also suppress legitimate flicker
  broadcasts for *other* zones that do have players during the same tick.
  `flickerOverloadedZones` gets its own targeted per-zone check instead.

---

## Sequencing

7a and 7b are independent, low-risk — bundle with Phases 4 and 5 respectively
when those land. 7c bundles with Phase 6. 7d is a deliberate no-op. Phase 8's
`flickerOverloadedZones` fix is independent of all of the above (different
file region, different bug) and can land anytime — it's a small, self-contained
occupancy-gating change with no dependencies on the other phases.

## Standing rule (applies across both phases)

> Any function driven by `schedule()`, `setInterval()`, or a game tick must
> justify every database query it performs. Default assumption: **`tick != save`**
> (and, per Phase 8's finding, `tick != query` either) — read or write only for
> state a player can actually observe.
