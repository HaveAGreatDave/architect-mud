/**
 * Description length pass, 2026-09-04.
 *
 * An item or furniture description is read in a room list, in a shop shelf and
 * in `examine`, so it earns its length in the smallest of those places. The
 * house target is 300 characters. 26 of 718 items and 127 of 1,448 furniture
 * were over it; this file holds the rewrites, keyed by content file.
 *
 * Two kinds of file are deliberately NOT in the table:
 *   - the betatape cassettes, whose length is the ASCII label art rather than
 *     prose (the prose either side of it is four lines),
 *   - the hero posters, which are an authored set piece — the poster IS the
 *     content and cutting it to a paragraph deletes the feature.
 * Both are listed in EXEMPT so the audit stays quiet about them rather than
 * reporting the same known cases every run.
 *
 *   node scripts/prose/trim-descriptions.mjs           audit: what is over 300
 *   node scripts/prose/trim-descriptions.mjs --write   apply the rewrites
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../content/lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const LIMIT = 300;

const EXEMPT_RE = /^items\/item_betatape_|^furniture\/furn_hero_poster_/;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRIMS = Object.assign(
  JSON.parse(fs.readFileSync(path.join(HERE, 'trims.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(HERE, 'trims-furniture.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(HERE, 'trims-furniture-2.json'), 'utf8')),
);

// A description keyed here is keyed by ONE file, and 24 identical Meridian beds
// share one text. So an entry rewrites every file in the same directory whose
// description matches the keyed file's — one rewrite per text, not per row.
function siblings(dir, text) {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'));
    if (j.description === text) out.push(f);
  }
  return out;
}

let applied = 0, tooLong = 0;
for (const [rel, text] of Object.entries(TRIMS)) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) { console.log(`  ?? missing ${rel}`); continue; }
  if (text.length > LIMIT) { console.log(`  !! rewrite still ${text.length} — ${rel}`); tooLong++; }
  if (!WRITE) continue;
  const dir = rel.split('/')[0];
  const was = JSON.parse(fs.readFileSync(fp, 'utf8')).description;
  if (was === text) continue;
  for (const f of siblings(dir, was)) {
    const jp = path.join(ROOT, dir, f);
    const j = JSON.parse(fs.readFileSync(jp, 'utf8'));
    j.description = text;
    fs.writeFileSync(jp, canonicalJson(j));
    applied++;
  }
}

const over = [];
for (const dir of ['items', 'furniture']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${f}`;
    if (EXEMPT_RE.test(rel)) continue;
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'));
    if ((j.description || '').length > LIMIT) over.push([j.description.length, rel]);
  }
}
over.sort((a, b) => b[0] - a[0]);
console.log(`${WRITE ? `Applied ${applied} rewrites. ` : ''}${over.length} description(s) still over ${LIMIT}${tooLong ? `, ${tooLong} rewrite(s) in this file are themselves too long` : ''}.`);
for (const [n, rel] of over.slice(0, 40)) console.log(`  ${String(n).padStart(5)}  ${rel}`);
