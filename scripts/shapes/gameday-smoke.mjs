// Gameday smoke: plays real Deadball games through the 2-D Gameday view headlessly and fails
// if a payload throws, a play doesn't land inside a line's hold, or the runners on the field
// don't end where the play left them.
//
// The Gameday view (client/game/js/panels/gameday.js) is the only part of the Deadball
// pipeline with no server to test it, and the fallback the 3-D view will drop back to. So
// this runs the actual sim (plugins/broadcast/sports/baseball.js) and builds the actual
// payloads (sports/baseball-gameday.js, the module the broadcast attaches to its lines),
// feeds every payload to the view in order the way tv.js does, cranks the clock through a
// line's minimum hold, and reads the field back: which bases the runner tokens stand on,
// which bases are lit, and whether the play has landed.
//
// The games are found, not hand-picked: the first seeds that between them hold a triple
// play, a double play that scores a run, an inning-ending double play that clears a man
// off third, a sacrifice fly, a productive out, a walk with a runner on second and first
// open, a grand slam, a walk-off, extra innings, and the sim's one-swing finish (a
// single that scores a run with nobody on). A plain slate almost never shows most of
// those, and they are the plays with the runner logic. Then the same for sim v2's plays:
// steals of second and third, caught stealing, a half that ends on the bases, a pickoff,
// a throw over, double steals with and without an out, a wild pitch that scores, a
// passed ball, a hit batter, and both kinds of error. A v2 game's line score has an E.
//
// Every ball in play goes where the server's play (the payload's `play`) says: to the man
// it names and on through the bags, or down where it came down. The live text for a screen
// reader (Play by Play) says every pitch as it's thrown, in order, and the booth's line as it
// goes up.
//
// It proves the view RUNS and that its runners and the ball agree with the sim. It does not
// look at pixels and is not meant to.
//
// Run:  node scripts/shapes/gameday-smoke.mjs

