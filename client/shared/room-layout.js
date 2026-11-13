// THE ROOM STAGE'S LAYOUT: one room, described once, for every 3-D interior you walk round in first
// person (docs/proposals/room-stage.md). Pure: no DOM, no GL, so the server stamps a placed piece's
// spot with the same rules the client lays the room out by, and a gate runs it in Node.
//
// A room is a SPEC and its PIECES.
//
//   spec    { w, d, h, unit, at, face, floor, door, window, windows, finish, annex }. `unit` is 'm'
//           (a flat, the default) or 'ft' (the Platinum Box suite, in the ballpark's feet). `at` is
//           the middle of the front wall on the ground in the host's own frame and `face` the way the
//           front wall looks (degrees from +z toward +x); a standalone room leaves both out and sits
//           at the origin. `door` is [u0, u1] along the back wall; `window` is [u0, u1, y0, y1] in
//           the front wall, and `windows` every pane in the room, each { wall, a, b, y0, y1, kind },
//           with `kind` 'sash' (a timber window) or 'curtain' (floor-to-ceiling glass on a black
//           frame). `annex` is an en-suite behind the back wall (annexFrame). `plan` is the studio
//           the floor is divided into (studioPlan). `balcony` is { door: [u0, u1], u: [u0, u1], d }:
//           the door in the front wall and the deck past it, which is in front of v = 0. With `wrap`
//           the deck runs right round the building, and `wrap` is the v of the building's back face,
//           behind any en-suite (onBalcony says which side of the walls a spot is).
//   pieces  what stands in it. A furnished piece is { id, name, arche, spot, dims?, verbs? }, its
//           shape from its archetype; a fitted one (the suite's bar, its club chairs) carries its own
//           `seats`, `stations`, `solid` and `climb` in the room's frame instead.
//
// The room's frame is the suite's: u across (right as you face the front wall), v back from the
// front wall, y up off the floor. The front wall is the glass in the suite and the window in a flat;
// the door is in the back wall in both.
//
// A spot is { wall, along, turn } for a piece against a wall ('left', 'right', 'front', 'back';
// `along` is its u on the front and back walls, its v on the side walls), or { at: [u, v], turn } for
// one standing in the room. `turn` is degrees: 0 faces the front wall, 90 the right-hand wall.
//
// ⚠ THE LOOK COMES FROM DATA, NEVER FROM A NAME (home-stage.md rule 3). `archetypeOf` reads the
// item's flags and its weight; nothing here knows a sofa is called "busted".

export const FT_PER_M = 3.2808;
// forms that stand at the room's floor level wherever they are, a pit under them or not
const RAISED = new Set(['stage', 'runway']);

// A flat with no `flags.room`: eight metres across, ten deep, 2.7 high, the window in the front wall
// and the door at the back by the right-hand corner. That's what a studio needs to keep its kitchen,
// its bed and its lounge apart with room to walk between them.
export const FLAT_ROOM = Object.freeze({ w: 8, d: 10, h: 2.7 });

// ── the studio ──────────────────────────────────────────────────────────────────────────────────
// A flat is one room, so the plan does what walls would. You come in at the back right, into a clear
// lobby. Ahead of you the kitchen runs down the right-hand wall, shut off from the rest by an L of
// counter: a long side facing the lounge, and a return at the front end back to the wall, so the only
// way in is from the lobby. The bed takes the back left, by the en-suite. The lounge has the front of
// the room and the windows.
//
//   counter, ret, run   what's built in, [u0, u1, v0, v1]: the counter's long side, its return, and
//                       the fitted units along the wall. A walker can't stand in them
//   kitchen             the whole block, counter and aisle and units. Only a kitchen's pieces go here
//   lobby               the way in. Nothing goes here
//   living, sleep       where the lounge's pieces and the bedroom's go
//
// A room too small for it (under 6.5 × 7.5, or `flags.room.studio: false`) has no plan and is
// furnished wall by wall.
const STUDIO = Object.freeze({ lobby: 2.2, kitchen: 2.75, counter: 0.95, run: 0.7, sleep: 4.4, top: 0.92 });
export const COUNTER_H = STUDIO.top;
export function studioPlan(w, d, door) {
  if (w < 6.5 || d < 7.5) return null;
  const hu = w / 2, v1 = d - STUDIO.lobby, v0 = Math.max(2.6, v1 - Math.min(6.5, Math.max(4, d * 0.48)));
  const u0 = hu - STUDIO.kitchen, u1 = u0 + STUDIO.counter, sv = d - Math.min(STUDIO.sleep, d * 0.42), lu = door[0] - 0.6;
  const r = (q) => q.map((x) => +x.toFixed(2));
  return { counter: r([u0, u1, v0, v1]), ret: r([u1, hu, v0, v0 + STUDIO.run]), run: r([hu - STUDIO.run, hu, v0 + STUDIO.run, v1]), kitchen: r([u0, hu, v0, v1]),
    lobby: r([lu, hu, v1, d]), living: r([-hu, u0, 0, sv]), sleep: r([-hu, lu, sv, d]) };
}

// ── archetypes ──────────────────────────────────────────────────────────────────────────────────
// What a piece is drawn as and what a body can do with it. `dims` is [w, d, h] in metres at the
// reference weight `ref` (grams); a piece scales by the cube root of its weight against it, held to
// SIZE_RANGE so a featherweight ghost screen is still a screen. `wall` pieces stand with their back
// to a wall; the rest stand in the room. `verb` is the gesture F or a click sends.
export const ARCHETYPES = Object.freeze({
  seat:    { dims: [0.55, 0.55, 0.9],  ref: 6000,   wall: false, verb: 'sit' },
  wardrobe:{ dims: [1.5, 0.62, 2.15],  ref: 90000,  wall: true,  verb: 'open' },
  cabinet: { dims: [1.2, 0.34, 0.72],  ref: 25000,  wall: true,  verb: 'open' },
  store:   { dims: [0.9, 0.5, 1.1],    ref: 30000,  wall: true,  verb: 'open' },
  sink:    { dims: [1.6, 0.62, 0.92],  ref: 40000,  wall: true,  verb: 'examine' },
  toilet:  { dims: [0.42, 0.7, 0.8],   ref: 30000,  wall: true,  verb: 'examine' },
  shower:  { dims: [1.0, 1.0, 2.15],   ref: 80000,  wall: true,  verb: 'examine' },
  deck:    { dims: [1.2, 0.42, 0.46],  ref: 12000,  wall: true,  verb: 'examine' },
  table:   { dims: [1.1, 0.6, 0.42],   ref: 15000,  wall: false, verb: 'examine' },
  top:     { dims: [0.24, 0.2, 0.26],  ref: 1500,   wall: false, verb: 'examine' },
  bench:   { dims: [1.4, 0.55, 0.85],  ref: 15000,  wall: true,  verb: 'sit' },
  sofa:    { dims: [2.0, 0.9, 0.85],   ref: 25000,  wall: true,  verb: 'sit' },
  bed:     { dims: [1.0, 2.05, 0.7],   ref: 60000,  wall: true,  verb: 'lie' },
  screen:  { dims: [1.1, 0.12, 0.66],  ref: 12000,  wall: true,  verb: 'watch' },
  cold:    { dims: [0.7, 0.68, 1.8],   ref: 50000,  wall: true,  verb: 'open' },
  hob:     { dims: [0.6, 0.62, 0.92],  ref: 25000,  wall: true,  verb: 'examine' },
  surface: { dims: [1.4, 0.62, 0.92],  ref: 40000,  wall: true,  verb: 'examine' },
  small:   { dims: [0.36, 0.26, 0.5],  ref: 5000,   wall: false, verb: 'examine' },
  prop:    { dims: [0.6, 0.45, 1.7],   ref: 18000,  wall: true,  verb: 'examine' },
  fireplace:{ dims: [1.8, 0.6, 1.7],  ref: 400000, wall: true,  verb: 'examine' },
});
const SIZE_RANGE = [0.82, 1.22];

// The archetype an item's flags and weight make it. `flags.look.arche` overrides, the way
// `tags.matter` overrides `food_profile`. `type` is the furniture row's `object_type`, which is all a
// toilet or a shower has to say what it is.
export function archetypeOf(flags = {}, grams = 0, type = '') {
  const ix = Array.isArray(flags.interactions) ? flags.interactions : [];
  if (flags.look?.arche && ARCHETYPES[flags.look.arche]) return flags.look.arche;
  if (type === 'toilet' || flags.toilet) return 'toilet';
  if (type === 'shower') return 'shower';
  if (type === 'sink' || flags.water_source) return 'sink';
  if (type === 'media_deck' || flags.media_deck || flags.beta_player) return 'deck';
  // a chem lab is a bench and its hood, though its row is a container (it's the lab's vault)
  if (flags.crafting_station === 'chem_lab') return 'surface';
  if (type === 'bed' || flags.bed) return 'bed';
  if (flags.tv || ix.includes('watch')) return 'screen';
  if (flags.wardrobe) return 'wardrobe';
  if (flags.dish_cabinet) return 'cabinet';
  if (flags.preserves) return 'cold';
  if (Number(flags.container) > 0 || type === 'container') return 'store';
  if (flags.brew_tier) return 'top';
  if (flags.stove_tier || flags.microwave) return 'hob';
  if (ix.includes('sit') && ix.includes('lie')) return 'sofa';
  if (ix.includes('lie')) return 'bed';
  if (ix.includes('sit')) return grams > 10000 ? 'bench' : 'seat';
  if (ix.includes('lift')) return 'small';
  if (ix.includes('lean')) return 'surface';
  return 'prop';
}

// The shape within an archetype, from the same flags and weight: a deep-freeze is a chest, a heavy
// lie-only piece is a pod, a light sit-and-lie piece is a cot. `flags.look.form` overrides.
export const FORMS = Object.freeze({
  seat: ['stool', 'chair', 'armchair', 'office', 'stools'], bench: ['bench', 'booth', 'banquette', 'slab'], sofa: ['sofa', 'cot', 'lounger'], bed: ['bed', 'pod', 'platform', 'mattress', 'pressbench'],
  screen: ['flat', 'crt', 'slab'], cold: ['fridge', 'double', 'chest', 'column'], hob: ['cooktop', 'range', 'microwave', 'seam'],
  surface: ['counter', 'desk', 'rail', 'barwall', 'chemwall', 'bar', 'stage', 'runway', 'reception', 'console', 'treadmill', 'pool', 'pcdesk'], small: ['heater', 'box', 'plinth', 'telescope', 'lacquer', 'boombox', 'smoketable'], prop: ['cabinet', 'piano', 'fountain', 'catstatue', 'lantern', 'bonsai', 'vat', 'tank', 'morphex', 'jukebox'], fireplace: ['hearth', 'firetrough'],
  wardrobe: ['wardrobe', 'valet'], cabinet: ['cupboard', 'vitrine', 'humidor', 'rack'], store: ['shelves', 'locker', 'crate', 'weights'],
  sink: ['kitchen', 'basin', 'trough'], toilet: ['pan', 'hung'], shower: ['stall', 'wetroom', 'bath', 'soak'],
  deck: ['console', 'portable'], table: ['coffee', 'dining', 'games', 'poker'], top: ['kettle', 'press'],
});
export function formOf(arche, flags = {}, grams = 0, { annex = false } = {}) {
  if (flags.look?.form && FORMS[arche]?.includes(flags.look.form)) return flags.look.form;
  switch (arche) {
    case 'seat': return grams && grams < 4500 ? 'stool' : 'chair';
    case 'bench': return grams >= 18000 ? 'booth' : 'bench';
    case 'sofa': return grams && grams < 8000 ? 'cot' : 'sofa';
    case 'bed': return grams >= 40000 ? 'pod' : 'bed';
    case 'screen': return flags.tv_skin === 'crt' ? 'crt' : grams && grams <= 4000 ? 'slab' : 'flat';
    // a freezer that pairs with a fridge stands beside it as a tall column; alone it's a chest
    case 'cold': return flags.preserves === 'frozen' ? (flags.paired_container ? 'column' : 'chest') : Number(flags.container) >= 100000 ? 'double' : 'fridge';
    case 'hob': return flags.microwave ? 'microwave' : flags.stove_tier === 'mid' || flags.stove_tier === 'high' ? 'range' : 'cooktop';
    case 'surface': return flags.crafting_station === 'chem_lab' ? 'chemwall' : flags.conceal_brand ? 'barwall' : grams && grams < 8000 ? 'rail' : grams && grams < 30000 ? 'desk' : 'counter';
    case 'wardrobe': return Number(flags.container) >= 100000 ? 'valet' : 'wardrobe';
    case 'cabinet': return 'cupboard';
    case 'store': return Number(flags.container) >= 60000 ? 'shelves' : Number(flags.container) >= 15000 ? 'locker' : 'crate';
    // a bathroom's basin hangs on the wall; a flat's sink is a run of base units
    case 'sink': return annex ? 'basin' : 'kitchen';
    case 'toilet': return 'pan';
    case 'shower': return 'stall';
    case 'deck': return flags.portable || (flags.mini_deck && !flags.deck_style) ? 'portable' : 'console';
    case 'table': return 'coffee';
    case 'top': return 'kettle';
    case 'small': return flags.heater_target_c || flags.heater_battery_min ? 'heater' : 'box';
    case 'fireplace': return 'hearth';
    default: return 'cabinet';
  }
}
// How much of a lacquered box's height is its body; the rest is the lid (gl/room-stash.js).
export const LACQUER_BODY = 0.72;
// what a form's footprint is when it isn't its archetype's, [w, d, h] at the reference weight
const FORM_DIMS = { chest: [1.3, 0.72, 0.88], double: [1.3, 0.75, 2.0], range: [0.76, 0.66, 0.92], cooktop: [0.6, 0.52, 0.86],
  desk: [1.2, 0.6, 0.76], rail: [1.2, 0.12, 1.0], cot: [1.9, 0.75, 0.5], pod: [1.1, 2.15, 1.1], stool: [0.42, 0.42, 0.74], booth: [1.5, 0.7, 1.15],
  column: [0.62, 0.68, 2.0], seam: [1.2, 0.62, 0.92], barwall: [2.2, 0.46, 2.3], chemwall: [2.4, 0.72, 2.3], armchair: [0.82, 0.84, 0.92], office: [0.68, 0.68, 1.24], pcdesk: [1.9, 1.9, 0.75], platform: [2.6, 2.25, 0.62], mattress: [1.0, 2.0, 0.26],
  valet: [2.2, 0.64, 2.3], vitrine: [1.0, 0.36, 1.9], humidor: [0.8, 0.48, 1.45], rack: [0.7, 0.3, 0.5], shelves: [1.2, 0.42, 1.9], locker: [0.6, 0.52, 1.8], crate: [0.72, 0.5, 0.44],
  basin: [0.62, 0.46, 0.88], trough: [1.4, 0.5, 0.86], hung: [0.38, 0.56, 0.82], wetroom: [1.3, 1.1, 2.2], bath: [0.8, 1.75, 0.6], soak: [1.0, 2.0, 0.66],
  portable: [0.5, 0.36, 0.2], dining: [1.6, 0.86, 0.76], press: [0.3, 0.36, 0.4], bar: [3.2, 0.8, 1.12],
  reception: [3.4, 0.85, 1.1], console: [1.3, 0.38, 0.82], plinth: [0.4, 0.4, 1.1], slab: [1.6, 0.5, 0.45],
  // a lacquered stash box on a bar top (gl/room-fittings.js; its lid is gl/room-stash.js's)
  lacquer: [0.36, 0.24, 0.12],
  // a balcony's (gl/room-decor.js): a boombox that opens the AMP player, and a drum table of smokes
  boombox: [0.66, 0.2, 0.36], smoketable: [0.56, 0.56, 0.5],
  // a club's, a gym's and a roof deck's (gl/room-decor.js): a sun lounger, a bench press, a treadmill, a raised pool,
  // a telescope on its tripod, an upright piano, a dumbbell rack, a chess table and a fire trough
  lounger: [1.95, 0.72, 0.75], pressbench: [1.3, 1.75, 1.2], treadmill: [0.85, 1.9, 1.4], pool: [3, 2, 0.5], telescope: [0.6, 0.6, 1.55],
  piano: [1.5, 0.65, 1.25], weights: [1.6, 0.6, 0.95], games: [0.8, 0.8, 0.74], poker: [2.5, 1.45, 0.78], firetrough: [2, 0.6, 0.45],
  // a calm flat's (gl/room-decor.js): a slate wall fountain, a paper floor lantern, a bonsai on its stand
  fountain: [0.8, 0.36, 1.15], catstatue: [0.62, 0.5, 1.25], lantern: [0.42, 0.42, 1.4], bonsai: [0.62, 0.42, 0.95],
  // a clone facility's (gl/room-decor.js): a print vat with somebody in it, a squat dogged tank, and the MORPHEX pod
  vat: [1.1, 1.1, 2.4], tank: [1.2, 1.2, 1.3], morphex: [1.5, 1.4, 2.55],
  // an old bar's (gl/room-saloon.js): a run of stools along it, a seat every STOOL_PITCH, and a jukebox
  stools: [3.2, 0.45, 0.76], jukebox: [0.95, 0.62, 1.55] };
