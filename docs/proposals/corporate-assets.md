# Corporate Assets — Evolution of the Corporation System

> **Status: Phase A server core BUILT (2026-07); rest is proposal.** The `org_ventures`
> table, world cache/accessors, the `claimable_asset` flag, and `plugins/corps/ventures.js`
> (restaurant asset type + `corp asset list|claim` + a live `vendor.purchase` sale-cut listener
> + the 24h income tick) have shipped. **Also since shipped** (stamped 2026-07-24 by doc audit,
> which found these still listed as pending): the corp console UI
> (`client/game/js/panels/corp-console.js`), placed ventures in content (`flags.claimable_asset`
> on the shop/clinic/casino interiors), and the **warehouse** type — no longer a stub, it backs
> the pooled Logistics Store (`plugins/corps/ventures.js:149-163`, `corp warehouse
> list|deposit|withdraw`) and the [Yards district](yards.md) that exercises it. Still pending:
> `security_office` and `front_office` (honest stubs with TODO effects,
> `plugins/corps/ventures.js:49-50`) and all staffing (Phase B). See the build-order note in
> [../systems-corps.md](../systems-corps.md). The working instructions below tell Claude how to
> approach the remaining build.

---

## Working Instructions

This document is an implementation spec, not a request to start coding. Read it, read the
codebase it points to, then produce a roadmap and clarify open questions **before** writing code.
The goal is to **evolve the shipped Corporation system**, not build a new one.

The project's standing rules (Think Before Coding, Simplicity First, Surgical Changes, ask when
unsure, plugins over engine edits, engine-vs-content separation) live in `CLAUDE.md` and apply as
always — they are not repeated here. This document only adds what's specific to *this* effort.

### Start here — the system you're extending already exists

Corporations are built through Phase 2. Before proposing anything, read:

- `plugins/corps/index.js` — the shipped corp plugin (~1000 lines): identity, ranks + permission
  bitmask, atomic treasury, HQ-on-apartment substrate, territory tug-of-war, tiers, buildable assets.
- `docs/systems-corps.md` — the design + build order. Phases 0–2 done; Phase 3 (conflict/diplomacy)
  and Phase 4 (NPC corp AI + Architect reactive layer) are still design.
Corporate Assets is **not** a single-seam extension — a "restaurant a corp owns" is an *enterable
place*, not an invisible income modifier. It likely **composes four existing seams**; confirm which
combination fits before designing, and don't force it into just one:

1. **`apartments` ownership substrate** (`server/engine/apartments.js`) — the `owner_org_id` /
   `owner_type='org'` pattern the HQ already uses is how a corp *owns a building*.
2. **Interior Pass** (`docs/proposals/interior-pass.md`) — making facades enterable, vendors moving
   inside. Corporate Assets is plausibly the economic layer *on top of* Interior Pass; the two plans
   must know about each other.
3. **Vendors / commerce** (`plugins/commerce`, `vendor_bank_credits`) — an asset's income is players
   buying from it, not only a flat tick. `systems-corps.md` already notes routing a vendor slice to
   the owning org.
4. **`org_assets` economics** (`ASSETS` registry, `plugins/corps/index.js:44`) — the leveling /
   upkeep / 24h-tick-settlement machinery. This is the *accountant*, not the building.

The **"building framework"** may genuinely not exist yet — Corporate Assets could be the thing that
creates it, at the intersection of the four seams above.

**Map my vocabulary to the codebase's before proposing.** Where my terms don't match, correct me:

| I may say | The repo actually has |
|---|---|
| Real Estate plugin / model | `apartments` — an engine substrate (`server/engine/apartments.js`), no plugin |
| Region system / Region Editor | **zones**, edited in the **dev panel** (`/dev`) |
| Building framework | doesn't exist yet — this build may create it (see the four seams above) |
| Permission system | `server/engine/org-perms.js` — a corp-scoped permission bitmask |

Do not extend a system I named until you've confirmed what it's actually called and how it works.

### The five rules specific to this work

