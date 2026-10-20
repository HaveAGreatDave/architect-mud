// Proves an edit to a JS file changed only comments and whitespace.
//
//   node scripts/lint/comment-only.mjs <file>... [--ref <commit>]
//
// For each file, strips comments from the copy at <ref> (default HEAD) and from
// the working tree, collapses every run of whitespace to one space, and fails if
// the two differ. Strings, templates and regexes are kept, so a change inside a
// template or a regex still fails. Used by the comment trim (see
// docs/audits/findings-2026-10-efficiency.md); a comment pass is only safe if
// this is green on every file it touched.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PRE_KEYWORD = /(?:^|[^\w$])(return|typeof|case|in|of|do|else|yield|await|void|delete|instanceof)$/;

// The same scan as scripts/lib/blank-scanner.mjs, but only comments are removed.
export function stripComments(src) {
  let out = '';
  const n = src.length;
  const stack = ['code'];
  let prev = '';
  let i = 0;
  while (i < n) {
    const mode = stack[stack.length - 1];
    const c = src[i];
    const d = src[i + 1];
    if (mode === 'tpl') {
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
      if (c === '`') { stack.pop(); out += c; prev = 'x'; i++; continue; }
      if (c === '$' && d === '{') { stack.push('int'); out += '${'; i += 2; continue; }
      out += c; i++; continue;
    }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; out += ' '; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; out += ' '; continue; }
    if (c === '"' || c === "'") {
      const s = i; i++;
      while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === c) { i++; break; } if (src[i] === '\n') break; i++; }
      out += src.slice(s, i); prev = 'x'; continue;
    }
    if (c === '`') { stack.push('tpl'); out += c; i++; continue; }
    if (c === '/') {
      const isRegex = prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev) || PRE_KEYWORD.test(src.slice(Math.max(0, i - 12), i));
      if (isRegex) {
        const s = i; i++;
        let inClass = false;
        while (i < n) {
          const e = src[i];
          if (e === '\\') { i += 2; continue; }
          if (e === '[') inClass = true;
          else if (e === ']') inClass = false;
          else if (e === '/' && !inClass) { i++; break; }
          else if (e === '\n') break;
          i++;
        }
        out += src.slice(s, i); prev = 'x'; continue;
      }
    }
    if (mode !== 'code' && c === '{') stack.push('brace');
    if (mode !== 'code' && c === '}') stack.pop();
    if (!/\s/.test(c)) prev = c;
    out += c; i++;
  }
  return out;
}

const squash = (s) => stripComments(s.replace(/\r\n/g, '\n')).replace(/\s+/g, ' ').trim();

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('comment-only.mjs')) {
  const args = process.argv.slice(2);
  const r = args.indexOf('--ref');
  const ref = r >= 0 ? args.splice(r, 2)[1] : 'HEAD';
  if (!args.length) { console.error('usage: node scripts/lint/comment-only.mjs <file>... [--ref <commit>]'); process.exit(2); }
  let bad = 0;
  for (const f of args) {
    const before = execFileSync('git', ['show', `${ref}:${f.replace(/\\/g, '/')}`], { encoding: 'utf8', maxBuffer: 1e9 });
    const a = squash(before), b = squash(readFileSync(f, 'utf8'));
    if (a === b) { console.log(`✓ ${f}: comments only`); continue; }
    bad++;
    let k = 0; while (a[k] === b[k]) k++;
    console.log(`✗ ${f}: code changed near\n  was: ${JSON.stringify(a.slice(Math.max(0, k - 60), k + 60))}\n  now: ${JSON.stringify(b.slice(Math.max(0, k - 60), k + 60))}`);
  }
  process.exit(bad ? 1 : 0);
}
