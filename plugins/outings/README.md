# outings

## Purpose

NPCs have friends, and on an evening off they go out together. Each NPC with a home gets up to six friends; a free NPC with free friends calls a night out, they each walk from wherever they are to the same bar or club, meet there, stay three game hours and go home.

## How it works

- **The network** is built at boot from content the server already holds, so it costs nothing to author. Ties are weighted: a name in `flags.friends` (100), housemates on one `home_zone` (40), workmates in one workplace building (30), neighbours in one apartment building (10). Each NPC keeps its strongest six, ties broken by a hash of the pair, so the circle is the same every boot. Friendship is mutual.
- **Venues** are every `bar`, `pub`, `club`, `nightclub` and `honkytonk` (Jolene's) facade on `map_world`, entered at its interior entry room. A zone opts in with `flags.outing_venue` or out with `flags.no_outings`. A party goes to one of the three venues nearest the middle of its members' homes, in the caller's region.
- **Free** means placed, awake, not working, not due on shift within five game hours, not shopping, fighting, aboard, escorted or panicking. `flags.no_outings` on an NPC keeps them home.
- **The night.** Between 18:00 and 01:00 game time the `1m` tick tries to call up to two nights out, six live at most. A party is the caller and up to four free friends. Each NPC goes out once per game day.
- **Getting there.** A member is taken off their behaviour graph by a life driver (`registerLifeDriver`) and walked by `walkNpcToward` on the road graph, the same pathing as a commute. Arriving, they find the others ("comes in, spots X and goes over"). At the table there's a line now and then, only with a player in the room.
- **Going home.** At the end, or when someone's shift is under 90 minutes off, falls asleep, gets into a fight or can't reach the venue, the member says goodnight and is handed back to their graph, which walks them home. A party of one gives up.

All state is RAM. Nothing is queried or written; a restart means nobody's out tonight.

## Commands

None.

## Seams

- **tick**: `1m`; the scheduler skips it while nobody is logged in.
- **engine**: `registerLifeDriver` and `walkNpcToward` in `server/engine/ai-behaviour.js`.

## Content

- `npcs.flags.friends`: an array of NPC ids to always count as friends.
- `npcs.flags.no_outings`: never goes out.
- `zones.flags.outing_venue`: a room that counts as a venue though its building isn't a bar or club.
- `zones.flags.no_outings`: a bar nobody goes to on a night out.
