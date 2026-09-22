// A HOUSE CAST PER BUILDING — the four things about it that are silent when wrong.
//
// The Glasshouse is drawn almost entirely by `drawFacetDrum`, and a drum's surface is the
// `hfChrome` / `hfGlass` closure — no wall texture, no material family. `HF_CAST` gives each TILE
// one of eight hues off its own seed. Every way that can break produces a picture, which is why
// this exists rather than a screenshot:
//
//   · the cast never reaches the CAPTURE, so the 2-D painter tints and GLASS 2 does not — two
//     renderers disagreeing about one building, which is the single worst outcome here and is
//     invisible on the machine whose GL pass happens to be off;
//   · the cast leaks out of `drawTypeModel` and tints whatever is drawn next;
//   · the flag's 0 is not the renderer as it shipped;
//   · the casts are chosen by a seed MODULO rather than a hash, so they land in stripes along a
//     street, which reads as a pattern nobody authored and is very hard to see one tile at a time.
//
// ⚠ AND IT MEASURES COLOURS, NEVER PIXELS. `__street` freezes no clock by design, so a frame
// diff of the same setting twice moves 49% of the screen — the effect this is looking for is a
// few levels on one channel. A mesh capture is deterministic; a picture of a city is not.
//
// Run: `node scripts/shapes/hftint.mjs` (add `--report` for the per-cast table).
import { loadWindshield } from './dom-stub.mjs';
import { readFileSync } from 'node:fs';
import { hfCastFor, hfTint, HF_CASTS, HF_AMP } from '../../client/shared/hf-tint.js';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const FH = 0.4, H = 1;

