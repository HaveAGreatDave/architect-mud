// Television popup panel — receives live broadcast push via the existing WS tick.
// Opened by 'watch tv' / 'tv' commands; closed by ESC or the close button.

import { sendCmdSilent, sendRaw } from '../net.js';
import { renderMarkup } from '../markup.js';
import { createGamedayView } from './gameday.js';

// Render an NPC say line in screenplay style: the speaker's name (in the TV
// accent color) on its own line, their speech directly beneath it — no gap.
// Runs on already-rendered (HTML-safe) markup, so the <span>/<br> we add here
// survive instead of being escaped into visible tags. Matches "Name says, "…"".
function _tvColorizeNpcSay(html) {
  return html.replace(/^(.+?) says, "([\s\S]*)"$/, (_, name, speech) =>
    `<span class="tv-speaker" style="color:var(--tv-header-color,var(--accent))">${name}:</span><br>"${speech}"`
  );
}

// Read a spoken broadcast line with the procedural formant voice. Only speaks
// actual dialogue/narration (style 'raw') — tickers, title cards, overlays and
// score-bugs travel on other styles/wire-types and stay silent. The narrator's
// name (the "Name says" prefix) is dropped from what's spoken but used to SEED
// the voice, so each host sounds consistent; narration with no speaker falls back
// to the station name as the seed.
let _lastSpeakAt = 0;
let _speakWindow = 5;   // fallback: estimated seconds between spoken lines
export function tvSpeak(rawText, style, windowSec) {
  if (!_readAloud || !rawText) return;
  if (style && style !== 'raw' && style !== 'emote' && style !== 'narrate' && style !== 'system') return;
  const strip = s => s.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();  // drop markup/bug tags
  let seed, speech;
  const m = /^(.+?) says, "([\s\S]*)"$/.exec(rawText);
  if (m) { seed = strip(m[1]); speech = strip(m[2]); }
  else { seed = (document.getElementById('tv-station-name')?.textContent || 'broadcast').trim(); speech = strip(rawText); }
  if (!speech) return;
  // Track inter-line gaps as a fallback window (for broadcasts that don't send one).
  const now = performance.now();
  const gap = (now - _lastSpeakAt) / 1000;
  if (_lastSpeakAt && gap > 1 && gap < 30) _speakWindow = _speakWindow * 0.5 + gap * 0.5;
  _lastSpeakAt = now;
  // Prefer the server's per-line window (the text-scaled hold), which is sized so the
  // voice reads at its natural pace without compressing. Fall back to the measured gap.
  const budget = windowSec > 0.5 ? windowSec : _speakWindow;
  window.AudioEngine?.speak(speech, { seed, budget });
}

let _tvOpen = false;
let _readAloud = localStorage.getItem('tvReadAloud') === '1';
let _tvShuttingDown = false;
let _tvPoweredOff = false;
let _tvActiveChannelId = null;
let _tvOffAir = false;
const _tvHistory = [];
const MAX_TV_HISTORY = 200;
let _clearAfterTitleCard = false;
let _tickerText = '';
let _tickerAnimating = false;
let _overlayTimer = null;
let _tuneTimer = null;
// Gameday sub-screen: the animated at-bat view. The view is created lazily (needs
// its host in the DOM), `_gamedayOpen` is the player's toggle, `_lastGameday` is the
// most recent payload so opening mid-at-bat lands on the current play.
let _gamedayView = null;
let _gamedayOpen = false;
let _lastGameday = null;
let _tvChannelList = [];   // [{ number, name, channelId }] sorted by number
let _tvFrequency   = 0;    // current dial position (float), quantized to 0.05 steps for display/lock
let _dialRaw       = 0;    // unquantized accumulator driving drag math, avoids feedback-loop stepping
const LOCK_RANGE   = 0.25; // within this many channel-numbers = lock in
const TV_DIAL_MAX  = 9.05; // dial wraps 0.0 → 9.0 → 0.0 (9.0 + 0.05 step = wrap)
let _sweepRaf       = null;
let _wheelTarget    = null;
const DIAL_SWEEP_SPEED = 4; // frequency-units per second — controls how long static shows between channels

