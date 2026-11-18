// GLASS 2 · DEADBALL'S PLAYERS AS THE CLOSE-UP FIGURE. Phase 1 of docs/proposals/deadball-players-v2.md.
//
// Each man in the park is drawn with ROOM's close-up figure (figure.js, gl/figure-hd.js) instead of the
// lofted ballplayer body: a muscled body under separate clothes, the sculpted head with the street's face
// atlas, and fingers that close on a bat. He still moves on Deadball's own rig: the park solves his pose as it
// always has (gl/ballpark.js setPose), and diamond/figure-rig.js turns that solve into the figure's bone rows.
// What he wears over the figure (the cap or helmet, the mask, the catcher's gear, the glove, the bat, a First
// Generation man's parts) is still ballplayer-mesh.js's, built alone (`look.part` 'gear') and skinned on the
// park's own palette, so it moves with him and fits the skull it was grown for.
//
// A man is drawn this way only once his figure is built (figure-ahead.js builds them in a worker) and the
// figure's shader has linked; until then the park draws his old body, so nobody blinks out. Off by default:
// `__parkFigures.on = 1` in the console, or the Pose Lab's checkbox.
//
// The light is the room's (gl/room-light.js) told about the park: the low sun as a far lamp, the towers as
// lamps, the sky as the ambient, and `uStreet` 3, which hands the park's float target linear, unmapped light
// for the park to tone-map with everything else.

import { FT_M } from '../../../../shared/world-scale.js';

// `on` draws them at all; the rest are the light's strengths against the park's own. `tower` was matched under the
// Pose Lab's floods (2026-11-14): at 5 a white home kit's torso reads within a few levels of the old body's, side on
// and from the broadcast's mound camera. `amb` is the sky's share, which is what lights them by day (2.5 brought a
// white kit at 2 pm level with the old body side on); `sun` the key by day.
// `fans` is the exposure of the stands' close-up fans (gl/crowd-hd.js) against the players': the stands are lit
// as the crowd's bake is, under the roof and back from the floods.
export const PARK_FIGURES = { on: 0, sun: 1.6, tower: 5, amb: 2.5, expo: 1, hdPx: 260, fans: 0.55 };
// What the last frame did, for a bench: the shader linked, men posed, men drawn as the figure
export const parkFigureStats = { ready: false, posed: 0, drawn: 0 };
globalThis.__parkFigures = PARK_FIGURES;
globalThis.__parkFigureStats = parkFigureStats;

const FT = 1 / FT_M;
const SUN_M = 300, LAMPS = 14;
const LP = new Float32Array(LAMPS * 3), LK = new Float32Array(LAMPS), TINT = new Float32Array(LAMPS * 3), NO_ROOM = new Float32Array(LAMPS);

// ⚠ LOADED THE FIRST TIME THE SWITCH IS ON, NOT WITH THE PARK: figure-hd.js's lit shader is ~114k characters
let mods = null, loading = null;
const load = () => (loading ??= Promise.all([import('./figure-hd.js'), import('./room-people.js'), import('../figure-ahead.js'), import('../figure.js'), import('../diamond/figure-rig.js'), import('./ballplayer-mesh.js'), import('./figure-hands.js'), import('./house-style.js'), import('../actor-head.js')])
  .then(([fhd, people, ahead, figure, rig, mesh, hands, house, head]) => { mods = { fhd, people, ahead, figure, rig, mesh, hands, house, head }; }, (e) => { console.warn('ballpark figures off:', e && e.message); }));

const rgb255 = (c) => [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(c[i] * 255))));
const hex255 = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// Those who don't wear a club's kit, as ballplayer-mesh.js dresses them: the umpires and the grounds crew
const PLAIN = { ump: { top: '#1d2740', legs: '#7d8186', belt: '#111111', cut: 'oxford' }, crew: { top: '#2e4a35', legs: '#a39169', belt: '#3a2a1a', cut: 'shortsleeve' } };

