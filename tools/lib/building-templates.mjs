// Templated interiors for the dev-panel "New Building" generator (apiBuildBuilding
// in server/api/routes.js). Each building_type maps to a small blueprint: a lobby
// (the entry room), zero or more extra rooms wired off it, some thematic furniture,
// and an optional inhabitant NPC. The route stamps the facade + interior map + power
// (authorUtilityRoom) around this; templates only describe the rooms/props/people.
//
// This is authoring scaffolding (like the zone-planner's templates), NOT engine
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
  GENERIC: {
    lobbyName: 'Front Room', lobbyDesc: 'A plain interior — bare walls, a scuffed floor, the echo of a space waiting to be made into something.',
    rooms: [{ key: 'back', name: 'Back Room', desc: 'A smaller room behind the front, empty but for dust and possibility.', dir: 'north' }],
    furniture: [
      { room: 'lobby', name: 'a counter', desc: 'A plain counter running along one wall.', object_type: 'fixture' },
    ],
    npc: null,
  },
};

// Resolve a building_type to its template (synonym-aware), always returning something.
export function templateForType(buildingType) {
  const key = TEMPLATE_SYNONYMS[buildingType] || buildingType;
  return BUILDING_TEMPLATES[key] || BUILDING_TEMPLATES.GENERIC;
}