// CRT hum/static are per-viewer loops; power-on/off are one-shot SFX.
// Local ids are fixed so AudioEngine can track the loops by id regardless of
// what config the server supplies. Configs are replaced at open time if the
// server sends registered defs (from audio_ambient / audio_sfx in the DB).
// Gains kept deliberately low so hum/static sit as gentle background texture,
// not foreground noise (they're still scaled by the TV-audio bus on top of this).
const TV_HUM_DEF     = { id: 'tv_hum_local',     category: 'tv', priority: 1, loop: true, config: { waveform: 'sine',     freq: 60,  gain: 0.02, noiseMix: 0.15, filter: { type: 'lowpass',  freq: 400,  q: 0.7 }, adsr: { a: 0.5,   d: 0.1,  s: 1,   r: 0.5  } } };
const TV_STATIC_DEF  = { id: 'tv_static_local',  category: 'tv', priority: 1, loop: true, config: { waveform: 'noise',    noiseMix: 1, gain: 0.03, filter: { type: 'highpass', freq: 700,  q: 0.5 }, tremolo: { rate: 35, depth: 0.6 }, adsr: { a: 0.02,  d: 0.02, s: 1,   r: 0.3  } } };
const TV_POWER_ON_DEF  = { id: 'tv_power_on_local',  category: 'tv', priority: 3, config: { waveform: 'triangle', freq: 80,  duration: 0.35, noiseMix: 0.3, pitchBend: { to: 600, time: 0.25 }, filter: { type: 'lowpass', freq: 3000, q: 1 }, adsr: { a: 0.005, d: 0.15, s: 0.3, r: 0.15 } } };
const TV_POWER_OFF_DEF = { id: 'tv_power_off_local', category: 'tv', priority: 3, config: { waveform: 'triangle', freq: 900, duration: 0.3,  noiseMix: 0.2, pitchBend: { to: 40,  time: 0.25 }, filter: { type: 'lowpass', freq: 4000, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0.2, r: 0.2  } } };

// Active defs — replaced with server-supplied configs on panel open.
let _humDef     = TV_HUM_DEF;
let _staticDef  = TV_STATIC_DEF;
let _powerOnDef = TV_POWER_ON_DEF;
let _powerOffDef = TV_POWER_OFF_DEF;

function _setStaticAudio(fraction, rampSeconds) {
  window.AudioEngine?.setLoopGain(_staticDef.id, fraction, rampSeconds);
}

export function openTvPanel(data) {
  const wasAlreadyOn = _tvOpen;
  // The server echoes a tv_panel message back after every player-initiated tune
  // (to push updated station/channel metadata). If the panel is already open,
  // this is just that echo, not a fresh power-on — so sync metadata only and
  // leave the dial position / power animation alone. Re-running the full reset
  // here was snapping the knob back to 0 mid-drag and replaying the power-on
  // static, which made the dial feel like it was fighting the player.
  const isTuneEcho = wasAlreadyOn;

  if (data.sounds) {
    // Adopt any server/DB-supplied configs, but cap the idle hum/static gain to a
    // gentle background level so they can never come back as foreground noise.
    if (data.sounds.hum)     _humDef     = { ...TV_HUM_DEF,      config: { ...data.sounds.hum.config,    gain: Math.min(data.sounds.hum.config?.gain    ?? 0.02, 0.02) } };
    if (data.sounds.static)  _staticDef  = { ...TV_STATIC_DEF,   config: { ...data.sounds.static.config, gain: Math.min(data.sounds.static.config?.gain ?? 0.03, 0.03) } };
    if (data.sounds.powerOn) _powerOnDef = { ...TV_POWER_ON_DEF, config: data.sounds.powerOn.config };
    if (data.sounds.powerOff)_powerOffDef= { ...TV_POWER_OFF_DEF,config: data.sounds.powerOff.config };
  }

  const _channelChanged = (data.channelId || null) !== _tvActiveChannelId;
  if (_channelChanged) { _clearScorebug(); _clearStandings(); _clearSportsFx(); _clearGameday(); }   // drop stale graphics when the dial moves
  _tvActiveChannelId = data.channelId || null;
  // Keep the TV guide open across a channel change, but refresh it for the new station.
  if (_channelChanged && _scheduleOpen) _requestSchedule();
  _tvOpen = true;
  _tvShuttingDown = false;
  _tvPoweredOff = !data.channelId || data.channelNumber === 0;
  if (_tvActiveChannelId) sendRaw({ type: 'tv_watch', channelId: _tvActiveChannelId });
  _tvHistory.length = 0;
  _tickerText = '';
  _tickerAnimating = false;
  _clearAfterTitleCard = false;
  _tvChannelList = Array.isArray(data.channelList) ? data.channelList : [];

  document.getElementById('tv-station-name').textContent = data.stationName || data.channelName || '——';
  document.getElementById('tv-channel-num').textContent = (data.channelNumber > 0) ? `CH ${data.channelNumber}` : '——';
  const pnEl = document.getElementById('tv-program-name');
  pnEl.textContent = '';
  pnEl.style.opacity = '';
  document.getElementById('tv-messages').innerHTML = '';

  const inner = document.getElementById('tv-ticker-inner');
  inner.style.transition = 'none';
  inner.style.transform  = '';
  inner.textContent = '';

  applyTvTheme(data.theme || null);

  // Chassis skin is a property of the physical set (device flag), not the channel —
  // so it persists across tune echoes. Default 'crt' = the base #tv-window chassis.
  const skinWin = document.getElementById('tv-window');
  if (skinWin) skinWin.dataset.skin = data.skin || 'crt';

  if (isTuneEcho) return; // metadata synced; dial position and animations are untouched

  _tvFrequency = 0;
  _dialRaw = 0;
  const freqDisplay = document.getElementById('tv-freq-display');
  if (freqDisplay) freqDisplay.textContent = _tvFrequency.toFixed(1);

  document.getElementById('tv-panel').classList.add('active');
  window.AudioEngine?.loopSound(_humDef);
  window.AudioEngine?.loopSound(_staticDef);
  _setStaticAudio(0);

  if (_tvPoweredOff) {
    // TV opened at 0.0 — show static, content hidden
    document.getElementById('tv-content').classList.add('tv-hidden');
    const staticEl = document.getElementById('tv-static');
    staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
    staticEl.style.opacity = '1';
    staticEl.classList.add('tv-static-on');
    _playCrtPowerOn();
  } else {
    // CRT power-on: expand from bright line, then reveal content
    const content  = document.getElementById('tv-content');
    const staticEl = document.getElementById('tv-static');
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
      staticEl.addEventListener('animationend', () => staticEl.classList.remove('tv-static-fade'), { once: true });
      _setStaticAudio(0, 0.3);
    }, 720);
  }
}

