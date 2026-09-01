// Every named import resolves to a real export, as a gate.
//
// WHY THIS EXISTS. On 2026-09-01 a commit shipped `plugins/surveillance/index.js`
// importing `drugForItem` from `server/engine/drugs.js` while the export it needs
// sat UNCOMMITTED in the working tree. The local suite passed 8988/8988 — against
// a tree that had the export — and CI, which checks out the commit, could not load
// the plugin at all. Surveillance owns `plant`, `retrieve`, `sweep`, `hijack`,
// `wanted`, `bribe`, `submit` and `scrub`, so the help-verb and object-gated-verb
// checks cascaded off it and every content deploy stopped.
//
// ⚠ THE WORKING TREE IS NOT THE THING BEING PUSHED, AND THAT IS THE WHOLE POINT.
// A checker that only ever reads the files on disk would have been green through
// all of it. So this takes `--ref <commit>` and checks THAT tree instead, and the
// pre-push hook passes it the oid it is about to send. Tree mode (no flag) is the
// cheap everyday check wired into pretest:regress; ref mode is the one that
// catches a change committed in halves.
//
// The failure mode it guards is specific: ESM resolves named imports at LINK time,
// before a single line runs. A missing export is not a bug that shows up when the
// feature is used — the module never loads, so everything the plugin owns quietly
// stops existing.
//
// ⚠ IT BLANKS COMMENTS, TEMPLATE LITERALS AND REGEX LITERALS BEFORE MATCHING, and
// that is not fastidiousness — a first cut that matched raw text reported eleven
// findings and ten were its own fault. Two forms did it, both of them ordinary
// house style: a multi-declarator `export const A = 0.45, B = 0.5;` (only the
// first name was seen) and, in inventory.js, a COMMENT INSIDE an `export { … }`
// block explaining why the symbol is exported — which is exactly the kind of
// comment we want people writing. Blanking preserves offsets, so reported line
// numbers still point at the real line.
//
// Only NAMED imports are checked. Default and namespace imports are left alone
// deliberately: proving a module has no default means being sure it is ESM, and
// being wrong there is a false positive on a push gate.
//
// ESCAPE HATCH: put `// imports-ok: <reason>` on the offending line or the line
// above it. The reason is required — a bare disable is how a lint dies.
//
// Run: node scripts/imports/smoke.mjs            (working tree)
//      node scripts/imports/smoke.mjs --ref HEAD (a commit; used by pre-push)
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOTS = ['server', 'plugins', 'client', 'scripts', 'tests', 'tools'];
// `temp` holds one-shots that ran once by hand; the rest never contain game code.
const SKIP_DIRS = new Set(['node_modules', '.git', 'temp', 'dist', 'build']);
const EXTS = ['.js', '.mjs'];
const OK_RE = /(?:^|\s)\/\/\s*imports-ok:\s*\S/;

// ── blanking scanner ────────────────────────────────────────────────────────
// Replaces comment / template / regex spans with spaces, keeping newlines and
// total length so every offset still maps to its original line. Ordinary quoted
// strings are KEPT, because the module specifier lives in one.
function blank(src) {
  const a = [...src];
  const n = a.length;
  const wipe = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (a[k] !== '\n') a[k] = ' ';
  };
  // A `/` starts a regex rather than a division when what precedes it cannot end
  // an expression. Tracked as the last significant char plus a small keyword set.
  const PRE_KEYWORD = /(?:^|[^\w$])(return|typeof|case|in|of|do|else|yield|await|void|delete|instanceof)$/;
  // ⚠ ONE STATE MACHINE, AND A TEMPLATE INTERPOLATION IS JUST CODE AGAIN. The
  // first cut scanned interpolations with a reduced copy of this loop that knew
  // about strings but not regexes, so `${h.replace(/"/g, '&quot;')}` — a regex
  // holding a double quote, which is what every HTML-building panel in this
  // client does — opened a phantom string and desynchronised the whole file after
  // it. Two scanners means the weaker one decides what the stronger one sees.
  //
  // The stack is what keeps templates and interpolations nesting honestly: a
  // counter that decremented on any `}` was unbalanced by an ordinary object
  // literal (`?? {}`) inside an interpolation, and the wipe ran off the end of
  // the template and ate the real code after it.
  const stack = ['code'];                  // 'code' | 'tpl' | 'int' | 'brace'
  let tplStart = -1;                       // where the OUTERMOST template began
  let prev = '';
  let i = 0;
  while (i < n) {
    const mode = stack[stack.length - 1];
    const c = a[i];
    const d = a[i + 1];

    if (mode === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') {
        stack.pop();
        if (stack.length === 1) { wipe(tplStart, i + 1); prev = 'x'; }
        i++; continue;
      }
      if (c === '$' && d === '{') { stack.push('int'); i += 2; continue; }
      i++; continue;
    }

    // code-like: 'code', 'int', 'brace' all scan the same way.
    if (c === '/' && d === '/') { const s = i; while (i < n && a[i] !== '\n') i++; wipe(s, i); continue; }
    if (c === '/' && d === '*') { const s = i; i += 2; while (i < n && !(a[i] === '*' && a[i + 1] === '/')) i++; i += 2; wipe(s, i); continue; }
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < n) { if (a[i] === '\\') { i += 2; continue; } if (a[i] === q) { i++; break; } if (a[i] === '\n') break; i++; }
      prev = 'x'; continue;                       // kept intact — specifiers live here
    }
    if (c === '`') { if (stack.length === 1) tplStart = i; stack.push('tpl'); i++; continue; }
    if (c === '/') {
      const isRegex = prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev) || PRE_KEYWORD.test(src.slice(0, i));
      if (isRegex) {
        const s = i; i++;
        let inClass = false;
        while (i < n) {
          const e = a[i];
          if (e === '\\') { i += 2; continue; }
          if (e === '[') inClass = true;
          else if (e === ']') inClass = false;
          else if (e === '/' && !inClass) { i++; break; }
          else if (e === '\n') break;
          i++;
        }
        wipe(s, i); prev = 'x'; continue;
      }
    }
    if (mode !== 'code' && c === '{') { stack.push('brace'); i++; continue; }
    if (mode !== 'code' && c === '}') { stack.pop(); i++; continue; }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  // An unterminated template (or one this scanner lost) must not silently keep
  // the tail of the file: wipe what it claimed rather than trusting the rest.
  if (stack.length > 1 && tplStart >= 0) wipe(tplStart, n);
  return a.join('');
}

