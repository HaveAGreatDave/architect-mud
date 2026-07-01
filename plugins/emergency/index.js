import { query } from '../../server/models/db.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getAmbientDefByName } from '../audio/index.js';
import { world, spawnEnemySync, removeEnemyInstance, getLivePlayer } from '../../server/engine/world.js';

const DEFAULT_MESSAGE =
  '⚠ EMERGENCY SECURITY PROTOCOL ACTIVE — ALL CIVILIANS SHELTER IN PLACE IMMEDIATELY — ARMED RESPONSE UNITS ARE DEPLOYED — THIS IS NOT A DRILL — STAY INDOORS AND AWAIT FURTHER INSTRUCTIONS ⚠';

// ── ESP state ─────────────────────────────────────────────────────────────────

let espActive   = false;
let espMessage  = DEFAULT_MESSAGE;
let espZones    = new Set();
let espIndoor   = new Set();

// ── Arbiter state ─────────────────────────────────────────────────────────────

let arbitersActive        = false;
let arbitersStandingDown  = false;
let adminProtectionEnabled = false;
const spawnedArbiters     = new Set(); // Set<instanceId>
let lastDespawnBroadcast  = 0;

// Behaviour graph injected onto every spawned Arbiter (DB format — normalizeGraph runs on first tick).
// Flow: check standdown flag → if standing down, GO_HOME; else seek/attack players; wander safe zones otherwise.
const ARBITER_BEHAVIOUR_GRAPH = {
  _start: 'check_standdown',
  nodes: {
    check_standdown: {
      type: 'condition',
      condition_type: 'FLAG_SET',
      params: { flag: 'standdown', scope: 'self' },
      ifTrue: 'go_home',
      ifFalse: 'check_has_target',
    },
    go_home: {
      type: 'action',
      action_type: 'GO_HOME',
      params: {},
      next: 'loop_back',
    },
    check_has_target: {
      type: 'condition',
      condition_type: 'HAS_TARGET',
      params: {},
      ifTrue: 'check_cried',
      ifFalse: 'clear_cried',
    },
    // Once the battle cry has fired, skip straight to attacking.
    check_cried: {
      type: 'condition',
      condition_type: 'FLAG_SET',
      params: { flag: 'cried', scope: 'self' },
      ifTrue: 'attack',
      ifFalse: 'battle_cry',
    },
    // Reset the cried flag whenever the Arbiter loses its target, so the next
    // target acquisition triggers a fresh warning.
    clear_cried: {
      type: 'action',
      action_type: 'SET_FLAG',
      params: { flag: 'cried', scope: 'self', value: false },
      next: 'check_player_in_zone',
    },
    battle_cry: {
      type: 'action',
      action_type: 'SAY',
      params: { message: 'HALT. COMPLIANCE IS MANDATORY. LETHAL FORCE AUTHORIZED.' },
      next: 'set_cried',
    },
    set_cried: {
      type: 'action',
      action_type: 'SET_FLAG',
      params: { flag: 'cried', scope: 'self', value: 'true' },
      next: 'delay_attack',
    },
    delay_attack: {
      type: 'wait',
      seconds: 5,
      next: 'attack',
    },
    attack: {
      type: 'action',
      action_type: 'ATTACK',
      params: {},
      next: 'loop_back',
    },
    check_player_in_zone: {
      type: 'condition',
      condition_type: 'PLAYER_IN_ZONE',
      params: { min: 1 },
      ifTrue: 'acquire_target',
      ifFalse: 'wander',
    },
    acquire_target: {
      type: 'action',
      action_type: 'ACQUIRE_TARGET',
      params: {},
      next: 'loop_back',
    },
    wander: {
      type: 'action',
      action_type: 'HAVE_LIFE',
      params: {},
      next: 'wander_wait',
    },
    wander_wait: {
      type: 'wait',
      seconds: 3,
      next: 'loop_back',
    },
    loop_back: {
      type: 'loop',
      next: 'check_standdown',
    },
  },
};

// ── ESP helpers ───────────────────────────────────────────────────────────────

function sirenDef() {
  return getAmbientDefByName('amb_emergency_siren');
}

function sirenDefMuffled(siren) {
  if (!siren) return null;
  return {
    ...siren,
    id: `${siren.id}_indoor`,
    config: { ...siren.config, gain: (siren.config?.gain ?? 0.65) * 0.5 },
  };
}

async function loadStreetlightZones() {
  const { rows } = await query(
    `SELECT DISTINCT zone_id FROM furniture WHERE light_type = 'streetlight'`
  );
  espZones = new Set(rows.map(r => r.zone_id));
}

async function loadIndoorZones() {
  if (espZones.size === 0) { espIndoor = new Set(); return; }
  const { rows } = await query(
    `SELECT z.id FROM zones z
       JOIN maps m ON z.map_id = m.id
      WHERE m.parent_zone_id = ANY($1)`,
    [[...espZones]]
  );
  espIndoor = new Set(rows.map(r => r.id));
}

