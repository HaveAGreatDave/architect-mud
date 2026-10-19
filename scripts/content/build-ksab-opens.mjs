// KSAB-7 Sports' broadcast opens: the title cards both sports air before the first pitch and the
// opening draw, written here and stamped into their scripts' ::asset blocks and title rows.
//
//   node scripts/content/build-ksab-opens.mjs           write them
//   node scripts/content/build-ksab-opens.mjs --check   fail if anything is behind this script
//
// DEADBALL's open is cut to its theme (build-ksab-theme.mjs, 132 bpm). The card holds for the
// theme, and every move below lands on one of its bars or rows, so the picture and the music hit
// together on every set: the park dark under the organ, every tower lit on the orchestra's first
// chord, the network's mark on the brass call, DEAD on the horns' first note and BALL on their
// third, the lower third with the trumpets, the ball alight for the lift, gold and fireworks for
// the key change, a punch on each kick, and a stamp on the button. Then it holds.
//
// CLUSTER PUCK keeps its own four-second open (data/scripts/hockey.bsm, cphl_title), which its
// theme (build-cphl-theme.mjs, 150 bpm) was written to: the first hit as the mark lands, the horn
// with the lamp. The network's part is a block laid over it between two markers this script owns,
// cut to the rest of the theme: the network's mark slammed in on the call and sent to its corner,
// LIVE, and the hits of the tune, the break and the ending, until the button. Then it holds.
//
// A title card's SVG is parsed into the page (tv.js), so its <style> runs and is the page's: every
// class and keyframe here is prefixed (k7d-, k7h-), and both cards stop moving for reduced motion
// (prefers-reduced-motion, or the game's Motion switch, [data-motion="off"]), showing their last
// frame. Base styles are that frame; the animations only get there.
//
// The display faces are the client's own (client/shared/fonts, served at /shared/fonts/), under
// family names of their own so they can't collide with the faces the Grandstand registers.
// Text that matters carries a textLength, so a fallback face sets it to the same width.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

// ── the clock: the theme's ──────────────────────────────────────────────────
const TEMPO = 132;
const ROW_S = 60 / TEMPO / 4;
const T = (bar, row = 0) => ((bar - 1) * 16 + row) * ROW_S;
const DUR = T(20);              // 19 bars: the theme's length, which is how long the card holds
const HIT = T(2);

const n2 = (v) => +(+v).toFixed(2);
const pct = (t, dur) => `${+Math.min(100, Math.max(0, (t / dur) * 100)).toFixed(3)}%`;
const EASE = {
  out: 'cubic-bezier(.16,.9,.3,1)', back: 'cubic-bezier(.2,1.55,.35,1)', in: 'cubic-bezier(.55,0,.85,.35)',
  inout: 'cubic-bezier(.65,0,.35,1)', lin: 'linear',
};

