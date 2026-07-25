# Egress Remediation — Phase 4b: Cameras (handoff doc)

> **Status: SHIPPED** (stamped 2026-07-24 by doc audit — this doc had no status line).
> The rolling camera buffer is RAM, not a rewritten DB JSON array: `class CameraBuffer`
> + the `cameraBuffers` Map live in `plugins/surveillance/index.js:606,633`, and no
> per-capture write remains. Historical handoff — the fix is in.

> Part of a larger DB-egress remediation program. This file is self-contained for
> the camera work specifically. The full program also includes Phase 1 (power
> diff-gating), Phase 2 (power simulation-reason instrumentation), Phase 3
> (overload-state tracking, prep only), and Phase 5 (spawn template caching) —
> none of those are required reading to execute this phase, but they share the
> same root-cause framing below.

## Why this exists

An egress/write-volume investigation on this MUD found several always-on game-loop
ticks that write or read Postgres unconditionally on a timer, regardless of whether
anything actually changed. The camera system is one of them, and arguably the worst
per-write offender because it rewrites a growing JSON array rather than a few scalar
fields.

**Root cause, same across every hotspot found in this program:**
`time passing` was being treated as `database mutation`. The fix is
`meaningful change = database mutation`.

## Ground truth (confirmed by reading the code, not inferred)

- `plugins/surveillance/index.js`, function `captureRecordings` (~line 558) runs
  every 5 seconds and rewrites the *entire* `security_devices.recording_buffer`
  JSON array (up to `storage_limit`, default 200 frames) for every device with
  `is_recording=1`, via `UPDATE security_devices SET recording_buffer=$1 WHERE id=$2`.
- Frames are already lightweight text, not images or full state dumps — confirmed
  via `feedSnapshot` (`plugins/surveillance/index.js:54`), which returns a one-line
  description like `"${zone description}. Visible: handle1, handle2."` This is a
  real invariant worth preserving deliberately, not something that needs fixing.
- A durable evidence path already exists and is already event-driven: `cmdClip`
  (`plugins/surveillance/index.js:597`) does a one-time `INSERT INTO security_clips`
  (a separate table, `db/seed.sql:1080`) plus creates a real `items` +
  `player_inventory` row for a "datachip." This is not part of the egress problem
  and should not be reworked — only reused/extended.
- Police-network cameras are already seeded with `is_recording=0`
  (`db/seed.sql:3991-3993`, owned by `faction_police`), and crime detection
  (`scanActiveCrimes`/`cameraLiveInZone`) never reads `recording_buffer` at all —
  detection only checks device existence/power/damage. Police cams cost nothing
  today; Phase 4c below is insurance to keep it that way, not a fix for an active bug.
- Only two code sites touch `recording_buffer`: `captureRecordings` (writes) and
  `cmdClip` (reads). No dev-panel/API route depends on it (checked
  `server/api/routes.js` — no matches), so it's safe to relocate entirely off Postgres.

## Phase 4 — Camera rolling buffer moved to memory

**File:** `plugins/surveillance/index.js`.

```js
const MAX_CAMERA_BUFFER = 500; // hard ceiling regardless of storage_limit's configured value

class CameraBuffer {
  constructor(limit) {
    this.limit = Math.max(1, Math.min(limit, MAX_CAMERA_BUFFER));
    this.frames = [];
  }
  push(frame) {                 // frame.timestamp must be assigned by the caller at capture time —
    this.frames.push(frame);    // never timestamp later in snapshot()/clip creation, or delayed
    while (this.frames.length > this.limit) this.frames.shift();  // clip generation shifts the window
  }
  snapshot(seconds) {
    const cutoff = Date.now() - seconds * 1000;
    return this.frames.filter(f => f.timestamp >= cutoff);
  }
}
const cameraBuffers = new Map(); // deviceId -> CameraBuffer, created lazily on first capture
```

- `captureRecordings` (5s tick) pushes into `cameraBuffers` only. Buffers are
  created lazily on first capture per device, so memory footprint follows
  *actively recording* cameras, not the full `security_devices` row count. Its
  `SELECT` should drop the `recording_buffer` column entirely (smaller read too).
- `cmdClip` reads `cameraBuffers.get(id)?.frames ?? []` — never `undefined`, so a
  fresh-boot clip request against an empty buffer hits the existing "nothing
  recorded" error message, not a crash.
