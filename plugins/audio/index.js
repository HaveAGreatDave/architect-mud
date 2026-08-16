import { randomUUID, createHash } from 'crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../../server/models/db.js';
import { getZone, getZonePlayers, getLivePlayer, getZoneFurniture, regionForZone, renderOf, specOf, zoneTerrain } from '../../server/engine/world.js';
import { resolveDefault } from '../../scripts/content/derive.mjs';
import { neighborZoneIds } from '../../server/engine/exits.js';
import { sendToZone, sendToPlayer, getBroadcast } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { propagateAudio, getWeatherLeakGain, getWeatherLeakSource } from '../../server/engine/sounds.js';
import { getZonePrecip, getWindKph, getZonePowerStatus, activeWeatherEvent, isIndoorZone } from '../../server/engine/environment.js';
// The game's one step clock. Borrowed, never re-derived — a cadence of our own
// would drift the moment movement speed is tuned, and the symptom would be feet
// that no longer match the walk. `plugins/pinch` borrows it for the same reason.
import { stepCadenceMs } from '../pacing/index.js';

// ── In-memory library cache (loaded from DB at boot, refreshed after CRUD) ──

const instruments = new Map(); // id -> row
const songs = new Map();       // id -> row
const sfx = new Map();         // id -> row
const ambient = new Map();     // id -> row
const samples = new Map();     // id -> row (without data column)
const eventRoutes = new Map(); // event_name -> row[]

// name -> id, so event handlers below can reference assets by human name
// without hardcoding ids. Falls back to no-op if the named asset isn't seeded.
const byName = { sfx: new Map(), songs: new Map(), ambient: new Map(), samples: new Map() };

const SAMPLE_META_COLS = 'id,name,category,priority,mime_type,base_note,loop_start,loop_end,snes_rate,snes_bits,echo_mix,config,enabled';

// ── Content-backed mode (CONTENT_READONLY, i.e. production) ─────────────────
// The same audio rows live as content/<table>/*.json in the git checkout the
// server runs from, and the CONTENT_READONLY gate blocks every HTTP write that
// could make the DB drift from those files between deploys (CI restarts the
// service after each content import, so the checkout is never stale either).
// Reading the library — and sample blobs, in the data route below — from disk
// instead of Neon saves ~18MB of egress per reboot; reboots happen on every
// deploy, which is what blew the free plan's transfer allowance. Dev keeps
// reading the DB: local WIP lives there until content:export.
const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const contentBacked = !!process.env.CONTENT_READONLY;

function contentTableRows(table) {
  const dir = join(CONTENT_DIR, table);
  if (!contentBacked || !existsSync(dir)) return null;
  return readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

// Same filename sanitization as the content exporter (fileNameForRow); the
// replace also keeps a hostile id from ever escaping the directory.
function sampleFileById(id) {
  const path = join(CONTENT_DIR, 'audio_samples', String(id).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}
const sampleEtags = new Map(); // id -> md5 etag; files only change with a deploy, which restarts the process

export async function loadAudioLibrary() {
  const load = async (table, sql) => contentTableRows(table) ?? (await query(sql)).rows;
  const [i, s, fx, am, ev, sm] = await Promise.all([
    load('audio_instruments', 'SELECT * FROM audio_instruments'),
    load('audio_songs', 'SELECT * FROM audio_songs'),
    load('audio_sfx', 'SELECT * FROM audio_sfx'),
    load('audio_ambient', 'SELECT * FROM audio_ambient'),
    load('audio_event_routes', 'SELECT * FROM audio_event_routes WHERE enabled=1'),
    load('audio_samples', `SELECT ${SAMPLE_META_COLS} FROM audio_samples`),
  ]);
  instruments.clear();
  for (const row of i) instruments.set(row.id, row);
  songs.clear();
  byName.songs.clear();
  for (const row of s) { songs.set(row.id, row); byName.songs.set(row.name, row.id); }
  sfx.clear();
  byName.sfx.clear();
  for (const row of fx) { sfx.set(row.id, row); byName.sfx.set(row.name, row.id); }
  ambient.clear();
  byName.ambient.clear();
  for (const row of am) { ambient.set(row.id, row); byName.ambient.set(row.name, row.id); }
  eventRoutes.clear();
  for (const row of ev.filter(r => r.enabled === 1)) {
    const arr = eventRoutes.get(row.event_name) || [];
    arr.push(row);
    eventRoutes.set(row.event_name, arr);
  }
  samples.clear();
  byName.samples.clear();
  for (const { data: _blob, ...row } of sm) { samples.set(row.id, row); byName.samples.set(row.name, row.id); }
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
function sampleByName(name) {
  const id = byName.samples.get(name);
  return id ? samples.get(id) : null;
}

// Looked up by other plugins (e.g. broadcast) that need to trigger a song by
// its human name without owning a DB query of their own.
export function getSongDefByName(name) {
  const song = name ? songByName(name) : null;
  return song ? resolveSongInstruments(song) : null;
}
export function getSfxDefByName(name) { return name ? sfxByName(name) : null; }
export function getAmbientDefByName(name) { return name ? ambientByName(name) : null; }
// A recorded sample (audio_samples) resolved by human name — used by broadcast
// themes that name a sample sting instead of a tracker song. Metadata only (no
// `data` blob); the client fetches the blob from /audio/samples/:id/data.
export function getSampleDefByName(name) { return name ? sampleByName(name) : null; }

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
  const zoneId = getLivePlayer(id)?.current_zone;
  reconcilePlayerWeatherAmbient(id, zoneId);
  // Same reasoning, now that a tile can actually have a theme to be silent about:
  // log in standing in Coldwater and the city should already be playing.
  const song = songs.get(zoneThemeSongId(getZone(zoneId)));
  if (song) {
    themePlaying.set(id, song.id);
    sendToPlayer(id, { type: 'audio_music', def: resolveSongInstruments(song) });
  }
});

on('player.logout', ({ id }) => {
  themePlaying.delete(id);
  triggerEventRoute('player.logout', null, id);
});

// A tile's theme, RESOLVED AT BUILD TIME. Step 1 of the map pipeline called
// resolveDefault here, at the call site, because zone_derived didn't exist yet;
// step 3 built the table and this is the loan being repaid. The resolution order
// is unchanged — same function, run by the build instead of by the request — so
// nothing about what plays changed when it moved.
//
// The fallback is for a transient zone (a void-crossing room), which is synthetic
// and has no derived row by construction.
export function zoneThemeSongId(zone) {
  const derived = specOf(zone?.id) ? renderOf(zone.id)?.audio_theme_id : undefined;
  return derived !== undefined ? derived : resolveDefault('audio_theme_id', zone, regionForZone(zone));
}

// What the zone theme last started for a player, so leaving a themed place can
// stop it. Only tracks music THIS handler began: the radio and the broadcast
// plugin also own the music slot, and silencing someone's radio because they
// stepped off a themed tile would be a worse bug than the one being fixed.
const themePlaying = new Map(); // playerId -> songId

on('zone.entered', ({ actor, zone: zoneId }) => {
  reconcilePlayerWeatherAmbient(actor?.id, zoneId);
  reconcileIndustrialAmbient(actor?.id, zoneId).catch(() => {});
  if (triggerEventRoute(`zone.entered.${zoneId}`, zoneId, actor?.id)) return;
  if (triggerEventRoute('zone.entered', zoneId, actor?.id)) return;
  const zone = getZone(zoneId);
  const song = songs.get(zoneThemeSongId(zone));
  const pid = actor?.id;
  if (!song) {
    // Nothing to play here. Before region defaults existed no tile had a theme,
    // so this branch never had anything to undo; now walking out of Coldwater
    // into the unregioned wastes has to actually end the city's music.
    if (pid && themePlaying.has(pid)) {
      themePlaying.delete(pid);
      sendToPlayer(pid, { type: 'audio_stop', scope: 'music' });
    }
    return;
  }
  if (pid) themePlaying.set(pid, song.id);
  // The client ignores a repeat of what's already playing (restartIfSame: false),
  // so re-sending on every step inside one theme costs a message, not a restart.
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
  const song = songs.get(zoneThemeSongId(getZone(zoneId)));
  if (song) { themePlaying.set(player.id, song.id); sendToPlayer(player.id, { type: 'audio_music', def: resolveSongInstruments(song) }); }
  else { themePlaying.delete(player.id); sendToPlayer(player.id, { type: 'audio_stop', scope: 'music' }); }
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
  vatSequence(player.id);
});

// The ordinary respawn: drain, boot, the seal breaking, the all-clear chime.
function vatSequence(id) {
  sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_DRAIN });
  setTimeout(() => sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_BOOT  }), 900);
  setTimeout(() => sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_OPEN  }), 1800);
  setTimeout(() => sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_CHIME }), 2100);
}

