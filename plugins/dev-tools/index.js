import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { query } from '../../server/models/db.js';
import { getLivePlayer, getAllLivePlayers, getZone, getMinimapData, insertFurniture, updateFurnitureWhere } from '../../server/engine/world.js';
import { autoResolvePower, recalcZoneLoad, getZonePowerStatus } from '../../server/engine/environment.js';
import { describeZone } from '../../server/engine/commands/describe.js';

const OUTFIT_FILE = join(dirname(fileURLToPath(import.meta.url)), 'cyd-outfit.json');

// Hardcoded fallback — used when cyd-outfit.json doesn't exist yet.
const CYD_OUTFIT_DEFAULT = [
  { itemId: 'item_cat_boxers',               slot: 'legs',      layer: 1 },
  { itemId: 'item_reaper_tshirt',            slot: 'torso',     layer: 2 },
  { itemId: 'item_cyber_track_pants',        slot: 'legs',      layer: 2 },
  { itemId: 'item_insulated_gloves',         slot: 'hands',     layer: 2 },
  { itemId: 'item_gold_chain',               slot: 'accessory', layer: 2 },
  { itemId: 'item_finger_rings_set',         slot: 'accessory', layer: 2 },
  { itemId: 'item_onyx_malachite_bracelets', slot: 'accessory', layer: 2 },
  { itemId: 'item_cobalt_scarf',             slot: 'accessory', layer: 3 },
];

function loadOutfit() {
  try { return JSON.parse(readFileSync(OUTFIT_FILE, 'utf8')); } catch { return CYD_OUTFIT_DEFAULT; }
}

async function resolveCydId() {
  const online = getAllLivePlayers().find(p => p.handle.toLowerCase() === 'cyd');
  if (online) return online.id;
  const { rows } = await query(`SELECT id FROM players WHERE LOWER(handle)='cyd' LIMIT 1`);
  if (!rows.length) return null;
  return rows[0].id;
}

async function cmdDressCyd(args, raw, player) {
  if (!['admin', 'dev'].includes(player.role)) {
    return { type: 'error', message: 'Unknown command: ".dresscyd".' };
  }

  if (args[0] === 'save') {
    // Snapshot Cyd's current equipped items to disk.
    const cydId = await resolveCydId();
    if (!cydId) return { type: 'error', message: 'Player "cyd" not found.' };

    const { rows } = await query(
      `SELECT pi.item_id AS "itemId", pi.slot, pi.layer
       FROM player_inventory pi
       WHERE pi.player_id = $1 AND pi.is_equipped = 1
       ORDER BY pi.layer, pi.slot`,
      [cydId]
    );
    if (!rows.length) return { type: 'error', message: 'Cyd has no equipped items to save.' };

    writeFileSync(OUTFIT_FILE, JSON.stringify(rows, null, 2));
    return { type: 'output', message: `Outfit saved — ${rows.length} equipped items recorded.` };
  }

  // Apply outfit.
  const outfit = loadOutfit();
  const cydId = await resolveCydId();
  if (!cydId) return { type: 'error', message: 'Player "cyd" not found.' };

  const itemIds = outfit.map(e => e.itemId);
  const { rows: found } = await query(`SELECT id FROM items WHERE id = ANY($1)`, [itemIds]);
  const missing = itemIds.filter(id => !found.some(r => r.id === id));
  if (missing.length) {
    return { type: 'error', message: `Missing items in DB: ${missing.join(', ')}` };
  }

  await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id = ANY($2)`, [cydId, itemIds]);

  for (const { itemId, slot, layer } of outfit) {
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, is_equipped, slot, layer)
       VALUES ($1, $2, $3, 1, 1.0, 1, $4, $5)`,
      [randomUUID(), cydId, itemId, slot, layer]
    );
  }

  return { type: 'output', message: `Cyd is dressed. ${outfit.length} items equipped.` };
}

