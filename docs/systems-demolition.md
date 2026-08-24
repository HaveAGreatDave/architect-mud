# Demolition — breaching charges (as built)

**Status: BUILT.** Rigging, defusing, the fuse, the blast, the crime, and both minigames on all
three Display Mode rungs. Lives in [plugins/demolition/](../plugins/demolition/index.js).

---

## The rule the whole thing turns on

**A charge is not a weapon.** There is deliberately no verb that throws one at a person, no blast
radius you aim, and no way to make one go off on somebody else's schedule. You wire it to a *thing*,
you choose how long you have, and then the interesting part of the mechanic is that **you are
standing next to it**.

Everything else follows from that:

- **The fuse is public.** The room is told when one starts ticking. A charge nobody can perceive is
  an assassination with extra steps, and it would leave `defuse` as a verb with no way to learn
  about its own target.
- **Anybody can defuse anybody's charge**, including your own. This is PvP-capable from the day it
  ships, which is a feature and is also why the disarm board has to exist on every rung.
- **The blast does not care whose it was.** It hits everyone in the room, the person who set it
  included.

## ⚠ The verb is `breach`, and it wanted to be `rig`

`rig` belongs to [trucking](systems-trucking.md) — coupling a tractor to a trailer. Plugins beat
each other by **load order, not intent**, and the collision does not error: the first draft of this
plugin shipped a `rig` that answered *"You would need to be at a depot. The benches are in the
yards."* Checking every `plugin.json` command array is the only way to know a verb is free, and the
engine builtin map is a second namespace to check after that. (Psionics learned the same lesson
three times over — see the collision trap in [systems-psionics.md](systems-psionics.md).)

`breach` is the better word anyway; the item is a breaching charge. The plugin's own regress asserts
`rig` still means what trucking means by it, so a rename back is a red rather than a mystery.

## ⚠ The bang being unheard must never stop the bomb going off

`getBroadcast()` is not guaranteed to be installed — it isn't in the regression harness and it isn't
during early boot — and `propagateSound` calls it without a guard. The unguarded version threw at
the top of `detonate()`, and because the sweep wraps that call in a `.catch`, **the damage, the
destruction, the crime and the quest event were all silently skipped** by a charge that had visibly
been armed. Presentation is the only part of a detonation allowed to be missing.

## What it does not own

Four things this plugin needs already existed, and each is reached through the seam that already
serves it. This is most of the reason the plugin is small.

| Need | Seam | Why not here |
|---|---|---|
| Damage | `applyStrikeToPlayer` ([combat.js](../server/engine/combat.js)) | ⚠ Writing `player.hp` by hand would still *look* right — the number goes down — while silently skipping the body-part roll, typed soak, armour wear and every damage observer the injury plugin hangs a real wound off. Same rule the mutation organs and psionic backlash follow. |
| Sound | `propagateSound` | The neighbouring rooms hear it and the far ones hear *something*, with no new propagation code. |
| Crime | the `CHARGE_CRIME` action | Dispatched **by name**, so demolition never imports surveillance. |
| Quest progress | `demolition.detonated` → one `on()` in [plugins/quests](../plugins/quests/index.js) | Gives the `demolish` objective type — and, because failure is the mirror of objectives, the `demolish` *fail* condition too. Exactly the shape `augment.installed` set. |

## State: none that outlives a restart

Live charges are a RAM `Map` keyed by charge id, swept by **one `1s` scheduler subscriber** rather
than a timer per charge. A restart forgets them.

That is correct rather than lazy. A fuse is a thing measured in seconds; the durable residue of one
going off is the `destroyed` flag on the furniture row, which is already persisted. A table would
buy a migration and nothing else. (Same reasoning as heat in [systems-augments.md](systems-augments.md).)

⚠ The sweep **deletes from the map before it awaits `detonate()`**. Invert that and a charge
detonates once a second, forever.

## Arson or vandalism, and why it is forced

An explosion is not something anybody fails to notice, so the crime is charged with a forced
witness rather than rolled. Which crime depends on whether there was anybody in the room to
endanger — `arson` if there was, `vandalism` if not. That is not a judgement call; it is the
distinction [the crime registry itself draws](../server/engine/crimes.js) between *"setting a fire
in an occupied structure"* and *"destroying property"*.

⚠ **A quest whose objective is a detonation must not also fail on `witnessed`.** The blast charges a
crime every time, so an untargeted `witnessed` condition on such a quest fails it the instant it
succeeds. Either narrow the condition to a specific crime key, or — usually better — accept that
blowing a building up is a statement and let the stars be the consequence.

## The two boards

Both go out through `textRender()` ([minigame.js](../server/engine/minigame.js)), so one call
serves all three rungs:

| Rung | What opens |
|---|---|
| `visual` | [demolition.js](../client/game/js/panels/demolition.js) — a chassis overlay |
| `textgames` | [textdemolition.js](../client/game/js/panels/textdemolition.js) — the same game drawn in characters |
| `log` | Nothing opens. `resolveForLogRung` settles it on one `science` check and the client reports the server's own outcome through the same resolve verb. |

**The middle rung is the same game, not a description of one**, and that is true by construction
rather than by effort: [demolitiongame.js](../client/game/js/panels/demolitiongame.js) owns the
loop — the needle, the band, the loom, the clock — and both panels are skins over it. Neither can
drift on a tuning pass because there is only one of it.

⚠ **Both call sites pass `skill: 'science'` explicitly.** `textRender` defaults its log-rung check
to `hacking`, and its own header warns that a family whose board is not about breaking into a
computer must name its skill or the bottom rung silently grades a different competence than the
other two. `science` was already defined as *"Energy weapons, **charges**, and homemade bad ideas"* —
the skill for this was written years before the mechanic.

### Arming

Set a fuse, then seat three leads: a needle sweeps a track and you commit. Skill widens the
tolerance band; the target's `rig_difficulty` speeds the needle up. Three good seatings arm it,
three fumbles ruin the charge.

**The fuse is chosen before the skill test**, so it is a decision rather than a reward. Short is
worth more — less time for anybody to find it — and short is also what you have to walk out
through. ⚠ The board reports the chosen fuse back with the outcome and **the server clamps it**; a
client is never trusted with how long everybody else has to react.

A fumbled seating wastes the charge. It does **not** go off in your hands: there is no version of
this game where a bad roll on a menu kills you with no warning and nothing to do about it.

### Defusing

A loom of leads, one of them the shunt. A meter reads tension on any lead you probe, and the shunt
is the one reading against the run — **deducible, never a guess**, which is the whole difference
between this and picking a colour. Skill pre-labels some of the loom; it never hands you the answer.

⚠ **Probing spends the real clock.** The server is still counting down and this board cannot pause
it. Running the clock out here does not *lose* — the board closes and the charge goes off exactly as
it was always going to, because the server owns that and a client claiming a loss would be a second
opinion on an authoritative fact.

Cutting the wrong lead does **not** detonate it early. The clock was always the threat; being wrong
just means you are still standing there with it ticking, which is punishment enough and stays
legible.

## Authoring

Two tags, no code:

- `demolishable` on any furniture row — that object can be rigged. A tag rather than a list of
  furniture ids, so a builder decides what is worth blowing up when they place it.
- `rig_difficulty` (1–10, default 5) — how fiddly the arming board is. It scales the seating game
  only; it can never refuse outright, because a difficulty that could would be a locked door
  wearing a minigame.
- `explosive_charge` on the item. `item_breach_charge` ships; the existing `item_null_emp_charge`
  is its non-lethal sibling and belongs to [nullcraft](systems-nullcraft.md).
