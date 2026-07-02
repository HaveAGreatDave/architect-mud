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
import { getZone, getZonePlayers, getZoneNpcs, getZoneEnemies, getLivePlayer, spawnEnemySync, removeEnemyInstance, world } from '../../server/engine/world.js';
import { skillCheck, awardSkillUse, effectiveSkill } from '../../server/engine/skills.js';
import { getPowerMap } from '../../server/engine/environment.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';

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

  const fx = await getInterferenceZones();
  const status = deviceStatus(target, fx);
  const frame = deviceFrame(target, status);
  if (!frame) {
    const label = status === 'jammed' ? 'JAMMED' : status === 'damaged' ? 'DAMAGED' : 'NO SIGNAL';
    return { type: 'output', message: `[FEED ▸ ${target.name}] — <span class="text-red">${label}</span> (${status})` };
  }
  const rec = target.is_recording ? ' 🔴REC' : '';
  const header = `[FEED ▸ ${target.name}] ${target.zone_name || target.zone_id} · ${clock()} · 🔋${batteryPct(target)}${rec}`;
  return { type: 'output', message: `${header}\n<span class="broadcast-ambient">${frame}</span>` };
}

// ── Surveillance Hub (Phase 2) ───────────────────────────────────────────────
// A carried spy-deck (or a fixed security_console furniture) opens a multi-feed
// panel. While open, the player id sits in hubViewers and the tick pushes fresh
// frames every 5s. Client re-renders on each push.

const hubViewers = new Set(); // playerId

const CAM_KINDS = new Set(['sticky_cam', 'drone']);

// Jammers/spoofers create per-zone interference. Cheap 4s cache so we don't
// re-query for every tile/feed lookup within a tick.
let _fxCache = { ts: 0, jammed: new Set(), spoofed: new Set() };
async function getInterferenceZones() {
  const now = Date.now();
  if (now - _fxCache.ts < 4000) return _fxCache;
  const { rows } = await query(
    `SELECT DISTINCT zone_id, device_kind FROM security_devices
      WHERE device_kind IN ('jammer','spoofer','relay') AND is_powered=1 AND is_damaged=0`
  );
  const jammed = new Set(), spoofed = new Set(), relayed = new Set();
  for (const r of rows) {
    if (r.device_kind === 'jammer') jammed.add(r.zone_id);
    else if (r.device_kind === 'spoofer') spoofed.add(r.zone_id);
    else relayed.add(r.zone_id);
  }
  // A powered relay punches signal through a jammer in the same zone.
  for (const z of relayed) jammed.delete(z);
  _fxCache = { ts: now, jammed, spoofed };
  return _fxCache;
}

// ── Sensor alerts (Phase 5) ──────────────────────────────────────────────────
// Motion/audio sensors don't stream video — they push alerts to their owner's
// hub alert strip (and ping the owner if online).
const alertsByOwner = new Map();   // ownerId -> [{ ts, t, text, zone }]
const sensorMemory = new Map();     // deviceId -> Set(names seen last tick)

function pushAlert(ownerId, text, zone) {
  if (!ownerId) return;
  const ring = alertsByOwner.get(ownerId) || [];
  ring.unshift({ ts: Date.now(), t: clock(), text, zone: zone || '' });
  while (ring.length > 30) ring.pop();
  alertsByOwner.set(ownerId, ring);
  sendToPlayer(ownerId, { type: 'system', message: `<span class="text-red">⚠ SPECTER</span> ${text}` });
}

function getAlerts(ownerId) {
  return (alertsByOwner.get(ownerId) || []).slice(0, 12).map(a => ({ t: a.t, text: a.text, zone: a.zone }));
}

// Poll motion sensors each tick: alert when a player or enemy newly enters a
// watched zone. (No engine movement event exists, so occupancy diffing it is.)
async function pollSensors() {
  const { rows } = await query(
    `SELECT d.id, d.owner_id, d.zone_id, d.device_kind, d.battery, d.battery_max, d.wired, d.is_damaged
       FROM security_devices d WHERE d.device_kind = 'motion_sensor'`
  );
  const zoneName = id => getZone(id)?.name || id;
  for (const d of rows) {
    if (!devicePowered(d)) { sensorMemory.delete(d.id); continue; }
    const present = new Set([
      ...(getZonePlayers(d.zone_id) || []).map(p => p.handle),
      ...(getZoneEnemies(d.zone_id) || []).map(e => e.name),
    ].filter(Boolean));
    const known = sensorMemory.has(d.id);       // skip baseline tick — only alert on real arrivals
    const last = sensorMemory.get(d.id) || new Set();
    if (known) {
      const entered = [...present].filter(n => !last.has(n));
      if (entered.length) pushAlert(d.owner_id, `MOTION — ${entered.join(', ')} in ${zoneName(d.zone_id)}.`, zoneName(d.zone_id));
    }
    sensorMemory.set(d.id, present);
  }
}

function deviceStatus(d, fx) {
  if (d.is_damaged) return 'damaged';
  if (!devicePowered(d)) return 'offline';
  if (CAM_KINDS.has(d.device_kind)) {
    if (fx.jammed.has(d.zone_id)) return 'jammed';   // jam beats spoof
    if (fx.spoofed.has(d.zone_id)) return 'spoofed';
  }
  return 'ok';
}

