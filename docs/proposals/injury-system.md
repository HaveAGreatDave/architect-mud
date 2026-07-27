# Injuries — Proposal

**Status: BUILT (Phases 1–5); Phase 4 tuning awaits playtest, §8b enemy injuries deferred.**
Drafted and shipped 2026-07-27.

*Built:* the `damage-events.js` and `impairment.js` substrates and their call sites; the injury
plugin (storage, lazy decay, type curves, naming, penalties, medicine, the `injuries` verb,
`examine` notes); the Vitals paper doll; the `treat_injury` item tag on five existing medical items;
wound clearing through the existing `clinic` plugin. **Wounds appear, are named, penalise, heal on
their own, and can be treated.**

*Not built:* §8b (injuries on enemies) — deliberately deferred until the §10 kill criterion has been
evaluated in play. Phase 4's numbers are in place with a compounding guard in the regress suite, but
the actual balance pass needs playtesting and has not happened.

Combat resolves to a specific body part with typed soak, and then throws all of it away at the
moment of impact. A blow to the knee and a blow to the chest produce the same aftermath: a smaller
number. This proposes the missing half — a wound that outlives the fight, located on the part that
was already rolled, with a character set by the damage type that was already resolved.

The design constraint that governs every decision below:

> **An injury is something you notice, not something you administer.**

No new bar, no new tablet app, no consumable you are obliged to carry, no state in which the correct
play is to stand still and apply items. Wounds always heal on their own. Medicine only makes it
faster, and buys back the one thing time alone won't.

---

## 1. Why this is cheap

Every piece this needs already exists and is already load-bearing.

| What it needs | Where it already is |
|---|---|
| A struck body part | `rollBodyPart()` — every damage path |
| A damage type | `damageType` / typed `components` — every damage path |
| A place to hang the hook | `wearStruckArmor(player, part)`, called at every one of those sites |
| Stat penalties | `registerStatusEffect`'s `stats` bag (`effects.js:22`) |
| Movement penalties | the move-gate registry |
| Lazy time-decay with no tick | the `player_npc_relations` pattern (`systems-relationships.md`) |
| Bounded bands over a raw scalar | the durability band model (`systems-durability.md`) |
| Treatment priced off an NPC | `relationHelp`, as the repairman already does |

The damage sites are `combat.js:549` (enemy→player), `:646` (`applyStrikeToPlayer`, environmental
and air-to-ground), and `:720` (PvP). All three already roll a part and already know the type.

### The dead seam this revives

`docs/combat.md:114` records that weapons' `status_chance` tag "is read but **never used**." There
is already an authored, never-honored field meaning *"this weapon inflicts a condition."* Injury-on-hit
is its natural consumer: existing content lights up rather than needing a new field.

---

## 2. The model

### One injury per part. Seven parts. Seven slots, forever.

The parts are the ones combat already rolls (`combat.js:254`): `head`, `torso`, `left_arm`,
`right_arm`, `left_leg`, `right_leg`, `feet`. Arms and legs are **lateralized**, which this design
gets for free — "your left leg is fractured" needs no new modelling, and a player with two ruined
legs is a distinct, worse state than one with a bad knee.

A second wound to an already-wounded part **deepens the existing one** rather than stacking. This is
the single most important anti-busywork decision: injury state is bounded, small, and maps onto a
body the player already understands. There is no list that grows.

### Three severities, and the bottom one is free

Mirrors durability's five bands where the top two are mechanically free — a shape players have
already been taught to read.

- **Bruised** — flavor only. Shows on `examine`, affects nothing. Most hits land here.
- **Hurt** — one penalty, tied to what that part does.
- **Maimed** — the same penalty harder, plus it is visible to anyone who looks at you.

### The penalty is derived from the part, never authored

Seven rules, total. No per-weapon, per-enemy, or per-item authoring anywhere.

| Part | Hurt | Maimed |
|---|---|---|
| `head` | −1 Brains | −1 Brains, −1 Cool, degraded `look` |
| `torso` | stamina regen slowed | stamina regen slowed hard |
| `left_arm` / `right_arm` | −to-hit | −to-hit, cannot two-hand; drop chance when hit |
| `left_leg` / `right_leg` | slower movement | no run; **both** maimed = cannot walk, only crawl |
| `feet` | slower movement | no run |

Lateralization earns its keep in the arms and legs rows: one bad leg slows you, two ruined legs
stop you. That escalation is free — it's a count, not a rule.

