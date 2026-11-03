// Park clock smoke: does every pitch of every game fit in the park's time, with nobody cutting
// the picture? Phase S0 of docs/proposals/coliseum-seats.md.
//
// A seat in the stands has no camera cuts, so it can't leave a pitch out the way the TV director
// does when a long at-bat lands on a short line (diamond/timing.js budgetOf). The park clock
// (client/game/js/panels/diamond/parkclock.js) lays every pitch out inside its payload's window,
// which is its line's hold, and the booth is paced by the park (baseball-pacing.js paceCalls). So
// this plays seasons of real games as they air, with the real lines and holds
// (scripts/shapes/parkclock-season.mjs: sim v3, the booth's narrator, the pacer), and asks of every
// window whether its pitches fit at the quickest pitch cycle a seat can see whole (CYCLE_MIN).
//
// A play the booth doesn't call (a throw over it leaves out, a plate appearance in extra innings
// that doesn't score, an extra inning's changeover) rides the window before it (`then`), so the
// seat still sees it. Those are counted on their own, since S1 decides how the pacer makes room.
//
// It runs every game twice: on today's pitches (synthPitches), and on the draft draw with more
// fouls (draftPitches), so the fit is known before a new draw is switched on at a recorded slot.
// It reports, for each draw: the pitches and fouls; the pitch cycle each game's tightest window
// affords, at the median, the 10th and 1st percentiles and the worst; the same for the game's
// whole time shared over all its gaps, which is what a pacer sized by the park could give; what
// the fixed needs are spent on; the worst window; the windows that overrun; and, for comparison,
// the pitches the TV director's budget would leave out at its quickest (an estimate from PACE
// and playRoom; diamond-smoke stages the real thing).
//
// Today's holds don't fit (S0's finding, in coliseum-seats.md): at the live 3:1 clock two windows
// in three can't hold their pitches at CYCLE_MIN. So the fit fails the gate only with --strict,
// which S1 makes the default once its pacer sizes each window by the park. Without it the gate
// fails if a game's plays don't all reach the park, if the clock breaks its own rules (each
// window its line's hold, end to end, every pitch timed in order), if the draft draw misses its
// targets, or if the clock isn't the same twice. The digest line is for comparing two runs.
//
// Run:  node scripts/shapes/parkclock-smoke.mjs [--seasons N] [--clock 3:1|1:1] [--strict]

import { readFileSync } from 'node:fs';

const { sportsRng, sportsHash } = await import('../../plugins/broadcast/rng.js');
const { seasonGames, airGame, draftPitches, DRAFT } = await import('./parkclock-season.mjs');
const { parkClock, cycleOf, windowNeed, CYCLE_MIN, CHANGEOVER_MIN, CLOCK_SALT } = await import('../../client/game/js/panels/diamond/parkclock.js');
const { budgetOf, playRoom, afterLand, LAST_PITCH, AFTER } = await import('../../client/game/js/panels/diamond/timing.js');
const { PACE } = await import('../../client/game/js/panels/diamond/director.js');
const { MPH } = await import('../../client/game/js/panels/diamond/flight.js');

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const SEASONS = Number(arg('--seasons', 4));
const CLOCK = arg('--clock', '3:1');
const SLOT_MS = CLOCK === '1:1' ? 10800000 : 3600000;
const STRICT = process.argv.includes('--strict');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};

const script = JSON.parse(readFileSync(new URL('../../content/media_broadcasts/bc_1783289744953.json', import.meta.url), 'utf8')).sports_pools;
const schedule = seasonGames(script, { seasons: SEASONS });

// ── the games as they air ─────────────────────────────────────────────────────
const FOUL_SALT = 0x464f554c;
const games = schedule.map((g) => {
  const a = airGame(script, g, { slotMs: SLOT_MS });
  return { ...g, ...a };
});
const isAtBat = (p) => !p.phase && Array.isArray(p.pitches);
// every play the sim made reaches the park: aired, or riding the payload before it
const reached = games.filter((g) => g.aired.length + g.uncalled.length === g.order.length + (g.aired[0]?.phase === 'arrive' ? 1 : 0)).length;
check('every play the sim made reaches the park', reached === games.length, `${reached} of ${games.length}`);

