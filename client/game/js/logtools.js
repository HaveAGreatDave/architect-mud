// The log as a surface you can work with: a find bar, and a way to save it.
// The highlight STORE and PAINTER live in highlights.js — render.js imports that
// half on the append path, and this half imports render.js, so keeping them in one
// file would be a cycle. This file owns the panel and the verbs.
//
// All of it is client-only and per-browser (`localStorage`, the same storage model
// macros use). Nothing here reaches the server and nothing here can change what the
// game does — a highlight colours a line that was already printed, and the find bar
// reads the log without touching it. See docs/systems-accessibility.md.
import { appendMsg, getTranscript } from './render.js';
import { loadHighlights, saveHighlights, addHighlight, removeHighlight, paintHighlights } from './highlights.js';

// ── Repainting what is already on screen ────────────────────────────────────
//
// Without this, adding a highlight does nothing until the game next says
// something — which for a word you set BECAUSE you are waiting for it can be
// minutes, and looks exactly like the feature not working. Removing one is worse:
// the colour would stay until the line scrolled off.
//
// So: strip every existing mark, then paint the whole log again. O(lines), run
// only when a rule changes (never on the append path), and bounded by the
// scrollback cap in render.js — which is one of the things that cap buys.
function repaintHighlights() {
  const out = document.getElementById('output');
  if (!out) return;
  for (const span of [...out.querySelectorAll('.log-hl')]) {
    const parent = span.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(span.textContent), span);
    parent.normalize();
  }
  for (const line of out.children) paintHighlights(line, { silent: true });
}

// ── The find bar ────────────────────────────────────────────────────────────
//
// Ctrl+F over the log, or `find <text>`. Matches are marked in place and stepped
// through with Enter / Shift+Enter; closing clears every mark.
//
// ⚠ Stepping through matches SCROLLS THE LOG, which is exactly the thing the
// scroll lock exists to stop happening on its own. That is fine and is why the
// lock is left engaged here: the reader asked to be moved. Closing the bar does
// NOT snap them back to the tail — they went looking for something, and dumping
// them at the bottom the moment they find it is the whole bug again.
let bar = null;
let marks = [];
let markIdx = -1;

function clearMarks() {
  for (const m of marks) {
    const parent = m.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  }
  marks = [];
  markIdx = -1;
}

function runFind(needle) {
  clearMarks();
  const out = document.getElementById('output');
  const q = String(needle || '').trim().toLowerCase();
  if (!out || !q) return 0;
  const walker = document.createTreeWalker(out, NodeFilter.SHOW_TEXT);
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue && n.nodeValue.toLowerCase().includes(q)) targets.push(n);
  }
  for (const node of targets) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let i = 0, last = 0;
    while ((i = lower.indexOf(q, last)) !== -1) {
      if (i > last) frag.appendChild(document.createTextNode(text.slice(last, i)));
      const span = document.createElement('span');
      span.className = 'log-find';
      span.textContent = text.slice(i, i + q.length);
      frag.appendChild(span);
      marks.push(span);
      last = i + q.length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
  return marks.length;
}

function step(back) {
  if (!marks.length) return;
  marks[markIdx]?.classList.remove('current');
  markIdx = (markIdx + (back ? -1 : 1) + marks.length) % marks.length;
  const m = marks[markIdx];
  m.classList.add('current');
  m.scrollIntoView({ block: 'center' });
  paintCount();
}

function paintCount() {
  if (!bar) return;
  const c = bar.querySelector('.log-find-count');
  if (c) c.textContent = marks.length ? `${markIdx + 1}/${marks.length}` : 'none';
}

export function closeFindBar() {
  clearMarks();
  bar?.remove();
  bar = null;
}

