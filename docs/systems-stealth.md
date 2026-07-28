# Stealth & Unconsciousness

**STATUS: BUILT** — sneaking, the notice model, knockouts on players and NPCs, the two crimes, and
police taking you alive at high heat all ship. Not yet exercised against a running server; see
[Known gaps](#known-gaps).

Two engine substrates and one plugin:

| | |
|---|---|
| [`engine/stealth.js`](../server/engine/stealth.js) | *has this observer noticed you?* — per observer |
| [`engine/unconscious.js`](../server/engine/unconscious.js) | being out cold, on players and NPCs alike |
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
| NPC | ducks, sees who it was, and **bolts shouting** — `ai.alarm`, the engine's existing "a plugin is driving this NPC" flag, which already carries the panic cop-call |
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
- **No stealth *movement* model.** `sneak` gates one action; it is not a hiding system. You cannot be
  unseen while standing still, NPCs have no vision cones, and nothing tracks facing. If real stealth is
  ever wanted, this posture is the thing to build it on.
- **Sneaking has no effect on sound.** `propagateSound` already carries loudness and would be the
  natural next connection — a sneaking player's footsteps should be quieter, and a running one's
  should not be sneakable at all.
- **Knockouts do not feed relations or gossip.** An NPC you coshed and who woke up thinks nothing of it
  next time you meet, despite `player_npc_relations` being right there.
