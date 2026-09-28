// A PER-TILE SIGN BOARD IS A SURFACE, AND IT HAS TO BE IN THE DEPTH BUFFER.
//
// Reported from the game as "clouds appear thru billboards", with a screenshot of a hoarding
// standing against the sky with cloud puffs drawn over the middle of it.
//
// The mechanism is two lines of GL state in two files, and it is the goose bug one layer along.
// `emitFlat`'s `paint` path sends a per-tile board to the DECAL layer rather than into the mesh,
// because a board carrying `$name` takes its words off the TILE and a mesh is captured once per
// MODEL — there is no single appearance to record. The decal layer deliberately writes no depth
// ("a sign is on a wall, not a wall"), which is right for lettering on a facade and wrong for the
// one decal that is not on anything: a roof hoarding stands on its own legs against the sky. So at
// the board's own pixels the depth buffer still held the ground far behind it, and the cloud deck —
// which clears COLOUR ONLY and tests against whatever the world left — passed at every one of them.
//
// ⚠ NO HEADLESS GATE CAN SEE THE PICTURE. Every harness here installs a GL hook that returns null,
// so not one of them reaches a draw call, let alone a depth test; `__glBoardSky()` in the Modelshop
// is the instrument that counts the pixels. What IS checkable here is the DATA that reaches the
// layer: which quads asked to write depth, which did not, and that the flag's 0 is the renderer
// that shipped.
//
// ⚠ AND THE SECOND CHECK IS THE ONE THAT WOULD BE SILENT. A board that writes depth can hide its
// OWN LETTERING — the words are a separate decal a hair in front, and if that hair is ever lost the
// sign goes blank rather than throwing, on 86 of the city's 173 models at once.
//
//   node scripts/shapes/boarddepth.mjs
//   node scripts/shapes/boarddepth.mjs --report
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');

// A REAL camera, not the stub: every one of these reaches the decal layer through `cam.unproj`, and
// a stub has none — under it nothing would be collected and the gate would pass vacuously. Close,
// because the derived kit is screen-size gated; see the same pair of ⚠ in glresidue.mjs.
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });
const decalsOf = () => {
  const out = [];
  for (const { key, m } of ws.shapeModelRegistry()) {
    const r = ws.canvasResidue(m, { cam, night: 1, bn: 'THE EXAMPLE', dy: -2, collect: true, who: false });
    if (r.threw) continue;
    for (const d of (r.sink && r.sink.decals) || []) out.push({ model: key, d });
  }
  return out;
};

const problems = [], notes = [];
const tag = (d) => String(d.key || '').split('|')[0];
const meanF = (d) => {
  let s = 0, n = 0;
  for (const p of d.p) { const q = cam.proj(p[0], p[1], p[2]); if (!q || !(q.f > 0)) return null; s += q.f; n++; }
  return n ? s / n : null;
};
const boxOf = (d) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of d.p) {
    const q = cam.proj(p[0], p[1], p[2]);
    if (!q) return null;
    x0 = Math.min(x0, q.sx); x1 = Math.max(x1, q.sx); y0 = Math.min(y0, q.sy); y1 = Math.max(y1, q.sy);
  }
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};

// ⚠ WARMED FIRST, AND THAT IS NOT TIDINESS. The first sweep over the registry collects 1,174
// decals and every one after it collects 1,186: a texture bake is lazy, and a caller that has no
// texture yet queues nothing. So a cold sweep against a warm one differs by twelve quads for
// reasons that have nothing to do with the flag, which is exactly the shape of a false finding.
decalsOf();
// Boards are what glBoardDepth makes write depth. Since glSignDepth, lettering, neon tubes and
// blades write depth too, and pairing against them matched words with themselves or with another
// sign standing in front of them on screen, which is ordinary occlusion, not a board hiding its name.
const wasSign0 = ws.RENDER_TUNE.glSignDepth;
ws.RENDER_TUNE.glSignDepth = 0;
const boardKeys = new Set(decalsOf().filter((r) => r.d.solid).map((r) => r.d.key));
ws.RENDER_TUNE.glSignDepth = wasSign0;
const live = decalsOf();
const solid = live.filter((r) => r.d.solid && boardKeys.has(r.d.key));
// A quad's world normal (Newell). A hoarding's back face is authored in reverse, so its normal
// points opposite the painted face and the words on it. When the quad in front of the words is
// one of those, the eye is behind the sign and the slab covering its lettering is right. The
// comparison is relative, so a mirrored facing (which flips every winding) can't fool it.
const normalOf = (d) => {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < d.p.length; i++) {
    const u = d.p[i], v = d.p[(i + 1) % d.p.length];
    nx += (u[1] - v[1]) * (u[2] + v[2]); ny += (u[2] - v[2]) * (u[0] + v[0]); nz += (u[0] - v[0]) * (u[1] + v[1]);
  }
  return [nx, ny, nz];
};
const opposed = (a, b) => { const m = normalOf(a), n = normalOf(b); return m[0] * n[0] + m[1] * n[1] + m[2] * n[2] < 0; };
const models = new Set(solid.map((r) => r.model));

