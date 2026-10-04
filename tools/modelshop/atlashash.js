// THE ALBEDO BYTES, AS ONE NUMBER.
//
// The material plan (docs/proposals/glass-materials.md) changes the wall painters twice: the window
// mask re-runs the pane loop into a second page, and stage 4 teaches each painter a height channel.
// Both promise the albedo the GL atlas is built from doesn't move, and nothing headless can check
// that: the DOM stub's 2-D context draws nothing, so every gate passes a painter that paints a
// different wall.
//
// So this hashes every baked surface the atlas takes, for every palette key:
//
//   await __glAtlasHash({ save: 'before' })      // before the change; kept in this browser
//   // edit, reload the Modelshop
//   await __glAtlasHash({ against: 'before' })   // lists every surface whose bytes moved
//
// `allWins: true` adds the blackout, brownout and emergency night bakes; `texRes: 2` hashes at the
// cab's resolution. Both are off by default because each bakes and keeps another canvas per key.
//
// ⚠ THE NEON DIAL AND `texWin` ARE PART OF THE BAKE. Compare two hashes taken at the same settings,
// or every night wall in the city reads as changed.
import { wallPaletteKeys, bakedSurfaces } from '/client/game/js/panels/windshield.js';

// FNV-1a over the RGBA bytes, seeded with the size so a resize can't collide with a repaint.
function fnv(bytes, h) {
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function hashCanvas(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  return fnv(d, Math.imul(0x811c9dc5 ^ c.width, 0x01000193) ^ c.height).toString(16).padStart(8, '0');
}

const STORE = '__glAtlasHash:';

export async function atlasHash({ texRes = 1, allWins = false, save, against } = {}) {
  const t0 = performance.now();
  const surfaces = {};
  for (const key of wallPaletteKeys()) {
    for (const [what, c] of bakedSurfaces(key, { texRes, allWins })) surfaces[key + '|' + what] = c && c.width ? hashCanvas(c) : 'empty';
  }
  // One number for the whole set, over the sorted names so the order keys were baked in can't move it.
  const names = Object.keys(surfaces).sort();
  const all = fnv(new TextEncoder().encode(names.map((n) => n + '=' + surfaces[n]).join('\n')), 0x811c9dc5).toString(16).padStart(8, '0');
  const out = { hash: all, surfaces: names.length, texRes, allWins, ms: +(performance.now() - t0).toFixed(0), map: surfaces };
  // localStorage can be missing or full in a private window; a bench without it still prints.
  if (save) {
    try { localStorage.setItem(STORE + save, JSON.stringify(out)); } catch (e) { console.warn('__glAtlasHash: could not save', e); }
  }
  if (against) {
    let ref = null;
    try { ref = JSON.parse(localStorage.getItem(STORE + against) || 'null'); } catch { ref = null; }
    if (!ref) { out.diff = null; console.warn(`__glAtlasHash: nothing saved as '${against}'`); }
    else if (ref.texRes !== texRes || ref.allWins !== allWins) { out.diff = null; console.warn(`__glAtlasHash: '${against}' was taken at texRes ${ref.texRes}, allWins ${ref.allWins}`); }
    else {
      const keys = new Set([...Object.keys(ref.map), ...names]);
      out.diff = [...keys].filter((k) => ref.map[k] !== surfaces[k]).sort()
        .map((k) => ({ surface: k, was: ref.map[k] || 'absent', now: surfaces[k] || 'absent' }));
    }
  }
  const summary = { hash: out.hash, surfaces: out.surfaces, ms: out.ms, changed: out.diff ? out.diff.length : undefined };
  console.log('__glAtlasHash', JSON.stringify(summary));
  if (out.diff && out.diff.length) console.table(out.diff.slice(0, 40));
  return out;
}

if (typeof window !== 'undefined') window.__glAtlasHash = atlasHash;
