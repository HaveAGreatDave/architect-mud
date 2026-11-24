// GATE · THE GLOVE OPENS AND SHUTS (diamond/glove-flex.js). A fielder's, a catcher's and a first baseman's glove
// are built as the park builds them, and their vertices skinned on the CPU as the shader skins them, through every
// catch clip: every point finite, the glove at rest exactly the shape it was built in, its tips sprung back out of
// the pocket when it's wide and folded into it when it's shut, the heel and the strap never moving off the hand, and
// how open it is running rest, wide, shut and back to rest round each clip's catch.
//
// No DOM, no GL: node scripts/shapes/glove-flex.mjs

import * as PM from '../../client/game/js/panels/gl/ballplayer-mesh.js';
import { STRIDE } from '../../client/game/js/panels/gl/ballpark-mesh.js';
import { bindFrames, skinRows, BONE, FRAME_FLOATS } from '../../client/game/js/panels/diamond/rig.js';
import { skinPoint } from '../../client/game/js/panels/gl/skin.js';
import { CLIPS } from '../../client/game/js/panels/diamond/clips.js';
import { sampleClip } from '../../client/game/js/panels/diamond/anim.js';
import { flexGloveRows, gloveOpenAt, GLOVE_REST } from '../../client/game/js/panels/diamond/glove-flex.js';

let fails = 0;
const fail = (m) => { fails++; console.log('  ✗ ' + m); };
const S = PM.SKIN_STRIDE;

const LOOKS = {
  fielder: { id: 'Rats:SS', side: 'home', role: 'fielder', slot: 4, glove: 'L' },
  catcher: { id: 'Rats:C', side: 'home', role: 'catcher', slot: 1, glove: 'L' },
  first: { id: 'Rats:1B', side: 'home', role: 'fielder', slot: 3, glove: 'L', mitt: 'first' },
  lefty: { id: 'Moth', side: 'away', role: 'fielder', slot: 14, glove: 'R' },
};

for (const [name, raw] of Object.entries(LOOKS)) {
  const look = PM.lookOf(raw), G = PM.createPlayerSet({ skin: true });
  PM.buildBody(G, look);
  const side = raw.glove, fist = BONE['fist' + side], hand = BONE['hand' + side];
  const bind = bindFrames(look.scale || 1, PM.rigBuildOf(look));
  const hb = hand * FRAME_FLOATS, Z = [bind[hb + 6], bind[hb + 7], bind[hb + 8]], Y = [bind[hb + 3], bind[hb + 4], bind[hb + 5]], O = [bind[hb + 9], bind[hb + 10], bind[hb + 11]];
  // the glove's vertices: everything on the fist bone, with the hand's share
  const verts = [];
  for (const [, b] of G.batches) for (let v = 0; v < b.n; v++) {
    const o = v * S, q = (o + STRIDE) * 4, ids = [b.u8[q], b.u8[q + 1], b.u8[q + 2], b.u8[q + 3]], ws = [b.u8[q + 4], b.u8[q + 5], b.u8[q + 6], b.u8[q + 7]];
    const k = ids.findIndex((id, i) => id === fist && ws[i] > 0);
    if (k >= 0) verts.push({ p: [b.data[o], b.data[o + 1], b.data[o + 2]], ids, ws, wf: ws[k] / 255 });
  }
  if (verts.length < 50) { fail(`${name}: only ${verts.length} glove vertices lean on the fist bone`); continue; }
  const most = Math.max(...verts.map((v) => v.wf)), tips = verts.filter((v) => v.wf > 0.9 * most);
  if (name !== 'catcher' && !tips.length) fail(`${name}: no glove tip rides the hinge whole`);

  // in the bind pose: the rest is the built shape, wide springs the tips back, shut folds them into the pocket
  const base = skinRows(bind, bind);
  const pocket = (rows, v) => { const p = skinPoint(rows, v.ids, v.ws, v.p); return (p[0] - O[0]) * Z[0] + (p[1] - O[1]) * Z[1] + (p[2] - O[2]) * Z[2]; };
  const at = (open) => flexGloveRows(Float32Array.from(base), bind, side, open, look.scale || 1);
  const rest = at(GLOVE_REST), wide = at(1), shut = at(0);
  let restOff = 0, dW = 0, dS = 0;
  for (const v of verts) {
    const p0 = v.p, pr = skinPoint(rest, v.ids, v.ws, v.p);
    if (![...pr, ...skinPoint(wide, v.ids, v.ws, v.p), ...skinPoint(shut, v.ids, v.ws, v.p)].every(Number.isFinite)) { fail(`${name}: a glove point isn't finite`); break; }
    restOff = Math.max(restOff, Math.hypot(pr[0] - p0[0], pr[1] - p0[1], pr[2] - p0[2]));
    if (v.wf > 0.9 * most) { dW += pocket(wide, v) - pocket(rest, v); dS += pocket(shut, v) - pocket(rest, v); }
  }
  if (restOff > 1e-4) fail(`${name}: at rest the glove is ${restOff.toFixed(5)} ft off the shape it was built in`);
  if (tips.length && !(dW < 0)) fail(`${name}: wide doesn't spring the tips out of the pocket (${dW.toFixed(4)})`);
  if (tips.length && !(dS > 0)) fail(`${name}: shut doesn't fold the tips into the pocket (${dS.toFixed(4)})`);
  // the heel, behind the hinge, never leaves the hand
  let heel = 0;
  for (const v of verts) {
    if (v.wf > 0.02) continue;
    const a = skinPoint(shut, v.ids, v.ws, v.p);
    heel = Math.max(heel, Math.hypot(a[0] - v.p[0], a[1] - v.p[1], a[2] - v.p[2]));
  }
  if (heel > 0.02) fail(`${name}: the heel moves ${heel.toFixed(3)} ft when the glove shuts`);
}

// round every catch: rest before, wide just before it, shut just after, rest well after
let catches = 0;
for (const [id, clip] of Object.entries(CLIPS)) {
  const e = (clip.events || []).find((x) => x.kind === 'catch');
  if (!e) { if (gloveOpenAt(clip, 0) != null) fail(`${id}: no catch but the glove moves`); continue; }
  catches++;
  const o = (dt) => gloveOpenAt(clip, e.t + dt);
  if (!(o(-0.12) > 0.9)) fail(`${id}: the glove isn't wide just before the catch (${o(-0.12)})`);
  if (!(o(0.06) < 0.05)) fail(`${id}: the glove isn't shut on the catch (${o(0.06)})`);
  if (Math.abs(o(0.8) - GLOVE_REST) > 1e-6) fail(`${id}: the glove doesn't come back to rest after the catch`);
  const P = sampleClip(clip, e.t - 0.12, {});
  if (!(P.glove > 0.9)) fail(`${id}: sampleClip doesn't carry the glove's opening (${P.glove})`);
}
if (!catches) fail('no clip has a catch');
console.log(fails ? `glove-flex: ${fails} failure(s)` : `glove-flex: ${Object.keys(LOOKS).length} gloves, ${catches} catches ok`);
process.exit(fails ? 1 : 0);
