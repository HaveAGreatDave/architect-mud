// THE WIRES, ON THE DEPTH BUFFER.
//
// A great deal of GLASS is not mass, not a light and not a sign: it is a STROKE. A guyed antenna
// mast, a lattice tower's legs and braces, a catwalk rail, a crane jib, a mooring cable, a
// light-runner tracing a tower's corner, a windsock pole. Each is a line between two world points
// drawn at a width in SCREEN pixels, because that is what makes a lattice read as a lattice at four
// hundred metres instead of dissolving into nothing.
//
// ⚠ AND THAT IS EXACTLY WHY THEY WERE THE LAST THINGS PAINTING THROUGH BUILDINGS. A stroke has a
// screen width and no world thickness, so there was nothing to hand a triangle list and nothing for
// `MESH_SINK` to record — every one of them stayed on the 2-D canvas, which with the mass on the GPU
// is composited AFTER the city and cannot be painted over. The only thing between a mast and the
// warehouse in front of it was `decoHidden`, which answers per SURFACE: a mast anchored on a hidden
// roof still has its tip in clear air, so it answers "draw" for the whole wire.
//
// ⚠ THE ANSWER IS NOT A BAKED BILLBOARD, AND THAT WAS TRIED AND MEASURED AND TAKEN BACK OUT. Baking
// a wire into a canvas and uploading it is a canvas repaint plus a texImage2D PER INSTANCE PER
// FRAME — affordable for the handful of landmarks it was written for, and a cockpit framerate below
// GLASS 1 for a part that hangs off ordinary buildings by the dozen.
//
// So it is geometry after all, built where the screen width is a thing you can express: the quad is
// expanded IN THE VERTEX SHADER from the two endpoints and a pixel width, exactly as the sprite
// layer expands a light from a point and a pixel radius. Six vertices a segment, no texture, no
// bake, one draw call for every wire in the city.
import { viewProjMatrix, mat4f, zRow, NEAR, eyePos } from './camera.js';
import { makeVertexStream } from './stream.js';
import { createArena } from './retain.js';
import { declareProgram, takeWarm } from './programs.js';
import { linearOut, applyLinOut } from './colour.js';

// NDC depth is A + B/f, from the ONE place NEAR and FAR are named. See sprites.js for the twin.
// ⚠ PER FRAME, BECAUSE THE PLANE IS. These two were module constants off NEAR/FAR, which
// was right while the near plane was one — and is a silent half-tile depth error the moment
// a seat fits its own: the matrix would put a light at one depth and this shader would
// compare it at another, on the low seats only.
const WIRE_PULL = 0.05;

// a3, b3, param2 (side, end), style3 (width px, alpha, feather), colour3
const STRIDE = 15;

