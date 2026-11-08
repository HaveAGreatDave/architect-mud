// THE FIGHT, PLAYED BY A SIMULATED ANGLER.
//
//   node scripts/fish/fight-sim.mjs            the bounds only, silent on a pass (the gate)
//   node scripts/fish/fight-sim.mjs --table    the table: win rate by species and skill
//
// Every number in client/shared/boatfish-rules.js's fight is a balance against every other, and a
// player can't tell you a sturgeon got easy until somebody's caught forty. So this plays the real
// stepFight with an angler who reads the same things the HUD shows, a beat late, and sometimes
// doesn't read them at all. Three anglers:
//
//   good    reacts in 240 ms and makes few mistakes
//   casual  reacts in 420 ms, and one tell in five goes past him
//   idle    holds the reel down and leans the right way, and reads nothing else
//
// The bounds say what has to stay true. A small fish is a small fish, a big one is a real fight, and
// holding one key down never beats a fish worth having.

import { fightBoard, fightState, stepFight } from '../../client/shared/boatfish-rules.js';
import { SPECIES } from '../../client/shared/fish.js';

const GATE = !process.argv.includes('--table');
const DT = 1 / 60;

// A seeded 0..1 source, so the table is the same every run.
function rng(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const ANGLERS = {
  good: { react: 240, miss: 0.05, reads: true },
  casual: { react: 420, miss: 0.2, reads: true },
  idle: { react: 300, miss: 0, reads: false },
};

function play(sp, skill, A, seed) {
  const r = rng(seed);
  const kg = sp.kg[0] + (sp.kg[1] - sp.kg[0]) * (0.5 + r() * 0.8);
  const set = A.reads ? 0.45 + r() * 0.5 : 0.5;
  const lineM = 14 + r() * 10;
  const b = fightBoard({ kg, difficulty: sp.difficulty, fight: sp.fight, skill, lineM, set });
  const F = fightState(b, r);
  // What the angler has noticed, which lags what the fish is doing.
  let seenSide = F.side, seenMode = 'pull', sideAt = 0, modeAt = 0, nowMs = 0, ignore = false;
  for (let i = 0; i < 60 * 300; i++) {
    nowMs += DT * 1000;
    if (F.side !== seenSide && !sideAt) sideAt = nowMs + A.react * (0.8 + 0.4 * r());
    if (sideAt && nowMs >= sideAt) { seenSide = F.side; sideAt = 0; }
    if (F.mode !== seenMode && !modeAt) { modeAt = nowMs + A.react * (0.8 + 0.4 * r()); ignore = r() < A.miss; }
    if (modeAt && nowMs >= modeAt) { seenMode = ignore ? 'pull' : F.mode; modeAt = 0; }
    let lean = -seenSide, wind = true;
    if (A.reads) {
      if (seenMode === 'run') wind = false;
      if (seenMode === 'jump') { lean = 0; wind = false; }
      if (seenMode === 'charge') lean = 0;
      // Ease off the reel when the line's getting hot, as the gauge tells you to.
      if (F.tension > 0.86) wind = false;
    }
    const end = stepFight(F, b, { lean, wind }, DT, r);
    if (end) return { end, secs: nowMs / 1000 };
  }
  return { end: 'timeout', secs: 300 };
}

const N = GATE ? 120 : 300;
function rate(id, skill, angler) {
  const sp = SPECIES[id], A = ANGLERS[angler];
  let won = 0, secs = 0, snap = 0, thrown = 0;
  for (let i = 0; i < N; i++) {
    const g = play(sp, skill, A, i * 7919 + skill * 31 + id.length);
    if (g.end === 'tired') { won++; secs += g.secs; }
    else if (g.end === 'snap') snap++;
    else if (g.end === 'thrown') thrown++;
  }
  return { win: won / N, secs: won ? secs / won : 0, snap: snap / N, thrown: thrown / N };
}

const ids = Object.keys(SPECIES).sort((a, b) => SPECIES[a].difficulty - SPECIES[b].difficulty);
if (!GATE) {
  const pct = (v) => String(Math.round(v * 100)).padStart(3) + '%';
  console.log('species              d  fight     skill 3 good/casual/idle   skill 6 good/casual/idle   skill 9 good/casual/idle   secs@6');
  for (const id of ids) {
    const sp = SPECIES[id];
    const cols = [3, 6, 9].map((k) => ['good', 'casual', 'idle'].map((a) => pct(rate(id, k, a).win)).join(' '));
    console.log(id.padEnd(20) + String(sp.difficulty).padStart(2) + ' ' + sp.fight.padEnd(9) + cols.map((c) => c.padEnd(27)).join('') + Math.round(rate(id, 6, 'good').secs));
  }
  const e = rate('coldwater_sturgeon', 4, 'good');
  console.log(`\nsturgeon at skill 4: win ${pct(e.win)}, snap ${pct(e.snap)}, thrown ${pct(e.thrown)}`);
}

// The bounds.
const fails = [];
const need = (ok, what) => { if (!ok) fails.push(what); };
const r = (id, k, a) => rate(id, k, a);
need(r('carp', 3, 'good').win >= 0.85, 'an easy fish has to be easy: carp, skill 3, good angler, under 85%');
need(r('lamp_herring', 3, 'casual').win >= 0.8, 'a herring has to land: skill 3, casual angler, under 80%');
need(r('coldwater_sturgeon', 3, 'good').win <= 0.55, 'a sturgeon is no gift: skill 3, good angler, over 55%');
need(r('coldwater_sturgeon', 9, 'good').win >= 0.4, 'a sturgeon can be beaten: skill 9, good angler, under 40%');
need(r('irontooth_bass', 6, 'good').win > r('irontooth_bass', 6, 'idle').win + 0.15, 'reading the fish has to pay: bass, skill 6, good no better than idle');
need(r('coldwater_sturgeon', 6, 'idle').win <= 0.1, 'holding the keys down can\'t land a sturgeon');
need(r('razorgill', 6, 'good').secs < 45, 'a small fish is not a long fight: razorgill over 45 s');
if (fails.length) { console.error('fight-sim:\n  ' + fails.join('\n  ')); process.exit(1); }
if (!GATE) console.log('\nbounds hold');
