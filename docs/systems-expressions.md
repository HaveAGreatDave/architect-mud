# NPC moods and facial expressions

**Status: built (2026-11-08).** Faces move on the close-up sculpted figure only; the lite figure, the crowd body and the map sprites don't show a mood yet.

An NPC can be in a mood: happy, sad, angry and so on. The server decides which, and the face and the text both show it, so a player on the Room Stage and a player reading the log see the same thing.

## Moods

The list is fixed, in [client/shared/expressions.js](../client/shared/expressions.js) (`EXPRESSIONS`): `neutral`, `happy`, `amused`, `sad`, `angry`, `afraid`, `disgusted`, `surprised`, `tired`, `drunk`, `confused`, `annoyed`, and fourteen a show asks for by name that nothing in the world resolves to yet: `skeptical`, `smug`, `flirty`, `stern`, `laughing`, `crying`, `shocked`, `thinking`, `determined`, `bored`, `pouting`, `grimacing`, `kissing`, `smirking`. It's engine vocabulary, like posture. Adding one means a row in `EXPRESSIONS` and two lines in `MOOD_TELL`.

Each mood is a few of twenty-eight channels, scaled by an intensity from 0 to 1:

| channel | what it does |
|---|---|
| `browIn` | knits the inner brows down and in, and inks the lines between them |
| `browUp` | lifts the inner brows, and inks short lines across the middle of the forehead |
| `lid` | the upper lid: below 0 narrows the eye (by the blink), above 0 shows more of it |
| `smile` | the mouth's corners up: the grin `uSmile` already painted |
| `frown` | the mouth's corners down, with a short line off each |
| `jaw` | the jaw dropped, added to whatever speech is doing |
| `sneer` | lifts the upper lip by the eye-tooth, wrinkles the bridge of the nose and deepens nose to mouth |
| `browL`, `browR` | raises the whole of one brow (below 0, lowers it), with two short creases over a raised one |
| `squint` | raises the cheeks: the lower lids come up, with a crease under each eye |
| `smirk` | one corner of the mouth up: above 0 their left, below 0 their right |
| `cheek` | raises the cheeks under the eyes, on top of what a smile or a squint raises |
| `puff` | puffs the cheeks out |
| `pout` | pushes the lips out |
| `flare` | flares the nostrils |
| `jawSide`, `jawOut` | slides the jaw to their left (below 0, their right), pushes it forward |
| `teeth`, `press`, `round`, `wide` | mouth shapes a mood holds when nobody is talking: bared teeth, pressed lips, a pucker, a stretch. Speech wins while there is any |
| `headP`, `headY`, `headR` | how the head is carried: chin down (below 0, up), turned to their left, tipped to their left shoulder. 1 is about 17 degrees. Halved while they're looking at somebody |
| `gazeX`, `gazeY` | where the eyes go: to their left, and up. The upper lids come down with eyes that look down |

The close-up figure's face moves its surface as well as its paint (`faceRig` in gl/figure-hd.js, fed by `faceRigOf` in gl/room-people.js as `uRigA` to `uRigC`): each brow, the knit, the cheeks, each corner of the mouth, the pout, the nostrils, the upper lip and the jaw. The paint rides on top, so a brow's ridge, a cheek's shadow and the outline go with the expression. The pupil opens with wide eyes and closes with narrowed ones.

A face at rest isn't still: every few seconds, on the person's own clock, something small crosses it (`faceLife`): both brows, one brow, the lips pressed, the nostrils, half a smirk, the eyes narrowing. Not asleep or out cold.
| `winkL`, `winkR` | shuts one eye on its own |

Left and right are the figure's own, so their left is on the viewer's right when they face you.

`blink` scales how often they blink: afraid blinks nearly twice as often, angry and surprised hardly at all.

## Where a mood comes from

[server/engine/npc-mood.js](../server/engine/npc-mood.js) resolves it, in this order; the first that holds wins:

1. **Transient**, from `setNpcMood(npc, mood, { i, secs, force })`. Held in RAM on the NPC (`npc._mood`) with an expiry, and never written to the database. A weaker mood doesn't cut a stronger one short unless `force`.
2. **State.** Asleep (`_ai.homeSleeping`) or out cold (`_ai.dosedOut`) shows nothing.
3. **Base**, from content: `flags.mood` on the NPC, a mood name or `{ mood, i }`. For somebody who is always that way, the widow at the bar.

`npcMoodOf(npc)` returns `{ m, i, s }` or `null`. It's sync and query-free, so it's safe in a room payload and in `look`. `s` is the seconds a transient mood has left.

What sets a transient mood now:

| source | mood |
|---|---|
| being hit (`npc.attacked`) | `angry` for a guard, police, mercenary, thug, bouncer or enforcer (`flags.personality`), otherwise `afraid`; 90 s |
| being woken (`wakeNpc`) | the wake's own mood, `annoyed` or `confused`, for as long as they're held awake |
| `smile at <npc>` | `happy`, mild, 30 s |
| `frown at` / `laugh at <npc>` | `annoyed`, 30 s |
| the `SET_MOOD` action | whatever it says |

### SET_MOOD

For dialogue nodes and scripts. Flat params, as the dialogue editor writes them:

```json
{ "action": "SET_MOOD", "mood": "sad", "i": 0.8, "secs": 120 }
```

With no `npc` it sets the NPC being spoken to (dialogue passes `context.npc`); `npc` names another one in the actor's room by id or name. `mood: "neutral"` clears it. It always forces.

This is a different thing from the dialogue frame's `mood` (`speakerMood` in `dialogue.js`), which is how an NPC regards *you* from your standing with their order, and tints the name plate. That one isn't a face.

## The face

[plugins/roomstage](../plugins/roomstage/index.js) sends `mood` with each NPC in `room_view` and `room_people`, and sends the room again when a mood changes (`onNpcMoodChange`). [room-stage.js](../client/game/js/panels/room-stage.js) passes it to the body.

[gl/room-people.js](../client/game/js/panels/gl/room-people.js) `moodFace` eases each person's channels toward their mood (about 200 ms) and lets a transient one go when its `s` runs out, without waiting to be told. It hands [gl/figure-hd.js](../client/game/js/panels/gl/figure-hd.js):

- `uExpr` = (browIn, browUp, lid, frown), `uSneer` and `uExpr2` = (browL, browR, squint, smirk), painted in the face's own ink;
- `uWink` = (winkL, winkR), which shuts one eye's opening in the paint and brings its lid down in the mesh;
- `smile` as the larger of the settled look's and the mood's;
- `jaw` added to the mouth's opening, so speech still works on top of it;
- a narrowed lid as a partial blink, so the real eye's lid geometry follows it.

Asleep or out cold, the face lets go whatever the mood. Only a sculpted figure moves its face.

## The text

`look <npc>` adds a line from `MOOD_TELL`, the mild one below 0.6 intensity and the strong one above: "Marta looks down." / "Marta looks like they have been crying." A neutral NPC gets no line.

## Not built

- Moods on the lite figure, the crowd body and the map sprites.
- Moods from drugs and drink in an NPC (`drunk`, `tired` are in the table for it).
- A dev panel or Modelshop bench with a slider per channel. Until then, `SET_MOOD` from a script or `smile at` in game.
