# Psionics — the Exodus discipline

**STATUS: Phases 1–2 built (psychometry, telekinesis, aegis, ergokinesis, the initiation).
Telepathy, precognition, biokinesis, projection/dreamwalking and compulsion are design.**

The fifth faction answer. The Wildblood become something else, the Ascendants build something
better, the Long Watch master themselves, the Null make the machine go silent, and the Exodus hold
that **reality is more permeable than you thought**.

| File | What it holds |
|---|---|
| `server/engine/psionics.js` | The substrate. Resonance, strain, signatures, the four gates. Owns no table. |
| `server/engine/psionics-abilities.js` | The vocabulary: disciplines, abilities, the compulsion deny list. |
| `server/engine/psi-resist.js` | Resistance, derived from who you already are. |
| `plugins/psionics/` | The verbs, the residue buffer, the strain ladder, the prose law. |
| `plugins/psionics/aegis.js` | The shield and blast majors. |
| `plugins/psionics/purifier.js` | The price of admission. |
| `plugins/psionics/door.js` | The psi lock and the induction beat. |
| `plugins/psionics/reactions.js` | The armour taboo. |
| `client/game/js/panels/psychometry.js` | The four-meter board. |

---

## The decisions that carry it

### 1. Deniability is the progression

Codex XIV (*"The Quiet Frequency"*) deliberately refuses to confirm psionics is real — it is *"the
Basin's favourite joke, third only to insurance and the weather"*. `docs/proposals/terminus.md`
rules that *"the moment a thing is stated it becomes a mechanic and stops being unnerving"*.
Building fifty psychic verbs threatens to confirm the whole thing on day one.

So: **below Seer no output line may claim a mechanism**, and at Seer and above the prose is allowed
to be impossible. The player crossing that line *is* the arc, and it is the only thing in the game
that ever confirms that chapter. Codex XIV is **not rewritten**; it stays the joke.

This is a law, not a wish, because it lives in **one function** — `voice()` in
[prose.js](../plugins/psionics/prose.js) — with `violatesLowRank()` as a regress seam and a
`CAUSAL_WORDS` list that bans *"you sense"* as firmly as it bans *"telepathy"*. The test is not
whether the jargon appears; it is whether the line tells the player **why** they know something.
Em dashes are stripped in the same pass (they belong to the Architect and the Ascendants).

### 2. The body pays

**The mind is doing something the body was not built to support**, so strain lands on tissue:

| Band | What happens |
|---|---|
| Low | Nothing. |
| Moderate | Nosebleed — the real `bleeding` effect, plus stat penalties. |
| High | Blood from the ears, **negative sight acuity** (senses.js already supports it), abilities start failing on their own. |
| Critical | **Seizure.** `knockOut` — the same call the cosh makes, so you are killable where you lie. Plus a phantom. |
| Overload | Seizure plus **real damage** through `applyStrikeToPlayer`, so the injury plugin's observers hang an actual wound off it. A doctor has to fix it. |

Nothing here invents a punishment; every rung reuses something that already hurts. Overload
deliberately takes damage the ordinary way rather than authoring an injury, which gets the part
roll, typed soak, announcement and treatment requirement for free.

**The backlash ladder and the deniability ladder are the same ladder.** A nosebleed in a bar is
nothing; a man convulsing with blood coming out of his ears while a door he never touched swings
open cannot be explained away. That is why strain is **broadcast to the room**, not just to the
psion.

It is also the only thing bounding the expensive abilities — a long compulsion window is bought
with a seizure, and no rule had to say so.

### 3. Psychometry reads the world's own exhaust

A psychometry that invents fiction is a random-text box with a cooldown. [residue.js](../plugins/psionics/residue.js)
subscribes to events that **already fire** — `player.death`, `npc.killed`, `enemy.killed`,
`being.knockedOut`, `crime.witnessed`, `sanity.changed` — into a decaying per-zone ring buffer.
**No other system was modified to feed it.** Disable the plugin and the events carry on unchanged.

