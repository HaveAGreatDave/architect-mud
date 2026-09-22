// A LIGHTNING STROKE, TESTED WHERE IT IS ARITHMETIC.
//
// `client/shared/lightning.js` grows a branching channel and `lightning-draw.js` paints it, and
// between them they hold every rule that decides what a strike looks like. None of it can be seen
// by any other harness here: no gate in this repo reaches a GL draw call, `shapes:smoke` runs
// BUILDING models, and a bolt lives for a quarter of a second inside a storm that only the server
// starts. The picture is `__glBolt()` in the Modelshop; this is everything about it that is a
// number.
//
// ⚠ AND THE CLAIM THAT MATTERS MOST IS AN ORDERING ONE. A channel is painted very nearly white and
// then every full-frame grade left in `paintWindshield` runs over the top of it — the storm grade,
// the fog wash, and the truck's own headlamps-off wash at `rgba(6,8,14,0.62)` OVER THE WHOLE WORLD.
// Additive white cannot clip past 255 before a wash, so a bolt drawn under those is a pale grey
// wire and no tuning inside the painter can reach it: measured out of a real cab frame, the hottest
// pixel in the channel was a luminance of 102 against a sky of 15. It is 255 with the draw moved
// after them. Nothing about that is visible in the geometry, so it is checked in the SOURCE.
import fs from 'node:fs';
import { growBolt, boltBright, boltExtent, boltSeed, BOLT_GEN, BOLT_BRANCH_RESTRIKE }
  from '../../client/shared/lightning.js';
import { paintBolt } from '../../client/shared/lightning-draw.js';
import { blank } from '../lib/blank-scanner.mjs';

const ok = [], fail = [];
const SEEDS = Array.from({ length: 60 }, (_, i) => boltSeed(900 + i, 900 + i * 3, 1000 * i));
const bolts = SEEDS.map((s) => growBolt(s));

// ── 1. the trunk reaches the ground and every branch runs out in the air ───────────────────────
//
// `f` is 1 at the cloud base and 0 at the ground, so this is the one thing the coordinate is for:
// only the channel is allowed to arrive. A tree whose branches all ground reads as a root system.
{
  let notGrounded = 0, groundedForks = 0;
  for (const b of bolts) {
    const t = b.branches[0].pts;
    if (t[t.length - 1].f > 1e-9) notGrounded++;
    for (let i = 1; i < b.branches.length; i++) {
      const p = b.branches[i].pts;
      if (p[p.length - 1].f <= 1e-9) groundedForks++;
    }
  }
  if (notGrounded) fail.push(`${notGrounded}/${bolts.length} trunks stop short of the ground`);
  else ok.push(`all ${bolts.length} trunks land exactly on f = 0`);
  // A fork CAN ground — a real one sometimes does — but it must be rare, or the tree is a bush.
  const per = groundedForks / bolts.length;
  if (per > 1.2) fail.push(`${per.toFixed(2)} forks per bolt reach the ground — the tree is a root system`);
  else ok.push(`forks ground ${per.toFixed(2)} times a bolt`);
}

// ── 2. nothing ever goes back up ────────────────────────────────────────────────────────────────
{
  let up = 0;
  for (const b of bolts) for (const br of b.branches) {
    for (let i = 1; i < br.pts.length; i++) if (br.pts[i].f > br.pts[i - 1].f + 1e-9) up++;
  }
  if (up) fail.push(`${up} node(s) climb — a stepped leader only ever descends`);
  else ok.push('every node in every branch descends');
}

// ── 2b. and nothing ever runs level ─────────────────────────────────────────────────────────────
//
// ⚠ A RUN OF NODES AT ONE HEIGHT PROJECTS TO A HORIZONTAL LINE, which at the foot of a bolt is a
// hard white bar lying across the road. It is not a drawing bug and no amount of looking at the
// painter finds it: a branch clamped to the floor that STOPS it descending was not also stopped
// from travelling, so it carried on sideways at a constant height for the rest of its length.
{
  let level = 0, seg = 0;
  for (const b of bolts) for (const br of b.branches) {
    for (let i = 1; i < br.pts.length; i++) {
      seg++;
      const moved = Math.hypot(br.pts[i].ox - br.pts[i - 1].ox, br.pts[i].oy - br.pts[i - 1].oy);
      if (Math.abs(br.pts[i].f - br.pts[i - 1].f) < 1e-9 && moved > 0.01) level++;
    }
  }
  if (level) fail.push(`${level}/${seg} segment(s) travel at a constant height — a bar across the road, not lightning`);
  else ok.push(`none of ${seg} segments runs level`);
}

