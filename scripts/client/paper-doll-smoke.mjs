// The Pack's paper doll (client/shared/paper-doll.js): every wearable and holdable item in content/ is drawn on it,
// alone and in a full outfit, on both bodies, and the drawing has to come out whole. A garment the doll can't read
// falls back to its slot's default, so this fails on a throw, a NaN or undefined in a path, or a worn item that
// draws nothing to pick, never on a guess at a cut. No browser, DB or network.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dollSvg, garmentOf } from '../../client/shared/paper-doll.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'content/items');
const LAYER = { underwear: 1, outerwear: 2, armor: 3 };
const rows = [];
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const t = j.tags || {};
  if (!t.slot) continue;
  rows.push({ id: j.id, name: j.name, slot: t.slot, layer: LAYER[t.layer] || (t.slot === 'weapon_hand' || t.slot === 'accessory' ? 0 : 2), covers: t.covers, skill: t.weapon_skill, worn: true });
}
const problems = [];
const LOOKS = [
  { sex: 'male', look: { hair_color: 'black', hair_length: 'short', hair_style: 'spiky', face: { skin: 'tan', facial: 'full' } } },
  { sex: 'female', look: { hair_color: 'red', hair_length: 'long', hair_style: 'ponytail', weight_kg: 95, face: { skin: 'porcelain' } } },
];
const bad = (svg) => /NaN|undefined|Infinity/.test(svg);
for (const L of LOOKS) {
  const bare = dollSvg({ ...L, items: [] });
  if (bad(bare)) problems.push(`the bare ${L.sex} doll draws NaN or undefined`);
  for (const it of rows) {
    let svg;
    try { svg = dollSvg({ ...L, items: [it] }); } catch (e) { problems.push(`${it.id}: throws (${e.message})`); continue; }
    if (bad(svg)) problems.push(`${it.id} (${garmentOf(it).kind}): NaN or undefined in the drawing`);
    else if (!svg.includes(`data-id="${it.id}"`)) problems.push(`${it.id} (${garmentOf(it).kind}): worn but draws nothing to pick`);
  }
  // everything at once, as a wardrobe's worth: the order and the layering mustn't throw either
  try { if (bad(dollSvg({ ...L, items: rows }))) problems.push(`every item at once on the ${L.sex} doll draws NaN or undefined`); }
  catch (e) { problems.push(`every item at once throws (${e.message})`); }
}
// a ghost (the preview while you drag) of an item not worn draws too
if (rows[0] && !dollSvg({ items: [] }, { ghost: { ...rows[0], worn: false } }).includes('ghost')) problems.push('a dragged garment draws no ghost');

if (problems.length) {
  console.error(`✗ paper-doll smoke: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ paper-doll smoke — ${rows.length} items drawn on both bodies`);
