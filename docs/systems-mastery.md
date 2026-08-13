# Mastery — the Long Watch's discipline

**STATUS: Phases 0–5 built (the swing seam, the purity cap, the stain, Read and Exploit,
Composure, stances, techniques, and the read window across all three Display Mode rungs).
The Senses and Mind disciplines are design.**

The third body philosophy. The Wildblood become something else, the Ascendants replace what
they were born with, the Exodus hold that reality is permeable — and the Long Watch master
the body they were issued.

| Path | Philosophy | Source of power | System |
|---|---|---|---|
| Wildblood | Become something else | Mutation | `server/engine/mutations.js` |
| Ascendant | Replace yourself | Bionics | `plugins/augments` |
| Exodus | Reach past the body | Psionics | [systems-psionics.md](systems-psionics.md) |
| Null | Make the machine stop | Nullcraft | [systems-nullcraft.md](systems-nullcraft.md) |
| **Long Watch** | **Master what you already are** | **Discipline** | **`plugins/mastery`** |

| File | What it holds |
|---|---|
| `server/engine/combat.js` | `registerSwingContributor` — the seam. Owns nothing of mastery's. |
| `plugins/mastery/state.js` | Hydration, the sync read API, the coalesced flush. The only writer of its three tables. |
| `plugins/mastery/purity.js` | The ceiling, the stain, and what the Watch calls you. |
| `plugins/mastery/reads.js` | Heat, familiarity, tiers. |
| `plugins/mastery/exploits.js` | The exploit table and its matching rule. |
| `plugins/mastery/composure.js` | The resource. Runtime only — no column, no table. |
| `plugins/mastery/techniques.js` | Stances and techniques, and the roll that lets them fail. |
| `plugins/mastery/readgame.js` | The reaction window: arming, the deadline, resolution. |
| `plugins/mastery/index.js` | The verbs, the swing contributor, the training. |
| `client/game/js/panels/textread.js` | The `textgames` board. |
| `client/game/js/panels/readwindow.js` | The `visual` board. |

---

## The rule the whole system is built on

**A Long Watch veteran must not look supernatural on inspection.** No paper-doll entry, no
`player.appearanceNotes` line, nothing an `examine` can see. They look like an ordinary
person until you watch what they actually do.

Mutations are visible. Chrome is visible. Mastery's invisibility is the fiction, not an
omission — and it is what forces the three things this system deliberately is **not**:

- **Not a stat block.** The moment mastery grants a permanent passive number it *is* a
  mutation you can't see. Every technique costs something at the moment of use and can fail.
- **Not baked.** `rank` is stored raw; the purity cap applies on **read**. Reversing the
  arithmetic into the stored number is unrecoverable the moment any of it comes back out —
  the lesson [systems-mutations.md](systems-mutations.md) already paid for once.
- **Not a second grind.** An instructor raises your **ceiling**; being hit raises the
  number. There is deliberately no training dummy in this game.

## Read — the mechanical identity

**Every other build in Architect gets worse over a long fight** — stamina drains, condition
degrades, wounds bleed. This one gets better. That inversion is the entire reason the system
exists, and any change that flattens it has removed the feature while leaving the code.

Two layers, and only one persists:

- **Heat** — per enemy *instance*, in RAM, lost on logout. The within-a-fight curve. Losing
  it on logout is correct: you do not log in mid-read of something no longer in front of you.
- **Familiarity** — per *archetype*, in `player_reads`. What you know about a **kind** of
  thing, which is what survives the kill. Heat converts into it at a discount when a fight
  ends, so a hundred short fights teach less than the same time in a few long ones.

The key is `enemy.templateId`, never `instanceId` — **fight four hundred dogs and you have
one row.** All human opponents share the single key `pvp` on purpose: a player is not an
archetype, and a per-player Read would be a dossier system nobody asked for.

Tiers: `blank → watching → pattern → read → solved`. Familiarity buys a **head start** on
heat, never a replacement for it — knowing the kind means you begin already watching; it does
not mean you have read the individual in front of you before it has moved.

