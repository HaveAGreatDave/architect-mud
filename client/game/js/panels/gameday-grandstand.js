// Gameday · Grandstand: Deadball's park in 3-D (GLASS 2), behind a flag while it's built.
//
// The same five methods as gameday.js and gameday-rink.js ({ apply, clear, setCaption,
// showIdle, showCard }), so tv.js mounts it for baseball and changes nothing else.
//
// ⚠ WITH THE FLAG OFF IT IS THE 2-D GAMEDAY. `createGrandstandView` hands back
// `createGamedayView(host)` and nothing in this file runs. The flag is the localStorage key
// `deadball.grandstand` set to '1' (docs/systems-broadcast.md says how to turn it on).
//
// With it on, the park draws through gl/ballpark.js, and the 2-D view takes over whenever the
// 3-D one can't: no WebGL2, no float target, a shader that won't build, or a lost context. The
// last payload and the booth's line go with it.
//
// What's built (Phases 1a to 1d of docs/proposals/deadball-glass2.md): the park from the venue's
// defaults through the batting view, lit by its towers, the scoreboard lit with the game, the
// players posed where each payload has them, and the arcade graphics over the picture
// (diamond/hud.js): the score and the count as lamps, the pitch speed, the zone with the last
// pitch, a matchup card as each man comes up, a steal's card, splash words for the cards the
// broadcast throws, and between innings the league's leaders as a high-score table. The booth's
// line runs under the picture. The pitch and the ball in play are later phases. Until then the
// count ticks through each at-bat's pitches on the 2-D view's clock (GAMEDAY_CLOCK), so the held
// line lands when the 2-D view would land it and the booth never calls a play the picture hasn't
// reached.
//
// The sim on the server decides everything. Nothing here can change a score.

import { createGamedayView, GAMEDAY_CLOCK, GAMEDAY_CARDS } from './gameday.js';
import { prefersReducedMotion } from '../../../shared/settings.js';

export const GRANDSTAND_FLAG = 'deadball.grandstand';
export function grandstandOn(win) {
  try { return win?.localStorage?.getItem(GRANDSTAND_FLAG) === '1'; } catch { return false; }
}

function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// The ads round the bowl behind the plate.
const ADS = ['KSAB-TV', 'DEADBALL', 'COLDWATER', 'KSAB-TV'];
// The two clubs on tonight wear their kits' colours on the graphics too (gl/ballplayer-mesh.js
// KITS: teal trim at home, rust away). The rest of the league's come off their names until the
// clubs bring their own (Phase 5).
const SIDE_COLOURS = { home: ['#36c4c4', '#145f63'], away: ['#e0702e', '#7c2f10'] };

const { REVEAL_STEP_MS, REVEAL_MAX_MS, OUTCOME_GAP_MS, T_PITCH, T_THROW, T_FLY, T_HOMER } = GAMEDAY_CLOCK;
const GROUND = new Set(['groundout', 'doubleplay', 'tripleplay', 'productout', 'error']);
// How long after the play is decided the 2-D view says it has landed, by what was hit.
function flightOf(kind) {
  if (kind === 'strikeout' || kind === 'walk' || kind === 'hitbypitch') return 200;
  if (kind === 'homerun') return T_HOMER;
  return GROUND.has(kind) ? T_THROW * 2 : T_FLY;
}
// How long each graphic stays up: the matchup as a man comes up, a steal's card once it lands,
// and each of the leaders' races between innings.
const MATCHUP_MS = 4200, STEAL_MS = 4800, TABLE_CYCLE_MS = 8000;
const RACES = ['hr', 'avg', 'sb', 'k'];
const STEALS = new Set(['steal', 'caughtstealing', 'doublesteal']);

