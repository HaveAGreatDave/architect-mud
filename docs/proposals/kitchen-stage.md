# The Kitchen Stage: a cel-shaded 3D rung for cooking

> **Status: phases 0-4 built; the Kitchen Battle is design.** Where this
> doc disagrees with [plugins/cooking/README.md](../../plugins/cooking/README.md),
> the README wins.

## Why

Cooking is a deep simulation with no picture. Each verb (`chop`, `boil`,
`stove 7`, `flip`, `plate`) stamps times on the food's `custom_data`, and
`evaluate()` in `plugins/cooking/quality.js` grades it all at plate time. The
only view of it is the [prep workspace](preparation-workspace.md), a text panel
with a burner dial, cook pips and a stage ribbon.

The Stage is a 3D view of the same kitchen: a counter in front of the stove,
drawn cel-shaded in the style of a Japanese cooking show. You cut on a board,
cook on the hob and dress the plate at the pass. Knife work and plating are
graded; everything else is the existing sim.

## Rules

1. **One payload, two renderers.** The Stage draws the `workspace_view` payload
   the HUD already gets. Every gesture on an existing mechanic sends a command
   from the payload's `actions`, found by `role`, the same string the HUD would
   send. The Stage composes only the two new scored verbs.
2. **Colour moves on a beat.** Food changes colour only when the server's cook
   beat (phase and stage) changes. A smooth browning ramp would be a countdown,
   which the workspace withholds on purpose because plate timing is the biggest
   quality lever. Bubbles and steam may move within a beat.
3. **Typing never loses.** A typed `chop` or `plate` stamps nothing and scores
   exactly as it did before the Stage. On the board a decent hand (`KNIFE_PAR`)
   also changes nothing; a clean cut gains a little and a ragged one costs.
4. **Food is data.** A new ingredient is an item row. Its look, cut and cook
   behaviour come from its `food_profile` class, overridden by `tags.matter`
   only when the class default is wrong.
5. **The props come from the room.** `stove_tier` picks the hob, `vessel_kind`
   the pan, dishware the plate. The cel treatment, lighting and camera are the
   same in a flophouse and a restaurant. Nothing about Coldwater is in the
   renderer.

## Rungs

| Rung | Kitchen |
|---|---|
| `visual` | The Stage, if WebGL2 builds; otherwise the HUD |
| `textgames` | The HUD; `chop` and `plate` are the instant verbs |
| `log` | Unchanged |

The workspace HUD still has no `textgames` variant. The board and the pass exist
only inside the Stage. Below `visual`, `chop` and `plate` stamp nothing, and a
missing stamp scores as no change, so nobody loses anything to a game they can't
see. A character knife board is a possible follow-up.

## The look

- **Toon light.** Three hard bands and a hard rim, from `toonBands`/`toonStep`
  in `gl/context.js`. Oily and wet food gets a hard-edged highlight.
- **Ink.** The inverted-hull outline the rink uses, moved into `gl/ink.js` so
  the rink and the kitchen share one copy.
- **Manga accents.** Halftone dots in the shadow band. Speed lines and a
  two-frame flash on a clean cut or a good flip, on a 2-D overlay. Steam as
  outlined cel puffs.
- **Set.** A pale wood counter, a noren behind, warm key light from above left,
  cool fill.
- **Stations.** The tabs carry a kanji each: 切 board, 焼 hob, 盛 pass.
- **Camera.** Three stations along the counter: board, hob, pass. A quick
  eased pan between them, a slight dutch angle on the knife, and a push-in when
  the server says the food is in its window.

## Ingredients: `client/shared/kitchen-matter.js`

Shared by client and server. One entry per `food_profile` class:

| Key | What it holds |
|---|---|
| `form` | Shape kind (`slab log sphere leaf grain liquid cluster`) and size in cm |
| `ramp` | Lit and shadow colour for each beat: `raw cook peak over burnt` |
| `cut` | `firmness` 0-1, `grain` (`none fibre layers`), allowed `styles`, `juice` |
| `cook` | `browning` kind, `shrink`, emitters (`sizzle steam bubble spatter`), `gloss`, `toss` |
| `plate` | `stack` (`flat lean pile pool`) and whether it takes a `sauce` |

