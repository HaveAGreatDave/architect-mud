// Audio editor — procedural Web Audio playback (music/SFX/ambience). Separate
// from the existing Sounds panel (panels/sounds.js), which is the text-based
// gameplay Sound system. Never merge the two.
//
// Functional forms + instant local preview, no canvas/timeline editor yet
// (that's a deferred phase-2 piece). Preview buttons call window.AudioEngine
// directly against the browser's own AudioContext — no server round-trip.

const AUDIO_CATEGORIES = ['ui', 'combat', 'cyberpunk', 'environment', 'tv', 'misc'];
const WAVEFORMS = ['square', 'sine', 'triangle', 'sawtooth', 'noise'];

// Known event names for the Events tab dropdown — users can also type custom ones.
const KNOWN_EVENTS = [
  'enemy.attacked', 'enemy.killed', 'player.death',
  'item.taken', 'item.dropped', 'device.tuned',
  'weather.rain', 'weather.storm', 'weather.clear', 'weather.snow', 'weather.thunder',
  'time.dawn', 'time.dusk', 'time.midnight',
  'quest.completed', 'zone.entered',
];

// Field whitelist per asset type, mirrors the column lists in plugins/audio/index.js's
// TABLES spec — used for both export (what to dump) and import (what to accept).
// Everything in this system is a JSON parameter object (waveform/ADSR/filter recipes,
// tracker patterns), never a recorded sample, so JSON is the only format that makes
// sense — there's no waveform data to import, just synth presets to share/back up.
const AUDIO_IMPORT_FIELDS = {
  instruments: ['name', 'category', 'waveform', 'config', 'enabled', 'sample_id'],
  songs: ['name', 'category', 'tempo', 'channels', 'loop_start', 'loop_end', 'instrument_ids', 'priority', 'enabled'],
  sfx: ['name', 'category', 'priority', 'config', 'enabled'],
  ambient: ['name', 'category', 'priority', 'config', 'loop', 'enabled'],
  samples: ['name', 'category', 'priority', 'data', 'mime_type', 'base_note', 'loop_start', 'loop_end', 'snes_rate', 'snes_bits', 'echo_mix', 'config', 'enabled'],
};

let _audioTab = 'instruments';
let _audioData = { instruments: [], songs: [], sfx: [], ambient: [], events: [], samples: [] };
let _playingSongId = null;

function renderAudioPanel(data) {
  _audioData = {
    instruments: Array.isArray(data?.instruments) ? data.instruments : [],
    songs: Array.isArray(data?.songs) ? data.songs : [],
    sfx: Array.isArray(data?.sfx) ? data.sfx : [],
    ambient: Array.isArray(data?.ambient) ? data.ambient : [],
    events: Array.isArray(data?.events) ? data.events : [],
    samples: Array.isArray(data?.samples) ? data.samples : [],
  };
  const panel = document.getElementById('list-panel');
  const tabs = [
    ['instruments', 'Instruments'],
    ['songs', 'Songs'],
    ['sfx', 'Sound Effects'],
    ['ambient', 'Ambient'],
    ['samples', 'Samples'],
    ['events', 'Event Routes'],
  ];
  const tabBar = tabs.map(([key, label]) => `
    <button class="action-btn${_audioTab === key ? ' selected' : ''}" style="${_audioTab === key ? 'background:var(--accent);color:#000' : ''}" onclick="setAudioTab('${key}')">${label} (${_audioData[key].length})</button>
  `).join('');

  panel.innerHTML = `
    <div style="padding:10px 16px;border-bottom:2px solid var(--border);background:var(--bg2);display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;gap:6px">${tabBar}</div>
      <div style="display:flex;gap:6px">
        <button class="action-btn danger" onclick="stopAllAudioPreviews()">⏹ Stop</button>
        ${_audioTab !== 'events' ? `<button class="action-btn" onclick="openAudioImportModal('${_audioTab}')">⬆ Load</button>` : ''}
        <button class="action-btn" onclick="newAudioAsset('${_audioTab}')">+ New ${tabs.find(t => t[0] === _audioTab)[1]}</button>
      </div>
    </div>
    <div id="audio-tab-body"></div>
  `;
  renderAudioTabBody();
}

function setAudioTab(tab) {
  _audioTab = tab;
  renderAudioPanel(_audioData);
}