// .lettherebelight — drop an overhead fixture into the current room and wire the
// room to the power grid so it actually lights up. Reuses the exact engine path a
// light-switch uses (furniture row + lighting_states + recalcZoneLoad) and the
// dev-panel's Auto-Resolve Power routine (city grid for outdoor tiles; a dug
// utility room + junction box for interiors). Idempotent: won't stack duplicate
// fixtures — if the room already has a light it just ensures it's on and powered.
async function cmdLetThereBeLight(args, raw, player, broadcast) {
  if (!['admin', 'dev'].includes(player.role)) {
    return { type: 'error', message: 'Unknown command: ".lettherebelight".' };
  }
  const zoneId = player.current_zone;
  const zone = getZone(zoneId);
  if (!zone) return { type: 'error', message: 'You are nowhere the grid can reach.' };

  // 1. Ensure the room has a lit overhead fixture.
  const { rows: existing } = await query(
    `SELECT id, name, light_on FROM furniture WHERE zone_id=$1 AND object_type='light' ORDER BY id LIMIT 1`,
    [zoneId]
  );
  let lightName;
  let created = false;
  if (existing.length) {
    lightName = existing[0].name;
    if (!existing[0].light_on) {
      await updateFurnitureWhere(`UPDATE furniture SET light_on=1 WHERE zone_id=$1 AND object_type='light'`, [zoneId]);
    }
  } else {
    const id = `furn_light_${zoneId}_${randomUUID().slice(0, 8)}`;
    lightName = 'overhead light';
    const desc = 'A recessed overhead fixture bolted to the ceiling, throwing a clean, even wash across the room.';
    await insertFurniture({
      id, zone_id: zoneId, name: lightName, description: desc,
      flags: JSON.stringify({ is_light: true, light_type: 'overhead' }),
      light_on: 1, light_type: 'overhead', power_draw_kw: 0.02, light_on_intended: 1,
      object_type: 'light', lumen_output: 1200, price: null, hp: null, hp_max: null,
    });
    created = true;
  }

  // 2. Resync the zone's lighting_states from its actual lit fixtures, and its load.
  const { rows: lc } = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm
     FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`,
    [zoneId]
  );
  await query(
    `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
     VALUES ($1, 0, 0, $2, $3)
     ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
    [zoneId, lc[0]?.cnt || 0, lc[0]?.lm || 0]
  );
  await recalcZoneLoad(query, zoneId).catch(() => {});

  // 3. Reconnect power — wire this zone/building to the grid, then recompute
  //    power + lighting so getZonePowerStatus/visibility reflect it immediately.
  await autoResolvePower();

  const powerStatus = getZonePowerStatus(zoneId);
  const powered = powerStatus === 'powered' || powerStatus === 'overloaded';

  const flavor = created
    ? `A ${lightName} unfolds from the ceiling with a soft mechanical whir`
    : `The ${lightName} flickers to life`;
  const notify = powered
    ? `${flavor} — power hums through the grid and the room floods with light.`
    : `${flavor}, but no power reaches this room yet (status: ${powerStatus}).`;
  if (broadcast) broadcast(zoneId, { type: 'zone_event', message: `The ${lightName} flickers on.`, refresh: true }, player.id);
  return { type: 'look', message: await describeZone(zone, player), notify, zone: zoneId, minimap: getMinimapData(zoneId, 8, player) };
}

// .makeitrain — the Architect blesses you with a fat stack of credits. Admin
// wish-fulfilment: bumps your own balance by 100k, persists it, and pushes the
// new number to the HUD via player_update. Amusing by design.
async function cmdMakeItRain(args, raw, player, broadcast) {
  if (!['admin', 'dev'].includes(player.role)) {
    return { type: 'error', message: 'Unknown command: ".makeitrain".' };
  }
  const GRANT = 100000;
  player.credits = (player.credits || 0) + GRANT;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  if (broadcast) {
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `A shaft of light falls on ${player.handle}, and a blizzard of credit chips rains down from nowhere.`,
    }, player.id);
  }
  return {
    type: 'output',
    message: `☔ The Architect makes it rain. <b>+₵${GRANT.toLocaleString()}</b> — your balance is now <b>₵${player.credits.toLocaleString()}</b>.`,
    player_update: { credits: player.credits },
  };
}

export const commands = {
  // NB: register the BARE verb — the dispatcher strips a leading `.`/`/` before
  // matching, so a `.dresscyd` key would never fire.
  dresscyd: cmdDressCyd,
  lettherebelight: cmdLetThereBeLight,
  makeitrain: cmdMakeItRain,
};
