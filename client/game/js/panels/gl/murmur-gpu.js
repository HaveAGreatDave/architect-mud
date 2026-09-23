// THE MURMURATION, SIMULATED ON THE GPU.
//
// One fragment is one starling. Each frame, for each cloud, the birds are filed into a spatial grid,
// then one pass reads every bird's position and velocity out of two float textures, finds its seven
// nearest flockmates through the grid, applies the rule, and writes the next position and velocity
// into the other pair of textures. Nothing is read back: gl/fauna.js draws the birds straight out of
// the same textures.
//
// ⚠ THE RULE IS THE ONE murmur.js SHIPPED WITH, PORTED TERM FOR TERM. What stays in murmur.js is the
// flock-level half: the weights (MURMUR_RULES), the flock's own memory (flockFrame: its clock, the
// trail its centre has flown, the stoop, the band table) and the starting cloud (seedPoints). The
// per-bird loop lives here: separation, alignment and cohesion over the seven nearest, the pull to the
// bird's station on the trail, the hawk's bubble, the calm vertical, the renormalise to cruise and the
// bank-limited turn.
//
// ⚠ NEIGHBOURS ARE FOUND FRESH EVERY FRAME. The CPU re-scanned each bird every other frame because the
// search was 80% of its step, and its own note said what that staleness cost: the flock packed tighter
// and flatter, 1 : 3.5 : 5.5 against 1 : 3.1 : 5.3 with no cache and real starlings at 1 : 2.8 : 5.6.
//
// ⚠ THE SEARCH GOES THROUGH A HASHED GRID, AND IS EXACT FOR EVERY BIRD IT CAN SETTLE. Birds are filed
// into a grid of cells about half a bird-spacing wide, and each bird searches outward in shells of
// cells until it can PROVE nothing unread is nearer than its seventh: once every cell within
// Chebyshev distance r of its own has been read, anything further is at least r cell widths away
// (murmur.js's own shell proof). About 97% of birds are settled within GRID_R shells, and for those
// the answer is brute force's answer, ties to the lower index — `__glMurmurExact` in the Modelshop
// compares every list on a real flock.
//
//   THE REST — stragglers on the edge, the birds in the hole a stoop opens — also offer up LAST
//   FRAME'S neighbours and THEIR neighbours, fifty-six candidates, because who your seven are changes
//   far more slowly than where they are (murmur.js's own note, the one its neighbour cache rested on).
//   That keeps a straggler steering by seven birds of the flock rather than by whoever happened to be
//   inside the grid's reach, which is the failure the topological rule exists to prevent.
//
//   ⚠ WHY NOT BRUTE FORCE FOR THE REST, which is exact: it was built, measured and taken out. A GPU runs
//   a group of birds in lockstep and one bird's long search holds its whole group, so with ~2% of birds
//   unsettled about 40% of groups held one, and the step cost 9.4 ms at 20,000 birds against 1.1 ms
//   without it. Drawing the unsettled birds as points to pack them together was measured too, and cost
//   the same: each point ran as a group of its own. Walking more shells instead: 16 shells, 18 ms.
//
//   ⚠ AND NOT BRUTE FORCE FOR EVERYBODY: it grows with the square of the flock. It was 5.1 ms at 12,000
//   birds, which puts 20,000 at most of a frame on its own.
//
//   WHY A HASH, NOT A BOX: the cells are hashed into a fixed table (GW x GH slots), so the grid has no
//   bounds to fit and a straggler anywhere in the sky is filed like any other bird. Two cells that
//   land in one slot share it; the search checks each bird's own cell and skips strangers.
//
//   HOW A SLOT HOLDS SEVERAL BIRDS WITHOUT ATOMICS: WebGL2 has no atomic counter to append with, so a
//   slot's birds are PEELED, one layer per pass. Every bird is drawn as a one-pixel point at its slot
//   with its index as the depth, and the depth test keeps the lowest index; the next pass discards
//   every bird at or below what the last layer kept, so it keeps the next lowest, and so on for LAYERS
//   passes. A slot full to its last layer may have lost birds, so a bird that read one is not settled.
//
// ⚠ THERE IS NO CPU FALLBACK IN THE GAME (decided 2026-09-23). A machine that cannot render to a
// float texture draws no murmuration at all.
import { flockFrame, seedPoints, scatterOf, bandWaves, MURMUR_RULES as R } from '../murmur.js';

