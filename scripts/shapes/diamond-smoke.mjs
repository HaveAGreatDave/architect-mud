// Diamond smoke: stages real Deadball games pitch by pitch in the 3-D park's world, headlessly,
// and fails if a pitch misses its spot, a mitt or a bat misses the ball, an at-bat ends the wrong
// way, a play lands late, or the booth's line goes up before the play it calls.
//
// The director (client/game/js/panels/diamond/director.js) has no server to test it, and what it
// stages is what a viewer takes for the game. So this runs the actual sim (sim v2, so a game has
// hit batsmen) and builds the actual payloads (sports/baseball-gameday.js), then:
//
//   1. THE DIRECTOR, every at-bat of the game, at the shortest hold (a 13-second budget, where a
//      long at-bat leaves pitches out) and a long one (35 seconds, where the rituals come in):
//      a log entry and a count for every pitch, in order; each pitch through the plate within
//      0.05 ft of its spot (hud.js pitchPoint); every clip lined up on the ball, to the
//      microsecond (the delivery's release as the ball leaves his hand, within 0.05 ft of it; the
//      catch, the swing's contact, a miss within 0.03 s of it, the flinch); the catcher's mitt on
//      the ball at the catch (0.1 ft); on contact the ball on the bat's barrel (0.15 ft off its axis) with both hands
//      on the bat (0.05 ft); the hitter and the catcher inside their joints there; a hit batsman
//      hit; strike three with its walk off and a called one rung up, ball four and the walk to
//      first, the flinch, or the ball put in play; `onLand` once, on time, inside the budget,
//      with the count done by then; every shot a camera; every pose finite. And the game has to
//      exercise the rare paths, or the gate isn't testing them: a pitch left out, a ritual, a
//      block, a check swing, a punch-out, a hit batsman.
//   2. THE VIEW, with a recording renderer in place of the GL park and the hand-cranked clock:
//      payloads fed the way tv.js feeds them, each after its held line; the line stays the last
//      one until the play lands and is this one after; the count on the board is the last
//      pitch's (never a fourth ball or a third strike); a strikeout or a walk gets its splash;
//      the battery's poses and the ball reach the renderer; every pitch shown makes its sound
//      and the play its own; once everyone's at rest the frames stop; and with no frames at all
//      (a hidden tab) the line still goes up once the play's time has passed.
//
// It proves the staging RUNS and agrees with the sim. It doesn't look at pixels: the sandbox
// page (tools/sandbox/deadball-park-test.html?park=3d) is for looking.
//
// Run:  node scripts/shapes/diamond-smoke.mjs [seed]     (one game a gate; the manifest runs two)

