// What cockpit.js does with a 3-D cockpit's controls, read off its source: the ids DK_ACT acts on, the
// ids DK_TIP names, and the hotspot kinds the pointer handler knows. Shared by the cockpit gates.
//
// Read, not imported: the tables are object literals inside openFlightSim, and importing cockpit.js
// needs the whole client. A regex over the raw text is not enough either, because DK_TIP's values are
// full of quoted words before a ':' (`'running · …' : 'off · …'`), so this walks the literal and takes
// only its own keys: the ones at its top level, after its '{' or a ','.
import { readFileSync } from 'node:fs';

const SRC_URL = new URL('../../client/game/js/panels/cockpit.js', import.meta.url);

// The index just past the string, template literal or comment that starts at `i`.
function skipQuoted(s, i) {
  const q = s[i];
  if (q === '/' && s[i + 1] === '/') { const j = s.indexOf('\n', i); return j < 0 ? s.length : j; }
  if (q === '/' && s[i + 1] === '*') { const j = s.indexOf('*/', i + 2); return j < 0 ? s.length : j + 2; }
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === q) return j + 1;
    if (q === '`' && c === '$' && s[j + 1] === '{') j = skipCode(s, j + 2) - 1;
  }
  return s.length;
}
const opensQuoted = (s, i) => s[i] === "'" || s[i] === '"' || s[i] === '`' || (s[i] === '/' && (s[i + 1] === '/' || s[i + 1] === '*'));
// The index just past the '}' that closes code starting at `i` (a template's `${`).
function skipCode(s, i) {
  for (let depth = 0; i < s.length;) {
    if (opensQuoted(s, i)) { i = skipQuoted(s, i); continue; }
    const c = s[i++];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { if (depth === 0) return i; depth--; }
  }
  return i;
}

// The top-level keys of the object literal assigned by `const <name> = {`, or null if there is none.
export function literalKeys(src, name) {
  const at = src.indexOf('const ' + name + ' = {');
  if (at < 0) return null;
  const keys = new Set();
  let i = src.indexOf('{', at) + 1, depth = 0, expectKey = true;
  const colonAfter = (j) => { while (/\s/.test(src[j])) j++; return src[j] === ':'; };
  while (i < src.length) {
    const c = src[i];
    if (opensQuoted(src, i)) {
      const j = skipQuoted(src, i);
      if (depth === 0 && expectKey && c !== '/' && colonAfter(j)) keys.add(src.slice(i + 1, j - 1));
      if (c !== '/') expectKey = false;
      i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      if (depth === 0 && expectKey && colonAfter(j)) keys.add(src.slice(i, j));
      expectKey = false; i = j; continue;
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { if (depth === 0) break; depth--; }
    else if (c === ',' && depth === 0) expectKey = true;
    else if (!/\s/.test(c)) expectKey = false;
    i++;
  }
  return keys;
}

// { ACT, TIP, KINDS }: three Sets, or null for any that could not be read (a caller fails on that,
// or its check would pass by finding nothing to check).
export function readDkTables(src = readFileSync(SRC_URL, 'utf8')) {
  const ACT = literalKeys(src, 'DK_ACT'), TIP = literalKeys(src, 'DK_TIP');
  // The kinds the press handler and the drag act on: every `.kind === '…'` between the drag code and
  // the wheel handler. 'click' goes to DK_ACT, 'rudder' is held, and the drags are named in dragMove.
  const a = src.indexOf('const dragMove'), b = src.indexOf("add(view, 'wheel'", a);
  const KINDS = a < 0 || b < 0 ? null : new Set([...src.slice(a, b).matchAll(/\.kind [!=]== '(\w+)'/g)].map((m) => m[1]));
  return { ACT: ACT?.size ? ACT : null, TIP: TIP?.size ? TIP : null, KINDS: KINDS?.size ? KINDS : null };
}