// ── 3. a branch leaves and keeps leaving ────────────────────────────────────────────────────────
//
// ⚠ THE ONE RULE THAT STOPS IT LOOKING LIKE AN INSECT, and the one a pure rotation gets wrong half
// the time: a sub-branch whose bearing points back at the channel hooks round and runs home, which
// in a still frame reads as legs. `deflect` mirrors those about the axis. Measured on generation 2
// and deeper, where the parent is far enough out for the test to bite.
// ⚠ AND IT ASKS THE RULE'S OWN QUESTION — the BEARING a branch leaves on — rather than whether it
// ended up further out than it started. That proxy is nearly blind: a branch travels, so it mostly
// ends further out whether or not it was ever pointed outward, and switching the mirror off moved
// it from 1.6% to 6.0% against a threshold that had to be loose enough not to flake.
//
// ⚠ AND IT IS MEASURED OVER THREE STEPS RATHER THAN ONE. `wander` is nearly half of what a deep
// branch travels in a single step, so a bearing read off the first segment alone is mostly noise:
// 1.4% of correct branches look inward on one step against 0.5% on three, while the broken ones sit
// at 5.2% and 4.3%. Three steps is where the two separate by about ten times, which is what a
// threshold wants under it.
{
  let inward = 0, n = 0;
  for (const b of bolts) for (const br of b.branches) {
    if (br.gen < 2 || br.pts.length < 2) continue;
    const a = br.pts[0], z = br.pts[Math.min(3, br.pts.length - 1)];
    const r = Math.hypot(a.ox, a.oy);
    if (r < 0.02) continue;
    const dx = z.ox - a.ox, dy = z.oy - a.oy, m = Math.hypot(dx, dy);
    if (m < 1e-9) continue;
    n++;
    if ((dx * a.ox + dy * a.oy) / (r * m) < -0.3) inward++;
  }
  const share = 100 * inward / Math.max(1, n);
  if (share > 2) fail.push(`${share.toFixed(1)}% of ${n} deep branches leave pointing back at the channel — they hook round and run home, which reads as legs`);
  else ok.push(`${share.toFixed(1)}% of ${n} deep branches leave pointing back at the channel`);
}

// ── 4. the generations taper, in width and in alpha ─────────────────────────────────────────────
{
  let bad = 0;
  for (let g = 1; g < BOLT_GEN.length; g++) {
    if (!(BOLT_GEN[g].w < BOLT_GEN[g - 1].w)) bad++;
    if (!(BOLT_GEN[g].a < BOLT_GEN[g - 1].a)) bad++;
  }
  if (bad) fail.push(`${bad} generation(s) are not thinner and fainter than their parent — drawn at one width a tree is a bush`);
  else ok.push(`all ${BOLT_GEN.length} generations taper in both width and alpha`);
}

// ── 5. the tree is a tree, and it is bounded ────────────────────────────────────────────────────
{
  const counts = bolts.map((b) => b.branches.length);
  const mean = counts.reduce((a, c) => a + c, 0) / counts.length;
  const max = Math.max(...counts);
  const gens = new Set(bolts.flatMap((b) => b.branches.map((x) => x.gen)));
  if (mean < 8) fail.push(`mean ${mean.toFixed(1)} branches — a stem with twigs on it, not a tree`);
  else if (max > 128) fail.push(`a bolt reached ${max} branches — the recursion is unbounded`);
  else ok.push(`${mean.toFixed(1)} branches a bolt (max ${max}), ${gens.size} generations deep`);
  const reach = bolts.map(boltExtent);
  const rm = reach.reduce((a, c) => a + c, 0) / reach.length;
  if (rm < 0.25 || rm > 1.4) fail.push(`mean reach ${rm.toFixed(2)} channel-heights — a tree is about as wide as it is tall`);
  else ok.push(`the tree reaches ${rm.toFixed(2)} channel-heights out`);
}

