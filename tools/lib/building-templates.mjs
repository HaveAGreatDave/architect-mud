// Templated interiors for the dev-panel "New Building" generator (apiBuildBuilding
// in server/api/routes.js). Each building_type maps to a small blueprint: a lobby
// (the entry room), zero or more extra rooms wired off it, some thematic furniture,
// and an optional inhabitant NPC. The route stamps the facade + interior map + power
// (authorUtilityRoom) around this; templates only describe the rooms/props/people.
//
// This is authoring scaffolding, NOT engine
// content — it lives in tools/ so the engine stays content-free. Types without a
// bespoke entry fall back to GENERIC. Furniture object_type must be one of the valid
// kinds (furniture/light/fixture/appliance/decoration/terminal/container); NPC
// `personality` must be a key in server/engine/npc-personality.js.
//
// Room `dir` is the compass exit FROM the lobby to that room (reciprocal wired by the
// route). Keep interiors small — 1–3 rooms; the generator is a starting shell the dev
// then furnishes, not a finished venue.

// building_type synonyms → the canonical template key.
export const TEMPLATE_SYNONYMS = {
  store: 'shop', grocery: 'shop', boutique: 'shop',
  nightclub: 'club', club: 'bar',
  container_yard: 'warehouse', cold_storage: 'warehouse', fuel_yard: 'warehouse',
  fabrication: 'warehouse', wharf: 'warehouse', freight_office: 'corporate_office',
  freight_forwarder: 'corporate_office',
  corporate_office: 'office',
};

