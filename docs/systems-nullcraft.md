# Nullcraft — the Null's discipline

**STATUS: BUILT — the substrate, the seven operations, the turn-based intrusion
board and both its Display Mode faces, Null hardware, carried jamming, the EMP
charge, veiling and the overclock exploit. The Architect network ladder (§11) is
DESIGN ONLY and nothing in it is implemented.**

Architect has four faction answers to *how do I become powerful*, and until now
only three of them were systems you could play:

| Order | System | Philosophy |
|---|---|---|
| The Wildblood | [mutations](systems-mutations.md) | Become something else. |
| The Ascendants | [bionics](../plugins/augments/README.md) | Build something better. |
| The Long Watch | skills + stats | Master yourself. |
| **The Null** | **Nullcraft** | **Make the machine go silent.** |

The Null already existed as a canon order — `ideology_null`, stance `renounce`,
path `machine`, and the only order with an authored hostile edge to the
Ascendants ([systems-ideologies.md](systems-ideologies.md)). They had a
philosophy, a rivalry, and no verbs. This is the verbs.

The Ascendant wins by maintaining technological integrity. The Null wins by
causing a technological failure at exactly the right moment.

---

## 1. The rule the whole thing rests on

**NULLCRAFT NEVER INVENTS A SECOND COPY OF STATE THAT ALREADY EXISTS.**

This is not a style preference; it is the reason the system is an engine
substrate rather than a plugin with its own tables. When Nullcraft was scoped, a
surprising amount of it was *already shipping* — camera-scoped, and scattered:

- `security_devices.status_flags` has held `{ jammed, spoofed, hijacked_by,
  looping, blinded }` since the surveillance plugin was written. Five of the six
  operations already had a persisted vocabulary.
- `getInterferenceZones()` already computed zone-level jamming and spoofing, with
  a cache, a jam-beats-spoof precedence and a relay counter-measure.
- `cameraLiveInZone` / `isWitnessed` already gated the **wanted system** on it, so
  jamming a zone already defeated the law.
- [`hack-gear.js`](../server/engine/hack-gear.js) was already the single funnel
  for intrusion hardware.

So the correct move was never to write a `NullService` that re-implements
jamming. It was to **promote the model and widen the target set**. Everything is
built to make the second implementation impossible, and the most important case
in the regress suite asserts exactly that: *a Null-jammed camera reads exactly
`jammed`* — the same string, from the same function, that a planted jammer
produces.

⚠ If you find yourself adding a jam column, a jam Set or a "disabled" flag, stop.
The thing you want already exists one layer down.

---

## 2. The four decisions

### Trace is RAM-authoritative and decays at read, never on a tick

Trace, heat, and every transient operation live in module-scope `Map`s in
[`server/engine/nullcraft.js`](../server/engine/nullcraft.js), decayed against a
timestamp when read. **This file owns no table.** A logout drops the lot, which
is correct and matches how `wantedRuntime` treats pursuit — the machine forgets
you were poking it, eventually, on its own.

Only *durable consequences* reach the database, and they reach it through the
**contributor's own writer** (an augment's `condition`, a device's
`status_flags`), never through a table owned here.

Trace also decays **before** a fresh delta is applied — the `adjustReputation`
ordering rule, and for the same reason: a stale value resurrected by one more
action is a bug that only ever shows up in players who took a break. Pinned by a
regress case.

### Every target answers ONE interface, contributed by a gather hook

`gatherHook('tech.targets', player, ctx)`. The substrate knows **nothing** about
augments, cameras or drones; each owning plugin describes its own hardware. This
is the `workspace.provider` seam, already proven twice by cooking's kitchen and
synthesis's chembench.

```js
{ key, ownerId, ownerName, zoneId, name, kind,
  subsystems: [{ id, kind, exposure }],
  security:   { rating, wireless, auth },
  notes: [],
  apply(op, subsystem, ctx),      // the CONTRIBUTOR mutates its own state
  onFailure?(ctx) }               // optional world reaction
```

**`apply` is the load-bearing field.** The substrate rolls, traces and narrates;
the contributor mutates. That is what keeps `nullcraft.js` free of imports from
augments, surveillance and flight — and it is why a camera's `status_flags`
remains the one truth about whether that camera is jammed.

### Security is DERIVED, never authored twice

A bionic's security comes from `augments.tier`, `player_augments.calibration`,
`.condition` and `augments.overclock_max` — the numbers that already answer *how
good is this chrome*. A camera's comes from `tier` and `hack_difficulty`.

Authoring a `security` column would be a second source of truth for the same
question and would drift from `tier` within a month.

`overclock_max` doing double duty is the neatest part: it is already **the entire
mechanical statement of the faction split** (licensed Ascendant chrome authors
0–1, back-alley chrome authors 3), so reading it here makes the licensed piece
the hard target with nothing new authored anywhere.

