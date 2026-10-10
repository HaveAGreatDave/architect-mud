// Rink smoke: plays real CPhL games through the Rinkside view headlessly and fails if a
// beat throws, stalls, or stages the wrong outcome.
//
// The rink is the only part of the hockey pipeline with no server to test it. So this
// runs the actual sim and the actual narrator for two fixed games, feeds every payload
// they produce to the view the way tv.js does, steps the world, renders now and then into
// a stub canvas, and checks that what happened on the ice agrees with what was said:
// every goal goes into the net and no save does, the faceoff is taken on the right dot,
// the fight's loser ends with nothing left, a man carried off is gone, a death stops the
// building, the Zamboni lays fresh ice.
//
// It proves the view RUNS and that its outcomes match the sim's. It does not look at
// pixels and is not meant to.
//
// Run:  node scripts/shapes/rink-smoke.mjs

import fs from 'fs';
import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const { createRinkView, __test } = await import('../../client/game/js/panels/gameday-rink.js');
const { DT } = await import('../../client/game/js/panels/rink/rig.js');
const { GOAL_X, DOT_FT } = await import('../../client/game/js/panels/rink/geo.js');
const { sportsRng, sportsHash, sportsPick, sportsFill } = await import('../../plugins/broadcast/rng.js');
const HOCKEY = (await import('../../plugins/broadcast/sports/hockey.js')).default;
const { paceCalls } = await import('../../plugins/broadcast/sports/hockey-pacing.js');

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

