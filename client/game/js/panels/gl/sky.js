// ── THE SKY, AS A DIRECTION RATHER THAN A SCREEN ROW ─────────────────────────────────────────
//
// The 2-D sky is a vertical gradient split at `horizonY`, which is a picture of a sky seen by a
// camera that never tilts. This pass asks the question the other way round: every pixel works out
// WHICH WAY IT IS LOOKING — through the same principal point, focal lengths and pitch `makeCam`
// uses, with the canvas bank undone — and colours that direction. So the sky is right at any head
// tilt, from any seat, and the zenith is the zenith rather than the top edge of a gradient.
//
// ⚠ IT IS DRAWN FIRST, INTO THE SCENE'S OWN CANVAS, AND BLITTED WHERE THE GRADIENT WAS PAINTED.
// Everything the 2-D sky pass layers on top — the stars, the moon, the sun disc, the aurora, the
// ridge — goes on drawing over it exactly as before. The world pass clears this canvas when it runs
// later in the frame, so borrowing it costs no second context (the browser caps those at 16).
//
// ⚠ THE COLOURS ARE THE HOUR'S OWN `top` AND `hor`, NOT A PHYSICAL MODEL'S. Step one keeps the
// palette the game was tuned against and changes only the GEOMETRY of the sky — a scattering model
// is a separate look change, to be judged on its own.
//
// ⚠ SAVES AND RESTORES THE STATE IT TOUCHES. Every other pass here sets up what it needs, but this
// one runs BEFORE the world pass in a frame and after last frame's cloud pass, so anything it left
// behind is inherited by a layer that did not expect it.

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// ── THE SKY IN ONE DIRECTION ──────────────────────────────────────────────────────────────────────
//
// Everything in the sky that depends on the direction alone: the hour's gradient, the sun's glow, the
// airglow and the galaxy band. The sky pass below adds the stars and the moon, which are placed and
// sized in screen pixels; the reflection cube (gl/envcube.js) renders this and nothing else. ⚠ ONE
// DEFINITION FOR BOTH, so a tower never reflects a sky that disagrees with the one above it.
// band comes back as the galaxy band's strength, which the sky pass's second star field reads.
export const SKY_DIR_GLSL = `
uniform vec3  uTop;       // 0-1
uniform vec3  uHor;
uniform vec3  uSunDir;    // world, unit; z up
uniform vec3  uSunCol;
uniform float uSunOn;
// The night. uNightA is how much star light reaches the eye (the hour's darkness less the cloud
// that takes it); uAirglow is the horizon band's own share, which an overcast keeps some of.
uniform float uNightA;
uniform float uAirglow;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
// Air mass, the 2-D pass's own curve: a star low down dims and warms.
float extinction(float e) { return clamp(0.14 + clamp(e, 0.0, 1.0) * 0.98, 0.0, 1.0); }
// ── THE GLOW RIGHT AROUND THE SUN: (amount, sharpness) of a pow(cos, k) lobe ─────────────────────
//
// ⚠ THE SKY'S LOBE IS TIGHT AND THE CUBE'S IS WIDE, AND THAT IS RESOLUTION, NOT DISAGREEMENT. At k 96
// the lobe is about 6° to half strength, and on top of a bright afternoon sky it clipped to white out
// to about 11°: a sun twenty times its size. At k 700 it is about 2°. The reflection cube is 32
// texels a face, near 3° each, so a 2° lobe would land between texels and flicker on chrome as the
// sun moved; it keeps the wide one, which a blurred reflection can hold.
const vec2 SUN_LOBE_SKY = vec2(0.40, 700.0);
const vec2 SUN_LOBE_CUBE = vec2(0.45, 96.0);
vec3 skyDirColor(vec3 dir, vec2 sunLobe, out float band) {
  float e = dir.z;
  vec3 col = mix(uHor, uTop, pow(clamp(e, 0.0, 1.0), 0.5));
  if (e < 0.0) col = uHor * (1.0 - 0.25 * clamp(-e * 4.0, 0.0, 1.0));
  if (uSunOn > 0.0) {
    float c = max(dot(dir, uSunDir), 0.0);
    col += uSunCol * (0.22 * pow(c, 8.0) + sunLobe.x * pow(c, sunLobe.y)) * uSunOn;
    // The low sun warms the horizon on its own side of the sky and not the other.
    vec2 hd = normalize(dir.xy + 1e-5), sd = normalize(uSunDir.xy + 1e-5);
    float low = 1.0 - clamp(uSunDir.z * 2.5, 0.0, 1.0);
    float hb = pow(1.0 - abs(e), 6.0);
    col += uSunCol * 0.30 * hb * pow(max(dot(hd, sd), 0.0), 3.0) * low * uSunOn;
  }
  band = 0.0;
  if (uNightA > 0.0 && e > -0.02) {
    // Airglow: the faint green band that means a night sky is never black at the horizon.
    col += vec3(0.20, 0.34, 0.29) * 0.2 * uAirglow * pow(clamp(1.0 - e / 0.3, 0.0, 1.0), 2.0) * step(0.0, e);
    // The galaxy: a band round one great circle, lumpy, with its own thicker dust of stars.
    vec3 gN = normalize(vec3(0.42, 0.31, 0.85));
    float gd = dot(dir, gN);
    band = exp(-gd * gd / 0.018) * (0.45 + 0.55 * noise3(dir * 7.0)) * (0.6 + 0.4 * noise3(dir * 23.0));
    col += vec3(0.86, 0.88, 0.96) * 0.10 * band * uNightA * extinction(e);
  }
  return col;
}
`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2  uRes;       // the canvas, device pixels
uniform vec2  uCss;       // the frame, CSS pixels (the unit every camera number is in)
uniform float uHp;        // principal point row, CSS px
uniform float uFL;        // lateral focal length
uniform float uDepth;     // vertical focal length
uniform float uPitch;     // radians, + tips the view down
uniform float uSinh;
uniform float uCosh;
uniform float uBank;      // the canvas bank, radians, undone before the ray is cast
uniform vec2  uShake;     // the bank pivot's shake offset, CSS px
uniform float uTime;      // seconds, for the twinkle
uniform float uPxAng;     // radians per CSS pixel at the centre of the frame — a star's size
uniform vec3  uMoonDir;   // world, unit
uniform float uMoonOn;
uniform vec2  uMoonPx;    // where the disc lands, CSS px, before the bank
uniform float uMoonR;     // its radius in CSS px — the disc is round ON SCREEN, see below
uniform float uMoonCosPh; // cos of the phase angle: 1 full, -1 new
uniform vec3  uMoonSun;   // the true sun direction, for which LIMB is lit
// ⚠ THE FACE IS THE 2-D MOON'S OWN BAKE (moonFaceSprite), NOT A SECOND IDEA OF THE MOON. Maria,
// the Tycho ray system and the craters are authored there; this pass supplies only the sphere's
// lighting. uMoonUV is disc-radius / sprite-size, so a disc offset maps onto the sprite exactly.
uniform sampler2D uMoonFace;
uniform float uMoonUV;
uniform float uMoonTex;   // 0 = no sprite handed over, fall back to the noise face
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
${SKY_DIR_GLSL}
vec3 starTint(float c) {
  vec3 blue = vec3(0.78, 0.86, 1.0), white = vec3(1.0, 0.98, 0.94), warm = vec3(1.0, 0.82, 0.62);
  return c < 0.5 ? mix(blue, white, c * 2.0) : mix(white, warm, (c - 0.5) * 2.0);
}
// One star per occupied cell of a 3-D grid laid through the sphere. The grid is in WORLD space, so
// the field is fixed to the sky and turns with nothing but the sky; a cell is a fraction of a degree
// wide, so a star is never cut by its cell's edge at any size it is drawn.
vec3 starField(vec3 dir, float K, float density, float gain) {
  vec3 c = floor(dir * K);
  float h = hash3(c);
  if (h > density) return vec3(0.0);
  vec3 j = vec3(hash3(c + 17.1), hash3(c + 31.7), hash3(c + 53.3));
  vec3 sd = normalize((c + 0.15 + 0.7 * j) / K);
  float m = pow(hash3(c + 71.9), 3.0);                  // mostly faint, a handful bright
  float r = acos(clamp(dot(dir, sd), -1.0, 1.0)) / uPxAng;   // pixels from the star
  float size = 0.55 + m * 0.9;
  float core = exp(-r * r / (size * size));
  float halo = m > 0.8 ? exp(-r / (3.0 + m * 5.0)) * 0.25 : 0.0;
  float ext = extinction(dir.z);
  float twA = (1.0 - m * 0.7) * (1.0 - ext * 0.55);
  float tw = 1.0 - twA * (0.5 + 0.5 * sin(uTime * (1.5 + 4.0 * hash3(c + 91.3)) + h * 40.0));
  float a = (0.18 + 0.82 * m) * ext * tw * gain;
  return starTint(hash3(c + 5.3) + (1.0 - ext) * 0.5) * (core + halo) * a;
}

