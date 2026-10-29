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
import { cphlMark, cphlLockup } from './cphl-brand.js';
import { crestSvg, clubOf, wantClubs, onClubs } from './club-crest.js';
import { wantVenue } from './venue.js';
import { state } from '../state.js';
import { makeCornerResizable } from './corner-resize.js';

// The two sports sub-screens (gameday.js, gameday-rink.js) are about 209 KB, and they
// were in the boot download for every player. They load on the first sports broadcast
// instead, which is when the Gameday button appears; opening it awaits the same promise.
// Baseball mounts through gameday-grandstand.js, the park in 3-D, which is the 2-D Gameday
// where it can't draw or where its flag is set to '0'.
let _gamedayViews = null;
function loadGamedayViews() {
  return (_gamedayViews ??= Promise.all([import('./gameday-grandstand.js'), import('./gameday-rink.js')])
    .then(([g, r]) => ({ createGrandstandView: g.createGrandstandView, createRinkView: r.createRinkView }))
    .catch((err) => { _gamedayViews = null; throw err; }));   // a failed fetch retries next time
}

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
// Guarded: this runs at module load and tv.js is in the boot graph, so a throw
// from blocked storage would stop the whole client booting.
let _readAloud = false;
try { _readAloud = localStorage.getItem('tvReadAloud') === '1'; } catch { /* storage blocked */ }

// Every live instance, so dispatch.js can fan a server message out to whichever
// surface(s) are actually tuned to that channel.
const _views = new Set();

// The synth's TV channel is one shared voice (AudioEngine.speak / cancelSpeech('tv')).
// Exactly one instance owns it at a time — claimed on open/tune — so two surfaces
// never narrate over each other. Read Aloud has its own channel, so cancelling
// here never cuts the reader off, and a typed command never cuts the TV off.
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

