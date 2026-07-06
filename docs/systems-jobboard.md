# Job Board (as built)

The "legal early money" path — day work for players without the street smarts, the
Cool, or the stomach for crime. A rotating board of menial errands that pay little
and keep you fed. Beauty and misery, and you wouldn't have it any other way.

## Shape

- **`jobboard` plugin** — a thin **discovery + rotation** layer over the `quests`
  plugin. It owns no quest logic; the verbs delegate to `START_QUEST` / `TURN_IN`.
  - Verbs: `gigs` / `postings` / `jobboard` (read the board in your zone),
    `gigs take <n>` (accept), `gigs claim <n>` (hand in for pay). Deliberately
    **not** `jobs`/`board`/`take`/`claim` — those are owned by flight/gametable/
    posters/corps.
  - **The board is an actionable object.** The board furniture carries a `job_board`
    tag; `read <board>` (a specialized action, also surfaced as a Read button on the
    board's smart bar) lists the live postings. Every posting line has a **clickable**
    `[Take]` / `[Hand in]` (an `action-link` with `data-raw-cmd="gigs take/claim <n>"`),
    so the whole flow is point-and-click as well as typeable.
  - **`OPEN_JOBBOARD` dialogue Action** — lets an NPC (Marta) *read you the postings*.
    A static dialogue tree can't enumerate the rotating set, so her `work` node
    dispatches this and the `{dialogue_line}` result (the same clickable listing) is
    appended to her reply.
  - **Greeter move gate** (`jobboard:greeter`) — content-driven: a zone
    `flags.greeter = { npc_id, npc_name, met_flag, lines[] }`. The first time a player
    who hasn't met the greeter tries to **leave** that zone, the greeter (if present)
    hollers one of the lines and the move is blocked **once**; the `met_flag` is set so
    the next step is free (talking to the NPC also sets it). Writing on the block path
    follows the `govgate` checkpoint precedent.
  - Owns the **`job_boards`** config table (classified in `CONTENT_TABLES`).
  - Dev-panel **Job Boards** tab (`/job-boards` routes) picks which repeatable
    quests are in a board's pool, plus `rotation_size` (how many post at once) and
    `rotation_period` (how often the selection re-rolls).
- **Jobs are ordinary `quests` rows** authored in the quest editor — repeatable,
  and (for a safe zone) non-combat `visit` errands.

## Rotation

The board row is pure config. The live selection is a snapshot cached in a
`world_flag` (`jobboard_rot_<id>` = `{jobs:[quest_id...], at:epoch}`), re-rolled
lazily on read once `rotation_period` seconds have elapsed. No boot-time tick (boot
stays deliberate). Editing a board in the dev panel clears its snapshot so changes
show on the next read. Ids that leave the pool or whose quest row is deleted drop
out of the current rotation automatically.

## The Franchise Strip (first board)

`zone_city_west` — a safe hub one step off the spawn. Seeded by
`scripts/add-jobboard-content.js`:

- **5 gig quests** (`quest_fs_meter/parcel/count/line/loop`), 12–35₵, repeatable,
  visit-errands to existing neighbours (Loading Bay, Threshold, Rust Quarter,
  Embassy). `The Loop` is two `visit` objectives with a `requires` gate.
- **`board_franchise_strip`** — pool of all five, 3 rotate, every 6h.
- **`furn_fs_jobboard`** — the board itself (examine points you at `gigs`).
- **Marta Kell** (`npc_fs_dispatcher`) — the dispatcher behind the wire mesh; her
  dialogue is the first **philosophical encounter** (below), and she reads you the
  postings (`OPEN_JOBBOARD` on her `work` node). She is **pinned to the strip**: no
  `work_zone_id` (a work zone would make her an autonomous vendor that commutes
  "home"), `home_zone` set to `zone_city_west`, and an explicit stationary behaviour
  graph (occasional at-the-window flavour, no movement node) so `ensureBehaviourGraph`
  never auto-assigns her a walking default.
- **Marta is also the greeter** — `zone_city_west` carries `flags.greeter` pointing at
  her with 6 varied barks. A new player's first attempt to leave the Strip (before
  meeting her) is stopped once: she hollers ("you look desperate… check the board, come
  back to me when it's done"), sets `fs_marta_met`, and the next step is free.
- Extra desperation ambience on the zone.

## Philosophical encounters → alignment

The first encounter is Marta's opening line: _"So. What are you going to be?"_ Four
value-laden answers (survival / memory / devotion / ruin) each move a **faction**
and the **hidden Architect axis**, nudging you toward a force without ever naming
good or evil. Everyone is just surviving.

This runs on two dialogue Actions in the **`factions`** plugin (see
[plugins.md](plugins.md)), authored on dialogue options in the VINE editor:

- **`ADJUST_REPUTATION` `{faction_id, delta, reason?}`** — moves `player_faction_rep`
  (the five NPC factions: custodians / breakers / archivists / franchise / glitch).
  Players read it with `rep` / `factions`.
- **`ADJUST_ARCHITECT` `{delta}`** — moves a **hidden** per-player axis (player flag
  `architect_axis`, clamped -100..100) for the player's relationship to the Architect
  itself. Never surfaced; the machine just notes how you answer. Gate on it with a
  Condition `{ flag:'architect_axis', op:'gt'|'lt', value:<n> }`.

The creed choices are gated on a `fs_creed` flag they also set, so they fire **once**
— you can't re-open the conversation to farm reputation.

## Pending to go live

`npm run db:schema` (local, done) → `node scripts/add-jobboard-content.js` →
`/world/reload` or restart → hard-refresh the client. Not yet browser-verified.

## Not yet built (follow-ons)

More boards in other districts; `give`/`kill` job types (need NPC hand-ins / combat
zones); more philosophical encounters (Marta is the template); surfacing the Architect
axis obliquely once it crosses a threshold.
