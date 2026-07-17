# Flags-Bag Key Inventory

`zones.flags`, `npcs.flags`, and `furniture.flags` are JSONB grab-bags read via
`flags->>'key'` (SQL) and `flags.key` / `tagsOf()` (JS). **When you add a new
flag key, add a row here.** Drift check: `node scripts/report-flag-keys.mjs`
(add `--env-file=.env.prod` for prod) lists every stored key and flags any
missing from this file.

**Zone flags are catalog-validated since 2026-07** (scope `'zone'` in
`client/shared/tagCatalog.js`): zone create/update and `PATCH /zones/:id/tag`
reject uncatalogued keys or wrong value shapes, and `scripts/content/lint.mjs`
sweeps `content/zones/*.json`. Add a new zone key to the catalog FIRST, then
here. NPC/furniture bags remain documented-not-validated — a typo'd key there
is silently inert, so grep before renaming anything below.

## zones.flags

| key | owner | meaning |
|---|---|---|
| `airfield_charter` | flight | zone offers charter flights |
| `charter_vtol_only` | flight | charter pad is VTOL Dragonfly-only, off-airfield drops, no rental desk (Echelon helipad) |
| `airfield_dealer` | flight | aircraft dealer here |
| `airfield_fuel` | flight | fuel vendor here |
| `airfield_fuels` | flight | fuel price/stock config |
| `airfield_id` | flight | which airfield this zone belongs to |
| `airfield_lawless` | flight | airfield outside city law |
| `airfield_name` | flight | display name of the airfield |
| `aa_site` | aa-sites | this surface tile is an AA emplacement's exposed gun deck — drives the map AA POI (`⌖` / "AA battery") |
| `aa_bunker` | aa-sites | interior bunker zone under an AA site; value = the owning `aa_sites.id` |
| `airspace_restricted` | flight | AA-gated airspace over this zone |
| `always_lit` | environment | never dark regardless of power/time |
| `allow_sleep` | protection/sleep | permit `sleep` here WITHOUT the sanctuary bundle — safe-zone-rate rest, but no combat protection/forcefield/spawn suppression (e.g. the Precinct 9 holding cell) |
| `artery` | movement/ambience | major street (traffic ambience, routing) |
| `building_name` | world | display name of the enclosing building |
| `building_type` | world | building category (shop, apartment, …) |
| `checkpoint` | govgate | checkpoint gate zone |
| `claimable` | corps | territory override: force claimable (absent = derived from inferred danger) |
| `claimable_asset` | corps | this building is a claimable corporate income asset (Corporate Assets Phase A); `corps/ventures.js` reads it for `corp asset claim` |
| `danger` | danger | manual danger override (`safe/low/medium/high/lethal`) — normally inferred from spawns + radiation (`engine/danger.js`) |
| `district` | districts | override the id-prefix-derived district key (`engine/districts.js`) |
| `elevator` | movement | elevator car zone |
| `facade` | movement | OPT-IN non-standable building tile: auto-forwards into the interior map's entry zone; OUT lands on `world_exit_zone` (needs a maps row with `parent_zone_id` = this zone) |
| `elevator_floors` | movement | floor list for the elevator |
| `fishing_table_id` | fishing | scavenging-table id used for fishing here |
| `gov_checkpoint` | govgate | government checkpoint (contraband scan) |
| `gov_enclave` | govgate | inside the government enclave |
| `greeter` | jobboard | greeter NPC gate zone |
| `hangar_interior` | flight | inside a hangar |
| `hangar_interior_zone` | flight | link from ramp to hangar interior |
| `hangar_ramp` | flight | hangar ramp (aircraft parking) |
| `insurance_desk` | flight | aircraft insurance vendor here |
| `intro_lore` | lore plugin | one-time lore text on first visit |
| `is_apartment` | housing | rentable apartment zone |
| `is_building` | power/world | groups interior zones into one building (junction-box scope) |
| `is_interior` | environment | indoors (weather/temperature/lighting model) |
| `lawless` | surveillance | crimes here raise no heat/wanted |
| `mining_table_id` | mining | scavenging-table id used for mining here |
| `mis_ok` | mis | zone-gated NPC consent (see `mis_requires_zone_flag`) |
| `no_spawn` | spawning | suppress enemy spawns |
| `open_sky` | flight + environment | outdoor zone aircraft can overfly/land; on an `is_interior`/`is_building` zone (an open roof/deck) it also makes the zone climatically OUTDOORS — sky light, weather, and outdoor temp — while the raw interior flag keeps it in the power/building network (see `isIndoorZone`) |
| `planner` | zone-planner | provenance: blueprint id that generated this zone (tools/zone-planner) |
| `prologue` | prologue | part of the prologue instance |
| `radiation` | survival | ambient radiation 0–100 (entry gain `floor(v×0.1)`; ≥25/≥40 floors danger to high/lethal). Replaced the `radiation_level` column (legacy 1–5 values rescaled ×10) |
| `sanctuary` | protection/sleep/spawning | civilization carve-out: combat protection (protection substrate — now blocks NPC **and** enemy attacks too, not just player attack/loot/steal/shove; see `enemyAttackPlayer`/`npcAttackPlayer` in `combat.js`), safe sleep, AI safe-flee, no hostile spawns. DELIBERATE — replaced `is_safe_zone`, which was dropped without conversion |
| `scavenging_table_id` | scavenging | loot table for searching here |
| `street_life` | ambience | ambient street-life event pool strength |
| `terrain` | map/minimap/flight | authored ground surface (`water\|road\|asphalt\|concrete\|grass\|dirt\|sand\|gravel\|dock`) — the SSOT `zoneTerrain()` prefers over inference; drives minimap/tablet fills + flight ground tint. Painted in dev panel Maps → Terrain mode. Road tiles auto-tile their connector from adjacent road terrain (`roadConnector` in `world.js`) |
| `utility_room` | power | building utility room (junction box lives here) |
| `water` | movement | water zone (needs a `boat`-tagged item) |
| `world_exit_zone` | movement | exterior seam zone for this building |

