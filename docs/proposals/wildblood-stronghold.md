# The Wildblood Stronghold — The Thornwarren (town BUILT; the arc below still design)

> **Status: the town SHIPPED 2026-08-12, somewhere else and much bigger.** The Thornwarren is a
> walled town of ~257 tiles with six NPCs in **The Scarletwastes**, a new region southeast of
> Coldwater — not the seven-tile camp south of the South Gate specced below, whose shells are now a
> forward picket. **The as-built record is [scarletwastes.md](scarletwastes.md); read that first.**
>
> What this doc still owns and what is still genuinely unbuilt: the **recruitment arc**
> (`quest_wild_proving` / `quest_wild_quickening` / `quest_wild_hunt`), the **`GRANT_MUTATION`
> action**, **`mut_thornhide`**, and the **item set** (mutagens, feral gear, rad-meds, rad-flora).
> The faction canon and the five-NPC sketch below were the source for the six who shipped; where the
> two disagree, the built town wins. Two of the sketched names collided with existing NPCs and were
> changed on the way in (Gristle Vane → **Gristle Thole**, Kesh → **Sill Moraine**).

> **Original status: design, 2026-07-17.** The renounce·flesh faction home in the wilds south of the Curtain.
> This is **Phase 1's faction content** — it sits behind the wall/gate/turret work in
> [systems-wildlands.md](../systems-wildlands.md) (read that first for the map, the Curtain, the Main
> Gate at `zone_district_918_919`, and the turret kill-zone). Depends on
> [systems-ideologies.md](../systems-ideologies.md) (rep/stance/path), [systems-survival.md](../systems-survival.md)
> (radiation/mutation), and [systems-economy.md](../systems-economy.md) (vendors). Sibling to the
> redeem-side [ascendant-stronghold.md](ascendant-stronghold.md) — same recruitment pattern, opposite
> pole of the stance axis.

## The faction (canon)

`content/orgs/ideology_wildblood.json` — **The Wildblood**, `renounce · flesh`, feral green `#6AB04C`,
creed *"Life survives by adapting, not by preserving,"* motto **adapt**, values
Adaptation/Freedom/Instinct/Evolution/Resilience. Its reader pull: *"The cage rusts. We are what grows
through the bars."* Elders "wear evolution openly." It renounces the Basin alongside the Exodus, and
quarrels only with those who'd *save* the city.

Their arm **inside** the walls already exists — the Breakers cell `npc_breaker_sledge/nyla/grease`
(faction `ideology_wildblood`, urban squat in a Meridian unit). **The Thornwarren is their heart
outside** — keep the new camp NPCs' voice/faction tagging consistent with that trio.

Keep the three renounce factions distinct: **Wildblood** = embrace the flesh/mutation (green, *adapt*);
**Exodus** = abandon everything, path *mind* (purple, *awaken*, explicitly rejects the Wildblood's
flesh path); **Pioneers** = ordinary humans rebuilding, path *human* (red, *build*, expansion-gated).

## The Thornwarren — camp footprint

A warren of salvage-and-bone shelters ringing a glowing rad-pool they revere, the **Quickening Pool**,
where they induce mutation on purpose. It sits ~6–7 tiles SE of the Main Gate, in hot marsh
(`terrain: dirt`/`sand`, radiation, no-safe-haven weather).

**As-built coordinates** (zones exist as shells; NPCs/vendor/quests pending):

| Zone | grid | Role |
|---|---|---|
| The Bone Arch | `919_924` | Camp threshold — a totem arch of welded bone (W← from marsh `918_924`) |
| The Commons | `919_925` | Central fire; the Chorus + stragglers; the social hub |
| Rindle's Lean-to | `918_925` | Wildblood vendor (mutagens, salvage, rad-flora, feral gear) |
| The Fleshery | `920_925` | Gristle's tent — the Quickening initiation |
| The Quickening Pool | `920_926` | Rad-pool set-piece (`radiation 65` → lethal); mutation site |
| The Chorus' Den | `919_926` | Elder / recruitment-arc giver |
| The Deeper Wild | `919_927` | Phase-2 stub → the Exodus road (currently a dead-end teaser) |

Approach: South Gate `918_919` → glacis `918_920/921/922` → hot marsh `918_923/924` → Bone Arch.

