// One-shot content: add the Precinct 9 prison jumpsuit — the garb a booked
// prisoner is stripped down to and re-clothed in (jail plugin, dressInGarb()).
//   Run once:  node scripts/add-prison-jumpsuit.js
//   Restart the server (or hit /world/reload) after — the item cache loads at boot.
//
// Deliberate, run-once (the sanctioned CLAUDE.md path). Idempotent: ON CONFLICT
// DO UPDATE, so re-running re-applies the latest definition.
//
// It's a "jumpsuit": a single garment that fills BOTH the torso and the legs from
// one piece, via the new `covers` tag (worn on torso, covers ['legs']). The equip
// engine (server/engine/inventory.js) and the armor/insulation readers honour it.
import { query } from '../server/models/db.js';

const ITEM_ID = 'item_prison_jumpsuit';
const ITEM_NAME = 'prison jumpsuit';
const DESC = "A shapeless one-piece coverall in Precinct 9 orange, the paper-thin fabric stamped DETAINEE across the back in stencilled block letters. It zips from crotch to throat and covers you from shoulders to shins in a single miserable garment. It fits nobody and smells of institutional bleach.";

const TAGS = {
  slot: 'torso',
  layer: 'outerwear',
  covers: ['legs'],   // one piece, two slots — torso AND legs
  bulkiness: 2,
  insulation: 8,   // covers torso+legs (exposure 0) → warmthTemp = ambient + 8; warm past the 10°C cold threshold
  armor: 0,
  description: DESC,
};

await query(
  `INSERT INTO items (id, name, description, type, subtype, weight, value, is_stackable, tags)
   VALUES ($1,$2,$3,'clothing',NULL,800,5,0,$4::jsonb)
   ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
     type=EXCLUDED.type, weight=EXCLUDED.weight, value=EXCLUDED.value,
     is_stackable=EXCLUDED.is_stackable, tags=EXCLUDED.tags`,
  [ITEM_ID, ITEM_NAME, DESC, JSON.stringify(TAGS)]
);

console.log(`✓ ${ITEM_NAME} added (${ITEM_ID}).`);
console.log('Restart the server (or /world/reload) so the item cache picks it up.');
process.exit(0);