### A failure is never just a failure

Every failed operation does something to the world: trace jumps, the owner may be
told their gear reported a handshake they did not authorise, and a hard failure
against defended hardware **burns the deck** through the existing
`damageHackDeck` funnel. A contributor may add its own reaction via `onFailure`.

A system whose failure state is a grey message teaches players that failing is
free, and this one is explicitly built so it isn't.

---

## 3. The vocabulary

[`server/engine/nullcraft-ops.js`](../server/engine/nullcraft-ops.js) — two
registries, the `mutation-effects.js` pattern, for the same reason: **a key must
be declared before it can be used**, so an unrecognised one fails the build
instead of being silently ignored forever. `unknownOperationKeys()` is asserted
empty by the regress suite.

**Eight subsystem kinds** — `power`, `control`, `actuation`, `sensor`,
`telemetry`, `network`, `processing`, `security`. They are conceptual layers, not
a parts list: a servo arm and a camera both have `power` and `network`, which is
exactly what makes one skill work on both.

**Seven operations**, escalating in difficulty and trace:

| Op | Kind | Reaches | What it is |
|---|---|---|---|
| `jam` | transient | sensor, telemetry, network | Drown the signal. Nothing damaged, nothing learned. |
| `spoof` | transient | sensor, telemetry, network | Feed it something false — better when you want the machine *trusted*, not silent. |
| `lock` | transient | actuation, control, power | Refuse it permission to act. Brief, and often all you needed. |
| `crash` | transient | control, processing, security | Force a restart. Loud, total, impossible to miss. |
| `hijack` | persistent | control, actuation, network | Possession, for as long as you hold the trace down. |
| `powerspike` | durable | power | Surge the supply. Devastating against a machine already running hot; a flicker against one at spec. |
| `sabotage` | durable | power, actuation, control, processing | Real damage the owner pays to undo. |

**The applicability table is load-bearing.** You cannot jam a hydraulic ram —
there is no signal in it to jam — and you cannot lock a telemetry stream. Keeping
that honest is what stops six operations collapsing into one generic "break it"
verb with six skins. Four regress cases pin it.

**The three kinds are the tactical decision.** A thirty-second servo lock that
leaves no trace is a different object from a sabotage that costs the victim
money, and spec intent was explicit that a player should frequently have reason
to pick the *simpler* operation. That only works if the cheap ones are genuinely
cheap and genuinely temporary.

---

## 4. The verbs

### The door — nullcraft is the Null's, and standing is the key

**Every registered verb is wrapped in `initiatesOnly`**, which refuses anyone below
`INITIATE_REP` (200 — the `known` tier) with `ideology_null`. The refusal is a bare
`Unknown command.`, the convention psionics already keeps: a surface you cannot
reach should not advertise itself.

Two rules to preserve.

**The skill is not the gate.** `nullcraftLevel` decides how *well* you do this;
standing decides *whether you may*. Collapsing the two is what shipped originally,
and it meant a point in a skill bought a whole faction's identity — the Ascendants
sell chrome, the Wildblood hand out flasks, the Long Watch teach, and every one of
those is a commitment made *before* the thing is handed over. This is the same.

**The wrapper, not a check per handler.** It is applied once at the `commands`
export so a verb added later cannot forget it, and `regress.js` asserts every
declared command in `plugin.json` actually goes through it — a handler wired
straight to its `cmd*` function fails the suite rather than shipping an open door.

The way in is content, not code: `quest_null_1..3` off Maud Threlfall
(`npc_dw_threlfall`, the tally room at `zone_dw_769_976`), granting 60 / 80 / 120.
That ordering is deliberate — 140 after the second job leaves you short, so the
discipline opens on the **initiation** and never before it.

`plugins/nullcraft/` — three commands.

| Verb | Cost | Does |
|---|---|---|
| `nullscan` | free, no roll | What is powered in this room. |
| `analyze <target>` | a check, a little trace | Subsystems, exposure bands, security band, radio state. |
| `null <op> <target> <subsystem>` | a check, trace by op | The operation. |

**`nullscan` is free on purpose.** It is the discoverability rung: a player who
has just put a point in Nullcraft needs one verb that always works and always
shows them the surface exists, and its output teaches `analyze` with the house
`teachVerb()` shimmer. Making the entry verb a dice roll means a new Null's first
experience of the discipline is it not working.

**Detail scales with skill.** Below Nullcraft 3, `analyze` names the surface and
its exposure. At 3+ it also names the operations worth trying. High skill makes
the read *richer*, never automatic.

`null jam camera optics` and `null jam camera` both parse — the grammar is
deliberately loose, and a missing subsystem lists the ones that operation can
actually reach rather than erroring.

### Naming

