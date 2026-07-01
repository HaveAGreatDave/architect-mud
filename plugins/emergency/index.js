import { query } from '../../server/models/db.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getAmbientDefByName } from '../audio/index.js';

const DEFAULT_MESSAGE =
  '⚠ EMERGENCY SECURITY PROTOCOL ACTIVE — ALL CIVILIANS SHELTER IN PLACE IMMEDIATELY — ARMED RESPONSE UNITS ARE DEPLOYED — THIS IS NOT A DRILL — STAY INDOORS AND AWAIT FURTHER INSTRUCTIONS ⚠';

let espActive  = false;
let espMessage = DEFAULT_MESSAGE;
let espZones   = new Set(); // zone_ids that have at least one streetlight
let espTicker  = null;      // setInterval handle for 10-second warning loop

function sirenDef() {
  return getAmbientDefByName('amb_emergency_siren');
}

async function loadStreetlightZones() {
  const { rows } = await query(
    `SELECT DISTINCT zone_id FROM furniture WHERE light_type = 'streetlight'`
  );
  espZones = new Set(rows.map(r => r.zone_id));
}

function broadcastToEspZones(msg) {
  for (const zoneId of espZones) sendToZone(zoneId, msg);
}

async function activate(message) {
  if (espActive) return;
  if (message) espMessage = message;
  await loadStreetlightZones();

  const siren = sirenDef();
  for (const zoneId of espZones) {
    sendToZone(zoneId, { type: 'esp_state', active: true, message: espMessage });
    if (siren) sendToZone(zoneId, { type: 'audio_ambience', def: siren });
  }

  espTicker = setInterval(() => {
    broadcastToEspZones({ type: 'esp_warning', message: espMessage });
  }, 10_000);

  espActive = true;
}

function deactivate() {
  if (!espTicker && !espActive) return;
  clearInterval(espTicker);
  espTicker = null;

  const siren = sirenDef();
  for (const zoneId of espZones) {
    sendToZone(zoneId, { type: 'esp_state', active: false });
    if (siren) sendToZone(zoneId, { type: 'audio_stop', scope: 'ambience', id: siren.id });
  }

  espActive = false;
  espZones.clear();
}

// Catch players moving into or out of streetlight zones while ESP is active.
on('zone.entered', ({ actor, zone: zoneId }) => {
  if (!espActive) return;
  const siren = sirenDef();
  if (espZones.has(zoneId)) {
    sendToPlayer(actor.id, { type: 'esp_state', active: true, message: espMessage });
    if (siren) sendToPlayer(actor.id, { type: 'audio_ambience', def: siren });
  } else {
    sendToPlayer(actor.id, { type: 'esp_state', active: false });
    if (siren) sendToPlayer(actor.id, { type: 'audio_stop', scope: 'ambience', id: siren.id });
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
