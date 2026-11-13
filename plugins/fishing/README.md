# fishing

**Purpose** — a posture-based, perpetual cast-and-wait action for water-adjacent zones. A bite arms the client tension-bar reel overlay; landing it pulls a catch from a loot table.

## Commands
- `fish` — cast and wait.
- `fishcast` / `fishresolve` — token-gated silent callbacks from the client overlay. Never typed.
- `fishtwitch` / `fishstrike`: the boat reel's tap and strike (below). Typed as `fish twitch` and `fish strike`.

## From a boat ([boat.js](boat.js))
`fish` aboard an anchored boat with a rod opens the boat reel instead of the shore loop. It's the same posture and state key (`fishState.mode = 'boat'`), because `registerActivity` takes one registration per posture. The contract is §5b of [boat-fishing.md](../../docs/proposals/boat-fishing.md); the rules are `client/shared/boatfish-rules.js` and the fish are `client/shared/fish.js`, both imported, never restated.

- **Cast** (`fishcast boat <bearing> <metres> <token>`, typed `fish 40 20`): from the anchor point, never the reported position, along the boat's heading plus the bearing (starboard positive). The range is clamped between `CAST_MIN_M` and the rod's `cast_m` tag (25 m when absent). The lure sinks at `SINK_MPS`, or a carried item's `sink_mps` tag, to just above the floor.
- **Twitch** (`fishtwitch <token>`): taps inside `TWITCH_MIN_MS` are one tap. Each draws the lure `TWITCH_M` in and lifts it, and every fish within `noticeM(draw)` gains `interestGain`, which pays for a pause of the species' `tempo` before the twitch. Good twitch-and-pause grows the draw (`drawAfter`), so the notice radius widens to twice `NOTICE_M` and fish gather; interest decays slowly over `INTEREST_DECAY_MS`. A fish that reaches `BITE_AT` bites. At `REEL_IN_M` the line reels in.
- **Strike** (`fishstrike <hitServerMs> <token>`): one, judged against the bite's `takeScript` with `judgeStrike` plus `LATENCY_SLACK_MS`. On a nibble it's early, past the window it's late, and either way the school spooks and the lure stays out. A hit in the window sets the hook, and `set` goes to the fight. A take never struck is spat on the tick.
- **The sounder** (`fish sonar`, typed): the depth under her and the nearest marks, on a hull with a `sonar` field. It reads `fishNear` straight, so it works after dark, and it doesn't name a fish.
- **Resolve** (`fishresolve boat <1|0> <token>`): a win faster than `minFightMs` is refused. A win writes one `boat_hold` row if the box has room by the running total, else it's let go for half the skill award. The take counts against the school for a game day (RAM, sent back as `thinned`). A loss runs `maybeSnapRod`.
- **The text and log rungs** settle the strike and the fight with one fishing check, as `settleLogBite` does.
- **It closes** when the anchor comes up, the throttle opens or you leave the boat (the tick checks, from RAM), and on combat, death or a change of room (the engine).

Nothing on the twitch or the tick awaits a query: rod, bait, skill and the box's weight are read once when the reel opens.

⚠ `maybeSnapRod` damages the rod through `repairItem`, which clamps a negative fraction to 0, so a snap never wears a rod down; only a rod already at Broken snaps.

## Schema reuse
The catch comes from a **reused scavenging loot table** — fishing did not invent a table format, it borrowed one.

## Gates and consequences
- **Rod required**, bait optional.
- The **Fishing** skill gates the landing.
- Rare **monster hooks spawn a live enemy** — the water bites back.
- A botched reel can **snap the rod**.

## Discovery gap (known)
`fish` is **dual-gated**: a zone flag (`fishing_table_id`, ambient and not examinable) *and* a carried item tagged `fishing_rod`. It is deliberately **not** exposed as a rod specialized action, because advertising `fish` on a rod in a dry zone would mislead. Discovery is the rod's item description and help.

## See also
[docs/systems-fishing.md](../../docs/systems-fishing.md)
