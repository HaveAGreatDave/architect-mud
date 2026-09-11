// signtext — the lettering options: do they exist, do they draw, and do they miss the cache?
//
// Every sign in Coldwater was `bold monospace` until these were added, and both new options fail
// silently in their own way:
//
//   A font name nobody declared falls back — correctly — to mono, so a typo in a model file is a
//     sign that quietly looks like every other sign rather than a build failure. That is the right
//     behaviour and it means the SCHEMA's list and the TABLE's keys have to be checked against each
//     other by something, or the documented vocabulary drifts from the working one.
//   A pictogram that draws nothing leaves a blank cell the layout has already reserved, so the word
//     sits off-centre on its board with a hole beside it.
//   ⚠ And the one that is not silent but is worse: `font` and `picto` change the PICTURE and
//     nothing else in the texture key does. Leave either out of it and the first caller's artwork
//     is handed to every later one with the same label and colour — one bar's script wordmark
//     appearing on another's block-lettered board, city-wide, with no error anywhere.
//
//   node scripts/shapes/signtext.mjs
import { readFileSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const { SIGN_FONT, SIGN_PICTO } = ws;

let checks = 0, bad = 0;
const check = (cond, what) => { checks++; if (!cond) { bad++; if (bad <= 12) console.error('  ✗ ' + what); } };

check(SIGN_FONT && typeof SIGN_FONT.mono === 'function', 'SIGN_FONT.mono must exist — it is the default every sign that shipped uses');

// ── EVERY FACE RESOLVES TO A USABLE CSS FONT, ENDING IN A GENERIC FAMILY ───────────────────────
// ⚠ The generic keyword is the whole fallback story. A stack naming only real families falls back
// to the DEFAULT face on a machine without them, which is body text on a neon sign and looks
// exactly like the option not working.
const GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
for (const [name, fn] of Object.entries(SIGN_FONT)) {
  const s = fn(46);
  check(typeof s === 'string' && /\d+px/.test(s), `SIGN_FONT.${name} did not produce a CSS font string with a px size: ${s}`);
  check(GENERIC.some((g) => s.trim().endsWith(g)), `SIGN_FONT.${name} does not end in a generic family, so a machine without its fonts falls back to body text: ${s}`);
  check(fn(92).includes('92px') || /\d+px/.test(fn(92)), `SIGN_FONT.${name} does not scale with the cell size`);
}

// ── EVERY PICTOGRAM ACTUALLY LAYS DOWN A PATH ─────────────────────────────────────────────────
// Recorded against a stub that only counts path operations — it is drawn as a stroked tube, so what
// matters is that there is a path to stroke, not what it is filled with.
for (const [name, fn] of Object.entries(SIGN_PICTO)) {
  let ops = 0, moves = 0, extent = 0;
  const rec = {
    moveTo(x, y) { ops++; moves++; extent = Math.max(extent, Math.abs(x), Math.abs(y)); },
    lineTo(x, y) { ops++; extent = Math.max(extent, Math.abs(x), Math.abs(y)); },
    arc(x, y, r) { ops++; extent = Math.max(extent, Math.abs(x) + r, Math.abs(y) + r); },
    closePath() { ops++; },
  };
  fn(rec);
  check(ops >= 3, `SIGN_PICTO.${name} laid down ${ops} path operations — a blank cell the layout has already reserved`);
  check(moves >= 1, `SIGN_PICTO.${name} never moved the pen, so it continues whatever path preceded it`);
  // Laid out in a unit box centred on the origin. Bigger than that and it draws outside its cell,
  // over the letters beside it.
  check(extent <= 0.62, `SIGN_PICTO.${name} reaches ${extent.toFixed(2)} from the origin — outside its own ±0.5 cell`);
}

// ── THE SCHEMA'S DOCUMENTED VOCABULARY IS THE TABLE'S ─────────────────────────────────────────
// An author reads the schema. If it names a face or a mark that does not exist, they get mono and
// no pictogram and nothing tells them why.
const schema = readFileSync(new URL('../../client/shared/building-model-schema.js', import.meta.url), 'utf8');
const fonts = (schema.match(/SIGN_FONT's keys \(([^)]+)\)/) || [])[1];
const pics = (schema.match(/SIGN_PICTO's \(([^)]+)\)/) || [])[1];
check(!!fonts, "the schema no longer documents SIGN_FONT's keys, so nothing pins the vocabulary");
check(!!pics, "the schema no longer documents SIGN_PICTO's keys");
for (const f of (fonts || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  check(!!SIGN_FONT[f], `the schema documents font '${f}', which SIGN_FONT does not have`);
}
for (const p of (pics || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  check(!!SIGN_PICTO[p], `the schema documents pictogram '${p}', which SIGN_PICTO does not have`);
}
for (const f of Object.keys(SIGN_FONT)) check((fonts || '').includes(f), `SIGN_FONT has '${f}' and the schema does not mention it, so no author will ever use it`);
for (const p of Object.keys(SIGN_PICTO)) check((pics || '').includes(p), `SIGN_PICTO has '${p}' and the schema does not mention it`);

// ── AND BOTH ARE IN THE TEXTURE KEY ───────────────────────────────────────────────────────────
// Read off the source, because the cache is private and the failure is a wrong picture rather than
// an exception. This is the assertion that stops one bar's wordmark appearing on another's board.
const src = readFileSync(new URL('../../client/game/js/panels/windshield.js', import.meta.url), 'utf8');
const keyLine = (src.match(/const key = `\$\{label\}\|[^`]*`;/) || [])[0] || '';
check(/\$\{face\}/.test(keyLine), 'the sign texture cache key does not include the font face — signs will share artwork across faces');
check(/\$\{picto\}/.test(keyLine), 'the sign texture cache key does not include the pictogram');

console.log(`  · ${Object.keys(SIGN_FONT).length} faces (${Object.keys(SIGN_FONT).join(', ')})`);
console.log(`  · ${Object.keys(SIGN_PICTO).length} pictograms (${Object.keys(SIGN_PICTO).join(', ')})`);

if (bad) { console.error(`\n✗ signtext — ${bad} of ${checks} checks failed.`); process.exit(1); }
console.log(`✓ signtext: ${checks} checks — every lettering face and pictogram exists, draws inside its cell, is documented, and is in the texture key.`);
