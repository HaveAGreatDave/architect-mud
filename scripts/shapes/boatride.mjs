// THE BOAT RIDES THE WATER THAT IS DRAWN, AND THE WATER STAYS OFF HER DECK.
//
// `node scripts/shapes/boatride.mjs`. No DB, no browser, no files. Drives `stepBoat` and the seat's
// own `stepBoatRide` (flight-model.js) through a fresh and a strong breeze on five headings, for every
// hull, and at every frame asks the drawn sea — the swell, the wind sea and the chop, the three things
// the mesh displaces — how far it stands over her sheer at stations down both sides.
//
// ⚠ IT POSES HER AS THE RENDERER DRAWS HER, which is the whole point. The chase hull is `ownHullScale`
// in plan with its height exaggerated, sits on her lowest vertex, and is turned by `bank` in the
// aircraft's sense (starboard DOWN); the helm hull is full size off the eye. A check that posed her in
// the sim's own frame passed the sign bug this was written alongside: the sim's roll is starboard UP,
// the hull was handed it unsigned, and every boat leaned into the water rising beside her.
//
// ⚠ AND IT IS A RATE WITH A FLOOR, NOT A ZERO. A steep breaking crest over the bow of a race boat in a
// blow is a real thing and a little of it is right; what this refuses is the sea routinely standing
// over her: posed by her centre, the helm view had it up to 8% of frames running across a 20-30 kt
// sea, worst at the transom mid-jump, and that pose fails here.
import { stepBoat, stepBoatRide, boatFitPose, createBoatState, TYPES, BOAT_TYPES } from '../../client/game/js/panels/flight-model.js';
import { seaRoll, seaWind, seaChop, seaAmpsFor, SEA_AMP, SEA_TILE_M } from '../../client/shared/sea-swell.js';
import { boatGeom } from '../../client/shared/boat-house.js';
import { BOAT_ROWS } from '../../client/shared/vehicle-models.js';

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL  ' + m); } };

