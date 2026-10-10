// Rinkside · the director. Turns one broadcast payload into choreography in a world.
//
// The sim on the server already decided everything: who shot, from where, what the goalie
// did with it, who hit whom and what it broke, who won the fight and how. A payload is
// those facts. This file stages them: it takes the men and the puck it needs off the
// ambient hockey in sim.js, walks them through the beat, and hands them back.
//
// THE OUTCOME IS NEVER IN DOUBT. A shot is aimed at the place its outcome needs: into the
// net through the mouth for a goal, into the goalie's glove for a glove save, at the post
// for a post. The net only lets a puck in when this file opens it (`W.allowGoal`), so the
// picture can't score a goal the sim didn't.
//
// ONE BEAT AT A TIME. A new payload can arrive before the last one has finished (a line
// is ten seconds, a stretcher takes longer). Each beat leaves a `cleanup` that jumps its
// lasting consequences to the end (the man carried off, the fighter in the box), so the
// next beat starts from a world that agrees with what was said.
//
// `onLand` fires at the moment the play lands (the shot arrives, the hit lands, the last
// punch). The view holds the announcer's line until then, so the words and the picture
// arrive together.

import { clamp, lerp, angWrap, rng, hash } from './util.js';
import { RL, RW, MID_Y, GOAL_X, NET_HALF, NET_H, DOT_FT, attackDir, insideRink } from './geo.js';
import { SHOTS, releaseAt, bladeWorld, skaterRig } from './rig.js';
import { makeBody } from './sim.js';

// What each outcome is called on screen. The broadcast regress checks every save kind the
// sim can emit has an entry here.
export const SAVE = {
  save: { label: 'Save' }, glove: { label: 'Glove Save' }, pad: { label: 'Pad Save' },
  blocked: { label: 'Blocked' }, wide: { label: 'Wide' }, post: { label: 'Off the Post' },
  breakaway: { label: 'Breakaway Stopped' }, goal: { label: 'GOAL' },
};

const other = (s) => (s === 'a' ? 'h' : 'a');
const surname = (n) => String(n || '').trim().split(/\s+/).pop();
const numFor = (key) => 2 + (hash(`num:${key}`) % 97);

