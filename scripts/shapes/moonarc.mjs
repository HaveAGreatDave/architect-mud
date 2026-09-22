// moonarc — is the moon where its phase says it is, and is the night lit from where it is?
//
//   node scripts/shapes/moonarc.mjs
//   node scripts/shapes/moonarc.mjs --report    # the whole month, hour by hour
//
// `getMoonPhase` has been a real synodic cycle off the world calendar for as long as the canopy
// has drawn a phase, and the ARC under it was pinned at 18:30-05:30 every night whatever that
// phase said — so a thin crescent rode high at midnight, which is a thing the sky cannot do. The
// phase IS the sun-moon angle, so the moon lags the sun by `phase` of a day and transits at
// `12 + phase*24`; everything else (a full moon up all night, a new moon never up at night at
// all, a crescent low beside the dusk or the dawn) falls out of that one line.
//
// ⚠ EVERY WAY THIS BREAKS IS A CORRECT-LOOKING FRAME WITH THE WRONG THING IN IT, which is why it
// needs a gate rather than a screenshot. A moon drawn on a night it should be absent from, a moon
// absent from a night it should be up on, a sun disc at 2 a.m. because the moon branch declined
// and the code fell through to the other one, a night city lit from a fixed north-west corner
// while a full moon crosses the sky — none of those throws, none moves a budget, and the only
// witness is somebody who happens to know what the sky should be doing on that particular night.
//
// ⚠ AND THE MIGRATION INVARIANT IS THE FIRST CHECK, not an afterthought. `moonPh` defaults to 0.5
// when the wire carries no moon, and at 0.5 the arc is 18:00-06:00 against the 18:30-05:30 that
// was hard-coded — so every harness, every bench and every caller that does not send a moon must
// draw the sky it drew before. If that check ever fails, every pinned frame in the repo moved.
//
// Mutation-tested 6 of 6: restoring the old fixed arc, dropping the `mArc.up` gate on the disc,
// letting the disc fall through to the sun branch, pinning the night key back to its literal,
// replacing the spherical limb solve with the planar one, and returning the fill regardless of
// the moon all fail at least one case here.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
// ⚠ Imported directly rather than reached through a frame: GL is never installed headlessly (every
// harness here hands in a hook that answers null), so nothing a rendered frame publishes can say
// which way the shadow MAP is pointing. This is the only way to ask.
import { lightMatrix } from '../../client/game/js/panels/gl/camera.js';
import { readFileSync } from 'node:fs';
import { moonPhaseOf } from '../../client/shared/moon.js';

const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
const ws = await loadWindshield();
stubCanvas('__moon', W, H);

const problems = [];
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ── 1. THE ARC IS THE PHASE ──────────────────────────────────────────────────
// Rise is transit − 6 and transit is 12 + phase·24, so the moon rises 48 min later each day of
// the month. Asserted as the RELATIONSHIP rather than as a table of hours, because a table is a
// second copy of the formula and would agree with any bug that was in both.
for (const ph of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
  const rise = (6 + ph * 24) % 24, transit = (rise + 6) % 24;
  const a = ws.moonArc(transit, ph);
  if (!a.up) problems.push(`phase ${ph}: the moon is not up at its own transit`);
  if (!near(a.elev, 1, 1e-9)) problems.push(`phase ${ph}: elevation at transit is ${a.elev.toFixed(4)}, not 1`);
  if (!near(a.az, 180, 1e-9)) problems.push(`phase ${ph}: transit bearing is ${a.az.toFixed(2)}°, not due south`);
  // Just inside each end of the arc it is up; just outside, down. A 12-hour arc, like the sun's.
  if (!ws.moonArc((rise + 0.1) % 24, ph).up) problems.push(`phase ${ph}: down 6 min after its own moonrise`);
  if (!ws.moonArc((rise + 11.9) % 24, ph).up) problems.push(`phase ${ph}: down 6 min before its own moonset`);
  if (ws.moonArc((rise + 12.1) % 24, ph).up) problems.push(`phase ${ph}: still up 6 min after its own moonset`);
  if (ws.moonArc((rise - 0.1 + 24) % 24, ph).up) problems.push(`phase ${ph}: already up 6 min before its own moonrise`);
}

