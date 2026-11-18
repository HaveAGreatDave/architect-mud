// THE HOLDING PICTURE: what a TV shows while a game's 3-D view loads, and until its first play.
//
// A title card, not a venue: the show's mark in the middle, the two clubs' crests large either side
// over their own colours, the score or "vs", the booth's last line (wrapped, never clipped) and the
// standings crawling along the bottom, with a low crowd under it. tv.js puts it up in the Gameday box
// the moment the box opens and takes it down when the view says its game is live (`opts.onLive`).
// Never in a seat or a box: there you're at the game.
//
// The wall set in a room paints the page to a texture (page-paint.js), which draws canvases, SVG,
// gradients and words but no transforms or shadows, so the backdrop is a canvas and nothing in the
// graphics needs a shadow or a rotation to be read.
//
// It knows nothing of any league: names, records, colours, crests and the brand come in `info`.

import { loadCss } from '../../../shared/dom.js';
import { fieldBed } from '../../../shared/field-recordings.js';

const CSS = await loadCss(new URL('./tv-hold.css', import.meta.url));

// how often the card is painted
const FRAME_MS = 50;
// how long the picture takes to go once the game is live (s), matched in tv-hold.css
const OUT_MS = 650;
// the crowd under it: quiet, under the booth
const BED_LUFS = -30, BED_FADE_IN = 2.5, BED_FADE_OUT = 0.8;

function ensureCss(doc) {
  if (!CSS || doc.getElementById('tv-hold-styles')) return;
  const s = doc.createElement('style');
  s.id = 'tv-hold-styles';
  s.textContent = CSS;
  doc.head.appendChild(s);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const motionOff = (doc) => doc.documentElement.getAttribute('data-motion') === 'off';

// ── the crowd bed ───────────────────────────────────────────────────────────
// One loop per kind of venue for the whole page, however many sets are holding (the tablet and the
// wall can both be on).
const beds = new Map();   // id -> { users, stopAt }
function bedOn(kind) {
  const AE = globalThis.AudioEngine;
  const layer = fieldBed(kind === 'rink' ? 'crowd_arena' : 'crowd_park', BED_LUFS, { filter: { type: 'lowpass', freq: 1800, q: 0.5 } });
  if (!AE?.loopSound || !AE.preloadSamples || !layer) return null;
  const id = `tv-hold-${kind}`;
  const b = beds.get(id) || { users: 0, stopAt: null };
  beds.set(id, b);
  b.users++;
  clearTimeout(b.stopAt); b.stopAt = null;
  AE.preloadSamples([layer.sample]).then(() => {
    if (!b.users || !AE.sampleReady?.(layer.sample)) return;
    if (!AE.isLooping?.(id)) AE.loopSound({ id, name: id, category: 'tv_fx', priority: 3, config: { layers: [layer] } }, { whole: true, gain: 0 });
    AE.setLoopGain?.(id, 1, BED_FADE_IN);
  }).catch(() => { /* no crowd, the picture still holds */ });
  return id;
}
function bedOff(id) {
  const AE = globalThis.AudioEngine, b = beds.get(id);
  if (!b || !b.users) return;
  if (--b.users) return;
  AE?.setLoopGain?.(id, 0, BED_FADE_OUT);
  b.stopAt = setTimeout(() => { if (!b.users) AE?.stopLoop?.(id); }, BED_FADE_OUT * 1000 + 200);
}

// ── the card ────────────────────────────────────────────────────────────────
// No venue: the two clubs' colours meeting on a slanted seam, a fine pinstripe, and a slow sheen
// crossing it. The crests and the show's mark are in the graphics over it.

function rgbOf(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()) || /^#?([0-9a-f]{6})$/i.exec(fallback);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;

function createShot(canvas, kind, info) {
  const doc = canvas.ownerDocument, win = doc.defaultView;
  const g = canvas.getContext('2d');
  const away = rgbOf(info.away?.colour, '#3a5a8a'), home = rgbOf(info.home?.colour, '#8a3a3a');
  let raf = 0, last = 0, t0 = 0;

  function size() {
    const box = canvas.getBoundingClientRect(), dpr = Math.min(1.5, win.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(box.width * dpr)), h = Math.max(2, Math.round(box.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function paint(now) {
    const t = (now - t0) / 1000;
    size();
    const w = canvas.width, h = canvas.height, lean = h * 0.22, mid = w / 2;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#05080d'; g.fillRect(0, 0, w, h);
    // each club's half, its colour strongest at the outer edge
    const half = (rgb, x0, x1, top, bot) => {
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, rgba(rgb, 0.85)); gr.addColorStop(1, rgba(rgb, 0.12));
      g.fillStyle = gr; g.beginPath(); g.moveTo(x0, 0); g.lineTo(top, 0); g.lineTo(bot, h); g.lineTo(x0, h); g.closePath(); g.fill();
    };
    half(away, 0, mid, mid + lean, mid - lean);
    half(home, w, mid, mid + lean, mid - lean);
    // a pinstripe over both
    g.save(); g.globalAlpha = 0.07; g.strokeStyle = '#fff'; g.lineWidth = 1;
    for (let x = -h; x < w; x += Math.max(6, w / 120)) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h * 0.5, 0); g.stroke(); }
    g.restore();
    // the seam: dark, then a thin bright edge
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(3, 5, 9, 0.9)'; g.lineWidth = Math.max(6, w * 0.018);
    g.beginPath(); g.moveTo(mid + lean, 0); g.lineTo(mid - lean, h); g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)'; g.lineWidth = Math.max(1, w * 0.002);
    g.beginPath(); g.moveTo(mid + lean + w * 0.012, 0); g.lineTo(mid - lean + w * 0.012, h); g.stroke();
    // the sheen, crossing every eleven seconds
    const k = (t % 11) / 11, sx = -w * 0.4 + k * w * 1.8;
    const sh = g.createLinearGradient(sx - w * 0.15, 0, sx + w * 0.15, 0);
    sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.06)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
    // the lens: darker at the corners and top and bottom, where the graphics sit
    const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  }
  function frame(now) {
    raf = win.requestAnimationFrame(frame);
    if (now - last < FRAME_MS) return;
    last = now;
    paint(now);
  }
  return {
    start() {
      t0 = win.performance.now();
      if (motionOff(doc)) { paint(t0 + 5000); return; }
      raf = win.requestAnimationFrame(frame);
    },
    stop() { if (raf) win.cancelAnimationFrame(raf); raf = 0; },
  };
}

