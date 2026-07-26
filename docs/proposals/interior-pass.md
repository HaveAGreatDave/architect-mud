# District Interior Pass v2 — Proposal & Phased Build Plan

**Status:** REPLANNED 2026-07-11, not built. Supersedes the 2026-07-03 plan, which targeted the
coldwater expansion districts (North City / Docks / Yards / Undermarket / Wastes) — **those zones no
longer exist**. The map migration (2026-07-11) replaced the surface with the generated 888-tile
district (`tools/zone-planner` + `bp_district`), and the population wave gave it street life, scav,
fishing, and spawns. What it still lacks is exactly what v1 was for: **insides**.

## Where the world actually is (audited 2026-07-11 — snapshot now stale)

> The 2026-07-24 doc audit re-counted: **149** zones now carry `flags.is_building`, not 18. The
> growth came from other builds (the [Yards](yards.md), the [Ascendant campus](ascendant-stronghold.md),
> The Reach), **not** from this pass — no tenement block or waterfront cluster from the phase table
> exists in `content/zones/`. The plan stands; the numbers below do not.

- **Surface:** 888 `zone_district_*` tiles on `map_world`. Sub-districts: water (257) / docks
  shoreline (64) / residential pocket (93, SE around Sump + Precinct 9) / wasteland flats (474,
  where nearly everything currently lives).
- **Buildings:** only **18 facade tiles** (`flags.is_building`), and **all 18 are already wired**
  to interiors — Chrome Court, Halcyon, Meridian, Embassy, Cherry Pit, the shops, Precinct 9,
  the power plant, the hangars, KSAB, Clone Facility, Ration Nine, Sump, Dead Pigeon.
- **Interiors:** 102 interior zones total, all pre-migration stock hanging off those 18 facades.
- So this pass is **not backfilling empty facades** — it is **stamping new buildings** onto a
  street grid that is alive at ground level and hollow everywhere else.

## What changed since v1 (and what it buys us)

1. **The zone-planner now does the wiring.** A building glyph in a blueprint produces the full
   facade shape automatically: non-standable `facade` tile that forwards into the lobby, an
   interior map row, and a `world_exit_zone` front door on the street. Re-apply is idempotent —
   planner-drawn geometry is reasserted, hand-written prose and hand-wired exits are preserved.
   v1's biggest risk (hand-wiring 50 interiors without breaking exits) is gone.
2. **The apartment eviction seam exists** (`findNearestVacantApartment` / `rehomeNpc` /
   `clearNpcResidence` in `server/engine/apartments.js`, in-tree as of this writing). Units can
   ship *occupied by NPC residents* and still be purchasable — buying one rehomes the tenant to
   the nearest vacancy. Housing can be lived-in from day one.
3. **The archetype registry + auto-clothing** means interior NPCs are cheap: pick a personality,
   they arrive dressed, with AT_HOME_LIFE sleep behaviour for residents.

**Build method per building:** paint the glyph in the planner (palette carries `building_type` +
lobby) → `apply.mjs` → replace `[PLANNER STUB]` prose by hand (UTF-8-no-BOM discipline) → door +
lock tier → junction box if multi-floor → NPCs/vendor/tout → furniture/safe/loot →
`npm run test:regress` → `content:export` → push (CODEX). *Stamp the shell, hand-sew the soul.*

## Locked decisions (carried from v1 + new)

| Decision | Choice |
|---|---|
| Coverage | ~30–40 new buildings across the district (~180–250 interior rooms) |
| Depth | Multi-floor where it fits; z-1 utility room + junction box on every multi-floor building (blackout parity) |
| Vendors | Vendor inside + tout/barker on the street (street life stays; shop is inhabited) |
| Housing | Ownable + NPC-resident units in the residential pocket; eviction seam used live |
| Phasing | By sub-district, each phase a shippable slice, regress + CODEX gated |
| Method | Planner stamps geometry; hand pass does prose, people, and loot |

## Phases

| # | Phase | Where | Scope | Point |
|---|---|---|---|---|
| 0 | **Prereqs** | — | Ship the in-tree batch (eviction machinery, door fixes); define 4–5 interior archetype kits as planner palette entries (shop, bar, tenement, warehouse, office); run planner lint clean | Make stamping cheap before stamping 30× |
| 1 | **The Tenements** | residential pocket (93 tiles) | 4–6 tenement blocks: lobby + 2–3 floors + 4–8 units each, z-1 utility. Most units NPC-homed from the archetype registry; a share purchasable (eviction seam). One flophouse tier, one decent block | Housing supply + the burglary/alarm/hololock/SPECTER playground, full of marks who are *home* |
| 2 | **The Waterfront** | docks shoreline (64 tiles) | Dive bar, fish market + cannery, harbourmaster/customs house, boatyard shed, cold store (z-1) | Gives fishing an economy sink and the smuggle border-funnel a physical customs house |
| 3 | **The Strip** | artery streets through the flats | 8–12 storefronts along Haul Road + avenues: pawn/fence, hardware, ammo, noodle bar, arcade, ripperdoc, gray-market backroom… every one a distinct draw; ATM placement rides along | The commercial spine — reasons to walk every avenue |
| 4 | **Landmarks** | flats, placed for geography | 2–4 multi-floor anchors: a bank, a transit depot (future fast-travel anchor per the expansion roadmap), a derelict office tower as a vertical scav dungeon (locked floors, roof, z-1 basement), one gag civic building | Memorable skyline + the roadmap's wayfinding anchors get real addresses |
| 5 | **The Crime Layer** | retro-pass over 1–4 | Distribute lock tiers/hololock difficulties, safes with real loot, alarm coverage, back doors/roof access, fence-able valuables | Turns interiors from scenery into gameplay — this is the phase that pays for the others |
| 6 | **Stitching** | everywhere | Quests that send players *into* the new interiors, first-visit lore tags, gossip hooks, camera feeds for broadcast | Discovery: the systems reach out and grab the player |

**Ordering rationale:** Phase 1 first because its engine seam is already in the tree and housing is
retention; Phase 2 second because fishing/smuggling are already live on those tiles and want
buildings; the Strip before Landmarks because vendors compound (economy nodes) while landmarks
decorate. Phase 5 is deliberately a separate pass — dressing crime affordances *after* the rooms
exist is faster and more even-handed than doing it building-by-building.

**Per-interior checklist:** planner glyph painted · stub prose replaced (glyphs intact, UTF-8 no
BOM) · door + lock tier · junction box if multi-floor · vendor/residents + tout · furniture / safe /
loot / scav table as fits · regress green · exported + pushed.

## Open items (resolve at build time, not blockers)

- Tenement unit counts + prices (flophouse vs. decent block), and how many ship player-purchasable
  vs. NPC-held.
- Whether the Strip gets a second chem lab / cook station or the existing one stays the only game
  in town (drug-economy funnel argument says: stays unique).
- Which building types need new minimap icons (`client/game/assets/zone-icons/`).
- Whether the office-tower basement pre-digs a sealed stub toward **The Under** (cheap now,
  valuable later — recommended).
- Deep-flats coverage: the 474 wasteland tiles get buildings only along arteries this pass;
  everything off-artery stays facade-less until a later ring wave (matches the roadmap's
  dense-core/sparse-frontier call).
