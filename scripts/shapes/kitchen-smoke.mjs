// Kitchen smoke: the Kitchen Stage's food, knife and set checked without a GPU.
//
// gl/kitchen.js needs WebGL2, which node hasn't got. What it stands on is pure and is checked here:
//
//   1. THE MATTER TABLE IS WHOLE. Every cooking profile class has an entry with every key, every
//      ramp colour parses, and `matterProblems` passes each default and catches a bad override.
//   2. THE KNIFE CUTS TRUE. Even guides make even pieces (evenness 1), a stroke that misses makes
//      fewer pieces and scores lower, a lopsided cut scores lower than an even one, the pieces'
//      areas add up to the whole, and the wire format round-trips.
//   3. THE MESHES ARE SOUND. Every class, whole and cut into 2-4, at every beat, builds into a batch
//      with every float finite and something in it; the set builds for every hob; every vessel,
//      the plate, the knife, the knob at every level, the flames, steam and bubbles.
//
// Run:  node scripts/shapes/kitchen-smoke.mjs

import { __install } from './rink-dom-stub.mjs';

__install();
const R = '../../client/';
const KM = await import(R + 'shared/kitchen-matter.js');
const K = await import(R + 'shared/knife.js');
const M = await import(R + 'game/js/panels/gl/arena-mesh.js');
const KS = await import(R + 'game/js/panels/gl/kitchen-mesh.js');
const { PROFILES } = await import('../../plugins/cooking/profiles.js');

let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else { fail++; console.log(`  FAIL  ${name}${info === undefined ? '' : '  ' + JSON.stringify(info)}`); } };
const sound = (b) => {
  if (!(b.n > 0)) return false;
  for (let i = 0; i < b.n * M.STRIDE; i++) if (!Number.isFinite(b.data[i])) return false;
  return true;
};