// ── 6. the same seed is the same bolt, whatever Math.random is doing ────────────────────────────
//
// ⚠ NOT A PURITY PREFERENCE. Every bench in this repo pins `Math.random` to a constant so a picture
// can be compared with itself, and a tree grown out of a constant is a straight line with a fork at
// every node — so the one instrument that could look at this would have been looking at something
// the game never draws.
{
  const real = Math.random;
  const key = (b) => b.branches.map((x) => x.gen + ':' + x.pts.map((p) => p.ox.toFixed(6) + ',' + p.oy.toFixed(6) + ',' + p.f.toFixed(6)).join('|')).join('/');
  const a = key(growBolt(4242));
  Math.random = () => 0.42;
  const b = key(growBolt(4242));
  Math.random = () => 0.9;
  const c = key(growBolt(4242));
  Math.random = real;
  if (a !== b || a !== c) fail.push('growBolt is not reproducible — it is reading the global PRNG somewhere');
  else ok.push('the same seed grows the same tree under any Math.random');
  if (key(growBolt(4243)) === a) fail.push('two seeds grew the same tree — the seed is not reaching the generator');
  else ok.push('a different seed grows a different tree');
}

// ── 7. the detail dial is an actual dial ────────────────────────────────────────────────────────
{
  const bare = growBolt(77, { gens: 1 });
  const none = growBolt(77, { fork: 0 });
  const full = growBolt(77, { gens: 4, fork: 1 });
  if (bare.branches.length !== 1) fail.push(`gens: 1 grew ${bare.branches.length} branches — it has to be a bare trunk`);
  else if (none.branches.length !== 1) fail.push(`fork: 0 grew ${none.branches.length} branches`);
  else if (full.branches.length < 5) fail.push(`gens: 4 grew only ${full.branches.length} branches`);
  else ok.push('gens 1 and fork 0 each give a bare trunk; the full dial gives a tree');
}

// ── 8. the restrike envelope ────────────────────────────────────────────────────────────────────
//
// ⚠ THE BRANCHES ARE THE CLAIM. A later return stroke runs up the channel that is already there and
// barely touches the stepped leader's side branches, which is most of what makes a bolt read as
// flickering rather than as blinking. If `ch` and `br` never separate, the whole thing is a fade.
{
  let dead = 0, inverted = 0, separated = 0, lit = 0;
  for (const b of bolts) {
    if (boltBright(b, 0).ch < 0.9) lit++;
    if (boltBright(b, b.dur).ch !== 0 || boltBright(b, b.dur + 50).ch !== 0) dead++;
    let sep = 0;
    for (let t = 0; t < b.dur; t += 5) {
      const { ch, br } = boltBright(b, t);
      if (br > ch + 1e-9) inverted++;
      if (ch - br > 0.15) sep++;
    }
    if (sep > 0) separated++;
  }
  if (lit) fail.push(`${lit} bolt(s) are not fully lit at age 0 — the first return stroke is the brightest moment there is`);
  else ok.push('every bolt is at full brightness on the frame it is born');
  if (dead) fail.push(`${dead} bolt(s) still emit light at or past their own dur`);
  else ok.push('every bolt reaches exactly zero at dur');
  if (inverted) fail.push(`${inverted} sample(s) light the branches harder than the channel`);
  else ok.push('the branches are never brighter than the channel');
  const share = separated / bolts.length;
  if (share < 0.6) fail.push(`only ${(share * 100) | 0}% of bolts ever separate channel from branches — BOLT_BRANCH_RESTRIKE is inert`);
  else ok.push(`${(share * 100) | 0}% of bolts visibly restrike the channel alone`);
  if (!(BOLT_BRANCH_RESTRIKE > 0 && BOLT_BRANCH_RESTRIKE < 0.6)) fail.push('BOLT_BRANCH_RESTRIKE is outside the range that makes a restrike readable');
}

