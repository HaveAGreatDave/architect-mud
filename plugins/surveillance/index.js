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
import { getZone, getZonePlayers, getZoneNpcs, getZoneEnemies, getLivePlayer, getAllLivePlayers, spawnEnemySync, removeEnemyInstance, hasActivePlayers, world, insertFurniture, updateFurniture, deleteFurniture } from '../../server/engine/world.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { exitTargets, neighborZoneIds } from '../../server/engine/exits.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { skillCheck, awardSkillUse, effectiveSkill } from '../../server/engine/skills.js';
import { hackDifficulty, breachMargin } from '../../server/engine/hack-gear.js';
import { visibleIntoxication } from '../../server/engine/drugs.js';
import { getPowerMap, getZoneVisibility, LIGHT_LADDER } from '../../server/engine/environment.js';
import { sendToPlayer, sendToZone, getBroadcast } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { getFlag, setFlag, updateFlagById } from '../../server/engine/flags.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getTunable } from '../../server/engine/tunables.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { getCrimeStars, getCrimeWitness, getCrimeLabel, isCrimeEnabled } from '../../server/engine/crimes.js';
import { gameMsToReal, realMsToGame } from '../../server/engine/gametime.js';

const COMPASS = new Set(['north', 'south', 'east', 'west', 'up', 'down', 'n', 's', 'e', 'w', 'u', 'd']);

// Cops don't chase a suspect who's currently airborne — you can't be apprehended
// or searched mid-flight (no-fly airspace still raises stars via the flight plugin;
// the pursuit simply waits until you're back on the ground). A player in a cockpit
// carries an `aircraftId`; that's the authoritative "in a plane" signal.
const isAirborne = (player) => !!player?.aircraftId;

// Battery drain per 5-minute tick, by device kind. sticky_cam @864 max ≈ 3 days;
// drone @864 ≈ 6 hours. Wired devices ignore this and follow zone power instead.
const DRAIN = { sticky_cam: 1, relay: 1, motion_sensor: 1, audio_sensor: 1, jammer: 2, spoofer: 2, drone: 12 };

