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
// What's built (Phases 1a to 2d of docs/proposals/deadball-glass2.md): the park from the venue's
// defaults through the batting view, lit by its towers, the scoreboard lit with the game, the
// city round it as a set composed from the league's venue (venue.js), with the park's own brick
// outside and its name over the gate, the players where each payload has them, and the arcade
// graphics over the picture (diamond/hud.js): the score and the count as lamps, the pitch speed,
// the zone with the last pitch, a matchup card as each man comes up, a steal's card, splash words
// for the cards the broadcast throws and for strikeouts and walks, and between innings the
// league's leaders as a high-score table. The booth's line runs under the picture.
//
// Each at-bat is staged pitch by pitch (diamond/director.js) in a world stepped at 120 Hz
// (diamond/world.js) while it plays: the battery's clips, the ball at its real speed to its exact
// spot, the director's cuts. The count goes up as each pitch is decided, and the held line and the
// card go up when the play lands, so the booth never calls a play the picture hasn't reached. A
// ball in play is played out (diamond/plays.js), and so is a play on the bases (diamond/runs.js:
// a steal, a throw over, a wild pitch), its steal card on the landing; at a changeover the new
// side takes the field and the pitcher warms up. A big play gets a slow-motion replay once its
// line's up (diamond/replay.js), its own world shown in place of the live one. The dead time till
// the next payload's due is filled (diamond/between.js): the field walks back, the pitcher rubs up
// the ball, the on-deck hitter swings and the cameras go round the park. The infield keeps
// the game's marks, each stride, dig and slide painted into the dirt as it's made
// (diamond/marks.js, gl/ballpark.js markDirt), till the grounds crew drag it in the middle of the
// fifth (diamond/crew.js), the leaders' table down while they do. The sky follows the minute each
// payload aired at, from sunset through the blue hour to night (diamond/sky.js), and the weather
// over the park as it aired: what falls, the wet field and lightning (diamond/weather.js). With
// reduced motion the cameras hold still, a replay is a still and lightning doesn't flash; and
// everything the graphics say is in words too, for a screen reader (Play by Play in the
// accessibility settings).
//
// The sim on the server decides everything. Nothing here can change a score.

import { createGamedayView, GAMEDAY_CARDS, pitchText, cardText } from './gameday.js';
import { DEADBALL_SFX } from '../../../shared/deadball-sfx.js';
import { venueOf, onVenue } from './venue.js';
import { prefersReducedMotion, playByPlayOn } from '../../../shared/settings.js';

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

// How long a replay leaves before the next payload's due (s), at the least.
const REPLAY_MARGIN = 1;
// How long each graphic stays up: the matchup as a man comes up, a steal's card once it lands,
// and each of the leaders' races between innings.
const MATCHUP_MS = 4200, STEAL_MS = 4800, DIST_MS = 6000, TABLE_CYCLE_MS = 8000;
// The splash a play earns on its own (a strikeout, ball four, a diving catch…), and how long past
// the director's landing a play lands
// anyway once the frames have stopped (a hidden tab), so the line and the card never wait on a
// picture nobody's drawing.
const OWN_SPLASH_MS = 2600, LAND_SLACK_MS = 1500;
// How much of the grounds crew's drag goes back on the dirt at a time (s): each time is one upload.
const SMOOTH_S = 0.35;
const RACES = ['hr', 'avg', 'sb', 'k'];
// How many lines the live text keeps (gameday.js keeps as many).
const LIVE_KEEP = 12;
const STEALS = new Set(['steal', 'caughtstealing', 'doublesteal']);