// ── First time in the Clone Facility ─────────────────────────────────────────
// You hear the vat cycle every time you die. The FIRST time is the one that
// should land, because it is the only one where you don't yet know what it is —
// so it gets a longer, heavier version of the same sequence plus a visual beat,
// the same trick the holocaster uses: sound alone reads as a sound effect, sound
// plus the room reacting reads as something happening TO you.
//
// The visual is the ion-storm overlay held for a few seconds. It is not weather
// and never claims to be — it is the arc-and-etch layer the client already
// renders, borrowed for the discharge of the thing that just printed a body. The
// clear is unconditional and fires even if the player walks straight back out,
// because a stuck overlay would read as a bug for the rest of the session.
const VAT_FIRST_FLAG = 'seen_clone_vat';
const VAT_FX_MS = 4200;

// A deeper, slower spin-up than the routine one — the racks coming up cold.
const SFX_VAT_FIRST_SWELL = {
  id: 'sfx_vat_first_swell', name: 'sfx_vat_first_swell', category: 'sfx', priority: 9,
  config: {
    duration: 3.4,
    layers: [
      { waveform: 'sine', freq: 28, pitchBend: { to: 44, time: 3.0 }, adsr: { a: 1.2, d: 0.6, s: 0.8, r: 1.4 }, gain: 0.5 },
      { waveform: 'sawtooth', freq: 41, pitchBend: { to: 96, time: 2.8 }, filter: { type: 'lowpass', freq: 700, q: 1.6 }, adsr: { a: 0.9, d: 0.5, s: 0.7, r: 1.2 }, gain: 0.3 },
      { noiseMix: 0.7, filter: { type: 'bandpass', freq: 420, q: 3.2 }, tremolo: { rate: 7, depth: 0.7 }, adsr: { a: 1.4, d: 0.4, s: 0.6, r: 1.0 }, gain: 0.16 },
    ],
  },
};

// The discharge the overlay is drawing — a hard crack with a long room tail.
const SFX_VAT_ARC = {
  id: 'sfx_vat_arc', name: 'sfx_vat_arc', category: 'sfx', priority: 10,
  config: {
    duration: 2.2,
    layers: [
      { noiseMix: 1, filter: { type: 'highpass', freq: 2200, q: 0.8 }, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.12 }, gain: 0.8 },
      { waveform: 'sine', freq: 62, adsr: { a: 0.001, d: 0.5, s: 0.15, r: 1.6 }, gain: 0.7 },
      { noiseMix: 0.5, filter: { type: 'bandpass', freq: 1100, q: 1.1 }, adsr: { a: 0.02, d: 1.1, s: 0.1, r: 1.4 }, gain: 0.22 },
    ],
  },
};

const CLONE_FACILITY_ZONES = new Set(['zone_start', 'zone_district_918_903']);

on('zone.entered', async ({ actor, zone: zoneId }) => {
  if (!actor?.id || !CLONE_FACILITY_ZONES.has(zoneId)) return;
  try {
    if (await getFlag('player', VAT_FIRST_FLAG, actor)) return;
    await setFlag('player', VAT_FIRST_FLAG, '1', actor);
  } catch { return; }   // can't record it → don't fire, or it repeats every entry

  const id = actor.id;
  sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_FIRST_SWELL });
  setTimeout(() => sendToPlayer(id, { type: 'audio_sfx', def: SFX_VAT_ARC }), 1500);
  setTimeout(() => vatSequence(id), 2000);

  // The visual borrows a GLOBAL channel: `weather_event` is normally broadcast to
  // everyone on a real hero event, and the client only hears about it on a change.
  // So if a genuine event is running we leave the screen alone entirely — the
  // sound still lands, and stealing an acid-rain overlay for four seconds would be
  // a worse trade than skipping the flourish. When we do borrow it, the restore
  // re-sends the ACTUAL current state rather than a blind null, so we can never
  // leave a player looking at clear skies through a storm.
  if (activeWeatherEvent()) return;
  sendToPlayer(id, { type: 'weather_event', eventType: 'ion_storm', phase: 'peak' });
  const restore = () => {
    const live = activeWeatherEvent();   // re-read: one may have begun while we held it
    sendToPlayer(id, { type: 'weather_event', eventType: live?.type ?? null, phase: live?.phase ?? null });
  };
  // Drop off the peak first so it fades rather than blinking out.
  setTimeout(() => { if (!activeWeatherEvent()) sendToPlayer(id, { type: 'weather_event', eventType: 'ion_storm', phase: null }); }, VAT_FX_MS - 1200);
  setTimeout(restore, VAT_FX_MS);
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

