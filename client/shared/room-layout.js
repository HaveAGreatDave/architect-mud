// THE ROOM STAGE'S LAYOUT: one room, described once, for every 3-D interior you walk round in first
// person (docs/proposals/room-stage.md). Pure: no DOM, no GL, so the server stamps a placed piece's
// spot with the same rules the client lays the room out by, and a gate runs it in Node.
//
// A room is a SPEC and its PIECES.
//
//   spec    { w, d, h, unit, at, face, floor, door, window }. `unit` is 'm' (a flat, the default) or
//           'ft' (the Platinum Box suite, in the ballpark's feet). `at` is the middle of the front
//           wall on the ground in the host's own frame and `face` the way the front wall looks
//           (degrees from +z toward +x); a standalone room leaves both out and sits at the origin.
//           `door` is [u0, u1] along the back wall; `window` is [u0, u1, y0, y1] in the front wall.
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

// A flat with no `flags.room`: four metres across, five deep, 2.6 high, the window in the front wall
// and the door at the back by the right-hand corner.
export const FLAT_ROOM = Object.freeze({ w: 4, d: 5, h: 2.6 });

// ── archetypes ──────────────────────────────────────────────────────────────────────────────────
// What a piece is drawn as and what a body can do with it. `dims` is [w, d, h] in metres at the
// reference weight `ref` (grams); a piece scales by the cube root of its weight against it, held to
// SIZE_RANGE so a featherweight ghost screen is still a screen. `wall` pieces stand with their back
// to a wall; the rest stand in the room. `verb` is the gesture E or a click sends.
export const ARCHETYPES = Object.freeze({
  seat:    { dims: [0.55, 0.55, 0.9],  ref: 6000,   wall: false, verb: 'sit' },
  bench:   { dims: [1.4, 0.55, 0.85],  ref: 15000,  wall: true,  verb: 'sit' },
  sofa:    { dims: [2.0, 0.9, 0.85],   ref: 25000,  wall: true,  verb: 'sit' },
  bed:     { dims: [1.0, 2.05, 0.7],   ref: 60000,  wall: true,  verb: 'lie' },
  screen:  { dims: [1.1, 0.12, 0.66],  ref: 12000,  wall: true,  verb: 'watch' },
  cold:    { dims: [0.7, 0.68, 1.8],   ref: 50000,  wall: true,  verb: 'open' },
  hob:     { dims: [0.6, 0.62, 0.92],  ref: 25000,  wall: true,  verb: 'examine' },
  surface: { dims: [1.4, 0.62, 0.92],  ref: 40000,  wall: true,  verb: 'examine' },
  small:   { dims: [0.36, 0.26, 0.5],  ref: 5000,   wall: false, verb: 'examine' },
  prop:    { dims: [0.6, 0.45, 1.7],   ref: 18000,  wall: true,  verb: 'examine' },
});
const SIZE_RANGE = [0.82, 1.22];

// The archetype an item's flags and weight make it. `flags.look.arche` overrides, the way
// `tags.matter` overrides `food_profile`.
export function archetypeOf(flags = {}, grams = 0) {
  const ix = Array.isArray(flags.interactions) ? flags.interactions : [];
  if (flags.look?.arche && ARCHETYPES[flags.look.arche]) return flags.look.arche;
  if (flags.tv || ix.includes('watch')) return 'screen';
  if (Number(flags.container) > 0 || flags.preserves) return 'cold';
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
  seat: ['stool', 'chair'], bench: ['bench', 'booth'], sofa: ['sofa', 'cot'], bed: ['bed', 'pod'],
  screen: ['flat', 'crt', 'slab'], cold: ['fridge', 'double', 'chest'], hob: ['cooktop', 'range', 'microwave'],
  surface: ['counter', 'desk', 'rail'], small: ['heater', 'box'], prop: ['cabinet'],
});
export function formOf(arche, flags = {}, grams = 0) {
  if (flags.look?.form && FORMS[arche]?.includes(flags.look.form)) return flags.look.form;
  switch (arche) {
    case 'seat': return grams && grams < 4500 ? 'stool' : 'chair';
    case 'bench': return grams >= 18000 ? 'booth' : 'bench';
    case 'sofa': return grams && grams < 8000 ? 'cot' : 'sofa';
    case 'bed': return grams >= 40000 ? 'pod' : 'bed';
    case 'screen': return flags.tv_skin === 'crt' ? 'crt' : grams && grams <= 4000 ? 'slab' : 'flat';
    case 'cold': return flags.preserves === 'frozen' ? 'chest' : Number(flags.container) >= 100000 ? 'double' : 'fridge';
    case 'hob': return flags.microwave ? 'microwave' : flags.stove_tier === 'mid' || flags.stove_tier === 'high' ? 'range' : 'cooktop';
    case 'surface': return grams && grams < 8000 ? 'rail' : grams && grams < 30000 ? 'desk' : 'counter';
    case 'small': return flags.heater_target_c || flags.heater_battery_min ? 'heater' : 'box';
    default: return 'cabinet';
  }
}
// what a form's footprint is when it isn't its archetype's, [w, d, h] at the reference weight
const FORM_DIMS = { chest: [1.3, 0.72, 0.88], double: [1.3, 0.75, 2.0], range: [0.76, 0.66, 0.92], cooktop: [0.6, 0.52, 0.86],
  desk: [1.2, 0.6, 0.76], rail: [1.2, 0.12, 1.0], cot: [1.9, 0.75, 0.5], pod: [1.1, 2.15, 1.1], stool: [0.42, 0.42, 0.74], booth: [1.5, 0.7, 1.15] };

