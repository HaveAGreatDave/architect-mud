// One-shot: point the Tonight Show / Raptor News intro themes at the recorded
// jingle SAMPLES instead of the old tracker songs. Updates the authoritative
// *_pools.theme column the live airing reads (the additive CODEX deploy can't
// touch existing rows, so this must be run by hand).
//
//   node --env-file=.env.neon scripts/retheme-broadcast-jingles.mjs
//
// Idempotent: re-running just re-sets the same values. Read-back verifies.
import pg from 'pg';

const targets = [
  ['bc_1783893488381', 'talkshow_pools', 'Theme Jingle 2'], // The Tonight Show with John Akerson
  ['bc_1783893568943', 'news_pools',     'Theme Jingle 1'], // Raptor News Network — Nightly Fury
];

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set — pass --env-file=.env.neon'); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await c.connect();
console.log(`target host: ${new URL(url).hostname}`);

for (const [id, col, theme] of targets) {
  const r = await c.query(
    `UPDATE media_broadcasts SET ${col} = jsonb_set(${col}, '{theme}', to_jsonb($1::text)), updated_at = EXTRACT(EPOCH FROM NOW())
     WHERE id = $2 AND ${col} IS NOT NULL
     RETURNING ${col}->>'theme' AS theme`,
    [theme, id]
  );
  if (!r.rows.length) console.log(`!! ${id}: no row updated (missing id or NULL ${col})`);
  else console.log(`✓ ${id}.${col}.theme = ${r.rows[0].theme}`);
}
await c.end();