- **Lifecycle cleanup:** `cameraBuffers.delete(deviceId)` must fire on device
  destruction, uninstall/removal, and sale — locate the existing
  `security_devices` delete/ownership-transfer code paths and add this cleanup
  alongside each. `Map.delete()` is already a safe no-op if called twice or on a
  missing key — no extra guard needed.
- **Frame-content invariant:** keep frames as lightweight metadata/text. Don't let
  a future "richer camera feed" feature turn frames into images or full state
  dumps — that just relocates the original problem from Postgres into server RAM.
- **Diagnostics:** add `activeCameraBuffers` and `totalBufferedFrames` counters to
  whatever diagnostics/HUD surface this program's Phase 2 instrumentation uses (or
  a simple log line if that's out of scope) — the RAM-side equivalent of a
  `pg_stat_statements` audit, so stale-buffer accumulation over months of uptime
  is visible rather than silent.

**Column removal — three explicit phases, don't skip the middle one:**

1. **Phase A:** stop writing `recording_buffer`/`storage_limit` from application
   code. Leave the schema untouched.
2. **Phase B:** run in production for a verification window; confirm via
   ```sql
   SELECT * FROM pg_stat_statements WHERE query ILIKE '%recording_buffer%';
   ```
   that it returns nothing meaningful (no live callers left).
3. **Phase C:** drop the `recording_buffer`/`storage_limit` columns from
   `server/models/schema.js`, as a separate follow-up commit once Phase B is
   confirmed clean.

## Phase 4b — Auto-clip on incidents, single clip-creation path

```text
createSecurityClip(deviceId, frames, zoneId, ownerId) → INSERT INTO security_clips, returns clip row
physicalizeClip(clipRow, player)                      → INSERT items + player_inventory
```

- **Manual clip** (`cmdClip`): `createSecurityClip()` then `physicalizeClip()` —
  identical player-facing result to today; this is a refactor of the existing
  function into two named steps, not a behavior change.
- **Auto-clip** (crime raised, via the existing `crimeLog` map in
  `plugins/surveillance/index.js`, in view of an actively-recording camera):
  `createSecurityClip()` only — a durable evidence record, **no automatic
  item/inventory creation**. This avoids edge cases like the camera's owner being
  offline or their inventory being full when an incident fires.
- Add the minimum companion action needed to physicalize an *existing* clip on
  demand — the current `cmdClip` only knows how to build a clip from a device's
  live buffer, not from an already-existing `security_clips` row, so this small
  gap needs closing for auto-clips to be usable by players at all.
- Out of scope for this phase: richer evidence-access mechanics (review / sell /
  submit-to-police tiers, access control levels). The `createSecurityClip`/
  `physicalizeClip` split gives that room for free later without touching the
  storage model — treat it as a separate future gameplay design.

## Phase 4c — Recording-capability guardrail, network-scoped

```js
if (device.network?.isPolice && enablingRecording) {
  throw new Error('Recording capability unavailable on this network');
}
```

Checks network authority (the `is_police` flag on `security_networks`), not
device kind or "player" — the invariant is "police network: observation allowed,
recording forbidden," and holds even if a future NPC faction or non-player system
ever tries to toggle it. This is already true by construction today (ownership
gating prevents a player from touching an org-owned device) — this phase is
insurance against a future regression, not a fix for an active bug.

## Sequencing within this phase

Phase 4 (buffer to memory, column-removal Phase A + lifecycle cleanup + memory
clamp) → Phase 4c (bundle with 4, trivial) → Phase 4b (depends on Phase 4's
in-memory buffer existing) → Phase 4 column-removal Phase B (verification
window) → Phase 4 column-removal Phase C (drop columns).

## Verification

- `npm run test:regress` before merge (this touches a plugin's scheduled tick,
  covered by this repo's regression-testing rule in `CLAUDE.md`).
- Restart required to observe live (no hot-reload for plugin tick registration).
- Confirm impact via:
  ```sql
  SELECT query, calls, total_exec_time
  FROM pg_stat_statements
  WHERE query ILIKE '%security_devices%recording_buffer%'
  ORDER BY total_exec_time DESC;
  ```
  Expect this query's `calls` to collapse to near-zero once Phase 4's column-removal
  Phase A lands.

## Standing rule (applies beyond this phase)

> Any function driven by `schedule()`, `setInterval()`, or a game tick must
> justify every database query it performs. Default assumption: **`tick != save`**.
> A query belongs in a tick handler only when it's responding to a meaningful
> state change, not because time passed.
