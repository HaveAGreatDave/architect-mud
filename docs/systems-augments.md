# Augments — chrome as a machine you own

**STATUS: BUILT** (2026-08-16). The install/slot/rep half shipped 2026-07-24 with
[proposals/ascendant-stronghold.md](proposals/ascendant-stronghold.md); the
maintenance half — hardware items, surgical risk, condition, calibration, heat,
overclock and death corruption — is this document. **Power shipped 2026-08-16**
along with the cortical rework (§8), pattern fidelity (§8c) and lethal overclock
faults. The unlicensed Promethean path and the paperdoll UI remain **design,
deliberately deferred** (§10).

Owned by [`plugins/augments/`](../plugins/augments/README.md).

---

## 1. What this is, and what it is the mirror of

Mutation is biological chaos: radiation-random, mostly unwanted, permanent, free.
Augments are the machine answer — **chosen, paid for, slot-limited, removable**,
and now also *maintained*. The two fantasies are deliberately different:

> Mutation asks **"what will my body become?"**
> Chrome asks **"how far can I push what I built?"**

The one-way door between them is unchanged and load-bearing: `player.chromed`
blocks `checkMutationTrigger`, and the first install calls `burnAllMutations()`.

## 2. The three lives of an augment

An augment is three things that used to be one, and keeping them separate is what
makes the rest of the system cost almost nothing to build:

| | Lives in | Is |
|---|---|---|
| **Catalog row** | `augments` (content, boot-cached) | what an author writes |
| **Item** | `player_inventory` | what you own but have not fitted |
| **Installed record** | `player_augments` (hydrated to RAM at login) | what is in you |

**Uninstalled chrome is an ordinary item.** It has a `condition`, it can be
bought, sold, stolen, dropped and looted, and it wears out in your pack exactly
like a coat — because as far as the engine is concerned it *is* one. Installing
consumes that row and carries its condition across. Removal hands one back.

That is why nothing here re-implements condition, quality, trade or looting: all
four already exist in [`durability.js`](../server/engine/durability.js) and
`player_inventory`. The only reason a bionics system would need its own versions
is if it refused to be an item first.

**Once installed it is body, not inventory.** It does not appear in your pack, it
cannot be handed over, and death corrupts it (§7).

## 3. The schema split — the whole design in one rule

> **Every column runtime mutates lives on `player_augments`. Every column an
> author writes lives on `augments`.**

Consequence: `content-registry.js` needs **no `excludeColumns` for either table**
and `content:lint` has nothing to trip on. If you are ever tempted to put, say,
an install counter on `augments`, that column needs an exclusion and will still
churn git diffs on every deploy. Don't.

Authored (`augments`): `item_id`, `salvage_item_id`, `install_difficulty`,
`licensed`, `overclock_max`, `heat_rate`, `power_draw`, `failure_messages`.
Runtime (`player_augments`): `condition`, `calibration`, `install_quality`,
`overclock_level`, `custom_data`.

### The migration invariant

`calibration` defaults to **100**, and contribution scales
`0.5 + 0.5 × (calibration/100)`. So 100 reproduces the authored value *exactly*,
and every augment already installed on a live character was arithmetically
unchanged by the move off baked stats. `regress.js` asserts it three ways.

### Temperature and stress are memory-only, and that is not a bug

There is no heat column and there must not be one. Heat lives in
`player._augHeat`, decays **lazily from a timestamp on read** (the hygiene
`_sweat` idiom — no tick, no timer), and cools off entirely on logout, which is
correct for a minutes-scale phenomenon. What *survives* a session is the
**condition** the heat burned, which is durable and flushed coalesced.

## 4. Persistence — two paths, on purpose

- **A deliberate act** (tuning, setting an overclock, install, repair) writes
  through *immediately* via `persistRec`. The player just chose it; a crash
  before the next tick must not eat it.
- **Accrued damage** (heat wear, a fault fired from the sync strain path) cannot
  await at its call site and rides a coalesced 1m flush.

This is also why **there is no logout flush**: everything a player *did* is
already on disk, and the ≤60s of accrued wear a logout drops is the same heat
that logging out was going to cool off anyway.

## 5. Surgery

### The floor — chrome is the Ascendants' discipline

`MIN_INSTALL_TIER` (`install.js`) is a **floor under every install**: `known` with
`ideology_ascendants`, resolved together with the piece's own `rep_gate` so
whichever is higher wins. A piece authored above the floor keeps its own rung
untouched (the cortical backup is `inner_circle` and stays there).

