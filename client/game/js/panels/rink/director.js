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
// is ten seconds, a stretcher takes longer). Each beat leaves a `cleanup` that settles its
// lasting consequences (the man staying down, the fighter on his way to the box), so the
// next beat starts from a world that agrees with what was said.
//
// THE PICTURE NEVER CUTS. Nothing is put anywhere. A man skates to where a beat needs him;
// the puck is carried, passed, shot or handed there, and between a whistle and the draw a
// linesman carries it to the dot in his hand; the camera follows on its springs. The only
// place anybody appears is over the near boards, coming on from the bench. A beat that has
// to start somewhere the play isn't starts from where the play is instead.
//
// `onLand` fires at the moment the play lands (the shot arrives, the hit lands, the last
// punch). The view holds the announcer's line until then, so the words and the picture
// arrive together.

import { clamp, lerp, angWrap, rng, hash, hyp } from './util.js';
import { RL, RW, MID_Y, GOAL_X, NET_HALF, NET_H, DOT_FT, BOARD_H, GLASS_H, attackDir, insideRink, panelAt, PANEL_W, PANEL_X0, PANELS } from './geo.js';
import { SHOTS, releaseAt, bladeWorld, skaterRig } from './rig.js';
import { makeBody } from './sim.js';
import { createReplay } from './replay.js';
import { clubOf } from '../club-crest.js';

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
  // A club with an authored identity wears its own designed kit: home at home, road
  // away. `badge` is its crest and `club` the whole identity (the tartan lives there).
  const club = clubOf(name, 'hockey');
  const k = club?.kit?.[side === 'a' ? 'road' : 'home'];
  if (k && k.jersey) {
    return {
      jersey: k.jersey, trim: k.trim || '#ffffff', pants: k.pants || hexMix(k.jersey, -0.6), sock: k.sock || k.jersey,
      glove: k.glove || hexMix(k.jersey, -0.3), helmet: k.helmet || k.jersey, crest: 'o',
      number: k.number || k.trim, numberEdge: k.numberEdge || null, yoke: k.yoke || k.trim,
      hem: Array.isArray(k.hem) ? k.hem : null, sleeve: Array.isArray(k.sleeve) ? k.sleeve : null, socks: Array.isArray(k.socks) ? k.socks : null,
      body: k.body || null, badge: club.crest || null, club, clubName: name,
    };
  }
  const [c0, c1raw] = Array.isArray(colours) && colours.length ? colours : side === 'a' ? ['#c8382f', '#f2e4d0'] : ['#2f6fd0', '#e8f1fb'];
  const c1 = lum(c1raw || '#ffffff') > 0.6 ? c1raw : '#f1efe8';
  const crest = ['v', 'd', 'o'][hash(name || side) % 3];
  if (side === 'a') return { jersey: c1, trim: c0, pants: hexMix(c0, -0.55), sock: c1, glove: hexMix(c0, -0.3), helmet: c0, crest };
  return { jersey: c0, trim: c1, pants: hexMix(c0, -0.6), sock: c0, glove: hexMix(c0, -0.35), helmet: hexMix(c0, -0.15), crest };
}

