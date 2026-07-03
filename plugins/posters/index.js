/**
 * Posters plugin — the Freedom City "hero posters" are portable, and two of
 * them share a secret.
 *
 * A hung poster is a furniture row (object_type 'decoration') tagged
 * flags.hero_poster=true / flags.poster_key=<key>. `takedown` peels one off the
 * wall — deleting the furniture row and handing the player a rolled-up poster
 * item (item_poster_<key>) whose custom_data snapshots the wall text so the
 * exact poster survives the move. `putup` unrolls a carried poster onto the wall
 * of a home the player owns (gated on playerControlsApt — you can strip a poster
 * from any public wall, but you can only re-hang it in your own apartment). Only
 * one instance of each poster exists, so taking one bare-strips it from town
 * until it's re-hung. This mirrors the generator plugin's pack/deploy pattern.
 *
 * The prose lives in the DB (furniture rows / item custom_data), not here — the
 * only content this file owns is the tiny mechanical fact of which two posters
 * line up, and the seam reveal itself.
 *
 * Easter egg: the Kiyo and Cyd posters were printed as one image. When both
 * hang in the same room, examining either reveals — via the furniture.describe
 * hook — that their torn edges line up and spell a hidden GRU at the seam.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getApartment } from '../../server/engine/world.js';
import { playerControlsApt } from '../../server/engine/apartments.js';

// Posters that share a secret seam. Deliberately tiny and mechanical.
const SECRET_PAIR = { kiyo: 'cyd', cyd: 'kiyo' };

// Wall titles read "hero poster: NAME, EPITHET"; strip the boilerplate for prose.
function shortName(name) {
  return String(name || 'poster').replace(/^hero poster:\s*/i, '');
}

// The seam reveal, shown on examine when a poster's secret partner hangs in the
// same room. `partnerName` is the partner furniture's wall title.
function seamReveal(partnerName) {
  const other = shortName(partnerName).split(',')[0].trim();
  return `<span class="text-dim">Step back, and you notice this poster lines up seam-to-seam with the ${other} poster beside it — the two were printed as a single sheet, then torn apart. The severed cabling in one frame runs unbroken into the dead generator in the other, and where the ragged edges meet, the scorch-marks and shadows resolve into three deliberate letters that neither poster shows alone: <b>G R U</b>. Someone wanted these two hung together. Only together.</span>`;
}

// ── takedown <poster> — peel a hero poster off the wall into a rolled item ────
async function cmdTakedown(args, raw, player, broadcast) {
  const target = args.join(' ').replace(/^(the|down)\s+/i, '').trim();
  const { rows } = await query(
    `SELECT * FROM furniture
      WHERE zone_id=$1 AND object_type='decoration' AND flags->>'hero_poster'='true'
      ${target ? 'AND name ILIKE $2' : ''}`,
    target ? [player.current_zone, `%${target}%`] : [player.current_zone]
  );
  if (!rows.length)
    return { type: 'error', message: target
      ? `There's no "${target}" poster on the wall here.`
      : `There's no poster here to take down.` };
  if (rows.length > 1)
    return { type: 'error', message: `Which one? ${rows.map(r => `"${shortName(r.name)}"`).join(', ')}. Try \`takedown <name>\`.` };

  const f = rows[0];
  const key = f.flags?.poster_key;
  if (!key) return { type: 'error', message: `That won't come off the wall.` };

  await query('DELETE FROM furniture WHERE id=$1', [f.id]);
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, custom_data) VALUES ($1,$2,$3,1,$4)`,
    [randomUUID(), player.id, `item_poster_${key}`,
     JSON.stringify({ poster_key: key, name: f.name, description: f.description })]
  );

  broadcast(player.current_zone,
    { type: 'zone_event', message: `${player.handle} peels the ${shortName(f.name)} poster off the wall and rolls it up.` },
    player.id);
  return { type: 'take', message: `You peel ${f.name} off the wall and roll it into a tube. <span class="text-dim">(Hang it elsewhere with \`putup\`.)</span>` };
}

// ── putup <poster> — unroll a carried poster onto the current room's wall ─────
async function cmdPutup(args, raw, player, broadcast) {
  // Posters only go up on walls you own — your home. Anywhere else, no.
  if (!playerControlsApt(player, getApartment(player.current_zone)))
    return { type: 'error', message: `You can only hang posters in a home you own — these walls aren't yours. Take it back to your place and \`putup\` there.` };

  const target = args.join(' ').replace(/^(the|up)\s+/i, '').trim();
  const { rows } = await query(
    `SELECT id, item_id, custom_data FROM player_inventory
      WHERE player_id=$1 AND container_id IS NULL AND item_id LIKE 'item_poster_%'`,
    [player.id]
  );
  let carried = rows;
  if (target) {
    const t = target.toLowerCase();
    carried = rows.filter(r => (r.custom_data?.name || '').toLowerCase().includes(t));
  }
  if (!carried.length)
    return { type: 'error', message: target
      ? `You're not carrying a "${target}" poster.`
      : `You have no posters to put up.` };
  if (carried.length > 1)
    return { type: 'error', message: `Which one? ${carried.map(r => `"${shortName(r.custom_data?.name)}"`).join(', ')}. Try \`putup <name>\`.` };

  const r = carried[0];
  const cd = r.custom_data || {};
  const key = cd.poster_key || r.item_id.replace('item_poster_', '');

  // Exactly one instance of each poster exists in the world; move it here.
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
     VALUES ($1,$2,$3,$4,'decoration',$5)
     ON CONFLICT (id) DO UPDATE SET
       zone_id=EXCLUDED.zone_id, name=EXCLUDED.name, description=EXCLUDED.description,
       object_type='decoration', flags=EXCLUDED.flags`,
    [`furn_hero_poster_${key}`, player.current_zone, cd.name, cd.description,
     JSON.stringify({ hero_poster: true, poster_key: key })]
  );
  await query('DELETE FROM player_inventory WHERE id=$1', [r.id]);

  broadcast(player.current_zone,
    { type: 'zone_event', message: `${player.handle} smooths the ${shortName(cd.name)} poster onto the wall.` },
    player.id);

  // Adjacency wink — if the secret partner already hangs here, hint at the seam.
  let extra = '';
  const partner = SECRET_PAIR[key];
  if (partner) {
    const { rows: p } = await query(
      `SELECT 1 FROM furniture WHERE zone_id=$1 AND flags->>'hero_poster'='true' AND flags->>'poster_key'=$2 LIMIT 1`,
      [player.current_zone, partner]
    );
    if (p.length) extra = ` <span class="text-dim">It settles oddly close to the poster already hanging here — the torn edges almost seem to line up.</span>`;
  }
  return { type: 'take', message: `You unroll ${cd.name} and smooth it onto the wall.${extra}` };
}

// ── furniture.describe hook — the Kiyo/Cyd seam reveal ────────────────────────
export const hooks = {
  'furniture.describe': async (f) => {
    if (f?.flags?.hero_poster !== true) return undefined;
    const partner = SECRET_PAIR[f.flags.poster_key];
    if (!partner) return undefined;
    const { rows } = await query(
      `SELECT name FROM furniture WHERE zone_id=$1 AND flags->>'hero_poster'='true' AND flags->>'poster_key'=$2 LIMIT 1`,
      [f.zone_id, partner]
    );
    if (!rows.length) return undefined;
    return seamReveal(rows[0].name);
  },
};

export const commands = { takedown: cmdTakedown, putup: cmdPutup };

// Exposed for the regression suite only.
export const _test = { SECRET_PAIR, shortName, seamReveal };
