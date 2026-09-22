# shopalarm

**Status: BUILT.** Authored alarms on NPC premises ship; the player-purchasable tier for
storefronts is design (see *Not built* at the bottom).

**Purpose** — an intruder alarm behind a locked door. Breach the lock and a box inside starts
counting. Kill the panel before it finishes and nobody ever knows you were there; miss it and it
phones SPECTER-PD itself — four stars, a forced witness, and police already rolling while the till
and the shelves are still sitting there.

## The one idea

**The window is the mechanic, and it is one clock.**

The alarm arms the moment the *lock* gives, which is while you are still out on the pavement.
Everything after that spends the same clock: walking in, finding the panel among the room's
furniture, and the board itself. So `hack alarm` opens a game whose length is **what is left** —
never a per-game constant — and a player who browsed the shelves on the way in gets a shorter game
than one who went straight to the wall.

That is the whole of what makes a faster model worth paying for. It does not make the puzzle harder
so much as make you **commit before you have looked around**.

⚠ **The sweep is the only authority on whether it tripped.** The board carries its own countdown
because it has to draw one, and a board that believes it won after the sweep already fired finds
nothing in `pendingDisarm` and resolves to a noop. Two clocks that can each decide the outcome is
the bug that rule exists to prevent — and it is reachable in normal play, because a client a second
behind is an ordinary client.

⚠ **Running the clock out is not a loss and is never reported as one.** Both boards close and send
nothing. Reporting a loss there would *also* damage the player's deck for a race they never lost —
punished twice for one clock — and would be a second opinion on a fact the server already owns.

## The models

Authored per premises as `flags.alarm_tier` on the panel. The window and the difficulty move
**together and in the same direction**, which is the point: a better box gives you less time *and* is
harder once you are at it, so a tier is one rung on one ladder rather than two knobs to trade off.
`regress.js` asserts that they never cross.

| tier | window | difficulty | what it is |
|---|---|---|---|
| 1 | 90s | 3 | a bell box, mostly for show |
| 2 | 60s | 4 | standard shopfront fit (the default) |
| 3 | 40s | 6 | what a bookmaker buys |
| 4 | 25s | 8 | bonded-courier grade |
| 5 | 15s | 10 | Ascendant, and it knows your face |

**The tier is a statement about what the shop has to lose, never about how central it is.** A
pawnbroker with a back room full of other people's things buys a better box than a department store
with a security guard on the floor.

Twelve are authored, spread across the whole ladder — a gun shop and the casino at 5, two
pawnbrokers at 4, down to a laundromat and a corner shop at 1.

## Authoring one

A furniture row on the premises interior. Nothing else, anywhere:

```json
{ "id": "furn_<shop>_alarm", "zone_id": "zone_<shop>", "object_type": "terminal",
  "name": "the alarm panel",
  "flags": { "alarm_panel": true, "alarm_tier": 3,
             "aliases": "alarm,panel,box,alarm panel,alarm box,intruder panel",
             "click_cmd": "hack alarm" } }
```

⚠ **`click_cmd` is the whole of click-to-hack and needs no client code.** `describe.js`'s
`authoredClick` turns it into `data-cmd` on the room's furniture link, and `data-actions` gives the
mobile smart bar the verb. A panel without it can only be reached by typing.

⚠ **The `aliases` are load-bearing.** `hack alarm` resolves through SIFT against the piece's name,
so a panel named "the alarm box" needs the word *alarm* in its aliases or the verb misses it. Regress
checks every authored panel for both of these.

⚠ **The premises need a hackable lock on the door**, or the alarm can never arm. 66 shopfronts carry
`lock:shoplock` or `lock:shopshutter` today; anything else is a panel behind a door nobody can breach.

## What the plugin knows about shops

**Nothing.** The gate is `hololock.breached` plus "is there a panel on the far side of that door",
so this file has never heard of shops, shutters, storefronts or trading hours — an office, a lock-up
or somebody's private gallery works the same way for free.

⚠ `zoneId` on that event is where the **hacker** stands, which for a shopfront is the street. The
premises are on the far side, which is why the event carries the door (added for this). Content
anchors those door rows on both sides, so `farSideOf` handles either and regress covers both.

## The vendor

Checked on **every sweep tick** while an alarm is live, not once at the breach — you can be walked in
on at any point. A vendor who sees you does not shorten the clock; they remove the point of beating
it. The charge lands whether or not the box ever finishes, and they hold a grudge.

⚠ Once per alarm, flagged — without that an NPC standing in the room re-charges the crime and
re-shouts a line once a second for the whole window.

## The law