It is stated once, in code, rather than trusted to every author remembering,
because the failure is silent: **a new augment with no `rep_gate` would quietly
become the free entry rung**, and nobody would notice until a player with no
Ascendant standing at all was walking around chromed.

`known` is deliberately the value — a character who has never met an Ascendant
already sits at `neutral`, so gating there reads as a gate and functions as an
open door.

⚠ When the unlicensed Promethean path (§10) is built, **this constant is what it
carves its exemption out of** — an unlicensed cutter is supposed to be how you get
chrome without kneeling to the campus. Until then there is no back door, and that
is intentional rather than an oversight.

A surgeon is **an NPC with flat flags**, the `flags.repairman` precedent exactly —
so an unlicensed back-alley cutter is a JSON file and *zero code*:

```
flags.surgeon            true          the marker
flags.surgeon_skill      0..10         their hands; drives the roll
flags.surgeon_rate       0.4..1.8      price multiplier on the fitting fee
flags.surgeon_risk       0.00..0.30    added complication chance
flags.surgeon_licensed   1 | 0         Ascendant credentials, or none
```

The zone still opts in with `flags.augment_clinic` — theatre and person are
separate, so a clinic with nobody in it refuses you.

**You pay before the roll**, as the clinic and the repair bench both do. You are
buying the attempt, not the result.

`margin = (2d8−2d8) + surgeon_skill − difficulty`, where difficulty is built from
`install_difficulty` + a `log10(cost)` grade + a neural penalty + unlicensed hands
on licensed chrome + a crowded body + how worn the hardware already is. Five
bands seed condition **1.00 → 0.45** and calibration **85 → 20**, with trauma
scaling; `botched` **permanently caps calibration at 50**, the one outcome no
later technician can undo. And a sixth result, worse than all of them: at
`margin < −10` the hardware is **destroyed on the table** and you still paid.

**Every band seeds calibration below 100.** Fresh chrome always under-performs,
and tuning is how you get the number on the tin. Regress asserts it.

Removal rolls too, at three cheaper bands — without that, remove→reinstall is a
free unlimited re-roll of the install band.

The player can see all of this first: `augment quote <name>` prints each
surgeon's stars, complication rate and fee. A surgery system that surprises you
is a dice game wearing a clinic's coat.

## 6. Calibration, and the board

Condition is how beaten up a thing is. **Calibration is how well it is tuned**,
and the two are independent on purpose: 100% condition at 62% calibration is a
machine that is physically perfect and running badly. Repair fixes the first;
`calibrate` fixes the second, consuming a `calibration_rig` item (or using a
clinic bench, which is better — a reason to walk somewhere, not a reason to be
stuck).

The board is `aug_calibration`
([`calibration.js`](../client/game/js/panels/calibration.js) +
[`textcalibration.js`](../client/game/js/panels/textcalibration.js)): three
stages — PHASE, BALANCE, SETTLE — on a bench scope rather than an intrusion deck,
because the machine is *yours* and already open.

**It reports a 0–100 score, not a win.** Every other family in the game is a
boolean, and a boolean would collapse calibration into a coin flip. The synth
family already proved the score wire.

**The client is bounded, not trusted.** Pending map + nonce + TTL, the score
clamped `0..100` on the first line, and the board's entire authority is **±15**
around a server-side `electronics` check. Reporting a perfect run buys the top of
that band against a roll you still have to make.

Two rules keep the verb alive:
- **A tune never lowers calibration.** If a bad roll could make things worse
  nobody would risk one and the verb would be dead on arrival.
- **The board is upside, never a tax.** A player who cannot or will not play it
  still got working chrome from the install bands.

All three Display Mode rungs are covered: graphical, the character twin (the
*same* generator and scaling, not an easier game), and the `log` rung, which
`textRender` resolves server-side. Note `textRender` now takes a `{ skill }`
option — the bottom rung defaulted to `hacking` because every family that existed
when the ladder was built was an intrusion game, and this one is not.

## 7. Overclock, heat, and coming apart

`augment overclock <name> <level>` sets how far past spec you run.
`overclock_max` is one authored field, and **that field is the entire mechanical
statement of the faction split**: licensed Ascendant chrome ships 0–1, unlicensed
chrome will ship 3. Nothing else in the code knows the difference.

Heat accrues through **[`server/engine/strain.js`](../server/engine/strain.js)**,
a new engine substrate registered the way `durability.wear()` works and governed
by the same contract: **sync, memory-only, no awaits, no queries**, called per
swing and per hit from `combat.js`. An augment with `heat_rate: 0` never gets a
Map entry, so unchromed and lightly-chromed players cost the hot path nothing.

