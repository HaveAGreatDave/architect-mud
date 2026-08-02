# Corporations & Player Orgs (Phases 0–2 + Corporate Assets A + Phase 3 War + Rackets Built; Rest Design)

> **Status: Phases 0–2 built; Phase 3 war/raids + destabilization built 2026-07-18; protection
> rackets built 2026-08-01** (see the
> build-order section). Espionage/sabotage, NPC corp AI, and the Architect reactive layer remain
> design. This is the agreed plan for
> HellMOO-style corps — organizations that both players and the AI run, that hold territory, money, and
> members, and that fight, scheme, and deal with each other under the Architect's indifferent eye.
> It deliberately adds **few new subsystems**: almost every mechanic generalizes an existing
> **single-owner** or **player-only** primitive up to the organization level. Read
> [systems-economy.md](systems-economy.md) (credits, vendors, apartment ownership),
> [systems-world.md](systems-world.md) (zones, scheduler ticks, power), [story.md](story.md) (the
> Architect, the five seed factions), and [docs/plugins.md](plugins.md) (plugin contract) first — this
> doc assumes all four.

## The one idea

**A corp is a faction that has an owner, a treasury, members, ranks, and territory.** The seed factions
(Custodians, Breakers, Archivists, Franchise, Glitch) are corps with **no player owner**, run by AI.
Player crews are corps **with** a player owner. Both share one model; the only difference is who makes
the decisions.

Today [ideologies.js](../server/engine/ideologies.js) (the renamed `factions.js`) is a **reputation
dispenser** — a table of definitions plus a `player_ideology_rep` ledger
([schema.js](../server/models/schema.js)). It has no owner, no
money, no members, no assets. Corps = bolt those five things on and let players *and* AI drive them.
Player reputation against each org stays exactly as it is; agency layers on top.

## Design decisions (settled)

| Decision | Choice |
|---|---|
| **Unify factions & orgs** | One concept. Fold `factions` into `orgs`; player rep continues to point at the org id, unchanged |
| **Territory capture** | **Influence tug-of-war** — a zone accrues/loses influence; ownership flips only past a threshold. Not an instant claim |
| **Membership** | **Single** — a player belongs to one corp at a time. Infiltration means actually defecting (higher stakes, simpler ranks/treasury checks) |
| **NPC parity** | NPC corps run on the same tables as player corps, driven by a corp-strategy tick, so the world churns with or without players |
| **Home** | Lives in a new `/plugins/corps/` plugin — org behavior is extensibility, not engine core |
| **The Architect** | Reacts to *concentration* of power (map share / treasury), never issues quests; the corp meta becomes the delivery vehicle for the "what does it want" thread |

## Every pillar rides an existing seam

| Pillar | Exists today as… | Becomes… |
|---|---|---|
| Invest in your corp | `players.credits/bank_credits`, `adjustCredits` ([economy.js:9](../server/engine/economy.js)) | an **org treasury** ledger + tiers |
| Buy territory | `apartments` = per-zone ownership row + upkeep + lock ([apartments.js](../server/engine/apartments.js)) | a **`zone_control`** row = per-zone org ownership |
| Own income assets | vendor safes, `atm_networks.faction_id` ([atm/index.js:37](../plugins/atm/index.js)) | org-owned vendors / ATMs / stations |
| Subterfuge | `steal`/`jack` checks; planned SPECTER spy nets; planned Crime system | org-level espionage / sabotage / laundering |
| Diplomacy | `factions.hostile_to[] / friendly_to[]` (fields exist, unused *between* factions) | live org-to-org relations |
| Aggression | full-loot PvP, zone `pvp_enabled`, turret/forcefield code | territory raids & declared war |
| NPC corps acting | VINE graphs + per-entity blackboard ([ai-behaviour.js](../server/engine/ai-behaviour.js)) | corp-strategy AI |

## Data model

Thin, mirroring the `apartments` pattern (one ownership row per thing, cached in `world`). All new tables
go into `SCHEMA_SQL` deliberately (no boot migration — see [CLAUDE.md](../CLAUDE.md)).