`CHARGE_CRIME` with `breaking_and_entering` (4★, `witness: 'always'`), **never `WANTED_RAISE`**. The
raw raise gives the stars and skips the evidence clip, the siren line and `dispatchPolice` — and the
police actually arriving is the entire consequence. `witness: 'always'` is the mechanic rather than a
convenience: the alarm *is* the witness, it dialled them itself, so a dark street and a jammed camera
buy nothing.

**This plugin dispatches no police of its own.** Surveillance already sirens and dispatches at any
star count, so charging the crime *is* sending them, and a second dispatch would put two cars on one
call.

⚠ `flags.lawless` zones swallow the charge silently. Correct — the Reach keeps no police — and it
means an alarm out there makes a noise and nothing else.

## The three rungs

One loop, two skins, per the demolition rule. `client/game/js/panels/alarmgame.js` owns the game;
`alarmpanel.js` and `textalarm.js` are both skins over it and neither owns a rule.

The board is a **terminal block**: one terminal is live, and every terminal carries its own tag and
the tag it runs to. Follow the loop, latching in order.

⚠ **The answer is always deducible and never a guess** — the defuse board's own rule. At every step
exactly one terminal carries the tag you are looking for and it is printed in front of you. What the
clock takes away is not your knowledge, it is your time to *look*, which is why the pressure reads as
pressure rather than as a dice roll in a costume. Skill buys strikes; difficulty buys chain length and
decoys. **Neither buys time** — time is the server's, always.

At `log` the board never opens: `textRender` resolves it on one `hacking` check and reports through
the same verb, so the rung is a real answer rather than a dead end.

⚠ `isTextAlarmActive()` is in `paneFreeForRoom()` in dispatch.js. Without it a `look` or a move wipes
the board out of `#area-pane` mid-game — the bug the fishing board nearly shipped with.

## Sound and light

The chirp and the siren are procedural (`action: 'alarm'`, states `warn` and `siren`, added to
`client/shared/procedural-sfx.js`). The chirp **accelerates** — 4s, 2s, 1s — and that acceleration
*is* the readout, because there is deliberately no number on screen in any display mode.

⚠ **A line goes with the sound, always.** A timed feature whose only warning is a noise is invisible
to a player with audio off — not harder, invisible. `client/game/js/alarm.js` prints a line when, and
only when, sound is off; `esp.js` carries the same rule for the emergency siren. It goes through the
log, which is the one live region, so a screen reader gets the countdown for free.

⚠ **No strobe, at any rate.** The photosensitivity rule the drug FX are held to applies to anything
that flashes, and a real alarm strobe is exactly what it forbids. `body.shop-alarm` *breathes* on a
1.6s cycle, and `prefers-reduced-motion` drops the animation and keeps a flat red wash so the state
stays legible.

⚠ **The red is cleared on every way out and re-asserted by the server.** There is no timeout behind
that class, so a missed clear is a red room for the rest of the session — the drug-FX layer's "the
client holds a source until told otherwise" trap, one system over. The client drops it on any room
change and on death; the plugin pushes it back on `zone.entered` if the place you walked into is
still going off, and the ring itself expires on the same sweep that started it.

## Commands
- `hack alarm` — through the `hack` specialized action, tag-gated on `alarm_panel`. Self-gates
  (returns `undefined`) with no panel here, so the four other owners of `hack` — doors, hackrig,
  storefront, vendor-safe — still claim the verb.
- `alarmresolve` — silent client callback from the board; never typed.

## Hooks
- `furniture.describe` — the fascia reads the same state the mechanic does, so it can never promise
  a dead panel that is actually counting. ⚠ Returns `undefined`, never `null` — `fireHook` keeps the
  last non-undefined result and a `null` blanks another plugin's line.

## Events
**Emits** `shopalarm.armed`, `shopalarm.tripped`, `shopalarm.disarmed`, `shopalarm.vendorSaw`.
**Consumes** `hololock.breached`, `zone.entered`.

## Tick usage
One `1s` sweep over a RAM Map — demolition's fuse, copied deliberately, rather than a `setTimeout`
per alarm. The scheduler idle-gates it for free and a restart clearing the Map is documented
behaviour rather than a leak of orphaned timers pointing at zones that may not exist any more.

## Data schema
None. All state is in memory, like the wanted runtime it feeds.

## Not built
**A purchasable tier for player-owned storefronts.** The authored half above covers NPC premises. The
player half wants a `storefronts.alarm_tier` column, an install verb charging the till, and
`alarmTierFor(zoneId)` reading the deed first and the panel's flag second. ⚠ It must **not** write
`content/security_devices/` or any content table — the storefront header records why staff went to
`storefront_staff` rather than `npcs`.
