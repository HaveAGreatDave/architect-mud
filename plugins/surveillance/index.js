// SPECTER surveillance — Phase 1 (Foundation).
// Player-deployable spy devices: plant / retrieve / sweep + a remote `feed` view
// and a battery/power tick. See docs/systems-surveillance.md.
//
// A planted device is a furniture row (object_type 'security_device', flags.concealed)
// whose id matches its security_devices row — mirroring the atm_units <-> furniture
// convention. Concealed furniture is filtered out of the room `look` (describe.js);
// `sweep` is how anyone locates hidden gear.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, getZonePlayers, getZoneNpcs, getZoneEnemies } from '../../server/engine/world.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { getPowerMap } from '../../server/engine/environment.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';

const COMPASS = new Set(['north', 'south', 'east', 'west', 'up', 'down', 'n', 's', 'e', 'w', 'u', 'd']);

// Battery drain per 5-minute tick, by device kind. sticky_cam @864 max ≈ 3 days;
// drone @864 ≈ 6 hours. Wired devices ignore this and follow zone power instead.
const DRAIN = { sticky_cam: 1, relay: 1, motion_sensor: 1, audio_sensor: 1, jammer: 2, spoofer: 2, drone: 12 };

// ── Helpers ────────────────────────────────────────────────────────────────

function isZonePowered(zoneId) {
  const map = getPowerMap();
  const z = map.find(e => e.zoneId === zoneId);
  return !z || z.status === 'powered' || z.status === 'overloaded';
}

// A device is drawing power (and thus producing a signal) when it isn't damaged and
// either has battery left or is wired into a powered zone.
function devicePowered(dev) {
  if (dev.is_damaged) return false;
  if (dev.wired) return isZonePowered(dev.zone_id);
  return (dev.battery || 0) > 0;
}

// Live text snapshot of what a device sees in its zone — the raw feed frame.
function feedSnapshot(zoneId) {
  const zone = getZone(zoneId);
  if (!zone) return 'NO SIGNAL — zone unreachable.';
  const players = getZonePlayers(zoneId) || [];
  const npcs = getZoneNpcs(zoneId) || [];
  const enemies = getZoneEnemies(zoneId) || [];
  const first = zone.description ? zone.description.split('.')[0] + '.' : zone.name;
  const visible = [
    ...players.map(p => p.handle),
    ...npcs.map(n => n.name),
    ...enemies.map(e => e.name),
  ].filter(Boolean);
  return visible.length ? `${first} Visible: ${visible.join(', ')}.` : `${first} No movement.`;
}

function clock() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function batteryPct(dev) {
  if (dev.wired) return isZonePowered(dev.zone_id) ? 'WIRED' : 'WIRED (dark)';
  const max = dev.battery_max || 1;
  return `${Math.round(((dev.battery || 0) / max) * 100)}%`;
}