function _playTuneAnimation() {
  if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }

  const staticEl = document.getElementById('tv-static');
  const content  = document.getElementById('tv-content');
  const knob     = document.getElementById('tv-knob');

  // Hide content, show static — clear inline knob rotation so spin animation plays cleanly
  _tvOffAir = false;
  content.style.opacity = '';
  content.classList.add('tv-hidden');
  staticEl.style.opacity = '';
  staticEl.classList.remove('tv-static-fade');
  knob.style.transform = '';
  staticEl.classList.add('tv-static-on');
  _setStaticAudio(1);

  // Spin the knob
  knob.classList.remove('tv-knob-spinning');
  knob.offsetWidth; // force reflow to restart animation
  knob.classList.add('tv-knob-spinning');

  // After knob settles (~1.1s), fade static out and reveal content (unless off-air)
  _tuneTimer = setTimeout(() => {
    knob.classList.remove('tv-knob-spinning');
    _updateKnobRotation();
    const pn = document.getElementById('tv-program-name');
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
  const win = document.getElementById('tv-window');
  const staticEl = document.getElementById('tv-static');

  // Static comes on as the CRT warms up
  staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
  staticEl.style.opacity = '1';
  staticEl.classList.add('tv-static-on');
  _setStaticAudio(1);
  window.AudioEngine?.playSfx(_powerOnDef);

  win.classList.remove('tv-powering-on');
  win.offsetWidth; // force reflow to restart animation
  win.classList.add('tv-powering-on');
  win.addEventListener('animationend', () => win.classList.remove('tv-powering-on'), { once: true });
}

const _TV_THEME_VARS = ['--tv-bg', '--tv-border', '--tv-text', '--tv-header-color', '--tv-live-color', '--tv-ticker-color'];
let _tvThemeKey = null;    // signature of the theme currently on-screen
let _tvThemeTimer = null;  // pending fade-in-to-target timer

// Low-level: write a theme's CSS variables onto #tv-window, or clear them for the
// neutral default (corporate) look. CSS transitions animate the actual colour swap.
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

export function applyTvTheme(theme) {
  const win = document.getElementById('tv-window');
  if (!win) return;

  const key = theme
    ? JSON.stringify([theme.preset, theme.bg_color, theme.border_color, theme.text_color,
        theme.header_color || theme.accent_color, theme.live_color, theme.ticker_color])
    : 'default';
  if (key === _tvThemeKey) return; // already showing this theme — don't restart the fade

  if (_tvThemeTimer) { clearTimeout(_tvThemeTimer); _tvThemeTimer = null; }
  _tvThemeKey = key;

  // Fade out to the neutral default first (like tuning through the dial), then
  // fade in to the target station's theme. Both steps are eased by the CSS
  // transitions on the TV's themed elements.
  _writeTvTheme(win, null);
  if (key === 'default') return;
  _tvThemeTimer = setTimeout(() => { _writeTvTheme(win, theme); _tvThemeTimer = null; }, 420);
}

export function closeTvPanel() {
  window.AudioEngine?.cancelSpeech();
  _tvOpen = false;
  _tvShuttingDown = false;
  _tvPoweredOff = false;
  _tvActiveChannelId = null;
  _tvOffAir = false;
  _tvThemeKey = null;
  if (_tvThemeTimer) { clearTimeout(_tvThemeTimer); _tvThemeTimer = null; }
  sendRaw({ type: 'tv_unwatch' });
  if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }
  if (_sweepRaf) { cancelAnimationFrame(_sweepRaf); _sweepRaf = null; }
  _clearOverlay();
  _clearScorebug();
  _clearStandings();
  _clearSportsFx();
  _clearGameday();
  _clearSchedule();
  const win = document.getElementById('tv-window');
  win.classList.remove('tv-shutting-off');
  win.style.position = '';
  win.style.left = '';
  win.style.top = '';
  win.style.margin = '';
  document.getElementById('tv-static').classList.remove('tv-static-on', 'tv-static-fade', 'tv-static-loop');
  document.getElementById('tv-content').classList.remove('tv-hidden');
  document.getElementById('tv-panel').classList.remove('active');
  window.AudioEngine?.stopLoop(_humDef.id);
  window.AudioEngine?.stopLoop(_staticDef.id);
}