**The rule that stops it replacing SPECTER:** an impression is fragmentary, **unattributed** and
uncorroborated. It never yields a name, never satisfies a `witnessed` check, never counts as
evidence. `actorId` is recorded only so a psion can recognise their own work; the render path has
no name lookup at all, and `IDENTITY` is capped at 4/10 on the server so the bar can never fill.
**Cameras answer WHO. Psychometry answers WHAT HAPPENED HERE**, and sends you to find out who.

A bad roll **scrambles the order** rather than shortening the list — a failure that returns less is
indistinguishable from an empty room and teaches the player the verb is broken.

### 4. You major in one art and minor in another

Two independent axes, in `player_flags`:

- **`psi_rank`** — the eight-rung ladder (awakened → exodus). *How hard can you push?*
- **`psi_focus`** / **`psi_focus_second`** — *what can you point it at?* Chosen at Channeler; the
  minor opens at Seer.

| | Major | Minor | Anything else |
|---|---|---|---|
| Resonance | base | ×1.75 | ×3 |
| Strain | base | ×1.5 | ×2.5 |

Below Channeler everything is priced as in-focus, so a player can taste all eight before
committing. **Top-tier abilities set `focusOnly` and are unreachable off-major at any cost** — there
must be no build that both takes bodies and walks dreams.

**Four gates, all data** (`registerPsiAbility` takes them, so no handler re-derives one): rank,
focus, `minSkill`, and a **narrative `unlockFlag` nothing raises except authored content** — the
mutagen-shelf trick. Below a gate, `abilityRefusal` returns the `UNKNOWN` sentinel and the verb
answers `Unknown command.`: the ability **does not exist for you**, so the ladder is discovered by
meeting someone who has climbed it rather than by reading a locked list.

### 5. Resistance is derived, never authored twice

There is deliberately **no `psi_resistance` skill**. A Long Watch monk with a coprocessor and
Static Mind should be hard to read without grounding an arcane skill they philosophically reject.
`psiResistance(target, ctx)` nets Cool and Brains plus contributors registered by their own owning
systems through `registerPsiResistor(fn, owner)`, each capped so no single source becomes the whole
answer. Sync and query-free by contract.

NPCs pass through identically — §25 parity with no roster, no table and no per-NPC authoring.

### 6. `PSI_CAP` — nothing ever reaches certainty

`0.85`, the sibling of nullcraft's `VEIL_CAP`, for the same reason. No forcefield is total
immunity, no compulsion unbreakable, no mind unreadable. Every contest leaves a gap, and the gap is
where the other player's agency lives.

---

## Phase 1 verbs

```
psi                     free, no roll — rank, resonance, strain, major/minor
dwell                   the room's residue
dwell <object>          an object's history (the psychometry board)
still                   the posture: perpetual, drains while held
draw <item>             take a thing you could not reach
reach <thing> [verb]    work a mechanism from across the room
press <target> [part]   force, somewhere specific on a body
```

### ⚠ The verb-collision trap

`read`, `attune` and `pull` were the obvious names and **all three are poison**:

- **`attune`** is an engine builtin (`server/engine/commands/world.js:1915`, the senses attunement).
- **`pull`** is an engine builtin (container emptying, `commands/inventory.js`).
- **`read`** is not a registered *command* anywhere, which makes it look free — but six plugins
  (bounty, bulletin, jail, jobboard, library, prologue) register it as a **specialized action**, and
  dispatch runs plugin commands **before** specialized actions.

Plugin commands silently beat both classes. Claiming any of the three would have shadowed a shipped
feature with a symptom appearing nowhere near this plugin. **Checking `plugin.json` `commands`
arrays is not sufficient** — check engine builtins and specialized actions too.

`still` is canon-exact besides: the ideology's own text says the Exodus *"still a room and move
what is in it without a touch"*.

### `reach` is the design in one verb

It fires `fireSpecializedAction`, so it borrows the **entire** existing affordance system —
`furnitureActions.js` already computes what every piece affords, and every gate (locks, power,
alarms, crime reporting) still applies because it is the same call the player's hands would have
made. Any affordance any future plugin adds is reachable the day it ships.

**Telekinesis must always be a DELIVERY MECHANISM for verbs that already exist.** The day somebody
writes a bespoke `psi_open_door`, this stops scaling.

