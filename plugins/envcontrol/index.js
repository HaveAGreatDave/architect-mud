// envcontrol — the environmental control panel a high-end flat has on its wall: the flat's lights,
// its climate, and a live picture from the camera over its front door. README.md says why each part
// borrows what it does instead of keeping its own model.
//
// A panel is any furniture row carrying `flags.envctl`:
//   { camera: '<security_devices id>', min_c: 16, max_c: 28, target_c: 21 | null }
// It runs the room it's in and that room's en-suite (the zone behind its `in` exit whose parent is
// the room). `target_c` is the authored setting and the stored one: null is climate off.
//
// Every control is a verb. The screen (client/game/js/panels/envctl.js) only sends these:
//   panel                 the panel's state, and the screen opens on it
//   lights [on|off]       every light in the flat; bare toggles
//   thermostat <°C>|off   hold the flat at a temperature, or stop
//   doorcam               one frame from the camera over the door
import { getZone, getZoneFurniture, getFurnitureById, updateFurniture } from '../../server/engine/world.js';
import { getZonePowerStatus, getZoneTemperature, registerHeatSource, recalcZoneLoad, recomputePower, syncZoneLighting } from '../../server/engine/environment.js';
import { camPatchFrame } from '../surveillance/index.js';

const DEFAULT_MIN = 16, DEFAULT_MAX = 28;
// How fast the plant moves the room, in °C a real minute. A setting you could feel the instant you
// pressed it would read as a cheat; one that took an hour would read as broken.
const RAMP_C_PER_MIN = 1;

const isPanel = (f) => !!f?.flags?.envctl && typeof f.flags.envctl === 'object';
const panelIn = (zoneId) => (getZoneFurniture(zoneId) || []).find(isPanel) || null;

// The en-suite a room owns: behind its `in`, coming back `out`, parented to it. Same test as
// plugins/roomstage `annexOf`, kept local so this plugin doesn't load the Stage.
function annexOf(zoneId) {
  const z = getZone(zoneId), id = z?.exits?.in, inner = id ? getZone(id) : null;
  return inner && inner.parent_zone === zoneId && inner.exits?.out === zoneId ? inner.id : null;
}
// The panel that runs a zone: one in the zone itself, or one in the room the zone is the en-suite of.
function panelFor(zoneId) {
  const own = panelIn(zoneId);
  if (own) return own;
  const parent = getZone(zoneId)?.parent_zone;
  return parent && annexOf(parent) === zoneId ? panelIn(parent) : null;
}
const zonesOf = (panel) => [panel.zone_id, annexOf(panel.zone_id)].filter(Boolean);
const powered = (zoneId) => getZonePowerStatus(zoneId) !== 'unpowered';
const cfg = (panel) => panel.flags.envctl;
const limits = (panel) => [Number(cfg(panel).min_c) || DEFAULT_MIN, Number(cfg(panel).max_c) || DEFAULT_MAX];
const targetOf = (panel) => { const t = Number(cfg(panel).target_c); return Number.isFinite(t) && cfg(panel).target_c !== null ? t : null; };

// ── climate ─────────────────────────────────────────────────────────────────────────────────────
// The plant drives the room toward the setting, both ways: a panel is air conditioning as well as
// heat, unlike a heater (plugins/warmth), which only rescues a cold room. Where it's got to lives in
// RAM: { fromC, at } from the last change. A restart finds the room already at its setting.
const ramps = new Map();   // panel id -> { fromC, at }

function heldAt(panel, baseC) {
  const target = targetOf(panel);
  if (target == null || !powered(panel.zone_id)) return null;
  const r = ramps.get(panel.id);
  if (!r) return target;
  const mins = (Date.now() - r.at) / 60000, gap = target - r.fromC, step = RAMP_C_PER_MIN * mins;
  if (Math.abs(gap) <= step) { ramps.delete(panel.id); return target; }
  return Math.round((r.fromC + Math.sign(gap) * step) * 10) / 10;
}
// Sync and query-free: getZoneTemperature calls it on a per-player hot path.
registerHeatSource((zoneId, baseC) => {
  const panel = panelFor(zoneId);
  if (!panel) return 0;
  const at = heldAt(panel, baseC);
  return at == null ? 0 : at - baseC;
});

// ── lights ──────────────────────────────────────────────────────────────────────────────────────
const lightsOf = (panel) => zonesOf(panel).flatMap((z) => (getZoneFurniture(z) || []).filter((f) => f.object_type === 'light' && f.light_type !== 'streetlight'));

// The four steps applyLightSwitch (server/engine/commands/world.js) takes for one light, for all of them.
async function setLights(panel, on) {
  const want = on ? 1 : 0, changed = new Set();
  for (const l of lightsOf(panel)) {
    if ((l.light_on ? 1 : 0) === want) continue;
    await updateFurniture(l.id, { light_on: want });
    changed.add(l.zone_id);
  }
  for (const z of changed) { syncZoneLighting(z); recalcZoneLoad(z); }
  if (changed.size) await recomputePower().catch(() => {});
  return changed;
}

// ── the door camera ─────────────────────────────────────────────────────────────────────────────
// The camera is a SPECTER device (plugins/surveillance), so jamming, spoofing, a smashed lens and a
// dead grid all show on the panel exactly as they would on a spy-deck.
async function doorFrame(panel) {
  const id = cfg(panel).camera;
  if (!id) return { status: 'none', label: null, frame: null };
  const f = await camPatchFrame(id, null).catch(() => null);
  if (!f) return { status: 'gone', label: null, frame: null };
  return { status: f.status, label: f.label, frame: f.frame };
}

