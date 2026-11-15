// THE STANDS' FANS: THE BAKE AT BOTH LEVELS, AND THE SHADER'S TABLES THAT READ IT.
//
//   node scripts/shapes/fan-vat.mjs            # gate
//   node scripts/shapes/fan-vat.mjs --report   # the numbers behind it
//
// client/game/js/panels/gl/fan-vat.js bakes every clip of the fan the Coliseum and the rink draw into
// one texture, and gl/crowd.js's FAN_GLSL plays it. A broken bake draws as a stand of shards or of
// nobody, and nothing else looks at it without a GPU, so this does:
//
//   · Both levels: every texel finite, the texture one column a vertex plus the pivot and one row a
//     frame, the triangles indexable and on budget, every vertex's part and group one the shader
//     knows, and the bake inside WebGL2's guaranteed texture size.
//   · Every clip: its rows contiguous and in the texture, the body on the ground in every frame (its
//     lowest point at 0), the head's pivot riding the head, sat clips sat and the rise ending stood,
//     at the heights the far cards (crowd.js CARD_VS) are drawn.
//   · The face: every face part in front of the skull and riding the head bone; the mouth shut when
//     nobody shouts and open when a clip does.
//   · The hands: none of the cut-down body's finger shards left, and a mitt on each wrist.
//   · The tables: every clip FAN_GLSL names is a clip, and every part it's handed is coloured; the
//     normals' packing round-trips; nearCut keeps the near level to NEAR_MAX fans.
import { fanMesh, fanBake, FAN_CLIPS, FAN_ROWS, FAN_PART, FAN_GROUP, FAN_STATIC, FAN_LEVELS, octPack, octUnpack } from '../../client/game/js/panels/gl/fan-vat.js';
import { FAN_GLSL, CARD_VS, nearCut, NEAR_MAX } from '../../client/game/js/panels/gl/crowd.js';
import { FIGURE_BONES } from '../../client/game/js/panels/figure.js';

const REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };
const fail = (m) => problems.push(m);

// [triangles, vertices] a level may cost, a fan
const BUDGET = { far: [800, 600], near: [2200, 1400] };
const BONE = Object.fromEntries(FIGURE_BONES.map((b, i) => [b[0], i]));
const FACE_PARTS = new Set([FAN_PART.white, FAN_PART.iris, FAN_PART.ink, FAN_PART.brow, FAN_PART.lip, FAN_PART.lipLow, FAN_PART.mouth, FAN_PART.shade]);
const parts = new Set(Object.values(FAN_PART)), groups = new Set(Object.values(FAN_GROUP));
const clip = (n) => FAN_CLIPS.find((c) => c.name === n);

