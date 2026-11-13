// chem-stage-smoke: the Chem Stage's stage games and matter, played in Node (docs/proposals/chem-stage.md,
// phases 2 and 3).
//
//   1. Every stage, at the easiest and the hardest difficulty, played by a good hand scores well and
//      by an idle or clumsy one scores badly, and a stage is the same for the same seed.
//   2. The chain: which forms play which stages, and its score is the mean, 50 with nothing played.
//   3. The matter: a powder heap keeps its mass and its angle of repose, a slosh dies away, the
//      meshes come out finite, and the lab's working bench builds with its open bench cleared.
//
// No DB, no DOM, no files written.

import { STAGES, CHAINS, chainFor, createChain, stepChain, stageDone, nextStage, chainScore, tolOf, rngOf } from '../../client/shared/chem-chain.js';

const fails = [];
const fail = (m) => fails.push(m);
const DT = 1 / 30;

// A hand for each stage: `good` reads the bench the way a player would (the line, the mark, the
// readout) and `bad` is a clumsy or absent one.
// Where a stage would end up if the hand did `input` from here on, for a hand that looks ahead.
const settled = (S, s, input) => { const c = structuredClone(s); for (let i = 0; i < 90; i++) S.step(c, input, DT); return c; };
const HANDS = {
  measure: {
    // pour, and let go early enough that what's in the neck lands on the line
    good: (s) => ({ pour: s.level + s.flow * 0.75 < s.target }),
    bad: (s) => ({ pour: s.t < 6 }),
  },
  heat: {
    // lead the dial: a little over the mark while it's cold, on the mark once it's close
    good: (s) => ({ dial: Math.abs(s.temp - s.target) > 0.08 ? s.target / 1.05 + (s.target > s.temp ? 0.2 : -0.2) : s.target / 1.05 }),
    bad: () => ({ dial: 1 }),
  },
  reflux: {
    good: (s) => ({ flow: Math.min(1, s.heat + (s.ring - 0.25) * 1.5) }),
    bad: () => ({ flow: 0 }),
  },
  evaporate: {
    good: (s) => ({ stop: s.t >= s.dryAt }),
    bad: (s) => ({ stop: s.t >= 2 }),
  },
  weigh: {
    // looks ahead: lets go when what's on the spatula and in the air would land on the weight
    good: (s) => ({ tip: settled(STAGES.weigh, s, { tip: false }).mass < s.target - 0.02 }),
    bad: () => ({ tip: true }),
  },
  grind: {
    // four turns a second is about 6 rad/s, under the spill speed at any difficulty
    good: (s) => ({ press: true, angle: s.t * 6 }),
    bad: (s) => ({ press: true, angle: s.t * 30 }),
  },
  press: {
    good: (s) => ({ press: s.force < s.mark - 0.01 }),
    bad: () => ({ press: true }),
  },
  separate: {
    good: (s) => ({ open: s.lower > 0.002 }),
    bad: (s) => ({ open: s.t < 12 }),
  },
  crystallise: {
    good: (s) => ({ dial: (s.aim - 0.008) / 0.12 }),
    bad: () => ({ dial: 1 }),
  },
  filter: {
    good: (s) => ({ pour: s.level < 0.55 }),
    bad: () => ({ pour: true }),
  },
  regulate: {
    good: (s) => ({ dial: s.target / (1.1 - 0.45 * Math.min(1, s.t / s.dur)) }),
    bad: () => ({ dial: 1 }),
  },
  leak: {
    // brush the joints in turn until one bubbles, then hold on it until it's tight and let go
    good: (s) => (s.brushed[s.leak] ? { joint: s.leak, down: s.tight < 1 } : { joint: s.brushed.indexOf(false), down: !s.was }),
    bad: () => ({ joint: 0, down: true }),
  },
  collect: {
    good: (s) => ({ open: s.level + s.flow * 0.75 < s.target }),
    bad: (s) => ({ open: s.t < 6 }),
  },
  dry: {
    good: (s) => ({ dial: 0.5, stop: s.wet <= s.aim }),
    bad: () => ({ dial: 1 }),
  },
  cure: {
    good: (s) => ({ click: s.h >= (s.win[0] + s.win[1]) / 2 }),
    bad: () => ({ click: true }),
  },
  stir: {
    good: (s) => ({ press: true, angle: s.t * 5.5 }),
    bad: (s) => ({ press: true, angle: s.t * 20 }),
  },
  rhythm: {
    good: (s) => ({ click: s.t >= s.lead + s.hits.length * s.period - 0.016 }),
    bad: () => ({ click: true }),
  },
};

