// Gameday — the animated MLB-Gameday-style sub-screen for the DEADBALL broadcast.
//
// Placement-agnostic on purpose: it renders a per-at-bat `gameday` overlay payload
// (see plugins/broadcast/index.js `beatGameday`) into whatever host element it's
// given, holding no assumptions about the DOM around it. tv.js mounts one over the
// TV window today; a future tablet app can mount the same view unchanged.
//
// The payload is the same structured data Chip Vega is narrating — batter/pitcher,
// play kind, bases before→after, score — plus a synthesized pitch sequence. This
// module PLAYS the at-bat back: a slow pitch-by-pitch reveal on a top-down field
// where the ball and all nine fielders are shown, the batted ball travels out and is
// fielded (or clears the fence), runners round the bases lighting them as they go,
// and Chip's play-by-play captions run along the bottom.

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Colour class per synthesized pitch result — drives the plot dot + the sequence list.
const PITCH_RESULT_CLASS = { ball: 'ball', called: 'called', swinging: 'swinging', foul: 'foul', inplay: 'inplay' };
const PITCH_RESULT_LABEL = { ball: 'Ball', called: 'Called Strike', swinging: 'Swinging Strike', foul: 'Foul', inplay: 'In Play' };

// ── Sound effects (procedural, on the 'tv' bus; silent when no AudioEngine) ──────
const SFX = {
  mitt: { category: 'tv', priority: 2, config: { duration: 0.09, layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.07, gain: 0.13, filter: { type: 'lowpass', freq: 1100, q: 0.9 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 } },
    { waveform: 'sine', freq: 170, duration: 0.07, gain: 0.08, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 } },
  ] } },
  crack: { category: 'tv', priority: 4, config: { duration: 0.13, layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.045, gain: 0.34, filter: { type: 'highpass', freq: 2000, q: 0.7 }, adsr: { a: 0.0005, d: 0.04, s: 0, r: 0.02 } },
    { waveform: 'triangle', freq: 440, pitchBend: { to: 190, time: 0.05 }, duration: 0.1, gain: 0.24, filter: { type: 'bandpass', freq: 900, q: 1.1 }, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.05 } },
  ] } },
  whiff: { category: 'tv', priority: 3, config: { waveform: 'noise', noiseMix: 1, duration: 0.16, gain: 0.14, filter: { type: 'bandpass', freq: 1500, q: 0.5 }, adsr: { a: 0.03, d: 0.11, s: 0, r: 0.05 } } },
  // Ball smacking a fielder's glove out in the field — softer, rounder than the mitt.
  glove: { category: 'tv', priority: 3, config: { duration: 0.08, layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.06, gain: 0.11, filter: { type: 'lowpass', freq: 900, q: 0.8 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.02 } },
  ] } },
  base: { category: 'tv', priority: 4, config: { duration: 0.2, layers: [
    { waveform: 'sine', freq: 620, duration: 0.09, gain: 0.16, adsr: { a: 0.005, d: 0.08, s: 0, r: 0.05 } },
    { waveform: 'sine', freq: 830, delay: 0.085, duration: 0.12, gain: 0.16, adsr: { a: 0.005, d: 0.09, s: 0, r: 0.06 } },
  ] } },
  run: { category: 'tv', priority: 5, config: { duration: 0.34, layers: [
    { waveform: 'triangle', freq: 523, duration: 0.1, gain: 0.16, adsr: { a: 0.005, d: 0.09, s: 0, r: 0.06 } },
    { waveform: 'triangle', freq: 659, delay: 0.09, duration: 0.1, gain: 0.16, adsr: { a: 0.005, d: 0.09, s: 0, r: 0.06 } },
    { waveform: 'triangle', freq: 784, delay: 0.18, duration: 0.16, gain: 0.18, adsr: { a: 0.005, d: 0.12, s: 0, r: 0.08 } },
  ] } },
  homer: { category: 'tv', priority: 6, config: { duration: 0.6, layers: [
    { waveform: 'sawtooth', freq: 392, duration: 0.12, gain: 0.12, filter: { type: 'lowpass', freq: 2600, q: 0.8 }, adsr: { a: 0.005, d: 0.1, s: 0.2, r: 0.1 } },
    { waveform: 'triangle', freq: 523, delay: 0.1, duration: 0.14, gain: 0.16, adsr: { a: 0.005, d: 0.11, s: 0.1, r: 0.08 } },
    { waveform: 'triangle', freq: 659, delay: 0.22, duration: 0.16, gain: 0.16, adsr: { a: 0.005, d: 0.12, s: 0.1, r: 0.09 } },
    { waveform: 'triangle', freq: 880, delay: 0.34, duration: 0.26, gain: 0.2, vibrato: { rate: 6, depth: 8 }, adsr: { a: 0.005, d: 0.14, s: 0.3, r: 0.14 } },
  ] } },
  strikeout: { category: 'tv', priority: 4, config: { duration: 0.3, layers: [
    { waveform: 'sawtooth', freq: 392, pitchBend: { to: 196, time: 0.18 }, duration: 0.24, gain: 0.12, filter: { type: 'lowpass', freq: 1400, q: 1.4 }, adsr: { a: 0.005, d: 0.2, s: 0.1, r: 0.08 } },
  ] } },
  out: { category: 'tv', priority: 3, config: { duration: 0.14, layers: [
    { waveform: 'sine', freq: 210, duration: 0.1, gain: 0.14, adsr: { a: 0.002, d: 0.09, s: 0, r: 0.05 } },
    { waveform: 'noise', noiseMix: 1, duration: 0.04, gain: 0.06, filter: { type: 'lowpass', freq: 600, q: 0.8 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 } },
  ] } },
};

// Pitch-by-pitch playback pacing. The overlay carries a whole at-bat; the client plays
// it back one pitch at a time at a realistic ballgame cadence (pitcher resets, batter
// steps in) — then holds the outcome. REVEAL_STEP_MS is the gap between pitches, capped
// so a long at-bat still finishes within REVEAL_MAX_MS (inside a line's on-air hold).
const REVEAL_STEP_MS = 2600;
const REVEAL_MAX_MS = 13000;
const OUTCOME_GAP_MS = 480;   // beat between the final pitch landing and the play resolving

// Motion durations for the field animation.
const T_PITCH = 340, T_THROW = 380, T_RUN = 680, T_FLY = 1150, T_HOMER = 1500;

