// THE MURMURATION, SIMULATED ON THE GPU.
//
// One fragment is one starling. Each frame, for each cloud, the birds are filed into a spatial grid,
// then one pass reads every bird's position and velocity out of two float textures, finds its seven
// nearest flockmates through the grid, applies the rule, and writes the next position and velocity
// into the other pair of textures. Nothing is read back: gl/fauna.js draws the birds straight out of
// the same textures.
//
// ⚠ THE RULE IS THE ONE murmur.js DESCRIBES, and its header has the research behind every term. What
// stays in murmur.js is the flock-level half: the weights (MURMUR_RULES), the flock's own memory
// (flockFrame: its clock, the centre's course now and a moment either side of it, the body's orientation,
// the stoop) and the starting cloud (seedPoints). The per-bird loop lives here: separation all round,
// alignment and cohesion over the seven nearest outside the blind sector behind, the relayed course, the
// body's rim, the hawk's bubble, the speed held to the centre's, the bank-limited turn and the bank.
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
//   every bird at or below what the last layer kept, so it keeps the next lowest, and so on, one layer
//   a pass, for as many layers as the flock fills. A slot full to its last layer may have lost birds,
//   so a bird that read one is not settled.
//
// ⚠ AND IT IS ONE FLOCK FOR THE WHOLE CYCLE, ON THE GROUND AS WELL AS IN THE AIR. A landed starling
// flock that is not on a ledge is this same flock in GROUND MODE: no neighbour search, just every bird
// walking from wherever it is to its spot on the patch by the end of the landing window and milling
// round it — groundSpot in client/shared/birds.js, whose per-bird half is baked into two textures once
// (groundSpotParts) so there is one copy of where a landed starling stands. It used to become a CPU
// flock at touchdown, drawn bird by bird and thinned to the face budget, which dropped a grand roost
// from twenty thousand birds to eighteen hundred the moment it landed and jumped every bird from the
// cloud to a formation it had never flown. On a ledge a flock is still the CPU's: perching is ledge and
// wire geometry, and a grand roost never perches (perchedNow).
//
// ⚠ THERE IS NO CPU FALLBACK IN THE GAME (decided 2026-09-23). A machine that cannot render to a
// float texture draws no murmuration at all.
import { flockFrame, seedPoints, scatterOf, MURMUR_RULES as R } from '../murmur.js';

