// GLASS 2 · THE STREET'S CLOSE-UP LEVEL: the nearest people on the pavement drawn as the Room Stage draws
// them, with figure.js's close-up figure (gl/figure-hd.js), not the crowd's baked body.
//
// The ladder (docs/proposals/street-people-ladder.md), all off one look (gl/room-people.js streetLook):
//
//   close-up   the Room Stage's own figure, posed on the CPU by figurePeople and skinned on the GPU; `hd`
//              within FIGURE_LOD's few metres and `lite` past them. At most STREET_HD.max people.
//   crowd      the baked body with the street's heads (gl/actors.js), instanced
//   far        the far body, a few hundred vertices on the same clips
//   billboard  the canvas card, in the coat's tone
//
// ROOM and GLASS don't share a frame. A room is metres with Y up; the street is map-window tiles with Z up,
// and the crowd's body is placed in it mirrored (forward F, its left hand on (F.y, -F.x), gl/actors.js VERT).
// So the figures are posed in a room frame laid on the street, metres about an anchor at the eye's foot:
// room X along tile x, room Y up, room Z along tile y. That's a mirror, as the crowd's own placing is, and
// it's what keeps the close-up figure's left hand where the crowd's is. `M` takes that frame into tiles and
// the street's view-projection takes it from there; the figure's shader never knows it's outdoors.
//
// The light is the room's (gl/room-light.js) told about the street: the sun or the moon as a far lamp,
// the nearest street lights as lamps, no panes, no indoors, and `uStreet` to leave out the room's
// vignette and hand GLASS's float target linear light.
//
// The crowd still draws everybody into the mirror and the ink's depth prepass; in the main pass it hides
// whoever this draws (gl/actors.js uHideHD) once this layer's program has linked. Until then the crowd
// draws them, so nobody blinks out while the 114k-character shader compiles.

import { figurePeople, figureLooks } from './room-people.js';
import { FIGURE_CROWN } from '../figure.js';
import { figureAhead } from '../figure-ahead.js';
import { viewProjMatrix, multiply, eyePos } from './camera.js';
import { HOUSE } from './house-style.js';
import { LIN, linRgb } from './colour.js';
import { setRoomLight as roomLight } from './room-light-uniforms.js';

// `on` 0 is the crowd for everybody, as before. `px` is how tall somebody is on the screen, in device pixels,
// before they're drawn close up, and `off` the share of that they drop back under (so a figure on the line
// doesn't flicker). `max` is how many at once, nearest first. The street's figure is 1.776 m, so 100 px is a
// head about 13 px tall: far enough off that the change from the crowd's body to the close-up figure doesn't
// show (at 260 px, a 34 px head, it did, 2026-11-15). Most are drawn at the lite level out there.
// `nodM`: how near (metres) somebody who knows you has to be before they nod; `nodAgainMs`: and not again for this long
export const STREET_HD = { on: 1, px: 100, off: 0.8, max: 16, hdPx: 0, nodM: 4, nodAgainMs: 45000 };
// Which close-up level, by size on screen rather than the room's metres (FIGURE_LOD): the street's camera zooms, and
// someone 10 m off through a long lens filled the frame at the lite level. `hdPx` up, back to lite under `off` of it.
// Phones keep the crowd: GLASS Lite already leaves street life out there.
const PHONE = (() => {
  try {
    const mm = globalThis.matchMedia, sc = globalThis.screen;
    if (typeof mm !== 'function' || !sc) return false;
    return mm('(pointer: coarse)').matches && Math.min(sc.width || 0, sc.height || 0) < 600;
  } catch { return false; }
})();
// What the last frames did, for a bench: candidates, drawn close up, and the CPU spent posing them.
export const streetHdStats = { cand: 0, drawn: 0, poseMs: 0, ready: false, tallest: 0 };
// From the console: __streetHD.tune.px = 120 to bring people close up sooner, .on = 0 for the crowd alone.
globalThis.__streetHD = { tune: STREET_HD, stats: streetHdStats };

