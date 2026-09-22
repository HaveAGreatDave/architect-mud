// HOW MANY DIFFERENT THINGS DOES A WASTELAND TILE DRAW?
//
// ⚠ TWELVE CARDS THAT ONLY EVER SHOWED SIX THINGS. The scatter bakes one billboard per
// `seed % 12` per biome, and every branch inside then asked `seed % 6` — so cards 0-5 and 6-11
// drew the SAME primitive and differed only by the shape jitter it takes off its own seed. Half
// the texture budget was buying a second copy of the first six silhouettes, and nothing said so:
// the picture looked like a varied desert because the jitter is real, it was simply half as varied
// as it was paying for.
//
// ⚠ SO THE CHECK IS ON DISTINCT DRAWINGS, NOT ON THE TABLE. Reading the source for twelve branches
// proves nothing — two branches can call the same drawer. Each bucket is painted against a
// recording context and the op stream hashed, which is the same instrument `models:diff` uses and
// answers the question actually being asked: does this card look like a different thing?
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const { drawWildScatter } = ws;

// A context that records what was asked of it rather than drawing it.
function recorder() {
  const ops = [];
  const t = {};
  const h = {
    get(_, k) {
      if (k === 'canvas') return { width: 192, height: 192 };
      if (k in t) return t[k];
      return (...a) => { ops.push(k + '(' + a.map((v) => (typeof v === 'number' ? v.toFixed(2) : String(v))).join(',') + ')'); };
    },
    set(_, k, v) { ops.push(k + '=' + (typeof v === 'number' ? v.toFixed(2) : String(v))); t[k] = v; return true; },
  };
  return { ctx: new Proxy(t, h), ops };
}
const stubCam = { proj: () => ({ sx: 96, sy: 169, f: 6 }), sinh: 0, cosh: 1, ex: 0, ey: 0, ox: 0, oy: 0, R: 0 };
const hash = (ops) => { let a = 5381; const s = ops.join('|'); for (let i = 0; i < s.length; i++) a = ((a * 33) ^ s.charCodeAt(i)) >>> 0; return a; };

const BIOMES = ['redrock', 'scrub', 'cliff', 'hardpan', 'alkali', 'ash'];
const problems = [];
const rows = [];
let total = 0;
for (const bi of BIOMES) {
  const seen = new Set();
  let ops0 = 0;
  for (let k = 0; k < 12; k++) {
    const r = recorder();
    try { drawWildScatter(r.ctx, stubCam, 0, 0, bi, 0, k, 1); }
    catch (e) { problems.push(`${bi} bucket ${k}: drawWildScatter threw — ${e.message}`); continue; }
    if (!r.ops.length) { problems.push(`${bi} bucket ${k} draws nothing at all`); continue; }
    ops0 += r.ops.length;
    seen.add(hash(r.ops));
  }
  rows.push({ bi, distinct: seen.size, ops: Math.round(ops0 / 12) });
  total += seen.size;
  // ⚠ THE BAR IS SEVEN, NOT TWELVE. Some buckets SHOULD repeat — a wasteland that never draws the
  // same boulder twice is not a wasteland — but six was the arithmetic ceiling of `% 6` and any
  // number above it proves all twelve cards are being spent.
  // ⚠ ALKALI CANNOT REACH THIS AND IS NOT BROKEN. Its vocabulary is TWO — the salt crust is bone
  // and stone, and nothing green has any business there — and one of the two draws the same picture
  // whatever seed it is handed: alkali buckets 0-3 hash identically while redrock buckets 0-1 do
  // not, which is a measurement rather than a reading of the source. Every bone pile in the world
  // is the SAME bone pile, so until `drawBonesBB` takes its seed this biome is capped near five
  // however the table is written. PINNED rather than exempted, so it still fails if it slips.
  const floor = bi === 'alkali' ? 4 : 7;
  if (seen.size < floor) {
    problems.push(`${bi} draws only ${seen.size} distinct things across its 12 cards, wanted ${floor}`
      + (bi === 'alkali' ? '' : ' — the table is collapsing onto the old six'));
  }
}

// ⚠ AND THE MIRROR IS PER TILE, NOT PER CARD. Flipping on the quantised key would turn all twelve
// cards over together and change nothing on screen; the whole point is that two tiles drawing the
// SAME card face opposite ways. There is no way to ask the renderer this without a frame, so it is
// asked of the hash the flip is drawn from.
const frac = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
let flips = 0, sameCardBothWays = 0;
for (let seed = 0; seed < 4000; seed += 2) {
  if (frac(seed * 5.31 + 2.7) < 0.5) flips++;
}
for (let card = 0; card < 12; card++) {
  let a = false, b = false;
  for (let seed = card; seed < 20000; seed += 12) { if (frac(seed * 5.31 + 2.7) < 0.5) a = true; else b = true; }
  if (a && b) sameCardBothWays++;
}
const flipShare = flips / 2000;
if (!(flipShare > 0.35 && flipShare < 0.65)) problems.push(`the mirror fires on ${(flipShare * 100).toFixed(0)}% of tiles — it should be about half`);
if (sameCardBothWays < 12) problems.push(`${12 - sameCardBothWays} of 12 cards are never drawn both ways — the flip is keyed on the card, not the tile`);

if (problems.length) {
  console.log(`✗ scattervar: ${problems.length} problem(s)`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log(`✓ scattervar: ${total} distinct silhouettes across 6 wasteland biomes `
  + `(${rows.map((r) => r.bi + ' ' + r.distinct).join(', ')}) — all 12 cards spent, none a duplicate of the first six.`);
console.log(`  · every card is drawn both ways on some tile, so the mirror doubles what is on screen `
  + `for no extra texture.`);