// A piece's [w, d, h] in metres: its form's or archetype's, scaled by its weight, or `flags.look.dims`.
export function dimsOf(arche, grams = 0, flags = {}) {
  const A = ARCHETYPES[arche] || ARCHETYPES.prop;
  const own = flags.look?.dims;
  if (Array.isArray(own) && own.length === 3 && own.every((x) => Number.isFinite(x) && x > 0)) return own.slice();
  // a microwave is a hob's footprint at a third of its height, on the stand it's set down on
  if (arche === 'hob' && flags.microwave) return [0.5, 0.4, 0.86];
  const fd = FORM_DIMS[formOf(arche, flags, grams)];
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

// Where a furnished piece stands: { u, v, turn, w, d, h } in the spec's units.
export function resolveSpot(spec, spot, dims) {
  const k = unitsPerM(spec), hu = spec.w / 2, D = spec.d;
  const [w, d, h] = dims.map((x) => x * k);
  // a spot is in metres whatever the room's unit
  if (spot?.wall && WALL_TURN[spot.wall] !== undefined) {
    const turn = WALL_TURN[spot.wall] + (spot.turn || 0), a = (Number(spot.along) || 0) * k, off = d / 2 + 0.02 * k;
    const at = spot.wall === 'left' ? [-hu + off, a] : spot.wall === 'right' ? [hu - off, a] : spot.wall === 'front' ? [a, off] : [a, D - off];
    return { u: at[0], v: at[1], turn, w, d, h, wall: spot.wall };
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
    out.seats.push({ kind, u, v, y: o.y ?? eye, dir: o.dir || [fu, fv], pitch: o.pitch ?? -0.08, piece: p.id, verb: o.verb || 'sit', ...(o.lie ? { lie: true, head: o.head, top: o.top } : {}) });
  };
  const station = (y, reach = 0.95) => { const [u, v] = pt(0, p.d / 2 + 0.05 * k); out.stations.push({ target: p.name, piece: p.id, verb: p.verb, u, v, y: y * k, reach: reach * k, at: [p.u, p.v] }); };
  switch (p.arche) {
    case 'seat':
      seat('chair', 0, -0.04 * k); out.climb.push([...fp, seatY]); break;
    case 'bench': {
      const n = Math.max(2, Math.round(p.w / (0.62 * k)));
      for (let i = 0; i < n; i++) seat('bench', (i - (n - 1) / 2) * p.w / n, 0);
      out.climb.push([...fp, seatY]); break;
    }
    case 'sofa': {
      const n = Math.max(2, Math.min(3, Math.round(p.w / (0.62 * k))));
      for (let i = 0; i < n; i++) seat('sofa', (i - (n - 1) / 2) * (p.w - 0.4 * k) / n, -0.06 * k);
      // lying along it: the head at the left arm, looking across the room; `head` is the way from
      // the feet to the head, `top` what the body lies on
      seat('lie', -p.w / 2 + 0.4 * k, 0, { y: 0.78 * k, lie: true, verb: 'lie', pitch: 0.05, head: [fv, -fu], top: 0.44 * k });
      out.climb.push([...fp, 0.44 * k]); break;
    }
    case 'bed':
      // the head against the wall, the eye on the pillow looking down the bed
      seat('lie', 0, -p.d / 2 + 0.35 * k, { y: 0.75 * k, lie: true, verb: 'lie', pitch: 0.12, head: [-fu, -fv], top: (p.form === 'pod' ? 0.42 : 0.38) * k });
      out.climb.push([...fp, 0.55 * k]); break;
    case 'screen': {
      // a set on a stand stands on the floor; a flat one hangs on the wall and blocks nothing
      if (p.crt) out.solid.push(fp);
      station(p.crt ? 0.8 : 1.25, 2.2); break;
    }
    case 'small': out.solid.push(fp); station(0.3, 0.9); break;
    default: out.solid.push(fp); station(Math.min(p.h / k, 1.1) * 0.9, 1.0);
  }
  return out;
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
  for (const pc of pieces) {
    if (pc.seats || pc.stations || pc.solid || pc.climb) {
      // a fitted piece: its own boxes and seats, already in the room's frame
      for (const s of pc.seats || []) seats.push({ ...s, piece: s.piece ?? pc.id });
      for (const st of pc.stations || []) stations.push({ ...st, piece: st.piece ?? pc.id });
      solid.push(...(pc.solid || [])); climb.push(...(pc.climb || []));
      continue;
    }
    const arche = ARCHETYPES[pc.arche] ? pc.arche : 'prop';
    const where = resolveSpot(S, pc.spot, pc.dims || dimsOf(arche));
    const p = { ...pc, arche, ...where, verb: pc.verb || ARCHETYPES[arche].verb, crt: !!pc.crt };
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
  // the floor under a walker: the top of whatever he's climbed onto, felt a little past its edge
  const ft = unitsPerFt(S), edge = 0.3 * ft;
  const groundAt = (u, v) => {
    let y = 0;
    for (const [a, b, c, e, t] of climb) if (u > a - edge && u < b + edge && v > c - edge && v < e + edge) y = Math.max(y, t);
    return y;
  };
  const m = 0.9 * ft;
  return { spec: S, w, d, h, floor, f, r, at, yaw, world, local, seats, stations, solid, climb, placed,
    bounds: [-w / 2 + m, w / 2 - m, m, d - m], radius: 0.6 * ft, unit: S.unit === 'ft' ? 'ft' : 'm', ft, groundAt };
}

// ── walking ─────────────────────────────────────────────────────────────────────────────────────
// Whether a body can stand at (u, v), and a walker's next spot: the move tried whole, then each axis
// on its own, so you slide along what you meet. `p` and the answer are [u, v].
export function roomFree(L, u, v) {
  return u >= L.bounds[0] && u <= L.bounds[1] && v >= L.bounds[2] && v <= L.bounds[3]
    && !L.solid.some(([a, b, c, e]) => u > a - L.radius && u < b + L.radius && v > c - L.radius && v < e + L.radius);
}
export function roomStep(L, p, du, dv) {
  const ok = (u, v) => roomFree(L, u, v);
  // somewhere you shouldn't be (a seat's own spot): any move goes, so you can always walk out
  if (!ok(p[0], p[1])) { const [a, b, c, e] = L.bounds; return [Math.max(a, Math.min(b, p[0] + du)), Math.max(c, Math.min(e, p[1] + dv))]; }
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

// ── placing ─────────────────────────────────────────────────────────────────────────────────────
// A free spot for a new piece (home-stage.md "Placing"): a screen on the left-hand wall; seats facing
// whatever screen is in the room, or against a wall; the cold, the hob and the counters along the
// right-hand wall from the back; a bed with its head to the back wall in the corner away from the
// door; the rest wherever a wall has room. Nothing goes in front of the door, and nothing tall in front of the window.
// `pieces` are the room's furnished pieces with their spots (and `crt` on a set that stands on the
// floor). Spots are in metres. Returns a spot, or null when the room is full.
export function placeSpot(spec, pieces, arche, dims, { crt = false } = {}) {
  const S = { w: FLAT_ROOM.w, d: FLAT_ROOM.d, h: FLAT_ROOM.h, ...spec };
  const k = unitsPerM(S), hu = S.w / 2 / k, D = S.d / k;
  const have = pieces.map((p) => { const a = ARCHETYPES[p.arche] ? p.arche : 'prop'; return { ...p, ...resolveSpot(S, p.spot, p.dims || dimsOf(a)), arche: a }; });
  const keep = keepClear(S);
  // a flat screen hangs over whatever's below it, so it only meets other screens
  const hung = (a, c) => a === 'screen' && !c;
  const fits = (spot) => {
    const q = resolveSpot(S, spot, dims), fp = footprint(q), gap = 0.05 * k;
    if (fp[0] < -S.w / 2 - 1e-6 || fp[1] > S.w / 2 + 1e-6 || fp[2] < -1e-6 || fp[3] > S.d + 1e-6) return false;
    const tall = q.h > 1.0 * k;
    if (!hung(arche, crt)) for (const [a, b, c, e, onlyTall] of keep) if ((!onlyTall || tall) && fp[0] < b && fp[1] > a && fp[2] < e && fp[3] > c) return false;
    for (const o of have) {
      if (hung(o.arche, o.crt) !== hung(arche, crt)) continue;
      const g = footprint(o);
      if (fp[0] < g[1] + gap && fp[1] > g[0] - gap && fp[2] < g[3] + gap && fp[3] > g[2] - gap) return false;
    }
    return true;
  };
  const along = (wall, from, to, step = 0.1) => { const out = []; for (let a = from; from <= to ? a <= to + 1e-6 : a >= to - 1e-6; a += from <= to ? step : -step) out.push({ wall, along: +a.toFixed(2) }); return out; };
  // a side wall from the back toward the window; the front and back walls from left to right
  const wallRun = (wall) => (wall === 'left' || wall === 'right' ? along(wall, D - 0.4, 0.4) : along(wall, -hu + 0.4, hu - 0.4));
  const scr = have.find((p) => p.arche === 'screen');
  let cands = [];
  if (arche === 'screen') cands = [...along('left', D * 0.45, D * 0.8), ...along('left', D * 0.45, 0.6), ...wallRun('right'), ...wallRun('front')];
  // a bed's head goes against the back wall in the far corner from the door, then along a side wall
  else if (arche === 'bed') cands = [...along('back', -hu + dims[0] / 2 + 0.05, hu - dims[0] / 2 - 0.05), ...along('left', D - dims[0] / 2 - 0.05, 0.4)];
  else if (arche === 'cold' || arche === 'hob' || arche === 'surface') cands = [...wallRun('right'), ...wallRun('back'), ...wallRun('front'), ...wallRun('left')];
  else if (arche === 'seat' || arche === 'bench' || arche === 'sofa') {
    if (scr) {
      // on the screen's line out into the room, a couple of metres back, then either side of it
      const [fu, fv] = facing(scr.turn), su = -fv, sv = fu, back = arche === 'seat' ? [1.9, 2.3, 1.6, 2.7] : [2.3, 2.7, 2.0, 3.0];
      const turn = ((scr.turn + 180 + 540) % 360) - 180;
      for (const b of back) for (const x of [0, 0.75, -0.75, 1.4, -1.4]) {
        const u = scr.u / k + fu * (b + dims[1] / 2) + su * x, v = scr.v / k + fv * (b + dims[1] / 2) + sv * x;
        cands.push({ at: [+u.toFixed(2), +v.toFixed(2)], turn });
      }
    }
    cands.push(...wallRun('right'), ...wallRun('front'), ...wallRun('left'), ...wallRun('back'));
  } else cands = [...wallRun('back'), ...wallRun('right'), ...wallRun('left'), ...wallRun('front')];
  return cands.find(fits) || null;
}

// What a new piece may not stand in: the way in from the door, and (for anything over a metre) the
// window. [u0, u1, v0, v1, onlyTall]
function keepClear(S) {
  const k = unitsPerM(S), hu = S.w / 2, D = S.d;
  const door = S.door || [hu - 1.3 * k, hu - 0.4 * k], win = S.window || [-0.8 * k, 0.8 * k];
  return [[door[0] - 0.1 * k, door[1] + 0.1 * k, D - 1.0 * k, D, false], [win[0], win[1], 0, 0.7 * k, true]];
}

// The spec a zone's room is drawn from: its own `flags.room` ({ w, d, h } in metres, or [w, d, h]),
// or, for a flat, FLAT_ROOM. Null when the room has no Stage.
export function roomSpecOf(flags, isFlat) {
  const own = flags?.room;
  const base = Array.isArray(own) ? { w: own[0], d: own[1], h: own[2] } : own && typeof own === 'object' ? own : isFlat ? FLAT_ROOM : null;
  if (!base) return null;
  const w = clampN(base.w, 2, 30, FLAT_ROOM.w), d = clampN(base.d, 2, 30, FLAT_ROOM.d), h = clampN(base.h, 2, 8, FLAT_ROOM.h);
  const hu = w / 2;
  return { w, d, h, unit: 'm', door: [hu - 1.3, hu - 0.4].map((x) => Math.max(-hu + 0.2, x)), window: [-Math.min(0.9, w / 4), Math.min(0.9, w / 4), 0.9, Math.min(h - 0.35, 2.2)] };
}
const clampN = (x, lo, hi, dflt) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : dflt);
