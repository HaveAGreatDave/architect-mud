// GENERATE THE LAZY FACADES FOR THE TWO BIG 3-D MODULES.
//
// windshield-lazy.js and aircraft3d-lazy.js have the same export names as windshield.js (GLASS)
// and aircraft3d.js. A panel that imports from the facade changes one import line and awaits one
// loader (`loadWindshield()` or `loadAircraft3d()`) on the path that opens its view, and the real
// module isn't fetched until then. That's cheaper and safer than rewriting every call site to go
// through a stashed module object, where each missed site is a view that doesn't open.
//
// The facades were written when seven view panels imported both modules statically, so every
// player downloaded the whole 3-D stack at boot. lazy-views.js now defers those panels whole. A
// facade is still for a panel that loads without GLASS and fetches it later: hangar-bay.js opens
// a menu first and only needs the renderer once a view opens. Nothing imports aircraft3d-lazy.js
// at the moment, but it's baked and checked like the other.
//
// ⚠ ESM LIVE BINDINGS ARE WHAT MAKE THE VALUE EXPORTS WORK. A wrapper can forward a function call,
// but `RENDER_TUNE` and `ROOF_CATCH_R` are values and there's nothing to forward. The facade
// declares them with `export let` and assigns them once the dynamic import lands. Every importer
// sees the new value, because an ESM import is a live binding. Read one before the loader resolves
// and it's undefined.
//
// ⚠ A WRAPPER CALLED BEFORE THE LOAD THROWS BY NAME. The risk left in this design is a panel that
// uses a symbol without having awaited the loader. The default failure for that is `_m is null`, a
// TypeError from inside a generated file that names nothing, so each wrapper names itself and says
// what to do instead.
//
// ⚠ IT'S A CHECKED-IN GENERATED FILE, like `client/shared/building-models.js`. There's no build
// step in this repo, and a facade computed at runtime would be a second module graph.
//
// ⚠ AND IT CHECKS ITSELF. `--check` re-bakes in memory and fails if the result differs from what's
// on disk, the same shape as `content:check-stale`. It's a gate in the client group of
// scripts/gates/manifest.mjs, so `pretest:regress` and the pre-push hook run it. A stale facade
// breaks in two ways. An export removed or renamed in the module stays on the facade, and a panel
// that uses it gets undefined from a value, or a TypeError at the call from a wrapper, with nothing
// at load time to say why. An export added to the module is missing from the facade, so a panel
// that imports it fails to link, which imports:smoke reports.
//
//   npm run client:bake-lazy          # regenerate after changing an export in either module
//   npm run client:bake-lazy:check    # fail if a checked-in facade is out of date
import fs from 'node:fs';
import path from 'node:path';
import { blank } from '../lib/blank-scanner.mjs';

const ROOT = process.cwd();
const PANELS = path.join(ROOT, 'client/game/js/panels');
const CHECK = process.argv.includes('--check');
const stale = [];

// What each facade covers, and what it installs once the real module is in.
const JOBS = [
  {
    src: 'windshield.js',
    out: 'windshield-lazy.js',
    loader: 'loadWindshield',
    // ⚠ GL INSTALLS ITSELF FROM OUTSIDE, and that is the reason install.js exists at all — its own
    // header says windshield.js must stay importable where a GPU does not exist. It was reached at
    // boot through main.js, which is the last edge holding the 3-D stack in the eager graph, so it
    // moves here: the one place that already knows the real module has arrived.
    after: "  try { (await import('./gl/install.js')).installGL?.(); } catch (e) { console.error('[windshield-lazy] GL install failed, staying on the 2-D renderer:', e?.message); }",
  },
  { src: 'aircraft3d.js', out: 'aircraft3d-lazy.js', loader: 'loadAircraft3d', after: '' },
];

