// THE CLOSE-UP FIGURE (client/game/js/panels/figure.js): every cut, hair style and level builds,
// and builds sound.
//
//   node scripts/shapes/figure.mjs            # gate
//   node scripts/shapes/figure.mjs --report   # the numbers behind it
//
// What can go wrong without a picture showing it: a mesh past UNSIGNED_SHORT or its budget, a
// non-finite point, weights that don't sum to one or name a bone that isn't there, a part wound
// inward (its normals point in, and the ink and the light go inside out), skin left under a coat
// (it pokes through at the first bent elbow), a hair card under the hairline or across the face,
// and the crowd's body drifting from the close-up one it's sampled from, which is the promise that
// a person seen from the cab has the silhouette they have across a room.
import { buildFigure, figureSole, FIGURE_CUT_NAMES, FIGURE_BONES, FIG_SLOT } from '../../client/game/js/panels/figure.js';
import { hairlineAt, HAIR_STYLES } from '../../client/game/js/panels/actor-head.js';

const REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };
const BUDGET = { hd: 32000, lite: 11000, crowd: 2200, far: 400 };

function volumeOf(F, p) {
  const { P, I } = F;
  let cx = 0, cy = 0, cz = 0;
  for (let v = p.v0; v < p.v0 + p.nv; v++) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; }
  cx /= p.nv; cy /= p.nv; cz /= p.nv;
  let vol = 0;
  for (let t = p.start; t < p.start + p.count; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[a] - cx, ay = P[a + 1] - cy, az = P[a + 2] - cz, bx = P[b] - cx, by = P[b + 1] - cy, bz = P[b + 2] - cz, qx = P[c] - cx, qy = P[c + 1] - cy, qz = P[c + 2] - cz;
    vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
  }
  return vol / 6;
}

for (const level of ['hd', 'lite', 'crowd', 'far']) {
  const cuts = level === 'hd' || level === 'lite' ? FIGURE_CUT_NAMES : ['coat'];
  const styles = level === 'hd' ? [...Array(HAIR_STYLES).keys()] : [0];
  for (const cut of cuts) for (const style of styles) {
    const name = `${level} ${cut} hair ${style}`, F = buildFigure({ cut, style, level });
    report(`${name}: ${F.nv} vertices, ${F.nt} triangles${F.cards ? `, ${F.cards.n} cards` : ''}`);
    if (F.nv > BUDGET[level]) problems.push(`${name} is ${F.nv} vertices, over its ${BUDGET[level]}`);
    if (!(F.I instanceof Uint16Array) || F.nv > 65535) problems.push(`${name} doesn't index as UNSIGNED_SHORT`);
    if (F.P.some((v) => !Number.isFinite(v)) || F.N.some((v) => !Number.isFinite(v))) problems.push(`${name} has a non-finite position or normal`);
    for (let i = 0; i < F.I.length; i++) if (F.I[i] >= F.nv) { problems.push(`${name}: an index past the last vertex`); break; }
    let badW = 0, badB = 0;
    for (let v = 0; v < F.nv; v++) {
      let s = 0;
      for (let k = 0; k < 4; k++) { s += F.W[v * 4 + k]; if (F.B[v * 4 + k] >= FIGURE_BONES.length) badB++; }
      if (Math.abs(s - 1) > 1e-4) badW++;
    }
    if (badW) problems.push(`${name}: ${badW} vertices' weights don't sum to 1`);
    if (badB) problems.push(`${name}: ${badB} bone indices past the skeleton`);
    // every part this module builds is wound outward; the head's and the cards' come as they are
    for (const p of F.parts) {
      if (p.name === 'head' || p.name === 'hair' || p.name === 'cards' || p.name === 'collar' || !p.count) continue;
      if (!(volumeOf(F, p) > 0)) problems.push(`${name}: the ${p.name} is wound inward`);
    }
    // under a coat there's no skin between the hips and the shoulders
    if (level === 'hd' && cut === 'coat') {
      const torso = F.parts.find((p) => p.name === 'torso');
      let under = 0;
      if (torso) for (let v = torso.v0; v < torso.v0 + torso.nv; v++) { const y = F.P[v * 3 + 1]; if (y > 0.95 && y < 1.4) under++; }
      if (under) problems.push(`${name}: ${under} torso skin vertices left under the coat`);
    }
    // hair cards: above the hairline at the root, and never across the face
    if (F.cards) {
      const c = F.parts.find((p) => p.name === 'cards');
      let low = 0, face = 0;
      for (let v = c.v0; v < c.v0 + c.nv; v++) {
        const x = F.P[v * 3], y = F.P[v * 3 + 1], z = F.P[v * 3 + 2];
        if (F.UV[v * 2 + 1] === 0 && y < hairlineAt(x, z) - 0.002) low++;
        if (z > 0.06 && Math.abs(x) < 0.05 && y > 1.53 && y < 1.69) face++;
      }
      if (low) problems.push(`${name}: ${low} card roots below the hairline`);
      if (face) problems.push(`${name}: ${face} card points across the face`);
    }
    if (level === 'hd' && style > 0 && !F.cards) problems.push(`${name} has no hair cards`);
    // the form normals the comic light decides lit from shadow with (formNormals): there at the
    // close-up levels, unit length, and on the same side as the surface's own, or a form would
    // light from behind
    if (level === 'hd' || level === 'lite') {
      if (!F.NF || F.NF.length !== F.N.length) problems.push(`${name} has no form normals`);
      else {
        let bad = 0, away = 0;
        for (let v = 0; v < F.nv; v++) {
          const x = F.NF[v * 3], y = F.NF[v * 3 + 1], z = F.NF[v * 3 + 2], l = Math.hypot(x, y, z);
          if (!(Math.abs(l - 1) < 1e-3)) bad++;
          if (x * F.N[v * 3] + y * F.N[v * 3 + 1] + z * F.N[v * 3 + 2] < -0.2) away++;
        }
        if (bad) problems.push(`${name}: ${bad} form normals aren't unit length`);
        if (away > F.nv * 0.01) problems.push(`${name}: ${away} form normals face away from their surface`);
      }
    }
    if (F.S.some((s) => s === FIG_SLOT.card) && !F.cards) problems.push(`${name}: card vertices outside the card range`);
  }
}

