// Birds panel — the census, the curves and a tile probe.
//
// ⚠ IT EXISTS BECAUSE A FLOCK IS ARITHMETIC RATHER THAN AN ENTITY. There is no table of live birds
// anywhere in the process: a flock is a pure function of its anchor tile and the wall clock, so the
// only way to know what is in the world has been to fly to it and look. Every bug this system has
// had was the kind you cannot see that way — 699 city tiles silently dropping every pigeon, gull
// and songbird; every bird in the world built out of the goose mesh; the vulture fully authored and
// living nowhere at all. Each of those is one glance at the table below, and none of them threw.
//
// ⚠ AND THE SEASON IS WHAT FORCED IT. `BIRD_TUNE.season` swings a starling flock from a party of
// nine to a cloud of a thousand across the game year, and a game year is a real year at timeScale
// 1 — so "is it working" is not answerable by looking out of a window. The Hour and Day-of-year
// boxes are the dev twin of RENDER_TUNE.hourForce / doyForce: they move the question, not the world.
//
// ⚠ NOTHING HERE MAY EVER REACH A PLAYER. The unrest system already settled that for the whole
// codebase — a sim with a readout becomes a dashboard to optimise and the flavour dies — so the
// line is the client boundary and this side gets every scalar.

let _faunaQ = { hour: '', doy: '', weather: '', map: 'map_world', top: 40 };
let _faunaData = null;
let _faunaTile = null;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fnum = (n) => (n == null ? '—' : Number(n).toLocaleString());

async function fetchFauna() {
  const p = new URLSearchParams();
  for (const k of ['hour', 'doy', 'weather', 'map', 'top']) if (_faunaQ[k] !== '' && _faunaQ[k] != null) p.set(k, _faunaQ[k]);
  _faunaData = await API('/fauna-census?' + p.toString());
  return _faunaData;
}

// A bar drawn from a 0..1 factor. ⚠ The label carries the NUMBER as well as the bar: a bar alone
// cannot distinguish 0.02 from 0, and the difference between those two is the whole of whether the
// lean season is a floor or a deletion.
function factorBar(v, label, hi) {
  const pct = Math.max(0, Math.min(1, v || 0)) * 100;
  const col = hi ? 'var(--accent)' : 'var(--text-dim)';
  return `<div style="display:flex;align-items:center;gap:6px;font-size:11px">
    <span style="flex:0 0 34px;color:var(--text-dim)">${label}</span>
    <span style="flex:1;height:9px;background:var(--bg-deep,#111);border-radius:2px;overflow:hidden">
      <span style="display:block;height:100%;width:${pct.toFixed(1)}%;background:${col}"></span></span>
    <span style="flex:0 0 42px;text-align:right;font-variant-numeric:tabular-nums">${(v ?? 0).toFixed(3)}</span>
  </div>`;
}

