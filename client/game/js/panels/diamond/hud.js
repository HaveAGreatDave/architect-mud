/**
 * The arcade graphics package: a ballgame's graphics drawn the way a 1990s arcade game drew
 * them, over the 3-D picture (Phase 1d of docs/proposals/deadball-glass2.md, The look).
 * Slanted panels with chrome rims; names in chunky lettering with an extruded edge, chrome for
 * names and flame for runs; the count as lamps; the pitch speed in big digits; a matchup card
 * with a VS badge on a starburst; the strike zone over the plate with the last pitch marked; a
 * steal's card with the clocks it was run against; splash words; and between innings a
 * high-score table of the league's leaders.
 *
 * Two halves, kept apart so the gate can run one of them:
 *
 *   layoutHud(state, w, h, o)  pure: what goes where on a w×h screen in CSS pixels, as a list
 *                              of marks (panels, words, lamps, chips, the zone, the table)
 *   createHud(canvas, o)       paints the marks on a canvas at the device's pixel ratio, loads
 *                              the faces and runs the punch-ins
 *
 * It's sized against the TV's sub-screen (about 400×300) with minimums, not scaled down from a
 * full-screen design: a unit `u` is a pixel there and grows more slowly than the screen past it.
 * With the tube glass on, everything moves inside a title-safe area a tenth smaller; the zone
 * follows the picture instead, through the tube's bulge.
 *
 * It names no league, club or network. Words, colours and the network's bug come from a theme;
 * HUD_THEME is the neutral default and the game's own rides in with the view.
 */

// ── the theme ─────────────────────────────────────────────────────────────────
// `bug` is the network's mark in the corner ('' for none); `words` the splash words by kind of
// play or card; `races` the leaders table's headings; `tonight` the word before a game's clubs;
// `colourOf(team, side)` a club's two colours, top and bottom, for its chips, or null for the
// default. `gold` dresses everything for a final.
export const HUD_THEME = Object.freeze({
  bug: '',
  title: 'HIGH SCORES',
  league: 'LEAGUE LEADERS',
  tonight: 'TONIGHT',
  gold: false,
  words: Object.freeze({
    homerun: 'HOME RUN!', grandslam: 'GRAND SLAM!', walkoff: 'WALK-OFF!', doubleplay: 'DOUBLE PLAY!',
    tripleplay: 'TRIPLE PLAY!', extras: 'EXTRA INNINGS', gamewin: 'FINAL', champion: 'CHAMPIONS!', matchup: 'PLAY BALL!',
    steal: 'STOLEN BASE', caughtstealing: 'CAUGHT STEALING', doublesteal: 'DOUBLE STEAL',
  }),
  races: Object.freeze({ hr: 'HOME RUNS', avg: 'BATTING AVERAGE', sb: 'STOLEN BASES', k: 'STRIKEOUTS' }),
  colourOf: null,
});

// A club's two colours until the clubs bring their own: one of twelve strong pairs, picked by
// the name so a club keeps its colour all season.
const CLUB_PAIRS = [
  ['#36c4c4', '#145f63'], ['#e0702e', '#7c2f10'], ['#9aa0a8', '#3d4148'], ['#3a6fc4', '#162c5a'],
  ['#ff4fd8', '#6a1260'], ['#c9a23a', '#5c4410'], ['#f2f0e8', '#8d8a80'], ['#6fbf4a', '#24501a'],
  ['#d23a3a', '#5e1010'], ['#8a5ad6', '#36195e'], ['#ffd23a', '#7a5a08'], ['#2fb07c', '#0e4a32'],
];
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export const clubColour = (team) => CLUB_PAIRS[hashStr('club:' + team) % CLUB_PAIRS.length];

// ── the faces ─────────────────────────────────────────────────────────────────
// The client's own display faces (client/shared/fonts), each with fallbacks that keep the shape.
export const HUD_FACES = Object.freeze({
  big: (px) => `${px}px Bungee, "Arial Black", Impact, sans-serif`,
  inline: (px) => `${px}px "Bungee Inline", Bungee, "Arial Black", Impact, sans-serif`,
  tall: (px) => `800 ${px}px "Big Shoulders Display", "Arial Narrow", "Liberation Sans Narrow", Impact, sans-serif`,
  label: (px) => `${px}px Audiowide, Bahnschrift, "Segoe UI", sans-serif`,
});
// About how wide a face sets a capital, as a share of its size: for the gate, which has no
// fonts to measure. The painter measures the real thing.
export const FACE_ADVANCE = Object.freeze({ big: 0.8, inline: 0.8, tall: 0.47, label: 0.74 });
const FACE_FILES = [['Bungee', 'bungee.woff2'], ['Bungee Inline', 'bungee-inline.woff2'],
  ['Big Shoulders Display', 'big-shoulders-display.woff2', { weight: '800' }], ['Audiowide', 'audiowide.woff2']];
let facesP = null;
export function loadHudFaces(doc) {
  if (facesP) return facesP;
  if (!doc?.fonts || typeof FontFace === 'undefined') return (facesP = Promise.resolve(false));
  // allSettled: one face failing must not keep the rest off the page
  facesP = Promise.allSettled(FACE_FILES.map(([fam, file, desc]) =>
    new FontFace(fam, `url(${new URL('../../../../shared/fonts/' + file, import.meta.url)})`, desc).load().then((f) => { doc.fonts.add(f); })))
    .then(() => true);
  return facesP;
}