const VERT = `#version 300 es
in vec3 aA;
in vec3 aB;
in vec2 aParam;
in vec3 aStyle;
in vec3 aColor;
// The pull toward the eye, in tiles, done here instead of on the CPU: each end slides along its own
// ray to max(0.06, depth - pull) / depth of the way out, which is what cam.unproj does. 0 means the
// ends arrive already pulled. Stage 3 of glass-headroom.
in float aPull;
uniform vec3 uEye;
uniform mat4 uViewProj;
uniform vec2 uViewport;
// The projection z row [A, B] and the pull in tiles — see the WARN below and the twin in sprites.js.
uniform vec2 uAB;
uniform float uPull;
uniform float uTime;
out float vSide;
out float vFeather;
out vec3 vColor;
out float vAlpha;
void main() {
  vec3 A = aA, B = aB;
  if (aPull > 0.0) {
    float fa = (uViewProj * vec4(aA, 1.0)).w, fb = (uViewProj * vec4(aB, 1.0)).w;
    A = uEye + (aA - uEye) * (max(0.06, fa - aPull) / fa);
    B = uEye + (aB - uEye) * (max(0.06, fb - aPull) / fb);
  }
  vec4 ca = uViewProj * vec4(A, 1.0);
  vec4 cb = uViewProj * vec4(B, 1.0);
  // The direction the line runs ON SCREEN, which is the only frame a pixel width means anything in.
  // Taken after the perspective divide, so a wire running away from the eye is thickened across its
  // apparent direction rather than its world one.
  vec2 sa = ca.xy / max(1e-6, ca.w) * uViewport * 0.5;
  vec2 sb = cb.xy / max(1e-6, cb.w) * uViewport * 0.5;
  vec2 d = sb - sa;
  float len = length(d);
  // A degenerate segment (both ends on the same pixel) has no direction to be perpendicular to.
  // Pick one rather than dividing by zero: the quad is a pixel-sized dot either way.
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec4 clip = mix(ca, cb, aParam.y);
  clip.xy += perp * aParam.x * (aStyle.x * 0.5) * (2.0 / uViewport) * clip.w;
  // A HAIR TOWARD THE CAMERA, for the reason the sprite layer needs one: a rail sits ON the deck it
  // runs along and a light-runner ON the corner it traces, so at exactly that depth the wire
  // z-fights its own host into a stipple.
  //
  // WARN IT WAS 'clip.z -= 0.0012 * clip.w' AND THAT IS A CONSTANT IN NDC, WHICH IS NOT LINEAR IN
  // DISTANCE — a world pull of 0.34 tiles at six, 0.91 at ten and 8.6 at the draw limit, against a
  // building's own near wall at 0.44. So every mast, catwalk rail, guy wire and light-runner past
  // about seven tiles tested as though it stood in front of its own building. Same line, same
  // arithmetic and same fix as sprites.js: a fixed pull in TILES along the view ray, leaving x/w
  // and y/w untouched so only the depth it is compared at moves.
  float fp = max(0.02, clip.w - uPull);
  clip.z = (uAB.x + uAB.y / fp) * clip.w;
  gl_Position = clip;
  vSide = aParam.x;
  vFeather = aStyle.z;
  vColor = aColor;
  vAlpha = aStyle.y;
  // Gas-tube hum on glow haloes only (feather 1). The phase is hashed from the tube's own end, so
  // every sign breathes on its own and the same sign breathes the same way every frame.
  if (aStyle.z > 0.99) {
    float h = fract(sin(dot(A.xz + B.xz, vec2(12.9898, 78.233))) * 43758.5453);
    float hum = 0.96 + 0.04 * sin(uTime * (7.0 + 5.0 * h) + h * 6.2832);
    // A rare stutter: about one tube in eight dips for a twentieth of a second now and then.
    float tick = floor(uTime * 20.0);
    float r = fract(sin(tick * 0.137 + h * 91.7) * 43758.5453);
    vAlpha *= hum * ((h > 0.875 && r > 0.97) ? 0.35 : 1.0);
  }
}`;

const FRAG = linearOut(`#version 300 es
precision highp float;
in float vSide;
in float vFeather;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
  // 'feather' is 0 for a hard line and 1 for a halo. A canvas stroke is antialiased across its own
  // edge and a shadowBlur halo falls off across its whole width, and one number covers both.
  // (Single quotes, never backticks: this comment is inside a template literal.)
  float d = abs(vSide);
  float a = vAlpha * (1.0 - smoothstep(1.0 - max(0.08, vFeather), 1.0, d));
  vec3 col = vColor;
  if (vFeather > 0.99) {
    // A glow halo: the Shadertoy neon profile in place of a flat plateau. A tight exp() core that
    // goes white-hot on the tube, plus a wide exponential bloom that trails out and is forced to zero at
    // the quad's edge so no hard rim shows.
    float core = exp(-d * d * 60.0);
    float bloom = exp(-d * 2.6) * (1.0 - d * d);
    a = vAlpha * (0.9 * core + 1.5 * bloom);
    col = mix(vColor, vec3(1.0), core * 0.25);
  }
  if (a < 0.004) discard;
  outColor = vec4(col * a, a);
}`, 'outColor');

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' stroke shader: ' + log);
  }
  return sh;
}

