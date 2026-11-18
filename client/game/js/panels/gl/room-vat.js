// The clone vats' fluid (docs/proposals/clone-facility-depths.md, phase 1). room-decor.js draws a vat's steel and
// glass and records it on the mesh as `vats`; this layer draws what's inside the tube.
//
// Each of the vats nearest you has a small fluid simulation of its own: a 20 x 48 x 20 grid of velocity, a warm plume
// off the aerator ring at its foot, the sleeper's breath, and a faint living haze shed off the sleeper's skin, kept as
// a flat 3-D atlas (48 slices laid 8 by 6) in half-float textures so a pass is one draw. A step advects, adds buoyancy
// and vorticity confinement, solves pressure by Jacobi and projects; the tube wall and the sleeper (eight capsules)
// are solid. A few hundred particles a vat ride the same velocity: bubbles that rise off the ring and, as it breathes
// out, the mask, and motes that drift. The fluid itself is ray-marched through the column: it absorbs by distance, so
// the core is deeper in colour than the edges, scatters the crown lamp's light (in shafts that move), and clouds
// where breath has been. What's behind is the room as drawn so far, copied before each vat and read along the bent
// ray, so the sleeper and the far wall shift as you move.
//
// ⚠ WITHOUT EXT_color_buffer_float, AND ON A PHONE, NOTHING IS SIMULATED. The same march runs on procedural noise
// (`uSim` 0) and there are no particles. The march has ONE call site (the D3D inline crash: a big function inlined
// several times killed the GPU process).
import { layerProgram } from './programs.js';

const NX = 20, NY = 48, NZ = 20, TX = 8, TY = NY / TX;
const AW = NX * TX, AH = NZ * TY;
const DT = 1 / 30, JACOBI = 14, WARM = 60;
const PW = 28, NP = PW * PW;          // particles a vat: a quarter motes, the rest bubbles (784: a good boil)
const BUBBLE_DEPTH = 3;                 // cells of fluid a vat needs before its bubbles and motes are drawn
const WN = 32;                         // the surface's height field, texels across

const GRID_GLSL = `
const ivec3 N = ivec3(${NX}, ${NY}, ${NZ});
const int TX = ${TX};
ivec2 texOf(ivec3 c) { return ivec2((c.y % TX) * N.x + c.x, (c.y / TX) * N.z + c.z); }
ivec3 cellOf(ivec2 f) { int tx = f.x / N.x, ty = f.y / N.z; return ivec3(f.x - tx * N.x, ty * TX + tx, f.y - ty * N.z); }
vec4 at(sampler2D s, ivec3 c) { return texelFetch(s, texOf(clamp(c, ivec3(0), N - 1)), 0); }
// trilinear at a point in cells (cell i's centre at i + 0.5): bilinear in a slice by the sampler, the two slices mixed
vec4 tri(sampler2D s, vec3 p) {
  p = clamp(p, vec3(0.5), vec3(N) - 0.5);
  float y = p.y - 0.5; int j = int(floor(y)); float f = y - float(j); int j1 = min(j + 1, N.y - 1);
  vec2 sz = vec2(float(N.x * TX), float(N.z * (N.y / TX)));
  vec2 a = (vec2(float((j % TX) * N.x), float((j / TX) * N.z)) + p.xz) / sz;
  vec2 b = (vec2(float((j1 % TX) * N.x), float((j1 / TX) * N.z)) + p.xz) / sz;
  return mix(texture(s, a), texture(s, b), f);
}
`;

const PASS_VS = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${GRID_GLSL}
out vec4 o;
uniform sampler2D uMask;
bool solid(ivec3 c) { return c.y < 0 || c.y >= N.y || at(uMask, c).x > 0.5; }
`;

// the walls: outside the tube or inside the sleeper (up to twelve capsules in cells: (a, r) then (b, 0))
const MASK_FS = `#version 300 es
precision highp float; precision highp int;
${GRID_GLSL}
out vec4 o;
uniform vec4 uCaps[24]; uniform int uCapN; uniform float uRc, uTop;
float capD(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h) - r; }
void main() {
  ivec3 c = cellOf(ivec2(gl_FragCoord.xy)); vec3 p = vec3(c) + 0.5; vec2 q = p.xz - vec2(N.xz) * 0.5;
  float s = dot(q, q) > uRc * uRc || p.y > uTop ? 1.0 : 0.0, near = 1e3;
  for (int i = 0; i < 12; i++) { if (i >= uCapN) break; float d = capD(p, uCaps[2 * i].xyz, uCaps[2 * i + 1].xyz, uCaps[2 * i].w); near = min(near, d); if (d < 0.0) s = 1.0; }
  o = vec4(s, near, 0.0, 0.0);
}`;

const CURL_FS = HEAD + `
uniform sampler2D uVel;
void main() {
  ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
  vec3 L = at(uVel, c - ivec3(1, 0, 0)).xyz, R = at(uVel, c + ivec3(1, 0, 0)).xyz, D = at(uVel, c - ivec3(0, 1, 0)).xyz;
  vec3 U = at(uVel, c + ivec3(0, 1, 0)).xyz, B = at(uVel, c - ivec3(0, 0, 1)).xyz, F = at(uVel, c + ivec3(0, 0, 1)).xyz;
  vec3 w = 0.5 * vec3((U.z - D.z) - (F.y - B.y), (F.x - B.x) - (R.z - L.z), (R.y - L.y) - (U.x - D.x));
  o = vec4(w, length(w));
}`;

const ADV_V_FS = HEAD + `
uniform sampler2D uVel, uScal, uCurl;
uniform float uDt, uBuoy, uEps;
uniform vec4 uKick; uniform vec3 uKickV;
void main() {
  ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
  if (solid(c)) { o = vec4(0.0); return; }
  vec3 p = vec3(c) + 0.5, v = at(uVel, c).xyz;
  vec3 nv = tri(uVel, p - uDt * v).xyz * 0.997;
  vec4 s = at(uScal, c);
  // warm water rises; a breath's cloud is a little heavier than the fluid round it
  nv.y += uDt * (uBuoy * s.g - 0.8 * s.r);
  // vorticity confinement: the small eddies the grid would smear out, put back
  float l = at(uCurl, c - ivec3(1, 0, 0)).w, r = at(uCurl, c + ivec3(1, 0, 0)).w, d = at(uCurl, c - ivec3(0, 1, 0)).w;
  float u = at(uCurl, c + ivec3(0, 1, 0)).w, b = at(uCurl, c - ivec3(0, 0, 1)).w, f = at(uCurl, c + ivec3(0, 0, 1)).w;
  vec3 g = vec3(r - l, u - d, f - b); float gn = length(g);
  if (gn > 1e-5) nv += uDt * uEps * cross(g / gn, at(uCurl, c).xyz);
  // a kick: a hand on the glass, the door, the drain
  vec3 kd = p - uKick.xyz; nv += uKickV * exp(-dot(kd, kd) / max(uKick.w * uKick.w, 1e-3));
  // the top is the surface: nothing goes up through it
  if (c.y == N.y - 1) nv.y = min(nv.y, 0.0);
  o = vec4(clamp(nv, vec3(-40.0), vec3(40.0)), 0.0);
}`;

const ADV_S_FS = HEAD + `
uniform sampler2D uVel, uScal;
uniform float uDt, uTime, uBreath, uRc, uSeedA;
uniform vec3 uMouth;
void main() {
  ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
  if (solid(c)) { o = vec4(0.0); return; }
  vec3 p = vec3(c) + 0.5, v = at(uVel, c).xyz;
  vec4 s = tri(uScal, p - uDt * v) * vec4(0.994, 0.985, 0.996, 1.0);
  // the aerator: a ring of warm water at the foot, each jet pulsing on its own beat
  vec2 q = p.xz - vec2(N.xz) * 0.5; float rr = length(q), ang = atan(q.y, q.x);
  float ring = exp(-pow(rr - uRc * 0.72, 2.0) / 1.5 - pow(p.y - 1.5, 2.0) / 2.0);
  float jets = pow(0.5 + 0.5 * cos((ang - uSeedA) * 6.0), 6.0);
  s.g += uDt * 5.0 * ring * jets * (0.7 + 0.3 * sin(uTime * 1.3 + ang * 3.0));
  // breathing out at the mask: a warm milky cloud
  vec3 dm = p - uMouth; float km = exp(-dot(dm, dm) / 2.0);
  s.r += uDt * 3.0 * uBreath * km; s.g += uDt * 1.6 * uBreath * km;
  // the living haze: a little shed off the skin all the time, more where the plume is pulling at it
  float near = at(uMask, c).y;
  if (near > 0.0 && near < 1.4) s.b += uDt * (0.12 + 0.2 * length(v) / 4.0) * (0.6 + 0.4 * sin(uTime * 0.41 + p.y * 0.6));
  o = clamp(s, 0.0, 3.0);
}`;

const DIV_FS = HEAD + `
uniform sampler2D uVel;
vec3 vAt(ivec3 c) { return solid(c) ? vec3(0.0) : at(uVel, c).xyz; }
void main() {
  ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
  if (solid(c)) { o = vec4(0.0); return; }
  float d = 0.5 * ((vAt(c + ivec3(1, 0, 0)).x - vAt(c - ivec3(1, 0, 0)).x) + (vAt(c + ivec3(0, 1, 0)).y - vAt(c - ivec3(0, 1, 0)).y) + (vAt(c + ivec3(0, 0, 1)).z - vAt(c - ivec3(0, 0, 1)).z));
  o = vec4(d, 0.0, 0.0, 0.0);
}`;

const JAC_FS = HEAD + `
uniform sampler2D uP, uDiv;
float pAt(ivec3 c, float pc) { return solid(c) ? pc : at(uP, c).x; }
void main() {
  ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
  if (solid(c)) { o = vec4(0.0); return; }
  float pc = at(uP, c).x;
  float s = pAt(c + ivec3(1, 0, 0), pc) + pAt(c - ivec3(1, 0, 0), pc) + pAt(c + ivec3(0, 1, 0), pc) + pAt(c - ivec3(0, 1, 0), pc) + pAt(c + ivec3(0, 0, 1), pc) + pAt(c - ivec3(0, 0, 1), pc);
  o = vec4((s - at(uDiv, c).x) / 6.0, 0.0, 0.0, 0.0);
}`;

const PROJ_FS = HEAD + `
uniform sampler2D uVel, uP;
float pAt(ivec3 c, float pc) { return solid(c) ? pc : at(uP, c).x; }
void main() {
  ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
  if (solid(c)) { o = vec4(0.0); return; }
  float pc = at(uP, c).x;
  vec3 g = 0.5 * vec3(pAt(c + ivec3(1, 0, 0), pc) - pAt(c - ivec3(1, 0, 0), pc), pAt(c + ivec3(0, 1, 0), pc) - pAt(c - ivec3(0, 1, 0), pc), pAt(c + ivec3(0, 0, 1), pc) - pAt(c - ivec3(0, 0, 1), pc));
  o = vec4(at(uVel, c).xyz - g, 0.0);
}`;

// the surface: a wave equation on a height field over the column's disc, in metres (r) with the last step's (g),
// pushed up by the plume, dimpled where the jets' bubbles burst, and by a drop or a push (uDrop)
const WAVE_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${GRID_GLSL}
out vec4 o;
uniform sampler2D uWave, uVel;
uniform float uTop, uTime, uSeed;
uniform vec4 uDrop;
const int W = ${WN};
bool off(ivec2 q) { vec2 d = (vec2(q) + 0.5) / float(W) * 2.0 - 1.0; return dot(d, d) > 1.0; }
float hAt(ivec2 q, float hc) { q = clamp(q, ivec2(0), ivec2(W - 1)); return off(q) ? hc : texelFetch(uWave, q, 0).r; }
float h1(float n) { return fract(sin(n * 12.9898 + uSeed * 78.233) * 43758.5453); }
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  if (off(q)) { o = vec4(0.0); return; }
  vec2 d = (vec2(q) + 0.5) / float(W) * 2.0 - 1.0, hp = texelFetch(uWave, q, 0).rg;
  float lap = hAt(q + ivec2(1, 0), hp.r) + hAt(q - ivec2(1, 0), hp.r) + hAt(q + ivec2(0, 1), hp.r) + hAt(q - ivec2(0, 1), hp.r) - 4.0 * hp.r;
  float h = (2.0 * hp.r - hp.g + 0.24 * lap) * 0.975 - hp.r * 0.01;
  // what the plume brings up under it
  vec3 cp = vec3((d.x * 0.5 + 0.5) * float(N.x), max(uTop - 1.5, 0.5), (d.y * 0.5 + 0.5) * float(N.z));
  h += 0.00004 * tri(uVel, cp).y;
  // the bubbles bursting over the six jets, now and then each
  for (int j = 0; j < 6; j++) {
    float ja = float(j) * 1.0472 + uSeed * 6.2832, k = floor(uTime * 9.0) + float(j) * 7.1;
    if (h1(k) < 0.55) continue;
    vec2 at = 0.72 * vec2(cos(ja), sin(ja)) + (vec2(h1(k + 1.3), h1(k + 2.9)) - 0.5) * 0.12;
    h -= 0.0012 * exp(-dot(d - at, d - at) / 0.004);
  }
  h += uDrop.w * exp(-dot(d - uDrop.xy, d - uDrop.xy) / max(uDrop.z, 1e-4));
  o = vec4(clamp(h, -0.03, 0.03), hp.r, 0.0, 0.0);
}`;

