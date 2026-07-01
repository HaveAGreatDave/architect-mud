// One-shot migration: audio_event_routes changed from event_name PK to UUID id PK.
// Safe to drop — event routes are admin config, not player data.
// Run once: node server/models/temp/migrate-audio-event-routes-pk.js

import { query } from '../db.js';

const { rows: cols } = await query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'audio_event_routes' AND column_name = 'id'
`);

if (cols.length > 0) {
  console.log('audio_event_routes already has id column — nothing to do.');
  process.exit(0);
}

console.log('Recreating audio_event_routes with UUID id PK...');
await query(`DROP TABLE IF EXISTS audio_event_routes`);
await query(`
  CREATE TABLE audio_event_routes (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    sfx_id TEXT,
    ambient_id TEXT,
    song_id TEXT,
    sample_id TEXT REFERENCES audio_samples(id),
    scope TEXT NOT NULL DEFAULT 'zone',
    enabled INTEGER NOT NULL DEFAULT 1
  )
`);
await query(`CREATE INDEX IF NOT EXISTS idx_audio_event_routes_event_name ON audio_event_routes(event_name)`);
console.log('Done. Re-add any event routes via the devpanel Audio → Event Routes tab.');
process.exit(0);