// The quarter, as the arms that paint with the polished ramp. Read off the source rather than
// listed here, so an arm that joins the set is covered the day it is written.
//
// ⚠ BOUNDED TO `drawTypeModelArm`, AND THE FIRST CUT WAS NOT. A bare sweep for `\n    case '…':`
// over the whole file collects cases from every other switch in it at the same indent — the first
// run reported `skullbob`, which is a CAB TRINKET hanging off a mirror, and then failed it for not
// being tinted. A scanner that does not know where it is invents findings rather than missing them.
const SRC = readFileSync('client/game/js/panels/windshield.js', 'utf8');
const ARMS = [];
{
  const from = SRC.indexOf('function drawTypeModelArm(');
  if (from < 0) throw new Error('cannot find drawTypeModelArm — the arm scan has nothing to bound itself to');
  const to = SRC.indexOf('\nfunction ', from + 1);
  const BODY = SRC.slice(from, to > 0 ? to : SRC.length);
  const re = /\n    case '([a-z_0-9]+)':/g;
  let m; const marks = [];
  while ((m = re.exec(BODY))) marks.push({ t: m[1], i: from + m.index });
  for (let a = 0; a < marks.length; a++) {
    const body = SRC.slice(marks[a].i, marks[a + 1] ? marks[a + 1].i : marks[a].i + 8000);
    if (/hfChrome\(|hfGlass\(/.test(body)) ARMS.push(marks[a].t);
  }
}
const REG = ws.TYPE_MODEL || {};
const MODELS = ARMS.map((t) => REG[t] || { type: t, pal: 'ty_hft_glass' }).filter(Boolean);

// A building's drum colours at one tile. `rgbOverride` is what `drumSkin` bakes, and it is the
// ONLY thing a cast can move — a textured box face carries a palette key instead and is untouched.
function drums(m, seed) {
  let mesh = [];
  try { mesh = ws.captureModelMesh(m, { fh: FH, h: H, seed }); } catch { return []; }
  return mesh.filter((f) => f.rgbOverride).map((f) => f.rgbOverride.join(','));
}
const SEEDS = [];
for (let y = 909; y <= 919; y++) for (let x = 891; x <= 906; x++) SEEDS.push((x + 512) * 73 + (y + 512) * 149);

const fails = [];
const fail = (s) => fails.push(s);
const ok = (s) => { if (REPORT) console.log('  ✓ ' + s); };

// ── 1 AND 2. THE FLAG'S 0 IS THE SHIPPING RENDERER, AND ITS 1 REACHES THE CAPTURE ────────────
//
// One comparison answers both, per model per tile: **the two settings agree exactly when this
// tile's cast is the zero one, and differ otherwise.**
//
// ⚠ THE OBVIOUS CHECK IS WRONG AND WAS WRITTEN FIRST. "With the flag off, every tile of one
// building type hands back the same colours" is false before this feature existed: seventeen of
// these arms already roll their own per-tile variation off `frac(seed)` — a lit pane here, a
// panel shade there — so that check fails on a clean tree and says nothing about the cast.
//
// ⚠ AND THE CAPTURE IS THE HALF THAT MATTERS. `captureModelMesh` is what GLASS 2 draws. A cast
// armed for the live frame and not for the capture gives the two renderers different buildings,
// and only a machine whose GL pass is ON can see it.
// ⚠ ASKED WITH `glDrumMat` OFF, AND THE SPLIT IS ASSERTED SEPARATELY BELOW. A cast is carried by
// the `hfChrome`/`hfGlass` CLOSURE, so it can only reach a drum that still paints itself. A drum in
// a `DRUM_MAT` family has opted into the shader's material instead — its colour then comes from a
// shared atlas entry, which is per-PALETTE and cannot be per-tile — so those faces deliberately
// wear no cast. Measured with the flag on, that is 1,222 of ~2,970 drum faces in the quarter, and
// the ones that keep it are the CLADDING (`ty_hf_chrome` and its neighbours, all `plain`), which is
// the right half to be varying: a building's cladding is its identity and its glass is glass.
const savedDrumMat = ws.RENDER_TUNE.glDrumMat;
ws.RENDER_TUNE.glDrumMat = 0;
const SAMPLE = SEEDS.filter((_, i) => i % 3 === 0);
let reached = 0, agreedOnZero = 0, differedOnCast = 0, missed = 0;
const perModel = [];
for (const m of MODELS) {
  ws.RENDER_TUNE.hfTint = 0;
  const off = SAMPLE.map((s) => drums(m, s).join('|'));
  ws.RENDER_TUNE.hfTint = 1;
  const on = SAMPLE.map((s) => drums(m, s).join('|'));
  if (!off[0].length) { perModel.push({ type: m.type, variants: 0 }); continue; }
  for (let i = 0; i < SAMPLE.length; i++) {
    const c = hfCastFor(SAMPLE[i]);
    const zero = Math.abs(c[0]) + Math.abs(c[1]) + Math.abs(c[2]) < 0.01;
    if (zero) {
      if (on[i] !== off[i]) fail(`${m.type}: the zero cast changed the building — flag 0 is not the shipping renderer`);
      else agreedOnZero++;
    } else if (on[i] === off[i]) missed++;
    else differedOnCast++;
  }
  // ⚠ PER MODEL FOR THE REACH, PER TILE FOR THE RATIO. A cast is scaled by the facet's own
  // luminance and then rounded to a byte, so on a genuinely dark drum it can land under one level
  // and change nothing — correct, and not something to fail on. What is never acceptable is an arm
  // the cast does not reach AT ALL.
  if (off.join('¦') === on.join('¦')) fail(`${m.type}: the cast changes nothing anywhere — it is not reaching captureModelMesh, so GLASS 2 would draw the untinted building`);
  const sets = new Set(on);
  perModel.push({ type: m.type, variants: sets.size });
  if (sets.size > 1) reached++;
}
{
  const cast = differedOnCast + missed;
  const pct = cast ? (differedOnCast / cast) * 100 : 0;
  if (pct < 90) fail(`only ${pct.toFixed(1)}% of cast tiles visibly differ (${differedOnCast} of ${cast}) — HF_AMP has been turned down below one level of colour`);
  ok(`${pct.toFixed(1)}% of cast tiles visibly differ (${missed} land under one level on a dark facet)`);
}
ok(`flag 0 ≡ flag 1 on ${agreedOnZero} zero-cast tiles; the two differ on ${differedOnCast} cast tiles`);
ok(`${reached} of ${MODELS.length} polished arms take more than one cast over ${SAMPLE.length} tiles`);

ws.RENDER_TUNE.glDrumMat = savedDrumMat;

// ── 2b. AND THE SPLIT ITSELF: RAMP OR MATERIAL, NEVER BOTH AND NEVER NEITHER ─────────────────
//
// With `glDrumMat` on, a drum in a `DRUM_MAT` family gives up its baked ramp and takes the wall
// texture, the specular lobe, the environment term and the sun. Two ways that goes wrong and both
// are silent: a face keeping its override AND losing `flat` has the override ignored entirely by
// the shader (`solid` samples the atlas), and a face that keeps `flat` gets none of the material
// it was supposed to gain. The whole point of the flag is that a glazed tower reads as glass, and
// both failures look exactly like a flag that does nothing.
// ⚠ AND IT IS KEYED ON THE CAPTURED SHAPE, NOT ON THE FACE'S FIELDS. A first cut treated every
// `flat` face carrying a glass palette as a drum that had failed to take the material, and it
// reported `winter_garden` — which is a BARREL ROOF, the one mass primitive that lights itself and
// is correctly flat. `shapeForModel` records `kind: 'drum'` per solid with its facet count and its
// palette, which is the arm's own statement of what a drum is; anything else in the mesh is not one.
if (savedDrumMat) {
  const isFlat = (f) => (f.flat != null ? !!f.flat : f.kind === 'flat');
  let mat = 0, ramp = 0;
  ws.RENDER_TUNE.glDrumMat = 1;
  // ⚠ WITH THE HOUSE SKIN OFF, because this claim cross-references the CAPTURE's palette against
  // the MESH's and the skin deliberately makes those two different keys: the capture keeps the
  // authored key ( memoises on model IDENTITY, not on the seed, so a skinned capture
  // would freeze whichever tile ran first and hand it to every copy) while the mesh takes the
  // skinned one. This claim is about ; the skin has its own above.
  const savedSkin = ws.RENDER_TUNE.hfSkin;
  ws.RENDER_TUNE.hfSkin = 0;
  for (const m of MODELS) {
    let mesh = [], segs = [];
    try { mesh = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEEDS[5] }); segs = ws.shapeForModel(m, SEEDS[5]) || []; } catch { continue; }
    for (const f of mesh) if (f.rgbOverride && !isFlat(f)) { fail(`${m.type}: a face carries an rgbOverride and is not flat — the shader samples the atlas and the override is never read`); break; }
    for (const d of segs.filter((s) => s.kind === 'drum' && s.pal)) {
      const wants = ws.DRUM_MAT_FAMILIES.has(ws.wallMaterialOf(d.pal));
      const n = Math.max(5, d.n || 12);
      const solid = mesh.filter((f) => f.pal === d.pal && !isFlat(f) && f.kind === 'wall').length;
      const flat = mesh.filter((f) => f.pal === d.pal && isFlat(f) && f.rgbOverride).length;
      if (wants) { if (solid < n) fail(`${m.type}: a ${ws.wallMaterialOf(d.pal)} drum on '${d.pal}' wants ${n} solid faces and the mesh has ${solid} — it stayed flat, so it gets no texture, no lobe, no environment term and no sun`); else mat += solid; }
      else if (flat < n) fail(`${m.type}: a ${ws.wallMaterialOf(d.pal)} drum on '${d.pal}' lost its painted ramp — that family's row is near-matte, so the shader hands back a flat fill`);
      else ramp += flat;
    }
  }
  ws.RENDER_TUNE.hfSkin = savedSkin;
  if (mat <= 0) fail('no drum anywhere took the shader material — glDrumMat is on and reaching nothing');
  if (ramp <= 0) fail('every drum took the material — a `plain` drum should keep its hand-tuned ramp rather than trade it for a flat fill');
  ok(`${mat} drum faces took the shader material, ${ramp} kept their painted ramp`);
}