// How far apart the stools in a run stand, and how many a run of width w (metres) has (gl/room-saloon.js draws them)
export const STOOL_PITCH = 0.8;
export const stoolsAlong = (w) => Math.max(1, Math.round(w / STOOL_PITCH));

// A piece's [w, d, h] in metres: its form's or archetype's, scaled by its weight, or `flags.look.dims`.
export function dimsOf(arche, grams = 0, flags = {}, ctx = {}) {
  const A = ARCHETYPES[arche] || ARCHETYPES.prop;
  const own = flags.look?.dims;
  if (Array.isArray(own) && own.length === 3 && own.every((x) => Number.isFinite(x) && x > 0)) return own.slice();
  // a microwave is a hob's footprint at a third of its height, on the stand it's set down on
  if (arche === 'hob' && flags.microwave) return [0.5, 0.4, 0.86];
  const fd = FORM_DIMS[formOf(arche, flags, grams, ctx)];
  if (fd) return fd.map((x) => x * Math.max(0.9, Math.min(1.1, grams > 0 ? Math.cbrt(grams / A.ref) : 1)));
  let s = grams > 0 ? Math.cbrt(grams / A.ref) : 1;
  s = Math.max(SIZE_RANGE[0], Math.min(SIZE_RANGE[1], s));
  // a bench or sofa grows along its length, not deeper; a bed keeps a body's length
  if (arche === 'bench' || arche === 'sofa') return [A.dims[0] * s, A.dims[1] * Math.sqrt(s), A.dims[2]];
  if (arche === 'bed') return [A.dims[0] * s, A.dims[1], A.dims[2] * s];
  return A.dims.map((x) => x * s);
}

// ── the frame ───────────────────────────────────────────────────────────────────────────────────
const DEG = Math.PI / 180;
// how many of the spec's units are a metre, and a foot
const unitsPerM = (spec) => (spec.unit === 'ft' ? FT_PER_M : 1);
const unitsPerFt = (spec) => unitsPerM(spec) / FT_PER_M;

// The way a turn faces, as [du, dv]: 0 the front wall, 90 the right-hand wall.
export function facing(turn) { const a = (turn || 0) * DEG; return [Math.sin(a), -Math.cos(a)]; }
const WALL_TURN = { left: 90, right: -90, front: 180, back: 0 };
// A cabinet's underside off the floor: over a worktop with half a metre of air under it.
export const HUNG_AT = 1.45;
const hungOf = (arche, form) => arche === 'cabinet' && form !== 'vitrine' && form !== 'humidor';
export const WALL_T = 0.14;   // how thick the wall between a room and its en-suite is, in metres

// Where a furnished piece stands: { u, v, turn, w, d, h } in the spec's units.
export function resolveSpot(spec, spot, dims) {
  const k = unitsPerM(spec), hu = spec.w / 2, D = spec.d;
  const [w, d, h] = dims.map((x) => x * k);
  // a spot is in metres whatever the room's unit
  if (spot?.wall && WALL_TURN[spot.wall] !== undefined) {
    const turn = WALL_TURN[spot.wall] + (spot.turn || 0), a = (Number(spot.along) || 0) * k, off = d / 2 + 0.02 * k;
    const at = spot.wall === 'left' ? [-hu + off, a] : spot.wall === 'right' ? [hu - off, a] : spot.wall === 'front' ? [a, off] : [a, D - off];
    // `y` hangs a wall piece with its middle that high (a set over a reception desk); unset, its own height
    return { u: at[0], v: at[1], turn, w, d, h, wall: spot.wall, ...(Number.isFinite(spot.y) ? { mount: spot.y * k } : {}) };
  }
  const at = Array.isArray(spot?.at) ? [spot.at[0] * k, spot.at[1] * k] : [0, D / 2];
  return { u: at[0], v: at[1], turn: spot?.turn || 0, w, d, h, wall: null };
}

// A piece's footprint, [u0, u1, v0, v1]: its rectangle turned to the nearest quarter (pieces stand
// square to the walls or near enough; a few degrees off still collides as square).
function footprint(p) {
  const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
  return [p.u - hw, p.u + hw, p.v - hd, p.v + hd];
}

// A corner desk's two runs in its own frame, [x0, x1, z0, z1]: one along its back, one down its +x
// side, each `PCDESK_RUN` deep. Shared with the drawing (gl/room-office.js), so the walker meets what's drawn.
export const PCDESK_RUN = 0.7;
export function pcdeskRuns(p, k = 1) {
  const hw = p.w / 2, hd = p.d / 2, D = PCDESK_RUN * k;
  return [[-hw, hw, -hd, -hd + D], [hw - D, hw, -hd + D, hd]];
}
// What a placed piece takes up on the floor, as [u0, u1, v0, v1] boxes: its footprint, or a corner
// desk's two runs (so the chair in the square they hold stands clear of it).
export function pieceBoxes(p, k = 1) {
  if (p.form !== 'pcdesk') return [footprint(p)];
  const [fu, fv] = facing(p.turn), su = -fv, sv = fu, pt = (x, z) => [p.u + su * x + fu * z, p.v + sv * x + fv * z];
  return pcdeskRuns(p, k).map((q) => { const a = pt(q[0], q[2]), b = pt(q[1], q[3]); return [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]; });
}

// ── what each archetype gives the room ──────────────────────────────────────────────────────────
// Seats with their eyes, stations with a reach, and what a walker can't stand in or climbs over.
// `x` across the piece (the sitter's right as they face out of it) and `z` out of its front.
function contribute(spec, p) {
  const k = unitsPerM(spec), [fu, fv] = facing(p.turn), su = -fv, sv = fu;
  const pt = (x, z) => [p.u + su * x + fu * z, p.v + sv * x + fv * z];
  const out = { seats: [], stations: [], solid: [], climb: [] };
  const fp = footprint(p), seatY = 0.46 * k, eye = 1.18 * k;
  const seat = (kind, x, z, o = {}) => {
    const [u, v] = pt(x, z);
    out.seats.push({ kind, u, v, y: o.y ?? eye, dir: o.dir || [fu, fv], pitch: o.pitch ?? -0.08, piece: p.id, verb: o.verb || 'sit', ...(o.lie ? { lie: true, head: o.head, top: o.top } : {}), ...(o.back != null ? { back: o.back } : {}), ...(o.lift ? { lift: o.lift } : {}) });
  };
  // How far out of a deep piece a sitter's hips come. The sit clip's knees are a thigh (0.43 m) ahead
  // of them and its shins drop straight down, so the knees have to clear the front or the shins go
  // through it. A shallow chair's own spot is already clear.
  const clearKnees = (z) => Math.max(z, p.d / 2 - 0.35 * k);
  const station = (y, reach = 0.95) => { const [u, v] = pt(0, p.d / 2 + 0.05 * k); out.stations.push({ target: p.name, piece: p.id, verb: p.verb, u, v, y: y * k, reach: reach * k, at: [p.u, p.v] }); };
  switch (p.arche) {
    case 'seat':
      // a stool's top is well over a chair's, so the sitter is raised by the difference (metres, the body's lift)
      if (p.form === 'stool') { const lift = Math.max(0, p.h / k - 0.46); seat('chair', 0, 0, { lift, y: eye + lift * k }); out.climb.push([...fp, p.h]); break; }
      // a run of stools: a raised seat on each, along the piece
      if (p.form === 'stools') {
        const lift = Math.max(0, p.h / k - 0.46), n = stoolsAlong(p.w / k);
        for (let i = 0; i < n; i++) seat('chair', (i - (n - 1) / 2) * p.w / n, 0, { lift, y: eye + lift * k });
        out.climb.push([...fp, p.h]); break;
      }
      seat('chair', 0, clearKnees(-0.04 * k)); out.climb.push([...fp, seatY]); break;
    case 'bench': {
      if (p.form === 'banquette') {
        // a ring of seat round a round pit, every one facing in and looking up at whatever's over
        // the middle; `gap` is the way in, degrees off the piece's front. It climbs nothing and
        // blocks nothing, so you walk round inside it
        const R = p.w / 2 - 0.35 * k, gap = (Number(p.gap) || 50) * DEG, n = Math.max(6, Math.round((2 * Math.PI * R - gap * R) / (0.7 * k)));
        for (let i = 0; i < n; i++) {
          const a = gap / 2 + (i + 0.5) * (2 * Math.PI - gap) / n, x = Math.sin(a) * R, z = Math.cos(a) * R, [u, v] = pt(x, z), len = Math.hypot(u - p.u, v - p.v) || 1;
          out.seats.push({ kind: 'banquette', u, v, y: eye, dir: [(p.u - u) / len, (p.v - v) / len], pitch: Number(p.lookUp) || 0.5, piece: p.id, verb: 'sit' });
        }
        break;
      }
      const n = Math.max(2, Math.round(p.w / (0.62 * k)));
      for (let i = 0; i < n; i++) seat('bench', (i - (n - 1) / 2) * p.w / n, clearKnees(0));
      out.climb.push([...fp, seatY]); break;
    }
    case 'sofa': {
      // a sun lounger is for lying on: no seats across it, just the one along it, the head up the raised back
      if (p.form === 'lounger') {
        seat('lie', -p.w / 2 + 0.4 * k, 0, { y: 0.62 * k, lie: true, verb: 'lie', pitch: 0.1, head: [fv, -fu], top: 0.4 * k });
        out.climb.push([...fp, 0.4 * k]); break;
      }
      const n = Math.max(2, Math.min(3, Math.round(p.w / (0.62 * k))));
      // `back`: metres from the seat spot back to the back cushions' face (gl/room-mesh.js sofa: -hd + 0.33),
      // so a sitter who leans back rests on them rather than through them (gl/room-people.js)
      const sz = clearKnees(-0.06 * k), back = (sz + p.d / 2) / k - 0.33;
      for (let i = 0; i < n; i++) seat('sofa', (i - (n - 1) / 2) * (p.w - 0.4 * k) / n, sz, { back });
      // lying along it: the head at the left arm, looking across the room; `head` is the way from
      // the feet to the head, `top` what the body lies on
      seat('lie', -p.w / 2 + 0.4 * k, 0, { y: 0.78 * k, lie: true, verb: 'lie', pitch: 0.05, head: [fv, -fu], top: 0.44 * k });
      out.climb.push([...fp, 0.44 * k]); break;
    }
    case 'bed':
      // the head against the wall, the eye on the pillow looking down the bed
      seat('lie', 0, -p.d / 2 + 0.35 * k, { y: (p.form === 'mattress' ? 0.58 : p.form === 'platform' ? 0.88 : 0.75) * k, lie: true, verb: 'lie', pitch: 0.12, head: [-fu, -fv], top: (p.form === 'pod' ? 0.42 : p.form === 'mattress' ? 0.22 : p.form === 'platform' ? 0.5 : 0.38) * k });
      out.climb.push([...fp, (p.form === 'mattress' ? 0.24 : 0.55) * k]); break;
    case 'screen': {
      // a set on a stand stands on the floor; a flat one hangs on the wall and blocks nothing
      if (p.crt) out.solid.push(fp);
      station(p.crt ? 0.8 : p.mount ? p.mount / k : 1.25, 2.2); break;
    }
    case 'small': out.solid.push(fp); station(0.3, 0.9); break;
    // a shower stall or a wet room is somewhere you walk into: only its tiled back is solid, and its station is
    // where you stand under the head (gl/room-plumbing.js draws the water there). A bath stays a thing you walk round.
    case 'shower': {
      if (p.form === 'bath' || p.form === 'soak') { out.solid.push(fp); station(Math.min(p.h / k, 1.1) * 0.9, 1.1); break; }
      const [a, b2] = [pt(-p.w / 2, -p.d / 2), pt(p.w / 2, -p.d / 2 + 0.06 * k)];
      out.solid.push([Math.min(a[0], b2[0]), Math.max(a[0], b2[0]), Math.min(a[1], b2[1]), Math.max(a[1], b2[1])]);
      const [u, v] = pt(0, 0);
      out.stations.push({ target: p.name, piece: p.id, verb: p.verb, u, v, y: 1.1 * k, reach: 0.9 * k, at: [p.u, p.v] });
      break;
    }
    // a toilet: solid, a station for pee and flush, and a seat over the bowl, which is where `poop` puts
    // you (the server sits you on it by name). Hips just ahead of the cistern; the knees clear the front
    case 'toilet':
      out.solid.push(fp); station(0.5, 1.0);
      seat('toilet', 0, clearKnees(-p.d / 2 + (p.form === 'hung' ? 0.3 : 0.36) * k), { verb: 'poop', y: eye - 0.04 * k });
      break;
    // a thing on a worktop stands in its base's footprint; a hung cabinet has the floor free under it
    case 'top': station(((p.rise || 0) / k) + 0.12, 1.3); if (!p.rise) out.solid.push(fp); break;
    case 'cabinet': if (hungOf(p.arche, p.form)) station(HUNG_AT + 0.3, 1.5); else { out.solid.push(fp); station(1.1, 1.1); } break;
    case 'hob': case 'surface':
      // a corner desk is an L round the corner it stands in (gl/room-office.js): its two runs are solid
      // and the square they hold is free, for the chair; you work at it from that square
      if (p.form === 'pcdesk') {
        out.solid.push(...pieceBoxes(p, k));
        const [u, v] = pt(-0.05 * k, 0.05 * k);
        out.stations.push({ target: p.name, piece: p.id, verb: p.verb, u, v, y: 0.9 * k, reach: 1.3 * k, at: [p.u, p.v] });
        break;
      }
      // a Cachet: its keypad, and once it's turned the bench, with the keypad at its end to shut it
      if (p.keypad) {
        out.solid.push(fp);
        const [ku, kv] = pt(p.w / 2 - 0.2 * k, p.d / 2 + 0.05 * k), keypad = { target: p.name, piece: p.id, verb: 'keypad', u: ku, v: kv, y: 1.15 * k, reach: 1.2 * k, at: [p.u, p.v] };
        if (p.turned) { const [wu, wv] = pt(-0.3 * k, p.d / 2 + 0.05 * k); out.stations.push({ target: p.turned, piece: p.id, verb: 'workspace', u: wu, v: wv, y: 1.0 * k, reach: 1.3 * k, at: [p.u, p.v] }); }
        out.stations.push(keypad);
        break;
      }
      // a chem lab standing on its own: its bench opens the workspace, as a turned Cachet's does
      if (p.lab) {
        out.solid.push(fp);
        const [wu, wv] = pt(-0.3 * k, p.d / 2 + 0.05 * k);
        out.stations.push({ target: p.name, piece: p.id, verb: 'workspace', u: wu, v: wv, y: 1.0 * k, reach: 1.3 * k, at: [p.u, p.v] });
        break;
      }
      if (p.rise) { station((p.rise / k) + 0.15, 1.3); break; }
      out.solid.push(fp); station(Math.min(p.h / k, 1.1) * 0.9, 1.0); break;
    default: out.solid.push(fp); station(Math.min(p.h / k, 1.1) * 0.9, 1.1);
  }
  // down in a pit, everything a body does with it is that much lower
  if (p.y0) {
    for (const s of out.seats) { s.y += p.y0; if (s.top !== undefined) s.top += p.y0; }
    for (const s of out.stations) s.y += p.y0;
    for (const c of out.climb) c[4] += p.y0;
  }
  return out;
}

