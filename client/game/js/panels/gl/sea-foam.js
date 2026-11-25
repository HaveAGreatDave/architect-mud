// FOAM THAT STAYS ON THE WATER (RENDER_TUNE.glSeaFoamSim; docs/reference/glass-notes.md "Foam that stays").
//
// The water shader works out its foam fresh every frame from where each point is on its wave, so
// once a crest has passed there is nothing left behind it. Real surf leaves white water that drifts
// in with the broken wave and thins to lace over many seconds. This keeps that residue in a texture
// over the near sea, in world tiles round the camera:
//
//   each step, the last field is read back a little upwave (so it drifts shoreward with the bore and
//   downwind), faded, and the foam being made right now (breakers, the bore, whitecaps) is maxed in.
//
// The water shader samples it and shapes it into lace. 0 on the flag draws nothing here and binds a
// black texel, so the sea is the sea as it shipped.
//
// The field is one channel, ping-ponged between two targets. RGBA16F where the device can draw float
// (the fade per frame is smaller than one 8-bit step); RGBA8 otherwise, stepped at 15 Hz so each fade
// is big enough to register.
import { SEA_GLSL } from './sea-glsl.js';
import { BREAK_GLSL } from '../../../../shared/sea-breakers.js';
import { layerProgram } from './programs.js';
import { texture2D } from './core/texture.js';
import { SEA_FOAM_LEAD, SURF_DEPTH_Q, SEA_K } from '../../../../shared/sea-swell.js';

// The field's half-width in tiles and its resolution. 256 over 36 tiles is about 7 texels a tile,
// which is enough for lace shaped by the shader's own noise on top.
export const FOAM_R = 18 / SEA_K;
const RES = 256;
// The texture unit the water shader reads it on. 0 to 6 belong to the floor and the water layer,
// and the floor's 7 and 8 are bound for its own program.
export const FOAM_UNIT = 9;

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPrev;
uniform sampler2D uLut0, uLut1, uDepthT;
uniform int   uMh;
uniform float uR;
uniform vec2  uO, uPO;      // this step's and the last step's field origin, world tiles
uniform float uSize;        // the field's width in tiles
uniform float uT, uDt;
uniform float uRoll, uWind, uState, uFoam, uSurf, uShelter, uShoal, uRefract, uBore;
uniform vec2  uSeaRot, uWindDir;

${SEA_GLSL}
${BREAK_GLSL}

// The same clamped bilinear read the water layer's vertex shader uses, so the foam is made on the
// water the mesh draws and not a texel beside it.
float lutA(sampler2D s, vec2 p, int ch) {
  vec2 f = vec2(uR) + p;
  ivec2 i = ivec2(floor(f));
  vec2 fr = f - floor(f);
  ivec2 m = ivec2(uMh - 1);
  vec4 a = texelFetch(s, clamp(i, ivec2(0), m), 0), b = texelFetch(s, clamp(i + ivec2(1, 0), ivec2(0), m), 0);
  vec4 c = texelFetch(s, clamp(i + ivec2(0, 1), ivec2(0), m), 0), d = texelFetch(s, clamp(i + ivec2(1), ivec2(0), m), 0);
  vec4 v = mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
  return ch == 0 ? v.r : v.a;
}
float waterAt(vec2 p)   { return lutA(uLut0, p, 3); }
float shelterAt(vec2 p) { return lutA(uLut1, p, 3); }
float depthAt(vec2 p)   { return lutA(uDepthT, p, 0) * ${(255 / SURF_DEPTH_Q).toFixed(4)}; }

