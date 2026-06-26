/**
 * One-off utility: renames the admin account's handle to "The Architect"
 * for databases that were already seeded before this change.
 * Run with: node server/models/rename-admin.js
 */
import { query } from './db.js';

async function rename() {
  const result = await query(
    `UPDATE players SET handle = $1, origin_fragment = $2 WHERE username = 'admin' RETURNING handle`,
    ['The Architect', 'The presence that built all of this, and watches it now.']
  );
  if (result.rows.length) {
    console.log(`✓ Admin handle updated to: ${result.rows[0].handle}`);
  } else {
    console.log('No admin account found (username: admin). Nothing changed.');
  }
  process.exit(0);
}

rename().catch(e => { console.error(e); process.exit(1); });