## npcs.flags

| key | owner | meaning |
|---|---|---|
| `battle_cries` | combat | lines shouted in combat |
| `charter_pilot` | flight | offers charter flights |
| `clothing_layers` | npc-clothing | descriptive outfit model (see npc-clothing.md) |
| `covert` | vendor/drugwar | covert dealer (passphrase-gated) |
| `deal_from` / `deal_to` | drugwar | dealing hours window |
| `drug_buyer` | drugwar | buys drugs from players |
| `essential` | combat | cannot be killed |
| `faction_guard` | factions | attacks on faction aggression |
| `gift_trade` | trade | accepts gifts |
| `inner_circle_flag` | vendor | player flag that unlocks inner-circle stock |
| `job_board_dispatcher` | jobboard | quest turn-in dispatcher |
| `mis_requires_zone_flag` | mis | only consents in zones carrying this flag |
| `mis_willing` | mis | consents to MIS interactions |
| `no_attack` / `no_attack_message` | combat | unattackable (+custom refusal line) |
| `passphrases` | vendor | covert-dealer passphrases |
| `personality` | npc-personality | personality archetype (drives outfit/banter) |
| `poker_bankroll` / `poker_persona` / `poker_player` | gametable | NPC poker player config |
| `police` | jail/surveillance | police unit (arrest powers) |
| `stripper` | strippers | performs at the club |
| `studio_npc` | broadcast | broadcast-studio actor |
| `table_id` | gametable | which game table the NPC sits at |
| `trust_flag` / `trust_max` / `trust_per_buy` | vendor | per-player trust meter unlocking stock |

## furniture.flags

| key | owner | meaning |
|---|---|---|
| `architect_wink` | flavor | Architect easter-egg examine text |
| `atm` | atm | ATM terminal (pairs with `atm_units` row) |
| `bed` | posture/sleep | sleepable |
| `broadcast_device_type` / `broadcast_receiver` / `broadcast_transmitter` | broadcast | broadcast hardware role |
| `bulletin` | leaderboard | READ shows the server leaderboard |
| `camera_id` | broadcast | media_cameras row this camera feeds |
| `channel_id` | broadcast | channel a deck/TV is tuned to |
| `chargen` | prologue | character-generation terminal |
| `concealed` | surveillance | planted device concealment state |
| `container` | inventory | holds items |
| `corp_poster` / `hero_poster` / `poster_key` | corps/events | wall poster identity |
| `cosmetic_machine` | appearance | morphex/biosculpt station |
| `crafting_station` | crafting | crafting station |
| `deck_active` / `deck_cassettes` / `deck_ejected_slots` | broadcast | media deck state |
| `destructible` | combat | can be attacked (uses hp/hp_max) |
| `device_id` | surveillance | security_devices row this furniture mirrors |
| `game_table_id` | gametable | game_tables row (poker) |
| `generator_id` | power | generators row this furniture mirrors |
| `hack_difficulty` | hacking | difficulty to hack this object |
| `interactions` | engine (tags.js) | verb list surfaced as tags (`['switch','sit']`) |
| `is_light` / `light_type` | environment | legacy light markers (see furniture columns) |
| `job_board` | jobboard | job board |
| `junction_box` | power | junction-box housing |
| `media_deck` | broadcast | cassette deck |
| `police_terminal` | jail | police booking terminal |
| `prologue_chair` / `prologue_holosign` | prologue | prologue set dressing |
| `requires_demolition` | power | only `demolition`-tagged items damage it |
| `seat_idx` | gametable | seat number at a table |
| `security_device` | surveillance | is a plantable security device |
| `station_quality` | crafting | crafting station quality |
| `trash_bin` | scavenging | searchable trash |
| `tv` / `tv_dial_freq` / `tv_skin` | broadcast | television set config |
| `vendor_npc_id` | vendor | vendor NPC whose shop this furniture belongs to |
| `vendor_safe` | vendor-safe | crackable vendor safe |
| `vendor_schedule_board` | vendor | shop-hours board |
| `water_source` | water plugin | drink/wash here |
