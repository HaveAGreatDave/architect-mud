// Smoke test for the character minigame skins and the drawing toolkit.
//
// It exists for the same reason shapes/smoke.mjs does: the only thing that ever
// exercised one of these files was a player opening that exact panel. Here the
// fragile part is the SKIN SEAM — each text renderer imports named functions out
// of its base game (`hololockSet`, `vaultTurn`, `signalSweep`, `breachActions`…),
// and a rename on either side is a link error nothing else in the build notices
// until somebody tries to pick a lock.
//
// The base games are imported for real, so ESM linking proves their exports
// exist. The skins can't be imported in node — they pull in render.js, whose
// chain reaches a browser-absolute `/shared/settings.js` — so their import lists
// are parsed and checked against the real export sets instead.
//
// Run: node scripts/shapes/textui-smoke.mjs   (also wired into pretest:regress)
import './dom-stub.mjs';
import { readFileSync } from 'node:fs';

const P = 'client/game/js/panels/';
let failed = 0;
const bad = (m) => { console.error(`  ✗ ${m}`); failed++; };

// ── The base games: import for real ──────────────────────────────────────────
const BASES = ['circuithack', 'hololock', 'vaultcrack', 'signalhijack'];
const exportsOf = {};
for (const b of BASES) {
  try {
    exportsOf[b] = new Set(Object.keys(await import(`../../${P}${b}.js`)));
    console.log(`  ✓ ${b}.js links`);
  } catch (e) {
    bad(`${b}.js failed to link — ${e.message}`);
    exportsOf[b] = new Set();
  }
}

// Every base must still offer a skin seam. Losing one silently would strand its
// text renderer on a game it can no longer drive.
const SEAM = {
  circuithack: ['setBreachSkin', 'generateBreach', 'breachActions'],
  hololock: ['setHololockSkin', 'startHololockGame', 'stopHololockGame', 'hololockSet', 'hololockPos'],
  vaultcrack: ['setVaultSkin', 'startVaultGame', 'stopVaultGame', 'vaultTurn', 'vaultSet', 'vaultBand'],
  signalhijack: ['setSignalSkin', 'startSignalGame', 'stopSignalGame', 'signalSweep', 'signalOverdrive', 'signalTune', 'SIGNAL_W'],
};
for (const [b, names] of Object.entries(SEAM)) {
  for (const n of names) if (!exportsOf[b].has(n)) bad(`${b}.js no longer exports ${n} — its skin cannot drive the game`);
}

// ── The skins: check what they import actually exists ────────────────────────
const SKINS = {
  textbreach: 'circuithack', texthololock: 'hololock',
  textvault: 'vaultcrack', textsignal: 'signalhijack',
};
for (const [skin, base] of Object.entries(SKINS)) {
  const src = readFileSync(`${P}${skin}.js`, 'utf8');
  // Match the whole (possibly multi-line) named-import clause for this base.
  // `[^}]*` rather than a lazy `[\s\S]*?`: the clause cannot contain a brace, and
  // the lazy form happily spanned every earlier import in the file to reach this
  // one's `from`, reporting the entire preamble as a missing binding.
  const m = src.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'\\./${base}\\.js'`));
  if (!m) { bad(`${skin}.js does not import from ${base}.js at all`); continue; }
  const want = m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
  const missing = want.filter(w => !exportsOf[base].has(w));
  if (missing.length) bad(`${skin}.js imports ${missing.join(', ')} which ${base}.js does not export`);
  else console.log(`  ✓ ${skin}.js ← ${base}.js (${want.length} bindings)`);

  // The pieces dispatch.js and main.js reach for on every skin.
  for (const needed of ['export function command', 'export function close']) {
    if (!src.includes(needed)) bad(`${skin}.js is missing "${needed}"`);
  }
  if (!/export function openText\w+/.test(src)) bad(`${skin}.js exports no openText* entry point`);
  if (!/export function isText\w+Active/.test(src)) bad(`${skin}.js exports no isText*Active guard`);
}

// ── The toolkit ──────────────────────────────────────────────────────────────
const ui = await import(`../../${P}textui.js`);
const row = ui.paintRow([{ ch: 'a', cls: 'x' }, { ch: 'b', cls: 'x' }, { ch: 'c', cls: 'y' }]);
if ((row.match(/<span/g) || []).length !== 2) bad('paintRow stopped run-length encoding — a panel would emit a span per character at frame rate');
if (row.replace(/<[^>]*>/g, '') !== 'abc') bad('paintRow reordered or dropped cells');
if (!ui.paintRow([{ ch: '<', cls: 'x' }]).includes('&lt;')) bad('paintRow stopped escaping markup');
if ((ui.bar(9, 4).match(/█/g) || []).length !== 4) bad('bar stopped clamping above 1');
if (ui.heading('X', 20).replace(/<[^>]*>/g, '').length !== 20) bad('heading stopped padding to width');
console.log('  ✓ textui.js helpers');

if (failed) { console.error(`\n✗ textui:smoke — ${failed} problem(s).`); process.exit(1); }
console.log('✓ textui:smoke clean.');