// ── 3. THE CAST LEAVES NOTHING BEHIND ────────────────────────────────────────────────────────
//
// ⚠ THIS ONE IS A SOURCE CHECK AND THAT IS DELIBERATE, because the behavioural version CANNOT
// FAIL TODAY and it was written first. Measured: all 152 `hfChrome`/`hfGlass` call sites are
// inside `drawTypeModelArm`, and `drawTypeModel` re-arms the cast on the way in — so a leaked
// cast is overwritten by the very next building and nothing downstream can observe it. Deleting
// the restore therefore survives every behavioural probe, which is exactly the shape of mutant a
// budget-style check waves through.
//
// What the restore actually guards is NESTING: an arm that draws another model (a forecourt
// canopy, a sub-model, a future composite) would otherwise finish its own mass wearing the inner
// building's cast. The day that arm is written is the day this matters, and a check that can only
// go red after the bug ships is not a check. So: the `finally` must name it.
{
  const fn = SRC.slice(SRC.indexOf('function drawTypeModel(ctx'), SRC.indexOf('function drawTypeModelArm('));
  if (!/finally\s*\{[^}]*HF_CAST\s*=\s*prevCast/.test(fn)) {
    fail('drawTypeModel no longer restores HF_CAST in its `finally` — a nested arm would leak its cast to the building around it');
  } else ok('drawTypeModel restores the cast in its `finally`');
  // …and the arming is still inside the same funnel, which is what makes the restore reachable.
  if (!/HF_CAST\s*=\s*RENDER_TUNE\.hfTint\s*\?\s*hfCastFor\(seed\)/.test(fn)) {
    fail('drawTypeModel no longer arms HF_CAST from the tile seed — the cast is coming from somewhere else');
  }
}

