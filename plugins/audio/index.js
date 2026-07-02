import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, getZonePlayers, getLivePlayer } from '../../server/engine/world.js';
import { neighborZoneIds } from '../../server/engine/exits.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { propagateAudio } from '../../server/engine/sounds.js';
import { getZonePrecip, getCurrentPrecipType, getWindKph } from '../../server/engine/environment.js';

// ── In-memory library cache (loaded from DB at boot, refreshed after CRUD) ──

const instruments = new Map(); // id -> row
const songs = new Map();       // id -> row
const sfx = new Map();         // id -> row
const ambient = new Map();     // id -> row
const samples = new Map();     // id -> row (without data column)
const eventRoutes = new Map(); // event_name -> row[]

// name -> id, so event handlers below can reference assets by human name
// without hardcoding ids. Falls back to no-op if the named asset isn't seeded.
const byName = { sfx: new Map(), songs: new Map(), ambient: new Map() };

const SAMPLE_META_COLS = 'id,name,category,priority,mime_type,base_note,loop_start,loop_end,snes_rate,snes_bits,echo_mix,config,enabled';

export async function loadAudioLibrary() {
  const [i, s, fx, am, ev, sm] = await Promise.all([
    query('SELECT * FROM audio_instruments'),
    query('SELECT * FROM audio_songs'),
    query('SELECT * FROM audio_sfx'),
    query('SELECT * FROM audio_ambient'),
    query('SELECT * FROM audio_event_routes WHERE enabled=1'),
    query(`SELECT ${SAMPLE_META_COLS} FROM audio_samples`),
  ]);
  instruments.clear();
  for (const row of i.rows) instruments.set(row.id, row);
  songs.clear();
  byName.songs.clear();
  for (const row of s.rows) { songs.set(row.id, row); byName.songs.set(row.name, row.id); }
  sfx.clear();
  byName.sfx.clear();
  for (const row of fx.rows) { sfx.set(row.id, row); byName.sfx.set(row.name, row.id); }
  ambient.clear();
  byName.ambient.clear();
  for (const row of am.rows) { ambient.set(row.id, row); byName.ambient.set(row.name, row.id); }
  eventRoutes.clear();
  for (const row of ev.rows) {
    const arr = eventRoutes.get(row.event_name) || [];
    arr.push(row);
    eventRoutes.set(row.event_name, arr);
  }
  samples.clear();
  for (const row of sm.rows) samples.set(row.id, row);
}

await loadAudioLibrary().catch(e => console.error('[audio] failed to load library:', e.message));

function sfxByName(name) {
  const id = byName.sfx.get(name);
  return id ? sfx.get(id) : null;
}
function songByName(name) {
  const id = byName.songs.get(name);
  return id ? songs.get(id) : null;
}
function ambientByName(name) {
  const id = byName.ambient.get(name);
  return id ? ambient.get(id) : null;
}

// Looked up by other plugins (e.g. broadcast) that need to trigger a song by
// its human name without owning a DB query of their own.
export function getSongDefByName(name) {
  const song = name ? songByName(name) : null;
  return song ? resolveSongInstruments(song) : null;
}
export function getSfxDefByName(name) { return name ? sfxByName(name) : null; }
export function getAmbientDefByName(name) { return name ? ambientByName(name) : null; }

// ── Event route helper ────────────────────────────────────────────────────
// Checks audio_event_routes for the given event name and dispatches the
// configured SFX / ambient / song to the appropriate target. Returns true if
// a route was found (so callers can skip their hardcoded fallback).

function triggerEventRoute(eventName, zoneId, playerId) {
  const routes = eventRoutes.get(eventName);
  if (!routes?.length) return false;
  const route = routes[Math.floor(Math.random() * routes.length)];
  const usePlayer = route.scope === 'player';
  const target = usePlayer ? playerId : zoneId;
  if (!target) return false;
  const send = usePlayer ? sendToPlayer : sendToZone;
  if (route.sfx_id) {
    const def = sfx.get(route.sfx_id);
    if (def) send(target, { type: 'audio_sfx', def });
  }
  if (route.sample_id) {
    const def = samples.get(route.sample_id);
    if (def) send(target, { type: 'audio_sample', def });
  }
  if (route.ambient_id) {
    const def = ambient.get(route.ambient_id);
    if (def) send(target, { type: 'audio_ambience', def });
  }
  if (route.song_id) {
    const song = songs.get(route.song_id);
    if (song) send(target, { type: 'audio_music', def: resolveSongInstruments(song) });
  }
  return true;
}

// ── Event wiring — server decides what plays, client just renders it ───────

function resolveSongInstruments(song) {
  const ids = Array.isArray(song.instrument_ids) ? song.instrument_ids : [];
  const _instrumentsById = {};
  for (const id of ids) {
    const row = instruments.get(id);
    if (!row) continue;
    const inst = { ...row };
    if (inst.sample_id) {
      const sampleDef = samples.get(inst.sample_id);
      if (sampleDef) inst._sampleDef = sampleDef;
    }
    _instrumentsById[id] = inst;
  }
  return { ...song, _instrumentsById };
}

on('player.login', ({ id }) => {
  const routes = eventRoutes.get('player.login');
  console.log(`[audio] player.login fired for ${id} — routes:`, routes?.length ?? 0, routes?.map(r => `scope=${r.scope} sfx=${r.sfx_id} sample=${r.sample_id}`));
  triggerEventRoute('player.login', null, id);
  // zone.entered only fires on movement, so a freshly-connected player would
  // hear no weather bed until their first step. Start it now, at connect.
  reconcilePlayerWeatherAmbient(id, getLivePlayer(id)?.current_zone);
});

on('player.logout', ({ id }) => {
  triggerEventRoute('player.logout', null, id);
});

on('zone.entered', ({ actor, zone: zoneId }) => {
  reconcilePlayerWeatherAmbient(actor?.id, zoneId);
  reconcileIndustrialAmbient(actor?.id, zoneId).catch(() => {});
  if (triggerEventRoute(`zone.entered.${zoneId}`, zoneId, actor?.id)) return;
  if (triggerEventRoute('zone.entered', zoneId, actor?.id)) return;
  const zone = getZone(zoneId);
  if (!zone?.audio_theme_id) return;
  const song = songs.get(zone.audio_theme_id);
  if (!song) return;
  sendToZone(zoneId, { type: 'audio_music', def: resolveSongInstruments(song) });
  emit('audio.music.changed', { zoneId, songId: song.id });
});

