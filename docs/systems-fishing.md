# Fishing (as built)

Fishing is a posture-based, perpetual **cast-and-wait** action for water-adjacent
zones — the water-side cousin of [scavenging](systems-scavenging.md). Casting
waits for a bite; a bite **arms a client-side cast+reel overlay**; the player's
**cast (power = depth, angle = lane)** decides what's on the line, and landing
the reel pulls that catch from a loot table gated by the new **Fishing** skill.

Owned by `plugins/fishing/` (verbs `fish` / `fishcast` / `fishresolve`). See
[plugins.md](plugins.md) for the ownership/precedence rule.

This is fishing from the shore. Fishing from an anchored boat, where you can see the fish swimming and cast at any bearing and distance, is in [From a boat](#from-a-boat) below and [proposals/boat-fishing.md](proposals/boat-fishing.md). It leaves everything here as it is.

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
3. **On a bite** — build the eligible pool but **don't pick the catch yet**;
   stash the whole pool on `fishState.pending` (`phase: 'cast'`), mint an
   anti-spoof `token`, and send a `fishing_game` message to arm the **cast**
   overlay (with the pool's average difficulty for cast-stage feel). **The loop
   pauses** until the cast+fight resolves via `fishresolve`, or `PENDING_TTL_MS`
   (30 s) elapses at either phase (player abandoned the overlay → "the line goes
   slack" and the loop resumes; `armedAt` is reset when the cast lands, so the
   fight gets its own full TTL).

### The cast decides the catch (`fishcast`)
The overlay's cast stage reports `fishcast <zoneId> <power> <angle> <token>`
(power/angle ∈ [0,1], clamped server-side). `cmdFishCast` validates the token +
posture + carried rod, then **`pickCastTarget(pool, power, angle)`** chooses the
catch and flips `pending.phase` to `'fight'`:
- **Power → depth.** A catch's "home depth" is `difficulty / DEPTH_MAX` (12);
  weight is scaled by `0.35 + (1 − |power − homeDepth|)`, so a deep cast tilts
  the draw toward the scarcer, higher-difficulty entries.
- **Angle → off-line specials.** `offAxis = |angle − 0.5|·2`. Bait-gated catches
  and monster hooks get `×(1 + offAxis·2.2)`; ordinary catches get `×(1 −
  offAxis·0.4)`. Straight water favours the ordinary pool; angling off raises the
  odds of the specials.

The client can only *influence* the draw (it can't summon an out-of-pool catch —
the pool is the server's). The chosen catch's real difficulty is sent back in a
`fishing_fight` message, which arms the reel stage tuned to what you actually
hooked.

### The eligible bite pool
- **Normal catches** — stocked `scavenging_table_items` with `current_qty > 0`.
  With bait present, weights tilt toward the scarcer (higher-difficulty) entries.
- **Bait-gated catches** — the `fishing_bait_catches` column (JSONB array); only
  eligible when the player carries the required bait sub-tag. Not zone-stocked.
- **Monster hooks** — the `fishing_monsters` column (JSONB array); a bad pull.

## The reel overlay (client)

`client/game/js/panels/fishing.js` → `openFishing()` (+ `armFishFight()` for the
handoff), built on the shared minigame chrome (`minigame-common.js`): moulded
chassis, branded head, recessed bezel + bulged-CRT screen, deck strip with live
threat LEDs — the same hardware family as Circuit Breach / Hololock / the ATM.

**Stage 1 — the cast:** a horizontal AIM tick sweeps the surface; TAP (button /
tube / Space) locks the **angle** and hands straight to a vertical POWER meter
that charges (0 SHALLOW → 1 DEEP) while held. RELEASE fires — power + angle are
reported via `onCast` → `fishcast`. The bobber pays out to that lane and depth,
settles, and is yanked under (`FISH ON!`) while the server picks the catch. A
shallow cast also seeds a fuller CREEL head-start (`generateFight` — deep water
is high risk / high reward). The fight only starts once **both** the pay-out
animation and the server's `fishing_fight` have landed (`tryStartFight`).

**Stage 2 — the reel, keep-in-zone:** a vertical water column holds a controllable **gaff**
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

### The `log` rung

The `log` Display Mode rung has no board, so the server settles both stages in
`settleLogBite`: a straight cast to a random depth picks the catch from the same
pool, then one fishing check against that catch's difficulty decides the reel,
and the result lands through `cmdFishResolve` like any other. `textgames` plays
the character board (`textfishing.js`), which is a skin over the same game.

⚠ Don't route this rung through `textRender`'s shared resolve. The client fires
the resolve verb at once, while the bite is still at the cast stage, and
`cmdFishResolve` refuses it; until 2026-10-18 a log-rung player never landed a fish.

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
- **Where you can fish (`fishingTableFor`, 2026-07-21):** two ways in, checked in
  order. An authored **`flags.fishing_table_id`** always **wins outright** — that
  is how a special spot gets its own list (the piers, the Echelon's stern, a
  stocked pond). Otherwise **any tile orthogonally touching water** fishes the
  common **`fish_coldwater_bay`** table, so a beach or a river bank simply works
  without being authored tile by tile. Standing *in* the water is not fishing —
  a water tile with no authored table returns null.
  - "Water" is **`zoneTerrain(zone) === 'water'`** — the single marker, since the legacy
    `flags.water` duplicate was retired on 2026-07-21 (see
    [reference/land-taxonomy.md](reference/land-taxonomy.md)). It covers the wildlands hydrology
    as well as the basin: connected-component analysis showed those tiles form a north-west sea
    feeding a one-tile-wide river that meanders ~25 tiles south into a delta, plus a north-east
    sea with a hand-eroded coastline — authored geography whose descriptions simply have not been
    written yet. A river fishes. **236 shoreline tiles are now fishable**, up from 8 authored spots.
  - Adjacency runs off a 60s-TTL coord index, not a per-tick zone scan —
    `runAttempt` ticks for every fishing player.
  - Per-zone stock is created **lazily on first cast**, so each newly-fishable
    shoreline tile gets its own independent stock of the shared table rather than
    drawing from a shared pool. No seeding needed.
- **Loot storage:** reuses the `scavenging_tables` / `scavenging_table_items` /
  `scavenging_zone_stock` / `scavenging_zone_state` schema verbatim (per-zone
  stock + lazy replenish). A **separate** zone flag `flags.fishing_table_id`
  keeps the two systems from colliding; fishing-only extras (monsters,
  bait-gated catches) live in the dedicated `scavenging_tables.fishing_monsters`
  and `fishing_bait_catches` JSONB columns (empty `[]` for pure-scavenging rows).
  They were briefly stored under `messages.fishing`, which the scavenging dev
  panel's save silently wiped — see the source-of-truth audit finding.
  *(Note: if a zone runs both systems and shares a catch item id, they
  share that item's per-zone stock row — harmless, by design.)*

## Content (test spot)

The content files hold the rod + bloodworm bait,
the catch items (staple `item_fresh_catch` reused; waterlogged boot / bloated
hand / drowned lockbox / bait-gated glass eel), the `enemy_cable_eel` monster
hook and the `fish_coldwater_bay` table, and **`zone_dock_fishmarket`** (Fishmarket
Dock) carries `fishing_table_id`. In game: carry `item_fishing_rod`, stand on the
Fishmarket Dock, and type `fish`. Other dock/bay zones (`zone_dock_*`,
`zone_bay_*`) can adopt the same table by setting the flag.

## From a boat

Built 2026-10-27 to 2026-11-03; the design and the wire are [proposals/boat-fishing.md](proposals/boat-fishing.md). `fish` aboard an anchored boat with a rod (or a hull with rod holders) opens the boat reel instead of the shore loop. It shares the shore registration, posture `'fishing'` and `fishState`, with `fishState.mode = 'boat'`.

The fish aren't a loot table. They're `client/shared/fish.js`: schools worked out from the place, the seabed, the hour and the server's clock, never stored, so the server, the seat's shadows and `look water` all see the same fish.

| Piece | File |
|---|---|
| The sim, and who can see a fish (`shadowsOn`, `lightOn`, `sightRange`, `LAMP_R`) | `client/shared/fish.js` |
| The reel's rules, judged on both sides | `client/shared/boatfish-rules.js` |
| The server loop: cast, twitch, strike, land into `boat_hold` | `plugins/fishing/boat.js` |
| The sea's moment, the take and the land mask the seat is sent | `plugins/fishing/sea.js` |
| `look water` and the surface signs in the room prose | `plugins/fishing/water.js`, `water-view.js` |
| The reel's HUD and messages | `client/game/js/panels/boatfish.js` |
| Rod mode, and the shadows' gate and packing | `client/game/js/panels/boat-view.js`, `fish-shadow-scene.js` |
| The shadows themselves (GLASS 2) | `client/game/js/panels/gl/fish-shadows.js` |

**The seat runs on the server's terms.** The anchor push, the boarding context and each window recentre (`boat_ctx`) carry `serverNow`, `env`, `thinned` and `land` (`seaContext` in sea.js). The seat keeps `skew = serverNow - Date.now()` and runs fish.js on `Date.now() + skew`. The reel's `open` sends a fresh clock, env and take, and the bites are rolled on those, so they win while it's open. `land` is the server's land round her as a bitmask (fish.js `landMask`, 65 by 65 tiles, about 700 base64 characters): a school's habitat looks for shore out to 48 tiles, and the seat's own 33-tile window disagreed with the server about one school in a dozen.

**Shadows.** One soft dark silhouette per fish within 10 tiles, drawn after the water, depth-tested and writing no depth. They show only while she's anchored or under 2 mph, by daylight, and after dark only inside the lamp's 1.5 tiles (the skiff's battery lamp, switched in the seat). A deeper fish is fainter, through the seabed's own per-channel extinction, and softer: sharp above 4 m, soft to 10 m, a smudge below. True size from the helm; in the chase view they grow with distance from the eye, up to twice. GLASS 2 only, and nothing at all is worked out under way. `scripts/fish/smoke.mjs` holds the seat's list against the server's `fishNear` on the masked land at 192 points round the harbour.

**`look water`** (also `look sea`, `look over the side`, `examine water`) aboard names up to three schools in sight, nearest first: "A dark shape holds about twenty metres off the starboard bow, deep." Then rings where a shallow school is feeding at the top and a swirl where a runner turns hard. The rings and the swirl also go in the room prose (`zone.describeRoom`). It's an input matcher that returns undefined off a boat, so a shore player's `look water` is unchanged. At night the server sees only what the lamp lights: the seat reports the switch on `boatsync` (flags bit 1), and the text helm, which has no switch, counts a hull's lamp as lit.