// ── Field geometry (fractions of the .gd-field box; home bottom-centre) ──────────
// The box is a touch wider than tall (aspect ~1.18), so an extended outfield fits with
// the fielders on grass, well inside the fence. Coordinates are fractions of the box.
const POS = {
  home: [0.500, 0.900], b1: [0.665, 0.665], b2: [0.500, 0.475], b3: [0.335, 0.665], mound: [0.500, 0.665],
  P: [0.500, 0.640], C: [0.500, 0.965], F1B: [0.635, 0.600], F2B: [0.575, 0.520], SS: [0.425, 0.520],
  F3B: [0.365, 0.600], LF: [0.310, 0.285], CF: [0.500, 0.205], RF: [0.690, 0.285], bat: [0.452, 0.888],
  dugout: [0.500, 1.070],
};
const FIELDERS = [
  ['P', 'P'], ['C', 'C'], ['F1B', '1B'], ['F2B', '2B'], ['SS', 'SS'],
  ['F3B', '3B'], ['LF', 'LF'], ['CF', 'CF'], ['RF', 'RF'],
];
const BASE_POS = [POS.home, POS.b1, POS.b2, POS.b3];   // index by base number (0=home)
const SVGX = (fx) => (fx * 100).toFixed(1);
const SVGY = (fy) => (fy * 100).toFixed(1);             // field SVG viewBox is 100×100, stretched to the box

// ── Deterministic hit trajectory ─────────────────────────────────────────────────
// The sim gives us the at-bat kind but no spray direction. We derive a plausible one
// PURELY from the payload's server-synthed pitch data, so every viewer computes the
// identical play with no server change. Angle: −45 (left-field line) … +45 (right).
function _hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619); } return h >>> 0; }
function _rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// angle (deg) + depth (0..1) → a landing point on the field (depth 1 ≈ the fence).
function _spot(angleDeg, depth) {
  const a = angleDeg * Math.PI / 180;
  const fx = 0.50 + Math.sin(a) * 0.46 * depth;
  const fy = POS.home[1] - Math.cos(a) * 0.90 * depth;
  return [Math.max(0.03, Math.min(0.97, fx)), fy];
}
function _infielderForAngle(angle) {
  if (angle < -26) return 'F3B';
  if (angle < -6) return 'SS';
  if (angle <= 6) return 'P';
  if (angle <= 26) return 'F2B';
  return 'F1B';
}
function _outfielderForAngle(angle) { return angle < -15 ? 'LF' : (angle > 15 ? 'RF' : 'CF'); }

function _hitTrajectory(p) {
  const kind = p.kind || '';
  if (kind === 'strikeout' || kind === 'walk') return { batted: false };
  const pitches = Array.isArray(p.pitches) ? p.pitches : [];
  const seed = _hashStr(`${p.batter}|${p.inning}|${p.half}|${pitches.map(x => `${x.velo}.${x.x}`).join(',')}`);
  const rng = _rng(seed);
  const angle = Math.round((rng() * 2 - 1) * 30);
  const ground = kind === 'groundout' || kind === 'doubleplay' || kind === 'tripleplay' || kind === 'productout';
  const fly = kind === 'flyout' || kind === 'popout' || kind === 'sacfly';
  const depthByKind = { popout: 0.44, flyout: 0.66, sacfly: 0.60, single: 0.62, double: 0.72, triple: 0.80, homerun: 1.02 };
  const depth = depthByKind[kind] ?? 0.5;
  if (kind === 'homerun') return { batted: true, mode: 'homer', angle, land: _spot(angle, 1.02) };
  if (ground) return { batted: true, mode: 'ground', angle, fielder: _infielderForAngle(angle) };
  if (fly) return { batted: true, mode: 'fly', angle, land: _spot(angle, depth), fielder: kind === 'popout' ? _infielderForAngle(angle) : _outfielderForAngle(angle), caught: true };
  // hit into the outfield gap — nearest OF chases, no catch
  return { batted: true, mode: 'hit', angle, land: _spot(angle, depth), fielder: _outfielderForAngle(angle) };
}

// Foul poles + the fence bezier. `_fencePt(t)` samples the fence arc (t 0→1, left→right).
const GD_LP = [6, 15], GD_RP = [94, 15], GD_FC = [50, -3];
function _fencePt(t) { const mt = 1 - t; return [mt * mt * GD_LP[0] + 2 * mt * t * GD_FC[0] + t * t * GD_RP[0], mt * mt * GD_LP[1] + 2 * mt * t * GD_FC[1] + t * t * GD_RP[1]]; }

