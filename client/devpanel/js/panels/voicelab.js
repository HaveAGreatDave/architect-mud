// VOICE LAB — the formant synth, audible and tunable, inside the panel.
//
// This was a standalone page (client/devpanel/voice-lab.html) reachable only by
// typing its URL. It is a devpanel tab now, and the standalone copy is gone rather
// than left beside it: two copies of one tool is how a fix lands in one of them and
// not the other, which is the same reasoning the LOCAL_TOOLS launcher records about
// the Studio and the Modelshop.
//
// WHAT MOVING IT BUYS, beyond being findable: the panel can FETCH. A voice is
// seeded by hashing a name — tv.js takes the speaker out of `Name says, "line"` and
// uses it as the seed — so the NPC list from /npcs is not a convenience here, it is
// the actual set of voices the game speaks in. Picking a name from it plays exactly
// what a player hears.
//
// Two levels of control, and they are different things:
//   TUNING     global, shared by every voice — rate, sibilance, creak, presence.
//              Mutating AudioEngine.voiceTuning takes effect on the next line.
//   THIS VOICE per-narrator character. Hashed from the name, so before the
//              `voice` override existed the only way to hear `drive` or `growl`
//              was to type seeds until one rolled them.
//
// SAVED VOICES. A voice tuned here can be saved and loaded back. A saved voice is
// an audio_instruments row with category 'voice', written through the audio
// plugin's existing CRUD, so it exports to content/audio_instruments/ as a file
// and ships through the content pipeline like any other content, with no table
// of its own. The Audio tab keeps these rows out of its instrument list. The row
// holds the seed and the overrides that differ from it: { seed, voice }.

const VL_KNOBS = [
  ['rate',       'rate (lower = slower)', 0.6,  1.2,  0.01],
  ['breath',     'breath',      0,    2.5,  0.05],
  ['sibilance',  'sibilance',   0,    2.5,  0.05],
  ['friction',   'friction',    0,    2.5,  0.05],
  ['aspiration', 'aspiration',  0,    2.5,  0.05],
  ['presenceDb', 'presence dB', -6,   12,   0.5 ],
  ['tiltPlain',  'tilt plain',  2500, 9000, 100 ],
  ['tiltStress', 'tilt stress', 2500, 9000, 100 ],
  ['tiltEmph',   'tilt emph',   2500, 9000, 100 ],
  ['emphasis',   'emphasis',    0,    2.5,  0.05],
  ['creak',      'creak',       0,    2,    0.05],
  ['finalTaper', 'final taper', 0.1,  1,    0.05],
  ['lineGapMs',  'line gap ms', 0,    900,  10  ],
  ['excitement', 'excitement',  0,    2,    0.05],
  ['compRatio',  'compressor',  1,    8,    0.5 ],
];

// Per-voice character. Ranges are deliberately WIDER than the roll — the point of
// a lab is to hear the edges, not to stay inside what the dice produce.
const VL_VOICE = [
  ['f0',         'F0 Hz',         60,   220,  1   ],
  ['fshift',     'formant shift', 0.80, 1.30, 0.01],
  ['speed',      'speed',         0.8,  2.0,  0.02],
  ['oq',         'open quotient', 0.30, 0.90, 0.02],
  ['jitter',     'jitter',        0,    0.06, 0.002],
  ['breath',     'breath',        0,    0.05, 0.002],
  ['ring',       'ring (AM out)', 0,    0.6,  0.01],
  ['lilt',       'lilt',          0,    0.20, 0.005],
  ['decl',       'declination',   0,    0.30, 0.005],
  ['drive',      'drive',         0,    1,    0.02],
  // Glottal FM. `growl ratio` is the one to move: 0.5 is creak, 1 brightens, and
  // the non-integer values are where it stops sounding like a person.
  ['growl',      'growl index',   0,    0.30, 0.005],
  ['growlRatio', 'growl ratio',   0.25, 3.0,  0.005],
  ['growl2',     'growl2 index',  0,    0.30, 0.005],
  ['growl2Ratio','growl2 ratio',  0.25, 3.0,  0.005],
];
const VL_WAVES = ['growlWave', 'growl2Wave'];

