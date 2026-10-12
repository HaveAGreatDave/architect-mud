// Diamond smoke: stages real Deadball games pitch by pitch in the 3-D park's world, headlessly,
// and fails if a pitch misses its spot, a mitt or a bat misses the ball, an at-bat ends the wrong
// way, a play lands late, or the booth's line goes up before the play it calls.
//
// The director (client/game/js/panels/diamond/director.js) has no server to test it, and what it
// stages is what a viewer takes for the game. So this runs the actual sim (sim v2, so a game has
// hit batsmen) and builds the actual payloads (sports/baseball-gameday.js), then:
//
//   1. THE DIRECTOR, every at-bat of the game, at the shortest hold (a 13-second budget, where a
//      long at-bat leaves pitches out) and a long one (45 seconds, where the rituals come in):
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
//   1b. THE PLAYS (diamond/plays.js), every ball in play at the short hold: each catch's clip on its
//      catch with the glove on the ball (0.1 ft) and the catcher inside his joints; each throw's
//      clip on its release and the ball out of his hand (0.05 ft); the call at first agreeing
//      with the picture (an out has the ball there before the batter, a throw he beats after
//      him); nobody's pelvis faster than 52 ft/s outside a cut, sampled at 30 Hz (a sprint is 36,
//      a mix between two clips going different ways runs a little over, and a pop is hundreds);
//      the ball finite, never under the grass and never faster than the hardest-hit ball; the high
//      camera keeping the ball in its frame; the men on the bases (diamond/bases.js): each over
//      every bag on his way (3 ft, his feet and hands counted for a slide), on his bag by the
//      landing and standing on it at the end (4 ft), a man forced out there after the ball and one
//      safe at a bag a throw goes to there before it, no two of them within 2.5 ft, and the runs
//      that cross the plate the play's;
//      and the game has a ground ball thrown to first on the first-base camera, a ball caught in
//      the air, a ball run down in the outfield, a run scored on a ball in the park and a man
//      rounding first for second.
//   2. THE VIEW, with a recording renderer in place of the GL park and the hand-cranked clock:
//      payloads fed the way tv.js feeds them, each after its held line; the line stays the last
//      one until the play lands and is this one after; the count on the board is the last
//      pitch's (never a fourth ball or a third strike); a strikeout or a walk gets its splash;
//      the battery's poses and the ball reach the renderer; every pitch shown makes its sound
//      and the play its own; once everyone's at rest the frames stop; an at-bat whose bags differ
//      from the ones the picture left opens on the cutaway, and one that agrees doesn't; and with
//      no frames at all (a hidden tab) the line still goes up once the play's time has passed.
//
// A runner's legs in the picture are checked against the sim's (play.js legsOf works speedOf over
// again for the browser).
//
// It proves the staging RUNS and agrees with the sim. It doesn't look at pixels: the sandbox
// page (tools/sandbox/deadball-park-test.html?park=3d) is for looking.
//
// Run:  node scripts/shapes/diamond-smoke.mjs [seed]     (one game a gate; the manifest runs two)

import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const P = '../../client/game/js/panels/';
const { createWorld, DT, toPark } = await import(P + 'diamond/world.js');
const { createDirector, pictureAfter } = await import(P + 'diamond/director.js');
const { castOf } = await import(P + 'diamond/cast.js');
const { pitchPoint } = await import(P + 'diamond/hud.js');
const { solvePose } = await import(P + 'diamond/rig.js');
const { handPoint, limitBreaks, eventTime } = await import(P + 'diamond/anim.js');
const { isShot, shotAt, project } = await import(P + 'diamond/camera.js');
const { BAGS } = await import(P + 'diamond/geo.js');
const { legsOf } = await import(P + 'diamond/play.js');
const { createGrandstandView } = await import(P + 'gameday-grandstand.js');
const { sportsRng } = await import('../../plugins/broadcast/rng.js');
const { simGameV2, speedOf } = await import('../../plugins/broadcast/sports/baseball.js');
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
const flatD = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const bagAt = (b) => (b === 4 ? [0, 0, 0] : BAGS[b]);

// A runner's legs in the picture are the sim's: play.js legsOf works its speedOf over again, which
// the browser can't import.
for (const p of order) for (const m of p.moves || []) if (m && m.name) check('a runner\'s legs in the picture are the sim\'s (play.js legsOf)', legsOf(m.name) === speedOf(m.name), m.name);