`matterFor(item)` merges the class default with `tags.matter`. `content:lint`
fails an unknown key under `tags.matter`.

## The knife game

With the Stage open, `chop <food> [into N]` arms a cut instead of cutting. The
server mints a nonce and replies `knife_game` with the food's look, N and a
difficulty from its firmness and grain (`cutDifficulty`). With no Stage open it's
the instant cut it always was. Space cuts where a sweeping marker is, for the
keyboard; the marker sweeps faster on a harder cut.

Each stroke is a drag down through the food, and the cut falls where you drew
it. Soft food (firmness under 0.4) crushes if the stroke is slow, and each crush
costs evenness. A clean stroke on a guide gets a two-frame impact flash. Pieces
split along the real cut and slide apart.

`chopresolve <row> <nonce> <crush> <p1> ... <pN-1>` sends the cut positions,
0-1 along the food. The server works out evenness from the positions with the
same code the client used (`client/shared/knife.js`), then runs the existing
split and stamps `custom_data.cut = { even }` on each piece. Evenness is one
minus the spread of the piece sizes, less a crush penalty.

**What it does:** the peak window is multiplied by `knifeWindowMult(even)`
(prep.js): 1 at `KNIFE_PAR` 0.85, up to 1.09 for a perfect cut, down to 0.75. Uneven pieces narrow the window because the small ones finish
first. A row with no `cut` stamp gets 1.0, so food cut before this change, or
never cut, cooks as it always did.

## Dressing the plate

Drag the pan to the pass and the Stage sends `dressplate <vessel>` (`dress` is
the wardrobe's). The server sends
`plating_game` with the dish's components and the plate. You place the pieces
and drag a sauce line where the dish takes one. The food keeps cooking while
you do it, so turn the ring off first or be quick.

`dressresolve <vessel> <nonce> <score>` stamps `custom_data.dressed`, and the
Stage then sends the payload's `plate` command. `plateVessel` adds up to half a
band for presentation above `DRESS_PAR`, on a plate or platter only, and clears
the stamp. No stamp, or a layout at par or under, adds nothing.

The scoring (`client/shared/plating.js`) rewards weight on the centre or a
third, some height, a clean rim, and pieces that don't pile on each other.

## Live beats

The HUD re-asks for the view every 5 seconds. That's too slow when a colour
change is the cue to plate. The cook's narration timers already fire at each
stage change; when one fires and the player has the Stage open, the server
pushes `kitchen_beat { row, phase, stage, water }` from the session it already
holds. `kitchenstage on|off` sets a RAM flag that says the Stage is open
(plugins/cooking/stage.js). No query, tick or timer is added. The beat carries
only the row; the Stage answers it by re-asking for the view.

## Kitchen Battle (design only)

The full show is kept for an in-world event, not ordinary cooking:

- the theme ingredient rising on a lit pedestal
- an ORACLE announcer call
- kanji phase cards: 切 cut, 焼 heat, 盛 plate
- a battle clock
- three judges turning over scorecards

Venue, entry and prizes need their own proposal, possibly as a KSAB show
([systems-broadcast.md](../systems-broadcast.md)).

## Build

| Phase | What | State |
|---|---|---|
| 0 | Flip and stir stamped on the session clock | built |
| 1 | Matter table, knife geometry, kitchen mesh, `kitchen-smoke` gate | built |
| 2 | Renderer, Stage panel, gestures, `kitchen_beat`, sounds | built |
| 3 | Knife game and the evenness term | built |
| 4 | Dressing and the presentation term | built |
| 5 | Kitchen Battle | design only |

Phase 0 fixed a real bug: `flip` and `stir` stamped wall-clock time on a
session whose clock runs at the burner's rate, so after a dial change a turn
was graded at the wrong point in the cook.