// ── numbers the way a scoreboard writes them ──────────────────────────────────
// An average with no leading zero; an ERA to two places, or dashes before he's got anyone out.
export const fmtAvg = (h, ab) => (!ab ? '.000' : h >= ab ? '1.000' : (h / ab).toFixed(3).replace(/^0/, ''));
export const fmtEra = (er, outs) => (!outs ? '-.--' : ((er * 27) / outs).toFixed(2));
// The batter's line and the pitcher's, from a payload's `bl` [AB, H, HR, RBI, SB] and `pl`
// [W, L, outs, ER, K] (plugins/broadcast/sports/baseball-gameday.js).
export const batLine = (bl) => `${fmtAvg(bl[1], bl[0])}   ${bl[2]} HR   ${bl[3]} RBI`;
export const armLine = (pl) => `${pl[0]}–${pl[1]}   ${fmtEra(pl[3], pl[2])} ERA   ${pl[4]} K`;

// A pitch's name the way a broadcast prints it: FOUR-SEAM FASTBALL is 4-SEAM FASTBALL.
export const pitchName = (type) => String(type || '').toUpperCase().replace(/\bFOUR-SEAM\b/, '4-SEAM').replace(/\bTWO-SEAM\b/, '2-SEAM');

// ── the strike zone ───────────────────────────────────────────────────────────
// The zone over the plate in the park's frame (feet; +x toward third, so the catcher's left),
// and where a pitch crossed it from the payload's plot position: x and y run 0 to 1 over a
// square whose middle half across and middle 56% down is the zone, the 2-D view's plot.
export const ZONE = Object.freeze({ half: 0.708, low: 1.62, high: 3.45, z: 0.7 });
export function pitchPoint(p, bats) {
  const at = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.min(1, Number(v))) : 0.5);
  let x = at(p?.x);
  const y = at(p?.y);
  // a pitch that hits him is on his side of the plate: a right-handed batter stands at +x
  if (p?.result === 'hbp' && (bats === 'R' || bats === 'L')) x = bats === 'R' ? Math.min(x, 1 - x) : Math.max(x, 1 - x);
  const wx = (0.5 - x) * (ZONE.half * 2 / 0.5);
  const wy = ZONE.high - (y - 0.22) * ((ZONE.high - ZONE.low) / 0.56);
  return [wx, wy, ZONE.z];
}
// The tube glass bulges the picture (gl/broadcast.js samples it at 0.5 + d(1 + |d|²·0.05)), so a
// point of the picture shows on the screen a little nearer the middle. This finds where.
export function throughTube(pt, w, h) {
  const sx = pt.x / w - 0.5, sy = pt.y / h - 0.5;
  let dx = sx, dy = sy;
  for (let i = 0; i < 6; i++) { const k = 1 + (dx * dx + dy * dy) * 0.05; dx = sx / k; dy = sy / k; }
  return { x: (0.5 + dx) * w, y: (0.5 + dy) * h };
}