// ── read the export list ─────────────────────────────────────────────────────
function exportsOf(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const s = blank(raw);
  const fns = new Set();
  const vals = new Set();

  for (const m of s.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) fns.add(m[1]);
  for (const m of s.matchAll(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm)) vals.add(m[1]);

  // `export const X = …` — a function expression is a function, anything else is a value.
  //
  // ⚠ ONE STATEMENT CAN DECLARE SEVERAL NAMES, and reading only the first is the exact trap
  // `imports/smoke.mjs` records in its own header. `export const ROOF_CATCH_R = 0.45,
  // ROOF_CATCH_CEIL_Z = 0.5;` is three of these in windshield.js, and taking the first name
  // would leave four symbols off the facade — which `imports:smoke` then fails on, loudly, but
  // only after the panels had been rewired. The declarator list is split on top-level commas:
  // an initialiser can itself hold commas inside (), [] or {}, so depth is tracked rather than
  // the line being split naively.
  for (const m of s.matchAll(/^export\s+(?:const|let|var)\s+([^\n]*)/gm)) {
    const decl = m[1];
    let depth = 0, start = 0;
    const parts = [];
    for (let i = 0; i < decl.length; i++) {
      const c = decl[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) { parts.push(decl.slice(start, i)); start = i + 1; }
    }
    parts.push(decl.slice(start));
    for (const part of parts) {
      const d = /^\s*([A-Za-z_$][\w$]*)\s*(=([\s\S]*))?$/.exec(part);
      if (!d) continue;
      const rhs = d[3] || '';
      // The parameter list may not hold a paren, so an IIFE such as `GL_TIER = (() => { ... })()`
      // stays a value: it starts `((`, and its result is what gets exported.
      const isFn = /^\s*(?:async\s*)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(rhs);
      (isFn ? fns : vals).add(d[1]);
    }
  }
  // a bare `export let X;` with no initialiser is a value
  for (const m of s.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*;/gm)) vals.add(m[1]);

  // Where a re-exported name is declared. windshield.js passes on some names it doesn't declare
  // (its building-model tables and kit live under glass/), either as `export { a } from './x.js'`
  // or as an import plus a bare `export { a }`. Those are classified by how ./x.js declares them,
  // or a function would come out as a value. Relative specifiers only.
  const origin = new Map();   // name as written in the export list -> [file, name in that file]
  for (const m of s.matchAll(/^(import|export)\s*\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    for (const part of m[2].split(',')) {
      const [a, b] = part.trim().split(/\s+as\s+/).map((x) => x && x.trim());
      if (a) origin.set(m[1] === 'import' ? (b || a) : a, [path.resolve(path.dirname(file), m[3]), a]);
    }
  }
  const declaresFn = (text, name) => new RegExp('^\\s*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + name + '\\b', 'm').test(text)
    || new RegExp('^\\s*(?:export\\s+)?(?:const|let|var)\\s+' + name + '\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^()]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)', 'm').test(text);

  // `export { a, b as c }` — resolve each to how it was declared in this file.
  for (const m of s.matchAll(/^export\s*\{([^}]*)\}\s*;?/gm)) {
    // A list tagged `// glass-internal` after its closing brace is for windshield.js's own
    // submodules (the building-model arms under glass/models/), not for panels, so it stays off
    // the facade. A panel that imports one of these fails imports:smoke instead of getting it.
    // The tag is a comment, so it's read from the raw text; blank() keeps offsets.
    const close = m.index + m[0].lastIndexOf('}');
    const eol = raw.indexOf('\n', close);
    if (/\/\/\s*glass-internal\b/.test(raw.slice(close, eol < 0 ? raw.length : eol))) continue;
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const local = bits[0]?.trim();
      const shown = (bits[1] || bits[0] || '').trim();
      if (!shown || !/^[A-Za-z_$][\w$]*$/.test(shown)) continue;
      if (fns.has(shown) || vals.has(shown)) continue;
      const from = origin.get(local);
      const declFn = declaresFn(s, local)
        || (!!from && fs.existsSync(from[0]) && declaresFn(blank(fs.readFileSync(from[0], 'utf8')), from[1]));
      (declFn ? fns : vals).add(shown);
    }
  }
  return { fns: [...fns].sort(), vals: [...vals].sort() };
}