1. **Generic, not hardcoded.** Build a Corporate Asset framework that a restaurant *configures into*,
   not restaurant-specific code. New building types should be data + registration, not new architecture.

2. **Prove the framework with exactly one reference building — no more.** Build one fully-working
   example (e.g. a restaurant). **Tiebreaker for rule 1 vs. "don't over-abstract":** if a *second*
   building would need new architecture, the seam is wrong — stop and surface it rather than papering
   over it. One reference building is the proof; the framework earns its generality by fitting the
   next one with config alone.

3. **Register reference buildings; don't place them in the world.** Make them spawnable via the dev
   panel and available to designers. Populating the map is a content task, not this engineering task
   (matches the engine-vs-content rule in `CLAUDE.md`).

4. **Future-proof the seam, don't build the future.** Charters, divisions, conglomerates, political
   influence, new Tablet apps — ensure Phase 1 doesn't *preclude* them. Do not implement them.

5. **Performance: follow the patterns already in the corp plugin.** Settle periodic economics on the
   existing **24h scheduler tick** (`runTerritoryTick` is the model), read from the **world cache**
   (`getZoneControl`, `getOrgAssets`, `getOrgZones`), and push incremental console patches
   (`pushConsole`) rather than recomputing. No polling loops, no whole-world scans, no per-request DB
   reads for state that's already cached. When two approaches differ in cost, state the tradeoff before
   choosing.

### Before implementing — clarify, then plan

For any architectural decision that can't be inferred from the codebase, **stop and ask**, as
multiple choice where possible:

