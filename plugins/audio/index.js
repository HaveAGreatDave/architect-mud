import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';

// ── In-memory library cache (loaded from DB at boot, refreshed after CRUD) ──

const instruments = new Map(); // id -> row
const songs = new Map();       // id -> row
const sfx = new Map();         // id -> row
const ambient = new Map();     // id -> row

// name -> id, so event handlers below can reference assets by human name
// without hardcoding ids. Falls back to no-op if the named asset isn't seeded.
const byName = { sfx: new Map(), songs: new Map(), ambient: new Map() };

export async function loadAudioLibrary() {
  const [i, s, fx, am] = await Promise.all([
    query('SELECT * FROM audio_instruments'),
    query('SELECT * FROM audio_songs'),
    query('SELECT * FROM audio_sfx'),
    query('SELECT * FROM audio_ambient'),
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

// ── Event wiring — server decides what plays, client just renders it ───────

function resolveSongInstruments(song) {
  const ids = Array.isArray(song.instrument_ids) ? song.instrument_ids : [];
  const _instrumentsById = {};
  for (const id of ids) { const row = instruments.get(id); if (row) _instrumentsById[id] = row; }
  return { ...song, _instrumentsById };
}

on('zone.entered', ({ zone: zoneId }) => {
  const zone = getZone(zoneId);
  if (!zone?.audio_theme_id) return;
  const song = songs.get(zone.audio_theme_id);
  if (!song) return;
  sendToZone(zoneId, { type: 'audio_music', def: resolveSongInstruments(song) });
  emit('audio.music.changed', { zoneId, songId: song.id });
});

on('enemy.attacked', ({ actor }) => {
  const def = sfxByName('combat_hit');
  if (def && actor?.current_zone) sendToZone(actor.current_zone, { type: 'audio_sfx', def });
});

on('enemy.killed', ({ actor }) => {
  const def = sfxByName('combat_death');
  if (def && actor?.current_zone) {
    sendToZone(actor.current_zone, { type: 'audio_sfx', def });
    emit('audio.sfx.triggered', { sfxId: def.id, zoneId: actor.current_zone });
  }
});

on('player.death', ({ player }) => {
  const def = sfxByName('combat_death');
  if (def && player?.id) sendToPlayer(player.id, { type: 'audio_sfx', def });
});

on('item.taken', ({ actor }) => {
  const def = sfxByName('ui_button');
  if (def && actor?.id) sendToPlayer(actor.id, { type: 'audio_sfx', def });
});

on('item.dropped', ({ actor }) => {
  const def = sfxByName('ui_button');
  if (def && actor?.id) sendToPlayer(actor.id, { type: 'audio_sfx', def });
});

// device.tuned fires on every TV/radio channel change (plugins/broadcast).
// Channel-change audio is shared multiplayer state (everyone looking at the
// same screen hears it), so it's server-driven like everything else here.
// The steady CRT hum while a TV panel is open is per-viewer UI ambience and
// is handled entirely client-side in client/game/js/panels/tv.js instead.
on('device.tuned', async ({ furnitureId }) => {
  if (!furnitureId) return;
  const { rows } = await query('SELECT zone_id FROM furniture WHERE id=$1', [furnitureId]);
  const targetZone = rows[0]?.zone_id;
  if (!targetZone) return;
  for (const name of ['tv_tuning_sweep', 'tv_static_burst', 'tv_relay_click']) {
    const def = sfxByName(name);
    if (def) sendToZone(targetZone, { type: 'audio_sfx', def });
  }
});

// ── Dev panel CRUD ────────────────────────────────────────────────────────

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

const TABLES = {
  instruments: { table: 'audio_instruments', cache: instruments, cols: ['name', 'category', 'waveform', 'config', 'enabled'] },
  songs: { table: 'audio_songs', cache: songs, cols: ['name', 'category', 'tempo', 'channels', 'loop_start', 'loop_end', 'instrument_ids', 'priority', 'enabled'] },
  sfx: { table: 'audio_sfx', cache: sfx, cols: ['name', 'category', 'priority', 'config', 'enabled'] },
  ambient: { table: 'audio_ambient', cache: ambient, cols: ['name', 'category', 'priority', 'config', 'loop', 'enabled'] },
};

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
  const id = parts[2];
  const spec = TABLES[resource];
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