// ── the layout ────────────────────────────────────────────────────────────────
// The smallest a word is set, in CSS pixels: the tablet's TV is about 330×160.
export const TEXT_FLOOR = 6;
// The state (gameday-grandstand.js builds it from the payloads):
//
//   score    { away, home, aScore, hScore, half, inning, bases: [1st, 2nd, 3rd], awayTeam, homeTeam }
//   count    { balls, strikes, outs }
//   pitch    the last pitch thrown, as the payload has it: { velo, type, x, y, result }
//   zone     true to draw the zone over the plate (the batting view); needs o.project
//   bats     the batter's side, 'L' or 'R', for a pitch that hits him
//   matchup  { batter, pitcher, bNum, pNum, bl, pl, bats, throws, batTeam, pitchTeam }
//   steal    { kind, runner, num, sb, plate, pop, base, team }
//   splash   { kind, word, sub }
//   leaders  { race: 'hr' | 'avg' | 'sb' | 'k', rows, season, foot (the line across the foot) }
//   gold     true in a final
//
// `o`: { theme, safe (the tube glass is on), project(p) -> { x, y } | null (the picture's
// camera, on this w×h) }. Returns { u, safe: [x0, y0, x1, y1], marks }, each mark a plain object
// with `t` its kind and `g` the group it punches in with.
export function layoutHud(state, w, h, o = {}) {
  const S = state || {}, T = { ...HUD_THEME, ...(o.theme || {}) };
  const words = { ...HUD_THEME.words, ...(o.theme?.words || {}) }, races = { ...HUD_THEME.races, ...(o.theme?.races || {}) };
  const colourOf = (team, side) => (T.colourOf?.(team, side)) || clubColour(team);
  const u = Math.pow(Math.max(0.75, Math.min(w / 400, h / 300)), 0.8);
  const m = o.safe ? 0.05 : 0;
  const X0 = w * m + 6 * u, Y0 = h * m + 6 * u, X1 = w * (1 - m) - 6 * u, Y1 = h * (1 - m) - 6 * u;
  const gold = !!(S.gold || T.gold);
  const marks = [];
  const add = (mk) => { marks.push(mk); return mk; };
  // no word is set below the floor, however small the screen; a long one is fitted down to its
  // `min` and past that cut short
  const text = (s, x, y, size, face, fill, extra = {}) => {
    const sz = Math.max(TEXT_FLOOR, size);
    return add({ t: 'text', s: String(s), x, y, face, fill, align: 'left', ...extra, size: sz, min: Math.max(TEXT_FLOOR, Math.min(sz, extra.min ?? sz * 0.75)) });
  };
  const panel = (x, y, pw, ph, skew, g) => add({ t: 'panel', x, y, w: pw, h: ph, skew, gold, g });
  const chrome = gold ? 'gold' : 'chrome';

  // the network's bug, top right, over everything but the splash
  let bugH = 0;
  if (T.bug) {
    const bw = 10 * u + String(T.bug).length * 6.2 * u;
    add({ t: 'box', x: X1 - bw, y: Y0, w: bw, h: 12 * u, g: 'bug' });
    text(T.bug, X1 - bw / 2, Y0 + 9 * u, 8 * u, 'label', 'white', { align: 'center', maxW: bw - 6 * u, skew: 0, extrude: 0, stroke: 0, g: 'bug' });
    bugH = 16 * u;
  }

  // between innings the leaders' table is the whole screen, and a splash goes over it
  if (S.leaders && Array.isArray(S.leaders.rows)) {
    leadersTable(S.leaders);
    splash();
    return { u, safe: [X0, Y0, X1, Y1], marks };
  }

  // the score, top left
  if (S.score) {
    const sc = S.score, x = X0, y = Y0, pw = 134 * u, ph = 42 * u;
    panel(x, y, pw, ph, 10 * u, 'score');
    [[sc.away, sc.aScore, sc.awayTeam, 'away'], [sc.home, sc.hScore, sc.homeTeam, 'home']].forEach(([ab, runs, team, side], i) => {
      const cy = y + (i ? 30 : 13) * u;
      add({ t: 'chip', x: x + 11 * u, y: cy - 6 * u, w: 4 * u, h: 12 * u, colour: colourOf(team || ab, side), g: 'score' });
      text(String(ab || '').toUpperCase(), x + 19 * u, cy + 5.5 * u, 13 * u, 'big', chrome, { maxW: 39 * u, min: 10 * u, g: 'score' });
      text(runs | 0, x + 70 * u, cy + 6 * u, 15 * u, 'big', 'flame', { align: 'center', g: 'score' });
    });
    text(sc.half === 'bottom' ? 'BOT' : 'TOP', x + 92 * u, y + 15 * u, 7 * u, 'label', chrome, { align: 'center', skew: 0.1, extrude: 0, g: 'score' });
    text(sc.inning | 0, x + 92 * u, y + 34 * u, 14 * u, 'big', chrome, { align: 'center', g: 'score' });
    const bx = x + 114 * u, by = y + 21 * u, d = 7.5 * u, b = sc.bases || [];
    add({ t: 'bag', x: bx, y: by - d, r: 3.6 * u, on: !!b[1], g: 'score' });
    add({ t: 'bag', x: bx - d, y: by, r: 3.6 * u, on: !!b[2], g: 'score' });
    add({ t: 'bag', x: bx + d, y: by, r: 3.6 * u, on: !!b[0], g: 'score' });
  }

  // the count as lamps: three green for balls, two amber for strikes, two red for outs
  if (S.count) {
    const c = S.count, x = X0, y = Y0 + 46 * u;
    panel(x, y, 108 * u, 18 * u, 7 * u, 'count');
    const cy = y + 9 * u;
    [['B', 11, 20, 3, c.balls, '#3cf07a'], ['S', 50, 59, 2, c.strikes, '#ffc21a'], ['O', 80, 89, 2, c.outs, '#ff3a2a']].forEach(([l, lx, bx, n, on, col]) => {
      text(l, x + lx * u, cy + 3.5 * u, 10 * u, 'tall', 'white', { align: 'center', skew: 0, extrude: 0, g: 'count' });
      for (let i = 0; i < n; i++) add({ t: 'bulb', x: x + (bx + i * 8.5) * u, y: cy, r: 3.1 * u, on: i < (on | 0), colour: col, g: 'count' });
    });
  }

  // the pitch speed on the right, below where the batting view has the park's scoreboard
  if (S.pitch && Number(S.pitch.velo) > 0) {
    const pw = 82 * u, ph = 40 * u, x = X1 - pw, y = Y0 + Math.max(bugH, (Y1 - Y0) * 0.2);
    panel(x, y, pw, ph, 9 * u, 'speed');
    text(S.pitch.velo | 0, x + 12 * u, y + 26 * u, 21 * u, 'big', gold ? 'gold' : 'flame', { maxW: 40 * u, g: 'speed' });
    text('MPH', x + 54 * u, y + 15 * u, 7.5 * u, 'label', gold ? '#ffd75c' : '#ffe04a', { skew: 0.1, extrude: 0, g: 'speed' });
    if (S.pitch.type) text(pitchName(S.pitch.type), x + 10 * u, y + 36 * u, 8.5 * u, 'tall', '#dfe6f4', { maxW: pw - 20 * u, min: 6.5 * u, skew: 0.1, extrude: 0, g: 'speed' });
  }

  // the zone over the plate, and where the last pitch crossed it
  if (S.zone && typeof o.project === 'function') {
    const at = (p) => { const q = o.project(p); return q && o.safe ? throughTube(q, w, h) : q; };
    const Z = [[-ZONE.half, ZONE.low], [ZONE.half, ZONE.low], [ZONE.half, ZONE.high], [-ZONE.half, ZONE.high]].map(([x, y]) => at([x, y, ZONE.z]));
    if (Z.every(Boolean)) {
      add({ t: 'zone', pts: Z.map((q) => [q.x, q.y]), g: 'zone' });
      if (S.pitch && S.pitch.x != null) {
        const q = at(pitchPoint(S.pitch, S.bats));
        const zw = Math.hypot(Z[1].x - Z[0].x, Z[1].y - Z[0].y);
        if (q) add({ t: 'mark', x: q.x, y: q.y, r: Math.max(2.4 * u, zw * 0.19), g: 'zone' });
      }
    }
  }

  // the steal's card, and the clocks it was run against
  if (S.steal) {
    const st = S.steal, ph = 40 * u, y = Y1 - ph;
    const pw = Math.min(200 * u, (X1 - X0) * 0.6), x = X0;
    panel(x, y, pw, ph, 10 * u, 'steal');
    const caught = st.kind === 'caughtstealing';
    text(words[st.kind] || words.steal, x + 14 * u, y + 20 * u, 15 * u, 'big', caught ? chrome : 'flame',
      { maxW: pw - 26 * u, min: 10 * u, ...(caught ? {} : { deep: '#5a0a0a', edge: '#1a0303' }), g: 'steal' });
    add({ t: 'chip', x: x + 12 * u, y: y + 25 * u, w: 18 * u, h: 11 * u, colour: colourOf(st.team, 'bat'), g: 'steal' });
    if (st.num != null) text(st.num, x + 21 * u, y + 34 * u, 8 * u, 'big', chrome, { align: 'center', extrude: 0, g: 'steal' });
    const name = String(st.runner || '').toUpperCase();
    text(st.sb && !caught ? `${name}  ·  SB ${st.sb}` : name, x + 36 * u, y + 34 * u, 9.5 * u, 'tall', '#fff3bc', { maxW: pw - 48 * u, min: 7 * u, skew: 0.1, extrude: 0, g: 'steal' });
    if (st.plate || st.pop) {
      const cw = 132 * u, cx = X1 - cw;
      panel(cx, y, cw, ph, 10 * u, 'steal');
      const BAG = { 2: '2ND', 3: '3RD', 4: 'HOME' };
      const rows = [st.plate && ['PITCHER TO PLATE', st.plate], st.pop && [`CATCHER, POP TO ${BAG[st.base] || '2ND'}`, st.pop]].filter(Boolean);
      rows.forEach(([l, v], i) => {
        const ry = y + (rows.length === 1 ? 24 : 16 + i * 16) * u;
        text(l, cx + 14 * u, ry, 7.5 * u, 'tall', '#9fb3d6', { maxW: 78 * u, min: 6 * u, skew: 0.1, extrude: 0, g: 'steal' });
        text(Number(v).toFixed(2), cx + cw - 12 * u, ry + 1.5 * u, 12 * u, 'big', chrome, { align: 'right', g: 'steal' });
      });
    }
  }

  // the matchup across the foot, for the start of each plate appearance
  if (S.matchup && !S.steal) {
    const mu = S.matchup, ph = 30 * u, y = Y1 - ph - 3 * u, half = (X1 - X0) / 2, gap = 21 * u, pw = half - gap;
    const card = (x, right, num, name, line, team, side) => {
      panel(x, y, pw, ph, 9 * u, 'matchup');
      const chipX = right ? x + pw - 32 * u : x + 8 * u;
      add({ t: 'chip', x: chipX, y: y + 5 * u, w: 22 * u, h: 20 * u, colour: colourOf(team, side), g: 'matchup' });
      if (num != null) text(num, chipX + 11 * u + (right ? 0 : 1 * u), y + 20 * u, 12 * u, 'big', chrome, { align: 'center', extrude: 1 * u, g: 'matchup' });
      const tx = right ? x + 14 * u : x + 36 * u;
      text(String(name || '').toUpperCase(), tx, y + 15 * u, 13 * u, 'tall', chrome, { maxW: pw - 50 * u, min: 9 * u, skew: 0.14, extrude: 1 * u, g: 'matchup' });
      if (line) text(line, tx + 1 * u, y + 25.5 * u, 8.5 * u, 'tall', gold ? '#ffd75c' : '#ffe04a', { maxW: pw - 50 * u, min: 7 * u, skew: 0.1, extrude: 0, g: 'matchup' });
    };
    card(X0, false, mu.bNum, mu.batter, Array.isArray(mu.bl) ? batLine(mu.bl) : mu.bats ? `BATS ${mu.bats === 'S' ? 'BOTH' : mu.bats}` : '', mu.batTeam, 'bat');
    card(X0 + half + gap, true, mu.pNum, mu.pitcher, Array.isArray(mu.pl) ? armLine(mu.pl) : mu.throws ? `THROWS ${mu.throws}` : '', mu.pitchTeam, 'field');
    const cx = X0 + half, cy = y + 15 * u;
    add({ t: 'burst', x: cx, y: cy, r: 18 * u, n: 16, g: 'matchup' });
    add({ t: 'disc', x: cx, y: cy, r: 13 * u, fill: '#c81d1d', edge: '#fff3c0', width: 2 * u, g: 'matchup' });
    text('VS', cx + 1 * u, cy + 4.5 * u, 11 * u, 'big', chrome, { align: 'center', extrude: 1 * u, g: 'matchup' });
  }

  splash();
  return { u, safe: [X0, Y0, X1, Y1], marks };

  // the splash: a sunburst, then the words
  function splash() {
    if (!S.splash || !(S.splash.word || words[S.splash.kind])) return;
    const sp = S.splash, cx = (X0 + X1) / 2, cy = Y0 + (Y1 - Y0) * 0.46;
    add({ t: 'rays', x: cx, y: cy, r: Math.min(150 * u, (X1 - X0) * 0.48), n: 24, g: 'splash' });
    text(words[sp.kind] || sp.word, cx, cy + 12 * u, 34 * u, 'big', gold ? 'gold' : 'flame',
      { align: 'center', maxW: (X1 - X0) * 0.94, min: 18 * u, extrude: 3 * u, deep: gold ? '#3a2204' : '#5a0a0a', edge: gold ? '#140a01' : '#1a0303', g: 'splash' });
    if (sp.sub) {
      const pw = Math.min(230 * u, (X1 - X0) * 0.72), ph = 22 * u, x = cx - pw / 2, y = cy + 24 * u;
      panel(x, y, pw, ph, 8 * u, 'splash');
      text(String(sp.sub).toUpperCase(), cx, y + 15.5 * u, 11 * u, 'tall', chrome, { align: 'center', maxW: pw - 26 * u, min: 8 * u, skew: 0.12, extrude: 1 * u, g: 'splash' });
    }
  }

  // The leaders as a high-score table: rank, man, club with its colour, the numbers with the
  // race's own column lit and the leader's row in gold, and tonight's game across the foot.
  function leadersTable(L) {
    const race = races[L.race] ? L.race : 'hr', rows = L.rows.slice(0, 5);
    add({ t: 'veil', alpha: 0.62, g: 'table' });
    const cx = (X0 + X1) / 2;
    text(T.title, cx, Y0 + bugH * 0.4 + 26 * u, 25 * u, 'big', 'flame', { align: 'center', maxW: (X1 - X0) * 0.8, min: 16 * u, extrude: 2 * u, deep: '#5a0a0a', edge: '#1a0303', g: 'table' });
    const sub = [T.league, races[race], L.season ? `SEASON ${L.season}` : ''].filter(Boolean).join('  ·  ');
    text(sub, cx, Y0 + bugH * 0.4 + 40 * u, 8.5 * u, 'label', '#9fe6ff', { align: 'center', maxW: (X1 - X0) * 0.96, min: 6.5 * u, skew: 0, extrude: 0, stroke: 0, g: 'table' });
    // The rows take what height there is, down to a floor; the foot goes first on a short screen.
    const x = X0 + 2 * u, pw = X1 - X0 - 4 * u, y = Y0 + bugH * 0.4 + 48 * u, n = Math.max(1, rows.length);
    const room = Y1 - y - 32 * u, withFoot = !!L.foot && room - 24 * u >= n * 15 * u;
    const RH = Math.min(21 * u, Math.max(12 * u, (room - (withFoot ? 24 * u : 0)) / n)), rs = RH / (21 * u);
    const ph = 26 * u + n * RH + 6 * u;
    panel(x, y, pw, ph, 14 * u, 'table');
    const pit = race === 'k';
    // the columns as shares of the panel, so a wider screen spreads them
    const C = pit
      ? { rk: 0.065, pl: 0.115, chip: 0.43, club: 0.455, a: [0.72, 'W-L', 'wl'], b: [0.82, 'ERA', 'era'], c: [0.92, 'K', 'k'] }
      : { rk: 0.065, pl: 0.115, chip: 0.38, club: 0.405, a: [0.66, 'HR', 'hr'], b: [0.74, 'RBI', 'rbi'], c: [0.83, 'AVG', 'avg'], d: [0.92, 'SB', 'sb'] };
    const cols = [C.a, C.b, C.c, C.d].filter(Boolean);
    const lit = pit ? 'k' : race;
    const hy = y + 15 * u;
    const head = (s, fx, on, align = 'center') => text(s, x + fx * pw, hy, (on ? 9.5 : 8.5) * u, 'tall', on ? '#ffe04a' : '#9fb3d6', { align, skew: 0, extrude: 0, stroke: 0, g: 'table' });
    head('RK', C.rk, false); head(pit ? 'PITCHER' : 'PLAYER', C.pl, false, 'left'); head('CLUB', C.club, false, 'left');
    for (const [fx, label, key] of cols) head(key === lit ? `${label} ▼` : label, fx, key === lit);
    add({ t: 'rule', x1: x + 0.04 * pw, x2: x + 0.94 * pw, y: hy + 5 * u, colour: 'rgba(255,255,255,0.35)', width: Math.max(1, 1 * u), g: 'table' });
    if (!rows.length) text('NO GAMES PLAYED YET', cx, y + 26 * u + RH * 0.6, 11 * u, 'tall', '#dfe6f4', { align: 'center', skew: 0, extrude: 0, g: 'table' });
    rows.forEach((r, i) => {
      const ry = y + 26 * u + i * RH, mid = ry + RH / 2, top = i === 0;
      add({ t: 'band', x: x + 0.03 * pw, y: ry + 1.5 * u, w: 0.93 * pw, h: RH - 3 * u, fill: top ? 'rgba(255,200,60,0.16)' : i % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.12)', g: 'table' });
      const k = Math.max(0.75, rs);   // a squeezed row sets its words a little smaller, never below legible
      text(i + 1, x + C.rk * pw, mid + 5 * u * k, 13 * u * k, 'big', top ? 'gold' : 'chrome', { align: 'center', extrude: 1 * u, g: 'table' });
      text(String(r.name || '').toUpperCase(), x + C.pl * pw, mid + 5 * u * k, 14 * u * k, 'tall', top ? 'gold' : 'chrome', { maxW: (C.chip - C.pl - 0.015) * pw, min: 9 * u, skew: 0.12, extrude: 1 * u, g: 'table' });
      add({ t: 'chip', x: x + C.chip * pw - 2 * u, y: mid - 6 * u * k, w: 5 * u, h: 12 * u * k, colour: colourOf(r.team, 'club'), g: 'table' });
      text(String(r.team || '').toUpperCase(), x + C.club * pw, mid + 3.5 * u * k, 9 * u * Math.max(0.85, k), 'tall', '#dfe6f4', { maxW: (cols[0][0] - C.club - 0.04) * pw, min: 6.5 * u, skew: 0, extrude: 0, g: 'table' });
      for (const [fx, , key] of cols) {
        const v = key === 'avg' ? fmtAvg(Math.round((r.avg || 0) * 1000), 1000) : key === 'era' ? (Number(r.era) || 0).toFixed(2) : key === 'wl' ? `${r.w | 0}-${r.l | 0}` : String(r[key] | 0);
        if (key === lit) text(v, x + fx * pw, mid + 5.5 * u * k, 14 * u * k, 'big', 'flame', { align: 'center', extrude: 1 * u, g: 'table' });
        else text(v, x + fx * pw, mid + 4 * u * k, 11 * u * k, 'tall', 'white', { align: 'center', skew: 0, extrude: 0, g: 'table' });
      }
    });
    if (withFoot) {
      const fh = 20 * u, fy = Y1 - fh, fw = Math.min(pw * 0.92, 340 * u);
      panel(cx - fw / 2, fy, fw, fh, 10 * u, 'table');
      text(String(L.foot).toUpperCase(), cx, fy + 13.5 * u, 9.5 * u, 'tall', '#fff3bc', { align: 'center', maxW: fw - 24 * u, min: 7 * u, skew: 0, extrude: 0, g: 'table' });
    }
  }
}

// ── the painter ───────────────────────────────────────────────────────────────
const CHROME = [[0, '#ffffff'], [0.34, '#dfe6f4'], [0.5, '#8391b0'], [0.54, '#2a3453'], [0.78, '#a8b8dc'], [1, '#f2f6ff']];
const GOLDF = [[0, '#fff8d6'], [0.36, '#ffd75c'], [0.5, '#b07c18'], [0.55, '#7a4e0c'], [0.78, '#ffcf55'], [1, '#fff3bc']];
const FLAME = [[0, '#fffbe0'], [0.3, '#ffe04a'], [0.62, '#ff8c1a'], [1, '#d81e1e']];
const FILLS = { chrome: CHROME, gold: GOLDF, flame: FLAME };
// How each group comes in: the cards slide up, the splash punches in, the table fades up.
const IN_MS = { matchup: 260, steal: 260, splash: 240, table: 300 };
const TAU = Math.PI * 2;

// Paints a layout's marks with a 2-D context already scaled to CSS pixels. `t(group)` is how
// far in each group is, 0 to 1 (1 when nothing animates).
export function paintMarks(g, L, t = () => 1) {
  const grad = (y0, y1, stops) => { const gr = g.createLinearGradient(0, y0, 0, y1); for (const [o, c] of stops) gr.addColorStop(o, c); return gr; };
  const u = L.u;
  let cur = null;
  for (const m of L.marks) {
    if (m.g !== cur) {
      if (cur !== null) g.restore();
      g.save();
      cur = m.g;
      const k = t(m.g);
      if (k < 1) {
        const e = 1 - Math.pow(1 - k, 3);
        if (m.g === 'matchup' || m.g === 'steal') { g.translate(0, (1 - e) * 46 * u); g.globalAlpha = Math.min(1, k * 2); }
        else if (m.g === 'splash') {
          const cx = (L.safe[0] + L.safe[2]) / 2, cy = L.safe[1] + (L.safe[3] - L.safe[1]) * 0.46, s = 1 + (1 - e) * 1.2;
          g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy); g.globalAlpha = Math.min(1, k * 1.6);
        } else g.globalAlpha = e;
      }
    }
    paintMark(g, m, grad, u);
  }
  if (cur !== null) g.restore();
}

