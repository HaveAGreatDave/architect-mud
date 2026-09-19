// walltag — does a player's graffiti actually land ON the wall they sprayed?
//
// `plugins/graffiti` writes what somebody sprayed to `zone_graffiti`; `deriveSurfaceCell` hands it
// to the windshield as the cell's `gft`; `drawWallTags` paints it. Every one of the ways that goes
// wrong is SILENT, which is why this exists rather than a screenshot:
//
//   · the quad is placed at the tile footprint and the wall is WIDER than it — the mass is then in
//     front of the paint, the depth test hides it per pixel, and the result is a clean wall. Not an
//     error, not a warning, not a missing decal: the decal is there and nothing draws. That is the
//     one failure direction that looks exactly like the feature not being wired up.
//   · the wall NORMAL is rotated wrongly into the model's own frame, and the tag lands on the
//     entrance face of every building in the city — which looks completely correct from the street
//     the entrance happens to face, and is wrong on the other three.
//   · the paint is captured into the per-model MESH, at which point one wall's words are shared by
//     every tile drawing that model and a chain wears its own vandalism on all eleven branches.
//
// So: for every entrance facing and every wall normal, put a tag on a building and assert where the
// quad ended up against the shape the building actually COLLIDES as.
//
//   node scripts/shapes/walltag.mjs
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const FH = 0.4, H = 1, SEED = 3;
const FACINGS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const TAG = { t: 'COLDWATER LIES', c: '#ff4a9a' };

let pass = 0;
const fails = [];
const check = (ok, what) => { if (ok) pass++; else fails.push(what); };

// A camera looking down −y from the origin, with the subject in front of it. Real, not the stub:
// `emitSurfaceText` reaches the decal layer through `cam.unproj`, and a stub camera has none — so
// under the stub every tag reports as canvas residue and this would measure nothing.
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });
const DX = 0, DY = -3;

// What the tag ADDED to the frame, in world space.
//
// ⚠ MEASURED AS A DELTA AGAINST THE SAME BUILDING WITH NO TAG ON IT, never as "the decals in the
// frame". A lettered building already pushes its own name, its blade and its boards through the
// very same decal layer — the subject here draws three before a can is opened — so counting the
// decals in a frame measures the signage pass and calls it graffiti. The rest of the frame is
// deterministic, so the difference between the two runs is the paint and nothing else.
function frameDecals(m, ent, gft, tune) {
  const saved = {};
  for (const k of Object.keys(tune || {})) { saved[k] = ws.RENDER_TUNE[k]; ws.RENDER_TUNE[k] = tune[k]; }
  try {
    const r = ws.canvasResidue(m, {
      cam, dx: DX, dy: DY, fh: FH, h: H, seed: SEED, night: 1, E: ent,
      bn: 'THE EXAMPLE', collect: true, gft,
    });
    if (r.threw) throw new Error(r.threw);
    return (r.sink && r.sink.decals) || [];
  } finally {
    for (const k of Object.keys(tune || {})) ws.RENDER_TUNE[k] = saved[k];
  }
}

function tagQuads(m, ent, normal, tune = {}, tag = TAG) {
  const bare = frameDecals(m, ent, null, tune).length;
  const all = frameDecals(m, ent, [{ ...tag, n: normal }], tune);
  return { decals: all.slice(bare), bare };
}

