# Faction arcs — the 40-slot ladder

**Status: FRAMEWORK AGREED. LONG WATCH AND ASCENDANTS COMPLETE THROUGH SLOT 10.** The shape below is
the design every order's questline is built to. Both first ladders are filled and gated; slots 11–40,
the renounce mechanic, and the other three orders are outstanding.

---

## The shape

Every order gets **forty missions**, in three movements:

| Slots | What they are | Locked in? |
|---|---|---|
| **1–3** | **Benign.** Fetch, carry, sit. No moral content at all. The order is measuring one thing: whether you turn up. | No |
| **4–6** | **Tests that do not look like tests.** The player should be able to finish these without ever realising they were being weighed — and should be able to work it out afterwards. | No |
| **7–9** | **Work with a cost.** The first jobs that take something from somebody. **The crossover sits at 7**: you are sent against a rival order's target, and that order makes you a counter-offer on the spot. | No |
| **10** | **The rite.** A real test, not a ceremony. Passing it locks you in. | **Yes** |
| **11–40** | **Rank.** Five ranks of six, each more serious than the last, each paying standing that opens hardware, doors and dialogue. | Yes |

**Why the crossover is slot 7 and not slot 1.** A recruiter's offer is only interesting if you have
something to lose by taking it. At slot 1 you are nobody and the pitch is noise; at slot 10 you are
committed and it is not a choice. Slot 7 is the only place where both sides are real — you have done
enough to be worth buying and not so much that you cannot go.

⚠ This is a change from what shipped. `quest_asc_1` (*Follow the Money*) was gated on `lw_member` —
Long Watch slot **3** — which put the Ascendant pitch in front of a player who had run three errands.

## How slots 1–10 are written

Added 2026-08-25, when both ladders were rewritten against the craft rules in
[reference/plain-writing.md](reference/plain-writing.md). Three constraints, and they apply to every
order's first ten, not just the two that exist.

**Slot 10 is a door, not an ending.** Ten of forty is a quarter. A rite that settles anything leaves
thirty rungs with nothing to be about, and that is exactly the trap the Long Watch rite had fallen
into. Both rites now finish on the beginning of something tedious: Pike closes by describing the
roster, which is "a great deal of standing about in the cold for the rest of your life", and the
Ascendant rite ends with a printed body being handed a towel and then a form. Nobody is congratulated.

**The world is bigger than the two orders in front of the player, and nobody explains it.** Every
order's first ten needs two or three moments where somebody answers a question about the wider board
in one flat sentence and then moves on. The answer should be **short, specific, and quietly
informative about where the speaker's own order actually sits** — an evasion that is all mystery
teaches nothing, and reads as the writer withholding rather than the character.

The two that carry the most:

> **Halloran**, asked who else makes camera parts, when he has just said the Watch cannot:
> *"Three that I know of."* He never supplies the names. What the player learns is that the Watch
> buys from a supply chain that is neither Watch nor Halcyon, and that Halloran knows exactly who
> is in it.

> **Ives**, asked whether a broker is one of theirs: *"He sells to four buyers. We are the one that
> pays on time."* She does not name the other three and does not appear to be avoiding it either.
> That is the Ascendant position in nine words — Halcyon does not own the board and does not need
> to. It wins on being the reliable counterparty, which is a far more total kind of power than
> ownership and is never once described as power.

Kesh does the same at slot 8 with work he does not do and will not say who does. ⚠ **No line may
imply the field is binary** — not "the ⚠ **No line may imply the field is binary** — not "the
only other option", not "one of us or one of them". The unbuilt orders have to be able to walk into
this world without anything already written having to be unsaid.

**Each order's ten is written in one register, and the two registers are opposites.** The Watch has no
euphemisms at all and says the ugly part out loud; the Ascendants have nothing *but* euphemism and
every line they speak would survive being read back in a hearing. Neither is signposted. This is the
same trick Wells plays with the Labour Department — "We have abolished destitution", said by somebody
who means it — and it only works if the prose never supplies the translation.

## The arc flag

**One numeric flag per order**, holding the highest slot completed:

```
lw_arc · asc_arc · exo_arc · null_arc · wild_arc
```

- Slot *n*'s offer is gated on `{ flag:'<order>_arc', op:'gt', value: n-2 }` — that is, "you have
  finished slot *n−1*". Slot 1 carries no arc gate.
- Turning slot *n* in sets `<order>_arc = n` through the ordinary `rewards.flags`.

Two reasons this and not the per-quest flags the first three orders were built with (`lw_q1_done`,
`lw_member`, `lw_loyal`, …):

1. **It scales.** Five orders × forty slots is two hundred quests. Two hundred bespoke flag names is
   two hundred chances to gate on the wrong one, and no way to ask "how far in is this player?"
2. **`gt` already exists** and `Number(undefined)` is `NaN`, so an unset arc flag fails every gate
   without a special case. Nothing new was needed in the condition vocabulary.

The existing per-quest flags **stay** — they are read by dialogue all over the place and there is no
reason to churn them. The arc flag is added alongside, and it is the one a gate should use.

