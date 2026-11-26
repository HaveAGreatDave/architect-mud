// A BUILDING'S PLAN AND THE ROOMS LAID OUT FROM IT (docs/proposals/model-plan.md, phase 3). Pure: no DOM, no DB,
// no files, so the generator (scripts/content/plan-rooms.mjs) and a gate both run it in Node.
//
// A plan is what a GLASS model says about its own inside: its masses floor by floor, where its windows are, its
// street door and which walls it shares. Phase 2 (PLAN_SINK) will record one per building; until then a plan is
// written by hand, in metres at the tile's current seed, in this shape:
//
//   { slug, facade, building_type, layout, bracket?, storey_h, ground_h?,
//     masses: [{ rect: [x0, x1, z0, z1], storeys: [from, to] }],   storeys `from` up to but not including `to`
//     door:   { side, at },                                          the street door
//     bays:   [{ side, storeys: [from, to], kind, y0, y1, at: [a, b] } or { ..., pitch, w }],
//     shared: ['north', ...],                                        faces against another building
//     roof:   { lift?, tank? } }
//
// The frame is the plan's: x east, z north, metres, from the middle of the tile, as building-graph.js lays rooms
// out (its rooms are placed from the entry room's middle, so only differences matter). A place along a face (`at`,
// a bay's `a` and `b`, the door's `at`) is measured east on a north or south face and north on an east or west
// face, the measure building-graph's door offsets use. `pitch` and `w` repeat a bay `w` wide every `pitch` metres
// along the whole face, centred, the way a facade grid does; `at` gives one bay.
//
// planRooms(plan, { seed }) lays the rooms out and returns them as abstract rooms: each with its rect on the plan,
// its floor, its facing, its role, its panes on the faces it has, its doors to its neighbours and its stair. The
// generator turns those into content files; nothing here knows a file.
//
// What it does (model-plan.md "Phase 3"):
//   - picks the floors that get rooms (walkableStoreys): all of a low building, else the top, every third or fourth
//     storey down from it, and every setback;
//   - puts the core where the stair stands on every one of them, inside the smallest of them;
//   - lays each upper floor as a chain of landing and halls with flats either side (`depth`: the chain runs from
//     the front to the back and the flats look out of the sides; `across`: it runs along the front and the flats
//     look out of the front and the back). Shared side walls force `across`;
//   - lays the ground floor as a lobby from the street door to the back, a shop behind any shopfront bays and its
//     back room behind it, and a ground flat or store on the other side.
// Every room is a rectangle square to the compass, and two rooms meet through one door on one side: building-graph
// takes one exit a direction, so a landing has at most one flat to the east.

export const SIDES = ['north', 'east', 'south', 'west'];
export const BEARING = { north: 0, east: 90, south: 180, west: 270 };
const SIDE_OF = { 0: 'north', 90: 'east', 180: 'south', 270: 'west' };
export const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
// the outward normal of a side, [x, z]
const NORMAL = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };

export const PLAN_TUNE = Object.freeze({
  wallOut: 0.3,     // the model's outside wall: a room's floor stops this far inside its face
  gap: 0.28,        // two rooms' walls back to back (building-graph.js ROOM_GAP)
  chainW: 2.4,      // a landing or hall: a stair 1.1 wide with room to pass it
  landing: 6.6,     // a landing's length along the chain: a flight of one storey and the floor at its head
  rowTarget: 6.5,   // a flat's length along the chain, near enough
  roomTarget: 3.6,  // a rooming house's room, along the chain
  rowMin: 3.6,      // a row shorter than this joins the one behind it
  flatMinW: 3,      // a flat's width from the chain to its face
  mansionMinW: 6.5, // a mansion flat's length along the chain: living room, bedroom and bath
  mansionMinAcross: 5.4, // and its width from the chain to the face: a bath and a bedroom side by side
  bathW: 2.5,       // a bath's width, partition to partition (a room is 2 m at least, room-layout.js roomSpecOf)
  roomMin: 2.05,    // no room narrower than this: the Stage would widen it and move it off the plan
  paneMargin: 0.3,  // a pane stops short of a room's corner by this
  stair: { w: 1.1, foot: 0.8 },   // the flight's width, and its bottom step this far into the landing
});