// Split on commas that sit at bracket depth zero.
function topLevelCommas(text) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

// The names a `const`/`let`/`var` declaration list binds, destructuring included.
function boundNames(decls) {
  const names = [];
  for (const d of topLevelCommas(decls)) {
    let depth = 0, cut = d.length;
    for (let i = 0; i < d.length; i++) {
      const c = d[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === '=' && depth === 0 && d[i + 1] !== '=' && d[i - 1] !== '=' && d[i - 1] !== '!' && d[i - 1] !== '<' && d[i - 1] !== '>') { cut = i; break; }
    }
    const binding = d.slice(0, cut).trim();
    if (!binding) continue;
    if (binding[0] === '{' || binding[0] === '[') {
      // `{ a, b: c, d = 1 }` binds a, c, d — the name after a colon wins.
      for (const part of topLevelCommas(binding.slice(1, -1))) {
        const p = part.trim().replace(/^\.\.\./, '');
        if (!p) continue;
        const m = p.match(/^(?:[A-Za-z0-9_$]+\s*:\s*)?([A-Za-z0-9_$]+)/);
        if (m) names.push(m[1]);
      }
    } else {
      const m = binding.match(/^([A-Za-z0-9_$]+)/);
      if (m) names.push(m[1]);
    }
  }
  return names;
}

function specifierNames(inner) {
  const out = [];
  for (const part of topLevelCommas(inner)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^([A-Za-z0-9_$]+)(?:\s+as\s+([A-Za-z0-9_$]+))?$/);
    if (m) out.push({ imported: m[1], local: m[2] || m[1] });
  }
  return out;
}

// ── sources ─────────────────────────────────────────────────────────────────
function fsSource(root) {
  const files = [];
  for (const r of ROOTS) {
    const base = join(root, r);
    if (!existsSync(base)) continue;
    (function walk(dir) {
      for (const e of readdirSync(dir)) {
        if (SKIP_DIRS.has(e)) continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (EXTS.some((x) => e.endsWith(x))) files.push(p);
      }
    })(base);
  }
  return {
    files,
    label: (p) => relative(root, p).split(sep).join('/'),
    read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
    exists: (p) => existsSync(p) && statSync(p).isFile(),
  };
}

// ── the check ───────────────────────────────────────────────────────────────
function resolveSpec(fromFile, spec, src) {
  const base = resolve(dirname(fromFile), spec);
  const tries = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, 'index' + e))];
  for (const t of tries) if (src.exists(t)) return t;
  return null;
}

const exportCache = new Map();