`augScale = (0.5 + 0.5·cal/100) × (1 + 0.25·oc) × conditionPenalty` — the last
term reuses durability's own band penalty so chrome and a coat read in the same
currency. Above **Hot**, strain converts to durable condition loss; at
**Critical** a fault can fire, its chance mitigated by calibration. That is the
loop closing: **tuning buys you output *and* the headroom to survive it.**

**No prose in the code.** What a failing arm says comes from
`failure_messages` — an actuator locks, an optic tears into bands of static, a
co-processor drops synchronisation. `loadAugments()` warns at boot and
**regress fails the build** for any overclockable augment with no authored voice.
"Bionic malfunction." is the failure this guards against.

**Zero condition does not destroy installed chrome** (unlike `durability.js`
rule 4). It goes *dead* — inert, still in you, waiting for a surgeon. An item
disintegrating inside a torso is neither narratable nor actionable; walking to a
clinic is.

## 8. Death corruption

Installed hardware is keyed to a living nervous system. When that stops, it
corrupts, leaving a `ruined <name>` item in the corpse — scrap value and repair
stock, tagged `no_install`, never fittable. **Without this, expensive chrome is a
reason to hunt players rather than to be one**, and every fight is a harvest.

**Graded, not total**: each augment rolls independently, weighted by condition
(`0.35 × condition`, so pristine chrome sometimes comes through and failing
chrome never does). Total corruption would mean two bad deaths cost five figures
*and* close the flesh path forever, which is out of proportion to the problem —
which is looting, and a graded roll solves that just as completely.

### The ordering trap

Corruption is skipped **only** when somebody took literal **custody** of the
body. Today that is jail and nothing else — the cops confiscate gear, not your
spine, and there is no corpse left in the room to salvage onto.

⚠ **This inverted on 2026-08-16, and the inversion is the point.** It used to be
skipped on `claimed` too, which meant a cortical restore kept its chrome. A
restore that *saves* your hardware is a rollback, and a rollback can put back a
thing you no longer own. Now the old body's chrome corrupts for real, the
wreckage lands on the corpse where anyone can go and look at it, and the vats
print **new** hardware from the pattern (§8a). `player.death` carries `corpseId`,
`claimed`, `custody` and the winning `override` so a subscriber can tell the
difference; ordering lives in the single subscriber in
[`plugins/augments/index.js`](../plugins/augments/index.js), because `emit` is
fire-and-forget and will not order three of them for you.

### The two interlocks corruption exposed

1. **`player.chromed` was derived from "any row exists"** — so a death that
   corrupted everything would silently un-chrome you and re-open the flesh path,
   undoing the one irreversible decision in the game. A `chromed_ever` player
   flag is OR'd into the derivation.
2. **The cortical backup restored possessions** — see §8a. It is now the only
   thing in the loop that does *not* touch your possessions.

## 8a. The pattern is who you are, never what you had

The restore used to snapshot your inventory at the `backup` verb and roll it back
on death. That was retired on 2026-08-16 for two reasons, one mechanical and one
worse.

**Mechanical:** a snapshot remembers what you *had*, so it could re-create an
item you had since given away — back up holding a thing, hand it to an alt, die,
and the thing exists twice. It also returned a truthy override, which skipped
`spawnPlayerCorpse` **entirely**, so a paid-up player's killer got nothing and
carried credits were never converted to a chip. Death, for the insured, did not
happen.

**Worse:** "you get your bag back" is a logistics convenience. It is not an
identity, and it is not what this faction sells. It reads as a receipt.

So the loop is now:

| Step | What happens |
|---|---|
| `backup` at the Registry | A **re-scan**, ₵900. Registers `pattern_at` and raises `copy_fidelity`. Touches no inventory. |
| You die | Ordinary death. Corpse on the floor with your bag and credit chip, lootable by anyone. |
| Capture | The live `player_augments` roster is frozen **before** corruption runs. |
| Corruption | The old chrome is destroyed; ruined salvage lands on your corpse. |
| Re-print | The vats manufacture the roster again — condition, calibration and a botched ceiling all carry; `overclock_level` does **not**, because a fresh print is at spec. |

⚠ **The capture is what makes this unexploitable.** The pattern is read from the
live rows at the moment of death, never from the stored row, so an augment you
removed to an item and sold last week is simply *not in it*. Nothing is created
that did not exist a second earlier, and the original is provably scrap in a
room. Do not "optimise" this by snapshotting the roster at `backup` time — that
re-opens the exact hole the inventory half was deleted for.

