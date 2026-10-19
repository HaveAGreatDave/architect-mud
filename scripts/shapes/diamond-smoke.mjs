// Diamond smoke: stages real Deadball games pitch by pitch in the 3-D park's world, headlessly,
// and fails if a pitch misses its spot, a mitt or a bat misses the ball, an at-bat ends the wrong
// way, a play lands late, or the booth's line goes up before the play it calls.
//
// The director (client/game/js/panels/diamond/director.js) has no server to test it, and what it
// stages is what a viewer takes for the game. So this runs the actual sim (sim v2, so a game has
// hit batsmen) and builds the actual payloads (sports/baseball-gameday.js), then:
//
//   1. THE DIRECTOR, every at-bat of the game at the shortest hold (a 13-second budget, where a
//      long at-bat leaves pitches out), and every third one at a long one (45 seconds, where the
//      rituals come in):
//      a log entry and a count for every pitch, in order; each pitch through the plate within
//      0.05 ft of its spot (hud.js pitchPoint); every clip lined up on the ball, to the
//      microsecond (the delivery's release as the ball leaves his hand, within 0.05 ft of it; the
//      catch, the swing's contact, a miss within 0.03 s of it, the flinch); the catcher's mitt on
//      the ball at the catch (0.1 ft); on contact the ball on the bat's barrel (0.15 ft off its axis) with both hands
//      on the bat (0.05 ft); the hitter and the catcher inside their joints there; a hit batsman
//      hit; strike three with its walk off and a called one rung up, ball four and the walk to
//      first, the flinch, or the ball put in play; `onLand` once, on time, inside the budget,
//      with the count done by then; every shot a camera; every pose finite; every pitch's marks in
//      the dirt (diamond/marks.js), its stride where the pitcher's front foot lands and the hitter's
//      back foot dug in, each at the foot (0.4 ft) and on the dirt, and a slide's scar running to
//      where he got to (1 ft). At the long hold, the dead time after it too (diamond/between.js):
//      everyone sent somewhere at rest a beat before the next payload's due and where he was sent
//      (4 ft), nobody jumping (52 ft/s) outside a cut or coming within 2 ft of anybody (or nearer
//      than the two started), the walks and rests inside their joints outside a mix, the on-deck
//      hitter in his circle and swinging for his camera, and the cameras opening wide. And the
//      game has to exercise the rare paths, or the gate isn't testing them: a pitch left out, a
//      ritual, a block, a check swing, a punch-out, a hit batsman, a slide or a dive that scars the
//      dirt, and dead time with a pitcher rubbing up the ball, a man going off and the on-deck
//      camera.
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
//      that cross the plate the play's; the same, bar the landing (the trot comes after it), for
//      ball four and a hit batsman, the batter to first and every man forced up a bag (bases.js
//      planTrot); after a third out everyone on the field ends by his own dugout (4 ft, or where
//      he was if that was within 14), with nobody faster than 52 ft/s going off and no two within
//      2 ft;
//      and the game has a ground ball thrown to first on the first-base camera, a ball caught in
//      the air, a ball run down in the outfield, a run scored on a ball in the park, a man
//      rounding first for second, a trot to first and a side going off after its third out.
//   1c. THE CHANGEOVER, every half payload: the side taking the field out of its dugout, each man
//      ending where he plays (4 ft) and nobody faster than 52 ft/s; every warm-up out of the
//      pitcher's hand (0.05 ft), the catcher's receive lined up on it and the mitt on the ball
//      (0.1 ft), each with its stride in the dirt; and the game's changeovers have warm-ups.
//      THE GROUNDS CREW (diamond/crew.js), the middle of the fifth at a long hold: four of them in
//      the cast, and none at a short hold or in another break; both pairs round their arcs, each
//      man where his mat has him while he pulls (0.3 ft), each mat on the dirt while it's on and
//      the ground it goes over all on the canvas; nobody jumping, nobody within 2 ft of one of the
//      crew (or nearer than the two started), their walks and pulls inside their joints; the
//      infielders by their dugout till the mats are off the dirt and at their spots (4 ft) a beat
//      before the next payload's due, the crew at the gate beyond first (1 ft); the leaders' table
//      down once, and the crew camera with the crew in its frame.
//   1d. THE PLAYS ON THE BASES (diamond/runs.js), every run payload, and the first of each kind the
//      game hasn't got from the games after it (and of a third out on the bases), so every kind is
//      staged on every seed: the
//      delivery to the plate and the catcher's pop on the steal card's clocks (0.01 s); the throw
//      out of his hand (0.05 ft) and into the cover man's glove (0.1 ft), each inside his joints
//      there; the pitch in the mitt (0.1 ft); the call agreeing with the slide and the tag, and the
//      runner's hand or foot on the bag at his touch (1 ft); a pitch that got by picked up where it
//      stopped (0.15 ft), after it stopped, with every man on his bag by the landing; nobody
//      faster than 52 ft/s outside a cut; every shot a camera and `onLand` once, on time; at the
//      end (bar a third out, when the side goes off) a man safe standing on his bag (1.5 ft, or 4
//      for one who held his), the man who took the throw back off it (4 ft) and no two men within
//      2 ft; on a third out everyone off to his own dugout, no faster than 52 ft/s and never within
//      2 ft of anybody; and the game has a man out on the bases and one safe.
//   1e. THE SPECTACLE (diamond/spectacle.js), every home run, ball hit hard and walk-off in the
//      game (a home run and a walk-off borrowed from the games after it if it has none): the tail on a ball hit
//      hard or out, ending with its flight; sparks at the bat's contact on one hit hard; the
//      fireworks after a home run or a walk-off, every shell over the outfield beyond the fence,
//      its sparks above the stands, framed by the wide shot it's cut to once the ball's down, never
//      more than three in a second, and the high camera back after the last; the home-run camera
//      riding beside the ball, keeping it in frame (95%) from inside the park; and with reduced
//      motion, no camera riding with it and nothing at all. Every play's own splash has its words,
//      and every play's cheer (spectacle.js cheerOf) is a side, a level and a time; the roar
//      (gl/crowd.js createRoar) rises, holds and falls as a cheer says.
//   1f. REDUCED MOTION, every ball in play staged again with it, without running the world: every
//      camera a still one (the same camera at every t), the ball in the frame of the still that's up
//      as each of its flights ends, and nothing of the spectacle.
//   1g. REPLAYS (diamond/replay.js): every play in the game that earns one (in section 1), and a
//      triple, a walk-off that isn't a home run and a triple play borrowed from the games after it
//      when it has none, staged again in a world of its own: the same play (the ball within a
//      micron, relative to contact), its window round its moment and no longer than REPLAY.span, its
//      world started where the window does, and its camera framing the ball at its moment (the man
//      sliding in, for a triple or the winning run).
//   2. THE VIEW, with a recording renderer in place of the GL park and the hand-cranked clock:
//      payloads fed the way tv.js feeds them, each after its held line, a play on the bases among
//      them; the line stays the last one until the play lands and is this one after; the count on
//      the board is the last pitch's (never a fourth ball or a third strike), and none on a play
//      on the bases; a strikeout or a walk gets its splash and a steal its card; the battery's
//      poses and the ball reach the renderer; every pitch shown makes its sound and the play its
//      own; once everyone's at rest the frames stop; an at-bat whose bags differ
//      from the ones the picture left opens on the cutaway, and one that agrees doesn't (the feed
//      leaves out one at-bat that moves the bags, as the booth does, so there's one that differs);
//      and with no frames at all (a hidden tab) the line still goes up once the play's time has
//      passed. A line come before its play's landed, on a ball in play with a hold, lands it and
//      plans the dead time without a throw, starting after the landing, and everyone gets where he
//      was sent. The live text for a screen reader (Play by Play) has every pitch as it's thrown,
//      in order, in the words gameday.js pitchText makes of it, and the booth's line as it goes
//      up; with Play by Play off, nothing; and the board in words has the leaders' table between
//      innings. A home run with room in its hold plays its replay (diamond/replay.js): its bug up and
//      its camera on while it plays, its world at REPLAY.rate of the live one to the end of its
//      window, not before the fireworks are out, the live camera back after, and the live text
//      saying so, and the batting side's fans up for it; and the same home run with
//      reduced motion holds a still of its moment instead. Every mark the director makes in the
//      dirt reaches the renderer, and a payload from another game starts a fresh infield.
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
const { createDirector, pictureAfter, opensGame, PACE } = await import(P + 'diamond/director.js');
const { PARK_TIERS, rungsFor } = await import(P + 'diamond/quality.js');
const { castOf, crewDue, crewLane, CREW_ARCS, CREW_GATE, CREW_GAP, CREW_HOLD } = await import(P + 'diamond/cast.js');
const { matAt, sweptAlong, crewShots: crewShotsOf } = await import(P + 'diamond/crew.js');
const { pitchPoint } = await import(P + 'diamond/hud.js');
const { solvePose } = await import(P + 'diamond/rig.js');
const { handPoint, limitBreaks, eventTime } = await import(P + 'diamond/anim.js');
const { isShot, shotAt, project } = await import(P + 'diamond/camera.js');
const { pitchText } = await import(P + 'gameday.js');
const { BAGS } = await import(P + 'diamond/geo.js');
const { legsOf, fenceAt, sprayOf } = await import(P + 'diamond/play.js');
const { HARD, KINDS: FX, particleAt, trailAt, endOf: fxEnd, splashOf, cheerOf } = await import(P + 'diamond/spectacle.js');
const { createRoar, ROAR } = await import(P + 'gl/crowd.js');
const { replayOf, stageReplay, REPLAY } = await import(P + 'diamond/replay.js');
const { HUD_THEME } = await import(P + 'diamond/hud.js');
const { dugoutSpot, dugoutOf } = await import(P + 'diamond/bases.js');
const { BETWEEN } = await import(P + 'diamond/between.js');
const { createGrandstandView } = await import(P + 'gameday-grandstand.js');
const { onDirt, markRect, polyRect } = await import(P + 'diamond/dirt.js');
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
const gameOf = (seed) => gamedayPayloads(simGameV2({ away: 'Rats', home: 'Kings' }, null, sportsRng(seed * 2654435761 + 7), { seed }), seed, { abbr, ordinal }).order;
const order = gameOf(SEED);
const atBats = order.filter((p) => !p.phase && (p.pitches || []).length);
const T0 = Date.now();
const flatD = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const bagAt = (b) => (b === 4 ? [0, 0, 0] : BAGS[b]);

// A runner's legs in the picture are the sim's: play.js legsOf works its speedOf over again, which
// the browser can't import.
for (const p of order) for (const m of p.moves || []) if (m && m.name) check('a runner\'s legs in the picture are the sim\'s (play.js legsOf)', legsOf(m.name) === speedOf(m.name), m.name);

