// armkeep-check: do kept buildings draw what running their arms draws?
//
//   node scripts/perf/armkeep-check.mjs
//
// Stage 3 phase 5 of docs/proposals/glass-headroom.md. Flies the same turning sequence twice through
// real Coldwater, once with `armKeep` 0 (every arm every frame) and once with it on, and hands each
// frame's lights, wires, decals and solids to a gl/context.js view under a fake WebGL2 that mirrors
// every buffer and records every draw. The triangles drawn have to be the same multiset frame by
// frame, to 1e-5 (a kept record is shifted each frame, which costs the last bits). Reports how many
// buildings were kept. Exits 1 on any difference.
import { openScene, PLACES } from './scene.mjs';
import { internMap } from '../../client/game/js/panels/map-intern.js';
const { createGLView } = await import(new URL('../../client/game/js/panels/gl/context.js', import.meta.url).href);

function fakeView() {
  let vao = null, ab = null;
  const vaoBuf = new Map(), mirrors = new Map(), strideOf = new Map(), draws = [];
  const fns = {
    createBuffer: () => ({ buf: 1 }), createVertexArray: () => ({ vao: 1 }), createTexture: () => ({ tex: 1 }),
    bindVertexArray: (v) => { vao = v; },
    bindBuffer: (t, b) => { if (t === 'ARRAY_BUFFER') { ab = b; if (vao) vaoBuf.set(vao, b); } },
    vertexAttribPointer: (l, n, ty, norm, stride) => { if (ab) strideOf.set(ab, stride / 4); },
    bufferData: (t, size) => { if (t === 'ARRAY_BUFFER' && typeof size === 'number') mirrors.set(ab, new Float32Array(size / 4)); },
    bufferSubData: (t, off, data, src = 0, len) => { if (t !== 'ARRAY_BUFFER') return; const m = mirrors.get(ab); if (!m) return; const n = len ?? data.length - src; m.set(data.subarray(src, src + n), off / 4); },
    drawArrays: (mode, first, n) => { const b = vao && vaoBuf.get(vao); const st = strideOf.get(b); if (b && st && mirrors.get(b)) draws.push({ st, f: mirrors.get(b).slice(first * st, (first + n) * st) }); },
    getProgramParameter: () => true, getShaderParameter: () => true, getExtension: () => null, isContextLost: () => false,
    getUniformLocation: () => ({}), getAttribLocation: () => 1, getParameter: () => 0, checkFramebufferStatus: () => 'COMPLETE',
    getContextAttributes: () => ({}),
  };
  const gl = new Proxy({}, { get: (o, k) => (k in fns ? fns[k] : typeof k === 'string' && /^[A-Z_0-9]+$/.test(k) ? k : () => ({})) });
  return { view: createGLView({ width: 640, height: 360, getContext: () => gl, addEventListener() {} }, {}), draws };
}
const tris = (draws) => {
  const out = [];
  // A GPU-sized light's CPU radius (float 5) is unused when its size spec (floats 11-14) is there, and
  // a kept light keeps the recording's: blanked for those. Sprites are the only 18-float layer.
  for (const { st, f } of draws) for (let i = 0; i + 3 * st <= f.length; i += 3 * st) {
    const v = Array.from(f.slice(i, i + 3 * st));
    if (st === 18) for (let k = 0; k < 3; k++) if (v[k * 18 + 11] > 0) v[k * 18 + 5] = 0;
    out.push(st + ':' + v.map((x) => Math.round(x * 1e5)).join(','));
  }
  return out.sort();
};


