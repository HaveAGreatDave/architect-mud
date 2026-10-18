// FINAL SMOKE: Deadball's final in the Grandstand (docs/proposals/deadball-glass2.md, Phase 5).
//
//   node scripts/shapes/final-smoke.mjs
//
// WHAT IT GUARDS:
//   • the champions' show (diamond/spectacle.js planChampion): confetti all along the upper deck,
//     each flake let go up there, falling, never through the field, gone by its end; fireworks over
//     the outfield and further out over the city; none for a viewer who's asked for less motion
//   • the searchlights (planSearchlights): four, each pointing up into the sky, fading in and out
//   • the dress (gl/ballpark-mesh.js buildDress): bunting, the logos on their own texture key, a trophy
//   • the graphics (diamond/hud.js): the final's name and the seeds, its banner when the foot is
//     free, a line-up card, the champions' card with the most valuable player, every word at or
//     over the floor
//   • the most valuable player (baseball-gameday.js gameMvp): one of the winners, with his line
//   • the view: a final's first break dresses the park, reads the line-ups a card a man under the
//     searchlights instead of the leaders' table; its last out holds, crowns the champions (their
//     card, the trophy, confetti) and piles them on, the losers walking off
//
// No browser, GL or DB: the stub page and a recording renderer, on a hand-cranked clock.
import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const P = '../../client/game/js/panels/';
const { planChampion, planSearchlights, particleAt, beamAt, endOf, KINDS, DECK } = await import(P + 'diamond/spectacle.js');
const { layoutHud, TEXT_FLOOR } = await import(P + 'diamond/hud.js');
const { buildDress, LOGOS } = await import(P + 'gl/ballpark-mesh.js');
const { createGrandstandView } = await import(P + 'gameday-grandstand.js');
const { MOUND } = await import(P + 'diamond/geo.js');
const { sportsRng } = await import('../../plugins/broadcast/rng.js');
const { simGameV2 } = await import('../../plugins/broadcast/sports/baseball.js');
const { gamedayPayloads, gameMvp } = await import('../../plugins/broadcast/sports/baseball-gameday.js');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); } };

// ── the champions' show ───────────────────────────────────────────────────────
{
  const fx = planChampion({ t: 10, colour: [1, 0.2, 0.1], seed: 7 });
  const conf = fx.filter((e) => e.kind === 'confetti'), shells = fx.filter((e) => e.kind === 'burst');
  check('show: confetti all along the upper deck', conf.length === DECK.n, String(conf.length));
  check('show: fireworks over the outfield and the city', shells.length >= 16 && shells.some((e) => Math.hypot(e.at[0], e.at[2]) > 600), String(shells.length));
  let worst = 0, high = true, finite = true, gone = true;
  for (const e of conf) {
    for (let i = 0; i < KINDS.confetti.n; i++) {
      const first = [0.02, 0.2, 0.5, 1, 2].map((dt) => particleAt(e, i, e.t + KINDS.confetti.stagger + dt)).find(Boolean);
      for (let t = e.t; t < endOf(e); t += 0.5) {
        const q = particleAt(e, i, t);
        if (q && !q.at.every(Number.isFinite)) finite = false;
        if (q) worst = Math.min(worst, q.at[1] - 0.1);
      }
      if (particleAt(e, i, endOf(e) + 0.01)) gone = false;
      if (first && first.at[1] < DECK.y - 15) high = false;
    }
  }
  check('show: every flake finite', finite);
  check('show: a flake starts up by the deck', high);
  check('show: no flake goes through the field', worst >= -1e-9, worst.toFixed(3));
  check('show: every flake gone by its end', gone);
  check('show: none for less motion', planChampion({ t: 10, motion: false }).length === 0);
}
{
  const beams = planSearchlights({ from: 0, to: 30 });
  check('searchlights: four', beams.length === 4);
  check('searchlights: dark at the start and the end, lit in the middle', beams.every((e) => beamAt(e, 0).glow === 0 && beamAt(e, 15).glow > 0 && beamAt(e, 30).glow === 0));
  check('searchlights: every one up into the sky', beams.every((e) => [3, 9, 17, 25].every((t) => { const d = beamAt(e, t).dir; return Math.abs(Math.hypot(...d) - 1) < 1e-9 && d[1] > 0.75; })));
  check('searchlights: none for less motion', planSearchlights({ from: 0, to: 30, motion: false }).length === 0);
}