> Corporate Assets should be implemented by:
> A. Extending the `org_assets` table + `ASSETS` registry.
> B. A new asset entity alongside `org_assets`.
> C. Another approach (explain why the existing seam doesn't fit).

Repeat until the major decisions are settled. Then produce a roadmap — milestones, plugin
responsibilities, schema changes (into `SCHEMA_SQL`, no boot migration), UI/Tablet work, network
messages, event flow, and testing (`npm run test:regress` is the gate) — and wait for review before
coding. When you introduce any new abstraction, say why an existing one couldn't be extended.

Implement one feature at a time; each must pass regress and not break existing corp gameplay before
the next begins.

### Success criteria

A successful implementation reads as a natural extension of `plugins/corps/` — corporations become
another way to interact with the existing city, economy, and players, not an isolated management
screen. Maintainable, extensible, performant, and true to the grounded persistent world.

---

## Specification

### The one idea

**A Corporate Asset is an enterable building a corp owns and operates for income and influence.** It
generalizes the HQ (a corp-owned apartment) into a *productive* corp-owned place: a restaurant, a
warehouse, a security office, a front office. It reuses four existing seams — apartments ownership,
Interior Pass interiors, commerce vendors, and the `org_assets` tick/upkeep machinery — and adds one
new thing: a **type registry** that says what each building kind *does*. Restaurants are its first
entry; the other three are registered stubs that prove the framework generalizes.

### Settled design decisions

| Decision | Choice |
|---|---|
| **Income** | **Hybrid, low-yield** — a modest passive floor on the 24h tick + a live cut of vendor sales. Phase A assets are **self-running** (no staff needed) — they make sense to run on their own |
| **Territory** | **Independent but synergistic** — you can own an asset in a zone you don't militarily control; operating assets *project influence* for your org on the tick, feeding the `zone_control` war from the economic side |
| **Acquisition** | **Both** — *claim* a designer-placed vacant building shell (like an HQ), or *build* by stamping a designer-authored blueprint onto a designer-marked buildable plot |
| **Staffing** | **Deferred to Phase B** — hiring NPC staff turns a self-running business into a higher-yield **NPC-run** one. Phase A needs no staff |
| **Failure** | **Dormant, not destroyed** — an asset whose treasury can't cover its (low, flat) upkeep goes dormant until refunded; rarely triggered for self-running assets |

### Content-pipeline reconciliation (hard constraint)

"Build new" must not populate the map from code. **Build = instantiate a designer-authored blueprint
onto a designer-marked plot.** Designers author the interior template (a prefab zone + furniture +
vendor) and flag certain empty lots `flags.buildable_plot`. A corp spending treasury to build *copies*
that already-authored blueprint onto that plot. Authorship stays with designers; the corp only triggers
instantiation. Claiming, likewise, only targets designer-placed vacant shells (`flags.claimable_asset`).

### Data model

Reuse the apartments row for **ownership + door/access** (exactly as HQ does today), and add one table
for **venture economics**:

```
apartments        (existing) — owner_type='org', owner_org_id set on the asset's interior zone.
                  Handles who owns it + lock/access. No change to the table.

org_ventures      id, org_id, zone_id (the interior; UNIQUE), asset_type,
                  level, dormant, staff_count (0 until Phase B),
                  blueprint_id (NULL if claimed), vendor_id (storefront vendor NPC id, NULL until wired),
                  acquired_at
```

> **Naming (settled):** `org_ventures`, not `corp_assets` — the existing `org_assets` table already
> holds the invisible turret/extractor *zone modifiers*, so a "venture" (a corp's operating business at
> a location) keeps the two unambiguous. Feature stays "Corporate Assets" player-facing.

All new columns/tables go into `SCHEMA_SQL` (idempotent, no boot migration). `org_ventures` is cached in
`world` alongside `zoneControl`/`orgAssets`, re-synced on mutation — never a per-request DB read.

### Type registry

Modeled on the `ASSETS` object at `plugins/corps/index.js:44`, richer:

```
CORP_ASSET_TYPES = {
  restaurant: {
    label, passiveFloor, activeShare (frac of sales → treasury), upkeep,
    influenceProjection, blueprint: 'blueprint_restaurant',
    // Phase B adds staffing: staffRequired, wagePerStaff, staffedYield multiplier
  },
  warehouse:      { ... }   // STUB — bulk corp storage / smuggling cut
  security_office:{ ... }   // STUB — defense/heat reduction for nearby owned zones
  front_office:   { ... }   // STUB — recruitment desk / cheaper tier-ups / admin
}
```

Only `restaurant` is built out. The stubs carry real registry entries with `TODO` effects, so adding
one later is config, not architecture (rule 2).

### Mechanics

- **Income (hybrid, low-yield, self-running).** On the 24h tick (sibling to `runTerritoryTick`, in the
  corps plugin): a non-dormant asset adds `passiveFloor × level − upkeep` to its org's treasury. Live: a
  `vendor.purchase` listener routes `activeShare` of every sale at the asset's storefront vendor into the
  treasury (the emit at `vendor.js:159` gains a `price` field — the one cross-plugin touch). Idle earns
  the modest floor; a frequented storefront earns real money. **No staff, no wages** — Phase A assets
  run on their own.
- **Synergy (influence projection, Phase A).** Each operating asset adds `influenceProjection × level`
  to its zone's `zone_control.influence` for its org on the tick. In an *unclaimed* zone this can
  soft-seed control at a low grip — an economic route into the territory war — kept modest so military
  `claim`/`contest` stays primary.
- **Staffing (Phase B).** `staff_count` (column present, `0` in Phase A) becomes a yield multiplier:
  hire NPC staff (`corp asset staff hire|fire [n]`) to turn a self-running business into a higher-yield
  NPC-run one; wages join upkeep; a business that *requires* staff and loses them goes dormant. The
  reference restaurant may render a small capped set of flavor staff NPCs while staffed (cosmetic; the
  *count* drives economics, not spawned entities).
- **Failure.** Treasury can't cover upkeep (+ wages, once Phase B) → asset flips `dormant` (stops
  earning + projecting), not destroyed. Refund/restaff to revive. Rare for low-upkeep self-running
  assets. Long-dormant repossession is a later phase.
- **Architect heat.** `architectHeat` already counts asset count; extend it to weigh `org_ventures`
  (economic concentration draws the optimizer, same as territory).

### Acquisition flows