function critBoost(def) {
  if (!def) return null;
  function boostLayer(layer) {
    return {
      ...layer,
      gain: (layer.gain ?? 1) * 1.6,
      adsr: { ...(layer.adsr || { a: 0.01, d: 0.05, s: 0.7, r: 0.15 }), a: 0.002, r: 0.35 },
      echo: { mix: 0.45, delay: 0.11, feedback: 0.42 },
      fm: layer.fm ?? { rate: 60, depth: 180 },
    };
  }
  const config = def.config || {};
  const boosted = Array.isArray(config.layers)
    ? { ...config, layers: config.layers.map(boostLayer) }
    : boostLayer(config);
  return { ...def, config: boosted };
}

on('enemy.attacked', ({ actor, critical }) => {
  if (!critical) return;
  const zoneId = actor?.current_zone;
  if (!zoneId) return;
  if (!triggerEventRoute('enemy.attacked', zoneId, actor?.id)) {
    const def = critBoost(sfxByName('combat_hit'));
    if (def) sendToZone(zoneId, { type: 'audio_sfx', def });
  }
});

on('enemy.killed', ({ actor }) => {
  const zoneId = actor?.current_zone;
  if (!zoneId) return;
  if (!triggerEventRoute('enemy.killed', zoneId, actor?.id)) {
    const def = sfxByName('combat_death');
    if (def) sendToZone(zoneId, { type: 'audio_sfx', def });
  }
  if (actor?.current_zone) emit('audio.sfx.triggered', { zoneId: actor.current_zone });
});

on('player.death', ({ player }) => {
  if (!triggerEventRoute('player.death', player?.current_zone, player?.id)) {
    const def = sfxByName('combat_death');
    if (def && player?.id) sendToPlayer(player.id, { type: 'audio_sfx', def });
  }
  // Death yanks you to the clone vat without firing zone.entered, so the ambient
  // loops (music + weather + industrial bed) from the zone you died in would
  // keep droning in the new one. current_zone is already the respawn zone by the
  // time this fires — re-establish audio for it: kill the old bed, start the
  // right one. The reconcile helpers stop every non-desired loop themselves.
  if (!player?.id || !player.current_zone) return;
  const zoneId = player.current_zone;
  const song = getZone(zoneId)?.audio_theme_id ? songs.get(getZone(zoneId).audio_theme_id) : null;
  if (song) sendToPlayer(player.id, { type: 'audio_music', def: resolveSongInstruments(song) });
  else sendToPlayer(player.id, { type: 'audio_stop', scope: 'music' });
  reconcilePlayerWeatherAmbient(player.id, zoneId);
  reconcileIndustrialAmbient(player.id, zoneId).catch(() => {});
});

// ── Clone-vat respawn SFX ─────────────────────────────────────────────────────
// Inline synth defs — no DB row needed.

const SFX_VAT_DRAIN = {
  id: 'sfx_vat_drain', name: 'sfx_vat_drain', category: 'sfx', priority: 8,
  config: {
    duration: 1.6,
    layers: [
      { noiseMix: 1, filter: { type: 'bandpass', freq: 1800, q: 0.7 }, adsr: { a: 0.08, d: 0.4, s: 0.6, r: 0.8 }, gain: 0.45 },
      { waveform: 'sine', freq: 55, pitchBend: { to: 30, time: 1.5 }, adsr: { a: 0.05, d: 0.3, s: 0.5, r: 0.7 }, gain: 0.3 },
      { noiseMix: 0.8, filter: { type: 'highpass', freq: 3500, q: 1.5 }, adsr: { a: 0.02, d: 0.6, s: 0.2, r: 0.6 }, gain: 0.15 },
    ],
  },
};

const SFX_VAT_BOOT = {
  id: 'sfx_vat_boot', name: 'sfx_vat_boot', category: 'sfx', priority: 8,
  config: {
    duration: 1.2,
    layers: [
      { waveform: 'sawtooth', freq: 60, pitchBend: { to: 220, time: 1.0 }, filter: { type: 'lowpass', freq: 1200, q: 1.2 }, adsr: { a: 0.15, d: 0.2, s: 0.8, r: 0.5 }, gain: 0.4 },
      { waveform: 'sine', freq: 40, pitchBend: { to: 80, time: 0.8 }, adsr: { a: 0.1, d: 0.3, s: 0.7, r: 0.4 }, gain: 0.35 },
      { noiseMix: 0.6, filter: { type: 'bandpass', freq: 900, q: 2.5 }, tremolo: { rate: 22, depth: 0.9 }, adsr: { a: 0.05, d: 0.1, s: 0.6, r: 0.3 }, gain: 0.18 },
    ],
  },
};

const SFX_VAT_OPEN = {
  id: 'sfx_vat_open', name: 'sfx_vat_open', category: 'sfx', priority: 9,
  config: {
    duration: 0.5,
    layers: [
      { waveform: 'sine', freq: 48, adsr: { a: 0.001, d: 0.18, s: 0, r: 0.2 }, gain: 0.9 },
      { noiseMix: 1, filter: { type: 'highpass', freq: 800 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.06 }, gain: 0.7 },
      { waveform: 'sine', freq: 320, adsr: { a: 0.001, d: 0.08, s: 0, r: 0.38 }, gain: 0.2 },
    ],
  },
};

const SFX_VAT_CHIME = {
  id: 'sfx_vat_chime', name: 'sfx_vat_chime', category: 'sfx', priority: 9,
  config: {
    duration: 0.9,
    layers: [
      { waveform: 'triangle', freq: 523.25, adsr: { a: 0.002, d: 0.1, s: 0.6, r: 0.7 }, gain: 0.6 },
      { waveform: 'sine', freq: 783.99, adsr: { a: 0.001, d: 0.08, s: 0.4, r: 0.75 }, gain: 0.35 },
      { waveform: 'sine', freq: 1046.5, adsr: { a: 0.001, d: 0.05, s: 0.2, r: 0.8 }, gain: 0.18 },
    ],
  },
};