// Every entry: { facadeName?, lobbyName, lobbyDesc, rooms:[{key,name,desc,dir}],
//                furniture:[{room,name,desc,object_type}], npc?:{room,name,personality,description} }
export const BUILDING_TEMPLATES = {
  shop: {
    facadeName: 'Corner Store',
    lobbyName: 'Shop Floor', lobbyDesc: 'Shelving crowds a narrow floor, stacked with whatever moves. A service counter guards the till at the back.',
    rooms: [{ key: 'back', name: 'Stockroom', desc: 'Boxes to the ceiling and the sour smell of cardboard. The overflow that never fits out front.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'the service counter', desc: 'A scuffed counter with a bolted-down till.', object_type: 'fixture' },
      { room: 'lobby', name: 'a display shelf', desc: 'Metal shelving picked half-bare.', object_type: 'fixture' },
      { room: 'back', name: 'a stockroom rack', desc: 'Industrial shelving sagging under crates.', object_type: 'container' },
    ],
    npc: { room: 'lobby', name: 'the shopkeeper', personality: 'vendor', description: 'A tired clerk who has seen every kind of customer and trusts none of them.' },
  },
  bar: {
    facadeName: 'The Watering Hole',
    lobbyName: 'Barroom', lobbyDesc: 'Low light, sticky floor, a long bar down one wall. Somewhere a speaker rattles out something you half-recognise.',
    rooms: [{ key: 'store', name: 'Cellar', desc: 'Kegs and crates in the cool dark, the smell of yeast and spilled liquor.', dir: 'down' }],
    furniture: [
      { room: 'lobby', name: 'the bar', desc: 'A long slab of scarred hardwood, bottles ranked behind it.', object_type: 'fixture' },
      { room: 'lobby', name: 'a bar stool', desc: 'A wobbling stool bolted to the floor.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'lobby', name: 'a corner booth', desc: 'Cracked vinyl seating around a small table.', object_type: 'furniture', interactions: ['sit'] },
    ],
    npc: { room: 'lobby', name: 'the bartender', personality: 'bartender', description: 'Pours with one eye on the door, wiping the same glass over and over.' },
  },
  clinic: {
    facadeName: 'Street Clinic',
    lobbyName: 'Waiting Room', lobbyDesc: 'Hard plastic chairs bolted in rows under a flickering sign. Everything smells of disinfectant over something worse.',
    rooms: [{ key: 'exam', name: 'Exam Room', desc: 'A vinyl table, a tray of instruments, a sharps bin overflowing. Privacy is a paper curtain.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'a row of waiting chairs', desc: 'Cracked plastic seats worn shiny.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'exam', name: 'an exam table', desc: 'A padded vinyl table under a bright lamp.', object_type: 'fixture' },
      { room: 'exam', name: 'a supply cabinet', desc: 'A glass-fronted cabinet of gauze and vials.', object_type: 'container' },
    ],
    npc: { room: 'exam', name: 'the clinic doctor', personality: 'doctor', description: 'Steady hands, dead eyes — patches you up and asks no questions worth answering.' },
  },
  diner: {
    facadeName: 'All-Night Diner',
    lobbyName: 'Dining Floor', lobbyDesc: 'A counter with fixed stools, a row of booths, and a griddle hissing behind the pass. The coffee is always on.',
    rooms: [{ key: 'kitchen', name: 'Kitchen', desc: 'Steel surfaces, a flat-top griddle, and grease baked into every seam.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'the diner counter', desc: 'A long formica counter lined with fixed stools.', object_type: 'fixture' },
      { room: 'lobby', name: 'a window booth', desc: 'A booth with a view of the street and a laminated menu.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'kitchen', name: 'the griddle', desc: 'A flat-top griddle glazed with decades of grease.', object_type: 'appliance' },
    ],
    npc: { room: 'lobby', name: 'the short-order cook', personality: 'vendor', description: 'Works the griddle and the till both, and never stops moving.' },
  },
  gun_shop: {
    facadeName: 'Arms Dealer',
    lobbyName: 'Gun Counter', lobbyDesc: 'Locked cases line the walls, iron behind glass. A heavy counter and a heavier clerk stand between you and the merchandise.',
    rooms: [{ key: 'range', name: 'Back Range', desc: 'A short indoor lane down to a bullet-chewed backstop. Ear protection hangs on a nail.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'a locked display case', desc: 'Reinforced glass over racked weapons.', object_type: 'container' },
      { room: 'lobby', name: 'the gun counter', desc: 'A steel-topped counter, scarred and solid.', object_type: 'fixture' },
    ],
    npc: { room: 'lobby', name: 'the arms dealer', personality: 'vendor', description: 'Weighs every buyer with a gunsmith’s flat, appraising stare.' },
  },
  casino: {
    facadeName: 'Casino',
    lobbyName: 'Gaming Floor', lobbyDesc: 'Cheap carpet, cheaper lights, the endless chime of machines that never quite pay out. Cameras track every hand.',
    rooms: [{ key: 'cage', name: 'The Cage', desc: 'A barred window where chips become credits, watched by more cameras than the vault.', dir: 'east' }],
    furniture: [
      { room: 'lobby', name: 'a slot machine', desc: 'A garish cabinet spinning fruit and static.', object_type: 'terminal' },
      { room: 'lobby', name: 'a felt gaming table', desc: 'Green felt worn pale where a thousand hands have rested.', object_type: 'furniture' },
    ],
    npc: { room: 'cage', name: 'the cage cashier', personality: 'vendor', description: 'Counts faster than you can watch and smiles like it costs money.' },
  },
  studio: {
    facadeName: 'Broadcast Studio',
    lobbyName: 'Studio Lobby', lobbyDesc: 'A reception desk under a wall of muted screens, each carrying a different feed. A soundproof door leads to the floor.',
    rooms: [{ key: 'floor', name: 'Studio Floor', desc: 'Lighting rigs, a lone desk, a wall of cameras. The ON AIR sign is dark — for now.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'the reception desk', desc: 'A curved desk under a bank of monitors.', object_type: 'fixture' },
      { room: 'floor', name: 'a broadcast desk', desc: 'An anchor desk facing a wall of cameras.', object_type: 'fixture' },
    ],
    npc: { room: 'floor', name: 'the studio host', personality: 'tv_host', description: 'Camera-ready even with the lights down, running lines to an empty room.' },
  },
  hotel: {
    facadeName: 'Hotel',
    lobbyName: 'Hotel Lobby', lobbyDesc: 'Faded grandeur — a marble floor gone grey, a front desk, a row of numbered keys on hooks behind it.',
    rooms: [{ key: 'room1', name: 'Guest Room', desc: 'A narrow bed, a chair, a window onto a wall. Clean enough, if you don’t look close.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'the front desk', desc: 'A long desk with a key rack and a dead courtesy phone.', object_type: 'fixture' },
      { room: 'room1', name: 'a single bed', desc: 'A made bed with thin sheets.', object_type: 'furniture', interactions: ['lie'] },
    ],
    npc: { room: 'lobby', name: 'the desk clerk', personality: 'vendor', description: 'Knows every guest’s business and rents it out by the hour.' },
  },
  office: {
    facadeName: 'Office',
    lobbyName: 'Office Lobby', lobbyDesc: 'A glass-and-steel reception with a corporate logo scrubbed off the wall, leaving a ghost. A turnstile guards the lifts.',
    rooms: [{ key: 'suite', name: 'Office Suite', desc: 'Cubicle partitions, dead plants, the hum of machines that never sleep.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'the reception desk', desc: 'A slab of frosted glass and brushed metal.', object_type: 'fixture' },
      { room: 'suite', name: 'a workstation', desc: 'A cubicle desk with a dark terminal.', object_type: 'terminal' },
    ],
    npc: { room: 'lobby', name: 'the lobby guard', personality: 'guard', description: 'Watches the turnstile and the door with equal, bored suspicion.' },
  },
  warehouse: {
    facadeName: 'Warehouse',
    lobbyName: 'Loading Bay', lobbyDesc: 'A cavern of racking and pallet-stacks under sodium light, a roll-up door at one end and the diesel ghost of forklifts.',
    rooms: [{ key: 'office', name: 'Bay Office', desc: 'A glass booth over the floor: a desk, a manifest board, a kettle gone cold.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'a pallet rack', desc: 'Industrial racking three storeys of steel high.', object_type: 'container' },
      { room: 'office', name: 'a manifest desk', desc: 'A steel desk buried in shipping paper.', object_type: 'fixture' },
    ],
    npc: { room: 'office', name: 'the bay foreman', personality: 'guard', description: 'Runs the floor off a clipboard and a whistle and misses nothing.' },
  },
  residential: {
    facadeName: 'Residence',
    lobbyName: 'Front Room', lobbyDesc: 'A lived-in room — a couch, a screen, the small clutter of someone who is out but coming back.',
    rooms: [{ key: 'bed', name: 'Bedroom', desc: 'A bed, a dresser, a window with the blind half-down.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'a worn couch', desc: 'A sagging couch facing a dead screen.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'bed', name: 'a bed', desc: 'An unmade bed under a shuttered window.', object_type: 'furniture', interactions: ['lie'] },
    ],
    npc: { room: 'lobby', name: 'a resident', personality: 'unemployed', description: 'Lives here. Wishes you didn’t know that.' },
  },
  police: {
    facadeName: 'Precinct',
    lobbyName: 'Precinct Lobby', lobbyDesc: 'A bulletproof duty window, a bolted bench, and a floor scuffed by every kind of trouble the city drags in.',
    rooms: [{ key: 'bullpen', name: 'Bullpen', desc: 'Desks jammed together under hard light, a wall of mugshots, the smell of burnt coffee.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'a bolted bench', desc: 'A steel bench chained to the floor.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'bullpen', name: 'a duty desk', desc: 'A metal desk stacked with case files.', object_type: 'fixture' },
    ],
    npc: { room: 'lobby', name: 'the desk sergeant', personality: 'police', description: 'Fields complaints from behind glass with practised, weary contempt.' },
  },
  power: {
    facadeName: 'Power Substation',
    lobbyName: 'Control Room', lobbyDesc: 'A dim room of humming relay cabinets and a mimic board tracing the local grid in half-dead LEDs. The floor thrums with something large turning next door.',
    rooms: [{ key: 'hall', name: 'Turbine Hall', desc: 'A cathedral of steel — turbines the size of trucks spinning behind cage rails, the air hot and loud with generated power.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'a control console', desc: 'A wall of breakers, dials, and a scrolling grid-load readout.', object_type: 'terminal' },
      { room: 'hall', name: 'a turbine', desc: 'A caged turbine the size of a truck, roaring as it spins.', object_type: 'fixture' },
    ],
    npc: { room: 'lobby', name: 'the grid operator', personality: 'guard', description: 'Watches the load board like a hawk and trusts no breaker on it.' },
  },
  // Hangar — the route additionally stamps hangar_interior / hangar_ramp flags and
  // wires the ramp (see apiBuildBuilding). The desk-chair NAME must stay exactly
  // 'the flight-ops desk chair' — plugins/flight/charter.js (DESK_CHAIR) matches on it.
  hangar: {
    facadeName: 'Hangar',
    lobbyName: 'Hangar Bay', lobbyDesc: 'A cavern of corrugated steel smelling of avgas and cold metal. A flight-ops desk faces the apron door; tools hang in shadow.',
    rooms: [],
    furniture: [
      { room: 'lobby', name: 'the flight-ops desk chair', desc: 'A wheeled ops chair, one armrest wrapped in duct tape, parked at a desk of flight monitors.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'lobby', name: 'a tool workbench', desc: 'A steel bench scattered with wrenches, rivets, and torn checklists.', object_type: 'fixture' },
    ],
    npc: null,
  },
  // Fallback for any building_type without a bespoke template above.
  // ── Old Coldwater (docs/proposals/old-coldwater.md) ────────────────────────
  // The five trades in the slums. None of them is a shop with a different sign on
  // it: a water seller exists because the Curtain cut the mains, a doss house and a
  // free canteen exist because the city has nowhere for somebody with nothing, and
  // the bonesetter and the shebeen are the unlicensed halves of two trades the city
  // already does with paperwork.
  water_seller: {
    facadeName: 'Water Seller',
    lobbyName: 'The Counter', lobbyDesc: "One room with a plank counter across it and the underside of the tank for a ceiling, close enough overhead that tall customers stoop without noticing. It is cool in here and always faintly damp, and the whole room ticks and shifts as the tank settles.",
    rooms: [{ key: 'tank', name: 'Under the Tank', desc: "The trestle legs come down through the floor here, bedded in concrete that was poured around them long after they went up. Jerrycans stand in ranks by fill date. Everything is labelled in the same careful hand.", dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'the plank counter', desc: 'A scrubbed plank on two barrels, worn pale in a band where forearms rest.', object_type: 'fixture' },
      { room: 'lobby', name: 'a chained tin cup', desc: 'A dented tin cup on a length of chain, for tasting. Nobody has ever stolen it.', object_type: 'decoration' },
      { room: 'tank', name: 'a rank of jerrycans', desc: 'Jerrycans in rows, each chalked with a fill date. The dates are in order.', object_type: 'container' },
      { room: 'tank', name: 'the header valve', desc: 'A brass gate valve on the downpipe, polished by forty years of the same hand.', object_type: 'fixture' },
    ],
    npc: { room: 'lobby', name: 'Bartram Quell', personality: 'vendor', description: "A dry, exact old man in a rubber apron, who will tell you what the water costs him before he tells you what it costs you." },
  },
  flophouse: {
    facadeName: 'Doss House',
    lobbyName: 'The Front Desk', lobbyDesc: "A hallway wide enough for two people if neither is carrying anything, with a desk jammed across the end of it and a pigeonhole rack behind that. The stairs go up outside the building, so the noise of everyone arriving comes through the wall rather than past the desk.",
    rooms: [
      { key: 'dorm', name: 'The Long Room', desc: "Bunks down both walls, three high, with the gap between them narrow enough to touch either side. The floor slopes toward the back of the building and everybody's belongings have migrated that way. A stove at the far end stays lit.", dir: 'north' },
      { key: 'attic', name: 'The Top Landing', desc: "Where the outside stair comes in under the roof. The ridge has given here and the ceiling follows it down in a long sag you can see from the street. Somebody has propped it with a length of scaffold tube and painted the tube.", dir: 'east' },
    ],
    furniture: [
      { room: 'lobby', name: 'the desk', desc: 'A desk wedged across the hall, its edge worn round. A ledger sits on it, open.', object_type: 'fixture' },
      { room: 'lobby', name: 'a pigeonhole rack', desc: "Numbered pigeonholes, most empty. A few hold post nobody has come back for.", object_type: 'container' },
      { room: 'dorm', name: 'a triple bunk', desc: 'Three iron bunks stacked to the ceiling, the mattresses thin enough to fold.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'dorm', name: 'the stove', desc: 'A squat iron stove burning something that is not quite wood. It never goes out.', object_type: 'appliance' },
      { room: 'attic', name: 'the propped tube', desc: "A scaffold tube holding the ridge up, painted a cheerful green by somebody who meant it.", object_type: 'fixture' },
    ],
    npc: { room: 'lobby', name: 'Wilmot Scarrow', personality: 'vendor', description: "A heavy, unhurried man who knows the name of everyone who has ever slept here and the debts of most of them." },
  },
  soup_kitchen: {
    facadeName: 'Free Canteen',
    lobbyName: 'The Hall', lobbyDesc: "A long low room with trestles down the middle and benches either side, and enough of them that the far end is in shadow. The serving hatch is at the near end so the queue never has to come inside. It is warm, and it smells of onions and steam and wet wool.",
    rooms: [{ key: 'kitchen', name: 'The Kitchen', desc: "A range along one wall with four pots on it, none smaller than a bucket. Everything in here is scrubbed to the grain. A list on the wall says what is being served for the next eleven days, in pencil, with corrections.", dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'a trestle table', desc: 'A long trestle scrubbed pale, with benches pulled up tight either side.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'lobby', name: 'the serving hatch', desc: 'A hatch onto the kitchen with a worn steel sill and a stack of tin bowls.', object_type: 'fixture' },
      { room: 'kitchen', name: 'the range', desc: 'A black iron range with four pots going, the smallest of them bucket-sized.', object_type: 'appliance' },
      { room: 'kitchen', name: 'the menu board', desc: "Eleven days of meals in pencil, corrected and re-corrected. Nothing on it repeats.", object_type: 'decoration' },
    ],
    npc: { room: 'kitchen', name: 'Hestia Dunmore', personality: 'vendor', description: "A small, brisk woman with her sleeves pinned back, who has fed this street for nineteen years and will not discuss it." },
  },
  bonesetter: {
    facadeName: 'Bonesetter',
    lobbyName: 'The Front Room', lobbyDesc: "One room off the lane, with a bench along the wall for whoever is waiting and a curtain across the back half. The window is the brightest thing on Ropewalk after dark, because the work needs the light and the light is the only advertising there is.",
    rooms: [{ key: 'table', name: 'Behind the Curtain', desc: "A scrubbed table under a lamp on a swing arm, with a tray of instruments laid out in order beside it. The shelf above holds jars, all labelled, none of them dusty. There is a bucket under the table and you decide not to look in it.", dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'the waiting bench', desc: 'A hard bench worn to a shine in three separate places.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'table', name: 'the table', desc: 'A scrubbed wooden table with a gutter cut round the edge of it, draining one way.', object_type: 'fixture' },
      { room: 'table', name: 'a tray of instruments', desc: 'Steel laid out in order of size, every piece of it clean and none of it new.', object_type: 'container' },
      { room: 'table', name: 'the jar shelf', desc: "Labelled jars in a row. The labels are handwritten and the hand is very steady.", object_type: 'container' },
    ],
    npc: { room: 'table', name: 'Merrit Lachance', personality: 'doctor', description: "Rolled sleeves, short nails, and the flat incurious calm of somebody who has already seen worse than you today." },
  },
  shebeen: {
    facadeName: 'Shebeen',
    lobbyName: 'The Counter', lobbyDesc: "Half a room, because the front wall stops at waist height and the rest is a tarpaulin on a frame. You drink standing in the lane with your elbows inside. When the weather comes in from the south everybody shuffles two feet left and carries on.",
    rooms: [{ key: 'still', name: 'The Still Room', desc: "The back half, behind a door that is a door in the sense that it fills the gap. The still stands in the corner with a fire under it and a condenser coil going up the wall and out through the roof. The whole room smells sweet and sharp and slightly wrong.", dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'the plank counter', desc: 'A plank on trestles, sticky in a way that has stopped being a stage and become a finish.', object_type: 'fixture' },
      { room: 'lobby', name: 'a row of stools', desc: 'Four stools of four different heights, all of them wrong.', object_type: 'furniture', interactions: ['sit'] },
      { room: 'still', name: 'the still', desc: 'A copper pot still with a coil going up the wall, patched in three places with solder.', object_type: 'appliance' },
      { room: 'still', name: 'a crate of jars', desc: 'Screw-top jars, washed and stacked, waiting. No two of them match.', object_type: 'container' },
    ],
    npc: { room: 'lobby', name: 'Thomasina Tillery', personality: 'bartender', description: "Lean, quick-eyed, and permanently amused. She pours with one hand and keeps the other where you cannot see it." },
  },

  // ── The Basin quay, at 907,907 and 908,907 ──────────────────────────────────
  // Two buildings on what used to be the doubled stretch of Greenside Row, where the
  // street ran parallel to Meltwater Row one tile away and the pair rendered as a
  // single slab of tarmac with a signal mast on every tile of it. Both front south
  // onto Meltwater Row with the Coldwater Basin at their backs.
  ice_house: {
    facadeName: 'Ice House',
    lobbyName: 'The Cutting Floor', lobbyDesc: "The cold comes off the far wall like a draught from an open door, and the door reveal tells you why: three feet of brick, then cork, then boards, and the whole thickness of it sitting between you and the store. A saw bench runs down the middle under a beam scale. The floor is sawdust over stone and it has never once been dry.",
    rooms: [
      { key: 'store', name: 'The Store', desc: "Blocks stacked to the roof in a room with no window and one door, each course buried in sawdust so the next one down never sees air. Your breath goes in front of you here. A chalked board by the door lists what is spoken for, and most of the board is old chalk somebody has stopped rubbing out.", dir: 'north' },
      { key: 'stage', name: 'The Loading Stage', desc: "A timber stage out over the water on piles, with the gantry bracket bolted through the gable above it and a block and tackle hanging off that. The rope is newer than anything else in the building. Below the boards the Basin moves about, slowly, and you can hear it doing it.", dir: 'east' },
    ],
    furniture: [
      { room: 'lobby', name: 'the beam scale', desc: 'A long brass beam on a cast stand, with a pan at one end and a sliding weight at the other. It is read from the side.', object_type: 'fixture' },
      { room: 'lobby', name: 'the saw bench', desc: 'A bench with a channel cut down it and a two-handed ice saw laid in the channel, teeth up.', object_type: 'fixture' },
      { room: 'store', name: 'the block stack', desc: 'Ice to the roof, course on course, every layer under a hand of sawdust. The stack is square to the wall.', object_type: 'container' },
      { room: 'store', name: 'the chalk board', desc: 'Names and weights in chalk, in three hands. The oldest entries have gone to ghosts and stayed up anyway.', object_type: 'decoration' },
      { room: 'stage', name: 'the gantry', desc: 'An iron bracket out over the water with a block and tackle on it. The rope runs freely, which on this quay is unusual.', object_type: 'fixture' },
    ],
    npc: { room: 'lobby', name: 'Cormac Halliwell', personality: 'vendor', description: "A slow, heavy man in a wet apron who weighs everything twice and charges for the second weighing." },
  },
  harbour_office: {
    facadeName: 'Harbour Office',
    lobbyName: 'The Berth Office', lobbyDesc: "A counter, a barometer screwed to the wall beside it, and behind both a board of numbered berths with a brass peg hanging under every number. All the pegs are on the board. A stair goes up in the corner toward the lantern, and the rope that comes down the middle of it is the one that winds the ball.",
    rooms: [
      { key: 'tide', name: 'The Tide Room', desc: "A brass float on a wire in a glass stilling well, going up and down with the Basin about a finger's width an hour, and a pen on an arm off the wire writing that onto a paper drum. The shelf behind holds the drums going back further than anybody has asked about. They are in order.", dir: 'north' },
      { key: 'loft', name: 'The Signal Loft', desc: "Flag lockers along one wall, each pigeonhole labelled with what it means, and the winding gear for the ball taking up the rest of the room. The shaft goes up through the roof. At five to one somebody comes up here, and at one o'clock the ball drops, and nothing on the water is watching for it.", dir: 'east' },
    ],
    furniture: [
      { room: 'lobby', name: 'the berth board', desc: 'Numbered berths painted on a board, a brass peg on a hook under each. Every peg is hanging up.', object_type: 'fixture' },
      { room: 'lobby', name: 'the barometer', desc: 'A wheel barometer in a mahogany case, with a second hand you set yourself to mark where the pressure was an hour ago.', object_type: 'fixture' },
      { room: 'tide', name: 'the tide drum', desc: 'A paper drum turning under a pen, drawing the Basin going up and down. The line is very slightly ragged and always has been.', object_type: 'fixture' },
      { room: 'tide', name: 'the drum shelf', desc: 'Rolls of tide paper on a shelf, dated, in order, none of them dusty.', object_type: 'container' },
      { room: 'loft', name: 'the flag lockers', desc: 'Pigeonholes of folded signal flags, each labelled with what it says. Several of them say things nobody has needed to say in years.', object_type: 'container' },
      { room: 'loft', name: 'the winding gear', desc: 'A drum, a pawl and a crank, geared to the shaft that goes up through the roof to the ball. It is oiled.', object_type: 'fixture' },
    ],
    npc: { room: 'lobby', name: 'Honor Brine', personality: 'official', description: "The harbourmaster, in a coat she has had longer than the job, who keeps a log of a harbour nothing has entered since before she took it on." },
  },

  GENERIC: {
    lobbyName: 'Front Room', lobbyDesc: 'A plain interior — bare walls, a scuffed floor, the echo of a space waiting to be made into something.',
    rooms: [{ key: 'back', name: 'Back Room', desc: 'A smaller room behind the front, empty but for dust and possibility.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'a counter', desc: 'A plain counter running along one wall.', object_type: 'fixture' },
    ],
    npc: null,
  },
};

// Interior-grid offsets for template rooms. Cardinals only — 'down' is reserved for
// authorUtilityRoom's utility room, 'up' is left free for hand-authored upper floors.
// Lives beside the blueprints because a room's `dir` is only meaningful against these
// offsets; both the dev-panel route and the file-authoring CLI read this one copy.
export const BUILD_DIR_OFF = { north: [0, -1, 0], south: [0, 1, 0], east: [1, 0, 0], west: [-1, 0, 0] };

// Resolve a building_type to its template (synonym-aware), always returning something.
export function templateForType(buildingType) {
  const key = TEMPLATE_SYNONYMS[buildingType] || buildingType;
  return BUILDING_TEMPLATES[key] || BUILDING_TEMPLATES.GENERIC;
}
