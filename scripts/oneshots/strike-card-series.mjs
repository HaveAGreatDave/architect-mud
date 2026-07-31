// Strike the NPC + enemy trading cards for the open series.
//
// WHY THIS IS A ONE-SHOT AND NOT PART OF THE DEPLOY
// The CODEX deploy carries CONTENT. These cards are DERIVED from content — one
// card per eligible NPC and enemy row — and derived rows are runtime class, so
// they are deliberately not in the content tree (exporting them would commit an
// artifact that a rebuild reproduces exactly). Something has to cut them on prod
// once the content is there, and this is that something.
//
// WHY IT BELONGS IN oneshots.bat — IT CONVERGES
// `strikeSeries()` skips any subject already carded in that series, so running it
// a year from now on a world that has grown cuts cards for the NPCs and enemies
// added since and touches nothing else. It cannot restat, rewrite or remove an
// existing card. It is not a clamp: no decision made today is forced back onto
// state that has moved on.
//
//   node --env-file=.env.prod scripts/oneshots/strike-card-series.mjs
import { query } from '../../server/models/db.js';
import { strikeSeries } from '../../plugins/cards/index.js';

const series = Number(process.env.CARD_SERIES) || 1;

const before = await query('SELECT COUNT(*)::int AS n FROM cards WHERE series=$1', [series]);
const struck = await strikeSeries(series);
const { rows } = await query(
  `SELECT rarity, subject_type, COUNT(*)::int AS n FROM cards WHERE series=$1
   GROUP BY rarity, subject_type ORDER BY subject_type, rarity`, [series]
);

if (!struck) {
  console.log(`  series ${series}: nothing new to strike (${before.rows[0].n} cards already cut)`);
} else {
  console.log(`  series ${series}: struck ${struck} new card(s); pool is now ${before.rows[0].n + struck}`);
  for (const r of rows) console.log(`    ${r.subject_type.padEnd(6)} ${r.rarity.padEnd(10)} ${r.n}`);
}

// A pool with no uncommon-or-better cannot honour the every-sleeve guarantee.
// Worth saying out loud rather than discovering it at a machine.
const hit = rows.filter(r => r.rarity !== 'common').reduce((a, r) => a + r.n, 0);
if (!hit) console.warn('  ! no uncommon-or-better cards in the pool — every sleeve will step up to whatever exists');

process.exit(0);