// ── Static field SVG (drawn once) — a top-down ballpark ──────────────────────────
// preserveAspectRatio="none" so SVG user units map straight to the box's %, keeping the
// tokens (which use left/top %) perfectly aligned with the drawn field at any box size.
function _fieldSvg() {
  const P = (k) => `${SVGX(POS[k][0])},${SVGY(POS[k][1])}`;
  const c = (k) => [SVGX(POS[k][0]), SVGY(POS[k][1])];
  const infield = `M${P('home')} L${P('b1')} L${P('b2')} L${P('b3')} Z`;
  const [lp, rp] = [GD_LP, GD_RP];
  const fence = `M${lp[0]},${lp[1]} Q${GD_FC[0]},${GD_FC[1]} ${rp[0]},${rp[1]}`;
  const track = `M${lp[0] + 3},${lp[1] + 4} Q50,3 ${rp[0] - 3},${lp[1] + 4}`;   // warning track, just inside
  const home = c('home');

  // Mowing fan — alternating grass wedges radiating from home to the fence.
  let mow = '';
  const N = 9;
  for (let i = 0; i < N; i += 2) { const a = _fencePt(i / N), b = _fencePt((i + 1) / N); mow += `<path class="gd-mow" d="M${home[0]},${home[1]} L${a[0].toFixed(1)},${a[1].toFixed(1)} L${b[0].toFixed(1)},${b[1].toFixed(1)} Z"/>`; }

  return (
    `<svg class="gd-field-bg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
      `<defs><pattern id="gdCrowd" width="2.4" height="2.4" patternUnits="userSpaceOnUse">` +
        `<rect width="2.4" height="2.4" fill="#0b1016"/><circle cx="0.7" cy="0.7" r="0.45" fill="rgba(255,255,255,0.07)"/><circle cx="1.9" cy="1.9" r="0.4" fill="rgba(255,255,255,0.05)"/>` +
      `</pattern></defs>` +
      // stands / crowd ring above the fence
      `<path class="gd-stands" d="M0,0 L100,0 L100,${rp[1]} L${rp[0]},${rp[1]} Q${GD_FC[0]},${GD_FC[1]} ${lp[0]},${lp[1]} L0,${lp[1]} Z"/>` +
      // fair-territory grass, home → poles → along the fence
      `<path class="gd-grass" d="M${SVGX(POS.home[0])},${SVGY(POS.home[1])} L${lp[0]},${lp[1]} Q${GD_FC[0]},${GD_FC[1]} ${rp[0]},${rp[1]} Z"/>` +
      mow +
      // warning track band + outfield fence (the fence sits BEYOND the outfielders)
      `<path class="gd-track" d="${track}" fill="none"/>` +
      `<path class="gd-fence" d="${fence}" fill="none"/>` +
      // foul lines home → poles
      `<line class="gd-foul" x1="${SVGX(POS.home[0])}" y1="${SVGY(POS.home[1])}" x2="${lp[0]}" y2="${lp[1]}"/>` +
      `<line class="gd-foul" x1="${SVGX(POS.home[0])}" y1="${SVGY(POS.home[1])}" x2="${rp[0]}" y2="${rp[1]}"/>` +
      // skinned infield — grass showing through, dirt base-paths + cut-outs + mound + home
      `<path class="gd-dirtpath" d="${infield}" fill="none"/>` +
      `<circle class="gd-dirtcut" cx="${c('b1')[0]}" cy="${c('b1')[1]}" r="4"/>` +
      `<circle class="gd-dirtcut" cx="${c('b2')[0]}" cy="${c('b2')[1]}" r="4"/>` +
      `<circle class="gd-dirtcut" cx="${c('b3')[0]}" cy="${c('b3')[1]}" r="4"/>` +
      `<circle class="gd-dirtcut" cx="${home[0]}" cy="${home[1]}" r="5.5"/>` +
      `<circle class="gd-mound" cx="${SVGX(POS.mound[0])}" cy="${SVGY(POS.mound[1])}" r="3.4"/>` +
      `<path class="gd-paths" d="${infield}" fill="none"/>` +
    `</svg>`
  );
}

// Instrument chrome over the field, echoing the minigame/tablet chassis (grid +
// scanlines + corner reticle brackets), driven by the TV accent so it tracks the
// channel theme. Purely decorative; built once, never re-rendered.
function _fieldChrome() {
  return `<div class="gd-crt-grid"></div><div class="gd-crt-scan"></div>` +
    `<div class="gd-reticle"><i></i><i></i><i></i><i></i></div>` +
    `<div class="gd-replaybug"><i></i>REPLAY</div>`;
}

function _fieldTokens() {
  const at = (k) => `left:${(POS[k][0] * 100).toFixed(1)}%;top:${(POS[k][1] * 100).toFixed(1)}%`;
  const bases = [
    `<div class="gd-fbase" data-b="1" style="${at('b1')}"></div>`,
    `<div class="gd-fbase" data-b="2" style="${at('b2')}"></div>`,
    `<div class="gd-fbase" data-b="3" style="${at('b3')}"></div>`,
    `<div class="gd-fbase home" data-b="0" style="${at('home')}"></div>`,
  ].join('');
  const fielders = FIELDERS.map(([k, lbl]) =>
    `<div class="gd-fielder" data-pos="${k}" style="${at(k)}">${lbl}</div>`).join('');
  return (
    `<div class="gd-fx"></div>` +
    `<div class="gd-bases">${bases}</div>` +
    `<div class="gd-fielders">${fielders}</div>` +
    `<div class="gd-batter" style="${at('bat')}"></div>` +
    `<div class="gd-ball" style="${at('mound')}"></div>` +
    `<div class="gd-runners"></div>`
  );
}

// The pitch plot (inset): strike-zone box + numbered dots; only the newest animates.
function _pitchPlot(pitches, newestN) {
  const ps = Array.isArray(pitches) ? pitches : [];
  const dots = ps.map((p) => {
    const cx = Math.max(0, Math.min(1, p.x)) * 100, cy = Math.max(0, Math.min(1, p.y)) * 100;
    const c = PITCH_RESULT_CLASS[p.result] || 'ball';
    const fresh = (p.n === newestN) ? ' new' : '';
    return `<g class="gd-pitch ${c}${fresh}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7"/><text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" dy="3.2">${p.n}</text></g>`;
  }).join('');
  return (
    `<svg class="gd-zone" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
      `<rect class="gd-zone-box" x="25" y="22" width="50" height="56"/>` +
      `<line class="gd-zone-grid" x1="41.7" y1="22" x2="41.7" y2="78"/><line class="gd-zone-grid" x1="58.3" y1="22" x2="58.3" y2="78"/>` +
      `<line class="gd-zone-grid" x1="25" y1="40.7" x2="75" y2="40.7"/><line class="gd-zone-grid" x1="25" y1="59.3" x2="75" y2="59.3"/>` +
      dots +
    `</svg>`
  );
}

// ── Broadcast strips (pure; painted each step from ctx) ──────────────────────────
// Inning-by-inning line score. The per-inning runs are authoritative (snapshotted on
// the server and carried in the payload); totals R come from the running score, H from
// the server's hit tally. Innings not yet reached render blank so it never spoils.
function _lineScoreHtml(ctx) {
  const line = ctx.p.line;
  const aArr = line && Array.isArray(line.away) ? line.away : [];
  const hArr = line && Array.isArray(line.home) ? line.home : [];
  const innings = Math.max(9, aArr.length, hArr.length);
  const cur = ctx.p.inning || 0;
  const cells = (arr) => {
    let out = '';
    for (let i = 0; i < innings; i++) out += `<td class="${i + 1 === cur ? 'cur' : ''}">${i < arr.length ? arr[i] : ''}</td>`;
    return out;
  };
  let head = '';
  for (let i = 1; i <= innings; i++) head += `<td class="${i === cur ? 'cur' : ''}">${i}</td>`;
  const hA = line ? (line.hAway | 0) : 0, hH = line ? (line.hHome | 0) : 0;
  return `<div class="gd-ls-scroll"><table class="gd-ls">` +
    `<tr class="gd-ls-head"><td class="gd-ls-team"></td>${head}<td class="gd-ls-tot">R</td><td class="gd-ls-tot">H</td></tr>` +
    `<tr class="gd-ls-away"><td class="gd-ls-team">${_esc(ctx.away.abbr || 'AWY')}</td>${cells(aArr)}<td class="gd-ls-tot">${ctx.aScore}</td><td class="gd-ls-tot">${hA}</td></tr>` +
    `<tr class="gd-ls-home"><td class="gd-ls-team">${_esc(ctx.home.abbr || 'HOM')}</td>${cells(hArr)}<td class="gd-ls-tot">${ctx.hScore}</td><td class="gd-ls-tot">${hH}</td></tr>` +
    `</table></div>`;
}

// Lightweight live win-probability estimate (NOT a trained model): a logistic on the
// run differential whose steepness grows as outs run out, nudged by baserunners for the
// batting side, and pinned when the home team leads walk-off-late. Labelled "est".
function _winProbHome(aScore, hScore, inning, half, outs, bases) {
  const lead = hScore - aScore;
  const outsTotal = (Math.max(1, inning) - 1) * 6 + (half === 'bottom' ? 3 : 0) + Math.min(3, outs | 0);
  const remaining = Math.max(0, 54 - outsTotal);
  const k = 0.9 + (1 - remaining / 54) * 2.6;
  let wp = 1 / (1 + Math.exp(-k * lead));
  const onBase = (bases || []).filter(Boolean).length;
  wp += onBase * 0.015 * (half === 'bottom' ? 1 : -1);
  if (inning >= 9 && half === 'bottom' && lead > 0) wp = Math.max(wp, 0.995);
  return Math.max(0.02, Math.min(0.98, wp));
}
function _winProbHtml(ctx, outcome) {
  const p = ctx.p;
  const bases = outcome ? (p.basesAfter || []) : (p.basesBefore || []);
  const outs = outcome ? ctx.outsAfter : ctx.outsBefore;
  const pctH = Math.round(_winProbHome(ctx.aScore, ctx.hScore, p.inning || 1, p.half || 'top', outs, bases) * 100);
  const pctA = 100 - pctH;
  const aLead = ctx.aScore > ctx.hScore;
  return `<span class="gd-wp-label">WIN PROB<i>est</i></span>` +
    `<span class="gd-wp-side away${aLead ? ' lead' : ''}">${_esc(ctx.away.abbr || 'AWY')} ${pctA}%</span>` +
    `<span class="gd-wp-bar"><i class="a" style="width:${pctA}%"></i><i class="h" style="width:${pctH}%"></i></span>` +
    `<span class="gd-wp-side home${!aLead ? ' lead' : ''}">${pctH}% ${_esc(ctx.home.abbr || 'HOM')}</span>`;
}

// League standings dock — the two teams in this game are highlighted. Games-back is
// derived from the leader's record; the leader shows a dash.
function _standingsHtml(rows, awayName, homeName) {
  if (!Array.isArray(rows) || !rows.length) return `<div class="gd-stand-empty">Standings loading…</div>`;
  const leadW = rows[0].wins | 0, leadL = rows[0].losses | 0;
  const body = rows.map((r, i) => {
    const gb = i === 0 ? '—' : (((leadW - (r.wins | 0)) + ((r.losses | 0) - leadL)) / 2).toFixed(1).replace(/\.0$/, '');
    const me = (r.team === awayName || r.team === homeName) ? ' me' : '';
    return `<div class="gd-stand-row${me}">` +
      `<span class="gd-stand-rank">${i + 1}</span>` +
      `<span class="gd-stand-team">${_esc(r.team)}</span>` +
      `<span class="gd-stand-rec">${r.wins | 0}-${r.losses | 0}</span>` +
      `<span class="gd-stand-gb">${gb}</span>` +
    `</div>`;
  }).join('');
  return `<div class="gd-stand">${body}</div>`;
}

export function createGamedayView(host) {
  let timers = [];
  let caption = '';          // last announcer line, retained across the shell rebuild
  let pendingCaption = null; // { text, speak } for the current at-bat, held until the hit lands
  let pendingCard = null;    // a jumbotron card (HR/DP/…) held until the play lands
  let playAnimating = false; // an at-bat is on the field right now — hold event graphics until it lands
  let field = null;          // the persistent .gd-field element (tokens live here)
  let cardTimer = null;      // auto-dismiss for the Gameday-native jumbotron card
  let standingsRows = [];    // last league table seen (rides the payload); persists between at-bats
  let ambientOn = false;     // the between-plays idle loop is running (see _startAmbient)

  function _stop() { timers.forEach(clearTimeout); timers = []; playAnimating = false; ambientOn = false; pendingCard = null; }
  function _t(ms, fn) { timers.push(setTimeout(fn, Math.max(0, ms))); }
  function _sfx(def) { window.AudioEngine?.playSfx(def); }
  const _pitchSfx = (pt, terminal) => pt.result === 'swinging' ? SFX.whiff
    : (terminal && pt.result === 'inplay' ? SFX.crack : SFX.mitt);

  // Move a token (fractional coords) with a timed CSS transition. Optional 'lift' adds
  // a vertical hop (fly balls / home runs).
  function _move(el, key, ms, ease, lift) {
    if (!el) return;
    const [fx, fy] = Array.isArray(key) ? key : POS[key];
    el.style.transition = `left ${ms}ms ${ease || 'linear'}, top ${ms}ms ${ease || 'linear'}`;
    el.style.left = `${(fx * 100).toFixed(1)}%`;
    el.style.top = `${(fy * 100).toFixed(1)}%`;
    if (lift) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = `gd-lift ${ms}ms ease-out`; _t(ms + 20, () => { if (el) el.style.animation = ''; }); }
  }
  function _place(el, key) { if (!el) return; const [fx, fy] = Array.isArray(key) ? key : POS[key]; el.style.transition = 'none'; el.style.left = `${(fx * 100).toFixed(1)}%`; el.style.top = `${(fy * 100).toFixed(1)}%`; }
  const _base = (n) => field?.querySelector(`.gd-fbase[data-b="${n}"]`);
  const _litBase = (n, on) => { const b = _base(n); if (b) b.classList.toggle('lit', !!on); };
  const _crossBase = (n) => { const b = _base(n); if (!b) return; b.classList.remove('cross'); void b.offsetWidth; b.classList.add('cross'); };
  const _fxLayer = () => field?.querySelector('.gd-fx');

  // Spawn a short-lived effect token at fractional coords and auto-remove it.
  function _spawn(cls, key, life) {
    const layer = _fxLayer(); if (!layer) return null;
    const el = document.createElement('div'); el.className = cls;
    const [fx, fy] = Array.isArray(key) ? key : POS[key];
    el.style.left = `${(fx * 100).toFixed(1)}%`; el.style.top = `${(fy * 100).toFixed(1)}%`;
    layer.appendChild(el); _t(life, () => el.remove()); return el;
  }
  // A fading trail behind the ball: drops lit up in sequence along from→to as it passes.
  function _trail(from, to, ms, hot) {
    const a = Array.isArray(from) ? from : POS[from], b = Array.isArray(to) ? to : POS[to];
    const n = 6;
    for (let i = 1; i <= n; i++) { const f = i / (n + 1); const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f; _t(f * ms * 0.85, () => _spawn(`gd-trail${hot ? ' hot' : ''}`, [x, y], 520)); }
  }
  const _dust = (key) => _spawn('gd-dust', key, 620);            // kicked-up dirt at a bag
  const _burst = (key) => _spawn('gd-burst', key, 900);          // celebratory ring

  // Field-wide celebration for a home run / walk-off: pulse the field glow and pop a
  // scatter of bursts along the fence where the ball left the yard.
  function _celebrate(kind) {
    if (!field) return;
    field.classList.remove('celebrate', 'walkoff'); void field.offsetWidth;
    field.classList.add('celebrate'); if (kind === 'walkoff') field.classList.add('walkoff');
    _t(2400, () => field && field.classList.remove('celebrate', 'walkoff'));
    const n = kind === 'walkoff' ? 6 : 4;
    for (let i = 0; i < n; i++) { const pt = _fencePt(0.22 + (i / (n - 1)) * 0.56); _t(i * 150, () => _spawn('gd-burst hot', [pt[0] / 100, pt[1] / 100], 900)); }
  }

  // Update the score bug + side rail (score, count, plot, matchup, play card). Never
  // touches the field (its tokens are animating), so it's safe to re-render each step.
  function _paintSide(ctx, reveal, outcome) {
    const { p, isTop, away, home, aScore, hScore, cp, N, outsBefore, outsAfter, awayName, homeName } = ctx;
    const outs = outcome ? outsAfter : outsBefore;
    let count = '0-0';
    if (outcome || reveal >= N) count = cp ? `${cp.balls}-${cp.strikes}` : '0-0';
    else if (reveal > 0) { const pt = p.pitches[reveal - 1]; count = `${pt.balls}-${pt.strikes}`; }
    const shown = p.pitches.slice(0, reveal);
    const newestN = outcome ? -1 : reveal;
    const statusArrow = isTop ? '▲' : '▼';
    const runFlash = (outcome && p.rbi > 0) ? ' scored' : '';
    const outDots = [0, 1, 2].map(i => `<span class="gd-out${i < outs ? ' on' : ''}"></span>`).join('');
    const playCard = ctx.changeover
      ? `<div class="gd-play pending"><div class="gd-play-desc">CHANGEOVER</div><div class="gd-play-bat">${_esc(p.battingTeam || '')} batting</div></div>`
      : outcome
      ? `<div class="gd-play${runFlash}"><div class="gd-play-desc">${_esc(p.desc || '')}</div><div class="gd-play-bat">${_esc(p.batter || '')}</div></div>`
      : `<div class="gd-play pending"><div class="gd-play-desc">AT BAT</div><div class="gd-play-bat">${_esc(p.batter || '')}</div></div>`;

    // Broadcast score bug.
    host.querySelector('.gd-top').innerHTML =
      `<div class="gd-team away${aScore > hScore ? ' lead' : ''}"><span class="gd-abbr">${_esc(away.abbr || 'AWY')}</span><span class="gd-score">${aScore}</span></div>` +
      `<div class="gd-mid">` +
        `<span class="gd-inn">${statusArrow} ${_esc((p.inningOrd || '').toUpperCase())}</span>` +
        `<span class="gd-mid-line"><span class="gd-outs" title="${outs} out">${outDots}</span><span class="gd-count">${count}</span></span>` +
      `</div>` +
      `<div class="gd-team home${hScore > aScore ? ' lead' : ''}"><span class="gd-score">${hScore}</span><span class="gd-abbr">${_esc(home.abbr || 'HOM')}</span></div>`;

    // Side rail — instrument cards echoing the minigame chassis (micro-labels + left bar).
    host.querySelector('.gd-rail').innerHTML =
      `<div class="gd-card gd-countcard"><span class="gd-microlabel">Count</span><span class="gd-count-big">${count}</span><span class="gd-outlabel">${outs} out</span></div>` +
      `<div class="gd-card gd-plotcard"><span class="gd-microlabel">Pitch Tracker</span><div class="gd-plot-inset">${_pitchPlot(shown, newestN)}</div></div>` +
      `<div class="gd-card gd-matchcard">` +
        `<div class="gd-mrow"><span class="gd-mlabel">P</span><span class="gd-mname">${_esc(p.pitcher || '—')}</span></div>` +
        `<div class="gd-mrow"><span class="gd-mlabel bat">AB</span><span class="gd-mname">${_esc(p.batter || '—')}</span></div>` +
      `</div>` +
      playCard +
      `<div class="gd-card gd-standcard"><span class="gd-microlabel">League</span>${_standingsHtml(standingsRows, awayName, homeName)}</div>`;

    // Broadcast strips: inning-by-inning line score (under the score bug) + live win
    // probability (below the field). Both are safe to repaint each step.
    const lsEl = host.querySelector('.gd-linescore');
    if (lsEl) lsEl.innerHTML = _lineScoreHtml(ctx);
    const wpEl = host.querySelector('.gd-winprob');
    if (wpEl) wpEl.innerHTML = _winProbHtml(ctx, outcome);
  }

  // Spawn a runner token at a base and return it.
  function _runner(baseN) {
    const layer = field?.querySelector('.gd-runners');
    if (!layer) return null;
    const el = document.createElement('div');
    el.className = 'gd-runner';
    _place(el, BASE_POS[baseN]);
    layer.appendChild(el);
    return el;
  }

  // Animate the resolved play: batted ball out to the field (fielded / over the fence),
  // the responsible fielder converging, and the runners advancing round the bases.
  function _animateOutcome(ctx, traj) {
    const ball = field.querySelector('.gd-ball');
    const batter = field.querySelector('.gd-batter');
    const p = ctx.p;

    // ── Ball + fielder ──
    if (traj.batted) {
      if (traj.mode === 'homer') {
        _trail(POS.home, traj.land, T_HOMER, true);
        _move(ball, traj.land, T_HOMER, 'ease-out', true);
        _t(T_HOMER, () => { if (ball) ball.style.opacity = '0'; _burst(traj.land); _celebrate(p.walkoff ? 'walkoff' : 'homer'); });
      } else if (traj.mode === 'ground') {
        _trail(POS.home, POS[traj.fielder], T_THROW);
        _move(ball, traj.fielder, T_THROW, 'linear');            // grounder to the infielder
        _t(T_THROW, () => { _sfx(SFX.glove); _trail(POS[traj.fielder], POS.F1B, T_THROW); _move(ball, 'F1B', T_THROW, 'linear'); _move(field.querySelector(`.gd-fielder[data-pos="${traj.fielder}"]`), traj.fielder, 1, 'linear'); });
      } else { // fly / hit — arc to the landing spot; a fly is caught there
        _trail(POS.home, traj.land, T_FLY);
        _move(ball, traj.land, T_FLY, 'ease-out', true);
        const f = field.querySelector(`.gd-fielder[data-pos="${traj.fielder}"]`);
        _move(f, traj.land, T_FLY, 'ease-in-out');
        if (traj.caught) _t(T_FLY, () => _sfx(SFX.glove));
        if (p.walkoff) _t(T_FLY, () => _celebrate('walkoff'));
      }
    }

    // ── Runners ──
    const adv = { single: 1, double: 2, triple: 3, homerun: 4, walk: 1 }[p.kind] || 0;
    const before = p.basesBefore || [false, false, false];
    // clear pre-play lit; runner arrivals re-light below
    [0, 1, 2, 3].forEach(n => _litBase(n, false));

    // Slide + kick up dirt as a runner reaches a bag.
    const arrive = (el, key) => { _dust(key); if (el) { el.classList.remove('sliding'); void el.offsetWidth; el.classList.add('sliding'); } };
    // Cross the plate and peel off to the dugout (a run scores).
    const peel = (el) => { _crossBase(0); arrive(el, 'home'); _move(el, 'dugout', T_RUN, 'ease-in'); _t(T_RUN, () => el && el.remove()); };

    // Advance a token base-by-base along the paths — ALWAYS 1st→2nd→3rd→home, one bag
    // at a time, never cutting across the diamond. `startBase` is where it starts (0 =
    // home, for the batter). Intermediate bags get a cross-pulse; the final bag lights.
    const runBases = (el, startBase, bases, delay, legMs) => {
      const dur = legMs || T_RUN;
      _t(delay, () => {
        for (let s = 1; s <= bases; s++) {
          const to = startBase + s;
          const last = s === bases;
          _t((s - 1) * dur, () => _move(el, to >= 4 ? 'home' : BASE_POS[to], dur, to >= 4 ? 'ease-in' : 'ease-in-out'));
          if (to >= 4) _t(s * dur, () => peel(el));
          else if (last) _t(s * dur, () => { _litBase(to, true); arrive(el, BASE_POS[to]); });
          else _t(s * dur, () => _crossBase(to));       // touched the bag in passing
        }
      });
    };

    // Pre-existing runners advance lead-first.
    for (let b = 3; b >= 1; b--) {
      if (!before[b - 1]) continue;
      const r = ctx.runners[b];
      if (!r) continue;
      let steps = adv;
      if (adv === 0) {   // an out — a few situational advances
        if (p.kind === 'sacfly' && b === 3) steps = 1;
        else if (p.kind === 'productout') steps = 1;
        // A double play is not a freeze-frame for everyone else. The man on third
        // scores on a 6-4-3 — unless it was the third out, which is what rbi tells us.
        else if (p.kind === 'doubleplay' && b === 3) steps = p.rbi > 0 ? 1 : 0;
        else if (p.kind === 'doubleplay' && b === 2) steps = 1;   // forced up to third by the batter-runner
        else if (p.kind === 'doubleplay' && b === 1) { _t(T_THROW * 2, () => { _crossBase(1); r.classList.add('outed'); _t(300, () => r.remove()); }); continue; }
        // Triple play: the lead force at third goes first, then second, then the throw
        // across. Staggering them is the whole read of the play — three separate outs,
        // not one event, so the eye can follow the ball around the horn.
        else if (p.kind === 'tripleplay' && (b === 1 || b === 2)) {
          const at = b === 2 ? T_THROW : T_THROW * 2;
          _t(at, () => { _crossBase(b); r.classList.add('outed'); _t(300, () => r.remove()); });
          continue;
        }
        else steps = 0;
      }
      if (steps > 0) runBases(r, b, steps, traj.mode === 'ground' ? 120 : 60);
      else _t(30, () => _litBase(b, true));   // held — stays put, stays lit
    }

    // Batter-runner — out of the box and around the bags one at a time.
    if (adv >= 1) {
      const dest = Math.min(adv, 4);
      runBases(batter, 0, dest, 0, dest >= 4 ? T_RUN * 0.8 : T_RUN);
    } else if (p.out && (p.kind === 'groundout' || p.kind === 'doubleplay' || p.kind === 'tripleplay' || p.kind === 'productout')) {
      // grounder: batter runs it out, thrown out at first
      _move(batter, 'b1', T_RUN, 'linear');
      _t(T_RUN, () => { batter.classList.add('outed'); _dust('b1'); });
    } else {
      // fly / pop / K — batter doesn't reach
      _t(200, () => batter.classList.add('outed'));
    }

    // Reconcile to the authoritative final base state once the motion has settled
    // (a runner may now traverse up to three bags one at a time, plus the peel).
    const settle = Math.max(T_RUN * 5, T_FLY) + 500;
    _t(settle, () => {
      const after = p.basesAfter || [false, false, false];
      [1, 2, 3].forEach(n => _litBase(n, after[n - 1]));
      _litBase(0, false);
    });
  }

  // ── Ambient: the ballpark between plays ─────────────────────────────────────
  // apply() used to schedule the whole at-bat through _t() and then let the timer
  // list run dry, so once a play settled the field became a photograph until the
  // next beat arrived. Nothing was wrong on screen — but stopped-correct reads as
  // hung, and on a chatter line or an inning break that's ten seconds of it.
  //
  // So the field idles instead of stopping. Small stuff, deliberately: a pitcher
  // resetting on the rubber, an infielder taking a step, the catcher throwing down
  // to second. Enough that the picture is alive, never so much that it competes
  // with a play. Every motion goes through the same _t() timer list as everything
  // else, which is what makes _stop() — and therefore the next at-bat — cancel it
  // for free.
  const AMB_MIN_MS = 1500, AMB_MAX_MS = 3200;
  const AMB_POS = FIELDERS.map(([k]) => k);
  function _jitter(key, amt) {
    const el = field?.querySelector(`.gd-fielder[data-pos="${key}"]`);
    if (!el) return;
    const [fx, fy] = POS[key];
    const dx = (Math.random() * 2 - 1) * amt, dy = (Math.random() * 2 - 1) * amt;
    _move(el, [fx + dx, fy + dy], 700 + Math.random() * 500, 'ease-in-out');
  }
  function _startAmbient() {
    if (!field || ambientOn) return;
    ambientOn = true;
    const tick = () => {
      if (!ambientOn || !field || playAnimating) return;
      const roll = Math.random();
      if (roll < 0.30) {
        _jitter('P', 0.006);                                   // pitcher resets on the rubber
      } else if (roll < 0.42) {
        // Catcher throws down to second and the middle infield flips it back. The one
        // ambient beat that moves the BALL, so it stays rare — a ball in motion between
        // plays must never be mistaken for a play.
        const ball = field.querySelector('.gd-ball');
        if (ball) {
          _trail(POS.C, POS.b2, T_THROW);
          _move(ball, 'b2', T_THROW, 'linear');
          _t(T_THROW, () => { _sfx(SFX.glove); _trail(POS.b2, POS.mound, T_THROW); _move(ball, 'mound', T_THROW, 'linear'); });
        }
      } else {
        _jitter(AMB_POS[Math.floor(Math.random() * AMB_POS.length)], 0.010);   // somebody shifts
      }
      _t(AMB_MIN_MS + Math.random() * (AMB_MAX_MS - AMB_MIN_MS), tick);
    };
    _t(AMB_MIN_MS, tick);
  }

  // ── The half-inning changeover ──────────────────────────────────────────────
  // Rides the `phase: 'half'` payload the server now sends with the half's framing
  // line. This is NOT an at-bat: there are no pitches and no play, so it clears the
  // field rather than replaying anything — the previous half's last out is wiped, the
  // bases go dark, and the new nine trot out from the dugout before settling into the
  // ambient idle. Without it the panel simply held the last frame through the break.
  function _applyHalf(p) {
    const isTop = p.half === 'top';
    const aScore = Number.isFinite(p.awayScore) ? p.awayScore : 0;
    const hScore = Number.isFinite(p.homeScore) ? p.homeScore : 0;
    const away = isTop ? { abbr: p.battingAbbr } : { abbr: p.fieldingAbbr };
    const home = isTop ? { abbr: p.fieldingAbbr } : { abbr: p.battingAbbr };

    host.innerHTML =
      `<div class="gd-top"></div>` +
      `<div class="gd-linescore"></div>` +
      `<div class="gd-main">` +
        `<div class="gd-fieldwrap"><div class="gd-field">${_fieldSvg()}${_fieldTokens()}${_fieldChrome()}</div></div>` +
        `<div class="gd-rail"></div>` +
      `</div>` +
      `<div class="gd-winprob"></div>` +
      `<div class="gd-caption"><span class="gd-cap-tag">◆ Chip Vega</span><span class="gd-cap-text">${_esc(caption)}</span></div>`;
    field = host.querySelector('.gd-field');

    const wipe = document.createElement('div'); wipe.className = 'gd-wipe';
    host.appendChild(wipe);
    requestAnimationFrame(() => wipe.classList.add('go'));
    _t(720, () => wipe.remove());

    // A fresh half starts empty, always: nobody on, nobody out. Saying so explicitly
    // is what erases the previous half's terminal frame.
    const ctx = {
      p: { ...p, pitches: [], batter: '', desc: '', basesBefore: [false, false, false], basesAfter: [false, false, false] },
      isTop, away, home, awayName: isTop ? p.battingTeam : p.fieldingTeam, homeName: isTop ? p.fieldingTeam : p.battingTeam,
      aScore, hScore, cp: null, N: 0, outsBefore: 0, outsAfter: 0, runners: {}, traj: { batted: false }, changeover: true,
    };
    [0, 1, 2, 3].forEach(n => _litBase(n, false));
    _paintSide(ctx, 0, false);

    // The nine come out of the dugout, staggered, and take their positions.
    FIELDERS.forEach(([k], idx) => {
      const el = field.querySelector(`.gd-fielder[data-pos="${k}"]`);
      if (!el) return;
      _place(el, 'dugout');
      el.style.opacity = '0';
      _t(160 + idx * 90, () => { if (!el) return; el.style.opacity = ''; _move(el, k, 900, 'ease-out'); });
    });
    const ball = field.querySelector('.gd-ball');
    _place(ball, 'mound');

    _renderCard({ kind: 'half', inningOrd: p.inningOrd, half: p.half, batting: p.battingTeam, duration: 3.4 });

    // tv.js holds every line that rides a gameday payload, because a play-by-play call
    // must not land before the ball does. A changeover has no ball, so nothing would
    // ever release it — the line would sit in pendingCaption and be spoken at the end
    // of the NEXT at-bat, against the wrong play. Release it here, a beat in, so it
    // reads with the fielders coming out.
    const pend = pendingCaption;
    pendingCaption = null;
    if (pend) _t(420, () => { _showCaption(pend.text); if (pend.speak) pend.speak(); });

    _t(160 + FIELDERS.length * 90 + 900, _startAmbient);
  }

  function apply(p) {
    if (!host || !p) return;
    _stop();
    if (Array.isArray(p.standings) && p.standings.length) standingsRows = p.standings;   // freshest table; retained otherwise
    if (p.phase === 'half') { _applyHalf(p); return; }
    const isTop = p.half === 'top';
    const away = isTop ? { abbr: p.battingAbbr } : { abbr: p.fieldingAbbr };
    const home = isTop ? { abbr: p.fieldingAbbr } : { abbr: p.battingAbbr };
    const awayName = isTop ? p.battingTeam : p.fieldingTeam;   // full names for the standings highlight
    const homeName = isTop ? p.fieldingTeam : p.battingTeam;
    const aScore = Number.isFinite(p.awayScore) ? p.awayScore : 0;
    const hScore = Number.isFinite(p.homeScore) ? p.homeScore : 0;
    const pitches = Array.isArray(p.pitches) ? p.pitches : [];
    const N = pitches.length;
    const cp = N > 1 ? pitches[N - 2] : null;
    const outsAfter = Math.max(0, Math.min(3, p.outs | 0));
    const outsBefore = Math.max(0, outsAfter - (p.out ? (p.kind === 'tripleplay' ? 3 : p.kind === 'doubleplay' ? 2 : 1) : 0));
    const traj = _hitTrajectory(p);

    // Build the shell once; the field + its tokens persist through this at-bat so they
    // can animate. The header/side get repainted each step; the field does not.
    host.innerHTML =
      `<div class="gd-top"></div>` +
      `<div class="gd-linescore"></div>` +
      `<div class="gd-main">` +
        `<div class="gd-fieldwrap"><div class="gd-field">${_fieldSvg()}${_fieldTokens()}${_fieldChrome()}</div></div>` +
        `<div class="gd-rail"></div>` +
      `</div>` +
      `<div class="gd-winprob"></div>` +
      `<div class="gd-caption"><span class="gd-cap-tag">◆ Chip Vega</span><span class="gd-cap-text">${_esc(caption)}</span></div>`;
    field = host.querySelector('.gd-field');
    field.classList.add('replaying');   // the ◉ REPLAY bug shows while the play runs; cleared when it lands

    // Camera-cut wipe: each new at-bat sweeps in so it reads as a fresh replay rather
    // than a mutation of the last. Pure CSS; auto-removed after the sweep.
    const wipe = document.createElement('div'); wipe.className = 'gd-wipe';
    host.appendChild(wipe);
    requestAnimationFrame(() => wipe.classList.add('go'));
    _t(720, () => wipe.remove());

    // Existing runners on base at the start (lit), plus the batter waiting at the plate.
    const before = p.basesBefore || [false, false, false];
    const runners = {};
    [1, 2, 3].forEach(b => { if (before[b - 1]) { runners[b] = _runner(b); _litBase(b, true); } });

    const ctx = { p: { ...p, pitches }, isTop, away, home, awayName, homeName, aScore, hScore, cp, N, outsBefore, outsAfter, runners, traj };
    _paintSide(ctx, 0, false);

    const step = N > 1 ? Math.min(REVEAL_STEP_MS, REVEAL_MAX_MS / (N - 1)) : REVEAL_STEP_MS;
    const ball = field.querySelector('.gd-ball');
    for (let k = 1; k <= N; k++) {
      const terminal = k === N;
      const pt = pitches[k - 1];
      _t((k - 1) * step, () => {
        _paintSide(ctx, k, false);
        _place(ball, 'mound'); void field.offsetWidth;
        _move(ball, 'home', T_PITCH, 'ease-in');                        // pitch to the plate
        _sfx(_pitchSfx(pt, terminal));
        if (!terminal) _t(step * 0.5, () => _move(ball, 'mound', T_PITCH, 'linear'));   // reset for the next pitch
      });
    }

    // Outcome: a beat after the final pitch lands.
    const outMs = Math.max(0, N - 1) * step + OUTCOME_GAP_MS;
    _t(outMs, () => {
      _paintSide(ctx, N, true);
      _animateOutcome(ctx, traj);
      if (p.kind === 'homerun') _sfx(SFX.homer);
      else if (p.rbi > 0) _sfx(SFX.run);
      else if (p.kind === 'strikeout') _sfx(SFX.strikeout);
      else if (p.out) { _sfx(SFX.out); if (p.kind === 'doubleplay') _t(150, () => _sfx(SFX.out)); else if (p.kind === 'tripleplay') { _t(150, () => _sfx(SFX.out)); _t(300, () => _sfx(SFX.out)); } }
      else _sfx(SFX.base);
    });

    // The play "lands" once the batted ball has finished travelling. Hold everything
    // that reacts to it until that moment — Chip's call (staged by setCaption on this
    // beat), his voice, AND any event graphic (HOME RUN / DOUBLE PLAY / …) that rides
    // the beat and reaches showCard just after this apply — so they land as a reaction
    // to the play rather than spoiling it. The previous at-bat's line lingers until then.
    const ballFlight = !traj.batted ? 200
      : traj.mode === 'homer' ? T_HOMER
      : traj.mode === 'ground' ? T_THROW * 2
      : T_FLY;
    const pend = pendingCaption;
    pendingCaption = null;
    playAnimating = true;
    _t(outMs + ballFlight, () => {
      playAnimating = false;
      field?.classList.remove('replaying');   // play has landed — drop the REPLAY bug
      if (pend) { _showCaption(pend.text); if (pend.speak) pend.speak(); }
      if (pendingCard) { const fx = pendingCard; pendingCard = null; _renderCard(fx); }
    });

    // The play is over but the half is not. Hand off to the idle loop once everything
    // has settled, so the gap before the next beat is a ballpark rather than a photo.
    _t(outMs + ballFlight + Math.max(T_RUN * 5, T_FLY) + 900, _startAmbient);
  }

  // Paint a line into the caption bar with the slide-in animation.
  function _showCaption(text) {
    caption = String(text || '');
    const el = host && host.querySelector('.gd-cap-text');
    if (el) { el.textContent = caption; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); }
  }

  // Chip's line, forwarded from tv.js as broadcast lines arrive. tv.js hands us the
  // caption text plus a `speak` thunk (the formant voice), and we start both together.
  //   held (a play-by-play line): stage it — apply() reveals + speaks it once the batted
  //     ball has finished its flight, so the call reads as a reaction to the hit. His
  //     line rides the beat just BEFORE the `gameday` overlay that starts the animation.
  //   not held (a between-play line): show + speak the moment he says it, not to an event.
  function setCaption(text, opts) {
    const speak = opts && opts.speak;
    if (opts && opts.held) {
      pendingCaption = { text: String(text || ''), speak };
    } else {
      _showCaption(text);
      if (speak) speak();
    }
  }

  // Gameday-native jumbotron card. The server fires the same `sportsfx` graphics that
  // normally take over the whole TV; while Gameday is open, tv.js routes them here so
  // they render as a compact banner OVER the field instead — the field stays visible.
  const CARD = {
    homerun: (fx) => ({ title: fx.grand ? 'GRAND SLAM' : 'HOME RUN', sub: [fx.batter, fx.team].filter(Boolean).join(' · '), cls: 'hot' }),
    walkoff: (fx) => ({ title: 'WALK-OFF!', sub: [fx.batter, fx.team].filter(Boolean).join(' · '), cls: 'hot' }),
    doubleplay: () => ({ title: 'DOUBLE PLAY', sub: 'Two down', cls: 'out' }),
    // Not a server sportsfx — the changeover renders this one itself.
    half: (fx) => ({ title: `${String(fx.inningOrd || '').toUpperCase()}${fx.half === 'top' ? ' ▲' : ' ▼'}`, sub: fx.batting ? `${fx.batting} batting` : '', cls: '' }),
    tripleplay: () => ({ title: 'TRIPLE PLAY', sub: 'Three down, one pitch', cls: 'hot' }),
    extras: (fx) => ({ title: 'EXTRA INNINGS', sub: fx.inningOrd ? `${fx.inningOrd} · Free Baseball` : 'Free Baseball', cls: '' }),
    gamewin: (fx) => ({ title: 'FINAL', sub: fx.winner ? `${fx.winner} ${fx.winScore}–${fx.loseScore}` : '', cls: 'final' }),
    matchup: (fx) => ({ title: 'DEADBALL', sub: (fx.away && fx.home) ? `${fx.away} vs ${fx.home}` : '', cls: '' }),
    worldseries: (fx) => ({ title: 'WORLD SERIES', sub: (fx.away && fx.home) ? `${fx.away} vs ${fx.home}` : '', cls: 'hot' }),
    champion: (fx) => ({ title: '🏆 CHAMPIONS', sub: fx.winner || '', cls: 'hot' }),
  };
  function _renderCard(fx) {
    if (!host || !fx || !CARD[fx.kind]) return;
    const m = CARD[fx.kind](fx);
    let el = host.querySelector('.gd-jumbo');
    if (!el) { el = document.createElement('div'); el.className = 'gd-jumbo'; host.appendChild(el); }
    el.innerHTML = `<div class="gd-jumbo-title">${_esc(m.title)}</div>${m.sub ? `<div class="gd-jumbo-sub">${_esc(m.sub)}</div>` : ''}`;
    el.className = `gd-jumbo ${m.cls}`; void el.offsetWidth; el.classList.add('in');
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = setTimeout(() => el && el.classList.remove('in'), (fx.duration || 3.5) * 1000);
  }
  // A jumbotron graphic rides the same beat as its play and reaches us just AFTER the
  // `gameday` overlay that starts the animation. If an at-bat is on the field, hold the
  // card until it lands (apply()'s reveal shows it, in step with Chip's call); otherwise
  // — a game-level card between at-bats (matchup / FINAL / extras) — show it right away.
  function showCard(fx) {
    if (!host || !fx || !CARD[fx.kind]) return;
    if (playAnimating) pendingCard = fx;
    else _renderCard(fx);
  }
  function _clearCard() { if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; } host?.querySelector('.gd-jumbo')?.remove(); }

  // Idle screen — shown when Gameday is opened before an at-bat has arrived (or on a
  // non-sports channel), so the view is never just black.
  function showIdle() {
    if (!host) return;
    _stop(); _clearCard();
    field = null;
    host.innerHTML =
      `<div class="gd-idle">` +
        `<div class="gd-idle-logo">◆</div>` +
        `<div class="gd-idle-title">DEADBALL · GAMEDAY</div>` +
        `<div class="gd-idle-sub">Waiting for the next pitch…</div>` +
      `</div>`;
  }

  function clear() {
    _stop(); _clearCard();
    if (host) host.innerHTML = '';
    field = null;
    caption = '';
    pendingCaption = null;
  }

  return { apply, clear, setCaption, showIdle, showCard };
}

// Test hook — pure, DOM-independent pieces exercised by the offline harness.
export const __test = { hitTrajectory: _hitTrajectory, REVEAL_STEP_MS, REVEAL_MAX_MS, OUTCOME_GAP_MS };
