import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { propagateAudio } from '../../server/engine/sounds.js';

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
});

on('player.logout', ({ id }) => {
  triggerEventRoute('player.logout', null, id);
});

on('zone.entered', ({ actor, zone: zoneId }) => {
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
  if (!triggerEventRoute('weather.thunder', zoneId, null)) {
    const def = sfxByName('thunder');
    if (def && zoneId) propagateAudio(zoneId, def, 1.0, (z, msg) => sendToZone(z, msg));
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
  songs: { table: 'audio_songs', cache: songs, cols: ['name', 'category', 'tempo', 'channels', 'loop_start', 'loop_end', 'instrument_ids', 'priority', 'enabled'] },
  sfx: { table: 'audio_sfx', cache: sfx, cols: ['name', 'category', 'priority', 'config', 'enabled'] },
  ambient: { table: 'audio_ambient', cache: ambient, cols: ['name', 'category', 'priority', 'config', 'loop', 'enabled'] },
};

// event_routes uses a UUID id PK; event_name is a plain indexed column allowing
// multiple routes per event (random selection at runtime).
const EVENT_ROUTE_COLS = ['event_name', 'sfx_id', 'ambient_id', 'song_id', 'sample_id', 'scope', 'enabled'];

const JSONB_COLS = new Set(['config', 'channels', 'instrument_ids']);

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
