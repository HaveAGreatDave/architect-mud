# Air-to-Air PvP — Continuous Cockpit (proposal)

Blueprint for player-vs-player air combat on the continuous flight sim. Companion to
[systems-flight.md](systems-flight.md) (the as-built flight system).

> **Status: Phase A (contacts & netcode) BUILT** 2026-07-05 — regress 322/322, client modules
> parse clean, **browser-unverified** (Chrome ext down). Server restart + client hard-refresh to
> go live. Phases B–D (guns / missiles / polish) still design. See the Phasing section.

## Locked design decisions

- **Rules of engagement: free-fire everywhere.** Any armed, airborne craft can engage any
  other airborne craft. No zone gating, no duel handshake. (Heat/wanted integration for kills
  over civil airspace is a *later, optional* polish item — see Phase D — not a gate.)
- **Weapons: guns + lockable missiles.** Fixed forward cannon (point-and-hold in a cone) plus a
  radar-lock seeker for beyond-guns kills, with flares as the counter.
- **Targeting feel: manual pipper tracking.** Keep the enemy inside the reticle to build a
  firing solution; the `piloting` skill widens the cone. Rewards the 60fps client sim.

## What already exists (reused, not rebuilt)

- `liveAircraft` registry — every airborne craft with reconciled `grid_x/grid_y`, `altitude_band`,
  `heading`, `cont.{altitude,airspeed,vs}`, `damage` (hull 0..1). Shared coordinate space.
- `arm` / `safe` / `fire` verbs, `weapons_hot`, `hardpoints` gating, the master-arm toggle, FIRE
  button, spacebar-fire, and the glowing gun reticle in the fsim cockpit.
- `applyStrafeResult()` pattern — piloting `skillCheck` decides a gun-pass outcome (the A2A
  model mirrors this).
- `crash(live, reason)` — already turns a craft into salvage **and kills every occupant**
  (`handlePlayerDeath`). Shooting a player down needs no new death code.
- The `flightsync` (client→server, ~1.2s) / `reconcile()` / `flight_ctx` (server→client, 3s tick)
  netcode seam, and the fsim's per-frame dead-reckoned movement.

`fire` stays bound to the **ground AA strafe**. A2A uses new explicit verbs so the two never
collide: `airfire`, `airlock`, `airunlock`, `flares`.

---

## The two hard problems

### 1. Contact freshness (netcode)

Dogfighting needs sub-second knowledge of where the other plane is. Today the shooter only
learns the world every 3s (`flight_ctx`), and the *other* plane only reports itself every 1.2s.
That's unusably stale for gun tracking.

**Solution — event-driven contact relay + adaptive sync bubble:**

- On every `cmdFlightSync` from craft A, after `reconcile()`, the server finds other airborne
  craft within `CONTACT_RANGE` tiles and **immediately pushes** a `flight_contacts` message to
  *their* occupants carrying A's fresh `{id, x, y, alt, hdg, ias, band, hullPct, reg, class}`.
  So B learns A at A's report cadence, with no added tick latency.
- When a craft has a hostile contact inside `FAST_SYNC_RANGE`, the server flags it in
  `flight_ctx` (`hostileNear:true`); the client raises its `flightsync` cadence from 1.2s to
  ~0.3s. Result: a **mutual ~3 Hz bubble that only exists when planes are close** — bounded cost,
  no global rate hike.
- The client **dead-reckons** each contact between updates (extrapolate from `hdg`+`ias`) so the
  pipper tracks smoothly at 60fps even though data arrives at 3 Hz.

### 2. Fair hit resolution (authority)

Both sims are client-authoritative on their own position (server only clamps to an envelope).
So "is the target in my gun solution?" is inherently contestable. We adopt the codebase's
existing philosophy — **client owns feel, server owns consequences + rolls the check** — as a
hybrid:

- **Guns:** the shooter's client decides the pipper is *on* (target inside cone + gun range,
  using its dead-reckoned contact) and sends `airfire guns <targetId> <aimQuality0..1>`. The
  server **validates against a generous anti-spoof gate** (target exists, airborne, within
  `GUN_RANGE_GATE` ≥ client range, altitude band ±1 off last reconciled positions), then resolves
  damage `= GUN_DMG × aimQuality × shooterSkillFactor`, reduced by an **opposed `piloting` check +
  active evade** on the defender. Server applies hull damage, attributes the kill, `crash()`es on
  hull-out. Cheating position buys you nothing the gate doesn't already allow, and the defender
  always gets a roll.
