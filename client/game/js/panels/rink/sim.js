// Rinkside · the world. Bodies, the puck, the loose things and the building, stepped at
// 120 Hz. Nothing in here decides anything the broadcast reports: the sim on the server
// already decided every shot, goal, hit and fight, and the director (director.js) stages
// those. What this file does on its own is the hockey BETWEEN them.
//
// THE ICE IS NEVER STILL. A beat lands every ten to forty seconds, so between beats the
// world plays cosmetic hockey: the side with the puck carries it up, moves it around and
// cycles it down low; the other side forechecks, marks men and takes it back; pucks get
// dumped in and chased, rimmed round the boards and fought for along the wall. It NEVER
// shoots on goal and nobody scores from it, because shots are facts and only the sim has
// them. The director takes actors and the puck away from this when a beat needs them and
// hands them back when it's done.

import { TAU, V, clamp, lerp, angWrap, rng, hash, hyp, hyp3 } from './util.js';
import {
  RL, RW, RC, MID_Y, BOARD_H, GLASS_H, GOAL_X, BLUE_X, NET_HALF, NET_DEPTH, NET_H,
  insideRink, attackDir, panelAt, PANELS, PANEL_X0, PANEL_W,
} from './geo.js';
import { DT, G, skaterRig, goalieRig, bladeWorld, bladeLocal, keepOut, makeRag, stepRag, makeLimb, stepLimb, SEVER, SHOTS, sweeps, cadence, releaseAt } from './rig.js';

// ── stickhandling ─────────────────────────────────────────────────────────────
// THE PUCK IS ITS OWN OBJECT. Welded to the blade it read as part of the man; a real
// carrier never holds it, he keeps TOUCHING it. Every so often his blade taps it toward
// where his hands want it next, and between touches it slides on its own with ice
// friction, so it runs ahead, drifts, and gets gathered back. The rig aims the blade at
// the puck (not the other way round), so the stick visibly chases and cups it.
//
// The touch rate is the style: quick little taps protecting it, rapid touches through a
// deke, long pushes and a chase flat out. Through a shot's wind-up there are no touches:
// the puck rides on at his speed and the blade comes through and strikes it.
// Returns true on a touch, so the caller can make the tick of it.
// `pocket(c)`, when given, is where the blade that's DRAWN has the puck (the rig's blade,
// which reaches for the puck): through a wind-up or a deke the puck rides that, so it's on
// the stick the viewer sees and not on a pattern a foot away from it.
export function dribble(c, pk, T, dt, rand = Math.random, pocket = null) {
  const sp = hyp(c.vx || 0, c.vy || 0);
  const shooting = !!SHOTS[c.act];
  c.touchT = (c.touchT ?? 0) - dt;
  // never through his own skates: in his frame, push it back outside them
  {
    const ch = Math.cos(c.h), sn = Math.sin(c.h), dx = pk.x - c.x, dy = pk.y - c.y;
    const lu = dx * ch + dy * sn, lv = -dx * sn + dy * ch, [ku, kv] = keepOut(lu, lv, 0.15);
    if (ku !== lu || kv !== lv) {
      // eased out, a few inches a step, rather than jumped clear
      const tx = c.x + ku * ch - kv * sn, ty = c.y + ku * sn + kv * ch, dd = hyp(tx - pk.x, ty - pk.y), m = Math.min(1, 30 * dt / (dd || 1));
      pk.x += (tx - pk.x) * m; pk.y += (ty - pk.y) * m; pk.vx = lerp(pk.vx, c.vx || 0, 0.5); pk.vy = lerp(pk.vy, c.vy || 0, 0.5);
    }
  }
  const bw = bladeWorld(c, T, true);
  const d = hyp(pk.x - bw[0], pk.y - bw[1]);
  // THE LEASH. A carrier does not lose the puck on his own: it is only ever taken off him
  // (a poke, a rub-out, a hit) or let go (a pass, a shot). So however a touch lands, the
  // puck is drawn back softly if it strays past a short gap from where his blade is.
  // (a slapshot's puck sits right where the blade comes down; a sweep carries it, below)
  const gap = shooting ? (sweeps(SHOTS[c.act]) ? 1.0 : 0.3) : sp > 18 ? 1.9 : 1.2;
  if (d > gap) {
    // (eased, and never faster than a hard pass: the puck slides back, it doesn't jump)
    const k = Math.min((1 - Math.exp(-dt * 14)) * (d - gap), 45 * dt) / d;
    pk.x += (bw[0] - pk.x) * k; pk.y += (bw[1] - pk.y) * k;
    pk.vx = lerp(pk.vx, c.vx || 0, k); pk.vy = lerp(pk.vy, c.vy || 0, k);
  }
  // cradled in the pocket and dragged with the blade
  const cradle = () => {
    // once it's in the pocket it rides exactly on the blade; from farther it's drawn in
    const on = (pocket && pocket(c)) || bw, dp = hyp(pk.x - on[0], pk.y - on[1]);
    const k = dp < 0.6 ? 1 : 1 - Math.exp(-dt * 40), nx = lerp(pk.x, on[0], k), ny = lerp(pk.y, on[1], k);
    pk.vx = (nx - pk.x) / dt + (c.vx || 0) * (1 - k); pk.vy = (ny - pk.y) / dt + (c.vy || 0) * (1 - k);
    pk.x = nx - pk.vx * dt; pk.y = ny - pk.vy * dt;          // the caller's integration step lands it on nx, ny
    c.touchT = 0.08;
    return false;
  };
  if (shooting) {
    // a wrist shot, a backhand or a pass carries it on the blade, back and through; a
    // slapshot leaves it on the ice, going on at his pace, where the blade will come down
    if (sweeps(SHOTS[c.act]) && d < 3) return cradle();
    pk.vx = lerp(pk.vx, c.vx || 0, 1 - Math.exp(-dt * 6)); pk.vy = lerp(pk.vy, c.vy || 0, 1 - Math.exp(-dt * 6));
    return false;
  }
  const deke = c.act === 'toedrag' || c.act === 'deke' || c.act === 'drag' || c.act === 'fake';
  if (deke && d < 3) {
    // through a deke it never leaves the blade
    return cradle();
  }
  const iv = deke ? 0.1 : c.protect ? 0.17 : sp > 21 ? 0.36 + rand() * 0.08 : 0.22 + rand() * 0.12;
  const reach = sp > 18 ? 3.2 : 2.4;
  if (c.touchT > 0 || d > reach) {
    // out of reach between touches: a carrier who has lost touch reaches for it
    if (d > reach && d < 6) { const k = 1 - Math.exp(-dt * 4); pk.vx += ((bw[0] - pk.x) * 2.5 + (c.vx || 0) - pk.vx) * k; pk.vy += ((bw[1] - pk.y) * 2.5 + (c.vy || 0) - pk.vy) * k; }
    return false;
  }
  // a touch: send it where the blade will be one interval from now. Predicted along the arc
  // he is skating, not a straight line, or a man carrying it round a curve at speed loses it.
  const tr = c.turnRate || 0, hF = c.h + tr * iv, hM = c.h + tr * iv * 0.5;
  const px = c.x + Math.cos(hM) * sp * iv, py = c.y + Math.sin(hM) * sp * iv;
  const [bu, bv] = bladeLocal(c, T + iv, true);
  const tx = px + bu * Math.cos(hF) - bv * Math.sin(hF), ty = py + bu * Math.sin(hF) + bv * Math.cos(hF);
  pk.vx = (tx - pk.x) / iv; pk.vy = (ty - pk.y) / iv;
  if (sp > 21 && rand() < 0.3) pk.vz = 1.2;                // a push at speed lifts it a little
  pk.spin = (pk.spin || 0) + (rand() - 0.5) * 30;
  c.touchT = iv;
  return true;
}

const SKINS = ['#e0b08c', '#c48d68', '#8f5e40', '#f0c9a8', '#a87454', '#6a4330', '#d9a27e'];
const HAIRS = ['#2a1c14', '#5a3a22', '#141210', '#8a6a3a', '#3b2a1e', '#c9b48a', '#6b2d16'];
const ROLE = ['LW', 'C', 'RW', 'LD', 'RD', 'F'];

export function makeBody(kind, side, slot, seed) {
  const r = rng(seed);
  return {
    kind, side, slot, seed: seed % 997, role: ROLE[slot] || 'F',
    // which way he shoots: a named man's is his own (the director sets it with the name)
    hand: seed % 5 < 2 ? 'R' : 'L',
    x: 100, y: MID_Y, vx: 0, vy: 0, h: 0, phase: r(), amp: 0, effort: 0.4, crouch: 0.12,
    tx: 100, ty: MID_Y, maxV: 20, acc: 26, face: null,
    act: null, actT: 0, actDur: 1, actData: null,
    stick: kind === 'skater', gloves: kind !== 'official' && kind !== 'medic', helmet: kind !== 'medic',
    jerseyUp: 0, react: 0, duck: 0, rag: null, blend: null, stance: 0, guard: false, grab: null, foe: null, target: null,
    bleeding: 0, blood: 0, missing: {}, active: true, scripted: false, carrying: false,
    name: '', num: 0, skin: SKINS[(r() * SKINS.length) | 0], hair: HAIRS[(r() * HAIRS.length) | 0],
    faceGear: r() < 0.35 ? 'visor' : 'cage', cutAt: 0, lastFoot: null, sprayAt: 0, dark: 0,
    // goalies only
    bfly: 0, gloveW: 0, gloveTarget: null, netSide: side,
  };
}