// Aircraft cannon raking your tile, heard from the GROUND — the ground side of a strafing
// run, deliberately NOT the shooter's muzzle report. Fired once per burst (the strafe path
// emits at the gun's ~8/s cadence) so the BRRRT builds from the cadence itself: a broadband
// dirt/debris thud where a round smacks the ground beside you, the supersonic crack of the
// round passing, a distant lowpassed cannon report rolling in from above, and a low thump
// through the ground. Shorter/impact-led vs the crisp in-cockpit GUN_FX.
const SFX_STRAFE_GROUND = {
  id: 'sfx_strafe_ground', name: 'sfx_strafe_ground', category: 'sfx', priority: 5,
  config: {
    duration: 0.3,
    layers: [
      { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 420, q: 0.8 }, adsr: { a: 0.001, d: 0.12, s: 0, r: 0.08 }, gain: 0.2 },   // round smacking the dirt beside you
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2600, q: 1.6 }, adsr: { a: 0.0005, d: 0.04, s: 0, r: 0.03 }, gain: 0.11 },  // supersonic crack of the round passing
      { waveform: 'sawtooth', freq: 120, pitchBend: { to: 70, time: 0.14 }, filter: { type: 'lowpass', freq: 300, q: 1 }, adsr: { a: 0.006, d: 0.18, s: 0, r: 0.1 }, gain: 0.1 },   // distant, muffled cannon report from above
      { waveform: 'sine', freq: 46, adsr: { a: 0.003, d: 0.2, s: 0, r: 0.1 }, gain: 0.14 },   // low thump through the ground
    ],
  },
};

// Ground side of an aircraft strafing run — the flight plugin emits this per gun burst so
// the tile hears the fire in sync (its own cooldown-gated damage is separate).
on('flight.strafeIncoming', ({ zoneId }) => {
  if (zoneId) sendToZone(zoneId, { type: 'audio_sfx', def: SFX_STRAFE_GROUND, gain: 0.9 });
});

// An AA battery firing, heard on the GROUND — a heavy Flak-88 bark: a huge concussive muzzle
// blast, the sharp crack of the round, and a long lowpassed report rolling out. Propagated
// from the gun's tile so the surrounding zones (and down the hatch, the bunker crew) hear it
// carry and fade with distance/doors. Throttled per site so it reports like a big slow gun.
const SFX_FLAK_REPORT = {
  id: 'sfx_flak_report', name: 'sfx_flak_report', category: 'sfx', priority: 6,
  config: {
    duration: 0.9,
    layers: [
      { waveform: 'sine', freq: 50, pitchBend: { to: 27, time: 0.18 }, filter: { type: 'lowpass', freq: 95, q: 1 }, adsr: { a: 0.001, d: 0.34, s: 0, r: 0.2 }, gain: 0.6 },   // sub-bass muzzle concussion
      { waveform: 'sine', freq: 82, pitchBend: { to: 44, time: 0.14 }, filter: { type: 'lowpass', freq: 200, q: 1.1 }, adsr: { a: 0.001, d: 0.26, s: 0, r: 0.12 }, gain: 0.5 },   // muzzle body / recoil drop
      { waveform: 'sawtooth', freq: 108, pitchBend: { to: 64, time: 0.1 }, filter: { type: 'lowpass', freq: 560, q: 1.3 }, adsr: { a: 0.001, d: 0.16, s: 0, r: 0.08 }, gain: 0.26 },   // breech slam / low body
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 520, q: 0.8 }, adsr: { a: 0.0005, d: 0.09, s: 0, r: 0.05 }, gain: 0.34 },   // the hard report crack
      { waveform: 'noise', noiseMix: 1, delay: 0.12, filter: { type: 'lowpass', freq: 360, q: 0.7 }, adsr: { a: 0.02, d: 0.4, s: 0, r: 0.32 }, gain: 0.22 },   // report rolling out across the ground
    ],
  },
};

// THE DIVE SIREN, HEARD FROM THE GROUND. Not the pilot's loop (that lives in the cockpit's own
// audio layer, ridden off the dive angle) — this is the one-shot everyone underneath gets as she
// tips over: a wind-driven siren winding UP, so every layer is a rising pitch bend, over an
// airframe note that gets louder as it comes. It is deliberately long (2.6 s) — the whole point
// is that it arrives before the bomb does and you have a moment to do something about it.
// Propagated rather than sent flat, so it fades through walls and carries down the street.
const SFX_DIVE_SIREN = {
  id: 'sfx_dive_siren', name: 'sfx_dive_siren', category: 'sfx', priority: 7,
  config: {
    duration: 2.6,
    layers: [
      { waveform: 'sawtooth', freq: 300, pitchBend: { to: 1080, time: 2.3 }, filter: { type: 'bandpass', freq: 900, q: 5 }, adsr: { a: 0.25, d: 0, s: 1, r: 0.5 }, gain: 0.34 },   // the siren itself, winding up
      { waveform: 'sawtooth', freq: 452, pitchBend: { to: 1622, time: 2.3 }, filter: { type: 'bandpass', freq: 1400, q: 6 }, adsr: { a: 0.3, d: 0, s: 1, r: 0.5 }, gain: 0.20 },   // its fifth — what makes it a wail and not a tone
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 620, q: 1.1 }, adsr: { a: 0.4, d: 0, s: 1, r: 0.6 }, gain: 0.16 },                                       // air being forced through it
      { waveform: 'sawtooth', freq: 44, pitchBend: { to: 92, time: 2.4 }, filter: { type: 'lowpass', freq: 260, q: 1.2 }, tremolo: { rate: 5, depth: 0.5 }, adsr: { a: 0.5, d: 0, s: 1, r: 0.7 }, gain: 0.26 },   // the aeroplane behind it, closing
    ],
  },
};
on('flight.diveSiren', ({ zoneId }) => {
  if (zoneId) propagateAudio(zoneId, SFX_DIVE_SIREN, 1.0, sendToZone);
});

