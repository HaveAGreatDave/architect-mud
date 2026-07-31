# prologue

**Purpose** — the pre-world tutorial. New souls spawn in The Inbetween and walk a **one-way corridor** before they ever reach Coldwater:

1. **Chargen** at the MORPHEX terminal.
2. The **holosign** — first Architect Interface IP and your holocaster.
3. An **eerie welcome broadcast**.
4. Collapse into the Coldwater clone vat, where the reinstatement machine issues your **tablet**.

Move gates hard-gate the three narrative doors; the void rooms are lit by the engine's `zones.flags.always_lit` property rather than by fixtures.

## There is no tablet in the corridor

The tablet is not an item and never was — it's the second half of the interface
(`plugins/tablet/`). It used to be available from the first second of the game, which
meant a brand-new player was carrying a city services terminal while standing in a room
with no floor. Now:

- **In the corridor:** `plugins/tablet/index.js` refuses every door into the shell
  (`tablet`/`os`, and `tabletnav`, which is what `codex`/`map`/`gear` and the client's
  own nav all come through). Gated on the **zone's** `flags.prologue`, not a player
  flag — nobody can get back into that corridor, so no existing character is affected.
  The prologue pushes `tablet_access: false` on login there and the client hides the
  Tablet/Inv/Quests anchors in the smart bar.
- **At the vat:** the last beat of `firstClothing()` has a hatch spit the device at you,
  raises `tablet_issued`, pushes `tablet_access: true`, and pushes **`tablet_offer`** —
  a chip in the smart bar that bobs for attention, opens the tablet **and its
  walkthrough** when tapped, and gives up after **25 s** if ignored (`smartbar.js`).
- **Then the poster.** Grady's advert nudge (`pointAtAdvert`) no longer runs on a timer
  behind the tablet chrome: it waits for `tabletdone` — the client's echo when the
  walkthrough ends, is skipped, or the chip times out — with a server-side backstop
  (`ADVERT_FALLBACK_MS`) so the one beat that tells a new player *where to go* can never
  depend on a client answering. Flag-guarded (`prologue_advert_nudged`): exactly once.

## No weather, no clock

Same seam as `tablet_access`, same reason. The Inbetween is not a place, so it must not
have Coldwater's sky over it: a HUD reading `☁ 14°C · light rain · 03:42` above a room with
no floor says *this is really just an interior tile in the city*, which is the loudest
immersion break in the prologue.

- `envUnreal(player, …)` pushes **`env_unreal`** on login and on every `zone.entered`, in
  both directions, keyed off the **zone's** `flags.prologue` — so a new corridor room needs
  no code here, and the step from the collapse into the vat is where real weather begins.
- The client (`setEnvUnreal` in `client/game/js/panels/environment.js`) hides the weather
  rows and the temperature outright, suppresses the weather-FX overlay (a scripted
  `dream_fx` still wins — that's the corridor *doing* something), and answers a tap on the
  forecast in fiction instead of opening Coldwater's week.
- The clock **stays, scrambled** (`∞ ?∅:8–`, re-rolled every tick). A missing clock reads as
  a broken HUD; a wrong one reads as a wrong world.

## The two beats outside the corridor
- **Post-vat onboarding:** after your first kill, Grady points you at his armchair — which is how you learn that sitting heals.
- **Out-of-fiction:** on a first login it asks whether you have ever played a multiplayer text game. If not, the client runs a spotlight tour of the interface. `tutorial` replays it. Its **last step no longer opens the tablet** — it promises one, because you don't have one yet.

## Commands
- `tutorial` / `intro` — replay the tour.
- `introdone` — the client's echo that the cold open has finished. **Load-bearing:** the prologue holds all arrival prose until it arrives.
- `tabletdone` — the client's echo that the tablet walkthrough is over (finished, skipped, or the chip ignored). Releases the poster beat; a no-op outside the vat.

## Specialized actions
- `use`, `read`

## Events consumed
- `appearance.changed` · `posture.changed` · `zone.entered` · `enemy.killed` · `player.login`

## Load order
`after: ["cosmetic-machine", "interactions", "tablet"]` — the corridor drives all three.

## See also
[docs/systems-codex.md](../../docs/systems-codex.md) — the 30-second cold open plays *before* the prologue speaks.