```
orgs           id, name, tag, owner_id (nullable → NPC-run), treasury, tier,
               is_npc, home_zone, relations JSONB, created_at
org_members    org_id, player_id, rank, joined_at, contributed_credits
zone_control   zone_id (PK), org_id, influence, upkeep, income_per_day,
               contested_by JSONB, captured_at            -- twin of `apartments`
org_assets     id, org_id, zone_id, type(vendor|atm|station|turret|spy), ref_id, level
```

`factions`/`player_faction_rep` either merge into `orgs` or reference it 1:1 (prefer the merge — one
concept beats two). `relations` is a JSONB map `{ orgId: 'ally'|'nap'|'hostile'|'war', ... }`, the live
generalization of the currently-dormant `hostile_to[] / friendly_to[]` fields.

## The five levers of power

### A. Economy & investment (the engine)
- **Org treasury** — reuse the credit invariant: an `adjustOrgTreasury` modeled on `adjustCredits` (never
  negative, single mutation point). Members `contribute`; officers `disburse`. This is the guild bank —
  worth raiding, worth stealing, worth defending.
- **Income** — held zones and org-owned vendors pay a daily cut into the treasury on the existing **24h
  tick** ([scheduler.js](../server/engine/scheduler.js)). Vendors already bank earnings
  (`vendor_bank_credits`); route a slice to the owning org.
- **Tiers** — spend treasury to raise **org tier**, unlocking more territory slots, higher member cap,
  and better assets (turret levels, ATM networks, crafting stations). A pure credit sink that buys map
  presence — the "invest in your corp" loop.

### B. Territory (the visible prize)
- **Claim** — `claim` a zone for your org: same shape as apartment `rent`, but org-owned and contestable.
  Costs credits + an org-tier gate.
- **Influence tug-of-war** — each controlled/contested zone carries an `influence` score. Claiming,
  spying, defending, and winning fights push it up for your org; rival action pushes it down. Ownership
  **flips only when influence crosses a threshold**, so territory is a slow contest, not a light switch —
  and both subterfuge and war feed the same meter.
- **Upkeep** — held zones drain treasury on the 24h tick (resolves the apartment-upkeep question already
  open in [design.md](design.md)). Overextend and you bleed out — the natural cap on runaway conquest.
- **Benefits of holding** — income cut, discounted/exclusive vendors, member safe-rest, turret defense,
  ATM-network fees.

### C. Subterfuge (the quiet game)
- **Espionage** — the planned **SPECTER** spy-network design *is* the corp intel layer: deploy spies in a
  rival's zone to reveal holdings, treasury estimates, and member movement, and to erode their influence
  quietly.
- **Sabotage** — `jack` a rival's vendor safe / ATM (existing hacking check), poison their income, forge
  credentials, and **launder** stolen credits through your treasury. The planned **Crime system** becomes
  the org-consequence layer here — theft with a corp behind it.
- **Infiltration** — with single membership, a spy must actually defect to a rival to leak their intel:
  higher stakes, cleaner checks. Great emergent-story fuel.

### D. Aggression (the loud game)
- **Declare war** — flips `relations` to `war` and enables **raids**: enter a contested zone and grind its
  influence down by force; the owner's turrets (`org_assets`) fight back. Full-loot PvP makes this brutal
  and legible.
- **Defense assets** — turrets, forcefields, raised lock difficulty (all have code precedent in
  doors/apartments).

### E. Diplomacy (the third path)
- **Tribute is built**, though not as an org-to-org stance: it landed as **protection rackets** on NPC
  shops (see the build-order entry below). Org-to-org tribute remains design.
- Driven by `relations`. Wire the dormant relation fields live: **non-aggression pacts, tribute, trade
  agreements, mergers, betrayal.** NPC corps evaluate relations in their strategy tick and react (tribute
  buys peace; a merger folds two orgs). "Being Inner-Circle with the Breakers makes the Custodians
  nervous" ([design.md](design.md)) stops being flavor and becomes a real relations delta.

## NPC corps as live actors

Two layers make the world feel alive rather than menu-driven:

- **Per-NPC** — VINE graphs already support a "faction rep" NPC. Add a hook so an NPC's behaviour keys off
  its org's current state (at war → hostile to enemy-org players; holds this zone → defends it).
- **Per-org strategy tick** — a new **corp AI** on a slow cadence (5m/30m) where each NPC-run org spends
  treasury, claims/defends zones, adjusts relations, and dispatches its NPCs — owned by the corps plugin
  the way the weather plugin owns its field. NPC corps expand, feud, and collapse whether or not players
  engage; players drop into an ongoing power struggle rather than starting one.

## The Architect layer

The bible is emphatic: the Architect is **indifferent infrastructure**, never a quest-giver, and *what it
wants* is the deepest thread ([story.md](story.md)). Corps give it something to be indifferent *about*:

- **The optimizer reacts to concentration.** When any org (player or NPC) takes too much of the map or
  hoards too large a treasury, the Architect "optimizes" — reroutes power away from their zones (the power
  grid + blackout lethality already exist), sends drones, culls. Not punishment — *deprecation.* The scar
  of over-winning.
- **Architect-Grade assets** are the top investment tier — that crafting tier already exists
  ([design.md](design.md)). Control of Architect-interface zones/stations becomes the late-game prize
  every corp fights over, tying into the rare **Architect Interface** skill.
- **Endgame** — corps eventually can't ignore it: fight it, feed it, or try to *speak* to it (the Glitch's
  whole belief). The corp meta becomes the delivery mechanism for the central mystery — you figure the
  Architect out by acting at the scale where it finally notices you. The arc *"nobody → somebody → legend
  or corpse"* extends to *"→ or something the Architect finds interesting."*

## Build order

- **Phase 0 — Orgs exist. ✅ BUILT 2026-07-02.** The 5 factions were folded into a unified `orgs` table
  (NPC ideologies are `is_npc=1`, owner-less; player rep keys off `orgs.id` — `getPlayerIdeologyRep`
  in [ideologies.js](../server/engine/ideologies.js) is the reader). Player crews live in the
  same table with an owner + a `treasury`. Implemented as the **[/plugins/corps/](../plugins/corps/index.js)**
  plugin, all verbs under `corp`/`org`: `found` (flat fee), `invite`/`accept`, `leave`, `kick`, `roster`,
  `contribute`/`disburse` (atomic via `withTransaction` + guarded treasury UPDATE), **custom ranks +
  permission bitmask** (`rank add/set/del`, `setrank`; bits in [org-perms.js](../server/engine/org-perms.js)),
  `edit name/desc/color`, a private **`#corp:<id>` channel** (`corp say`; dynamic seam in
  [channels.js](../server/engine/channels.js)), and a claimable **HQ** reusing the apartment substrate
  (`corp claim`; `apartments.owner_type='org'`/`owner_org_id`, ownership checks via `playerControlsApt` in
  [apartments.js](../server/engine/apartments.js)). Cache: `world.orgs`/`world.orgMembers`, re-synced by
  `reloadOrg`. Migration: `npm run db:fold-factions`, then `npm run db:drop-factions`. The legacy `factions`
  table is **dropped** — `GET /factions` and the DB backup now read `orgs WHERE is_npc=1` (+ `org_relations`);
  `player_ideology_rep` (renamed from `player_faction_rep`; its `ideology_id` points at `orgs.id`) holds
  reputation. `FACTION_MATCH` in the AI was
  **fixed** to read org membership (was reading a nonexistent `player.faction`). **Deferred within Phase 0:**
  HQ forcefield/home-bind/best-rest stay personal-only; NPC-faction-vs-player *reputation* reactions want a
  future async REP condition (FACTION_MATCH only covers crew membership).