// The room frame's world(a, b, h): a along tile x, h up, b along tile y (see above).
const FRAME = { world: (a, b, h) => [a, h, b], r: [1, 0, 0], f: [0, 0, 1], baseAt: () => 0 };
const SUN_M = 200;       // how far off the sun's lamp stands, in metres: far enough that it's a direction
const LAMPS = 14;
// setLight's uniforms, filled again every draw (uniform*fv copies them, so one set does every context)
const LP = new Float32Array(LAMPS * 3), LK = new Float32Array(LAMPS), TINT = new Float32Array(LAMPS * 3), NO_ROOM = new Float32Array(LAMPS);

// ⚠ LOADED THE FIRST TIME SOMEBODY IS CLOSE ENOUGH, NOT WITH GLASS. figure-hd.js declares its programs for every
// new context's prewarm (programs.js), and its lit shader is ~114k characters: imported here statically, every
// GLASS context (the room's window worker included) would compile it at birth whether a person ever came near.
let figMod = null, figLoading = null;
const loadFigure = () => (figLoading ??= import('./figure-hd.js').then((m) => { figMod = m; }, (e) => { console.warn('street close-up off:', e && e.message); }));

export function createStreetHD(gl) {
  let fig = null;
  // (with the censor's panels: the vat hall's sleepers, drawn through this layer in one-world, are bare, drawRoom)
  const layer = () => fig || (figMod ? (fig = figMod.createFigureLayer(gl, { half: PHONE, panels: true })) : (loadFigure(), null));
  // who's close up, kept a frame to the next so the line has a margin (STREET_HD.off)
  const held = new Set(), hdHeld = new Set();
  let chosen = [], recs = [], posedFor = -1, frame = 0;
  const env = { eye: [0, 0, 0], A: [0, 0, 0], s: 1, key: [0, 0, 1], night: 0 };

  // From this frame's actor records: mark who's drawn close up (r.close = 1; `hd` is the heading) before the crowd uploads, so it knows
  // whom to hide. Nearest first by how tall they are on the screen.
  function pick(actorRecs) {
    frame++;
    streetHdStats.frames = frame;
    chosen = [];
    // phones too (at half resolution, createFigureLayer's `half`): nobody near you is the crowd's body
    // YOU (r.self: the Pack and the view from behind, windshield.js drawSelfFigure) are ALWAYS the close-up figure,
    // whatever your size, the far LOD or STREET_HD.on: the crowd's copy of you is hidden even while your figure builds.
    if (!STREET_HD.on) {
      held.clear(); streetHdStats.cand = 0;
      for (const r of actorRecs) if (r.self && r.o && r.o.hd && r.o.hd.id) { r.close = 1; if (lookReady(r.o.hd)) { layer(); chosen.push(r); } }
      return chosen.length;
    }
    const cand = [];
    let top = 0;
    for (const r of actorRecs) {
      const id = r.o && r.o.hd && r.o.hd.id;
      if (r.px > top) top = r.px;
      if (id && r.self) { r.close = 1; cand.push(r); continue; }
      if (!id || r.lod || !(r.px > 0)) continue;
      // somebody knocked flying: limb by limb here whatever their size (street-ragdoll.js), first in the queue;
      // with no bones to bring (the whole-body tumble), the crowd's body draws them
      if (r.limb) { cand.push(r); continue; }
      if (r.rag) continue;
      const need = held.has(id) ? STREET_HD.px * STREET_HD.off : STREET_HD.px;
      if (r.px >= need) cand.push(r);
    }
    streetHdStats.cand = cand.length;
    streetHdStats.people = actorRecs.length;
    streetHdStats.tallest = Math.round(top);
    cand.sort((a, b) => (b.self ? 2e9 : b.limb ? 1e9 : b.px) - (a.self ? 2e9 : a.limb ? 1e9 : a.px));
    held.clear();
    // only somebody whose figure is built: anybody else is asked for (figure-ahead.js) and stays in the crowd meanwhile
    if (cand.length) layer();
    for (let i = 0; i < cand.length && chosen.length < STREET_HD.max; i++) {
      if (!lookReady(cand[i].o.hd)) continue;
      cand[i].close = 1; held.add(cand[i].o.hd.id); chosen.push(cand[i]);
    }
    streetHdStats.waiting = cand.length - chosen.length;
    return chosen.length;
  }
  // Both levels a person is drawn at (gl/room-people.js figureLooks), asked for together, so dropping to the lite
  // level a few metres off doesn't build on the page either. Kept per id: a look is fixed by the id and the feed's
  // `s` and `g`, and a changed `g` is a new object, so it's asked again.
  const readyFor = new Map();
  function lookReady(L) {
    const was = readyFor.get(L.id);
    if (was && was.L === L && was.ok) return true;
    const keys = figureLooks({ id: L.id, sex: L.sex, figure: L.figure, wear: L.wear || null, sculpt: true });
    let ok = true;
    for (const k of keys) if (!figureAhead(k)) ok = false;
    readyFor.set(L.id, { L, ok });
    return ok;
  }
  const ready = () => !!(fig && fig.ready);

  // How somebody minding a spot (a street dealer, server/engine/street-actors.js `r`) takes the viewer. `stare`: eyes on
  // you the whole time you're near, and they don't look away. `nod`: they look at you as anyone would, and the first
  // time you come close a chin-up, quick up and slower down. Anything else, the ordinary noticing.
  const nodded = new Map();
  function regard(r, id, now) {
    if (!r.rg || !env.eye) return {};
    if (r.rg === 'stare') return { watch: env.eye, watchHold: true };
    if (r.rg !== 'nod') return {};
    const d = Math.hypot((r.x - env.A[0]) / env.s, (r.y - env.A[1]) / env.s);
    let at = nodded.get(id);
    if (d < STREET_HD.nodM && (!at || now - at > STREET_HD.nodAgainMs)) nodded.set(id, at = now);
    const k = at ? (now - at) / 1000 : 9;
    const flick = k < 0.16 ? k / 0.16 : k < 0.7 ? 1 - (k - 0.16) / 0.54 : 0;
    return { watch: env.eye, flick: 0.2 * flick * flick * (3 - 2 * flick) };
  }

  // The chosen records posed as the room poses people, once a frame, at draw time (it needs the eye).
  function pose(cam, now) {
    if (posedFor === frame) return recs;
    posedFor = frame;
    recs = [];
    if (!chosen.length) return recs;
    const t0 = performance.now();
    const E = eyePos(cam), r0 = chosen[0], s = r0.s0 || r0.s;
    env.s = s;
    env.A = [E[0], E[1], 0];
    env.eye = [0, E[2] / s, 0];
    const kl = Math.hypot(r0.lx || 0, r0.ly || 0, 0.35) || 1;
    env.key = [(r0.lx || 0) / kl, 0.35 / kl, (r0.ly || 0) / kl];
    env.night = Math.max(0, Math.min(1, (1 - (r0.nl ?? r0.lum ?? 1)) / 0.38));
    const bodies = chosen.map((r) => {
      const L = r.o.hd;
      // hdPx 0: anybody big enough to come off the crowd's body is the full figure, never the lite one
      const level = r.px >= STREET_HD.hdPx * (hdHeld.has(L.id) ? STREET_HD.off : 1) ? 'hd' : 'lite';
      if (level === 'hd') hdHeld.add(L.id); else hdHeld.delete(L.id);
      return { level, id: L.id, sex: L.sex, figure: L.figure, wear: L.wear || null, sculpt: true, pose: 'stand',
        at: [(r.x - env.A[0]) / s, (r.y - env.A[1]) / s], lift: ((r.limbZ ?? r.z ?? 0) - env.A[2]) / s,
        // the crowd's forward F = (cos hd, sin hd) in tiles is the room's (sin yaw, cos yaw)
        yaw: Math.PI / 2 - (r.hd || 0),
        clip: r.hdClip || r.clip || 'idle', phase: r.hdClip ? r.hdPh || 0 : r.ph || 0,
        ...regard(r, L.id, now),
        // their own bones, laid out with no turn of their own (street-ragdoll.js works in this frame)
        ...(r.limb ? { skin: r.limb, yaw: 0 } : {}),
        // their height: a settled one, or the crowd's own five per cent either way
        height: L.figure && L.figure.height ? undefined : FIGURE_CROWN * ((r.s / s) || 1) };
    });
    recs = figurePeople(FRAME, bodies, now / 1000, { level: 'hd', eye: env.eye });
    // you, under your own eyes, from the neck down (freelook-view.js fpSelf, figure-hd.js uNoHead)
    for (let i = 0; i < recs.length; i++) { const nh = chosen[i].o.hd.noHead; if (nh && recs[i]) recs[i].noHead = nh; if (chosen[i].o.hd.outline && recs[i]) { recs[i].outline = true; recs[i].outlineForm = chosen[i].o.hd.outlineForm ?? 1; } }
    streetHdStats.poseMs = performance.now() - t0;
    return recs;
  }

  // The street's light as the room's uniforms (gl/room-light.js), in the room frame.
  function setLight(P, lights, cssW, cssH) {
    const { A, s, key, night, eye } = env;
    gl.uniform3fv(P.u('uEye'), eye);
    const lp = LP.fill(0), lk = LK.fill(0), tint = TINT.fill(1);
    // the sun by day, the moon and the sky's glow by night: one far lamp along the key light
    const sunK = (1 - night) * 0.95 + night * 0.22;
    lp.set([eye[0] + key[0] * SUN_M, eye[1] + key[1] * SUN_M, eye[2] + key[2] * SUN_M], 0);
    lk[0] = sunK * (1 + 1.1 * SUN_M * SUN_M);
    tint.set(night > 0.5 ? [0.62, 0.7, 0.92] : [1.0, 0.95, 0.86], 0);
    // then the street lights nearest the eye, each brought to about the strength the crowd gives it at half its reach
    let n = 1;
    if (lights && lights.length) {
      const near = [];
      for (const L of lights) {
        const p = L.p, R = (L.rl || (L.rw == null ? L.r : L.rw) || 0) / s;
        if (!p || !(R > 0)) continue;
        const X = (p[0] - A[0]) / s, Y = (p[2] - A[2]) / s, Z = (p[1] - A[1]) / s, d = Math.hypot(X - eye[0], Z - eye[2]);
        if (d < R + 12) near.push({ X, Y, Z, R, d, c: L.lamp || L.rgb || [1, 0.9, 0.7] });
      }
      near.sort((a, b) => a.d - b.d);
      for (const q of near) {
        if (n >= LAMPS) break;
        lp.set([q.X, q.Y, q.Z], n * 3);
        lk[n] = 0.55 * (1 + 1.1 * (q.R / 2) * (q.R / 2));
        tint.set(q.c, n * 3);
        n++;
      }
    }
    gl.uniform3fv(P.u('uLampP'), lp);
    gl.uniform1fv(P.u('uLampK'), lk);
    gl.uniform1fv(P.u('uLampRoom'), NO_ROOM);
    gl.uniform1i(P.u('uLampN'), n);
    gl.uniform1i(P.u('uLampHome'), n);
    gl.uniform1i(P.u('uNextN'), 0);
    gl.uniform3f(P.u('uLampC'), 1, 1, 1);
    gl.uniform3fv(P.u('uLampTint'), tint);
    gl.uniform1i(P.u('uLampTinted'), 1);
    gl.uniform1i(P.u('uWinCount'), 0);
    gl.uniform3f(P.u('uWinC'), 0.8, 0.85, 0.95);
    gl.uniform4f(P.u('uAnnex'), 0, 0, 0, 0);
    // nowhere is "the balcony": with no ceiling, the lamps light everywhere
    gl.uniform1f(P.u('uOutZ'), 1e9);
    gl.uniform3f(P.u('uOutRing'), -1e9, 1e9, -1e9);
    const amb = 0.34 * (1 - night) + 0.12 * night;
    gl.uniform3f(P.u('uAmb'), amb * 0.92, amb * 0.95, amb * (1.0 + 0.15 * night));
    gl.uniform1f(P.u('uExpo'), 1.15);
    gl.uniform1f(P.u('uComic'), 1);
    gl.uniform2f(P.u('uRes'), cssW, cssH);
    gl.uniform1f(P.u('uStreet'), LIN.out ? 2 : 1);
  }

  // A ROOM'S OWN LIGHT for somebody posed in it (drawRoom): gl/room-light-uniforms.js, which a cat in GLASS takes too
  const setRoomLight = (P, env, cssW, cssH) => roomLight(gl, P, env, cssW, cssH);


  return {
    pick,
    // Whether the close-up figure can be drawn this frame (it loads and links in the background; asking starts it).
    roomReady() { layer(); return ready(); },
    // People posed in a ROOM's frame (figurePeople off its layout) drawn in the street's pass: the vat hall's sleepers
    // in one-world (gl/interiors.js). `VP` is the street's view-projection times the room's matrix, `env` the room's
    // light (setRoomLight). Their censor's panels are drawn by censorRoom, after whatever goes over them.
    drawRoom(VP, R, env) {
      if (!R?.length || !ready()) return false;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      const ink = LIN.out ? linRgb(HOUSE.ink) : HOUSE.ink;
      gl.activeTexture(gl.TEXTURE1);
      const unit1 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      fig.ink(VP, R, (P) => {
        const k = h / 900;
        gl.uniform2f(P.u('uRes'), w, h);
        gl.uniform4f(P.u('uInk'), 0.01, HOUSE.px[0] * k, HOUSE.px[1] * k, 0);
        gl.uniform3fv(P.u('uEyeI'), env.eye);
        gl.uniform1f(P.u('uBack'), 0.02);
        gl.uniform3fv(P.u('uCol'), ink);
        gl.uniform3f(P.u('uKey'), 0, 1, 0);
        gl.uniform1f(P.u('uWeigh'), HOUSE.weigh);
      });
      fig.draw(VP, R, (P) => setRoomLight(P, env, w, h));
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, unit1);
      gl.activeTexture(gl.TEXTURE0);
      return true;
    },
    // the panels over whoever drawRoom drew bare, last (figure-hd.js censor): the picture as it now stands, at its viewport
    censorRoom(VP, R, eye) {
      if (!R?.length || !ready()) return 0;
      const v = gl.getParameter(gl.VIEWPORT);
      return fig.censor ? fig.censor(VP, R, eye, v[2], v[3]) : 0;
    },
    get ready() { return ready(); },
    get count() { return chosen.length; },
    // Draws the chosen people in the main pass; false when it drew nothing (the crowd then keeps them).
    draw(camAt, cssH, opts = {}) {
      streetHdStats.ready = ready();
      streetHdStats.drawn = 0;
      if (!chosen.length || !ready()) return false;
      const now = opts.now ?? performance.now();
      const R = pose(camAt, now);
      if (!R.length) return false;
      const { A, s } = env;
      // the room frame into tiles: X → x, Y → z, Z → y, scaled by tiles a metre, about the anchor
      const M = [s, 0, 0, 0, 0, 0, s, 0, 0, s, 0, 0, A[0], A[1], A[2], 1];
      const VP = multiply(opts.vp || viewProjMatrix(camAt, cssH, opts.near, opts.far), M);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      // whatever the street's passes left on, the figure's own state, as gl/room.js draws it
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      const ink = LIN.out ? linRgb(HOUSE.ink) : HOUSE.ink;
      // figure-hd.js binds the face atlas on unit 1 and leaves it there; whatever the street had on it goes back
      gl.activeTexture(gl.TEXTURE1);
      const unit1 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      fig.ink(VP, R, (P) => {
        const k = h / 900;
        gl.uniform2f(P.u('uRes'), w, h);
        gl.uniform4f(P.u('uInk'), 0.01, HOUSE.px[0] * k, HOUSE.px[1] * k, 0);
        gl.uniform3fv(P.u('uEyeI'), env.eye);
        gl.uniform1f(P.u('uBack'), 0.02);
        gl.uniform3fv(P.u('uCol'), ink);
        gl.uniform3f(P.u('uKey'), 0, 1, 0);
        gl.uniform1f(P.u('uWeigh'), HOUSE.weigh);
      });
      fig.draw(VP, R, (P) => setLight(P, opts.lights, w, h));
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, unit1);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      streetHdStats.drawn = R.length;
      return true;
    },
  };
}