// The two draws over the same games: today's pitches, and the draft's built on them, each at-bat
// from a stream of its own off the game's seed.
const withPitches = (g, draw) => {
  if (draw === 'today') return g.aired;
  let k = 0;
  const redraw = (p) => (isAtBat(p) ? { ...p, pitches: draftPitches(p.pitches, sportsRng(sportsHash(g.seed, FOUL_SALT, k++))) } : (k++, p));
  return g.aired.map((p) => ({ ...redraw(p), ...(p.then ? { then: p.then.map(redraw) } : {}) }));
};

// The TV director at its quickest (planViews' first pass): every pitch cut in `quick`, out after
// PACE.after, the last one's play its playRoom, and pitches out of the middle from the end until
// the at-bat fits budgetOf, then the first. An upper bound: a play is often quicker than its room.
function tvDrops(p) {
  const ps = p.pitches, N = ps.length;
  if (N < 2) return 0;
  const cost = ps.map((q, i) => PACE.quick + 55 / (Math.max(50, q.velo || 90) * MPH) + (i === N - 1 ? playRoom(p) : PACE.after));
  const show = ps.map(() => true), budget = budgetOf(p);
  const total = () => PACE.in + cost.reduce((a, c, i) => a + (show[i] ? c : 0), 0);
  for (let i = N - 2; i >= 1 && total() > budget + 1e-9; i--) show[i] = false;
  if (total() > budget + 1e-9) show[0] = false;
  return show.filter((x) => !x).length;
}

const q = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(f * (s.length - 1))))] : NaN; };
const s1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));
const pct = (x) => `${(100 * x).toFixed(1)}%`;
// a digest of everything the clock gave, to compare two runs
let digest = 0x811c9dc5;
const fold = (n) => { digest = Math.imul(digest ^ (n >>> 0), 0x01000193) >>> 0; };

const out = {};
for (const draw of ['today', 'draft']) {
  const o = { pas: 0, pitches: 0, fouls: 0, tvDropped: 0, uncalledPitches: 0, gameMin: [], abCycles: [], over: [], overThen: [], gameWhole: [], fit: 0, fitPlays: 0, worst: null, halves: [], spent: {} };
  for (const g of games) {
    const pays = withPitches(g, draw);
    const clock = parkClock(pays, { seed: g.seed });
    let min = Infinity, sumLen = 0, sumFixed = 0, sumGaps = 0, overs = 0, oversPlays = 0;
    pays.forEach((p, i) => {
      const c = clock[i], need = windowNeed(p);
      fold(c.at); fold(c.len); for (const t of c.t) fold(t);
      sumLen += c.len / 1000; sumFixed += need.fixed; sumGaps += need.gaps;
      for (const x of [p, ...(p.then || [])]) {
        spend(o.spent, x);
        if (!isAtBat(x)) continue;
        o.pas++; o.pitches += x.pitches.length; o.fouls += x.pitches.filter((y) => y.result === 'foul').length;
        if (x !== p) o.uncalledPitches += x.pitches.length;
      }
      if (isAtBat(p)) o.tvDropped += tvDrops(p);
      if (p.phase === 'half') o.halves.push(c.len / 1000);
      if (!need.gaps && !need.fixed) return;
      if (c.over) { overs++; if (p.phase !== 'half' && !p.then) oversPlays++; (p.then ? o.overThen : o.over).push({ g, p, c, need }); }
      if (!need.gaps) return;
      const cyc = cycleOf(p);
      o.abCycles.push(cyc);
      if (cyc < min) min = cyc;
      if (!o.worst || cyc < o.worst.cyc) o.worst = { g, p, cyc, need };
    });
    o.gameMin.push(min);
    o.gameWhole.push((sumLen - sumFixed) / sumGaps);
    if (!overs) o.fit++;
    if (!oversPlays) o.fitPlays++;
  }
  out[draw] = o;
}
// What a game's fixed needs are spent on (s, summed over the season), by the director's numbers.
function spend(acc, p) {
  const add = (k, v) => { acc[k] = (acc[k] || 0) + v; };
  if (!p || p.phase === 'arrive') return;
  if (p.phase === 'half') { add('changeovers', CHANGEOVER_MIN); return; }
  const n = p.phase === 'run' ? 0 : p.pitches.length;
  add('the last pitch to the plate', LAST_PITCH);
  add('the ball in play or the call', playRoom(p));
  add('the reset after a play', AFTER.reset);
  const after = afterLand(p) - AFTER.reset;
  if (p.kind === 'homerun') { add('home run trots and welcomes', AFTER.trot + AFTER.welcome); add('replays', AFTER.replay); } else if (after > 0) add('replays', after);
  add('gaps', Math.max(0, n - 1));
}