// ── 2. THE FULL MOON IS WHAT SHIPPED ─────────────────────────────────────────
// The old arc ran 18:30-05:30 and transited at midnight. The new one at phase 0.5 runs 18:00-06:00
// and transits at midnight, so it must be up across the whole of the old window and then some.
{
  const full = (h) => ws.moonArc(h, 0.5);
  if (!near(full(0).elev, 1, 1e-9)) problems.push('a full moon does not transit at midnight — every pinned night frame just moved');
  for (const h of [18.5, 20, 22, 0, 2, 4, 5.4]) {
    if (!full(h).up) problems.push(`a full moon is down at ${h}:00, inside the arc that used to be hard-coded`);
  }
  if (!near(full(22).az, 150, 1e-9)) problems.push(`a full moon at 22:00 bears ${full(22).az.toFixed(1)}°, not SSE — four hours up out of twelve, so still east of south`);
  if (!near(full(2).az, 210, 1e-9)) problems.push(`a full moon at 02:00 bears ${full(2).az.toFixed(1)}°, not SSW`);
}

// ── 3. A CRESCENT IS NEVER HIGH AT MIDNIGHT ──────────────────────────────────
// The defect, stated as the thing it made possible. A crescent is by definition close to the sun,
// so at the sun's antipode it must be near the horizon or under it.
for (const ph of [0, 0.05, 0.1, 0.9, 0.95]) {
  const a = ws.moonArc(0, ph);
  if (a.elev > 0.35) problems.push(`phase ${ph} is ${(a.elev * 55).toFixed(0)}° up at midnight — a crescent cannot be there`);
}
// …and a new moon is not up at ANY dark hour, which is what makes a moonless night a real state.
for (const h of [19.5, 21, 23, 1, 3, 4.5]) {
  if (ws.moonArc(h, 0).up) problems.push(`a new moon is up at ${h}:00 — it is with the sun, by definition`);
}
// A first quarter is up for the FIRST half of the night and gone by the small hours; a last
// quarter is the mirror. Each one half a night, at opposite ends, which is the whole point.
if (!ws.moonArc(20, 0.25).up) problems.push('a first quarter is down at 20:00 — it should be high in the south');
if (ws.moonArc(3, 0.25).up) problems.push('a first quarter is still up at 03:00 — it sets at midnight');
if (ws.moonArc(20, 0.75).up) problems.push('a last quarter is up at 20:00 — it does not rise until midnight');
if (!ws.moonArc(3, 0.75).up) problems.push('a last quarter is down at 03:00 — it should be climbing the east');

// ── 4. THE HORNS POINT AT THE SUN, SOLVED SPHERICALLY ────────────────────────
// The sun on its own unclamped arc, which is where paintWindshield takes it from.
const sunAt = (h) => ({ az: 90 + ((h - 6) / 12) * 180, el: Math.sin(((h - 6) / 12) * Math.PI) * 62 });
{
  // Full moon at transit: the sun is under your feet almost exactly opposite, so the lit limb
  // faces straight down. ⚠ This is the case the planar (Δaz, Δel) version gets ~48° wrong, because
  // the azimuth difference is a degenerate ±180 — it is the reason the solve is spherical.
  const a = ws.moonArc(0, 0.5), s = sunAt(0);
  const t = ws.limbTilt(a.az, a.elDeg, s.az, s.el);
  if (!near(t, Math.PI / 2, 0.02)) problems.push(`a full moon's limb tilts ${(t * 180 / Math.PI).toFixed(1)}°, not 90° (straight down)`);
}
{
  // A young crescent setting in the west at dusk: the sun is below it and further round toward the
  // north-west, so the lit limb faces down and to the RIGHT — tilt strictly between 0 and π/2.
  const ph = 0.1, rise = (6 + ph * 24) % 24, h = 19.5;
  const a = ws.moonArc(h, ph), s = sunAt(h);
  if (!a.up) problems.push(`a ${ph} crescent is already down at ${h}:00 — the dusk case cannot be checked`);
  const t = ws.limbTilt(a.az, a.elDeg, s.az, s.el);
  if (!(t > 0.05 && t < Math.PI / 2 - 0.05)) problems.push(`a young crescent at dusk tilts ${(t * 180 / Math.PI).toFixed(1)}° — the lit limb should face down-right, toward the set sun`);
  if (REPORT) console.log(`  young crescent rise ${rise.toFixed(1)}h, tilt ${(t * 180 / Math.PI).toFixed(1)}°`);
}
{
  // An old crescent rising in the east before dawn is the mirror: the sun is below and further
  // round toward the north-east, so the limb faces down-LEFT.
  const ph = 0.9, h = 4.5;
  const a = ws.moonArc(h, ph), s = sunAt(h);
  const t = ws.limbTilt(a.az, a.elDeg, s.az, s.el);
  if (!(t > Math.PI / 2 + 0.05 && t < Math.PI - 0.05)) problems.push(`an old crescent at dawn tilts ${(t * 180 / Math.PI).toFixed(1)}° — the lit limb should face down-left`);
}
// It never answers NaN, which would rotate the canvas by NaN and take the disc off the frame with
// no error anywhere. Swept over the month and the clock, including both degenerate separations.
for (let ph = 0; ph < 1; ph += 1 / 64) {
  for (let h = 0; h < 24; h += 0.25) {
    const a = ws.moonArc(h, ph), s = sunAt(h);
    const t = ws.limbTilt(a.az, a.elDeg, s.az, s.el);
    if (!Number.isFinite(t)) { problems.push(`limbTilt is not finite at phase ${ph.toFixed(3)} hour ${h}`); ph = 2; break; }
  }
}

