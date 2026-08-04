# Chess — as built

**STATUS: BUILT.** Full legal chess on a two-seat table, a canvas-rendered 3D neon board in
the area pane that you can orbit around, an ASCII board in the log, and an alpha-beta
opponent. Lives in
`plugins/gametable/` alongside poker, sharing one seat/persistence layer.

You can sit down alone: `summon` calls a `flags.chess_player` NPC over to take the chair
opposite, walking them across the city if they aren't already in the room.

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
`board` re-reads the position and `threats` reads the danger in it — both are pulls, and
§5 is why.

---

## 4. The board (`render-chess.js`)

Server-rendered HTML, like the felt. The client holds no board model and decides nothing —
`table_update` in `dispatch.js` hangs the HTML in the area pane, and squares carry
`.poker-cmd` with a literal verb string, so the existing delegated listener in `main.js`
drives the whole thing with no client code of its own.

**The board you actually see is drawn in 3D** by `client/game/js/panels/chess3d.js`, not by
the CSS. `table_update` hangs the server's HTML as before, then `mountChess3D()` reads the
board back out of that markup — `.chess-sq[data-sq]` for the squares, the `.chess-piece`
classes inside them for the men — and replaces the stage with a canvas. **The server's flat
board is still the source of truth and still the fallback**: if the renderer can't run, what
stays on screen is a working board, which is why the mount runs *after* `setAreaPane` and
never instead of it.

The 3D is done **the way the flight sim does it** (`panels/windshield.js`): no WebGL, no
library, no build step. A camera that projects a world point to the screen, depth-sorted
face sinks painted back→front (a 2D context has no z-buffer), and per-face lighting off the
face normal. The one divergence is that windshield queues *closures* — a building face can
paint itself a dozen ways — while every face here is a filled polygon, so the sink holds
plain geometry and skips ~4000 closure allocations a frame.

**There are THREE sinks — slab, board and pieces — and every split is a bug fix, not
tidiness.**
Faces sort by their *average* depth, and a board square is a metre wide: the near half of a
square can sit in front of a piece standing on the square behind it while its average says
otherwise, so the square paints over the piece and **the piece vanishes**. Average-depth
sorting cannot fix that; the two objects genuinely interleave. What resolves it is that no
piece is ever *behind* the board — pieces stand ON the plane. So the board is painted first
and whole, then the pieces on top, ordered **per piece** by the depth of its base (exact for
anything standing on a plane) and only then per face within a piece. A piece's contact
shadow and emitter pad are emitted into the *board* sink, because they lie on the plane too.

The **slab** is the same argument run the other way, and it had its own symptom: the
underside is one quad spanning the whole board, so its average depth equals the average of
the 64 square tops *exactly*. Sorted together that's a coin flip, and when it lost, the
near-black underside painted over the entire checkerboard — **the board losing its squares
at certain angles**. The camera is always above the plane (pitch clamps well clear of 0), so
the slab is always behind the top; saying that outright is both correct and cheaper than
sorting. Each boundary between the three passes is an ordering **fact**, never a comparison.

**Pieces are surfaces of revolution.** A silhouette of `[radius, height]` pairs, spun around
its axis — which is how real chess pieces are made, and why a dozen numbers is enough to get
a shape that reads instantly. Only the two things that *aren't* lathes are special-cased: the
knight's head and the king's cross are extruded polygons on a lathed base, plus the rook's
battlements and the queen's coronet as rings of small blocks. **The knight is the one piece
whose orientation matters**, so it's the one piece turned to face down the board.

**Rendering is on demand.** The scene is static between moves, so it redraws on a camera
change or a pane update and otherwise costs nothing — that is what makes 4000 faces in a 2D
context affordable. There are exactly **two** exceptions, both of them things that must keep
moving after the input that started them: a piece dangling from the cursor, and a king in
check. Each runs its own rAF loop and **each stops itself** the moment it settles.

**Playing and looking are separate gestures**, and conflating them is a bug, not a
simplification: when one press both picked a piece up and swung the camera, the few pixels
of drift between pressing and releasing on a piece read as an orbit and **the move never
fired**. So on a mouse, **left is the game and middle/right are the camera** — left-dragging
over empty board still orbits, because it's the discoverable gesture and costs nothing once
a press that starts on a playable square is claimed by the game before the camera sees it.
Touch has no buttons to split on, so it splits on **finger count**: one finger taps to play
and drags to orbit, two fingers pinch to zoom. A tap is judged by distance travelled, not by
what it landed on — there is only one element and it's a canvas. Wheel zooms; the view bar
is the keyboard-free route to the same camera and the way back from a wild orbit.