`press` is the brief's shove/trip/restrain/crush/disarm as one strike with a part argument, routed
through `applyStrikeToEnemy`. **Never write `enemy.hp` from a plugin.**

---

---

## The initiation, the door, and the coat

### PSI_AWAKEN — the authored way in

`registerAction('PSI_AWAKEN')` (`plugins/psionics/index.js`) is the seam a quest chain
uses to open the ladder, and `GRANT_MUTATION`'s rule applies exactly: **an authored door
is still a door**. It re-checks rather than trusting the author, because a dialogue node
is content and content gets copied. Four refusals, three of which a bare `SET_FLAG`
would have allowed:

| Refusal | Why it must be here |
|---|---|
| Rank not on the ladder | `psiRank` runs the stored value through `rankIndex` and returns null for anything unrecognised — **a typo would not throw**, it would leave a player unawakened holding a flag that looks set. Invisible in the DB. |
| Below `known` with `ideology_exodus` | Psionics is the Exodus's discipline. Same threshold nullcraft uses. |
| Still carrying chrome or mutation | The Purifier below is a *rule*, not a scene. Until this check existed, a chromed player could walk the chain and awaken with the chair untouched. |
| Already at or above the target rung | Quests get re-run in ways nobody predicts; a re-fired node must never demote a dreamwalker. |

It **says nothing to the player** on success. The deniability law means the moment of
awakening cannot be announced by the engine — whatever the player is told, they are told
by the NPC in front of them, in a line that claims nothing. A system message here would
be the game confirming psionics, which is the one thing it never does.

The purity check reads `rosterOf` and `getMutations` **directly** rather than through
mastery's identical `carriesModification`: that would make psionics depend on the Long
Watch's plugin for an Exodus rule.

**The way in is content:** `quest_exo_1..3` off Oracle-9 (`npc_glitch_oracle`), granting
70 / 70 / 120. The chain is deliberately three errands that refuse to be about anything —
verify a thing she could plausibly just know, then sit in a dead room, then sit in it
again — and **no player-visible line in any of it names a mechanism**. She is emphatic,
three times, that nothing will happen. Nothing does. The player crosses the line
themselves later, the first time `dwell` tells them something they had no way to know.

⚠ Regress covers the **refusal paths only**, and deliberately: the success path writes
`psi_rank`, and doing that to the shared fake player would awaken it for every suite that
runs afterwards — mastery's ladder reads `isAwakened` and would start classifying it as
PSIONIC. Same cross-suite leak the mutations suite paid for once.

### The Purifier — the only irreversible cost a player chooses on purpose

Before the Exodus let you in, you submit to a machine that strips **every mutation and every
augment** out of you. `purify` on furniture flagged `psi_purifier`.

It enforces *"you cannot do it all"* at the **faction** level rather than inside psionics: an
Exodus is provably neither Wildblood nor Ascendant, and no rule had to say so. It reuses
`burnAllMutations` (whose own comment notes that because nothing is baked, deleting the rows IS the
reversal) and the same bulk augment delete `backup.js` performs on a cortical restore.

Three rules:

1. **Warn first, plainly, once.** The first `purify` itemises the exact count and does nothing; the
   second does it. This game is coy about many things and must not be coy about this one.
2. **It hurts for real** — damage through `applyStrikeToPlayer` so the injury plugin hangs a genuine
   wound off it, plus sanity loss, bleeding, and a knockout. You do not walk away from it.
3. **It never takes the fee and fails.** No roll. A machine that might strip your chrome and then
   not let you in would be the most resented object in the game.

It sets `psi_rank: 'awakened'` itself, rather than the Gate Keeper's dialogue doing it — the machine
is the thing that actually changed you, and a flag set elsewhere could drift from the body it
describes.

### The door

Every door in an Exodus space looks automatic. They are not; they are being opened by the people
walking through them. `registerLockType('psi')` with `authFn = isAwakened` — no keypad, no guard,
nothing to hack or pick, so a Null cannot jam it and an Ascendant cannot buy past it.

**The first refusal fires the guide's explanation and sets `psi_walked_into_door`. Every refusal
after that is a flat, unexplained non-opening**, which is far more unsettling than an error message.
This is the one place the Exodus explain themselves plainly, and that is correct because you are
being *inducted*. It teaches the mechanic by doing it to you before you have any power at all.