// ── state ───────────────────────────────────────────────────────────────────────────────────────
async function stateOf(panel) {
  const [lo, hi] = limits(panel), lights = lightsOf(panel);
  return {
    type: 'envctl',
    id: panel.id,
    name: panel.name,
    zone: panel.zone_id,
    power: getZonePowerStatus(panel.zone_id),
    lights: lights.map((l) => ({ id: l.id, name: l.name, on: !!l.light_on, zone: l.zone_id })),
    climate: { now: getZoneTemperature(panel.zone_id), target: targetOf(panel), min: lo, max: hi },
    cam: await doorFrame(panel),
  };
}
function summary(s) {
  const lit = s.lights.filter((l) => l.on).length;
  const climate = s.climate.target == null ? 'climate off' : `holding ${s.climate.target}°C`;
  const cam = s.cam.frame ? `door camera: ${s.cam.frame}` : `door camera: ${s.cam.status === 'none' ? 'not fitted' : 'NO SIGNAL'}`;
  return `${s.name}: lights ${lit}/${s.lights.length} on · ${s.climate.now}°C, ${climate}${s.power === 'unpowered' ? ' · NO POWER' : ''}\n${cam}`;
}
// Every verb answers with the panel's whole state, so the screen redraws from the answer.
// Read the row again first: updateFurniture caches a new object, so the one a verb started with is stale.
const reply = async (panel, message) => { const s = await stateOf(getFurnitureById(panel.id) || panel); return { ...s, message: message ?? summary(s) }; };

const noPanel = { type: 'error', message: "There's no control panel here." };

async function cmdPanel(args, raw, player) {
  const panel = panelFor(player.current_zone);
  if (!panel) return noPanel;
  const word = (args[0] || '').toLowerCase();
  // `panel close` is the screen putting itself away; the server keeps nothing open
  if (word === 'close') return { type: 'envctl', id: panel.id, close: true, message: '' };
  const r = await reply(panel);
  // `panel refresh` is the open screen asking again (every few seconds, for the camera): no log line
  if (word === 'refresh') return { ...r, message: '' };
  return { ...r, open: true };
}

async function cmdLights(args, raw, player, broadcast) {
  const panel = panelFor(player.current_zone);
  if (!panel) return noPanel;
  const word = (args[0] || '').toLowerCase();
  if (word && word !== 'on' && word !== 'off') return { type: 'error', message: 'Usage: lights [on|off]' };
  const lights = lightsOf(panel);
  if (!lights.length) return reply(panel, 'The panel has no lights to run.');
  const on = word ? word === 'on' : !lights.some((l) => l.light_on);
  if (on && !powered(panel.zone_id)) return reply(panel, 'The panel shows the lights, greyed out. No power reaches the flat.');
  const changed = await setLights(panel, on);
  if (!changed.size) return reply(panel, `The lights are already ${on ? 'on' : 'off'}.`);
  const seen = on ? 'The lights come up.' : 'The lights go down.';
  if (broadcast) for (const z of changed) broadcast(z, { type: 'zone_event', message: seen, refresh: true }, player.id);
  return reply(panel, on ? 'You bring the lights up.' : 'You take the lights down.');
}

async function cmdThermostat(args, raw, player) {
  const panel = panelFor(player.current_zone);
  if (!panel) return noPanel;
  const [lo, hi] = limits(panel), word = (args[0] || '').toLowerCase().replace(/°?c$/, '');
  if (!word) return reply(panel);
  let target;
  if (word === 'off') target = null;
  else if (word === 'up' || word === 'down') target = (targetOf(panel) ?? Math.round(getZoneTemperature(panel.zone_id))) + (word === 'up' ? 1 : -1);
  else target = Number(word);
  if (target !== null && !Number.isFinite(target)) return { type: 'error', message: `Usage: thermostat <${lo}-${hi}>, up, down or off` };
  if (target !== null) target = Math.max(lo, Math.min(hi, Math.round(target)));
  if (target === targetOf(panel)) return reply(panel, target == null ? 'The climate is already off.' : `It's already set to ${target}°C.`);
  // the room moves from where it is now, not from where the last setting was going
  ramps.set(panel.id, { fromC: getZoneTemperature(panel.zone_id), at: Date.now() });
  await updateFurniture(panel.id, { flags: JSON.stringify({ ...panel.flags, envctl: { ...cfg(panel), target_c: target } }) });
  if (target == null) { ramps.delete(panel.id); return reply(panel, 'You switch the climate off. The flat will drift with the building.'); }
  if (!powered(panel.zone_id)) return reply(panel, `Set to ${target}°C. Nothing's running: no power reaches the flat.`);
  return reply(panel, `You set the flat to ${target}°C. Somewhere in the walls the air starts to move.`);
}

async function cmdDoorcam(args, raw, player) {
  const panel = panelFor(player.current_zone);
  if (!panel) return noPanel;
  const s = await stateOf(panel);
  const line = s.cam.frame ? `[DOOR ▸ ${s.cam.label}] ${s.cam.frame}` : `[DOOR] ${s.cam.status === 'none' ? 'No camera is fitted.' : `NO SIGNAL (${s.cam.status}).`}`;
  return { ...s, message: line };
}

export const commands = { panel: cmdPanel, lights: cmdLights, thermostat: cmdThermostat, doorcam: cmdDoorcam };

export const hooks = {
  // the Room Stage's card: the screen first, so a click on the panel opens it
  'furniture.acts': (f) => (isPanel(f) ? [{ verb: 'panel', bare: true }, { verb: 'lights', bare: true }, { verb: 'doorcam', bare: true }] : undefined),
};

export const _test = { isPanel, panelFor, annexOf, lightsOf, heldAt, targetOf, limits, ramps, stateOf, RAMP_C_PER_MIN };