// ⚠ EACH FLIGHT IN A PROCESS OF ITS OWN. The clock runs (below), and with it every stateful system in
// the frame (the fauna sims, the smoothed frame timings) carries state from one flight into the next,
// so two flights in one process differ before kept arms come into it: live against live failed 197
// of 180 frames. A fresh process per flight starts both from the same state.
const tri32 = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const flyArg = process.argv.indexOf('--fly');
if (flyArg >= 0) {
  const [place, seat, hourS, keepS, moveS, recS] = process.argv.slice(flyArg + 1);
  // `move` > 0 flies straight ahead that many tiles a frame instead of turning: the travel is in
  // `mapOffset`, which a turn never moves, and a probe that ignored it never kept anything.
  // `still` holds the first pose for STILL_N frames and then turns, `stillfly` then flies straight:
  // a set kept while still (armStill) has to draw what the arms draw once the camera moves.
  const STILL_N = 30, still = moveS === 'still' || moveS === 'stillfly';
  const move = still ? (moveS === 'stillfly' ? 0.02 : 0) : Number(moveS || 0);
  const at = (i) => still ? (i < STILL_N ? { heading: 20 } : move ? { heading: 20, mapOffset: { x: 0.3, y: -(((i - STILL_N) * move) % 1) } } : { heading: 20 + (i - STILL_N) * 1.5 })
    : (move ?{ heading: 20 + i * Number(process.env.MOVETURN || 0), mapOffset: { x: 0.3, y: -((i * move) % 1) } } : { heading: 20 + i * 1.5 });
  // `rec` > 0 also has the server send a window centred on the craft every `rec` frames, as fresh
  // JSON taken through panels/map-intern.js the way the client takes it: kept sets are keyed in world
  // tiles (armWorld), so they must survive the recentre and still draw what the arms draw.
  const rec = Number(recS || 0);
  let win = null, k = 0;
  const viewAt = (i) => {
    // `place` is a PLACES name or a world tile 'x,y' (FLY=, below).
    const tile = /^-?\d+,-?\d+$/.test(place) ? place.split(',').map(Number) : null;
    if (!rec) return scene.view(tile || place, seat, { hour, ...at(i) });
    const [X, Y] = tile || PLACES[place], dist = i * move;
    if (!win || i % rec === 0) {
      const k0 = k; k = Math.round(dist);
      const fresh = scene.view([X, Y - k], seat).map.map((r) => r.map((c) => JSON.parse(JSON.stringify(c))));
      win = internMap(win, X, Y - k0, fresh, X, Y - k);
    }
    return scene.view([X, Y - k], seat, { hour, heading: 20 + i * Number(process.env.MOVETURN || 0), mapOffset: { x: 0.3, y: -(dist - k) }, map: win });
  };
  // ⚠ WITH THE GL CLOTH PATH ON, as the game's GL pass has it (CLOTH=0 turns it off): a flag's cloth
  // is a FAUNA_SINK record there, which a kept building's live part (windFlag) has to push again
  // every replay (armLiveSide). The flags never reach the layers below, so they're compared on their own.
  const scene = await openScene({ record: false, cloth: process.env.CLOTH !== '0' });
  let hook = null;
  scene.ws.installGLWorld((cells, cam, o) => { hook = { cam, o }; return { canvas: { width: 640, height: 360 }, faces: 0 }; });
  // The light census (RAIN_LIGHTS, read by the rain and the cab's lighting), as a sorted list.
  const census = () => (scene.ws.lastLightCensus() || []).map((e) => [e.x, e.y, e.r, e.a].map((x) => Math.round(x * 1e4)).join(',') + '|' + e.rgb).sort();
  scene.ws.RENDER_TUNE.armKeep = Number(keepS);
  if (process.env.ARMLIVE != null) scene.ws.RENDER_TUNE.armLive = Number(process.env.ARMLIVE);
  // TUNE=k=v,... on the kept flight only (keep 1), to pin which switch a difference comes from.
  if (Number(keepS) && process.env.TUNE) for (const kv of process.env.TUNE.split(',')) { const [k, v] = kv.split('='); scene.ws.RENDER_TUNE[k] = Number(v); }
  // TUNEALL=k=v,... on both flights: a switch whose kept draw has to match its own live draw (marksGPU).
  if (process.env.TUNEALL) for (const kv of process.env.TUNEALL.split(',')) { const [k, v] = kv.split('='); scene.ws.RENDER_TUNE[k] = Number(v); }
  // STEP=33 flies at an apparent 30 fps, where the scene governor steps the tune down.
  const hour = Number(hourS), G = fakeView(), frames = [], STEP = Number(process.env.STEP || 16);
  // ⚠ AND THE CLOCK RUNS, 16 ms a frame, or a live part (armLiveCall) replayed with a stale clock
  // would draw the same frozen pose as the live arm and pass. STEP=33 is worth a run too: at an apparent
  // 30 fps the scene governor steps the tune down, and the kept draw must still match.
  const clock = globalThis.performance, t0 = clock.now();
  globalThis.performance = { ...clock, now: () => t0 };
  // Painted once first: the occlusion pass reads the last frame (see the warm paint in retain-check).
  scene.ws.paintWindshield('__perf', viewAt(0));
  // FRAMES=n flies longer than the 60 the list is sized for (a band crossing takes a few hundred).
  for (let i = 0, NF = Number(process.env.FRAMES || 60); i < NF; i++) {
    globalThis.performance.now = () => t0 + (i + 1) * STEP;
    scene.ws.paintWindshield('__perf', viewAt(i + 1));
    const { cam, o } = hook;
    G.draws.length = 0;
    // The bay sink only: the own ship is not a building, and its first frame after a tune change
    // splits its faces differently (shipLocal), which says nothing about kept arms.
    G.view.uploadSolids([null, o.bay, null]);
    G.view.drawSolids(cam, 360, {});
    G.view.drawSprites(cam, o.sprites, 360, 1);
    G.view.drawStrokes(cam, o.strokes, 360);
    G.view.drawDecals(cam, o.decals, 360, 0, null, null);
    // DUMPF=<frame> DUMPTO=<file>: that frame's triangles, readable, for chasing a difference by hand.
    if (process.env.DUMPF == i) {
      const fs = await import('node:fs');
      fs.writeFileSync(process.env.DUMPTO, tris(G.draws).join('\n'));
      // …and the decal keys and the strokes, in the map window's frame (the records' own frame plus the camera offset).
      const W = (p) => p ? [p[0] + cam.ox, p[1] + cam.oy, p[2]].map((x) => x.toFixed(3)).join(',') : '-';
      fs.writeFileSync(process.env.DUMPTO + '.decals', o.decals.map((d) => (d.key || '') + ' @ ' + (d.rp || d.p || []).map(W).join(' ')).sort().join('\n'));
      fs.writeFileSync(process.env.DUMPTO + '.strokes', o.strokes.map((s) => (s.tag || '') + ' ' + (s.rgb || '') + ' w' + s.w + ' @ ' + W(s.ra || s.a) + ' ' + W(s.rb || s.b)).sort().join('\n'));
    }
    const cloth = (o.fauna || []).filter((r) => r.cloth).map((r) => [r.kind, r.x, r.y, r.z, r.hd, r.sx, r.sy, r.sz, r.wind, r.ph, r.seed, r.a, r.lum, r.weather]
      .map((x) => (typeof x === 'number' ? Math.round(x * 1e5) : String(x))).join(',') + '|' + (r.tag ? r.tag.cell : '-')).sort();
    frames.push({ t: tris(G.draws).map(tri32), c: census(), w: cloth });
  }
  globalThis.performance = clock;
  const st = scene.ws.armKeepStats;
  scene.close();
  process.stdout.write(JSON.stringify({ frames, st }));
  process.exit(0);
}