// the particles: xyz in cells, w its radius in metres (a bubble) or minus it (a mote)
const PART_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${GRID_GLSL}
out vec4 o;
uniform sampler2D uPart, uVel;
uniform float uDt, uTime, uBreath, uRc, uSeed, uTop, uPour;
uniform vec3 uMouth;
float h1(float n) { return fract(sin(n * 12.9898 + uSeed * 78.233) * 43758.5453); }
void main() {
  ivec2 f = ivec2(gl_FragCoord.xy); int id = f.y * ${PW} + f.x; float fid = float(id);
  vec4 q = texelFetch(uPart, f, 0); vec3 p = q.xyz; float sz = q.w;
  bool mote = id % 4 == 0;
  vec3 v = tri(uVel, p).xyz;
  float t = uTime + fid * 1.618;
  if (mote) p += uDt * (v * 0.9 + 0.35 * vec3(sin(t * 0.7), 0.15 * sin(t * 0.31), cos(t * 0.6)));
  else p += uDt * (v + vec3(0.6 * sin(t * 9.0), 4.0 + 900.0 * sz, 0.6 * cos(t * 7.0)));
  vec2 qx = p.xz - vec2(N.xz) * 0.5; float rr = length(qx);
  // a mote stays in the fluid; a bubble that reaches the top or the glass is born again
  if (mote) { if (rr > uRc - 0.7) p.xz = vec2(N.xz) * 0.5 + qx / rr * (uRc - 0.7); p.y = clamp(p.y, 0.6, max(0.6, uTop - 0.8)); }
  // while fluid pours in from the crown, bubbles are dragged down by the plunging stream: some are taken early and
  // born again under where it lands, deeper the harder it comes
  else if (p.y > uTop - 0.6 || rr > uRc - 0.4 || sz <= 0.0 || (uPour > 0.1 && h1(fid * 0.71 + floor(uTime * 24.0)) < 0.05 * uPour)) {
    float k = floor(uTime * 13.0) + fid * 0.37, a = h1(k) * 6.2832, b = h1(k + 3.1);
    if (uPour > 0.1 && h1(k + 11.3) < 0.75 * uPour && uTop > 3.0) {
      float rad = h1(k + 5.1) * (1.0 + 2.2 * uPour), dep = 0.6 + h1(k + 6.2) * min(uTop - 1.5, 12.0 * uPour);
      p = vec3(float(N.x) * 0.5 + cos(a) * rad, uTop - dep, float(N.z) * 0.5 + sin(a) * rad);
      sz = 0.001 + 0.006 * h1(k + 7.7) * h1(k + 8.8);
    }
    else if (uBreath > 0.25 && b < 0.45) { p = uMouth + vec3(cos(a), 0.3, sin(a)) * h1(k + 5.7) * 0.8; sz = 0.0012 + 0.0045 * h1(k + 7.3) * h1(k + 8.1); }
    else {
      // most from one of the six jets on the ring (a chain each), the rest anywhere round it
      float jet = floor(h1(k + 2.3) * 6.0), ja = jet * 1.0472 + uSeed * 6.2832, stray = step(0.8, h1(k + 9.1));
      float an = mix(ja + (h1(k + 1.1) - 0.5) * 0.12, a, stray), ra = uRc * (0.72 + 0.05 * (h1(k + 1.9) - 0.5));
      vec2 g = vec2(N.xz) * 0.5 + vec2(cos(an), sin(an)) * ra; p = vec3(g.x, 1.0 + h1(k + 3.7) * 0.5, g.y);
      sz = 0.0008 + 0.0035 * h1(k + 4.4) * h1(k + 6.6);
    }
  }
  o = vec4(p, sz);
}`;

const PART_VS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uPart;
uniform mat4 uVP; uniform vec3 uEye, uC, uCell; uniform float uR, uSig;
out vec2 vUv; out float vA; flat out float vMote;
const vec2 Q[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(1, 1), vec2(-1, -1), vec2(1, 1), vec2(-1, 1));
void main() {
  vec4 q = texelFetch(uPart, ivec2(gl_InstanceID % ${PW}, gl_InstanceID / ${PW}), 0);
  vec3 w = uC + vec3((q.x - ${NX / 2}.0) * uCell.x, q.y * uCell.y, (q.z - ${NZ / 2}.0) * uCell.z);
  vec3 toE = uEye - w; float dist = length(toE); vec3 fwd = toE / max(dist, 1e-4);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd)), up = cross(fwd, rt);
  float sz = max(abs(q.w) * 1.6, 0.0019 * dist);
  vUv = Q[gl_VertexID]; vMote = q.w < 0.0 ? 1.0 : 0.0;
  // how much of the fluid is between you and it: from where your line to it enters the column
  vec3 ro = uEye - uC, rd = -fwd; float a = dot(rd.xz, rd.xz), b = dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - uR * uR;
  float t0 = 0.0; if (c > 0.0 && a > 1e-8) { float d = b * b - a * c; t0 = d > 0.0 ? (-b - sqrt(d)) / a : dist; }
  vA = exp(-uSig * max(0.0, dist - max(t0, 0.0)));
  gl_Position = uVP * vec4(w + (rt * vUv.x + up * vUv.y) * sz, 1.0);
}`;

const PART_DRAW_FS = `#version 300 es
precision highp float;
in vec2 vUv; in float vA; flat in float vMote;
uniform vec3 uCol, uBio;
out vec4 o;
void main() {
  float r = length(vUv); if (r > 1.0) discard;
  if (vMote > 0.5) { float g = exp(-r * r * 3.0) * 0.9 * vA; o = vec4(uBio * g, g * 0.4); return; }
  // a bubble: a bright rim, clear in the middle, and a hot spot up and to one side
  float rim = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
  float spot = exp(-dot(vUv - vec2(-0.35, 0.4), vUv - vec2(-0.35, 0.4)) * 30.0);
  vec3 c = mix(uCol, vec3(1.0), 0.7) * (rim * 1.1 + spot * 1.8);
  float a = (rim * 0.7 + spot * 0.7) * vA;
  o = vec4(c * vA, a);
}`;

// THE SHAPE KIT the vats' moving parts are drawn with, made from the vertex id: an ellipsoid (the breathing mask, a
// joint, a body coming down a tube), a tube along a cubic (the mask's hose, an arm's bones, a gripper's fingers) and a
// glass arc (a release vat's glass, which revolves open). Each draw names its colour, its glow and its radius.
const GEAR_VS = `#version 300 es
precision highp float; precision highp int;
uniform mat4 uVP; uniform int uMode, uHalf;
uniform vec3 uMP, uMF, uMU, uMR, uRadii;      // an ellipsoid or an arc: where, its forward, up and right, its radii
uniform vec3 uH0, uH1, uH2, uH3;             // a tube: a cubic
uniform float uRad, uRib;
uniform vec2 uBulge;
uniform vec2 uArc;                           // an arc: from and to, radians round from the right axis
out vec3 vN; out vec3 vW; out float vRim; out float vArc;
vec3 bez(float t) { float u = 1.0 - t; return u * u * u * uH0 + 3.0 * u * u * t * uH1 + 3.0 * u * t * t * uH2 + t * t * t * uH3; }
void main() {
  int q = gl_VertexID / 6, k = gl_VertexID % 6;
  int ca = (k == 1 || k == 2 || k == 4) ? 1 : 0, cb = (k == 2 || k == 4 || k == 5) ? 1 : 0;
  vec3 p, n; vArc = 0.5;
  if (uMode == 0) {
    // twelve round and eight from the rim to the front: a cup (uHalf 1), or the whole ellipsoid (2)
    int i = q % 12 + ca, j = q / 12 + cb;
    float a = float(i) / 12.0 * 6.2832, b = uHalf == 1 ? float(j) / 8.0 * 1.5708 : (float(j) / 8.0 - 0.5) * 3.1416;
    vec3 e = vec3(cos(a) * cos(b), sin(a) * cos(b), sin(b));
    n = normalize(uMR * e.x / uRadii.x + uMU * e.y / uRadii.y + uMF * e.z / uRadii.z);
    p = uMP + uMR * e.x * uRadii.x + uMU * e.y * uRadii.y + uMF * e.z * uRadii.z;
    vRim = 1.0 - abs(sin(b));
  } else if (uMode == 1) {
    // twenty-eight along and eight round
    int i = q % 8 + ca, j = q / 8 + cb;
    float t = float(j) / 28.0, a = float(i) / 8.0 * 6.2832;
    vec3 c = bez(t), tg = normalize(bez(min(1.0, t + 0.01)) - bez(max(0.0, t - 0.01)));
    vec3 sd = normalize(abs(tg.y) > 0.95 ? cross(tg, vec3(1.0, 0.0, 0.0)) : cross(tg, vec3(0.0, 1.0, 0.0))), up = cross(sd, tg);
    float r = uRad * (1.0 + 0.12 * uRib * step(0.5, fract(t * 90.0)));
    // a bulge round its middle (a hose with something forced down it): uBulge.x how much, uBulge.y how long
    r *= 1.0 + uBulge.x * exp(-pow((t - 0.5) / max(uBulge.y, 1e-3), 2.0));
    n = cos(a) * sd + sin(a) * up; p = c + n * r; vRim = 0.0;
  } else if (uMode == 3) {
    // a sheet of cloth, sixteen across and twelve down: its top edge from uH0 to uH1 bowed out by uH2, hanging uRad
    // under it, swung by uH3 (where the gripper's been), rippling in folds that move with uRib (the time)
    int i = q % 16 + ca, j = q / 16 + cb;
    float u = float(i) / 16.0, v = float(j) / 12.0;
    vec3 e = uH1 - uH0, n0 = cross(e, vec3(0.0, 1.0, 0.0));
    n0 = length(n0) > 1e-4 ? normalize(n0) : vec3(1.0, 0.0, 0.0);
    vec3 top = mix(uH0, uH1, u) + uH2 * 4.0 * u * (1.0 - u) - vec3(0.0, 0.07 * sin(3.1416 * u), 0.0);
    // folds that travel down and across it, a flutter at the hem, and the hem lifting and snapping sideways
    vec3 eD = normalize(e + vec3(1e-5));
    p = top - vec3(0.0, uRad * v * (1.0 - 0.08 * v * sin(uRib * 5.3 + u * 4.0)), 0.0) + uH3 * v * v
      + n0 * (sin(u * 17.0 + uRib * 4.3 + v * 6.0) * 0.045 * (0.3 + v) + sin(u * 7.0 - uRib * 2.7 + v * 3.0) * 0.04 * v
              + sin(u * 31.0 + uRib * 11.0 - v * 9.0) * 0.012 * v * v + sin(u * 6.0 + 1.3) * 0.025)
      + eD * (0.05 * v * v * sin(uRib * 6.1 + v * 4.0 + u * 2.0));
    n = n0; vRim = v;
  } else {
    // a glass arc: thirty-two across, one tall, from the base (uMP) up uRadii.y
    int i = q + ca;
    float a = mix(uArc.x, uArc.y, float(i) / 32.0);
    n = cos(a) * uMR + sin(a) * uMF;
    p = uMP + n * uRadii.x + vec3(0.0, float(cb) * uRadii.y, 0.0); vRim = float(cb); vArc = float(i) / 32.0;
  }
  vN = n; vW = p;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const GEAR_FS = `#version 300 es
