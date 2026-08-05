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

An owner of **`—`** means the key is authored in content and (for zones)
catalogued, but **no code reads it**. Gating new behaviour on one of those does
nothing, silently; wire a reader first.

## zones.flags

| key | owner | meaning |
|---|---|---|
| `residents_only` | residency | interior tile only enterable by a player holding a unit in the named building — walked in OR ridden to by lift (the lift runs the gate chain too) |
| `residents_only_deny` | residency | optional refusal line for `residents_only`, in the building's voice |
| `private_billet_owner` | consort | handle of the player who **holds** this zone as a private space. Makes a bespoke room (a yacht boudoir, a safehouse) a legal B.L.I.S.S. delivery address without the consort plugin having to know what a yacht is — apartments you control and premises you own already qualify without this |
| `yacht` / `echelon` | yacht | marks an Echelon zone (the yacht) |
| `echelon_bridge` | yacht | the bridge — every `helm`/`sail`/`stop`/`dock` verb gates on this flag |
| `echelon_suite` | yacht/consort | Cyd's private quarters — owner-gated behind the suite hatch; hosts the MIS-gated dancers |
| `echelon_sundeck` | consort | open-air top-deck lounge (jacuzzi); beckoned consorts suntan/soak/lounge here |
| `echelon_view` | consort | a deck you can LOOK out across the Basin from (stern lounge, stair landing) |
| `echelon_helipad` | consort/flight | stern landing pad — a VTOL Dragonfly can set down here to embark/disembark |
| `engine_ambience` | movement (client yacht-ambience) | engine-room rumble plays here, swelling while she makes way (`yacht_underway`) |
| `heading` | yacht | **RUNTIME-only**: the vessel's last steered course in degrees (0=N). Injected onto the live Echelon exterior zone from the persisted world flag — never authored in content; catalogued so it survives the zone-flags sweep |
| `vessel` | swimming | this zone is a boat sitting on the map: swimmers can't enter the water tile it shares coordinates with (the `swimming:vessel-hull` gate), and `embark` from any tile alongside climbs aboard it. Needs an `in` exit to the vessel interior |
| `naval_ambience` | yacht | naval ambient-event pool (Echelon exterior) |
| `pier` | terrain | pier tile → inferred `dock` surface by `zoneTerrain()` when no authored `terrain` |
| ~~`airfield_*` (12 keys)~~ | **MOVED TO A TABLE 2026-08-02** | `airfield_name`, `airfield_charter`, `airfield_rental`, `airfield_dealer`, `airfield_fuel`, `airfield_fuels`, `airfield_vtol_only`, `charter_vtol_only`, `airfield_residents_only`, `airfield_lawless`, `airfield_theme`, `airfield_surface` are now COLUMNS on the `airfields` table (`name`, `charter`, `rental`, `dealer`, `fuels`, `vtol_only`, `charter_vtol_only`, `residents_only`, `lawless`, `theme`, `surface`), one row per field, authored under `content/airfields/`. Read them with `airfieldOf(zone)` (world.js, **sync by contract**), never off the tile. `airfield_fuel` + `airfield_fuels` collapsed into the single `fuels` column. Migrated by `scripts/migrate-airfields-to-table.mjs` |
| `airfield_id` | flight | **the membership pointer**, and the only airfield key left on a tile — the `airfields.id` this tile belongs to, exactly the shape `region_id` uses. Everything true of the FIELD lives on the row; the tile keeps only geometry (`runway`, `hangar_*`). A tile whose id has no row resolves to null everywhere, which every caller already reads as "no field here" |
| ~~`fence_cache`~~ | **REMOVED 2026-08-02** | there is no fence-cache flag. `scripts/reach-dead-drops.mjs` wrote it on 3 tiles and nothing read it; the authoritative list of raw-drug dead drops is `FENCE_CACHES` in `plugins/flight/contracts.js`, which those tile ids must already stay in step with. The flag was a second, weaker copy of that fact |
| `runway` | flight | runway tile: `ns`/`ew` is the centreline orientation the flight sim aligns its drawn runway to; `pad` is the surrounding asphalt |
| `aircraft_cabin` | flight | interior cabin room of a **walkable** aircraft; value = the craft-type id (e.g. `leviathan`). Binds these coordinate-free rooms to the live aircraft; the move gate seals world exits while airborne |
| `cabin_window` | flight | cabin room with windows — `window` opens the through-hull moving-world view from here |
| `flightdeck` | flight | cockpit room of a walkable aircraft: home of TAKE CONTROLS / HAND OFF and the NAV console |
| `home_slots` | — (not yet) | authored decor anchors a walkable-base room offers, each `{ id, kind, label }`. **No reader yet** — the anchors are authored AHEAD of the decor feature ([proposals/leviathan-flying-base.md](proposals/leviathan-flying-base.md)). Deliberate, not residue: don't strip it |
| `aa_site` | aa-sites | this surface tile is an AA emplacement's exposed gun deck — drives the map AA POI (`⌖` / "AA battery") |
| `airspace_restricted` | flight | AA-gated airspace over this zone |
| `always_lit` | environment | never dark regardless of power/time |
| `light_beacon` | environment | floods this tile + its 8 grid-neighbours to full brightness, overriding night/power/weather |
| `allow_sleep` | protection/sleep | permit `sleep` here WITHOUT the sanctuary bundle — safe-zone-rate rest, but no combat protection/forcefield/spawn suppression (e.g. the Precinct 9 holding cell) |
| `artery` | movement/ambience | major street (traffic ambience, routing) |
| `cell_block` | jail | room behind the Precinct 9 cell door a prisoner may walk to without it counting as a jailbreak (Wash Block, The Pit). The cell itself is the plugin's `CELL_ZONE` and needs no flag; a room that reaches the street must never carry this |
| `building_name` | world | display name of the enclosing building |
| `building_type` | world | building category (shop, apartment, …) |
| `checkpoint_cfg` | checkpoint | security-checkpoint config object ({ guards, checks:[wanted\|smuggle\|contraband], wantedMode, entry predicate insideFlag\|fromFlag\|fromDistrict }) driving the checkpoint move-gate law |
| `curtain` | engine minimap + flight | **presentation only** — tile borders the Architect's energy wall on the city's land edge; renders a minimap shimmer-edge, the windshield wall and a room-description curtain line. It gates **nothing**: there is no move gate on this flag (grep `registerMoveGate`), and it is not what keeps the city sealed. The seal is 133 authored walls between the frontier tiles — `connections` rows with `blocked: true` and `name: "the Architect's Curtain"`, minted by `scripts/content/mint-curtain-walls.mjs` and held closed by `content:lint` + the regress curtain law. Until 2026-07-29 the seal was a derive-time rule reading `flags.district === 'wilds'`, which meant a district repaint could open a hole with no diff. There is no `perimeter` plugin — the engine whitelists these three into the map payload (`world.js:928`, `commands/movement.js:778`) and `plugins/flight/state.js:574` renders the wall |
| `perimeter_gate` | engine minimap + flight | the one break in the Curtain — the guarded road out to the wilds; draws a gate glyph and carries the exit through the wall |
| `glacis` | engine minimap + flight; checkpoint | outward-facing turret killing-ground just beyond a `perimeter_gate`. Also usable as a `checkpoint_cfg.fromFlag` predicate |
| `ascendant_campus` | ascendant | world tile is part of the Ascendant stronghold campus (western frontier) — ambience + faction framing |
| `ascension_gate` | ascendant | the gated entrance tile into the Ascendant campus |
| `ascendant_registry` | augments | the Vats registry desk — intake/enrolment room |
| `ascendant_vats` | augments | the cloning/regrowth hall within The Vats |
| `augment_clinic` | augments | room where cybernetic augments can be installed (Chrome Clinic) |
| `assurance_policy` | augments | desk selling prepaid cortical-backup restores (the secret Halcyon front); enables the `policy` verb |
| `claimable` | corps | territory override: force claimable (absent = derived from inferred danger) |
| `claimable_asset` | corps | this building is a claimable corporate income asset (Corporate Assets Phase A); `corps/ventures.js` reads it for `corp asset claim` |
| `danger` | danger | manual danger override (`safe/low/medium/high/lethal`) — normally inferred from spawns + radiation (`engine/danger.js`) |
| `district` | districts | the land-use district this tile belongs to (`districts` table). Painted in the Studio's district view, never typed — the legacy id-prefix rung still classifies 154 old zones |
| `elevator` | movement | elevator car zone |
| `facade` | movement | OPT-IN non-standable building tile: auto-forwards into the interior map's entry zone; OUT lands on `world_exit_zone` (needs a maps row with `parent_zone_id` = this zone) |
| `elevator_floors` | movement | floor list for the elevator (Floor 1 / lobby is implicit — synthesized from the car's `out` exit) |
| `hide_exits` | describe (engine) | suppress the player-facing exit/room/building list in the room description; graph (movement, NPC pathfinding, minimap) is untouched. Used by elevator cars so the floor panel is the sole exit UI |
| `fishing_table_id` | fishing | scavenging-table id used for fishing here |
| `gov_enclave` | checkpoint | inside the government enclave — consumed only as a `checkpoint_cfg.insideFlag` value (the gate is generic, not special-cased) |
| `citadel_public` | checkpoint | the public floor of Citadel Financial (the Marble Hall); the security vestibule's `checkpoint_cfg.fromFlag`, so the scan runs on the way in and not on the way back out |
| `greeter` | jobboard | greeter NPC gate zone |
| `hangar_interior` | flight | inside a hangar |
| `hangar_interior_zone` | flight | link from ramp to hangar interior |
| `hangar_ramp` | flight | hangar ramp (aircraft parking) |
| `insurance_desk` | flight | aircraft insurance vendor here |
| `gate_warning` | gatewarn plugin | one-time gate-guard border briefing, delivered on first entry to the tile |
| `intro_lore` | lore plugin | one-time lore text on first visit |
| `gps_suggest` | lore plugin | destination zone id; first entry to this tile plots a one-off GPS route there (pre-quest nudge) |
| `gps_suggest_label` | lore plugin | optional hint text for the `gps_suggest` route line |
| `is_apartment` | housing | rentable apartment zone |
| `window` | engine (`environment.js`) | this room has a window onto the outdoors: `{ name, description, light, visibility }`, every key optional. Lets daylight in (the only ambient an interior gets), can be looked through, curtains drawn — and decides whether you SEE an approaching storm or only feel it through the wall (`skyVantage`). **Replaced the `windows` table** (which held three windows world-wide); every rentable unit has one now. ⚠ **Curtain and glass are RUNTIME state in RAM, never authored here** — same split as `door.lock_state` |
| `is_dwelling` | engine (`zone-tags.js`) | somewhere a person LIVES that nobody rents — a cabin, a penthouse, a bunkroom, a lair. `isDwellingZone()` = `is_apartment \|\| is_dwelling`, and an NPC only performs **home-life activities** in a zone that passes it. **Never put it on a workplace**: most of the cast has their own shop floor or the studio stage as `home_zone`, and flagging those made them tidy the apartment in front of customers |
| `is_storefront` | storefront | vacant retail unit a player can buy (`buyshop`). Terms are `shop_price`/`shop_term`/`shop_upkeep`; the deed itself is player data in the `storefronts` table, never content |
| `shop_price` | storefront | **authored** total asking price for an `is_storefront` unit; the instalment is price ÷ `shop_term`. Omit for the 6000₵ default |
| `shop_term` | storefront | **authored** number of 7-game-day instalments that clear the mortgage. Omit for the 8-cycle default |
| `shop_upkeep` | storefront | **authored** per-cycle charge once the mortgage clears, so an abandoned shop still lapses. Omit for the 40₵ default |
| `rent_cost` | housing | **authored** weekly rent for this apartment unit (needs `is_apartment`); read by `authoredRentCost` in `apartments.js`. Omit for the 100₵ default. Tenancy itself is player data in the `apartments` table, never content |
| `is_building` | power/world | groups interior zones into one building (junction-box scope) |
| `is_interior` | environment | indoors (weather/temperature/lighting model) |
| `is_dreamzone` | trip | off-map hallucination zone the trip plugin teleports a mind into (`map_dream`, no exits). Kept off the minimap; login bounces anyone a restart stranded here |
| `entrance` | world (map arrows) | **authored** door side (`north\|south\|east\|west`) for the facade's map entrance arrow, read by `buildingEntranceDir` (`world.js:176`). Baked once from the road graph by `scripts/bake-building-entrances.mjs`, **not** inferred at runtime — inference let unrelated terrain painting silently relocate doors. The interior's `out` exit must mirror it. The yacht plugin is the one legitimate runtime writer (the Echelon's exterior tile sails) |
| `icon` | world (minimap/flight) | name of an SVG in `client/game/assets/zone-icons/` (without `.svg`) drawn on the minimap tile in place of the marker glyph. Flight also pattern-matches it (`road_*`, `runway_*`, `statue*`) |
| `floors` | flight | explicit storey count for the flight-sim skyline, overriding the per-building-type default so a landmark tower stands taller |
| `region_id` | world (World Editor) | spatial region membership — the `regions.id` this tile belongs to. **Distinct from `district`** (land-use); see [reference/land-taxonomy.md](reference/land-taxonomy.md) |
| `underwater` | props (preset) | **OVERRIDE**, `tristate`. Submerged tile below a surface water tile (link up/down): always submerged (a boat doesn't help), colder and dark; starts the breath timer that drowns you. **Preset by the `underwater` TERRAIN** since 2026-07-30 — the 82 tiles that carried this as a raw flag were migrated. Read as `propsOf(id).underwater` |
| `water_temp_c` | swimming | override the temperature a submerged swimmer here drifts toward. Default is **seasonal**: `clamp(4 + climate monthly mean × 0.5, 2, 24)`, underwater 5 °C colder (cap 12) — ~5 °C in January, ~15 °C in July |
| `lawless` | surveillance | crimes here raise no heat/wanted |
| `safehouse` | surveillance | launders wanted heat: unseen time bleeds a wanted star 3× as fast as lying low on the street. Pair with `unsurveilled`/`sanctuary` for a true refuge |
| `mining_table_id` | mining | scavenging-table id used for mining here |
| `mis_ok` | mis | zone-gated NPC consent (see `mis_requires_zone_flag`) |
| `no_spawn` | spawning | suppress enemy spawns |
| `open_sky` | flight + environment | outdoor zone aircraft can overfly/land; on an `is_interior`/`is_building` zone (an open roof/deck) it also makes the zone climatically OUTDOORS — sky light, weather, and outdoor temp — while the raw interior flag keeps it in the power/building network (see `isIndoorZone`) |
| `park_feature` | flight | on a `terrain:park` tile, forces which flight-sim park dressing draws (`grove\|pond\|benches\|flowerbeds\|path`) so a park lays out symmetrically; unset → tile position hash. Rides the flight cell as `pf` (live stream + baked snapshot) |
| `prologue` | prologue | part of the prologue instance |
| `radiation` | survival | ambient radiation 0–100 (entry gain `floor(v×0.1)`; ≥25/≥40 floors danger to high/lethal). Replaced the `radiation_level` column (legacy 1–5 values rescaled ×10) |
| `rest_multiplier` | survival/posture | scales both stamina regen and HP knit-back for anyone resting here (`restRegenTick`, gameLoop.js); default 1. Comfort zones raise it — Solenne units 1.5, penthouse 2.0 |
| `sanctuary` | protection/sleep/spawning | civilization carve-out: combat protection (protection substrate — now blocks NPC **and** enemy attacks too, not just player attack/loot/steal/shove; see `enemyAttackPlayer`/`npcAttackPlayer` in `combat.js`), safe sleep, AI safe-flee, no hostile spawns. DELIBERATE — replaced `is_safe_zone`, which was dropped without conversion |
| `scavenging_table_id` | scavenging | loot table for searching here |
| `street_life` | ambience | ambient street-life event pool strength |
| `terrain` | map/minimap/flight | authored ground surface (`water\|road\|asphalt\|concrete\|grass\|park\|dirt\|sand\|gravel\|dock\|scrub\|redrock\|ash\|marsh`; `park` = manicured green w/ its own flight biome; last four = post-apoc wildlands, keep their glyph) — the SSOT `zoneTerrain()` prefers over inference; drives minimap/tablet fills + flight ground tint. Painted in dev panel Maps → Terrain mode. Road tiles auto-tile their connector from adjacent road terrain (`roadConnector` in `world.js`) |
| `unsurveilled` | surveillance | off the Architect's grid — the witness roll (cameras/cops/bystanders) short-circuits to unseen, so no crime is witnessed and no heat earned. The Long Watch bunker uses this |
| ~~`utility_room`~~ | **REMOVED 2026-08-02** | there is no utility-room flag. It was written by `installGenerator` (environment.js) and `tools/lib/utility-room.mjs` and read by **nothing** — 67 tiles asserting a fact no code asked for. What makes a room the junction box's home is the junction box: furniture carrying `generator_id`. Cleared from content + prod by `scripts/strip-dead-zone-flags.mjs` |
| `liquid` | props (preset) | **OVERRIDE of a terrain preset**, `tristate`. You are IN the tile, not ON it — fishing casts into it, the void rim doesn't exist here. Read as `propsOf(id).liquid`, never as a raw flag. Absent on almost every tile BY DESIGN: water presets it |
| `frontage` | props (preset) | **OVERRIDE**, `tristate`. A street a building's front door may face onto — the map builder prefers a neighbour carrying it. Preset by `road` only |
| `speed_mult` | props (preset) | **OVERRIDE**, `number` (not tristate — a number already tells absent from set). Movement pacing; 2 = half the time. Preset by `road`/`dirt_road`. Moved off `spec` 2026-07-30 |
| `swimmable` | props (preset) | **OVERRIDE**, `tristate`. Stamina, wetness, drowning, hypothermia. `false` on a water tile is the frozen bay; `true` on concrete is the flooded basement |
| `routable` | props (preset) | **OVERRIDE**, `tristate`. GPS/pathfinding may cross. Water presets it FALSE — this is what keeps routes off the basin |
| `buildable` | props (preset) | **OVERRIDE**, `tristate`. The dev-panel builder may place/move a building here. Authoring-only |
| ~~`water`~~ | **REMOVED 2026-07-30** | there is no water flag. Water is `flags.terrain = 'water'`, tested `zoneTerrain(zone) === 'water'`. The boolean was migrated away 2026-07-21 but its readers were left behind, so every water check in GPS/pathfinding/building-placement silently passed — routes crossed the basin. Readers converted and the key deleted |
| `world_exit_zone` | movement | exterior seam zone for this building |
| `work_venue` | work | Steady Work shift venue: `{ role, wage, employer?, name?, pool?, boss?, employer_npc?, clock_in_line? }`. `pool` selects the event set (`'diner'` default, `'bar'` = Brawn/Cool-leaning, `'bench'` = Brains-leaning repair-shop work). `boss` names who pays you (defaults 'Gus'); `employer_npc` is an NPC id — finishing a shift raises your standing with them, which discounts what they charge you ([systems-durability.md](systems-durability.md)); `clock_in_line` overrides the zone-event line ( substitutes). Venues: Meltwater Diner, Voltage, Brownout Municipal Turbine Hall (Watts's bench) |
| `work_fence_blacklist` (player) | work | Set `'true'` when a player burns a hot courier run (cracked the parcel). Hides the fence's hot-job dialogue option (`OFFER_COURIER_HOT`) from then on |

## npcs.flags

| key | owner | meaning |
|---|---|---|
| `aa_engineer` | aa-sites | bunker engineer who repairs a strafed AA battery; value = the owning `aa_sites.id` |
| `bank_teller` | atm | a bank counter clerk — `deposit`/`withdraw <amount> from <them>` bypasses the terminal entirely (no cap, no fee, no power gate). Presence alone does NOT lift the cap; they must be addressed |
| `audience_door` | broadcast | studio doorman — while alive, present on the tile outside a channel's `studio_zone_id`, and on shift (08:00–02:00), the way in needs a `custom_data.show_pass` stamped for the showing airing right now. Kill him, wait him out, or catch him off shift and the door is just a door (see [systems-broadcast.md](systems-broadcast.md#studio-audience-door)) |
| `battle_cries` | combat | lines shouted in combat |
| `repairman` | wear | bench repair — standing in this NPC's zone turns `repair <item>` from a capped field patch into full restoration, priced off item value and discounted by your standing with them ([systems-durability.md](systems-durability.md)) |
| `bouncer` | strippers | bouncer NPC — enforces club ejection |
| `bouncer_eject_zone` | strippers | where this bouncer throws you (optional; falls back to a derived zone) |
| `charter_pilot` | flight | offers charter flights |
| `mule_counter` | smuggle | the ground fence's back room — claims the engine purchase-delivery seam, so buying raw off his `shelf: 'back_room'` catalogue books a `smuggle_orders` MULE drop at the Scald instead of handing anything over. Pairs with `trust_flag: 'bm_trust'` + per-entry `min_trust` for the tiers, replacing the old per-raw dialogue fan-out. Sully at the Pigeon Bar |
| `raws_counter` | flight | the raws order counter — `raws` only works while this NPC is alive and in the room, and each order is run out to one of the dead-drop caches ([systems-flight.md](systems-flight.md#raw-drug-dead-drops--the-air-smuggling-run)). Amos Dune at the Layover; a second quartermaster elsewhere is content, not code |
| `clothing_layers` | npc-clothing | descriptive outfit model (see npc-clothing.md) |
| `consort` | consort | a kept companion — stays in their billet until the keeper `beckon`s them |
| `devoted_to` | consort | handle of the keeper this consort is devoted to |
| `consort_archetype` | consort | **which of the 12 sub-personalities they are** (`strategist`, `romantic`, `feral`, `devout`, `brat`, `ghost`, `wit`, `scholar`, `ice`, `starlet`, `soldier`, `stray`). Every spoken line resolves off this — never off the NPC's name |
| `consort_sex` | consort | `female` \| `male` — drives pronoun resolution in every rendered line |
| `consort_pairing` | consort | shared key marking two consorts as an inseparable **pairing** (placed and released together; the only consorts that run two-hander scenes). An authored PAIRINGS key, or a uuid for a B.L.I.S.S. placement |
| `consort_ledger` | consort | set on B.L.I.S.S. placements — marks a live-only consort spawned from `player_consorts` rather than an authored NPC |
| `covert` | vendor/drugwar | covert dealer (passphrase-gated) |
| `deal_from` / `deal_to` | drugwar | dealing hours window |
| `shop_axis` | engine (vendor) | OVERRIDE for which axis this vendor's shelf sections by (`class`/`storage`/`profile`/`slot`). Rarely needed — the axis is chosen from the stock itself, and an axis that splits nothing is ignored anyway. See [reference/item-facets.md](reference/item-facets.md) |
| `drug_buyer` | drugwar | buys drugs from players |
| `food_buyer` | cooking | pays the specialist rate (70% vs 40%) for plated meals, and the quality band scales the payout — a masterful plate is worth ~7.5x a poor one |
| `essential` | — | **no reader.** Nothing checks it; unkillability is `no_attack` (`combat.js:705`). Setting `essential` protects nobody |
| `faction_guard` | — | **no reader.** There is no `factions` plugin (reworked into ideologies) and no code consumes this key, though ~5 content NPCs still carry it |
| `gift_trade` | trade | accepts gifts |
| `haunt_zone` | ai-behaviour | zone a wandering NPC gravitates back to (`haunt_zones` array wins when present) |
| `inner_circle_flag` | vendor | player flag that unlocks inner-circle stock |
| `job_board_dispatcher` | jobboard | quest turn-in dispatcher |
| `mis_requires_zone_flag` | mis | only consents in zones carrying this flag |
| `mis_willing` | mis | consents to MIS interactions |
| `no_attack` / `no_attack_message` | combat | unattackable (+custom refusal line) — `combat.js:705`, the only unkillability seam |
| `no_banter` | npc-banter/gossip | opt this NPC out of ambient banter (dev panel exposes it as a "joins ambient banter" checkbox) |
| `passphrases` | vendor | covert-dealer passphrases |
| `personality` | npc-personality | personality archetype (drives outfit/banter) |
| `purchase_remarks` | commerce | `{ "<item_id>": "line" }` — what this vendor says as you pocket that specific item, in their own voice. For the one thing in their crates that needs explaining (Grady points a fresh deck buyer at his practice rig). Fires **once per player per item**; author `{ "text": "…", "repeat": true }` for every-purchase. Costs nothing unless the item bought has a remark authored |
| `poker_bankroll` / `poker_persona` / `poker_player` | gametable | NPC poker player config |
| `chess_player` / `chess_strength` / `chess_persona` | gametable | NPC chess opponent: summonable at a chess table, and how well they play (`chess_strength` is a `CHESS_PERSONAS` key — `patzer` / `hustler` / `shark`) |
| `police` | jail/surveillance | police unit (arrest powers) |
| `posted` | engine (housing) | **this NPC never goes home — the post IS the life.** Excludes them from the commute build (`scripts/house-posted-npcs.mjs`): no apartment, no derived shift, no `GO_TO_WORK` graph. For fixtures and machines (the Citadel Cashbot, Warden Unit "Threshold"), gate/compound personnel (the South Gate troopers, the Ascendant stronghold cast) and anyone whose workplace is their whole existence. `aa_crew`, `aa_engineer`, `police`, `haunt_zone` and `no_attack` already imply it, so those need nothing extra |
| `preshow_habit` | npc-drugs | DRUG name this NPC self-doses on before a SHOW — one 10% roll ~2 game-hours before curtain (e.g. Akerson's "Neural Overclock"). Plays a multi-beat ritual, then the drug's own effect for 5–6 game hours |
| `preshow_drink` | npc-drugs | the DRINK counterpart to `preshow_habit`, same cadence and its own pouring ritual (Neil Mcmanistan's "embassy reserve"). Always sedated, `neverOut`. **Separate from `preshow_habit` on purpose** — a drink's name is authored flavour and is never in the drugs catalogue, so the drug path would classify whisky as a stimulant |
| `booze_habit` | npc-drugs | drink name for a standing dependency on no schedule but its own (20-min cooldown × 35%/scan). Always sedated, **never** floored — an NPC out cold stops turning up for work |
| `drug_habit` | npc-drugs | drug name for a standing habit, same cadence as `booze_habit` but with the drug's own classified effect (and it *can* put them under). A stimulant comedown sets `ai.crashSleepy`, which sends them to bed early |
| `stripper` | strippers | performs at the club |
| `studio_npc` | broadcast | broadcast-studio actor |
| `table_id` | gametable | which game table the NPC sits at |
| `trust_flag` / `trust_max` / `trust_per_buy` | vendor | per-player trust meter unlocking stock |
| `uses_drugs` | npc-drugs | NPC willingly accepts a drug `slip`-ped to them (addict-economy seam) |
| `card_quote` / `card_note` / `card_rarity` / `card_standing` / `card_exclude` | cards | optional hand-tuning for this NPC's trading card — a spoken line, the prose block, an explicit rank (default is derived from role), the big number, or "never card this row". **All optional**: an NPC with none of them still produces a readable Common, which is what makes full-roster coverage free |

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
| `concealed` | surveillance / concealment | hidden from the room's furniture list entirely (`commands/describe.js`). A planted spy device sets it at plant time; a concealment cabinet flips it on the piece it hides |
| `conceal_hides` / `conceal_code` / `conceal_brand` | concealment | on the DISGUISE piece: the id of the furniture it hides (same zone), the passcode (factory `1234`), and the brand shown on the keypad. While the hidden piece is OUT, the disguise drops from the room list entirely and the revealed piece takes its slot (`standIns` in describe.js) — the fiction has one piece of furniture there, so the room never lists both |
| `conceal_hidden_by` | concealment | on the HIDDEN piece: the id of the disguise that covers it. **Discoverability only** — it's what makes `keypad` advertise itself on the revealed piece (examine's Actions row, the smart bar) once the cabinet has folded away and the pad has nothing else to sit on. Resolution derives the pair from the zone, so a stale or missing back-pointer costs a hint, never access |
| `attached_to` | engine (commands/describe.js) | on a SATELLITE piece: the furniture id it belongs to. The room prints it hanging off that entry (`↳`) instead of listing it separately, and a click goes straight to the satellite's own `use` — a Betamax deck under a television is one appliance in the room's eye but keeps its own row, its own cassettes and its own panel. **A media deck needs no flag** where the room holds exactly one `broadcast_receiver`: the link is derived. Pin it only in a room with two sets. No parent present ⇒ no attachment, and the piece lists itself as before |
| `backstock` | commerce | container id a `vendor_stock` case refills from (stockroom → shop floor) before minting a delivery |
| `backstock_depth` | commerce | on the STOCKROOM container: how many deliveries' worth of each sourced item to keep in reserve, as a multiple of the catalogue entry's `restockToQty` (default 2). Set 0 to leave a back room deliberately bare |
| `checkout` | commerce | vendor id whose till this counter is — enables `checkout` here |
| `container` | inventory | holds items |
| `corp_poster` / `hero_poster` / `poster_key` | corps/events | wall poster identity |
| `compartment_of` / `compartment_label` / `compartment_index` | engine (commands/inventory.js) | **one piece of furniture that stores things in more than one place** — a cabinet with three shelves, a desk with drawers. Each compartment is a whole `object_type: 'container'` row of its own (own name, own `container` capacity, own contents), so every storage path treats it as the ordinary container it is; `compartment_of` names the PARENT furniture id and buys exactly three things: tabs in the container panel, ONE entry in the room description (`subBoxIds` in describe.js), and a shelf list on `look in`. The parent needs no flag and always leads. `compartment_label` is the tab text (falls back to the row's name), `compartment_index` orders the shelves (falls back to name order). A compartment keeps whatever else it wants — give every shelf `dish_cabinet` and the kitchen finds a pot on any of them. Generalises `paired_container` past two and past temperature |
| `cosmetic_machine` | appearance | morphex/biosculpt station |
| `crafting_station` | crafting | crafting station |
| `deck_active` / `deck_cassettes` / `deck_ejected_slots` | broadcast | media deck state |
| `deck_cam_source` | broadcast | on a `mini_deck` only: the SPECTER camera patched into its spare input instead of a tape — `{ deviceId, label, zoneId }`. Exclusive with `deck_active`; cleared lazily when the camera dies. See [systems-broadcast.md](systems-broadcast.md) |
| `emergency_deck` | broadcast | the Echelon's emergency MediaDeck — overrides every tuned TV in the city |
| `tuned_channel` | broadcast | channel **number** a TV/receiver is tuned to (joined against `media_channels.number`) — distinct from `channel_id` |
| `charge_sheet` | jail | the booking form clipped to the cell bars — `read <sheet>` prints the reader's own detention record (charge, stars, time remaining, held property) |
| `destructible` | combat | can be attacked (uses hp/hp_max) |
| `device_id` | surveillance | security_devices row this furniture mirrors |
| `game_table_id` | gametable | game_tables row (poker) |
| `generator_id` | power | generators row this furniture mirrors. Auto-built junction boxes use a **deterministic** id `gen_<zoneId>` (converges on re-run; see `installGenerator` in environment.js); city plants and player units (`pgen_<uuid>`) do not. |
| `hack_difficulty` | hacking | difficulty to hack this object. The deck's own `tags.hack_penalty` is added on top at arm time (`server/engine/hack-gear.js`) — a junk deck reads every target harder |
| `hack_rig` | hackrig | practice lock rig: a legal, low-difficulty `hack` target with nothing behind it. No credits, no crime, no shock, and a failure still burns deck condition. Scores on the shared skill-vs-difficulty margin like every other hack target, so it teaches a beginner brilliantly and a professional nothing — the rig retires itself around Hacking 3–4. Defaults to `hack_difficulty` 2 |
| `interactions` | engine (tags.js) | verb list surfaced as tags (`['switch','sit']`) |
| `is_light` / `light_type` | environment | legacy light markers (see furniture columns) |
| `job_board` | jobboard | job board |
| `junction_box` | power | junction-box housing |
| `media_deck` | broadcast | cassette deck |
| `police_terminal` | jail | police booking terminal |
| `prologue_holosign` | prologue | prologue set dressing (the `use` `requiredTag`). Sibling `prologue_chair` is authored but **has no reader** |
| `requires_demolition` | — | **no reader.** Demolition gating is not a flag: it comes from `DEVICE_SPECS[furniture.object_type].requiresDemolition` (`commands/infrastructure.js:23-25,56`). Setting this key gates nothing |
| `restock_items` | consort | item ids this furniture restocks (the Echelon bar's bottle shelf) |
| `seat_idx` | gametable | seat number at a table |
| `security_device` | surveillance | is a plantable security device |
| `slot_machine` / `slot_min` / `slot_max` / `slot_default` | slots | slot machine + its bet bounds/default (targeted by `spin`) |
| `station_quality` | crafting | crafting station quality |
| `teleporter` / `teleport_target` | yacht | hidden furniture linking two zones; `teleport_target` is the destination zone id |
| `trash_bin` | scavenging | searchable trash |
| `tv` / `tv_dial_freq` / `tv_skin` | broadcast | television set config |
| `vends` / `vend_line` / `vend_cooldown_s` | vending | dispenser machine: item id to dispense (required), flavour line, per-machine throttle in seconds (default 20; 0 = off) |
| `vends_packs` | cards | card-pack machine (value = series number). Its FACE is the vending-cabinet panel, opened by the click (`click_cmd: buypack`); `examine` leaves one line and the way in rather than drawing the cabinet a second time in the log. Author with `power_draw_kw` so a blackout takes it dark |
| `card_mint` | cards | mint terminal — `mint` previews here for free and strikes for ₵2,500; `scrap` eats duplicates here too |
| `fuel_source` | fillable | a fuel point in this zone that `fill` draws from |
| `click_cmd` | describe (engine) | the command this piece's CLICK sends, instead of `examine`. For a thing with a face — a card machine, a mint terminal — so clicking it opens that face rather than dumping cabinet art into the log. The verb runs through the ordinary dispatcher and re-checks everything it always did |
| `woven` | describe (engine) | fold this furniture into the room prose instead of listing it separately (the LIVE tier) |
| `notable` | describe (engine) | force this piece to stay in the `Furniture:` list even when the classifier would demote it to the scenery clause. The override for a stub-described prop that actually matters |
| `mundane` | describe (engine) | force this piece into the trailing scenery clause even when it affords verbs. The opposite override; wins over `notable` |
| `vendor_npc_id` | vendor | vendor NPC whose shop this furniture belongs to |
| `shop_unpaid` | storefront | *(player_inventory custom_data)* the shop zone this row was lifted from and not yet paid for; `buyware` clears it, carrying it out of the shop is `shoplifting` |
| `shop_display` | storefront | marks the display counter in a player-owned shop. Prose/affordance anchor only — listings are zone-scoped, not stored in this piece |
| `shop_vault` | storefront | holds a player-owned shop's till; `hack`able via VAULT CRACK (`hack_difficulty`, default 6) |
| `vendor_safe` | vendor-safe | crackable vendor safe / shop till. `vendor_npc_id` names the OWNER, and the owner's `vendor_credits` IS the money in the box |
| `vendor_staff` | vendor-safe | optional array of other NPC ids who draw wages from the same box — a shop that is more than one person keeps one till, not one each (Ration Nine: three workers, one cashbox). Owner takes 25% per collection, a staff member 10%, both out of the owner's `vendor_credits` |
| `vendor_schedule_board` | vendor | shop-hours board |
| `vendor_stock` | commerce | vendor id owning this container's contents — a self-service display case. Goods pulled out are marked `custom_data.unpaid` until `checkout`; carrying them out of the shop is `shoplifting` |
| `wardrobe` | wardrobe | this container opens the wardrobe/outfits panel (pair with `container`) |
| `lending_terminal` | library | `scan` here unlocks the tablet's LIBRARY app (`library_unlocked` flag) and prints the one-time intro; examining it teaches the verb ([systems-library.md](systems-library.md)) |
| `cleaning_tool` | cleaning | a fixed sink/basin — `clean`/`mop` in this room clears the whole floor rather than one patch. Also valid as an **item** tag ([systems-cleaning.md](systems-cleaning.md)) |
| `water_source` | water plugin | drink/wash here |