**A miss teaches as much as a hit.** This is why Read hangs off the swing seam rather than
`damage-events.js`: a damage observer never sees the swing that went past your ear, and that
is the one you learn most from.

### Exploits

The payoff — a named weakness with a stated consequence. **The prose is the reward**; an
exploit line has to read like something a person noticed, or the fantasy collapses into a
number going up.

A module table, deliberately **not** content: every exploit has a handler, and an authored
one with no handler is exactly the failure `systems-mutations.md` names. The matching rule is
that an exploit may only name a body part the combat system will actually resolve against —
`requires` is checked against the enemy's real `body_parts`, so a line about a knee can never
print for something with no knee.

## Purity — the door, the ceiling and the stain

Two separate mechanisms, and keeping them separate is the whole trick.

### The door — cleanse yourself first

**The Watch will not teach a body that is still carrying metal or mutation.** `train` at an
instructor refuses outright, ahead of the reputation check and ahead of everything else — a
picket sees the chrome long before they get round to asking who vouched for you, and a chromed
stranger told *"come back when someone can vouch"* would go away and do the wrong work for a
week. Have it cut out, have the flesh corrected, come back in your own body. `cleanseDemand()`
is where they say so; the refusal names **what has to go and nothing else** — no number, no
rank, no rep, no flag, the same convention `capReason` and the mutagen gate already keep.

⚠ **The door reads `carriesModification()`, never the social ladder below.** That is not
fussiness: the ladder has a PSIONIC rung and a FORMER rung, and wiring the door to `regardOf`
would silently start refusing two groups the Watch admit. And `carriesModification` is
deliberately **not `currentLoad > 0`** — the load quantises, so a mutation at expression 12
floors to zero steps and costs no ceiling at all. That is right for a ceiling and wrong for a
door. The Watch are not doing arithmetic; they are looking at you.

The one thing this must never become is a *ceiling* on the currently-modified. Refusing at the
door and then also capping them is one punishment charged twice, and the cap would never be
read by anybody.

### The ceiling

Once you *have* cleansed, the door opens and only the ceiling remains. Without a limiter
nothing stops a player cleaning up, training, and re-installing: chrome for the soak, mutations
for the reach, discipline on top. So a formerly-modified body has a **ceiling**.

```
cap = 100 − 12×(working augments) − 5×floor(total mutation expression / 20)
```

floored at **10, never 0**. Chrome does not make discipline impossible, it makes **mastery**
impossible, and the distance between those two sentences is the fiction. Psionics costs
nothing — an awakened mind has done nothing to the *body* — so the Watch's contempt for the
Exodus is pure snobbery with no mechanical teeth behind it.

**Cleaning up does not clean the slate.** Having chrome cut out or a mutation treated leaves a
**stain** that fades over ~3 weeks (`player_purity`). Without it chrome is *rentable*: install
it for the fight, have it pulled before you train, pay nothing. The stain is what makes the
choice a choice. It is lazy and self-renormalising — computed on read against the row's
timestamp, rebased each time so the fade always measures from the last real change, with no
tick at all. An offline player costs nothing and comes back correspondingly cleaner.

Both inputs (`rosterOf`, `getMutations`) are login-hydrated sync getters, so `purityCap` is
safe from the swing path. **It must never grow an await or a query.**

## What the Watch calls you

```
PURE  >  PSIONIC  >  AUGMENTED  >  MUTANT
```

**The axis is the body**, which is what makes the Exodus rung the interesting one. A psionic
has done nothing to themselves — they are bodily clean, and the Watch cannot fault them on the
one measure they claim to care about. So they fault them for other things: for **walking**
(the Exodus left; the Watch stayed), and for being cranks who think they have mind powers.

⚠ **The Watch do not concede psionics is real**, and no line may imply they do. "Shortcut",
"assisted", "help" all grant the premise — the slur is `walkaway`, because the grievance is
desertion, and the mockery is always that the thing doesn't work. This sits directly on top of
[systems-psionics.md](systems-psionics.md)'s own first law: the game itself refuses to confirm
psionics, and Codex XIV keeps it a joke.