export function shutdownTvPanel() {
  if (!_tvOpen || _tvShuttingDown) return;
  window.AudioEngine?.cancelSpeech();
  _tvShuttingDown = true;
  if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }

  // Brief static flash, then CRT vertical collapse
  const staticEl = document.getElementById('tv-static');
  staticEl.classList.remove('tv-static-fade');
  staticEl.classList.add('tv-static-on');
  _setStaticAudio(1);

  setTimeout(() => {
    staticEl.classList.remove('tv-static-on');
    _setStaticAudio(0, 0.1);
    const win = document.getElementById('tv-window');
    win.classList.add('tv-shutting-off');
    window.AudioEngine?.playSfx(_powerOffDef);
    win.addEventListener('animationend', () => closeTvPanel(), { once: true });
  }, 280);
}

export function applyTvOverlay(overlay) {
  // The score-bug is a persistent layer (updated in place, its own container) —
  // it must not be wiped by transient overlays, nor auto-dismiss on a timer.
  if (overlay && overlay.overlayType === 'scorebug') { _applyScorebug(overlay); return; }
  if (overlay && overlay.overlayType === 'gameday') { _handleGameday(overlay); return; }
  if (overlay && overlay.overlayType === 'standings') { _applyStandingsBug(overlay); return; }
  // Sports "jumbotron" FX. While the Gameday sub-screen is open, render it Gameday-
  // native (a compact card over the field) instead of taking over the whole TV screen.
  if (overlay && overlay.overlayType === 'sportsfx') {
    if (_gamedayOpen && _gamedayView) _gamedayView.showCard(overlay);
    else _applySportsFx(overlay);
    return;
  }
  _clearOverlay();
  const container = document.getElementById('tv-overlay-container');
  if (!container || !overlay) return;

  let el;
  if (overlay.overlayType === 'text_card') {
    _clearTvMessages();
    el = document.createElement('div');
    el.className = 'tv-overlay-text-card';
    el.innerHTML = _esc(overlay.text).replace(/\n/g, '<br>');
  } else if (overlay.overlayType === 'lower_third') {
    el = document.createElement('div');
    el.className = 'tv-overlay-lower-third';
    el.innerHTML =
      `<div class="tv-overlay-lt-name">${_esc(overlay.text)}</div>` +
      (overlay.subtext ? `<div class="tv-overlay-lt-sub">${_esc(overlay.subtext)}</div>` : '');
  } else if (overlay.overlayType === 'alert_flash') {
    el = document.createElement('div');
    el.className = 'tv-overlay-alert';
    el.innerHTML =
      `<div class="tv-overlay-alert-title">${_esc(overlay.text)}</div>` +
      (overlay.subtext ? `<div class="tv-overlay-alert-sub">${_esc(overlay.subtext)}</div>` : '');
  }

  if (el) {
    container.appendChild(el);
    if (overlay.duration > 0) {
      _overlayTimer = setTimeout(_clearOverlay, overlay.duration * 1000);
    }
  }
}

function _clearOverlay() {
  if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
  const container = document.getElementById('tv-overlay-container');
  if (container) container.innerHTML = '';
}

// Persistent sports score-bug. Sport-agnostic: always renders the two teams, their
// scores, and a status line. Baseball adds the diamond + out dots when the payload
// carries `bases`/`outs`; a sport without those (status = "Q3 08:42") simply shows
// the bar with no diamond. Updated in place so it stays constant between plays.
function _applyScorebug(sb) {
  const host = document.getElementById('tv-scorebug');
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
  let outs = '';
  if (sb.outs != null) {
    const o = Math.max(0, Math.min(3, sb.outs | 0));
    outs = `<div class="tv-sb-outs" aria-label="${o} out">` +
      [0, 1, 2].map(i => `<span class="tv-sb-out ${i < o ? 'on' : ''}"></span>`).join('') + `</div>`;
  }

  host.innerHTML =
    `<div class="tv-sb-scores">` +
      `<div class="tv-sb-row ${aLead ? 'lead' : ''}"><span class="tv-sb-team">${away}</span><span class="tv-sb-num">${aScore}</span></div>` +
      `<div class="tv-sb-row ${hLead ? 'lead' : ''}"><span class="tv-sb-team">${home}</span><span class="tv-sb-num">${hScore}</span></div>` +
    `</div>` +
    `<div class="tv-sb-state">${diamond}<div class="tv-sb-status">${_esc(sb.status || '')}</div>${outs}</div>`;
  host.classList.add('on');
}

