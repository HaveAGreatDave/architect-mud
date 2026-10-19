# The Fish Works *(as built)*

**Status: BUILT.** The Codfather turned from a fishmonger's shop into the works where Coldwater's
fish is landed and cut, with Batter Days Fish & Chips moved onto its front. Six tiles changed, one
NPC flag and one item tag were added, and five GLASS arms were written or reworked.

Built 2026-10-18. Script: `node scripts/content/fish-works.mjs [--dry-run]`. It supersedes
`scripts/content/batter-days.mjs`, which built the shop on Ironside Street and was deleted.

## 1. The six tiles

| tile | what | type | map |
|---|---|---|---|
| 903,904 | **The Fish Quay**: timber on piles over the water, two berths | `fish_quay` (not a building) | |
| 903,905 | **The Codfather**: the works. Staff door east onto the car park, no sign | `fish_works` | `FM` |
| 904,905 | **Staff Car Park**, where Slag & Wares stood | plain tarmac for now (see §5) | |
| 902,905 | **Slag & Wares**, moved one tile west onto Cinder Yard | `junkyard` | `SW` |
| 903,906 | **Batter Days Fish & Chips**, door south onto Greenside Row | `chip_shop` | `BT` |
| 918,907 | **Unit 5, Ironside Street**: Batter Days' old unit, boarded up and to let | `shop` | `I5` |

⚠ **The works has no front door.** Batter Days stands on what was its street (Filament Yard), so its
one street door is the staff door onto the car park. Players can walk in that way, off the quay
through the roller door, or through the swing door at the back of the chip shop's prep room.

⚠ **The quay is painted water and standable**, the Inner Stage's four flags (`pier`,
`liquid: false`, `swimmable: false`, `routable`). It carries `marina_berths: 2` and Moor or Less's
`yard_rate: 0.6`, so a boat can tie up there today. The fishing boats will use the same berths.

## 2. Inside

| id | room | reached from |
|---|---|---|
| `zone_codfather_slab` | The Cutting Floor (entry) | the staff door; the Batter Days prep room, south |
| `zone_codfather_weigh` | The Landing Hall: the scale, the drawer, Fawle | slab north; the quay, through the roller door |
| `zone_codfather_ice` | The Cold Store | slab west |
| `zone_util_zone_codfather_slab` | The Plant Room, the icemaker and the junction box | slab down |
| `zone_batter_shop` | The Shop (entry) | the front door |
| `zone_batter_prep` | The Prep Room, with the city's only public smoker and charcoal grill | shop north |
| `zone_batter_tables` | The Tables, the picnic tables under the awnings | shop east |
| `zone_util_zone_batter_shop` | The Cellar | shop down |
| `zone_sf_ironside5_shop` | Unit 5's empty shop, a storefront unit | the front shutter |

The rooms of both buildings kept their ids. Their exits are cleared before `authorBuilding` runs,
because it merges a room's exits and a moved room would keep its way back to the old tile.

⚠ **The two links between buildings are written after both `authorBuilding` calls**
(`conn_hf_batter_prep_north`, `conn_hf_codfather_weigh_north`), for the Palais's reason: the
utility-room helper walks exits to decide what its junction box feeds, and with the link in place
either box would claim both buildings. The two buildings keep separate junction boxes.

## 3. Selling fish

Ignatius Fawle works the weigh-in (`work_zone_id: zone_codfather_weigh`) and carries
`flags.fish_buyer`. A vendor with it pays the specialist rate, 70% of value instead of the usual
40%, for anything tagged `raw_fish`. It's the same lever as `bounty_buyer` with `vermin_part`
(`computeSellUnitPrice` in `server/engine/vendor.js`).

The seven catches on the two fishing tables carry `raw_fish`: carp (`item_fresh_catch`), sludge
carp, razorgill, irontooth bass, ashen pike, coldwater sturgeon and glass eel. **A new catch needs
the tag**, or the fishmonger buys it at the ordinary rate.