// ── plant ────────────────────────────────────────────────────────────────
// plant <gear name> [direction] — conceal a carried device in the current zone.
async function cmdPlant(args, raw, player) {
  const words = [...args];
  let direction = 'north';
  if (words.length && COMPASS.has(words[words.length - 1].toLowerCase())) {
    direction = words.pop().toLowerCase();
  }
  const nameHint = words.join(' ').trim();

  const params = [player.id];
  let sql = `SELECT pi.id AS inv_id, pi.item_id, pi.quantity, i.name, i.description, i.tags
             FROM player_inventory pi JOIN items i ON i.id = pi.item_id
             WHERE pi.player_id = $1 AND pi.container_id IS NULL
               AND jsonb_exists(i.tags, 'security_gear')`;
  if (nameHint) { sql += ` AND i.name ILIKE $2`; params.push(`%${nameHint}%`); }
  sql += ` ORDER BY i.name LIMIT 1`;
  const { rows } = await query(sql, params);
  const gear = rows[0];
  if (!gear) {
    return { type: 'error', message: nameHint
      ? `You aren't carrying a "${nameHint}" you can plant.`
      : "You aren't carrying any surveillance gear to plant." };
  }

  const t = gear.tags || {};
  const kind = t.device_kind || 'sticky_cam';
  const tier = parseInt(t.device_tier, 10) || 1;
  const batteryMax = parseInt(t.battery_max, 10) || 864;
  const wired = t.wired ? 1 : 0;
  const hackDiff = parseInt(t.hack_difficulty, 10) || 5;
  const concealBase = parseInt(t.concealment_base, 10) || 4;

  // Concealment quality is a Security check — a clean plant hides better.
  const chk = await skillCheck(player, 'security', 5);
  const concealment = Math.max(1, concealBase + chk.margin);

  const id = `secdev_${Date.now()}_${randomUUID().slice(0, 4)}`;
  const nowSec = Math.floor(Date.now() / 1000);

  await query(
    `INSERT INTO security_devices
       (id, owner_id, device_kind, zone_id, direction, tier, concealment,
        battery, battery_max, wired, hack_difficulty, placed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)`,
    [id, player.id, kind, player.current_zone, direction, tier, concealment,
     batteryMax, wired, hackDiff, nowSec]
  );

  await query(
    `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
     VALUES ($1,$2,$3,$4,'security_device',$5)`,
    [id, player.current_zone, gear.name,
     gear.description || 'A discreet surveillance device.',
     JSON.stringify({ security_device: true, device_id: id, concealed: true,
                      security_item_id: gear.item_id, device_kind: kind })]
  );

  if (gear.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [gear.inv_id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [gear.inv_id]);

  if (chk.success) await awardSkillUse(player.id, 'security', chk.margin);

  const quality = concealment >= 8 ? 'It all but vanishes.' : concealment >= 5 ? 'Nicely tucked away.' : 'It could be spotted by a careful eye.';
  return { type: 'output', message: `You conceal the ${gear.name} facing ${direction}. ${quality}` };
}

// ── retrieve ────────────────────────────────────────────────────────────────
// retrieve <name> — pull a planted device and pocket it as gear again.
async function cmdRetrieve(args, raw, player) {
  const nameHint = args.join(' ').trim();
  if (!nameHint) return { type: 'error', message: 'Retrieve what? Try "retrieve <device name>".' };

  const { rows } = await query(
    `SELECT id, name, flags FROM furniture
     WHERE zone_id=$1 AND jsonb_exists(flags, 'security_device') AND name ILIKE $2 LIMIT 1`,
    [player.current_zone, `%${nameHint}%`]
  );
  const furn = rows[0];
  if (!furn) return { type: 'error', message: `There's no "${nameHint}" here to retrieve. Try "sweep" first.` };

  const itemId = furn.flags?.security_item_id;
  await query('DELETE FROM security_devices WHERE id=$1', [furn.id]);
  await query('DELETE FROM furniture WHERE id=$1', [furn.id]);

  if (itemId) {
    const { rows: ex } = await query(
      'SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1',
      [player.id, itemId]
    );
    if (ex.length) await query('UPDATE player_inventory SET quantity=quantity+1 WHERE id=$1', [ex[0].id]);
    else await query(
      'INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)',
      [randomUUID(), player.id, itemId]
    );
  }

  return { type: 'output', message: `You pry the ${furn.name} loose and pocket it.` };
}

// ── sweep ────────────────────────────────────────────────────────────────
// sweep — Security check to locate hidden surveillance gear in the current zone.
async function cmdSweep(args, raw, player) {
  const { rows } = await query(
    `SELECT d.id, d.device_kind, d.concealment, d.battery, d.battery_max, d.wired,
            d.is_damaged, d.zone_id, f.name
       FROM security_devices d JOIN furniture f ON f.id = d.id
      WHERE d.zone_id = $1`,
    [player.current_zone]
  );

  if (!rows.length) {
    return { type: 'output', message: 'You sweep the area for surveillance gear. Nothing here.' };
  }

  const found = [];
  let bestMargin = -99;
  for (const d of rows) {
    const chk = await skillCheck(player, 'security', d.concealment);
    if (chk.success) { found.push(d); bestMargin = Math.max(bestMargin, chk.margin); }
  }

  if (!found.length) {
    return { type: 'output', message: "You sweep the area. You don't find anything — but that doesn't mean it's clean." };
  }

  await awardSkillUse(player.id, 'security', bestMargin);
  const lines = found.map(d => {
    const state = devicePowered(d) ? `🔋 ${batteryPct(d)}` : 'OFFLINE';
    return `  • <span class="furniture-link">${d.name}</span> [${d.device_kind}] — ${state}`;
  });
  return { type: 'output', message: `You spot concealed gear:\n${lines.join('\n')}\n<span class="text-dim">(examine or retrieve by name)</span>` };
}

// ── feed ────────────────────────────────────────────────────────────────
// feed [name] — remote-view a device you own, from anywhere. Precursor to the
// Surveillance Hub panel (Phase 2).
async function cmdFeed(args, raw, player) {
  const nameHint = args.join(' ').trim();
  const { rows } = await query(
    `SELECT d.id, d.device_kind, d.zone_id, d.battery, d.battery_max, d.wired,
            d.is_damaged, d.is_recording, f.name, z.name AS zone_name
       FROM security_devices d
       JOIN furniture f ON f.id = d.id
       LEFT JOIN zones z ON z.id = d.zone_id
      WHERE d.owner_id = $1
      ORDER BY f.name`,
    [player.id]
  );
  if (!rows.length) return { type: 'error', message: "You don't have any surveillance devices deployed." };

  let target = rows[0];
  if (nameHint) {
    target = rows.find(d => d.name.toLowerCase().includes(nameHint.toLowerCase()));
    if (!target) return { type: 'error', message: `You have no deployed device matching "${nameHint}".` };
  } else if (rows.length > 1) {
    const list = rows.map(d => `  • ${d.name} — ${d.zone_name || d.zone_id} (${devicePowered(d) ? batteryPct(d) : 'OFFLINE'})`).join('\n');
    return { type: 'output', message: `SPECTER // deployed devices:\n${list}\n<span class="text-dim">Use "feed <name>" to view one.</span>` };
  }

  if (!devicePowered(target)) {
    return { type: 'output', message: `[FEED ▸ ${target.name}] — <span class="text-red">NO SIGNAL</span> (offline)` };
  }
  const rec = target.is_recording ? ' 🔴REC' : '';
  const header = `[FEED ▸ ${target.name}] ${target.zone_name || target.zone_id} · ${clock()} · 🔋${batteryPct(target)}${rec}`;
  return { type: 'output', message: `${header}\n<span class="broadcast-ambient">${feedSnapshot(target.zone_id)}</span>` };
}

// ── Surveillance Hub (Phase 2) ───────────────────────────────────────────────
// A carried spy-deck (or a fixed security_console furniture) opens a multi-feed
// panel. While open, the player id sits in hubViewers and the tick pushes fresh
// frames every 5s. Client re-renders on each push.

const hubViewers = new Set(); // playerId

function tileStatus(d) {
  if (d.is_damaged) return 'damaged';
  if (!devicePowered(d)) return 'offline';
  const sf = d.status_flags || {};
  if (sf.jammed) return 'jammed';
  if (sf.spoofed) return 'spoofed';
  return 'ok';
}

async function buildTiles(ownerId) {
  const { rows } = await query(
    `SELECT d.id, d.device_kind, d.zone_id, d.battery, d.battery_max, d.wired,
            d.is_damaged, d.is_recording, d.status_flags, f.name, z.name AS zone_name
       FROM security_devices d
       JOIN furniture f ON f.id = d.id
       LEFT JOIN zones z ON z.id = d.zone_id
      WHERE d.owner_id = $1
      ORDER BY f.name`,
    [ownerId]
  );
  return rows.map(d => {
    const status = tileStatus(d);
    return {
      id: d.id,
      name: d.name,
      kind: d.device_kind,
      zone: d.zone_name || d.zone_id,
      status,                                  // ok | offline | damaged | jammed | spoofed
      battery: batteryPct(d),
      recording: !!d.is_recording,
      frame: status === 'ok' ? feedSnapshot(d.zone_id) : null,
      ts: clock(),
    };
  });
}

async function buildHubPayload(player, open) {
  return {
    type: open ? 'surveillance_hub' : 'surveillance_hub_update',
    net: { name: `SPECTER // ${player.handle || 'OPERATOR'}`, color: '#39ff9e' },
    tiles: await buildTiles(player.id),
  };
}

async function playerHasSpyDeck(playerId) {
  const { rows } = await query(
    `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND jsonb_exists(i.tags, 'spy_deck') LIMIT 1`,
    [playerId]
  );
  return rows.length > 0;
}

async function openHubFor(player) {
  const payload = await buildHubPayload(player, true);
  sendToPlayer(player.id, payload);
  hubViewers.add(player.id);
  return payload;
}

// hub — open the Surveillance Hub (requires a carried spy-deck).
async function cmdHub(args, raw, player) {
  if (!await playerHasSpyDeck(player.id)) {
    return { type: 'error', message: 'You need a surveillance deck to pull a feed. (No deck in hand.)' };
  }
  return openHubFor(player);
}

// hubclose — silent; client fires this when the panel closes.
async function cmdHubClose(args, raw, player) {
  hubViewers.delete(player.id);
  return { type: 'noop' };
}

// use <deck> — carried spy-deck path.
async function doUseSpyDeck(args, raw, player) {
  if (!await playerHasSpyDeck(player.id)) return undefined; // fall through
  const nameHint = args.join(' ').trim().toLowerCase();
  if (nameHint) {
    const { rows } = await query(
      `SELECT i.name FROM player_inventory pi JOIN items i ON i.id = pi.item_id
        WHERE pi.player_id = $1 AND jsonb_exists(i.tags, 'spy_deck') AND i.name ILIKE $2 LIMIT 1`,
      [player.id, `%${nameHint}%`]
    );
    if (!rows.length) return undefined; // named something else — let other handlers try
  }
  return openHubFor(player);
}

// use <security console> — fixed furniture path.
async function doUseConsole(args, raw, player) {
  const nameHint = args.join(' ').trim();
  const params = [player.current_zone];
  let sql = `SELECT id FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'security_console')`;
  if (nameHint) { sql += ` AND name ILIKE $2`; params.push(`%${nameHint}%`); }
  sql += ' LIMIT 1';
  const { rows } = await query(sql, params);
  if (!rows.length) return undefined;
  return openHubFor(player);
}

async function surveillanceTick() {
  if (!hubViewers.size) return;
  for (const playerId of hubViewers) {
    const { rows } = await query('SELECT id, handle FROM players WHERE id=$1', [playerId]);
    if (!rows.length) { hubViewers.delete(playerId); continue; }
    sendToPlayer(playerId, await buildHubPayload(rows[0], false));
  }
}

setInterval(() => surveillanceTick().catch(e => console.error('[surveillance] hub tick error:', e.message)), 5000);

on('player.logout', ({ id }) => hubViewers.delete(id));

// ── Battery / power tick ─────────────────────────────────────────────────────
async function batteryTick() {
  const { rows } = await query(
    'SELECT id, device_kind, wired, battery, is_damaged, zone_id FROM security_devices'
  );
  for (const d of rows) {
    if (d.wired) {
      const powered = isZonePowered(d.zone_id) && !d.is_damaged ? 1 : 0;
      await query('UPDATE security_devices SET is_powered=$1 WHERE id=$2', [powered, d.id]);
    } else {
      const drain = DRAIN[d.device_kind] ?? 1;
      const battery = Math.max(0, (d.battery || 0) - drain);
      const powered = battery > 0 && !d.is_damaged ? 1 : 0;
      await query('UPDATE security_devices SET battery=$1, is_powered=$2 WHERE id=$3', [battery, powered, d.id]);
    }
  }
}

setInterval(() => batteryTick().catch(e => console.error('[surveillance] battery tick error:', e.message)), 5 * 60 * 1000);

// ── Plugin exports ────────────────────────────────────────────────────────────

export const commands = {
  plant: cmdPlant,
  retrieve: cmdRetrieve,
  sweep: cmdSweep,
  feed: cmdFeed,
  hub: cmdHub,
  hubclose: cmdHubClose,
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'spy_deck', handler: doUseSpyDeck },
  { verb: 'use', requiredTag: 'security_console', handler: doUseConsole },
];

console.log('[surveillance] Plugin loaded.');