// The renderer's own numbers, restated because windshield.js cannot load headless: CONTACT_SIZE for a
// hull, the chase multiplier and the vertical exaggeration. ⚠ IF ANY OF THESE MOVES THERE, MOVE IT
// HERE: the gate below them asserts the restatement against the source text.
const CONTACT = 0.034, EXT_MUL = 6.0, VS = 1.6, CHOP_DRAWN = 0.055;
{
  const fs = await import('node:fs');
  const ws = fs.readFileSync(new URL('../../client/game/js/panels/windshield.js', import.meta.url), 'utf8');
  ok(/hydro: 0\.034 \};/.test(ws), 'windshield.js CONTACT_SIZE.hydro is no longer 0.034 — restate it here');
  ok(/OWN_EXT_MUL_BY_CLS = \{ truck: 7\.0, hydro: 6\.0 \}/.test(ws), 'windshield.js OWN_EXT_MUL_BY_CLS.hydro is no longer 6.0 — restate it here');
  ok(/const CONTACT_VS = 1\.6;/.test(ws), 'windshield.js CONTACT_VS is no longer 1.6 — restate it here');
  ok(/glSeaAmp: 0\.055,/.test(ws), 'windshield.js glSeaAmp (the drawn chop) is no longer 0.055 — restate it here');
  // The green-water sheet starts at her DECK. At her keel (`rideZ + SZ * 0.05`) it was up on 53-68%
  // of frames in any sea, which is the "waves wash over her" report with no water over the deck.
  ok(/z: \(v\.rideZ \|\| 0\) \+ deckUp/.test(ws) && /const deckUp = SZ \* CONTACT_VS \* \(row\.deckZ/.test(ws),
    'windshield.js ownHullWash no longer starts the green-water sheet at her deck');
}
// And both callers hand the renderer the sim's roll NEGATED: `bank` is starboard down. The ride above
// restates that negation, so without these two lines a caller that dropped it would pass here.
{
  const fs = await import('node:fs');
  const bv = fs.readFileSync(new URL('../../client/game/js/panels/boat-view.js', import.meta.url), 'utf8');
  const ix = fs.readFileSync(new URL('../../plugins/powerboat/index.js', import.meta.url), 'utf8');
  ok(/bank: -ride\.roll \* 180/.test(bv), 'boat-view.js hands the hull its roll without negating it — `bank` is starboard down');
  ok(/bank: -\(rig\.roll \|\| 0\) \* 180/.test(ix), 'plugins/powerboat/index.js hands a contact its roll without negating it');
  ok(/stepBoatRide\(/.test(bv) && /rideZ: st\.external \? ride\.heave/.test(bv), 'boat-view.js no longer poses the hull by stepBoatRide');
}
const D2R = Math.PI / 180;
const waterAt = (s, x, y, t) => seaRoll(x, y, t, s.seaRoll) + seaWind(x, y, t, s.seaWind) + seaChop(x, y, t) * s.seaChopH;

function sail(id, kt, hdg, lever, secs) {
  const p = TYPES[id], G = boatGeom(BOAT_ROWS[id]);
  const s = createBoatState(p);
  const a = seaAmpsFor(kt, 1.5, 50000);   // RENDER_TUNE.glSeaGain / glSeaFetch
  s.seaRoll = a.roll; s.seaWind = a.wind;
  s.seaChop = SEA_AMP * 3.0 * (1 + 1.5 * Math.min(1, kt / 45));
  s.seaChopH = CHOP_DRAWN;
  s.heading = hdg; s.running = true;
  // Her sheer down both sides, and her bottom for the lowest vertex the chase view stands her on.
  const deck = [], bottom = [];
  for (const f of [0.95, 0.75, 0.5, 0.2, -0.1, -0.4, -0.7, -0.98].map((x) => x * G.LEN)) {
    const st = G.atF(f);
    for (const sg of [-1, 1]) { deck.push([f, sg * st.sw, st.sz]); bottom.push([f, sg * st.cw, st.cz]); }
    bottom.push([f, st.kg != null ? st.kg : 0, st.k]);
  }
  const views = {
    chase: { plan: CONTACT * EXT_MUL, vert: CONTACT * EXT_MUL * VS, r: {}, wet: 0, n: 0, worst: 0, keelBase: true },
    helm: { plan: G.helm.mPerUnit / SEA_TILE_M, vert: G.helm.mPerUnit / SEA_TILE_M, r: {}, wet: 0, n: 0, worst: 0, keelBase: false },
  };
  const dt = 1 / 60;
  let t = 1000;
  // The lean against the water beside her, as a correlation over the run (see THE SIGN below).
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < secs * 60; i++) {
    t += dt;
    stepBoat(s, { throttle: lever, steer: 0, now: t * 1000, surface: 'open', fuel: 1 }, p, dt);
    const spd01 = Math.min(1, Math.abs(s.speed) / p.topSpeed);
    for (const V of Object.values(views)) {
      const pose = stepBoatRide(V.r, s, dt, { halfLen: G.LEN * 0.8 * V.plan, halfBeam: G.BEAM * 0.8 * V.plan, vr: V.vert / V.plan, spd01 });
      if (i < 120) continue;
      // The renderer's transform (drawAircraftModel): pitch nose-up +, then `bank`, starboard down +.
      const th = pose.pitch, b = -pose.roll, ct = Math.cos(th), stt = Math.sin(th), cb = Math.cos(b), sb = Math.sin(b);
      const lift = ([f, g, h]) => { const h1 = f * stt + h * ct; return -g * sb + h1 * cb; };
      const plan = ([f, g, h]) => { const f1 = f * ct - h * stt, h1 = f * stt + h * ct; return [f1, g * cb + h1 * sb]; };
      // The chase view stands her lowest vertex on the surface (ownShipBaseWz); the helm's hull has
      // its design waterline there, which is what the eye's height is measured from.
      const lowest = V.keelBase ? Math.min(...bottom.map(lift), ...bottom.map(([f, g, h]) => lift([f, g, h]))) : 0;
      const base = pose.heave - V.vert * lowest;
      const hh = s.heading * D2R, sh = Math.sin(hh), ch = Math.cos(hh);
      let worst = 0;
      for (const q of deck) {
        const [F, Gx] = plan(q).map((x) => x * V.plan);
        const wx = s.x + sh * F + ch * Gx, wy = s.y - ch * F + sh * Gx;
        worst = Math.max(worst, waterAt(s, wx, wy, s.clock) - (base + V.vert * lift(q)));
      }
      const metres = worst / V.vert * G.helm.mPerUnit;
      V.n++;
      if (metres > 0.15) V.wet++;
      V.worst = Math.max(V.worst, metres);
      // THE SIGN. Where the water to starboard is higher, her starboard rail stands higher than port.
      // ⚠ A CORRELATION OVER THE RUN, NOT A VOTE PER FRAME. She is posed by the plane under her whole
      // footprint, a tenth of a second behind, so frame by frame she and the chop at her two rails
      // disagree often and honestly. An inverted sign is not occasional disagreement: it is the lean
      // running against the water the whole way, a strongly negative correlation.
      if (V === views.helm && !s.airborne) {
        // Against the plane under her whole footprint: a two-tile hull is rolled by that, not by the
        // chop at her middle, which is shorter than she is and averages out along her.
        const fit = boatFitPose(s, s.clock, G.LEN * 0.8 * V.plan, G.BEAM * 0.8 * V.plan);
        const st0 = G.atF(0);
        const lean = lift([0, st0.sw, st0.sz]) - lift([0, -st0.sw, st0.sz]), water = fit.slopeR;
        sxy += lean * water; sxx += lean * lean; syy += water * water;
      }
    }
  }
  return { views, corr: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 1 };
}

const HEADINGS = [[0, 0.15, 'idling'], [0, 0.9, 'running at 0'], [90, 0.9, 'running at 90'], [180, 0.9, 'running at 180'], [45, 0.6, 'half lever at 45']];
const LIMIT = 0.03;
for (const { id } of BOAT_TYPES) {
  console.log(id);
  for (const kt of [20, 30]) {
    const rows = [];
    for (const [hdg, lever, tag] of HEADINGS) {
      const { views, corr } = sail(id, kt, hdg, lever, 20);
      for (const [name, V] of Object.entries(views)) {
        const rate = V.wet / Math.max(1, V.n);
        ok(rate <= LIMIT, `${id} ${kt} kt ${tag}: the ${name} view has the sea over her deck ${(rate * 100).toFixed(1)}% of the time (worst ${V.worst.toFixed(2)} m)`);
        rows.push(`${tag} ${name} ${(rate * 100).toFixed(1)}%`);
      }
      ok(corr > 0.6, `${id} ${kt} kt ${tag}: her lean does not follow the water beside her (correlation ${corr.toFixed(2)}) — a negative one is the sign inverted`);
    }
    console.log('  ' + kt + ' kt: ' + rows.join(' · '));
  }
}

console.log('\n' + (checks - fails) + '/' + checks + ' passed');
if (fails) { console.log('\nBOAT RIDE GATE FAILED'); process.exit(1); }