`scan` was taken (a flight command **and** a library specialized action) and
`ghost` is heavily loaded by the engine's own ghost-mode, so the verbs are
`nullscan` and — later — `veil`. Plugins beat engine builtins, so silently
stealing either would have been the failure mode.

---

## 5. Trace, and the two thresholds

Trace is the *how long do I stay inside this system* clock.

- **60% — the owner is told.** Something touched their gear.
- **100% — lockout.** Everything you touch closes before you reach it.

The half-life is ~2 real minutes, deliberately short: trace is tactical pressure,
not a punishment that follows you around. Walk away and you are clean; keep
working and you are not.

Loud operations announce themselves **regardless of trace** — a `crash` always
tells the owner, because a rebooting limb is not a subtle event and pretending
otherwise would make `crash` strictly better than `lock` rather than louder.

---

## 6. The two contributors

### Surveillance — [`plugins/surveillance/nulltarget.js`](../plugins/surveillance/nulltarget.js)

**The integration point is one line in `deviceStatus()`.** Because
`cameraLiveInZone`, `isWitnessed`, `feedSnapshot` and the hub all already ask
`deviceStatus`, every one of them inherits Null jamming without knowing Nullcraft
exists.

Concealed devices are deliberately **included** as targets: finding hidden
hardware by its emissions rather than by looking for it is what a signals
discipline is *for*, and it is the one thing Nullcraft does that `search` cannot.

### Augments — [`plugins/augments/nulltarget.js`](../plugins/augments/nulltarget.js)

**The integration point is one filter in `getAugments()`** — the single funnel
every derived augment number already passes through. Suppressed chrome drops out
by the same route an EMP already uses (`chromeDown`). There is no "disabled"
column.

`augmentKey`, `VITAL` and `nullAugmentDown` live in `state.js`, not
`nulltarget.js`, so the dependency runs one way — `state.js` is imported by
everything and imports nothing of the plugin's own.

⚠ **Telemetry is deliberately NOT vital.** Killing a telemetry stream blinds the
*owner* to their own hardware; it does not stop the limb working. Collapsing that
distinction makes every operation the same operation. Pinned by regress.

Your own chrome is a legitimate target — reading your own attack surfaces is how
an Ascendant learns what to harden.

---

## 7. Counterplay (built)

**The manual override.** `player_augments.custom_data.radio_off` makes an augment
unreachable through the `network` layer entirely — the physical surfaces remain,
but the radio is gone. This is what stops Nullcraft invalidating expensive gear,
and it costs no column. Two regress cases pin both halves.

**Veiling is capped below total invisibility** (`VEIL_CAP = 0.85`). Ghosting
makes you hard to *witness*; it must never make you unarrestable. The jail
system's whole downed-while-wanted path assumes the law can eventually win, and a
player no camera can ever see has left the consequence loop rather than outplayed
it.

---

## 8. NULL INTRUSION — the board

`type: 'null_intrusion'`, in [nullboard.js](../client/game/js/panels/nullboard.js)
with its character skin in
[textnullboard.js](../client/game/js/panels/textnullboard.js).

**It is the only TURN-BASED minigame in the client, and that is the point.**
Every other family is a reflex game, which is why
[systems-display-mode.md](systems-display-mode.md) has `resolveForLogRung` rolling
a single dice check at the bottom rung and calling itself *"an interim shape"*
explicitly waiting for somebody to write "a turn-based breach". This is that
breach. Nothing moves unless the player moves it, so the same game is playable at
every rung — and a Null intrusion is meant to feel like thinking rather than
twitching, so the fiction and the accessibility argument want the same thing.

A layered DAG: column 0 is the interfaces reachable from outside, the last column
is the subsystem you named. Some nodes are **defended**; stepping on one spikes
ALERT, and at 100 the interface closes. Two actions, and the whole game is the
tension between them:

- **PROBE** — costs a step, reveals whether an adjacent node is defended
- **MOVE** — costs a step, and if you were wrong it costs alert

Steps are finite, so probing the whole frontier is exactly as fatal as walking in
blind, just slower.

**Skill buys steps and starting intel, never a lower alert cost.** A better Null
is better at *reading* a machine's defences, not at wishing them away — the
target's security belongs to the target.

⚠ **A clean path always exists inside the step budget.** The generator carves the
route first and scatters defences among what is left, rather than rolling and
re-rolling until solvable. An unsolvable board is not a hard board, it is a bug
that reads as difficulty, and a player cannot tell those apart.

Two things to preserve: `textRender` is called with **`{ skill: 'nullcraft' }`**
(it defaults to `hacking`, and the bottom rung would otherwise grade the wrong
competence), and the arm/resolve handshake is nonce-guarded — a `nullresolve`
that does not match the armed operation does **nothing**, so a forged client
cannot apply an operation nobody played.

## 9. Hardware, jamming and EMP