const W = 64;                       // birds per texture row
const UNIT0 = 8;                    // texture units 8-14: no other layer binds these during the sim
const IDLE_EVICT_MS = 4000;         // murmur.js's own eviction rule, for the same reason
const MAX_CLOUDS = 12;
// The grid: GW x GH hash slots, LAYERS birds a slot. 131,072 slots against the few thousand occupied
// cells of a 20,000-bird cloud keeps two cells sharing a slot rare; the table is shared by every cloud,
// because a cloud's grid is built and used inside its own step and nothing needs it afterwards.
const GW = 512, GH = 256, LAYERS = 12;
// How wide a cell is, and how many shells the search walks before a bird counts as unsettled.
// ⚠ THE CELL IS A SHARE OF THE CLOUD'S OWN SPACING, NOT A NUMBER OF TILES. The spread grows with the
// cube root of the count (flockSpreadScale), so spread / cbrt(n) is the spacing the flock was sized
// for, and a cell a fixed share of it holds the same one or two birds at 3,000 as at 20,000 and at any
// murmurPack. A fixed 0.12 tiles was measured holding twelve and more at 20,000, every one of them a
// full slot and so unsettled: most of the flock, the worst case rather than the rare one.
export const GRID_K = 0.6;
export const GRID_R = 4;
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));   // a JS number as a GLSL float literal

const HASH = `
int slotOf(ivec3 c) {
  uint h = (uint(c.x) * 73856093u) ^ (uint(c.y) * 19349663u) ^ (uint(c.z) * 83492791u);
  return int(h & ${GW * GH - 1}u);
}`;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ── FILING THE BIRDS: one point per bird, at its slot, depth = its index ──
const VERT_FILE = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uPos;
uniform highp sampler2D uVel;
uniform int uN;
uniform vec3 uGO;
uniform float uInvH;
flat out int vI;
const int TW = ${W};
${HASH}
void main() {
  int i = gl_VertexID;
  vI = i;
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  if (i >= uN) return;
  ivec2 t = ivec2(i % TW, i / TW);
  if (texelFetch(uVel, t, 0).w <= 0.0) return;
  int s = slotOf(ivec3(floor((texelFetch(uPos, t, 0).xyz - uGO) * uInvH)));
  vec2 xy = (vec2(float(s % ${GW}), float(s / ${GW})) + 0.5) / vec2(${f(GW)}, ${f(GH)}) * 2.0 - 1.0;
  gl_Position = vec4(xy, (float(i) + 0.5) / float(uN) * 2.0 - 1.0, 1.0);
}`;

const FRAG_FILE = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uPrev;
uniform int uLayer;
flat in int vI;
layout(location = 0) out vec4 oLayer;
layout(location = 1) out vec4 oNext;
void main() {
  if (uLayer > 0 && float(vI) <= texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).r) discard;
  oLayer = vec4(float(vI));
  oNext = oLayer;
}`;

// Offer bird j at squared distance d2 to the seven nearest so far, kept sorted by (distance, index).
// ⚠ THE TIE-BREAK IS EXPLICIT because the grid offers birds in cell order and brute force in index
// order; comparing on the index as well as the distance makes the answer independent of the order.
// ⚠ WRITTEN OUT INLINE AT EACH CALL, NOT AS A GLSL FUNCTION: arrays passed inout are copied in and
// out on every call by some compilers, and this is called hundreds of times per bird per step.
const OFFER = (j, d2) => `{
  if (!(cnt == K && (${d2} > nd[K - 1] || (${d2} == nd[K - 1] && ${j} > nj[K - 1])))) {
    int m = cnt < K ? cnt : K - 1;
    if (cnt < K) cnt++;
    for (int sk = K - 1; sk > 0; sk--) {
      if (sk > m) continue;
      if (nd[sk - 1] > ${d2} || (nd[sk - 1] == ${d2} && nj[sk - 1] > ${j})) { nd[sk] = nd[sk - 1]; nj[sk] = nj[sk - 1]; m = sk - 1; } else break;
    }
    nd[m] = ${d2}; nj[m] = ${j};
  }
}`;

// The search through the grid. A bird it cannot settle also tries last frame's neighbours and theirs.
const GRID_SEARCH = `
  proven = false;
  // ⚠ THE CELL IS WORKED OUT FROM THE STORED POSITION WITH THE SAME ARITHMETIC THE FILING PASS
  // USED — subtract, multiply, floor — never a division, which a vertex and a fragment shader are free
  // to round differently. A bird filed in one cell and looked for in the next is a bird nobody sees.
  ivec3 c0 = ivec3(floor((P.xyz - uGO) * uInvH));
  for (int r = 0; r <= uRMax; r++) {
    for (int dz = -r; dz <= r; dz++) {
      for (int dy = -r; dy <= r; dy++) {
        // the shell only: a full row on the two faces, the two ends of it everywhere else
        int stepx = (r == 0 || abs(dz) == r || abs(dy) == r) ? 1 : 2 * r;
        for (int dx = -r; dx <= r; dx += stepx) {
          ivec3 cc = c0 + ivec3(dx, dy, dz);
          int s = slotOf(cc);
          ivec2 st = ivec2(s % ${GW}, s / ${GW});
          for (int k = 0; k < ${LAYERS}; k++) {
            float fj = texelFetch(uGrid, ivec3(st, k), 0).r;
            if (fj < 0.0) break;
            int j = int(fj);
            // a slot full to its last layer may have had birds peeled off the end: not a proof
            if (k == ${LAYERS - 1}) full = true;
            if (j == i) continue;
            vec3 q = texelFetch(uPos, at(j), 0).xyz;
            if (ivec3(floor((q - uGO) * uInvH)) != cc) continue;   // another cell sharing the slot
            vec3 d = q - p;
            float d2 = dot(d, d);
            ${OFFER('j', 'd2')}
          }
        }
      }
    }
    // ⚠ THE PROOF: every cell within Chebyshev distance r is read, so nothing unread is nearer than
    // r cell widths. Strictly nearer, because a bird exactly that far could still win a tie.
    float reach = float(r) * uH;
    if (cnt == K && nd[K - 1] < reach * reach) { proven = !full; break; }
  }
  if (!proven) {
    // last frame's seven, and each of theirs: a candidate already on the list is not offered twice
    for (int a = 0; a < K; a++) {
      int ja = a < 4 ? int(texelFetch(uNbrA, me, 0)[a]) : int(texelFetch(uNbrB, me, 0)[a - 4]);
      if (ja < 0) continue;
      ivec2 ta = at(ja);
      for (int b = -1; b < K; b++) {
        int j = b < 0 ? ja : (b < 4 ? int(texelFetch(uNbrA, ta, 0)[b]) : int(texelFetch(uNbrB, ta, 0)[b - 4]));
        if (j < 0 || j == i) continue;
        bool have = false;
        for (int m = 0; m < K; m++) if (m < cnt && nj[m] == j) have = true;
        if (have) continue;
        ivec2 t = at(j);
        if (texelFetch(uVel, t, 0).w <= 0.0) continue;
        vec3 d = texelFetch(uPos, t, 0).xyz - p;
        float d2 = dot(d, d);
        ${OFFER('j', 'd2')}
      }
    }
  }
`;