for (const level of Object.keys(FAN_LEVELS)) {
  const m = fanMesh(level), b = fanBake(level), { nv, nb, W, H, data, idx } = b;
  report(`${level}: ${nv} vertices (${nb} body), ${b.nt} triangles (${b.bodyTris} body before the mitts), texture ${W} x ${H}, ${(data.byteLength / 1e6).toFixed(2)} MB, baked in ${Math.round(b.ms)} ms`);
  if (b.nt > BUDGET[level][0]) fail(`${level}: ${b.nt} triangles a fan, over its ${BUDGET[level][0]}`);
  if (nv > BUDGET[level][1]) fail(`${level}: ${nv} vertices a fan, over its ${BUDGET[level][1]}`);
  if (W !== nv + 1 || H !== FAN_ROWS || data.length !== W * H * 4) fail(`${level}: the texture is ${W} x ${H} (${data.length / 4} texels), not ${nv + 1} x ${FAN_ROWS}`);
  if (W > 2048 || H > 2048) fail(`${level}: the texture (${W} x ${H}) is past WebGL2's guaranteed 2048`);
  let bad = 0;
  for (const x of data) if (!Number.isFinite(x)) bad++;
  for (const x of b.stat) if (!Number.isFinite(x)) bad++;
  if (bad) fail(`${level}: ${bad} numbers in the bake aren't finite`);
  if (b.stat.length !== nv * FAN_STATIC) fail(`${level}: the static attributes are ${b.stat.length} floats, not ${nv} x ${FAN_STATIC}`);
  let oob = 0;
  for (const i of idx) if (i >= nv) oob++;
  if (oob || idx.length % 3) fail(`${level}: ${oob} indices past the last vertex, or a part triangle`);
  for (let v = 0; v < nv; v++) {
    if (!parts.has(m.part[v]) || !groups.has(m.group[v])) { fail(`${level}: vertex ${v} has part ${m.part[v]} or group ${m.group[v]}, which the shader doesn't know`); break; }
  }

  // the clips' rows
  let row = 0;
  for (const c of FAN_CLIPS) {
    if (c.row0 !== row) fail(`${c.name}: starts on row ${c.row0}, not ${row}`);
    row += c.frames;
  }
  const texel = (r, v) => { const o = (r * W + v) * 4; return [data[o], data[o + 1], data[o + 2], data[o + 3]]; };
  // the body on the ground; the pivot on the head
  const headV = [];
  for (let v = 0; v < nv; v++) if (m.b0[v] === BONE.head && m.b1[v] === BONE.head && m.part[v] === FAN_PART.skin && m.group[v] === FAN_GROUP.all) headV.push(v);
  let floating = 0, offHead = 0, where = '';
  for (const c of FAN_CLIPS) for (let f = 0; f < c.frames; f++) {
    const r = c.row0 + f;
    let lo = Infinity;
    for (let v = 0; v < nb; v++) lo = Math.min(lo, texel(r, v)[1]);
    if (Math.abs(lo) > 1e-3) { floating++; where ||= `${c.name} frame ${f}`; }
    const pv = texel(r, nv);
    let cx = 0, cy = 0, cz = 0;
    for (const v of headV) { const t = texel(r, v); cx += t[0]; cy += t[1]; cz += t[2]; }
    const k = headV.length, d = Math.hypot(cx / k - pv[0], cy / k - pv[1], cz / k - pv[2]);
    if (d > 0.7) { offHead++; where ||= `${c.name} frame ${f}, pivot ${d.toFixed(2)} ft off`; }
  }
  if (floating) fail(`${level}: the body's lowest point is off the ground in ${floating} frames (first ${where})`);
  if (offHead) fail(`${level}: the head's pivot is more than 0.7 ft from the head in ${offHead} frames (first ${where})`);

  // heights: sat, and stood at the end of the rise, against the cards
  const topOf = (r) => { let t = 0; for (const v of headV) t = Math.max(t, texel(r, v)[1]); return t; };
  const sat = topOf(clip('sit').row0), stood = topOf(clip('rise').row0 + clip('rise').frames - 1);
  const card = CARD_VS.match(/mix\(([\d.]+), ([\d.]+), min\(1\.0, k \* 2\.0\)\)/);
  report(`  the top of the head ${sat.toFixed(2)} ft sat and ${stood.toFixed(2)} ft stood; the cards draw ${card ? card.slice(1).join(' and ') : '?'}`);
  if (!(sat > 3.8 && sat < 4.7)) fail(`${level}: a sat fan's head is ${sat.toFixed(2)} ft up, not a seated person's`);
  if (!(stood > 5.3 && stood < 6.2)) fail(`${level}: the rise ends with the head ${stood.toFixed(2)} ft up, not stood`);
  if (!card) fail('crowd.js CARD_VS no longer gives the cards their heights as mix(sat, stood, …); this gate reads them');
  else if (Math.abs(+card[1] - sat) > 0.25 || Math.abs(+card[2] - stood) > 0.25) fail(`the far cards are ${card[1]} ft sat and ${card[2]} ft stood, the figures ${sat.toFixed(2)} and ${stood.toFixed(2)}: a stand drawn part in each would change height at the line`);

  // the face: in front of the skull, on the head bone
  let behind = 0, loose = 0;
  for (let v = 0; v < nv; v++) {
    if (!FACE_PARTS.has(m.part[v])) continue;
    if (m.p[v * 3 + 2] < 0.04) behind++;
    if (m.b0[v] !== BONE.head || m.w[v] !== 1) loose++;
  }
  if (behind) fail(`${level}: ${behind} points of the face are behind its front`);
  if (loose) fail(`${level}: ${loose} points of the face don't ride the head bone alone`);
  // the mouth: shut sat, open shouting. Its inside's top and bottom are laid as two rows of points,
  // so its height is the gap between the highest and lowest of them.
  const mouth = [];
  for (let v = 0; v < nv; v++) if (m.part[v] === FAN_PART.mouth) mouth.push(v);
  const gape = (r) => { let hi = -Infinity, lo = Infinity; for (const v of mouth) { const y = texel(r, v)[1]; hi = Math.max(hi, y); lo = Math.min(lo, y); } return hi - lo; };
  const shut = gape(clip('sit').row0), open = Math.max(...Array.from({ length: clip('cup').frames }, (_, f) => gape(clip('cup').row0 + f)));
  report(`  the mouth ${(shut * 12).toFixed(2)} in. sat, ${(open * 12).toFixed(2)} in. at most shouting through the hands`);
  if (!mouth.length) fail(`${level}: the face has no mouth`);
  else {
    if (shut > 0.012) fail(`${level}: a sat fan's mouth is open ${(shut * 12).toFixed(2)} in.`);
    if (open < 0.025) fail(`${level}: the shouting fan's mouth opens only ${(open * 12).toFixed(2)} in.`);
  }

  // the hands: no finger shards, a mitt on each wrist
  const hand = new Set([BONE.handL, BONE.handR]);
  let shards = 0;
  for (let t = 0; t < idx.length; t += 3) if ([0, 1, 2].every((j) => { const v = idx[t + j]; return v < nb && hand.has(m.b0[v]) && (hand.has(m.b1[v]) || m.w[v] > 0.5); })) shards++;
  if (shards) fail(`${level}: ${shards} of the body's own hand triangles are left, the fingers that read as claws`);
  for (const side of ['L', 'R']) {
    let mitt = 0;
    for (let v = nb; v < nv; v++) if (m.b0[v] === BONE['hand' + side] && m.part[v] === FAN_PART.skin) mitt++;
    if (mitt < 8) fail(`${level}: the ${side === 'L' ? 'left' : 'right'} hand has no mitt (${mitt} points on the hand bone past the body)`);
  }
}