// ── 1. the table ──────────────────────────────────────────────────────────────────────────────
for (const cls of Object.keys(PROFILES)) {
  const m = KM.MATTER[cls];
  check(`matter: ${cls} has an entry`, !!m);
  if (!m) continue;
  for (const [k, keys] of Object.entries(KM.MATTER_KEYS)) {
    for (const kk of keys) {
      if (k === 'ramp' || (k === 'form' && kk === 'round')) continue;
      check(`matter: ${cls}.${k}.${kk} is set`, m[k]?.[kk] !== undefined);
    }
  }
  for (const b of KM.BEATS) check(`matter: ${cls} ramp.${b} is a colour`, /^#[0-9a-f]{6}$/i.test(m.ramp[b] || ''), m.ramp[b]);
  check(`matter: ${cls}'s default passes its own lint`, KM.matterProblems(m).length === 0, KM.matterProblems(m));
  const d = KM.cutDifficulty(m);
  check(`matter: ${cls} cut difficulty is 0..1`, d >= 0 && d <= 1, d);
}
check('matter: an unknown key is caught', KM.matterProblems({ colour: {} }).length === 1);
check('matter: an unknown sub-key is caught', KM.matterProblems({ cut: { sharpness: 1 } }).length === 1);
check('matter: a bad form kind is caught', KM.matterProblems({ form: { kind: 'cube' } }).length === 1);
check('matter: a bad ramp colour is caught', KM.matterProblems({ ramp: { peak: 'brown' } }).length === 1);
const over = KM.matterFor('dense_meat', { form: { w: 20 }, colour: { x: 1 } });
check('matter: an override changes only its own keys', over.form.w === 20 && over.form.d === KM.MATTER.dense_meat.form.d && !over.colour);
check('matter: an unknown class falls back to a plain look', KM.matterFor('nonsense') === KM.PLAIN);
check('matter: the beat follows the phase', KM.beatOf({ phase: 'window' }) === 'peak' && KM.beatOf({ phase: 'burnt' }) === 'burnt'
  && KM.beatOf({ phase: 'cook', stage: 1, stages: 4 }) === 'raw' && KM.beatOf({ phase: 'cook', stage: 3, stages: 4 }) === 'cook');

// ── 2. the knife ──────────────────────────────────────────────────────────────────────────────
for (const cls of Object.keys(KM.MATTER)) {
  const m = KM.MATTER[cls];
  if (!KM.cuttable(m)) continue;
  const poly = K.footprint(m.form);
  for (let n = 2; n <= 4; n++) {
    const cuts = K.guides(n).map((at) => ({ at, tilt: 0 }));
    const pieces = K.cutPieces(poly, cuts);
    const sum = pieces.reduce((s, p) => s + K.area(p), 0);
    check(`knife: ${cls} into ${n} makes ${n} pieces`, pieces.length === n, pieces.length);
    check(`knife: ${cls} into ${n}: the pieces add up to the whole`, Math.abs(sum - K.area(poly)) < 1e-6 * K.area(poly) + 1e-9, { sum, whole: K.area(poly) });
    const even = K.evenness(poly, cuts, 0, n);
    // A dome's even guides are even in LENGTH, not area: the end pieces are smaller. That's real,
    // and it's why the board's guides sit where the areas balance (knife.js `balancedGuides`).
    const bal = K.balancedGuides(poly, n).map((at) => ({ at, tilt: 0 }));
    const balanced = K.evenness(poly, bal, 0, n);
    check(`knife: ${cls} into ${n} on the balanced guides is even`, balanced > 0.98, balanced);
    check(`knife: ${cls} into ${n}: balanced is at least as even as by length`, balanced >= even - 1e-9, { balanced, even });
    const lop = K.evenness(poly, bal.map((c, i) => (i === 0 ? { ...c, at: c.at * 0.5 } : c)), 0, n);
    check(`knife: ${cls} into ${n}: a lopsided cut scores lower`, lop < balanced, { lop, balanced });
    check(`knife: ${cls} into ${n}: a crushed stroke scores lower`, K.evenness(poly, bal, 1, n) < balanced);
    const miss = K.evenness(poly, bal.slice(1), 0, n);
    check(`knife: ${cls} into ${n}: a missed stroke scores lower`, miss < balanced, { miss, balanced });
  }
  const tilted = K.cutPieces(poly, [{ at: 0.5, tilt: 0.4 }]);
  check(`knife: ${cls}: a tilted cut still makes two pieces`, tilted.length === 2);
}
check('knife: the wire round-trips', JSON.stringify(K.parseCut(K.cutToken({ at: 0.3333, tilt: -0.05 }))) === JSON.stringify({ at: 0.333, tilt: -0.05 }));
check('knife: a cut off the food is refused', K.parseCut('1.4') === null && K.parseCut('abc') === null);
check('knife: a tilt past the stop is clamped', K.parseCut('0.5:3').tilt === K.MAX_TILT);

// ── 3. the meshes ─────────────────────────────────────────────────────────────────────────────
for (const cls of Object.keys(KM.MATTER)) {
  const m = KM.MATTER[cls];
  for (const beat of KM.BEATS) {
    for (let n = 1; n <= (KM.cuttable(m) ? 4 : 1); n++) {
      const b = M.createBatch(1 << 10);
      const { whole, pieces } = KS.piecesOf(m, K.guides(n).map((at) => ({ at, tilt: 0 })));
      pieces.forEach((p, i) => KS.foodPiece(b, m, p, whole, beat, KS.pose([i * 3, 0, 0], 0.3, n > 2 ? 0.5 : 0), i + 1));
      check(`mesh: ${cls} in ${n} at ${beat} is sound`, sound(b), b.n);
    }
  }
}
for (const hob of ['camp', 'domestic', 'range']) {
  const b = M.createBatch(1 << 12);
  KS.buildSet(b, { hob });
  check(`mesh: the set with a ${hob} hob is sound`, sound(b), b.n);
}
for (const kind of ['pan', 'pot', 'tray', 'bowl', 'bread']) {
  const b = M.createBatch(1 << 10);
  KS.vessel(b, kind, KS.pose([0, 0, KS.PAN_Z], 0.2));
  check(`mesh: a ${kind} is sound`, kind === 'bread' ? b.n === 0 : sound(b), b.n);
}
{
  const b = M.createBatch(1 << 10);
  KS.plate(b); KS.knife(b, KS.pose([0, 0, 5], 0.4, 0.2));
  for (let l = 0; l <= 10; l++) KS.knob(b, l);
  for (let l = 0; l <= 10; l++) KS.flames(b, l, l * 0.37);
  for (let a = 0; a <= 1; a += 0.25) { KS.puff(b, [0, 0, 10], a); KS.bubble(b, [0, 0, 5], a); }
  check('mesh: plate, knife, knob, flames, steam and bubbles are sound', sound(b), b.n);
}

console.log(`kitchen-smoke: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
