// THE SPRAY CAN — the in-browser dialog behind `spray` (plugins/graffiti).
//
// `tag <dir> <words>` is still the whole feature and still works with one hand on
// the keyboard. This is the same act done properly: you write the words, you pick
// the letters, and you paint them — colour off the shared paint-shop wheel
// (./color-picker.js, the same one the hangar bench uses), plus bold, italic,
// underline and strike. Designs you like go on a shelf and come back off it.
//
// THE CLIENT DECIDES NOTHING. It picks the wall, the words and the paint and hands
// all three to the server, which asks again whether there is a wall there and a can
// in your hand, re-validates every colour down to a #rrggbb, and re-measures the
// length. This panel is a nicer way to say a sentence the server was always going
// to check.
//
// STYLE IS DATA, NEVER MARKUP. The payload is {t: text, r: runs, f: letterform} —
// never a string of tags — so nothing here can smuggle HTML into a room description
// no matter what somebody types. The runs count CHARACTERS THE PLAYER TYPED; the server escapes
// the text afterwards and realigns the two. See plugins/graffiti/paint.js.
//
// The preview is the honest one: it renders exactly what the room line will render,
// on a strip of wall, because a tag you can't see before you spray it is a tag you
// only get right by accident. Under it is the other half: the piece as the flight
// window will paint it on the building, baked by the renderer's own code in the
// letterform you picked (bubble, round, block or sharp).

import { sendCmdSilent } from '../net.js';
import { mountOverlay } from './minigame-common.js';
import { openColorPicker, closeColorPicker } from './color-picker.js';
import { tagPreview } from './tag-bake.js';   // a leaf: the preview without fetching GLASS
import { TAG_FACES } from '../../../shared/tag-strokes.js';
import { loadCss } from '../../../shared/dom.js';

// spraycan.css ships beside this file and is fetched when the module loads, so ensureStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const SPRAY_CSS = await loadCss(new URL('./spraycan.css', import.meta.url));

const F_BOLD = 1, F_ITALIC = 2, F_UNDER = 4, F_STRIKE = 8;

// The rack in the can's lid. Street paint, not the paint shop's aircraft enamels:
// high-visibility fluorescents and the few flat colours you'd actually find in a
// hardware shop's cheap end.
const RACK = ['#ffffff', '#f2f2f2', '#c9ced4', '#8a9099', '#3b4149', '#101317', '#ff2d55', '#ff5c00',
  '#ffb300', '#ffe600', '#8cff2d', '#00e676', '#00d0d0', '#2196ff', '#7c4dff', '#ff2ddd'];

let S = null;   // { text, colors[], flags[], sel:{a,b}|null, face, walls, wall, saved, ... }

// How each letterform is offered. `null` leaves it to the wall, which is what a tag
// typed with `tag` gets: the hand (throw-up, handstyle or stencil) and the letters are
// both rolled off the street it is on.
const FACE_LABEL = { bubble: 'bubble', round: 'round', block: 'block', sharp: 'sharp' };
const FACE_TIP = {
  bubble: 'Fat hand-drawn bubble letters',
  round: 'Puffy and even, every corner rounded off',
  block: 'Square-cut and upright',
  sharp: 'Leaning, mitred to points, chisel-cut ends',
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── The style model ──────────────────────────────────────────────────────────
// Held as two parallel per-character arrays because that is what the editing
// gestures actually touch (select these three letters, make them red). Runs are a
// STORAGE shape, so the compression happens once, at the moment of sending.

function runsFromChars(colors, flags, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    const c = colors[i] || null, f = flags[i] | 0;
    const last = out[out.length - 1];
    if (last && last.c === c && last.f === f) last.n++;
    else out.push({ n: 1, c, f });
  }
  return out.some(r => r.c || r.f) ? out : [];
}

/** Runs → per-character arrays. The load path, and the inverse of the above. */
function charsFromRuns(runs, len) {
  const colors = new Array(len).fill(null), flags = new Array(len).fill(0);
  let i = 0;
  for (const r of (runs || [])) {
    for (let k = 0; k < (r.n | 0) && i < len; k++, i++) {
      colors[i] = /^#[0-9a-f]{6}$/i.test(r.c || '') ? String(r.c).toLowerCase() : null;
      flags[i] = (r.f | 0) & 15;
    }
  }
  return { colors, flags };
}