// ── 1. the director ──────────────────────────────────────────────────────────
const seen = { skip: 0, ritual: 0, block: 0, check: 0, punchout: 0, hbp: 0, lefty: 0, sideL: 0, toFirst: 0, air: 0, rundown: 0, scored: 0, round: 0 };
const W = createWorld();
for (const hold of [undefined, 45000]) {
  for (const p0 of atBats) {
    const p = hold ? { ...p0, hold } : p0;
    const label = `seed ${SEED}${hold ? ' hold 45s' : ''}: ${p.inning}${p.half[0]} ${p.batter} ${p.kind} [${p.pitches.map((q) => q.result).join(',')}]`;
    const cast = castOf(p);
    const slotOf = (role) => (role === 'ump' ? cast.find((c) => c.id === 'ump:plate') : cast.find((c) => c.look.role === role)).look.slot;
    const [sP, sC, sH, sU] = ['pitcher', 'catcher', 'batter', 'ump'].map(slotOf);
    let landed = 0, landT = null;
    const counts = [], shots = [];
    let shotNow = null, cutAt = -Infinity;
    const D = createDirector(W, { onLand: () => { landed++; landT = W.t; }, emit: (n, d) => { if (n === 'pitch') counts.push({ t: W.t, i: d.i }); else if (n === 'shot') { shots.push(d); shotNow = d; cutAt = W.t; } } });
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
    // ── 1b. the ball in play ──
    const plan = !hold ? D.log[N - 1].play : null;
    const moving = [], cam = { n: 0, out: 0 }, menOn = [];
    let closest = { d: Infinity };
    let tPlay = Infinity;
    if (plan) {
      tPlay = D.log[N - 1].contact.t;
      const flightTo = (t) => plan.balls.find((b) => b.path && Math.abs(b.to - t) < 1e-6);
      const flightFrom = (t) => plan.balls.find((b) => b.path && Math.abs(b.from - t) < 1e-6);
      for (const f of plan.log.fielders) {
        if (f.miss) continue;
        due.push([f.t, () => {
          const b = W.bodies.get(f.slot), seg = flightTo(f.t);
          check('a play: the catch is lined up on the ball', b && b.clip?.id === f.clip && Math.abs(W.clipTime(b, f.t) - eventTime(b.clip, 'catch')) <= 1e-6, `${label}: ${f.clip} by ${f.n}`);
          const Q = W.pose(f.slot, f.t), d = Q && seg ? dist(toPark(Q, handPoint(Q, f.hand, f.kind, Q.scale)), seg.path(f.t)) : Infinity;
          check('a play: the glove meets the ball at the catch (0.1 ft)', d <= 0.1, `${label}: ${f.clip} by ${f.n}, ${d.toFixed(3)} ft`);
          const L = { ...Q, at: [0, 0, 0], yaw: 0 }, br = Q ? limitBreaks(L, solvePose(L)) : ['no pose'];
          check('a play: the fielder inside his joints at the catch', !br.length, `${label}: ${f.clip} by ${f.n}: ${br.join('; ')}`);
        }]);
      }
      for (const th of plan.log.throws) {
        if (!th.release) continue;
        const B = plan.bodies.find((x) => x.n === th.from);
        due.push([th.release.t, () => {
          const b = W.bodies.get(B.slot), seg = flightFrom(th.release.t);
          check('a play: the throw is lined up on its release', b.clip?.id === th.throwClip && Math.abs(W.clipTime(b, th.release.t) - eventTime(b.clip, 'release')) <= 1e-6, `${label}: ${th.throwClip} by ${th.from}`);
          const J = solvePose(W.pose(B.slot, th.release.t)).J, h = th.release.hand, at = J['wr' + h].map((v, i) => v + J['hdir' + h][i] * 0.2);
          const d = seg ? dist(at, seg.path(th.release.t)) : Infinity;
          check('a play: the ball leaves the thrower\'s hand (0.05 ft)', d <= 0.05, `${label}: ${th.throwClip} by ${th.from}, ${d.toFixed(3)} ft`);
        }]);
      }
      // the call at first agrees with the picture
      const atFirst = plan.log.throws.find((x) => x.bag === 1 && x.last && !x.error), lb = plan.log.batter;
      if (atFirst && plan.log.ump) {
        const out = plan.log.ump.out, ok = out ? atFirst.catch.t < lb.tFirst : atFirst.catch.t > lb.tFirst || p.play.th === 'wide';
        check('a play: the call at first agrees with the ball and the batter', ok, `${label}: ${plan.log.ump.clip}, ball ${(atFirst.catch.t - tPlay).toFixed(2)} batter ${(lb.tFirst - tPlay).toFixed(2)}`);
        if (out && plan.cuts.some((c) => c.shot === 'first')) seen.toFirst++;
      }
      if (plan.log.airCatch != null) seen.air++;
      if (plan.log.fielders.some((f) => f.clip === 'field_of_throw' && !f.miss)) seen.rundown++;
      // the bodies that do more than set: their pelvises are watched for jumps
      for (const B of plan.bodies) if (B.role === 'batter' || B.role === 'ump' || B.clips.filter((c) => !c.prior).length > 1) moving.push({ slot: B.slot, last: null, at: -1 });
      // the men on the bases (bases.js), watched round the bags
      for (const r of plan.log.runners || []) menOn.push({ r, who: `the man from ${r.from}`, near: {}, last: null });
      if (plan.log.batter) menOn.push({ r: { ...plan.log.batter, end: plan.log.batter.to >= 1 && plan.log.batter.to <= 3 ? plan.log.batter.to : null }, who: 'the batter', near: {}, last: null });
    }
    due.sort((a, b) => a[0] - b[0]);
    // the clock, and every pose finite now and then on the way
    let k = 0, lastBall = null;
    while (W.t < Math.max(D.until, D.landAt) + 0.1) {
      W.step(DT);
      while (due.length && due[0][0] <= W.t) due.shift()[1]();
      if (++k % 12 === 0) {
        for (const s of [sP, sC, sH, sU]) {
          const Q = W.pose(s);
          if (!Q) continue;
          const J = solvePose(Q).J;
          if (!Object.values(J).every((v) => !Array.isArray(v) || v.every(Number.isFinite))) { check('every pose finite', false, `${label}: slot ${s} at ${(W.t - t0).toFixed(2)} s`); break; }
        }
      }
      if (plan && W.t >= tPlay && k % 4 === 0) {
        // 30 Hz through the play: no jumps outside a cut, the ball above the grass and in the high camera's frame
        for (const m of moving) {
          const Q = W.pose(m.slot);
          if (!Q) continue;
          const pv = toPark(Q, Q.pelvis);
          if (!pv.every(Number.isFinite)) { check('a play: every pose finite', false, `${label}: slot ${m.slot}`); continue; }
          if (m.last && m.at > cutAt) {
            const v = dist(pv, m.last) / (W.t - m.at);
            check('a play: nobody jumps (52 ft/s) outside a cut', v <= 52, `${label}: slot ${m.slot} in ${W.bodies.get(m.slot).clip?.id} at +${(W.t - tPlay).toFixed(2)} s, ${v.toFixed(0)} ft/s`);
          }
          m.last = pv; m.at = W.t;
        }
        // how near each man on the bases comes to each bag: his pelvis, or near one his feet and
        // hands too (a slide gets there with them); and how near any two come to each other
        for (const g of menOn) {
          const Q = W.pose(g.r.slot);
          if (!Q) continue;
          const pv = toPark(Q, Q.pelvis);
          g.last = pv;
          let ends = null;
          for (const b of [1, 2, 3, 4]) {
            let d = flatD(pv, bagAt(b));
            if (d < 6) { ends ??= ['toeL', 'toeR', 'wrL', 'wrR'].map((j) => solvePose(Q).J[j]); for (const q of ends) d = Math.min(d, flatD(q, bagAt(b))); }
            g.near[b] = Math.min(g.near[b] ?? Infinity, d);
          }
        }
        for (let i = 0; i < menOn.length; i++) for (let j = i + 1; j < menOn.length; j++) {
          const a = menOn[i].last, b = menOn[j].last;
          if (a && b && flatD(a, b) < closest.d) closest = { d: flatD(a, b), at: W.t, who: `${menOn[i].who} and ${menOn[j].who}` };
        }
        const ball = W.ballAt();
        if (ball) {
          check('a play: the ball finite and above the grass', ball.every(Number.isFinite) && ball[1] >= -1e-6, `${label}: [${ball.map((v) => v.toFixed(2))}]`);
          // the hardest-hit ball leaves the bat at 118 mph, 173 ft/s
          if (lastBall && W.t - lastBall.t < 0.04) check('a play: the ball never jumps (200 ft/s)', dist(ball, lastBall.at) / (W.t - lastBall.t) <= 200, `${label}: at +${(W.t - tPlay).toFixed(2)} s, ${(dist(ball, lastBall.at) / (W.t - lastBall.t)).toFixed(0)} ft/s`);
          lastBall = { at: ball, t: W.t };
          if (shotNow && typeof shotNow === 'object' && shotNow.shot === 'high') {
            const q = project(shotAt(shotNow, W.t), 400, 300, ball);
            cam.n++;
            if (!q || q.x < -20 || q.x > 420 || q.y < -15 || q.y > 315) cam.out++;
          }
        } else lastBall = null;
      }
    }
    if (plan && cam.n) check('a play: the high camera keeps the ball in its frame (95%)', cam.out <= cam.n * 0.05, `${label}: out of frame ${cam.out} of ${cam.n}`);
    if (plan) {
      // every man round the bags his move takes him, on his bag by the landing and on it at the end
      for (const g of menOn) {
        const r = g.r;
        for (const [b, t] of Object.entries(r.bags || {})) {
          if (t == null) continue;
          check('a play: every man on the bases goes over every bag on his way (3 ft)', (g.near[b] ?? Infinity) <= 3, `${label}: ${g.who}, bag ${b} by ${(g.near[b] ?? Infinity).toFixed(2)} ft`);
        }
        if (r.end) {
          const d = g.last ? flatD(g.last, bagAt(r.end)) : Infinity;
          check('a play: every man ends on the bag the play gives him (4 ft)', d <= 4, `${label}: ${g.who}, ${d.toFixed(1)} ft from ${r.end}`);
          const got = r.bags?.[r.end];
          if (got != null) check('a play: every man is on his bag by the landing', got <= D.landAt + 1e-6, `${label}: ${g.who} at +${(got - tPlay).toFixed(2)} s, lands +${(D.landAt - tPlay).toFixed(2)}`);
        }
        if (r.forced != null && r.bags?.[r.out] != null) check('a play: a man forced out gets there after the ball', r.bags[r.out] >= r.forced, `${label}: ${g.who} at +${(r.bags[r.out] - tPlay).toFixed(2)}, the ball +${(r.forced - tPlay).toFixed(2)}`);
        if (r.bags?.[1] != null && r.bags?.[2] != null) seen.round++;
      }
      // the runs: every man the play sends home over the plate, by the landing but on a home run
      const homeMen = menOn.filter((g) => g.r.to === 4), inBy = homeMen.filter((g) => (g.near[4] ?? Infinity) <= 3 && (p.kind === 'homerun' || g.r.bags[4] <= D.landAt + 1e-6)).length;
      if (Number.isFinite(p.runs)) check('a play: the runs that cross the plate are the play\'s', inBy === p.runs, `${label}: ${inBy} for ${p.runs}`);
      if (p.kind !== 'homerun') seen.scored += inBy;
      // a man safe at a bag a throw goes to gets there first
      for (const th of plan.log.throws) {
        if (!th.bag || th.bag === 1 || th.error || !th.last) continue;
        const g = menOn.find((x) => x.r.to === th.bag);
        if (g && g.r.bags?.[th.bag] != null) check('a play: a man safe at a bag gets there before the throw', g.r.bags[th.bag] < th.catch.t, `${label}: ${g.who} at +${(g.r.bags[th.bag] - tPlay).toFixed(2)}, the ball +${(th.catch.t - tPlay).toFixed(2)}`);
      }
      if (menOn.length > 1) check('a play: no two men on the bases run into each other (2.5 ft)', closest.d >= 2.5, `${label}: ${closest.who} ${closest.d.toFixed(2)} ft apart at +${(closest.at - tPlay).toFixed(2)} s`);
    }
    check('onLand fires once', landed === 1, `${label}: ${landed}`);
    check('it lands when the director said', landT != null && landT - D.landAt <= DT + 1e-9 && landT >= D.landAt - 1e-9, `${label}: ${landT} for ${D.landAt}`);
    check('the play lands inside its budget (0.45 of the hold, 13 to 26 s), or as soon as its last pitch and the play allow', D.landAt - t0 <= Math.max(budget, D.floor) + 1e-9, `${label}: ${(D.landAt - t0).toFixed(2)} of ${budget} s`);
    check('the count goes through every pitch, in order, by the landing', counts.length === N && counts.every((c, j) => c.i === j) && counts[N - 1].t <= D.landAt + DT, `${label}: ${counts.map((c) => c.i)}`);
    for (const s of shots) check('every shot is a camera', isShot(s), `${label}: ${JSON.stringify(s)}`);
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
check('the game has a ground ball thrown out at first on the first-base camera', seen.toFirst > 0);
check('the game has a ball caught in the air', seen.air > 0);
check('the game has a ball run down in the outfield', seen.rundown > 0);
check('the game has a run scored on a ball in the park', seen.scored > 0);
check('the game has a man rounding first for second', seen.round > 0);

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
  let prevLine = '', picture = null, cutaways = 0;
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
      const differs = !!picture && picture.some((b, i) => b !== !!(p.basesBefore || [])[i]);
      check('an at-bat opens on the cutaway when the picture\'s bags differ (unless the play has no time to spare), and only then', D.cutaway === (differs && !D.squeezed) && (!D.cutaway || v.shot === 'sky'), `${label}: picture ${picture} payload ${p.basesBefore}`);
      if (differs) cutaways++;
      // up to just before the landing, the last line is still up
      let held = true;
      while (!D.landed && W2.t - start < budget + 2) {
        stub.runFrames(1, 1000 / 30);
        if (!D.landed && capText() !== prevLine) held = false;
      }
      check('the line is held until the play lands', held, `${label}: "${capText()}" before the landing`);
      check('the play lands in the view inside its budget, or as soon as its last pitch and the play allow', D.landed && W2.t - start <= Math.max(budget, D.floor) + 0.1, `${label}: ${(W2.t - start).toFixed(2)} of ${budget} s`);
      check('the line goes up when the play lands', capText() === line, `${label}: "${capText()}"`);
      const S = v.state, last = p.pitches[p.pitches.length - 1];
      check('the board has the last pitch\'s count, without a fourth ball or a third strike', S.balls === Math.min(3, last.balls) && S.strikes === Math.min(2, last.strikes) && S.pitch === last, `${label}: ${S.balls}-${S.strikes}`);
      if (p.kind === 'strikeout' || p.kind === 'walk') check('a strikeout or a walk gets its splash', S.splash?.kind === p.kind, `${label}: ${S.splash?.kind}`);
      const battery = ['pitcher', 'catcher', 'batter'].map((r) => p0slot(p, r));
      check('the battery\'s poses reach the renderer', battery.every((s) => rec.poses.has(s)), `${label}: ${[...rec.poses.keys()]}`);
      check('the ball reaches the renderer', rec.balls > 0, label);
      const shown = D.log.filter((r) => r.shown).length;
      check('a sound for every pitch shown, and the play\'s own', stub.sounds.length - sounds0 >= shown + 1, `${label}: ${stub.sounds.length - sounds0} for ${shown} pitches`);
      check('the view\'s camera is a shot', isShot(v.shot), `${label}: ${JSON.stringify(v.shot)}`);
      // then everyone comes to rest and the frames stop (a home run's trot is the longest, 23 s)
      for (let i = 0; i < 900 && v.busy(); i++) stub.runFrames(1, 1000 / 30);
      const frames = rec.frames;
      stub.runFrames(20, 1000 / 30);
      check('at rest, the frames stop', !v.busy() && rec.frames === frames, `${label}: ${rec.frames - frames} more frames`);
    } else {
      stub.runTimers(2500);
      check('a play on the bases or a changeover: its line goes up', capText() === line, `${label}: "${capText()}"`);
    }
    prevLine = line;
    picture = pictureAfter(p);
  });
  check('the view is fed an at-bat its picture disagrees with', cutaways > 0);
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