// ── 5. THE NIGHT IS LIT FROM WHERE THE MOON IS ───────────────────────────────
// keyDir's contract is a bearing AND a length: the caller hands in its own fill, the moon arrives
// scaled to match it, and at no moon the fill comes back untouched. That last one is what keeps a
// moonless night looking exactly like every night looked before.
{
  const FILL = [-0.62, -0.62], len = Math.hypot(...FILL);
  const day = ws.keyDir({ elev: 0.8, dir: [0, 1], moonElev: 0, moonDir: [1, 0] }, FILL);
  if (!(day[0] === 0 && day[1] === 1)) problems.push('by day the key is not the sun');
  const none = ws.keyDir({ elev: 0, dir: [1, 0], moonElev: 0, moonDir: [0.5, 0.5] }, FILL);
  if (!near(none[0], FILL[0], 1e-9) || !near(none[1], FILL[1], 1e-9)) problems.push('with no moon up the key is not the caller\'s own fill — every moonless night just changed');
  const fullUp = ws.keyDir({ elev: 0, dir: [1, 0], moonElev: 1, moonDir: [0, 1] }, FILL);
  if (!near(Math.hypot(...fullUp), len, 1e-9)) problems.push(`a full moon overhead changed the night's brightness (${Math.hypot(...fullUp).toFixed(3)} vs ${len.toFixed(3)}) — this may only move the bearing`);
  if (!near(fullUp[1] / len, 1, 1e-9)) problems.push('a full moon overhead does not light from the moon');
  // ⚠ AND AT EVERY PHASE IN BETWEEN, not just the two ends. The first cut summed the fill and
  // the moon as two real lights, which cancel — a half moon halfway up came out at 0.13 of the
  // fill's length, and a short key is not a dimmer night but a FLAT one, every wall in the city
  // sitting at litC 0.5 whichever way it faces. That is the exact thing the fill was there to buy.
  for (let mm = 0.05; mm < 1; mm += 0.05) {
    for (const h of [19, 21, 23, 1, 3, 5]) {
      const k = ws.keyDir({ elev: 0, dir: [1, 0], moonElev: mm, moonDir: ws.moonArc(h, 0.5).dir }, FILL);
      const kl = Math.hypot(...k);
      if (!near(kl, len, 1e-6)) {
        problems.push(`the key is ${(kl / len).toFixed(2)} of the fill's length at moon weight ${mm.toFixed(2)}, hour ${h} — the night city goes flat, not dark`);
        mm = 2; break;
      }
    }
  }
  // ⚠ AND IT NEVER JUMPS, which is the check the first two cuts of keyDir both needed and neither
  // had. A short key was caught by the length sweep above; renormalising that sum fixed the length
  // and made it an nlerp, which degenerates when fill and moon are OPPOSITE — and they reach
  // opposite, because the fill is north-west and the moon's arc runs through south-east. That was
  // found by eye in the Modelshop at 33° of swing in a quarter of an hour, not by this file, which
  // was passing. Every phase, every quarter hour, all night: a key that moves more than a few
  // degrees a step is every wall in the city changing its lit side between two server packets.
  for (let ph = 0; ph < 1; ph += 1 / 32) {
    let prev = null;
    for (let h = 12; h <= 36; h += 0.25) {
      const a = ws.moonArc(h % 24, ph);
      const mw = a.up ? a.elev * (0.2 + (1 - Math.cos(ph * 2 * Math.PI)) / 2 * 0.8) : 0;
      const k = ws.keyDir({ elev: 0, dir: [1, 0], moonElev: mw, moonDir: a.dir }, FILL);
      const bearing = Math.atan2(k[1], k[0]) * 180 / Math.PI;
      if (prev !== null) {
        const step = Math.abs(((bearing - prev + 540) % 360) - 180);
        // 22°, bracketed rather than picked: the shipping rotation's own worst step is 14.5° (at a
        // full moon's moonrise, where the turn to be made is widest and the weight ramps fastest),
        // and the nlerp bug measured 33° at this sampling and heads for 180° at the crossing.
        if (step > 22) {
          problems.push(`the night key jumps ${step.toFixed(1)}° in one quarter-hour at ${(h % 24).toFixed(2)}h, phase ${ph.toFixed(3)} — the whole city swaps its lit side between two packets`);
          ph = 2; break;
        }
      }
      prev = bearing;
    }
  }
  // And it MOVES across the night, which is the whole feature. Two hours apart, two bearings.
  const k1 = ws.keyDir({ elev: 0, dir: [1, 0], moonElev: 0.9, moonDir: ws.moonArc(21, 0.5).dir }, FILL);
  const k2 = ws.keyDir({ elev: 0, dir: [1, 0], moonElev: 0.9, moonDir: ws.moonArc(3, 0.5).dir }, FILL);
  if (near(k1[0], k2[0], 0.05) && near(k1[1], k2[1], 0.05)) problems.push('the night key does not move between 21:00 and 03:00 — it is still a fixed fill');
}