// [label, text, excite]. The last three are the hockey booth: a line can be sold, from -1
// (grave) to 1 (a goal call), and the slider beside Speak sets it for anything typed.
const VL_PRESETS = [
  ['Newsreader', "Good evening, and welcome to the Coldwater evening report. Acid rain after midnight, so stay indoors."],
  ['A question', "Is the door closed? It is."],
  ['Trailing off', "I wouldn't go down there. Not at night..."],
  ['A shout', "GET DOWN!"],
  ['The hard words', "Tableland, rubbly, vestibule, Delacroix, architect."],
  ['Numbers', "That's 900 credits, level 7, at 12:30."],
  ['A goal call', "He shoots, he SCOOOOOORES!!!", 1],
  ['A shot', "Polyester Grubb lets it go from the slot.", 0.6],
  ['A death', "He's not moving. The building goes quiet.", -0.8],
];

let _vlTuneDefaults = null;
const _vlOverride = {};
let _vlBase = null;
let _vlPresets = [];

// ── Saved voices: the row shape, both ways ──────────────────────────────────
// Pure, so scripts/audio/tools-smoke.mjs can prove a voice survives the trip.
const VL_PRESET_PREFIX = 'voice_';
function vlPresetsFrom(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r?.category === 'voice')
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
function vlPresetId(name) {
  const slug = String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug ? VL_PRESET_PREFIX + slug : null;
}
// Only what differs from the seed is stored, the same rule Copy voice follows:
// a saved voice records decisions, not every rolled default.
function vlPresetRow(name, seed, override, base) {
  const id = vlPresetId(name);
  if (!id) return null;
  const voice = {};
  for (const k of Object.keys(override || {})) {
    if (base && override[k] === base[k]) continue;
    voice[k] = override[k];
  }
  return { id, name: String(name).trim(), category: 'voice', waveform: 'voice', sample_id: null, enabled: 1,
    config: { seed: String(seed || name).trim(), voice } };
}
function vlPresetFromRow(row) {
  const cfg = row?.config || {};
  return { seed: cfg.seed || row?.name || 'broadcast', voice: { ...(cfg.voice || {}) } };
}