He still sells his four lines (fillet, shellfish, smoked fish, roe). His dialogue has a "fish to
sell" branch that explains the verb.

## 4. Unit 5, Ironside Street

A storefront unit on the pattern of Unit 4, Marrow Street: `is_storefront`, 6,500 over ten
instalments, 45 upkeep, a display counter and a wall safe. The deed is player data and never in a
content file. Its interior is new (`zone_sf_ironside5_shop`), because Batter Days took its old
rooms with it.

## 5. GLASS

| arm | file | registry |
|---|---|---|
| `fishworks` | `glass/models/old-coldwater.js` | named `thecodfather`, type `fish_works`, both `noKit` |
| `fish_quay` | `glass/models/old-coldwater.js` | type `fish_quay` |
| `chippy` (rewritten) | `glass/models/twin-pass.js` | named `batterdaysfishchips` |
| `ironsideunit` (the old `chippy` shell) | `glass/models/twin-pass.js` | named `unit5ironsidestreet`, `noKit` |

- **The works** is galvanised corrugated sheet (`ty_fw_tin`) under a stepped roof, with two
  condensers and the icemaker's vent on the roof. The quay face has a roller door, up, with a hoist
  beam over it. The car park face has the steel staff door with a bulkhead lamp, a hose reel, fish
  boxes and the one frosted strip window. There is no lettering anywhere: `noKit` keeps the kit's
  boards and trade words off it.
- **Batter Days** is harbour-blue render (`ty_bd_blue`) with a navy plinth, coping and fascia, the
  name in orange on the fascia, orange awnings on the front and down the Filament Yard side with a
  cream valance, four picnic tables, the orange tin fish on a bracket, an A-board and a bin.
- ⚠ **The two buildings meet on the plot line in tile units.** The works' south wall and the
  shop's back wall are both placed at `TILE_REACH`, never in `fh`, because each tile rolls its own
  `fh` and two walls at `0.9 fh` leave a seeded gap. The capture reports these as absolute terms.
  The works is a taller type (`fish_works` h 0.15 against `chip_shop` 0.11), so from Greenside Row
  the shop reads as the front of the shed.
- ⚠ **The shop's name is painted on its fascia, not drawn with `marqueeBand`.** That helper stands
  its band off the frontmost face of the model, which here is the awning lip, so the band floated
  in front of the awnings and hid the shopfront.
- **Unit 5** keeps the brick-and-slate shell, with the window and door boarded in ply
  (`ty_unit_ply`), a padlock, a letting notice, a cold flue, the pan hooks, and the empty bracket
  where the tin fish hung. Its fascia still letters the tile's name, so a renamed shop shows there.
- **The car park has no model yet.** It's meant to be drawn by the `car_park` arm in
  `glass/models/greenside.js` (painted bays, kerbs, a lamp, parked cars), which isn't on main. When it
  lands, the tile takes `building_type: 'staff_lot'` and `staff_lot` gets the same rows as `car_park`
  (TYPE_MODEL, NO_KIT, TYPE_FLOORS, BLDG_TYPE_3D). Until then it draws as plain tarmac.
- The map icon for `fish_works` is `bldg_fishworks.svg`, a fish over a stack of boxes. The quay and
  the car park aren't facades, so they take no icon.

## 6. What isn't built

- **The fishing boats.** The quay's two berths take any hull today. Nothing reserves them for a
  fishing boat, and nothing lands a catch from one.
- **The works' crews are prose.** The cutting floor and the landing hall describe workers and boat
  crews; the only NPC there is Fawle.
- **Fawle doesn't supply Gil.** Gil's fish still comes from nowhere, and nothing moves stock between
  the two vendors. Hot food still doesn't go cold.

## 7. Deploying

The import's deletion pass drops the five old connection files on deploy. Lights import off
(`light_on` is a runtime column), so on prod run
`node --env-file=.env.prod scripts/content/seed-runtime.mjs` once after the deploy.
