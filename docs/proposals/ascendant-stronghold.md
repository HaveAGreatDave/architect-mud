# Proposal: The Ascendant Stronghold (far-west campus + augment system)

**Status:** design only — not built. Gated on the Long Watch introduction proving
out first (see [Dependencies](#dependencies)). This doc is the workshopped spec so
the build can start cleanly once that lands.

## One-line

A monumental, unashamed chrome arcology in the far-western waste — the home base of
**The Ascendants** ([`ideology_ascendants`](../../content/orgs/ideology_ascendants.json)) —
that both *houses the faction* and *delivers the machine path as a real mechanic*:
installable cybernetic **augments**, the photo-negative of mutations. Discovery and
the secret **Halcyon** connection are locked to mid-game.

## Why this fits canon (don't reinvent around it)

Three things the existing content hands us for free:

1. **Ascendants are the Long Watch's photo-negative.** The Watch is *underground*
   (safehouses, paper maps, "keeps to the dark," no agent ever surfaces). So the
   Ascendant base is the opposite: monumental, gleaming, **flaunted**. That contrast
   is the whole reason to reveal them *after* the Watch intro lands.
2. **Halcyon Towers is already an Ascendant organ.** Halcyon's pitch —
   *"ASSURANCE FOR THE ASSURED"*, death-you-can-afford — is almost verbatim the
   Ascendant reader copy: *"death is a billing problem, and you keep your account
   paid up."* Halcyon is (secretly) the order's money-and-resurrection face. The
   west campus is the temple/R&D wing; Halcyon is the billing department.
3. **The reader copy is a literal ladder** — *"a jack, then a subdermal weave, then
   a backup of the one thing you were most afraid to lose."* Each rung is a building
   and an augment tier.

"Flaunting" means **it doesn't hide once you're there** — not visible from spawn.
It's over the horizon, across hostile waste; a bold newbie who treks west finds an
aloof fortress that turns them away, not a landmark on the starter map.

## Location

`map_world`, west of **Halcyon Towers** (`zone_district_895_906`, grid 895,906):
Halcyon Boulevard (894) → grasslands (893–891) → the campus and its approach further
west. Terrain-paint a manicured chrome plaza against the surrounding silver-green
wasteland for the establishing shot. Build the campus + a militarized approach
(The Threshold) as new zones off the western grasslands.

---

## The augment system (`plugins/augments/`)

Augments are the deliberate mechanical **mirror of mutations** — flesh (Wildblood)
vs. machine (Ascendant), the two ways to stop being baseline human. Same model,
inverted fiction.

| Axis | Mutation (flesh) | Augment (machine) |
|---|---|---|
| Source | Radiation, random 5%/min roll | **Chosen & paid** at the clinic (credits + rep) |
| Cost | Free but uncontrolled | Expensive; **rep bends the price** |
| Permanence | Permanent | **Installable / removable** — hardware to be upgraded |
| Slots | Unlimited, luck-driven | **Slot-limited** per body region |
| Path push | drifts flesh | install pushes `path_machine` ↑ |
| Social flag | `visibly_mutated` → outcast in Custodian zones | `visibly_augmented` → flinch in human/Wildblood zones, welcome here |

### Data model

| Table | Shape | Mirrors |
|---|---|---|
| `augments` (content) | `id, name, description, slot, tier, cost, stat_modifiers jsonb, soak jsonb, rep_gate, visible, special` | `mutations` — cached at boot, classified in `content-registry.js` |
| `player_augments` | `player_id, augment_id, slot, installed_at` | `player_mutations` (+ `slot`) |
| `player_backups` | `player_id PK, snapshot jsonb, restores_remaining int, saved_at` | new — save-state + prepaid counter |

Compliant with the no-new-`players`-columns rule (feature tables, not sparse columns).
Catalog cached in memory like `MUTATION_CACHE` so combat reads never hit the DB.

### Starter catalog

Slots follow the combat body-part model; tiers gate on Ascendant rep tier.

| Augment | Slot | Rep gate | Effect (via existing seams) |
|---|---|---|---|
| Dermal jack | neural | Unknown | +1 hack/tech skill; the first chrome — burns out mutations on install |
| Ocular array | eyes | Neutral | negates darkness to-hit penalty; +perceive |
| Subdermal weave | torso | Neutral | +kinetic/+energy `soak` (armor under clothes) |
| Myomer bundles | arms | Known | +Brawn `stat_modifier` |
| Sprint actuators | legs | Known | run costs less STA |
| Neural co-processor | neural (2nd) | Trusted | +skill checks; advanced hack |
| Rad-sealed chassis | torso (2nd) | Trusted | radiation immunity (chrome can't mutate) |
| Cortical backup | neural (core) | Inner Circle | enables the Halcyon restore loop; the summit rung |

Slot caps per region (e.g. 2 neural / 1 eyes / 2 torso / 1 arms / 1 legs) force real
builds. "Prices bend" = each rep tier drops cost and opens the next row (the literal
reader promise).

### Install / remove lifecycle

`grantMutation` ([mutations.js:40](../../server/engine/mutations.js#L40)) is the
template. Install:
1. Check slot free + rep ≥ `rep_gate` + credits.
2. Apply `stat_modifiers` additively to `players` columns + memory (same as
   `grantMutation`); reverse on remove.
3. `INSERT player_augments`.
4. Dispatch `ADJUST_PATH {machine,+δ}` **and** `ADJUST_REPUTATION` **negative** to
   Long Watch + Wildblood (the teeth), via the seams in
   [ideologies/index.js:107](../../plugins/ideologies/index.js#L107).
5. Recompute `visibly_augmented` and `chromed`.

Remove reverses 2–3 (the reason augments differ from permanent mutations).

### The three engine seams (named honestly)

Plugin-first, but chrome touches combat and death, so — like mutations — it needs a
few thin engine hooks. Three, all small:

1. **Soak** (the only genuinely new seam). `player.soak` is rebuilt by
   `recomputeArmor()` from equipped `armor_soak` tags
   ([combat.js:158](../../server/engine/combat.js#L158)); subdermal-weave soak would
   be wiped on every re-equip unless it's part of that build. Fix: `recomputeArmor`
   gains an **augment contribution pass** (or emits a contributor event the plugin
   fills). Non-soak augments (stats, skills) need none of this — they ride the
   mutation direct-stat path.
2. **Mutation block** (directional, deliberate). One guard in `checkMutationTrigger`
   ([mutations.js:23](../../server/engine/mutations.js#L23)): `if (player.chromed)
   return null` — chrome can't mutate. The **first install** burns existing mutations
   at the clinic (a warned, deliberate conversion). Destruction only ever happens on
   a choice at a terminal, **never** a random rad-mugging. `player.chromed` is a
   memory flag the plugin maintains.
3. **Backup respawn.** `player.respawnZone` fires in `handlePlayerDeath` **before**
   the corpse strips inventory, and a truthy `{zone, message}` return **routes
   respawn + skips the lootable corpse**
   ([gameLoop.js:479](../../server/engine/gameLoop.js#L479)). Backup hook: if
   `restores_remaining > 0`, return `{zone: Vats}`, decrement, restore the snapshot —
   since-save gear is destroyed (not dropped) = "restore to last backup state."
   **Precedence with jail:** jail already owns this hook and must win (a wanted death
   goes to Holding even if backed up — "jail still bites"). Backup only claims deaths
   jail didn't. Wire the ordering explicitly.

### Two deliberate improvements over the mutation implementation

- **`visibly_augmented` / `chromed` are derived at load, not stored columns.** The
  mutation doc flags a real bug — `visibly_mutated` is set in-session but not reloaded,
  so its outcast mechanic resets on reconnect. Computing from `player_augments` at
  boot/login dodges both the bug and the no-new-column rule.
- **Inverted outcast reuse.** `getCustodianOutcastResponse`
  ([mutations.js:90](../../server/engine/mutations.js#L90)) is the exact pattern for
  "humans flinch at chrome" — a mirror keyed on `visibly_augmented` in
  Watch/Wildblood zones, and a *welcome* (discount) in Ascendant zones.

### The backup loop ("death is a billing problem")

The cortical-backup augment enables a loop that turns *permanent* death-fear into a
*perpetual bill* — self-correcting, and the reason Halcyon exists.

1. **Own** the cortical-backup augment (Inner Circle) → eligible.
2. **Buy** prepaid restores at **Halcyon** (the secret front — this transaction is a
   reveal breadcrumb).
3. **Save** by visiting the **Vats** — snapshots inventory + credits + state into
   `player_backups` (a save point; returning to base becomes a ritual).
4. **Die** with a paid restore → respawn at the Vats, state rolled back to last
   snapshot, one restore consumed. Anything gained since the last save is lost.
5. **Zero restores** → you die like meat.
6. **Jail still bites** — arrest ≠ death, confiscation stays scary even for the
   backed-up.

Guardrails settled: **restore to last-backup state** (not full recovery, not lootable
corpse) and **prepaid policy at Halcyon** (not per-restore bill, not subscription).

---

## The campus — six buildings

Public plaza (they flaunt); The Threshold rejects the uncleared; inner ring gated.
Layout teaches the creed as you walk deeper in.

### 1. The Threshold — lethal-only-if-provoked checkpoint
The front door and the burial mechanism. A **3-state gate**:

| You do… | It does… | Lethal? |
|---|---|---|
| Walk up, uncleared | Firm rejection — Warden + guards turn you back, you learn nothing | No |
| Walk up, cleared (`ascendant_clearance` / rep) | Passage, welcomed by augment-count | No |
| Attack a guard, or force/run past | Turrets online, guards engage | **Yes** |

Wiring: default rejection = a **move-gate** on the inner exit (same class as
posture/water gates) checking clearance/rep/`visibly_augmented`. Escalation = the
existing turret mechanic ([mutations.js:95](../../server/engine/mutations.js#L95)),
re-armed by a **transgression event** (attacking a guard, or hammering the blocked
exit in `run` mode = a rush) rather than by mere entry. Guards are
`faction: ideology_ascendants` chrome enemies, passive/contemptuous until provoked.
NPC voice: **WARDEN UNIT "THRESHOLD"** (liturgical, cold).

### 2. The Spire — Ascendant Arcology (centerpiece / HQ / quests)
Rooms: `Grand Concourse` (public flaunt) · `Gallery of Rungs` (the ascension ladder
as exhibit / lore) · elevator · `Executive Sanctum` (Inner-Circle-gated summit — the
**Halcyon-seal reveal room**: the same calm-eye seal, now the Ascendant sigil).
NPCs: **Curator Vess** (concourse greeter/lore, evangelical-serene); **the First
Ascended** in the Sanctum (barely-flesh elder; gated quest-giver).

### 3. The Clinic — Chrome-Doctor's Theatre (augment vendor)
Rooms: `Consultation` (menu) · `The Theatre` (install). NPC: **Dr. Sable Kesh**
(clinical, faintly predatory warmth). Runs `install`/`remove`; catalog rows unlock by
rep tier ("labs open, prices bend"). First install = the mutation-burn conversion,
delivered as her line.

### 4. The Weave — Fabrication Foundry (craft chrome)
Rooms: `The Line` · `Stock Cage`. NPC: **Foreman Duc** (retired linesman, mostly
chrome, blunt). Sells components / augment crafting; ties to the crafting system.

### 5. The Vats — Resurrection Registry (save point + respawn)
Rooms: `The Registry` (`backup`/save) · `The Vat Hall` (respawn point). NPC:
**the Registrar** (soft-voiced clone-line construct, flat about death — "a billing
matter"). Home of the whole cortical-backup loop; `player.respawnZone` lands here.

### 6. The Architect Shrine — The Uplink (the faith; unique to this order)
Rooms: `The Nave` (cathedral of server-racks and cold light, echoing Halcyon's lobby)
· `The Uplink` (communion terminal). NPC: **Celebrant Orrin** (part-priest,
part-sysadmin; the only NPC who *loves* the Architect). Lore + stance/path nudges via
`ADJUST_STANCE`/`ADJUST_PATH`; the "join the god" set-piece.

---

## Discovery & gating (mid-game locked)

Two things stay buried: **(1) the complex exists** and — deeper — **(2) the Halcyon
tie**. The Threshold *is* the burial: uncleared visitors are turned away knowing
nothing, so existence may leak as an aloof rumor (*"a chrome fortress out west that
turns everyone away — nobody knows what they're guarding"*) but the *what* and the
Halcyon connection stay locked.

| To get… | You need |
|---|---|
| First rumor to seed | **Ideology engagement** — leaned, or any rep ≥ Known |
| Trailhead quest takeable | …**and** capstone flag `basin_veteran` **and** Long Watch intro complete |
| Past The Threshold | Clearance from the trailhead (temp pass → later, rep) |
| The Halcyon connection | Deep quest chain + Ascendant rep, revealed in the Sanctum |

Mid-game trigger = **ideology-engagement gate AND an authored capstone flag**
(`basin_veteran`, set by a hand-placed neutral quest arc) — designer-tunable, gives a
"world opens up" beat, and sits behind a long hallway of neutral job-board XP content.

## The reveal quest chain

Cross-quest chaining uses the **Flag mirror**, not a quest-level `requires` field:
each quest writes `quest_<id> = active|completed|turned_in`
([quests/index.js:42](../../plugins/quests/index.js#L42)); the next giver's dialogue
**Conditions** gate on those flags. Objective-level `requires`
([quests/index.js:136](../../plugins/quests/index.js#L136)) sequences steps within a
quest.

**The Long Watch sends you** — the Watch is anti-Ascendant and suspicious of
Halcyon's western payouts, so the reveal grows out of the Watch intro rather than just
sitting behind it.

Availability gate on the trailhead giver: `long_watch_intro = turned_in`
**AND** `basin_veteran = 1` **AND** ideology-engaged.

| # | Quest | Giver | Objectives | Sets | Payoff |
|---|---|---|---|---|---|
| Q1 | **Follow the Money** | A Long Watch contact | claims hall → tail the clerk (`requires` o0) → track west to a waypoint short of The Threshold → report | `quest_asc_money=turned_in` | *complex exists*; +Watch rep, XP |
| Q2 | **The Threshold** | Ascendant recruiter outside the wall | meet recruiter → small aligning favor → receive pass → walk through The Threshold | `ascendant_clearance=1` | *physical access*; first Ascendant rep |
| Q3 | **Assurance for the Assured** | Curator Vess → First Ascended | tour campus → witness a Vats "policy payout" → ascend to the Sanctum → the seal | `halcyon_reveal=1` | *the connection*; unlocks augment economy + backup loop |

Q3 also gates on Ascendant rep ≥ Known so the deepest secret can't be sprinted to.

---

## Dependencies

- **Long Watch introduction** must be built and prove out first. It supplies both the
  thematic contrast and the diegetic quest-giver (the Watch contact in Q1). Do not
  start this build until that lands.
- Capstone quest arc that sets `basin_veteran` (the mid-game trigger) must exist.

## Open risks to resolve at build time (look before committing)

1. **`recomputeArmor` augment pass** — decide hook-vs-contributor-event; the one
   genuinely new combat seam. Read the full recompute path first.
2. **Jail-vs-backup respawn precedence** — both hook `player.respawnZone`; jail must
   win. Confirm `fireHook` ordering/first-truthy semantics before wiring.
3. **`visibly_augmented` derivation at load** — ensure the boot/login path actually
   recomputes it (the bug the mutation version has).

## Build order & status

1. ✅ **Augment plugin core** — `plugins/augments/` (tables, catalog, `augment` verb, install/remove, slot caps, rep gate, path/rep dispatch) + regress. **Built, green.**
2. ⛔ The three engine seams (soak pass, mutation-block guard, backup respawn hook) — **not built** (deferred; see risks above).
3. ✅ **Campus zones** — 6 facades (892–893 × 905–907) + 12 interior rooms, generated by `scripts/build-ascendant-stronghold.mjs`; 5 edge trims make The Ascension Gate the sole Halcyon-side ingress. Shrine backs the Curtain. **Written to `content/zones/` (not yet imported — see below).**
4. ✅ **Bespoke 3D models** — `asc_spire/gate/clinic/weave/vats/shrine` in `windshield.js` (`drawTypeModel` cases + `ty_asc_*` palettes + `TYPE_MODEL` + `BLDG_TYPE_3D`), plus `BUILDING_TYPE_ICON` 2-D map glyphs in `world.js`. **Built; needs visual tuning in the running client.**
5. ✅ **NPCs (8)** — Warden Threshold, Maresh (recruiter), Curator Vess, The First Ascended, Dr Sable Kesh, Foreman Duc, The Registrar, Celebrant Orrin — with dialogue, generated by `scripts/build-ascendant-npcs.mjs`. **Written to `content/npcs/`.**
6. ✅ **The Threshold move-gate** — `plugins/ascendant/` registers `ascendant:threshold`: inner-ring tiles (`ascendant_campus`, minus the public `ascension_gate` face) refuse the uncleared from either side; rushing (`player.running`) draws a turret warning. Cleared = `ascendant_clearance` flag / Ascendant rep ≥ Known / already chromed. **Built, green (7 checks).** Lethal turret *fire* on force still pending (needs guard-enemy + turret-flag placement).
7. ✅ **The reveal quest chain + gossip seed** — `quest_asc_1` Follow the Money (Cyrelle, gated on **`lw_member`** — the Watch sends you), `quest_asc_2` The Threshold (Maresh → grants `ascendant_clearance`), `quest_asc_3` Assurance for the Assured (Vess → First Ascended → sets `halcyon_reveal`, big Ascendant rep). Cyrelle's trailhead appended additively. Ambient `asc_fortress` gossip rumour (ask-only) added to `plugins/gossip`. **Built; regress green.**
8. ⬜ Halcyon prepaid-policy vendor surface (the secret front / backup economy) — **pending** (couples to the deferred step-2 backup-respawn seam).

**Import caveat (2026-07-18):** the campus zones + augment catalog are authored to `content/` (git SSOT) but **not yet imported to the local DB** — `content:import` is blocked by unexported local edits from other in-flight work (barista/cook/greenroom/KSAB/sentinel NPCs + power_zones). Resolve that (export → commit/merge → import) to bring the campus live and testable. `augment_clinic` is set on the Clinic interiors, so `augment install/remove` works there once imported.

All shipped via the CODEX content pipeline; `npm run test:regress` before any push.