// ── the dress ─────────────────────────────────────────────────────────────────
{
  const d = buildDress(null);
  check('dress: bunting and pennants', (d.opaque.get('plain')?.n || 0) > 1000);
  check('dress: the logos on their own key', d.opaque.get('finalLogo')?.n === LOGOS.length * 6);
  check('dress: the trophy', d.trophy.n > 500);
}

// ── the graphics ──────────────────────────────────────────────────────────────
{
  const base = { score: { away: 'RAT', home: 'KIN', aScore: 3, hScore: 4, half: 'top', inning: 9, bases: [false, false, false], awayTeam: 'Rats', homeTeam: 'Kings' }, count: { balls: 1, strikes: 2, outs: 2 }, gold: true, final: { name: 'Curtain Call', seeds: { away: 2, home: 1 } } };
  const groups = (st) => new Set(layoutHud(st, 400, 300).marks.map((m) => m.g));
  const texts = (st) => layoutHud(st, 330, 160).marks.filter((m) => m.t === 'text');
  const g0 = groups(base);
  check('hud: the final under the count, and its banner', g0.has('final') && g0.has('banner'));
  check('hud: the seeds beside the clubs', layoutHud(base, 400, 300).marks.some((m) => m.g === 'score' && m.t === 'text' && m.s === '1'));
  const intro = { ...base, intro: { team: 'Rats', side: 'away', i: 3, n: 9, num: 27, name: 'Ray Pellicano' } };
  check('hud: a line-up card, and no banner under it', groups(intro).has('intro') && !groups(intro).has('banner'));
  const champ = { ...base, champ: { team: 'Kings', side: 'home', name: 'Curtain Call', score: 'Rats 3, Kings 4', mvp: { name: 'Mo Dunleavy', line: '3-4, HR, 2 RBI' } } };
  const cm = layoutHud(champ, 400, 300).marks;
  check('hud: the champions\' card with the most valuable player', cm.some((m) => m.g === 'champ' && /MVP/.test(m.s || '')));
  check('hud: every word at or over the floor, on the smallest screen', [base, intro, champ].every((st) => texts(st).every((m) => m.size >= TEXT_FLOOR - 1e-9)));
}