export function createDirector(W, opts = {}) {
  const pk = W.puck;
  const D = { beat: null, names: { a: new Map(), h: new Map() }, mournTo: 0, kitsFor: '', tasks: [], gear: [] };
  // Things that outlive the beat that started them (a man skating to the box, a stretcher
  // on its way off) are `D.tasks`, ticked until done. `D.gear` is what a fight left lying on
  // the ice, which the referee picks up at the next stoppage.
  // the instant replay: it keeps the last ten seconds as they're played (see replay.js)
  const replay = createReplay(W);
  W.replay = replay;
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
    // he shoots the way he always has: about two in five of the league are righties
    b.hand = hash('hand:' + name) % 5 < 2 ? 'R' : 'L';
    if (D.beat) D.beat.locked.add(b);
    return b;
  }
  // he has left the ice: the name goes with him, so a spare who later wears this body
  // doesn't come back on as the same man
  function unname(b) {
    const map = D.names[b.side];
    if (map) for (const [n, x] of map) if (x === b) map.delete(n);
    b.name = '';
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
  // When the booth's line for `ev` airs, in seconds after the beat began, or null when the
  // payload carries no cue for it. The pacer writes these (sports/hockey-pacing.js), and the
  // director does each thing as its line airs.
  const cueAt = (p, ev, key, val) => (Array.isArray(p.cues) ? p.cues.find((q) => q.ev === ev && (key == null || q[key] === val)) || null : null);
  const cueOf = (p, ev, key, val) => {
    const c = cueAt(p, ev, key, val);
    return c ? c.ms / 1000 : null;
  };
  const sideOfTeam = (team, p) => (team && team === p.awayTeam ? 'a' : team && team === p.homeTeam ? 'h' : null);
  const tagSide = (tag) => (tag === 'att' ? 'a' : tag === 'def' ? 'h' : null);

  function dress(p) {
    // the identities can land after the first payload: dress again when they do
    const dressed = `${clubOf(p.awayTeam, 'hockey') ? 1 : 0}${clubOf(p.homeTeam, 'hockey') ? 1 : 0}`;
    const key = `${p.awayTeam || ''}|${p.homeTeam || ''}|${dressed}`;
    if (key === D.kitsFor) return;
    const sameClubs = D.kitsFor.startsWith(`${p.awayTeam || ''}|${p.homeTeam || ''}|`);
    D.kitsFor = key;
    W.kits.a = kitFor(p.awayColours, 'a', p.awayTeam);
    W.kits.h = kitFor(p.homeColours, 'h', p.homeTeam);
    // a re-dress mid-game changes sweaters, not the men in them
    if (sameClubs) return;
    const teams = `${p.awayTeam || ''}|${p.homeTeam || ''}`;
    D.names.a.clear(); D.names.h.clear();
    for (const side of ['a', 'h']) W.team[side].forEach((b) => { b.name = ''; b.num = numFor(`${teams}${side}${b.slot}`); });
  }

  // ── beats ─────────────────────────────────────────────────────────────────
  function begin(kind) {
    const prev = D.beat;
    if (prev) { prev.cleanup?.(); releaseAll(); }
    W.clearSchedule();
    // (a play that waited for a draw to go down keeps the time it arrived, so its lines'
    // cues still fall where the booth put them: see `stage`)
    const B = { kind, t0: D.arrived ?? W.t, update: null, cleanup: null, landed: false, locked: new Set(), ownsCam: false };
    D.arrived = null; D.fetcher = null;
    D.beat = B;
    W.cam.net = null; W.cam.drama = false;
    // each play says who goes for the puck: a man still on his way to it from the last one
    // goes back to his own business (or he'd chase it through whatever this play needs of
    // him); the puck slides on as it was, and a pass in the air still gets to its man
    W.uncollect();
    return B;
  }
  const at = (B, dt, fn) => W.schedule(dt, () => { if (D.beat === B) fn(); });
  function land(B) { if (B.landed) return; B.landed = true; opts.onLand?.(B.kind); }
  function finish(B) {
    if (D.beat !== B) return;
    land(B);
    D.beat = null;
    W.cam.net = null; W.cam.drama = false;
    releaseAll();
    opts.onDone?.(B.kind);
  }
  function releaseAll() {
    for (const b of [...W.team.a, ...W.team.h, W.goalie.a, W.goalie.h, ...W.officials]) {
      if (!b || busyBody(b)) continue;
      b.scripted = false; b.face = null; b.guard = false; b.grab = null; b.foe = null; b.target = null; b.stance = 0; b.charging = null;
      if (b.kind === 'goalie') { b.gloveHold = false; b.actHold = false; }
    }
    W.puckScripted = false; W.frozen = false; W.allowGoal = false;
    W.cam.mode = 'broadcast';
  }
  // What the camera should be looking at. It gets there on its springs (camera.js): the
  // picture never cuts.
  function frame(mode, focus) { W.cam.mode = mode || 'broadcast'; if (focus) W.cam.focus = focus; }
  // The replay is another moment, so going to it and coming back are the one change of
  // picture there is: made behind a wipe, the league's band swept across the screen, and
  // switched while it covers it (`from` 0.5 starts it already covering). The HUD draws it.
  const WIPE = 0.6;
  function wipe(from = 0) { W.wipe = { t0: W.t - from * WIPE, dur: WIPE }; }
  const busyBody = (b) => D.tasks.some((k) => k.bodies && k.bodies.includes(b));
  const leaving = (b) => D.tasks.some((k) => k.leave && k.bodies.includes(b));
  // Off to the near boards, where the benches and the box are. With `sub` the spare comes
  // on in his place; without, his side plays a man short (a penalty, the end of a period).
  function leave(b, gx, sub = true) {
    if (!b || !b.active || busyBody(b)) return;
    const x = clamp(gx ?? b.x, 40, RL - 40);
    b.scripted = true; b.foe = null; b.grab = null; b.guard = false; b.face = null;
    if (pk.carrier === b) W.loose(b.vx * 0.5, b.vy * 0.5);
    D.tasks.push({
      bodies: [b], leave: true,
      tick() {
        if (!b.active) return true;
        b.scripted = true; b.tx = x; b.ty = 1.6; b.maxV = 12;
        if (b.y < 3.4) { if (sub) substitute(b).scripted = false; else off(b); return true; }
        return false;
      },
    });
  }
  // he is off the ice: on the bench or in the box, his name with him
  function off(b) {
    b.active = false; b.carrying = false; b.hold = null; b.scripted = false;
    if (pk.carrier === b) W.loose(0, 0);
    if (b.kind === 'skater') unname(b);
  }
  // A man coming on: over the boards on the near side, by the benches, facing up the ice.
  // The one place anybody appears.
  function overBoards(b, x) {
    b.x = b.tx = b.x0 = clamp(x, 40, RL - 40); b.y = b.ty = b.y0 = 2.2; b.vx = b.vy = 0; b.h = Math.PI / 2;
    b.rag = null; b.blend = null; b.act = null; b.actT = 0; b.feet = null; b._va = null; b.turnRate = 0; b.amp = 0;
  }
  function fresh(b) {
    W.reequip(b); b.rag = null; b.blend = null; b.hold = null; b.down = false; b.missing = {}; b.blood = 0; b.bleeding = 0; b.fountain = null;
    b.jerseyUp = 0; b.react = 0; b.act = null; b.scripted = false; b.shatterNext = false;
  }
  function whistle() { W.sfx('whistle'); W.frozen = true; }
  // Back on his feet, he picks his stick up off the ice if it's at his feet. One that flew
  // farther stays where it is (he has a spare from the bench) for the referee to collect.
  function pickUpStick(b) {
    let best = -1, bd = 1e9;
    W.debris.forEach((d, i) => { if (d.kind === 'stick' && d.side === b.side) { const dd = hyp(d.x - b.x, d.y - b.y); if (dd < bd) { bd = dd; best = i; } } });
    if (best >= 0 && bd < 4) W.debris.splice(best, 1);
    else if (best >= 0 && !D.gear.includes(W.debris[best])) D.gear.push(W.debris[best]);
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
    unname(b);
    fresh(bench);
    bench.active = true; overBoards(bench, b.x);
    bench.name = ''; bench.num = numFor(`${side}${slot}${bench.seed}${W.t | 0}`);
    return bench;
  }

  // How many skaters each side should have on for the strength the sim gives a play (a man
  // short for a penalty, one extra for a pulled goalie). The surplus skate off to the bench,
  // the ones farthest from the puck and out of the play first, and a short side sends a man
  // over the boards: nobody blinks in or out.
  function lineUp(att, strength) {
    const want = { a: 5, h: 5 };
    if (strength === 'pp') want[other(att)] = 4;
    if (strength === 'sh') want[att] = 4;
    for (const side of ['a', 'h']) {
      if (W.pulled[side]) want[side] += 1;
      const on = W.team[side].filter((b) => b.active && !leaving(b) && !b.hold);
      const spare = on.filter((b) => !b.scripted && !busyBody(b) && pk.carrier !== b && !(D.beat && D.beat.locked.has(b)))
        .sort((p, q) => hyp(q.x - pk.x, q.y - pk.y) - hyp(p.x - pk.x, p.y - pk.y));
      let n = on.length;
      while (n > want[side] && spare.length) { leave(spare.shift(), null, false); n--; }
      const bench = W.team[side].filter((b) => !b.active);
      while (n < want[side] && bench.length) { const b = bench.shift(); fresh(b); b.active = true; overBoards(b, pk.x); n++; }
    }
  }

  // ── stoppages ─────────────────────────────────────────────────────────────
  // Where each man lines up for a draw on (dx, dy): his centre on the dot, the wingers on
  // the hash marks, the D behind them, an extra man (a pulled goalie's) in the high slot.
  function spotFor(m, side, dx, dy, centre) {
    const dir = attackDir(side);
    let x = dx - dir * 2.2, y = dy;
    if (m === centre) x = dx - dir * 2.0;
    else if (m.slot === 5) { x = dx - dir * 9; y = dy + (side === 'a' ? -5 : 5); }
    else if (m.slot === 0 || m.slot === 2) { const s = (m.slot === 0) === (side === 'a') ? 1 : -1; x = dx - dir * 3.5; y = dy + s * 13; }
    else if (m.slot === 3 || m.slot === 4) { const s = (m.slot === 3) === (side === 'a') ? 1 : -1; x = dx - dir * 15; y = dy + s * 9; }
    return [clamp(x, 6, RL - 6), clamp(y, 4, RW - 4)];
  }
  const centreOf = (side) => { const ms = W.mates(side).filter((m) => !busyBody(m) && !m.hold); return ms.find((m) => m.slot === 1) || ms[0] || null; };
  // The linesman goes and gets the puck: out of the goalie's glove, out of the net, off the
  // man who has it (he stops and gives it up), or off the ice. Called every step; true once
  // it's in his hand.
  // A man with the puck flips it to him once he's within a few strides; one already flipped
  // (`pk.toOfficial`) is caught when it gets to him.
  function fetchPuck(o) {
    if (pk.held === o) return true;
    const hd = pk.held, c = pk.carrier;
    let tx = pk.x + pk.vx * 0.3, ty = pk.y + pk.vy * 0.3, reach = 2.6;
    if (hd && hd.kind === 'goalie') {
      tx = hd.x + attackDir(hd.side) * 2.4; ty = hd.y - 1.2; reach = 5;
      // the goalie tosses it out to him once he's coming
      const d = hyp(o.x - pk.x, o.y - pk.y);
      if (d < 30 && d > reach) {
        hd.gloveW = 0; hd.gloveHold = false; hd.actHold = false;
        const sp = clamp(d * 1.1, 12, 30), tt = d / sp;
        W.loose((o.x - pk.x) / d * sp + o.vx * 0.5, (o.y - pk.y) / d * sp + o.vy * 0.5, Math.min(9, 16 * tt));
        pk.toOfficial = { o, at: W.t };
      }
    }
    else if (hd) return false;     // the other official has it
    else if (pk.inNet) { tx = (pk.inNet === 'a' ? GOAL_X[0] : GOAL_X[1]) + attackDir(pk.inNet) * 1.2; ty = MID_Y - 1; reach = 6; }
    else if (c) {
      c.scripted = true; c.tx = c.x; c.ty = c.y; c.maxV = 5;
      const d = hyp(o.x - pk.x, o.y - pk.y);
      if (d < 40 && c.stick) {
        // a soft flip, lobbed to him
        const sp = clamp(d * 1.1, 14, 34), tt = d / sp;
        W.act(c, 'pass', SHOTS.pass.dur);
        W.loose((o.x - pk.x) / (d || 1) * sp + o.vx * 0.5, (o.y - pk.y) / (d || 1) * sp + o.vy * 0.5, Math.min(9, 16 * tt));
        pk.toOfficial = { o, at: W.t }; c.scripted = false;
      } else { tx = c.x; ty = c.y - 3; reach = 5; }
    }
    // (a toss that falls short, or one he's waited on long enough, is a loose puck he goes and gets)
    const tossed = pk.toOfficial && pk.toOfficial.o === o && !pk.carrier && !pk.held;
    const flipped = tossed && W.t - pk.toOfficial.at < 1.4 && (pk.z > 0.3 || hyp(pk.vx, pk.vy) > 8);
    if (flipped) { tx = o.x; ty = o.y; reach = 3.5; }
    else if (!hd && !c && !pk.inNet && !pk.home) {
      // loose, with a man well nearer it than he is: that man picks it up (and then flips it
      // to him, as above)
      const dl = hyp(pk.x - o.x, pk.y - o.y);
      let near = null, dn = 1e9;
      for (const m of W.skaters()) { if (!m.stick || m.rag || m.blend || busyBody(m) || m.hold) continue; const e = hyp(m.x - pk.x, m.y - pk.y); if (e < dn) { dn = e; near = m; } }
      if (near && dn < 30 && dn + 15 < dl) W.collect(near);
    }
    // (flat out: a man eases up on his own as he arrives, see stepBody)
    o.scripted = true; o.tx = tx; o.ty = ty; o.maxV = hyp(tx - o.x, ty - o.y) > 40 ? 25 : 22; o.face = null;
    if (hyp(pk.x - o.x, pk.y - o.y) < reach && (hd || c || pk.inNet || flipped || (pk.z < 1 && hyp(pk.vx, pk.vy) < 20))) {
      if (hd) { hd.gloveW = 0; hd.gloveHold = false; hd.actHold = false; }
      W.loose(0, 0); pk.inNet = null; pk.held = o; pk.toOfficial = null;
      return true;
    }
    return false;
  }
  // The official who brings the puck to a draw: whichever has it, else whichever of the two
  // is nearer it (they work either side of the play, so one usually is).
  // (chosen once and kept until he has it, so the two don't swap jobs as they move)
  const dropper = () => {
    if (pk.held && pk.held.kind === 'official' && pk.held.active) return (D.fetcher = pk.held);
    const ok = W.officials.filter((o) => o.active && !o.rag && !busyBody(o));
    if (D.fetcher && ok.includes(D.fetcher)) return D.fetcher;
    return (D.fetcher = ok.reduce((b, o) => (!b || hyp(o.x - pk.x, o.y - pk.y) < hyp(b.x - pk.x, b.y - pk.y) ? o : b), null) || W.officials[0]);
  };
  // Everybody to the draw on `dot`: an easy skate back after a whistle, brisk for the
  // faceoff itself. The linesman fetches the puck and brings it; the referee collects any
  // gear left on the ice on his way to his spot by the far boards.
  function toSpots(dot, brisk) {
    const [dx, dy] = DOT_FT[dot] || DOT_FT.C;
    for (const side of ['a', 'h']) {
      const centre = centreOf(side);
      for (const m of W.mates(side)) {
        // (the man with the puck stops and gives it to the linesman first: fetchPuck)
        if (busyBody(m) || m.hold || m.rag || m.blend || pk.carrier === m) continue;
        if (!m.stick && m.gloves) m.stick = true;
        const [x, y] = spotFor(m, side, dx, dy, centre), d = hyp(x - m.x, y - m.y);
        m.scripted = true; m.tx = x; m.ty = y; m.guard = false; m.foe = null; m.grab = null;
        // (no faster than he can stop from, so he pulls up on his spot rather than past it)
        m.maxV = Math.min(brisk ? 25 : 15, Math.sqrt(2 * 18 * d) + 1);
        m.face = d < 5 ? (attackDir(side) > 0 ? 0 : Math.PI) : null;
      }
      const g = W.goalie[side];
      if (g && g.active && !g.rag && pk.held !== g) { g.scripted = true; g.tx = (side === 'a' ? GOAL_X[0] : GOAL_X[1]) + attackDir(side) * 3; g.ty = MID_Y; g.face = side === 'a' ? 0 : Math.PI; }
    }
    const lin = dropper(), ref = W.officials.find((o) => o !== lin);
    // With it, to just off the dot on the near side, out of the centres' way, facing up the
    // ice the way they don't; he steps in to drop it once they're set (stageFaceoff).
    if (lin && lin.active && !lin.rag && fetchPuck(lin)) {
      const tx = dx - 0.3, ty = dy - 6.5, d = hyp(tx - lin.x, ty - lin.y);
      lin.scripted = true; lin.tx = tx; lin.ty = ty; lin.maxV = Math.min(brisk ? (d > 40 ? 25 : 22) : 14, Math.sqrt(2 * 18 * d) + 1);
      lin.face = d < 4 ? Math.PI / 2 : null;
    }
    if (ref && ref.active && !ref.rag) {
      ref.scripted = true; ref.maxV = 14;
      let gi = -1, gd = 1e9;
      D.gear = D.gear.filter((q) => W.debris.includes(q));
      D.gear.forEach((q, i) => { const e = hyp(q.x - ref.x, q.y - ref.y); if (e < gd) { gd = e; gi = i; } });
      if (gi >= 0) {
        const q = D.gear[gi]; ref.tx = q.x; ref.ty = q.y - 1.2; ref.face = null;
        if (gd < 2.2) { W.debris.splice(W.debris.indexOf(q), 1); D.gear.splice(gi, 1); }
      } else { ref.tx = clamp(dx + 22, 30, RL - 30); ref.ty = RW - 6; ref.face = Math.atan2(dy - ref.y, dx - ref.x); }
    }
  }
  // The whistle has gone and a draw is coming: `dot` is where (the payload's `nextDot`; the
  // server knows what the sim did next). The beat stops being busy but holds the picture,
  // and everybody makes his way there, so the faceoff's own beat usually finds them set.
  // Without a dot the linesman still collects the puck and the rest coast to a stop.
  // (`busy`: the beat still has its own business to finish, a man on a stretcher, and says
  // so until it's done)
  function stopPlay(B, dot, busy = false) {
    if (!B.stopped) {
      B.stopped = true; B.regroup = DOT_FT[dot] ? dot : null;
      W.frozen = true; W.puckScripted = true; W.allowGoal = false;
    }
    if (!busy && !B.waiting) { B.waiting = true; opts.onDone?.(B.kind); }
  }
  function regroupTick(B) {
    // (brisk: a broadcast's stoppage is a few seconds of lines, not a real one's half minute)
    if (B.regroup) { toSpots(B.regroup, true); return; }
    const lin = dropper();
    if (lin && lin.active && !lin.rag && fetchPuck(lin)) { lin.tx = lin.x; lin.ty = lin.y; }
  }
  // A live play starts with the puck in play: a linesman still holding one from a stoppage
  // that never got its draw drops it where he stands.
  function puckInPlay() {
    if (pk.held && pk.held.kind === 'official') { const o = pk.held; W.loose(0, 0, -1); W.act(o, 'drop', 0.6); }
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
        const side = Math.sign(MID_Y - gy) || s, tx = gx + dir * 1.8;
        let ty = MID_Y + side * (1.4 + r() * 1.1);
        // and in through the mouth from where it's shot: from a sharp angle the line to that
        // spot would cross the goal line outside the post, so it goes to the far side instead
        const f = (pk.x - gx) / (pk.x - tx);
        if (f > 0 && f < 1) {
          const yc = pk.y + (ty - pk.y) * f, lim = NET_HALF - 0.45;
          if (Math.abs(yc - MID_Y) > lim) ty = clamp(pk.y + (MID_Y + Math.sign(yc - MID_Y) * lim - pk.y) / f, MID_Y - NET_HALF + 0.3, MID_Y + NET_HALF - 0.3);
        }
        return { tgt: [tx, ty, low ? 0.25 + r() * 0.5 : 2.5 + r() * 1.0], low };
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
    nodes.forEach((n, i) => { n.oi = i; });
    if (Array.isArray(p.cues) && p.cues.length) {
      // the picture plays the touches the booth calls, each as its line airs: the breakout,
      // the called touches and the shot. A touch nobody mentions would only make the rush
      // late for the next line.
      const called = new Set(p.cues.filter((c) => c.ev === 'node').map((c) => c.i));
      nodes = nodes.filter((n, i) => i === 0 || i >= nodes.length - 2 || called.has(i));
    } else {
      const L = nodes.length, legTime = (a, b) => {
        const d = hyp(b.x - a.x, b.y - a.y);
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
    const script = (b) => { b.scripted = true; B.locked.add(b); return b; };
    lineUp(att, p.strength);
    puckInPlay();

    // A PLAY STARTS FROM THE LIVE PICTURE. The man of his side best placed for it goes and
    // gets the puck from wherever it is: off a man of the other side with a poke once he
    // gets to him, out of his own goalie's glove, out of the net or off the ice. It's never
    // put on his stick. The touches behind it are skipped: the picture joins the rush where
    // the puck is, and the booth has said the build-up in words.
    // (a man on his way off, to the bench or the box, is no part of it)
    const free = (m) => m && m.active && !m.rag && !m.hold && !busyBody(m);
    const able = (m) => free(m) && m.stick;
    // (best placed: whoever can get to it soonest, the puck moving as it is, not just whoever
    // is nearest it now: a cleared puck is run down by the man it's going toward)
    const etaOf = (m) => { const q = W.intercept(m, 24); return hyp(q[0] - m.x, q[1] - m.y) / 24; };
    const soonest = (list) => list.reduce((b, m) => { const t = etaOf(m); return !b || t < b.t ? { m, t } : b; }, null)?.m || null;
    // (a pass in the air from the last play is still a pass: to one of his side, the play is
    // his once he takes it; to one of theirs, he takes it off that man once he has it)
    const passTo = !pk.carrier && !pk.held && pk.target && able(pk.target) ? pk.target : null;
    let cur = pk.carrier && pk.carrier.side === att && able(pk.carrier) ? pk.carrier
      : passTo && passTo.side === att ? passTo
      : (!pk.carrier && !pk.held ? soonest(W.mates(att).filter(able)) : W.nearestOf(W.mates(att).filter(able), pk.x, pk.y)) || W.mates(att).find(able) || W.mates(att)[0];
    let li = 1;
    while (li < nodes.length - 2 && (nodes[li].x - pk.x) * dir < -12) li++;
    const foe = pk.carrier && pk.carrier.side !== att ? pk.carrier : passTo && passTo.side !== att ? passTo : null;
    script(cur);
    if (passTo === cur) cur.meetPass = W.t + 3;
    if (pk.held && pk.held.kind === 'goalie') {
      // out of the goalie's glove: his own plays it to him; theirs coughs it up
      const g0 = pk.held; g0.gloveW = 0; g0.gloveHold = false; g0.actHold = false;
      if (g0.side === att) { pk.held = null; W.pass(g0, cur, 45); }
      else { W.loose(0, 0); W.collect(cur); }
    } else if (!foe && passTo !== cur && !W.give(cur)) W.collect(cur);
    const slotBody = (k) => W.mates(att).find((m) => m.slot === k) || null;
    const names = Array.isArray(p.rushNames) && p.rushNames.length ? p.rushNames : null;
    const nameOf = (k) => (names && k >= 0 ? names[((k % names.length) + names.length) % names.length] : null);
    // The man the booth starts the rush with is the man who starts it here: he wears that
    // name (and a later touch the booth gives the same man stays his, below).
    if (nameOf(nodes[0].carrier)) nameBody(cur, nameOf(nodes[0].carrier));
    // The man who takes a touch: the one already wearing the name the booth gives it, if he
    // can play it; else the one in that slot, unless he's out of the play (40 ft or more from
    // it), when it's whoever of his side is nearest. Either way he wears the name, so the
    // call and the sweater agree. Chosen once per touch.
    const touchBody = (nd) => {
      if (nd.carrier < 0) return null;
      if (nd.body !== undefined) return nd.body;
      const nm = nameOf(nd.carrier);
      let b = nm ? D.names[att].get(nm) : null;
      if (b && !(b === cur ? able(b) : able(b) && hyp(b.x - nd.x, b.y - nd.y) <= 40)) b = null;
      if (!b) {
        b = slotBody(nd.carrier);
        if (!able(b) || hyp(b.x - nd.x, b.y - nd.y) > 40) b = W.nearestOf(W.mates(att).filter((m) => m !== cur && able(m)), nd.x, nd.y) || b;
      }
      if (b && nm) nameBody(b, nm);
      nd.body = b;
      return b;
    };
    // With the other side carrying it, the first thing he does is go and take it off them.
    // When the booth calls a takeaway and nobody of theirs has it yet, it's theirs first: their
    // man best placed for a loose puck goes and gets it, and he goes after that man (a
    // `forecheck`) and takes it off him as the line airs. If it's on his own stick already,
    // their nearest man comes at him and loses the battle for it (a `challenge`).
    const tk = cueOf(p, 'takeaway');
    let leg = foe ? { kind: 'win', t: 0, from: foe } : null, lastPasser = null;
    if (!leg && tk != null && !pk.held) {
      const mine = pk.carrier === cur;
      const rival = mine ? W.nearestOf(W.mates(def).filter(free), pk.x, pk.y) : soonest(W.mates(def).filter(able));
      if (rival) {
        script(rival);
        if (mine) { cur.tx = nodes[li].x; cur.ty = nodes[li].y; cur.maxV = 14; leg = { kind: 'challenge', t: 0, rival }; }
        else { W.collect(rival); leg = { kind: 'forecheck', t: 0, rival }; }
      }
    }

    function nextLeg() {
      if (D.beat !== B) return;
      // nothing is played until he actually has it: a pass on its way to him he takes as it
      // comes, and anything else he goes and gets
      if (pk.carrier !== cur) { if (pk.home !== cur && pk.target !== cur) W.collect(cur); leg = { kind: 'fetch', t: 0 }; return; }
      if (li >= nodes.length - 2) { shotLeg(); return; }
      // the line for this touch hasn't aired yet: move toward it, timed to arrive with it
      const want = cueOf(p, 'node', 'i', nodes[li].oi);
      if (want != null && W.t - B.t0 < want - 0.05) {
        const nd = nodes[li], tb = touchBody(nd);
        const passing = tb && tb !== cur && nd.ev !== 'battle' && nd.ev !== 'dump';
        if (passing) { script(tb); cur.tx = lerp(cur.x, nd.x, 0.25); cur.ty = lerp(cur.y, nd.y, 0.25); }
        leg = { kind: 'wait', until: want, mover: passing ? tb : cur, tx: nd.x, ty: nd.y, t: 0 };
        return;
      }
      // A dump goes in from about where the sim had it. From well short of that (his own
      // end, when the play joined where the puck was) it would be icing, and it would leave
      // his side chasing it the length of the ice: he carries it up there first.
      if (nodes[li].ev === 'dump' && (nodes[li].x - cur.x) * dir > 30) {
        const up = nodes[li];
        cur.tx = up.x; cur.ty = up.y; cur.maxV = 24;
        leg = { kind: 'carry', up: true, t: 0, dist: hyp(up.x - cur.x, up.y - cur.y), tx: up.x, ty: up.y };
        return;
      }
      // Nor is anything passed the length of the ice: a receiver more than 85 ft off is a
      // punt that dies in a corner. He carries it up until it's a pass (to 55 ft of him).
      {
        const up = nodes[li], tb0 = up.ev !== 'battle' && up.ev !== 'dump' ? touchBody(up) : null;
        const far = tb0 && tb0 !== cur ? hyp(tb0.x - cur.x, tb0.y - cur.y) : 0;
        if (far > 85) {
          const k = (far - 55) / far, tx = cur.x + (tb0.x - cur.x) * k, ty = cur.y + (tb0.y - cur.y) * k;
          cur.tx = tx; cur.ty = ty; cur.maxV = 24;
          leg = { kind: 'carry', up: true, t: 0, dist: hyp(tx - cur.x, ty - cur.y), tx, ty };
          return;
        }
      }
      const nd = nodes[li], nx = nodes[li + 1];
      li++;
      const tb = touchBody(nd);
      if (nd.ev === 'battle' || nd.ev === 'dump') {
        // whoever can get there first goes after it (the man the booth names on the next
        // touch, if he's about as close), so the puck is run down rather than waited for
        // A dump is put in from where he stands (the node) to where it's next touched, or
        // deep into the corner if that's no distance; a battle squirts it to the node.
        let gx = nd.x, gy = nd.y;
        if (nd.ev === 'dump') {
          if (hyp(nx.x - nd.x, nx.y - nd.y) > 20) { gx = nx.x; gy = nx.y; }
          else { gx = clamp(netX + dir * 5, 8, RL - 8); gy = nd.y > MID_Y ? RW - 7 : 7; }
        }
        const named = nx.carrier >= 0 ? slotBody(nx.carrier) : null;
        const reachT = (m) => hyp(m.x - gx, m.y - gy) / 22 - (m === named ? 0.6 : 0) + (m === cur ? 0.8 : 0);
        const chaser = W.mates(att).filter(able).reduce((best, m) => (!best || reachT(m) < reachT(best) ? m : best), null) || cur;
        const foe = W.nearestOf(W.mates(def).filter(free), nd.x, nd.y);
        if (nd.ev === 'dump') {
          W.act(cur, 'dump', 0.45);
          // the chase only starts once it's left his stick
          const dumper = cur;
          at(B, 0.2, () => { if (!leg || leg.kind !== 'chase' || pk.carrier !== dumper) return; W.dumpTo(dumper, gx, gy, 62); leg.armed = true; });
        } else {
          // rubbed off it: the puck squirts toward where the battle is
          const nearFoe = W.nearestOf(W.mates(def), cur.x, cur.y);
          if (nearFoe && hyp(nearFoe.x - cur.x, nearFoe.y - cur.y) < 12) { W.act(nearFoe, 'poke', 0.35); }
          W.act(cur, 'stagger', 0.5); cur.react = 0.4;
          const d = hyp(nd.x - pk.x, nd.y - pk.y) || 1, sp = clamp(d * 1.4, 14, 50);
          W.loose((nd.x - pk.x) / d * sp, (nd.y - pk.y) / d * sp, 0);
          W.settleAt(nd.x, nd.y);
          W.sfx('stick');
        }
        cur.scripted = false;
        script(chaser);
        if (foe) script(foe);
        leg = { kind: 'chase', chaser, foe, t: 0, armed: nd.ev !== 'dump' };
        return;
      }
      if (tb && tb !== cur) {
        // a pass to the man who carries the next touch: he skates to the spot and it meets him
        script(tb);
        tb.tx = nd.x; tb.ty = nd.y; tb.maxV = 22;
        const lu = (tb.x - cur.x) * Math.cos(cur.h) + (tb.y - cur.y) * Math.sin(cur.h);
        const lv = -(tb.x - cur.x) * Math.sin(cur.h) + (tb.y - cur.y) * Math.cos(cur.h);
        // a drop pass is for a man right behind him; farther back it's played firmly; and it's
        // lifted only when the booth called a saucer (the kind rides on the touch's cue)
        const pd = hyp(tb.x - cur.x, tb.y - cur.y), said = cueAt(p, 'node', 'i', nd.oi);
        const pkind = said && said.pass === 'saucer' ? 'saucer' : lu < -3 && pd < 14 ? 'drop' : (lv < -4 && lu < 8) || lu < -3 ? 'backpass' : 'pass';
        W.act(cur, pkind, SHOTS[pkind].dur); cur.look = [tb.x, tb.y, 1];
        const from = cur, pass = { kind: 'pass', to: tb, from: cur, t: 0 };
        // (a shot called before it's away takes the leg over, and he keeps the puck to shoot)
        at(B, releaseAt(pkind), () => {
          if (leg !== pass) return;
          // led to where he'll be on his way to the touch's spot when it gets to him
          const spd = pkind === 'drop' ? clamp(pd * 1.8, 16, 28) : 64 + r() * 14;
          W.give(from); pass.made = W.pass(from, tb, spd);
          tb.meetPass = W.t + 3;
          if (pkind === 'saucer') pk.vz = 7;
          W.act(tb, 'receive', 0.6, [from.x, from.y]);
        });
        lastPasser = cur;
        leg = pass;
        return;
      }
      // carry it there himself; a deke beats the man standing him up on the way
      cur.tx = nd.x; cur.ty = nd.y; cur.maxV = 22;
      if (nd.ev === 'deke') {
        const front = W.nearestOf(W.mates(def).filter(free), nd.x, nd.y);
        if (front) { script(front); front.tx = lerp(cur.x, nd.x, 0.6); front.ty = lerp(cur.y, nd.y, 0.6); front.maxV = 16; front.face = Math.atan2(cur.y - front.y, cur.x - front.x); }
        leg = { kind: 'carry', deke: front, t: 0, dist: hyp(nd.x - cur.x, nd.y - cur.y) };
      } else leg = { kind: 'carry', t: 0, dist: hyp(nd.x - cur.x, nd.y - cur.y) };
      leg.tx = nd.x; leg.ty = nd.y;
    }

    function shotLeg() {
      const sn = nodes[nodes.length - 2];
      // a shot is coming: the camera brings the net into frame now, before the puck is away
      W.cam.net = netX;
      // in alone: the banner goes up as the booth calls it, the camera moves in, and the
      // nearest two defenders chase from behind
      if (kind === 'breakaway' || (kind === 'goal' && p.breakaway)) {
        const al = cueOf(p, 'alone'), wait = al != null ? Math.max(0, al - (W.t - B.t0)) : 0;
        at(B, wait, () => { W.banner = { text: 'BREAKAWAY!', sub: surname(p.shooter).toUpperCase(), t0: W.t, dur: 1.9, col: '#f0bd4c' }; W.crowd = 1; W.cam.drama = true; W.sfx('roar'); });
        B.chasers = W.mates(def).filter(free).sort((a2, b2) => hyp(a2.x - cur.x, a2.y - cur.y) - hyp(b2.x - cur.x, b2.y - cur.y)).slice(0, 2);
        B.chasers.forEach((m) => script(m));
      }
      // The shot is the best-placed man's: the one with the puck, the one a pass is on its way
      // to, or whoever of his side will get to a loose one first. The booth's name goes on him
      // (below). Waiting for the named man to get it from wherever he was cost seconds.
      {
        const have = pk.carrier && pk.carrier.side === att && able(pk.carrier) ? pk.carrier
          : pk.target && pk.target.side === att && able(pk.target) ? pk.target : null;
        if (have && have !== cur) { if (cur && cur !== have) cur.scripted = false; cur = script(have); }
        else if (!have && !pk.held && !(pk.carrier && pk.carrier.side === def)) {
          const s0 = soonest(W.mates(att).filter(able));
          if (s0 && s0 !== cur) { if (cur) cur.scripted = false; cur = script(s0); }
          if (cur && pk.home !== cur && pk.carrier !== cur) W.collect(cur);
        }
      }
      let shooter = cur, setup = null;
      if ((type === 'onetimer' || type === 'tip') && W.mates(att).length > 1) {
        // a one-timer and a tip need somebody else to put it there
        const mate = W.nearestOf(W.mates(att).filter((m) => m !== cur && able(m)), sn.x, sn.y);
        if (mate) {
          shooter = script(mate);
          if (type === 'tip') { mate.tx = netX - dir * 7; mate.ty = MID_Y + (r() - 0.5) * 6; } else { mate.tx = sn.x; mate.ty = sn.y; }
          mate.maxV = 20;
          setup = cur;
        }
      }
      nameBody(shooter, p.shooter);
      // (the man who feeds a one-timer or a tip is the one the booth named: the shot's cue
      // carries him when it named one)
      const feeder = p.assist || (cueAt(p, 'shot') || {}).feeder;
      if (feeder && setup) nameBody(setup, feeder);
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
        leg = { kind: 'approach', t: 0, shooter, sx: sn.x, sy: sn.y };
      }
      // a block needs a body in the lane before the shot
      if (kind === 'blocked') {
        const fin = nodes[nodes.length - 1];
        const bl = W.nearestOf(W.mates(def).filter(free), fin.x, fin.y);
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
      // he can only shoot what's on his stick: one he hasn't got yet he goes and gets first
      // (and only as a last resort, eight seconds on, is it put on his stick wherever it is)
      if (pk.carrier !== shooter && (B.shotWait = (B.shotWait || 0) + 1) < 80) {
        if (pk.home !== shooter) W.collect(shooter);
        at(B, 0.1, () => shoot(shooter));
        return;
      }
      W.act(shooter, T, SHOTS[T].dur);
      if (T === 'slap' || T === 'onetimer') { shooter.tx = shooter.x + shooter.vx * 0.5; shooter.ty = shooter.y + shooter.vy * 0.5; shooter.maxV = 8; }
      if (leg && leg.blocker) W.act(leg.blocker, 'block', 0.9);
      at(B, releaseAt(T), () => {
        if (pk.carrier !== shooter) W.give(shooter, true);
        let a;
        if (kind === 'blocked' && leg && leg.blocker) { const bl = leg.blocker; a = { tgt: [bl.x - dir * 0.8, bl.y, 0.3] }; }
        else a = aim(kind, shooter, def, T, r);
        if (kind === 'goal') W.allowGoal = def;
        const tt = W.shoot(shooter, a.tgt, SPEED[T] || 80, T);
        W.sfx('shot', { type: T });
        react(a, tt);
      });
    }

    // A frozen puck is a goalie under pressure: two of them crash his crease as he covers
    // it, which is why he holds it rather than playing it.
    function pressure() {
      const crash = W.mates(att).filter((m) => !m.rag && !busyBody(m)).sort((a2, b2) => hyp(a2.x - netX, a2.y - MID_Y) - hyp(b2.x - netX, b2.y - MID_Y)).slice(0, 2);
      crash.forEach((m, i) => { script(m); m.tx = netX - dir * (4.5 + i * 2); m.ty = MID_Y + (i ? 3.2 : -3.2); m.maxV = 22; m.face = dir > 0 ? 0 : Math.PI; });
      if (g && g.active) { W.act(g, 'cover', 0.5); g.actHold = true; }
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
          // Whatever the puck did on the way, a goal ends in the net: steered in through the
          // mouth if it hasn't gone in. The goal is called on time even if it's still on its
          // way, and the steering carries on until it's in.
          at(B, tt + 1.2, () => { if (!B.scored) { B.seekNet = true; if (pk.carrier || pk.held) W.loose(pk.vx, pk.vy); } });
          at(B, tt + 3.0, () => { if (!B.scored) { B.scored = true; goal(); } });
          break;
        case 'glove':
          if (gl) { gl.gloveTarget = a.tgt; gl.gloveHold = true; B.gloveRamp = { g: gl, from: W.t + lead * 0.5, dur: Math.max(0.12, tt * 0.7) }; }
          at(B, tt, () => { if (gl) { pk.held = gl; gl.gloveW = 1; } W.sfx('glove'); W.crowd = 0.7; land(B); if (p.frozen) pressure(); });
          // held under pressure, it's a whistle and a draw in this end; with nobody on him
          // he looks up and plays it to a defenceman (the world's own hockey does that)
          if (p.frozen) at(B, tt + 0.5, () => { whistle(); at(B, 0.6, () => stopPlay(B, p.nextDot)); });
          else at(B, tt + 1.8, () => { W.amb.holdUntil = W.t + 0.6; finish(B); });
          break;
        case 'save':
          if (gl) at(B, lead, () => W.act(gl, 'chest', 0.55));
          at(B, tt, () => {
            W.sfx('chest'); land(B);
            if (p.frozen && gl) { pk.held = gl; gl.gloveHold = true; gl.gloveTarget = [gl.x + fwd[0] * 0.9, gl.y + fwd[1] * 0.9, 2.5]; gl.gloveW = 1; pressure(); at(B, 0.45, () => { whistle(); at(B, 0.6, () => stopPlay(B, p.nextDot)); }); }
            else W.loose(-dir * (10 + r() * 8), (r() - 0.5) * 24, 1.5);
          });
          if (!(p.frozen && gl)) at(B, tt + 1.8, () => { W.amb.holdUntil = W.t + 2; finish(B); });
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
      // then back to centre for the draw, the linesman fishing the puck out of the net (a
      // goal that ends the game has no draw after it, and they just keep celebrating)
      at(B, 4.2, () => { W.cam.mode = 'broadcast'; stopPlay(B, p.nextDot === undefined ? 'C' : p.nextDot); });
      // The replay, when the booth calls for it: the last five seconds and a moment after,
      // at half speed, in and out behind a wipe. Scheduled on the world, not the beat; a new
      // play coming in cancels it.
      const rc = cueOf(p, 'replay');
      // (the recording stops a moment after the goal, so the run-up is still there however
      // long the booth takes to call the replay)
      D.recordUntil = W.t + 2;
      if (rc != null) {
        const goalT = W.t, seq = D.seq, wait = Math.max(1.7, B.t0 + rc - W.t);
        W.schedule(wait, () => {
          if (D.seq !== seq) return;
          wipe();
          W.schedule(WIPE / 2, () => {
            if (D.seq !== seq || !replay.start(goalT - 5, goalT + 1.5, 0.5)) return;
            W.schedule(Math.max(0, replay.left() - WIPE / 2), () => { if (D.seq === seq && replay.active) wipe(); });
          });
        });
      }
    }

    B.onEvent = (name) => { if (name === 'goalIn' && kind === 'goal' && !B.scored) { B.scored = true; goal(); } };

    B.update = (dt) => {
      if (B.stopped) return;
      W.cam.focus = [pk.x, pk.y];
      // the man it's on gone (off the ice, flattened): the nearest of his side takes over
      if (!B.scored && leg && !['shooting'].includes(leg.kind) && !able(cur)) {
        const nb = W.nearestOf(W.mates(att).filter(able), pk.x, pk.y);
        if (nb) { cur = script(nb); if (leg.kind === 'approach' && leg.shooter && !able(leg.shooter)) leg.shooter = nb; if (pk.carrier !== cur) { if (pk.target !== cur && pk.home !== cur) W.collect(cur); leg = { kind: 'fetch', t: 0 }; } }
      }
      if (B.seekNet && !pk.inNet) {
        // to a point in front of the mouth first if it's wide or behind, then in (and once it's
        // been in front it keeps going in, unless it's gone back behind the goal line: deciding
        // afresh every step held it on the line between the two)
        if ((netX - pk.x) * dir > 1.5 && Math.abs(pk.y - MID_Y) < NET_HALF - 0.6) B.seekFront = true;
        else if ((netX - pk.x) * dir < -0.3) B.seekFront = false;
        const tx = B.seekFront ? netX + dir * 1.6 : netX - dir * 4, ty = MID_Y;
        const dx = tx - pk.x, dy = ty - pk.y, d = hyp(dx, dy) || 1, k = 1 - Math.exp(-dt * 8);
        pk.vx += (dx / d * 45 - pk.vx) * k; pk.vy += (dy / d * 45 - pk.vy) * k; pk.vz = Math.min(pk.vz, 0);
      }
      if (B.celebrate) {
        const sh = B.celebrate;
        W.cam.focus = [sh.x, sh.y];
        for (const m of W.mates(att)) if (m !== sh && m.scripted) {
          const d = hyp(sh.x - m.x, sh.y - m.y);
          m.tx = sh.x + (m.x - sh.x) / (d || 1) * 2.6; m.ty = sh.y + (m.y - sh.y) / (d || 1) * 2.6;
          if (d < 4 && m.act !== 'hug') { m.target = sh; W.act(m, 'hug', 1.6); }
        }
      }
      if (B.gloveRamp) { const gr = B.gloveRamp; gr.g.gloveW = clamp((W.t - gr.from) / gr.dur, 0, 1); }
      if (!leg) return;
      leg.t += dt;
      // The shot line covers the set-up and the wind-up; the puck arrives as the outcome is
      // called. So he lets it go a wind-up and a flight before the outcome line.
      const rel = W.t - B.t0, outCue = cueOf(p, 'out'), callCue = cueOf(p, 'shot');
      const shotCue = outCue != null && callCue != null ? Math.max(callCue, outCue - releaseAt(type) - 0.35) : callCue;
      // Running behind the booth: the rush catches up rather than letting the words get
      // ahead of the picture. Past the shot's line, it goes straight to the shot; past the
      // next touch's line, the touch in progress finishes now.
      if (callCue != null && rel >= callCue && !['approach', 'shooting', 'wrapIn', 'feed'].includes(leg.kind)) {
        if (leg.foe) leg.foe.scripted = false;
        for (const o of [leg.from, leg.rival]) if (o && o !== cur) { o.scripted = false; o.protect = 0; }
        cur.face = null; cur.protect = 0;
        // (only to the man a pass is actually on its way to; one never made stays with the passer)
        if (leg.kind === 'pass' && leg.to && (pk.target === leg.to || pk.carrier === leg.to || pk.home === leg.to)) cur = leg.to;
        if (leg.kind === 'chase' && leg.chaser) cur = leg.chaser;
        script(cur);
        if (pk.carrier !== cur && pk.home !== cur && pk.target !== cur) W.collect(cur);
        li = nodes.length - 2; leg = null; shotLeg();
        return;
      }
      // A block needs a body in the lane: he takes the line from the shooter to the net, a few
      // strides in front of him, wherever the shooter has got to. (The spot the sim had for it
      // was behind a man already in close, and the shot went back up the ice into him.)
      if (leg.blocker && (leg.kind === 'approach' || leg.kind === 'feed' || leg.kind === 'wrapIn')) {
        const bl = leg.blocker, sh = leg.shooter || cur, dx = netX - sh.x, dy = MID_Y - sh.y, d = hyp(dx, dy) || 1, k = Math.min(0.5, 9 / d);
        bl.tx = sh.x + dx * k; bl.ty = sh.y + dy * k; bl.face = Math.atan2(-dy, -dx);
      }
      const nextCue = nodes[li] ? cueOf(p, 'node', 'i', nodes[li].oi) : null;
      // (not a carry up to where a dump goes in from: dumped from short of there, it's icing)
      if (nextCue != null && rel >= nextCue + 0.3 && ((leg.kind === 'carry' && !leg.up) || leg.kind === 'chase')) {
        if (leg.kind === 'chase') { const c = leg.chaser; if (leg.foe) leg.foe.scripted = false; if (cur !== c) cur.scripted = false; cur = c; script(cur); }
        leg = null; nextLeg();
        return;
      }
      if (leg.kind === 'fetch') {
        if (pk.carrier === cur) {
          const rv = leg.rival;
          if (rv && tk != null && !B.battled && free(rv)) { cur.tx = nodes[li].x; cur.ty = nodes[li].y; cur.maxV = 14; leg = { kind: 'challenge', t: 0, rival: script(rv) }; return; }
          leg = null; nextLeg();
        }
        return;
      }
      if (leg.kind === 'win') {
        // A BATTLE FOR IT. He closes on the man with it, who slows and turns the puck away from
        // him; they lean on each other a moment and he lifts the stick, then pokes it, and it
        // squirts off the man's blade toward him and he gathers it up. A takeaway the booth
        // calls comes loose as its line airs.
        const c = leg.from;
        // (a pass still on its way to him: he goes at the man it's for, to be on him as he has it)
        if (pk.carrier !== c && pk.target === c) { cur.tx = c.x; cur.ty = c.y; cur.maxV = 24; return; }
        if (pk.carrier !== c) {
          c.protect = 0; cur.face = null; cur.charging = null;
          // (their man never had it, or he beat him to it: a takeaway the booth calls still gets
          // its battle once he has it, their man coming at him, as after a loose puck)
          const rv = tk != null && !B.battled && free(c) ? c : null;
          if (rv && pk.carrier === cur) { cur.tx = nodes[li].x; cur.ty = nodes[li].y; cur.maxV = 14; leg = { kind: 'challenge', t: 0, rival: script(rv) }; return; }
          leg = null; nextLeg();
          if (rv && leg && leg.kind === 'fetch') leg.rival = rv;
          return;
        }
        if (!c.scripted) script(c);
        c.tx = c.x + c.vx * 0.3; c.ty = c.y + c.vy * 0.3; c.maxV = 10;
        const dc = hyp(cur.x - c.x, cur.y - c.y), lv = -(cur.x - c.x) * Math.sin(c.h) + (cur.y - c.y) * Math.cos(c.h);
        c.protect = dc < 9 ? (lv >= 0 ? 1 : -1) : 0;
        // (into him, through the puck, rather than easing up short of him)
        cur.tx = pk.x + pk.vx * 0.15; cur.ty = pk.y + pk.vy * 0.15; cur.maxV = 26; cur.through = W.t + 0.1; cur.charging = c;
        cur.face = dc < 5 ? Math.atan2(pk.y - cur.y, pk.x - cur.x) : null;
        if (dc < 3.6 && leg.contact == null) { leg.contact = W.t; W.act(cur, 'lift', 0.45); c.react = 0.3; W.sfx('stick'); }
        // (as the takeaway's line airs, or the line after he went in after a loose puck, or
        // after a moment's battle when the booth has nothing to say about it)
        const cue = tk ?? cueOf(p, 'fetched'), due = cue != null ? B.t0 + cue - 0.15 : 0;
        // (a moment's lean on him first, and only a short one once the line's gone by)
        const lean = due && W.t > due ? 0.2 : 0.4;
        if ((leg.contact != null && W.t - leg.contact > lean && W.t >= due) || leg.t > 6) {
          B.tookAt = W.t - B.t0; B.battled = true;
          W.act(cur, 'poke', 0.35); W.sfx('stick');
          W.act(c, 'stagger', 0.5); c.react = 0.4; c.protect = 0; c.scripted = false;
          const ux = cur.x - pk.x, uy = cur.y - pk.y, ul = hyp(ux, uy) || 1;
          W.loose(c.vx * 0.4 + ux / ul * 7, c.vy * 0.4 + uy / ul * 7);
          cur.face = null; cur.charging = null;
          W.collect(cur);
          leg = { kind: 'fetch', t: 0 };
        }
        return;
      }
      if (leg.kind === 'forecheck') {
        // Their man goes and gets the loose puck; he skates to where that man will have it,
        // to be on him as he does. Their man too slow to have it in time for the line, it's a
        // scramble between the two of them instead (a `chase`), and he comes out of it with
        // the puck as the line airs.
        const rv = leg.rival;
        if (pk.carrier === rv) { leg = { kind: 'win', t: 0, from: rv }; return; }
        if (pk.carrier === cur || !able(rv) || leg.t > 6) { rv.scripted = false; leg = null; nextLeg(); return; }
        if (tk != null && rel > tk - 0.8) { W.collect(cur); leg = { kind: 'chase', chaser: cur, foe: rv, t: 0, armed: true }; return; }
        if (!pk.carrier && !pk.held && pk.home !== rv && pk.target !== rv) W.collect(rv);
        // (no faster than gets him there a moment after their man, so it's their man's puck
        // first: he's forechecking, not racing him for it)
        const q = W.intercept(rv, 24), dq = hyp(q[0] - cur.x, q[1] - cur.y) || 1, eta = hyp(q[0] - rv.x, q[1] - rv.y) / 24;
        cur.tx = q[0] - (q[0] - cur.x) / dq * 2.5; cur.ty = q[1] - (q[1] - cur.y) / dq * 2.5;
        cur.maxV = clamp(dq / (eta + 0.4), 10, 24); cur.through = W.t + 0.1;
        return;
      }
      if (leg.kind === 'challenge') {
        // He has it, and their nearest man comes at him: a stick on his, a lean, and he rides
        // it out with the puck as the booth's line airs.
        const rv = leg.rival, dc = hyp(rv.x - cur.x, rv.y - cur.y);
        rv.tx = cur.x + cur.vx * 0.2; rv.ty = cur.y + cur.vy * 0.2; rv.maxV = 24; rv.through = W.t + 0.1; rv.charging = cur;
        if (dc < 9) { const lv = -(rv.x - cur.x) * Math.sin(cur.h) + (rv.y - cur.y) * Math.cos(cur.h); cur.protect = lv >= 0 ? 1 : -1; }
        if (dc < 3.6 && leg.contact == null) { leg.contact = W.t; B.battled = true; W.act(rv, 'lift', 0.45); W.sfx('stick'); }
        const due = tk != null ? B.t0 + tk : 0;
        if ((leg.contact != null && W.t - leg.contact > 0.5 && W.t >= due) || leg.t > 4 || pk.carrier !== cur) {
          if (leg.contact != null) { W.act(rv, 'stagger', 0.5); rv.react = 0.4; }
          rv.scripted = false; rv.charging = null; cur.protect = 0;
          leg = null; nextLeg();
        }
        return;
      }
      if (leg.kind === 'wait') {
        const m = leg.mover, left = leg.until - rel, dn = hyp(leg.tx - m.x, leg.ty - m.y);
        if (left > 1.2 && dn < 12) {
          // Early, and nearly there: he curls round the spot at a skater's pace, a stride
          // ahead of himself on a circle about it, rather than standing on it with the puck
          // waiting for the booth.
          if (leg.curl == null) leg.curl = (r() < 0.5 ? 1 : -1);
          const a = Math.atan2(m.y - leg.ty, m.x - leg.tx) + leg.curl * 0.7;
          let cx = leg.tx + Math.cos(a) * 7, cy = leg.ty + Math.sin(a) * 7;
          const c = insideRink(cx, cy, 4); if (c) { cx = c.x; cy = c.y; }
          m.tx = cx; m.ty = cy; m.maxV = 11; m.through = W.t + 0.1;
        } else {
          m.tx = leg.tx; m.ty = leg.ty;
          m.maxV = clamp(dn / Math.max(0.4, left), 5, 24);
        }
        if (m !== cur) cur.maxV = 9;
        if (left <= 0) { leg = null; nextLeg(); }
        return;
      }
      if (leg.kind === 'carry') {
        if (leg.deke && !leg.dekeDone && hyp(leg.deke.x - cur.x, leg.deke.y - cur.y) < 8) {
          leg.dekeDone = true;
          W.act(cur, ['toedrag', 'deke', 'drag'][(r() * 3) | 0], 0.7);
          const sd = r() < 0.5 ? 1 : -1, d = leg.deke;
          cur.tx = leg.tx - Math.sin(cur.h) * 5 * sd; cur.ty = leg.ty + Math.cos(cur.h) * 5 * sd;
          at(B, 0.35, () => { W.act(d, 'stagger', 0.6); d.react = 0.4; d.scripted = false; });
        }
        if (hyp(cur.tx - cur.x, cur.ty - cur.y) < 4 || leg.t > leg.dist / 17 + 0.6) { leg = null; nextLeg(); }
      } else if (leg.kind === 'pass') {
        if (pk.carrier === leg.to) { leg.from.scripted = false; cur = leg.to; leg = null; nextLeg(); }
        else if (leg.made && !pk.carrier && !pk.held && pk.target !== leg.to) {
          // Gone by him: whoever of his side will get to it first goes after it (a good half
          // second sooner than the man it was for, so the two don't trade the job back and
          // forth), and the touch is his.
          const s0 = soonest(W.mates(att).filter(able));
          if (s0 && s0 !== leg.to && etaOf(s0) + 0.5 < etaOf(leg.to)) { if (leg.to !== cur) leg.to.scripted = false; leg.to = script(s0); }
          if (pk.home !== leg.to) W.collect(leg.to);
        }
        else if (leg.t > 2.2 && !leg.collecting) { leg.collecting = true; W.collect(leg.to); }
      } else if (leg.kind === 'chase' && leg.armed) {
        const c = leg.chaser;
        // he runs it down: to where he'll meet it, keeping his speed (the sim's `pursue`), and
        // has it when it's within reach of his stick
        if (pk.carrier !== c && pk.home !== c) W.collect(c);
        // the other side's man goes for it too, a stride behind him
        if (leg.foe && !(leg.dug > W.t)) { const f = leg.foe, q = W.intercept(f, 23); f.tx = q[0] - Math.cos(c.h) * 2; f.ty = q[1] - Math.sin(c.h) * 2; f.maxV = 23; f.through = W.t + 0.1; }
        // THE TWO OF THEM GET THERE TOGETHER: a scramble, sticks on it and on each other, the
        // puck kicked about between them, and the man the booth names comes out with it as
        // his line airs (or after a moment, without one).
        // (whoever of theirs is there: the man who came for it, or another closer to it)
        if (leg.foe && leg.dug == null && pk.home === c && hyp(c.x - pk.x, c.y - pk.y) < 4) {
          const o = W.mates(def).filter((m) => free(m) && m.stick).reduce((b2, m) => (!b2 || hyp(m.x - pk.x, m.y - pk.y) < hyp(b2.x - pk.x, b2.y - pk.y) ? m : b2), null);
          if (o && o !== leg.foe && hyp(o.x - pk.x, o.y - pk.y) + 2 < hyp(leg.foe.x - pk.x, leg.foe.y - pk.y)) { leg.foe.scripted = false; leg.foe = script(o); }
        }
        if (leg.foe && leg.dug == null && pk.home === c && hyp(c.x - pk.x, c.y - pk.y) < 4 && hyp(leg.foe.x - pk.x, leg.foe.y - pk.y) < 9) {
          const f = leg.foe, left = nextCue != null ? nextCue - rel - 0.1 : 0.6;
          leg.dug = W.t + clamp(left, 0.45, 1.2); c.holdOff = leg.dug; B.battled = true;
          W.act(f, 'poke', 0.35); W.sfx('stick');
          at(B, 0.15, () => W.act(c, 'lift', 0.45));
          for (let k = 1; k * 0.25 < leg.dug - W.t; k++) at(B, k * 0.25, () => { if (pk.carrier || pk.held) return; const a = r() * Math.PI * 2; pk.vx += Math.cos(a) * 4; pk.vy += Math.sin(a) * 4; W.sfx('stick'); });
        }
        if (leg.foe && leg.dug > W.t) { const f = leg.foe, df = hyp(pk.x - f.x, pk.y - f.y); f.tx = pk.x; f.ty = pk.y; f.maxV = df > 3 ? 18 : 6; f.face = Math.atan2(pk.y - f.y, pk.x - f.x); }
        if (pk.carrier === c) {
          W.sfx('receive');
          if (pk.y < 9 || pk.y > RW - 9) { W.boardShake = Math.max(W.boardShake, 0.35); W.sfx('boards'); }
          if (leg.foe && leg.dug != null) { W.act(leg.foe, 'stagger', 0.5); leg.foe.react = 0.4; leg.foe.face = null; }
          if (cur !== c) cur.scripted = false;
          cur = c; script(cur);
          // (a takeaway the booth calls that came to no battle for the loose puck still gets
          // one: their man comes at him, and he rides it out with the puck)
          if (tk != null && !B.battled && leg.foe && free(leg.foe)) { cur.tx = nodes[li].x; cur.ty = nodes[li].y; cur.maxV = 14; leg = { kind: 'challenge', t: 0, rival: leg.foe }; return; }
          if (leg.foe) leg.foe.scripted = false;
          leg = null; nextLeg();
        }
      } else if (leg.kind === 'approach') {
        const sh = leg.shooter;
        // on a breakaway the defenders are a stride or two behind him, and losing ground
        if (B.chasers) B.chasers.forEach((m, i) => { m.tx = sh.x - dir * (7 + i * 5); m.ty = sh.y + (i ? 4 : -4); m.maxV = Math.max(8, hyp(sh.vx, sh.vy) - 1.5); });
        if (leg.breakaway && g) { g.scripted = true; g.tx = g.x; g.ty = g.y; }
        // He can only shoot what's on his stick. Without it he's getting it (the sim's
        // `pursue` has him); with it he takes it to the spot it's shot from.
        const has = pk.carrier === sh, d = hyp(leg.sx - sh.x, leg.sy - sh.y);
        if (has) { sh.tx = leg.sx; sh.ty = leg.sy; }
        else if (pk.home !== sh && pk.target !== sh && !pk.held) W.collect(sh);
        if (shotCue != null) {
          // he lets it go as the shot is called, given a moment to get somewhere he can
          // shoot from if the rush ran late (a goal has to come through the mouth)
          const left = shotCue - rel, inFront = (netX - sh.x) * dir > 5;
          // (nor from a long way out: an overdue shot waits until he's within 75 ft, or at the
          // spot it was to be taken from, flat out till then, or it's a man shooting the
          // length of the ice)
          const inRange = hyp(netX - sh.x, MID_Y - sh.y) < 75 || d < 14;
          if (has) sh.maxV = left <= 0 && !inRange ? 26 : clamp(d / Math.max(0.3, left), 6, 24);
          if (has && left <= 0 && inRange && (kind !== 'goal' || (d < 14 && inFront) || -left > 2.0)) { leg.kind = 'shooting'; shoot(sh); }
        } else if (has && (d < 5 || leg.t > 1.7)) { leg.kind = 'shooting'; shoot(sh); }
      } else if (leg.kind === 'wrapIn') {
        // late on its line, he cuts the corner and comes straight round the post
        const late = shotCue != null && rel >= shotCue;
        // (round the post to just inside it, in front of the goal line: from beside the post
        // there's no way into the net but through the side of it)
        if ((leg.t > 0.5 || late) && !leg.round) { leg.round = true; leg.roundAt = leg.t; cur.tx = netX - dir * 2.2; cur.ty = MID_Y + leg.sv * (NET_HALF - 0.6); cur.maxV = late ? 26 : 20; }
        if (leg.round && (hyp(cur.tx - cur.x, cur.ty - cur.y) < 2 || leg.t > 2.2 || (late && leg.t - leg.roundAt > 0.5)) && (shotCue == null || rel >= shotCue)) { leg.kind = 'shooting'; shoot(cur); }
      } else if (leg.kind === 'feed') {
        const sh = leg.shooter;
        // (a man waiting to tip a shot faces the man it'll come from, his stick out in its way:
        // turning as he settled swung his blade four feet off where the shot was aimed)
        if (type === 'tip') sh.face = Math.atan2(cur.y - sh.y, cur.x - sh.x);
        if (!leg.fed && (shotCue != null ? rel >= shotCue - 0.5 : (leg.t > 0.7 || hyp(sh.tx - sh.x, sh.ty - sh.y) < 4))) {
          leg.fed = true; const from = cur;
          W.act(from, 'pass', SHOTS.pass.dur);
          if (type === 'onetimer') W.act(sh, 'onetimerReady', 0.8);
          at(B, releaseAt('pass'), () => {
            if (type === 'tip') {
              // The point shot is the setup; the tip is the shot that counts. It's aimed at his
              // blade where it'll be as the shot gets there, and he redirects it when it does
              // (below), not a fixed beat after it's struck: one still feet short of him was put
              // on his stick.
              // (led along his line, no farther than his spot: he can still be getting there)
              const sv = hyp(sh.vx, sh.vy) || 1, left = hyp(sh.tx - sh.x, sh.ty - sh.y);
              const ahead = (tt) => { const bw = bladeWorld(sh, W.t + tt, true), s = Math.min(sv * tt, left); return [bw[0] + sh.vx / sv * s, bw[1] + sh.vy / sv * s]; };
              let bw = ahead(0);
              for (let i = 0; i < 3; i++) bw = ahead(hyp(bw[0] - pk.x, bw[1] - pk.y) / 75);
              W.shoot(from, [bw[0], bw[1], 0.4], 75, 'wrist'); W.sfx('shot', { type: 'wrist' });
              leg.tipBy = W.t + hyp(bw[0] - pk.x, bw[1] - pk.y) / 75 + 0.5;
            } else W.pass(from, sh, 78);
          });
        }
        // (ready for it as it comes, and struck as it gets to his stick: shooting while it was
        // still on its way made him go and get it, and the pass went by him)
        if (leg.fed && type === 'onetimer' && pk.carrier === sh) { leg.kind = 'shooting'; shoot(sh); }
        if (leg.fed && type === 'tip' && leg.tipBy) {
          const bw = bladeWorld(sh, W.t, true), db = hyp(bw[0] - pk.x, bw[1] - pk.y);
          if (db < 3 && pk.z < 2.5) {
            leg.kind = 'shooting';
            W.give(sh, true);
            W.act(sh, 'tip', SHOTS.tip.dur);
            W.schedule(0.02, () => { if (D.beat !== B) return; const a = aim(kind, sh, def, 'tip', r); if (kind === 'goal') W.allowGoal = def; const tt = W.shoot(sh, a.tgt, SPEED.tip, 'tip'); W.sfx('stick'); react(a, tt); });
          } else if (W.t > leg.tipBy) { leg.kind = 'shooting'; shoot(sh); }   // (it missed his blade: he gathers it and shoots)
        }
        if (leg && leg.t > 3 && (shotCue == null || rel > shotCue + 1)) { leg.kind = 'shooting'; shoot(sh); }
      }
    };
    B.cleanup = () => { if (g) { g.gloveHold = false; } };
    if (!leg) nextLeg();
    return B;
  }

  // ── the faceoff ───────────────────────────────────────────────────────────
  // Everybody skates to his spot for the dot; the linesman brings the puck in his hand
  // (fetching it first if a whistle's beat hasn't already, see `stopPlay`) and drops it
  // once both centres are set, never before its line. After a whistle the men are usually
  // there already and it goes down as the line airs.
  function stageFaceoff(p) {
    const B = begin('faceoff');
    const dot = DOT_FT[p.dot] ? p.dot : 'C', [dx, dy] = DOT_FT[dot];
    const ws = tagSide(p.winnerSide) || sideOfTeam(p.winTeam, p) || 'a', ls = other(ws);
    if (p.reason === 'period' && D.intermission) endIntermission();
    W.frozen = true; W.puckScripted = true;
    // the centres take the draw, so the names go on the centres
    const winC = nameBody(centreOf(ws), p.winner);
    const loseC = nameBody(centreOf(ls), p.loser);
    let lin = dropper();
    B.ownsCam = true;
    frame('broadcast', [dx, dy]);
    // The puck drops as the drop line airs and is won a moment later, so the win line
    // confirms what was just seen. Without a drop line it drops so the draw is won as the
    // win line airs. Either way not before the men are set.
    const won = cueOf(p, 'won'), drop = cueOf(p, 'drop');
    const dropAt = drop != null ? Math.max(1.35, won != null ? Math.max(drop + 0.4, won - 1.4) : drop + 0.4)
      : won != null ? Math.max(1.35, won - 0.7) : 1.35;
    const set = (b, x, y, tol) => !b || hyp(b.x - x, b.y - y) < tol;
    B.dropAt = dropAt;
    B.update = (dt, rel) => {
      W.cam.focus = [dx, dy];
      if (!B.down) {
        toSpots(dot, true);
        lin = dropper();
        const has = lin && pk.held === lin;
        // set: both centres on the dot, the linesman stepped in beside it with the puck; or
        // near enough once the line has been waiting a while or the next play is waiting on it
        const late = rel > dropAt + 3 || D.queued, tol = late ? 3 : 1.5;
        const centres = [winC, loseC].every((c) => !c || set(c, c.tx, c.ty, late ? 3 : 2.5));
        if (has && centres) { lin.tx = dx - 0.3; lin.ty = dy - 2.6; lin.maxV = hyp(lin.x - lin.tx, lin.y - lin.ty) > 7 ? 22 : 8; lin.face = Math.PI / 2; }
        // (on his mark beside the dot he's planted: the referee skating to his own spot goes
        // round him rather than shouldering him off it)
        if (has && hyp(lin.x - dx + 0.3, lin.y - dy + 2.6) < 1.5) lin.plant = W.t + 0.2;
        const ready = has && centres && set(lin, dx - 0.3, dy - 2.6, tol) && [winC, loseC].every((c) => !c || set(c, c.tx, c.ty, 1.0));
        if (ready && B.readyAt == null) B.readyAt = rel;
        // (a draw with no lines of its own is a quick one, and so is one holding up the play)
        const crouch = (drop == null && won == null) || D.queued ? 0.55 : 0.85;
        if (ready && rel >= dropAt - crouch) {
          B.down = true;
          if (winC) W.act(winC, 'faceoff', 1.6);
          if (loseC) W.act(loseC, 'faceoff', 1.6);
          const go = Math.max(crouch, dropAt - rel);
          at(B, go - 0.45, () => W.act(lin, 'drop', 0.75));
          // dropped from his hand, falling onto the dot
          at(B, go, () => {
            W.loose(0, 0, -2);
            const tf = (-pk.vz + Math.sqrt(pk.vz * pk.vz + 2 * 32 * Math.max(0.1, pk.z))) / 32;
            pk.vx = (dx - pk.x) / tf; pk.vy = (dy - pk.y) / tf;
            W.sfx('drop'); B.dropped = true;
          });
        }
        return;
      }
      for (const c of [winC, loseC]) if (c) { c.tx = c.x; c.ty = c.y; c.maxV = 2; }
      if (lin && !B.won) lin.plant = W.t + 0.2;
      if (B.dropped && !B.won && pk.z <= 0.05) {
        B.won = true;
        const dir = attackDir(ws);
        if (winC) W.act(winC, 'sweep', 0.4);
        W.sfx('sweep'); land(B);
        const back = W.mates(ws).find((m) => m.slot === 3) || W.mates(ws).find((m) => m !== winC);
        if (back && winC) { W.give(winC); at(B, 0.12, () => { W.pass(winC, back, 36); }); }
        else W.loose(-dir * 28, ((hash(`won${p.clock}${p.winner}`) % 100) / 100 - 0.5) * 10, 0);
        if (lin) { lin.tx = dx + 2; lin.ty = dy - 12; lin.maxV = 14; lin.face = null; }
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
    // Finished on the far wall, where the glass and the advertising are in shot. He's the man
    // the booth names if that sweater is already on somebody, else his side's man nearest
    // the puck, and he takes it up the wall from wherever he is: it's passed or slid to him.
    puckInPlay();
    const victim = bodyFor(vs, p.victim || p.player, W.nearestOf(W.mates(vs).filter((m) => m.stick), pk.x, pk.y));
    let hitter = victim && (p.hitter ? bodyFor(hs, p.hitter, W.nearestOf(W.mates(hs), victim.x, victim.y)) : W.nearestOf(W.mates(hs), victim.x, victim.y));
    if (!victim || !hitter) { land(B); at(B, 0.5, () => finish(B)); return B; }
    // Where on the far wall: where the two of them can both be soonest (he carries it there
    // at about 20 ft/s, the hitter comes at about 25), a stride or two ahead of him.
    const y0 = RW - 3.6, ahead = victim.x + vdir * (18 + r() * 14);
    let x0 = RL / 2, best = Infinity;
    for (let x = 52; x <= RL - 52; x += 4) {
      const t = Math.max(hyp(x - victim.x, y0 - victim.y) / 20, hyp(x - hitter.x, y0 - 2 - hitter.y) / 25) + Math.abs(x - ahead) * 0.01;
      if (t < best) { best = t; x0 = x; }
    }
    W.puckScripted = true; W.frozen = false;
    // the hit lands as its line airs, so he has that long to carry it up the wall
    const impT = cueOf(p, 'impact');
    if (victim.rag) W.getUp(victim, 0.6);
    victim.stick = true;
    if (pk.held && pk.held.kind === 'goalie') { pk.held.gloveW = 0; pk.held.gloveHold = false; W.loose(0, 0); }
    // He takes it up the wall if it's his: on his stick, or within his reach. Otherwise he goes
    // up the wall without it (a man is hit for having just had it, or for being in the way).
    // Nobody slides it to him, and he doesn't go chasing it, or a pass, instead of going where
    // the hit is.
    if (pk.carrier !== victim && !pk.held && pk.z < 0.8 && W.inReach(victim, pk.x, pk.y)) W.give(victim, true);
    victim.scripted = true; hitter.scripted = true; B.locked.add(victim); B.locked.add(hitter);
    victim.maxV = 20; hitter.maxV = 27; hitter.acc = 34;
    if (style === 'behind') { victim.tx = x0; victim.ty = y0 + 0.4; victim.maxV = 12; }
    B.ownsCam = true;
    let hit = false;
    B.update = (dt, rel) => {
      if (!hit) {
        // (there: on the wall, at or past the spot. Level with it but still out in the middle
        // of the ice isn't: he cruised the 40 ft to the wall and the hit came 2 s late.)
        const there = Math.abs(y0 - victim.y) < 3 && (victim.x - x0) * vdir > -1;
        if (style !== 'behind') {
          // (on the wall a stride before the hitter commits, so the hit comes as it's called;
          // once he's there he goes on up it at an easy pace, not skating away from the hit)
          if (impT != null) { victim.tx = x0 + vdir * 6; victim.maxV = there ? 7 : clamp(hyp(x0 - victim.x, y0 - victim.y) / Math.max(0.5, impT - 1.1 - rel), 7, 24); }
          else victim.tx = victim.x + vdir * 18;
          victim.ty = y0;
        } else {
          // into the boards to dig it out, back to the ice, facing the glass once he's there
          const d = hyp(x0 - victim.x, y0 + 0.4 - victim.y);
          if (impT != null) victim.maxV = clamp(d / Math.max(0.5, impT - 1.1 - rel), 7, 24);
          victim.face = d < 4 ? Math.PI / 2 : null;
        }
        // he commits as late as he can and still arrive as the hit is called
        const charging = impT == null || rel >= impT - Math.max(0.85, hyp(hitter.x - victim.x, hitter.y - victim.y) / 24 + 0.35);
        if (!charging) {
          // he shadows him from the inside, waiting for his moment
          hitter.tx = victim.x - vdir * 3; hitter.ty = victim.y - 12; hitter.maxV = 22;
        } else {
          hitter.maxV = 27;
          const lead = Math.min(0.9, hyp(hitter.x - victim.x, hitter.y - victim.y) / 32);
          // into the boards where he'll be, or from behind, at his back...
          const ax = style === 'behind' ? victim.x - 0.5 : victim.x + victim.vx * lead, ay = style === 'behind' ? victim.y : RW;
          // ...and on through: a man skating at a point eases up as he gets there, and a
          // check isn't eased into. Aimed short, the hit came as much as a second late.
          const ex = ax - hitter.x, ey = ay - hitter.y, el = hyp(ex, ey) || 1;
          hitter.tx = ax + ex / el * 12; hitter.ty = ay + ey / el * 12; hitter.charging = victim;
        }
        W.cam.focus = [(victim.x + hitter.x) / 2, (victim.y + hitter.y) / 2 - 4];
        // running late, the hitter finds another gear and the man with it, once he's on the
        // wall, eases up into him (short of it he keeps going to it)
        if (rel > (impT != null ? impT + 0.4 : 3.0)) { hitter.maxV = 34; hitter.acc = 60; if (there || style === 'behind') victim.maxV = Math.min(victim.maxV, 6); }
        if (charging && hyp(hitter.x - victim.x, hitter.y - victim.y) < 3.3) { hit = true; impact(); }
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
        case 'glass': {
          impU = [hv[0] * 0.5, 31, 13]; impL = [hv[0] * 0.3, 12, 3];
          // the booth said whether the glass went; without a call it's a coin toss
          const roll = r() < 0.5;
          victim.shatterNext = (p.shatter != null ? !!p.shatter : roll) || fatal === 'head';
          // a called shatter happens even if he hits the pane too softly to break it. If the pane
          // he hit went earlier in the night, he goes into the nearest one still standing; if he
          // broke one himself on the way in, that was the call
          if (p.shatter && !fatal) {
            const nb = W.broken.size;
            at(B, 0.5, () => {
              if (W.broken.size > nb) return;
              let i = panelAt(victim.x);
              for (let d = 1; W.broken.has(i) && d < PANELS; d++) {
                if (i + d < PANELS && !W.broken.has(i + d)) i += d;
                else if (i - d >= 0 && !W.broken.has(i - d)) i -= d;
              }
              if (!W.broken.has(i)) W.glassHit(W.broken.has(panelAt(victim.x)) ? PANEL_X0 + (i + 0.5) * PANEL_W : victim.x, (BOARD_H + GLASS_H) / 2, 22, true);
            });
          }
          break;
        }
        case 'behind': impU = [hv[0] * 0.3 + vdir * 2, 27, 2]; impL = [hv[0] * 0.2, 6, 0.5]; break;
        case 'hip': impU = [hv[0] * 0.4, 7, 3]; impL = [hv[0] * 0.4, 17, 11]; break;
        case 'elbow': impU = [hv[0] * 0.4, 18, 9]; impL = [hv[0] * 0.2, 6, 1]; break;
        default: impU = [hv[0] * 0.6 - 2, 26, 8]; impL = [hv[0] * 0.3, 9, 1.5];
      }
      if (fatal === 'post') { impU = [vdir * 18, -6, 4]; impL = [vdir * 6, -2, 1]; }
      W.knock(victim, impU, impL);
      hitter.vx *= 0.3; hitter.vy *= 0.15; hitter.charging = null;
      // and he pulls up rather than drive on into the boards after him
      hitter.tx = hitter.x; hitter.ty = Math.min(hitter.y, RW - 4);
      W.shake = Math.max(W.shake, style === 'glass' ? 1.2 : 0.9); W.crowd = 1; W.hitstop = style === 'glass' ? 0.1 : 0.07;
      W.sfx('check', { style });
      W.burst('spray', victim.x, victim.y, 0.3, 14, 7, [0, 4, 3]);
      const hurt = p.injured || fatal;
      if (style === 'elbow' || style === 'behind' || hurt) {
        const off = r() < (hurt ? 0.8 : 0.5);
        if (victim.helmet && (p.helmetOff != null ? !!p.helmetOff : off)) { victim.helmet = false; W.addDebris('helmet', [victim.x, victim.y, 5.6], [hv[0] * 0.4, 10, 12], 0, 6, victim.side); }
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
    medics.forEach((m, i) => { fresh(m); m.active = true; m.stick = false; m.gloves = false; m.helmet = false; overBoards(m, gx + (i ? 3.6 : -3.6)); m.scripted = true; m.maxV = slow ? 9 : 17; m.acc = 30; W.act(m, 'carry', 60); });
    W.stretcher = { a: medics[0], b: medics[1], x: gx, y: 1.8, h: 0, body: null };
    let state = 'out';
    const lay = (() => {
      const tmp = { ...victim, rag: null, blend: null, act: null, x: 0, y: 0, h: 0, vx: 0, vy: 0, amp: 0, phase: 0, guard: false, grab: null, foe: null, stick: false, carrying: false, react: 0, jerseyUp: 0, hold: null };
      return skaterRig(tmp, 0).slice(0, 18);
    })();
    // He's lifted onto it over most of a second, from however he was lying, and then held.
    let from = null, liftAt = 0;
    const hold = () => {
      const s = W.stretcher; if (!s || !victim.rag) return;
      if (!from) { from = victim.rag.pts.map((pt) => [pt.x, pt.y, pt.z]); liftAt = W.t; }
      const k0 = Math.min(1, (W.t - liftAt) / 0.8), k = k0 * k0 * (3 - 2 * k0);
      const ax = Math.cos(s.h), ay = Math.sin(s.h), nx = -ay, ny = ax;
      victim.rag.pts.forEach((pt, i) => {
        const j = lay[i]; if (!j) return;
        const u = j[2] - 2.9, v = j[1], z = 1.95 + Math.max(-0.2, j[0]) * 0.45, f = from[i];
        pt.x = pt.px = lerp(f[0], s.x + ax * u + nx * v, k); pt.y = pt.py = lerp(f[1], s.y + ay * u + ny * v, k); pt.z = pt.pz = lerp(f[2], z, k);
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
          // (kept on the ice: a man lying along the boards has his head end against them)
          const onIce = (m, x, y) => { const c = insideRink(x, y, 1.8); m.tx = c ? c.x : x; m.ty = c ? c.y : y; };
          onIce(medics[0], v.x + Math.cos(ang) * 3.8, v.y + Math.sin(ang) * 3.8);
          onIce(medics[1], v.x - Math.cos(ang) * 3.4, v.y - Math.sin(ang) * 3.4);
          // (running long, they hurry, and lift him from wherever they've got to: the lift is
          // blended, so he's carried onto it, not put there)
          if (W.t - t0 > (slow ? 12 : 8)) medics.forEach((m) => { m.maxV = 18; });
          if (medics.every((m) => hyp(m.tx - m.x, m.ty - m.y) < 1.6) || (W.t - t0 > (slow ? 16 : 11) && medics.every((m) => hyp(m.x - v.x, m.y - v.y) < 7))) {
            state = 'load'; k.loadAt = W.t;
            if (!victim.rag) W.knock(victim, [0, 0, 0.5], [0, 0, 0]);
            victim.hold = hold; s.body = victim;
            medics.forEach((m) => { m.tx = m.x; m.ty = m.y; });
          }
        } else if (state === 'load' && W.t - k.loadAt > 1.0 && (!k.offAt || W.t >= k.offAt - 2.5)) {
          state = 'off';
          medics.forEach((m) => { m.ty = 1.2; m.maxV = slow ? 7 : 13; });
          // (to the boards side by side, whichever way he lay: a stretcher carried end-on
          // toward them had both men making for the same spot, and one never got there)
          const e = medics[0].x >= medics[1].x ? 1 : -1;
          medics[0].tx = s.x + e * 3.6; medics[1].tx = s.x - e * 3.6;
        } else if (state === 'off' && (medics.every((m) => m.y < 3.4) || W.t - k.loadAt > 30)) {
          gone(); onGone?.(); return true;
        }
        return false;
      },
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
      const r = rng(hash(`hurt${p.clock}${p.victim || p.player}`));
      W.knock(victim, [(r() - 0.5) * 6, (r() - 0.5) * 6, 4], [0, 0, 0]);
      victim.bleeding = 5; victim.blood = 0.7;
      W.burst('blood', victim.x, victim.y, 4.6, 20, 6, [0, 0, 4]);
      whistle();
    }
    if (p.sever && p.woundPart && !victim.missing[p.woundPart]) at(B, 0.1, () => W.sever(victim, p.woundPart, [8, 6, 8]));
    victim.down = true;
    B.ownsCam = true;
    W.cam.mode = 'zoom';
    // his teammates go to him; the officials stand off
    const mates = W.mates(victim.side).filter((m) => m !== victim && !m.rag).slice(0, 3);
    mates.forEach((m, i) => { m.scripted = true; m.maxV = 10; B.locked.add(m); });
    at(B, 0.3, () => land(B));
    const offT = cueOf(p, 'off');
    // While they see to him the rest make for the draw in that end (see stopPlay); the camera
    // stays with him until the stretcher is off.
    B.keepCam = true;
    at(B, cueOf(p, 'medics') ?? 1.2, () => {
      const k = stretcherFor(B, victim, false, () => { B.keepCam = false; stopPlay(B, p.nextDot); });
      if (offT != null) k.offAt = B.t0 + offT;
      at(B, 2.5, () => stopPlay(B, p.nextDot, true));
    });
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
    at(B, cueOf(p, 'still') ?? 1.4, () => { W.crowd = 0; W.cam.mode = 'death'; W.cam.since = W.t; });
    // nobody plays on: helmets off, heads down, the officials wave it off
    // they gather on the far side of him, away from the camera, and stand there
    at(B, cueOf(p, 'helmets') ?? 2.6, () => {
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
  // At the net in the end the puck is in. The nearest of his side takes it to the crease,
  // the goalie covers it when it gets to him, the nearest four of each side pile in, and
  // after the whistle the linesman digs it out of the goalie's glove for the draw.
  function stageScrum(p) {
    const B = begin('scrum');
    puckInPlay();
    // at the net in the half the puck is in: a pile-up is where the play is
    const def = pk.x < RL / 2 ? 'a' : 'h', att = other(def);
    const gx = def === 'a' ? GOAL_X[0] : GOAL_X[1], dir = attackDir(def);
    const cx = gx + dir * 5, cy = MID_Y;
    W.puckScripted = true; W.frozen = false;
    const g = W.goalie[def];
    const near = (side) => W.mates(side).filter((m) => !m.rag && !busyBody(m) && !m.hold).sort((a2, b2) => hyp(a2.x - cx, a2.y - cy) - hyp(b2.x - cx, b2.y - cy)).slice(0, 4);
    const crowd = [...near(att), ...near(def)];
    const r = rng(hash(`scrum${p.clock}`));
    const spot = (m) => { m.tx = cx + dir * (r() * 4 - 1) + (r() - 0.5) * 3; m.ty = cy + (r() - 0.5) * 9; };
    crowd.forEach((m) => { m.scripted = true; m.maxV = clamp(hyp(cx - m.x, cy - m.y) / 2.5, 12, 24); spot(m); B.locked.add(m); });
    // the man taking it in: whoever of the attacking side has it or is nearest it
    const taker = pk.carrier && pk.carrier.side === att ? pk.carrier : W.nearestOf(W.mates(att).filter((m) => m.stick && !busyBody(m)), pk.x, pk.y);
    if (taker) { taker.scripted = true; B.locked.add(taker); if (!W.give(taker)) W.collect(taker); }
    if (g && g.active) { g.scripted = true; g.tx = gx + dir * 2.4; g.ty = MID_Y; }
    B.ownsCam = true; W.cam.mode = 'zoom'; W.cam.focus = [cx, cy];
    const wh = cueOf(p, 'whistle') ?? 0.4;
    const cover = () => { if (!g || !g.active || pk.held === g) return; W.loose(0, 0); pk.held = g; W.act(g, 'cover', 0.5); g.actHold = true; if (taker) taker.react = 0.4; };
    at(B, Math.min(0.4, wh), () => land(B));
    // a man still carrying it in as the whistle comes jams it at the pads
    at(B, Math.max(0.3, wh - 1.0), () => { if (pk.held !== g && g && g.active && pk.carrier && hyp(pk.x - g.x, pk.y - g.y) < 30) { const c = pk.carrier; W.act(c, 'wrist', SHOTS.wrist.dur); at(B, releaseAt('wrist'), () => { if (pk.carrier === c) W.shoot(c, [g.x + dir * 1.2, g.y, 0.3], 45, 'wrist'); }); } });
    at(B, wh, () => whistle());
    let next = 0.6;
    B.update = (dt, rel) => {
      if (B.stopped) return;
      W.cam.focus = [cx + dir * 2, cy];
      // the carrier drives the crease; it's covered once it gets to the goalie
      if (taker && pk.carrier === taker) { taker.tx = gx + dir * 4.5; taker.ty = MID_Y + (taker.y > MID_Y ? 2 : -2); taker.maxV = 16; }
      if (g && g.active && pk.held !== g && hyp(pk.x - g.x, pk.y - g.y) < 4.5 && pk.z < 2) cover();
      if (rel > next) {
        next = rel + 0.35 + r() * 0.3;
        const a = crowd[(r() * crowd.length) | 0], foes = crowd.filter((m) => m.side !== a.side);
        const b = foes.length ? foes.reduce((p2, q) => (hyp(q.x - a.x, q.y - a.y) < hyp(p2.x - a.x, p2.y - a.y) ? q : p2)) : null;
        if (b && hyp(b.x - a.x, b.y - a.y) < 6) {
          a.target = b; W.act(a, r() < 0.5 ? 'shove' : 'break', 0.5); b.react = 0.6;
          b.tx = b.x + (b.x - a.x) * 0.5; b.ty = b.y + (b.y - a.y) * 0.5;
          W.sfx('check', { soft: true });
        }
        for (const m of crowd) if (m !== taker || pk.carrier !== taker) spot(m);
      }
    };
    // the linesman comes in to the crease to dig it out as the whistle goes; a moment's
    // shoving after it, then the draw: everybody makes for the dot (see stopPlay)
    at(B, Math.max(0.5, wh - 1.2), () => { const o = W.officials[0]; if (o && o.active && !busyBody(o)) { o.scripted = true; o.tx = gx + dir * 6; o.ty = MID_Y - 5; o.maxV = 22; } });
    // (covered if it got to him; if it never did, the linesman takes it from wherever it is)
    at(B, wh + 0.6, () => { if (g && hyp(pk.x - g.x, pk.y - g.y) < 6) cover(); stopPlay(B, p.nextDot); });
    // (still covered when the next beat comes, it stays in his glove for the linesman, or
    // for the next play to take out of it)
    B.cleanup = () => { if (g) g.actHold = false; };
    return B;
  }

  // ── the fight ─────────────────────────────────────────────────────────────
  function stageFight(p) {
    const B = begin('fight');
    const ws = tagSide(p.winnerSide) || sideOfTeam(p.winnerTeam, p) || 'a', ls = other(ws);
    const r = rng(hash(`fight${p.winner}${p.loser}${p.clock}`));
    const near = (side) => W.nearestOf(W.mates(side).filter((m) => !busyBody(m)), pk.x, pk.y);
    const win = bodyFor(ws, p.winner, near(ws));
    const lose = bodyFor(ls, p.loser, near(ls));
    if (!win || !lose) { land(B); at(B, 0.5, () => finish(B)); return B; }
    puckInPlay();
    W.frozen = true; W.puckScripted = true;
    // They meet where they are: halfway between them, kept off the boards. They skate in,
    // and the gloves come off when they get there (`squareUp`).
    const cx = clamp((win.x + lose.x) / 2, 45, RL - 45), cy = clamp((win.y + lose.y) / 2, 26, RW - 22);
    r();
    const L = win.x <= lose.x ? win : lose, R = L === win ? lose : win;
    for (const f of [L, R]) { if (f.rag) W.getUp(f, 0.6); f.act = null; f.blend = null; }
    L.foe = R; R.foe = L; L.scripted = R.scripted = true;
    // the puck is left to slide away from it
    { const dx = cx + 26 - pk.x, dy = cy - 12 - pk.y, d = hyp(dx, dy) || 1; W.loose(dx / d * Math.min(14, d * 0.35), dy / d * Math.min(14, d * 0.35), 0); }
    // the rest stand round and watch
    const ring = W.skaters().filter((m) => m !== L && m !== R && !busyBody(m));
    ring.forEach((m, k) => { const a = 0.15 * Math.PI + (k / Math.max(1, ring.length - 1)) * 0.7 * Math.PI; m.ring = { a, rad: 20 + (k % 3) * 3 }; m.scripted = true; m.maxV = 9; });
    // the officials wait behind it, on the far side, where they don't block the camera
    W.officials.forEach((o, i) => { o.scripted = true; o.tx = cx + (i ? -9 : 9); o.ty = cy + 6; o.maxV = 14; });
    B.ownsCam = true;
    const ex = Array.isArray(p.exchange) && p.exchange.length ? p.exchange : [{ n: 1, thrower: p.winner, type: 'right', landed: true }];
    const onLoser = ex.filter((e) => e.landed && e.thrower !== p.loser).length || 1;
    const onWinner = ex.filter((e) => e.landed && e.thrower === p.loser).length || 1;
    W.fight = { l: L, r: R, pip: { [L.seed]: 5, [R.seed]: 5 }, pipShow: { [L.seed]: 5, [R.seed]: 5 }, hud: false };
    const roll = r() < 0.4, helmets = p.helmets != null ? !!p.helmets : roll;
    // within a few strides of each other (or as long as they've had to get there), the
    // gloves come off, they square up, and the camera comes down to them
    function squareUp() {
      if (B.gloves) return;
      B.gloves = true;
      W.dropGloves(L, helmets); W.dropGloves(R, helmets); W.crowd = 0.95;
      L.stance = R.stance = 0.5;
      at(B, 0.45, () => { L.guard = R.guard = true; L.stance = R.stance = 0.75; W.cam.mode = 'zoom'; W.cam.focus = [cx, cy]; });
      at(B, 1.1, () => { frame('fight', [cx, cy]); W.fight.hud = true; W.banner = { text: 'FIGHT!', t0: W.t, dur: 1.2 }; });
    }
    const ACT = { jab: 'jab', uppercut: 'uppercut', left: 'punchL', right: 'punchR' };
    // Each punch lands as the booth calls it. A punch whose line was cut falls between its
    // neighbours; with no cues at all they come in a quick flurry as before.
    const times = ex.map((e, n) => { const c = cueOf(p, 'punch', 'n', n); return c != null ? c + 0.15 : null; });
    {
      let last = 2.45 - 0.5;
      for (let n = 0; n < times.length; n++) {
        if (times[n] != null) { times[n] = Math.max(times[n], last + 0.4); last = times[n]; continue; }
        let k = n + 1; while (k < times.length && times[k] == null) k++;
        const next = k < times.length ? times[k] : null;
        times[n] = next != null ? last + (next - last) * (1 / (k - n + 1)) : last + 0.42 + r() * 0.2;
        last = times[n];
      }
    }
    const grabCue = cueOf(p, 'grab');
    // (each of these waits for the gloves: a pair still skating together throw nothing)
    const after = (t, fn) => { const go = () => { if (B.gloves && W.t - B.glovesAt >= 0.9) fn(); else at(B, 0.2, go); }; at(B, t, go); };
    after(grabCue != null ? Math.min(Math.max(1.9, grabCue + 0.3), (times[0] ?? 2.45) - 0.2) : Math.max(1.9, (times[0] ?? 2.45) - 0.45), () => { L.grab = R; R.grab = L; B.grab = true; });
    let t = 2.45;
    ex.forEach((e, i) => {
      const last = i === ex.length - 1;
      const thrower = e.thrower === p.loser ? lose : win, taker = thrower === win ? lose : win;
      const kindAct = ACT[e.type] || 'punchR';
      t = times[i];
      after(t, () => punch(thrower, taker, e.landed, kindAct, last));
      if (p.ending === 'jersey' && e.n === p.pullAt) after(t + 0.32, () => { W.act(win, 'pull', 0.8); lose.grab = null; B.pull = true; W.sfx('cloth'); });
    });
    t = (times[times.length - 1] ?? 2.45) + 0.6;
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
    const endCue = cueOf(p, 'end');
    const tEnd = endCue != null ? Math.max(t + 0.3, endCue) : t + (p.ending === 'knockdown' ? 1.2 : 0.4);
    after(tEnd, () => {
      B.linesmen = true;
      W.officials.forEach((o, i) => { o.maxV = 18; o.target = i ? R : L; });
    });
    after(tEnd + 1.6, () => {
      L.grab = R.grab = null; L.guard = R.guard = false; B.grab = false; B.apart = true;
      W.officials.forEach((o, i) => W.act(o, 'hug', 2.2));
    });
    // Off to the box, both of them, the linesmen trailing them, as the booth sends them.
    // Then the draw: the referee picks up what they left on the ice, the linesman gets the
    // puck (see stopPlay).
    const boxCue = cueOf(p, 'box'), tBox = boxCue != null ? Math.max(tEnd + 2.6, boxCue + 0.3) : tEnd + 3.6;
    after(tBox - 1.0, () => { frame('broadcast', [cx, cy]); W.fight.hud = false; });
    after(tBox, () => {
      B.toBox = true;
      for (const [f, i] of [[L, 0], [R, 1]]) { if (f.rag) W.getUp(f, 0.8); leave(f, cx + (i ? 10 : -10)); }
      gearUp(); W.fight = null; stopPlay(B, p.nextDot);
    });
    // what came off in the fight is picked up by the referee at the stoppage, not cleared
    const gearUp = () => { for (const d of W.debris) if (hyp(d.x - cx, d.y - cy) < 18 && !D.gear.includes(d)) D.gear.push(d); };
    B.update = (dt, rel) => {
      if (B.stopped) return;
      if (!B.gloves) {
        // skating in to meet him
        const gap = hyp(L.x - R.x, L.y - R.y);
        L.tx = cx - 2.6; L.ty = cy; R.tx = cx + 2.6; R.ty = cy; L.maxV = R.maxV = gap > 12 ? 22 : 9;
        L.face = gap < 14 ? 0 : null; R.face = gap < 14 ? Math.PI : null;
        if (gap < 9 || rel > 6) { squareUp(); B.glovesAt = W.t; }
        for (const m of ring) { if (!m.ring || !m.active) continue; const a = m.ring.a; m.tx = cx + Math.cos(a) * m.ring.rad; m.ty = cy + Math.sin(a) * m.ring.rad * 0.8; m.maxV = 14; }
        W.cam.focus = [(L.x + R.x) / 2, (L.y + R.y) / 2];
        return;
      }
      const sep = B.grab ? 3.4 : 4.6, wob = 0.9 * Math.sin(rel * 1.1);
      if (!B.apart) {
        if (!L.rag) { L.tx = cx - sep / 2 + wob; L.ty = cy + 0.3 * Math.sin(rel * 2.3); L.maxV = hyp(L.tx - L.x, L.ty - L.y) > 3 ? 18 : 7; }
        if (!R.rag) { R.tx = cx + sep / 2 + wob; R.ty = cy - 0.3 * Math.sin(rel * 2.3); R.maxV = hyp(R.tx - R.x, R.ty - R.y) > 3 ? 18 : 7; }
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
        // once they're apart the second goes and gets the puck for the draw
        if (i && B.apart) { fetchPuck(o); return; }
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
      gearUp();
    };
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
      const d = hyp(bx - g.x, 2 - g.y), step = Math.min(d, 15 * dt);
      g.tx = g.x + (bx - g.x) / (d || 1) * step * 12; g.ty = g.y + (2 - g.y) / (d || 1) * step * 12;
      g.face = Math.atan2(2 - g.y, bx - g.x);
      W.cam.focus = [g.x, g.y + 10];
      if (g.y < 3.5 || W.t - B.t0 > 7) done();
    };
    function done() {
      if (!g.active) return;
      g.active = false; W.pulled[side] = true;
      const extra = W.team[side].find((b) => !b.active);
      if (extra) { fresh(extra); extra.active = true; overBoards(extra, g.x); }
      at(B, 0.8, () => finish(B));
    }
    B.cleanup = () => done();
    return B;
  }

  // ── a penalty ─────────────────────────────────────────────────────────────
  // The referee's arm goes up and the whistle goes; the man skates to the box and his side
  // plays a man short until a play's strength says otherwise (`lineUp`). The draw is in his
  // end, and everybody makes for it.
  function stagePenalty(p) {
    const B = begin('penalty');
    const side = tagSide(p.victimSide) || sideOfTeam(p.victimTeam, p) || 'a';
    const man = bodyFor(side, p.victim || p.player, W.nearestOf(W.mates(side), pk.x, pk.y));
    whistle(); land(B);
    const ref = W.officials[1];
    if (ref && ref.active && !ref.rag) W.act(ref, 'point', 1.4);
    if (man) leave(man, clamp(man.x, 85, RL - 85), false);
    stopPlay(B, p.nextDot);
    return B;
  }

  // ── intermission ──────────────────────────────────────────────────────────
  // Everyone off: the teams skate to the benches, the linesman takes the puck off with him,
  // and the Zamboni comes on through the end gate. It laps the sheet laying clean ice, and
  // sweeps up whatever was left lying on it, until the period's opening draw calls it off.
  function stageIntermission(p) {
    const B = begin('intermission');
    D.intermission = { on: [...W.team.a, ...W.team.h].filter((b) => b.active) };
    W.frozen = true; W.puckScripted = true;
    W.fight = null; W.lamp = 0;
    for (const b of [...W.team.a, ...W.team.h, W.goalie.a, W.goalie.h]) if (b && b.active && !busyBody(b)) leave(b, b.x, false);
    const [lin, ref] = W.officials;
    B.ownsCam = true;
    land(B);
    // When the booth says the period is back (`resume`), the Zamboni has gone off and the
    // teams are out and lined up for the draw: it leaves eleven seconds before, they come on
    // six before. Without the cue, both happen when the period's first draw arrives.
    const back = cueOf(p, 'resume');
    if (back != null) {
      at(B, Math.max(8, back - 11), () => W.zamboniOff());
      at(B, Math.max(10, back - 6.5), () => { teamsOn(); B.regroup = 'C'; B.stopped = true; W.cam.mode = 'broadcast'; });
    }
    B.update = () => {
      if (B.stopped) return;
      // the linesman collects the puck and goes off with it; the referee goes straight off
      if (lin.active && !busyBody(lin) && fetchPuck(lin)) leave(lin, lin.x, false);
      if (ref.active && !busyBody(ref)) leave(ref, ref.x, false);
      // the Zamboni once the ice is clear, or near enough
      if (!W.zamboni && !B.zam && (W.skaters().length === 0 || W.t - B.t0 > 6)) { B.zam = true; W.startZamboni(opts.zamboniSpeed || 28); W.cam.mode = 'zam'; }
      const z = W.zamboni;
      W.cam.focus = z ? [Math.max(z.x, 6), z.y] : [pk.x, pk.y];
    };
    B.cleanup = () => endIntermission();
    return B;
  }
  // The period is about to start: the Zamboni drives off, and both teams and the officials
  // come back on over the boards, the linesman with the puck in his hand.
  function endIntermission() {
    if (!D.intermission) return;
    W.zamboniOff();
    teamsOn();
    D.mournTo = 0;
    D.intermission = null;
  }
  function teamsOn() {
    if (D.intermission.on === null) return;
    D.intermission.on = null;
    // anybody still on his way off turns round
    for (const k of D.tasks) if (k.leave) for (const b of k.bodies) b.scripted = false;
    D.tasks = D.tasks.filter((k) => !k.leave);
    W.pulled.a = W.pulled.h = false;
    for (const side of ['a', 'h']) {
      W.team[side].forEach((b) => { if (b.slot < 5 && !b.active && !busyBody(b)) { fresh(b); b.active = true; overBoards(b, RL / 2 + (side === 'a' ? -1 : 1) * (12 + b.slot * 5)); } });
      const g = W.goalie[side];
      if (!g.active) { fresh(g); g.active = true; g.stick = true; overBoards(g, RL / 2 + (side === 'a' ? -36 : 36)); }
    }
    W.officials.forEach((o, i) => { if (!o.active) { fresh(o); o.active = true; o.stick = false; o.gloves = false; overBoards(o, RL / 2 + (i ? 20 : -4)); } });
  }

  // ── before the first play ─────────────────────────────────────────────────
  // The men are lined up for the opening draw and the linesman has the puck at centre:
  // what a viewer sees while waiting for the drop. Set before anything is drawn, so it is
  // where they start rather than a jump.
  function pregame() {
    const B = begin('pregame');
    const [dx, dy] = DOT_FT.C;
    for (const side of ['a', 'h']) {
      const centre = centreOf(side);
      for (const m of W.mates(side)) { const [x, y] = spotFor(m, side, dx, dy, centre); m.x = m.tx = m.x0 = x; m.y = m.ty = m.y0 = y; m.h = attackDir(side) > 0 ? 0 : Math.PI; }
    }
    const [lin, ref] = W.officials;
    lin.x = lin.tx = lin.x0 = dx + 1.5; lin.y = lin.ty = lin.y0 = dy - 6; lin.h = Math.PI / 2;
    ref.x = ref.tx = ref.x0 = dx + 22; ref.y = ref.ty = ref.y0 = RW - 6; ref.h = -Math.PI / 2;
    const hand = skaterRig(lin, W.t)[9];
    pk.held = lin; pk.x = hand[0]; pk.y = hand[1]; pk.z = hand[2];
    stopPlay(B, 'C');
  }
  pregame();

  // ── the entry point ───────────────────────────────────────────────────────
  // A DRAW GOES DOWN BEFORE THE NEXT PLAY. The booth gives a stoppage a few seconds, and a
  // play can arrive while the men are still on their way to the dot. It waits for the drop
  // (`D.queued`, three seconds at most, the draw hurrying), and keeps the time it arrived,
  // so it catches up with its lines rather than trailing them.
  const QUEUE_MAX = 3;
  function stage(p) {
    if (!p) return null;
    // (a newer play replaces one already waiting; the wait is still counted from the first)
    const B0 = D.beat, was = D.queued;
    D.queued = null;
    if (B0 && B0.kind === 'faceoff' && !B0.dropped && p.type !== 'faceoff' && p.type !== 'intermission') {
      D.queued = { p, at: W.t, since: was ? was.since : W.t };
      return null;
    }
    return stageNow(p);
  }
  function stageNow(p) {
    D.seq = (D.seq || 0) + 1;
    if (replay.active) { replay.stop(); wipe(0.5); }
    // only a goal is ever replayed, so only a goal's play is recorded: keeping every man's
    // joints thirty times a second all game would be work nobody watches
    D.recording = p.type === 'goal'; D.recordUntil = null;
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
      case 'penalty': return stagePenalty(p);
      case 'intermission': return stageIntermission(p);
    }
    const B = begin(p.type || 'beat'); land(B); at(B, 0.3, () => finish(B)); return B;
  }

  // the director's own tick, run by the world before anything else each step
  W.script = (dt) => {
    // the replay: kept every step; played on the world's clock, back to live when it ends
    if (replay.active) replay.tick(dt); else if (D.recording && W.t < (D.recordUntil ?? Infinity)) replay.record();
    // a play waiting on a draw goes as soon as the puck is down, or when it can wait no longer
    if (D.queued) {
      const F = D.beat, q = D.queued;
      if (!F || F.kind !== 'faceoff' || F.dropped || W.t - q.since > QUEUE_MAX) { D.queued = null; D.arrived = q.at; stageNow(q.p); }
    }
    const B = D.beat;
    if (B && B.update) B.update(dt, W.t - B.t0);
    // a whistle's beat, holding the picture until the draw: everybody to the dot
    if (B && B.stopped) regroupTick(B);
    if (!B || !B.ownsCam || (B.stopped && !B.keepCam)) W.cam.focus = [pk.x, pk.y];
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
    reset() { if (D.beat) { D.beat.cleanup?.(); D.beat = null; } releaseAll(); },
    state: D,
  };
}
