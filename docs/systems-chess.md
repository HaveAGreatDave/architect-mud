# Chess — as built

**STATUS: BUILT.** Full legal chess on a two-seat table, an isometric neon board in the
area pane, an ASCII board in the log, and an alpha-beta opponent. Lives in
`plugins/gametable/` alongside poker, sharing one seat/persistence layer.

The only piece not yet placed in the world is a chess-playing NPC — the bot is written and
regress-tested, but nothing carries `flags.chess_player` and no verb summons one yet.

---

## 1. Why it lives in the poker plugin

Everything expensive about a board game in a MUD was already built for the felt: seats and
buy-ins, spectators, disconnect retention, a host NPC who walks to the table, the pane
push, and the dirty-checked persistence that keeps an idle table from waking Neon's
compute every ten seconds.

`GameTable`'s header claimed it "contains no game rules", and half of that was true. The
seat/spectator/dealer/persistence half genuinely was game-agnostic; the lifecycle half —
`startHand()` posting blinds, `_onPhaseResult()` branching on flop/turn/river, chips,
auto-fold, bot tilt — was hard poker. So the split was made real:

| File | Holds |
|---|---|
| `table-base.js` | `TableBase` — seats, buy-in, spectators, host NPC + pathfinding, bubbles, `pushPaneAll`, sfx, `_persist`. **No rules.** |
| `game-table.js` | `GameTable extends TableBase` — every line of Hold'em lifecycle, unchanged |
| `chess-table.js` | `ChessTable extends TableBase` — turns, selection, draw offers, the wager, forfeits |
| `tables.js` | The registry. `game_tables.game_type` finally decides something |

**`game_type` was stored and never read** before this — every row became a felt regardless
of what it said. `tableClassFor()` is now the one place that decides, and an unknown type
falls back to poker rather than throwing: a typo in a content file should cost you the
right game, not the plugin's boot.

A subclass must provide `paneType`, `renderPaneFor(pid)`, `_checkAutoStart()` and
`_checkGameViable()`; it may override `inTextMode(pid)`, `sfxType`, `buyInFor(player)` and
`static MAX_SEATS`. Chess sets `MAX_SEATS = 2`.

### Two deliberate differences from the felt

- **No dealer is required.** Poker refuses to deal without one. Two people can play chess
  on a bench, so the host NPC is decoration here — `_dealerSay` already no-ops when
  nobody is present, and `_checkAutoStart` never gates on it.
- **The stake is optional.** `config.stake: 0` is a free board and `buyInFor()` returns 0,
  which skips TableBase's credits path entirely — no escrow, no payout, no refund branch.

---

## 2. The rules (`games/chess.js`)

Full legal chess: castling including the through-check rule, en passant with its one-move
window, promotion (four ways), check/checkmate/stalemate, threefold repetition, the
fifty-move rule and insufficient material.

Board representation is **0x88** — a 128-entry array where a square is off-board iff
`(i & 0x88)`. That one test replaces every rank/file bounds check, which is why the sliding
pieces are eight lines instead of forty. **Index 0 is a8 and 119 is h1, so White advances
toward LOWER indices** — the single most common source of confusion when editing this file.

Positions are plain objects and `applyMove` returns a NEW one rather than mutating. Nothing
unmakes a move, which costs some allocation and buys the guarantee that no search bug can
corrupt the live game.

**Correctness is proved by perft**, not by inspection: node counts match the published
values for the start position (to depth 4), Kiwipete (to depth 3) and the en-passant-heavy
position 3 (to depth 4). Any change to move generation must still match those, and a perft
that drifts by even one node is a real bug.

`toJSON()` is FEN + the SAN log, so a stuck `game_tables.state` row is readable by eye.

### Two traps already sprung

- **`startFen` is stored separately** because the repetition count runs over the starting
  position followed by every position after a move, and the opening position lives nowhere
  in `history`. Counting the live board separately instead double-counts the last move —
  a "threefold" that fires on the *second* occurrence. It took a regress case shaped like
  `Nf3 Nf6 Ng1 Ng8` twice to see it.
- **Castling rights are lost by CAPTURING a rook on its home square**, not just by moving
  one. Miss that half and an illegal castle happens several moves later with nothing on the
  board to explain it.

---

## 3. Input — and why the verb is `move`

`move` is an engine verb (`server/engine/commands/movement.js`) with `go`/`enter` as
aliases, and plugins beat engine builtins. So `gametable` claims it and **falls through**
— exactly the pattern `raise` (vs. the stat command) and `evict` (vs. admin housing)
already use in this file.

The guard is deliberately narrow. `cmdMoveRouter` returns `undefined` — handing the verb
back to the engine — unless *all* of: you're at a chess table, a game is live, it's your
turn, and the input parses as a legal move. **`move north` must never be eaten**, and a
direction never parses as a chess move.

`parseMove` accepts SAN (`Nf3`, `exd6`, `O-O`, `e8=Q`, with or without `+`/`#`), the
coordinate form (`e2e4`, `e7e8q`), and the spellings people actually type for castling
(`0-0`, `o-o`, `OO`). An unqualified promotion means a queen. A genuinely ambiguous SAN is
**refused rather than guessed** — picking one of two knights for the player is worse than
asking.

`chessmove` is the unambiguous long form; `chesspick` is the first half of a board click.

---

## 4. The board (`render-chess.js`)

Server-rendered HTML, like the felt. The client holds no board model and decides nothing —
`table_update` in `dispatch.js` hangs the HTML in the area pane, and squares carry
`.poker-cmd` with a literal verb string, so the existing delegated listener in `main.js`
drives the whole thing with no client code of its own.