const r2 = (n) => Math.round(n * 100) / 100;

// ── hashing: the seed's choices ──────────────────────────────────────────────────────────────────
// FNV-1a with murmur3's finaliser, so keys a digit apart don't cluster
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
// a choice among `n`, named, so adding a choice doesn't move the others
const pick = (seed, name, n) => hash32(`${seed}|${name}`) % n;

// ── reading a plan ───────────────────────────────────────────────────────────────────────────────
export function planProblems(plan) {
  const out = [];
  if (!plan || typeof plan !== 'object') return ['no plan'];
  if (!plan.slug || !/^[a-z0-9_]+$/.test(plan.slug)) out.push('slug: lower case, digits and _ only');
  if (!plan.facade) out.push('facade: the facade tile\'s zone id');
  if (!(plan.storey_h > 2)) out.push('storey_h: metres, over 2');
  if (!Array.isArray(plan.masses) || !plan.masses.length) out.push('masses: at least one');
  for (const m of plan.masses || []) {
    const [x0, x1, z0, z1] = m.rect || [];
    if (!(x1 > x0 && z1 > z0)) out.push(`mass ${JSON.stringify(m.rect)}: x0 < x1 and z0 < z1`);
    if (!(Array.isArray(m.storeys) && m.storeys[1] > m.storeys[0] && m.storeys[0] >= 0)) out.push(`mass storeys ${JSON.stringify(m.storeys)}: [from, to], from >= 0`);
  }
  if (!SIDES.includes(plan.door?.side)) out.push('door.side: north, east, south or west');
  for (const s of plan.shared || []) if (!SIDES.includes(s)) out.push(`shared: ${s} isn't a side`);
  if (plan.shared?.includes(plan.door?.side)) out.push('the street door is on a shared wall');
  if (plan.layout && !LAYOUTS.includes(plan.layout)) out.push(`layout: one of ${LAYOUTS.join(', ')}`);
  return out;
}
export const LAYOUTS = ['tenement', 'mansion', 'rooming'];

export const storeyCount = (plan) => Math.max(...plan.masses.map((m) => m.storeys[1]));
// the floor of storey `s`, metres over the ground floor's
export const floorOf = (plan, s) => r2(s === 0 ? 0 : (plan.ground_h || plan.storey_h) + (s - 1) * plan.storey_h);
export const storeyH = (plan, s) => (s === 0 ? plan.ground_h || plan.storey_h : plan.storey_h);

// The outline of storey `s`: the largest mass that has it. Masses are taken as nested setbacks, the shape every
// tower in the city has; a plan whose masses sit side by side at one storey is reported, not guessed at.
export function outlineAt(plan, s) {
  const has = plan.masses.filter((m) => s >= m.storeys[0] && s < m.storeys[1]);
  if (!has.length) return null;
  const area = (r) => (r[1] - r[0]) * (r[3] - r[2]);
  return [...has].sort((a, b) => area(b.rect) - area(a.rect))[0].rect;
}
// does a smaller mass at this storey stick out past the largest? (then outlineAt is wrong for it)
export function sideBySide(plan, s) {
  const o = outlineAt(plan, s);
  return plan.masses.some((m) => s >= m.storeys[0] && s < m.storeys[1] && (m.rect[0] < o[0] - 0.01 || m.rect[1] > o[1] + 0.01 || m.rect[2] < o[2] - 0.01 || m.rect[3] > o[3] + 0.01));
}