import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const P = '../../client/game/js/panels/';
const { createWorld, DT, toPark } = await import(P + 'diamond/world.js');
const { createDirector } = await import(P + 'diamond/director.js');
const { castOf } = await import(P + 'diamond/cast.js');
const { pitchPoint } = await import(P + 'diamond/hud.js');
const { solvePose } = await import(P + 'diamond/rig.js');
const { handPoint, limitBreaks, eventTime } = await import(P + 'diamond/anim.js');
const { SHOTS } = await import(P + 'diamond/camera.js');
const { createGrandstandView } = await import(P + 'gameday-grandstand.js');
const { sportsRng } = await import('../../plugins/broadcast/rng.js');
const { simGameV2 } = await import('../../plugins/broadcast/sports/baseball.js');
const { gamedayPayloads } = await import('../../plugins/broadcast/sports/baseball-gameday.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// The plan's budget, worked out here rather than taken from the director: 0.45 of the line's hold,
// kept between 13 and 26 seconds, and 13 for a payload with no hold.
const budgetOf = (p) => Math.min(26, Math.max(13, Number.isFinite(p.hold) ? 0.45 * p.hold / 1000 : 0));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The broadcast's own formatters, near enough, as gameday-smoke has them.
const abbr = (n) => String(n || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'TBD';
const ORD = ['', '1st', '2nd', '3rd'];
const ordinal = (n) => ORD[n] || `${n}th`;
const SEED = Number(process.argv[2]) || 16;
const game = simGameV2({ away: 'Rats', home: 'Kings' }, null, sportsRng(SEED * 2654435761 + 7), { seed: SEED });
const order = gamedayPayloads(game, SEED, { abbr, ordinal }).order;
const atBats = order.filter((p) => !p.phase && (p.pitches || []).length);
const T0 = Date.now();

// ── 1. the director ──────────────────────────────────────────────────────────
const seen = { skip: 0, ritual: 0, block: 0, check: 0, punchout: 0, hbp: 0, lefty: 0, sideL: 0 };
const W = createWorld();
for (const hold of [undefined, 35000]) {
  for (const p0 of atBats) {
    const p = hold ? { ...p0, hold } : p0;
    const label = `seed ${SEED}${hold ? ' hold 35s' : ''}: ${p.inning}${p.half[0]} ${p.batter} ${p.kind} [${p.pitches.map((q) => q.result).join(',')}]`;
    const cast = castOf(p);
    const slotOf = (role) => (role === 'ump' ? cast.find((c) => c.id === 'ump:plate') : cast.find((c) => c.look.role === role)).look.slot;
    const [sP, sC, sH, sU] = ['pitcher', 'catcher', 'batter', 'ump'].map(slotOf);
    let landed = 0, landT = null;
    const counts = [], shots = [];
    const D = createDirector(W, { onLand: () => { landed++; landT = W.t; }, emit: (n, d) => { if (n === 'pitch') counts.push({ t: W.t, i: d.i }); else if (n === 'shot') shots.push(d); } });
    const t0 = W.t;
    D.stage(p, cast);
    const N = p.pitches.length, budget = budgetOf(p);
    check('a log entry per pitch', D.log.length === N, `${label}: ${D.log.length}/${N}`);
    // checks at the moments the director says things meet
    const due = [];
    for (const rec of D.log) {
      if (!rec.shown) { seen.skip++; continue; }
      if (rec.view.ritual) seen.ritual++;
      const q = p.pitches[rec.i];
      if (rec.result !== 'hbp') {
        const want = pitchPoint(q, p.bats), got = rec.plateAt;
        const d = got ? Math.hypot(got[0] - want[0], got[1] - want[1]) : Infinity;
        check('each pitch crosses the plate within 0.05 ft of its spot', d <= 0.05 && Math.abs(got[2] - want[2]) < 1e-6, `${label} #${rec.n}: ${d.toFixed(3)} ft`);
      }
      // a clip at its event at world time t, give or take `slack` seconds
      const lined = (slot, clipId, kind, t, slack = 0) => { const b = W.bodies.get(slot); return b.clip?.id === clipId && Math.abs(W.clipTime(b, t) - eventTime(b.clip, kind)) <= slack + 1e-6; };
      due.push([rec.release, () => {
        const b = W.bodies.get(sP), hand = p.throws === 'L' ? 'L' : 'R';
        check('the delivery is at its release as the ball leaves', /^pitch_(windup|stretch)_/.test(b.clip?.id) && lined(sP, b.clip.id, 'release', rec.release), `${label} #${rec.n}: ${b.clip?.id} at ${W.clipTime(b, rec.release).toFixed(3)}`);
        const J = solvePose(W.pose(sP, rec.release)).J, at = J['wr' + hand].map((v, k) => v + J['hdir' + hand][k] * 0.2);
        check('the ball leaves from his hand (0.05 ft)', dist(at, rec.path(rec.release)) <= 0.05, `${label} #${rec.n}: ${dist(at, rec.path(rec.release)).toFixed(3)} ft`);
      }]);
      if (rec.swing) due.push([rec.swing.t, () => check('a miss: the swing within 0.03 s of the ball', lined(sH, rec.swing.clip, 'contact', rec.swing.t, 0.03), `${label} #${rec.n}`)]);
      if (rec.catch) {
        if (rec.catch.clip === 'catch_block') seen.block++;
        due.push([rec.catch.t, () => {
          check('the catch is lined up on the ball reaching the mitt', lined(sC, rec.catch.clip, 'catch', rec.catch.t), `${label} #${rec.n} ${rec.catch.clip}`);
          const b = W.bodies.get(sC), Q = W.pose(sC, rec.catch.t);
          const d = dist(toPark(b, handPoint(Q, 'L', 'mitt', b.scale)), rec.path(rec.catch.t));
          check('the mitt meets the ball at the catch (0.1 ft)', d <= 0.1, `${label} #${rec.n} ${rec.catch.clip}: ${d.toFixed(3)} ft`);
          const L = { ...Q, at: [0, 0, 0], yaw: 0 }, br = limitBreaks(L, solvePose(L));
          check('the catcher inside his joints at the catch', !br.length, `${label} #${rec.n}: ${br.join('; ')}`);
        }]);
      }
      if (rec.contact) due.push([rec.contact.t, () => {
        check('the swing\'s contact is lined up on the ball reaching the bat', lined(sH, rec.contact.swing, 'contact', rec.contact.t), `${label} #${rec.n} ${rec.contact.swing}`);
        const b = W.bodies.get(sH), Q = W.pose(sH, rec.contact.t);
        if (!Q.bat) { check('the bat in his hands at contact', false, `${label} #${rec.n}`); return; }
        const knob = toPark(b, Q.bat.knob), d = sub(toPark(b, Q.bat.knob.map((v, k) => v + Q.bat.dir[k])), knob), ball = rec.path(rec.contact.t);
        const along = dot(sub(ball, knob), d), off = dist(ball, knob.map((v, k) => v + d[k] * along));
        check('on contact the ball is on the barrel, 0.15 ft off the bat\'s axis', off <= 0.15 && along >= 1.9 && along <= 2.75, `${label} #${rec.n}: ${off.toFixed(3)} ft off, ${along.toFixed(2)} ft up`);
        const J = solvePose(Q).J, grip = Math.max(dist(J.wrL, J.wrTL), dist(J.wrR, J.wrTR));
        check('both hands on the bat at contact (0.05 ft)', grip <= 0.05, `${label} #${rec.n}: ${grip.toFixed(3)} ft`);
        const L = { ...Q, at: [0, 0, 0], yaw: 0 }, br = limitBreaks(L, solvePose(L));
        check('the hitter inside his joints at contact', !br.length, `${label} #${rec.n}: ${br.join('; ')}`);
      }]);
      if (rec.hit) due.push([rec.hit.t, () => {
        seen.hbp++;
        check('the flinch is lined up on the ball reaching him', lined(sH, 'bat_hbp', 'hit', rec.hit.t), label);
        const d = dist(solvePose(W.pose(sH, rec.hit.t)).J.chest, rec.hit.at);
        check('a hit batsman: the ball reaches him (0.7 ft from his chest)', d <= 0.7, `${label}: ${d.toFixed(2)} ft`);
      }]);
    }
    due.sort((a, b) => a[0] - b[0]);
    // the clock, and every pose finite now and then on the way
    let k = 0;
    while (W.t < Math.max(D.until, D.landAt) + 0.1) {
      W.step(DT);
      while (due.length && due[0][0] <= W.t) due.shift()[1]();
      if (++k % 12 === 0) {
        for (const s of [sP, sC, sH, sU]) {
          const J = solvePose(W.pose(s)).J;
          if (!Object.values(J).every((v) => !Array.isArray(v) || v.every(Number.isFinite))) { check('every pose finite', false, `${label}: slot ${s} at ${(W.t - t0).toFixed(2)} s`); break; }
        }
      }
    }
    check('onLand fires once', landed === 1, `${label}: ${landed}`);
    check('it lands when the director said', landT != null && landT - D.landAt <= DT + 1e-9 && landT >= D.landAt - 1e-9, `${label}: ${landT} for ${D.landAt}`);
    check('the play lands inside its budget (0.45 of the hold, 13 to 26 s)', D.landAt - t0 <= budget + 1e-9, `${label}: ${(D.landAt - t0).toFixed(2)} of ${budget} s`);
    check('the count goes through every pitch, in order, by the landing', counts.length === N && counts.every((c, j) => c.i === j) && counts[N - 1].t <= D.landAt + DT, `${label}: ${counts.map((c) => c.i)}`);
    for (const s of shots) check('every shot is a camera', !!SHOTS[s], `${label}: ${s}`);
    if (shots.includes('sideL')) seen.sideL++;
    if (p.bats === 'L') seen.lefty++;
    seen.check += D.played.filter((x) => x.clip === 'bat_check').length;
    // the at-bat ends the way the sim ended it
    const last = D.log[N - 1], played = (role, clip) => D.played.some((x) => x.role === role && x.clip === clip);
    if (p.kind === 'strikeout') {
      const rung = last.result === 'called' && last.call.clip.startsWith('ump_punchout') && played('ump', last.call.clip);
      if (rung) seen.punchout++;
      check('a strikeout: strike three, rung up if he took it, and the walk off', (last.result === 'swinging' || rung) && played('batter', 'bat_strikeout'), label);
    } else if (p.kind === 'walk') check('a walk: ball four and off to first', last.result === 'ball' && played('batter', 'bat_walk'), label);
    else if (p.kind === 'hitbypitch') check('a hit batsman: the pitch hits him and he flinches', last.result === 'hbp' && !!last.hit && played('batter', 'bat_hbp'), label);
    else check('a ball in play: the bat meets it', last.result === 'inplay' && !!last.contact, label);
  }
}
check('the game leaves a pitch out of a long at-bat on a short hold', seen.skip > 0);
check('the game has a ritual (the throw back and the walk up) on a long hold', seen.ritual > 0);
check('the game has a ball in the dirt blocked', seen.block > 0);
check('the game has a check swing', seen.check > 0);
check('the game has a called third strike rung up', seen.punchout > 0);
check('the game has a hit batsman', seen.hbp > 0);
check('a left-handed hitter gets the third-base camera', seen.lefty === 0 || seen.sideL > 0);

// ── 2. the view ──────────────────────────────────────────────────────────────
// A renderer that records what it's handed: the cast, the poses by slot, the ball, the shots.
const rec = { poses: new Map(), balls: 0, frames: 0 };
const renderer = () => ({
  kind: 'stub', lost: false, quality: { dpr: 1, tube: false }, casters: [],
  setCast(cast) { rec.cast = cast; return 0; },
  setPose(slot, pose) { rec.poses.set(slot, pose); },
  setBall(p) { if (p) rec.balls++; },
  render() { rec.frames++; return true; },
  setBoard() {}, setVenue() { return null; }, pump() { return 0; }, pending: () => 0, dispose() {},
});
{
  const host = stub.makeHost();
  const v = createGrandstandView(host, { force: true, renderer });
  await v.ready();
  const capText = () => host.querySelector('.gds-cap-text')?.textContent ?? '';
  // the first payloads in order, as far as two half-innings and a strikeout, a walk and a hit batsman
  const feed = [];
  const want = new Set(['strikeout', 'walk', 'hitbypitch']);
  for (const p of order) {
    feed.push(p);
    if (!p.phase) want.delete(p.kind);
    if (feed.length >= 24 && !want.size) break;
  }
  check('the view is fed a strikeout, a walk and a hit batsman', !want.size, [...want].join(', '));
  let prevLine = '';
  feed.forEach((p, k) => {
    const line = `line ${k}: ${p.desc || p.phase || p.kind}`;
    const label = `seed ${SEED} view #${k} ${p.phase || p.kind}`;
    rec.poses.clear(); rec.balls = 0;
    const sounds0 = stub.sounds.length;
    // the line first and then its payload, as the broadcast sends them
    v.setCaption(line, { held: true });
    v.apply(p);
    const atBat = !p.phase && (p.pitches || []).length;
    if (atBat) {
      const D = v.director, W2 = v.world, budget = budgetOf(p), start = W2.t;
      check('the view hands the at-bat to the director', D && !D.landed && D.payload === p, label);
      // up to just before the landing, the last line is still up
      let held = true;
      while (!D.landed && W2.t - start < budget + 2) {
        stub.runFrames(1, 1000 / 30);
        if (!D.landed && capText() !== prevLine) held = false;
      }
      check('the line is held until the play lands', held, `${label}: "${capText()}" before the landing`);
      check('the play lands in the view inside its budget', D.landed && W2.t - start <= budget + 0.1, `${label}: ${(W2.t - start).toFixed(2)} of ${budget} s`);
      check('the line goes up when the play lands', capText() === line, `${label}: "${capText()}"`);
      const S = v.state, last = p.pitches[p.pitches.length - 1];
      check('the board has the last pitch\'s count, without a fourth ball or a third strike', S.balls === Math.min(3, last.balls) && S.strikes === Math.min(2, last.strikes) && S.pitch === last, `${label}: ${S.balls}-${S.strikes}`);
      if (p.kind === 'strikeout' || p.kind === 'walk') check('a strikeout or a walk gets its splash', S.splash?.kind === p.kind, `${label}: ${S.splash?.kind}`);
      const battery = ['pitcher', 'catcher', 'batter'].map((r) => p0slot(p, r));
      check('the battery\'s poses reach the renderer', battery.every((s) => rec.poses.has(s)), `${label}: ${[...rec.poses.keys()]}`);
      check('the ball reaches the renderer', rec.balls > 0, label);
      const shown = D.log.filter((r) => r.shown).length;
      check('a sound for every pitch shown, and the play\'s own', stub.sounds.length - sounds0 >= shown + 1, `${label}: ${stub.sounds.length - sounds0} for ${shown} pitches`);
      check('the view\'s camera is a shot', !!SHOTS[v.shot], `${label}: ${v.shot}`);
      // then everyone comes to rest and the frames stop
      for (let i = 0; i < 300 && v.busy(); i++) stub.runFrames(1, 1000 / 30);
      const frames = rec.frames;
      stub.runFrames(20, 1000 / 30);
      check('at rest, the frames stop', !v.busy() && rec.frames === frames, `${label}: ${rec.frames - frames} more frames`);
    } else {
      stub.runTimers(2500);
      check('a play on the bases or a changeover: its line goes up', capText() === line, `${label}: "${capText()}"`);
    }
    prevLine = line;
  });
  // a hidden tab: no frames at all, and the play still lands its line, a beat after its time
  {
    const p = atBats.find((x) => !feed.includes(x)) || atBats[atBats.length - 1];
    v.setCaption('the hidden line', { held: true });
    v.apply(p);
    stub.runTimers(1000);
    check('a hidden tab: the line waits while the play is due', capText() !== 'the hidden line', capText());
    stub.runTimers(30000);
    check('a hidden tab: the line goes up once the play\'s time has passed', capText() === 'the hidden line', capText());
  }
  v.clear();
  check('cleared', host.children.length === 0);
}
function p0slot(p, role) { return castOf(p).find((c) => c.look.role === role).look.slot; }

const ms = Date.now() - T0;
console.log(`diamond-smoke seed ${SEED}: ${atBats.length} at-bats twice, ${passes}/${passes + failures} passed (${(ms / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