// ── the most valuable player ─────────────────────────────────────────────────
const abbr = (n) => String(n || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'TBD';
const ordinal = (n) => ['', '1st', '2nd', '3rd'][n] || `${n}th`;
const gameOf = (seed) => { const g = simGameV2({ away: 'Rats', home: 'Kings' }, null, sportsRng(seed * 2654435761 + 7), { seed }); return { g, order: gamedayPayloads(g, seed, { abbr, ordinal }).order }; };
{
  const { g, order } = gameOf(5);
  const winner = g.awayScore > g.homeScore ? 'Rats' : 'Kings', mvp = gameMvp(order, winner);
  check('mvp: one of the winners, with his line', !!mvp && mvp.team === winner && /^\d+-\d+/.test(mvp.line), JSON.stringify(mvp));
  check('mvp: none for nobody', gameMvp([], 'Rats') === null);
}

// ── the view ──────────────────────────────────────────────────────────────────
const rec = { finals: [], champ: false, fx: [] };
const renderer = () => ({
  kind: 'stub', lost: false, quality: { dpr: 1, tube: false }, casters: [],
  setCast() { return 0; }, setPose() {}, setBall() {}, render() { return true; }, setCrowd() {},
  markDirt() {}, resetDirt() {}, setHour() {}, setWeather() {}, setTime() {}, setBoard() {}, setVenue() { return null; }, pump() { return 0; }, pending: () => 0, dispose() {},
  setSpectacle(fx) { rec.fx = fx || []; },
  setFinal(f) { rec.finals.push(f ? f.name : null); }, setChampion(on) { rec.champ = !!on; },
});
{
  // a game whose last out is made in the field, so the champions pile on at the mound
  let game = null;
  for (let s = 1; s < 80 && !game; s++) {
    const G = gameOf(s), last = G.order[G.order.length - 1];
    if (!last.phase && !last.walkoff && last.out && (last.pitches || []).length) game = G;
  }
  check('view: a game that ends on an out in the field', !!game);
  if (game) {
    const { g, order } = game, winner = g.awayScore > g.homeScore ? 'Rats' : 'Kings';
    const lineups = { away: { team: 'Rats', pitcher: g.away.pitcher, lineup: g.away.lineup }, home: { team: 'Kings', pitcher: g.home.pitcher, lineup: g.home.lineup } };
    const first = { ...order[0], hold: 35000, season: { n: 4, phase: 'final', name: 'Curtain Call', seedAway: 2, seedHome: 1, lineups } };
    const last = { ...order[order.length - 1], hold: 35000, end: { winner, champion: true, name: 'Curtain Call', mvp: gameMvp(order, winner) } };
    const host = stub.makeHost(), v = createGrandstandView(host, { force: true, renderer });
    await v.ready();
    v.showIdle();
    v.apply(first);
    check('view: a final dresses the park, by its name', rec.finals.includes('Curtain Call'), JSON.stringify(rec.finals));
    check('view: its name and seeds go up', v.state.final?.name === 'Curtain Call' && v.state.final.seeds.home === 1);
    let cards = new Set(), table = false;
    for (let k = 0; k < 60 * 20; k++) { stub.runFrames(1, 1000 / 60); if (v.state.intro) cards.add(v.state.intro.name); if (v.state.tableRace) table = true; }
    check('view: the line-ups read a card a man before the first pitch', cards.size >= 9, String(cards.size));
    check('view: instead of the leaders\' table', !table);
    check('view: searchlights over the city meanwhile', (v.director?.fx || []).some((e) => e.kind === 'beam'));
    // the last out
    v.setCaption('The last out.', { held: true });
    v.apply(last);
    const D = v.director, W = v.world;
    for (let k = 0; k < 60 * 40 && !D.landed; k++) stub.runFrames(1, 1000 / 60);
    check('view: the last out lands', D.landed);
    const t0 = W.t;
    stub.runFrames(30, 1000 / 60);
    check('view: the moment holds still', Math.abs(W.t - t0) < 1e-6, (W.t - t0).toFixed(3));
    for (let k = 0; k < 60 * 3; k++) stub.runFrames(1, 1000 / 60);
    check('view: the champions are crowned on their card, with their most valuable player', v.state.champ?.team === winner && !!v.state.champ.mvp, JSON.stringify(v.state.champ));
    check('view: the trophy goes out', rec.champ);
    check('view: confetti and fireworks', (D.fx || []).some((e) => e.kind === 'confetti') && (D.fx || []).some((e) => e.kind === 'burst'));
    check('view: no replay and no dead time but the pile', !v.replayDue && !D.between && !!D.pile);
    const piled = D.pile?.gone.filter((x) => x.rest === 'celebrate_leap' || x.rest === 'pile_dive') || [];
    check('view: the champions pile on', piled.length >= 5, String(piled.length));
    check('view: the losers walk off', D.pile?.gone.some((x) => x.off));
    for (let k = 0; k < 60 * 25; k++) stub.runFrames(1, 1000 / 60);
    const centre = [MOUND[0], 0, MOUND[1] - 1.5];
    const near = piled.filter((x) => { const f = W.frame(x.slot); return f && Math.hypot(f.at[0] - centre[0], f.at[2] - centre[2]) < 14; });
    check('view: and they\'re heaped on the mound', near.length >= piled.length - 1, `${near.length} of ${piled.length}`);
    v.clear();
  }
}

// ── the viewer's pitch camera ─────────────────────────────────────────────────
// (not the final's, but the same view: director.js pitchCam) asked for the pitcher's side, an
// at-bat's pitches are shot from centre field and never from behind the plate
{
  const { createWorld } = await import(P + 'diamond/world.js');
  const { createDirector } = await import(P + 'diamond/director.js');
  const { castOf } = await import(P + 'diamond/cast.js');
  const { order } = gameOf(3);
  const p = order.find((x) => !x.phase && (x.pitches || []).length >= 3);
  const shotsFor = (cam) => {
    const W = createWorld(), shots = [];
    const D = createDirector(W, { emit: (n, d) => { if (n === 'shot') shots.push(d); }, pitchShot: () => cam });
    D.stage(p, castOf(p));
    for (let k = 0; k < 120 * 30 && !D.landed; k++) W.step(1 / 120);
    D.stop();
    return shots;
  };
  const cf = shotsFor('cf'), bat = shotsFor('bat');
  check('pitch camera: the pitcher\'s side shoots from centre field, never behind the plate', cf.includes('cf') && !cf.includes('bat'), cf.join(','));
  check('pitch camera: the batter\'s side as before', bat.includes('bat') && !bat.includes('cf'), bat.join(','));
}

console.log(`final smoke: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
