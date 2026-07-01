import { query } from '../../server/models/db.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getAmbientDefByName } from '../audio/index.js';
import { world, spawnEnemySync, removeEnemyInstance, getLivePlayer } from '../../server/engine/world.js';
import { setEspShelter } from '../../server/engine/ai-behaviour.js';

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
const spawnedArbiters  = new Set();         // Set<instanceId>
const arbiterHomeZone  = new Map();         // instanceId -> zoneId
const spawnedByZone    = new Map();         // zoneId -> Set<instanceId>
let lastDespawnBroadcast  = 0;

// ── Inline SFX defs (synthesized by the client audio engine; no DB entry needed) ──

const SFX_ARBITER_DOCK = {
  id: 'sfx_arbiter_dock', name: 'sfx_arbiter_dock', category: 'sfx', priority: 6,
  config: {
    duration: 0.25,
    layers: [
      // low-frequency body thud
      { waveform: 'sine',  freq: 52,  adsr: { a: 0.002, d: 0.12, s: 0, r: 0.18 }, gain: 1.0 },
      // noise burst — the mechanical clack of metal-on-metal
      { noiseMix: 1, filter: { type: 'lowpass', freq: 300 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, gain: 0.6 },
      // faint metallic ring
      { waveform: 'sine',  freq: 410, adsr: { a: 0.001, d: 0.04, s: 0, r: 0.28 }, gain: 0.1 },
    ],
  },
};

// Hydraulic whirr spooling down — pitch-bends from 160Hz to near-silence over 2.5s
const SFX_ARRAY_WHIRR = {
  id: 'sfx_array_whirr', name: 'sfx_array_whirr', category: 'sfx', priority: 7,
  config: {
    duration: 2.5,
    layers: [
      { waveform: 'sawtooth', freq: 160, pitchBend: { to: 30, time: 2.5 }, filter: { type: 'lowpass', freq: 700, q: 1.5 }, adsr: { a: 0.08, d: 0.3, s: 0.6, r: 0.9 }, gain: 0.5 },
      { waveform: 'square',   freq: 82,  pitchBend: { to: 18, time: 2.0 }, filter: { type: 'lowpass', freq: 400 },         adsr: { a: 0.05, d: 0.2, s: 0.5, r: 0.8 }, gain: 0.28 },
    ],
  },
};

// Heavy structural clunk — armatures seating home
const SFX_ARRAY_CLUNK = {
  id: 'sfx_array_clunk', name: 'sfx_array_clunk', category: 'sfx', priority: 7,
  config: {
    duration: 0.3,
    layers: [
      { waveform: 'sine', freq: 44, adsr: { a: 0.001, d: 0.14, s: 0, r: 0.2 }, gain: 1.0 },
      { noiseMix: 1, filter: { type: 'lowpass', freq: 420 }, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.07 }, gain: 0.7 },
    ],
  },
};

// Short confirmation beep — tri-tone fired in sequence by the caller
const SFX_ARRAY_BEEP = {
  id: 'sfx_array_beep', name: 'sfx_array_beep', category: 'sfx', priority: 7,
  config: {
    duration: 0.1,
    layers: [{ waveform: 'square', freq: 1100, adsr: { a: 0.005, d: 0.04, s: 0.3, r: 0.06 }, gain: 0.38 }],
  },
};

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
      seconds: 20,
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
      condition_type: 'TARGETABLE_IN_ZONE',
      params: {},
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
      action_type: 'ROAM',
      params: { interval_s: 10 },
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

const SIREN_GAIN_OUTDOOR = 1.0;
const SIREN_GAIN_INDOOR  = 1 / 3; // 3× quieter through walls

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

  for (const zoneId of espZones) {
    sendToZone(zoneId, { type: 'esp_state', active: true, message: espMessage });
    if (siren) {
      sendToZone(zoneId, { type: 'audio_ambience', def: siren });
      sendToZone(zoneId, { type: 'audio_loop_gain', id: siren.id, gain: SIREN_GAIN_OUTDOOR });
    }
  }
  for (const zoneId of espIndoor) {
    sendToZone(zoneId, { type: 'esp_state', active: true, message: espMessage });
    if (siren) {
      sendToZone(zoneId, { type: 'audio_ambience', def: siren });
      sendToZone(zoneId, { type: 'audio_loop_gain', id: siren.id, gain: SIREN_GAIN_INDOOR });
    }
  }

  broadcastToEspZones({ type: 'esp_warning', message: espMessage });
  for (const zoneId of espIndoor) sendToZone(zoneId, { type: 'esp_warning', message: espMessage });

  for (const npc of world.npcs.values()) {
    if (!npc.home_zone || !npc._ai) continue;
    npc._ai.patrolPath = [];
    npc._ai.patrolTarget = null;
    npc._ai.currentNode = null;
    npc._ai.waitUntil = null;
    npc._ai._lifeActivity = null;
    npc._ai.flags.esp_shelter = true;
  }
  setEspShelter(true);

  espActive = true;
}

