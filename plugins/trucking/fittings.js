// THE LONG HAUL — what a driver bolts onto a truck that does nothing at all.
//
// Paint says what colour your rig is. This says what you are LIKE. A truck is the one possession in
// this game a player owns outright, walks around, and sees from the outside every time they climb
// into it — and until now the whole of that expression was seven colours and a flash. Two rigs with
// the same paint were the same truck.
//
// FIVE RULES, and the first three are the reason this is affordable at all.
//
// 1. IT IS A LIST OF IDS AND NOTHING ELSE. `trucks.custom_data.fits` — an array of short strings in
//    a JSONB bag that is already written on every bench commit. No table, no column, no join, no
//    tick, no per-frame server work, and the whole feature costs ONE existing UPDATE. Every number
//    that could have been stored per-truck (where a bar sits, how long a stack is, what colour a
//    tube glows) is derived instead: geometry comes from the catalog id and the truck's own shape,
//    and colour comes from the paint the player already bought.
//
// 2. THE WIRE COST IS A SUFFIX ON A STRING THAT WAS ALREADY BEING SENT. Every renderer of a truck —
//    the cab, the depot turntable, another driver's relayed contact, the dealer wireframe — already
//    threads a `variant` string (`<typeId>[+t][~p]`, aircraft3d's grammar). Fittings ride it as
//    `^ab.cd.ef`, so nothing new is broadcast, no payload grows by a field, and a contact in a
//    pilot's windscreen wears its owner's bull bar for free. ⚠ That is also why the codes are two
//    characters: this string is on every contact in every window four times a second.
//
// 3. NOTHING HERE IS MECHANICAL. Not one fitting touches a parameter, a roll, a price or a
//    capacity. A ram plate does not help you win a collision and an armour plate does not soak one.
//    That is the same rule filth.js is built on and it is load-bearing for the same reason: the
//    moment the ugly truck is the FAST truck, a player who wants to look a particular way is paying
//    for it in lap time, and everybody converges on the same rig again. Expression must be free, or
//    it is not expression.
//
// 4. ONE PER SLOT, and the slot is the whole conflict model. Two roof racks is not a look, it is a
//    bug — so fitting something into an occupied slot REPLACES what was there, and says so. There
//    is deliberately no compatibility matrix beyond that: a matrix is a thing an author has to keep
//    in step with a mesh, and the slots already say everything geometry needs to know.
//
// 5. YOU CAN TAKE IT OFF AND IT IS STILL YOURS. `rig unfit` puts a fitting back in the drawer at no
//    cost, and refitting it is free. What you paid for is OWNING it, not wearing it — a cosmetic
//    system that charges rent on your own taste is one nobody experiments with.

// ── The slots ────────────────────────────────────────────────────────────────
// Eight places on a truck a person can hang something, ordered the way you walk round one.
//
// ⚠ A NEW SLOT GOES IN ITS WALKING POSITION AND NEVER MOVES AN EXISTING ONE PAST ANOTHER. This
// array is the sort key `fitSuffix` makes the wire string canonical with, so reordering two slots
// that both have something in them rewrites the mesh-cache key of every truck already wearing
// them. Inserting `glass` between `bar` and `roof` leaves every existing pair in the same relative
// order, which is the only reason it was free to do.
export const SLOTS = [
  { id: 'bar',    label: 'Front Bar',   note: 'What meets the road first.' },
  { id: 'glass',  label: 'Screen',      note: 'What is between you and it.' },
  { id: 'roof',   label: 'Roof',        note: 'The skyline of the thing.' },
  { id: 'stack',  label: 'Stacks',      note: 'What comes out of it.' },
  { id: 'flank',  label: 'Flanks',      note: 'The long panel people read you by.' },
  { id: 'under',  label: 'Underlights', note: 'What the road under you looks like.' },
  { id: 'rear',   label: 'Back End',    note: 'What the driver behind gets to look at.' },
  { id: 'hood',   label: 'Mascot',      note: 'The one on the nose, for you.' },
];