// ── a sunken floor ──────────────────────────────────────────────────────────────────────────────
// `spec.pit` is { u0, u1, v0, v1, depth, step }, in metres: a rectangle let into the floor, with a ledge
// (or, with `round`, a circle { cu, cv, r } whose u0..v1 is its bounding square)
// `step` wide all round it at half the depth, so you walk down into it anywhere. How far below the
// room's floor (u, v) is: 0 on the floor, a negative height in the pit. A piece whose middle is on
// the pit's floor stands on it (`y0`); roomLayout lowers its seats and gl/room-mesh.js draws it there.
export function pitFloorAt(S, u, v) {
  const q = S.pit;
  if (q?.round) {
    // a round pit (the Cherry Pit's): the ledge is a ring `step` wide inside the rim
    const dist = Math.hypot(u - q.cu, v - q.cv);
    return dist >= q.r ? 0 : dist < q.r - q.step ? -q.depth : -q.depth / 2;
  }
  if (!q || u <= q.u0 || u >= q.u1 || v <= q.v0 || v >= q.v1) return 0;
  return u > q.u0 + q.step && u < q.u1 - q.step && v > q.v0 + q.step && v < q.v1 - q.step ? -q.depth : -q.depth / 2;
}

// ── a stair between two floors ──────────────────────────────────────────────────────────────────
// docs/proposals/building-stage.md "Stairs". A flight is authored on the room it goes up from, as
// `flags.room.stair` { at: [u, v], climb, w }: `at` is the middle of its bottom step in that room's frame,
// `climb` the wall you face going up ('left', 'right', 'front' or 'back') and `w` its width in metres. It rises
// the room's own height, to the floor of the room the `up` exit reaches, which building-graph.js stacks on it.
// Both rooms get it as an opening (roomOpenings), `kind: 'stair'`, in their own frame: the room below with
// `wall: 'ceiling'` and the flight standing on its floor, the room above with `wall: 'floor'` and the flight
// falling away from its floor through a well (`y0` is where the bottom step is, -rise up there).
//
// On the flight `s` is metres along it from the bottom step and `x` metres across it. The bottom step is
// s 0..going; the last riser is at `len` and the floor above is the top step. `hole` is where the floor above is
// cut from, so nobody climbing hits their head; `cross` is where you go from one room to the other, as your eye
// passes through the floor above.
export const STAIR = Object.freeze({ riser: 0.19, going: 0.27, w: 1.1, rail: 0.05, headroom: 2.05, eye: 1.65, gap: 0.1 });
const CLIMB = Object.freeze({ right: [1, 0], left: [-1, 0], back: [0, 1], front: [0, -1] });
const r3 = (n) => Math.round(n * 1000) / 1000;
export function stairSpecOf(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.at) || v.at.length !== 2 || !v.at.every(Number.isFinite) || !CLIMB[v.climb]) return null;
  return { at: [v.at[0], v.at[1]], climb: v.climb, w: clampN(v.w, 0.8, 3, STAIR.w), going: clampN(v.going, 0.22, 0.35, STAIR.going) };
}
// A flight's numbers for a rise: as many risers as keep each under STAIR.riser
export function flightOf(st, rise) {
  const n = Math.max(2, Math.ceil(rise / STAIR.riser - 1e-6)), going = st.going || STAIR.going, len = r3((n - 1) * going), [du, dv] = CLIMB[st.climb];
  const hole = r3(Math.max(0, Math.min(len - 1, (Math.ceil((rise - STAIR.headroom) / (rise / n)) - 1) * going)));
  const cross = r3(Math.min(len - 0.4, Math.max(hole + 0.6, len * (rise - STAIR.eye) / rise)));
  return { foot: [st.at[0], st.at[1]], climb: [du, dv], w: st.w, rise: r3(rise), n, going, len, hole, cross, head: [r3(st.at[0] + du * len), r3(st.at[1] + dv * len)] };
}
// a room's stairs: its building's stair openings (roomOpenings)
export const stairsOf = (S) => (S?.openings || []).filter((o) => o.kind === 'stair' && Array.isArray(o.foot) && Array.isArray(o.climb));
// [s, x] of a point [u, v] on flight `o`; x runs as the room kit's frame() turns it (gl/room-kit.js)
export function flightLocal(o, u, v) {
  const du = u - o.foot[0], dv = v - o.foot[1], [cu, cv] = o.climb;
  return [du * cu + dv * cv, -du * cv + dv * cu];
}
// [u0, u1, v0, v1] covering s0..s1 along the flight and x0..x1 across it
export function flightBox(o, s0, s1, x0, x1) {
  const [cu, cv] = o.climb, P = (s, x) => [o.foot[0] + cu * s - cv * x, o.foot[1] + cv * s + cu * x];
  const ps = [P(s0, x0), P(s1, x0), P(s1, x1), P(s0, x1)];
  return [Math.min(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[1]))].map(r3);
}
// the well cut in the floor above: over the flight from `hole` to the top, and STAIR.gap past its sides
export const wellBox = (o) => flightBox(o, o.hole, o.len, -o.w / 2 - STAIR.gap, o.w / 2 + STAIR.gap);
// The height of the flight's going at `s`, in its room's frame: each step's tread (`stepped`), or the line up
// their noses that an eye walks, so climbing doesn't jolt. Null off the flight.
export function flightY(o, s, stepped = false) {
  if (s < -1e-3 || s > o.len + 1e-3) return null;
  const riser = o.rise / o.n;
  const y = stepped ? (s >= o.len ? o.rise : (Math.floor(s / o.going) + 1) * riser) : o.rise * Math.max(0, Math.min(1, s / o.len));
  return o.y0 + y;
}
// how much of the flight is walked in this room: from the bottom step below, from the foot of the well above
const flightSpan = (o) => (o.wall === 'ceiling' ? [0, o.len] : [o.hole, o.len]);
// The ground on a flight under [u, v], or null when it's not on one
function stairGround(S, u, v, stepped) {
  for (const o of stairsOf(S)) {
    const [s, x] = flightLocal(o, u, v), [a, b] = flightSpan(o);
    if (Math.abs(x) <= o.w / 2 && s >= a - 1e-3 && s <= b + 1e-3) return flightY(o, s, stepped);
  }
  return null;
}

