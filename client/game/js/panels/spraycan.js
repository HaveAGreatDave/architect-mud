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
// STYLE IS DATA, NEVER MARKUP. The payload is {t: text, r: runs} — never a string
// of tags — so nothing here can smuggle HTML into a room description no matter what
// somebody types. The runs count CHARACTERS THE PLAYER TYPED; the server escapes
// the text afterwards and realigns the two. See plugins/graffiti/paint.js.
//
// The preview is the honest one: it renders exactly what the room line will render,
// on a strip of wall, because a tag you can't see before you spray it is a tag you
// only get right by accident.

import { sendCmdSilent } from '../net.js';
import { mountOverlay } from './minigame-common.js';
import { openColorPicker, closeColorPicker } from './color-picker.js';

const F_BOLD = 1, F_ITALIC = 2, F_UNDER = 4, F_STRIKE = 8;

// The rack in the can's lid. Street paint, not the paint shop's aircraft enamels:
// high-visibility fluorescents and the few flat colours you'd actually find in a
// hardware shop's cheap end.
const RACK = ['#ffffff', '#f2f2f2', '#c9ced4', '#8a9099', '#3b4149', '#101317', '#ff2d55', '#ff5c00',
  '#ffb300', '#ffe600', '#8cff2d', '#00e676', '#00d0d0', '#2196ff', '#7c4dff', '#ff2ddd'];

