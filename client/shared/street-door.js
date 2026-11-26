// STREET DOORS: the kinds of door a building with a Stage can have in its street doorway, and how its entry room's
// `flags.room.street_door` says which and how it looks. One table for the plan (building-graph.js), the server that
// sends each door to the street view (plugins/roomstage streetDoorsNear) and the renderer that draws it
// (client/game/js/panels/glass/street-doors.js), so a new kind or a new look key is added here and nowhere else.
//
// The doorway itself is not here. Where it stands, how wide it is and how high its head is come off the building's
// model (glass/doorway-measure.js), so the leaves fill the opening the model drew and nothing of the model's own
// door shows round them. See docs/reference/street-doors.md.
//
// No imports: the server, the plan and the browser all load this.

// leaves  how many leaves the door has (a revolving door's are its wings)
// glass   glazed, so the room shows through it; false is a painted leaf or a grille
// auto    automatic glass (it starts apart when you come out of it); every unlocked street door now opens as you come up
//         to it on foot (freelook-view.js doorLeaves), so this no longer means it waits for F
// move    how a leaf moves: 'slide' into the wall beside it, 'hinge' about its outer jamb, 'revolve' about the middle
export const DOOR_KINDS = {
  sliding:   { leaves: 2, glass: true,  auto: true,  move: 'slide' },     // an automatic pair, the airport's and the marina's
  swing:     { leaves: 2, glass: true,  auto: true,  move: 'hinge' },     // a hinged pair in metal frames, an old hotel's
  single:    { leaves: 1, glass: true,  auto: true,  move: 'hinge' },     // one glazed leaf, a shop's
  revolving: { leaves: 4, glass: true,  auto: true,  move: 'revolve' },   // four glass wings in a drum, an office lobby's
  plain:     { leaves: 1, glass: false, auto: false, move: 'hinge' },     // one painted leaf, a club's or a back street's
  grille:    { leaves: 1, glass: false, auto: false, move: 'hinge' },     // a steel cage for a door, the Cherry Pit's
  mech:      { leaves: 2, glass: false, auto: true,  move: 'slide' },     // an opaque steel pair that parts, the clone facility's
};

// The kind a street_door flag asks for. `kind` names it; a flag with no kind is the plain door it always was, or a
// grille when it has `bars`. Null when the room has no street_door at all.
export function streetDoorKind(sd) {
  if (!sd || typeof sd !== 'object') return null;
  if (DOOR_KINDS[sd.kind]) return sd.kind;
  return sd.bars ? 'grille' : 'plain';
}

// The plan's view of a glazed door (building-graph.js): how wide the opening is cut, whether its leaves hinge, and
// `hand`, a hinged door that stays shut from inside until F opens it. Null for a painted door or a grille, which the
// plan cuts as an ordinary doorway.
export function glassDoorOf(sd) {
  const kind = streetDoorKind(sd), K = kind && DOOR_KINDS[kind];
  // a mechanical pair is opaque but slides, so the plan cuts it as a sliding door all the same
  if (!K || (!K.glass && kind !== 'mech')) return null;
  const hinge = K.move === 'hinge';
  return { kind, w: Math.max(1.2, Math.min(3, Number(sd.w) || 1.8)), swing: hinge, hand: sd.hand === true, ...(sd.keypad ? { keypad: true } : {}), ...(sd.dark ? { dark: true } : {}), ...(HEX.test(sd.glass || '') ? { glass: sd.glass } : {}) };
}

// How the door looks from the street, from the same flag: the glass's tint, the trim round each leaf, a monogram
// or an S pull on the handles, a painted leaf's colour, a grille, a fanlight over a hinged pair, a runner's colour
// out across the pavement, `dark` (black behind the doors instead of the lobby, so the step in is a step into the
// dark and the loading veil), `cx` (tiles along the front, a hint for which of the model's doors it is) and `h`
// (metres, the head when the model has no door of its own to read it from). Null when the flag says none of it.
const HEX = /^#[0-9a-f]{6}$/i;
export function streetDoorLook(sd) {
  if (!sd || typeof sd !== 'object') return null;
  const kind = streetDoorKind(sd);
  const L = {
    ...(sd.glass ? { glass: String(sd.glass) } : {}),
    ...(sd.trim ? { trim: String(sd.trim) } : {}),
    ...(sd.monogram ? { monogram: String(sd.monogram).slice(0, 2) } : {}),
    ...(sd.handle === 's' ? { handle: 's' } : {}),
    ...(sd.leaf ? { leaf: String(sd.leaf) } : {}),
    ...(sd.bars ? { bars: true } : {}),
    // the light in a painted leaf, so the room shows through it: 'porthole', 'half' or 'slot' (the default)
    ...(['porthole', 'half', 'slot'].includes(sd.lite) ? { lite: sd.lite } : {}),
    ...(sd.fanlight ? { fanlight: true } : {}),
    ...(sd.dark ? { dark: true } : {}),
    // one-way glass: a mirror from the street, clear from inside
    ...(sd.oneway ? { oneway: true } : {}),
    // `own`: the model draws its own door and its animation (the clone arm's, a fresh clone in the doorway), so
    // nothing is drawn over it; the door is still where you walk in
    ...(sd.own ? { own: true } : {}),
    ...(Number.isFinite(sd.cx) ? { cx: sd.cx } : {}),
    ...(Number.isFinite(sd.h) && sd.h > 1.5 && sd.h < 8 ? { h: sd.h } : {}),
    ...(HEX.test(sd.runner || '') ? { runner: sd.runner } : {}),
    ...(Number.isFinite(sd.runner_m) && sd.runner_m > 0.5 && sd.runner_m < 8 ? { runner_m: sd.runner_m } : {}),
  };
  // the kind rides along only when it says something the plan's slide/swing don't (single, revolving)
  if (kind === 'single' || kind === 'revolving' || kind === 'mech') L.kind = kind;
  return Object.keys(L).length ? L : null;
}