// ── the layout ──────────────────────────────────────────────────────────────────────────────────
// Where a body can stand and sit, and what's in the way. Returns what booth-mesh.js's boothLayout
// always has: seats (each with its eye in the host's frame, a yaw and a pitch), stations, `solid`
// [u0, u1, v0, v1] and `climb` [u0, u1, v0, v1, y] boxes, world()/local(), the walkable bounds, a
// body's radius and groundAt; plus `placed`, the furnished pieces where they stand.
export function roomLayout(spec, pieces = []) {
  const w = spec.w || 4, d = spec.d || 5, h = spec.h || 2.6, floor = spec.floor || 0;
  const yaw = (spec.face || 0) * DEG, f = [Math.sin(yaw), 0, Math.cos(yaw)], r = [-Math.cos(yaw), 0, Math.sin(yaw)];
  const at = [spec.at?.[0] || 0, floor, spec.at?.[1] || 0];
  const world = (u, v, y) => [at[0] + r[0] * u - f[0] * v, floor + y, at[2] + r[2] * u - f[2] * v];
  const local = (p) => { const q = [p[0] - at[0], p[2] - at[2]]; return [q[0] * r[0] + q[1] * r[2], -(q[0] * f[0] + q[1] * f[2]), p[1] - floor]; };
  const S = { ...spec, w, d, h };
  const seats = [], stations = [], solid = [], climb = [], placed = [];
  const A = annexFrame(S);
  // a partition is a wall standing in the room, and a stairwell is a hole nobody walks into
  for (const q of S.walls || []) solid.push(q.slice(0, 4));
  for (const st of S.stairs || []) solid.push(st.box);
  // A flight to the next floor (stairsOf): a rail down each side and the end you can't step off, the top below
  // and the foot of the well above, so the flight is a lane you walk into from one end. One you can't take
  // (a one-way stair seen from the end it doesn't go from) is solid.
  for (const o of stairsOf(S)) {
    const hw = o.w / 2, rt = STAIR.rail, [a, b] = flightSpan(o);
    if (!o.dir) { solid.push(flightBox(o, a, b, -hw - rt, hw + rt)); continue; }
    solid.push(flightBox(o, a, b, hw, hw + rt), flightBox(o, a, b, -hw - rt, -hw));
    solid.push(o.wall === 'ceiling' ? flightBox(o, b, b + rt, -hw - rt, hw + rt) : flightBox(o, a - rt, a, -hw - rt, hw + rt));
  }
  // a column or a planter the room's finish stands on the floor (gl/room-decor.js)
  for (const q of decorSolids(S)) solid.push(q);
  // what's built in: nobody walks through the kitchen's units
  if (S.plan) solid.push(S.plan.counter, S.plan.ret, S.plan.run);
  // what stands on the floor first, so a kettle has its worktop to go on
  for (const pc of [...pieces].sort((a, b) => (a.spot?.on ? 1 : 0) - (b.spot?.on ? 1 : 0))) {
    if (pc.seats || pc.stations || pc.solid || pc.climb) {
      // a fitted piece: its own boxes and seats, already in the room's frame
      for (const s of pc.seats || []) seats.push({ ...s, piece: s.piece ?? pc.id });
      for (const st of pc.stations || []) stations.push({ ...st, piece: st.piece ?? pc.id });
      solid.push(...(pc.solid || [])); climb.push(...(pc.climb || []));
      continue;
    }
    const arche = ARCHETYPES[pc.arche] ? pc.arche : 'prop';
    let where;
    const base = pc.spot?.on === 'counter' ? counterBase(S) : pc.spot?.on ? placed.find((q) => q.id === pc.spot.on) : null;
    if (base) {
      // on a worktop: `x` along its base, set back to the base's middle, standing on its top
      const k = unitsPerM(S), [fu, fv] = facing(base.turn), su = -fv, sv = fu, x = (Number(pc.spot.x) || 0) * k, [w, d, h] = (pc.dims || dimsOf(arche)).map((n) => n * k);
      where = { u: base.u + su * x, v: base.v + sv * x, turn: base.turn + (pc.spot.turn || 0), w, d, h, wall: null, rise: base.h, on: base.id };
    } else if (pc.annex && A) {
      where = resolveSpot(A.spec, pc.spot, pc.dims || dimsOf(arche));
      where.u += A.cu; where.v += A.v0;
    } else where = resolveSpot(S, pc.spot, pc.dims || dimsOf(arche));
    // a stage or a runway stands at the floor's level even where it runs out over a pit
    const y0 = base ? base.y0 || 0 : RAISED.has(pc.form) ? 0 : pitFloorAt(S, where.u, where.v);
    const p = { ...pc, arche, ...where, verb: pc.verb || ARCHETYPES[arche].verb, crt: !!pc.crt, ...(y0 ? { y0 } : {}) };
    placed.push(p);
    const c = contribute(S, p);
    seats.push(...c.seats); stations.push(...c.stations); solid.push(...c.solid); climb.push(...c.climb);
  }
  // the seats numbered within their kind, as the suite's always were
  const nth = {};
  for (const s of seats) s.i = s.i ?? (nth[s.kind] = (nth[s.kind] ?? -1) + 1);
  const yawTo = (dir) => Math.atan2(dir[0], dir[2]);
  for (const s of seats) {
    s.eye = world(s.u, s.v, s.y);
    if (s.look) { const t = world(s.look[0], s.look[1], s.y); s.yaw = Math.atan2(t[0] - s.eye[0], t[2] - s.eye[2]); }
    else if (s.dir) s.yaw = yawTo([r[0] * s.dir[0] - f[0] * s.dir[1], 0, r[2] * s.dir[0] - f[2] * s.dir[1]]);
  }
  // the floor under a walker: the top of whatever they've climbed onto, felt a little past its edge,
  // and otherwise the room's floor or the pit let into it (`baseAt`, where a figure's feet go)
  const ft = unitsPerFt(S), edge = 0.3 * ft;
  // (on a stair, the tread under a figure's feet, and the line up the treads under a walker's eye)
  const baseAt = (u, v) => stairGround(S, u, v, true) ?? pitFloorAt(S, u, v);
  const groundAt = (u, v) => {
    let y = stairGround(S, u, v, false) ?? pitFloorAt(S, u, v);
    for (const [a, b, c, e, t] of climb) if (u > a - edge && u < b + edge && v > c - edge && v < e + edge) y = Math.max(y, t);
    return y;
  };
  const m = 0.9 * ft, radius = 0.6 * ft, bounds = [-w / 2 + m, w / 2 - m, m, d - m];
  // an en-suite is a second rectangle to walk in, joined to the room by the strip through its door,
  // and so is a balcony
  const rects = [bounds];
  if (S.balcony) {
    const [a, b] = S.balcony.door, [u0, u1] = S.balcony.u, rail = 0.25;
    rects.push([a + radius, b - radius, -WALL_T - rail, m + 0.02], [u0 + rail, u1 - rail, -WALL_T - S.balcony.d + rail, -WALL_T - 0.02]);
    if (S.balcony.wrap) {
      // round three sides (`sides`) the deck stops where the building's back face is; round all four it goes behind
      const vO = -WALL_T - S.balcony.d + rail, vB = S.balcony.sides ? S.balcony.wrap - rail : S.balcony.wrap + S.balcony.d - rail, side = w / 2 + WALL_T + 0.02;
      rects.push([side, u1 - rail, vO, vB], [u0 + rail, -side, vO, vB]);
      if (!S.balcony.sides) rects.push([u0 + rail, u1 - rail, S.balcony.wrap + 0.02, vB]);
    }
  }
  if (A) {
    const [a, b] = S.annex.door, e = 0.02;
    rects.push([a + radius, b - radius, d - m - e, A.v0 + m + e], [A.u0 + m, A.u1 - m, A.v0 + m, A.v0 + S.annex.d - m]);
  }
  // a building's open doorways (docs/proposals/building-stage.md): a strip through the wall and a step
  // past it, far enough that openingCrossed sees you go through; through a flat's back wall, the hall
  // beside its en-suite first (hallOf)
  for (const o of doorwaysOf(S)) {
    const hall = hallOf(S, o);
    if (hall) rects.push([hall.a + m, hall.b - m, d - m - 0.02, hall.v1 - m + 0.02]);
    rects.push(openingStrip(S, o, m, radius));
  }
  // a flight's lane, walkable to the room's wall where it stands against one, and on to the floor past its open end
  for (const o of stairsOf(S)) if (o.dir) { const [a, b] = flightSpan(o), e = 0.02; rects.push(flightBox(o, a - (o.wall === 'ceiling' ? e : 0), b + (o.wall === 'floor' ? e : 0), -o.w / 2, o.w / 2)); }
  // (a lift car's buttons aren't stations: they're on the hologram off its panel, room-lift.js)
  const outer = rects.reduce((o, q) => [Math.min(o[0], q[0]), Math.max(o[1], q[1]), Math.min(o[2], q[2]), Math.max(o[3], q[3])], bounds);
  return { spec: S, w, d, h, floor, f, r, at, yaw, world, local, seats, stations, solid, climb, placed,
    bounds, rects, outer, annex: A, radius, unit: S.unit === 'ft' ? 'ft' : 'm', ft, groundAt, baseAt };
}
// The studio's counter as a worktop, for `{ on: 'counter', x }`: `x` along it from its middle, and
// whatever stands on it faces the kitchen.
function counterBase(S) {
  const c = S.plan?.counter;
  return c ? { id: 'counter', u: (c[0] + c[1]) / 2, v: (c[2] + c[3]) / 2, turn: 90, w: c[3] - c[2], h: STUDIO.top } : null;
}

// ── a building's doorways ───────────────────────────────────────────────────────────────────────
// `spec.openings` is [{ wall, a, b, kind, dir, to }] from roomOpenings (client/shared/building-graph.js):
// `a` and `b` are u on the front and back walls and v on the side walls. Only an open door (`kind`
// 'door' with a `dir`) is walked through; the rest are wall for now.
export const OPENING_STEP = 0.6;   // how far past the wall the strip runs, metres
// A room's spec with its building's openings on it. A doorway wins over a window: the middle room of a
// chain has a door in its window wall, and a pane it would cut into goes. A room left with no pane is
// `windowless`, so the mesh doesn't put its default one back.
const PANE_GAP = 0.08;   // the mullion between a glass wall and a door cut into it
export function withDoorways(S, openings) {
  const open = openings.filter((o) => (o.kind === 'door' || o.kind === 'front') && o.dir);
  const clash = (q) => open.some((o) => o.wall === q.wall && o.a < q.b && o.b > q.a);
  const panes = S.windows?.length ? S.windows : S.window ? [{ wall: 'front', a: S.window[0], b: S.window[1], y0: S.window[2], y1: S.window[3], kind: 'sash' }] : [];
  // a sash window a door runs into goes, but a glass wall is cut round the door: the pieces either side stay,
  // as the balcony door's do, so a lobby's street door stands in its glass front instead of taking it all
  const keep = [];
  for (const q of panes) {
    if (!clash(q)) { keep.push(q); continue; }
    if (q.kind !== 'curtain') continue;
    let parts = [[q.a, q.b]];
    for (const o of open) if (o.wall === q.wall) parts = parts.flatMap(([a, b]) => (o.a < b && o.b > a ? [[a, o.a - PANE_GAP], [o.b + PANE_GAP, b]] : [[a, b]]));
    for (const [a, b] of parts) if (b - a >= 0.3) keep.push({ ...q, a: +a.toFixed(3), b: +b.toFixed(3) });
  }
  const out = { ...S, openings, windows: keep };
  if (!keep.length) out.windowless = true;
  // a real flight down from this floor takes the place of the dark well `doors.down` draws on its own
  if (out.stairs && openings.some((o) => o.kind === 'stair' && o.wall === 'floor')) delete out.stairs;
  return out;
}
// The doorways the room really has: open doors that don't run into a window, the en-suite's door,
// the balcony's or each other. One that would is left as wall, by the mesh and the walker alike.
export function doorwaysOf(S) {
  const panes = S.windowless ? [] : S.windows?.length ? S.windows : S.window ? [{ wall: 'front', a: S.window[0], b: S.window[1] }] : [];
  const busy = panes.map((q) => ({ wall: q.wall, a: q.a, b: q.b }));
  if (S.annex) busy.push({ wall: 'back', a: S.annex.door[0], b: S.annex.door[1] });
  if (S.balcony) busy.push({ wall: 'front', a: S.balcony.door[0], b: S.balcony.door[1] });
  const out = [];
  for (const o of S.openings || []) {
    // a street door is a doorway too: through it is the street (building-stage.md step 5)
    if ((o.kind !== 'door' && o.kind !== 'front') || !o.dir) continue;
    if ([...busy, ...out].some((q) => q.wall === o.wall && o.a < q.b && o.b > q.a)) continue;
    out.push(o);
  }
  return out;
}
function openingStrip(S, o, m, radius) {
  const hu = S.w / 2, far = WALL_T + OPENING_STEP, e = 0.02, deep = o.wall === 'back' ? o.deep || 0 : 0;
  if (o.wall === 'front') return [o.a + radius, o.b - radius, -far, m + e];
  if (o.wall === 'back') return [o.a + radius, o.b - radius, S.d + deep - m - e, S.d + deep + far];
  if (o.wall === 'left') return [-hu - far, -hu + m + e, o.a + radius, o.b - radius];
  return [hu - m - e, hu + far, o.a + radius, o.b - radius];
}
// A FLAT'S FRONT DOOR ON A CORRIDOR (docs/proposals/building-stage.md, "Flats on a corridor"). Its en-suite stands
// behind the back wall, so a building puts the corridor past it (building-graph.js `deep`), and the doorway in the
// back wall opens on a short hall beside the en-suite, out to the corridor: { a, b } across, from v0 (the back
// wall) to v1 (the hall's far wall, where the door to the corridor is). Null for any other doorway.
export const HALL_W = 1.5;
// The en-suite's doorway as a lock's doorway (gl/room-lock.js): in the flat's back wall, seen from the flat, or
// in the en-suite's front wall, seen from inside it (`inside`). `to` is the room past it. Null with no en-suite.
export function annexWay(S, inside = false, to = null) {
  if (!S?.annex) return null;
  const [a, b] = S.annex.door;
  return { kind: 'door', annex: true, inside: !!inside, wall: inside ? 'annex' : 'back', a, b, dir: inside ? 'out' : 'in', to: to || S.annex.zone };
}

// Where a locked doorway's reader goes along its wall (gl/room-lock.js), its wall running lo..hi: { c, pad }.
// The right of the door as you face it from the room first. The full card wants 0.54 m of clear wall past the
// jamb; where that isn't there, or something tall stands in front of it (`busy(a0, a1)`), a wall keypad (`pad`)
// wants 0.23 m. Only with neither on the right does it go left. Here so the furniture can keep clear of it
// (keepClear), which can't import the renderer.
export const READER = Object.freeze({ off: 0.3, half: 0.24, padOff: 0.14, padHalf: 0.09 });
// which way `along` runs on each wall, seen from the room: +1 when it runs to your right
export const WALL_RIGHT = Object.freeze({ front: 1, back: -1, left: -1, right: 1, annex: 1 });
export function readerSpot(o, lo, hi, busy = () => false) {
  const R = READER, e = 1e-6, sd = WALL_RIGHT[o.wall] ?? 1;
  const at = (side, off, half) => {
    const c = side > 0 ? o.b + off : o.a - off;
    return c - half >= lo - e && c + half <= hi + e && !busy(c - half, c + half) ? c : null;
  };
  for (const side of [sd, -sd]) {
    const c = at(side, R.off, R.half);
    if (c !== null) return { c, pad: false };
    const p = at(side, R.padOff, R.padHalf);
    if (p !== null) return { c: p, pad: true };
  }
  return { c: sd > 0 ? o.b + R.padOff : o.a - R.padOff, pad: true };
}