// ── the graphics ────────────────────────────────────────────────────────────

const ord = (n) => { const v = n % 100; return n + ((v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); };

function sideHtml(t, where) {
  const rec = t?.record && /[1-9]/.test(t.record) ? t.record : '';
  const place = rec && t.rank ? ord(t.rank) : '';
  const crest = t?.crest || `<span class="tvh-crest-blank">${esc(String(t?.name || '?').trim().charAt(0))}</span>`;
  return `<div class="tvh-side ${where}" style="--chip:${esc(t?.colour || '#8899aa')}">` +
    `<div class="tvh-crest">${crest}</div>` +
    `<b class="tvh-name">${esc(t?.name || '')}</b>` +
    (rec ? `<span class="tvh-rec">${esc(rec)}${place ? ` · ${esc(place)}` : ''}</span>` : '') +
    `</div>`;
}

// `info`: { sport, away, home: { name, record, rank, colour, crest (html) }, venue, net (html), brand
// (html), show, kickoff ('First pitch coming up'), score: { away, home, status } | null, rows: [{ rank,
// team, rec, tail, colour }], line }
function graphicsHtml(info) {
  const mid = info.score
    ? `<div class="tvh-score"><b>${info.score.away | 0}</b><i>${esc(info.score.status || '')}</i><b>${info.score.home | 0}</b></div>`
    : `<div class="tvh-vs">vs</div>`;
  const rows = Array.isArray(info.rows) ? info.rows : [];
  const items = rows.length
    ? rows.map((r) => `<span class="tvh-crawl-item"><i>${esc(r.rank)}</i><em style="background:${esc(r.colour || '#8899aa')}"></em>${esc(r.team)} <b>${esc(r.rec)}</b>${r.tail != null ? ` <u>${esc(r.tail)}</u>` : ''}</span>`).join('')
    : [`${info.away?.name || ''} at ${info.home?.name || ''}`, info.venue ? `Live from ${info.venue}` : '', info.kickoff || ''].filter(Boolean).map((s) => `<span class="tvh-crawl-item">${esc(s)}</span>`).join('');
  const label = rows.length ? (info.rowsTitle || 'Standings') : (info.show || 'Tonight');
  const logo = info.brand || `<span>${esc(info.show || 'Game Night')}</span>`;
  return `<div class="tvh-top">${info.net || ''}<div class="tvh-live"><i></i>LIVE</div></div>` +
    `<div class="tvh-stage">` +
      sideHtml(info.away, 'away') +
      `<div class="tvh-mid"><div class="tvh-logo">${logo}</div>${mid}` +
        `<div class="tvh-when">${esc(info.score ? 'Picking up the action' : info.kickoff || '')}</div>` +
        (info.venue ? `<div class="tvh-from">Live from <b>${esc(info.venue)}</b></div>` : '') +
      `</div>` +
      sideHtml(info.home, 'home') +
    `</div>` +
    `<div class="tvh-cap">${esc(info.line || '')}</div>` +
    `<div class="tvh-crawl"><div class="tvh-crawl-lbl">${esc(label)}</div><div class="tvh-crawl-win"><div class="tvh-crawl-run"><span class="tvh-crawl-half">${items}</span><span class="tvh-crawl-half">${items}</span></div></div></div>`;
}

export function createHold(host, info) {
  const doc = host.ownerDocument;
  ensureCss(doc);
  const kind = info.sport === 'hockey' ? 'rink' : 'park';
  const root = doc.createElement('div');
  root.className = `tvh tvh-${kind}`;
  root.setAttribute('role', 'img');
  root.innerHTML = `<canvas class="tvh-shot" aria-hidden="true"></canvas><div class="tvh-gfx"></div>`;
  host.appendChild(root);
  const gfx = root.querySelector('.tvh-gfx');
  let cur = { ...info }, key = '';
  const shot = createShot(root.querySelector('.tvh-shot'), kind, info);
  shot.start();
  const bed = bedOn(kind);
  let gone = false;

  function paint() {
    // only rebuilt when something on it changed, so the crawl doesn't jump back to the start
    const { line, ...rest } = cur, k = JSON.stringify(rest);
    if (k !== key) {
      key = k;
      gfx.innerHTML = graphicsHtml(cur);
      const run = gfx.querySelector('.tvh-crawl-run');
      // the same speed however long the crawl is
      if (run) run.style.setProperty('--crawl-s', `${Math.max(14, run.textContent.length * 0.16).toFixed(1)}s`);
    }
    const cap = gfx.querySelector('.tvh-cap');
    if (cap && cap.textContent !== (cur.line || '')) {
      cap.textContent = cur.line || '';
      cap.classList.remove('in'); void cap.offsetWidth; cap.classList.add('in');
    }
    const who = `${cur.away?.name || ''} at ${cur.home?.name || ''}`;
    root.setAttribute('aria-label', `${cur.score ? 'In progress' : 'Pregame'}: ${who}${cur.venue ? `, live from ${cur.venue}` : ''}`);
  }
  paint();

  return {
    kind,
    update(next) { if (!gone) { cur = { ...cur, ...next }; paint(); } },
    caption(text) { if (!gone) { cur.line = String(text || '').replace(/\s+/g, ' ').trim(); paint(); } },
    // the game is live: fade out and go
    live() {
      if (gone) return;
      gone = true;
      if (bed) bedOff(bed);
      root.classList.add('out');
      setTimeout(() => { shot.stop(); root.remove(); }, motionOff(doc) ? 0 : OUT_MS);
    },
    // gone at once (the box shut, the channel changed)
    dispose() {
      if (!gone && bed) bedOff(bed);
      gone = true;
      shot.stop();
      root.remove();
    },
  };
}