The temperatures differ all the way down. Pure is a virtue. Psionic gets **mockery plus a
grudge**. Augmented gets **cold superiority** — you bought what we bled for. Mutant gets
**disgust**, which is a different thing and is the one place the Watch stops sounding
reasonable.

**They admit three of the four, and go on having words for two of them.** Pure, psionic and the
cleansed all get taught; the walkaway gets mocked at the door and then let through it, and the
retread gets inspected like a rebuilt engine and then started at the feet. That contradiction —
training somebody you are quietly contemptuous of — is deliberate and must never be resolved by
the code. What is *not* a contradiction is the fourth case: a body still carrying metal or
mutation is turned away, and that refusal lives at [the door](#the-door--cleanse-yourself-first)
reading `carriesModification`, **not here**.

Two registers, and **the coded one is the default**. They mostly do not say the quiet part:
*"the assisted"*, *"how much of that's under warranty"*, *"nobody holds it against you"*, and
everyone in the room knows what was meant. About a quarter of the time somebody says it flat
out instead, and the flat version lands harder for being rare. The slurs are `shortcut`,
`bought`, `slipped`, plus `retread` / `unpicked` / `half-clean` for those who cleaned up;
`first-body` is the only word anybody uses warmly.

**The nastiest lines are the polite ones.** *"You can't help what you are"* is worse than any
slur and is doing the same work — which is why the coded list is the longer one.

⚠ **Nothing may read this to refuse anything.** `regardOf` / `standingWord` /
`standingGreeting` exist to be *said*, not *checked*. Grep before wiring any of it to a door.
There *is* a door now, and it reads `carriesModification()` instead — if you find yourself
reaching for `regardOf` to gate something, that is the function you actually wanted.

## The swing seam

Mastery's one engine change, documented in full in [combat.md](combat.md#the-swing-seam--registerswingcontributor).
A **sync contributor registry**, not a `gatherHook` — `gatherHook` awaits every handler, so one
plugin doing a query inside it would put a DB round trip on every swing in the game. With
nothing registered it allocates nothing and costs one `Map.size` read.

## Storage

Three per-player runtime tables — `player_reads`, `player_disciplines`, `player_purity` —
classified `player` in the content registry and **never exported**. One `UNION ALL` query at
login, memory thereafter, coalesced dirty-gated 1m flush.

Hydration lives in the plugin's own `player.login` handler and **not** in the login
`Promise.all` in `server/index.js`, even though joining that batch would cost no extra round
trip: the engine must not import a plugin. Mutations gets into the batch because its substrate
is engine; mastery's is not. `plugins/augments` makes the same call and pays the same one
extra statement.

## Instructors

Content, not a table — an NPC flagged:

```json
"mastery_instructor": { "disciplines": ["body","movement"], "max_rank": 40, "rep_required": 150 }
```

The refusal **never names reputation, a tier or a flag** (the mutagen-gate convention), and the
purity ceiling is explained in prose that never prints a number. `MASTERY_TEACH` is the
authored VINE route.

`doTrain` checks in this order and the order is load-bearing: **the door** (still carrying
chrome or mutation → `cleanseDemand`, refuse), then reputation, then the discipline offered,
then the purity **ceiling**, then the instructor's own `max_rank`.

## Composure, stances and techniques

**Composure** is the Long Watch's overclock, made of nothing but skill. Runtime only — no
column, no table, never hydrated, and it decays to nothing out of combat. That is not an
optimisation: a resource you can log in already holding is a passive bonus wearing a
resource's clothes. You earn it by fighting *well* (a clean defence, a blow your guard ate, a
read clicking into place), never by fighting long.

**Techniques** are armed by a verb and consumed by exactly one swing in their own direction —
the `pow` model. They **can fail**, and failing is what stops them being passives with extra
steps. `slip` and `perfect_timing` set the seam's `negate` (a *stated outcome*, never a big
negative to-hit); `perfect_timing`'s counter goes through the engine's own `_powQueued` path,
so soak, body parts, crits, injury and loot-on-death all apply. **Never write `enemy.hp` from
a plugin.**

