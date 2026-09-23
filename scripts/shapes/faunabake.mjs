// THE GPU BIRD IS THE CPU BIRD — the pose bake behind gl/fauna.js.
//
// gl/fauna.js draws every bird as an instanced mesh whose wingbeat is a row of a float texture.
// Everything about how it LOOKS comes out of `faunaPoseBake` in fauna3d.js, and the one way that
// goes wrong is silently: a row that is one beat step out, a triangle fanned differently from the
// solids layer, a colour resolved from the wrong row, a group whose topology varies with the beat
// and so cannot be one mesh at all. Every one of those draws a plausible bird. None of them throws.
//
// No headless harness here reaches a GL draw call, so this checks the DATA the GPU is handed, which
// is where all four of those live. What the shader does with it is the Modelshop's A/B
// (`__glFaunaInst` in tools/modelshop/glbench.js), which measured 0 differing pixels against the
// solids path and 12-17 with the basis deliberately mirrored.
//
//   1. Every pose group in the table bakes. A group that will not bake is a species that does not
//      draw at all on the GPU path.
//   2. Every row of every group reproduces faunaPoseFaces, fan-expanded exactly as solids.js expands
//      it, to the float32.
//   3. The colours are faunaPose's, row 0, vertex for vertex.
//   4. faunaPoseSlot picks the row and group whose geometry IS the pose faunaPose would have drawn
//      for the same arguments — across off-range beats, and flare and gear on a bird that is not in
//      the air, which is where the normalisation does its work.
//
// Mutation-tested 4 ways: a slot one beat out, a fan wound differently and a colour channel swapped
// are all caught. Counting gear on a walking bird SURVIVES, deliberately: it edits `poseParts`, the one
// normalisation both faunaPose and faunaPoseSlot read, so the CPU pose and the GPU slot move together.
// This gate exists to catch the two disagreeing; what the CPU pose should BE is fauna.mjs's question.
import './dom-stub.mjs';

const F = await import('../../client/game/js/panels/fauna3d.js');
const { SPECIES } = await import('../../client/shared/birds.js');

const fail = [];
const species = Object.keys(SPECIES);
const STATES = ['air', 'walk'];
let groups = 0, rowsChecked = 0, verts = 0;

// Fan-expand faces exactly as gl/solids.js does: (p0, pi, pi+1) for i = 1 .. n-2.
function fan(faces) {
  const out = [];
  for (const f of faces) for (let k = 1; k + 1 < f.p.length; k++) out.push(f.p[0], f.p[k], f.p[k + 1]);
  return out;
}

for (const sp of species) {
  for (const far of [0, 1, 2, 3]) {
    if (far === 1 && !F.faunaHasFar('bird', sp)) continue;
    for (const state of STATES) for (const flare of [0, 1]) for (const gear of [0, 1]) {
      const bake = F.faunaPoseBake('bird', sp, state, flare, gear, far);
      const tag = `${sp} L${far} ${state}${flare ? ' flare' : ''}${gear ? ' gear' : ''}`;
      if (!bake) { fail.push(`${tag} would not bake — this bird does not draw on the GPU path`); continue; }
      groups++;
      verts = Math.max(verts, bake.verts);
      const wantRows = state === 'air' ? F.FAUNA_BEAT_STEPS : 1;
      if (bake.rows !== wantRows) fail.push(`${tag}: ${bake.rows} rows, expected ${wantRows}`);
      for (let r = 0; r < bake.rows; r++) {
        const pts = fan(F.faunaPoseFaces('bird', sp, { state, beat: r, flare, gear, far }));
        if (pts.length !== bake.verts) { fail.push(`${tag} row ${r}: ${pts.length} vertices, bake has ${bake.verts}`); continue; }
        let bad = 0;
        for (let i = 0; i < pts.length; i++) {
          const o = (r * bake.verts + i) * 4;
          if (bake.pos[o] !== Math.fround(pts[i][0]) || bake.pos[o + 1] !== Math.fround(pts[i][1])
            || bake.pos[o + 2] !== Math.fround(pts[i][2])) bad++;
        }
        if (bad) fail.push(`${tag} row ${r}: ${bad} of ${pts.length} vertices differ from faunaPose`);
        rowsChecked++;
      }
    }
  }
}

// 3. colours: the solids layer takes a face's rgb from faunaPose; the bake must hand the same one
// to every vertex of that face.
{
  const faces = F.faunaPoseFaces('bird', 'songbird', { state: 'air', beat: 0 });
  const bake = F.faunaPoseBake('bird', 'songbird', 'air', 0, 0, 0);
  // faunaPoseFaces does not carry rgb, so compare against a second bake of row 0's own colours
  // through faunaWorldFaces, which is the solids path's own source of colour.
  const world = F.faunaWorldFaces('bird', 'songbird', { state: 'air', beat: 0, scale: 1 });
  let c = 0, bad = 0;
  for (let i = 0; i < faces.length; i++) {
    const want = world[i].rgb;
    for (let k = 1; k + 1 < faces[i].p.length; k++) for (let j = 0; j < 3; j++) {
      if (Math.abs(bake.rgb[c] * 255 - want[0]) > 0.01 || Math.abs(bake.rgb[c + 1] * 255 - want[1]) > 0.01
        || Math.abs(bake.rgb[c + 2] * 255 - want[2]) > 0.01) bad++;
      c += 3;
    }
  }
  if (bad) fail.push(`${bad} baked vertex colours differ from the solids path's face colours`);
}

// 4. the slot is the pose. Beats off the end of the cycle, negative beats, and flare/gear on a
// walking bird, which faunaPose ignores — the slot must ignore them the same way.
{
  let bad = 0, n = 0;
  const cases = [];
  for (const state of STATES) for (const beat of [-17, -1, 0, 3, 15, 16, 19, 47])
    for (const flare of [0, 1]) for (const gear of [0, 1]) for (const far of [0, 3]) cases.push({ state, beat, flare, gear, far });
  for (const sp of ['songbird', 'goose']) for (const c of cases) {
    const slot = F.faunaPoseSlot('bird', sp, c.state, c.beat, c.flare, c.gear, c.far);
    // decode the group back to the arguments the bake is keyed on
    const m = /^bird:([^:]+):([^:]+):(f?)(g?)L(\d)$/.exec(slot.group);
    if (!m) { bad++; continue; }
    const bake = F.faunaPoseBake('bird', m[1], m[2], m[3] ? 1 : 0, m[4] ? 1 : 0, +m[5]);
    const pts = fan(F.faunaPoseFaces('bird', sp, c));
    n++;
    if (!bake || slot.row >= bake.rows || pts.length !== bake.verts) { bad++; continue; }
    for (let i = 0; i < pts.length; i++) {
      const o = (slot.row * bake.verts + i) * 4;
      if (bake.pos[o] !== Math.fround(pts[i][0]) || bake.pos[o + 1] !== Math.fround(pts[i][1])
        || bake.pos[o + 2] !== Math.fround(pts[i][2])) { bad++; break; }
    }
  }
  if (bad) fail.push(`faunaPoseSlot pointed at the wrong pose in ${bad} of ${n} cases`);
}

if (groups < 100) fail.push(`only ${groups} pose groups baked — the sweep has stopped seeing the table`);

if (fail.length) {
  console.error('\n✗ faunabake — ' + fail.length + ' problem(s):');
  for (const f of fail.slice(0, 20)) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ faunabake: ${groups} pose groups, ${rowsChecked} rows, every vertex the CPU pose to the float32 (largest group ${verts} vertices); the slot is the pose.`);
