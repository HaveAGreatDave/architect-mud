// Log highlights — the store and the painter.
//
// Deliberately separate from logtools.js, which holds the panel and the verbs.
// This half is imported by render.js on the append path, and logtools.js imports
// render.js for its own output; keeping them one file puts render → logtools →
// render in a cycle. The split is along the honest line anyway: this file knows
// nothing about UI and touches no DOM it was not handed.
//
// ── Why highlights are not a cosmetic ───────────────────────────────────────
//
// This game says everything in prose, in one scrolling column, and during a fight
// it says a lot of it per second. There was no way to make one line matter more
// than another — your name being said, a whisper, the word you have been waiting
// an hour for. That is a readability problem for everyone and an accessibility
// problem for anyone who cannot scan a fast scroll.
// See docs/systems-accessibility.md.
import { loadSettings } from '/shared/settings.js';

const STORE = 'architect_log_highlights';

// Entry: { id, pattern, color, alert }. `pattern` is matched case-insensitively
// as a PLAIN SUBSTRING — deliberately not a regex. A regex box is a footgun in a
// text field with no error surface (one unbalanced bracket throws on every line
// appended thereafter), and the honest answer for the ninety-nine percent case is
// "colour this word".
export function loadHighlights() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(raw) ? raw.filter(h => h && h.pattern) : [];
  } catch { return []; }
}

export function saveHighlights(list) {
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* full or blocked */ }
  compile();
}

// Compiled once per change, never per line: paintHighlights runs on every message
// appended, which during a fight is several a second.
let _compiled = [];
function compile() {
  _compiled = loadHighlights()
    .map(h => ({ ...h, needle: String(h.pattern).toLowerCase() }))
    .filter(h => h.needle)
    // Longest first, so "reactor core" wins where "core" is also set and would
    // otherwise eat the front of the longer match.
    .sort((a, b) => b.needle.length - a.needle.length);
}
compile();

export function addHighlight({ pattern, color, alert }) {
  const list = loadHighlights();
  list.push({
    id: `h${Date.now()}${list.length}`,
    pattern: String(pattern).trim(),
    color: color || '#ffd166',
    alert: !!alert,
  });
  saveHighlights(list);
}

export function removeHighlight(id) {
  saveHighlights(loadHighlights().filter(h => h.id !== id));
}

function alertSound() {
  try {
    const def = window.SFXCatalog?.get('hack-ping');
    if (def) window.AudioEngine?.playSfx(def, 0.5);
  } catch { /* audio not unlocked yet — the colour still landed */ }
}

// Mirrors paintSpeech() in render.js, including both its guards: walk TEXT nodes
// only (so nothing here rewrites markup the server sent), and skip anything
// already inside a painted span so a second pass can't nest them.
//
// ⚠ <pre> is skipped entirely. Those are the glyph-art and box-drawing blocks — a
// poster, a card, a chess board — where a coloured span in the middle of a border
// character is not a highlight, it is a hole in the picture.
// `silent` is for the repaint that follows a rule change (logtools.js): painting
// two hundred existing lines must not fire two hundred pings for a word that was
// said an hour ago. The ping means "the game just said this", and a repaint is
// not the game saying anything.
export function paintHighlights(el, { silent = false } = {}) {
  if (!_compiled.length || el.tagName === 'PRE') return el;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest('.log-hl, pre')) continue;
    if (n.nodeValue && n.nodeValue.trim()) targets.push(n);
  }
  let hitAlert = false;
  for (const node of targets) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    // One left-to-right pass; at each position the first (longest) rule wins.
    const frag = document.createDocumentFragment();
    let i = 0, last = 0;
    while (i < lower.length) {
      const hit = _compiled.find(h => lower.startsWith(h.needle, i));
      if (!hit) { i++; continue; }
      if (i > last) frag.appendChild(document.createTextNode(text.slice(last, i)));
      const span = document.createElement('span');
      span.className = 'log-hl';
      span.style.setProperty('--hl-color', hit.color);
      span.textContent = text.slice(i, i + hit.needle.length);
      frag.appendChild(span);
      if (hit.alert) hitAlert = true;
      i += hit.needle.length;
      last = i;
    }
    if (!last) continue;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
  // One ping per LINE, never per match — a rule matching six words in a room
  // description must not fire six times. Muted by the game's own sound settings,
  // because a notification you cannot turn off is worse than no notification.
  const audio = loadSettings().audio || {};
  if (hitAlert && !silent && audio.enabled !== false && audio.sfx !== false) alertSound();
  return el;
}
