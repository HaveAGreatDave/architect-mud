// THE GRAPHICS OVER A SEQUENCE. Lower thirds, boxes, pictures in pictures, profiles and cards, as HTML
// laid over the set's canvas. GFX in client/shared/sequence.js lists the kinds and their fields; this
// holds how each one draws. Everything is sized in the layer's own container units, so the same
// graphic fits a 340-pixel tablet and a full-screen TV.
//
// `sync` is handed what's up this frame (gfxAt) and adds and takes away. A box or a picture in picture
// keeps a canvas, and the player paints its source on it, since only the player has the renderer.

import { fill, sourceKind, tableRows, profileOf } from '../../../shared/sequence.js';
import { escapeHtml as esc, loadCss } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./sequence-gfx.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('sequence-gfx-css')) return;
  const s = document.createElement('style');
  s.id = 'sequence-gfx-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

const OUT_MS = 240;
const rowOf = (s) => { const i = String(s).lastIndexOf(':'); return i < 0 ? [String(s), ''] : [String(s).slice(0, i).trim(), String(s).slice(i + 1).trim()]; };

const DRAW = {
  lower(el, g, d) {
    el.innerHTML = `<b>${esc(fill(g.text, d))}</b>${g.sub ? `<i>${esc(fill(g.sub, d))}</i>` : ''}`;
  },
  box(el, g, d) {
    el.classList.add(g.side === 'left' ? 'left' : 'right');
    el.innerHTML = `<canvas width="480" height="270"></canvas>${g.title ? `<i>${esc(fill(g.title, d))}</i>` : ''}`;
  },
  pip(el, g, d) {
    el.classList.add(g.corner || 'top-right');
    el.innerHTML = `<canvas width="480" height="270"></canvas>${g.title ? `<i>${esc(fill(g.title, d))}</i>` : ''}`;
  },
  profile(el, g, d) {
    el.classList.add(g.side === 'right' ? 'right' : 'left');
    const p = profileOf(g, d);
    if (p.colour) el.style.setProperty('--sq-club', p.colour);
    const stats = p.stats.filter((s) => String(s).replace(/[:\s]/g, '')).map((s) => { const [k, v] = rowOf(s); return `<div><b>${esc(v || k)}</b><i>${esc(v ? k : '')}</i></div>`; }).join('');
    el.innerHTML = `<div class="sq-photo"><img alt="" hidden><span>${esc(p.num)}</span></div><div class="sq-who"><i>${esc(p.club)}</i><b>${esc(p.name)}</b><i>${esc(p.role)}${p.tonight ? ` · tonight ${esc(p.tonight)}` : ''}</i></div><div class="sq-stats">${stats}</div>`;
  },
  score(el, g, d) {
    el.innerHTML = `<i>${esc(fill(g.title, d))}</i><div><b>${esc(fill(g.left, d))}</b><em>${esc(fill(g.leftScore, d))}</em><em>${esc(fill(g.rightScore, d))}</em><b>${esc(fill(g.right, d))}</b></div><i>${esc(fill(g.sub, d))}</i>`;
  },
  table(el, g, d) {
    el.classList.add(g.side === 'left' ? 'left' : 'right');
    el.innerHTML = `<h4>${esc(fill(g.title, d))}</h4>${tableRows(g, d).filter((r) => r.replace(/[:\s]/g, '')).map((r) => { const [k, v] = rowOf(r); return `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`; }).join('')}`;
  },
  full(el, g, d) {
    el.innerHTML = `<b>${esc(fill(g.title, d))}</b><i>${esc(fill(g.sub, d))}</i>`;
  },
  ticker(el, g, d) {
    el.innerHTML = `<span>${esc(fill(g.text, d))}</span>`;
  },
};

export function createGfxLayer(host, { photo = null } = {}) {
  ensureStyles();
  const root = document.createElement('div');
  root.className = 'sq-layer';
  host.appendChild(root);
  const up = new Map();

  function add(item) {
    const { g, data } = item, el = document.createElement('div');
    el.className = `sq-g sq-${g.kind}`;
    DRAW[g.kind]?.(el, g, data);
    root.appendChild(el);
    const entry = { el, g, data, canvas: el.querySelector('canvas'), source: g.source ? fill(g.source, data) : '' };
    if (g.kind === 'profile' && photo) {
      Promise.resolve(photo(g, data)).then((url) => {
        const img = el.querySelector('img');
        if (!url || !img) return;
        img.src = url; img.hidden = false; el.querySelector('.sq-photo span').hidden = true;
      }).catch(() => { /* the number stands in */ });
    }
    requestAnimationFrame(() => el.classList.add('in'));
    return entry;
  }

  return {
    root,
    // the canvases waiting to be painted: [{ canvas, source, kind, data }]
    get painted() { return [...up.values()].filter((e) => e.canvas).map((e) => ({ canvas: e.canvas, source: e.source, kind: sourceKind(e.source), data: e.data })); },
    sync(list) {
      const keep = new Set();
      for (const it of list) {
        keep.add(it.key);
        if (!up.has(it.key)) up.set(it.key, add(it));
      }
      for (const [k, e] of up) {
        if (keep.has(k)) continue;
        up.delete(k);
        e.el.classList.remove('in');
        setTimeout(() => e.el.remove(), OUT_MS);
      }
    },
    clear() { for (const e of up.values()) e.el.remove(); up.clear(); },
    dispose() { root.remove(); up.clear(); },
  };
}

// A list on the set's wall: the heading, then a row each, big enough to read behind the desk.
export function paintBoard(canvas, title, rows) {
  const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  c.fillStyle = '#0a1018'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#39a0ff'; c.fillRect(0, 0, w, h * 0.022);
  c.fillStyle = '#f2f4f8'; c.textAlign = 'left';
  c.font = `800 ${Math.round(h * 0.13)}px 'K7 Shoulders', Impact, sans-serif`;
  c.fillText(String(title).toUpperCase(), w * 0.07, h * 0.17);
  const step = (h * 0.76) / Math.max(5, rows.length), size = Math.round(step * 0.62);
  rows.forEach((r, i) => {
    const [k, v] = rowOf(r), y = h * 0.26 + step * (i + 0.72);
    c.font = `${size}px 'K7 Audiowide', sans-serif`; c.textAlign = 'left'; c.fillStyle = '#c9d6e6'; c.fillText(k, w * 0.07, y);
    c.font = `800 ${Math.round(size * 1.15)}px 'K7 Shoulders', Impact, sans-serif`; c.textAlign = 'right'; c.fillStyle = '#f2f4f8'; c.fillText(v, w * 0.93, y);
  });
}

// A source with no picture behind it yet: the card a box shows instead of black. It's what a box in
// the Studio shows for the game, and what a viewer sees if the game view isn't running.
export function paintSlate(canvas, title, sub = '') {
  const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#16202e'); g.addColorStop(1, '#0a0d14');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(120,170,230,0.14)'; c.lineWidth = 1;
  for (let x = 0; x < w; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  for (let y = 0; y < h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.fillStyle = '#dfe8f4'; c.textAlign = 'center';
  c.font = `800 ${Math.round(h * 0.15)}px 'K7 Shoulders', Impact, sans-serif`;
  c.fillText(String(title).toUpperCase(), w / 2, h * 0.52);
  if (sub) { c.fillStyle = '#8aa0bc'; c.font = `${Math.round(h * 0.07)}px 'K7 Audiowide', sans-serif`; c.fillText(String(sub).toUpperCase(), w / 2, h * 0.68); }
}