export function openFindBar(initial = '') {
  const host = document.getElementById('output-container');
  if (!host) return;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'log-find-bar';
    bar.innerHTML = '<input class="log-find-input" type="text" placeholder="Find in log…" '
      + 'aria-label="Find in log">'
      + '<span class="log-find-count" aria-live="polite">none</span>'
      + '<button class="log-find-btn" data-act="prev" title="Previous (Shift+Enter)">↑</button>'
      + '<button class="log-find-btn" data-act="next" title="Next (Enter)">↓</button>'
      + '<button class="log-find-btn" data-act="close" title="Close (Esc)">✕</button>';
    host.appendChild(bar);
    const input = bar.querySelector('.log-find-input');
    input.addEventListener('input', () => { runFind(input.value); step(false); paintCount(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
    });
    bar.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'next') step(false);
      else if (act === 'prev') step(true);
      else if (act === 'close') closeFindBar();
    });
  }
  const input = bar.querySelector('.log-find-input');
  if (initial) input.value = initial;
  input.focus();
  input.select();
  if (input.value) { runFind(input.value); step(false); }
  paintCount();
}

// ── Transcript export ───────────────────────────────────────────────────────
//
// The log as a plain .txt, straight out of the DOM. Deliberately `textContent`
// and not the markup: what people want a transcript FOR is reading it back, or
// pasting it into a bug report, and neither is helped by spans.
//
// Reads the SESSION TRANSCRIPT (render.js), not the DOM. Reading the document was
// the original implementation and it was quietly wrong: the scrollback cap trims
// the log as you play, so the saved file began wherever the trimming had got to —
// and the one thing people save a log for is working out what happened earlier.
//
// The transcript holds 20,000 lines against the DOM's 1,500, includes lines a
// trigger gagged (not wanting to READ something is not wanting it unrecorded), and
// does not survive a refresh. Every one of those limits is stated in the file's own
// header rather than left to be discovered — a transcript that silently begins in
// the middle is worse than one that admits it does.
export function exportTranscript() {
  const { lines: raw, lost, cap } = getTranscript();
  if (!raw.length) { appendMsg('Nothing to save yet.', 'system'); return; }
  const lines = raw.map(s => s.replace(/\s+$/, ''));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const header = [
    `Architect — log transcript, saved ${new Date().toLocaleString()}`,
    `${lines.length} line(s) from this session.`,
    lost
      ? `⚠ ${lost} earlier line(s) are NOT here — the session buffer holds the last ${cap}.`
      : `This is everything printed since the page was loaded.`,
    `The buffer is in memory only, so a refresh starts a new one.`,
    '─'.repeat(72),
    '',
  ];
  const blob = new Blob([[...header, ...lines].join('\r\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `architect-log-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  appendMsg(`Saved ${lines.length} line(s) to ${a.download}.`, 'system');
}

// ── The highlight manager ───────────────────────────────────────────────────
//
// Reuses the `smart-macro-*` overlay classes rather than growing a byte-identical
// second block of CSS. They are generic (overlay / box / head / body / list /
// row) and nothing in them is about macros.
let overlayEl = null;

export function closeHighlightManager() { overlayEl?.remove(); overlayEl = null; }

export function openHighlightManager() {
  closeHighlightManager();
  const overlay = document.createElement('div');
  overlay.className = 'smart-macro-overlay';
  const box = document.createElement('div');
  box.className = 'smart-macro-box';

  const head = document.createElement('div');
  head.className = 'smart-macro-head';
  head.innerHTML = '<span>Highlights</span>';
  const x = document.createElement('button');
  x.className = 'smart-macro-x';
  x.textContent = '✕';
  x.addEventListener('click', closeHighlightManager);
  head.appendChild(x);
  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'smart-macro-body';

  const blurb = document.createElement('p');
  blurb.className = 'log-hl-blurb';
  blurb.textContent = 'Words to colour when the game says them. Matched anywhere in a '
    + 'line, ignoring case. "Ping" also plays a sound — once per line, however many '
    + 'times the word appears.';
  body.appendChild(blurb);

  const list = document.createElement('div');
  list.className = 'smart-macro-list';
  const rows = loadHighlights();
  if (!rows.length) {
    const none = document.createElement('div');
    none.className = 'log-hl-blurb';
    none.textContent = 'Nothing highlighted yet.';
    list.appendChild(none);
  }
  for (const h of rows) {
    const row = document.createElement('div');
    row.className = 'smart-macro-row';
    const swatch = document.createElement('span');
    swatch.className = 'log-hl';
    swatch.style.setProperty('--hl-color', h.color);
    swatch.textContent = h.pattern;
    row.appendChild(swatch);
    const note = document.createElement('span');
    note.className = 'log-hl-note';
    note.textContent = h.alert ? 'ping' : '';
    row.appendChild(note);
    const del = document.createElement('button');
    del.className = 'smart-macro-x';
    del.textContent = '✕';
    del.title = `Remove "${h.pattern}"`;
    del.addEventListener('click', () => { removeHighlight(h.id); repaintHighlights(); openHighlightManager(); });
    row.appendChild(del);
    list.appendChild(row);
  }
  body.appendChild(list);

  const form = document.createElement('div');
  form.className = 'log-hl-form';
  form.innerHTML = '<input class="log-hl-word" type="text" placeholder="word or phrase" '
    + 'aria-label="Word or phrase to highlight">'
    + '<input class="log-hl-color" type="color" value="#ffd166" aria-label="Highlight colour">'
    + '<label class="log-hl-ping"><input type="checkbox"> ping</label>'
    + '<button class="log-hl-add">Add</button>';
  body.appendChild(form);
  form.querySelector('.log-hl-add').addEventListener('click', () => {
    const word = form.querySelector('.log-hl-word').value.trim();
    if (!word) return;
    addHighlight({
      pattern: word,
      color: form.querySelector('.log-hl-color').value,
      alert: form.querySelector('.log-hl-ping input').checked,
    });
    repaintHighlights();
    openHighlightManager();
  });
  form.querySelector('.log-hl-word').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') form.querySelector('.log-hl-add').click();
  });

  box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlayEl = overlay;
  form.querySelector('.log-hl-word').focus();
}

// ── Verbs ───────────────────────────────────────────────────────────────────
//
// Called from handleClientCommand. Bare `highlight`/`hl` opens the manager;
// `highlight <word>` adds one in the default colour without a trip through the
// panel, which is what you actually want mid-fight.
export function runHighlightCommand(rest) {
  const arg = String(rest || '').trim();
  if (!arg) { openHighlightManager(); return; }
  if (/^(off|clear|none)$/i.test(arg)) {
    const n = loadHighlights().length;
    saveHighlights([]);
    repaintHighlights();
    appendMsg(n ? `Cleared ${n} highlight(s).` : 'Nothing was highlighted.', 'system');
    return;
  }
  const existing = loadHighlights().find(h => h.pattern.toLowerCase() === arg.toLowerCase());
  if (existing) {
    removeHighlight(existing.id);
    repaintHighlights();
    appendMsg(`No longer highlighting "${existing.pattern}".`, 'system');
    return;
  }
  addHighlight({ pattern: arg });
  repaintHighlights();
  appendMsg(`Highlighting "${arg}". Say "highlight" on its own for colours and pings, `
    + `or "highlight ${arg}" again to stop.`, 'system');
}

// Ctrl+F anywhere in the client. Not bound when a text field has focus other than
// the command box: inside a search field of somebody else's panel, Ctrl+F means
// the browser's find, and taking that is rude.
export function initLogTools() {
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return;
    const tag = e.target?.tagName;
    const inCmd = e.target?.id === 'cmd-input';
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && !inCmd) return;
    if (document.getElementById('auth-screen')?.style.display !== 'none') return;
    e.preventDefault();
    openFindBar(inCmd ? e.target.value.trim() : '');
  });
}