// ── 6. AND THE FRAME DRAWS THE BODY THAT IS ACTUALLY THERE ───────────────────
// The three arithmetic sections above are all true of a renderer that ignores every one of them,
// so this is the one that reads the frame. `lastViewState().body` is published for exactly this
// (see the note on it): which disc a frame drew is otherwise unobservable, and "none" is a real
// and correct answer that no pixel count can tell from a bug.
const N = 21, R = 10;
const map = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ kind: 'land', biome: 'parkland', flr: 0 })));
const view = (hour, moon, heading) => ({
  cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, hour, moon,
  weather: 'clear', speed: 0, map, heading, mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
});
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const bodyAt = (hour, moon, heading = 180) => { ws.paintWindshield('__moon', view(hour, moon, heading)); return ws.lastViewState(); };
// ⚠ EVERY CASE IS SWEPT ROUND THE COMPASS, and a first cut that did not let a real mutant through.
// A body is culled when it is behind you, so with one heading "nothing was drawn" is also the
// answer for a moon that IS being wrongly drawn and merely happens to be over your shoulder — and
// a moon that has not risen carries elevation 0 and a bogus bearing, so it lands ON the horizon,
// which looks entirely plausible from the one heading that can see it. Restoring that bug passed
// at heading 180 and fails at 0.
const HEADINGS = [0, 90, 180, 270];

const CASES = [
  [12, 0.5, 'sun', 'noon'],
  [2, 0.5, 'moon', 'a full moon at 2 a.m.'],
  [2, 0, null, 'a new moon at 2 a.m. — the sky is empty and that is correct'],
  [2, 0.25, null, 'a first quarter at 2 a.m. — it set at midnight'],
  [20, 0.25, 'moon', 'a first quarter at 20:00 — high in the south'],
  [20, 0.75, null, 'a last quarter at 20:00 — it has not risen'],
  [4, 0.75, 'moon', 'a last quarter at 4 a.m. — climbing the east'],
];
for (const [hour, moon, want, why] of CASES) {
  const drew = new Set();
  let lv = null;
  for (const hdg of HEADINGS) { lv = bodyAt(hour, moon, hdg); drew.add(lv.body); }
  // A body that is up and in front from SOME heading is the case; one drawn from none of four is
  // the sky being empty. So `want` must be the only answer the compass ever gives.
  for (const hdg of HEADINGS) {
    const at = bodyAt(hour, moon, hdg);
    if (at.body !== want && !(want !== null && at.body === null)) {
      problems.push(`${why}, facing ${hdg}°: drew ${at.body === null ? 'nothing' : at.body}, wanted ${want === null ? 'nothing' : want}`);
    }
  }
  if (want !== null && !drew.has(want)) problems.push(`${why}: drew no ${want} from any of the four headings`);
  if (REPORT) console.log(`  ${String(hour).padStart(2)}:00 ph ${moon} → ${[...drew].map((b) => b || '—').join('/')}  ${lv.moon.up ? `az ${lv.moon.az.toFixed(0)}° el ${lv.moon.el.toFixed(0)}°` : '(moon down)'}  key ${lv.key ? lv.key.map((n) => n.toFixed(2)).join(',') : '—'}`);
}
// The key the world pass actually armed, not the one keyDir would have returned if asked.
{
  const lv = bodyAt(2, 0.5);
  if (!lv.key) problems.push('the frame published no key direction — the world pass did not arm one');
  else if (near(lv.key[0], -0.707, 1e-3) && near(lv.key[1], -0.707, 1e-3)) problems.push('a full moon at 2 a.m. and the city is still lit from the fixed north-west fill');
  const dark = bodyAt(2, 0);
  if (dark.key && !(near(dark.key[0], -0.707, 1e-3) && near(dark.key[1], -0.707, 1e-3))) {
    problems.push(`a new-moon night is not lit from the fill it has always been lit from (${dark.key.join(',')})`);
  }
}

