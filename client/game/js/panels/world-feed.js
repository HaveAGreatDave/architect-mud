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