// How far the building's mass reaches along a world direction, at the height the paint sits at.
//
// ⚠ COMPUTED BY TRANSFORMING EVERY BOX CORNER AND PROJECTING IT, which is deliberately NOT how the
// renderer does it. The first version of this gate re-derived the number the way `drawWallTags`
// did — max `hw` over the boxes spanning that height — and therefore agreed with it perfectly,
// including where it was wrong: the boxes are in the model's ENTRANCE frame and the wall being
// painted is any one of four, so `hw` is the distance to the wall only when the two happen to line
// up on a square centred box. Measured afterwards against this: the paint landed inside the mass in
// 868 of 3,296 (model, entrance, wall) cases, and the old gate passed every one of them.
// ⚠ AND IT TAKES THE PIECE'S OWN LATERAL SPAN, because "is the paint in front of the building" is a
// question about the building BEHIND THE PAINT. Asked of the whole elevation it is answered by a
// projecting wing forty centimetres away that the piece is nowhere near, and a piece correctly
// painted on a recessed wall reads as buried: 64 of 836 were reported that way, every one of them
// on the wall it had been put on. `xLo`/`xHi` are world x, the axis the wall runs along here.
function massReach(m, seed, zLo, zHi, ent = [0, 1], dir = [0, 1], xLo = -Infinity, xHi = Infinity) {
  const segs = ws.shapeForModel(m, seed) || [];
  const V = (p) => (p ? p[0] * FH + p[1] * H + p[2] : 0);
  const px = ent[1], py = -ent[0];
  let best = -Infinity;
  for (const sg of segs) {
    if (sg.kind !== 'box' || (sg.yaw || 0)) continue;
    // ⚠ TOUCHING IS NOT OVERLAPPING. A piece painted on the wall ABOVE a plinth has its bottom edge
    // exactly on the plinth's top, and a `<` here counts the plinth as mass at the paint's height —
    // which reports the piece as buried behind the very thing it was raised to clear.
    if (zHi <= V(sg.z0) + 1e-6 || zLo >= V(sg.z1) - 1e-6) continue;
    {
      const { cx, cy, hw, fd } = ws.segFit(sg, V);
      const ox = DX + cx * px + cy * ent[0], ex = Math.abs(hw * px) + Math.abs(fd * ent[0]);
      if (ox + ex < xLo - 1e-6 || ox - ex > xHi + 1e-6) continue;
    }
    // ⚠ `segFit`, NOT a local `min(hwRaw, 0.44)`. The capture is raw and the renderer applies TWO
    // clamps to it — the half-width cap and the plot-line fit — so measuring the wall by hand
    // measures a building that is not the one the paint lands on. That is this gate's own finding
    // ("paint INSIDE its own mass"), pointed at itself.
    const { cx, cy, hw, fd } = ws.segFit(sg, V);
    if (!(hw > 0.03)) continue;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const lx = cx + sx * hw, ly = cy + sy * fd;
      best = Math.max(best, (lx * px + ly * ent[0]) * dir[0] + (lx * py + ly * ent[1]) * dir[1]);
    }
  }
  return best === -Infinity ? 0 : best;
}

const registry = ws.shapeModelRegistry();
const subject = registry.find((r) => /adequate|voltage/.test(r.key)) || registry[0];
const M = subject.m;

// ── 1. A TAG IS DRAWN, ON EVERY FACING, ON THE WALL FACING THE CAMERA ───────────────────────────
//
// The camera sits at the origin looking along −y toward a building at y −3, so the wall turned
// toward it is the one whose outward normal is +y. That is true whatever the building's ENTRANCE is
// doing, which is the whole point: the tag's frame comes from the wall, never from the door.
for (const ent of FACINGS) {
  const { decals } = tagQuads(M, ent, [0, 1]);
  check(decals.length === 1, `one decal on the camera-facing wall (ent ${ent})  got ${decals.length}`);
}

// ── 2. …AND NOT ON THE THREE WALLS TURNED AWAY ─────────────────────────────────────────────────
for (const ent of FACINGS) {
  for (const n of [[0, -1], [1, 0], [-1, 0]]) {
    const { decals } = tagQuads(M, ent, n);
    check(decals.length === 0, `no decal on a wall turned away (ent ${ent}, n ${n})  got ${decals.length}`);
  }
}