- **Missiles:** fully server-authoritative outcome. Client requests `airlock <targetId>` once the
  target's been held in the reticle for `LOCK_TIME`; server validates the gate, records the lock,
  and warns **both** pilots (shooter: lock tone; target: RWR "MISSILE LOCK"). Client `airfire
  missile <targetId>` spawns a **server-tracked missile** resolved over `MISSILE_FLIGHT` seconds
  on the flight tick: base `MISSILE_PK`, defeated by flares (`flares` verb), breaking lock
  (out of range / notch), or a hard defensive break.

Accept that this is **arcade-fair, not simulation-fair** — some shots will feel generous or stingy
under lag. The generous gate + guaranteed defender roll keep it from feeling broken.

---

## Server changes

### `plugins/flight/combat.js` (the bulk)

- `contactsNear(live)` — iterate `liveAircraft`, return other airborne craft within `CONTACT_RANGE`
  (Chebyshev), each as the contact payload above.
- `relayContacts(live)` — push `flight_contacts` to a craft's occupants (called from
  `cmdFlightSync` after reconcile).
- `cmdAirFire(args,…)` — `guns|missile <targetId> [aimQuality]`. Gate-validate, then
  `resolveGuns()` or `launchMissile()`. Requires pilot seat + `weapons_hot`.
- `cmdAirLock` / `cmdAirUnlock` — grant/drop a missile lock (gate-validated); notify both sides.
- `cmdFlares` — pop countermeasures (cooldown); flag `live.flaredUntil` so the missile tick can
  defeat inbound seekers.
- `resolveGuns(shooterLive, targetLive, aimQuality, pilot)` — opposed check, apply damage via
  shared `applyAirDamage()`, gun heat/cooldown (`live.gunHeat`), hit/miss feedback to both.
- Missile lifecycle in `tickCombat(live)` (already runs each airborne tick): advance
  `live.inboundMissiles` / `live.firedMissiles`, resolve at flight-time end (PK vs flares/evade),
  `applyAirDamage()` on hit.
- `applyAirDamage(targetLive, amount, byPlayer)` — hull ladder + `crash(targetLive, 'shotdown',
  byPlayer)` on hull-out; award shooter `piloting` XP; kill-feed broadcast.
- Export new verbs in `combat.js` `commands`.

### `plugins/flight/state.js`

- Live-aircraft init: add `gunHeat`, `inboundMissiles`, `firedMissiles`, `missileAmmo`
  (= hardpoints, or `custom_data.loadout.missiles`), `flaredUntil`, `activeLock`, `hostileNear`.
- `contactPayload(contact)` helper + a `flight_contacts` message shape.
- **Tunables block** (one place, like `BAND_BURN`): `CONTACT_RANGE≈12`, `FAST_SYNC_RANGE≈5`,
  `GUN_RANGE≈1.5`, `GUN_RANGE_GATE≈2.5`, `GUN_CONE_DEG≈8`, `GUN_DMG≈0.12`, `GUN_COOLDOWN`,
  `MISSILE_RANGE≈8`, `LOCK_TIME≈2.5s`, `MISSILE_PK≈0.7`, `MISSILE_FLIGHT≈4s`,
  `FLARE_DEFEAT≈0.6`, `FLARE_COOLDOWN`.
- `crash()` gains an optional `byPlayer` for kill attribution + the kill feed.

### `plugins/flight/index.js`

- `cmdFlightSync`: after `reconcile()`, call `relayContacts(live)` and set `live.hostileNear`.
- `contextPayload()` / `flight_ctx`: include `hostileNear` so the client adapts sync cadence.

### `plugins/flight/plugin.json`

- Register `airfire`, `airlock`, `airunlock`, `flares` in the `commands` array (plugin verbs only
  wire if listed — see the plugin-registration rule).

### `plugins/flight/regress.js`