// A Wildblood with every change on (docs/lore-wildblood.md): the tunic and mantle, all the gear,
// a mighty arm, thorns, horns, claws, teeth and goggles, at both close-up levels. Each change is
// there, finite, inside the budget, and the mighty arm's side is thicker than the other.
for (const level of ['hd', 'lite']) {
  const body = { mighty: 'R', thorn: true, horns: true, claws: true, teeth: true, goggles: true };
  const F = buildFigure({ cut: 'tunic', style: 3, level, gear: { strap: true, pouch: true }, body }), name = `${level} Wildblood`;
  report(`${name}: ${F.nv} vertices, ${F.nt} triangles`);
  if (F.nv > BUDGET[level]) problems.push(`${name} is ${F.nv} vertices, over its ${BUDGET[level]}`);
  if (F.P.some((v) => !Number.isFinite(v)) || F.N.some((v) => !Number.isFinite(v))) problems.push(`${name} has a non-finite position or normal`);
  for (const want of ['mantle', 'thorns', 'horns', 'clawsL', 'clawsR', 'teeth', 'goggles']) if (!F.parts.some((p) => p.name === want && p.count)) problems.push(`${name} has no ${want}`);
  if (F.parts.some((p) => p.name.startsWith('sleeve'))) problems.push(`${name}'s tunic has sleeves; its arms are meant to be bare`);
  const reach = (nm) => { const p = F.parts.find((q) => q.name === nm); let m = 0; if (p) for (let v = p.v0; v < p.v0 + p.nv; v++) if (Math.abs(F.P[v * 3 + 1] - 1.2) < 0.03) m = Math.max(m, Math.abs(F.P[v * 3])); return m; };
  if (!(reach('armR') > reach('armL') + 0.005)) problems.push(`${name}'s mighty right arm is no thicker than the left (${reach('armR').toFixed(3)} against ${reach('armL').toFixed(3)})`);
}

// The crowd's coat against the close-up coat's: at each height, how far out each one reaches to
// the side and to the front. Sampled coarsely, it should still be the same coat.
{
  const reach = (F, slot) => {
    const bins = new Map();
    for (let v = 0; v < F.nv; v++) {
      if (F.S[v] !== slot) continue;
      const y = F.P[v * 3 + 1];
      if (y < 0.66 || y > 1.4) continue;
      const k = Math.round(y / 0.05), b = bins.get(k) || [0, 0];
      b[0] = Math.max(b[0], Math.abs(F.P[v * 3])); b[1] = Math.max(b[1], F.P[v * 3 + 2]);
      bins.set(k, b);
    }
    return bins;
  };
  const hd = reach(buildFigure({ cut: 'coat', level: 'hd' }), FIG_SLOT.top), crowd = reach(buildFigure({ cut: 'coat', level: 'crowd' }), FIG_SLOT.top);
  let worst = 0, at = 0;
  for (const [k, a] of hd) { const b = crowd.get(k); if (!b) continue; const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); if (d > worst) { worst = d; at = k * 0.05; } }
  report(`crowd coat against the close-up coat: worst ${(worst * 1000).toFixed(1)} mm, at ${at.toFixed(2)} m`);
  if (worst > 0.02) problems.push(`the crowd's coat strays ${(worst * 1000).toFixed(0)} mm from the close-up coat at ${at.toFixed(2)} m; it should be the same coat sampled coarsely`);
}

// The sole the root solve pivots on: on the ground through the middle, never under it.
{
  const s = figureSole();
  if (s.some(([, y]) => y < 0.004 - 1e-9)) problems.push('the shoe sole dips under the ground line');
  if (!s.some(([z, y]) => Math.abs(y - 0.004) < 1e-6 && z > 0 && z < 0.05)) problems.push('the shoe sole isn\'t flat on the ground under the ball');
}

if (problems.length) {
  console.log(`✗ figure — ${problems.length} problem(s):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('✓ figure: every cut, hair style and level builds sound, and the crowd wears the close-up coat');