Null gear lives in **[hack-gear.js](../server/engine/hack-gear.js)**, extending the
existing funnel rather than forking it: `null_device`, `null_intrusion`,
`null_jam_strength`, `null_jam_radius`, `null_stealth`, `null_selective`.

A `null_device` is deliberately **not** a `hack_device` — a deck gets you *into*
a thing, Null gear attacks what a thing *depends on*, and a player may sensibly
carry both — but they resolve the same way, because a second copy of the
"which of my several devices answers" rule would drift.

**Intrusion strength cancels target security. Stealth buys TIME, not power** —
it slows trace accrual, capped at 0.75, so gear can extend a visit and never make
it unlimited.

**Jamming.** `jammer on` spends a `jammer_cell` and runs a field for ~4 minutes.
The carried half lives in the substrate (`carriedJamAt`) and is merged into
`getInterferenceZones()` **by surveillance**, which keeps sole ownership of the
planted half, its relay counter-measure and its precedence. One direction only.
The merge happens *after* the relay pass: a hardened building relay is not
defeated by a bag jammer somebody just switched on.

⚠ **Selective gear contributes NOTHING to the zone field.** That is what you pay
for — a black box takes one carrier off the air and leaves your allies' radios,
and your own deck, working. If it ever starts flooding the room, the expensive
option has silently become the blunt one. Pinned by regress.

**EMP.** `emp` fires **the same pulse the ion storm fires**, scoped to your room
via a `zoneId` parameter added to `weather.empPulse` — same fry rule, same
`fried` instance flag, same faraday-container exemption, same chrome blackout,
same bench repair. It takes the thrower's own gear unless shielded, and that is
the entire tactical decision rather than an oversight.

## 10. Veiling and the overclock exploit

**`veil`** spends a cell and blurs your electronic signature. It is applied to
the **camera** branch of `witnessRoll` and deliberately **not** to the officer
standing in the room: a scrambler is an emitter, not a glamour, and a human being
looking straight at you is not a sensor you can talk to. Capped at `VEIL_CAP`
(0.85), so it is a heavy discount and never immunity.

**`powerspike`** is the payoff of the whole design. Damage scales with how far
past spec the owner chose to run — at overclock 3 it is most of the augment, at
spec it is a flicker and says so. It invents no failure mode: it spends
`condition`, the same currency wear and heat already spend, and speaks the
augment's **own authored `failure_messages`**, which the overclock system already
requires every overclockable augment to carry.

*The Null does not invent a way to break chrome. It presses the button the
Ascendant installed.* And because `overclock_max` is already the entire
mechanical statement of the faction split, backing off an overclock is a real
defence the Ascendant chooses — not a nerf handed to them.

## 11. Architect infrastructure — DESIGN ONLY

Nothing here is implemented and nothing should be built without a fresh decision.

The ladder: `DEVICE → LOCAL NETWORK → BUILDING → DISTRICT → CORPORATE →
ARCHITECT SUBSYSTEM → DEEP ARCHITECT`. Compromising a camera means you found a
crack in one tiny piece, not that you hacked Architect.

Architect defends itself: cameras turn toward the attacker, networks reroute,
false nodes appear, and a vulnerability may be **bait**. At the deepest level the
interface stops reading like a login failure and starts reading like an
invitation — *AUTHENTICATION ACCEPTED. YOU SHOULD NOT BE HERE.* — so the
question a Deep Null is left with is whether they broke in or were let in.

A `Null Shard` item may be authored ahead of this, and if it is, it is a rare
curio with no consumer until the ladder exists. Say so rather than shipping a
dead item silently.

---

## 12. Files

| Piece | Where |
|---|---|
| Substrate (trace, suppression, targets) | [server/engine/nullcraft.js](../server/engine/nullcraft.js) |
| Operation + subsystem registries | [server/engine/nullcraft-ops.js](../server/engine/nullcraft-ops.js) |
| Verbs, failure reactions | [plugins/nullcraft/index.js](../plugins/nullcraft/index.js) |
| Camera/drone targets + `nullSuppressed` | [plugins/surveillance/nulltarget.js](../plugins/surveillance/nulltarget.js) |
| Chrome targets | [plugins/augments/nulltarget.js](../plugins/augments/nulltarget.js) |
| Suppression predicate (beside `getAugments`) | [plugins/augments/state.js](../plugins/augments/state.js) |
| The skill | `nullcraft` in [server/engine/skills.js](../server/engine/skills.js) |
| Tests | [plugins/nullcraft/regress.js](../plugins/nullcraft/regress.js) |

`hacking` was deliberately **not** renamed or absorbed. Hacking is getting into a
*thing*; Nullcraft is attacking what a thing *depends on*. They share hardware and
they are different competences, and merging them would silently regrade every
breach already in the world.
