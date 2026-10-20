// Seeded randomness for anything that has to roll the same way twice: a room off
// its salt, a market off its day. Changing either function re-rolls every result
// seeded with it, so leave the arithmetic alone.

// FNV-1a over a string's UTF-16 code units, as an unsigned 32-bit seed.
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// mulberry32: a 32-bit seed to a function returning floats in [0, 1).
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