function renderAudioTabBody() {
  const body = document.getElementById('audio-tab-body');
  const rows = _audioData[_audioTab];

  if (_audioTab === 'events') {
    if (!rows.length) { body.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No event routes configured. Add one to map a game event to audio.</div>'; return; }
    const sfxMap = Object.fromEntries(_audioData.sfx.map(r => [r.id, r.name]));
    const ambMap = Object.fromEntries(_audioData.ambient.map(r => [r.id, r.name]));
    const songMap = Object.fromEntries(_audioData.songs.map(r => [r.id, r.name]));
    const cells = rows.map(r => {
      const parts = [];
      if (r.sfx_id) parts.push(`SFX: ${sfxMap[r.sfx_id] || r.sfx_id}`);
      if (r.ambient_id) parts.push(`Ambient: ${ambMap[r.ambient_id] || r.ambient_id}`);
      if (r.song_id) parts.push(`Song: ${songMap[r.song_id] || r.song_id}`);
      const scope = r.scope === 'player' ? '🎧 player' : '📡 zone';
      return `<tr>
        <td style="font-weight:600;color:${r.enabled !== 0 ? 'var(--text-bright)' : 'var(--text-dim)'}">${r.event_name}</td>
        <td style="font-size:11px;color:var(--text-dim)">${parts.join(' · ') || '(no audio assigned)'}</td>
        <td style="font-size:11px;color:var(--accent)">${scope}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="editEventRoute('${r.event_name.replace(/'/g, "\\'")}')">✏</button>
          <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteEventRoute('${r.event_name.replace(/'/g, "\\'")}')">✕</button>
        </td>
      </tr>`;
    }).join('');
    body.innerHTML = `<table><thead><tr><th>Event</th><th>Audio</th><th>Scope</th><th></th></tr></thead><tbody>${cells}</tbody></table>`;
    return;
  }

  if (_audioTab === 'samples') {
    if (!rows.length) { body.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No samples uploaded yet.</div>'; return; }
    const cells = rows.map(r => `<tr>
      <td style="font-weight:600;color:${r.enabled !== 0 ? 'var(--text-bright)' : 'var(--text-dim)'}">${r.name}</td>
      <td><span style="font-size:10px;background:var(--bg3);padding:2px 6px;border-radius:2px;color:var(--accent)">${r.category}</span></td>
      <td style="font-size:11px;color:var(--text-dim)">${r.snes_rate || 16000}Hz · ${r.snes_bits || 4}-bit${r.echo_mix > 0 ? ' · echo' : ''}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="previewAudioAsset('samples','${r.id}')">▶</button>
        <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="editAudioAsset('samples','${r.id}')">✏</button>
        <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="exportAudioAsset('samples','${r.id}')" title="Export as JSON">⬇</button>
        <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteAudioAsset('samples','${r.id}','${r.name.replace(/'/g, "\\'")}')">✕</button>
      </td>
    </tr>`).join('');
    body.innerHTML = `<table><thead><tr><th>Name</th><th>Category</th><th>SNES</th><th></th></tr></thead><tbody>${cells}</tbody></table>`;
    return;
  }

  if (!rows.length) { body.innerHTML = '<div style="padding:24px;color:var(--text-dim)">Nothing here yet.</div>'; return; }

  const cells = rows.map(r => {
    const extra = _audioTab === 'instruments'
      ? (r.sample_id ? `sample: ${_audioData.samples.find(s => s.id === r.sample_id)?.name || r.sample_id}` : r.waveform)
      : _audioTab === 'songs' ? `${r.tempo || 120} BPM`
      : `priority ${r.priority ?? 5}`;
    return `<tr>
      <td style="font-weight:600;color:${r.enabled !== 0 ? 'var(--text-bright)' : 'var(--text-dim)'}">${r.name}</td>
      <td><span style="font-size:10px;background:var(--bg3);padding:2px 6px;border-radius:2px;color:var(--accent)">${r.category}</span></td>
      <td style="font-size:11px;color:var(--text-dim)">${extra}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="action-btn${_audioTab === 'songs' && r.id === _playingSongId ? ' danger' : ''}" style="font-size:10px;padding:3px 8px" onclick="previewAudioAsset('${_audioTab}','${r.id}')">${_audioTab === 'songs' && r.id === _playingSongId ? '⏹' : '▶'}</button>
        <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="editAudioAsset('${_audioTab}','${r.id}')">✏</button>
        <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="exportAudioAsset('${_audioTab}','${r.id}')" title="Export as JSON">⬇</button>
        <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteAudioAsset('${_audioTab}','${r.id}','${r.name.replace(/'/g, "\\'")}')">✕</button>
      </td>
    </tr>`;
  }).join('');

  body.innerHTML = `<table><thead><tr><th>Name</th><th>Category</th><th></th><th></th></tr></thead><tbody>${cells}</tbody></table>`;
}

function findAudioAsset(tab, id) { return _audioData[tab].find(r => r.id === id); }

// ── Preview (local-only, no server round-trip) ──────────────────────────────

function previewAudioAsset(tab, id) {
  window.AudioEngine?.init();
  const row = findAudioAsset(tab, id);
  if (!row) return;
  if (tab === 'sfx') window.AudioEngine.playSfx(row);
  else if (tab === 'samples') window.AudioEngine.playSample(row);
  else if (tab === 'instruments') window.AudioEngine.playSfx({ priority: 5, category: 'sfx', config: { ...(row.config || {}), waveform: row.waveform, freq: 440, duration: 0.6 } });
  else if (tab === 'ambient') { window.AudioEngine.loopSound(row); setTimeout(() => window.AudioEngine.stopLoop(row.id), 4000); }
  else if (tab === 'songs') {
    if (_playingSongId === id) {
      stopAllAudioPreviews();
      return;
    }
    _playingSongId = id;
    renderAudioTabBody();
    const _instrumentsById = {};
    for (const instId of (row.instrument_ids || [])) {
      const inst = _audioData.instruments.find(i => i.id === instId);
      if (inst) _instrumentsById[instId] = inst;
    }
    window.AudioEngine.playMusic({ ...row, _instrumentsById });
  }
}

// Halts whatever a Preview button started: the looping song player and any
// ambient loop preview (SFX one-shots are too short to need stopping, and
// free themselves on their own envelope/timeout already).
function stopAllAudioPreviews() {
  window.AudioEngine?.stopMusic();
  window.AudioEngine?.stop('ambience');
  _playingSongId = null;
  renderAudioTabBody();
}

// ── Import / Export (JSON presets — never real audio files, see note above) ──

function exportAudioAsset(tab, id) {
  const row = findAudioAsset(tab, id);
  if (!row) return;
  const data = {};
  for (const f of AUDIO_IMPORT_FIELDS[tab]) data[f] = row[f];
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${tab}_${row.name.replace(/[^a-z0-9_-]/gi, '_')}.amp`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openAudioImportModal(tab) {
  const modal = document.getElementById('generic-modal');
  document.getElementById('modal-title').textContent = `Load ${tab} preset(s)`;
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>Upload .json file <span style="color:var(--text-dim);font-weight:400">(exported from this panel, or hand-written)</span></label>
      <input type="file" id="ai-file" accept=".amp,.json,application/json">
    </div>
    <div class="field" style="margin-top:10px"><label>...or paste JSON <span style="color:var(--text-dim);font-weight:400">(a single preset object, or an array of presets)</span></label>
      <textarea id="ai-json" rows="10" style="resize:vertical;font-family:monospace;font-size:11px" placeholder='{"name": "my_sound", "category": "misc", "config": {...}}'></textarea>
    </div>`;
  document.getElementById('ai-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { document.getElementById('ai-json').value = reader.result; };
    reader.readAsText(file);
  });
  const saveBtn = document.getElementById('modal-save');
  saveBtn.textContent = 'Import';
  saveBtn.onclick = async () => {
    let parsed;
    try { parsed = JSON.parse(document.getElementById('ai-json').value); }
    catch { toast('Invalid JSON', true); return; }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const fields = AUDIO_IMPORT_FIELDS[tab];
    let imported = 0;
    for (const item of items) {
      if (!item?.name) continue;
      const body = {};
      for (const f of fields) if (item[f] !== undefined) body[f] = item[f];
      // Always create new rows on import — never carries the source id across,
      // so importing can't silently overwrite an existing asset by id collision.
      const r = await API(`/audio/${tab}`, 'POST', body);
      if (!r?.error) imported++;
    }
    toast(`Imported ${imported} of ${items.length} preset(s)`, imported < items.length);
    closeModal();
    loadPanel('audio');
  };
  modal.style.display = 'flex';
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

function newAudioAsset(tab) {
  if (tab === 'events') { openEventRouteModal(null); return; }
  openAudioModal(tab, {});
}
function editAudioAsset(tab, id) { openAudioModal(tab, findAudioAsset(tab, id) || {}); }
function editEventRoute(eventName) {
  const row = _audioData.events.find(r => r.event_name === eventName);
  openEventRouteModal(row || null);
}

async function deleteAudioAsset(tab, id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  await API(`/audio/${tab}/${id}`, 'DELETE');
  toast(`"${name}" deleted`);
  loadPanel('audio');
}

async function deleteEventRoute(eventName) {
  if (!confirm(`Remove route for "${eventName}"?`)) return;
  await API(`/audio/events/${encodeURIComponent(eventName)}`, 'DELETE');
  toast(`Route for "${eventName}" removed`);
  loadPanel('audio');
}

function _assetOptions(list, current, noneLabel) {
  return `<option value="">${noneLabel}</option>` +
    list.map(r => `<option value="${r.id}" ${r.id === current ? 'selected' : ''}>${r.name}</option>`).join('');
}

async function openEventRouteModal(row) {
  const isNew = !row;
  const modal = document.getElementById('generic-modal');
  document.getElementById('modal-title').textContent = isNew ? 'New Event Route' : `Edit: ${row.event_name}`;
  const zones = await API('/zones').catch(() => []);
  const zoneOpts = Array.isArray(zones)
    ? zones.map(z => `<option value="zone.entered.${z.id}" label="${(z.name || z.id).replace(/"/g, '&quot;')}">`)
    : [];
  document.getElementById('modal-body').innerHTML = `
    <div class="field">
      <label>Event Name <span style="color:var(--text-dim);font-weight:400">(type or choose from list)</span></label>
      <input id="er-event" list="er-events-list" autocomplete="off" value="${row?.event_name || ''}" placeholder="e.g. weather.rain">
      <datalist id="er-events-list">
        ${KNOWN_EVENTS.map(e => `<option value="${e}">`).join('')}
        ${zoneOpts.join('')}
      </datalist>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
      <div class="field"><label>SFX (one-shot)</label>
        <select id="er-sfx">${_assetOptions(_audioData.sfx, row?.sfx_id, '— none —')}</select></div>
      <div class="field"><label>Sample (SNES one-shot)</label>
        <select id="er-sample">${_assetOptions(_audioData.samples, row?.sample_id, '— none —')}</select></div>
      <div class="field"><label>Ambient (loop)</label>
        <select id="er-ambient">${_assetOptions(_audioData.ambient, row?.ambient_id, '— none —')}</select></div>
      <div class="field"><label>Song (music)</label>
        <select id="er-song">${_assetOptions(_audioData.songs, row?.song_id, '— none —')}</select></div>
    </div>
    <div style="display:flex;align-items:center;gap:24px;margin-top:12px">
      <div class="field" style="margin:0"><label>Scope</label>
        <select id="er-scope">
          <option value="zone" ${(row?.scope || 'zone') === 'zone' ? 'selected' : ''}>zone — everyone in the zone hears it</option>
          <option value="player" ${row?.scope === 'player' ? 'selected' : ''}>player — only the triggering player hears it</option>
        </select></div>
      <span><input type="checkbox" id="er-enabled" ${row?.enabled !== 0 ? 'checked' : ''}>
        <label for="er-enabled" style="margin:0;cursor:pointer">Enabled</label></span>
    </div>
    <div style="margin-top:14px;padding:10px;background:var(--bg3);border-radius:4px;font-size:11px;color:var(--text-dim)">
      <strong>How this works:</strong> when the server emits the event, the plugin checks this table first.
      If a route is configured it plays those assets; otherwise the plugin falls back to its hardcoded defaults
      (e.g. <code>enemy.attacked</code> defaults to the <em>combat_hit</em> SFX). You can override any default
      or add routes for new events like <code>weather.rain</code> that have no built-in audio yet.
    </div>`;
  const saveBtn = document.getElementById('modal-save');
  saveBtn.textContent = 'Save';
  saveBtn.onclick = async () => {
    const eventName = document.getElementById('er-event').value.trim();
    if (!eventName) { toast('Event name is required', true); return; }
    const body = {
      event_name: eventName,
      sfx_id: document.getElementById('er-sfx').value || null,
      sample_id: document.getElementById('er-sample').value || null,
      ambient_id: document.getElementById('er-ambient').value || null,
      song_id: document.getElementById('er-song').value || null,
      scope: document.getElementById('er-scope').value,
      enabled: document.getElementById('er-enabled').checked ? 1 : 0,
    };
    // Always POST — the plugin uses ON CONFLICT DO UPDATE (upsert by event_name).
    const r = await API('/audio/events', 'POST', body);
    if (r?.error) { toast(r.error, true); return; }
    toast(isNew ? 'Route created' : 'Route updated');
    closeModal(); loadPanel('audio');
  };
  modal.style.display = 'flex';
}

// ── Step Sequencer ────────────────────────────────────────────────────────────

let _sqCh = [];
let _sqBars = 4;
let _sqView = 'grid';
let _sqPop = null;
let _sqPlaying = false;

const _SQ_NOTES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

function _sqNoteOpts(cur) {
  return [2,3,4,5,6].flatMap(o =>
    _SQ_NOTES.map(n => { const v=n+o; return `<option value="${v}"${v===cur?' selected':''}>${v}</option>`; })
  ).join('');
}

function _sqInstOpts(cur) {
  return `<option value="">(none)</option>` +
    _audioData.instruments.map(i =>
      `<option value="${i.id}"${i.id===cur?' selected':''}>${i.name}</option>`
    ).join('');
}

function _sqInjectCss() {
  if (document.getElementById('sq-css')) return;
  const s = document.createElement('style');
  s.id = 'sq-css';
  s.textContent = `
.sq-vtab{padding:4px 12px;border:1px solid var(--border);background:var(--bg2);color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px}
.sq-vtab.sq-vtab-on{background:var(--accent);color:#000;border-color:var(--accent)}
.sq-lrow{height:36px;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 6px;gap:4px;background:var(--bg2);box-sizing:border-box;transition:background 0.05s,border-left 0.05s}
.sq-lrow-hdr{height:24px;border-bottom:1px solid var(--border);background:var(--bg2)}
.sq-lrow.sq-ch-active{background:rgba(0,240,255,0.10)!important;border-left:3px solid var(--accent)}
.sq-rrow{height:36px;border-bottom:1px solid var(--border);display:flex;align-items:stretch;box-sizing:border-box}
.sq-rrow-hdr{height:24px;border-bottom:1px solid var(--border);display:flex}
.sq-cell{width:18px;min-width:18px;border-right:1px solid #1c1c1c;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:6px;color:transparent;user-select:none;flex-shrink:0}
.sq-cell:hover{background:rgba(255,180,0,0.15)!important}
.sq-cell.sq-bs{border-left:2px solid #383838}
.sq-cell.sq-b4{border-left:1px solid #2a2a2a}
.sq-cell.sq-f{background:rgba(255,140,0,0.28);color:#ffa040}
.sq-cell.sq-f:hover{background:rgba(255,140,0,0.48)!important}
.sq-hcell{width:18px;min-width:18px;height:100%;border-right:1px solid #1c1c1c;display:flex;align-items:center;justify-content:center;font-size:7px;color:var(--text-dim);flex-shrink:0}
.sq-hcell.sq-bs{border-left:2px solid #383838;color:var(--accent);font-size:8px}
.sq-inst{font-size:9px;max-width:105px;flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:2px;padding:1px 2px}
.sq-note{font-size:9px;width:44px;background:var(--bg);border:1px solid var(--border);color:var(--accent);border-radius:2px;padding:1px 2px}
.sq-del{padding:1px 5px;font-size:10px;background:none;border:1px solid #443;color:#a66;border-radius:2px;cursor:pointer;flex-shrink:0}
.sq-del:hover{background:#332;color:#f99}
.sq-pop{position:fixed;z-index:9999;background:var(--bg2);border:1px solid var(--accent);border-radius:5px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:180px;font-size:11px;box-shadow:0 4px 20px rgba(0,0,0,.7)}
.sq-pop label{font-size:9px;letter-spacing:1px;color:var(--text-dim);display:block}
.sq-pop select,.sq-pop input[type=range]{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:2px 4px;border-radius:3px;font-size:11px}
.sq-pop-row{display:flex;gap:6px}
.sq-pop-del{flex:1;background:#221;border:1px solid #443;color:#f77;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:10px}
.sq-pop-ok{flex:1;background:var(--accent);border:1px solid var(--accent);color:#000;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:10px}
#sq-playhead{position:absolute;top:24px;bottom:0;width:18px;background:rgba(255,180,0,0.12);border-left:2px solid rgba(255,180,0,0.75);pointer-events:none;z-index:3;display:none}`;
  document.head.appendChild(s);
}

function _sqInit(row) {
  _sqView = 'grid';
  _sqBars = 4;
  _sqCh = [];
  if (row.channels?.length) {
    _sqCh = row.channels.map(ch => [...(ch || [])]);
    _sqBars = Math.max(1, Math.ceil((_sqCh[0]?.length || 0) / 16));
  }
  const total = _sqBars * 16;
  _sqCh = _sqCh.map(ch => {
    const a = new Array(total).fill(null);
    for (let i = 0; i < Math.min(ch.length, total); i++) a[i] = ch[i] ?? null;
    return a;
  });
}

function _sqDomVal(ch, key) {
  const counts = {};
  ch.forEach(s => { if (s?.[key]) counts[s[key]] = (counts[s[key]] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function _sqGetInstrumentIds() {
  const ids = new Set();
  document.querySelectorAll('.sq-inst').forEach(el => { if (el.value) ids.add(el.value); });
  _sqCh.forEach(ch => ch.forEach(s => { if (s?.instrument) ids.add(s.instrument); }));
  return [...ids];
}

function _sqUpdateStats() {
  const el = document.getElementById('sq-stats');
  if (!el) return;
  const tempo = parseInt(document.getElementById('sg-tempo')?.value) || 120;
  const steps = _sqBars * 16;
  const secs = Math.round(steps / (tempo * 4) * 10) / 10;
  el.textContent = `${_sqBars} bars · ${steps} steps · ~${secs}s`;
}

function _sqRender() {
  const grid = document.getElementById('sq-grid');
  if (!grid) return;
  const n = _sqBars * 16;

  // Left panel: fixed channel headers
  let leftHtml = `<div class="sq-lrow-hdr"></div>`;
  _sqCh.forEach((ch, ci) => {
    const domInst = _sqDomVal(ch, 'instrument') || '';
    const domNote = _sqDomVal(ch, 'note') || 'C4';
    leftHtml += `<div class="sq-lrow">
      <select class="sq-inst" data-ci="${ci}">${_sqInstOpts(domInst)}</select>
      <select class="sq-note" data-ci="${ci}">${_sqNoteOpts(domNote)}</select>
      <button class="sq-del" data-ci="${ci}">✕</button>
    </div>`;
  });

  // Right panel: bar labels + step rows
  let barLabelHtml = '';
  for (let s = 0; s < n; s++) {
    const isBar = s % 16 === 0;
    const lbl = isBar ? 'B' + (Math.floor(s / 16) + 1) : (s % 4 === 0 ? '·' : '');
    barLabelHtml += `<div class="sq-hcell${isBar ? ' sq-bs' : ''}">${lbl}</div>`;
  }

  let chRowsHtml = '';
  _sqCh.forEach((ch, ci) => {
    let cells = '';
    for (let s = 0; s < n; s++) {
      const st = ch[s];
      const bs = s % 16 === 0 ? ' sq-bs' : (s % 4 === 0 ? ' sq-b4' : '');
      cells += `<div class="sq-cell${bs}${st ? ' sq-f' : ''}" data-ci="${ci}" data-si="${s}">${st ? st.note : ''}</div>`;
    }
    chRowsHtml += `<div class="sq-rrow">${cells}</div>`;
  });

  grid.innerHTML = `
    <div id="sq-left" style="flex-shrink:0;width:190px;overflow:hidden;border-right:2px solid var(--border)">
      ${leftHtml}
    </div>
    <div id="sq-right" style="flex:1;overflow:auto;position:relative">
      <div id="sq-playhead"></div>
      <div class="sq-rrow-hdr">${barLabelHtml}</div>
      ${chRowsHtml}
    </div>`;

  const sqLeft = document.getElementById('sq-left');
  const sqRight = document.getElementById('sq-right');
  sqRight.addEventListener('scroll', () => { sqLeft.scrollTop = sqRight.scrollTop; });

  sqRight.querySelectorAll('.sq-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const ci = +cell.dataset.ci, si = +cell.dataset.si;
      if (_sqCh[ci][si]) {
        _sqOpenPop(cell, ci, si);
      } else {
        const inst = sqLeft.querySelector(`.sq-inst[data-ci="${ci}"]`)?.value || '';
        const note = sqLeft.querySelector(`.sq-note[data-ci="${ci}"]`)?.value || 'C4';
        _sqCh[ci][si] = { note, instrument: inst, vol: 0.6 };
        cell.classList.add('sq-f');
        cell.textContent = note;
      }
    });
  });

  sqLeft.querySelectorAll('.sq-del').forEach(btn => {
    btn.addEventListener('click', () => {
      _sqCh.splice(+btn.dataset.ci, 1);
      _sqRender();
    });
  });

  sqLeft.querySelectorAll('.sq-inst').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = +sel.dataset.ci;
      const newInst = sel.value;
      _sqCh[ci].forEach(st => { if (st) st.instrument = newInst; });
    });
  });
}

