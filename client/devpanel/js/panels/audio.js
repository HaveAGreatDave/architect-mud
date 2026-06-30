// Audio editor — procedural Web Audio playback (music/SFX/ambience). Separate
// from the existing Sounds panel (panels/sounds.js), which is the text-based
// gameplay Sound system. Never merge the two.
//
// Functional forms + instant local preview, no canvas/timeline editor yet
// (that's a deferred phase-2 piece). Preview buttons call window.AudioEngine
// directly against the browser's own AudioContext — no server round-trip.

const AUDIO_CATEGORIES = ['ui', 'combat', 'cyberpunk', 'environment', 'tv', 'misc'];
const WAVEFORMS = ['square', 'sine', 'triangle', 'sawtooth', 'noise'];

// Field whitelist per asset type, mirrors the column lists in plugins/audio/index.js's
// TABLES spec — used for both export (what to dump) and import (what to accept).
// Everything in this system is a JSON parameter object (waveform/ADSR/filter recipes,
// tracker patterns), never a recorded sample, so JSON is the only format that makes
// sense — there's no waveform data to import, just synth presets to share/back up.
const AUDIO_IMPORT_FIELDS = {
  instruments: ['name', 'category', 'waveform', 'config', 'enabled'],
  songs: ['name', 'category', 'tempo', 'channels', 'loop_start', 'loop_end', 'instrument_ids', 'priority', 'enabled'],
  sfx: ['name', 'category', 'priority', 'config', 'enabled'],
  ambient: ['name', 'category', 'priority', 'config', 'loop', 'enabled'],
};

let _audioTab = 'instruments';
let _audioData = { instruments: [], songs: [], sfx: [], ambient: [] };