// ── 3. THE PAINT STANDS OUTSIDE THE MASS, WHICH IS THE SILENT ONE ──────────────────────────────
//
// Every corner of the quad must be at least as far out along the wall normal as the mass reaches at
// that height. Short of it, the depth buffer hides the tag and the wall looks clean.
// ⚠ ASSERTED AGAINST THE CAPTURE, not against `fh`. A model whose ground floor is wider than its
// tile footprint is exactly the case a footprint-sized quad gets wrong.
{
  let buried = 0, tested = 0, flush = 0;
  // ⚠ EVERY ENTRANCE AGAINST EVERY WALL, not just the front. The bug this is written for is that
  // the mass is described in the entrance's frame and the paint goes on an arbitrary side, so the
  // front-against-front case is precisely the one that is right by accident.
  for (const { key, m } of registry) {
    for (const ent of FACINGS) {
      const { decals } = tagQuads(m, ent, [0, 1]);
      if (!decals.length) continue;
      // ⚠ OVER THE BAND THE PAINT ACTUALLY OCCUPIES, WHICH IS NO LONGER A CONSTANT. This used to
      // measure the mass over one fixed arm's-reach band because that is where paint always went,
      // and a piece now fits itself to the wall it finds — above a plinth that stands proud of the
      // wall, most often. Measured over the old band this gate reported 102 of 838 pieces "inside
      // their own mass" when every one of them was correctly ON the wall it had been put on, and
      // the mass it was inside was a plinth below it.
      const zs = decals[0].p.map((v) => v[2]), xs = decals[0].p.map((v) => v[0]);
      const reach = massReach(m, SEED, Math.min(...zs), Math.max(...zs), ent, [0, 1], Math.min(...xs), Math.max(...xs));
      if (!(reach > 0.03)) continue;        // nothing solid at paint height: the fallback covers it
      tested++;
      const out = Math.min(...decals[0].p.map((v) => v[1] - DY));   // +y is the wall normal here
      if (out < reach) { buried++; if (buried <= 3) fails.push(`${key} (ent ${ent}): paint at ${out.toFixed(3)} inside mass reaching ${reach.toFixed(3)}`); }
      // ⚠ AND PROUD OF IT, NOT FLUSH WITH IT. Paint exactly coplanar with its wall is a TIE in the
      // depth test, and a tie loses: the decal is uploaded, drawn, and contributes no pixels at all.
      // Measured on Solenne Residences, whose distance to the wall was already exactly right — 0
      // pixels on the depth buffer against 312 on the canvas path, where a painter's sort bias had
      // been covering for it. This is the assertion that the stand-off is still there.
      else if (out < reach + 1e-4) flush++;
    }
  }
  check(tested > 200, `enough (model, entrance) pairs carried a tag to be worth asserting  (${tested})`);
  check(buried === 0, `${buried} of ${tested} paint INSIDE their own mass`);
  check(flush === 0, `${flush} of ${tested} paint exactly FLUSH with their wall (a depth tie loses)`);
}