// The storeys that get rooms. A low building gets all of them; a taller one the ground, the top, every third or
// fourth storey down from the top (the seed picks which), and the first storey of every setback, since that's the
// floor that looks different from the street. Over twelve storeys, no more than four landings over the lobby.
export function walkableStoreys(plan, seed = '') {
  const n = storeyCount(plan);
  // `floors: 'all'` on the plan: a building people live in, where every storey is lived on and the walk past more
  // landings is the price of housing them
  if (n <= 4 || plan.floors === 'all') return [...Array(n).keys()];
  const step = 3 + pick(seed, 'step', 2), set = new Set([0]), steps = new Set();
  for (let s = n - 1; s > 0; s -= step) { set.add(s); if (s !== n - 1) steps.add(s); }
  // every mass over the ground gets a floor: its lowest storey, if the steps didn't land in it, and a step storey
  // next to that one goes, so the two don't stand a storey apart
  const setbacks = [];
  for (const m of plan.masses) {
    const [a, b] = m.storeys;
    if (a === 0 || [...set].some((s) => s >= a && s < b)) continue;
    set.add(a); setbacks.push(a);
    for (const d of [a - 1, a + 1]) if (steps.has(d)) set.delete(d);
  }
  let out = [...set].sort((a, b) => a - b);
  if (n > 12) {
    const keep = new Set([0, n - 1, ...setbacks]);
    while (out.length > 5) {
      const drop = out.filter((s) => !keep.has(s));
      if (!drop.length) break;
      // the one closest to the floor below it goes
      drop.sort((a, b) => (a - out[out.indexOf(a) - 1]) - (b - out[out.indexOf(b) - 1]));
      out = out.filter((s) => s !== drop[0]);
    }
  }
  return out;
}

// ── panes: the windows a room gets from the bays on its faces ────────────────────────────────────
// The bays on `side` at storey `s`, as [a, b, y0, y1, kind] along the face's measure
export function baysAt(plan, side, s) {
  const o = outlineAt(plan, s), along = side === 'north' || side === 'south' ? [o[0], o[1]] : [o[2], o[3]], out = [];
  for (const b of plan.bays || []) {
    if (b.side !== side || !(s >= b.storeys[0] && s < b.storeys[1])) continue;
    const kind = b.kind || 'sash', y0 = b.y0 ?? 0.9, y1 = b.y1 ?? Math.min(storeyH(plan, s) - 0.4, 2.3);
    if (Array.isArray(b.at)) { out.push([b.at[0], b.at[1], y0, y1, kind]); continue; }
    const len = along[1] - along[0], n = Math.max(1, Math.floor((len - 0.6) / b.pitch)), first = (along[0] + along[1]) / 2 - ((n - 1) * b.pitch) / 2;
    for (let i = 0; i < n; i++) { const c = first + i * b.pitch; out.push([r2(c - b.w / 2), r2(c + b.w / 2), y0, y1, kind]); }
  }
  return out;
}

// ── the room's own frame ─────────────────────────────────────────────────────────────────────────
// building-graph.js's: a room facing `face` (degrees, 0 north) has its front wall on that side, `u` across it to
// the right ([cos f, -sin f] on the plan) and `v` back from it. `at` is the middle of its front wall.
export function roomFrame(rect, face) {
  const f = face * Math.PI / 180, fx = Math.round(Math.sin(f)), fz = Math.round(Math.cos(f)), rx = Math.round(Math.cos(f)), rz = -Math.round(Math.sin(f));
  const cx = (rect[0] + rect[1]) / 2, cz = (rect[2] + rect[3]) / 2, ns = face % 180 === 0;
  const w = ns ? rect[1] - rect[0] : rect[3] - rect[2], d = ns ? rect[3] - rect[2] : rect[1] - rect[0];
  const at = [cx + fx * d / 2, cz + fz * d / 2];
  const toRoom = ([x, z]) => [r2(rx * (x - at[0]) + rz * (z - at[1])), r2(-(fx * (x - at[0]) + fz * (z - at[1])))];
  const fromRoom = ([u, v]) => [r2(at[0] + rx * u - fx * v), r2(at[1] + rz * u - fz * v)];
  // which of the room's walls is on the plan's `side`
  const wallOn = (side) => { const b = (BEARING[side] - face + 360) % 360; return b === 0 ? 'front' : b === 180 ? 'back' : b === 90 ? 'right' : 'left'; };
  return { w: r2(w), d: r2(d), at, toRoom, fromRoom, wallOn, mid: [cx, cz] };
}