function _sqClosePop() {
  if (_sqPop) { _sqPop.remove(); _sqPop = null; }
}

function _sqOpenPop(cell, ci, si) {
  _sqClosePop();
  const st = _sqCh[ci][si];
  const vol = st?.vol ?? 0.6;
  const pop = document.createElement('div');
  pop.className = 'sq-pop';
  pop.innerHTML = `
    <div style="font-size:9px;color:var(--accent);letter-spacing:1px">CH${ci + 1} · STEP${si + 1}</div>
    <div><label>NOTE</label><select id="sq-pnote">${_sqNoteOpts(st?.note || 'C4')}</select></div>
    <div><label>VOL <span id="sq-pvl">${Math.round(vol * 100)}%</span></label>
      <input type="range" id="sq-pvol" min="0" max="1" step="0.05" value="${vol}"></div>
    <div class="sq-pop-row">
      <button class="sq-pop-del" id="sq-pdel">✕ Clear</button>
      <button class="sq-pop-ok" id="sq-pok">OK</button>
    </div>`;

  const r = cell.getBoundingClientRect();
  pop.style.top  = Math.min(r.bottom + 4, window.innerHeight - 190) + 'px';
  pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 200)) + 'px';
  document.body.appendChild(pop);
  _sqPop = pop;

  pop.querySelector('#sq-pvol').oninput = function() {
    pop.querySelector('#sq-pvl').textContent = Math.round(this.value * 100) + '%';
  };
  pop.querySelector('#sq-pdel').onclick = () => {
    _sqCh[ci][si] = null;
    cell.classList.remove('sq-f');
    cell.textContent = '';
    _sqClosePop();
  };
  pop.querySelector('#sq-pok').onclick = () => {
    const note = pop.querySelector('#sq-pnote').value;
    const v    = parseFloat(pop.querySelector('#sq-pvol').value);
    const inst = document.querySelector(`.sq-inst[data-ci="${ci}"]`)?.value || st?.instrument || '';
    _sqCh[ci][si] = { note, instrument: inst, vol: v };
    cell.classList.add('sq-f');
    cell.textContent = note;
    _sqClosePop();
  };

  setTimeout(() => {
    document.addEventListener('mousedown', function h(e) {
      if (!pop.contains(e.target)) { _sqClosePop(); document.removeEventListener('mousedown', h); }
    });
  }, 50);
}