// ── emit ─────────────────────────────────────────────────────────────────────
for (const job of JOBS) {
  const { fns, vals } = exportsOf(path.join(PANELS, job.src));
  const L = [];
  L.push('// GENERATED by scripts/client/bake-lazy-view.mjs — do not edit by hand.');
  L.push('//');
  L.push(`// A lazy facade over ./${job.src}. Same export names, so an importing panel changes one`);
  L.push(`// line; the module itself is fetched on the first \`${job.loader}()\`, which every path that`);
  L.push('// opens an immersive view awaits before it draws anything. See the generator for why.');
  L.push('');
  L.push('let _m = null;');
  L.push('let _pending = null;');
  L.push('');
  L.push('// Value exports, filled on load. These are ESM LIVE BINDINGS: an importer that reads one');
  L.push(`// after \`${job.loader}()\` has resolved sees the real value, because an import binds rather`);
  L.push('// than copies. Read one before that and it is undefined, which is why the loader is awaited');
  L.push('// at the door rather than at the first use.');
  if (vals.length) L.push('export let ' + vals.join(', ') + ';');
  L.push('');
  L.push(`export function isLoaded() { return !!_m; }`);
  L.push('');
  L.push(`export function ${job.loader}() {`);
  L.push('  if (_m) return Promise.resolve(_m);');
  L.push('  if (_pending) return _pending;');
  L.push('  _pending = (async () => {');
  L.push(`    const m = await import('./${job.src}');`);
  for (const v of vals) L.push(`    ${v} = m.${v};`);
  L.push('    _m = m;');
  if (job.after) L.push(job.after);
  L.push('    return m;');
  L.push('  })();');
  L.push('  return _pending;');
  L.push('}');
  L.push('');
  L.push('// ⚠ A WRAPPER CALLED BEFORE THE LOAD NAMES ITSELF. The one thing this refactor can get');
  L.push('// wrong is a path that uses a symbol without awaiting the loader, and `_m is null` is a');
  L.push('// TypeError from a generated file that points at nothing.');
  L.push('function _cold(name) {');
  L.push('  throw new Error(' + JSON.stringify(job.out + ': ') + ' + name + '
    + JSON.stringify('() was called before ' + job.loader + '() resolved — await it on the path that opens this view.') + ');');
  L.push('}');
  L.push('');
  for (const f of fns) L.push(`export function ${f}(...a) { return (_m || _cold('${f}')).${f}(...a); }`);
  L.push('');
  const text = L.join('\n') + '\n';
  const dest = path.join(PANELS, job.out);
  if (CHECK) {
    const have = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
    // ⚠ COMPARED WITHOUT LINE ENDINGS. core.autocrlf rewrites the checked-out copy on Windows, so
    // a byte comparison would fail on a clean tree for a reason that has nothing to do with staleness.
    if (have.replace(/\r\n/g, '\n') !== text) stale.push(job.out);
    else console.log(`  ✓ ${job.out.padEnd(22)} up to date`);
    continue;
  }
  fs.writeFileSync(dest, text, 'utf8');
  console.log(`  ${job.out.padEnd(22)} ${fns.length} function wrapper(s), ${vals.length} live value binding(s)`);
}
if (CHECK) {
  if (stale.length) {
    console.error(`\n✗ bake-lazy-view: ${stale.join(', ')} ${stale.length > 1 ? 'are' : 'is'} out of date.`);
    console.error('  An export in windshield.js or aircraft3d.js changed without a re-bake.');
    console.error('  Run: npm run client:bake-lazy\n');
    process.exit(1);
  }
  console.log('\n✓ bake-lazy-view: both facades match their modules.');
} else {
  console.log('\n  baked. Re-run after adding an export to either module.');
}