- **Phase 1 — Territory. ✅ BUILT 2026-07-04.** `zone_control` table (one controller + `influence` 0–100
  grip + tracked `challenger_org_id` + base_income/base_upkeep), cached in `world.zoneControl`. Context-sensitive
  `corp claim` (apartment→HQ, claimable zone→territory; claimable = danger≠safe or `flags.claimable`), plus
  `corp contest` (an Intimidate check erodes a rival's grip; **seizes** the zone at 0%) and `corp reinforce`
  (spend treasury → +grip). 24h tick (`runTerritoryTick`, scheduled): income−upkeep to each controller's
  treasury (overextension bleeds it — the natural cap), uncontested grip consolidates toward 100, contested
  erodes and flips. **Architect heat** = concentration (zones held + treasury) → drives the console LED deck +
  sidebar. Client: console territory column shows real tug-bars (contested pulse, live-patched), and the
  **standalone strategic map** (`corp map` → `panels/corp-map.js`) tints the city grid by controlling org with
  per-zone influence, contested pulses, a legend, and a context-aware detail panel (claim/contest/reinforce
  where you stand). Verified: full loop DB test + regress 221/221.
- **Phase 2 — Investment. ✅ BUILT 2026-07-06.** `orgs.tier` (1–5, raised via **`corp invest`** — escalating treasury cost 2.5k/6k/12k/24k) gates **member cap** (5/10/20/35/50, enforced on invite/accept) + **territory slots** (2/4/7/11/16, enforced on claim) + the **asset level cap**. **`corp build extractor|turret`** installs/upgrades assets (`org_assets` table, one per type per zone, level ≤ tier): the **extractor** adds income (folded into the 24h tick + console/map), the **turret** is defence (blunts the grip lost to enemy `contest` *and* daily erosion, `max(1, erode − defence)`). Architect heat now also rises with tier + asset count. Client: console **Investment** block (tier · members/cap · zones/slots · Invest button) and the strategic-map detail panel shows assets + **+Extractor/+Turret** build buttons. Verified: DB loop (invest→tier, extractor income, turret defence) + regress 461/461.
- **Corporate Assets Phase A — self-running businesses. 🚧 SERVER CORE BUILT (design in [proposals/corporate-assets.md](proposals/corporate-assets.md)).** Corp-owned enterable income buildings that earn on their own. Built: the **`org_ventures`** table (`schema.js`, registered `runtime` in `content-registry.js`), world cache + accessors (`world.orgVentures`, `reloadOrgVenture`, `getVenture`, `getVentureByVendor` in [world.js](../server/engine/world.js)), the **`claimable_asset`** flag, and [`plugins/corps/ventures.js`](../plugins/corps/ventures.js): the `CORP_ASSET_TYPES` registry (**restaurant** built; `warehouse`/`security_office`/`front_office` are stubs), `corp asset list|claim`, a `vendor.purchase` listener that pays the owning corp a live sale cut (`vendor.js` now emits `price` on purchase), and a 24h tick (passive income floor − upkeep, dormancy/revive, influence projection). **Still pending:** the console/tablet render, a placed example venture, the full DB-loop verification, the non-restaurant asset types, and all staffing (Phase B).
- **Phase 3 — Conflict & diplomacy. 🚧 WAR + DESTABILIZATION BUILT 2026-07-18.** Two halves:
  **(a) Connective tissue** — every hostile act already emitting an event (`crime.witnessed`,
  `atm.jacked`, `hack.success`, `vendor.safeHackWitnessed`, `enemy.killed`/`npc.killed`,
  `player.death`) now nudges the influence meter through one funnel, **`applyInfluence`** (the single
  event-driven mutation point; `contest`/`reinforce`/`raid`/tick keep their own transactional paths).
  A hostile act on turf a **rival** corp holds saps that controller's grip (weights `DESTABILIZE`:
  petty 2 / hack 3 / kill 4) — **not** a gain for the actor, it just makes the zone ungovernable, and a
  standing challenger reaps any flip. `onHostileAct` early-returns with zero DB on the common case
  (uncontrolled zone / own turf / non-live actor), and a 15 s per-actor cooldown caps spam, so it's safe
  on hot events. Pure destabilization floors grip at 1% (you still must contest/raid to take a zone).
  **(b) War & raids** — `corp war <corp>` / `corp peace <corp>` (officer-gated `EDIT_CORP`) write a
  symmetric `'war'` stance into the dormant `org_relations` table (its first runtime reader, `isAtWar`),
  alerting both corps; `corp raid` is the loud game — war-gated, no Intimidate check (always lands),
  heavier flat erosion (`RAID_EROSION` 14, turret-soaked), faster flips than `contest`. `raid` is now
  its own verb (was an alias of `contest`). Verified: regress + an 8-check DB loop (funnel erosion,
  no-challenger floor, challenger-seize flip, symmetric war read). **Still pending:** espionage /
  sabotage as a distinct SPECTER intel layer, treasury raiding, turrets that deal HP back to the raider,
  and whether war enables broader PvP than just the raid verb.