// ── the report ────────────────────────────────────────────────────────────────
const uncalled = games.reduce((a, g) => a + g.uncalled.length, 0);
const byKind = {};
for (const g of games) for (const p of g.uncalled) { const k = p.phase === 'half' ? 'changeover' : p.phase === 'run' ? `run.${p.kind}` : (p.inning >= 10 ? 'extras at-bat' : p.kind); byKind[k] = (byKind[k] || 0) + 1; }
const kindOf = (p) => p.phase || (p.kind === 'homerun' ? 'homerun' : p.then ? 'with then' : 'at-bat');
console.log(`park clock smoke: ${games.length} games (${SEASONS} season${SEASONS === 1 ? '' : 's'} of ${schedule.length / SEASONS}), the ${CLOCK} clock, CYCLE_MIN ${CYCLE_MIN} s, CLOCK_SALT 0x${CLOCK_SALT.toString(16)}`);
console.log(`  the booth leaves ${uncalled} plays uncalled (${(uncalled / games.length).toFixed(2)} a game), each riding the payload before it: ${Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
for (const [draw, o] of Object.entries(out)) {
  const w = o.worst, aired = o.pitches - o.uncalledPitches;
  const per = (k) => (o.spent[k] || 0) / games.length;
  console.log(`  ${draw}${draw === 'draft' ? ` (relabel ${DRAFT.relabel}, extra ${DRAFT.extra}, most ${DRAFT.most})` : ''}: ${(o.pitches / games.length).toFixed(1)} pitches a game, ${(o.pitches / o.pas).toFixed(2)} a plate appearance, fouls ${pct(o.fouls / o.pitches)}`);
  console.log(`    games that fit every window at CYCLE_MIN: ${o.fit} of ${games.length}; every play's own window, changeovers and riders aside: ${o.fitPlays}`);
  console.log(`    the cycle each game's tightest window affords (s): median ${s1(q(o.gameMin, 0.5))}, p10 ${s1(q(o.gameMin, 0.1))}, p1 ${s1(q(o.gameMin, 0.01))}, worst ${s1(Math.min(...o.gameMin))}`);
  console.log(`    every window with a gap between pitches (s): median ${s1(q(o.abCycles, 0.5))}, p10 ${s1(q(o.abCycles, 0.1))}, p1 ${s1(q(o.abCycles, 0.01))}; under CYCLE_MIN ${pct(o.abCycles.filter((x) => x < CYCLE_MIN).length / o.abCycles.length)}`);
  console.log(`    the game's whole time shared over all its gaps (s): median ${s1(q(o.gameWhole, 0.5))}, p10 ${s1(q(o.gameWhole, 0.1))}, p1 ${s1(q(o.gameWhole, 0.01))}, worst ${s1(Math.min(...o.gameWhole))}`);
  console.log(`    a game's fixed needs (s): ${['the last pitch to the plate', 'the ball in play or the call', 'the reset after a play', 'replays', 'home run trots and welcomes', 'changeovers'].map((k) => `${k} ${per(k).toFixed(0)}`).join(', ')}; ${per('gaps').toFixed(0)} gaps between pitches`);
  console.log(`    changeover windows (s): median ${s1(q(o.halves, 0.5))}, p10 ${s1(q(o.halves, 0.1))}, shortest ${s1(Math.min(...o.halves))}`);
  if (w) console.log(`    worst window: slot ${w.g.slot}, ${w.p.half} ${w.p.inningOrd || w.p.inning}, ${w.p.batter || w.p.phase} ${w.p.kind || ''}, ${w.need.pitches} pitches${w.p.then ? ` and ${w.p.then.length} play(s) riding it` : ''} in ${(w.p.hold / 1000).toFixed(0)} s, needing ${(w.need.fixed + w.need.gaps * CYCLE_MIN).toFixed(0)}: ${s1(w.cyc)} s a pitch`);
  const overBy = {};
  for (const x of o.over) overBy[kindOf(x.p)] = (overBy[kindOf(x.p)] || 0) + 1;
  console.log(`    windows over at CYCLE_MIN: ${o.over.length} of their own play (${Object.entries(overBy).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}), ${o.overThen.length} with a play riding them`);
  console.log(`    TV at its quickest would leave out ${o.tvDropped} of ${aired} aired pitches (${pct(o.tvDropped / Math.max(1, aired))}), and doesn't show the uncalled plays' ${o.uncalledPitches}`);
  if (STRICT) {
    check(`${draw}: every window holds its pitches at CYCLE_MIN`, !o.over.length, o.over.slice(0, 2).map((x) => `slot ${x.g.slot} ${x.p.kind || x.p.phase}`).join(' | '));
    check(`${draw}: every window a play rides holds both at CYCLE_MIN`, !o.overThen.length, o.overThen.slice(0, 2).map((x) => `slot ${x.g.slot} ${x.p.kind}+${x.p.then.length}`).join(' | '));
  }
}