// ── 4. A CAST IS A HUE AND NEVER A BRIGHTNESS ────────────────────────────────────────────────
//
// Authored as an angle in the YIQ chroma plane, so `dY` is zero by construction at every
// amplitude. If this ever fails, the table has grown an entry that is not on that basis and the
// quarter will read as buildings of different BRIGHTNESS, which is a different estate.
const Y = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
{
  if (hfTint([100, 120, 140], null) !== null && hfTint([100, 120, 140], null).join() !== '100,120,140') {
    fail('hfTint with no cast is not the identity — the flag\'s 0 cannot be byte-for-byte');
  }
  // Every distinct cast the hash can produce, taken from the resolved table via the seeds.
  const casts = new Map();
  for (const s of SEEDS) { const c = hfCastFor(s); casts.set(c.join(','), c); }
  let worst = 0;
  for (const c of casts.values()) worst = Math.max(worst, Math.abs(Y(c)));
  if (worst > 0.02) fail(`a cast shifts luminance by ${worst.toFixed(3)} — the YIQ basis has been broken`);
  ok(`${casts.size} distinct casts reachable, worst luminance shift ${worst.toFixed(4)}`);
  if (casts.size < 4) fail(`only ${casts.size} distinct casts over ${SEEDS.length} tiles — the hash is collapsing the table`);
}

// ── 4b. AND THEY ARE NOT LAID DOWN IN STRIPES ────────────────────────────────────────────────
//
// ⚠ THE TILE SEED IS LINEAR IN BOTH COORDINATES — `(wx + 512)·73 + (wy + 512)·149` — so the
// obvious `seed % HF_CASTS.length` walks the table in lockstep along a street and paints the casts
// in bands. It passes every check above (eight distinct casts, all luminance-neutral, all reaching
// the capture) and produces a quarter with a visible repeating pattern nobody authored, which is
// worse than the uniformity it replaced and is very hard to see one building at a time.
{
  const castAt = (x, y) => hfCastFor((x + 512) * 73 + (y + 512) * 149).join(',');
  let worst = 0, worstP = 0;
  for (let p = 1; p <= 8; p++) {
    let same = 0, n = 0;
    for (let y = 909; y <= 919; y++) for (let x = 891; x <= 906 - p; x++) { n++; if (castAt(x, y) === castAt(x + p, y)) same++; }
    for (let x = 891; x <= 906; x++) for (let y = 909; y <= 919 - p; y++) { n++; if (castAt(x, y) === castAt(x, y + p)) same++; }
    const r = same / n;
    if (r > worst) { worst = r; worstP = p; }
  }
  // 1/8 is what an even hash gives. Half the tiles agreeing at one spacing is a stripe.
  if (worst > 0.45) fail(`${(worst * 100).toFixed(0)}% of tiles ${worstP} apart wear the same cast — the casts are in stripes, not hashed`);
  ok(`worst neighbour agreement ${(worst * 100).toFixed(0)}% at spacing ${worstP} (an even hash gives ${(100 / HF_CASTS.length).toFixed(0)}%)`);
}