function deactivate() {
  if (!espActive) return;

  const siren = sirenDef();

  const windDownMsg = { type: 'ambient', message: '<span class="msg-ambient">The emergency siren slows, drops in pitch, and winds down into silence. The red warning lights stutter once and go dark.</span>' };

  for (const zoneId of espZones) {
    sendToZone(zoneId, { type: 'esp_state', active: false });
    if (siren) sendToZone(zoneId, { type: 'audio_stop', scope: 'ambience', id: siren.id });
    sendToZone(zoneId, windDownMsg);
  }
  for (const zoneId of espIndoor) {
    sendToZone(zoneId, { type: 'esp_state', active: false });
    if (siren) sendToZone(zoneId, { type: 'audio_stop', scope: 'ambience', id: siren.id });
    sendToZone(zoneId, windDownMsg);
  }

  espActive = false;
  espZones.clear();
  espIndoor.clear();

  // Release the global ESP shelter override so normal AI ticks resume.
  setEspShelter(false);

  // Reset each NPC's AI state so they pick up their normal routine on the
  // next tick rather than staying frozen at their home zone.
  for (const npc of world.npcs.values()) {
    if (!npc._ai) continue;
    npc._ai.flags.esp_shelter = false;
    npc._ai.patrolPath = [];
    npc._ai.patrolTarget = null;
    npc._ai.currentNode = null;
    npc._ai.waitUntil = null;
    npc._ai._lifeActivity = null;
  }

  standDownArbiters();
}

// ── Array shutdown sequence ───────────────────────────────────────────────────

function broadcastArrayShutdown(zoneId) {
  sendToZone(zoneId, {
    type: 'output',
    message: `<span style="color:var(--text-dim);font-style:italic">The last bay seals with a pressure-equalizing thud and the Array's status lamp shifts from amber to green. Hydraulic armatures retract in sequence — each segment folding back into the chassis with a series of heavy mechanical clunks. Cooling fans spool down in a long descending whirr, and a tri-tone confirmation chime announces that the Arbiter Array has returned to standby.</span>`,
  });
  // Trigger a look refresh so clients see the updated zone without a manual reload.
  setTimeout(() => sendToZone(zoneId, { type: 'zone_event', message: '', refresh: true }), 2000);
  sendToZone(zoneId, { type: 'audio_sfx', def: SFX_ARRAY_WHIRR });
  setTimeout(() => sendToZone(zoneId, { type: 'audio_sfx', def: SFX_ARRAY_CLUNK }), 600);
  setTimeout(() => {
    sendToZone(zoneId, { type: 'audio_sfx', def: SFX_ARRAY_BEEP });
    setTimeout(() => sendToZone(zoneId, { type: 'audio_sfx', def: SFX_ARRAY_BEEP }), 190);
    setTimeout(() => sendToZone(zoneId, { type: 'audio_sfx', def: SFX_ARRAY_BEEP }), 420);
  }, 1300);
  setTimeout(() => sendToZone(zoneId, { type: 'audio_sfx', def: SFX_ARRAY_CLUNK }), 1900);
}