---

## 3. Damage type: character, never consequence

**The part owns the penalty. The type only modifies its character** — how likely, how bad, how long,
and what it reads like. Type never answers "what does it do."

This is the rule that stops the design becoming a 5×6 matrix of 30 outcomes nobody will see. Adding a
sixth damage type later costs one row, not six cells.

The enum is closed and small — `kinetic`, `edged`, `energy`, `fire`, `radiation`
(`client/shared/tagCatalog.js:115`).

| Type | Threshold<br>(frac of max HP to injure at all) | Escalation | Heals | Cumulative | Character |
|---|---|---|---|---|---|
| `edged` | low | shallow | slow | no | Cuts easily, bleeds, lingers |
| `kinetic` | **high** | **steep** | fast | **yes** | Glances off, glances off, then breaks something |
| `energy` | moderate | moderate | slow | no | Cauterized, deep, doesn't bleed |
| `fire` | moderate | shallow | very slow | **yes** | Burns; the type that scars |
| `radiation` | very low | very shallow | barely | no | Doesn't present at once; the worst to carry |

Read the `kinetic` row: most blunt hits do nothing, and then one does everything. A pipe glances off
your ribs eleven times and the twelfth breaks them. That is how blunt trauma actually behaves, it is
more interesting than the edged curve, and **there is no cap on it** — a fracture has no business
being milder than a cut.

`edged` is the opposite character: injures constantly, rarely catastrophically. A thousand cuts
versus one bad swing. Neither is strictly better, which is the point.

**`cumulative`** (one boolean): on a part that is *already* injured, the threshold is reduced. Blunt
and fire wear you down across a fight; edged and energy hit at a flat rate. This costs one comparison
against state we are already storing.

### Two behaviors that emerge for free

Worth protecting, because they deepen whenever anyone tunes something else and never need maintaining:

- **Blunt is disproportionately concussive.** Head hits are scaled by `head_damage_multiplier` *before*
  the threshold check (`combat.js:540`, `:644`), so a blunt hit to the head clears kinetic's high bar
  ~1.5× more often. Zero head-specific code.
- **Blunt defeats armor.** Typed soak means a vest subtracts little from kinetic and a lot from edged
  (`combat.js:547`). Vests already stop knives better than clubs in authored soak data, so
  "blunt gets through" falls out of existing content.

### Balance warning

Steep kinetic escalation, the head multiplier, and `cumulative` all compound in the same direction.
Blunt weapons will produce Maimed head injuries more often than any one rule suggests. **Tune
kinetic's threshold high initially** and bring it down from playtesting.

---

## 4. Granularity without expense: name it, don't model it

Mechanical granularity stays fixed at **3 rungs × 6 parts, forever.** Perceived granularity is
unbounded and made of strings.

`(type, severity, part)` selects a **name** with no mechanical consequence:

| | |
|---|---|
| Maimed + kinetic + legs | *fractured* |
| Maimed + edged + legs | *laid open* |
| Maimed + fire + hands | *burned through* |
| Hurt + kinetic + head | *concussed* |
| Hurt + edged + torso | *gashed* |
| Hurt + radiation + torso | *sloughing* |

A player reading "your left leg is fractured" versus "laid open" experiences two different systems.
The engine sees one Maimed leg. This is content, not code: it lives in the plugin's tables, scales as
far as anyone cares to write, and adding a name never touches a rule. Tone is governed by
[story.md](../story.md), not by the combat math.

### Unauthored is a valid state

Fully populated the table is 5 types × 3 severities × 6 parts = 90 strings, which is the one surface
in this design with real growth. **It must never be obligatory to fill.** Lookup falls back:

```
(type, severity, part)  →  (type, severity)  →  (severity)  →  generic
```

Exactly the way `text_by_relation` falls back to a node's ordinary text — an NPC with no authoring
behaves as it always did. Ship ~15 names, add one when a combination reads flat, and never treat an
empty cell as a gap.

---

## 5. Earning one, and healing it

### Earning

Deliberately rare. An injury requires a hit that **got through** — the threshold is measured against
damage *after* soak, so armor that did its job prevents the wound outright. That is a second reason
to wear armor, and it makes durability's "your vest is Failing" warning bite considerably harder.

Ordinary chip damage produces nothing. In a normal fight you leave with zero or one. In a bad fight
you limp.

### Healing — the part that keeps it out of the way

