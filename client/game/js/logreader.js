// The log reader — the game read aloud.
//
// Off by default, and the default matters more here than anywhere else in the
// client. **A real screen reader is already reading `#output`**: it carries
// `role="log"`, which is the whole basis of the Display Mode `log` rung (see
// docs/systems-display-mode.md). Turning this on for someone running NVDA or
// VoiceOver would speak every line TWICE, in two voices, slightly out of step —
// which is not a small annoyance, it is unusable. So this ships off, the option
// says why in plain words, and nothing here ever turns itself on.
//
// Who it is for, then: people who do not run a screen reader but still want the
// game spoken. Low vision without a reader, dyslexia, fatigue, a long session
// where the eyes give out first, or hands-busy play. That is a real audience and
// it is not the same audience as the ARIA work.
//
// ── Two voices, and why the default is the boring one ───────────────────────
//
// NATURAL is the browser's own `speechSynthesis` — the platform voices, the same
// engine the OS reads with. Intelligible for hours, adjustable rate, no
// dependency on our synth being right about a word.
//
// IN-WORLD is the game's own formant synth (client/shared/audio-engine.js), the
// voice the broadcasts and NPCs use. It is a better fit for the fiction and a
// worse fit for a job of work: a formant synth is more effort to listen to, and
// after twenty minutes that effort is the whole experience.
//
// Natural is therefore the recommended setting and is listed first. In-world is
// offered because some players will want the game to sound like the game, and
// that is a legitimate thing to want — but the option text does not pretend the
// two are equivalent.
//
// ── The seam ────────────────────────────────────────────────────────────────
//
// A MutationObserver on `#output`, not a hook in appendMsg/appendHtml/appendPre.
// The log rung's promise is "if a system's record doesn't reach the log, that
// rung isn't done for it" — so the reader watches the LOG, and whatever put a
// line there is read, including panels that append directly. A hook in the three
// append helpers would silently miss the fourth caller the day somebody adds it.
// Relative, not the '/shared/…' form the browser also accepts, so this module can
// be imported and exercised in Node — same reason as a11y-command.js. The line
// filter below is the part that needs it: deciding what is prose and what is
// glyph art is real logic, and getting it wrong means either a minute of spoken
// punctuation or a silently swallowed message.
import { loadSettings } from '../../shared/settings.js';

let mode = 'off';          // off | natural | world
let rate = 1;
let queue = [];
let speaking = false;
let worldTimer = 0;

// A tick can dump a dozen lines at once (a combat round, a room look, a shop
// list). Reading all of them puts the voice minutes behind the game, which is
// worse than useless — you are being told about a fight that has finished. So
// the queue is capped and the OLDEST lines are dropped: what is happening now
// matters more than what happened eight lines ago, which is the opposite of how
// a queue usually ages.
const MAX_QUEUE = 8;

// What never gets read.
//
// `<pre>` is the big one: the minimap, the ASCII card faces, the chess board and
// the bounty poster are all pre-formatted glyph art. Read aloud they are a
// minute of punctuation names. They are already excluded from the log rung's
// job by having a written record elsewhere, and reading them here would bury the
// line that mattered.
export function readableText(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el.tagName === 'PRE' || el.querySelector?.('pre')) return '';
  if (el.getAttribute?.('aria-hidden') === 'true') return '';
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  // Glyph-art that isn't in a <pre> — a line that is mostly box-drawing or
  // block characters is a picture, whatever element it arrived in.
  const letters = text.replace(/[^A-Za-z0-9]/g, '').length;
  if (!text || letters < 2 || letters / text.length < 0.4) return '';
  return text;
}

function speakNatural(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.onend = u.onerror = () => { speaking = false; pump(); };
  speaking = true;
  try { window.speechSynthesis.speak(u); }
  catch { speaking = false; }
}

function speakWorld(text) {
  const eng = window.AudioEngine;
  if (!eng?.speak) { speaking = false; return; }
  // `channel: 'ui'` keeps the reader out from behind the TV toggle and off the
  // TV volume slider — see the note at speak() in audio-engine.js.
  //
  // The formant synth has no completion event, so the next line is scheduled off
  // the duration it hands back. That number is the REAL scheduled length rather
  // than an estimate from word count, which is exactly why it is returned.
  const res = eng.speak(text, { channel: 'ui', seed: 'reader' });
  speaking = true;
  const ms = ((res && res.duration) || 1.5) * 1000 / rate + 120;
  clearTimeout(worldTimer);
  worldTimer = setTimeout(() => { speaking = false; pump(); }, ms);
}

function pump() {
  if (speaking || mode === 'off' || !queue.length) return;
  const text = queue.shift();
  if (mode === 'natural') speakNatural(text);
  else speakWorld(text);
}

export function enqueueForReading(text) {
  if (mode === 'off' || !text) return;
  queue.push(text);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  pump();
}

// Barge-in. Acting is a statement that you are done listening to the last thing —
// every reader that lacks this is one you end up fighting, because the only way
// to skip a long room description is to wait it out. Called when a command is
// submitted, and bound to Escape.
export function shush() {
  queue = [];
  speaking = false;
  clearTimeout(worldTimer);
  try { window.speechSynthesis?.cancel(); } catch { /* not supported */ }
  try { window.AudioEngine?.cancelSpeech?.(); } catch { /* no context yet */ }
}

export function logReaderActive() { return mode !== 'off'; }

export function setLogReaderMode(next) {
  const want = next || 'off';
  // Natural mode with no speechSynthesis (rare, but it happens in embedded
  // webviews) falls back to silence rather than to the other voice — quietly
  // substituting a very different voice for the one that was chosen is worse
  // than doing nothing.
  mode = (want === 'natural' && !window.speechSynthesis) ? 'off' : want;
  if (mode === 'off') shush();
}

export function setLogReaderRate(r) {
  const n = parseFloat(r);
  rate = Number.isFinite(n) ? Math.max(0.5, Math.min(2.5, n)) : 1;
}

export function initLogReader() {
  const out = document.getElementById('output');
  if (!out) return;
  const s = loadSettings();
  setLogReaderRate(s.logVoiceRate);
  setLogReaderMode(s.logVoice);

  new MutationObserver((records) => {
    if (mode === 'off') return;
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        const text = readableText(node);
        if (text) enqueueForReading(text);
      }
    }
  }).observe(out, { childList: true });

  // Escape stops the reader dead. The one control somebody needs at the moment
  // they need it most, and it must not require finding a button.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode !== 'off') shush();
  });
}