// the shader's tables
for (const name of new Set([...FAN_GLSL.matchAll(/\bC_([A-Z]+)\b/g)].map((x) => x[1]))) {
  if (!FAN_CLIPS.some((c) => c.name.toUpperCase() === name)) fail(`FAN_GLSL plays C_${name}, which isn't one of gl/fan-vat.js FAN_CLIPS`);
}
for (const [k] of Object.entries(FAN_PART)) {
  if (!new RegExp(`part == P_${k.toUpperCase()} \\?`).test(FAN_GLSL)) fail(`FAN_GLSL has no colour for the part '${k}'; it would draw in the shirt's`);
}
for (const [k, v] of Object.entries(FAN_GROUP)) {
  if (v && !new RegExp(`grp == G_${k.toUpperCase()}\\b`).test(FAN_GLSL)) fail(`FAN_GLSL never shows the group '${k}', so nobody wears it`);
}
// the normals' packing
let worst = 0;
for (let i = 0; i < 2000; i++) {
  const a = Math.acos(1 - 2 * ((i * 0.618034) % 1)), b = i * 2.39996, n = [Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)];
  const w = octPack(n), q = octUnpack(w);
  if (!Number.isInteger(w) || w < 0 || w >= 2 ** 24) { fail(`octPack gave ${w}, not an integer a float holds exactly`); break; }
  worst = Math.max(worst, Math.acos(Math.min(1, n[0] * q[0] + n[1] * q[1] + n[2] * q[2])));
}
report(`normals: packed and unpacked within ${(worst * 180 / Math.PI).toFixed(3)} degrees`);
if (worst > 0.2 * Math.PI / 180) fail(`a normal comes back ${(worst * 180 / Math.PI).toFixed(2)} degrees off from its packing`);
// the near level's cap
const px = Float32Array.from({ length: 3000 }, (_, i) => (i * 37) % 200);
const few = nearCut(px, 3000, 199.5), cut = nearCut(px, 3000, 70);
let over = 0;
for (const v of px) if (v >= cut) over++;
if (few !== 199.5) fail(`nearCut moved the line (${few}) when few fans reach it`);
if (over > NEAR_MAX || over < NEAR_MAX * 0.9) fail(`nearCut lets ${over} fans at the near level, not about ${NEAR_MAX}`);

if (problems.length) {
  console.error('fan-vat: FAIL');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
report('fan-vat: ok');
