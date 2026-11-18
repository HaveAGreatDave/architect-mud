// Rink on air: one CPhL game at the newest sim version through the Rinkside view, timed as
// it airs.
//
// rink-smoke.mjs runs each play to the end before the booth's lines for it, which gives the
// between-plays game the length of those lines again between one play and the next. On air
// a payload lands as its line airs and the next one comes as its own line does, a couple of
// seconds after a play. This runs every line for its hold and applies each payload as its
// line comes, and checks what only shows that way:
// - every shot lands as its outcome is called (2.4 s for a goal, 1.2 s otherwise), and no
//   play is replaced by the next before it lands;
// - a putback (the sim's next play after a save, pad or post that leaves a rebound) finds the
//   puck still round the net, not cleared up the ice (director.js `holdRebound`).
//
// Sim v8 games carry rebounds; the smoke's v1 and v5 games don't. Run:
//   node scripts/shapes/rink-onair.mjs [slot]

import fs from 'fs';
import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const { createRinkView } = await import('../../client/game/js/panels/gameday-rink.js');
const { DT } = await import('../../client/game/js/panels/rink/rig.js');
const { GOAL_X, MID_Y } = await import('../../client/game/js/panels/rink/geo.js');
const { sportsRng, sportsHash, sportsPick, sportsFill } = await import('../../plugins/broadcast/rng.js');
const HOCKEY = (await import('../../plugins/broadcast/sports/hockey.js')).default;
const { paceCalls } = await import('../../plugins/broadcast/sports/hockey-pacing.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};

const SLOT = Number(process.argv[2] || 37), VERSION = 8;
const src = fs.readFileSync(new URL('../../data/scripts/hockey.bsm', import.meta.url), 'utf8');
const block = (k) => (src.split(`::${k}`)[1]?.split(`::end${k}`)[0] || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).map((s) => s.replace(/"/g, ''));
const pools = {};
{ let key = null; for (const raw of src.split(/\r?\n/)) { const l = raw.trim(); if (l.startsWith('::lines ')) { key = l.slice(8).trim(); pools[key] = []; continue; } if (l.startsWith('::')) { key = null; continue; } if (key && l && !l.startsWith('#')) pools[key].push(l); } }
const teams = block('teams'), players = block('players');
const clubs = JSON.parse(fs.readFileSync(new URL('../../content/media_broadcasts/bc_cluster_puck.json', import.meta.url), 'utf8')).sports_pools?.clubs || null;
const { setClubs } = await import('../../client/game/js/panels/club-crest.js');
if (clubs) setClubs('hockey', 'onair', clubs);

const matchup = { away: teams[SLOT % teams.length], home: teams[(SLOT * 7 + 5) % teams.length], teams, clubs };
const seed = sportsHash(SLOT, 0);
const game = HOCKEY.simGame(matchup, players, sportsRng(seed), { version: VERSION });
const nrng = sportsRng(seed ^ 0x9e3779b9);
const said = [];
HOCKEY.narrate({
  script: {}, game, gs: { seed, game }, slot: SLOT, ws: false, announcer: 'Tug Brennan', pools, nrng, sport: HOCKEY, add: () => {},
  say: (line, tok, sb, fx, gd, meta) => { if (line) said.push({ text: sportsFill(line, tok).trim(), graphic: fx || null, gameday: gd || null, _cue: meta && meta.cue, _opt: (meta && meta.opt) || false }); },
  pick: (...keys) => sportsPick(pools, nrng, ...keys),
  abbr: (n) => String(n).slice(0, 3).toUpperCase(), recordOf: () => '8-4-1', lastId: () => null,
});
const { holds, gaps, dropped } = paceCalls(said, 3600 * 1000 * 0.85, 1000, { spareMs: 480000 });
const lines = said.filter((l) => !dropped.has(l)).map((l) => ({ text: l.text, gd: l.gameday, hold: holds.get(l) + (gaps.get(l) || 0) }));

const host = stub.makeHost();
const view = createRinkView(host);
await view.ready();
view.showIdle();
const W = view.world, D = view.director;

const late = [], unlanded = [], strayed = [];
let shots = 0, putbacks = 0, cur = null, rebound = false;
const settle = () => {
  if (!cur) return;
  const { g } = cur, tol = g.type === 'goal' ? 2.4 : 1.2, label = `${g.type}/${g.kind} at ${g.section} ${g.clock}`;
  shots++;
  if (cur.landedAt == null) unlanded.push(label);
  else if (Math.abs(cur.landedAt - cur.out) >= tol) late.push(`${label}: landed ${cur.landedAt.toFixed(2)}s, outcome line ${cur.out}s`);
  cur = null;
};
const run = (secs) => {
  const t0 = W.t;
  while (W.t - t0 < secs) {
    W.step(DT);
    if (cur && !cur.B && D.state.beat && D.state.beat !== cur.prevB) cur.B = D.state.beat;
    if (cur && cur.landedAt == null && cur.B && cur.B.landed) cur.landedAt = W.t - cur.t0;
    stub.runTimers(0);
  }
};
for (const l of lines) {
  const g = l.gd;
  view.setCaption(l.text, { held: !!g });
  if (g) {
    settle();
    // (the putback: where's the puck, against the net it's going at?)
    if (rebound && (g.type === 'chance' || g.type === 'goal')) {
      putbacks++;
      const netX = g.attackingTeam === g.awayTeam ? GOAL_X[1] : GOAL_X[0], d = Math.hypot(W.puck.x - netX, W.puck.y - MID_Y);
      if (d > 40) strayed.push(`${g.type}/${g.kind} at ${g.section} ${g.clock}: the puck ${d.toFixed(0)} ft from the net`);
    }
    rebound = !!g.reboundNext;
    const prevB = D.state.beat;
    try { view.apply(g); } catch (e) { check(`${g.type} at ${g.section} ${g.clock} stages`, false, e.stack.split('\n').slice(0, 2).join(' ')); }
    const out = (g.cues || []).find((q) => q.ev === 'out');
    if ((g.type === 'chance' || g.type === 'goal') && out) cur = { g, t0: W.t, out: out.ms / 1000, prevB, B: D.state.beat !== prevB ? D.state.beat : null, landedAt: null };
  }
  run((l.hold || 400) / 1000);
}
settle();

check(`${SLOT}: the game has shots and putbacks to check`, shots > 50 && putbacks > 3, `${shots} shots, ${putbacks} putbacks`);
check(`${SLOT}: every shot lands as its outcome is called, on air`, late.length === 0, `${late.length}: ${late.slice(0, 4).join('; ')}`);
check(`${SLOT}: no play is replaced before it lands`, unlanded.length === 0, `${unlanded.length}: ${unlanded.slice(0, 4).join('; ')}`);
check(`${SLOT}: a putback finds the puck still round the net`, strayed.length === 0, `${strayed.length} of ${putbacks}: ${strayed.slice(0, 4).join('; ')}`);
console.log(`rink on air: ${passes}/${passes + failures} passed (${shots} shots, ${putbacks} putbacks)`);
process.exit(failures ? 1 : 0);