- Two synthetic live aircraft in range → `airfire guns` applies damage; repeated fire → `crash` +
  occupant death. Out-of-range shot → rejected by the gate. Lock grant + expiry. Flares defeat an
  inbound missile. (Client visuals can't be regressed — note it.)

---

## Client changes

### `client/game/js/dispatch.js`

- New handlers: `flight_contacts` → `flightSimContacts(msg)`; `air_threat` (incoming lock/missile
  → RWR); `air_hit` (you hit / were hit feedback + damage flash).

### `client/game/js/panels/cockpit.js` (fsim)

- Ingest `flight_contacts` into `F.contacts` with per-contact dead-reckoning (`{x,y,alt,hdg,ias,
  ts}` → extrapolate each frame).
- **Target designator + pipper logic** in `fsimFrame`: pick the contact nearest the boresight
  inside the gun cone, show a lead pipper + range/closure/aspect readout, compute `aimQuality`
  from pipper-centering × steadiness. Space/FIRE → `airfire guns <id> <q>` when guns selected.
- **Missile mode:** `T`/`TAB` cycles the designated contact; hold to build lock (progress ring +
  rising lock tone); `airlock` when armed; fire → `airfire missile <id>`; missile-count pips.
  Weapon-select toggle (guns ↔ missiles) via a button + `1`/`2` keys.
- **RWR / defense:** consume `air_threat` → cockpit "LOCK" / "MISSILE — FLARES" warnings; `X` =
  `flares`. Add incoming-missile warble.
- Keys added: `T`/`TAB` (cycle target), `X` (flares), `1`/`2` (weapon select). Space stays fire.

### `client/game/js/panels/windshield.js` (meatiest render work)

- Project each contact's **world position relative to own pos+heading** into the Mode-7 view →
  draw an aircraft blip/sprite that grows with proximity, plus a designator box on the active
  target. Also plot contacts on the MFD/radar (the radar already rotates heading-up).

### `client/game/js/panels/engine-audio.js`

- Lock tone (search→lock), missile launch whoosh, incoming-missile warble, gun rattle, hit clang.

---

## Phasing (each phase independently shippable + regressable)

- **Phase A — Contacts & netcode (de-risks the hardest bits): ✅ BUILT.** Event-driven relay
  (`contactsNear`/`relayContacts` in combat.js, called from `cmdFlightSync`), `airContact` payload
  + `CONTACT_RANGE`/`FAST_SYNC_RANGE` tunables in state.js, `flight_contacts` message. Client:
  `flightSimContacts` ingest + per-frame dead-reckoning + boresight designation + adaptive
  0.33s/1.2s sync cadence (cockpit.js). Contacts render as a **projected low-poly 3D aircraft
  model** (`drawAircraftModel`) — every vertex run through the same Mode-7 camera as the
  buildings, so **aspect angle, bank, and pitch are physically correct** (the bogey's attitude is
  relayed: `bank`/`pitch` appended to the flightsync packet → `reconcile` → `airContact`). The
  model is **painted in the craft's livery** (base/trim colours, finish sheen, pattern accents —
  `airContact` carries a `{base,trim,pattern,finish}` summary via `normalizeLivery`). Plus a
  target bracket + range/hull/alt readout, **off-screen edge chevrons** for contacts behind/outside
  the view (`cam.EH` exposed), and **track-up MFD blips** (`paintMfdContacts` — red heading darts,
  designated one ringed, off-panel edge-clamped). **You can see other planes; no weapons yet.**
- **Phase B — Guns: ✅ BUILT.** Client computes a **manual pipper gun solution** on the designated
  contact (horizontal bore + vertical elevation off own nose, inside `GUN_RANGE`/`GUN_CONE`) →
  `aimQuality`; **hold-to-fire** (space / FIRE button) squirts `airfire guns <id> <q>` at a client
  cadence. Server `cmdAirFire` validates a lenient anti-spoof gate (`GUN_RANGE_GATE`/`GUN_CONE_GATE`
  + altitude band), then `applyAirDamage` = `GUN_DMG × aimQuality` cut by the defender's opposed
  piloting jink / active `evade` / gunship armour; hull-out → `crash(…, byPlayer)` with kill
  attribution + feed. Server-enforced `GUN_COOLDOWN_MS`. Feedback: reticle flips amber→green lock,
  forward tracers + muzzle flash, `air_hit` toast + red battle-damage flash, live HULL readout
  (hull now in `flight_ctx`), gun/hit audio. regress 342/342 (incl. an `airfire` gate test).
- **Phase C — Missiles:** lock cycle, `airlock`/`airfire missile`, server missile tick, `flares`,
  RWR, ammo pips.
- **Phase D — Polish:** kill feed, `piloting` XP tuning, in-cockpit ⚙ balance sliders, and the
  *optional* wanted/interceptor heat for kills over civil airspace (hooks the existing
  `WANTED_RAISE` + `airspace_restricted` scaffolding).

## Open risks / accepted tradeoffs

- **Divergence under lag** — shooter's dead-reckoned enemy pos ≠ truth. Mitigated by the generous
  server gate + guaranteed defender roll; accepted as arcade feel.
- **Pilot-fires-only** — no gunner/multi-crew weapons in v1 (passengers just ride). Later.
- **Browser-unverifiable now** — the Chrome extension is down; all client work needs a live tuning
  pass once it's back (same standing caveat as the rest of the flight overhaul).
- **Cost** — fast-sync bubble is local to engagements; worst case is a furball of N planes in one
  `CONTACT_RANGE` circle (bounded, and rare).