on('player.respawn', ({ player }) => {
  if (!player?.id) return;
  const id = player.id;
  sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_DRAIN });
  setTimeout(() => sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_BOOT  }), 900);
  setTimeout(() => sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_OPEN  }), 1800);
  setTimeout(() => sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_CHIME }), 2100);
});

// ── Ghost-mode audio ───────────────────────────────────────────────────────
// Inline synth defs — no DB row needed. Deliberately quiet: an unseen presence
// should be felt more than heard.

// Subtle "something is here" — a breathy swell over a low sub and a faint high
// shimmer. Low gains keep it under the ambient bed rather than announcing itself.
const SFX_GHOST_WHISPER = {
  id: 'sfx_ghost_whisper', name: 'sfx_ghost_whisper', category: 'sfx', priority: 3,
  config: {
    duration: 1.8,
    layers: [
      { noiseMix: 1, filter: { type: 'bandpass', freq: 1200, q: 0.8 }, adsr: { a: 0.6, d: 0.5, s: 0.3, r: 0.9 }, gain: 0.09 },
      { waveform: 'sine', freq: 70, pitchBend: { to: 52, time: 1.8 }, adsr: { a: 0.5, d: 0.4, s: 0.4, r: 0.8 }, gain: 0.06 },
      { waveform: 'sine', freq: 2100, tremolo: { rate: 6, depth: 0.7 }, adsr: { a: 0.4, d: 0.6, s: 0.2, r: 0.7 }, gain: 0.03 },
    ],
  },
};

// Power drain — mains hum sagging and dying, a sub drop, and an electrical
// fizzle tail. Descending pitch mirrors the lights fading to black.
const SFX_POWER_DRAIN = {
  id: 'sfx_power_drain', name: 'sfx_power_drain', category: 'sfx', priority: 6,
  config: {
    duration: 2.2,
    layers: [
      { waveform: 'sawtooth', freq: 120, pitchBend: { to: 18, time: 2.0 }, filter: { type: 'lowpass', freq: 900, q: 1.0 }, adsr: { a: 0.05, d: 0.4, s: 0.6, r: 1.0 }, gain: 0.22 },
      { waveform: 'sine', freq: 80, pitchBend: { to: 25, time: 2.0 }, adsr: { a: 0.05, d: 0.3, s: 0.5, r: 0.9 }, gain: 0.18 },
      { noiseMix: 0.7, filter: { type: 'highpass', freq: 3000, q: 1.2 }, adsr: { a: 0.02, d: 0.8, s: 0.15, r: 0.8 }, gain: 0.08 },
    ],
  },
};

// A ghost's actions build an "unseen presence" — but a sound on every single one
// would be constant noise, so only every Nth action rings out. Designers can
// override the sound with an event route named 'ghost.ambient'; otherwise the
// inline whisper plays. Counter is global across ghosts (rare to have several).
let _ghostActionCount = 0;
const GHOST_AMBIENT_EVERY = 5;

// Power-up — a turbine/motor spinning up, mains hum settling in, a breaker
// clunk and an electrical crackle. The industrial inverse of SFX_POWER_DRAIN.
const SFX_POWER_UP = {
  id: 'sfx_power_up', name: 'sfx_power_up', category: 'sfx', priority: 6,
  config: {
    duration: 1.8,
    layers: [
      { waveform: 'sawtooth', freq: 24, pitchBend: { to: 120, time: 1.4 }, filter: { type: 'lowpass', freq: 1000, q: 1.1 }, adsr: { a: 0.2, d: 0.3, s: 0.85, r: 0.5 }, gain: 0.24 },
      { waveform: 'sine', freq: 30, pitchBend: { to: 60, time: 1.2 }, adsr: { a: 0.15, d: 0.3, s: 0.8, r: 0.5 }, gain: 0.20 },
      { noiseMix: 1, filter: { type: 'bandpass', freq: 220, q: 3 }, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.08 }, gain: 0.5 },
      { noiseMix: 0.6, filter: { type: 'highpass', freq: 3200, q: 1.2 }, tremolo: { rate: 18, depth: 0.8 }, adsr: { a: 0.1, d: 0.4, s: 0.3, r: 0.5 }, gain: 0.08 },
    ],
  },
};

// ── Industrial room ambience ──────────────────────────────────────────────
// Looping beds distinct per room: the power station roars, utility rooms hum.
// Only play while the device is live — a smashed/blacked-out room falls silent.