function renderCurves(curves, now) {
  const ids = Object.keys(curves || {});
  if (!ids.length) {
    return `<div style="padding:10px;color:var(--text-dim);font-size:12px">
      No species has a season or a roost window. <code>BIRD_TUNE.season</code> is the switch; with it
      at 0 the curves are inert by design and every flock is its unseasoned roll.</div>`;
  }
  return ids.map((id) => {
    const c = curves[id];
    const peakMonth = c.year.reduce((a, b) => (b.season > a.season ? b : a), c.year[0]);
    const leanMonth = c.year.reduce((a, b) => (b.season < a.season ? b : a), c.year[0]);
    const peakHour = c.day.reduce((a, b) => (b.roost > a.roost ? b : a), c.day[0]);
    return `<div class="fauna-curve" style="border:1px solid var(--border);border-radius:4px;padding:10px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
        <strong style="text-transform:capitalize">${id}</strong>
        <span style="font-size:11px;color:var(--text-dim)">
          right now: season <b>${c.at.season.toFixed(3)}</b> × evening <b>${c.at.roost.toFixed(3)}</b>
          = <b style="color:var(--accent)">${c.at.product.toFixed(4)}</b> of its rolled size</span>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">
        The year — peak ${MONTHS[peakMonth.month - 1]}, leanest ${MONTHS[leanMonth.month - 1]}</div>
      <div style="display:flex;gap:3px;align-items:flex-end;height:46px;margin-bottom:8px">
        ${c.year.map((y) => {
          const on = y.month === now.month;
          return `<div title="${MONTHS[y.month-1]}: ${y.season.toFixed(3)}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
            <div style="height:${Math.max(2, y.season * 100).toFixed(0)}%;background:${on ? 'var(--accent)' : 'var(--text-dim)'};border-radius:1px 1px 0 0"></div>
            <div style="font-size:9px;text-align:center;color:${on ? 'var(--accent)' : 'var(--text-dim)'};margin-top:2px">${MONTHS[y.month-1][0]}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">
        The evening — gathering peaks ${peakHour.hour.toFixed(1)}h
        <span style="opacity:.7">(derived from dayEnd, never a second literal beside it)</span></div>
      <div style="display:flex;gap:1px;align-items:flex-end;height:34px">
        ${c.day.map((d) => {
          const on = Math.abs(d.hour - now.hour) < 0.26;
          return `<div title="${d.hour.toFixed(1)}h: ${d.roost.toFixed(3)}" style="flex:1;height:${Math.max(2, d.roost * 100).toFixed(0)}%;background:${on ? 'var(--accent)' : 'var(--text-dim)'};border-radius:1px 1px 0 0"></div>`;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-dim);margin-top:2px">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    </div>`;
  }).join('');
}

function renderSpeciesTable(species) {
  return `<table class="data-table" style="width:100%">
    <thead><tr>
      <th>Species</th><th>Tiles</th><th>Flocks</th><th>Birds</th>
      <th>Up</th><th>Perched</th><th>Clouds</th>
      <th>Size min/med/max</th><th>Declared</th><th></th>
    </tr></thead><tbody>
    ${species.map((s) => {
      // ⚠ "HOMELESS" IS THE VULTURE'S OWN BUG, NAMED. A species with no tile anywhere is authored
      // and unreachable, which is a completely different thing from one that is simply not about
      // at this hour — and for months nothing could tell them apart.
      const flag = s.homeless
        ? '<span class="badge badge-danger" title="authored and living nowhere: no tile in the world resolves to a place this species uses">homeless</span>'
        : !s.daylight ? `<span class="badge" title="outside its own day window (${s.declared.dayStart}-${s.declared.dayEnd}) — present in the arithmetic, not drawn or mentioned">asleep</span>`
        : s.flocks === 0 ? '<span class="badge" title="has habitat but no tile rolled a flock">no roll</span>' : '';
      return `<tr>
        <td style="text-transform:capitalize"><strong>${s.id}</strong></td>
        <td>${fnum(s.tiles)}</td>
        <td>${fnum(s.flocks)}</td>
        <td><strong>${fnum(s.birds)}</strong></td>
        <td>${fnum(s.airborne)}</td>
        <td>${fnum(s.perched)}</td>
        <td>${s.clouds ? fnum(s.clouds) : ''}</td>
        <td style="font-variant-numeric:tabular-nums">${s.flocks ? `${s.minSize} / <b>${s.medSize}</b> / ${s.maxSize}` : '—'}</td>
        <td style="font-size:11px;color:var(--text-dim)">${s.declared.minFlock}–${s.declared.maxFlock}${s.declared.hasSeason ? ' · seasonal' : ''}${s.declared.thin ? ` · thin ${s.declared.thin}` : ''}</td>
        <td>${flag}</td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
}

function renderHotspots(h) {
  if (!h || !h.length) return '<div style="padding:8px;color:var(--text-dim);font-size:12px">No flocks anywhere on this map at this hour.</div>';
  return `<table class="data-table" style="width:100%">
    <thead><tr><th>Tile</th><th>Species</th><th>Birds</th><th>State</th><th>Place</th><th>Terrain</th><th></th></tr></thead><tbody>
    ${h.map((f) => `<tr>
      <td><code>${f.x},${f.y}</code></td>
      <td style="text-transform:capitalize">${f.sp}</td>
      <td><strong>${fnum(f.n)}</strong></td>
      <td>${f.airborne ? `up at z ${f.z}${f.cloud ? ' <span class="badge badge-accent">murmuration</span>' : ''}` : (f.perched ? 'perched' : 'on the ground')}</td>
      <td>${f.place}${f.place !== f.terrain ? '' : ''}</td>
      <td style="color:var(--text-dim)">${f.terrain}</td>
      <td><button class="action-btn" onclick="faunaProbe(${f.x},${f.y})">probe</button></td>
    </tr>`).join('')}
    </tbody></table>`;
}

function renderTileProbe() {
  const t = _faunaTile;
  if (!t) return '<div style="color:var(--text-dim);font-size:12px">Enter a tile, or press <em>probe</em> on a row above.</div>';
  if (t.error) return `<div style="color:var(--red)">${t.error}</div>`;
  const row = (k, v) => `<tr><td style="color:var(--text-dim);padding-right:12px;white-space:nowrap">${k}</td><td>${v}</td></tr>`;
  let rows = '';
  rows += row('tile', `<code>${t.x},${t.y}</code>${t.zoneId ? ` · ${t.name || ''} <code style="color:var(--text-dim)">${t.zoneId}</code>` : ''}`);
  if (!t.found) return `<table>${rows}${row('why', `<span style="color:var(--red)">${t.why}</span>`)}</table>`;
  rows += row('terrain → place', `<code>${t.paintVsPlace}</code>`);
  if (t.neighbours) rows += row('neighbours', `${t.neighbours.bld} building(s)${t.neighbours.shore ? ', water adjacent' : ''}`);
  if (t.candidates) rows += row('could live here', t.candidates.length ? t.candidates.join(', ') : '<span style="color:var(--text-dim)">nobody</span>');
  if (t.species) {
    rows += row('species', `<strong style="text-transform:capitalize">${t.species}</strong> (${t.habitat})${t.lostTheRoll?.length ? ` <span style="color:var(--text-dim)">— ${t.lostTheRoll.join(', ')} lost the co-tenant roll</span>` : ''}`);
    rows += row('day window', `${t.declared.dayStart}–${t.declared.dayEnd} · ${t.daylight ? 'about now' : '<span style="color:var(--text-dim)">not about now</span>'}`);
    if (t.curve) rows += row('curves', `season ${t.curve.season} × evening ${t.curve.roost}`);
  }
  if (t.flock) {
    const f = t.flock;
    rows += row('flock', `<strong>${fnum(f.n)}</strong> birds, ${f.airborne ? `airborne at z ${f.z}` : (f.perched ? 'perched' : 'on the ground')}${f.cloud ? ' <span class="badge badge-accent">murmuration</span>' : ''}`);
    rows += row('cycle', `u ${f.u} of a ${Math.round(f.period / 1000)}s period · centre ${f.cx},${f.cy}${f.form ? ` · ${f.form}` : ''}`);
    // ⚠ THE LEDGE IS NOT ANSWERABLE HERE AND SAYING SO IS THE POINT. `perchedNow` is shared with
    // the room description; WHICH ledge is captured GLASS geometry the server has never had, so
    // this side can only say a flock wants to be up on something.
    if (f.perched) rows += row('', '<span style="font-size:11px;color:var(--text-dim)">which ledge is GLASS geometry the server does not hold — the window resolves it, this side only knows the flock wants one</span>');
  } else if (t.why) {
    rows += row('why no birds', `<span style="color:var(--amber,#c90)">${t.why}</span>`);
  }
  return `<table style="font-size:12px">${rows}</table>`;
}

function renderFauna() {
  const d = _faunaData;
  const el = document.getElementById('list-panel');
  if (!d || d.error) { el.innerHTML = `<div style="padding:24px;color:var(--red)">${d?.error || 'no data'}</div>`; return; }
  const nowMonth = Number(String(d.now.date || '').slice(5, 7)) || 1;
  const totals = d.species.reduce((a, s) => ({ birds: a.birds + s.birds, flocks: a.flocks + s.flocks }), { birds: 0, flocks: 0 });
  el.innerHTML = `
  <div style="padding:12px 14px">
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
      <div class="field" style="flex:0 0 120px"><label>Hour (blank = live)</label>
        <input id="fauna-hour" type="number" step="0.5" min="0" max="24" value="${_faunaQ.hour}" placeholder="${d.now.hour}"></div>
      <div class="field" style="flex:0 0 130px"><label>Day of year (1–366)</label>
        <input id="fauna-doy" type="number" step="1" min="1" max="366" value="${_faunaQ.doy}" placeholder="${d.now.doy ?? ''}"></div>
      <div class="field" style="flex:0 0 130px"><label>Weather</label>
        <input id="fauna-weather" value="${_faunaQ.weather}" placeholder="${d.now.weather || 'live'}"></div>
      <button class="action-btn" onclick="faunaApply()">Apply</button>
      <button class="action-btn" onclick="faunaReset()">Live</button>
      <div style="flex:1"></div>
      <div style="font-size:11px;color:var(--text-dim);text-align:right">
        ${d.now.date || '—'} · ${Number(d.now.hour).toFixed(1)}h · doy ${d.now.doy ?? '—'} · ${d.now.season || '—'} · ${d.now.weather || 'calm'}
        ${d.forced.hour || d.forced.doy ? '<br><span style="color:var(--accent)">forced — the world has not moved</span>' : ''}
      </div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;font-size:12px">
      <div style="border:1px solid var(--border);border-radius:4px;padding:8px 12px">
        <div style="color:var(--text-dim);font-size:11px">Birds in the world</div>
        <div style="font-size:20px"><strong>${fnum(totals.birds)}</strong></div></div>
      <div style="border:1px solid var(--border);border-radius:4px;padding:8px 12px">
        <div style="color:var(--text-dim);font-size:11px">Flocks</div>
        <div style="font-size:20px"><strong>${fnum(totals.flocks)}</strong></div></div>
      <div style="border:1px solid var(--border);border-radius:4px;padding:8px 12px">
        <div style="color:var(--text-dim);font-size:11px">Tiles with habitat</div>
        <div style="font-size:20px"><strong>${fnum(d.scanned.habitable)}</strong>
          <span style="font-size:11px;color:var(--text-dim)">of ${fnum(d.scanned.tiles)}</span></div></div>
      <div style="border:1px solid var(--border);border-radius:4px;padding:8px 12px">
        <div style="color:var(--text-dim);font-size:11px">BIRD_TUNE.season</div>
        <div style="font-size:20px"><strong style="color:${d.tune.season ? 'var(--accent)' : 'var(--text-dim)'}">${d.tune.season ? 'ON' : 'OFF'}</strong></div></div>
    </div>

    <h3 style="margin:14px 0 6px;font-size:13px">By species</h3>
    ${renderSpeciesTable(d.species)}

    <h3 style="margin:18px 0 6px;font-size:13px">The year and the evening</h3>
    ${renderCurves(d.curves, { month: nowMonth, hour: Number(d.now.hour) })}

    <h3 style="margin:18px 0 6px;font-size:13px">One tile</h3>
    <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px">
      <div class="field" style="flex:0 0 90px"><label>x</label><input id="fauna-x" type="number" value="${_faunaTile?.x ?? 900}"></div>
      <div class="field" style="flex:0 0 90px"><label>y</label><input id="fauna-y" type="number" value="${_faunaTile?.y ?? 900}"></div>
      <button class="action-btn" onclick="faunaProbe()">Probe</button>
    </div>
    <div id="fauna-tile-out" style="border:1px solid var(--border);border-radius:4px;padding:10px">${renderTileProbe()}</div>

    <h3 style="margin:18px 0 6px;font-size:13px">Biggest flocks</h3>
    ${renderHotspots(d.hotspots)}
  </div>`;
}

function faunaApply() {
  _faunaQ.hour = document.getElementById('fauna-hour').value;
  _faunaQ.doy = document.getElementById('fauna-doy').value;
  _faunaQ.weather = document.getElementById('fauna-weather').value;
  loadPanel('fauna');
}
function faunaReset() { _faunaQ.hour = ''; _faunaQ.doy = ''; _faunaQ.weather = ''; loadPanel('fauna'); }

async function faunaProbe(x, y) {
  const gx = x != null ? x : Number(document.getElementById('fauna-x').value);
  const gy = y != null ? y : Number(document.getElementById('fauna-y').value);
  const p = new URLSearchParams({ x: gx, y: gy, map: _faunaQ.map });
  if (_faunaQ.hour !== '') p.set('hour', _faunaQ.hour);
  if (_faunaQ.doy !== '') p.set('doy', _faunaQ.doy);
  if (_faunaQ.weather !== '') p.set('weather', _faunaQ.weather);
  _faunaTile = await API('/fauna-tile?' + p.toString());
  const out = document.getElementById('fauna-tile-out');
  if (out) out.innerHTML = renderTileProbe();
  const xi = document.getElementById('fauna-x'), yi = document.getElementById('fauna-y');
  if (xi) xi.value = gx; if (yi) yi.value = gy;
}
