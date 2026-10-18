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
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;font-size:11px;color:var(--text-dim)">
        back end
        <select id="vl-backend" onchange="vlBackendChanged()" style="background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:4px">
          <option value="graph">graph (Web Audio nodes, as shipped)</option>
          <option value="worklet">worklet (LF pulse + Klatt cascade, prototype)</option>
        </select>
        <button class="action-btn" onclick="vlAB()" title="The same line on the graph, then on the worklet">A/B this line</button>
        <span id="vl-wk-state"></span>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Level: <span id="vl-level">—</span></div>
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

    ${sect('Modified Rhyme Test', `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--text-dim)">
        back ends
        <select id="vl-mrt-mode" style="background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:4px">
          <option value="ab">both, blind (each set once per back end, shuffled)</option>
          <option value="graph">graph only</option>
          <option value="worklet">worklet only</option>
        </select>
        carrier
        <select id="vl-mrt-carrier" style="background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:4px">
          ${VL_MRT_CARRIERS.map((c, i) => `<option value="${i}">${c.replace('#', '___')}</option>`).join('')}
        </select>
        <button class="action-btn" onclick="vlMrtStart()">Start</button>
        <button class="action-btn" onclick="vlMrtPlay()">↻ Replay</button>
        <button class="action-btn" onclick="vlMrtStop()">End run</button>
        <span id="vl-mrt-progress" style="color:var(--text-bright)"></span>
      </div>
      <div id="vl-mrt-choices" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px;max-width:420px"></div>
      <pre id="vl-mrt-result" style="font-size:11px;color:var(--text-bright);margin:10px 0 0;white-space:pre-wrap"></pre>
      <pre id="vl-mrt-history" style="font-size:10px;color:var(--text-dim);margin:6px 0 0;white-space:pre-wrap"></pre>`,
      `House et al.'s 50 six-word sets, read by the voice above in a carrier phrase. Pick the word you heard (or press 1–6). The back end of each trial stays hidden till the run ends. The score is % correct, and corrected for guessing, (R − W/5) / N. Sets that differ in the first consonant are scored apart from those that differ in the last.`)}

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
  vlMrtHistory();
  const be = _vlEl('vl-backend');
  try { if (be && localStorage.getItem('vl.backend') === 'worklet') { be.value = 'worklet'; vlBackendChanged(); } } catch { /* no storage */ }
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

// ── Back end: the node graph or the worklet prototype ───────────────────────
// Both read the same phoneme run and the same scheduled targets; only the stage that
// turns them into sound differs (see WK in audio-engine.js).
const _vlBackend = () => _vlEl('vl-backend')?.value || 'graph';
function vlBackendChanged() {
  const engine = window.AudioEngine, st = _vlEl('vl-wk-state');
  const be = _vlBackend();
  try { localStorage.setItem('vl.backend', be); } catch { /* no storage */ }
  if (be !== 'worklet' || !engine?.loadVoiceWorklet) { if (st) st.textContent = ''; return; }
  if (st) st.textContent = 'loading the worklet…';
  engine.loadVoiceWorklet().then(ok => { if (st) st.textContent = ok ? 'worklet ready' : 'worklet unavailable: lines play on the graph'; });
}

// The level a line came out at, read off a tap on the line's own mix (ahead of the bus),
// so an A/B can be level-matched: of two otherwise equal voices, the louder one wins.
// One analyser for the panel; each line's window is measured in turn.
let _vlTap = null;
function vlTap() {
  const nodes = window.AudioEngine?.engineNodes?.();
  if (!nodes?.ctx) return null;
  if (!_vlTap || _vlTap.ctx !== nodes.ctx) {
    const an = nodes.ctx.createAnalyser(); an.fftSize = 2048;
    _vlTap = { ctx: nodes.ctx, an, buf: new Float32Array(2048), levels: {} };
  }
  return _vlTap.an;
}
// Measure `label` for `seconds`, starting `delay` seconds from now.
function vlMeasure(label, delay, seconds) {
  const tap = _vlTap;
  if (!tap || !(seconds > 0)) return;
  setTimeout(() => {
    let sum = 0, n = 0, peak = 0;
    const stopAt = performance.now() + seconds * 1000;
    const timer = setInterval(() => {
      tap.an.getFloatTimeDomainData(tap.buf);
      for (const v of tap.buf) { if (Math.abs(v) > 1e-4) { sum += v * v; n++; } if (Math.abs(v) > peak) peak = Math.abs(v); }
      if (performance.now() < stopAt) return;
      clearInterval(timer);
      tap.levels[label] = n ? (10 * Math.log10(sum / n)).toFixed(1) + ' dB rms (peak ' + (20 * Math.log10(peak || 1e-9)).toFixed(1) + ')' : '—';
      const el = _vlEl('vl-level');
      if (el) el.textContent = Object.entries(tap.levels).map(([k, v]) => k + ' ' + v).join(' · ');
    }, 40);
  }, Math.max(0, delay * 1000));
}