// A bomb going off. The heavy end of the catalogue: a sub-bass punch you feel before you hear,
// the sharp crack of the detonation on top of it, a shattering debris layer, and a long
// low-passed rumble rolling out afterwards — that tail is what separates a bomb from a gunshot.
const SFX_BOMB_IMPACT = {
  id: 'sfx_bomb_impact', name: 'sfx_bomb_impact', category: 'sfx', priority: 8,
  config: {
    duration: 2.4,
    layers: [
      { waveform: 'sine', freq: 44, pitchBend: { to: 19, time: 0.30 }, filter: { type: 'lowpass', freq: 80, q: 1 }, adsr: { a: 0.001, d: 0.55, s: 0, r: 0.4 }, gain: 0.75 },        // the punch in your chest
      { waveform: 'sine', freq: 76, pitchBend: { to: 33, time: 0.22 }, filter: { type: 'lowpass', freq: 180, q: 1.1 }, adsr: { a: 0.001, d: 0.40, s: 0, r: 0.3 }, gain: 0.55 },     // body of the blast
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 780, q: 0.7 }, adsr: { a: 0.0005, d: 0.14, s: 0, r: 0.08 }, gain: 0.46 },                                 // the crack
      { waveform: 'noise', noiseMix: 1, delay: 0.10, filter: { type: 'highpass', freq: 2200, q: 0.6 }, adsr: { a: 0.01, d: 0.7, s: 0, r: 0.5 }, gain: 0.20 },                       // glass and grit coming down
      { waveform: 'noise', noiseMix: 1, delay: 0.18, filter: { type: 'lowpass', freq: 300, q: 0.7 }, adsr: { a: 0.04, d: 1.3, s: 0, r: 0.9 }, gain: 0.30 },                         // the rumble rolling out
    ],
  },
};
on('flight.bombImpact', ({ zoneId }) => {
  if (zoneId) propagateAudio(zoneId, SFX_BOMB_IMPACT, 1.0, sendToZone);
});

const _lastFlak = new Map();   // siteId → ms of last ground report (per-site bark throttle)
on('flight.aaFired', ({ zoneId, siteId }) => {
  if (!zoneId) return;
  const now = Date.now();
  if (siteId) {
    if (now - (_lastFlak.get(siteId) || 0) < 650) return;   // ~1.5 booms/s max — a heavy gun, not a buzzsaw
    _lastFlak.set(siteId, now);
  }
  propagateAudio(zoneId, SFX_FLAK_REPORT, 1.0, sendToZone);   // floods neighbours + the bunker, fading per hop/door
});

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
// A POWER DEVICE, not "anything with an HP bar". This asked for `hp_max != null`
// and that is a test for DESTRUCTIBLE, which a microwave also passes — so every
// Solenne apartment, the four Merrow units, the grocery and the laundromat were
// running the utility-room hum off a kitchen appliance, a folding table or a row
// of dryers. A machine-room drone in somebody's bedroom, forever, with nothing in
// the room to explain it.
//
// The two types below are what the function was always describing: a generator
// roars, its junction box hums. Anything else is furniture that happens to be
// breakable.
const POWER_DEVICE_TYPES = new Set(['generator', 'junction_box']);
// Exported for regress: the bug was in what COUNTS, not in the loop plumbing.
export const isPowerDevice = (f) => POWER_DEVICE_TYPES.has(f?.object_type) && f?.hp_max != null;

function liveDeviceInZone(zoneId) {
  // power_zones.status is RAM-only derived state now, and furniture is cached —
  // so this is a walk of the zone's rows rather than a per-call join.
  const candidates = getZoneFurniture(zoneId).filter(isPowerDevice);
  candidates.sort((a, b) => (b.object_type === 'generator') - (a.object_type === 'generator'));
  const dev = candidates[0];
  const live = dev && (dev.hp ?? 1) > 0 && getZonePowerStatus(zoneId) === 'powered';
  return live ? dev : null;
}