**Stances** are held, drain stamina on the 10s tick, and end on four explicit edges: `stance
drop`, lazy expiry (checked on *every read*, so an expired stance contributes nothing even if
no tick has been near it), stamina exhaustion, and a hard hit. Iron Body's soak rides the
seam's `soakBonus` and **never touches `player.soak`** — that map is a cache rebuilt on
equip/login, and a timed brace written into it would need invalidating on every path that can
end a stance; one missed path leaves a player armoured forever.

Techniques share the **`combat_move` 10s window with `pow` and `dodge`** — one clever thing per
cycle, so mastery replaces brute force rather than adding to it. `focus` spends 3 Composure to
reopen that window early.

⚠ **The `focus` trap:** `playerDefence` already calls `clearCooldown` against the **`attack`**
key. `focus` must clear `combat_move` and nothing else — clearing `attack` would make Composure
buy free swings. Regress asserts the attack cooldown survives a `focus`.

## The read window

The reaction beat, and the one part of mastery the player *plays* rather than triggers. Three
tells arrive, a clock runs, four answers.

**A swing resolves synchronously** inside `enemyAttackPlayer` — there is no point at which the
engine can stop and wait for a keypress, and adding one would put a promise across the combat
tick. So the window is **armed by swing N and consumed by swing N+1**. That is not a
compromise dressed as fiction; it *is* the fiction — you read the tell on the exchange you just
survived and act on the next one.

**The deadline comes from the engine's own schedule**, `enemy.lastAttack +
enemy_attack_interval_ms − 400ms`, never a wall clock. A fixed `Date.now() + 2500` drifts
against that interval, and in a two-enemy room would promise a window the next claw closes
early. Below `MIN_WINDOW_MS` (1200) it **refuses to arm** rather than shipping an unwinnable
reflex test — `enemy_attack_interval_ms` is a tunable, so that is a real case.

**Letting it lapse costs nothing.** The Composure was spent when the window opened. A penalty
would make the minigame mandatory and would punish the `log` rung for being the `log` rung,
both of which [systems-display-mode.md](systems-display-mode.md) forbids. Both panels say so
out loud, because a countdown with no stated stake reads as a threat.

**Correctness is decided server-side.** The client sends the chosen *word*; `correct` never
leaves the server. The `0|1` shape appears only at the `log` rung, where the server produced
the bit itself and `autoResolved` echoes it back — the one case a client verdict is trusted.

Three rungs, built log → textgames → visual so the bottom is never a dead end:

| Rung | Surface | Mounts |
|---|---|---|
| `log` | `resolveForLogRung` on **dodge** (not the default `hacking`) | nothing — narrated |
| `textgames` | `client/game/js/panels/textread.js` over `textui.js` | the area pane; **in `paneFreeForRoom`** |
| `visual` | `client/game/js/panels/readwindow.js` | **floats** — see below |

The visual rung floats rather than taking the area pane, unlike every other minigame here: it
opens mid-fight, and taking the pane away would hide the thing the board is about. The text
rung mounts in the pane like its siblings and *is* registered in `paneFreeForRoom`, or a `look`
would wipe it.

**The tells are the puzzle** — each answer has its own and no two share one, asserted in
regress. A player who learns that a dropping shoulder means sidestep is genuinely better at the
game afterwards, which is the entire reason mastery has a reaction beat rather than one more
passive.

## Verbs

`mastery` (the sheet — words, never numbers) · `read [target]` · `train [discipline]` ·
`stance <name>|drop` · `technique [name]` · `focus`

`stance` and `technique` **fall through** when the player has trained nothing, so the engine's
own combat-stance verb is untouched for everybody else.

`read` prints what you already know and **does not advance the read** — you learn by exchanging
blows, not by staring, and a `read` that paid out would be a free action spammed at the top of
every fight.

## Not built yet

The Senses and Mind disciplines: **Blind Fighting** as a `visibility.perceive` contributor
(note that hook keeps only the *last* handler's answer, so mastery must return `undefined`
when it has no opinion or it stomps `plugins/flashlight`), and **Fear Discipline** on the
`registerSanityResistor` seam added with the sanity funnel. See
[proposals/mastery.md](proposals/mastery.md).