function vlSpeakOpts(extra) {
  return {
    seed: _vlEl('vl-seed').value || 'broadcast',
    voice: Object.keys(_vlOverride).length ? _vlOverride : null,
    excite: +(_vlEl('vl-excite')?.value || 0),
    tap: vlTap(),
    ...extra,
  };
}
function vlUnmute(engine) {
  // The lab is the one place the TV-voice setting must not gate playback — you are
  // here to hear it. Forced for this panel only.
  try { engine.applyVolumeSettings({ enabled: true, tv: true, master: 1, tvVolume: 1 }); } catch { /* older signature */ }
}

function vlSpeak() {
  const engine = window.AudioEngine;
  if (!engine) return;
  vlUnmute(engine);
  const backend = _vlBackend();
  const res = engine.speak(_vlEl('vl-text').value, vlSpeakOpts({ backend }));
  if (res?.duration) vlMeasure(res.backend || 'graph', res.delay, res.duration);
  _vlEl('vl-dur').textContent = res?.duration
    ? res.duration.toFixed(2) + ' s on the ' + (res.backend || 'graph') + (res.backend && backend !== res.backend ? ' (the worklet is still loading)' : '')
    : 'not spoken (audio blocked or muted)';
  vlRender();
}
// The same line twice, graph then worklet, the second queued behind the first.
async function vlAB() {
  const engine = window.AudioEngine;
  if (!engine) return;
  vlUnmute(engine);
  const ok = await engine.loadVoiceWorklet?.();
  const text = _vlEl('vl-text').value;
  const a = engine.speak(text, vlSpeakOpts({ backend: 'graph' }));
  if (!a?.duration) { _vlEl('vl-dur').textContent = 'not spoken (audio blocked or muted)'; return; }
  const b = engine.speak(text, vlSpeakOpts({ backend: ok ? 'worklet' : 'graph', queue: true }));
  vlMeasure('graph', a.delay, a.duration);
  if (b?.duration) vlMeasure(b.backend, b.delay, b.duration);
  _vlEl('vl-dur').textContent = 'graph ' + a.duration.toFixed(2) + ' s, then ' + (b?.backend || '?') + ' ' + (b?.duration || 0).toFixed(2) + ' s';
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

// ── Modified Rhyme Test ─────────────────────────────────────────────────────
// House, Williams, Hecker & Kryter (1965), the 50 six-word ensembles as ANSI S3.2 lists
// them. Each set differs in one consonant, the first or the last, so a wrong pick says
// which contrast the voice lost. Typed from memory of the published list, then checked
// (2026-10-18): 25 sets vary the first consonant and 25 the last, as the test is built;
// Gibbon's handbook (1997) prints the peace/peas/peak/peach/peat/peal set as here; and a
// published one-word-per-set test list (Cambridge, S0899823X2200071X, appendix 1) lands
// one word in each set except that it has both "heal" and "beat", which these sets can't
// place apart, and nothing from peel/reel/feel. One of sets 27, 29, 34 and 35 may be off.
// Check those four against ANSI S3.2 before quoting a score.
const VL_MRT_SETS = [
  'went sent bent dent tent rent', 'hold cold told fold sold gold', 'pat pad pan path pack pass',
  'lane lay late lake lace lame', 'kit bit fit hit wit sit', 'must bust gust rust dust just',
  'teak team teal teach tear tease', 'din dill dim dig dip did', 'bed led fed red wed shed',
  'pin sin tin fin din win', 'dug dung duck dud dub dun', 'sum sun sung sup sub sud',
  'seep seen seethe seek seem seed', 'not tot got pot hot lot', 'vest test rest best west nest',
  'pig pill pin pip pit pick', 'back bath bad bass bat ban', 'way may say pay day gay',
  'pig big dig wig rig fig', 'pale pace page pane pay pave', 'cane case cape cake came cave',
  'shop mop cop top hop pop', 'coil oil soil toil boil foil', 'tan tang tap tack tam tab',
  'fit fib fizz fill fig fin', 'same name game tame came fame', 'peel reel feel eel keel heel',
  'hark dark mark bark park lark', 'heave hear heat heal heap heath', 'cup cut cud cuff cuss cub',
  'thaw law raw paw jaw saw', 'pen hen men then den ten', 'puff puck pub pus pup pun',
  'bean beach beat beak bead beam', 'heat neat feat seat meat beat', 'dip sip hip tip lip rip',
  'kill kin kit kick king kid', 'hang sang bang rang fang gang', 'took cook look hook shook book',
  'mass math map mat man mad', 'ray raze rate rave rake race', 'save same sale sane sake safe',
  'fill kill will hill till bill', 'sill sick sip sing sit sin', 'bale gale sale tale pale male',
  'wick sick kick lick pick tick', 'peace peas peak peach peat peal', 'bun bus but bug buck buff',
  'sag sat sass sack sad sap', 'fun sun bun gun run nun',
].map(s => s.split(' '));
// '#' is the word. The first is the ANSI carrier; the second is House et al.'s original.
const VL_MRT_CARRIERS = ['Please select the word #.', 'You will mark # please.', '#.'];
// Which consonant a set varies: the words share their ending (the first consonant
// differs) or their start (the last one does).
function vlMrtPosition(set) {
  const pre = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
  const rev = (w) => [...w].reverse().join('');
  let p = Infinity, s = Infinity;
  for (const w of set.slice(1)) {
    p = Math.min(p, pre(set[0], w));
    s = Math.min(s, pre(rev(set[0]), rev(w)));
  }
  return s >= p ? 'initial' : 'final';
}
// Pure, so a gate can check it: per back end, R, W, % correct and % corrected for guessing.
function vlMrtScore(trials) {
  const out = {};
  for (const t of trials) {
    if (t.pick == null) continue;
    const by = (out[t.backend] ||= { n: 0, r: 0, initial: [0, 0], final: [0, 0], misses: [] });
    const ok = t.pick === t.word;
    by.n++; if (ok) by.r++;
    const pos = by[t.position]; pos[1]++; if (ok) pos[0]++;
    if (!ok) by.misses.push(t.word + '→' + t.pick);
  }
  for (const s of Object.values(out)) {
    const w = s.n - s.r;
    s.pct = s.n ? 100 * s.r / s.n : 0;
    s.corrected = s.n ? 100 * (s.r - w / 5) / s.n : 0;
  }
  return out;
}

let _vlMrt = null;   // { trials, i, carrier, seed, voice }
function vlMrtStart() {
  const engine = window.AudioEngine;
  if (!engine) return;
  const mode = _vlEl('vl-mrt-mode')?.value || 'ab';
  const backends = mode === 'ab' ? ['graph', 'worklet'] : [mode];
  const trials = [];
  VL_MRT_SETS.forEach((set, si) => {
    for (const backend of backends) {
      trials.push({ set: si, backend, word: set[Math.floor(Math.random() * set.length)], position: vlMrtPosition(set), pick: null });
    }
  });
  for (let i = trials.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [trials[i], trials[j]] = [trials[j], trials[i]]; }
  _vlMrt = { trials, i: 0, mode, carrier: VL_MRT_CARRIERS[+(_vlEl('vl-mrt-carrier')?.value || 0)],
    seed: _vlEl('vl-seed').value || 'broadcast', voice: Object.keys(_vlOverride).length ? { ..._vlOverride } : null };
  _vlEl('vl-mrt-result').textContent = '';
  const go = () => { vlMrtShow(); vlMrtPlay(); };
  if (backends.includes('worklet')) {
    _vlEl('vl-mrt-progress').textContent = 'loading the worklet…';
    engine.loadVoiceWorklet().then(ok => {
      if (!ok) { _vlMrt = null; _vlEl('vl-mrt-progress').textContent = 'the worklet did not load; run graph only'; return; }
      go();
    });
  } else go();
}
function vlMrtShow() {
  const m = _vlMrt, host = _vlEl('vl-mrt-choices');
  if (!host) return;
  if (!m || m.i >= m.trials.length) { host.innerHTML = ''; return; }
  const t = m.trials[m.i];
  _vlEl('vl-mrt-progress').textContent = 'trial ' + (m.i + 1) + ' / ' + m.trials.length;
  host.innerHTML = VL_MRT_SETS[t.set].map((w, k) =>
    `<button class="action-btn" style="font-size:14px;padding:8px" onclick="vlMrtChoose(${k})">${k + 1}. ${w}</button>`).join('');
}
function vlMrtPlay() {
  const m = _vlMrt, engine = window.AudioEngine;
  if (!m || !engine || m.i >= m.trials.length) return;
  vlUnmute(engine);
  const t = m.trials[m.i];
  const res = engine.speak(m.carrier.replace('#', t.word), { seed: m.seed, voice: m.voice, backend: t.backend });
  // A trial scores the back end that actually spoke it.
  if (res?.backend) t.backend = res.backend;
}
function vlMrtChoose(k) {
  const m = _vlMrt;
  if (!m || m.i >= m.trials.length) return;
  const t = m.trials[m.i];
  t.pick = VL_MRT_SETS[t.set][k];
  m.i++;
  if (m.i >= m.trials.length) { vlMrtStop(); return; }
  vlMrtShow();
  setTimeout(vlMrtPlay, 350);
}
function vlMrtStop() {
  const m = _vlMrt;
  if (!m) return;
  window.AudioEngine?.cancelSpeech?.();
  _vlMrt = null;
  vlMrtShow();
  const done = m.trials.filter(t => t.pick != null);
  _vlEl('vl-mrt-progress').textContent = done.length + ' trials scored';
  if (!done.length) return;
  const score = vlMrtScore(done);
  const lines = Object.entries(score).map(([be, s]) =>
    be.padEnd(8) + s.pct.toFixed(1).padStart(5) + '% correct  ' + s.corrected.toFixed(1).padStart(5) + '% corrected  (' + s.r + '/' + s.n + ')' +
    '  initial ' + s.initial[0] + '/' + s.initial[1] + '  final ' + s.final[0] + '/' + s.final[1] +
    (s.misses.length ? '\n         missed: ' + s.misses.join(', ') : ''));
  _vlEl('vl-mrt-result').textContent = 'seed ' + m.seed + ', carrier "' + m.carrier + '"\n' + lines.join('\n');
  try {
    const hist = JSON.parse(localStorage.getItem('vl.mrt') || '[]');
    hist.unshift({ at: new Date().toISOString(), seed: m.seed, carrier: m.carrier, voice: m.voice,
      score: Object.fromEntries(Object.entries(score).map(([be, s]) => [be, { n: s.n, r: s.r, pct: +s.pct.toFixed(1),
        corrected: +s.corrected.toFixed(1), initial: s.initial, final: s.final, misses: s.misses }])) });
    localStorage.setItem('vl.mrt', JSON.stringify(hist.slice(0, 20)));
  } catch { /* no storage */ }
  vlMrtHistory();
}
function vlMrtHistory() {
  const el = _vlEl('vl-mrt-history');
  if (!el) return;
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem('vl.mrt') || '[]'); } catch { /* no storage */ }
  el.textContent = hist.length ? 'Earlier runs:\n' + hist.slice(0, 8).map(h => h.at.slice(0, 16).replace('T', ' ') + '  ' + h.seed + '  ' +
    Object.entries(h.score).map(([be, s]) => be + ' ' + s.pct + '% (' + s.corrected + ' corrected, n=' + s.n + ')').join('   ')).join('\n') : '';
}
// 1-6 pick and R replays while a run is on, unless the focus is in a field.
document.addEventListener('keydown', (e) => {
  if (!_vlMrt || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
  if (e.key >= '1' && e.key <= '6') { vlMrtChoose(+e.key - 1); e.preventDefault(); }
  else if (e.key === 'r' || e.key === 'R') { vlMrtPlay(); e.preventDefault(); }
});
