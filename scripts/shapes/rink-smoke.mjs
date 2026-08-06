// Rink smoke — runs the CPhL sub-screen headlessly and fails if it throws.
//
// The rink view is the only part of the hockey pipeline with no server to test it: the
// one thing that ever exercised it was a player having a hockey broadcast on screen at
// the moment a beat landed. This drives `apply()` through every beat type the sim can
// emit, spins the rAF loop for a few hundred frames, and asserts that ten men, a puck
// and two goalies actually ended up somewhere on the sheet.
//
// It proves the view RUNS and that its motion converges — not that it looks right.
// There is no pixel comparison here and there is not meant to be one.
//
// Run:  node scripts/shapes/rink-smoke.mjs

import { __install } from './rink-dom-stub.mjs';

// The DOM has to exist before the module under test is even parsed, so the import is
// deliberately dynamic and deliberately after `__install()`.
const stub = __install();
const { createRinkView, __test } = await import('../../client/game/js/panels/gameday-rink.js');
const { GEO, DOTS, SAVE } = __test;

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};

// ── a beat, shaped exactly like plugins/broadcast/sports/hockey-narrator.js builds one
function beat(kind, over) {
  const shot = kind === 'goal' || SAVE[kind];
  return {
    sport: 'hockey', type: kind === 'goal' ? 'goal' : 'chance', kind,
    shooter: 'Asbestos McQuaid', goalie: 'Renna Voss', assist: 'Ibarra',
    attackingTeam: 'Slaglands Slashers', defendingTeam: 'Wastes Drifters',
    attackingAbbr: 'SS', defendingAbbr: 'WD',
    awayTeam: 'Slaglands Slashers', homeTeam: 'Wastes Drifters', awayAbbr: 'SS', homeAbbr: 'WD',
    awayColours: ['#c8a13a', '#2a1d05'], homeColours: ['#7fb2dd', '#10283f'],
    attackingColours: ['#c8a13a', '#2a1d05'], defendingColours: ['#7fb2dd', '#10283f'],
    section: '2nd', clock: '12:41', clockSecs: 761, strength: 'even',
    awayScore: 3, homeScore: 3, desc: 'a chance', hornSeed: 7, rivalry: false,
    possession: shot ? [
      { t: 0, p: [0.30, 0.50], ev: 'carry', carrier: 3 },
      { t: 1, p: [0.52, 0.24], ev: 'pass', carrier: 1 },
      { t: 2, p: [0.74, 0.38], ev: 'entry', carrier: 1 },
      { t: 3, p: [0.955, 0.46], ev: 'shot', carrier: 0 },
    ] : null,
    ...over,
  };
}

const host = stub.makeHost();
const view = createRinkView(host);

// ── every beat type the sim emits ───────────────────────────────────────────────
const KINDS = [...Object.keys(SAVE)];
for (const kind of KINDS) {
  try {
    view.apply(beat(kind));
    stub.runFrames(240);          // ~4s of play at 60fps
    stub.runTimers(6000);
  } catch (e) {
    check(`beat "${kind}" plays without throwing`, false, e && e.stack ? e.stack.split('\n')[0] : String(e));
    continue;
  }
  check(`beat "${kind}" plays without throwing`, true);
}

// ── the non-shot beats ──────────────────────────────────────────────────────────
for (const dot of Object.keys(DOTS)) {
  try {
    view.apply(beat('save', { type: 'faceoff', kind: 'faceoff', possession: null, dot, winnerSide: 'att', winner: 'Duguay', loser: 'Ibarra' }));
    stub.runFrames(120); stub.runTimers(4000);
    check(`faceoff at "${dot}" plays`, true);
  } catch (e) { check(`faceoff at "${dot}" plays`, false, String(e && e.message)); }
}
try {
  view.apply(beat('save', { type: 'fight', kind: 'fight', possession: null, winnerSide: 'att', winner: 'Duguay', loser: 'Ibarra',
    exchange: [{ thrower: 'Duguay', landed: true }, { thrower: 'Ibarra', landed: false }, { thrower: 'Duguay', landed: true }] }));
  stub.runFrames(180); stub.runTimers(5000);
  check('a fight plays', true);
} catch (e) { check('a fight plays', false, String(e && e.message)); }

// ── the violence ────────────────────────────────────────────────────────────────
// These four used to reach the rink as nothing at all: the announcer described a man
// going through the glass and the ice held its last frame. Each has to actually put a
// body somewhere now, so each is checked for its own visible consequence and not just
// for failing to throw.
const VIOLENT = [
  { type: 'boards', over: { hitter: 'Duguay', victim: 'McQuaid', hitterTeam: 'Slaglands Slashers', victimTeam: 'Wastes Drifters', hitterSide: 'att', victimSide: 'def' }, cls: 'down', at: 700 },
  { type: 'injury', over: { victim: 'McQuaid', victimTeam: 'Wastes Drifters', victimSide: 'def', slotsOut: 3 }, cls: 'leaving', at: 2000 },
  { type: 'death',  over: { victim: 'McQuaid', victimTeam: 'Wastes Drifters', victimSide: 'def' }, cls: 'dead', at: 900 },
  { type: 'scrum',  over: {}, cls: 'shoving', at: 700 },
];
for (const v of VIOLENT) {
  try {
    view.apply(beat('save', { type: v.type, kind: v.type, possession: null, ...v.over }));
    stub.runFrames(Math.round(v.at / 16.7));
    const hit = host.findAll('.gdr-skater').filter(s => s.classList.contains(v.cls));
    check(`a ${v.type} puts a body on the ice`, hit.length > 0, `no .${v.cls} skater`);
    stub.runFrames(240); stub.runTimers(9000);
  } catch (e) {
    check(`a ${v.type} puts a body on the ice`, false, e && e.stack ? e.stack.split('\n')[0] : String(e));
  }
}
// A death stops the rink, and the stopping is the point — if the sheet isn't marked
// as mourning, the picture kept playing hockey over a corpse.
view.apply(beat('save', { type: 'death', kind: 'death', possession: null, victim: 'McQuaid', victimTeam: 'Wastes Drifters', victimSide: 'def' }));
stub.runFrames(90);
check('a death stops the rink', host.find('.gdr-rink').classList.contains('mourning'));
check('…and leaves a mark on the ice', host.findAll('.gdr-blood').length === 1, `${host.findAll('.gdr-blood').length} pools`);
// The man who died must not be wandering. Two frames apart, he has not moved.
{
  const dead = host.findAll('.gdr-skater').find(s => s.classList.contains('dead'));
  const p0 = dead && `${dead.style.left}|${dead.style.top}`;
  stub.runFrames(200);
  const p1 = dead && `${dead.style.left}|${dead.style.top}`;
  check('the dead man stays where he fell', !!dead && p0 === p1, `${p0} → ${p1}`);
}

