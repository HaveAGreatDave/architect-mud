// Voice input — the mic button beside the command box.
//
// The thinking half of this feature is client/shared/dictation.js, which turns
// what a recognizer heard into a command; this file is the recognizer plumbing
// and the button. Off by default: `data-dictation="off"` on <html> (written by
// applySettings) hides the button in CSS, and nothing here starts until the
// player turns Voice Input on in Settings → Accessibility, or types
// `accessibility voice review`.
//
// Four things worth knowing before changing any of it.
//
//   • THE SUBMIT PATH IS THE ORDINARY ONE. A recognized command goes through
//     submitCommand() in input.js — the same function the Enter key calls — so
//     client verbs, macros, history and the auto-walk prompt behave identically
//     whether a command was typed or spoken. Dictation gets no command path of
//     its own, and must never grow one.
//
//   • INTERIM RESULTS NEVER REACH #output. They stream into the input box, where
//     you can watch them converge. #output is the one ARIA live region (see
//     docs/systems-display-mode.md) and streaming partials into it would make a
//     screen reader unusable — which would be a remarkable thing for an
//     accessibility feature to do.
//
//   • A GUARDED COMMAND IS NEVER AUTO-SENT, whatever the mode says. See
//     GUARDED_VERBS in the shared module for why.
//
//   • FAILURE IS ANNOUNCED. A denied mic permission is the commonest way this
//     "doesn't work", and it is invisible: the button just does nothing forever.
//     Every recognizer error prints a plain line.
import { normalizeDictation } from '/shared/dictation.js';
import { loadSettings } from '/shared/settings.js';
import { appendMsg } from './render.js';
import { submitCommand } from './input.js';
import { getEquipInventory } from './panels/inventory-state.js';

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function dictationSupported() { return !!SR; }

let recog = null;
let listening = false;
let mode = 'off';
let btn = null;
// A tap-to-toggle press and a hold-to-talk press are the same pointerdown; which
// one it was is only known when the pointer comes back up. Holding is painful
// for some of the people this exists for, and tapping is fiddly for others, so
// both work rather than one being chosen for them.
let holdTimer = 0;
let heldLongEnough = false;

// ── The live vocabulary ─────────────────────────────────────────────────────
//
// What the noun matcher gets to choose from. Assembled at each recognition, not
// cached, because the whole point is that it reflects the room you are standing
// in right now.
//
// Every source here is already on the page: the room pane and smartbar render
// literal commands into `data-cmd` attributes, and the inventory cache mirrors
// the last `inventory` payload. Nothing new is fetched and no round trip is
// added — a hot path in all but name, since this runs on every utterance.
function liveNouns() {
  const out = new Set();
  try {
    for (const el of document.querySelectorAll('[data-cmd]')) {
      const cmd = el.getAttribute('data-cmd') || '';
      const rest = cmd.split(/\s+/).slice(1).join(' ');
      if (rest) out.add(rest);
      const label = (el.textContent || '').trim();
      if (label && label.length < 40) out.add(label);
    }
  } catch { /* no DOM yet — the inventory half still works */ }
  for (const item of getEquipInventory() || []) if (item?.name) out.add(item.name);
  return [...out];
}

function setBtnState(on) {
  if (!btn) return;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.classList.toggle('listening', on);
  btn.title = on ? 'Listening — tap to stop' : 'Voice input (tap, or hold to talk)';
}

function ensureRecognizer() {
  if (recog || !SR) return recog;
  recog = new SR();
  recog.continuous = false;
  recog.interimResults = true;
  recog.maxAlternatives = 1;
  try { recog.lang = navigator.language || 'en-US'; } catch { recog.lang = 'en-US'; }

  recog.addEventListener('result', (e) => {
    const input = document.getElementById('cmd-input');
    if (!input) return;
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    // Interim: straight into the box, nowhere else (see the header).
    if (interim && !final) { input.value = interim; return; }
    if (!final) return;

    const { text, guarded, changed } = normalizeDictation(final, { nouns: liveNouns() });
    if (!text) { appendMsg('Nothing heard.', 'system'); return; }
    input.value = text;

    // Auto-send, minus the guard. The record reaches the log either way, so a
    // repair that went wrong is visible rather than mysterious — at the log rung
    // this line IS the feedback, since the input box is not announced.
    if (mode === 'send' && !guarded) {
      appendMsg(`Heard: ${text}`, 'system');
      input.value = '';
      submitCommand(text);
      return;
    }
    const why = guarded
      ? ' — press Enter to confirm (this one can cost you something).'
      : ' — press Enter to run it.';
    appendMsg(`Heard: ${text}${changed ? ` (from "${final.trim()}")` : ''}${why}`, 'system');
    input.focus();
  });

  recog.addEventListener('error', (e) => {
    const msg = {
      'not-allowed': 'Microphone blocked. Allow microphone access for this site in your browser settings, then try again.',
      'service-not-allowed': 'Speech recognition is not available in this browser session.',
      'no-speech': 'Did not hear anything.',
      'audio-capture': 'No microphone found.',
      network: 'Speech recognition could not reach its network service.',
      aborted: null,   // we stopped it on purpose
    }[e.error];
    if (msg) appendMsg(msg, 'system');
    listening = false;
    setBtnState(false);
  });

  recog.addEventListener('end', () => { listening = false; setBtnState(false); });
  return recog;
}

export function startDictation() {
  if (mode === 'off' || listening) return;
  const r = ensureRecognizer();
  if (!r) return;
  try {
    r.start();
    listening = true;
    setBtnState(true);
  } catch {
    // start() throws if the recognizer is already running — treat as a no-op
    // rather than an error the player has to read.
    listening = true;
    setBtnState(true);
  }
}

export function stopDictation() {
  if (!listening || !recog) return;
  try { recog.stop(); } catch { /* already stopped */ }
  listening = false;
  setBtnState(false);
}

export function toggleDictation() { listening ? stopDictation() : startDictation(); }

// applySettings calls this on every change, including the first one at boot.
export function setDictationMode(next) {
  mode = next || 'off';
  if (mode === 'off') stopDictation();
  // A browser with no SpeechRecognition keeps the button hidden whatever the
  // setting says. The option's own `why` text is where that is explained; a
  // button that cannot work is worse than no button.
  if (btn) btn.hidden = (mode === 'off' || !SR);
}

export function initDictation() {
  btn = document.getElementById('dictate-btn');
  if (!btn) return;
  setDictationMode(loadSettings().dictation);
  setBtnState(false);

  // Hold-to-talk: listening starts as soon as the press passes ~350ms, and
  // stops on release. A shorter press falls through to toggle on click.
  btn.addEventListener('pointerdown', () => {
    heldLongEnough = false;
    holdTimer = setTimeout(() => { heldLongEnough = true; startDictation(); }, 350);
  });
  const release = () => {
    clearTimeout(holdTimer);
    holdTimer = 0;
    if (heldLongEnough) { heldLongEnough = false; stopDictation(); }
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (heldLongEnough) { heldLongEnough = false; return; }  // the hold already handled it
    toggleDictation();
  });

  // Ctrl/Cmd+Shift+M, from anywhere including inside the command box. A chord
  // rather than a single key on purpose: the flight sim, the piano and WASD
  // movement each own the bare letter rows (see the owner list in input.js), and
  // a mic bound to a plain key would fight all three. Does nothing while Voice
  // Input is off, so it costs nobody anything.
  document.addEventListener('keydown', (e) => {
    if (mode === 'off') return;
    if (!e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
    if (e.key !== 'M' && e.key !== 'm') return;
    e.preventDefault();
    toggleDictation();
  });
}