// Adhesive sticky cams cook their own guts after a day on the wall — a planted cam
// is a burner, not an installation. Wired taps run off zone mains and are exempt.
// A sticky cam's cell cooks it off the wall after 24 hours — 24 GAME hours, matching
// the fiction and every in-world clock the player reads (was 24 real hours until
// 2026-07-21, which at the live time_scale of 3 was really three in-world days).
// Converted at the point of use, not at plant time, so a live time-scale change is
// honoured on the next sweep — the tick-driven pattern in gametime.js.
const STICKY_CAM_TTL_GAME_MS = 24 * 60 * 60 * 1000;
const stickyCamTtlRealMs = () => gameMsToReal(STICKY_CAM_TTL_GAME_MS);
export const __stickyCamTtl = () => ({ gameMs: STICKY_CAM_TTL_GAME_MS, realMs: stickyCamTtlRealMs() });

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

  const gear = await resolveInventoryItem(player, { tag: 'security_gear', name: nameHint || undefined, orderBy: 'i.name' });
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
  invalidateDeviceCache();

  await insertFurniture({
    id, zone_id: player.current_zone, name: gear.name,
    description: gear.description || 'A discreet surveillance device.',
    object_type: 'security_device',
    flags: JSON.stringify({ security_device: true, device_id: id, concealed: true,
                            security_item_id: gear.item_id, device_kind: kind }),
    origin: 'player', owner_id: player.id,
  });

  if (gear.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [gear.inv_id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [gear.inv_id]);

  // Planting trains Security whether or not the concealment lands well — a
  // near-miss teaches as much (abs margin, see awardIp).
  await awardSkillUse(player.id, 'security', chk.margin);

  const quality = concealment >= 8 ? 'It all but vanishes.' : concealment >= 5 ? 'Nicely tucked away.' : 'It could be spotted by a careful eye.';
  const burnout = (kind === 'sticky_cam' && !wired) ? ' Its cell cooks the unit off the wall in 24 hours.' : '';
  return { type: 'output', message: `You conceal the ${gear.name} facing ${direction}. ${quality}${burnout}` };
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
  invalidateDeviceCache();
  await deleteFurniture(furn.id);
  cameraBuffers.delete(furn.id);   // drop any in-memory rolling buffer for the pulled device

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
const panelWatchers = new Map(); // playerId -> Set(deviceId) — sticky-cam sidebar panels

const CAM_KINDS = new Set(['sticky_cam', 'drone']);

// Jammers/spoofers create per-zone interference. Cheap 4s cache so we don't
// re-query for every tile/feed lookup within a tick.
let _fxCache = { ts: 0, jammed: new Set(), spoofed: new Set() };
// ── The device snapshot ───────────────────────────────────────────────────────
//
// security_devices is small (tens of rows) and read constantly: the 5s tick used
// to fire one SELECT for recording cams, one for motion sensors, one for
// interference zones, and then one MORE per occupied zone to ask "is a camera
// watching here?" — measured at ~97 round trips per 75 s on an idle server with
// a single player standing still, 45% of all its database traffic.
//
// So read the whole table once and answer all four questions from that. The 4 s
// freshness window is the one getInterferenceZones already ran on, so this adds
// no staleness class the file didn't already accept — it just stops paying for
// the same rows six times a tick.
//
// Deliberately a short TTL rather than a write-through cache: every runtime
// writer lives in this file, but regress and the offline scripts write the table
// directly, and a TTL self-heals where a write-through cache would silently
// serve stale rows forever.
let _devCache = { ts: 0, rows: [] };
async function allDevices(force = false) {
  const now = Date.now();
  if (!force && now - _devCache.ts < 4000) return _devCache.rows;
  const { rows } = await query('SELECT * FROM security_devices').catch(() => ({ rows: null }));
  // A failed read must not be cached as "no devices" — that would silently
  // switch surveillance off for 4 s. Keep the last good snapshot instead.
  if (rows) _devCache = { ts: now, rows };
  return _devCache.rows;
}
// Called by anything in this file that changes the table and needs its own next
// read to see the change (placing a camera, then immediately looking at it).
function invalidateDeviceCache() { _devCache = { ts: 0, rows: _devCache.rows }; }

async function getInterferenceZones() {
  const now = Date.now();
  if (now - _fxCache.ts < 4000) return _fxCache;
  const rows = (await allDevices()).filter(d =>
    ['jammer', 'spoofer', 'relay'].includes(d.device_kind) && d.is_powered === 1 && d.is_damaged === 0);
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
  const rows = (await allDevices()).filter(d => d.device_kind === 'motion_sensor');
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
            d.is_damaged, d.is_recording, d.status_flags, d.placed_at, f.name, z.name AS zone_name
       FROM security_devices d
       JOIN furniture f ON f.id = d.id
       LEFT JOIN zones z ON z.id = d.zone_id
      WHERE d.owner_id = $1
      ORDER BY f.name`,
    [ownerId]
  );
  return rows.map(d => {
    const status = deviceStatus(d, fx);
    const buf = cameraBuffers.get(d.id);
    return {
      id: d.id,
      name: d.name,
      kind: d.device_kind,
      tier: d.tier || 1,
      zone: d.zone_name || d.zone_id,
      status,                                  // ok | offline | damaged | jammed | spoofed
      battery: batteryPct(d),
      recording: !!d.is_recording,
      full: !!buf?.full,                       // buffer hit its cap → stopped until clip/clear
      bufferLines: buf?.frames.length || 0,    // lines on tape waiting to be clipped
      frame: deviceFrame(d, status),
      ts: clock(),
      // GAME minutes left before the 24-game-hour sticky-cam burnout (null = doesn't
      // expire). Game, not real: the Tablet renders this as "⏻ 23h" and the plant copy
      // promises 24 hours, so a real-time figure would contradict both.
      expiresIn: (d.device_kind === 'sticky_cam' && !d.wired && d.placed_at)
        ? Math.max(0, Math.round(realMsToGame(Number(d.placed_at) * 1000 + stickyCamTtlRealMs() - Date.now()) / 60000))
        : null,
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
  return !!(await resolveInventoryItem(playerId, { tag: 'spy_deck', topLevel: false }));
}

// ── SPECTER install (the hack-deck program) ──────────────────────────────────
// Access to SPECTER on the tablet is bought as a one-shot install program (an
// item tagged `specter_program`): `use` it and it flashes SPECTER onto the tablet
// (a player flag) and burns itself out. Distinct from the carried spy_deck the
// standalone hub still uses — the tablet app gates on this flag instead.
const SPECTER_FLAG = 'specter_installed';
export async function isSpecterInstalled(player) {
  const v = await getFlag('player', SPECTER_FLAG, player);
  return v === '1' || v === 1 || v === true;
}

// use <specter program> — install SPECTER onto the tablet, consuming the item.
async function doInstallSpecter(args, raw, player) {
  const nameHint = args.join(' ').trim().toLowerCase();
  const it = await resolveInventoryItem(player, { tag: 'specter_program', name: nameHint || undefined });
  if (!it) return undefined; // named something else / not carrying one — let other handlers try
  if (await isSpecterInstalled(player)) {
    return { type: 'error', message: 'SPECTER is already installed on your tablet — this program has nothing left to do.' };
  }
  if (it.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [it.inv_id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [it.inv_id]);
  await setFlag('player', SPECTER_FLAG, '1', player);
  // The install already landed (flag set, drive consumed). The client plays the
  // firmware-flasher animation (USB-insert → hackery boot/flash → SPECTER online);
  // `message` is the transcript fallback if the overlay can't render.
  return { type: 'specter_install', item: it.name,
    message: `You slot the ${it.name} into the tablet. A firmware flasher boots, tears through the tablet's signature check, and writes SPECTER to ROM. <span class="item-grant">SPECTER is now installed. Open your <b>tablet</b> → Surveillance.</span>` };
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
    const hit = await resolveInventoryItem(player, { tag: 'spy_deck', name: nameHint, topLevel: false });
    if (!hit) return undefined; // named something else — let other handlers try
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
// to open hubs. Scheduled every 5s; the scheduler idle-gates it, so it doesn't
// fire on an empty world (recording resumes on the next login) — the world is
// frozen with no players anyway, so there's nothing to capture. Running it
// unconditionally is what used to keep Neon's compute awake 24/7.
async function surveillanceTick() {
  await refreshRecordingCams();
  await pollSensors();
  await scanActiveCrimes();
  for (const playerId of hubViewers) {
    const { rows } = await query('SELECT id, handle FROM players WHERE id=$1', [playerId]);
    if (!rows.length) { hubViewers.delete(playerId); continue; }
    sendToPlayer(playerId, await buildHubPayload(rows[0], false));
  }
  for (const playerId of panelWatchers.keys()) await pushPanelFeeds(playerId);
}

schedule('5s', () => surveillanceTick().catch(e => console.error('[surveillance] hub tick error:', e.message)));

on('player.logout', ({ id }) => { hubViewers.delete(id); panelWatchers.delete(id); });

// ── Sticky-cam sidebar panels ────────────────────────────────────────────────
// The game client's custom "Sticky cams" panel pins device ids; we push a
// per-cam frame on the same 5s cadence. Reuses buildTiles so status/frame logic
// (power, jam, spoof, damage) stays in one place.
async function camCatalog(playerId) {
  const tiles = await buildTiles(playerId);
  return tiles.filter(t => CAM_KINDS.has(t.kind)).map(t => ({ id: t.id, label: t.name }));
}

async function pushPanelFeeds(playerId) {
  const want = panelWatchers.get(playerId);
  if (!want || !want.size) { panelWatchers.delete(playerId); return; }
  const tiles = await buildTiles(playerId);
  for (const t of tiles) {
    if (want.has(t.id)) sendToPlayer(playerId, { type: 'panel_feed', feed: t.id, status: t.status, frame: t.frame, label: t.name });
  }
}

on('panel.catalog', async ({ playerId }) => {
  sendToPlayer(playerId, { type: 'panel_catalog', cameras: await camCatalog(playerId) });
});

on('panel.watch', async ({ playerId, feeds }) => {
  if (!feeds || !feeds.length) { panelWatchers.delete(playerId); return; }
  panelWatchers.set(playerId, new Set(feeds));
  await pushPanelFeeds(playerId); // immediate first frame, don't wait for the tick
});

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
  // Fire-and-forget: bank evidence on any camera recording this zone. Kept off
  // the caller's path so crime handling never blocks on clip I/O.
  autoClipZone(zoneId).catch(() => {});
}
on('player.death', async ({ player }) => {
  // Getting downed clears the victim's own wanted level (death / arrest).
  if (player?.id && wantedRuntime.has(player.id)) await clearWanted(player.id, 'you were taken down');
  // …and cools the invisible heat with it — a takedown resets the slow burn too.
  if (player?.id && heatRuntime.has(player.id)) {
    heatRuntime.delete(player.id);
    await setFlag('player', 'heat', 0, player).catch(() => {});
    sendHeatHud(player.id, 0);
  }
  // Drop any live arrest prompt — being downed supersedes it.
  if (player?.id) { const ap = apprehending.get(player.id); if (ap?.timer) clearTimeout(ap.timer); apprehending.delete(player.id); }

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
  // Charging the killer is owned entirely by the crime-registry listener below
  // (raiseCrime(killer, 'murder', …) — stars + PD evidence + dispatch in one path).
});

function parseBuffer(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// Camera rolling buffer lives in memory, not Postgres (Phase 4). The old design
// rewrote the entire security_devices.recording_buffer JSON array every 5s per
// recording camera — time passing treated as a database mutation. Frames are
// lightweight text (see feedSnapshot), so the whole rolling window fits in RAM;
// the only durable artifact is a clip, which is already event-driven (cmdClip /
// auto-clip → security_clips + a datachip item). Nothing else reads the column.
const MAX_CAMERA_BUFFER = 500;       // hard ceiling regardless of storage_limit's configured value
const AUTO_CLIP_DEBOUNCE_MS = 60_000; // one auto-clip per camera per minute, so a shootout isn't a clip flood

class CameraBuffer {
  constructor(limit) {
    this.limit = Math.max(1, Math.min(limit, MAX_CAMERA_BUFFER));
    this.frames = [];
    this.zoneId = null;       // refreshed each capture — used to route auto-clips
    this.ownerId = null;      // "
    this.lastAutoClip = 0;
    this.full = false;        // true once the buffer hit its cap — stops recording until reset
  }
  push(frame) {               // frame.ts is stamped by the caller at capture time — never later,
    // Cap = stop, not roll-over: once the buffer is full it banks nothing more
    // until the operator clips or clears it through SPECTER. This preserves the
    // whole window as a fixed reel rather than silently dropping the oldest line.
    if (this.frames.length >= this.limit) { this.full = true; return; }
    // Content-diff (Phase 7a): if the room looks identical to the last banked
    // frame, don't churn the ring. An NPC entering/leaving/acting changes the
    // visible-actor text → a new frame lands whether or not a player is online,
    // so NPC-only history stays accurate; a genuinely static room banks nothing.
    // Also stops duplicate frames from eating the fixed buffer ceiling, so the
    // capped history covers more real events.
    const last = this.frames[this.frames.length - 1];
    if (last && last.text === frame.text) return;
    this.frames.push(frame);  // or a delayed clip would shift the window under the timestamps
    if (this.frames.length >= this.limit) this.full = true;
  }
  reset() { this.frames = []; this.full = false; }
}
const cameraBuffers = new Map(); // deviceId → CameraBuffer, created lazily on first line

// Zone → [{ id, ownerId }] of the 'ok' recording cameras there, refreshed each
// tick so the (frequent) zone.broadcast line-capture never touches the DB.
let recordingCamsByZone = new Map();
// The zone-message types a camera logs as a line: speech (`say`) and everything
// the room narrates (`zone_event` — arrivals, exits, emotes, actions). Ambience,
// weather, TV, system lines are deliberately excluded.
const CAM_LINE_TYPES = new Set(['say', 'zone_event']);

// The rolling per-clip line budget — a global tunable editable in the devpanel
// Crime tab (camera_buffer_lines), default 25, hard-capped at MAX_CAMERA_BUFFER.
function currentBufferLimit() {
  const v = Number(getTunable('camera_buffer_lines', 25));
  if (!Number.isFinite(v) || v < 1) return 25;
  return Math.min(Math.round(v), MAX_CAMERA_BUFFER);
}
function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }

// Refresh the zone→recording-cams index (drives the event-line capture below) and
// keep every live buffer's rolling limit in step with the devpanel tunable.
// Cameras no longer snapshot the room on a timer — they log real zone activity
// (speech, arrivals, exits, emotes, actions) as it happens, via zone.broadcast.
async function refreshRecordingCams(force = false) {
  const rows = (await allDevices(force)).filter(d => d.is_recording === 1);
  const fx = await getInterferenceZones();
  const map = new Map();
  const limit = currentBufferLimit();
  for (const d of rows) {
    if (!CAM_KINDS.has(d.device_kind)) continue;
    if (deviceStatus(d, fx) !== 'ok') continue;   // offline/jammed/spoofed → records nothing
    let arr = map.get(d.zone_id);
    if (!arr) { arr = []; map.set(d.zone_id, arr); }
    arr.push({ id: d.id, ownerId: d.owner_id });
    const buf = cameraBuffers.get(d.id);
    if (buf) {
      buf.limit = limit; buf.zoneId = d.zone_id; buf.ownerId = d.owner_id;
      // Only trim if the tunable cap was *lowered* under a live buffer (a config
      // change); normal capture never overflows because push() stops at the cap.
      while (buf.frames.length > limit) buf.frames.shift();
      if (buf.frames.length >= limit) buf.full = true;
    }
  }
  recordingCamsByZone = map;
}

// Every zone-wide message (server/index.js emits zone.broadcast for each) is a
// candidate CCTV line. Cheap: reads the in-memory cam index, never the DB, and
// only for whitelisted activity types.
function captureZoneLine(zoneId, msg) {
  if (!zoneId || !msg || !CAM_LINE_TYPES.has(msg.type)) return;
  const cams = recordingCamsByZone.get(zoneId);
  if (!cams || !cams.length) return;
  const text = stripTags(msg.message);
  if (!text) return;
  // Tag the line by kind so the microreel viewer can colour speech apart from
  // narration/emotes. `say` = spoken dialogue; everything else the room narrates
  // (arrivals, exits, emotes, actions) is an `event`.
  const kind = msg.type === 'say' ? 'say' : 'event';
  const line = { t: clock(), ts: Date.now(), text, kind };
  const limit = currentBufferLimit();
  for (const cam of cams) {
    let buf = cameraBuffers.get(cam.id);
    if (!buf) { buf = new CameraBuffer(limit); cameraBuffers.set(cam.id, buf); }
    buf.limit = limit; buf.zoneId = zoneId; buf.ownerId = cam.ownerId;
    buf.push(line);
  }
}
on('zone.broadcast', ({ zoneId, msg }) => captureZoneLine(zoneId, msg));

// Regress-only seams (nothing else calls these in production): drive a cam-index
// refresh + a synthetic zone line, and read a device's rolling buffer.
export async function __refreshRecordingCams() { return refreshRecordingCams(true); }
export function __captureZoneLine(zoneId, msg) { return captureZoneLine(zoneId, msg); }
export function __cameraFrames(deviceId) { return (cameraBuffers.get(deviceId)?.frames || []).slice(); }
export function __cameraFull(deviceId) { return !!cameraBuffers.get(deviceId)?.full; }

// A crime raised in a zone auto-banks a durable evidence record for every
// actively-recording camera watching it (Phase 4b) — a security_clips row only,
// no automatic item, so it works even if the owner is offline or has no room in
// their kit. They pull the physical datachip later with `collect`. Debounced per
// camera so a burst of crimes doesn't spawn a burst of clips.
async function autoClipZone(zoneId) {
  const now = Date.now();
  for (const [id, buf] of cameraBuffers) {
    if (buf.zoneId !== zoneId || !buf.ownerId || !buf.frames.length) continue;
    if (now - buf.lastAutoClip < AUTO_CLIP_DEBOUNCE_MS) continue;
    buf.lastAutoClip = now;
    const clip = await createSecurityClip(id, buf.frames.slice(), zoneId, buf.ownerId).catch(() => null);
    if (clip) sendToPlayer(buf.ownerId, { type: 'system', message:
      `<span class="text-red">⚠ EVIDENCE</span> — your camera banked a clip. Use "collect" to pull the datachip.` });
  }
}

// record [name] — toggle recording on a device you own (in the current zone, or by name).
async function cmdRecord(args, raw, player) {
  const nameHint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT d.id, d.is_recording, f.name, n.is_police FROM security_devices d JOIN furniture f ON f.id=d.id
             LEFT JOIN security_networks n ON n.id=d.network_id
             WHERE d.owner_id=$1`;
  if (nameHint) { sql += ` AND (d.id=$2 OR f.name ILIKE $3)`; params.push(nameHint, `%${nameHint}%`); }
  sql += ` ORDER BY f.name LIMIT 1`;
  const { rows } = await query(sql, params);
  const dev = rows[0];
  if (!dev) return { type: 'error', message: nameHint ? `You have no deployed device matching "${nameHint}".` : "You have no deployed devices to record." };
  const next = dev.is_recording ? 0 : 1;
  // Police-network invariant (Phase 4c): observation is allowed, recording is
  // not. Enforced on network authority, not device kind — holds even if some
  // future system tries to arm recording on a PD unit. Ownership gating already
  // keeps players off org devices today; this is defence in depth.
  if (next && dev.is_police) return { type: 'error', message: 'Recording capability unavailable on this network.' };
  await query('UPDATE security_devices SET is_recording=$1 WHERE id=$2', [next, dev.id]);
  invalidateDeviceCache();
  return { type: 'output', message: next
    ? `<span class="text-red">●REC</span> ${dev.name} is now recording.`
    : `Recording stopped on ${dev.name}.` };
}

// Durable evidence, step 1: persist the frames to a security_clips row and stamp
// any overlapping crimes. No item is created — that's physicalizeClip's job.
// The datachip item id is derived from the clip id, so physicalization is
// idempotent (a clip maps to exactly one datachip).
async function createSecurityClip(deviceId, frames, zoneId, ownerId) {
  const clipId = `clip_${Date.now()}_${randomUUID().slice(0, 4)}`;
  const firstTs = frames[0]?.ts || 0;
  const crimeTags = [...new Set((crimeLog.get(zoneId) || []).filter(c => c.ts >= firstTs).map(c => c.tag))];
  const capturedAt = Math.floor(Date.now() / 1000);
  await query(
    `INSERT INTO security_clips (id, device_id, zone_id, owner_id, frames, captured_at, crime_tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [clipId, deviceId, zoneId, ownerId, JSON.stringify(frames), capturedAt, JSON.stringify(crimeTags)]
  );
  return { id: clipId, device_id: deviceId, zone_id: zoneId, owner_id: ownerId, frames, captured_at: capturedAt, crime_tags: crimeTags };
}

// Durable evidence, step 2: mint the physical datachip item + inventory row for
// an existing clip. ON CONFLICT makes a second call a no-op, so collecting an
// already-collected clip can't spawn a duplicate item.
async function physicalizeClip(clipRow, player) {
  const itemId = `item_datachip_${clipRow.id}`;
  const zoneName = clipRow.zone_name || clipRow.zone_id || 'UNKNOWN';
  const crimeTags = Array.isArray(clipRow.crime_tags) ? clipRow.crime_tags : parseBuffer(clipRow.crime_tags);
  const frames = Array.isArray(clipRow.frames) ? clipRow.frames : parseBuffer(clipRow.frames);
  const evidenceTag = crimeTags.length ? ` [EVIDENCE: ${crimeTags.join(', ').toUpperCase()}]` : '';
  // A chip is a mini-cassette: it also carries a hidden scripted broadcast of its
  // footage (media_cassette + broadcast_id), so it can be `load`ed into any media
  // deck and aired on the zone's TVs — as well as replayed privately with `use`.
  const broadcastId = `bc_clip_${clipRow.id}`;
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, tags)
     VALUES ($1,$2,$3,'evidence',60,$4,$5) ON CONFLICT (id) DO NOTHING`,
    [itemId, `Datachip — ${zoneName}`,
     `A slab of black storage glass, edge-lit amber. Holds ${frames.length} frames of surveillance footage from ${zoneName}.${evidenceTag} <span class="text-dim">(use it to replay, or load it into a media deck to broadcast it.)</span>`,
     crimeTags.length ? 250 : 40,
     JSON.stringify({ datachip: true, clip_id: clipRow.id, media_cassette: true, broadcast_id: broadcastId })]
  );
  await reloadItem(itemId);
  await query(
    `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`,
    [randomUUID(), player.id, itemId]
  );
  // The chip carries a broadcast_id, but the playable broadcast is minted lazily —
  // only if/when the chip is actually loaded into a media deck (see cmdLoadCassette).
  // Most chips are only ever replayed privately or submitted as evidence and never
  // aired, so eager minting just piled up hidden broadcasts nobody watched.
  return { itemId, zoneName, frameCount: frames.length, evidenceTag };
}

// clip [name] — burn the current live buffer to a saved MICROREEL and CLEAR the
// buffer so the cam records again. The reel is minted as a physical datachip in your
// kit (folding in what `collect` does): a microreel IS the chip you hold, so it's a
// tradeable object — hand someone the chip and the reel goes with it. SPECTER →
// Microreels lists the chips you carry. (`collect` remains for auto-banked evidence
// clips a camera captured on its own, which have no chip until pulled.)
async function cmdClip(args, raw, player) {
  const nameHint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT d.id, d.zone_id, f.name, z.name AS zone_name
             FROM security_devices d JOIN furniture f ON f.id=d.id
             LEFT JOIN zones z ON z.id=d.zone_id WHERE d.owner_id=$1`;
  if (nameHint) { sql += ` AND (d.id=$2 OR f.name ILIKE $3)`; params.push(nameHint, `%${nameHint}%`); }
  sql += ` ORDER BY f.name LIMIT 1`;
  const { rows } = await query(sql, params);
  const dev = rows[0];
  if (!dev) return { type: 'error', message: nameHint ? `You have no deployed device matching "${nameHint}".` : "You have no deployed devices." };

  // Frames live only in memory now (Phase 4) — never undefined, so an empty
  // buffer falls through to the "nothing recorded" message, not a crash.
  const buf = cameraBuffers.get(dev.id);
  const frames = buf?.frames ?? [];
  if (!frames.length) return { type: 'error', message: `${dev.name} has nothing recorded. Try "record" first.` };

  const clip = await createSecurityClip(dev.id, frames.slice(), dev.zone_id, player.id);
  const frameCount = frames.length;
  const crimeTags = Array.isArray(clip.crime_tags) ? clip.crime_tags : [];
  const evidenceTag = crimeTags.length ? `[EVIDENCE: ${crimeTags.join(', ').toUpperCase()}]` : '';
  buf.reset();   // clear the tape so the camera resumes recording

  // Mint the reel's physical datachip straight into the operator's kit — the reel is
  // the chip (possession is what SPECTER → Microreels lists and what makes it tradeable).
  await physicalizeClip({ ...clip, zone_name: dev.zone_name || dev.zone_id, frames }, player);

  return { type: 'output', message: `You burn the feed to a microreel — ${frameCount} frame${frameCount === 1 ? '' : 's'} from ${dev.zone_name || dev.zone_id}.${evidenceTag ? ` <span class="text-red">${evidenceTag}</span>` : ''}\n<span class="text-dim">(a datachip drops into your kit — open SPECTER → Microreels to view it, or trade the chip to hand the reel off. The buffer is cleared — the camera is recording again.)</span>` };
}

// wipe [name] — clear a camera's live buffer WITHOUT saving a microreel, so it can
// record again. The counterpart to clip when you don't want to keep the tape.
async function cmdWipe(args, raw, player) {
  const nameHint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT d.id, f.name FROM security_devices d JOIN furniture f ON f.id=d.id
             WHERE d.owner_id=$1`;
  if (nameHint) { sql += ` AND (d.id=$2 OR f.name ILIKE $3)`; params.push(nameHint, `%${nameHint}%`); }
  sql += ` ORDER BY f.name LIMIT 1`;
  const { rows } = await query(sql, params);
  const dev = rows[0];
  if (!dev) return { type: 'error', message: nameHint ? `You have no deployed device matching "${nameHint}".` : "You have no deployed devices." };
  const buf = cameraBuffers.get(dev.id);
  const had = buf?.frames.length || 0;
  if (buf) buf.reset();
  return { type: 'output', message: had
    ? `You wipe ${dev.name}'s buffer — ${had} line${had === 1 ? '' : 's'} discarded. It's recording again.`
    : `${dev.name}'s buffer is already empty.` };
}