const { execFileSync } = await import('node:child_process');
const self = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const fly = (place, seat, hour, keep, move = 0, rec = 0) => JSON.parse(execFileSync(process.execPath, [self, '--fly', place, seat, String(hour), String(keep), String(move), String(rec)],
  { maxBuffer: 1 << 30, encoding: 'utf8', env: process.env }));
let bad = 0, n = 0, extras = 0;
const shown = [];
// FLY=place;seat;hour;move;rec flies that one instead of the list (a place may be a world tile 'x,y').
const ONE = process.env.FLY ? [process.env.FLY.split(';').map((x, i) => (i === 2 ? Number(x) : i >= 3 && /^[0-9.]+$/.test(x) ? Number(x) : x))] : null;
for (const [place, seat, hour, move = 0, rec = 0] of ONE || [['halcyon', 'cockpit', 22], ['nightlife', 'cab', 22], ['residential', 'cockpit', 13], ['oldcoldwater', 'cab', 22], ['halcyon', 'cockpit', 13, 0.02], ['nightlife', 'cab', 22, 0.01], ['halcyon', 'cockpit', 22, 0.05, 15], ['halcyon', 'cab', 13, 'still'], ['nightlife', 'cab', 22, 'still'], ['halcyon', 'cockpit', 22, 'stillfly']]) {
  const { frames: a } = fly(place, seat, hour, 0, move, rec);
  const { frames: b, st } = fly(place, seat, hour, Number(process.env.KEEPB ?? 1), move, rec);
  for (let i = 0; i < a.length; i++) {
    n++;
    // Missing from the kept draw is an error. Extra in it is what the live arm skipped for being
    // behind the eye or behind a nearer building, which the GPU clips or depth-hides: counted.
    const cnt = new Map();
    for (const x of b[i].t) cnt.set(x, (cnt.get(x) || 0) + 1);
    let miss = 0;
    for (const x of a[i].t) { const k = cnt.get(x) || 0; if (k) cnt.set(x, k - 1); else miss++; }
    let extra = 0; for (const k of cnt.values()) extra += k;
    extras += extra;
    if (miss) { bad++; if (shown.length < 4) shown.push(`${place} ${seat} ${hour}h${move ? " straight" : ""}${rec ? " recentred" : ""} frame ${i}: ${miss} live triangles missing from the kept draw`); }
    const ca = a[i].c.join(';'), cb = b[i].c.join(';');
    if (ca !== cb) { bad++; if (shown.length < 4) shown.push(`${place} ${seat} frame ${i}: light census differs (${a[i].c.length} live, ${b[i].c.length} kept)`); }
    const wa = (a[i].w || []).join(';'), wb = (b[i].w || []).join(';');
    if (wa !== wb) { bad++; if (shown.length < 4) shown.push(`${place} ${seat} frame ${i}: cloth differs (${(a[i].w || []).length} live, ${(b[i].w || []).length} kept)`); }
  }
  console.log(`  ${place} ${seat} ${hour}h${move === 'still' ? ' still, then turning' : move === 'stillfly' ? ' still, then straight' : move ? ' straight' : ''}${rec ? ' recentred' : ''}: still ${st.still} (confirmed ${st.stillConfirm}, waited ${st.stillWait}), faceRec ${st.faceRec}, faceDrop ${st.faceDrop}, webDrop ${st.webDrop}, kept ${st.kept}, live ${st.live}, replays ${st.replayed}, rechecks ${st.rechecked}, dropped ${st.dropped}`);
}
for (const l of shown) console.error('  ✗ ' + l);
if (bad) { console.error(`armkeep-check: ${bad} of ${n} frames differ`); process.exit(1); }
console.log(`✓ armkeep-check: ${n} frames, no live triangle missing from the kept draw (${(extras / n).toFixed(1)} extra a frame, skipped live for being out of view).`);
