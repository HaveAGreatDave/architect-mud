# outings

## Purpose

NPCs have friends, and on an evening off they go out together: a night at a bar or club, or a house party at one of their flats. Each evening's plan is worked out from the game date, so it's the same on every server and after a restart, and anything can read it with `tonight()`.

## How it works

- **The network** is built at boot from content the server already holds, so it costs nothing to author. Ties are weighted: a name in `flags.friends` (100), housemates on one `home_zone` (40), workmates in one workplace building (30), neighbours in one apartment building (10). Each NPC keeps its strongest six, ties broken by a hash of the pair, so the circle is the same every boot. Friendship is mutual.
- **Venues** are every `bar`, `pub`, `club`, `nightclub` and `honkytonk` (Jolene's) facade on `map_world`, entered at its interior entry room. A zone opts in with `flags.outing_venue` or out with `flags.no_outings`. A party goes to one of the three venues nearest the middle of its members' homes, in the caller's region.
- **Free** means placed, awake, not working, not due on shift within five game hours, not shopping, fighting, aboard, escorted or panicking. `flags.no_outings` on an NPC keeps them home.
- **The plan.** `planEvening(date, dayOfWeek)` seeds a generator from a hash of the date and books up to three house parties (starting 20:00 to 23:00, four game hours, host and up to seven friends) and then six nights out (18:00 to 23:00, three game hours, caller and up to four friends). Nobody is booked twice in an evening. It reads only what's fixed for the evening: the network, the venues and shift rotas. An evening runs noon to noon, so after midnight it's still last night's plan.
- **Starting.** The `1m` tick starts each event at its hour. Planned members who aren't free right then (asleep, fighting, shopping) stay home; the host must be free, and is retried each minute until they are, so a host held up just starts late. An event less than half an hour from its end is dropped.
- **`tonight()`** returns the evening's list: kind, start time, venue, host, who was meant to go, and once it's started who's there. Nothing player-facing reads it yet.
- **House parties** are at the host's `home_zone`, if it's a real room off the street map and not marked `flags.no_house_parties` or `flags.no_outings`. They have their own arrival and chatter lines. If the host has to leave (shift, asleep, a fight), the party ends and the guests go home.
- **Getting there.** A member is taken off their behaviour graph by a life driver (`registerLifeDriver`) and walked by `walkNpcToward` on the road graph, the same pathing as a commute. Arriving, they find the others ("comes in, spots X and goes over"). At the table there's a line now and then, only with a player in the room. The lines are in `lines.js`: drinking, smoking, drugs, talk and "Wooo!", plus house and bar pools that change as the night goes from early to peak to late.
- **Going home.** At the end, or when someone's shift is under 90 minutes off, falls asleep, gets into a fight or can't reach the venue, the member says goodnight and is handed back to their graph, which walks them home. A party of one gives up.

All state is RAM. Nothing is queried or written; after a restart the plan is worked out again from the date and anything under way starts again.

## What a party does

Once two of them are there, the group is always in a **scene** (`scenes.js`). Each lasts a minute or two of real time, and the next is rolled by how far into the night it is: early it's mostly talk and a toast, at the peak dancing and drinking games, late the sing-songs, people passed out and couples pairing off. The same scene doesn't come up twice running, and one that needs three people doesn't come up for two.

| Scene | Who does what | Clips (actor3d.js) |
| --- | --- | --- |
| huddle | everyone in a tight ring, talking over each other | `huddle`, `talk`, `laugh`, `listen` |
| dance | a ring on the open floor | `groove`, `dance` |
| toast | a tight ring, drinks up together, then a swig | `toastUp` |
| drinking | one downs a drink, the rest chant | `chug`, `chant` |
| singalong | a line, shoulder to shoulder, arms round each other | `swaySing` |
| passedOut | one on the floor in the middle, the rest round them laughing | `sprawl`, `pointLaugh`, `laugh` |
| slipOff | a couple off in the corner, the rest huddled; at the end the couple leave together | `canoodle`, `huddle`, `talk`, `listen` |

Each scene says one line in the room as it starts (and the passed-out one and the couple say one as it ends), only with a player there. The Room Stage draws it through `room.npcStage` (`partyStage`): a free spot near the middle of the floor, one place each round it facing in, laid out from the room's own plan (`roomLayout`), and each member's clip rolled through their role's list every nine seconds. Someone the engine has sat down or laid down is left as the engine says. Every new clip plants both feet (`plant`), and `scripts/shapes/actor-feet.mjs` holds them to it. `partyScene(npcId)` says what a member's party is doing, for anything telling players.

The couple slipping off is the one scene that changes the night: when it ends they're let go from the party (`slipAway`) and walk home on their graphs. A host who slips off ends their own party.

## Commands

None.

## Seams

- **tick**: `1m`; the scheduler skips it while nobody is logged in.
- **hook**: answers `room.npcStage` for a member at their party; emits `room.peopleChanged` when the scene or a clip changes.
- **engine**: `registerLifeDriver` and `walkNpcToward` in `server/engine/ai-behaviour.js`.

## Content

- `npcs.flags.friends`: an array of NPC ids to always count as friends.
- `npcs.flags.no_outings`: never goes out.
- `zones.flags.outing_venue`: a room that counts as a venue though its building isn't a bar or club.
- `zones.flags.no_outings`: a bar nobody goes to on a night out, or a flat nobody throws a party in.
- `zones.flags.no_house_parties`: a flat nobody throws a party in.