export function hallOf(S, o) {
  if (!o?.deep || o.wall !== 'back') return null;
  const hu = S.w / 2, c = (o.a + o.b) / 2;
  let a = c - HALL_W / 2, b = c + HALL_W / 2;
  const A = S.annex;
  if (A) { if (c > A.u[1]) a = Math.max(a, A.u[1] + WALL_T + 0.02); else b = Math.min(b, A.u[0] - WALL_T - 0.02); }
  return { a: +Math.max(a, -hu).toFixed(3), b: +Math.min(b, hu).toFixed(3), v0: S.d, v1: +(S.d + o.deep).toFixed(3) };
}
// The open doorway a spot [u, v] has gone through, past its wall's face, or null.
export function openingCrossed(L, at) {
  const S = L.spec, hu = S.w / 2, past = WALL_T / 2;
  for (const o of doorwaysOf(S)) {
    const along = o.wall === 'front' || o.wall === 'back' ? at[0] : at[1];
    if (along < o.a || along > o.b) continue;
    if ((o.wall === 'front' && at[1] < -past) || (o.wall === 'back' && at[1] > S.d + (o.deep || 0) + past)
      || (o.wall === 'left' && at[0] < -hu - past) || (o.wall === 'right' && at[0] > hu + past)) return o;
  }
  // a stair: on its flight, past the line where your eye goes through the floor above (up) or below it (down)
  for (const o of stairsOf(S)) {
    if (!o.dir) continue;
    const [s, x] = flightLocal(o, at[0], at[1]), [a, b] = flightSpan(o);
    if (Math.abs(x) > o.w / 2 || s < a - 0.3 || s > b + 0.3) continue;
    if (o.wall === 'ceiling' ? s > o.cross : s < o.cross) return o;
  }
  return null;
}
// How far past the line that takes you through an opening a spot is, toward the room beyond: past a doorway's
// wall face, or along a flight past `cross`. Negative short of it.
export function openingPast(L, o, at) {
  if (o.kind === 'stair') { const s = flightLocal(o, at[0], at[1])[0]; return o.wall === 'ceiling' ? s - o.cross : o.cross - s; }
  const S = L.spec;
  return o.wall === 'front' ? -at[1] : o.wall === 'back' ? at[1] - S.d - (o.deep || 0) : o.wall === 'left' ? -S.w / 2 - at[0] : at[0] - S.w / 2;
}
// A spot that went through an opening brought back to just short of it: a doorway's wall, the same distance along
// it, or a flight's crossing line, the same distance across it.
export function heldShort(L, o, at) {
  if (o.kind === 'stair') {
    const s = flightLocal(o, at[0], at[1])[0], d = (o.wall === 'ceiling' ? o.cross - 0.05 : o.cross + 0.05) - s;
    return [at[0] + o.climb[0] * d, at[1] + o.climb[1] * d];
  }
  const hu = L.spec.w / 2, lim = WALL_T / 2 - 0.02;
  if (o.wall === 'front') return [at[0], Math.max(at[1], -lim)];
  if (o.wall === 'back') return [at[0], Math.min(at[1], L.spec.d + (o.deep || 0) + lim)];
  if (o.wall === 'left') return [Math.max(at[0], -hu - lim), at[1]];
  return [Math.min(at[0], hu + lim), at[1]];
}
// Where you stand just inside a doorway, and the yaw that faces into the room from it: where you
// arrive through it, and where a door that didn't let you through puts you back. A flat's front door on
// a corridor is at the end of its hall, so that's where you stand.
export function openingInside(L, o) {
  if (o.kind === 'stair') {
    // come down it, you're stood off its bottom step facing away from it; come up it, off its top, facing on
    const low = o.wall === 'ceiling', s = low ? -0.5 : o.len + 0.5, k = low ? -1 : 1, want = [o.foot[0] + o.climb[0] * s, o.foot[1] + o.climb[1] * s];
    const at = roomFree(L, want[0], want[1]) ? want : roomNearFree(L, want[0], want[1], 1.5) || want;
    const p = L.world(at[0], at[1], 0), q = L.world(at[0] + o.climb[0] * k, at[1] + o.climb[1] * k, 0);
    return { at, yaw: Math.atan2(q[0] - p[0], q[2] - p[2]) };
  }
  const [u0, u1, v0, v1] = L.bounds, c = (o.a + o.b) / 2, k = 0.3, hall = hallOf(L.spec, o);
  const at = hall ? [c, hall.v1 - (L.spec.d - v1) - 0.05] : o.wall === 'front' ? [c, v0 + k] : o.wall === 'back' ? [c, v1 - k] : o.wall === 'left' ? [u0 + k, c] : [u1 - k, c];
  const step = o.wall === 'front' ? [0, 1] : o.wall === 'back' ? [0, -1] : o.wall === 'left' ? [1, 0] : [-1, 0];
  const p = L.world(at[0], at[1], 0), q = L.world(at[0] + step[0], at[1] + step[1], 0);
  return { at, yaw: Math.atan2(q[0] - p[0], q[2] - p[2]) };
}

// Whether a point in the room's frame is through the door of the en-suite.
// ⚠ A WRAPPED BALCONY GOES BEHIND THE EN-SUITE TOO, so a walker's spot has to pass its `u` or the deck counts
// as the bathroom. A seat or a station is never out there and can leave it off.
// ⚠ AND A FLAT ON A CORRIDOR HAS A HALL BESIDE IT (hallOf), past the same wall: with `u`, only the en-suite's own
// width counts.
export const inAnnex = (L, v, u) => !!L.annex && v > L.annex.v0 - WALL_T / 2 && !(u !== undefined && (onBalcony(L.spec, [u, v]) || u < L.annex.u0 - WALL_T || u > L.annex.u1 + WALL_T));
// Whether a spot [u, v] is out on the balcony: past the front wall, or past any wall where it wraps.
export const onBalcony = (S, at) => !!S?.balcony && !!at && (at[1] < 0 || (!!S.balcony.wrap && (Math.abs(at[0]) > S.w / 2 || at[1] > S.balcony.wrap)));

// Whether somebody at `b` is in sight from `a`, both [u, v] in the room's frame: no wall between them on
// the plan. A partition hides, the room's own walls hide what's past them except through a doorway or
// glass, and the en-suite shows through its door. Furniture hides nobody, and nor does a wall of the room
// next door: this is for a name over a head (room-stage.js), which the picture's depth can't hide.
export function roomSees(L, a, b) {
  const S = L.spec, hu = S.w / 2, d = S.d;
  const du = b[0] - a[0], dv = b[1] - a[1];
  for (const [u0, u1, v0, v1] of S.walls || []) {
    // the line clipped to the box: anything left of it is inside the wall
    let t0 = 0, t1 = 1;
    for (const [p, dp, lo, hi] of [[a[0], du, u0, u1], [a[1], dv, v0, v1]]) {
      if (Math.abs(dp) < 1e-9) { if (p < lo || p > hi) t0 = 2; continue; }
      const k0 = (lo - p) / dp, k1 = (hi - p) / dp;
      t0 = Math.max(t0, Math.min(k0, k1)); t1 = Math.min(t1, Math.max(k0, k1));
    }
    if (t0 < t1) return false;
  }
  const where = (p) => (inAnnex(L, p[1], p[0]) ? 'annex' : Math.abs(p[0]) <= hu && p[1] >= 0 && p[1] <= d + WALL_T / 2 ? 'room' : 'out');
  const za = where(a), zb = where(b);
  if (za === zb) return true;
  const [p, q] = za === 'room' ? [a, b] : [b, a], pu = q[0] - p[0], pv = q[1] - p[1];
  if (za === 'out' || zb === 'out') {
    if (za === 'annex' || zb === 'annex') return false;
    // where the line leaves the room, and by which wall
    let t = Infinity, wall = '';
    const leave = (k, w) => { k = Math.max(k, 0); if (k < t) { t = k; wall = w; } };
    if (pu > 0) leave((hu - p[0]) / pu, 'right'); else if (pu < 0) leave((-hu - p[0]) / pu, 'left');
    if (pv > 0) leave((d - p[1]) / pv, 'back'); else if (pv < 0) leave(-p[1] / pv, 'front');
    if (!wall) return true;
    const x = wall === 'front' || wall === 'back' ? p[0] + pu * t : p[1] + pv * t;
    const panes = S.windowless ? [] : S.windows?.length ? S.windows : S.window ? [{ wall: 'front', a: S.window[0], b: S.window[1] }] : [];
    return (S.glass || []).includes(wall) || (wall === 'front' && !!S.balcony && x >= S.balcony.door[0] && x <= S.balcony.door[1])
      || [...doorwaysOf(S), ...panes].some((o) => (o.wall || 'front') === wall && x >= o.a && x <= o.b);
  }
  // one of them in the en-suite: through its door in the back wall
  const x = Math.abs(pv) < 1e-9 ? p[0] : p[0] + pu * Math.max(0, (d - p[1]) / pv);
  return !!S.annex && x >= S.annex.door[0] && x <= S.annex.door[1];
}

// The en-suite behind the back wall: `spec` is the room its pieces are placed in, its own frame (u
// across its middle, v back from its door wall), with the door in that FRONT wall; `cu` and `v0` put
// that frame in the flat's. Null with no en-suite.
export function annexFrame(S) {
  const a = S.annex;
  if (!a) return null;
  const cu = (a.u[0] + a.u[1]) / 2, v0 = (S.d || FLAT_ROOM.d) + WALL_T;
  return { cu, v0, u0: a.u[0], u1: a.u[1], spec: { w: a.u[1] - a.u[0], d: a.d, h: a.h, unit: 'm', door: [a.door[0] - cu, a.door[1] - cu], doorWall: 'front', windows: a.windows || [] } };
}

// ── walking ─────────────────────────────────────────────────────────────────────────────────────
// Whether a body can stand at (u, v), and a walker's next spot: the move tried whole, then each axis
// on its own, so you slide along what you meet. `p` and the answer are [u, v].
export function roomFree(L, u, v) {
  return (L.rects || [L.bounds]).some(([a, b, c, e]) => u >= a && u <= b && v >= c && v <= e)
    && !L.solid.some(([a, b, c, e]) => u > a - L.radius && u < b + L.radius && v > c - L.radius && v < e + L.radius);
}
export function roomStep(L, p, du, dv) {
  const ok = (u, v) => roomFree(L, u, v);
  // somewhere you shouldn't be (a seat's own spot): any move goes, so you can always walk out
  if (!ok(p[0], p[1])) { const [a, b, c, e] = L.outer || L.bounds; return [Math.max(a, Math.min(b, p[0] + du)), Math.max(c, Math.min(e, p[1] + dv))]; }
  if (ok(p[0] + du, p[1] + dv)) return [p[0] + du, p[1] + dv];
  if (ok(p[0] + du, p[1])) return [p[0] + du, p[1]];
  if (ok(p[0], p[1] + dv)) return [p[0], p[1] + dv];
  return p;
}
// The seat nearest a point in the room's frame, within `reach` feet, or null.
export function roomSeatNear(L, u, v, reach = 3) {
  let best = null, bd = reach * L.ft;
  for (const s of L.seats) { const dd = Math.hypot(s.u - u, s.v - v); if (dd < bd) { bd = dd; best = s; } }
  return best;
}

// ── finding the way ─────────────────────────────────────────────────────────────────────────────
// How somebody other than you crosses the room (plugins/roomstage/npc-life.js walks them), over the
// same rects and boxes the walker and the gate use.
//
// ⚠ SOMEBODY ELSE DOESN'T CLIMB THE FURNITURE. A chair, a sofa or a bed is a `climb` box, not a `solid` one, so
// you can step up on it; but an NPC routed or stood by roomFree walked through the chairs and stood in them.
// Everything below plans on `onFoot(L)`, where what you'd climb is in the way too.
const footed = new WeakMap();
// ⚠ NOR DOES SOMEBODY ELSE WANDER UP A FLIGHT. A resident is drawn where the server says, never across a room's
// floors, so one routed up a stair stood in the air over the well. A flight's lane is in the way here too.
export function onFoot(L) {
  const lanes = stairsOf(L.spec).map((o) => { const [a, b] = flightSpan(o); return flightBox(o, a, b, -o.w / 2, o.w / 2); });
  if (!L.climb?.length && !lanes.length) return L;
  let F = footed.get(L);
  if (!F) { F = { ...L, solid: [...L.solid, ...(L.climb || []).map((c) => c.slice(0, 4)), ...lanes] }; footed.set(L, F); }
  return F;
}
// The nearest place a body can stand to (u, v), out to `reach`, kept inside `within` when it's given:
// a seat's spot is inside its piece, so this is where you walk to before you sit, and the far side of
// the wall behind it can be closer than the near side.
export function roomNearFree(L, u, v, reach = 1.8, within = null) {
  const F = onFoot(L);
  const ok = (a, b) => roomFree(F, a, b) && (!within || (a >= within[0] && a <= within[1] && b >= within[2] && b <= within[3]));
  if (ok(u, v)) return [u, v];
  for (let r = 0.1; r <= reach; r += 0.1) for (let i = 0; i < 16; i++) {
    const a = i / 8 * Math.PI, p = [u + Math.cos(a) * r, v + Math.sin(a) * r];
    if (ok(p[0], p[1])) return p;
  }
  return null;
}
// Where somebody stands to sit in seat `s`: in front of it, or beside it where a table is in front, never
// behind it, so a walker going to a chair doesn't come through its back. The nearest free spot when there's
// nothing on the front half.
export function seatApproach(L, s, reach = 1.8, within = null) {
  if (s.lie || !s.dir) return roomNearFree(L, s.u, s.v, reach, within);
  const F = onFoot(L);
  const ok = (a, b) => roomFree(F, a, b) && (!within || (a >= within[0] && a <= within[1] && b >= within[2] && b <= within[3]));
  const [fu, fv] = s.dir;
  for (let r = 0.45; r <= reach; r += 0.1) for (const a of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
    const c = Math.cos(a), sn = Math.sin(a), du = fu * c - fv * sn, dv = fv * c + fu * sn;
    if (ok(s.u + du * r, s.v + dv * r)) return [s.u + du * r, s.v + dv * r];
  }
  return roomNearFree(L, s.u, s.v, reach, within);
}
// A way from `a` to `b`, each [u, v]: a breadth-first search over a grid `step` across, pulled tight
// into a few straight legs. Null when there's no way through. It keeps further off the furniture than
// a walker has to wherever the room allows it, since a body's shoulders are wider than its radius, and
// round the chairs and beds (onFoot). Only a room the furniture shuts off entirely is crossed over it.
export function roomPath(L, a, b, step = 0.2) {
  const F = onFoot(L);
  return pathOver({ ...F, radius: F.radius + 0.08 }, a, b, step) || pathOver(F, a, b, step) || (F !== L ? pathOver(L, a, b, step) : null);
}
function pathOver(L, a, b, step) {
  const [u0, u1, v0, v1] = L.outer, W = Math.ceil((u1 - u0) / step) + 1, H = Math.ceil((v1 - v0) / step) + 1;
  const spot = (i) => [u0 + (i % W) * step, v0 + Math.floor(i / W) * step];
  // the open cell nearest a point: the point itself can be a seat's, inside its piece
  const snap = ([u, v]) => {
    const x = Math.round((u - u0) / step), y = Math.round((v - v0) / step);
    for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H) continue;
      const i = (y + dy) * W + x + dx, p = spot(i);
      if (roomFree(L, p[0], p[1])) return i;
    }
    return -1;
  };
  const s = snap(a), e = snap(b);
  if (s < 0 || e < 0) return null;
  // -1 not seen, -2 a wall or a piece, otherwise the cell it was reached from
  const from = new Int32Array(W * H).fill(-1), queue = [s];
  from[s] = s;
  for (let h = 0; h < queue.length && from[e] === -1; h++) {
    const i = queue[h], x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= W * H || from[j] !== -1) continue;
      const p = spot(j);
      if (roomFree(L, p[0], p[1])) { from[j] = i; queue.push(j); } else from[j] = -2;
    }
  }
  if (from[e] < 0) return null;
  const pts = [b];
  for (let i = e; i !== s; i = from[i]) pts.push(spot(i));
  pts.push(spot(s), a);
  pts.reverse();
  const clear = (p, q) => {
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.08);
    for (let i = 1; i < n; i++) if (!roomFree(L, p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n)) return false;
    return true;
  };
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1;) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
// How long a path is, and where `s` metres along it puts a body, with the way it's heading.
// Two seats that can't both be used: a body lying along a piece covers every seat on it.
export const seatsClash = (a, b) => !!a && !!b && (a === b || (a.piece === b.piece && !!(a.lie || b.lie)));
export const pathLength = (path) => path.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0);
export function pathAt(path, s) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], du = b[0] - a[0], dv = b[1] - a[1], l = Math.hypot(du, dv);
    if (l < 1e-6) continue;
    if (s <= l || i === path.length - 1) { const k = Math.min(1, s / l); return { at: [a[0] + du * k, a[1] + dv * k], du, dv, leg: i }; }
    s -= l;
  }
  return { at: path[path.length - 1], du: 0, dv: 1, leg: path.length - 1 };
}
// The yaw of a body heading (du, dv) across the room's frame.
export const roomYaw = (L, du, dv) => Math.atan2(L.r[0] * du - L.f[0] * dv, L.r[2] * du - L.f[2] * dv);

