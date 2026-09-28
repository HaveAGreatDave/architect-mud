// THERMALS — the lift field over the live world, and the red-tails riding it.
//
// The field is client/shared/thermals.js: a pure function of place, time and sky, which the
// cockpit flies in, the server bounds engine-off climb against, and the hawks in birds.js spiral
// up. The server hands this tab the three things a browser cannot know — ground heat per surface
// tile, today's sky and the live aircraft (plugins/flight/thermals-dev.js, RAM only) — and the
// tab runs the same functions over them, so what it draws is what they fly in.
//
// ⚠ DEV ONLY, for the census's reason: pilots find lift by cumulus caps, dust devils, circling
// hawks and the vario. A player-facing map would make all four pointless.

let _thData = null, _thMods = null, _thRaf = 0, _thBase = null, _thBaseKey = '';
const _thQ = { hour: '', weather: '', alt: 1500, px: 4, speed: 1, hawks: true, ground: false };
let _thClock = 0, _thLast = 0, _thHawks = [], _thFetchedAt = 0;

async function fetchThermals() {
  if (!_thMods) {
    const [T, B] = await Promise.all([import('/shared/thermals.js'), import('/shared/birds.js')]);
    _thMods = { T, B };
  }
  _thData = await API('/thermals');
  _thFetchedAt = performance.now();
  _thClock = _thData.now; _thLast = performance.now();
  _thData.heat = new Map(_thData.tiles.map(t => [t[0] + ',' + t[1], t[2]]));
  // Every hawk, found once: the same habitat and territory rolls the renderer and room text use.
  const { B } = _thMods;
  _thHawks = [];
  for (const [x, y, , g, road] of _thData.tiles) {
    if (!g || B.speciesAt(g, x, y, { weather: 'clear', road: !!road }) !== 'hawk') continue;
    const f = B.flockAt(x, y, 1, 'hawk', g);
    if (f) _thHawks.push({ f: { ...f, sp: f.sp || 'hawk' }, trail: [] });
  }
  return _thData;
}

function thSky() {
  const s = _thData.sky || { hour: 12, weather: 'clear', wind: 0 };
  return {
    hour: _thQ.hour === '' ? s.hour : Number(_thQ.hour),
    weather: _thQ.weather || s.weather,
    wind: s.wind,
  };
}

