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
//   shutters [up|down|<scene>]   the digital shutters over a glass wall, and the scene they show
import { emit } from '../../server/engine/events.js';
import { SCENES, BLINDS_KIND, DRAPES_KIND, scenesOf, findScene, paintOf, hexOf, colourName } from './scenes.js';
import { getZone, getZoneFurniture, getFurnitureById, updateFurniture } from '../../server/engine/world.js';
import { zoneOwnerId } from '../../server/engine/zone-filth.js';
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
  // `zone` is the camera's room: the Room Stage draws it from the camera's eye when it's drawn next door (room-feed.js)
  return { status: f.status, label: f.label, frame: f.frame, zone: f.zoneId };
}

// ── the shutters ────────────────────────────────────────────────────────────────────────────────
// Digital shutters over a room's curtain glass (`flags.room.glass`): slats that come down inside the
// glass and, once down, light up as one display showing a scene (scenes.js). The state is the panel
// row's `flags.envctl.shutters`, { down, scene, level }, written once per change through updateFurniture,
// so it's in RAM (the furniture cache) for every read and survives a restart. The Room Stage asks for it
// with the sync `room.glass` hook when it builds `room_view`, and a change is sent to whoever has the
// room open as `room_glass` (plugins/roomstage, on `room.glassChanged`).
// The blinds (BLINDS_KIND) are the other covering: horizontal Venetian slats instead of the slats, and `level`, the
// per cent of the light they let in, instead of a picture, and `colour`, the cloth's (null is the scene's own blue).
// A sash window fitted with Venetian blinds (`flags.room.blinds`, room-layout.js roomSpecOf) has them and nothing else:
// a scene needs a wall of glass to show on.
const DEFAULT_LEVEL = 50;
const curtainOf = (panel) => { const g = getZone(panel.zone_id)?.flags?.room?.glass; return Array.isArray(g) && g.length > 0; };
// a sash window's drapes (`flags.room.sash.drapes`) can be drawn from the panel too, blinds or not
const sashDrapes = (panel) => { const r = getZone(panel.zone_id)?.flags?.room; return !!r && !r.windowless && !curtainOf(panel) && /^#[0-9a-f]{6}$/i.test(r.sash?.drapes || ''); };
const sashBlinds = (panel) => { const r = getZone(panel.zone_id)?.flags?.room; return (!!r && r.blinds === true && !r.windowless && !curtainOf(panel)) || sashDrapes(panel); };
const hasGlass = (panel) => curtainOf(panel) || sashBlinds(panel);
const isBlinds = (scene) => SCENES[scene]?.kind === BLINDS_KIND;
const isDrapes = (scene) => SCENES[scene]?.kind === DRAPES_KIND;
const offeredOf = (panel) => {
  const all = scenesOf(cfg(panel));
  if (!sashBlinds(panel)) return all;
  const r = getZone(panel.zone_id)?.flags?.room || {};
  const own = all.filter(isBlinds), blinds = r.blinds === true ? (own.length ? own : Object.keys(SCENES).filter(isBlinds)) : [];
  return [...blinds, ...(sashDrapes(panel) ? Object.keys(SCENES).filter(isDrapes) : [])];
};
const levelOf = (n) => Math.max(0, Math.min(100, Math.round(Number(n) / 5) * 5));
// Coverings start closed, so the view out of the window loads behind them and a player opens it when they
// choose. Only a flat with an owner keeps its setting on the panel row; anywhere else (a hotel room, a show
// flat) the setting lives in RAM (`loose`) and goes back to closed on a restart.
const loose = new Map();   // panel id -> { down, scene, level, colour }
const owned = (panel) => zoneOwnerId(panel.zone_id) != null;
function closedOf(offered) {
  const scene = offered.find(isDrapes) || offered.find(isBlinds) || (offered.includes('matte') ? 'matte' : offered[0]);
  return { down: true, scene, level: isBlinds(scene) ? 0 : DEFAULT_LEVEL };
}
function shutOf(panel) {
  const offered = offeredOf(panel);
  const stored = owned(panel) ? cfg(panel).shutters : loose.get(panel.id);
  const s = stored && typeof stored.down === 'boolean' ? stored : { ...closedOf(offered), colour: stored?.colour };
  return { down: !!s.down, scene: offered.includes(s.scene) ? s.scene : offered[0], level: Number.isFinite(Number(s.level)) && s.level !== null ? levelOf(s.level) : DEFAULT_LEVEL, colour: hexOf(s.colour) };
}
// What the Room Stage draws: up or down, the scene and its painter, the blinds' level, and whether there's power to light it.
function glassOf(panel) {
  if (!hasGlass(panel)) return null;
  const s = shutOf(panel);
  return { down: s.down, scene: s.scene, name: SCENES[s.scene].name, level: s.level, colour: s.colour, lit: powered(panel.zone_id), paint: paintOf(s.scene, s.colour) };
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
    lights: lights.map((l) => ({ id: l.id, name: l.name, on: !!l.light_on, zone: l.zone_id, room: getZone(l.zone_id)?.name || null, dim: dimOf(l) })),
    climate: { now: getZoneTemperature(panel.zone_id), target: targetOf(panel), min: lo, max: hi },
    cam: await doorFrame(panel),
    // null where the room has no glass wall to shutter
    // the blinds' swatch is in the colour they've been given
    shutters: hasGlass(panel) ? (() => { const sh = shutOf(panel); return { ...sh, scenes: offeredOf(panel).map((id) => { const pt = paintOf(id, sh.colour); return { id, name: SCENES[id].name, swatch: [pt.a, pt.b, pt.c] }; }) }; })() : null,
  };
}
function summary(s) {
  const lit = s.lights.filter((l) => l.on).length;
  const climate = s.climate.target == null ? 'climate off' : `holding ${s.climate.target}°C`;
  const cam = s.cam.frame ? `door camera: ${s.cam.frame}` : `door camera: ${s.cam.status === 'none' ? 'not fitted' : 'NO SIGNAL'}`;
  const shut = !s.shutters?.down ? '' : isDrapes(s.shutters.scene) ? ' · curtains drawn' : isBlinds(s.shutters.scene) ? ` · blinds drawn, ${s.shutters.level}% light` : ` · shutters down: ${SCENES[s.shutters.scene].name}`;
  return `${s.name}: lights ${lit}/${s.lights.length} on · ${s.climate.now}°C, ${climate}${shut}${s.power === 'unpowered' ? ' · NO POWER' : ''}\n${cam}`;
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
  return { ...r, open: true, greet: greetingFor(panel, player) };
}

