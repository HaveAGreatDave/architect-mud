# sports-banter

**The room watches the game.** When the game on the set does something, the people in the
room react to it, by who they back.

## What sets it off

The broadcast tags the sports lines that call a moment. `say` in `assembleSportsGraph`
([plugins/broadcast/index.js](../broadcast/index.js)) takes a `meta.play`, the tick copies it
onto the beat, and `broadcast.message` carries it:

```js
{ sport: 'hockey', kind: 'goal', for: 'Yard Birds', against: 'Westside Warlords',
  player: 'Teddy Grist', away, home, awayScore, homeScore, ...extras }
```

`for` is the club the play was good for and `against` the club it hurt. It never goes to a client.

| Sport | Kinds | Where it's tagged |
| --- | --- | --- |
| Deadball | `run`, `homerun` (`grand` on a grand slam), `walkoff`, `doubleplay`, `tripleplay`, `error`, `final` (`champion` in the final) | the baseball body of `assembleSportsGraph` |
| Cluster Puck | `goal` (`sudden` in overtime), `hattrick`, `fight`, `injury`, `death`, `final` | [hockey-narrator.js](../broadcast/sports/hockey-narrator.js) |

A run is tagged on the line that gives the score, and a run that ends the game is tagged
`walkoff` instead, so a room reacts to the game ending rather than to the run before it. A
double play is good for the side in the field; an error is good for the side at bat.

## Who backs whom

Every NPC has a primary club across both leagues, and it's the club gossip's `favTeam` names:
an authored `flags.fav_team`, or a hash of their id into the sorted roster. For the other
league a second hash decides whether they follow it (60 in 100 do) and which club. Nothing is
stored. The roster and its rival pairs come from `broadcast.getSportsTeams`; until that lands,
clubs are learnt from the plays themselves.

A play is one of five things to a fan ([fans.js](fans.js) `stanceOf`):

| Stance | Means |
| --- | --- |
| `up` | their club did it |
| `down` | it was done to their club |
| `gloat` | it was done to their club's rival |
| `sour` | their club's rival did it |
| `neutral` | nothing to them |

## What the room does

Two fans on opposite sides of a play can have a short exchange ([lines.js](lines.js)
`THREADS`). The pair is chosen best first:

| Pair | Who |
| --- | --- |
| `feud` | A's club did it to B's, and the two clubs are rivals |
| `needle` | it was done to B's club, which is A's rival, whether or not A's club is playing |
| `clash` | A's club did it to B's |
| `brag` | A's club did it in front of a fan of its rival |
| `together_up` / `together_down` | two fans of the same club |

A rivalry is the point, so `feud` and `needle` are the likeliest to start. A thread lists the
kinds or groups it fits in `on`, because a line written for a goal reads wrong over a man
carried off on a stretcher.

Otherwise one person reacts to the room ([lines.js](lines.js) `SOLO`): their kind's own line if
there is one for their stance, else their group's. Every group has a pool for every stance, so
a play is never met with silence for want of a line. Now and then the reaction is aimed at the
fan on the other side without a word said to them (`AT`): a look, a raised glass, a refusal to
turn round.

Tokens are filled per speaker: `{team}` `{opp}` `{player}` `{loser}` `{mine}` `{rival}` `{to}`
`{theirs}`. A club reads "the Crows", capitalised when it opens a sentence. `{to}` is the other
person's first name, so an NPC called "the bartender" can't be addressed and a line that needs
it is skipped.

## The restraint

| Gate | Value |
| --- | --- |
| A player in the room | always; a camera feed is somebody watching the room, not the set |
| One reaction per room | 40 s, or 12 s for a walk-off, grand slam, hat trick, triple play, death, overtime goal or final |
| Chance by kind | from 35% for a run to 95% for a triple play or a death; × 0.4 when nobody in the room has a stake |
| Somebody who just spoke | quiet for 25 s (10 s for the big moments), shared `_ai.lastSay` |
| A room mid-exchange | finishes it, unless the game ends under them |

Eligibility is npc-banter's `eligibleNpcs()`, so sleepers, staff on shift, anyone fighting or
mid-shop stay out. Every turn re-checks it. The room is claimed before the reply delay, or a
goal and its credit line would queue two reactions. tv-reactions leaves any beat with a `play`
to this plugin.

## Manifest

- consumes: `broadcast.message`
- no verbs, no DB tables, no scheduled tick