function hexMix(hex, f) {
  const n = parseInt(String(hex || '#808080').slice(1, 7), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
const lum = (hex) => { const n = parseInt(String(hex).slice(1, 7), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

// A club's two colours as a kit. The home side wears its colour; the road side wears white
// with its colour as trim, which is what keeps two dark clubs apart on the ice.
export function kitFor(colours, side, name) {
  const [c0, c1raw] = Array.isArray(colours) && colours.length ? colours : side === 'a' ? ['#c8382f', '#f2e4d0'] : ['#2f6fd0', '#e8f1fb'];
  const c1 = lum(c1raw || '#ffffff') > 0.6 ? c1raw : '#f1efe8';
  const crest = ['v', 'd', 'o'][hash(name || side) % 3];
  if (side === 'a') return { jersey: c1, trim: c0, pants: hexMix(c0, -0.55), sock: c1, glove: hexMix(c0, -0.3), helmet: c0, crest };
  return { jersey: c0, trim: c1, pants: hexMix(c0, -0.6), sock: c0, glove: hexMix(c0, -0.35), helmet: hexMix(c0, -0.15), crest };
}

export function createDirector(W, opts = {}) {
  const pk = W.puck;
  const D = { beat: null, names: { a: new Map(), h: new Map() }, mournTo: 0, kitsFor: '', needCut: true, tasks: [] };
  // Things that outlive the beat that started them: a man skating to the box, a stretcher
  // on its way off. They tick until done, and a camera cut finishes them on the spot,
  // since nobody sees the jump.
  const medics = [0, 1].map((i) => { const m = makeBody('medic', 'o', i, 4242 + i); m.active = false; m.stick = false; m.maxV = 14; W.extras.push(m); return m; });

  // default dress and numbers, so the first frame is a hockey game
  W.kits.a = W.kits.a || kitFor(null, 'a'); W.kits.h = W.kits.h || kitFor(null, 'h');
  for (const side of ['a', 'h']) {
    W.team[side].forEach((b) => { b.num = numFor(`${side}${b.slot}`); });
    W.goalie[side].num = 30 + (hash(side) % 9);
  }
  W.officials.forEach((o, i) => { o.num = [27, 44][i]; });

  // ── who is who ────────────────────────────────────────────────────────────
  // A name is put on a body the first time a payload mentions it and stays there, so the
  // man who scored is still wearing his number when he fights two minutes later. The
  // number is derived from the name, so every viewer sees the same sweater.
  function nameBody(b, name) {
    if (!b || !name) return b;
    const map = D.names[b.side];
    if (!map) return b;
    for (const [n, x] of map) if (x === b && n !== name) map.delete(n);
    const prev = map.get(name);
    if (prev && prev !== b) { prev.name = ''; prev.num = numFor(`${prev.side}${prev.slot}${prev.seed}`); }
    map.set(name, b);
    b.name = surname(name); b.num = numFor(name);
    if (D.beat) D.beat.locked.add(b);
    return b;
  }
  function bodyFor(side, name, prefer) {
    const map = D.names[side];
    const ok = (b) => b && b.active && !b.hold && !busyBody(b) && W.team[side].includes(b);
    if (name && ok(map.get(name))) return map.get(name);
    const pool = W.team[side].filter(ok);
    if (!pool.length) return null;
    let b = ok(prefer) ? prefer : null;
    if (!b) {
      const free = pool.filter((x) => !(D.beat && D.beat.locked.has(x)));
      const list = free.length ? free : pool;
      b = list[hash(name || 'x') % list.length];
    }
    return nameBody(b, name);
  }
  const sideOfTeam = (team, p) => (team && team === p.awayTeam ? 'a' : team && team === p.homeTeam ? 'h' : null);
  const tagSide = (tag) => (tag === 'att' ? 'a' : tag === 'def' ? 'h' : null);

  function dress(p) {
    const key = `${p.awayTeam || ''}|${p.homeTeam || ''}`;
    if (key === D.kitsFor) return;
    D.kitsFor = key;
    W.kits.a = kitFor(p.awayColours, 'a', p.awayTeam);
    W.kits.h = kitFor(p.homeColours, 'h', p.homeTeam);
    D.names.a.clear(); D.names.h.clear();
    for (const side of ['a', 'h']) W.team[side].forEach((b) => { b.name = ''; b.num = numFor(`${key}${side}${b.slot}`); });
  }

  // ── beats ─────────────────────────────────────────────────────────────────
  function begin(kind) {
    const prev = D.beat;
    if (prev) { prev.cleanup?.(); releaseAll(); }
    W.clearSchedule();
    const B = { kind, t0: W.t, update: null, cleanup: null, landed: false, locked: new Set(), ownsCam: false };
    D.beat = B;
    return B;
  }
  const at = (B, dt, fn) => W.schedule(dt, () => { if (D.beat === B) fn(); });
  function land(B) { if (B.landed) return; B.landed = true; opts.onLand?.(B.kind); }
  function finish(B) {
    if (D.beat !== B) return;
    land(B);
    B.finishTo?.();
    D.beat = null;
    releaseAll();
    opts.onDone?.(B.kind);
  }
  function releaseAll() {
    for (const b of [...W.team.a, ...W.team.h, W.goalie.a, W.goalie.h, ...W.officials]) {
      if (!b || busyBody(b)) continue;
      b.scripted = false; b.face = null; b.guard = false; b.grab = null; b.foe = null; b.target = null; b.stance = 0;
      if (b.kind === 'goalie') { b.gloveHold = false; b.actHold = false; }
    }
    W.puckScripted = false; W.frozen = false; W.allowGoal = false;
    W.cam.mode = 'broadcast';
  }
  function cut(mode, focus, flash = false) {
    W.cam.mode = mode || 'broadcast'; if (focus) W.cam.focus = focus; W.cam.cut++; W.cam.flash = flash;
    flushTasks();
  }
  function flushTasks() { const t = D.tasks; D.tasks = []; for (const k of t) k.flush(); }
  const busyBody = (b) => D.tasks.some((k) => k.bodies && k.bodies.includes(b));
  // off to the gate on the near side, and the spare comes on in his place
  function leave(b, gx) {
    if (!b || !b.active || busyBody(b)) return;
    const x = clamp(gx ?? b.x, 40, RL - 40);
    b.scripted = true; b.foe = null; b.grab = null; b.guard = false; b.face = null;
    const k = {
      bodies: [b],
      tick() { if (!b.active) return true; b.scripted = true; b.tx = x; b.ty = 1.6; b.maxV = 12; if (b.y < 3.4) { const nb = substitute(b); nb.scripted = false; return true; } return false; },
      flush() { if (b.active) substitute(b); },
    };
    D.tasks.push(k);
  }
  function place(b, x, y, h) {
    const c = insideRink(x, y, 2); if (c) { x = c.x; y = c.y; }
    b.x = b.tx = x; b.y = b.ty = y; b.vx = b.vy = 0; if (h != null) b.h = h;
    b.rag = null; b.blend = null; b.act = null; b.actT = 0; b.feet = null; b._va = null; b.turnRate = 0; b.amp = 0;
  }
  function fresh(b) {
    W.reequip(b); b.rag = null; b.blend = null; b.hold = null; b.down = false; b.missing = {}; b.blood = 0; b.bleeding = 0; b.fountain = null;
    b.jerseyUp = 0; b.react = 0; b.act = null; b.scripted = false; b.shatterNext = false;
  }
  function whistle() { W.sfx('whistle'); W.frozen = true; }
  // back on his feet, he picks his stick up off the ice
  function pickUpStick(b) {
    let best = -1, bd = 1e9;
    W.debris.forEach((d, i) => { if (d.kind === 'stick' && d.side === b.side) { const dd = Math.hypot(d.x - b.x, d.y - b.y); if (dd < bd) { bd = dd; best = i; } } });
    if (best >= 0 && bd < 25) W.debris.splice(best, 1);
    b.stick = true;
  }

  // A man leaves the ice (the box, the stretcher, the bench) and the spare comes on in his
  // place, at the gate he left by.
  function substitute(b) {
    const side = b.side, bench = W.team[side].find((x) => !x.active && x !== b);
    b.carrying = false; if (pk.carrier === b) W.loose(0, 0);
    if (!bench) { fresh(b); return b; }
    const slot = b.slot, role = b.role;
    b.slot = bench.slot; b.role = bench.role; bench.slot = slot; bench.role = role;
    b.active = false; b.hold = null; b.rag = null;
    for (const [n, x] of D.names[side]) if (x === b) D.names[side].delete(n);
    fresh(bench);
    bench.active = true; place(bench, b.x, Math.min(b.y, 3), Math.PI / 2);
    bench.name = ''; bench.num = numFor(`${side}${slot}${bench.seed}${W.t | 0}`);
    return bench;
  }

  // How many skaters a side should have dressed on the ice. Applied only at a cut, so
  // nobody blinks in or out on camera.
  function setCounts(att, strength) {
    const want = { a: 5, h: 5 };
    if (strength === 'pp') want[other(att)] = 4;
    if (strength === 'sh') want[att] = 4;
    for (const side of ['a', 'h']) {
      if (W.pulled[side]) want[side] += 1;
      const on = W.team[side].filter((b) => b.active);
      on.sort((p, q) => q.slot - p.slot);
      while (on.length > want[side]) { const b = on.shift(); b.active = false; if (pk.carrier === b) W.loose(0, 0); }
      const off = W.team[side].filter((b) => !b.active);
      while (W.team[side].filter((b) => b.active).length < want[side] && off.length) { const b = off.shift(); fresh(b); b.active = true; }
      W.goalie[side].active = !W.pulled[side];
    }
  }

  // Everyone where a rush starting at (x, y) needs them: the side with it spread behind and
  // beside the carrier, the other side between him and its own net.
  function setUp(att, x, y, carrier) {
    flushTasks();
    const dir = attackDir(att), def = other(att);
    const r = rng(hash(`${x | 0}${y | 0}${W.t | 0}`));
    for (const m of W.mates(att)) {
      if (m === carrier) { place(m, x, y, dir > 0 ? 0 : Math.PI); continue; }
      const isD = m.slot === 3 || m.slot === 4;
      const dx = isD ? -dir * (12 + r() * 8) : dir * (2 + r() * 10);
      place(m, clamp(x + dx, 18, RL - 18), lerp(W.laneY(att, m.slot), y, 0.25) + (r() - 0.5) * 6, dir > 0 ? 0 : Math.PI);
    }
    for (const m of W.mates(def)) {
      const isD = m.slot === 3 || m.slot === 4;
      const dx = isD ? dir * (26 + r() * 10) : dir * (8 + r() * 12);
      place(m, clamp(x + dx, 18, RL - 18), lerp(W.laneY(def, m.slot), y, 0.35) + (r() - 0.5) * 6, dir > 0 ? Math.PI : 0);
    }
    for (const side of ['a', 'h']) {
      const g = W.goalie[side]; if (!g || !g.active) continue;
      const gx = side === 'a' ? GOAL_X[0] : GOAL_X[1];
      place(g, gx + attackDir(side) * 3, MID_Y, side === 'a' ? 0 : Math.PI);
    }
    W.officials.forEach((o, i) => place(o, clamp(x + (i ? -16 : 14), 30, RL - 30), i ? 6.5 : RW - 6));
  }

  // ── the shot ──────────────────────────────────────────────────────────────
  // Where the puck goes for each outcome, from where the goalie is standing now.
  function aim(kind, shooter, def, type, r) {
    const g0 = W.goalie[def], dir = -attackDir(def), gx = def === 'a' ? GOAL_X[0] : GOAL_X[1];
    // an empty net still has a shape to aim at
    const g = g0 && g0.active ? g0 : { x: gx - dir * 3, y: MID_Y, h: dir > 0 ? Math.PI : 0, active: false };
    const gy = g && g.active ? g.y : MID_Y;
    const fwd = [Math.cos(g ? g.h : 0), Math.sin(g ? g.h : 0)], left = [-fwd[1], fwd[0]];
    const s = r() < 0.5 ? 1 : -1;
    // a breakaway with nobody in net still has to miss: it goes wide
    if (kind === 'breakaway' && !(g0 && g0.active)) kind = 'wide';
    const low = type === 'slap' || type === 'snap' ? r() < 0.55 : type === 'backhand' || type === 'wrap' ? r() < 0.4 : r() < 0.35;
    switch (kind) {
      case 'goal': {
        // away from where he is, and high if he's going down, low if he isn't
        const side = Math.sign(MID_Y - gy) || s;
        return { tgt: [gx + dir * 1.8, MID_Y + side * (1.4 + r() * 1.1), low ? 0.25 + r() * 0.5 : 2.5 + r() * 1.0], low };
      }
      case 'glove': { const gs = g ? 1 : s; return { tgt: [g.x + fwd[0] * 0.7 + left[0] * 1.7 * gs, g.y + fwd[1] * 0.7 + left[1] * 1.7 * gs, 3.1 + r() * 0.7], low: false }; }
      case 'save': return { tgt: [g.x + fwd[0] * 0.8, g.y + fwd[1] * 0.8, 2.4 + r() * 0.5], low: false };
      case 'pad': return { tgt: [g.x + fwd[0] * 1.0 + left[0] * 1.3 * s, g.y + fwd[1] * 1.0 + left[1] * 1.3 * s, 0.25], low: true, s };
      case 'post': return { tgt: [gx, MID_Y + s * (NET_HALF - 0.1), r() < 0.25 ? NET_H - 0.15 : 0.6 + r() * 2.6], low: false, s };
      case 'wide': return { tgt: [gx + dir * 1.5, MID_Y + s * (NET_HALF + 1.8 + r() * 3), 0.4 + r() * 1.8], low: false, s };
      default: return { tgt: [gx, MID_Y, 1], low: true };
    }
  }
  const SPEED = { slap: 108, onetimer: 102, snap: 90, wrist: 82, backhand: 66, tip: 74, wrap: 46 };

  // ── a possession and the shot at the end of it ────────────────────────────
  function stageRush(p) {
    const B = begin('rush');
    let nodes = p.possession.map((n) => ({ ...n, x: clamp(n.p[0] * RL, 4, RL - 4), y: clamp(n.p[1] * RW, 3, RW - 3) }));
    // A line is on air for about ten seconds and the shot has to land inside it, so a long
    // rush joins late: walk back from the shot and start from the touch that keeps the
    // picture to about five seconds. The build-up was said in words before this.
    {
      const L = nodes.length, legTime = (a, b) => {
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        return b.ev === 'battle' || b.ev === 'dump' ? 1.6 + d / 60 : b.carrier >= 0 && b.carrier !== a.carrier ? 0.5 + d / 70 : 0.3 + d / 21;
      };
      let first = L - 3, sum = legTime(nodes[L - 3], nodes[L - 2]);
      while (first > 0 && sum + legTime(nodes[first - 1], nodes[first]) < (opts.rushBudget || 5.2)) { sum += legTime(nodes[first - 1], nodes[first]); first--; }
      if (first > 0) nodes = [{ ...nodes[first], ev: 'breakout', carrier: Math.max(0, nodes[first].carrier) }, ...nodes.slice(first + 1)];
    }
    const att = sideOfTeam(p.attackingTeam, p) || (nodes[nodes.length - 1].p[0] > 0.5 ? 'a' : 'h');
    const def = other(att), dir = attackDir(att);
    const netX = att === 'a' ? GOAL_X[1] : GOAL_X[0];
    const kind = p.kind === 'goal' || p.type === 'goal' ? 'goal' : (SAVE[p.kind] ? p.kind : 'save');
    const type = SHOTS[p.shotType] ? p.shotType : 'wrist';
    const r = rng(hash(`${p.clock}|${p.shooter}|${p.kind}`));
    const g = W.goalie[def];
    if (g && g.active) { g.name = surname(p.goalie); g.num = 30 + (hash(p.goalie || def) % 9); }
    W.puckScripted = true; W.frozen = false;

    const n0 = nodes[0];
    let cur;
    const far = D.needCut || Math.hypot(pk.x - n0.x, pk.y - n0.y) > 45 || pk.held || pk.inNet;
    if (far) {
      setCounts(att, p.strength);
      cur = W.mates(att).find((m) => m.slot === n0.carrier) || W.mates(att)[0];
      setUp(att, n0.x, n0.y, cur);
      fresh(cur); place(cur, n0.x, n0.y, dir > 0 ? 0 : Math.PI);
      pk.inNet = null; pk.held = null; pk.hidden = false;
      const bw = bladeWorld(cur, W.t, true); pk.x = bw[0]; pk.y = bw[1]; pk.z = 0; pk.vx = pk.vy = pk.vz = 0;
      W.give(cur);
      cut('broadcast', [n0.x, n0.y]);
    } else {
      // carry on from the live picture: whoever of his side is nearest the puck takes it
      cur = W.nearestOf(W.mates(att), pk.x, pk.y) || W.mates(att)[0];
      if (pk.carrier && pk.carrier.side !== att) { W.act(cur, 'poke', 0.35); W.sfx('stick'); }
      W.give(cur);
    }
    D.needCut = false;
    const slotBody = (k) => W.mates(att).find((m) => m.slot === k) || null;
    let li = 1, leg = null, lastPasser = null;
    const script = (b) => { b.scripted = true; B.locked.add(b); return b; };
    script(cur);

    function nextLeg() {
      if (D.beat !== B) return;
      if (li >= nodes.length - 2) { shotLeg(); return; }
      const nd = nodes[li], nx = nodes[li + 1];
      li++;
      const tb = nd.carrier >= 0 ? slotBody(nd.carrier) : null;
      if (nd.ev === 'battle' || nd.ev === 'dump') {
        const chaser = (nx.carrier >= 0 && slotBody(nx.carrier)) || W.nearestOf(W.mates(att).filter((m) => m !== cur), nd.x, nd.y) || cur;
        const foe = W.nearestOf(W.mates(def), nd.x, nd.y);
        if (nd.ev === 'dump') {
          W.act(cur, 'dump', 0.45);
          at(B, 0.2, () => W.dumpTo(cur, nd.x, nd.y, 62));
        } else {
          // rubbed off it: the puck squirts toward where the battle is
          const nearFoe = W.nearestOf(W.mates(def), cur.x, cur.y);
          if (nearFoe && Math.hypot(nearFoe.x - cur.x, nearFoe.y - cur.y) < 12) { W.act(nearFoe, 'poke', 0.35); }
          W.act(cur, 'stagger', 0.5); cur.react = 0.4;
          const d = Math.hypot(nd.x - pk.x, nd.y - pk.y) || 1, sp = clamp(d * 1.4, 14, 50);
          W.loose((nd.x - pk.x) / d * sp, (nd.y - pk.y) / d * sp, 0);
          W.sfx('stick');
        }
        cur.scripted = false;
        script(chaser);
        if (foe) script(foe);
        leg = { kind: 'chase', chaser, foe, t: 0 };
        return;
      }
      if (tb && tb !== cur) {
        // a pass to the man who carries the next touch: he skates to the spot and it meets him
        script(tb);
        tb.tx = nd.x; tb.ty = nd.y; tb.maxV = 22;
        const lu = (tb.x - cur.x) * Math.cos(cur.h) + (tb.y - cur.y) * Math.sin(cur.h);
        const lv = -(tb.x - cur.x) * Math.sin(cur.h) + (tb.y - cur.y) * Math.cos(cur.h);
        const pkind = lu < -3 ? 'drop' : lv < -4 && lu < 8 ? 'backpass' : r() < 0.15 ? 'saucer' : 'pass';
        W.act(cur, pkind, 0.32); cur.look = [tb.x, tb.y, 1];
        const from = cur;
        at(B, 0.11, () => {
          W.give(from); W.pass(from, tb, pkind === 'drop' ? 20 : 64 + r() * 14);
          if (pkind === 'saucer') pk.vz = 7;
          W.act(tb, 'receive', 0.6, [from.x, from.y]);
        });
        lastPasser = cur;
        leg = { kind: 'pass', to: tb, from: cur, t: 0 };
        return;
      }
      // carry it there himself; a deke beats the man standing him up on the way
      cur.tx = nd.x; cur.ty = nd.y; cur.maxV = 22;
      if (nd.ev === 'deke') {
        const front = W.nearestOf(W.mates(def), nd.x, nd.y);
        if (front) { script(front); front.tx = lerp(cur.x, nd.x, 0.6); front.ty = lerp(cur.y, nd.y, 0.6); front.maxV = 16; front.face = Math.atan2(cur.y - front.y, cur.x - front.x); }
        leg = { kind: 'carry', deke: front, t: 0, dist: Math.hypot(nd.x - cur.x, nd.y - cur.y) };
      } else leg = { kind: 'carry', t: 0, dist: Math.hypot(nd.x - cur.x, nd.y - cur.y) };
      leg.tx = nd.x; leg.ty = nd.y;
    }

    function shotLeg() {
      const sn = nodes[nodes.length - 2];
      let shooter = cur, setup = null;
      if ((type === 'onetimer' || type === 'tip') && W.mates(att).length > 1) {
        // a one-timer and a tip need somebody else to put it there
        const mate = W.nearestOf(W.mates(att).filter((m) => m !== cur), sn.x, sn.y);
        if (mate) {
          shooter = script(mate);
          if (type === 'tip') { mate.tx = netX - dir * 7; mate.ty = MID_Y + (r() - 0.5) * 6; } else { mate.tx = sn.x; mate.ty = sn.y; }
          mate.maxV = 20;
          setup = cur;
        }
      }
      nameBody(shooter, p.shooter);
      if (p.assist && setup) nameBody(setup, p.assist);
      else if (p.assist && lastPasser && lastPasser !== shooter) nameBody(lastPasser, p.assist);
      if (type === 'wrap') {
        const sv = cur.y > MID_Y ? 1 : -1;
        cur.tx = netX + dir * 7; cur.ty = MID_Y + sv * 5; cur.maxV = 20;
        leg = { kind: 'wrapIn', t: 0, sv };
      } else if (setup) {
        cur.tx = sn.x - dir * 10; cur.ty = sn.y + (sn.y > MID_Y ? -8 : 8); cur.maxV = 16;
        leg = { kind: 'feed', t: 0, shooter, setup, fed: false };
      } else {
        cur.tx = sn.x; cur.ty = sn.y; cur.maxV = 21;
        leg = { kind: 'approach', t: 0, shooter };
      }
      // a block needs a body in the lane before the shot
      if (kind === 'blocked') {
        const fin = nodes[nodes.length - 1];
        const bl = W.nearestOf(W.mates(def), fin.x, fin.y);
        if (bl) { script(bl); bl.tx = fin.x; bl.ty = fin.y; bl.maxV = 24; bl.face = dir > 0 ? Math.PI : 0; leg.blocker = bl; }
      }
      if (kind === 'breakaway' && g && g.active) leg.breakaway = true;
    }

    function shoot(shooter) {
      if (D.beat !== B) return;
      const T = SHOTS[type] ? type : 'wrist';
      if (kind === 'breakaway' && g && g.active) {
        // in alone: the goalie comes out and pokes it off his stick before he can shoot
        g.scripted = true; g.tx = g.x + attackDir(def) * 3.5; g.ty = lerp(g.y, shooter.y, 0.5); g.face = Math.atan2(shooter.y - g.y, shooter.x - g.x);
        W.act(shooter, 'fake', 0.7);
        at(B, 0.22, () => W.act(g, 'poke', 0.45));
        at(B, 0.42, () => {
          W.loose(-dir * 10 + (r() - 0.5) * 10, (r() < 0.5 ? 1 : -1) * (18 + r() * 10), 0);
          W.sfx('poke'); W.act(shooter, 'stagger', 0.5); W.crowd = 0.9; land(B);
        });
        at(B, 0.9, () => { g.scripted = false; });
        at(B, 1.8, () => finish(B));
        return;
      }
      W.act(shooter, T, SHOTS[T].dur);
      if (T === 'slap' || T === 'onetimer') { shooter.tx = shooter.x + shooter.vx * 0.5; shooter.ty = shooter.y + shooter.vy * 0.5; shooter.maxV = 8; }
      if (leg && leg.blocker) W.act(leg.blocker, 'block', 0.9);
      at(B, releaseAt(T), () => {
        if (pk.carrier !== shooter) { const bw = bladeWorld(shooter, W.t, true); pk.x = bw[0]; pk.y = bw[1]; pk.z = 0; W.give(shooter); }
        let a;
        if (kind === 'blocked' && leg && leg.blocker) { const bl = leg.blocker; a = { tgt: [bl.x - dir * 0.8, bl.y, 0.3] }; }
        else a = aim(kind, shooter, def, T, r);
        if (kind === 'goal') W.allowGoal = def;
        const tt = W.shoot(shooter, a.tgt, SPEED[T] || 80);
        W.sfx('shot', { type: T });
        react(a, tt);
      });
    }

    // the goalie plays it the way the sim says he did
    function react(a, tt) {
      const gl = g && g.active ? g : null;
      const lead = Math.max(0, tt - 0.28);
      const fwd = gl ? [Math.cos(gl.h), Math.sin(gl.h)] : [1, 0];
      const sideOf = (pt) => (gl ? Math.sign(-(pt[0] - gl.x) * fwd[1] + (pt[1] - gl.y) * fwd[0]) || 1 : 1);
      if (gl) { gl.scripted = true; gl.tx = gl.x; gl.ty = gl.y; }
      switch (kind) {
        case 'goal':
          if (gl) at(B, lead * 0.6, () => { if (a.low) { W.act(gl, 'glove', 0.6); gl.gloveTarget = [gl.x + fwd[0], gl.y + fwd[1], 3.6]; gl.gloveW = 0.8; } else { W.act(gl, 'butterfly', 1.2, sideOf(a.tgt)); } });
          at(B, tt + 1.2, () => { if (!B.scored) { B.scored = true; goal(); } });
          break;
        case 'glove':
          if (gl) { gl.gloveTarget = a.tgt; gl.gloveHold = true; B.gloveRamp = { g: gl, from: W.t + lead * 0.5, dur: Math.max(0.12, tt * 0.7) }; }
          at(B, tt, () => { if (gl) { pk.held = gl; gl.gloveW = 1; } W.sfx('glove'); W.crowd = 0.7; land(B); });
          at(B, tt + 0.5, () => whistle());
          at(B, tt + 1.8, () => { W.amb.holdUntil = W.t + 2; finish(B); });
          break;
        case 'save':
          if (gl) at(B, lead, () => W.act(gl, 'chest', 0.55));
          at(B, tt, () => {
            W.sfx('chest'); land(B);
            if (p.frozen && gl) { pk.held = gl; gl.gloveHold = true; gl.gloveTarget = [gl.x + fwd[0] * 0.9, gl.y + fwd[1] * 0.9, 2.5]; gl.gloveW = 1; at(B, 0.45, () => whistle()); }
            else W.loose(-dir * (10 + r() * 8), (r() - 0.5) * 24, 1.5);
          });
          at(B, tt + 1.8, () => { W.amb.holdUntil = W.t + 2; finish(B); });
          break;
        case 'pad':
          if (gl) at(B, lead, () => W.act(gl, r() < 0.6 ? 'butterfly' : 'kick', 0.9, sideOf(a.tgt)));
          at(B, tt, () => { W.sfx('pad'); land(B); W.loose(-dir * (18 + r() * 14), (a.s || 1) * (12 + r() * 16), 2); });
          at(B, tt + 1.5, () => finish(B));
          break;
        case 'blocked':
          at(B, tt, () => { W.sfx('block'); land(B); W.loose(-dir * (6 + r() * 8), (r() - 0.5) * 18, 1.2); if (leg && leg.blocker) leg.blocker.react = 0.8; });
          at(B, tt + 1.4, () => finish(B));
          break;
        case 'post':
          if (gl) at(B, lead, () => W.act(gl, 'butterfly', 0.9, sideOf(a.tgt)));
          at(B, tt * 0.97, () => {
            pk.vx = -pk.vx * 0.42; pk.vy = (a.s || 1) * (14 + r() * 10); pk.vz = 3 + r() * 3;
            W.sfx('post'); W.crowd = 1; land(B);
            W.burst('spray', pk.x, pk.y, pk.z, 4, 3, [0, 0, 2]);
          });
          at(B, tt + 1.4, () => finish(B));
          break;
        case 'wide':
        default:
          at(B, tt, () => { land(B); W.sfx('wide'); });
          at(B, tt + 1.4, () => finish(B));
          break;
      }
    }

    function goal() {
      land(B);
      W.lamp = 4.5; W.lampSide = def; W.crowd = 1;
      W.sfx('horn', { seed: p.hornSeed }); W.sfx('net');
      const sh = W.team[att].find((m) => m.name === surname(p.shooter) && m.active) || cur;
      B.ownsCam = true;
      // he wheels away toward the boards, they pile in on him, the goalie hangs his head
      if (sh) {
        script(sh); sh.tx = netX - dir * 16; sh.ty = sh.y > MID_Y ? RW - 9 : 9; sh.maxV = 20;
        at(B, 0.9, () => { W.act(sh, 'celebrate', 1.8); sh.maxV = 8; });
      }
      W.frozen = true;
      for (const m of W.mates(att)) if (m !== sh) { script(m); m.maxV = 18; B.hug = true; }
      if (g && g.active) { g.scripted = true; at(B, 0.3, () => { W.act(g, 'slump', 2.4); }); }
      at(B, 0.6, () => { W.cam.mode = 'push'; });
      B.celebrate = sh;
      at(B, 4.2, () => finish(B));
    }

    B.onEvent = (name) => { if (name === 'goalIn' && kind === 'goal' && !B.scored) { B.scored = true; goal(); } };

    B.update = (dt) => {
      W.cam.focus = [pk.x, pk.y];
      if (B.celebrate) {
        const sh = B.celebrate;
        W.cam.focus = [sh.x, sh.y];
        for (const m of W.mates(att)) if (m !== sh && m.scripted) {
          const d = Math.hypot(sh.x - m.x, sh.y - m.y);
          m.tx = sh.x + (m.x - sh.x) / (d || 1) * 2.6; m.ty = sh.y + (m.y - sh.y) / (d || 1) * 2.6;
          if (d < 4 && m.act !== 'hug') { m.target = sh; W.act(m, 'hug', 1.6); }
        }
      }
      if (B.gloveRamp) { const gr = B.gloveRamp; gr.g.gloveW = clamp((W.t - gr.from) / gr.dur, 0, 1); }
      if (!leg) return;
      leg.t += dt;
      if (leg.kind === 'carry') {
        if (leg.deke && !leg.dekeDone && Math.hypot(leg.deke.x - cur.x, leg.deke.y - cur.y) < 8) {
          leg.dekeDone = true;
          W.act(cur, ['toedrag', 'deke', 'drag'][(r() * 3) | 0], 0.7);
          const sd = r() < 0.5 ? 1 : -1, d = leg.deke;
          cur.tx = leg.tx - Math.sin(cur.h) * 5 * sd; cur.ty = leg.ty + Math.cos(cur.h) * 5 * sd;
          at(B, 0.35, () => { W.act(d, 'stagger', 0.6); d.react = 0.4; d.scripted = false; });
        }
        if (Math.hypot(cur.tx - cur.x, cur.ty - cur.y) < 4 || leg.t > leg.dist / 17 + 0.6) { leg = null; nextLeg(); }
      } else if (leg.kind === 'pass') {
        if (pk.carrier === leg.to) { leg.from.scripted = false; cur = leg.to; leg = null; nextLeg(); }
        else if (leg.t > 2.2) { const bw = bladeWorld(leg.to, W.t, true); pk.x = bw[0]; pk.y = bw[1]; W.give(leg.to); }
      } else if (leg.kind === 'chase') {
        const c = leg.chaser;
        c.tx = pk.x + pk.vx * 0.25; c.ty = pk.y + pk.vy * 0.25; c.maxV = 25;
        if (leg.foe) { leg.foe.tx = pk.x + pk.vx * 0.2 - Math.cos(c.h) * 2; leg.foe.ty = pk.y + pk.vy * 0.2; leg.foe.maxV = 23; }
        const bw = bladeWorld(c, W.t, true);
        if ((Math.hypot(bw[0] - pk.x, bw[1] - pk.y) < 2.6 && pk.z < 1) || leg.t > 3.4) {
          if (leg.t > 3.4) { pk.x = bw[0]; pk.y = bw[1]; pk.vx = c.vx; pk.vy = c.vy; }
          W.give(c); W.sfx('receive');
          if (pk.y < 9 || pk.y > RW - 9) { W.boardShake = Math.max(W.boardShake, 0.35); W.sfx('boards'); }
          if (leg.foe) leg.foe.scripted = false;
          cur.scripted = false; cur = c; leg = null; nextLeg();
        }
      } else if (leg.kind === 'approach') {
        const sh = leg.shooter;
        if (leg.breakaway && g) { g.scripted = true; g.tx = g.x; g.ty = g.y; }
        if (Math.hypot(sh.tx - sh.x, sh.ty - sh.y) < 5 || leg.t > 1.7) { leg.kind = 'shooting'; shoot(sh); }
      } else if (leg.kind === 'wrapIn') {
        if (leg.t > 0.5 && !leg.round) { leg.round = true; cur.tx = netX - dir * 1.5; cur.ty = MID_Y + leg.sv * 4.2; }
        if (leg.round && (Math.hypot(cur.tx - cur.x, cur.ty - cur.y) < 2 || leg.t > 2.2)) { leg.kind = 'shooting'; shoot(cur); }
      } else if (leg.kind === 'feed') {
        const sh = leg.shooter;
        if (!leg.fed && (leg.t > 0.7 || Math.hypot(sh.tx - sh.x, sh.ty - sh.y) < 4)) {
          leg.fed = true; const from = cur;
          W.act(from, 'pass', 0.32);
          if (type === 'onetimer') W.act(sh, 'onetimerReady', 0.8);
          at(B, 0.11, () => {
            if (type === 'tip') {
              // the point shot is the setup; the tip is the shot that counts
              const bw = bladeWorld(sh, W.t + 0.35, true);
              W.shoot(from, [bw[0], bw[1], 0.4], 75); W.sfx('shot', { type: 'wrist' });
              leg.tipAt = W.t + 0.3;
            } else W.pass(from, sh, 78);
          });
        }
        if (leg.fed && type === 'onetimer' && (pk.carrier === sh || (pk.target === sh && Math.hypot(pk.x - sh.x, pk.y - sh.y) < 9))) { leg.kind = 'shooting'; shoot(sh); }
        if (leg.fed && type === 'tip' && leg.tipAt && W.t >= leg.tipAt) {
          leg.kind = 'shooting';
          const bw = bladeWorld(sh, W.t, true); pk.x = bw[0]; pk.y = bw[1]; pk.z = 0.3; W.give(sh);
          W.act(sh, 'tip', SHOTS.tip.dur);
          W.schedule(0.02, () => { if (D.beat !== B) return; const a = aim(kind, sh, def, 'tip', r); if (kind === 'goal') W.allowGoal = def; const tt = W.shoot(sh, a.tgt, SPEED.tip); W.sfx('stick'); react(a, tt); });
        }
        if (leg && leg.t > 3) { leg.kind = 'shooting'; shoot(sh); }
      }
    };
    B.cleanup = () => { if (g) { g.gloveHold = false; } };
    nextLeg();
    return B;
  }

  // ── the faceoff ───────────────────────────────────────────────────────────
  function stageFaceoff(p) {
    const B = begin('faceoff');
    flushTasks();
    const [dx, dy] = DOT_FT[p.dot] || DOT_FT.C;
    const ws = tagSide(p.winnerSide) || sideOfTeam(p.winTeam, p) || 'a', ls = other(ws);
    if (p.reason === 'period' && D.intermission) endIntermission();
    W.frozen = true; W.puckScripted = true;
    setCounts(ws, '');
    // every man to his spot: centres on the dot, wingers on the hash marks, D behind
    for (const side of ['a', 'h']) {
      const dir = attackDir(side), face = dir > 0 ? 0 : Math.PI;
      for (const m of W.mates(side)) {
        let x = dx - dir * 2.2, y = dy;
        if (m.slot === 0 || m.slot === 2 || m.slot === 5) { const s = (m.slot === 0) === (side === 'a') ? 1 : -1; x = dx - dir * 3.5; y = dy + s * 13; }
        else if (m.slot === 3 || m.slot === 4) { const s = (m.slot === 3) === (side === 'a') ? 1 : -1; x = dx - dir * 15; y = dy + s * 9; }
        place(m, clamp(x, 6, RL - 6), clamp(y, 4, RW - 4), face); m.scripted = true; m.tx = m.x; m.ty = m.y; m.face = face;
      }
      const g = W.goalie[side]; if (g && g.active) place(g, (side === 'a' ? GOAL_X[0] : GOAL_X[1]) + dir * 3, MID_Y, face);
    }
    // the centres take the draw, so the names go on the centres
    const winC = nameBody(W.mates(ws).find((m) => m.slot === 1) || W.mates(ws)[0], p.winner);
    const loseC = nameBody(W.mates(ls).find((m) => m.slot === 1) || W.mates(ls)[0], p.loser);
    for (const [c, side] of [[winC, ws], [loseC, ls]]) if (c) { const dir = attackDir(side); place(c, dx - dir * 2.0, dy, dir > 0 ? 0 : Math.PI); c.scripted = true; c.face = c.h; }
    const lin = W.officials[0], ref = W.officials[1];
    if (lin) { place(lin, dx + 1.5, dy - 6, Math.PI / 2); lin.scripted = true; lin.tx = dx; lin.ty = dy - 3.4; lin.face = Math.PI / 2; }
    if (ref) { place(ref, clamp(dx + 22, 30, RL - 30), RW - 6); ref.scripted = true; ref.face = Math.atan2(dy - ref.y, dx - ref.x); }
    pk.carrier = null; pk.target = null; pk.held = null; pk.inNet = null;
    pk.x = dx; pk.y = dy - 2.6; pk.z = 4.4; pk.vx = pk.vy = pk.vz = 0; pk.hidden = true;
    D.needCut = false;
    cut('broadcast', [dx, dy]);
    B.ownsCam = true;
    W.cam.focus = [dx, dy];
    at(B, 0.5, () => { if (winC) W.act(winC, 'faceoff', 1.6); if (loseC) W.act(loseC, 'faceoff', 1.6); });
    at(B, 1.25, () => { if (lin) W.act(lin, 'point', 0.4); });
    at(B, 1.35, () => { pk.hidden = false; pk.x = dx; pk.y = dy; pk.z = 4.2; pk.vz = -2; W.sfx('drop'); B.dropped = true; });
    B.update = () => {
      W.cam.focus = [dx, dy];
      if (lin) { lin.carrying = false; if (!B.dropped) { pk.x = lin.x + 0.6; pk.y = lin.y + 0.9; pk.z = 4.4; pk.vx = pk.vy = pk.vz = 0; } }
      if (B.dropped && !B.won && pk.z <= 0.05) {
        B.won = true;
        const dir = attackDir(ws);
        if (winC) W.act(winC, 'sweep', 0.4);
        W.sfx('sweep'); land(B);
        const back = W.mates(ws).find((m) => m.slot === 3) || W.mates(ws).find((m) => m !== winC);
        if (back && winC) { W.give(winC); at(B, 0.12, () => { W.pass(winC, back, 36); }); }
        else W.loose(-dir * 28, (Math.random() - 0.5) * 10, 0);
        if (lin) { lin.tx = dx + 2; lin.ty = dy - 12; lin.maxV = 14; }
        at(B, 0.9, () => finish(B));
      }
    };
    return B;
  }

  // ── a hit on the boards ───────────────────────────────────────────────────
  function stageHit(p, fatal) {
    const B = begin(fatal ? 'death' : 'boards');
    const vs = tagSide(p.victimSide) || sideOfTeam(p.victimTeam, p) || 'h', hs = other(vs);
    const r = rng(hash(`${p.clock}|${p.victim}|${p.hitter}|hit`));
    const style = fatal ? (fatal === 'head' || fatal === 'neck' ? 'glass' : 'behind') : (p.hitStyle || 'shoulder');
    const vdir = attackDir(vs);
    // finished on the far wall, where the glass and the advertising are in shot
    let x0 = clamp(pk.x + (r() - 0.5) * 20, 52, RL - 52);
    const y0 = RW - 3.6;
    const victim = bodyFor(vs, p.victim || p.player, W.nearestOf(W.mates(vs), x0, y0));
    let hitter = p.hitter ? bodyFor(hs, p.hitter, W.nearestOf(W.mates(hs), x0, y0 - 10)) : W.nearestOf(W.mates(hs), x0, y0 - 10);
    if (!victim || !hitter) { land(B); at(B, 0.5, () => finish(B)); return B; }
    W.puckScripted = true;
    const far = D.needCut || Math.hypot(victim.x - x0, victim.y - y0) > 30 || W.frozen;
    const sx = x0 - vdir * 24;
    if (far) {
      setUp(vs, sx, y0, victim);
      fresh(victim); place(victim, sx, y0, vdir > 0 ? 0 : Math.PI);
      place(hitter, x0 - vdir * 4, y0 - 20, Math.atan2(20, vdir * 4));
      pk.inNet = null; pk.held = null; pk.hidden = false;
      cut('broadcast', [x0, y0 - 8]);
    }
    D.needCut = false;
    const bw = bladeWorld(victim, W.t, true); pk.x = bw[0]; pk.y = bw[1]; pk.z = 0; pk.vx = victim.vx; pk.vy = victim.vy;
    W.give(victim);
    victim.scripted = true; hitter.scripted = true; B.locked.add(victim); B.locked.add(hitter);
    victim.maxV = 20; hitter.maxV = 27; hitter.acc = 34;
    if (style === 'behind') { victim.tx = x0; victim.ty = y0 + 0.4; victim.maxV = 12; }
    B.ownsCam = true;
    let hit = false;
    B.update = (dt, rel) => {
      if (!hit) {
        if (style !== 'behind') { victim.tx = victim.x + vdir * 18; victim.ty = y0; }
        else if (rel > 0.8) victim.face = Math.PI / 2;
        const lead = Math.min(0.9, Math.hypot(hitter.x - victim.x, hitter.y - victim.y) / 32);
        hitter.tx = victim.x + victim.vx * lead + (style === 'behind' ? 0 : 0); hitter.ty = style === 'behind' ? victim.y - 1 : RW;
        if (style === 'behind') { hitter.tx = victim.x - 0.5; hitter.ty = victim.y - 2; }
        W.cam.focus = [(victim.x + hitter.x) / 2, (victim.y + hitter.y) / 2 - 4];
        if (rel > 3.2 && Math.hypot(hitter.x - victim.x, hitter.y - victim.y) >= 3.3) { hitter.x = victim.x - attackDir(vs) * 1.4; hitter.y = victim.y - 2.6; }
        if (Math.hypot(hitter.x - victim.x, hitter.y - victim.y) < 3.3) { hit = true; impact(); }
      } else {
        const v = victim.rag ? victim.rag.pts[0] : victim;
        W.cam.focus = [v.x, v.y - 3];
      }
    };
    function impact() {
      const hv = [hitter.vx, hitter.vy];
      const act = style === 'hip' ? 'checkHip' : style === 'elbow' ? 'checkElbow' : 'check';
      W.act(hitter, act, 0.55); hitter.actT = 0.45;
      let impU, impL;
      switch (style) {
        case 'glass': impU = [hv[0] * 0.5, 31, 13]; impL = [hv[0] * 0.3, 12, 3]; victim.shatterNext = r() < 0.5 || fatal === 'head'; break;
        case 'behind': impU = [hv[0] * 0.3 + vdir * 2, 27, 2]; impL = [hv[0] * 0.2, 6, 0.5]; break;
        case 'hip': impU = [hv[0] * 0.4, 7, 3]; impL = [hv[0] * 0.4, 17, 11]; break;
        case 'elbow': impU = [hv[0] * 0.4, 18, 9]; impL = [hv[0] * 0.2, 6, 1]; break;
        default: impU = [hv[0] * 0.6 - 2, 26, 8]; impL = [hv[0] * 0.3, 9, 1.5];
      }
      if (fatal === 'post') { impU = [vdir * 18, -6, 4]; impL = [vdir * 6, -2, 1]; }
      W.knock(victim, impU, impL);
      hitter.vx *= 0.3; hitter.vy *= 0.15;
      W.shake = Math.max(W.shake, style === 'glass' ? 1.2 : 0.9); W.crowd = 1; W.hitstop = style === 'glass' ? 0.1 : 0.07;
      W.sfx('check', { style });
      W.burst('spray', victim.x, victim.y, 0.3, 14, 7, [0, 4, 3]);
      const hurt = p.injured || fatal;
      if (style === 'elbow' || style === 'behind' || hurt) {
        if (victim.helmet && r() < (hurt ? 0.8 : 0.5)) { victim.helmet = false; W.addDebris('helmet', [victim.x, victim.y, 5.6], [hv[0] * 0.4, 10, 12], 0, 6, victim.side); }
        victim.bleeding = hurt ? 6 : 2.5; victim.blood = Math.min(1, (victim.blood || 0) + 0.6);
        W.burst('blood', victim.x, victim.y + 0.5, 5.2, hurt ? 30 : 14, 7, [hv[0] * 0.2, 7, 5]);
        if (r() < 0.6) W.burst('tooth', victim.x, victim.y + 0.5, 5.0, 1 + ((r() * 2) | 0), 5, [0, 4, 4]);
      }
      if (p.sever && p.woundPart && !fatal) at(B, 0.06, () => W.sever(victim, p.woundPart, [hv[0] * 0.5, 14, 9]));
      if (fatal === 'head') at(B, 0.05, () => W.sever(victim, 'head', [hv[0] * 0.4, 6, 16]));
      if (fatal === 'throat') { victim.fountain = { part: 'head', until: W.t + 5 }; victim.bleeding = 12; }
      W.cam.mode = 'zoom';
      land(B);
      if (hurt) {
        // he stays down and play stays stopped until the injury beat comes for him
        victim.down = true;
        at(B, 1.6, () => whistle());
        if (fatal) return;
        at(B, 3.0, () => { B.waiting = true; opts.onDone?.(B.kind); });
      } else {
        at(B, 2.3, () => { W.getUp(victim, 1.1); victim.scripted = false; pickUpStick(victim); });
        at(B, 1.0, () => { hitter.scripted = false; });
        at(B, 3.2, () => finish(B));
      }
    }
    B.cleanup = () => {
      if (!p.injured && !fatal && victim.rag) { W.getUp(victim, 0.6); pickUpStick(victim); }
    };
    B.victim = victim;
    return B;
  }

  // ── the stretcher ─────────────────────────────────────────────────────────
  // Two medics come out of the gate with it, lift him on and take him off. On the stretcher
  // he is held in a lying pose (the ragdoll is parked, see `b.hold` in sim.js).
  function stretcherFor(B, victim, slow, onGone) {
    const gx = clamp(victim.x, 40, RL - 40);
    medics.forEach((m, i) => { fresh(m); m.active = true; m.stick = false; m.gloves = false; m.helmet = false; place(m, gx + (i ? 3.6 : -3.6), 1.8, Math.PI / 2); m.scripted = true; m.maxV = slow ? 9 : 17; m.acc = 30; W.act(m, 'carry', 60); });
    W.stretcher = { a: medics[0], b: medics[1], x: gx, y: 1.8, h: 0, body: null };
    let state = 'out';
    const lay = (() => {
      const tmp = { ...victim, rag: null, blend: null, act: null, x: 0, y: 0, h: 0, vx: 0, vy: 0, amp: 0, phase: 0, guard: false, grab: null, foe: null, stick: false, carrying: false, react: 0, jerseyUp: 0, hold: null };
      return skaterRig(tmp, 0).slice(0, 18);
    })();
    const hold = () => {
      const s = W.stretcher; if (!s || !victim.rag) return;
      const ax = Math.cos(s.h), ay = Math.sin(s.h), nx = -ay, ny = ax;
      victim.rag.pts.forEach((pt, i) => {
        const j = lay[i]; if (!j) return;
        const u = j[2] - 2.9, v = j[1], z = 1.95 + Math.max(-0.2, j[0]) * 0.45;
        pt.x = pt.px = s.x + ax * u + nx * v; pt.y = pt.py = s.y + ay * u + ny * v; pt.z = pt.pz = z;
      });
      victim.x = victim.rag.pts[0].x; victim.y = victim.rag.pts[0].y;
    };
    const t0 = W.t;
    const k = {
      bodies: [victim, ...medics],
      tick() {
        const s = W.stretcher; if (!s) return true;
        const v = victim.rag ? victim.rag.pts[0] : victim;
        if (state === 'out') {
          // head end and foot end either side of where he lies
          const ang = victim.rag ? Math.atan2(victim.rag.pts[3].y - v.y, victim.rag.pts[3].x - v.x) : 0;
          medics[0].tx = v.x + Math.cos(ang) * 3.8; medics[0].ty = v.y + Math.sin(ang) * 3.8;
          medics[1].tx = v.x - Math.cos(ang) * 3.4; medics[1].ty = v.y - Math.sin(ang) * 3.4;
          if (medics.every((m) => Math.hypot(m.tx - m.x, m.ty - m.y) < 1.6) || W.t - t0 > (slow ? 12 : 8)) {
            state = 'load'; k.loadAt = W.t;
            if (!victim.rag) W.knock(victim, [0, 0, 0.5], [0, 0, 0]);
            victim.hold = hold; s.body = victim;
            medics.forEach((m) => { m.tx = m.x; m.ty = m.y; });
          }
        } else if (state === 'load' && W.t - k.loadAt > 1.0) {
          state = 'off';
          medics.forEach((m) => { m.ty = 1.2; m.maxV = slow ? 7 : 13; });
          medics[0].tx = s.x + Math.cos(s.h) * 3.6; medics[1].tx = s.x - Math.cos(s.h) * 3.6;
        } else if (state === 'off' && (medics.every((m) => m.y < 3.4) || W.t - k.loadAt > 14)) {
          gone(); onGone?.(); return true;
        }
        return false;
      },
      flush() { if (W.stretcher) gone(); },
    };
    D.tasks.push(k);
    return k;
    function gone() {
      W.stretcher = null;
      medics.forEach((m) => { m.active = false; m.scripted = false; });
      victim.hold = null; victim.down = false;
      if (victim.active) substitute(victim);
    }
  }

  function stageInjury(p) {
    const prev = D.beat;
    const vs = tagSide(p.victimSide) || sideOfTeam(p.victimTeam, p) || 'h';
    const downAlready = prev && prev.kind === 'boards' && prev.victim && prev.victim.rag;
    const victim0 = downAlready ? prev.victim : null;
    if (prev) prev.cleanup = null;     // he stays down for this
    const B = begin('injury');
    const victim = victim0 || bodyFor(vs, p.victim || p.player, W.nearestOf(W.mates(vs), pk.x, pk.y));
    if (!victim) { land(B); at(B, 0.5, () => finish(B)); return B; }
    nameBody(victim, p.victim || p.player);
    W.frozen = true; W.puckScripted = true;
    if (!victim.rag) {
      // a skate, a stick, a shot to the face: he goes down where he is
      W.knock(victim, [(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 4], [0, 0, 0]);
      victim.bleeding = 5; victim.blood = 0.7;
      W.burst('blood', victim.x, victim.y, 4.6, 20, 6, [0, 0, 4]);
      if (!D.needCut) whistle();
    }
    if (p.sever && p.woundPart && !victim.missing[p.woundPart]) at(B, 0.1, () => W.sever(victim, p.woundPart, [8, 6, 8]));
    victim.down = true;
    B.ownsCam = true;
    W.cam.mode = 'zoom';
    // his teammates go to him; the officials stand off
    const mates = W.mates(victim.side).filter((m) => m !== victim && !m.rag).slice(0, 3);
    mates.forEach((m, i) => { m.scripted = true; m.maxV = 10; B.locked.add(m); });
    at(B, 0.3, () => land(B));
    at(B, 1.2, () => { stretcherFor(B, victim, false, () => finish(B)); });
    B.update = (dt) => {
      const v = victim.rag ? victim.rag.pts[0] : victim;
      W.cam.focus = W.stretcher && W.stretcher.body ? [W.stretcher.x, W.stretcher.y + 4] : [v.x, v.y - 3];
      mates.forEach((m, i) => { if (W.stretcher && W.stretcher.body) { m.scripted = false; return; } const a = -1.2 + i * 1.2; m.tx = v.x + Math.cos(a) * 4.2; m.ty = v.y - Math.abs(Math.sin(a)) * 4.2 - 1; m.face = Math.atan2(v.y - m.y, v.x - m.x); });
    };
    // a stretcher that hasn't started by the time the next beat comes still has to happen
    B.cleanup = () => { if (!W.stretcher && victim.active && victim.down) stretcherFor(B, victim, false, null); };
    return B;
  }

  function stageDeath(p) {
    const w = String(p.wound || '').toLowerCase();
    const how = /head came off/.test(w) ? 'head' : /throat/.test(w) ? 'throat' : /post/.test(w) ? 'post' : 'neck';
    const B = stageHit({ ...p, victim: p.victim || p.player, injured: true, hitStyle: how === 'post' ? 'shoulder' : 'behind' }, how);
    const victim = B.victim;
    D.mournTo = 1;
    W.cam.since = W.t;
    at(B, 1.4, () => { W.crowd = 0; W.cam.mode = 'death'; W.cam.since = W.t; });
    // nobody plays on: helmets off, heads down, the officials wave it off
    // they gather on the far side of him, away from the camera, and stand there
    at(B, 2.6, () => {
      const c = B.deathAt || [victim.x, victim.y];
      const crowd = W.skaters().filter((m) => m !== victim && !m.rag);
      crowd.forEach((m, k) => {
        // either side of him and a little behind, never between him and the camera
        const a = -0.05 * Math.PI + (k / Math.max(1, crowd.length - 1)) * 1.1 * Math.PI, r = 8 + (k % 3) * 2.6;
        m.scripted = true; m.tx = c[0] + Math.cos(a) * r * 1.25; m.ty = c[1] + Math.sin(a) * r * 0.45; m.maxV = 6;
        if ((m.seed % 5) < 3) m.helmet = false;
        W.schedule(1.8 + (k % 4) * 0.3, () => { if (D.beat === B) W.act(m, 'slumped', 40); });
      });
      W.officials.forEach((o, i) => { o.scripted = true; o.tx = c[0] + (i ? -5 : 5); o.ty = c[1] + 3; W.act(o, 'washout', 1.4); });
    });
    at(B, 5.5, () => { if (victim) stretcherFor(B, victim, true, null); });
    const base = B.update;
    B.update = (dt, rel) => {
      base(dt, rel);
      // the camera stays where he fell, and lets the stretcher take him out of shot
      if (!B.deathAt && victim && victim.rag && rel > 2.2) B.deathAt = [victim.rag.pts[0].x, victim.rag.pts[0].y];
      if (!B.deathAt && victim && victim.rag) W.cam.focus = [victim.rag.pts[0].x, victim.rag.pts[0].y - 2];
      if (B.deathAt) W.cam.focus = [B.deathAt[0], B.deathAt[1] - 2];
      if (rel > 1.4) W.crowd = Math.min(W.crowd, 0.05);
    };
    at(B, 14, () => { B.waiting = true; opts.onDone?.(B.kind); });
    B.cleanup = null;
    return B;
  }

  // ── a scrum in front of the net ───────────────────────────────────────────
  function stageScrum(p) {
    const B = begin('scrum');
    const def = pk.x < RL / 2 ? 'a' : 'h', att = other(def);
    const gx = def === 'a' ? GOAL_X[0] : GOAL_X[1], dir = attackDir(def);
    const cx = gx + dir * 5, cy = MID_Y;
    if (D.needCut || Math.hypot(pk.x - cx, pk.y - cy) > 40) { setUp(att, cx - dir * 12, cy); cut('broadcast', [cx, cy]); }
    D.needCut = false;
    W.puckScripted = true;
    const g = W.goalie[def];
    if (g && g.active) { g.scripted = true; g.tx = gx + dir * 2.4; g.ty = MID_Y; W.act(g, 'cover', 0.5); g.actHold = true; pk.held = g; }
    const crowd = [...W.mates(att).slice(0, 4), ...W.mates(def).slice(0, 4)];
    const r = rng(hash(`scrum${p.clock}`));
    crowd.forEach((m, i) => { m.scripted = true; m.maxV = 15; m.tx = cx + dir * (r() * 4 - 1) + (r() - 0.5) * 3; m.ty = cy + (r() - 0.5) * 9; B.locked.add(m); });
    B.ownsCam = true; W.cam.mode = 'zoom'; W.cam.focus = [cx, cy];
    at(B, 0.4, () => { whistle(); land(B); });
    let next = 0.6;
    B.update = (dt, rel) => {
      W.cam.focus = [cx + dir * 2, cy];
      if (rel > next && rel < 3.4) {
        next = rel + 0.35 + r() * 0.3;
        const a = crowd[(r() * crowd.length) | 0], foes = crowd.filter((m) => m.side !== a.side);
        const b = foes.length ? foes.reduce((p2, q) => (Math.hypot(q.x - a.x, q.y - a.y) < Math.hypot(p2.x - a.x, p2.y - a.y) ? q : p2)) : null;
        if (b && Math.hypot(b.x - a.x, b.y - a.y) < 6) {
          a.target = b; W.act(a, r() < 0.5 ? 'shove' : 'break', 0.5); b.react = 0.6;
          b.tx = b.x + (b.x - a.x) * 0.5; b.ty = b.y + (b.y - a.y) * 0.5;
          W.sfx('check', { soft: true });
        }
        for (const m of crowd) { m.tx = cx + dir * (r() * 4 - 1) + (r() - 0.5) * 3; m.ty = cy + (r() - 0.5) * 9; }
      }
      if (rel > 2.6) W.officials.forEach((o, i) => { o.scripted = true; o.tx = cx + (i ? -2 : 2); o.ty = cy + (i ? 3 : -3); o.maxV = 16; });
    };
    at(B, 3.6, () => { crowd.forEach((m) => { m.tx = m.x - dir * 10; m.maxV = 8; }); if (g) g.actHold = false; });
    at(B, 4.4, () => { pk.held = null; finish(B); D.needCut = true; });
    B.cleanup = () => { if (g) g.actHold = false; if (pk.held === g) pk.held = null; };
    return B;
  }

  // ── the fight ─────────────────────────────────────────────────────────────
  function stageFight(p) {
    const B = begin('fight');
    const ws = tagSide(p.winnerSide) || sideOfTeam(p.winnerTeam, p) || 'a', ls = other(ws);
    const cx = clamp(pk.x, 70, 130), cy = clamp(pk.y, 32, 52);
    const r = rng(hash(`fight${p.winner}${p.loser}${p.clock}`));
    const win = bodyFor(ws, p.winner, W.nearestOf(W.mates(ws), cx, cy));
    const lose = bodyFor(ls, p.loser, W.nearestOf(W.mates(ls), cx, cy));
    if (!win || !lose) { land(B); at(B, 0.5, () => finish(B)); return B; }
    W.frozen = true; W.puckScripted = true;
    const leftIsWin = r() < 0.5, L = leftIsWin ? win : lose, R = leftIsWin ? lose : win;
    const far = D.needCut || Math.hypot(win.x - cx, win.y - cy) > 30;
    if (far) { setUp(ws, cx, cy); cut('broadcast', [cx, cy]); }
    D.needCut = false;
    fresh(L); fresh(R);
    place(L, cx - 2.6, cy, 0); place(R, cx + 2.6, cy, Math.PI);
    L.foe = R; R.foe = L; L.face = 0; R.face = Math.PI; L.maxV = R.maxV = 7; L.scripted = R.scripted = true;
    L.stance = R.stance = 0.5;
    if (pk.carrier) W.loose(0, 0);
    pk.x = cx + 26; pk.y = cy - 12; pk.vx = pk.vy = 0;
    // the rest stand round and watch
    const ring = W.skaters().filter((m) => m !== L && m !== R);
    ring.forEach((m, k) => { const a = 0.15 * Math.PI + (k / Math.max(1, ring.length - 1)) * 0.7 * Math.PI; m.ring = { a, rad: 20 + (k % 3) * 3 }; m.scripted = true; m.maxV = 9; });
    // the officials wait behind it, on the far side, where they don't block the camera
    W.officials.forEach((o, i) => { o.scripted = true; o.tx = cx + (i ? -9 : 9); o.ty = cy + 6; o.maxV = 12; });
    B.ownsCam = true;
    const ex = Array.isArray(p.exchange) && p.exchange.length ? p.exchange : [{ n: 1, thrower: p.winner, type: 'right', landed: true }];
    const onLoser = ex.filter((e) => e.landed && e.thrower !== p.loser).length || 1;
    const onWinner = ex.filter((e) => e.landed && e.thrower === p.loser).length || 1;
    W.fight = { l: L, r: R, pip: { [L.seed]: 5, [R.seed]: 5 }, pipShow: { [L.seed]: 5, [R.seed]: 5 }, hud: false };
    const helmets = r() < 0.4;
    at(B, 0.5, () => { W.dropGloves(L, helmets); W.dropGloves(R, helmets); W.crowd = 0.95; });
    at(B, 0.95, () => { L.guard = R.guard = true; L.stance = R.stance = 0.75; W.cam.mode = 'zoom'; W.cam.focus = [cx, cy]; });
    at(B, 1.6, () => { cut('fight', [cx, cy], true); W.fight.hud = true; W.banner = { text: 'FIGHT!', t0: W.t, dur: 1.2 }; });
    at(B, 2.0, () => { L.grab = R; R.grab = L; B.grab = true; });
    const ACT = { jab: 'jab', uppercut: 'uppercut', left: 'punchL', right: 'punchR' };
    let t = 2.45;
    ex.forEach((e, i) => {
      const last = i === ex.length - 1;
      const thrower = e.thrower === p.loser ? lose : win, taker = thrower === win ? lose : win;
      const kindAct = ACT[e.type] || 'punchR';
      at(B, t, () => punch(thrower, taker, e.landed, kindAct, last));
      if (p.ending === 'jersey' && e.n === p.pullAt) at(B, t + 0.32, () => { W.act(win, 'pull', 0.8); lose.grab = null; B.pull = true; W.sfx('cloth'); });
      t += last ? 0.6 : 0.42 + r() * 0.2;
    });
    function punch(th, vi, landed, kindAct, last) {
      if (vi.rag || th.rag) return;
      const dur = kindAct === 'uppercut' ? 0.55 : 0.36;
      W.act(th, kindAct, dur);
      W.schedule(dur * (kindAct === 'uppercut' ? 0.6 : 0.36), () => {
        if (D.beat !== B || vi.rag) return;
        const dir = Math.sign(vi.x - th.x) || 1;
        if (!landed) { vi.duck = 1; W.sfx('punchMiss'); return; }
        vi.react = 1; vi.blood = Math.min(1, (vi.blood || 0) + 0.22); th.blood = Math.min(1, (th.blood || 0) + 0.06);
        const dmg = vi === lose ? 5 / onLoser : Math.min(0.9, 3.4 / onWinner);
        W.fight.pip[vi.seed] = Math.max(vi === win ? 0.6 : 0, W.fight.pip[vi.seed] - dmg);
        const big = last || kindAct === 'uppercut';
        W.burst('blood', vi.x + dir * 0.2, vi.y - 0.3, 5.3, big ? 26 : 9, big ? 8 : 5, [dir * 6, -1, 4]);
        W.shake = Math.max(W.shake, big ? 1.1 : 0.45); W.hitstop = big ? 0.1 : 0.04; W.crowd = 1;
        W.sfx('punch', { big });
        if (last && vi === lose) {
          W.fight.pip[vi.seed] = 0;
          land(B);
          if (p.ending === 'knockdown') {
            W.knock(vi, [dir * 11, 1, 10], [dir * 1.5, 0, 0]);
            if (vi.helmet) { vi.helmet = false; W.addDebris('helmet', [vi.x, vi.y, 5.8], [dir * 9, 1.5, 12], 0, 9, vi.side); }
            vi.bleeding = 3; W.burst('tooth', vi.x, vi.y, 5.2, 2, 5, [dir * 6, 0, 6]);
            W.banner = { text: 'K.O.', t0: W.t, dur: 1.3, col: '#ff5a3c' };
            win.grab = null; at(B, 0.5, () => W.act(win, 'celebrate', 1.4));
            at(B, 3.0, () => { if (vi.rag) W.getUp(vi, 1.2); });
          } else if (p.ending === 'jersey') {
            W.act(vi, 'cover', 1.6); vi.grab = null;
            W.banner = { text: 'TURTLE', t0: W.t, dur: 1.2, col: '#f0bd4c' };
          }
          B.overAt = W.t;
        }
      });
    }
    // the linesmen come in at the end whatever happened, and do the separating
    const tEnd = t + (p.ending === 'knockdown' ? 1.2 : 0.4);
    at(B, tEnd, () => {
      B.linesmen = true;
      W.officials.forEach((o, i) => { o.maxV = 18; o.target = i ? R : L; });
    });
    at(B, tEnd + 1.6, () => {
      L.grab = R.grab = null; L.guard = R.guard = false; B.grab = false; B.apart = true;
      W.officials.forEach((o, i) => W.act(o, 'hug', 2.2));
    });
    at(B, tEnd + 2.6, () => { cut('broadcast', [cx, cy]); W.fight.hud = false; });
    // off to the box, both of them, the linesmen trailing them
    at(B, tEnd + 3.6, () => { B.toBox = true; for (const [f, i] of [[L, 0], [R, 1]]) { if (f.rag) W.getUp(f, 0.8); leave(f, cx + (i ? 10 : -10)); } });
    at(B, tEnd + 5.0, () => finish(B));
    B.update = (dt, rel) => {
      const sep = B.grab ? 3.4 : 4.6, wob = 0.9 * Math.sin(rel * 1.1);
      if (!B.apart) {
        if (!L.rag) { L.tx = cx - sep / 2 + wob; L.ty = cy + 0.3 * Math.sin(rel * 2.3); }
        if (!R.rag) { R.tx = cx + sep / 2 + wob; R.ty = cy - 0.3 * Math.sin(rel * 2.3); }
      } else if (!B.toBox) {
        if (!L.rag) { L.tx = cx - 6; L.face = 0; } if (!R.rag) { R.tx = cx + 6; R.face = Math.PI; }
      }
      if (B.pull && !lose.rag) lose.jerseyUp = Math.min(1, lose.jerseyUp + dt * 2.5);
      const ko = lose.rag != null || B.overAt;
      for (const m of ring) {
        if (!m.ring || !m.active) continue;
        const a = m.ring.a + rel * 0.03 * (m.side === 'a' ? 1 : -1), rad = ko ? 10 + (m.seed % 3) * 1.5 : m.ring.rad;
        m.tx = cx + Math.cos(a) * rad; m.ty = cy + Math.sin(a) * rad * 0.8; m.maxV = ko ? 8 : 4; m.face = Math.atan2(cy - m.y, cx - m.x);
      }
      W.officials.forEach((o, i) => {
        if (!B.linesmen) return;
        const f = i ? R : L, fp = f.rag ? f.rag.pts[0] : f;
        o.tx = fp.x + (i ? 2.4 : -2.4); o.ty = fp.y + 1.4; o.face = Math.atan2(fp.y - o.y, fp.x - o.x);
        if (B.toBox) { o.tx = fp.x + (i ? 2 : -2); o.ty = fp.y + 2; }
      });
      const lp = L.rag ? L.rag.pts[0] : L, rp = R.rag ? R.rag.pts[0] : R;
      W.cam.focus = [(lp.x + rp.x) / 2, cy];
    };
    B.cleanup = () => {
      W.fight = null;
      for (const f of [L, R]) if (f.active && !busyBody(f) && (f.foe || !f.gloves)) leave(f);
      W.debris = W.debris.filter((d) => Math.hypot(d.x - cx, d.y - cy) > 14);
    };
    B.finishTo = B.cleanup;
    return B;
  }

  // ── the pulled goalie ─────────────────────────────────────────────────────
  function stagePull(p) {
    const B = begin('pull');
    const side = tagSide(p.pulledSide) || sideOfTeam(p.teamName, p) || 'a';
    const g = W.goalie[side];
    if (!g || !g.active) { land(B); at(B, 0.5, () => finish(B)); return B; }
    const bx = RL / 2 + (side === 'a' ? -24 : 24);
    g.scripted = true; B.ownsCam = true;
    land(B);
    B.update = (dt) => {
      const d = Math.hypot(bx - g.x, 2 - g.y), step = Math.min(d, 15 * dt);
      g.tx = g.x + (bx - g.x) / (d || 1) * step * 8; g.ty = g.y + (2 - g.y) / (d || 1) * step * 8;
      g.face = Math.atan2(2 - g.y, bx - g.x);
      W.cam.focus = [g.x, g.y + 10];
      if (g.y < 3.5 || W.t - B.t0 > 7) done();
    };
    function done() {
      if (!g.active) return;
      g.active = false; W.pulled[side] = true;
      const extra = W.team[side].find((b) => !b.active);
      if (extra) { fresh(extra); extra.active = true; place(extra, g.x, 2.5, Math.PI / 2); }
      at(B, 0.8, () => finish(B));
    }
    B.cleanup = () => done();
    return B;
  }

  // ── intermission ──────────────────────────────────────────────────────────
  // Everyone off, the Zamboni on. It laps the sheet laying clean ice, and the next period
  // starts on a fresh sheet whatever it got through.
  function stageIntermission(p) {
    const B = begin('intermission');
    D.intermission = { on: [...W.team.a, ...W.team.h].filter((b) => b.active) };
    for (const b of [...W.team.a, ...W.team.h, W.goalie.a, W.goalie.h, ...W.officials]) if (b) { b.active = false; b.hold = null; }
    medics.forEach((m) => { m.active = false; }); W.stretcher = null;
    pk.hidden = true; pk.carrier = null; pk.held = null; pk.inNet = null; pk.vx = pk.vy = 0;
    W.debris = []; W.limbs = []; W.parts = []; W.fight = null; W.lamp = 0;
    W.pulled.a = W.pulled.h = false;
    W.startZamboni(opts.zamboniSpeed || 22);
    cut('zam', [W.zamboni.x, W.zamboni.y]);
    B.ownsCam = true;
    land(B);
    B.update = () => { const z = W.zamboni; if (z) W.cam.focus = [z.x, z.y]; };
    B.cleanup = () => endIntermission();
    return B;
  }
  function endIntermission() {
    if (!D.intermission) return;
    W.zamboni = null;
    W.ice.reset(hash(`ice${W.t | 0}`));
    for (const side of ['a', 'h']) {
      W.team[side].forEach((b, i) => { fresh(b); b.active = b.slot < 5; });
      const g = W.goalie[side]; fresh(g); g.active = true; g.stick = true;
    }
    W.officials.forEach((o) => { fresh(o); o.active = true; o.stick = false; o.gloves = false; });
    pk.hidden = false;
    W.mourning = 0; D.mournTo = 0;
    D.intermission = null; D.needCut = true;
  }

  // ── the entry point ───────────────────────────────────────────────────────
  function stage(p) {
    if (!p) return null;
    dress(p);
    if (D.intermission && p.type !== 'intermission') { if (D.beat) D.beat.cleanup = null; endIntermission(); }
    switch (p.type) {
      case 'goal': case 'chance':
        if (Array.isArray(p.possession) && p.possession.length >= 2) return stageRush(p);
        break;
      case 'faceoff': return stageFaceoff(p);
      case 'boards': return stageHit(p, null);
      case 'injury': return stageInjury(p);
      case 'death': return stageDeath(p);
      case 'scrum': return stageScrum(p);
      case 'fight': return stageFight(p);
      case 'pull': return stagePull(p);
      case 'intermission': return stageIntermission(p);
    }
    const B = begin(p.type || 'beat'); land(B); at(B, 0.3, () => finish(B)); return B;
  }

  // the director's own tick, run by the world before anything else each step
  W.script = (dt) => {
    const B = D.beat;
    if (B && B.update) B.update(dt, W.t - B.t0);
    if (!B || !B.ownsCam) W.cam.focus = [pk.x, pk.y];
    if (D.tasks.length) D.tasks = D.tasks.filter((k) => !k.tick(dt));
    if (Math.abs(W.mourning - D.mournTo) > 0.001) W.mourning = lerp(W.mourning, D.mournTo, 1 - Math.exp(-dt * 0.7));
  };
  const prevEmit = W.emit;
  W.emit = (name, data) => { if (D.beat && D.beat.onEvent) D.beat.onEvent(name, data); (opts.emit || prevEmit)(name, data); };

  return {
    stage,
    // a beat that is only holding the picture for the next one isn't busy
    busy: () => !!D.beat && !D.beat.waiting,
    kind: () => (D.beat ? D.beat.kind : null),
    reset() { if (D.beat) { D.beat.cleanup?.(); D.beat = null; } releaseAll(); D.needCut = true; },
    state: D,
  };
}