// ── 5. THE NUDGE LANDS AT THE LIT END ────────────────────────────────────────────────────────
//
// The whole finding this feature answers: all 69 authored ramps converge on the same near-white
// at the light end and are already distinguishable at the dark one. A flat offset would do its
// work in the shadows, where nobody is looking.
{
  const cast = [...new Map(SEEDS.map((s) => [hfCastFor(s).join(','), hfCastFor(s)])).values()]
    .sort((a, b) => (Math.abs(b[0]) + Math.abs(b[1]) + Math.abs(b[2])) - (Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2])))[0];
  const LO = [112, 128, 144], HI = [230, 240, 248];
  const d = (c) => { const t = hfTint(c, cast); return Math.max(...t.map((v, i) => Math.abs(v - c[i]))); };
  if (!(d(HI) > d(LO) * 1.3)) fail(`the cast moves the lit end by ${d(HI).toFixed(1)} and the dark end by ${d(LO).toFixed(1)} — it is not weighted to the light`);
  ok(`lit end moves ${d(HI).toFixed(1)} of 255, dark end ${d(LO).toFixed(1)} (cap HF_AMP ${HF_AMP})`);
  if (d(HI) > 26) fail(`the widest cast moves a lit facet by ${d(HI).toFixed(1)} of 255 — that is no longer subtle, see HF_AMP`);
}

// ── 6. THE MESH MEMO IS PER-TILE, WHICH IS WHAT LETS GLASS 2 CARRY A SEEDED COLOUR ───────────
//
// ⚠ THE ONE CLAIM NOT ABOUT THIS FILE. `tileMesh` memoises on `meshParams`, and a seeded colour is
// only correct in GLASS 2 because that key contains the SEED. Take it out and every tile of a
// building type gets whichever cast happened to be captured first — a change in another file, in
// another directory, that reads as this feature working on some buildings and not others.
{
  const W = readFileSync('client/game/js/panels/gl/world.js', 'utf8');
  const m = W.match(/const meshParams = \(it\) =>[^;]*/);
  if (!m) fail('cannot find meshParams in gl/world.js — the per-tile mesh key is unverified');
  else if (!/it\.seed/.test(m[0])) fail('meshParams no longer includes the seed — GLASS 2 will share one cast across every tile of a building');
  else ok('meshParams still keys the mesh memo on the tile seed');
}

ws.RENDER_TUNE.hfTint = 1;

if (REPORT) {
  console.log('\n  casts per arm over ' + SEEDS.length + ' tiles');
  for (const r of perModel.sort((a, b) => b.variants - a.variants)) {
    console.log('   ' + r.type.padEnd(17) + String(r.variants).padStart(3));
  }
}

if (fails.length) {
  console.error('\n✗ hftint: ' + fails.length + ' failure(s)');
  for (const f of fails) console.error('   · ' + f);
  process.exit(1);
}
console.log('✓ hftint: a house cast per building — ' + reached + ' of ' + MODELS.length
  + ' polished arms take more than one cast over ' + SEEDS.length + ' tiles, the flag\'s 0 is the shipping renderer, '
  + 'nothing leaks, and every cast is luminance-neutral.');