// ── 3b. …AND THERE IS A BUILDING BEHIND ALL OF IT ──────────────────────────────────────────────
//
// The question 3 does not ask, and the reported bug. That one holds the paint against the mass's
// reach AT ONE POINT and along one axis — which catches paint buried in its own wall and is blind
// to paint that has no wall under it at all. A piece used to be placed at a FRACTION of the mass's
// own width, and a fraction is a position on every building and a wall on most of them: measured
// over the registry at all four entrances, 19.3% of pieces had part of themselves standing in clear
// air and 12.5% were wholly in mid-air. `type:fuel_yard` is the reported one — a forecourt whose
// arm says in its own comment that there are "deliberately no walls here at all" — along with both
// hangars, the thorn gate, the Meridian's colonnade and every other open ground floor in the city.
//
// ⚠ SAMPLED ACROSS THE WHOLE RECTANGLE, NOT AT ITS CENTRE. Half a piece off the end of a wall is
// the commonest form of this and the middle of it is over brick.
// ⚠ AND AT EACH HEIGHT SEPARATELY, rather than demanding one box span the piece. A wall built out
// of a stacked pair is still a wall, and a gate that asked for one box would report the Embassy's
// plinth-and-storey frontage as mid-air.
{
  const GAP = 0.06;          // how far behind the paint its wall may stand
  // The building's frontmost mass along +y at a world x and a height — nothing behind that is what
  // "in mid-air" means, and anything further back than GAP reads as one.
  const frontAt = (m, ent, wx, z) => {
    const segs = ws.shapeForModel(m, SEED) || [];
    const V = (p) => (p ? p[0] * FH + p[1] * H + p[2] : 0);
    const px = ent[1], py = -ent[0];
    let best = -Infinity;
    for (const sg of segs) {
      if (sg.kind !== 'box' || (sg.yaw || 0)) continue;
      const { cx, cy, hw, fd } = ws.segFit(sg, V);
      if (!(hw > 0.03)) continue;
      if (z < V(sg.z0) - 1e-9 || z > V(sg.z1) + 1e-9) continue;
      const ox = cx * px + cy * ent[0], oy = cx * py + cy * ent[1];
      const ex = Math.abs(hw * px) + Math.abs(fd * ent[0]), ey = Math.abs(hw * py) + Math.abs(fd * ent[1]);
      if (wx < DX + ox - ex - 1e-6 || wx > DX + ox + ex + 1e-6) continue;
      best = Math.max(best, DY + oy + ey);
    }
    return best;
  };
  let tested = 0, part = 0, whole = 0, refused = 0;
  const named = [];
  for (const { key, m } of registry) {
    for (const ent of FACINGS) {
      const { decals } = tagQuads(m, ent, [0, 1]);
      if (!decals.length) { refused++; continue; }
      tested++;
      const p = decals[0].p;
      const xs = p.map((v) => v[0]), zs = p.map((v) => v[2]);
      const y = Math.max(...p.map((v) => v[1]));
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      let off = 0, n = 0;
      for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) {
        n++;
        if (!(frontAt(m, ent, x0 + (x1 - x0) * ((i + 0.5) / 7), z0 + (z1 - z0) * ((j + 0.5) / 4)) >= y - GAP)) off++;
      }
      if (off) { part++; if (off === n) whole++; if (named.length < 6) named.push(`${key} (ent ${ent}): ${off}/${n} of the piece over thin air`); }
    }
  }
  for (const f of named) fails.push(f);
  check(tested > 400, `enough walls carried a piece to be worth asserting  (${tested})`);
  check(part === 0, `${part} of ${tested} pieces have part of themselves off the wall`);
  check(whole === 0, `${whole} of ${tested} pieces are wholly in mid-air`);
  // ⚠ AND THE REFUSAL HAS TO BE REACHABLE, or every assertion above is satisfied by a renderer that
  // paints everything and a solve that happens to agree. An open ground floor gets NO paint, which
  // is the other half of the fix and the half that cannot be seen by looking at what was drawn.
  check(refused > 20, `some walls are refused outright rather than floated  (${refused})`);
  console.log(`  player tags: ${tested} walls painted, ${refused} refused, ${whole} in mid-air.`);
}

// ── 4. PER-TILE PAINT IS NEVER CAPTURED ────────────────────────────────────────────────────────
//
// `tileMesh` memoises per model per scale, so anything a tag put in a mesh would be worn by every
// tile drawing that model. The bake refuses under either sink; this asserts the refusal.
{
  const meshed = ws.captureModelMesh(M, { fh: FH, h: H, seed: SEED });
  const shape = ws.shapeForModel(M, SEED);
  const { decals } = tagQuads(M, [0, 1], [0, 1]);
  check(decals.length === 1, 'the subject still tags after a capture');
  const meshed2 = ws.captureModelMesh(M, { fh: FH, h: H, seed: SEED });
  check(meshed.length === meshed2.length, 'a capture is unchanged by a tag having been drawn');
  check(!!shape, 'the subject captures a shape');
}

// ── 5. THE OFF-SWITCH, AND THE MUTATION CONTROL ────────────────────────────────────────────────
//
// ⚠ A GATE THAT CANNOT FAIL IS NOT A GATE. If `wallTags: 0` and `wallTags: 1` both produce a decal,
// every assertion above is measuring something else.
{
  const off = tagQuads(M, [0, 1], [0, 1], { wallTags: 0 });
  check(off.decals.length === 0, `wallTags 0 draws nothing  got ${off.decals.length}`);
  const on = tagQuads(M, [0, 1], [0, 1], { wallTags: 1 });
  check(on.decals.length === 1, 'wallTags 1 draws one');
}

// ── 6. THE WORDS REACH THE TEXTURE ─────────────────────────────────────────────────────────────
//
// A bake that silently returns an empty canvas draws a decal with nothing in it, which from any
// distance is a clean wall again. The canvas has to have real extent, and a longer tag has to
// produce a different one — otherwise the cache key is collapsing two tags into one texture.
{
  const a = tagQuads(M, [0, 1], [0, 1]).decals[0];
  check(a && a.img && a.img.width > 32 && a.img.height > 32, 'the baked tag canvas has extent');
  const b = tagQuads(M, [0, 1], [0, 1], {}, { t: 'A', c: '#ff4a9a' }).decals[0];
  check(b && b.img && b.img.width !== a.img.width, 'two different tags are two different textures');
  check(a && b && a.key !== b.key, 'and two different decal keys');
}

