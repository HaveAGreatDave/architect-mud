# Fishing (as built)

Fishing is a posture-based, perpetual **cast-and-wait** action for water-adjacent
zones — the water-side cousin of [scavenging](systems-scavenging.md). Casting
waits for a bite; a bite **arms a client-side tension-bar reel overlay**; landing
the reel pulls a catch from a loot table gated by the new **Fishing** skill.

Owned by `plugins/fishing/` (verbs `fish` / `fishresolve`). See
[plugins.md](plugins.md) for the ownership/precedence rule.

## The loop (server)

`posture === 'fishing'` is the authoritative activity flag, so fishing inherits
every engine force-stand interruption (move, attack, be attacked, sit, die) for
free — exactly like scavenging/butchering. Bookkeeping the posture string can't
hold rides on `player.fishState = { zoneId, streak, lastAttempt, pending, token }`
(runtime-only, never persisted).

A 1 s tick runs one **cast** every `ATTEMPT_MS` (4.2 s):

1. **Gate checks** — still in a `fishing_table_id` zone, still carrying a rod.
2. **Bite roll** — `BITE_CHANCE` (0.55, +0.15 with bait). A miss prints a quiet
   flavor line and nudges after `HINT_STREAK` (3) dry casts.
3. **On a bite** — pick a weighted target from the eligible pool, mint an
   anti-spoof `token`, set `fishState.pending`, and send a `fishing_game` message
   to arm the overlay. **The loop pauses** (no further casts) until the overlay
   resolves via `fishresolve`, or `PENDING_TTL_MS` (30 s) elapses (player
   abandoned the overlay → "the line goes slack" and the loop resumes).

### The eligible bite pool
- **Normal catches** — stocked `scavenging_table_items` with `current_qty > 0`.
  With bait present, weights tilt toward the scarcer (higher-difficulty) entries.
- **Bait-gated catches** — `messages.fishing.baitCatches[]`; only eligible when
  the player carries the required bait sub-tag. Not zone-stocked.
- **Monster hooks** — `messages.fishing.monsters[]`; a bad pull.

## The reel overlay (client)

`client/game/js/panels/fishing.js` → `openFishing()`, built on the shared
minigame chrome (`minigame-common.js`): moulded chassis, branded head, recessed
bezel + bulged-CRT screen, deck strip with live threat LEDs — the same hardware
family as Circuit Breach / Hololock / the ATM.

**Mechanic — keep-in-zone:** a vertical water column holds a controllable **gaff**
band and the hooked **catch**. HOLD (Space / the button / the tube) reels the gaff
up; release lets it sink under gravity. Keep the gaff bracketing the catch to fill
the **CREEL** meter; lose the bracket and the creel drains while **TENSION**
climbs (driving the deck LEDs via `setDeckLevel`). Fill the creel → landed; empty
it → the line snaps. The board is tuned by `edge = skill − difficulty` (gaff
height, how wildly the catch fights, fill/drain rates) — an outclassed angler
faces a genuinely brutal fight, not a cosmetic one.

The overlay is **cosmetic-authoritative** like the other minigames: winning it is
the gate. It reports `onResult({ won })`, which fires
`fishresolve <zoneId> <1|0> <token>`.

## Resolve (server, authoritative)

`cmdFishResolve` validates posture is still `fishing`, the `token` matches the
armed `pending`, the zone matches, and the player still carries a rod. Then:

- **Monster** — the thing surfaces either way; `spawnEnemySync` drops the enemy
  into the zone and it aggros. Winning just means you're braced (and earns IP).
  Fishing ends.
- **Normal / bait catch, won** — decrement zone stock (normal only), insert the
  item, consume one bait item if held, award Fishing IP (barely-won = best odds),
  and end the action (recast to keep going — mirrors scavenging).
- **Lost** — "the big one got away"; `ROD_SNAP_CHANCE` (0.18) sheds rod condition
  (`ROD_SNAP_DAMAGE` 0.25; four bad reels retire a rod). The loop resumes.

## Skill, gear, storage

- **Skill:** `fishing` (survival; governed by **Reflexes + Cool**) — added to
  `SKILLS` in `server/engine/skills.js`. Uses the standard 2d8−2d8 machinery
  (`effectiveSkill` / `awardSkillUse`). No schema change.
- **Rod (required):** any carried, uncontained item tagged `fishing_rod` — the
  ATM `hack_device` carry-gate pattern. Pair with `unique` so each rod keeps its
  own condition.
- **Bait (optional):** any item tagged `bait`; a sub-tag (e.g. `bait_bloodworm`)
  gates specific catches. One is consumed per catch; presence boosts the odds
  toward better catches and lifts bite chance.
- **Loot storage:** reuses the `scavenging_tables` / `scavenging_table_items` /
  `scavenging_zone_stock` / `scavenging_zone_state` schema verbatim (per-zone
  stock + lazy replenish). A **separate** zone flag `flags.fishing_table_id`
  keeps the two systems from colliding; fishing-only extras (monsters,
  bait-gated catches) ride in the table's `messages.fishing` JSONB — no
  migration. *(Note: if a zone runs both systems and shares a catch item id, they
  share that item's per-zone stock row — harmless, by design.)*

## Content (test spot)

`scripts/seed-fishing.js` (one-shot, idempotent) seeds the rod + bloodworm bait,
the catch items (staple `item_fresh_catch` reused; waterlogged boot / bloated
hand / drowned lockbox / bait-gated glass eel), the `enemy_cable_eel` monster
hook, the `fish_coldwater_bay` table, and attaches `fishing_table_id` to
**`zone_dock_fishmarket`** (Fishmarket Dock). Reload the world (or restart) after
running so the zone flag loads. In game: carry `item_fishing_rod`, stand on the
Fishmarket Dock, and type `fish`. Other dock/bay zones (`zone_dock_*`,
`zone_bay_*`) can adopt the same table by setting the flag.
