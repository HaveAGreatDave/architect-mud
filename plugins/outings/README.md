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
- **Getting there.** A member is taken off their behaviour graph by a life driver (`registerLifeDriver`) and walked by `walkNpcToward` on the road graph, the same pathing as a commute. Arriving, they find the others ("comes in, spots X and goes over"). At the table there's a line now and then, only with a player in the room.
- **Going home.** At the end, or when someone's shift is under 90 minutes off, falls asleep, gets into a fight or can't reach the venue, the member says goodnight and is handed back to their graph, which walks them home. A party of one gives up.

All state is RAM. Nothing is queried or written; after a restart the plan is worked out again from the date and anything under way starts again.

## Commands

None.

## Seams

- **tick**: `1m`; the scheduler skips it while nobody is logged in.
- **engine**: `registerLifeDriver` and `walkNpcToward` in `server/engine/ai-behaviour.js`.

## Content

- `npcs.flags.friends`: an array of NPC ids to always count as friends.
- `npcs.flags.no_outings`: never goes out.
- `zones.flags.outing_venue`: a room that counts as a venue though its building isn't a bar or club.
- `zones.flags.no_outings`: a bar nobody goes to on a night out, or a flat nobody throws a party in.
- `zones.flags.no_house_parties`: a flat nobody throws a party in.
