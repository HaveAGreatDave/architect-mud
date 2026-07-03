import { fileURLToPath } from 'url';
import { query } from '../db.js';

// One-time content migration for the combat-skill rework: the SKILLS catalog
// renamed `brawling` -> `fists` and `explosives` -> `science`. Player IP is
// stored per skill_id in player_skills, so those rows need renaming or the IP
// silently detaches from the (now differently-named) skill. `blades`/`firearms`/
// `dodge` keep their ids; `clubs` is brand new (no rows to move). Energy-weapon
// IP historically landed in `electronics` — a real tech skill that stays — so it
// is left untouched. Idempotent (the WHERE only matches the old ids once).
// Guard: direct-invoke only.
const RENAMES = [
  ['brawling', 'fists'],
  ['explosives', 'science'],
];

async function renameCombatSkills() {
  for (const [from, to] of RENAMES) {
    // Guard against a collision if a player somehow already has both rows: keep
    // the higher IP, drop the loser, then rename what remains.
    await query(
      `DELETE FROM player_skills a
         USING player_skills b
        WHERE a.player_id = b.player_id
          AND a.skill_id = $1 AND b.skill_id = $2
          AND a.ip <= b.ip`,
      [from, to]
    );
    const { rowCount } = await query(
      'UPDATE player_skills SET skill_id = $2 WHERE skill_id = $1',
      [from, to]
    );
    console.log(`✅ Renamed ${rowCount} player_skills row(s): ${from} -> ${to}.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  renameCombatSkills().catch(e => { console.error(e); process.exit(1); });
}