try {
  view.apply({ sport: 'hockey', type: 'intermission', section: '1st', awayAbbr: 'SS', homeAbbr: 'WD', awayScore: 3, homeScore: 3,
    goals: [{ clockStr: '9:38', shooter: 'Duguay', assist: 'Ibarra', teamName: 'Slaglands Slashers', strength: 'even' }],
    shotsAway: 14, shotsHome: 9, penalties: 1, fights: 0, hits: 3, nextOrd: '2nd',
    standings: [{ team: 'Slaglands Slashers', points: 8 }, { team: 'Wastes Drifters', points: 6 }] });
  stub.runTimers(3000);
  check('the intermission board renders', true);
} catch (e) { check('the intermission board renders', false, String(e && e.message)); }

// ── the ice is populated and everybody is ON it ─────────────────────────────────
view.apply(beat('goal'));
stub.runFrames(300);
const sheet = host.find('.gdr-sheet');
check('the sheet exists', !!sheet);
const skaters = host.findAll('.gdr-skater');
check('ten skaters take the ice', skaters.length === 10, `${skaters.length} men`);
check('both goalies dress', host.findAll('.gdr-goalie').length === 2);
check('there is exactly one puck', host.findAll('.gdr-puck').length === 1);
check('every skater wears a number and a position',
  host.findAll('.gdr-sk-tag').length === 10 && host.findAll('.gdr-sk-tag').every(t => /^\d+(C|LW|RW|LD|RD)$/.test(t.textContent)),
  host.findAll('.gdr-sk-tag').map(t => t.textContent).join(','));

const frac = (v) => parseFloat(String(v));
const onIce = (el) => {
  const l = frac(el.style.left), t = frac(el.style.top);
  return Number.isFinite(l) && Number.isFinite(t) && l >= -1 && l <= 101 && t >= -1 && t <= 101;
};
check('every skater is inside the boards', skaters.every(onIce),
  skaters.map(s => `${s.style.left}/${s.style.top}`).join(' '));
check('the puck is on the sheet', onIce(host.find('.gdr-puck')), `${host.find('.gdr-puck').style.left}/${host.find('.gdr-puck').style.top}`);
check('the camera moved to follow it', /translate3d/.test(host.find('.gdr-cam').style.transform || ''), host.find('.gdr-cam').style.transform);

// Two men in the same place for three hundred frames means the formation collapsed.
const spread = new Set(skaters.map(s => `${frac(s.style.left).toFixed(0)}:${frac(s.style.top).toFixed(0)}`));
check('the men hold a formation rather than stacking up', spread.size >= 7, `${spread.size} distinct positions`);

// ── the ice keeps moving between beats ──────────────────────────────────────────
// The whole point of the rAF loop: with no new payload at all, the puck must still be
// somewhere else a few seconds later. A frozen puck here is the old bug returning.
const before = `${host.find('.gdr-puck').style.left}|${host.find('.gdr-puck').style.top}`;
stub.runFrames(600);
const after = `${host.find('.gdr-puck').style.left}|${host.find('.gdr-puck').style.top}`;
check('the puck keeps circulating with no new beat', before !== after, `${before} → ${after}`);

// ── geometry ────────────────────────────────────────────────────────────────────
// The sheet is drawn at its real proportions, so a faceoff circle is a circle. If the
// viewBox and the CSS aspect-ratio ever disagree, every circle on the ice becomes an
// egg and nothing else in the suite would notice.
check('the sheet keeps the real 85:200', __test.SHEET_W === 85 && __test.SHEET_L === 200,
  `${__test.SHEET_W}x${__test.SHEET_L}`);
check('the away end projects to the top of the picture', __test.sy(GEO.goalLine[0]) < __test.sy(GEO.goalLine[1]));
check('the projection spans the full sheet width', __test.sx(0) === 85 && __test.sx(1) === 0);
const svg = __test.rinkSvg();
check('the markings carry the sheet viewBox', svg.includes('viewBox="0 0 85 200"'), svg.slice(0, 80));
check('every faceoff dot is drawn', Object.keys(DOTS).every(d => svg.includes(`data-dot="${d}"`)));
check('both cages are drawn', svg.includes('data-side="l"') && svg.includes('data-side="r"'));

view.clear();
check('clear() empties the host', host.innerHTML === '');

console.log(failures ? `\n${failures} failure(s)` : '\nrink smoke: all clear');
process.exit(failures ? 1 : 0);