The camera lives in `localStorage` and **survives the remount that happens on every single
move**, which is the thing that would be maddening to lose.

### Picking a piece up

Because the camera is on middle and right, **left is free for the whole duration of a press**
— so a piece comes off the board and **dangles from the cursor**, trailing the hand and
swinging when it stops. It also *removed* a rule: a left-press that wandered more than a few
pixels used to be discarded, which is exactly the gesture a player makes when they try to
drag.

The drag **decides nothing**. Mousedown fires the same `chesspick` a click sends, and the
squares the server marks `chessmove` in reply are the only ones the drop can land on. Drop
anywhere else and the piece goes back down via the selected square's *own* `chesspick none`
— a verb the server wrote, not one this file invents. Drop where it started and nothing is
sent at all: that's a click, and a click leaves the piece picked up with its targets showing.

Three things are load-bearing:

- **The drag is module state, not input state.** The server's reply to your own pickup
  remounts the entire pane, rebuilding the canvas and every listener. Anything living in the
  input closure would drop the piece out of your hand at the exact moment the board lit up
  its targets — so the drag survives the remount and re-adopts the fresh listeners, and the
  mount cancels it only if the piece is genuinely gone.
- **A drop can beat the round trip.** A fast drag releases before the server has said where
  the piece may go, and resolving that against a board with no targets on it would silently
  eat a move the player made correctly. So a drop that lands before the update is **held**
  and cashed against the board that arrives.
- **The swing is a pendulum, not an animation curve.** The target tilt is proportional to
  hand *speed* and a spring chases it, so the overshoot when the hand stops is what reads as
  weight. It rotates about a hang point above the piece's crown — rotating about the base
  would be a piece leaning, not a piece swinging. A dashed tether to the plane is the only
  depth cue something not touching anything has.

The inverse projection this needs is **closed-form for a point of known height**, which is
all a drag requires: the hand carries the piece on a fixed horizontal plane, so the cursor
ray meets it exactly once and the answer falls out of `project()`'s own algebra.

### Check and checkmate

The two moments in a chess game that are **events rather than positions**, and the flat board
could only ever colour a square for them.

