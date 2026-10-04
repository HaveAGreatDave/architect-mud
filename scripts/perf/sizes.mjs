// sizes: does every GPU-sized light come out the size the CPU would have made it?
//
//   node scripts/perf/sizes.mjs
//
// A light pushed through pushLightSized carries `sz` = [k, lo, hi, fmin] (device pixels) and the
// sprite shader sizes it as clamp(k / max(fmin, clip.w), lo, hi) (gl/sprites.js). This paints the
// perf:exact views, works that formula out with the sprite layer's own camera matrix, and compares it
// with the record's CPU radius `r`, which is what the frame drew before. Stage 3 of
// docs/proposals/glass-headroom.md. Exits 1 on any light more than 1e-6 px off.
import { pathToFileURL } from 'node:url';
import { openScene, PLACES } from './scene.mjs';
const { viewProjMatrix, eyePos } = await import(pathToFileURL(new URL('../../client/game/js/panels/gl/camera.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')).href);

const scene = await openScene({ record: false });
let hook = null;
scene.ws.installGLWorld((cells, cam, o) => { hook = { cam, o }; return { canvas: { width: 640, height: 360 }, faces: 0 }; });
let sized = 0, all = 0, worst = 0, bad = 0, wires = 0, wiresAll = 0, wworst = 0, decals = 0, decalsAll = 0, dworst = 0;
const shown = [];
try {
  for (const place of Object.keys(PLACES)) for (const seat of ['cab', 'cockpit']) for (const hour of [13, 22]) for (const heading of [20, 140, 260]) {
    scene.ws.paintWindshield('__perf', scene.view(place, seat, { hour, heading }));
    const { cam, o } = hook;
    const M = viewProjMatrix(cam, 360);
    const E = eyePos(cam);
    const pullEnd = (P, pl) => { const f = M[3] * P[0] + M[7] * P[1] + M[11] * P[2] + M[15], k = Math.max(0.06, f - pl) / f; return [E[0] + (P[0] - E[0]) * k, E[1] + (P[1] - E[1]) * k, E[2] + (P[2] - E[2]) * k]; };
    for (const st of o.strokes || []) {
      wiresAll++;
      if (!(st.pl > 0)) continue;
      wires++;
      for (const [raw, cpu] of [[st.ra, st.a], [st.rb, st.b]]) {
        const g = pullEnd(raw, st.pl), e = Math.hypot(g[0] - cpu[0], g[1] - cpu[1], g[2] - cpu[2]);
        if (e > wworst) wworst = e;
        if (e > 1e-6) { bad++; if (shown.length < 5) shown.push(`${place} ${seat} wire end off by ${e}`); }
      }
    }
    for (const d of o.decals || []) {
      decalsAll++;
      if (!(d.pl > 0) || !d.rp) continue;
      decals++;
      let cx = 0, cy = 0, cz = 0;
      for (const c of d.rc) { cx += c[0] / d.rn; cy += c[1] / d.rn; cz += c[2] / d.rn; }
      const fm = M[3] * cx + M[7] * cy + M[11] * cz + M[15], k = 1 - Math.min(0.5, d.pl / fm);
      for (let i = 0; i < 4; i++) {
        const P = d.rp[i], g = [E[0] + (P[0] - E[0]) * k, E[1] + (P[1] - E[1]) * k, E[2] + (P[2] - E[2]) * k];
        const e = Math.hypot(g[0] - d.p[i][0], g[1] - d.p[i][1], g[2] - d.p[i][2]);
        if (e > dworst) dworst = e;
        if (e > 1e-6) { bad++; if (shown.length < 5) shown.push(`${place} ${seat} decal corner off by ${e}`); }
      }
    }
    for (const s of o.sprites || []) {
      all++;
      if (!s.sz) continue;
      sized++;
      const w = M[3] * s.x + M[7] * s.y + M[11] * s.z + M[15];
      const [k, lo, hi, fmin] = s.sz;
      const g = Math.min(hi, Math.max(lo, k / Math.max(fmin, w)));
      const e = Math.abs(g - s.r);
      if (e > worst) worst = e;
      if (e > 1e-6) { bad++; if (shown.length < 5) shown.push(`${place} ${seat} ${hour}h ${heading}°: ${s.tag || ''} cpu ${s.r} gpu ${g}`); }
    }
  }
} finally { scene.close(); }
for (const l of shown) console.error('  ✗ ' + l);
if (!sized) { console.error('sizes: no light carried a size spec, so nothing was checked'); process.exit(1); }
if (bad) { console.error(`sizes: ${bad} of ${sized} sized lights are off (worst ${worst.toExponential(2)} px)`); process.exit(1); }
console.log(`✓ sizes: ${sized} of ${all} lights sized on the GPU, every one within ${worst.toExponential(1)} px of the CPU radius; ${wires} of ${wiresAll} wires pulled on the GPU, every end within ${wworst.toExponential(1)} tiles; ${decals} of ${decalsAll} decals pulled on the GPU, every corner within ${dworst.toExponential(1)} tiles.`);
