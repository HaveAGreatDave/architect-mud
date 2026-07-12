// One-shot: push the `tonight_show_logo` media_graphics row from its git content
// file (content/media_graphics/tonight_show_logo.json) into the database. The
// title card is the show poster (data/host.png, cropped + base64-embedded in an
// <svg><image>) referenced by `@titlecard tonight_show_logo` in
// data/scripts/Tonight_Show.bsm. Idempotent — the existing row is overwritten.
//
// The additive CODEX deploy is INSERT ... ON CONFLICT DO NOTHING and will NOT
// overwrite an existing graphic, so refreshing this card in prod needs this
// explicit update.
//
//   Local dev DB:  node scripts/update-tonight-logo.mjs
//   Prod (Neon):   node --env-file=.env.prod scripts/update-tonight-logo.mjs
import { readFileSync } from 'node:fs';
import { query } from '../server/models/db.js';

const g = JSON.parse(readFileSync(new URL('../content/media_graphics/tonight_show_logo.json', import.meta.url), 'utf8'));

await query(
  `INSERT INTO media_graphics (id, name, description, type, content, tags, updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT (id) DO UPDATE SET name=$2, description=$3, type=$4, content=$5, tags=$6, updated_at=$7`,
  [
    g.id,
    g.name,
    g.description || '',
    g.type,
    g.content,
    JSON.stringify(g.tags || []),
    Number(g.updated_at),
  ]
);
console.log(`Updated graphic '${g.id}' (type=${g.type}, ${g.content.length} bytes).`);
process.exit(0);