// Power station / turbine hall: a deep, cavernous turbine roar — plus randomized
// machine chatter (relay clunks, telemetry beeps, gauge chirps, breaker ticks)
// scheduled over the top so the room breathes instead of sitting on flat static.
const AMB_POWER_STATION = {
  id: 'amb_power_station', name: 'amb_power_station', category: 'ambient', priority: 2,
  config: { gain: 0.6, layers: [
    // Turbine bed: two detuned saws beating against each other give a slow,
    // uneven throb no single tremolo LFO can fake.
    { waveform: 'sawtooth', freq: 42, filter: { type: 'lowpass', freq: 320, q: 0.9 }, tremolo: { rate: 3.5, depth: 0.25 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.32 },
    { waveform: 'sawtooth', freq: 41.3, filter: { type: 'lowpass', freq: 300, q: 0.9 }, tremolo: { rate: 2.7, depth: 0.2 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.22 },
    { waveform: 'sine', freq: 28, vibrato: { rate: 0.15, depth: 3 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.35 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 900, q: 0.7 }, tremolo: { rate: 6, depth: 0.15 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.22 },
    // Faint whine of spinning steel, drifting.
    { waveform: 'sine', freq: 220, vibrato: { rate: 0.3, depth: 6 }, tremolo: { rate: 0.4, depth: 0.3 }, adsr: { a: 3, d: 0, s: 0.5, r: 3 }, gain: 0.05 },
  ], sparkle: [
    // Telemetry beep — a clean console blip, occasionally a double-tap feel via jitter.
    { everyMin: 3.5, everyMax: 9, prob: 0.85, gain: 0.11, duration: 0.05, jitter: 0.18, layers: [
      { waveform: 'square', freq: 1320, adsr: { a: 0.002, d: 0.03, s: 0, r: 0.03 }, filter: { type: 'bandpass', freq: 1320, q: 4 } },
    ] },
    // Relay / breaker clunk — noise-tick through a low body, a physical thunk.
    { everyMin: 6, everyMax: 16, prob: 0.8, gain: 0.16, duration: 0.09, jitter: 0.1, layers: [
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 180, q: 2.5 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.05 }, gain: 0.9 },
      { waveform: 'sine', freq: 90, pitchBend: { to: 55, time: 0.08 }, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.04 }, gain: 0.6 },
    ] },
    // Gauge chirp — a tiny rising two-tone, like a needle pegging.
    { everyMin: 8, everyMax: 20, prob: 0.7, gain: 0.07, duration: 0.12, jitter: 0.14, layers: [
      { waveform: 'square', freq: 880, pitchBend: { to: 1180, time: 0.1 }, adsr: { a: 0.003, d: 0.09, s: 0.1, r: 0.04 }, filter: { type: 'bandpass', freq: 1000, q: 3 } },
    ] },
    // Deep steam/valve hiss release — sparse, adds unease.
    { everyMin: 14, everyMax: 34, prob: 0.75, gain: 0.09, duration: 0.5, jitter: 0.05, layers: [
      { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2600, q: 0.8 }, adsr: { a: 0.05, d: 0.25, s: 0.2, r: 0.35 }, gain: 0.5 },
    ] },
  ] },
};
// Utility / power room: a tidy 60 Hz mains hum with a faint electrical fizz, plus
// sparse data-beeps and capacitor ticks — quieter and tidier than the plant.
const AMB_UTILITY_ROOM = {
  id: 'amb_utility_room', name: 'amb_utility_room', category: 'ambient', priority: 2,
  config: { gain: 0.4, layers: [
    { waveform: 'sine', freq: 60, adsr: { a: 1.5, d: 0, s: 1, r: 1.5 }, gain: 0.30 },
    { waveform: 'sawtooth', freq: 120, filter: { type: 'lowpass', freq: 640, q: 1.0 }, tremolo: { rate: 12, depth: 0.15 }, adsr: { a: 1.5, d: 0, s: 1, r: 1.5 }, gain: 0.10 },
    // Faint dielectric fizz — pulled well back and softened so it shimmers under
    // the hum instead of rasping over it (the old "static").
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 4200, q: 1.4 }, tremolo: { rate: 22, depth: 0.25 }, adsr: { a: 2, d: 0, s: 0.35, r: 2 }, gain: 0.018 },
  ], sparkle: [
    // Capacitor / relay tick — dry, small, and now sparser so it doesn't clatter.
    { everyMin: 6, everyMax: 15, prob: 0.65, gain: 0.07, duration: 0.04, jitter: 0.12, layers: [
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 3200, q: 3 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, gain: 0.7 },
    ] },
    // Panel data-beep — softer and higher than the plant's telemetry.
    { everyMin: 7, everyMax: 18, prob: 0.7, gain: 0.06, duration: 0.05, jitter: 0.2, layers: [
      { waveform: 'square', freq: 1760, adsr: { a: 0.002, d: 0.035, s: 0, r: 0.03 }, filter: { type: 'bandpass', freq: 1760, q: 5 } },
    ] },
    // Electric arc twinkle — a bright bandpassed ping with a quick upward flick;
    // the little crystalline "spark" that gives the box life.
    { everyMin: 3, everyMax: 8, prob: 0.9, gain: 0.05, duration: 0.14, jitter: 0.16, layers: [
      { waveform: 'sine', freq: 2637, pitchBend: { to: 3136, time: 0.05 }, adsr: { a: 0.001, d: 0.11, s: 0, r: 0.04 }, filter: { type: 'bandpass', freq: 2800, q: 3 }, gain: 0.9 },
      { waveform: 'square', freq: 5274, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, filter: { type: 'bandpass', freq: 5274, q: 6 }, gain: 0.25 },
    ] },
    // Crystal chime — two sine partials an octave apart, a soft bell ringing off
    // in the distance. Sparse and pretty.
    { everyMin: 9, everyMax: 22, prob: 0.7, gain: 0.045, duration: 0.55, jitter: 0.1, layers: [
      { waveform: 'sine', freq: 1568, adsr: { a: 0.002, d: 0.4, s: 0.1, r: 0.4 }, gain: 0.8 },
      { waveform: 'sine', freq: 3136, adsr: { a: 0.002, d: 0.28, s: 0, r: 0.3 }, gain: 0.3 },
    ] },
    // Rising shimmer — a faint glassy sweep upward, the sparkle's tail.
    { everyMin: 12, everyMax: 28, prob: 0.6, gain: 0.035, duration: 0.22, jitter: 0.14, layers: [
      { waveform: 'sine', freq: 3136, pitchBend: { to: 4699, time: 0.18 }, adsr: { a: 0.02, d: 0.14, s: 0.1, r: 0.08 }, filter: { type: 'bandpass', freq: 3800, q: 2 } },
    ] },
  ] },
};
// The turbine roar leaking through the wall to an adjacent tile: the same bed
// pulled well back and stripped of its close-up machine chatter (the telemetry
// beeps and relay clunks don't carry outside). A muffled distant drone.
// NB: config.gain isn't applied to looping beds (only per-layer gain is), so the
// pull-back is baked into each layer's gain rather than a single top-level scalar.
const AMB_POWER_STATION_FAINT = {
  id: 'amb_power_station_faint', name: 'amb_power_station_faint', category: 'ambient', priority: 2,
  config: {
    ...AMB_POWER_STATION.config,
    gain: 0.2,
    sparkle: undefined,
    layers: AMB_POWER_STATION.config.layers.map(l => ({ ...l, gain: (l.gain ?? 1) * 0.3 })),
  },
};
const INDUSTRIAL_AMBIENT_IDS = [AMB_POWER_STATION.id, AMB_UTILITY_ROOM.id, AMB_POWER_STATION_FAINT.id];

