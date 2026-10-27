// Paints where the fish are, from client/shared/fish.js over the real coast.
//
//   node scripts/fish/map.mjs [--x0 870 --y0 878 --w 66 --h 46] [--doy 100] [--weather clear] [--out file.html]
//
// Land is read from content/zones (map_world, ground level): a tile is water when its terrain is
// water. A tile with no zone falls back to the wildlands' sea, as the submersible's isLandTile does.
// The page has one panel per forecast watch, the schools drawn over the seabed's depth, and the
// marine forecast for the marinas underneath. It's a tuning tool: nothing reads its output.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seabedDepth } from '../../client/shared/seabed.js';
import { wildlandsAt } from '../../client/shared/wildlands.js';
import { SPECIES, WATCHES, habitatFor, schoolsNear, schoolState, forecastLines } from '../../client/shared/fish.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const X0 = +arg('x0', 870), Y0 = +arg('y0', 878), W = +arg('w', 66), H = +arg('h', 46);
const env = { doy: +arg('doy', 100), weather: arg('weather', 'clear'), rough: +arg('rough', 0) };
const OUT = arg('out', join(tmpdir(), 'fish-map.html'));
const PX = 9;   // pixels a tile

// ── The coast ──────────────────────────────────────────────────────────────────────────────────
const water = new Map();
const dir = 'content/zones';
for (const f of readdirSync(dir)) {
  const z = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (z.map_id !== 'map_world' || (z.grid_z | 0) !== 0) continue;
  water.set(z.grid_x + ',' + z.grid_y, z.flags?.terrain === 'water');
}
const isLand = (ix, iy) => {
  const v = water.get(ix + ',' + iy);
  return v === undefined ? !wildlandsAt(ix, iy).sea : !v;
};
const habitat = habitatFor(isLand);

// ── The colours ────────────────────────────────────────────────────────────────────────────────
const COL = {
  sludge_carp: '#8d7b4a', carp: '#d9a441', razorgill: '#c9d4dc', irontooth_bass: '#4f8f5a',
  ashen_pike: '#9a9a9a', glass_eel: '#b9f2ff', coldwater_sturgeon: '#e0663a', lamp_herring: '#ffe46b',
  chrome_mackerel: '#7fb8ff', sand_skate: '#e8c9a0', wreck_grouper: '#c25b9e', slate_cod: '#6f86a8',
};
const sea = (d) => {
  // Shallow is pale, the shelf floor is dark, the Deep is near black.
  const t = Math.min(1, Math.log1p(d) / Math.log1p(60));
  const l = 62 - t * 44;
  return `hsl(205 55% ${l.toFixed(1)}%)`;
};

const floorRects = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ix = X0 + x, iy = Y0 + y;
  const fill = isLand(ix, iy) ? '#2a2620' : sea(seabedDepth(ix + 0.5, iy + 0.5, isLand));
  floorRects.push(`<rect x="${x * PX}" y="${y * PX}" width="${PX}" height="${PX}" fill="${fill}"/>`);
}
const floorSvg = floorRects.join('');

const MARINAS = [
  { name: 'Fairweather', x: 892.5, y: 901.5, R: 12 },
  { name: 'the Fish Quay', x: 903.5, y: 904.5, R: 12 },
  { name: 'the Eastern Marina', x: 919.5, y: 899.5, R: 12 },
];
const marks = MARINAS.map((m) => `<circle cx="${(m.x - X0) * PX}" cy="${(m.y - Y0) * PX}" r="5" fill="none" stroke="#fff" stroke-width="2"/>`
  + `<text x="${(m.x - X0) * PX + 8}" y="${(m.y - Y0) * PX + 4}" fill="#fff" font-size="11">${m.name}</text>`).join('');

// ── One panel a watch ──────────────────────────────────────────────────────────────────────────
// The clock: any fixed instant works, because positions are a function of it and nothing else.
const NOW = Date.UTC(2026, 3, 10, 12, 0, 0);
const cx = X0 + W / 2, cy = Y0 + H / 2, R = Math.hypot(W, H) / 2;
const panels = [], tallies = [];
for (const [label, hour] of WATCHES) {
  const e = { ...env, hour };
  const schools = schoolsNear(cx, cy, R, e, habitat).filter((s) => s.ax >= X0 && s.ax < X0 + W && s.ay >= Y0 && s.ay < Y0 + H);
  const count = {};
  const dots = schools.map((s) => {
    count[s.sp] = (count[s.sp] || 0) + 1;
    const st = schoolState(s, NOW, e);
    const r = 2 + Math.sqrt(s.n) * 1.1;
    return `<circle cx="${((st.x - X0) * PX).toFixed(1)}" cy="${((st.y - Y0) * PX).toFixed(1)}" r="${r.toFixed(1)}" fill="${COL[s.sp]}" fill-opacity="${(0.35 + 0.65 * s.fade).toFixed(2)}" stroke="#000" stroke-opacity="0.4"><title>${SPECIES[s.sp].name}: ${s.n} fish, floor ${s.floorM.toFixed(0)} m, holding at ${st.depth.toFixed(1)} m</title></circle>`;
  }).join('');
  tallies.push([label, count, schools.length]);
  panels.push(`<figure><figcaption>${label} (${hour}:00) <span>${schools.length} schools</span></figcaption>`
    + `<svg viewBox="0 0 ${W * PX} ${H * PX}" width="${W * PX}" height="${H * PX}">${floorSvg}${dots}${marks}</svg></figure>`);
}

const legend = Object.keys(SPECIES).map((id) => `<li><i style="background:${COL[id]}"></i>${SPECIES[id].name}</li>`).join('');
const forecast = MARINAS.map((m) => {
  const lines = forecastLines(m, env, habitat);
  return `<p><b>${m.name}:</b> ${lines.length ? lines.join('. ') + '.' : 'nothing reported.'}</p>`;
}).join('');

writeFileSync(OUT, `<!doctype html><meta charset="utf-8"><title>Fish map</title>
<style>body{background:#111;color:#ddd;font:13px system-ui;margin:16px}figure{display:inline-block;margin:0 12px 12px 0}
figcaption{margin:4px 0;font-weight:600}figcaption span{font-weight:400;color:#999}ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px}
i{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:5px;vertical-align:-1px}.fc{max-width:900px;background:#1b1b1b;padding:8px 14px;border-left:3px solid #7fb8ff}</style>
<h2>Where the fish are: tiles ${X0},${Y0} to ${X0 + W - 1},${Y0 + H - 1}, day ${env.doy}, ${env.weather}</h2>
<ul>${legend}</ul>${panels.join('')}
<div class="fc"><h3>KSAB Marine, 0600</h3>${forecast}</div>`);

// The same story in text, for the terminal.
for (const [label, count, n] of tallies) {
  const parts = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([id, c]) => `${SPECIES[id].name} ${c}`);
  console.log(`${label.padEnd(10)} ${String(n).padStart(3)} schools: ${parts.join(', ')}`);
}
console.log('\nKSAB MARINE, 0600.');
for (const m of MARINAS) {
  const lines = forecastLines(m, env, habitat);
  console.log(`${m.name}: ${lines.length ? lines.join('. ') + '.' : 'nothing reported.'}`);
}
console.log('\nwrote ' + OUT);