function paintMark(g, m, grad, u) {
  switch (m.t) {
    case 'panel': {
      const { x, y, w, h, skew: sk } = m;
      const path = (dx, dy) => { g.beginPath(); g.moveTo(x + sk + dx, y + dy); g.lineTo(x + w + dx, y + dy); g.lineTo(x + w - sk + dx, y + h + dy); g.lineTo(x + dx, y + h + dy); g.closePath(); };
      path(3 * u, 3 * u); g.fillStyle = 'rgba(0,0,0,0.55)'; g.fill();
      path(0, 0); g.fillStyle = grad(y, y + h, m.gold ? [[0, '#3b2a08'], [0.5, '#1d1304'], [1, '#0d0802']] : [[0, '#21419a'], [0.5, '#0f2160'], [1, '#060d2c']]); g.fill();
      g.save(); path(0, 0); g.clip(); g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x, y, w, h * 0.46); g.restore();
      path(0, 0); g.lineWidth = Math.max(1.2, 1.6 * u); g.strokeStyle = grad(y, y + h, m.gold ? GOLDF : CHROME); g.stroke();
      return;
    }
    case 'text': {
      const size = fitText(g, m);
      if (!size) return;
      g.save(); g.translate(m.x, m.y); g.transform(1, 0, -(m.skew ?? 0.2), 1, 0, 0);
      g.font = HUD_FACES[m.face](size); g.textAlign = m.align; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      const s = m.fitted ?? m.s;
      const ex = m.extrude ?? Math.round(size * 0.07);
      const deep = m.deep || '#0a1233';
      for (let i = Math.round(ex); i > 0; i--) { g.fillStyle = deep; g.strokeStyle = deep; g.lineWidth = size * 0.13; g.strokeText(s, i * 0.6, i); g.fillText(s, i * 0.6, i); }
      const sw = m.stroke ?? size * 0.15;
      if (sw > 0) { g.lineWidth = sw; g.strokeStyle = m.edge || '#050a1e'; g.strokeText(s, 0, 0); }
      g.fillStyle = FILLS[m.fill] ? grad(-size * 0.74, size * 0.02, FILLS[m.fill]) : m.fill === 'white' ? '#ffffff' : m.fill;
      g.fillText(s, 0, 0);
      g.restore();
      return;
    }
    case 'bulb': {
      const { x, y, r, on, colour } = m;
      if (on) { const hl = g.createRadialGradient(x, y, 0, x, y, r * 2.6); hl.addColorStop(0, colour + 'aa'); hl.addColorStop(1, colour + '00'); g.fillStyle = hl; g.beginPath(); g.arc(x, y, r * 2.6, 0, TAU); g.fill(); }
      const b = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      if (on) { b.addColorStop(0, '#ffffff'); b.addColorStop(0.35, colour); b.addColorStop(1, '#1a1a1a'); } else { b.addColorStop(0, '#5a6070'); b.addColorStop(1, '#14161c'); }
      g.fillStyle = b; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.lineWidth = Math.max(0.8, 0.6 * u); g.strokeStyle = '#05070f'; g.stroke();
      return;
    }
    case 'chip': {
      g.save(); g.transform(1, 0, -0.25, 1, 0, 0);
      g.fillStyle = grad(m.y, m.y + m.h, [[0, m.colour[0]], [1, m.colour[1]]]); g.fillRect(m.x + m.y * 0.25, m.y, m.w, m.h);
      g.restore();
      return;
    }
    case 'bag': {
      g.save(); g.translate(m.x, m.y); g.rotate(Math.PI / 4);
      g.fillStyle = m.on ? '#ffe04a' : 'rgba(255,255,255,0.10)';
      if (m.on) { g.shadowColor = '#ffcc33'; g.shadowBlur = 5 * u; }
      g.fillRect(-m.r, -m.r, m.r * 2, m.r * 2); g.shadowBlur = 0;
      g.lineWidth = Math.max(1, 0.9 * u); g.strokeStyle = '#fff2b0'; g.strokeRect(-m.r, -m.r, m.r * 2, m.r * 2);
      g.restore();
      return;
    }
    case 'zone': {
      const P = m.pts;
      g.save(); g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
      g.fillStyle = 'rgba(80,170,255,0.18)'; g.fill();
      g.lineWidth = Math.max(1.2, 1.4 * u); g.strokeStyle = 'rgba(210,240,255,0.95)'; g.shadowColor = '#5ab4ff'; g.shadowBlur = 6 * u; g.stroke(); g.shadowBlur = 0;
      g.lineWidth = Math.max(0.6, 0.5 * u); g.strokeStyle = 'rgba(190,230,255,0.45)';
      const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      for (const f of [1 / 3, 2 / 3]) {
        let a = lerp(P[0], P[1], f), b = lerp(P[3], P[2], f); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        a = lerp(P[0], P[3], f); b = lerp(P[1], P[2], f); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      g.restore();
      return;
    }
    case 'mark': {
      const { x, y, r } = m;
      const hl = g.createRadialGradient(x, y, 0, x, y, r * 2.3); hl.addColorStop(0, 'rgba(255,240,180,0.95)'); hl.addColorStop(0.35, 'rgba(255,190,60,0.6)'); hl.addColorStop(1, 'rgba(255,120,20,0)');
      g.fillStyle = hl; g.beginPath(); g.arc(x, y, r * 2.3, 0, TAU); g.fill();
      g.lineWidth = Math.max(1, 0.9 * u); g.strokeStyle = '#fff6d0'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      return;
    }
    case 'burst': {
      g.save(); g.translate(m.x, m.y);
      for (let i = 0; i < m.n; i++) { g.rotate(TAU / m.n); g.fillStyle = i % 2 ? '#ff8c1a' : '#ffd23a'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-m.r * 0.16, -m.r); g.lineTo(m.r * 0.16, -m.r); g.closePath(); g.fill(); }
      g.restore();
      return;
    }
    case 'disc': {
      g.fillStyle = m.fill; g.beginPath(); g.arc(m.x, m.y, m.r, 0, TAU); g.fill(); g.lineWidth = m.width; g.strokeStyle = m.edge; g.stroke();
      return;
    }
    case 'rays': {
      g.save(); g.translate(m.x, m.y);
      const sb = g.createRadialGradient(0, 0, m.r * 0.08, 0, 0, m.r); sb.addColorStop(0, 'rgba(255,226,110,0.42)'); sb.addColorStop(1, 'rgba(255,140,30,0)');
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < m.n; i++) { g.rotate(TAU / m.n); g.fillStyle = sb; g.beginPath(); g.moveTo(0, 0); g.lineTo(-m.r * 0.075, -m.r); g.lineTo(m.r * 0.075, -m.r); g.closePath(); g.fill(); }
      g.restore();
      return;
    }
    case 'veil': {
      g.fillStyle = `rgba(2,4,14,${m.alpha})`; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
      return;
    }
    case 'band': {
      g.fillStyle = m.fill; g.fillRect(m.x, m.y, m.w, m.h);
      return;
    }
    case 'rule': {
      g.fillStyle = m.colour; g.fillRect(m.x1, m.y, m.x2 - m.x1, m.width);
      return;
    }
    case 'box': {
      g.globalAlpha *= 0.85; g.lineWidth = Math.max(1, 1 * u); g.strokeStyle = '#ffffff'; g.strokeRect(m.x, m.y, m.w, m.h);
      g.globalAlpha /= 0.85;
      return;
    }
    default:
  }
}