⚠ **The forty slots are non-repeatable, always.** Repeatable favours are a separate, parallel
thing — a job you can do again for standing, not a rung. If a slot were repeatable, turning it in a
second time would write an *older* arc number over a newer one and walk the player backwards.

## The Long Watch, slots 1–10

Nine of these already exist. The nine are not padding — read as a ladder they already do the job the
design asks for, which is why this is a re-gating pass rather than a rewrite.

| # | Quest | What it is | Movement |
|---|---|---|---|
| 1 | `quest_lw_1` Proof of Hands | Fetch something. The audition. | benign |
| 2 | `quest_lw_2` Blind Spot | Fetch something else. | benign |
| 3 | `quest_lw_3` Ghost in the Works | The first fight. Sets `lw_member` — the key that opens the inner door. | benign |
| 4 | `quest_lw_meet` The Meet | Sit in the Runners' Den and wait for a runner who never comes. **The test is what you say afterwards** — and both answers turn the quest in, because a test that fails you for the wrong answer is an exam, and the player would know it was one the moment they were marked. Honesty sets `lw_told_truth`; the invention sets `lw_lied_meet`, and Halloran does not react at all. | test |
| 5 | `quest_lw_fav_carry` Carry It Back | An errand across town with something that matters. | test |
| 6 | `quest_lw_4` Retention | Five objectives, a script, a chase. The first set-piece. | test |
| 7 | **`quest_asc_1` Follow the Money** | Sent against Halcyon — and **Actuary Verity Ives** makes the counter-offer at the gate. | **crossover** |
| 8 | `quest_lw_fav_quiet` Quiet Hands | Put somebody down and leave them breathing. | cost |
| 9 | `quest_lw_loyalty` Nothing Bought | A purse, a shopping list, and a clinic that will fit you anything you like while you wait. **The best test in the game and it never says it is one.** | cost |
| 10 | `quest_lw_rite` Nothing Kept Back | Blow the vat colonnade, get past Ives at the gate, get home. | **rite** |

⚠ **The rite used to require killing Ives, and no longer does** (changed 2026-08-25). Two reasons, and
the second is the load-bearing one. It read as a finale a **quarter of the way** into a forty-slot
ladder, and it spent the best Ascendant voice in the game — the recruiter who makes the counter-offer
at the other ladder's slot 7 — before thirty rungs that need somebody to be against. `o_ives` is now a
`talk`: she is at the gate, she says her piece, and you walk past her. What a player does after she has
finished speaking is not an objective either way.

The escape is untouched and is still the part that kills people: `trigger_lw_rite_pursuit` fires on
`demolition.detonated` in `zone_asc_vats_hall`, **not on the kill**, so bringing the colonnade down
still brings the Spire down on you.

## The Ascendants, slots 1–10

**Two doors in, and they are opposites.**

- **Through the Watch** (Long Watch slot 7): Ives reads you at the gate and makes an offer. You are
  *recruited*. Somebody wants you, and it is flattering.
- **Through the board** (`board_halcyon_contracts`, Grand Lobby): Halcyon posts casual contracts
  like any other employer — courier a file, witness a signature, hold a place in a queue. Nothing
  on the board mentions an ideology, because it is a company hiring casual labour, which is what it
  is. Turn in three and a counter script sets `asc_invited`; **Marcus Broch** at the underwriting
  desk offers you a permanent position, and sends you to Ives, who is finishing a hiring process
  somebody else started. You are not recruited. You are *taken on*.

⚠ **Nobody pitches an ideology at the second door.** Broch is `faction: null` and stays that way —
he thinks he is offering a job at an insurance company, which he is. The whole distinction between
the two entrances collapses the moment he starts talking about the future of humanity.

The counter is one `counter` VINE node in `script_halcyon_contract_count`, driven by five
`script_triggers` rows (one per pool quest) on `quest.turned_in`. ⚠ The flag is set at
[index.js:1406](../plugins/quests/index.js) *before* the event is emitted at 1413, which is the only
reason a trigger can gate on it.

| # | Quest | What it is | Movement |
|---|---|---|---|
| 1 | `quest_asc_2` The Threshold | Get scanned at the Gate. You stop being a person they are discussing and start being one they are covering. | benign |
| 2 | `quest_asc_file` Proof of Loss | A walk with a wallet in it, and Ives says so — *"I could give you something dramatic instead, and it would tell you nothing true about us at all."* | benign |
| 3 | `quest_asc_3` Assurance for the Assured | The tour: the Gallery, the Vats, the Sanctum. | benign |
| 4 | `quest_asc_fav_tolerance` Within Tolerance | Fit the part. **To what** is the test, and nobody says so. | test |
| 5 | `quest_asc_fav_lead` A Warm Lead | Bring somebody else in. | test |
| 6 | `quest_asc_fav_adjuster` Adjuster | *"Nobody will remember me."* | test |
| 7 | **`quest_asc_cross` Where It Is Printed** | Find the Watch's press — and **Wessel Ardy is sitting in the dark next to it**, and does not get up. | **crossover** |
| 8 | `quest_asc_turn` The Account | The fitting. `chromed_ever` burns the flesh path. | cost |
| 9 | `quest_asc_loyalty` Restoring Service | Put the Watch's blinded cameras back. −400 with them. | cost |
| 10 | `quest_asc_rite` The Rite of Ascension | Back up, die at the Uplink, get printed. | **rite** |

