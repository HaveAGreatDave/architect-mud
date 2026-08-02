# pinch

**Purpose** — two verbs about beds. `pinch` wakes a sleeping player, who then stumbles home and sleeps *there* — a way to move someone out of a bed that is not yours without killing them. `home` binds your home in an apartment you own, or walks you back to it from anywhere.

## Commands
- `pinch <player>` — wake a sleeper; they go home.
- `home` — bind or walk home.

## Two walks, two clocks

The pinched **offline sleeper** shuffles home on the plugin's `5s` tick, writing
`players.current_zone` directly (there's no live player object to move). One room per
five seconds is the point: it's meant to read as a daze.

A **live `home` walk** is your own legs and is paced off the movement clock instead —
`stepCadenceMs(player)` from `plugins/pacing`, the same number a typed step obeys. It
schedules its own next step (`player._homeWalkTimer`) rather than riding the 5s tick,
which is what it used to do: walking yourself home crawled at a fifth of the speed of
walking the same rooms by hand. Because the cadence is re-read every step, toggling
`run` mid-journey speeds the walk up, and so does hitting a road — with nothing in this
plugin knowing either rule.

Steps stay `bypassEncumbrance` (a system-driven relocation, as before). That matters
now for a second reason: we are already the thing pacing them, so they must not *also*
be queued by the pacing gate. The walk ends on a cancel (`home` again), on a wall, on
death, on logout, and on falling asleep — each of which disarms the pending step, or
the timer walks a body whose owner called it off.