function renderVoiceLabPanel(data) {
  _vlPresets = Array.isArray(data?.voices) ? data.voices : [];
  const npcs = (Array.isArray(data?.npcs) ? data.npcs : [])
    .map(n => n?.name).filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const panel = document.getElementById('list-panel');
  const sect = (title, body, note) => `
    <div style="padding:10px 16px;border-bottom:2px solid var(--border);background:var(--bg2)">
      <div style="font-size:13px;font-weight:600;color:var(--accent);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">${title}</div>
      ${note ? `<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;line-height:1.5">${note}</div>` : ''}
      ${body}
    </div>`;

  panel.innerHTML = `
    ${sect('Line', `
      <textarea id="vl-text" style="width:100%;min-height:64px;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:8px;font-family:var(--font);font-size:12px">${VL_PRESETS[0][1]}</textarea>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
        <select id="vl-npc" style="background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:5px;min-width:180px">
          <option value="">— pick a character —</option>
          ${npcs.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('')}
        </select>
        <input type="text" id="vl-seed" value="Dex Rime" placeholder="or any name"
          style="flex:1 1 160px;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:5px">
        <button class="action-btn" onclick="vlSpeak()">▶ Speak</button>
        <button class="action-btn" onclick="vlStop()">■ Stop</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--text-dim)">excite
        <input type="range" id="vl-excite" min="-1" max="1" step="0.05" value="0" style="flex:1;max-width:260px"
          oninput="document.getElementById('vl-excite-v').textContent=(+this.value).toFixed(2)">
        <span id="vl-excite-v" style="color:var(--text-bright);min-width:3em">0.00</span>
        <span>-1 grave · 0 the voice as it is · 1 a goal call</span>
      </label>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">
        ${VL_PRESETS.map(([label, t], i) => `<button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="vlPreset(${i})">${label}</button>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:8px">Last read: <span id="vl-dur">—</span></div>
    `, `A voice is hashed from the NAME, and that is exactly how the game does it — tv.js takes the speaker out of <code>Name says, "line"</code> and seeds on it. So a character picked here speaks in the voice a player actually hears.`)}

    ${sect('Phonemes', `<div id="vl-phon" style="font-family:var(--font);font-size:11px;color:var(--text-bright);background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:8px;line-height:1.7;word-break:break-word">—</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:6px">
        <b style="color:var(--yellow)">*</b> lexical stress &nbsp; <i style="color:var(--red)">!</i> emphasis &nbsp;
        <code>_</code> word gap &nbsp; <code>_C</code> comma &nbsp; <code>__</code> full stop &nbsp; <code>_P</code> paragraph &nbsp; <code>AX</code> schwa</div>`)}

    ${sect('This voice', `<div id="vl-voice-knobs" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px"></div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="action-btn" onclick="vlVoiceReset()">Back to the seed</button>
        <button class="action-btn" onclick="vlVoiceCopy()">Copy voice</button>
      </div>
      <pre id="vl-voice-dump" style="font-size:10px;color:var(--text-dim);margin:8px 0 0;white-space:pre-wrap"></pre>`,
      `Overrides what the name rolled, for the next read. <b>Copy voice</b> prints only what you changed, in the shape a <code>NAMED_VOICES</code> entry takes.`)}

    ${sect('Saved voices', `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <select id="vl-saved" style="background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:5px;min-width:200px"></select>
        <button class="action-btn" onclick="vlLoadPreset()">Load</button>
        <button class="action-btn danger" onclick="vlDeletePreset()">Delete</button>
        <span style="flex:0 0 12px"></span>
        <input type="text" id="vl-save-name" placeholder="name to save as"
          style="flex:1 1 160px;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:5px">
        <button class="action-btn" onclick="vlSavePreset()">Save voice</button>
      </div>`,
      `Saves the seed and the knobs you changed under a name. It's stored as a content row (category <code>voice</code> in audio_instruments), so it ships as a file under content/audio_instruments/ once exported. Saving an existing name overwrites it.`)}

    ${sect('Tuning (global)', `<div id="vl-tune-knobs" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px"></div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="action-btn" onclick="vlTuneReset()">Reset all</button>
        <button class="action-btn" onclick="vlTuneCopy()">Copy values</button>
      </div>
      <pre id="vl-tune-dump" style="font-size:10px;color:var(--text-dim);margin:8px 0 0;white-space:pre-wrap"></pre>`,
      `Shared by every voice. <b>rate</b> is the master pace — broadcast's hold is fitted to it, so moving it far wants the hold refitted or lines land on top of the voice.`)}
  `;

  vlBuildTuning();
  vlBuildVoice();
  vlRenderPresets();
  vlRender();
  document.getElementById('vl-text').addEventListener('input', vlRender);
  document.getElementById('vl-npc').addEventListener('change', (e) => {
    if (!e.target.value) return;
    document.getElementById('vl-seed').value = e.target.value;
    vlVoiceReset();
  });
  document.getElementById('vl-seed').addEventListener('change', vlBuildVoice);
}

const _vlTuning = () => window.AudioEngine?.voiceTuning;
const _vlEl = (id) => document.getElementById(id);

function vlKnob(host, key, label, min, max, step, value, onInput) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px';
  wrap.innerHTML = `<label style="color:var(--text-dim);flex:0 0 96px">${label}</label>
    <input type="range" min="${min}" max="${max}" step="${step}" style="flex:1;min-width:60px">
    <output style="color:var(--text-bright);flex:0 0 44px;text-align:right"></output>`;
  host.appendChild(wrap);
  const input = wrap.querySelector('input');
  const out = wrap.querySelector('output');
  input.value = value;
  out.textContent = value;
  input.addEventListener('input', () => { const v = parseFloat(input.value); out.textContent = v; onInput(v); });
}

function vlBuildTuning() {
  const t = _vlTuning();
  const host = _vlEl('vl-tune-knobs');
  if (!t || !host) { if (host) host.textContent = 'AudioEngine not loaded.'; return; }
  if (!_vlTuneDefaults) _vlTuneDefaults = { ...t };
  host.innerHTML = '';
  for (const [key, label, min, max, step] of VL_KNOBS) {
    vlKnob(host, key, label, min, max, step, t[key], (v) => { _vlTuning()[key] = v; });
  }
}

function vlBuildVoice() {
  const host = _vlEl('vl-voice-knobs');
  const seed = _vlEl('vl-seed')?.value || 'broadcast';
  const v = window.AudioEngine?._voiceFor?.(seed);
  if (!host) return;
  if (!v) { host.textContent = '(needs AudioEngine._voiceFor)'; return; }
  _vlBase = v;
  host.innerHTML = '';
  for (const [key, label, min, max, step] of VL_VOICE) {
    const cur = _vlOverride[key] != null ? _vlOverride[key] : (v[key] != null ? v[key] : 0);
    vlKnob(host, key, label, min, max, step, cur, (n) => { _vlOverride[key] = n; });
  }
  for (const key of VL_WAVES) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px';
    wrap.innerHTML = `<label style="color:var(--text-dim);flex:0 0 96px">${key}</label>
      <select style="flex:1;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:3px">
        ${['sine', 'square', 'sawtooth', 'triangle'].map(w => `<option>${w}</option>`).join('')}
      </select>`;
    host.appendChild(wrap);
    const sel = wrap.querySelector('select');
    sel.value = _vlOverride[key] || v[key] || 'sine';
    sel.addEventListener('change', () => { _vlOverride[key] = sel.value; });
  }
}

function vlSpeak() {
  const engine = window.AudioEngine;
  if (!engine) return;
  // The lab is the one place the TV-voice setting must not gate playback — you are
  // here to hear it. Forced for this panel only.
  try { engine.applyVolumeSettings({ enabled: true, tv: true, master: 1, tvVolume: 1 }); } catch { /* older signature */ }
  const res = engine.speak(_vlEl('vl-text').value, {
    seed: _vlEl('vl-seed').value || 'broadcast',
    voice: Object.keys(_vlOverride).length ? _vlOverride : null,
    excite: +(_vlEl('vl-excite')?.value || 0),
  });
  _vlEl('vl-dur').textContent = res?.duration ? res.duration.toFixed(2) + ' s' : 'not spoken (audio blocked or muted)';
  vlRender();
}
function vlStop() { window.AudioEngine?.cancelSpeech?.(); }
function vlPreset(i) {
  _vlEl('vl-text').value = VL_PRESETS[i][1];
  const x = _vlEl('vl-excite');
  if (x) { x.value = String(VL_PRESETS[i][2] || 0); _vlEl('vl-excite-v').textContent = (+x.value).toFixed(2); }
  vlSpeak();
}

function vlRender() {
  const f = window.AudioEngine?._phonemesFor;
  const host = _vlEl('vl-phon');
  if (!host) return;
  if (!f) { host.textContent = '(phoneme view needs AudioEngine._phonemesFor)'; return; }
  host.innerHTML = f(_vlEl('vl-text').value).map(p =>
    p === '*' ? '<b style="color:var(--yellow)">*</b>' :
    p === '!' ? '<i style="color:var(--red)">!</i>' :
    /^_/.test(p) ? `<span style="color:var(--text-dim)">${p}</span>` : p).join(' ');
}

function vlVoiceReset() {
  for (const k of Object.keys(_vlOverride)) delete _vlOverride[k];
  _vlEl('vl-voice-dump').textContent = '';
  vlBuildVoice();
}
function vlVoiceCopy() {
  // Only what differs from the seed — a NAMED_VOICES entry wants the decisions
  // somebody made, not a dump of every rolled default.
  const out = {};
  for (const k of Object.keys(_vlOverride)) {
    if (_vlBase && _vlOverride[k] === _vlBase[k]) continue;
    out[k] = _vlOverride[k];
  }
  const s = Object.keys(out).length ? JSON.stringify(out, null, 2) : '(unchanged from the seed)';
  _vlEl('vl-voice-dump').textContent = s;
  navigator.clipboard?.writeText(s).catch(() => {});
}
function vlTuneReset() { Object.assign(_vlTuning(), _vlTuneDefaults); vlBuildTuning(); _vlEl('vl-tune-dump').textContent = ''; }
function vlTuneCopy() {
  const t = _vlTuning(), out = {};
  for (const [k] of VL_KNOBS) if (t[k] !== _vlTuneDefaults[k]) out[k] = t[k];
  const s = Object.keys(out).length ? JSON.stringify(out, null, 2) : '(unchanged from defaults)';
  _vlEl('vl-tune-dump').textContent = s;
  navigator.clipboard?.writeText(s).catch(() => {});
}

// ── Saved voices ─────────────────────────────────────────────────────────────
function vlRenderPresets(selectId) {
  const sel = _vlEl('vl-saved');
  if (!sel) return;
  sel.innerHTML = _vlPresets.length
    ? _vlPresets.map(r => `<option value="${String(r.id).replace(/"/g, '&quot;')}">${r.name} (${(r.config?.seed || r.name)})</option>`).join('')
    : '<option value="">(no saved voices)</option>';
  if (selectId) sel.value = selectId;
}

