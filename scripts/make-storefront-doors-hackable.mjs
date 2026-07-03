// One-shot content script: make storefront entrance doors hackable.
//
// Storefront doors (id 'door_entrance_*') are locked up by the vendor shop
// mechanic (ai-behaviour.js) via lock_state, but they carried no lock TAG — so
// the `hack` verb self-gated out (doors.js requires a lock:hololock tag with
// canHack). This adds that tag so a player with a hacking deck can breach a
// closed shop (HOLOLOCK BYPASS minigame → reports a burglary crime).
//
// Idempotent: skips doors that already have any lock:* tag. Leaves lock_state
// untouched (the vendor mechanic still owns open/closed). The police precinct
// entrance is deliberately excluded — it isn't a shop.
//
// Run once:  node scripts/make-storefront-doors-hackable.mjs
import { query } from '../server/models/db.js';

const EXCLUDE = new Set(['door_entrance_zone_mq_precinct']);

// Mirrors the working tag on door_8 (the residential lobby hololock).
const HOLOLOCK_TAG = {
  canHack: true,
  difficulty: 5,
  messages: {
    lock:        'The hololock hums as it engages.',
    unlock:      'The hololock disengages with a soft click.',
    denied:      'The hololock does not recognize your credentials.',
    hackFail:    'The hololock resists your intrusion.',
    hackSuccess: "You bypass the hololock's security matrix.",
  },
};

const { rows } = await query(`SELECT id, name, tags FROM doors WHERE id LIKE 'door_entrance_%' ORDER BY id`);

let tagged = 0, skipped = 0;
for (const d of rows) {
  if (EXCLUDE.has(d.id)) { console.log(`SKIP  ${d.id} (excluded — not a shop)`); skipped++; continue; }
  const tags = d.tags || {};
  const hasLock = Object.keys(tags).some(k => k.startsWith('lock:'));
  if (hasLock) { console.log(`SKIP  ${d.id} (already has a lock tag)`); skipped++; continue; }

  const nextTags = { ...tags, 'lock:hololock': HOLOLOCK_TAG };
  await query('UPDATE doors SET tags=$1 WHERE id=$2', [JSON.stringify(nextTags), d.id]);
  console.log(`TAG   ${d.id}  "${d.name}"`);
  tagged++;
}

console.log(`\nDone. Tagged ${tagged}, skipped ${skipped}.`);
console.log('Reload the world (/world/reload) or restart the server so the door cache picks up the tags.');
process.exit(0);
