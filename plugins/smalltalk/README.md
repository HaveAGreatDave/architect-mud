# smalltalk

Ask anybody what they're up to. They answer from what they're really doing, and tell you as much as they care to.

Status: built.

## Commands

- `whatsup <npc>`: ask somebody in the room. The room hears the question and the answer.

In a conversation the same question is the "What are you up to?" option at the bottom of every dialogue root. `whatsup` is there for people who have no dialogue tree.

## What they're doing

`npcDoingNow(npc)` in [server/engine/npc-doing.js](../../server/engine/npc-doing.js) reads it off the state the behaviour graph already keeps. It's sync and makes no query.

| Kind | When |
|---|---|
| `banking` | carrying the day's takings to the bank |
| `working` | on shift at their workplace (`isNpcAtWork`) |
| `to_work` | on shift and not there yet |
| `at_home` | standing in their `home_zone` |
| `heading_home` | walking to their `home_zone` |
| `out` | walking anywhere else; knows the place, and whether it's a `haunt_zone` |
| `idle` | none of the above |

It also carries `work` (the shop name, or the building their work zone is in) and `nextShift` ("about 3 hours").

## How much they tell you

Three levels: they won't say, the short answer ("Going to work."), or the whole of it ("Off to work. I'm at Two-Cell Supply.").

The level is a sum, with no dice in it, so the same person gives you the same level until something between you changes:

- Their `flags.personality`: chatty +2; vendors, bartenders, clerks, preachers, charity workers, politicians, hosts and pilots +1; quiet, gruff, stoic, guards, police, mercenaries, officials and corporate −1; dealers, thugs, lowlifes and cult members −2; everybody else 0.
- How well they know you (`relationTier`): wary −2, stranger 0, known +1, familiar +2, close +3. Hostile always refuses.
- A sour mood (angry, annoyed, afraid, disgusted): −1.

Below 0 they refuse, 0 is the short answer, 1 or more is the whole of it. So an ordinary stranger gets the short answer, a guard tells you nothing until you're known to them, and a dealer needs to be close to you.

Somebody carrying the takings says only that they've an errand to run, unless you're close.

## Authoring

Nothing is needed: every NPC answers from its archetype. Two `npcs.flags` keys override it.

- `smalltalk`: `'open'`, `'normal'`, `'guarded'` or `'closed'` replaces the archetype's number. `'never'` refuses everybody. `false` removes the question from this NPC.
- `up_to`: their own answer. A line, a list of lines, or an object keyed by kind (plus `any`, and `refuse` for the refusal). `{work}`, `{place}` and `{when}` fill in, and a line whose token has no value isn't picked. Use it for an NPC whose custom behaviour graph does something the stock lines can't describe.

To word the question yourself, or put it somewhere other than root, give any option `next: "__topic:whatsup"`. The stock option then stays out of that tree.

The stock lines are in [lines.js](lines.js).

## The seam

`registerDialogueTopic({ id, label, when, render })` in [server/engine/dialogue.js](../../server/engine/dialogue.js) adds a question to every dialogue root. The answer is a node outside the tree, `__topic:<id>`, with one option back to root. This plugin registers one topic; another plugin can register more.
