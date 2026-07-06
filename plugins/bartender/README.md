# bartender

Makes bartender-personality NPCs *act like bartenders* instead of reciting canned lines.

The NPC archetype (`npc-personality.js` → `bartender`) already gives a bartender a
pool of static work chitchat, fired sparsely by the engine's `AT_WORK` behaviour
node. This plugin is the **reactive layer** on top.

## What it does

A `30s` tick (`schedule('30s', bartenderTick)`) walks every NPC with
`flags.personality === 'bartender'` who is **on-shift at their bar with at least one
player in the room**, reads the live room, and reacts in character:

- **First-week player walks in** (`players.created_at` within 7 days) → he clocks
  them, welcomes them by handle, then drips one real **survival tip** at a time over
  the visit (each tip given once per player). Tips reference actual verbs —
  `deposit`, `wanted`, `scavenge`, `gigs`, `rest`, `map`, `equip`, `skills`, `rep` —
  and the game's shape (heat/Precinct 9, the drug economy's bite, flight/corps/The
  Under waiting past the first week).
- **A poker hand is running** at a table in the room (`gametable`'s `activeTables`,
  `phase === 'InProgress'`) → rail commentary that reads the **actual pot / street /
  heads-up** state.
- **The TV is on** (`broadcast`'s `getZoneNowPlaying`) → he comments on **what's
  actually airing** (program name, else station/channel).
- **Otherwise** → bar business: pouring, wiping, the patter.

Throttled (`AMBIENT_GAP_MS`) with a quiet-chance so he isn't a chatterbox; a new
arrival's welcome is prompt and bypasses the throttle.

## Reactive dialogue actions

Registered for use in a bartender's `dialogue_tree` (the same live reads, on demand
when a player `talk`s to him and picks the option):

| Action | Response |
|---|---|
| `BARTENDER_ADVICE` | A newcomer gets a fresh tip (shared pool with the tick, so no repeats); a veteran gets a deflection. |
| `BARTENDER_TV`     | Comments on what's on the room's TV, or notes the set is dark. |
| `BARTENDER_POKER`  | Reads the live table, or notes it's cold. |

## Scope & state

Generic over the `bartender` personality — today that's **Lowry** at the Embassy
(`npc_embassy_barkeep`, `zone_residential_lobby`); any future bartender inherits it
for free. All memory (who's been welcomed, which tips each player has heard) is
**in-memory** and resets on restart — a bartender's short memory doesn't warrant a
persisted Flag.

Reads two sibling plugins directly (`gametable`, `broadcast`) — read-only getters,
no load-order dependency (ES imports resolve the module graph eagerly).