// ── 9. the painter breaks a polyline on a culled node ───────────────────────────────────────────
//
// ⚠ A WORLD CAMERA CLAMPS ANYTHING BEHIND THE EYE rather than failing, so a node behind you comes
// back at a wild lateral position; drawn through, one line whips across the whole frame. The
// projection answers null and the painter has to start a new subpath rather than skip the point.
{
  const calls = [];
  const ctx = {
    save() {}, restore() {}, beginPath() { calls.push(['begin']); },
    moveTo(x, y) { calls.push(['move', x, y]); }, lineTo(x, y) { calls.push(['line', x, y]); },
    stroke() {}, set strokeStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {},
    set lineJoin(v) {}, set globalAlpha(v) {}, set globalCompositeOperation(v) {},
  };
  const b = growBolt(5, { gens: 1, segs: 10 });
  // cull the middle third of the trunk, exactly as a camera would when it swings past your ear
  paintBolt(ctx, b, (p) => (p.f > 0.35 && p.f < 0.65 ? null : [p.ox * 100, (1 - p.f) * 100]), { ch: 1, br: 1 });
  const moves = calls.filter((c) => c[0] === 'move').length;
  const spans = calls.filter((c, i) => c[0] === 'line' && calls[i - 1] && calls[i - 1][0] !== 'begin'
    && Math.abs(c[2] - calls[i - 1][2]) > 25).length;
  if (!moves) fail.push('the painter drew nothing at all');
  else if (spans) fail.push(`${spans} segment(s) span the culled stretch — the polyline was drawn through the gap`);
  else ok.push(`a culled stretch breaks the channel into separate runs (${moves} subpaths over 3 passes) rather than a line across it`);
}

// ── 9b. and the painter spends the two brightnesses on the two things ───────────────────────────
//
// ⚠ `boltBright` SEPARATING THEM IS ONLY HALF THE CLAIM. It can return a channel at full strength
// and branches at a tenth and be ignored by a painter that spends `ch` on everything, which is one
// dropped ternary and leaves the restrike reading as a plain blink. Mutation-tested: every other
// claim here survives it.
{
  const alphas = (opts) => {
    const seen = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      set strokeStyle(v) { seen.push(String(v)); }, set lineWidth(v) {}, set lineCap(v) {},
      set lineJoin(v) {}, set globalAlpha(v) {}, set globalCompositeOperation(v) {},
    };
    paintBolt(ctx, growBolt(31337), (p) => [p.ox * 100, (1 - p.f) * 100], opts);
    return seen;
  };
  const lit = alphas({ ch: 1, br: 1 });
  const dim = alphas({ ch: 1, br: 0.1 });
  if (lit.length !== dim.length) fail.push('the two paints drew different numbers of strokes — the branch brightness is changing the GEOMETRY');
  else {
    const moved = lit.filter((v, i) => v !== dim[i]).length;
    // The trunk is the first three strokes (bloom, halo, sheath) plus its core; everything after is
    // a branch and every one of them has to move.
    if (!moved) fail.push('dropping the branch brightness changed no stroke at all — the painter spends the channel\'s brightness on everything');
    else if (lit[0] !== dim[0]) fail.push('dropping the branch brightness dimmed the TRUNK — ch and br are the wrong way round');
    else ok.push(`the branch brightness reaches ${moved}/${lit.length} strokes and never the trunk's first`);
  }
}