// The selection is an inclusive [a,b] pair, normalized on read so a backwards drag
// means the same thing as a forwards one. Null selection = the whole tag, which is
// what makes "type it, hit a colour, done" the one-gesture path.
function selRange() {
  if (!S.sel) return [0, S.text.length - 1];
  return S.sel.a <= S.sel.b ? [S.sel.a, S.sel.b] : [S.sel.b, S.sel.a];
}
function eachSelected(fn) {
  const [a, b] = selRange();
  for (let i = a; i <= b && i < S.text.length; i++) fn(i);
}

// Keeping the arrays the length of the text is the entire bookkeeping burden of
// this panel, so it happens in exactly one place: whenever the text changes.
// Typing in the middle shifts paint along with the letters, which is what you'd
// expect of paint that is on a letter rather than at an index.
function retext(next) {
  const old = S.text;
  if (next === old) return;
  // Find the common head/tail so an insert or delete carries the styling with it.
  let head = 0;
  while (head < old.length && head < next.length && old[head] === next[head]) head++;
  let tail = 0;
  while (tail < old.length - head && tail < next.length - head &&
         old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const midLen = next.length - head - tail;
  const fill = { c: S.colors[Math.max(0, head - 1)] || null, f: S.flags[Math.max(0, head - 1)] | 0 };
  S.colors = [...S.colors.slice(0, head), ...Array(midLen).fill(fill.c), ...S.colors.slice(old.length - tail)];
  S.flags = [...S.flags.slice(0, head), ...Array(midLen).fill(fill.f), ...S.flags.slice(old.length - tail)];
  S.text = next;
  if (S.sel && (S.sel.a >= next.length || S.sel.b >= next.length)) S.sel = null;
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** One character as it will look on the wall. The preview and the letter strip share it. */
function charHtml(i) {
  const ch = esc(S.text[i]);
  const f = S.flags[i] | 0;
  let piece = S.text[i] === ' ' ? '&nbsp;' : ch;
  if (f & F_BOLD) piece = `<b>${piece}</b>`;
  if (f & F_ITALIC) piece = `<i>${piece}</i>`;
  if (f & F_UNDER) piece = `<u>${piece}</u>`;
  if (f & F_STRIKE) piece = `<s>${piece}</s>`;
  return S.colors[i] ? `<span style="color:${S.colors[i]}">${piece}</span>` : piece;
}

function previewHtml() {
  if (!S.text) return `<span class="sp-empty">nothing yet</span>`;
  let out = '';
  for (let i = 0; i < S.text.length; i++) out += charHtml(i);
  return out;
}

function stripHtml() {
  const [a, b] = selRange();
  const whole = !S.sel;
  let out = '';
  for (let i = 0; i < S.text.length; i++) {
    const on = !whole && i >= a && i <= b;
    out += `<span class="sp-cell${on ? ' sp-on' : ''}" data-i="${i}">${charHtml(i)}</span>`;
  }
  return out || `<span class="sp-empty">type something above</span>`;
}

function savedHtml() {
  if (!S.saved.length) return `<div class="sp-empty">Nothing on the shelf yet.</div>`;
  return S.saved.map(sv => {
    const { colors, flags } = charsFromRuns(sv.style, sv.text.length);
    const prev = { text: sv.text, colors, flags };
    const swap = S; S = prev;                 // borrow the renderer for the thumbnail
    let ink = '';
    for (let i = 0; i < prev.text.length; i++) ink += charHtml(i);
    S = swap;
    return `<div class="sp-saved">
      <button type="button" class="sp-load" data-load="${sv.id}" title="Load onto the can">${ink}</button>
      <span class="sp-saved-name">${esc(sv.name)}${sv.face ? ` · ${esc(FACE_LABEL[sv.face] || '')}` : ''}</span>
      <button type="button" class="sp-bin" data-del="${sv.id}" title="Bin it">✕</button>
    </div>`;
  }).join('');
}

// The piece on the wall. Baked by the renderer, so it costs a canvas bake: done at
// most once a frame however fast the colour wheel is dragged.
function paintPiece() {
  if (!S || S.pieceFrame) return;
  S.pieceFrame = requestAnimationFrame(() => {
    if (!S) return;
    S.pieceFrame = 0;
    const cv = S.$('sp-piece');
    const g = cv.getContext('2d');
    const W = cv.clientWidth || 520, H = 118;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    let tex = null;
    try { tex = S.text.trim() ? tagPreview(S.text, runsFromChars(S.colors, S.flags, S.text.length), S.face) : null; } catch { tex = null; }
    S.$('sp-piece-note').textContent = !S.text.trim() ? ''
      : S.face ? `${FACE_LABEL[S.face]} letters` : 'any style: the wall picks the letters and the hand';
    if (!tex) return;
    const k = Math.min((W - 12) / tex.width, (H - 8) / tex.height);
    g.drawImage(tex, (W - tex.width * k) / 2, (H - tex.height * k) / 2, tex.width * k, tex.height * k);
  });
}

function paint() {
  if (!S) return;
  S.$('sp-preview').innerHTML = previewHtml();
  for (const b of S.overlay.querySelectorAll('[data-face]')) {
    b.classList.toggle('sp-active', (b.getAttribute('data-face') || null) === (S.face || null));
  }
  paintPiece();
  S.$('sp-strip').innerHTML = stripHtml();
  S.$('sp-count').textContent = `${S.text.length}/${S.maxLen}`;
  S.$('sp-count').classList.toggle('sp-over', S.text.length > S.maxLen);
  S.$('sp-shelf').innerHTML = savedHtml();
  S.$('sp-stops').innerHTML = S.fade.map((c, i) =>
    `<button type="button" class="sp-cap sp-stop" data-stop="${i}" style="background:${c}" title="${c}"></button>`).join('');
  S.$('sp-ramp').style.background = `linear-gradient(90deg, ${S.fade.join(', ')})`;
  S.$('sp-scope').textContent = S.sel ? `letters ${selRange()[0] + 1}–${selRange()[1] + 1}` : 'the whole tag';
  const swatch = S.$('sp-swatch');
  swatch.querySelector('i').style.background = S.ink;
  swatch.querySelector('em').textContent = S.ink.toUpperCase();
  for (const btn of S.overlay.querySelectorAll('[data-flag]')) {
    // A weight button lights up when EVERY selected letter has it — "some of them"
    // is not a state a toggle can honestly show, and pressing it should set rather
    // than clear when the selection is mixed.
    const bit = Number(btn.getAttribute('data-flag'));
    let all = S.text.length > 0;
    eachSelected(i => { if (!(S.flags[i] & bit)) all = false; });
    btn.classList.toggle('sp-active', all);
  }
  S.$('sp-go').disabled = !S.text.length || S.text.length > S.maxLen;
}

// ── Actions ──────────────────────────────────────────────────────────────────

function applyColor(hex) {
  S.ink = hex;
  eachSelected(i => { S.colors[i] = hex; });
  paint();
}

function toggleFlag(bit) {
  let all = S.text.length > 0;
  eachSelected(i => { if (!(S.flags[i] & bit)) all = false; });
  eachSelected(i => { S.flags[i] = all ? (S.flags[i] & ~bit) : (S.flags[i] | bit); });
  paint();
}

// A rainbow across the selection. Not a decoration for its own sake: it is the one
// effect that is tedious to do letter by letter and the first thing anybody with a
// can of paint and a colour wheel tries.
function rainbow() {
  const [a, b] = selRange();
  const span = Math.max(1, b - a);
  for (let i = a; i <= b && i < S.text.length; i++) {
    const hue = Math.round(((i - a) / span) * 300);
    S.colors[i] = hslHex(hue, 1, 0.62);
  }
  paint();
}

// The four-stop fade. The rainbow is a fixed sweep through the spectrum; this is the
// same gesture with the colours chosen — you set four cans and the letters between
// them are mixed for you. Blending is a straight sRGB lerp per segment, which is what
// a fading can actually does on a wall: the stops land on real letters and everything
// between two stops is an intermediate nobody had to pick.
function fade() {
  const stops = S.fade.filter(c => /^#[0-9a-f]{6}$/i.test(c));
  if (stops.length < 2) return;
  const [a, b] = selRange();
  const span = Math.max(1, b - a);
  for (let i = a; i <= b && i < S.text.length; i++) {
    const t = ((i - a) / span) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    S.colors[i] = mixHex(stops[k], stops[k + 1], t - k);
  }
  paint();
}

const rgb = (hex) => [1, 3, 5].map(o => parseInt(hex.slice(o, o + 2), 16));

function mixHex(x, y, t) {
  const p = rgb(x), q = rgb(y);
  return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function hslHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

function strip() {
  eachSelected(i => { S.colors[i] = null; S.flags[i] = 0; });
  paint();
}

// The wire format. Base64 of {t, r} — see plugins/graffiti/paint.js for why a
// command line can't carry this any other way.
function payload(name) {
  const obj = { t: S.text, r: runsFromChars(S.colors, S.flags, S.text.length) };
  if (S.face) obj.f = S.face;
  if (name) obj.n = name;
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

function sprayIt() {
  if (!S.text.length || S.text.length > S.maxLen) return;
  sendCmdSilent(`sprayapply ${S.wall} ${payload()}`);
  S.close();
}

// ── The panel ────────────────────────────────────────────────────────────────

function ensureStyles() {
  if (document.getElementById('spraycan-styles')) return;
  const st = document.createElement('style');
  st.id = 'spraycan-styles';
  st.textContent = SPRAY_CSS;
  document.head.appendChild(st);
}

// A front is just the building, as it always was; a side or back wall says which it is.
const WALL_NAME = (w) => (w.side === 'side' || w.side === 'back' ? `${w.side} of ${w.name}` : w.name);
const WALL_OPT = (w, sel) => `<option value="${esc(w.dir)}"${w.dir === sel ? ' selected' : ''}>${esc(w.dir)}: ${esc(WALL_NAME(w))}</option>`;

// Whose paint is on the wall you've picked. Per wall, because a tag is: one side of an alley
// can be bare while the other is somebody's.
function overNote() {
  const w = S?.walls.find(x => x.dir === S.wall);
  note(w?.over ? `${w.over}'s tag is up on that wall. Yours goes straight over it.` : '');
}

// msg: { walls:[{dir,name,side,over}], wall, saved, maxLen, saveCap, can:{name,quantity} }
export function openSprayCan(msg) {
  ensureStyles();
  closeSprayCan();

  const walls = Array.isArray(msg.walls) ? msg.walls : [];
  const wall = msg.wall || walls[0]?.dir || '';

  const { overlay, close } = mountOverlay({
    id: 'spray-overlay',
    html: `<div id="sp-root">
      <div class="sp-row">
        <div>
          <div class="sp-brand">◗ RATTLE-CAN</div>
          <div class="sp-sub">${esc(msg.can?.name || 'spray paint')}: ${Number(msg.can?.quantity || 1)} in the bag</div>
        </div>
        <div style="margin-left:auto"><select class="sp-btn" id="sp-wall">${walls.map(w => WALL_OPT(w, wall)).join('')}</select></div>
      </div>
      <div class="sp-wall" id="sp-preview"></div>
      <input class="sp-input" id="sp-text" maxlength="${Number(msg.maxLen) || 48}" placeholder="what are you writing?" autocomplete="off" spellcheck="false">
      <div class="sp-lab">Style</div>
      <div class="sp-row">
        <button type="button" class="sp-btn" data-face="" title="Leave it to the wall">any</button>
        ${TAG_FACES.map(f => `<button type="button" class="sp-btn" data-face="${f}" title="${esc(FACE_TIP[f] || '')}">${esc(FACE_LABEL[f] || f)}</button>`).join('')}
      </div>
      <canvas class="sp-piece" id="sp-piece"></canvas>
      <div class="sp-piece-note" id="sp-piece-note"></div>
      <div class="sp-lab">Letters <span class="sp-count" id="sp-count"></span></div>
      <div class="sp-strip" id="sp-strip"></div>
      <div class="sp-row" style="margin-top:6px">
        <button type="button" class="sp-btn" id="sp-all">whole tag</button>
        <span class="sp-scope">painting <span id="sp-scope"></span></span>
      </div>
      <div class="sp-lab">Paint</div>
      <div class="sp-row">
        <button type="button" class="sp-swatch" id="sp-swatch"><i></i><em></em></button>
        <button type="button" class="sp-btn" data-flag="${F_BOLD}" title="Bold"><b>B</b></button>
        <button type="button" class="sp-btn" data-flag="${F_ITALIC}" title="Italic"><i>I</i></button>
        <button type="button" class="sp-btn" data-flag="${F_UNDER}" title="Underline"><u>U</u></button>
        <button type="button" class="sp-btn" data-flag="${F_STRIKE}" title="Strike"><s>S</s></button>
        <button type="button" class="sp-btn" id="sp-rainbow" title="Fade across the selection">rainbow</button>
        <button type="button" class="sp-btn" id="sp-strip-btn" title="Back to plain">strip</button>
      </div>
      <div class="sp-rack" id="sp-rack">${RACK.map(c => `<button type="button" class="sp-cap" data-cap="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
      <div class="sp-lab">Fade: four cans, mixed between</div>
      <div class="sp-row">
        <div class="sp-stops" id="sp-stops"></div>
        <div class="sp-ramp" id="sp-ramp"></div>
        <button type="button" class="sp-btn" id="sp-fade" title="Blend the four across the selection">fade</button>
      </div>
      <div class="sp-lab">Shelf</div>
      <div class="sp-shelf" id="sp-shelf"></div>
      <div class="sp-row" style="margin-top:7px">
        <input class="sp-name" id="sp-savename" maxlength="24" placeholder="name it" autocomplete="off">
        <button type="button" class="sp-btn" id="sp-save">save this one</button>
      </div>
      <div class="sp-note" id="sp-note"></div>
      <div class="sp-foot">
        <button type="button" class="sp-btn sp-go" id="sp-go">spray it</button>
        <button type="button" class="sp-btn" id="sp-cancel">put the lid back on</button>
      </div>
    </div>`,
    // Esc closes the can. When the colour wheel is up it owns Esc first — it listens
    // in the CAPTURE phase and stops propagation there, so this handler never sees
    // the press and one Esc puts away one thing.
    onClose: () => { closeColorPicker({ silent: true }); if (S?.pieceFrame) cancelAnimationFrame(S.pieceFrame); S = null; },
  });

  const $ = (id) => overlay.querySelector('#' + id);
  S = {
    text: '', colors: [], flags: [], sel: null, ink: '#ff2d55', face: null, pieceFrame: 0,
    fade: ['#ff2d55', '#ffb300', '#00e676', '#2196ff'],
    walls, wall, saved: Array.isArray(msg.saved) ? msg.saved : [],
    maxLen: Number(msg.maxLen) || 48, saveCap: Number(msg.saveCap) || 12,
    overlay, close, $,
  };

  // The text field is the source of truth for the words; the strip is the source of
  // truth for which of them you're painting.
  const input = $('sp-text');
  input.addEventListener('input', () => { retext(input.value); paint(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();                                   // the game's command box must not see this
    if (e.key === 'Enter') { e.preventDefault(); sprayIt(); }
  });

  // Click a letter, drag a run. Pointer capture so the gesture survives leaving the
  // strip, and preventDefault so it never starts a text selection over the cells.
  const stripEl = $('sp-strip');
  let dragging = false;
  stripEl.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.sp-cell');
    if (!cell) return;
    e.preventDefault();
    const i = Number(cell.getAttribute('data-i'));
    if (e.shiftKey && S.sel) S.sel = { a: S.sel.a, b: i };
    else S.sel = { a: i, b: i };
    dragging = true;
    stripEl.setPointerCapture(e.pointerId);
    paint();
  });
  stripEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.sp-cell');
    if (cell) { S.sel = { a: S.sel.a, b: Number(cell.getAttribute('data-i')) }; paint(); }
  });
  const endDrag = () => { dragging = false; };
  stripEl.addEventListener('pointerup', endDrag);
  stripEl.addEventListener('pointercancel', endDrag);

  $('sp-all').addEventListener('click', () => { S.sel = null; paint(); });
  for (const b of overlay.querySelectorAll('[data-face]')) {
    b.addEventListener('click', () => { S.face = TAG_FACES.includes(b.getAttribute('data-face')) ? b.getAttribute('data-face') : null; paint(); });
  }
  $('sp-wall').addEventListener('change', (e) => { S.wall = e.target.value; overNote(); });
  $('sp-rainbow').addEventListener('click', rainbow);
  $('sp-strip-btn').addEventListener('click', strip);
  $('sp-fade').addEventListener('click', fade);
  // Each stop opens the same wheel the ink swatch does, on its own key so the four
  // remember themselves independently. Changing a stop re-paints the ramp only — the
  // letters change when you press `fade`, because a stop is a choice, not a stroke.
  $('sp-stops').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stop]');
    if (!b) return;
    e.stopPropagation();
    const k = Number(b.getAttribute('data-stop'));
    openColorPicker({
      key: 'spray-fade-' + k, anchor: b, value: S.fade[k], title: `fade ${k + 1}`, quick: RACK,
      themeFrom: 'sp-root', onChange: (hex) => { S.fade[k] = hex; paint(); },
    });
  });
  for (const btn of overlay.querySelectorAll('[data-flag]')) {
    btn.addEventListener('click', () => toggleFlag(Number(btn.getAttribute('data-flag'))));
  }
  for (const cap of overlay.querySelectorAll('[data-cap]')) {
    cap.addEventListener('click', () => applyColor(cap.getAttribute('data-cap')));
  }
  // The shared wheel, themed off #sp-root. It writes on every drag frame, so the
  // letters recolour under your thumb rather than on commit.
  $('sp-swatch').addEventListener('click', (e) => {
    e.stopPropagation();
    openColorPicker({
      key: 'spray-ink', anchor: e.currentTarget, value: S.ink, title: 'paint', quick: RACK,
      themeFrom: 'sp-root', onChange: (hex) => applyColor(hex),
    });
  });

  $('sp-shelf').addEventListener('click', (e) => {
    const load = e.target.closest('[data-load]');
    if (load) {
      const sv = S.saved.find(x => String(x.id) === load.getAttribute('data-load'));
      if (sv) {
        S.text = sv.text;
        const cf = charsFromRuns(sv.style, sv.text.length);
        S.colors = cf.colors; S.flags = cf.flags; S.sel = null;
        S.face = TAG_FACES.includes(sv.face) ? sv.face : null;
        input.value = sv.text;
        $('sp-savename').value = sv.name;
        note(`Loaded "${sv.name}".`);
        paint();
      }
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) sendCmdSilent(`spraydel ${del.getAttribute('data-del')}`);
  });

  $('sp-save').addEventListener('click', () => {
    if (!S.text.length) { note('Write something first.', true); return; }
    if (S.saved.length >= S.saveCap) { note(`The shelf holds ${S.saveCap}. Bin one first.`, true); return; }
    sendCmdSilent(`spraysave ${payload($('sp-savename').value.trim() || S.text.slice(0, 24))}`);
  });
  $('sp-savename').addEventListener('keydown', (e) => e.stopPropagation());
  $('sp-go').addEventListener('click', sprayIt);
  $('sp-cancel').addEventListener('click', () => close());

  overNote();
  paint();
  input.focus();
}

function note(text, bad) {
  const el = S?.$('sp-note');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('sp-bad', !!bad);
}

/** The server's answer to a save or a bin: the whole fresh shelf, never a delta. */
export function updateSprayShelf(msg) {
  if (!S) return;
  S.saved = Array.isArray(msg.saved) ? msg.saved : [];
  note(msg.error || msg.note || '', !!msg.error);
  paint();
}

export function closeSprayCan() {
  if (!S) return;
  const c = S.close;
  c?.();
  S = null;
}
