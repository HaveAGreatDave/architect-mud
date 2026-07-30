# Stealth & Unconsciousness

**STATUS: BUILT** — sneaking, the notice model, knockouts on players and NPCs, the two crimes, and
police taking you alive at high heat all ship. Not yet exercised against a running server; see
[Known gaps](#known-gaps).

Two engine substrates and one plugin:

| | |
|---|---|
| [`engine/stealth.js`](../server/engine/stealth.js) | *has this observer noticed you?* — per observer |
| [`engine/unconscious.js`](../server/engine/unconscious.js) | being out cold, on players and NPCs alike |
| [`engine/panic.js`](../server/engine/panic.js) | an NPC that has seen something it can't handle — the `_ai.alarm` driver, **and** the witness law |
| [`plugins/sneak/`](../plugins/sneak/) | the verbs `sneak` and `knockout`, and the reactions |

---

## The rule that shapes everything

**Combat is to the death, and stays that way.** There is no random knockout mid-fight. Two reasons, and
both are load-bearing:

1. It would be **invisible.** PvP runs a 1s auto-attack loop; knock somebody out and the next tick kills
   them. Nobody would ever see it happen.
2. It would make **every fight ambiguous** — did I win, or did the dice decide something else?

So a knockout is *always* a thing somebody chose to attempt: from sneaking, on someone who had not
clocked them. That keeps fights unambiguous and makes the interesting case — taking someone alive — a
decision rather than a dice roll. The one scripted exception is police at ≥4★, and a scripted knockout
is not a random one.

### The second deliberate route (2026-07-30): a called head shot

There is now a way to knock somebody out **mid-fight**, and it does not weaken the rule above —
because the rule forbids a *random* knockout, and this is the opposite of random. A **called head
shot** (`aim head`) that lands a **critical** while you are holding a **blunt or unarmed** weapon
knocks the target out instead of killing them. See [combat.md](combat.md#the-execution-shot).

Every clause of the rule survives:

- **Not random.** It needs two decisions taken in advance — aiming at the head (at −8 to hit, so a
  novice's margin *cannot* reach the crit threshold: 0%, not merely unlikely) and carrying a bat
  rather than a blade. The same shot with a knife or a gun kills.
- **Not ambiguous.** You cannot do this by accident, so a fight never ends in a knockout the dice
  chose for you. Winning still means winning.
- **Not invisible** — the objection that mattered most. Reason (1) above was that the 1s auto-attack
  loop would finish the body a tick later, and that was literally true: nothing in `combat.js` or
  `gameLoop.js` consulted `isOut`. Fixed in the same pass. A landed knockout now **disengages the
  attacker** (`combatTargetId`/`pvpTargetId` cleared), the player auto-attack loop **skips an
  unconscious enemy**, and `enemyAttackPlayer` **returns null for an out-cold attacker**.

That last change has a consequence worth stating plainly: **auto-attack will never finish an
unconscious body.** Killing one is charged as `execution` at 5★, and a crime that severe must be
something you type, not something a background tick commits on your behalf.

HP is pinned at 1 on every path, exactly as `knockout` does — an NPC or enemy at 0 is simply dead, so
an unpinned knockout would be a killing with extra steps.

## Stealth is borrowed, not built

Almost nothing here is new simulation. The substrate already existed for other reasons; this is the seam
that makes it agree on one question.

| Existing system | What stealth takes from it |
|---|---|
| `posture.js` | the `sneaking` state, and `forceStand` already breaking it on any attack, hit or move |
| `senses.js` — `acuitySync` | how well a given being notices, already folding in stat, status effects and gear |
| `environment.js` — `getZoneVisibility` | darkness, fed by the lighting system, the power grid and a shot-out bulb |
| `impairment.js` | being drunk or high makes you worse at sneaking **and** worse at noticing |
| `skills.js` | `deception` against the target's awareness — no new axis |
| `surveillance` | cameras do not care that you are crouched; that is the crime path |

**Per observer, never global.** You are not "hidden"; you are unnoticed *by someone*. The bartender can
miss you while the man in the corner does not, which is what makes a busy room harder than an empty one
without inventing a crowd modifier.

**Sticky.** Once somebody has clocked you they stay clocked, so pacing in and out of a room cannot
re-roll a bad result into a good one. Changing room clears the record — new room, new eyes. Standing up
clears it entirely.

**Sneaking is itself suspicious.** Failing the roll while merely creeping is its own bad outcome,
separate from being caught swinging: an NPC who notices gets visibly unsettled, because a person
creeping across a room *is* unsettling. That is the point of rolling on the sneak and not only on the
attack.

**Unnoticed means genuinely absent.** `isHiddenFrom(person, viewerId)` is the one question every
describe and broadcast path asks, and it is the reason the notice record exists at all — before it, a
sneaker rolled unnoticed and was still announced on arrival and listed in the room, which made stealth
cosmetic. A sneaker's **arrival and departure lines are not broadcast** ([movement.js](../server/engine/commands/movement.js));
anyone who *does* notice is told per observer by the sneak plugin's sweep, with a `refresh` so the
sneaker appears in their occupant list. `look` filters the same way ([describe.js](../server/engine/commands/describe.js)).
A posture read and one Set lookup — no query, no clone.

**Sneaking survives a step.** `forceStand('moved')` used to clear it on every move, so you could only
ever sneak where you already stood. It is now the one posture movement preserves; every other
forceStand caller (attack, incoming hit, waking) still breaks it.

**There is a clock.** Staying unnoticed is not a state you reach, it is a thing that keeps being true.
`armSneakWindow` gives you `SNEAK_WINDOW_MS` (20s) plus a second per point of concealment; when it runs
out `tickStealth` — swept by the game loop's existing per-second player walk, next to `tickUnconscious`
and for the same reason — emits `stealth.window` and the room gets another look at you. So darkness buys
**time**, not immunity, and the question becomes *how long have I got?* Get in, do the thing, get out.

**A landed knockout is loud to everyone else.** There is deliberately no roll for the bystanders:
dropping a body in front of people is loud by definition, and letting the dice hide it would make a full
room no riskier than an empty one. Enemies turn on you, NPCs panic, other players get told plainly, and
you are forced out of the sneak. The victim is skipped — they never knew — as is anyone in the room
already out cold or asleep.

## Panic, and why the alarm flag needed an owner

⚠ **`_ai.alarm` is not a panic sequence.** All the AI tick does with it is
`if (ai.alarm) return;` — it **suspends** the NPC's graph and waits for whoever set it to drive that NPC
and clear the flag again ([ai-behaviour.js](../server/engine/ai-behaviour.js)). The burglary plugin has
always driven its own; **anything else that set the flag by hand froze that NPC permanently**, which is
exactly what this plugin was doing on a failed knockout. So the driver is engine-owned now:
**call `panicNpc`, or don't touch the flag.** `panic.js` shouts, runs the NPC for the door once a second,
and releases it — and releases it too if the NPC dies, is knocked out, or leaves the world, because the
flag outliving its driver is the failure mode the module exists to close. It refuses an NPC another
driver already holds (`alarm`/`dosedOut`), since two drivers on one suspended graph means whichever
finishes first hands the graph back while the other is still steering.

Driven from the game loop's per-second walk beside `tickUnconscious` and `tickStealth`, for the same
reason: no timer per frightened NPC to keep alive across death, logout and restart. It returns
immediately when nobody is panicking, which is the normal case.

**The witness law lives here too.** Violence in a room full of people is no longer ignored by the people:
`panicWitnesses` runs off `npc.attacked` / `player.attacked` (both emitted by the weapon plugin on the
**act**, not the hit) and frightens every NPC present. Before this, a fistfight in a crowded bar was
watched by a room that neither moved nor cared — a stealth knockout was the *only* violence anyone in
this game reacted to, which had it backwards. Panicking is idempotent, so the per-swing event source
costs nothing after the first blow. **Police are exempt** — they walk toward a fight, and their dispatch
path already says what they do about it. The law side is unchanged: [crimes.js](../server/engine/crimes.js)
still counts only cameras and on-scene `flags.police` NPCs as witnesses, so a screaming bystander raises
the room, not your star rating.

**Somebody out cold or asleep notices nothing.** This is why the two substrates have to know about each
other — it is what makes a knocked-out guard genuinely out of the picture.

## The knockout

`knockout <target>` requires **sneaking**, **blunt or unarmed** (swinging a blade at a skull is not a
knockout attempt however quietly you crept up, it is a killing), and a heavy slug of stamina.

The contest is `deception` against a difficulty that doubles if they have already noticed you — awareness
is the whole gate, and it comes straight off the stealth record.

**Failure differs by what you swung at, because they are different things:**

| target | what happens |
|---|---|
| enemy | turns round and attacks. It is a fight now. |
| NPC | ducks, sees who it was, and **bolts shouting** — `panicNpc` (see [Panic](#panic-and-why-the-alarm-flag-needed-an-owner)) |
| player | is very much awake and knows exactly what you tried |

### Being out cold

HP is **pinned at 1, never 0** — NPC death is `hp <= 0`, so an NPC knocked to zero would simply die.

The body stays in the room, listed, lootable and **killable where it lies**. That is deliberate: it is
what makes a knockout a choice with a consequence rather than a polite alternative to violence. It also
costs nothing to implement, because it reuses the mind/body split built for
[dreams](systems-dreams.md) — `bodyTell` gains a third state (`out cold`, which wins over `sleeping`,
being the most urgent thing about them and the only one somebody else did to them) and everything else
is free.

You cannot act while out cold. Unlike sleep there is **no allowlist and no verb to end it** — somebody
else decided this and only time undoes it.

**Coming round leaves you concussed** — a short, sharp status with a real stat penalty. Without it a
knockout is a nap you took, and it is what makes the police version cost something beyond the sentence.
Applied on waking rather than at knockout, so being finished while out never leaves a status on a corpse.

Waking is swept by the game loop's existing per-second player walk rather than a timer per victim: a KO
is far too short-lived to justify timer bookkeeping across logout, death and reconnect.

## The law

| crime | stars | witness |
|---|---|---|
| `assault_knockout` | 2 | **camera** |
| `execution` | 5 | forced |

**Charged on the attempt, not the result** — a camera does not care whether you connected, and a missed
swing at the back of a head is the same footage. Camera-witnessed like `drug_use`, so creeping up on
somebody in an unlit alley genuinely is not a crime, and lens coverage becomes something worth casing a
place for.

**`execution`** is killing somebody who was already unconscious. There was nothing they could do about
it, and the city charges it accordingly — far heavier than a killing in a fight. That asymmetry is what
makes leaving a body breathing the cheap option and finishing it a decision with a price. It fires off
the ordinary death path, so it costs the knockout system nothing to enforce.

## Police take you alive at 4–5★

At ≤3.5★ a unit already detained rather than killed (the apprehend engine). Above that they attacked
outright, which made **maximum heat the one route that skipped jail entirely** — Precinct 9, the
evidence locker and the hackable cell door were only ever reachable at *low* heat.

Now a manhunt unit carries `_takesAlive`, and a strike that would kill you knocks you out instead
(`gameLoop`, the single place in the engine where HP reaching zero is not death — and deliberately not
general: an ordinary enemy still kills you). `police.tookAlive` fires, and the jail plugin books you
through the same `bookIntoCell` the other two paths use. You keep the sentence, the fine and the
concussion.

---

## Known gaps

- **Nothing here has run against a live server.** Regress covers the substrates, the verb gates, the
  weapon rules and the state machine, but the reaction branches (NPC bolts, enemy turns), the crime
  charges and the police takedown all need live NPCs and a real session.
- **A panicking NPC runs at random**, not away. `tickPanic` picks any exit rather than pathing from the
  threat, so a frightened person can bolt straight past the man who scared them. `findPath` is right
  there (burglary's flee step uses it) if this ever needs to be smarter than "gone".
- **Nobody remembers panicking.** Same gap as the knockout: `player_npc_relations` is untouched, so an
  NPC who fled screaming from you greets you normally an hour later.
- **Still no vision cones or facing.** Crossing a room unnoticed works, but the room notices as a whole
  — nobody has a direction they are looking in, and there is no cover to move between.
- **Sneaking has no effect on sound.** `propagateSound` already carries loudness and would be the
  natural next connection — a sneaking player's footsteps should be quieter, and a running one's
  should not be sneakable at all.
- **Knockouts do not feed relations or gossip.** An NPC you coshed and who woke up thinks nothing of it
  next time you meet, despite `player_npc_relations` being right there.