// One element's whole timeline, in seconds from the card going up. Holds its first frame before
// and its last after, so nothing drifts back to the base style at either end.
function keys(name, frames, dur = DUR) {
  const fr = [...frames].sort((a, b) => a[0] - b[0]);
  if (fr[0][0] > 0) fr.unshift([0, fr[0][1]]);
  if (fr[fr.length - 1][0] < dur) fr.push([dur, fr[fr.length - 1][1]]);
  const seen = new Set();
  for (const [t] of fr) {
    const p = pct(t, dur);
    if (seen.has(p)) throw new Error(`${name}: two frames at ${p}`);
    seen.add(p);
  }
  return `@keyframes ${name} { ${fr.map(([t, decl, ease]) => `${pct(t, dur)} { ${decl}${ease ? `; animation-timing-function: ${EASE[ease] || ease}` : ''} }`).join(' ')} }`;
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── faces ───────────────────────────────────────────────────────────────────
const BUNGEE = `'K7 Bungee', Bungee, 'Arial Black', Impact, sans-serif`;
const AUDIOWIDE = `'K7 Audiowide', Audiowide, Bahnschrift, 'Segoe UI', sans-serif`;
const SHOULDERS = `'K7 Shoulders', 'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif`;
const FACES = `
      @font-face { font-family: 'K7 Bungee'; src: url(/shared/fonts/bungee.woff2) format('woff2'); font-display: swap; }
      @font-face { font-family: 'K7 Audiowide'; src: url(/shared/fonts/audiowide.woff2) format('woff2'); font-display: swap; }
      @font-face { font-family: 'K7 Shoulders'; src: url(/shared/fonts/big-shoulders-display.woff2) format('woff2'); font-weight: 800; font-display: swap; }`;
const STILL = (cls) => `
      @media (prefers-reduced-motion: reduce) { .${cls}, .${cls} * { animation: none !important; } }
      [data-motion="off"] .${cls}, [data-motion="off"] .${cls} * { animation: none !important; }`;

// ── the network's mark ──────────────────────────────────────────────────────
// KSAB in a slanted plate, the 7 as the station's mast with its signal, and SPORTS on a tab
// under it. Drawn round (0, 0), about 234 by 76; the caller places it.
const TEAL = '#3df0d8', AMBER = '#ffb22e', INK = '#04100f';
function mark(p) {
  return `
      <polygon points="-108,-30 116,-30 106,30 -118,30" fill="url(#${p}-plate)" stroke="${TEAL}" stroke-width="2"/>
      <polygon points="-114,24 107,24 106,30 -118,30" fill="${AMBER}" opacity="0.9"/>
      <text x="-98" y="15" font-family="${BUNGEE}" font-size="37" fill="#ffffff" textLength="128" lengthAdjust="spacingAndGlyphs">KSAB</text>
      <path d="M44,-19 H85 L63,20" fill="none" stroke="${AMBER}" stroke-width="9" stroke-linejoin="miter"/>
      <path d="M91.5,-28.5 A11,11 0 0 1 95.5,-13.5 M95,-34.6 A18,18 0 0 1 101.6,-10" fill="none" stroke="${TEAL}" stroke-width="2.6" stroke-linecap="round"/>
      <polygon points="-74,30 74,30 68,46 -80,46" fill="${TEAL}"/>
      <text x="-3" y="42.5" text-anchor="middle" font-family="${AUDIOWIDE}" font-size="11.5" fill="${INK}" textLength="104" lengthAdjust="spacing">SPORTS</text>`;
}
const markDefs = (p) => `
    <linearGradient id="${p}-plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#11474a"/><stop offset="0.55" stop-color="#082426"/><stop offset="1" stop-color="#031012"/>
    </linearGradient>`;

// ═══ DEADBALL ═══════════════════════════════════════════════════════════════
function deadballOpen() {
  const css = [];
  const anim = (cls, frames, base = '', extra = '') => {
    css.push(`.${cls} { ${base}${base ? '; ' : ''}animation: ${cls} ${n2(DUR)}s linear both${extra}; }`);
    css.push(keys(cls, frames));
  };
  const R = rng(7);

  // ── the city behind the park: the buildings in two paths, their windows in three
  const blocks = { a: [], b: [] }, lit = { warm: [], dim: [], teal: [] }, beacons = [];
  for (let x = -6; x < 646;) {
    const w = 12 + Math.floor(R() * 26), top = 150 + Math.floor(R() * 62) - (Math.abs(x - 300) < 150 ? 18 : 0);
    blocks[R() < 0.5 ? 'a' : 'b'].push(`M${x},${top}h${w}V236h${-w}z`);
    for (let wy = top + 5; wy < 224; wy += 6) {
      for (let wx = x + 3; wx < x + w - 3; wx += 5) {
        const r = R();
        if (r < 0.2) lit[r < 0.04 ? 'teal' : r < 0.12 ? 'warm' : 'dim'].push(`M${wx},${wy}h2v2h-2z`);
      }
    }
    if (top < 170 && R() < 0.5) beacons.push(`<circle class="k7d-beacon" cx="${x + w / 2}" cy="${top - 3}" r="1.6" style="animation-delay: ${n2(-R() * 2)}s"/>`);
    x += w + Math.floor(R() * 3);
  }
  const city = `<path d="${blocks.a.join('')}" fill="#08131b"/><path d="${blocks.b.join('')}" fill="#0a1720"/>`
    + `<path d="${lit.warm.join('')}" fill="#ffd98a" opacity="0.75"/><path d="${lit.dim.join('')}" fill="#ffd98a" opacity="0.4"/>`
    + `<path d="${lit.teal.join('')}" fill="${TEAL}" opacity="0.7"/><g fill="#ff3b30">${beacons.join('')}</g>`;
  const starsAt = (k) => Array.from({ length: k }, () => `M${Math.floor(R() * 640)},${Math.floor(R() * 120)}h1v1h-1z`).join('');
  const stars = `<path d="${starsAt(22)}" fill="#cfe9ff" opacity="0.35"/><path d="${starsAt(12)}" fill="#cfe9ff" opacity="0.7"/>`;

  // ── the light towers, three each side, a bank of lamps on each (one grid, used twelve times)
  const towers = [[54, 60], [146, 46], [236, 72], [404, 72], [494, 46], [586, 60]];
  const grid = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) grid.push(`M${-16 + c * 8.5},${-10 + r * 7}h6.5v5h-6.5z`);
  const lampDefs = `<path id="k7d-lamps" d="${grid.join('')}"/>`;
  const poles = towers.map(([x, y]) => `<rect x="${x - 1.6}" y="${y + 13}" width="3.2" height="${226 - y}" fill="#0a0f14"/><path d="M${x - 6},${y + 40}L${x + 6},${y + 64}M${x + 6},${y + 40}L${x - 6},${y + 64}M${x - 6},${y + 88}L${x + 6},${y + 112}M${x + 6},${y + 88}L${x - 6},${y + 112}" stroke="#0e151b" stroke-width="1.2"/>`).join('');
  const darkBanks = towers.map(([x, y]) => `<rect x="${x - 19}" y="${y - 13}" width="38" height="26" rx="1.5" fill="#0c1116" stroke="#1d262e"/><use href="#k7d-lamps" x="${x}" y="${y}" fill="#2a2a20"/>`).join('');
  const beams = towers.map(([x, y], i) => {
    const fx = n2(320 + (x - 320) * 0.22);
    return `<polygon class="k7d-beam" points="${x},${y + 6} ${n2(fx - 92)},372 ${n2(fx + 92)},372" style="transform-origin: ${x}px ${y + 6}px; animation-duration: ${n2(5.3 + i * 0.7)}s; animation-delay: ${n2(-i * 1.1)}s"/>`;
  }).join('');
  const litBank = (i) => {
    const [x, y] = towers[i];
    // tower 5 is the one that works about sixty percent of the time
    return `<g class="k7d-lit${i === 1 ? ' k7d-first' : ''}"><circle cx="${x}" cy="${y}" r="46" fill="url(#k7d-halo)"/><use href="#k7d-lamps" x="${x}" y="${y}" fill="#fff7dc"${i === 4 ? ' class="k7d-faulty"' : ''}/></g>`;
  };

  // ── the stands, the wall, the field
  const rim = [];
  for (let t = 0.02; t < 1; t += 0.035) {
    const x = 2 * (1 - t) * t * 320 + t * t * 640, y = (1 - t) * (1 - t) * 214 + 2 * (1 - t) * t * 238 + t * t * 214;
    rim.push(`M${n2(x - 1)},${n2(y - 2.5)}h2v2h-2z`);
  }
  // the crowd's camera flashes: three speeds, each fan his own moment in it
  const fans = Array.from({ length: 16 }, (_, i) => {
    const x = 22 + i * 38 + R() * 16, y = 228 + R() * 14 + (Math.abs(x - 320) < 200 ? 4 : 0);
    return `<circle class="k7d-pop k7d-pop${i % 3}" cx="${n2(x)}" cy="${n2(y)}" r="1.4" style="animation-delay: ${n2(-R() * 4)}s"/>`;
  }).join('');
  const stripes = Array.from({ length: 12 }, (_, i) => {
    const a = -1.25 + i * 0.22, b = a + 0.11;
    const q = (ang) => `${n2(320 + Math.sin(ang) * 700)},${n2(214 + Math.cos(ang) * 700)}`;
    return `M320,214L${q(a)}L${q(b)}z`;
  }).join('');

  // ── the sunburst behind the wordmark, for the key change
  const rays = Array.from({ length: 24 }, (_, i) => {
    const a1 = (i * 15) * Math.PI / 180, a2 = (i * 15 + 7.5) * Math.PI / 180, cx = 320, cy = 150, r = 470;
    return `<polygon points="${cx},${cy} ${n2(cx + r * Math.cos(a1))},${n2(cy + r * Math.sin(a1))} ${n2(cx + r * Math.cos(a2))},${n2(cy + r * Math.sin(a2))}"/>`;
  }).join('');

  // ── fireworks over the skyline, from the key change on
  const BURSTS = [
    ['a', 140, 92, T(13), '#ffd257'], ['b', 500, 76, T(13, 6), TEAL], ['c', 322, 58, T(14), '#ffffff'],
    ['d', 214, 112, T(14, 10), '#ff6a3d'], ['e', 440, 104, T(15), '#ffd257'], ['f', 92, 60, T(16), TEAL],
    ['g', 560, 52, T(16, 8), '#ff6a3d'], ['h', 250, 70, T(18), '#ffd257'], ['i', 424, 64, T(18, 12), '#ffffff'],
  ];
  // one burst, drawn round (0, 0) and used nine times
  const burstRays = Array.from({ length: 18 }, (_, k) => {
    const a = (k / 18) * Math.PI * 2 + 0.1;
    return `M${n2(Math.cos(a) * 6)},${n2(Math.sin(a) * 6)}L${n2(Math.cos(a) * 50)},${n2(Math.sin(a) * 50)}`;
  }).join('');
  const burstDefs = `<path id="k7d-burst" d="${burstRays}" stroke-width="2.3" stroke-linecap="round" stroke-dasharray="30 5 3 60"/>`;
  const bursts = BURSTS.map(([id, x, y, t, color]) => {
    anim(`k7d-fw${id}`, [[t - 0.01, 'transform: scale(0.15) translateY(0px)'], [t, 'transform: scale(0.15) translateY(0px)', 'out'],
      [t + 1.5, 'transform: scale(1.2) translateY(10px)']], `transform-origin: ${x}px ${y}px`);
    anim(`k7d-fo${id}`, [[t - 0.01, 'opacity: 0'], [t, 'opacity: 1', 'in'], [t + 1.5, 'opacity: 0']], 'opacity: 0');
    return `<g class="k7d-fw${id}"><g class="k7d-fo${id}"><use href="#k7d-burst" x="${x}" y="${y}" stroke="${color}"/><circle cx="${x}" cy="${y}" r="7" fill="#ffffff" opacity="0.85"/></g></g>`;
  }).join('');

  // ══ the timeline ══
  // the camera: a slow push from the dark into the hit, then a drift, eased back on the big hits
  anim('k7d-cam', [[0, 'transform: scale(1.14)', 'in'], [HIT, 'transform: scale(1)', 'lin'], [T(13) - 0.01, 'transform: scale(1.04)', 'out'],
    [T(13) + 0.3, 'transform: scale(1)', 'lin'], [T(18, 12) - 0.01, 'transform: scale(1.025)', 'out'], [T(18, 12) + 0.25, 'transform: scale(1)']],
  'transform-origin: 320px 180px');
  // the shake on every hit
  const HITS = [[HIT, 5], [T(3), 2], [T(3, 4), 2], ...[0, 3, 6, 8, 11, 14].map((r) => [T(12, r), 1.6]), [T(13), 5],
    [T(17, 0), 2.5], [T(17, 3), 2.5], [T(17, 6), 3], [T(18), 4], [T(18, 12), 5]];
  const shake = [[0, 'transform: translate(0px, 0px)']];
  for (const [t, a] of HITS) {
    shake.push([t - 0.005, 'transform: translate(0px, 0px)'], [t, `transform: translate(${a}px, ${n2(-a * 0.6)}px)`],
      [t + 0.06, `transform: translate(${n2(-a * 0.7)}px, ${n2(a * 0.5)}px)`], [t + 0.12, `transform: translate(${n2(a * 0.35)}px, ${n2(-a * 0.25)}px)`],
      [t + 0.2, 'transform: translate(0px, 0px)']);
  }
  anim('k7d-shake', shake);
  // the park in the dark until the orchestra's first chord
  anim('k7d-dark', [[0, 'opacity: 0.82'], [HIT - 0.01, 'opacity: 0.7'], [HIT, 'opacity: 0']], 'opacity: 0');
  anim('k7d-lit', [[0, 'opacity: 0'], [HIT - 0.01, 'opacity: 0'], [HIT, 'opacity: 1']], 'opacity: 1');
  // the first bank stutters on under the organ
  anim('k7d-first', [[0, 'opacity: 0', 'step-end'], [0.3, 'opacity: 0.9', 'step-end'], [0.36, 'opacity: 0.1', 'step-end'], [0.5, 'opacity: 0.7', 'step-end'],
    [0.56, 'opacity: 0', 'step-end'], [0.95, 'opacity: 0.85', 'step-end'], [1.01, 'opacity: 0.2', 'step-end'], [1.2, 'opacity: 0.9', 'step-end'],
    [1.28, 'opacity: 0.15', 'step-end'], [1.5, 'opacity: 1']], 'opacity: 1');
  // the beams rise under the organ's third note, go up with the hit, and swell for the key change
  anim('k7d-beams', [[0, 'opacity: 0'], [T(1, 8), 'opacity: 0'], [HIT - 0.01, 'opacity: 0.25'], [HIT, 'opacity: 0.8', 'out'], [HIT + 0.7, 'opacity: 0.5'],
    [T(13) - 0.01, 'opacity: 0.5'], [T(13), 'opacity: 0.85', 'out'], [T(13) + 1, 'opacity: 0.6'], [T(18) - 0.01, 'opacity: 0.6'],
    [T(18), 'opacity: 0.9', 'out'], [T(18) + 1, 'opacity: 0.62']], 'opacity: 0.62');
  css.push('.k7d-beam { fill: url(#k7d-beam); animation: k7d-sway 6s ease-in-out infinite alternate; }');
  css.push('@keyframes k7d-sway { from { transform: rotate(-2.2deg); } to { transform: rotate(2.2deg); } }');
  css.push('.k7d-faulty { animation: k7d-faulty 3.7s steps(1) infinite; }');
  css.push('@keyframes k7d-faulty { 0% { opacity: 1; } 31% { opacity: 0.25; } 34% { opacity: 1; } 58% { opacity: 0.1; } 61% { opacity: 0.9; } 63% { opacity: 0.2; } 66% { opacity: 1; } }');
  css.push('.k7d-pop { opacity: 0; fill: #ffffff; animation: k7d-pop 3s steps(1) infinite; } .k7d-pop1 { animation-duration: 2.3s; } .k7d-pop2 { animation-duration: 3.9s; }');
  css.push('@keyframes k7d-pop { 0% { opacity: 0; } 92% { opacity: 1; } 95% { opacity: 0; } }');
  css.push('.k7d-beacon { animation: k7d-beacon 2.4s steps(1) infinite; }');
  css.push('@keyframes k7d-beacon { 0% { opacity: 1; } 50% { opacity: 0.15; } }');
  // the searchlights, from bar 9
  anim('k7d-search', [[0, 'opacity: 0'], [T(9) - 0.01, 'opacity: 0'], [T(9) + 0.8, 'opacity: 0.55']], 'opacity: 0.55');
  css.push('.k7d-sl { animation: k7d-sl 7s ease-in-out infinite alternate; }');
  css.push('@keyframes k7d-sl { from { transform: rotate(-24deg); } to { transform: rotate(22deg); } }');
  // the intro: the network presents, under the organ
  anim('k7d-intro', [[0, 'opacity: 0'], [0.25, 'opacity: 1'], [HIT - 0.02, 'opacity: 1'], [HIT, 'opacity: 0']], 'opacity: 0');
  anim('k7d-introline', [[0, 'transform: scaleX(0)'], [0.25, 'transform: scaleX(0)', 'out'], [0.95, 'transform: scaleX(1)']], 'transform-origin: 320px 178px');
  // the network's mark: slams in on the hit, pulses with the brass call, goes to the corner for the
  // show, and comes back over it for the last chord
  const NET_C = 'translate(320px, 150px)', NET_K = 'translate(62px, 26px)', NET_F = 'translate(320px, 58px)';
  anim('k7d-net', [[0, `opacity: 0; transform: ${NET_C} scale(2.4)`], [HIT - 0.01, `opacity: 0; transform: ${NET_C} scale(2.4)`],
    [HIT, `opacity: 1; transform: ${NET_C} scale(2.4)`, 'back'], [HIT + 0.32, `opacity: 1; transform: ${NET_C} scale(1)`],
    [T(3) - 0.02, `opacity: 1; transform: ${NET_C} scale(1)`, 'out'], [T(3) + 0.55, `opacity: 1; transform: ${NET_K} scale(0.42)`],
    [T(18) - 0.6, `opacity: 1; transform: ${NET_K} scale(0.42)`, 'inout'], [T(18), `opacity: 1; transform: ${NET_F} scale(0.6)`],
    [T(18, 12) - 0.01, `opacity: 1; transform: ${NET_F} scale(0.6)`], [T(18, 12), `opacity: 1; transform: ${NET_F} scale(0.68)`, 'out'],
    [T(18, 12) + 0.25, `opacity: 1; transform: ${NET_F} scale(0.6)`]], `transform: ${NET_F} scale(0.6)`);
  anim('k7d-netglow', [[0, 'opacity: 0'], [HIT - 0.01, 'opacity: 0'], [HIT, 'opacity: 1'], [HIT + 0.35, 'opacity: 0.25'],
    ...[[4, 0.55], [5, 0.7], [6, 0.85]].flatMap(([r, v]) => [[T(2, r) - 0.01, 'opacity: 0.25'], [T(2, r), `opacity: ${v}`], [T(2, r) + 0.1, 'opacity: 0.25']]),
    [T(2, 8) - 0.01, 'opacity: 0.25'], [T(2, 8), 'opacity: 1'], [T(2, 8) + 0.8, 'opacity: 0.3'], [T(3), 'opacity: 0']], 'opacity: 0');
  // the wordmark: DEAD on the horns' first note, BALL on their third, the ball rolling in under
  // the fourth, the underline on the fifth, the tagline on bar 4
  anim('k7d-dead', [[0, 'opacity: 0; transform: translateX(-170px)'], [T(3) - 0.01, 'opacity: 0; transform: translateX(-170px)', 'out'],
    [T(3) + 0.16, 'opacity: 1; transform: translateX(0px)']]);
  anim('k7d-balls', [[0, 'opacity: 0; transform: translateX(170px)'], [T(3, 4) - 0.01, 'opacity: 0; transform: translateX(170px)', 'out'],
    [T(3, 4) + 0.16, 'opacity: 1; transform: translateX(0px)']]);
  anim('k7d-ball', [[0, 'opacity: 0; transform: translateX(300px) rotate(620deg)'], [T(3, 8) - 0.01, 'opacity: 0; transform: translateX(300px) rotate(620deg)'],
    [T(3, 8), 'opacity: 1; transform: translateX(300px) rotate(620deg)', 'out'], [T(3, 8) + 0.6, 'opacity: 1; transform: translateX(0px) rotate(0deg)']],
  'transform-origin: 572px 140px');
  anim('k7d-under', [[0, 'transform: scaleX(0)'], [T(3, 12) - 0.01, 'transform: scaleX(0)', 'out'], [T(3, 12) + 0.35, 'transform: scaleX(1)']],
    'transform-origin: 44px 183px');
  anim('k7d-tag', [[0, 'opacity: 0; transform: translateY(8px)'], [T(4) - 0.01, 'opacity: 0; transform: translateY(8px)', 'out'],
    [T(4) + 0.5, 'opacity: 1; transform: translateY(0px)']]);
  // a punch on each kick and on the button
  const punch = [[0, 'transform: scale(1)']];
  for (const t of [T(17, 0), T(17, 3), T(17, 6), T(18), T(18, 12)]) punch.push([t - 0.005, 'transform: scale(1)'], [t, 'transform: scale(1.045)', 'out'], [t + 0.2, 'transform: scale(1)']);
  anim('k7d-word', punch, 'transform-origin: 320px 160px');
  // light across the chrome: bars 5 and 9, the key change, the last chord
  const sweep = [[0, 'opacity: 0; transform: translateX(0px)']];
  for (const t of [T(5), T(9), T(13) + 0.2, T(18) + 0.1]) sweep.push([t - 0.01, 'opacity: 0; transform: translateX(0px)'], [t, 'opacity: 1; transform: translateX(0px)', 'inout'],
    [t + 0.75, 'opacity: 1; transform: translateX(640px)'], [t + 0.76, 'opacity: 0; transform: translateX(640px)']);
  anim('k7d-sweep', sweep, 'opacity: 0');
  // gold from the key change on
  anim('k7d-gold', [[0, 'opacity: 0'], [T(13) - 0.01, 'opacity: 0', 'out'], [T(13) + 0.45, 'opacity: 1']], 'opacity: 1');
  // the ball catches fire for the lift and burns out after the key change
  anim('k7d-comet', [[0, 'opacity: 0'], [T(11) - 0.01, 'opacity: 0', 'out'], [T(11) + 0.35, 'opacity: 1'], [T(13) + 0.5, 'opacity: 1', 'in'], [T(13) + 1.6, 'opacity: 0']], 'opacity: 0');
  anim('k7d-rays', [[0, 'opacity: 0'], [T(13) - 0.01, 'opacity: 0', 'out'], [T(13) + 0.6, 'opacity: 1']], 'opacity: 1');
  css.push('.k7d-spin { transform-origin: 320px 150px; animation: k7d-spin 48s linear infinite; }');
  css.push('@keyframes k7d-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }');
  // the lower third comes up with the trumpets
  anim('k7d-band', [[0, 'transform: translateY(80px)'], [T(7) - 0.01, 'transform: translateY(80px)', 'out'], [T(7) + 0.45, 'transform: translateY(0px)']]);
  css.push('.k7d-dot { animation: k7d-dot 1.1s steps(1) infinite; }');
  css.push('@keyframes k7d-dot { 0% { opacity: 1; } 55% { opacity: 0.2; } }');
  // a streak of light across the frame on the downbeats that matter
  const streak = [[0, 'opacity: 0; transform: translateX(-460px)']];
  for (const t of [HIT, T(7), T(11), T(13), T(17, 8), T(18)]) streak.push([t - 0.01, 'opacity: 0; transform: translateX(-460px)'], [t, 'opacity: 1; transform: translateX(-460px)', 'out'],
    [t + 0.55, 'opacity: 0.9; transform: translateX(700px)'], [t + 0.56, 'opacity: 0; transform: translateX(700px)']);
  anim('k7d-streak', streak, 'opacity: 0');
  // white on the hits
  const flash = [[0, 'opacity: 0']];
  for (const [t, v, d] of [[HIT, 0.85, 0.45], [T(11), 0.3, 0.35], [T(13), 0.9, 0.6], [T(17, 0), 0.32, 0.2], [T(17, 3), 0.32, 0.2], [T(17, 6), 0.42, 0.22], [T(18), 0.8, 0.5], [T(18, 12), 1, 0.7]]) {
    flash.push([t - 0.01, 'opacity: 0'], [t, `opacity: ${v}`, 'out'], [t + d, 'opacity: 0']);
  }
  anim('k7d-flash', flash, 'opacity: 0');
  // a ring out of the mark on the hit, and out of the lockup on the button
  anim('k7d-ring', [[0, 'opacity: 0; transform: scale(0.3)'], [HIT - 0.01, 'opacity: 0; transform: scale(0.3)'], [HIT, 'opacity: 0.9; transform: scale(0.3)', 'out'],
    [HIT + 0.7, 'opacity: 0; transform: scale(6)'], [T(18, 12) - 0.01, 'opacity: 0; transform: scale(0.3)'], [T(18, 12), 'opacity: 0.9; transform: scale(0.3)', 'out'],
    [T(18, 12) + 0.8, 'opacity: 0; transform: scale(7)']], 'opacity: 0; transform-origin: 320px 150px');

  const title = 'KSAB-7 Sports presents Deadball, Coldwater League Baseball, live from the Charles B. Hughson Coliseum, with Chip Vega.';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" class="k7d" role="img" aria-label="${title}" font-family="${AUDIOWIDE}">
  <!-- Generated by scripts/content/build-ksab-opens.mjs: edit that, not this. The KSAB-7 Sports open,
       cut to the network's theme (${n2(DUR)} s at ${TEMPO} bpm), which plays under it once. -->
  <defs>${markDefs('k7d')}
    ${lampDefs}${burstDefs}
    <linearGradient id="k7d-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#03070d"/><stop offset="0.45" stop-color="#081622"/><stop offset="0.7" stop-color="#10222c"/><stop offset="1" stop-color="#0a1a14"/>
    </linearGradient>
    <radialGradient id="k7d-glow" cx="0.5" cy="1" r="0.75">
      <stop offset="0" stop-color="#ff60a8" stop-opacity="0.28"/><stop offset="0.5" stop-color="#ff9a5a" stop-opacity="0.08"/><stop offset="1" stop-color="#ff9a5a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="k7d-halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fffbe8" stop-opacity="0.95"/><stop offset="0.25" stop-color="#ffe9a8" stop-opacity="0.45"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="k7d-beam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6d6" stop-opacity="0.42"/><stop offset="0.6" stop-color="#fff6d6" stop-opacity="0.08"/><stop offset="1" stop-color="#fff6d6" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="k7d-search" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#bfe8ff" stop-opacity="0.35"/><stop offset="1" stop-color="#bfe8ff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="k7d-grass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d5a2c"/><stop offset="1" stop-color="#2f7d3c"/>
    </linearGradient>
    <radialGradient id="k7d-dirt" cx="0.5" cy="0.3" r="0.7">
      <stop offset="0" stop-color="#b5713f"/><stop offset="1" stop-color="#7a4524"/>
    </radialGradient>
    <linearGradient id="k7d-chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#e9eef2"/><stop offset="0.5" stop-color="#9aa6b2"/><stop offset="0.62" stop-color="#d6dde3"/><stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="k7d-goldfill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4c2"/><stop offset="0.45" stop-color="#ffd257"/><stop offset="0.52" stop-color="#b8761c"/><stop offset="0.66" stop-color="#ffcb4a"/><stop offset="1" stop-color="#fff0b8"/>
    </linearGradient>
    <linearGradient id="k7d-underfill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff7a1a"/><stop offset="1" stop-color="#ffb547"/>
    </linearGradient>
    <linearGradient id="k7d-sweepfill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="k7d-streakfill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${TEAL}" stop-opacity="0"/><stop offset="0.5" stop-color="#e8fffb" stop-opacity="1"/><stop offset="1" stop-color="${TEAL}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="k7d-ballfill" cx="0.38" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#fffdf4"/><stop offset="0.7" stop-color="#e6dfcb"/><stop offset="1" stop-color="#b9b09a"/>
    </radialGradient>
    <linearGradient id="k7d-cometfill" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#fff8dc" stop-opacity="1"/><stop offset="0.3" stop-color="#ffb547" stop-opacity="0.75"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="k7d-fire" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff6d0" stop-opacity="0.9"/><stop offset="0.4" stop-color="#ffb547" stop-opacity="0.45"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="k7d-vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/>
    </radialGradient>
    <pattern id="k7d-scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity="0.16"/></pattern>
    <clipPath id="k7d-wordclip">
      <text x="44" y="168" font-family="${BUNGEE}" font-size="74" textLength="224" lengthAdjust="spacingAndGlyphs">DEAD</text>
      <text x="280" y="168" font-family="${BUNGEE}" font-size="74" textLength="224" lengthAdjust="spacingAndGlyphs">BALL</text>
    </clipPath>
    <style><![CDATA[${FACES}
      ${css.join('\n      ')}${STILL('k7d')}
    ]]></style>
  </defs>

  <rect width="640" height="360" fill="url(#k7d-sky)"/>
  <g class="k7d-cam"><g class="k7d-shake">
    ${stars}
    <g class="k7d-search">
      <polygon class="k7d-sl" points="114,226 92,-40 136,-40" fill="url(#k7d-search)" style="transform-origin: 114px 226px"/>
      <polygon class="k7d-sl" points="530,226 508,-40 552,-40" fill="url(#k7d-search)" style="transform-origin: 530px 226px; animation-delay: -3.5s"/>
    </g>
    <g>${city}</g>
    <rect x="0" y="120" width="640" height="130" fill="url(#k7d-glow)"/>
    ${bursts}
    <g class="k7d-rays"><g class="k7d-spin" fill="#fff2c8" opacity="0.06">${rays}</g></g>
    <!-- the stands, the wall and the field -->
    <path d="M0,214 Q320,238 640,214 L640,256 L0,256 Z" fill="#0a1117"/>
    <path d="M0,226 Q320,250 640,226 M0,238 Q320,262 640,238" stroke="#141d25" stroke-width="1.2" fill="none"/>
    <path d="M0,250 Q320,268 640,250 L640,264 Q320,282 0,264 Z" fill="#0f3a26"/>
    <path d="M0,250 Q320,268 640,250" stroke="#e8c547" stroke-width="1.6" fill="none"/>
    <text x="320" y="272" text-anchor="middle" font-family="${SHOULDERS}" font-weight="800" font-size="10" fill="#e8f0e4" opacity="0.85">402</text>
    <text x="148" y="266" text-anchor="middle" font-family="${SHOULDERS}" font-weight="800" font-size="9" fill="#e8f0e4" opacity="0.7">375</text>
    <text x="492" y="266" text-anchor="middle" font-family="${SHOULDERS}" font-weight="800" font-size="9" fill="#e8f0e4" opacity="0.7">375</text>
    <path d="M0,264 Q320,282 640,264 L640,360 L0,360 Z" fill="url(#k7d-grass)"/>
    <clipPath id="k7d-grassclip"><path d="M0,264 Q320,282 640,264 L640,360 L0,360 Z"/></clipPath>
    <path d="${stripes}" fill="#ffffff" opacity="0.035" clip-path="url(#k7d-grassclip)"/>
    <path d="M0,276 Q320,294 640,276 L640,282 Q320,300 0,282 Z" fill="#6b4a2c" opacity="0.7"/>
    <ellipse cx="320" cy="404" rx="360" ry="104" fill="url(#k7d-dirt)"/>
    <polygon points="320,312 470,356 320,404 170,356" fill="#2c7a3a"/>
    <path d="M174,352 L-30,262 M466,352 L670,262" stroke="#f2f2ea" stroke-width="1.6" opacity="0.8"/>
    <ellipse cx="320" cy="350" rx="26" ry="7" fill="#b07040"/><rect x="314" y="348" width="12" height="2.4" fill="#f4f4ee"/>
    <g fill="#f8f8f2"><rect x="315" y="306" width="10" height="6" transform="rotate(0)"/><rect x="460" y="348" width="10" height="6"/><rect x="170" y="348" width="10" height="6"/></g>
    <!-- the towers and their light -->
    ${poles}${darkBanks}
    <rect class="k7d-dark" x="-40" y="-40" width="720" height="440" fill="#01040a"/>
    <g class="k7d-beams">${beams}</g>
    <g class="k7d-lit">${[0, 2, 3, 4, 5].map(litBank).join('')}<path d="${rim.join('')}" fill="#fff2c4"/>${fans}</g>
    ${litBank(1)}
  </g></g>

  <!-- the network presents -->
  <g class="k7d-intro">
    <text x="320" y="168" text-anchor="middle" font-size="15" fill="${TEAL}" textLength="190" lengthAdjust="spacing">KSAB-7 SPORTS</text>
    <rect class="k7d-introline" x="230" y="177" width="180" height="1.4" fill="${TEAL}" opacity="0.8"/>
    <text x="320" y="196" text-anchor="middle" font-size="9" fill="#8ab8b2" textLength="96" lengthAdjust="spacing">PRESENTS</text>
  </g>

  <!-- the show -->
  <g class="k7d-word">
    <g class="k7d-ball">
      <polygon class="k7d-comet" points="550,116 594,162 780,-30 720,-62" fill="url(#k7d-cometfill)"/>
      <circle class="k7d-comet" cx="572" cy="140" r="66" fill="url(#k7d-fire)"/>
      <g transform="translate(572 140) scale(0.93) translate(-566 -140)">
      <circle cx="566" cy="140" r="37" fill="url(#k7d-ballfill)" stroke="#8d8676" stroke-width="1.5"/>
      <path d="M541,113 A37,37 0 0 1 541,167 M591,113 A37,37 0 0 0 591,167" fill="none" stroke="#c8322a" stroke-width="2.4"/>
      <path d="M545,118 l-6,2 M549,126 l-6,1 M550,135 l-6,0 M550,145 l-6,-0.5 M549,154 l-6,-1 M545,162 l-6,-2 M587,118 l6,2 M583,126 l6,1 M582,135 l6,0 M582,145 l6,-0.5 M583,154 l6,-1 M587,162 l6,-2" stroke="#c8322a" stroke-width="1.6"/>
      <path d="M560,104 L566,121 L557,133 L570,147 L561,162 L566,176" fill="none" stroke="#2a2420" stroke-width="2.2" stroke-linejoin="round"/>
      </g>
    </g>
    <g class="k7d-dead">
      <text x="48" y="173" font-family="${BUNGEE}" font-size="74" fill="#000000" opacity="0.55" textLength="224" lengthAdjust="spacingAndGlyphs">DEAD</text>
      <text x="44" y="168" font-family="${BUNGEE}" font-size="74" fill="url(#k7d-chrome)" stroke="#0a0f14" stroke-width="2" paint-order="stroke" textLength="224" lengthAdjust="spacingAndGlyphs">DEAD</text>
    </g>
    <g class="k7d-balls">
      <text x="284" y="173" font-family="${BUNGEE}" font-size="74" fill="#000000" opacity="0.55" textLength="224" lengthAdjust="spacingAndGlyphs">BALL</text>
      <text x="280" y="168" font-family="${BUNGEE}" font-size="74" fill="url(#k7d-chrome)" stroke="#0a0f14" stroke-width="2" paint-order="stroke" textLength="224" lengthAdjust="spacingAndGlyphs">BALL</text>
    </g>
    <g class="k7d-gold">
      <text x="44" y="168" font-family="${BUNGEE}" font-size="74" fill="url(#k7d-goldfill)" textLength="224" lengthAdjust="spacingAndGlyphs">DEAD</text>
      <text x="280" y="168" font-family="${BUNGEE}" font-size="74" fill="url(#k7d-goldfill)" textLength="224" lengthAdjust="spacingAndGlyphs">BALL</text>
    </g>
    <g clip-path="url(#k7d-wordclip)"><polygon class="k7d-sweep" points="-64,100 16,100 -10,182 -90,182" fill="url(#k7d-sweepfill)"/></g>
    <rect class="k7d-under" x="44" y="180" width="460" height="7" rx="1" fill="url(#k7d-underfill)"/>
    <text class="k7d-tag" x="274" y="207" text-anchor="middle" font-size="14" fill="#ffb547" textLength="430" lengthAdjust="spacing">COLDWATER LEAGUE BASEBALL</text>
  </g>

  <!-- the network -->
  <g class="k7d-net">
    <ellipse class="k7d-netglow" cx="0" cy="8" rx="150" ry="70" fill="url(#k7d-halo)"/>${mark('k7d')}
  </g>

  <!-- the lower third -->
  <g class="k7d-band">
    <rect x="0" y="304" width="640" height="30" fill="#061216" opacity="0.9"/>
    <rect x="0" y="304" width="640" height="1.6" fill="${TEAL}"/>
    <rect x="14" y="311" width="52" height="16" rx="3" fill="#d81f2a"/>
    <circle class="k7d-dot" cx="24" cy="319" r="3.2" fill="#ffffff"/>
    <text x="31" y="323.3" font-size="10" fill="#ffffff" textLength="28" lengthAdjust="spacing">LIVE</text>
    <text x="78" y="325" font-family="${SHOULDERS}" font-weight="800" font-size="17" fill="#e8f6f4" textLength="268" lengthAdjust="spacingAndGlyphs">CHARLES B. HUGHSON COLISEUM</text>
    <text x="356" y="324" font-size="9" fill="${TEAL}" textLength="70" lengthAdjust="spacing">COLDWATER</text>
    <text x="626" y="325" text-anchor="end" font-family="${SHOULDERS}" font-weight="800" font-size="17" fill="#ffffff" textLength="82" lengthAdjust="spacingAndGlyphs">CHIP VEGA</text>
    <text x="538" y="324" text-anchor="end" font-size="9" fill="${TEAL}">with</text>
  </g>

  <!-- light: the streak, the ring, the flash -->
  <g class="k7d-streak"><rect x="-120" y="140" width="420" height="22" fill="url(#k7d-streakfill)" opacity="0.25"/><rect x="-60" y="149.5" width="300" height="3" fill="url(#k7d-streakfill)"/></g>
  <circle class="k7d-ring" cx="320" cy="150" r="40" fill="none" stroke="#ffffff" stroke-width="3"/>
  <rect class="k7d-flash" width="640" height="360" fill="#ffffff"/>
  <rect width="640" height="360" fill="url(#k7d-scan)"/>
  <rect width="640" height="360" fill="url(#k7d-vignette)"/>
</svg>`;
}

// ═══ CLUSTER PUCK ═══════════════════════════════════════════════════════════
// Laid over the CPhL's own open (data/scripts/hockey.bsm, cphl_title) in a block between two
// markers this script owns, and cut to the CPhL's theme (build-cphl-theme.mjs, 150 bpm: a row is
// a tenth of a second and a bar 1.6). The card holds for the theme, 25.6 seconds.
//
// The drawing plays its own four seconds as it always has, and the theme was written to it: the
// first hit is the mark landing (0.6 s) and the horn is the lamp (1.5 s). A block at the end of the
// drawing can only lay things over it, so everything here is a layer on top: the room going red
// with the lamp; for the network's call the screen dimmed and KSAB-7's mark slammed into the
// middle of it, pulsing on the call's notes and sent to its corner as the tune starts, LIVE
// dropping in on the call's last note; light across the wordmark on the phrases; the letters
// flaring on the organ's stabs and the kicks; the rule filling a quarter at a time with the climb;
// spotlights over the ice and the crowd's camera flashes from the tune in A♭; and on the last bar
// the lamp on every beat, the room red, and a ring out of the CPhL's mark on the chord and the
// button. Then it holds on the drawing with the network's mark and LIVE, which is also what
// reduced motion shows.
const H_TEMPO = 150;
const H_ROW_S = 60 / H_TEMPO / 4;
const HT = (bar, row = 0) => ((bar - 1) * 16 + row) * H_ROW_S;
const H_DUR = HT(17);           // 16 bars: the theme's length, which is how long the card holds
const K7H_BEGIN = '<!-- ksab7:begin (scripts/content/build-ksab-opens.mjs) -->';
const K7H_END = '<!-- ksab7:end -->';

// Pulses of one element, [time, peak, fade] each, every fade cut short of the next pulse so two
// never share a stretch of the timeline.
function pulses(list, off = 'opacity: 0', on = (v) => `opacity: ${v}`) {
  const fr = [[0, off]];
  list.forEach(([t, v, d], i) => {
    const next = list[i + 1]?.[0] ?? Infinity;
    fr.push([t - 0.01, off], [t, on(v), 'out'], [Math.min(t + d, next - 0.02), off]);
  });
  return fr;
}
// A lamp: on for `hold`, dimmed for `hold`, at each time; dark before a run and after it.
function blink(times, hold, on, dim) {
  const fr = [[0, 'opacity: 0']];
  times.forEach((t, i) => {
    if (i === 0 || t - times[i - 1] > 4 * hold) fr.push([t - 0.01, 'opacity: 0']);
    fr.push([t, on, 'step-end'], [t + hold, dim, 'step-end']);
    if (i === times.length - 1 || times[i + 1] - t > 4 * hold) fr.push([t + 2 * hold, 'opacity: 0']);
  });
  return fr;
}

function cphlBlock() {
  const css = [];
  const anim = (cls, frames, base = '', extra = '') => {
    css.push(`.${cls} { ${base}${base ? '; ' : ''}animation: ${cls} ${n2(H_DUR)}s linear both${extra}; }`);
    css.push(keys(cls, frames, H_DUR));
  };
  const R = rng(11);
  const KICKS = [0, 3, 6, 8, 11, 14].map((r) => HT(14, r));
  const BUTTON = HT(15, 12);

  // white on the hits: the mark landing, the horn, the call, the tune, the break, the tune in A♭,
  // the kicks, the last chord and the button
  anim('k7h-flash', pulses([[HT(1, 6), 0.3, 0.3], [HT(1, 15), 0.2, 0.25], [HT(3), 0.45, 0.4], [HT(4), 0.18, 0.3], [HT(8), 0.2, 0.25],
    [HT(10), 0.5, 0.5], ...KICKS.map((t) => [t, 0.2, 0.16]), [HT(15), 0.6, 0.55], [BUTTON, 0.85, 0.7]]), 'opacity: 0');
  // the goal light: the room red with the lamp, with the drawing's own lamp in the open (cpLamp,
  // four flashes 0.34 s apart from 1.5 s) and with this lamp on each beat of the last bar
  const LAST = [0, 4, 8, 12].map((r) => HT(15, r));
  anim('k7h-red', blink([...[0, 1, 2, 3].map((k) => 1.5 + k * 0.34)], 0.17, 'opacity: 0.16', 'opacity: 0.04')
    .concat(blink(LAST, 0.2, 'opacity: 0.18', 'opacity: 0.05').slice(1)), 'opacity: 0');
  anim('k7h-lamp', blink(LAST, 0.2, 'opacity: 1', 'opacity: 0.15'), 'opacity: 0');
  // the letters flare on the organ's stabs, the kicks, the chord and the button
  anim('k7h-glow', pulses([...[[8, 0], [8, 3], [8, 6], [8, 8], [9, 0], [9, 3], [9, 6]].map(([b, r], i) => [HT(b, r), [0.5, 0.4, 0.5, 0.62, 0.5, 0.4, 0.55][i], 0.26]),
    ...KICKS.map((t, i) => [t, 0.42 + i * 0.05, 0.22]), [HT(15), 0.6, 0.5], [BUTTON, 0.8, 0.6]]), 'opacity: 0');
  // light across the wordmark at the top of each phrase, and once after the button
  const sweep = [[0, 'opacity: 0; transform: translateX(0px)']];
  for (const t of [HT(4), HT(6), HT(10), HT(12), BUTTON + 0.12]) {
    sweep.push([t - 0.01, 'opacity: 0; transform: translateX(0px)'], [t, 'opacity: 1; transform: translateX(0px)', 'inout'],
      [t + 0.8, 'opacity: 1; transform: translateX(560px)'], [t + 0.81, 'opacity: 0; transform: translateX(560px)']);
  }
  anim('k7h-sweep', sweep, 'opacity: 0');
  // the rule fills a quarter on each note of the organ's climb and goes up in light on the tune
  anim('k7h-charge', [[0, 'opacity: 0; transform: scaleX(0)'], [HT(9, 8) - 0.01, 'opacity: 0; transform: scaleX(0)'],
    ...[8, 10, 12, 14].map((r, i) => [HT(9, r), `opacity: 1; transform: scaleX(${(i + 1) / 4})`, 'step-end']),
    [HT(10), 'opacity: 1; transform: scaleX(1)', 'out'], [HT(10) + 0.7, 'opacity: 0; transform: scaleX(1)']], 'opacity: 0; transform-origin: 146px 194px');
  // a ring out of the CPhL's mark on the tune in A♭, the last chord and the button
  const ring = [[0, 'opacity: 0; transform: scale(0.4)']];
  for (const t of [HT(10), HT(15), BUTTON]) ring.push([t - 0.01, 'opacity: 0; transform: scale(0.4)'], [t, 'opacity: 0.9; transform: scale(0.4)', 'out'], [t + 0.7, 'opacity: 0; transform: scale(3.6)']);
  anim('k7h-ring', ring, 'opacity: 0; transform-origin: 92px 168px');
  // the network's call: the screen dims, the mark slams into the middle and pulses on the call's
  // notes, PRESENTS under it on the last one, and as the tune starts the mark goes to its corner
  anim('k7h-scrim', [[0, 'opacity: 0'], [HT(3) - 0.01, 'opacity: 0'], [HT(3), 'opacity: 0.74', 'out'], [HT(4) - 0.3, 'opacity: 0.74', 'inout'], [HT(4) + 0.2, 'opacity: 0']], 'opacity: 0');
  anim('k7h-pres', [[0, 'opacity: 0'], [HT(3, 8) - 0.01, 'opacity: 0'], [HT(3, 8) + 0.25, 'opacity: 1'], [HT(4) - 0.3, 'opacity: 1'], [HT(4), 'opacity: 0']], 'opacity: 0');
  const NET_C = 'translate(320px, 172px)', NET_K = 'translate(62px, 30px)';
  const net = [[0, `opacity: 0; transform: ${NET_C} scale(2.6)`], [HT(3) - 0.01, `opacity: 0; transform: ${NET_C} scale(2.6)`],
    [HT(3), `opacity: 1; transform: ${NET_C} scale(2.6)`, 'back'], [HT(3) + 0.32, `opacity: 1; transform: ${NET_C} scale(1.25)`],
    [HT(4) - 0.3, `opacity: 1; transform: ${NET_C} scale(1.25)`, 'inout'], [HT(4) + 0.25, `opacity: 1; transform: ${NET_K} scale(0.42)`]];
  // in its corner it beats with the tune in A♭'s bars, and takes the button
  for (const [t, s] of [[HT(10), 0.47], [HT(11), 0.46], [HT(12), 0.47], [HT(13), 0.46], [BUTTON, 0.5]]) {
    net.push([t - 0.01, `opacity: 1; transform: ${NET_K} scale(0.42)`], [t, `opacity: 1; transform: ${NET_K} scale(${s})`, 'out'], [t + 0.28, `opacity: 1; transform: ${NET_K} scale(0.42)`]);
  }
  anim('k7h-net', net, `transform: ${NET_K} scale(0.42)`);
  anim('k7h-netglow', [[0, 'opacity: 0'], [HT(3) - 0.01, 'opacity: 0'], [HT(3), 'opacity: 1'], [HT(3) + 0.35, 'opacity: 0.25'],
    ...[[4, 0.55], [5, 0.7], [6, 0.85]].flatMap(([r, v]) => [[HT(3, r) - 0.01, 'opacity: 0.25'], [HT(3, r), `opacity: ${v}`], [HT(3, r) + 0.08, 'opacity: 0.25']]),
    [HT(3, 8) - 0.01, 'opacity: 0.25'], [HT(3, 8), 'opacity: 1'], [HT(3, 8) + 0.6, 'opacity: 0.3'], [HT(4), 'opacity: 0']], 'opacity: 0');
  anim('k7h-live', [[0, 'opacity: 0; transform: translateY(-10px)'], [HT(3, 8) - 0.01, 'opacity: 0; transform: translateY(-10px)', 'out'], [HT(3, 8) + 0.35, 'opacity: 1; transform: translateY(0px)']]);
  css.push('.k7h-dot { animation: k7h-dot 0.8s steps(1) infinite; }');
  css.push('@keyframes k7h-dot { 0% { opacity: 1; } 50% { opacity: 0.2; } }');
  // a glint across the mark every other bar of the tune
  const glint = [[0, 'transform: translateX(-160px)']];
  for (const b of [4, 6, 8, 10, 12, 14]) {
    const t = HT(b);
    glint.push([t - 0.01, 'transform: translateX(-160px)'], [t, 'transform: translateX(-160px)', 'inout'], [t + 0.7, 'transform: translateX(260px)'], [t + 0.71, 'transform: translateX(-160px)']);
  }
  anim('k7h-glint', glint, 'transform: translateX(-160px)');
  // the arena: spotlights over the ice from the tune in A♭ until the button, and the crowd's
  // camera flashes from the tune on, three speeds, each fan his own moment in it
  anim('k7h-spots', [[0, 'opacity: 0'], [HT(10) - 0.01, 'opacity: 0'], [HT(10), 'opacity: 1', 'out'], [BUTTON + 0.2, 'opacity: 1', 'inout'], [BUTTON + 1.2, 'opacity: 0']], 'opacity: 0');
  css.push('.k7h-beam { animation: k7h-beam 3.2s ease-in-out infinite alternate; }');
  css.push('@keyframes k7h-beam { from { transform: rotate(-16deg); } to { transform: rotate(16deg); } }');
  anim('k7h-pops', [[0, 'opacity: 0'], [HT(4) - 0.01, 'opacity: 0'], [HT(4) + 0.4, 'opacity: 0.55'], [HT(10) - 0.01, 'opacity: 0.55'], [HT(10), 'opacity: 1']], 'opacity: 1');
  css.push('.k7h-pop { opacity: 0; fill: #ffffff; animation: k7h-pop 2.6s steps(1) infinite; } .k7h-pop1 { animation-duration: 1.9s; } .k7h-pop2 { animation-duration: 3.3s; }');
  css.push('@keyframes k7h-pop { 0% { opacity: 0; } 91% { opacity: 1; } 95% { opacity: 0; } }');
  const pops = Array.from({ length: 20 }, (_, i) => `<circle class="k7h-pop k7h-pop${i % 3}" cx="${n2(14 + i * 31 + R() * 14)}" cy="${n2(14 + R() * 38)}" r="1.4" style="animation-delay: ${n2(-R() * 3.3)}s"/>`).join('');
  const beams = [[176, 0], [464, -1.6]].map(([x, d]) => `<polygon class="k7h-beam" points="${x},-30 ${x - 70},380 ${x + 70},380" fill="url(#k7h-beamfill)" style="transform-origin: ${x}px -30px; animation-delay: ${d}s"/>`).join('');
  const word = (attrs) => `<text x="146" y="176" font-size="62" font-weight="700" letter-spacing="2"${attrs}>CLUSTER</text><text x="404" y="176" font-size="62" font-weight="700" letter-spacing="2"${attrs}>PUCK</text>`;

  return `${K7H_BEGIN}
  <!-- Cut to KSAB-7 Sports' theme for the CPhL (${n2(H_DUR)} s at ${H_TEMPO} bpm), which plays under the card once. -->
  <defs>${markDefs('k7h')}
    <linearGradient id="k7h-glintfill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="k7h-sweepfill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#bdefff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#bdefff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="k7h-beamfill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e6f6ff" stop-opacity="0.3"/><stop offset="0.7" stop-color="#e6f6ff" stop-opacity="0.07"/><stop offset="1" stop-color="#e6f6ff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="k7h-halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#e8fffb" stop-opacity="0.9"/><stop offset="0.3" stop-color="${TEAL}" stop-opacity="0.35"/><stop offset="1" stop-color="${TEAL}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="k7h-lampfill" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff6a5a" stop-opacity="0.95"/><stop offset="0.35" stop-color="#ff2b3a" stop-opacity="0.5"/><stop offset="1" stop-color="#ff2b3a" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="k7h-clip"><polygon points="-108,-30 116,-30 106,30 -118,30"/></clipPath>
    <clipPath id="k7h-wordclip">${word('')}</clipPath>
    <style><![CDATA[${FACES}
      ${css.join('\n      ')}${STILL('k7h')}
    ]]></style>
  </defs>
  <g class="k7h">
    <g class="k7h-spots">${beams}</g>
    <g class="k7h-pops">${pops}</g>
    <rect class="k7h-red" width="640" height="360" fill="#ff2b3a"/>
    <g class="k7h-lamp"><circle cx="596" cy="128" r="70" fill="url(#k7h-lampfill)" opacity="0.6"/><circle cx="596" cy="128" r="26" fill="url(#k7h-lampfill)"/><circle cx="596" cy="128" r="8" fill="#ff3b4a"/></g>
    <g class="k7h-glow">${word(' fill="#ffffff"')}</g>
    <g clip-path="url(#k7h-wordclip)"><polygon class="k7h-sweep" points="60,116 120,116 96,216 36,216" fill="url(#k7h-sweepfill)"/></g>
    <rect class="k7h-charge" x="146" y="192" width="404" height="4" fill="#e9fbff"/>
    <circle class="k7h-ring" cx="92" cy="168" r="34" fill="none" stroke="#4fd2ff" stroke-width="3"/>
    <rect class="k7h-scrim" width="640" height="360" fill="#02060a"/>
    <text class="k7h-pres" x="320" y="252" text-anchor="middle" font-family="${AUDIOWIDE}" font-size="11" fill="${TEAL}" textLength="120" lengthAdjust="spacing">PRESENTS</text>
    <g class="k7h-net">
      <ellipse class="k7h-netglow" cx="0" cy="8" rx="150" ry="70" fill="url(#k7h-halo)"/>${mark('k7h')}
      <g clip-path="url(#k7h-clip)"><polygon class="k7h-glint" points="-88,-40 -28,-40 -54,40 -114,40" fill="url(#k7h-glintfill)"/></g>
    </g>
    <g class="k7h-live">
      <rect x="570" y="202" width="52" height="16" rx="3" fill="#d81f2a"/>
      <circle class="k7h-dot" cx="580" cy="210" r="3.2" fill="#ffffff"/>
      <text x="587" y="214.3" font-family="${AUDIOWIDE}" font-size="10" fill="#ffffff" textLength="28" lengthAdjust="spacing">LIVE</text>
    </g>
    <rect class="k7h-flash" width="640" height="360" fill="#ffffff"/>
  </g>
  ${K7H_END}`;
}

// ── writing ─────────────────────────────────────────────────────────────────
// A .bsm's ::asset block, replaced in its own line endings.
function withAsset(src, id, body) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const a = lines.findIndex((l) => l.trim() === `::asset ${id}`);
  const b = lines.findIndex((l, i) => i > a && l.trim() === '::endasset');
  if (a < 0 || b < 0) throw new Error(`no ::asset ${id} block`);
  return [...lines.slice(0, a + 1), ...body.split('\n'), ...lines.slice(b)].join(eol);
}
const assetOf = (src, id) => {
  const lines = src.split(/\r?\n/);
  const a = lines.findIndex((l) => l.trim() === `::asset ${id}`);
  const b = lines.findIndex((l, i) => i > a && l.trim() === '::endasset');
  return lines.slice(a + 1, b).join('\n');
};

// The two cards as they're written, for this script and for the gate
// (scripts/audio/tracker-smoke.mjs, which holds each open to its theme's length).
export const DEADBALL_OPEN = deadballOpen();
export const OPEN_SECONDS = DUR;
export const CPHL_OPEN_SECONDS = H_DUR;
export function cphlOpen(hockeyBsm = fs.readFileSync(path.join(ROOT, 'data/scripts/hockey.bsm'), 'utf8')) {
  // the hockey open is its own drawing with the network's block at the end of it
  const base = assetOf(hockeyBsm, 'cphl_title').replace(new RegExp(`\\s*${K7H_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${K7H_END}`), '');
  const out = base.replace(/\s*<\/svg>\s*$/, `\n\n  ${cphlBlock()}\n</svg>`);
  if (!out.includes(K7H_END)) throw new Error('cphl_title has no </svg> to close');
  return out;
}

function rowWith(src, content) {
  const row = JSON.parse(src);
  row.content = content;
  return canonicalJson(row);   // the bytes build-deadball.mjs writes
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const deadball = DEADBALL_OPEN, cphl = cphlOpen();
  const jobs = [
    { file: 'data/scripts/baseball.bsm', make: (src) => withAsset(src, 'bb_deadball_title', deadball) },
    { file: 'data/scripts/hockey.bsm', make: (src) => withAsset(src, 'cphl_title', cphl) },
    // The rows. Deadball's build-deadball.mjs writes the same from the .bsm; Cluster Puck's build
    // script can't be re-run against the shipped rows, so both are written here, content only.
    { file: 'content/media_graphics/bb_deadball_title.json', make: (src) => rowWith(src, deadball) },
    { file: 'content/media_graphics/cphl_title.json', make: (src) => rowWith(src, cphl) },
  ];
  let stale = 0;
  for (const { file, make } of jobs) {
    const fp = path.join(ROOT, file);
    const have = fs.readFileSync(fp, 'utf8');
    const want = make(have);
    if (want === have) continue;
    stale++;
    if (CHECK) console.error(`✗ ${file} is behind scripts/content/build-ksab-opens.mjs`);
    else { fs.writeFileSync(fp, want, 'utf8'); console.log(`  wrote ${file}`); }
  }
  if (CHECK && stale) process.exit(1);
  console.log(`${CHECK ? '✓ up to date' : '✓ built'}: the Deadball open (${(deadball.length / 1024).toFixed(1)} KB, ${n2(DUR)} s) and the Cluster Puck open's network block (${(cphlBlock().length / 1024).toFixed(1)} KB, ${n2(H_DUR)} s)`);
}