// ── 1. THE BOARDS ASK, AND ENOUGH OF THEM DO THAT THIS IS NOT VACUOUS ─────────
if (models.size < 20) {
  problems.push(`only ${models.size} model(s) put a depth-writing board on the decal layer — the derived kit signs far more than that, so either the kit stopped producing hoardings or nothing is asking`);
}
for (const r of live) {
  if (tag(r.d) === 'gantry' && !r.d.solid) {
    problems.push(`${r.model}: a hoarding quad (${r.d.key}) reached the decal layer without asking to write depth — the cloud deck has nothing to sort it against and draws through the sign`);
    break;
  }
}

// ── 2. LETTERING IS ALWAYS IN FRONT OF ITS OWN BOARD ──
// The silent one: the words are a separate quad pulled toward the eye past the board's DETAIL_LIFT,
// and if that ever stops being true the board hides its own name. No throw, no warning, just a lit
// empty slab, which reads as text that failed to render rather than as a z-order bug.
// Lettering writes depth exactly when glSignDepth is on (it's cut at half alpha, so only the
// letterforms write, never the halo); at 0 it's paint only, as shipped.
const wantLetterDepth = ws.RENDER_TUNE.glSignDepth !== 0;
for (const r of live) {
  if (tag(r.d).startsWith('st:') && !!r.d.solid !== wantLetterDepth) {
    problems.push(`${r.model}: LETTERING ${wantLetterDepth ? 'wrote no depth with glSignDepth on, so a cloud behind a sign against sky draws over its words' : 'asked to write depth with glSignDepth = 0'}`);
    break;
  }
}
let pairs = 0, worst = Infinity;
for (const r of live) {
  if (!tag(r.d).startsWith('st:')) continue;
  const tb = boxOf(r.d), tf = meanF(r.d);
  if (!tb || tf == null) continue;
  for (const s of solid) {
    if (s.model !== r.model) continue;
    const bb = boxOf(s.d), bf = meanF(s.d);
    if (!bb || bf == null || opposed(r.d, s.d)) continue;
    if (tb.cx < bb.x0 || tb.cx > bb.x1 || tb.cy < bb.y0 || tb.cy > bb.y1) continue;   // the words are not on this board
    pairs++;
    worst = Math.min(worst, bf - tf);
    if (!(tf < bf)) {
      problems.push(`${r.model}: the lettering on a depth-writing board sits ${(tf - bf).toFixed(4)} tiles BEHIND its ${tag(s.d)} board — the board covers its own words and the sign goes blank`);
      break;
    }
  }
}
if (!pairs) problems.push('no lettering was found on any depth-writing board — the pairing found nothing, so the clearance above is unchecked rather than proved');

// ── 3. THE OFF SWITCH IS THE RENDERER THAT SHIPPED ───────────────────────────
const was = ws.RENDER_TUNE.glBoardDepth, wasSign = ws.RENDER_TUNE.glSignDepth;
ws.RENDER_TUNE.glBoardDepth = 0; ws.RENDER_TUNE.glSignDepth = 0;
const off = decalsOf();
ws.RENDER_TUNE.glBoardDepth = was; ws.RENDER_TUNE.glSignDepth = wasSign;
if (off.some((r) => r.d.solid)) problems.push('glBoardDepth = glSignDepth = 0 still pushed a depth-writing quad — the off switch is not the renderer that shipped');
if (off.length !== live.length) problems.push(`the depth flags changed how many decals were drawn (${live.length} → ${off.length}) — it may only change how one is sorted`);

if (REPORT) {
  const byTag = new Map();
  for (const r of live) { const t = r.d.solid ? tag(r.d) : null; if (t) byTag.set(t, (byTag.get(t) || 0) + 1); }
  console.log(`  ${solid.length} depth-writing quad(s) over ${models.size} model(s), of ${live.length} decals in all`);
  console.log('  by part: ' + [...byTag.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log(`  ${pairs} board/lettering pair(s); the tightest clearance is ${worst === Infinity ? 'n/a' : worst.toFixed(4)} tiles`);
}

if (problems.length) {
  console.error('✗ boarddepth — ' + problems.length + ' problem(s):');
  // Capped: this sweeps 173 models and one mistake in a shared helper is 100 identical lines.
  for (const p of problems.slice(0, 12)) console.error('  · ' + p);
  if (problems.length > 12) console.error('  · … and ' + (problems.length - 12) + ' more of the same shape');
  process.exit(1);
}
console.log(`✓ boarddepth — ${solid.length} board quad(s) on ${models.size} model(s) write depth, lettering writes depth only under glSignDepth and clears its board by ${worst.toFixed(4)} tiles, and the flag's 0 removes it.`);