import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const { createGamedayView, pitchText, __test: GD } = await import('../../client/game/js/panels/gameday.js');
const { sportsRng } = await import('../../plugins/broadcast/rng.js');
const { simGame, simGameV2 } = await import('../../plugins/broadcast/sports/baseball.js');
const { gamedayPayloads } = await import('../../plugins/broadcast/sports/baseball-gameday.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};

// The broadcast's own formatters, near enough: the view only shows them.
const abbr = (n) => String(n || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'TBD';
const ORD = ['', '1st', '2nd', '3rd'];
const ordinal = (n) => ORD[n] || `${n}th`;
// How long a play-by-play line holds on air at the default clock: an hour's slot (timeScale
// 3), 85% of it for about 80 lines, on the 5-second tick grid. The view reveals pitches over
// up to 13 seconds before the ball is put in play, so the 10-second floor
// (SPORTS_LINE_HOLD_MS) is no measure of whether a play lands; the line it rides is.
const HOLD_MS = 35000, STEP_MS = 100;

// ── find games that hold the plays worth checking ────────────────────────────
const M = { away: 'Rats', home: 'Kings' };
const gameFor = (seed, v) => (v === 2
  ? simGameV2(M, null, sportsRng(seed * 2654435761 + 7), { seed })
  : simGame(M, null, sportsRng(seed * 2654435761 + 7)));
const WANT = {
  tripleplay: (b) => b.kind === 'tripleplay',
  dpScores: (b) => b.kind === 'doubleplay' && b.rbi > 0,
  dpEndsInning: (b, before) => b.kind === 'doubleplay' && b.outs === 3 && before[2],
  sacfly: (b) => b.kind === 'sacfly',
  productout: (b) => b.kind === 'productout',
  walkUnforced: (b, before) => b.kind === 'walk' && before[1] && !before[0],
  grandSlam: (b) => b.kind === 'homerun' && b.rbi === 4,
  walkoff: (b) => b.walkoff,
  extras: (b) => b.inning >= 10,
  oneSwingFinish: (b) => (b.kind === 'single' || b.kind === 'double') && !b.bases.some(Boolean),
};
const found = new Map();
for (let seed = 1; seed < 40000 && found.size < Object.keys(WANT).length; seed++) {
  const game = gameFor(seed, 1);
  let before = [false, false, false];
  for (const b of game.beats) {
    if (b.type === 'half_start') { before = [false, false, false]; continue; }
    if (b.type !== 'atbat') continue;
    for (const [k, test] of Object.entries(WANT)) if (!found.has(k) && test(b, before)) found.set(k, seed);
    before = b.bases;
  }
}
for (const k of Object.keys(WANT)) check(`a game with a ${k} was found`, found.has(k));
const seeds = [...new Set([...found.values(), 12345])];

const run = (kind, more) => (b) => b.type === 'run' && b.kind === kind && (!more || more(b));
const WANT_V2 = {
  steal: run('steal'),
  stealOfThird: run('steal', (b) => b.base === 3),
  caughtStealing: run('caughtstealing'),
  halfEndsOnTheBases: (b) => b.type === 'run' && b.out && b.outs === 3,
  pickoff: run('pickoff'),
  throwOver: run('throwover'),
  doubleSteal: run('doublesteal', (b) => !b.out),
  doubleStealOut: run('doublesteal', (b) => b.out),
  wildPitchScores: run('wildpitch', (b) => b.runs > 0),
  passedBall: run('passedball'),
  hitByPitch: (b) => b.kind === 'hitbypitch',
  bootedBall: (b) => b.kind === 'error' && b.errorType === 'fielding',
  throwingErrorScores: (b) => b.kind === 'error' && b.errorType === 'throwing' && b.runs > 0,
};
const foundV2 = new Map();
for (let seed = 1; seed < 40000 && foundV2.size < Object.keys(WANT_V2).length; seed++) {
  for (const b of gameFor(seed, 2).beats) for (const [k, test] of Object.entries(WANT_V2)) if (!foundV2.has(k) && test(b)) foundV2.set(k, seed);
}
for (const k of Object.keys(WANT_V2)) check(`a v2 game with a ${k} was found`, foundV2.has(k));
const seedsV2 = [...new Set(foundV2.values())];

// ── one game through the view ──────────────────────────────────────────────────
function play(seed, v = 1) {
  const game = gameFor(seed, v);
  const { order } = gamedayPayloads(game, seed, { abbr, ordinal });
  const tag = v === 2 ? `v2 seed ${seed}` : `seed ${seed}`;
  const host = stub.makeHost();
  const view = createGamedayView(host);
  view.showIdle();
  let applied = 0, landed = 0, tokensRight = 0, litRight = 0, inPlay = 0, ballRight = 0, saidRight = 0, landedAt = null;
  const bad = [];
  // every line of the live text as it's said
  const said = [], live = host.find('.gd-live');
  if (live) { const add = live.appendChild.bind(live); live.appendChild = (c) => { said.push(c.textContent); return add(c); }; }
  for (const p of order) {
    const said0 = said.length;
    try {
      view.setCaption('A line.', { held: true });   // tv.js holds every line that carries a payload
      view.apply(p);
      // In steps, not one jump: a timer set while the clock is mid-jump is scheduled from
      // the far end of it, and the view's plays are chains of timers. Where the ball is
      // when the play lands is kept, since the idle loop takes it back to the mound after.
      landedAt = null;
      const f = host.find('.gd-field'), ball = host.find('.gd-ball');
      for (let t = 0; t < HOLD_MS; t += STEP_MS) {
        stub.runTimers(STEP_MS);
        if (!landedAt && f && ball && !f.classList.contains('replaying')) landedAt = [ball.style.left, ball.style.top];
      }
    } catch (e) {
      bad.push(`${p.inningOrd} ${p.half} ${p.kind || p.phase}: threw ${e.message}`);
      continue;
    }
    applied++;
    if (p.phase === 'half') continue;
    // the live text: every pitch in order in pitchText's words, then the line as it went up
    const mine = said.slice(said0), pitched = (p.pitches || []).map((q, i, all) => pitchText(q, i === all.length - 1));
    let j = 0;
    for (const x of mine) if (j < pitched.length && x === pitched[j]) j++;
    if (j === pitched.length && mine.includes('A line.')) saidRight++;
    else bad.push(`${p.inningOrd} ${p.half} ${p.kind}: said ${j} of ${pitched.length} pitches${mine.includes('A line.') ? '' : ' and not the line'}: ${mine.join(' | ')}`);
    const field = host.find('.gd-field');
    // The play has landed inside the hold: the REPLAY bug is off.
    if (field && !field.classList.contains('replaying')) landed++;
    else bad.push(`${p.inningOrd} ${p.half} ${p.kind}: still replaying after ${HOLD_MS} ms`);
    // Where the runners stand: every runner token still on the field, and the batter if
    // he reached, read back as base numbers by matching their position to the bags.
    const bagAt = new Map();
    for (const n of [1, 2, 3]) { const bag = host.find(`.gd-fbase[data-b="${n}"]`); if (bag) bagAt.set(`${bag.style.left}|${bag.style.top}`, n); }
    const on = [];
    const strays = [];
    for (const t of [...host.findAll('.gd-runners .gd-runner'), host.find('.gd-batter')]) {
      if (!t || t.classList.contains('outed')) continue;
      const n = bagAt.get(`${t.style.left}|${t.style.top}`);
      if (n) on.push(n);
      else if (t.classList.contains('gd-runner')) strays.push(`${t.style.left},${t.style.top}`);
    }
    const want = [1, 2, 3].filter((n) => p.basesAfter[n - 1]);
    const got = on.slice().sort();
    if (JSON.stringify(got) === JSON.stringify(want) && !strays.length) tokensRight++;
    else bad.push(`${p.inningOrd} ${p.half} ${p.kind} [${p.basesBefore.map(Number).join('')}→${p.basesAfter.map(Number).join('')}]: runners on ${JSON.stringify(got)}${strays.length ? ` + strays ${strays.join(' ')}` : ''}`);
    // The lit bags agree with the play.
    const lit = [1, 2, 3].filter((n) => host.find(`.gd-fbase[data-b="${n}"]`)?.classList.contains('lit'));
    if (JSON.stringify(lit) === JSON.stringify(want)) litRight++;
    else bad.push(`${p.inningOrd} ${p.half} ${p.kind}: lit ${JSON.stringify(lit)}, want ${JSON.stringify(want)}`);
    // The ball went where the server's play says: the man it names fields it, and it ends at
    // the last bag the play went through, or where it came down. An error goes off somewhere.
    if (p.play) {
      inPlay++;
      const traj = GD.hitTrajectory(p);
      const end = traj.mode === 'ground' ? GD.POS[traj.relay[traj.relay.length - 1]] : traj.land;
      const at = (v) => `${(v * 100).toFixed(1)}%`;
      const named = traj.mode === 'homer' || traj.mode === 'error' || traj.fielder === GD.BY_NUMBER[p.play.f[0]];
      if (named && (!end || (landedAt && landedAt[0] === at(end[0]) && landedAt[1] === at(end[1])))) ballRight++;
      else bad.push(`${p.inningOrd} ${p.half} ${p.kind} ${JSON.stringify(p.play)}: ball at ${landedAt} by ${traj.fielder}`);
    } else if (!['strikeout', 'walk', 'hitbypitch'].includes(p.kind) && p.phase !== 'run') bad.push(`${p.inningOrd} ${p.half} ${p.kind}: no play`);
  }
  const atbats = order.filter((p) => p.phase !== 'half').length;   // every play: the at-bats and, in v2, the plays on the bases
  check(`${tag}: every payload applies`, applied === order.length, bad.filter((b) => /threw/.test(b)).slice(0, 3).join(' | '));
  check(`${tag}: every play lands inside a line's hold`, landed === atbats, bad.filter((b) => /replaying/.test(b)).slice(0, 3).join(' | '));
  check(`${tag}: the runners end where the play left them`, tokensRight === atbats, bad.filter((b) => /runners on/.test(b)).slice(0, 4).join(' | '));
  check(`${tag}: the lit bags agree`, litRight === atbats, bad.filter((b) => /lit /.test(b)).slice(0, 3).join(' | '));
  check(`${tag}: every ball in play goes where its play says`, inPlay > 20 && ballRight === inPlay && !bad.some((b) => /no play$/.test(b)), bad.filter((b) => /ball at|no play/.test(b)).slice(0, 3).join(' | '));
  check(`${tag}: the live text says every pitch and the booth's line`, !!live && saidRight === atbats, bad.filter((b) => /: said /.test(b)).slice(0, 3).join(' | '));
  // A v2 game counts errors, so its line score has an E; a v1 game's has R and H only.
  const head = host.find('.gd-ls-head')?.textContent || '';
  check(`${tag}: the line score ends ${v === 2 ? 'R H E' : 'R H'}`, v === 2 ? /RHE$/.test(head) : /RH$/.test(head), head);
  return order.length;
}

let payloads = 0;
for (const seed of seeds) payloads += play(seed);
for (const seed of seedsV2) payloads += play(seed, 2);

console.log(`gameday smoke: ${seeds.length} v1 games and ${seedsV2.length} v2 games, ${payloads} payloads, ${passes} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