// ── 7. THE CASTER, WHICH IS BUILT AND SWITCHED OFF ───────────────────────────
// `RENDER_TUNE.moonShadow` ships at 0 because a shadow is the absence of light and nothing lights
// the ground at night — measured in the Modelshop, the whole frame moves by at most 3 of 255 even
// at the sun's own maximum alpha, because the ink `[8,10,14]` IS the night ground `[10,14,19]`.
// So this section holds the plumbing to the shape it will need on the day the ground is lit, and
// holds the off-switch to being genuinely inert. Without it the whole thing quietly rots: it is
// code nobody can see the effect of, behind a flag nobody turns on.
{
  const T = ws.RENDER_TUNE;
  const was = T.moonShadow;
  const castAt = (hour, moon) => bodyAt(hour, moon).cast;
  // ⚠ THE OFF-SWITCH IS THE FIRST CHECK, and it is an arithmetic claim rather than a branch: at 0
  // the night must carry NO caster at all, which is what makes the shipped renderer provably the
  // one that shipped. `len` is the switch both consumers read.
  T.moonShadow = 0;
  for (const [h, ph] of [[0, 0.5], [22, 0.5], [3, 0.4]]) {
    const s = castAt(h, ph);
    if (s.len !== 0 || s.alpha !== 0) problems.push(`moonShadow 0 still casts at ${h}:00 phase ${ph} (len ${s.len}, alpha ${s.alpha})`);
    if (s.moon !== 0) problems.push(`moonShadow 0 still reports a caster weight at ${h}:00`);
  }
  T.moonShadow = 1;
  // A full moon on the meridian casts; a new moon never does; a crescent never reaches the bar.
  const full = castAt(0, 0.5);
  if (!(full.len > 0)) problems.push('a full moon on the meridian casts no shadow');
  if (!(full.alpha > 0)) problems.push('a full moon on the meridian casts at alpha 0');
  // ⚠ A CRESCENT CASE HAS TO BE UP TO MEAN ANYTHING, and the first cut of this check was vacuous:
  // every phase it tested is below the horizon at every hour it tested, so it passed without the
  // threshold being consulted once — and a mutation that put a floor back in the weight survived
  // it. These are phases that ARE up at a dark hour. The claim is arithmetic: `lit * elev` with
  // elev <= 1 can never exceed the phase's own illum, so anything under illum 0.25 is out at every
  // elevation, and the pairs below are chosen to straddle that.
  const CRESCENT_UP = [[0.125, 19.5], [0.125, 20.5], [0.1, 19.5], [0.875, 4.5], [0.9, 4.5]];
  for (const [ph, h] of CRESCENT_UP) {
    const a = ws.moonArc(h, ph);
    if (!a.up) problems.push(`the crescent case phase ${ph} at ${h}:00 is not up — this check proves nothing`);
    const s = castAt(h, ph);
    if (s.len > 0) problems.push(`phase ${ph} (illum ${((1 - Math.cos(ph * 2 * Math.PI)) / 2).toFixed(2)}) casts a shadow at ${h}:00 — a crescent throws none`);
  }
  // ⚠ AND THE STRENGTH IS PROPORTIONAL, WITH NO FLOOR UNDER IT. This is the half that catches a
  // weight taken from `moonElev` (which carries a `0.2 + lit * 0.8` floor for the water's sake):
  // that floor leaves the on/off answer alone and quietly lifts every dim moon's shadow toward a
  // full one's. At one elevation, halving the illum must halve the alpha.
  // ⚠ COMPARED AT EACH MOON'S OWN TRANSIT, so elevation is exactly 1 on both sides and the ratio
  // is purely the illum. Picking two arbitrary hours instead is how the first cut of this check
  // failed to catch anything: the gibbous it chose was low enough to fall under the threshold, so
  // both sides read 0 and the comparison was skipped entirely.
  {
    const A = 0.5, B = 0.32;                          // both transit inside the dark window
    const tA = (12 + A * 24) % 24, tB = (12 + B * 24) % 24;
    const litA = (1 - Math.cos(A * 2 * Math.PI)) / 2, litB = (1 - Math.cos(B * 2 * Math.PI)) / 2;
    const a = castAt(tA, A), b = castAt(tB, B);
    if (!(a.alpha > 0) || !(b.alpha > 0)) {
      problems.push(`the alpha-ratio check has nothing to compare (${a.alpha} / ${b.alpha}) — both moons must cast at their own transit`);
    } else {
      const want = litA / litB, got = a.alpha / b.alpha;
      if (!near(got, want, 0.02)) {
        problems.push(`shadow alpha is ${got.toFixed(3)}x between a full and a ${litB.toFixed(2)}-lit moon at the same elevation, where the illum says ${want.toFixed(3)}x — something has put a floor under the weight`);
      }
    }
  }
  // ⚠ AND IT FALLS THE RIGHT WAY, which is the half that cannot be seen while the flag is off.
  // `shadowDir` must be the opposite of the moon's own bearing, and `castDir` must be the moon —
  // NOT `dir`, which still means the sun and at 2 a.m. points at a body under your feet.
  for (const h of [20.5, 0, 3.5]) {
    const a = ws.moonArc(h, 0.5), s = castAt(h, 0.5);
    if (!near(s.dir[0], a.dir[0], 1e-9) || !near(s.dir[1], a.dir[1], 1e-9)) {
      problems.push(`at ${h}:00 the shadow map is aimed at [${s.dir}] and the moon is at [${a.dir}]`);
    }
    if (!near(s.shadowDir[0], -a.dir[0], 1e-9) || !near(s.shadowDir[1], -a.dir[1], 1e-9)) {
      problems.push(`at ${h}:00 the shadow falls toward [${s.shadowDir}] rather than away from the moon`);
    }
    // and it must NOT be the sun's bearing, which is the bug that looks like nothing
    const sunAng = ((h - 6) / 12) * Math.PI;
    if (near(s.dir[0], Math.cos(sunAng), 1e-6) && near(s.dir[1], Math.sin(sunAng), 1e-6)) {
      problems.push(`at ${h}:00 the caster is still the sun, which is below the horizon`);
    }
  }
  // By day it is the sun and nothing here touches it.
  const day = castAt(12, 0.5);
  if (!near(day.dir[0], 0, 1e-9) || !near(day.dir[1], 1, 1e-9)) problems.push('at noon the caster is not the sun due south');
  if (!(day.alpha > 0.3)) problems.push(`a noon sun casts at alpha ${day.alpha} — the day path moved`);
  T.moonShadow = was;

  // ⚠ AND THE SHADOW MAP HAS TO BE AIMED AT IT TOO, which the frame cannot answer: GL is never
  // installed headlessly, so `LAST_VIEW.cast` proves the 2-D pre-pass and says nothing about the
  // GPU. `lightMatrix` is exported, so ask it directly. It must READ `castDir` and fall back to
  // `dir` — the fallback is what keeps every existing caller and every bare `{dir, len}` harness
  // on the matrix it had, and the read is what stops the map being aimed at a sun under your feet
  // while the ground pre-pass lays its shadows the other way.
  const bounds = { x0: -4, x1: 4, y0: -4, y1: 4, z0: 0, z1: 3 };
  const sunOnly = { dir: [0, 1], len: 1.2 };
  const moonCast = { dir: [0, 1], castDir: [-0.7, 0.71], len: 1.2 };
  const asMoon = { dir: [-0.7, 0.71], len: 1.2 };
  const m1 = lightMatrix(sunOnly, bounds), m2 = lightMatrix(moonCast, bounds), m3 = lightMatrix(asMoon, bounds);
  const same = (a, b) => a.every((v, i) => near(v, b[i], 1e-12));
  if (!same(m2, m3)) problems.push('lightMatrix ignores castDir — the GL shadow map is still aimed at the sun');
  if (same(m1, m2)) problems.push('lightMatrix gives the same matrix for a sun and a moon caster');
  if (!same(m1, lightMatrix({ dir: [0, 1], len: 1.2 }, bounds))) problems.push('lightMatrix is not deterministic');
  // The fallback: no castDir at all must be exactly the old behaviour.
  if (!same(lightMatrix({ dir: [0, 1], len: 1.2, castDir: undefined }, bounds), m1)) {
    problems.push('lightMatrix without a castDir no longer matches what it returned before');
  }
}

