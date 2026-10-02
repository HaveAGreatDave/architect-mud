// What the client knows about itself when a player sends feedback: display,
// renderer, open windows, the last lines of the log and recent errors. Read at
// send time; nothing here runs per frame. The server adds where the player is.
import { state } from './state.js';
import { appendMsg } from './render.js';
import { fpsSummary } from './fps-meter.js';
import { seatHoldsKeyboard } from './panels/seat-keys.js';
import { sendRaw } from './net.js';
import { showFeedbackDialog } from './panels/confirm.js';

// The last report sent, so a refusal reopens the form with the text still in it.
let pending = null;

export function openFeedback(opts = {}) {
  showFeedbackDialog(opts, ({ category, text }) => {
    pending = { category, value: text };
    if (!sendRaw({ type: 'feedback', category, text, client: collectTelemetry() }))
      openFeedback({ ...pending, error: "You're offline. Wait for the reconnect, then send it again." });
  });
}

export function onFeedbackOk(msg) {
  pending = null;
  appendMsg(`Thanks. Your feedback is in as #${msg.id}.`, 'system');
}

export function onFeedbackErr(msg) {
  openFeedback({ ...(pending || {}), error: msg.message || "That didn't go through." });
}

const ERR_MAX = 10;
const errors = [];

function remember(kind, message, where) {
  errors.push({ t: new Date().toISOString(), kind, message: String(message ?? '').slice(0, 300), where: where ? String(where).slice(0, 200) : undefined });
  if (errors.length > ERR_MAX) errors.shift();
}

// A ring of the last few uncaught errors. Installed once from main.js.
export function installErrorRing() {
  if (window.__feedbackErrorRing) return;
  window.__feedbackErrorRing = true;
  window.addEventListener('error', (e) => remember('error', e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null));
  window.addEventListener('unhandledrejection', (e) => remember('rejection', e.reason?.message || e.reason, e.reason?.stack?.split('\n')[1]?.trim()));
}

// The windows a player can have open, by what's actually in the DOM.
function openWindows() {
  const seen = [];
  for (const el of document.querySelectorAll('.confirm-window, [role="dialog"], [id$="-panel"], [id$="-overlay"], canvas[id]')) {
    if (!el.id && !el.className) continue;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    seen.push(el.id || String(el.className).split(' ')[0]);
    if (seen.length >= 25) break;
  }
  return [...new Set(seen)];
}

export function collectTelemetry() {
  const html = document.documentElement;
  const tune = window.__wsTune;
  let clouds = null;
  try { const v = window.__cloudVol && window.__cloudVol(); clouds = v ? { running: !!v.running, failed: v.failed || null } : null; } catch { /* diagnostic only */ }
  let keys = null;
  try { keys = seatHoldsKeyboard(); } catch { /* no seat module state yet */ }
  const out = document.getElementById('output');
  const lines = out ? [...out.children].slice(-30).map(el => el.innerText.trim().slice(0, 300)).filter(Boolean) : [];
  return {
    url: location.pathname,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, vvh: window.visualViewport ? Math.round(visualViewport.height) : null },
    density: html.dataset.density || null,
    paneClaimed: html.dataset.paneClaimed || null,
    displayRung: state.player?.displayRung || null,
    zone: state.currentZone || null,
    renderer: tune ? { glass: tune.gl ? 2 : 1, clouds } : null,
    fps: fpsSummary(),
    seatHoldsKeyboard: keys,
    openWindows: openWindows(),
    online: navigator.onLine,
    errors: errors.slice(),
    log: lines,
  };
}