// ── placing ─────────────────────────────────────────────────────────────────────────────────────
// A free spot for a new piece (home-stage.md "Placing"), by what kind of thing it is. In a studio
// (studioPlan) that's its own part of the room: what cooks and keeps food goes along the kitchen's
// wall behind the counter, a bed and a wardrobe in the back left, and the lounge's pieces out front,
// seats facing whatever screen is in the room. Without a plan it's wall by wall. Either way nothing
// goes in the way in, and nothing tall in front of the window.
// `pieces` are the room's furnished pieces with their spots (and `crt` on a set that stands on the
// floor). Spots are in metres. Returns a spot, or null when the room is full.
//
// `wall` ('left', 'right', 'front', 'back') keeps only the candidates against that wall, in the
// order the archetype tries them; one with no run there (a screen on the back wall, a bed on the
// front) takes the wall's plain run. `arrange` uses it, passing the room without the piece it moves,
// so the same keep-clear zones and overlap test decide. Null means that wall is full.
//
// `form` tells a hung cabinet from a standing one; `bases` (true for an authored piece) lets a kettle
// or a microwave take `{ on, x }`, a place on a worktop already in the room. A player's piece never
// does, since the worktop can be taken away from under it.
export function placeSpot(spec, pieces, arche, dims, { crt = false, wall = null, form = null, bases = false } = {}) {
  const S = { w: FLAT_ROOM.w, d: FLAT_ROOM.d, h: FLAT_ROOM.h, ...spec };
  const k = unitsPerM(S), hu = S.w / 2 / k, D = S.d / k, P = S.plan || null;
  const cooks = arche === 'cold' || arche === 'hob' || arche === 'sink' || arche === 'cabinet' || (arche === 'surface' && form === 'counter');
  const have = pieces.map((p) => { const a = ARCHETYPES[p.arche] ? p.arche : 'prop'; return { ...p, ...resolveSpot(S, p.spot, p.dims || dimsOf(a)), arche: a }; });
  const keep = keepClear(S);
  // a flat screen or a wall cabinet hangs over whatever's below it, so it only meets other hung things
  const hung = (a, c, f) => (a === 'screen' && !c) || hungOf(a, f);
  const fits = (spot) => {
    // a dining table keeps room round it for its chairs, so it never butts up against the set or a console
    const q = resolveSpot(S, spot, dims), fp = footprint(q), gap = (form === 'dining' || form === 'poker' ? 0.6 : 0.05) * k;
    if (fp[0] < -S.w / 2 - 1e-6 || fp[1] > S.w / 2 + 1e-6 || fp[2] < -1e-6 || fp[3] > S.d + 1e-6) return false;
    const tall = q.h > 1.0 * k;
    // a hung screen clears the floor, but not the doorway on the back wall or the glass on the front
    const hangs = hung(arche, crt, form);
    if (P) {
      const hits = (r) => fp[0] < r[1] && fp[1] > r[0] && fp[2] < r[3] && fp[3] > r[2];
      // nothing stands in the counter, and only the kitchen's own pieces stand in the kitchen: along
      // its wall, so its aisle stays clear, and a cabinet hung over them
      if (!hangs && (hits(P.counter) || hits(P.ret))) return false;
      if (hits(P.kitchen)) {
        if (!cooks) return false;
        if (!hangs && (fp[0] < P.run[0] - 0.15 || q.wall !== 'right')) return false;
      }
    }
    for (const [a, b, c, e, onlyTall, tag] of keep) {
      if (tag === 'bar' && form === 'stool') continue;
      const applies = hangs ? (q.wall === 'back' && !onlyTall) || onlyTall : !onlyTall || tall;
      if (applies && fp[0] < b && fp[1] > a && fp[2] < e && fp[3] > c) return false;
    }
    for (const o of have) {
      if (o.spot?.on) continue;
      // a hung thing and a floor piece only meet if the floor piece is tall enough to reach it, or a bed:
      // nothing hangs over a headboard
      if (hung(o.arche, o.crt, o.form) !== hung(arche, crt, form) && (hangs ? o.h : q.h) <= 1.0 * k && !(hangs && o.arche === 'bed')) continue;
      const g = footprint(o);
      if (fp[0] < g[1] + gap && fp[1] > g[0] - gap && fp[2] < g[3] + gap && fp[3] > g[2] - gap) return false;
    }
    return true;
  };
  const along = (wall, from, to, step = 0.1) => { const out = []; for (let a = from; from <= to ? a <= to + 1e-6 : a >= to - 1e-6; a += from <= to ? step : -step) out.push({ wall, along: +a.toFixed(2) }); return out; };
  // a side wall from the back toward the window; the front and back walls from left to right
  const wallRun = (wall) => (wall === 'left' || wall === 'right' ? along(wall, D - 0.4, 0.4) : along(wall, -hu + 0.4, hu - 0.4));
  const scr = have.find((p) => p.arche === 'screen');
  // the wall the kitchen runs along: the right, unless that's glass; then what's left, the glass last
  const glazed = (w) => (S.windows || []).some((q) => q.wall === w && q.kind === 'curtain');
  const walls = ['right', 'back', 'left', 'front'].sort((a, b) => glazed(a) - glazed(b));
  // a worktop and where it has room: the sink's run, a counter, or the studio's own, with what already
  // stands on it
  if (bases && (arche === 'top' || (arche === 'hob' && form === 'microwave'))) {
    for (const b of [...have, ...(P ? [counterBase(S)] : [])]) {
      if (b.spot?.on || (b.id !== 'counter' && !(b.arche === 'sink' && b.form !== 'basin') && !(b.arche === 'surface' && b.form === 'counter'))) continue;
      const room = (b.w / k) / 2 - dims[0] / 2 - 0.04, busy = have.filter((o) => o.spot?.on === b.id).map((o) => [Number(o.spot.x) || 0, (o.dims?.[0] || 0.3) / 2]);
      // the basin takes the left of a sink's run, so what stands on it starts from the right
      for (let x = room; x >= (b.arche === 'sink' ? 0.02 : -room); x -= 0.05) {
        if (busy.every(([bx, bw]) => Math.abs(bx - x) > bw + dims[0] / 2 + 0.03)) return { on: b.id, x: +x.toFixed(2) };
      }
    }
  }
  let cands = [];
  // a grid of places in part of the room, nearest its middle first, facing `turn`
  const gridIn = ([a, b, c, e], turn = 0, pad = 0.5) => {
    const out = [], mu = (a + b) / 2, mv = (c + e) / 2;
    for (let v = c + pad; v <= e - pad; v += 0.3) for (let u = a + pad; u <= b - pad; u += 0.3) out.push({ at: [+u.toFixed(2), +v.toFixed(2)], turn });
    return out.sort((p, q) => Math.hypot(p.at[0] - mu, p.at[1] - mv) - Math.hypot(q.at[0] - mu, q.at[1] - mv));
  };
  // the studio's rooms within the room, where it has one
  if (P && (arche === 'cold' || arche === 'hob' || arche === 'sink' || (arche === 'surface' && form === 'counter'))) {
    cands = along('right', P.run[3] - dims[0] / 2 - 0.02, P.run[2] + dims[0] / 2 + 0.02, 0.05);
  } else if (P && (arche === 'bed' || arche === 'wardrobe' || (arche === 'store' && form !== 'crate'))) {
    cands = [...along('back', -hu + dims[0] / 2 + 0.05, P.sleep[1] - dims[0] / 2), ...(glazed('left') ? [] : along('left', D - dims[0] / 2 - 0.05, P.sleep[2]))];
  } else if (P && arche === 'screen') {
    const left = glazed('left') ? [] : along('left', P.living[3] * 0.5, P.living[3] * 0.85), right = glazed('right') ? [] : along('right', P.counter[2] / 2, 0.6);
    cands = [...left, ...right, ...along('back', P.sleep[1] - dims[0] / 2, 0)];
  } else if (P && arche === 'seat' && form === 'stool') {
    // a stool's place is at the counter, on the lounge's side of it
    for (let v = P.counter[3] - 0.4; v > P.counter[2] + 0.3; v -= 0.6) cands.push({ at: [+(P.counter[0] - 0.22).toFixed(2), +v.toFixed(2)], turn: 90 });
  } else if (P && arche === 'table') {
    const seat = have.find((p) => p.arche === 'sofa' || p.arche === 'bench') || have.find((p) => p.arche === 'seat');
    if (seat) { const [fu, fv] = facing(seat.turn), reach = seat.d / k / 2 + dims[1] / 2 + 0.45; cands.push({ at: [+(seat.u / k + fu * reach).toFixed(2), +(seat.v / k + fv * reach).toFixed(2)], turn: seat.turn }); }
    cands.push(...gridIn(P.living));
  } else if (P && (arche === 'small' || arche === 'prop' || arche === 'surface' || arche === 'store')) {
    // what's left stands against the lounge's walls: the left, the back beside the wardrobe, the
    // right in front of the counter
    cands = [...(glazed('left') ? [] : along('left', P.living[3] - 0.5, 0.5)), ...along('back', -hu + 0.4, hu - 0.4), ...(glazed('right') ? [] : along('right', P.counter[2] - dims[0] / 2 - 0.1, 0.5))];
  } else if (arche === 'screen') {
    const side = glazed('left') ? 'right' : 'left';
    cands = [...along(side, D * 0.45, D * 0.8), ...along(side, D * 0.45, 0.6), ...walls.flatMap(wallRun)];
  }
  // a wall cabinet goes over the worktop, a tall cupboard on the kitchen's wall
  else if (arche === 'cabinet') {
    const over = have.filter((p) => (p.arche === 'sink' || p.arche === 'hob' || p.arche === 'surface') && p.wall).map((p) => ({ wall: p.wall, along: +((p.wall === 'left' || p.wall === 'right' ? p.v : p.u) / k).toFixed(2) }));
    cands = [...over, ...walls.flatMap(wallRun)];
  }
  // a set's deck stands under its screen
  else if (arche === 'deck') {
    cands = scr?.wall ? [{ wall: scr.wall, along: +((scr.wall === 'left' || scr.wall === 'right' ? scr.v : scr.u) / k).toFixed(2) }] : [];
    cands.push(...[...walls].reverse().flatMap(wallRun));
  }
  else if (arche === 'wardrobe' || arche === 'store') cands = [...['left', 'back', 'right'].filter((w) => !glazed(w)).flatMap(wallRun), ...walls.flatMap(wallRun)];
  // in a bathroom the shower takes the far wall and the pan a side wall, clear of the door
  else if (arche === 'shower') cands = [...wallRun('back'), ...wallRun('left'), ...wallRun('right')];
  else if (arche === 'toilet') cands = [...wallRun('right'), ...wallRun('left'), ...wallRun('back')];
  // a bed's head goes against the back wall in the far corner from the door, then along a side wall
  else if (arche === 'bed') cands = [...along('back', -hu + dims[0] / 2 + 0.05, hu - dims[0] / 2 - 0.05), ...along('left', D - dims[0] / 2 - 0.05, 0.4)];
  else if (arche === 'cold' || arche === 'hob' || arche === 'surface' || arche === 'sink') cands = walls.flatMap(wallRun);
  else if (arche === 'seat' || arche === 'bench' || arche === 'sofa') {
    if (scr) {
      // on the screen's line out into the room, a couple of metres back, then either side of it
      const [fu, fv] = facing(scr.turn), su = -fv, sv = fu, back = arche === 'seat' ? [1.9, 2.3, 1.6, 2.7] : [2.3, 2.7, 2.0, 3.0];
      const turn = ((scr.turn + 180 + 540) % 360) - 180;
      for (const b of back) for (const x of [0, 0.75, -0.75, 1.4, -1.4]) {
        const u = scr.u / k + fu * (b + dims[1] / 2) + su * x, v = scr.v / k + fv * (b + dims[1] / 2) + sv * x;
        // a seat belongs to the lounge, even when the set is hung somewhere else
        if (!P || v < P.living[3] - 0.4) cands.push({ at: [+u.toFixed(2), +v.toFixed(2)], turn });
      }
    }
    // no screen to face: out in the lounge, looking at the window
    if (P) cands.push(...gridIn(P.living));
    cands.push(...wallRun('right'), ...wallRun('front'), ...wallRun('left'), ...wallRun('back'));
  } else cands = [...wallRun('back'), ...wallRun('right'), ...wallRun('left'), ...wallRun('front')];
  // whatever a piece's own place couldn't hold, it tries the rest of the room
  if (P && !wall) cands.push(...walls.flatMap(wallRun));
  if (wall && WALL_TURN[wall] !== undefined) {
    const own = cands.filter((c) => c.wall === wall);
    cands = own.length ? own : wallRun(wall);
  } else if (!hung(arche, crt, form)) {
    // every wall full: the open floor, in rows from the back. A piece that has to go somewhere goes
    // here rather than standing in the one behind it
    for (let v = D - 0.8; v > 0.6; v -= 0.4) for (let u = 0; u < hu; u += 0.4) for (const s of u ? [-1, 1] : [1]) cands.push({ at: [+(s * u).toFixed(2), +v.toFixed(2)], turn: 0 });
  }
  return cands.find(fits) || null;
}