void main() {
  vec2 s = vec2(gl_FragCoord.x / uRes.x * uCss.x, (1.0 - gl_FragCoord.y / uRes.y) * uCss.y);
  // Undo the bank: the 2-D pass draws the world under translate(pivot)·rotate(−bank)·translate(−C).
  vec2 d = s - (0.5 * uCss + uShake);
  float cb = cos(uBank), sb = sin(uBank);
  vec2 p = vec2(d.x * cb - d.y * sb, d.x * sb + d.y * cb) + 0.5 * uCss;
  // Screen -> camera ray (f' = 1), then the pitch undone -> the level frame -> the world.
  float l = (p.x - 0.5 * uCss.x) / uFL;
  float uu = -(p.y - uHp) / uDepth;
  float cp = cos(uPitch), sp = sin(uPitch);
  float f0 = cp + uu * sp, u = uu * cp - sp;
  vec3 dir = normalize(vec3(f0 * uSinh + l * uCosh, -f0 * uCosh + l * uSinh, u));

  float e = dir.z;
  float band;
  vec3 col = skyDirColor(dir, SUN_LOBE_SKY, band);
  // The stars are sized in pixels (uPxAng), so they stay here and out of skyDirColor.
  if (uNightA > 0.0 && e > -0.02) {
    col += starField(dir, 180.0, 0.004, uNightA);
    col += starField(dir, 420.0, 0.0003 + 0.004 * band, uNightA * 0.45);
  }
  if (uMoonOn > 0.0) {
    // ⚠ IN PIXELS, NOT IN ANGLE. GLASS's lateral and vertical focal lengths differ (FL against
    // viewFocal), so a disc that is round in angle comes out as an ellipse; the 2-D moon has
    // always been a circle on the glass, and so is this one.
    vec2 mo = (p - uMoonPx) / uMoonR;
    float rr = length(mo);
    // The halo grows with how much moon there is to make it.
    float illum = 0.5 + 0.5 * uMoonCosPh;
    col += vec3(0.84, 0.88, 0.97) * (0.55 * exp(-rr / 1.4) + 0.12 * exp(-rr / 4.0)) * illum * uMoonOn;
    if (rr < 1.02) {
      // The disc as a SPHERE: the pixel's point on the face, its normal, and a light that comes
      // from the sun's side of the sky by exactly the phase angle — so the horns point away from
      // the sun and the lit fraction is the calendar's, whatever the arc approximations say.
      vec3 e1 = normalize(cross(uMoonDir, vec3(0.0, 0.0, 1.0)) + vec3(1e-5));
      vec3 e2 = cross(e1, uMoonDir);
      float r2 = min(rr * rr, 1.0);
      vec3 n = e1 * mo.x * -1.0 + e2 * -mo.y - uMoonDir * sqrt(1.0 - r2);
      vec3 ts = uMoonSun - uMoonDir * dot(uMoonSun, uMoonDir);
      ts = length(ts) > 1e-4 ? normalize(ts) : normalize(cross(uMoonDir, vec3(0.0, 0.0, 1.0)));
      float sinPh = sqrt(max(0.0, 1.0 - uMoonCosPh * uMoonCosPh));
      vec3 Lm = ts * sinPh - uMoonDir * uMoonCosPh;
      float lit = smoothstep(-0.04, 0.10, dot(n, Lm));
      float mare = 0.78 + 0.22 * noise3(n * 5.0 + 3.1) - 0.12 * smoothstep(0.55, 0.8, noise3(n * 2.3));
      vec3 albedo = vec3(0.93, 0.93, 0.90) * mare;
      if (uMoonTex > 0.5) albedo = texture(uMoonFace, vec2(0.5) + mo * uMoonUV).rgb;
      vec3 face = albedo * (0.25 + 0.75 * lit) + vec3(0.02, 0.025, 0.04);
      float edge = 1.0 - smoothstep(0.97, 1.02, rr);
      // Earthshine: the dark limb is never quite the sky colour.
      col = mix(col, max(col, face * mix(0.10, 1.0, lit)), edge * uMoonOn);
    }
  }
  // A sky is one long gradient, which bands at eight bits; half a level of noise breaks it up.
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

import { declareProgram, takeWarm } from './programs.js';

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' sky shader: ' + log);
  }
  return sh;
}