// A word too wide for its room is set smaller, down to its minimum, then cut short.
function fitText(g, m) {
  if (!m.s) return 0;
  let size = m.size;
  m.fitted = null;
  if (!m.maxW) return size;
  g.font = HUD_FACES[m.face](size);
  const wide = (s) => g.measureText(s).width + Math.abs(m.skew ?? 0.2) * size * 0.7;
  let w = wide(m.s);
  if (w <= m.maxW) return size;
  const min = Math.min(size, m.min ?? size * 0.75);
  size = Math.max(min, size * m.maxW / w);
  g.font = HUD_FACES[m.face](size);
  w = wide(m.s);
  if (w <= m.maxW) return size;
  let s = m.s;
  while (s.length > 1 && wide(s + '…') > m.maxW) s = s.slice(0, -1);
  m.fitted = s.trimEnd() + '…';
  return size;
}

// The canvas over the picture. `o`: { theme, project(p, w, h) for the zone, safe() true while the
// tube glass is on, motion() false when the viewer has asked for less of it, dpr cap }.
// set(state) lays out and paints; a group that wasn't up before comes in with its punch-in.
export function createHud(canvas, o = {}) {
  const g = canvas.getContext('2d');
  const doc = canvas.ownerDocument, win = doc?.defaultView;
  let state = null, layout = { u: 1, safe: [0, 0, 0, 0], marks: [] }, raf = 0, disposed = false;
  const since = new Map();   // group -> when it came in
  const now = () => (win?.performance || globalThis.performance || Date).now();
  loadHudFaces(doc).then(() => { if (!disposed) paint(); });

  function size() {
    const box = canvas.parentElement;
    const w = Math.max(1, box?.clientWidth || canvas.clientWidth || 400), h = Math.max(1, box?.clientHeight || canvas.clientHeight || 300);
    const k = Math.min(win?.devicePixelRatio || 1, o.dpr || 2);
    const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    return { w, h, k };
  }
  function paint() {
    if (disposed) return;
    raf = 0;
    const { w, h, k } = size();
    const safe = !!o.safe?.();
    layout = layoutHud(state, w, h, { theme: o.theme, safe, project: o.project ? (p) => o.project(p, w, h) : null });
    const groups = new Set(layout.marks.map((m) => m.g));
    for (const gr of [...since.keys()]) if (!groups.has(gr)) since.delete(gr);
    const moving = o.motion ? o.motion() : true;
    const t0 = now();
    for (const gr of groups) if (!since.has(gr)) since.set(gr, IN_MS[gr] && moving ? t0 : -Infinity);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    let busy = false;
    paintMarks(g, layout, (gr) => {
      const ms = IN_MS[gr];
      if (!ms) return 1;
      const f = (t0 - since.get(gr)) / ms;
      if (f < 1) busy = true;
      return Math.max(0, Math.min(1, f));
    });
    // behind the tube glass the graphics take its scanlines too, on their own pixels only
    if (safe) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(0,0,0,0.2)';
      const step = Math.max(2, Math.round(k * 1.5));
      for (let y = 0; y < canvas.height; y += step) g.fillRect(0, y, canvas.width, 1);
      g.globalCompositeOperation = 'source-over';
    }
    if (busy && win) raf = win.requestAnimationFrame(paint);
  }
  return {
    set(next) { state = next; if (!raf) paint(); },
    paint() { if (!raf) paint(); },
    dispose() { disposed = true; if (raf && win) win.cancelAnimationFrame(raf); raf = 0; },
    get layout() { return layout; },
    get state() { return state; },
  };
}
