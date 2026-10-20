// Small helpers that dozens of modules were each writing their own copy of.
// Import them from here rather than adding another.

// A random element of arr (undefined when it's empty).
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// A random integer from min to max, both included.
export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// First letter upper-cased. Null and undefined come back as ''.
export function cap(s) {
  const t = String(s ?? '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// "a"/"an" before a name, keeping its casing. A name whose last word reads as a
// plural (ends in s but not ss) gets no article.
export function withArticle(name) {
  const lastWord = name.trim().split(/\s+/).pop();
  if (/s$/i.test(lastWord) && !/ss$/i.test(lastWord)) return name;
  return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
}

// A weighted pick: each entry's `weight` (at least 1) is its share of the draw.
export function pickWeighted(entries) {
  const total = entries.reduce((s, e) => s + Math.max(1, e.weight), 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= Math.max(1, e.weight);
    if (r < 0) return e;
  }
  return entries[entries.length - 1];
}

// value, halved every halfLife ms since the timestamp `at`.
export function decayed(value, at, halfLife) {
  if (!(value > 0)) return 0;
  const elapsed = Date.now() - (at || 0);
  if (elapsed <= 0) return value;
  return value * Math.pow(0.5, elapsed / halfLife);
}