export function createGrandstandView(host, opts = {}) {
  const doc = host ? host.ownerDocument : null;
  const win = doc ? doc.defaultView : null;
  if (!opts.force && !grandstandOn(win)) return createGamedayView(host);

  let flat = null;              // the 2-D view, once the 3-D one has given way to it
  let R = null, hud = null, canvas = null, mounted = false, modsP = null, mods = null, ro = null, raf = 0, unVenue = null;
  let last = null, caption = '', pendingCaption = null, pendingCard = null, playing = false;
  let timers = [], tableTimer = null, shot = opts.shot || 'high';
  // the world the at-bats are staged in, and its director; `live` while the world has the battery,
  // `cur` the at-bat it's playing; `speed` is the world's clock against the wall's (1 live, a
  // quarter for a slow look, 0 stopped so the sandbox can step it by hand)
  let W = null, D = null, live = false, cur = null, acc = 0, lastNow = 0, speed = Number.isFinite(opts.speed) ? opts.speed : 1;
  // a big play's replay (diamond/replay.js): `replayDue` once the play's landed and the hold has
  // room ({ at: the live world's time to start, spec, p, calm }), `replay` while it plays, its own
  // world in place of the live one; `liveShot` the live director's camera meanwhile
  let replayDue = null, replay = null, liveShot = null;
  // the fans (gl/crowd.js createRoar): how loud each side is, on the live world's clock; `calm`
  // while the viewer has asked for less motion, when they get up without bouncing
  let roar = null, calm = false;
  // the marks the game's made in the dirt since the last frame (diamond/marks.js), and the game
  // they're from: a new one starts on a fresh infield; whether the grounds crew's mats are drawn,
  // and the world's time their drag has put the dirt back to (diamond/crew.js)
  let marks = [], dirtGame = null, matsUp = false, smoothedTo = null;
  // the bags the picture last left taken (director.js pictureAfter): an at-bat that starts from
  // others opens on a cutaway while everyone takes their places
  let shown = null;
  // what the graphics and the board show: the score, the count, the outs and the bags, and the
  // cards that come and go (matchup, steal, a home run's distance, splash) and the leaders' table
  // between innings
  const S = {
    away: '', home: '', awayTeam: '', homeTeam: '', aScore: 0, hScore: 0, inning: 0, half: '',
    balls: 0, strikes: 0, outs: 0, bases: [false, false, false], batter: '', pitcher: '', line: null, desc: '',
    pitch: null, bats: '', lastBatter: '', matchup: null, steal: null, dist: null, splash: null,
    leaders: null, seasonN: null, gold: false, tableRace: null, tableFoot: '', replay: false,
  };
  const holds = {};

  const later = (ms, fn) => { timers.push(setTimeout(fn, Math.max(0, ms))); };
  // a cue from the Deadball bank, on the TV's bus (nothing plays without the audio engine)
  const sfx = (cue) => { if (DEADBALL_SFX[cue]) win?.AudioEngine?.playSfx?.(DEADBALL_SFX[cue]); };
  const stopTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function loadMods() {
    return (modsP ??= Promise.all([import('./gl/ballpark.js'), import('./diamond/hud.js'), import('./diamond/camera.js'), import('./diamond/cast.js'),
      import('./diamond/world.js'), import('./diamond/director.js'), import('./diamond/spectacle.js'), import('./diamond/replay.js'), import('./gl/crowd.js'),
      import('./diamond/crew.js')])
      .then(([park, hudMod, cam, cast, world, director, fx, rp, crowd, crew]) => (mods = {
        ...park, hud: hudMod, project: cam.project, shotAt: cam.shotAt, numberOf: cast.numberOf, pictureAfter: director.pictureAfter, opensGame: director.opensGame,
        createWorld: world.createWorld, DT: world.DT, createDirector: director.createDirector, splashOf: fx.splashOf,
        replayOf: rp.replayOf, stageReplay: rp.stageReplay, REPLAY: rp.REPLAY, fxEnd: fx.endOf,
        cheerOf: fx.cheerOf, createRoar: crowd.createRoar, matAt: crew.matAt, sweptAlong: crew.sweptAlong,
      })));
  }

  // ── the 2-D view, when the 3-D one can't draw ──────────────────────────────
  function fallback(why) {
    if (flat) return;
    if (why) console.warn('[grandstand] drawing in 2-D:', why);
    stopTimers(); stopLoop(); stopTable(); dropHolds(); stopWorld();
    unVenue?.(); unVenue = null;
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
  // The graphics are a canvas, so they're words too, for a screen reader: the score, the count
  // and a table between innings on the board (`.gds-sr`), and each pitch, the booth's line and
  // whatever goes up over the picture in the live text (`.gds-live`, Play by Play in the
  // accessibility settings).
  function shell() {
    return `<div class="gds-wrap">` +
      `<div class="gds-park"><canvas class="gds-canvas" role="img" aria-label="The ballpark"></canvas>` +
      `<canvas class="gds-hud" aria-hidden="true"></canvas><div class="gds-sr sr-only"></div>` +
      `<div class="gds-live sr-only" role="log" aria-live="polite"></div></div>` +
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
    // `opts.renderer` stands in for the GL park (the gates' recording renderer)
    R = (opts.renderer || mods.createBallparkRenderer)(canvas, { ads: opts.ads || ADS, preserve: !!opts.preserve, crowd: opts.crowd, grade: opts.grade, tube: opts.tube, onAsset: () => draw() });
    if (!R) { fallback('no WebGL2 or float target'); return false; }
    mounted = true;
    W = mods.createWorld();
    D = mods.createDirector(W, { onLand: () => landPlay(cur), emit: fromDirector });
    roar = mods.createRoar();
    hud = mods.hud.createHud(host.querySelector('.gds-hud'), {
      theme: theme(),
      project: (p, w, h) => mods.project(view(), w, h, p),
      safe: () => !!R?.quality?.tube,
      motion: () => !prefersReducedMotion(),
    });
    const box = host.querySelector('.gds-park');
    if (win?.ResizeObserver && box) { ro = new win.ResizeObserver(() => { if (size()) draw(); hud?.paint(); }); ro.observe(box); }
    // the city round the park: the venue this browser holds, then any newer one the server sends
    setCity();
    unVenue = onVenue((sport) => { if (sport === 'baseball') { setCity(); draw(); } });
    return true;
  }
  function setCity() {
    const v = opts.venue || venueOf('baseball');
    if (!v || !R) return;
    try { R.setVenue(v); } catch (err) { console.warn('[grandstand] the city round the park would not build:', err && err.message); }
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
  // The park only moves when the game does: frames run while an at-bat plays and through the dead
  // time after it, till the next payload's due (diamond/between.js), and the GPU sits idle once
  // everyone's at rest; a payload that doesn't say how long it holds gets no dead time, so its
  // frames stop once its play's done. A new cast is built a few bodies a frame, and the picture
  // waits for all of them, the world's clock too: the last frame stays up meanwhile, so nobody
  // pops in. While the world has the battery, each frame steps it in fixed steps to the frame's
  // time and hands the renderer their poses and the ball. The graphics are their own canvas and
  // repaint without the park.
  function draw() {
    if (!R || raf || !win) return;
    raf = win.requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    if (!R || !canvas?.isConnected) return;
    if (R.lost) { fallback('the WebGL context was lost'); return; }
    if (R.pending() && R.pump(14)) { lastNow = now; draw(); return; }
    if (live) {
      const dt = Math.min(0.25, Math.max(0, (now - (lastNow || now)) / 1000)) * speed;
      acc += dt;
      while (acc >= mods.DT) { W.step(mods.DT); acc -= mods.DT; }
      if (replayDue && W.t >= replayDue.at) startReplay();
      // a replay plays its own world, slower; the live one carries on behind it
      const RW = replay ? replay.W : W;
      if (replay && !replay.still) {
        replay.acc += dt * mods.REPLAY.rate;
        while (replay.acc >= mods.DT && RW.t < replay.to) { RW.step(mods.DT); replay.acc -= mods.DT; }
      }
      for (const b of RW.bodies.values()) { const P = RW.pose(b.slot); if (P) R.setPose(b.slot, P); }
      R.setBall(RW.ballAt());
      R.setSpectacle?.(replay ? replay.D.fx : D.fx, RW.t);
      R.setCrowd?.(roar.at(W.t), W.t, !calm);
      R.setTime?.(RW.t);
      if (marks.length) { R.markDirt?.(marks); marks = []; }
      dragFrame();
      if (replay && (replay.still ? W.t >= replay.until : RW.t >= replay.to - 1e-9)) endReplay();
    }
    lastNow = now;
    size();
    if (!R.render(view()) && R.lost) { fallback('the WebGL context was lost'); return; }
    // on to the next frame while the at-bat plays or a replay's due or playing; once everyone's
    // at rest the last one stays up. A stopped clock draws only when something asks.
    if (live && (D.busy() || replayDue || replay)) { if (speed > 0) draw(); }
    else live = false;
  }
  function stopWorld() { D?.stop(); live = false; cur = null; stopReplay(); }
  // The grounds crew's mats this frame (diamond/crew.js), and the dirt they've gone over since the
  // last time put back as painted, SMOOTH_S at a time, so the dirt goes up a few times a second
  // rather than every frame.
  function dragFrame() {
    const drags = D.drags || [];
    if (!drags.length) { if (matsUp) { R.setMats?.([]); matsUp = false; } smoothedTo = null; return; }
    R.setMats?.(drags.map((d) => mods.matAt(d, W.t)));
    matsUp = true;
    if (smoothedTo == null || W.t < smoothedTo) smoothedTo = W.t;
    if (W.t - smoothedTo < SMOOTH_S) return;
    const polys = drags.flatMap((d) => mods.sweptAlong(d, smoothedTo, W.t));
    smoothedTo = W.t;
    if (polys.length) R.smoothDirt?.(polys);
  }
  // The camera this frame: the director's shot, which may follow the ball (diamond/camera.js
  // shotAt), at the world's time (the replay's, while one plays), the same for the park and the
  // graphics.
  const view = () => (mods && shot && typeof shot === 'object' ? mods.shotAt(shot, replay ? replay.W.t : W ? W.t : 0) : shot);

  // ── replays ───────────────────────────────────────────────────────────────
  // The play staged again in its own world and played slower from its second camera, or with
  // reduced motion held still on its moment, under the REPLAY bug; then back to the live camera.
  function startReplay() {
    const due = replayDue;
    replayDue = null;
    replay = mods.stageReplay(due.p, due.spec, { cast: due.cast, motion: !due.calm });
    if (!replay) return;
    replay.acc = 0;
    if (replay.still) replay.until = W.t + mods.REPLAY.still;
    S.replay = true;
    if (!opts.shot) shot = replay.shot;
    say(`Replay${replay.still ? '' : ', in slow motion'}: ${due.p.desc || mods.hud.HUD_THEME.words[due.p.kind] || 'the play'}`);
    paintHud();
  }
  function endReplay() {
    replay = null;
    S.replay = false;
    if (!opts.shot) shot = liveShot || 'high';
    paintHud();
  }
  function stopReplay() { replayDue = null; if (replay) endReplay(); }
  // Whose fans a side of a play is: 0 the home fans, 1 the visitors' (the home side bats in the
  // bottom of an inning).
  const fansOf = (p, side) => ((side === 'bat') === (p.half === 'bottom') ? 0 : 1);
  // Who's on the field for this payload, and the clubs whose kits they wear.
  function castFor(p) {
    const top = p.half === 'top', cast = mods.castOf(p);
    R?.setCast(cast, { home: top ? p.fieldingTeam : p.battingTeam, away: top ? p.battingTeam : p.fieldingTeam });
    return cast;
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
      matchup: S.matchup, steal: S.steal, dist: S.dist, splash: S.splash, gold: S.gold, replay: S.replay,
      leaders: S.tableRace ? { race: S.tableRace, rows: S.leaders?.[S.tableRace] || [], season: S.seasonN, foot: S.tableFoot } : null,
    };
  }
  function paintHud() { hud?.set(hudState()); }
  // The board and the graphics both follow the game.
  function paint() {
    board();
    R?.setBoard(S);
    draw();
    paintHud();
  }
  // The board in words, for a screen reader, with the leaders' table while it's up.
  function board() {
    const el = host?.querySelector('.gds-sr');
    if (el) {
      el.textContent = S.half
        ? `${S.away || 'AWY'} ${S.aScore | 0}, ${S.home || 'HOM'} ${S.hScore | 0}. ${S.half === 'top' ? 'Top' : 'Bottom'} of the ${S.inning | 0}. ` +
          `${S.balls | 0} and ${S.strikes | 0}, ${S.outs | 0} out.` +
          (S.tableRace && S.leaders ? ` ${mods.hud.tableSaid({ race: S.tableRace, rows: S.leaders[S.tableRace] || [], season: S.seasonN })}` : '')
        : '';
    }
  }
  // A line of the live text, if the player has Play by Play on.
  function say(text) {
    const t = String(text || '').trim(), el = t && playByPlayOn() ? host?.querySelector('.gds-live') : null;
    if (!el) return;
    const line = doc.createElement('p');
    line.textContent = t;
    el.appendChild(line);
    while (el.children.length > LIVE_KEEP) el.children[0].remove();
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
    const turn = () => { S.tableRace = list[i++ % list.length]; board(); paintHud(); };
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
    say(caption);
  }
  // The director's at-bat landed (or its time came with the frames stopped): the board settles,
  // a strikeout or a walk gets its splash, and the held line and any held card go up, the card
  // over the splash.
  function landPlay(c) {
    if (!c || c.landed || c !== cur) return;
    c.landed = true;
    c.settle();
    const p = c.p;
    // the play's own sound, as the 2-D view plays it
    const outs = p.kind === 'tripleplay' ? 3 : p.kind === 'doubleplay' ? 2 : 1;
    if (p.kind === 'homerun') sfx('homer');
    else if (p.rbi > 0 || (p.phase === 'run' && p.runs > 0)) sfx('run');
    else if (p.kind === 'strikeout') sfx('strikeout');
    else if (p.out) { sfx('out'); for (let k = 1; k < outs; k++) later(150 * k, () => sfx('out')); }
    else sfx('base');
    // the words the play earns (a strikeout, ball four, a diving catch, a ball over the wall caught
    // back…: diamond/spectacle.js splashOf); a card the broadcast throws goes over them
    const own = mods.splashOf(p);
    if (own) { hold('splash', own, OWN_SPLASH_MS); say(mods.hud.splashSaid(own)); }
    // a home run's distance from where it came down, and how hard it was hit, in the speed's box
    if (p.kind === 'homerun' && Number(p.play?.d) > 0) { hold('dist', { ft: p.play.d, ev: p.play.ev }, DIST_MS); say(mods.hud.distSaid(S.dist)); }
    // a steal's card with its clocks, once the call's made
    if (p.phase === 'run' && STEALS.has(p.kind)) {
      hold('steal', { kind: p.kind === 'doublesteal' && p.out ? 'caughtstealing' : p.kind, runner: p.runner, num: mods.numberOf(p.runner), sb: p.sb, plate: p.plate, pop: p.pop, base: p.base, team: p.battingTeam }, STEAL_MS);
      say(mods.hud.stealSaid(S.steal));
    }
    land();
    // the fans whose play it was get up as it lands (a home run had them up off the bat)
    if (c.cheer) roar.cheer(fansOf(p, c.cheer.side), c.cheer.amp, W.t, c.cheer.hold);
    // a big play gets its replay once the line's up and any fireworks are out (it would hide
    // them), if the hold has room for it before the next payload's due: a payload that doesn't say
    // how long it holds gets none
    const spec = c.cast && D.play ? mods.replayOf(p, D.play, D.log) : null;
    let replayEnd = null;
    if (spec && Number.isFinite(p.hold)) {
      const calm = prefersReducedMotion(), long = calm ? mods.REPLAY.still : (spec.to - spec.from) / mods.REPLAY.rate;
      const at = Math.max(W.t + mods.REPLAY.after, ...(D.fx || []).filter((e) => e.kind === 'burst').map(mods.fxEnd));
      if (at + long <= c.t0 + p.hold / 1000 - REPLAY_MARGIN) { replayDue = { at, spec, p, calm, cast: c.cast }; replayEnd = at + long; }
    }
    // and the dead time till the next payload's due (diamond/between.js): the field walks back, the
    // pitcher rubs up the ball and the cameras go round the park, once any replay's done
    if (Number.isFinite(p.hold) && c.cast) D.planBetween?.({ until: c.t0 + p.hold / 1000, from: replayEnd != null ? replayEnd + 0.3 : undefined });
  }
  // What the director says as it stages: a cut to another camera, a sound on its moment, and each
  // pitch as it's decided, for the count, the speed and the zone (the count never shows a fourth
  // ball or a third strike).
  function fromDirector(name, d) {
    if (name === 'shot') { liveShot = d; if (!opts.shot && !replay) setShot(d); return; }
    if (name === 'sound') { sfx(d); return; }
    if (name === 'mark') { marks.push(d); return; }
    if (name === 'table') {
      if (d) return;
      if (S.tableRace) { stopTable(); board(); paintHud(); }
      say('The grounds crew are out to drag the infield.');
      return;
    }
    if (name !== 'pitch' || !cur) return;
    const q = d.pitch, last = d.i === (cur.p.pitches || []).length - 1;
    S.balls = last ? Math.min(3, q.balls | 0) : q.balls | 0;
    S.strikes = last ? Math.min(2, q.strikes | 0) : q.strikes | 0;
    S.pitch = q;
    paint();
    say(pitchText(q, last));
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
    say(cardText(fx, m));
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
    say(mods.hud.matchupSaid(S.matchup));
  }
  // A payload from another game than the marks in the dirt (other clubs, or back to an earlier
  // inning) starts it fresh.
  function freshGame(p) {
    const top = p.half === 'top', game = top ? `${p.battingTeam}@${p.fieldingTeam}` : `${p.fieldingTeam}@${p.battingTeam}`;
    const at = (p.inning | 0) * 2 + (top ? 0 : 1);
    if (dirtGame && (dirtGame.game !== game || at < dirtGame.at)) { marks = []; R?.resetDirt?.(); }
    dirtGame = { game, at };
  }
  function stage(p) {
    stopTimers(); stopTable(); stopWorld();
    const pend = pendingCaption;
    freshGame(p);
    // the sky at the minute the line aired (diamond/sky.js), a payload without one at night, and the
    // weather over the park as it aired (diamond/weather.js), its lightning not flashing for a
    // viewer who's asked for less motion
    R?.setHour?.(Number.isFinite(p.clock) ? p.clock / 60 : null);
    R?.setWeather?.(p.wx || null, { flash: !prefersReducedMotion() });
    const cast = castFor(p);
    S.pitch = null; S.bats = p.bats || '';
    if (p.phase === 'half') {
      // a fresh half: nobody on, nobody out, and the leaders over the picture
      sides(p);
      shown = mods.pictureAfter(p);
      Object.assign(S, { balls: 0, strikes: 0, outs: 0, bases: [false, false, false], batter: '', desc: '', lastBatter: '' });
      dropHolds();
      shot = opts.shot || 'high';
      // the new side takes the field under the break's graphics, and the pitcher warms up; in the
      // middle of the fifth the grounds crew drag the infield first, and the table comes down for them
      live = true; acc = 0;
      calm = prefersReducedMotion();
      D.changeover(p, cast, { motion: !calm });
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
    S.dist = null; clearTimeout(holds.dist);
    shot = opts.shot || 'bat';
    playing = true;
    const settle = () => {
      Object.assign(S, { bases: (p.basesAfter || [false, false, false]).slice(), outs: outsAfter, aScore: aAfter | 0, hScore: hAfter | 0 });
      paint();
    };
    // he's up and hasn't seen a pitch yet: a play on the bases comes before his at-bat (sim v2), and
    // the director stages it as it does an at-bat (diamond/runs.js), its steal card on the landing
    Object.assign(S, { balls: 0, strikes: 0 });
    matchupFor(p);
    paint();
    // the director stages it pitch by pitch, and the count goes up as each one's decided; the
    // play lands when the director says, or if the frames have stopped, a beat after
    cur = { p, settle, landed: false, t0: W.t, cast };
    const mine = cur;
    live = true; acc = 0;
    // a game's first at-bat opens on the main gate from the street, the crowd still going in, when
    // there's a city round the park to stand in; any other whose bags the picture didn't leave, on
    // the wide shot over the city
    const cutaway = mods.opensGame(p) && R?.city ? 'street' : !!shown && shown.some((b, i) => b !== !!before[i]);
    calm = prefersReducedMotion();
    D.stage(p, cast, { cutaway, motion: !calm });
    // the fans: a ball they can see is gone brings them up off the bat, anything else as it lands
    const ch = mods.cheerOf(p), hit = D.log[D.log.length - 1]?.contact?.t;
    roar.prune(W.t);
    if (ch && ch.from === 'contact' && Number.isFinite(hit)) roar.cheer(fansOf(p, ch.side), ch.amp, hit + 0.35, ch.hold);
    else cur.cheer = ch;
    if (D.cutaway && !opts.shot) shot = D.opening || 'sky';
    shown = mods.pictureAfter(p);
    // while frames run the world lands it; if they've stopped (a hidden tab) this does
    const watch = () => {
      if (mine.landed || mine !== cur) return;
      if (lastNow && (win?.performance || performance).now() - lastNow < LAND_SLACK_MS) later(LAND_SLACK_MS, watch);
      else landPlay(mine);
    };
    if (speed > 0) later((D.landAt - W.t) * 1000 / speed + LAND_SLACK_MS, watch);
    draw();
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
    // A play's line comes just before its payload. One that comes while the last play is still
    // in the air (frames stopped in a hidden tab) lands that play first, so its line isn't lost.
    if (o && o.held && pendingCaption && cur && !cur.landed) landPlay(cur);
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
    stopTimers(); stopLoop(); stopTable(); dropHolds(); stopWorld();
    unVenue?.(); unVenue = null;
    ro?.disconnect(); ro = null;
    try { R?.dispose(); } catch { /* already gone */ }
    hud?.dispose();
    if (host) host.innerHTML = '';
    R = null; hud = null; canvas = null; mounted = false; W = null; D = null;
    last = null; caption = ''; pendingCaption = null; pendingCard = null; playing = false; shown = null; marks = []; dirtGame = null;
  }

  return {
    apply, clear, setCaption, showIdle, showCard,
    // for the sandbox and the gates
    setShot, ready: () => loadMods(),
    get renderer() { return R; }, get hud() { return hud; }, get flat() { return flat; }, get state() { return S; },
    get world() { return W; }, get director() { return D; }, get shot() { return shot; }, get replay() { return replay; }, get replayDue() { return replayDue; },
    get speed() { return speed; }, set speed(k) { speed = Math.max(0, Number(k) || 0); draw(); },
    redraw: () => draw(),
    busy: () => playing || live || !!replayDue || !!replay,
  };
}