const W = 64;                       // birds per texture row
const UNIT0 = 8;                    // texture units 8-16: no other layer binds these during the sim
const FLOOR_Z = 0.03;               // tiles: the lowest an airborne starling flies
const IDLE_EVICT_MS = 4000;         // murmur.js's own eviction rule, for the same reason
const MAX_CLOUDS = 12;
// The grid: GW x GH hash slots, LAYERS birds a slot. 131,072 slots against the few thousand occupied
// cells of a 20,000-bird cloud keeps two cells sharing a slot rare; the table is shared by every cloud,
// because a cloud's grid is built and used inside its own step and nothing needs it afterwards.
const GW = 512, GH = 256, LAYERS = 16, LAYERS_MIN = 4;
// How wide a cell is, and how many shells the search walks before a bird counts as unsettled.
// ⚠ THE CELL IS A SHARE OF THE CLOUD'S OWN SPACING, NOT A NUMBER OF TILES. The spread grows with the
// cube root of the count (flockSpreadScale), so spread / cbrt(n) is the spacing the flock was sized
// for, and a cell a fixed share of it holds the same one or two birds at 3,000 as at 20,000 and at any
// murmurPack. A fixed 0.12 tiles was measured holding twelve and more at 20,000, every one of them a
// full slot and so unsettled: most of the flock, the worst case rather than the rare one.
// ⚠ AND IT IS 1.2 OF IT SINCE THE BODY WAS RESIZED FROM THE RESEARCH (2026-09-23): the same spread now holds
// birds about 0.8 m apart, so at 0.6 a bird's seventh neighbour was past the fourth shell for half the
// flock — 40-63% unsettled at 4,000 birds. At 1.2 it is 0-9 of 4,000, and the step is cheaper for it:
// 0.73 ms at 4,000 and 1.06 at 20,000, against 0.93 and 1.31 at 0.6 (__glMurmurCost).
export const GRID_K = 1.2;
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
  if (uLayer > 0 && float(vI + 1) <= texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).r) discard;
  oLayer = vec4(float(vI + 1));
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
          for (int k = 0; k < uLayers; k++) {
            float fj = texelFetch(uGrid, ivec3(st, k), 0).r;
            if (fj < 0.5) break;                    // index + 1, so 0 is an empty slot
            int j = int(fj + 0.5) - 1;
            // a slot full to its last layer may have had birds peeled off the end: not a proof
            if (k == uLayers - 1) full = true;
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
uniform highp sampler2D uPos;      // xyz, bank (rad)
uniform highp sampler2D uVel;      // xyz, vis
uniform highp sampler2D uStat0;    // -, -, rank, beat offset
uniform highp sampler2D uStat1;    // unit scatter in the body's own frame: long, wide, thick
uniform int uN;
uniform float uDt;
uniform float uSpeed;              // the cruise a bird fades back in at
uniform float uSepR;
uniform float uTurn;
uniform float uShow;
uniform float uFadeK;
uniform vec3 uC;                   // the flock's centre, the shared model's
uniform vec3 uCmd[${R.CMD_N}];     // the centre's velocity now and at each lag of uCmdDt
uniform float uCmdDt;
uniform vec4 uRelay;               // lateral to the course (x, y), how far across a turn travels, how fast
uniform float uSide;               // -1..1: +1 is a left turn, whose left edge leads
uniform vec4 uEnv;                 // the body's semi-axes long, wide, thick; tan of its bank
uniform vec2 uEnvDir;              // the body's long axis
uniform vec2 uNoise;               // the speed field's wavenumber and phase
uniform vec4 uScare;               // x, y, damp, live
uniform vec3 uShift;               // a frozen flock is carried with its centre
uniform int uFrozen;
uniform int uProbe;                // 1: write the seven neighbours' indices, 2: their squared distances
uniform highp sampler2D uStat2;    // on the ground: direction from the centre (c, sn), share of the patch, mill phase
uniform highp sampler2D uStat3;    // on the ground: jitter (x, y), second mill phase
uniform int uGround;               // 1: the flock is down; each bird walks to and mills round its spot
uniform vec2 uAnchor;              // the patch's centre
uniform float uGR;                 // the patch's radius, the startle included
uniform float uMill;               // how far a bird wanders round its spot
uniform vec2 uMillA;               // the two mill phases, now x rate, wrapped to a turn in JS
uniform float uLandLeft;           // seconds until every bird must be on its spot; 0 once they are
uniform float uLift;               // how far off the ground a bird about to take off has risen
uniform float uFloorZ;             // an airborne bird never flies lower than this
uniform highp sampler2D uNbrA;     // last frame's neighbours 0-3
uniform highp sampler2D uNbrB;     // last frame's neighbours 4-6, and how many
uniform int uBrute;                // 1: every bird against every other (the bench's reference)
uniform sampler2DArray uGrid;      // bird indices per hash slot, one layer each, -1 = empty
uniform vec3 uGO;                  // the grid's origin
uniform float uInvH;               // 1 / cell width
uniform float uH;                  // cell width
uniform int uRMax;                 // how many shells before a bird counts as unsettled
uniform int uLayers;               // how many layers of the grid were filed this frame
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
  vec2 L = uEnvDir, Wd = vec2(-L.y, L.x);
  // thinning: fade toward rank < show; a bird fading back in is placed inside the body, on the course
  float was = V.w;
  float vis = S0.z < uShow ? min(1.0, was + uFadeK) : max(0.0, was - uFadeK);
  if (was <= 0.0 && vis > 0.0) {
    p = uC + vec3(L * (S1.x * uEnv.x * ${f(R.ENV_IN)}) + Wd * (S1.y * uEnv.y * ${f(R.ENV_IN)}), S1.z * uEnv.z * ${f(R.ENV_IN)});
    float c0 = length(uCmd[0]);
    v = c0 > 1e-3 ? uCmd[0] / c0 * uSpeed : vec3(uSpeed, 0.0, 0.0);
  }
  if (vis <= 0.0) ${emit('vec4(p, P.w)', 'vec4(v, vis)', true)}

  // ⚠ ON THE GROUND THERE IS NO FLOCKING: every bird goes to its own spot, the way groundSpot places it,
  // and gets there exactly when the landing window closes, so the flock comes down continuously from
  // wherever the cloud left each bird. The velocity is what the bird moved, so the draw faces it the
  // way it is walking, and a take-off hands the flocking a bird already moving.
  if (uGround == 1) {
    vec4 G0 = texelFetch(uStat2, me, 0), G1 = texelFetch(uStat3, me, 0);
    float gr = uGR * G0.z;
    vec2 spot = uAnchor + vec2(G0.x * gr + G1.x, G0.y * gr + G1.y)
              + vec2(cos(uMillA.x + G0.w * 6.283185307), sin(uMillA.y + G1.z * 6.283185307)) * uMill;
    vec3 tgt = vec3(spot, uLift);
    vec3 np = uLandLeft > 0.0 ? p + (tgt - p) * min(1.0, uDt / uLandLeft) : tgt;
    ${emit('vec4(np, 0.0)', 'vec4((np - p) / max(uDt, 1e-4), vis)', true)}
  }

  // the seven nearest visible flockmates, exact, ties to the lower index
  float nd[K]; int nj[K]; int cnt = 0;
  for (int m = 0; m < K; m++) { nd[m] = 1e30; nj[m] = -1; }
  bool proven = true, full = false;
  if (uBrute == 1) { ${BRUTE_SEARCH} } else { ${GRID_SEARCH} }

  // ⚠ THE BENCH'S VIEW OF THE SEARCH, and nothing a frame ever asks for. See probe() below.
  if (uProbe == 1) ${emit('vec4(float(nj[0]), float(nj[1]), float(nj[2]), float(nj[3]))', 'vec4(float(nj[4]), float(nj[5]), float(nj[6]), float(cnt) + (proven ? 0.0 : 100.0))', false)}
  if (uProbe == 2) ${emit('vec4(nd[0], nd[1], nd[2], nd[3])', 'vec4(nd[4], nd[5], nd[6], float(cnt))', false)}

  float osp = length(v);
  vec3 fwd = osp > 1e-6 ? v / osp : vec3(1.0, 0.0, 0.0);
  vec3 sep = vec3(0.0), ali = vec3(0.0), coh = vec3(0.0);
  float seen = 0.0;
  for (int m = 0; m < K; m++) {
    if (m >= cnt) break;
    ivec2 t = at(nj[m]);
    vec3 q = texelFetch(uPos, t, 0).xyz;
    vec3 vq = texelFetch(uVel, t, 0).xyz;
    float d = sqrt(nd[m]); d = d > 0.0 ? d : 1e-4;
    if (d < uSepR) sep += (p - q) * ((uSepR - d) / uSepR / d);
    // ⚠ THE BLIND SECTOR BEHIND: a neighbour there is avoided and never followed (StarDisplay's 2 x 45°)
    if (dot((q - p) / d, fwd) < ${f(R.blindCos)}) continue;
    ali += vq; coh += q; seen += 1.0;
  }
  if (seen > 0.0) { ali /= seen; coh = coh / seen - p; }

  // ⚠ THE COURSE THIS BIRD IS ACTING ON: the centre's own, as it was 'delay' ago. A turn starts at the
  // edge on its inside and reaches a bird after its distance from that edge over the relay speed, so
  // every bird turns on the same radius, one after another, and the front crosses the flock.
  vec3 q0 = p - uC;
  float lat = dot(q0.xy, uRelay.xy);
  float delay = clamp((uRelay.z - lat * uSide) / uRelay.w, 0.0, ${f((R.CMD_N - 1))} * uCmdDt);
  float fk = delay / uCmdDt;
  int k0 = min(${R.CMD_N - 2}, int(floor(fk)));
  vec3 cmd = mix(uCmd[k0], uCmd[k0 + 1], fk - float(k0));
  float cl = length(cmd);
  vec3 cdir = cl > 1e-4 ? cmd / cl : fwd;
  // ⚠ THE SPEED IS THE CENTRE'S, times a deviation of a few per cent that neighbours share and that drifts
  // slowly, slowing more readily than speeding up, and clamped to what a starling flies.
  // ⚠ AND A BIRD KEEPS ITS PLACE FORE AND AFT BY ITS SPEED, NOT BY TURNING. Its speed is set, so a push
  // back from the front of the body could only swing it sideways: it veered rather than eased off, and the
  // body smeared out along its own course — measured at a standard deviation half as long again as the
  // body allows, and a long axis along the course rather than across it. So the rim pushes only across
  // and up and down, and a bird ahead of its place slows and one behind speeds up.
  float nz = 0.5 * (sin(dot(p.xy, vec2(0.83, 0.56)) * uNoise.x + uNoise.y)
                  + sin(dot(p.xy, vec2(-0.39, 0.92)) * uNoise.x * 1.31 - uNoise.y * 0.77));
  nz = nz < 0.0 ? nz * 1.3 : nz * 0.7;
  vec2 cxy = length(cdir.xy) > 1e-4 ? normalize(cdir.xy) : fwd.xy;
  // only past the same inner band the rim uses: inside it a bird is as free fore and aft as across
  float along = dot(q0.xy, cxy) / uEnv.y;
  float fore = sign(along) * clamp((abs(along) - ${f(R.ENV_IN)}) / ${f(1 - R.ENV_IN)}, 0.0, 1.5);
  float want = clamp(cl * (1.0 + ${f(R.speedDev)} * nz) * (1.0 - ${f(R.catchK)} * fore), ${f(R.speedLo)}, ${f(R.speedHi)});

  // ⚠ THE BODY: free inside, pushed back over the outer band and harder past the rim, so the edge is
  // denser than the middle. Its plane is sheared by tan(bank) along the course's lateral, so it banks
  // into a turn with the birds in it.
  float ex = dot(q0.xy, L) / uEnv.x, ey = dot(q0.xy, Wd) / uEnv.y, ez = (q0.z + uEnv.w * lat) / uEnv.z;
  float er = sqrt(ex * ex + ey * ey + ez * ez);
  vec3 env = vec3(0.0);
  if (er > ${f(R.ENV_IN)}) {
    vec3 g = vec3(L * (ex / uEnv.x) + Wd * (ey / uEnv.y) + uRelay.xy * (uEnv.w * ez / uEnv.z), ez / uEnv.z);
    float gl = length(g);
    if (gl > 1e-6) env = -g / gl * (smoothstep(${f(R.ENV_IN)}, 1.0, er) + max(0.0, er - 1.0) * 4.0);
    if (er < 1.0) env.xy -= cxy * dot(env.xy, cxy);   // fore and aft is the speed's job (above), inside the rim
  }
  vec3 steer = cdir * want - v;
  vec3 e = vec3(0.0);
  if (uScare.w > 0.5) {
    vec2 s2 = p.xy - uScare.xy;
    float sd = length(s2); sd = sd > 0.0 ? sd : 1e-4;
    float kk = exp(-(sd / ${f(R.SCARE_R)}) * (sd / ${f(R.SCARE_R)})) * uScare.z;
    if (kk > 1e-4) e = vec3(s2 / sd * kk, 0.35 * kk);
  }
  vec3 acc;
  acc.xy = sep.xy * ${f(R.wSep)} + ali.xy * ${f(R.wAli)} + coh.xy * ${f(R.wCoh)} + steer.xy * ${f(R.wCmd)} + env.xy * ${f(R.wEnv)} + e.xy * ${f(R.wScare)};
  // ⚠ SEPARATION ACTS IN FULL VERTICALLY; ONLY FOLLOWING NEIGHBOURS IS DAMPED THERE. With the vertical
  // share of all three damped, nothing ever spread the birds apart in height, cohesion slowly pressed them
  // into a sheet, and a flock measured 1 : 12.9 thick-to-wide against the 1 : 2.8 of real ones. The body's
  // own thin axis is what holds it flat now.
  acc.z = sep.z * ${f(R.wSep)} + (ali.z * ${f(R.wAli)} + coh.z * ${f(R.wCoh)}) * ${f(R.Z_SOFT)}
        + steer.z * ${f(R.wCmd)} + env.z * ${f(R.wEnv)} + e.z * ${f(R.wScare)};
  vec3 nv = v + acc * uDt;
  float sp = length(nv); sp = sp > 0.0 ? sp : 1e-4;
  nv = nv / sp * want;
  // the bank limit: rotate toward the wanted direction by at most what TURN_G allows
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
  // ⚠ NEVER BELOW THE GROUND. A flock coming in to land is centred on a point that is itself at the
  // ground, so half of it would otherwise be flying through the turf for the last seconds of the flight.
  if (p.z < uFloorZ) { p.z = uFloorZ; nv.z = max(nv.z, 0.0); }
  // ⚠ THE BANK IS THE BIRD'S OWN TURN: g tan(bank) = v omega, eased over a tenth of a second so the
  // jostle of separation does not flicker the wing. A turn crossing the flock is a band of banked birds
  // crossing it, and the draw shades each by how much wing it shows the camera.
  float yaw = length(v.xy) > 1e-6 && length(nv.xy) > 1e-6 ? atan(v.x * nv.y - v.y * nv.x, dot(v.xy, nv.xy)) : 0.0;
  float bank = clamp(atan(want * yaw / uDt / ${f(R.G_TILES)}), ${f(-R.rollMax)}, ${f(R.rollMax)});
  float roll = P.w + (bank - P.w) * min(1.0, uDt / ${f(R.rollTau)});
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

const STEP_UNIFORMS = ['uPos', 'uVel', 'uStat0', 'uStat1', 'uN', 'uDt', 'uSpeed', 'uSepR', 'uTurn',
  'uShow', 'uFadeK', 'uC', 'uCmd', 'uCmdDt', 'uRelay', 'uSide', 'uEnv', 'uEnvDir', 'uNoise', 'uScare', 'uShift', 'uFrozen', 'uProbe',
  'uStat2', 'uStat3', 'uGround', 'uAnchor', 'uGR', 'uMill', 'uMillA', 'uLandLeft', 'uLift', 'uFloorZ'];

export function createMurmurGPU(gl) {

  // ⚠ A UNIFORM IS SENT ONLY WHEN IT CHANGES. A frame steps several clouds through the same program, and most of what a step sends — the speed, the separation, the turn limit, the floor — is the same for every one of them. A program keeps its uniforms between draws, so
  // the last value sent to each location is remembered here and an identical one is not sent again.
  // Per location, and so per program, and this whole object is per context, so a lost context
  // starts with an empty memory.
  const sent = new Map();
  const fresh = (l, a, b, c, d) => {
    let v = sent.get(l);
    if (!v) { v = new Float64Array(4).fill(NaN); sent.set(l, v); }
    if (v[0] === a && v[1] === b && v[2] === c && v[3] === d) return false;
    v[0] = a; v[1] = b; v[2] = c; v[3] = d; return true;
  };
  const u1f = (l, a) => { if (l && fresh(l, a, 0, 0, 0)) gl.uniform1f(l, a); };
  const u1i = (l, a) => { if (l && fresh(l, a, 0, 0, 0)) gl.uniform1i(l, a); };
  const u2f = (l, a, b) => { if (l && fresh(l, a, b, 0, 0)) gl.uniform2f(l, a, b); };
  const u2i = (l, a, b) => { if (l && fresh(l, a, b, 0, 0)) gl.uniform2i(l, a, b); };
  const u3f = (l, a, b, c) => { if (l && fresh(l, a, b, c, 0)) gl.uniform3f(l, a, b, c); };
  const u4f = (l, a, b, c, d) => { if (l && fresh(l, a, b, c, d)) gl.uniform4f(l, a, b, c, d); };
  // ⚠ RENDERING TO A FLOAT TEXTURE IS AN EXTENSION EVEN IN WEBGL2. Without it there is nowhere to
  // put the flock, and — the decision above — no murmuration is drawn.
  const ok = !!gl.getExtension('EXT_color_buffer_float');
  let prog = null, loc = null, vao = null, fileProg = null, floc = null, grid = null, occlusion = 0;
  const clouds = new Map();

  function build() {
    const u = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    prog = link(gl, VERT, FRAG, 'step');
    loc = u(prog, [...STEP_UNIFORMS, 'uGrid', 'uGO', 'uInvH', 'uH', 'uRMax', 'uNbrA', 'uNbrB', 'uBrute', 'uLayers']);
    fileProg = link(gl, VERT_FILE, FRAG_FILE, 'grid');
    floc = u(fileProg, ['uPos', 'uVel', 'uN', 'uGO', 'uInvH', 'uPrev', 'uLayer']);
    vao = gl.createVertexArray();
    // ⚠ EVERY SAMPLER HAS ONE UNIT FOR THE LIFE OF THE PROGRAM, SO IT IS TOLD ONCE. Re-sending the unit
    // with every bind was a uniform1i per texture per pass per cloud — over two hundred GL calls a frame
    // with a roost in view, each one costing the frame about as much as a draw.
    gl.useProgram(prog);
    const units = { uPos: 0, uVel: 1, uStat0: 2, uStat1: 3, uGrid: 4, uNbrA: 5, uNbrB: 6, uStat2: 7, uStat3: 8 };
    for (const [n, k] of Object.entries(units)) u1i(loc[n], UNIT0 + k);
    gl.useProgram(fileProg);
    u1i(floc.uPos, UNIT0); u1i(floc.uVel, UNIT0 + 1); u1i(floc.uPrev, UNIT0 + 4);
    gl.useProgram(null);
    occlusion = gl.ANY_SAMPLES_PASSED_CONSERVATIVE;
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
    const { pts, sd } = seedPoints(rec.seed ?? rec.key, n, rec.cx, rec.cy, rec.cz, rec.spread, rec.heading ?? 0);
    const pos = new Float32Array(W * H * 4), vel = new Float32Array(W * H * 4);
    const s0 = new Float32Array(W * H * 4), s1 = new Float32Array(W * H * 4);
    const s2 = new Float32Array(W * H * 4), s3 = new Float32Array(W * H * 4);
    for (let i = 0; i < n; i++) {
      const p = pts[i], o = i * 4, sc = scatterOf(i);
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z; pos[o + 3] = 0;
      vel[o + 3] = 1;                                     // visible, as seedPoints leaves it
      s0[o + 2] = p.rank;
      // the wingbeat offset is windshield.js's own, handed over as a function so its hash has one home
      s0[o + 3] = rec.beatOff ? rec.beatOff(i) : 0;
      s1[o] = sc[0]; s1[o + 1] = sc[1]; s1[o + 2] = sc[2];
      // where this bird stands when the flock is down: groundSpotParts, handed over as a function so
      // the placement has one home (client/shared/birds.js)
      const g = rec.groundParts ? rec.groundParts(i) : null;
      if (g) { s2[o] = g.c; s2[o + 1] = g.sn; s2[o + 2] = g.q; s2[o + 3] = g.s; s3[o] = g.jx; s3[o + 1] = g.jy; s3[o + 2] = g.s2; }
    }
    const t = [tex(W, H, pos), tex(W, H, vel), tex(W, H, pos), tex(W, H, vel)];
    // the lists each bird steered by, ping-ponged with its state; -1 until a first step fills them
    const none = new Float32Array(W * H * 4).fill(-1);
    const nb = [tex(W, H, none), tex(W, H, none), tex(W, H, none), tex(W, H, none)];
    const fbo = [0, 1].map((k) => fboOf([t[k * 2], t[k * 2 + 1], nb[k * 2], nb[k * 2 + 1]]));
    const C = {
      key: rec.key, n, H, tex: t, nb, fbo, cur: 0,
      stat0: tex(W, H, s0), stat1: tex(W, H, s1), stat2: tex(W, H, s2), stat3: tex(W, H, s3),
      c: { last: null, seen: rec.now, sd },
      bound: null,
      // how many grid layers this cloud files, and the query that says whether its last one was used
      layers: LAYERS, lq: null, lqLayer: -1,
      bad: !fbo[0] || !fbo[1],
    };
    clouds.set(rec.key, C);
    return C;
  }

  function drop(C) {
    if (C.lq) gl.deleteQuery(C.lq);
    for (const t of [...C.tex, ...C.nb]) gl.deleteTexture(t);
    gl.deleteTexture(C.stat0); gl.deleteTexture(C.stat1); gl.deleteTexture(C.stat2); gl.deleteTexture(C.stat3);
    for (const fb of C.fbo) if (fb) gl.deleteFramebuffer(fb);
    clouds.delete(C.key);
  }

  // ⚠ WHERE THE FLOCK CAN BE, FOR THE DRAW'S BENEFIT: a sphere round the centre that holds the body with
  // room for the birds that stray past its rim. gl/fauna.js uses it to skip the detail levels no bird in this
  // cloud can be close enough to earn — at 20,000 birds a full-mesh pass over every bird is millions
  // of vertices for a cloud that is a grey smudge. A bird outside the sphere is clamped to the nearest
  // level that IS drawn, never lost.
  function boundOf(rec, F) {
    return { x: rec.cx, y: rec.cy, z: rec.cz, r: F.env.aL * 1.35 + 0.3 };
  }

  // ⚠ THE GL STATE A STEP CHANGES IS SAVED ONCE AND PUT BACK ONCE, FOR EVERY CLOUD STEPPED TOGETHER.
  // Saving it per cloud was a dozen state queries and a dozen restores per flock per frame; the world
  // pass hands stepAll every cloud of the frame at once. Texture bindings are not put back: nothing
  // outside this file samples units 8-16, and the one texture that is also a render target elsewhere
  // (the grid array) is unbound after use.
  function withState(fn) {
    const S = {
      fb: gl.getParameter(gl.FRAMEBUFFER_BINDING), vp: gl.getParameter(gl.VIEWPORT),
      en: [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.CULL_FACE].map((k) => [k, gl.isEnabled(k)]),
      df: gl.getParameter(gl.DEPTH_FUNC), dm: gl.getParameter(gl.DEPTH_WRITEMASK), cm: gl.getParameter(gl.COLOR_WRITEMASK),
      cc: gl.getParameter(gl.COLOR_CLEAR_VALUE), cd: gl.getParameter(gl.DEPTH_CLEAR_VALUE),
    };
    try {
      for (const [k] of S.en) gl.disable(k);
      gl.colorMask(true, true, true, true);
      return fn();
    } finally {
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
      gl.viewport(S.vp[0], S.vp[1], S.vp[2], S.vp[3]);
      gl.depthFunc(S.df); gl.depthMask(S.dm);
      gl.colorMask(S.cm[0], S.cm[1], S.cm[2], S.cm[3]);
      gl.clearColor(S.cc[0], S.cc[1], S.cc[2], S.cc[3]); gl.clearDepth(S.cd);
      for (const [k, was] of S.en) if (was) gl.enable(k); else gl.disable(k);
    }
  }

  /**
   * Advance one cloud by this frame. `rec` is the record windshield.js pushes for a murmuration.
   * Saves and restores every piece of GL state it touches, because it runs in the middle of the world
   * pass with a render target already bound. `stepAll` does every cloud of a frame under one save.
   */
  function step(rec) {
    if (!ok) return null;
    return withState(() => stepInner(rec));
  }
  function stepAll(recs) {
    if (!ok || !recs.length) return [];
    return withState(() => recs.map(stepInner));
  }
  function stepInner(rec) {
    if (!prog) build();
    if (!grid) grid = buildGrid();
    if (!grid.ok) return null;
    let C = clouds.get(rec.key);
    if (C && C.n !== rec.n) { drop(C); C = null; }
    if (!C) C = create(rec);
    if (C.bad) return null;
    C.c.seen = rec.now;
    const F = flockFrame(C.c, rec.cx, rec.cy, rec.cz, rec.now, rec.spread, { heading: rec.heading, scare: rec.scare, course: rec.course });
    if (!F.dt) return C;
    let shift = null;
    if (rec.frozen) {
      shift = [rec.cx - (C.c.fx ?? rec.cx), rec.cy - (C.c.fy ?? rec.cy), rec.cz - (C.c.fz ?? rec.cz)];
      C.c.fx = rec.cx; C.c.fy = rec.cy; C.c.fz = rec.cz;
      if (!shift[0] && !shift[1] && !shift[2]) return C;
    } else { C.c.fx = rec.cx; C.c.fy = rec.cy; C.c.fz = rec.cz; }
    if (rec.ground) {
      const G = rec.ground, pr = G.R + G.mill + 0.3;
      const pb = { x: G.anchor[0], y: G.anchor[1], z: 0, r: pr };
      // still coming down: the sphere that holds where the cloud was and the patch it is going to
      if (G.landLeft > 0 && C.bound && !C.bound.ground) {
        const d = Math.hypot(C.bound.x - pb.x, C.bound.y - pb.y, C.bound.z - pb.z);
        C.bound = { x: pb.x, y: pb.y, z: pb.z, r: Math.max(pr, d + C.bound.r), ground: false };
      } else C.bound = { ...pb, ground: G.landLeft <= 0 };
    } else if (!shift) C.bound = boundOf(rec, F);
    else if (C.bound) { C.bound.x += shift[0]; C.bound.y += shift[1]; C.bound.z += shift[2]; }
    pass(C, rec, F, shift, !!rec.brute, 0);
    return C;
  }

  // The per-step uniforms, for either program. A probe runs only the search: every bird visible as it
  // stands and nothing fading.
  function setStep(L, C, rec, F, shift, probe) {
    u1i(L.uN, C.n);
    u1i(L.uFrozen, shift ? 1 : 0);
    u3f(L.uShift, shift ? shift[0] : 0, shift ? shift[1] : 0, shift ? shift[2] : 0);
    u1i(L.uProbe, probe);
    if (probe) {
      u1i(L.uGround, 0);
      u1f(L.uShow, 2); u1f(L.uFadeK, 0);
      u3f(L.uC, rec.cx, rec.cy, rec.cz);
      return;
    }
    if (shift) return;
    u1f(L.uFloorZ, FLOOR_Z);
    const G = rec.ground;
    u1i(L.uGround, G ? 1 : 0);
    if (G) {
      u2f(L.uAnchor, G.anchor[0], G.anchor[1]);
      u1f(L.uGR, G.R);
      u1f(L.uMill, G.mill);
      u2f(L.uMillA, G.millA[0], G.millA[1]);
      u1f(L.uLandLeft, G.landLeft);
      u1f(L.uLift, G.lift);
    }
    u1f(L.uDt, F.dt);
    u1f(L.uSpeed, rec.speed ?? R.speed);
    u1f(L.uSepR, rec.sep ?? R.sepR);
    u1f(L.uTurn, rec.turnG ?? R.turnG);
    u1f(L.uShow, Math.min(1, Math.max(0, rec.show ?? 1)));
    u1f(L.uFadeK, F.dt / Math.max(0.05, rec.showFade ?? R.SHOW_FADE_S));
    u3f(L.uC, rec.cx, rec.cy, rec.cz);
    gl.uniform3fv(L.uCmd, F.cmd);
    u1f(L.uCmdDt, F.cmdDt);
    const Q = F.relay, E = F.env;
    u4f(L.uRelay, Q.latX, Q.latY, Q.halfL, Q.cs);
    u1f(L.uSide, Q.side);
    u4f(L.uEnv, E.aL, E.aW, E.aT, E.tanB);
    u2f(L.uEnvDir, Math.cos(E.psi), Math.sin(E.psi));
    // the speed field: domains about a third of the body across, drifting over a few seconds; the phase
    // is wrapped in double precision so a float32 uniform never loses it
    const tw = ((rec.now / 1000) * 0.35 + (C.c.sd % 97)) % (Math.PI * 2000);
    u2f(L.uNoise, (Math.PI * 3) / (4 * E.aL), tw % (Math.PI * 2));
    u4f(L.uScare, F.scare ? F.scare.x : 0, F.scare ? F.scare.y : 0, F.scareDamp || 0, F.scare ? 1 : 0);
  }

  // One step of the rule over one cloud, from the current state into the other pair of textures.
  // probe 0 is a real step and makes the new state current; a probe writes the search's answer there
  // instead and leaves the flock where it was. `brute` (the bench's reference) searches every bird by
  // brute force.
  function pass(C, rec, F, shift, brute, probe) {
    const src = C.cur, dst = 1 - C.cur;
    const bind = (unit, target, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t); };
    // The grid's origin: the flock centre, rounded to a whole cell so the numbers stay small.
    const H = Math.max(1e-3, (rec.cellK ?? GRID_K) * rec.spread / Math.cbrt(C.n)), inv = 1 / H;
    const gx = Math.round(rec.cx * inv) * H, gy = Math.round(rec.cy * inv) * H, gz = Math.round(rec.cz * inv) * H;
    gl.bindVertexArray(vao);

    // ── 1. file the birds into the grid, one layer of each slot per pass ──
    // ⚠ NOT ON THE GROUND: a landed flock searches for nobody, so filing it would be the whole cost of
    // the grid for nothing.
    // ⚠ AND ONLY AS MANY LAYERS AS THE FLOCK FILLS. A 1,700-bird cloud never puts more than six birds in
    // a cell and a 20,000-bird one puts up to two dozen, so a fixed twelve was half wasted on one and
    // short on the other. Each cloud asks the GPU, with an occlusion query on its LAST layer, whether
    // anything was filed there: if so it files two more next frame, if not one fewer. A frame that
    // files too few is still correct — a bird that reads a full last layer is unsettled and takes last
    // frame's neighbours (see the search) — it is just a frame with more unsettled birds.
    const layers = brute ? 0 : Math.max(LAYERS_MIN, Math.min(LAYERS, C.layers));
    if (!shift && !brute && !(rec.ground && !probe)) {
      if (C.lq && C.lqLayer >= 0 && gl.getQueryParameter(C.lq, gl.QUERY_RESULT_AVAILABLE)) {
        const used = gl.getQueryParameter(C.lq, gl.QUERY_RESULT);
        C.layers = used ? Math.min(LAYERS, C.lqLayer + 3) : Math.max(LAYERS_MIN, C.lqLayer);
        C.lqLayer = -1;
      }
      gl.useProgram(fileProg);
      gl.viewport(0, 0, GW, GH);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      bind(UNIT0, gl.TEXTURE_2D, C.tex[src * 2]);
      bind(UNIT0 + 1, gl.TEXTURE_2D, C.tex[src * 2 + 1]);
      u1i(floc.uN, C.n);
      u3f(floc.uGO, gx, gy, gz);
      u1f(floc.uInvH, inv);
      gl.activeTexture(gl.TEXTURE0 + UNIT0 + 4);
      const ask = !probe && C.lqLayer < 0;
      for (let k = 0; k < layers; k++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, grid.fbo[k]);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.bindTexture(gl.TEXTURE_2D, grid.prev[(k + 1) & 1]);
        u1i(floc.uLayer, k);
        const q = ask && k === layers - 1;
        if (q) { if (!C.lq) C.lq = gl.createQuery(); gl.beginQuery(occlusion, C.lq); }
        gl.drawArrays(gl.POINTS, 0, C.n);
        if (q) { gl.endQuery(occlusion); C.lqLayer = k; }
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.disable(gl.DEPTH_TEST);
    }
    // ── 2. the step ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, C.fbo[dst]);
    gl.viewport(0, 0, W, C.H);
    gl.useProgram(prog);
    bind(UNIT0, gl.TEXTURE_2D, C.tex[src * 2]);
    bind(UNIT0 + 1, gl.TEXTURE_2D, C.tex[src * 2 + 1]);
    bind(UNIT0 + 2, gl.TEXTURE_2D, C.stat0);
    bind(UNIT0 + 3, gl.TEXTURE_2D, C.stat1);
    bind(UNIT0 + 4, gl.TEXTURE_2D_ARRAY, grid.arr);
    bind(UNIT0 + 5, gl.TEXTURE_2D, C.nb[src * 2]);
    bind(UNIT0 + 6, gl.TEXTURE_2D, C.nb[src * 2 + 1]);
    bind(UNIT0 + 7, gl.TEXTURE_2D, C.stat2);
    bind(UNIT0 + 8, gl.TEXTURE_2D, C.stat3);
    u3f(loc.uGO, gx, gy, gz);
    u1f(loc.uInvH, inv);
    u1f(loc.uH, H);
    u1i(loc.uRMax, rec.rMax ?? GRID_R);
    u1i(loc.uLayers, layers);
    u1i(loc.uBrute, brute ? 1 : 0);
    setStep(loc, C, rec, F, shift, probe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // the grid array is a render target in the next cloud's filing: never leave it bound for sampling
    gl.activeTexture(gl.TEXTURE0 + UNIT0 + 4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    if (!probe) C.cur = dst;
  }

  /**
   * THE SEVEN NEIGHBOURS EVERY BIRD WOULD STEER BY, read back — through the grid, or by brute force.
   * ⚠ FOR BENCHES ONLY (readPixels). This is how the grid is checked against brute force: the same
   * flock, the same instant, both searches, every list compared. Comparing two FLOCKS instead does not
   * work, because a hair of rounding between two code paths is amplified by the flock into total
   * divergence within a dozen frames whether or not the searches agree.
   * Returns { idx, d2, cnt, unsettled }: per bird, K indices (-1 = none), their squared distances, how
   * many were found, and whether the grid could not prove its answer.
   */
  function probe(key, rec, brute) {
    const C = clouds.get(key);
    if (!C || C.bad) return null;
    const read = (mode) => {
      withState(() => pass(C, rec, null, null, brute, mode));
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
    return { pos: C.tex[C.cur * 2], vel: C.tex[C.cur * 2 + 1], stat0: C.stat0, stat2: C.stat2, n: C.n, W, bound: C.bound };
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
    ok, step, stepAll, sweep, state, readback, probe,
    get clouds() { return clouds.size; },
    get birds() { let n = 0; for (const C of clouds.values()) n += C.n; return n; },
  };
}
