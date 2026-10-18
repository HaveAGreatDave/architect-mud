// Rink smoke: plays real CPhL games through the Rinkside view headlessly and fails if a
// beat throws, stalls, or stages the wrong outcome.
//
// The rink is the only part of the hockey pipeline with no server to test it. So this
// runs the actual sim and the actual narrator for two fixed games, feeds every payload
// they produce to the view the way tv.js does, steps the world, renders now and then into
// a stub canvas, and checks that what happened on the ice agrees with what was said:
// every goal goes into the net and no save does, the faceoff is taken on the right dot,
// the fight's loser ends with nothing left, a man carried off is gone, a death stops the
// building, the Zamboni leaves the whole sheet fresh.
//
// And that NOTHING TELEPORTS: the puck never moves farther in a step than a shot carries
// it, no man does either (except coming on over the boards), and the camera never jumps.
//
// It proves the view RUNS and that its outcomes match the sim's. It does not look at
// pixels and is not meant to.
//
// Run:  node scripts/shapes/rink-smoke.mjs [37|914]

import fs from 'fs';
import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const { createRinkView, __test } = await import('../../client/game/js/panels/gameday-rink.js');
const { DT, bladeWorld } = await import('../../client/game/js/panels/rink/rig.js');
const { GOAL_X, DOT_FT, MID_Y } = await import('../../client/game/js/panels/rink/geo.js');
const { createRinkCamera } = await import('../../client/game/js/panels/rink/camera.js');
const { sportsRng, sportsHash, sportsPick, sportsFill } = await import('../../plugins/broadcast/rng.js');
const HOCKEY = (await import('../../plugins/broadcast/sports/hockey.js')).default;
const { paceCalls } = await import('../../plugins/broadcast/sports/hockey-pacing.js');
const { coverage: zamboniCoverage } = await import('../../client/game/js/panels/rink/zamboni.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};

// ── the script, as the broadcast regress reads it ──────────────────────────────
const src = fs.readFileSync(new URL('../../data/scripts/hockey.bsm', import.meta.url), 'utf8');
const block = (k) => (src.split(`::${k}`)[1]?.split(`::end${k}`)[0] || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).map((s) => s.replace(/"/g, ''));
const pools = {};
{ let key = null; for (const raw of src.split(/\r?\n/)) { const l = raw.trim(); if (l.startsWith('::lines ')) { key = l.slice(8).trim(); pools[key] = []; continue; } if (l.startsWith('::')) { key = null; continue; } if (key && l && !l.startsWith('#')) pools[key].push(l); } }
const teams = block('teams'), players = block('players');
// the clubs' identities, as the broadcast row carries them, so the kits and crests are
// dressed and drawn the way a viewer's client draws them once tv_clubs has answered
const clubs = JSON.parse(fs.readFileSync(new URL('../../content/media_broadcasts/bc_cluster_puck.json', import.meta.url), 'utf8')).sports_pools?.clubs || null;
const { setClubs, clubOf } = await import('../../client/game/js/panels/club-crest.js');
if (clubs) setClubs('hockey', 'smoke', clubs);
// THE ZAMBONI'S PATTERN COVERS THE SHEET: every square foot inside the boards is under its
// conditioner at least once, so a period always starts on fresh ice
{ const missed = zamboniCoverage(4); check('the Zamboni pattern covers every foot of the sheet', missed === 0, `${missed} sq ft missed`); }
check('every club in the league has an identity', teams.every((t) => !!clubOf(t)), teams.filter((t) => !clubOf(t)).join(', '));

function gameLines(slot) {
  const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams, clubs };
  const seed = sportsHash(slot, 0);
  const game = HOCKEY.simGame(matchup, players, sportsRng(seed));
  const nrng = sportsRng(seed ^ 0x9e3779b9);
  const lines = [];
  HOCKEY.narrate({
    script: {}, game, gs: { seed, game }, slot, ws: false, announcer: 'Tug Brennan', pools, nrng, sport: HOCKEY, add: () => {},
    say: (line, tok, sb, fx, gd, meta) => { if (line) lines.push({ text: sportsFill(line, tok).trim(), graphic: fx || null, gameday: gd || null, _cue: meta && meta.cue, _opt: (meta && meta.opt) || false }); },
    pick: (...keys) => sportsPick(pools, nrng, ...keys),
    abbr: (n) => String(n).slice(0, 3).toUpperCase(), recordOf: () => '8-4-1', lastId: () => null,
  });
  // paced as for the default hour-long slot, which writes the cues onto the payloads
  const { holds, dropped } = paceCalls(lines, 3600 * 1000 * 0.85, 1000);
  return lines.filter((l) => !dropped.has(l)).map((l) => ({ text: l.text, fx: l.graphic, gd: l.gameday, hold: holds.get(l) }));
}

// ── one game through the view ──────────────────────────────────────────────────
// Slot 914 (the Marquee Marauders at the Coldwater Highlanders, in the tartan) and slot
// 37 (the Waterfront Wharf Rats at the Westside Warlords, in the gem-set stripe) each stage
// every beat type the sim emits, a pulled goalie and a death among them.
const seen = new Set();
// a replay's stand-in world has the men, the puck and a camera of its own
const src0ok = (RP) => { const s = RP.source; return s.bodies().length >= 10 && Number.isFinite(s.puck.x) && s.cam.mode === 'replay'; };
async function play(slot) {
  const host = stub.makeHost();
  const view = createRinkView(host);
  await view.ready();
  view.showIdle();
  check(`${slot}: the idle screen shows over live ice`, !!host.find('.gdr-idle') && !!host.find('.gdr-canvas'));
  const lines = gameLines(slot);
  const W = view.world, D = view.director;
  let goalsIn = 0, renders = 0, nan = 0;
  const emit = W.emit;
  W.emit = (n, d) => { if (n === 'goalIn') goalsIn++; emit(n, d); };
  const resurfaced = { n: 0 };
  const rs = W.ice.resurface; W.ice.resurface = (...a) => { resurfaced.n++; return rs(...a); };
  let lastFight = null, tApply = 0, landedAt = null, grabAt = null, boxAt = null, sawBreakaway = false, wearAtBreak = 0, rushB = null;
  // (the sheet as the Zamboni leaves it, before the teams come out and cut it up again)
  let zamOn = false, wearAfterZam = null, markedAfterZam = null, markedWhere = "";
  const draws = { n: 0, onCue: 0 };
  // THE PUCK NEVER SNAPS. It never moves farther in a step than a shot carries it, and
  // nobody gains it from beyond his reach: where his blade can get to (`W.inReach`, the box
  // rig.js aims the blade in), his skates, or a short stick from his blade's own spot. There
  // are no camera cuts to hide a jump.
  const jumps = [], snaps = [], pendingGives = [];
  // NOBODY TELEPORTS EITHER: a man on the ice never moves farther in a step than a skater
  // can (a ragdoll thrown into the boards included), and the only place one appears is
  // the near boards, coming on from the bench.
  const leaps = [], pops = [];
  let onIce = [];
  // AND THE CAMERA NEVER CUTS: from one 60 Hz frame to the next it moves no farther than
  // its springs allow.
  const camJumps = [];
  // IT STAYS ON THE PUCK. Through a hit, until it lands, play goes on and the picture with
  // it, framed on the puck as everywhere else.
  const camOff = [];
  // A HIT THE PICTURE MISSED IS RUN BACK as the booth brings it up (the `recall` cue): with
  // play stopped, on the man who was hit, the hit in it, and the live picture back before
  // the puck drops. Every one the booth brings up while the rink has it kept is run back.
  const hitRp = { missed: 0, owed: 0, shown: 0, bad: [], lastT: null, missedT: null, on: false, dropB: null };
  // TWO MEN AFTER ONE PUCK FIGHT FOR IT: the man after it is in on him (`tussle`) going at
  // it with his stick or his shoulder. Sampled with the pairs below: men after it, and how
  // many of them were at it.
  const battle = { n: 0, at: 0 };
  const BATTLE_ACTS = new Set(['lift', 'poke', 'shove', 'sweep']);
  // PASSES ARE TAKEN. Nothing steers a pass to its man: it's played to where he'll be and
  // he meets it, so nearly every pass in a rush gets to him rather than going by him.
  const passes = { n: 0, missed: 0, list: [] };
  let pending = null;
  // AND PLAYED THE WAY THE BOOTH CALLED IT. The rink lifts a pass over a stick only when the
  // booth called a saucer, and a one-timer or a tip is struck straight off the pass (or the
  // shot it redirects), from the man the booth said fed it.
  let curG = null, lastShot = null;
  const lastPassTo = new Map(), unasked = [], fedShots = { n: 0, bad: [] };
  const pass0 = W.pass;
  W.pass = (from, to, spd, at) => {
    const ok = pass0(from, to, spd, at);
    if (ok && to && D.kind() === 'rush' && W.puck.target === to) { passes.n++; pending = { to, t: W.t }; }
    if (ok && to) lastPassTo.set(to, { from, t: W.t });
    return ok;
  };
  // EVERY SOUND THE RINK ASKS FOR IS ONE THE SOUNDSET KNOWS (the event table in
  // client/shared/hockey-sfx.js): a key it doesn't know is a sound that never plays.
  const sfxKeys = new Set(Object.keys(globalThis.window.HockeySfx.EVENTS)), unknownSfx = new Set();
  const sfx0 = W.sfx;
  W.sfx = (key, o) => { if (!sfxKeys.has(key)) unknownSfx.add(key); return sfx0(key, o); };
  const act0 = W.act;
  W.act = (b, name, dur, data) => {
    if (name === 'saucer' && b && b.scripted && D.kind() === 'rush' && !((curG && curG.cues) || []).some((c) => c.pass === 'saucer')) unasked.push(`${b.name || b.kind} at ${(W.t - tApply).toFixed(2)}s`);
    return act0(b, name, dur, data);
  };
  const give0 = W.give;
  W.give = (b, force) => {
    const pk = W.puck, bw = b ? bladeWorld(b, W.t, true) : null, d = bw ? Math.hypot(bw[0] - pk.x, bw[1] - pk.y) : 0, hidden = pk.hidden;
    const reach = !!b && (W.inReach(b, pk.x, pk.y) || Math.hypot(pk.x - b.x, pk.y - b.y) < 1.6);
    const ok = give0(b, force);
    if (ok && b && d > 3.2 && !reach && !hidden) pendingGives.push(`${b.name || b.kind} from ${d.toFixed(1)} ft at ${(W.t - tApply).toFixed(2)}s`);
    return ok;
  };
  // A BREAKAWAY IS ONE. From when the man the booth sends in alone has the puck to his shot,
  // he is nearer their goalie than any man of theirs, and he has it 40 ft out or more. (They
  // were a man in on a cycle, their defence between him and the net.)
  let ba = null;
  // SHOTS ARE TAKEN IN STRIDE. A shooter skates into his shot: nobody stands still with it
  // for a second and then lets it go. (`_still`: when a man last dropped under 3 ft/s.)
  const shotsTaken = [];
  // AND NOBODY STANDS STILL AGAINST A MAN OF THEIRS. Two of them a stick apart and both
  // still is a picture frozen, in a battle for the puck or waiting on a stoppage. A draw is
  // set that way, a fight is watched that way (until the whistle sends them to the box), and
  // the building stops for a death; nothing else holds it over five seconds. Sampled ten
  // times a second, a slot per pair.
  const pairSince = new Float64Array(64), pairSeen = new Int32Array(64).fill(-9), pairTold = new Uint8Array(64);
  const frozenPairs = [];
  let pairAt = -1, pairN = 0;
  const STILL2 = 1.5 * 1.5, NEAR2 = 7 * 7;
  // NO SHOT AT A NET THE VIEWER CAN'T SEE. The camera is run here at 60 Hz, in both views,
  // and at every release and half a second after it, the puck and the net it's going at
  // must both be in frame.
  const cams = ['broadcast', 'low'].map((view) => { const c = createRinkCamera(W); c.view = view; return { view, c, P: null, last: null }; });
  let camAt = -1;
  const unseen = [], shotChecks = [];
  const inFrame = (P, x, y, z) => { const q = P && P(x, y, z); return !!q && q.x > 900 * 0.02 && q.x < 900 * 0.98 && q.y > 506 * 0.04 && q.y < 506 * 0.96; };
  const seeShot = (netX, when) => {
    for (const k of cams) {
      if (W.cam.mode !== 'broadcast') continue;
      const pk = W.puck;
      if (!inFrame(k.P, netX, MID_Y, 2)) unseen.push(`${k.view}: net at ${netX} out of frame ${when} (${(W.t - tApply).toFixed(2)}s, puck ${pk.x.toFixed(0)},${pk.y.toFixed(0)}, cam ${k.c.cam.lx.toFixed(0)}/${k.c.cam.dist.toFixed(0)}, net cue ${W.cam.net})`);
      else if (!inFrame(k.P, pk.x, pk.y, pk.z)) unseen.push(`${k.view}: puck out of frame ${when} (${(W.t - tApply).toFixed(2)}s, puck ${pk.x.toFixed(0)},${pk.y.toFixed(0)},${pk.z.toFixed(1)}, cam ${k.c.cam.lx.toFixed(0)}/${k.c.cam.ly.toFixed(0)}/${k.c.cam.dist.toFixed(0)}, mode ${W.cam.mode})`);
    }
  };
  const shoot0 = W.shoot;
  W.shoot = (from, tgt, spd, type) => {
    if (type === 'onetimer' || type === 'tip') {
      // (a tip redirects a shot; a one-timer is struck off a pass)
      const fed = ((curG && curG.cues) || []).find((c) => c.ev === 'shot') || {}, lp = type === 'tip' ? lastShot : lastPassTo.get(from);
      fedShots.n++;
      if (!lp || W.t - lp.t > 1.2) fedShots.bad.push(`${type} by ${from.name} at ${(W.t - tApply).toFixed(2)}s off nothing`);
      else if (fed.feeder && lp.from.name !== String(fed.feeder).split(' ').pop()) fedShots.bad.push(`${type} fed by ${lp.from.name || '?'}, called ${fed.feeder}`);
    }
    lastShot = { from, t: W.t };
    if (ba && from === ba.sh && ba.got && ba.shotAt == null) ba.shotAt = W.t;
    if (from && from.kind === 'skater') shotsTaken.push({ type, v: Math.hypot(from.vx, from.vy), still: from._still != null ? W.t - from._still : 0, at: `${curG ? curG.type : '?'} ${(W.t - tApply).toFixed(2)}s` });
    const tt = shoot0(from, tgt, spd, type);
    const netX = Math.abs(tgt[0] - GOAL_X[0]) < Math.abs(tgt[0] - GOAL_X[1]) ? GOAL_X[0] : GOAL_X[1];
    seeShot(netX, 'at the release');
    shotChecks.push({ at: W.t + Math.min(0.5, tt), netX });
    return tt;
  };
  // a frame every four seconds of play, counted across calls: reset per call, it drew
  // once per caption line and was half the gate's CPU
  let next = W.t;
  const run = (secs, until) => {
    const t0 = W.t;
    while (W.t - t0 < secs) {
      const pk = W.puck, x0 = pk.x, y0 = pk.y, h0 = pk.hidden;
      W.step(DT);
      if (W.t - camAt >= 1 / 60 - 1e-9) {
        camAt = W.t;
        for (const k of cams) {
          k.P = k.c.update(900, 506, W.t * 1000).P;
          const c = k.c.cam, l = k.last;
          // (its springs cap a pan at 140 ft/s and a pull back at 60: 2.3 and 1 ft a frame)
          if (l && (Math.abs(c.lx - l.lx) > 3 || Math.abs(c.ly - l.ly) > 3 || Math.abs(c.dist - l.dist) > 3 || Math.abs(c.pitch - l.pitch) > 0.08)) camJumps.push(`${k.view}: ${Math.abs(c.lx - l.lx).toFixed(1)}/${Math.abs(c.ly - l.ly).toFixed(1)}/${Math.abs(c.dist - l.dist).toFixed(1)} ft at ${(W.t - tApply).toFixed(2)}s (${D.kind() || 'between plays'}, ${W.cam.mode})`);
          k.last = { lx: c.lx, ly: c.ly, dist: c.dist, pitch: c.pitch };
        }
      }
      while (shotChecks.length && W.t >= shotChecks[0].at) seeShot(shotChecks.shift().netX, 'as it arrives');
      if (!h0 && !pk.hidden && (pk.x - x0) ** 2 + (pk.y - y0) ** 2 > 1.6 * 1.6) jumps.push(`${Math.hypot(pk.x - x0, pk.y - y0).toFixed(1)} ft at ${(W.t - tApply).toFixed(2)}s (${D.kind() || 'between plays'}) from ${x0.toFixed(1)},${y0.toFixed(1)}`);
      if (pendingGives.length) { snaps.push(...pendingGives); pendingGives.length = 0; }
      if (pending) {
        if (W.puck.carrier === pending.to || D.kind() !== 'rush') pending = null;
        else if (W.puck.target !== pending.to) { passes.missed++; passes.list.push(`${(W.t - tApply).toFixed(2)}s`); pending = null; }
      }
      // (each man's position at the start of the step is his x0, y0: see sim.js)
      // (squared lengths and a short list, not a Set: this runs every step of every game)
      const now = W.bodies();
      for (const b of now) {
        if (b.kind === 'skater') { if (b.vx * b.vx + b.vy * b.vy < 9) { if (b._still == null) b._still = W.t; } else b._still = null; }
        if (!onIce.includes(b)) { if (onIce.length && b.y > 3 && b.kind !== 'medic') pops.push(`${b.kind} ${b.side}${b.slot} appeared at ${b.x.toFixed(0)},${b.y.toFixed(0)} at ${(W.t - tApply).toFixed(2)}s (${D.kind() || 'between plays'})`); continue; }
        const dx = b.x - b.x0, dy = b.y - b.y0;
        if (dx * dx + dy * dy > 0.75 * 0.75) leaps.push(`${b.kind} ${b.side}${b.slot} ${Math.hypot(dx, dy).toFixed(1)} ft at ${(W.t - tApply).toFixed(2)}s (${D.kind() || 'between plays'})`);
      }
      onIce = now;
      const hb = D.state.beat;
      if (hb && hb.kind === 'boards' && !hb.landed && !W.frozen && camOff.length < 8) {
        const f = W.cam.focus;
        if (W.cam.mode !== 'broadcast' || (f[0] - pk.x) ** 2 + (f[1] - pk.y) ** 2 > 4) camOff.push(`${W.cam.mode}, ${Math.hypot(f[0] - pk.x, f[1] - pk.y).toFixed(1)} ft off it at ${(W.t - tApply).toFixed(2)}s`);
      }
      const lh = D.state.lastHit;
      if (lh && lh.t !== hitRp.lastT) { hitRp.lastT = lh.t; if (!lh.seen && !lh.fatal) { hitRp.missed++; hitRp.missedT = lh.t; } }
      const hon = W.replay.active && W.replay.kind === 'hit';
      if (hon && !hitRp.on) {
        const R = W.replay, at = `${(W.t - tApply).toFixed(2)}s into ${curG ? curG.type : '?'}`;
        hitRp.shown++;
        const why = [!W.frozen && 'play going on', !((curG && curG.cues) || []).some((c) => c.ev === 'recall') && 'nobody brought it up', !R.follow && 'on the puck, not the man',
          !(hitRp.missedT > R.from && hitRp.missedT < R.to) && 'the hit not in it'].filter(Boolean);
        if (!why.length && !R.frame().bodies().some((b) => b.seed === R.follow.seed && b.side === R.follow.side)) why.push('the man hit not in it');
        if (why.length) hitRp.bad.push(`${why.join(', ')} at ${at}`);
        // (what the viewer sees: the REPLAY bug with the hit named under it, drawn once a game)
        if (hitRp.shown === 1) { view.renderer.render(W.t * 1000); renders++; }
      }
      hitRp.on = hon;
      if (hb && hb.kind === 'faceoff' && hb.dropped && hitRp.dropB !== hb) { hitRp.dropB = hb; if (W.replay.active) hitRp.bad.push(`a replay still up as the puck drops ${(W.t - tApply).toFixed(2)}s into ${curG ? curG.type : '?'}`); }
      if (ba && ba.shotAt == null && W.t - tApply >= ba.alone - 2) {
        const pk = W.puck;
        if (!ba.got) { ba.sh = W.team[ba.att].find((m) => m.active && m.name === ba.name) || null; if (ba.sh && pk.carrier === ba.sh) ba.got = true; }
        if (ba.got && pk.carrier === ba.sh) {
          const gl = W.goalie[ba.def], gx = gl && gl.active ? gl.x : ba.netX, gy = gl && gl.active ? gl.y : MID_Y;
          const dc = Math.hypot(ba.sh.x - gx, ba.sh.y - gy);
          if (ba.out == null) ba.out = dc;
          for (const m of W.mates(ba.def)) {
            if (m.kind !== 'skater') continue;
            const e = Math.hypot(m.x - gx, m.y - gy) - dc;
            if (e < ba.min) { ba.min = e; ba.minAt = `${(W.t - tApply).toFixed(2)}s, ${m.name || m.slot} ${(-e).toFixed(1)} ft nearer`; }
          }
        }
      }
      if (W.t - pairAt >= 0.1 - 1e-9) {
        pairAt = W.t; pairN++;
        const B = D.state.beat, bk = B ? B.kind : null;
        for (const side of ['a', 'h']) for (const m of W.team[side]) if (m.tussle && m !== pk.carrier && m.active) { battle.n++; if (BATTLE_ACTS.has(m.act)) battle.at++; }
        if (bk !== 'faceoff' && bk !== 'death' && !(bk === 'fight' && !B.stopped)) {
          for (const a of W.team.a) {
            if (!a.active || a.kind !== 'skater' || a.rag || a.hold || a.vx * a.vx + a.vy * a.vy > STILL2) continue;
            for (const h of W.team.h) {
              if (!h.active || h.kind !== 'skater' || h.rag || h.hold || a.foe === h || h.vx * h.vx + h.vy * h.vy > STILL2) continue;
              if ((a.x - h.x) ** 2 + (a.y - h.y) ** 2 > NEAR2) continue;
              // (a pair not seen at the last sample starts again; each still spell is told once)
              const k = (a.slot & 7) * 8 + (h.slot & 7);
              if (pairSeen[k] !== pairN - 1) { pairSince[k] = W.t; pairTold[k] = 0; }
              pairSeen[k] = pairN;
              if (!pairTold[k] && W.t - pairSince[k] > 5) {
                pairTold[k] = 1;
                frozenPairs.push(`${a.name || 'a' + a.slot} and ${h.name || 'h' + h.slot} at ${a.x.toFixed(0)},${a.y.toFixed(0)}, ${(W.t - tApply).toFixed(1)}s into ${curG ? curG.type : 'the game'} (${bk || 'between plays'}${W.frozen ? ', stopped' : ''})`);
              }
            }
          }
        }
      }
      if (W.fight) lastFight = W.fight;
      if (landedAt == null && D.state.beat && D.state.beat.landed) landedAt = W.t - tApply;
      if (grabAt == null && D.state.beat && D.state.beat.grab) grabAt = W.t - tApply;
      if (W.banner && W.banner.text === 'BREAKAWAY!') sawBreakaway = true;
      if (boxAt == null && D.state.beat && D.state.beat.toBox) boxAt = W.t - tApply;
      // (this payload's rush: staged as it arrives, or once a draw it waited on goes down)
      if (!rushB && D.state.beat && D.state.beat.kind === 'rush') rushB = D.state.beat;
      if (zamOn && !W.zamboni) { wearAfterZam = W.ice.wear; markedAfterZam = W.ice.markedFeet(); markedWhere = W.ice.markedWhere(40).map((q) => q.join(",")).join(" "); }
      zamOn = !!W.zamboni;
      if (W.t >= next) { next = W.t + 10; view.renderer.render(W.t * 1000); renders++; }
      if (until && until()) break;
    }
    stub.runTimers(0);
    for (const b of W.bodies()) if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) nan++;
    if (!Number.isFinite(W.puck.x) || !Number.isFinite(W.puck.y)) nan++;
  };
  for (const l of lines) {
    const g = l.gd;
    view.setCaption(l.text, { held: !!g });
    if (l.fx) view.showCard(l.fx);
    // A line with no play runs as long as the booth holds it, as on air: that's the time a
    // stoppage has for everybody to get to the next draw.
    if (!g) { run((l.hold || 400) / 1000); continue; }
    seen.add(g.type);
    const label = `${slot}: ${g.type}${g.kind && g.kind !== g.type ? `/${g.kind}` : ''} at ${g.section} ${g.clock}`;
    let ok = true;
    tApply = W.t; landedAt = null; grabAt = null; boxAt = null; sawBreakaway = false; rushB = null;
    const replays0 = W.replay.count;
    // (a hit the rink has kept that this play's lines bring up is owed a replay in it)
    const owed = (g.cues || []).some((c) => c.ev === 'recall') && !!(D.state.hitClip || D.state.hitPending), shown0 = hitRp.shown;
    curG = g;
    const al = (g.kind === 'breakaway' || g.breakaway) && (g.cues || []).find((c) => c.ev === 'alone');
    if (al) {
      const att = g.attackingTeam === g.awayTeam ? 'a' : 'h';
      ba = { att, def: att === 'a' ? 'h' : 'a', netX: att === 'a' ? GOAL_X[1] : GOAL_X[0], name: String(g.shooter || '').split(' ').pop(), alone: al.ms / 1000, sh: null, got: false, out: null, min: Infinity, minAt: '', shotAt: null };
    } else ba = null;
    try { view.apply(g); } catch (e) { check(`${label} stages`, false, e.stack.split('\n').slice(0, 2).join(' ')); ok = false; }
    if (!ok) continue;
    const before = { inNet: W.puck.inNet, goals: goalsIn, on: { a: W.mates('a').length, h: W.mates('h').length }, broken: W.broken.size };
    // THE HEADER WAITS FOR THE GOAL. A goal's payload carries the score after it, so until
    // the puck goes in the header shows the score before it and the strip names no result.
    // (read from the markup: the stub's textContent puts a parent's text before its children's)
    const headSays = () => { const m = /<b>(\d+)<\/b>: <b>(\d+)<\/b>/.exec(host.find('.gdr-head')?.innerHTML || ''); return { score: m ? `${m[1]}-${m[2]}` : '?', desc: host.find('.gdr-strip-desc')?.textContent || '' }; };
    if (g.type === 'goal' && g.scoreBefore) {
      const h0 = headSays();
      check(`${label}: the header shows the score before the goal until it goes in`, h0.score === `${g.scoreBefore.away}-${g.scoreBefore.home}` && h0.desc === 'Live', `${h0.score} / ${h0.desc}`);
    }
    const fb = g.type === 'faceoff' ? D.state.beat : null;
    if (g.type === 'faceoff') {
      // the draw is taken on the named dot, by the two men the sim named, with the puck
      // brought there in the linesman's hand
      const [dx, dy] = DOT_FT[g.dot];
      run(16, () => D.state.beat && D.state.beat.dropped);
      const c = W.skaters().filter((m) => Math.hypot(m.x - dx, m.y - dy) < 3.2);
      check(`${label}: two centres on the dot`, c.length === 2, `${c.length} men`);
      check(`${label}: the winner wears his name`, c.some((m) => m.name === String(g.winner).split(' ').pop()));
      check(`${label}: the linesman drops it on the dot`, Math.hypot(W.puck.x - dx, W.puck.y - dy) < 3.5 && W.officials[0].active, `puck ${W.puck.x.toFixed(1)},${W.puck.y.toFixed(1)}`);
    }
    if (g.type === 'boards') {
      const victim = () => W.skaters().find((m) => m.name === String(g.victim).split(' ').pop()) || null;
      const imp = (g.cues || []).find((q) => q.ev === 'impact');
      run((imp ? imp.ms / 1000 : 0) + 4, () => victim() && victim().rag);
      check(`${label}: the hit puts him down`, !!(victim() && victim().rag), `victim ${victim() ? 'standing' : 'not found'}; names ${W.skaters().map((m) => m.side + ':' + m.name + (m.rag ? '*' : '')).join(',')}`);
      // what the booth said the hit did, it did
      if (g.helmetOff) check(`${label}: the helmet the booth called comes off`, !!victim() && victim().helmet === false);
      if (g.injured) {
        run(3);
        check(`${label}: an injured man stays down`, !!(victim() && victim().rag));
      }
      if (g.shatter) { run(1); check(`${label}: the glass the booth called goes`, W.broken.size > before.broken, `${before.broken} → ${W.broken.size} panes`); }
    }
    // the play is timed to its lines now, so it runs as long as its last cue plus the finish
    const lastCue = Math.max(0, ...(g.cues || []).map((c) => c.ms / 1000));
    // (an intermission's one cue is the period coming back, a minute on: the lines after it
    // carry the time to then)
    const limit = g.type === 'intermission' ? 3 : Math.max({ injury: 22, death: 16, fight: 16 }[g.type] || 14, lastCue + 10);
    if (g.type === 'intermission') { wearAtBreak = W.ice.wear; wearAfterZam = markedAfterZam = null; }
    run(limit, () => !D.busy());
    // a draw and a hit land when their line airs
    const cueT = (ev) => { const c = (g.cues || []).find((q) => q.ev === ev); return c ? c.ms / 1000 : null; };
    // with a drop line the puck goes down on it and the win line confirms it; without one
    // the draw is won as the win line airs
    // NEVER BEFORE ITS LINE, AND NO LATER THAN IT CAN BE. Nobody is put on a dot any more: the
    // men skate there and the linesman brings the puck. After a whistle they're usually set
    // before the line (and most draws are counted below); when the booth gives a stoppage a
    // second or two and the dot is the length of the ice away, it goes down as soon as they
    // are, never held after that.
    const setAt = fb && fb.readyAt != null ? fb.readyAt : null;
    const prompt = landedAt != null && setAt != null && landedAt <= Math.max(setAt, fb.dropAt) + 1.6;
    if (g.type === 'faceoff' && cueT('drop') != null) {
      const onCue = landedAt != null && landedAt >= cueT('drop') && landedAt <= (cueT('won') ?? cueT('drop') + 2) + 0.3;
      draws.n++; if (onCue) draws.onCue++;
      check(`${label}: the puck drops as it is called, or as soon as they're set`, landedAt != null && landedAt >= cueT('drop') && (onCue || prompt), `won at ${landedAt?.toFixed(2)}s, set at ${setAt?.toFixed(2)}s, drop line ${cueT('drop')}s, win line ${cueT('won')}s, after a ${g.reason}`);
    } else if (g.type === 'faceoff' && cueT('won') != null) {
      const onCue = landedAt != null && Math.abs(landedAt - cueT('won')) < 0.8;
      draws.n++; if (onCue) draws.onCue++;
      check(`${label}: the draw is won as it is called, or as soon as they're set`, landedAt != null && landedAt > cueT('won') - 0.8 && (onCue || prompt), `won at ${landedAt?.toFixed(2)}s, set at ${setAt?.toFixed(2)}s, line at ${cueT('won')}s, after a ${g.reason}`);
    }
    if (g.type === 'fight' && cueT('grab') != null) {
      const p0 = (g.cues || []).find((q) => q.ev === 'punch');
      check(`${label}: they grab on before the first punch`, grabAt != null && (!p0 || grabAt <= p0.ms / 1000 + 0.2), `grab ${grabAt?.toFixed(2)}s, line ${cueT('grab')}s`);
    }
    if (g.type === 'fight' && cueT('box') != null) check(`${label}: they go to the box as they're sent`, boxAt != null && boxAt >= cueT('box') && boxAt <= cueT('box') + 1.2, `box ${boxAt?.toFixed(2)}s, line ${cueT('box')}s`);
    if (g.type === 'boards' && cueT('impact') != null ) check(`${label}: the hit lands as it is called`, landedAt != null && Math.abs(landedAt - cueT('impact')) < 0.9, `hit at ${landedAt?.toFixed(2)}s, line at ${cueT('impact')}s`);
    // A TAKEAWAY THE BOOTH CALLS IS A BATTLE ON THE ICE: the man goes at the puck carrier and
    // pokes it loose as the line airs, or, when nobody of theirs has it, their man comes at it
    // and loses the battle for it.
    if ((g.type === 'chance' || g.type === 'goal') && cueT('takeaway') != null) {
      check(`${label}: the takeaway the booth calls is a battle for the puck`, !!rushB && !!rushB.battled);
      if (rushB && rushB.tookAt != null) check(`${label}: the puck comes loose as the takeaway is called`, Math.abs(rushB.tookAt - cueT('takeaway')) < 0.6, `loose at ${rushB.tookAt.toFixed(2)}s, line at ${cueT('takeaway')}s`);
    }
    if ((g.type === 'chance' || g.type === 'goal') && cueT('out') != null && g.kind !== 'breakaway') check(`${label}: the puck arrives as the outcome is called`, landedAt != null && landedAt > cueT('shot') && Math.abs(landedAt - cueT('out')) < (g.type === 'goal' ? 2.4 : 1.2), `${g.shotType}: landed ${landedAt?.toFixed(2)}s, outcome line ${cueT('out')}s`);
    check(`${label} resolves`, !D.busy() || g.type === 'intermission', `still ${D.kind()} after ${limit}s`);
    if (owed) { hitRp.owed++; if (hitRp.shown === shown0) hitRp.bad.push(`${label}: the booth brought up a hit the picture missed and it wasn't run back`); }
    if (g.type === 'goal') check(`${label}: it goes in`, goalsIn > before.goals && !!W.puck.inNet, `inNet=${W.puck.inNet}`);
    if (g.type === 'goal') {
      const h1 = headSays();
      check(`${label}: the header takes the goal when it goes in`, h1.score === `${g.awayScore}-${g.homeScore}` && h1.desc === g.desc, `${h1.score} / ${h1.desc}`);
    }
    if (g.kind === 'breakaway' || g.breakaway) check(`${label}: the breakaway gets its banner`, sawBreakaway);
    if (ba) {
      seen.add('breakaway');
      check(`${label}: the man in alone has the puck before he shoots`, ba.got, `${ba.name} never had it`);
      if (ba.got) {
        check(`${label}: he has it with the slot and more still to go`, ba.out >= 40, `${ba.out.toFixed(0)} ft from their goalie`);
        check(`${label}: from when he has it to his shot, he is nearer their goalie than any man of theirs`, ba.min > 0, ba.minAt);
      }
      ba = null;
    }
    // THE REPLAY. A goal the booth calls a replay on is run back: it starts on its cue, the
    // picture comes from the recording (interpolated, every joint finite), the renderer
    // draws it, and it hands back to the live game as the booth does (the `live` cue on the
    // credit after the replay's lines), so only the replay's lines are said over it.
    const rc = cueT('replay');
    if (g.type === 'goal' && rc != null) {
      const RP = W.replay;
      // (it can start while the celebration is still going, before the beat resolves)
      if (RP.count === replays0) run(Math.max(0.5, rc + 2 - (W.t - tApply)), () => RP.count > replays0);
      check(`${label}: the replay starts on its cue`, RP.count > replays0);
      let bad = 0, frames = 0, drew = 0;
      const rs = W.t;
      while (RP.active && W.t - rs < 20) {
        run(0.5, () => !RP.active);
        if (!RP.active) break;
        const src = RP.frame(); frames++;
        for (const b of src.bodies()) for (const p of src.rigOf(b)) if (p && !p.every(Number.isFinite)) bad++;
        if (frames % 6 === 1) { view.renderer.render(W.t * 1000); drew++; }
      }
      const endAt = W.t - tApply, lc = cueT('live');
      check(`${label}: the replay plays back sound frames`, frames > 8 && bad === 0 && src0ok(RP), `${frames} frames, ${bad} bad joints`);
      check(`${label}: the replay ends and hands back to live`, !RP.active && drew > 0);
      if (lc != null) check(`${label}: the replay hands back as the booth comes back live`, Math.abs(endAt - lc) < 0.5, `ended ${endAt.toFixed(2)}s, live line ${lc}s`);
    }
    if (g.type === 'chance') check(`${label}: a ${g.kind} stays out`, goalsIn === before.goals);
    if (g.type === 'fight') {
      const F = lastFight; lastFight = null;
      const loser = F && [F.l, F.r].find((b) => b.name === String(g.loser).split(' ').pop());
      const winner = F && [F.l, F.r].find((b) => b.name === String(g.winner).split(' ').pop());
      check(`${label}: the loser has nothing left`, !!loser && F.pip[loser.seed] === 0);
      check(`${label}: the winner is still standing`, !!winner && F.pip[winner.seed] > 0);
      if (g.helmets) check(`${label}: the helmets the booth called come off`, !!F && !F.l.helmet && !F.r.helmet);
    }
    if (g.type === 'injury') {
      check(`${label}: he is carried off`, !W.skaters().some((m) => m.name === String(g.victim || g.player).split(' ').pop() && m.down));
      check(`${label}: the stretcher has gone`, !W.stretcher);
    }
    if (g.type === 'death') check(`${label}: the building stops`, W.mourning > 0.6 && W.crowd < 0.1, `mourning ${W.mourning.toFixed(2)}`);
    if (g.type === 'pull') {
      const side = g.pulledSide === 'att' ? 'a' : 'h';
      check(`${label}: the net is empty`, W.pulled[side] && !W.goalie[side].active);
      check(`${label}: an extra skater is on`, W.mates(side).length === before.on[side] + 1, `${before.on[side]} → ${W.mates(side).length}`);
    }
    if (g.type === 'intermission') {
      check(`${label}: the board goes up over the ice`, !!host.find('.gdri') && !!host.find('.gdr-canvas'));
      run(9);
      // the crew have both nets off and out through the gates before it goes on
      check(`${label}: the nets are off for the Zamboni`, W.nets.a.out && W.nets.h.out && !W.nets.job);
      check(`${label}: the Zamboni is out, on a time-lapse`, !!W.zamboni && resurfaced.n > 50 && W.zamboni.lapse > 1, `${resurfaced.n} passes`);
      check(`${label}: the ice is wet behind it`, W.ice.wetness > 0.5);
    }
    // THE PERIOD STARTS ON FRESH ICE. The Zamboni drove off through its gate (driven, not
    // removed) before the teams came on, leaving not one marked foot of the sheet, measured as
    // it leaves, before the teams cut it up again; and the puck goes down on dry ice with both
    // nets back on their pegs. (The 1st has had no Zamboni.)
    if (g.type === 'faceoff' && g.reason === 'period' && g.section !== '1st') {
      const N = W.nets;
      check(`${label}: the Zamboni left the whole sheet fresh`, !W.zamboni && markedAfterZam === 0 && wearAfterZam === 0, `zamboni ${W.zamboni ? `${W.zamboni.x.toFixed(0)},${W.zamboni.y.toFixed(0)}` : 'off'}, ${markedAfterZam} marked sq ft as it left (${markedWhere}), wear ${wearAtBreak.toFixed(3)} → ${wearAfterZam}`);
      check(`${label}: the puck goes down on dry ice, the nets back on`, W.ice.wetness === 0 && N.state === 'on' && !N.job && !N.a.dx && !N.a.dy && !N.h.dx && !N.h.dy, `wetness ${W.ice.wetness.toFixed(2)}, nets ${N.state}${N.job ? ' moving' : ''}`);
    }
    // ten men dressed, whatever has happened (unless a goalie is pulled or a man is short)
    const n = W.mates('a').length + W.mates('h').length;
    check(`${label}: skaters on the ice`, n >= 8 && n <= 12 || g.type === 'intermission', `${n}`);
  }
  // most draws with a line of their own go down right on it
  check(`${slot}: most draws go down as their line airs`, draws.n === 0 || draws.onCue / draws.n >= 0.75, `${draws.onCue}/${draws.n}`);
  check(`${slot}: no position ever went non-finite`, nan === 0, `${nan}`);
  check(`${slot}: the puck never jumps`, jumps.length === 0, `${jumps.length}: ${jumps.slice(0, 4).join(', ')}`);
  check(`${slot}: nobody on the ice jumps`, leaps.length === 0, `${leaps.length}: ${leaps.slice(0, 4).join(', ')}`);
  check(`${slot}: nobody appears except over the near boards`, pops.length === 0, `${pops.length}: ${pops.slice(0, 4).join(', ')}`);
  check(`${slot}: the camera never jumps`, camJumps.length === 0, `${camJumps.length}: ${camJumps.slice(0, 4).join(', ')}`);
  check(`${slot}: the camera stays on the puck through a hit until it lands`, camOff.length === 0, `${camOff.length}: ${camOff.slice(0, 4).join(', ')}`);
  check(`${slot}: a hit the picture missed is run back as the booth brings it up`, hitRp.shown > 0 && hitRp.bad.length === 0, `${hitRp.shown} run back, ${hitRp.owed} brought up, ${hitRp.missed} missed: ${hitRp.bad.slice(0, 4).join('; ')}`);
  check(`${slot}: two men after one puck fight for it`, battle.n > 200 && battle.at >= battle.n * 0.3, `${battle.at} of ${battle.n} samples of a man after it at it with his stick or shoulder`);
  check(`${slot}: every shot is taken with its net in frame`, unseen.length === 0, `${unseen.length}: ${unseen.slice(0, 4).join(', ')}`);
  check(`${slot}: nobody gains the puck from beyond his reach`, snaps.length === 0, `${snaps.length}: ${snaps.slice(0, 4).join(', ')}`);
  check(`${slot}: the rink lifts a pass only when the booth called a saucer`, unasked.length === 0, `${unasked.length}: ${unasked.slice(0, 4).join(', ')}`);
  check(`${slot}: a one-timer or a tip is struck off the pass, by the man the booth said fed it`, fedShots.n > 0 && fedShots.bad.length === 0, `${fedShots.bad.length} of ${fedShots.n}: ${fedShots.bad.slice(0, 4).join(', ')}`);
  const standing = shotsTaken.filter((q) => q.still > 1);
  check(`${slot}: shots are taken in stride, not after standing still with it`, standing.length <= Math.max(2, shotsTaken.length * 0.05), `${standing.length} of ${shotsTaken.length} after more than a second under 3 ft/s: ${standing.slice(0, 4).map((q) => `${q.type} ${q.at} (${q.still.toFixed(1)}s)`).join(', ')}`);
  const strideV = shotsTaken.filter((q) => q.type === 'wrist' || q.type === 'snap' || q.type === 'backhand').map((q) => q.v).sort((x, y) => x - y);
  check(`${slot}: wrist, snap and backhand shots come off the move`, strideV.length > 20 && strideV[strideV.length >> 1] > 6, `median ${strideV.length ? strideV[strideV.length >> 1].toFixed(1) : '-'} ft/s over ${strideV.length}`);
  check(`${slot}: nobody stands still against a man of theirs`, frozenPairs.length === 0, `${frozenPairs.length}: ${frozenPairs.slice(0, 4).join('; ')}`);
  check(`${slot}: rush passes get to the man they're for`, passes.n > 20 && passes.missed <= Math.max(2, passes.n * 0.05), `${passes.missed} of ${passes.n} went by him: ${passes.list.slice(0, 4).join(', ')}`);
  check(`${slot}: the renderer drew`, renders > 100 && stub.drawn.images > 1000, `${renders} frames, ${stub.drawn.images} images`);
  check(`${slot}: the held caption went up`, String(host.find('.gdr-cap-text')?.textContent || '').length > 0);
  check(`${slot}: sounds played`, stub.sounds.length > 20, `${stub.sounds.length}`);
  check(`${slot}: every sound the rink asks for is in the soundset`, unknownSfx.size === 0, [...unknownSfx].join(', '));
  view.clear();
  check(`${slot}: clear empties the host`, host.children.length === 0);
}

// Run bare, it plays both games. The push gate runs each game as its own gate (a slot number
// as the argument), side by side, so neither carries the other's CPU. Each one stages every
// beat type on its own.
// (slot 37 has breakaways in it too, which the breakaway checks need)
const ALL = ['faceoff', 'chance', 'goal', 'boards', 'fight', 'scrum', 'injury', 'death', 'pull', 'intermission'];
const EXPECT = { 37: [...ALL, 'breakaway'], 914: ALL };
const slots = process.argv.slice(2).map(Number).filter((n) => EXPECT[n]);
for (const slot of slots.length ? slots : [37, 914]) await play(slot);
for (const t of [...new Set((slots.length ? slots : [37, 914]).flatMap((n) => EXPECT[n]))]) {
  check(`a "${t}" was staged`, seen.has(t), [...seen].join(','));
}
for (const k of ['save', 'glove', 'pad', 'blocked', 'wide', 'post', 'breakaway', 'goal']) check(`SAVE has "${k}"`, !!__test.SAVE[k]);
check('GEO puts the goal lines where geo.js does', Math.abs(__test.GEO.goalLine[1] * 200 - GOAL_X[1]) < 1e-9);

console.log(`rink smoke: ${passes}/${passes + failures} passed`);
if (failures) process.exit(1);