// Which industrial bed (if any) a zone should hear:
//  · own live generator → power-station roar; own live junction box → utility hum;
//  · otherwise a live generator in an adjacent zone bleeds through, fainter (only
//    the generator's roar carries next door — a utility hum wouldn't).
async function industrialBedFor(zoneId) {
  const dev = liveDeviceInZone(zoneId);
  if (dev) return dev.object_type === 'generator' ? AMB_POWER_STATION : AMB_UTILITY_ROOM;
  const zone = getZone(zoneId);
  for (const neighborId of new Set(neighborZoneIds(zone))) {
    const nDev = liveDeviceInZone(neighborId);
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

// ── Bodily SFX (pee/poop soundscript, driven by the bodily plugin's timers) ──
// Inline synth defs — no DB row. The bodily plugin decides WHEN each cue fires
// (farts, plops, stream bursts, the finale); this decides what they sound like.

// A wet drop.
const SFX_PLOP = {
  id: 'sfx_plop', name: 'sfx_plop', category: 'sfx', priority: 4,
  config: { duration: 0.28, layers: [
    { waveform: 'sine', freq: 120, pitchBend: { to: 55, time: 0.2 }, adsr: { a: 0.004, d: 0.16, s: 0, r: 0.08 }, gain: 0.33 },
    { noiseMix: 1, filter: { type: 'bandpass', freq: 900, q: 1.1 }, adsr: { a: 0.004, d: 0.12, s: 0, r: 0.06 }, gain: 0.15 },
  ] },
};



// Toilet flush — the initial water rush swells then drains, a low swirling gurgle
// pitches down as the bowl empties, and a high tank-refill trickle lingers after.
const SFX_FLUSH = {
  id: 'sfx_flush', name: 'sfx_flush', category: 'sfx', priority: 3,
  config: { duration: 2.6, layers: [
    { noiseMix: 1, filter: { type: 'bandpass', freq: 1400, q: 0.5 }, adsr: { a: 0.22, d: 0.6, s: 0.6, r: 1.1 }, gain: 0.3 },
    { waveform: 'sine', freq: 220, pitchBend: { to: 90, time: 1.6 }, tremolo: { rate: 7, depth: 0.6 }, adsr: { a: 0.2, d: 0.4, s: 0.5, r: 0.8 }, gain: 0.12 },
    { noiseMix: 1, filter: { type: 'highpass', freq: 3200, q: 0.6 }, delay: 1.4, adsr: { a: 0.3, d: 0.3, s: 0.7, r: 0.9 }, gain: 0.05 },
  ] },
};


// Cooking (and, in time, anything else that hits, cuts, stirs or heats a
// material) emits a SEMANTIC event — an action, a material, an intensity — and
// never a sound. Everything acoustic is decided here, so the same vocabulary can
// be emitted by smithing or chemistry later and get audio for nothing.
on('cooking.sfx', ({ zoneId, playerId, personal, ...params }) => {
  if (!params.action) return;
  // PARAMETERS, NOT LAYERS. A hot sizzle is ~32 randomised burst layers; shipping
  // those serialised cost 6 KB per cue to every player in the room, and a deglaze
  // fires three at once. The client holds the same generator (client/shared/
  // procedural-sfx.js) and rebuilds the identical field from the seed, so the
  // wire carries about a hundred bytes instead.
  const msg = { type: 'audio_sfx_proc', params: { ...params, seed: (Math.random() * 0xffffffff) >>> 0 } };
  // A knife on a board carries; spreading butter is your own business.
  if (personal && playerId) sendToPlayer(playerId, msg);
  else if (zoneId) sendToZone(zoneId, msg);
});

// ── The dense tier: footsteps, doors, locks ─────────────────────────────────
//
// Everything below is stamped `tier: 'full'`, which is the ONE thing that makes
// this layer safe to ship. The client drops a `full` cue unless the player's
// Sound Detail says otherwise (client/shared/settings.js), and an UNSTAMPED cue
// is unchanged — so `limited`, the default for everybody who has not chosen,
// hears precisely the game that shipped yesterday.
//
// The stamp is not a category and not a volume. It answers one question: is this
// sound the world talking continuously, or is it something that happened?
const FULL = 'full';

// Terrain → footing class. DERIVED, never authored: `flags.terrain` is already
// the ground-surface SSOT (docs/systems-terrain.md), so a tile is audible the
// day it is painted and nobody writes an acoustic number on a zone.
//
// The classes are coarse ON PURPOSE. Redrock, hardpan, alkali, basalt and a
// plateau are one sound at the resolution of a boot — authoring five of them
// would be five hand-tuned values expressing a difference nobody can hear, which
// is the same argument that keeps 85 food items on ten material classes.
export const TERRAIN_STEP = {
  road: 'stone', asphalt: 'stone', concrete: 'stone', sinter: 'stone',
  redrock: 'stone', hardpan: 'stone', alkali: 'stone', basalt: 'stone',
  cliff: 'stone', plateau: 'stone', ramp: 'stone',
  dirt_road: 'dirt', dirt: 'dirt',
  gravel: 'gravel', sand: 'sand',
  grass: 'grass', park: 'grass',
  scrub: 'scrub', forest: 'scrub', deadwood: 'scrub',
  marsh: 'marsh', hotspring: 'marsh',
  water: 'water', underwater: 'water',
  ash: 'ash',
  dock: 'boards',
  // Wet stone underfoot, and the one terrain whose whole character is the echo.
  sewer: 'metal',
};

// Interior floor → footing class. `flags.floor` is authored (see tagCatalog.js),
// and an interior that has never been given one falls back to boards rather than
// going silent: the failure mode of forgetting is a slightly wrong floor, never a
// missing sound.
export const FLOOR_STEP = {
  boards: 'boards', carpet: 'carpet', tile: 'tile', concrete: 'stone',
  stone: 'stone', metal: 'metal', dirt: 'dirt', linoleum: 'lino',
};
const DEFAULT_FLOOR = 'boards';

export function footingFor(zone) {
  const t = zoneTerrain(zone);
  if (t) return TERRAIN_STEP[t] || 'stone';
  // No terrain means no ground surface, which indoors is the correct answer and
  // outdoors (a building footprint tile) is simply pavement.
  if (isIndoorZone(zone)) return FLOOR_STEP[zone?.flags?.floor] || DEFAULT_FLOOR;
  return 'stone';
}

// ── Making a sound you hear ten thousand times bearable ─────────────────────
//
// This is the only cue in the game a player triggers on almost every input, for
// as long as they play. Everything below exists because "make it quieter" is not
// the answer to fatigue — a quiet sound repeated identically is MORE irritating
// than a loud one that varies, not less.
//
// A step is the player's own, plus a much quieter copy for the room. Someone
// else's arrival is ALREADY a log line; their footstep adds the surface and the
// fact that it happened now, and it must not compete with your own feet.
const clamp01Local = v => Math.max(0, Math.min(1, Number(v) || 0));
const OTHERS_STEP_GAIN = 0.3;
// Own steps sit deliberately below the game's other sfx. A footstep is the floor
// of the mix, not an event in it.
const OWN_STEP_GAIN = 0.55;

// Per-player walking state, RAM only, no column and no query — which foot is next
// and when the last step landed. Both are cosmetic and a logout losing them is
// correct (you start the next session on your left).
const gait = new Map();
// Movement can arrive faster than a person can walk: auto-walk, run mode, a held
// key. Below this the step is DROPPED rather than queued — a queue turns a sprint
// into a machine-gun that runs on after you stop, which is the worst of both.
const MIN_STEP_MS = 170;

on('movement.step', ({ actor, zone, intensity }) => {
  const z = getZone(zone);
  if (!z || !actor) return;

  const now = Date.now();
  const g = gait.get(actor.id) || { foot: 0, at: 0 };
  if (now - g.at < MIN_STEP_MS) return;
  // The foot deliberately does NOT flip per move any more. A move used to BE one
  // footfall, so flipping here was the alternation; now the client advances the
  // foot within the series and a continuously-walking player is cancelled after
  // an even number of footfalls, so flipping again would land the same foot twice
  // at every room boundary — the one place the ear is listening hardest.
  gait.set(actor.id, { foot: g.foot, at: now });

  // BLENDING WITH THE WEATHER, and it is not a volume trick. Rain wets the
  // ground, so the step genuinely moves toward the rain's own spectrum — duller
  // strike, more splash — which is what makes it sit inside the bed instead of
  // over it. Indoors and underground are exempt: the rain is not landing there.
  //
  // getZonePrecip is the same in-memory read the ambience beds already do on this
  // path, so this costs nothing new.
  // `precipType: 'none'` still reports a rate, so both have to be read — a clear
  // day would otherwise soak every street in the game.
  let precip = 0;
  if (!indoorZoneId(zone)) {
    const { precipType, precipRate } = getZonePrecip(zone) || {};
    if (precipType && precipType !== 'none') precip = clamp01Local(precipRate);
  }

  const params = {
    action: 'footstep', surface: footingFor(z),
    intensity: intensity ?? 0.5,
    wet: precip,
    foot: g.foot,
    seed: (Math.random() * 0xffffffff) >>> 0,
  };
  // …and it ALSO ducks, because in a downpour a footstep really is masked. The
  // two together are the difference between "quieter" and "in the rain".
  const duck = 1 - 0.45 * precip;

  // ── A crossing is a WALK, not a click ───────────────────────────────────────
  //
  // One cue per room transition can only ever be a "boomp". A room takes real
  // time to cross — `stepCadenceMs` is the game's one step clock (900ms walking,
  // 700 running, 350 sprinting, road-scaled), the same number the pacing plugin
  // throttles on and `plugins/pinch`'s walker paces off — so the sound of getting
  // there has to occupy that time or it is not a footstep, it is a tap.
  //
  // Sent as ONE message describing a cadence rather than four messages. The whole
  // reason this tier is affordable is that a step is ~70 bytes; quadrupling the
  // message count on the per-move path to say something the client can schedule
  // itself would give that back for nothing.
  //
  // THE TAIL IS THE ARRIVAL, and it falls out of cancellation rather than being a
  // special case. Four footfalls at half-cadence span longer than one crossing,
  // and a new step REPLACES the pending remainder (see dispatch.js). So walking
  // continuously is an unbroken cadence, and the moment you stop, the last two
  // land as the settle of arriving somewhere. Stopping is what makes the tail
  // audible, which is exactly when a listener needs to know they have arrived.
  const cadence = stepCadenceMs(actor);
  const series = { count: 4, interval: Math.max(90, Math.round(cadence / 2)), key: 'step' };

  sendToPlayer(actor.id, { type: 'audio_sfx_proc', tier: FULL, gain: OWN_STEP_GAIN * duck, params, series });
  sendToZone(zone, { type: 'audio_sfx_proc', tier: FULL, gain: OTHERS_STEP_GAIN * duck, params, series }, actor.id);
});

// The gait map is per-session and cosmetic; drop it with the session rather than
// letting it accumulate a row per character who has ever walked.
on('player.logout', ({ id }) => { gait.delete(id); });

// A door's `door_type` and its `lock:<family>` tag have both been authored on
// every door in the game for as long as there have been doors. So this reads what
// is already there — no new field, no content pass, and a door built in the dev
// panel tomorrow is audible without anyone opening this file.
const LOCK_TAG = /^lock:(.+)$/;

export function lockFamilyOf(door) {
  for (const key of Object.keys(door?.tags || {})) {
    const m = LOCK_TAG.exec(key);
    if (m) return m[1];
  }
  return null;
}

on('door.sfx', ({ door, zoneId, actorId, cue }) => {
  if (!door || !zoneId) return;
  const family = lockFamilyOf(door);
  const params = (cue === 'lock' || cue === 'unlock' || cue === 'denied')
    ? { action: 'lock', surface: family || 'deadbolt', state: cue }
    : {
        action: 'door', surface: door.door_type || 'basic', state: cue === 'close' ? 'close' : 'open',
        // An electronic lock is a powered door, and that is the whole test — a
        // servo you can hear is a door somebody paid for.
        powered: !!family && family !== 'shopshutter',
      };
  params.seed = (Math.random() * 0xffffffff) >>> 0;
  // Under the mix, like the footsteps — with one deliberate exception. A REFUSAL
  // is the one cue here whose whole job is to be noticed, because it is the only
  // way a player who is not reading finds out the door said no.
  const gain = cue === 'denied' ? 0.85 : 0.6;
  const msg = { type: 'audio_sfx_proc', tier: FULL, gain, params };
  // The actor hears their own door at full gain wherever they now stand; the room
  // hears it too. A door with no actor (the far side of a transit) is room-only.
  if (actorId) sendToPlayer(actorId, msg);
  sendToZone(zoneId, msg, actorId || null);
});

// Pissing and farting are PUBLIC. Both used to be hand-authored — the stream was
// one fixed sound whatever the pressure behind it, and went only to the person
// doing it, so a man relieving himself in a crowded bar was silent to the bar.
// Both now run through the procedural transport: parameters and a seed, scaled
// by how badly the character needed it, heard by the whole room.
const STREAM_PHASE = { stream: 'steady', stream_start: 'start', stream_fade: 'fade', stream_dribble: 'dribble', final_drip: 'dribble' };

on('bodily.sfx', ({ zoneId, playerId, cue, surface, intensity, style }) => {
  const proc = (params, gain) => {
    const msg = { type: 'audio_sfx_proc', gain, params: { ...params, seed: (Math.random() * 0xffffffff) >>> 0 } };
    if (zoneId) sendToZone(zoneId, msg);
    else if (playerId) sendToPlayer(playerId, msg);
  };

  if (STREAM_PHASE[cue]) {
    proc({ action: 'stream', surface, intensity: intensity ?? 0.6, state: STREAM_PHASE[cue] },
      cue === 'stream_fade' ? 0.7 : cue === 'final_drip' ? 0.6 : 0.9);
    return;
  }
  if (cue === 'fart' || cue === 'finale') {
    // `finale` is the end of a bowel movement — always a big one.
    // `state` is how the transport carries a style token to any generator.
    proc({ action: 'flatus', intensity: cue === 'finale' ? Math.max(0.8, intensity ?? 0.8) : (intensity ?? 0.5), state: style });
    return;
  }
  if (!zoneId) return;
  if (cue === 'flush') { sendToZone(zoneId, { type: 'audio_sfx', def: SFX_FLUSH }); return; }
  // SFX_PLOP is a wet drop — a body of water closing over something. That is only
  // true over a bowl. On concrete, on a chair, on a person, the same cue announces
  // a toilet the room hasn't got, which is the audible half of the lie the fart
  // lines used to tell in text. Anything that isn't water gets a dull landing
  // instead: `none` deliberately, not the stream's own surface name — the impact
  // table knows wood/metal/ceramic and would silently fall back to `none` anyway,
  // and passing a key it doesn't have would read as a lookup that means something.
  // Concrete and flesh are both non-resonant here; INTENSITY is what separates
  // them, because the transport carries no `weight` — `impact` derives weight from
  // intensity, so the one number has to do both jobs. Higher reads heavier and
  // duller, which is soft ground and a body; lower is the sharper, shorter tap of
  // paving.
  if (cue === 'plop') {
    if (surface && surface !== 'water') {
      proc({ action: 'impact', surface: 'none', intensity: surface === 'concrete' ? 0.3 : 0.65 }, 0.5);
      return;
    }
    sendToZone(zoneId, { type: 'audio_sfx', def: SFX_PLOP });
    return;
  }
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
  acid:         'weather.ambient.rain',
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
  if (kind === 'thunderstorm' || kind === 'drizzle' || kind === 'acid') return 'rain';
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
// competing with it; indoor zones are muffled by getWeatherLeakGain (room
// depth + closed doors) instead of a flat mult.
const WEATHER_GAIN = 0.6;
const MUFFLE_GAIN_MULT = 0.5; // per-hop cut for an outdoor tile hearing a neighboring storm cell's rain, not its own — 1 tile away = 0.5, 2 tiles = 0.25, so it spreads out

// This used to be a hand-copied version of the engine's rule, kept local because
// the audio layer only ever has a zone id — and it had already drifted once (the
// engine counts anything below ground as sheltered; this one asked only about the
// interior flags, so the Under was hearing rain fall on it). Its own comment said
// "the two must agree", which is a wish rather than a mechanism. It is now a
// one-line adapter over the engine's `isIndoorZone`, so there is nothing left to
// drift: id in, the engine's answer out.
function indoorZoneId(zoneId) {
  return isIndoorZone(getZone(zoneId));
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
  if (indoorZoneId(zoneId)) {
    const leak = getWeatherLeakGain(zoneId);
    if (desired.precip) desired.precip.gain *= leak;
    if (desired.wind)   desired.wind.gain   *= leak;
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

// ── Named weather-event soundscape (ion storm / acid rain) ─────────────────
// A single sky-wide ambience bed, phase-scaled, driven by the engine's
// `weather.event` signal (fired on each approach→peak→passing transition).
// Separate from the per-zone precip/wind beds so an ion storm — which has no
// precip — still has a voice. Route-overridable via the event-route table; a
// synthesized bed plays out of the box otherwise. See systems-weather-extreme.md.
// A rainbow is routable but has NO fallback below, and that is the authored
// answer rather than an omission: the sky going quiet after a shower is the
// sound of a rainbow. The route exists so a bed can be given one later without
// touching this file.
const WEATHER_EVENT_ROUTES = { ion_storm: 'weather.event.ion', acid_rain: 'weather.event.acid', rainbow: 'weather.event.rainbow', triple_rainbow: 'weather.event.rainbow' };
const WEATHER_EVENT_FALLBACK = {
  // Electrical hum + high crackle, with random arcing zaps (sparkle one-shots).
  ion_storm: { id: 'wx_ev_ion', name: 'wx_ev_ion', category: 'ambient', priority: 3, config: { gain: 0.6,
    layers: [
      { waveform: 'sawtooth', freq: 58, filter: { type: 'lowpass', freq: 380, q: 0.7 }, tremolo: { rate: 0.5, depth: 0.4 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.22 },
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2600, q: 1.3 }, tremolo: { rate: 7, depth: 0.7 }, adsr: { a: 1.5, d: 0, s: 1, r: 1.5 }, gain: 0.18 },
    ],
    sparkle: [
      { everyMin: 1.5, everyMax: 5, prob: 0.85, gain: 0.4, duration: 0.16, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3500, q: 0.7 }, adsr: { a: 0.001, d: 0.05, s: 0.2, r: 0.1 }, gain: 0.5 },
        { waveform: 'square', freq: 1900, pitchBend: { to: 380, time: 0.14 }, adsr: { a: 0.001, d: 0.04, s: 0.1, r: 0.08 }, gain: 0.18 },
      ] },
    ],
  } },
  // Caustic hiss/sizzle — high, corrosive filtered noise.
  acid_rain: { id: 'wx_ev_acid', name: 'wx_ev_acid', category: 'ambient', priority: 3, config: { gain: 0.5,
    layers: [
      { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2800, q: 0.7 }, adsr: { a: 1.5, d: 0, s: 1, r: 1.5 }, gain: 0.34 },
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 5200, q: 1.4 }, tremolo: { rate: 3, depth: 0.3 }, adsr: { a: 1.5, d: 0, s: 0.7, r: 1.5 }, gain: 0.2 },
    ],
    // The bed alone is a flat hiss. These are the individual spatters — a drop
    // finding metal and going to work on it — and they're what makes the sound
    // read as corrosive rather than as static. Faster and quieter than the ion
    // zaps: acid is constant and everywhere, lightning is an event.
    sparkle: [
      { everyMin: 0.6, everyMax: 2.2, prob: 0.9, gain: 0.3, duration: 0.3, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 4200, q: 2.2 }, adsr: { a: 0.01, d: 0.12, s: 0.3, r: 0.18 }, gain: 0.42 },
        { waveform: 'sawtooth', freq: 240, pitchBend: { to: 90, time: 0.28 }, filter: { type: 'lowpass', freq: 900, q: 0.8 }, adsr: { a: 0.02, d: 0.1, s: 0.2, r: 0.16 }, gain: 0.12 },
      ] },
    ],
  } },
};