void main() {
  vec2 w = uO + vUv * uSize;
  float water = waterAt(w);
  float deep = clamp((water - 0.5) * 2.0, 0.0, 1.0);
  vec2 gW = vec2(waterAt(w + vec2(1.0, 0.0)) - waterAt(w - vec2(1.0, 0.0)),
                 waterAt(w + vec2(0.0, 1.0)) - waterAt(w - vec2(0.0, 1.0)));
  vec2 gH = vec2(depthAt(w + vec2(1.0, 0.0)) - depthAt(w - vec2(1.0, 0.0)),
                 depthAt(w + vec2(0.0, 1.0)) - depthAt(w - vec2(0.0, 1.0)));
  vec2 kdir = seaUnturn(vec2(0.8529, 0.5224), uSeaRot);
  float hM = depthAt(w);
  vec2 sw = seaRefract(seaShoal(w, water, gW, uShoal), hM, gH, kdir, uRefract);
  vec2 swR = seaFrame(sw, uSeaRot);
  float shel = mix(1.0, shelterAt(w), uShelter);
  float H0 = seaH0(uRoll, uWind) * shel;
  float zone = seaSurfZone(hM, H0) * smoothstep(0.0, 0.5, deep) * uSurf;
  float broken = smoothstep(0.75, 1.0, zone);
  float seaK = clamp(uState * 1.4 + 0.25, 0.0, 1.0);

  // The foam being made now, the same pieces the water shader draws: the lip just ahead of the
  // crest, the whitewater down the broken wave's face, and the whitecaps out at sea.
  float fp = seaSurfPhase(swR, uT);
  float lip = exp(-pow((fp + 0.22) / 0.3, 2.0));
  float face = smoothstep(-1.5, -0.35, fp) * (1.0 - smoothstep(-0.05, 0.15, fp)) * broken;
  // The bore: once broken, the wave runs in as a wall of white water on its front, wider than the lip.
  face = max(face, uBore * broken * exp(-pow((fp + 0.6) / 0.55, 2.0)));
  float inj = zone * seaK * max(lip * 0.9, face);
  vec2 spF = sw - uWindDir * ${SEA_FOAM_LEAD.toFixed(3)};
  float wvF = seaChop(seaFrame(spF, uSeaRot), uT, seaPh(swR, uT));
  inj = max(inj, clamp((wvF + seaFoamGroup(seaFrame(spF, uSeaRot), uT) - uFoam) * 4.0, 0.0, 1.0) * deep * 0.8);
  // Where the breaker's fold squeezes the surface toward nothing, the lip is going over: foam there
  // whatever the phase says (Crest makes its crest foam off the same pinch, the Jacobian).
  float J = seaBreakFold(swR, uT, zone).y;
  inj = max(inj, smoothstep(0.6, 0.2, J) * zone * seaK);
  // The open sea's breakers, laid down where they break so the white stays in the water behind them.
  if (uNBrk > 0) inj = max(inj, seaBreakerFoam(w, clamp(0.5 + 0.8 * wvF, 0.0, 1.0), deep));

  // Drift: shoreward with the broken wave (the swell runs toward -k), and a little downwind.
  vec2 drift = -normalize(kdir) * (0.05 + 0.55 * broken * seaK) + uWindDir * 0.04 * uState;
  vec2 uv = (w - drift * uDt - uPO) / uSize;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  // A little blur each step, so a patch spreads and softens as it ages instead of only dimming
  // (Sea of Thieves' camera-centred foam buffer does the same). Scaled by the step, so the spread
  // per second doesn't depend on the frame rate.
  vec2 bt = vec2(min(1.0, uDt * 6.0) / ${RES}.0);
  float prev = (texture(uPrev, uv).r * 4.0
             + texture(uPrev, uv + vec2(bt.x, 0.0)).r + texture(uPrev, uv - vec2(bt.x, 0.0)).r
             + texture(uPrev, uv + vec2(0.0, bt.y)).r + texture(uPrev, uv - vec2(0.0, bt.y)).r) / 8.0 * inside;
  // Spent foam thins over seconds; in the surf zone the water stays churned longer. It runs a little
  // way up the sand with the swash and dies there.
  // Out at sea it lasts longer the harder it blows, which is what turns a gale white: breakers lay it
  // down faster than it thins. About 5 s on a fresh day, 12 s in a full gale.
  float tau = mix(5.0 + 7.0 * uState, 11.0, zone);
  float keep = exp(-uDt / tau) * smoothstep(0.3, 0.48, water);
  o = vec4(max(prev * keep, inj), 0.0, 0.0, 1.0);
}`;

export function createSeaFoam(gl) {
  const prog = layerProgram(gl, VERT, FRAG, 'sea-foam');
  const U = (n) => gl.getUniformLocation(prog, n);
  const names = ['uPrev', 'uLut0', 'uLut1', 'uDepthT', 'uMh', 'uR', 'uO', 'uPO', 'uSize', 'uT', 'uDt', 'uRoll', 'uWind',
    'uState', 'uFoam', 'uSurf', 'uShelter', 'uShoal', 'uRefract', 'uBore', 'uSeaRot', 'uWindDir', 'uNBrk', 'uBrkP', 'uBrkS'];
  const loc = Object.fromEntries(names.map((n) => [n, U(n)]));
  const float = !!gl.getExtension('EXT_color_buffer_float');
  const fmt = float ? { format: gl.RGBA16F, type: gl.HALF_FLOAT } : {};
  const tex = [0, 1].map(() => texture2D(gl, { w: RES, h: RES, ...fmt }));
  const fbs = tex.map((t) => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return fb;
  });
  const black = texture2D(gl, { w: 1, h: 1, data: new Uint8Array([0, 0, 0, 255]) });
  const vao = gl.createVertexArray();
  const size = 2 * FOAM_R, tpt = RES / size;
  let cur = 0, lastT = null, acc = 0, O = [0, 0], PO = [0, 0], live = false;

  // One step of the field. `s` is the floor state the water layer is drawing from; `lut` its LUTs.
  function step(s, lut) {
    const t = s.t || 0;
    let dt = lastT == null ? 0 : t - lastT;
    // The sea clock wraps (seaClock); a jump either way is a new start, not ten minutes of fade.
    if (!(dt >= 0) || dt > 1) dt = 0;
    lastT = t;
    acc += dt;
    if (!float && acc < 1 / 15 && live) return;
    dt = live ? acc : 0;
    acc = 0;
    // The origin snaps to whole texels, so the field scrolls under the camera without resampling blur.
    PO = live ? O : [0, 0];
    O = [Math.floor((s.ax || 0) * tpt) / tpt - FOAM_R, Math.floor((s.ay || 0) * tpt) / tpt - FOAM_R];
    // Off until now: the last field is stale, so read it from nowhere and start clean.
    if (!live) PO = [O[0] + 1e6, O[1] + 1e6];

    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const vp = gl.getParameter(gl.VIEWPORT);
    const sc = gl.isEnabled(gl.SCISSOR_TEST), bl = gl.isEnabled(gl.BLEND), dp = gl.isEnabled(gl.DEPTH_TEST);
    const nxt = 1 - cur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbs[nxt]);
    gl.viewport(0, 0, RES, RES);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0 + FOAM_UNIT); gl.bindTexture(gl.TEXTURE_2D, tex[cur]); gl.uniform1i(loc.uPrev, FOAM_UNIT);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, lut.tex); gl.uniform1i(loc.uLut0, 2);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, lut.tex1 || lut.tex); gl.uniform1i(loc.uLut1, 5);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, lut.tex2 || lut.tex); gl.uniform1i(loc.uDepthT, 6);
    gl.uniform1i(loc.uMh, lut.mh | 0);
    gl.uniform1f(loc.uR, s.R || 0);
    gl.uniform2f(loc.uO, O[0], O[1]);
    gl.uniform2f(loc.uPO, PO[0], PO[1]);
    gl.uniform1f(loc.uSize, size);
    gl.uniform1f(loc.uT, t);
    gl.uniform1f(loc.uDt, dt);
    gl.uniform1f(loc.uRoll, s.seaRoll || 0);
    gl.uniform1f(loc.uWind, s.seaWind || 0);
    gl.uniform1f(loc.uState, s.seaState || 0);
    gl.uniform1f(loc.uFoam, s.seaFoam == null ? 1.2 : s.seaFoam);
    gl.uniform1f(loc.uSurf, s.seaSurf || 0);
    gl.uniform1f(loc.uShelter, s.seaShelter || 0);
    gl.uniform1f(loc.uShoal, s.seaShoal || 0);
    gl.uniform1f(loc.uRefract, s.seaRefract || 0);
    gl.uniform1f(loc.uBore, s.seaBore || 0);
    const rot = s.seaRot || [1, 0], wd = s.seaWindDir || [1, 0];
    gl.uniform2f(loc.uSeaRot, rot[0], rot[1]);
    gl.uniform2f(loc.uWindDir, wd[0], wd[1]);
    // Every step, like the water's own: a stale count leaves a breaker laying foam after it's gone.
    const bk = s.breakers;
    gl.uniform1i(loc.uNBrk, bk ? bk.n : 0);
    if (bk) { gl.uniform4fv(loc.uBrkP, bk.P); gl.uniform4fv(loc.uBrkS, bk.S); }
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    // The target now holds the field; unbind it from its unit before anything draws into the other.
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    if (sc) gl.enable(gl.SCISSOR_TEST);
    if (bl) gl.enable(gl.BLEND);
    if (dp) gl.enable(gl.DEPTH_TEST);
    cur = nxt;
    live = true;
  }

  // Bind the field for the water shader: the texture, and its origin and width for the lookup.
  // Off, a black texel, so every read is 0.
  function bind(on, locTex, locO, locS) {
    gl.activeTexture(gl.TEXTURE0 + FOAM_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, on && live ? tex[cur] : black);
    gl.uniform1i(locTex, FOAM_UNIT);
    gl.uniform2f(locO, O[0], O[1]);
    gl.uniform1f(locS, size);
    if (!on) { live = false; lastT = null; }
  }

  return { step, bind, get live() { return live; } };
}
