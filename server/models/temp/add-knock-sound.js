// One-shot: insert the knock sound definition.
// Run once: node server/models/temp/add-knock-sound.js
import { query } from '../db.js';
import { randomUUID } from 'crypto';

const DESCRIPTIONS = [
  'Someone knocks on a door nearby.',
  'A firm knock echoes through the wall.',
  'Three sharp raps sound from close by.',
  'A dull thud — someone knocking.',
  'The hollow knock of knuckles on wood.',
  'A polite double-knock, close by.',
  'Knock knock. Whoever it is, they\'re persistent.',
  'A single loud knock reverberates.',
  'You hear someone rapping on a surface nearby.',
  'A muffled knock — maybe a door, maybe not.',
];

const existing = await query("SELECT id FROM sounds WHERE name='knock'");
if (existing.rows.length) {
  console.log('knock sound already exists, skipping');
  process.exit(0);
}

const id = randomUUID();
await query(
  'INSERT INTO sounds (id,name,category,descriptions,loudness,enabled,propagation) VALUES ($1,$2,$3,$4,$5,$6,$7)',
  [id, 'knock', 'impact', JSON.stringify(DESCRIPTIONS), 1.0, 1, 'both']
);
console.log('knock sound inserted:', id);
process.exit(0);