// The live, powered destructible power device in a zone (generator preferred),
// or null if the room has none / it's smashed / the zone is blacked out.
async function liveDeviceInZone(zoneId) {
  const { rows } = await query(
    `SELECT f.object_type, f.hp, COALESCE(pz.status,'offline') AS zone_status
       FROM furniture f LEFT JOIN power_zones pz ON pz.id = f.zone_id
      WHERE f.zone_id=$1 AND f.hp_max IS NOT NULL
      ORDER BY (f.object_type='generator') DESC LIMIT 1`,
    [zoneId]
  ).catch(() => ({ rows: [] }));
  const dev = rows[0];
  const live = dev && (dev.hp ?? 1) > 0 && dev.zone_status === 'powered';
  return live ? dev : null;
}

// Which industrial bed (if any) a zone should hear:
//  · own live generator → power-station roar; own live junction box → utility hum;
//  · otherwise a live generator in an adjacent zone bleeds through, fainter (only
//    the generator's roar carries next door — a utility hum wouldn't).
async function industrialBedFor(zoneId) {
  const dev = await liveDeviceInZone(zoneId);
  if (dev) return dev.object_type === 'generator' ? AMB_POWER_STATION : AMB_UTILITY_ROOM;
  const zone = getZone(zoneId);
  for (const neighborId of new Set(neighborZoneIds(zone))) {
    const nDev = await liveDeviceInZone(neighborId);
    if (nDev?.object_type === 'generator') return AMB_POWER_STATION_FAINT;
  }
  return null;
}

// Start the right loop (or none) for one player based on the zone they're in.
async function reconcileIndustrialAmbient(playerId, zoneId) {
  if (!playerId || !zoneId) return;
  const wantDef = await industrialBedFor(zoneId);
  for (const id of INDUSTRIAL_AMBIENT_IDS) {
    if (id !== wantDef?.id) sendToPlayer(playerId, { type: 'audio_stop', scope: 'ambience', id });
  }
  if (wantDef) sendToPlayer(playerId, { type: 'audio_ambience', def: wantDef });
}

// A destructible power device (generator / junction box) crossing the power
// threshold: power-down roar as it dies, industrial spin-up when it comes back,
// a room-wide flash, and the room's ambient bed starting/stopping to match.
on('device.power.changed', ({ zoneId, operational, deviceType }) => {
  if (!zoneId) return;
  const gain = deviceType === 'generator' ? 1.0 : 0.6;
  const def  = operational ? SFX_POWER_UP : SFX_POWER_DRAIN;
  sendToZone(zoneId, { type: 'audio_sfx', def, gain });
  sendToZone(zoneId, { type: 'device_power_flash', mode: operational ? 'up' : 'down', deviceType });
  for (const p of getZonePlayers(zoneId)) reconcileIndustrialAmbient(p.id, zoneId).catch(() => {});
  // A generator's roar bleeds into adjacent tiles, so its power flipping on/off
  // must also start/stop that faint bleed for anyone standing next door.
  if (deviceType === 'generator') {
    const zone = getZone(zoneId);
    for (const neighborId of new Set(neighborZoneIds(zone))) {
      for (const p of getZonePlayers(neighborId)) reconcileIndustrialAmbient(p.id, neighborId).catch(() => {});
    }
  }
});

on('ghost.action', ({ zoneId }) => {
  if (!zoneId) return;
  _ghostActionCount++;
  if (_ghostActionCount % GHOST_AMBIENT_EVERY !== 0) return;
  if (triggerEventRoute('ghost.ambient', zoneId, null)) return;
  sendToZone(zoneId, { type: 'audio_sfx', def: SFX_GHOST_WHISPER });
});

on('ghost.drain', ({ zoneId }) => {
  if (!zoneId) return;
  if (triggerEventRoute('ghost.drain', zoneId, null)) return;
  sendToZone(zoneId, { type: 'audio_sfx', def: SFX_POWER_DRAIN });
});

on('item.taken', ({ actor }) => {
  if (!triggerEventRoute('item.taken', actor?.current_zone, actor?.id)) {
    const def = sfxByName('ui_button');
    if (def && actor?.id) sendToPlayer(actor.id, { type: 'audio_sfx', def });
  }
});

on('item.dropped', ({ actor }) => {
  if (!triggerEventRoute('item.dropped', actor?.current_zone, actor?.id)) {
    const def = sfxByName('ui_button');
    if (def && actor?.id) sendToPlayer(actor.id, { type: 'audio_sfx', def });
  }
});

on('weather.thunder', ({ zoneId }) => {
  triggerEventRoute('weather.thunder', zoneId, null);
});

// ── Weather ambience (reactive) ───────────────────────────────────────────
// Two independent looping weather beds run off the engine's `weather.zoneAmbience`
// signal (emitted per occupied outdoor tile every 30s field tick), plus a
// per-player top-up on zone entry:
//   • precip bed — rain / sleet / snow / blizzard, gated by the tile's local
//     precipRate and whose volume RIDES that rate (drizzle quiet → downpour full).
//   • wind bed   — a howl that only plays above WIND_MIN_KPH and whose volume
//     rides the day's windKph (breezy → gale). Layers under precip, so a stormy
//     gale is rain + wind together; a dry windy day is wind alone.
// Which asset plays is resolved from the event-route table (names below) so
// builders can swap in real audio via the dev panel; absent a route/asset we
// fall back to a synthesized bed so the effect works out of the box.
const WIND_MIN_KPH = 25;

const WEATHER_AMBIENT_EVENTS = {
  rain:         'weather.ambient.rain',
  drizzle:      'weather.ambient.rain',
  thunderstorm: 'weather.ambient.rain',
  sleet:        'weather.ambient.sleet',
  snow:         'weather.ambient.snow',
  blizzard:     'weather.ambient.blizzard',
  storm:        'weather.ambient.blizzard',
  wind:         'weather.ambient.wind',
};