// ── The catalog ──────────────────────────────────────────────────────────────
// `code` is what rides the wire and what the mesh switches on; it is TWO characters and it must
// never change once it has shipped, because it is stamped into live `custom_data` rows.
//
// The catalog runs on one deliberate axis — the waste at one end, the strip at the other — and most
// of the range is the middle, where a working truck actually lives. It is not a ladder: a ₵400 skull
// on the bonnet is not a worse ₵3,200 light bar, it is a different sentence. Price tracks how much
// METAL is involved and nothing else, so nobody can read the catalog as a progression and feel they
// are supposed to end up at the top of it.
//
// ⚠ THE WASTE END IS THE HALF THAT NEEDS DEFENDING, and the reason it now outnumbers the strip end
// is the map rather than the taste: the road runs out of Coldwater into the Scarletwastes, and a
// catalog that could only dress a show truck meant every rig on the long haul looked like it had
// never left the city. A grader blade, a slit plate, a hopper of scrap and a water bowser are the
// four sentences a driver out there would actually want to say. They still say NOTHING mechanical
// (rule 3): a bowser carries no water, a hopper drops nothing, a slit plate stops no bullet. What
// they carry is a claim about where you have been, and the claim is free.
export const FITTINGS = {
  // ── Front bar ──
  rampl:   { code: 'rp', slot: 'bar',   price: 2400, name: 'Ram Plate',
             desc: 'A ploughed steel wedge across the whole nose, braced back to the frame. Whatever is in the road is the road\'s problem.' },
  tusks:   { code: 'tu', slot: 'bar',   price: 1800, name: 'Tusk Bar',
             desc: 'Four lengths of pipe sharpened on a bench grinder and bolted where a bumper was.' },
  pushbar: { code: 'pb', slot: 'bar',   price: 1500, name: 'Chrome Push Bar',
             desc: 'A polished hoop with a pair of lamps in it. Half of one, anyway — it is for looking at.' },
  winch:   { code: 'wn', slot: 'bar',   price: 2100, name: 'Recovery Winch',
             desc: 'A drum, a fairlead and forty metres of cable. Everybody who owns one has pulled somebody out.' },
  spikes:  { code: 'sx', slot: 'bar',   price: 1300, name: 'Spike Rack',
             desc: "Rebar cut to length, sharpened, and stood up in a row along the bumper. It took an afternoon and it works on people who have never seen one." },
  grader:  { code: 'gb', slot: 'bar',   price: 2900, name: 'Grader Blade',
             desc: "A road grader's mouldboard hung across the nose on an angle, so whatever it catches goes off the side rather than under you. The edge is polished by use and nothing else." },

  // ── Screen ──
  screenmesh:{ code: 'zm', slot: 'glass', price: 900, name: 'Screen Mesh',
             desc: "Reinforcing bar bent to the rake of the glass and welded at every crossing. You see the road in squares now, and you still have a windscreen." },
  slitplate:{ code: 'zp', slot: 'glass', price: 2300, name: 'Slit Plate',
             desc: "Boiler plate over the whole screen with a hand's width cut out at eye level. Everyone who fits one says it is temporary." },
  sunstrip:{ code: 'zb', slot: 'glass', price: 350,  name: 'Sun Strip',
             desc: 'A band of dark tint across the top of the screen. The oldest thing a driver does to a truck.' },

  // ── Roof ──
  cage:    { code: 'rc', slot: 'roof',  price: 1900, name: 'Roof Cage',
             desc: 'Welded bar over the sleeper with cans and a rolled tarp strapped down in it. Storage, and a statement about how far you go.' },
  lightbar:{ code: 'lb', slot: 'roof',  price: 3200, name: 'Halogen Light Bar',
             desc: 'Eight lamps on a chrome rail. Six of them work, which is six more than you need.' },
  beacon:  { code: 'bc', slot: 'roof',  price: 900,  name: 'Amber Beacon',
             desc: 'A single rotating lamp on a stalk. Official-looking enough that people move over.' },
  totem:   { code: 'tm', slot: 'roof',  price: 700,  name: 'Totem Rack',
             desc: 'A crossbar of trophies off the roof — plate, bone, a length of somebody\'s aerial. Everything on it was taken from something.' },
  nest:    { code: 'np', slot: 'roof',  price: 2500, name: 'Roof Parapet',
             desc: 'Plate welded up round the sleeper roof, cut low at the front. It is a place for somebody to lie down and it is not for sleeping.' },
  aerials: { code: 'af', slot: 'roof',  price: 600,  name: 'Aerial Farm',
             desc: 'Five whips off one crossbar, none of them the same length, all of them listening to something different.' },

  // ── Stacks ──
  cutstack:{ code: 'cs', slot: 'stack', price: 1200, name: 'Straight Cut Stacks',
             desc: 'The mufflers gone, the pipes cut square and left raw. Twice as loud and half as legal.' },
  flametip:{ code: 'ft', slot: 'stack', price: 1600, name: 'Flame Tips',
             desc: 'Split, flared and heat-blued mouths that throw unburnt fuel on every shift.' },
  neonslv: { code: 'sn', slot: 'stack', price: 1400, name: 'Stack Sleeves',
             desc: 'Lit tubing wound up each pipe. Nothing about it is a good idea and everybody looks.' },
  sootpipe:{ code: 'so', slot: 'stack', price: 500,  name: 'Soot Pipes',
             desc: 'Tarred black to the shield, with a rain flap that sits crooked. Nobody fits these. They arrive.' },

  // ── Flanks ──
  armour:  { code: 'ap', slot: 'flank', price: 2800, name: 'Riveted Plate',
             desc: 'Mismatched sheet hammered over the doors and riveted down the seam. It has been shot at, probably not while fitted here.' },
  jerrys:  { code: 'jc', slot: 'flank', price: 1100, name: 'Jerry Rack',
             desc: 'Six cans in a welded cradle behind the steps. Range you can see.' },
  sawskirt:{ code: 'sw', slot: 'flank', price: 2200, name: 'Saw-Blade Skirt',
             desc: 'Circular blades bolted along the sill, teeth outward. Nobody walks close to this truck twice.' },
  runner:  { code: 'sr', slot: 'flank', price: 1300, name: 'Chrome Runner',
             desc: 'A polished running board the length of the cab, lit underneath. The old show-truck answer.' },
  spears:  { code: 'xr', slot: 'flank', price: 1200, name: 'Spear Rack',
             desc: 'Four lengths of pipe racked along the flank where a ladder would go. Two of them are ground to a point and two of them are just pipe.' },
  hide:    { code: 'hd', slot: 'flank', price: 800,  name: 'Hide Drape',
             desc: 'Stitched skins on a rail over the door, weighted at the hem so they do not blow about. It keeps the afternoon off the glass.' },

  // ── Underlights ──
  underglow:{ code: 'ug', slot: 'under', price: 1700, name: 'Underglow Tubes',
             desc: 'Tubes down both frame rails. The road under you goes whatever colour you painted your running lights.' },
  halos:   { code: 'hl', slot: 'under', price: 2000, name: 'Lifter Halos',
             desc: 'A lit ring round every pod housing. The machine looks like it is thinking about something.' },
  beltneon:{ code: 'bn', slot: 'under', price: 1500, name: 'Beltline Neon',
             desc: 'A second strip under the first, twice as bright and half as tasteful.' },
  dragchain:{ code: 'dc', slot: 'under', price: 500, name: 'Drag Chains',
             desc: 'Short chain hung off both rails, sweeping the road. Half the drivers who run them will tell you it is for the static.' },

  // ── Back end ──
  chainrack:{ code: 'ch', slot: 'rear', price: 800,  name: 'Chain Rack',
             desc: 'Load chain hung in loops off the headboard, swinging. It is a rack. It is also a noise.' },
  sparepod:{ code: 'sp', slot: 'rear',  price: 2600, name: 'Spare Pod Cradle',
             desc: 'A whole lifter housing strapped upright behind the cab. A day of the week, out here.' },
  banner:  { code: 'bp', slot: 'rear',  price: 600,  name: 'Banner Pole',
             desc: 'A whip off the back corner with a rag on it, so people know it is you before they can read the plate.' },
  hopper:  { code: 'ct', slot: 'rear',  price: 1700, name: 'Scrap Hopper',
             desc: 'A bin of cut scrap on the headboard with a chute out the back of it, pointed at whoever is following. It has never been emptied deliberately.' },
  bowser:  { code: 'wb', slot: 'rear',  price: 1900, name: 'Water Bowser',
             desc: 'Four hundred litres strapped upright behind the cab with a tap at the bottom. Out there it is the reason strangers are polite to you.' },

  // ── Mascot ──
  skull:   { code: 'sk', slot: 'hood',  price: 400,  name: 'Bleached Skull',
             desc: 'Bolted to the bonnet, facing forward. It is not a person\'s. It is not not a person\'s.' },
  bird:    { code: 'cb', slot: 'hood',  price: 1000, name: 'Chrome Bird',
             desc: 'A stylised bird in flight, chromed, on a plinth. Two centuries out of date and it still works.' },
  doll:    { code: 'dh', slot: 'hood',  price: 300,  name: 'Doll Head',
             desc: 'A single doll\'s head, wired down through the bonnet. Nobody who has one will explain it.' },
  wheelidol:{ code: 'wi', slot: 'hood', price: 500,  name: 'Wheel Idol',
             desc: 'A steering wheel off something older, chromed and stood upright on a plinth. It faces the road rather than the driver, which is the whole idea.' },
};