async function vlReloadPresets(selectId) {
  const rows = await API('/audio/instruments');
  if (Array.isArray(rows)) _vlPresets = vlPresetsFrom(rows);
  vlRenderPresets(selectId);
}

async function vlSavePreset() {
  const name = (_vlEl('vl-save-name')?.value || '').trim();
  const row = vlPresetRow(name, _vlEl('vl-seed')?.value, _vlOverride, _vlBase);
  if (!row) { toast('Give the voice a name', true); return; }
  const exists = _vlPresets.some(r => r.id === row.id);
  const r = exists ? await API(`/audio/instruments/${row.id}`, 'PUT', row) : await API('/audio/instruments', 'POST', row);
  if (r?.error) { toast(r.error, true); return; }
  toast(`${exists ? 'Updated' : 'Saved'} voice "${row.name}"`);
  await vlReloadPresets(row.id);
}

function vlLoadPreset() {
  const id = _vlEl('vl-saved')?.value;
  const row = _vlPresets.find(r => r.id === id);
  if (!row) return;
  const { seed, voice } = vlPresetFromRow(row);
  _vlEl('vl-seed').value = seed;
  _vlEl('vl-save-name').value = row.name;
  for (const k of Object.keys(_vlOverride)) delete _vlOverride[k];
  Object.assign(_vlOverride, voice);
  _vlEl('vl-voice-dump').textContent = '';
  vlBuildVoice();
  toast(`Loaded voice "${row.name}"`);
}

async function vlDeletePreset() {
  const id = _vlEl('vl-saved')?.value;
  const row = _vlPresets.find(r => r.id === id);
  if (!row || !confirm(`Delete the saved voice "${row.name}"?`)) return;
  const r = await API(`/audio/instruments/${row.id}`, 'DELETE');
  if (r?.error) { toast(r.error, true); return; }
  toast(`Deleted voice "${row.name}"`);
  await vlReloadPresets();
}
