import { fileURLToPath } from 'url';
import { query } from '../db.js';
import { materializeItemTags, ownTags } from '../../engine/supertags.js';

// One-time content migration for the weapon-tag rework. Every weapon item is
// re-classed onto one of the five weapon supertags (client/shared/tagSupertags.js)
// based on its current weapon_skill, while its own damage/damage_type are kept as
// authored (__own) tags so the actual damage numbers never change — the supertag
// only supplies the shared wiring (weapon/slot/weapon_skill) and defaults.
//
// Skill mapping (handles both legacy blunt/bladed/energy and already-migrated
// ids so re-running is a no-op):
//   blunt|clubs        -> weapon_clubs    (Clubs)
//   bladed|blades      -> weapon_blades   (Blades)
//   energy|science     -> weapon_science  (Science)
//   firearms           -> weapon_firearms (Firearms)
//   fists|<missing>    -> weapon_fists    (Fists)
// Guard: direct-invoke only.
const SKILL_TO_SUPERTAG = {
  blunt: 'weapon_clubs', clubs: 'weapon_clubs',
  bladed: 'weapon_blades', blades: 'weapon_blades',
  energy: 'weapon_science', science: 'weapon_science',
  firearms: 'weapon_firearms',
  fists: 'weapon_fists',
};

async function retagWeapons() {
  const { rows } = await query(
    `SELECT id, tags FROM items WHERE jsonb_exists(tags, 'weapon')`
  );
  let changed = 0;
  for (const row of rows) {
    const tags = row.tags || {};
    const superKey = SKILL_TO_SUPERTAG[tags.weapon_skill] || 'weapon_fists';

    // Own = authored tags minus the bits the supertag now owns. Preserve the
    // weapon's real damage/damage_type (and everything else — description,
    // stat_bonus, requires, butchering, etc.).
    const own = ownTags(tags);
    delete own.weapon;
    delete own.slot;
    delete own.weapon_skill;

    const newTags = materializeItemTags(own, [superKey]);
    await query('UPDATE items SET tags = $1 WHERE id = $2', [JSON.stringify(newTags), row.id]);
    changed++;
    console.log(`  ${row.id}: ${tags.weapon_skill || '(none)'} -> ${superKey} (${newTags.weapon_skill})`);
  }
  console.log(`✅ Re-tagged ${changed} weapon item(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  retagWeapons().catch(e => { console.error(e); process.exit(1); });
}