precision highp float; precision highp int;
in vec3 vN; in vec3 vW; in float vRim; in float vArc;
uniform vec3 uEye, uCol, uBase; uniform float uLamp, uEmit; uniform int uMode;
uniform sampler2D uScene; uniform vec2 uRes; uniform mat4 uVP;
out vec4 o;
void main() {
  vec3 n = normalize(vN), v = normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  if (uEmit > 0.0) { o = vec4(uBase * uEmit, 1.0); return; }
  vec3 L0 = normalize(vec3(0.2, 1.0, 0.3)), lc0 = mix(uCol, vec3(1.0), 0.5) * uLamp;
  vec3 L = vec3(0.0, 1.0, 0.0), lc = mix(uCol, vec3(1.0), 0.45) * uLamp;
  float sp = pow(max(dot(n, normalize(L + v)), 0.0), 36.0);
  if (uMode == 3) {
    // cloth: the folds' own facets, a soft wrap of the light, a sheen at the grazing edge, a fine weave
    vec3 fn = normalize(cross(dFdx(vW), dFdy(vW))); if (dot(fn, v) < 0.0) fn = -fn;
    float wrap = dot(fn, L0) * 0.5 + 0.5, sheen = pow(1.0 - abs(dot(fn, v)), 3.0);
    float weave = 0.93 + 0.07 * sin(vW.x * 520.0 + vW.y * 37.0) * sin(vW.z * 520.0 - vW.y * 41.0);
    o = vec4(uBase * weave * (lc0 * (0.35 + 1.4 * wrap) + 0.08) + lc0 * sheen * 0.35, 1.0);
    return;
  }
  if (uMode == 2) {
    // glass: a thick curved wall, so what's behind it bends: the room (copied just before) read through it shifted
    // along the wall's normal, harder toward the edges where you look through more of it, split a little by colour,
    // with the faint waviness of cast glass; bright at its edges and in a long highlight up its height
    float fr = 0.04 + 0.96 * pow(1.0 - abs(dot(n, v)), 4.0), gz = 1.0 - abs(dot(n, v));
    vec4 a0 = uVP * vec4(vW, 1.0), a1 = uVP * vec4(vW - n * 0.06, 1.0);
    vec2 off = (a1.xy / a1.w - a0.xy / a0.w) * 0.5 * (0.5 + 2.2 * gz);
    vec2 uv = gl_FragCoord.xy / uRes + off + vec2(sin(vW.y * 37.0 + vW.x * 11.0) * 0.0012, sin(vW.y * 23.0 - vW.z * 13.0) * 0.0008);
    vec3 bg = vec3(texture(uScene, uv + off * 0.06).r, texture(uScene, uv).g, texture(uScene, uv - off * 0.06).b);
    // a long highlight running up it from the lamps above, and a second fainter one
    vec3 hn = normalize(vec3(n.x, 0.0, n.z)), hv = normalize(vec3(v.x, 0.0, v.z));
    float streak = pow(max(dot(reflect(-hv, hn), normalize(vec3(0.4, 0.0, 0.9))), 0.0), 60.0) + 0.4 * pow(max(dot(reflect(-hv, hn), normalize(vec3(-0.8, 0.0, 0.5))), 0.0), 90.0);
    vec3 c = bg * vec3(0.86, 0.95, 0.92) * (1.0 - fr * 0.5) + lc * (sp * 1.0 + fr * 0.45 + streak * 0.5) + vec3(0.6, 0.75, 0.7) * fr * 0.12;
    // the door's seam: a steel edge at each end of an arc, so the opening reads when it's shut
    float seam = max(smoothstep(0.035, 0.0, vArc), smoothstep(0.965, 1.0, vArc));
    c = mix(c, vec3(0.22, 0.26, 0.28) * (0.5 + 0.8 * lc) + lc * 0.4 * pow(gz, 2.0), seam * 0.85);
    o = vec4(c, 1.0);
    return;
  }
  // painted or bare metal, lit from the crowns round it in the fluid's colour, with a wet sheen; a cup's rim paler
  float df = max(dot(n, L), 0.0) * 0.8 + 0.3;
  vec3 base = uBase * (1.0 + 0.35 * vRim * float(uMode == 0));
  o = vec4(base * lc * df * 2.2 + lc * sp * 0.6, 1.0);
}`;

// the fluid, ray-marched in the vat's own frame (its base centre the origin, y up)
const VOL_VS = `#version 300 es
precision highp float;
uniform mat4 uVP; uniform vec3 uC; uniform float uR, uH;
out vec3 vW; flat out vec3 vN;
const vec3 FN[6] = vec3[6](vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1));
const vec3 FU[6] = vec3[6](vec3(0, 1, 0), vec3(0, 0, 1), vec3(0, 0, 1), vec3(1, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0));
const vec3 FV[6] = vec3[6](vec3(0, 0, 1), vec3(0, 1, 0), vec3(1, 0, 0), vec3(0, 0, 1), vec3(0, 1, 0), vec3(1, 0, 0));
const vec2 K[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(1, 1), vec2(-1, -1), vec2(1, 1), vec2(-1, 1));
void main() {
  int f = gl_VertexID / 6; vec2 k = K[gl_VertexID % 6];
  vec3 u = FN[f] + FU[f] * k.x + FV[f] * k.y, half_ = vec3(uR, uH * 0.5, uR) * 1.02 + 0.01;
  vW = uC + vec3(0.0, uH * 0.5, 0.0) + u * half_; vN = FN[f];
  gl_Position = uVP * vec4(vW, 1.0);
}`;

const VOL_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${GRID_GLSL}
in vec3 vW; flat in vec3 vN;
uniform mat4 uVP; uniform vec3 uEye, uC, uCell, uCol, uBio, uAmb;
uniform float uR, uH, uTime, uSim, uLamp, uInside, uSteps, uSeed;
uniform sampler2D uVol, uScene, uWave;
uniform float uWaveOn;
uniform vec2 uRes;
uniform vec4 uCaps[24]; uniform int uCapN;
out vec4 o;
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// the ray against the column x² + z² < r², 0 < y < h: where it's in, where it's out (in > out for a miss)
vec2 column(vec3 ro, vec3 rd) {
  float a = dot(rd.xz, rd.xz), b = dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - uR * uR, t0 = -1e9, t1 = 1e9;
  if (a > 1e-8) { float d = b * b - a * c; if (d < 0.0) return vec2(1.0, -1.0); d = sqrt(d); t0 = (-b - d) / a; t1 = (-b + d) / a; }
  else if (c > 0.0) return vec2(1.0, -1.0);
  if (abs(rd.y) > 1e-6) { float y0 = -ro.y / rd.y, y1 = (uH - ro.y) / rd.y; t0 = max(t0, min(y0, y1)); t1 = min(t1, max(y0, y1)); }
  else if (ro.y < 0.0 || ro.y > uH) return vec2(1.0, -1.0);
  return vec2(t0, t1);
}
// the ray against one of the sleeper's capsules (a sphere when it has no length)
float capsule(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float ra) {
  vec3 ba = pb - pa, oa = ro - pa;
  float baba = dot(ba, ba);
  if (baba < 1e-6) { float b = dot(oa, rd), c = dot(oa, oa) - ra * ra, h = b * b - c; return h < 0.0 ? -1.0 : -b - sqrt(h); }
  float bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - ra * ra * baba, h = b * b - a * c;
  if (h >= 0.0 && abs(a) > 1e-9) {
    float t = (-b - sqrt(h)) / a, y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
    vec3 oc = y <= 0.0 ? oa : ro - pb; b = dot(rd, oc); c = dot(oc, oc) - ra * ra; h = b * b - c;
    if (h > 0.0) return -b - sqrt(h);
  }
  return -1.0;
}
// how near the ray passes one of the sleeper's capsules: the gap past its axis and how far along the ray that is
vec2 nearCap(vec3 ro, vec3 rd, vec3 pa, vec3 pb) {
  vec3 ba = pb - pa, oa = ro - pa;
  float e = dot(ba, ba), d1 = dot(rd, ba), f = dot(rd, oa), g = dot(ba, oa), den = e - d1 * d1;
  float s = den > 1e-8 ? clamp((g - f * d1) / den, 0.0, 1.0) : 0.0, t = max(s * d1 - f, 0.0);
  s = e > 1e-8 ? clamp((g + t * d1) / e, 0.0, 1.0) : 0.0;
  return vec2(length(oa + rd * t - ba * s), t);
}
// what's in the fluid at a point in the vat's frame: r cloud (breath), g warmth, b the living haze
vec4 fluidAt(vec3 l) {
  if (uSim > 0.5) return tri(uVol, vec3(l.x / uCell.x + float(N.x) * 0.5, l.y / uCell.y, l.z / uCell.z + float(N.z) * 0.5));
  float n = vnoise(l * 7.0 - vec3(0.0, uTime * 0.3, 0.0) + uSeed), m = vnoise(l * 13.0 + vec3(uTime * 0.05, -uTime * 0.12, 0.0));
  return vec4(0.35 * smoothstep(0.6, 0.95, n), 0.0, 0.25 * smoothstep(0.72, 0.98, m), 0.0);
}
// the surface's normal over a point of the column: off the simulated height field, or a slow ripple without one
vec3 surfN(vec2 xz) {
  if (uWaveOn < 0.5) return normalize(vec3(0.06 * sin(xz.x * 40.0 + uTime * 1.7), 1.0, 0.06 * cos(xz.y * 37.0 - uTime * 1.3)));
  vec2 uv = xz / uR * 0.5 + 0.5, e = vec2(1.0 / ${WN}.0, 0.0);
  float m = 2.0 * uR / ${WN}.0;
  float gx = (texture(uWave, uv + e.xy).r - texture(uWave, uv - e.xy).r) / (2.0 * m), gz = (texture(uWave, uv + e.yx).r - texture(uWave, uv - e.yx).r) / (2.0 * m);
  return normalize(vec3(-gx, 1.0, -gz));
}
// the crown lamp's light at a point: falling off down the column and out from the axis, broken into moving shafts
float lampAt(vec3 l) {
  float rr = length(l.xz) / uR;
  float sh = sin(l.x * 23.0 + uTime * 0.7 + 2.0 * sin(l.z * 17.0 - uTime * 0.4)) * sin(l.z * 19.0 - uTime * 0.5 + 2.0 * sin(l.x * 13.0 + uTime * 0.3));
  return uLamp * exp(-0.55 * (uH - l.y)) * (1.0 - 0.55 * rr * rr) * (0.45 + 1.1 * sh * sh);
}
void main() {
  vec3 ro = uEye - uC, rd = normalize(vW - uEye);
  // the edge of the tube softened over a pixel: how close the ray comes to the axis, against the radius (the
  // derivative taken before anything is discarded)
  float b = dot(ro.xz, rd.xz) / max(dot(rd.xz, rd.xz), 1e-8), miss = length(ro.xz - rd.xz * b) - uR;
  float edge = clamp(-miss / max(fwidth(miss), 1e-5), 0.0, 1.0);
  // the box's faces toward you, or (from inside it) the ones away
  if ((dot(vN, uEye - vW) > 0.0) == (uInside > 0.5)) discard;
  vec2 io = column(ro, rd);
  if (io.x >= io.y || io.y <= 0.0 || edge <= 0.0) discard;
  float t0 = max(io.x, 0.0);
  vec3 pE = ro + rd * t0;
  // bent going in: at the side by the glass's curve, at the top by the surface's ripple
  vec3 n = vec3(0.0, 1.0, 0.0);
  bool top = io.x > 0.0 && abs(pE.y - uH) < 1e-3 * (1.0 + t0);
  if (top) n = surfN(pE.xz);
  else n = normalize(vec3(pE.x, 0.0, pE.z));
  vec3 rr = uInside > 0.5 && io.x <= 0.0 ? rd : refract(rd, n, 1.0 / 1.33);
  if (dot(rr, rr) < 0.5) rr = rd;
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);
  // out the far side, or into the sleeper
  vec2 io2 = column(pE - rr * 1e-4, rr);
  float tE = max(io2.y, 0.0), tc = tE, wB = 0.0;
  // the capsules only say roughly where the sleeper is: how much of this pixel is the figure fades over a margin round
  // them, so the drawn figure (its hands, its head) shows in its own outline, not the capsules' hard one
  for (int i = 0; i < 12; i++) {
    if (i >= uCapN) break;
    float ra = uCaps[2 * i].w;
    vec2 k = nearCap(pE, rr, uCaps[2 * i].xyz, uCaps[2 * i + 1].xyz);
    float w = 1.0 - smoothstep(ra * 0.9, ra * 1.9 + 0.04, k.x);
    if (w > wB) { wB = w; tc = min(k.y, tE); }
  }
  bool body = wB > 0.5;
  float tEnd = mix(tE, tc, wB);
  // the march
  int steps = int(uSteps); float ds = tEnd / uSteps, j = h31(vec3(gl_FragCoord.xy, uTime * 60.0));
  vec3 sigA = (1.0 - uCol) * 3.2 + 0.35, T = vec3(1.0), acc = vec3(0.0);
  for (int i = 0; i < 48; i++) {
    if (i >= steps) break;
    vec3 l = pE + rr * ((float(i) + j) * ds);
    vec4 f = fluidAt(l);
    float cloud = f.r, bio = f.b;
    vec3 sig = sigA * (1.0 + 1.5 * cloud) + vec3(2.0 * cloud);
    float L = lampAt(l);
    vec3 S = (uCol * 1.1 + vec3(1.4) * cloud) * L + uBio * bio * 4.0 + uAmb * uCol * 0.5;
    acc += T * S * ds;
    T *= exp(-sig * ds);
  }
  // what's behind: the sleeper where the ray met it, else the room past the far side, bent again going out
  vec3 bgP = pE + rr * tEnd;
  vec3 bg;
  if (!body && abs(bgP.y - uH) < 2e-3 && rr.y > 0.0) {
    // up into the underside of the surface: past the critical angle it's a mirror, lit by the crown, and where the
    // surface is moving the crown's light breaks up across it
    float sl = length(surfN(bgP.xz).xz);
    bg = mix(uCol, vec3(1.0), 0.5) * uLamp * (0.45 + min(2.5, 14.0 * sl));
  } else {
    // the room past the far side, through the far wall of the column as a lens, a little apart by colour (the glass's
    // dispersion), and wavering with the fluid's own movement; the sleeper wavers too
    vec3 shim = vec3(sin(bgP.y * 23.0 + uTime * 2.3), 0.0, cos(bgP.y * 19.0 - uTime * 1.7)) * mix(0.014, 0.006, wB);
    vec3 n2 = -normalize(vec3(bgP.x, 0.0, bgP.z));
    vec2 uvs[3];
    for (int c = 0; c < 3; c++) {
      vec3 q = bgP + shim;
      float eta = 1.31 + 0.02 * float(c); vec3 r2 = refract(rr, n2, eta); if (dot(r2, r2) < 0.5) r2 = reflect(rr, n2); q += r2 * 1.3 * (1.0 - wB);
      vec4 cl = uVP * vec4(q + uC, 1.0);
      uvs[c] = cl.w > 0.0 ? clamp(cl.xy / cl.w * 0.5 + 0.5, vec2(0.001), vec2(0.999)) : gl_FragCoord.xy / uRes;
    }
    bg = vec3(texture(uScene, uvs[0]).r, texture(uScene, uvs[1]).g, texture(uScene, uvs[2]).b);
    // the sleeper lit by its own vat: the crown's light from above, in the fluid's colour, over the room's
    { float lk = lampAt(bgP) * wB; bg = bg * (1.0 - 0.25 * wB + 0.9 * lk) + mix(uCol, vec3(1.0), 0.35) * lk * 0.18; }
  }
  vec3 col = acc + T * bg;
  // the surface catching the crown from outside, and the meniscus where it climbs the glass
  col += fres * mix(uCol, vec3(1.0), 0.6) * uLamp * 0.35;
  o = vec4(col, edge);
}`;