function weatherEventDef(type) {
  if (!type) return null;
  const routes = eventRoutes.get(WEATHER_EVENT_ROUTES[type]);
  const routed = routes?.find(r => r.ambient_id);
  if (routed) { const d = ambient.get(routed.ambient_id); if (d) return d; }
  return WEATHER_EVENT_FALLBACK[type] || null;
}
function weatherEventGain(phase) { return phase === 'peak' ? 0.6 : 0.32; }  // full at peak, softer in approach/passing

let weatherEventBed = null;       // { id } currently playing globally | null
let currentWeatherEvent = null;   // { type, phase } | null — for late-joiner top-up

function reconcileWeatherEventBed(type, phase) {
  currentWeatherEvent = type ? { type, phase } : null;
  const def = weatherEventDef(type);
  const desiredId = def?.id || null;
  const bc = getBroadcast();
  if (!bc) { weatherEventBed = desiredId ? { id: desiredId } : null; return; }
  if (desiredId !== (weatherEventBed?.id || null)) {
    if (weatherEventBed) bc(null, { type: 'audio_stop', scope: 'ambience', id: weatherEventBed.id });
    if (def) {
      bc(null, { type: 'audio_ambience', def });
      bc(null, { type: 'audio_loop_gain', id: desiredId, gain: weatherEventGain(phase), ramp: 1.5 });
    }
    weatherEventBed = desiredId ? { id: desiredId } : null;
  } else if (desiredId) {
    bc(null, { type: 'audio_loop_gain', id: desiredId, gain: weatherEventGain(phase), ramp: 2.5 });
  }
}

