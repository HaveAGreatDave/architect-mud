// gl:core-lint: no new copies of what client/game/js/panels/gl/core/ holds (docs/proposals/gl-core.md).
//
//   node scripts/gl/core-lint.mjs              check against the baseline (runs in the push gate)
//   node scripts/gl/core-lint.mjs --list       print every counted hit, change nothing
//   node scripts/gl/core-lint.mjs --update     rewrite the baseline after moving a copy onto the core
//
// Every renderer used to carry its own matrix sums, its own tone curve, its own shader compile and
// its own context-loss handling. gl/core/ is the one copy. This counts the copies still outside it,
// per file, in scripts/gl/core-baseline.json: a file's count may go down, never up, and a new file
// starts at zero. So a renderer can be moved over a piece at a time, and nobody adds a seventh ACES.
//
// What it counts, in code and in shader source (GLSL lives in template strings, so strings count):
//   aces           the ACES fit, 2.51 * x + 0.03          use ACES_GLSL from core/glsl/tone.js
//   mat4           a local perspective, lookAt, invert, inv4, invert4, mul4, mat4mul or multiply
//                  function                                use core/mat4.js
//   createShader   gl.createShader(                        use takeWarm / compileShader (programs.js)
//   minFilter      TEXTURE_MIN_FILTER                      core/texture.js, when it lands
//   contextLost    a 'webglcontextlost' listener           core/lost.js, when it lands
//
// Comments don't count. Files under gl/core/ don't count. No database, no port, and it writes
// nothing unless --update is passed.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASELINE = join(ROOT, 'scripts', 'gl', 'core-baseline.json');
const UPDATE = process.argv.includes('--update');
const LIST = process.argv.includes('--list');

const ROOTS = ['client', 'tools'];
const EXT = /\.(m?js|html)$/;
const SKIP_DIRS = new Set(['node_modules', 'temp']);
const CORE = 'client/game/js/panels/gl/core/';

const PATTERNS = [
  { id: 'aces', re: /2\.51\s*\*\s*\w+\s*\+\s*0\.03/g },
  { id: 'mat4', re: /function\s+(?:perspective|lookAt|invert4?|inv4|mul4|mat4mul|multiply)\s*\(/g },
  { id: 'createShader', re: /\bgl\.createShader\s*\(/g },
  { id: 'minFilter', re: /TEXTURE_MIN_FILTER/g },
  { id: 'contextLost', re: /['"]webglcontextlost['"]/g },
];
const ANY = new RegExp(PATTERNS.map((p) => p.re.source).join('|'));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');

// Is position `at` on this line inside a comment? The same rule scale:lint uses: a false call only
// ever means one hit more or less in a ratchet.
function inComment(line, at) {
  const t = line.trimStart();
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return true;
  const pre = line.slice(0, at);
  if (/(^|[^:'"`\\/])\/\//.test(pre)) return true;
  const open = pre.lastIndexOf('/*');
  return open >= 0 && pre.indexOf('*/', open) < 0;
}

const counts = {};
const hits = [];
for (const root of ROOTS) {
  for (const p of walk(join(ROOT, root))) {
    const key = rel(p);
    if (key.startsWith(CORE)) continue;
    const src = readFileSync(p, 'utf8');
    if (!ANY.test(src)) continue;
    const lines = src.split(/\r?\n/);
    const byId = {};
    lines.forEach((line, i) => {
      if (!ANY.test(line)) return;
      for (const { id, re } of PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          if (inComment(line, m.index)) continue;
          byId[id] = (byId[id] || 0) + 1;
          hits.push({ key, line: i + 1, id, text: line.trim().slice(0, 140) });
        }
      }
    });
    if (Object.keys(byId).length) counts[key] = byId;
  }
}

if (LIST) {
  for (const h of hits) console.log(`${h.key}:${h.line}  [${h.id}]  ${h.text}`);
  console.log(`\n${hits.length} hits in ${Object.keys(counts).length} files.`);
  process.exit(0);
}

if (UPDATE) {
  const sorted = {};
  for (const k of Object.keys(counts).sort()) sorted[k] = Object.fromEntries(Object.keys(counts[k]).sort().map((id) => [id, counts[k][id]]));
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`gl:core-lint baseline written: ${hits.length} hits in ${Object.keys(sorted).length} files.`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const worse = [];
let better = 0;
for (const [key, byId] of Object.entries(counts)) {
  for (const [id, n] of Object.entries(byId)) {
    const was = (base[key] && base[key][id]) || 0;
    if (n > was) worse.push({ key, id, n, was });
  }
}
for (const [key, byId] of Object.entries(base)) {
  for (const [id, was] of Object.entries(byId)) if (((counts[key] && counts[key][id]) || 0) < was) better++;
}

if (worse.length) {
  console.error('gl:core-lint: a copy of something gl/core/ already holds.\n');
  for (const w of worse) {
    console.error(`  ${w.key} [${w.id}]: ${w.n} (baseline ${w.was})`);
    for (const h of hits.filter((h) => h.key === w.key && h.id === w.id)) console.error(`    ${h.line}  ${h.text}`);
  }
  console.error('\nUse client/game/js/panels/gl/core/ (mat4.js, glsl/tone.js) or programs.js instead.');
  console.error('If the hit is a coincidence, run node scripts/gl/core-lint.mjs --update and say why in the commit.');
  process.exit(1);
}
if (better) console.log(`gl:core-lint: ${better} count(s) dropped below the baseline; run node scripts/gl/core-lint.mjs --update to lock it in.`);