function play(name, hand, seed, difficulty) {
  const S = STAGES[name], s = S.make(rngOf(seed), tolOf(difficulty));
  let n = 0;
  while (!S.done(s) && n++ < 3000) S.step(s, hand(s), DT);
  if (n >= 3000) fail(`${name}: never finished`);
  return S.score(s);
}

// ── 1. every stage, good and bad, easy and hard ─────────────────────────────────────────────────────
for (const name of Object.keys(STAGES)) {
  const H = HANDS[name];
  if (!H) { fail(`${name}: no hand in the smoke test`); continue; }
  for (const d of [4, 12]) for (const seed of [1, 2, 3, 7, 11]) {
    const g = play(name, H.good, seed, d), b = play(name, H.bad, seed, d), idle = play(name, () => ({}), seed, d);
    if (!(g >= 80)) fail(`${name} d${d} seed ${seed}: a good hand scores ${g.toFixed(0)}`);
    if (!(b <= 35)) fail(`${name} d${d} seed ${seed}: a bad hand scores ${b.toFixed(0)}`);
    if (!(idle <= 40)) fail(`${name} d${d} seed ${seed}: doing nothing scores ${idle.toFixed(0)}`);
    if (play(name, H.good, seed, d) !== g) fail(`${name}: the same seed and hand scored twice differently`);
  }
}

// ── 2. the chain ────────────────────────────────────────────────────────────────────────────────────
{
  if (chainFor('wet', 'liquid').join() !== 'measure,heat,reflux,separate,evaporate') fail('a liquid doesn\'t play measure, heat, reflux, separate, evaporate');
  if (chainFor('solids', 'pill').join() !== 'weigh,grind,press') fail('a pill doesn\'t play weigh, grind, press');
  if (chainFor('wet', null).join() !== CHAINS.liquid.join()) fail('a drug with no form doesn\'t cook as a liquid');
  // every form the drug rows can carry has a chain, and so has the splice; an unknown form has none
  for (const f of ['liquid', 'gel', 'paste', 'powder', 'pill', 'crystal', 'gas', 'leaf', 'blotter']) if (!chainFor(null, f)) fail(`a ${f} drug has no chain`);
  if (chainFor('splice', null)?.join() !== 'measure,stir,heat,rhythm') fail('the splice doesn\'t play measure, stir, heat, rhythm');
  if (chainFor('wet', 'goo') !== null) fail('an unknown form opens the Stage');
  // an automated stage is never played: it scores the rig's number
  {
    const C = createChain(['stir', 'rhythm'], { seed: 3, auto: { stir: 77 } });
    nextStage(C);
    if (C.scores[0] !== 77) fail(`an automated stir scored ${C.scores[0]}, not the rig's 77`);
  }
  for (const names of Object.values(CHAINS)) for (const n of names) if (!STAGES[n]) fail(`a chain names "${n}", which isn't a stage`);
  if (chainScore([]) !== 50 || chainScore([100, 0, 50]) !== 50) fail('the chain score isn\'t the mean, or 50 for nothing');
  // a whole chain played by the good hands, end to end
  for (const [form, names] of Object.entries(CHAINS)) {
    const C = createChain(names, { seed: 9, difficulty: 8 });
    let guard = 0;
    for (;;) {
      stepChain(C, HANDS[C.names[C.i]].good(C.state), DT);
      if (stageDone(C) && nextStage(C)) break;
      if (guard++ > 20000) { fail(`a ${form} chain never finished`); break; }
    }
    if (C.scores.length !== names.length || chainScore(C.scores) < 80) fail(`a ${form} chain played well scored ${C.scores.join(', ')}`);
  }
}