**Lazy decay on read, no tick** — exactly the `player_npc_relations` pattern. Store
`{ part, severity, type, at }`; compute current severity from elapsed game time whenever something
asks. Zero scheduled work, zero hot-path writes, and a restart cannot reset anyone's injuries.

Maimed → Hurt over a couple of hours, Hurt → Bruised, Bruised expires. **Sleeping accelerates it
substantially**, which finally gives sleep a second reason to exist beyond the `rested` buff and
rewards a behavior players already have somewhere to perform.

---

## 6. Medical equipment

### The content is already waiting for this

[`item_field_splint`](../../content/items/item_field_splint.json) is described as *"Sets the break
well enough that you can limp somewhere better."* It restores 20 HP. The prose was authored for a
fracture system that has never existed. Several medical items are in the same position: authored as
if wounds were real, implemented as HP numbers.

**Pre-existing defect to fix in the same pass:** `item_medkit` and `item_trauma_kit` are **both named
"trauma kit"** with identical `heal_over_time` values — a name collision and a functional twin. One
should become the field-grade item and the other the surgical one (see the table), which resolves the
duplicate as a side effect of giving each a distinct job.

### The rule that keeps medicine from becoming busywork

**Nothing is ever required.** Every wound heals on its own. Medicine buys *time*, and at the top end
buys the one thing time alone won't. There is no bandage-per-wound, no application minigame, no
re-application timer, and no state where you are stuck because you didn't shop.

### The tiers

Each item drops severity, and the tier determines **how far it can drop you** — the same field-vs-bench
shape durability's repair already uses, and for the same reason: the good outcome must be somewhere
you have to go.

| Tier | Item | Effect | Floor |
|---|---|---|---|
| Improvised | `item_rag_bandage` | −1 severity, slow, can fail | cannot clear a wound |
| Field | `item_bandage` | −1 severity | stops at Bruised |
| Specialist | `item_field_splint` | −1 severity, **only kinetic wounds**, and sets it — halves remaining heal time | stops at Bruised |
| Trauma | `item_trauma_kit` | −1 severity on **every** injured part at once | stops at Bruised |
| Surgical | the existing `clinic` plugin | clears a wound **outright**, including Maimed | none |

Two things fall out of this table that are worth stating plainly:

- **A splint is the correct answer to a fracture and useless on a burn.** Damage type becomes
  something you carry gear *for*, not just something that happens to you. The splint's existing
  description becomes literally true with no rewrite.
- **A trauma kit is worth its weight only when you are badly hurt** — it treats everything at once,
  so it is wasted on one bruised arm and decisive when you limped out of an ambush with four wounds.
  It earns its 500g and its price without a single new stat.

Nothing above can clear a Maimed injury except a doctor. Field medicine gets you walking; it does not
make you whole. That is what makes a clinic a destination rather than a vendor.

### The doctor — extend the clinic plugin, don't invent a flag

**Correction to an earlier draft of this section.** There is already a `clinic` plugin: a single
`CLINIC_TREAT` Action, no state and no tables, whose price is read *flat off the dialogue node* —
`max(minimum, ceil(missingHP × rate)) + (bleeding ? bleed_fee : 0)` — so a back-alley cutter and a
corporate trauma bay charge different money off the same Action. Medics already sell supplies
through an ordinary vendor node.

That is the right home, and it means Phase 5 needs **no new NPC flag and no new verb**:

- Add a `wound_fee` parameter alongside the existing flat params. Clearing a Maimed wound is
  surgical work and should be quoted as such — the pricing model already supports charging per
  problem rather than per HP.
- `CLINIC_TREAT` clears injuries outright as part of what it already does (it restores HP to max and
  clears `bleeding` today).
- Every existing clinic gains wound treatment the moment the parameter is authored on its node.
  Nothing needs placing.

`relationHelp` pricing is still worth wanting — a medic who knows you charging less is an immediate,
legible payoff for [`player_npc_relations`](../systems-relationships.md) — but it belongs as a
change to the clinic plugin's quote, not as a parallel system.

---

## 6b. The paper doll — reading it at a glance

The Vitals app is the right home, and the existing app has an explicit design rule worth quoting
(`tablet-os.js:3989`):

> *"The colour is the whole interface: a player should be able to open this, see one red bar, and
> close it again without reading a word. Bands come from the server (good/warn/bad/crit) so the
> client never decides what 'bad' means."*