**The 3/4 view is CSS, not sprites.** `.chess-board` is tipped with `rotateX/rotateZ`, and
every `.chess-piece` inside counter-rotates by the same angles so the glyph stands *up* off
the surface. Take the counter-rotation away and you have a photograph of a board lying
flat; put it back and you're sitting across from someone. The contact shadow deliberately
does **not** counter-rotate — the contrast between the flat shadow and the upright piece is
what sells the height, and without it the pieces hover.

Pieces are Unicode glyphs, so the set is crisp at any size and costs nothing to ship.
**White reads cyan and Black reads magenta** — the two ends of the room's own palette,
because literal white-on-black loses the black army entirely at this brightness. Solid
glyphs for both sides; the outline set vanishes at this tilt.

Selection is **server-side and two-step**: `chesspick e2` marks a piece and re-renders with
its legal destinations lit, then a destination click sends the whole move. The extra round
trip buys the legal-move glow for free and keeps the rule that the client never computes
legality. An empty destination gets a floating dot and an occupied one gets a capture ring —
two marks, because "go here" and "take that" are different decisions.

The board flips for Black, so you always look across it from your own side.

---

## 5. The written board (`text-chess.js`)

Chess is on the **minigame axis** (`prefersTextMinigames`) by the classification rule: delete
the surface and the player is stuck. The preference is the **same one the felt uses** — a
player who reads poker in the log reads chess in the log, and there is no second switch to
find. It is latched at sit, never read from a tick.

The log gets the whole game, not a summary: an ASCII board at the start, the board again
after every move, and the result. If the record in the log isn't enough to keep playing
from, the rung isn't done. `board` prints the position **in both views** — "let me look at
it again" is exactly as reasonable a request with the pane up as without it.

Letters, not glyphs, in the text board: a screen reader says "capital R" and "R"
differently, and `♜` is read as nothing useful at all. Two columns per square, because a
single-column board is unreadably narrow.

---

## 6. The opponent (`bot-chess.js`)

Negamax with alpha-beta, material plus piece-square tables, ordered captures-first so the
cutoffs actually fire.

Three rules shape it:

1. **It must never stall the tick.** The search is capped by `NODE_BUDGET` (12,000) checked
   *inside* the recursion, not by depth alone. A bot that thinks for four seconds has frozen
   the server, not just its game. Regress asserts a move comes back inside 2s from an
   opening, a middlegame and a pawn ending.
2. **It must be beatable.** `CHESS_PERSONAS` set depth and a deliberate per-move blunder
   rate (`patzer` 0.35 → `shark` 0.02). An opponent that plays perfectly at 2 ply is duller
   than one that hangs a rook, and a table nobody can beat is a table nobody sits at twice.
   It never blunders a *forced* move, and regress pins that it takes a mate in one.
3. **It holds no world state.** Given a `ChessGame` it returns a move string — the same
   string a player could have typed.

Mate scores include the depth so mate-in-one beats mate-in-three; without that term the bot
sees them as identical and can shuffle forever.

---

## 7. Endings, the clock and the wager

| Ending | What happens |
|---|---|
| Checkmate / stalemate / 50-move / repetition / insufficient material | Called on the board by `_checkGameEnd` |
| `resign` | Instant, no confirmation |
| `offerdraw` → `acceptdraw` / `declinedraw` | A move implicitly declines an outstanding offer |
| Clock out twice in a row | Forfeit |
| `leave` mid-game, or a disconnect that outlives `SEAT_RETAIN_MS` | **Forfeit, stake included** |

Walking away forfeiting is deliberate: a losing player must not be able to save the wager
by closing the tab.

A win takes both stakes, a draw returns them. Seat chips are zeroed *before* the payout so
`leaveTable` can never pay the same stake twice. Colours alternate every game, and the final
position stays up for `rematchDelaySecs` before the board resets.

---

## 8. Content

| Thing | Where |
|---|---|
| **Material Advantage**, floor 18 of the Solenne | `content/zones/zone_solenne_salon.json` |
| Lift button + both connection files | `zone_solenne_elevator.json`, `content/connections/conn_solenne_*_salon*.json` |
| Table + two club chairs (`flags.game_table_id`, `flags.seat_idx`) | `content/furniture/furn_solenne_chess_*.json` |
| Lamps + power | `furn_light_zone_solenne_salon.json`, `content/power_zones/zone_solenne_salon.json` |
| The `game_tables` row | `scripts/seed-solenne-chess.mjs` — **runtime-classed, so NOT carried by `content:import`** |

The room is a residents' games salon off the Solenne's elevator, panelled in walnut and lit
like held whisky. Named in the same wry-financial register as the building's other
amenities (`Sweat Equity`, the gym): **Material Advantage** is a chess term and a wealth
joke at once.

A staked table is the same row with a number in `config.stake`. This one is free on
purpose — the room is the flex, not the wager.

---

## 9. Regress

`plugins/gametable/regress.js` covers the rules directly (they're pure and DB-free) rather
than driving a live table. Pinned: the three special moves everyone forgets, both halves of
the castling-rights rule, pins, all five drawn endings, checkmate, turn order and
ownership, every input spelling, SAN disambiguation **in both directions** (a lone piece
must *not* be disambiguated — noise in the log is its own bug), the persistence round trip,
and the bot's legality/latency/mate-finding.

Perft lives outside the suite because depth-4 costs seconds; run it by hand after touching
move generation.

The renderer has no automated coverage beyond "it doesn't throw" — same gap the windshield
had before `shapes:smoke`. It renders from a stub table in about a second if you need it.