// ── laying a floor out ───────────────────────────────────────────────────────────────────────────
// Rects are [x0, x1, z0, z1]. The chain runs along `axis` ('z' or 'x'); "along" is that axis and "across" the other.
const inset = (r, by) => [r[0] + by[0], r[1] - by[1], r[2] + by[2], r[3] - by[3]];

// The layout a building takes: `across` if a side face is shared (the flats would have no windows), else the
// seed's pick, `depth` more often on a deep plot.
export function chainLayout(plan, seed) {
  const front = plan.door.side, sides = front === 'north' || front === 'south' ? ['east', 'west'] : ['north', 'south'];
  if (sides.some((s) => plan.shared?.includes(s))) return 'across';
  if ([front, OPP[front]].some((s) => plan.shared?.includes(s))) return 'depth';
  return pick(seed, 'layout', 3) ? 'depth' : 'across';
}

// The core: where the chain runs on every upper floor, and the point the stairs and the lobby meet at. Worked out
// on the smallest walkable outline, so it's inside every floor.
export function corePlan(plan, walk, seed) {
  const T = PLAN_TUNE, front = plan.door.side, mode = chainLayout(plan, seed);
  const outs = walk.map((s) => outlineAt(plan, s)), small = outs.reduce((a, r) => [Math.max(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.min(a[3], r[3])]);
  // depth: the chain runs from the front to the back; across: along the front. `axis` is the plan axis it runs along.
  const frontNS = front === 'north' || front === 'south';
  const axis = mode === 'depth' ? (frontNS ? 'z' : 'x') : (frontNS ? 'x' : 'z');
  const [a0, a1, c0, c1] = axis === 'z' ? [small[2], small[3], small[0], small[1]] : [small[0], small[1], small[2], small[3]];
  // across the chain: in the middle, or a bay's width off it toward one side (the seed)
  const room = (c1 - c0) - 2 * T.wallOut - T.chainW;
  if (room < 2 * T.flatMinW) return { problem: `the smallest floor is ${r2(c1 - c0)} m across the chain: too narrow for a flat either side` };
  const off = [0, 1.2, -1.2][pick(seed, 'chainOff', 3)], slack = room / 2 - T.flatMinW;
  const cm = (c0 + c1) / 2 + Math.max(-slack, Math.min(slack, off));
  const cross = [r2(cm - T.chainW / 2), r2(cm + T.chainW / 2)];
  // along the chain the landing is at the back (depth) or at the end the seed picks (across). `dir` is +1 when the
  // landing is at the high end of the axis.
  let hi;
  if (mode === 'depth') hi = front === 'south' || front === 'west';   // the back is north or east: the high end
  else hi = !!pick(seed, 'landingEnd', 2);
  const end = hi ? a1 - T.wallOut : a0 + T.wallOut, start = hi ? end - T.landing : end + T.landing;
  if ((a1 - a0) - 2 * T.wallOut < T.landing + T.rowMin) return { problem: `the smallest floor is ${r2(a1 - a0)} m along the chain: too short for a landing and a row` };
  // the stair's foot: in the landing, climbing toward its end; the lobby's link lands at the same point
  const footAlong = hi ? start + T.stair.foot : start - T.stair.foot;
  const foot = axis === 'z' ? [cm, footAlong] : [footAlong, cm];
  return { mode, axis, cross, hi, landingStart: r2(start), small, foot: foot.map(r2), climbSide: axis === 'z' ? (hi ? 'north' : 'south') : (hi ? 'east' : 'west') };
}

// Rows along the chain on one floor: the landing's row, then the rest split as evenly as `rowTarget` likes
function rowsOf(core, outline, seed, s, target = PLAN_TUNE.rowTarget) {
  const T = PLAN_TUNE, [a0, a1] = core.axis === 'z' ? [outline[2], outline[3]] : [outline[0], outline[1]];
  const lo = a0 + T.wallOut, hi = a1 - T.wallOut;
  // the landing's row runs from this floor's own end wall to the core's fixed start
  const land = core.hi ? [core.landingStart, hi] : [lo, core.landingStart];
  const rest = core.hi ? [lo, core.landingStart] : [core.landingStart, hi], len = rest[1] - rest[0];
  let k = Math.max(1, Math.round(len / target + [0, 0.35, -0.35][pick(seed, `rows${s}`, 3)]));
  while (k > 1 && len / k < T.rowMin) k--;
  const rows = [];
  for (let i = 0; i < k; i++) rows.push([r2(rest[0] + (len * i) / k), r2(rest[0] + (len * (i + 1)) / k)]);
  // nearest the landing first
  if (core.hi) rows.reverse();
  return [land.map(r2), ...rows];
}

// a rect from an along-range and an across-range
const rectOf = (axis, along, across) => (axis === 'z' ? [across[0], across[1], along[0], along[1]] : [along[0], along[1], across[0], across[1]]);
// the two sides of the chain: [low side, high side] of the across axis
const crossSides = (axis) => (axis === 'z' ? ['west', 'east'] : ['south', 'north']);
const alongSides = (axis) => (axis === 'z' ? ['south', 'north'] : ['west', 'east']);

// The rooms of storey `s`. Each: { id, s, role, rect (on partition lines), face, faces: open sides, unit?, links }.
// `links` are [otherId, side]: a door from this room on `side` to the other. Partition lines are where two rooms
// meet; the rooms themselves are set in from them by half a wall each (finishRooms).
function upperFloor(plan, core, s, seed, layout) {
  const T = PLAN_TUNE, o = outlineAt(plan, s), rows = rowsOf(core, o, seed, s, layout === 'rooming' ? T.roomTarget : T.rowTarget);
  const [c0, c1] = core.axis === 'z' ? [o[0], o[1]] : [o[2], o[3]], [lowS, highS] = crossSides(core.axis);
  const lo = c0 + T.wallOut, hi = c1 - T.wallOut, rooms = [], P = `f${s}`;
  const towardLanding = core.axis === 'z' ? (core.hi ? 'north' : 'south') : (core.hi ? 'east' : 'west');
  // the chain: the landing, then a hall a row
  rows.forEach((row, i) => rooms.push({ id: i ? `${P}_h${i}` : P, s, role: i ? 'hall' : 'landing', rect: rectOf(core.axis, row, core.cross), face: BEARING[OPP[towardLanding]], links: [] }));
  for (let i = 1; i < rows.length; i++) rooms[i].links.push([rooms[i - 1].id, towardLanding]);
  // the flats: a cell a row a side
  let k = 0;
  for (const [side, across] of [[lowS, [lo, core.cross[0]]], [highS, [core.cross[1], hi]]]) {
    rows.forEach((row, i) => {
      const cell = rectOf(core.axis, row, across);
      if (layout === 'mansion' && Math.abs(row[1] - row[0]) >= T.mansionMinW && across[1] - across[0] >= T.mansionMinAcross && i > 0) rooms.push(...mansionFlat(cell, side, core, rooms[i].id, `u${s}_${++k}`, s, seed));
      // a rooming house: single rooms, and the shared bathroom beside the landing, on the side the seed picks
      else if (layout === 'rooming' && i === 0 && side === [lowS, highS][pick(seed, 'bathSide', 2)]) rooms.push({ id: `f${s}_bath`, s, role: 'washroom', rect: cell, face: BEARING[side], links: [[rooms[i].id, OPP[side]]] });
      else rooms.push({ id: `u${s}_${++k}`, s, role: layout === 'rooming' ? 'room' : 'flat', rect: cell, face: BEARING[side], unit: `u${s}_${k}`, links: [[rooms[i].id, OPP[side]]] });
    });
  }
  return rooms;
}

// A mansion flat in one cell: the living room the full depth from the hall to the face, with the bedroom past it
// along the chain on the face and the bath between the bedroom and the hall (no window).
function mansionFlat(cell, side, core, hallId, id, s, seed) {
  const ax = core.axis, [a0, a1] = ax === 'z' ? [cell[2], cell[3]] : [cell[0], cell[1]], [c0, c1] = ax === 'z' ? [cell[0], cell[1]] : [cell[2], cell[3]];
  // which end of the cell the living room takes (the seed), and where it stops: 55% of the length
  const liveLow = !!pick(seed, `live${id}`, 2), cut = r2(liveLow ? a0 + (a1 - a0) * 0.55 : a1 - (a1 - a0) * 0.55);
  const live = liveLow ? [a0, cut] : [cut, a1], rest = liveLow ? [cut, a1] : [a0, cut];
  // across: the face is at c1 on the high side, c0 on the low; the bath takes the inner 2.2 m
  const outerHigh = side === crossSides(ax)[1], bw = PLAN_TUNE.bathW, bathAt = outerHigh ? [c0, r2(c0 + bw)] : [r2(c1 - bw), c1], bedAt = outerHigh ? [r2(c0 + bw), c1] : [c0, r2(c1 - bw)];
  const toBed = alongSides(ax)[liveLow ? 1 : 0];
  return [
    { id, s, role: 'living', rect: rectOf(ax, live, [c0, c1]), face: BEARING[side], unit: id, links: [[hallId, OPP[side]], [`${id}_bed`, toBed]] },
    { id: `${id}_bed`, s, role: 'bedroom', rect: rectOf(ax, rest, bedAt), face: BEARING[side], unit: id, links: [[id, OPP[toBed]], [`${id}_bath`, OPP[side]]] },
    { id: `${id}_bath`, s, role: 'bath', rect: rectOf(ax, rest, bathAt), face: BEARING[side], unit: id, links: [[`${id}_bed`, side]] },
  ];
}

// The ground floor: a lobby from the street door to the back wall across the core's foot, a shop on a side with
// shopfront bays and a back room behind it, and a ground flat (or a store) on a side without.
function groundFloor(plan, core, seed) {
  const T = PLAN_TUNE, o = outlineAt(plan, 0), front = plan.door.side, frontNS = front === 'north' || front === 'south';
  const ax = frontNS ? 'z' : 'x', [a0, a1] = ax === 'z' ? [o[2], o[3]] : [o[0], o[1]], [c0, c1] = ax === 'z' ? [o[0], o[1]] : [o[2], o[3]];
  const lo = a0 + T.wallOut, hi = a1 - T.wallOut;
  // the lobby is as wide as the chain, centred on the core's foot across this axis, and covers the door
  const footC = ax === 'z' ? core.foot[0] : core.foot[1], doorC = plan.door.at ?? (c0 + c1) / 2;
  const half = T.chainW / 2, l0 = Math.min(footC, doorC) - half, l1 = Math.max(footC, doorC) + half;
  const lob = [r2(Math.max(c0 + T.wallOut + T.flatMinW, l0)), r2(Math.min(c1 - T.wallOut - T.flatMinW, l1))];
  const rooms = [{ id: 'lobby', s: 0, role: 'lobby', rect: rectOf(ax, [lo, hi], lob), face: BEARING[front], links: [] }];
  const frontHigh = front === 'north' || front === 'east';
  const [lowS, highS] = crossSides(ax);
  const shopDepth = Math.min(hi - lo - T.rowMin, Math.max(T.rowMin, (hi - lo) * 0.55));
  for (const [side, across] of [[lowS, [c0 + T.wallOut, lob[0]]], [highS, [lob[1], c1 - T.wallOut]]]) {
    // shopfront bays on the street face inside this side's span
    const retail = baysAt(plan, front, 0).some(([a, b, , , kind]) => kind === 'retail' && b > across[0] && a < across[1]);
    if (retail) {
      const shopAlong = frontHigh ? [r2(hi - shopDepth), hi] : [lo, r2(lo + shopDepth)], backAlong = frontHigh ? [lo, r2(hi - shopDepth)] : [r2(lo + shopDepth), hi];
      const id = rooms.some((r) => r.role === 'shop') ? 'shop2' : 'shop';
      rooms.push({ id, s: 0, role: 'shop', rect: rectOf(ax, shopAlong, across), face: BEARING[front], links: [['lobby', OPP[side]]] });
      rooms.push({ id: `${id}_back`, s: 0, role: 'backroom', rect: rectOf(ax, backAlong, across), face: BEARING[front], links: [[id, front]] });
    } else {
      const role = plan.building_type === 'office' ? 'office' : 'flat', id = role === 'flat' ? `u0_${side[0]}` : `office_${side[0]}`;
      rooms.push({ id, s: 0, role, rect: rectOf(ax, [lo, hi], across), face: BEARING[side], unit: role === 'flat' ? id : undefined, links: [['lobby', OPP[side]]] });
    }
  }
  return rooms;
}

// the sides of a partition rect that are on this storey's outside wall, and not shared
function openFaces(plan, rect, s) {
  const o = outlineAt(plan, s), T = PLAN_TUNE, near = (a, b) => Math.abs(a - b) < T.wallOut + 0.05, out = [];
  if (near(rect[0], o[0])) out.push('west');
  if (near(rect[1], o[1])) out.push('east');
  if (near(rect[2], o[2])) out.push('south');
  if (near(rect[3], o[3])) out.push('north');
  return out.filter((f) => !plan.shared?.includes(f));
}

// The whole building: every room with its room rect (set in from the partition lines), its panes in its own walls,
// its doors with their offsets, and the vertical links. `problems` lists what the generator couldn't do.
export function planRooms(plan, { seed = plan.facade } = {}) {
  const problems = planProblems(plan);
  if (problems.length) return { problems };
  const layout = plan.layout || 'tenement', walk = walkableStoreys(plan, seed);
  for (const s of walk) if (sideBySide(plan, s)) problems.push(`storey ${s}: masses side by side; the outline is the largest only`);
  const core = corePlan(plan, walk.filter((s) => s > 0), seed);
  if (core.problem) return { problems: [...problems, core.problem] };
  const rooms = [...groundFloor(plan, core, seed)];
  for (const s of walk) if (s > 0) rooms.push(...upperFloor(plan, core, s, seed, layout));
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const T = PLAN_TUNE, half = T.gap / 2;

  for (const r of rooms) {
    r.open = openFaces(plan, r.rect, r.s);
    r.floor = floorOf(plan, r.s);
    r.h = r2(storeyH(plan, r.s));
    // set in: half a wall where it meets another room, nothing more on an outside face (the partition line there is
    // already the outline less the model's wall)
    const o = outlineAt(plan, r.s), atOut = (a, b) => Math.abs(a - b) < T.wallOut + 0.05;
    r.room = r2s(inset(r.rect, [atOut(r.rect[0], o[0]) ? 0 : half, atOut(r.rect[1], o[1]) ? 0 : half, atOut(r.rect[2], o[2]) ? 0 : half, atOut(r.rect[3], o[3]) ? 0 : half]));
    const F = roomFrame(r.room, r.face);
    r.w = F.w; r.d = F.d;
    if (r.w < T.roomMin || r.d < T.roomMin) problems.push(`${r.id}: ${r.w} by ${r.d} m, under the ${T.roomMin} m a room can be`);
    // panes: every bay on an open face that falls inside this room's wall, short of the corners
    r.panes = [];
    for (const side of r.open) {
      const wall = F.wallOn(side), ns = side === 'north' || side === 'south', [lo, hi] = ns ? [r.room[0], r.room[1]] : [r.room[2], r.room[3]];
      const edge = side === 'north' ? r.room[3] : side === 'south' ? r.room[2] : side === 'east' ? r.room[1] : r.room[0];
      for (const [a, b, y0, y1, kind] of baysAt(plan, side, r.s)) {
        const A = Math.max(a, lo + T.paneMargin), B = Math.min(b, hi - T.paneMargin);
        if (B - A < 0.3) continue;
        // a shopfront's glass is only the shop's; anybody else gets no pane from it
        if (kind === 'retail' && r.role !== 'shop') continue;
        if (y1 > r.h - 0.1) continue;
        const p = [A, B].map((t) => F.toRoom(ns ? [t, edge] : [edge, t])), along = wall === 'front' || wall === 'back' ? 0 : 1;
        const pa = Math.min(p[0][along], p[1][along]), pb = Math.max(p[0][along], p[1][along]);
        r.panes.push({ wall, a: r2(pa), b: r2(pb), y0, y1: Math.min(y1, r2(r.h - 0.35)), kind: kind === 'retail' ? 'curtain' : kind });
      }
    }
  }

  // doors: each link once a pair, both sides, at the middle of the overlap of the two rooms' walls (the seed may
  // slide it toward one end), offsets measured as building-graph measures them, from each room's middle
  const doors = [];
  const seen = new Set();
  for (const r of rooms) for (const [to, side] of r.links) {
    const B = byId.get(to);
    if (!B) { problems.push(`${r.id}: links to ${to}, which isn't laid out`); continue; }
    const key = [r.id, to].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const ns = side === 'north' || side === 'south', ov = ns ? [Math.max(r.room[0], B.room[0]), Math.min(r.room[1], B.room[1])] : [Math.max(r.room[2], B.room[2]), Math.min(r.room[3], B.room[3])];
    if (ov[1] - ov[0] < 1.3) { problems.push(`${r.id} ${side} to ${to}: the walls overlap ${r2(ov[1] - ov[0])} m, too little for a door`); continue; }
    const slide = [0, 0.25, -0.25][pick(seed, `door${key}`, 3)] * (ov[1] - ov[0] - 1.3) / 2, at = r2((ov[0] + ov[1]) / 2 + slide);
    const mid = (R) => (ns ? (R.room[0] + R.room[1]) / 2 : (R.room[2] + R.room[3]) / 2);
    doors.push({ a: r.id, b: to, dir: side, offA: r2(at - mid(r)), offB: r2(at - mid(B)) });
  }

  // vertical: the lobby and each landing to the next walkable storey up. Next storeys get a flight (`stair` on the
  // one below); further apart, the link is a climb the prose tells, and both ends say where the stair is so the
  // rooms line up over each other.
  const landings = [byId.get('lobby'), ...walk.filter((s) => s > 0).map((s) => byId.get(`f${s}`))];
  const climbs = [];
  for (let i = 0; i + 1 < landings.length; i++) {
    const A = landings[i], B = landings[i + 1], flight = B.s === A.s + 1 && (A.id !== 'lobby' || core.mode === 'depth');
    climbs.push({ a: A.id, b: B.id, flight, at: core.foot, climb: core.climbSide });
  }
  return { problems, core, walk, layout, rooms, doors, climbs };
}
const r2s = (a) => a.map(r2);

// A floor drawn in text for the report: one character a half metre, each room's last letter or digit
export function drawFloor(rooms, s, res = 0.5) {
  const F = rooms.filter((r) => r.s === s);
  if (!F.length) return '';
  const x0 = Math.min(...F.map((r) => r.rect[0])), x1 = Math.max(...F.map((r) => r.rect[1])), z0 = Math.min(...F.map((r) => r.rect[2])), z1 = Math.max(...F.map((r) => r.rect[3]));
  const W = Math.ceil((x1 - x0) / res), H = Math.ceil((z1 - z0) / res), keys = new Map(), lines = [];
  const glyph = (r) => r.role === 'landing' ? '#' : r.role === 'hall' ? '+' : r.role === 'lobby' ? '#' : r.role === 'shop' ? 'S' : r.role === 'backroom' ? 'b' : r.role === 'bath' ? '~' : r.role === 'bedroom' ? 'z' : null;
  let n = 0;
  for (const r of F) if (!glyph(r)) keys.set(r.id, 'ABCDEFGHJKLMNPQRTUVWXY'[n++ % 22]);
  for (let j = H - 1; j >= 0; j--) {
    let line = '';
    for (let i = 0; i < W; i++) {
      const x = x0 + (i + 0.5) * res, z = z0 + (j + 0.5) * res, r = F.find((q) => x >= q.room[0] && x <= q.room[1] && z >= q.room[2] && z <= q.room[3]);
      line += r ? glyph(r) || keys.get(r.id) : ' ';
    }
    lines.push(line);
  }
  const legend = [...keys].map(([id, k]) => `${k} ${id}`).join('  ');
  return `${lines.join('\n')}\n${legend}`;
}