// Synthesized fallbacks — filtered noise beds. Overridden by any matching
// event route with an ambient_id. Keyed by normalized ambience kind.
const WEATHER_AMBIENT_FALLBACK = {
  rain: { id: 'wx_amb_rain', name: 'wx_amb_rain', category: 'ambient', priority: 2, config: { gain: 0.5, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass',  freq: 4200, q: 0.6 }, adsr: { a: 1.5, d: 0, s: 1,   r: 1.5 }, gain: 0.55 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 600,  q: 0.5 }, adsr: { a: 1.5, d: 0, s: 0.5, r: 1.5 }, gain: 0.18 },
  ] } },
  sleet: { id: 'wx_amb_sleet', name: 'wx_amb_sleet', category: 'ambient', priority: 2, config: { gain: 0.5, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 5200, q: 0.8 }, adsr: { a: 1, d: 0, s: 1,   r: 1 }, gain: 0.5 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3000, q: 0.6 }, adsr: { a: 1, d: 0, s: 0.6, r: 1 }, gain: 0.22 },
  ] } },
  snow: { id: 'wx_amb_snow', name: 'wx_amb_snow', category: 'ambient', priority: 2, config: { gain: 0.3, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 1200, q: 0.5 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.3 },
  ] } },
  blizzard: { id: 'wx_amb_blizzard', name: 'wx_amb_blizzard', category: 'ambient', priority: 2, config: { gain: 0.6, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass',  freq: 1800, q: 0.8 }, adsr: { a: 2, d: 0, s: 1,   r: 2 }, gain: 0.6 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 750,  q: 1.5 }, adsr: { a: 2, d: 0, s: 0.7, r: 2 }, gain: 0.3 },
  ] } },
  // Gusting wind: band-limited noise with a slow tremolo swell for the howl.
  wind: { id: 'wx_amb_wind', name: 'wx_amb_wind', category: 'ambient', priority: 2, config: { gain: 0.5, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 500,  q: 1.2 }, tremolo: { rate: 0.25, depth: 0.5 }, adsr: { a: 2.5, d: 0, s: 1,   r: 2.5 }, gain: 0.5 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass',  freq: 1500, q: 0.4 }, adsr: { a: 2.5, d: 0, s: 0.5, r: 2.5 }, gain: 0.2 },
  ] } },
};

// Collapse the precip taxonomy onto the ambience beds.
function weatherAmbientKind(kind) {
  if (kind === 'thunderstorm' || kind === 'drizzle') return 'rain';
  if (kind === 'storm') return 'blizzard';
  return kind;
}

// Resolve the ambient def for an ambience kind ('rain'|'sleet'|'snow'|'blizzard'
// |'wind' or any precip taxonomy value): event-route override if present, else
// the synthesized fallback. Returns null for 'none'/unknown.
function weatherAmbientDef(kind) {
  if (!kind || kind === 'none') return null;
  const routes = eventRoutes.get(WEATHER_AMBIENT_EVENTS[kind]);
  const routed = routes?.find(r => r.ambient_id);
  if (routed) { const d = ambient.get(routed.ambient_id); if (d) return d; }
  return WEATHER_AMBIENT_FALLBACK[weatherAmbientKind(kind)] || null;
}

// Every ambient id we might have started, so a player-scoped reset can stop
// whichever beds are playing without touching non-weather ambience.
function knownWeatherAmbientIds() {
  const ids = new Set();
  for (const t of ['rain', 'sleet', 'snow', 'blizzard', 'wind']) {
    const d = weatherAmbientDef(t);
    if (d?.id) ids.add(d.id);
  }
  return ids;
}

// Master cut so weather ambience sits under gameplay sound rather than
// competing with it; indoor mult muffles it to a "through the walls" murmur.
const WEATHER_GAIN = 0.6;
const INDOOR_GAIN_MULT = 0.25;
const MUFFLE_GAIN_MULT = 0.5; // per-hop cut for an outdoor tile hearing a neighboring storm cell's rain, not its own — 1 tile away = 0.5, 2 tiles = 0.25, so it spreads out

function isIndoorZone(zoneId) {
  const z = getZone(zoneId);
  return !!(z?.flags?.is_interior || z?.flags?.is_apartment || z?.flags?.is_building);
}

// Intensity → loop gain fraction (multiplies the def's base gain client-side).
function precipGainFor(rate) { return WEATHER_GAIN * Math.max(0.3,  Math.min(1, 0.35 + (rate || 0) * 0.75)); }
function windGainFor(kph)    { return WEATHER_GAIN * Math.max(0.35, Math.min(1, (kph - WIND_MIN_KPH) / 45 + 0.4)); }
function gainBucket(g)       { return Math.round(g * 100) / 100; } // avoid re-sending sub-0.01 gain nudges

// The beds a given tile should be running, as { def, gain } per slot (or null).
function desiredBedsFor({ precipType, active, precipRate, windKph }) {
  const precipDef = active ? weatherAmbientDef(precipType) : null;
  const windDef   = (windKph >= WIND_MIN_KPH) ? weatherAmbientDef('wind') : null;
  return {
    precip: precipDef ? { def: precipDef, gain: precipGainFor(precipRate) } : null,
    wind:   windDef   ? { def: windDef,   gain: windGainFor(windKph) }     : null,
  };
}

const zoneBeds = new Map(); // outdoor zoneId -> { precip: {id,gain}|null, wind: {id,gain}|null }

// Reconcile one slot for a zone: start / stop / ride-gain only on a real change.
function reconcileZoneSlot(zoneId, trackers, slot, desired) {
  const cur = trackers[slot] || null;
  const desiredId = desired?.def?.id || null;
  if (desiredId !== (cur?.id || null)) {
    if (cur) sendToZone(zoneId, { type: 'audio_stop', scope: 'ambience', id: cur.id });
    if (desired) {
      sendToZone(zoneId, { type: 'audio_ambience', def: desired.def });
      sendToZone(zoneId, { type: 'audio_loop_gain', id: desiredId, gain: desired.gain, ramp: 0.4 });
    }
    trackers[slot] = desiredId ? { id: desiredId, gain: gainBucket(desired.gain) } : null;
  } else if (desiredId) {
    const gb = gainBucket(desired.gain);
    if (gb !== cur.gain) { sendToZone(zoneId, { type: 'audio_loop_gain', id: desiredId, gain: desired.gain, ramp: 2.0 }); cur.gain = gb; }
  }
}

