/**
 * One-shot: move the four prologue zones onto their own map (`map_prologue`).
 *
 * Why a script and not the ordinary CODEX deploy: the deploy is additive
 * (INSERT … ON CONFLICT DO NOTHING), so it can create the `maps` row but can
 * never rewrite `map_id` on zone rows that already exist. That's a data
 * transformation, which per CLAUDE.md is exactly what a one-shot is for.
 *
 * What it fixes: the prologue zones carried `map_id = NULL`, and getMinimapData
 * only confines its breadth-first walk when the centre zone HAS a map. So from
 * The Collapse the walk crossed into zone_start and spread eight hops through
 * Coldwater — a player still in the tutorial was looking at a minimap of a city
 * they hadn't been told exists yet. Giving the corridor its own map confines the
 * walk to the corridor; Coldwater is first revealed climbing out of the vat.
 *
 * Local:  node scripts/prologue-own-map.mjs
 * Prod:   node --env-file=.env.prod scripts/prologue-own-map.mjs
 */
import { query } from '../server/models/db.js';

const ZONES = ['zone_the_inbetween', 'zone_the_lattice', 'zone_the_broadcast', 'zone_the_collapse'];

const r1 = await query(
  `INSERT INTO maps (id, name, entry_zone_id, parent_zone_id, created_by)
     VALUES ('map_prologue', 'The Inbetween', 'zone_the_inbetween', NULL, NULL)
     ON CONFLICT (id) DO NOTHING`
);
console.log(`maps row: ${r1.rowCount ? 'created' : 'already present'}`);

const r2 = await query(`UPDATE zones SET map_id = 'map_prologue' WHERE id = ANY($1)`, [ZONES]);
console.log(`zones moved onto map_prologue: ${r2.rowCount}`);

process.exit(0);