// ── 10. three readers, one tree ─────────────────────────────────────────────────────────────────
//
// ⚠ THERE WERE THREE GENERATORS AND THEY WERE THREE DIFFERENT PHENOMENA — a world bolt and an
// on-glass bolt in windshield.js and a third for the hangar door in hangar-ambience.js, each a
// nine-ish-node zigzag with its own jitter constant and its own width. A storm looked like one
// thing through the canopy, a slightly different thing on the glass in front of it, and a third
// thing from the hangar. A fourth would be free to appear the same way, so the check is that every
// reader calls the shared painter and that none of them has grown a while-loop of its own.
{
  const READERS = [
    ['client/game/js/panels/windshield.js', 'the canopy and the on-glass storm'],
    ['client/game/js/panels/aircraft3d.js', 'the hangar doorway'],
  ];
  for (const [f, what] of READERS) {
    const src = blank(fs.readFileSync(f, 'utf8'));
    if (!src.includes('paintBolt(')) fail.push(`${f} (${what}) does not call paintBolt`);
    else ok.push(`${what} paints through the shared painter`);
  }
  const amb = blank(fs.readFileSync('client/game/js/panels/hangar-ambience.js', 'utf8'));
  if (!amb.includes('growBolt(')) fail.push('hangar-ambience.js does not grow the shared tree');
  else ok.push('the hangar grows the shared tree');
  // and nobody kept a private zigzag: the old ones all pushed a literal pair or object per step
  for (const [f] of READERS) {
    const src = blank(fs.readFileSync(f, 'utf8'));
    if (/seg\.push\(\[/.test(src) || /pts\.push\(\[pts\[pts\.length/.test(src)) {
      fail.push(`${f} still builds a bolt polyline of its own`);
    }
  }
}

// ── 11. the channel is drawn after every grade that could crush it ──────────────────────────────
//
// The ordering claim, and the reason this file exists. See the header.
{
  // ⚠ RAW SOURCE HERE, WHERE EVERY OTHER SCAN IN THIS FILE BLANKS THE COMMENTS FIRST. `blank` wipes
  // a template literal WHOLE, and the wash this is looking for IS one —
  // `rgba(6,8,14,${(0.62 * dark).toFixed(3)})` — so a blanked scan cannot see the line it exists to
  // find, and reports the check as stale rather than the ordering as wrong. The price of reading raw
  // is that windshield.js names these identifiers in its own prose a few lines above the code, so
  // every anchor below has to be a shape that only the CODE takes: a call with its arguments, not a
  // function name.
  const src = fs.readFileSync('client/game/js/panels/windshield.js', 'utf8');
  const at = (needle, label) => {
    // ⚠ indexOf, AND THE ANCHOR HAS TO BE THE CALL RATHER THAN THE NAME. `applyStormGrade` appears
    // twice in raw source — the call up here and its own definition thirty thousand lines down — so
    // a lastIndexOf finds the definition, decides the grade runs after the draw, and reports the
    // ordering as broken on a file that is correct.
    const i = src.indexOf(needle);
    if (i < 0) { fail.push(`could not find ${label} in windshield.js — this check has gone stale`); return -1; }
    return i;
  };
  const draw = at('drawLightning(ctx, boltCam', 'the channel draw');
  const grade = at('applyStormGrade(ctx, W, H, horizonY, wsv,', 'the storm grade');
  const dark = at('(0.62 * dark).toFixed(3)', 'the headlamps-off wash');
  const glass = at('drawGlass(ctx, W, H, WX_EVENT_AS[wx]', 'the on-glass weather');
  if (draw > 0 && grade > 0 && dark > 0) {
    if (draw < grade) fail.push('the channel is drawn BEFORE applyStormGrade — the grade collapses it to a grey wire');
    else if (draw < dark) fail.push('the channel is drawn BEFORE the headlamps-off wash — a strike gets dimmer because the driver forgot the lamps');
    else ok.push('the channel is drawn after the storm grade and after the headlamps-off wash');
  }
  // ⚠ AND STILL UNDER THE GLASS. The cab trim, the windscreen post and the water running down the
  // outside of the pane are in front of YOU, not in front of the weather.
  if (draw > 0 && glass > 0) {
    if (draw > glass) fail.push('the channel is drawn over the on-glass weather — the rain on your own windscreen is in front of the storm');
    else ok.push('the channel is still drawn under the glass');
  }
  // ⚠ ONE ENVELOPE FOR THE FLOOD AND THE CHANNEL. They used to be two expressions and the pane went
  // white on a smooth hump while the bolt stuttered underneath it.
  // ⚠ AND THE FLOOD IS CHECKED BY NAME, not by a count. windshield.js reads `boltBright` three
  // times — the channel, the on-glass bolt and the flood — so "at least two" survives the flood
  // growing a sine of its own again, which is exactly the regression the claim is for.
  const fl = src.indexOf('flash = Math.max(flash,');
  if (fl < 0) fail.push('could not find the flood accumulator in windshield.js — this check has gone stale');
  else if (!src.slice(fl, fl + 200).includes('boltBright(')) {
    fail.push('the flood does not read boltBright — it has grown a second envelope, so the pane and the channel disagree about when the strike happened');
  } else ok.push('the flood and the channel read one envelope');
}

for (const m of ok) console.log('  ✓ ' + m);
if (fail.length) {
  console.log('\n✗ bolt — ' + fail.length + ' problem(s):');
  for (const m of fail) console.log('  ' + m);
  process.exit(1);
}
console.log('\n✓ bolt — the channel grounds, the branches leave and taper, a restrike lights the channel alone, and nothing draws a strike underneath the grade that would flatten it.');
