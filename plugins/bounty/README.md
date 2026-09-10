# bounty — money on a head

Players fund contracts on other players out of their own pocket. The full design
record is [docs/systems-bounties.md](../../docs/systems-bounties.md); this is the
file-level map.

| File | Holds |
| --- | --- |
| `index.js` | escrow, the in-memory mirror, the verbs, the death hook that mints the head |
| `poster.js` | **the one builder.** Every surface renders these lines |
| `receptacle.js` | the head-shaped hole: authored per-board prose + a complete generic fallback |
| `tablet-app.js` | THE BOARD app — read-only, registers into `plugins/tablet/registry.js` |
| `regress.js` | frame geometry, anonymity, escrow arithmetic |

The client skin is [`client/game/js/panels/wantedposter.js`](../../client/game/js/panels/wantedposter.js),
routed from `dispatch.js` on `wanted_poster`.

## The five things not to change without reading why

1. **The head is an item, in the corpse.** Not a flag, not an auto-payout. Every
   interesting thing that can happen to a bounty — the theft, the ambush at the
   board, the third party who was watching the fight — is the inventory system
   doing it for free. `mintHead()` in `index.js`.
2. **The sheet is text; the panel is a skin.** `posterLines()` is the record and
   reaches the log at every rung. If you add a field to the panel that isn't in
   the lines, a `log`-rung player has stopped being told something.
3. **The mirror is write-through, and this plugin is the table's only runtime
   writer.** That is the whole safety argument for caching it (CLAUDE.md's write-
   funnel rule). If anything else starts writing `bounties`, the mirror has to go
   or grow an invalidation.
4. **Escrow is closed with a guarded `UPDATE ... WHERE status='open'` before a
   single credit moves.** Two heads arriving at two boards in the same tick is
   the case that pays twice if you reverse those two statements.

5. **The receptacle is content, and the board is a machine.** Every line a player
   reads when handing a head in comes off `flags.receptacle` on the furniture row,
   so a new board is a content file and never an edit to this folder. Posting and
   redeeming check zone power; reading never does, because paper does not need
   electricity.

## Tunables

`MIN_BOUNTY` 250 · `HOUSE_CUT` 10% (at posting, never refunded) ·
`WITHDRAW_PENALTY` 25% (early pull) · `UNMASK_COST` 25% (paid by the target) ·
`DURATION_DAYS` 7.