on('weather.zoneAmbience', (payload) => {
  const zoneId = payload.zoneId;
  const trackers = zoneBeds.get(zoneId) || { precip: null, wind: null };
  const desired = desiredBedsFor(payload);
  if (isIndoorZone(zoneId)) {
    if (desired.precip) desired.precip.gain *= INDOOR_GAIN_MULT;
    if (desired.wind)   desired.wind.gain   *= INDOOR_GAIN_MULT;
  } else if (payload.muffled && desired.precip) {
    desired.precip.gain *= Math.pow(MUFFLE_GAIN_MULT, payload.muffleHops || 1);
  }
  reconcileZoneSlot(zoneId, trackers, 'precip', desired.precip);
  reconcileZoneSlot(zoneId, trackers, 'wind',   desired.wind);
  if (trackers.precip || trackers.wind) zoneBeds.set(zoneId, trackers); else zoneBeds.delete(zoneId);
});

// Sidechain: when a thunderclap fires, briefly duck the weather beds playing in
// that zone so the clap punches cleanly through, then let them swell back.
on('weather.thunder', ({ zoneId }) => {
  const t = zoneBeds.get(zoneId);
  if (!t) return;
  for (const bed of [t.precip, t.wind]) {
    if (bed) sendToZone(zoneId, { type: 'audio_duck', scope: 'ambience', id: bed.id, fraction: 0.35, hold: 0.9 });
  }
});

// Top up a single player on zone entry: clear any weather beds, then start the
// ones their new tile warrants at the right reactive gains — muffled indoors.
function reconcilePlayerWeatherAmbient(playerId, zoneId) {
  if (!playerId || !zoneId) return;
  const mult = isIndoorZone(zoneId) ? INDOOR_GAIN_MULT : 1;
  const desired = [];
  const { precipType, precipRate } = getZonePrecip(zoneId);
  if (precipRate && precipType !== 'none') {
    const d = weatherAmbientDef(getCurrentPrecipType());
    if (d) desired.push({ def: d, gain: precipGainFor(precipRate) * mult });
  }
  const kph = getWindKph();
  if (kph >= WIND_MIN_KPH) {
    const d = weatherAmbientDef('wind');
    if (d) desired.push({ def: d, gain: windGainFor(kph) * mult });
  }
  const desiredIds = new Set(desired.map(x => x.def.id));
  for (const id of knownWeatherAmbientIds()) {
    if (!desiredIds.has(id)) sendToPlayer(playerId, { type: 'audio_stop', scope: 'ambience', id });
  }
  for (const { def, gain } of desired) {
    sendToPlayer(playerId, { type: 'audio_ambience', def });
    sendToPlayer(playerId, { type: 'audio_loop_gain', id: def.id, gain, ramp: 0.4 });
  }
}

// device.tuned fires on every TV/radio channel change (plugins/broadcast).
// The mechanical relay click of actually landing on a channel is shared
// multiplayer state (everyone looking at the same screen hears it), so it
// stays server-driven. The static hiss heard while dialing/searching and the
// steady CRT hum are per-viewer UI ambience tied to dial position, handled
// entirely client-side in client/game/js/panels/tv.js instead.
on('device.tuned', async ({ furnitureId }) => {
  if (!furnitureId) return;
  const { rows } = await query('SELECT zone_id FROM furniture WHERE id=$1', [furnitureId]);
  const targetZone = rows[0]?.zone_id;
  if (!targetZone) return;
  const def = sfxByName('tv_relay_click');
  if (def) sendToZone(targetZone, { type: 'audio_sfx', def });
});

// ── Dev panel CRUD ────────────────────────────────────────────────────────

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

const TABLES = {
  instruments: { table: 'audio_instruments', cache: instruments, cols: ['name', 'category', 'waveform', 'config', 'enabled', 'sample_id'] },
  songs: { table: 'audio_songs', cache: songs, cols: ['name', 'category', 'tempo', 'channels', 'loop_start', 'loop_end', 'instrument_ids', 'priority', 'enabled', 'channel_pan'] },
  sfx: { table: 'audio_sfx', cache: sfx, cols: ['name', 'category', 'priority', 'config', 'enabled'] },
  ambient: { table: 'audio_ambient', cache: ambient, cols: ['name', 'category', 'priority', 'config', 'loop', 'enabled'] },
};

// event_routes uses a UUID id PK; event_name is a plain indexed column allowing
// multiple routes per event (random selection at runtime).
const EVENT_ROUTE_COLS = ['event_name', 'sfx_id', 'ambient_id', 'song_id', 'sample_id', 'scope', 'enabled'];

const JSONB_COLS = new Set(['config', 'channels', 'instrument_ids', 'channel_pan']);