// The sting each page of a final's package goes up on (_applyPackage): a major chord in the key of
// the final's open (the venue's finalOpen.key, which the package carries as `sting`), over a timpani
// hit and a cymbal. The CPhL's brass is FM, as its band's is (scripts/content/build-final-opens.mjs);
// its FM ratios are 2 and 3, never 1 or 0.5 (docs/systems-hockey-sound.md).
const STING_PC = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
function packageStingDef(key, fm) {
  const pc = STING_PC[key];
  if (pc == null) return null;
  const root = (440 * 2 ** ((pc - 9) / 12)) / 2;
  const brass = (freq, gain) => (fm
    ? { waveform: 'sine', freq, gain, adsr: { a: 0.012, d: 0.5, s: 0.3, r: 0.4 }, fm: { ratio: 2, index: 2.2, indexEnd: 1.1, time: 0.15 } }
    : { waveform: 'sawtooth', freq, gain, adsr: { a: 0.015, d: 0.55, s: 0.28, r: 0.45 }, filter: { type: 'lowpass', freq: 2200, q: 0.7 } });
  return { id: `tv_package_sting_${key}${fm ? '_fm' : ''}`, category: 'tv', priority: 4, config: { duration: 1.8, layers: [
    brass(root, 0.11), brass(root * 1.4983, 0.09), brass(root * 2, 0.08), brass(root * 2.5198, 0.06),
    { waveform: 'sine', freq: root / 2, gain: 0.4, adsr: { a: 0.002, d: 0.9, s: 0, r: 0.3 }, pitchBend: { to: (root / 2) * 0.96, time: 0.4 } },
    { waveform: 'sine', noiseMix: 1, gain: 0.1, adsr: { a: 0.002, d: 1.3, s: 0, r: 0.4 }, filter: { type: 'highpass', freq: 5200, q: 0.7 } },
  ] } };
}

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
  // The channel number of a tune already sent but not yet echoed back. The lock check
  // below runs every animation frame, and _tvActiveChannelId only updates when the
  // server's echo lands — so without this a single knob gesture fires the same tune
  // two or three times while the round trip is in flight.
  let _tvPendingTune = null;
  let _tvOffAir = false;
  const _tvHistory = [];
  let _clearAfterTitleCard = false;
  let _tickerText = '';
  let _tickerAnimating = false;
  let _overlayTimer = null;
  // Identity of the transient card currently on the glass. A beat re-sends its
  // graphic every time it fires, so the same lower third arrives again and again
  // during one segment — rebuilding the node replayed its slide-in animation and
  // the card kept shooting up off the bottom. Same identity ⇒ leave the node alone.
  let _overlayKey = null;
  let _programName = null;
  let _tuneTimer = null;
  let _standingsTimer = null;
  let _fxTimer = null;
  let _lastSpoken = null;   // the last line the booth said, so an open that lands just after it can caption it
  let _pregameUp = false;   // the pregame open is on screen; spoken lines go to its caption strip
  let _gamedayView = null;
  let _gamedaySport = null;   // which sport the mounted sub-screen renders
  let _stationName = '';      // the tuned station's name, for a sub-screen's corner bug
  let _channelNumber = 0;     // and its number, for the network's tag on a sports bug
  let _gamedayOpen = false;
  let _gamedayDismissed = false;   // the viewer shut it this broadcast; don't reopen it on the next play
  let _lastGameday = null;
  let _scheduleOpen = false;
  let _scheduleTimer = null;
  let _standingsPanelOpen = false;
  let _standingsPanelTimer = null;
  let _deckData = null;      // the absorbed tape deck under this set, or null
  let _deckOpen = false;
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
  function speak(rawText, style, windowSec, dl) {
    // appendMessage ran a moment ago for this same message and queued it — the
    // delivery will speak it when the voice frees. Coupled to dispatch's call order
    // (append then speak), which is why the flag is cleared on every append.
    if (_deferredLast) { _deferredLast = false; return; }
    // While the Gameday view is open it owns Chip's voice, starting it exactly when
    // his caption is displayed (a play-by-play line waits for the hit to land).
    if (_gamedayOpen && _gamedayView) return;
    _speakNow(rawText, style, windowSec, dl);
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
  let _speechQ = [];           // [{ speech, seed, at }] — utterance pieces
  let _deliverQ = [];          // [{ text, style, … }]   — whole messages awaiting the voice
  let _busyUntil = 0;          // performance.now() when the current utterance ends
  let _pumpTimer = null;
  let _deliverTimer = null;
  let _deferredLast = false;   // the message just handed to appendMessage was queued
  let _voiceLive = true;       // does the engine actually make sound? see _pump()
  // A message cannot wait forever. If the voice somehow stops finishing — a bug, a
  // suspended context, a line that outruns everything — the screen must not go dead,
  // so an old delivery is shown regardless. Generous, because normal operation never
  // reaches it: a line finishes in seconds, not tens of them.
  const DELIVER_MAX_WAIT_MS = 20000;
  // A CARD IS NOT A LINE. A title card starts no utterance, so it pushed _busyUntil
  // nowhere — and the drain below, having nothing to wait for, rendered the card and
  // the message after it in the same pass. The logo appeared and was cleared in the
  // same frame (see _clearAfterTitleCard), which is what made every commercial's
  // title card flash and vanish. A picture therefore holds the queue on its own
  // account, for its own duration, exactly as a spoken line does.
  let _cardUntil = 0;          // performance.now() until which a card owns the screen
  const CARD_MIN_MS = 2600;    // floor; mirrors CARD_MIN_HOLD_MS in plugins/broadcast
  const CARD_MAX_MS = 9000;    // a long credits crawl must not stall the whole queue
  const CARD_STYLES = new Set(['svg', 'ascii_art', 'credits']);
  const _cardHoldMs = (style, duration) => {
    if (!CARD_STYLES.has(style)) return 0;
    const authored = duration != null ? duration * 1000 : CARD_MIN_MS;
    return Math.min(CARD_MAX_MS, Math.max(CARD_MIN_MS, authored));
  };

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
    _flushDeliveries();
    _busyUntil = 0;
    // A purge (channel change, power off): nothing owns the screen, and anything the
    // flush put back behind a card goes with it rather than landing on the next channel.
    _deliverQ = [];
    if (_deliverTimer) { clearTimeout(_deliverTimer); _deliverTimer = null; }
    _cardUntil = 0;
    if (_pumpTimer) { clearTimeout(_pumpTimer); _pumpTimer = null; }
  }

  function _pump() {
    if (_pumpTimer) { clearTimeout(_pumpTimer); _pumpTimer = null; }
    if (!_speechQ.length) { _pumpDeliver(); return; }
    const now = performance.now();
    if (now < _busyUntil) { _pumpTimer = setTimeout(_pump, _busyUntil - now); return; }
    const item = _speechQ.shift();
    // A muted or disabled engine returns nothing; treat it as a zero-length read
    // so the queue drains immediately instead of stalling forever on a dead voice.
    // `dl` is the line's delivery from the broadcast, when it has one: `excite` (how hard the
    // booth is selling it, a goal call or a death), `lex` (how to say the names in it) and
    // `voice` (the booth's own voice). See AudioEngine.speak().
    const res = window.AudioEngine?.speak(item.speech, { seed: item.seed, budget: item.budget, ...(item.dl || null) });
    const spoke = !!(res && res.duration > 0);
    // The authority on whether there is a voice to wait for. If the engine produced
    // nothing, every queued caption is released at once and display goes back to the
    // server's timing — otherwise a muted set would hold its lines forever.
    if (_voiceLive !== spoke) { _voiceLive = spoke; if (!spoke) _flushDeliveries(); }
    const dur = spoke ? res.duration * 1000 : 0;
    _busyUntil = now + dur + lineGap();
    _pumpTimer = setTimeout(_pump, dur + lineGap());
  }

  // Show the next waiting message once the voice has fallen silent, then speak it —
  // caption and audio start together, which is the whole point.
  function _pumpDeliver() {
    if (_deliverTimer) { clearTimeout(_deliverTimer); _deliverTimer = null; }
    if (!_deliverQ.length) return;
    const now = performance.now();
    const waited = now - _deliverQ[0].at;
    const busyUntil = Math.max(_busyUntil, _cardUntil);
    if ((_speechQ.length || now < busyUntil) && waited < DELIVER_MAX_WAIT_MS) {
      _deliverTimer = setTimeout(_pumpDeliver, Math.max(30, busyUntil - now));
      return;
    }
    const m = _deliverQ.shift();
    _renderMessage(m.text, m.style, m.duration, m.hasGameday, m.dl);
    // The picture that just went up owns the screen for its own hold — the next
    // message waits for it the way it waits for a voice.
    const cardMs = _cardHoldMs(m.style, m.duration);
    if (cardMs) _cardUntil = now + cardMs;
    // A card or ticker that queued only to keep its place in the order has nothing
    // to say. And while Gameday is open it owns Chip's voice and starts it with the
    // caption, so firing here as well would speak the line twice.
    if (m.spoken && !m.catchUp && !(_gamedayOpen && _gamedayView)) _speakNow(m.text, m.style, m.duration, m.dl);
    if (_deliverQ.length) _pumpDeliver();
  }

  function _flushDeliveries() {
    const pending = _deliverQ; _deliverQ = [];
    if (_deliverTimer) { clearTimeout(_deliverTimer); _deliverTimer = null; }
    for (let i = 0; i < pending.length; i++) {
      const m = pending[i];
      _renderMessage(m.text, m.style, m.duration, m.hasGameday, m.dl);
      const cardMs = _cardHoldMs(m.style, m.duration);
      if (!cardMs) continue;
      // A card even in a dump keeps its hold — emptying the rest of the queue on top
      // of it would wipe it in the same frame, which is the bug this pacing exists to
      // stop. Whatever follows the card goes back in the queue and waits for it.
      _cardUntil = performance.now() + cardMs;
      _deliverQ = pending.slice(i + 1);
      _pumpDeliver();
      return;
    }
  }

  // How long the oldest unspoken line has been waiting — i.e. how far the voice
  // has fallen behind the server's timeline.
  function _backlogMs() {
    if (_deliverQ.length) return performance.now() - _deliverQ[0].at;
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
    _speechQ = [];
    _deliverQ = _deliverQ.slice(-1);   // keep only the freshest, drop the stale ones
  }

  function _speakNow(rawText, style, windowSec, dl) {
    if (!_readAloud || !rawText) return;
    if (_speechOwner && _speechOwner !== view) return;   // another surface owns the voice
    if (style && style !== 'raw' && style !== 'emote' && style !== 'narrate' && style !== 'system') return;
    const strip = s => s.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();  // drop markup/bug tags
    let seed, speech;
    const m = /^(.+?) says, "([\s\S]*)"$/.exec(rawText);
    if (m) { seed = strip(m[1]); speech = strip(m[2]); }
    else { seed = (dl?.speaker || el('station-name')?.textContent || 'broadcast').trim(); speech = strip(rawText); }
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
    for (const piece of _splitUtterance(speech)) _speechQ.push({ speech: piece, seed, budget, dl, at: now });
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
    // A held card belongs to the station that raised it. Anything with duration 0 — a
    // stand-by delay card above all — waits for its own channel to take it down, so it
    // has to come off the glass when you tune away or it hangs over the next station.
    if (_channelChanged) { _programName = null; _clearOverlay(); _clearScorebug(); _clearStandings(); _clearSportsFx(); _clearGameday(); _clearStandingsPanel(); _clearFilmLayers(); }
    _tvActiveChannelId = data.channelId || null;
    _tvPendingTune = null;   // the round trip is home; the lock check can arm again
    // Keep the TV guide open across a channel change, but refresh it for the new station.
    if (_channelChanged && _scheduleOpen) _requestSchedule();
    _tvOpen = true;
    _tvShuttingDown = false;
    // "Powered off" here means the dial is parked with nothing on it — NOT channel
    // 0. Channel 0 is the VCR input (see plugins/broadcast `TV_OFF`), and a set on
    // it is showing a tape, so it gets the picture like any other station. Both
    // arrive with channelNumber 0; `deckInput` is what separates them.
    _tvPoweredOff = !data.channelId || (data.channelNumber === 0 && !data.deckInput);
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
    _stationName = data.stationName || data.channelName || '';
    _channelNumber = data.deckInput ? 0 : (data.channelNumber > 0 ? data.channelNumber : 0);
    if (stationEl) stationEl.textContent = _stationName || '——';
    setAll('channel-num', data.deckInput ? 'CH 0' : (data.channelNumber > 0) ? `CH ${data.channelNumber}` : '——');
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
      // Static first, then the picture fades up through it.
      //
      // The CRT power-on (the bright-line raster expand) belongs to the SET coming on, not to
      // finding a station. A dial sweep from 0.0 onto a channel arrives here with the set
      // already open and lit — it was showing static a frame ago — so replaying the raster
      // expand made the tube look like it switched itself off and back on every time you
      // locked a channel. Locking is a tune: it just fades in from the static.
      const isLock = wasAlreadyOn && wasPoweredOff;
      content.classList.add('tv-hidden');
      staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
      staticEl.style.opacity = '1';
      staticEl.classList.add('tv-static-on');
      if (!isLock) _playCrtPowerOn();
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
    if (_speechOwner === view) { window.AudioEngine?.cancelSpeech('tv'); _clearSpeech(); _speechOwner = null; }
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
    // The deck belongs to the ROOM, not the channel — but the strip is a surface of
    // this set, so it closes with it and the server re-pushes on the next power-on.
    _clearDeck();
    _deckData = null;
    el('deck-btn')?.classList.remove('avail');
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
    // Kill the show's music too. Owner-scoped, because the one music player is
    // shared: if the zone theme or the player's own AMP tape is what's currently
    // playing, this is a no-op and their music keeps going.
    window.AudioEngine?.stopMusicOwnedBy('tv');
    popIn();
    opts.onClose?.();
  }

  function shutdown() {
    if (!_tvOpen || _tvShuttingDown) return;
    // The tablet app has no CRT to collapse — it just closes (the tablet shell
    // itself owns the leaving animation).
    if (!isCrt) { close(); return; }
    if (_speechOwner === view) { window.AudioEngine?.cancelSpeech('tv'); _clearSpeech(); _speechOwner = null; }
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

  // ── club crests ───────────────────────────────────────────────────────────
  // A league's clubs carry their own crests (club-crest.js keeps them). A surface that
  // names a club puts its crest beside the name when the set is here, and nothing when
  // it isn't yet; the CPhL mark stays where it was. No club is in both leagues, so a name
  // finds its own league's set.
  function _crest(name, size, cls = '') {
    const c = clubOf(name, 'hockey') || clubOf(name, 'baseball');
    return c ? `<span class="tv-crest ${cls}">${crestSvg(c, size, { title: name })}</span>` : '';
  }
  let _lastScorebug = null;
  onClubs(() => { if (_lastScorebug) _applyScorebug(_lastScorebug); });

  // ── overlays ──────────────────────────────────────────────────────────────
  function applyOverlay(overlay) {
    // Every CPhL payload carries the stamp of the club identities it was built with.
    if (overlay?.clubsRev && wantClubs(overlay.sport || 'hockey', overlay.clubsRev)) sendRaw({ type: 'tv_clubs', sport: overlay.sport || 'hockey' });
    // A baseball game's first payload carries its venue's stamp, for the 3-D park's city.
    if (overlay?.venueRev && wantVenue(overlay.sport || 'baseball', overlay.venueRev)) sendRaw({ type: 'tv_venue', sport: overlay.sport || 'baseball' });
    // The score-bug is a persistent layer (updated in place, its own container) —
    // it must not be wiped by transient overlays, nor auto-dismiss on a timer.
    if (overlay && overlay.overlayType === 'scorebug') { _applyScorebug(overlay); return; }
    // the final's package gives way to the game: its first play, or the card on the matchup line
    const packageUp = () => el('fx')?.classList.contains('fx-package');
    if (overlay && overlay.overlayType === 'gameday') { if (overlay.phase !== 'arrive' && packageUp()) _clearSportsFx(); _handleGameday(overlay); return; }
    if (overlay && overlay.overlayType === 'standings') { _applyStandingsBug(overlay); return; }
    // Film layers. Letterbox is persistent — a matte the picture switches on and off,
    // never a timed card — and the fade is a one-shot transition that paints over
    // everything, so neither may go through the transient overlay container.
    if (overlay && overlay.overlayType === 'letterbox') { _applyLetterbox(!!overlay.on); return; }
    if (overlay && overlay.overlayType === 'fade') { _applyFade(overlay.fade || 'out', overlay.duration || 3); return; }
    // Sports "jumbotron" FX. While the Gameday sub-screen is open, render it Gameday-
    // native (a compact card over the field) instead of taking over the whole screen.
    if (overlay && overlay.overlayType === 'sportsfx') {
      // The pregame open runs before there's a field to show, so it always takes the screen.
      if (overlay.kind === 'pregame') { _applyPregame(overlay); return; }
      // ...and so does the final's package, which comes after it
      if (overlay.kind === 'package') { _applyPackage(overlay); return; }
      // "Live from" the park: with the sub-screen open (or opening, on the same line's payload) the
      // view flies in and letters it itself, so the full-screen card is only for a set without it
      if (overlay.kind === 'live' && _gamedayOpen) return;
      if (packageUp()) _clearSportsFx();
      if (_gamedayOpen && _gamedayView) _gamedayView.showCard(overlay);
      else _applySportsFx(overlay);
      return;
    }
    const container = el('overlay-container');
    if (!container || !overlay) { _clearOverlay(); return; }

    // A repeat of the card already showing: refresh its dismissal clock (the beat is
    // still on air) but never re-create the node, or the entry animation replays.
    const key = JSON.stringify([overlay.overlayType, overlay.text ?? '', overlay.subtext ?? '']);
    if (key === _overlayKey && container.firstChild) {
      if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
      if (overlay.duration > 0) _overlayTimer = setTimeout(_clearOverlay, overlay.duration * 1000);
      return;
    }
    _clearOverlay();

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
      _overlayKey = key;
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
    _overlayKey = null;
    const container = el('overlay-container');
    if (container) container.innerHTML = '';
  }

  // Persistent sports score-bug. Sport-agnostic: always renders the two teams, their
  // scores, and a status line. Baseball adds the diamond + out dots when the payload
  // carries `bases`/`outs`; a sport without those simply shows the bar with no
  // diamond. Updated in place so it stays constant between plays.
  // THE NETWORK'S TAG on its sports graphics: the call letters and the channel, the way a
  // station brands its sports desk. "KSAB-TV" on 7 reads KSAB 7. Built from the channel the
  // set is tuned to, so it names no station; a station with no name gets no tag.
  function _networkLabel() {
    const calls = String(_stationName || '').replace(/[-\s]*(TV|television)$/i, '').trim();
    return calls ? `${calls}${_channelNumber ? ` ${_channelNumber}` : ''}` : '';
  }
  function _networkTag() {
    const label = _networkLabel();
    return label ? `<div class="tv-net-tag"><b>${_esc(label)}</b><i>SPORTS</i></div>` : '';
  }
  // A club's colour for the chip beside its name: its own where it has one, otherwise one
  // the name always gives it.
  function _teamColour(name, sport) {
    const own = clubOf(name, sport)?.colours?.[0];
    if (own) return own;
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360}, 62%, 48%)`;
  }

  function _applyScorebug(sb) {
    const host = el('scorebug');
    if (!host) return;
    const prev = _lastScorebug;
    _lastScorebug = sb;
    const away = _esc(sb.awayAbbr || sb.away || 'AWY');
    const home = _esc(sb.homeAbbr || sb.home || 'HOM');
    const aScore = Number.isFinite(sb.awayScore) ? sb.awayScore : 0;
    const hScore = Number.isFinite(sb.homeScore) ? sb.homeScore : 0;
    const aLead = aScore > hScore, hLead = hScore > aScore;
    // A score that just went up pulses once. Only within the same game: a new game's
    // first bug is not a run.
    const same = prev && prev.away === sb.away && prev.home === sb.home;
    const aBump = same && aScore > (prev.awayScore | 0) ? ' bump' : '';
    const hBump = same && hScore > (prev.homeScore | 0) ? ' bump' : '';

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
    // The half of the inning as an arrow, the way a bug writes it: TOP 7TH is ▲ 7TH.
    const half = /^(TOP|BOT)\s+(.+)$/i.exec(sb.status || '');
    const status = half
      ? `<span class="tv-sb-half ${half[1].toLowerCase()}" aria-label="${half[1].toUpperCase() === 'TOP' ? 'top' : 'bottom'}"></span>${_esc(half[2])}`
      : _esc(sb.status || '');
    const sport = sb.sport === 'hockey' ? 'hockey' : 'baseball';
    const row = (name, abbr, score, lead, bump) =>
      `<div class="tv-sb-row ${lead ? 'lead' : ''}"><span class="tv-sb-chip" style="--chip:${_teamColour(name, sport)}"></span>` +
      `${_crest(name, 16, 'tv-sb-crest')}<span class="tv-sb-team">${abbr}</span><span class="tv-sb-num${bump}">${score}</span></div>`;
    const tag = _networkTag();
    host.classList.toggle('tv-sb-net', !!tag);
    host.innerHTML =
      (tag ? `<div class="tv-sb-top">${tag}${brand}</div>` : brand) +
      `<div class="tv-sb-body">` +
        `<div class="tv-sb-scores">` + row(sb.away, away, aScore, aLead, aBump) + row(sb.home, home, hScore, hLead, hBump) + `</div>` +
        `<div class="tv-sb-state">${diamond}${strength}${rivalChip}<div class="tv-sb-status">${status}</div>${outs}${sog}</div>` +
      `</div>`;
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
  // Async because the views load on demand (loadGamedayViews). Everything after the
  // await runs in one turn, so two calls can't both mount a view.
  async function _gamedayViewFor(gd, hostEl) {
    const { createGrandstandView, createRinkView } = await loadGamedayViews();
    const want = gd && gd.sport === 'hockey' ? 'hockey' : 'baseball';
    if (_gamedayView && _gamedaySport === want) return _gamedayView;
    _gamedayView?.clear();
    _gamedaySport = want;
    _gamedayView = want === 'hockey' ? createRinkView(hostEl) : createGrandstandView(hostEl, { station: _networkLabel() || _stationName });
    return _gamedayView;
  }

  // The toggle wears the sport it would open. A baseball is a lie on a hockey night —
  // and the button is the only affordance telling a viewer the sub-screen exists at
  // all, so it has to name the right game. The puck is the league's own mark, which
  // is a disc with one line struck through it, so the button and everything else in
  // the CPhL presentation come from the same drawing.
  function _brandGamedayBtn(sport) {
    const btn = el('gameday-btn');
    if (!btn || btn.dataset.sport === sport) return;
    btn.dataset.sport = sport;
    if (sport === 'hockey') {
      btn.innerHTML = cphlMark('15px');
      btn.title = 'Rinkside: live play on the ice';
      btn.setAttribute('aria-label', 'Rinkside view');
    } else {
      btn.innerHTML = '&#x26BE;';
      btn.title = 'Gameday: animated play-by-play';
      btn.setAttribute('aria-label', 'Gameday view');
    }
  }

  function _handleGameday(gd) {
    _lastGameday = gd;
    const btn = el('gameday-btn');
    if (btn) btn.classList.add('avail');
    _brandGamedayBtn(gd && gd.sport === 'hockey' ? 'hockey' : 'baseball');
    loadGamedayViews().catch(() => { /* retried when the button is pressed */ });
    // On the visual rung the game opens by itself; the other rungs keep it behind the button.
    const rung = state.player?.displayRung;
    if (!_gamedayOpen && !_gamedayDismissed && _tvOpen && (!rung || rung === 'visual')) { _toggleGameday(); return; }
    if (_gamedayOpen) {
      _gamedayViewFor(gd, el('gameday'))
        .then((view) => { if (_gamedayOpen && _lastGameday === gd) view.apply(gd); })
        .catch((err) => console.error('[tv] gameday view failed to load:', err));
    }
  }

  function _toggleGameday() {
    const host = el('gameday');
    const btn = el('gameday-btn');
    if (!host) return;
    _gamedayOpen = !_gamedayOpen;
    if (!_gamedayOpen) _gamedayDismissed = true;
    host.classList.toggle('on', _gamedayOpen);
    btn?.classList.toggle('on', _gamedayOpen);
    if (_gamedayOpen) {
      _gamedayViewFor(_lastGameday, host).then((view) => {
        if (!_gamedayOpen) return;   // closed again while the views loaded
        if (_lastGameday) view.apply(_lastGameday);
        else view.showIdle();   // opened before a play arrived — never blank
      }).catch((err) => {
        // A failed chunk (a deploy mid-session, a dropped connection) must not leave
        // the sub-screen open and blank with nothing said.
        console.error('[tv] gameday view failed to load:', err);
      });
    }
  }

  // Drop the whole sub-screen — on a channel change or close, so a stale game never
  // lingers. Hides the toggle until the next sports broadcast reveals it again.
  function _clearGameday() {
    _gamedayOpen = false;
    _gamedayDismissed = false;
    _lastGameday = null;
    _gamedayView?.clear();
    _gamedayView = null; _gamedaySport = null;   // next sport mounts its own view
    el('gameday')?.classList.remove('on');
    el('gameday-btn')?.classList.remove('on', 'avail');
    // Forget which sport branded it, so the next broadcast re-marks the button rather
    // than inheriting the last one's — a hockey puck over a ballgame is the same lie
    // in the other direction.
    const btn = el('gameday-btn');
    if (btn) delete btn.dataset.sport;
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
      host.innerHTML = '<div class="tv-sched-empty">The set is off, tune to a channel first.</div>';
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

  // ── Tape deck strip (the deck ABSORBED into the set) ──────────────────────
  // A consumer tape player standing under this television is no longer listed in
  // the room pane — plugins/broadcast absorbs it into the set and pushes it here
  // as `tv_deck`, so the way you reach it is the set's own display.
  //
  // Reduced on purpose: what's loaded, what's on the shelf, eject, load, and the
  // one button that answers the classic VCR question — put the set on the deck's
  // own channel so the tape is actually visible. The full chassis (schedule, cam
  // input, pirate console) stays behind `use <deck>`.
  //
  // THE STRIP DECIDES NOTHING. Every control sends a verb string the player could
  // have typed; the server answers with a fresh `tv_deck` and this redraws.
  function renderDeck(msg) {
    _deckData = msg?.deck || null;
    el('deck-btn')?.classList.toggle('avail', !!_deckData);
    if (!_deckData) { _clearDeck(); return; }
    if (_deckOpen) _drawDeck();
  }

  function _toggleDeck() {
    const host = el('deck');
    if (!host || !_deckData) return;
    _deckOpen = !_deckOpen;
    host.classList.toggle('on', _deckOpen);
    el('deck-btn')?.classList.toggle('on', _deckOpen);
    if (_deckOpen) _drawDeck();
    else host.innerHTML = '';
  }

  function _clearDeck() {
    _deckOpen = false;
    const host = el('deck');
    if (host) { host.classList.remove('on'); host.innerHTML = ''; }
    el('deck-btn')?.classList.remove('on');
  }

  function _drawDeck() {
    const host = el('deck');
    const d = _deckData;
    if (!host || !d) return;
    const active = (d.cassettes || []).find(c => c.id === d.activeCassetteId) || null;
    const status = d.camLabel
      ? `CAM · ${_esc(d.camLabel)}`
      : d.playing ? 'PLAYING' : (d.whyNot ? `IDLE: ${_esc(d.whyNot)}` : 'IDLE');
    const shelf = (d.cassettes || []).map(c =>
      `<button class="tv-deck-row${c.id === d.activeCassetteId ? ' on' : ''}" data-deck="select" data-id="${_esc(c.id)}">${c.id === d.activeCassetteId ? '▶' : '▪'} ${_esc(c.name)}</button>`
    ).join('') || '<div class="tv-sched-empty">Nothing on the shelf.</div>';
    const carry = (d.carrying || []).map(c =>
      `<button class="tv-deck-row" data-deck="load" data-name="${_esc(c.name)}">⇥ ${_esc(c.name)}</button>`
    ).join('');
    // The loaded tape is ALREADY the ▶ row in the shelf list, highlighted — printing
    // it above the list as well just said the same title twice in a row. Keep the
    // line only when it carries something the shelf can't: an empty deck, or a tape
    // that isn't on this shelf (a locked deck draws no list at all).
    const shelfShowsActive = !!active && !d.locked;
    const loadedLine = shelfShowsActive
      ? ''
      : `<div class="tv-deck-loaded">${active ? `▶ ${_esc(active.name)}` : 'No tape loaded.'}</div>`;
    const controls = d.locked
      ? '<div class="tv-sched-empty">Its controls don’t answer to you.</div>'
      : `<div class="tv-deck-list">${shelf}</div>
         ${carry ? `<div class="tv-deck-sub">Carrying</div><div class="tv-deck-list">${carry}</div>` : ''}
         <div class="tv-deck-btns">
           <button data-deck="eject"${active ? '' : ' disabled'}>EJECT</button>
           ${d.specter ? `<button data-deck="patch">${d.camLabel ? 'UNPATCH' : 'PATCH CAM'}</button>` : ''}
           ${d.deckChannel != null ? `<button data-deck="tune">WATCH TAPE · CH ${d.deckChannel}</button>` : ''}
         </div>`;
    host.innerHTML = `
      <div class="tv-deck-head">
        <span class="tv-deck-name">${_esc(d.brand || d.deckName || 'TAPE DECK')}</span>
        <span class="tv-deck-status">${status}</span>
      </div>
      ${loadedLine}
      ${controls}`;
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
    // Same table, two leagues. A hockey club's record carries its overtime losses and
    // it is RANKED on points, so printing a run differential in the last column would
    // read as a mis-sorted table — the eye takes the last number as the reason for the
    // order. Baseball keeps W-L / PCT / RD exactly as it was.
    const hockey = data.sport === 'hockey';
    const body = rows.length
      ? rows.map((r, i) => {
          const rd = (r.rd > 0 ? '+' : '') + (Number.isFinite(r.rd) ? r.rd : 0);
          const gp = (r.wins || 0) + (r.losses || 0) + (r.otl || 0);
          const pct = (r.wins + r.losses) ? (r.wins / (r.wins + r.losses)) : 0;
          return `<div class="tv-stp-row${i === 0 ? ' lead' : ''}">` +
            `<span class="tv-stp-rank">${i + 1}</span>` +
            `<span class="tv-stp-team">${_crest(r.team, 18, 'tv-stp-crest')}${_esc(r.team)}</span>` +
            `<span class="tv-stp-rec">${hockey ? `${r.wins}-${r.losses}-${r.otl || 0}` : `${r.wins}-${r.losses}`}</span>` +
            `<span class="tv-stp-pct">${hockey ? gp : pct.toFixed(3).replace(/^0/, '')}</span>` +
            `<span class="tv-stp-rd">${hockey ? (r.points || 0) : rd}</span>` +
          `</div>`;
        }).join('')
      : '<div class="tv-sched-empty">No games played yet this season.</div>';
    host.innerHTML =
      `<div class="tv-sched-head"><span class="tv-sched-title">${_esc(data.title || 'STANDINGS')}</span></div>` +
      `<div class="tv-stp-row tv-stp-hdr"><span class="tv-stp-rank">#</span><span class="tv-stp-team">TEAM</span>` +
        `<span class="tv-stp-rec">${hockey ? 'W-L-OTL' : 'W-L'}</span><span class="tv-stp-pct">${hockey ? 'GP' : 'PCT'}</span>` +
        `<span class="tv-stp-rd">${hockey ? 'PTS' : 'RD'}</span></div>` +
      `<div class="tv-stp-list">${body}</div>` +
      `<div class="tv-sched-foot">${data.phase === 'worldseries'
        ? `${_esc(data.final || (hockey ? 'Coldwater Cup' : 'Curtain Call'))}: winner takes the season.`
        : (hockey ? 'Two points for a win, one for losing past sixty.' : 'Run differential over the season to date.')}</div>`;
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
        // Day-specific shows sit inline with the everyday grid — one running order,
        // the way it airs — and are told apart by colour plus their day tag.
        const weekly = sl.everyday === false;
        const tag = weekly && sl.dayTag ? `<span class="tv-sched-day">${_esc(sl.dayTag)}</span>` : '';
        return `<div class="tv-sched-row${sl.onNow ? ' now' : ''}${weekly ? ' weekly' : ''}">` +
          `<span class="tv-sched-when">${when}</span>` +
          `<span class="tv-sched-name">${_esc(sl.name)}${tag}</span>` +
          `<span class="tv-sched-dur">${dur}</span>` +
        `</div>`;
      }).join('');
    }
    const title = _esc(data.stationName || 'Schedule') + (data.channelNumber ? ` · CH ${data.channelNumber}` : '');
    const anyWeekly = slots.some(sl => sl.everyday === false);
    const day = data.dayLabel ? `${_esc(data.dayLabel)}${data.dateLabel ? ` ${_esc(data.dateLabel)}` : ''}` : '';
    const foot = daily
      ? (anyWeekly ? 'In-world local time. <span class="tv-sched-key">Highlighted</span> shows air only on the days marked.'
                   : 'In-world local time. Everything here airs every day.')
      : 'This channel runs on a loop.';
    host.innerHTML =
      `<div class="tv-sched-head">` +
        `<span class="tv-sched-title">${title}</span>` +
        `<span class="tv-sched-clock">&#x1F552; ${_esc(data.nowLabel || '')}</span>` +
      `</div>` +
      (day ? `<div class="tv-sched-day-head">Today &mdash; ${day}</div>` : '') +
      `<div class="tv-sched-list">${rows}</div>` +
      `<div class="tv-sched-foot">${foot}</div>`;
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
        _crest(r.team, 16, 'tv-st-crest') +
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
          (_crest(fx.team, 56, 'tv-fx-club') ? `<div class="tv-fx-brand">${_crest(fx.team, 56, 'tv-fx-club')}</div>` : '') +
          `<div class="tv-fx-hr-title${fx.grand ? ' grand' : ''}">${fx.grand ? 'GRAND SLAM' : 'HOME RUN'}</div>` +
          (sub ? `<div class="tv-fx-hr-sub">${_esc(sub)}</div>` : '') +
        `</div>`;
    } else if (fx.kind === 'gamewin') {
      inner =
        `<div class="tv-fx-final">` +
          (_crest(fx.winner, 96, 'tv-fx-club') ? `<div class="tv-fx-brand big">${_crest(fx.winner, 96, 'tv-fx-club')}</div>` : '') +
          `<div class="tv-fx-final-label">${fx.extras ? `FINAL · ${_esc(fx.inningOrd || '')}` : 'FINAL'}</div>` +
          `<div class="tv-fx-final-card">` +
            `<div class="tv-fx-final-row win"><span class="nm">${_crest(fx.winner, 26, 'tv-fx-row-crest')}${_esc(fx.winner)}</span><span class="sc">${fx.winScore}</span></div>` +
            `<div class="tv-fx-final-row"><span class="nm">${_crest(fx.loser, 26, 'tv-fx-row-crest')}${_esc(fx.loser)}</span><span class="sc">${fx.loseScore}</span></div>` +
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
      const score = (fx.home != null) ? `${_esc(fx.home)} ${fx.homeScore}: ${fx.awayScore} ${_esc(fx.away)}` : '';
      inner =
        `<div class="tv-fx-walkoff">` +
          `<div class="tv-fx-wo-rays"></div>` +
          (_crest(fx.team, 64, 'tv-fx-club') ? `<div class="tv-fx-brand">${_crest(fx.team, 64, 'tv-fx-club')}</div>` : '') +
          `<div class="tv-fx-wo-title">WALK-OFF!</div>` +
          (sub ? `<div class="tv-fx-wo-sub">${_esc(sub)}</div>` : '') +
          (score ? `<div class="tv-fx-wo-score">${score}</div>` : '') +
        `</div>`;
    } else if (fx.kind === 'matchup') {
      const rec = (r) => r && r !== '0-0' ? `<span class="rec">${_esc(r)}</span>` : '';
      // A branded show puts its lockup on the card; any other writes its own name as a
      // wordmark under the line, in the network's display face.
      inner =
        `<div class="tv-fx-matchup${fx.brand === 'cphl' ? ' cphl' : ''}">` +
          (fx.brand === 'cphl'
            ? cphlLockup('Tonight in the CPhL', '34px')
            : `<div class="tv-fx-mu-label">Tonight on</div><div class="tv-fx-mu-show">${_esc(fx.show || 'DEADBALL')}</div>`) +
          `<div class="tv-fx-mu-teams">` +
            `<div class="tv-fx-mu-team away">${_crest(fx.away, 72, 'tv-fx-mu-crest')}<span class="nm">${_esc(fx.away)}</span>${rec(fx.awayRecord)}</div>` +
            `<div class="tv-fx-mu-vs">vs</div>` +
            `<div class="tv-fx-mu-team home">${_crest(fx.home, 72, 'tv-fx-mu-crest')}<span class="nm">${_esc(fx.home)}</span>${rec(fx.homeRecord)}</div>` +
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
          `<div class="tv-fx-brand">${_crest(fx.team, 64, 'tv-fx-club') || cphlMark('26px')}</div>` +
          `<div class="tv-fx-goal-title${fx.hattrick ? ' hat' : ''}">${fx.hattrick ? 'HAT TRICK' : 'GOAL'}</div>` +
          (tag ? `<div class="tv-fx-goal-tag">${tag}</div>` : '') +
          (sub ? `<div class="tv-fx-goal-sub">${_esc(sub)}</div>` : '') +
          `<div class="tv-fx-goal-score">${_esc(fx.away)} ${fx.awayScore}: ${fx.homeScore} ${_esc(fx.home)}</div>` +
        `</div>`;
    } else if (fx.kind === 'hockeyfight') {
      inner =
        `<div class="tv-fx-fight">` +
          `<div class="tv-fx-brand">${_crest(fx.team, 56, 'tv-fx-club') || cphlMark('26px')}</div>` +
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
            `<div class="tv-fx-mu-team away">${_crest(fx.away, 72, 'tv-fx-mu-crest')}<span class="nm">${_esc(fx.away)}</span>${rec(fx.awayRecord)}</div>` +
            `<div class="tv-fx-mu-vs">vs</div>` +
            `<div class="tv-fx-mu-team home">${_crest(fx.home, 72, 'tv-fx-mu-crest')}<span class="nm">${_esc(fx.home)}</span>${rec(fx.homeRecord)}</div>` +
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
            `<div class="tv-fx-mu-team away">${_crest(fx.away, 72, 'tv-fx-mu-crest')}<span class="nm">${_esc(fx.away)}</span>${rec(fx.awayRecord)}</div>` +
            `<div class="tv-fx-mu-vs">vs</div>` +
            `<div class="tv-fx-mu-team home">${_crest(fx.home, 72, 'tv-fx-mu-crest')}<span class="nm">${_esc(fx.home)}</span>${rec(fx.homeRecord)}</div>` +
          `</div>` +
        `</div>`;
    } else if (fx.kind === 'live') {
      // the first line of a game, on a set without the sub-screen: LIVE from the park
      inner =
        `<div class="tv-fx-live${fx.brand === 'cphl' ? ' cphl' : ''}${fx.final ? ' final' : ''}">` +
          (fx.brand === 'cphl' ? `<div class="tv-fx-brand">${cphlMark('30px')}</div>` : '') +
          `<div class="tv-fx-live-tag"><i></i>LIVE</div>` +
          `<div class="tv-fx-live-from">from</div>` +
          `<div class="tv-fx-live-venue">${_esc(fx.venue || '')}</div>` +
          (fx.final ? `<div class="tv-fx-live-sub">${_esc(fx.final)}</div>` : '') +
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
          `<div class="tv-fx-ws-banner">${_esc(String(fx.final || 'Curtain Call').toUpperCase())}</div>` +
          `<div class="tv-fx-ws-sub">Winner Takes the Season</div>` +
          `<div class="tv-fx-mu-teams">` +
            `<div class="tv-fx-mu-team away">${_crest(fx.away, 72, 'tv-fx-mu-crest')}<span class="nm">${_esc(fx.away)}</span>${rec(fx.awayRecord)}</div>` +
            `<div class="tv-fx-mu-vs">vs</div>` +
            `<div class="tv-fx-mu-team home">${_crest(fx.home, 72, 'tv-fx-mu-crest')}<span class="nm">${_esc(fx.home)}</span>${rec(fx.homeRecord)}</div>` +
          `</div>` +
        `</div>`;
    } else if (fx.kind === 'champion') {
      inner =
        `<div class="tv-fx-champ">` +
          `<div class="tv-fx-champ-rays"></div>` +
          // the champions' own logo where the club has one, the trophy where it hasn't
          `<div class="tv-fx-champ-trophy">${_crest(fx.winner, 128, 'tv-fx-champ-crest') || '🏆'}</div>` +
          `<div class="tv-fx-champ-team">${_esc(fx.winner)}</div>` +
          `<div class="tv-fx-champ-label">${_esc(fx.label || 'Champions')}</div>` +
          `<div class="tv-fx-champ-score">${_esc(fx.winner)} ${fx.winScore}: ${fx.loseScore} ${_esc(fx.loser)}</div>` +
        `</div>`;
    } else return;
    // every card goes up under the network's tag, as everything on a sports desk does
    const tag = _networkTag();
    host.innerHTML = (tag ? `<div class="tv-fx-net">${tag}</div>` : '') + inner;
    host.className = `tv-fx-host on fx-${fx.kind}`;
    _pregameUp = false;
    if (_fxTimer) clearTimeout(_fxTimer);
    _fxTimer = setTimeout(_clearSportsFx, (fx.duration || 3.5) * 1000);
  }

  // ── the pregame open ──────────────────────────────────────────────────────
  // From the top of a game to the first pitch or the drop: tonight's two clubs, the league
  // table with them picked out, and the booth's lines along the bottom as a caption strip.
  // Graphical on the visual rung; on 'textgames' the same open is drawn in characters. The
  // 'log' rung never gets here: the server writes the open to the log (pregameLines).
  function _applyPregame(fx) {
    const host = el('fx');
    if (!host) return;
    const rung = state.player?.displayRung;
    const text = rung === 'textgames' || rung === 'log';
    const hockey = fx.sport === 'hockey';
    const playing = new Set([fx.away?.name, fx.home?.name]);
    const rec = (r) => hockey ? `${r.wins}-${r.losses}-${r.otl || 0}` : `${r.wins}-${r.losses}`;
    const pts = (r) => hockey ? String(r.points || 0) : ((r.rd > 0 ? '+' : '') + (r.rd || 0));
    const rows = Array.isArray(fx.rows) ? fx.rows : [];
    const ord = (n) => { const v = n % 100; return n + ((v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); };
    const said = (t) => t?.record && /[1-9]/.test(t.record) ? t.record : 'no record yet';
    const place = (t) => t?.rank && rows.length && /[1-9]/.test(t.record || '') ? `${ord(t.rank)} in the league` : '';
    let inner;
    if (text) {
      const pad = (v, n) => String(v).slice(0, n).padEnd(n);
      const side = (t) => `${pad(t?.name || '', 22)} ${pad(said(t), 14)} ${place(t)}`;
      const lines = [
        `== ${fx.show || 'TONIGHT'} : PREGAME ==`,
        '',
        `AWAY  ${side(fx.away)}`,
        `HOME  ${side(fx.home)}`,
        '',
        fx.title || 'STANDINGS',
        `     ${pad('CLUB', 22)} ${pad(hockey ? 'W-L-OTL' : 'W-L', 9)} ${hockey ? 'PTS' : 'RD'}`,
        ...rows.map(r => `${playing.has(r.team) ? '>' : ' '}${String(r.rank).padStart(2)}.  ${pad(r.team, 22)} ${pad(rec(r), 9)} ${pts(r)}`),
      ];
      inner =
        `<div class="tv-pg tv-pg-text">` +
          `<pre class="tv-pg-pre">${_esc(lines.join('\n'))}</pre>` +
          `<div class="tv-pg-caption" aria-live="off"></div>` +
        `</div>`;
    } else {
      const card = (t, where) =>
        `<div class="tv-pg-club ${where}">` +
          (_crest(t?.name, 64, 'tv-pg-crest') || '') +
          `<div class="tv-pg-club-txt">` +
            `<div class="tv-pg-where">${where === 'away' ? 'Away' : 'Home'}</div>` +
            `<div class="tv-pg-nm">${_esc(t?.name || '')}</div>` +
            `<div class="tv-pg-rec">${_esc(said(t))}${place(t) ? ` <span>${_esc(place(t))}</span>` : ''}</div>` +
          `</div>` +
        `</div>`;
      const table = rows.length
        ? `<div class="tv-pg-table">` +
            `<div class="tv-pg-th"><span>${_esc(String(fx.title || 'STANDINGS').replace(/^.*:\s*/, ''))}</span><b>${hockey ? 'W-L-OTL' : 'W-L'}</b><b>${hockey ? 'PTS' : 'RD'}</b></div>` +
            rows.map((r, i) =>
              `<div class="tv-pg-row${playing.has(r.team) ? ' on' : ''}" style="animation-delay:${(0.5 + i * 0.07).toFixed(2)}s">` +
                `<i>${r.rank}</i><span class="chip" style="background:${_teamColour(r.team, fx.sport)}"></span>` +
                `<span class="nm">${_esc(r.team)}</span><b>${_esc(rec(r))}</b><b>${_esc(pts(r))}</b>` +
              `</div>`).join('') +
          `</div>`
        : `<div class="tv-pg-table empty">Opening night. Nobody has a record yet.</div>`;
      inner =
        `<div class="tv-pg${fx.brand === 'cphl' ? ' cphl' : ''}">` +
          `<div class="tv-pg-head">` +
            (fx.brand === 'cphl' ? cphlLockup('Pregame', '22px') : `<div class="tv-pg-show">${_esc(fx.show || 'TONIGHT')}</div><div class="tv-pg-label">Pregame</div>`) +
          `</div>` +
          `<div class="tv-pg-body">` +
            `<div class="tv-pg-clubs">${card(fx.away, 'away')}<div class="tv-pg-at">at</div>${card(fx.home, 'home')}</div>` +
            table +
          `</div>` +
          `<div class="tv-pg-caption" aria-live="off"></div>` +
        `</div>`;
    }
    const tag = text ? '' : _networkTag();
    host.innerHTML = (tag ? `<div class="tv-fx-net">${tag}</div>` : '') + inner;
    host.className = 'tv-fx-host on fx-pregame';
    _pregameUp = true;
    // The line that brought the open up is already on screen; carry it into the strip.
    if (_lastSpoken && performance.now() - _lastSpoken.at < 4000) _pregameCaption(_lastSpoken.text);
    if (_fxTimer) clearTimeout(_fxTimer);
    _fxTimer = setTimeout(_clearSportsFx, (fx.duration || 18) * 1000);
  }

  // ── the final's package ───────────────────────────────────────────────────
  // Before the first pitch of the Curtain Call or the drop of the Coldwater Cup, three pages about
  // the two clubs, each up while the booth reads it (plugins/broadcast/sports/final-package.js):
  // the tale of the tape, the road here, the men to watch. Drawn like the pregame open, in gold,
  // with the booth along the bottom; in characters on 'textgames'. The log rung gets it written out
  // by the server (packageLines).
  function _applyPackage(fx) {
    const host = el('fx');
    if (!host || !fx?.away || !fx?.home) return;
    const rung = state.player?.displayRung;
    const text = rung === 'textgames' || rung === 'log';
    const hockey = fx.sport === 'hockey', cphl = fx.brand === 'cphl';
    const ord = (n) => { const v = n % 100; return n + ((v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); };
    const sgn = (n) => (n > 0 ? `+${n}` : String(n | 0));
    const A = fx.away, H = fx.home;
    const title = { tape: 'Tale of the Tape', road: 'The Road Here', watch: 'Players to Watch' }[fx.page] || '';
    // the tape's rows: what each club brings, the label between them
    const tape = () => [
      ['From', A.home || '', H.home || ''],
      ...(A.founded || H.founded ? [['Founded', A.founded || '', H.founded || '']] : []),
      ['Seed', A.seed ? ord(A.seed) : '', H.seed ? ord(H.seed) : ''],
      [hockey ? 'W-L-OTL' : 'W-L', A.record || '', H.record || ''],
      ['Place', A.rank ? ord(A.rank) : '', H.rank ? ord(H.rank) : ''],
      hockey ? ['Points', A.points ?? '', H.points ?? ''] : ['Pct', A.pct || '', H.pct || ''],
      [hockey ? 'Goals for' : 'Runs for', A.for ?? '', H.for ?? ''],
      [hockey ? 'Goals against' : 'Runs against', A.against ?? '', H.against ?? ''],
      [hockey ? 'Goal diff' : 'Run diff', sgn(A.diff), sgn(H.diff)],
    ];
    const streak = (s) => (s ? `${s.kind}${s.n}` : '');
    const ser = fx.series || {};
    let inner;
    if (text) {
      const pad = (v, n) => String(v).slice(0, n).padEnd(n), padL = (v, n) => String(v).slice(0, n).padStart(n);
      const lines = [`== ${String(fx.final || '').toUpperCase()} : ${title.toUpperCase()} ==`, '', `${padL(A.name, 24)}  ${pad('', 12)}  ${H.name}`];
      if (fx.page === 'tape') for (const [k, a, h] of tape()) lines.push(`${padL(a, 24)}  ${pad(k, 12)}  ${h}`);
      if (fx.page === 'road') {
        lines.push(`${padL(A.last.join(' '), 24)}  ${pad('Last 10', 12)}  ${H.last.join(' ')}`, `${padL(A.lastRec, 24)}  ${pad('Record', 12)}  ${H.lastRec}`, `${padL(streak(A.streak), 24)}  ${pad('Streak', 12)}  ${streak(H.streak)}`,
          '', `Season series: ${A.name} ${ser.away | 0}, ${H.name} ${ser.home | 0}`, ...(ser.games || []).map((g) => `  ${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}${g.ot ? ' (OT)' : ''}`));
      }
      if (fx.page === 'watch') for (const c of [A, H]) lines.push('', c.name, ...(c.men || []).map((m) => `  ${pad(m.role, 4)}${pad(m.name, 22)} ${m.stat}`), ...(c.out?.length ? [`  Out: ${c.out.join(', ')}`] : []));
      inner = `<div class="tv-pg tv-pg-text"><pre class="tv-pg-pre">${_esc(lines.join('\n'))}</pre><div class="tv-pg-caption" aria-live="off"></div></div>`;
    } else {
      const head = (c, side) =>
        `<div class="tv-pk-club ${side}" style="--club:${_teamColour(c.name, fx.sport)}">` +
          (_crest(c.name, 56, 'tv-pg-crest') || '') + `<span class="tv-pk-nm">${_esc(c.name)}</span>` +
        `</div>`;
      let body = '';
      if (fx.page === 'tape') {
        body = `<div class="tv-pk-tape">` + tape().map(([k, a, h], i) =>
          `<div class="tv-pk-row" style="animation-delay:${(0.45 + i * 0.08).toFixed(2)}s"><b>${_esc(String(a))}</b><i>${_esc(k)}</i><b>${_esc(String(h))}</b></div>`).join('') + `</div>`;
      } else if (fx.page === 'road') {
        const pips = (c) => `<span class="tv-pk-pips">${(c.last || []).map((r) => `<span class="tv-pk-pip ${r === 'W' ? 'w' : r === 'O' ? 'o' : 'l'}">${r}</span>`).join('')}</span>`;
        const games = (ser.games || []).map((g) =>
          `<div class="tv-pk-game"><span${g.winner === g.away ? ' class="win"' : ''}>${_esc(g.away)} ${g.awayScore | 0}</span><span${g.winner === g.home ? ' class="win"' : ''}>${_esc(g.home)} ${g.homeScore | 0}</span>${g.ot ? '<em>OT</em>' : ''}</div>`).join('');
        body = `<div class="tv-pk-tape">` +
            `<div class="tv-pk-row wide" style="animation-delay:0.45s">${pips(A)}<i>Last ${Math.max(A.last?.length || 0, H.last?.length || 0) || 10}</i>${pips(H)}</div>` +
            `<div class="tv-pk-row" style="animation-delay:0.55s"><b>${_esc(A.lastRec || '')}</b><i>Record</i><b>${_esc(H.lastRec || '')}</b></div>` +
            `<div class="tv-pk-row" style="animation-delay:0.65s"><b>${_esc(streak(A.streak))}</b><i>Streak</i><b>${_esc(streak(H.streak))}</b></div>` +
            `<div class="tv-pk-row" style="animation-delay:0.75s"><b class="big">${ser.away | 0}</b><i>Season series</i><b class="big">${ser.home | 0}</b></div>` +
          `</div>` + (games ? `<div class="tv-pk-games">${games}</div>` : `<div class="tv-pk-games none">They never met this season.</div>`);
      } else {
        const men = (c, side) => `<div class="tv-pk-men ${side}">` + (c.men || []).map((m, i) =>
          `<div class="tv-pk-man" style="animation-delay:${(0.45 + i * 0.12).toFixed(2)}s"><span class="role">${_esc(m.role)}</span><span class="nm">${_esc(m.name)}</span><span class="st">${_esc(m.stat)}</span></div>`).join('') +
          (c.out?.length ? `<div class="tv-pk-out">Out: ${_esc(c.out.join(', '))}</div>` : '') + `</div>`;
        body = `<div class="tv-pk-watch">${men(A, 'away')}${men(H, 'home')}</div>`;
      }
      inner =
        `<div class="tv-pg tv-pk${cphl ? ' cphl' : ''}">` +
          `<div class="tv-pg-head">` +
            (cphl ? cphlLockup(fx.final || 'Coldwater Cup', '22px') : `<div class="tv-pg-show">${_esc(String(fx.final || '').toUpperCase())}</div>`) +
            `<div class="tv-pg-label">${_esc(title)}</div>` +
          `</div>` +
          `<div class="tv-pk-heads">${head(A, 'away')}<span class="tv-pk-vs">vs</span>${head(H, 'home')}</div>` +
          `<div class="tv-pk-body">${body}</div>` +
          `<div class="tv-pg-caption" aria-live="off"></div>` +
        `</div>`;
    }
    const tag = text ? '' : _networkTag();
    // a new page keeps the strip's line, which the booth is still reading
    const said = el('fx')?.querySelector('.tv-pg-caption')?.textContent || '';
    host.innerHTML = (tag ? `<div class="tv-fx-net">${tag}</div>` : '') + inner;
    host.className = 'tv-fx-host on fx-pregame fx-package';
    _pregameUp = true;
    // each page goes up on the sting, in the key of the final's open
    const sting = fx.sting ? packageStingDef(fx.sting, cphl) : null;
    if (sting) window.AudioEngine?.playSfx(sting);
    if (_lastSpoken && performance.now() - _lastSpoken.at < 4000) _pregameCaption(_lastSpoken.text);
    else if (said) _pregameCaption(said);
    if (_fxTimer) clearTimeout(_fxTimer);
    _fxTimer = setTimeout(_clearSportsFx, (fx.duration || 30) * 1000);
  }

  function _pregameCaption(text) {
    if (!_pregameUp) return;
    const strip = el('fx')?.querySelector('.tv-pg-caption');
    if (!strip) return;
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    strip.textContent = t;
    strip.classList.remove('in');
    void strip.offsetWidth;   // restart the slide-in for each new line
    strip.classList.add('in');
  }

  function _clearSportsFx() {
    _pregameUp = false;
    if (_fxTimer) { clearTimeout(_fxTimer); _fxTimer = null; }
    const host = el('fx');
    if (host) { host.innerHTML = ''; host.className = 'tv-fx-host'; }
  }

  // ── tuning ────────────────────────────────────────────────────────────────
  function _tvTuneTo(num) {
    // A tune abandons the old channel's timeline outright — anything still queued
    // belongs to a programme you are no longer watching.
    window.AudioEngine?.cancelSpeech('tv'); _clearSpeech();
    _speechOwner = view;   // the surface being tuned takes the voice
    if (_sweepRaf) { cancelAnimationFrame(_sweepRaf); _sweepRaf = null; }
    _wheelTarget = null;
    _tvFrequency = num;
    _dialRaw = num;
    _updateKnobRotation();
    _tvPendingTune = num;
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

    if (dist < LOCK_RANGE && nearest.channelId !== _tvActiveChannelId && nearest.number !== _tvPendingTune) {
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
  // A spoken line is not DISPLAYED until the voice is free to read it. Previously
  // the caption appeared the moment the server sent it while the speech queued
  // behind whatever was still talking, so on any overrun the text ran ahead of the
  // voice. Now the whole message — caption and audio together — waits.
  //
  // With the voice OFF this must not apply at all: nothing is going to finish, so
  // lines fall straight through and pace on the server's own hold, exactly as they
  // always did. `_voiceLive` tracks whether the engine is actually producing sound
  // (it returns nothing when muted, disabled, or blocked by the browser's autoplay
  // policy), so a muted set never sits waiting on a voice that will never speak.
  function appendMessage(text, style, duration, hasGameday, catchUp, dl) {
    _deferredLast = false;
    const spoken = !style || style === 'raw' || style === 'emote' || style === 'narrate' || style === 'system';
    // catchUp is the beat already on air when you tuned in — deliberately shown but
    // not narrated, so it never waits on the voice.
    const holdForVoice = spoken && !catchUp && _readAloud && _voiceLive
      && (_speechQ.length || performance.now() < _busyUntil);
    // ORDER FIRST. Anything already waiting means this message must wait too, even a
    // title card that has nothing to say — otherwise the picture overtakes the line
    // it belongs to and a card appears before the dialogue that sets it up. A card
    // still on its own hold counts as something to wait for, whatever the voice is
    // doing: it isn't finished being looked at yet.
    if (holdForVoice || performance.now() < _cardUntil || _deliverQ.length) {
      _deliverQ.push({ text, style, duration, hasGameday, spoken, catchUp, dl, at: performance.now() });
      _deferredLast = spoken && !catchUp;
      _pumpDeliver();
      return;
    }
    _renderMessage(text, style, duration, hasGameday, dl);
    const cardMs = _cardHoldMs(style, duration);
    if (cardMs) _cardUntil = performance.now() + cardMs;
  }

  function _renderMessage(text, style, duration, hasGameday, dl) {
    const container = el('messages');
    if (!container) return;

    const isTitleCard = style === 'svg' || style === 'ascii_art' || style === 'credits';

    // Anything that isn't dialogue is a scene beat — a card, a ticker, an overlay.
    // That's the picture changing, so it's where drift would become visible and the
    // only place the speech queue is allowed to resync. See _sceneBeat().
    const spoken = !style || style === 'raw' || style === 'emote' || style === 'narrate' || style === 'system';
    if (!spoken) _sceneBeat();
    // The pregame open shows the booth's line along its bottom edge.
    if (spoken) {
      _lastSpoken = { text: new DOMParser().parseFromString(String(text), 'text/html').body.textContent, at: performance.now() };
      _pregameCaption(_lastSpoken.text);
    }

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
        const byHeight = availH / lines.length;   // 1.0 = the ascii line-height (block art tiles)
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
        // `hasGameday` is 'call' for a call whose play went out earlier on a line of the booth's
        // talk (Deadball's `lead` payload): held till it lands, or shown at once if it has.
        // the caption's tag names whoever's talking: a "Name says" line by that name (the view
        // splits it), anything else by the play-by-play man the broadcast says is on the mic
        if (plain) _gamedayView.setCaption(plain, { who: dl?.speaker, speak: () => _speakNow(text, style, duration, dl), held: !!hasGameday, ...(hasGameday === 'call' ? { call: true } : {}) });
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
    const next = name || '';
    // A card belongs to the show that raised it. A duration-0 card waits for its own
    // station to take it down, so when the next programme starts it has to come off
    // the glass — otherwise a bulletin's lower third hangs over the show after it.
    if (_programName !== null && next !== _programName) _clearOverlay();
    _programName = next;
    const pn = el('program-name');
    if (pn) pn.textContent = next;
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  function init() {
    if (_inited) return;
    _inited = true;

    // The sub-screens (Gameday, Rinkside) sit between the header and the footer, and
    // neither has a fixed height: both are in rem, and the phone layout shrinks the
    // footer. A fixed 45px and 72px left a band of the message list showing under
    // Rinkside on a phone and the header over its top at a large font, so the real
    // heights go on the window as --tv-head-h and --tv-foot-h.
    const winEl = el('window'), headEl = el('header'), footEl = el('footer');
    if (isCrt && winEl && headEl && footEl && typeof ResizeObserver === 'function') {
      const measure = () => {
        winEl.style.setProperty('--tv-head-h', `${headEl.offsetTop + headEl.offsetHeight}px`);
        winEl.style.setProperty('--tv-foot-h', `${Math.max(0, winEl.clientHeight - footEl.offsetTop)}px`);
      };
      const ro = new ResizeObserver(measure);
      ro.observe(headEl); ro.observe(footEl); ro.observe(winEl);
    }

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
      if (!_readAloud) { window.AudioEngine?.cancelSpeech('tv'); _clearSpeech(); }
      else _voiceLive = true;   // give the voice the benefit of the doubt again
    });

    // Gameday toggle: reveals the animated at-bat sub-screen. Hidden until a sports
    // broadcast sends its first `gameday` overlay (which adds `.avail`).
    el('gameday-btn')?.addEventListener('click', () => { if (_tvOpen) _toggleGameday(); });

    // TV guide toggle: shows the tuned channel's running order + in-world time.
    el('schedule-btn')?.addEventListener('click', () => { if (_tvOpen) _toggleSchedule(); });

    // Tape deck toggle: revealed (`.avail`) only when the server says a consumer
    // deck stands under this set. One delegated listener for the whole strip, so
    // a redraw never has to re-bind anything.
    el('deck-btn')?.addEventListener('click', () => { if (_tvOpen) _toggleDeck(); });
    el('deck')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-deck]');
      if (!b || !_deckData || b.disabled) return;
      const act = b.dataset.deck;
      if (act === 'select')     sendCmdSilent(`selectcassette ${b.dataset.id} tv`);
      else if (act === 'load')  sendCmdSilent(`load cassette ${b.dataset.name}`);
      else if (act === 'eject') sendCmdSilent('eject');
      // ONE verb both ways: bare `patch` pulls the jack when a feed is already in,
      // and otherwise answers with the player's own list of cameras as clickable
      // prose. The strip proposes; the verb decides which of those it was — this
      // is not the place to re-derive whether they own a camera.
      else if (act === 'patch') sendCmdSilent('patch');
      else if (act === 'tune' && _deckData.deckChannel != null) _tvTuneTo(_deckData.deckChannel);
    });

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

    // Pop-out: the whole set moves into a window of its own, so it can sit on a second
    // monitor. It's the same node, so every broadcast keeps rendering into it.
    const popBtn = el('popout-btn');
    if (popBtn) {
      if (typeof window.open !== 'function') popBtn.hidden = true;
      popBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_popWin) popIn(); else popOut();
      });
    }
    window.addEventListener('pagehide', () => { if (_popWin) _popWin.close(); });

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

    // Corner grips. The set keeps the shape of its picture, so only the width is set.
    makeCornerResizable(win, { key: 'tvSize', minW: 380, lockAspect: true });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _tvOpen) shutdown();
    });
  }

  let _popWin = null, _popHome = null;

  function popOut() {
    if (_popWin || !_tvOpen) return;
    const w = window.open('', 'architect-tv', 'popup,width=800,height=560');
    if (!w) {
      const btn = el('popout-btn');
      if (btn) btn.title = 'Pop-out blocked: allow pop-ups for this site';
      return;
    }
    const d = w.document;
    d.open();
    d.write('<!doctype html><html class="tv-popped"><head><meta charset="utf-8"><title>Architect TV</title></head><body></body></html>');
    d.close();
    // The same sheets as the game, including any a panel loaded at runtime.
    for (const n of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
      const c = n.cloneNode(true);
      if (c.href) c.href = n.href;
      d.head.appendChild(c);
    }
    // and the page's theme and density, which the sheets key off <html>
    for (const a of document.documentElement.attributes) d.documentElement.setAttribute(a.name, a.value);
    d.documentElement.classList.add('tv-popped');
    _popHome = { parent: root.parentNode, next: root.nextSibling };
    const win = el('window');
    if (win) { win.style.position = ''; win.style.left = ''; win.style.top = ''; win.style.margin = ''; }
    d.body.appendChild(d.adoptNode(root));
    _popWin = w;
    el('popout-btn')?.classList.add('on');
    el('popout-btn')?.setAttribute('title', 'Bring the TV back into the game');
    d.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && _tvOpen) shutdown(); });
    w.addEventListener('pagehide', () => { if (_popWin === w) popIn(); });
    w.focus();
  }

  function popIn() {
    const w = _popWin;
    if (!w) return;
    _popWin = null;
    if (_popHome?.parent) _popHome.parent.insertBefore(document.adoptNode(root), _popHome.next);
    _popHome = null;
    const btn = el('popout-btn');
    btn?.classList.remove('on');
    btn?.setAttribute('title', 'Pop out: watch in its own window');
    try { if (!w.closed) w.close(); } catch {}
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
    renderSchedule, renderStandings, renderDeck, speak, applyTheme, tunerInput, setProgramName,
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

// A surface that isn't a set but takes a channel's lines and overlays the same way: a seat in
// the stands (stands.js). It carries the same methods dispatch.js calls on a view.
export function addTvView(view) { _views.add(view); return () => _views.delete(view); }

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
export function appendTvMessage(t, s, d, g, c, x)  { panel()?.appendMessage(t, s, d, g, c, x); }
export function showTvOffAir(content, type)  { panel()?.showOffAir(content, type); }
export function renderTvDeck(data)           { panel()?.renderDeck(data); }
export function applyTvTheme(theme)          { panel()?.applyTheme(theme); }
export function tvTunerInput(val)            { panel()?.tunerInput(val); }
export function isTvOpen()                   { return !!panel()?.isOpen(); }
export function getTvActiveChannelId()       { return panel()?.activeChannelId() ?? null; }
export function initTvPanel()                { panel()?.init(); }
