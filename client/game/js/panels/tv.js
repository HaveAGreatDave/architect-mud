// Television renderer — receives live broadcast push via the existing WS tick.
//
// This module is a FACTORY (`createTvView`), not a singleton, because the same
// renderer now drives two surfaces: the standalone CRT popup (`watch tv` at a
// physical set, the `#tv-panel` markup in index.html) and the portable Tablet OS
// TV app (its own viewport inside the tablet chassis). Both find their elements
// through `data-tv="…"` hooks scoped to the instance's root, so neither depends
// on document-wide ids.
//
// The historical named exports (openTvPanel, appendTvMessage, …) are preserved as
// thin delegates to a default instance bound to `#tv-panel`, so dispatch.js and
// initTvPanel() keep working exactly as before.

import { sendCmdSilent, sendRaw } from '../net.js';
import { renderMarkup } from '../markup.js';
import { createGamedayView } from './gameday.js';
import { createRinkView } from './gameday-rink.js';
import { cphlMark, cphlLockup } from './cphl-brand.js';

// Render an NPC say line in screenplay style: the speaker's name (in the TV
// accent color) on its own line, their speech directly beneath it — no gap.
// Runs on already-rendered (HTML-safe) markup, so the <span>/<br> we add here
// survive instead of being escaped into visible tags. Matches "Name says, "…"".
function _tvColorizeNpcSay(html) {
  return html.replace(/^(.+?) says, "([\s\S]*)"$/, (_, name, speech) =>
    `<span class="tv-speaker" style="color:var(--tv-header-color,var(--accent))">${name}:</span><br>"${speech}"`
  );
}

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Read-aloud is one player-level preference shared by every surface — toggling it
// on the tablet turns it off on the wall set too, which is what a single "read the
// broadcast to me" setting should do.
let _readAloud = localStorage.getItem('tvReadAloud') === '1';

// Every live instance, so dispatch.js can fan a server message out to whichever
// surface(s) are actually tuned to that channel.
const _views = new Set();

// The synth voice is a single global resource (AudioEngine.speak / cancelSpeech).
// Exactly one instance owns it at a time — claimed on open/tune — so two surfaces
// never narrate over each other.
let _speechOwner = null;

// CRT hum/static are per-viewer loops; power-on/off are one-shot SFX.
// Local ids are fixed so AudioEngine can track the loops by id regardless of
// what config the server supplies — each instance suffixes its own key onto them
// so two open surfaces never fight over one loop's gain. Configs are replaced at
// open time if the server sends registered defs (from audio_ambient / audio_sfx).
// Gains kept deliberately low so hum/static sit as gentle background texture,
// not foreground noise (they're still scaled by the TV-audio bus on top of this).
const TV_HUM_DEF     = { id: 'tv_hum_local',     category: 'tv', priority: 1, loop: true, config: { waveform: 'sine',     freq: 60,  gain: 0.02, noiseMix: 0.15, filter: { type: 'lowpass',  freq: 400,  q: 0.7 }, adsr: { a: 0.5,   d: 0.1,  s: 1,   r: 0.5  } } };
const TV_STATIC_DEF  = { id: 'tv_static_local',  category: 'tv', priority: 1, loop: true, config: { waveform: 'noise',    noiseMix: 1, gain: 0.03, filter: { type: 'highpass', freq: 700,  q: 0.5 }, tremolo: { rate: 35, depth: 0.6 }, adsr: { a: 0.02,  d: 0.02, s: 1,   r: 0.3  } } };
const TV_POWER_ON_DEF  = { id: 'tv_power_on_local',  category: 'tv', priority: 3, config: { waveform: 'triangle', freq: 80,  duration: 0.35, noiseMix: 0.3, pitchBend: { to: 600, time: 0.25 }, filter: { type: 'lowpass', freq: 3000, q: 1 }, adsr: { a: 0.005, d: 0.15, s: 0.3, r: 0.15 } } };
const TV_POWER_OFF_DEF = { id: 'tv_power_off_local', category: 'tv', priority: 3, config: { waveform: 'triangle', freq: 900, duration: 0.3,  noiseMix: 0.2, pitchBend: { to: 40,  time: 0.25 }, filter: { type: 'lowpass', freq: 4000, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0.2, r: 0.2  } } };

const MAX_TV_HISTORY = 200;
const LOCK_RANGE   = 0.25; // within this many channel-numbers = lock in
const TV_DIAL_MAX  = 9.05; // dial wraps 0.0 → 9.0 → 0.0 (9.0 + 0.05 step = wrap)
const DIAL_SWEEP_SPEED = 4; // frequency-units per second — how long static shows between channels
const _TV_THEME_VARS = ['--tv-bg', '--tv-border', '--tv-text', '--tv-header-color', '--tv-live-color', '--tv-ticker-color'];

/**
 * Build a TV surface bound to `root`.
 *
 * @param {HTMLElement} root  container holding the `data-tv="…"` hooks
 * @param {object} opts
 *   key        unique instance key — suffixes the audio loop ids ('panel' | 'tablet')
 *   chassis    'crt' (standalone popup: draggable, CRT collapse, ESC) | 'tablet'
 *   tuneCmd    command verb used to tune ('tune' | 'tablettune')
 *   watchMsg   raw WS type sent to register as a viewer ('tv_watch' | 'tablet_tv_watch')
 *   unwatchMsg raw WS type sent on close ('tv_unwatch' | 'tablet_tv_unwatch')
 *   onClose    optional callback when the surface closes (tablet uses it to unmount)
 */
