// SQL-shaped matching over the furniture cache.
//
// Command paths used to SELECT from furniture with ILIKE and ORDER BY; they now
// read getZoneFurniture() instead (docs/architecture.md, read tiers). These
// helpers keep each converted site's semantics the same as its old SQL, so a
// player who typed `%` or `_` still gets what Postgres gave them.

const _likeCache = new Map();

// Postgres ILIKE: `%` is any run, `_` is one character, `\` escapes the next
// character. Case-insensitive; `%` matches across newlines.
export function ilike(text, pattern) {
  if (text == null || pattern == null) return false;
  let re = _likeCache.get(pattern);
  if (!re) {
    const chars = [...pattern];
    let src = '';
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (c === '\\' && i + 1 < chars.length) src += escapeRe(chars[++i]);
      else if (c === '%') src += '.*';
      else if (c === '_') src += '.';
      else src += escapeRe(c);
    }
    re = new RegExp(`^${src}$`, 'isu');
    if (_likeCache.size > 500) _likeCache.clear();
    _likeCache.set(pattern, re);
  }
  return re.test(String(text));
}

// Only the syntax characters: under the `u` flag escaping anything else is an error.
function escapeRe(c) { return /[.*+?^${}()|[\]\\/]/.test(c) ? `\\${c}` : c; }

// `flags->>'key'`: a string comes back bare, anything else as its JSON text,
// a missing key or JSON null as SQL NULL.
export function jsonText(v) {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

// `jsonb_exists(flags, key)`: the key is present at the top level, whatever its value.
export function hasKey(flags, key) {
  return !!flags && typeof flags === 'object' && Object.prototype.hasOwnProperty.call(flags, key);
}

// Text ORDER BY under prod's C.UTF-8 collation: code-point order, NULLs last
// for ASC.
export function cmpText(a, b) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
