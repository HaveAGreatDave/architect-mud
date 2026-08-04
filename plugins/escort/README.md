# escort

One NPC walks with one player, room to room, until they get where they're going —
or die on the way.

## The rule that shapes it

**The escortee is a real NPC the whole time.** It is not a quest token, it is not
invulnerable, and it does not blink out of the world while it's with you. It stands
in the room, it shows up in the room description, it has HP, and it can be shot out
from under you by anything that could have shot it before. Losing it is the whole
tension of the job, so nothing here protects it.

The second consequence of that rule: **a separated escortee is never teleported to
the player.** If it gets shut behind a locked door, or is left standing while you
ride an elevator, it stays where it is and you walk back for it. Teleporting would
make every door and every gap in the map meaningless.

## How it works

Almost nothing new walks. `moveEntity` (`server/engine/ai-behaviour.js`) is already
the single writer for every NPC tile change and already handles doors, facades and
broadcasts, so an escort step is just `moveEntity(npc, wherePlayerWent)` fired off
`zone.entered`. This plugin only picks the destination.

The one engine change is a freeze: an escortee with a behaviour graph would happily
wander back to its shift between the player's steps, so `npc._escorting` suppresses
its AI tick — the same freeze `npc._aboard` already gives a charter pilot riding in
a cockpit (`server/engine/gameLoop.js`). It's cleared on every teardown path, which
the regress suite asserts, because a leaked freeze is an NPC that never moves again.

State is RAM-only and dissolves on restart, like `follow` and parties. An escort is
something you are doing right now, not something you have.

## Quests know nothing about this

Per ADR-0002, objectives advance by subscribing to Events. This plugin emits
`escort.arrived` and the quests plugin's `escort` objective type subscribes to it,
exactly like `kill` / `visit` / `retrieve`. Neither plugin imports the other.

## Authoring

**The intended route is dialogue.** An NPC's own tree fires `ESCORT_START` with no
params at all — `context.npc` is the speaker, so a "get me out of here" option is
the entire wiring. `ESCORT_END` stops it.

`flags.escortable` on the NPC is the *verb's* consent gate only: it's what lets a
player type `escort <name>` to re-collect someone they were already walking, or to
pick up an NPC the world has marked as willing. Dialogue-driven `ESCORT_START` does
not check it — the conversation is the consent.

Quest side (VINE quest editor → Kind: *Escort NPC to a zone*):

```
{ type: 'escort', target: 'npc_vale', zone: 'zone_clinic', desc: 'Walk Vale to the clinic' }
```

`target` matches an exact npc id first, then falls back to a name substring.

## Verbs

| | |
|---|---|
| `escort` | who you're walking, and whether they're still behind you |
| `escort <name>` | start (needs `flags.escortable`) |
| `escort stop` | dismiss them |

## Events

Emits `escort.started`, `escort.arrived`, `escort.blocked`, `escort.ended`.
Consumes `zone.entered`, `npc.killed`, `player.death`, `player.logout`.

## Losing them

Ending an escort by **death or separation-with-no-way-back** emits `escort.lost`
(carrying the live player, not just an id) on top of the ordinary `escort.ended`.
Dismissing someone is not losing them, and neither is logging out.

That's the event a quest hangs its failure on. A quest authored with
`fail_on: [{ type:'escort_lost', target:'npc_vale' }]` blows the moment the body
hits the floor — see [Failure](../quests/README.md#failure). Without that condition
authored, nothing happens and the objective simply stays unmet, which is the right
default for an escort that was only ever flavour.
