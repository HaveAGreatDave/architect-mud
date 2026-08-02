// One-shot: give every already-struck NPC and enemy card its field-marks line.
//
// This is a DATA TRANSFORMATION of existing rows, which is the one thing the
// additive CODEX deploy can never do (`INSERT … ON CONFLICT DO NOTHING` cannot
// touch a row that already exists). Cards struck before `text_blocks.marks`
// existed have no marks and would never grow any, so the feature would be
// invisible on the entire live pool.
//
// Converging and safe to re-run: it rebuilds each card from its live source row
// and writes back only the derived regions. PLAYER cards are skipped on purpose —
// a player card is a frozen moment with no live source, which is the same reason
// the /cards/:id/rederive route refuses them.
//
//   local:  node scripts/rederive-card-marks.mjs
//   prod:   node --env-file=.env.prod scripts/rederive-card-marks.mjs
import { query } from '../server/models/db.js';
import { buildNpcCard, buildEnemyCard } from '../plugins/cards/builder.js';

const [{ rows: cards }, { rows: npcs }, { rows: enemies }, { rows: spawns }] = await Promise.all([
  query(`SELECT id, subject_type, subject_ref, text_blocks FROM cards WHERE subject_type IN ('npc','enemy')`),
  query('SELECT * FROM npcs'),
  query('SELECT * FROM enemies'),
  query(`SELECT enemy_id, SUM(max_count) AS max_count, MIN(spawn_weight) AS spawn_weight,
                COUNT(*) AS zones FROM zone_spawns GROUP BY enemy_id`),
]);

const npcBy = new Map(npcs.map(n => [String(n.id), n]));
const enemyBy = new Map(enemies.map(e => [String(e.id), e]));
const spawnBy = new Map(spawns.map(s => [String(s.enemy_id), s]));

let updated = 0, skipped = 0, gone = 0;
for (const c of cards) {
  const ref = String(c.subject_ref);
  const src = c.subject_type === 'npc' ? npcBy.get(ref) : enemyBy.get(ref);
  if (!src) { gone++; continue; }              // subject deleted since the card was struck
  const rebuilt = c.subject_type === 'npc'
    ? buildNpcCard(src)
    : buildEnemyCard(src, spawnBy.get(ref) || {});
  const marks = rebuilt.text_blocks.marks || '';
  if ((c.text_blocks?.marks || '') === marks) { skipped++; continue; }
  // Merge rather than replace: a card whose text an admin hand-edited in the
  // dev panel keeps those edits, and only gains the region it was missing.
  await query('UPDATE cards SET text_blocks = $1 WHERE id = $2',
    [JSON.stringify({ ...(c.text_blocks || {}), marks }), c.id]);
  updated++;
}

console.log(`cards scanned ${cards.length} · marks written ${updated} · already current ${skipped} · subject missing ${gone}`);
process.exit(0);
