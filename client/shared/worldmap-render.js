// The world map: the placed regions, the country between them and the numbered highways, drawn
// on a canvas you can zoom, pan and hover. One renderer for the tablet's World Map app and the
// dev tool at tools/worldmap, so the two cannot draw the world two ways.
//
// Everything between the regions comes from client/shared/wildlands.js, the same answer the flight
// floor, the highway verges and the walked void use. The server only sends what it alone knows: the
// placed tiles (as one character per tile, by biome) and this week's roads.
//
// data = {
//   rect:    { x0, y0, x1, y1 }                  world tiles to cover (defaults to the wildlands rect)
//   regions: [{ id, name, minX, minY, maxX, maxY, rows: [string] }]   one char per placed tile
//   key:     { char: biome | 'road' | 'building' | 'airfield' }       what the row chars mean
//   roads:   [{ num, a, b, pts: [x, y, x, y, …] }]                     world-tile polylines
//   you:     { x, y } | null
// }
import { BIOME_GROUND } from './ground-palette.js';
import { wildlandsAt, wildlandsColour, landformHeight, landforms, wildlandsRect } from './wildlands.js';
import { hnoise2 } from './landform.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SPECIAL = { road: [52, 55, 60], building: [214, 206, 190], airfield: [224, 195, 65] };
const NAMES = {
  badlands: 'Dirt margin', redrock: 'Rust-red mesa', scarlet: 'Scarlet badlands', ash: 'Ash flats',
  scrub: 'Scrubland', hardpan: 'Hardpan', basalt: 'Basalt field', lava: 'Lava', plateau: 'Plateau', cliff: 'Cliff',
  water: 'Water', citycore: 'City', parkland: 'Parkland', park: 'Park', forest: 'Forest', airport: 'Airfield',
  alkali: 'Salt pan', sinter: 'Sinter', hotspring: 'Hot spring', deadwood: 'Deadwood', asphalt: 'Tarmac', concrete: 'Concrete',
};
export const biomeName = (b) => NAMES[b] || b;

// Relief for the map: a gentle hillshade of the same lattice noise plus any landform's cone.
function relief(x, y) {
  const e = (p, q) => hnoise2(p * 0.05, q * 0.05) * 0.8 + hnoise2(p * 0.17, q * 0.17) * 0.15 + landformHeight(p, q) * 6;
  const g = e(x + 0.5, y) - e(x, y), h = e(x, y + 0.5) - e(x, y);
  return clamp(1 + (g + h) * 3, 0.72, 1.28);
}