// A spoofed cam shows a plausible empty-room frame instead of the truth.
function spoofFrame(zoneId) {
  const zone = getZone(zoneId);
  if (!zone) return 'No movement.';
  const first = zone.description ? zone.description.split('.')[0] + '.' : zone.name;
  return `${first} No movement.`;
}

function deviceFrame(d, status) {
  if (status === 'spoofed') return spoofFrame(d.zone_id);
  if (status !== 'ok') return null;
  if (CAM_KINDS.has(d.device_kind)) return feedSnapshot(d.zone_id);
  switch (d.device_kind) {
    case 'jammer':  return '▓ SIGNAL JAMMER — feeds in this sector are down.';
    case 'spoofer': return '▓ FEED SPOOFER — cams here play clean footage.';
    case 'relay':   return '▨ RELAY ONLINE — extending network reach.';
    case 'motion_sensor':
    case 'audio_sensor': return '◉ SENSOR ARMED — watching for movement.';
    default: return 'ONLINE.';
  }
}

async function buildTiles(ownerId) {
  const fx = await getInterferenceZones();
  const { rows } = await query(
    `SELECT d.id, d.device_kind, d.zone_id, d.tier, d.battery, d.battery_max, d.wired,
            d.is_damaged, d.is_recording, d.status_flags, f.name, z.name AS zone_name
       FROM security_devices d
       JOIN furniture f ON f.id = d.id
       LEFT JOIN zones z ON z.id = d.zone_id
      WHERE d.owner_id = $1
      ORDER BY f.name`,
    [ownerId]
  );
  return rows.map(d => {
    const status = deviceStatus(d, fx);
    return {
      id: d.id,
      name: d.name,
      kind: d.device_kind,
      tier: d.tier || 1,
      zone: d.zone_name || d.zone_id,
      status,                                  // ok | offline | damaged | jammed | spoofed
      battery: batteryPct(d),
      recording: !!d.is_recording,
      frame: deviceFrame(d, status),
      ts: clock(),
    };
  });
}

