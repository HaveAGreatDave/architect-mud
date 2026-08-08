// TEXTUI — the shared toolkit for drawing a live panel in characters.
//
// Extracted from textcockpit.js, which proved the idea: a real-time instrument
// panel with no canvas, no WebGL and no image anywhere in the path. That file
// still owns everything aviation — the horizon, the compass tape, the chart — and
// now imports the general half from here so the next character panel doesn't have
// to copy it.
//
// The rule it exists to protect (textcockpit.js's own header, worth repeating):
//
//   Deliberately NOT a downgraded graphical panel. A text mode is an instrument
//   panel someone built out of a terminal, not a description of one.
//
// Colour is doing real work in these panels rather than decorating: with no
// picture, a coloured cell is often the only thing answering "which way is up" or
// "is this the one I want", and neither should have to be decoded character by
// character.
//
// ── The one performance rule ─────────────────────────────────────────────────
// Everything coloured goes through `paintRow`. A span per character is a few
// thousand DOM nodes a second at frame rate for a panel forty columns wide, which
// is what makes the difference between a text panel and a slideshow.

// ── Primitives ───────────────────────────────────────────────────────────────

export const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export const pad = (s, n) => String(s).padStart(n, ' ');
export const padEnd = (s, n) => String(s).padEnd(n, ' ');
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Run-length encode a row of {ch, cls} cells into as few spans as possible.
// See the performance rule above — this is not an optimisation, it's the reason
// a character panel can repaint at all.
export function paintRow(cells) {
  let out = '', run = '', cls = null;
  for (const cell of cells) {
    if (cell.cls !== cls) { if (run) out += `<span class="${cls}">${esc(run)}</span>`; run = ''; cls = cell.cls; }
    run += cell.ch;
  }
  if (run) out += `<span class="${cls}">${esc(run)}</span>`;
  return out;
}

// A block-character bar: █ filled, ░ empty. Reads at a glance without a pixel of
// graphics, which is what makes it the workhorse of every panel here.
export function bar(frac, width = 12, cls = '') {
  const f = Math.round(clamp(frac, 0, 1) * width);
  return `<span class="${cls}">${'█'.repeat(f)}</span><span class="dim">${'░'.repeat(width - f)}</span>`;
}

// A bar that fills from the middle outward — for anything signed (drift, bank,
// a tuning error). Zero reads as a single centre mark rather than an empty bar,
// so "correct" and "no data" can't be confused.
export function centreBar(frac, width = 12, cls = '') {
  const half = Math.floor(width / 2);
  const n = Math.round(clamp(frac, -1, 1) * half);
  const cells = [];
  for (let i = -half; i <= half; i++) {
    const on = n === 0 ? i === 0 : (n > 0 ? (i > 0 && i <= n) : (i < 0 && i >= n));
    cells.push({ ch: on ? '█' : (i === 0 ? '│' : '░'), cls: on ? cls : 'dim' });
  }
  return paintRow(cells);
}

// A horizontal rule at the panel's width.
export const rule = (w) => `<span class="rule">${'─'.repeat(w)}</span>`;

// A boxed title bar: ── LABEL ──────────
export function heading(label, w, cls = 'hi') {
  const text = ` ${label} `;
  const left = 2;
  const right = Math.max(0, w - left - text.length);
  return `<span class="rule">${'─'.repeat(left)}</span><span class="${cls}">${esc(text)}</span><span class="rule">${'─'.repeat(right)}</span>`;
}

// A meter row: label, bar, value — the shape most readouts want.
export function meter(label, frac, value, { w = 10, labelW = 9, cls = '' } = {}) {
  return `<span class="dim">${esc(padEnd(label, labelW))}</span>${bar(frac, w, cls)} ${esc(String(value))}`;
}

// ── Styles ───────────────────────────────────────────────────────────────────
// The shared shell + the semantic colour classes every panel here uses. A panel
// with its own look injects its own sheet ON TOP of this one (textcockpit.js
// still does), rather than forking it.
//
// LAYOUT NOTE, learned the hard way in textcockpit.js: use flex columns, not
// space-padded rows. Once cells carry a background colour, a row padded out with
// spaces paints a ragged edge down the gap.
export function ensureTextUiStyles() {
  if (document.getElementById('textui-styles')) return;
  const st = document.createElement('style');
  st.id = 'textui-styles';
  st.textContent = `
    .txui { font-family:'Courier New',monospace; font-size:0.75rem; line-height:1.25;
      color:#9fe0c4; background:linear-gradient(170deg,#0b1512,#060b09 70%);
      border:1px solid #10261e; border-radius:6px; padding:8px 10px;
      box-sizing:border-box; overflow:auto; white-space:pre; }
    .txui b { color:#d8fff0; font-weight:700; }
    .txui .dim  { color:#4d6d60; }
    .txui .hi   { color:#7fe3ff; }
    .txui .warn { color:#ffc94a; }
    .txui .bad  { color:#ff6a5a; font-weight:700; }
    .txui .ok   { color:#6ef0a8; }
    .txui .rule { color:#1d4436; }
    .txui-hd   { display:flex; justify-content:space-between; gap:12px; color:#7fe3ff; letter-spacing:1px; }
    .txui-cols { display:flex; gap:18px; align-items:flex-start; }
    /* A character panel stays playable with a mouse — the slots machine is the
       proof that this is what stops a text mode feeling like a fallback. */
    .txui .pick { cursor:pointer; text-decoration:underline dotted; }
    .txui .pick:hover { color:#d8fff0; text-shadow:0 0 6px rgba(216,255,240,.5); }
    @media (max-width:700px){ .txui { font-size:0.6875rem; } .txui-cols { gap:10px; } }
  `;
  document.head.appendChild(st);
}

// Exported for regress: every one of these is pure, so the suite can assert the
// rendering with no DOM at all (the convention textcockpit.js established).
export const _test = { paintRow, bar, centreBar, heading, meter, pad, padEnd, clamp, esc };