on('weather.event', ({ type, phase }) => reconcileWeatherEventBed(type, phase));

// Top up a single player on zone entry: clear any weather beds, then start the
// ones their new tile warrants at the right reactive gains — muffled indoors.
function reconcilePlayerWeatherAmbient(playerId, zoneId) {
  if (!playerId || !zoneId) return;
  // Sample weather from the outdoor tile that actually leaks into this zone —
  // never the interior zone itself (it's off map_world, so getZonePrecip on it
  // falls back to the map-wide roll and every building would hear rain that's
  // only falling somewhere else on the map) and never the global precip type.
  const { outdoorZoneId, gain: mult } = getWeatherLeakSource(zoneId);
  const desired = [];
  const { precipType, precipRate } = outdoorZoneId ? getZonePrecip(outdoorZoneId) : { precipType: 'none', precipRate: 0 };
  if (precipRate && precipType !== 'none') {
    const d = weatherAmbientDef(precipType);
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
  // A sky-wide named event is in progress — start its bed for this joiner too.
  if (currentWeatherEvent) {
    const d = weatherEventDef(currentWeatherEvent.type);
    if (d) {
      sendToPlayer(playerId, { type: 'audio_ambience', def: d });
      sendToPlayer(playerId, { type: 'audio_loop_gain', id: d.id, gain: weatherEventGain(currentWeatherEvent.phase), ramp: 0.4 });
    }
  }
}

// Zones reachable from any of `startIds` within `maxHops` room-crossings (BFS,
// door-agnostic — just needs to cover every zone whose weather leak-gain could
// have shifted).
function collectZonesWithinHops(startIds, maxHops) {
  const seen = new Set(startIds);
  let frontier = [...startIds];
  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    const next = [];
    for (const zid of frontier) {
      const zone = getZone(zid);
      if (!zone) continue;
      for (const nid of neighborZoneIds(zone)) {
        if (!seen.has(nid)) { seen.add(nid); next.push(nid); }
      }
    }
    frontier = next;
  }
  return seen;
}

