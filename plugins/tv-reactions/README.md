# tv-reactions

**NPCs answer the screen.**

The broadcast tick has always emitted `broadcast.message` for every beat it puts into every
room with a tuned device. Nothing in the game listened to it. This plugin does: occasionally,
an idle NPC in a room where a set is on says something about the line that just aired.

## What it is not

It is not a commentary track. The whole design is the restraint:

| Gate | Why |
| --- | --- |
| One reaction per zone per **150 s** | A television is background. A room that answers every line is a laugh track. |
| …and then only **18 %** of the time | Mostly, people watching television say nothing. |
| Never when `onStage` | On a studio floor the cast are *saying* those lines, not watching them. |
| Never without a player in the room | A camera feed is somebody watching the ROOM. An empty bar muttering at a game show into a spy cam is atmosphere nobody asked to pay for. |
| Never within 25 s of the speaker's last line | Shared `_ai.lastSay`, which is also how a running banter scene fences this out. |

The throttle slot is claimed **before** the delay, not after. Several beats can land inside the
same couple of seconds; without that, each would queue its own reaction and the room would
answer the television in chorus.

## Eligibility is borrowed, not built

`eligibleNpcs()` is [npc-banter](../../server/engine/npc-banter.js)'s own export — it exists
because ambient-life needed the same predicate. A sleeper, an NPC on shift, one mid-shop or
mid-combat is out of this for exactly the reasons they are out of banter, and stays out if
those rules ever change. Nothing here re-derives them.

## Lines are keyed on `playback_mode`

The mode is the only field that reliably says what *kind* of thing just happened. A groan
belongs to a ball game and not to a sermon, and that difference is most of the reason to build
this at all — a generic "shakes his head at the set" would have been the bartender's existing
`tvLine()` with extra steps.

Pools exist for `sports`, `news`, `dynamic_news`, `gameshow`, `talkshow`, `morning`, `sermon`,
`film`, `weather`, `live_camera` and `commercial`; anything else falls through to a generic pool.
A line may embed `{program}` or `{station}`, and **a line whose token has no value on this beat is
skipped in favour of one that resolves** — the same rule banter applies to its topical threads.

## The other half: banter about the show

Reacting to a beat is one thing; *arguing about the programme* is the other, and that lives in
the banter library rather than here. `getTopicContext()` in
[npc-banter.js](../../server/engine/npc-banter.js) now resolves `{tv_program}`, `{tv_station}`
and `{tv_channel}` for the zone a scene is starting in, so an authored thread in
`npc_banter_threads` can be about what's on. Those tokens are **unset in a room with no set on**,
which is most rooms, so such a thread can only ever air in front of a screen and nobody argues
about the ball game in an empty stairwell.

The engine reaches broadcast through the `broadcast.getZoneNowPlaying` action, never an import.

## Manifest

- consumes: `broadcast.message`
- no verbs, no DB tables, no scheduled tick