function broadcastToEspZones(msg) {
  for (const zoneId of espZones) sendToZone(zoneId, msg);
}

async function activate(message) {
  if (espActive) return;
  if (message) espMessage = message;
  await loadStreetlightZones();
  await loadIndoorZones();

  const siren = sirenDef();
  const muffled = sirenDefMuffled(siren);

  for (const zoneId of espZones) {
    sendToZone(zoneId, { type: 'esp_state', active: true, message: espMessage });
    if (siren) sendToZone(zoneId, { type: 'audio_ambience', def: siren });
  }
  for (const zoneId of espIndoor) {
    sendToZone(zoneId, { type: 'esp_state', active: true, message: espMessage });
    if (muffled) sendToZone(zoneId, { type: 'audio_ambience', def: muffled });
  }

  broadcastToEspZones({ type: 'esp_warning', message: espMessage });
  for (const zoneId of espIndoor) sendToZone(zoneId, { type: 'esp_warning', message: espMessage });

  espActive = true;
}

function deactivate() {
  if (!espActive) return;

  const siren = sirenDef();
  const muffled = sirenDefMuffled(siren);

  for (const zoneId of espZones) {
    sendToZone(zoneId, { type: 'esp_state', active: false });
    if (siren) sendToZone(zoneId, { type: 'audio_stop', scope: 'ambience', id: siren.id });
  }
  for (const zoneId of espIndoor) {
    sendToZone(zoneId, { type: 'esp_state', active: false });
    if (muffled) sendToZone(zoneId, { type: 'audio_stop', scope: 'ambience', id: muffled.id });
  }

  espActive = false;
  espZones.clear();
  espIndoor.clear();
}

// ── Arbiter logic ─────────────────────────────────────────────────────────────

async function activateArbiters() {
  if (arbitersActive) return { error: 'Arbiters already deployed' };

  const { rows: arrayRows } = await query(
    `SELECT DISTINCT zone_id FROM furniture WHERE name ILIKE '%arbiter%'`
  );
  if (!arrayRows.length) return { error: 'No Arbiter Array furniture found in DB — create furniture named "Arbiter Array" and assign it to a zone' };

  const { rows: templates } = await query(
    `SELECT * FROM enemies WHERE id = 'enemy_arbiterclass_enforcement_unit' LIMIT 1`
  );
  if (!templates.length) return { error: 'Enemy template "enemy_arbiterclass_enforcement_unit" not found in DB' };
  const template = templates[0];

  const missingZones = [];
  let spawned = 0;
  for (const { zone_id } of arrayRows) {
    if (!world.zones.has(zone_id)) { missingZones.push(zone_id); continue; }
    for (let i = 0; i < 5; i++) {
      const instance = spawnEnemySync(template, zone_id);
      instance.home_zone = zone_id;
      instance.behaviour_graph = ARBITER_BEHAVIOUR_GRAPH;
      spawnedArbiters.add(instance.instanceId);
      spawned++;
    }
  }

  if (spawned === 0) {
    const hint = missingZones.length
      ? `Found ${arrayRows.length} array zone(s) but none are loaded in the live world: ${missingZones.join(', ')}`
      : 'No zones to spawn into';
    return { error: hint };
  }

  arbitersActive = true;
  arbitersStandingDown = false;
  return { spawned, arrays: arrayRows.length };
}

function standDownArbiters() {
  if (!arbitersActive || arbitersStandingDown) return;
  arbitersStandingDown = true;

  for (const instanceId of spawnedArbiters) {
    const e = world.enemies.get(instanceId);
    if (!e) { spawnedArbiters.delete(instanceId); continue; }
    e.targetId = null;
    e.aggroedAt = null;
    if (e._ai) {
      e._ai.flags.standdown = true;
      e._ai.flags.cried = false;
      e._ai.patrolPath = [];
      e._ai.patrolTarget = null;
      e._ai.currentNode = null;
    }
  }
}

// Poll every 2 s: handle stand-down despawns and admin-protection target clearing.
setInterval(() => {
  if (!arbitersActive) return;

  for (const instanceId of spawnedArbiters) {
    const e = world.enemies.get(instanceId);
    if (!e) { spawnedArbiters.delete(instanceId); continue; }

    // Admin protection: never let Arbiters attack admin players.
    if (adminProtectionEnabled && e.targetId) {
      const target = getLivePlayer(e.targetId);
      if (target?.role === 'admin') {
        e.targetId = null;
        e.aggroedAt = null;
        if (e._ai) { e._ai.patrolPath = []; e._ai.flags.cried = false; }
      }
    }

    // Stand-down: despawn Arbiters that have walked home.
    if (arbitersStandingDown && e._ai?.flags?.standdown && e.zoneId === e.home_zone) {
      const now = Date.now();
      if (now - lastDespawnBroadcast >= 5000) {
        lastDespawnBroadcast = now;
        sendToZone(e.zoneId, {
          type: 'output',
          message: `<span style="color:var(--text-dim);font-style:italic">The Arbiter-Class Enforcement Unit locks back into its bay, armor sealing flush as its optic drains to nothing and its presence collapses into controlled absence.</span>`,
        });
      }
      removeEnemyInstance(instanceId);
      spawnedArbiters.delete(instanceId);
    }
  }

  if (arbitersStandingDown && spawnedArbiters.size === 0) {
    arbitersActive = false;
    arbitersStandingDown = false;
  }
}, 2000);