export const FIT_IDS = Object.keys(FITTINGS);
const BY_CODE = Object.fromEntries(FIT_IDS.map((id) => [FITTINGS[id].code, id]));
export const fitByCode = (code) => FITTINGS[BY_CODE[code]] ? { id: BY_CODE[code], ...FITTINGS[BY_CODE[code]] } : null;

// ⚠ TWO FITTINGS MAY NEVER SHARE A CODE. It is two characters on a wire and it is stamped into live
// rows, so a collision would silently repaint somebody's truck with somebody else's part — and the
// failure would be invisible to everything except the person driving it. Asserted at module load
// (this file is imported at boot) rather than in a test, because a test only fails where it runs.
if (Object.keys(BY_CODE).length !== FIT_IDS.length) {
  throw new Error('trucking/fittings: two fittings share a code — see the ⚠ above');
}

// What is actually on a truck, filtered against the catalog (a row carrying an id that has since
// been retired wears nothing, rather than crashing a renderer) and deduplicated by SLOT, with the
// first mention winning. The slot filter is here rather than at the write, because the write is not
// the only way a row can get into this state: a hand-edited bag, an old row, or a fitting that
// CHANGES slot in a later build would all otherwise put two bars on one truck.
export function installedFits(cd) {
  const raw = Array.isArray(cd?.fits) ? cd.fits : [];
  const seen = new Set(), out = [];
  for (const id of raw) {
    const f = FITTINGS[id];
    if (!f || seen.has(f.slot)) continue;
    seen.add(f.slot); out.push(id);
  }
  return out;
}