A body diagram is the purest possible expression of that rule, and injuries are the first data this
game has had that is genuinely *spatial*. A list of six wounds is worse than a picture of a body in
every way.

### The payload

`buildScreen`'s VITALS branch gains one field, and it always contains **all six parts** — an
uninjured part renders neutral rather than being absent, so the doll is a whole body rather than a
scatter of marks:

```js
body: [
  { part: 'legs', severity: 'maimed', band: 'crit', name: 'fractured',
    detail: 'Left leg fractured. You cannot run.' },
  { part: 'head', severity: null, band: 'good', name: null, detail: null },
  …
]
```

`band` reuses the existing `good`/`warn`/`bad`/`crit` vocabulary, so the doll inherits the app's
palette for free and the client stays out of the judgment business. Mapping is direct: no injury →
`good`, Bruised → `warn`, Hurt → `bad`, Maimed → `crit`.

### The render

An inline SVG figure with six addressable regions keyed by part id, filled from `band` with the same
CSS classes the meters already use. Roughly 40 lines of client code and one hand-authored SVG path
set. It sits **above** the meters — it's the fastest read on the screen and should be first.

**Interaction: tap-to-reveal, not hover.** The tablet is a touch metaphor and hover tooltips are a
desktop assumption that doesn't survive contact with it. Tapping a part fills a detail line beneath
the doll with that part's `detail` string; tapping a healthy part says so. A `title` attribute can
ride along for desktop hover as a freebie, but the tap line is the real interface.

### It must degrade to nothing

If the injury plugin is disabled, the `body` field is simply absent and the doll doesn't render —
Vitals is exactly what it is today. **No hard dependency from the tablet to the injury plugin**; the
health app already owns no health logic by design (`health-app.js:3`) and this must not be the thing
that breaks that.

### Why it pays for itself twice

`PART_TO_SLOT` (`combat.js:256`) already maps every body part to the equip slot that covers it. Once
a body diagram exists, it is the natural display for **armor coverage** and **per-slot gear condition**
— "this part is red because it's hurt" and "this part is unprotected" and "the plate covering it is
Failing" are the same picture. Durability and armor both gain a home they don't currently have.

That's the argument for building the doll properly rather than as a six-icon row: the second and
third tenants are already in the codebase waiting for it.

**Note for whoever writes it:** `client/game/js/panels/tablet-os.js` is one of the UTF-8-glyph files
called out in CLAUDE.md. Preserve encoding on save — no BOM, no Windows-1252 round-trip.

---

## 7. Where it lives

**A plugin — `plugins/injury/`.** Against the litmus tests in
[engine-plugin-boundary.md](engine-plugin-boundary.md):

- It is a *system*, not a substrate. It consumes an existing engine seam rather than publishing one.
- Its penalties apply entirely through machinery that already exists: `registerStatusEffect`'s `stats`
  bag, the move-gate registry, `registerAction` for `treat`.
- Nothing in the engine needs to *read* injury state. If the plugin is disabled, combat is exactly
  what it is today.

The one engine-side change is the hook (§8).

**Storage:** `player_flags`, as a single small blob — never a `players` column, and not worth a table
for six bounded entries. Written coalesced, never per-hit.

**Hot path:** the injury check is arithmetic on values already computed at the hit site. Sync and
query-free by contract, like `wear()`, `hygieneOf()`, and `getRelation()` before it.

---

## 8. The engine hook

One addition, parallel to `wearStruckArmor` and under the same sync contract:

```js
fireDamageToPlayer(player, { part, damage, type, critical });
```

Called at `combat.js:549`, `:646`, `:720`, immediately after the existing `wearStruckArmor` call.
Handlers are sync, return nothing, and must not query.

**One complication.** The enemy→player path at `combat.js:537` is multi-component and has no single
`damageType` — it rolls a list of typed components and sums them. It needs a dominant-type pick: one
line inside the existing loop at `:543`, taking the max by post-soak contribution. Slightly arbitrary
in the rare even-split case, invisible in play.

---

## 8b. Phase 2 — injuries on enemies (deferred, but design for it)

Everything above is **player-side only**. `fireDamageToPlayer` fires on incoming damage; enemies take
typed damage and are never wounded. That is deliberate for a first build — it is self-contained and
reversible — but it leaves the larger half of the value on the table, and the hook signature should
be designed so this is a second call site rather than a redesign.