const layers = new WeakMap();

function layerFor(gl) {
  let L = layers.get(gl);
  if (L) return L;
  // Prewarmed with the context when it can be (programs.js); built here otherwise.
  let prog = takeWarm(gl, VERT, FRAG, SKY_BIND);
  if (!prog) {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('sky link: ' + gl.getProgramInfoLog(prog));
  const U = (n) => gl.getUniformLocation(prog, n);
  const loc = {
    res: U('uRes'), css: U('uCss'), hp: U('uHp'), FL: U('uFL'), depth: U('uDepth'), pitch: U('uPitch'),
    sinh: U('uSinh'), cosh: U('uCosh'), bank: U('uBank'), shake: U('uShake'),
    top: U('uTop'), hor: U('uHor'), sunDir: U('uSunDir'), sunCol: U('uSunCol'), sunOn: U('uSunOn'),
    nightA: U('uNightA'), airglow: U('uAirglow'), time: U('uTime'), pxAng: U('uPxAng'),
    moonDir: U('uMoonDir'), moonOn: U('uMoonOn'), moonPx: U('uMoonPx'), moonR: U('uMoonR'), moonFace: U('uMoonFace'), moonUV: U('uMoonUV'), moonTex: U('uMoonTex'), moonCosPh: U('uMoonCosPh'), moonSun: U('uMoonSun'),
  };
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // One triangle covering the viewport.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  L = { prog, loc, vao, tex: gl.createTexture(), texSrc: null };
  layers.set(gl, L);
  return L;
}

// `s` is { W, H, hp, FL, depth, pitch, heading (deg), bank (rad), shX, shY, top, hor (0-255),
//          sunDir [x,y,z] | null, sunCol (0-255), nightA, airglow, now (ms), moonDir | null,
//          moonA, moonPx [x,y], moonR, moonCosPh, moonSun,
//          moonFace (canvas), moonFaceR (the disc radius the sprite was baked at) }.
export function drawSky(gl, canvas, s) {
  const L = layerFor(gl);
  // ⚠ NO STATE IS READ BACK, AND IT IS HANDED BACK AT WEBGL'S DEFAULTS. This saved and restored ten
  // pieces of state with getParameter and isEnabled, and the first of them each frame is a
  // synchronous round trip to the GPU process that waits for every command queued before it: in the
  // Modelshop's district bench it was 56-87% of the frame (SwiftShader, where draining the queue is
  // the rendering itself), and halving the frame when removed. The defaults are safe to hand back
  // because they are what the world pass already starts from on a scene's first frame, when this
  // pass returns null and never runs.
  const caps = [gl.DEPTH_TEST, gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST];
  gl.activeTexture(gl.TEXTURE0);
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    for (const c of caps) gl.disable(c);
    gl.colorMask(true, true, true, true);
    gl.useProgram(L.prog);
    const lc = L.loc, u = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
    const hd = (s.heading || 0) * Math.PI / 180;
    gl.uniform2f(lc.res, canvas.width, canvas.height);
    gl.uniform2f(lc.css, s.W, s.H);
    gl.uniform1f(lc.hp, s.hp); gl.uniform1f(lc.FL, s.FL); gl.uniform1f(lc.depth, s.depth);
    gl.uniform1f(lc.pitch, s.pitch || 0);
    gl.uniform1f(lc.sinh, Math.sin(hd)); gl.uniform1f(lc.cosh, Math.cos(hd));
    gl.uniform1f(lc.bank, s.bank || 0); gl.uniform2f(lc.shake, s.shX || 0, s.shY || 0);
    gl.uniform3fv(lc.top, u(s.top)); gl.uniform3fv(lc.hor, u(s.hor));
    gl.uniform3fv(lc.sunDir, s.sunDir || [0, 0, 1]);
    gl.uniform3fv(lc.sunCol, u(s.sunCol || [0, 0, 0]));
    gl.uniform1f(lc.sunOn, s.sunDir ? 1 : 0);
    gl.uniform1f(lc.nightA, s.nightA || 0); gl.uniform1f(lc.airglow, s.airglow || 0);
    gl.uniform1f(lc.time, ((s.now || 0) / 1000) % 3600); gl.uniform1f(lc.pxAng, 1 / Math.max(1, s.FL));
    gl.uniform3fv(lc.moonDir, s.moonDir || [0, 0, 1]); gl.uniform1f(lc.moonOn, s.moonDir ? (s.moonA ?? 1) : 0);
    gl.uniform2f(lc.moonPx, s.moonPx ? s.moonPx[0] : -1e4, s.moonPx ? s.moonPx[1] : -1e4); gl.uniform1f(lc.moonR, s.moonR || 10); gl.uniform1f(lc.moonCosPh, s.moonCosPh ?? 1);
    gl.uniform3fv(lc.moonSun, s.moonSun || [0, 0, -1]);
    // The face sprite, uploaded only when a different one is handed over — it is cached per size
    // on the windshield side, so this is one upload whenever the moon's pixel radius changes.
    const face = s.moonFace;
    gl.bindTexture(gl.TEXTURE_2D, L.tex);
    if (face && face !== L.texSrc) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, face);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      L.texSrc = face;
    }
    gl.uniform1i(lc.moonFace, 0);
    gl.uniform1f(lc.moonTex, face ? 1 : 0);
    gl.uniform1f(lc.moonUV, face ? s.moonFaceR / face.width : 0);
    gl.bindVertexArray(L.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } finally {
    gl.bindVertexArray(null);
    gl.useProgram(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.colorMask(true, true, true, true);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }
  return true;
}

const SKY_BIND = [[0, 'aPos']];
declareProgram(VERT, FRAG, SKY_BIND);
