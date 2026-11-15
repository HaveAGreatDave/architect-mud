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
const { cupStars, CUP_NAME, mvpSaid } = await import('../../plugins/broadcast/sports/baseball-narrator.js');
const { cupAt, CUP_STAND, CUP_TABLE } = await import(P + 'diamond/ceremony.js');
const { TAPE, planCupShow, brightOf } = await import(P + 'diamond/spectacle.js');
const { TROPHY_AT, CUP_TABLE: MESH_TABLE, CUP_VERTS, cupInto, createBatch, STRIDE } = await import(P + 'gl/ballpark-mesh.js');

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
  check('dress: the table bare, for when it\'s lifted', d.table.n > 0 && d.table.n < d.trophy.n);
  // the ceremony's table is the mesh's (diamond/ceremony.js keeps its own copy, to stay off the mesh module)
  check('cup: the ceremony stands where the mesh puts the table', CUP_STAND.every((v, i) => v === TROPHY_AT[i]) && CUP_TABLE === MESH_TABLE);
  const b = createBatch(CUP_VERTS);
  cupInto(b, [3, 6, 4], [0.3, 1, 0], 1.2);
  let finite = true;
  for (let i = 0; i < b.n * STRIDE; i++) if (!Number.isFinite(b.data[i])) finite = false;
  check('cup: built anywhere, every float finite, its own size', b.n === CUP_VERTS && finite, String(b.n));
}
// the Cup's show and the booth's words for a man's night
{
  const fx = planCupShow({ t: 0, hoists: [5, 18], until: 60, colours: [[0.02, 0.04, 0.3], [0.9, 0.7, 0.05]], seed: 3 });
  const tape = fx.filter((e) => e.kind === 'tape');
  check('cup show: a shower of tape a hoist', tape.length === TAPE.spots.length * 2);
  check('cup show: the tape in the club\'s colours, a navy burning blue', tape.every((e) => Math.max(...e.colour) > 0.99) && tape.some((e) => e.colour[2] > 0.99 && e.colour[0] < 0.2));
  let low = Infinity, ok = true;
  for (const e of tape) for (let i = 0; i < 96; i++) for (let t = e.t; t < endOf(e); t += 0.7) { const q = particleAt(e, i, t); if (q) { if (!q.at.every(Number.isFinite)) ok = false; low = Math.min(low, q.at[1]); } }
  check('cup show: every strip finite and none through the grass', ok && low >= 0.1 - 1e-9, String(low));
  check('cup show: none for less motion', planCupShow({ t: 0, hoists: [5], motion: false }).length === 0);
  check('cup show: black burns white', brightOf([0.01, 0.01, 0.01]).every((v) => v === 1));
  check('booth: a man\'s night in words', mvpSaid('2-4, HR, 3 RBI') === '2 for 4, a home run, 3 runs batted in' && mvpSaid('1-3, 2 HR, 1 RBI') === '1 for 3, 2 home runs, 1 run batted in');
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
  setCup(c) { (rec.cups ||= []).push(c); },
});
const flatTo = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
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
    // the season rides the game's first payload, the fly-in ('arrive'), as the server sends it, and
    // the top of the first after it has none of its own
    const season = { n: 4, phase: 'final', name: 'Curtain Call', seedAway: 2, seedHome: 1, lineups };
    const arrive = { sport: 'baseball', phase: 'arrive', venue: 'the Coliseum', away: 'Rats', home: 'Kings', final: 'Curtain Call', season };
    const first = { ...order[0], hold: 35000 };
    const last = { ...order[order.length - 1], hold: 80000, end: { winner, champion: true, name: 'Curtain Call', mvp: gameMvp(order, winner) } };
    const host = stub.makeHost(), v = createGrandstandView(host, { force: true, renderer });
    await v.ready();
    v.showIdle();
    v.apply(arrive);
    stub.runFrames(1, 1000 / 60);
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
    // (the pile itself: the men planPile sent, not the bench who join it or their places in the mob after)
    const piled = D.pile?.gone.filter((x) => (x.rest === 'celebrate_leap' || x.rest === 'pile_dive') && !x.mob && !x.joined) || [];
    check('view: the champions pile on', piled.length >= 5, String(piled.length));
    check('view: the losers walk off', D.pile?.gone.some((x) => x.off));
    // the heap, just before it gets up (planMob), or 25 s on with no room for the mob
    const heapAt = D.pile?.mob ? D.pile.mob.rise - 0.2 : W.t + 25;
    while (W.t < heapAt) stub.runFrames(1, 1000 / 60);
    const centre = [MOUND[0], 0, MOUND[1] - 1.5];
    const near = piled.filter((x) => { const f = W.frame(x.slot); return f && Math.hypot(f.at[0] - centre[0], f.at[2] - centre[2]) < 14; });
    check('view: and they\'re heaped on the mound', near.length >= piled.length - 1, `${near.length} of ${piled.length}`);
    // the mob: the pile up, the bench out, hands slapped, one mass bouncing, the cameras moving
    const mob = D.pile?.mob;
    check('mob: the pile gets up and the bench comes out', !!mob && mob.rise > D.pile.from && D.pile.gone.some((x) => x.joined), JSON.stringify(mob && { rise: mob.rise, from: D.pile.from }));
    check('mob: they slap hands round each other', (mob?.fives.length || 0) >= 4, String(mob?.fives.length));
    check('mob: then they\'re one mass', D.pile.gone.filter((x) => x.mob).length >= 8 && Number.isFinite(mob?.mobAt));
    check('mob: the cameras move round it', (D.pile.shots || []).filter((x) => x.shot && typeof x.shot === 'object' && x.shot.shot === 'party').length >= 3);
    const shellCols = (D.fx || []).filter((e) => e.kind === 'burst').map((e) => e.colour.join(','));
    check('mob: the shells go on till the Cup, in the champions\' colours', (D.fx || []).filter((e) => e.kind === 'burst').some((e) => e.t > mob.mobAt) && new Set(shellCols).size <= 4, String(new Set(shellCols).size));
    const settled = Math.max(...D.pile.gone.filter((x) => x.mob).map((x) => x.end)) + 0.8;
    while (W.t < settled) stub.runFrames(1, 1000 / 60);
    const mass = D.pile.gone.filter((x) => x.mob).filter((x) => { const f = W.frame(x.slot); return f && Math.hypot(f.at[0] - mob.centre[0], f.at[2] - mob.centre[2]) < 7; });
    check('mob: bouncing together round the middle', mass.length >= D.pile.gone.filter((x) => x.mob).length - 1 && mass.every((x) => ['celebrate_leap', 'celebrate_pump'].includes(W.bodies.get(x.slot)?.clip?.id)), `${mass.length}`);
    check('mob: the pitch is off the graphics', !v.state.pitch);
    // the Cup
    const W0 = winner === 'Rats' ? g.away : g.home, top = W0 === g.away, mvp = gameMvp(order, winner);
    const stars = cupStars(order, winner, W0, mvp);
    const crown = { sport: 'baseball', phase: 'crown', cup: CUP_NAME, final: 'Curtain Call', winner, loser: top ? 'Kings' : 'Rats', away: 'Rats', home: 'Kings', awayScore: g.awayScore, homeScore: g.homeScore,
      half: top ? 'bottom' : 'top', fieldingTeam: winner, battingTeam: top ? 'Kings' : 'Rats', inning: g.innings, pitcher: W0.pitcher, stars, mvp, hold: 70000 };
    rec.cups = [];
    v.apply(crown);
    const C = D.crown;
    check('cup: twelve champions in their kit round the table', !!C && W.bodies.size === 12 && C.bodies.every((B) => flatTo(B.base.at, CUP_STAND) < 12), String(W.bodies.size));
    check('cup: every star lifts it', C?.hoists.length === stars.length && stars.length >= 2, `${C?.hoists.length} of ${stars.length}`);
    check('cup: ticker tape in their colours and their shells', (D.fx || []).filter((e) => e.kind === 'tape').length >= TAPE.spots.length * stars.length && (D.fx || []).some((e) => e.kind === 'burst'));
    const pose = (s, t) => W.pose(s, t);
    const T0 = W.t;
    let onTable = 0, up = 0, high = 0, between = null;
    while (W.t < T0 + 50) {
      stub.runFrames(1, 1000 / 60);
      const c = cupAt(C.holders, W.t, pose);
      if (!c) onTable++;
      else { up++; if (c.base[1] > 5) high++; if (!c.base.every(Number.isFinite)) between = 'not finite'; }
      if (C.holders[1] && W.t > C.holders[0].release + 0.3 && W.t < C.holders[1].grab - 0.3 && c) between = 'held between stars';
    }
    check('cup: on its table till a man lifts it, and between them', onTable > 60 && between == null, String(between));
    check('cup: up over their heads', high > up * 0.6, `${high} of ${up}`);
    check('cup: the renderer has it in hand', rec.cups.some((c) => c && c.base) && rec.cups.some((c) => c === null));
    check('cup: the last man keeps it up', !!cupAt(C.holders, W.t, pose));
    check('cup: the cameras go round it', (C.shots || []).filter((x) => typeof x.shot === 'object').length >= 4);
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