const hexRgb = (hex, d) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return d; const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export function createVatLayer(gl, { phone = false } = {}) {
  const sim = !phone && !!gl.getExtension('EXT_color_buffer_float');
  const SLOTS = sim ? 6 : 0;
  const P = (vs, fs, label) => { const p = layerProgram(gl, vs, fs, label), u = {}; return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) }; };
  const VOL = P(VOL_VS, VOL_FS, 'vat fluid'), GEAR = P(GEAR_VS, GEAR_FS, 'vat mask and hose');
  const S = sim ? {
    mask: P(PASS_VS, MASK_FS, 'vat mask'), curl: P(PASS_VS, CURL_FS, 'vat curl'), advV: P(PASS_VS, ADV_V_FS, 'vat advect'),
    advS: P(PASS_VS, ADV_S_FS, 'vat scalars'), div: P(PASS_VS, DIV_FS, 'vat divergence'), jac: P(PASS_VS, JAC_FS, 'vat pressure'),
    proj: P(PASS_VS, PROJ_FS, 'vat project'), part: P(PASS_VS, PART_FS, 'vat particles'), draw: P(PART_VS, PART_DRAW_FS, 'vat bubbles'),
    wave: P(PASS_VS, WAVE_FS, 'vat surface'),
  } : null;
  const empty = gl.createVertexArray();

  // a render target: a texture and its framebuffer
  const target = (w, h, fmt, type, linear, data = null) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, gl.RGBA, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, fb, w, h };
  };
  const grid = () => target(AW, AH, gl.RGBA16F, gl.HALF_FLOAT, true);
  const free = (T) => { if (T) { gl.deleteTexture(T.t); gl.deleteFramebuffer(T.fb); } };

  // the slots: a simulation each, handed to the nearest vats
  const slots = [];
  function makeSlot() {
    const s = { vel: [grid(), grid()], scal: [grid(), grid()], p: [grid(), grid()], div: grid(), curl: grid(), mask: grid(), part: null, owner: null, acc: 0 };
    s.part = [target(PW, PW, gl.RGBA32F, gl.FLOAT, false), target(PW, PW, gl.RGBA32F, gl.FLOAT, false)];
    s.wave = [target(WN, WN, gl.RGBA16F, gl.HALF_FLOAT, true), target(WN, WN, gl.RGBA16F, gl.HALF_FLOAT, true)];
    return s;
  }
  function clearSlot(s) {
    for (const T of [...s.vel, ...s.scal, ...s.p, s.div, s.curl, ...s.wave]) { gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  }

  let vats = [], prevNow = 0;
  // a vat's numbers in its own frame: the cell size, the sleeper's capsules (metres and cells), the mouth
  function prep(rec, i) {
    const c = rec.c, R = rec.r, H = rec.h, cell = [2 * R / NX, H / NY, 2 * R / NZ];
    const seed = ((rec.seed || 7) * 0.618 + i * 0.37) % 1;
    const v = { rec, c, R, H, cell, capsW: new Float32Array(96), capsC: new Float32Array(96), capN: 0, mouth: null, col: hexRgb(rec.fluid, [0.27, 0.88, 0.66]), seed, slot: null, period: 5 + seed * 2.5, maskDirty: false,
      level: Math.max(0, Math.min(1, rec.level ?? 1)), gear: null, drop: null };
    bodyOf(v, rec.caps || [], rec.mouth);
    return v;
  }
  // the sleeper as capsules [ax, ay, az, bx, by, bz, r] and its mouth, in the world: kept in the vat's frame for the
  // march and in cells for the grid, whose walls are drawn again on its next step
  function bodyOf(v, caps, mouth) {
    const local = (p) => [p[0] - v.c[0], p[1] - v.c[1], p[2] - v.c[2]];
    const toCell = (l) => [l[0] / v.cell[0] + NX / 2, l[1] / v.cell[1], l[2] / v.cell[2] + NZ / 2];
    const list = caps.slice(0, 12);
    list.forEach((k, j) => {
      const a = local(k.slice(0, 3)), b = local(k.slice(3, 6)), ac = toCell(a), bc = toCell(b);
      v.capsW.set([...a, k[6], ...b, 0], j * 8);
      v.capsC.set([...ac, k[6] / v.cell[0], ...bc, 0], j * 8);
    });
    v.capN = list.length;
    v.mouth = mouth ? toCell(local(mouth)) : [NX / 2, NY * 0.8, NZ / 2];
    v.maskDirty = true;
  }
  // ⚠ A ROOM IS SET AGAIN EVERY TIME ITS MESH IS REBUILT (room.js setRoom), usually with the same vats. A vat that was
  // here before keeps its slot and the fluid in it, matched by id or by where it stands. Dropping them all put every
  // vat back on the procedural look and claimed them back one a frame, which was the flicker.
  const keyOf = (r) => (r.id != null ? 'id:' + r.id : 'at:' + r.c.map((x) => Math.round(x * 100)).join(','));
  let fresh = false;
  // frames drawn since the room's vats were set: the loading veil holds until they've settled (settled(), below), so
  // the first warm-ups and the fluid's shader links happen under it and not as black and white flashes in view
  let drawn = 0;
  function setVats(list) {
    const was = new Map(vats.filter((v) => v.slot).map((v) => [keyOf(v.rec), v]));
    for (const s of slots) s.owner = null;
    vats = (list || []).filter((r) => r && r.c && r.r > 0 && r.h > 0).map(prep);
    let kept = 0;
    for (const v of vats) {
      const old = was.get(keyOf(v.rec));
      if (!old || old.R !== v.R || old.H !== v.H || old.slot.owner) continue;
      v.slot = old.slot; v.slot.owner = v; v.level = old.level; kept++;
    }
    // a room with none of its vats running yet warms them all before its first frame, not one a frame
    fresh = !kept;
    if (fresh) drawn = 0;
  }
  const byId = (id) => vats.find((x) => x.rec.id != null && x.rec.id === id);
  // the close-up figures in the vats, this frame: [{ id (the vat's piece), caps, mouth, mask: { p, f, u, r } }]
  function setBodies(list) {
    for (const v of vats) v.gear = null;
    for (const b of list || []) { const v = byId(b.id); if (!v) continue; if (b.caps?.length) bodyOf(v, b.caps, b.mouth); v.gear = b.mask || null; }
  }
  // how full a vat is, 0 to 1 (the wake's drain, a script's): the grid's lid comes down with it, and a fall stirs it,
  // the water pulled down toward the drain and the surface dropping
  function setLevel(id, k) {
    const v = byId(id);
    if (!v) return;
    k = Math.max(0, Math.min(1, k));
    if (k < v.level - 1e-3) {
      v.kick = { at: [NX / 2, 1, NZ / 2], v: [0, -Math.min(30, (v.level - k) * 600), 0], r: 4 };
      v.drop = [0, 0, 0.5, -0.004];
    } else if (k > v.level + 0.05) {
      // a gush: it comes down hard from the crown, churning, and slops the surface
      v.kick = { at: [NX / 2, k * NY - 2, NZ / 2], v: [0, -40, 0], r: 5 };
      v.drop = [0.2, -0.1, 0.3, 0.012];
    }
    if (Math.abs(k - v.level) > 1e-4) { v.level = k; v.maskDirty = true; }
  }
  // the vats' light on the room (room.js uVat*): the nearest six that hold any fluid, each a column of its colour
  const lightP = new Float32Array(24), lightC = new Float32Array(24);
  // `gain` is the room's: a dimmed hall (spec.dim) is lit harder by its vats
  function lights(eye, gain = 1) {
    const near = vats.filter((v) => v.H * v.level > 0.3).sort((a, b) => dist2(a.c, eye) - dist2(b.c, eye)).slice(0, 6);
    near.forEach((v, i) => { lightP.set([v.c[0], v.c[1], v.c[2], v.R], i * 4); lightC.set([v.col[0] * gain, v.col[1] * gain, v.col[2] * gain, v.H * v.level], i * 4); });
    return { n: near.length, P: lightP, C: lightC };
  }

  const pass = (Pr, T) => { gl.useProgram(Pr.p); gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.viewport(0, 0, T.w, T.h); };
  const bindTex = (Pr, name, unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(Pr.u(name), unit); };
  const tri3 = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
  const breathOf = (v, t) => { const ph = (t / v.period + v.seed) % 1; return ph < 0.2 ? Math.sin((ph / 0.2) * Math.PI) : 0; };

  function seedParticles(v, s) {
    const d = new Float32Array(NP * 4);
    let x = Math.floor(v.seed * 1e6) + 1;
    const r = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    for (let i = 0; i < NP; i++) {
      const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * (NX / 2 - 1), mote = i % 4 === 0;
      d.set([NX / 2 + Math.cos(a) * rad, 1 + r() * (NY - 2), NZ / 2 + Math.sin(a) * rad, mote ? -(0.0008 + 0.0018 * r()) : 0.0008 + 0.003 * r() * r()], i * 4);
    }
    for (const T of s.part) { gl.bindTexture(gl.TEXTURE_2D, T.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PW, gl.RGBA, gl.FLOAT, d); }
  }

  function stepSlot(v, s, t) {
    const br = breathOf(v, t);
    // the curl of what's moving now, then the velocity advected and pushed
    pass(S.curl, s.curl); bindTex(S.curl, 'uMask', 1, s.mask.t); bindTex(S.curl, 'uVel', 0, s.vel[0].t); tri3();
    pass(S.advV, s.vel[1]);
    bindTex(S.advV, 'uMask', 3, s.mask.t); bindTex(S.advV, 'uVel', 0, s.vel[0].t); bindTex(S.advV, 'uScal', 1, s.scal[0].t); bindTex(S.advV, 'uCurl', 2, s.curl.t);
    gl.uniform1f(S.advV.u('uDt'), DT); gl.uniform1f(S.advV.u('uBuoy'), 9); gl.uniform1f(S.advV.u('uEps'), 0.9);
    const k = v.kick; gl.uniform4f(S.advV.u('uKick'), k ? k.at[0] : 0, k ? k.at[1] : 0, k ? k.at[2] : 0, k ? k.r : 1); gl.uniform3f(S.advV.u('uKickV'), k ? k.v[0] : 0, k ? k.v[1] : 0, k ? k.v[2] : 0);
    v.kick = null;
    tri3(); s.vel.reverse();
    // what it carries
    pass(S.advS, s.scal[1]);
    bindTex(S.advS, 'uMask', 2, s.mask.t); bindTex(S.advS, 'uVel', 0, s.vel[0].t); bindTex(S.advS, 'uScal', 1, s.scal[0].t);
    gl.uniform1f(S.advS.u('uDt'), DT); gl.uniform1f(S.advS.u('uTime'), t); gl.uniform1f(S.advS.u('uBreath'), br); gl.uniform1f(S.advS.u('uRc'), NX / 2); gl.uniform3fv(S.advS.u('uMouth'), v.mouth); gl.uniform1f(S.advS.u('uSeedA'), v.seed * 6.2832);
    tri3(); s.scal.reverse();
    // made incompressible
    pass(S.div, s.div); bindTex(S.div, 'uMask', 1, s.mask.t); bindTex(S.div, 'uVel', 0, s.vel[0].t); tri3();
    for (let i = 0; i < JACOBI; i++) {
      pass(S.jac, s.p[1]); bindTex(S.jac, 'uMask', 2, s.mask.t); bindTex(S.jac, 'uP', 0, s.p[0].t); bindTex(S.jac, 'uDiv', 1, s.div.t); tri3(); s.p.reverse();
    }
    pass(S.proj, s.vel[1]); bindTex(S.proj, 'uMask', 2, s.mask.t); bindTex(S.proj, 'uVel', 0, s.vel[0].t); bindTex(S.proj, 'uP', 1, s.p[0].t); tri3(); s.vel.reverse();
    // the bubbles and motes, carried
    pass(S.part, s.part[1]); bindTex(S.part, 'uPart', 0, s.part[0].t); bindTex(S.part, 'uVel', 1, s.vel[0].t);
    gl.uniform1f(S.part.u('uDt'), DT); gl.uniform1f(S.part.u('uTime'), t); gl.uniform1f(S.part.u('uBreath'), br); gl.uniform1f(S.part.u('uRc'), NX / 2);
    gl.uniform1f(S.part.u('uSeed'), v.seed); gl.uniform3fv(S.part.u('uMouth'), v.mouth); gl.uniform1f(S.part.u('uTop'), v.level * NY);
    // a body plunging in drags far more bubbles down than the pour does, and for longer (sqrt holds the tail up)
    gl.uniform1f(S.part.u('uPour'), Math.max(scene?.pour?.[v.rec.id] || 0, 2.5 * Math.sqrt(scene?.splash?.[v.rec.id]?.k || 0)));
    tri3(); s.part.reverse();
    // the surface, moved on
    pass(S.wave, s.wave[1]); bindTex(S.wave, 'uWave', 0, s.wave[0].t); bindTex(S.wave, 'uVel', 1, s.vel[0].t);
    gl.uniform1f(S.wave.u('uTop'), v.level * NY); gl.uniform1f(S.wave.u('uTime'), t); gl.uniform1f(S.wave.u('uSeed'), v.seed);
    const d = v.drop || [0, 0, 1, 0]; gl.uniform4f(S.wave.u('uDrop'), d[0], d[1], d[2], d[3]); v.drop = null;
    tri3(); s.wave.reverse();
  }

  function drawMask(v, s) {
    pass(S.mask, s.mask);
    gl.uniform4fv(S.mask.u('uCaps'), v.capsC); gl.uniform1i(S.mask.u('uCapN'), v.capN); gl.uniform1f(S.mask.u('uRc'), NX / 2); gl.uniform1f(S.mask.u('uTop'), v.level * NY);
    tri3();
    v.maskDirty = false;
  }
  function claim(v, s, t) {
    s.owner = v; v.slot = s; s.acc = 0;
    clearSlot(s);
    drawMask(v, s);
    seedParticles(v, s);
    // run it on a while, so the plume is up and the haze out before anyone sees it
    for (let i = 0; i < WARM; i++) stepSlot(v, s, t - (WARM - i) * DT);
  }

  // once a frame, before the room is drawn: hand the slots to the nearest vats and run them on
  function step(now, eye) {
    if (!sim || !vats.length) return;
    const t = now / 1000, dt = prevNow ? Math.min(0.1, t - prevNow) : DT;
    prevNow = t;
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), vpv = gl.getParameter(gl.VIEWPORT);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.bindVertexArray(empty);
    const near = vats.filter((v) => v.H > 0.3).sort((a, b) => dist2(a.c, eye) - dist2(b.c, eye)).slice(0, SLOTS);
    for (const v of vats) if (v.slot && !near.includes(v)) { v.slot.owner = null; v.slot = null; }
    let warmed = 0;
    for (const v of near) {
      if (v.slot) continue;
      // one warm-up a frame once the room is up, so walking toward a vat doesn't stall. A fresh room warms them all at
      // once (its upload is a hitch anyway), so no vat is seen on the procedural look and then swapped
      if (!fresh && warmed++) continue;
      let s = slots.find((x) => !x.owner);
      if (!s) { if (slots.length >= SLOTS) continue; s = makeSlot(); slots.push(s); }
      claim(v, s, t);
    }
    fresh = false;
    for (const v of near) {
      const s = v.slot;
      if (!s) continue;
      s.acc = Math.min(s.acc + dt, DT * 2);
      if (v.maskDirty) drawMask(v, s);
      // the vat cycle's churn (a slug landing, the trigger, the body dropping in): shoved down from the hole and off to
      // one side that swings round, and the surface slopped
      const ch = scene?.churn?.[v.rec.id];
      if (ch) {
        const a = t * 4.1 + v.seed * 6.28;
        v.kick = { at: [NX / 2 + Math.cos(a) * 2, Math.max(2, v.level * NY - 2), NZ / 2 + Math.sin(a) * 2], v: [Math.cos(a + 1.6) * 25 * ch, -45 * ch, Math.sin(a + 1.6) * 25 * ch], r: 5 };
        v.drop = [0.35 * Math.cos(a), 0.35 * Math.sin(a), 0.35, 0.02 * ch];
      }
      while (s.acc >= DT) { stepSlot(v, s, t); s.acc -= DT; }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.viewport(vpv[0], vpv[1], vpv[2], vpv[3]);
    gl.activeTexture(gl.TEXTURE0);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
  }

  // the room as drawn so far, copied a piece at a time for the fluid to read through
  let copy = null;
  function copyRect(w, h, x0, y0, x1, y1) {
    // a new copy (the first frame, or the window resized) takes the whole picture once: it starts black, and a ray the
    // fluid bends out past this vat's box read that black for a frame
    const anew = !copy || copy.w !== w || copy.h !== h;
    if (anew) { free(copy); copy = target(w, h, gl.RGBA8, gl.UNSIGNED_BYTE, true); x0 = 0; y0 = 0; x1 = w; y1 = h; }
    const from = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copy.fb);
    gl.blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, from);
  }
  // a vat's box on the screen, in pixels; the whole picture when any of it is behind you
  function rectOf(v, vp, w, h) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const x = v.c[0] + (i & 1 ? 1 : -1) * v.R * 1.05, y = v.c[1] + (i & 2 ? v.H + 0.02 : -0.02), z = v.c[2] + (i & 4 ? 1 : -1) * v.R * 1.05;
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (cw <= 0.01) return [0, 0, w, h];
      const cx = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw, cy = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
    }
    const px = (u, s) => Math.max(0, Math.min(s, Math.round((u * 0.5 + 0.5) * s)));
    return [px(x0, w) - 2, px(y0, h) - 2, px(x1, w) + 2, px(y1, h) + 2].map((n, i) => Math.max(0, Math.min(i % 2 ? h : w, n)));
  }

  // in the scene, after everything opaque and before the room's glass: each vat's fluid, furthest first, then its bubbles
  function draw(vp, eye, w, h, { now = performance.now(), amb = [0.1, 0.1, 0.1] } = {}) {
    if (!vats.length) return;
    drawn++;
    const t = now / 1000;
    const order = vats.filter((v) => v.H * v.level > 0.01).map((v) => ({ v, d: dist2(v.c, eye), in: inBox(v, eye) })).filter((o) => o.in || onScreen(o.v, vp)).sort((a, b) => b.d - a.d);
    if (!order.length) { gl.bindVertexArray(empty); gl.disable(gl.CULL_FACE); drawScene(vp, eye); drawGlass(vp, eye, w, h); gl.enable(gl.DEPTH_TEST); return; }
    gl.bindVertexArray(empty);
    gl.disable(gl.CULL_FACE);
    // the cycle's moving parts first, solid, then the masks and hoses, so each vat's copy of the room has them in it
    drawScene(vp, eye);
    const geared = order.filter((o) => o.v.gear);
    if (geared.length) {
      gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
      gl.useProgram(GEAR.p);
      gl.uniformMatrix4fv(GEAR.u('uVP'), false, vp); gl.uniform3fv(GEAR.u('uEye'), eye); gl.uniform1f(GEAR.u('uLamp'), 1.0);
      for (const { v } of geared) drawGear(v);
    }
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
    for (const { v, in: inside } of order) {
      const r = rectOf(v, vp, w, h);
      if (r[2] <= r[0] || r[3] <= r[1]) continue;
      copyRect(w, h, ...r);
      gl.useProgram(VOL.p);
      if (inside) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(VOL.u('uVP'), false, vp);
      gl.uniform3fv(VOL.u('uEye'), eye); gl.uniform3fv(VOL.u('uC'), v.c); gl.uniform3fv(VOL.u('uCell'), v.cell);
      gl.uniform1f(VOL.u('uR'), v.R); gl.uniform1f(VOL.u('uH'), Math.max(0.002, v.H * v.level));
      gl.uniform3fv(VOL.u('uCol'), v.col); gl.uniform3fv(VOL.u('uBio'), bioOf(v.col)); gl.uniform3fv(VOL.u('uAmb'), amb);
      gl.uniform1f(VOL.u('uTime'), t); gl.uniform1f(VOL.u('uSim'), v.slot ? 1 : 0); gl.uniform1f(VOL.u('uLamp'), 1.0);
      gl.uniform1f(VOL.u('uInside'), inside ? 1 : 0); gl.uniform1f(VOL.u('uSteps'), phone ? 14 : v.slot ? 36 : 24); gl.uniform1f(VOL.u('uSeed'), v.seed * 10);
      gl.uniform2f(VOL.u('uRes'), w, h);
      gl.uniform4fv(VOL.u('uCaps'), v.capsW); gl.uniform1i(VOL.u('uCapN'), v.capN);
      bindTex(VOL, 'uScene', 5, copy.t);
      bindTex(VOL, 'uVol', 6, v.slot ? v.slot.scal[0].t : copy.t);
      bindTex(VOL, 'uWave', 8, v.slot ? v.slot.wave[0].t : copy.t); gl.uniform1f(VOL.u('uWaveOn'), v.slot ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
      // no bubbles or motes until there is fluid enough to hold them: under a few cells deep a bubble is born above
      // the surface and a mote has nowhere to be, and they flashed white and black in the empty glass as it filled
      if (v.slot && v.level * NY >= BUBBLE_DEPTH) {
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(S.draw.p);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.uniformMatrix4fv(S.draw.u('uVP'), false, vp);
        gl.uniform3fv(S.draw.u('uEye'), eye); gl.uniform3fv(S.draw.u('uC'), v.c); gl.uniform3fv(S.draw.u('uCell'), v.cell);
        gl.uniform1f(S.draw.u('uR'), v.R); gl.uniform1f(S.draw.u('uSig'), 0.9);
        gl.uniform3fv(S.draw.u('uCol'), v.col); gl.uniform3fv(S.draw.u('uBio'), bioOf(v.col));
        bindTex(S.draw, 'uPart', 7, v.slot.part[0].t);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, NP);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      }
    }
    drawGlass(vp, eye, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
  }

  // one sleeper's mask, at its face, and the hose from it up to the middle of the crown, a little to the front
  function drawGear(v) {
    const g = v.gear, n = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / l); };
    const f = n(g.f), u = n(g.u), r = n(g.r), fh = n([f[0], 0, f[2]]);
    const mp = [g.p[0] + f[0] * 0.012, g.p[1] + f[1] * 0.012, g.p[2] + f[2] * 0.012];
    const h0 = [mp[0] + f[0] * 0.026, mp[1] + f[1] * 0.026, mp[2] + f[2] * 0.026];
    const h3 = [v.c[0] + fh[0] * v.R * 0.3, v.c[1] + v.H + 0.06, v.c[2] + fh[2] * v.R * 0.3];
    const h1 = [h0[0] + f[0] * 0.1 - u[0] * 0.05, h0[1] + f[1] * 0.1 - u[1] * 0.05, h0[2] + f[2] * 0.1 - u[2] * 0.05];
    const h2 = [h3[0] + fh[0] * 0.06, h3[1] - 0.28, h3[2] + fh[2] * 0.06];
    gl.uniform3fv(GEAR.u('uCol'), v.col);
    ell(mp, f, u, r, [0.042, 0.034, 0.028], [0.09, 0.11, 0.11], { half: true });
    tubeC(h0, h1, h2, h3, 0.011, [0.05, 0.06, 0.065], { rib: true });
  }
  // the kit's draws (GEAR): an ellipsoid with its axes and radii, a tube along a cubic or a straight run, a glass arc
  function ell(p, f, u, r, radii, base, { half = false, emit = 0 } = {}) {
    gl.uniform1i(GEAR.u('uMode'), 0); gl.uniform1i(GEAR.u('uHalf'), half ? 1 : 2);
    gl.uniform3fv(GEAR.u('uMP'), p); gl.uniform3fv(GEAR.u('uMF'), f); gl.uniform3fv(GEAR.u('uMU'), u); gl.uniform3fv(GEAR.u('uMR'), r);
    gl.uniform3fv(GEAR.u('uRadii'), radii); gl.uniform3fv(GEAR.u('uBase'), base); gl.uniform1f(GEAR.u('uEmit'), emit);
    gl.drawArrays(gl.TRIANGLES, 0, 12 * 8 * 6);
  }
  const ball = (p, rad, base, emit = 0) => ell(p, [0, 0, 1], [0, 1, 0], [1, 0, 0], [rad, rad, rad], base, { emit });
  function tubeC(a, b, c, d, rad, base, { rib = false, emit = 0, bulge = null } = {}) {
    gl.uniform1i(GEAR.u('uMode'), 1);
    gl.uniform2f(GEAR.u('uBulge'), bulge ? bulge[0] : 0, bulge ? bulge[1] : 1);
    gl.uniform3fv(GEAR.u('uH0'), a); gl.uniform3fv(GEAR.u('uH1'), b); gl.uniform3fv(GEAR.u('uH2'), c); gl.uniform3fv(GEAR.u('uH3'), d);
    gl.uniform1f(GEAR.u('uRad'), rad); gl.uniform1f(GEAR.u('uRib'), rib ? 1 : 0); gl.uniform3fv(GEAR.u('uBase'), base); gl.uniform1f(GEAR.u('uEmit'), emit);
    gl.drawArrays(gl.TRIANGLES, 0, 8 * 28 * 6);
  }
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rodTo = (a, b, rad, base, o) => tubeC(a, lerp3(a, b, 1 / 3), lerp3(a, b, 2 / 3), b, rad, base, o);
  // a cloth: top edge a to b, bowed by bulge, hanging len, swung by sway (gl GEAR mode 3)
  function sheet(a, b, bulge, sway, len, base, t) {
    gl.uniform1i(GEAR.u('uMode'), 3);
    gl.uniform3fv(GEAR.u('uH0'), a); gl.uniform3fv(GEAR.u('uH1'), b); gl.uniform3fv(GEAR.u('uH2'), bulge); gl.uniform3fv(GEAR.u('uH3'), sway);
    gl.uniform1f(GEAR.u('uRad'), len); gl.uniform1f(GEAR.u('uRib'), t); gl.uniform3fv(GEAR.u('uBase'), base); gl.uniform1f(GEAR.u('uEmit'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 16 * 12 * 6);
  }
  // a ring round axis `ax` at c, radius r: four quarter cubics
  function ring(c, ax, r, rad, base, emit) {
    const a = norm3(Math.abs(ax[1]) > 0.9 ? cross3(ax, [1, 0, 0]) : cross3(ax, [0, 1, 0])), b = cross3(ax, a), K = 0.5523 * r;
    const P = (th) => [0, 1, 2].map((j) => c[j] + r * (a[j] * Math.cos(th) + b[j] * Math.sin(th)));
    const T = (th) => [0, 1, 2].map((j) => -a[j] * Math.sin(th) + b[j] * Math.cos(th));
    for (let q = 0; q < 4; q++) {
      const t0 = q * Math.PI / 2, t1 = t0 + Math.PI / 2, p0 = P(t0), p3 = P(t1), d0 = T(t0), d3 = T(t1);
      tubeC(p0, p0.map((x, j) => x + d0[j] * K), p3.map((x, j) => x - d3[j] * K), p3, rad, base, { emit });
    }
  }
  const CYAN = [0.25, 0.95, 1.0];
  // A vat's tube as the scene needs it, worked out once from its line (gl/room-decor.js drawVatTubes): its length, a
  // point and heading at any distance along it, its rings (every 1.2 m from 0.6, as the mesh draws them) and its
  // windows (half way between), each window turned to where people stand: the underside of a run along the ceiling,
  // the side toward the trunk on a drop
  const TUBE_R = 0.4;
  function tubeOf(v) {
    if (v.tube || !v.rec.path) return v.tube;
    const P = v.rec.path, segs = [];
    let len = 0;
    for (let i = 1; i < P.length; i++) { const d = [0, 1, 2].map((j) => P[i][j] - P[i - 1][j]), l = Math.hypot(...d); if (l < 1e-4) continue; segs.push({ a: P[i - 1], ax: d.map((x) => x / l), l, s: len }); len += l; }
    const at = (s) => { s = Math.max(0, Math.min(len, s)); const g = segs.find((q) => s <= q.s + q.l) || segs[segs.length - 1]; return { c: g.a.map((x, j) => x + g.ax[j] * (s - g.s)), ax: g.ax }; };
    const mid = v.rec.trunk?.c || P[0], rings = [], windows = [];
    for (let s = 0.6; s < len - 0.2; s += 1.2) rings.push({ ...at(s), s });
    for (let s = 1.2; s < len - 0.5; s += 1.2) {
      const { c, ax } = at(s), up = Math.abs(ax[1]);
      const inward = norm3([mid[0] - c[0], 0, mid[2] - c[2]]), want = [inward[0] * up, -(1 - up), inward[2] * up];
      const k = want[0] * ax[0] + want[1] * ax[1] + want[2] * ax[2], n = norm3(want.map((x, j) => x - ax[j] * k));
      windows.push({ c: c.map((x, j) => x + n[j] * (TUBE_R - 0.012)), n, ax, side: norm3(cross3(n, ax)), s });
    }
    v.tube = { len, at, rings, windows };
    return v.tube;
  }
  const HOSE = [0.2, 0.25, 0.29], RIM = [0.22, 0.25, 0.28];
  // every tube's windows: dark glass with a faint glow of the fluid inside, lit up bright as something goes past
  function drawTubes() {
    const busy = new Map();
    for (const pu of scene?.pulses || []) { const v = byId(pu.id); if (v) (busy.get(v) || busy.set(v, []).get(v)).push(pu); }
    for (const v of vats) {
      const T = tubeOf(v);
      if (!T) continue;
      const ps = busy.get(v) || [];
      for (const w of T.windows) {
        let g = 0, fl = 0;
        for (const pu of ps) { const k = Math.exp(-(((w.s - pu.s * T.len) / (pu.fluid ? 0.8 : 0.5)) ** 2)); if (pu.fluid) fl = Math.max(fl, k); else g = Math.max(g, k); }
        ell(w.c, w.n, w.side, w.ax, [0.135, 0.085, 0.022], RIM);
        const p = w.c.map((x, j) => x + w.n[j] * 0.006), col = g > fl ? [0.75, 1.0, 0.98] : [0.3, 1.0, 0.6];
        ell(p, w.n, w.side, w.ax, [0.11, 0.062, 0.02], g + fl > 0.03 ? col : [0.06, 0.32, 0.3], { emit: 0.35 + 2.8 * Math.max(g, fl * 0.6) });
      }
    }
  }

  // ── the vat cycle's scene (panels/room-vatcycle.js): the gantries' arms, a body coming down a tube, release glass
  let gantries = [], scene = null;
  function setGantries(list) { gantries = (list || []).filter((g) => g?.c); }
  function setScene(sc) { scene = sc || null; }
  const STEEL = [0.36, 0.39, 0.42], JOINT = [0.06, 0.07, 0.08], CHROME = [0.62, 0.66, 0.7], AMBERG = [1.0, 0.62, 0.2];
  // an arm: shoulder, upper arm, elbow, a forearm sleeve with a piston out of it (it telescopes), a lit wrist, three fingers
  function drawArm(A) {
    ball(A.s, 0.07, JOINT);
    rodTo(A.s, A.e, 0.045, STEEL);
    ball(A.e, 0.06, JOINT);
    const d = [A.w[0] - A.e[0], A.w[1] - A.e[1], A.w[2] - A.e[2]], l = Math.hypot(...d) || 1, t = d.map((x) => x / l), sl = Math.min(l, 0.62);
    const sleeve = [A.e[0] + t[0] * sl, A.e[1] + t[1] * sl, A.e[2] + t[2] * sl];
    rodTo(A.e, sleeve, 0.04, STEEL);
    if (l > sl + 0.01) rodTo(sleeve, A.w, 0.022, CHROME);
    ball(A.w, 0.045, AMBERG, 1.5);
    // the fingers spread from the wrist along the forearm's line, closing as `grip` goes to 1
    const side = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], ax = norm3(cross3(t, side)), ay = cross3(ax, t), g = A.grip ?? 0.3;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + (A.roll || 0), spread = 0.07 * (1 - g * 0.75);
      const tip = [0, 1, 2].map((j) => A.w[j] + t[j] * 0.1 + (ax[j] * Math.cos(a) + ay[j] * Math.sin(a)) * spread);
      rodTo(A.w, tip, 0.011, JOINT);
    }
  }
  function drawScene(vp, eye) {
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    gl.useProgram(GEAR.p);
    gl.uniformMatrix4fv(GEAR.u('uVP'), false, vp); gl.uniform3fv(GEAR.u('uEye'), eye); gl.uniform1f(GEAR.u('uLamp'), 1.0);
    gl.uniform3fv(GEAR.u('uCol'), [0.85, 0.88, 0.9]);
    drawTrunk();
    drawTubes();
    if (!scene) return;
    const t = performance.now() / 1000;
    for (const g of gantries) {
      // the gantry hangs off the hub under the trunk on a main arm of three links (armChain): a swivel at the hub, an
      // elbow, a wrist, and a ball joint into the turret, each link a steel beam with a hydraulic ram along it and a
      // cyan ring at every joint. The clothing feed runs down the arm's underside
      const rig = scene.rigs?.[g.id];
      if (rig) {
        const { hub, body } = rig, J = armChain(hub, body), RAD = [0.1, 0.085, 0.07];
        ball(hub, 0.2, JOINT);
        ring(hub, [0, 1, 0], 0.24, 0.03, CHROME, 0);
        for (let k = 0; k < 3; k++) {
          const a = J[k], b = J[k + 1], d = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), side = norm3(cross3(d, Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0])), up = cross3(side, d);
          rodTo(a, b, RAD[k], STEEL);
          // the ram: a cylinder off the link's top at one end, its chrome rod out to the other
          const off = (p, t) => [0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * t + up[j] * (RAD[k] + 0.05));
          rodTo(off(a, k ? 0.12 : 0.3), off(a, 0.55), 0.034, JOINT); rodTo(off(a, 0.5), off(a, 0.88), 0.018, CHROME);
          if (k) {
            ball(a, RAD[k - 1] * 1.35, JOINT);
            const prev = norm3([a[0] - J[k - 1][0], a[1] - J[k - 1][1], a[2] - J[k - 1][2]]), ax = norm3(cross3(prev, d));
            ring(a, Math.hypot(...cross3(prev, d)) > 1e-3 ? ax : side, RAD[k - 1] * 1.4, 0.014, CYAN, 1.6);
          }
        }
        ball(body, 0.17, JOINT);
        ring(body, [0, 1, 0], 0.2, 0.014, CYAN, 1.6);
        // the turret the arms hang off: a drum with a lit amber band, its underside a dome
        rodTo([body[0], body[1] - 0.05, body[2]], [body[0], body[1] - 0.35, body[2]], 0.32, STEEL);
        ring([body[0], body[1] - 0.25, body[2]], [0, 1, 0], 0.33, 0.02, AMBERG, 1.8);
        ell([body[0], body[1] - 0.35, body[2]], [0, -1, 0], [1, 0, 0], [0, 0, 1], [0.32, 0.32, 0.14], STEEL, { half: true });
        // the camera riding the amber ring (room-vatcycle.js eyeOf): a trolley on the band, a pod out from it, its lens
        // turned on what it's watching, lit red while it's locked on someone and cyan the rest of the time
        if (rig.cam) {
          const { ang, look, iris = 0, hunt = 0 } = rig.cam, rc = [body[0], body[1] - 0.25, body[2]], rr = [Math.cos(ang), 0, Math.sin(ang)];
          const trolley = add3(rc, rr, 0.34), pod = add3(add3(rc, rr, 0.5), [0, 1, 0], -0.03);
          ball(trolley, 0.045, AMBERG, 1.2);
          rodTo(trolley, pod, 0.026, CHROME);
          ball(pod, 0.12, JOINT);
          const toL = [look[0] - pod[0], look[1] - pod[1], look[2] - pod[2]], dist = Math.hypot(...toL) || 1, dir = norm3(toL);
          const ea = norm3(cross3(dir, Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0])), eb = cross3(dir, ea);
          // the barrel: open, a collar at each end on three struts, so the glass inside shows
          const back = add3(pod, dir, 0.08), mouth = add3(pod, dir, 0.24), BR = 0.07;
          ring(back, dir, BR, 0.012, STEEL, 0);
          ring(mouth, dir, BR, 0.014, AMBERG, 1.2 + 1.5 * hunt);
          for (let k = 0; k < 3; k++) {
            const a = k * 2.094 + 0.5, o = [0, 1, 2].map((j) => (ea[j] * Math.cos(a) + eb[j] * Math.sin(a)) * BR);
            rodTo(add3(back, o), add3(mouth, o), 0.008, STEEL);
          }
          // the focal elements: three discs of glass that slide along the barrel to focus — spread for something near,
          // bunched for something far — and hunt back and forth a moment each time it takes a new target
          const near = Math.max(0, Math.min(1, 1 - (dist - 1) / 7)), wob = hunt * 0.025 * Math.sin(t * 45);
          const lens = [0.25 + 0.75 * iris, 0.95 - 0.7 * iris, 1.0 - 0.85 * iris];
          const gaps = [0.035 + 0.035 * near + wob, 0.07 + 0.06 * near - wob * 0.6];
          const discs = [0.095, 0.095 + gaps[0], 0.095 + gaps[0] + gaps[1]].map((s) => Math.min(0.225, s));
          discs.forEach((s, k) => {
            const c = add3(pod, dir, s), R = [0.05, 0.042, 0.056][k];
            ring(c, dir, R, 0.006, CHROME, 0);
            ell(c, dir, eb, ea, [R, R, 0.008], lens, { emit: 0.5 + 0.9 * iris + 1.5 * hunt * (k === 1 ? 1 : 0.4) });
          });
          // the aperture at the mouth closes down on a lock
          ring(add3(mouth, dir, -0.006), dir, 0.058 - 0.026 * iris, 0.01, JOINT, 0);
        }
        // the clothing feed: a corrugated hose slung along the arm's underside, a little sag between each pair of
        // joints, into the top of the turret, through its middle, and out of a nozzle under the dome whose mouth
        // flares when it fires a garment
        for (let k = 0; k < 3; k++) {
          const a = J[k], b = J[k + 1], d = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), side = norm3(cross3(d, Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0])), dn = cross3(d, side);
          const lo = dn[1] > 0 ? dn.map((x) => -x) : dn, o = RAD[k] + 0.1, f0 = a.map((x, j) => x + lo[j] * o), f3 = (k === 2 ? [body[0], body[1] + 0.02, body[2]] : b.map((x, j) => x + lo[j] * o));
          tubeC(f0, lerp3(f0, f3, 1 / 3).map((x, j) => (j === 1 ? x - 0.12 : x)), lerp3(f0, f3, 2 / 3).map((x, j) => (j === 1 ? x - 0.12 : x)), f3, 0.07, HOSE);
          ring(f0, d, 0.08, 0.012, CYAN, 1.2);
        }
        const fire = Math.max(0, Math.min(1, rig.fire || 0)), m0 = [body[0], body[1] - 0.46, body[2]], m1 = [body[0], body[1] - 0.62, body[2]];
        tubeC(m0, lerp3(m0, m1, 1 / 3), lerp3(m0, m1, 2 / 3), m1, 0.07, STEEL, { bulge: [-0.25, 0.35] });
        ring(m1, [0, 1, 0], 0.075, 0.016, CYAN, 0.8 + 3 * fire);
        if (fire > 0.05) ball([m1[0], m1[1] - 0.04, m1[2]], 0.05 + 0.05 * fire, [0.7, 1.0, 1.0], 2.5 * fire);
      }
      for (const A of scene.arms?.[g.id] || []) {
        drawArm(A);
        const c = A.cloth;
        if (c) sheet(c.a, c.b, c.bulge || [0, 0, 0], c.sway || [0, 0, 0], c.len, c.col, t);
      }
    }
    // the fluid pouring through the hole in a release vat's crown, down to its surface: a rope of it that thins as the
    // slug runs out and wobbles as it falls, lit in the fluid's colour
    for (const v of scene.pour ? vats : []) {
      const p = scene.pour[v.rec.id];
      if (!p || p < 0.02) continue;
      const top = v.c[1] + (v.rec.crown || v.H), bot = v.c[1] + Math.max(0.02, v.H * v.level), x = v.c[0], z = v.c[2], h = top - bot;
      if (h < 0.05) continue;
      const w = (k, ph) => 0.035 * p * Math.sin(t * 23 + ph + k * 7);
      // darker than the lit column it lands in: thick fluid straight off the line, with a paler skin twisting round it
      const col = [v.col[0] * 0.38, v.col[1] * 0.42, v.col[2] * 0.4], skin = [v.col[0] * 0.75, v.col[1] * 0.8, v.col[2] * 0.78];
      tubeC([x, top, z], [x + w(1, 0), top - h / 3, z + w(1, 2)], [x + w(2, 1), top - 2 * h / 3, z + w(2, 3)], [x, bot, z], 0.05 + 0.14 * p, col, { emit: 0, bulge: [0.25 * Math.sin(t * 17), 0.25] });
      for (let s = 0; s < 2; s++) {
        const a = t * 9 + s * Math.PI, o = (0.05 + 0.12 * p), q = (k) => [x + Math.cos(a + k * 2.2) * o, top - h * k / 3, z + Math.sin(a + k * 2.2) * o];
        tubeC(q(0), q(1), q(2), [x + Math.cos(a + 6.6) * o * 0.6, bot, z + Math.sin(a + 6.6) * o * 0.6], 0.012 + 0.02 * p, skin, { emit: 0.55 });
      }
      // drops shed off the stream as it falls
      for (let i = 0; i < 10; i++) {
        const ph = (t * 1.7 + i * 0.173) % 1, an = i * 2.4 + Math.floor(t * 1.7 + i * 0.173) * 1.3, rr = 0.08 + 0.18 * p + ph * 0.05;
        ball([x + Math.cos(an) * rr, top - ph * h, z + Math.sin(an) * rr], (0.012 + 0.012 * p) * (1 - ph * 0.4), col, 0.3);
      }
      // where it lands: a churning collar of foam and a crown of splash thrown up and out to the glass and falling back
      const R = v.R * 0.92, surf = bot;
      ring([x, surf + 0.01, z], [0, 1, 0], Math.min(R, 0.12 + 0.2 * p + 0.03 * Math.sin(t * 19)), 0.03 + 0.03 * p, skin, 0.4);
      ring([x, surf + 0.005, z], [0, 1, 0], Math.min(R, 0.28 + 0.25 * p + 0.05 * Math.sin(t * 7)), 0.02, skin, 0.25);
      for (let i = 0; i < 22; i++) {
        const sp = 1.2 + (i % 5) * 0.23, ph = (t * sp + i * 0.137) % 1, an = i * 2.39996 + Math.floor(t * sp + i * 0.137) * 0.9;
        const out = Math.min(R, 0.1 + ph * (0.35 + 0.4 * p) * R / 0.4), up = (2.2 * ph - 2.4 * ph * ph) * (0.25 + 0.35 * p);
        if (up < 0) continue;
        ball([x + Math.cos(an) * out, surf + up, z + Math.sin(an) * out], (0.016 + 0.026 * p) * (1 - ph * 0.6), i % 3 ? skin : col, 0.7);
      }
    }
    // a body plunging in: a crown of fluid thrown up off the surface, drops flung up the glass and falling back, the
    // surface ringing out from where it went in. Thrown once (each drop on its own arc from the moment it went in)
    for (const v of scene.splash ? vats : []) {
      const sp = scene.splash[v.rec.id];
      if (!sp || sp.t < 0) continue;
      const surf = v.c[1] + v.H * v.level, x = v.c[0], z = v.c[2], R = v.R * 0.94, T = sp.t;
      const col = [v.col[0] * 0.45, v.col[1] * 0.5, v.col[2] * 0.48], skin = [v.col[0] * 0.8, v.col[1] * 0.85, v.col[2] * 0.82];
      for (let i = 0; i < 46; i++) {
        const h = (k) => { const n = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return n - Math.floor(n); };
        const an = h(1) * 6.2832, up = 1.6 + 2.4 * h(2), outV = 0.2 + 0.9 * h(3), r0 = 0.08 + 0.15 * h(4), tt = T * (0.85 + 0.3 * h(5));
        const y = up * tt - 4.9 * tt * tt;
        if (y < -0.02) continue;
        const out = Math.min(R, r0 + outV * tt);
        ball([x + Math.cos(an) * out, surf + y, z + Math.sin(an) * out], (0.012 + 0.022 * h(6)) * (1 - Math.min(0.6, tt * 0.5)), i % 3 ? skin : col, 0.6);
      }
      // the crown: a ring of fluid rising and spreading to the glass and falling back, then the rings going out
      const cy = 0.35 * Math.max(0, 2.2 * T - 4.9 * T * T * 1.2);
      if (cy > 0.005) { ring([x, surf + cy * 0.5, z], [0, 1, 0], Math.min(R, 0.2 + T * 0.9), 0.03 + 0.03 * sp.k, skin, 0.5); ring([x, surf + cy, z], [0, 1, 0], Math.min(R, 0.24 + T * 1.0), 0.02, skin, 0.4); }
      for (let k = 0; k < 3; k++) { const rr = ((T * 1.4 + k * 0.33) % 1) * R; ring([x, surf + 0.008, z], [0, 1, 0], Math.max(0.05, rr), 0.018 * sp.k, skin, 0.35 * sp.k); }
    }
    // something forced down a tube, the fluid first and then a body: the hose swells round it as it goes (a length of
    // the same hose drawn over the mesh's, fatter in the middle), and the rings it passes stretch with it and flare
    for (const pu of scene.pulses || []) {
      const v = byId(pu.id), T = v && tubeOf(v);
      if (!T) continue;
      if (pu.flash) { for (const k of T.rings) { const g = Math.exp(-(((k.s - pu.s * T.len) / 0.9) ** 2)); if (g > 0.04) ring(k.c, k.ax, TUBE_R + 0.014, 0.022, CYAN, 0.4 + 3.5 * g); } continue; }
      const here = pu.s * T.len, amp = pu.fluid ? (pu.amp || 0.3) * (1 + 0.15 * Math.sin((pu.wob || 0) * 0.02)) : 0.32, half = pu.fluid ? 1.2 : 0.9, wide = half * 2 * (pu.fluid ? 0.3 : 0.2);
      if (pu.s < 0.995) {
        const p = [-1, -1 / 3, 1 / 3, 1].map((k) => T.at(here + k * half).c);
        tubeC(p[0], p[1], p[2], p[3], TUBE_R * 1.025, HOSE, { bulge: [amp, pu.fluid ? 0.3 : 0.2] });
      }
      for (const k of T.rings) {
        const d = k.s - here, g = Math.exp(-((d / 0.7) ** 2));
        if (g < 0.04) continue;
        const swell = amp * Math.exp(-((d / wide) ** 2));
        ring(k.c, k.ax, (TUBE_R + 0.014) * (1.025 + swell), 0.022, CYAN, 0.4 + (pu.fluid ? 1.4 : 2.8) * g);
      }
    }
  }
  // the trunk's ring, where the tubes go up into it: always breathing cyan, and bright while something's coming down
  function drawTrunk() {
    const tr = vats.find((v) => v.rec.trunk)?.rec.trunk;
    if (!tr) return;
    const t = performance.now() / 1000, busy = scene?.pulses?.length ? 1 : 0;
    const k = 0.9 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.2)) + busy * (1.4 + 1.2 * Math.sin(t * 14));
    ring(tr.c, [0, 1, 0], tr.r, 0.045, CYAN, k);
    ring([tr.c[0], tr.c[1] - 0.08, tr.c[2]], [0, 1, 0], tr.r * 0.8, 0.025, CYAN, k * 0.7);
  }
  // a release vat's glass, after the fluid: the back half fixed, the front half revolving round behind it as it opens
  function drawGlass(vp, eye, w, h) {
    const rel = vats.filter((v) => v.rec.release);
    if (!rel.length) return;
    // opaque: each arc writes the room behind it, bent, read from a copy taken just before it (the back half's copy
    // has the fluid in it, the front half's has the back half)
    gl.disable(gl.BLEND); gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
    gl.useProgram(GEAR.p);
    gl.uniform2f(GEAR.u('uRes'), w, h);
    const grab = (v) => { const r = rectOf(v, vp, w, h).map((n, i) => Math.max(0, Math.min(i % 2 ? h : w, n + (i < 2 ? -48 : 48)))); if (r[2] > r[0] && r[3] > r[1]) copyRect(w, h, ...r); gl.useProgram(GEAR.p); bindTex(GEAR, 'uScene', 5, copy.t); };
    gl.uniformMatrix4fv(GEAR.u('uVP'), false, vp); gl.uniform3fv(GEAR.u('uEye'), eye); gl.uniform1f(GEAR.u('uLamp'), 1.0); gl.uniform1i(GEAR.u('uMode'), 2);
    for (const v of rel) {
      const fr = v.rec.front ? norm3(v.rec.front) : [0, 0, 1], rt = norm3(cross3([0, 1, 0], fr)), open = Math.max(0, Math.min(1, scene?.release?.[v.rec.id]?.open || 0));
      gl.uniform3fv(GEAR.u('uCol'), v.col);
      gl.uniform3fv(GEAR.u('uMP'), v.c); gl.uniform3fv(GEAR.u('uMR'), rt); gl.uniform3fv(GEAR.u('uMF'), fr);
      gl.uniform3fv(GEAR.u('uRadii'), [v.R + 0.012, v.rec.crown || v.H, 0]);
      grab(v); gl.uniform2f(GEAR.u('uArc'), Math.PI * 0.5, Math.PI * 1.5); gl.drawArrays(gl.TRIANGLES, 0, 32 * 6);
      gl.uniform3fv(GEAR.u('uRadii'), [v.R + 0.02, v.rec.crown || v.H, 0]);
      const turn = open * Math.PI * 0.98;
      grab(v); gl.uniform2f(GEAR.u('uArc'), -Math.PI * 0.5 + turn, Math.PI * 0.5 + turn); gl.drawArrays(gl.TRIANGLES, 0, 32 * 6);
    }
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
  }

  // a push on a vat's fluid (a hand on the glass, the door, the drain): at a world point, a velocity in metres a second
  function kick(i, at, vel, r = 0.15) {
    const v = vats[i];
    if (!v) return;
    const l = [at[0] - v.c[0], at[1] - v.c[1], at[2] - v.c[2]];
    v.kick = { at: [l[0] / v.cell[0] + NX / 2, l[1] / v.cell[1], l[2] / v.cell[2] + NZ / 2], v: [vel[0] / v.cell[0], vel[1] / v.cell[1], vel[2] / v.cell[2]], r: r / v.cell[0] };
  }

  function dispose() {
    for (const s of slots) for (const T of [...s.vel, ...s.scal, ...s.p, s.div, s.curl, s.mask, ...s.part, ...s.wave]) free(T);
    slots.length = 0;
    free(copy); copy = null;
    gl.deleteVertexArray(empty);
    for (const Pr of [VOL, GEAR, ...(S ? Object.values(S) : [])]) gl.deleteProgram(Pr.p);
  }

  function onScreen(v, vp) {
    let left = 0, right = 0, below = 0, above = 0, behind = 0;
    for (let i = 0; i < 8; i++) {
      const x = v.c[0] + (i & 1 ? 1 : -1) * v.R, y = v.c[1] + (i & 2 ? v.H : 0), z = v.c[2] + (i & 4 ? 1 : -1) * v.R;
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15], cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
      if (cw <= 0) { behind++; continue; }
      if (cx < -cw) left++; if (cx > cw) right++; if (cy < -cw) below++; if (cy > cw) above++;
    }
    return !(behind === 8 || left === 8 || right === 8 || below === 8 || above === 8);
  }

  // for a bench: the largest of each channel in a simulated vat's grid ('scal' cloud, warmth, haze; 'vel' speed)
  function inspect(i, which = 'scal') {
    const v = vats[i], s = v?.slot;
    if (!s) return null;
    const T = which === 'vel' ? s.vel[0] : s.scal[0], buf = new Float32Array(AW * AH * 4);
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
    gl.readPixels(0, 0, AW, AH, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    const max = [0, 0, 0, 0], sum = [0, 0, 0, 0];
    for (let k = 0; k < buf.length; k += 4) for (let c = 0; c < 4; c++) { const x = Math.abs(buf[k + c]); if (x > max[c]) max[c] = x; sum[c] += x; }
    return { max, mean: sum.map((x) => x / (AW * AH)) };
  }

  return { setVats, setBodies, setLevel, setGantries, setScene, lights, step, draw, kick, dispose, inspect,
    settled: () => !vats.length || (drawn >= 3 && (!sim || vats.filter((v) => v.slot).length >= Math.min(SLOTS, vats.filter((v) => v.H > 0.3).length))),
    get gantries() { return gantries; }, get count() { return vats.length; }, get simulated() { return vats.filter((v) => v.slot).length; }, get list() { return vats.map((v) => ({ id: v.rec.id, c: v.c, r: v.R, h: v.H, level: v.level, sim: !!v.slot, gear: !!v.gear })); }, sim };
}

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// The gantry's main arm from the hub to the turret: three links, solved by FABRIK from a pose bent outward and up
// (the elbows away from the trunk, like a crane's). Past its reach the links lengthen together, as rams would.
const ARM_LINKS = [1.3, 1.15, 0.95];
// ⚠ NOTHING OF THE BOOM GOES ABOVE THE HUB. The hub hangs just under the trunk, so an elbow or the turret lifted
// over it ran up through the hub and into the trunk. CLEAR allows for a link's ram, which stands about 0.19 m proud of
// its beam. Every joint is held at least CLEAR below the hub's centre and,
// near it, pushed out past the hub's ball, inside the solve so the links keep their lengths.
const HUB_CLEAR = 0.6, HUB_R = 0.5;
function armChain(hub, body0) {
  const body = [body0[0], Math.min(body0[1], hub[1] - HUB_CLEAR - 0.2), body0[2]];
  const keep = (p) => {
    p[1] = Math.min(p[1], hub[1] - HUB_CLEAR);
    const dx = p[0] - hub[0], dz = p[2] - hub[2], h = Math.hypot(dx, dz), need = HUB_R * Math.max(0, 1 - (hub[1] - p[1] - HUB_CLEAR) / 0.6);
    if (h < need) { const k = h > 1e-3 ? need / h : 0; p[0] = hub[0] + (h > 1e-3 ? dx * k : need); p[2] = hub[2] + (h > 1e-3 ? dz * k : 0); }
    return p;
  };
  const d = [body[0] - hub[0], body[1] - hub[1], body[2] - hub[2]], dist = Math.hypot(...d) || 1, sum = ARM_LINKS.reduce((a, b) => a + b, 0);
  const k = Math.max(1, dist / (sum * 0.96)), L = ARM_LINKS.map((x) => x * k);
  const h = Math.hypot(d[0], d[2]), out = h > 0.05 ? [d[0] / h, 0, d[2] / h] : [1, 0, 0];
  const at = (t, o, up) => [hub[0] + d[0] * t + out[0] * o, hub[1] + d[1] * t + up, hub[2] + d[2] * t + out[2] * o];
  const P = [hub.slice(), at(0.3, 0.7, 0.35), at(0.66, 0.8, 0.25), body.slice()];
  const mv = (from, to, len) => { const e = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(...e) || 1; return [from[0] + (e[0] / l) * len, from[1] + (e[1] / l) * len, from[2] + (e[2] / l) * len]; };
  for (let it = 0; it < 10; it++) {
    P[3] = body.slice();
    for (let i = 2; i >= 0; i--) P[i] = mv(P[i + 1], P[i], L[i]);
    P[0] = hub.slice();
    for (let i = 1; i <= 3; i++) P[i] = mv(P[i - 1], P[i], L[i - 1]);
    keep(P[1]); keep(P[2]);
  }
  P[3] = body.slice();
  return P;
}
// a point s (0 to 1) of the way along a polyline, by length
export function alongPath(path, s) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  let left = Math.max(0, Math.min(1, s)) * total;
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
    if (left <= l || i === path.length - 1) { const t = l ? Math.min(1, left / l) : 0; return [0, 1, 2].map((j) => path[i - 1][j] + (path[i][j] - path[i - 1][j]) * t); }
    left -= l;
  }
  return path[path.length - 1];
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const inBox = (v, e) => Math.hypot(e[0] - v.c[0], e[2] - v.c[2]) < v.R * 1.02 + 0.02 && e[1] > v.c[1] - 0.02 && e[1] < v.c[1] + v.H + 0.02;
// the living haze's colour: the fluid's, lifted toward white and a little toward cyan
const bioOf = (c) => [c[0] * 0.4 + 0.35, c[1] * 0.4 + 0.6, c[2] * 0.4 + 0.55];