// A stroke is `{ a: [x,y,z], b: [x,y,z], w, rgb: [0-255 x3], alpha, glow }` — two world points in
// the same camera-relative tile frame the lights use, a width in DEVICE pixels, a colour, a fade,
// and how many pixels of soft halo to lay round it (the 2-D renderer's `shadowBlur`, which is the
// single most expensive thing it does and here is one more quad).
export function createStrokeLayer(gl) {
  // Prewarmed with the context when it can be (programs.js); built here otherwise.
  let prog = takeWarm(gl, VERT, FRAG);
  if (!prog) {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
    gl.linkProgram(prog);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('stroke link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    a: gl.getAttribLocation(prog, 'aA'),
    b: gl.getAttribLocation(prog, 'aB'),
    param: gl.getAttribLocation(prog, 'aParam'),
    style: gl.getAttribLocation(prog, 'aStyle'),
    color: gl.getAttribLocation(prog, 'aColor'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    viewport: gl.getUniformLocation(prog, 'uViewport'),
    ab: gl.getUniformLocation(prog, 'uAB'),
    pull: gl.getUniformLocation(prog, 'uPull'),
    time: gl.getUniformLocation(prog, 'uTime'),
    eye: gl.getUniformLocation(prog, 'uEye'),
    pullA: gl.getAttribLocation(prog, 'aPull'),
  };

  const vao = gl.createVertexArray();
  // One stream, set up once: the attribute pointers are recorded into the VAO here and never
  // touched again, and the storage grows by doubling instead of being reallocated every frame.
  // See gl/stream.js.
  const ATTRS = [[loc.a, 3, 0], [loc.b, 3, 12], [loc.param, 2, 24], [loc.style, 3, 32], [loc.color, 3, 44], [loc.pullA, 1, 56]];
  const stream = makeVertexStream(gl, vao, STRIDE, ATTRS, 4096);
  let data = new Float32Array(0);
  let count = 0, split = 0, deep = 0;

  // side, end — the four corners of the quad as two triangles.
  const CORNERS = [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]];

  // `ox`/`oy`: see the sprite layer's upload.
  // `groups` are retained ones (gl/retain.js): `{ recs, ox, oy }`. Each keeps its glowing cores, its
  // plain cores and its haloes in three arenas, drawn before this frame's own of the same kind.
  const arenaLit = createArena(gl, STRIDE, ATTRS), arenaCore = createArena(gl, STRIDE, ATTRS), arenaHalo = createArena(gl, STRIDE, ATTRS);
  const KEYS = new WeakMap();
  // ⚠ THE HALOES GO AT THE END, for the reason the sprite layer's additive lights do: two blend
  // modes is two draw calls whatever happens, and a halo ADDS light to the wall behind it while
  // the wire itself lays colour over it.
  // `add` IS A STROKE THAT IS LIGHT AND NOTHING ELSE: no core laid over the scene, only the
  // additive pass. The rainbow is the one caller. A bow is sunlight bent back out of the rain,
  // so it brightens whatever stands behind the shower and can never darken it.
  const sort = (list, deepOn, lit, core, halo) => {
    for (const st of list) {
      if (!st || !st.a || !st.b) continue;
      if (st.add) { halo.push(st); continue; }
      if (deepOn && st.glow > 0) lit.push(st); else core.push(st);
      if (st.glow > 0) halo.push(st);
    }
  };
  // A canvas stroke is antialiased over its own edge, so a 0.8px brace is not 80 per cent of a
  // pixel of coverage — it is a whole pixel at 80 per cent alpha. Widening to a floor of one
  // device pixel and carrying the shortfall in the alpha is what keeps a lattice reading as a
  // lattice rather than as a scatter of dropouts.
  // ⚠ A CORE MAY CARRY A SOFT EDGE. `feather` below 1 fades the sides over that share of the
  // width; a wire leaves it unset and stays hard. The rain columns are the one caller: a veil laid
  // OVER the scene, so it can't be an additive halo, and a hard-edged one read as a grey plank.
  // 1 is the glow profile and stays the halo's.
  const putCore = (d, o, st, ox, oy) => { const w = Math.max(1, st.w || 1); const f = st.feather > 0 && st.feather < 0.99 ? st.feather : 0; return putStroke(d, o, st, w, f, (st.alpha == null ? 1 : st.alpha) * Math.min(1, (st.w || 1) / w), ox, oy); };
  const putHalo = (d, o, st, ox, oy) => st.add
    ? putStroke(d, o, st, Math.max(1, st.w || 1), st.feather == null ? 0.5 : st.feather, st.alpha == null ? 1 : st.alpha, ox, oy)
    : putStroke(d, o, st, Math.max(1, st.w || 1) + st.glow * 2, 1, (st.alpha == null ? 1 : st.alpha) * 0.38, ox, oy);
  function upload(list, ox = 0, oy = 0, groups = null) {
    const deepOn = !!(list && list.deep);
    const gLit = [], gCore = [], gHalo = [];
    if (groups) for (const G of groups) {
      let k = KEYS.get(G.recs);
      if (!k || k.ox !== G.ox || k.oy !== G.oy || k.deep !== deepOn) { k = { ox: G.ox, oy: G.oy, deep: deepOn, lit: {}, core: {}, halo: {} }; KEYS.set(G.recs, k); }
      const lt = [], co = [], ha = [];
      sort(G.recs, deepOn, lt, co, ha);
      if (lt.length) gLit.push({ key: k.lit, floats: lt.length * 6 * STRIDE, write: (d, o) => { for (const st of lt) o = putCore(d, o, st, G.ox, G.oy); return o; } });
      if (co.length) gCore.push({ key: k.core, floats: co.length * 6 * STRIDE, write: (d, o) => { for (const st of co) o = putCore(d, o, st, G.ox, G.oy); return o; } });
      if (ha.length) gHalo.push({ key: k.halo, floats: ha.length * 6 * STRIDE, write: (d, o) => { for (const st of ha) o = putHalo(d, o, st, G.ox, G.oy); return o; } });
    }
    arenaLit.retain(gLit); arenaCore.retain(gCore); arenaHalo.retain(gHalo);
    const core = [], halo = [], lit = [];
    sort(list || [], deepOn, lit, core, halo);
    // Glowing cores go FIRST so the depth-only prepass is one contiguous range.
    deep = lit.length * 6;
    core.unshift(...lit);
    split = core.length * 6;
    count = split + halo.length * 6;
    if (data.length < count * STRIDE) data = new Float32Array(Math.max(count * STRIDE, 4096));
    let o = 0;
    for (const st of core) o = putCore(data, o, st, ox, oy);
    for (const st of halo) o = putHalo(data, o, st, ox, oy);
    if (count) stream.write(data, count * STRIDE);
    return count / 6 + (arenaLit.verts + arenaCore.verts + arenaHalo.verts) / 6;
  }
  // One stroke's quad into `d` at `o`; returns the next offset. `ox`/`oy`: see the sprite layer's upload.
  function putStroke(d, o, st, w, feather, alpha, ox, oy) {
    const [r, g, b] = st.rgb || [255, 255, 255];
    const cr = r / 255, cg = g / 255, cb = b / 255;
    const A = st.pl > 0 ? st.ra : st.a, B = st.pl > 0 ? st.rb : st.b, pl = st.pl > 0 ? st.pl : 0;
    for (const [side, end] of CORNERS) {
      d[o] = A[0] + ox; d[o + 1] = A[1] + oy; d[o + 2] = A[2];
      d[o + 3] = B[0] + ox; d[o + 4] = B[1] + oy; d[o + 5] = B[2];
      d[o + 6] = side; d[o + 7] = end;
      d[o + 8] = w; d[o + 9] = alpha; d[o + 10] = feather;
      d[o + 11] = cr; d[o + 12] = cg; d[o + 13] = cb;
      d[o + 14] = pl;
      o += STRIDE;
    }
    return o;
  }

  // `W`/`H` are the CANVAS in device pixels, because the width arrives already scaled by the
  // frame's dpr; `cssH` is the CAMERA's own frame height, which is what the matrix is built from.
  // Same two-heights trap as the sprites.
  function draw(cam, W, H, cssH) {
    const rL = arenaLit.runs, rC = arenaCore.runs, rH = arenaHalo.runs;
    if (!count && !rL.length && !rC.length && !rH.length) return 0;
    const runs = (arena, rs) => { if (!rs.length) return; gl.bindVertexArray(arena.vao); for (const [a, n] of rs) gl.drawArrays(gl.TRIANGLES, a, n); gl.bindVertexArray(vao); };
    gl.useProgram(prog); applyLinOut(gl, prog);
    gl.uniformMatrix4fv(loc.viewProj, false, mat4f(viewProjMatrix(cam, cssH || H)));
    gl.uniform2f(loc.viewport, W, H);
    const zr = zRow((cam && cam.near) || NEAR);
    gl.uniform2f(loc.ab, zr[0], zr[1]);
    gl.uniform1f(loc.pull, WIRE_PULL);
    gl.uniform1f(loc.time, (performance.now() / 1000) % 3600);
    { const e = eyePos(cam); gl.uniform3f(loc.eye, e[0], e[1], e[2]); }
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);        // a wire is thinner than the depth buffer can express; it must not hide anything
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(vao);
    // ⚠ Depth-only prepass for neon cores, so the cloud deck (which tests against what the world
    // left) stops drawing over a tube that stands against the sky. The colour pass below is the one
    // that always shipped; LEQUAL lets each core pass its own depth.
    if (deep || rL.length) {
      gl.depthFunc(gl.LEQUAL);
      gl.colorMask(false, false, false, false); gl.depthMask(true);
      runs(arenaLit, rL);
      if (deep) gl.drawArrays(gl.TRIANGLES, 0, deep);
      gl.depthMask(false); gl.colorMask(true, true, true, true);
    }
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    runs(arenaLit, rL); runs(arenaCore, rC);
    if (split) gl.drawArrays(gl.TRIANGLES, 0, split);
    gl.blendFunc(gl.ONE, gl.ONE);
    runs(arenaHalo, rH);
    if (count > split) gl.drawArrays(gl.TRIANGLES, split, count - split);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return count / 6 + (arenaLit.verts + arenaCore.verts + arenaHalo.verts) / 6;
  }

  return { upload, draw, get strokes() { return count / 6; } };
}

declareProgram(VERT, FRAG);
