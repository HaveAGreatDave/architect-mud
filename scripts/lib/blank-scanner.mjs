// THE ONE COMMENT/TEMPLATE/REGEX BLANKER, shared by every script that reads JS as text.
//
// ⚠ THERE IS ONE OF THESE ON PURPOSE. imports/smoke.mjs's own note records ten false findings from
// a first cut that scanned raw source, and they were false for one reason: this repo's files are
// largely prose, and prose contains every token a scanner looks for. Two scanners means the weaker
// one decides what the stronger one sees.
// ── blanking scanner ────────────────────────────────────────────────────────
// Replaces comment / template / regex spans with spaces, keeping newlines and
// total length so every offset still maps to its original line. Ordinary quoted
// strings are KEPT, because the module specifier lives in one.
export function blank(src) {
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