// ── 3. the matter and the working bench ─────────────────────────────────────────────────────────────
{
  const M = await import('../../client/game/js/panels/gl/lab-matter.js');
  // a heap: everything poured is in it, and no step is steeper than the angle of repose
  const h = M.createHeap(0.035, 16);
  for (let i = 0; i < 400; i++) { M.addToHeap(h, 2e-8, (i % 7) * 0.001); M.settleHeap(h, 4); }
  const mass = M.heapMass(h);
  if (Math.abs(mass / 8e-6 - 1) > 0.01) fail(`a heap fed 8 cm³ holds ${(mass * 1e6).toFixed(2)} cm³`);
  let steep = 0;
  for (let i = 0; i + 1 < h.n; i++) if ((h.hgt[i] - h.hgt[i + 1]) / h.dr > Math.tan(h.repose) + 0.05) steep++;
  if (steep) fail(`a settled heap has ${steep} steps steeper than its angle of repose`);
  // a slosh: knocked, it rings and dies
  const sl = M.createSlosh();
  M.stepSlosh(sl, [3, 0], 0.05);
  for (let i = 0; i < 300; i++) M.stepSlosh(sl, [0, 0], DT);
  if (Math.hypot(sl.tilt[0], sl.tilt[1]) > 0.002) fail(`a slosh still tilts ${Math.hypot(...sl.tilt).toFixed(4)} after ten seconds`);
  // colour by volume
  const mix = M.mixColour([[1, 0, 0], 1], [[0, 0, 1], 3]);
  if (Math.abs(mix[0] - 0.25) > 1e-6 || Math.abs(mix[2] - 0.75) > 1e-6) fail(`a 1:3 red-blue mix is ${mix.map((x) => x.toFixed(2))}`);
  // every stage's working pieces build to finite vertices, at every grade
  const { roomLayout, roomSpecOf, layRows } = await import('../../client/shared/room-layout.js');
  const { buildRoom } = await import('../../client/game/js/panels/gl/room-mesh.js');
  const { STRIDE } = await import('../../client/game/js/panels/gl/ballpark-mesh.js');
  for (const grade of ['standard', 'refined', 'pristine']) {
    const spec = roomSpecOf({ room: [4, 3.4, 2.6] }, true);
    const pieces = layRows([{ id: 'lab', name: 'chem lab', object_type: 'container', flags: { crafting_station: 'chem_lab', station_quality: grade } }], spec).pieces.map((p) => ({ ...p, working: true }));
    const L = roomLayout(spec, pieces), p = L.placed[0];
    const full = buildRoom(roomLayout(spec, pieces.map((x) => ({ ...x, working: false }))), { seed: 2 }), work = buildRoom(L, { seed: 2 });
    if (!(work.solid.n < full.solid.n)) fail(`a ${grade} working bench draws ${work.solid.n} vertices, not fewer than the full one's ${full.solid.n}: the open bench isn't cleared`);
    for (const name of Object.keys(STAGES)) {
      const s = STAGES[name].make(rngOf(5), tolOf(8));
      for (let i = 0; i < 40; i++) STAGES[name].step(s, HANDS[name].good(s), DT);
      const b = M.drawStage(L, p, name, STAGES[name].view(s), { t: 1.3, grade, liquid: '#c83a3a', product: '#f0f0ea' });
      if (!b.n) { fail(`${grade} ${name}: the stage drew nothing`); continue; }
      let bad = 0;
      for (let i = 0; i < b.n * STRIDE; i++) if (!Number.isFinite(b.data[i])) bad++;
      if (bad) fail(`${grade} ${name}: ${bad} vertex values aren't numbers`);
    }
    // the bench with its panel up (chem-stage.js openChemBench): nothing moves on it, and its light is finite
    {
      const lit = M.lightStage(L, p, 'menu', {}, { t: 2.2, grade });
      if (!lit.glows.length || !lit.halos.n) fail(`${grade} bench: the panel's light isn't there`);
      if (lit.glows.some((g) => ![...g.p, ...g.c, g.r].every(Number.isFinite))) fail(`${grade} bench: a glow isn't numbers`);
      if (M.drawStage(L, p, 'menu', {}, { t: 1, grade }).n !== 0) fail(`${grade} bench: the panel's bench draws moving pieces`);
    }
    // what the server can say happened: each draws, at the start and part-way through, in numbers
    for (const kind of ['fire', 'burst', 'fumes', 'flash', 'spoiled', 'ok']) for (const age of [0, 1.4]) {
      const b = M.drawOutcome(L, p, kind, [0.6, 0], age, { grade, product: '#f0f0ea' }, (await import('../../client/game/js/panels/gl/ballpark-mesh.js')).createBatch(64));
      if (!b.n) { fail(`${grade} ${kind}: the outcome drew nothing`); continue; }
      let bad = 0;
      for (let i = 0; i < b.n * STRIDE; i++) if (!Number.isFinite(b.data[i])) bad++;
      if (bad) fail(`${grade} ${kind} at ${age}s: ${bad} vertex values aren't numbers`);
    }
  }
}

if (fails.length) { console.error(`chem-stage-smoke: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