function _clearScorebug() {
  const host = document.getElementById('tv-scorebug');
  if (host) { host.innerHTML = ''; host.classList.remove('on'); }
}

// ── Gameday sub-screen ─────────────────────────────────────────────────────────
// A new `gameday` overlay arrives per at-bat during a sports broadcast. First one
// reveals the "Gameday" toggle button; the view only renders while the player has it
// open (it covers the play-by-play), but we always cache the latest so opening mid-
// game lands on the current play. The view is placement-agnostic (gameday.js) — this
// wires it to the TV window and could bind the same view to a tablet host later.
function _handleGameday(gd) {
  _lastGameday = gd;
  const btn = document.getElementById('tv-gameday-btn');
  if (btn) btn.classList.add('avail');
  if (_gamedayOpen) {
    if (!_gamedayView) _gamedayView = createGamedayView(document.getElementById('tv-gameday'));
    _gamedayView.apply(gd);
  }
}

function _toggleGameday() {
  const host = document.getElementById('tv-gameday');
  const btn = document.getElementById('tv-gameday-btn');
  if (!host) return;
  _gamedayOpen = !_gamedayOpen;
  host.classList.toggle('on', _gamedayOpen);
  btn?.classList.toggle('on', _gamedayOpen);
  if (_gamedayOpen) {
    if (!_gamedayView) _gamedayView = createGamedayView(host);
    if (_lastGameday) _gamedayView.apply(_lastGameday);
    else _gamedayView.showIdle();   // opened before an at-bat arrived — never blank
  }
}

// Drop the whole sub-screen — on a channel change or panel close, so a stale game
// never lingers. Hides the toggle until the next sports broadcast reveals it again.
function _clearGameday() {
  _gamedayOpen = false;
  _lastGameday = null;
  _gamedayView?.clear();
  const host = document.getElementById('tv-gameday');
  if (host) host.classList.remove('on');
  const btn = document.getElementById('tv-gameday-btn');
  if (btn) btn.classList.remove('on', 'avail');
}

// ── TV guide sub-screen ─────────────────────────────────────────────────────────
// A "what's on and when" panel for the tuned channel. Opening it asks the server for
// the running order + current in-world time (tv_schedule); while it stays open we
// re-request on a slow tick so the "on now" highlight and loop countdowns stay live.
// Placement mirrors the Gameday sub-screen: an overlay covering the message area.
let _scheduleOpen = false;
let _scheduleTimer = null;

function _requestSchedule() {
  if (_tvActiveChannelId) sendRaw({ type: 'tv_schedule', channelId: _tvActiveChannelId });
}