export function createWorld(ice, seedKey) {
  const rand = rng(hash(seedKey || 'rink'));
  // ⚠ COSMETICS DRAW FROM THEIR OWN DICE. Every rand() call moves the world's stream along, so
  // snow thrown off a skate from `rand` would reshuffle everything after it. The snow is in
  // W.spray, off `fxRand`, and nothing in the sim reads it.
  const fxRand = rng(hash('fx:' + (seedKey || 'rink')));
  const W = {
    t: 0, rand, ice,
    team: { a: [], h: [] }, goalie: { a: null, h: null }, officials: [], extras: [],
    puck: { x: 100, y: MID_Y, z: 0, vx: 0, vy: 0, vz: 0, carrier: null, target: null, held: null, passT0: 0, inNet: null, owner: null, home: null, tail: null, drawn: null, drawn0: null },
    parts: [], spray: [], debris: [], limbs: [], stretcher: null, zamboni: null,
    flex: new Float32Array(PANELS), cracks: [], glassBlood: [], broken: new Set(),
    crowd: 0.15, shake: 0, boardShake: 0, hitstop: 0, lamp: 0, lampSide: null, mourning: 0, dim: 0,
    banner: null, fight: null,
    cam: { mode: 'broadcast', focus: [100, MID_Y], zoom: 1, net: null },
    ev: [], script: null, puckScripted: false, allowGoal: false, frozen: false,
    amb: { poss: 'a', nextPass: 1.5, lastTurn: 0, holdUntil: 0, fore: { a: null, h: null } },
    emit: () => {},
    kits: { a: null, h: null },
    pulled: { a: false, h: false },
  };

  // ── cast ────────────────────────────────────────────────────────────────────
  for (const side of ['a', 'h']) {
    for (let i = 0; i < 6; i++) { const b = makeBody('skater', side, i, hash(`${side}${i}${seedKey}`)); b.active = i < 5; W.team[side].push(b); }
    const g = makeBody('goalie', side, 9, hash(`${side}g${seedKey}`));
    g.x = (side === 'a' ? GOAL_X[0] : GOAL_X[1]) + attackDir(side) * 3; g.y = MID_Y; g.h = side === 'a' ? 0 : Math.PI; g.stick = true;
    W.goalie[side] = g;
  }
  for (let i = 0; i < 2; i++) { const o = makeBody('official', 'o', i, hash(`off${i}${seedKey}`)); o.stick = false; o.maxV = 18; W.officials.push(o); }

  const skaters = () => [...W.team.a, ...W.team.h].filter((b) => b.active);
  const bodies = () => [...skaters(), W.goalie.a, W.goalie.h, ...W.officials, ...W.extras].filter((b) => b && b.active);
  W.skaters = skaters;
  W.bodies = bodies;
  W.mates = (side) => W.team[side].filter((b) => b.active);

  // ── scheduling ──────────────────────────────────────────────────────────────
  W.schedule = (dt, fn) => { W.ev.push({ t: W.t + dt, fn }); W.ev.sort((a, b) => a.t - b.t); };
  W.clearSchedule = () => { W.ev = []; };
  W.act = (b, name, dur, data) => { b.act = name; b.actT = 0; b.actDur = dur; b.actData = data ?? null; };
  W.sfx = (key, opts) => W.emit('sfx', { key, ...(opts || {}) });

  // ── the puck ───────────────────────────────────────────────────────────────
  // ⚠ THE PUCK NEVER JUMPS TO A STICK, AND IT NEVER STEERS ITSELF TO ONE. Possession is
  // only ever taken within reach of the blade. Asked to hand it to a man it's farther from
  // than that, `give` collects instead: he goes and gets it (`pursue`), and possession passes
  // when his stick gets to it. A caller that knows the puck is at the stick already (the
  // shot's release, a tip, a catch) passes `force`; the carry leash is speed-capped, so even
  // then the puck slides the last inch rather than jumping.
  const REACH = 3.0;
  W.give = (b, force) => {
    const pk = W.puck;
    if (b && !force && !pk.hidden) {
      // nobody fishes a puck out of the net through the mesh: it's collected, out the mouth
      if (pk.inNet) { W.collect(b); return false; }
      const bw = bladeWorld(b, W.t, true);
      if (hyp(bw[0] - pk.x, bw[1] - pk.y) > REACH || pk.z > 1.2) { W.collect(b); return false; }
    }
    if (pk.carrier) pk.carrier.carrying = false;
    // (a man who was on his way to get it, and someone else got there first, goes back to
    // whatever he was doing)
    if (pk.home && pk.home !== b) endFetch(pk.home);
    pk.carrier = b; pk.target = null; pk.held = null; pk.inNet = null; pk.home = null;
    if (b) {
      unface(b);
      b.touchT = 0.06; b.puckAt = [pk.x, pk.y]; b.puckV = [pk.vx - (b.vx || 0), pk.vy - (b.vy || 0)]; b.reachTo = null; endFetch(b);
      // the blade cushions it: whatever it came in at, it's going at his speed now
      if (!pk.hidden) { pk.vx = b.vx || 0; pk.vy = b.vy || 0; pk.vz = Math.min(pk.vz, 0); }
    }
    // Taken: his reception pose winds down now (its own ease-out, over about a tenth of a
    // second), so his blade goes with the puck rather than holding the pose a foot or two off it.
    if (b && b.act === 'receive' && b.actT < 0.82) { b.actT = 0.82; b.actDur = 0.12 / 0.18; }
    if (b) { b.carrying = true; pk.owner = b.side; if (b.kind === 'skater') W.amb.poss = b.side; }
    return true;
  };
  // A man goes and gets the puck. It goes on sliding however it was sliding: nothing pulls
  // it to him. He skates to where he'll meet it, whatever his script or his position asked
  // of him (see `pursue`), and has it when it's within reach of his stick. (The old second
  // argument, which let the puck slide to a man who stayed put, is gone: a puck that came
  // to a stick nobody had touched it with read as a magnet.)
  W.collect = (b) => {
    const pk = W.puck;
    if (!b) return;
    if (pk.carrier && pk.carrier !== b) { pk.carrier.carrying = false; pk.carrier.puckAt = null; pk.carrier = null; }
    if (pk.carrier === b) return;
    pk.target = null; pk.held = null;
    if (pk.home && pk.home !== b) endFetch(pk.home);
    pk.home = b; pk.homeT0 = W.t;
    if (b.scripted && !b.fetchPrev) b.fetchPrev = { tx: b.tx, ty: b.ty, maxV: b.maxV };
  };
  // THE SIM'S FACINGS ARE LENT. A man closing on a loose puck turns to it, and one waiting on
  // a pass opens up to it; once it's his, or he's stopped going for it, he faces his own way
  // again. (A facing somebody else has given him since is theirs to keep.)
  function lendFace(b, f) { b.face = f; b.simFace = f; }
  function unface(b) { if (b.simFace != null) { if (b.face === b.simFace) b.face = null; b.simFace = null; } }
  // nobody's going for it any more (the puck slides on as it was; a pass on its way to a man
  // still gets to him)
  W.uncollect = () => { const pk = W.puck; if (pk.home) { endFetch(pk.home); pk.home.inReachAt = null; pk.home = null; } };
  function endFetch(b) {
    if (b.fetchPrev) { b.tx = b.fetchPrev.tx; b.ty = b.fetchPrev.ty; b.maxV = b.fetchPrev.maxV; b.fetchPrev = null; }
    b.reachTo = null; unface(b);
  }
  W.loose = (vx, vy, vz = 0) => {
    const pk = W.puck;
    if (pk.carrier) { pk.carrier.carrying = false; pk.carrier.puckAt = null; }
    if (pk.home) { endFetch(pk.home); pk.home = null; }
    if (pk.target) unface(pk.target);
    pk.carrier = null; pk.target = null; pk.held = null; pk.vx = vx; pk.vy = vy; pk.vz = vz; pk.drag = 0;
  };
  // Only a man with the puck on his stick can pass it. Asked to pass it from out of reach,
  // he collects it instead and the pass isn't made.
  W.pass = (from, to, spd = 70) => {
    const pk = W.puck;
    // (a goalie plays it out of his glove as well as off his stick)
    if (from && from.kind !== 'goalie' && pk.carrier !== from) { const bw = bladeWorld(from, W.t, true); if (hyp(bw[0] - pk.x, bw[1] - pk.y) > REACH) { W.collect(from); return false; } }
    // A short pass is a soft one, and one out of a goalie's glove is tossed down to the ice
    // in front of the man it's for: neither is fired at a man a stride away.
    const z0 = pk.z, d0 = hyp(to.x - pk.x, to.y - pk.y);
    spd = Math.min(spd, 16 + d0 * 3);
    if (z0 > 1) spd = Math.min(spd, Math.max(10, d0 * 2.5));
    W.loose(0, 0);
    // (to a man beside him, the goalie drops it at his feet, and he takes it off the ice)
    if (z0 > 1 && d0 < 4) { pk.vz = -2; W.collect(to); return true; }
    let tx = to.x, ty = to.y, hAt = to.h, slow = false;
    for (let i = 0; i < 4; i++) {
      // led to where he'll be when it gets there: a man skating to a spot is going there,
      // speeding up as he goes, not on along the line he happens to be on now; and it gets
      // there a little later than its speed says, slowing on the ice the whole way
      const d = hyp(tx - pk.x, ty - pk.y), tt = flightT(d, spd), p = whereIn(to, tt);
      // to his stick, the way he'll be facing then: along his line if he's skating, or, nearly
      // stopped, toward the pass (he opens up to it), not however a stop or a turn has him
      // facing this instant
      const q = whereIn(to, Math.max(0, tt - 0.1)), v = hyp(p[0] - q[0], p[1] - q[1]) / 0.1;
      slow = to.face == null && v < 6;
      hAt = to.face != null ? to.face : !slow ? Math.atan2(p[1] - q[1], p[0] - q[0]) : Math.atan2(pk.y - p[1], pk.x - p[0]);
      // (and has to turn to it first: one there before he's round goes by his side, so it's
      // played no sooner than he can be facing it, as stepBody turns him, near enough)
      if (slow) {
        const turn = Math.abs(angWrap(hAt - to.h));
        const tTurn = turn > 0.73 ? (turn - 0.73) / 7 + 0.09 : turn > 0.3 ? Math.log(turn / 0.3) / 10 : 0;
        if (tt < tTurn) spd = Math.max(8, 0.35 * d / (1 - Math.exp(-0.35 * tTurn)));
      }
      const b = bladeLocal(to, W.t + tt, true), ch = Math.cos(hAt), sn = Math.sin(hAt);
      tx = p[0] + b[0] * ch - b[1] * sn; ty = p[1] + b[0] * sn + b[1] * ch;
    }
    const c = insideRink(tx, ty, 1.5); if (c) { tx = c.x; ty = c.y; }
    // Two men side by side: where his stick will be is about where the puck is, or the puck
    // is at his feet. It's handed over if his stick is at it already, or nudged across to his
    // stick where it is now.
    let d = hyp(tx - pk.x, ty - pk.y) || 1;
    if ((d < 1.5 || d0 < 2) && z0 < 1) {
      const bw = bladeWorld(to, W.t, true), db = hyp(bw[0] - pk.x, bw[1] - pk.y);
      if (to.stick && !to.rag && !to.blend && (db < 2.6 || inReach(to, pk.x, pk.y))) { W.give(to, true); W.sfx('receive'); return true; }
      tx = bw[0]; ty = bw[1]; d = db || 1; spd = Math.max(6, d * 3); slow = false;
    }
    if (slow) lendFace(to, hAt);
    pk.vx = (tx - pk.x) / d * spd; pk.vy = (ty - pk.y) / d * spd; pk.vz = z0 > 1 ? -6 : 0;
    pk.target = to; pk.passT0 = W.t; pk.passMin = Infinity;
    W.sfx('pass');
    return true;
  };
  // How long a puck played at `spd` takes to go `d` along the ice, slowing as it goes
  // (stepPuck's friction). Barely getting there, it's a long time.
  const flightT = (d, spd, k = 0.35) => { const x = k * d / Math.max(1, spd); return x < 0.9 ? -Math.log(1 - x) / k : d / Math.max(1, spd) + 2; };
  // Where a man will be in `t` seconds: heading for his spot (`tx, ty`) at up to `maxV`,
  // getting there from the speed he has at his acceleration, and easing up over the last
  // stretch as stepBody has him do (his speed 1.8 times what's left), unless he's going
  // through it. (A man with no spot to go to goes on as he's going.)
  function whereIn(m, t) {
    const dx = m.tx - m.x, dy = m.ty - m.y, d = hyp(dx, dy);
    if (!Number.isFinite(d) || d < 0.5) return [m.x + (m.vx || 0) * t * 0.3, m.y + (m.vy || 0) * t * 0.3];
    const v0 = Math.max(0, ((m.vx || 0) * dx + (m.vy || 0) * dy) / d), vm = Math.max(v0, m.maxV || 20), a = m.acc || 26;
    const rB = m.through > W.t ? 0 : Math.min(d, vm / 1.8), run = d - rB;
    const tUp = (vm - v0) / a, sUp = (v0 + vm) / 2 * tUp;
    // (the part at speed: up to his top speed and on at it, or not even that far)
    const tRun = sUp >= run ? (-v0 + Math.sqrt(v0 * v0 + 2 * a * run)) / a : tUp + (run - sUp) / vm;
    const s = t > tRun ? d - rB * Math.exp(-1.8 * (t - tRun)) : t <= tUp ? v0 * t + a * t * t / 2 : sUp + vm * (t - tUp);
    const k = Math.min(1, s / d);
    return [m.x + dx * k, m.y + dy * k];
  }
  // How soon a man flat out can be at (x, y), from the speed he has toward it (going the other
  // way, he has to stop first).
  function reachIn(m, x, y) {
    const dx = x - m.x, dy = y - m.y, d = hyp(dx, dy);
    if (d < 0.01) return 0;
    const a = m.acc || 26, vm = 24, v0 = clamp(((m.vx || 0) * dx + (m.vy || 0) * dy) / d, -vm, vm), v = Math.max(0, v0);
    const tUp = (vm - v) / a, sUp = (v + vm) / 2 * tUp;
    return (v0 < 0 ? -v0 / a : 0) + (sUp >= d ? (-v + Math.sqrt(v * v + 2 * a * d)) / a : tUp + (d - sUp) / vm);
  }
  // A shot leaves a light tail behind it, brightest on a snap shot.
  const TAIL = { snap: 1, slap: 0.75, onetimer: 0.7, wrist: 0.5, tip: 0.45, backhand: 0.4, wrap: 0.35 };
  W.shoot = (from, tgt, spd, type) => {
    const pk = W.puck;
    W.loose(0, 0);
    pk.tail = { t0: W.t, k: TAIL[type] ?? 0.5, pts: [] };
    const d = hyp(tgt[0] - pk.x, tgt[1] - pk.y) || 1, tt = d / spd;
    // (lifted no higher than a shot is: from a long way out, slowly, it would have to be lobbed
    // over the glass to come down on its spot, so it comes in low and slides the rest)
    pk.vx = (tgt[0] - pk.x) / d * spd; pk.vy = (tgt[1] - pk.y) / d * spd; pk.vz = Math.min(16, (tgt[2] - pk.z) / tt + (G / 2) * tt); pk.z = Math.max(pk.z, 0.05);
    W.burst('spray', pk.x, pk.y, 0.2, 8, 5, [0, 0, 2]);
    W.crowd = Math.max(W.crowd, 0.5);
    return tt;
  };
  // A loose puck that should come to rest near (x, y): more drag on it until it does.
  W.settleAt = (x, y) => { const pk = W.puck, d = hyp(x - pk.x, y - pk.y), v = hyp(pk.vx, pk.vy); pk.drag = clamp(v / Math.max(3, d), 0.35, 4); };
  W.dumpTo = (from, x, y, spd = 62) => {
    const pk = W.puck;
    W.loose(0, 0);
    const d = hyp(x - pk.x, y - pk.y) || 1;
    pk.vx = (x - pk.x) / d * spd; pk.vy = (y - pk.y) / d * spd; pk.vz = 3;
    // it's put in to a spot, not down the length of the rink: the boards and the snow bleed
    // its speed so it settles about where it was aimed, where the man chasing it can get it
    W.settleAt(x, y);
    W.sfx('shot', { soft: true });
  };

  // ── nets: a box behind each goal line. A puck can only come in through the mouth, and
  //    only when the director has opened it for a goal the sim scored. ──────────────
  const NETS = [{ side: 'a', gx: GOAL_X[0], dir: -1 }, { side: 'h', gx: GOAL_X[1], dir: 1 }];
  W.netBulge = { a: 0, h: 0 };
  function puckNets(pk) {
    for (const n of NETS) {
      const x0 = Math.min(n.gx, n.gx + n.dir * NET_DEPTH), x1 = Math.max(n.gx, n.gx + n.dir * NET_DEPTH);
      const y0 = MID_Y - NET_HALF, y1 = MID_Y + NET_HALF;
      if (pk.inNet === n.side) {
        // being collected, it comes back out through the mouth, and is out once it's past it
        if (pk.home && (pk.x - n.gx) * n.dir < 0) { pk.inNet = null; continue; }
        let lo = x0 + 0.15, hi = x1 - 0.15;
        if (pk.home) { if (n.dir > 0) lo = -Infinity; else hi = Infinity; }
        // inside: stop against the mesh
        const bx = clamp(pk.x, lo, hi), by = clamp(pk.y, y0 + 0.15, y1 - 0.15);
        if (bx !== pk.x || by !== pk.y) { pk.x = bx; pk.y = by; pk.vx *= -0.15; pk.vy *= -0.15; W.netBulge[n.side] = 1; }
        pk.z = Math.min(pk.z, NET_H - 0.3);
        continue;
      }
      const inside = pk.x > x0 - 0.2 && pk.x < x1 + 0.2 && pk.y > y0 - 0.2 && pk.y < y1 + 0.2;
      if (!inside) continue;
      // a puck coming down on the net bounces off the roof rather than dropping inside it
      if ((pk.lz ?? pk.z) > NET_H + 0.2) { if (pk.z < NET_H + 0.2 && pk.vz < 0) { pk.z = NET_H + 0.2; pk.vz = -pk.vz * 0.3; W.netBulge[n.side] = 0.4; } continue; }
      // it came in through the mouth if, a step ago, it was still on the ice side of the line
      const fromMouth = ((pk.lx ?? pk.x) - n.gx) * n.dir < 0.3 && pk.vx * n.dir > 0;
      if (fromMouth && W.allowGoal === n.side) { pk.inNet = n.side; W.netBulge[n.side] = 1; W.emit('goalIn', { side: n.side }); continue; }
      // the frame and the mesh push it back out the way it came
      // (out through whichever face it's nearest, so a puck nudged in at the front comes
      // back out the front rather than appearing behind the net)
      const back = n.dir > 0 ? x1 : x0, lx = pk.lx ?? pk.x, ly = pk.ly ?? pk.y;
      let dF = Math.abs(pk.x - n.gx), dB = Math.abs(pk.x - back), dS = NET_HALF - Math.abs(pk.y - MID_Y);
      // the face it came through, judged from where it was a step ago, wins
      if ((lx - n.gx) * n.dir < 0) dF = -1; else if ((lx - back) * n.dir > 0) dB = -1; else if (Math.abs(ly - MID_Y) > NET_HALF) dS = -1;
      if (fromMouth || (dF <= dB && dF <= dS)) { pk.vx = -pk.vx * 0.35; pk.x = n.gx - n.dir * 0.3; }
      else if (dS <= dB) { pk.vy = -pk.vy * 0.5; pk.y = pk.y > MID_Y ? y1 + 0.3 : y0 - 0.3; }
      else { pk.vx = -pk.vx * 0.5; pk.x = n.dir > 0 ? x1 + 0.3 : x0 - 0.3; }
    }
  }
  // The pocket of the blade that's drawn: the rig's heel, a puck's width out from him. (The
  // rig keeps its eased blade on the body against the instant, so asking here and drawing
  // the same instant later agree.)
  function pocketOf(c) {
    const J = skaterRig(c, W.t), h = J && J[19];
    if (!h) return null;
    const dx = h[0] - c.x, dy = h[1] - c.y, d = hyp(dx, dy) || 1;
    return [h[0] + dx / d * 0.12, h[1] + dy / d * 0.12];
  }
  function stepPuck(dt) {
    const pk = W.puck;
    if (pk.held) {
      // In a hand: the goalie's glove, or a linesman's right hand while he carries it to a
      // dot. Glided there if it isn't already, then held. A linesman who has left the ice
      // has it in his pocket.
      const hb = pk.held, J = hb.kind === 'goalie' ? goalieRig(hb, W.t) : skaterRig(hb, W.t), hnd = hb.kind === 'goalie' ? J[6] : J[9];
      const d = hyp3(hnd[0] - pk.x, hnd[1] - pk.y, hnd[2] - pk.z), pocket = pk.hidden;
      // (out of sight it's simply where his hand is, so he comes back on with it in his hand)
      const k = d > 0.5 && !pocket ? Math.min(1 - Math.exp(-dt * 10), 70 * dt / d) : 1;
      pk.x += (hnd[0] - pk.x) * k; pk.y += (hnd[1] - pk.y) * k; pk.z += (hnd[2] - pk.z) * k; pk.vx = pk.vy = pk.vz = 0;
      pk.tail = null;
      if (hb.kind === 'official') pk.hidden = !hb.active;
      if (pk.home) { endFetch(pk.home); pk.home = null; }
      return;
    }
    if (pk.home && !pk.carrier) {
      const h = pk.home;
      if (!h.active || h.rag || !h.stick) { endFetch(h); pk.home = null; }
      else if (pk.inNet) {
        // in the net, his stick reaches in through the mouth and draws it out, once he's
        // standing at it (the blade is on it the whole way: it's the stick moving it)
        const net = NETS.find((q) => q.side === pk.inNet), mx = net.gx - net.dir * 1.2;
        if (hyp(h.x - mx, h.y - MID_Y) < 6) {
          h.reachTo = [pk.x, pk.y];
          const dx = mx - net.dir * 1.5 - pk.x, dy = MID_Y - pk.y, d = hyp(dx, dy) || 1e-6, k = 1 - Math.exp(-dt * 8);
          pk.vx += (dx / d * Math.min(9, d * 3) - pk.vx) * k; pk.vy += (dy / d * Math.min(9, d * 3) - pk.vy) * k;
        }
      } else if (pk.z < 0.8 && (inReach(h, pk.x, pk.y) || hyp(pk.x - h.x, pk.y - h.y) < 1.4)) {
        // within reach of his stick: the blade goes out to it, and once it's had a moment to
        // get there he has it (one going by him quickly he takes as it comes, as he would a
        // pass: it's through his reach before a moment's gone)
        // (or at his skates, kicked up to his stick as a pass into his feet is: a man who'd
        // skated onto it turned to it, swung his blade round, and the blade's drag walked it
        // round his feet for seconds)
        if (h.inReachAt == null) h.inReachAt = W.t;
        h.outAt = null;
        h.reachTo = [pk.x, pk.y];
        // (not while he's still digging for it with a man on him: `holdOff`, a battle)
        const rel = hyp(pk.vx - (h.vx || 0), pk.vy - (h.vy || 0));
        if ((W.t - h.inReachAt > 0.08 || rel > 12) && !(h.holdOff > W.t)) { h.inReachAt = null; W.give(h, true); W.sfx('receive'); }
      } else {
        // (his moment starts over only once it's been out of reach a little while: a puck
        // riding the near edge of the box goes in and out of it step to step, and one that
        // started it over every time was skated the length of the ice an inch off his stick)
        if (h.inReachAt != null) {
          if (h.outAt == null) h.outAt = W.t;
          else if (W.t - h.outAt > 0.1) h.inReachAt = h.outAt = null;
        }
        // a stick's length off but not in front of him (beside him, or tight to the boards
        // he's skating along): his blade goes out to it and drags it in, at the speed a stick
        // moves a puck, not the speed of a pass
        const bw = bladeWorld(h, W.t, true), dx = bw[0] - pk.x, dy = bw[1] - pk.y, db = hyp(dx, dy) || 1e-6;
        if (db < 4.2 && pk.z < 0.8) {
          h.reachTo = [pk.x, pk.y];
          const sp = Math.min(10, db * 4), k = 1 - Math.exp(-dt * 6);
          pk.vx += (dx / db * sp + (h.vx || 0) - pk.vx) * k; pk.vy += (dy / db * sp + (h.vy || 0) - pk.vy) * k;
        } else h.reachTo = null;
      }
    }
    if (pk.carrier) {
      const c = pk.carrier;
      if (!c.active || c.rag || !c.stick) { W.loose(c.vx * 0.6, c.vy * 0.6); }
      else if ((() => { const bw = bladeWorld(c, W.t, true); return hyp(bw[0] - pk.x, bw[1] - pk.y) > 6; })()) {
        // moved off it (a change, a man put somewhere): it's his to collect, not to yank.
        // (He lets go of it first; `collect` does nothing for the man already carrying it.)
        c.carrying = false; c.puckAt = null; pk.carrier = null;
        W.collect(c);
      } else {
        if (dribble(c, pk, W.t, dt, rand, pocketOf) && W.t - (W.tickAt || 0) > 0.12) { W.tickAt = W.t; W.sfx('tick', { quiet: true }); }

      }
    }
    pk.rot = (pk.rot || 0) + (pk.spin || 0) * dt; pk.spin = (pk.spin || 0) * Math.exp(-dt * 0.8);
    pk.lz = pk.z;
    pk.vz -= G * dt; pk.z += pk.vz * dt;
    if (pk.z < 0) { pk.z = 0; pk.vz = pk.vz < -6 ? -pk.vz * 0.3 : 0; }
    if (pk.z === 0) { const f = Math.exp(-(pk.inNet ? 3 : pk.drag || 0.35) * dt); pk.vx *= f; pk.vy *= f; }
    pk.lx = pk.x; pk.ly = pk.y;
    pk.x += pk.vx * dt; pk.y += pk.vy * dt;
    const c = insideRink(pk.x, pk.y, 0.3);
    if (c && pk.z < GLASS_H) {
      const vn = pk.vx * c.nx + pk.vy * c.ny;
      pk.x = c.x; pk.y = c.y;
      if (vn < 0) {
        pk.vx -= 1.55 * vn * c.nx; pk.vy -= 1.55 * vn * c.ny;
        if (-vn > 18) { W.sfx(pk.z > BOARD_H ? 'glass' : 'boards'); W.boardShake = Math.max(W.boardShake, Math.min(0.5, -vn / 120)); }
        if (-vn > 30 && pk.z < 0.5) W.ice.puckMark(pk.x, pk.y, -c.nx, -c.ny);
      }
    }
    puckNets(pk);
    // where the carrier's blade should be: on the puck, and going the way it's going (rig.js)
    if (pk.carrier) { const c = pk.carrier; c.puckAt = [pk.x, pk.y]; c.puckV = [pk.vx - (c.vx || 0), pk.vy - (c.vy || 0)]; }
    if (pk.tail) {
      // the tail: the last fifth of a second of flight, while it's flying
      const T = pk.tail, sp = hyp3(pk.vx, pk.vy, pk.vz);
      if (pk.carrier || pk.inNet || W.t - T.t0 > 2 || (sp < 20 && !T.pts.length)) pk.tail = null;
      else {
        if (!T.at || W.t - T.at >= 1 / 60) { T.at = W.t; T.pts.push([pk.x, pk.y, pk.z + 0.06]); if (T.pts.length > 12) T.pts.shift(); }
        T.fade = Math.min(1, Math.max(0, (sp - 20) / 45));
        if (T.fade <= 0 && T.pts.length) T.pts.shift();
      }
    }
    for (const d of W.limbs) {
      // the puck can hit what's lying on the ice
      for (const p of d.pts) {
        const dx = pk.x - p.x, dy = pk.y - p.y, dd = hyp(dx, dy);
        if (dd < p.r + 0.3 && pk.z < 0.8 && dd > 0.01) { const vn = (pk.vx * dx + pk.vy * dy) / dd; if (vn < 0) { pk.vx -= 1.6 * vn * dx / dd; pk.vy -= 1.6 * vn * dy / dd; p.px -= vn * dx / dd * DT * 0.3; p.py -= vn * dy / dd * DT * 0.3; } }
      }
    }
    if (pk.target) {
      const tg = pk.target, b = bladeWorld(tg, W.t, true);
      const d = hyp(b[0] - pk.x, b[1] - pk.y);
      if (d < 4.5) tg.reachTo = [pk.x, pk.y];
      // Taken on his stick anywhere it can reach, or stopped with a skate and kicked up to it
      // (a pass into his feet). One that's gone by him, or that he can't play, he goes after:
      // it isn't put on his stick.
      const able = tg.active && !tg.rag && tg.stick;
      const dm = hyp(pk.x - tg.x, pk.y - tg.y), feet = dm < 1.4;
      if (able && pk.z < 1.2 && (d < 2.6 || inReach(tg, pk.x, pk.y) || feet)) { W.give(tg, true); W.sfx('receive'); }
      else if (!able) { tg.reachTo = null; unface(tg); pk.target = null; }
      else {
        // (gone by him: going away from him, and well past the nearest it came, which a pass
        // led into space ahead of him never was)
        const sp = hyp(pk.vx, pk.vy), away = ((pk.x - tg.x) * pk.vx + (pk.y - tg.y) * pk.vy) > 0;
        pk.passMin = Math.min(pk.passMin ?? Infinity, dm);
        // (a man the director has busy with something else, a hit or a draw, lets it go by
        // rather than breaking off after it; anybody else goes and gets it)
        if ((away && dm > 4 && dm > pk.passMin + 3) || sp < 3 || W.t - pk.passT0 > 4) {
          if (tg.scripted && !(tg.meetPass > W.t)) { tg.reachTo = null; unface(tg); pk.target = null; } else W.collect(tg);
        }
      }
    }
  }

  // ── particles, debris, limbs ───────────────────────────────────────────────
  W.burst = (type, x, y, z, n, spread, base) => {
    for (let i = 0; i < n; i++) {
      const p = { type, x, y, z, vx: base[0] + (rand() - 0.5) * spread, vy: base[1] + (rand() - 0.5) * spread, vz: base[2] + rand() * spread * 0.6, life: 0, max: 1.2 };
      if (type === 'blood') { p.size = 0.035 + rand() * 0.07; p.max = 3; p.col = rand() < 0.5 ? '#8c0f14' : '#b0151b'; }
      else if (type === 'spray') { p.size = 0.12 + rand() * 0.2; p.max = 0.45 + rand() * 0.3; }
      else if (type === 'tooth') { p.size = 0.09; p.max = 40; }
      else if (type === 'shard') { p.size = 0.08 + rand() * 0.12; p.max = 6; }
      else if (type === 'sweat') { p.size = 0.03; p.max = 0.6; }
      W.parts.push(p);
    }
    if (W.parts.length > 800) W.parts.splice(0, W.parts.length - 800);
  };
  // snow off a skate: thrown out along the slide, low and fast, and gone when it lands
  W.snow = (x, y, n, vx, vy) => {
    for (let i = 0; i < n; i++) {
      const r1 = fxRand(), r2 = fxRand(), r3 = fxRand();
      W.spray.push({ type: 'spray', x: x + (r1 - 0.5) * 0.5, y: y + (r2 - 0.5) * 0.5, z: 0.1, vx: vx * (0.45 + r3 * 0.35) + (r2 - 0.5) * 3, vy: vy * (0.45 + r1 * 0.35) + (r3 - 0.5) * 3, vz: 1.2 + r2 * 2.2, life: 0, max: 0.3 + r3 * 0.3, size: 0.05 + r1 * 0.09 });
    }
    if (W.spray.length > 300) W.spray.splice(0, W.spray.length - 300);
  };
  function stepSpray(dt) {
    const S = W.spray;
    for (let i = S.length - 1; i >= 0; i--) {
      const p = S[i]; p.life += dt; p.vx *= 0.93; p.vy *= 0.93; p.vz -= 10 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z <= 0 || p.life > p.max) { const last = S.pop(); if (i < S.length) S[i] = last; }
    }
  }
  function stepParts(dt) {
    // removal swaps the last particle into the hole: order doesn't matter, and a splice
    // per landed drop was quadratic in a burst
    const kill = (i) => { const last = W.parts.pop(); if (i < W.parts.length) W.parts[i] = last; };
    for (let i = W.parts.length - 1; i >= 0; i--) {
      const p = W.parts[i]; p.life += dt;
      const g = p.type === 'spray' ? 10 : G;
      if (p.type === 'spray') { p.vx *= 0.94; p.vy *= 0.94; }
      p.vz -= g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const c = insideRink(p.x, p.y, 0.05);
      if (c && p.z < GLASS_H) { p.x = c.x; p.y = c.y; p.vx *= -0.2; p.vy *= -0.2; }
      if (p.z <= 0) {
        if (p.type === 'blood') { W.ice.blood(p.x, p.y, p.size * (2.4 + rand() * 1.5), 0.8, (p.x * 1e3 + p.y * 7) | 0); kill(i); continue; }
        if (p.type === 'spray' || p.type === 'sweat') { kill(i); continue; }
        p.z = 0; p.vz = -p.vz * 0.3; p.vx *= 0.6; p.vy *= 0.6;
      }
      if (p.life > p.max) kill(i);
    }
  }
  W.addDebris = (kind, pos, vel, rot, spin, side, extra) => {
    W.debris.push({ kind, x: pos[0], y: pos[1], z: Math.max(0.2, pos[2]), vx: vel[0], vy: vel[1], vz: vel[2], rot, spin, side, ...(extra || {}) });
    if (W.debris.length > 40) W.debris.shift();
  };
  function stepDebris(dt) {
    for (const d of W.debris) {
      d.vz -= G * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.rot += d.spin * dt;
      const floor = d.kind === 'stick' ? 0.06 : 0.25;
      if (d.z < floor) { d.z = floor; d.vz = d.vz < -4 ? -d.vz * 0.35 : 0; d.vx *= Math.exp(-2.2 * dt); d.vy *= Math.exp(-2.2 * dt); d.spin *= Math.exp(-3 * dt); }
      const c = insideRink(d.x, d.y, 0.5);
      if (c && d.z < GLASS_H) { const vn = d.vx * c.nx + d.vy * c.ny; d.x = c.x; d.y = c.y; if (vn < 0) { d.vx -= 1.5 * vn * c.nx; d.vy -= 1.5 * vn * c.ny; } }
    }
  }
  W.sever = (b, part, vel) => {
    if (b.missing[part]) return;
    const J = b.kind === 'goalie' ? goalieRig(b, W.t) : skaterRig(b, W.t);
    b.missing[part] = true;
    const l = makeLimb(part, J, vel);
    l.side = b.side; l.owner = b;
    W.limbs.push(l);
    const at = J[part === 'head' ? 2 : SEVER[part][0]];
    W.burst('blood', at[0], at[1], at[2], 34, 9, [vel[0] * 0.3, vel[1] * 0.3, 6]);
    b.bleeding = Math.max(b.bleeding, part === 'head' ? 9 : 6);
    b.fountain = { part, until: W.t + (part === 'head' ? 4 : 2.2) };
    W.sfx('sever');
  };
  function stepLimbs(dt) {
    for (const l of W.limbs) {
      const ox = l.pts[0].x, oy = l.pts[0].y;
      const onIce = stepLimb(l, dt);
      if (onIce && l.age < 6 && hyp(l.pts[0].x - ox, l.pts[0].y - oy) > 0.004) W.ice.smear(ox, oy, l.pts[0].x, l.pts[0].y, 0.22, 0.35);
    }
  }

  // ── the glass ─────────────────────────────────────────────────────────────
  W.glassHit = (x, z, speed, shatter) => {
    W.shake = Math.max(W.shake, Math.min(1.2, speed / 25));
    W.boardShake = Math.max(W.boardShake, Math.min(1, speed / 25));
    W.crowd = 1;
    const onFar = x > PANEL_X0 && x < RL - PANEL_X0;
    if (onFar && z > BOARD_H - 0.8) {
      const i = panelAt(x);
      W.flex[i] = Math.max(W.flex[i], Math.min(1, speed / 22));
      if (shatter && !W.broken.has(i)) {
        W.broken.add(i);
        W.burst('shard', x, RW - 0.4, (BOARD_H + GLASS_H) / 2, 60, 9, [0, -2, 3]);
        W.sfx('shatter');
      } else if (speed > 14 && W.cracks.length < 8) W.cracks.push({ x, z: clamp(z, BOARD_H + 0.8, GLASS_H - 0.8), seed: (x * 997) | 0 });
      W.sfx('glass');
    } else W.sfx('boards');
    W.burst('spray', x, Math.min(RW - 1, Math.max(1, 0)), 0.3, 6, 6, [0, 0, 3]);
  };
  W.bloodOnGlass = (x, z, r) => { if (x > PANEL_X0 && x < RL - PANEL_X0) W.glassBlood.push({ x, z: clamp(z, BOARD_H + 0.5, GLASS_H - 0.4), r, seed: (x * 31 + z * 7) | 0 }); if (W.glassBlood.length > 30) W.glassBlood.shift(); };

  // ── bodies ─────────────────────────────────────────────────────────────────
  W.knock = (b, impU, impL) => {
    const J = b.kind === 'goalie' ? goalieRig(b, W.t) : skaterRig(b, W.t);
    if (b.stick && b.kind !== 'goalie') {
      W.addDebris('stick', J[9] || J[6], [b.vx * 0.5 + impU[0] * 0.2, b.vy * 0.5 + impU[1] * 0.2, 9], b.h + 1.3, 11, b.side);
      b.stick = false;
    }
    if (W.puck.carrier === b) W.loose(b.vx * 0.5 + impU[0] * 0.3, b.vy * 0.5 + impU[1] * 0.3);
    b.rag = makeRag(b, J, impU, impL);
    // From here he's where his hips are (the ragdoll's root), which can be most of a foot
    // from where he was skating. The step's start moves with him, so neither the renderers'
    // between-steps drawing nor anything measuring his step sees a jump.
    const p0 = b.rag.pts[0];
    b.x0 = (b.x0 ?? b.x) + p0.x - b.x; b.y0 = (b.y0 ?? b.y) + p0.y - b.y; b.x = p0.x; b.y = p0.y;
    b.blend = null; b.act = null; b.guard = false; b.grab = null; b.carrying = false;
    W.sfx('fall');
  };
  W.getUp = (b, dur = 1.1) => {
    if (!b.rag) return;
    const pts = b.rag.pts.map((p) => [p.x, p.y, p.z]);
    b.x = b.rag.pts[0].x; b.y = b.rag.pts[0].y; b.vx = b.vy = 0;
    // He gets up a skater's width off the boards, where a man on his feet is kept: from hips
    // lying against them that's a step in from where he lay. The pose blends up from the one
    // on the ice (b.blend), so nothing jumps, and the step's start moves with him (as in
    // W.knock), so the between-steps drawing doesn't show one either.
    const c = insideRink(b.x, b.y, 1.6);
    if (c) { b.x0 = (b.x0 ?? b.x) + c.x - b.x; b.y0 = (b.y0 ?? b.y) + c.y - b.y; b.x = c.x; b.y = c.y; }
    const hd = b.rag.pts[3]; b.h = Math.atan2(hd.y - b.y, hd.x - b.x);
    b.rag = null; b.blend = { from: pts, t: 0, dur };
    b.tx = b.x; b.ty = b.y;
  };
  W.dropGloves = (b, helmetToo) => {
    const J = skaterRig(b, W.t);
    if (b.stick) W.addDebris('stick', J[9], [Math.cos(b.h + 2) * 4, Math.sin(b.h + 2) * 4, 3], b.h + 1.2, 4, b.side);
    W.addDebris('glove', J[6], [Math.cos(b.h + 1) * 3, Math.sin(b.h + 1) * 3, 2], b.h, 5, b.side);
    W.addDebris('glove', J[9], [Math.cos(b.h - 1) * 3, Math.sin(b.h - 1) * 3, 2], b.h + 2, -5, b.side);
    if (helmetToo) { b.helmet = false; W.addDebris('helmet', J[3], [Math.cos(b.h + 2.5) * 5, Math.sin(b.h + 2.5) * 5, 6], 0, 7, b.side); }
    b.stick = false; b.gloves = false; b.carrying = false;
    if (W.puck.carrier === b) W.loose(0, 0);
    W.sfx('gloves');
  };
  W.reequip = (b) => { b.stick = b.kind === 'skater'; b.gloves = true; b.helmet = true; b.jerseyUp = 0; b.guard = false; b.grab = null; b.foe = null; };
  W.bleed = (b, sec) => { b.bleeding = Math.max(b.bleeding, sec); };

  // (the men on the ice this step, for stepBody to see who's in a man's way)
  let onIce = null;
  function stepBody(b, dt) {
    // something else owns him for now (a stretcher): no physics, no skating
    if (b.hold) { b.hold(b, dt); return; }
    if (b.rag) {
      const hit = stepRag(b.rag, dt);
      const r = b.rag, p0 = r.pts[0];
      b.vx = (p0.x - p0.px) / dt; b.vy = (p0.y - p0.py) / dt; b.x = p0.x; b.y = p0.y;
      if (hit) {
        W.glassHit(hit.x, hit.z, hit.speed, b.shatterNext && hit.speed > 12 && hit.y > RW - 3);
        if (b.shatterNext && hit.y > RW - 3) b.shatterNext = false;
        if (b.bleeding > 0 && hit.z > BOARD_H) W.bloodOnGlass(hit.x, hit.z + 0.3, 0.5 + rand() * 0.5);
      }
      const hd = r.pts[3];
      if (b.bleeding > 0 && rand() < 0.3) W.burst('blood', hd.x, hd.y, hd.z, 1, 1.2, [0, 0, 0.5]);
      if (b.down && r.age > 1.0 && r.age < 7 && r.age - r.poolAt > 0.25 && hd.z < 0.9) { r.poolAt = r.age; W.ice.blood(hd.x, hd.y, 0.45 + Math.min(2.4, (r.age - 1) * 0.3), 0.2, (r.age * 1000) | 0); }
      if (r.age - r.smearAt > 0.06 && hyp(p0.x - p0.px, p0.y - p0.py) / dt > 4 && b.bleeding > 0) { r.smearAt = r.age; W.ice.smear(p0.px, p0.py, p0.x, p0.y, 0.4, 0.25); }
    } else {
      if (b.blend) { b.blend.t += dt / b.blend.dur; if (b.blend.t >= 1) b.blend = null; }
      // (a skater or an official goes round a net in his way, not into it: see `aroundNets`)
      const [gx, gy, left] = b.kind === 'skater' || b.kind === 'official' ? W.aroundNets(b, b.tx, b.ty) : [b.tx, b.ty];
      const dx = gx - b.x, dy = gy - b.y, dist = hyp(dx, dy);
      // (easing up as he arrives, unless he's going through the spot: after a puck, into a man;
      // and for the spot, not for a corner of a net he's going round)
      const want = b.blend ? 0 : b.through > W.t ? b.maxV : Math.min(b.maxV, (left ?? dist) * 1.8);
      let ux = dist > 0.01 ? dx / dist : 0, uy = dist > 0.01 ? dy / dist : 0;
      // ROUND A MAN IN HIS WAY. One square in his road a few feet ahead that he's closing on
      // (across his line by less than a body, and nearer than where he's going) he goes
      // round, to the side he's already a little toward, rather than shoving him along in
      // front of him. Not the man he means to hit, or to take the puck off (`charging`), and
      // not a man lying down.
      // (looked for thirty times a second, which is plenty for men a few feet apart, and
      // steered by every step)
      if (want > 4 && (b.kind === 'skater' || b.kind === 'official') && onIce) {
        if (!(W.t - (b.avoidAt ?? -1) < 1 / 30)) {
          b.avoidAt = W.t; b.avoid = 0;
          let ou = 99, ov = 0;
          const s0 = hyp(b.vx || 0, b.vy || 0);
          for (const o of onIce) {
            const ox = o.x - b.x, oy = o.y - b.y;
            if (ox > 4.5 || ox < -4.5 || oy > 4.5 || oy < -4.5 || o === b) continue;
            if (o.rag || o.kind === 'goalie' || o === b.charging || o === b.target || o === b.foe) continue;
            const u = ox * ux + oy * uy;
            if (u <= 0.5 || u > 4 || u > dist) continue;
            const v = -ox * uy + oy * ux;
            // (closing on him: from a stop, at the speed he means to go, or a man stood in
            // front of a carrier wanting to go held him there leaning on him)
            const close = s0 < 3 ? want - ((o.vx || 0) * ux + (o.vy || 0) * uy) : ((b.vx || 0) - (o.vx || 0)) * ux + ((b.vy || 0) - (o.vy || 0)) * uy;
            if (Math.abs(v) < 2.3 && u < ou && close > 1.5) { ou = u; ov = v; }
          }
          if (ou < 99) b.avoid = (ov > 0.05 ? -1 : ov < -0.05 ? 1 : (b.seed & 1 ? 1 : -1)) * (1 - Math.abs(ov) / 2.3) * (1 - ou / 4) * 0.9;
        }
        if (b.avoid) {
          const nx = ux - uy * b.avoid, ny = uy + ux * b.avoid, nl = hyp(nx, ny) || 1;
          ux = nx / nl; uy = ny / nl;
        }
      } else b.avoid = 0;
      // A SKATER CARVES. At speed he can't stop dead and go back the way he came: a spot behind
      // him is turned toward round an arc, at most so far off his line at once, and only a man
      // nearly stopped pivots on the spot. (Straight-line reversals read as a man bouncing.)
      const sp0 = hyp(b.vx, b.vy);
      if (sp0 > 6 && want > 0) {
        const va0 = Math.atan2(b.vy, b.vx), ang = angWrap(Math.atan2(uy, ux) - va0);
        const lim = lerp(Math.PI, 1.35, clamp((sp0 - 6) / 12, 0, 1));
        if (Math.abs(ang) > lim) {
          // (nearly straight behind him, he keeps turning the way he started)
          const side = Math.abs(ang) > 2.8 && b.carve ? b.carve : Math.sign(ang) || 1;
          b.carve = side;
          ux = Math.cos(va0 + side * lim); uy = Math.sin(va0 + side * lim);
        } else b.carve = 0;
      } else b.carve = 0;
      let dvx = ux * want - b.vx, dvy = uy * want - b.vy;
      const dv = hyp(dvx, dvy), maxdv = b.acc * dt;
      // speeding up and braking along his line take what they take; turning across it can take
      // more (a skater leans into a tight turn at better than a g), so at speed the part of the
      // change that's across his line is allowed half again as much and more
      if (sp0 > 5 && dv > maxdv) {
        const ux0 = b.vx / sp0, uy0 = b.vy / sp0;
        let at = dvx * ux0 + dvy * uy0, an = -dvx * uy0 + dvy * ux0;
        at = clamp(at, -maxdv, maxdv); an = clamp(an, -maxdv * 1.6, maxdv * 1.6);
        dvx = at * ux0 - an * uy0; dvy = at * uy0 + an * ux0;
      } else if (dv > maxdv) { dvx *= maxdv / dv; dvy *= maxdv / dv; }
      b.vx += dvx; b.vy += dvy; b.x += b.vx * dt; b.y += b.vy * dt;
      const sp = hyp(b.vx, b.vy);
      // how hard he's speeding up or braking along his line, smoothed, for the lean
      const along = sp > 0.5 ? (dvx * b.vx + dvy * b.vy) / (sp * dt) : 0;
      b.accel = lerp(b.accel || 0, along, 1 - Math.exp(-dt * 6));
      const pushing = dv > maxdv * 0.6 && want > sp - 0.5;
      b.effort = lerp(b.effort, pushing ? 1 : 0.3, 1 - Math.exp(-dt * 3));
      const ampWant = b.kind === 'official' || b.kind === 'medic' ? clamp(sp / 18, 0, 0.8) : clamp(sp / 22, 0, 1) * b.effort;
      // (how fast the stride is widening or settling, and how fast he's turning, are kept for
      // the rig, which turns each skate along its real track over the ice)
      const amp0 = b.amp;
      b.amp = lerp(b.amp, b.guard ? 0 : ampWant, 1 - Math.exp(-dt * 5));
      b.ampRate = (b.amp - amp0) / dt;
      // a skater's cadence is slow and long next to a runner's: about one stride a second
      // cruising, quicker only on the first few pushes from a stop
      b.phase += dt * cadence(sp, b.effort);
      // in a hockey stop he's turned side-on to where he was going, skidding on both edges
      const wantH = b.act === 'stop' && b.stopH != null ? b.stopH : b.face != null ? b.face : (sp > 1.5 ? Math.atan2(b.vy, b.vx) : b.h);
      // turned toward where he's going, easing into the new heading rather than stopping dead on it
      const dh = clamp(angWrap(wantH - b.h) * (1 - Math.exp(-dt * 10)), -7 * dt, 7 * dt);
      b.h += dh; b.hRate = dh / dt;
      // how hard he is turning: drives the lean and the crossovers in the rig
      const va = sp > 2 ? Math.atan2(b.vy, b.vx) : null;
      const tr = va != null && b._va != null ? angWrap(va - b._va) / dt : 0;
      b.turnRate = lerp(b.turnRate || 0, tr, 1 - Math.exp(-dt * 6)); b._va = va;
      const c = insideRink(b.x, b.y, 1.6);
      if (c) { b.x = c.x; b.y = c.y; const vn = b.vx * c.nx + b.vy * c.ny; if (vn < 0) { b.vx -= vn * c.nx; b.vy -= vn * c.ny; } }
      // a hard stop throws snow, and shaves a fan of it off the sheet
      if (dv / dt > 20 && sp > 7 && !pushing && W.t - b.sprayAt > 0.25 && b.kind !== 'medic') {
        b.sprayAt = W.t;
        // a real stop, not just a slowing: side-on, knees bent, on the edges (not by a man a
        // pass is coming to, who keeps his stick to it rather than turning it away)
        if (!b.act && !b.carrying && b.kind === 'skater' && sp > 11 && W.puck.target !== b) {
          const side = Math.sign(angWrap(Math.atan2(b.ty - b.y, b.tx - b.x) - Math.atan2(b.vy, b.vx))) || 1;
          b.stopH = Math.atan2(b.vy, b.vx) + side * 1.25;
          W.act(b, 'stop', 0.5, side);
        } W.burst('spray', b.x + b.vx * 0.05, b.y + b.vy * 0.05, 0.2, 7, 5, [b.vx * 0.4, b.vy * 0.4, 2.5]);
        W.ice.scrape(b.x - Math.sin(b.h) * 0.4, b.y + Math.cos(b.h) * 0.4, b.vx, b.vy, clamp(sp * 0.22, 1.6, 4.5), (W.t * 977) | 0);
        if (sp > 14 && rand() < 0.4) W.sfx('stop', { x: b.x });
      }
      // THE BLADES SCORE THE ICE, from where the blades actually are. Each skate's runner is
      // traced while it is down, so the marks are the real push arcs and crossovers the
      // stride makes, and a lifted skate leaves a gap. A man missing a leg drags the stump.
      if (sp > 3 && W.t - b.cutAt > 0.07 && b.kind !== 'medic') {
        b.cutAt = W.t;
        const J = W.rigOf(b), a = b.missing.legL || b.missing.legR ? 0.3 : 0.11;
        b.feet = b.feet || [null, null];
        for (const [k, an, to] of [[0, 12, 16], [1, 15, 17]]) {
          const A = J[an], T = J[to];
          if (!A || !T || T[2] > 0.27) { b.feet[k] = null; continue; }
          const f = [(A[0] + T[0]) / 2, (A[1] + T[1]) / 2], prev = b.feet[k];
          // a hockey stop throws snow off both blades for as long as he's sliding
          if (b.act === 'stop' && sp > 5) W.snow(f[0], f[1], sp > 12 ? 5 : 3, b.vx, b.vy);
          if (prev && hyp(f[0] - prev[0], f[1] - prev[1]) < 4) W.ice.cut(prev[0], prev[1], f[0], f[1], a);
          b.feet[k] = f;
        }
      }
      if (b.bleeding > 0 && rand() < 0.15) W.burst('blood', b.x, b.y, 4.8, 1, 1, [b.vx * 0.5, b.vy * 0.5, 0]);
    }
    if (b.act) { b.actT += dt / b.actDur; if (b.actT >= 1) { b.act = null; b.actT = 0; } }
    b.react = Math.max(0, b.react - dt * 2.6);
    b.duck = Math.max(0, b.duck - dt * 2.2);
    if (b.bleeding > 0) b.bleeding -= dt;
    if (b.fountain && W.t < b.fountain.until) {
      const J = b.rag ? b.rag.pts : null;
      const src = b.fountain.part === 'head' ? (J ? J[2] : { x: b.x, y: b.y, z: 4.8 }) : J ? J[b.fountain.part === 'armL' ? 5 : b.fountain.part === 'armR' ? 8 : b.fountain.part === 'legL' ? 11 : 14] : { x: b.x, y: b.y, z: 3 };
      if (rand() < 0.7) W.burst('blood', src.x, src.y, src.z, 2, 3, [0, 0, 4 + rand() * 3]);
    }
  }
  function stepGoalie(g, dt) {
    if (!g.active) return;
    if (g.rag) { stepBody(g, dt); return; }
    const pk = W.puck, dir = attackDir(g.side), gx = g.side === 'a' ? GOAL_X[0] : GOAL_X[1];
    const gx0 = g.x, gy0 = g.y;
    // He eases onto his spot, but never faster than a goalie skates: from the bench or a
    // long way out of his net he comes back across the ice, he isn't snapped there.
    const glide = (tx, ty, kx, ky) => {
      let mx = (tx - g.x) * (1 - Math.exp(-dt * kx)), my = (ty - g.y) * (1 - Math.exp(-dt * ky));
      const m = hyp(mx, my), cap = 24 * dt;
      if (m > cap) { mx *= cap / m; my *= cap / m; }
      g.x += mx; g.y += my;
    };
    g.track = [pk.x, pk.y, pk.z];
    if (!g.scripted) {
      // out to cut the angle when the play is far, back to the post when it's in tight
      const dist = hyp(pk.x - gx, pk.y - MID_Y);
      const out = clamp(dist * 0.08, 1.2, 4.2);
      const ang = Math.atan2(pk.y - MID_Y, (pk.x - gx) * dir);
      const tx = gx + dir * Math.cos(clamp(ang, -1.2, 1.2)) * out, ty = MID_Y + Math.sin(clamp(ang, -1.2, 1.2)) * out * 0.9;
      glide(tx, ty, 7, 8);
      const base = dir > 0 ? 0 : Math.PI;
      const wantH = base + clamp(angWrap(Math.atan2(pk.y - g.y, pk.x - g.x) - base), -0.8, 0.8);
      g.h += clamp(angWrap(wantH - g.h), -6 * dt, 6 * dt);
      const near = hyp(pk.x - g.x, pk.y - g.y) < 22;
      g.bfly = lerp(g.bfly, near && pk.z < 0.5 && !pk.carrier ? 0.25 : 0, 1 - Math.exp(-dt * 4));
    } else {
      glide(g.tx, g.ty, 9, 9);
      if (g.face != null) g.h += clamp(angWrap(g.face - g.h), -7 * dt, 7 * dt);
    }
    g.vx = lerp(g.vx || 0, (g.x - gx0) / dt, 1 - Math.exp(-dt * 10)); g.vy = lerp(g.vy || 0, (g.y - gy0) / dt, 1 - Math.exp(-dt * 10));
    // with the play at the far end he keeps himself busy: taps a post, stretches
    if (!g.scripted && !g.act && Math.abs(pk.x - gx) > 120 && rand() < dt * 0.08) W.act(g, rand() < 0.6 ? 'tapPosts' : 'stretch', rand() < 0.6 ? 1.4 : 2.4);
    if (pk.held !== g && g.gloveW > 0 && !g.gloveHold) g.gloveW = Math.max(0, g.gloveW - dt * 1.5);
    g.phase += dt * 0.3;
    if (g.act) { g.actT += dt / g.actDur; if (g.actT >= 1) { g.act = g.actHold ? g.act : null; if (!g.actHold) g.actT = 0; else g.actT = 1; } }
  }
  // An official (or a medic) steps round a player rather than moving him, so a centre set on
  // the dot stays on it; and he's slimmer than a man in pads, so he can step between two.
  const yields = (q) => q.kind === 'official' || q.kind === 'medic';
  function separate(on) {
    const sk = on.filter((b) => b.kind !== 'goalie');
    for (let i = 0; i < sk.length; i++) for (let j = i + 1; j < sk.length; j++) {
      const a = sk[i], b = sk[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx > 2.4 || dx < -2.4 || dy > 2.4 || dy < -2.4) continue;
      if (a.rag || b.rag || a.foe === b || a.target === b || b.target === a) continue;
      const d = hyp(dx, dy);
      // eased apart over a few steps, and their closing speed taken off, rather than shoved
      // clear in one: two men bumping shouldn't twitch
      // (a man planted where he has to be, a linesman about to drop the puck, isn't moved:
      // whoever comes by goes round him)
      // (and the man with the puck isn't held up by his own teammate: the other gets out of
      // his road, to the side of it, rather than being shoved on up it ahead of him; nor is
      // the man a pass is going to shoved off its line by one skating through, nor a man the
      // play has going somewhere held up by one of his side just playing his position)
      const pa = a.plant > W.t, pb = b.plant > W.t, car = W.puck.carrier || W.puck.target;
      const rank = (q) => (q === car ? 2 : q.scripted ? 1 : 0);
      const own = a.side === b.side && rank(a) !== rank(b) && !pa && !pb, lead = own ? (rank(a) > rank(b) ? a : b) : null;
      const wa = own ? (a === lead ? 0 : 1) : pa !== pb ? (pa ? 0 : 1) : yields(a) && !yields(b) ? 1 : yields(b) && !yields(a) ? 0 : 0.5, wb = 1 - wa, R = yields(a) === yields(b) ? 2.4 : 1.5;
      if (d < R && d > 0.01) {
        // pushed apart through their velocities, a stiff spring with the closing speed taken
        // off, so each goes on along a smooth path; only a man pressed deep into another is
        // moved, and then a little a step
        let nx = dx / d, ny = dy / d;
        const cv = own ? hyp(lead.vx, lead.vy) : 0;
        if (cv > 3) {
          // (n runs from a to b; the push on the other man is sideways off the leading man's line)
          const ux = lead.vx / cv, uy = lead.vy / cv, o = a === lead ? b : a, sg = a === lead ? 1 : -1;
          const s = Math.sign(-(o.x - lead.x) * uy + (o.y - lead.y) * ux) || 1;
          nx = -uy * s * sg * 0.8 + nx * 0.2; ny = ux * s * sg * 0.8 + ny * 0.2;
          const nl = hyp(nx, ny) || 1; nx /= nl; ny /= nl;
        }
        const over = R - d, kv = Math.min(over * 140, 90) * DT;
        a.vx -= nx * kv * wa * 2; a.vy -= ny * kv * wa * 2; b.vx += nx * kv * wb * 2; b.vy += ny * kv * wb * 2;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) { a.vx += vn * nx * wa; a.vy += vn * ny * wa; b.vx -= vn * nx * wb; b.vy -= vn * ny * wb; }
        if (over > 1.1) { const k = (over - 1.1) * 0.25; a.x -= nx * k * wa * 2; a.y -= ny * k * wa * 2; b.x += nx * k * wb * 2; b.y += ny * k * wb * 2; }
      }
    }
    // nobody skates through a net or stands in it
    for (const b of sk) {
      if (b.rag) continue;
      for (const n of NETS) {
        const cx = n.gx + n.dir * NET_DEPTH / 2, hx = NET_DEPTH / 2 + 1.2, hy = NET_HALF + 1.2;
        const dx = b.x - cx, dy = b.y - MID_Y;
        if (Math.abs(dx) < hx && Math.abs(dy) < hy) {
          // turned away along the face he's nearest, through his velocity (his inward speed
          // taken off and a push out), so he slides round the frame rather than stepping
          const alongX = hx - Math.abs(dx) < hy - Math.abs(dy), sg = alongX ? Math.sign(dx || 1) : Math.sign(dy || 1);
          const pen = alongX ? hx - Math.abs(dx) : hy - Math.abs(dy), push = Math.min(pen * 60, 40) * DT;
          if (alongX) { if (b.vx * sg < 0) b.vx = 0; b.vx += sg * push; if (pen > 0.8) b.x += sg * (pen - 0.8) * 0.3; }
          else { if (b.vy * sg < 0) b.vy = 0; b.vy += sg * push; if (pen > 0.8) b.y += sg * (pen - 0.8) * 0.3; }
        }
      }
    }
  }

  // ── ambient hockey ─────────────────────────────────────────────────────────
  const offGoal = (side) => (side === 'a' ? GOAL_X[1] : GOAL_X[0]);
  const ownGoal = (side) => (side === 'a' ? GOAL_X[0] : GOAL_X[1]);
  const offBlue = (side) => (side === 'a' ? BLUE_X[1] : BLUE_X[0]);
  const laneY = (side, slot) => { const s = side === 'a' ? 1 : -1; return [MID_Y + 24 * s, MID_Y, MID_Y - 24 * s, MID_Y + 13 * s, MID_Y - 13 * s, MID_Y + 6 * s][slot]; };
  function nearestOf(list, x, y, except) {
    let best = null, bd = 1e9;
    for (const b of list) { if (b === except || b.rag || b.scripted || !b.active) continue; const d = hyp(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  // ── positions ─────────────────────────────────────────────────────────────
  // Hockey is played in positions, and the between-plays game plays them: wingers in their
  // lanes, a centre, two defencemen, each with a job that depends on who has the puck and
  // where it is. `assignRoles` hands out the jobs that go to whoever's best placed (the
  // forward nearest the puck supports it, the next goes to the net), and `systemSpot` says
  // where a man with a given job stands.
  const isDef = (m) => m.slot === 3 || m.slot === 4;
  const laneSign = (side, slot) => Math.sign(laneY(side, slot) - MID_Y) || 0;
  function assignRoles(team, side, carrier) {
    const pk = W.puck, fw = team.filter((m) => !isDef(m) && m !== carrier && !m.rag);
    fw.sort((a, b) => hyp(a.x - pk.x, a.y - pk.y) - hyp(b.x - pk.x, b.y - pk.y));
    const r = new Map();
    fw.forEach((m, i) => r.set(m, ['support', 'net', 'high'][Math.min(i, 2)]));
    // the defenceman on the puck's side of the ice is the one who steps up to it
    const ds = team.filter(isDef);
    const strong = ds.reduce((best, d) => (!best || Math.abs(laneY(side, d.slot) - pk.y) < Math.abs(laneY(side, best.slot) - pk.y) ? d : best), null);
    for (const d of ds) r.set(d, d === strong ? 'strongD' : 'weakD');
    return r;
  }
  function systemSpot(m, side, phase, carrier, roles) {
    const pk = W.puck, dir = attackDir(side), px = pk.x, py = pk.y;
    const gOff = offGoal(side), gOwn = ownGoal(side), bOff = offBlue(side), bOwn = offBlue(side === 'a' ? 'h' : 'a');
    const role = roles.get(m) || 'high', ls = laneSign(side, m.slot), pSide = Math.sign(py - MID_Y) || 1;
    const inOffZone = (px - bOff) * dir > 0, inOwnZone = (bOwn - px) * dir > 0;
    if (phase === 'attack') {
      if (inOffZone) {
        // set up in the zone: the D on the points, a man at the net, one low in support,
        // one in the high slot; the point men slide toward the puck's side
        if (isDef(m)) return { tx: bOff + dir * 3, ty: MID_Y + ls * 17 + (py - MID_Y) * 0.22, mv: 16, face: dir > 0 ? 0 : Math.PI };
        if (role === 'net') return { tx: gOff - dir * 7, ty: MID_Y - pSide * 3, mv: 18 };
        if (role === 'support') return { tx: lerp(px, gOff - dir * 18, 0.45), ty: lerp(py, MID_Y, 0.35), mv: 20 };
        return { tx: gOff - dir * 27, ty: MID_Y - (py - MID_Y) * 0.3, mv: 18 };
      }
      // the rush: wingers wide in their lanes and ahead of the puck, but onside (not into
      // the zone before it); the centre in support through the middle; the D trailing
      const onside = (x) => ((x - bOff) * dir > -1 ? bOff - dir * 1.5 : x);
      if (isDef(m)) return { tx: clamp(px - dir * 20, Math.min(gOwn, gOff) + 12, Math.max(gOwn, gOff) - 12), ty: MID_Y + ls * 11, mv: 20 };
      if (m.slot === 1 || role === 'high') return { tx: onside(px + dir * 6), ty: lerp(MID_Y, py, 0.25) + (m.slot === 1 ? 0 : ls * 8), mv: 22 };
      return { tx: onside(px + dir * 17), ty: MID_Y + ls * 23, mv: 23 };
    }
    // defending
    if (inOwnZone) {
      // in our end: the strong-side D takes the puck carrier in the corner, the other holds
      // the front of the net; the centre covers low; the wingers take the points
      const corner = Math.abs(px - gOwn) < 26 && Math.abs(py - MID_Y) > 11;
      if (isDef(m)) {
        if (role === 'strongD' && corner) return { tx: px + dir * 2, ty: py - pSide * 2, mv: 20, face: Math.atan2(py - m.y, px - m.x) };
        return { tx: gOwn + dir * 8, ty: MID_Y + (role === 'strongD' ? pSide : -pSide) * 4, mv: 18, face: Math.atan2(py - m.y, px - m.x) };
      }
      if (m.slot === 1) return { tx: gOwn + dir * 17, ty: lerp(MID_Y, py, 0.3), mv: 19, face: Math.atan2(py - m.y, px - m.x) };
      return { tx: bOwn - dir * 7, ty: MID_Y + ls * 16, mv: 19, face: Math.atan2(py - m.y, px - m.x) };
    }
    // the neutral zone and theirs: a 1-2-2. One man goes (the forechecker, handled above),
    // two forwards hold the middle lanes a stride back, the D hold our blue line
    if (isDef(m)) return { tx: (inOffZone ? bOff - dir * 22 : clamp(px - dir * 28, Math.min(bOwn, bOff) - 30, Math.max(bOwn, bOff) + 30)), ty: MID_Y + ls * 11, mv: 19, face: dir > 0 ? Math.PI : 0 };
    return { tx: px - dir * 14, ty: MID_Y + ls * 14 + (py - MID_Y) * 0.3, mv: 21 };
  }
  const roles = { a: new Map(), h: new Map() }, roleAt = {};

  function ambient(dt) {
    const pk = W.puck, A = W.amb;
    const carrier = pk.carrier;
    const free = !W.puckScripted && !W.frozen;
    // a goalie with it plays it up to a defenceman
    if (free && pk.held && pk.held.kind === 'goalie' && W.t > A.holdUntil) {
      const g = pk.held; const d = nearestOf(W.mates(g.side).filter((b) => b.slot >= 3), g.x, g.y);
      if (d) { pk.held = null; g.gloveW = 0; W.pass(g, d, 50); }
    }
    if (free && carrier && carrier.kind === 'skater') A.poss = carrier.side;
    const poss = A.poss;
    for (const side of ['a', 'h']) {
      const dir = attackDir(side), team = W.mates(side), opp = W.mates(side === 'a' ? 'h' : 'a');
      const attacking = poss === side && (carrier || pk.target);
      const loose = !carrier && !pk.target && !pk.held;
      // one man chases a loose puck or forechecks the carrier, sticky so it doesn't flicker
      let fore = A.fore[side];
      if (!fore || !fore.active || fore.rag || fore.scripted || W.t - (A.foreAt?.[side] || 0) > 2.5) {
        fore = nearestOf(team, pk.x, pk.y); A.fore[side] = fore; A.foreAt = A.foreAt || {}; A.foreAt[side] = W.t;
      }
      // the jobs are handed out five times a second, not every step: nobody changes role faster
      if (W.t - (roleAt[side] ?? -9) > 0.2) { roleAt[side] = W.t; roles[side] = assignRoles(team, side, carrier); }
      // (one of his side the play has going at the man with the puck already: a second man on
      // him only got in his road, along the boards for seconds once)
      const onHim = carrier && team.some((o) => o.scripted && o.charging === carrier);
      for (const m of team) {
        if (m.scripted || m.rag || m.blend) continue;
        const isD = m.slot === 3 || m.slot === 4;
        let tx, ty, mv = 19;
        // (a man a pass is coming to keeps the facing he opened up to it with)
        m.face = pk.target === m && m.simFace != null ? m.simFace : null;
        if (W.frozen) {
          // whistle: coast to a stop and drift toward the play
          tx = m.x + m.vx * 0.5; ty = m.y + m.vy * 0.5; mv = 6;
        } else if (m === carrier) {
          const inZone = (m.x - offBlue(side)) * dir > 0;
          if (!inZone) { tx = m.x + dir * 30; ty = laneY(side, m.slot) * 0.6 + MID_Y * 0.4 + Math.sin(W.t * 0.9 + m.seed) * 9; mv = 23; }
          else if (isD) {
            // a defenceman with it in the zone walks the line, looking for a lane
            tx = offBlue(side) + dir * 4; ty = MID_Y + Math.sin(W.t * 0.7 + m.seed) * 17; mv = 12;
            m.face = dir > 0 ? 0 : Math.PI;
          } else {
            // cycle: down the wall to below the dots, behind the net line, back up the half-wall
            const ph = (W.t * 0.18 + m.seed * 0.1) % 1;
            const wall = m.y > MID_Y ? RW - 9 : 9;
            const gx = offGoal(side);
            if (ph < 0.4) { tx = gx - dir * 22; ty = wall; } else if (ph < 0.7) { tx = gx - dir * 6; ty = lerp(wall, MID_Y, 0.4); } else { tx = gx - dir * 34; ty = lerp(wall, MID_Y, 0.25); }
            mv = 17;
          }
        } else if (loose && (m === fore || hyp(m.x - pk.x, m.y - pk.y) < 10)) {
          // after it flat out, to where he'll meet it, and through it rather than creeping up
          const p = W.intercept(m, 24); [tx, ty] = p; mv = 24; m.through = W.t + 0.1;
        } else if (m === fore && !attacking && !onHim) {
          // the forechecker: on the man with the puck
          const c2 = carrier || pk;
          tx = c2.x - dir * 1.5; ty = c2.y; mv = 24;
        } else {
          // everyone else plays his position (see `systemSpot`)
          const sp = systemSpot(m, side, attacking ? 'attack' : 'defend', carrier, roles[side]);
          tx = sp.tx; ty = sp.ty; mv = sp.mv; if (sp.face != null) m.face = sp.face;
        }
        // Out of the road of his own man with the puck: a spot in the lane ahead of him moves
        // to the side of it, or he'd skate a stride in front of him and hold him up.
        if (carrier && carrier !== m && carrier.side === side) {
          const cv = hyp(carrier.vx, carrier.vy), hx = cv > 4 ? carrier.vx / cv : Math.cos(carrier.h), hy = cv > 4 ? carrier.vy / cv : Math.sin(carrier.h);
          const ax = tx - carrier.x, ay = ty - carrier.y, along = ax * hx + ay * hy, lat = -ax * hy + ay * hx;
          if (along > -4 && along < 30 && Math.abs(lat) < 9) {
            const nl = (Math.sign(lat) || Math.sign(-(m.x - carrier.x) * hy + (m.y - carrier.y) * hx) || 1) * 9;
            tx = carrier.x + hx * along - hy * nl; ty = carrier.y + hy * along + hx * nl;
          }
        }
        const c = insideRink(tx, ty, 2.5); if (c) { tx = c.x; ty = c.y; }
        // HE DOESN'T SNAP TO A NEW IDEA. Where he should be changes as the play does (a pass
        // turns the carrier into a support man, a turnover turns attack into defence), and a
        // man who went there at once braked and reversed on the spot. The spot is followed
        // with a short lag instead, so he carries on a moment and swings round. A man after a
        // loose puck goes straight where it's going.
        const kT = m.through > W.t || !Number.isFinite(m.tx) ? 1 : 1 - Math.exp(-dt * 4);
        m.tx += (tx - m.tx) * kT; m.ty += (ty - m.ty) * kT; m.maxV = mv; m.acc = 26;
        // what he does with his stick and his eyes
        m.protect = 0; m.defend = null; m.look = null;
        if (m === carrier) {
          const th = nearestOf(opp, m.x, m.y);
          if (th && hyp(th.x - m.x, th.y - m.y) < 5.5) {
            const lv = -(th.x - m.x) * Math.sin(m.h) + (th.y - m.y) * Math.cos(m.h);
            m.protect = lv >= 0 ? 1 : -1;
          }
        } else if (carrier && carrier.side !== side && hyp(m.x - pk.x, m.y - pk.y) < 13) {
          m.defend = [pk.x, pk.y];
        } else if (pk.target === m || (carrier && carrier.side === side && hyp(m.x - pk.x, m.y - pk.y) < 40)) {
          m.look = [pk.x, pk.y, 0.2];
        }
      }
      if (!free) continue;
      // possession: pick up a loose puck once it's within reach of his stick and his blade
      // has had a moment to get to it (rig.js reaches it out to `reachTo`)
      if (loose && pk.z < 1 && !pk.inNet) {
        for (const m of team) {
          if (m.scripted || m.rag || m.blend || !m.stick || pk.home === m) continue;
          if (inReach(m, pk.x, pk.y) && hyp(pk.vx, pk.vy) < 45) {
            if (m.inReachAt == null) m.inReachAt = W.t;
            m.reachTo = [pk.x, pk.y];
            if (W.t - m.inReachAt > 0.08) { m.inReachAt = null; W.give(m, true); W.sfx('receive'); break; }
          } else { m.inReachAt = null; if (m.reachTo && pk.target !== m) m.reachTo = null; }
        }
      }
      // the forechecker takes it back
      if (carrier && carrier.side !== side && fore && !fore.scripted && W.t - A.lastTurn > 4.5) {
        const d = hyp(fore.x - carrier.x, fore.y - carrier.y);
        if (d < 3 && rand() < dt * 0.9) {
          A.lastTurn = W.t;
          const nearWall = carrier.y < 10 || carrier.y > RW - 10;
          if (nearWall && rand() < 0.5) {
            // pinned on the wall: a rub-out, the puck squirts loose
            W.act(carrier, 'stagger', 0.6); carrier.react = 0.5;
            W.loose((rand() - 0.5) * 18, (MID_Y - carrier.y) * 0.4, 0);
            W.sfx('check', { soft: true }); W.boardShake = Math.max(W.boardShake, 0.3);
          } else { W.act(fore, 'poke', 0.35); W.give(fore); W.sfx('stick'); }
        }
      }
    }
    if (!free || !carrier || carrier.kind !== 'skater') return;
    // the carrier moves it
    const side = carrier.side, dir = attackDir(side);
    if (W.t > A.nextPass) {
      // in the zone it moves quicker, man to man; through the neutral zone a carrier skates more
      const zone = (carrier.x - offBlue(side)) * dir > 0;
      A.nextPass = W.t + (zone ? 0.9 + rand() * 1.5 : 1.3 + rand() * 2.2);
      const team = W.mates(side).filter((m) => m !== carrier && !m.scripted && !m.rag && !m.blend && m.stick);
      const opp = W.mates(side === 'a' ? 'h' : 'a');
      const neutral = Math.abs(carrier.x - RL / 2) < 18;
      const press = opp.some((o) => hyp(o.x - carrier.x, o.y - carrier.y) < 7);
      if (neutral && press && rand() < 0.35) {
        // dump it in and go get it
        const cy = carrier.y > MID_Y ? RW - 6 : 6;
        // released at contact, as every shot is, so it leaves the blade
        W.act(carrier, 'dump', SHOTS.dump.dur);
        W.schedule(releaseAt('dump'), () => { if (W.puck.carrier === carrier) W.dumpTo(carrier, offGoal(side) + dir * 4, cy, 64); });
        return;
      }
      let best = null, bs = -1e9;
      for (const m of team) {
        const open = Math.min(20, ...opp.map((o) => hyp(o.x - m.x, o.y - m.y)));
        const fwd = (m.x - carrier.x) * dir;
        const d = hyp(m.x - carrier.x, m.y - carrier.y);
        if (d < 8 || d > 70) continue;
        // the plays: in the zone, back to the points, D to D, low to high; through the neutral
        // zone, the stretch pass to a winger in his lane
        let sc = open * 1.2 + rand() * 6;
        if (zone) sc += (isDef(m) && !isDef(carrier) ? 9 : 0) + (isDef(m) && isDef(carrier) ? 11 : 0) + (!isDef(m) && isDef(carrier) && Math.abs(m.x - offGoal(side)) < 30 ? 6 : 0);
        else sc += clamp(fwd, -20, 25) * 0.4 + (m.slot === 0 || m.slot === 2 ? 4 : 0);
        if (sc > bs) { bs = sc; best = m; }
      }
      // a man standing him up in front: beat him with the hands instead of moving it
      const front = opp.find((o) => !o.rag && hyp(o.x - carrier.x, o.y - carrier.y) < 7 && ((o.x - carrier.x) * Math.cos(carrier.h) + (o.y - carrier.y) * Math.sin(carrier.h)) > 1.5);
      if (front && rand() < 0.45) {
        const mv = ['toedrag', 'deke', 'drag'][(rand() * 3) | 0];
        W.act(carrier, mv, 0.7);
        const sd2 = rand() < 0.5 ? 1 : -1;
        carrier.tx = carrier.x + Math.cos(carrier.h) * 12 - Math.sin(carrier.h) * 7 * sd2; carrier.ty = carrier.y + Math.sin(carrier.h) * 12 + Math.cos(carrier.h) * 7 * sd2;
        if (rand() < 0.35) W.schedule(0.35, () => { if (!front.scripted && !front.rag) { W.act(front, 'stagger', 0.6); front.react = 0.4; } });
        return;
      }
      if (best) {
        // the pass that fits: a saucer over a stick in the lane, a backhand to his off side,
        // a drop pass to a man trailing him, otherwise the forehand along the ice
        const to = best;
        const lu = (to.x - carrier.x) * Math.cos(carrier.h) + (to.y - carrier.y) * Math.sin(carrier.h);
        const lv = -(to.x - carrier.x) * Math.sin(carrier.h) + (to.y - carrier.y) * Math.cos(carrier.h);
        const lane = opp.some((o) => { const t = clamp(((o.x - carrier.x) * (to.x - carrier.x) + (o.y - carrier.y) * (to.y - carrier.y)) / ((to.x - carrier.x) ** 2 + (to.y - carrier.y) ** 2 || 1), 0, 1); return hyp(carrier.x + (to.x - carrier.x) * t - o.x, carrier.y + (to.y - carrier.y) * t - o.y) < 3; });
        const pd = hyp(to.x - carrier.x, to.y - carrier.y);
        const kind = lu < -3 && pd < 14 ? 'drop' : lane ? 'saucer' : (lv < -4 && lu < 8) || lu < -3 ? 'backpass' : 'pass';
        W.act(carrier, kind, SHOTS[kind].dur);
        carrier.look = [to.x, to.y, 1];
        W.schedule(releaseAt(kind), () => {
          if (W.puck.carrier !== carrier) return;
          const spd = kind === 'drop' ? clamp(pd * 1.8, 16, 28) : 62 + rand() * 18;
          W.pass(carrier, to, spd);
          if (kind === 'saucer') W.puck.vz = 7;
          const tt = hyp(to.x - carrier.x, to.y - carrier.y) / spd;
          if (!to.scripted) W.act(to, 'receive', tt + 0.25, [carrier.x, carrier.y]);
          // a pass through traffic can be picked off
          const pk2 = W.puck;
          for (const o of opp) {
            if (o.scripted || o.rag) continue;
            const t = clamp(((o.x - pk2.x) * pk2.vx + (o.y - pk2.y) * pk2.vy) / (pk2.vx * pk2.vx + pk2.vy * pk2.vy || 1), 0, 1.2);
            const px = pk2.x + pk2.vx * t, py = pk2.y + pk2.vy * t;
            if (hyp(o.x - px, o.y - py) < 2.4 && rand() < 0.3) { pk2.target = o; break; }
          }
        });
      }
    }
  }

  function officials(dt) {
    const pk = W.puck;
    W.officials.forEach((o, i) => {
      if (o.scripted || o.rag) return;
      // a linesman with the puck in his hand is waiting for a draw, not following it
      if (pk.held === o) { o.tx = o.x; o.ty = o.y; return; }
      const far = i === 0;
      const tx = clamp(pk.x + (far ? -14 : 16), 30, RL - 30), ty = far ? RW - 6 : 6.5;
      o.tx = tx; o.ty = ty; o.maxV = 18; o.face = Math.atan2(pk.y - o.y, pk.x - o.x);
      if (hyp(o.x - pk.x, o.y - pk.y) < 8) { o.ty = o.y > MID_Y ? RW - 4 : 4; }
    });
  }

  // THE ZAMBONI follows the boards round in laps, each one a strip further in, the way a
  // driver does it, and finishes with passes down the middle. `z.speed` is feet a second;
  // a broadcast runs it faster than life so a lap fits in the time the booth talks over it.
  // The conditioner sits behind the machine and lays the clean sheet back as it goes.
  const ZW = 7.4;                                        // strip width
  function zamboniPath(d) {
    // a rounded rectangle inset `d` from the boards, as a list of points every two feet
    const r = Math.max(2.5, 28 - d), x0 = d, x1 = RL - d, y0 = d, y1 = RW - d, pts = [];
    const seg = (ax, ay, bx, by) => { const n = Math.max(1, Math.round(hyp(bx - ax, by - ay) / 2)); for (let i = 0; i < n; i++) pts.push([lerp(ax, bx, i / n), lerp(ay, by, i / n)]); };
    const arc = (cx, cy, a0) => { const n = Math.max(2, Math.round(r * Math.PI / 4)); for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    seg(x0 + r, y0, x1 - r, y0); arc(x1 - r, y0 + r, -Math.PI / 2);
    seg(x1, y0 + r, x1, y1 - r); arc(x1 - r, y1 - r, 0);
    seg(x1 - r, y1, x0 + r, y1); arc(x0 + r, y1 - r, Math.PI / 2);
    seg(x0, y1 - r, x0, y0 + r); arc(x0 + r, y0 + r, Math.PI);
    return pts;
  }
  // It comes on and goes off through the gate in an end wall, clear of the net (`GATE_Y`),
  // and is never simply there: on, it drives in and joins its first lap on that end; called
  // off (`W.zamboniOff`, the period about to start), it drives to the nearer gate and out.
  const GATE_Y = 52.5, GATE_OUT = 16;
  W.startZamboni = (speed = 22) => {
    // every lap starts and ends on the left end by the gate, so each one steps in from the
    // last there, clear of the net
    const route = [[-GATE_OUT, GATE_Y], [-6, GATE_Y]];
    for (let d = 4.8; d < MID_Y - ZW * 0.4; d += ZW) {
      const L = zamboniPath(d);
      let j = 0, bd = Infinity;
      L.forEach((q, k) => { if (Math.abs(q[0] - d) < 0.5 && Math.abs(q[1] - GATE_Y) < bd) { bd = Math.abs(q[1] - GATE_Y); j = k; } });
      route.push(...L.slice(j), ...L.slice(0, j));
    }
    route.push([RC + 6, MID_Y], [RL - RC - 6, MID_Y]);
    W.zamboni = { t: 0, route, i: 0, x: route[0][0], y: route[0][1], h: 0, speed, done: false, wake: [] };
  };
  W.zamboniOff = () => {
    const z = W.zamboni; if (!z || z.leaving) return;
    const gx = z.x < RL / 2 ? 0 : RL, out = gx ? 1 : -1;
    z.route = [[z.x, z.y], [gx - out * 14, GATE_Y], [gx - out * 4, GATE_Y], [gx + out * GATE_OUT, GATE_Y]];
    z.i = 0; z.done = false; z.leaving = true; z.speed = Math.max(z.speed, 26);
  };
  function stepZamboni(dt) {
    const z = W.zamboni; if (!z) return;
    z.t += dt;
    if (z.done) return;
    let move = z.speed * dt;
    while (move > 0 && z.i < z.route.length - 1) {
      const [tx, ty] = z.route[z.i + 1], d = hyp(tx - z.x, ty - z.y);
      if (d <= move) { z.x = tx; z.y = ty; z.i++; move -= d; } else { z.x += (tx - z.x) / d * move; z.y += (ty - z.y) / d * move; move = 0; }
    }
    if (z.i >= z.route.length - 1) { if (z.leaving) W.zamboni = null; else z.done = true; return; }
    const [tx, ty] = z.route[Math.min(z.route.length - 1, z.i + 2)];
    z.h += angWrap(Math.atan2(ty - z.y, tx - z.x) - z.h) * (1 - Math.exp(-dt * 5));
    const on = z.x > 2 && z.x < RL - 2;
    if (on && z.t - (z.paintAt || 0) > 0.04) {
      z.paintAt = z.t;
      W.ice.resurface(z.x - Math.cos(z.h) * 5.6, z.y - Math.sin(z.h) * 5.6, ZW / 2, z.h);
      if (rand() < 0.4) W.burst('spray', z.x - Math.cos(z.h) * 5.8, z.y - Math.sin(z.h) * 5.8, 0.4, 1, 1.5, [0, 0, 0.6]);
      // what's left lying on the ice goes in under the front of it: sticks, gloves, and the rest
      const fx = z.x + Math.cos(z.h) * 4, fy = z.y + Math.sin(z.h) * 4, under = (x, y) => hyp(x - fx, y - fy) < ZW * 0.6;
      if (W.debris.some((d) => under(d.x, d.y))) W.debris = W.debris.filter((d) => !under(d.x, d.y));
      if (W.limbs.some((l) => under(l.pts[0].x, l.pts[0].y))) W.limbs = W.limbs.filter((l) => !under(l.pts[0].x, l.pts[0].y));
    }
  }

  // ── what the renderers draw ───────────────────────────────────────────────
  // THE PUCK AS DRAWN NEVER JUMPS. It is the sim's puck, except that it can't move farther in
  // a step than the hardest shot carries it (a slapshot is 108 ft/s): a puck put somewhere
  // instead of carried there is flown to it over a few frames, never cut to. And the world
  // is drawn between its last two steps (`W.alpha`, set by the view each frame), so a 120 Hz
  // world on a screen at any other rate moves evenly rather than in uneven hops: the puck
  // from `drawn0` to `drawn`, a man from `x0, y0` to `x, y`.
  const FASTEST = 150;
  function stepDrawn(dt) {
    const pk = W.puck, d = pk.drawn;
    if (!d || pk.hidden) { pk.drawn = [pk.x, pk.y, pk.z]; pk.drawn0 = [pk.x, pk.y, pk.z]; pk.trail = []; return; }
    pk.drawn0[0] = d[0]; pk.drawn0[1] = d[1]; pk.drawn0[2] = d[2];
    const ex = pk.x - d[0], ey = pk.y - d[1], ez = pk.z - d[2], e = hyp3(ex, ey, ez), lim = FASTEST * dt;
    if (e <= lim) { d[0] = pk.x; d[1] = pk.y; d[2] = pk.z; }
    else {
      // closed at the limit plus a share of what's left, so even a long way is flown in a
      // fraction of a second
      const k = Math.min(1, (lim + e * (1 - Math.exp(-dt * 10))) / e);
      d[0] += ex * k; d[1] += ey * k; d[2] += ez * k;
    }
    // where it was drawn over the last quarter second, and how fast it was going: the
    // glowing puck's comet tail (hud.js)
    if (W.t - (pk.trailAt ?? -1) >= 1 / 60) {
      pk.trailAt = W.t;
      const tr = pk.trail || (pk.trail = []);
      tr.push([d[0], d[1], d[2] + 0.08, hyp3(d[0] - pk.drawn0[0], d[1] - pk.drawn0[1], d[2] - pk.drawn0[2]) / dt]);
      if (tr.length > 15) tr.shift();
    }
  }
  W.alpha = 1;
  // ── going to the puck ─────────────────────────────────────────────────────
  // Where a man skating flat out meets the puck: it slows on its friction (or settles where a
  // dump was aimed), so this looks ahead along that, not along a straight line.
  W.intercept = (m, vmax = 24) => {
    const pk = W.puck, k = pk.z > 0.3 ? 0.05 : (pk.drag || 0.35);
    const at = (t) => { const f = (1 - Math.exp(-k * t)) / k; return [pk.x + pk.vx * f, pk.y + pk.vy * f]; };
    let p = [pk.x, pk.y];
    for (let i = 0; i < 5; i++) p = at(hyp(p[0] - m.x, p[1] - m.y) / vmax);
    const c = insideRink(p[0], p[1], 2); return c ? [c.x, c.y] : p;
  };
  // Can his stick get to it from where he's standing? The box his blade reaches in (rig.js
  // aims it at the puck there): ahead of him, out to the side either way, not behind.
  function inReach(m, x, y) {
    const ch = Math.cos(m.h), sn = Math.sin(m.h), dx = x - m.x, dy = y - m.y;
    const u = dx * ch + dy * sn, v = -dx * sn + dy * ch;
    return u > 0.6 && u < 3.4 && Math.abs(v) < 2.1;
  }
  W.inReach = inReach;
  // ROUND THE NET, NOT THROUGH IT. A man whose straight line to where he's going crosses a net
  // (with room for his body) goes round it: by its nearer corner, or by two when it's behind
  // it from where he is, whichever way is shorter. Returns the point to head for now and how
  // far it is to where he's going that way, so he eases up for the spot, not for a corner.
  // (the answer when no net is in the way, which is nearly always: kept, not made afresh
  // every step for every man, and read straight off by the caller)
  const STRAIGHT = [0, 0, 0];
  W.aroundNets = (m, tx, ty) => {
    for (const n of NETS) {
      const nx0 = Math.min(n.gx, n.gx + n.dir * NET_DEPTH), nx1 = Math.max(n.gx, n.gx + n.dir * NET_DEPTH);
      // (nowhere near this one)
      if (Math.max(m.x, tx) < nx0 - 4 || Math.min(m.x, tx) > nx1 + 4 || Math.max(m.y, ty) < MID_Y - NET_HALF - 4 || Math.min(m.y, ty) > MID_Y + NET_HALF + 4) continue;
      // (going to the net itself, its mouth or a post, he only goes round the frame, a foot
      // off it; otherwise round it with room for his body, or a foot off it if he's already
      // closer than that)
      const inside = (x, y, p) => x > nx0 - p && x < nx1 + p && y > MID_Y - NET_HALF - p && y < MID_Y + NET_HALF + p;
      let pad = inside(tx, ty, 2.6) ? 1.0 : 2.6;
      if (inside(m.x, m.y, pad)) pad = 1.0;
      if (inside(m.x, m.y, pad)) continue;
      const x0 = nx0 - pad, x1 = nx1 + pad, y0 = MID_Y - NET_HALF - pad, y1 = MID_Y + NET_HALF + pad;
      // (a spot inside the box, a puck tight to the back of the frame, is gone to by the
      // nearest point of the box's edge: there's no way round to a point inside it, and he
      // skated straight at the frame and stayed there)
      let gx = tx, gy = ty;
      if (gx > x0 && gx < x1 && gy > y0 && gy < y1) {
        const dl = gx - x0, dr = x1 - gx, dd = gy - y0, du = y1 - gy, mn = Math.min(dl, dr, dd, du);
        if (mn === dl) gx = x0 - 0.05; else if (mn === dr) gx = x1 + 0.05; else if (mn === dd) gy = y0 - 0.05; else gy = y1 + 0.05;
      }
      // does the segment cross the box? (clipped against it, Liang-Barsky)
      const crosses = (ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay;
        let t0 = 0, t1 = 1;
        for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
          if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
          const r = q / p;
          if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
        }
        return t0 < t1;
      };
      if (!crosses(m.x, m.y, gx, gy)) continue;
      // the corners, half a foot out, in order round the box; the way round by one corner or
      // by two neighbouring ones, the shortest that's clear
      const C = [[x0 - 0.5, y0 - 0.5], [x1 + 0.5, y0 - 0.5], [x1 + 0.5, y1 + 0.5], [x0 - 0.5, y1 + 0.5]];
      const L = (a, b) => hyp(b[0] - a[0], b[1] - a[1]), me = [m.x, m.y], to = [gx, gy];
      let best = null, bl = Infinity;
      for (let i = 0; i < 4; i++) {
        if (crosses(m.x, m.y, C[i][0], C[i][1])) continue;
        if (!crosses(C[i][0], C[i][1], gx, gy)) { const l = L(me, C[i]) + L(C[i], to); if (l < bl) { bl = l; best = C[i]; } }
        for (const j of [(i + 1) % 4, (i + 3) % 4]) {
          if (crosses(C[j][0], C[j][1], gx, gy)) continue;
          const l = L(me, C[i]) + L(C[i], C[j]) + L(C[j], to);
          if (l < bl) { bl = l; best = C[i]; }
        }
      }
      if (best) return [best[0], best[1], bl];
    }
    STRAIGHT[0] = tx; STRAIGHT[1] = ty; STRAIGHT[2] = hyp(tx - m.x, ty - m.y);
    return STRAIGHT;
  };
  // THE MAN GOES TO THE PUCK. Whoever is collecting it skates to where he'll meet it at full
  // speed and keeps his speed through it (`through`: no easing up as he gets there, which
  // read as a man creeping up on a puck), aiming so it comes onto his stick, not his skates.
  function pursue() {
    const pk = W.puck, h = pk.home;
    if (!h || pk.carrier || pk.held || !h.active || h.rag || h.blend || h.hold) return;
    if (pk.inNet) {
      const net = NETS.find((q) => q.side === pk.inNet);
      h.tx = net.gx - net.dir * 3.4; h.ty = MID_Y; h.maxV = 22; lendFace(h, net.dir > 0 ? 0 : Math.PI);
      return;
    }
    const p = W.intercept(h, 24), dx = p[0] - h.x, dy = p[1] - h.y, d = hyp(dx, dy) || 1e-6;
    // the blade is two feet ahead of him and a little to his forehand: aim his body short of it
    const back = Math.min(1.6, d * 0.5);
    h.tx = p[0] - dx / d * back; h.ty = p[1] - dy / d * back;
    // Flat out from far; close in, he comes onto it at its own speed and a bit (never under
    // 8 ft/s quicker than it), so he takes it in stride rather than creeping up on it or
    // flying past it and having to come round again.
    const pv = hyp(pk.vx, pk.vy);
    h.maxV = Math.min(24, pv + Math.max(8, d * 2.2));
    // (digging for it with a man on him, he stays on it rather than skating through)
    if (h.holdOff > W.t) h.maxV = Math.min(h.maxV, pv + 5);
    // close to it, he turns to face it, so his stick comes round to it (a puck dead against the
    // boards is beside a man skating along them, and he'd never get it in front of him)
    const dp = hyp(pk.x - h.x, pk.y - h.y);
    if (dp < 5) lendFace(h, Math.atan2(pk.y - h.y, pk.x - h.x)); else unface(h);
    h.through = W.t + 0.1;
  }
  // A PASS IS MET. A pass is played to where the man it's for is going to be, and if it'll
  // get to him there he skates on as he was. If it won't (he's changed course, or it was off),
  // he goes to the first point of its path he can be at before it is, flat out only if he
  // has to be, so he's on its line as it comes rather than skating across it and watching it
  // go by behind him.
  // (a man the director has scripted only does this when the play set him up to take it,
  // `meetPass`: a man skating to a hit or a box doesn't break off for a pass in the air)
  function meetPass() {
    const pk = W.puck, m = pk.target;
    if (!m || pk.carrier || pk.held || !m.active || m.rag || m.blend || m.hold) return;
    if (m.scripted && !(m.meetPass > W.t)) return;
    if (hyp(pk.vx, pk.vy) < 4) return;
    const k = pk.z > 0.3 ? 0.05 : (pk.drag || 0.35), f = (t) => (1 - Math.exp(-k * t)) / k;
    // (to his blade, where it was led, or into his skates; his blade the way he'll be facing,
    // as W.pass reckoned it)
    const hh = m.face != null ? m.face : hyp(m.vx, m.vy) > 6 ? Math.atan2(m.vy, m.vx) : m.h, ch = Math.cos(hh), sn = Math.sin(hh);
    for (let t = 0; t <= 2; t += 1 / 30) {
      const s = f(t), w = whereIn(m, t), px = pk.x + pk.vx * s, py = pk.y + pk.vy * s, b = bladeLocal(m, W.t + t, true);
      if (hyp(px - w[0], py - w[1]) < 1.2 || hyp(px - w[0] - b[0] * ch + b[1] * sn, py - w[1] - b[0] * sn - b[1] * ch) < 1.5) return;
    }
    for (let t = 0.05; t <= 2.5; t += 0.05) {
      const s = f(t), px = pk.x + pk.vx * s, py = pk.y + pk.vy * s, need = reachIn(m, px, py);
      if (need <= t) {
        m.tx = px; m.ty = py; m.maxV = Math.max(m.maxV || 0, 22);
        if (need > t - 0.12) m.through = W.t + 0.1;
        return;
      }
    }
    // nowhere he can beat it to: as near its line as he can get, in front of it
    const sp = hyp(pk.vx, pk.vy), ux = pk.vx / sp, uy = pk.vy / sp;
    const along = Math.max(0, (m.x - pk.x) * ux + (m.y - pk.y) * uy);
    m.tx = pk.x + ux * along; m.ty = pk.y + uy * along; m.maxV = Math.max(m.maxV || 0, 22);
  }
  // where to draw the puck this frame
  W.puckAt = () => {
    const pk = W.puck, d = pk.drawn, d0 = pk.drawn0, a = clamp(W.alpha ?? 1, 0, 1);
    return d && d0 ? [lerp(d0[0], d[0], a), lerp(d0[1], d[1], a), lerp(d0[2], d[2], a)] : [pk.x, pk.y, pk.z];
  };

  W.step = (dt) => {
    W.t += dt;
    for (const b of bodies()) { b.x0 = b.x; b.y0 = b.y; }
    while (W.ev.length && W.ev[0].t <= W.t) W.ev.shift().fn();
    if (W.script) W.script(dt);
    ambient(dt);
    officials(dt);
    // a man getting the puck skates to it, whatever his script or his position asked of him,
    // and a man a pass is for moves onto its line
    pursue();
    meetPass();
    // (the men on the ice don't change between here and the end of the step: listed once)
    const on = bodies();
    onIce = on;
    for (const b of on) if (b.kind !== 'goalie') stepBody(b, dt);
    onIce = null;
    separate(on);
    stepGoalie(W.goalie.a, dt); stepGoalie(W.goalie.h, dt);
    stepPuck(dt);
    stepDrawn(dt);
    stepDebris(dt);
    stepLimbs(dt);
    stepParts(dt); stepSpray(dt);
    stepZamboni(dt);
    W.ice.dry(dt);
    for (let i = 0; i < PANELS; i++) W.flex[i] *= Math.exp(-dt * 7);
    W.netBulge.a *= Math.exp(-dt * 4); W.netBulge.h *= Math.exp(-dt * 4);
    W.shake *= Math.exp(-dt * 6); W.boardShake *= Math.exp(-dt * 5);
    W.crowd = lerp(W.crowd, 0.15, 1 - Math.exp(-dt * 0.4));
    W.lamp = Math.max(0, W.lamp - dt);
    if (W.fight) for (const k of Object.keys(W.fight.pipShow)) W.fight.pipShow[k] = lerp(W.fight.pipShow[k], W.fight.pip[k], 1 - Math.exp(-dt * 10));
    if (W.stretcher) {
      const s = W.stretcher;
      s.x = (s.a.x + s.b.x) / 2; s.y = (s.a.y + s.b.y) / 2; s.h = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
    }
  };

  W.rigOf = (b) => (b.kind === 'goalie' ? goalieRig(b, W.t) : skaterRig(b, W.t));
  W.offGoal = offGoal; W.ownGoal = ownGoal; W.offBlue = offBlue; W.laneY = laneY; W.nearestOf = nearestOf;
  return W;
}