export const fitInSlot = (cd, slot) => installedFits(cd).find((id) => FITTINGS[id].slot === slot) || null;

// ── The wire ─────────────────────────────────────────────────────────────────
// The suffix appended to the mesh variant. Sorted by the SLOT ORDER rather than by the order they
// were bought, which is what makes the string canonical: the same truck must always produce the
// same key or the client's mesh cache holds one entry per permutation of the same rig.
export function fitSuffix(cd) {
  const fits = installedFits(cd);
  if (!fits.length) return '';
  const order = SLOTS.map((s) => s.id);
  const codes = fits
    .sort((a, b) => order.indexOf(FITTINGS[a].slot) - order.indexOf(FITTINGS[b].slot))
    .map((id) => FITTINGS[id].code);
  return '^' + codes.join('.');
}

// The whole mesh key for a truck, in one place — because it is assembled at five call sites (the
// cab, the contact list, the depot floor, the walkaround, the dealer) and a suffix appended at four
// of them is a truck that wears its bull bar everywhere except the one view you bought it for.
export function truckVariant(typeId, { trailer = false, parked = false, cd = null } = {}) {
  return `${typeId || 'hauler'}${trailer ? '+t' : ''}${parked ? '~p' : ''}${cd ? fitSuffix(cd) : ''}`;
}

// A fitting is owned once. Re-fitting one you already own is free — see rule 5 — so the price is
// only ever charged on a code that is not already in the bag.
export const ownsFit = (cd, id) => Array.isArray(cd?.owned_fits) && cd.owned_fits.includes(id);
export function priceFor(cd, id) {
  const f = FITTINGS[id];
  if (!f) return null;
  return ownsFit(cd, id) ? 0 : f.price;
}
