// One-shot migration: audio_event_routes changed from event_name PK to UUID id PK.
// Preserves existing routes by copying them with generated IDs.
// Run once: node server/models/temp/migrate-audio-event-routes-pk.js

import { query } from '../db.js';
import { randomUUID } from 'crypto';

const { rows: cols } = await query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'audio_event_routes' AND column_name = 'id'
`);

if (cols.length > 0) {
  console.log('audio_event_routes already has id column — nothing to do.');
  process.exit(0);
}

// Read existing rows before destroying anything
const { rows: oldRows } = await query(`SELECT * FROM audio_event_routes`);
console.log(`Found ${oldRows.length} existing event route(s) to migrate.`);

await query(`DROP TABLE IF EXISTS audio_event_routes`);
await query(`
  CREATE TABLE audio_event_routes (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    sfx_id TEXT,
    ambient_id TEXT,
    song_id TEXT,
    sample_id TEXT,
    scope TEXT NOT NULL DEFAULT 'zone',
    enabled INTEGER NOT NULL DEFAULT 1
  )
`);
await query(`CREATE INDEX IF NOT EXISTS idx_audio_event_routes_event_name ON audio_event_routes(event_name)`);

for (const row of oldRows) {
  await query(
    `INSERT INTO audio_event_routes (id, event_name, sfx_id, ambient_id, song_id, sample_id, scope, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), row.event_name, row.sfx_id || null, row.ambient_id || null, row.song_id || null, null, row.scope || 'zone', row.enabled ?? 1],
  );
}

console.log(`Migrated ${oldRows.length} route(s). Done.`);
process.exit(0);