function _sqClearPlayhead() {
  const ph = document.getElementById('sq-playhead');
  if (ph) ph.style.display = 'none';
  document.querySelectorAll('.sq-lrow').forEach(r => r.classList.remove('sq-ch-active'));
}

function _sqOnStep(stepIdx, active) {
  const ph = document.getElementById('sq-playhead');
  if (!ph) return;
  ph.style.display = '';
  ph.style.left = (stepIdx * 18) + 'px';
  const right = document.getElementById('sq-right');
  if (right) {
    const phLeft = stepIdx * 18;
    if (phLeft < right.scrollLeft || phLeft + 18 > right.scrollLeft + right.clientWidth) {
      right.scrollLeft = Math.max(0, phLeft - right.clientWidth * 0.3);
    }
  }
  document.querySelectorAll('.sq-lrow').forEach((row, ci) => {
    row.classList.toggle('sq-ch-active', !!(active[ci]));
  });
}

function _sqTogglePlay() {
  if (_sqPlaying) {
    window.AudioEngine?.stopMusic();
    _sqPlaying = false;
    _sqClearPlayhead();
  } else {
    window.AudioEngine?.init();
    const tempo = parseInt(document.getElementById('sg-tempo')?.value) || 120;
    const instrumentIds = _sqGetInstrumentIds();
    const _instrumentsById = {};
    for (const id of instrumentIds) {
      const inst = _audioData.instruments.find(i => i.id === id);
      if (inst) _instrumentsById[id] = inst;
    }
    window.AudioEngine.playMusic({ name: '_preview', tempo, channels: _sqCh, instrument_ids: instrumentIds, _instrumentsById, priority: 5, onStep: _sqOnStep });
    _sqPlaying = true;
  }
  const btn = document.getElementById('sq-play');
  if (btn) { btn.textContent = _sqPlaying ? '⏹ Stop' : '▶ Play'; btn.classList.toggle('danger', _sqPlaying); }
}