// ── 1. the director ──────────────────────────────────────────────────────────
const seen = { skip: 0, ritual: 0, block: 0, check: 0, punchout: 0, hbp: 0, lefty: 0, sideL: 0, toFirst: 0, air: 0, rundown: 0, scored: 0, round: 0, trot: 0, off: 0, warmup: 0, replay: 0, scar: 0, between: 0, rub: 0, goneOff: 0, deckShot: 0, crew: 0 };
// The ball of a foot, where marks.js puts its mark: half way from the ankle to the toe.
const footAt = (J, S) => [(J['an' + S][0] + J['toe' + S][0]) / 2, (J['an' + S][2] + J['toe' + S][2]) / 2];
// The dirt's marks (diamond/marks.js) a staging said: each on the canvas, a foot's on the dirt,
// and at its moment where the foot is or the man sliding got to.
function checkMarks(D, label, due, feet = {}) {
  check('the dirt: every mark inside the canvas, and a foot\'s on the dirt', D.marks.every((m) => markRect(m) && (m.kind === 'scar' || onDirt(m.at[0], m.at[1]))), label);
  for (const m of D.marks) {
    if (m.kind === 'scar') {
      if (!m.end) continue;
      seen.scar++;
      const was = m.pts[m.pts.length - 2];
      due.push([m.t, () => {
        const Q = W.pose(m.slot, m.t), pv = Q ? toPark(Q, Q.pelvis) : null, d = pv ? Math.hypot(pv[0] - was[0], pv[2] - was[1]) : Infinity;
        check('the dirt: a slide\'s scar runs to where he got to (1 ft)', d <= 1, `${label}: slot ${m.slot}, ${d.toFixed(2)} ft`);
      }]);
      continue;
    }
    const f = feet[m.kind];
    if (!f || (f.shown && !f.shown(m))) continue;
    due.push([m.t, () => {
      const Q = W.pose(f.slot, m.t), q = Q ? footAt(solvePose(Q).J, f.foot) : null, d = q ? Math.hypot(q[0] - m.at[0], q[1] - m.at[1]) : Infinity;
      check(`the dirt: the ${m.kind} is where his foot is (0.4 ft)`, d <= 0.4, `${label} #${m.i}: ${d.toFixed(2)} ft`);
    }]);
  }
}
const W = createWorld();
// The short hold plays every at-bat; the long one, there for the rituals between pitches, plays
// every third (every one at the long hold was a third of the gate). Not the long at-bats: the
// director spends a hold on the pitches and their reactions first and the rituals last, so it's the
// short ones that have room for them.
const LONG = atBats.filter((x, i) => i % 3 === 0);
for (const hold of [undefined, 45000]) {
  for (const p0 of hold ? LONG : atBats) {
    const p = hold ? { ...p0, hold } : p0;
    const label = `seed ${SEED}${hold ? ' hold 45s' : ''}: ${p.inning}${p.half[0]} ${p.batter} ${p.kind} [${p.pitches.map((q) => q.result).join(',')}]`;
    const cast = castOf(p);
    const slotOf = (role) => (role === 'ump' ? cast.find((c) => c.id === 'ump:plate') : cast.find((c) => c.look.role === role)).look.slot;
    const [sP, sC, sH, sU] = ['pitcher', 'catcher', 'batter', 'ump'].map(slotOf);
    let landed = 0, landT = null;
    const counts = [], shots = [];
    let shotNow = null, cutAt = -Infinity;
    // at the long hold the dead time after it as well, asked for when it lands as the view asks
    const D = createDirector(W, { onLand: () => { landed++; landT = W.t; if (hold) D.planBetween({ until: t0 + hold / 1000 }); }, emit: (n, d) => { if (n === 'pitch') counts.push({ t: W.t, i: d.i }); else if (n === 'shot') { shots.push(d); shotNow = d; cutAt = W.t; } } });
    const t0 = W.t;
    D.stage(p, cast);
    const N = p.pitches.length, budget = budgetOf(p);
    check('a log entry per pitch', D.log.length === N, `${label}: ${D.log.length}/${N}`);
    // the dirt: every pitch's stride and the hitter dug in, shown or not; a shown one's stride at
    // his front foot as it lands, and the dig at the hitter's back foot as the pitch cuts in
    const dueMarks = [];
    if (!hold) {
      const n = (k) => D.marks.filter((m) => m.kind === k).map((m) => m.i).sort((a, b) => a - b).join();
      const all = p.pitches.map((_, i) => i).join();
      check('the dirt: every pitch leaves its stride and the hitter\'s dig', n('stride') === all && n('dig') === all, `${label}: ${n('stride')} / ${n('dig')}`);
      const shown = (m) => !!D.log[m.i]?.shown;
      checkMarks(D, label, dueMarks, { stride: { slot: sP, foot: p.throws === 'L' ? 'R' : 'L', shown }, dig: { slot: sH, foot: p.bats === 'L' ? 'L' : 'R', shown } });
    }
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
    // ball four or a hit batsman: the trot to first and the men forced up a bag (bases.js planTrot)
    const trot = !hold ? D.log[N - 1].trot : null, moved = plan || trot;
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
    }
    if (trot) { tPlay = D.log[N - 1].decided; seen.trot++; }
    if (moved) {
      // the bodies that do more than set: their pelvises are watched for jumps
      for (const B of moved.bodies) if (B.role === 'batter' || B.role === 'ump' || B.clips.filter((c) => !c.prior).length > 1) moving.push({ slot: B.slot, last: null, at: -1 });
      // the men on the bases (bases.js), watched round the bags
      for (const r of moved.log.runners || []) menOn.push({ r, who: `the man from ${r.from}`, near: {}, last: null });
      const lb = moved.log.batter;
      if (lb) menOn.push({ r: { ...lb, end: lb.to >= 1 && lb.to <= 3 ? lb.to : null }, who: 'the batter', near: {}, last: null });
    }
    // ── the ball inside the wall unless it's a home run (a grounder down the line once rolled on
    // through the corner), and an infield pop-up watched coming down from behind the man under it
    // (it climbed out of the high shot and read as a ball leaving the park) ──
    if (plan && p.play && !hold) {
      const b0 = plan.balls[0], end = Number.isFinite(b0.to) ? b0.to : b0.from + 8;
      let past = false;
      for (let t = b0.from; t <= end && !past; t += 0.02) {
        const q = b0.path?.(t);
        const dir = q ? Math.atan2(-q[0], q[2]) * 180 / Math.PI : 0;
        if (q && Math.abs(dir) <= 45 && Math.hypot(q[0], q[2]) > fenceAt(dir) + 0.5) past = true;
      }
      check('a ball in play stays inside the wall unless it\'s a home run', !past || p.kind === 'homerun', label);
      const hang = b0.path?.land - b0.from;
      if (p.play.t === 'pu' && p.play.f[0] !== 2 && p.play.e !== 'drop' && hang >= 3) {
        check('an infield pop-up is watched coming down', plan.cuts.some((c) => c.shot?.shot === 'fly'), label);
      }
    }
    // ── the replay: a play that earns one staged again in a world of its own is the same play ──
    const spec = plan ? replayOf(p, D.play, D.log) : null;
    if (spec) {
      seen.replay++;
      const R = stageReplay(p, spec, { cast }), tBat = D.log[N - 1].contact.t, ballOf = (pl, t) => { let b = null; for (const x of pl.balls) if (x.from <= t) b = x; return b ? (b.path ? b.path(t) : b.at) : null; };
      check('a replay: its window holds its moment, and no more than REPLAY.span', spec.from <= spec.key && spec.key <= spec.to && spec.to - spec.from <= REPLAY.span + 1e-9, `${label}: ${spec.kind} ${spec.from.toFixed(2)}..${spec.to.toFixed(2)}`);
      check('a replay: its camera is a camera', isShot(spec.shot), `${label}: ${JSON.stringify(spec.shot)}`);
      if (R) {
        const t2 = R.key - spec.key;
        let worst = 0;
        for (let k = -5; k <= 30; k++) { const a = ballOf(plan, tBat + k * 0.1), b = ballOf(R.D.play, t2 + k * 0.1); if (a && b) worst = Math.max(worst, dist(a, b)); }
        check('a replay: staged again it\'s the same play (the ball within a micron of the live one)', worst < 1e-6, `${label}: ${worst.toExponential(2)} ft`);
        check('a replay: its world starts where its window does', Math.abs(R.W.t - R.from) <= DT + 1e-9, `${label}: ${(R.W.t - R.from).toFixed(4)} s`);
        // the moment in its camera's frame: the ball, but for a man sliding in (a triple, the winning run)
        if (['cf', 'bag', 'first'].includes(spec.shot) || typeof spec.shot === 'object') {
          const q = project(shotAt(spec.shot, R.key), 400, 300, ballOf(R.D.play, R.key));
          check('a replay: its camera has the ball at its moment', !!q && q.x > 0 && q.x < 400 && q.y > 0 && q.y < 300, `${label}: ${spec.kind} ${q ? `${q.x.toFixed(0)},${q.y.toFixed(0)}` : 'behind'}`);
        }
        R.D.stop();
      } else check('a replay: it stages', false, label);
    }
    due.push(...dueMarks);
    due.sort((a, b) => a[0] - b[0]);
    // the third out: everyone on the field jogs off, watched for jumps from when they set off
    const off = D.inningOver ? cast.filter((c) => ['pitcher', 'catcher', 'fielder', 'batter', 'runner'].includes(c.look.role)).map((c) => ({ c, last: null, at: -1 })) : [];
    let offClosest = { d: Infinity };
    // the dead time (diamond/between.js), watched at 10 Hz from its first cut: every body's pelvis
    // for jumps and for coming within 2 ft of another (or nearer than the two started it, less half
    // a foot), and at 2 Hz the joints of the dead time's own clips outside a mix
    const BT = new Set(['run_walk', 'stand_idle', 'pitch_rub', 'deck_swing', 'bat_stance']);
    const deadTime = { last: new Map(), start: new Map(), close: { d: Infinity }, jump: null, bent: null, deck: null };
    // the clock, and every pose finite now and then on the way
    let k = 0, lastBall = null;
    while (W.t < Math.max(D.until, D.landAt) + 0.1) {
      W.step(DT);
      while (due.length && due[0][0] <= W.t) due.shift()[1]();
      if (D.between && W.t >= D.between.from && k % 12 === 0) {
        const at = [];
        for (const [slot, b] of W.bodies) {
          const Q = W.pose(slot);
          if (!Q) continue;
          const pv = toPark(Q, Q.pelvis), w = deadTime.last.get(slot);
          if (w && w.at > cutAt && !deadTime.jump && flatD(pv, w.pv) / (W.t - w.at) > 52) deadTime.jump = `slot ${slot} in ${b.clip?.id} at +${(W.t - t0).toFixed(2)} s, ${(flatD(pv, w.pv) / (W.t - w.at)).toFixed(0)} ft/s`;
          deadTime.last.set(slot, { pv, at: W.t });
          if (b.role === 'ondeck') { deadTime.deck = Math.max(deadTime.deck ?? 0, flatD(pv, cast.find((c) => c.look.role === 'ondeck').at)); continue; }
          at.push([slot, pv]);
          if (k % 60 === 0 && !deadTime.bent && BT.has(b.clip?.id) && !(b.prev && W.t < b.prev.from + b.prev.fade)) {
            const L = { ...Q, at: [0, 0, 0], yaw: 0 }, br = limitBreaks(L, solvePose(L)).filter((x) => !/ ft up/.test(x));
            if (br.length) deadTime.bent = `slot ${slot} in ${b.clip.id} at +${(W.t - t0).toFixed(2)} s: ${br[0]}`;
          }
        }
        for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
          const key = at[i][0] + '|' + at[j][0], d = flatD(at[i][1], at[j][1]);
          if (!deadTime.start.has(key)) deadTime.start.set(key, d);
          const room = Math.min(2, deadTime.start.get(key) - 0.5);
          if (d - room < deadTime.close.d) deadTime.close = { d: d - room, what: `slots ${at[i][0]} and ${at[j][0]} ${d.toFixed(2)} ft apart at +${(W.t - t0).toFixed(2)} s` };
        }
      }
      if (++k % 12 === 0) {
        for (const s of [sP, sC, sH, sU]) {
          const Q = W.pose(s);
          if (!Q) continue;
          const J = solvePose(Q).J;
          if (!Object.values(J).every((v) => !Array.isArray(v) || v.every(Number.isFinite))) { check('every pose finite', false, `${label}: slot ${s} at ${(W.t - t0).toFixed(2)} s`); break; }
        }
      }
      if (off.length && W.t >= D.landAt + 0.6 && k % 4 === 0) {
        for (const m of off) {
          const Q = W.pose(m.c.look.slot);
          if (!Q) continue;
          const pv = toPark(Q, Q.pelvis);
          if (m.last && m.at > cutAt) check('the third out: nobody jumps (52 ft/s) going off', dist(pv, m.last) / (W.t - m.at) <= 52, `${label}: ${m.c.id} ${(dist(pv, m.last) / (W.t - m.at)).toFixed(0)} ft/s`);
          if (m.from == null) m.from = pv;
          m.last = pv; m.at = W.t;
        }
        for (let i = 0; i < off.length; i++) for (let j = i + 1; j < off.length; j++) {
          const a = off[i].last, b = off[j].last;
          if (a && b && flatD(a, b) < offClosest.d) offClosest = { d: flatD(a, b), who: `${off[i].c.id} and ${off[j].c.id}`, at: W.t };
        }
      }
      if (moved && W.t >= tPlay && k % 4 === 0) {
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
        const going = D.inningOver && W.t >= D.landAt + 0.6;
        for (const g of menOn) {
          const Q = W.pose(g.r.slot);
          if (!Q || going) continue;
          const pv = toPark(Q, Q.pelvis);
          g.last = pv;
          let ends = null;
          for (const b of [1, 2, 3, 4]) {
            let d = flatD(pv, bagAt(b));
            if (d < 6) { ends ??= ['toeL', 'toeR', 'wrL', 'wrR'].map((j) => solvePose(Q).J[j]); for (const q of ends) d = Math.min(d, flatD(q, bagAt(b))); }
            g.near[b] = Math.min(g.near[b] ?? Infinity, d);
          }
        }
        for (let i = 0; i < menOn.length && !going; i++) for (let j = i + 1; j < menOn.length; j++) {
          const a = menOn[i].last, b = menOn[j].last;
          if (a && b && flatD(a, b) < closest.d) closest = { d: flatD(a, b), at: W.t, who: `${menOn[i].who} and ${menOn[j].who}` };
        }
        const ball = plan ? W.ballAt() : null;
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
    // the dead time: everyone sent somewhere there and at rest before the next payload's due, nobody
    // jumping or walking into anybody, the walks and the rests bodies can make, the on-deck hitter
    // in his circle, and the cameras going round the park
    if (hold && D.between) {
      const B = D.between;
      seen.between++;
      check('between at-bats: everyone sent somewhere is at rest a beat before the next payload\'s due', B.gone.every((g) => g.end <= B.by + 1e-6), `${label}: ${B.gone.filter((g) => g.end > B.by).map((g) => g.role).join(', ')}`);
      for (const g of B.gone) {
        const Q = W.pose(g.slot), pv = Q ? toPark(Q, Q.pelvis) : null, d = pv ? flatD(pv, g.to) : Infinity;
        check('between at-bats: everyone ends where he was sent (4 ft)', d <= 4 || g.stay, `${label}: ${g.role} slot ${g.slot}, ${d.toFixed(1)} ft from [${g.to.map((v) => v.toFixed(0))}]`);
        if (g.role === 'pitcher') seen.rub++;
        if (g.off) seen.goneOff++;
      }
      check('between at-bats: nobody jumps (52 ft/s) outside a cut', !deadTime.jump, `${label}: ${deadTime.jump}`);
      check('between at-bats: nobody comes within 2 ft of anybody (or nearer than the two started)', deadTime.close.d >= 0, `${label}: ${deadTime.close.what}`);
      check('between at-bats: the walks and the rests are bodies that can, outside a mix', !deadTime.bent, `${label}: ${deadTime.bent}`);
      check('between at-bats: the on-deck hitter stays in his circle (3 ft)', deadTime.deck == null || deadTime.deck <= 3, `${label}: ${deadTime.deck?.toFixed(2)} ft`);
      const named = new Set(B.shots.map((x) => x.shot));
      check('between at-bats: the cameras open wide and go round the park when there\'s time', B.shots[0]?.shot === 'high' && (B.by - B.from < 20 || (named.has('rub') || named.has('crowd'))), `${label}: ${B.shots.map((x) => x.shot).join(', ')}`);
      if (named.has('deck1') || named.has('deck3')) {
        seen.deckShot++;
        for (const want of B.shots.filter((x) => x.swing).map((x) => x.swing)) {
          check('between at-bats: the on-deck hitter swings for his camera, each time it comes round', D.played.some((x) => x.role === 'ondeck' && x.clip === 'deck_swing' && Math.abs(x.t - want) < 1e-6), `${label}: wanted at +${(want - t0).toFixed(2)}`);
        }
      }
      // the shots one after another, and wide for the last of them, 3 s or more before the next payload
      check('between at-bats: the cameras in order, ending wide 3 s before the next payload\'s due', B.shots.every((x, i) => i === 0 || x.at > B.shots[i - 1].at)
        && B.shots[B.shots.length - 1].shot === 'high' && B.shots[B.shots.length - 1].at <= B.until - 3 + 1e-9, `${label}: ${B.shots.map((x) => `${x.shot}@${(x.at - t0).toFixed(1)}`).join(', ')}`);
    }
    if (off.length) {
      // every man ends in his side's crowd by its dugout
      const side = dugoutOf(p);
      for (const m of off) {
        const Q = W.pose(m.c.look.slot), at = Q ? toPark(Q, Q.pelvis) : m.c.at, field = ['pitcher', 'catcher', 'fielder'].includes(m.c.look.role);
        const nearOf = (q) => Math.min(...Array.from({ length: 12 }, (_, j) => flatD(q, dugoutSpot(field ? -side : side, j))));
        const near = nearOf(at), had = m.from ? nearOf(m.from) : Infinity;
        check('the third out: everyone ends by his own dugout (4 ft, or where he was if that was within 14)', near <= 4 || (had <= 14 && near <= had + 0.5), `${label}: ${m.c.id} ${near.toFixed(1)} ft off`);
      }
      check('the third out: nobody runs into anybody going off (2 ft)', offClosest.d >= 2, `${label}: ${offClosest.who} ${offClosest.d.toFixed(2)} ft apart`);
      seen.off++;
    }
    if (moved) {
      // every man round the bags his move takes him, on his bag by the landing and on it at the end
      // (a trot after ball four is after the landing)
      for (const g of menOn) {
        const r = g.r;
        for (const [b, t] of Object.entries(r.bags || {})) {
          if (t == null) continue;
          check('a play: every man on the bases goes over every bag on his way (3 ft)', (g.near[b] ?? Infinity) <= 3, `${label}: ${g.who}, bag ${b} by ${(g.near[b] ?? Infinity).toFixed(2)} ft`);
        }
        if (r.end && !D.inningOver) {
          const d = g.last ? flatD(g.last, bagAt(r.end)) : Infinity;
          check('a play: every man ends on the bag the play gives him (4 ft)', d <= 4, `${label}: ${g.who}, ${d.toFixed(1)} ft from ${r.end}`);
          const got = r.bags?.[r.end];
          if (got != null && plan) check('a play: every man is on his bag by the landing', got <= D.landAt + 1e-6, `${label}: ${g.who} at +${(got - tPlay).toFixed(2)} s, lands +${(D.landAt - tPlay).toFixed(2)}`);
        }
        if (r.forced != null && r.bags?.[r.out] != null) check('a play: a man forced out gets there after the ball', r.bags[r.out] >= r.forced, `${label}: ${g.who} at +${(r.bags[r.out] - tPlay).toFixed(2)}, the ball +${(r.forced - tPlay).toFixed(2)}`);
        if (r.bags?.[1] != null && r.bags?.[2] != null) seen.round++;
      }
      // the runs: every man the play sends home over the plate, by the landing but on a home run
      const homeMen = menOn.filter((g) => g.r.to === 4), inBy = homeMen.filter((g) => (g.near[4] ?? Infinity) <= 3 && (p.kind === 'homerun' || trot || g.r.bags[4] <= D.landAt + 1e-6)).length;
      if (Number.isFinite(p.runs)) check('a play: the runs that cross the plate are the play\'s', inBy === p.runs, `${label}: ${inBy} for ${p.runs}`);
      if (p.kind !== 'homerun') seen.scored += inBy;
      // a man safe at a bag a throw goes to gets there first
      for (const th of plan?.log.throws || []) {
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
check('the game has a trot to first after ball four or a hit batsman', seen.trot > 0);
check('the game has a side going off after its third out', seen.off > 0);
check('the game has a play that earns a replay', seen.replay > 0);
check('the game has a slide or a dive that leaves its scar in the dirt', seen.scar > 0);
check('the game has dead time between at-bats, with a pitcher rubbing up the ball, a man going off and the on-deck camera', seen.between > 0 && seen.rub > 0 && seen.goneOff > 0 && seen.deckShot > 0, JSON.stringify({ between: seen.between, rub: seen.rub, off: seen.goneOff, deck: seen.deckShot }));

// ── 1c. the changeover ───────────────────────────────────────────────────────
// Every half payload: the side taking the field out of its dugout to its spots, and the pitcher's
// warm-ups, each ball out of his hand at the release and into the catcher's mitt at the catch.
for (const p of order.filter((x) => x.phase === 'half')) {
  const label = `seed ${SEED}: the changeover before the ${p.inning}${p.half[0]}`;
  const cast = castOf(p);
  let cutAt = -Infinity;
  const D = createDirector(W, { emit: (n) => { if (n === 'shot') cutAt = W.t; } });
  D.changeover(p, cast);
  const men = cast.filter((c) => ['pitcher', 'catcher', 'fielder'].includes(c.look.role)).map((c) => ({ c, last: null, at: -1 }));
  const sP = cast.find((c) => c.look.role === 'pitcher').look.slot, sC = cast.find((c) => c.look.role === 'catcher').look.slot;
  const due = [];
  for (const w of D.log.filter((x) => x.warmup != null)) {
    seen.warmup++;
    due.push([w.release, () => {
      const J = solvePose(W.pose(sP, w.release)).J, h = p.throws === 'L' ? 'L' : 'R', at = J['wr' + h].map((v, i) => v + J['hdir' + h][i] * 0.2);
      check('a warm-up leaves his hand (0.05 ft)', dist(at, w.from) <= 0.05, `${label} #${w.warmup}: ${dist(at, w.from).toFixed(3)} ft`);
    }]);
    due.push([w.catch.t, () => {
      const b = W.bodies.get(sC), Q = W.pose(sC, w.catch.t);
      check('a warm-up: the receive lined up on the ball', b.clip?.id === 'catch_receive' && Math.abs(W.clipTime(b, w.catch.t) - eventTime(b.clip, 'catch')) <= 1e-6, `${label} #${w.warmup}`);
      const d = Q ? dist(toPark(Q, handPoint(Q, 'L', 'mitt', Q.scale)), w.catch.at) : Infinity;
      check('a warm-up: the mitt meets the ball (0.1 ft)', d <= 0.1, `${label} #${w.warmup}: ${d.toFixed(3)} ft`);
    }]);
  }
  const nWarm = D.log.filter((x) => x.warmup != null).length;
  check('the dirt: every warm-up leaves its stride', D.marks.filter((m) => m.kind === 'stride').length === nWarm, `${label}: ${D.marks.length} for ${nWarm}`);
  checkMarks(D, label, due, { stride: { slot: sP, foot: p.throws === 'L' ? 'R' : 'L' } });
  due.sort((a, b) => a[0] - b[0]);
  let k = 0;
  while (W.t < D.until + 0.1) {
    W.step(DT);
    while (due.length && due[0][0] <= W.t) due.shift()[1]();
    if (++k % 4) continue;
    for (const m of men) {
      const Q = W.pose(m.c.look.slot);
      if (!Q) continue;
      const pv = toPark(Q, Q.pelvis);
      if (m.last && m.at > cutAt) check('the changeover: nobody jumps (52 ft/s)', dist(pv, m.last) / (W.t - m.at) <= 52, `${label}: ${m.c.id} ${(dist(pv, m.last) / (W.t - m.at)).toFixed(0)} ft/s`);
      m.last = pv; m.at = W.t;
    }
  }
  for (const m of men) check('the changeover: every man ends where he plays (4 ft)', !!m.last && flatD(m.last, m.c.at) <= 4, `${label}: ${m.c.id} ${m.last ? flatD(m.last, m.c.at).toFixed(1) : '?'} ft off`);
}
check('the game\'s changeovers have warm-ups', seen.warmup > 0);

// ── 1c'. the grounds crew ─────────────────────────────────────────────────────
{
  const p0 = order.find((x) => x.phase === 'half' && x.inning === 5 && x.half === 'bottom');
  const label = `seed ${SEED}: the middle of the fifth`;
  check('the grounds crew: the game has a middle of the fifth', !!p0, label);
  const others = order.filter((x) => x.phase === 'half' && x !== p0).map((x) => ({ ...x, hold: 90000 }));
  check('the grounds crew: none at a short hold or in another break', !!p0 && !crewDue({ ...p0, hold: 45000 }) && !others.some(crewDue) && !castOf({ ...p0, hold: 45000 }).some((c) => c.look.role === 'crew'), label);
  if (p0) {
    // at the shortest hold that has them in the cast, there's room for them to drag
    const Dx = createDirector(W, {});
    Dx.changeover({ ...p0, hold: CREW_HOLD * 1000 }, castOf({ ...p0, hold: CREW_HOLD * 1000 }));
    check('the grounds crew: at the shortest hold that has them, they drag', !!Dx.crew, `${label}: ${CREW_HOLD} s`);
    Dx.stop();
    const HOLD = 90000, p = { ...p0, hold: HOLD }, cast = castOf(p), crew = cast.filter((c) => c.look.role === 'crew');
    check('the grounds crew: four of them in the cast', crew.length === 4, `${label}: ${crew.length}`);
    let cutAt = -Infinity, shot = null;
    const tables = [], crewShots = [];
    const D = createDirector(W, { emit: (n, d) => { if (n === 'shot') { cutAt = W.t; shot = d; if (d && d.shot === 'crew') crewShots.push({ t: W.t, d }); } if (n === 'table') tables.push({ t: W.t, d }); } });
    const t0 = W.t;
    D.changeover(p, cast);
    const C = D.crew;
    check('the grounds crew: they drag, two mats', !!C && D.drags.length === 2, label);
    if (C) {
      const crewSlots = new Set(crew.map((c) => c.look.slot)), BT = new Set(['run_walk', 'crew_drag', 'stand_idle']);
      const inf = cast.filter((c) => c.pose === 'infield').map((c) => ({ c, from: W.bodies.get(c.look.slot)?.at.slice() }));
      const stills = cast.filter((c) => !W.bodies.has(c.look.slot));
      const last = new Map(), start = new Map();
      let close = { d: Infinity }, jump = null, bent = null, away = 0, awayWhat = '', offDirt = null, early = null, k = 0;
      while (W.t < D.until + 0.1) {
        W.step(DT);
        if (++k % 12) continue;
        const at = [];
        for (const [slot, b] of W.bodies) {
          const Q = W.pose(slot);
          if (!Q) continue;
          const pv = toPark(Q, Q.pelvis), w = last.get(slot);
          if (w && w.at > cutAt && !jump && flatD(pv, w.pv) / (W.t - w.at) > 52) jump = `slot ${slot} in ${b.clip?.id} at +${(W.t - t0).toFixed(2)} s`;
          last.set(slot, { pv, at: W.t });
          at.push([slot, pv]);
          if (crewSlots.has(slot) && k % 60 === 0 && !bent && BT.has(b.clip?.id) && !(b.prev && W.t < b.prev.from + b.prev.fade)) {
            const L = { ...Q, at: [0, 0, 0], yaw: 0 }, br = limitBreaks(L, solvePose(L)).filter((x) => !/ ft up/.test(x));
            if (br.length) bent = `slot ${slot} in ${b.clip.id} at +${(W.t - t0).toFixed(2)} s: ${br[0]}`;
          }
        }
        for (const c of stills) at.push([c.look.slot + 100, c.at]);
        for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
          if (!crewSlots.has(at[i][0]) && !crewSlots.has(at[j][0])) continue;
          const key = at[i][0] + '|' + at[j][0], d = flatD(at[i][1], at[j][1]);
          if (!start.has(key)) start.set(key, d);
          const room = Math.min(2, start.get(key) - 0.5);
          if (d - room < close.d) close = { d: d - room, what: `slots ${at[i][0]} and ${at[j][0]} ${d.toFixed(2)} ft apart at +${(W.t - t0).toFixed(2)} s` };
        }
        for (const d of D.drags) {
          const m = matAt(d, W.t), u = [Math.sin(m.yaw * Math.PI / 180), Math.cos(m.yaw * Math.PI / 180)], n = [-u[1], u[0]];
          if (m.on && !offDirt) {
            for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              const x = m.at[0] + (u[0] * a * m.l) / 2 + (n[0] * b * m.w) / 2, z = m.at[2] + (u[1] * a * m.l) / 2 + (n[1] * b * m.w) / 2;
              if (!onDirt(x, z)) offDirt = `${x.toFixed(1)}, ${z.toFixed(1)} at +${(W.t - t0).toFixed(1)} s`;
            }
          }
          // while he pulls, each man where his mat has him
          if (W.t > d.T[d.i0] + 1 && W.t < d.T[d.i1]) {
            for (const man of m.men) {
              const Q = W.pose(man.slot), r = m.ropes[man.side > 0 ? 0 : 1], e = Q ? Math.hypot(Q.at[0] - r[0], Q.at[2] - r[2]) : Infinity;
              if (e > away) { away = e; awayWhat = `slot ${man.slot} at +${(W.t - t0).toFixed(1)} s`; }
            }
          }
        }
        // the infielders stay by their dugout till the mats are off the dirt
        if (W.t < C.off && !early) for (const f of inf) { const Q = W.pose(f.c.look.slot); if (Q && f.from && flatD(Q.at, f.from) > 1) early = `${f.c.id} at +${(W.t - t0).toFixed(1)} s`; }
      }
      check('the grounds crew: nobody jumps (52 ft/s) outside a cut', !jump, `${label}: ${jump}`);
      check('the grounds crew: nobody comes within 2 ft of one of them (or nearer than the two started)', close.d >= 0, `${label}: ${close.what}`);
      check('the grounds crew: their walks and pulls are bodies that can, outside a mix', !bent, `${label}: ${bent}`);
      check('the grounds crew: each man where his mat has him while he pulls (0.3 ft)', away <= 0.3, `${label}: ${away.toFixed(2)} ft, ${awayWhat}`);
      check('the grounds crew: each mat on the dirt while it\'s on', !offDirt, `${label}: ${offDirt}`);
      const polys = D.drags.flatMap((d) => sweptAlong(d, d.T[0], d.end));
      check('the grounds crew: the ground the mats go over is on the canvas, and only on the arcs', polys.length > 50 && polys.every((q) => q.length === 4 && q.every((v) => v.every(Number.isFinite)) && polyRect(q)), `${label}: ${polys.length}`);
      check('the grounds crew: the infielders wait by their dugout till the mats are off the dirt', !early, `${label}: ${early}`);
      for (const f of inf) {
        const Q = W.pose(f.c.look.slot), there = C.at.get(f.c.look.slot);
        check('the grounds crew: the infielders at their spots (4 ft) a beat before the next payload\'s due', !!Q && flatD(Q.at, f.c.at) <= 4 && there <= t0 + HOLD / 1000 - 1.5, `${label}: ${f.c.id} ${Q ? flatD(Q.at, f.c.at).toFixed(1) : '?'} ft off, there at +${(there - t0).toFixed(1)} s`);
      }
      for (const c of crew) {
        const Q = W.pose(c.look.slot), arc = CREW_ARCS[c.look.slot >> 1], want = [-CREW_GATE, 0, crewLane(arc) + (c.look.slot % 2 ? CREW_GAP : -CREW_GAP)];
        check('the grounds crew: each at the gate beyond first after (1 ft)', !!Q && flatD(Q.at, want) <= 1, `${label}: ${c.id} ${Q ? flatD(Q.at, want).toFixed(2) : '?'} ft off`);
      }
      check('the grounds crew: the leaders\' table comes down once, as they pull', tables.length === 1 && tables[0].d === false && tables[0].t > D.drags[0].T[D.drags[0].i0], `${label}: ${JSON.stringify(tables)}`);
      // the crew camera has them: their middle in the middle of its frame, each second it's up
      let framed = crewShots.length >= 2, what = '';
      for (const x of crewShots) {
        const to = Math.min(...C.shots.filter((y) => y.at > x.t + 1e-6).map((y) => y.at), D.until);
        for (let t = x.t; t < to; t += 1) {
          const q = project(shotAt(x.d, t), 400, 300, x.d.track(t));
          if (!q || q.x < 100 || q.x > 300 || q.y < 75 || q.y > 225) { framed = false; what = `+${(t - t0).toFixed(1)} s ${q ? `${q.x.toFixed(0)},${q.y.toFixed(0)}` : 'behind'}`; break; }
        }
      }
      check('the grounds crew: the crew camera has them in its frame', framed, `${label}: ${crewShots.length} shots ${what}`);
      // for a viewer who's asked for less motion it holds still
      const still = crewShotsOf({ drags: D.drags }, { motion: false }).shots.filter((x) => typeof x.shot === 'object');
      check('the grounds crew: with less motion the crew camera holds still', still.length >= 2 && still.every((x) => JSON.stringify(shotAt(x.shot, x.at)) === JSON.stringify(shotAt(x.shot, x.at + 4))), `${label}: ${still.length}`);
      seen.crew++;
    }
  }
}
check('the game has the grounds crew in the middle of the fifth', seen.crew > 0);

// ── 1d. the plays on the bases ───────────────────────────────────────────────
// Every run payload, and the first of each kind this game hasn't got from the games after it, and
// of a third out on the bases, so every kind is staged on every seed (a game is about 5 ms of sim).
const RUN_KINDS = ['steal', 'caughtstealing', 'doublesteal', 'throwover', 'pickoff', 'wildpitch', 'passedball'];
const thirdOut = (p) => (p.outs | 0) >= 3 && !p.walkoff;
const runs = order.filter((p) => p.phase === 'run').map((p) => ({ p, seed: SEED }));
{
  const have = new Set(runs.map((r) => r.p.kind));
  let third = runs.some((r) => thirdOut(r.p));
  for (let s = SEED + 1; s <= SEED + 30 && (have.size < RUN_KINDS.length || !third); s++) {
    for (const p of gameOf(s)) {
      if (p.phase !== 'run' || (have.has(p.kind) && (third || !thirdOut(p)))) continue;
      have.add(p.kind); third ||= thirdOut(p);
      runs.push({ p, seed: s });
    }
  }
  check('every kind of play on the bases is staged (the game\'s, or the next games\' first)', RUN_KINDS.every((k) => have.has(k)), RUN_KINDS.filter((k) => !have.has(k)).join(', '));
  check('a third out on the bases is staged (the game\'s, or the next games\' first)', third);
  const own = runs.filter((r) => r.seed === SEED).map((r) => r.p);
  check('the game has a man out on the bases, and one safe', own.some((p) => p.out) && own.some((p) => !p.out), own.map((p) => p.kind).join(', '));
}
for (const { p, seed } of runs) {
  const label = `seed ${seed}: ${p.inning}${p.half[0]} ${p.kind} to ${p.base} [${(p.basesBefore || []).map((b) => (b ? 1 : 0)).join('')}]${p.out ? ' out' : ''}`;
  const cast = castOf(p);
  let landed = 0, landT = null, cutAt = -Infinity;
  const shots = [];
  const D = createDirector(W, { onLand: () => { landed++; landT = W.t; }, emit: (n, d) => { if (n === 'shot') { shots.push(d); cutAt = W.t; } } });
  try { D.stage(p, cast); } catch (e) { check('a play on the bases stages', false, `${label}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); continue; }
  const rec = D.log[0], plan = rec?.play, L = plan?.log;
  check('a play on the bases is planned', !!L, label);
  if (!L) continue;
  // the steal card's clocks, as staged: the delivery's first move to the mitt, the mitt to the glove
  if (L.clocks) {
    check('a steal: the delivery reaches the mitt on the card\'s time to the plate (0.01 s)', Math.abs(L.clocks.plate - p.plate) <= 0.01, `${label}: ${L.clocks.plate.toFixed(3)} for ${p.plate}`);
    check('a steal: the catcher\'s throw reaches the glove on the card\'s pop time (0.01 s)', Math.abs(L.clocks.pop - p.pop) <= 0.01, `${label}: ${L.clocks.pop.toFixed(3)} for ${p.pop}`);
  }
  const due = [];
  const body = (role) => plan.bodies.find((b) => b.role === role);
  if (L.throw) {
    const thrower = plan.bodies.find((b) => b.clips.some((c) => c.clip === L.throw.clip)), h = L.throw.release.hand;
    due.push([L.throw.release.t, () => {
      const Q = W.pose(thrower.slot, L.throw.release.t), S = solvePose(Q), at = S.J['wr' + h].map((v, i) => v + S.J['hdir' + h][i] * 0.2);
      check('a play on the bases: the throw leaves his hand (0.05 ft)', dist(at, L.throw.release.at) <= 0.05, `${label}: ${dist(at, L.throw.release.at).toFixed(3)} ft`);
      const br = limitBreaks(Q, S);
      check('a play on the bases: the thrower inside his joints at the release', !br.length, `${label}: ${br[0]}`);
    }]);
    due.push([L.throw.catch.t, () => {
      const Q = W.pose(L.tag.slot, L.throw.catch.t), g = toPark(Q, handPoint(Q, 'L', 'glove', Q.scale));
      check('a play on the bases: the cover man\'s glove meets the throw (0.1 ft)', dist(g, L.throw.catch.at) <= 0.1, `${label}: ${dist(g, L.throw.catch.at).toFixed(3)} ft`);
      const br = limitBreaks(Q, solvePose(Q));
      check('a play on the bases: the cover man inside his joints at the catch', !br.length, `${label}: ${br[0]}`);
    }]);
  }
  if (rec.catch && !L.ball) due.push([rec.catch.t, () => {
    const Q = W.pose(body('catcher').slot, rec.catch.t), m = toPark(Q, handPoint(Q, 'L', 'mitt', Q.scale));
    check('a play on the bases: the mitt meets the pitch (0.1 ft)', dist(m, rec.catch.at) <= 0.1, `${label}: ${dist(m, rec.catch.at).toFixed(3)} ft`);
  }]);
  // a pitch that got by: picked up where it stopped, once it had, and every man on his bag by the
  // landing
  if (L.ball) {
    check('a pitch that got by: picked up after it stops', L.ball.pick >= L.ball.rest, `${label}: ${(L.ball.pick - L.ball.rest).toFixed(2)} s`);
    due.push([L.ball.pick, () => {
      const Q = W.pose(body('catcher').slot, L.ball.pick), hd = toPark(Q, handPoint(Q, 'R', 'bare', Q.scale));
      check('a pitch that got by: his hand on the ball where it lies (0.15 ft)', dist(hd, L.ball.at) <= 0.15, `${label}: ${dist(hd, L.ball.at).toFixed(3)} ft`);
    }]);
    for (const r of L.runners) for (const [b, t] of Object.entries(r.bags || {})) check('a pitch that got by: every man on his bag by the landing', t <= D.landAt + 1e-6, `${label}: from ${r.from} on ${b} ${(t - D.landAt).toFixed(2)} s late`);
  }
  // the call agrees with the slide and the tag, and his hand or foot is on the bag at his touch
  const tagBag = p.kind === 'doublesteal' ? 3 : p.base;
  for (const r of L.runners.filter((x) => x.touch != null && L.tag && (x.out != null || x.to === tagBag))) {
    if (r.out != null) check('a play on the bases: a man called out touches the bag after the tag', r.touch > L.tag.t, `${label}: ${(r.touch - L.tag.t).toFixed(2)} s after it`);
    else check('a play on the bases: a man called safe touches the bag before the tag', r.touch < L.tag.t, `${label}: ${(r.touch - L.tag.t).toFixed(2)} s after it`);
    const bag = bagAt(r.out ?? r.to);
    due.push([r.touch, () => {
      const J = solvePose(W.pose(r.slot, r.touch)).J;
      const pts = r.slide === 'slide_feet' ? [J.toeL] : r.slide === 'slide_head' ? [J.wrL, J.wrR] : [J.wrR];
      const d = Math.min(...pts.map((q) => flatD(q, bag)));
      check('a play on the bases: his hand or foot on the bag at his touch (1 ft)', d <= 1, `${label}: ${r.slide} ${d.toFixed(2)} ft`);
    }]);
  }
  // the dirt: the pitch's stride (a throw over has none) and the slides' scars
  const over = p.kind === 'throwover' || p.kind === 'pickoff';
  check('the dirt: a pitch on the bases leaves its stride, a throw over none', D.marks.filter((m) => m.kind === 'stride').length === (over ? 0 : 1), `${label}: ${D.marks.length} marks`);
  const sP = cast.find((c) => c.look.role === 'pitcher').look.slot;
  checkMarks(D, label, due, { stride: { slot: sP, foot: p.throws === 'L' ? 'R' : 'L' } });
  due.sort((a, b) => a[0] - b[0]);
  const men = [...new Set(plan.bodies.map((b) => b.slot))].map((slot) => ({ slot, last: null, at: -1 }));
  // a third out: everyone on the field jogs off, watched from when they set off
  const off = D.inningOver ? cast.filter((c) => ['pitcher', 'catcher', 'fielder', 'batter', 'runner'].includes(c.look.role)).map((c) => ({ c, last: null, at: -1, from: null })) : [];
  let offClosest = { d: Infinity };
  let k = 0;
  while (W.t < D.until + 0.1) {
    W.step(DT);
    while (due.length && due[0][0] <= W.t) due.shift()[1]();
    if (++k % 4) continue;
    for (const m of men) {
      const Q = W.pose(m.slot);
      if (!Q) continue;
      const pv = toPark(Q, Q.pelvis);
      if (!pv.every(Number.isFinite)) { check('a play on the bases: every pose finite', false, `${label}: slot ${m.slot}`); m.last = null; continue; }
      if (m.last && m.at > cutAt) check('a play on the bases: nobody jumps (52 ft/s)', dist(pv, m.last) / (W.t - m.at) <= 52, `${label}: slot ${m.slot} ${(dist(pv, m.last) / (W.t - m.at)).toFixed(0)} ft/s`);
      m.last = pv; m.at = W.t;
    }
    if (!off.length || W.t < D.landAt + 0.6) continue;
    for (const m of off) {
      const Q = W.pose(m.c.look.slot);
      if (!Q) continue;
      const pv = toPark(Q, Q.pelvis);
      if (m.last && m.at > cutAt) check('a third out on the bases: nobody jumps (52 ft/s) going off', dist(pv, m.last) / (W.t - m.at) <= 52, `${label}: ${m.c.id} ${(dist(pv, m.last) / (W.t - m.at)).toFixed(0)} ft/s`);
      m.from ??= pv;
      m.last = pv; m.at = W.t;
    }
    for (let i = 0; i < off.length; i++) for (let j = i + 1; j < off.length; j++) {
      const a = off[i].last, b = off[j].last;
      if (a && b && flatD(a, b) < offClosest.d) offClosest = { d: flatD(a, b), who: `${off[i].c.id} and ${off[j].c.id}` };
    }
  }
  if (off.length) {
    // every man ends in his side's crowd by its dugout
    const side = dugoutOf(p);
    for (const m of off) {
      const Q = W.pose(m.c.look.slot), at = Q ? toPark(Q, Q.pelvis) : m.c.at, field = ['pitcher', 'catcher', 'fielder'].includes(m.c.look.role);
      const nearOf = (q) => Math.min(...Array.from({ length: 12 }, (_, j) => flatD(q, dugoutSpot(field ? -side : side, j))));
      const near = nearOf(at), had = m.from ? nearOf(m.from) : Infinity;
      check('a third out on the bases: everyone ends by his own dugout (4 ft, or where he was if that was within 14)', near <= 4 || (had <= 14 && near <= had + 0.5), `${label}: ${m.c.id} ${near.toFixed(1)} ft off`);
    }
    check('a third out on the bases: nobody runs into anybody going off (2 ft)', offClosest.d >= 2, `${label}: ${offClosest.who} ${offClosest.d.toFixed(2)} ft apart`);
  }
  // the end, unless the side's going off: the men safe on their bags, the man who took the throw off
  // his, and nobody on top of anybody
  if ((p.outs | 0) < 3) {
    const at = (slot) => { const Q = W.pose(slot); return Q ? toPark(Q, Q.pelvis) : null; };
    for (const r of L.runners) {
      if (r.to == null || r.to === 4) continue;
      const q = at(r.slot), held = !Object.keys(r.bags || {}).length, d = q ? flatD(q, bagAt(r.to)) : Infinity;
      check('a play on the bases: a man safe ends on his bag (1.5 ft, or 4 holding it)', d <= (held ? 4 : 1.5), `${label}: from ${r.from} ${d.toFixed(2)} ft off ${r.to}`);
    }
    if (L.tag) {
      const q = at(L.tag.slot), d = q ? flatD(q, bagAt(tagBag)) : 0;
      check('a play on the bases: the man who took the throw ends off the bag (4 ft)', d >= 4, `${label}: ${d.toFixed(2)} ft`);
    }
    const ps = [...new Set(plan.bodies.map((b) => b.slot))].map((s) => [s, at(s)]).filter(([, q]) => q);
    let close = { d: Infinity };
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { const d = flatD(ps[i][1], ps[j][1]); if (d < close.d) close = { d, who: `slots ${ps[i][0]} and ${ps[j][0]}` }; }
    check('a play on the bases: no two men end within 2 ft', close.d >= 2, `${label}: ${close.who} ${close.d.toFixed(2)} ft apart`);
  }
  for (const s of shots) check('every shot is a camera', isShot(s), `${label}: ${JSON.stringify(s)}`);
  check('onLand fires once', landed === 1, `${label}: ${landed}`);
  check('it lands when the director said', landT != null && landT - D.landAt <= DT + 1e-9 && landT >= D.landAt - 1e-9, `${label}: ${landT} for ${D.landAt}`);
}

// ── 1e. the spectacle ────────────────────────────────────────────────────────
// Every home run, ball hit hard and walk-off, staged at the short hold, as the view stages them
// and again with reduced motion.
{
  const fxOf = (p) => p.kind === 'homerun' || Number(p.play?.ev) >= HARD || p.walkoff;
  const fxPlays = atBats.filter(fxOf).map((p) => ({ p, seed: SEED }));
  // a game with no home run or no walk-off borrows the next games' first
  for (const [has, want] of [[(x) => x.kind === 'homerun', 'a home run'], [(x) => x.walkoff, 'a walk-off']]) {
    if (fxPlays.some((x) => has(x.p))) continue;
    for (let s = SEED + 1; s <= SEED + 60; s++) { const w = gameOf(s).find((x) => !x.phase && has(x) && (x.pitches || []).length); if (w) { fxPlays.push({ p: w, seed: s }); break; } }
    check(`the spectacle stages ${want} (the game's, or the next games' first)`, fxPlays.some((x) => has(x.p)));
  }
  const fxSeen = { homer: 0, sparks: 0, walkoff: 0 };
  for (const { p, seed } of fxPlays) {
    const label = `seed ${seed}: ${p.inning}${p.half[0]} ${p.batter} ${p.kind}${p.walkoff ? ' walk-off' : ''} (${Number(p.play?.ev) || '-'} mph)`;
    const shots = [];
    const D = createDirector(W, { emit: (n, d) => { if (n === 'shot') shots.push({ t: W.t, shot: d }); } });
    D.stage(p, castOf(p));
    const rec = D.log[D.log.length - 1], plan = rec?.play, hr = p.kind === 'homerun', ev = Number(p.play?.ev) || 0;
    const fx = D.fx || [], of = (k) => fx.filter((e) => e.kind === k);
    const trail = of('trail')[0], sparks = of('sparks')[0], bursts = of('burst');
    const path = plan?.balls?.[0]?.path;
    if (plan) {
      check('the spectacle: a tail on a ball hit hard or out, and on no other', !!trail === (hr || ev >= HARD), label);
      check('the spectacle: sparks off the bat on a ball hit hard, and on no other', !!sparks === (ev >= HARD), label);
      if (trail) {
        const end = Math.min(path.land ?? Infinity, plan.balls[1]?.from ?? Infinity);
        check('the spectacle: the tail starts at the crack and ends with its flight', Math.abs(trail.from - rec.contact.t) < 1e-9 && trail.to <= end + 1e-9, `${label}: ${trail.from.toFixed(2)}..${trail.to.toFixed(2)}, flight to ${end.toFixed(2)}`);
        const T = trailAt(trail, (trail.from + trail.to) / 2), q = path((trail.from + trail.to) / 2);
        check('the spectacle: the tail\'s head is the ball', !!T && dist(T.pts[0], q) < 1e-6, label);
      }
      if (sparks) {
        check('the spectacle: the sparks fly from where the bat met it', dist(sparks.at, rec.contact.at) < 1e-6 && Math.abs(sparks.t - rec.contact.t) < 1e-9, label);
        fxSeen.sparks++;
      }
    }
    check('the spectacle: fireworks after a home run or a walk-off, and after no other', !!bursts.length === (hr || !!p.walkoff), `${label}: ${bursts.length}`);
    check('the spectacle: six shells, nine on a grand slam, twelve on a walk-off', !bursts.length || bursts.length === (p.walkoff ? 12 : (p.rbi | 0) >= 4 ? 9 : 6), `${label}: ${bursts.length}`);
    for (const b of bursts) {
      const r = Math.hypot(b.at[0], b.at[2]), wall = fenceAt(sprayOf(b.at));
      check('the spectacle: every shell bursts over the outfield, beyond the fence', r >= wall + 30 && r <= wall + 130 && b.at[1] >= 70 && b.at[1] <= 130, `${label}: ${r.toFixed(0)} ft out (fence ${wall.toFixed(0)}), ${b.at[1].toFixed(0)} up`);
      if (hr && path) check('the spectacle: a home run\'s shells go up once it\'s down', b.t - FX.burst.rise >= path.land + 0.1 - 1e-9, `${label}: up at ${(b.t - FX.burst.rise - path.land).toFixed(2)} s after`);
      let low = Infinity, far = 0;
      for (let k = 0; k < FX.burst.n; k++) for (const tau of [0.1, 0.5, 1, 1.5, 2]) {
        const q = particleAt(b, k, b.t + tau);
        if (!q) continue;
        low = Math.min(low, q.at[1]); far = Math.max(far, dist(q.at, b.at));
      }
      check('the spectacle: a shell\'s sparks stay above the stands and round their burst', low >= 20 && far <= 95, `${label}: as low as ${low.toFixed(0)} ft, ${far.toFixed(0)} ft out`);
      const q = project('sky', 400, 300, b.at);
      check('the spectacle: the wide shot frames every shell', !!q && q.x > 10 && q.x < 390 && q.y > 10 && q.y < 290, `${label}: ${q ? `${q.x.toFixed(0)},${q.y.toFixed(0)}` : 'behind'}`);
    }
    // no flashing more than three times a second: any four shells span more than a second
    const when = bursts.map((b) => b.t).sort((a, b) => a - b);
    for (let i = 0; i + 3 < when.length; i++) check('the spectacle: never more than three shells burst in a second', when[i + 3] - when[i] > 1, `${label}: four in ${(when[i + 3] - when[i]).toFixed(2)} s`);
    // the home-run camera, from the plan's own cuts: the ball in its frame and its eye inside the
    // park, sampled as the world runs, until the next cut. The world runs only until the last
    // effect's out and the high camera's back: a home run's trot after that is section 1's.
    const homerCut = (plan?.cuts || []).find((c) => typeof c.shot === 'object' && c.shot?.shot === 'homer');
    const samples = [], stopAt = Math.min(D.until, Math.max(D.landAt, ...fx.map(fxEnd)) + 0.2);
    while (W.t < stopAt) {
      W.step(DT);
      if (!homerCut || W.t < homerCut.at) continue;
      const sh = shotAt(homerCut.shot, W.t), ball = W.ballAt();
      if (!ball) continue;
      const q = project(sh, 400, 300, ball);
      samples.push({ t: W.t, in: !!q && q.x > -10 && q.x < 410 && q.y > -10 && q.y < 310, eye: sh.eye });
    }
    const shotName = (x) => (typeof x.shot === 'string' ? x.shot : x.shot?.shot);
    const cutList = shots.map((x) => `${shotName(x)}@${(x.t - D.t0).toFixed(1)}`).join(' ');
    const homer = shots.find((x) => shotName(x) === 'homer');
    if (hr && plan) check('the spectacle: a home run cuts to the camera beside it', !!homer, `${label}: ${cutList}`);
    if (homer) {
      const to = shots.find((x) => x.t > homer.t + 1e-9)?.t ?? Infinity, span = samples.filter((x) => x.t < to);
      const bad = span.find((x) => x.eye[1] < 4 || Math.hypot(x.eye[0], x.eye[2]) > fenceAt(sprayOf(x.eye)) - 10);
      check('the spectacle: the home-run camera keeps the ball in frame (95%)', span.length > 0 && span.filter((x) => x.in).length >= 0.95 * span.length, `${label}: ${span.filter((x) => x.in).length}/${span.length}`);
      check('the spectacle: the home-run camera stays above the field and inside the fence', !bad, `${label}: eye at ${bad ? bad.eye.map((v) => v.toFixed(0)).join(',') : ''}`);
      fxSeen.homer++;
    }
    // the wide shot for the shells, and the high camera back after the last
    if (bursts.length) {
      const first = Math.min(...bursts.map((b) => b.t)), last = Math.max(...bursts.map((b) => b.t));
      const sky = shots.find((x) => x.shot === 'sky' && x.t >= first - FX.burst.rise - 1e-6), back = shots.find((x) => x.shot === 'high' && x.t > last);
      check('the spectacle: the wide shot as the shells go up, and the high camera back after the last', !!sky && sky.t <= first + 1e-6 && !!back, `${label}: ${cutList}`);
      if (hr && path && sky) check('the spectacle: the wide shot comes once the ball\'s down', sky.t >= path.land, `${label}: ${(sky.t - path.land).toFixed(2)} s after`);
      check('the spectacle: the play runs till the last spark\'s out', D.until >= fxEnd(bursts[bursts.length - 1]) - 1e-6, label);
      fxSeen.walkoff += p.walkoff ? 1 : 0;
    }
    // with less motion: no camera riding with it, and none of it at all. The plan's cuts and the
    // effects say so without running the world.
    if (hr || ev >= HARD || p.walkoff) {
      const D2 = createDirector(W, {});
      D2.stage(p, castOf(p), { motion: false });
      const riding = (D2.play?.cuts || []).some((c) => typeof c.shot === 'object' && c.shot?.shot === 'homer');
      check('the spectacle: reduced motion has no camera riding with it, and nothing of the spectacle', !riding && !(D2.fx || []).length, label);
      D2.stop();
    }
  }
  check('a home run gets its camera and its fireworks (the game\'s, or the next games\' first)', fxSeen.homer > 0, JSON.stringify(fxSeen));
  check('the game has a ball hit hard enough to spark', fxSeen.sparks > 0, JSON.stringify(fxSeen));
  check('a walk-off gets its fireworks (the game\'s, or the next games\' first)', fxSeen.walkoff > 0, JSON.stringify(fxSeen));
  // every play's own splash has its words
  for (const p of order) {
    const sp = splashOf(p);
    if (sp) check('every play\'s own splash has its words', !!HUD_THEME.words[sp.kind], `${p.kind}: ${sp.kind}`);
  }
  // the fans (gl/crowd.js): every play's cheer is a side, a level and a time, a home run's off the
  // bat; and the roar rises, holds and falls as a cheer says, the loudest of a side's at a time
  for (const p of order) {
    const ch = cheerOf(p);
    if (ch) check('the fans: a play\'s cheer is a side, a level and a time', (ch.side === 'bat' || ch.side === 'field') && ch.amp > 0 && ch.amp <= 1 && ch.hold > 0 && (ch.from === 'land' || ch.from === 'contact'), `${p.kind}: ${JSON.stringify(ch)}`);
  }
  check('the fans: a home run brings them up off the bat', cheerOf({ kind: 'homerun', play: {} })?.from === 'contact');
  {
    const R = createRoar();
    R.cheer(0, 0.8, 10, 2); R.cheer(0, 0.5, 11, 0); R.cheer(1, 0.6, 20, 1);
    const at = (t) => R.at(t), near = (a, b) => Math.abs(a - b) < 1e-9;
    const ok = at(9.99)[0] === 0 && near(at(10 + ROAR.rise / 2)[0], 0.4) && at(10 + ROAR.rise + 1)[0] === 0.8 && near(at(10 + ROAR.rise + 2 + ROAR.fall / 2)[0], 0.4)
      && at(10 + ROAR.rise + 2 + ROAR.fall + 0.01)[0] === 0 && at(12)[1] === 0 && at(20 + ROAR.rise)[1] === 0.6;
    check('the fans: a cheer rises, holds and falls away, the loudest of a side\'s at a time', ok, JSON.stringify([at(10.1), at(12), at(20.4)]));
    R.prune(40);
    check('the fans: a cheer that\'s over is forgotten', R.size === 0, String(R.size));
  }
}

// ── 1f. reduced motion ───────────────────────────────────────────────────────
// Every ball in play staged again with reduced motion, without running the world (the plan says
// it all): the cameras that would follow the ball hold still, cutting between stills (plays.js
// stillShots), and the ball is in the frame of the still that's up as each flight ends.
{
  let n = 0;
  const stillOf = (s) => JSON.stringify(s);
  for (const p of atBats.filter((x) => x.pitches[x.pitches.length - 1].result === 'inplay')) {
    const label = `seed ${SEED} reduced motion: ${p.inning}${p.half[0]} ${p.batter} ${p.kind}`;
    const D = createDirector(W, {});
    D.stage(p, castOf(p), { motion: false });
    const plan = D.play;
    if (!plan) { D.stop(); continue; }
    n++;
    check('reduced motion: nothing of the spectacle', !(D.fx || []).length, label);
    for (const c of plan.cuts) {
      check('reduced motion: every cut is a camera', isShot(c.shot), `${label}: ${JSON.stringify(c.shot)}`);
      if (typeof c.shot === 'object') check('reduced motion: every camera holds still', stillOf(shotAt(c.shot, c.at)) === stillOf(shotAt(c.shot, c.at + 2.7)), `${label}: ${c.shot.shot}`);
    }
    for (const b of plan.balls) {
      if (!b.path) continue;
      const T = Math.min(Number.isFinite(b.to) ? b.to : Number.isFinite(b.path.land) ? b.path.land : plan.landAt, plan.landAt);
      const up = plan.cuts.filter((c) => c.at <= T + 1e-9).pop();
      // a camera by name is the director's own framing of a bag or a man; the stills frame the ball
      if (!up || typeof up.shot !== 'object') continue;
      const q = project(shotAt(up.shot, T), 400, 300, b.path(T));
      check('reduced motion: the still that\'s up has the ball as each flight ends', !!q && q.x > -10 && q.x < 410 && q.y > -10 && q.y < 310, `${label}: ${up.shot.shot}, ${q ? `${q.x.toFixed(0)},${q.y.toFixed(0)}` : 'behind'}`);
    }
    D.stop();
  }
  check('reduced motion: the game has balls in play to hold still', n > 0);
}

// ── 1g. replays of the rarer plays ───────────────────────────────────────────
// Section 1 checks the replays of the game's own plays. A triple, a walk-off that isn't a home run
// and a triple play are rare enough that a game often has none, so the first of each from the games
// after it is staged here; a triple play may not turn up at all.
{
  const ballOf = (pl, t) => { let b = null; for (const x of pl.balls) if (x.from <= t) b = x; return b ? (b.path ? b.path(t) : b.at) : null; };
  const RARE = [['triple', (x) => x.kind === 'triple' && !x.walkoff, true], ['walkoff', (x) => x.walkoff && x.kind !== 'homerun' && !!x.play, true], ['tripleplay', (x) => x.kind === 'tripleplay', false]];
  for (const [kind, has, must] of RARE) {
    let p = atBats.find(has), seed = SEED;
    for (let s = SEED + 1; !p && s <= SEED + 60; s++) { p = gameOf(s).find((x) => !x.phase && (x.pitches || []).length && has(x)); seed = s; }
    if (must) check(`a replay: a ${kind} to stage (the game's, or the next games' first)`, !!p);
    if (!p) continue;
    const label = `seed ${seed}: ${p.inning}${p.half[0]} ${p.batter} ${p.kind}${p.walkoff ? ' walk-off' : ''}`;
    const D = createDirector(W, {});
    D.stage(p, castOf(p));
    const spec = D.play ? replayOf(p, D.play, D.log) : null;
    check(`a replay: a ${kind} earns its kind of replay`, spec?.kind === kind, `${label}: ${spec?.kind}`);
    if (spec?.kind === kind) {
      const R = stageReplay(p, spec, { cast: castOf(p) }), tBat = D.log[D.log.length - 1].contact.t;
      let worst = 0;
      for (let k = -5; k <= 30; k++) { const a = ballOf(D.play, tBat + k * 0.1), b = ballOf(R.D.play, R.key - spec.key + k * 0.1); if (a && b) worst = Math.max(worst, dist(a, b)); }
      check('a replay: staged again it\'s the same play (the ball within a micron of the live one)', worst < 1e-6, `${label}: ${worst.toExponential(2)} ft`);
      check('a replay: its window holds its moment, and no more than REPLAY.span', spec.from <= spec.key && spec.key <= spec.to && spec.to - spec.from <= REPLAY.span + 1e-9, `${label}: ${spec.from.toFixed(2)}..${spec.to.toFixed(2)}`);
      check('a replay: its camera is a camera', isShot(spec.shot), `${label}: ${JSON.stringify(spec.shot)}`);
      // the man sliding in at its moment: the batter into third, or the winning run home
      const L = R.D.play.log, man = kind === 'triple' ? L.batter : kind === 'walkoff' ? (L.runners || []).filter((r) => Number.isFinite(r.bags?.[4])).sort((a, b) => b.bags[4] - a.bags[4])[0] : null;
      while (R.W.t < R.key - 1e-9) R.W.step(DT);
      const subject = man ? (() => { const Q = R.W.pose(man.slot); return Q ? toPark(Q, Q.pelvis) : null; })() : ballOf(R.D.play, R.key);
      const q = subject ? project(shotAt(spec.shot, R.key), 400, 300, subject) : null;
      check(`a replay: its camera has ${man ? 'the man sliding in' : 'the ball'} at its moment`, !!q && q.x > 0 && q.x < 400 && q.y > 0 && q.y < 300, `${label}: ${q ? `${q.x.toFixed(0)},${q.y.toFixed(0)}` : 'behind'}`);
      R.D.stop();
    }
    D.stop();
  }
}

// ── 2. the view ──────────────────────────────────────────────────────────────
// A renderer that records what it's handed: the cast, the poses by slot, the ball, the shots.
const rec = { poses: new Map(), balls: 0, frames: 0, roar: [0, 0], marks: 0, resets: 0, hours: [], wx: [], roof: [] };
const renderer = () => ({
  kind: 'stub', lost: false, quality: { dpr: 1, tube: false }, casters: [],
  setCast(cast) { rec.cast = cast; return 0; },
  setPose(slot, pose) { rec.poses.set(slot, pose); },
  setBall(p) { if (p) rec.balls++; },
  render() { rec.frames++; return true; },
  setCrowd(levels) { rec.roar = [Math.max(rec.roar[0], levels[0]), Math.max(rec.roar[1], levels[1])]; },
  markDirt(list) { rec.marks += list.length; }, resetDirt() { rec.resets++; }, setHour(h) { rec.hours.push(h); }, setWeather(wx, o) { rec.wx.push({ wx, o }); }, setTime() {},
  setRoof(r) { rec.roof.push(r); }, roof: { p: 1, to: 1, moving: false },
  setBoard() {}, setVenue() { return null; }, pump() { return 0; }, pending: () => 0, dispose() {},
  // a city round the park, so a game opens on the street
  city: { buildings: 1 },
});
{
  const host = stub.makeHost();
  const v = createGrandstandView(host, { force: true, renderer });
  await v.ready();
  const capText = () => host.querySelector('.gds-cap-text')?.textContent ?? '';
  // the first payloads in order, as far as two half-innings and a strikeout, a walk and a hit
  // batsman, with one at-bat that changes the bags left out, as the booth leaves some out: the
  // next one starts from bags the picture didn't leave
  const feed = [];
  const want = new Set(['strikeout', 'walk', 'hitbypitch']);
  let skipped = false;
  for (let i = 0; i < order.length; i++) {
    const p = order[i], next = order[i + 1];
    if (!skipped && i > 0 && !p.phase && next && !next.phase && !want.has(p.kind) && String(p.basesBefore) !== String(p.basesAfter)) { skipped = true; continue; }
    feed.push(p);
    if (!p.phase) want.delete(p.kind);
    if (feed.length >= 24 && !want.size) break;
  }
  check('the view is fed a strikeout, a walk and a hit batsman', !want.size, [...want].join(', '));
  // the league's leaders ride a game's first payload (the server's gamedayLeaders), for the table
  // between innings
  const bat = (name, team, hr, avg, sb) => ({ name, team, hr, rbi: hr * 3, avg, sb });
  feed[0] = { ...feed[0], leaders: { hr: [bat('Ray Pellicano', 'Rats', 14, 0.284, 3), bat('Mo Dunleavy', 'Kings', 12, 0.301, 9)], avg: [bat('Mo Dunleavy', 'Kings', 12, 0.301, 9)], sb: [bat('Mo Dunleavy', 'Kings', 12, 0.301, 9)], k: [{ name: 'Ted Vance', team: 'Rats', w: 6, l: 2, era: 3.12, k: 71 }] } };
  // and a play on the bases: the game's first, if its first innings have none, out of its order as
  // the booth might leave plays out
  if (!feed.some((p) => p.phase === 'run')) { const r = order.find((p) => p.phase === 'run'); if (r) feed.push(r); }
  check('the view is fed a play on the bases', feed.some((p) => p.phase === 'run'));
  // and a home run with a hold that has room for its replay (the game's first, or the next games'),
  // then the same again with reduced motion, when its replay is a still
  const replayAt = new Set(), calmAt = new Set();
  {
    const isHr = (x) => !x.phase && x.kind === 'homerun' && (x.pitches || []).length;
    let hr = order.find(isHr);
    for (let s = SEED + 1; !hr && s <= SEED + 60; s++) hr = gameOf(s).find(isHr);
    if (hr) {
      replayAt.add(feed.length); feed.push({ ...hr, hold: 35000 });
      replayAt.add(feed.length); calmAt.add(feed.length); feed.push({ ...hr, hold: 35000 });
    }
    check('the view is fed a home run to replay', replayAt.size === 2);
  }
  let prevLine = '', picture = null, cutaways = 0, streetOpens = 0;
  // the live text, every line as it's said: the view opens before the first beat, as the TV opens
  // it, so its live region is there from the first line
  v.showIdle();
  // the picture starts on the screen's tier: the full one, with no coarse pointer here
  check('the picture starts on the full tier', v.rung === 0 && v.rungs === rungsFor('full').length && Object.entries(PARK_TIERS.full).every(([k, x]) => v.renderer.quality[k] === x),
    JSON.stringify(v.renderer.quality));
  const said = [], liveEl = host.querySelector('.gds-live');
  check('the view has its live text for a screen reader', !!liveEl);
  if (liveEl) { const add = liveEl.appendChild.bind(liveEl); liveEl.appendChild = (c) => { said.push(c.textContent); return add(c); }; }
  // one at-bat with Play by Play switched off, through the attribute the setting puts on the page
  const quietAt = feed.findIndex((x, i) => i > 0 && !x.phase);
  feed.forEach((p, k) => {
    const line = `line ${k}: ${p.desc || p.phase || p.kind}`;
    const label = `seed ${SEED} view #${k} ${p.phase || p.kind}`;
    rec.poses.clear(); rec.balls = 0; rec.roar = [0, 0]; rec.marks = 0;
    const sounds0 = stub.sounds.length, said0 = said.length, quiet = k === quietAt, calm = calmAt.has(k);
    if (calm) globalThis.document.documentElement.setAttribute('data-motion', 'off');
    if (quiet) globalThis.document.documentElement.setAttribute('data-play-by-play', 'off');
    // the line first and then its payload, as the broadcast sends them
    v.setCaption(line, { held: true });
    v.apply(p);
    // an at-bat and a play on the bases are the director's, live; a changeover's line goes up a
    // beat in
    const run = p.phase === 'run';
    if (run || (!p.phase && (p.pitches || []).length)) {
      const D = v.director, W2 = v.world, budget = budgetOf(p), start = W2.t;
      check('the view hands the at-bat or the play on the bases to the director', D && !D.landed && D.payload === p, label);
      const differs = !!picture && picture.some((b, i) => b !== !!(p.basesBefore || [])[i]), opening = opensGame(p);
      check('an at-bat opens on the cutaway when the picture\'s bags differ, or on the street when it opens the game (unless the play has no time to spare), and only then',
        D.cutaway === ((differs || opening) && !D.squeezed) && (!D.cutaway || v.shot === D.opening) && (!D.cutaway || D.opening === (opening ? (D.t0 - start - PACE.in >= PACE.streetMin - 1e-9 ? 'street' : 'sky') : 'sky')),
        `${label}: picture ${picture} payload ${p.basesBefore}, opening ${opening}, shot ${v.shot}`);
      if (differs) cutaways++;
      if (opening && D.opening === 'street') streetOpens++;
      // up to just before the landing, the last line is still up
      let held = true;
      while (!D.landed && W2.t - start < Math.max(budget, D.floor) + 2) {
        stub.runFrames(1, 1000 / 30);
        if (!D.landed && capText() !== prevLine) held = false;
      }
      check('the line is held until the play lands', held, `${label}: "${capText()}" before the landing`);
      check('the play lands in the view inside its budget, or as soon as its last pitch and the play allow', D.landed && W2.t - start <= Math.max(budget, D.floor) + 0.1, `${label}: ${(W2.t - start).toFixed(2)} of ${budget} s`);
      check('the line goes up when the play lands', capText() === line, `${label}: "${capText()}"`);
      // the live text: every pitch as it's thrown, in order and in pitchText's words, and the line
      // as it goes up; nothing with Play by Play off
      const mine = said.slice(said0);
      if (quiet) check('with Play by Play off the live text says nothing', !mine.length, `${label}: ${mine.join(' | ')}`);
      else {
        const want = (p.pitches || []).map((q, i, all) => pitchText(q, i === all.length - 1));
        let j = 0;
        for (const x of mine) if (j < want.length && x === want[j]) j++;
        check('the live text says every pitch as it\'s thrown, in order', j === want.length, `${label}: ${j} of ${want.length}: ${mine.join(' | ')}`);
        check('the live text says the booth\'s line as it goes up', mine.includes(line), `${label}: ${mine.join(' | ')}`);
      }
      const S = v.state;
      if (run) {
        check('a play on the bases: the board has no count and no pitch', S.balls === 0 && S.strikes === 0 && S.pitch == null, `${label}: ${S.balls}-${S.strikes}`);
        if (['steal', 'caughtstealing', 'doublesteal'].includes(p.kind)) check('a steal gets its card once it lands', S.steal?.runner === p.runner, `${label}: ${S.steal?.runner}`);
        const own = splashOf(p);
        if (own) check('a play that earns a splash gets it (a strikeout, ball four, a diving catch…)', S.splash?.kind === own.kind, `${label}: ${S.splash?.kind} for ${own.kind}`);
      } else {
        const last = p.pitches[p.pitches.length - 1];
        check('the board has the last pitch\'s count, without a fourth ball or a third strike', S.balls === Math.min(3, last.balls) && S.strikes === Math.min(2, last.strikes) && S.pitch === last, `${label}: ${S.balls}-${S.strikes}`);
        const own = splashOf(p);
        if (own) check('a play that earns a splash gets it (a strikeout, ball four, a diving catch…)', S.splash?.kind === own.kind, `${label}: ${S.splash?.kind} for ${own.kind}`);
      }
      const battery = ['pitcher', 'catcher', 'batter'].map((r) => p0slot(p, r));
      check('the battery\'s poses reach the renderer', battery.every((s) => rec.poses.has(s)), `${label}: ${[...rec.poses.keys()]}`);
      check('the ball reaches the renderer', rec.balls > 0, label);
      const shown = D.log.filter((r) => r.shown).length;
      check('a sound for every pitch shown, and the play\'s own', stub.sounds.length - sounds0 >= shown + 1, `${label}: ${stub.sounds.length - sounds0} for ${shown} pitches`);
      check('the view\'s camera is a shot', isShot(v.shot), `${label}: ${JSON.stringify(v.shot)}`);
      // then everyone comes to rest and the frames stop (a home run's trot is 23 s, and a side
      // going off after its third out can take longer)
      // (and a replay plays: its bug up and its camera on while it does, its world slower than the
      // live one, or held still with reduced motion, and the live camera back after)
      // (the rate from the frames it was up: the live world's time and its own, first and last)
      let seenReplay = null, bugUp = true, onCamera = true, live0 = 0, live1 = 0, own0 = 0, own1 = 0;
      for (let i = 0; i < 1200 && v.busy(); i++) {
        stub.runFrames(1, 1000 / 30);
        const r = v.replay;
        if (!r) continue;
        if (!seenReplay) { seenReplay = r; live0 = W2.t; own0 = r.W.t; }
        bugUp &&= v.state.replay === true;
        onCamera &&= v.shot === r.shot;
        live1 = W2.t; own1 = r.W.t;
      }
      if (replayAt.has(k)) {
        const r = seenReplay;
        check('a home run with room in its hold gets its replay', !!r, label);
        if (r) {
          check('a replay: its bug is up and its camera on while it plays', bugUp && onCamera, `${label}: bug ${bugUp}, camera ${onCamera}`);
          check('a replay: the live camera\'s back after, and the bug down', v.shot !== r.shot && isShot(v.shot) && !v.state.replay, `${label}: ${JSON.stringify(v.shot)}`);
          if (calm) check('a replay with reduced motion: a still of its moment', r.still && own1 === own0 && r.W.t - r.key >= -1e-9 && r.W.t - r.key <= DT + 1e-9, `${label}: ${(r.W.t - r.key).toFixed(4)} s past its moment, moved ${(own1 - own0).toFixed(3)} s`);
          else {
            const rate = (own1 - own0) / Math.max(1e-6, live1 - live0);
            check('a replay: slow motion, its world at REPLAY.rate of the live one, to the end of its window', !r.still && Math.abs(rate - REPLAY.rate) < 0.03 && r.W.t >= r.to - 1e-6, `${label}: ${rate.toFixed(3)}, ${(r.W.t - r.to).toFixed(3)} s from its end`);
          }
          check('a replay: the live text says so', said.slice(said0).some((x) => /^Replay/.test(x)), label);
          const fans = p.half === 'bottom' ? 0 : 1;
          check('the fans: a home run gets the batting side\'s fans up', rec.roar[fans] >= 0.9, `${label}: ${rec.roar.map((x) => x.toFixed(2))}`);
          const shellsOut = Math.max(-Infinity, ...(D.fx || []).filter((e) => e.kind === 'burst').map(fxEnd));
          check('a replay: it waits for the fireworks to be out', live0 >= shellsOut - 1e-6, `${label}: ${(shellsOut - live0).toFixed(2)} s early`);
        }
      }
      const frames = rec.frames;
      stub.runFrames(20, 1000 / 30);
      check('at rest, the frames stop', !v.busy() && rec.frames === frames, `${label}: ${rec.frames - frames} more frames`);
      check('the dirt: every mark the director makes reaches the renderer', D.marks.length > 0 && rec.marks === D.marks.length, `${label}: ${rec.marks} of ${D.marks.length}`);
      if (calm) globalThis.document.documentElement.setAttribute('data-motion', 'on');
    } else {
      stub.runTimers(2500);
      check('a changeover: its line goes up', capText() === line, `${label}: "${capText()}"`);
      const sr = host.querySelector('.gds-sr')?.textContent || '';
      if (v.state.tableRace) check('a changeover: the board in words has the leaders\' table', /League leaders/.test(sr), `${label}: "${sr}"`);
    }
    if (quiet) globalThis.document.documentElement.setAttribute('data-play-by-play', 'on');
    prevLine = line;
    picture = pictureAfter(p);
  });
  check('the view is fed an at-bat its picture disagrees with', cutaways > 0);
  // the frames here come 30 a second, slower than the governor's 24 ms, so it's taken the picture
  // down while the plays ran, the lens's taps first
  check('the picture: frames slower than the governor wants take it down, the lens first', v.rung > 0 && v.renderer.quality.dof === 12, `rung ${v.rung} of ${v.rungs}, dof ${v.renderer.quality.dof}`);
  check('the view opens the game\'s first at-bat on the street outside the main gate', feed.filter(opensGame).length === 1 && streetOpens === 1, `${streetOpens} of ${feed.filter(opensGame).length}`);
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
  // a line come before its play's landed (the sandbox's Next, or a hidden tab), on a ball in play
  // with a hold: the view lands the play with it and plans the dead time while the world's still at
  // the play's start, before the fielders the plan places at the cut in are in it. Each one's walk
  // back went in ahead of his ready set, and the director threw ("plays stand_idle at 0.800, before
  // field_ready_in"). Here the dead time has to start after the landing, and everyone get where he
  // was sent once the world plays it.
  {
    const p = atBats.find((x) => x.play && !x.walkoff && (x.outs | 0) < 3);
    if (p) {
      const label = `seed ${SEED} early line: ${p.inning}${p.half[0]} ${p.kind}`;
      v.setCaption('the line before', { held: true });
      v.apply({ ...p, hold: 35000 });
      const D = v.director, W2 = v.world, t0 = W2.t;
      let threw = null;
      try { v.setCaption('the early line', { held: true }); } catch (err) { threw = err.message; }
      check('a line come early: the play lands with it and the dead time is planned', !threw && capText() === 'the line before' && !!D.between && W2.t < D.landAt, `${label}: ${threw || `"${capText()}", planned ${!!D.between}, ${(D.landAt - W2.t).toFixed(2)} s short of the landing`}`);
      const B = D.between;
      if (B) {
        check('a line come early: the dead time starts after the play\'s landing on the world\'s clock', B.from >= D.landAt + BETWEEN.settle - 1e-9, `${label}: from +${(B.from - t0).toFixed(2)}, landing +${(D.landAt - t0).toFixed(2)}`);
        for (let i = 0; i < 1500 && v.busy(); i++) stub.runFrames(1, 1000 / 30);
        for (const g of B.gone) {
          const Q = W2.pose(g.slot), pv = Q ? toPark(Q, Q.pelvis) : null, d = pv ? flatD(pv, g.to) : Infinity;
          check('a line come early: everyone ends where he was sent (4 ft)', d <= 4 || g.stay, `${label}: ${g.role} slot ${g.slot}, ${d.toFixed(1)} ft from [${g.to.map((x) => x.toFixed(0))}]`);
        }
      }
    }
  }
  // the dirt starts fresh for another game, and not for this one's next at-bat
  {
    const p = atBats[atBats.length - 1], resets = rec.resets;
    v.apply(p);
    check('the dirt: the same game\'s next at-bat keeps its marks', rec.resets === resets, `${rec.resets - resets} resets`);
    v.apply({ ...p, battingTeam: 'Precinct 9 Enforcers' });
    check('the dirt: another game starts on a fresh infield', rec.resets === resets + 1, `${rec.resets - resets} resets`);
  }
  // the sky: the minute a payload aired at reaches the renderer as an hour, and one without is night
  {
    const p = atBats[atBats.length - 1];
    v.apply({ ...p, clock: 1150 });
    const a = rec.hours[rec.hours.length - 1];
    v.apply({ ...p });
    const b = rec.hours[rec.hours.length - 1];
    check('the sky: a payload\'s minute reaches the renderer as an hour, and one without is night', Math.abs(a - 1150 / 60) < 1e-9 && b === null, `${a} then ${b}`);
    // and its weather, lightning flashing unless the viewer's asked for less motion
    const wx = { word: 'thunderstorm', precip: 'rain', rate: 0.6 };
    v.apply({ ...p, wx });
    const w1 = rec.wx[rec.wx.length - 1];
    globalThis.document.documentElement.setAttribute('data-motion', 'off');
    v.apply({ ...p, wx });
    const w2 = rec.wx[rec.wx.length - 1];
    globalThis.document.documentElement.removeAttribute('data-motion');
    v.apply({ ...p });
    const w3 = rec.wx[rec.wx.length - 1];
    check('the weather: a payload\'s weather reaches the renderer, its lightning not flashing for less motion, and none is none', w1.wx === wx && w1.o.flash === true && w2.o.flash === false && w3.wx === null, JSON.stringify([w1.o, w2.o, w3.wx]));
    // and the venue's roof as the line aired (the broadcast's `roof`), so the shells stand where the
    // map's do; a payload without one leaves them where they are
    const n0 = rec.roof.length;
    v.apply({ ...p, roof: 1 });
    const r1 = rec.roof[rec.roof.length - 1];
    v.apply({ ...p, roof: 0 });
    const r2 = rec.roof[rec.roof.length - 1];
    v.apply({ ...p });
    check('the roof: a payload\'s roof reaches the renderer, and one without leaves it where it is', r1 === 1 && r2 === 0 && rec.roof.length === n0 + 2, JSON.stringify(rec.roof.slice(n0)));
  }
  v.clear();
  check('cleared', host.children.length === 0);
}
function p0slot(p, role) { return castOf(p).find((c) => c.look.role === role).look.slot; }

const ms = Date.now() - T0;
console.log(`diamond-smoke seed ${SEED}: ${atBats.length} at-bats (${LONG.length} again at a long hold), ${runs.length} plays on the bases, ${passes}/${passes + failures} passed (${(ms / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