// The export names a module provides, following `export * from` re-exports.
// Returns null when a star cannot be resolved — an unknown set is never checked,
// because guessing there is a false positive on a push gate.
function exportsOf(file, src, seen = new Set()) {
  if (exportCache.has(file)) return exportCache.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);
  const raw = src.read(file);
  if (raw == null) return null;
  const s = blank(raw);
  const names = new Set();
  let unknown = false;

  for (const m of s.matchAll(/\bexport\s+(default\s+)?(?:async\s+)?(?:function\s*\*?|class)\s+([A-Za-z0-9_$]+)/g))
    names.add(m[1] ? 'default' : m[2]);
  if (/\bexport\s+default\b/.test(s)) names.add('default');

  for (const m of s.matchAll(/\bexport\s+(?:const|let|var)\s+/g)) {
    const start = m.index + m[0].length;
    let depth = 0, end = s.length;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ';' && depth === 0) { end = i; break; }
    }
    for (const nm of boundNames(s.slice(start, end))) names.add(nm);
  }

  for (const m of s.matchAll(/\bexport\s*\{([^}]*)\}(\s*from\s*['"]([^'"]+)['"])?/g))
    for (const sp of specifierNames(m[1])) names.add(sp.local);

  for (const m of s.matchAll(/\bexport\s*\*\s*(?:as\s+([A-Za-z0-9_$]+)\s+)?from\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) { names.add(m[1]); continue; }
    const target = resolveSpec(file, m[2], src);
    const sub = target ? exportsOf(target, src, seen) : null;
    if (!sub) unknown = true;
    else for (const nm of sub) names.add(nm);
  }

  const result = unknown ? null : names;
  exportCache.set(file, result);
  return result;
}

function run(src) {
  const problems = [];
  for (const file of src.files) {
    const raw = src.read(file);
    if (raw == null) continue;
    const s = blank(raw);
    const rawLines = raw.split('\n');
    const lineAt = (idx) => s.slice(0, idx).split('\n').length;
    const excused = (line) => OK_RE.test(rawLines[line - 1] || '') || OK_RE.test(rawLines[line - 2] || '');

    const uses = [];
    for (const m of s.matchAll(/\bimport\s+([^;'"]*?)\s+from\s*['"](\.[^'"]*)['"]/g))
      uses.push({ idx: m.index, clause: m[1], spec: m[2] });
    for (const m of s.matchAll(/\bimport\s*['"](\.[^'"]*)['"]/g))
      uses.push({ idx: m.index, clause: '', spec: m[1] });
    for (const m of s.matchAll(/\bexport\s*(?:\{[^}]*\}|\*(?:\s+as\s+[A-Za-z0-9_$]+)?)\s*from\s*['"](\.[^'"]*)['"]/g))
      uses.push({ idx: m.index, clause: '', spec: m[1] });

    for (const u of uses) {
      const line = lineAt(u.idx);
      if (excused(line)) continue;
      const target = resolveSpec(file, u.spec, src);
      if (!target) {
        problems.push(`${src.label(file)}:${line}  imports '${u.spec}' — no such module`);
        continue;
      }
      const braces = u.clause.match(/\{([^}]*)\}/);
      if (!braces) continue;                       // default / namespace — not checked
      const ex = exportsOf(target, src);
      if (!ex) continue;                           // unresolvable star re-export
      for (const sp of specifierNames(braces[1])) {
        if (!ex.has(sp.imported))
          problems.push(`${src.label(file)}:${line}  imports { ${sp.imported} } from '${u.spec}' — not exported by ${src.label(target)}`);
      }
    }
  }
  return problems;
}

// ── entry ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const refIdx = argv.indexOf('--ref');
const ref = refIdx >= 0 ? argv[refIdx + 1] : null;
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

let problems;
let scanned = 0;
if (ref) {
  // A detached worktree rather than `git show` per file: one checkout beats a
  // process spawn per module, and it lets ref mode reuse the fs walker exactly.
  const tmp = mkdtempSync(join(tmpdir(), 'imports-'));
  execFileSync('git', ['worktree', 'add', '--detach', '--quiet', tmp, ref], { cwd: repo });
  try {
    const src = fsSource(tmp);
    scanned = src.files.length;
    problems = run(src);
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', tmp], { cwd: repo }); } catch { /* best effort */ }
  }
} else {
  const src = fsSource(repo);
  scanned = src.files.length;
  problems = run(src);
}

const where = ref ? `commit ${ref}` : 'working tree';
if (problems.length) {
  console.error(`\n✗ imports:smoke — ${problems.length} unresolved import(s) in the ${where}:\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('\n  ESM resolves these at link time, so the module never loads and everything');
  console.error('  it owns silently stops existing. If the export is in your working tree but');
  console.error('  not in the commit, you have committed half a change — ship the other half.');
  console.error('  Genuine false positive?  // imports-ok: <reason>\n');
  process.exit(1);
}
console.log(`imports:smoke — ${scanned} files, every named import resolves (${where}).`);