// Who the panel says Welcome to when it wakes: whoever woke it, by name (a player's is `handle`; there's no
// `name`, which is why it said "Welcome home" to everybody at first). `owner` is true in your own flat, and the
// screen says "Welcome home" then. RAM only.
function greetingFor(panel, player) {
  const ownerId = zoneOwnerId(panel.zone_id);
  return { name: player.handle || null, owner: ownerId != null && String(ownerId) === String(player.id) };
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

// `dim [<light>] <0-100>`: one light (its number on the panel's list, or a word of its name) or, with
// no light named, all of them, to that level. 0 puts it out; anything above brings it up. The level is
// `flags.dim` on the light's row, and the engine counts a dimmed light's lumens at that share.
const dimOf = (l) => { const d = Number(l.flags?.dim); return Number.isFinite(d) ? Math.max(0, Math.min(100, d)) : 100; };
async function cmdDim(args, raw, player, broadcast) {
  const panel = panelFor(player.current_zone);
  if (!panel) return noPanel;
  const usage = { type: 'error', message: 'Usage: dim [<light>] <0-100>' };
  const level = Math.round(Number(String(args.at(-1) ?? '').replace(/%$/, '')));
  if (!args.length || !Number.isFinite(level) || level < 0 || level > 100) return usage;
  const lights = lightsOf(panel), which = args.slice(0, -1).join(' ').toLowerCase();
  let pick = lights;
  if (which) {
    const n = Number(which);
    pick = Number.isInteger(n) ? [lights[n - 1]].filter(Boolean) : lights.filter((l) => l.name.toLowerCase().includes(which));
    if (!pick.length) return reply(panel, `The panel has no light called "${which}".`);
  }
  if (level > 0 && !powered(panel.zone_id)) return reply(panel, 'The panel shows the lights, greyed out. No power reaches the flat.');
  const changed = new Set();
  for (const l of pick) {
    const on = level > 0 ? 1 : 0;
    if ((l.light_on ? 1 : 0) === on && (on === 0 || dimOf(l) === level)) continue;
    const patch = { light_on: on };
    // off keeps the level it was at, so it comes back where you left it
    if (on) patch.flags = JSON.stringify({ ...(l.flags || {}), dim: level });
    await updateFurniture(l.id, patch);
    changed.add(l.zone_id);
  }
  for (const z of changed) { syncZoneLighting(z); recalcZoneLoad(z); }
  if (changed.size) await recomputePower().catch(() => {});
  if (broadcast) for (const z of changed) broadcast(z, { type: 'zone_event', message: level ? 'The light in the room changes.' : 'A light goes out.', refresh: true }, player.id);
  const what = pick.length === 1 ? `the ${pick[0].name}` : 'the lights';
  return reply(panel, level ? `You set ${what} to ${level}%.` : `You put out ${what}.`);
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

// `shutters` toggles them; `up` and `down` say which; a scene's name brings them down showing it. A number is the
// blinds' light level, per cent: `shutters blinds 40`, or `shutters 40` alone, which draws the blinds too. `shutters colour
// <#rrggbb>` colours the blinds' cloth (the panel's colour wheel sends it), and draws them too.
// ⚠ `shutters` IS STOREFRONT'S VERB TOO: a shop's roller shutter. The loader keeps one handler per verb and the
// later plugin's wins, so this one loads after storefront (plugin.json `after`), answers in a room a panel runs,
// and hands every other `shutters` to storefront's own handler. Until 2026-11-12 it was the other way round, and
// every press on the panel's Shutters page came back "There's no shop unit here."
async function shopShutters(args, raw, player, broadcast) {
  const shop = await import('../storefront/index.js').catch(() => null);
  return shop?.commands?.shutters ? shop.commands.shutters(args, raw, player, broadcast) : noPanel;
}
const UP = new Set(['up', 'raise', 'open']), DOWN = new Set(['down', 'lower', 'close', 'shut']);
async function cmdShutters(args, raw, player, broadcast) {
  let panel = panelFor(player.current_zone);
  if (!panel) return shopShutters(args, raw, player, broadcast);
  if (!hasGlass(panel)) return reply(panel, "There's no glass wall here to put shutters over.");
  let words = args.map((w) => String(w).toLowerCase());
  const was = shutOf(panel), offered = offeredOf(panel);
  const blindsId = offered.find(isBlinds) || null;
  // `colour <#rrggbb>` anywhere in it; the rest may only name the blinds
  const ci = words.findIndex((w) => w === 'colour' || w === 'color');
  let colour = was.colour;
  if (ci >= 0) {
    colour = hexOf(words[ci + 1]);
    words = words.filter((_, i) => i !== ci && i !== ci + 1);
    if (!blindsId || !colour || words.some((w) => !/^\d{1,3}%?$/.test(w) && !isBlinds(findScene(w, offered)))) return { type: 'error', message: 'Usage: shutters colour <#rrggbb>, a colour for the blinds.' };
  }
  const num = words.length && /^\d{1,3}%?$/.test(words[words.length - 1]) ? Number(words.pop().replace('%', '')) : null;
  const word = words.join(' ').trim();
  const usage = { type: 'error', message: `Usage: shutters [up|down|<scene>]${blindsId ? ', shutters blinds <0-100> or shutters colour <#rrggbb>' : ''}. Scenes: ${offered.map((id) => SCENES[id].name).join(', ')}.` };
  let down, scene = was.scene, level = was.level;
  if (ci >= 0) {
    scene = blindsId; down = true;
    if (num !== null) level = levelOf(num);
  } else if (num !== null) {
    if (word && !isBlinds(findScene(word, offered))) return usage;
    if (!blindsId) return usage;
    scene = blindsId; down = true; level = levelOf(num);
  } else if (!word) down = !was.down;
  else if (UP.has(word)) down = false;
  else if (DOWN.has(word)) down = true;
  else {
    scene = findScene(word, offered);
    if (!scene) return usage;
    down = true;
  }
  const blinds = isBlinds(scene), drapes = isDrapes(scene), name = SCENES[scene].name;
  const recoloured = colour !== was.colour, cname = colourName(paintOf(blindsId || scene, colour).b);
  if (down === was.down && scene === was.scene && (!blinds || (level === was.level && !recoloured))) {
    if (!down) return reply(panel, sashBlinds(panel) ? 'The window is already clear.' : 'The shutters are already up.');
    if (drapes) return reply(panel, 'The curtains are already drawn.');
    return reply(panel, blinds ? `The blinds are already drawn, letting in ${level}% of the light.` : `The shutters are already down, showing ${name}.`);
  }
  // drapes are pulled by hand, so they open and close with the power off
  const byHand = drapes || (!down && was.down && isDrapes(was.scene));
  if (!byHand && !powered(panel.zone_id)) return reply(panel, 'The shutter controls are greyed out. No power reaches the flat.');
  if (owned(panel)) await updateFurniture(panel.id, { flags: JSON.stringify({ ...panel.flags, envctl: { ...cfg(panel), shutters: { down, scene, level, colour } } }) });
  else loose.set(panel.id, { down, scene, level, colour });
  panel = panelFor(player.current_zone) || panel;
  emit('room.glassChanged', { zoneId: panel.zone_id, glass: glassOf(panel) });
  const wasBlinds = was.down && isBlinds(was.scene), wasDrapes = was.down && isDrapes(was.scene);
  let mine, seen;
  if (!down && wasDrapes) { mine = 'You open the curtains and tie them back.'; seen = 'The curtains are opened.'; }
  else if (drapes) { mine = wasBlinds ? 'You draw the blinds back and pull the curtains across.' : 'You draw the curtains across the window.'; seen = 'The curtains are drawn across the window.'; }
  else if (!down && wasBlinds) { mine = 'You draw the blinds back.'; seen = 'The blinds are drawn back from the glass.'; }
  else if (!down) { mine = 'You raise the shutters. The slats fold away into the head of the glass.'; seen = 'The shutters over the glass go up.'; }
  else if (blinds && wasBlinds && recoloured) { mine = `You change the blinds to ${cname}.`; seen = `The blinds change to ${cname}.`; }
  else if (blinds && wasBlinds) { mine = level ? `You turn the blinds to let in ${level}% of the light.` : 'You turn the blinds shut.'; seen = 'The blinds turn.'; }
  else if (blinds) { mine = `You draw ${cname} blinds across the glass, tilted to let in ${level}% of the light.`; seen = `${cname[0].toUpperCase()}${cname.slice(1)} blinds are drawn across the glass.`; }
  else if (!was.down || wasBlinds) { mine = `You lower the shutters. Slats close over the glass and light up: ${name}. ${SCENES[scene].shows}`; seen = `The shutters come down over the glass and light up: ${name}.`; }
  else { mine = `You change the shutters to ${name}. ${SCENES[scene].shows}`; seen = `The shutters change to ${name}.`; }
  if (broadcast) broadcast(panel.zone_id, { type: 'zone_event', message: seen }, player.id);
  return reply(panel, mine);
}

// `blinds` is `shutters` said the way you'd say it at a window: bare toggles them, `up` draws them back, `down`
// draws them at the level they were, a number turns them to that much light, `colour <#rrggbb>` recolours them.
async function cmdBlinds(args, raw, player, broadcast) {
  const panel = panelFor(player.current_zone);
  if (!panel) return noPanel;
  if (!hasGlass(panel) || !offeredOf(panel).some(isBlinds)) return reply(panel, "There are no blinds here.");
  const words = args.map((w) => String(w).toLowerCase()), w = words[0] || '', s = shutOf(panel);
  const drawn = s.down && isBlinds(s.scene);
  let to;
  if (!w) to = drawn ? ['up'] : ['blinds'];
  else if (UP.has(w)) to = ['up'];
  else if (DOWN.has(w)) to = ['blinds'];
  else if (w === 'colour' || w === 'color' || /^\d{1,3}%?$/.test(w)) to = words;
  else return { type: 'error', message: 'Usage: blinds [up|down|<0-100>|colour <#rrggbb>]' };
  return cmdShutters(to, raw, player, broadcast);
}

// `curtains` draws a sash window's drapes: bare toggles them, `close` or `draw` pulls them across, `open` ties them back.
async function cmdCurtains(args, raw, player, broadcast) {
  const panel = panelFor(player.current_zone);
  if (!panel) return noPanel;
  if (!hasGlass(panel) || !offeredOf(panel).some(isDrapes)) return reply(panel, 'There are no curtains here.');
  const w = String(args[0] || '').toLowerCase(), s = shutOf(panel), drawn = s.down && isDrapes(s.scene);
  let to;
  if (!w) to = drawn ? ['up'] : ['curtains'];
  else if (UP.has(w)) to = ['up'];
  else if (DOWN.has(w) || w === 'draw') to = ['curtains'];
  else return { type: 'error', message: 'Usage: curtains [open|close]' };
  return cmdShutters(to, raw, player, broadcast);
}

export const commands = { panel: cmdPanel, lights: cmdLights, dim: cmdDim, thermostat: cmdThermostat, doorcam: cmdDoorcam, shutters: cmdShutters, blinds: cmdBlinds, curtains: cmdCurtains };

export const hooks = {
  // the Room Stage's card: the screen first, so a click on the panel opens it
  // (a sash window's line is Blinds: it has nothing else)
  'furniture.acts': (f) => (isPanel(f) ? [{ verb: 'panel', bare: true }, { verb: 'lights', bare: true }, { verb: 'doorcam', bare: true }, ...(hasGlass(f) && offeredOf(f).some((id) => !isDrapes(id)) ? [{ verb: sashBlinds(f) ? 'blinds' : 'shutters', bare: true }] : []), ...(hasGlass(f) && offeredOf(f).some(isDrapes) ? [{ verb: 'curtains', bare: true }] : [])] : undefined),
  // ⚠ SYNC: the Room Stage gathers it building `room_view`. The glass of a room whose panel runs it.
  'room.glass': (zoneId) => { const p = panelIn(zoneId); return p ? glassOf(p) ?? undefined : undefined; },
};

export const _test = { owned, isPanel, panelFor, annexOf, lightsOf, heldAt, targetOf, limits, ramps, stateOf, RAMP_C_PER_MIN, hasGlass, sashBlinds, sashDrapes, offeredOf, shutOf, glassOf, levelOf };