// ── 8. THE FACE IS TIDALLY LOCKED ────────────────────────────────────────────
// The moon is not a disc of grey patches, it is a FACE: six maria, three ray systems and a pock
// field, and the one thing that never changes about it is its orientation. `tilt` is the angle of
// the BRIGHT LIMB, it tracks the sun, and it sweeps most of a circle over a month (46° → 13° →
// 90° → 171° → 135° at each phase's own best hour) — so the face was drawn inside that rotation
// and the man in the moon spun through 158° between a waxing and a waning gibbous of the SAME
// illumination, four days apart.
//
// ⚠ NO HEADLESS HARNESS CAN SEE THIS IN PIXELS — the DOM stub has no raster, so `getImageData`
// answers nothing. What it CAN see is the transform in force at the moment the face is blitted,
// which is the claim exactly: net zero rotation, however the terminator is turned.
{
  const el = stubCanvas('__face', 320, 200);
  const raw = el.getContext.bind(el);
  let rot = 0; const stack = []; const blits = [];
  el.getContext = (...a) => {
    const c = raw(...a);
    if (!c) return c;
    return new Proxy(c, {
      get(t, k) {
        const v = t[k];
        if (k === 'rotate') return (r) => { rot += r; return typeof v === 'function' ? v.call(t, r) : undefined; };
        if (k === 'save') return (...q) => { stack.push(rot); return typeof v === 'function' ? v.apply(t, q) : undefined; };
        if (k === 'restore') return (...q) => { if (stack.length) rot = stack.pop(); return typeof v === 'function' ? v.apply(t, q) : undefined; };
        if (k === 'drawImage') return (...q) => { blits.push({ src: q[0], rot }); return typeof v === 'function' ? v.apply(t, q) : undefined; };
        if (k === 'setTransform') return (...q) => { rot = 0; stack.length = 0; return typeof v === 'function' ? v.apply(t, q) : undefined; };
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  };
  const N2 = 21;
  const map2 = Array.from({ length: N2 }, () => Array.from({ length: N2 }, () => ({ kind: 'land', biome: 'parkland', flr: 0 })));
  // Four phases whose terminator angles are spread right round; the face must not follow any of it.
  for (const [ph, hr] of [[0.5, 0], [0.42, 22.2], [0.58, 1.9], [0.25, 19.5], [0.75, 4.5]]) {
    const arc = ws.moonArc(hr, ph);
    if (!arc.up) { problems.push(`the face case phase ${ph} at ${hr}:00 is not up`); continue; }
    rot = 0; stack.length = 0; blits.length = 0;
    ws.paintWindshield('__face', {
      cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, hour: hr, moon: ph,
      weather: 'clear', speed: 0, map: map2, heading: arc.az, mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
    });
    const lv = ws.lastViewState();
    if (lv.body !== 'moon') { problems.push(`phase ${ph} at ${hr}:00 drew ${lv.body} — the face check needs a moon`); continue; }
    // ⚠ BY IDENTITY, NEVER BY SIZE. A first cut matched the blit on its canvas width against a
    // radius LAST_VIEW did not carry, so the expression quietly matched nothing, fell through to
    // "any square blit", and would have passed whatever the renderer did. `moonR` is published for
    // exactly this: fetch the sprite this frame used and find the call that drew that object.
    if (lv.moonR == null) { problems.push('the frame published no moonR — the face blit cannot be identified'); continue; }
    const face = ws.moonFaceSprite(lv.moonR);
    const mine = blits.filter((b) => b.src === face);
    if (!mine.length) { problems.push(`phase ${ph}: the face sprite was never blitted — the moon drew no face`); continue; }
    const worst = Math.max(...mine.map((b) => Math.abs(((b.rot + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI)));
    if (worst > 0.02) {
      problems.push(`phase ${ph} blits its face under ${(worst * 180 / Math.PI).toFixed(1)}° of rotation (tilt is ${Math.round(lv.moonTilt * 180 / Math.PI)}°) — the face is turning with the terminator`);
    }
  }
  // ⚠ AND THE BAKE IS A CACHE, WHICH IS THE ONLY REASON THE DETAIL IS AFFORDABLE. Six maria were
  // six gradients a frame before this and the rays would have taken it past sixty; the face never
  // changes, so it is a sprite. Same radius must hand back the SAME object, and the cache must be
  // bounded — an unbounded canvas cache is a leak that only shows after somebody plays for an hour.
  const s1 = ws.moonFaceSprite(14), s2 = ws.moonFaceSprite(14);
  if (s1 !== s2) problems.push('moonFaceSprite rebuilds the face for a radius it has already baked');
  if (ws.moonFaceSprite(14.4) !== s1) problems.push('moonFaceSprite does not round the radius — a slider drag would bake a canvas per pixel');
  for (let r = 4; r < 120; r++) ws.moonFaceSprite(r);
  const after = ws.moonFaceSprite(14);
  if (!after || !after.width) problems.push('the face cache returned nothing after being filled');
  // The tier floors: a big disc must carry more than a small one, or the detail is not there.
  if (!(ws.moonFaceSprite(30).width > ws.moonFaceSprite(10).width)) problems.push('the face sprite does not scale with the radius');
}

// ── DOES A MOON REACH THE SEATS AT ALL? ──────────────────────────────────────
//
// ⚠ EVERY CHECK ABOVE TAKES THE PHASE AS AN ARGUMENT, so all of them pass perfectly while no phase
// ever arrives. That is not hypothetical: `getEnvSnapshot()` in client/game/js/panels/environment.js
// never carried `moonPhase` at all, and helm-view.js and freelook-view.js have both built
// `{ moon: s.moonPhase }` off that snapshot since they shipped — so `v.moon` was `undefined`, the
// renderer took its documented 0.5 fallback, and those two seats drew a FULL MOON ON A FIXED
// 18:00-06:00 ARC on every clear night for months. Measured on 2087-03-14 at 23:10: azimuth 167.55
// and elevation 53.71 against the 232.04 and 33.83 the real phase gives. helm-view.js carried a
// comment the whole time asserting the opposite ("moonPhase rides the same snapshot, so the yacht
// helm gets the same moon as the cockpit for free").
//
// The migration-invariant check at the top of this file is what let it hide: 0.5-when-absent is a
// deliberate, documented default, so nothing here could tell a caller that legitimately has no moon
// from two seats that should have one and never got it. These claims are about the HAND-OFF, which
// is the half that is silent when wrong.
{
  const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const env = src('client/game/js/panels/environment.js');
  const moon = src('client/shared/moon.js');
  const srvEnv = src('server/engine/environment.js');

  // The snapshot the two seats read must actually carry the field they read.
  if (!/moonPhase: envMoon/.test(env)) {
    problems.push('getEnvSnapshot() in environment.js does not return moonPhase — helm-view and freelook-view both read `s.moonPhase` off it, so both fall back to a fixed half moon on every night of the year');
  }
  // ⚠ DERIVED FROM THE DATE, NEVER RETAINED OFF THE WIRE. `moonPhase` is on `getHUDPayload()` and so
  // rides `environment.sync`, `environment.daily` and the REST route — but NOT
  // `environment.clockTick`, which is the per-minute broadcast and the one that brings the date. A
  // retained field would be whatever the last daily tick said while the date moved on under it.
  if (!/envMoon = moonPhaseOf\(env\.date\)/.test(env)) {
    problems.push('environment.js does not derive the moon from the game date — the only wire route that carries the date (environment.clockTick) carries no moonPhase, so a retained field goes stale against its own date');
  }
  if (/envMoon\s*=\s*env\.moonPhase/.test(env)) {
    problems.push('environment.js retains moonPhase off the wire — environment.clockTick does not send one, so this pins the moon to the last daily tick');
  }

  // ⚠ ONE COPY OF THE ARITHMETIC. The server's own note on the season table records a verbatim
  // duplicate living in the weather plugin until 2026-08-20; the moon must not become the next one.
  if (!/export function moonPhaseOf/.test(moon)) problems.push('client/shared/moon.js does not export moonPhaseOf — the one definition both sides derive from');
  if (!/moonPhaseOf\(dateStr \|\| state\.date\)/.test(srvEnv)) {
    problems.push('server getMoonPhase no longer delegates to client/shared/moon.js — a second copy of the synodic arithmetic is a second thing to forget when the calendar changes');
  }
  if (/SYNODIC_DAYS\s*=/.test(srvEnv)) {
    problems.push('the synodic constant is back in server/engine/environment.js — that is the second copy this was extracted to remove');
  }

  // And the two ends must AGREE, not merely both exist. Compared against the expression the server
  // carried before the move, so this also pins the epoch offset: shifting it moves every night sky
  // in the game, and nothing else here would notice.
  const SYN = 29.53059;
  const before = (d) => ((((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000 - 6.7) / SYN) % 1) + 1) % 1;
  let drift = 0;
  for (let y = 2080; y <= 2090; y++) for (let m = 1; m <= 12; m++) for (const dd of [1, 8, 15, 22, 28]) {
    const s = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    if (!Object.is(before(s), moonPhaseOf(s))) drift++;
  }
  if (drift) problems.push(`${drift} dates now give a different phase than the expression that shipped — the epoch offset or the synodic month moved, which moves every night sky in the game`);

  // ⚠ A MALFORMED DATE MUST FALL BACK RATHER THAN PROPAGATE NaN, which the pre-move expression did:
  // NaN reaches drawMoon's gradient stops and throws inside a frame.
  for (const bad of [null, undefined, '', 'nonsense']) {
    if (!Number.isFinite(moonPhaseOf(bad))) problems.push(`moonPhaseOf(${JSON.stringify(bad)}) is not finite — NaN reaches drawMoon's gradient stops and throws inside a frame`);
  }
}

if (REPORT) {
  console.log('\n  hour-by-hour, one day in eight through the month:');
  for (let ph = 0; ph < 1; ph += 0.125) {
    const up = [];
    for (let h = 18; h < 30; h += 1) { const a = ws.moonArc(h % 24, ph); if (a.up) up.push(`${String(h % 24).padStart(2, '0')}`); }
    console.log(`   phase ${ph.toFixed(3)}  illum ${((1 - Math.cos(ph * 2 * Math.PI)) / 2).toFixed(2)}  up at ${up.join(' ') || '— never, after dark'}`);
  }
}

globalThis.performance = clock;
if (problems.length) {
  console.error(`moonarc: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('moonarc: the arc follows the phase, the limb faces the sun, and the night is lit from the moon');
