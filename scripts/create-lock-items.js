// One-shot script: seed Hololock Kit and Keycard Lock Kit items.
// Run once: node scripts/create-lock-items.js
import { query } from '../server/models/db.js';

const ITEMS = [
  {
    id: 'item_hololock_kit',
    name: 'Hololock Installation Kit',
    description: 'A matte-black case containing a compact hololock unit, its emitter array folded flat for transport. The bioelectric sensor array is rated for standard residential grade. Install on any door you own with INSTALL HOLOLOCK.',
    type: 'misc',
    weight: 0.5,
    value: 150,
    rarity: 'uncommon',
    tags: { lock_kit: 'lock:hololock' },
  },
  {
    id: 'item_keycard_lock_kit',
    name: 'Keycard Lock Kit',
    description: 'A hardened reader panel and paired keycard, both wrapped in static-shielded film. The reader bonds permanently to a single keycard signature on first installation. Install on any door you own with INSTALL KEYCARDLOCK — a matching keycard will be issued to you.',
    type: 'misc',
    weight: 0.3,
    value: 120,
    rarity: 'uncommon',
    tags: { lock_kit: 'lock:keycardlock' },
  },
];

for (const item of ITEMS) {
  const { rows: existing } = await query('SELECT id FROM items WHERE id=$1', [item.id]);
  if (existing.length) {
    console.log(`SKIP  ${item.id} (already exists)`);
    continue;
  }
  await query(
    `INSERT INTO items (id,name,description,type,weight,value,rarity,is_stackable,is_unique,tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$8)`,
    [item.id, item.name, item.description, item.type, item.weight, item.value, item.rarity, JSON.stringify(item.tags)]
  );
  console.log(`CREATED ${item.id}`);
}

process.exit(0);
