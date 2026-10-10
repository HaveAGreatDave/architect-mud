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

import { TAU, V, clamp, lerp, angWrap, rng, hash } from './util.js';
import {
  RL, RW, MID_Y, BOARD_H, GLASS_H, GOAL_X, BLUE_X, NET_HALF, NET_DEPTH, NET_H,
  insideRink, attackDir, panelAt, PANELS, PANEL_X0, PANEL_W,
} from './geo.js';
import { DT, G, skaterRig, goalieRig, bladeWorld, makeRag, stepRag, makeLimb, stepLimb, SEVER } from './rig.js';

const SKINS = ['#e0b08c', '#c48d68', '#8f5e40', '#f0c9a8', '#a87454', '#6a4330', '#d9a27e'];
const HAIRS = ['#2a1c14', '#5a3a22', '#141210', '#8a6a3a', '#3b2a1e', '#c9b48a', '#6b2d16'];
const ROLE = ['LW', 'C', 'RW', 'LD', 'RD', 'F'];

export function makeBody(kind, side, slot, seed) {
  const r = rng(seed);
  return {
    kind, side, slot, seed: seed % 997, role: ROLE[slot] || 'F',
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
  const W = {
    t: 0, rand, ice,
    team: { a: [], h: [] }, goalie: { a: null, h: null }, officials: [], extras: [],
    puck: { x: 100, y: MID_Y, z: 0, vx: 0, vy: 0, vz: 0, carrier: null, target: null, held: null, passT0: 0, inNet: null, owner: null },
    parts: [], debris: [], limbs: [], stretcher: null, zamboni: null,
    flex: new Float32Array(PANELS), cracks: [], glassBlood: [], broken: new Set(),
    crowd: 0.15, shake: 0, boardShake: 0, hitstop: 0, lamp: 0, lampSide: null, mourning: 0, dim: 0,
    banner: null, fight: null,
    cam: { mode: 'broadcast', focus: [100, MID_Y], cut: 0, zoom: 1 },
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
  W.give = (b) => {
    const pk = W.puck;
    if (pk.carrier) pk.carrier.carrying = false;
    pk.carrier = b; pk.target = null; pk.held = null; pk.inNet = null;
    if (b) { b.carrying = true; pk.owner = b.side; if (b.kind === 'skater') W.amb.poss = b.side; }
  };
  W.loose = (vx, vy, vz = 0) => {
    const pk = W.puck;
    if (pk.carrier) pk.carrier.carrying = false;
    pk.carrier = null; pk.target = null; pk.held = null; pk.vx = vx; pk.vy = vy; pk.vz = vz;
  };
  W.pass = (from, to, spd = 70) => {
    const pk = W.puck;
    W.loose(0, 0);
    let tx = to.x, ty = to.y;
    for (let i = 0; i < 3; i++) {
      const d = Math.hypot(tx - pk.x, ty - pk.y), tt = d / spd;
      const b = bladeWorld(to, W.t + tt, true);
      tx = b[0] + to.vx * tt; ty = b[1] + to.vy * tt;
    }
    const c = insideRink(tx, ty, 1.5); if (c) { tx = c.x; ty = c.y; }
    const d = Math.hypot(tx - pk.x, ty - pk.y) || 1;
    pk.vx = (tx - pk.x) / d * spd; pk.vy = (ty - pk.y) / d * spd; pk.vz = 0;
    pk.target = to; pk.passT0 = W.t;
    W.sfx('pass');
  };
  W.shoot = (from, tgt, spd) => {
    const pk = W.puck;
    W.loose(0, 0);
    const d = Math.hypot(tgt[0] - pk.x, tgt[1] - pk.y) || 1, tt = d / spd;
    pk.vx = (tgt[0] - pk.x) / d * spd; pk.vy = (tgt[1] - pk.y) / d * spd; pk.vz = (tgt[2] - pk.z) / tt + (G / 2) * tt; pk.z = Math.max(pk.z, 0.05);
    W.burst('spray', pk.x, pk.y, 0.2, 8, 5, [0, 0, 2]);
    W.crowd = Math.max(W.crowd, 0.5);
    return tt;
  };
  W.dumpTo = (from, x, y, spd = 62) => {
    const pk = W.puck;
    W.loose(0, 0);
    const d = Math.hypot(x - pk.x, y - pk.y) || 1;
    pk.vx = (x - pk.x) / d * spd; pk.vy = (y - pk.y) / d * spd; pk.vz = 3;
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
        // inside: stop against the mesh
        const bx = clamp(pk.x, x0 + 0.15, x1 - 0.15), by = clamp(pk.y, y0 + 0.15, y1 - 0.15);
        if (bx !== pk.x || by !== pk.y) { pk.x = bx; pk.y = by; pk.vx *= -0.15; pk.vy *= -0.15; W.netBulge[n.side] = 1; }
        pk.z = Math.min(pk.z, NET_H - 0.3);
        continue;
      }
      if (pk.z > NET_H + 0.2) continue;
      const inside = pk.x > x0 - 0.2 && pk.x < x1 + 0.2 && pk.y > y0 - 0.2 && pk.y < y1 + 0.2;
      if (!inside) continue;
      const fromMouth = (pk.x - n.gx) * n.dir < 0.6 && pk.vx * n.dir > 0;
      if (fromMouth && W.allowGoal === n.side) { pk.inNet = n.side; W.netBulge[n.side] = 1; W.emit('goalIn', { side: n.side }); continue; }
      // the frame and the mesh push it back out the way it came
      if (fromMouth) { pk.vx = -pk.vx * 0.35; pk.x = n.gx - n.dir * 0.3; }
      else if (Math.abs(pk.y - MID_Y) > NET_HALF - 0.3) { pk.vy = -pk.vy * 0.5; pk.y = pk.y > MID_Y ? y1 + 0.3 : y0 - 0.3; }
      else { pk.vx = -pk.vx * 0.5; pk.x = n.dir > 0 ? x1 + 0.3 : x0 - 0.3; }
    }
  }
  function stepPuck(dt) {
    const pk = W.puck;
    if (pk.held) { const J = goalieRig(pk.held, W.t); const hnd = J[6]; pk.x = hnd[0]; pk.y = hnd[1]; pk.z = hnd[2]; pk.vx = pk.vy = pk.vz = 0; return; }
    if (pk.carrier) {
      const c = pk.carrier;
      if (!c.active || c.rag || !c.stick) { W.loose(c.vx * 0.6, c.vy * 0.6); }
      else { const b = bladeWorld(c, W.t, true); pk.x = b[0]; pk.y = b[1]; pk.z = 0; pk.vx = c.vx; pk.vy = c.vy; return; }
    }
    pk.vz -= G * dt; pk.z += pk.vz * dt;
    if (pk.z < 0) { pk.z = 0; pk.vz = pk.vz < -6 ? -pk.vz * 0.3 : 0; }
    if (pk.z === 0) { const f = Math.exp(-(pk.inNet ? 3 : 0.35) * dt); pk.vx *= f; pk.vy *= f; }
    pk.x += pk.vx * dt; pk.y += pk.vy * dt;
    const c = insideRink(pk.x, pk.y, 0.3);
    if (c && pk.z < GLASS_H) {
      const vn = pk.vx * c.nx + pk.vy * c.ny;
      pk.x = c.x; pk.y = c.y;
      if (vn < 0) {
        pk.vx -= 1.55 * vn * c.nx; pk.vy -= 1.55 * vn * c.ny;
        if (-vn > 18) { W.sfx(pk.z > BOARD_H ? 'glass' : 'boards'); W.boardShake = Math.max(W.boardShake, Math.min(0.5, -vn / 120)); }
      }
    }
    puckNets(pk);
    for (const d of W.limbs) {
      // the puck can hit what's lying on the ice
      for (const p of d.pts) {
        const dx = pk.x - p.x, dy = pk.y - p.y, dd = Math.hypot(dx, dy);
        if (dd < p.r + 0.3 && pk.z < 0.8 && dd > 0.01) { const vn = (pk.vx * dx + pk.vy * dy) / dd; if (vn < 0) { pk.vx -= 1.6 * vn * dx / dd; pk.vy -= 1.6 * vn * dy / dd; p.px -= vn * dx / dd * DT * 0.3; p.py -= vn * dy / dd * DT * 0.3; } }
      }
    }
    if (pk.target) {
      const tg = pk.target, b = bladeWorld(tg, W.t, true);
      if ((Math.hypot(b[0] - pk.x, b[1] - pk.y) < 2.6 && pk.z < 1.2) || W.t - pk.passT0 > 1.6) { if (tg.active && !tg.rag && tg.stick) { W.give(tg); W.sfx('receive'); } else pk.target = null; }
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
  function stepParts(dt) {
    for (let i = W.parts.length - 1; i >= 0; i--) {
      const p = W.parts[i]; p.life += dt;
      const g = p.type === 'spray' ? 10 : G;
      if (p.type === 'spray') { p.vx *= 0.94; p.vy *= 0.94; }
      p.vz -= g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const c = insideRink(p.x, p.y, 0.05);
      if (c && p.z < GLASS_H) { p.x = c.x; p.y = c.y; p.vx *= -0.2; p.vy *= -0.2; }
      if (p.z <= 0) {
        if (p.type === 'blood') { W.ice.blood(p.x, p.y, p.size * (2.4 + rand() * 1.5), 0.8, (p.x * 1e3 + p.y * 7) | 0); W.parts.splice(i, 1); continue; }
        if (p.type === 'spray' || p.type === 'sweat') { W.parts.splice(i, 1); continue; }
        p.z = 0; p.vz = -p.vz * 0.3; p.vx *= 0.6; p.vy *= 0.6;
      }
      if (p.life > p.max) W.parts.splice(i, 1);
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
      if (onIce && l.age < 6 && Math.hypot(l.pts[0].x - ox, l.pts[0].y - oy) > 0.004) W.ice.smear(ox, oy, l.pts[0].x, l.pts[0].y, 0.22, 0.35);
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
    b.blend = null; b.act = null; b.guard = false; b.grab = null; b.carrying = false;
    W.sfx('fall');
  };
  W.getUp = (b, dur = 1.1) => {
    if (!b.rag) return;
    const pts = b.rag.pts.map((p) => [p.x, p.y, p.z]);
    b.x = b.rag.pts[0].x; b.y = b.rag.pts[0].y; b.vx = b.vy = 0;
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

  function stepBody(b, dt) {
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
      if (r.age - r.smearAt > 0.06 && Math.hypot(p0.x - p0.px, p0.y - p0.py) / dt > 4 && b.bleeding > 0) { r.smearAt = r.age; W.ice.smear(p0.px, p0.py, p0.x, p0.y, 0.4, 0.25); }
    } else {
      if (b.blend) { b.blend.t += dt / b.blend.dur; if (b.blend.t >= 1) b.blend = null; }
      const dx = b.tx - b.x, dy = b.ty - b.y, dist = Math.hypot(dx, dy);
      const want = b.blend ? 0 : Math.min(b.maxV, dist * 1.8);
      let dvx = (dist > 0.01 ? dx / dist * want : 0) - b.vx, dvy = (dist > 0.01 ? dy / dist * want : 0) - b.vy;
      const dv = Math.hypot(dvx, dvy), maxdv = b.acc * dt;
      if (dv > maxdv) { dvx *= maxdv / dv; dvy *= maxdv / dv; }
      b.vx += dvx; b.vy += dvy; b.x += b.vx * dt; b.y += b.vy * dt;
      const sp = Math.hypot(b.vx, b.vy);
      const pushing = dv > maxdv * 0.6 && want > sp - 0.5;
      b.effort = lerp(b.effort, pushing ? 1 : 0.3, 1 - Math.exp(-dt * 3));
      const ampWant = b.kind === 'official' || b.kind === 'medic' ? clamp(sp / 18, 0, 0.8) : clamp(sp / 22, 0, 1) * b.effort;
      b.amp = lerp(b.amp, b.guard ? 0 : ampWant, 1 - Math.exp(-dt * 5));
      b.phase += dt * (0.5 + sp * 0.032);
      const wantH = b.face != null ? b.face : (sp > 1.5 ? Math.atan2(b.vy, b.vx) : b.h);
      b.h += clamp(angWrap(wantH - b.h), -7 * dt, 7 * dt);
      // how hard he is turning: drives the lean and the crossovers in the rig
      const va = sp > 2 ? Math.atan2(b.vy, b.vx) : null;
      const tr = va != null && b._va != null ? angWrap(va - b._va) / dt : 0;
      b.turnRate = lerp(b.turnRate || 0, tr, 1 - Math.exp(-dt * 6)); b._va = va;
      const c = insideRink(b.x, b.y, 1.6);
      if (c) { b.x = c.x; b.y = c.y; const vn = b.vx * c.nx + b.vy * c.ny; if (vn < 0) { b.vx -= vn * c.nx; b.vy -= vn * c.ny; } }
      // a hard stop throws snow
      if (dv / dt > 20 && sp > 7 && !pushing && W.t - b.sprayAt > 0.25 && b.kind !== 'medic') {
        b.sprayAt = W.t; W.burst('spray', b.x + b.vx * 0.05, b.y + b.vy * 0.05, 0.2, 7, 5, [b.vx * 0.4, b.vy * 0.4, 2.5]);
        if (sp > 14 && rand() < 0.4) W.sfx('stop', { x: b.x });
      }
      // the blades score the ice
      if (sp > 4 && W.t - b.cutAt > 0.09) {
        b.cutAt = W.t;
        const side = Math.sin(b.phase * TAU) > 0 ? 1 : -1, n = [-Math.sin(b.h) * side * 0.6, Math.cos(b.h) * side * 0.6];
        const f = [b.x + n[0], b.y + n[1]];
        if (b.lastFoot && Math.hypot(f[0] - b.lastFoot[0], f[1] - b.lastFoot[1]) < 6) W.ice.cut(b.lastFoot[0], b.lastFoot[1], f[0], f[1], b.missing.legL || b.missing.legR ? 0.3 : 0.1);
        b.lastFoot = f;
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
    g.track = [pk.x, pk.y, pk.z];
    if (!g.scripted) {
      // out to cut the angle when the play is far, back to the post when it's in tight
      const dist = Math.hypot(pk.x - gx, pk.y - MID_Y);
      const out = clamp(dist * 0.08, 1.2, 4.2);
      const ang = Math.atan2(pk.y - MID_Y, (pk.x - gx) * dir);
      const tx = gx + dir * Math.cos(clamp(ang, -1.2, 1.2)) * out, ty = MID_Y + Math.sin(clamp(ang, -1.2, 1.2)) * out * 0.9;
      g.x += (tx - g.x) * (1 - Math.exp(-dt * 7)); g.y += (ty - g.y) * (1 - Math.exp(-dt * 8));
      const base = dir > 0 ? 0 : Math.PI;
      const wantH = base + clamp(angWrap(Math.atan2(pk.y - g.y, pk.x - g.x) - base), -0.8, 0.8);
      g.h += clamp(angWrap(wantH - g.h), -6 * dt, 6 * dt);
      const near = Math.hypot(pk.x - g.x, pk.y - g.y) < 22;
      g.bfly = lerp(g.bfly, near && pk.z < 0.5 && !pk.carrier ? 0.25 : 0, 1 - Math.exp(-dt * 4));
    } else {
      g.x += (g.tx - g.x) * (1 - Math.exp(-dt * 9)); g.y += (g.ty - g.y) * (1 - Math.exp(-dt * 9));
      if (g.face != null) g.h += clamp(angWrap(g.face - g.h), -7 * dt, 7 * dt);
    }
    g.vx = lerp(g.vx || 0, (g.x - gx0) / dt, 1 - Math.exp(-dt * 10)); g.vy = lerp(g.vy || 0, (g.y - gy0) / dt, 1 - Math.exp(-dt * 10));
    // with the play at the far end he keeps himself busy: taps a post, stretches
    if (!g.scripted && !g.act && Math.abs(pk.x - gx) > 120 && rand() < dt * 0.08) W.act(g, rand() < 0.6 ? 'tapPosts' : 'stretch', rand() < 0.6 ? 1.4 : 2.4);
    if (pk.held !== g && g.gloveW > 0 && !g.gloveHold) g.gloveW = Math.max(0, g.gloveW - dt * 1.5);
    g.phase += dt * 0.3;
    if (g.act) { g.actT += dt / g.actDur; if (g.actT >= 1) { g.act = g.actHold ? g.act : null; if (!g.actHold) g.actT = 0; else g.actT = 1; } }
  }
  function separate() {
    const sk = bodies().filter((b) => b.kind !== 'goalie');
    for (let i = 0; i < sk.length; i++) for (let j = i + 1; j < sk.length; j++) {
      const a = sk[i], b = sk[j];
      if (a.rag || b.rag || a.foe === b || a.target === b || b.target === a) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < 2.4 && d > 0.01) { const k = (2.4 - d) / d * 0.5; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
    }
    // nobody skates through a net or stands in it
    for (const b of sk) {
      if (b.rag) continue;
      for (const n of NETS) {
        const cx = n.gx + n.dir * NET_DEPTH / 2, hx = NET_DEPTH / 2 + 1.2, hy = NET_HALF + 1.2;
        const dx = b.x - cx, dy = b.y - MID_Y;
        if (Math.abs(dx) < hx && Math.abs(dy) < hy) {
          if (hx - Math.abs(dx) < hy - Math.abs(dy)) b.x = cx + Math.sign(dx || 1) * hx; else b.y = MID_Y + Math.sign(dy || 1) * hy;
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
    for (const b of list) { if (b === except || b.rag || b.scripted || !b.active) continue; const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  function ambient(dt) {
    const pk = W.puck, A = W.amb;
    const carrier = pk.carrier;
    const free = !W.puckScripted && !W.frozen;
    // a goalie with it plays it up to a defenceman
    if (free && pk.held && W.t > A.holdUntil) {
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
      for (const m of team) {
        if (m.scripted || m.rag || m.blend) continue;
        const isD = m.slot === 3 || m.slot === 4;
        let tx, ty, mv = 19;
        m.face = null;
        if (W.frozen) {
          // whistle: coast to a stop and drift toward the play
          tx = m.x + m.vx * 0.5; ty = m.y + m.vy * 0.5; mv = 6;
        } else if (m === carrier) {
          const inZone = (m.x - offBlue(side)) * dir > 0;
          if (!inZone) { tx = m.x + dir * 30; ty = laneY(side, m.slot) * 0.6 + MID_Y * 0.4 + Math.sin(W.t * 0.9 + m.seed) * 9; mv = 23; }
          else {
            // cycle: down the wall to below the dots, behind the net line, back up the half-wall
            const ph = (W.t * 0.18 + m.seed * 0.1) % 1;
            const wall = m.y > MID_Y ? RW - 9 : 9;
            const gx = offGoal(side);
            if (ph < 0.4) { tx = gx - dir * 22; ty = wall; } else if (ph < 0.7) { tx = gx - dir * 6; ty = lerp(wall, MID_Y, 0.4); } else { tx = gx - dir * 34; ty = lerp(wall, MID_Y, 0.25); }
            mv = 17;
          }
        } else if (loose && (m === fore || Math.hypot(m.x - pk.x, m.y - pk.y) < 10)) {
          tx = pk.x + pk.vx * 0.3; ty = pk.y + pk.vy * 0.3; mv = 26;
        } else if (attacking) {
          const inZone = (pk.x - offBlue(side)) * dir > 0;
          if (isD) {
            tx = inZone ? offBlue(side) + dir * 4 : pk.x - dir * 22; ty = laneY(side, m.slot);
            if (inZone) m.face = dir > 0 ? 0 : Math.PI;
          } else {
            tx = clamp(pk.x + dir * (8 + 6 * (m.slot === 1 ? 0.5 : 1)), Math.min(ownGoal(side), offGoal(side)) + 14, Math.max(ownGoal(side), offGoal(side)) - 14);
            if (inZone) tx = offGoal(side) - dir * (14 + (m.slot === 1 ? 10 : 4));
            ty = laneY(side, m.slot) + Math.sin(W.t * 0.7 + m.seed) * 5;
          }
          mv = 21;
        } else if (m === fore) {
          const c2 = carrier || pk;
          tx = c2.x - dir * 1.5; ty = c2.y; mv = 24;
        } else {
          // mark: stand between your man and your own net, the D closer to the net
          const man = opp.find((o) => o.slot === m.slot) || opp[m.slot % Math.max(1, opp.length)];
          const g = ownGoal(side);
          if (man) {
            const k = isD ? 0.45 : 0.22;
            tx = lerp(man.x, g + dir * 8, k); ty = lerp(man.y, MID_Y, k);
            if (isD) { m.face = Math.atan2(pk.y - m.y, pk.x - m.x); }
          } else { tx = g + dir * 20; ty = laneY(side, m.slot); }
          mv = 20;
        }
        const c = insideRink(tx, ty, 2.5); if (c) { tx = c.x; ty = c.y; }
        m.tx = tx; m.ty = ty; m.maxV = mv; m.acc = 26;
        // what he does with his stick and his eyes
        m.protect = 0; m.defend = null; m.look = null;
        if (m === carrier) {
          const th = nearestOf(opp, m.x, m.y);
          if (th && Math.hypot(th.x - m.x, th.y - m.y) < 5.5) {
            const lv = -(th.x - m.x) * Math.sin(m.h) + (th.y - m.y) * Math.cos(m.h);
            m.protect = lv >= 0 ? 1 : -1;
          }
        } else if (carrier && carrier.side !== side && Math.hypot(m.x - pk.x, m.y - pk.y) < 13) {
          m.defend = [pk.x, pk.y];
        } else if (pk.target === m || (carrier && carrier.side === side && Math.hypot(m.x - pk.x, m.y - pk.y) < 40)) {
          m.look = [pk.x, pk.y, 0.2];
        }
      }
      if (!free) continue;
      // possession: pick up a loose puck
      if (loose && pk.z < 1) {
        for (const m of team) {
          if (m.scripted || m.rag || m.blend || !m.stick) continue;
          const b = bladeWorld(m, W.t, true);
          if (Math.hypot(b[0] - pk.x, b[1] - pk.y) < 2.2 && Math.hypot(pk.vx, pk.vy) < 45) { W.give(m); W.sfx('receive'); break; }
        }
      }
      // the forechecker takes it back
      if (carrier && carrier.side !== side && fore && !fore.scripted && W.t - A.lastTurn > 4.5) {
        const d = Math.hypot(fore.x - carrier.x, fore.y - carrier.y);
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
      A.nextPass = W.t + 1.3 + rand() * 2.2;
      const team = W.mates(side).filter((m) => m !== carrier && !m.scripted && !m.rag && !m.blend && m.stick);
      const opp = W.mates(side === 'a' ? 'h' : 'a');
      const neutral = Math.abs(carrier.x - RL / 2) < 18;
      const press = opp.some((o) => Math.hypot(o.x - carrier.x, o.y - carrier.y) < 7);
      if (neutral && press && rand() < 0.35) {
        // dump it in and go get it
        const cy = carrier.y > MID_Y ? RW - 6 : 6;
        W.act(carrier, 'dump', 0.45);
        W.schedule(0.2, () => { if (W.puck.carrier === carrier) W.dumpTo(carrier, offGoal(side) + dir * 4, cy, 64); });
        return;
      }
      let best = null, bs = -1e9;
      for (const m of team) {
        const open = Math.min(20, ...opp.map((o) => Math.hypot(o.x - m.x, o.y - m.y)));
        const fwd = (m.x - carrier.x) * dir;
        const d = Math.hypot(m.x - carrier.x, m.y - carrier.y);
        if (d < 8 || d > 70) continue;
        const sc = open * 1.2 + clamp(fwd, -20, 25) * 0.4 + rand() * 6;
        if (sc > bs) { bs = sc; best = m; }
      }
      // a man standing him up in front: beat him with the hands instead of moving it
      const front = opp.find((o) => !o.rag && Math.hypot(o.x - carrier.x, o.y - carrier.y) < 7 && ((o.x - carrier.x) * Math.cos(carrier.h) + (o.y - carrier.y) * Math.sin(carrier.h)) > 1.5);
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
        const lane = opp.some((o) => { const t = clamp(((o.x - carrier.x) * (to.x - carrier.x) + (o.y - carrier.y) * (to.y - carrier.y)) / ((to.x - carrier.x) ** 2 + (to.y - carrier.y) ** 2 || 1), 0, 1); return Math.hypot(carrier.x + (to.x - carrier.x) * t - o.x, carrier.y + (to.y - carrier.y) * t - o.y) < 3; });
        const kind = lu < -3 ? 'drop' : lane ? 'saucer' : lv < -4 && lu < 8 ? 'backpass' : 'pass';
        W.act(carrier, kind, kind === 'drop' ? 0.32 : 0.32);
        carrier.look = [to.x, to.y, 1];
        W.schedule(0.11, () => {
          if (W.puck.carrier !== carrier) return;
          const spd = kind === 'drop' ? 18 : 62 + rand() * 18;
          W.pass(carrier, to, spd);
          if (kind === 'saucer') W.puck.vz = 7;
          const tt = Math.hypot(to.x - carrier.x, to.y - carrier.y) / spd;
          if (!to.scripted) W.act(to, 'receive', tt + 0.25, [carrier.x, carrier.y]);
          // a pass through traffic can be picked off
          const pk2 = W.puck;
          for (const o of opp) {
            if (o.scripted || o.rag) continue;
            const t = clamp(((o.x - pk2.x) * pk2.vx + (o.y - pk2.y) * pk2.vy) / (pk2.vx * pk2.vx + pk2.vy * pk2.vy || 1), 0, 1.2);
            const px = pk2.x + pk2.vx * t, py = pk2.y + pk2.vy * t;
            if (Math.hypot(o.x - px, o.y - py) < 2.4 && rand() < 0.3) { pk2.target = o; break; }
          }
        });
      }
    }
  }

  function officials(dt) {
    const pk = W.puck;
    W.officials.forEach((o, i) => {
      if (o.scripted || o.rag) return;
      const far = i === 0;
      const tx = clamp(pk.x + (far ? -14 : 16), 30, RL - 30), ty = far ? RW - 6 : 6.5;
      o.tx = tx; o.ty = ty; o.maxV = 18; o.face = Math.atan2(pk.y - o.y, pk.x - o.x);
      if (Math.hypot(o.x - pk.x, o.y - pk.y) < 8) { o.ty = o.y > MID_Y ? RW - 4 : 4; }
    });
  }

  function stepZamboni(dt) {
    const z = W.zamboni; if (!z) return;
    z.t += dt;
    // laps round the sheet, tightening, laying fresh ice behind it
    const lap = z.t * 0.05, k = lap % 1, ring = Math.floor(lap) % 4;
    const ix = 34 + ring * 7, iy = 14 + ring * 5;
    const per = 2 * (RL - 2 * ix) + 2 * (RW - 2 * iy), d = k * per;
    let x, y, h;
    if (d < RL - 2 * ix) { x = ix + d; y = iy; h = 0; }
    else if (d < RL - 2 * ix + RW - 2 * iy) { x = RL - ix; y = iy + (d - (RL - 2 * ix)); h = Math.PI / 2; }
    else if (d < 2 * (RL - 2 * ix) + RW - 2 * iy) { x = RL - ix - (d - (RL - 2 * ix + RW - 2 * iy)); y = RW - iy; h = Math.PI; }
    else { x = ix; y = RW - iy - (d - (2 * (RL - 2 * ix) + RW - 2 * iy)); h = -Math.PI / 2; }
    z.x = x; z.y = y; z.h = lerp(z.h, h, 0.08);
    if (z.t - (z.paintAt || 0) > 0.05) { z.paintAt = z.t; W.ice.resurface(x - Math.cos(h) * 6, y - Math.sin(h) * 6, 4.5); }
  }

  W.step = (dt) => {
    W.t += dt;
    while (W.ev.length && W.ev[0].t <= W.t) W.ev.shift().fn();
    if (W.script) W.script(dt);
    ambient(dt);
    officials(dt);
    for (const b of bodies()) if (b.kind !== 'goalie') stepBody(b, dt);
    separate();
    stepGoalie(W.goalie.a, dt); stepGoalie(W.goalie.h, dt);
    stepPuck(dt);
    stepDebris(dt);
    stepLimbs(dt);
    stepParts(dt);
    stepZamboni(dt);
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
