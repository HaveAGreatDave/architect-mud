// One-shot: add tolerance + addiction columns to player_drug_state for the
// phased-effect drug system. Run once against prod, then it's idempotent.
// SCHEMA_SQL already carries these for fresh databases; this covers existing
// deployments where CREATE TABLE IF NOT EXISTS won't add columns.
//
//   node server/models/temp/alter-drug-state.js

import 'dotenv/config';
import { query } from '../db.js';

await query('ALTER TABLE player_drug_state ADD COLUMN IF NOT EXISTS tolerance REAL DEFAULT 0');
await query('ALTER TABLE player_drug_state ADD COLUMN IF NOT EXISTS addiction REAL DEFAULT 0');
console.log('✓ player_drug_state: tolerance + addiction columns ensured.');
process.exit(0);