// A man's figure, settled (gl/room-people.js lookOf's `figure`): his face as the park paints it (ballplayer-mesh.js
// faceFor), his build off his own (diamond/figure-rig.js figureFit), in his club's kit or his trade's clothes.
function figureOf(look0) {
  const { mesh, rig } = mods;
  // the cast's look, with what ballplayer-mesh.js draws off his name (his skin and hair) filled in
  const look = mesh.lookOf({ ...look0 });
  const face = mesh.faceFor(look), fit = rig.figureFit(look), plain = PLAIN[look.role] || null, kit = look.kit || mesh.KITS[look.side === 'away' ? 'away' : 'home'];
  return {
    head: Math.max(0, mods.head.SCULPT_HEADS.indexOf(face.shape)),
    build: fit.build, weight: fit.weight, age: 0,
    // his own cut, worn under the park's cap or helmet: `ballcap` cuts the figure's locks back under the band
    // (figure.js FIGURE_HATS), so only what hangs below it shows
    hair_style: face.style ?? 0, hat: 'ballcap', facial: face.facialName || 'clean', layout: face.layout,
    skin: rgb255(face.skin), hair: rgb255(face.hair), iris: rgb255(face.iris),
    cut: plain ? plain.cut : 'jersey',
    top: hex255(plain ? plain.top : kit.base), legs: hex255(plain ? plain.legs : kit.pants || kit.base), shoes: [22, 22, 24],
    shirt: hex255(plain ? plain.top : kit.under || kit.ink), trim: hex255(plain ? plain.top : kit.trim), belt: hex255(plain ? (plain.belt || '#111111') : kit.belt || '#111111'),
    fabric_top: 'plain', fabric_legs: 'plain', fabric_shoes: 'leather',
    gear: false, bottoms: '', scarf: '',
  };
}