// Every bird against every other: the Modelshop's reference (uBrute 1), never used in a frame.
const BRUTE_SEARCH = `
  for (int j = 0; j < uN; j++) {
    if (j == i) continue;
    ivec2 t = at(j);
    if (texelFetch(uVel, t, 0).w <= 0.0) continue;
    vec3 d = texelFetch(uPos, t, 0).xyz - p;
    float d2 = dot(d, d);
    ${OFFER('j', 'd2')}
  }
`;

// The step. `emit` writes a bird's new state and the neighbour list it steered by, which the next
// frame's unsettled birds read; `keep` carries last frame's list through a bird that did not search.
function stepFrag() {
  const emit = (pos, vel, keep) => (keep
    ? `{ oPos = ${pos}; oVel = ${vel}; oNbrA = texelFetch(uNbrA, me, 0); oNbrB = texelFetch(uNbrB, me, 0); return; }`
    : `{ oPos = ${pos}; oVel = ${vel}; oNbrA = vec4(float(nj[0]), float(nj[1]), float(nj[2]), float(nj[3])); oNbrB = vec4(float(nj[4]), float(nj[5]), float(nj[6]), float(cnt)); return; }`);
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform highp sampler2D uPos;      // xyz, roll
uniform highp sampler2D uVel;      // xyz, vis
uniform highp sampler2D uStat0;    // station, speed factor, rank, beat offset
uniform highp sampler2D uStat1;    // unit scatter xyz
uniform int uN;
uniform float uDt;
uniform float uSpeed;
uniform float uSepR;
uniform float uTurn;
uniform float uSpread;
uniform float uTrailW;
uniform float uShow;
uniform float uFadeK;
uniform float uHeading;
uniform vec3 uC;
uniform vec3 uOff;
uniform int uHasTrail;
uniform vec3 uTrail[${R.TRAIL_SAMP}];
uniform vec4 uScare;               // x, y, damp, live
uniform vec4 uBand[${R.BAND_N}];
uniform int uBandN;
uniform vec3 uShift;               // a frozen flock is carried with its centre
uniform int uFrozen;
uniform int uProbe;                // 1: write the seven neighbours' indices, 2: their squared distances
uniform highp sampler2D uNbrA;     // last frame's neighbours 0-3
uniform highp sampler2D uNbrB;     // last frame's neighbours 4-6, and how many
uniform int uBrute;                // 1: every bird against every other (the bench's reference)
uniform sampler2DArray uGrid;      // bird indices per hash slot, one layer each, -1 = empty
uniform vec3 uGO;                  // the grid's origin
uniform float uInvH;               // 1 / cell width
uniform float uH;                  // cell width
uniform int uRMax;                 // how many shells before a bird counts as unsettled
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
layout(location = 2) out vec4 oNbrA;
layout(location = 3) out vec4 oNbrB;
const int K = ${R.K};
const int TW = ${W};
ivec2 at(int i) { return ivec2(i % TW, i / TW); }
${HASH}
void main() {
  ivec2 me = ivec2(gl_FragCoord.xy); int i = me.y * TW + me.x;
  vec4 P = texelFetch(uPos, me, 0);
  vec4 V = texelFetch(uVel, me, 0);
  if (i >= uN) ${emit('P', 'V', true)}
  if (uFrozen == 1) ${emit('vec4(P.xyz + uShift, P.w)', 'V', true)}
  vec4 S0 = texelFetch(uStat0, me, 0);
  vec4 S1 = texelFetch(uStat1, me, 0);
  vec3 p = P.xyz, v = V.xyz;
  // the bird's station on the trail its centre has flown
  vec3 target = uC;
  if (uHasTrail == 1) {
    int k = min(${R.TRAIL_SAMP - 1}, int(floor(S0.x * ${f(R.TRAIL_SAMP - 1)})));
    target = uC + (uTrail[k] + uOff - uC) * uTrailW;
  }
  // thinning: fade toward rank < show; a bird fading back in is placed on its own station
  float was = V.w;
  float vis = S0.z < uShow ? min(1.0, was + uFadeK) : max(0.0, was - uFadeK);
  if (was <= 0.0 && vis > 0.0) {
    p = target + vec3(S1.x * uSpread, S1.y * uSpread, S1.z * uSpread * ${f(0.6 / R.FLAT_Z)});
    float sp0 = uSpeed * S0.y;
    v = vec3(cos(uHeading) * sp0, sin(uHeading) * sp0, 0.0);
  }
  if (vis <= 0.0) ${emit('vec4(p, P.w)', 'vec4(v, vis)', true)}

  // the seven nearest visible flockmates, exact, ties to the lower index
  float nd[K]; int nj[K]; int cnt = 0;
  for (int m = 0; m < K; m++) { nd[m] = 1e30; nj[m] = -1; }
  bool proven = true, full = false;
  if (uBrute == 1) { ${BRUTE_SEARCH} } else { ${GRID_SEARCH} }

  // ⚠ THE BENCH'S VIEW OF THE SEARCH, and nothing a frame ever asks for. See probe() below.
  if (uProbe == 1) ${emit('vec4(float(nj[0]), float(nj[1]), float(nj[2]), float(nj[3]))', 'vec4(float(nj[4]), float(nj[5]), float(nj[6]), float(cnt) + (proven ? 0.0 : 100.0))', false)}
  if (uProbe == 2) ${emit('vec4(nd[0], nd[1], nd[2], nd[3])', 'vec4(nd[4], nd[5], nd[6], float(cnt))', false)}

  vec3 sep = vec3(0.0), ali = vec3(0.0), coh = vec3(0.0);
  for (int m = 0; m < K; m++) {
    if (m >= cnt) break;
    ivec2 t = at(nj[m]);
    vec3 q = texelFetch(uPos, t, 0).xyz;
    vec3 vq = texelFetch(uVel, t, 0).xyz;
    float d = sqrt(nd[m]); d = d > 0.0 ? d : 1e-4;
    if (d < uSepR) sep += (p - q) * ((uSepR - d) / uSepR / d);
    ali += vq; coh += q;
  }
  if (cnt > 0) { ali /= float(cnt); coh = coh / float(cnt) - p; }

  vec3 dh = target - p;
  float dl = length(dh); dl = dl > 0.0 ? dl : 1e-4;
  float over = max(0.0, dl - uSpread) / uSpread;
  float pull = 0.25 + over * over * 3.0;
  vec3 e = vec3(0.0);
  if (uScare.w > 0.5) {
    vec2 s2 = p.xy - uScare.xy;
    float sd = length(s2); sd = sd > 0.0 ? sd : 1e-4;
    float kk = exp(-(sd / ${f(R.SCARE_R)}) * (sd / ${f(R.SCARE_R)})) * uScare.z;
    if (kk > 1e-4) e = vec3(s2 / sd * kk, 0.35 * kk);
  }
  vec3 acc;
  acc.xy = sep.xy * ${f(R.wSep)} + ali.xy * ${f(R.wAli)} + coh.xy * ${f(R.wCoh)} + (dh.xy / dl) * pull * ${f(R.wHome)} + e.xy * ${f(R.wScare)};
  acc.z = (sep.z * ${f(R.wSep)} + ali.z * ${f(R.wAli)} + coh.z * ${f(R.wCoh)}) * ${f(R.Z_SOFT)}
        + (dh.z / dl) * pull * ${f(R.wHome)} * ${f(R.FLAT_Z)} + e.z * ${f(R.wScare)};
  vec3 nv = v + acc * uDt;
  float want = uSpeed * S0.y;
  float sp = length(nv); sp = sp > 0.0 ? sp : 1e-4;
  nv = nv / sp * want;
  // the bank limit: rotate toward the wanted direction by at most what TURN_G allows
  float osp = length(v);
  if (osp > 1e-6) {
    vec3 u = v / osp, w = nv / want;
    float cosA = clamp(dot(u, w), -1.0, 1.0);
    float maxA = (uTurn * 9.81 * ${f(R.TILE_PER_M)}) / max(want, 1e-4) * uDt;
    if (cosA < cos(maxA)) {
      vec3 e2 = w - u * cosA;
      float el = length(e2);
      if (el > 1e-9) { e2 /= el; nv = (u * cos(maxA) + e2 * sin(maxA)) * want; }
    }
  }
  p += nv * uDt;
  // roll: a bird leaning into its own turn, plus the flock's rolling bands
  float roll = clamp(atan(nv.y, nv.x) - uHeading, -1.2, 1.2) * 0.16;
  vec2 uxy = p.xy - uC.xy;
  for (int b = 0; b < ${R.BAND_N}; b++) {
    if (b >= uBandN) break;
    float u = (dot(uxy, uBand[b].xy) - uBand[b].z) / ${f(R.BAND_WIDTH)};
    if (u >= -3.0 && u <= 3.0) roll += uBand[b].w * exp(-u * u);
  }
  ${emit('vec4(p, roll)', 'vec4(nv, vis)', false)}
}`;
}
const FRAG = stepFrag();

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' murmur shader: ' + log);
  }
  return sh;
}

function link(gl, vs, fs, label) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs, label + ' vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs, label + ' fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(label + ' murmur link: ' + gl.getProgramInfoLog(prog));
  return prog;
}

const STEP_UNIFORMS = ['uPos', 'uVel', 'uStat0', 'uStat1', 'uN', 'uDt', 'uSpeed', 'uSepR', 'uTurn', 'uSpread', 'uTrailW',
  'uShow', 'uFadeK', 'uHeading', 'uC', 'uOff', 'uHasTrail', 'uTrail', 'uScare', 'uBand', 'uBandN', 'uShift', 'uFrozen', 'uProbe'];

export function createMurmurGPU(gl) {
  // ⚠ RENDERING TO A FLOAT TEXTURE IS AN EXTENSION EVEN IN WEBGL2. Without it there is nowhere to
  // put the flock, and — the decision above — no murmuration is drawn.
  const ok = !!gl.getExtension('EXT_color_buffer_float');
  let prog = null, loc = null, vao = null, fileProg = null, floc = null, grid = null;
  const clouds = new Map();
  const bandScratch = new Float64Array(R.BAND_N * 4);
  const trailBuf = new Float32Array(R.TRAIL_SAMP * 3);
  const bandBuf = new Float32Array(R.BAND_N * 4);

  function build() {
    const u = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    prog = link(gl, VERT, FRAG, 'step');
    loc = u(prog, [...STEP_UNIFORMS, 'uGrid', 'uGO', 'uInvH', 'uH', 'uRMax', 'uNbrA', 'uNbrB', 'uBrute']);
    fileProg = link(gl, VERT_FILE, FRAG_FILE, 'grid');
    floc = u(fileProg, ['uPos', 'uVel', 'uN', 'uGO', 'uInvH', 'uPrev', 'uLayer']);
    vao = gl.createVertexArray();
  }

  function tex(w, h, data, fmt = gl.RGBA32F) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (fmt === gl.RGBA32F) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    else gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const nearest = (target) => {
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  };
  const fboOf = (list) => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    list.forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(list.map((_, k) => gl.COLOR_ATTACHMENT0 + k));
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE ? fb : null;
  };

  // ── THE GRID'S OWN RESOURCES, shared by every cloud ──
  //
  // LAYERS slices of one R32F array, which the step samples; two plain textures holding "the layer
  // before", which the filing pass samples, because a pass cannot read the texture it is drawing into
  // (a feedback loop, in WebGL2 terms, whichever slice); and one depth buffer the index sorts on.
  // Each filing pass writes its slice AND one of the two plain textures, so no copy is needed.
  function buildGrid() {
    const arr = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, GW, GH, LAYERS);
    nearest(gl.TEXTURE_2D_ARRAY);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    const prev = [0, 1].map(() => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, GW, GH);
      nearest(gl.TEXTURE_2D);
      return t;
    });
    gl.bindTexture(gl.TEXTURE_2D, null);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT32F, GW, GH);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    let complete = true;
    const fbo = [];
    for (let k = 0; k < LAYERS; k++) {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, arr, 0, k);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, prev[k & 1], 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) complete = false;
      fbo.push(fb);
    }
    return { arr, prev, depth, fbo, ok: complete };
  }

  function create(rec) {
    const n = rec.n, H = Math.ceil(n / W);
    const { pts, sd } = seedPoints(rec.seed ?? rec.key, n, rec.cx, rec.cy, rec.cz, rec.spread);
    const pos = new Float32Array(W * H * 4), vel = new Float32Array(W * H * 4);
    const s0 = new Float32Array(W * H * 4), s1 = new Float32Array(W * H * 4);
    for (let i = 0; i < n; i++) {
      const p = pts[i], o = i * 4, sc = scatterOf(i);
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z; pos[o + 3] = 0;
      vel[o + 3] = 1;                                     // visible, as seedPoints leaves it
      s0[o] = p.st; s0[o + 1] = p.wk; s0[o + 2] = p.rank;
      // the wingbeat offset is windshield.js's own, handed over as a function so its hash has one home
      s0[o + 3] = rec.beatOff ? rec.beatOff(i) : 0;
      s1[o] = sc[0]; s1[o + 1] = sc[1]; s1[o + 2] = sc[2];
    }
    const t = [tex(W, H, pos), tex(W, H, vel), tex(W, H, pos), tex(W, H, vel)];
    // the lists each bird steered by, ping-ponged with its state; -1 until a first step fills them
    const none = new Float32Array(W * H * 4).fill(-1);
    const nb = [tex(W, H, none), tex(W, H, none), tex(W, H, none), tex(W, H, none)];
    const fbo = [0, 1].map((k) => fboOf([t[k * 2], t[k * 2 + 1], nb[k * 2], nb[k * 2 + 1]]));
    const C = {
      key: rec.key, n, H, tex: t, nb, fbo, cur: 0,
      stat0: tex(W, H, s0), stat1: tex(W, H, s1),
      c: { last: null, seen: rec.now, trail: [], sd },
      bound: null,
      bad: !fbo[0] || !fbo[1],
    };
    clouds.set(rec.key, C);
    return C;
  }

  function drop(C) {
    for (const t of [...C.tex, ...C.nb]) gl.deleteTexture(t);
    gl.deleteTexture(C.stat0); gl.deleteTexture(C.stat1);
    for (const fb of C.fbo) if (fb) gl.deleteFramebuffer(fb);
    clouds.delete(C.key);
  }

  // ⚠ WHERE THE FLOCK CAN BE, FOR THE DRAW'S BENEFIT: a sphere round the centre that holds every
  // station plus three cloud radii. gl/fauna.js uses it to skip the detail levels no bird in this
  // cloud can be close enough to earn — at 20,000 birds a full-mesh pass over every bird is millions
  // of vertices for a cloud that is a grey smudge. A bird outside the sphere is clamped to the nearest
  // level that IS drawn, never lost.
  function boundOf(rec, F) {
    let r = 0;
    if (F.samp) {
      for (const s of F.samp) {
        const x = (s.x + F.offX - rec.cx) * F.trailW, y = (s.y + F.offY - rec.cy) * F.trailW, z = (s.z + F.offZ - rec.cz) * F.trailW;
        const d = Math.hypot(x, y, z);
        if (d > r) r = d;
      }
    }
    return { x: rec.cx, y: rec.cy, z: rec.cz, r: r + 3 * (F.localSpread || rec.spread) };
  }

  /**
   * Advance one cloud by this frame. `rec` is the record windshield.js pushes for a murmuration.
   * Saves and restores every piece of GL state it touches, because it runs in the middle of the world
   * pass with a render target already bound.
   */
  function step(rec) {
    if (!ok) return null;
    if (!prog) build();
    if (!grid) grid = buildGrid();
    if (!grid.ok) return null;
    let C = clouds.get(rec.key);
    if (C && C.n !== rec.n) { drop(C); C = null; }
    if (!C) C = create(rec);
    if (C.bad) return null;
    C.c.seen = rec.now;
    const F = flockFrame(C.c, rec.cx, rec.cy, rec.cz, rec.now, rec.spread, { trail: rec.trail, scare: rec.scare });
    if (!F.dt) return C;
    let shift = null;
    if (rec.frozen) {
      shift = [rec.cx - (C.c.fx ?? rec.cx), rec.cy - (C.c.fy ?? rec.cy), rec.cz - (C.c.fz ?? rec.cz)];
      C.c.fx = rec.cx; C.c.fy = rec.cy; C.c.fz = rec.cz;
      if (!shift[0] && !shift[1] && !shift[2]) return C;
    } else { C.c.fx = rec.cx; C.c.fy = rec.cy; C.c.fz = rec.cz; }
    if (!shift) C.bound = boundOf(rec, F);
    else if (C.bound) { C.bound.x += shift[0]; C.bound.y += shift[1]; C.bound.z += shift[2]; }
    pass(C, rec, F, shift, !!rec.brute, 0);
    return C;
  }

  // The per-step uniforms, for either program. A probe runs only the search: every bird visible as it
  // stands and nothing fading.
  function setStep(L, C, rec, F, shift, probe) {
    gl.uniform1i(L.uN, C.n);
    gl.uniform1i(L.uFrozen, shift ? 1 : 0);
    gl.uniform3f(L.uShift, shift ? shift[0] : 0, shift ? shift[1] : 0, shift ? shift[2] : 0);
    gl.uniform1i(L.uProbe, probe);
    if (probe) {
      gl.uniform1f(L.uShow, 2); gl.uniform1f(L.uFadeK, 0); gl.uniform1i(L.uHasTrail, 0);
      gl.uniform3f(L.uC, rec.cx, rec.cy, rec.cz);
      return;
    }
    if (shift) return;
    gl.uniform1f(L.uDt, F.dt);
    gl.uniform1f(L.uSpeed, rec.speed ?? R.speed);
    gl.uniform1f(L.uSepR, rec.sep ?? R.sepR);
    gl.uniform1f(L.uTurn, rec.turnG ?? R.turnG);
    gl.uniform1f(L.uSpread, F.localSpread);
    gl.uniform1f(L.uTrailW, F.trailW);
    gl.uniform1f(L.uShow, Math.min(1, Math.max(0, rec.show ?? 1)));
    gl.uniform1f(L.uFadeK, F.dt / Math.max(0.05, rec.showFade ?? R.SHOW_FADE_S));
    gl.uniform1f(L.uHeading, rec.heading);
    gl.uniform3f(L.uC, rec.cx, rec.cy, rec.cz);
    gl.uniform3f(L.uOff, F.offX, F.offY, F.offZ);
    gl.uniform1i(L.uHasTrail, F.samp ? 1 : 0);
    if (F.samp) {
      for (let k = 0; k < R.TRAIL_SAMP; k++) { trailBuf[k * 3] = F.samp[k].x; trailBuf[k * 3 + 1] = F.samp[k].y; trailBuf[k * 3 + 2] = F.samp[k].z; }
      gl.uniform3fv(L.uTrail, trailBuf);
    }
    gl.uniform4f(L.uScare, F.scare ? F.scare.x : 0, F.scare ? F.scare.y : 0, F.scareDamp || 0, F.scare ? 1 : 0);
    const bn = bandWaves(rec.spread, C.c.sd, rec.now, bandScratch);
    for (let k = 0; k < bandBuf.length; k++) bandBuf[k] = bandScratch[k];
    gl.uniform4fv(L.uBand, bandBuf);
    gl.uniform1i(L.uBandN, bn);
  }

  // One step of the rule over one cloud, from the current state into the other pair of textures.
  // probe 0 is a real step and makes the new state current; a probe writes the search's answer there
  // instead and leaves the flock where it was. `brute` (the bench's reference) searches every bird by
  // brute force.
  function pass(C, rec, F, shift, brute, probe) {
    // ── save what this pass changes ──
    const fbWas = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const vpWas = gl.getParameter(gl.VIEWPORT);
    const en = [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.CULL_FACE].map((k) => [k, gl.isEnabled(k)]);
    const depthFnWas = gl.getParameter(gl.DEPTH_FUNC), depthMaskWas = gl.getParameter(gl.DEPTH_WRITEMASK);
    const cmWas = gl.getParameter(gl.COLOR_WRITEMASK);
    try {
      for (const [k] of en) gl.disable(k);
      gl.colorMask(true, true, true, true);
      const src = C.cur, dst = 1 - C.cur;
      const bind = (unit, target, t, l, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t); if (name) gl.uniform1i(l[name], unit); };
      const bindState = (L) => {
        bind(UNIT0, gl.TEXTURE_2D, C.tex[src * 2], L, 'uPos');
        bind(UNIT0 + 1, gl.TEXTURE_2D, C.tex[src * 2 + 1], L, 'uVel');
        bind(UNIT0 + 2, gl.TEXTURE_2D, C.stat0, L, 'uStat0');
        bind(UNIT0 + 3, gl.TEXTURE_2D, C.stat1, L, 'uStat1');
      };
      // The grid's origin: the flock centre, rounded to a whole cell so the numbers stay small.
      const H = Math.max(1e-3, (rec.cellK ?? GRID_K) * rec.spread / Math.cbrt(C.n)), inv = 1 / H;
      const gx = Math.round(rec.cx * inv) * H, gy = Math.round(rec.cy * inv) * H, gz = Math.round(rec.cz * inv) * H;
      gl.bindVertexArray(vao);

      // ── 1. file the birds into the grid, one layer of each slot per pass ──
      if (!shift && !brute) {
        gl.useProgram(fileProg);
        gl.viewport(0, 0, GW, GH);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.depthMask(true);
        bind(UNIT0, gl.TEXTURE_2D, C.tex[src * 2], floc, 'uPos');
        bind(UNIT0 + 1, gl.TEXTURE_2D, C.tex[src * 2 + 1], floc, 'uVel');
        gl.uniform1i(floc.uN, C.n);
        gl.uniform3f(floc.uGO, gx, gy, gz);
        gl.uniform1f(floc.uInvH, inv);
        const empty = new Float32Array([-1, -1, -1, -1]);
        for (let k = 0; k < LAYERS; k++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, grid.fbo[k]);
          gl.clearBufferfv(gl.COLOR, 0, empty);
          gl.clearBufferfv(gl.COLOR, 1, empty);
          gl.clearBufferfv(gl.DEPTH, 0, [1]);
          bind(UNIT0 + 4, gl.TEXTURE_2D, grid.prev[(k + 1) & 1], floc, 'uPrev');
          gl.uniform1i(floc.uLayer, k);
          gl.drawArrays(gl.POINTS, 0, C.n);
        }
        gl.activeTexture(gl.TEXTURE0 + UNIT0 + 4); gl.bindTexture(gl.TEXTURE_2D, null);
        gl.disable(gl.DEPTH_TEST);
      }
      // ── 2. the step ──
      gl.bindFramebuffer(gl.FRAMEBUFFER, C.fbo[dst]);
      gl.viewport(0, 0, W, C.H);
      gl.useProgram(prog);
      bindState(loc);
      bind(UNIT0 + 4, gl.TEXTURE_2D_ARRAY, grid.arr, loc, 'uGrid');
      bind(UNIT0 + 5, gl.TEXTURE_2D, C.nb[src * 2], loc, 'uNbrA');
      bind(UNIT0 + 6, gl.TEXTURE_2D, C.nb[src * 2 + 1], loc, 'uNbrB');
      gl.uniform3f(loc.uGO, gx, gy, gz);
      gl.uniform1f(loc.uInvH, inv);
      gl.uniform1f(loc.uH, H);
      gl.uniform1i(loc.uRMax, rec.rMax ?? GRID_R);
      gl.uniform1i(loc.uBrute, brute ? 1 : 0);
      setStep(loc, C, rec, F, shift, probe);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!probe) C.cur = dst;
    } finally {
      gl.bindVertexArray(null);
      for (let u = 0; u < 7; u++) {
        gl.activeTexture(gl.TEXTURE0 + UNIT0 + u);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbWas);
      gl.viewport(vpWas[0], vpWas[1], vpWas[2], vpWas[3]);
      gl.depthFunc(depthFnWas);
      gl.depthMask(depthMaskWas);
      gl.colorMask(cmWas[0], cmWas[1], cmWas[2], cmWas[3]);
      for (const [k, was] of en) if (was) gl.enable(k); else gl.disable(k);
    }
  }

  /**
   * THE SEVEN NEIGHBOURS EVERY BIRD WOULD STEER BY, read back — through the grid, or by brute force. ⚠ FOR BENCHES ONLY (readPixels). This is how the grid is checked against brute force:
   * the same flock, the same instant, both searches, every list compared. Comparing two FLOCKS instead does not
   * work, because a hair of rounding between two code paths is amplified by the flock into total
   * divergence within a dozen frames whether or not the searches agree.
   * Returns { idx, d2, cnt, unsettled }: per bird, K indices (-1 = none), their squared distances, how
   * many were found, and whether the grid could not prove its answer.
   */
  function probe(key, rec, brute) {
    const C = clouds.get(key);
    if (!C || C.bad) return null;
    const read = (mode) => {
      pass(C, rec, null, null, brute, mode);
      const fbWas = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const a = new Float32Array(W * C.H * 4), b = new Float32Array(W * C.H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, C.fbo[1 - C.cur]);
      gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, W, C.H, gl.RGBA, gl.FLOAT, a);
      gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, W, C.H, gl.RGBA, gl.FLOAT, b);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbWas);
      return [a, b];
    };
    const [ia, ib] = read(1), [da, db] = read(2);
    const unsettled = new Uint8Array(C.n);
    for (let i = 0; i < C.n; i++) unsettled[i] = ib[i * 4 + 3] >= 100 ? 1 : 0;
    const K = R.K, idx = new Int32Array(C.n * K), d2 = new Float32Array(C.n * K), cnt = new Int32Array(C.n);
    for (let i = 0; i < C.n; i++) {
      const o = i * 4;
      for (let k = 0; k < K; k++) {
        idx[i * K + k] = k < 4 ? ia[o + k] : ib[o + k - 4];
        d2[i * K + k] = k < 4 ? da[o + k] : db[o + k - 4];
      }
      cnt[i] = ib[o + 3] % 100;
    }
    return { idx, d2, cnt, unsettled, n: C.n, K };
  }

  /** Drop clouds nobody has stepped for a while, and hold a hard ceiling (murmur.js's sweep). */
  function sweep(now) {
    for (const C of [...clouds.values()]) if (now - C.c.seen > IDLE_EVICT_MS) drop(C);
    if (clouds.size > MAX_CLOUDS) {
      const old = [...clouds.values()].sort((a, b) => a.c.seen - b.c.seen);
      for (let i = 0; i < old.length - MAX_CLOUDS; i++) drop(old[i]);
    }
  }

  /** The textures gl/fauna.js draws from, for one cloud: current position and velocity, and where it can be. */
  function state(key) {
    const C = clouds.get(key);
    if (!C || C.bad) return null;
    return { pos: C.tex[C.cur * 2], vel: C.tex[C.cur * 2 + 1], stat0: C.stat0, n: C.n, W, bound: C.bound };
  }

  /**
   * Read a cloud back to the CPU. ⚠ FOR BENCHES ONLY: readPixels stalls the pipeline, and nothing in
   * a frame may call it. This is how the Modelshop measures the flock now there is no CPU flock.
   */
  function readback(key) {
    const C = clouds.get(key);
    if (!C || C.bad) return null;
    const fbWas = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const out = { pos: new Float32Array(W * C.H * 4), vel: new Float32Array(W * C.H * 4), n: C.n };
    gl.bindFramebuffer(gl.FRAMEBUFFER, C.fbo[C.cur]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, W, C.H, gl.RGBA, gl.FLOAT, out.pos);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, W, C.H, gl.RGBA, gl.FLOAT, out.vel);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbWas);
    return out;
  }

  return {
    ok, step, sweep, state, readback, probe,
    get clouds() { return clouds.size; },
    get birds() { let n = 0; for (const C of clouds.values()) n += C.n; return n; },
  };
}
