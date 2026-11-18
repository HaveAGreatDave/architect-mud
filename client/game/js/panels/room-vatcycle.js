// ROOM · THE VAT CYCLE (docs/proposals/clone-facility-depths.md). What the Vat Hall's machines are doing this frame,
// as a scene for gl/room-vat.js: the dressing gantry hanging off the trunk's hub on its telescopic boom, its eight
// arms and the cloth they carry, a body coming down a tube to a release vat, the vat filling and draining and its
// glass revolving open, and the body in it as everybody else sees it.
//
// An arrival is a `room_vat` from the server (plugins/roomstage, on the engine's `vat.emerging`): who, which release
// vat, and when. It plays on the respawn's own clock (server/engine/gameLoop.js scheduleVatEmergence: the body reports
// in at VAT_ASSIMILATE_MS and is dressed at VAT_DRESS_MS), so the picture and the text say the same thing together:
//
//   0.0 to 3.9 s   the fluid first: three slugs down the tube, the hose bulging round each, filling the vat to three
//                  quarters in surges that slosh it about
//   3.5 s          full: the trunk thumps and the collars flash down the tube
//   5.0 to 7.4 s   the body slides down the tube, the collars lighting as it passes; it shows in the glass on the
//                  last drop, straight down into the vat
//   7.4 s          the body drops into the fluid and floats there
//   9.4 to 11.0 s  the drain takes the fluid; the body stands up out of it, shivering
//  11.0 to 11.8 s  the glass revolves open
//  11.1 to 15.9 s  the gantry swings out on its boom to the vat and dresses the body: four arms at it with cloth fired out of
//                  the nozzle and caught, wrapping it round, two fetching and handing over, one holding a garment up like a waiter,
//                  one waving the body off toward the street at the end
//  13.2 s          dressed
//  16.6 s          done: the body steps out to where the server stood it
//  18.6 to 19.6 s  the glass closes behind it
//
// With nobody arriving the gantry idles at its parking mark: its arms breathe, its turret drifts, and every so often
// the nozzle fires a test garment that one arm catches, shakes out and feeds back up. Nothing here is a mechanism the server reads;
// the picture decides nothing.
import { facing } from '../../../shared/room-layout.js';

// gush: the fluid surges down the tube in three slugs; fill: the vat fills, sloshing; trigger: full, the trunk thumps;
// body to tube: the body comes down the tube, two seconds after the trigger. Everything after is the old cycle, 5 s on.
export const VAT_CYCLE = { gush: [0, 2600], fill: [700, 3400], full: 0.9, trigger: 3500, body: 5000, tube: 7400, float: 9400, drained: 11000, open: [11000, 11800], dressStart: 11100, dressed: 13200, done: 16600, close: [18600, 19600], keep: 20600 };
// the dressing's keyframes below were written for a cycle 7.6 s shorter; they're played this much later
const SHIFT = 7600;
// the three slugs of fluid down the tube: when each sets off, as a share of the gush
const SLUGS = [0, 0.3, 0.55];

