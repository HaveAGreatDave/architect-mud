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
//   WHY A WRAPPED TABLE, NOT A BOX: the cells are wrapped into a fixed table (GW x GH slots), so the grid has no
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
// cloud to a formation it had never flown. On a ledge or a wire it is still this flock, in PERCH MODE:
// windshield.js hands over each bird's spot on the perch (the per-bird path's own seating), baked once
// per landing (bakePerch), and how far each wire hangs under the birds on it now (uSag).
//
// ⚠ THERE IS NO CPU FALLBACK IN THE GAME (decided 2026-09-23). A machine that cannot render to a
// float texture draws no murmuration at all.
import { flockFrame, seedPoints, scatterOf, MURMUR_RULES as R, MURMUR_MEASURED, WAVE_GROUPS, WAVE_JITTER, TRICKLE_POW } from '../murmur.js';

const W = 64;                       // birds per texture row
const UNIT0 = 8;                    // texture units 8-16: no other layer binds these during the sim
const FLOOR_Z = 0.33 * R.TILE_PER_M;   // the lowest an airborne starling flies, 0.33 m
const IDLE_EVICT_MS = 4000;         // murmur.js's own eviction rule, for the same reason
// Landing: the shortest time a bird is given to reach its ground spot (s), and the fastest it may travel
// doing so (18 m/s, a starling's own flight speed, as a GLSL literal in tiles/s), so none is ever placed
// there in a jump.
const LAND_TAU = '0.45', LAND_VMAX = (18 * R.TILE_PER_M).toFixed(4);
// ⚠ A PARTY IS NOT ALWAYS ONE BODY (rec.loose, 0..1, from windshield.js): for a spell its birds give up
// LOOSE_ALIGN of their heading-matching, wander up to LOOSE_WANDER times further on their own (some much
// more than others), keep LOOSE_SEP more room and may stray LOOSE_ROOST further from the centre before
// the roost pulls them in. A feeding party of starlings goes like that between bouts of flying as one.
const LOOSE_ALIGN = 0.6, LOOSE_WANDER = 4.0, LOOSE_SEP = 1.0, LOOSE_ROOST = 1.5;
// How long a bird whose turn to land has come takes to swing onto its line in (seconds).
const LAND_TURN = '0.35';
const NO_SAG = new Float32Array(8);
const MAX_CLOUDS = 12;
// ⚠ A BIG CLOUD IS STEPPED EVERY 2ND OR 3RD FRAME AND DRAWN BETWEEN ITS LAST TWO STEPS (gl/fauna.js,
// uLerp), so the flock is drawn one step behind itself. Each cloud takes its own phase, so two big roosts
// in one sky do not step on the same frame. rec.stride overrides all of it (the benches pin 1).
// ⚠ THE STRIDE COMES FROM THE GPU'S OWN CLOCK, NOT FROM THE BIRD COUNT. A step is 3 ms at 80,000 birds
// and 17 at 300,000 on an RTX 2070 SUPER, and an integrated GPU is several times slower, so a fixed count
// is right for one machine only. Each cloud's steps are timed with EXT_disjoint_timer_query_webgl2 and
// the stride is the fewest steps that keep its average cost under STEP_BUDGET_MS a frame, with
// hysteresis so it does not flip on noise. Until a measurement arrives, or with no timer extension
// (Firefox often has none), a cloud over STRIDE_FROM birds takes stride 2.
// ⚠ AT MOST 3: at 60 fps that is a 50 ms step, which is DT_MAX in murmur.js; past it the flock would
// fly slower rather than cost less. What a stride of 3 cannot afford, the frame-time thinning
// (FAUNA_SHOW, RENDER_TUNE.murmurFloor) has to.
export const STRIDE_FROM = 120000;
// ⚠ THE FREE RULES (StarDisplay, not a body). on 0 is the enveloped flock as it shipped. cmd scales the relayed
// course, roost is the pull past roostR body-lengths, alt the pull past band body-thicknesses of height, edge
// how much stronger cohesion is on the rim. rec.free overrides any of them.
// Obstacle avoidance: how far ahead a bird looks (seconds of flight), how close to a roof it lets itself
// get (tiles) and how hard it climbs away.
const OBS_LOOK_S = 0.8, OBS_MARGIN = 0.6, OBS_W = 14.0;
// How often a side of the flock peels off, and for how long (seconds); `split` in FREE_RULES is how hard.
const SPLIT_EVERY = 17, SPLIT_FOR = 6;
// wander 0.15 -> 0.25 and spin 0.5 -> 0.7 (2026-09-25), with the roost pulled in (birds.js roam): the
// body shifts and rolls more inside the smaller ground it now covers.
export const FREE_RULES = { on: 1, cmd: 0.0, roost: 3.0, alt: 0.8, roostR: 0.6, band: 1.2, edge: 3.0, wander: 0.25, spin: 0.7, split: 4.0 };
export const STEP_BUDGET_MS = 6;
// ⚠ AND NEVER BELOW THIS MANY BIRDS. A timer query on a GPU that is also drawing a city is noisy: one
// 20,000-bird cloud read 2.2, 4.4 and 8.4 ms in three runs against 1.5 back to back. That noise may push a
// grand roost a stride higher, which costs a little lag, but an ordinary murmuration of 450-1,700 must never
// be drawn a step behind itself because the clock hiccupped.
export const STRIDE_MIN = 10000;
export const STRIDE_MAX = 3;
// The grid: GW x GH slots, LAYERS birds a slot, shared by every cloud, because a cloud's grid is built
// and used inside its own step and nothing needs it afterwards.
// ⚠ THE SLOT IS THE CELL WRAPPED, NOT HASHED (2026-09-24). A cell's x and y wrap at 2^GRID_XB and its z at
// 2^GRID_ZB, and the z bits are spread over the texture in 2^GRID_XB-square tiles, so the cells one bird
// searches sit in neighbouring texels and share cache lines. The XOR hash this replaced scattered
// them across the whole table: every one of the ~125 cells a search reads was a cache miss, which is
// why the step grew much faster than the flock — 3.2 ms at 80,000 and 65 at 300,000, with the grid
// NOT overfull (a 4x table measured 49). Wrapped: 2.1 and 27 on the same card, same neighbours.
// Wrapping still puts two cells in one slot (a flock more than 2^GRID_XB cells across meets itself), and
// the search's own-cell check skips the strangers exactly as it did under the hash.
// ⚠ 256 x 256 x 16 cells on 8 layers, not 128 x 128 x 32 on 16: the same 32 MB, and a 300,000-bird body
// (~173 cells long) no longer wraps onto itself in plan. Measured 14.0 ms against 19.6 at 300k and 2.5
// against 2.7 at 80k, with identical unsettled counts; 16 layers on the wide table cost 15.2.
const GRID_XB = 8, GRID_ZB = 4;
const GRID_XW = 1 << GRID_XB;
const GRID_ZX = (GRID_ZB + 1) >> 1, GRID_ZY = GRID_ZB >> 1;
const GW = GRID_XW << GRID_ZX, GH = GRID_XW << GRID_ZY, LAYERS = 8, LAYERS_MIN = 4;
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
  int x = c.x & ${GRID_XW - 1}, y = c.y & ${GRID_XW - 1}, z = c.z & ${(1 << GRID_ZB) - 1};
  return (x + (z & ${(1 << GRID_ZX) - 1}) * ${GRID_XW}) + (y + (z >> ${GRID_ZX}) * ${GRID_XW}) * ${GW};
}`;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ── WHERE THE FLOCK IS: 1,024 birds spread evenly through the index, positions on rows 0-31 and
// velocities on rows 32-63, read back asynchronously for the centre pull (see sample() below) ──
const FRAG_SAMPLE = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uPos;
uniform highp sampler2D uVel;
uniform int uN;
out vec4 o;
void main() {
  ivec2 f = ivec2(gl_FragCoord.xy);
  int s = (f.y & 31) * 32 + f.x;
  int i = min(uN - 1, int(float(s) * float(uN) / 1024.0));
  ivec2 t = ivec2(i % ${W}, i / ${W});
  o = f.y < 32 ? texelFetch(uPos, t, 0) : texelFetch(uVel, t, 0);
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
uniform vec4 uAc0;                 // the nearest aircraft: position, live
uniform vec4 uAcV0;                // …its velocity, tiles/s
uniform vec4 uAc1;                 // the second nearest
uniform vec4 uAcV1;
uniform vec4 uFree;                // the free rules (FREE_RULES): on, course weight, roost pull, height pull
uniform vec4 uWave;                // the flock taking off or coming down in waves: mode (0 none, 1 up, 2 down), seconds into it, spread, each bird's settle
uniform float uTrickle;            // 1: one bird at a time rather than in waves (waveTurn)
uniform float uLoose;              // 0..1: how far a party has come apart into birds just now (looseOf in windshield.js)
uniform int uPerch;                // 1: the flock is down on ledges or wires, each bird's spot baked in uStat4/5
uniform float uSag[8];             // how far each of those ledges hangs at the middle now, in tiles (a loaded wire)
uniform highp sampler2D uStat4;    // on a perch: x, y, the ledge's or cable's height, place along a wire (-1..1)
uniform highp sampler2D uStat5;    // on a perch: heading, which ledge (into uSag)
uniform float uAirZ;               // the height a bird still waiting to come down holds
uniform vec4 uSplit;               // a side of the flock peeling off: direction (x, y), strength, reach (tiles)
uniform vec4 uCent;                // the flock's measured centre of mass (xyz), 1 when there is one
uniform float uSpin;               // how far a bird's bank is pulled to its neighbours' (free rules)
uniform vec4 uFree2;               // roost radius (tiles), edge cohesion gain, height band half-width (tiles), wander
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
uniform highp sampler2D uObsT;     // the solid height under each texel round the roost: roofs and the Curtain
uniform vec4 uObs;                 // its origin (x, y), texels per tile, size in texels (0: none)
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
// how high the solid thing under a point is (0 off the map or with no map)
float obsH(vec2 xy) {
  if (uObs.w < 0.5) return 0.0;
  vec2 uv = (xy - uObs.xy) * uObs.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= uObs.w || uv.y >= uObs.w) return 0.0;
  return texelFetch(uObsT, ivec2(uv), 0).r;
}
${HASH}
vec3 murmurAcFlee(vec3 p, vec4 a, vec4 av) {
  if (a.w < 0.5) return vec3(0.0);
  vec3 r = p - a.xyz, vv = av.xyz;
  float v2 = dot(vv, vv);
  if (v2 < 1e-6) return vec3(0.0);
  float dist = length(r);
  if (dist > ${f(R.AC_DETECT)}) return vec3(0.0);
  float tc = dot(r, vv) / v2;
  if (tc < -0.4) return vec3(0.0);                  // it has gone by
  vec3 w = r - vv * max(tc, 0.0);                   // off the line it is flying
  float wl = length(w.xy);
  vec2 dir = wl > 1e-4 ? w.xy / wl : normalize(vec2(-vv.y, vv.x) + 1e-5);
  float k = exp(-(wl / ${f(R.AC_LANE)}) * (wl / ${f(R.AC_LANE)})) * smoothstep(${f(R.AC_DETECT)}, ${f(R.AC_DETECT)} * 0.35, dist);
  return vec3(dir * k * 1.4, -0.6 * k);
}

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
    // ⚠ BESIDE A NEIGHBOUR IN MEMORY, NOT AT A RANDOM POINT IN THE BODY. seedPoints lays the birds out in
    // space order, and that order is what keeps the step's reads in cache; a bird coming back at its
    // scatter point lands among strangers, and one thinning episode at 300,000 birds took a step from
    // 12 ms to 20. The nearest visible slot on either side is a bird that was beside this one, so the
    // returning bird joins it, a separation radius off, flying its course. None in reach: the scatter point.
    // ⚠ AND OF THOSE, THE ONE NEAREST WHERE THE FLOCK REALLY IS (uCent, measured). A free flock mixes more
    // than an enveloped one, so a bird's memory neighbour is sometimes a straggler, and joining it put a
    // returning bird at nearly twice the body's extent from its middle. Without a measurement, the first found.
    bool placed = false;
    float best = 1e30;
    for (int d = 1; d <= 6; d++) {
      for (int sg = -1; sg <= 1; sg += 2) {
        int j = i + d * sg;
        if (j < 0 || j >= uN) continue;
        vec4 Vj = texelFetch(uVel, at(j), 0);
        if (Vj.w <= 0.5) continue;
        vec3 qj = texelFetch(uPos, at(j), 0).xyz;
        float dj = uCent.w > 0.5 ? dot(qj - uCent.xyz, qj - uCent.xyz) : float(d);
        if (dj < best) { best = dj; p = qj + S1.xyz * uSepR; v = Vj.xyz; placed = true; }
      }
    }
    if (!placed) {
      // and with nobody in reach, inside the body round where the flock is, not round a centre it has left
      // (a free flock is smaller than the old body, whose scatter put a returning bird well outside it)
      p = uFree.x > 0.5 && uCent.w > 0.5 ? uCent.xyz + S1.xyz * uSepR * 4.0
        : uC + vec3(L * (S1.x * uEnv.x * ${f(R.ENV_IN)}) + Wd * (S1.y * uEnv.y * ${f(R.ENV_IN)}), S1.z * uEnv.z * ${f(R.ENV_IN)});
      float c0 = length(uCmd[0]);
      v = c0 > 1e-3 ? uCmd[0] / c0 * uSpeed : vec3(uSpeed, 0.0, 0.0);
    }
  }
  if (vis <= 0.0) ${emit('vec4(p, P.w)', 'vec4(v, vis)', true)}

  // ⚠ ON THE GROUND THERE IS NO FLOCKING: every bird goes to its own spot, the way groundSpot places it,
  // and gets there exactly when the landing window closes, so the flock comes down continuously from
  // wherever the cloud left each bird. The velocity is what the bird moved, so the draw faces it the
  // way it is walking, and a take-off hands the flocking a bird already moving.
  // ⚠ A FLOCK TAKES OFF AND COMES DOWN IN WAVES, NOT ALL AT ONCE. Real starlings pour into a roost group
  // after group, and lift off the same way. Each bird's turn comes off its rank (four waves with a little
  // jitter), so going up the rest keep walking until theirs, and coming down the rest keep wheeling overhead.
  // Drawing only: the shared flock is down or up exactly when it always was.
  float myT = (uTrickle > 0.5 ? pow(S0.z, ${f(TRICKLE_POW)})
    : floor(S0.z * ${f(WAVE_GROUPS)}) / ${f(WAVE_GROUPS)} * ${f(1 - WAVE_JITTER)} + fract(S0.z * 7.13) * ${f(WAVE_JITTER)}) * uWave.z;
  bool waiting = uWave.y < myT;
  bool walk = uGround == 1 ? !(uWave.x > 1.5 && waiting) : (uWave.x > 0.5 && uWave.x < 1.5 && waiting);
  if (walk) {
    vec3 tgt;
    if (uPerch == 1) {
      // ⚠ ON A LEDGE OR A WIRE THE SPOT IS BAKED, and a wire's sags by the weight on it now, which is how
      // many birds have landed: the cable bends as the party comes down onto it, one bird at a time.
      vec4 Q = texelFetch(uStat4, me, 0);
      int k = clamp(int(texelFetch(uStat5, me, 0).y + 0.5), 0, 7);
      tgt = vec3(Q.xy, Q.z - uSag[k] * (1.0 - Q.w * Q.w));
    } else {
      vec4 G0 = texelFetch(uStat2, me, 0), G1 = texelFetch(uStat3, me, 0);
      float gr = uGR * G0.z;
      vec2 spot = uAnchor + vec2(G0.x * gr + G1.x, G0.y * gr + G1.y)
                + vec2(cos(uMillA.x + G0.w * 6.283185307), sin(uMillA.y + G1.z * 6.283185307)) * uMill;
      tgt = vec3(spot, uGround == 1 ? uLift : 0.0);
    }
    // coming down, each bird has its own deadline, its turn plus the settle; otherwise the flock's
    float LL = uWave.x > 1.5 ? max(0.0, myT + uWave.w - uWave.y) : (uGround == 1 ? uLandLeft : 0.0);
    // ⚠ A BIRD IS NEVER PLACED ON ITS SPOT, IT FLIES THERE. With no landing time left this was 'np = tgt',
    // so any bird that reached the ground branch late (a flock landing without a wave, a window that ran
    // out before it arrived) teleported onto its spot. Now the remaining time is floored at LAND_TAU and
    // each step is capped at a starling's own speed, so every bird comes in on its own path and settles;
    // once down, the same easing is what carries it round the slow mill, so nothing changes there.
    vec3 dp = (tgt - p) * min(1.0, uDt / max(LL, ${LAND_TAU}));
    // ⚠ AND IT TURNS ONTO ITS LINE IN, RATHER THAN SNAPPING ONTO IT. The step above is a straight line at
    // constant speed from wherever the bird was the instant its turn came, so a bird wheeling at 10 m/s
    // changed course and speed in one frame. While there is time in hand its velocity is eased toward that
    // line over LAND_TURN seconds, so it banks out of the circle and slows; the line is re-aimed every frame
    // from what is left, so it still arrives on time, and the last LAND_TAU is the easing above.
    if (LL > ${LAND_TAU} && dot(v, v) > 0.0) dp = mix(v * uDt, dp, 1.0 - exp(-uDt / ${LAND_TURN}));
    float dl = length(dp), mx = ${LAND_VMAX} * uDt;
    vec3 np = p + (dl > mx ? dp * (mx / dl) : dp);
    // ⚠ AND IT NEVER DIPS BELOW WHAT IT IS LANDING ON on the way in. A bird still diving when its turn came
    // carried that dive on through the ease and went into the turf (__glMurmurLanding counted 123,789 bird-
    // frames below ground); one coming in from above may not pass under the height it is landing at.
    np.z = max(np.z, min(p.z, tgt.z));
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
  vec3 sep = vec3(0.0), ali = vec3(0.0), coh = vec3(0.0), rim = vec3(0.0);
  float seen = 0.0, spinN = 0.0;
  for (int m = 0; m < K; m++) {
    if (m >= cnt) break;
    ivec2 t = at(nj[m]);
    vec4 Q4 = texelFetch(uPos, t, 0);
    vec3 q = Q4.xyz;
    vec3 vq = texelFetch(uVel, t, 0).xyz;
    float d = sqrt(nd[m]); d = d > 0.0 ? d : 1e-4;
    if (d < uSepR) sep += (p - q) * ((uSepR - d) / uSepR / d);
    // ⚠ THE BLIND SECTOR BEHIND: a neighbour there is avoided and never followed (StarDisplay's 2 x 45°)
    if (dot((q - p) / d, fwd) < ${f(R.blindCos)}) continue;
    ali += vq; coh += q; seen += 1.0; rim += (q - p) / d; spinN += Q4.w;
  }
  if (seen > 0.0) { ali /= seen; coh = coh / seen - p; }
  // how much of a bird's view is flock on one side only: 0 deep inside, near 1 on the edge. StarDisplay
  // (Hildenbrandt, Carere & Hemelrijk 2010) makes cohesion stronger for such a bird, which is what holds a
  // free flock together without a boundary, and what lets its shape be anything.
  float edge = seen > 0.0 ? length(rim) / seen : 1.0;

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
  float fore = uFree.x > 0.5 ? 0.0 : sign(along) * clamp((abs(along) - ${f(R.ENV_IN)}) / ${f(1 - R.ENV_IN)}, 0.0, 1.5);
  float want = clamp(cl * (1.0 + ${f(R.speedDev)} * nz) * (1.0 - ${f(R.catchK)} * fore), ${f(R.speedLo)}, ${f(R.speedHi)});

  // ⚠ THE BODY: free inside, pushed back over the outer band and harder past the rim, so the edge is
  // denser than the middle. Its plane is sheared by tan(bank) along the course's lateral, so it banks
  // into a turn with the birds in it.
  float ex = dot(q0.xy, L) / uEnv.x, ey = dot(q0.xy, Wd) / uEnv.y, ez = (q0.z + uEnv.w * lat) / uEnv.z;
  float er = sqrt(ex * ex + ey * ey + ez * ez);
  vec3 env = vec3(0.0);
  if (uFree.x < 0.5 && er > ${f(R.ENV_IN)}) {
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
  // ⚠ AN AIRCRAFT IS A SECOND FRIGHT, the hawk's push pointed away from a LINE rather than a point: each
  // bird goes sideways and down off the path the aircraft is flying, once inside the reaction range and
  // until it has passed. Picture only; the server's strike test never samples a murmuration.
  e += murmurAcFlee(p, uAc0, uAcV0) + murmurAcFlee(p, uAc1, uAcV1);
  // ⚠ THE FREE RULES: no body at all. The relayed course becomes a nudge rather than an order, cohesion
  // grows toward the edge, and what keeps the flock over its roost is a pull that starts only past a radius,
  // horizontal, plus a soft band of height round the centre's. Everything inside that is the birds.
  float wCmd = ${f(R.wCmd)}, wCoh = ${f(R.wCoh)};
  // ⚠ A LOOSE SPELL (uLoose, a party's): each bird follows its neighbours' heading less and its own way more,
  // so the flock comes apart into birds for a while; when the spell passes, cohesion and the roost bring it back.
  float wAli = ${f(R.wAli)} * (1.0 - ${f(LOOSE_ALIGN)} * uLoose);
  vec3 home = vec3(0.0);
  if (uFree.x > 0.5) {
    wCmd *= uFree.y;
    wCoh *= 1.0 + uFree2.y * edge * edge;
    vec2 hd = uC.xy - p.xy; float hl = length(hd);
    if (hl > uFree2.x) home.xy = hd / hl * ((hl - uFree2.x) / uFree2.x) * uFree.z;
    float dz = (uGround == 1 ? uAirZ : uC.z) - p.z;
    // ⚠ A SIDE OF THE FLOCK PEELS OFF NOW AND THEN AND COMES BACK (uSplit). The birds on the side facing a
    // bearing are drawn that way for a few seconds; their neighbours follow them, so a chunk breaks away
    // as a sub-flock, and when the pull ends cohesion and the roost bring it home. Chosen by where a bird
    // is rather than by its rank, so what leaves is a piece of the flock and not a random scatter.
    if (uSplit.z > 0.0 && uCent.w > 0.5) {
      float side = dot(p.xy - uCent.xy, uSplit.xy) / max(uSplit.w, 1e-3);
      home.xy += uSplit.xy * uSplit.z * smoothstep(0.05, 0.6, side);
    }
    // a spring, not a band: a band with a dead zone is a floor and a ceiling the birds pile up against,
    // and it drew the flock with a flat top and bottom
    home.z = dz / max(uFree2.z, 1e-3) * uFree.w;
    // each bird's own small wander, slow and smooth, so the flock has something inside it to amplify
    float ph = float(i) * 0.6180339;
    // (in a loose spell some birds go their own way much further than others: the beat offset is a hash per bird)
    float own = 1.0 + uLoose * ${f(LOOSE_WANDER)} * (0.3 + 1.4 * fract(S0.w * 7.31 + 0.17));
    home += vec3(sin(ph * 12.9 + uNoise.y * 2.0), cos(ph * 7.3 + uNoise.y), 0.15 * sin(ph * 5.1 + uNoise.y * 3.0)) * uFree2.w * own;   // whole multiples: uNoise.y wraps at 2 pi
  }
  // ⚠ BUILDINGS AND THE CURTAIN: a bird looks along its course and climbs, and turns down the slope of
  // the height map, when what is ahead is within a margin of its own height. The margin and the look
  // are in tiles and seconds of flight, so a faster bird looks further.
  vec3 avoid = vec3(0.0);
  if (uObs.w > 0.5) {
    vec2 ahead = p.xy + fwd.xy * osp * ${f(OBS_LOOK_S)};
    float h = max(obsH(p.xy), max(obsH(ahead), obsH(mix(p.xy, ahead, 0.5))));
    float gap = p.z - h;
    if (gap < ${f(OBS_MARGIN)}) {
      float k = clamp((${f(OBS_MARGIN)} - gap) / ${f(OBS_MARGIN)}, 0.0, 2.0);
      float eo = 0.5 / uObs.z;
      vec2 gr = vec2(obsH(ahead + vec2(eo, 0.0)) - obsH(ahead - vec2(eo, 0.0)), obsH(ahead + vec2(0.0, eo)) - obsH(ahead - vec2(0.0, eo)));
      float gl = length(gr);
      avoid.z = k * ${f(OBS_W)};
      if (gl > 1e-4) avoid.xy = -gr / gl * k * ${f(OBS_W * 0.8)};
    }
  }
  vec3 acc;
  acc.xy = sep.xy * ${f(R.wSep)} + ali.xy * wAli + coh.xy * wCoh + steer.xy * wCmd + env.xy * ${f(R.wEnv)} + e.xy * ${f(R.wScare)} + home.xy + avoid.xy;
  // ⚠ SEPARATION ACTS IN FULL VERTICALLY; ONLY FOLLOWING NEIGHBOURS IS DAMPED THERE. With the vertical
  // share of all three damped, nothing ever spread the birds apart in height, cohesion slowly pressed them
  // into a sheet, and a flock measured 1 : 12.9 thick-to-wide against the 1 : 2.8 of real ones. The body's
  // own thin axis is what holds it flat now.
  acc.z = sep.z * ${f(R.wSep)} + (ali.z * wAli + coh.z * wCoh) * (uFree.x > 0.5 ? 1.0 : ${f(R.Z_SOFT)})
        + steer.z * wCmd + env.z * ${f(R.wEnv)} + e.z * ${f(R.wScare)} + home.z + avoid.z;
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
  // and never inside a building: what the look-ahead missed is lifted to the roof
  float hNow = obsH(p.xy);
  if (hNow > 0.0 && p.z < hNow + 0.03) { p.z = hNow + 0.03; nv.z = max(nv.z, 0.0); }
  // ⚠ THE BANK IS THE BIRD'S OWN TURN: g tan(bank) = v omega, eased over a tenth of a second so the
  // jostle of separation does not flicker the wing. A turn crossing the flock is a band of banked birds
  // crossing it, and the draw shades each by how much wing it shows the camera.
  float yaw = length(v.xy) > 1e-6 && length(nv.xy) > 1e-6 ? atan(v.x * nv.y - v.y * nv.x, dot(v.xy, nv.xy)) : 0.0;
  float bank = clamp(atan(want * yaw / uDt / ${f(R.G_TILES)}), ${f(-R.rollMax)}, ${f(R.rollMax)});
  // ⚠ A BIRD MATCHES ITS NEIGHBOURS' TURNING, NOT ONLY THEIR HEADING (the inertial spin model: Attanasi
  // et al., Nature Physics 2014, who filmed turns crossing real flocks at 20-40 m/s). The bank is a bird's
  // turn rate, so under the free rules it is pulled toward the mean bank of the neighbours it follows; it
  // is what makes a turn cross the flock as a band now that the shared relayed course is gone.
  if (uFree.x > 0.5 && seen > 0.0) bank = mix(bank, spinN / seen, uSpin);
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
  'uShow', 'uFadeK', 'uC', 'uCmd', 'uCmdDt', 'uRelay', 'uSide', 'uEnv', 'uEnvDir', 'uNoise', 'uScare', 'uAc0', 'uAcV0', 'uAc1', 'uAcV1', 'uShift', 'uFrozen', 'uProbe',
  'uFree', 'uFree2', 'uStat2', 'uStat3', 'uGround', 'uAnchor', 'uGR', 'uMill', 'uMillA', 'uLandLeft', 'uLift', 'uFloorZ', 'uObsT', 'uObs', 'uSpin', 'uCent', 'uWave', 'uAirZ', 'uSplit', 'uTrickle', 'uLoose', 'uPerch', 'uSag', 'uStat4', 'uStat5'];

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
  let prog = null, loc = null, vao = null, fileProg = null, floc = null, grid = null, occlusion = 0, sampProg = null, sloc = null;
  const clouds = new Map();
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  function build() {
    const u = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    prog = link(gl, VERT, FRAG, 'step');
    loc = u(prog, [...STEP_UNIFORMS, 'uGrid', 'uGO', 'uInvH', 'uH', 'uRMax', 'uNbrA', 'uNbrB', 'uBrute', 'uLayers']);
    fileProg = link(gl, VERT_FILE, FRAG_FILE, 'grid');
    floc = u(fileProg, ['uPos', 'uVel', 'uN', 'uGO', 'uInvH', 'uPrev', 'uLayer']);
    sampProg = link(gl, VERT, FRAG_SAMPLE, 'sample');
    sloc = u(sampProg, ['uPos', 'uVel', 'uN']);
    vao = gl.createVertexArray();
    // ⚠ EVERY SAMPLER HAS ONE UNIT FOR THE LIFE OF THE PROGRAM, SO IT IS TOLD ONCE. Re-sending the unit
    // with every bind was a uniform1i per texture per pass per cloud — over two hundred GL calls a frame
    // with a roost in view, each one costing the frame about as much as a draw.
    gl.useProgram(prog);
    const units = { uPos: 0, uVel: 1, uStat0: 2, uStat1: 3, uGrid: 4, uNbrA: 5, uNbrB: 6, uStat2: 7, uStat3: 8, uObsT: 9, uStat4: 10, uStat5: 11 };
    for (const [n, k] of Object.entries(units)) u1i(loc[n], UNIT0 + k);
    gl.useProgram(fileProg);
    u1i(floc.uPos, UNIT0); u1i(floc.uVel, UNIT0 + 1); u1i(floc.uPrev, UNIT0 + 4);
    gl.useProgram(sampProg);
    u1i(sloc.uPos, UNIT0); u1i(sloc.uVel, UNIT0 + 1);
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
      // where each bird stands on a ledge or wire, baked by bakePerch when the flock comes down on one
      stat4: tex(W, H, new Float32Array(W * H * 4)), stat5: tex(W, H, new Float32Array(W * H * 4)), perchKey: null,
      c: { last: null, seen: rec.now, sd },
      bound: null,
      // how many grid layers this cloud files, and the query that says whether its last one was used
      layers: LAYERS, lq: null, lqLayer: -1,
      // the stride's phase, off the key so two clouds do not step together; when it last stepped, and how far apart
      tick: sd % 6, stepAt: null, stepGap: 0, stride: 0,
      tq: null, tqBusy: false, tqSeen: 0, stepMs: null,
      bad: !fbo[0] || !fbo[1],
    };
    clouds.set(rec.key, C);
    return C;
  }

  // Copy the first min(n) birds' position and velocity, in both ping-pong buffers, from one cloud to its
  // resized replacement. Birds beyond the old count keep their seedPoints start (round the current
  // centre), so a flock that grows gains birds inside its own body. Copied by whole rows plus the
  // partial last row, because a row slot past the old count holds nothing and would land a bird at 0,0,0.
  function carryOver(from, to) {
    if (from.bad || to.bad) return;
    const m = Math.min(from.n, to.n), full = Math.floor(m / W), rest = m % W;
    const rf = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    for (let k = 0; k < 2; k++) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.fbo[k]);
      for (let a = 0; a < 2; a++) {
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + a);
        gl.activeTexture(gl.TEXTURE0 + UNIT0);
        gl.bindTexture(gl.TEXTURE_2D, to.tex[k * 2 + a]);
        if (full) gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, full);
        if (rest) gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, full, 0, full, rest, 1);
      }
    }
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rf);
    to.cur = from.cur;
    to.c = { ...from.c, sd: to.c.sd };
    to.tick = from.tick; to.stepAt = from.stepAt; to.stepGap = from.stepGap; to.costK = from.costK;
  }

  function drop(C) {
    MURMUR_MEASURED.delete(C.key);
    if (C.lq) gl.deleteQuery(C.lq);
    if (C.tq) gl.deleteQuery(C.tq);
    if (C.obsTex) gl.deleteTexture(C.obsTex);
    if (C.sTex) { gl.deleteTexture(C.sTex); gl.deleteFramebuffer(C.sFbo); gl.deleteBuffer(C.sPbo); }
    if (C.sFence) gl.deleteSync(C.sFence);
    for (const t of [...C.tex, ...C.nb]) gl.deleteTexture(t);
    gl.deleteTexture(C.stat0); gl.deleteTexture(C.stat1); gl.deleteTexture(C.stat2); gl.deleteTexture(C.stat3);
    gl.deleteTexture(C.stat4); gl.deleteTexture(C.stat5);
    for (const fb of C.fbo) if (fb) gl.deleteFramebuffer(fb);
    clouds.delete(C.key);
  }

  // ⚠ WHERE THE FLOCK CAN BE, FOR THE DRAW'S BENEFIT: a sphere round the centre that holds the body with
  // room for the birds that stray past its rim. gl/fauna.js uses it to skip the detail levels no bird in this
  // cloud can be close enough to earn — at 20,000 birds a full-mesh pass over every bird is millions
  // of vertices for a cloud that is a grey smudge. A bird outside the sphere is clamped to the nearest
  // level that IS drawn, never lost.
  function boundOf(rec, F, C) {
    // ⚠ A FREE FLOCK IS NOT HELD TO ITS CENTRE: it wanders up to the roost radius off it before the pull
    // takes hold, and stretches past its body. Sized for the envelope, this sphere culled the far end of it.
    const Fr = { ...FREE_RULES, ...(rec.free || {}) };
    const k = Fr.on ? 1.35 + Fr.roostR + 0.8 : 1.35;
    const at = Fr.on && C && C.cent ? C.cent : { x: rec.cx, y: rec.cy, z: rec.cz };
    return { x: at.x, y: at.y, z: at.z, r: F.env.aL * k + 0.3 };
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
  // ⚠ WHERE THE FLOCK REALLY IS, measured rather than assumed. Under the free rules the birds are not held
  // to the shared centre, so the step samples 1,024 of them into a small target and reads it back through a
  // pixel buffer and a fence: asynchronous, a few frames late, which is fine for a spring. Nothing waits.
  function sample(C, rec) {
    C.sRC = [rec.cx, rec.cy, rec.cz];   // the shared centre when this sample was taken, for its offset
    if (!C.sTex) {
      C.sTex = tex(32, 64, null);
      C.sFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, C.sFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, C.sTex, 0);
      C.sPbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, C.sPbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 32 * 64 * 16, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      C.sBuf = new Float32Array(32 * 64 * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, C.sFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, 32, 64);
    gl.useProgram(sampProg);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0 + UNIT0); gl.bindTexture(gl.TEXTURE_2D, C.tex[C.cur * 2]);
    gl.activeTexture(gl.TEXTURE0 + UNIT0 + 1); gl.bindTexture(gl.TEXTURE_2D, C.tex[C.cur * 2 + 1]);
    u1i(sloc.uN, C.n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, C.sPbo);
    gl.readPixels(0, 0, 32, 64, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    C.sFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();   // a fence that is never flushed never signals, and clientWaitSync with no flags does not flush it
  }
  function readSample(C) {
    if (!C.sFence) return;
    const st = gl.clientWaitSync(C.sFence, 0, 0);
    if (st === gl.TIMEOUT_EXPIRED || st === gl.WAIT_FAILED) return;
    gl.deleteSync(C.sFence); C.sFence = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, C.sPbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, C.sBuf);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const B = C.sBuf, half = 32 * 32 * 4;
    let x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, m = 0;
    for (let o = 0; o < half; o += 4) {
      if (!(B[half + o + 3] > 0)) continue;
      x += B[o]; y += B[o + 1]; z += B[o + 2]; vx += B[half + o]; vy += B[half + o + 1]; vz += B[half + o + 2]; m++;
    }
    if (m) {
      C.cent = { x: x / m, y: y / m, z: z / m, vx: vx / m, vy: vy / m, vz: vz / m };
      if (C.sRC) MURMUR_MEASURED.set(C.key, { dx: C.cent.x - C.sRC[0], dy: C.cent.y - C.sRC[1], dz: C.cent.z - C.sRC[2] });
    }
  }

  // ⚠ WHERE EACH BIRD STANDS ON A LEDGE OR WIRE, from windshield.js (perch.parts(i): x, y, height, place
  // along a wire, heading, which ledge, shuffle phase), uploaded once per landing rather than every frame.
  function bakePerch(C, P) {
    const s4 = new Float32Array(W * C.H * 4), s5 = new Float32Array(W * C.H * 4);
    for (let i = 0; i < C.n; i++) {
      const q = P.parts(i), o = i * 4;
      s4[o] = q[0]; s4[o + 1] = q[1]; s4[o + 2] = q[2]; s4[o + 3] = q[3];
      s5[o] = q[4]; s5[o + 1] = q[5]; s5[o + 2] = q[6];
    }
    gl.activeTexture(gl.TEXTURE0 + UNIT0);
    gl.bindTexture(gl.TEXTURE_2D, C.stat4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, C.H, gl.RGBA, gl.FLOAT, s4);
    gl.bindTexture(gl.TEXTURE_2D, C.stat5);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, C.H, gl.RGBA, gl.FLOAT, s5);
    gl.bindTexture(gl.TEXTURE_2D, null);
    C.perchKey = P.key;
  }

  // The last timed step's cost, once the GPU has it, folded into a running average.
  function readTimer(C) {
    if (!C.tqBusy || !gl.getQueryParameter(C.tq, gl.QUERY_RESULT_AVAILABLE)) return;
    C.tqBusy = false;
    if (gl.getParameter(timer.GPU_DISJOINT_EXT)) return;       // the clock jumped: this one is not a measurement
    const ms = gl.getQueryParameter(C.tq, gl.QUERY_RESULT) / 1e6;
    // ⚠ THE FIRST FEW ARE WARM-UP, NOT COST: the first step of a cloud pays for its textures, the shader's
    // first run and a GPU still at idle clocks, and folded into the average it held a 20,000-bird cloud
    // at 8.9 ms (stride 2) against the 1.5 it really costs.
    if (++C.tqSeen <= 8) return;
    C.stepMs = C.stepMs == null ? ms : C.stepMs * 0.8 + ms * 0.2;
  }
  // The fewest steps a frame that keep this cloud under STEP_BUDGET_MS, moving only when it is clearly
  // over (10%) or clearly under (at 80% with one step fewer), so it does not flip on noise.
  function strideOf(C, rec) {
    if (C.n < STRIDE_MIN) return 1;
    return Math.min(STRIDE_MAX, Math.max(costStride(C), farStride(rec)));
  }
  // ⚠ A ROOST SO FAR OFF THAT A BIRD IS WELL UNDER A DOT IS A SMUDGE, and a smudge a step behind itself
  // looks the same. How big a bird is comes from the draw's own arithmetic (FL x span / distance against
  // the dot threshold, as tierOf in gl/fauna.js reads it), so this can never disagree with what is drawn.
  function farStride(rec) {
    const t = rec.tiers && rec.tiers.thr, e = rec.eye, o = rec.origin;
    if (!t || !e || !o || !rec.FL || !rec.span) return 1;
    const d = Math.hypot(rec.cx - o[0] - e[0], rec.cy - o[1] - e[1], (rec.cz ?? 0) - e[2]);
    const px = (rec.FL * rec.span) / Math.max(d, 1e-3);
    return px < t * 0.25 ? 3 : px < t * 0.5 ? 2 : 1;
  }
  function costStride(C) {
    if (C.stepMs == null) return C.n > STRIDE_FROM ? 2 : 1;
    let k = Math.max(1, C.costK || 1);
    if (C.stepMs / k > STEP_BUDGET_MS * 1.1) k = Math.ceil(C.stepMs / STEP_BUDGET_MS);
    else if (k > 1 && C.stepMs / (k - 1) < STEP_BUDGET_MS * 0.8) k--;
    return (C.costK = Math.min(STRIDE_MAX, k));
  }

  function stepInner(rec) {
    if (!prog) build();
    if (!grid) grid = buildGrid();
    if (!grid.ok) return null;
    let C = clouds.get(rec.key);
    // ⚠ A NEW BIRD COUNT IS A RESIZE, NEVER A RESTART. The count moves when a strike takes birds out
    // of the flock and when the dusk curve grows or shrinks it, and this used to drop the cloud and
    // re-seed it from seedPoints round the centre: the whole formation snapped to a fresh starting
    // shape and flew on from there. The birds that survive the resize keep their state.
    if (C && C.n !== rec.n) { const old = C; C = create(rec); carryOver(old, C); drop(old); clouds.set(rec.key, C); }
    if (!C) C = create(rec);
    if (C.bad) return null;
    C.c.seen = rec.now;
    readTimer(C);
    readSample(C);
    // a flock on a ledge or wire: its spots, baked once per landing (the key changes with the perch)
    const Pp = (rec.ground && rec.ground.perch) || (rec.hold && rec.hold.perch) || null;
    if (Pp && Pp.key !== C.perchKey) bakePerch(C, Pp);
    const stride = rec.brute || rec.ground || rec.frozen ? 1 : (rec.stride ?? strideOf(C, rec));
    C.stride = stride;
    if (stride > 1 && C.stepAt != null && (C.tick = (C.tick + 1) % stride) !== 0) return C;
    const F = flockFrame(C.c, rec.cx, rec.cy, rec.cz, rec.now, rec.spread, { heading: rec.heading, scare: rec.scare, course: rec.course });
    if (!F.dt) return C;
    let shift = null;
    if (rec.frozen) {
      shift = [rec.cx - (C.c.fx ?? rec.cx), rec.cy - (C.c.fy ?? rec.cy), rec.cz - (C.c.fz ?? rec.cz)];
      C.c.fx = rec.cx; C.c.fy = rec.cy; C.c.fz = rec.cz;
      if (!shift[0] && !shift[1] && !shift[2]) return C;
    } else { C.c.fx = rec.cx; C.c.fy = rec.cy; C.c.fz = rec.cz; }
    if (rec.ground) {
      const G = rec.ground, pr = G.perch ? G.perch.box[3] : G.R + G.mill + 0.3;
      const pb = G.perch ? { x: G.perch.box[0], y: G.perch.box[1], z: G.perch.box[2], r: pr } : { x: G.anchor[0], y: G.anchor[1], z: 0, r: pr };
      // still coming down: the sphere that holds where the cloud was and the patch it is going to
      if (G.landLeft > 0 && C.bound && !C.bound.ground) {
        const d = Math.hypot(C.bound.x - pb.x, C.bound.y - pb.y, C.bound.z - pb.z);
        C.bound = { x: pb.x, y: pb.y, z: pb.z, r: Math.max(pr, d + C.bound.r), ground: false };
      } else C.bound = { ...pb, ground: G.landLeft <= 0 };
    } else if (!shift) C.bound = boundOf(rec, F, C);
    else if (C.bound) { C.bound.x += shift[0]; C.bound.y += shift[1]; C.bound.z += shift[2]; }
    // ⚠ NOT WHILE SOMEBODY ELSE'S TIMER IS OPEN. WebGL2 allows one TIME_ELAPSED query at a time: a
    // bench timing the whole frame (__glWhere, __glMurmurGpuFrame) had this begin fail, and then this
    // endQuery closed the BENCH's query mid-frame, and C.tq, never begun, left tqBusy stuck for good.
    // Standing aside holds the last verdict, which is what no measurement already means.
    const time = timer && rec.stride == null && !C.tqBusy && !gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY);
    if (time) { if (!C.tq) C.tq = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, C.tq); }
    pass(C, rec, F, shift, !!rec.brute, 0);
    if (time) { gl.endQuery(timer.TIME_ELAPSED_EXT); C.tqBusy = true; }
    const Fs = rec.free ? { ...FREE_RULES, ...rec.free } : FREE_RULES;
    if (!Fs.on) { C.cent = null; MURMUR_MEASURED.delete(C.key); }
    else if (!rec.ground && !C.sFence && sampProg) sample(C, rec);
    C.stepGap = C.stepAt != null ? rec.now - C.stepAt : 0;
    C.stepAt = rec.now;
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
    const G = rec.ground || rec.hold;
    u1i(L.uGround, rec.ground ? 1 : 0);
    const Wv = rec.wave;
    u4f(L.uWave, Wv ? Wv.mode : 0, Wv ? Wv.t : 0, Wv ? Wv.spread : 0, Wv ? Wv.settle : 0);
    u1f(L.uTrickle, Wv && Wv.trickle ? 1 : 0);
    u1f(L.uAirZ, rec.airZ ?? rec.cz);
    const Pp = G && G.perch;
    u1i(L.uPerch, Pp ? 1 : 0);
    if (L.uSag) gl.uniform1fv(L.uSag, Pp ? Pp.sag : NO_SAG);
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
    const lo = rec.loose || 0;
    u1f(L.uSepR, (rec.sep ?? R.sepR) * (1 + LOOSE_SEP * lo));
    u1f(L.uLoose, lo);
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
    // ⚠ THE STOOP IS AIMED AT THE SHARED CENTRE (falconStoop is a pure function the server also runs), and a
    // free flock is not always there, so the scare is carried by the flock's measured offset from it and lands
    // on the birds rather than on empty sky
    const Fd = { ...FREE_RULES, ...(rec.free || {}) };
    const dx = Fd.on && C.cent ? C.cent.x - rec.cx : 0, dy = Fd.on && C.cent ? C.cent.y - rec.cy : 0;
    u4f(L.uScare, F.scare ? F.scare.x + dx : 0, F.scare ? F.scare.y + dy : 0, F.scareDamp || 0, F.scare ? 1 : 0);
    // the two aircraft nearest this cloud, in world tiles like the birds; no offset, they are really there
    const acs = (rec.aircraft || []).map((a) => [Math.hypot(a.x - rec.cx, a.y - rec.cy), a]).sort((m, q) => m[0] - q[0]);
    for (let k = 0; k < 2; k++) {
      const a = acs[k] && acs[k][0] < R.AC_DETECT * 4 ? acs[k][1] : null;
      u4f(k ? L.uAc1 : L.uAc0, a ? a.x : 0, a ? a.y : 0, a ? a.z : 0, a ? 1 : 0);
      u4f(k ? L.uAcV1 : L.uAcV0, a ? a.vx : 0, a ? a.vy : 0, a ? a.vz : 0, 0);
    }
    const Fr = { ...FREE_RULES, ...(rec.free || {}) };
    // radius and height band scale with the body the flock was sized for, so a roost of 300,000 is not
    // squeezed into the room a party of 450 needs
    u4f(L.uFree, Fr.on ? 1 : 0, Fr.cmd, Fr.roost, Fr.alt);
    u4f(L.uFree2, Fr.roostR * E.aL * (1 + LOOSE_ROOST * lo), Fr.edge * (1 - 0.5 * lo), Fr.band * E.aT, Fr.wander);
    u1f(L.uSpin, Fr.spin ?? 0);
    // the split: every SPLIT_EVERY seconds a side peels off for SPLIT_FOR, on a bearing hashed off the cloud
    // and the cycle so no two roosts split together; only in flight and only with a measured centre
    const Sc = Math.floor(rec.now / 1000 / SPLIT_EVERY), Sph = (rec.now / 1000) % SPLIT_EVERY;
    const Son = Fr.on && Fr.split > 0 && !rec.ground && !(rec.wave && rec.wave.mode) && Sph < SPLIT_FOR;
    const Sb = (((C.c.sd * 0.61803 + Sc * 2.39996) % 1) + 1) % 1 * Math.PI * 2;
    const Sk = Son ? Fr.split * Math.sin(Math.PI * Sph / SPLIT_FOR) : 0;
    u4f(L.uSplit, Math.cos(Sb), Math.sin(Sb), Sk, Fr.roostR * E.aL);
    u4f(L.uCent, C.cent ? C.cent.x : 0, C.cent ? C.cent.y : 0, C.cent ? C.cent.z : 0, C.cent ? 1 : 0);
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
    bind(UNIT0 + 10, gl.TEXTURE_2D, C.stat4);
    bind(UNIT0 + 11, gl.TEXTURE_2D, C.stat5);
    // the height map round the roost, uploaded when windshield.js hands over a new one (it is rebuilt only
    // when the map window moves)
    const O = rec.obst;
    if (O && O !== C.obsSrc) {
      if (!C.obsTex || C.obsN !== O.n) {
        if (C.obsTex) gl.deleteTexture(C.obsTex);
        C.obsTex = gl.createTexture(); C.obsN = O.n;
        gl.activeTexture(gl.TEXTURE0 + UNIT0 + 9); gl.bindTexture(gl.TEXTURE_2D, C.obsTex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, O.n, O.n); nearest(gl.TEXTURE_2D);
      }
      gl.activeTexture(gl.TEXTURE0 + UNIT0 + 9); gl.bindTexture(gl.TEXTURE_2D, C.obsTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, O.n, O.n, gl.RED, gl.FLOAT, O.data);
      C.obsSrc = O;
    }
    const useObs = O && C.obsTex;
    bind(UNIT0 + 9, gl.TEXTURE_2D, useObs ? C.obsTex : null);
    u4f(loc.uObs, useObs ? O.ox : 0, useObs ? O.oy : 0, useObs ? O.per : 1, useObs ? O.n : 0);
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
    const out = { pos: C.tex[C.cur * 2], vel: C.tex[C.cur * 2 + 1], stat0: C.stat0, stat2: C.stat2, stat4: C.stat4, stat5: C.stat5, n: C.n, W, bound: C.bound, stride: C.stride, stepMs: C.stepMs, layers: C.layers, cent: C.cent };
    // a cloud stepped every other frame is drawn between its last two states, one step behind itself
    if (C.stride > 1 && C.stepGap > 0) {
      out.prevPos = C.tex[(1 - C.cur) * 2]; out.prevVel = C.tex[(1 - C.cur) * 2 + 1];
      out.lerp = Math.min(1, Math.max(0, (C.c.seen - C.stepAt) / C.stepGap));
    }
    return out;
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