- **Claim** — stand in a vacant shell (`flags.claimable_asset`): `corp asset claim` → pay a treasury
  fee → write the apartments ownership row (like `cmdClaimHQ`) + a `corp_assets` row, activate the
  vendor. Nearly identical to HQ claiming.
- **Build** — stand on a `flags.buildable_plot` that lists allowed blueprints: `corp asset build
  <type>` → pay build cost → **instantiate the blueprint** (copy the prefab zone + furniture + vendor
  into the plot's target, idempotently) + write the `corp_assets` row. Blueprint instantiation is the
  one genuinely new mechanism — it must be idempotent and only ever copy designer-authored templates.

### Surfaces

- **Corp console** (`buildConsolePayload`) gains an **Assets** block: per-asset type, zone, dormant
  flag, today's floor + live take (staff/req join it in Phase B). Pushed via the existing `pushConsole`
  patch.
- **Tablet** corp-app (`plugins/tablet/corp-app.js`) gets an Assets screen reusing that payload —
  **in Phase A** (pulled forward so assets are manageable from the tablet from day one).
- **Dev panel** (Phase C): a Corp Assets tab — the blueprint registry, "mark plot buildable," "place
  vacant shell" tooling. For Phase A, `flags.claimable_asset` is set via the existing zone flag editor.
- **Verbs**: everything routes under the existing `corp`/`org` dispatcher as `corp asset …`
  subcommands — no new top-level verbs (matches how the plugin already namespaces).

### Event flow

- Emit `corp.asset.claimed` / `corp.asset.built` / `corp.asset.dormant` on the event bus.
- Hook `commerce` purchases to route the active share (the one cross-plugin seam).
- The asset tick lives in the corps plugin's scheduler registration, beside the territory tick.

### Build order

**Sequencing decision (settled):** ship a complete *self-running* economic loop first (claim → income
→ influence → surfaces), against interiors that already exist. Staffing/NPC-run businesses come next,
then blueprints, letting the *risky new mechanism* (blueprint instantiation) land last, behind a proven
loop. **Zero dependency on Interior Pass** for Phase A.

- **Phase A — Self-running assets + full surfacing (no staff, no new interiors).** `org_ventures`
  schema + `world` cache, type registry, restaurant type, claim flow against **enterable zones that
  already exist** (`flags.claimable_asset`; a self-running eatery = owned interior + storefront vendor +
  low income), **hybrid low-yield income** (passive floor tick + live `vendor.purchase` active share),
  **influence projection** into `zone_control`, **console + Tablet** Assets surfaces, and **one example
  restaurant placed as content** to dogfood the walk-in→claim loop. `regress.js` covers the full loop.
- **Phase B — Staffing & NPC-run businesses.** `staff_count` becomes a yield multiplier; hire/fire NPC
  staff; wages join upkeep; staff-required businesses go dormant if unstaffed; optional flavor staff
  NPCs. Higher-yield business tiers.
- **Phase C — Build & blueprints.** A thin self-authored set of "commercial unit" interiors + buildable
  plots + blueprint instantiation + dev-panel authoring. Interior Pass later supersedes this substrate
  without changing the economics above it.
- **Phase D — Remaining types + polish.** Warehouse / security office / front office fleshed from stubs;
  Architect-heat weighting refinement; long-dormant repossession. The framework must merely allow them.

### Testing

`plugins/corps/regress.js` gains an asset loop: found corp → flag a test zone `claimable_asset` → claim
→ assert `org_ventures` row + ownership → simulate a `vendor.purchase` at its vendor → assert active
share hit the treasury → run the asset tick → assert floor − upkeep applied + influence projected →
drain the treasury → tick → assert dormant → refund → assert revived. `npm run test:regress` is the
gate before any push (per `CLAUDE.md`).

### Open questions

- **Active-share balance** — starting at 20%; watch it doesn't unbalance the drug/vendor economy.
- **Soft-seed strength** — how much influence a pure economic presence should project before it
  trivializes military claims (starting low).
- **Phase B staffing shape** — flavor NPCs cosmetic-only, or eventually assignable/kill-able (griefing
  surface)?