// ── 6. …AND THE BUILDING'S OWN PIECE STAYS ON THE BUILDING, AT EVERY FOOTPRINT ──────────────────
//
// The other graffiti in this game is the derived kit's `tag` — one word on a shopfront flank — and
// it had a defect a per-model gate cannot see. `DETAIL_SCHEMA` tags `cx` and `w` as `fh` quantities
// so they grow with the footprint roll, and `segFit` caps a mass box's half-width at 0.44 whatever
// the roll says. Above about `fh = 0.42` the wall stops and the trim does not, so a piece authored
// correctly at the basis walks off the corner of the building only on the wide half of the roll.
//
// `anchored` holds every part against the mass at ONE basis and therefore agrees with the
// authoring; this is the same question asked across the roll, which is where the answer changes.
// The renderer's fix is `wallSpanAt` — the widest continuous run of wall on the part's own plane at
// its own height — and this asserts it is doing something rather than quietly answering null.
{
  const H = 1, ROLL = [0.38, 0.40, 0.42, 0.44], MARGIN = 0.008;
  let tags = 0, off = 0, refused = 0, noWall = 0, worst = 0, worstKey = '';
  for (const fh of ROLL) {
    const V = (p) => (Array.isArray(p) ? p[0] * fh + p[1] * H + p[2] : (p ?? 0));
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const { key, m } of registry) {
        for (const d of ws.derivedTrim(m, fh, H, seed, true) || []) {
          if (d.kind !== 'tag') continue;
          tags++;
          const wRaw = V(d.w), hh = d.hh != null ? V(d.hh) : wRaw * 0.55, z = V(d.z);
          const cx0 = V(d.cx), plane = V(d.cy), flank = d.face === 'x';
          const span = ws.wallSpanAt(m, seed, fh, H, plane, flank, z - hh, z + hh, cx0);
          if (!span) { noWall++; continue; }
          const w = Math.min(wRaw, (span.hi - span.lo) * 0.5 - MARGIN);
          // A piece the wall cannot hold is not drawn at all — see the ⚠ in the `tag` painter — and
          // `anchored` names it, so this is a count rather than a failure.
          if (!(w > wRaw * 0.4)) { refused++; continue; }
          const cx = Math.max(span.lo + MARGIN + w, Math.min(cx0, span.hi - MARGIN - w));
          const slid = Math.abs(cx - cx0);
          if (slid > 1e-6) { off++; if (slid > worst) { worst = slid; worstKey = key + ' at fh ' + fh; } }
          // The clamp's own contract, which is the thing that must never regress: whatever it
          // returns is inside the wall it was measured against.
          check(cx - w >= span.lo - 1e-6 && cx + w <= span.hi + 1e-6,
            `${key} fh ${fh} seed ${seed}: clamped tag still leaves its wall`);
        }
      }
    }
  }
  check(tags > 200, `the sweep found tags to check  got ${tags}`);
  // ⚠ AND THE CLAMP HAS TO BITE. A `wallSpanAt` that answered null for everything — a renamed field,
  // a capture that throws, a plane tolerance set too tight — would pass every assertion above by
  // doing nothing at all, which is exactly the shape of the bug it was written for.
  check(off > 0, 'the wall clamp moves at least one tag — otherwise it is inert');
  check(noWall === 0, `every tag finds a wall on its own plane  ${noWall} did not`);
  console.log(`  kit tags: ${tags} over ${ROLL.length} footprints — ${off} slid back onto their wall`
    + ` (worst ${worst.toFixed(4)} tiles, ${worstKey}), ${refused} refused, ${noWall} on no wall.`);
}

const total = pass + fails.length;
if (fails.length) {
  console.log(`walltag: ${pass}/${total} passed — ${fails.length} FAILED`);
  for (const f of fails.slice(0, 12)) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`walltag: ${pass}/${total} passed`);