function renderThermals() {
  const el = document.getElementById('list-panel');
  const d = _thData;
  if (!d || d.error) { el.innerHTML = `<div style="padding:24px;color:var(--red)">${d?.error || 'no data'}</div>`; return; }
  const s = d.sky || {};
  el.innerHTML = `
  <div style="padding:12px 14px">
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
      <div class="field" style="flex:0 0 110px"><label>Hour (blank = live)</label>
        <input id="th-hour" type="number" step="0.25" min="0" max="24" value="${_thQ.hour}" placeholder="${Number(s.hour ?? 12).toFixed(2)}"></div>
      <div class="field" style="flex:0 0 120px"><label>Weather</label>
        <select id="th-wx"><option value="">live (${s.weather || '—'})</option>${['clear', 'cloudy', 'fog', 'rain', 'storm'].map(w => `<option ${_thQ.weather === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
      <div class="field" style="flex:0 0 150px"><label>Altitude ft <span id="th-altv">${_thQ.alt}</span></label>
        <input id="th-alt" type="range" min="100" max="8000" step="50" value="${_thQ.alt}"></div>
      <div class="field" style="flex:0 0 80px"><label>px / tile</label><input id="th-px" type="number" min="2" max="12" value="${_thQ.px}"></div>
      <div class="field" style="flex:0 0 90px"><label>Time ×</label>
        <select id="th-speed">${[0, 1, 10, 60, 300].map(n => `<option ${_thQ.speed === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <label style="font-size:12px"><input id="th-hawks" type="checkbox" ${_thQ.hawks ? 'checked' : ''}> hawks</label>
      <label style="font-size:12px"><input id="th-ground" type="checkbox" ${_thQ.ground ? 'checked' : ''}> ground heat</label>
      <button class="action-btn" onclick="loadPanel('thermals')">Refresh</button>
    </div>
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">
      <span style="display:inline-block;width:10px;height:10px;background:#e8743a"></span> lift
      <span style="display:inline-block;width:10px;height:10px;background:#3a6fe8;margin-left:8px"></span> sink
      · rings are live columns · white dot = hawk in lift, red = hawk aloft outside lift · cyan = aircraft
      · in game, <code>__wsTune.thermalDebug = 1</code> draws the columns out of the canopy
    </div>
    <div id="th-wrap" style="overflow:auto;max-height:calc(100vh - 260px);border:1px solid var(--border)"><canvas id="th-cv" style="display:block"></canvas></div>
    <div id="th-read" style="font-size:12px;padding:4px 0;min-height:18px">hover a tile</div>
    <div id="th-stat" style="font-size:12px;color:var(--text-dim)"></div>
  </div>`;
  const bind = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  bind('th-hour', 'change', e => { _thQ.hour = e.target.value; });
  bind('th-wx', 'change', e => { _thQ.weather = e.target.value; });
  bind('th-alt', 'input', e => { _thQ.alt = Number(e.target.value); document.getElementById('th-altv').textContent = _thQ.alt; });
  bind('th-px', 'change', e => { _thQ.px = Math.max(2, Math.min(12, Number(e.target.value) || 4)); });
  bind('th-speed', 'change', e => { _thQ.speed = Number(e.target.value); });
  bind('th-hawks', 'change', e => { _thQ.hawks = e.target.checked; });
  bind('th-ground', 'change', e => { _thQ.ground = e.target.checked; });
  bind('th-cv', 'mousemove', thHover);
  cancelAnimationFrame(_thRaf);
  _thBaseKey = '';
  _thRaf = requestAnimationFrame(thFrame);
}

const thHeat = (x, y) => _thData.heat.get(x + ',' + y) || 0;

function thColour(v) {
  const L = (a, b, t) => a + (b - a) * t;
  if (v > 0) { const t = Math.min(1, v / 900); return [L(20, 232, t), L(26, 116, t), L(34, 58, t)]; }
  const t = Math.min(1, -v / 250); return [L(20, 58, t), L(26, 111, t), L(34, 232, t)];
}

function thRaster(sky) {
  const { T } = _thMods, b = _thData.bounds;
  const w = b.maxx - b.minx + 1, h = b.maxy - b.miny + 1, S = 2;
  const off = document.createElement('canvas'); off.width = w * S; off.height = h * S;
  const g = off.getContext('2d'), img = g.createImageData(w * S, h * S);
  for (let j = 0; j < h * S; j++) for (let i = 0; i < w * S; i++) {
    const x = b.minx + (i + 0.5) / S - 0.5, y = b.miny + (j + 0.5) / S - 0.5;
    let rgb;
    if (_thQ.ground) { const k = thHeat(Math.round(x), Math.round(y)); rgb = [k * 200, k * 150, k * 90]; }
    else rgb = thColour(T.thermalLift(x, y, _thQ.alt, _thClock, sky, thHeat));
    const o = (j * w * S + i) * 4;
    img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return off;
}

function thFrame() {
  const cv = document.getElementById('th-cv');
  if (!cv || !_thData) return;   // the tab closed: stop the loop
  const { T, B } = _thMods;
  const now = performance.now();
  _thClock += (now - _thLast) * _thQ.speed; _thLast = now;
  // Live aircraft go stale; re-ask the server every few seconds while time runs at real speed.
  if (_thQ.speed === 1 && now - _thFetchedAt > 5000) { _thFetchedAt = now; API('/thermals').then(r => { if (_thData && r?.aircraft) { _thData.aircraft = r.aircraft; _thData.sky = r.sky; } }).catch(() => {}); }
  const b = _thData.bounds, px = _thQ.px, sky = thSky();
  const w = b.maxx - b.minx + 1, h = b.maxy - b.miny + 1;
  if (cv.width !== w * px) { cv.width = w * px; cv.height = h * px; }
  const g = cv.getContext('2d');
  const key = [px, sky.hour, sky.weather, _thQ.alt, _thQ.ground, Math.floor(_thClock / 1000)].join('|');
  if (key !== _thBaseKey) { _thBase = thRaster(sky); _thBaseKey = key; }
  g.imageSmoothingEnabled = false;
  g.drawImage(_thBase, 0, 0, w * px, h * px);
  const X = x => (x - b.minx + 0.5) * px, Y = y => (y - b.miny + 0.5) * px;

  let live = 0;
  const seen = new Set();
  g.strokeStyle = 'rgba(255,220,160,0.55)'; g.lineWidth = 1;
  for (let y = b.miny; y <= b.maxy; y += T.THERMAL_CELL) for (let x = b.minx; x <= b.maxx; x += T.THERMAL_CELL) {
    for (const c of T.thermalsNear(x, y, _thClock, sky, thHeat)) {
      const k = c.cx + ',' + c.cy; if (seen.has(k)) continue; seen.add(k); live++;
      g.beginPath(); g.arc(X(c.cx), Y(c.cy), c.r * px, 0, Math.PI * 2); g.stroke();
    }
  }

  let air = 0, inLift = 0;
  if (_thQ.hawks) {
    for (const hk of _thHawks) {
      const st = B.flockState(hk.f, _thClock);
      if (!st.airborne) { hk.trail.length = 0; g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(X(hk.f.ax) - 1, Y(hk.f.ay) - 1, 3, 3); continue; }
      air++;
      hk.trail.push([st.cx, st.cy]); if (hk.trail.length > 90) hk.trail.shift();
      const L = T.thermalLift(st.cx, st.cy, _thQ.alt, _thClock, sky, thHeat);
      if (L > 150) inLift++;
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.beginPath();
      hk.trail.forEach(([tx, ty], n) => n ? g.lineTo(X(tx), Y(ty)) : g.moveTo(X(tx), Y(ty))); g.stroke();
      g.fillStyle = L > 150 ? '#fff' : '#f55'; g.beginPath(); g.arc(X(st.cx), Y(st.cy), Math.max(2, px * 0.45), 0, Math.PI * 2); g.fill();
    }
  }
  for (const a of (_thData.aircraft || [])) {
    g.fillStyle = '#4ee'; g.beginPath(); g.arc(X(a.x), Y(a.y), Math.max(3, px * 0.6), 0, Math.PI * 2); g.fill();
    g.fillStyle = '#bff'; g.font = '11px monospace';
    g.fillText(`${a.name} ${a.alt}ft ${a.vs >= 0 ? '+' : ''}${a.vs} · air ${a.lift >= 0 ? '+' : ''}${a.lift}`, X(a.x) + 6, Y(a.y) - 4);
  }
  const clk = new Date(_thClock).toISOString().slice(11, 19);
  document.getElementById('th-stat').textContent =
    `sun ${T.thermalSun(sky).toFixed(2)} · hour ${Number(sky.hour).toFixed(2)} · ${sky.weather} · wind ${sky.wind} kph · ${live} live columns · `
    + `${_thHawks.length} hawks, ${air} aloft, ${inLift} in lift > 150 ft/min · ${(_thData.aircraft || []).length} aircraft airborne · clock ${clk}`;
  _thRaf = requestAnimationFrame(thFrame);
}

function thHover(e) {
  if (!_thData) return;
  const { T } = _thMods, b = _thData.bounds, px = _thQ.px, r = e.target.getBoundingClientRect();
  const x = b.minx + (e.clientX - r.left) / px - 0.5, y = b.miny + (e.clientY - r.top) / px - 0.5;
  const tx = Math.round(x), ty = Math.round(y);
  const v = T.thermalLift(x, y, _thQ.alt, _thClock, thSky(), thHeat);
  document.getElementById('th-read').textContent =
    `${tx},${ty} · heat ${thHeat(tx, ty).toFixed(2)} · ${v >= 0 ? '+' : ''}${v.toFixed(0)} ft/min at ${_thQ.alt} ft`;
}