// collect [zone] — pull a physical datachip for an evidence clip a camera banked
// automatically (Phase 4b). Surfaces only clips that don't already have a chip.
async function cmdCollect(args, raw, player) {
  const nameHint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT c.*, z.name AS zone_name FROM security_clips c
             LEFT JOIN zones z ON z.id=c.zone_id
             LEFT JOIN items i ON i.id = 'item_datachip_' || c.id
             WHERE c.owner_id=$1 AND i.id IS NULL`;
  if (nameHint) { sql += ` AND z.name ILIKE $2`; params.push(`%${nameHint}%`); }
  sql += ` ORDER BY c.captured_at DESC LIMIT 1`;
  const { rows } = await query(sql, params);
  const clip = rows[0];
  if (!clip) return { type: 'error', message: nameHint ? `No un-collected evidence clips from "${nameHint}".` : 'No un-collected evidence clips on record.' };
  const { frameCount, zoneName, evidenceTag } = await physicalizeClip(clip, player);
  return { type: 'output', message: `You pull the banked clip to a datachip — ${frameCount} frames from ${zoneName}.${evidenceTag ? ` <span class="text-red">${evidenceTag.trim()}</span>` : ''}\n<span class="text-dim">(use the datachip to replay it.)</span>` };
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
  const chip = await resolveInventoryItem(player, { tag: 'datachip', name: nameHint || undefined, topLevel: false });
  if (!chip) return undefined; // no matching chip — fall through
  const clipId = chip.tags?.clip_id;
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
  const rows = await resolveInventoryItem(player, { tag: 'datachip', topLevel: false, orderBy: 'i.name', all: true });
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
  invalidateDeviceCache();
  await deleteFurniture(dev.id);
  cameraBuffers.delete(dev.id);    // drop any in-memory rolling buffer for the smashed device
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
  return { type: 'circuit_hack', deviceId: dev.id, deviceName: dev.name, skill,
    difficulty: await hackDifficulty(player.id, dev.hack_difficulty) };
}

// hijackresolve <deviceId> <1|0> — silent; the Circuit Breach overlay fires this.
async function cmdHijackResolve(args, raw, player) {
  const deviceId = args[0];
  const win = args[1] === '1';
  const pending = pendingHijack.get(player.id);
  pendingHijack.delete(player.id);
  if (!pending || pending.deviceId !== deviceId || Date.now() - pending.ts > 180000) return { type: 'noop' };

  const { rows } = await query(
    `SELECT d.owner_id, d.zone_id, d.hack_difficulty, f.name, z.name AS zone_name, n.is_police FROM security_devices d
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
    invalidateDeviceCache();
    await awardSkillUse(player.id, 'hacking', await breachMargin(player, dev.hack_difficulty));
    tamperPing(dev.owner_id, player.id, dev.name, dev.zone_name || dev.zone_id, 'was HIJACKED — you no longer control it.');
    // Breaching any live device is hacking (charged via the crimes registry if
    // witnessed); a PD unit also puts patrols on you regardless.
    emit('hack.success', { player, zoneId: dev.zone_id });
    if (dev.is_police) dispatchPolice(dev.zone_id, 'a systems breach', player.handle);
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
  const target = exitTargets(zone, dir)[0];
  if (!target) return { type: 'error', message: `${drone.name} can't go ${dir} — no exit that way.` };

  const chk = await skillCheck(player, 'drone_ops', 3);
  await query('UPDATE security_devices SET zone_id=$1 WHERE id=$2', [target, drone.id]);
  invalidateDeviceCache();
  await updateFurniture(drone.id, { zone_id: target });

  const originName = zone?.name || drone.zone_id;
  const destName = getZone(target)?.name || target;
  sendToZone(drone.zone_id, { type: 'ambient', message: `A small drone whirrs and lifts away to the ${dir}.` });
  sendToZone(target, { type: 'ambient', message: `A small drone buzzes in from ${originName}.` });
  // Piloting trains Drone Ops whether the link holds clean or stutters (abs margin).
  await awardSkillUse(player.id, 'drone_ops', chk.margin);

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

// The PD network id is fixed content — one row that never changes at runtime —
// but it was re-read on every evidence clip, which is once per witnessed crime
// per tick. Resolve it once and hold it.
let _policeNetId;
async function policeNetworkId() {
  if (_policeNetId !== undefined) return _policeNetId;
  const { rows } = await query(`SELECT id FROM security_networks WHERE is_police=1 LIMIT 1`)
    .catch(() => ({ rows: [] }));
  // Only latch a real answer. If the row isn't there yet (fresh DB mid-seed),
  // stay unresolved and look again next time rather than caching "no PD" forever.
  if (rows[0]?.id) _policeNetId = rows[0].id;
  return rows[0]?.id || null;
}

async function logPoliceEvidence(zoneId, tags, suspect) {
  const zoneName = getZone(zoneId)?.name || zoneId;
  const net = await policeNetworkId();
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

// Arrival time scales with heat: petty stars get a lazy response, a full manhunt
// is on you fast. Time from the start of a pursuit to the first units deploying.
function responseDelayMs(stars) {
  if (stars >= 5) return 10000;
  if (stars >= 4) return 15000;
  if (stars >= 3) return 20000;
  if (stars >= 2) return 45000;
  if (stars >= 1) return 90000;
  return 180000;   // half-star heat — they'll get to it eventually
}

// Chance, per pursuit step, that a searching hunter wanders to a random adjacent
// zone instead of stepping toward the suspect — the "little random" in the hunt.
const HUNT_RANDOM = 0.35;

// Hunter behaviour: only engages when `searchAndPursue` has physically caught the
// suspect in the same zone and set targetId. The search movement itself (heading
// to the crime scene, then hunting toward the suspect with some randomness) is
// driven server-side in searchAndPursue, not by the graph — so an idle hunter
// just loops here until it finds its quarry.
const WANTED_HUNTER_GRAPH = {
  _start: 'check_target',
  nodes: {
    check_target: { type: 'condition', condition_type: 'HAS_TARGET', params: {}, ifTrue: 'check_cried', ifFalse: 'loop' },
    check_cried:  { type: 'condition', condition_type: 'FLAG_SET', params: { flag: 'cried', scope: 'self' }, ifTrue: 'attack', ifFalse: 'cry' },
    cry:          { type: 'action', action_type: 'SAY', params: { message: 'SPECTER-PD — STOP RESISTING. COMPLY.' }, next: 'set_cried' },
    set_cried:    { type: 'action', action_type: 'SET_FLAG', params: { flag: 'cried', scope: 'self', value: 'true' }, next: 'attack' },
    attack:       { type: 'action', action_type: 'ATTACK', params: {}, next: 'loop' },
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
  if (!s) { s = { stars: 0, maxStars: 0, lastCrimeTs: 0, lastSeenTs: 0, pursuitStartTs: 0, crimeZone: null, hunters: new Set(), deployedTier: 0, charges: [] }; wantedRuntime.set(id, s); }
  return s;
}

// Half-star aware: 2.5 → ★★½☆☆. Fractional heat (e.g. a single on-camera drug
// hit at 0.5) shows a lone half star.
function starBar(n) {
  const full = Math.floor(n);
  const half = (n - full) >= 0.5;
  const empty = Math.max(0, MAX_STARS - full - (half ? 1 : 0));
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}
function sendWantedHud(playerId, stars) { sendToPlayer(playerId, { type: 'wanted_level', stars }); }

function despawnHunters(s) {
  for (const iid of s.hunters) removeEnemyInstance(iid);
  s.hunters.clear();
}

// A crime counts if a LENS or a BADGE is watching: a live (un-jammed) camera, or an
// on-scene `flags.police` NPC. Bystanders were dropped — another player in the room
// is not a witness the law hears from.
export async function isWitnessed(zoneId) {
  if (!zoneId) return false;
  if (getZone(zoneId)?.flags?.unsurveilled) return false;   // off the Architect's grid (Long Watch bunker &c.) — no eyes reach here
  if (copInZone(zoneId)) return true;
  const fx = await getInterferenceZones();
  if (fx.jammed.has(zoneId)) return false;
  return await cameraLiveInZone(zoneId);
}

async function raiseWanted(player, amount, reason, zoneId) {
  if (!player?.id || !player.handle) return;    // players only
  const s = wantedState(player.id);
  const prev = s.stars;
  s.stars = Math.min(MAX_STARS, s.stars + amount);
  s.maxStars = Math.max(s.maxStars || 0, s.stars);   // peak heat this spree — the charge you'll book on
  s.lastCrimeTs = Date.now();
  s.lastSeenTs = Date.now();
  s.crimeZone = zoneId || player.current_zone || s.crimeZone;   // muster point = latest crime scene
  if (prev <= 0) s.pursuitStartTs = Date.now();                 // fresh manhunt — start the arrival clock
  // Rap sheet — the distinct reasons behind this heat, for the arrest booking
  // record (read via the WANTED_CHARGES action). Newest last, capped at 6.
  if (reason && !s.charges.includes(reason)) {
    s.charges.push(reason);
    if (s.charges.length > 6) s.charges.shift();
  }
  await setFlag('player', 'wanted', s.stars, player);
  if (s.stars !== prev) {
    sendToPlayer(player.id, { type: 'system', message: `<span class="text-red">⚠ WANTED ${starBar(s.stars)}</span> — ${reason}.` });
    sendWantedHud(player.id, s.stars);
  }
}

// Cross-plugin seam: let another system (e.g. jail, on a jailbreak) put heat on a
// player without importing surveillance internals. See docs/scripting.md actions.
registerAction({
  type: 'WANTED_RAISE',
  handler: async ({ actor, params }) => {
    await raiseWanted(actor, params?.amount ?? 1, params?.reason || 'a crime');
    return { type: 'wanted', stars: wantedState(actor.id).stars };
  },
});

// Cross-plugin seam: read the suspect's current rap sheet (the reasons behind
// their heat) without importing surveillance internals. Jail reads this on
// booking to print the charge on the arrest record. Returns a copy of the
// accumulated reason list (empty if no active heat).
registerAction({
  type: 'WANTED_CHARGES',
  handler: ({ actor }) => {
    const s = wantedRuntime.get(actor?.id);
    return { type: 'charges', charges: s ? [...s.charges] : [] };
  },
});

// Cross-plugin seam: charge a specific crime key on a suspect with a forced
// witness (the caller already knows they were caught — e.g. a fumbled palm during
// a search). Runs the full raiseCrime path: stars + heat + evidence + siren.
registerAction({
  type: 'CHARGE_CRIME',
  handler: async ({ actor, params }) => {
    if (actor?.id && params?.key) await raiseCrime(actor, params.key, params.zoneId || actor.current_zone, actor.handle, true);
    return { type: 'charged', key: params?.key || null };
  },
});

// Cross-plugin seam: read the PEAK wanted level reached this spree (not the
// possibly-decayed current one). Jail books the arrest on this — decay 5★ → ½★
// and you're still charged for the 5★ you earned. Falls back to current stars.
registerAction({
  type: 'WANTED_PEAK',
  handler: ({ actor }) => {
    const s = wantedRuntime.get(actor?.id);
    return { type: 'peak', peak: s ? Math.max(s.maxStars || 0, s.stars) : 0 };
  },
});

// Cross-plugin seam: read the CURRENT (decayed) wanted level — used by the flight plugin so
// ground AA only opens up on wanted pilots (criminals), not law-abiding overflights.
// Everyone currently carrying stars, for the Sentinel's police blotter.
//
// Reads the in-memory wanted runtime — there is no warrants TABLE, because a
// warrant is live state that decays, and persisting it would mean writing on
// every crime tick. That also makes this free: no query, just a walk of a Map
// that is already in RAM, which is why a newspaper section can afford to call it.
//
// Handles only, and only for players actually online — a blotter is what the
// street knows, not a database dump.
registerAction({
  type: 'WANTED_LIST',
  handler: () => {
    const out = [];
    for (const [id, s] of wantedRuntime) {
      if (!s?.stars) continue;
      const p = getLivePlayer(id);
      if (!p) continue;
      out.push({
        handle: p.handle,
        stars: s.stars,
        charges: [...new Set(s.charges || [])].slice(0, 3),
      });
    }
    out.sort((a, b) => b.stars - a.stars || a.handle.localeCompare(b.handle));
    return { type: 'wanted_list', wanted: out };
  },
});

registerAction({
  type: 'WANTED_STARS',
  handler: ({ actor }) => ({ type: 'wanted', stars: wantedRuntime.get(actor?.id)?.stars || 0 }),
});

// ── Invisible heat (0–100) — the slow burn of being *noticed* ─────────────────
// A second, quieter layer beside the acute stars. Every witnessed crime nudges
// heat up; it bleeds off slowly while you lay low. Below the HUD threshold it's
// invisible (the flame stays dark) — heat builds before you're ever "wanted".
// Crossing 100 flares the burn into a real manhunt (min 3★) and spends back to 0.
// Persisted per-player in the `heat` flag; pushed to the HUD as `heat_level`.
// Lives in its OWN map, not wantedRuntime, which is deleted the moment stars hit 0.
const HEAT_MAX = 100;
const HEAT_IGNITE_STARS = 3;        // heat 100 → at least this many acute stars
const HEAT_PER_STAR = 8;            // heat added per wanted-star of a witnessed crime
const HEAT_DECAY_PER_TICK = 0.35;   // bleed per 6s tick (~30 min from 100 → cold)
const heatRuntime = new Map();      // playerId -> { heat }

function heatState(id) {
  let s = heatRuntime.get(id);
  if (!s) { s = { heat: 0 }; heatRuntime.set(id, s); }
  return s;
}
function sendHeatHud(playerId, heat) { sendToPlayer(playerId, { type: 'heat_level', heat }); }

// Crossing 100 dumps the invisible burn into a visible manhunt: raise to at least
// 3★ (SPECTER-PD acts on the pattern — which auto-deploys hunters) and spend the
// heat back to zero.
async function igniteHeat(player) {
  const s = heatState(player.id);
  s.heat = 0;
  await setFlag('player', 'heat', 0, player);
  sendHeatHud(player.id, 0);
  sendToPlayer(player.id, { type: 'system', message: `<span class="text-red">⚠ THEY'RE ONTO YOU</span> — SPECTER-PD flags a pattern. You're a person of interest now.` });
  const cur = wantedState(player.id).stars;
  if (cur < HEAT_IGNITE_STARS) await raiseWanted(player, HEAT_IGNITE_STARS - cur, 'a pattern of activity flagged by SPECTER-PD');
}

async function addHeat(player, amount, reason) {
  if (!player?.id || !player.handle || !(amount > 0)) return;
  const s = heatState(player.id);
  const prev = Math.round(s.heat);
  s.heat = Math.min(HEAT_MAX, s.heat + amount);
  const now = Math.round(s.heat);
  if (now !== prev) {
    await setFlag('player', 'heat', now, player);
    sendHeatHud(player.id, now);
  }
  if (s.heat >= HEAT_MAX) await igniteHeat(player);
}

// Cross-plugin seam: reagent buys, checkpoints, and other "suspicious but not yet
// chargeable" acts nudge heat without importing surveillance internals.
registerAction({
  type: 'HEAT_RAISE',
  handler: async ({ actor, params }) => {
    await addHeat(actor, Number(params?.amount) || 0, params?.reason || 'suspicious activity');
    return { type: 'heat', heat: Math.round(heatState(actor?.id)?.heat || 0) };
  },
});

// ── "Being watched" cues ──────────────────────────────────────────────────────
// The heat number is invisible by design — so it has to be *felt*. Above a floor,
// each heat tick may whisper a private, atmospheric tell whose menace and cadence
// climb with the burn: a prickle on the neck when you're warm, a drone at head
// height when you're about to boil over. Only you feel it; it charges nothing.
const CUE_MIN_HEAT = 25;   // below this you're cold enough that nothing stirs
const WATCHED_CUES = {
  faint: [   // 25–49: could be nerves, could be nothing
    'The hair on the back of your neck lifts. Nothing there when you turn.',
    'A camera lens somewhere whirs, tracking something. Maybe not you.',
    'You catch your own reflection twice in one block of glass.',
    'A patrol drone tone dopplers past, high overhead, and fades.',
    'For a second it feels like the street got quieter around you.',
  ],
  watched: [ // 50–79: you're sure of it now
    'Across the way, a figure looks away a half-second too late.',
    'A comms speaker crackles in your direction, then goes dead.',
    'Two cams pan to follow you down the block. You clock it this time.',
    "Someone's been leaning on that wall the whole time you've been here.",
    'A parked drone swivels its eye to you and just... watches.',
  ],
  closing: [ // 80–99: the net is drawing tight
    'A drone drops to head height, red eye steady on you, and holds.',
    'Boots scuff to a stop just out of sight. Waiting.',
    "A dispatch voice, tinny and close: '…got eyes on the subject…'",
    'Every lens on the block has found you. The air pulls tight.',
    'Somewhere near, a lock disengages. Then another. They know where you are.',
  ],
};
function cueBand(heat) { return heat >= 80 ? 'closing' : heat >= 50 ? 'watched' : 'faint'; }
// Mean gap between cues shrinks as heat climbs: ~90s when barely warm, ~16s at a boil.
function cueIntervalMs(heat) {
  const t = Math.min(1, Math.max(0, (heat - CUE_MIN_HEAT) / (HEAT_MAX - CUE_MIN_HEAT)));
  return (90 - 74 * t) * 1000;
}
function maybeWatchedCue(pid, s) {
  if (s.heat < CUE_MIN_HEAT) return;
  const now = Date.now();
  const due = cueIntervalMs(s.heat) * (0.6 + Math.random() * 0.8);   // jitter so it never feels metronomic
  if (now - (s.lastCueTs || 0) < due) return;
  s.lastCueTs = now;
  const pool = WATCHED_CUES[cueBand(s.heat)];
  const msg = pool[Math.floor(Math.random() * pool.length)];
  sendToPlayer(pid, { type: 'ambient', message: `<span class="text-dim">${msg}</span>` });
}

// Slow bleed while laying low. Independent of stars — you can carry heat with a
// clean acute record (that's the point: it builds before you're ever "wanted").
async function heatTick() {
  for (const [pid, s] of [...heatRuntime]) {
    if (s.heat <= 0) { heatRuntime.delete(pid); continue; }
    const p = getLivePlayer(pid);
    if (!p) continue;   // offline: freeze heat (the flag holds it) until they return
    maybeWatchedCue(pid, s);
    const before = Math.round(s.heat);
    s.heat = Math.max(0, s.heat - HEAT_DECAY_PER_TICK);
    const now = Math.round(s.heat);
    // Decay is RAM-only; the flag is written on raise, on zero, and at logout.
    // A crash restores the last raised value — slightly high, never laundered.
    if (now !== before) sendHeatHud(pid, now);
    if (s.heat <= 0) { heatRuntime.delete(pid); await setFlag('player', 'heat', 0, p); }
  }
}
schedule('6s', () => heatTick().catch(e => console.error('[surveillance] heat tick error:', e.message)));

// ── Apprehend engine (≤3.5★: non-lethal arrest, not a brawl) ──────────────────
// When a hunting unit catches up to a suspect whose heat is petty-to-serious but
// not a full manhunt, it doesn't open fire — it moves in to detain. The suspect
// gets a reflex-scaled window (5s at max Reflexes → 1s at min) to submit or bolt:
//   • submit / timeout → the jail plugin books them straight into Precinct 9.
//   • run             → +2★ (which, if it tips them to 4★, flips the same units to
//                        attack-on-sight next tick) and the pursuit rolls on.
// At ≥4★ the units still attack outright (handled in searchAndPursue, unchanged).
const APPREHEND_MAX = 3.5;            // at or under this, they detain rather than kill
const APPREHEND_COOLDOWN_MS = 8000;  // grace after a break-away before they can re-grab
const apprehending = new Map();       // suspectId -> { untilTs, officer, timer }

// Reflexes 0 → 1s to react, 10 → 5s. Quick hands buy you a real chance to run.
function reflexWindowMs(reflex) {
  const r = Math.max(0, Math.min(10, Number(reflex) || 0));
  return Math.round(1000 + 400 * r);
}

async function startApprehension(suspect, s, officer) {
  const now = Date.now();
  const ap = apprehending.get(suspect.id);
  if (ap && now < ap.untilTs) return;                                       // a prompt is already live
  if (s.apprehendCooldownUntil && now < s.apprehendCooldownUntil) return;   // just broke free — let them move
  const windowMs = reflexWindowMs(suspect.stat_reflexes);
  const graceMs = windowMs + 900;   // server safety net, fires just after the client auto-submits
  const timer = setTimeout(() => resolveApprehension(suspect.id, 'submit').catch(() => {}), graceMs);
  apprehending.set(suspect.id, { untilTs: now + graceMs, officer: officer.name, timer });
  sendToPlayer(suspect.id, { type: 'apprehend_prompt', officer: officer.name, seconds: Math.round(windowMs / 100) / 10, stars: s.stars });
  sendToZone(suspect.current_zone, { type: 'ambient', message: `${officer.name} moves in on ${suspect.handle}, cuffs out. "Hands where I can see them."` });
}

async function resolveApprehension(suspectId, choice) {
  const ap = apprehending.get(suspectId);
  if (!ap) return;                    // already resolved (idempotent — client + server timer race safely)
  apprehending.delete(suspectId);
  if (ap.timer) clearTimeout(ap.timer);
  const suspect = getLivePlayer(suspectId);
  if (!suspect) return;
  const s = wantedState(suspectId);
  if (choice === 'run') {
    s.apprehendCooldownUntil = Date.now() + APPREHEND_COOLDOWN_MS;
    sendToPlayer(suspectId, { type: 'system', message: `<span class="text-red">You wrench free and bolt — boots pounding after you.</span>` });
    await raiseWanted(suspect, 2, 'fleeing a lawful detainment', suspect.current_zone);
  } else {
    // Suppress any re-prompt while booking runs (the palm minigame can take a few
    // seconds; a teleport to the cell ends co-location right after).
    s.apprehendCooldownUntil = Date.now() + 30000;
    sendToPlayer(suspectId, { type: 'system', message: `<span class="text-dim">You raise your hands. The cuffs go on.</span>` });
    await dispatchAction({ type: 'ARREST', actor: suspect });
  }
}

// apprehendresolve <run|submit> — silent; the client apprehend modal fires this.
async function cmdApprehendResolve(args, raw, player) {
  const choice = (args[0] || '').toLowerCase() === 'run' ? 'run' : 'submit';
  await resolveApprehension(player.id, choice);
  return { type: 'noop' };
}

// Cross-plugin seam: the jail plugin clears a suspect's heat when it books them via
// a live (non-death) arrest — no player.death fires to do it. Zeroes stars AND heat.
registerAction({
  type: 'WANTED_CLEAR',
  handler: async ({ actor }) => {
    if (actor?.id) {
      await setStars(actor, 0);
      if (heatRuntime.has(actor.id)) {
        heatRuntime.delete(actor.id);
        await setFlag('player', 'heat', 0, actor).catch(() => {});
        sendHeatHud(actor.id, 0);
      }
      const ap = apprehending.get(actor.id);
      if (ap?.timer) clearTimeout(ap.timer);
      apprehending.delete(actor.id);
    }
    return { type: 'cleared' };
  },
});

// Cross-plugin seam: a checkpoint (smuggle funnel / govgate) that catches you
// routes the bust through the SAME arrest as a street cop — a submit/run prompt,
// then a booking. Fires regardless of the run-cooldown (the guard has you now).
registerAction({
  type: 'APPREHEND',
  handler: async ({ actor, params }) => {
    if (!actor?.id) return { type: 'apprehend', started: false };
    if (isAirborne(actor)) return { type: 'apprehend', started: false };   // can't be detained mid-flight
    const s = wantedState(actor.id);
    s.apprehendCooldownUntil = 0;
    await startApprehension(actor, s, { name: params?.officer || 'A checkpoint officer' });
    return { type: 'apprehend', started: true };
  },
});

// ── Crime → wanted routing ────────────────────────────────────────────────────
// The data-driven path: a crime key (from crimes.js / the dev-panel `crimes`
// table) is charged here — witness-gated, debounced, and (if a camera is live)
// flashed to the whole room. Called from the combat/drug event listeners below.

// Per-(player, crime) debounce so repeated swings of one ongoing act don't
// ratchet stars every tick; a fresh act after the window re-charges.
const recentCrime = new Map();
const CRIME_DEBOUNCE_MS = 12000;

// Is a live (powered, un-jammed) camera watching this zone right now? (Police or
// player-owned — any lens counts for the red-flash callout.)
async function cameraLiveInZone(zoneId) {
  if (!zoneId) return false;
  // Was one SELECT per occupied zone per tick; now a filter over the snapshot.
  const rows = (await allDevices()).filter(d =>
    d.zone_id === zoneId && CAM_KINDS.has(d.device_kind) && d.is_damaged === 0);
  if (!rows.length) return false;
  const fx = await getInterferenceZones();
  if (fx.jammed.has(zoneId)) return false;
  return rows.some(d => devicePowered(d));
}

// A camera catching a crime lights up red and calls the suspect out to everyone
// in the room.
function flashCamera(zoneId, suspectName, crimeLabel) {
  sendToZone(zoneId, {
    type: 'zone_event',
    message: `<span class="camera-alert">⚠ A surveillance camera swivels, its lens flaring red — locking focus on ${suspectName}.</span>`,
  });
  sendToZone(zoneId, { type: 'camera_flash', suspect: suspectName, crime: crimeLabel });
}

// A COP catching a crime is a different beast entirely — no lens, no red flare, just
// an officer who was standing there and saw it. Same red callout line for the room,
// named to the officer; the full-screen camera flash is deliberately NOT sent (the
// client treats that overlay as "a camera made you", and this wasn't one).
const COP_SPOT_LINES = [
  (o, s) => `${o} stops mid-step, eyes fixed on ${s}. "Hey. HEY." A hand goes to the shoulder mic.`,
  (o, s) => `${o} saw the whole thing. No camera needed — just a cop and a bad sense of timing on ${s}'s part.`,
  (o, s) => `${o} watches ${s} do it, unhurried, and starts reciting into the mic like they're reading a shopping list.`,
  (o, s) => `${o}'s head comes round. ${s} is looking straight down the barrel of an eyewitness with a badge.`,
];
function flashCop(zoneId, officerName, suspectName) {
  const line = COP_SPOT_LINES[Math.floor(Math.random() * COP_SPOT_LINES.length)](officerName, suspectName);
  sendToZone(zoneId, { type: 'zone_event', message: `<span class="camera-alert">⚠ ${line}</span>` });
}

// A soft, low-level "something's wrong nearby" cue — a faint red pulse plus a
// short siren chirp, distinct from the full-screen camera flash (which only
// fires when a camera catches the suspect) and the ESP lockdown siren (which
// loops continuously). Pitch cycles ~6x faster than the tornado/ESP siren
// (0.6Hz vibrato vs its 0.1Hz) so the two are never mistaken for each other.
// General case (no PD camera involved, e.g. an ATM breach caught by nobody's lens).
const SFX_CRIME_ALERT = {
  id: 'sfx_crime_alert', name: 'sfx_crime_alert', category: 'sfx', priority: 6,
  config: {
    duration: 1.6,
    layers: [
      { waveform: 'sine', freq: 700, vibrato: { rate: 0.6, depth: 380 },
        filter: { type: 'lowpass', freq: 2600, q: 0.7 },
        adsr: { a: 0.12, d: 0.1, s: 0.75, r: 0.5 }, gain: 0.34 },
    ],
  },
};

// PD-network camera specifically caught it — same soft red pulse, but a
// crisper square-wave "dispatch ping" instead of the sine wail above, so
// players can tell an eye-in-the-sky spotted them apart from any other route
// into the crime system (ATM breach, drug use, etc).
const SFX_PD_ALERT = {
  id: 'sfx_pd_alert', name: 'sfx_pd_alert', category: 'sfx', priority: 6,
  config: {
    duration: 1.2,
    layers: [
      { waveform: 'square', freq: 900, vibrato: { rate: 0.9, depth: 260 },
        filter: { type: 'lowpass', freq: 3200, q: 0.9 },
        adsr: { a: 0.08, d: 0.08, s: 0.7, r: 0.4 }, gain: 0.26 },
    ],
  },
};

function crimeAlert(zoneId, def = SFX_CRIME_ALERT, { silent = false } = {}) {
  sendToZone(zoneId, { type: 'crime_alert' });
  if (!silent) sendToZone(zoneId, { type: 'audio_sfx', def, gain: 0.55 });
}

// `forced` short-circuits the witness gate: the caller already knows a specific
// witness saw it (e.g. a vendor catching you cracking their own safe) that the
// generic isWitnessed() sweep — cameras / cops / other players — wouldn't count.
// ── Crime log (dev Emergency panel feed) ──────────────────────────────────────
// Active rows are one-per-witnessed-crime; the panel polls them live. When a
// suspect's wanted level clears (arrest / death / bribe / scrub / decay), all of
// their active rows flush to history with the outcome noted.
let _crimeSeq = 0;
const crimeBoard = [];       // active: [{ id, playerId, perpetrator, zoneId, zone, crimeKey, crime, wanted, ts }]
const crimeHistory = [];   // newest-first; same shape + { clearedTs, outcome }
const CRIME_HISTORY_MAX = 100;

function logActiveCrime(player, key, zoneId, label) {
  crimeBoard.push({
    id: ++_crimeSeq,
    playerId: player.id,
    perpetrator: player.handle,
    zoneId,
    zone: getZone(zoneId)?.name || zoneId || 'unknown',
    crimeKey: key,
    crime: label,
    wanted: wantedState(player.id).stars,   // heat right after this crime charged
    ts: Date.now(),
  });
}

// Move all of a suspect's active crimes to history. Called from every wanted-clear
// path so a cleared perpetrator's rap sheet leaves the live board.
function flushCrimesToHistory(playerId, outcome) {
  const now = Date.now();
  for (let i = crimeBoard.length - 1; i >= 0; i--) {
    if (crimeBoard[i].playerId !== playerId) continue;
    crimeHistory.unshift({ ...crimeBoard[i], clearedTs: now, outcome: outcome || 'cleared' });
    crimeBoard.splice(i, 1);
  }
  if (crimeHistory.length > CRIME_HISTORY_MAX) crimeHistory.length = CRIME_HISTORY_MAX;
}

async function raiseCrime(player, key, zoneId, suspectName, forced = false) {
  if (!player?.id || !player.handle) return;
  // No law in the wastes: a zone outside city limits (flags.lawless) has no police
  // apparatus, so a witness report there does nothing — no crime is ever charged,
  // even a forced one. Only the policed city core raises stars.
  if (getZone(zoneId)?.flags?.lawless) return;
  if (!isCrimeEnabled(key)) return; // admin switched this crime off in the Crime panel
  const stars = getCrimeStars(key);
  if (!stars) return;

  const onCamera = await cameraLiveInZone(zoneId);
  const pdCamera = (await getPoliceCamZones()).has(zoneId);
  const cop = copInZone(zoneId);
  const witness = getCrimeWitness(key);
  // Nobody catches a crime with certainty anymore: a camera rolls a (flat, for a
  // one-shot act) catch chance and an on-scene cop is very likely to make you.
  // `forced` still short-circuits. Truthy result is the witness SOURCE ('camera' /
  // 'cop' / 'always'), which picks the callout below.
  const seen = forced ? true : await witnessRoll(zoneId, witness, onCamera, CAM_CATCH_BASE);
  if (!seen) return;

  const dkey = `${player.id}:${key}`;
  const now = Date.now();
  if (now - (recentCrime.get(dkey) || 0) < CRIME_DEBOUNCE_MS) return;
  recentCrime.set(dkey, now);

  const label = getCrimeLabel(key);
  // Single-sourced witness gate: gossip listens here rather than re-deriving it.
  emit('crime.witnessed', { player: { id: player.id, handle: player.handle }, key, zoneId, label });
  // Who made you decides what the room sees. A cop's eyeball gets the officer named
  // (no lens flare, no full-screen flash); otherwise the camera callout stands. A
  // `forced` charge with no live camera and a cop on scene is the cop's collar too —
  // that's the ongoing-crime scan and the guaranteed-witness paths (a witnessed
  // attack, a vendor catching you at their safe).
  const byCop = seen === 'cop' || (!onCamera && !!cop);
  if (byCop) flashCop(zoneId, cop?.name || 'An officer', suspectName || player.handle);
  else if (onCamera) flashCamera(zoneId, suspectName || player.handle, label);
  logCrime(zoneId, key);
  await raiseWanted(player, stars, label.toLowerCase(), zoneId);
  await addHeat(player, stars * HEAT_PER_STAR, `${label.toLowerCase()} on the wire`);
  logActiveCrime(player, key, zoneId, label);
  await logPoliceEvidence(zoneId, [key], player.handle);
  if (stars >= 1) {  // no sirens over a half-star puff
    // ATM robbery is witness:'always', so this fires on every single drain —
    // right on top of the ATM's own drain sfx. That reads as a broken echo
    // (quiet drain clatter, then ~1s later a loud siren) rather than a layered
    // effect, so skip just the tone; the visual alert + wanted stars still fire.
    // A cop's collar gets the same crisp dispatch ping a PD camera does — it went
    // straight onto the police net either way.
    crimeAlert(zoneId, (pdCamera || byCop) ? SFX_PD_ALERT : SFX_CRIME_ALERT, { silent: key === 'atm_robbery' });
    dispatchPolice(zoneId, label, player.handle);
  }
}

// Combat (weapon plugin) and drug (engine) fire these; we charge the matching
// crime. Witness-gating + debounce live in raiseCrime.
// Attacks are special: raising a hand where ANY witness can see it (a live PD cam,
// an on-scene cop, or a bystander player) is an immediate, guaranteed 4-star crime —
// not the probabilistic camera roll the other crimes run. `isWitnessed` is the
// deterministic gate, and we force the charge past raiseCrime's own roll. Off-camera,
// unseen violence still slips; and the lawless-zone gate inside raiseCrime means none
// of this fires outside city limits.
on('player.attacked', async ({ attacker }) => {
  if (attacker?.id && await isWitnessed(attacker.current_zone))
    raiseCrime(attacker, 'attack_player', attacker.current_zone, attacker.handle, true);
});
on('npc.attacked', async ({ actor }) => {
  if (actor?.id && await isWitnessed(actor.current_zone))
    raiseCrime(actor, 'attack_npc', actor.current_zone, actor.handle, true);
});
on('npc.killed', ({ actor, npc }) => {
  if (actor?.id && npc?.flags?.police) raiseCrime(actor, 'kill_police', actor.current_zone, actor.handle);
});
// Handing a controlled substance to another person is dealing. A live camera
// might catch it (small chance) and a bystander might phone it in (lower, but
// never zero) — raiseCrime's witness roll for the `any`-witnessed drug_dealing
// crime models exactly that. Legal drugs (coffee/beer, drugs.flags.legal) and
// non-drug items pass unremarked. The giver (the dealer) wears the charge.
on('item.given', async ({ actor, item }) => {
  if (!actor?.id || !item?.item_id) return;
  const { rows } = await query('SELECT flags FROM drugs WHERE item_id=$1 LIMIT 1', [item.item_id]).catch(() => ({ rows: [] }));
  const d = rows[0];
  if (!d || d.flags?.legal) return;   // not a drug, or a legal one — no heat
  raiseCrime(actor, 'drug_dealing', actor.current_zone, actor.handle);
});
on('player.drugUsed', ({ player, illegal, zoneId }) => {
  if (player?.id && illegal) raiseCrime(player, 'drug_use', zoneId || player.current_zone, player.handle);
});
// Public intoxication: not the ACT of using (that's drug_use, camera-only above)
// but the STATE — walking the street obviously off your head. Anyone can phone it
// in, so it's witness 'any'. Throttled per player: staying out there wrecked is one
// offence, not one per step, or a long high would paper the city in stars.
const PUBLIC_INTOX_COOLDOWN = 5 * 60 * 1000;
const lastIntoxSeen = new Map();
on('zone.entered', ({ actor: player, zone }) => {
  if (!player?.id) return;
  const seen = visibleIntoxication(player);
  if (!seen?.illegal) return;
  const now = Date.now();
  if (now - (lastIntoxSeen.get(player.id) || 0) < PUBLIC_INTOX_COOLDOWN) return;
  lastIntoxSeen.set(player.id, now);
  raiseCrime(player, 'public_intoxication', zone || player.current_zone, player.handle);
});
on('player.logout', ({ id }) => lastIntoxSeen.delete(id));
on('hack.success', ({ player, zoneId }) => {
  if (player?.id) raiseCrime(player, 'hacking', zoneId || player.current_zone, player.handle);
});
on('atm.drained', ({ player, zoneId }) => {
  if (player?.id) raiseCrime(player, 'atm_robbery', zoneId || player.current_zone, player.handle);
});
on('theft.caught', ({ player, zoneId }) => {
  if (player?.id) raiseCrime(player, 'theft', zoneId || player.current_zone, player.handle);
});
// Commerce fires this when you carry unpaid shop stock out the door. Charged at
// the SHOP's zone, not the street you stepped onto — the clerk and the shop's
// camera are the witnesses, and the normal 'any' roll decides if they made you.
on('shoplifting.caught', ({ player, zoneId }) => {
  if (player?.id) raiseCrime(player, 'shoplifting', zoneId || player.current_zone, player.handle);
});
on('hololock.breached', ({ player, zoneId }) => {
  // Breaching a lock is only a burglary charge here if a camera/cop/bystander
  // witnesses it (the generic 'any' gate). A resident NPC who hears you no
  // longer auto-charges on breach — the burglary plugin gates that on the NPC
  // surviving their panic cop-call or fleeing, and reports it separately below.
  if (player?.id) raiseCrime(player, 'burglary', zoneId || player.current_zone, player.handle);
});
// The burglary alarm plugin fires this once a resident NPC has actually raised
// the alarm (survived their cop-call, or fled the unit) — a guaranteed witness.
on('burglary.reported', ({ player, zoneId }) => {
  if (player?.id) raiseCrime(player, 'burglary', zoneId || player.current_zone, player.handle, true);
});
// A vendor catching you cracking their safe is a guaranteed witness — charge
// hacking even when no camera/cop/bystander is present (forced witness).
on('vendor.safeHackWitnessed', ({ player, zoneId }) => {
  if (player?.id) raiseCrime(player, 'hacking', zoneId || player.current_zone, player.handle, true);
});
// Hired shop staff (plugins/storefront) who see you lift stock or work the vault
// are the same guaranteed witness a present vendor is — that deterrent IS what the
// wage buys. `crime` names which charge; anything unrecognised falls back to theft
// rather than silently charging nothing.
on('storefront.staffWitnessed', ({ player, zoneId, crime }) => {
  if (!player?.id) return;
  const key = ['shoplifting', 'hacking', 'burglary'].includes(crime) ? crime : 'theft';
  raiseCrime(player, key, zoneId || player.current_zone, player.handle, true);
});
on('player.death', ({ killer }) => {
  if (killer?.id && killer?.handle) raiseCrime(killer, 'murder', killer.current_zone, killer.handle);
});
// Relieving yourself anywhere but a toilet (bodily plugin) — indecent exposure.
on('bodily.publicRelief', ({ player, zoneId }) => {
  if (player?.id) raiseCrime(player, 'indecent_exposure', zoneId || player.current_zone, player.handle);
});
// A MIS act outside a private room (mis plugin) — the same charge. The mis plugin
// decides what counts as private; everything after that is the ordinary witness
// roll, so a lawless zone and an empty street still cost you nothing.
on('mis.publicAct', ({ player, zoneId }) => {
  if (player?.id) raiseCrime(player, 'indecent_exposure', zoneId || player.current_zone, player.handle);
});
// Bulk drug-making chemical buys are a quiet tell — SPECTER-PD data-mines the
// vendor ledgers. NOT a witnessed crime (the reagents are dual-use, sold openly),
// just invisible heat that stacks as you stockpile and bleeds off if you don't.
// One-off industrial buys stay well under the HUD threshold; a hoarding run climbs.
const REAGENT_HEAT_PER_UNIT = 3;
on('vendor.purchase', ({ player, tags, quantity }) => {
  if (!player?.id || !tags?.reagent) return;
  const p = getLivePlayer(player.id);
  if (p) addHeat(p, REAGENT_HEAT_PER_UNIT * (quantity || 1), 'a bulk chemical purchase');
});

// ── Time-variable camera detection (ongoing crimes) ──────────────────────────
// A camera doesn't make you the instant a crime starts. While an offence is
// actively being committed — jacked into an ATM, or standing naked under a PD
// lens — each 5s scan rolls a catch chance that ramps from CAM_CATCH_BASE toward
// CAM_CATCH_MAX the longer it drags on. Quick jobs can slip past a lens; lingering
// ones almost always get made. This is what makes cameras < 100% catch rate.
const CAM_CATCH_BASE = 0.2;       // catch chance on the first scan of an offence
const CAM_CATCH_MAX = 0.9;        // ceiling, no matter how long it runs
const CAM_CATCH_RAMP_MS = 30000;  // reaches the ceiling after ~30s of offending
const ATM_JACK_MAX_MS = 180000;   // safety cap: drop an abandoned ATM session
const COP_CATCH = 0.9;            // an on-scene cop is very likely to make you

function camCatchChance(elapsedMs) {
  const t = Math.min(1, Math.max(0, elapsedMs) / CAM_CATCH_RAMP_MS);
  const raw = CAM_CATCH_BASE + (CAM_CATCH_MAX - CAM_CATCH_BASE) * t;
  // Global lens-effectiveness scalar, dev-tunable in the Crime panel (0 = cameras
  // never make you, 1 = full base/max ramp). Default 0.5 — cameras at half strength.
  return raw * Math.max(0, Math.min(1, Number(getTunable('camera_effectiveness', 0.5))));
}

// A camera's catch rate is calibrated for CLEAR conditions; low visibility (night
// blackout, storm, fog, ash) blinds the lens the same way it blinds a fighter's
// aim (combat.js darknessHitPenalty). Every visibility band dimmer than `clear`
// shaves the catch chance by CAM_VIS_STEP, floored at CAM_VIS_FLOOR so a
// pitch-black street still isn't a literal free pass. `clear` and brighter → 1.0
// (default detection). A lower per-roll chance also stretches time-to-detection
// for ongoing offences, since scanActiveCrimes re-rolls this each tick.
const CAM_VIS_BASELINE = 'clear';
const CAM_VIS_STEP = 0.18;   // catch-rate lost per ladder step below `clear`
const CAM_VIS_FLOOR = 0.1;   // cameras never drop below 10% of their clear-air rate
export function visFactorForCategory(category) {
  const base = LIGHT_LADDER.indexOf(CAM_VIS_BASELINE);
  const idx = LIGHT_LADDER.indexOf(category);
  if (idx < 0 || base < 0 || idx >= base) return 1;   // clear+ or unknown → full rate
  return Math.max(CAM_VIS_FLOOR, 1 + (idx - base) * CAM_VIS_STEP);
}
const cameraVisibilityFactor = (zoneId) => visFactorForCategory(getZoneVisibility(zoneId)?.category);

// The single probabilistic witness gate for every crime. Two things catch you: a
// live camera, which rolls `camChance` (flat for a one-shot act, time-ramped for an
// ongoing one), and **a cop standing right there**, who makes you at `COP_CATCH` —
// eyes on the scene are the one thing as good as a lens. `camera`-only crimes ignore
// the cop; `always` crimes are self-reporting. Bystanders no longer report — a
// passer-by seeing it isn't the law seeing it.
//
// Returns the WITNESS SOURCE, not a plain bool: `'camera'` | `'cop'` | `'always'` |
// false. Every caller still reads it as truthy/falsy; raiseCrime uses the source to
// pick the callout — an officer clocking you reads nothing like a lens flaring red.
export async function witnessRoll(zoneId, witness, onCamera, camChance) {
  if (!zoneId) return false;
  if (getZone(zoneId)?.flags?.unsurveilled) return false;   // un-surveilled sanctuary: nothing witnessed, not even a forced 'always'
  if (witness === 'always') return 'always';
  if (onCamera && Math.random() < camChance * cameraVisibilityFactor(zoneId)) return 'camera';
  if (witness === 'camera') return false;
  if (copInZone(zoneId) && Math.random() < COP_CATCH) return 'cop';
  return false;
}

// The on-scene officer, if any — the witness with a badge, and the one named in the
// callout when they're the one who makes you.
function copInZone(zoneId) {
  return (getZoneNpcs(zoneId) || []).find(n => n.flags?.police && !n._dead) || null;
}

// playerId -> Map(crimeKey -> { zoneId, startTs, cap })
const activeCrimes = new Map();
function beginActiveCrime(playerId, key, zoneId, cap = 0) {
  if (!playerId || !zoneId) return;
  let m = activeCrimes.get(playerId);
  if (!m) { m = new Map(); activeCrimes.set(playerId, m); }
  if (!m.has(key)) m.set(key, { zoneId, startTs: Date.now(), cap });
}
function endActiveCrime(playerId, key) {
  const m = activeCrimes.get(playerId);
  if (!m) return;
  m.delete(key);
  if (!m.size) activeCrimes.delete(playerId);
}

// ATM breach: crime chance runs for the whole jacked-in session (jack → resolve).
on('atm.jacked', ({ player, zoneId }) => {
  if (player?.id) beginActiveCrime(player.id, 'hacking', zoneId || player.current_zone, ATM_JACK_MAX_MS);
});
on('atm.jackResolved', ({ player }) => { if (player?.id) endActiveCrime(player.id, 'hacking'); });
on('atm.drained', ({ player }) => { if (player?.id) endActiveCrime(player.id, 'hacking'); });

// Which of these player ids are naked — nothing equipped on torso AND legs?
// Both crime scans want a different fact about the same inventory rows of the
// same players in the same tick, so ask once. Two DISTINCT scans over
// player_inventory every 5 s was ~30 round trips per 75 s on an idle server —
// the same table walked twice for no reason.
// Per-player, because the answer only changes when that player's inventory does
// — and a player standing under a camera doing nothing was being re-scanned
// every 5 s forever. `inventory.changed` drops their entry so a real change is
// picked up on the very next sweep; the TTL is the backstop, because only some
// of the many player_inventory writers emit that event and a purely
// event-driven cache would go stale silently and permanently.
const carriedCache = new Map();   // playerId -> { covered, raw, ts }
const CARRIED_TTL_MS = 60_000;
on('inventory.changed', ({ actor }) => { if (actor?.id) carriedCache.delete(actor.id); });
// Bounded like the plugin's other per-player maps — a logout drops the entry so
// this can't grow for the lifetime of the process.
on('player.logout', ({ id }) => carriedCache.delete(id));

async function scanCarried(playerIds) {
  const empty = { naked: new Set(), raw: new Set() };
  if (!playerIds.length) return empty;

  const now = Date.now();
  const stale = playerIds.filter(id => {
    const e = carriedCache.get(id);
    return !e || now - e.ts > CARRIED_TTL_MS;
  });

  if (stale.length) {
    const { rows } = await query(
      `SELECT pi.player_id,
              BOOL_OR(pi.is_equipped = 1 AND (i.tags->>'slot') IN ('torso','legs')) AS covered,
              BOOL_OR(pi.container_id IS NULL AND jsonb_exists(i.tags, 'raw_drug')) AS raw
         FROM player_inventory pi JOIN items i ON i.id = pi.item_id
        WHERE pi.player_id = ANY($1)
        GROUP BY pi.player_id`,
      [stale]
    ).catch(() => ({ rows: null }));
    if (!rows) return empty;   // failed read → judge nobody this tick
    const byId = new Map(rows.map(r => [r.player_id, r]));
    // A player with NO inventory rows at all has no group in the result — that
    // is the naked-and-carrying-nothing case, and it must still be cached or
    // they'd be re-queried every sweep.
    for (const id of stale) {
      const r = byId.get(id);
      carriedCache.set(id, { covered: !!r?.covered, raw: !!r?.raw, ts: now });
    }
  }

  const naked = new Set(), raw = new Set();
  for (const id of playerIds) {
    const e = carriedCache.get(id);
    if (!e) continue;
    if (!e.covered) naked.add(id);
    if (e.raw) raw.add(id);
  }
  return { naked, raw };
}

// Players carrying any raw drug material (precursors / feedstock / seeds — tags.raw_drug)
// out in the open. Raw stashed inside a container (container_id set) is hidden from a
// street camera or a cop's eyeball — a bag beats a glance. The Scald→city checkpoint
// scanner (smuggle plugin) is not so easily fooled: it sees bagged raw too.

// Each tick: refresh the naked-in-view offences, then roll a witness catch on
// every active offence, the camera odds ramping with how long it's been running.
async function scanActiveCrimes() {
  // 1. Derive indecent-exposure offences: players naked where a witness (a live
  //    camera or an on-scene cop) could see them. Dedup camera lookups by zone.
  const byZone = new Map();   // zoneId -> [player]
  for (const p of getAllLivePlayers()) {
    if (!p.current_zone) continue;
    if (p._vatDressing) continue;   // clone mid-emergence, being dressed — not indecent exposure
    if (!byZone.has(p.current_zone)) byZone.set(p.current_zone, []);
    byZone.get(p.current_zone).push(p);
  }
  const candidates = [];   // { id, zone }
  for (const [zoneId, ps] of byZone) {
    const cop = copInZone(zoneId);
    if (!cop && !await cameraLiveInZone(zoneId)) continue;
    for (const p of ps) candidates.push({ id: p.id, zone: zoneId });
  }
  const carried = await scanCarried(candidates.map(c => c.id));
  const naked = carried.naked;
  const nakedNow = new Set();
  for (const c of candidates) {
    if (!naked.has(c.id)) continue;
    nakedNow.add(c.id);
    beginActiveCrime(c.id, 'indecent_exposure', c.zone);
    activeCrimes.get(c.id).get('indecent_exposure').zoneId = c.zone;   // follow them between zones
  }
  for (const [pid, m] of activeCrimes) {
    if (m.has('indecent_exposure') && !nakedNow.has(pid)) endActiveCrime(pid, 'indecent_exposure');
  }

  // 1b. Manufacturing: players carrying raw drug material where a witness could see them.
  const rawSet = carried.raw;
  const rawNow = new Set();
  for (const c of candidates) {
    if (!rawSet.has(c.id)) continue;
    rawNow.add(c.id);
    beginActiveCrime(c.id, 'manufacturing', c.zone);
    activeCrimes.get(c.id).get('manufacturing').zoneId = c.zone;   // follow them between zones
  }
  for (const [pid, m] of activeCrimes) {
    if (m.has('manufacturing') && !rawNow.has(pid)) endActiveCrime(pid, 'manufacturing');
  }

  // 2. Roll a witness catch on every active offence.
  const now = Date.now();
  for (const [pid, m] of [...activeCrimes]) {
    const player = getLivePlayer(pid);
    if (!player) { activeCrimes.delete(pid); continue; }
    for (const [key, info] of [...m]) {
      if (info.cap && now - info.startTs > info.cap) { m.delete(key); continue; }
      if (player.current_zone !== info.zoneId) { m.delete(key); continue; }   // left the scene
      const onCam = await cameraLiveInZone(info.zoneId);
      if (await witnessRoll(info.zoneId, getCrimeWitness(key), onCam, camCatchChance(now - info.startTs))) {
        await raiseCrime(player, key, info.zoneId, player.handle, true);
        m.delete(key);   // caught; the 12s debounce covers a resumed streak
      }
    }
    if (!m.size) activeCrimes.delete(pid);
  }
}

on('player.logout', ({ id }) => { activeCrimes.delete(id); });

// Set an online player's stars to an exact value (bribe/scrub). Rebuilds the
// hunter roster to the new tier; clears entirely at 0.
async function setStars(player, stars, reason) {
  const s = wantedState(player.id);
  s.stars = Math.max(0, Math.min(MAX_STARS, stars));
  despawnHunters(s);
  await setFlag('player', 'wanted', s.stars, player);
  sendWantedHud(player.id, s.stars);
  if (reason) sendToPlayer(player.id, { type: 'system', message: `<span class="text-dim">${reason}</span>` });
  if (s.stars <= 0) { wantedRuntime.delete(player.id); flushCrimesToHistory(player.id, reason || 'cleared'); }
}

// Clear by id — safe for offline players (death / decay-to-zero).
async function clearWanted(playerId, reason) {
  const s = wantedRuntime.get(playerId);
  if (s) despawnHunters(s);
  wantedRuntime.delete(playerId);
  flushCrimesToHistory(playerId, reason || 'cleared');
  const p = getLivePlayer(playerId);
  if (p) {
    await setFlag('player', 'wanted', 0, p);
    sendWantedHud(playerId, 0);
    if (reason) sendToPlayer(playerId, { type: 'system', message: `<span class="text-dim">Wanted level cleared — ${reason}.</span>` });
  } else {
    await updateFlagById(playerId, 'wanted', 0).catch(() => {});
  }
}

function spawnHunter(template, zoneId, suspectId) {
  const inst = spawnEnemySync(template, zoneId);
  inst.behaviour_graph = WANTED_HUNTER_GRAPH;
  inst.home_zone = zoneId;
  inst.flags = { ...(inst.flags || {}), hunter: true, suspect_id: suspectId };
  inst.targetId = null;         // acquired by searchAndPursue only once co-located
  inst.aggroedAt = null;
  if (inst._ai) inst._ai.flags.cried = false;
  return inst.instanceId;
}

// One search step: usually pathfind a zone toward the suspect, but HUNT_RANDOM of
// the time (or whenever there's no path) wander to a random neighbour instead —
// that's the "little random" that lets a suspect give them the slip.
function huntStep(e, targetZone, bc) {
  let dest = null;
  if (Math.random() >= HUNT_RANDOM) {
    const path = findPath(e.zoneId, targetZone);
    if (path && path.length >= 2) dest = path[1];
  }
  if (!dest) {
    const nbrs = neighborZoneIds(getZone(e.zoneId));
    if (nbrs.length) dest = nbrs[Math.floor(Math.random() * nbrs.length)];
  }
  if (dest && dest !== e.zoneId && bc) moveEntity(e, dest, bc, query);
}

// Every badge is a badge: any NPC flagged `police` — a street cop, a desk
// sergeant, a Precinct 9 detention officer — makes a wanted suspect standing in
// front of them on sight. Cameras originate charges; police act on the heat
// that's already on your file. No dispatch delay applies: they're already here.
// At ≤3.5★ the officer detains (the same submit/run prompt a hunting unit runs);
// above that a lone officer radios it in rather than tackling a manhunt target.
const COP_RADIO_MS = 30000;      // one call-in per suspect per 30s, not per tick
async function policeSpot(suspect, s) {
  if (!suspect?.current_zone || isAirborne(suspect)) return false;
  const cop = copInZone(suspect.current_zone);
  if (!cop) return false;
  s.lastSeenTs = Date.now();   // eyes on you — heat doesn't bleed off in front of a cop
  if (s.stars <= APPREHEND_MAX) {
    await startApprehension(suspect, s, cop).catch(e => console.error('[surveillance] cop apprehend error:', e.message));
  } else if (Date.now() - (s.copCalledTs || 0) > COP_RADIO_MS) {
    s.copCalledTs = Date.now();
    sendToZone(suspect.current_zone, { type: 'ambient', message: `${cop.name} clocks ${suspect.handle}, steps back, and talks fast into a shoulder mic.` });
    dispatchPolice(suspect.current_zone, 'a wanted suspect sighted', suspect.handle);
  }
  return true;
}

// Deploy from the crime scene, then hunt: each tick a unit either engages (same
// zone as the suspect) or takes one search step toward them. Units are NOT
// teleported onto the suspect — you can lose them by moving and staying unseen.
async function searchAndPursue(suspectId, s) {
  const suspect = getLivePlayer(suspectId);
  if (!suspect?.current_zone) return;
  // Cops can't touch you in the air — hold the manhunt (no muster, no detain, no
  // attack) until you're back on the ground. Your stars persist; the units are
  // waiting when you land. (A flying player keeps current_zone set but is off the
  // zone roster, so without this a hunter reaching that zone would "arrest" a plane.)
  if (isAirborne(suspect)) return;
  const zone = suspect.current_zone;
  const bc = getBroadcast();

  // Prune dead.
  for (const iid of [...s.hunters]) {
    if (!world.enemies.get(iid)) s.hunters.delete(iid);
  }

  // Maintain the roster for the current tier — reinforcements muster at the scene.
  const spawnZone = s.crimeZone || zone;
  const haveByTpl = new Map();
  for (const iid of s.hunters) {
    const e = world.enemies.get(iid);
    if (e) haveByTpl.set(e.templateId, (haveByTpl.get(e.templateId) || 0) + 1);
  }
  let deployed = false;
  for (const [tpl, n] of (TIERS[Math.floor(s.stars)] || [])) {
    const have = haveByTpl.get(tpl) || 0;
    for (let i = have; i < n; i++) {
      const template = await getEnemyTemplate(tpl);
      if (!template) continue;   // template not seeded — skip tier gracefully
      s.hunters.add(spawnHunter(template, spawnZone, suspectId));
      deployed = true;
    }
  }
  if (deployed) sendToZone(spawnZone, { type: 'ambient', message: 'Boots and servos — a SPECTER-PD unit fans out from the scene, hunting.' });

  // Engage if co-located; otherwise step toward the suspect and re-check on arrival.
  for (const iid of s.hunters) {
    const e = world.enemies.get(iid);
    if (!e) { s.hunters.delete(iid); continue; }
    if (e.zoneId !== zone) {
      e.targetId = null;
      e.aggroedAt = null;
      huntStep(e, zone, bc);
    }
    if (e.zoneId === zone) {
      if (s.stars <= APPREHEND_MAX) {
        // Petty-to-serious heat: detain, don't kill. Keep the unit non-hostile
        // (no targetId → the hunter graph won't ATTACK) and run the arrest prompt.
        e.targetId = null;
        e.aggroedAt = null;
        startApprehension(suspect, s, e).catch(err => console.error('[surveillance] apprehend error:', err.message));
      } else {
        e.targetId = suspectId;   // full manhunt (≥4★): attack on sight.
        if (!e.aggroedAt) e.aggroedAt = Date.now();
      }
    }
  }
}

async function wantedTick() {
  for (const [pid, s] of wantedRuntime) {
    if (s.stars <= 0) { despawnHunters(s); wantedRuntime.delete(pid); continue; }
    const suspect = getLivePlayer(pid);
    if (!suspect) { despawnHunters(s); s.offline = true; continue; }   // offline: hold stars (flag), drop units
    // Just came back: don't count the offline stretch as "unseen" time. Reset the
    // decay/pursuit clocks now — this tick can fire before the player.login handler
    // does (the player is live from setLivePlayer well before login emits), so we
    // can't rely on that handler alone to freeze the stars across offline time.
    if (s.offline) { s.offline = false; s.lastSeenTs = Date.now(); s.pursuitStartTs = Date.now(); }

    if (await isWitnessed(suspect.current_zone)) s.lastSeenTs = Date.now();

    // Any cop in the room makes you on sight — before the dispatch clock, before
    // any unit deploys. This is what gives every police NPC (detention officers
    // included) real arrest powers rather than decoration.
    await policeSpot(suspect, s);

    // A safehouse (the Long Watch bunker) actively launders heat: unseen time
    // bleeds a star three times as fast as just lying low on the street.
    const decayWindow = getZone(suspect.current_zone)?.flags?.safehouse ? DECAY_MS / 3 : DECAY_MS;
    if (Date.now() - s.lastSeenTs > decayWindow) {
      s.stars -= 1;
      s.lastSeenTs = Date.now();
      despawnHunters(s);
      if (s.stars <= 0) { await clearWanted(pid, 'you lay low long enough'); continue; }
      await setFlag('player', 'wanted', s.stars, suspect);
      sendWantedHud(pid, s.stars);
      sendToPlayer(pid, { type: 'system', message: `<span class="text-dim">The heat's dropping. ${starBar(s.stars)}</span>` });
    }
    // Units are still en route until the star-scaled response delay elapses —
    // but once anything's deployed, keep pursuing without re-gating.
    if (s.hunters.size === 0 && Date.now() - (s.pursuitStartTs || s.lastCrimeTs) < responseDelayMs(s.stars)) continue;
    await searchAndPursue(pid, s);
  }
}
schedule('4s', () => wantedTick().catch(e => console.error('[surveillance] wanted tick error:', e.message)));

on('player.login', async ({ id }) => {
  const p = getLivePlayer(id);
  if (!p) return;
  const stars = parseFloat(await getFlag('player', 'wanted', p) || '0') || 0;
  if (stars > 0) {
    const s = wantedState(id);
    s.stars = stars; s.maxStars = Math.max(s.maxStars || 0, stars);
    s.lastSeenTs = Date.now(); s.lastCrimeTs = Date.now(); s.pursuitStartTs = Date.now();
    s.crimeZone = p.current_zone || null;
    sendWantedHud(id, stars);
  }
  const heat = parseFloat(await getFlag('player', 'heat', p) || '0') || 0;
  if (heat > 0) { heatState(id).heat = heat; sendHeatHud(id, Math.round(heat)); }
});
on('player.logout', ({ id }) => {
  const s = wantedRuntime.get(id); if (s) despawnHunters(s);
  // Checkpoint the decayed heat so login hydration resumes from here.
  const h = heatRuntime.get(id);
  if (h) setFlag('player', 'heat', Math.round(h.heat), { id }).catch(() => {});
  heatRuntime.delete(id);
  const ap = apprehending.get(id); if (ap?.timer) clearTimeout(ap.timer); apprehending.delete(id);
});

// wanted — check your own heat.
async function cmdWanted(args, raw, player) {
  const stars = wantedRuntime.get(player.id)?.stars ?? (parseFloat(await getFlag('player', 'wanted', player) || '0') || 0);
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
  const chip = await resolveInventoryItem(player, { tag: 'datachip', name: nameHint || undefined, topLevel: false });
  if (!chip) return { type: 'error', message: nameHint ? `You have no datachip matching "${nameHint}".` : "You have no datachip to submit." };

  const clipId = chip.tags?.clip_id;
  const { rows: clip } = await query('SELECT crime_tags FROM security_clips WHERE id=$1', [clipId]);
  const tags = clip.length ? parseBuffer(clip[0].crime_tags) : [];
  if (!tags.length) return { type: 'error', message: `${cop.name} skims the footage and shrugs. "Nothing chargeable here. No bounty."` };

  const reward = 100 + 150 * tags.length;
  player.credits = (player.credits || 0) + reward;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query('DELETE FROM player_inventory WHERE id=$1', [chip.inv_id]);
  // The evidence is now in police hands — the clip is spent. Reap its row, its
  // hidden clip broadcast, and the (now unheld) chip definition so submissions
  // don't leave orphans piling up in the media library.
  if (clipId) {
    await query('DELETE FROM security_clips WHERE id=$1', [clipId]);
    const bcId = chip.tags?.broadcast_id || `bc_clip_${clipId}`;
    await query('DELETE FROM media_broadcasts WHERE id=$1', [bcId]);
  }
  const { rows: reaped } = await query(
    `DELETE FROM items WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM player_inventory pi WHERE pi.item_id=items.id) RETURNING id`,
    [chip.item_id]
  );
  for (const r of reaped) deleteItemCache(r.id);
  return {
    type: 'output',
    message: `${cop.name} slots the chip, scans the ${tags.join('/')} footage, and pays out <span class="ip-gain">${reward}c</span> in evidence bounty.`,
    player_update: { credits: player.credits },
  };
}

// ── Battery / power tick ─────────────────────────────────────────────────────
async function batteryTick() {
  const { rows } = await query(
    'SELECT id, device_kind, wired, battery, is_powered, is_damaged, zone_id FROM security_devices'
  );
  // The diff-gates below decide WHETHER a device is written exactly as before;
  // the writes are collected and flushed as at most two statements instead of one
  // awaited round trip per device. A draining battery trips its gate every tick by
  // definition, so this is one guaranteed write per battery device per 5 minutes —
  // it scales with how many players have deployed cameras, not with anything bounded.
  const wPowered = [];  // [id, is_powered]        — wired devices
  const wBattery = [];  // [id, battery, is_powered] — battery devices
  for (const d of rows) {
    if (d.wired) {
      // Wired devices track their zone's power, which rarely flips — only write
      // is_powered when it actually changed, not every 5-minute tick.
      const powered = isZonePowered(d.zone_id) && !d.is_damaged ? 1 : 0;
      if (powered !== d.is_powered) wPowered.push([d.id, powered]);
    } else {
      const drain = DRAIN[d.device_kind] ?? 1;
      const battery = Math.max(0, (d.battery || 0) - drain);
      const powered = battery > 0 && !d.is_damaged ? 1 : 0;
      // A fully-drained device holds at battery=0/is_powered=0 — skip the write
      // once nothing moves; only persist while battery is actually draining.
      if (battery !== d.battery || powered !== d.is_powered)
        wBattery.push([d.id, battery, powered]);
    }
  }
  // The two shapes stay separate on purpose: the wired branch must NOT touch
  // battery. Columns are cast explicitly — a bare VALUES list gives Postgres
  // nothing to infer parameter types from.
  if (wPowered.length) {
    const vals = wPowered.map((_, i) => `($${i*2+1}::text, $${i*2+2}::int)`).join(',');
    await query(
      `UPDATE security_devices d SET is_powered = v.powered
         FROM (VALUES ${vals}) AS v(id, powered)
        WHERE d.id = v.id`,
      wPowered.flat()
    );
  }
  if (wBattery.length) {
    const vals = wBattery.map((_, i) => `($${i*3+1}::text, $${i*3+2}::int, $${i*3+3}::int)`).join(',');
    await query(
      `UPDATE security_devices d SET battery = v.battery, is_powered = v.powered
         FROM (VALUES ${vals}) AS v(id, battery, powered)
        WHERE d.id = v.id`,
      wBattery.flat()
    );
  }
  if (wPowered.length || wBattery.length) invalidateDeviceCache();
}

schedule('5m', () => batteryTick().catch(e => console.error('[surveillance] battery tick error:', e.message)));

// ── Device teardown ──────────────────────────────────────────────────────────
// The one path that unmakes a planted device: both rows (security_devices +
// its twin furniture) plus the in-memory buffer. No gear refund — this is a
// destruction, not a `retrieve`.
async function destroyDevice(id) {
  await query('DELETE FROM security_devices WHERE id=$1', [id]);
  invalidateDeviceCache();
  await deleteFurniture(id);
  cameraBuffers.delete(id);
}

// Sticky cams burn out 24 GAME hours after they were planted. Runs on the same idle-tolerant
// cadence as the clip purge; the owner gets a ping so a dead tile isn't a mystery.
export async function __expireStickyCams() { return expireStickyCams(); }
async function expireStickyCams() {
  const cutoff = Math.floor((Date.now() - stickyCamTtlRealMs()) / 1000);   // placed_at is epoch seconds
  const { rows } = await query(
    `SELECT d.id, d.owner_id, f.name, z.name AS zone_name, d.zone_id
       FROM security_devices d
       JOIN furniture f ON f.id = d.id
       LEFT JOIN zones z ON z.id = d.zone_id
      WHERE d.device_kind='sticky_cam' AND d.wired=0 AND d.placed_at < $1`, [cutoff]);
  for (const d of rows) {
    await destroyDevice(d.id);
    if (d.owner_id) sendToPlayer(d.owner_id, { type: 'system', message:
      `<span class="text-dim">⏻ BURNOUT — ${d.name} at ${d.zone_name || d.zone_id || 'unknown'} hit its 24-hour limit and cooked itself off the wall.</span>` });
  }
  if (rows.length) console.log(`[surveillance] expired ${rows.length} sticky cam(s).`);
}
schedule('10m', () => expireStickyCams().catch(e => console.error('[surveillance] cam expiry error:', e.message)));

// ── Evidence retention purge ─────────────────────────────────────────────────
// security_clips accumulate forever otherwise: auto-banked evidence nobody
// collects, and police clip_pd_ rows minted on every witnessed crime. Drop clips
// older than the retention window that have NO physical chip held anywhere — a
// held microreel is owned property and keeps its clip indefinitely. Cascades to
// each dropped clip's lazily-built broadcast and its (now unheld) chip item.
const CLIP_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;   // 3 days, mirrors the jail evidence locker

// Cascade a set of deleted clip ids to their lazily-built broadcasts and the
// (now unheld) chip item definitions. Held chips are left alone — the caller is
// responsible for only passing clips that have no held chip.
async function reapClipArtifacts(clipIds) {
  if (!clipIds.length) return;
  const bcIds = clipIds.map(id => `bc_clip_${id}`);
  await query(`DELETE FROM media_broadcasts WHERE id = ANY($1::text[])`, [bcIds]);
  const { rows: reaped } = await query(
    `DELETE FROM items WHERE tags->>'broadcast_id' = ANY($1::text[])
       AND NOT EXISTS (SELECT 1 FROM player_inventory pi WHERE pi.item_id = items.id) RETURNING id`,
    [bcIds]);
  for (const r of reaped) deleteItemCache(r.id);
}

async function purgeOldClips() {
  const cutoff = Math.floor((Date.now() - CLIP_RETENTION_MS) / 1000);   // captured_at is epoch seconds
  const { rows: gone } = await query(
    `DELETE FROM security_clips c
      WHERE c.captured_at < $1
        AND NOT EXISTS (
          SELECT 1 FROM items i JOIN player_inventory pi ON pi.item_id = i.id
           WHERE i.tags->>'clip_id' = c.id::text)
      RETURNING c.id`, [cutoff]);
  if (!gone.length) return;
  await reapClipArtifacts(gone.map(r => r.id));
  console.log(`[surveillance] purged ${gone.length} expired evidence clip(s).`);
}
schedule('30m', () => purgeOldClips().catch(e => console.error('[surveillance] clip purge error:', e.message)));

// ── Plugin exports ────────────────────────────────────────────────────────────

// Admin toy: wipe the caller's own heat (acute stars + the invisible meter) and
// make every cop in the room — pursuit hunters AND beat-cop NPCs — spontaneously
// combust. The heat-clear mirrors the /surveillance/clear-slate route; the burn is
// a runtime-only despawn (no DB delete), so torched NPCs return on a world reload.
async function cmdPurge(args, raw, player, broadcast) {
  if (player.role !== 'admin') {
    return { type: 'error', message: `Unknown command: "purge". Type HELP for commands.` };
  }
  const zoneId = player.current_zone;

  // 1. Burn the law in the room — dramatic, per-unit, seen by everyone present.
  const hunters = getZoneEnemies(zoneId).filter(e => e.flags?.hunter);
  const copNpcs = getZoneNpcs(zoneId).filter(n => n.flags?.police);
  let burned = 0;
  for (const e of hunters) {
    if (broadcast) broadcast(zoneId, { type: 'zone_event', message: `<span class="text-red">🔥 ${e.name} shudders, servos screaming — then erupts in a pillar of flame and slumps into molten slag.</span>` });
    removeEnemyInstance(e.instanceId);
    burned++;
  }
  for (const n of copNpcs) {
    if (broadcast) broadcast(zoneId, { type: 'zone_event', message: `<span class="text-red">🔥 ${n.name} spontaneously combusts — a whump of blue fire, a shriek, and a greasy scorch where they stood.</span>` });
    world.zones.get(n.zone_id)?.npcs.delete(n.id);
    world.npcs.delete(n.id);
    burned++;
  }

  // 2. Scrub the heat — stars + invisible meter (see /surveillance/clear-slate).
  await clearWanted(player.id, 'admin purge');
  heatRuntime.delete(player.id);
  await setFlag('player', 'heat', 0, player).catch(() => {});
  sendHeatHud(player.id, 0);

  const tally = burned ? `${burned} officer${burned === 1 ? '' : 's'} reduced to ash.` : 'No police here to burn.';
  return { type: 'system', message: `<span class="text-dim">Slate wiped. ${tally}</span>` };
}

// ── Tablet OS bridge ─────────────────────────────────────────────────────────
// The Surveillance app (plugins/tablet/surveillance-app.js) reshapes this data
// into the tablet shell, the way corp-app.js wraps buildConsolePayload. Nothing
// authoritative lives here beyond a read + a replay push — the live hub, record/
// clip, and chip replay all stay in their own commands, which the app delegates
// straight into, so the tablet can't drift from the standalone deck's behaviour.
export async function hubDataFor(player) {
  const p = await buildHubPayload(player, true);
  return { net: p.net, tiles: p.tiles, alerts: p.alerts };
}
export function hasSpyDeck(playerId) { return playerHasSpyDeck(playerId); }

// The rolling event-line buffer for one of the player's own cameras — what the
// tablet shows in the focused-cam pane so you can read what's recorded before you
// clip it. Owner-checked; newest last, capped to a readable tail.
export async function cameraBufferLines(player, deviceId) {
  if (!deviceId) return [];
  const { rows } = await query('SELECT 1 FROM security_devices WHERE id=$1 AND owner_id=$2', [deviceId, player.id]);
  if (!rows.length) return [];
  return (cameraBuffers.get(deviceId)?.frames || []).slice(-40).map(f => ({ t: f.t, text: f.text, kind: f.kind || 'event' }));
}

// Every microreel the player owns (a security_clips row — a saved recording), with
// metadata for the tablet's Microreels list. Possession-gated: a microreel is the
// datachip you carry, so the list is the reels whose chip is in your kit (regardless
// of who first recorded it) — that's what makes reels tradeable.
export async function microreelList(player) {
  const { rows } = await query(
    `SELECT c.id, c.zone_id, z.name AS zone_name, c.captured_at, c.crime_tags,
            COALESCE(jsonb_array_length(c.frames), 0) AS frame_count
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       JOIN security_clips c ON c.id::text = i.tags->>'clip_id'
       LEFT JOIN zones z ON z.id = c.zone_id
      WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'datachip')
      ORDER BY c.captured_at DESC NULLS LAST`,
    [player.id]
  );
  return rows.map(r => ({
    clipId: r.id,
    name: `Reel — ${r.zone_name || r.zone_id || 'UNKNOWN'}`,
    zone: r.zone_name || r.zone_id || 'UNKNOWN',
    capturedAt: r.captured_at ? Number(r.captured_at) : null,
    crimeTags: parseBuffer(r.crime_tags),
    frames: Number(r.frame_count) || 0,
  }));
}

// One microreel's full contents for the in-app inline viewer — possession-checked
// (the player must carry the reel's datachip). Frames carry { t, text, kind } so the
// tablet can colour speech apart from narration.
export async function getMicroreel(player, clipId) {
  if (!clipId) return null;
  const { rows } = await query(
    `SELECT c.*, z.name AS zone_name FROM security_clips c
       LEFT JOIN zones z ON z.id=c.zone_id
      WHERE c.id=$1 AND EXISTS (
        SELECT 1 FROM player_inventory pi JOIN items i ON i.id=pi.item_id
         WHERE pi.player_id=$2 AND jsonb_exists(i.tags,'datachip') AND i.tags->>'clip_id'=$1
      )`,
    [clipId, player.id]
  );
  if (!rows.length) return null;
  const c = rows[0];
  return {
    id: c.id,
    zone: c.zone_name || c.zone_id || 'UNKNOWN',
    capturedAt: c.captured_at ? Number(c.captured_at) : null,
    crimeTags: parseBuffer(c.crime_tags),
    frames: parseBuffer(c.frames),
  };
}

// Permanently destroy one of the player's microreels — possession-checked. The reel
// is the datachip, so this crushes the chip in the operator's kit (any copy another
// player holds is untouched). Flavoured as ejecting the reel sliver from the tablet
// and crushing it — broadcast to the room.
export async function deleteMicroreel(player, clipId) {
  if (!clipId) return { ok: false };
  const { rows } = await query(
    `DELETE FROM player_inventory pi USING items i
       WHERE pi.item_id=i.id AND pi.player_id=$1
         AND jsonb_exists(i.tags,'datachip') AND i.tags->>'clip_id'=$2
     RETURNING pi.id`,
    [player.id, clipId]
  );
  if (!rows.length) return { ok: false };
  sendToPlayer(player.id, { type: 'output', message:
    'You thumb the microreel out of your tablet — a sliver of black storage glass — and crush it between finger and thumb. It cracks with a dry snap; you flick the dead shard aside.' });
  sendToZone(player.current_zone, { type: 'zone_event', message:
    `<span class="text-dim">${player.handle || 'Someone'} ejects a sliver of storage glass from their tablet, snaps it between two fingers, and flicks the dead shard away.</span>` },
    player.id);
  return { ok: true };
}

// How many of the player's cameras have unclipped footage on tape right now — drives
// the SPECTER home-screen notification badge (a reel waiting to be clipped).
export async function pendingClipCount(player) {
  const { rows } = await query('SELECT id FROM security_devices WHERE owner_id=$1', [player.id]);
  const mine = new Set(rows.map(r => r.id));
  let n = 0;
  for (const [id, buf] of cameraBuffers) {
    if (mine.has(id) && buf.frames.length > 0) n++;
  }
  return n;
}

// Blow one of your own devices from the tablet — the remote kill the SPECTER app's
// Self-Destruct button calls. Owner-checked; the unit is gone for good (no gear
// refund, unlike `retrieve`) and anyone in the room hears it die.
export async function selfDestructDevice(player, deviceId) {
  if (!deviceId) return { ok: false };
  const { rows } = await query(
    `SELECT d.zone_id, f.name FROM security_devices d JOIN furniture f ON f.id=d.id
      WHERE d.id=$1 AND d.owner_id=$2`, [deviceId, player.id]);
  if (!rows.length) return { ok: false };
  const dev = rows[0];
  await destroyDevice(deviceId);
  sendToPlayer(player.id, { type: 'output', message:
    `You send the kill code. Somewhere across the city the ${dev.name} pops, spits a curl of smoke, and stops being evidence.` });
  sendToZone(dev.zone_id, { type: 'zone_event', message:
    '<span class="text-dim">Something hidden nearby pops with a dry electrical snap. A thread of smoke unwinds from a seam in the wall.</span>' });
  return { ok: true };
}

// Clear a camera's live buffer without saving — the helper the tablet 'clear' action
// reuses (same effect as the `wipe` verb, keyed by device id, owner-checked).
export async function wipeCameraBuffer(player, deviceId) {
  if (!deviceId) return false;
  const { rows } = await query('SELECT 1 FROM security_devices WHERE id=$1 AND owner_id=$2', [deviceId, player.id]);
  if (!rows.length) return false;
  cameraBuffers.get(deviceId)?.reset();
  return true;
}

export const commands = {
  plant: cmdPlant,
  retrieve: cmdRetrieve,
  sweep: cmdSweep,
  feed: cmdFeed,
  hub: cmdHub,
  hubclose: cmdHubClose,
  record: cmdRecord,
  clip: cmdClip,
  wipe: cmdWipe,
  collect: cmdCollect,
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
  apprehendresolve: cmdApprehendResolve,
  purge: cmdPurge,
};

// When a zone is deleted (dev panel), reap the evidence tied to it so it can't
// leave orphaned clips/broadcasts/chips behind — exactly the "Cold Channel" pile.
// Held microreels (owned property) are spared; only unheld clips are dropped.
export const hooks = {
  'zone.delete': async (id, allDeletedIds) => {
    const zoneIds = Array.isArray(allDeletedIds) && allDeletedIds.length ? allDeletedIds : [id];
    const { rows: gone } = await query(
      `DELETE FROM security_clips c
        WHERE c.zone_id = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM items i JOIN player_inventory pi ON pi.item_id = i.id
             WHERE i.tags->>'clip_id' = c.id::text)
        RETURNING c.id`, [zoneIds]);
    if (!gone.length) return;
    await reapClipArtifacts(gone.map(r => r.id));
    console.log(`[surveillance] zone delete reaped ${gone.length} clip(s) from ${zoneIds.length} zone(s).`);
  },
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'specter_program', handler: doInstallSpecter },
  { verb: 'use', requiredTag: 'spy_deck', handler: doUseSpyDeck },
  { verb: 'use', requiredTag: 'security_console', handler: doUseConsole },
  { verb: 'use', requiredTag: 'datachip', handler: doUseDatachip },
  // Declaration-only: `scrub` stays a plain command (cmdScrub self-resolves the
  // terminal), this entry just makes the terminal advertise it on examine.
  { verb: 'scrub', requiredFlag: 'police_terminal', handler: null },
];

// ── Dev route: live crime log for the Emergency panel ─────────────────────────
function _devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/surveillance')) return null;
  if (!_devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };

  // RAM-side equivalent of a pg_stat audit (Phase 4): surfaces in-memory camera
  // buffer count + total buffered frames so stale-buffer accumulation over long
  // uptime is visible rather than silent.
  if (path === '/surveillance/buffers' && method === 'GET') {
    let totalBufferedFrames = 0;
    for (const b of cameraBuffers.values()) totalBufferedFrames += b.frames.length;
    return { status: 200, body: { activeCameraBuffers: cameraBuffers.size, totalBufferedFrames } };
  }

  if (path === '/surveillance/crime-log' && method === 'GET') {
    // The in-memory crimeBoard only holds crimes caught by a witness roll (raiseCrime),
    // and it's wiped on restart — but wanted stars persist in player_flags and can also
    // be raised directly (witnessed homicide, PD-unit kills, the WANTED_RAISE action
    // from jail/flight, heat ignition, fleeing detainment) without ever logging a board
    // row. So the board alone silently drops wanted suspects. Anchor the active list on
    // the persisted `wanted` flag (source of truth for who's wanted right now), keep each
    // suspect's logged crime rows where we have them, and synthesize a single row for any
    // wanted player the board never captured. Live star count comes from wantedRuntime so
    // the panel reflects rises/decay between polls; history keeps the clear-time level.
    const { rows: wantedRows } = await query(
      `SELECT pf.player_id, p.handle, p.current_zone, pf.flag_value AS stars
         FROM player_flags pf JOIN players p ON p.id = pf.player_id
        WHERE pf.flag_key = 'wanted' AND pf.flag_value <> '0'`
    ).catch(() => ({ rows: [] }));

    const boardByPlayer = new Map();
    for (const c of crimeBoard) {
      if (!boardByPlayer.has(c.playerId)) boardByPlayer.set(c.playerId, []);
      boardByPlayer.get(c.playerId).push(c);
    }

    const active = [];
    for (const w of wantedRows) {
      const stars = wantedRuntime.get(w.player_id)?.stars ?? (parseFloat(w.stars) || 0);
      if (!(stars > 0)) continue;
      const rows = boardByPlayer.get(w.player_id);
      if (rows?.length) {
        for (const c of rows) active.push({ ...c, wanted: stars });
      } else {
        const s = wantedRuntime.get(w.player_id);
        const zoneId = s?.crimeZone || w.current_zone;
        active.push({
          id: `w:${w.player_id}`,
          playerId: w.player_id,
          perpetrator: w.handle || w.player_id,
          zoneId,
          zone: getZone(zoneId)?.name || zoneId || 'unknown',
          crimeKey: null,
          crime: s?.charges?.[s.charges.length - 1] || 'outstanding warrant',
          wanted: stars,
          ts: s?.lastCrimeTs || Date.now(),
        });
      }
    }
    active.sort((a, b) => b.ts - a.ts);
    return { status: 200, body: { active, history: crimeHistory } };
  }

  // Admin scrub: wipe both wanted stars AND the invisible heat meter for one
  // suspect. Works online (live flags + HUD) or offline (direct flag rows).
  if (path === '/surveillance/clear-slate' && method === 'POST') {
    const playerId = body?.playerId;
    if (!playerId) return { status: 400, body: { error: 'playerId required' } };
    await clearWanted(playerId, 'admin cleared');
    heatRuntime.delete(playerId);
    const p = getLivePlayer(playerId);
    if (p) {
      await setFlag('player', 'heat', 0, p);
      sendHeatHud(playerId, 0);
    } else {
      await updateFlagById(playerId, 'heat', 0).catch(() => {});
    }
    return { status: 200, body: { ok: true } };
  }

  return null;
};

console.log('[surveillance] Plugin loaded.');
