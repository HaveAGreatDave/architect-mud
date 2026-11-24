# parley

Talk to people in your own words. A typed line is read as an act and an NPC with `flags.parley` answers from their own lines, Façade-style.

Status: phase 1 built.

## Commands

- `parley <npcId> <text>`: what the dialogue panel's box sends. Players normally just use `say`.

## Files

- `parse.js`: text to `{ act, topic, confidence, question }`. Pure.
- `react.js`: picks the answer and applies warmth and mood. RAM-only conversation state.
- `index.js`: the `player.say` and `npc.talk` hooks and the command.

The whole system is described in [docs/systems-parley.md](../../docs/systems-parley.md).