function renderAudioPanel(data) {
  _audioData = {
    instruments: Array.isArray(data?.instruments) ? data.instruments : [],
    songs: Array.isArray(data?.songs) ? data.songs : [],
    sfx: Array.isArray(data?.sfx) ? data.sfx : [],
    ambient: Array.isArray(data?.ambient) ? data.ambient : [],
  };
  const panel = document.getElementById('list-panel');
  const tabs = [
    ['instruments', 'Instruments'],
    ['songs', 'Songs'],
    ['sfx', 'Sound Effects'],
    ['ambient', 'Ambient'],
  ];
  const tabBar = tabs.map(([key, label]) => `
    <button class="action-btn${_audioTab === key ? ' selected' : ''}" style="${_audioTab === key ? 'background:var(--accent);color:#000' : ''}" onclick="setAudioTab('${key}')">${label} (${_audioData[key].length})</button>
  `).join('');

  panel.innerHTML = `
    <div style="padding:10px 16px;border-bottom:2px solid var(--border);background:var(--bg2);display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;gap:6px">${tabBar}</div>
      <div style="display:flex;gap:6px">
        <button class="action-btn danger" onclick="stopAllAudioPreviews()">⏹ Stop</button>
        <button class="action-btn" onclick="openAudioImportModal('${_audioTab}')">⬆ Load</button>
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
  if (!rows.length) { body.innerHTML = '<div style="padding:24px;color:var(--text-dim)">Nothing here yet.</div>'; return; }

  const cells = rows.map(r => {
    const extra = _audioTab === 'instruments' ? r.waveform
      : _audioTab === 'songs' ? `${r.tempo || 120} BPM`
      : `priority ${r.priority ?? 5}`;
    return `<tr>
      <td style="font-weight:600;color:${r.enabled !== 0 ? 'var(--text-bright)' : 'var(--text-dim)'}">${r.name}</td>
      <td><span style="font-size:10px;background:var(--bg3);padding:2px 6px;border-radius:2px;color:var(--accent)">${r.category}</span></td>
      <td style="font-size:11px;color:var(--text-dim)">${extra}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="previewAudioAsset('${_audioTab}','${r.id}')">▶</button>
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
  else if (tab === 'instruments') window.AudioEngine.playSfx({ priority: 5, category: 'sfx', config: { ...(row.config || {}), waveform: row.waveform, freq: 440, duration: 0.6 } });
  else if (tab === 'ambient') { window.AudioEngine.loopSound(row); setTimeout(() => window.AudioEngine.stopLoop(row.id), 4000); }
  else if (tab === 'songs') {
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
  a.download = `${tab}_${row.name.replace(/[^a-z0-9_-]/gi, '_')}.json`;
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
      <input type="file" id="ai-file" accept="application/json,.json">
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

function newAudioAsset(tab) { openAudioModal(tab, {}); }
function editAudioAsset(tab, id) { openAudioModal(tab, findAudioAsset(tab, id) || {}); }

async function deleteAudioAsset(tab, id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  await API(`/audio/${tab}/${id}`, 'DELETE');
  toast(`"${name}" deleted`);
  loadPanel('audio');
}

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
  const isNew = !row.id;
  const modal = document.getElementById('generic-modal');
  document.getElementById('modal-title').textContent = `${isNew ? 'New' : 'Edit'}: ${row.name || tab}`;
  const body = document.getElementById('modal-body');

  if (tab === 'instruments') {
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="field"><label>Name</label><input id="am-name" value="${row.name || ''}"></div>
        <div class="field"><label>Category</label><select id="am-cat">${categoryOptions(row.category || 'misc')}</select></div>
        <div class="field"><label>Waveform</label><select id="am-wave">${WAVEFORMS.map(w => `<option value="${w}" ${(row.waveform || 'square') === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
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
    const instOpts = _audioData.instruments.map(i => i.id).join(', ');
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="field"><label>Name</label><input id="sg-name" value="${row.name || ''}"></div>
        <div class="field"><label>Category</label><select id="sg-cat">${categoryOptions(row.category || 'misc')}</select></div>
        <div class="field"><label>Tempo (BPM)</label><input id="sg-tempo" type="number" min="40" max="300" value="${row.tempo ?? 120}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:10px">
        <div class="field"><label>Loop Start (step)</label><input id="sg-loopstart" type="number" min="0" value="${row.loop_start ?? 0}"></div>
        <div class="field"><label>Loop End (step)</label><input id="sg-loopend" type="number" min="0" value="${row.loop_end ?? 0}"></div>
        <div class="field"><label>Priority (1-10)</label><input id="sg-priority" type="number" min="1" max="10" value="${row.priority ?? 5}"></div>
      </div>
      <div class="field" style="margin-top:10px"><label>Instrument IDs <span style="color:var(--text-dim);font-weight:400">(comma-separated — available: ${instOpts || 'none yet'})</span></label>
        <input id="sg-instids" value="${(row.instrument_ids || []).join(', ')}">
      </div>
      <div class="field" style="margin-top:10px"><label>Channels <span style="color:var(--text-dim);font-weight:400">(tracker pattern JSON — array of channels, each an array of {note,instrument,vol} or null steps; visual timeline editor is a planned follow-up)</span></label>
        <textarea id="sg-channels" rows="8" style="resize:vertical;font-family:monospace;font-size:11px">${JSON.stringify(row.channels || [], null, 2)}</textarea>
      </div>
      <div class="field" style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <input type="checkbox" id="sg-enabled" ${row.enabled !== 0 ? 'checked' : ''}>
        <label for="sg-enabled" style="margin:0;cursor:pointer">Enabled</label>
      </div>`;
    document.getElementById('modal-save').onclick = async () => {
      const name = document.getElementById('sg-name').value.trim();
      if (!name) { toast('Name is required', true); return; }
      let channels;
      try { channels = JSON.parse(document.getElementById('sg-channels').value || '[]'); }
      catch { toast('Channels must be valid JSON', true); return; }
      const reqBody = {
        name, category: document.getElementById('sg-cat').value, tempo: parseInt(document.getElementById('sg-tempo').value) || 120,
        loop_start: parseInt(document.getElementById('sg-loopstart').value) || 0,
        loop_end: parseInt(document.getElementById('sg-loopend').value) || 0,
        priority: parseInt(document.getElementById('sg-priority').value) || 5,
        instrument_ids: document.getElementById('sg-instids').value.split(',').map(s => s.trim()).filter(Boolean),
        channels, enabled: document.getElementById('sg-enabled').checked ? 1 : 0,
      };
      const r = isNew ? await API('/audio/songs', 'POST', reqBody) : await API(`/audio/songs/${row.id}`, 'PUT', reqBody);
      if (r?.error) { toast(r.error, true); return; }
      toast(isNew ? 'Song created' : 'Song updated');
      closeModal(); loadPanel('audio');
    };
  }

  modal.style.display = 'flex';
}