// Remove an arbiter from all tracking sets; fires the per-zone shutdown broadcast
// if we're in stand-down mode and this was the last arbiter for that zone.
function removeTrackedArbiter(instanceId, docked) {
  spawnedArbiters.delete(instanceId);
  const homeZone = arbiterHomeZone.get(instanceId);
  arbiterHomeZone.delete(instanceId);
  if (!homeZone) return;
  const zoneSet = spawnedByZone.get(homeZone);
  if (!zoneSet) return;
  zoneSet.delete(instanceId);
  if (zoneSet.size === 0) {
    spawnedByZone.delete(homeZone);
    if (arbitersStandingDown) broadcastArrayShutdown(homeZone);
  }
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

  arbiterHomeZone.clear();
  spawnedByZone.clear();

  const missingZones = [];
  let spawned = 0;
  for (const { zone_id } of arrayRows) {
    if (!world.zones.has(zone_id)) { missingZones.push(zone_id); continue; }
    if (!spawnedByZone.has(zone_id)) spawnedByZone.set(zone_id, new Set());
    for (let i = 0; i < 5; i++) {
      const instance = spawnEnemySync(template, zone_id);
      instance.home_zone = zone_id;
      instance.behaviour_graph = ARBITER_BEHAVIOUR_GRAPH;
      instance.flags = { ...(instance.flags || {}), ignores_admins: true, attacks_enemies: true, safe_zones_only: true };
      spawnedArbiters.add(instance.instanceId);
      arbiterHomeZone.set(instance.instanceId, zone_id);
      spawnedByZone.get(zone_id).add(instance.instanceId);
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

  for (const instanceId of [...spawnedArbiters]) {
    const e = world.enemies.get(instanceId);
    if (!e) { removeTrackedArbiter(instanceId, false); continue; }
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

  for (const instanceId of [...spawnedArbiters]) {
    const e = world.enemies.get(instanceId);
    if (!e) { removeTrackedArbiter(instanceId, false); continue; }

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
      // Thunk SFX: the unit physically docking into its bay.
      sendToZone(e.zoneId, { type: 'audio_sfx', def: SFX_ARBITER_DOCK });
      removeEnemyInstance(instanceId);
      removeTrackedArbiter(instanceId, true);
    }
  }

  if (arbitersStandingDown && spawnedArbiters.size === 0) {
    arbitersActive = false;
    arbitersStandingDown = false;
  }
}, 2000);

// ── Zone movement / login: syncing existing ESP logic ────────────────────────

on('player.login', ({ id }) => {
  if (!espActive) return;
  const player = getLivePlayer(id);
  if (!player) return;
  const zoneId = player.current_zone;
  const siren = sirenDef();
  if (!siren) return;
  if (espZones.has(zoneId)) {
    sendToPlayer(id, { type: 'esp_state', active: true, message: espMessage });
    sendToPlayer(id, { type: 'audio_ambience', def: siren });
    sendToPlayer(id, { type: 'audio_loop_gain', id: siren.id, gain: SIREN_GAIN_OUTDOOR, ramp: 0.1 });
  } else if (espIndoor.has(zoneId)) {
    sendToPlayer(id, { type: 'esp_state', active: true, message: espMessage });
    sendToPlayer(id, { type: 'audio_ambience', def: siren });
    sendToPlayer(id, { type: 'audio_loop_gain', id: siren.id, gain: SIREN_GAIN_INDOOR, ramp: 0.1 });
  }
});

// 0.22 s matches the 220 ms area-pane slide animation so the gain lands at the
// right level exactly when the new room fades in.
const SIREN_RAMP = 0.22;

on('zone.entered', ({ actor, zone: zoneId }) => {
  if (!espActive) return;
  const siren = sirenDef();
  if (!siren) return;
  if (espZones.has(zoneId)) {
    sendToPlayer(actor.id, { type: 'esp_state', active: true, message: espMessage });
    sendToPlayer(actor.id, { type: 'audio_ambience', def: siren });
    sendToPlayer(actor.id, { type: 'audio_loop_gain', id: siren.id, gain: SIREN_GAIN_OUTDOOR, ramp: SIREN_RAMP });
  } else if (espIndoor.has(zoneId)) {
    sendToPlayer(actor.id, { type: 'esp_state', active: true, message: espMessage });
    sendToPlayer(actor.id, { type: 'audio_ambience', def: siren });
    sendToPlayer(actor.id, { type: 'audio_loop_gain', id: siren.id, gain: SIREN_GAIN_INDOOR, ramp: SIREN_RAMP });
  } else {
    sendToPlayer(actor.id, { type: 'esp_state', active: false });
    sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: siren.id });
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
