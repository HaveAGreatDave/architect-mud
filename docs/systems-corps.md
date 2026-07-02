# Corporations & Player Orgs (Phase 0 Built; Later Phases Design)

> **Status: Phase 0 built 2026-07-02** (the corps engine — see the build-order section). Territory,
> subterfuge, aggression, diplomacy, and NPC corp AI remain design. This is the agreed plan for
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

Today [factions.js](../server/engine/factions.js) is a **reputation dispenser** — a table of definitions
plus a `player_faction_rep` ledger ([schema.js:301](../server/models/schema.js)). It has no owner, no
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
  (NPC factions are `is_npc=1`, owner-less; player rep still keys off the preserved ids — `getPlayerFactionRep`
  in [factions.js](../server/engine/factions.js) is the one repointed reader). Player crews live in the
  same table with an owner + a `treasury`. Implemented as the **[/plugins/corps/](../plugins/corps/index.js)**
  plugin, all verbs under `corp`/`org`: `found` (flat fee), `invite`/`accept`, `leave`, `kick`, `roster`,
  `contribute`/`disburse` (atomic via `withTransaction` + guarded treasury UPDATE), **custom ranks +
  permission bitmask** (`rank add/set/del`, `setrank`; bits in [org-perms.js](../server/engine/org-perms.js)),
  `edit name/desc/color`, a private **`#corp:<id>` channel** (`corp say`; dynamic seam in
  [channels.js](../server/engine/channels.js)), and a claimable **HQ** reusing the apartment substrate
  (`corp claim`; `apartments.owner_type='org'`/`owner_org_id`, ownership checks via `playerControlsApt` in
  [apartments.js](../server/engine/apartments.js)). Cache: `world.orgs`/`world.orgMembers`, re-synced by
  `reloadOrg`. Migration: `npm run db:fold-factions`. **Deferred within Phase 0:** HQ forcefield/home-bind/
  best-rest stay personal-only; the legacy `factions` table is kept for the dev panel (repoint + drop is a
  fast-follow); `FACTION_MATCH` in the AI is still dead (players have no faction field).
- **Phase 1 — Territory.** `zone_control` + `claim`, the influence tug-of-war, upkeep + income on the 24h
  tick.
- **Phase 2 — Investment.** Org tiers, buy assets (vendors / ATMs / turrets / stations).
- **Phase 3 — Conflict & diplomacy.** War / raids, espionage / sabotage (SPECTER + Crime),
  treaties / relations.
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