// What the room's finish stands on its floor (spec.decor, drawn by gl/room-decor.js): a column `[u, v, r]` and
// a planter `[u, v, s]` (s its size, 1 a 0.32 m pot), each as a box a walker can't stand in.
export function decorSolids(S) {
  const out = [], ok = (q) => Array.isArray(q) && q.length >= 2 && q.slice(0, 3).every((x) => x === undefined || Number.isFinite(x));
  for (const c of S?.decor?.columns || []) if (ok(c)) { const r = c[2] || 0.3; out.push([c[0] - r, c[0] + r, c[1] - r, c[1] + r]); }
  for (const c of S?.decor?.plants || []) if (ok(c)) { const r = 0.34 * (c[2] || 1); out.push([c[0] - r, c[0] + r, c[1] - r, c[1] + r]); }
  const bd = balconyDressOf(S);
  if (bd) {
    out.push(...bd.troughs);
    if (bd.bench) out.push(bd.bench);
    if (bd.urn) { const r = 0.34 * bd.urn[2]; out.push([bd.urn[0] - r, bd.urn[0] + r, bd.urn[1] - r, bd.urn[1] + r]); }
  }
  return out;
}

// A tower flat's balcony, dressed (gl/room-decor.js drawBalconyDress): a long planter of grasses against the
// rail at each end of the front deck, and on the wider side of the door a bench against the building with a
// potted tree past it. Each is [u0, u1, v0, v1] in the room's frame; the urn is [u, v, s]. Null for a plain
// balcony, or none.
export function balconyDressOf(S) {
  const B = S?.balcony;
  if (!B || S.finish !== 'fine' || !Array.isArray(B.u) || !Array.isArray(B.door)) return null;
  const r = (x) => +x.toFixed(2), [u0, u1] = B.u, [d0, d1] = B.door, vO = -WALL_T - B.d, vI = -WALL_T;
  const len = Math.min(1.6, (u1 - u0) * 0.2);
  const troughs = [[r(u0 + 0.12), r(u0 + 0.12 + len), r(vO + 0.08), r(vO + 0.46)], [r(u1 - 0.12 - len), r(u1 - 0.12), r(vO + 0.08), r(vO + 0.46)]];
  const left = d0 - u0, right = u1 - d1, side = right >= left ? 1 : -1, room = Math.max(left, right);
  let bench = null, urn = null;
  if (room >= 2.6) {
    const bl = Math.min(1.8, room - 1.3), a = side > 0 ? d1 + 0.5 : d0 - 0.5 - bl;
    bench = [r(a), r(a + bl), r(vI - 0.5), r(vI - 0.08)];
    const uu = side > 0 ? a + bl + 0.45 : a - 0.45;
    if (uu > u0 + 0.4 && uu < u1 - 0.4) urn = [r(uu), r(vI - 0.5), 0.95];
  }
  return { troughs, bench, urn };
}

// What a new piece may not stand in: the way in from the door, and (for anything over a metre) the
// window. [u0, u1, v0, v1, onlyTall]
function keepClear(S) {
  const k = unitsPerM(S), hu = S.w / 2, D = S.d;
  const door = S.door || [hu - 1.3 * k, hu - 0.4 * k], win = S.window || [-0.8 * k, 0.8 * k];
  const out = [S.doorWall === 'front' ? [door[0] - 0.1 * k, door[1] + 0.1 * k, 0, 1.0 * k, false] : [door[0] - 0.1 * k, door[1] + 0.1 * k, D - 1.0 * k, D, false]];
  if (S.annex) {
    out.push([S.annex.door[0] - 0.1 * k, S.annex.door[1] + 0.1 * k, D - 1.0 * k, D, false]);
    // the wall the en-suite door's reader hangs on: nothing tall in front of it, or its card cut through a
    // wardrobe (the card is a page over the picture, so nothing hides it)
    const [a, b] = S.annex.door, r = readerSpot({ a, b, wall: 'back' }, -hu, hu), half = r.pad ? READER.padHalf : READER.half;
    out.push([r.c - half - 0.05, r.c + half + 0.05, D - 0.6 * k, D, true]);
  }
  if (S.balcony) out.push([S.balcony.door[0] - 0.3, S.balcony.door[1] + 0.3, 0, 1.6, false]);
  // nothing is set down in a pit by the rules: what's in one was put there on purpose
  if (S.pit) out.push([S.pit.u0, S.pit.u1, S.pit.v0, S.pit.v1, false]);
  for (const q of S.walls || []) out.push([q[0] - 0.3, q[1] + 0.3, q[2] - 0.3, q[3] + 0.3, false]);
  for (const st of S.stairs || []) out.push([st.box[0] - 0.4, st.box[1] + 0.4, st.box[2] - 0.4, st.box[3] + 0.4, false]);
  // a flight and its well, and a clear landing off the end you step on from (the bottom below, the top above)
  for (const o of stairsOf(S)) {
    const hw = o.w / 2 + 0.3, [a, b] = flightSpan(o);
    out.push([...flightBox(o, a - 0.3, b + 0.3, -hw, hw), false]);
    out.push([...(o.wall === 'ceiling' ? flightBox(o, -1.3 * k, 0, -hw, hw) : flightBox(o, o.len, o.len + 1.3 * k, -hw, hw)), false]);
  }
  for (const q of decorSolids(S)) out.push([q[0] - 0.2, q[1] + 0.2, q[2] - 0.2, q[3] + 0.2, false]);
  // a building's doorways (docs/proposals/building-stage.md): the way through each, a metre into the room
  for (const o of doorwaysOf(S)) {
    const a = o.a - 0.3, b = o.b + 0.3, m = 1.2 * k;
    out.push(o.wall === 'front' ? [a, b, 0, m, false] : o.wall === 'back' ? [a, b, D - m, D, false] : o.wall === 'left' ? [-hu, -hu + m, a, b, false] : [hu - m, hu, a, b, false]);
  }
  if (S.plan) {
    // the way in, and the ways on from it: a clear walk along the counter to the lounge, and across the
    // back of the room to the en-suite, in front of what stands against that wall
    const { lobby, counter, living } = S.plan;
    out.push([...lobby, false]);
    out.push([counter[0] - 1.0, counter[0], Math.min(counter[2], living[3]), lobby[2] + 0.5, false, 'bar']);
    if (S.annex) {
      out.push([S.annex.door[0] - 0.3, S.annex.door[1] + 0.3, D - 1.6, D, false]);
      out.push([S.annex.door[0] - 0.3, lobby[0], D - 1.7, D - 0.8, false]);
    }
  }
  if (S.windows?.length) {
    for (const q of S.windows) {
      if (q.wall === 'front') out.push([q.a, q.b, 0, 0.7 * k, true]);
      else if (q.wall === 'back') out.push([q.a, q.b, D - 0.7 * k, D, true]);
      else if (q.wall === 'left') out.push([-hu, -hu + 0.7 * k, q.a, q.b, true]);
      else out.push([hu - 0.7 * k, hu, q.a, q.b, true]);
    }
  } else if (S.doorWall !== 'front') out.push([win[0], win[1], 0, 0.7 * k, true]);
  return out;
}

// The spec a zone's room is drawn from: its own `flags.room` ({ w, d, h } in metres, or [w, d, h]),
// or, for a flat, FLAT_ROOM. Null when the room has no Stage. As an object it may also carry:
//   glass    the walls that are floor-to-ceiling glass instead of a window: any of 'front', 'left',
//            'right'. With none the room has the one sash window in its front wall.
//   finish   what the room is built from ('plain' by default, 'fine' for a tower flat)
//   ensuite  { w, d, finish }, the size of an en-suite when the flat has one
//   studio   false for a room with no studio plan (studioPlan)
//   balcony  false for a studio with no balcony. `storey` 1, the ground floor, has none either.
//            { wrap: 'all' } carries a tower flat's deck right round the building, { wrap: 'sides' } round
//            the front and both sides, stopping where a penthouse's landing and lift are behind it
//   decor    the room's finish: cladding, ceiling, floor inlay, runner, chandeliers, sconces, columns,
//            plants, pictures, shut doors, plaques (gl/room-decor.js; docs/proposals/building-stage.md)
//   pit      { at: [u0, u1, v0, v1], depth, step }, a sunken floor (pitFloorAt), or
//            { round: [u, v, r], depth, step } for a round one
//   walls    [[u0, u1, v0, v1], ...], partitions standing full height in the room
//   doors    `up`/`down` as [u, v]: where the stair is, in the room's own frame. A `down` stair
//            is a well 1 m across running `run` metres (default 2.2) toward the left-hand wall
//            from its head at [u, v]; building-graph.js stacks the room below so its `up` meets it.
//            With a real flight up to it (`stair` on the room below), `down` is where its top lands
//   stair    { at: [u, v], climb, w }: a flight up to the floor above, from its bottom step at [u, v],
//            climbing toward the `climb` wall (stairSpecOf; docs/proposals/building-stage.md "Stairs")
//   ground   'stone' for a stone floor instead of the finish's boards; also 'marble', 'terrazzo', 'tile', 'concrete', 'rubber'
//   windowless  true for a room with no window
//   club     true for a club: dark paint, bills on the walls, a truss of moving lights and strobes
// A lift car's panel (docs/proposals/building-stage.md): `spec.lift` is { floors: [{ n, label }], at },
// the floors it really stops at, lowest first. The panel is a reader on the right-hand wall by the front
// doors (liftPanelAt) with a hologram hung off it (room-lift.js) that carries the buttons; the button for
// the ground floor reads L and the penthouse's PH. `u`, `v` and `y` are where the old steel buttons were,
// and still say how much of the wall the panel takes.
export const LIFT_BTN = 0.07;
// where the reader is on the right-hand wall, { u, v, y }, or null in a room with no lift
export function liftPanelAt(S) {
  const bs = liftButtons(S);
  return bs.length ? { u: bs[0].u, v: +(bs[0].v + 0.065).toFixed(3), y: 1.38 } : null;
}
export function liftButtons(S) {
  const fl = Array.isArray(S?.lift?.floors) ? S.lift.floors : [];
  if (!fl.length) return [];
  const rows = Math.ceil(fl.length / 2), u = (S.w || 2) / 2 - 0.005, v0 = Math.min(0.75, (S.d || 2) * 0.3);
  return fl.map((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const tag = f.n === 1 ? 'L' : /penthouse/i.test(f.label || '') ? 'PH' : String(f.n);
    return { n: f.n, label: f.label, tag, lit: f.n === S.lift.at, u, v: +(v0 + col * 0.13).toFixed(3), y: +(0.95 + row * 0.13).toFixed(3), rows };
  });
}