⚠ **The spend is one guarded statement and that is the rollback.** It used to be
decremented in `player.respawnZone`, which runs *before* the engine picks a
winning override — so a death jail went on to claim had already burned ₵2500 with
nothing to undo it. `reprintClone` now owns the only decrement, guarded on
`restores_remaining >= 1`, and the hook writes nothing at all.

Credits were removed from the snapshot earlier for the same family of reasons
(back up rich, bank it, die, be handed the old balance) and stay removed.

## 8c. Pattern fidelity, and print artifacts

Every re-print costs `copy_fidelity` (100 down, floored at 35). A re-scan buys it
back, which is what makes the ritual the recurring product rather than the
one-time ₵6000 implant.

Fidelity **caps calibration at read time**, in `augScale(rec, fidelity)` — a
scalar argument, not a player, because `augScale` must not learn whose body it is
in (§ the note on `getAugments`). ⚠ **It is never baked**: `calibration` on the
row is untouched, so a re-scan instantly restores tuning the player already paid
for. Bake it and the re-scan becomes a repair bill. `augScale(rec, 100)` is
arithmetically identical to the old one-argument call, which preserves the
migration invariant the suite asserts.

It also surfaces as **print artifacts** — five named, visible rungs (seams at 88,
mismatched irises at 75, wrong fingerprints at 60, a static voice at 45, a
half-beat flinch at the floor) rendered through `player.appearanceNotes`, so a
much-restored Ascendant reads as one on sight with no stat panel involved. Tone
rule: small and manufacturing-flavoured, never body horror, and **nobody in the
world ever remarks on one out loud**.

⚠ `player.appearanceNotes` was converted from `fireHook` to `gatherHook` in the
same change. It had five registrants and last-non-undefined won, so whichever
plugin loaded last silently ate the others' lines — the same bug `describe.js`
records having already fixed for `zone.describeRoom`.

## 8b. Luxury is drawn in what is absent

The Ascendant tier has to *feel* like the best medicine in the Basin, not merely
roll better — that is the faction's whole seduction (§ [systems-ideologies](systems-ideologies.md)).
Their corruption only works if their medicine is genuinely excellent.

The tell that it wasn't landing: the **free** Architect clone vat has a full
staged emergence — the shock of consciousness, the meat reporting in, an
industrial gantry dressing you "with the tenderness of an industrial press", an
invoice stamped `COMPLIMENTARY`. The **paid** Ascendant restore had one line and
no ceremony at all. The expensive path was the plainer one, and no balance number
fixes that.

`scheduleAscendantEmergence` (`backup.js`) is the answer, and it is written as a
set of **absences**: no gantry, no invoice, no stamp, nobody in the room
mentioning what it cost. You are attended by a person rather than processed by a
machine; your own clothes are laundered and folded on a chair; the money was
settled at Halcyon long ago by a version of you with the leisure to plan for it.
The free vat's joke is that it prints you a bill and eats it. The premium one's
is that **the question never comes up in the room.**

The same split runs through surgery. `BAND_LINES` has two registers — licensed
work is private medicine (cool light, managed discomfort, a form to sign when it
goes wrong); unlicensed work is a folding table and a work lamp, and you are
awake for more of it. **The mechanical outcome for a given margin is identical.**
The bands do not care who cut you, so the prose is purely what the money bought,
which is the honest thing for luxury to be. `augment quote` follows suit: it
sorts best-hands-first like the sales document it is, and licensed entries sell
the *room and the aftercare* — the things that never appear on a stat line — while
unlicensed entries sell the price, because that is all they have.

**None of it uses an em dash.** The exemption in [story.md](story.md) covers an
Ascendant NPC's own *speech*; the rule explicitly names narration as not exempt,
and room prose and emergence beats are narration. The luxury is carried by what
the sentences notice (a glass already poured, warmed towels, somebody whose whole
job is watching your numbers) rather than by punctuation borrowed from a voice
that is not currently talking.

Dr Sable Kesh (`npc_asc_kesh`, the Improvement Suite) is the benchmark:
`surgeon_skill: 9`, `surgeon_rate: 1.6`, `surgeon_risk: 0.015`. Excellent, and
priced like it.

## 9. Engine seams

| Seam | Where | Note |
|---|---|---|
| `registerStatContributor` | `condition.js` (**new**) | derived stats. The engine must not import a plugin. |
| `registerArmorContributor` | `commands/inventory.js` | subdermal soak, now **scaled** by `augScale` — a battered uncalibrated weave genuinely stops less. |
| `registerStrainContributor` | `strain.js` (**new**) | heat on the combat hot path, sync by contract. |
| `player.respawnZone` / `player.death` | `gameLoop.js` | the restore claim, corruption, and the re-print. |
| `player.appearanceNotes` | `commands/world.js` | print artifacts. **`gatherHook`**, converted from `fireHook` — see §8c. |

