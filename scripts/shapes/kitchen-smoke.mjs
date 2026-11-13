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
      if (k === 'ramp' || k === 'look' || (k === 'form' && kk === 'round')) continue;   // look is all optional
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
// the room's microwave, as the kitchen draws it in the room's place: on a worktop and on its trolley,
// either way round, its door shut and open, its light off and on; its turntable's food sits inside it
for (const stand of [0, 55]) for (const flip of [false, true]) {
  const oven = { w: 50, d: 40, h: 30, stand, flip }, b = M.createBatch(1 << 12);
  KS.buildSet(b, { hob: 'microwave', bare: true, oven });
  for (const open of [0, 0.5, 1]) KS.ovenLive(b, oven, { open, lit: open > 0, spin: open * 3 });
  check(`mesh: a microwave (stand ${stand}, flip ${flip}) is sound`, sound(b), b.n);
  const K = KS.ovenCavity(oven), hw = oven.w / 2;
  check(`mesh: its cavity is inside it (flip ${flip})`, K.x0 > -hw && K.x1 < hw && K.z1 < oven.h && K.y0 > -oven.d / 2 && K.x1 - K.x0 > 20, K);
  check(`mesh: its cavity is on the keypad's far side (flip ${flip})`, flip ? K.cx > 0 : K.cx < 0, K.cx);
  // the keypad: thirteen keys inside the panel, on the keypad's side, none overlapping, reading left to
  // right in the kitchen's frame whichever way round it is
  const P = KS.ovenPanel(oven), keys = P.keys;
  check(`mesh: the keypad has 0-9, +30, C and START (flip ${flip})`, keys.length === 13 && ['0', '9', '+30', 'C', 'start'].every((k) => keys.some((x) => x.key === k)));
  check(`mesh: every key is on the panel (flip ${flip})`, keys.every((k) => k.x0 >= P.x0 && k.x1 <= P.x1 && k.z0 >= P.z0 && k.z1 <= P.z1 && k.c.every(Number.isFinite)));
  check(`mesh: the panel is clear of the cavity (flip ${flip})`, flip ? P.x1 <= K.x0 : P.x0 >= K.x1, { P: [P.x0, P.x1], K: [K.x0, K.x1] });
  const at = (k) => keys.find((x) => x.key === k);
  check(`mesh: 1 is left of 3 and above 7 (flip ${flip})`, at('1').x1 <= at('3').x0 && at('1').z0 >= at('7').z1);
  check(`mesh: no two keys overlap (flip ${flip})`, keys.every((a, i) => keys.every((q, j) => i === j || a.x1 <= q.x0 || q.x1 <= a.x0 || a.z1 <= q.z0 || q.z1 <= a.z0)));
  const f = M.createBatch(1 << 10);
  for (const ext of [0.2, 0.7, 1]) KS.ovenFinger(f, oven, ext, { tremble: ext < 1, t: ext });
  check(`mesh: the finger is sound (flip ${flip})`, sound(f), f.n);
  const g = M.createBatch(1 << 10);
  KS.ovenLive(g, oven, { display: '10:00', pressed: 'start', press: 1 });
  check(`mesh: a pressed key and a four-digit display are sound (flip ${flip})`, sound(g), g.n);
}
{
  // walking about a room while the kitchen's up, it picks with the room's own eye: kitchenCamOf has to be
  // roomCamOf's exact inverse, or a click lands beside what's drawn
  const KG = await import(R + 'game/js/panels/gl/kitchen.js');
  const n3 = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const frames = [KG.FREE, { o: [2, 0.9, -1], x: [0, 0, 1], y: [-1, 0, 0], z: [0, 1, 0], s: 0.01 }, { o: [-3, 1, 4], x: n3([0.6, 0, -0.8]), y: n3([0.8, 0, 0.6]), z: [0, 1, 0], s: 0.0328 }];
  let worst = 0;
  for (const F of frames) for (const v of [{ eye: [1, 1.6, 2], yaw: 0.4, pitch: -0.5, fov: 72 }, { eye: [-2, 1.2, 0.5], yaw: -2.9, pitch: 0.2, fov: 60 }]) {
    const back = KG.roomCamOf(KG.kitchenCamOf(v, F), null, F);
    const dy = Math.abs(Math.atan2(Math.sin(back.yaw - v.yaw), Math.cos(back.yaw - v.yaw)));
    worst = Math.max(worst, dy, Math.abs(back.pitch - v.pitch), Math.abs(back.fov - v.fov), ...back.eye.map((x, i) => Math.abs(x - v.eye[i])));
  }
  check('camera: the room\'s eye through the kitchen and back is the same eye', worst < 1e-9, worst);
}
{
  // the display font: every character the display and the keys show, and nothing past its box
  check('mesh: the seven-segment font has every character it is asked for', ['0123456789', 'End', '+30', 'C', '1:30', '-'].every(KS.segGlyphs));
  const b = M.createBatch(1 << 10);
  KS.segText(b, '12:34', 0, 6, 0, 3, 0, KS.COLOURS.ovenLed);
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < b.n; i++) { const x = b.data[i * M.STRIDE]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  check('mesh: seven-segment text squeezes into its box', sound(b) && x0 >= -0.01 && x1 <= 6.01, [x0, x1]);
  const n0 = b.n;
  KS.segText(b, ' ', 0, 6, 0, 3, 0, KS.COLOURS.ovenLed);
  check('mesh: a blank draws nothing', b.n === n0);
}
{
  const b = M.createBatch(1 << 10);
  KS.buildSet(b, { hob: 'bench', bare: true });
  check('mesh: a worktop with no hob draws the board and the pass only', sound(b), b.n);
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

// Every food's own look (tags.matter): its whole self in the pan and on the counter, raw and done,
// and a cut piece of it. A pack, a fin or a stalk that throws or writes NaN fails here.
{
  const fs = await import('node:fs');
  const dir = new URL('../../content/items/', import.meta.url);
  for (const file of fs.readdirSync(dir)) {
    const item = JSON.parse(fs.readFileSync(new URL(file, dir), 'utf8'));
    if (!item.tags?.matter) continue;
    check(`matter: ${item.id} lints clean`, KM.matterProblems(item.tags.matter).length === 0, KM.matterProblems(item.tags.matter).join('; '));
    const m = KM.matterFor(item.tags.food_profile, item.tags.matter), whole = K.footprint(m.form);
    const b = M.createBatch(1 << 12);
    for (const beat of ['raw', 'peak']) {
      KS.foodPiece(b, m, whole, whole, beat, KS.pose([0, 0, 0], 0.3), 3);
      KS.shelfPiece(b, m, whole, whole, beat, KS.pose([20, 0, 0], 0.3), 3);
    }
    if (m.cut.styles.length) KS.foodPiece(b, m, K.cutPieces(whole, [{ at: 0.5, tilt: 0 }])[0], whole, 'raw', KS.pose(), 4);
    check(`mesh: ${item.id} draws and is sound`, b.n > 0 && sound(b), b.n);
  }
}

// The pan's liquid (gl/kitchen-liquid.js): a second liquid starts as a blob, sitting still barely
// mixes it, stirring does, and the surface it draws is sound.
{
  const Lq = await import(R + 'game/js/panels/gl/kitchen-liquid.js');
  const L = Lq.createLiquid(10);
  Lq.pour(L, 'stock', [0.8, 0.7, 0.5]);
  Lq.pour(L, 'tomato', [0.77, 0.23, 0.16], [3, 0]);
  const before = Lq.evenness(L);
  for (let i = 0; i < 60; i++) Lq.step(L, 1 / 60);
  const still = Lq.evenness(L);
  for (let i = 0; i < 240; i++) { const a = i * 0.15; Lq.stirAt(L, Math.cos(a) * 5, Math.sin(a) * 5, -Math.sin(a) * 60, Math.cos(a) * 60); Lq.step(L, 1 / 60); }
  const stirred = Lq.evenness(L);
  check('liquid: a second pour starts unmixed', before < 0.6, before);
  check('liquid: stirring mixes it far more than waiting', stirred > 0.85 && stirred > still + 0.3, `${still} -> ${stirred}`);
  check('liquid: a stirred pan spins', L.spin > 5, L.spin);
  const b = M.createBatch(1 << 12);
  Lq.drawLiquid(M, b, L, KS.pose([0, 0, 4]), 2);
  check('liquid: the surface draws and is sound', b.n > 0 && sound(b), b.n);
  Lq.drain(L, 'stock'); Lq.drain(L, 'tomato');
  check('liquid: drained of everything, it is empty', !L.filled && L.sources.size === 0);
}

// A thick sauce moves less for the same push, and an egg cracked into a pan draws at every beat.
{
  const Lq = await import(R + 'game/js/panels/gl/kitchen-liquid.js');
  const spin = (thick) => {
    const L = Lq.createLiquid(10);
    Lq.pour(L, 'sauce', [0.6, 0.2, 0.1]);
    L.thick = thick;
    for (let i = 0; i < 60; i++) { const a = i * 0.15; Lq.stirAt(L, Math.cos(a) * 5, Math.sin(a) * 5, -Math.sin(a) * 60, Math.cos(a) * 60); Lq.step(L, 1 / 60); }
    return L.spin;
  };
  const thin = spin(0), thick = spin(0.85);
  check('liquid: a reduced sauce spins far less for the same stir', thick < thin * 0.5, `${thin} vs ${thick}`);
  const L = Lq.createLiquid(10);
  Lq.pour(L, 'water', [0.8, 0.86, 0.9]);
  L.cloud = { rgb: [0.93, 0.9, 0.84], k: 0.45 };
  const b = M.createBatch(1 << 12);
  Lq.drawLiquid(M, b, L, KS.pose(), 2);
  check('liquid: starch-clouded water draws and is sound', b.n > 0 && sound(b), b.n);
  const egg = KM.matterFor('egg');
  const e = M.createBatch(1 << 10);
  for (const beat of KM.BEATS) KS.eggCracked(e, egg, beat, KS.pose([0, 0, 4]), 3);
  check('mesh: a cracked egg draws at every beat and is sound', e.n > 0 && sound(e), e.n);
}

console.log(`kitchen-smoke: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