export function roomSpecOf(flags, isFlat, { storey = null } = {}) {
  const own = flags?.room;
  const base = Array.isArray(own) ? { w: own[0], d: own[1], h: own[2] } : own && typeof own === 'object' ? own : isFlat ? FLAT_ROOM : null;
  if (!base) return null;
  const w = clampN(base.w, 2, 30, FLAT_ROOM.w), d = clampN(base.d, 2, 30, FLAT_ROOM.d), h = clampN(base.h, 2, 8, FLAT_ROOM.h);
  const hu = w / 2, window = [-Math.min(0.9, w / 4), Math.min(0.9, w / 4), 0.9, Math.min(h - 0.35, 2.2)];
  const out = { w, d, h, unit: 'm', door: [hu - 1.3, hu - 0.4].map((x) => Math.max(-hu + 0.2, x)), window, finish: FINISHES.includes(base.finish) ? base.finish : 'plain' };
  const glass = (Array.isArray(base.glass) ? base.glass : []).filter((x) => ['front', 'left', 'right'].includes(x));
  const plan = base.studio === false ? null : studioPlan(w, d, out.door);
  // a roof deck (`open`): no ceiling, so the sky is over it, and its glass is a screen right round to the back wall
  const open = base.open === true && !plan;
  if (open) out.open = true;
  if (plan) out.plan = plan;
  // floor-to-ceiling glass stops short of a corner by its frame, of the room's back quarter on the
  // left, where the bed goes, and of the kitchen on the right
  const pane = (wall) => ({ wall, a: wall === 'front' ? -hu + 0.12 : 0.12, b: wall === 'front' ? hu - 0.12 : wall === 'right' && plan ? plan.counter[2] - 0.15 : open ? d - 0.12 : d * 0.72, y0: 0.05, y1: open ? h - 0.04 : h - 0.1, kind: 'curtain' });
  out.windows = glass.length ? glass.map(pane) : [{ wall: 'front', a: window[0], b: window[1], y0: window[2], y1: window[3], kind: 'sash' }];
  if (glass.includes('front')) out.window = [-hu + 0.12, hu - 0.12, 0.05, h - 0.1];
  if (base.ensuite && typeof base.ensuite === 'object') out.ensuite = base.ensuite;
  // `tile` is a clinic's white tile, `concrete` a plant room's slab, `terrazzo` an old lobby's chips in cream (gl/room-mesh.js)
  if (['stone', 'marble', 'terrazzo', 'rubber', 'tile', 'concrete'].includes(base.ground)) out.ground = base.ground;
  // a lift car: clad as one (gl/room-mesh.js drawCar), whether you're in it or seeing it from a landing
  if (base.car === true) out.car = true;
  // lettering on a wall, as a hotel puts its name behind the desk: { text, sub, wall, y, size, at }.
  // `sub` is a small second line under it (RESIDENCES); `|` is the texture key's separator
  if (base.sign && typeof base.sign.text === 'string' && base.sign.text.replace(/\|/g, '').trim()) {
    const s = base.sign, line = (t, n) => t.replace(/\|/g, '').trim().slice(0, n);
    out.sign = { text: line(s.text, 24), wall: ['back', 'left', 'right', 'front'].includes(s.wall) ? s.wall : 'back', y: clampN(s.y, 0.5, h - 0.2, Math.min(h - 0.6, 2.6)), size: clampN(s.size, 0.08, 1.2, 0.32), at: Number.isFinite(s.at) ? s.at : 0 };
    if (typeof s.sub === 'string' && line(s.sub, 32)) out.sign.sub = line(s.sub, 32);
  }
  // its own colours: { wall, trim, ceiling, accent }, each a hex, accent a metal run round the room
  if (base.tone && typeof base.tone === 'object') {
    const t = {};
    for (const k of ['wall', 'trim', 'ceiling', 'accent']) if (/^#[0-9a-f]{6}$/i.test(base.tone[k] || '')) t[k] = base.tone[k];
    if (Object.keys(t).length) out.tone = t;
  }
  // how it's finished past the plain walls (gl/room-decor.js): cladding, a ceiling, lights, a runner, plants,
  // pictures and the doors that don't lead anywhere you can go. Only data: the mesh reads what it knows
  if (base.decor && typeof base.decor === 'object' && !Array.isArray(base.decor)) out.decor = JSON.parse(JSON.stringify(base.decor));
  // a club or a back room with no window at all
  if (base.windowless) { out.windowless = true; out.windows = []; }
  // a club: painted dark, bills on the walls, and a rig of moving lights and strobes (gl/room-mesh.js clubRig)
  if (base.club === true) out.club = true;
  // a club's VIP room: dark, velvet and slow, with a pole and lamps of its own (gl/room-mesh.js vipRig)
  else if (base.club === 'vip') out.club = 'vip';
  const rp = Array.isArray(base.pit?.round) && base.pit.round.length === 3 && base.pit.round.every(Number.isFinite) ? base.pit.round : null;
  if (rp) out.pit = { round: true, cu: rp[0], cv: rp[1], r: rp[2], u0: rp[0] - rp[2], u1: rp[0] + rp[2], v0: rp[1] - rp[2], v1: rp[1] + rp[2], depth: clampN(base.pit.depth, 0.1, 1.5, 0.42), step: clampN(base.pit.step, 0.25, 1, 0.42) };
  if (Array.isArray(base.walls)) { const ws = base.walls.filter((q) => Array.isArray(q) && q.length === 4 && q.every(Number.isFinite)); if (ws.length) out.walls = ws.map((q) => q.slice()); }
  const dn = base.doors?.down;
  if (Array.isArray(dn) && dn.length === 2 && dn.every(Number.isFinite)) {
    const run = clampN(base.doors.run, 1, 5, 2.2);
    out.stairs = [{ dir: 'down', u: dn[0], v: dn[1], run, box: [dn[0] - run, dn[0] + 0.1, dn[1] - 0.5, dn[1] + 0.5] }];
  }
  // a flight up to the floor above (stairSpecOf): building-graph.js plans it, and both rooms get it as an opening
  const stair = stairSpecOf(base.stair);
  if (stair) out.stair = stair;
  const pit = !rp && Array.isArray(base.pit?.at) && base.pit.at.length === 4 && base.pit.at.every(Number.isFinite) ? base.pit : null;
  if (pit) out.pit = { u0: pit.at[0], u1: pit.at[1], v0: pit.at[2], v1: pit.at[3], depth: clampN(pit.depth, 0.1, 1, 0.42), step: clampN(pit.step, 0.25, 1, 0.42) };
  if (plan && base.balcony !== false && (Number(base.storey) || storey) !== 1) {
    const front = glass.includes('front');
    out.balcony = balconyOf(out, plan, front, base.balcony?.wrap === 'all' || base.balcony?.wrap === 'sides' ? base.balcony.wrap : null);
    // the door goes in the glass, so the front's one pane is two with the door between them
    if (front) {
      const [a, b] = out.balcony.door, pane0 = out.windows.find((q) => q.wall === 'front');
      out.windows = [...out.windows.filter((q) => q !== pane0), { ...pane0, b: a }, { ...pane0, a: b }];
    }
  }
  if (Number(base.storeys) && (Number(base.storey) || storey) >= Number(base.storeys) - 1) out.crown = true;
  return out;
}
// A studio's balcony: a door out of the lounge, and a deck past it. A tower flat's runs the width of
// the room; a plain one is a slab with a rail, either side of its door. A wrapped deck goes past each
// side wall by its own depth and round the back, and withAnnex moves `wrap` back past an en-suite.
function balconyOf(S, P, glazed, wrap) {
  const hu = S.w / 2, fine = S.finish === 'fine', c = glazed ? (P.living[0] + P.living[1]) / 2 : S.window[0] - 0.9, half = glazed ? 0.75 : 0.5;
  const r = (x) => +x.toFixed(2);
  const d = fine ? 2.4 : 1.5, u = fine ? [r(-hu + 0.1), r(hu - 0.1)] : [r(Math.max(-hu + 0.1, c - 2.4)), r(Math.min(hu - 0.1, c + 2.4))];
  const out = { door: [r(c - half), r(c + half)], u, d };
  if (wrap) { u[0] = r(-hu - WALL_T - d); u[1] = r(hu + WALL_T + d); out.wrap = r(S.d + WALL_T); }
  // round three sides: the lift and the landing are behind a penthouse, so its deck stops at the back
  if (wrap === 'sides') out.sides = true;
  return out;
}
export const FINISHES = Object.freeze(['plain', 'fine']);

// A flat's spec with its en-suite added: behind the back wall at the end away from the way in.
// `zone` and `name` are the en-suite's own, and the door is in the wall between the two.
export function withAnnex(spec, zone, name) {
  const own = spec.ensuite || {};
  const span = spec.door[0] + spec.w / 2 - 0.3;
  const w = clampN(own.w, 1.6, Math.max(1.6, span), Math.min(2.6, span)), d = clampN(own.d, 1.6, 8, 2.8);
  const u0 = -spec.w / 2 + Math.max(0.1, (span - w) * 0.4), u1 = u0 + w, c = (u0 + u1) / 2;
  const ring = spec.balcony?.wrap ? { balcony: { ...spec.balcony, wrap: +(spec.d + 2 * WALL_T + d).toFixed(2) } } : null;
  return { ...spec, ...ring, annex: { zone, name, u: [+u0.toFixed(2), +u1.toFixed(2)], d, h: spec.h, door: [+(c - 0.45).toFixed(2), +(c + 0.45).toFixed(2)], finish: FINISHES.includes(own.finish) ? own.finish : spec.finish, windows: [] } };
}

// ── what a furniture row is drawn as ────────────────────────────────────────────────────────────
// Which rows stand in a room. A compartment is a shelf of the cabinet it's part of, a concealed piece
// isn't there until it's found, a dead drop is hidden on purpose, and a fixture with nothing to say
// what it is (a poster, a pipe) has no shape here unless `flags.look` gives it one.
const DRAWN_TYPES = new Set(['furniture', 'container', 'bed', 'tv', 'chair', 'table', 'sink', 'toilet', 'shower', 'media_deck']);
export function rowDrawn(f) {
  const fl = f.flags || {};
  // what a Cachet hides is on the back of its turntable, so it's never a piece of its own
  if (fl.dead_drop || fl.hidden || fl.concealed || fl.compartment_of || fl.conceal_hidden_by) return false;
  if (fl.look?.arche) return true;
  if (DRAWN_TYPES.has(f.object_type)) return true;
  return (f.object_type === 'fixture' || f.object_type === 'appliance') && !!(fl.stove_tier || fl.microwave || fl.brew_tier || fl.water_source);
}

// How a row looks: its archetype and form from its own flags (a placed piece carries its item's) and
// the weight of the item it came from, and a wear from what it cost unless `flags.look.wear` says.
export function rowLook(f, item = null, { annex = false, finish = 'plain' } = {}) {
  const flags = f.flags || {}, grams = Number(item?.weight) || 0, arche = archetypeOf(flags, grams, f.object_type);
  const price = Number(f.price ?? item?.value) || 0;
  // a fine flat's fittings came with it, so what they cost says nothing about how they've been kept
  const wear = Number.isFinite(flags.look?.wear) ? flags.look.wear : finish === 'fine' && !item ? 0 : price <= 60 ? 0.7 : price <= 200 ? 0.4 : price <= 600 ? 0.15 : 0;
  // `look.dress` is what stands on a console or a plinth (gl/room-decor.js): lilies, apples, thistle, an orchid
  const dress = typeof flags.look?.dress === 'string' ? { dress: flags.look.dress } : {};
  // `look.screen` is what a computer's monitor shows (gl/room-office.js, gl/room-mesh.js paintDesktop)
  if (typeof flags.look?.screen === 'string') dress.screen = flags.look.screen;
  // `look.boot` is the wordmark a set shows as it comes on (panels/room-tv.js paintBoot)
  if (typeof flags.look?.boot === 'string' && flags.look.boot.trim()) dress.boot = flags.look.boot.trim().slice(0, 24);
  // `look.tag` letters a piece's own plate (a vat's number), `look.state` a state it's drawn in (a vat 'drained')
  if (flags.look?.tone === 'black') dress.tone = 'black';
  if (typeof flags.look?.tag === 'string') dress.tag = flags.look.tag.slice(0, 12);
  if (typeof flags.look?.state === 'string') dress.state = flags.look.state.slice(0, 16);
  // `look.trade` is the trade a back bar letters on its frieze (gl/room-saloon.js); never the building's name
  if (typeof flags.look?.trade === 'string') dress.trade = flags.look.trade.slice(0, 24);
  // `stove`: a hob the cooking plugin heats (`stove_tier`), not one that's only drawn as one; the
  // Kitchen Stage stands you at a real one first (room-stage.js cookFrame)
  const stove = flags.stove_tier ? { stove: true } : {};
  const lab = flags.crafting_station === 'chem_lab' ? { lab: labGrade(flags) } : {};
  // `look.open`: how wide a Cachet's turntable is, when it stands in a false wall wider than the default (cachetWing)
  const open = Number(flags.look?.open) > 0 ? { open: Number(flags.look.open) } : {};
  // `look.pod`: a MORPHEX pod you step into on the Stage (panels/room-morphex.js); without it the pod is only looked at
  if (flags.look?.pod && flags.cosmetic_machine) open.pod = true;
  return { arche, form: formOf(arche, flags, grams, { annex }), dims: dimsOf(arche, grams, flags, { annex }), crt: flags.tv_skin === 'crt', wear, seed: rowSeed(flags.item_id || f.name || f.id), ...dress, ...stove, ...lab, ...open };
}
// A CACHET IN A FALSE WALL. The turntable (the cabinet one side, what it hides the other) is CACHET_OPEN wide, or
// `look.open` (the piece's `open`).
// A disguise piece authored wider than that (flags.look.dims) stands in a false wall: plaster wings either side
// of the opening, a header to the ceiling, and a dark alcove as deep as the piece behind, which is where what
// it hides waits until the turntable brings it round (gl/room-mesh.js cachetFrame).
export const CACHET_OPEN = 2.2;
export const cachetWing = (p) => (p.keypad ? Math.max(0, (p.w - (p.open || CACHET_OPEN)) / 2) : 0);
// The turntable's own piece: the opening's width, the same place, depth and height.
export const cachetInner = (p) => (cachetWing(p) > 0 ? { ...p, w: p.w - 2 * cachetWing(p) } : p);

// A chem lab's grade, from its station's quality (plugins/synthesis reads the same key for its
// bonus): what gl/lab-mesh.js draws it as.
export const LAB_GRADES = Object.freeze(['standard', 'refined', 'pristine']);
export const labGrade = (flags = {}) => (LAB_GRADES.includes(flags.station_quality) ? flags.station_quality : 'standard');
function rowSeed(s) { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

// A room's rows laid out: what each is drawn as and where it stands. Authored rows first, by what
// needs a wall (placeRank) and then by id, each at its own `flags.spot` when it was given one, else
// worked out fresh every time; then player rows at the spot they were stamped with, or one worked out
// now, listed in `stamps` for the caller to write. `itemOf` is the item a row came from.
export function layRows(rows, spec, { annex = false, finish = 'plain', itemOf = () => null } = {}) {
  const look = (f) => rowLook(f, itemOf(f), { annex, finish });
  const drawn = rows.filter(rowDrawn);
  const authored = drawn.filter((f) => f.origin !== 'player').map((f) => ({ f, L: look(f) }))
    .sort((a, b) => placeRank(a.L) - placeRank(b.L) || String(a.f.id).localeCompare(String(b.f.id)));
  const player = drawn.filter((f) => f.origin === 'player').sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)));
  const pieces = [], stamps = [];
  // A turned Cachet shows what it hid. Sealed, the payload says nothing about what's behind it.
  const turned = (f) => { const h = f.flags?.conceal_hides && rows.find((x) => x.id === f.flags.conceal_hides); return h && !h.flags?.concealed ? { form: 'chemwall', turned: h.name, lab: labGrade(h.flags) } : {}; };
  const add = (f, spot) => pieces.push({ id: f.id, name: f.name, ...look(f), ...turned(f), ...(f.flags?.conceal_hides ? { keypad: true } : {}), spot, verbs: Array.isArray(f.flags?.interactions) ? f.flags.interactions : [], container: f.object_type === 'container', ...(annex ? { annex: true } : {}) });
  const fresh = (f, bases) => { const L = look(f); return placeSpot(spec, pieces, L.arche, L.dims, { crt: L.crt, form: L.form, bases }) || { at: [0, +(spec.d / 2).toFixed(2)], turn: 0 }; };
  for (const { f } of authored.filter((x) => x.f.flags?.spot)) add(f, f.flags.spot);
  for (const { f } of authored.filter((x) => !x.f.flags?.spot)) add(f, fresh(f, true));
  for (const f of player.filter((x) => x.flags?.spot)) add(f, f.flags.spot);
  for (const f of player.filter((x) => !x.flags?.spot)) { const spot = fresh(f, false); add(f, spot); stamps.push({ row: f, spot }); }
  return { pieces, stamps };
}

// The order authored pieces are placed in: what needs a wall first, what goes on or under it after.
const PLACE_ORDER = ['bed', 'shower', 'wardrobe', 'cold', 'sink', 'hob', 'surface', 'toilet', 'store', 'cabinet', 'fireplace', 'screen', 'deck', 'sofa', 'bench', 'seat', 'table', 'top', 'small', 'prop'];
export const placeRank = (p) => { const i = PLACE_ORDER.indexOf(p.arche); return (i < 0 ? PLACE_ORDER.length : i) + (p.form === 'microwave' ? 12 : 0); };
const clampN = (x, lo, hi, dflt) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : dflt);