let S = null;   // { text, colors[], flags[], sel:{a,b}|null, walls, wall, saved, ... }

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
      <span class="sp-saved-name">${esc(sv.name)}</span>
      <button type="button" class="sp-bin" data-del="${sv.id}" title="Bin it">✕</button>
    </div>`;
  }).join('');
}

function paint() {
  if (!S) return;
  S.$('sp-preview').innerHTML = previewHtml();
  S.$('sp-strip').innerHTML = stripHtml();
  S.$('sp-count').textContent = `${S.text.length}/${S.maxLen}`;
  S.$('sp-count').classList.toggle('sp-over', S.text.length > S.maxLen);
  S.$('sp-shelf').innerHTML = savedHtml();
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
  st.textContent = `
  #spray-overlay { position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
    background:rgba(3,4,6,0.74); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
  /* The can's own theme tokens. The shared colour wheel copies these off #sp-root
     when it opens, which is how one stylesheet gives the paint shop brass and the
     spray can fluorescent green. */
  #sp-root { --hb-atm-accent:#39ff88; --hb-surf:#1c211d; --hb-surf-lo:#12150f; --hb-surf-mid:#242a22;
    --hb-bevel-hi:rgba(255,255,255,0.07); --hb-bevel-lo:rgba(0,0,0,0.55);
    --tos-fg:#dff7e4; --tos-fg-dim:#7fa98a; --tos-fg-dim2:#5b7d64;
    width:min(560px, calc(100vw - 24px)); max-height:calc(100vh - 40px); overflow-y:auto; padding:14px 16px 16px;
    color:var(--tos-fg); border-radius:10px; animation:spBoot .2s ease-out;
    background:linear-gradient(168deg,#2a3029 0%, #1a1e19 22%, #0c0e0b 100%);
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 34%, transparent);
    box-shadow:0 20px 60px rgba(0,0,0,0.65), inset 0 1px 0 var(--hb-bevel-hi),
      0 0 26px color-mix(in srgb, var(--hb-atm-accent) 14%, transparent);
    scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--hb-atm-accent) 50%, transparent) transparent; }
  @keyframes spBoot { from { opacity:0; transform:scale(0.985) } to { opacity:1; transform:none } }
  #sp-root .sp-brand { font-size:11px; letter-spacing:3px; text-transform:uppercase; color:var(--hb-atm-accent); }
  #sp-root .sp-sub { font-size:10px; letter-spacing:1.4px; color:var(--tos-fg-dim2); margin-top:2px; }
  #sp-root .sp-lab { font-size:9px; letter-spacing:2px; text-transform:uppercase; color:var(--tos-fg-dim); margin:12px 0 5px; }
  /* The honest preview: the tag on a strip of wall, rendered by the same code the
     room line will use. */
  #sp-root .sp-wall { margin-top:9px; padding:16px 12px; min-height:56px; border-radius:7px; text-align:center;
    font-size:19px; line-height:1.35; word-break:break-word; color:#e7e7e7;
    background:repeating-linear-gradient(0deg,#2a2724 0 13px,#231f1c 13px 15px),
      repeating-linear-gradient(90deg,rgba(0,0,0,0.22) 0 1px,transparent 1px 46px);
    box-shadow:inset 0 0 0 1px rgba(0,0,0,0.5), inset 0 10px 26px rgba(0,0,0,0.45); }
  #sp-root .sp-empty { color:var(--tos-fg-dim2); font-size:11px; letter-spacing:1px; font-style:italic; }
  #sp-root .sp-input { width:100%; box-sizing:border-box; margin-top:10px; padding:8px 10px; font-family:inherit; font-size:14px;
    letter-spacing:1px; color:var(--tos-fg); background:rgba(0,0,0,0.4); outline:none;
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 26%, transparent); border-radius:7px; }
  #sp-root .sp-input:focus { border-color:var(--hb-atm-accent); box-shadow:0 0 0 2px color-mix(in srgb, var(--hb-atm-accent) 20%, transparent); }
  #sp-root .sp-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  #sp-root .sp-count { font-size:10px; letter-spacing:1px; color:var(--tos-fg-dim2); margin-left:auto; }
  #sp-root .sp-count.sp-over { color:#ff6b7f; }
  /* The letter strip — one cell per character, which is the whole point of the can.
     Click one, drag a run, shift-click to extend. */
  #sp-root .sp-strip { display:flex; flex-wrap:wrap; gap:2px; padding:7px; border-radius:7px; min-height:34px;
    background:rgba(0,0,0,0.34); box-shadow:inset 0 1px 3px var(--hb-bevel-lo); user-select:none; }
  #sp-root .sp-cell { min-width:17px; padding:3px 2px; text-align:center; font-size:15px; cursor:pointer; border-radius:3px;
    border:1px solid transparent; background:rgba(255,255,255,0.03); }
  #sp-root .sp-cell:hover { border-color:color-mix(in srgb, var(--hb-atm-accent) 45%, transparent); }
  #sp-root .sp-cell.sp-on { background:color-mix(in srgb, var(--hb-atm-accent) 22%, transparent);
    border-color:var(--hb-atm-accent); }
  #sp-root .sp-scope { font-size:10px; letter-spacing:1px; color:var(--hb-atm-accent); }
  #sp-root .sp-btn { padding:6px 10px; font-family:inherit; font-size:11px; letter-spacing:1px; cursor:pointer;
    color:var(--tos-fg); background:linear-gradient(165deg,var(--hb-surf),var(--hb-surf-lo));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 28%, transparent); border-radius:6px;
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi); transition:filter .12s, border-color .12s; }
  #sp-root .sp-btn:hover:not(:disabled) { filter:brightness(1.15); border-color:var(--hb-atm-accent); }
  #sp-root .sp-btn:disabled { opacity:0.4; cursor:default; }
  #sp-root .sp-btn.sp-active { color:#08120b; background:linear-gradient(165deg,var(--hb-atm-accent),#1fbf63); border-color:var(--hb-atm-accent); }
  #sp-root .sp-btn.sp-go { flex:1 1 auto; font-weight:bold; text-transform:uppercase; color:#08120b;
    background:linear-gradient(165deg,var(--hb-atm-accent),#1fbf63); border-color:var(--hb-atm-accent);
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.25), 0 0 14px color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); }
  #sp-root .sp-swatch { display:inline-flex; align-items:center; gap:6px; padding:3px 8px 3px 4px; cursor:pointer; font-family:inherit;
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 40%, transparent); border-radius:7px;
    background:linear-gradient(165deg,var(--hb-surf),var(--hb-surf-lo)); box-shadow:inset 0 1px 0 var(--hb-bevel-hi); }
  #sp-root .sp-swatch i { width:24px; height:18px; border-radius:4px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px rgba(0,0,0,0.4); }
  #sp-root .sp-swatch em { font-style:normal; font-size:9px; letter-spacing:0.8px; color:var(--tos-fg-dim); }
  #sp-root .sp-rack { display:grid; grid-template-columns:repeat(16,1fr); gap:3px; margin-top:7px; padding:5px; border-radius:7px;
    background:rgba(0,0,0,0.3); box-shadow:inset 0 1px 3px var(--hb-bevel-lo); }
  #sp-root .sp-cap { height:15px; padding:0; border-radius:3px; cursor:pointer; border:1px solid rgba(0,0,0,0.4);
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.25); transition:transform .1s; }
  #sp-root .sp-cap:hover { transform:scale(1.2); }
  #sp-root .sp-shelf { display:flex; flex-direction:column; gap:4px; max-height:132px; overflow-y:auto; }
  #sp-root .sp-saved { display:flex; align-items:center; gap:7px; padding:3px 5px; border-radius:6px; background:rgba(0,0,0,0.28); }
  #sp-root .sp-load { flex:1 1 auto; text-align:left; padding:4px 7px; font-family:inherit; font-size:14px; cursor:pointer;
    color:#e7e7e7; background:rgba(255,255,255,0.04); border:1px solid transparent; border-radius:5px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  #sp-root .sp-load:hover { border-color:var(--hb-atm-accent); }
  #sp-root .sp-saved-name { flex:0 0 auto; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    font-size:9px; letter-spacing:1px; color:var(--tos-fg-dim2); }
  #sp-root .sp-bin { flex:0 0 auto; width:20px; height:20px; padding:0; line-height:1; cursor:pointer; font-family:inherit;
    color:var(--tos-fg-dim2); background:none; border:1px solid transparent; border-radius:5px; }
  #sp-root .sp-bin:hover { color:#ff8a8a; border-color:rgba(255,120,120,0.4); }
  #sp-root .sp-name { flex:0 0 130px; box-sizing:border-box; padding:6px 8px; font-family:inherit; font-size:11px; outline:none;
    color:var(--tos-fg); background:rgba(0,0,0,0.4); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 26%, transparent); border-radius:6px; }
  #sp-root .sp-note { min-height:14px; margin-top:7px; font-size:10px; letter-spacing:1px; color:var(--tos-fg-dim2); }
  #sp-root .sp-note.sp-bad { color:#ff6b7f; }
  #sp-root .sp-foot { display:flex; gap:8px; margin-top:11px; }
  @media (max-width:560px) { #sp-root .sp-rack { grid-template-columns:repeat(8,1fr); } }
  `;
  document.head.appendChild(st);
}

const WALL_OPT = (w, sel) => `<option value="${esc(w.dir)}"${w.dir === sel ? ' selected' : ''}>${esc(w.dir)} — ${esc(w.name)}</option>`;

// msg: { walls:[{dir,name}], wall, saved, maxLen, saveCap, can:{name,quantity}, over }
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
          <div class="sp-sub">${esc(msg.can?.name || 'spray paint')} — ${Number(msg.can?.quantity || 1)} in the bag</div>
        </div>
        <div style="margin-left:auto"><select class="sp-btn" id="sp-wall">${walls.map(w => WALL_OPT(w, wall)).join('')}</select></div>
      </div>
      <div class="sp-wall" id="sp-preview"></div>
      <input class="sp-input" id="sp-text" maxlength="${Number(msg.maxLen) || 48}" placeholder="what are you writing?" autocomplete="off" spellcheck="false">
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
    onClose: () => { closeColorPicker({ silent: true }); S = null; },
  });

  const $ = (id) => overlay.querySelector('#' + id);
  S = {
    text: '', colors: [], flags: [], sel: null, ink: '#ff2d55',
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
  $('sp-wall').addEventListener('change', (e) => { S.wall = e.target.value; });
  $('sp-rainbow').addEventListener('click', rainbow);
  $('sp-strip-btn').addEventListener('click', strip);
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

  if (msg.over) note(`${msg.over.handle}'s tag is up here. Yours goes straight over it.`);
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