export function createGrandstandView(host, opts = {}) {
  const doc = host ? host.ownerDocument : null;
  const win = doc ? doc.defaultView : null;
  if (!opts.force && !grandstandOn(win)) return createGamedayView(host);

  let flat = null;              // the 2-D view, once the 3-D one has given way to it
  let R = null, hud = null, canvas = null, mounted = false, modsP = null, mods = null, ro = null, raf = 0;
  let last = null, caption = '', pendingCaption = null, pendingCard = null, playing = false;
  let timers = [], tableTimer = null, shot = opts.shot || 'high';
  // what the graphics and the board show: the score, the count, the outs and the bags, and the
  // cards that come and go (matchup, steal, splash) and the leaders' table between innings
  const S = {
    away: '', home: '', awayTeam: '', homeTeam: '', aScore: 0, hScore: 0, inning: 0, half: '',
    balls: 0, strikes: 0, outs: 0, bases: [false, false, false], batter: '', pitcher: '', line: null, desc: '',
    pitch: null, bats: '', lastBatter: '', matchup: null, steal: null, splash: null,
    leaders: null, seasonN: null, gold: false, tableRace: null, tableFoot: '',
  };
  const holds = {};

  const later = (ms, fn) => { timers.push(setTimeout(fn, Math.max(0, ms))); };
  const stopTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function loadMods() {
    return (modsP ??= Promise.all([import('./gl/ballpark.js'), import('./diamond/hud.js'), import('./diamond/camera.js'), import('./diamond/cast.js')])
      .then(([park, hudMod, cam, cast]) => (mods = { ...park, hud: hudMod, project: cam.project, numberOf: cast.numberOf })));
  }

  // ── the 2-D view, when the 3-D one can't draw ──────────────────────────────
  function fallback(why) {
    if (flat) return;
    if (why) console.warn('[grandstand] drawing in 2-D:', why);
    stopTimers(); stopLoop(); stopTable(); dropHolds();
    try { R?.dispose(); } catch { /* already gone */ }
    hud?.dispose();
    R = null; hud = null; canvas = null; mounted = false;
    ro?.disconnect(); ro = null;
    host.innerHTML = '';
    flat = createGamedayView(host);
    // the line first, so the replayed play picks up a held one and lands it with itself
    if (pendingCaption) flat.setCaption(pendingCaption.text, { held: true, speak: pendingCaption.speak });
    else if (caption) flat.setCaption(caption);
    pendingCaption = null;
    if (last) flat.apply(last); else flat.showIdle();
  }

  // ── the page ──────────────────────────────────────────────────────────────
  // The graphics are a canvas, so the score is also written out as text for a screen reader.
  function shell() {
    return `<div class="gds-wrap">` +
      `<div class="gds-park"><canvas class="gds-canvas" role="img" aria-label="The ballpark"></canvas>` +
      `<canvas class="gds-hud" aria-hidden="true"></canvas><div class="gds-sr sr-only"></div></div>` +
      `<div class="gds-cap"><span class="gds-cap-tag">◆ Chip Vega</span><span class="gds-cap-text">${_esc(caption)}</span></div>` +
    `</div>`;
  }
  // The graphics' theme for this broadcast: the station's bug, and tonight's two clubs in their
  // kits' colours.
  function theme() {
    return {
      bug: String(opts.station || '').toUpperCase().slice(0, 10),
      colourOf: (team) => (team && team === S.homeTeam ? SIDE_COLOURS.home : team && team === S.awayTeam ? SIDE_COLOURS.away : null),
    };
  }
  function mount() {
    if (mounted || flat) return !flat;
    host.innerHTML = shell();
    canvas = host.querySelector('.gds-canvas');
    size();
    R = mods.createBallparkRenderer(canvas, { ads: opts.ads || ADS, preserve: !!opts.preserve, crowd: opts.crowd, grade: opts.grade, tube: opts.tube, onAsset: () => draw() });
    if (!R) { fallback('no WebGL2 or float target'); return false; }
    mounted = true;
    hud = mods.hud.createHud(host.querySelector('.gds-hud'), {
      theme: theme(),
      project: (p, w, h) => mods.project(shot, w, h, p),
      safe: () => !!R?.quality?.tube,
      motion: () => !prefersReducedMotion(),
    });
    const box = host.querySelector('.gds-park');
    if (win?.ResizeObserver && box) { ro = new win.ResizeObserver(() => { if (size()) draw(); hud?.paint(); }); ro.observe(box); }
    return true;
  }
  // The backing store follows the box at the device's pixel ratio, capped by the renderer's rung.
  function size() {
    if (!canvas) return false;
    const box = canvas.parentElement;
    const k = Math.min(win?.devicePixelRatio || 1, R?.quality?.dpr || 2);
    const w = Math.max(1, Math.round((box?.clientWidth || 400) * k)), h = Math.max(1, Math.round((box?.clientHeight || 300) * k));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w; canvas.height = h;
    return true;
  }

  // ── drawing ────────────────────────────────────────────────────────────────
  // The park only moves when the game does, so a frame is drawn when something changes and
  // the GPU sits idle between pitches. A new cast is built a few bodies a frame, and the picture
  // waits for all of them: the last frame stays up meanwhile, so nobody pops in. The graphics
  // are their own canvas and repaint without the park.
  function draw() {
    if (!R || raf || !win) return;
    raf = win.requestAnimationFrame(() => {
      raf = 0;
      if (!R || !canvas?.isConnected) return;
      if (R.lost) { fallback('the WebGL context was lost'); return; }
      if (R.pending() && R.pump(14)) { draw(); return; }
      size();
      if (!R.render(shot) && R.lost) fallback('the WebGL context was lost');
    });
  }
  // Who's on the field for this payload, and the clubs whose kits they wear.
  function castFor(p) {
    const top = p.half === 'top';
    R?.setCast(mods.castOf(p), { home: top ? p.fieldingTeam : p.battingTeam, away: top ? p.battingTeam : p.fieldingTeam });
  }
  function stopLoop() { if (raf && win) win.cancelAnimationFrame(raf); raf = 0; }
  function setShot(s) { shot = s; draw(); paintHud(); }

  // What the graphics show now (diamond/hud.js layoutHud says the shape). Before the first
  // payload there's no game to show, only a card the broadcast throws (the pre-game matchup).
  function hudState() {
    if (!S.half) return S.splash ? { splash: S.splash, gold: S.gold } : null;
    return {
      score: { away: S.away, home: S.home, aScore: S.aScore, hScore: S.hScore, half: S.half, inning: S.inning, bases: S.bases, awayTeam: S.awayTeam, homeTeam: S.homeTeam },
      count: { balls: S.balls, strikes: S.strikes, outs: S.outs },
      pitch: S.pitch, bats: S.bats, zone: shot === 'bat' && !!S.pitch,
      matchup: S.matchup, steal: S.steal, splash: S.splash, gold: S.gold,
      leaders: S.tableRace ? { race: S.tableRace, rows: S.leaders?.[S.tableRace] || [], season: S.seasonN, foot: S.tableFoot } : null,
    };
  }
  function paintHud() { hud?.set(hudState()); }
  // The board and the graphics both follow the game.
  function paint() {
    const el = host?.querySelector('.gds-sr');
    if (el) {
      el.textContent = S.half
        ? `${S.away || 'AWY'} ${S.aScore | 0}, ${S.home || 'HOM'} ${S.hScore | 0}. ${S.half === 'top' ? 'Top' : 'Bottom'} of the ${S.inning | 0}. ` +
          `${S.balls | 0} and ${S.strikes | 0}, ${S.outs | 0} out.`
        : '';
    }
    R?.setBoard(S);
    draw();
    paintHud();
  }
  // A graphic that stays up for a while: set it now, clear it after `ms`.
  function hold(key, value, ms) {
    clearTimeout(holds[key]);
    S[key] = value;
    holds[key] = setTimeout(() => { holds[key] = null; S[key] = null; paintHud(); }, ms);
    paintHud();
  }
  function dropHolds() { for (const k of Object.keys(holds)) { clearTimeout(holds[k]); holds[k] = null; S[k] = null; } }

  // ── the leaders between innings ───────────────────────────────────────────
  // A high-score table over the live picture, one race at a time: each break starts on a
  // different race and turns to the next every few seconds while it lasts.
  function startTable(p) {
    stopTable();
    if (!S.leaders) return false;
    const have = RACES.filter((r) => (S.leaders[r] || []).length);
    const list = have.length ? have : ['hr'];
    let i = ((p.inning | 0) * 2 + (p.half === 'bottom' ? 1 : 0)) % list.length;
    const up = (s) => String(s || '').toUpperCase();
    S.tableFoot = (p.inning | 0) <= 1 && p.half === 'top' && !(S.aScore | 0) && !(S.hScore | 0)
      ? `${mods.hud.HUD_THEME.tonight}  ·  ${up(S.awayTeam)} AT ${up(S.homeTeam)}`
      : `${up(S.awayTeam)} ${S.aScore | 0}  ·  ${up(S.homeTeam)} ${S.hScore | 0}  ·  ${p.half === 'bottom' ? 'BOTTOM' : 'TOP'} OF THE ${up(p.inningOrd)}`;
    const turn = () => { S.tableRace = list[i++ % list.length]; paintHud(); };
    turn();
    if (list.length > 1) tableTimer = setInterval(turn, TABLE_CYCLE_MS);
    return true;
  }
  function stopTable() { if (tableTimer) clearInterval(tableTimer); tableTimer = null; S.tableRace = null; }

  // ── the booth's line and the cards ─────────────────────────────────────────
  function showCaption(text) {
    caption = String(text || '');
    const el = host?.querySelector('.gds-cap-text');
    if (el) { el.textContent = caption; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); }
  }
  // The play landed: the held line and any held card go up now.
  function land() {
    playing = false;
    if (pendingCaption) { const p = pendingCaption; pendingCaption = null; showCaption(p.text); p.speak?.(); }
    if (pendingCard) { const c = pendingCard; pendingCard = null; renderCard(c); }
  }
  // A card the broadcast throws is a splash word over the picture.
  function renderCard(fx) {
    if (!host || !fx || !GAMEDAY_CARDS[fx.kind]) return;
    if (fx.kind === 'half' && S.tableRace) return;   // the leaders' table has the break
    const m = GAMEDAY_CARDS[fx.kind](fx);
    const kind = fx.kind === 'homerun' && fx.grand ? 'grandslam' : fx.kind;
    const word = fx.kind === 'half' ? `${fx.half === 'bottom' ? 'BOTTOM' : 'TOP'} ${String(fx.inningOrd || '').toUpperCase()}` : m.title;
    host.querySelector('.gds-idle')?.remove();   // the game's begun, even before its first play
    hold('splash', { kind, word, sub: m.sub }, (fx.duration || 3.5) * 1000);
  }
  function clearCard() { clearTimeout(holds.splash); holds.splash = null; S.splash = null; paintHud(); }

  // ── a payload ─────────────────────────────────────────────────────────────
  function sides(p) {
    const top = p.half === 'top';
    S.away = top ? p.battingAbbr : p.fieldingAbbr; S.home = top ? p.fieldingAbbr : p.battingAbbr;
    S.awayTeam = top ? p.battingTeam : p.fieldingTeam; S.homeTeam = top ? p.fieldingTeam : p.battingTeam;
    S.aScore = Number.isFinite(p.awayScore) ? p.awayScore : S.aScore;
    S.hScore = Number.isFinite(p.homeScore) ? p.homeScore : S.hScore;
    S.inning = p.inning | 0; S.half = p.half || ''; S.pitcher = p.pitcher || '';
    if (p.line) S.line = p.line;
    // the game's leaders and its season ride its first payload, and a late tuner's catch-up
    if (p.leaders) S.leaders = p.leaders;
    if (p.season) { S.seasonN = p.season.n ?? null; S.gold = p.season.phase === 'final'; }
  }
  // The matchup goes up as a man comes up, and not again for the rest of his turn.
  function matchupFor(p) {
    if (!p.batter || p.batter === S.lastBatter) return;
    S.lastBatter = p.batter;
    hold('matchup', {
      batter: p.batter, pitcher: p.pitcher, bNum: mods.numberOf(p.batter), pNum: mods.numberOf(p.pitcher || `${p.fieldingTeam}:P`),
      bl: p.bl, pl: p.pl, bats: p.bats, throws: p.throws, batTeam: p.battingTeam, pitchTeam: p.fieldingTeam,
    }, MATCHUP_MS);
  }
  function stage(p) {
    stopTimers(); stopTable();
    const pend = pendingCaption;
    castFor(p);
    S.pitch = null; S.bats = p.bats || '';
    if (p.phase === 'half') {
      // a fresh half: nobody on, nobody out, and the leaders over the picture
      sides(p);
      Object.assign(S, { balls: 0, strikes: 0, outs: 0, bases: [false, false, false], batter: '', desc: '', lastBatter: '' });
      dropHolds();
      shot = opts.shot || 'high';
      paint();
      if (!startTable(p)) renderCard({ kind: 'half', inningOrd: p.inningOrd, half: p.half, batting: p.battingTeam, duration: 3.4 });
      // a changeover has no ball to land, so its line goes up a beat in
      pendingCaption = null;
      if (pend) later(420, () => { showCaption(pend.text); pend.speak?.(); });
      return;
    }
    const before = Array.isArray(p.basesBefore) ? p.basesBefore : [false, false, false];
    const outsAfter = Math.max(0, Math.min(3, p.outs | 0));
    const outsBy = p.kind === 'tripleplay' ? 3 : p.kind === 'doubleplay' ? 2 : 1;
    const outsBefore = Math.max(0, outsAfter - (p.out ? outsBy : 0));
    // the score before the play, so the graphics don't call it early
    const runs = Number.isFinite(p.runs) ? p.runs : (p.rbi | 0);
    const aAfter = p.awayScore, hAfter = p.homeScore;
    sides(p);
    if (p.half === 'top') S.aScore = Math.max(0, (aAfter | 0) - runs); else S.hScore = Math.max(0, (hAfter | 0) - runs);
    Object.assign(S, { bases: before.slice(), outs: outsBefore, batter: p.batter || '', desc: p.desc || '' });
    S.steal = null; clearTimeout(holds.steal);
    shot = opts.shot || 'bat';
    playing = true;
    const settle = () => {
      Object.assign(S, { bases: (p.basesAfter || [false, false, false]).slice(), outs: outsAfter, aScore: aAfter | 0, hScore: hAfter | 0 });
      paint();
    };
    if (p.phase === 'run') {
      // a play on the bases while he's up: no pitches of its own, and a steal shows its card
      matchupFor(p);
      paint();
      const landAt = p.kind === 'pickoff' || p.kind === 'throwover' ? 260 + T_THROW : T_PITCH + T_THROW;
      later(landAt, () => {
        settle(); land();
        if (STEALS.has(p.kind)) {
          hold('steal', { kind: p.kind === 'doublesteal' && p.out ? 'caughtstealing' : p.kind, runner: p.runner, num: mods.numberOf(p.runner), sb: p.sb, plate: p.plate, pop: p.pop, base: p.base, team: p.battingTeam }, STEAL_MS);
        }
      });
      return;
    }
    const pitches = Array.isArray(p.pitches) ? p.pitches : [];
    const N = pitches.length;
    Object.assign(S, { balls: 0, strikes: 0 });
    matchupFor(p);
    paint();
    const step = N > 1 ? Math.min(REVEAL_STEP_MS, REVEAL_MAX_MS / (N - 1)) : REVEAL_STEP_MS;
    for (let k = 1; k < N; k++) later((k - 1) * step, () => { S.balls = pitches[k - 1].balls; S.strikes = pitches[k - 1].strikes; S.pitch = pitches[k - 1]; paint(); });
    const outMs = Math.max(0, N - 1) * step + OUTCOME_GAP_MS;
    later(outMs, () => { if (N) S.pitch = pitches[N - 1]; settle(); });
    later(outMs + flightOf(p.kind), land);
  }

  function apply(p) {
    if (!host || !p) return;
    if (flat) { flat.apply(p); return; }
    last = p;
    const go = () => {
      if (last !== p || flat) return;
      if (!mount()) return;
      host.querySelector('.gds-idle')?.remove();
      stage(p);
    };
    if (mods) go(); else loadMods().then(go).catch((err) => fallback(err && err.message));
  }
  function setCaption(text, o) {
    if (flat) { flat.setCaption(text, o); return; }
    const speak = o && o.speak;
    if (o && o.held) pendingCaption = { text: String(text || ''), speak };
    else { showCaption(text); speak?.(); }
  }
  function showCard(fx) {
    if (flat) { flat.showCard(fx); return; }
    if (!host || !fx || !GAMEDAY_CARDS[fx.kind]) return;
    if (playing) pendingCard = fx; else renderCard(fx);
  }
  // Opened before a beat arrived: the park from high behind the plate, and a word over it.
  function showIdle() {
    if (flat) { flat.showIdle(); return; }
    if (!host) return;
    clearCard();
    const go = () => {
      if (flat || !mount()) return;
      if (!last) { shot = opts.shot || 'high'; paint(); }
      if (host.querySelector('.gds-idle')) return;
      const veil = doc.createElement('div');
      veil.className = 'gds-idle';
      veil.innerHTML = `<div class="gds-idle-title">DEADBALL</div><div class="gds-idle-sub">Waiting for the first pitch…</div>`;
      host.querySelector('.gds-park')?.appendChild(veil);
    };
    if (mods) go(); else loadMods().then(go).catch((err) => fallback(err && err.message));
  }
  function clear() {
    if (flat) { flat.clear(); flat = null; }
    stopTimers(); stopLoop(); stopTable(); dropHolds();
    ro?.disconnect(); ro = null;
    try { R?.dispose(); } catch { /* already gone */ }
    hud?.dispose();
    if (host) host.innerHTML = '';
    R = null; hud = null; canvas = null; mounted = false;
    last = null; caption = ''; pendingCaption = null; pendingCard = null; playing = false;
  }

  return {
    apply, clear, setCaption, showIdle, showCard,
    // for the sandbox and the gates
    setShot, ready: () => loadMods(),
    get renderer() { return R; }, get hud() { return hud; }, get flat() { return flat; }, get state() { return S; },
    busy: () => playing,
  };
}