## 11a. Power (built 2026-08-16)

`augments.power_draw` was authored on every augment from the beginning and read
by nothing for months. [`plugins/augments/power.js`](../plugins/augments/power.js)
is its reader.

Total draw is `Σ power_draw × (1 + overclock_level)`, so pushing past spec costs
fuel in the same proportion it costs heat. Charge lives in
`player_augments.custom_data` on the new `aug_power_cell`, and a flat cell takes
chrome **inert, not damaged** — registered through `registerAugmentDown`, the one
funnel `getAugments` already runs, so stats, soak and strain inherit brownout
without a second implementation. `augment charge` tops up anywhere on mains
(reading `getZonePowerStatus`, which means a player generator back-feeding a
junction box already works), an `ascendant_campus` zone does it passively, and a
**fresh re-print emerges full** — which is the mechanical reason the campus is a
place you come back to.

⚠ **Charge is persisted; heat is not; do not read the heat rule and apply it to
charge.** They err in opposite directions. Logout cooling your heat off is
generous and harmless. Logout *recharging* you would solve the entire logistics
problem with alt-F4. Charge is checkpoint tier — written when the rate changes or
on a top-up, decayed lazily from its own timestamp, never on a tick.

⚠ **`METABOLIC_TRICKLE` exists so this could ship without bricking anybody.**
Every live character already had chrome and none had a cell, because the cell did
not exist until the day it shipped. A flat reserve against a typical rig is about
an hour of play and then permanent brownout for people who did nothing wrong. The
trickle carries a light rig indefinitely and only the excess draws down, so the
cell buys what it should buy: a big rig, overclocking, and the wastes. If you
retune it, the deploy-day question is the one to re-ask.

## 11b. Overclock faults now hurt you

A fault used to cost `condition` and nothing else, so overclocking had no failure
mode a player could feel. It now also strikes the body through
`applyStrikeToPlayer` — the part roll, typed soak and injury's damage observers
all apply, because a plugin writing `player.hp` directly skips every one of them.

⚠ **Floored below `overclock_max`, unfloored at it.** Running inside what the
casting is rated for hurts and cannot kill. Running at the ceiling can — and
since unlicensed chrome ships `overclock_max: 3` where licensed ships 0–1, that
is where the faction split acquires a body count, and precisely what the cortical
policy is for. Their answer to a lethal failure mode is not a safer part; it is a
second body.

⚠ The strike is **detached** (`onStrain` is sync by contract) and guarded on
`_dying`/`hp <= 0`, so a fault rolled on the blow that killed you cannot land on
the corpse or on the clone that replaced it. ⚠ A regress suite that drives a
max-overclock fault on the **shared** fake player must restore its hp afterwards,
or three unrelated checks fail with "You don't have Test Weave installed" — a
message pointing nowhere near overclocking.

## 10. Deliberately deferred

*(Power moved out of this list on 2026-08-16 — see §11a.)*

- **The Promethean path** — `ideology_prometheans` (redeem·machine·**human**:
  machine without the Architect's leash) as the unlicensed rival. Cheap surgeons,
  real overclock headroom, no credentials. It is content: NPC files with
  `surgeon_licensed: 0` and catalog rows with `overclock_max: 3`.
  *Not* `ideology_synthesis`, which is an authored redeem·**flesh** order — guided
  mutation, the Wildblood's gentler rival — and not `plugins/synthesis/`, which is
  drug chemistry.
- **Clothing/armour refusal** via the registered-and-empty
  [`equip-gates.js`](../server/engine/equip-gates.js), written for exactly this.
- **Multi-limb chrome** via `registerBodyPartProvider`, the way mutations grow parts.
- **The paperdoll UI.** Reusing it is not free: it is inline functions inside
  `tablet-os.js`, not a component, and there are already two independent
  silhouette renderers (`tablet-os.js`, `wardrobe.js`). There were three until
  `card-render.js` was deleted on 2026-09-02 with the card portrait face.
  Extracting one shared doll is its own task; the `augment` verbs carry the
  system without it.

## 11. Verification

```bash
npm run test:regress
```

59 augments checks, including the migration invariant, `players.stat_*` never
being written, all five install bands, the tuning bounds, sync-and-lazy heat,
death corruption, both interlocks, and the guard that fails the build for
overclockable chrome with no authored failure voice.