// the goo's sounds (SIREN): a gloop as each slug is shoved into the tube, and a heavy wet splash with bubbles
// coming up after it when the body lands in the vat. A bubble is a sine bent upward, which is what makes it gloopy.
const bubble = (f, delay, gain) => ({ waveform: 'sine', freq: f, pitchBend: { to: f * 2.2, time: 0.07 }, delay, adsr: { a: 0.004, d: 0.08, s: 0, r: 0.04 }, gain });
function gooSfx(id, duration, layers, vol) {
  try { window.AudioEngine?.playSfx({ id, name: id, category: 'sfx', priority: 3, config: { duration, layers } }, vol); } catch { /* the picture still plays */ }
}
function gloop(i) {
  const f = 1 + i * 0.12;
  gooSfx('sfx_vat_gloop', 0.6, [
    { waveform: 'sine', freq: 55 * f, pitchBend: { to: 95 * f, time: 0.18 }, adsr: { a: 0.01, d: 0.22, s: 0, r: 0.1 }, gain: 0.5 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 420, q: 4 }, adsr: { a: 0.02, d: 0.25, s: 0, r: 0.12 }, gain: 0.25 },
    bubble(180 * f, 0.12, 0.18), bubble(240 * f, 0.24, 0.12), bubble(150 * f, 0.33, 0.1),
  ], 0.55);
}
function splash() {
  gooSfx('sfx_vat_splash', 1.4, [
    { waveform: 'sine', freq: 62, pitchBend: { to: 34, time: 0.25 }, adsr: { a: 0.002, d: 0.3, s: 0, r: 0.12 }, gain: 0.6 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 1100, q: 2.5 }, adsr: { a: 0.004, d: 0.45, s: 0, r: 0.25 }, gain: 0.35 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 380, q: 5 }, delay: 0.08, adsr: { a: 0.03, d: 0.5, s: 0, r: 0.2 }, gain: 0.25 },
    bubble(130, 0.35, 0.2), bubble(210, 0.5, 0.15), bubble(170, 0.62, 0.14), bubble(260, 0.8, 0.1), bubble(190, 1.0, 0.08),
  ], 0.7);
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// a mechanical ease: quick off the mark, a small overshoot, settled
const snap = (t) => { t = Math.max(0, Math.min(1, t)); const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const UP = [0, 1, 0];
// the vat clothing's colours, linear
const CLOTH = [[0.58, 0.61, 0.64], [0.33, 0.39, 0.44], [0.69, 0.64, 0.55], [0.19, 0.25, 0.31], [0.46, 0.51, 0.55]];

// two bones from the shoulder to a target, bent toward `pole`; past its reach the forearm telescopes out
const L1 = 0.9, L2 = 0.81;
function ik(S, T, pole) {
  const d = sub(T, S), dist = Math.max(0.2, len(d)), dir = nrm(d);
  const l2 = dist > L1 + L2 * 0.98 ? Math.min(L2 * 2.8, dist - L1 * 0.9) : L2;
  const a = (L1 * L1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  let p = sub(pole, S); p = sub(p, [dir[0] * dot(p, dir), dir[1] * dot(p, dir), dir[2] * dot(p, dir)]);
  const perp = len(p) > 1e-4 ? nrm(p) : nrm(cross(dir, Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : UP));
  return { e: add(add(S, dir, a), perp, h), w: add(S, dir, Math.min(dist, L1 + l2)) };
}

// how far along a path (0 to 1) its last run starts: the straight drop into the vat
function lastRunFrom(path) {
  let total = 0, last = 0;
  for (let i = 1; i < path.length; i++) { last = len(sub(path[i], path[i - 1])); total += last; }
  return total ? (total - last) / total : 0;
}
function along(path, s) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += len(sub(path[i], path[i - 1]));
  let left = Math.max(0, Math.min(1, s)) * total;
  for (let i = 1; i < path.length; i++) {
    const l = len(sub(path[i], path[i - 1]));
    if (left <= l || i === path.length - 1) return lerp(path[i - 1], path[i], l ? Math.min(1, left / l) : 0);
    left -= l;
  }
  return path[path.length - 1];
}

export function createVatCycle() {
  const arrivals = [];
  /** A `room_vat` cue: `who` comes down to release vat `piece`, started `msg.t0` (the server's clock). */
  function arrive(msg, you) {
    const late = Math.max(0, Math.min(VAT_CYCLE.done, Date.now() - (msg.t0 || Date.now())));
    for (let i = arrivals.length - 1; i >= 0; i--) if (arrivals[i].who === msg.who) arrivals.splice(i, 1);
    arrivals.push({ who: msg.who, piece: msg.piece, t0: performance.now() - late, self: msg.who === you, stood: false });
  }
  const live = (now) => { for (let i = arrivals.length - 1; i >= 0; i--) if (now - arrivals[i].t0 > VAT_CYCLE.keep) arrivals.splice(i, 1); return arrivals; };

  // a release vat as the cycle needs it: its piece, its vat record (base, front, tube), where a body stands in it
  function bayOf(S, piece) {
    const p = S.L?.placed.find((q) => String(q.id) === String(piece)), v = S.mesh?.vats?.find((x) => String(x.id) === String(piece));
    if (!p || !v) return null;
    const [fu, fv] = facing(p.turn);
    return { p, v, fu, fv, base: v.c, front: nrm(v.front || [0, 0, 1]), path: v.path || null, drop: v.dropFrom ?? (v.path ? lastRunFrom(v.path) : 1) };
  }
  // the fluid in a release vat at `at` ms into an arrival: nearly to the top before the body; the body plunging in
  // shoves it up (a surge, then the level held a little higher by what it displaces), then the drain takes it all
  // the fill comes in surges, so the level climbs in steps and rocks as each slug lands
  const sloshAt = (at) => (at < VAT_CYCLE.fill[0] ? 0 : 0.035 * Math.sin((at - VAT_CYCLE.fill[0]) * 0.011) * Math.exp(-Math.max(0, at - VAT_CYCLE.fill[1]) / 900));
  const displaced = (at) => { const d = at - VAT_CYCLE.tube; return d <= 0 ? 0 : 0.045 * smooth(0, 500, d) + 0.04 * Math.exp(-d / 350) * Math.cos(d * 0.012); };
  // the splash as the body goes in: hard at once, gone in a second and a half
  const splashAt = (at) => { const d = at - VAT_CYCLE.tube; return d < -60 || d > 1500 ? 0 : Math.exp(-Math.max(0, d) / 450); };
  const levelAt = (at) => (at < VAT_CYCLE.fill[0] ? 0 : at < VAT_CYCLE.float ? VAT_CYCLE.full * smooth(...VAT_CYCLE.fill, at) * (1 + 0.06 * Math.sin(smooth(...VAT_CYCLE.fill, at) * 18.8)) + sloshAt(at) + (at > VAT_CYCLE.tube ? displaced(at) : 0) : (VAT_CYCLE.full + displaced(at)) * (1 - smooth(VAT_CYCLE.float, VAT_CYCLE.drained, at)));
  // how hard the fluid is churning: each slug landing, the trigger's thump, the body dropping in
  const churnAt = (at) => {
    let c = 0;
    const [g0, g1] = VAT_CYCLE.gush;
    for (const k of SLUGS) { const land = g0 + (g1 - g0) * k + 1100; c = Math.max(c, Math.exp(-(((at - land) / 450) ** 2))); }
    c = Math.max(c, 0.5 * Math.exp(-(((at - VAT_CYCLE.trigger) / 250) ** 2)), Math.exp(-(((at - VAT_CYCLE.tube - 150) / 400) ** 2)));
    return at > VAT_CYCLE.fill[1] && at < VAT_CYCLE.trigger - 300 ? Math.max(c, 0.25) : c;
  };

  /** This frame's scene for the renderer (setVatScene), the levels to set, and the arrivals by who. */
  function frame(now, S) {
    const scene = { arms: {}, rigs: {}, pulses: [], release: {}, churn: {}, pour: {} }, levels = [];
    const list = live(now), t = now / 1000;
    for (const a of list) {
      const b = bayOf(S, a.piece), at = now - a.t0;
      if (!b) continue;
      // the fluid's gush down the tube first, reaching the vat as it starts to fill; then the body
      const [g0, g1] = VAT_CYCLE.gush;
      // each sound once, on its moment; a late arrival skips the ones already gone by
      const heard = (a.heard ||= new Set());
      SLUGS.forEach((k, i) => { const s0 = g0 + (g1 - g0) * k; if (at >= s0 && !heard.has(i)) { heard.add(i); if (at - s0 < 400) gloop(i); } });
      if (at >= VAT_CYCLE.tube && !heard.has('splash')) { heard.add('splash'); if (at - VAT_CYCLE.tube < 400) splash(); }
      for (const k of SLUGS) {
        const s0 = g0 + (g1 - g0) * k, s = (at - s0) / 1300;
        if (s > 0 && s < 1.05) scene.pulses.push({ id: b.v.id, s: Math.min(1, s * s * (1.6 - 0.6 * s)), fluid: true, amp: 0.42 - 0.08 * SLUGS.indexOf(k), wob: at });
      }
      // full: the trunk thumps and the tube's collars flash once from the top down, then the body two seconds after
      if (at > VAT_CYCLE.trigger && at < VAT_CYCLE.trigger + 900) scene.pulses.push({ id: b.v.id, s: (at - VAT_CYCLE.trigger) / 900, flash: true });
      if (at >= VAT_CYCLE.body && at < VAT_CYCLE.tube) { const s = (at - VAT_CYCLE.body) / (VAT_CYCLE.tube - VAT_CYCLE.body); scene.pulses.push({ id: b.v.id, s: s * s * (3 - 2 * s) * 0.4 + s * 0.6, seen: s >= b.drop }); }
      // the pour through the crown's hole: each slug falling as it reaches the end of the tube
      let pour = 0;
      for (const k of SLUGS) { const land = g0 + (g1 - g0) * k + 1150; pour = Math.max(pour, smooth(land - 150, land + 50, at) * (1 - smooth(land + 500, land + 900, at))); }
      if (pour > 0.02) scene.pour[b.v.id] = pour;
      const ch = churnAt(at);
      if (ch > 0.02) scene.churn[b.v.id] = ch;
      const sp = splashAt(at);
      if (sp > 0.02) (scene.splash ||= {})[b.v.id] = { k: sp, t: (at - VAT_CYCLE.tube) / 1000 };
      levels.push({ id: b.v.id, k: levelAt(at) });
      scene.release[b.v.id] = { open: at < VAT_CYCLE.close[0] ? smooth(...VAT_CYCLE.open, at) : 1 - smooth(...VAT_CYCLE.close, at) };
    }
    const hub = S.mesh?.vats?.find((v) => v.trunk)?.trunk?.hub || null;
    for (const g of S.mesh?.gantries || []) {
      const job = list.find((a) => now - a.t0 >= VAT_CYCLE.dressStart - 900 && now - a.t0 < VAT_CYCLE.done + 900 && bayOf(S, a.piece));
      const r = armsOf(g, job ? { a: job, b: bayOf(S, job.piece), at: now - job.t0 } : null, t, hub);
      scene.arms[g.id] = r.arms;
      if (r.rig) { r.rig.cam = eyeOf(g, r, S, now); scene.rigs[g.id] = r.rig; }
    }
    return { scene, levels };
  }

  // ── the gantry ─────────────────────────────────────────────────────────────────────────────────────
  // It hangs from the hub under the trunk on a telescopic boom with a swivel at each end, so its turret can be
  // carried anywhere round the hall: parked over its mark when idle, swung out in front of a release vat to dress.
  function armsOf(g, job, t, hub) {
    const park = g.c, top0 = g.c[1] + g.top;
    let c = park, toBay = null, out = 0;
    if (job) {
      const B = job.b.base, d = sub(park, B);
      // where it dresses from: in front of the vat, toward its open side, swung a little toward its parking mark
      const fr = job.b.front, side = nrm([d[0], 0, d[2]]), dir = nrm(add(fr, side, 0.35)), stand = add(B, dir, 1.35);
      out = smooth(VAT_CYCLE.dressStart - 900, VAT_CYCLE.dressStart, job.at) * (1 - smooth(VAT_CYCLE.done, VAT_CYCLE.done + 900, job.at));
      c = lerp(park, [stand[0], park[1], stand[2]], out);
      const dd = sub(B, c); toBay = nrm([dd[0], 0, dd[2]]);
    }
    // parked it hangs high, its hands over head height so you walk under it; it comes down to dress
    // never so high the turret meets the hub (gl/room-vat.js armChain holds the boom's joints under it the same way)
    let top = top0 + 0.75 * (1 - out) + 0.05 * Math.sin(t * 0.7) - 0.25 * out;
    if (hub) top = Math.min(top, hub[1] - 1.4);
    // the clothing comes down the feed through the middle of the gantry and is fired out of the nozzle under its
    // turret (gl/room-vat.js draws both); an arm catches it a little out and down from the mouth
    const nozzle = [c[0], top - 0.27, c[2]], catchOf = (R) => add(add(nozzle, R.r, 0.45), [0, -0.32, 0]);
    let fire = 0;
    // the turret: drifting when idle, swung round to face the bay when there's a body to dress
    let yaw = 0.25 * Math.sin(t * 0.11);
    if (job) { const want = Math.atan2(toBay[2], toBay[0]) - 0.2; yaw = yaw * (1 - out) + want * out; }
    const rest = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2 + yaw, r = [Math.cos(a), 0, Math.sin(a)], lift = i % 2 ? 0.1 : 0;
      const S = [c[0] + r[0] * 0.3, top - 0.12 - lift, c[2] + r[2] * 0.3];
      const sway = 0.03 * Math.sin(t * 0.8 + i * 1.7);
      const E = [c[0] + r[0] * 0.95, top - 0.75 - lift + sway, c[2] + r[2] * 0.95], W = [c[0] + r[0] * (0.55 + 0.03 * Math.sin(t * 0.6 + i)), top - 1.45 - lift + sway * 0.6, c[2] + r[2] * (0.55 + 0.03 * Math.sin(t * 0.6 + i))];
      rest.push({ S, E, W, r });
    }
    // idle: now and then the nozzle fires a test garment, one arm catches it, shakes it out and feeds it back up
    const tidy = Math.floor(t / 17) % 8, tp = (t % 17) / 3.4;
    const arms = [];
    for (let i = 0; i < 8; i++) {
      const R = rest[i];
      let target = R.W, grip = 0.35, pole = add(add(R.S, R.r, 1.2), UP, 0.6), roll = 0, cloth = null;
      if (!job && i === tidy && tp < 1) {
        const k = Math.sin(tp * Math.PI), shake = tp > 0.3 && tp < 0.75 ? Math.sin((tp - 0.3) / 0.45 * Math.PI) : 0, back = smooth(0.75, 0.88, tp);
        const hold = add(catchOf(R), [0.08 * Math.sin(t * 6) * shake, -0.1 * shake, 0]);
        target = lerp(lerp(R.W, hold, snap(Math.min(1, tp / 0.22))), add(nozzle, R.r, 0.12), back);
        if (tp > 0.88) target = lerp(R.W, target, 1 - smooth(0.88, 1, tp));
        grip = 0.35 + 0.5 * k;
        const col = CLOTH[(Math.floor(t / 17) + 2) % 5], sd = nrm(cross(UP, R.r));
        if (tp > 0.15 && tp < 0.24) { const u = smooth(0.15, 0.24, tp), p = add(lerp(nozzle, hold, u), UP, 0.12 * Math.sin(u * Math.PI)); cloth = { a: p, b: add(p, sd, 0.1 + 0.2 * u), len: 0.06 + 0.25 * u, col, sway: [0, 0.08 * (1 - u), 0] }; fire = Math.max(fire, 1 - u); }
        else if (tp >= 0.24 && tp < 0.86) cloth = { a: target, b: add(target, sd, 0.34), len: Math.max(0.04, (0.3 + 0.5 * shake) * (1 - back)), col, sway: [0.13 * Math.sin(t * 7) + 0.05 * Math.sin(t * 13.1), 0.04 * Math.sin(t * 9.3), 0.13 * Math.cos(t * 5) + 0.05 * Math.cos(t * 11.7)] };
      }
      if (job) { let shot; ({ target, grip, roll, cloth, shot } = dressTarget(i, R, job, nozzle, catchOf(R), c, top, toBay, t)); fire = Math.max(fire, shot || 0); }
      if (target === R.W && grip === 0.35 && !job) { arms.push({ s: R.S, e: R.E, w: R.W, grip, roll }); continue; }
      const k = ik(R.S, target, pole);
      arms.push({ s: R.S, e: k.e, w: k.w, grip, roll, ...(cloth ? { cloth } : {}) });
    }
    // what the camera on the turret's ring should be watching: the body while it dresses one (the chest, its gaze
    // running up and down it as the arms work), the arm with the test garment while it shakes it out
    let focus = null;
    if (job) {
      const B = job.b.base, at = job.at - VAT_CYCLE.dressStart;
      focus = [B[0], B[1] + 1.15 + 0.45 * Math.sin(at * 0.0021) * smooth(400, 1200, at), B[2]];
    } else if (tp < 0.86) focus = arms[tidy]?.w || null;
    return { arms, focus, rig: hub ? { hub, body: [c[0], top + 0.35, c[2]], fire } : null };
  }

  // ── the camera on the turret's amber ring ─────────────────────────────────────────────────────────────
  // A pod that runs round the ring to whichever side faces what it's watching, its lens turned on it. Dressing,
  // it watches the body; otherwise it keeps an eye on the way out, and now and then something else takes it: you
  // (a double take first, now and then), a vat, a slow look round the hall, its own hands. A fresh target is a
  // quick saccade; the pod's run round the ring is a spring with a little overshoot. Picture only, per gantry.
  const eyes = new Map();
  function doorOf(S) {
    const L = S.L;
    if (!L?.spec) return null;
    if (L.doorPt !== undefined) return L.doorPt;
    const ops = (L.spec.openings || []).filter((o) => (o.kind === 'door' || o.kind === 'front') && o.wall && o.wall !== 'floor' && o.wall !== 'ceiling');
    const o = ops.find((x) => x.kind === 'front') || ops[0];
    if (!o) return (L.doorPt = null);
    const hu = L.spec.w / 2, m = ((o.a ?? 0) + (o.b ?? 0)) / 2;
    const [u, v] = o.wall === 'front' ? [m, 0] : o.wall === 'back' ? [m, L.spec.d] : o.wall === 'left' ? [-hu, m] : [hu, m];
    return (L.doorPt = L.world(u, v, 1.3));
  }
  function eyeOf(g, r, S, now) {
    const c = r.rig.body, ringC = [c[0], c[1] - 0.25, c[2]];
    let e = eyes.get(g.id);
    if (!e) { e = { look: add(ringC, [1, -0.5, 0]), want: null, ang: 0, angV: 0, mode: 'door', until: 0, last: now, iris: 0, t0: now, held: null }; eyes.set(g.id, e); }
    const dt = Math.min(0.1, Math.max(0, (now - e.last) / 1000)); e.last = now;
    const door = doorOf(S) || add(ringC, [0, -1.2, 3]);
    const you = S.walk?.at && S.L?.world ? S.L.world(S.walk.at[0], S.walk.at[1], 1.6) : null;
    const youD = you ? len(sub(you, ringC)) : 1e9;
    const vats = S.mesh?.vats || [];
    let want, lock = 0;
    if (r.focus) { want = r.focus; lock = 1; e.mode = 'busy'; e.until = now + 1500; }
    else {
      // walked up close while it wasn't looking: it notices
      if (you && youD < 3 && e.mode !== 'you' && e.mode !== 'take' && Math.random() < dt * 0.8) { e.mode = 'take'; e.t0 = now; e.until = now + 5200; }
      if (now >= e.until) {
        const pick = Math.random(), near = you && youD < 10;
        e.mode = pick < 0.42 ? 'door' : pick < 0.62 && near ? (Math.random() < 0.35 ? 'take' : 'you') : pick < 0.76 && vats.length ? 'vat' : pick < 0.88 ? 'sweep' : 'hands';
        e.t0 = now; e.until = now + (e.mode === 'door' ? 4000 + Math.random() * 6000 : 2500 + Math.random() * 3500);
        e.held = e.mode === 'vat' ? vats[Math.floor(Math.random() * vats.length)] : null;
        e.sweep = Math.random() < 0.5 ? 1 : -1;
      }
      const at = (now - e.t0) / 1000;
      // a small wander so it's never quite still
      const jig = [0.12 * Math.sin(now * 0.0013 + 1), 0.06 * Math.sin(now * 0.0017), 0.12 * Math.cos(now * 0.0011)];
      if (e.mode === 'door') want = add(door, jig);
      else if (e.mode === 'you' && you) { want = you; lock = 0.6; }
      else if (e.mode === 'take' && you) {
        // past you, back to the door, then straight back at you and stay there
        want = at < 0.35 ? you : at < 0.9 ? door : you;
        lock = at < 0.9 ? 0 : 1;
      } else if (e.mode === 'vat' && e.held?.c) want = add(add(e.held.c, [0, 1.2, 0]), jig);
      else if (e.mode === 'sweep') {
        const d = sub(door, ringC), a0 = Math.atan2(d[2], d[0]) + e.sweep * (-1.3 + 2.6 * smooth(0, (e.until - e.t0) / 1000, at)), rr = Math.max(3, Math.hypot(d[0], d[2]));
        want = [ringC[0] + Math.cos(a0) * rr, 1.4, ringC[2] + Math.sin(a0) * rr];
      } else if (e.mode === 'hands') {
        const a = at * 0.9;
        want = [ringC[0] + Math.cos(a) * 0.6, ringC[1] - 1.1, ringC[2] + Math.sin(a) * 0.6];
      } else want = add(door, jig);
    }
    // a new target is a saccade: fast, then settled
    e.look = lerp(e.look, want, 1 - Math.exp(-dt * 11));
    const d = sub(e.look, ringC), wantAng = Math.atan2(d[2], d[0]);
    let diff = wantAng - e.ang; diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
    e.angV += (diff * 30 - e.angV * 7.5) * dt; e.ang += e.angV * dt;
    // the iris: wide and red on what it's locked on, a little pulse of focus at each fresh target
    const settle = Math.exp(-((now - e.t0) / 650));
    e.iris += ((lock ? 1 : 0.15) - e.iris) * (1 - Math.exp(-dt * 6));
    return { ang: e.ang, look: e.look, iris: e.iris, hunt: settle };
  }

  // Each arm's part in a dressing: keyframes of [ms, where, grip], eased between, the four nearest the bay dressing,
  // the far four fetching, presenting and seeing the body off. Each carries cloth for part of it: fired at it out of the
  // nozzle and caught, held up or handed on, and at the body wrapped round it, until the gantry's done and the body's dressed.
  function dressTarget(i, R, job, nozzle, binUp, c, top, toBay, t) {
    const B = job.b.base, side = nrm(cross(UP, toBay)), face = [-toBay[0], 0, -toBay[2]];
    // the body's own points, a hand in front of it toward the gantry
    const on = (y, s = 0, f = 0.14) => [B[0] + side[0] * s - face[0] * f, B[1] + y, B[2] + side[2] * s - face[2] * f];
    const pt = { head: on(1.62), over: on(1.95), chest: on(1.3), shL: on(1.42, -0.2), shR: on(1.42, 0.2), hipL: on(0.95, -0.12), hipR: on(0.95, 0.12),
      ftL: on(0.08, -0.1, 0.2), ftR: on(0.08, 0.1, 0.2), tap: on(1.76), hover: on(1.9) };
    const hand = lerp(c, B, 0.5); hand[1] = 1.55;
    const high = add([c[0], top + 0.55, c[2]], toBay, 0.9), exitWave = add(add(B, toBay, -0.4), UP, 2.1);
    // which arms face the bay
    const rank = [0, 1, 2, 3, 4, 5, 6, 7].sort((a, b) => dot(rankDir(b), toBay) - dot(rankDir(a), toBay));
    function rankDir(j) { const a = (j / 8) * Math.PI * 2 + 0.2; return [Math.cos(a), 0, Math.sin(a)]; }
    const role = rank.indexOf(i);
    const W = R.W;
    const plans = [
      [[3500, W, 0.35], [3900, binUp, 0.9], [4400, pt.over, 0.85], [5000, pt.chest, 0.3], [6400, pt.chest, 0.3], [7000, W, 0.35]],
      [[3600, W, 0.35], [4000, binUp, 0.9], [4500, pt.ftL, 0.85], [5300, pt.hipL, 0.3], [6200, pt.hipR, 0.3], [7000, W, 0.35]],
      [[3700, W, 0.35], [4100, binUp, 0.9], [4700, pt.ftL, 0.85], [5300, pt.ftR, 0.85], [5900, pt.ftL, 0.3], [7100, W, 0.35]],
      [[3800, W, 0.35], [4300, binUp, 0.9], [5000, pt.shR, 0.3], [5800, pt.shL, 0.3], [7200, pt.hover, 0.5], [7400, pt.tap, 0.6], [7550, pt.hover, 0.5], [7700, pt.tap, 0.6], [8300, W, 0.35]],
      [[3500, W, 0.35], [3950, binUp, 0.9], [4500, hand, 0.9], [4950, binUp, 0.9], [5500, hand, 0.9], [6300, W, 0.35]],
      [[3750, W, 0.35], [4200, binUp, 0.9], [4750, hand, 0.9], [5200, binUp, 0.9], [5750, hand, 0.9], [6550, W, 0.35]],
      [[3600, W, 0.35], [4300, high, 0.7], [5500, high, 0.7], [6500, W, 0.35]],
      [[6800, W, 0.35], [7400, exitWave, 0.1], [8400, exitWave, 0.1], [9000, W, 0.35]],
    ];
    // when each role has cloth in its grip ([from, wrapping from, to]) on the old clock; the body's dressed at 5600
    const carry = [[3900, 5000, 5650], [4000, 5300, 5650], [4100, 5300, 5650], [4300, 5000, 5650], [3950, 1e9, 5550], [4200, 1e9, 5650], [4300, 1e9, 5600], null][role];
    const keys = plans[role];
    const at = job.at - SHIFT;
    let target = W, grip = 0.35;
    if (at <= keys[0][0]) { target = keys[0][1]; grip = keys[0][2]; }
    else if (at >= keys[keys.length - 1][0]) { target = keys[keys.length - 1][1]; grip = keys[keys.length - 1][2]; }
    else for (let k = 0; k + 1 < keys.length; k++) {
      const [ta, pa, ga] = keys[k], [tb, pb, gb] = keys[k + 1];
      if (at < ta || at > tb) continue;
      const u = snap((at - ta) / (tb - ta));
      target = lerp(pa, pb, u); grip = ga + (gb - ga) * Math.min(1, (at - ta) / (tb - ta) * 2);
      break;
    }
    // working at the body: small quick tugs; the waiter's arm turns what it holds; the wave waves
    let roll = 0;
    if (role <= 3 && at > 4400 && at < 6600) target = add(target, [Math.sin(at * 0.031 + i) * 0.035, Math.sin(at * 0.047 + i * 2) * 0.03, Math.cos(at * 0.029 + i) * 0.035]);
    if (role === 6) roll = at * 0.006;
    if (role === 7 && at > 7400 && at < 8400) target = add(target, side, 0.25 * Math.sin((at - 7400) * 0.0126));
    // the cloth: fired out of the nozzle to where the grip will close on it, hanging from the grip, shaken out as it
    // comes, and at the body pulled round the front of it to its far side
    let cloth = null, shot = 0;
    if (carry && at > carry[0] - 320 && at <= carry[0]) {
      const u = smooth(carry[0] - 320, carry[0], at), dest = role === 6 ? high : binUp, p = add(lerp(nozzle, dest, u), UP, 0.15 * Math.sin(u * Math.PI));
      cloth = { a: p, b: add(p, side, 0.1 + 0.22 * u), len: 0.06 + 0.3 * u, col: CLOTH[(role + 1) % 5], sway: [0, 0.1 * (1 - u), 0] };
      shot = 1 - u;
    }
    if (carry && at > carry[0] && at < carry[2]) {
      const col = CLOTH[(role + 1) % 5], swing = [0.06 * Math.sin(at * 0.011 + i), 0, 0.06 * Math.cos(at * 0.009 + i)];
      if (at < carry[1]) {
        const grow = smooth(carry[0], carry[0] + 350, at);
        cloth = role === 6 ? { a: add(target, side, -0.25), b: add(target, side, 0.25), len: 0.35 * grow, col, sway: swing }
          : { a: target, b: add(add(target, side, 0.36), UP, -0.04), len: 0.15 + 0.5 * grow, col, sway: swing };
      } else {
        const far = [B[0] + side[0] * (target[0] - B[0] > 0 ? -0.3 : 0.3) + face[0] * 0.05, target[1] + 0.02, B[2] + side[2] * (target[2] - B[2] > 0 ? -0.3 : 0.3) + face[2] * 0.05];
        const tight = 1 - smooth(carry[2] - 300, carry[2], at);
        cloth = { a: target, b: far, bulge: [-face[0] * 0.32, 0, -face[2] * 0.32], len: 0.55 * tight, col, sway: [0, 0, 0] };
      }
    }
    return { target, grip, roll, cloth, shot };
  }

  /** The bodies as they're drawn: an arriving body in its tube and its release vat, bare until dressed, until it steps out. */
  function bodies(list, S, now) {
    if (!arrivals.length) return list;
    const out = [];
    for (const body of list) {
      const a = arrivals.find((x) => x.who === body.id), b = a && bayOf(S, a.piece), at = a ? now - a.t0 : 0;
      if (!a || !b || at >= VAT_CYCLE.done) { out.push(body); continue; }
      const bare = at < VAT_CYCLE.dressed ? { sculpt: true, figure: { ...(body.figure || {}), wear: { top: false, legs: false, shoes: false }, gear: false } } : {};
      const yaw = Math.atan2(-b.front[0], -b.front[2]) + Math.PI;
      if (at < VAT_CYCLE.tube) {
        // in the tube: seen only on the last drop, feet first, straight down the glass into the vat
        const s = Math.max(0, (at - VAT_CYCLE.body) / (VAT_CYCLE.tube - VAT_CYCLE.body));
        if (!b.path || s < b.drop || !S.L?.local) continue;
        const loc = S.L.local(along(b.path, s));
        out.push({ ...body, at: [loc[0], loc[1]], seat: null, on: null, pose: 'stand', lift: loc[2] - 0.95, tagLift: loc[2] - 0.95, yaw: yaw + at * 0.002, clip: 'vatFloat', phase: undefined, ...bare });
        continue;
      }
      const fluid = at < VAT_CYCLE.drained - 600;
      // just in, it plunges deep under the surface and bobs back up
      const sink = at < VAT_CYCLE.tube + 1300 ? 0.5 * Math.sin((at - VAT_CYCLE.tube) / 1300 * Math.PI) * Math.exp(-(at - VAT_CYCLE.tube) / 900) : 0;
      out.push({ ...body, at: [b.p.u, b.p.v], seat: null, on: null, pose: 'stand', lift: 0.36 - sink + (fluid ? 0.05 * Math.sin(at * 0.004) : 0),
        yaw, clip: fluid ? 'vatFloat' : at < VAT_CYCLE.dressed ? 'shiver' : 'idle', phase: undefined, ...bare });
    }
    return out;
  }

  /** Your own arrival, from inside the vat: the camera at your eyes in it, looking out at the gantry. */
  function cam(now, S, seat) {
    const a = arrivals.find((x) => x.self && now - x.t0 < VAT_CYCLE.done);
    if (!a) return null;
    const b = bayOf(S, a.piece);
    if (!b) return null;
    const at = now - a.t0, B = b.base, f = b.front;
    // down the tube it's dark and close; then the fluid, you floating, the drain, you on your feet, the arms
    const eyeY = at < VAT_CYCLE.tube ? 1.7 + 1.2 * (1 - Math.max(0, at - VAT_CYCLE.body) / (VAT_CYCLE.tube - VAT_CYCLE.body)) : at < VAT_CYCLE.float ? 1.1 : at < VAT_CYCLE.drained ? 1.1 + 0.5 * smooth(VAT_CYCLE.float, VAT_CYCLE.drained, at) : 1.6;
    const wob = at < VAT_CYCLE.drained ? 0.06 * Math.sin(at * 0.01) : 0;
    const eye = [B[0] + f[0] * 0.05, B[1] + eyeY + wob * 0.3, B[2] + f[2] * 0.05];
    const yaw = Math.atan2(f[0], f[2]) + wob, pitch = at < VAT_CYCLE.drained ? -0.35 + 0.35 * smooth(VAT_CYCLE.tube, VAT_CYCLE.drained, at) : 0.05;
    return { ...seat, eye, yaw, pitch };
  }

  /** Your arrival done: where to stand when the camera's handed back, just out of the vat's front. Once. */
  function stepOut(S, now) {
    const a = arrivals.find((x) => x.self && !x.stood && now - x.t0 >= VAT_CYCLE.done);
    if (!a) return null;
    a.stood = true;
    const b = bayOf(S, a.piece);
    return b ? { at: [b.p.u + b.fu * 1.0, b.p.v + b.fv * 1.0], yaw: Math.atan2(b.front[0], b.front[2]) } : null;
  }

  return { arrive, frame, bodies, cam, stepOut, get busy() { return arrivals.length > 0; } };
}
