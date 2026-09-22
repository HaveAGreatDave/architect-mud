# Shop alarms

**Status: BUILT** — the authored half (NPC premises) ships. A purchasable tier for player-owned
storefronts is designed and not built; it is marked as such in §7.

Breaking into a shop is one move plus one clock. The lock was always hackable; what this adds is
what is waiting on the other side of it.

---

## 1. What was already there

Worth stating plainly, because half of this feature is a thing that has been shipping for a while
and reads like new work.

- **`lock:shopshutter`** — player-owned storefronts, difficulty 5, `canHack: true`
  ([plugins/storefront/index.js](../plugins/storefront/index.js)), with the shutter's durable
  position on `storefronts.shutters_closed`.
- **`lock:shoplock`** — NPC vendor shops, difficulty 4, `canHack: true`
  ([plugins/commerce/shopdoor.js](../plugins/commerce/shopdoor.js)), fitted and thrown by the
  trading-hours sweep.
- `hack <door>` runs both through [doors.js](../server/engine/commands/doors.js) and, on success,
  emits `hololock.breached`.

⚠ **`lock:shopshutter` declared `canHack: true` for months and could not be hacked** — the hack path
named `lock:hololock` literally, so the verb fell through and a player working a shutter got an
answer about a safe. Fixed 2026-09-19; `plugins/doors/README.md` records it. Everything here stands
on that fix.

66 shopfronts carry one of the two lock types. **An alarm behind a door with no lock on it can never
arm**, so that set is the whole addressable surface.

## 2. The one idea

**The window is the mechanic, and it is one clock.**

The alarm arms the moment the *lock* gives, which is while you are still out on the pavement.
Everything after that spends the same clock: walking in, finding the panel among the room's
furniture, and the board itself. `hack alarm` opens a game whose length is **what is left** — never
a per-game constant.

That is the whole of what makes a faster model worth paying for. It does not make the puzzle harder
so much as make you **commit before you have looked around**, which is a different and better kind
of pressure than a smaller number.

⚠ **The `1s` sweep is the only authority on whether it tripped.** The board carries a countdown
because it has to draw one; a board that believes it won after the sweep fired finds nothing in
`pendingDisarm` and no-ops. Two clocks that can each decide an outcome is the bug the rule exists to
prevent, and it is reachable in ordinary play — a client a second behind is an ordinary client.

⚠ **Running the clock out is not a loss and is never reported as one.** Both boards close and send
nothing. Reporting a loss there would *also* damage the deck for a race the player never lost.

## 3. The models

| tier | window | difficulty | what it is |
|---|---|---|---|
| 1 | 90s | 3 | a bell box, mostly for show |
| 2 | 60s | 4 | standard shopfront fit (the default) |
| 3 | 40s | 6 | what a bookmaker buys |
| 4 | 25s | 8 | bonded-courier grade |
| 5 | 15s | 10 | Ascendant, and it knows your face |

The window and the difficulty **move together and in the same direction**, so a tier is one rung on
one ladder rather than two knobs to trade off. `regress.js` asserts they never cross, and that even
tier 5 clears `DISARM_FLOOR_S` — a model whose window is under the floor is a tier nobody can ever
play against.

**The tier says what the premises have to lose, never how central they are.** A pawnbroker with a
back room full of other people's things buys a better box than a department store with a guard on the
floor. Twelve are authored across the whole ladder: a gun shop and the casino at 5, two pawnbrokers
at 4, down to a laundromat and a corner shop at 1.

## 4. What the plugin knows about shops

**Nothing.** The gate is `hololock.breached` plus "is there an `alarm_panel` piece on the far side of
that door". So [plugins/shopalarm](../plugins/shopalarm/README.md) has never heard of shops,
shutters, storefronts or trading hours, and an office, a lock-up or a private gallery is alarmable by
authoring one furniture row.

⚠ `zoneId` on that event is where the **hacker** stands, which for a shopfront is the street. The
premises are the far side, which is why the event now carries the `door` — a one-field additive
change in doors.js, and the only engine change this feature needed beyond the crime key. Content
anchors those door rows on **both** sides (some `_in`, some `_out`), so `farSideOf` handles either
and regress covers both.