// THE DOOR OF A BUILDING BY ITS TYPE, for a building with no street_door flag to say: the door a person on the
// street is seen to open (client/game/js/panels/glass/npc-doors.js). A kind and a look, as streetDoorLook gives
// them. `tone` (a hash of the tile) picks a painted leaf's colour, so a row of flats isn't one colour.
//
// The families are by trade, not by name: a tower's lobby turns, a clinic or a terminal parts, a shop has one
// glazed door, a hotel or a bank a hinged pair with brass, a flat or a bar a painted leaf, a works a grille. A
// type not listed is read off its name (a `tower` turns, a `_yard` or `_plant` is a grille), else a shop's door.
const TYPE_DOOR = {
  revolving: ['chrome_tower', 'bead_tower', 'torque_tower', 'glass_prism', 'corporate_office', 'exchange', 'asc_spire'],
  sliding: ['clinic', 'asc_clinic', 'dept_store', 'grocery', 'transit_halt', 'departures', 'arrivals', 'vtol_dealer',
    'chrome_slab', 'cascade_block', 'atrium_court', 'sky_court', 'office', 'vertical_farm', 'institute', 'lens_hall',
    'vet', 'greenhouse', 'winter_garden', 'ice_rink', 'asc_vats', 'asc_weave', 'control_tower'],
  swing: ['hotel', 'bank', 'civic', 'members_club', 'palais_foyer', 'palais_bar', 'concert_hall', 'cinema', 'casino',
    'auction_house', 'museum', 'land_office', 'harbour_office', 'lending_library', 'box_office', 'pavilion', 'asc_gate'],
  single: ['shop', 'store', 'bodega', 'diner', 'mercantile', 'boutique', 'butcher', 'laundromat', 'coffee_shop',
    'chip_shop', 'noodle_bar', 'tailor', 'cobbler', 'comic_shop', 'hardware', 'off_licence', 'gun_shop', 'blade_shop',
    'souvenir_shop', 'locksmith', 'outfitter', 'tattooist', 'taxidermist', 'bookmaker', 'bonesetter', 'undertaker',
    'chem_supply', 'peanut_roaster', 'water_seller', 'freight_office', 'freight_forwarder', 'assay', 'frank_stand', 'asc_shrine'],
  plain: ['apartment', 'residential', 'hostel', 'flophouse', 'bar', 'sports_bar', 'pool_hall', 'honkytonk', 'shebeen',
    'nightclub', 'club', 'gym', 'bathhouse', 'soup_kitchen', 'amusements', 'studio', 'police', 'fire_station', 'church'],
  grille: ['fabrication', 'cold_storage', 'junkyard', 'fence', 'warehouse', 'foundry', 'industrial', 'power', 'substation',
    'dynamo', 'hydro', 'pumping_station', 'incinerator', 'gasholder', 'cooling_plant', 'fuel_yard', 'container_yard',
    'fish_works', 'infra', 'weigh_station', 'water_tower', 'boatshed', 'boathouse', 'wharf', 'truck_depot', 'hangar'],
};
const DOOR_OF_TYPE = new Map(Object.entries(TYPE_DOOR).flatMap(([k, list]) => list.map((t) => [t, k])));
// a painted leaf's colours: a flat's door is one of the street's; a bar's is oxblood, a club's black, the police's blue
const LEAVES = ['#5a3a28', '#2e3e48', '#4a1e1a', '#28402e', '#5c574a', '#3a2c40', '#6a5236'];
const LEAF_OF = { bar: '#4a1a16', sports_bar: '#1e3a26', pool_hall: '#1e3a26', honkytonk: '#5a3a22', shebeen: '#3a2a1e',
  nightclub: '#141418', club: '#141418', police: '#1e2c48', fire_station: '#6a1e18', church: '#4e3420', gym: '#2c3a44' };
// brass on the doors with brass about them; a bank's and a hotel's glass a little warm
const BRASS = new Set(['hotel', 'bank', 'members_club', 'palais_foyer', 'palais_bar', 'concert_hall', 'casino', 'auction_house', 'museum']);

export function doorForType(bt, tone = 0) {
  const t = String(bt || '').toLowerCase();
  let kind = DOOR_OF_TYPE.get(t);
  if (!kind) kind = /tower|spire/.test(t) ? 'revolving' : /_yard|_plant|works|depot|shed/.test(t) ? 'grille' : 'single';
  const look = {};
  if (kind === 'revolving' || kind === 'single') look.kind = kind;
  if (kind === 'grille') look.bars = true;
  if (kind === 'plain') {
    look.leaf = LEAF_OF[t] || LEAVES[(tone >>> 3) % LEAVES.length];
    look.lite = t === 'apartment' || t === 'residential' || t === 'hostel' ? 'half' : t === 'gym' || t === 'bathhouse' ? 'porthole' : 'slot';
  }
  if (BRASS.has(t)) { look.trim = '#b08a4a'; look.glass = '#6e6450'; if (kind === 'swing') look.fanlight = true; }
  return { kind, look };
}