// A door opening/closing changes the weather leak-gain for every room behind
// it, live — not just for players who walk in after. Re-reconcile occupied
// zones within reach of the toggled door.
on('door.toggled', ({ zoneId, targetZoneId }) => {
  const starts = [zoneId, targetZoneId].filter(Boolean);
  if (!starts.length) return;
  for (const zid of collectZonesWithinHops(starts, 5)) {
    for (const p of getZonePlayers(zid)) reconcilePlayerWeatherAmbient(p.id, zid);
  }
});

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

export const routeHandler = async (path, method, body, auth, reqHeaders) => {
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
      // GET /audio/samples/:id/data — returns base64 blob; open to game client (no dev auth needed for GET).
      // Sample blobs are large and change rarely (only on re-upload), so we cache with
      // revalidation: an ETag (server-side md5, no blob transfer to compute) lets a
      // returning browser send If-None-Match and get a bodyless 304 instead of re-downloading.
      // must-revalidate + short max-age keeps a re-encode from serving stale audio for long.
      if (id && parts[3] === 'data' && method === 'GET') {
        // Content-backed (production): the blob is in the git checkout — serve it
        // from disk, zero DB egress. The etag is md5 of the same base64 text
        // Postgres would hash, so browser caches survive the source switch.
        if (contentBacked) {
          const doc = sampleFileById(id);
          if (!doc || doc.data == null) return { status: 404, body: { error: 'Not found' } };
          let etag = sampleEtags.get(id);
          if (!etag) { etag = `"${createHash('md5').update(doc.data).digest('hex')}"`; sampleEtags.set(id, etag); }
          const headers = { 'Cache-Control': 'public, max-age=3600, must-revalidate', 'ETag': etag };
          if (reqHeaders?.['if-none-match'] === etag) return { status: 304, headers };
          return { status: 200, headers, body: { data: doc.data } };
        }
        const meta = await query('SELECT md5(data) AS etag FROM audio_samples WHERE id=$1', [id]);
        if (!meta.rows[0] || meta.rows[0].etag == null) return { status: 404, body: { error: 'Not found' } };
        const etag = `"${meta.rows[0].etag}"`;
        const headers = { 'Cache-Control': 'public, max-age=3600, must-revalidate', 'ETag': etag };
        if (reqHeaders?.['if-none-match'] === etag) return { status: 304, headers };
        const { rows } = await query('SELECT data FROM audio_samples WHERE id=$1', [id]);
        if (!rows[0]) return { status: 404, body: { error: 'Not found' } };
        return { status: 200, headers, body: { data: rows[0].data } };
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

  // ── /audio/interface-sfx: overrides for the client SFX catalog ───────────
  // The built-in cue defs live in client/shared/sfx-catalog.js; rows here are
  // per-cue overrides keyed by catalog id. GET is public (the game client fetches
  // it at boot); PUT/DELETE are dev-gated by the guard at the top of this handler.
  if (resource === 'interface-sfx') {
    try {
      if (!id && method === 'GET') {
        const { rows } = await query('SELECT * FROM interface_sfx ORDER BY grp, id');
        return { status: 200, body: rows };
      }
      if (id && method === 'PUT') {
        const name = (body.name ?? '').toString();
        const grp = (body.grp ?? 'misc').toString();
        const priority = Number.isFinite(body.priority) ? Math.round(body.priority) : 5;
        const enabled = body.enabled === false || body.enabled === 0 ? 0 : 1;
        const config = JSON.stringify(body.config ?? {});
        await query(
          `INSERT INTO interface_sfx (id, name, grp, config, priority, enabled) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET name=$2, grp=$3, config=$4, priority=$5, enabled=$6`,
          [id, name, grp, config, priority, enabled],
        );
        return { status: 200, body: { id } };
      }
      if (id && method === 'DELETE') {
        await query('DELETE FROM interface_sfx WHERE id=$1', [id]);
        return { status: 200, body: { message: 'Reset to default' } };
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