// ── Zone movement: syncing existing ESP logic ─────────────────────────────────

on('zone.entered', ({ actor, zone: zoneId }) => {
  if (!espActive) return;
  const siren = sirenDef();
  const muffled = sirenDefMuffled(siren);
  if (espZones.has(zoneId)) {
    sendToPlayer(actor.id, { type: 'esp_state', active: true, message: espMessage });
    if (muffled) sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: muffled.id });
    if (siren) sendToPlayer(actor.id, { type: 'audio_ambience', def: siren });
  } else if (espIndoor.has(zoneId)) {
    sendToPlayer(actor.id, { type: 'esp_state', active: true, message: espMessage });
    if (siren) sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: siren.id });
    if (muffled) sendToPlayer(actor.id, { type: 'audio_ambience', def: muffled });
  } else {
    sendToPlayer(actor.id, { type: 'esp_state', active: false });
    if (siren) sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: siren.id });
    if (muffled) sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: muffled.id });
  }
});

// ── Plugin hooks ──────────────────────────────────────────────────────────────

export const hooks = {
  // Append a colored status dot to Arbiter Array furniture descriptions.
  'furniture.describe': (f) => {
    if (!f.name?.toLowerCase().includes('arbiter')) return undefined;
    let color, label;
    if (arbitersActive && !arbitersStandingDown) {
      color = '#ff4444'; label = 'DEPLOYED';
    } else if (arbitersStandingDown) {
      color = '#f59e0b'; label = 'STANDING DOWN';
    } else {
      color = '#22c55e'; label = 'READY';
    }
    return `<span style="color:${color};font-size:11px;letter-spacing:1px">⬤ ${label}</span>`;
  },

  // When an admin is killed by a player, aggro all active Arbiters on the killer.
  'player.death': (player, killer) => {
    if (!adminProtectionEnabled || !arbitersActive || arbitersStandingDown) return;
    if (player.role !== 'admin') return;
    if (!killer?.id) return; // null or enemy — enemies have instanceId not id

    for (const instanceId of spawnedArbiters) {
      const e = world.enemies.get(instanceId);
      if (!e || e._ai?.flags?.standdown) continue;
      e.targetId = killer.id;
      e.aggroedAt = Date.now();
      if (e._ai) { e._ai.flags.cried = false; }
    }
  },
};

// ── Route handler ─────────────────────────────────────────────────────────────

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/emergency')) return null;
  if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };

  if (path === '/emergency/state' && method === 'GET') {
    return {
      status: 200,
      body: {
        active: espActive,
        message: espMessage,
        zones: [...espZones],
        arbiters: {
          active: arbitersActive,
          standingDown: arbitersStandingDown,
          adminProtection: adminProtectionEnabled,
          count: spawnedArbiters.size,
        },
      },
    };
  }

  if (path === '/emergency/activate' && method === 'POST') {
    await activate(body?.message?.trim() || null);
    return { status: 200, body: { active: true, zones: espZones.size } };
  }

  if (path === '/emergency/deactivate' && method === 'POST') {
    deactivate();
    return { status: 200, body: { active: false } };
  }

  if (path === '/emergency/message' && method === 'PUT') {
    const msg = body?.message?.trim();
    if (!msg) return { status: 400, body: { error: 'message is required' } };
    espMessage = msg;
    if (espActive) broadcastToEspZones({ type: 'esp_warning', message: espMessage });
    return { status: 200, body: { message: espMessage } };
  }

  if (path === '/emergency/arbiters/activate' && method === 'POST') {
    let result;
    try { result = await activateArbiters(); }
    catch (e) { return { status: 500, body: { error: e.message || 'Arbiter activation failed' } }; }
    if (result.error) return { status: 400, body: result };
    return { status: 200, body: result };
  }

  if (path === '/emergency/arbiters/standdown' && method === 'POST') {
    if (!arbitersActive) return { status: 400, body: { error: 'No Arbiters deployed' } };
    standDownArbiters();
    return { status: 200, body: { standingDown: true, count: spawnedArbiters.size } };
  }

  if (path === '/emergency/arbiters/admin-protection' && method === 'POST') {
    adminProtectionEnabled = !!body?.enabled;
    return { status: 200, body: { adminProtection: adminProtectionEnabled } };
  }

  return null;
};