### The armour taboo

**Purely social. Armour is never blocked and never penalised** — no stat hit, no refusal to equip,
no gate. The game does not enforce the creed; people do. Same shape as
`plugins/mutations/reactions.js`, which is hostile socially and never violently.

Fires on `zone.entered` in a zone flagged `flags.exodus_space`, for players who have **committed**
(a guest is not held to a creed they have not taken). Costs `warmth` through
`player_npc_relations` — the punishment is accumulation, not any single sneer.

**Two reasons, and only one is ever said aloud.** *Stated:* respect for the methods and the people
before you, and a rejection of the outside world — which is exactly their canon `stance: renounce`
and their authored values, and it makes the taboo legible in one line. *Unstated, ever:* Aegis
exists, so a psion in a flak jacket is publicly conceding the discipline does not work. **No line
may make that argument and no quest may reward working it out.** Regress asserts every line is
clean of it.

---

## Built vs. design

**Built:** the substrate, the vocabulary registry with its three build-failure contracts, derived
resistance, the strain ladder, the residue buffer, psychometry (3 abilities), telekinesis
(3 abilities), the psychometry board across all three display rungs, and the marker
`plugins/mastery/purity.js` reads for its `PSIONIC` regard rung (psionics sets `player._psionic`;
mastery imports nothing from here).

**Ergokinesis and Aegis are built** — `spark`/`burn`/`cascade` and `ward`/`bulwark`/`redoubt`.
They are deliberately **not** filed under telekinesis: folded together, a telekinetic major would
own the frontline kit *and* the artillery *and* the shield and be strictly the best major in the
game. Split, they are three different soldiers.

A ward is a **status effect contributing typed soak through `registerArmorContributor`** — the same
seam mutations use for carapace, landing in `player.soak` exactly as a worn coat does. So it stacks
with armour by the same arithmetic, can be strong against kinetic and useless against edged, and is
never total. ⚠ Armor contributors run at `recomputeArmor` time, not per hit, so **every raise and
every collapse calls `refreshWard`** or the field is not felt until the player next changes clothes.
The ward drains while it stands and **says so when it collapses** — a shield that vanishes silently
is a shield you get killed behind.

**Design only:** telepathy, precognition, biokinesis and projection are **not registered** —
`unreachableDisciplines()` is asserted empty, so a discipline with no abilities is a build failure,
and a major a player could choose and then find empty is worse than one that has not arrived. Each
arrives with its own verbs. Also design: **dreamwalking** (the mind/body split means a trapped
victim's body stays in the room, lootable and killable — and so does the dreamwalker's, which is
why an Exodus crew is a telekinetic standing over a dreamwalker) and **compulsion** (a short control
window, Master only, bounded by **duration rather than vocabulary** — any verb the target could have
typed except the `deniedCompelVerbs` that move value, because a mind-controlled `give` is a theft
primitive that skips thievery, trade escrow and the wanted system).

**Content still to author:** the Gate Keeper NPC outside Terminus (assessment → proving quests in
the Basin → renunciation of other ideology rep and corp membership → the Purifier), the Purifier
furniture itself, the Exodus gi / paint / personal glyph items, an `exodus` entry in the `CLOTHING`
personality table, and the `exodus_space` and `psi_purifier` flags on the rooms. The mechanics all
exist and are tested; nothing in the world points at them yet.

See the plan file for the full phasing and the reasoning behind each.

---

## Testing

`plugins/psionics/regress.js` — 60-odd cases. The load-bearing ones: all three registry contracts
empty, applicability genuinely refuses wrong targets, the four gates each independently block, the
major<minor<foreign cost ladder, `PSI_CAP`, the compulsion deny list per verb, the deniability law
catching a causal claim, and that a logout drops every scrap of runtime state.

⚠ It restores the shared fake player's flags, zone and hp at the end. A suite that leaves rank or a
zone behind sends sneak and weightbench red for reasons that look nothing like psionics.

⚠ Its leak check is scoped to its **own** zone. Other suites kill things, and every death
legitimately leaves residue in the room it happened in — that is the feature working.
