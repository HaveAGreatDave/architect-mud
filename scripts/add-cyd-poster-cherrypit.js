// Hang the Freedom City "Cyd" hero poster on the wall of the Cherry Pit floor.
//
// Uses the canonical poster_key 'cyd' + fixed furniture id (`furn_hero_poster_cyd`)
// the posters plugin's putup path uses, so this IS the one Cyd poster — takedown/putup
// move it, and its secret partner is still Kiyo (the GRU seam reveal fires if they ever
// share a room). The prose lines up with Kiyo's frame: Kiyo's torn cabling runs into the
// dead generator here, and the severed cable exits the left edge toward his poster.
//
// Idempotent (upsert). Content-only — hit /world/reload or restart afterwards.
import { query } from '../server/models/db.js';

const ZONE = 'zone_mq_cherry_floor';
const NAME = 'hero poster: CYD, THE HAND ON THE BREAKER';
const DESC = "A poster printed on the same heavy, scorch-edged stock as the one it was torn from. "
  + "Cyd stands with one boot up on a dead industrial generator the size of a coffin, forearm "
  + "resting across her knee, utterly unhurried while the skyline behind her browns out floor by "
  + "floor. A single heavy cable runs from the machine off the left edge of the frame — cut clean, "
  + "as though it once continued somewhere. CYD — SHE DECIDES WHEN THE POWER COMES BACK. Stencilled "
  + "beneath in utility-company type: \"blackout or dawn, it's her hand on the breaker, and she is "
  + "in no hurry to tell you which one you've earned.\" A real length of copper wire, worried bright "
  + "by passing thumbs, is threaded through two punched holes along the torn left edge.";

const { rows: z } = await query('SELECT id FROM zones WHERE id=$1', [ZONE]);
if (!z.length) { console.log(`SKIP  ${ZONE}: zone not found`); process.exit(0); }

await query(
  `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
   VALUES ($1,$2,$3,$4,'decoration',$5)
   ON CONFLICT (id) DO UPDATE SET
     zone_id=EXCLUDED.zone_id, name=EXCLUDED.name, description=EXCLUDED.description,
     object_type='decoration', flags=EXCLUDED.flags`,
  ['furn_hero_poster_cyd', ZONE, NAME, DESC,
   JSON.stringify({ hero_poster: true, poster_key: 'cyd' })]
);
console.log(`POSTER  ${NAME} → ${ZONE} (furn_hero_poster_cyd)`);
process.exit(0);