export function createBallparkFigures(gl) {
  let fig = null;
  const layer = () => fig || (mods ? (fig = mods.fhd.createFigureLayer(gl)) : (load(), null));
  // by slot: the man (`look`, `fit`), his template records by level, and this frame's rows
  const men = new Map();
  let frame = 0;
  // where the ball is (the park's setBall), for the hand that's holding it, and the pitch it's gripped for
  let ballAt = null, ballGrip = null;

  // The cast: who stands in each slot. Their records are made when the switch is first on (`want`).
  function setCast(cast) {
    const keep = new Set();
    for (const c of cast) {
      const slot = c.look.slot, id = c.look.id + '|' + (c.kit?.sig || '') + '|' + c.look.role;
      keep.add(slot);
      const was = men.get(slot);
      if (was && was.id === id) continue;
      men.set(slot, { id, look: { ...c.look, ...(c.kit ? { kit: c.kit } : {}) }, recs: {}, rows: null, J: null, glove: c.look.glove || null });
    }
    for (const slot of [...men.keys()]) if (!keep.has(slot)) men.delete(slot);
  }
  // His template record at a level, off figurePeople, made once; its rows are replaced every frame.
  function recOf(m, level) {
    if (m.recs[level]) return m.recs[level];
    const { people } = mods;
    const body = { id: 'deadball:' + m.look.id, sex: 'male', sculpt: true, figure: figureOf(m.look) };
    // his look alone: figurePeople would build the whole figure here, on the page, to find his soles
    const r = people.figureLook(body, level);
    if (!r) return null;
    m.fit = mods.rig.figureFit(m.look);
    // the kit's own colours, exactly: a street figure's sculpted legs are held to worn denim or darker
    // (gl/room-people.js lookOf), and a ballplayer's trousers are white or grey
    const col = Float32Array.from(r.col), S = mods.figure.FIG_SLOT, f = body.figure, lin = (c) => c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    for (const [slot, c] of [[S.top, f.top], [S.collar, f.top], [S.legs, f.legs], [S.shoes, f.shoes], [S.shirt, f.shirt], [S.gear, f.belt]]) col.set(lin(c), slot * 3);
    // his kit off the park's atlas (diamond/kits.js): his jersey's cell by his slot, his side's trousers, socks and
    // sleeves; the umpires and the grounds crew wear their plain colours
    const { mesh } = mods, sd = m.look.side === 'away' ? 'away' : 'home', plain = m.look.role === 'ump' || m.look.role === 'crew';
    const kit = plain ? null : { cell: Float32Array.from(mesh.kitCell(m.look.slot ?? 0)), pants: Float32Array.from(mesh.KIT_PANTS[sd]), socks: Float32Array.from(mesh.KIT_SOCKS[sd]), sleeves: Float32Array.from(mesh.KIT_SLEEVES[sd]), patch: mesh.LOGO_CELLS.patch[sd] };
    // clean at the start of a game: the street's grime (`grit`) isn't a ballplayer's, and the park keeps its own dirt
    // a belt and nothing else of the figure's gear (a settled look's `gear` is all or none), in the kit's belt colour
    // `clean`: everybody in the park starts the game new, kit or no kit (gl/figure-hd.js uKitOn)
    return (m.recs[level] = { ...r, key: { ...r.key, gear: { belt: true } }, col, kit, clean: true, trim: Float32Array.from(lin(f.trim)), grit: 0, sway: [0, 0, 0], jiggle: null, seatJ: null });
  }

  // A slot's pose for this frame, from the park's own solve (rig.js solvePose's { J, W, s } and its boneFrames):
  // kept, and turned into the figure's rows only if he's drawn as one (rowsOf), so a man posed before the
  // figure's modules arrived, and stood still since, still has his.
  function pose(slot, sol, frames, keyed = null) {
    const m = men.get(slot);
    if (!m) return;
    m.sol = sol; m.hands = keyed;
    m.frames = m.frames && m.frames.length === frames.length ? m.frames : new Float32Array(frames.length);
    m.frames.set(frames);
    m.posedAt = (m.posedAt || 0) + 1;
  }
  function rowsOf(m) {
    if (!m.sol) return null;
    if (m.rowsAt !== m.posedAt) {
      // which way round each hand holds a bat, kept between frames (figure-rig.js figureRows)
      m.grip ??= { L: false, R: false };
      m.rows = mods.rig.figureRows(m.sol, m.frames, m.fit || mods.rig.figureFit(m.look), m.rows || undefined, m.glove, m.grip);
      m.tw = mods.rig.forearmTwist(m.rows);
      m.J = m.sol.J; m.rowsAt = m.posedAt;
    }
    return m.rows;
  }

  // Which of `shown` ([{ slot }]) are drawn as the figure this frame: the switch on, the shader linked, and
  // his figure built. The rest keep the old body. `M` is the shot's matrices, `h` the canvas's height.
  function prepare(shown, M, h) {
    frame++;
    const out = new Set();
    if (!PARK_FIGURES.on) return out;
    if (!mods) { load(); return out; }
    const L = layer();
    parkFigureStats.ready = !!(L && L.ready);
    parkFigureStats.posed = [...men.values()].filter((m) => m.sol).length;
    parkFigureStats.drawn = 0;
    if (!L || !L.ready) return out;
    for (const { slot } of shown) {
      const m = men.get(slot);
      if (!m || !rowsOf(m)) continue;
      // close up, the hd figure; otherwise the lite one (figure.js FIGURE_LEVELS)
      const level = pxTall(m, M, h) > PARK_FIGURES.hdPx ? 'hd' : 'lite';
      const r = recOf(m, level);
      if (!r || !mods.ahead.figureAhead(r.key)) {
        // the other level, if that one's built, rather than the old body
        const o = recOf(m, level === 'hd' ? 'lite' : 'hd');
        if (!o || !mods.ahead.figureAhead(o.key)) continue;
        m.now = o;
      } else m.now = r;
      out.add(slot);
    }
    parkFigureStats.drawn = out.size;
    return out;
  }
  // how tall he stands in the picture, in pixels: his head's row against his pelvis's
  function pxTall(m, M, h) {
    const R = m.rows, hb = mods.figure.FIGURE_BONE.head * 12, pb = mods.figure.FIGURE_BONE.pelvis * 12;
    const p = (o) => { const x = R[o + 3] * FT, y = R[o + 7] * FT, z = R[o + 11] * FT, v = M.viewProj; const w = v[3] * x + v[7] * y + v[11] * z + v[15]; return [(v[0] * x + v[4] * y + v[8] * z + v[12]) / w, (v[1] * x + v[5] * y + v[9] * z + v[13]) / w, w]; };
    const a = p(hb), b = p(pb);
    if (a[2] <= 0 || b[2] <= 0) return 0;
    return Math.abs(a[1] - b[1]) * 0.5 * h * 2.1;
  }

  // The figures' records for this frame: the template's look, this frame's rows, the hands closed on what
  // they hold, a blink now and then.
  function recsFor(slots, t) {
    const { hands } = mods, out = [];
    for (const slot of slots) {
      const m = men.get(slot), r = m?.now;
      if (!r || !m.rows) continue;
      const H = mods.rig.handHolds(m.J, m.glove, ballAt, ballGrip ? mods.rig.gripOf(ballGrip) : null, m.hands);
      const every = 3.6 + (slot % 5) * 0.7, b = (t + slot * 1.37) % every;
      out.push({ ...r, rows: m.rows, hands: hands.handsUniforms(hands.shapeMix(H.L), hands.shapeMix(H.R), m.tw?.L || 0, m.tw?.R || 0, m.J.gripL ? mods.rig.GRIP_HOLD : null, m.J.gripR ? mods.rig.GRIP_HOLD : null), blink: b < 0.15 ? Math.sin((b / 0.15) * Math.PI) : 0 });
    }
    return out;
  }

  // The park's light as the room's uniforms (gl/room-light.js), in metres. `light` is { towers: [{ p, col }]
  // (feet, linear), sun: { dir, col } or null, up, dn (the sky's linear colours), night, comic, centre (feet) }.
  function setLight(P, light, eyeM, w, h) {
    gl.uniform3fv(P.u('uEye'), eyeM);
    const lp = LP.fill(0), lk = LK.fill(0), tint = TINT.fill(1), lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const C = (light.centre || [0, 0, 60]).map((v) => v * FT_M);
    let n = 0;
    if (light.sun) {
      const d = light.sun.dir, s = Math.max(1e-3, lum(light.sun.col));
      lp.set([eyeM[0] + d[0] * SUN_M, eyeM[1] + d[1] * SUN_M, eyeM[2] + d[2] * SUN_M], 0);
      lk[0] = PARK_FIGURES.sun * s * (1 + 1.1 * SUN_M * SUN_M);
      tint.set(light.sun.col.map((v) => v / s), 0);
      n = 1;
    }
    // each tower brought to about its strength over the field
    const T = light.towers || [], top = Math.max(1e-3, ...T.map((q) => lum(q.col)));
    for (const q of T) {
      if (n >= LAMPS || !(lum(q.col) > 0)) continue;
      const p = q.p.map((v) => v * FT_M), d = Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]), s = lum(q.col);
      lp.set(p, n * 3);
      lk[n] = PARK_FIGURES.tower * (s / top) * (1 + 1.1 * d * d) / Math.max(1, T.length / 2);
      tint.set(q.col.map((v) => v / s), n * 3);
      n++;
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
    gl.uniform1f(P.u('uOutZ'), 1e9);
    gl.uniform3f(P.u('uOutRing'), -1e9, 1e9, -1e9);
    const up = light.up || [0.3, 0.3, 0.3], dn = light.dn || up, k = PARK_FIGURES.amb;
    gl.uniform3f(P.u('uAmb'), k * (up[0] + dn[0]) / 2, k * (up[1] + dn[1]) / 2, k * (up[2] + dn[2]) / 2);
    gl.uniform1f(P.u('uExpo'), PARK_FIGURES.expo * (light.expo ?? 1));
    gl.uniform1f(P.u('uComic'), light.comic ? 1 : 0);
    gl.uniform2f(P.u('uRes'), w, h);
    gl.uniform1f(P.u('uStreet'), 3);
  }

  return {
    setCast, pose, prepare,
    setBall(p, grip = null) { ballAt = p ? p.slice() : null; ballGrip = grip || null; },
    get loaded() { return !!mods; },
    // Draws `slots` (prepare's) as figures: their outline when `ink` is set, then their bodies, lit. `M` is the
    // shot's matrices (feet), `w`×`h` the target.
    // `slots` cast into a shadow map at `vp` (feet): false until the figure's depth program has linked, and then
    // the park casts their old bodies instead.
    depth(slots, vp, t) {
      if (!slots.size || !fig) return false;
      const R = recsFor(slots, t);
      if (!R.length) return false;
      const v = new Float32Array(vp);
      for (let i = 0; i < 12; i++) v[i] *= FT;
      const cull = gl.isEnabled(gl.CULL_FACE);
      gl.disable(gl.CULL_FACE);
      const ok = fig.depth(v, R);
      if (cull) gl.enable(gl.CULL_FACE);
      return ok;
    },
    // `kitTex` is the park's kit atlas (diamond/kits.js), sampled on unit 2, and `logoTex` its logo atlas, on 3.
    draw(slots, M, w, h, light, t, ink = true, kitTex = null, logoTex = null) {
      if (!slots.size || !fig) return 0;
      return drawRecs(recsFor(slots, t), M, w, h, light, ink, kitTex, logoTex);
    },
    // The figure layer on this context, made (and its modules loaded) the first time it's asked for: the stands'
    // close-up fans (gl/crowd-hd.js) are drawn with it too, whether or not the players are.
    layer: () => layer(),
    // Any records in the park's frame (metres), drawn as draw() draws the players: the stands' close-up fans.
    drawRecs: (R, M, w, h, light, ink = true) => (fig && R.length ? drawRecs(R, M, w, h, light, ink, null, null) : 0),
    dispose() { try { fig?.dispose(); } catch { /* the context may be gone */ } fig = null; men.clear(); },
  };
  function drawRecs(R, M, w, h, light, ink, kitTex, logoTex) {
      if (!R.length) return 0;
      const vp = new Float32Array(M.viewProj);
      for (let i = 0; i < 12; i++) vp[i] *= FT;
      const eyeM = [M.eye[0] * FT_M, M.eye[1] * FT_M, M.eye[2] * FT_M];
      const cull = gl.isEnabled(gl.CULL_FACE);
      gl.disable(gl.CULL_FACE);
      gl.activeTexture(gl.TEXTURE2);
      const unit2 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, kitTex);
      gl.activeTexture(gl.TEXTURE3);
      const unit3 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, logoTex);
      if (!kitTex) for (const r of R) r.kit = null;
      else if (!logoTex) for (const r of R) if (r.kit) r.kit = { ...r.kit, patch: null };
      gl.activeTexture(gl.TEXTURE1);
      const unit1 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const { HOUSE } = mods.house;
      if (ink) fig.ink(vp, R, (P) => {
        const k = h / 900;
        gl.uniform2f(P.u('uRes'), w, h);
        gl.uniform4f(P.u('uInk'), 0.01, HOUSE.px[0] * k, HOUSE.px[1] * k, 0);
        gl.uniform3fv(P.u('uEyeI'), eyeM);
        gl.uniform1f(P.u('uBack'), 0.02);
        gl.uniform3fv(P.u('uCol'), HOUSE.ink);
        gl.uniform3fv(P.u('uKey'), light.sun ? light.sun.dir : [0, 1, 0]);
        gl.uniform1f(P.u('uWeigh'), HOUSE.weigh);
      });
      fig.draw(vp, R, (P) => setLight(P, light, eyeM, w, h));
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, unit1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, unit2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, unit3);
      gl.activeTexture(gl.TEXTURE0);
      if (cull) gl.enable(gl.CULL_FACE);
      return R.length;
  }
}
