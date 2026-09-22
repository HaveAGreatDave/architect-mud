// THE COVERED DOCK — does the marina's own room draw, and is it the marina's own room?
//
// `drawHangarScene` has three venues now (the hangar, the truck depot, the dock) and exactly none
// of them had ever been executed outside a browser. That is the gap `shapes:smoke` exists for one
// file over, in the same words: until it was written, the only thing that ever ran a building model
// was a player flying past that particular building. A venue is worse, because there are three of
// them and a player only ever stands in one — a throw inside the dock branch is a marina that opens
// a blank screen, and nothing anywhere would say so.
//
// ⚠ IT PROVES THE ROOM RUNS, NOT THAT IT LOOKS RIGHT. There is no pixel comparison here. What it
// can check beyond "did it throw" is that the venue REACHED the branch at all — a mistyped venue
// string falls through to `drawHangarBackdrop` and draws a perfectly good aircraft hangar, which is
// the failure most likely to ship: it is a picture, it is lit, nothing is wrong with it, and it is
// the wrong building. So the backdrops are told apart by the calls they make.
import '../../scripts/shapes/dom-stub.mjs';
import { recordingCtx } from './dockscene-ctx.mjs';

const { drawHangarScene } = await import('../../client/game/js/panels/aircraft3d.js');

const SKIES = [
  ['none', null],
  ['night', { hour: 3, night: 0.92, weather: 'clear' }],
  ['noon', { hour: 13, night: 0, weather: 'rain' }],
];

let fails = 0;
const fail = (msg) => { console.error('  ✗ ' + msg); fails++; };
const ok = (msg) => console.log('  ✓ ' + msg);

function run(venue, n, sky) {
  const ctx = recordingCtx();
  const entries = Array.from({ length: n }, (_, i) => ({ id: 'b' + i, cls: 'hydro', livery: null }));
  const hits = drawHangarScene(ctx, { w: 640, h: 360, entries, selId: 'b0', sky, venue });
  return { ctx, hits: hits || [] };
}

// ── 1. It runs, at every hull count and every hour ───────────────────────────
for (const n of [0, 1, 2, 3]) {
  for (const [label, sky] of SKIES) {
    try {
      const { hits } = run('dock', n, sky);
      if (hits.length !== n) { fail(`dock n=${n} ${label}: ${hits.length} hit records for ${n} hulls`); continue; }
    } catch (e) {
      fail(`dock n=${n} ${label} threw: ${e.message}`);
    }
  }
}
if (!fails) ok('the dock draws at 0–3 hulls, at three hours, and hands back one hit record per hull');

// ── 2. It is the DOCK, and not the hangar wearing its name ───────────────────
//
// ⚠ AN UNKNOWN VENUE IS NOT AN ERROR IN THAT FUNCTION — it is an `else`, so a typo draws the
// aircraft hangar and everything downstream works perfectly. The three rooms are told apart by
// their own fills: the dock paints water in the blue-greens it lights from under the deck, the
// depot paints sodium, and the hangar paints neither.
// ⚠ THE HULLS ARE DRAWN THE SAME IN EVERY VENUE, so the identity check runs on an EMPTY room. A
// first cut swept a two-boat scene and found 336 "water" ops in the truck depot, every one of them
// a highlight on a race boat's own topsides — a test measuring precisely the thing that is constant
// across the subjects it is trying to tell apart.
const WATER = /^rgba\(120,200,206,|^rgba\(160,214,220,/;      // the under-deck pool, and its ripple
const counts = {};
for (const venue of ['dock', 'garage', 'hangar']) {
  const { ctx } = run(venue, 0, SKIES[1][1]);
  counts[venue] = ctx.ops.filter((o) => WATER.test(o)).length;
}
if (!counts.dock) fail('the dock painted no water at all — did the venue reach drawDockBackdrop?');
else if (counts.garage || counts.hangar) fail(`the water fill is not the dock's alone (garage ${counts.garage}, hangar ${counts.hangar})`);
else ok(`the dock is its own room — ${counts.dock} water ops, 0 in the depot and 0 in the hangar`);

// ── 3. The mouth opens with the traffic ──────────────────────────────────────
// `doorFrac` is derived from how many hulls are in here, the same way the hangar's door is, so a
// busy dock reads deeper. Wired as a constant it is a detail nobody would ever miss.
//
// ⚠ COMPARING THE WHOLE OP LOG WOULD PASS WHATEVER THE MOUTH DID, because a scene with four hulls
// in it differs from an empty one in several thousand ops that have nothing to do with the
// building. The mouth is ONE rect at a known height (mouthT = h * 0.12), so that is the rect to
// read — and its width is the claim.
const mouthW = (n) => {
  const ops = run('dock', n, SKIES[1][1]).ctx.ops;
  const hit = ops.find((o) => /^fillRect\([-\d.]+,43\.20,/.test(o));
  return hit ? Number(hit.split(',')[2]) : null;
};
const [w0, w4] = [mouthW(0), mouthW(4)];
if (w0 == null || w4 == null) fail('could not find the open end\'s own rect in the op log');
else if (!(w4 > w0)) fail(`the open end is ${w0.toFixed(1)}px empty and ${w4.toFixed(1)}px with four hulls in it`);
else ok(`the open end is sized off the traffic — ${w0.toFixed(0)}px empty, ${w4.toFixed(0)}px with four hulls`);

console.log(fails
  ? `\n✗ dock:scene — ${fails} failure(s)`
  : '\n✓ dock:scene — the marina\'s covered dock draws, at every hull count and every hour, and is not the hangar in disguise.');
process.exit(fails ? 1 : 0);
