# drugwar

The street-level drug war: a self-running turf tick where three seed factions —
the **Franchise** (the Core / Franchise Strip), the **Breakers** (the Marquee),
and the **Glitch** (the Yards) — push `zone_control` influence back and forth
across their districts with no players present. It is the visible, low-stakes
microcosm of the corp territory meta: a new player watching corners change hands
is unknowingly learning the exact claim/contest/flip loop they'll later run at
corp scale. Nobody says so.

Each faction fields a covert street dealer (see `plugins/dealer` +
`scripts/seed-drugwar-dealers.mjs`): **Dov Keller**, **Gita Marsh**, **Wick Sorel**.

## How it works

- **Reuses the corps substrate.** The tick writes the same `zone_control` table +
  `world.zoneControl` cache the corp system uses (DB stays source of truth). It is
  scoped to a fixed set of drug-war zones and the three factions — it never
  touches corps and never wakes any full NPC-corp AI.
- **`computeTurfMove(row, natural, rng)`** is a pure decision function (no DB), so
  every branch is deterministically testable. `drugwarTurfTick()` applies it +
  emits.
- **Drift:** uncontested NPC holds consolidate toward 100 (`CONSOLIDATE`);
  contested zones erode toward a flip (`ERODE`); a rival may "make a play" on an
  uncontested zone (`CHALLENGE_CHANCE`), and the home faction pushes to reclaim
  turf it's lost (`RECLAIM_CHANCE`). On grip ≤ 0 the zone flips to the challenger
  and the tick emits **`drugwar.flip { zoneId, fromOrg, toOrg }`**.
- **Cadence:** `10m` (see `scheduler.js`).

## Player safety

The tick only acts on a drug-war zone **currently held by one of the three NPC
factions**. A zone claimed by a player corp (or unclaimed) is left entirely alone
— the NPC war routes around it, and real seizure of a player's turf stays a
player action (`corp contest`). This is enforced in `computeTurfMove` (returns
`null` for any non-NPC-faction controller).

## Content / setup

Initial turf is seeded deliberately (never on boot):

```
node scripts/seed-drugwar-dealers.mjs   # the three dealers
node scripts/seed-drugwar-turf.mjs      # the opening zone_control board
```

Then restart the server (or `/world reload`).

## Living-world reactions

Ambient, diegetic, never part of any tutorial — all off the event bus, hard-gated
so they read as texture, not spam:

- **The war is visible** — a `drugwar.flip` repaints the corner in front of whoever's
  standing there (graffiti re-tag). Propagating rumours about the flip (and a dealer
  "gone to ground" when their home corner is taken) are seeded by the **gossip** plugin,
  which also listens to `drugwar.flip`.
- **Police don't save you** — a near-spawn (`zone_start` / `zone_threshold`) vignette
  where no cop comes. Narrates around the real crime seam; changes no rules.
- **The machine is watching** — the Architect as infrastructure only (never a voice):
  a camera that pans to you, streetlights stuttering in a pattern, cryptic departure
  boards, and — rarely — a genuine sourceless blackout via `drainZonePower` +
  `recomputePower`. Per-player in-memory cooldowns; a server-wide cooldown on blackouts.

## Invisible alignment ledger

Faction-flavoured choices quietly move the hidden per-player `architect_axis` (the
**factions** plugin's `ADJUST_ARCHITECT` action, clamped −100..100), never surfaced
here. Buying from a faction's dealer pushes you their way; killing their people the
other. Stance: Glitch/Custodians pro-Architect, Franchise a mild license-lean,
Breakers anti. Fed by `vendor.purchase` (seller `npcId` → faction) and `npc.killed`.

## Exports (for tests / ops)

`drugwarTurfTick`, `computeTurfMove`, `DRUGWAR_ZONES`, `ZONE_HOLDER`, `isDrugWarZone`,
`architectDelta`.
