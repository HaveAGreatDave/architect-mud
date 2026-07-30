/**
 * One-shot: put maker's badges on the two consumer cassette players.
 *
 * Why a script and not the ordinary CODEX deploy: the deploy is additive
 * (INSERT … ON CONFLICT DO NOTHING), so the new flags in the two furniture
 * content files reach a fresh database but can never be written onto rows that
 * already exist on prod.
 *
 * What it does: merges the branding flags into each row. `deck_brand` switches
 * both the examine readout (server/engine/commands/world.js) and the deck panel
 * onto the consumer chassis; `deck_style` picks the cabinet (machined slab vs
 * piano-key top-loader) and `deck_silent` is a SEPARATE axis, so the cheap unit
 * stays loud. Nothing else in either row is touched, so a cassette loaded in a
 * machine right now stays loaded.
 *
 * This is a CLAMP, not a converging script — it asserts one branding decision on
 * one known row. Per scripts/oneshots.bat it does NOT belong in that list: run
 * it once by hand and delete it.
 *
 * Local:  node scripts/brand-consumer-decks.mjs
 * Prod:   node --env-file=.env.prod scripts/brand-consumer-decks.mjs
 */
import { query } from '../server/models/db.js';

const DECKS = [
  // The expensive one: a machined slab that takes the tape without a sound.
  { id: 'furn_betamax_zone_solenne_apt_b', add: { deck_brand: 'Polaris', deck_mark: '✦', deck_style: 'slab', deck_silent: true } },
  // The cheap one: a scratched top-loader with piano keys, and loud with it.
  { id: 'furn_betamax_zone_grindhouse_interior', add: { deck_brand: 'Bantam', deck_mark: '▚', deck_style: 'keys' } },
];

let missing = 0;
for (const { id, add } of DECKS) {
  const { rows } = await query('SELECT name, flags FROM furniture WHERE id=$1', [id]);
  if (!rows.length) {
    console.error(`  ! no furniture row ${id} — skipped.`);
    missing++;
    continue;
  }
  const before = typeof rows[0].flags === 'string' ? JSON.parse(rows[0].flags) : (rows[0].flags || {});
  if (Object.entries(add).every(([k, v]) => before[k] === v)) {
    console.log(`  = ${rows[0].name}: already branded — no change.`);
    continue;
  }
  const r = await query('UPDATE furniture SET flags=$2 WHERE id=$1', [id, JSON.stringify({ ...before, ...add })]);
  console.log(`  + ${rows[0].name}: branded ${add.deck_brand} (${r.rowCount} row).`);
}

process.exit(missing ? 1 : 0);