function gameLines(slot) {
  const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
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
// Slot 206 has eight goals, five fights, a severed arm and a death in overtime; slot 25
// has a pulled goalie. Between them every beat type the sim emits is staged.
const seen = new Set();
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
  let lastFight = null, tApply = 0, landedAt = null, grabAt = null, boxAt = null;
  const run = (secs, until) => {
    const t0 = W.t; let next = W.t;
    while (W.t - t0 < secs) {
      W.step(DT);
      if (W.fight) lastFight = W.fight;
      if (landedAt == null && D.state.beat && D.state.beat.landed) landedAt = W.t - tApply;
      if (grabAt == null && D.state.beat && D.state.beat.grab) grabAt = W.t - tApply;
      if (boxAt == null && D.state.beat && D.state.beat.toBox) boxAt = W.t - tApply;
      if (W.t >= next) { next = W.t + 2.5; view.renderer.render(W.t * 1000); renders++; }
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
    if (!g) { run(0.4); continue; }
    seen.add(g.type);
    const label = `${slot}: ${g.type}${g.kind && g.kind !== g.type ? `/${g.kind}` : ''} at ${g.section} ${g.clock}`;
    let ok = true;
    tApply = W.t; landedAt = null; grabAt = null; boxAt = null;
    try { view.apply(g); } catch (e) { check(`${label} stages`, false, e.stack.split('\n').slice(0, 2).join(' ')); ok = false; }
    if (!ok) continue;
    const before = { inNet: W.puck.inNet, goals: goalsIn, on: { a: W.mates('a').length, h: W.mates('h').length }, broken: W.broken.size };
    if (g.type === 'faceoff') {
      // the draw is taken on the named dot, by the two men the sim named
      const [dx, dy] = DOT_FT[g.dot];
      run(1.3);
      const c = W.skaters().filter((m) => Math.hypot(m.x - dx, m.y - dy) < 3.2);
      check(`${label}: two centres on the dot`, c.length === 2, `${c.length} men`);
      check(`${label}: the winner wears his name`, c.some((m) => m.name === String(g.winner).split(' ').pop()));
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
    const limit = Math.max({ injury: 22, death: 16, fight: 16, intermission: 3 }[g.type] || 14, lastCue + 10);
    run(limit, () => !D.busy());
    // a draw and a hit land when their line airs
    const cueT = (ev) => { const c = (g.cues || []).find((q) => q.ev === ev); return c ? c.ms / 1000 : null; };
    // with a drop line the puck goes down on it and the win line confirms it; without one
    // the draw is won as the win line airs
    if (g.type === 'faceoff' && cueT('drop') != null) check(`${label}: the puck drops as it is called`, landedAt != null && landedAt >= cueT('drop') && landedAt <= (cueT('won') ?? cueT('drop') + 2) + 0.3, `won at ${landedAt?.toFixed(2)}s, drop line ${cueT('drop')}s, win line ${cueT('won')}s`);
    else if (g.type === 'faceoff' && cueT('won') != null) check(`${label}: the draw is won as it is called`, landedAt != null && Math.abs(landedAt - cueT('won')) < 0.8, `won at ${landedAt?.toFixed(2)}s, line at ${cueT('won')}s`);
    if (g.type === 'fight' && cueT('grab') != null) {
      const p0 = (g.cues || []).find((q) => q.ev === 'punch');
      check(`${label}: they grab on before the first punch`, grabAt != null && (!p0 || grabAt <= p0.ms / 1000 + 0.2), `grab ${grabAt?.toFixed(2)}s, line ${cueT('grab')}s`);
    }
    if (g.type === 'fight' && cueT('box') != null) check(`${label}: they go to the box as they're sent`, boxAt != null && boxAt >= cueT('box') && boxAt <= cueT('box') + 1.2, `box ${boxAt?.toFixed(2)}s, line ${cueT('box')}s`);
    if (g.type === 'boards' && cueT('impact') != null ) check(`${label}: the hit lands as it is called`, landedAt != null && Math.abs(landedAt - cueT('impact')) < 0.9, `hit at ${landedAt?.toFixed(2)}s, line at ${cueT('impact')}s`);
    if ((g.type === 'chance' || g.type === 'goal') && cueT('out') != null && g.kind !== 'breakaway') check(`${label}: the puck arrives as the outcome is called`, landedAt != null && landedAt > cueT('shot') && Math.abs(landedAt - cueT('out')) < (g.type === 'goal' ? 2.4 : 1.2), `${g.shotType}: landed ${landedAt?.toFixed(2)}s, outcome line ${cueT('out')}s`);
    check(`${label} resolves`, !D.busy() || g.type === 'intermission', `still ${D.kind()} after ${limit}s`);
    if (g.type === 'goal') check(`${label}: it goes in`, goalsIn > before.goals && !!W.puck.inNet, `inNet=${W.puck.inNet}`);
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
      run(8);
      check(`${label}: the Zamboni is out`, !!W.zamboni && resurfaced.n > 50, `${resurfaced.n} passes`);
      check(`${label}: the ice is wet behind it`, W.ice.wetness > 0.5);
    }
    if (g.type === 'faceoff' && g.reason === 'period') check(`${label}: a fresh sheet and no Zamboni`, !W.zamboni && W.ice.wear < 0.05);
    // ten men dressed, whatever has happened (unless a goalie is pulled or a man is short)
    const n = W.mates('a').length + W.mates('h').length;
    check(`${label}: skaters on the ice`, n >= 8 && n <= 12 || g.type === 'intermission', `${n}`);
  }
  check(`${slot}: no position ever went non-finite`, nan === 0, `${nan}`);
  check(`${slot}: the renderer drew`, renders > 100 && stub.drawn.images > 1000, `${renders} frames, ${stub.drawn.images} images`);
  check(`${slot}: the held caption went up`, String(host.find('.gdr-cap-text')?.textContent || '').length > 0);
  check(`${slot}: sounds played`, stub.sounds.length > 20, `${stub.sounds.length}`);
  view.clear();
  check(`${slot}: clear empties the host`, host.children.length === 0);
}

await play(206);
await play(25);
for (const t of ['faceoff', 'chance', 'goal', 'boards', 'fight', 'scrum', 'injury', 'death', 'pull', 'intermission']) {
  check(`a "${t}" was staged`, seen.has(t), [...seen].join(','));
}
for (const k of ['save', 'glove', 'pad', 'blocked', 'wide', 'post', 'breakaway', 'goal']) check(`SAVE has "${k}"`, !!__test.SAVE[k]);
check('GEO puts the goal lines where geo.js does', Math.abs(__test.GEO.goalLine[1] * 200 - GOAL_X[1]) < 1e-9);

console.log(`rink smoke: ${passes}/${passes + failures} passed`);
if (failures) process.exit(1);
