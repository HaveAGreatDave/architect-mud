import { query } from '../../server/models/db.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getAmbientDefByName } from '../audio/index.js';

const DEFAULT_MESSAGE =
  '⚠ EMERGENCY SECURITY PROTOCOL ACTIVE — ALL CIVILIANS SHELTER IN PLACE IMMEDIATELY — ARMED RESPONSE UNITS ARE DEPLOYED — THIS IS NOT A DRILL — STAY INDOORS AND AWAIT FURTHER INSTRUCTIONS ⚠';

let espActive   = false;
let espMessage  = DEFAULT_MESSAGE;
let espZones    = new Set(); // zone_ids that have at least one streetlight (exterior)
let espIndoor   = new Set(); // zone_ids inside buildings whose parent zone is an ESP zone
let espTicker   = null;      // setInterval handle for 10-second warning loop

function sirenDef() {
  return getAmbientDefByName('amb_emergency_siren');
}

function sirenDefMuffled(siren) {
  if (!siren) return null;
  // Distinct id so the audio engine treats it as a separate loop from the outdoor siren,
  // allowing per-player swap when they move between indoors and outdoors.
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

// Find all interior zones that belong to buildings sitting on an ESP exterior zone.
// maps.parent_zone_id is the exterior cell the building occupies; zones.map_id
// links interior rooms to their building map.
async function loadIndoorZones() {
  if (espZones.size === 0) { espIndoor = new Set(); return; }
  const zoneList = [...espZones];
  const { rows } = await query(
    `SELECT z.id FROM zones z
       JOIN maps m ON z.map_id = m.id
      WHERE m.parent_zone_id = ANY($1)`,
    [zoneList]
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

  espTicker = setInterval(() => {
    broadcastToEspZones({ type: 'esp_warning', message: espMessage });
    for (const zoneId of espIndoor) sendToZone(zoneId, { type: 'esp_warning', message: espMessage });
  }, 10_000);

  espActive = true;
}

function deactivate() {
  if (!espTicker && !espActive) return;
  clearInterval(espTicker);
  espTicker = null;

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

// Catch players moving into or out of ESP zones while active.
on('zone.entered', ({ actor, zone: zoneId }) => {
  if (!espActive) return;
  const siren = sirenDef();
  const muffled = sirenDefMuffled(siren);
  if (espZones.has(zoneId)) {
    // Entering an outdoor ESP zone: full siren, stop any muffled version
    sendToPlayer(actor.id, { type: 'esp_state', active: true, message: espMessage });
    if (muffled) sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: muffled.id });
    if (siren) sendToPlayer(actor.id, { type: 'audio_ambience', def: siren });
  } else if (espIndoor.has(zoneId)) {
    // Entering a connected indoor zone: muffled siren, stop any full version
    sendToPlayer(actor.id, { type: 'esp_state', active: true, message: espMessage });
    if (siren) sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: siren.id });
    if (muffled) sendToPlayer(actor.id, { type: 'audio_ambience', def: muffled });
  } else {
    // Zone has no ESP connection: silence both variants
    sendToPlayer(actor.id, { type: 'esp_state', active: false });
    if (siren) sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: siren.id });
    if (muffled) sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: muffled.id });
  }
});

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/emergency')) return null;
  if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };

  if (path === '/emergency/state' && method === 'GET') {
    return { status: 200, body: { active: espActive, message: espMessage, zones: [...espZones] } };
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

  return null;
};
