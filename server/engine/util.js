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
