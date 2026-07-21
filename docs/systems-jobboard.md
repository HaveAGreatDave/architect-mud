# Job Board (as built)

The "legal early money" path — day work for players without the street smarts, the
Cool, or the stomach for crime. A rotating board of menial errands that pay little
and keep you fed. Beauty and misery, and you wouldn't have it any other way.

## Shape

- **`jobboard` plugin** — a thin **discovery + rotation** layer over the `quests`
  plugin. It owns no quest logic; the verbs delegate to `START_QUEST` / `TURN_IN`.
  - Verbs: `gigs` / `postings` / `jobboard` — the bare verbs **open the Tablet OS
    Job Board** (Quests → Job Board via `tabletnav`), they no longer text-render the
    board in chat. `gigs take <n>` (accept) and `gigs claim <n>` (hand in for pay)
    still act directly. Deliberately **not** `jobs`/`board`/`take`/`claim` — those
    are owned by flight/gametable/posters/corps.
  - **The board is an actionable object.** The board furniture carries a `job_board`
    tag; `read <board>` (a specialized action, also surfaced as a Read button on the
    board's smart bar) likewise opens the Tablet OS Job Board.
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

`zone_district_919_904` (Ironside Street) — an open street tile two steps east and
one south of the spawn facade. Originally seeded by `scripts/add-jobboard-content.js`
against a `zone_city_west` that no longer exists; the live content is now the JSON
under `content/` (the script is kept only as provenance).

- **6 gig quests** (`quest_fs_meter/parcel/count/line/loop/haul`), 10–25₵, repeatable,
  visit-errands out into the wider district. `The Loop` and `The Haul` chain several
  `visit` objectives with `requires` gates. (Twelve more `quest_fs_*` quests exist in
  `content/quests/` but are in no board pool.)
- **`board_franchise_strip`** — pool of all six, 3 rotate, every 6h.
- **`furn_fs_jobboard`** — the board itself (examine points you at `gigs`).
- **Marta Kell** (`npc_fs_dispatcher`) — the dispatcher behind the wire mesh; her
  dialogue is the first **philosophical encounter** (below), and she reads you the
  postings (`OPEN_JOBBOARD` on her `work` node). She is **pinned to the strip**: no
  `work_zone_id` (a work zone would make her an autonomous vendor that commutes
  "home"), `home_zone` set to `zone_district_919_904`, and an explicit stationary behaviour
  graph (occasional at-the-window flavour, no movement node) so `ensureBehaviourGraph`
  never auto-assigns her a walking default.
- **Marta is also the greeter** — `zone_district_919_904` carries `flags.greeter` pointing at
  her with 6 varied barks. A new player's first attempt to leave the Strip (before
  meeting her) is stopped once: she hollers ("you look desperate… check the board, come
  back to me when it's done"), sets `fs_marta_met`, and the next step is free.
- Extra desperation ambience on the zone.

## Marta is the on-ramp, not the destination (2026-07-21)

The board is a *teaching* income, not a living: 10–25₵ for round trips of 20–50 tiles. Left alone it
was a dead end — the only thing above it was [steady work](../plugins/work/), which sat behind a
500-lifetime-XP gate that quests never paid into. That gate is gone, so Marta now hands players up
the ladder herself, which is what a labour dispatcher is *for*:

- **`fs_gig_done`** — set by the `rewards.flags` of all six pool gigs (**not** by her `job_turnin`
  dialogue node: `gigs claim` dispatches `TURN_IN` directly and never touches her tree, so a
  dialogue-side flag would miss every board hand-in).
- Once set, `root` and every `job_turnin` open **`steady`** → she draws the tab/shift distinction and
  hands off to steady work; **`who_hires`** → the six residential quest-givers plus Rooke; and
  **`the_waste`** → the game's only early mention of the void.
- **The venue list is not authored in her dialogue.** The "who's taking people on?" option carries
  `cmd: 'work'`, dispatching the live command, which reads `flags.work_venue` off the world — so a
  third venue never makes her stale. Prefer this to hardcoding names into dialogue anywhere the
  engine already has a list.

## Philosophical encounters → alignment

The first encounter is Marta's _"So. What are you going to be?"_ Four value-laden
answers (survival / memory / devotion / ruin) each move an **ideology** plus the
player's **stance and path**, nudging you toward a force without ever naming good or
evil.

**It is earned, not her opening line (changed 2026-07-21).** It used to be the first
thing she said to a player who had existed for four minutes, and it permanently set
their stance and path — the game's one identity beat spent on a coin flip by someone
who hadn't done anything yet. The four answers now live on a **`creed`** node she opens
herself, gated on **`work_shift_done`**: you must have seen a shift through (`clock
out`/completed) or delivered a courier run. A gig off her own board is deliberately
**not** enough — by her own account a tab is an errand and a shift is a job, and she
says as much in `steady`. Being sent home or walking off mid-shift doesn't count
either. Both the opening option and all four answers carry the gate, so no route
reaches it early. Everyone is just surviving. The creeds map: survival→Wildblood
(renounce · flesh), memory→the Long Watch (redeem · human), devotion→the Ascendants
(redeem · machine), ruin→the Exodus (renounce · mind).

This runs on three dialogue Actions in the **`ideologies`** plugin (see
[plugins.md](plugins.md)), authored on dialogue options in the VINE editor:

- **`ADJUST_REPUTATION` `{ideology_id, delta, reason?}`** — moves `player_ideology_rep`
  (the four NPC ideologies: ascendants / long_watch / wildblood / exodus).
  Players read it with `rep` / `ideologies`.
- **`ADJUST_STANCE` `{delta}`** — moves the player's stance on the world (player flag
  `stance_axis`, -100 renounce .. +100 redeem).
- **`ADJUST_PATH` `{path, delta}`** — nudges affinity toward one path for humanity
  (player flags `path_machine`/`path_flesh`/`path_mind`/`path_human`, 0..100).

Stance + path are surfaced only through your ideology lean, never as raw numbers.
Gate on them with a Condition `{ flag:'stance_axis', op:'gt'|'lt', value:<n> }` (or a
`path_*` flag).

The creed choices are gated on a `fs_creed` flag they also set, so they fire **once**
— you can't re-open the conversation to farm reputation.

## Pending to go live

`npm run db:schema` (local, done) → `node scripts/add-jobboard-content.js` →
`/world/reload` or restart → hard-refresh the client. Not yet browser-verified.

## Not yet built (follow-ons)

More boards in other districts; `give`/`kill` job types (need NPC hand-ins / combat
zones); more philosophical encounters (Marta is the template); surfacing the Architect
axis obliquely once it crosses a threshold.