export function mountWorldMap(host, data, opts = {}) {
  const rect = data.rect || wildlandsRect();
  const X0 = rect.x0, Y0 = rect.y0, W = rect.x1 - rect.x0 + 1, H = rect.y1 - rect.y0 + 1;
  const tablet = opts.tablet !== false;
  // `placedOnly`: the hand-authored world alone — placed tiles on black, with none of the generated
  // ground, highways, footpaths or landforms. For comparing the two.
  const placedOnly = !!opts.placedOnly;

  // Placed tiles into a lookup: index → [biome or special, region name]
  const placed = new Map();
  for (const r of data.regions || []) {
    (r.rows || []).forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]; if (ch === ' ') continue;
        placed.set((r.minY + j - Y0) * W + (r.minX + i - X0), [data.key?.[ch] || 'badlands', r.name]);
      }
    });
  }
  const toMap = (pts) => pts.map((v, i) => (i % 2 ? v - Y0 + 0.5 : v - X0 + 0.5));
  const roads = (data.roads || []).map((l) => ({ ...l, p: toMap(l.pts) }));
  // Pieces of tarmac by highway type (client/shared/highways.js). A payload without them (an older
  // server) falls back to drawing each journey as one branch.
  const pieces = (data.pieces?.length ? data.pieces : roads.map((r) => ({ type: 'branch', nums: r.num ? [r.num] : [], pts: r.pts })))
    .map((g) => ({ ...g, p: toMap(g.pts) }));

  // The ground image, one pixel per tile.
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  {
    const g = base.getContext('2d'), im = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const x = i % W + X0, y = ((i / W) | 0) + Y0, p = placed.get(i);
      let c;
      if (p) c = SPECIAL[p[0]] || BIOME_GROUND[p[0]] || BIOME_GROUND.badlands;
      else if (placedOnly) c = [7, 9, 12];
      else {
        const at = wildlandsAt(x, y);
        if (at.sea) c = BIOME_GROUND.water;
        else { const k = wildlandsColour(x, y, BIOME_GROUND, at), s = relief(x, y); c = [k[0] * s, k[1] * s, k[2] * s]; }
      }
      im.data[i * 4] = c[0]; im.data[i * 4 + 1] = c[1]; im.data[i * 4 + 2] = c[2]; im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }

  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';   // the tooltip is positioned inside it
  const cv = document.createElement('canvas');
  cv.style.cssText = 'display:block;width:100%;height:100%;cursor:crosshair;touch-action:none';
  const tip = document.createElement('div');
  tip.style.cssText = 'position:absolute;pointer-events:none;display:none;padding:6px 8px;border-radius:4px;font:12px/1.35 ui-monospace,monospace;max-width:260px;z-index:2;'
    + (tablet ? 'background:#0c1014ee;color:#d8e2e8;border:1px solid #f2b01e66' : 'background:#fff;color:#111;border:1px solid #ccc');
  host.append(cv, tip);
  const ctx = cv.getContext('2d');
  let sc = 1, ox = 0, oy = 0, hov = null, drag = null;

  const size = () => {
    const b = host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, b.width * dpr); cv.height = Math.max(1, b.height * dpr);
    return b;
  };
  const home = () => {
    const b = size(); sc = Math.min(b.width / W, b.height / H); ox = (b.width - W * sc) / 2; oy = (b.height - H * sc) / 2;
    // A phone held upright: the world is about twice as wide as it is tall, so fitting all of it
    // to the width left a strip across the middle of an empty screen. Fill the height instead and
    // open on "you"; the rest is a drag or a pinch away. Wide hosts (every desktop) are untouched.
    if (tablet && H * sc < b.height * 0.5) {
      sc = b.height / H; oy = 0;
      const cx = data.you ? data.you.x - X0 + 0.5 : W / 2;
      ox = clamp(b.width / 2 - cx * sc, b.width - W * sc, 0);
    }
  };

  const path = (p) => { ctx.beginPath(); for (let i = 0; i < p.length; i += 2) { const x = ox + p[i] * sc, y = oy + p[i + 1] * sc; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } };
  // ── HOW EACH TYPE OF ROAD LOOKS ──
  // These are the remains of a network that used to work: the trunk is old tarmac gone grey, its
  // centre line mostly worn away; the branches and slip roads are packed dirt with the wheel ruts
  // the traffic still cuts. Widths are in tiles, held to a pixel range so a road reads at any zoom.
  // These are the remains of a network that used to work: old tarmac gone grey and broken up, the
  // centre line mostly worn away, and gaps where the surface has gone to gravel. A trunk is wider.
  const LOOK = {
    trunk:  { w: 2.4, edge: '#1c1d1f', body: '#555a5f', gap: '#7c7462', mid: 'rgba(214,190,120,0.5)' },
    branch: { w: 1.7, edge: '#1c1d1f', body: '#4d5156', gap: '#7a7160', mid: 'rgba(214,190,120,0.35)' },
    ramp:   { w: 1.0, edge: '#1c1d1f', body: '#4d5156', gap: '#7a7160' },
    spur:   { w: 1.1, edge: '#1c1d1f', body: '#4a4d51', gap: '#7a7160' },
  };
  const lookOf = (t) => LOOK[t] || LOOK.branch;
  const trails = (data.trails || []).map((t) => ({ p: toMap(t.pts), camps: (t.camps || []).map(([x, y]) => [x - X0 + 0.5, y - Y0 + 0.5]) }));
  const px = (tiles, lo, hi) => Math.max(lo, Math.min(hi, tiles * sc));
  function drawRoads() {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // the footpaths first, under everything: a thin dotted track, and its camps
    for (const t of trails) {
      path(t.p); ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(226,206,160,0.55)'; ctx.lineWidth = Math.max(1, Math.min(2, sc * 0.25)); ctx.stroke(); ctx.setLineDash([]);
      if (sc > 2.5) for (const [x, y] of t.camps) { ctx.beginPath(); ctx.arc(ox + x * sc, oy + y * sc, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#e8b25a'; ctx.fill(); }
    }
    const order = [...pieces].sort((a, b) => lookOf(a.type).w - lookOf(b.type).w);
    for (const g of order) { const L = lookOf(g.type); path(g.p); ctx.strokeStyle = L.edge; ctx.lineWidth = px(L.w, 2, 30) + 2.5; ctx.stroke(); }
    for (const g of order) { const L = lookOf(g.type); path(g.p); ctx.strokeStyle = L.body; ctx.lineWidth = px(L.w, 1.5, 30); ctx.stroke(); }
    for (const g of order) {
      const L = lookOf(g.type), w = px(L.w, 1.5, 30);
      if (L.mid && w > 6) { path(g.p); ctx.setLineDash([w * 0.9, w * 1.6]); ctx.strokeStyle = L.mid; ctx.lineWidth = Math.max(1, w * 0.07); ctx.stroke(); ctx.setLineDash([]); }
    }
  }
  // A polyline moved sideways by d tiles (for the ruts).
  function offset(p, d) {
    const out = [];
    for (let i = 0; i < p.length; i += 2) {
      const j = Math.min(i + 2, p.length - 2), k = Math.max(0, i - 2);
      const dx = p[j] - p[k], dy = p[j + 1] - p[k + 1], l = Math.hypot(dx, dy) || 1;
      out.push(p[i] - (dy / l) * d, p[i + 1] + (dx / l) * d);
    }
    return out;
  }
  // A trunk wears the interstate-style shield, a branch a plain plate; a shared stretch lists every
  // route on it.
  function shield(nums, x, y, kind) {
    const text = nums.join('/'), w = Math.max(24, 10 + text.length * 8), h = 22;
    ctx.save(); ctx.translate(x, y); ctx.beginPath();
    if (kind === 'interstate') {
      ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2, h * 0.15);
      ctx.quadraticCurveTo(w / 2, h * 0.55, 0, h * 0.72); ctx.quadraticCurveTo(-w / 2, h * 0.55, -w / 2, h * 0.15); ctx.closePath();
    } else { ctx.rect(-w / 2, -h / 2, w, h * 0.95); }
    ctx.fillStyle = tablet ? '#101418' : '#f4f1e6'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = tablet ? '#f2b01e' : '#1d2a4a'; ctx.stroke();
    ctx.fillStyle = tablet ? '#f2b01e' : '#1d2a4a'; ctx.font = '700 12px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0); ctx.restore();
  }
  function label(t, x, y, c) { ctx.lineWidth = 3; ctx.strokeStyle = '#000b'; ctx.strokeText(t, x, y); ctx.fillStyle = c; ctx.fillText(t, x, y); }
  function overlay(b) {
    if (!tablet) return;
    ctx.fillStyle = 'rgba(20,40,60,0.10)'; ctx.fillRect(0, 0, b.width, b.height);
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; for (let y = 0; y < b.height; y += 3) ctx.fillRect(0, y, b.width, 1);
    const g = ctx.createRadialGradient(b.width / 2, b.height / 2, Math.min(b.width, b.height) * 0.35, b.width / 2, b.height / 2, Math.max(b.width, b.height) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)'); ctx.fillStyle = g; ctx.fillRect(0, 0, b.width, b.height);
  }
  function draw() {
    const b = host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, b.width, b.height);
    ctx.imageSmoothingEnabled = false;
    if (tablet) ctx.filter = 'saturate(0.72) contrast(1.12) brightness(0.86) hue-rotate(-6deg)';
    ctx.drawImage(base, ox, oy, W * sc, H * sc); ctx.filter = 'none';
    if (!placedOnly) drawRoads();
    for (const r of data.regions || []) {
      ctx.strokeStyle = tablet ? '#5ad1ff88' : '#fff8'; ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + (r.minX - X0) * sc, oy + (r.minY - Y0) * sc, (r.maxX - r.minX + 1) * sc, (r.maxY - r.minY + 1) * sc);
    }
    if (hov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(ox + hov[0] * sc, oy + hov[1] * sc, Math.max(sc, 2), Math.max(sc, 2)); }
    ctx.font = '600 12px ui-monospace,monospace'; ctx.textAlign = 'center';
    for (const r of data.regions || []) label(r.name, ox + ((r.minX + r.maxX + 1) / 2 - X0) * sc, oy + (r.minY - Y0) * sc - 6, tablet ? '#8fe3ff' : '#fff');
    if (!placedOnly) for (const l of landforms()) label(l.name, ox + (l.x - X0) * sc, oy + (l.y - Y0 - l.radius * 0.55) * sc, '#ff9a5a');
    // One shield per set of numbers, on the longest piece carrying exactly that set.
    const best = new Map();
    for (const g of pieces) {
      if (!g.nums?.length || g.type === 'ramp') continue;
      const k = g.nums.join('/'), len = g.L ?? g.p.length, cur = best.get(k);
      if (!cur || len > (cur.L ?? cur.p.length)) best.set(k, g);
    }
    if (!placedOnly) for (const g of best.values()) {
      const k = Math.floor(g.p.length / 4) * 2;
      shield(g.nums, ox + g.p[k] * sc, oy + g.p[k + 1] * sc, g.shield || (g.type === 'trunk' ? 'interstate' : 'plate'));
    }
    if (data.you) {
      const x = ox + (data.you.x - X0 + 0.5) * sc, y = oy + (data.you.y - Y0 + 0.5) * sc;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#f2b01e'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
      label('you', x, y - 9, '#f2b01e');
    }
    overlay(b);
    opts.onView?.({ sc, ox, oy });   // lets a page keep two maps in step
  }

  // Which road a tile is on: nearest centreline within two tiles.
  function roadAt(gx, gy) {
    let best = null, bd = 2.2;
    for (const r of pieces) for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i] - 0.5, ay = r.p[i + 1] - 0.5, bx = r.p[i + 2] - 0.5 - ax, by = r.p[i + 3] - 0.5 - ay;
      const l2 = bx * bx + by * by || 1, t = clamp(((gx - ax) * bx + (gy - ay) * by) / l2, 0, 1);
      const d = Math.hypot(gx - (ax + t * bx), gy - (ay + t * by));
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  function describe(gx, gy) {
    const x = gx + X0, y = gy + Y0, p = placed.get(gy * W + gx), r = placedOnly ? null : roadAt(gx, gy);
    const lines = [];
    if (r) lines.push(`<b>${r.nums?.length ? 'Route ' + r.nums.join('/') : 'Road'}</b>`, (r.label || r.type || 'highway').replace(/^./, (c) => c.toUpperCase()));
    else if (p) lines.push(`<b>${p[1]}</b>`, biomeName(p[0]));
    else {
      const at = placedOnly ? null : wildlandsAt(x, y);
      if (!at) lines.push('<b>Nothing authored here</b>');
      else if (at.sea) lines.push('<b>Open sea</b>');
      else if (at.landform) lines.push(`<b>${at.landform.name}</b>`, { crater: 'The crater', lava: 'Lava flow', flank: 'Basalt flank' }[at.landform.part] || at.landform.part);
      else lines.push(`<b>${biomeName(at.biome)}</b>`, 'The wildlands');
    }
    lines.push(`<span style="opacity:.6">${x}, ${y}</span>`);
    return lines.join('<br>');
  }

  cv.addEventListener('wheel', (e) => {
    e.preventDefault(); const b = cv.getBoundingClientRect(), f = Math.exp(-e.deltaY * 0.0015);
    const nx = e.clientX - b.left, ny = e.clientY - b.top; ox = nx - (nx - ox) * f; oy = ny - (ny - oy) * f; sc *= f; draw();
  }, { passive: false });
  // ── POINTERS: A MOUSE HOVERS, A FINGER TAPS AND PINCHES ──
  // It was built for a mouse: the wheel zoomed and hovering named the ground. A touch screen has
  // neither, so on a phone the map could be dragged and nothing else. Every live pointer is kept,
  // one of them drags, two of them pinch (zooming about the point between the fingers, and
  // following it as they move), and a press that lifts where it went down is a tap, which names
  // the ground the way a hover does.
  const pts = new Map();
  let pinch = null, tap = null;
  const pinchNow = () => {
    const [a, c] = [...pts.values()];
    return { d: Math.hypot(a[0] - c[0], a[1] - c[1]) || 1, mx: (a[0] + c[0]) / 2, my: (a[1] + c[1]) / 2 };
  };
  function nameAt(clientX, clientY) {
    const b = cv.getBoundingClientRect(), mx = clientX - b.left, my = clientY - b.top;
    const gx = Math.floor((mx - ox) / sc), gy = Math.floor((my - oy) / sc);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) { hov = null; tip.style.display = 'none'; draw(); return; }
    hov = [gx, gy]; tip.innerHTML = describe(gx, gy); tip.style.display = 'block';
    tip.style.left = Math.max(4, Math.min(mx + 14, b.width - 200)) + 'px'; tip.style.top = Math.max(4, Math.min(my + 14, b.height - 60)) + 'px'; draw();
  }
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { drag = [e.clientX, e.clientY, ox, oy]; tap = [e.clientX, e.clientY]; pinch = null; }
    else if (pts.size === 2) { drag = null; tap = null; pinch = { ...pinchNow(), sc, ox, oy }; tip.style.display = 'none'; }
  });
  const lift = (e) => {
    if (!pts.delete(e.pointerId)) return;
    if (pts.size >= 2) { pinch = { ...pinchNow(), sc, ox, oy }; return; }
    pinch = null;
    // One finger left of a pinch carries on as a drag from where it is now, never as a tap.
    if (pts.size === 1) { const [p] = pts.values(); drag = [p[0], p[1], ox, oy]; tap = null; return; }
    drag = null;
    if (tap && e.type === 'pointerup' && e.pointerType !== 'mouse' && Math.hypot(e.clientX - tap[0], e.clientY - tap[1]) < 8) nameAt(e.clientX, e.clientY);
    tap = null;
  };
  cv.addEventListener('pointerup', lift);
  cv.addEventListener('pointercancel', lift);
  cv.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pts.size >= 2) {
      const s = pinchNow(), b = cv.getBoundingClientRect(), f = s.d / pinch.d;
      sc = pinch.sc * f;
      ox = (s.mx - b.left) - (pinch.mx - b.left - pinch.ox) * f;
      oy = (s.my - b.top) - (pinch.my - b.top - pinch.oy) * f;
      draw(); return;
    }
    if (drag) {
      if (tap && Math.hypot(e.clientX - tap[0], e.clientY - tap[1]) >= 8) tap = null;
      ox = drag[2] + e.clientX - drag[0]; oy = drag[3] + e.clientY - drag[1]; tip.style.display = 'none'; draw(); return;
    }
    if (e.pointerType === 'mouse') nameAt(e.clientX, e.clientY);
  });
  // A finger "leaves" the moment it lifts, which would take a tap's label straight back down.
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'mouse') return; tip.style.display = 'none'; hov = null; draw(); });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { home(); draw(); }) : null;
  ro?.observe(host);
  home(); draw();
  // Centre the view on a world tile at a given zoom (pixels per tile). The tablet opens on "you".
  function focus(x, y, zoom) {
    const b = host.getBoundingClientRect(); if (zoom) sc = zoom;
    ox = b.width / 2 - (x - X0 + 0.5) * sc; oy = b.height / 2 - (y - Y0 + 0.5) * sc; draw();
  }
  if (opts.focus) focus(opts.focus.x, opts.focus.y, opts.focus.zoom);
  const view = () => ({ sc, ox, oy });
  const setView = (v) => { sc = v.sc; ox = v.ox; oy = v.oy; draw(); };
  return { redraw: draw, focus, view, setView, destroy() { ro?.disconnect(); cv.remove(); tip.remove(); } };
}