**Check** throws a red shockwave off the king's square and puts a hard shudder through the
king itself, rocking on its own foot. It's a warning, so it's over in about a second and the
standing position is untouched. It fires **once per new check** — re-rendering the same
position (a chat line, a resize, the opponent's clock) must not re-bang the drum.

**Checkmate topples the king.** It is the oldest gesture in the game and the one thing a 3D
piece can do that a 2D one cannot: it pivots on the contact edge of its own base and falls
toward the near edge of the board — toward its own player, the way a resigning hand tips a
king — accelerating rather than eased, with one small bounce when it lands. Unlike the check
shudder it is **permanent**: the loop stops with the king down, because the position it fell
out of is the record and a king that stood back up would be erasing it. A red wash comes up
over the board with it, painted as a screen-space quad rather than emitted into the board
sink — one quad spanning all 64 squares has an average depth *identical* to the average of
the squares, which is the same coin-flip sort that once cost the board its checkerboard.

**How it ended is a class, not a sentence.** `statusHTML` marks a checkmate with
`chess-status-mate`, because a king can be standing in check when its player *resigns* —
"the king is attacked and the game is over" is not the same fact as "checkmate", and the
board must not topple for the first one.

The swing, the shudder and the topple are the same operation — a rotation about a pivot —
about three different points, which is the whole reason the second and third were cheap.

**The set is lit metal, not painted plastic**, and three things do that work. The **ambient
floor is low** (0.10), so faces turned away from the key light fall into the dark instead of
sitting at a flat pastel — a high ambient is what made the first pass look like a toy. A
narrow **specular** and a **rim** term give the polish, with the rim cool-shifted toward the
team colour rather than white, because an edge turning away from the key should catch the
room and the room is a neon one. Each piece then carries a **lit core band** let into its
waist — its own emitter, and the only light on a piece that doesn't come from outside it —
plus **contour rings** up the body, the tool marks of the lathe that turned it. Every piece
stands on a hex **emitter pad**, so it reads as docked into the board rather than resting on
it. Contour rings are stroked **once per ring, not per quad**: the per-quad version drew each
line twelve times over and cost 3000 stroke calls a frame against 384 now.

**White reads cyan and Black reads magenta** — the two ends of the room's own palette, read
from the pane's own CSS variables rather than hardcoded, because literal white-on-black loses
the black army entirely at this brightness.

**Coverage: `npm run chess3d:smoke`** (in `pretest:regress`). Same bar and same reason as
`shapes:smoke` — a canvas renderer whose only execution path is "a player happens to be
looking at it" has no coverage at all. It draws a full board with every piece type, both
colours and every square state across six camera angles including both pitch clamps, and
checks that picking returns a square. It proves the board *draws*, not that it looks right.

It also drives the two moving parts, because neither is reachable from the DOM. The **drag**
is round-tripped against the forward projection — unproject a screen point at board height
and it must land inside the square picking says is under it — then a hand is dragged across
the board and the pendulum swung to rest, asserting it stays finite, stays inside its clamp,
and that the piece is drawn *once* (in hand, not also standing). The **effects** are scrubbed
across their whole timeline a frame at a time, since the topple is the one transform here
that moves through a full right angle and can invert geometry; the assertions are that the
shockwave is really in the face sink and that the mated king actually moved.

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

The log gets the whole game, not a summary: an ASCII board at the start, every move as it
lands, the result. If the record in the log isn't enough to keep playing from, the rung
isn't done. `board` prints the position **in both views** — "let me look at it again" is
exactly as reasonable a request with the pane up as without it.

Letters, not glyphs, in the text board: a screen reader says "capital R" and "R"
differently, and `♜` is read as nothing useful at all. Two columns per square, because a
single-column board is unreadably narrow.

### Push a move, pull a position

The board used to be re-sent under **every half-move**, and that was the one thing wrong
with this rung. `#output` is the ONE live region ([systems-display-mode.md](systems-display-mode.md)),
so a re-sent grid is twelve lines spoken again for a position the reader already has, with
the single new fact — what the opponent played — buried at the top of it. Twice a move pair.

So `narrateMove` pushes the **move and its consequence** (`Karla plays Nf3.` · `— check.`
· `▶ Your move.`) and nothing else, and the position is **pulled** with `board`. The rung
contract is untouched: the move stream is a game record you can play from, and `board`
reconstructs the position at any point. Captures are deliberately *not* repeated in the
push — `handleMove` already says "X takes the knight" to the room, and the room log is the
same log.

Two reads close the gap that leaves:

- **`piecesLine`** — every occupied square by side, grouped (`White: king e1, queen d1,
  rooks a1 h1, pawns a2 b2 …`), appended to the pulled board. This is how a player who
  can't see a grid actually holds a position: thirty named facts, not sixty-four cells to
  scan for dots.
- **`threats`** — what of yours is attacked (and whether it's undefended), what of theirs is
  free, and whether you're in check. The pane gives danger away for nothing — a ring round
  a piece reads as threatened at a glance — so the written board owes the same answer or
  the text player is the only one at the table playing blind. It reports the **position,
  never advice**; an opponent-side piece that's attacked *and* defended is a trade, not a
  threat, and listing every one of those is the noise this whole section is about.

The destination list from `chesspick` marks captures the same way the pane does with its two
marks (`From d4: d5 · e5 (takes pawn)`).

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

### Getting it into a chair

The search above was written long before anything could seat it. What seats it now is
`summon` (also `deal`/`call <name>`), the same verb poker uses — because **calling somebody
over is the same act in both games**, so the walk-over lives in `TableBase.summonBot` /
`stepIncomingBots` rather than being written twice. It was lifted out of `GameTable` for
this; poker kept only what actually differs, which is money.

The subclass seams are `botIdFor(npc)`, `seatBot(npc)` (each game owns its seat row) and
`_botPreflight(npc)` — everything that must be settled *before* an opponent sets off, so
nobody crosses the map only to be turned away at the seat. A table that overrides nothing
has no AI opponents at all.

| | Poker | Chess |
|---|---|---|
| Pool flag | `flags.poker_player` | `flags.chess_player` |
| Strength/style | `flags.poker_persona` | `flags.chess_strength` (a `CHESS_PERSONAS` key), or `flags.chess_persona` to override fields |
| Preflight | bankroll, buy-in, bust cooldown, a backer's restake | **stake must be 0** |

That last row is the one rule worth knowing: **nothing escrows a stake on an NPC's behalf**,
so a bot seat at a staked board would pay a winner out of thin air. Chess refuses the summon
rather than minting the pot ("*will play you, but not for money*"). The Inlaid Board is free,
so this never bites in practice — but a staked board is one config key away, and this is what
stops that key becoming a credit printer. Regress pins the refusal.

Two smaller rules: an NPC's AI is frozen while it sits (and **thawed on leave**, or a
summoned opponent is stuck in the chair for an hour), and when the last human stands up any
bot still seated stands up too — an AI waiting alone at a two-seat board is a seat nobody
else can take.

The opponents themselves are ordinary content: `npc_iolanthe_krebs` (`shark`) and
`npc_aldo_ferro` (`patzer`), both resident in the Solenne, giving the room a game you can
lose and a game you can win.

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