function colValue(col, body) {
  const v = body[col];
  if (JSONB_COLS.has(col)) return JSON.stringify(v ?? (col === 'config' ? {} : []));
  if (col === 'enabled') return v !== false ? 1 : 0;
  if (col === 'loop') return v !== false ? 1 : 0;
  return v ?? null;
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/audio')) return null;
  if (method !== 'GET' && !devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };

  const parts = path.split('/').filter(Boolean); // ['audio', resource, id?]
  const resource = parts[1];
  const id = parts[2]; // for events, this is the event_name
  const spec = TABLES[resource];

  // ── /audio/events CRUD (UUID id PK; multiple rows per event_name allowed) ─
  if (resource === 'events') {
    try {
      if (!id && method === 'GET') {
        const { rows } = await query('SELECT * FROM audio_event_routes ORDER BY event_name');
        return { status: 200, body: rows };
      }
      if (!id && method === 'POST') {
        const evName = body.event_name?.trim();
        if (!evName) return { status: 400, body: { error: 'event_name is required' } };
        const newId = randomUUID();
        await query(
          `INSERT INTO audio_event_routes (id,${EVENT_ROUTE_COLS.join(',')}) VALUES ($1,${EVENT_ROUTE_COLS.map((_,i)=>`$${i+2}`).join(',')})`,
          [newId, ...EVENT_ROUTE_COLS.map(c => c === 'enabled' ? (body[c] !== false ? 1 : 0) : (body[c] || null))],
        );
        await loadAudioLibrary();
        return { status: 200, body: { id: newId } };
      }
      if (id && method === 'PUT') {
        const sets = EVENT_ROUTE_COLS.map((c, i) => `${c}=$${i + 1}`).join(',');
        await query(
          `UPDATE audio_event_routes SET ${sets} WHERE id=$${EVENT_ROUTE_COLS.length + 1}`,
          [...EVENT_ROUTE_COLS.map(c => c === 'enabled' ? (body[c] !== false ? 1 : 0) : (body[c] || null)), id],
        );
        await loadAudioLibrary();
        return { status: 200, body: { id } };
      }
      if (id && method === 'DELETE') {
        await query('DELETE FROM audio_event_routes WHERE id=$1', [id]);
        await loadAudioLibrary();
        return { status: 200, body: { message: 'Deleted' } };
      }
    } catch (e) {
      return { status: 500, body: { error: e.message } };
    }
    return null;
  }

  // ── /audio/samples CRUD + data sub-resource ─────────────────────────────
  if (resource === 'samples') {
    const SAMPLE_COLS = ['name', 'category', 'priority', 'data', 'mime_type', 'base_note', 'loop_start', 'loop_end', 'snes_rate', 'snes_bits', 'echo_mix', 'config', 'enabled'];
    const SAMPLE_EDIT_COLS = ['name', 'category', 'priority', 'base_note', 'loop_start', 'loop_end', 'snes_rate', 'snes_bits', 'echo_mix', 'config', 'enabled'];
    try {
      // GET /audio/samples/:id/data — returns base64 blob; open to game client (no dev auth needed for GET)
      if (id && parts[3] === 'data' && method === 'GET') {
        const { rows } = await query('SELECT data FROM audio_samples WHERE id=$1', [id]);
        if (!rows[0]) return { status: 404, body: { error: 'Not found' } };
        return { status: 200, body: { data: rows[0].data } };
      }
      if (!id && method === 'GET') {
        const { rows } = await query(`SELECT ${SAMPLE_META_COLS} FROM audio_samples ORDER BY name`);
        return { status: 200, body: rows };
      }
      if (!id && method === 'POST') {
        const newId = body.id || `smp_${randomUUID()}`;
        const cols = ['id', ...SAMPLE_COLS];
        const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(',');
        const values = [newId, ...SAMPLE_COLS.map(c => {
          if (c === 'config') return JSON.stringify(body[c] ?? {});
          if (c === 'enabled') return body[c] !== false ? 1 : 0;
          return body[c] ?? null;
        })];
        await query(`INSERT INTO audio_samples (${cols.join(',')}) VALUES (${placeholders})`, values);
        await loadAudioLibrary();
        return { status: 201, body: { id: newId } };
      }
      if (id && method === 'PUT') {
        const sets = SAMPLE_EDIT_COLS.map((c, i) => `${c}=$${i + 1}`).join(',');
        const values = [...SAMPLE_EDIT_COLS.map(c => {
          if (c === 'config') return JSON.stringify(body[c] ?? {});
          if (c === 'enabled') return body[c] !== false ? 1 : 0;
          return body[c] ?? null;
        }), id];
        await query(`UPDATE audio_samples SET ${sets} WHERE id=$${SAMPLE_EDIT_COLS.length + 1}`, values);
        await loadAudioLibrary();
        return { status: 200, body: { id } };
      }
      if (id && method === 'DELETE') {
        await query('UPDATE audio_instruments SET sample_id=NULL WHERE sample_id=$1', [id]);
        await query('UPDATE audio_event_routes SET sample_id=NULL WHERE sample_id=$1', [id]);
        await query('DELETE FROM audio_samples WHERE id=$1', [id]);
        await loadAudioLibrary();
        return { status: 200, body: { message: 'Deleted' } };
      }
    } catch (e) {
      return { status: 500, body: { error: e.message } };
    }
    return null;
  }

  if (!spec) return null;

  try {
    if (!id && method === 'GET') {
      const { rows } = await query(`SELECT * FROM ${spec.table} ORDER BY name`);
      return { status: 200, body: rows };
    }
    if (!id && method === 'POST') {
      const newId = body.id || `aud_${randomUUID()}`;
      const cols = ['id', ...spec.cols];
      const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(',');
      const values = [newId, ...spec.cols.map(c => colValue(c, body))];
      await query(`INSERT INTO ${spec.table} (${cols.join(',')}) VALUES (${placeholders})`, values);
      await loadAudioLibrary();
      return { status: 201, body: { id: newId } };
    }
    if (id && method === 'PUT') {
      const sets = spec.cols.map((c, idx) => `${c}=$${idx + 1}`).join(',');
      const values = [...spec.cols.map(c => colValue(c, body)), id];
      await query(`UPDATE ${spec.table} SET ${sets} WHERE id=$${spec.cols.length + 1}`, values);
      await loadAudioLibrary();
      return { status: 200, body: { id } };
    }
    if (id && method === 'DELETE') {
      await query(`DELETE FROM ${spec.table} WHERE id=$1`, [id]);
      await loadAudioLibrary();
      return { status: 200, body: { message: 'Deleted' } };
    }
  } catch (e) {
    return { status: 500, body: { error: e.message } };
  }
  return null;
};

// ── Admin commands ─────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(['admin', 'dev', 'builder', 'designer']);

export const commands = {
  '.createsound': async (args, raw, player) => {
    if (!ADMIN_ROLES.has(player.role)) return { type: 'error', message: 'Admin only.' };
    const { rows } = await query('SELECT id, name FROM audio_sfx WHERE enabled IS DISTINCT FROM false ORDER BY name');
    return { type: 'sound_picker', sfx: rows };
  },

  '.playsound': (args, raw, player, broadcast) => {
    if (!ADMIN_ROLES.has(player.role)) return { type: 'error', message: 'Admin only.' };
    const [sfxId, loudnessStr] = args;
    if (!sfxId) return { type: 'error', message: 'Usage: .playsound <sfx_id> <loudness>' };
    const def = sfx.get(sfxId);
    if (!def) return { type: 'error', message: `Unknown SFX: ${sfxId}` };
    const loudness = Math.max(0.1, Math.min(5, parseFloat(loudnessStr) || 1));
    propagateAudio(player.current_zone, def, loudness, (zoneId, msg) => sendToZone(zoneId, msg));
    return { type: 'output', message: `Playing <b>${def.name}</b> at loudness ${loudness}.` };
  },
};