function _toggleSchedule() {
  const host = document.getElementById('tv-schedule');
  const btn = document.getElementById('tv-schedule-btn');
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

// Drop the guide on channel change / panel close so a stale listing never lingers.
function _clearSchedule() {
  _scheduleOpen = false;
  _clearScheduleTimer();
  const host = document.getElementById('tv-schedule');
  if (host) { host.classList.remove('on'); host.innerHTML = ''; }
  const btn = document.getElementById('tv-schedule-btn');
  if (btn) btn.classList.remove('on');
}

export function renderTvSchedule(data) {
  if (!_scheduleOpen || !data || data.channelId !== _tvActiveChannelId) return;
  const host = document.getElementById('tv-schedule');
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
      const when = daily ? _esc(sl.todLabel || '') : (sl.onNow ? 'ON NOW' : fmtIn(sl.startsInSec));
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
let _standingsTimer = null;
function _applyStandingsBug(sb) {
  const host = document.getElementById('tv-standings');
  if (!host) return;
  const rows = Array.isArray(sb.rows) ? sb.rows : [];
  if (!rows.length) return;
  const body = rows.map((r, i) => {
    const rd = (r.rd > 0 ? '+' : '') + (Number.isFinite(r.rd) ? r.rd : 0);
    return `<div class="tv-st-row">` +
      `<span class="tv-st-rank">${i + 1}</span>` +
      `<span class="tv-st-team">${_esc(r.team)}</span>` +
      `<span class="tv-st-rec">${r.wins}-${r.losses}</span>` +
      `<span class="tv-st-rd">${rd}</span>` +
    `</div>`;
  }).join('');
  host.innerHTML = `<div class="tv-st-title">${_esc(sb.title || 'STANDINGS')}</div>${body}`;
  host.classList.add('on');
  // Reserve the bug's top-right corner in the text layer so the play-by-play wraps
  // around it instead of running underneath. Measure after layout, then flow the
  // shape into #tv-messages and mark #tv-content so the message column runs block.
  requestAnimationFrame(() => {
    const content = document.getElementById('tv-content');
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

// The float that reserves the bug's corner must be the first child of #tv-messages
// (a float only pushes content that follows it). appendTvMessage keeps it in front.
function _ensureStandingsShape() {
  const content = document.getElementById('tv-content');
  if (!content || !content.classList.contains('standings-on')) return;
  const container = document.getElementById('tv-messages');
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
  const host = document.getElementById('tv-standings');
  if (host) { host.innerHTML = ''; host.classList.remove('on'); }
  const content = document.getElementById('tv-content');
  if (content) {
    content.classList.remove('standings-on');
    content.style.removeProperty('--tv-st-shape-w');
    content.style.removeProperty('--tv-st-shape-h');
  }
  const shape = document.querySelector('#tv-messages .tv-standings-shape');
  if (shape) shape.remove();
}

// Full-screen sports "graphics": the home-run trajectory call-out, the final-score
// card, and the extra-innings hype card. Injected into #tv-fx (which sits above the
// score/standings bugs) and auto-dismissed; the animations are pure CSS/SMIL so they
// play the moment the markup lands. Server fires these on the matching spoken line.
let _fxTimer = null;
function _applySportsFx(fx) {
  const host = document.getElementById('tv-fx');
  if (!host) return;
  let inner = '';
  if (fx.kind === 'homerun') {
    const sub = [fx.batter, fx.team].filter(Boolean).join(' · ');
    inner =
      `<div class="tv-fx-hr">` +
        `<svg class="tv-fx-hr-svg" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
          `<path id="tvHrPath" class="tv-fx-hr-arc" d="M 32 226 Q 210 -48 374 116" fill="none"/>` +
          `<circle class="tv-fx-hr-ball" r="6"><animateMotion dur="1.25s" fill="freeze" rotate="auto"><mpath href="#tvHrPath"/></animateMotion></circle>` +
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
    inner =
      `<div class="tv-fx-matchup">` +
        `<div class="tv-fx-mu-label">Tonight on DEADBALL</div>` +
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
        `<div class="tv-fx-champ-label">World Series Champions</div>` +
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
  const host = document.getElementById('tv-fx');
  if (host) { host.innerHTML = ''; host.className = 'tv-fx-host'; }
}

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function isTvOpen() { return _tvOpen; }
export function getTvActiveChannelId() { return _tvActiveChannelId; }

function _tvTuneTo(num) {
  window.AudioEngine?.cancelSpeech();
  if (_sweepRaf) { cancelAnimationFrame(_sweepRaf); _sweepRaf = null; }
  _wheelTarget = null;
  _tvFrequency = num;
  _dialRaw = num;
  _updateKnobRotation();
  sendCmdSilent('tune ' + num);
}

// Sweeps the dial from its current position toward the next/previous channel
// in the list, passing through the static in between (same lock logic as a
// manual drag) rather than snapping straight there. Used by the +/- buttons,
// which exist for touch/no-wheel input but read identically to a slow turn.
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
  _sweepDialTo(target, direction);
}

function _sweepDialTo(targetNumber, direction) {
  if (_sweepRaf) cancelAnimationFrame(_sweepRaf);

  const start = _dialRaw;
  // Unwrap the target so the sweep moves monotonically in the requested
  // direction instead of jumping backward across the wrap point.
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
    tvTunerInput(Math.round(_dialRaw * 20) / 20);
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
  const knobEl = document.getElementById('tv-knob');
  if (knobEl) knobEl.style.transform = `rotate(${rotation}deg)`;
}

export function tvTunerInput(val) {
  _tvFrequency = parseFloat(val);
  const freqDisplay = document.getElementById('tv-freq-display');
  if (freqDisplay) freqDisplay.textContent = _tvFrequency.toFixed(2);
  _updateKnobRotation();

  if (!_tvChannelList.length) return;

  const nearest = _tvChannelList.reduce((a, b) =>
    Math.abs(b.number - _tvFrequency) < Math.abs(a.number - _tvFrequency) ? b : a);
  const dist = Math.abs(nearest.number - _tvFrequency);

  const staticEl      = document.getElementById('tv-static');
  const contentEl     = document.getElementById('tv-content');
  const chanNumEl     = document.getElementById('tv-channel-num');
  const programNameEl = document.getElementById('tv-program-name');

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
  if (chanNumEl) chanNumEl.textContent = (dist < 0.01) ? `CH ${nearest.number}` : '——';

  if (dist < LOCK_RANGE && nearest.channelId !== _tvActiveChannelId) {
    _tvTuneTo(nearest.number);
  }
}

export function showTvOffAir(offlineGraphicContent, offlineGraphicType) {
  const staticEl = document.getElementById('tv-static');
  const content  = document.getElementById('tv-content');
  if (!staticEl || !content) return;
  _tvOffAir = true;
  _clearScorebug();
  _clearStandings();
  _clearSportsFx();
  if (offlineGraphicContent && !_tuneTimer) {
    staticEl.classList.remove('tv-static-on', 'tv-static-loop');
    staticEl.style.opacity = '';
    content.classList.remove('tv-hidden');
    appendTvMessage(offlineGraphicContent, offlineGraphicType === 'svg' ? 'svg' : 'ascii_art');
    _setStaticAudio(0, 0.3);
  } else {
    content.classList.add('tv-hidden');
    staticEl.classList.remove('tv-static-fade');
    staticEl.classList.add('tv-static-on', 'tv-static-loop');
    staticEl.style.opacity = '';
    _setStaticAudio(1);
  }
}

export function showTvOnAir() {
  if (!_tvOffAir) return;
  _tvOffAir = false;
  const staticEl = document.getElementById('tv-static');
  const content  = document.getElementById('tv-content');
  if (!staticEl || !content) return;
  staticEl.classList.remove('tv-static-on', 'tv-static-loop');
  staticEl.classList.add('tv-static-fade');
  staticEl.addEventListener('animationend', () => staticEl.classList.remove('tv-static-fade'), { once: true });
  content.classList.remove('tv-hidden');
  _setStaticAudio(0, 0.3);
}

function _clearTvMessages() {
  const container = document.getElementById('tv-messages');
  if (container) container.innerHTML = '';
  _tvHistory.length = 0;
}

export function clearTvMessages() { _clearTvMessages(); }

export function appendTvMessage(text, style, duration) {
  const container = document.getElementById('tv-messages');
  if (!container) return;

  const isTitleCard = style === 'svg' || style === 'ascii_art' || style === 'credits';

  // Clear before title cards, and after them on the next message
  if (isTitleCard || _clearAfterTitleCard) {
    _clearTvMessages();
    _clearAfterTitleCard = false;
  } else {
    // #tv-content has overflow:hidden — if content height exceeds its box, clear and restart
    const tvContent = document.getElementById('tv-content');
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
    const content = document.getElementById('tv-content');
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
      const contentH = content.clientHeight;
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

  const el = document.createElement(style === 'ascii_art' ? 'pre' : 'div');
  el.className = `tv-msg tv-msg-${style || 'raw'}`;
  if (style === 'svg') {
    try {
      el.innerHTML = text;
      const svg = el.querySelector('svg');
      if (!svg) throw new Error('no <svg> root element');
      if (!svg.getAttribute('viewBox')) {
        const w = parseFloat(svg.getAttribute('width')) || 640;
        const h = parseFloat(svg.getAttribute('height')) || 360;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      const vbParts = svg.getAttribute('viewBox').split(/[\s,]+/);
      const naturalWidth = parseFloat(vbParts[2]) || 640;
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = `${naturalWidth}px`;
      svg.style.maxWidth = '100%';
      svg.style.height = 'auto';
      svg.style.display = 'block';
      svg.style.margin = '0 auto';
    } catch (err) {
      // A malformed graphic must never break the broadcast — drop this card and
      // let the show carry on with the next message.
      console.warn('[tv] title-card graphic failed to render, skipping card:', err?.message || err);
      return;
    }
  } else if (style === 'ascii_art') {
    el.innerHTML = renderMarkup(text);
    // Scale font-size so the widest line fills the content area.
    // Strip markup tags from text before measuring so tag syntax doesn't inflate line lengths.
    requestAnimationFrame(() => {
      const content = document.getElementById('tv-content');
      if (!content) return;
      const plain = text.replace(/\[[^\]]*\]/g, '');
      const lines = plain.split('\n');
      const maxLen = Math.max(...lines.map(l => l.length), 1);
      const availPx = content.clientWidth - 36;
      const targetPx = Math.min(availPx / (maxLen * 0.6), 18);
      const finalPx  = Math.max(targetPx, 7);
      el.style.fontSize = `${finalPx.toFixed(1)}px`;
    });
  } else {
    el.innerHTML = _tvColorizeNpcSay(renderMarkup(text));
    // Mirror Chip's spoken line into the Gameday caption bar while that view is open
    // (the text rides this broadcast message, separate from the gameday overlay).
    if (_gamedayOpen && _gamedayView) {
      const plain = String(text).replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      if (plain) _gamedayView.setCaption(plain);
    }
  }
  container.appendChild(el);

  // Blank spacer between messages
  const spacer = document.createElement('div');
  spacer.style.height = '0.75em';
  container.appendChild(spacer);

  _tvHistory.push(el, spacer);
  if (_tvHistory.length > MAX_TV_HISTORY * 2) {
    _tvHistory.splice(0, 2).forEach(n => n.remove());
  }

  // Post-append guard: the message just added (now possibly re-wrapped narrower
  // around the standings bug) must not spill past the bottom of the box and get
  // clipped. If it does, roll to a fresh screen with this message alone at the top.
  const tvContent = document.getElementById('tv-content');
  if (tvContent && tvContent.clientHeight > 0 &&
      container.offsetHeight > tvContent.clientHeight &&
      _tvHistory.length > 2) {
    _clearTvMessages();
    _ensureStandingsShape();
    container.appendChild(el);
    container.appendChild(spacer);
    _tvHistory.push(el, spacer);
  }
}

export function updateTvTicker(text) {
  // Strip the >> << wrapper the broadcast runtime adds
  const clean = text.replace(/^>> /, '').replace(/ <<$/, '').trim();
  if (!clean) return;

  _tickerText = _tickerText ? `${_tickerText}   ●   ${clean}` : clean;

  if (!_tickerAnimating) _startTickerAnimation();
}

function _startTickerAnimation() {
  const inner = document.getElementById('tv-ticker-inner');
  const track = document.getElementById('tv-ticker-track');
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


export function initTvPanel() {
  // Power button: a quick TAP just closes your view — the set keeps playing in the
  // room, so anyone else there still sees/hears it (ambient continues). Press and
  // HOLD to actually switch the set off: that stops the broadcast for the whole room
  // and announces it ("… switches off the television."). See tv.poweroff server-side.
  const powerBtn = document.getElementById('tv-close-btn');
  const HOLD_MS = 450;
  let _powerHoldTimer = null, _powerHeld = false;
  const clearHold = () => { if (_powerHoldTimer) { clearTimeout(_powerHoldTimer); _powerHoldTimer = null; } };
  powerBtn.addEventListener('pointerdown', (e) => {
    if (!_tvOpen) return;
    e.preventDefault();
    _powerHeld = false;
    clearHold();
    _powerHoldTimer = setTimeout(() => {
      _powerHeld = true; _powerHoldTimer = null;
      sendRaw({ type: 'tv_poweroff' });   // switch the whole set off, room-wide
      shutdownTvPanel();                   // CRT collapse + local close
    }, HOLD_MS);
  });
  powerBtn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    clearHold();
    if (_powerHeld) { _powerHeld = false; return; }   // the hold already switched it off
    if (_tvOpen) closeTvPanel();                        // quick tap: close the view, set stays on
  });
  powerBtn.addEventListener('pointerleave', clearHold);      // dragged off → cancel the hold
  powerBtn.addEventListener('pointercancel', () => { clearHold(); _powerHeld = false; });
  window.addEventListener('game-disconnect', () => { if (_tvOpen) shutdownTvPanel(); });

  // Read-aloud toggle: synthesize the broadcast's spoken lines with a procedural
  // formant voice. Preference persists across sessions. Turning it off cuts any
  // line currently being read.
  const readBtn = document.getElementById('tv-read-btn');
  const syncReadBtn = () => readBtn?.classList.toggle('on', _readAloud);
  syncReadBtn();
  readBtn?.addEventListener('click', () => {
    _readAloud = !_readAloud;
    localStorage.setItem('tvReadAloud', _readAloud ? '1' : '0');
    syncReadBtn();
    if (!_readAloud) window.AudioEngine?.cancelSpeech();
  });

  // Gameday toggle: reveals the animated at-bat sub-screen. Hidden until a sports
  // broadcast sends its first `gameday` overlay (which adds `.avail`).
  const gamedayBtn = document.getElementById('tv-gameday-btn');
  gamedayBtn?.addEventListener('click', () => { if (_tvOpen) _toggleGameday(); });

  // TV guide toggle: shows the tuned channel's running order + current in-world time.
  const scheduleBtn = document.getElementById('tv-schedule-btn');
  scheduleBtn?.addEventListener('click', () => { if (_tvOpen) _toggleSchedule(); });

  // Knob: click cycles channels, mousewheel fine-tunes. Drag-to-rotate is
  // disabled for now — it was unreliable to control smoothly — so there's no
  // mousedown/mousemove rotation handling here.
  const knob = document.getElementById('tv-knob');

  knob.addEventListener('click', () => {
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
  knob.addEventListener('wheel', (e) => {
    if (!_tvOpen) return;
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.25;
    const base = _wheelTarget !== null ? _wheelTarget : _dialRaw;
    _wheelTarget = Math.round(((base + delta + TV_DIAL_MAX) % TV_DIAL_MAX) * 20) / 20;
    _sweepDialTo(_wheelTarget, Math.sign(delta));
  }, { passive: false });

  // +/- buttons: smoothly sweep toward the next/previous channel rather than
  // snapping, so touch/no-wheel users still see the static pass between
  // channels the same way a wheel scrub or drag would show it.
  const tuneDownBtn = document.getElementById('tv-tune-down');
  const tuneUpBtn   = document.getElementById('tv-tune-up');
  tuneDownBtn?.addEventListener('click', () => { if (_tvOpen) _stepChannel(-1); });
  tuneUpBtn?.addEventListener('click',   () => { if (_tvOpen) _stepChannel(1); });

  // Draggable TV window
  const header = document.getElementById('tv-header');
  const win = document.getElementById('tv-window');
  let _dragWin = false;
  let _dragWinX = 0, _dragWinY = 0;
  let _winOffX = 0, _winOffY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('#tv-close-btn')) return;
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
    if (e.key === 'Escape' && _tvOpen) shutdownTvPanel();
  });

}