**What the player half delivers:** consequence. Fights leave marks; sleep and medicine matter; armour
and durability get retroactively more important.

**What the enemy half delivers:** tactics. It is the only part of this that changes what you *do* in
a fight.

- Injure a mob's **legs** and it cannot flee or close.
- Injure its **arms** and its to-hit drops.
- A **club** against an armoured mob: kinetic soaks poorly on plate, and `cumulative` means repeated
  blows wear it down. Blunt becomes the anti-armour answer.
- A **blade** against a soft fast mob: low threshold, immediate hobbling.

Enemies already carry `body_parts` as `{part, weight, soak}` with **per-part typed** soak
(`combat.js:375`, `:386`) — a mob can already be plated on the torso and soft at the head. That lever
exists today and is largely unpulled; worth auditing how many enemies use a flat soak map before
building anything, because the differentiation may be cheaper than expected.

**Cost:** a second hook at `combat.js:459`, in-memory-only injury state on the enemy (it dies with the
mob, nothing persists), and penalties routed through enemy stats rather than player ones. Not free,
not large. **Not to be started until the player side has passed the kill criterion in §10.**

---

## 9. What the player actually experiences

They get hit hard, and the message says the knee went. Later they notice they can't run. Someone in
the bar says something about the limp. They splint it, or they sleep, and it's better.

No screen they had to open. No item they had to buy.

---

## 10. Build order

1. ~~**The hook.**~~ **BUILT** — `server/engine/damage-events.js`
   (`registerDamageObserver` / `fireDamageToPlayer`), wired at `combat.js:549` (enemy),
   `:646` (`applyStrikeToPlayer`) and `:720` (PvP), plus `dominantDamageType` over the
   multi-component path. Sync and query-free by contract; observers are notified, never consulted,
   so no plugin can alter how much a hit hurts.
2. ~~**The plugin skeleton.**~~ **BUILT** — `plugins/injury/`. Storage in the `injuries`
   player_flag read synchronously out of the already-hydrated `player._flags` Map; lazy decay with
   no tick of its own; the type curves (needed here, since they decide whether a wound happens at
   all); the naming table with its fallback chain; the `injuries` verb; `player.appearanceNotes` so
   a Maimed wound is visible to others. **Plus the §6b paper doll.** 32 checks in
   `plugins/injury/regress.js`; gate green at 3120/3120.
3. ~~**Penalties.**~~ **BUILT** — via a new `server/engine/impairment.js` substrate rather than four
   bespoke hooks. The engine already had four unrelated ways to be diminished, each hardcoded at its
   own site (condition.js stat penalties, gameLoop's stamina-regen chain, stance's to-hit, the
   run-mode toll); a system that wanted to slow a player down had nowhere to say so. Providers are
   sync/query-free and the no-provider fast path allocates nothing. The seven part rules live in
   `plugins/injury/penalties.js`.
   **One deliberate softening:** the design said two maimed legs means "cannot walk, only crawl."
   Built as a heavy per-step stamina cost instead — **nothing ever blocks movement outright**,
   because a player who cannot move has nothing to do but wait, which is the exact failure state
   this system exists to avoid. Asserted in regress.
4. **Type tuning** — *numbers in place, playtest pass outstanding.* The curves shipped with Phase 2
   (they decide whether a wound happens at all, so they could not be deferred). What remains is the
   balance pass, which needs play. A **compounding guard** is in the regress suite meanwhile: it
   bounds the crit × head-multiplier × `cumulative` worst case so a future tweak to one number can't
   silently make every scrap end in a fractured skull.
5. ~~**Medicine.**~~ **BUILT** — a `treat_injury` item tag (in the tag catalog, with a `json` shape
   added to the devpanel editor and validator), applied through a new `item.consumed` engine hook so
   the consumable path never learns injuries exist. Five existing items retagged into the five
   tiers; the **`trauma kit` name collision resolved** (`item_medkit` is now "medkit", the
   single-wound field item; `item_trauma_kit` keeps the name and is the treat-everything one).
   Surgical clearing went into the **existing `clinic` plugin** via a `wound_fee` param — no
   `doctor` flag, no `treat` verb, and every clinic in the world gained it at once.

All five steps shipped and are reversible: with the plugin removed both substrates are inert, and
with the substrates removed combat is byte-identical to before.

**The kill criterion below has NOT been evaluated.** It is the next thing that should happen, and it
gates §8b.