async function buildHubPayload(player, open) {
  return {
    type: open ? 'surveillance_hub' : 'surveillance_hub_update',
    net: { name: `SPECTER // ${player.handle || 'OPERATOR'}`, color: '#39ff9e' },
    tiles: await buildTiles(player.id),
    alerts: getAlerts(player.id),
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

// Register the player as a hub viewer and return the open payload. The command
// pipeline delivers the return value to the client, so we don't also sendToPlayer
// here (that would double-open); the tick uses sendToPlayer for live updates.
async function openHubFor(player) {
  hubViewers.add(player.id);
  return buildHubPayload(player, true);
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

// Capture a frame into every recording device's buffer, then push live updates
// to open hubs. Runs every 5s regardless of viewers so recording continues while
// the operator is away.
async function surveillanceTick() {
  await captureRecordings();
  await pollSensors();
  for (const playerId of hubViewers) {
    const { rows } = await query('SELECT id, handle FROM players WHERE id=$1', [playerId]);
    if (!rows.length) { hubViewers.delete(playerId); continue; }
    sendToPlayer(playerId, await buildHubPayload(rows[0], false));
  }
}

setInterval(() => surveillanceTick().catch(e => console.error('[surveillance] hub tick error:', e.message)), 5000);

on('player.logout', ({ id }) => hubViewers.delete(id));

// ── Recording & datachips (Phase 3) ──────────────────────────────────────────
// A recording device banks a frame each tick into its ring buffer. `clip` exports
// the buffer to a security_clips row + a physical datachip item you can replay,
// trade, or hand to the police as evidence. Crimes witnessed in-frame get tagged.

// In-memory ring of recent crimes per zone, so a clip that overlaps a killing
// carries the evidence tag. Rebuilt on restart (fine — clips stamp at export time).
const crimeLog = new Map(); // zoneId -> [{ ts, tag }]
function logCrime(zoneId, tag) {
  if (!zoneId) return;
  const ring = crimeLog.get(zoneId) || [];
  ring.push({ ts: Date.now(), tag });
  while (ring.length > 50) ring.shift();
  crimeLog.set(zoneId, ring);
}
on('player.death', async ({ player, killer }) => {
  // Getting downed clears the victim's own wanted level (death / arrest).
  if (player?.id && wantedRuntime.has(player.id)) await clearWanted(player.id, 'you were taken down');

  const zoneId = player?.current_zone;
  if (!zoneId) return;
  logCrime(zoneId, 'murder');

  // Audio sensors in the zone catch the gunfire / scream.
  const { rows } = await query(
    `SELECT owner_id, battery, battery_max, wired, is_damaged, zone_id, device_kind
       FROM security_devices WHERE zone_id=$1 AND device_kind='audio_sensor'`, [zoneId]
  ).catch(() => ({ rows: [] }));
  const zoneName = getZone(zoneId)?.name || zoneId;
  for (const d of rows) {
    if (devicePowered(d)) pushAlert(d.owner_id, `AUDIO — gunfire and a scream in ${zoneName}.`, zoneName);
  }

  // A witnessed homicide by a player earns wanted stars + PD evidence + an APB.
  if (killer?.id && killer.handle && await isWitnessed(zoneId)) {
    await raiseWanted(killer, 2, 'a witnessed homicide');
    await logPoliceEvidence(zoneId, ['murder'], killer.handle);
    dispatchPolice(zoneId, 'homicide', killer.handle);
  }
});

function parseBuffer(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

async function captureRecordings() {
  const { rows } = await query(
    `SELECT id, device_kind, zone_id, battery, battery_max, wired, is_damaged, status_flags,
            recording_buffer, storage_limit
       FROM security_devices WHERE is_recording = 1`
  );
  if (!rows.length) return;
  const fx = await getInterferenceZones();
  for (const d of rows) {
    if (!CAM_KINDS.has(d.device_kind)) continue;
    const status = deviceStatus(d, fx);
    const frame = deviceFrame(d, status);      // null when offline/jammed → records nothing
    if (!frame) continue;                       // a spoofed cam banks the clean fake frame
    const buf = parseBuffer(d.recording_buffer);
    buf.push({ t: clock(), ts: Date.now(), text: frame });
    while (buf.length > (d.storage_limit || 200)) buf.shift();
    await query('UPDATE security_devices SET recording_buffer=$1 WHERE id=$2', [JSON.stringify(buf), d.id]);
  }
}

// record [name] — toggle recording on a device you own (in the current zone, or by name).
async function cmdRecord(args, raw, player) {
  const nameHint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT d.id, d.is_recording, f.name FROM security_devices d JOIN furniture f ON f.id=d.id
             WHERE d.owner_id=$1`;
  if (nameHint) { sql += ` AND (d.id=$2 OR f.name ILIKE $3)`; params.push(nameHint, `%${nameHint}%`); }
  sql += ` ORDER BY f.name LIMIT 1`;
  const { rows } = await query(sql, params);
  const dev = rows[0];
  if (!dev) return { type: 'error', message: nameHint ? `You have no deployed device matching "${nameHint}".` : "You have no deployed devices to record." };
  const next = dev.is_recording ? 0 : 1;
  await query('UPDATE security_devices SET is_recording=$1 WHERE id=$2', [next, dev.id]);
  return { type: 'output', message: next
    ? `<span class="text-red">●REC</span> ${dev.name} is now recording.`
    : `Recording stopped on ${dev.name}.` };
}

// clip [name] — burn the current buffer to a datachip in your inventory.
async function cmdClip(args, raw, player) {
  const nameHint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT d.id, d.zone_id, d.recording_buffer, f.name, z.name AS zone_name
             FROM security_devices d JOIN furniture f ON f.id=d.id
             LEFT JOIN zones z ON z.id=d.zone_id WHERE d.owner_id=$1`;
  if (nameHint) { sql += ` AND (d.id=$2 OR f.name ILIKE $3)`; params.push(nameHint, `%${nameHint}%`); }
  sql += ` ORDER BY f.name LIMIT 1`;
  const { rows } = await query(sql, params);
  const dev = rows[0];
  if (!dev) return { type: 'error', message: nameHint ? `You have no deployed device matching "${nameHint}".` : "You have no deployed devices." };

  const frames = parseBuffer(dev.recording_buffer);
  if (!frames.length) return { type: 'error', message: `${dev.name} has nothing recorded. Try "record" first.` };

  const firstTs = frames[0].ts || 0;
  const crimeTags = [...new Set((crimeLog.get(dev.zone_id) || []).filter(c => c.ts >= firstTs).map(c => c.tag))];

  const clipId = `clip_${Date.now()}_${randomUUID().slice(0, 4)}`;
  const itemId = `item_datachip_${clipId}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const zoneName = dev.zone_name || dev.zone_id || 'UNKNOWN';

  await query(
    `INSERT INTO security_clips (id, device_id, zone_id, owner_id, frames, captured_at, crime_tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [clipId, dev.id, dev.zone_id, player.id, JSON.stringify(frames), nowSec, JSON.stringify(crimeTags)]
  );

  const evidenceTag = crimeTags.length ? ` [EVIDENCE: ${crimeTags.join(', ').toUpperCase()}]` : '';
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, rarity, tags)
     VALUES ($1,$2,$3,'evidence',60,$4,$5,$6)`,
    [itemId, `Datachip — ${zoneName}`,
     `A slab of black storage glass, edge-lit amber. Holds ${frames.length} frames of surveillance footage from ${zoneName}.${evidenceTag}`,
     crimeTags.length ? 250 : 40, crimeTags.length ? 'rare' : 'common',
     JSON.stringify({ datachip: true, clip_id: clipId })]
  );
  await query(
    `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`,
    [randomUUID(), player.id, itemId]
  );

  return { type: 'output', message: `You burn the feed to a datachip — ${frames.length} frames from ${zoneName}.${evidenceTag ? ` <span class="text-red">${evidenceTag.trim()}</span>` : ''}\n<span class="text-dim">(use the datachip to replay it.)</span>` };
}

async function buildReplayPayload(clipRow) {
  return {
    type: 'datachip_replay',
    clip: {
      id: clipRow.id,
      zone: clipRow.zone_name || clipRow.zone_id || 'UNKNOWN',
      capturedAt: clipRow.captured_at,
      crimeTags: parseBuffer(clipRow.crime_tags),
      frames: parseBuffer(clipRow.frames),
    },
  };
}

// use <datachip> — open the replay deck.
async function doUseDatachip(args, raw, player) {
  const nameHint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
             WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'datachip')`;
  if (nameHint) { sql += ` AND i.name ILIKE $2`; params.push(`%${nameHint}%`); }
  sql += ` LIMIT 1`;
  const { rows } = await query(sql, params);
  if (!rows.length) return undefined; // no matching chip — fall through
  const clipId = rows[0].tags?.clip_id;
  const { rows: clip } = await query(
    `SELECT c.*, z.name AS zone_name FROM security_clips c LEFT JOIN zones z ON z.id=c.zone_id WHERE c.id=$1`,
    [clipId]
  );
  if (!clip.length) return { type: 'error', message: 'This datachip is corrupted — no footage found.' };
  return buildReplayPayload(clip[0]);
}

// replay [name] — same as use <datachip>, kept as a memorable verb.
async function cmdReplay(args, raw, player) {
  const result = await doUseDatachip(args, raw, player);
  if (result === undefined) return { type: 'error', message: "You aren't carrying a datachip to replay." };
  return result;
}

// clips — list the datachips you're carrying.
async function cmdClips(args, raw, player) {
  const { rows } = await query(
    `SELECT i.name, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'datachip') ORDER BY i.name`,
    [player.id]
  );
  if (!rows.length) return { type: 'output', message: 'You have no datachips.' };
  const lines = rows.map(r => `  • <span class="furniture-link">${r.name}</span>`).join('\n');
  return { type: 'output', message: `Datachips in your kit:\n${lines}\n<span class="text-dim">(use one to replay it.)</span>` };
}

// ── Counterplay (Phase 4) ────────────────────────────────────────────────────
// Find & destroy (smash), hack & hijack (Circuit Breach), and the jam/spoof
// gear (planted like any device; their effect is applied in deviceStatus/Frame).

// Dead-man ping: a destroyed/hijacked/breached device warns its owner.
function tamperPing(ownerId, actorId, name, zoneName, reason) {
  if (!ownerId || ownerId === actorId) return;
  sendToPlayer(ownerId, { type: 'system', message: `<span class="text-red">⚠ TAMPER</span> — ${name} at ${zoneName || 'unknown'} ${reason}` });
}

// smash <name> — rip a discovered device off its mount and destroy it.
async function cmdSmash(args, raw, player) {
  const nameHint = args.join(' ').trim();
  if (!nameHint) return { type: 'error', message: 'Smash what? Try "smash <device name>" (after a sweep).' };
  const { rows } = await query(
    `SELECT d.owner_id, d.zone_id, f.id, f.name, z.name AS zone_name, n.is_police
       FROM security_devices d JOIN furniture f ON f.id = d.id
       LEFT JOIN zones z ON z.id = d.zone_id
       LEFT JOIN security_networks n ON n.id = d.network_id
      WHERE d.zone_id = $1 AND f.name ILIKE $2 AND jsonb_exists(f.flags,'security_device') LIMIT 1`,
    [player.current_zone, `%${nameHint}%`]
  );
  const dev = rows[0];
  if (!dev) return { type: 'error', message: `There's no "${nameHint}" here to smash. Try "sweep" first.` };
  tamperPing(dev.owner_id, player.id, dev.name, dev.zone_name || dev.zone_id, 'was destroyed.');
  await query('DELETE FROM security_devices WHERE id=$1', [dev.id]);
  await query('DELETE FROM furniture WHERE id=$1', [dev.id]);
  if (dev.is_police) {
    await raiseWanted(player, 1, 'destroying a PD unit');
    dispatchPolice(dev.zone_id, 'vandalism of PD property', player.handle);
  }
  return { type: 'output', message: `You rip the ${dev.name} off its mount and grind it under your heel. Dead.` };
}

// hijack <name> — arm a breach on a live device and launch the Circuit Breach
// minigame client-side. The result comes back via `hijackresolve`.
const pendingHijack = new Map(); // playerId -> { deviceId, ts }
const hijackLockout = new Map(); // playerId -> untilTs

async function cmdHijack(args, raw, player) {
  const nameHint = args.join(' ').trim();
  if (!nameHint) return { type: 'error', message: 'Hijack what? Try "hijack <device name>".' };
  const until = hijackLockout.get(player.id) || 0;
  if (Date.now() < until) return { type: 'error', message: `Your rig is locked out. ${Math.ceil((until - Date.now()) / 1000)}s remaining.` };

  const { rows } = await query(
    `SELECT d.*, f.name, z.name AS zone_name FROM security_devices d JOIN furniture f ON f.id = d.id
       LEFT JOIN zones z ON z.id = d.zone_id
      WHERE d.zone_id = $1 AND f.name ILIKE $2 AND jsonb_exists(f.flags,'security_device') LIMIT 1`,
    [player.current_zone, `%${nameHint}%`]
  );
  const dev = rows[0];
  if (!dev) return { type: 'error', message: `There's no "${nameHint}" here. Try "sweep" first.` };
  if (dev.owner_id === player.id) return { type: 'error', message: `You already control the ${dev.name}.` };
  const fx = await getInterferenceZones();
  const status = deviceStatus(dev, fx);
  if (status !== 'ok' && status !== 'spoofed') {
    return { type: 'error', message: `The ${dev.name} has no live handshake to breach (it's ${status}).` };
  }
  const skill = await effectiveSkill(player, 'hacking');
  pendingHijack.set(player.id, { deviceId: dev.id, ts: Date.now() });
  return { type: 'circuit_hack', deviceId: dev.id, deviceName: dev.name, skill, difficulty: dev.hack_difficulty ?? 5 };
}

// hijackresolve <deviceId> <1|0> — silent; the Circuit Breach overlay fires this.
async function cmdHijackResolve(args, raw, player) {
  const deviceId = args[0];
  const win = args[1] === '1';
  const pending = pendingHijack.get(player.id);
  pendingHijack.delete(player.id);
  if (!pending || pending.deviceId !== deviceId || Date.now() - pending.ts > 180000) return { type: 'noop' };

  const { rows } = await query(
    `SELECT d.owner_id, d.zone_id, f.name, z.name AS zone_name, n.is_police FROM security_devices d
       JOIN furniture f ON f.id = d.id LEFT JOIN zones z ON z.id = d.zone_id
       LEFT JOIN security_networks n ON n.id = d.network_id WHERE d.id = $1`,
    [deviceId]
  );
  const dev = rows[0];
  if (!dev) return { type: 'error', message: 'The device is gone.' };

  if (win) {
    await query(
      `UPDATE security_devices
          SET owner_id = $1, network_id = NULL,
              status_flags = jsonb_set(COALESCE(status_flags, '{}'::jsonb), '{hijacked_by}', to_jsonb($1::text))
        WHERE id = $2`,
      [player.id, deviceId]
    );
    await awardSkillUse(player.id, 'hacking', 2);
    tamperPing(dev.owner_id, player.id, dev.name, dev.zone_name || dev.zone_id, 'was HIJACKED — you no longer control it.');
    if (dev.is_police) {
      await raiseWanted(player, 2, 'hijacking a PD unit');
      dispatchPolice(dev.zone_id, 'a systems breach', player.handle);
    }
    return { type: 'output', message: `<span class="ip-gain">BREACH SUCCESSFUL.</span> The ${dev.name} answers to you now. Pull up your hub.` };
  }
  hijackLockout.set(player.id, Date.now() + 5 * 60 * 1000);
  tamperPing(dev.owner_id, player.id, dev.name, dev.zone_name || dev.zone_id, 'repelled an intrusion attempt.');
  return { type: 'error', message: 'Handshake collapsed. Countermeasures traced your rig. Lockout: 5 minutes.' };
}

// ── Drone piloting (Phase 5) ─────────────────────────────────────────────────
const DIR_ALIASES = { n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down' };

// pilot [drone] <dir> — fly a deployed drone through a zone exit. Loud: both zones hear it.
async function cmdPilot(args, raw, player) {
  if (!args.length) return { type: 'error', message: 'Pilot where? Try "pilot <drone> <dir>".' };
  let dir = args[args.length - 1].toLowerCase();
  dir = DIR_ALIASES[dir] || dir;
  const nameHint = args.slice(0, -1).join(' ').trim();

  const params = [player.id];
  let sql = `SELECT d.id, d.zone_id, d.battery, d.battery_max, d.wired, d.is_damaged, f.name
             FROM security_devices d JOIN furniture f ON f.id=d.id
             WHERE d.owner_id=$1 AND d.device_kind='drone'`;
  if (nameHint) { sql += ` AND (d.id=$2 OR f.name ILIKE $3)`; params.push(nameHint, `%${nameHint}%`); }
  sql += ` ORDER BY f.name LIMIT 1`;
  const { rows } = await query(sql, params);
  const drone = rows[0];
  if (!drone) return { type: 'error', message: nameHint ? `You have no drone matching "${nameHint}".` : "You have no drone deployed." };
  if (!devicePowered(drone)) return { type: 'error', message: `${drone.name} is offline — dead battery.` };

  const zone = getZone(drone.zone_id);
  const target = zone?.exits?.[dir];
  if (!target) return { type: 'error', message: `${drone.name} can't go ${dir} — no exit that way.` };

  const chk = await skillCheck(player, 'drone_ops', 3);
  await query('UPDATE security_devices SET zone_id=$1 WHERE id=$2', [target, drone.id]);
  await query('UPDATE furniture SET zone_id=$1 WHERE id=$2', [target, drone.id]);

  const originName = zone?.name || drone.zone_id;
  const destName = getZone(target)?.name || target;
  sendToZone(drone.zone_id, { type: 'ambient', message: `A small drone whirrs and lifts away to the ${dir}.` });
  sendToZone(target, { type: 'ambient', message: `A small drone buzzes in from ${originName}.` });
  if (chk.success) await awardSkillUse(player.id, 'drone_ops', chk.margin);

  return { type: 'output', message: `You pilot the ${drone.name} ${dir} into ${destName}.${chk.success ? '' : ' <span class="text-dim">(rough handling — the link stuttered.)</span>'}` };
}

// ── NPC Police (Phase 6) ─────────────────────────────────────────────────────
// Police run their own is_police security_network of city cams. A cam that
// witnesses a crime auto-logs evidence, raises the suspect's heat, and puts out
// an APB (a `police.dispatch` event other systems can route patrols from).

let _policeCache = { ts: 0, zones: new Set() };
async function getPoliceCamZones() {
  const now = Date.now();
  if (now - _policeCache.ts < 5000) return _policeCache.zones;
  const { rows } = await query(
    `SELECT DISTINCT d.zone_id FROM security_devices d JOIN security_networks n ON n.id = d.network_id
      WHERE n.is_police = 1 AND d.device_kind IN ('sticky_cam','drone') AND d.is_powered=1 AND d.is_damaged=0`
  );
  _policeCache = { ts: now, zones: new Set(rows.map(r => r.zone_id)) };
  return _policeCache.zones;
}

async function logPoliceEvidence(zoneId, tags, suspect) {
  const zoneName = getZone(zoneId)?.name || zoneId;
  const { rows } = await query(`SELECT id FROM security_networks WHERE is_police=1 LIMIT 1`);
  const net = rows[0]?.id || null;
  const frame = { t: clock(), ts: Date.now(), text: `${suspect || 'Unknown'} — ${tags.join('/')} witnessed in ${zoneName}.` };
  await query(
    `INSERT INTO security_clips (id, device_id, zone_id, owner_id, frames, captured_at, crime_tags)
     VALUES ($1, NULL, $2, $3, $4, $5, $6)`,
    [`clip_pd_${Date.now()}_${randomUUID().slice(0, 4)}`, zoneId, net,
     JSON.stringify([frame]), Math.floor(Date.now() / 1000), JSON.stringify(tags)]
  );
}

function dispatchPolice(zoneId, reason, suspect) {
  const zoneName = getZone(zoneId)?.name || zoneId;
  sendToZone(zoneId, { type: 'ambient', message: `Somewhere close, sirens climb. SPECTER-PD is responding to a ${reason} at ${zoneName}.` });
  emit('police.dispatch', { zoneId, reason, suspect: suspect || null });   // seam for AI patrol routing
}

// ── Wanted system (0–5 stars) ────────────────────────────────────────────────
// A witnessed crime raises the suspect's wanted level; each tier deploys tougher
// police units that hunt the suspect (pursuit = redeployment to the suspect's
// zone). Stars decay while unseen, and clear on death / bribe / scrubbing.
const MAX_STARS = 5;
const DECAY_MS = 60000;          // time unseen before a star drops
const wantedRuntime = new Map(); // playerId -> { stars, lastCrimeTs, lastSeenTs, hunters:Set, deployedTier }

// Escalation ladder — the FULL desired roster at each star level. ★5 reuses the
// existing Arbiter enemy template (see plugins/emergency/index.js).
const TIERS = {
  1: [['enemy_wanted_patrol_officer', 1]],
  2: [['enemy_wanted_patrol_officer', 1], ['enemy_wanted_patrol_drone', 1]],
  3: [['enemy_wanted_enforcement_trooper', 2]],
  4: [['enemy_wanted_heavy_enforcer', 1], ['enemy_wanted_enforcement_trooper', 1]],
  5: [['enemy_arbiterclass_enforcement_unit', 2]],
};

// Hunter behaviour: engage the assigned target (set directly), else acquire/roam.
// Modeled on ARBITER_BEHAVIOUR_GRAPH but without the stand-down / long warning.
const WANTED_HUNTER_GRAPH = {
  _start: 'check_target',
  nodes: {
    check_target: { type: 'condition', condition_type: 'HAS_TARGET', params: {}, ifTrue: 'check_cried', ifFalse: 'scan' },
    check_cried:  { type: 'condition', condition_type: 'FLAG_SET', params: { flag: 'cried', scope: 'self' }, ifTrue: 'attack', ifFalse: 'cry' },
    cry:          { type: 'action', action_type: 'SAY', params: { message: 'SPECTER-PD — STOP RESISTING. COMPLY.' }, next: 'set_cried' },
    set_cried:    { type: 'action', action_type: 'SET_FLAG', params: { flag: 'cried', scope: 'self', value: 'true' }, next: 'attack' },
    attack:       { type: 'action', action_type: 'ATTACK', params: {}, next: 'loop' },
    scan:         { type: 'condition', condition_type: 'TARGETABLE_IN_ZONE', params: {}, ifTrue: 'acquire', ifFalse: 'roam' },
    acquire:      { type: 'action', action_type: 'ACQUIRE_TARGET', params: {}, next: 'loop' },
    roam:         { type: 'action', action_type: 'ROAM', params: { interval_s: 8 }, next: 'loop' },
    loop:         { type: 'loop', next: 'check_target' },
  },
};

const _tplCache = new Map();
async function getEnemyTemplate(id) {
  if (_tplCache.has(id)) return _tplCache.get(id);
  const { rows } = await query('SELECT * FROM enemies WHERE id=$1 LIMIT 1', [id]);
  const t = rows[0] || null;
  _tplCache.set(id, t);
  return t;
}

function wantedState(id) {
  let s = wantedRuntime.get(id);
  if (!s) { s = { stars: 0, lastCrimeTs: 0, lastSeenTs: 0, hunters: new Set(), deployedTier: 0 }; wantedRuntime.set(id, s); }
  return s;
}

function starBar(n) { return '★'.repeat(n) + '☆'.repeat(MAX_STARS - n); }
function sendWantedHud(playerId, stars) { sendToPlayer(playerId, { type: 'wanted_level', stars }); }

function despawnHunters(s) {
  for (const iid of s.hunters) removeEnemyInstance(iid);
  s.hunters.clear();
}

// A crime counts only if someone's watching: a live PD cam, an on-duty cop, or
// another player in the room.
async function isWitnessed(zoneId) {
  if (!zoneId) return false;
  const cams = await getPoliceCamZones();
  const fx = await getInterferenceZones();
  if (cams.has(zoneId) && !fx.jammed.has(zoneId)) return true;
  if ((getZoneNpcs(zoneId) || []).some(n => n.flags?.police)) return true;
  if ((getZonePlayers(zoneId) || []).length > 1) return true;   // a bystander could report
  return false;
}

async function raiseWanted(player, amount, reason) {
  if (!player?.id || !player.handle) return;    // players only
  const s = wantedState(player.id);
  const prev = s.stars;
  s.stars = Math.min(MAX_STARS, s.stars + amount);
  s.lastCrimeTs = Date.now();
  s.lastSeenTs = Date.now();
  await setFlag('player', 'wanted', s.stars, player);
  if (s.stars !== prev) {
    sendToPlayer(player.id, { type: 'system', message: `<span class="text-red">⚠ WANTED ${starBar(s.stars)}</span> — ${reason}.` });
    sendWantedHud(player.id, s.stars);
  }
}

// Set an online player's stars to an exact value (bribe/scrub). Rebuilds the
// hunter roster to the new tier; clears entirely at 0.
async function setStars(player, stars, reason) {
  const s = wantedState(player.id);
  s.stars = Math.max(0, Math.min(MAX_STARS, stars));
  despawnHunters(s);
  await setFlag('player', 'wanted', s.stars, player);
  sendWantedHud(player.id, s.stars);
  if (reason) sendToPlayer(player.id, { type: 'system', message: `<span class="text-dim">${reason}</span>` });
  if (s.stars <= 0) wantedRuntime.delete(player.id);
}

// Clear by id — safe for offline players (death / decay-to-zero).
async function clearWanted(playerId, reason) {
  const s = wantedRuntime.get(playerId);
  if (s) despawnHunters(s);
  wantedRuntime.delete(playerId);
  const p = getLivePlayer(playerId);
  if (p) {
    await setFlag('player', 'wanted', 0, p);
    sendWantedHud(playerId, 0);
    if (reason) sendToPlayer(playerId, { type: 'system', message: `<span class="text-dim">Wanted level cleared — ${reason}.</span>` });
  } else {
    await query(`UPDATE player_flags SET flag_value='0' WHERE player_id=$1 AND flag_key='wanted'`, [playerId]).catch(() => {});
  }
}

function spawnHunter(template, zoneId, suspectId) {
  const inst = spawnEnemySync(template, zoneId);
  inst.behaviour_graph = WANTED_HUNTER_GRAPH;
  inst.home_zone = zoneId;
  inst.flags = { ...(inst.flags || {}), hunter: true, suspect_id: suspectId };
  inst.targetId = suspectId;
  inst.aggroedAt = Date.now();
  if (inst._ai) inst._ai.flags.cried = false;
  return inst.instanceId;
}

// Keep the roster deployed at the suspect's current location; redeploy stragglers.
async function reconcileAndPursue(suspectId, s) {
  const suspect = getLivePlayer(suspectId);
  if (!suspect?.current_zone) return;
  const zone = suspect.current_zone;

  // Prune dead, redeploy any hunter not in the suspect's zone.
  for (const iid of [...s.hunters]) {
    const e = world.enemies.get(iid);
    if (!e) { s.hunters.delete(iid); continue; }
    if (e.zoneId !== zone) { removeEnemyInstance(iid); s.hunters.delete(iid); }
  }

  const haveByTpl = new Map();
  for (const iid of s.hunters) {
    const e = world.enemies.get(iid);
    if (e) haveByTpl.set(e.templateId, (haveByTpl.get(e.templateId) || 0) + 1);
  }

  let deployed = false;
  for (const [tpl, n] of (TIERS[s.stars] || [])) {
    const have = haveByTpl.get(tpl) || 0;
    for (let i = have; i < n; i++) {
      const template = await getEnemyTemplate(tpl);
      if (!template) continue;   // template not seeded — skip tier gracefully
      s.hunters.add(spawnHunter(template, zone, suspectId));
      deployed = true;
    }
  }
  // Keep targets locked on the suspect.
  for (const iid of s.hunters) {
    const e = world.enemies.get(iid);
    if (e) { e.targetId = suspectId; if (!e.aggroedAt) e.aggroedAt = Date.now(); }
  }
  if (deployed) sendToZone(zone, { type: 'ambient', message: 'Boots and servos in the corridor — SPECTER-PD has your position.' });
}

async function wantedTick() {
  for (const [pid, s] of wantedRuntime) {
    if (s.stars <= 0) { despawnHunters(s); wantedRuntime.delete(pid); continue; }
    const suspect = getLivePlayer(pid);
    if (!suspect) { despawnHunters(s); continue; }   // offline: hold stars (flag), drop units

    if (await isWitnessed(suspect.current_zone)) s.lastSeenTs = Date.now();

    if (Date.now() - s.lastSeenTs > DECAY_MS) {
      s.stars -= 1;
      s.lastSeenTs = Date.now();
      despawnHunters(s);
      if (s.stars <= 0) { await clearWanted(pid, 'you lay low long enough'); continue; }
      await setFlag('player', 'wanted', s.stars, suspect);
      sendWantedHud(pid, s.stars);
      sendToPlayer(pid, { type: 'system', message: `<span class="text-dim">The heat's dropping. ${starBar(s.stars)}</span>` });
    }
    await reconcileAndPursue(pid, s);
  }
}
setInterval(() => wantedTick().catch(e => console.error('[surveillance] wanted tick error:', e.message)), 4000);

on('player.login', async ({ id }) => {
  const p = getLivePlayer(id);
  if (!p) return;
  const stars = parseInt(await getFlag('player', 'wanted', p) || '0', 10) || 0;
  if (stars > 0) {
    const s = wantedState(id);
    s.stars = stars; s.lastSeenTs = Date.now(); s.lastCrimeTs = Date.now();
    sendWantedHud(id, stars);
  }
});
on('player.logout', ({ id }) => { const s = wantedRuntime.get(id); if (s) despawnHunters(s); });

// wanted — check your own heat.
async function cmdWanted(args, raw, player) {
  const stars = wantedRuntime.get(player.id)?.stars ?? (parseInt(await getFlag('player', 'wanted', player) || '0', 10) || 0);
  return { type: 'output', message: stars > 0 ? `WANTED: <span class="text-red">${starBar(stars)}</span>` : "You're clean. For now." };
}

// bribe — pay off an on-scene officer to knock a star off (petty heat only).
async function cmdBribe(args, raw, player) {
  const cop = (getZoneNpcs(player.current_zone) || []).find(n => n.flags?.police);
  if (!cop) return { type: 'error', message: "There's no officer here to bribe." };
  const s = wantedState(player.id);
  if (s.stars <= 0) return { type: 'error', message: "You're not wanted. Save your credits." };
  if (s.stars > 2) return { type: 'error', message: `${cop.name} won't touch a manhunt this hot. Bribes are for petty heat.` };
  const cost = s.stars * 250;
  if ((player.credits || 0) < cost) return { type: 'error', message: `${cop.name} wants ${cost}c to look the other way. You're short.` };
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await setStars(player, s.stars - 1, `${cop.name} pockets ${cost}c and loses your file. ${starBar(Math.max(0, s.stars))}`);
  return { type: 'output', message: `You slip ${cop.name} ${cost}c. They suddenly have somewhere else to be.`, player_update: { credits: player.credits } };
}

// scrub — hack a PD terminal to wipe a star off your record.
async function cmdScrub(args, raw, player) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'police_terminal') LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return { type: 'error', message: "There's no police terminal here to scrub." };
  const s = wantedState(player.id);
  if (s.stars <= 0) return { type: 'error', message: "Your record's already clean." };
  const chk = await skillCheck(player, 'hacking', 4 + s.stars);
  if (!chk.success) {
    return { type: 'error', message: 'The record locks you out — and the query pings a sysop. Your heat holds.' };
  }
  await awardSkillUse(player.id, 'hacking', chk.margin);
  await setStars(player, s.stars - 1, `You scrub a charge from the PD database. ${starBar(Math.max(0, s.stars))}`);
  return { type: 'output', message: 'You slip into the records node and quietly delete an incident report.' };
}

// submit [datachip] — hand crime-tagged evidence to an on-scene officer for a bounty.
async function cmdSubmit(args, raw, player) {
  const cop = (getZoneNpcs(player.current_zone) || []).find(n => n.flags?.police);
  if (!cop) return { type: 'error', message: "There's no officer here to take evidence." };

  const nameHint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT pi.id AS inv_id, i.name, i.tags FROM player_inventory pi JOIN items i ON i.id = pi.item_id
             WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'datachip')`;
  if (nameHint) { sql += ` AND i.name ILIKE $2`; params.push(`%${nameHint}%`); }
  sql += ` LIMIT 1`;
  const { rows } = await query(sql, params);
  const chip = rows[0];
  if (!chip) return { type: 'error', message: nameHint ? `You have no datachip matching "${nameHint}".` : "You have no datachip to submit." };

  const clipId = chip.tags?.clip_id;
  const { rows: clip } = await query('SELECT crime_tags FROM security_clips WHERE id=$1', [clipId]);
  const tags = clip.length ? parseBuffer(clip[0].crime_tags) : [];
  if (!tags.length) return { type: 'error', message: `${cop.name} skims the footage and shrugs. "Nothing chargeable here. No bounty."` };

  const reward = 100 + 150 * tags.length;
  player.credits = (player.credits || 0) + reward;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query('DELETE FROM player_inventory WHERE id=$1', [chip.inv_id]);
  return {
    type: 'output',
    message: `${cop.name} slots the chip, scans the ${tags.join('/')} footage, and pays out <span class="ip-gain">${reward}c</span> in evidence bounty.`,
    player_update: { credits: player.credits },
  };
}

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
  record: cmdRecord,
  clip: cmdClip,
  clips: cmdClips,
  replay: cmdReplay,
  smash: cmdSmash,
  hijack: cmdHijack,
  hijackresolve: cmdHijackResolve,
  pilot: cmdPilot,
  submit: cmdSubmit,
  wanted: cmdWanted,
  bribe: cmdBribe,
  scrub: cmdScrub,
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'spy_deck', handler: doUseSpyDeck },
  { verb: 'use', requiredTag: 'security_console', handler: doUseConsole },
  { verb: 'use', requiredTag: 'datachip', handler: doUseDatachip },
];

console.log('[surveillance] Plugin loaded.');
