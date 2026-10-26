// ── WORLD FEED: WHAT EVERY 3D VIEW DRAWS, WHICHEVER VIEW IT IS ────────────────────────────────
//
// GLASS is drawn from five seats: the cockpit, the truck cab, the powerboat, the Echelon's helm
// and the free camera. Each has its own panel, its own server payload and its own message, and
// the world events below used to ride whichever one needed them first. A fireworks shell went to
// airborne aircraft only, so somebody standing under the show in a 3D view saw the sky flash and
// no shell; an AA battery's turret was drawn for the pilot seat and nobody else.
//
// So these are kept here by WORLD TILE, fed by the dispatcher whatever view is open, and read by
// the renderer, which resolves them against the view's own position each frame. A view written
// next year gets them for nothing.
//
// ⚠ NO IMPORTS, AND THAT IS A RULE. windshield.js imports this file, and the cold open and every
// `scripts/shapes/*` gate load windshield.js against a DOM stub with no session.

const now0 = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ── FIREWORKS ────────────────────────────────────────────────────────────────
// One burst's life on screen: the shell's climb and the flower, the same 1.7 s the cockpit used.
export const FIREWORK_MS = 1700;
const BURSTS = [];
export function noteFirework(msg) {
  if (!msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
  BURSTS.push({ x: msg.x, y: msg.y, t0: now0(), rgb: Array.isArray(msg.rgb) ? msg.rgb : [255, 220, 120], seed: Math.random() * 100 });
  if (BURSTS.length > 24) BURSTS.splice(0, BURSTS.length - 24);
}
// The live bursts as offsets from (x, y), the view's own position, each with its 0..1 life. Null
// when there are none, which is every frame but a few seconds a show.
export function fireworksAround(x, y, now = now0()) {
  if (!BURSTS.length) return null;
  while (BURSTS.length && now - BURSTS[0].t0 >= FIREWORK_MS) BURSTS.shift();
  if (!BURSTS.length) return null;
  return BURSTS.map((b) => ({ dx: b.x - x, dy: b.y - y, t: (now - b.t0) / FIREWORK_MS, rgb: b.rgb, seed: b.seed }));
}

// ── AA BATTERIES ─────────────────────────────────────────────────────────────
// The map cell says what a battery was when the window was sent (`aa.s`); these say what it has
// done since. `s` is 1 manned, 2 under repair, 0 a ruin. `fire` is the last time it opened up and
// the contact id it was shooting at (the aircraft row id), which is how the barrels find their mark
// in a view that can see that aircraft.
const AA = new Map();
export const AA_FIRE_MS = 2600;
export function noteAAState(msg) {
  if (!msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.y) || !Number.isFinite(msg.s)) return;
  const k = msg.x + ',' + msg.y, e = AA.get(k) || {};
  e.s = msg.s;
  if (msg.s !== 1) e.fireAt = 0;
  AA.set(k, e);
}
export function noteAAFire(msg) {
  if (!msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
  const k = msg.x + ',' + msg.y, e = AA.get(k) || {};
  e.fireAt = now0(); e.target = msg.t ?? null;
  // A battery that fires is manned, whatever the window said when it was sent.
  e.s = 1;
  AA.set(k, e);
}
// What has happened at the battery on tile (x, y) since its cell was sent, or undefined.
export function aaLive(x, y) { return AA.size ? AA.get(x + ',' + y) : undefined; }

// ── CONTACTS IN A VIEW'S OWN FRAME ───────────────────────────────────────────
// Every producer sends contacts in absolute world tiles; the renderer wants them as offsets from
// the view's own position. Between pushes (a second or two) they are dead-reckoned on a velocity
// DIFFERENCED FROM THE PUSHES, never from `ias`: the wire's speed is knots from one producer and
// mph from another, and an aircraft's real ground rate is a tune (`worldPace`), so a speed read off
// the dial walked every contact the wrong distance and snapped it back at the next push.
const DR_MAX_S = 2.5;   // seconds of dead reckoning before a stale contact is left where it was
export function makeContactTrack() {
  let list = [], at = 0;
  const vel = new Map();   // id → { x, y, t, vx, vy }
  return {
    // A fresh list from the server. An empty list is a real answer and clears the picture.
    update(next) {
      const t = now0();
      list = Array.isArray(next) ? next : [];
      at = t;
      const seen = new Set();
      for (const c of list) {
        if (!c || c.id == null || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
        seen.add(c.id);
        const p = vel.get(c.id), dt = p ? (t - p.t) / 1000 : 0;
        // A gap too short is noise and too long is a different flight; either way, no velocity.
        const ok = p && dt > 0.25 && dt < 6;
        vel.set(c.id, { x: c.x, y: c.y, t, vx: ok ? (c.x - p.x) / dt : 0, vy: ok ? (c.y - p.y) / dt : 0 });
      }
      for (const id of vel.keys()) if (!seen.has(id)) vel.delete(id);
    },
    // The list as offsets from (ax, ay). `roadRig` scales a truck to the road the way the cab does
    // (a rig drawn at its from-the-air size is a toy beside lane markings a metre across).
    frame(ax, ay, opts = {}) {
      if (!list.length) return [];
      const age = Math.min(DR_MAX_S, Math.max(0, (now0() - at) / 1000));
      const out = [];
      for (const c of list) {
        if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
        const v = c.id != null ? vel.get(c.id) : null;
        const x = c.x + (v ? v.vx * age : 0), y = c.y + (v ? v.vy * age : 0);
        const dx = x - ax, dy = y - ay;
        const ground = c.onGround || c.band === 'ground';
        const rig = opts.roadRig && c.cls === 'truck' ? opts.roadRig : 1;
        out.push({ ...c, dx, dy, rng: Math.hypot(dx, dy), sizeMul: (c.sizeMul || 1) * rig,
          ...(ground ? { groundZ: 0, altDiff: 0 } : { altDiff: c.alt || 0 }) });
      }
      return out;
    },
    get size() { return list.length; },
    // The list as it arrived, absolute tiles: for a reader that wants positions, not offsets (boat audio).
    get raw() { return list; },
  };
}

// ── VENUE LIGHTS ─────────────────────────────────────────────────────────────
// The cell says whether a venue's light towers were on when the window was sent (`vl`, the
// Hughson Coliseum's game nights); these say what changed since, by tile. A view left open over the
// park through first pitch sees the towers come on without waiting for its window to move.
const VENUE = new Map();
export function noteVenueLit(msg) {
  for (const [list, on] of [[msg && msg.on, 1], [msg && msg.off, 0]]) {
    if (!Array.isArray(list)) continue;
    for (const p of list) if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) VENUE.set(p[0] + ',' + p[1], on);
  }
  _venueEpoch++;
}
// 1 or 0 if the venue on tile (x, y) has changed since its cell was sent, or undefined.
export function venueLive(x, y) { return VENUE.size ? VENUE.get(x + ',' + y) : undefined; }

// ── VENUE ROOFS ──────────────────────────────────────────────────────────────
// The cell says whether a venue's roof was shut when the window was sent (`vr`, 1 shut); a
// `venue_roof` push says it has started to move since, and these remember when. The roof travels
// for ROOF_MS from where it was, so a view open over the Coliseum when the rain comes watches the
// shells roll south and close, and one opened afterwards finds it shut.
// ⚠ THE MESH IS KEYED ON THE STATE, NOT THE POSITION. GLASS 2 caches a building's mesh per key
// (gl/world.js `meshParams`), so a roof at rest is mesh and a moving one can't be: while it moves the
// key says so and the arm draws the shells as decals. `venueEpoch` is what tells the GL pass to
// rebuild its window, once when a move starts and once when it ends.
export const ROOF_MS = 5 * 60 * 1000;   // five minutes end to end
const ROOF = new Map();       // "x,y" → { to, from, t0, done }
let _venueEpoch = 0;
const roofAt = (e, now) => {
  const u = Math.min(1, Math.max(0, (now - e.t0) / ROOF_MS));
  const s = u * u * (3 - 2 * u);   // the drive eases out of rest and back into it
  return e.from + (e.to - e.from) * s;
};
export function noteVenueRoof(msg) {
  const now = Date.now();
  for (const [list, to] of [[msg && msg.shut, 1], [msg && msg.open, 0]]) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const k = p[0] + ',' + p[1], cur = ROOF.get(k);
      if (cur && cur.to === to) continue;
      // From wherever it is now; a roof this view never saw move starts from the other end.
      ROOF.set(k, { to, from: cur ? roofAt(cur, now) : 1 - to, t0: now, done: false });
    }
  }
  _venueEpoch++;
}
// The roof on tile (x, y) since its cell was sent: `p` how shut it is now (0 open, 1 shut), `to` where
// it is going, `moving` until it gets there. Undefined if it hasn't moved in this view.
export function venueRoof(x, y, now = Date.now()) {
  if (!ROOF.size) return undefined;
  const e = ROOF.get(x + ',' + y);
  if (!e) return undefined;
  return { p: roofAt(e, now), to: e.to, moving: now - e.t0 < ROOF_MS };
}
// Bumped whenever a venue's lights or roof change state, including a roof arriving where it was
// going, which no message announces. The GL pass keys its window on it.
export function venueEpoch(now = Date.now()) {
  for (const e of ROOF.values()) if (!e.done && now - e.t0 >= ROOF_MS) { e.done = true; _venueEpoch++; }
  return _venueEpoch;
}
// ── THE OPEN BAY ─────────────────────────────────────────────────────────────
// While a depot's service bay is open on the glass, the tile its vehicle stands on. A building that
// roofs a berth (the marinas' covered docks, `berthRoof` in glass/model-registry.js) takes that
// roof off for the service cutaway when the bay is open beside it, and GLASS 2 keys its mesh on it
// (gl/world.js `serviceKey`), so a change bumps the epoch the way a venue push does. windshield.js
// sets it once a frame from the seat's own view; null is no bay open.
let _svcK = null, _svcX = 0, _svcY = 0;
export function noteServiceAt(x, y) {
  const on = Number.isFinite(x) && Number.isFinite(y);
  const k = on ? Math.round(x) + ',' + Math.round(y) : null;
  if (k === _svcK) return;
  _svcK = k; _svcX = on ? Math.round(x) : 0; _svcY = on ? Math.round(y) : 0;
  _venueEpoch++;
}
// Whether the open bay's vehicle is within `reach` tiles of (x, y), either way.
export function serviceNear(x, y, reach = 1) {
  return _svcK !== null && Math.abs(x - _svcX) <= reach && Math.abs(y - _svcY) <= reach;
}

// What a venue tile's mesh is built as: `vl` its game night, `vr` its roof (1 shut, 0 open, null
// none) and `vrm` whether that roof is moving. `cell` is the map window's cell for the tile.
export function venueState(x, y, cell, now = Date.now()) {
  const lit = venueLive(x, y), r = venueRoof(x, y, now);
  return {
    vl: lit !== undefined ? lit : (cell && cell.vl ? 1 : 0),
    vr: r ? r.to : (cell && cell.vr != null ? cell.vr : null),
    vrm: r && r.moving ? 1 : 0,
  };
}