⚠ **The NPC at the press is `npc_asc_lapsed` — Wessel Ardy, male, faction null.** This table said
"Cyrelle" for months while the paragraph twenty lines below correctly said Ardy, and on 2026-08-25
the arc rewrite believed the table and put the wrong name and the wrong pronoun in front of the
player. **Cyrelle is Long Watch, female, and is upstairs** at the ops room; she is the one who gives
`quest_asc_1`.

**The two crossovers mirror each other on purpose, and they are not the same move.** Ives makes a
pitch, standing in the open at a gate, in daylight, having done the arithmetic. Ardy makes no pitch
at all — he opens with *"Nothing. I want nothing. I am not the Watch, I am not recruiting you"* and
is there to say one plain sentence about the job after this one, which is the sharper version of the
same scene. Neither of them threatens you and neither of them wins the
argument, and both of them let you walk — which is the only version of a recruitment scene that
respects the player enough to make the other answer feel like something they chose.

Slots 11–40 are rank work and are not designed yet.

## Lapsing — the cheap exit, and the last one

Slot 7 is where a Watch player is offered a way *in*. It is also where an Ascendant player is
offered a way *out*, and the two are deliberately the same rung.

**Wessel Ardy** (`npc_asc_lapsed`) is sitting on a crate by the Watch's press when you come down for
`quest_asc_cross`. He is not Watch and he is not recruiting — he is a **lapsed client**, account four
thousand and eleven, with capped ports in both forearms, and somebody exactly like you came to his
flat on a Thursday with the paperwork already signed. The player has very likely *performed* one of
those repossessions (`quest_asc_fav_lapse`), which is what makes him the mirror rather than a lecture.
His whole offer is one plain sentence nobody is ever told beforehand: **after the next job, what they
have given you is not returnable and neither are you.**

⚠ **The scene is ONE objective, not a fork.** The quest plugin has no optional-objective support —
`requiresMet` reads only `requires`, and completion demands every entry — so two mutually-exclusive
`talk` objectives would leave the quest permanently one tick short for everybody. Ardy is at the
press for every player and **his tree forks on `lw_arc`** instead: an ex-Watch player gets a version
that knows whose basement this is (*"She is upstairs. She wanted to come down and I asked her not
to"*), and Cyrelle's own scene stays reachable at the ops room as their second helping.

### What lapsing does

`ASC_LAPSE` ([plugins/ascendant/lapse.js](../plugins/ascendant/lapse.js)) — and `ASC_LAPSE_QUOTE`
runs first, because **the price is shown before the answer is taken**; an exit whose cost you only
learn afterwards is a trap, and the numbers come off the live roster rather than authored prose.

| | **Lapse** (before slot 10) | **Renounce** (after slot 10) |
|---|---|---|
| Chrome | Only what **they gated** | Everything the order gave you |
| Standing | Back to neutral | The permanent −200 resting floor |
| Flag | `asc_lapsed` — clearable | `asc_traitor` — nothing ever clears it |
| Coming back | **Yes**, from the bottom, paying again | Never |
| How they treat you | A closed account. Cool, correct, commercial. | A defector |

**Lapsing is a transaction; renouncing is a defection.** A player who lapses has bought a lesson.

⚠ **"What they fitted" is `rep_gate`, and that is not a shortcut.** Nothing records which clinic
installed a given piece, and a column to find out would store a fact the catalog already implies: a
piece gated above `unknown` is one you could *only* have been sold by standing with this order. The
ungated pieces are the back-alley ones anybody can get, and they stay in you. Regress asserts the
catalog has both kinds — if everything were gated a lapse would strip chrome they never sold you,
and if nothing were, the exit would silently be free.

`copy_fidelity` is left exactly where it is. It is a fact about the body you are in, not a service
anybody is withdrawing.

## Renouncing

You may leave an order at any point after slot 10. It is meant to be a door nobody uses.

- **It strips what the order gave you** — their augments, their mutations, their access. This is not
  a penalty bolted on; it is the same act the Exodus Purifier already performs
  ([systems-ascension.md](systems-ascension.md)), pointed at whichever order you are leaving.
- **You are a traitor to them permanently.** A flag nothing clears, standing floored, and every
  member of that order treats you accordingly for the life of the character.
- **You are told the price before you pay it**, in full, by somebody who does not want you to do it.

⚠ Not built. The pieces exist — `chromed_ever`, the −200 resting floor, the Purifier, the
`player_augments` and mutation removal paths — but nothing wires them to a verb yet, and the design
above is the specification rather than a description.

## What this means for authoring a new mission

1. Pick the slot. The movement it sits in decides what the mission is allowed to ask for.
2. Gate the offer on `{ flag:'<order>_arc', op:'gt', value: <slot-2> }`.
3. Set `<order>_arc = <slot>` in `rewards.flags`, and keep whatever per-quest flag the dialogue
   around it already reads.
4. Non-repeatable. If you want a repeatable job, you are writing a favour, not a slot.