## 5. The law

`CHARGE_CRIME` with **`breaking_and_entering` (4★, `witness: 'always'`)** — a new key in
[crimes.js](../server/engine/crimes.js).

⚠ **`witness: 'always'` is the mechanic, not a convenience.** The alarm *is* the witness; it dialled
SPECTER-PD itself, so a dark street and a jammed camera buy nothing. Any other value turns the whole
feature into a coin flip on a witness roll.

⚠ **`CHARGE_CRIME`, never `WANTED_RAISE`.** The raw raise gives the stars and skips the evidence clip,
the siren line and `dispatchPolice` — and the police actually arriving is the entire consequence being
asked for.

**The plugin dispatches no police of its own.** Surveillance already sirens and dispatches at any
star count, so charging the crime *is* sending them; a second dispatch would put two cars on one call.

⚠ `flags.lawless` swallows the charge silently. Correct — the Reach keeps no police — and it means an
alarm out there makes a noise and nothing else.

**The loot stays lootable.** Nothing locks down, nothing re-shuts, the till and the shelves are where
they were. The question the trip asks is not *can you still rob it* but *can you get out*.

## 6. The three rungs

One loop, two skins, per the demolition rule: [alarmgame.js](../client/game/js/panels/alarmgame.js)
owns the game, `alarmpanel.js` and `textalarm.js` are skins over it, and neither owns a rule.

The board is a **terminal block**. One terminal is live; every terminal carries its own tag and the
tag it runs to. Follow the loop, latching in order.

⚠ **The answer is always deducible and never a guess** — the defuse board's own rule. At every step
exactly one terminal carries the tag you are looking for, printed in front of you. What the clock
takes away is not your knowledge, it is your time to *look*, which is why the pressure reads as
pressure rather than as a dice roll in a costume. Skill buys strikes, difficulty buys chain length and
decoys, and **neither buys time**.

At `log` the board never opens: `textRender` resolves on one `hacking` check and reports through the
same verb, so the rung is an answer rather than a dead end.

⚠ `isTextAlarmActive()` is in `paneFreeForRoom()`. Without it a `look` or a move wipes the board out
of `#area-pane` mid-game — the bug the fishing board nearly shipped with.

## 7. Sound, light and the things that are silent when wrong

The chirp and the siren are procedural — a new `action: 'alarm'` in
[procedural-sfx.js](../client/shared/procedural-sfx.js) with `warn` and `siren` states. The chirp
**accelerates** (4s → 2s → 1s) and **that acceleration is the readout**, because there is deliberately
no number on screen in any display mode.

⚠ **A line goes with the sound, always.** A timed feature whose only warning is a noise is *invisible*
to a player with audio off — not harder, invisible. [alarm.js](../client/game/js/alarm.js) prints one
when, and only when, sound is off; `esp.js` carries the same rule for the emergency siren. It goes
through the log, which is the one live region, so a screen reader gets the countdown for free.

⚠ **No strobe, at any rate.** The photosensitivity rule the drug FX are held to applies to anything
that flashes, and a real alarm strobe is exactly what it forbids. `body.shop-alarm` *breathes* on a
1.6s cycle, and `prefers-reduced-motion` drops the animation for a flat red wash so the state stays
legible.

⚠ **The red is cleared on every way out and re-asserted by the server.** There is no timeout behind
that class, so a missed clear is a red room for the rest of the session — the drug-FX layer's "the
client holds a source until told otherwise" trap, one system over. The client drops it on any room
change and on death; the plugin pushes it back on `zone.entered` if the place you walked into is still
ringing, and the ring expires on the same sweep that started it.

## 8. Not built

**A purchasable tier for player-owned storefronts.** The authored half covers NPC premises; the player
half wants a `storefronts.alarm_tier` column (idempotent DDL through the ordinary CODEX push), an
install verb charging the till, and `alarmTierFor(zoneId)` reading the deed first and the panel's flag
second.

⚠ It must **not** write `content/security_devices/` or any content table — the storefront header
records why staff went to `storefront_staff` rather than `npcs`. Deed column, player data.