// ── End Step Sequencer ────────────────────────────────────────────────────────

function instrumentLikeConfigFields(cfg, prefix) {
  cfg = cfg || {};
  const adsr = cfg.adsr || {};
  const filter = cfg.filter || {};
  const vibrato = cfg.vibrato || {};
  const tremolo = cfg.tremolo || {};
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">
      <div class="field"><label>Attack</label><input id="${prefix}-a" type="number" step="0.01" min="0" value="${adsr.a ?? 0.01}"></div>
      <div class="field"><label>Decay</label><input id="${prefix}-d" type="number" step="0.01" min="0" value="${adsr.d ?? 0.05}"></div>
      <div class="field"><label>Sustain</label><input id="${prefix}-s" type="number" step="0.05" min="0" max="1" value="${adsr.s ?? 0.7}"></div>
      <div class="field"><label>Release</label><input id="${prefix}-r" type="number" step="0.01" min="0" value="${adsr.r ?? 0.15}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
      <div class="field"><label>Filter Type</label><select id="${prefix}-filtertype">
        ${['lowpass', 'highpass', 'bandpass', 'notch'].map(t => `<option value="${t}" ${filter.type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
      <div class="field"><label>Filter Freq (Hz)</label><input id="${prefix}-filterfreq" type="number" min="20" value="${filter.freq ?? 4000}"></div>
      <div class="field"><label>Filter Q</label><input id="${prefix}-filterq" type="number" step="0.1" min="0" value="${filter.q ?? 1}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-top:10px">
      <div class="field"><label>Vibrato Rate</label><input id="${prefix}-vibrate" type="number" step="0.5" min="0" value="${vibrato.rate ?? 0}"></div>
      <div class="field"><label>Vibrato Depth</label><input id="${prefix}-vibdepth" type="number" step="1" min="0" value="${vibrato.depth ?? 0}"></div>
      <div class="field"><label>Tremolo Rate</label><input id="${prefix}-tremrate" type="number" step="0.5" min="0" value="${tremolo.rate ?? 0}"></div>
      <div class="field"><label>Tremolo Depth</label><input id="${prefix}-tremdepth" type="number" step="0.05" min="0" max="1" value="${tremolo.depth ?? 0}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
      <div class="field"><label>Noise Mix (0-1)</label><input id="${prefix}-noisemix" type="number" step="0.05" min="0" max="1" value="${cfg.noiseMix ?? 0}"></div>
      <div class="field"><label>Gain (0-1)</label><input id="${prefix}-gain" type="number" step="0.05" min="0" max="1" value="${cfg.gain ?? 1}"></div>
    </div>`;
}

function readInstrumentLikeConfig(prefix, extra) {
  const num = (id, fallback) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? fallback : v; };
  return {
    adsr: { a: num(`${prefix}-a`, 0.01), d: num(`${prefix}-d`, 0.05), s: num(`${prefix}-s`, 0.7), r: num(`${prefix}-r`, 0.15) },
    filter: { type: document.getElementById(`${prefix}-filtertype`).value, freq: num(`${prefix}-filterfreq`, 4000), q: num(`${prefix}-filterq`, 1) },
    vibrato: { rate: num(`${prefix}-vibrate`, 0), depth: num(`${prefix}-vibdepth`, 0) },
    tremolo: { rate: num(`${prefix}-tremrate`, 0), depth: num(`${prefix}-tremdepth`, 0) },
    noiseMix: num(`${prefix}-noisemix`, 0),
    gain: num(`${prefix}-gain`, 1),
    ...extra,
  };
}

function categoryOptions(current) {
  return AUDIO_CATEGORIES.map(c => `<option value="${c}" ${current === c ? 'selected' : ''}>${c}</option>`).join('');
}

function openAudioModal(tab, row) {
  // Reset any leftover width from a previous songs/grid modal
  document.querySelector('#generic-modal .modal-card').style.width = '';
  const isNew = !row.id;
  const modal = document.getElementById('generic-modal');
  document.getElementById('modal-title').textContent = `${isNew ? 'New' : 'Edit'}: ${row.name || tab}`;
  const body = document.getElementById('modal-body');

  if (tab === 'samples') {
    const num = (id, fb) => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? fb : v; };
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="field"><label>Name</label><input id="smp-name" value="${row.name || ''}"></div>
        <div class="field"><label>Category</label><select id="smp-cat">${categoryOptions(row.category || 'environment')}</select></div>
        <div class="field"><label>Priority (1-10)</label><input id="smp-priority" type="number" min="1" max="10" value="${row.priority ?? 5}"></div>
      </div>
      ${isNew ? `<div class="field" style="margin-top:10px"><label>Audio File <span style="color:var(--text-dim);font-weight:400">(mp3, wav, ogg)</span></label>
        <input type="file" id="smp-file" accept="audio/*"></div>`
        : `<div style="margin-top:10px;padding:8px;background:var(--bg3);border-radius:3px;font-size:11px;color:var(--text-dim)">Audio data already stored. To replace, delete and re-upload.</div>`}
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:10px">
        <div class="field"><label>Base Note (MIDI, 60=C4)</label><input id="smp-basenote" type="number" min="0" max="127" value="${row.base_note ?? 60}"></div>
        <div class="field"><label>SNES Rate (Hz)</label><select id="smp-rate">
          ${[8000, 11025, 16000, 22050, 32000].map(r => `<option value="${r}" ${(row.snes_rate ?? 16000) == r ? 'selected' : ''}>${r}</option>`).join('')}
        </select></div>
        <div class="field"><label>SNES Bits</label><select id="smp-bits">
          <option value="4" ${(row.snes_bits ?? 4) == 4 ? 'selected' : ''}>4-bit (BRR-like)</option>
          <option value="8" ${row.snes_bits == 8 ? 'selected' : ''}>8-bit (more fidelity)</option>
        </select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:10px">
        <div class="field"><label>Echo Mix (0–1)</label><input id="smp-echo" type="number" step="0.05" min="0" max="1" value="${row.echo_mix ?? 0}"></div>
        <div class="field"><label>Loop Start (sec)</label><input id="smp-loopstart" type="number" step="0.01" min="0" value="${row.loop_start ?? 0}"></div>
        <div class="field"><label>Loop End (sec, 0=off)</label><input id="smp-loopend" type="number" step="0.01" min="0" value="${row.loop_end ?? 0}"></div>
      </div>
      <div style="margin-top:12px;font-size:11px;font-weight:600;color:var(--text-dim)">ADSR envelope</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:10px;margin-top:6px">
        <div class="field"><label>Attack</label><input id="smp-a" type="number" step="0.01" min="0" value="${row.config?.adsr?.a ?? 0.01}"></div>
        <div class="field"><label>Decay</label><input id="smp-d" type="number" step="0.01" min="0" value="${row.config?.adsr?.d ?? 0}"></div>
        <div class="field"><label>Sustain</label><input id="smp-s" type="number" step="0.05" min="0" max="1" value="${row.config?.adsr?.s ?? 1}"></div>
        <div class="field"><label>Release</label><input id="smp-r" type="number" step="0.01" min="0" value="${row.config?.adsr?.r ?? 0.3}"></div>
        <div class="field"><label>Gain (0–1)</label><input id="smp-gain" type="number" step="0.05" min="0" max="1" value="${row.config?.gain ?? 1}"></div>
      </div>
      <div class="field" style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <input type="checkbox" id="smp-enabled" ${row.enabled !== 0 ? 'checked' : ''}>
        <label for="smp-enabled" style="margin:0;cursor:pointer">Enabled</label>
      </div>`;
    document.getElementById('modal-save').onclick = async () => {
      const name = document.getElementById('smp-name').value.trim();
      if (!name) { toast('Name is required', true); return; }
      const reqBody = {
        name, category: document.getElementById('smp-cat').value,
        priority: parseInt(document.getElementById('smp-priority').value) || 5,
        base_note: parseInt(document.getElementById('smp-basenote').value) || 60,
        snes_rate: parseInt(document.getElementById('smp-rate').value) || 16000,
        snes_bits: parseInt(document.getElementById('smp-bits').value) || 4,
        echo_mix: num('smp-echo', 0),
        loop_start: num('smp-loopstart', 0),
        loop_end: num('smp-loopend', 0),
        config: { adsr: { a: num('smp-a', 0.01), d: num('smp-d', 0), s: num('smp-s', 1), r: num('smp-r', 0.3) }, gain: num('smp-gain', 1) },
        enabled: document.getElementById('smp-enabled').checked ? 1 : 0,
      };
      if (isNew) {
        const file = document.getElementById('smp-file')?.files[0];
        if (!file) { toast('Audio file is required', true); return; }
        reqBody.mime_type = file.type || 'audio/mpeg';
        reqBody.data = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result.split(',')[1]);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
      }
      const r = isNew ? await API('/audio/samples', 'POST', reqBody) : await API(`/audio/samples/${row.id}`, 'PUT', reqBody);
      if (r?.error) { toast(r.error, true); return; }
      toast(isNew ? 'Sample uploaded' : 'Sample updated');
      closeModal(); loadPanel('audio');
    };
  } else if (tab === 'instruments') {
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="field"><label>Name</label><input id="am-name" value="${row.name || ''}"></div>
        <div class="field"><label>Category</label><select id="am-cat">${categoryOptions(row.category || 'misc')}</select></div>
        <div class="field"><label>Waveform</label><select id="am-wave">${WAVEFORMS.map(w => `<option value="${w}" ${(row.waveform || 'square') === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
      </div>
      <div class="field" style="margin-top:10px"><label>Sample <span style="color:var(--text-dim);font-weight:400">(if set, sample is used instead of synthesized waveform)</span></label>
        <select id="am-sample">${_assetOptions(_audioData.samples, row.sample_id, '— synth only —')}</select>
      </div>
      ${instrumentLikeConfigFields(row.config, 'am')}
      <div class="field" style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <input type="checkbox" id="am-enabled" ${row.enabled !== 0 ? 'checked' : ''}>
        <label for="am-enabled" style="margin:0;cursor:pointer">Enabled</label>
      </div>`;
    document.getElementById('modal-save').onclick = async () => {
      const name = document.getElementById('am-name').value.trim();
      if (!name) { toast('Name is required', true); return; }
      const reqBody = {
        name, category: document.getElementById('am-cat').value, waveform: document.getElementById('am-wave').value,
        sample_id: document.getElementById('am-sample').value || null,
        config: readInstrumentLikeConfig('am'), enabled: document.getElementById('am-enabled').checked ? 1 : 0,
      };
      const r = isNew ? await API('/audio/instruments', 'POST', reqBody) : await API(`/audio/instruments/${row.id}`, 'PUT', reqBody);
      if (r?.error) { toast(r.error, true); return; }
      toast(isNew ? 'Instrument created' : 'Instrument updated');
      closeModal(); loadPanel('audio');
    };
  } else if (tab === 'sfx' || tab === 'ambient') {
    const isAmbient = tab === 'ambient';
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="field"><label>Name</label><input id="am-name" value="${row.name || ''}"></div>
        <div class="field"><label>Category</label><select id="am-cat">${categoryOptions(row.category || 'misc')}</select></div>
        <div class="field"><label>Priority (1-10)</label><input id="am-priority" type="number" min="1" max="10" value="${row.priority ?? (isAmbient ? 1 : 5)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
        <div class="field"><label>Waveform</label><select id="am-wave">${WAVEFORMS.map(w => `<option value="${w}" ${(row.config?.waveform || 'square') === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
        <div class="field"><label>Base Frequency (Hz)</label><input id="am-freq" type="number" min="20" value="${row.config?.freq ?? 440}"></div>
      </div>
      ${!isAmbient ? `<div class="field" style="margin-top:10px"><label>Duration (sec)</label><input id="am-duration" type="number" step="0.05" min="0.05" value="${row.config?.duration ?? 0.4}"></div>` : ''}
      ${instrumentLikeConfigFields(row.config, 'am')}
      <div class="field" style="display:flex;align-items:center;gap:18px;margin-top:10px">
        <span><input type="checkbox" id="am-enabled" ${row.enabled !== 0 ? 'checked' : ''}> <label for="am-enabled" style="margin:0;cursor:pointer">Enabled</label></span>
        ${isAmbient ? `<span><input type="checkbox" id="am-loop" ${row.loop !== 0 ? 'checked' : ''}> <label for="am-loop" style="margin:0;cursor:pointer">Loop</label></span>` : ''}
      </div>`;
    document.getElementById('modal-save').onclick = async () => {
      const name = document.getElementById('am-name').value.trim();
      if (!name) { toast('Name is required', true); return; }
      const extra = { waveform: document.getElementById('am-wave').value, freq: parseFloat(document.getElementById('am-freq').value) || 440 };
      if (!isAmbient) extra.duration = parseFloat(document.getElementById('am-duration').value) || 0.4;
      const reqBody = {
        name, category: document.getElementById('am-cat').value, priority: parseInt(document.getElementById('am-priority').value) || 5,
        config: readInstrumentLikeConfig('am', extra), enabled: document.getElementById('am-enabled').checked ? 1 : 0,
      };
      if (isAmbient) reqBody.loop = document.getElementById('am-loop').checked ? 1 : 0;
      const path = `/audio/${tab}`;
      const r = isNew ? await API(path, 'POST', reqBody) : await API(`${path}/${row.id}`, 'PUT', reqBody);
      if (r?.error) { toast(r.error, true); return; }
      toast(isNew ? 'Created' : 'Updated');
      closeModal(); loadPanel('audio');
    };
  } else if (tab === 'songs') {
    _sqInjectCss();
    _sqInit(row);
    _sqPlaying = false;
    window.AudioEngine?.stopMusic();

    const modalCard = document.querySelector('#generic-modal .modal-card');
    modalCard.style.width = 'min(90vw, 1100px)';

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:12px">
        <div class="field"><label>Name</label><input id="sg-name" value="${row.name || ''}"></div>
        <div class="field"><label>Category</label><select id="sg-cat">${categoryOptions(row.category || 'misc')}</select></div>
        <div class="field"><label>Tempo (BPM)</label><input id="sg-tempo" type="number" min="40" max="300" value="${row.tempo ?? 120}"></div>
        <div class="field"><label>Priority (1-10)</label><input id="sg-priority" type="number" min="1" max="10" value="${row.priority ?? 5}"></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <button id="sq-vgrid" class="sq-vtab sq-vtab-on">⊞ Grid</button>
        <button id="sq-vjson" class="sq-vtab">{ } JSON</button>
        <span id="sq-stats" style="font-size:10px;color:var(--text-dim);margin-left:10px"></span>
        <button id="sq-play" class="action-btn" style="margin-left:auto;padding:3px 14px">▶ Play</button>
      </div>
      <div id="sq-vg">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:10px;color:var(--text-dim)">Bars:</span>
          <button id="sq-bsub" class="action-btn" style="padding:2px 10px">−</button>
          <span id="sq-bcnt" style="font-size:12px;min-width:24px;text-align:center">${_sqBars}</span>
          <button id="sq-badd" class="action-btn" style="padding:2px 10px">+</button>
          <span style="font-size:10px;color:var(--text-dim);margin-left:8px">Click empty cell → place note &nbsp;·&nbsp; Click filled cell → edit/clear</span>
        </div>
        <div id="sq-grid" style="display:flex;border:1px solid var(--border);border-radius:4px;overflow:hidden;max-height:52vh"></div>
        <button class="action-btn" id="sq-addch" style="margin-top:8px">+ Add Channel</button>
      </div>
      <div id="sq-vj" style="display:none">
        <div class="field"><label>Instrument IDs <span style="font-weight:400;color:var(--text-dim)">(comma-separated)</span></label>
          <input id="sg-instids" value="${(row.instrument_ids || []).join(', ')}"></div>
        <div class="field" style="margin-top:10px"><label>Channels JSON</label>
          <textarea id="sg-channels" rows="10" style="resize:vertical;font-family:monospace;font-size:10px">${JSON.stringify(row.channels || [], null, 2)}</textarea>
        </div>
      </div>
      <div class="field" style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <input type="checkbox" id="sg-enabled" ${row.enabled !== 0 ? 'checked' : ''}>
        <label for="sg-enabled" style="margin:0;cursor:pointer">Enabled</label>
      </div>`;

    _sqRender();
    _sqUpdateStats();

    document.getElementById('sq-play').onclick = _sqTogglePlay;
    document.getElementById('sg-tempo').addEventListener('input', _sqUpdateStats);

    document.getElementById('sq-vgrid').onclick = () => {
      _sqView = 'grid';
      document.getElementById('sq-vg').style.display = '';
      document.getElementById('sq-vj').style.display = 'none';
      document.getElementById('sq-vgrid').classList.add('sq-vtab-on');
      document.getElementById('sq-vjson').classList.remove('sq-vtab-on');
      _sqRender();
    };
    document.getElementById('sq-vjson').onclick = () => {
      _sqView = 'json';
      document.getElementById('sq-vg').style.display = 'none';
      document.getElementById('sq-vj').style.display = '';
      document.getElementById('sq-vgrid').classList.remove('sq-vtab-on');
      document.getElementById('sq-vjson').classList.add('sq-vtab-on');
      document.getElementById('sg-instids').value = _sqGetInstrumentIds().join(', ');
      document.getElementById('sg-channels').value = JSON.stringify(_sqCh, null, 2);
    };

    document.getElementById('sq-badd').onclick = () => {
      _sqBars++;
      _sqCh = _sqCh.map(ch => [...ch, ...new Array(16).fill(null)]);
      document.getElementById('sq-bcnt').textContent = _sqBars;
      _sqUpdateStats();
      _sqRender();
    };
    document.getElementById('sq-bsub').onclick = () => {
      if (_sqBars <= 1) return;
      _sqBars--;
      const n = _sqBars * 16;
      _sqCh = _sqCh.map(ch => ch.slice(0, n));
      document.getElementById('sq-bcnt').textContent = _sqBars;
      _sqUpdateStats();
      _sqRender();
    };
    document.getElementById('sq-addch').onclick = () => {
      _sqCh.push(new Array(_sqBars * 16).fill(null));
      _sqRender();
    };

    document.getElementById('modal-save').onclick = async () => {
      const name = document.getElementById('sg-name').value.trim();
      if (!name) { toast('Name is required', true); return; }
      let channels, instrumentIds;
      if (_sqView === 'json') {
        try { channels = JSON.parse(document.getElementById('sg-channels').value || '[]'); }
        catch { toast('Channels must be valid JSON', true); return; }
        instrumentIds = document.getElementById('sg-instids').value.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        channels = _sqCh;
        instrumentIds = _sqGetInstrumentIds();
      }
      const reqBody = {
        name, category: document.getElementById('sg-cat').value,
        tempo: parseInt(document.getElementById('sg-tempo').value) || 120,
        priority: parseInt(document.getElementById('sg-priority').value) || 5,
        loop_start: 0,
        loop_end: Math.max(0, (channels[0]?.length || 0) - 1),
        instrument_ids: instrumentIds,
        channels,
        enabled: document.getElementById('sg-enabled').checked ? 1 : 0,
      };
      const r = isNew ? await API('/audio/songs', 'POST', reqBody) : await API(`/audio/songs/${row.id}`, 'PUT', reqBody);
      if (r?.error) { toast(r.error, true); return; }
      toast(isNew ? 'Song created' : 'Song updated');
      modalCard.style.width = '';
      _sqPlaying = false; window.AudioEngine?.stopMusic(); _sqClearPlayhead();
      closeModal(); loadPanel('audio');
    };
  }

  modal.style.display = 'flex';
}
