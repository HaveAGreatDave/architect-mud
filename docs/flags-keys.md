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
| `airfield_charter` | flight | an NPC charter pilot flies you somewhere (needs a `charter_pilot` NPC assigned to this field) |
| `airfield_rental` | flight | self-fly rental desk (`rent`). **Independent of `airfield_charter`** — a field can offer the NPC ride without a hire counter (Buzzard Field) |
| `charter_vtol_only` | flight | charter pad is VTOL Dragonfly-only, off-airfield drops, no rental desk (Echelon helipad) |
| `airfield_vtol_only` | flight | helipad — buy/rent/charter restricted to VTOL/rotorcraft; fixed-wings hidden from every roster (Threshold Helipad) |
| `airfield_residents_only` | flight | a PRIVATE field: set to a building name, only that building's residents resolve a field here at all (`fieldFor` → null for everyone else — no bay, no hangar rent/store, no fuel). Solenne Sky Pad |
| `residents_only` | residency | interior tile only enterable by a player holding a unit in the named building — walked in OR ridden to by lift (the lift runs the gate chain too) |
| `residents_only_deny` | residency | optional refusal line for `residents_only`, in the building's voice |
| `private_billet_owner` | consort | handle of the player who **holds** this zone as a private space. Makes a bespoke room (a yacht boudoir, a safehouse) a legal B.L.I.S.S. delivery address without the consort plugin having to know what a yacht is — apartments you control and premises you own already qualify without this |
| `yacht` / `echelon` | yacht | marks an Echelon zone (the yacht) |
| `echelon_bridge` | yacht | the bridge — every `helm`/`sail`/`stop`/`dock` verb gates on this flag |
| `echelon_suite` | yacht/consort | Cyd's private quarters — owner-gated behind the suite hatch; hosts the MIS-gated dancers |
| `echelon_sundeck` | consort | open-air top-deck lounge (jacuzzi); beckoned consorts suntan/soak/lounge here |
| `echelon_view` | consort | a deck you can LOOK out across the Basin from (stern lounge, stair landing) |
| `echelon_helipad` | consort/flight | stern landing pad — a VTOL Dragonfly can set down here to embark/disembark |
| `echelon_broadcast` | broadcast | lower-deck studio housing the emergency MediaDeck that overrides every tuned TV in the city |
| `engine_ambience` | movement (client yacht-ambience) | engine-room rumble plays here, swelling while she makes way (`yacht_underway`) |
| `heading` | yacht | **RUNTIME-only**: the vessel's last steered course in degrees (0=N). Injected onto the live Echelon exterior zone from the persisted world flag — never authored in content; catalogued so it survives the zone-flags sweep |
| `vessel` | movement | this water tile is a boat you can embark/disembark from the water (needs an `in` exit to the vessel interior) |
| `naval_ambience` | yacht | naval ambient-event pool (Echelon exterior) |
| `pier` | terrain | pier tile → inferred `dock` surface by `zoneTerrain()` when no authored `terrain` |
| `airfield_dealer` | flight | aircraft dealer here |
| `airfield_fuel` | flight | fuel vendor here |
| `airfield_fuels` | flight | fuel price/stock config |
| `airfield_id` | flight | which airfield this zone belongs to |
| `airfield_lawless` | flight | airfield outside city law |
| `airfield_name` | flight | display name of the airfield |
| `airfield_surface` | flight | runway surface flavour for a rough strip (e.g. `dust` for a packed-dirt frontier field) |
| `airfield_theme` | flight (zone-planner) | overrides the airport backdrop painted out the canopy (`city\|docks\|yards\|slag\|wastes\|default`); inferred from the zone id when unset |
| `runway` | flight (zone-planner) | runway tile: `ns`/`ew` is the centreline orientation the flight sim aligns its drawn runway to; `pad` is the surrounding asphalt |
| `aircraft_cabin` | flight | interior cabin room of a **walkable** aircraft; value = the craft-type id (e.g. `leviathan`). Binds these coordinate-free rooms to the live aircraft; the move gate seals world exits while airborne |
| `cabin_entry` | flight | the cabin room boarders arrive in (and are set down near on deplane). One per cabin; mirrors the cabin map's `entry_zone_id` |
| `cabin_window` | flight | cabin room with windows — `window` opens the through-hull moving-world view from here |
| `flightdeck` | flight | cockpit room of a walkable aircraft: home of TAKE CONTROLS / HAND OFF and the NAV console |
| `home_slots` | flight | authored decor anchors a walkable-base room offers, each `{ id, kind, label }`. The shell defines the anchors; per-owner choices are runtime overlays (`custom_data.home.slots`), never zone edits |
| `aa_site` | aa-sites | this surface tile is an AA emplacement's exposed gun deck — drives the map AA POI (`⌖` / "AA battery") |
| `aa_bunker` | — | **no reader.** Catalogued and authored on bunker zones, but nothing consumes it: the aa-sites repair loop finds its engineer by the NPC's `flags.aa_engineer` instead. Don't gate new behaviour on it without wiring it first |
| `airspace_restricted` | flight | AA-gated airspace over this zone |
| `always_lit` | environment | never dark regardless of power/time |
| `light_beacon` | environment | floods this tile + its 8 grid-neighbours to full brightness, overriding night/power/weather |
| `allow_sleep` | protection/sleep | permit `sleep` here WITHOUT the sanctuary bundle — safe-zone-rate rest, but no combat protection/forcefield/spawn suppression (e.g. the Precinct 9 holding cell) |
| `artery` | movement/ambience | major street (traffic ambience, routing) |
| `cell_block` | jail | room behind the Precinct 9 cell door a prisoner may walk to without it counting as a jailbreak (Wash Block, The Pit). The cell itself is the plugin's `CELL_ZONE` and needs no flag; a room that reaches the street must never carry this |
| `building_name` | world | display name of the enclosing building |
| `building_type` | world | building category (shop, apartment, …) |
| `checkpoint_cfg` | checkpoint | security-checkpoint config object ({ guards, checks:[wanted\|smuggle\|contraband], wantedMode, entry predicate insideFlag\|fromFlag\|fromDistrict }) driving the checkpoint move-gate law |
| `curtain` | engine minimap + flight | tile borders the Architect's energy wall on the city's land edge; renders a minimap shimmer-edge + a room-description curtain line; stays sealed (no crossing exit) except at a `perimeter_gate`. There is no `perimeter` plugin — the engine whitelists these three into the map payload (`world.js:928`, `commands/movement.js:778`) and `plugins/flight/state.js:574` renders the wall |
| `perimeter_gate` | engine minimap + flight | the one break in the Curtain — the guarded road out to the wilds; draws a gate glyph and carries the exit through the wall |
| `glacis` | engine minimap + flight; checkpoint | outward-facing turret killing-ground just beyond a `perimeter_gate`. Also usable as a `checkpoint_cfg.fromFlag` predicate |
| `ascendant_campus` | ascendant | world tile is part of the Ascendant stronghold campus (western frontier) — ambience + faction framing |
| `ascension_gate` | ascendant | the gated entrance tile into the Ascendant campus |
| `ascendant_inner` | ascendant | the Spire sanctum — deepest Ascendant interior, reserved for the highest standing |
| `ascendant_registry` | augments | the Vats registry desk — intake/enrolment room |
| `ascendant_vats` | augments | the cloning/regrowth hall within The Vats |
| `augment_clinic` | augments | room where cybernetic augments can be installed (Chrome Clinic) |
| `assurance_policy` | augments | desk selling prepaid cortical-backup restores (the secret Halcyon front); enables the `policy` verb |
| `architect_uplink` | — | **no reader.** The Architect Shrine uplink chamber; catalogued and authored, but nothing gates on it yet |
| `claimable` | corps | territory override: force claimable (absent = derived from inferred danger) |
| `claimable_asset` | corps | this building is a claimable corporate income asset (Corporate Assets Phase A); `corps/ventures.js` reads it for `corp asset claim` |
| `danger` | danger | manual danger override (`safe/low/medium/high/lethal`) — normally inferred from spawns + radiation (`engine/danger.js`) |
| `district` | districts | override the id-prefix-derived district key (`engine/districts.js`) |
| `elevator` | movement | elevator car zone |
| `facade` | movement | OPT-IN non-standable building tile: auto-forwards into the interior map's entry zone; OUT lands on `world_exit_zone` (needs a maps row with `parent_zone_id` = this zone) |
| `elevator_floors` | movement | floor list for the elevator (Floor 1 / lobby is implicit — synthesized from the car's `out` exit) |
| `hide_exits` | describe (engine) | suppress the player-facing exit/room/building list in the room description; graph (movement, NPC pathfinding, minimap) is untouched. Used by elevator cars so the floor panel is the sole exit UI |
| `fishing_table_id` | fishing | scavenging-table id used for fishing here |
| `gov_checkpoint` | — | **no reader.** There is no `govgate` plugin; checkpoints are configured entirely through `checkpoint_cfg` |
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
| `underwater` | swimming | submerged tile below a surface water tile (link up/down). Always submerged (a boat doesn't help), colder and dark; starts the breath timer that drowns you |
| `water_temp_c` | swimming | override the temperature a submerged swimmer here drifts toward (default 12 °C surface / 7 °C underwater) |
| `lawless` | surveillance | crimes here raise no heat/wanted |
| `safehouse` | surveillance | launders wanted heat: unseen time bleeds a wanted star 3× as fast as lying low on the street. Pair with `unsurveilled`/`sanctuary` for a true refuge |
| `mining_table_id` | mining | scavenging-table id used for mining here |
| `mis_ok` | mis | zone-gated NPC consent (see `mis_requires_zone_flag`) |
| `no_spawn` | spawning | suppress enemy spawns |
| `open_sky` | flight + environment | outdoor zone aircraft can overfly/land; on an `is_interior`/`is_building` zone (an open roof/deck) it also makes the zone climatically OUTDOORS — sky light, weather, and outdoor temp — while the raw interior flag keeps it in the power/building network (see `isIndoorZone`) |
| `park_feature` | flight | on a `terrain:park` tile, forces which flight-sim park dressing draws (`grove\|pond\|benches\|flowerbeds\|path`) so a park lays out symmetrically; unset → tile position hash. Rides the flight cell as `pf` (live stream + baked snapshot) |
| `planner` | zone-planner | provenance: blueprint id that generated this zone (tools/zone-planner) |
| `prologue` | prologue | part of the prologue instance |
| `radiation` | survival | ambient radiation 0–100 (entry gain `floor(v×0.1)`; ≥25/≥40 floors danger to high/lethal). Replaced the `radiation_level` column (legacy 1–5 values rescaled ×10) |
| `rest_multiplier` | survival/posture | scales both stamina regen and HP knit-back for anyone resting here (`restRegenTick`, gameLoop.js); default 1. Comfort zones raise it — Solenne units 1.5, penthouse 2.0 |
| `sanctuary` | protection/sleep/spawning | civilization carve-out: combat protection (protection substrate — now blocks NPC **and** enemy attacks too, not just player attack/loot/steal/shove; see `enemyAttackPlayer`/`npcAttackPlayer` in `combat.js`), safe sleep, AI safe-flee, no hostile spawns. DELIBERATE — replaced `is_safe_zone`, which was dropped without conversion |
| `scavenging_table_id` | scavenging | loot table for searching here |
| `street_life` | ambience | ambient street-life event pool strength |
| `terrain` | map/minimap/flight | authored ground surface (`water\|road\|asphalt\|concrete\|grass\|park\|dirt\|sand\|gravel\|dock\|scrub\|redrock\|ash\|marsh`; `park` = manicured green w/ its own flight biome; last four = post-apoc wildlands, keep their glyph) — the SSOT `zoneTerrain()` prefers over inference; drives minimap/tablet fills + flight ground tint. Painted in dev panel Maps → Terrain mode. Road tiles auto-tile their connector from adjacent road terrain (`roadConnector` in `world.js`) |
| `unsurveilled` | surveillance | off the Architect's grid — the witness roll (cameras/cops/bystanders) short-circuits to unseen, so no crime is witnessed and no heat earned. The Long Watch bunker uses this |
| `utility_room` | power | building utility room (junction box lives here) |
| `water` | movement | water zone (needs a `boat`-tagged item) |
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
| `clothing_layers` | npc-clothing | descriptive outfit model (see npc-clothing.md) |
| `consort` | consort | a kept companion — stays in their billet until the keeper `beckon`s them |
| `devoted_to` | consort | handle of the keeper this consort is devoted to |
| `consort_archetype` | consort | **which of the 12 sub-personalities they are** (`strategist`, `romantic`, `feral`, `devout`, `brat`, `ghost`, `wit`, `scholar`, `ice`, `starlet`, `soldier`, `stray`). Every spoken line resolves off this — never off the NPC's name |
| `consort_sex` | consort | `female` \| `male` — drives pronoun resolution in every rendered line |
| `consort_pairing` | consort | shared key marking two consorts as an inseparable **pairing** (placed and released together; the only consorts that run two-hander scenes). An authored PAIRINGS key, or a uuid for a B.L.I.S.S. placement |
| `consort_ledger` | consort | set on B.L.I.S.S. placements — marks a live-only consort spawned from `player_consorts` rather than an authored NPC |
| `covert` | vendor/drugwar | covert dealer (passphrase-gated) |
| `deal_from` / `deal_to` | drugwar | dealing hours window |
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
| `police` | jail/surveillance | police unit (arrest powers) |
| `preshow_habit` | npc-drugs | drug name this NPC rarely self-doses on at home when watched (e.g. Akerson's "Neural Overclock" pre-show ritual) |
| `stripper` | strippers | performs at the club |
| `studio_npc` | broadcast | broadcast-studio actor |
| `table_id` | gametable | which game table the NPC sits at |
| `trust_flag` / `trust_max` / `trust_per_buy` | vendor | per-player trust meter unlocking stock |
| `uses_drugs` | npc-drugs | NPC willingly accepts a drug `slip`-ped to them (addict-economy seam) |

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
| `backstock` | commerce | container id a `vendor_stock` case refills from (stockroom → shop floor) before minting a delivery |
| `checkout` | commerce | vendor id whose till this counter is — enables `checkout` here |
| `container` | inventory | holds items |
| `corp_poster` / `hero_poster` / `poster_key` | corps/events | wall poster identity |
| `cosmetic_machine` | appearance | morphex/biosculpt station |
| `crafting_station` | crafting | crafting station |
| `deck_active` / `deck_cassettes` / `deck_ejected_slots` | broadcast | media deck state |
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
| `fuel_source` | fillable | a fuel point in this zone that `fill` draws from |
| `woven` | describe (engine) | fold this furniture into the room prose instead of listing it separately |
| `vendor_npc_id` | vendor | vendor NPC whose shop this furniture belongs to |
| `shop_unpaid` | storefront | *(player_inventory custom_data)* the shop zone this row was lifted from and not yet paid for; `buyware` clears it, carrying it out of the shop is `shoplifting` |
| `shop_display` | storefront | marks the display counter in a player-owned shop. Prose/affordance anchor only — listings are zone-scoped, not stored in this piece |
| `shop_vault` | storefront | holds a player-owned shop's till; `hack`able via VAULT CRACK (`hack_difficulty`, default 6) |
| `vendor_safe` | vendor-safe | crackable vendor safe |
| `vendor_schedule_board` | vendor | shop-hours board |
| `vendor_stock` | commerce | vendor id owning this container's contents — a self-service display case. Goods pulled out are marked `custom_data.unpaid` until `checkout`; carrying them out of the shop is `shoplifting` |
| `wardrobe` | wardrobe | this container opens the wardrobe/outfits panel (pair with `container`) |
| `water_source` | water plugin | drink/wash here |