- **Protection rackets — ✅ BUILT 2026-08-01** (lever E's "tribute", finally real; [rackets.js](../plugins/corps/rackets.js)).
  A corp that **controls** a zone can `shakedown <shopkeeper>` the NPC shops in it and skim a cut of
  every sale. The rule that shapes it: **the income decays and nothing tops it up for you.** Each shop
  carries a `fear` value stored in the new `org_rackets` table (`UNIQUE(npc_id)` — one racket per shop,
  so a rival can't move in on a shop that's still afraid of somebody else), and — exactly like
  `player_npc_relations` — `fear` is stored **as of `last_leaned_at` and never decayed by a write**:
  `fearNow()` computes it from elapsed time on read. **No decay tick**, restart-proof, and a corp that
  logged off for a month returns to precisely the decay it earned. Half-life is **10 real days**,
  deliberately *faster* than the 7-game-day rent clock so a racket never settles into feeling like a
  bill. The cut reads off **bands, not a curve** (terrified 20% / cowed 12% / wary 6% / slipping 2% /
  lapsed 0%) so a player can reason about what their book is worth.
  **The take is a TRANSFER, not a faucet** — unlike `handleVenturePurchase`, which mints its cut, the
  skim debits `npcs.vendor_credits` (the shop's actual till, physically held in its `vendor_safe`
  furniture). Three things fall out of that for free: an over-milked shop with an empty till simply
  pays nothing, so greed caps itself with no tuning knob; every credit skimmed is a credit a rival can
  no longer crack out of that safe, so the racket and the safe-hack fight over one pot; and it can't
  inflate the credit economy. The listener early-returns on a Map miss (`world.orgRackets` is keyed by
  **npc_id**, not zone, precisely so the buy hot path is O(1)), and re-checks `zone_control` at settle
  time — so **losing the zone silently stops the income** with no tick having to notice.
  Consequences reuse what exists: `adjustRelation` (the shopkeeper remembers, and warmth decays on its
  own half-life so grudges soften), a failed shakedown adds a `holdVendorGrudge` *and* costs an
  existing racket ground, and a new **`extortion`** crime key (2.5★) charged through the
  forced-witness convention — the corps plugin emits `extortion.witnessed` and surveillance decides.
  Destabilization needs no new wiring: `raiseCrime` already emits `crime.witnessed`, which the
  existing funnel consumes. New permission bit `PERM.RACKET`. **Still pending:** player storefronts as
  victims (the `storefront.sale` event is the exact twin of `vendor.purchase`, so it's a listener and
  config — but the PvP griefing surface wants its own counterplay design first), muscling in on a
  rival's racket, shopkeepers hiring their own protection, and NPC corps running rackets (Phase 4).
- **Phase 4 — NPC corp AI + the Architect reactive layer.**

Everything ships as a new **`/plugins/corps/`** plugin: scheduler hooks for ticks, the action/event bus
for mutations, REST routes for the dev panel.

## Open questions (to develop)
- **Influence sources & weights** — how much do claim / spy / raid / upkeep each move the meter, and how
  fast does uncontested influence decay?
- **Rank model** — fixed ranks (owner/officer/member) or per-corp custom ranks with permission bits?
- **Treasury raiding** — can a raid *steal* treasury, or only deny income? (Steal = higher stakes, bigger
  griefing surface.)
- **Corp count caps** — one corp per player as owner, or many? Member cap by tier?
- **Architect thresholds** — what map-share / treasury level triggers "optimization," and how loud is the
  telegraph before it hits?
- **Dev-panel surface** — how much of org/territory state is editable in the studio vs. purely
  player-driven at runtime?
</content>
</invoke>