Ambient threats reuse the existing bestiary: `enemy_feral_dog`, `enemy_gutter_hound`,
`enemy_gutter_cat` roam the marsh (Bracken's pack); the Quickening Pool ticks `radiation` hard.

## The five NPCs (archetypes from `npc-personality.js`)

- **The Chorus** (elder, they/them; `cult_member`) — so mutated they speak in overlapping voices;
  wears evolution openly. Recruitment-arc giver. Unsettling, magnetic.
- **Gristle** (he/him; `scientist`/`doctor`) — the **fleshsmith** who performs the Quickening at the
  pool. Mutation-obsessed, gentle about it, which is worse.
- **Rindle** (she/her; `travelling_vendor`, `faction: ideology_wildblood`) — camp trader. Sells the
  net-new mutagen/feral-gear/rad-med items. `OPEN_SHOP` dialogue node (copy `npc_gunsmith_vega`).
- **Bracken** (he/him; `thug`/`mercenary`, `mis_attack`) — houndmaster; camp muscle + feral pack.
  Hostile to low-rep intruders; gives the first proving.
- **Pol, "the Twitching Man"** (`vagrant`) — half-mad straggler who found the camp; the breadcrumb /
  intro voice, and a warning of what the Quickening costs.

## Recruitment arc — rep tiers + quest flags

There is **no "join/member" primitive** for ideologies — membership is reputation tiers + the computed
lean only. Build the arc as a quest DAG whose beats gate on `quest_<id>` flags and rep tiers, each
firing `ADJUST_*` actions (all registered in `plugins/ideologies/index.js`). Tiers (`REP_TIERS`):
Unknown < Neutral(0) < Known(200) < Trusted(500) < Inner Circle(900).

1. **`quest_wild_proving` — "The Proving"** (Bracken/Pol). Reach the camp alive and do one renouncing
   act. Turn-in: `ADJUST_REPUTATION{ideology_wildblood, +150}` (→ **Known**), `ADJUST_STANCE{-10}`.
   Unlocks the Chorus.
2. **`quest_wild_quickening` — "The Quickening"** (Chorus → Gristle). Gated on rep ≥ Known. At the pool,
   Gristle grants your **first visible mutation**. Fires `ADJUST_PATH{flesh, +30}`,
   `ADJUST_STANCE{-20}`, `ADJUST_REPUTATION{+200}` (→ **Trusted**). The mutation sets `visibly_mutated`
   — **the point**: the city's Custodian zones and the Curtain turrets now read you as an invader. The
   loop closes.
3. **`quest_wild_hunt` — repeatable feral gigs** (hunt city drones / harvest rad-flora / raid a supply
   cache). Small `ADJUST_REPUTATION` each; the grind to **Inner Circle** and deeper mutation.

## The one net-new mechanic: a deterministic mutation grant

`grantMutation(player, mutation)` exists (`server/engine/mutations.js:40`) but is only ever called by
the *random* radiation roll — there is **no `GRANT_MUTATION` dispatchable action**. The Quickening
needs a chosen, guaranteed mutation, so add a thin action wrapping `grantMutation` (mirror the
ascendant-stronghold augment-`install` pattern). Author the initiation mutation itself: a signature
visible Wildblood mutation **`mut_thornhide`** (visible, small soak bonus, drawback "NPCs find you
unsettling"), or reuse `mut_bone_spurs` (already visible) as a fallback.

## Content to author (net-new)

- **Items** (none exist today): mutagens (drive `radiation`/grant-mutation), feral gear (bone/chitin
  armor pieces), rad-meds, rad-flora salvage. Follow [docs/items.md](../items.md).
- **`mut_thornhide`** mutation JSON (`content/mutations/`).
- **5 NPCs** + their dialogue trees / behaviour graphs (VINE), faction `ideology_wildblood`.
- **3 quests** (`content/quests/` via the `quests` plugin).
- The `GRANT_MUTATION` action (thin plugin action).

## Flexible at build time

- Exact mutagen/feral-gear/rad-med shop list for Rindle.
- `mut_thornhide` vs. reused `mut_bone_spurs` for the initiation.
- The specific renouncing act for "The Proving" (salvage fetch vs. Custodian-drone kill vs.
  rad-exposure).