export function createTvView(root, opts = {}) {
  const key        = opts.key || 'panel';
  const chassis    = opts.chassis || 'crt';
  const tuneCmd    = opts.tuneCmd || 'tune';
  const watchMsg   = opts.watchMsg || 'tv_watch';
  const unwatchMsg = opts.unwatchMsg || 'tv_unwatch';
  const isCrt      = chassis === 'crt';

  // Scoped lookup — the whole reason two surfaces can coexist.
  const el = (name) => root ? root.querySelector(`[data-tv="${name}"]`) : null;
  // Some readouts appear more than once on a surface (the tablet shows the tuned
  // channel both in its header strip and as the big tuner readout by the CH buttons).
  // Writing through this keeps every copy in step instead of only the first match.
  const setAll = (name, text) => {
    if (!root) return;
    for (const n of root.querySelectorAll(`[data-tv="${name}"]`)) n.textContent = text;
  };

  // ── per-instance state ────────────────────────────────────────────────────
  let _tvOpen = false;
  let _tvShuttingDown = false;
  let _tvPoweredOff = false;
  let _tvActiveChannelId = null;
  let _tvOffAir = false;
  const _tvHistory = [];
  let _clearAfterTitleCard = false;
  let _tickerText = '';
  let _tickerAnimating = false;
  let _overlayTimer = null;
  let _tuneTimer = null;
  let _standingsTimer = null;
  let _fxTimer = null;
  let _gamedayView = null;
  let _gamedaySport = null;   // which sport the mounted sub-screen renders
  let _gamedayOpen = false;
  let _lastGameday = null;
  let _scheduleOpen = false;
  let _scheduleTimer = null;
  let _standingsPanelOpen = false;
  let _standingsPanelTimer = null;
  let _tvChannelList = [];   // [{ number, name, channelId }] sorted by number
  let _tvFrequency   = 0;    // current dial position (float), quantized to 0.05 steps
  let _dialRaw       = 0;    // unquantized accumulator driving drag math
  let _sweepRaf      = null;
  let _wheelTarget   = null;
  let _tvThemeKey    = null;
  let _tvThemeTimer  = null;
  let _lastSpeakAt   = 0;
  let _speakWindow   = 5;    // fallback: estimated seconds between spoken lines
  let _inited        = false;

  // Per-instance audio defs so two surfaces never cross-talk on loop gain.
  let _humDef      = { ...TV_HUM_DEF,       id: `${TV_HUM_DEF.id}_${key}` };
  let _staticDef   = { ...TV_STATIC_DEF,    id: `${TV_STATIC_DEF.id}_${key}` };
  let _powerOnDef  = { ...TV_POWER_ON_DEF,  id: `${TV_POWER_ON_DEF.id}_${key}` };
  let _powerOffDef = { ...TV_POWER_OFF_DEF, id: `${TV_POWER_OFF_DEF.id}_${key}` };

  function _setStaticAudio(fraction, rampSeconds) {
    window.AudioEngine?.setLoopGain(_staticDef.id, fraction, rampSeconds);
  }

  // ── read-aloud ────────────────────────────────────────────────────────────
  // Only speaks actual dialogue/narration (style 'raw' & friends) — tickers, title
  // cards, overlays and score-bugs travel on other styles and stay silent. The
  // narrator's name (the "Name says" prefix) is dropped from what's spoken but used
  // to SEED the voice, so each host sounds consistent; narration with no speaker
  // falls back to the station name as the seed.
  function speak(rawText, style, windowSec) {
    // While the Gameday view is open it owns Chip's voice, starting it exactly when
    // his caption is displayed (a play-by-play line waits for the hit to land).
    if (_gamedayOpen && _gamedayView) return;
    _speakNow(rawText, style, windowSec);
  }

  // ── speech queue ──────────────────────────────────────────────────────────
  // Lines arrive on the SERVER's clock: broadcast sets bb.waitUntil from
  // nodeHoldMs, a text-length ESTIMATE (110ms/char + 1s, rounded to the 1s tick).
  // The voice reads at its own pace and — measured across all 27 .bsm scripts —
  // finishes inside that hold on every genuine line of dialogue, averaging 2.3s
  // early. Speaking on arrival therefore left the set silent for a couple of
  // seconds between every line, and on the rare overrun the next arrival called
  // AudioEngine.speak, whose first act is cancel() — truncating mid-word.
  //
  // So lines QUEUE instead. A line is spoken the moment the previous one ends,
  // which closes the dead air, and an overrun delays the next line rather than
  // amputating this one. speak() hands back the true duration, so the chain is
  // driven by what the voice actually did, not by another estimate.
  //
  // The cost is DRIFT: the client now paces off its own voice while the server
  // graph runs on its clock for every viewer at once. See _sceneBeat().
  const MAX_UTTERANCE = 220;   // chars
  // Breath between chained lines. Lives in the synth's tunables so it can be turned
  // by ear in the voice lab alongside every other pacing number, rather than being a
  // second timing constant in a different file that quietly disagrees with them.
  const lineGap = () => window.AudioEngine?.voiceTuning?.lineGapMs ?? 180;
  const RESYNC_MS     = 2500;  // backlog past which we shed at the next scene beat
  let _speechQ = [];           // [{ speech, seed, at }]
  let _busyUntil = 0;          // performance.now() when the current utterance ends
  let _pumpTimer = null;

  // A line longer than 273 characters CANNOT fit its hold, whatever the voice
  // does — nodeHoldMs caps at 30s while speech keeps growing. That is the only
  // structural source of backlog in the corpus (one 585-char legal crawl), so
  // long lines are split into separate utterances on sentence then comma
  // boundaries, exactly as the library reader does. This is internal to the
  // voice: the caption is still displayed as one message.
  // Three cascading levels, because the bound has to actually BE a bound: the
  // 585-char crawl in the_last_lot.bsm is punctuated only with middots, so neither
  // sentence nor comma splitting touches it and a two-level version still emitted a
  // 520-char utterance. The word-level wrap is the floor that can't be fallen through.
  function _splitUtterance(text) {
    if (text.length <= MAX_UTTERANCE) return [text];
    const pack = (atoms) => {
      const out = []; let buf = '';
      for (const at of atoms) {
        if (buf && (buf + ' ' + at).length > MAX_UTTERANCE) { out.push(buf); buf = at; }
        else buf = buf ? buf + ' ' + at : at;
      }
      if (buf) out.push(buf);
      return out;
    };
    const under = p => p.length <= MAX_UTTERANCE;
    let parts = pack(text.split(/(?<=[.!?])\s+/));                              // sentences
    parts = parts.flatMap(p => under(p) ? [p] : pack(p.split(/(?<=[,;:·—])\s+/)));  // clauses
    parts = parts.flatMap(p => under(p) ? [p] : pack(p.split(/\s+/)));          // words
    return parts.filter(Boolean);
  }

  function _clearSpeech() {
    _speechQ = [];
    _busyUntil = 0;
    if (_pumpTimer) { clearTimeout(_pumpTimer); _pumpTimer = null; }
  }

  function _pump() {
    if (_pumpTimer) { clearTimeout(_pumpTimer); _pumpTimer = null; }
    if (!_speechQ.length) return;
    const now = performance.now();
    if (now < _busyUntil) { _pumpTimer = setTimeout(_pump, _busyUntil - now); return; }
    const item = _speechQ.shift();
    // A muted or disabled engine returns nothing; treat it as a zero-length read
    // so the queue drains immediately instead of stalling forever on a dead voice.
    const res = window.AudioEngine?.speak(item.speech, { seed: item.seed, budget: item.budget });
    const dur = (res && res.duration > 0) ? res.duration * 1000 : 0;
    _busyUntil = now + dur + lineGap();
    if (_speechQ.length) _pumpTimer = setTimeout(_pump, dur + lineGap());
  }

  // How long the oldest unspoken line has been waiting — i.e. how far the voice
  // has fallen behind the server's timeline.
  function _backlogMs() {
    return _speechQ.length ? performance.now() - _speechQ[0].at : 0;
  }

  // A scene beat: a title card, ticker, overlay or any other non-spoken message.
  // Drift is only a problem when spoken lines start landing against the wrong
  // picture, and a beat is where that becomes visible — so it is also the only
  // safe place to resync. Shedding here costs a whole line at a natural break
  // instead of a random line mid-scene or half a word mid-vowel. In the measured
  // corpus the backlog never reaches the threshold, so this should not fire;
  // it exists to BOUND worst-case drift, not to run in normal operation.
  function _sceneBeat() {
    if (_backlogMs() <= RESYNC_MS) return;
    _speechQ = _speechQ.slice(-1);   // keep only the freshest line, drop the stale ones
  }

  function _speakNow(rawText, style, windowSec) {
    if (!_readAloud || !rawText) return;
    if (_speechOwner && _speechOwner !== view) return;   // another surface owns the voice
    if (style && style !== 'raw' && style !== 'emote' && style !== 'narrate' && style !== 'system') return;
    const strip = s => s.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();  // drop markup/bug tags
    let seed, speech;
    const m = /^(.+?) says, "([\s\S]*)"$/.exec(rawText);
    if (m) { seed = strip(m[1]); speech = strip(m[2]); }
    else { seed = (el('station-name')?.textContent || 'broadcast').trim(); speech = strip(rawText); }
    if (!speech) return;
    // Track inter-line gaps as a fallback window (for broadcasts that don't send one).
    const now = performance.now();
    const gap = (now - _lastSpeakAt) / 1000;
    if (_lastSpeakAt && gap > 1 && gap < 30) _speakWindow = _speakWindow * 0.5 + gap * 0.5;
    _lastSpeakAt = now;
    // The server's per-line window (the text-scaled hold), falling back to the
    // measured gap. Passed for information only — the voice always reads at its own
    // pace and never compresses to fit (see AudioEngine.speak).
    const budget = windowSec > 0.5 ? windowSec : _speakWindow;
    for (const piece of _splitUtterance(speech)) _speechQ.push({ speech: piece, seed, budget, at: now });
    _pump();
  }

  // ── open / close ──────────────────────────────────────────────────────────
  function open(data) {
    const wasAlreadyOn = _tvOpen;
    const wasPoweredOff = _tvPoweredOff;
    // The server echoes a tv_panel message back after every player-initiated tune
    // (to push updated station/channel metadata). If the surface is already open,
    // this is just that echo, not a fresh power-on — so sync metadata only and
    // leave the dial position / power animation alone. Re-running the full reset
    // here snapped the knob back to 0 mid-drag and replayed the power-on static.
    //
    // ...UNLESS the set was sitting POWERED OFF and this message brings it a channel.
    // That's a genuine power-on, not an echo, and it has to run the reveal below —
    // treating it as an echo returns early with the screen still hidden behind static,
    // so broadcast lines pile up in a display nobody can see. (Bites both surfaces: the
    // Tablet TV app always mounts powered-off, and the wall set does it whenever you
    // `use` a dark television and then tune it.)
    const isTuneEcho = wasAlreadyOn && !(wasPoweredOff && data.channelId);

    if (data.sounds) {
      // Adopt any server/DB-supplied configs, but cap the idle hum/static gain to a
      // gentle background level so they can never come back as foreground noise.
      // Ids stay per-instance regardless of what the server sends.
      if (data.sounds.hum)      _humDef      = { ..._humDef,      config: { ...data.sounds.hum.config,      gain: Math.min(data.sounds.hum.config?.gain    ?? 0.02, 0.02) } };
      if (data.sounds.static)   _staticDef   = { ..._staticDef,   config: { ...data.sounds.static.config,   gain: Math.min(data.sounds.static.config?.gain ?? 0.03, 0.03) } };
      if (data.sounds.powerOn)  _powerOnDef  = { ..._powerOnDef,  config: data.sounds.powerOn.config };
      if (data.sounds.powerOff) _powerOffDef = { ..._powerOffDef, config: data.sounds.powerOff.config };
    }

    const _channelChanged = (data.channelId || null) !== _tvActiveChannelId;
    if (_channelChanged) { _clearScorebug(); _clearStandings(); _clearSportsFx(); _clearGameday(); _clearStandingsPanel(); _clearFilmLayers(); }
    _tvActiveChannelId = data.channelId || null;
    // Keep the TV guide open across a channel change, but refresh it for the new station.
    if (_channelChanged && _scheduleOpen) _requestSchedule();
    _tvOpen = true;
    _tvShuttingDown = false;
    _tvPoweredOff = !data.channelId || data.channelNumber === 0;
    if (_tvActiveChannelId) {
      sendRaw({ type: watchMsg, channelId: _tvActiveChannelId });
      _speechOwner = view;   // the surface you just tuned owns the voice
    }
    _tvHistory.length = 0;
    _tickerText = '';
    _tickerAnimating = false;
    _clearAfterTitleCard = false;
    _tvChannelList = Array.isArray(data.channelList) ? data.channelList : [];

    const stationEl = el('station-name');
    if (stationEl) stationEl.textContent = data.stationName || data.channelName || '——';
    setAll('channel-num', (data.channelNumber > 0) ? `CH ${data.channelNumber}` : '——');
    const pnEl = el('program-name');
    if (pnEl) { pnEl.textContent = ''; pnEl.style.opacity = ''; }
    const msgs = el('messages');
    if (msgs) msgs.innerHTML = '';

    const inner = el('ticker-inner');
    if (inner) {
      inner.style.transition = 'none';
      inner.style.transform  = '';
      inner.textContent = '';
    }

    applyTheme(data.theme || null);

    // Chassis skin is a property of the physical set (device flag), not the channel —
    // so it persists across tune echoes. Default 'crt' = the base #tv-window chassis.
    const skinWin = el('window');
    if (skinWin) skinWin.dataset.skin = data.skin || (isCrt ? 'crt' : 'tablet');

    // Keep the DIAL in step with whatever is actually tuned. The channel can change by a
    // route that never touches the dial — a Tablet TV channel chip, or `tune` typed in the
    // room — and both CH up/down and the lock logic step RELATIVE to _tvFrequency, so a
    // stale 0 here sends "channel up" back to the bottom of the band instead of one step up.
    // Only snap when the dial isn't already parked on this channel, so a live drag or sweep
    // (which is already within LOCK_RANGE when the echo lands) is never fought mid-gesture.
    if (data.channelNumber > 0 && Math.abs(_tvFrequency - data.channelNumber) > LOCK_RANGE) {
      _tvFrequency = data.channelNumber;
      _dialRaw = data.channelNumber;
      _updateKnobRotation();
      const fd = el('freq-display');
      if (fd) fd.textContent = _tvFrequency.toFixed(2);
    }

    if (isTuneEcho) return; // metadata synced; dial position and animations untouched

    if (!_tvActiveChannelId) { _tvFrequency = 0; _dialRaw = 0; }   // genuinely off — park the dial
    const freqDisplay = el('freq-display');
    if (freqDisplay) freqDisplay.textContent = _tvFrequency.toFixed(1);

    root.classList.add('active');
    window.AudioEngine?.loopSound(_humDef);
    window.AudioEngine?.loopSound(_staticDef);
    _setStaticAudio(0);

    const content  = el('content');
    const staticEl = el('static');
    if (!content || !staticEl) return;

    if (_tvPoweredOff) {
      // Opened at 0.0 — show static, content hidden
      content.classList.add('tv-hidden');
      staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
      staticEl.style.opacity = '1';
      staticEl.classList.add('tv-static-on');
      _playCrtPowerOn();
    } else {
      // CRT power-on: expand from bright line, then reveal content
      content.classList.add('tv-hidden');
      staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
      staticEl.style.opacity = '1';
      staticEl.classList.add('tv-static-on');
      _playCrtPowerOn();
      _tuneTimer = setTimeout(() => {
        _tuneTimer = null;
        if (_tvOffAir) return;
        staticEl.classList.remove('tv-static-on');
        staticEl.classList.add('tv-static-fade');
        content.classList.remove('tv-hidden');
        staticEl.addEventListener('animationend', () => {
          staticEl.classList.remove('tv-static-fade');
          // Drop the inline opacity:1 set on power-up too — it outranks the stylesheet's
          // resting opacity:0, so leaving it would snap the static back over the picture
          // the instant the fade class comes off.
          staticEl.style.opacity = '';
        }, { once: true });
        _setStaticAudio(0, 0.3);
      }, 720);
    }
  }

  function _playTuneAnimation() {
    if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }

    const staticEl = el('static');
    const content  = el('content');
    const knob     = el('knob');
    if (!staticEl || !content) return;

    // Hide content, show static — clear inline knob rotation so spin plays cleanly
    _tvOffAir = false;
    content.style.opacity = '';
    content.classList.add('tv-hidden');
    staticEl.style.opacity = '';
    staticEl.classList.remove('tv-static-fade');
    if (knob) knob.style.transform = '';
    staticEl.classList.add('tv-static-on');
    _setStaticAudio(1);

    if (knob) {
      knob.classList.remove('tv-knob-spinning');
      knob.offsetWidth; // force reflow to restart animation
      knob.classList.add('tv-knob-spinning');
    }

    // After knob settles (~1.1s), fade static out and reveal content (unless off-air)
    _tuneTimer = setTimeout(() => {
      if (knob) knob.classList.remove('tv-knob-spinning');
      _updateKnobRotation();
      const pn = el('program-name');
      if (pn) pn.style.opacity = '1';
      _tuneTimer = null;
      if (_tvOffAir) return;
      staticEl.classList.remove('tv-static-on');
      staticEl.classList.add('tv-static-fade');
      content.classList.remove('tv-hidden');
      staticEl.addEventListener('animationend', () => {
        staticEl.classList.remove('tv-static-fade');
      }, { once: true });
      _setStaticAudio(0, 0.3);
      content.style.opacity = '';
    }, 1200);
  }

  function _playCrtPowerOn() {
    const win = el('window');
    const staticEl = el('static');
    if (!staticEl) return;

    // Static comes on as the CRT warms up
    staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
    staticEl.style.opacity = '1';
    staticEl.classList.add('tv-static-on');
    _setStaticAudio(1);
    window.AudioEngine?.playSfx(_powerOnDef);

    if (!win) return;
    win.classList.remove('tv-powering-on');
    win.offsetWidth; // force reflow to restart animation
    win.classList.add('tv-powering-on');
    win.addEventListener('animationend', () => win.classList.remove('tv-powering-on'), { once: true });
  }

  // ── themes ────────────────────────────────────────────────────────────────
  // Low-level: write a theme's CSS variables onto the window element, or clear them
  // for the neutral default (corporate) look. CSS transitions animate the swap.
  function _writeTvTheme(win, theme) {
    for (const v of _TV_THEME_VARS) win.style.removeProperty(v);
    if (!theme) { win.dataset.theme = 'corporate'; return; }
    const map = {
      '--tv-bg': theme.bg_color,
      '--tv-border': theme.border_color,
      '--tv-text': theme.text_color,
      '--tv-header-color': theme.header_color || theme.accent_color,
      '--tv-live-color': theme.live_color,
      '--tv-ticker-color': theme.ticker_color,
    };
    for (const [k, v] of Object.entries(map)) if (v) win.style.setProperty(k, v);
    win.dataset.theme = theme.preset || 'corporate';
  }

  function applyTheme(theme) {
    const win = el('window');
    if (!win) return;

    const key2 = theme
      ? JSON.stringify([theme.preset, theme.bg_color, theme.border_color, theme.text_color,
          theme.header_color || theme.accent_color, theme.live_color, theme.ticker_color])
      : 'default';
    if (key2 === _tvThemeKey) return; // already showing this theme — don't restart the fade

    if (_tvThemeTimer) { clearTimeout(_tvThemeTimer); _tvThemeTimer = null; }
    _tvThemeKey = key2;

    // Fade out to the neutral default first (like tuning through the dial), then
    // fade in to the target station's theme. Both steps eased by CSS transitions.
    _writeTvTheme(win, null);
    if (key2 === 'default') return;
    _tvThemeTimer = setTimeout(() => { _writeTvTheme(win, theme); _tvThemeTimer = null; }, 420);
  }

  function close() {
    if (_speechOwner === view) { window.AudioEngine?.cancelSpeech(); _clearSpeech(); _speechOwner = null; }
    _tvOpen = false;
    _tvShuttingDown = false;
    _tvPoweredOff = false;
    _tvActiveChannelId = null;
    _tvOffAir = false;
    _tvThemeKey = null;
    if (_tvThemeTimer) { clearTimeout(_tvThemeTimer); _tvThemeTimer = null; }
    sendRaw({ type: unwatchMsg });
    if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }
    if (_sweepRaf) { cancelAnimationFrame(_sweepRaf); _sweepRaf = null; }
    _clearOverlay();
    _clearScorebug();
    _clearStandings();
    _clearSportsFx();
    _clearGameday();
    _clearSchedule();
    _clearStandingsPanel();
    _clearFilmLayers();
    const win = el('window');
    if (win) {
      win.classList.remove('tv-shutting-off');
      win.style.position = '';
      win.style.left = '';
      win.style.top = '';
      win.style.margin = '';
    }
    el('static')?.classList.remove('tv-static-on', 'tv-static-fade', 'tv-static-loop');
    el('content')?.classList.remove('tv-hidden');
    root.classList.remove('active');
    window.AudioEngine?.stopLoop(_humDef.id);
    window.AudioEngine?.stopLoop(_staticDef.id);
    opts.onClose?.();
  }

  function shutdown() {
    if (!_tvOpen || _tvShuttingDown) return;
    // The tablet app has no CRT to collapse — it just closes (the tablet shell
    // itself owns the leaving animation).
    if (!isCrt) { close(); return; }
    if (_speechOwner === view) { window.AudioEngine?.cancelSpeech(); _clearSpeech(); _speechOwner = null; }
    _tvShuttingDown = true;
    if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }

    // Brief static flash, then CRT vertical collapse
    const staticEl = el('static');
    if (!staticEl) { close(); return; }
    staticEl.classList.remove('tv-static-fade');
    staticEl.classList.add('tv-static-on');
    _setStaticAudio(1);

    setTimeout(() => {
      staticEl.classList.remove('tv-static-on');
      _setStaticAudio(0, 0.1);
      const win = el('window');
      window.AudioEngine?.playSfx(_powerOffDef);
      if (!win) { close(); return; }
      win.classList.add('tv-shutting-off');
      win.addEventListener('animationend', () => close(), { once: true });
    }, 280);
  }

  // ── overlays ──────────────────────────────────────────────────────────────
  function applyOverlay(overlay) {
    // The score-bug is a persistent layer (updated in place, its own container) —
    // it must not be wiped by transient overlays, nor auto-dismiss on a timer.
    if (overlay && overlay.overlayType === 'scorebug') { _applyScorebug(overlay); return; }
    if (overlay && overlay.overlayType === 'gameday') { _handleGameday(overlay); return; }
    if (overlay && overlay.overlayType === 'standings') { _applyStandingsBug(overlay); return; }
    // Film layers. Letterbox is persistent — a matte the picture switches on and off,
    // never a timed card — and the fade is a one-shot transition that paints over
    // everything, so neither may go through the transient overlay container.
    if (overlay && overlay.overlayType === 'letterbox') { _applyLetterbox(!!overlay.on); return; }
    if (overlay && overlay.overlayType === 'fade') { _applyFade(overlay.fade || 'out', overlay.duration || 3); return; }
    // Sports "jumbotron" FX. While the Gameday sub-screen is open, render it Gameday-
    // native (a compact card over the field) instead of taking over the whole screen.
    if (overlay && overlay.overlayType === 'sportsfx') {
      if (_gamedayOpen && _gamedayView) _gamedayView.showCard(overlay);
      else _applySportsFx(overlay);
      return;
    }
    _clearOverlay();
    const container = el('overlay-container');
    if (!container || !overlay) return;

    let node;
    if (overlay.overlayType === 'text_card') {
      _clearTvMessages();
      node = document.createElement('div');
      node.className = 'tv-overlay-text-card';
      node.innerHTML = _esc(overlay.text).replace(/\n/g, '<br>');
    } else if (overlay.overlayType === 'lower_third') {
      node = document.createElement('div');
      node.className = 'tv-overlay-lower-third';
      node.innerHTML =
        `<div class="tv-overlay-lt-name">${_esc(overlay.text)}</div>` +
        (overlay.subtext ? `<div class="tv-overlay-lt-sub">${_esc(overlay.subtext)}</div>` : '');
    } else if (overlay.overlayType === 'act_card') {
      // Chapter/pre-roll card — the distributor plate, the certificate, the act break.
      _clearTvMessages();
      node = document.createElement('div');
      node.className = 'tv-overlay-act-card';
      node.innerHTML =
        `<div class="tv-act-title">${_esc(overlay.text)}</div>` +
        (overlay.subtext ? `<div class="tv-act-sub">${_esc(overlay.subtext)}</div>` : '');
    } else if (overlay.overlayType === 'intermission') {
      // The reel change. Holds the house card for its full duration, so somebody who
      // tunes in during one sees an intermission, exactly as they would have.
      _clearTvMessages();
      node = document.createElement('div');
      node.className = 'tv-overlay-intermission';
      node.innerHTML =
        `<div class="tv-intermission-title">${_esc(overlay.text || 'INTERMISSION')}</div>` +
        `<div class="tv-intermission-sub">The picture will continue.</div>`;
    } else if (overlay.overlayType === 'alert_flash') {
      node = document.createElement('div');
      node.className = 'tv-overlay-alert';
      node.innerHTML =
        `<div class="tv-overlay-alert-title">${_esc(overlay.text)}</div>` +
        (overlay.subtext ? `<div class="tv-overlay-alert-sub">${_esc(overlay.subtext)}</div>` : '');
    }

    if (node) {
      container.appendChild(node);
      if (overlay.duration > 0) {
        _overlayTimer = setTimeout(_clearOverlay, overlay.duration * 1000);
      }
    }
  }

  // ── film layers ───────────────────────────────────────────────────────────
  // The matte a picture frames itself with. Persistent by design: it is switched on
  // at the head of the feature and off before the credit crawl, and survives every
  // transient card in between. Also carries the grain — a film on a Basin set is a
  // recording of a recording, and it should not look like the news.
  function _applyLetterbox(on) {
    const host = el('letterbox');
    if (!host) return;
    host.classList.toggle('tv-letterbox-on', !!on);
    const win = el('window');
    if (win) win.classList.toggle('tv-filmic', !!on);
  }

  // One-shot optical transition. `out` dips to black and holds there; `in` starts
  // black and lifts. Both are pure CSS — nothing is queued, so a late tuner who lands
  // mid-fade simply sees the shot that follows it.
  function _applyFade(dir, seconds) {
    const host = el('fade');
    if (!host) return;
    const ms = Math.max(0.2, Number(seconds) || 3) * 1000;
    host.style.transitionDuration = `${ms}ms`;
    host.classList.toggle('tv-fade-black', dir !== 'in');
  }

  function _clearOverlay() {
    if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
    const container = el('overlay-container');
    if (container) container.innerHTML = '';
  }

  // Persistent sports score-bug. Sport-agnostic: always renders the two teams, their
  // scores, and a status line. Baseball adds the diamond + out dots when the payload
  // carries `bases`/`outs`; a sport without those simply shows the bar with no
  // diamond. Updated in place so it stays constant between plays.
  function _applyScorebug(sb) {
    const host = el('scorebug');
    if (!host) return;
    const away = _esc(sb.awayAbbr || sb.away || 'AWY');
    const home = _esc(sb.homeAbbr || sb.home || 'HOM');
    const aScore = Number.isFinite(sb.awayScore) ? sb.awayScore : 0;
    const hScore = Number.isFinite(sb.homeScore) ? sb.homeScore : 0;
    const aLead = aScore > hScore, hLead = hScore > aScore;

    let diamond = '';
    if (Array.isArray(sb.bases)) {
      const [b1, b2, b3] = sb.bases;
      diamond =
        `<svg class="tv-sb-diamond" viewBox="0 0 34 34" aria-hidden="true">` +
        `<rect class="tv-sb-base ${b2 ? 'on' : ''}" x="12" y="4"  width="10" height="10" transform="rotate(45 17 9)"/>` +
        `<rect class="tv-sb-base ${b3 ? 'on' : ''}" x="4"  y="12" width="10" height="10" transform="rotate(45 9 17)"/>` +
        `<rect class="tv-sb-base ${b1 ? 'on' : ''}" x="20" y="12" width="10" height="10" transform="rotate(45 25 17)"/>` +
        `</svg>`;
    }
    // Hockey's equivalent of the diamond: live strength. Only rendered while it's
    // actually true — the server omits `strength` at even strength, so the chip
    // appears exactly for the seconds a man is in the box or a net is empty.
    let strength = '';
    if (sb.strength) {
      const label = { pp: 'PP', sh: 'SH', en: 'EN' }[sb.strength] || String(sb.strength).toUpperCase();
      strength = `<div class="tv-sb-strength ${_esc(sb.strength)}">${_esc(label)}</div>`;
    }
    // Shots on goal — hockey's second scoreboard. A 1-0 game reads completely
    // differently at 9 shots than at 40, and this is where a viewer looks for it.
    let sog = '';
    if (sb.shotsAway != null || sb.shotsHome != null) {
      sog = `<div class="tv-sb-sog" aria-label="shots on goal">` +
        `<i>SOG</i><span>${sb.shotsAway | 0}</span><span>${sb.shotsHome | 0}</span></div>`;
    }
    let outs = '';
    if (sb.outs != null) {
      const o = Math.max(0, Math.min(3, sb.outs | 0));
      outs = `<div class="tv-sb-outs" aria-label="${o} out">` +
        [0, 1, 2].map(i => `<span class="tv-sb-out ${i < o ? 'on' : ''}"></span>`).join('') + `</div>`;
    }

    // A branded sport puts its mark on the persistent bug — the small always-on
    // identifier that tells a viewer joining mid-period what they've tuned into.
    const brand = sb.sport === 'hockey' ? `<div class="tv-sb-brand">${cphlMark('15px')}</div>` : '';
    // A rivalry stays flagged all night, not just at the face-off — someone joining in
    // the second period should be able to see why the penalty count looks like that.
    const rivalChip = sb.rivalry ? `<div class="tv-sb-rival" title="Rivalry night">RIVALRY</div>` : '';
    host.innerHTML =
      brand +
      `<div class="tv-sb-scores">` +
        `<div class="tv-sb-row ${aLead ? 'lead' : ''}"><span class="tv-sb-team">${away}</span><span class="tv-sb-num">${aScore}</span></div>` +
        `<div class="tv-sb-row ${hLead ? 'lead' : ''}"><span class="tv-sb-team">${home}</span><span class="tv-sb-num">${hScore}</span></div>` +
      `</div>` +
      `<div class="tv-sb-state">${diamond}${strength}${rivalChip}<div class="tv-sb-status">${_esc(sb.status || '')}</div>${outs}${sog}</div>`;
    host.classList.add('on');
    // A score-bug means a game is on air — that's when the standings button is worth
    // offering. Same reveal pattern as the Gameday toggle.
    el('standings-btn')?.classList.add('avail');
  }

  // A matte and a dip-to-black belong to the picture that raised them — a channel
  // change or a power-off must not leave the next station framed in black bars.
  function _clearFilmLayers() { _applyLetterbox(false); _applyFade('in', 0.2); }

  function _clearScorebug() {
    const host = el('scorebug');
    if (host) { host.innerHTML = ''; host.classList.remove('on'); }
  }

  // ── Gameday sub-screen ────────────────────────────────────────────────────
  // A new `gameday` overlay arrives per at-bat during a sports broadcast. First one
  // reveals the "Gameday" toggle button; the view only renders while the player has
  // it open (it covers the play-by-play), but we always cache the latest so opening
  // mid-game lands on the current play. The view is placement-agnostic (gameday.js),
  // which is what lets the tablet mount the identical sub-screen.
  // One sub-screen per sport, chosen by the payload's own `sport` and nothing else —
  // the two views share an interface precisely so this is the only line that knows
  // there's more than one. Switching sports (a hockey game following a ballgame on
  // the same channel) tears the old view down rather than feeding it a payload it
  // can't read.
  function _gamedayViewFor(gd, hostEl) {
    const want = gd && gd.sport === 'hockey' ? 'hockey' : 'baseball';
    if (_gamedayView && _gamedaySport === want) return _gamedayView;
    _gamedayView?.clear();
    _gamedaySport = want;
    _gamedayView = want === 'hockey' ? createRinkView(hostEl) : createGamedayView(hostEl);
    return _gamedayView;
  }

  function _handleGameday(gd) {
    _lastGameday = gd;
    const btn = el('gameday-btn');
    if (btn) btn.classList.add('avail');
    if (_gamedayOpen) _gamedayViewFor(gd, el('gameday')).apply(gd);
  }

  function _toggleGameday() {
    const host = el('gameday');
    const btn = el('gameday-btn');
    if (!host) return;
    _gamedayOpen = !_gamedayOpen;
    host.classList.toggle('on', _gamedayOpen);
    btn?.classList.toggle('on', _gamedayOpen);
    if (_gamedayOpen) {
      const view = _gamedayViewFor(_lastGameday, host);
      if (_lastGameday) view.apply(_lastGameday);
      else view.showIdle();   // opened before a play arrived — never blank
    }
  }

  // Drop the whole sub-screen — on a channel change or close, so a stale game never
  // lingers. Hides the toggle until the next sports broadcast reveals it again.
  function _clearGameday() {
    _gamedayOpen = false;
    _lastGameday = null;
    _gamedayView?.clear();
    _gamedayView = null; _gamedaySport = null;   // next sport mounts its own view
    el('gameday')?.classList.remove('on');
    el('gameday-btn')?.classList.remove('on', 'avail');
  }

  // ── TV guide sub-screen ───────────────────────────────────────────────────
  // A "what's on and when" panel for the tuned channel. Opening it asks the server
  // for the running order + current in-world time (tv_schedule); while it stays open
  // we re-request on a slow tick so the "on now" highlight and countdowns stay live.
  function _requestSchedule() {
    if (_tvActiveChannelId) sendRaw({ type: 'tv_schedule', channelId: _tvActiveChannelId });
  }

  function _toggleSchedule() {
    const host = el('schedule');
    const btn = el('schedule-btn');
    if (!host) return;
    _scheduleOpen = !_scheduleOpen;
    host.classList.toggle('on', _scheduleOpen);
    btn?.classList.toggle('on', _scheduleOpen);
    if (!_scheduleOpen) { _clearScheduleTimer(); return; }
    if (!_tvActiveChannelId) {
      host.innerHTML = '<div class="tv-sched-empty">The set is off — tune to a channel first.</div>';
      return;
    }
    host.innerHTML = '<div class="tv-sched-empty">Fetching schedule…</div>';
    _requestSchedule();
    if (_scheduleTimer) clearInterval(_scheduleTimer);
    _scheduleTimer = setInterval(_requestSchedule, 2000);
  }

  function _clearScheduleTimer() {
    if (_scheduleTimer) { clearInterval(_scheduleTimer); _scheduleTimer = null; }
  }

  // Drop the guide on channel change / close so a stale listing never lingers.
  function _clearSchedule() {
    _scheduleOpen = false;
    _clearScheduleTimer();
    const host = el('schedule');
    if (host) { host.classList.remove('on'); host.innerHTML = ''; }
    el('schedule-btn')?.classList.remove('on');
  }

  // ── Standings sub-screen ──────────────────────────────────────────────────
  // The league table already flashes up on air as a transient corner bug the server
  // throws on a throttle. This is the viewer pulling it up ON DEMAND and holding it —
  // its own overlay panel (same placement as the TV guide), so it never fights the
  // bug for the corner. Only offered while a game is actually on: the button is
  // revealed by the first score-bug of a sports broadcast and hidden on channel change.
  function _requestStandings() { sendRaw({ type: 'tv_standings' }); }

  function _toggleStandings() {
    const host = el('standings-panel');
    const btn = el('standings-btn');
    if (!host) return;
    _standingsPanelOpen = !_standingsPanelOpen;
    host.classList.toggle('on', _standingsPanelOpen);
    btn?.classList.toggle('on', _standingsPanelOpen);
    if (!_standingsPanelOpen) { _clearStandingsPanelTimer(); return; }
    host.innerHTML = '<div class="tv-sched-empty">Fetching standings…</div>';
    _requestStandings();
    if (_standingsPanelTimer) clearInterval(_standingsPanelTimer);
    _standingsPanelTimer = setInterval(_requestStandings, 5000);   // scores move mid-game
  }

  function _clearStandingsPanelTimer() {
    if (_standingsPanelTimer) { clearInterval(_standingsPanelTimer); _standingsPanelTimer = null; }
  }

  function _clearStandingsPanel() {
    _standingsPanelOpen = false;
    _clearStandingsPanelTimer();
    const host = el('standings-panel');
    if (host) { host.classList.remove('on'); host.innerHTML = ''; }
    el('standings-btn')?.classList.remove('on', 'avail');
  }

  function renderStandings(data) {
    if (!_standingsPanelOpen || !data) return;
    const host = el('standings-panel');
    if (!host) return;
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const body = rows.length
      ? rows.map((r, i) => {
          const rd = (r.rd > 0 ? '+' : '') + (Number.isFinite(r.rd) ? r.rd : 0);
          const pct = (r.wins + r.losses) ? (r.wins / (r.wins + r.losses)) : 0;
          return `<div class="tv-stp-row${i === 0 ? ' lead' : ''}">` +
            `<span class="tv-stp-rank">${i + 1}</span>` +
            `<span class="tv-stp-team">${_esc(r.team)}</span>` +
            `<span class="tv-stp-rec">${r.wins}-${r.losses}</span>` +
            `<span class="tv-stp-pct">${pct.toFixed(3).replace(/^0/, '')}</span>` +
            `<span class="tv-stp-rd">${rd}</span>` +
          `</div>`;
        }).join('')
      : '<div class="tv-sched-empty">No games played yet this season.</div>';
    host.innerHTML =
      `<div class="tv-sched-head"><span class="tv-sched-title">${_esc(data.title || 'STANDINGS')}</span></div>` +
      `<div class="tv-stp-row tv-stp-hdr"><span class="tv-stp-rank">#</span><span class="tv-stp-team">TEAM</span>` +
        `<span class="tv-stp-rec">W-L</span><span class="tv-stp-pct">PCT</span><span class="tv-stp-rd">RD</span></div>` +
      `<div class="tv-stp-list">${body}</div>` +
      `<div class="tv-sched-foot">${data.phase === 'worldseries' ? 'World Series — winner takes the season.' : 'Run differential over the season to date.'}</div>`;
  }

  function renderSchedule(data) {
    if (!_scheduleOpen || !data || data.channelId !== _tvActiveChannelId) return;
    const host = el('schedule');
    if (!host) return;
    const slots = Array.isArray(data.slots) ? data.slots : [];
    const daily = data.scheduleMode === 'daily';
    const fmtDur = (s) => !(s > 0) ? '' : (s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)}s`);
    const fmtIn = (s) => {
      if (!(s > 0)) return 'on now';
      const m = Math.floor(s / 60), ss = Math.round(s % 60);
      return m ? `in ${m}:${String(ss).padStart(2, '0')}` : `in ${ss}s`;
    };
    let rows;
    if (!slots.length) {
      rows = '<div class="tv-sched-empty">Nothing scheduled on this channel.</div>';
    } else {
      rows = slots.map(sl => {
        const when = sl.todLabel ? _esc(sl.todLabel) : (sl.onNow ? 'ON NOW' : fmtIn(sl.startsInSec));
        const dur = fmtDur(sl.durationSec);
        return `<div class="tv-sched-row${sl.onNow ? ' now' : ''}">` +
          `<span class="tv-sched-when">${when}</span>` +
          `<span class="tv-sched-name">${_esc(sl.name)}</span>` +
          `<span class="tv-sched-dur">${dur}</span>` +
        `</div>`;
      }).join('');
    }
    const title = _esc(data.stationName || 'Schedule') + (data.channelNumber ? ` · CH ${data.channelNumber}` : '');
    host.innerHTML =
      `<div class="tv-sched-head">` +
        `<span class="tv-sched-title">${title}</span>` +
        `<span class="tv-sched-clock">&#x1F552; ${_esc(data.nowLabel || '')}</span>` +
      `</div>` +
      `<div class="tv-sched-list">${rows}</div>` +
      `<div class="tv-sched-foot">${daily ? 'In-world local time.' : 'This channel runs on a loop.'}</div>`;
  }

  // Transient "standings bug" — the league table flashed up periodically during a
  // sports broadcast. Its own container (top-left) so it coexists with the persistent
  // score-bug, and it auto-dismisses on a timer (the server flashes it, doesn't hold it).
  function _applyStandingsBug(sb) {
    // While the Gameday sub-screen is open it carries its own persistent standings
    // dock (rides the gameday payload), so the full-screen flash would only collide.
    if (_gamedayOpen) return;
    const host = el('standings');
    if (!host) return;
    const rows = Array.isArray(sb.rows) ? sb.rows : [];
    if (!rows.length) return;
    // Hockey's last column is POINTS, not a differential — a table that ranks on points
    // but prints goal-difference beside it looks mis-sorted, because the eye reads the
    // last number as the reason for the order. The record carries the OT losses for the
    // same reason: they're where the points came from.
    const hockey = sb.sport === 'hockey';
    const body = rows.map((r, i) => {
      const tail = hockey
        ? String(r.points ?? 0)
        : (r.rd > 0 ? '+' : '') + (Number.isFinite(r.rd) ? r.rd : 0);
      const rec = hockey ? `${r.wins}-${r.losses}-${r.otl || 0}` : `${r.wins}-${r.losses}`;
      return `<div class="tv-st-row">` +
        `<span class="tv-st-rank">${i + 1}</span>` +
        `<span class="tv-st-team">${_esc(r.team)}</span>` +
        `<span class="tv-st-rec">${rec}</span>` +
        `<span class="tv-st-rd">${tail}</span>` +
      `</div>`;
    }).join('');
    host.innerHTML =
      `<div class="tv-st-title">${hockey ? cphlMark('14px') : ''}${_esc(sb.title || 'STANDINGS')}</div>${body}`;
    host.classList.add('on');
    // Reserve the bug's top-right corner in the text layer so the play-by-play wraps
    // around it instead of running underneath. Measure after layout, then flow the
    // shape into the message box and mark the content so the column runs block.
    requestAnimationFrame(() => {
      const content = el('content');
      if (!content || !host.classList.contains('on')) return;
      const cRect = content.getBoundingClientRect();
      const hRect = host.getBoundingClientRect();
      // Shape spans from the top of the message box down past the bug, plus a gap.
      const shapeW = Math.ceil(cRect.right - hRect.left) + 12;
      const shapeH = Math.ceil(hRect.bottom - cRect.top) + 10;
      content.style.setProperty('--tv-st-shape-w', `${Math.max(shapeW, 0)}px`);
      content.style.setProperty('--tv-st-shape-h', `${Math.max(shapeH, 0)}px`);
      content.classList.add('standings-on');
      _ensureStandingsShape();
    });
    if (_standingsTimer) clearTimeout(_standingsTimer);
    _standingsTimer = setTimeout(_clearStandings, (sb.duration || 9) * 1000);
  }

  // The float that reserves the bug's corner must be the first child of the message
  // box (a float only pushes content that follows it). appendMessage keeps it in front.
  function _ensureStandingsShape() {
    const content = el('content');
    if (!content || !content.classList.contains('standings-on')) return;
    const container = el('messages');
    if (!container) return;
    let shape = container.querySelector('.tv-standings-shape');
    if (!shape) {
      shape = document.createElement('div');
      shape.className = 'tv-standings-shape';
    }
    if (container.firstChild !== shape) container.insertBefore(shape, container.firstChild);
  }

  function _clearStandings() {
    if (_standingsTimer) { clearTimeout(_standingsTimer); _standingsTimer = null; }
    const host = el('standings');
    if (host) { host.innerHTML = ''; host.classList.remove('on'); }
    const content = el('content');
    if (content) {
      content.classList.remove('standings-on');
      content.style.removeProperty('--tv-st-shape-w');
      content.style.removeProperty('--tv-st-shape-h');
    }
    el('messages')?.querySelector('.tv-standings-shape')?.remove();
  }

  // Full-screen sports "graphics": the home-run trajectory call-out, the final-score
  // card, and the extra-innings hype card. Injected into the FX host (which sits above
  // the score/standings bugs) and auto-dismissed; the animations are pure CSS/SMIL so
  // they play the moment the markup lands. Server fires these on the matching line.
  function _applySportsFx(fx) {
    const host = el('fx');
    if (!host) return;
    let inner = '';
    if (fx.kind === 'homerun') {
      const sub = [fx.batter, fx.team].filter(Boolean).join(' · ');
      // The arc path id must be unique per surface, or two open TVs would both
      // animate against whichever <path> the document found first.
      const pathId = `tvHrPath_${key}`;
      inner =
        `<div class="tv-fx-hr">` +
          `<svg class="tv-fx-hr-svg" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
            `<path id="${pathId}" class="tv-fx-hr-arc" d="M 32 226 Q 210 -48 374 116" fill="none"/>` +
            `<circle class="tv-fx-hr-ball" r="6"><animateMotion dur="1.25s" fill="freeze" rotate="auto"><mpath href="#${pathId}"/></animateMotion></circle>` +
            `<circle class="tv-fx-hr-burst" cx="374" cy="116" r="4"/>` +
          `</svg>` +
          `<div class="tv-fx-hr-title${fx.grand ? ' grand' : ''}">${fx.grand ? 'GRAND SLAM' : 'HOME RUN'}</div>` +
          (sub ? `<div class="tv-fx-hr-sub">${_esc(sub)}</div>` : '') +
        `</div>`;
    } else if (fx.kind === 'gamewin') {
      inner =
        `<div class="tv-fx-final">` +
          `<div class="tv-fx-final-label">${fx.extras ? `FINAL · ${_esc(fx.inningOrd || '')}` : 'FINAL'}</div>` +
          `<div class="tv-fx-final-card">` +
            `<div class="tv-fx-final-row win"><span class="nm">${_esc(fx.winner)}</span><span class="sc">${fx.winScore}</span></div>` +
            `<div class="tv-fx-final-row"><span class="nm">${_esc(fx.loser)}</span><span class="sc">${fx.loseScore}</span></div>` +
          `</div>` +
          `<div class="tv-fx-final-tag">${_esc(fx.winner)} WIN</div>` +
        `</div>`;
    } else if (fx.kind === 'extras') {
      inner =
        `<div class="tv-fx-extras">` +
          `<div class="tv-fx-extras-big">EXTRA<span>INNINGS</span></div>` +
          `<div class="tv-fx-extras-sub">Free Baseball</div>` +
        `</div>`;
    } else if (fx.kind === 'walkoff') {
      const sub = [fx.batter, fx.team].filter(Boolean).join(' · ');
      const score = (fx.home != null) ? `${_esc(fx.home)} ${fx.homeScore} — ${fx.awayScore} ${_esc(fx.away)}` : '';
      inner =
        `<div class="tv-fx-walkoff">` +
          `<div class="tv-fx-wo-rays"></div>` +
          `<div class="tv-fx-wo-title">WALK-OFF!</div>` +
          (sub ? `<div class="tv-fx-wo-sub">${_esc(sub)}</div>` : '') +
          (score ? `<div class="tv-fx-wo-score">${score}</div>` : '') +
        `</div>`;
    } else if (fx.kind === 'matchup') {
      const rec = (r) => r && r !== '0-0' ? `<span class="rec">${_esc(r)}</span>` : '';
      // A branded show puts its lockup on the card; Deadball keeps the plain label it
      // has always had, so this stays additive rather than a restyle of the ballgame.
      inner =
        `<div class="tv-fx-matchup${fx.brand === 'cphl' ? ' cphl' : ''}">` +
          (fx.brand === 'cphl'
            ? cphlLockup('Tonight in the CPhL', '34px')
            : `<div class="tv-fx-mu-label">Tonight on ${_esc(fx.show || 'DEADBALL')}</div>`) +
          `<div class="tv-fx-mu-teams">` +
            `<div class="tv-fx-mu-team away"><span class="nm">${_esc(fx.away)}</span>${rec(fx.awayRecord)}</div>` +
            `<div class="tv-fx-mu-vs">vs</div>` +
            `<div class="tv-fx-mu-team home"><span class="nm">${_esc(fx.home)}</span>${rec(fx.homeRecord)}</div>` +
          `</div>` +
        `</div>`;
    // ── CPhL. Same contract as the baseball cards: markup only, animated by CSS,
    // auto-dismissed on fx.duration. The goal card leans on the strength the sim
    // already decided, so a shorthander announces itself without a special case.
    } else if (fx.kind === 'hockeygoal') {
      const tag = { pp: 'POWER PLAY', sh: 'SHORTHANDED', en: 'EMPTY NET' }[fx.strength] || '';
      const sub = [fx.shooter, fx.assist ? `assist ${fx.assist}` : '', fx.team].filter(Boolean).join(' · ');
      inner =
        `<div class="tv-fx-goal">` +
          `<div class="tv-fx-goal-lamp"></div>` +
          `<div class="tv-fx-brand">${cphlMark('26px')}</div>` +
          `<div class="tv-fx-goal-title${fx.hattrick ? ' hat' : ''}">${fx.hattrick ? 'HAT TRICK' : 'GOAL'}</div>` +
          (tag ? `<div class="tv-fx-goal-tag">${tag}</div>` : '') +
          (sub ? `<div class="tv-fx-goal-sub">${_esc(sub)}</div>` : '') +
          `<div class="tv-fx-goal-score">${_esc(fx.away)} ${fx.awayScore} — ${fx.homeScore} ${_esc(fx.home)}</div>` +
        `</div>`;
    } else if (fx.kind === 'hockeyfight') {
      inner =
        `<div class="tv-fx-fight">` +
          `<div class="tv-fx-brand">${cphlMark('26px')}</div>` +
          `<div class="tv-fx-fight-title">GLOVES OFF</div>` +
          `<div class="tv-fx-fight-names"><span class="win">${_esc(fx.winner)}</span><span class="vs">def.</span><span class="lose">${_esc(fx.loser)}</span></div>` +
          `<div class="tv-fx-fight-sub">Five for the loser · ${_esc(fx.team)} on the power play</div>` +
        `</div>`;
    } else if (fx.kind === 'hockeydeath') {
      // Sudden death, literally. Deliberately the quietest card on the channel —
      // no rays, no bounce; the league does not celebrate this, it just continues.
      inner =
        `<div class="tv-fx-death">` +
          `<div class="tv-fx-death-rule"></div>` +
          `<div class="tv-fx-death-title">SUDDEN DEATH</div>` +
          `<div class="tv-fx-death-name">${_esc(fx.player)}</div>` +
          (fx.winner ? `<div class="tv-fx-death-sub">${_esc(fx.winner)} advance</div>` : '') +
        `</div>`;
    } else if (fx.kind === 'hockeyrivalry') {
      // A grudge match gets its own pre-game card. Red where the ordinary matchup card
      // is cold blue, because the one thing a viewer needs to know is that tonight is
      // not an ordinary night — and the sim has genuinely made it a nastier game.
      const rec = (r) => r && r !== '0-0' && r !== '0-0-0' ? `<span class="rec">${_esc(r)}</span>` : '';
      inner =
        `<div class="tv-fx-matchup cphl rival">` +
          `<div class="tv-fx-brand">${cphlMark('26px')}</div>` +
          `<div class="tv-fx-rival-banner">RIVALRY NIGHT</div>` +
          `<div class="tv-fx-mu-teams">` +
            `<div class="tv-fx-mu-team away"><span class="nm">${_esc(fx.away)}</span>${rec(fx.awayRecord)}</div>` +
            `<div class="tv-fx-mu-vs">vs</div>` +
            `<div class="tv-fx-mu-team home"><span class="nm">${_esc(fx.home)}</span>${rec(fx.homeRecord)}</div>` +
          `</div>` +
          `<div class="tv-fx-rival-sub">No trophy. No records. They will bleed for it anyway.</div>` +
        `</div>`;
    } else if (fx.kind === 'hockeycup') {
      const rec = (r) => r && r !== '0-0' ? `<span class="rec">${_esc(r)}</span>` : '';
      inner =
        `<div class="tv-fx-ws tv-fx-cup">` +
          `<div class="tv-fx-brand big">${cphlMark('40px')}</div>` +
          `<div class="tv-fx-ws-banner">COLDWATER CUP</div>` +
          `<div class="tv-fx-ws-sub">One Game. One Trophy. No Records.</div>` +
          `<div class="tv-fx-mu-teams">` +
            `<div class="tv-fx-mu-team away"><span class="nm">${_esc(fx.away)}</span>${rec(fx.awayRecord)}</div>` +
            `<div class="tv-fx-mu-vs">vs</div>` +
            `<div class="tv-fx-mu-team home"><span class="nm">${_esc(fx.home)}</span>${rec(fx.homeRecord)}</div>` +
          `</div>` +
        `</div>`;
    } else if (fx.kind === 'doubleplay') {
      inner =
        `<div class="tv-fx-dp">` +
          `<div class="tv-fx-dp-title">DOUBLE PLAY</div>` +
          `<div class="tv-fx-dp-sub">Two down</div>` +
        `</div>`;
    } else if (fx.kind === 'worldseries') {
      const rec = (r) => r && r !== '0-0' ? `<span class="rec">${_esc(r)}</span>` : '';
      inner =
        `<div class="tv-fx-ws">` +
          `<div class="tv-fx-ws-banner">WORLD SERIES</div>` +
          `<div class="tv-fx-ws-sub">Winner Takes the Season</div>` +
          `<div class="tv-fx-mu-teams">` +
            `<div class="tv-fx-mu-team away"><span class="nm">${_esc(fx.away)}</span>${rec(fx.awayRecord)}</div>` +
            `<div class="tv-fx-mu-vs">vs</div>` +
            `<div class="tv-fx-mu-team home"><span class="nm">${_esc(fx.home)}</span>${rec(fx.homeRecord)}</div>` +
          `</div>` +
        `</div>`;
    } else if (fx.kind === 'champion') {
      inner =
        `<div class="tv-fx-champ">` +
          `<div class="tv-fx-champ-rays"></div>` +
          `<div class="tv-fx-champ-trophy">🏆</div>` +
          `<div class="tv-fx-champ-team">${_esc(fx.winner)}</div>` +
          `<div class="tv-fx-champ-label">${_esc(fx.label || 'World Series Champions')}</div>` +
          `<div class="tv-fx-champ-score">${_esc(fx.winner)} ${fx.winScore} — ${fx.loseScore} ${_esc(fx.loser)}</div>` +
        `</div>`;
    } else return;
    host.innerHTML = inner;
    host.className = `tv-fx-host on fx-${fx.kind}`;
    if (_fxTimer) clearTimeout(_fxTimer);
    _fxTimer = setTimeout(_clearSportsFx, (fx.duration || 3.5) * 1000);
  }

  function _clearSportsFx() {
    if (_fxTimer) { clearTimeout(_fxTimer); _fxTimer = null; }
    const host = el('fx');
    if (host) { host.innerHTML = ''; host.className = 'tv-fx-host'; }
  }

  // ── tuning ────────────────────────────────────────────────────────────────
  function _tvTuneTo(num) {
    // A tune abandons the old channel's timeline outright — anything still queued
    // belongs to a programme you are no longer watching.
    window.AudioEngine?.cancelSpeech(); _clearSpeech();
    _speechOwner = view;   // the surface being tuned takes the voice
    if (_sweepRaf) { cancelAnimationFrame(_sweepRaf); _sweepRaf = null; }
    _wheelTarget = null;
    _tvFrequency = num;
    _dialRaw = num;
    _updateKnobRotation();
    sendCmdSilent(`${tuneCmd} ${num}`);
  }

  // Step to the next/previous channel in the list, wrapping at either end.
  //
  // The two chassis tune differently on purpose. The CRT set is an ANALOGUE dial:
  // it sweeps from where it is toward the target, passing through the static in
  // between (same lock logic as turning the knob by hand) — the +/- buttons exist
  // for touch/no-wheel input but must read identically to a slow turn. The tablet
  // is a DIGITAL tuner: CH up/down snaps straight to the channel, no scanning.
  function _stepChannel(direction) {
    if (!_tvChannelList.length) return;
    let target;
    if (direction > 0) {
      const next = _tvChannelList.find(c => c.number > _tvFrequency + 0.001);
      target = next ? next.number : _tvChannelList[0].number;
    } else {
      const prior = [..._tvChannelList].reverse().find(c => c.number < _tvFrequency - 0.001);
      target = prior ? prior.number : _tvChannelList[_tvChannelList.length - 1].number;
    }
    if (!isCrt) { _tvTuneTo(target); return; }
    _sweepDialTo(target, direction);
  }

  function _sweepDialTo(targetNumber, direction) {
    if (_sweepRaf) cancelAnimationFrame(_sweepRaf);

    const start = _dialRaw;
    // Unwrap the target so the sweep moves monotonically in the requested direction
    // instead of jumping backward across the wrap point.
    let unwrappedTarget = targetNumber;
    if (direction > 0 && unwrappedTarget <= start) unwrappedTarget += TV_DIAL_MAX;
    if (direction < 0 && unwrappedTarget >= start) unwrappedTarget -= TV_DIAL_MAX;

    const distance = Math.abs(unwrappedTarget - start);
    const duration = Math.max(distance / DIAL_SWEEP_SPEED, 0.15) * 1000;
    const startTime = performance.now();

    function tick(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const raw = start + (unwrappedTarget - start) * t;
      _dialRaw = ((raw % TV_DIAL_MAX) + TV_DIAL_MAX) % TV_DIAL_MAX;
      tunerInput(Math.round(_dialRaw * 20) / 20);
      if (t < 1) {
        _sweepRaf = requestAnimationFrame(tick);
      } else {
        _sweepRaf = null;
        _wheelTarget = null;
      }
    }
    _sweepRaf = requestAnimationFrame(tick);
  }

  function _updateKnobRotation() {
    const rotation = (_tvFrequency / TV_DIAL_MAX) * 360;
    const knobEl = el('knob');
    if (knobEl) knobEl.style.transform = `rotate(${rotation}deg)`;
  }

  function tunerInput(val) {
    _tvFrequency = parseFloat(val);
    const freqDisplay = el('freq-display');
    if (freqDisplay) freqDisplay.textContent = _tvFrequency.toFixed(2);
    _updateKnobRotation();

    if (!_tvChannelList.length) return;

    const nearest = _tvChannelList.reduce((a, b) =>
      Math.abs(b.number - _tvFrequency) < Math.abs(a.number - _tvFrequency) ? b : a);
    const dist = Math.abs(nearest.number - _tvFrequency);

    const staticEl      = el('static');
    const contentEl     = el('content');
    const programNameEl = el('program-name');

    // Progressive fade: static fills as you move away, content fades in as you approach
    const staticOpacity  = Math.min(1, dist / LOCK_RANGE);
    const contentOpacity = 1 - staticOpacity;
    _setStaticAudio(staticOpacity);

    if (staticEl) {
      staticEl.style.opacity = staticOpacity.toFixed(2);
      if (staticOpacity > 0) staticEl.classList.add('tv-static-on');
      else staticEl.classList.remove('tv-static-on');
    }
    if (contentEl) {
      contentEl.classList.remove('tv-hidden');
      contentEl.style.opacity = contentOpacity.toFixed(2);
    }
    // Program name fades in from invisible as you approach the channel frequency
    if (programNameEl) programNameEl.style.opacity = contentOpacity.toFixed(2);
    // Channel number only visible when exactly on an active channel
    setAll('channel-num', (dist < 0.01) ? `CH ${nearest.number}` : '——');

    if (dist < LOCK_RANGE && nearest.channelId !== _tvActiveChannelId) {
      _tvTuneTo(nearest.number);
    }
  }

  // ── on/off air ────────────────────────────────────────────────────────────
  function showOffAir(offlineGraphicContent, offlineGraphicType) {
    const staticEl = el('static');
    const content  = el('content');
    if (!staticEl || !content) return;
    _tvOffAir = true;
    _clearScorebug();
    _clearStandings();
    _clearSportsFx();
    if (offlineGraphicContent && !_tuneTimer) {
      staticEl.classList.remove('tv-static-on', 'tv-static-loop');
      staticEl.style.opacity = '';
      content.classList.remove('tv-hidden');
      appendMessage(offlineGraphicContent, offlineGraphicType === 'svg' ? 'svg' : 'ascii_art');
      _setStaticAudio(0, 0.3);
    } else {
      content.classList.add('tv-hidden');
      staticEl.classList.remove('tv-static-fade');
      staticEl.classList.add('tv-static-on', 'tv-static-loop');
      staticEl.style.opacity = '';
      _setStaticAudio(1);
    }
  }

  function showOnAir() {
    if (!_tvOffAir) return;
    _tvOffAir = false;
    const staticEl = el('static');
    const content  = el('content');
    if (!staticEl || !content) return;
    staticEl.classList.remove('tv-static-on', 'tv-static-loop');
    staticEl.classList.add('tv-static-fade');
    staticEl.addEventListener('animationend', () => {
      staticEl.classList.remove('tv-static-fade');
      staticEl.style.opacity = '';   // see the power-on reveal: inline opacity outranks the resting style
    }, { once: true });
    content.classList.remove('tv-hidden');
    content.style.opacity = '';      // a dial sweep leaves a partial inline fade behind
    _setStaticAudio(0, 0.3);
  }

  function _clearTvMessages() {
    const container = el('messages');
    if (container) container.innerHTML = '';
    _tvHistory.length = 0;
  }

  // ── content ───────────────────────────────────────────────────────────────
  function appendMessage(text, style, duration, hasGameday) {
    const container = el('messages');
    if (!container) return;

    const isTitleCard = style === 'svg' || style === 'ascii_art' || style === 'credits';

    // Anything that isn't dialogue is a scene beat — a card, a ticker, an overlay.
    // That's the picture changing, so it's where drift would become visible and the
    // only place the speech queue is allowed to resync. See _sceneBeat().
    const spoken = !style || style === 'raw' || style === 'emote' || style === 'narrate' || style === 'system';
    if (!spoken) _sceneBeat();

    // Clear before title cards, and after them on the next message
    if (isTitleCard || _clearAfterTitleCard) {
      _clearTvMessages();
      _clearAfterTitleCard = false;
    } else {
      // The content box has overflow:hidden — if content height exceeds it, clear and restart
      const tvContent = el('content');
      if (tvContent && tvContent.clientHeight > 0 && container.offsetHeight >= tvContent.clientHeight) {
        // Keep the last line so the display doesn't hard-cut mid-thought
        const lastEl = _tvHistory.length ? _tvHistory[_tvHistory.length - 1].cloneNode(true) : null;
        _clearTvMessages();
        _ensureStandingsShape();
        if (lastEl) { container.appendChild(lastEl); _tvHistory.push(lastEl); }
      }
    }

    // Flag that the next non-title message should clear the screen
    if (isTitleCard) _clearAfterTitleCard = true;

    if (style === 'credits') {
      const content = el('content');
      const wrap = document.createElement('div');
      wrap.className = 'tv-credits-wrap';
      const inner = document.createElement('div');
      inner.className = 'tv-credits-inner';
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
          const b = document.createElement('div');
          b.className = 'credits-blank';
          inner.appendChild(b);
          continue;
        }
        // ALL-CAPS short lines become section headers
        const isHeader = trimmed === trimmed.toUpperCase() && trimmed.length < 50 && /[A-Z]/.test(trimmed);
        const p = document.createElement('p');
        p.className = isHeader ? 'credits-header' : 'credits-line';
        p.textContent = trimmed;
        inner.appendChild(p);
      }
      wrap.appendChild(inner);
      container.appendChild(wrap);
      requestAnimationFrame(() => {
        const contentH = content ? content.clientHeight : 0;
        const innerH = inner.scrollHeight;
        inner.style.transform = `translateY(${contentH}px)`;
        inner.offsetHeight;
        // CREDITS <seconds> from the script overrides the crawl duration; otherwise
        // fall back to a constant 50px/sec pace based on content height.
        const crawlSecs = duration != null ? duration : (contentH + innerH) / 50;
        inner.style.transition = `transform ${crawlSecs.toFixed(1)}s linear`;
        inner.style.transform = `translateY(${-innerH}px)`;
      });
      _tvHistory.push(wrap);
      if (_tvHistory.length > MAX_TV_HISTORY) _tvHistory.shift().remove();
      return;
    }

    const node = document.createElement(style === 'ascii_art' ? 'pre' : 'div');
    node.className = `tv-msg tv-msg-${style || 'raw'}`;
    if (style === 'svg') {
      try {
        node.innerHTML = text;
        const svg = node.querySelector('svg');
        if (!svg) throw new Error('no <svg> root element');
        if (!svg.getAttribute('viewBox')) {
          const w = parseFloat(svg.getAttribute('width')) || 640;
          const h = parseFloat(svg.getAttribute('height')) || 360;
          svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        // FILL the picture. Width 100% scales the card up to the full screen — pinning it
        // to the viewBox's natural px width left anything authored narrower than the
        // viewport sitting small in the middle of the frame. The measured max-height then
        // caps a TALL card to the picture box so it letterboxes inside the screen instead
        // of overflowing and having its bottom clipped by the content box's overflow:hidden.
        // viewBox + the default preserveAspectRatio keep it undistorted either way.
        svg.style.width = '100%';
        svg.style.maxWidth = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';
        svg.style.margin = '0 auto';
        requestAnimationFrame(() => {
          const content = el('content');
          if (!content || !content.clientHeight) return;
          const cs = getComputedStyle(content);
          const availH = content.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
          if (availH > 24) svg.style.maxHeight = `${Math.round(availH)}px`;
        });
      } catch (err) {
        // A malformed graphic must never break the broadcast — drop this card and
        // let the show carry on with the next message.
        console.warn('[tv] title-card graphic failed to render, skipping card:', err?.message || err);
        return;
      }
    } else if (style === 'ascii_art') {
      node.innerHTML = renderMarkup(text);
      // Scale font-size so the widest line fills the content area. Strip markup tags
      // before measuring so tag syntax doesn't inflate line lengths.
      requestAnimationFrame(() => {
        const content = el('content');
        if (!content) return;
        const plain = text.replace(/\[[^\]]*\]/g, '');
        const lines = plain.split('\n');
        const maxLen = Math.max(...lines.map(l => l.length), 1);
        // Fit BOTH ways: the widest line has to fit ACROSS the screen, and the whole
        // block has to fit DOWN it. Width-only fitting let tall art run past the bottom
        // of the picture, where overflow:hidden simply cut it off.
        const cs = getComputedStyle(content);
        const availPx = content.clientWidth - 36;
        const availH = content.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
        const byWidth = availPx / (maxLen * 0.6);
        const byHeight = availH / (lines.length * 1.3);   // 1.3 = the ascii line-height
        const finalPx = Math.max(Math.min(byWidth, byHeight, 18), 7);
        node.style.fontSize = `${finalPx.toFixed(1)}px`;
      });
    } else {
      node.innerHTML = _tvColorizeNpcSay(renderMarkup(text));
      // While the Gameday view is open it owns Chip's caption AND his voice, so the
      // two start together. A play-by-play line (hasGameday) is held until the ball
      // lands; a between-play line shows and speaks the moment it airs. The speak
      // thunk carries the raw text (with the "Name says" prefix) so the voice still
      // seeds off the narrator.
      if (_gamedayOpen && _gamedayView) {
        const plain = String(text).replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
        if (plain) _gamedayView.setCaption(plain, { speak: () => _speakNow(text, style, duration), held: !!hasGameday });
      }
    }
    container.appendChild(node);

    // Blank spacer between messages
    const spacer = document.createElement('div');
    spacer.style.height = '0.75em';
    container.appendChild(spacer);

    _tvHistory.push(node, spacer);
    if (_tvHistory.length > MAX_TV_HISTORY * 2) {
      _tvHistory.splice(0, 2).forEach(n => n.remove());
    }

    // Post-append guard: the message just added (now possibly re-wrapped narrower
    // around the standings bug) must not spill past the bottom of the box and get
    // clipped. If it does, roll to a fresh screen with this message alone at the top.
    const tvContent = el('content');
    if (tvContent && tvContent.clientHeight > 0 &&
        container.offsetHeight > tvContent.clientHeight &&
        _tvHistory.length > 2) {
      _clearTvMessages();
      _ensureStandingsShape();
      container.appendChild(node);
      container.appendChild(spacer);
      _tvHistory.push(node, spacer);
    }
  }

  function updateTicker(text) {
    // Strip the >> << wrapper the broadcast runtime adds
    const clean = text.replace(/^>> /, '').replace(/ <<$/, '').trim();
    if (!clean) return;

    _tickerText = _tickerText ? `${_tickerText}   ●   ${clean}` : clean;

    if (!_tickerAnimating) _startTickerAnimation();
  }

  function _startTickerAnimation() {
    const inner = el('ticker-inner');
    const track = el('ticker-track');
    if (!inner || !track || !_tickerText) return;

    _tickerAnimating = true;
    inner.style.transition = 'none';
    inner.style.transform  = '';
    inner.textContent = `${_tickerText}   `;
    inner.offsetHeight; // reflow to measure scrollWidth

    const trackW = track.offsetWidth;
    const textW  = inner.scrollWidth;
    const dur    = (trackW + textW) / 80; // 80 px/s constant reading speed

    inner.style.transform = `translateX(${trackW}px)`;
    inner.offsetHeight;
    inner.style.transition = `transform ${dur}s linear`;
    inner.style.transform  = `translateX(${-textW}px)`;

    inner.addEventListener('transitionend', () => {
      _tickerText = '';
      _tickerAnimating = false;
      inner.style.transition = 'none';
      inner.style.transform  = '';
      inner.textContent = '';
    }, { once: true });
  }

  function setProgramName(name) {
    const pn = el('program-name');
    if (pn) pn.textContent = name || '';
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  function init() {
    if (_inited) return;
    _inited = true;

    // Power button: a quick TAP just closes your view — the set keeps playing in the
    // room, so anyone else there still sees/hears it (ambient continues). Press and
    // HOLD to actually switch the set off: that stops the broadcast for the whole
    // room and announces it. See tv.poweroff server-side. The tablet has no physical
    // set to switch off, so there it's a plain close.
    const powerBtn = el('close-btn');
    const HOLD_MS = 450;
    let _powerHoldTimer = null, _powerHeld = false;
    const clearHold = () => { if (_powerHoldTimer) { clearTimeout(_powerHoldTimer); _powerHoldTimer = null; } };
    if (powerBtn) {
      powerBtn.addEventListener('pointerdown', (e) => {
        if (!_tvOpen) return;
        e.preventDefault();
        _powerHeld = false;
        clearHold();
        if (!isCrt) return;   // tablet: no room-wide power-off
        _powerHoldTimer = setTimeout(() => {
          _powerHeld = true; _powerHoldTimer = null;
          sendRaw({ type: 'tv_poweroff' });   // switch the whole set off, room-wide
          shutdown();                          // CRT collapse + local close
        }, HOLD_MS);
      });
      powerBtn.addEventListener('pointerup', (e) => {
        e.preventDefault();
        clearHold();
        if (_powerHeld) { _powerHeld = false; return; }   // the hold already switched it off
        if (_tvOpen) close();                              // quick tap: close the view, set stays on
      });
      powerBtn.addEventListener('pointerleave', clearHold);      // dragged off → cancel the hold
      powerBtn.addEventListener('pointercancel', () => { clearHold(); _powerHeld = false; });
    }

    // Read-aloud toggle: synthesize the broadcast's spoken lines with a procedural
    // formant voice. Preference persists across sessions and is shared by every
    // surface. Turning it off cuts any line currently being read.
    const readBtn = el('read-btn');
    const syncReadBtn = () => readBtn?.classList.toggle('on', _readAloud);
    syncReadBtn();
    readBtn?.addEventListener('click', () => {
      _readAloud = !_readAloud;
      localStorage.setItem('tvReadAloud', _readAloud ? '1' : '0');
      syncReadBtn();
      if (!_readAloud) { window.AudioEngine?.cancelSpeech(); _clearSpeech(); }
    });

    // Gameday toggle: reveals the animated at-bat sub-screen. Hidden until a sports
    // broadcast sends its first `gameday` overlay (which adds `.avail`).
    el('gameday-btn')?.addEventListener('click', () => { if (_tvOpen) _toggleGameday(); });

    // TV guide toggle: shows the tuned channel's running order + in-world time.
    el('schedule-btn')?.addEventListener('click', () => { if (_tvOpen) _toggleSchedule(); });

    // Standings toggle: the DEADBALL league table, on demand. Hidden until a sports
    // broadcast's first score-bug reveals it (adds `.avail`).
    el('standings-btn')?.addEventListener('click', () => { if (_tvOpen) _toggleStandings(); });

    // Knob: click cycles channels, mousewheel fine-tunes. Drag-to-rotate is disabled
    // — it was unreliable to control smoothly.
    const knob = el('knob');

    knob?.addEventListener('click', () => {
      if (!_tvOpen || navigator.maxTouchPoints > 0) return;
      if (_sweepRaf) { cancelAnimationFrame(_sweepRaf); _sweepRaf = null; }
      if (_tvChannelList.length) {
        const idx = _tvChannelList.findIndex(c => c.channelId === _tvActiveChannelId);
        const next = _tvChannelList[(idx + 1) % _tvChannelList.length];
        if (next) {
          _tvFrequency = next.number;
          _dialRaw = next.number;
          _tvTuneTo(next.number);
          return;
        }
      }
      _playTuneAnimation();
    });

    // Mousewheel on knob — sweep 0.25 per tick in 0.05 steps
    knob?.addEventListener('wheel', (e) => {
      if (!_tvOpen) return;
      e.preventDefault();
      const delta = -Math.sign(e.deltaY) * 0.25;
      const base = _wheelTarget !== null ? _wheelTarget : _dialRaw;
      _wheelTarget = Math.round(((base + delta + TV_DIAL_MAX) % TV_DIAL_MAX) * 20) / 20;
      _sweepDialTo(_wheelTarget, Math.sign(delta));
    }, { passive: false });

    // +/- buttons: smoothly sweep toward the next/previous channel rather than
    // snapping, so touch/no-wheel users still see the static pass between channels
    // the same way a wheel scrub or drag would show it.
    el('tune-down')?.addEventListener('click', () => { if (_tvOpen) _stepChannel(-1); });
    el('tune-up')?.addEventListener('click',   () => { if (_tvOpen) _stepChannel(1); });

    // The rest is CRT-chassis only — the tablet shell owns its own window
    // management, ESC handling and disconnect behaviour.
    if (!isCrt) return;

    window.addEventListener('game-disconnect', () => { if (_tvOpen) shutdown(); });

    // Draggable TV window
    const header = el('header');
    const win = el('window');
    let _dragWin = false;
    let _dragWinX = 0, _dragWinY = 0;

    header?.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-tv="close-btn"]')) return;
      _dragWin = true;
      const rect = win.getBoundingClientRect();
      _dragWinX = e.clientX - rect.left;
      _dragWinY = e.clientY - rect.top;
      win.style.position = 'fixed';
      win.style.margin = '0';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!_dragWin) return;
      win.style.left = `${e.clientX - _dragWinX}px`;
      win.style.top  = `${e.clientY - _dragWinY}px`;
    });
    document.addEventListener('mouseup', () => { _dragWin = false; });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _tvOpen) shutdown();
    });
  }

  // Tear the surface down without the close ceremony — used when the host element
  // is about to be removed from the DOM (the tablet re-rendering or closing).
  function destroy() {
    if (_tvOpen) close();
    _views.delete(view);
  }

  const view = {
    open, close, shutdown, init, destroy,
    applyOverlay, appendMessage, updateTicker, showOffAir, showOnAir,
    renderSchedule, renderStandings, speak, applyTheme, tunerInput, setProgramName,
    clearMessages: _clearTvMessages,
    isOpen: () => _tvOpen,
    activeChannelId: () => _tvActiveChannelId,
  };
  _views.add(view);
  return view;
}

// Every open surface currently tuned to `channelId`. dispatch.js fans each server
// broadcast/overlay out through this, so the wall set and the tablet can be tuned
// to different channels at the same time and each renders only its own.
export function tvViewsForChannel(channelId) {
  const out = [];
  for (const v of _views) {
    if (v.isOpen() && v.activeChannelId() === channelId) out.push(v);
  }
  return out;
}

export function tvOpenViews() {
  const out = [];
  for (const v of _views) if (v.isOpen()) out.push(v);
  return out;
}

// ── Default instance — the standalone CRT popup (#tv-panel) ─────────────────
// Preserves the historical module API so dispatch.js and the app bootstrap need
// no knowledge of the factory.
let _panel = null;
function panel() {
  if (!_panel) {
    const root = document.getElementById('tv-panel');
    if (!root) return null;
    _panel = createTvView(root, { key: 'panel', chassis: 'crt' });
  }
  return _panel;
}

export function openTvPanel(data)            { panel()?.open(data); }
export function closeTvPanel()               { panel()?.close(); }
export function shutdownTvPanel()            { panel()?.shutdown(); }
export function applyTvOverlay(overlay)      { panel()?.applyOverlay(overlay); }
export function appendTvMessage(t, s, d, g)  { panel()?.appendMessage(t, s, d, g); }
export function updateTvTicker(text)         { panel()?.updateTicker(text); }
export function showTvOffAir(content, type)  { panel()?.showOffAir(content, type); }
export function showTvOnAir()                { panel()?.showOnAir(); }
export function renderTvSchedule(data)       { panel()?.renderSchedule(data); }
export function tvSpeak(text, style, win)    { panel()?.speak(text, style, win); }
export function applyTvTheme(theme)          { panel()?.applyTheme(theme); }
export function tvTunerInput(val)            { panel()?.tunerInput(val); }
export function clearTvMessages()            { panel()?.clearMessages(); }
export function isTvOpen()                   { return !!panel()?.isOpen(); }
export function getTvActiveChannelId()       { return panel()?.activeChannelId() ?? null; }
export function initTvPanel()                { panel()?.init(); }