// ── the draft draw keeps to its targets (coliseum-seats.md §2) ────────────────
{
  const t = out.today, d = out.draft, ppa = (o) => o.pitches / o.pas, fr = d.fouls / d.pitches;
  check('draft: fouls are 15% to 20% of pitches', fr >= 0.15 && fr <= 0.2, pct(fr));
  check('draft: pitches a plate appearance within 0.2 of today\'s', Math.abs(ppa(d) - ppa(t)) <= 0.2, `${ppa(d).toFixed(2)} vs ${ppa(t).toFixed(2)}`);
}

// ── the clock's own rules ─────────────────────────────────────────────────────
{
  let bad = [];
  for (const g of games) {
    const c = parkClock(g.aired, { seed: g.seed });
    c.forEach((w, i) => {
      const p = g.aired[i], n = [p, ...(p.then || [])].reduce((m, x) => m + (isAtBat(x) ? x.pitches.length : 0), 0);
      if (w.len !== p.hold || (i > 0 && w.at !== c[i - 1].at + c[i - 1].len)) bad.push(`slot ${g.slot} #${i}: window ${w.at}+${w.len}, hold ${p.hold}`);
      else if (w.t.length !== n || w.t.some((t, k) => t < 0 || (k > 0 && t <= w.t[k - 1]))) bad.push(`slot ${g.slot} #${i}: ${w.t.length} of ${n} pitches, ${w.t.join(',')}`);
      else if (!w.over && (w.t.some((t) => t > w.len) || Math.abs(w.end - w.len) > 2)) bad.push(`slot ${g.slot} #${i}: ends ${w.end} of ${w.len}`);
    });
  }
  check('each window is its line\'s hold, end to end; every pitch timed in order; a window that fits is filled to its end', !bad.length, bad.slice(0, 3).join(' | '));
  // a made-up at-bat: four pitches and a single, at exactly its need at CYCLE_MIN and a second over
  const ab = { batter: 'A', kind: 'single', pitches: [{ velo: 90 }, { velo: 90 }, { velo: 90 }, { velo: 90 }] };
  const needMs = Math.round((windowNeed(ab).fixed + 3 * CYCLE_MIN) * 1000);
  const [tight] = parkClock([{ ...ab, hold: needMs }], { seed: 1 }), [short] = parkClock([{ ...ab, hold: needMs - 1000 }], { seed: 1 });
  check('an at-bat at exactly its need fits at CYCLE_MIN, and a second less doesn\'t', !tight.over && Math.abs(tight.cycle - CYCLE_MIN) < 1e-9 && short.over, `${tight.cycle} ${short.over}`);
  check('at its need the pitches go CYCLE_MIN apart', tight.t.every((t, k) => k === 0 || Math.abs(t - tight.t[k - 1] - CYCLE_MIN * 1000) <= 1), tight.t.join(','));
}

// ── the same twice ────────────────────────────────────────────────────────────
{
  const g = games[0];
  const again = airGame(script, g, { slotMs: SLOT_MS });
  const a = JSON.stringify(parkClock(g.aired, { seed: g.seed })), b = JSON.stringify(parkClock(again.aired, { seed: again.seed }));
  check('the clock gives the same windows and pitches twice', a === b);
}
console.log(`  digest ${digest.toString(16).padStart(8, '0')}; ${passes} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
