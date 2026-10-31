// Gameday · Grandstand: Deadball's park in 3-D (GLASS 2).
//
// The same five methods as gameday.js and gameday-rink.js ({ apply, clear, setCaption,
// showIdle, showCard }), so tv.js mounts it for baseball and changes nothing else.
//
// ⚠ WITH ITS FLAG SET TO '0' IT IS THE 2-D GAMEDAY. `createGrandstandView` hands back
// `createGamedayView(host)` and nothing in this file runs. The flag is the localStorage key
// `deadball.grandstand`; unset, or anything but '0', is the park in 3-D.
//
// The park draws through gl/ballpark.js, and the 2-D view takes over whenever the 3-D one
// can't: no WebGL2, no float target, a shader that won't build, or a lost context. The last
// payload and the booth's line go with it.
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
// side takes the field and the pitcher warms up. A home run's batter trots round the bags on their
// cameras to the men waiting at the plate. A big play gets a slow-motion replay once its line's up
// (diamond/replay.js), a home run's once he's off the plate, its own world shown in place of the
// live one. The booth can talk over the pitches: a payload riding a plate appearance's first line
// (`lead`) starts at once, and its call comes later as a held line with `call`, which waits for
// that play's landing and never the next one's (`setCaption`). The dead time till
// the next payload's due is filled (diamond/between.js): the field walks back, the pitcher rubs up
// the ball, the on-deck hitter swings and the cameras go round the park. A seat in the stands
// (stands.js) gets no replays and no cuts: each payload waits till the last play's field is at
// rest, so the game runs longer in person than on TV (`inLine`). The infield keeps
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

import { createGamedayView, GAMEDAY_CARDS, pitchText, cardText, sideColours } from './gameday.js';
import { venueOf, onVenue } from './venue.js';
import { onClubs } from './club-crest.js';
import { addFullscreenButton, leaveFullscreen } from './view-fullscreen.js';
import { prefersReducedMotion, playByPlayOn } from '../../../shared/settings.js';

// On wherever it can draw (it gives way to the 2-D view by itself where it can't); the flag set
// to '0' keeps the 2-D Gameday.
export const GRANDSTAND_FLAG = 'deadball.grandstand';
export function grandstandOn(win) {
  try { return win?.localStorage?.getItem(GRANDSTAND_FLAG) !== '0'; } catch { return true; }
}

function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// The ads round the bowl behind the plate.
const ADS = ['KSAB-TV', 'DEADBALL', 'COLDWATER', 'KSAB-TV'];
// The two clubs on tonight wear their kits' colours on the graphics too (sideColours in
// gameday.js, which the 2-D field shares). The rest of the league's come off their names
// (diamond/hud.js).
// A hex colour as linear light, for the champions' confetti.
const linear = (hex) => [0, 2, 4].map((i) => { const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
// A final: how long the last out's frame is held before the champions' finish (ms), how long a
// line-up card stays up before a final's first pitch (ms), and how long the champions' card holds.
const FINAL_HOLD_MS = 1200, INTRO_CARD_MS = 1700, CHAMP_MS = 30000;
// The viewer's pitch camera, kept in this browser (a convenience, never a setting the server knows).
const CAM_KEY = 'architect_deadball_cam';
const CAM_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 5h3l1.2-1.6h3.6L11 5h3v8H2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="9" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

// How long a replay leaves before the next payload's due (s), at the least.
const REPLAY_MARGIN = 1;
// In person (a seat in the stands, not its suite's TV) there are no replays and no cuts: the next
// payload waits till the field's at rest. How long the field gets to come back after a play (s), a
// beat after the last man's at rest before the next pitch (s), how often the queue's looked at
// (ms), and how many payloads can wait before the seat stops waiting (it'd fall ever further
// behind the broadcast).
const PARK_ROOM = 45, PARK_BEAT = 1.5, PARK_POLL_MS = 250, PARK_BACKLOG = 4;
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
  let skyField = null;
  // the box's screen's own graphics (opts.room) and the canvas they're painted on
  let tvHud = null, tvCanvas = null, tvWas = null;
  let R = null, hud = null, canvas = null, mounted = false, modsP = null, mods = null, ro = null, raf = 0, unVenue = null, unClubs = null, dressed = null;
  // the picture's quality (diamond/quality.js): the tier the screen starts on, and the governor that
  // steps it down a rung when frames come slow and back up when they've been quick a while, fed the
  // time between frames while they run (`govAt`, the last one's)
  let gov = null, govAt = 0, govNext = null;
  let last = null, caption = '', pendingCaption = null, pendingCard = null, playing = false;
  // Who the caption's tag names: a "Name says, ..." line is the colour man's, his name on the
  // tag and his words in the bar; anything else is the play-by-play man's, whom the broadcast
  // names with each line (tv.js passes it as 'who').
  let capWho = 'Booth', anchorWho = '';
  let timers = [], tableTimer = null, shot = opts.shot || 'high';
  // the world the at-bats are staged in, and its director; `live` while the world has the battery,
  // `cur` the at-bat it's playing; `speed` is the world's clock against the wall's (1 live, a
  // quarter for a slow look, 0 stopped so the sandbox can step it by hand)
  let W = null, D = null, live = false, cur = null, acc = 0, lastNow = 0, speed = Number.isFinite(opts.speed) ? opts.speed : 1;
  // a big play's replay (diamond/replay.js): `replayDue` once the play's landed and the hold has
  // room ({ at: the live world's time to start, spec, p, calm }), `replay` while it plays, its own
  // world in place of the live one; `liveShot` the live director's camera meanwhile
  let replayDue = null, replay = null, liveShot = null;
  // in person, the world's time the field's at rest by (Infinity while a play's in the air), the
  // broadcast's calls held till then, and the timer that looks at them
  let parkHold = 0, parkQueue = [], parkTimer = null;
  const inPerson = () => !!opts.seat && opts.seat.mode !== 'tv';
  // the fans (gl/crowd.js createRoar): how loud each side is, on the live world's clock; `calm`
  // while the viewer has asked for less motion, when they get up without bouncing
  let roar = null, calm = false;
  // what the park sounds like (diamond/sound.js): it hears the live world each frame
  let snd = null;
  // a final's last out, held still till this (the frame clock's ms)
  let frozenUntil = 0;
  // the fly-in before a game (arrive), running on the live world's clock till this
  let flyUntil = 0;
  // how long the camera's shutter is open on the ball, in seconds of the screen's time: half a
  // frame at 60 Hz, as a broadcast camera's is
  const BALL_SHUTTER = 1 / 120;
  // the bodies' own weight as they're drawn (diamond/secondary.js), the live world's and a replay's
  let settle = null, settleR = null;
  // the camera the pitches are watched from (director.js pitchCam): the batter's, or the pitcher's
  // from centre field, as the viewer last picked it here
  let pitchCam = opts.cam === 'cf' || opts.cam === 'bat' ? opts.cam : readCam();
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
    pitch: null, pitches: [], bats: '', lastBatter: '', matchup: null, steal: null, dist: null, splash: null,
    leaders: null, seasonN: null, gold: false, tableRace: null, tableFoot: '', replay: false,
    final: null, intro: null, champ: null,
  };
  const holds = {};

  const later = (ms, fn) => { timers.push(setTimeout(fn, Math.max(0, ms))); };
  // a sound the director planned, through the park's mixer
  const sfx = (cue) => snd?.cue(cue);
  const stopTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function loadMods() {
    return (modsP ??= Promise.all([import('./gl/ballpark.js'), import('./diamond/hud.js'), import('./diamond/camera.js'), import('./diamond/cast.js'),
      import('./diamond/world.js'), import('./diamond/director.js'), import('./diamond/spectacle.js'), import('./diamond/replay.js'), import('./gl/crowd.js'),
      import('./diamond/crew.js'), import('./diamond/quality.js'), import('./diamond/sound.js'), import('./diamond/secondary.js')])
      .then(([park, hudMod, cam, cast, world, director, fx, rp, crowd, crew, quality, sound, sec]) => (mods = {
        createSettle: sec.createSettle,
        ...park, hud: hudMod, project: cam.project, shotAt: cam.shotAt, SHOTS: cam.SHOTS, approachShot: cam.approachShot, APPROACH: cam.APPROACH, handheld: cam.handheld, numberOf: cast.numberOf, pictureAfter: director.pictureAfter, opensGame: director.opensGame,
        createWorld: world.createWorld, DT: world.DT, createDirector: director.createDirector, splashOf: fx.splashOf,
        replayOf: rp.replayOf, stageReplay: rp.stageReplay, REPLAY: rp.REPLAY, fxEnd: fx.endOf,
        cheerOf: fx.cheerOf, createRoar: crowd.createRoar, matAt: crew.matAt, sweptAlong: crew.sweptAlong,
        parkTier: quality.parkTier, rungsFor: quality.rungsFor, createGovernor: quality.createGovernor,
        createParkSound: sound.createParkSound, crackPitch: sound.crackPitch, planChampion: fx.planChampion, planSearchlights: fx.planSearchlights,
      })));
  }

  // ── the 2-D view, when the 3-D one can't draw ──────────────────────────────
  function fallback(why) {
    if (flat) return;
    if (why) console.warn('[grandstand] drawing in 2-D:', why);
    stopTimers(); stopLoop(); stopTable(); dropHolds(); stopWorld();
    unVenue?.(); unVenue = null; unClubs?.(); unClubs = null; dressed = null;
    try { R?.dispose(); } catch { /* already gone */ }
    hud?.dispose(); tvHud?.dispose(); tvHud = null; tvCanvas = null; tvWas = null;
    snd?.dispose(); snd = null;
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
      `<div class="gds-cap"><span class="gds-cap-tag">◆ ${_esc(capWho)}</span><span class="gds-cap-text">${_esc(caption)}</span></div>` +
    `</div>`;
  }
  // The graphics' theme for this broadcast: the station's bug, and tonight's two clubs in their
  // kits' colours. Over your own eyes in a seat ('live') there's no bug: you're at the game, not
  // watching it, so the station's mark only shows on a screen (the box's TV, or T for the broadcast)
  function theme(live = false) {
    const bug = String(opts.station || '').toUpperCase().slice(0, 10);
    return {
      get bug() { return live && inPerson() ? '' : bug; },
      colourOf: (team) => (team && team === S.homeTeam ? sideColours('home', team) : team && team === S.awayTeam ? sideColours('away', team) : null),
    };
  }
  function mount() {
    if (mounted || flat) return !flat;
    host.innerHTML = shell();
    addFullscreenButton(host.querySelector('.gds-park'), host);
    addCamButton(host.querySelector('.gds-park'));
    canvas = host.querySelector('.gds-canvas');
    size();
    // `opts.renderer` stands in for the GL park (the gates' recording renderer)
    R = (opts.renderer || mods.createBallparkRenderer)(canvas, { ads: opts.ads || ADS, preserve: !!opts.preserve, crowd: opts.crowd, grade: opts.grade, tube: opts.tube, onAsset: () => draw() });
    seatFrom = null;   // a new renderer has nobody moved out of a seat yet
    if (!R) { fallback('no WebGL2 or float target'); return false; }
    R.setSkyField?.(skyField);
    mounted = true;
    // a box's suite round the seat (gl/booth-mesh.js); its layout goes back to whoever walks in it
    if (opts.room) opts.onRoom?.(R.setRoom?.(opts.room) || null);
    gov = mods.createGovernor(mods.rungsFor(opts.tier || screenTier()));
    if (R.quality) Object.assign(R.quality, gov.quality);
    govAt = 0;
    size();
    W = mods.createWorld();
    D = mods.createDirector(W, { onLand: () => landPlay(cur), emit: fromDirector, pitchShot: () => pitchCam });
    roar = mods.createRoar();
    snd = mods.createParkSound({ win, state: () => ({ p: cur?.p || last, S }), seat: opts.seat || null, announcer: opts.announcer || null });
    hud = mods.hud.createHud(host.querySelector('.gds-hud'), {
      theme: theme(true),
      project: (p, w, h) => mods.project(view(), w, h, p),
      safe: () => !!R?.quality?.tube,
      motion: () => !prefersReducedMotion(),
    });
    // a box's own screen carries the broadcast's graphics, the whole set, painted on a canvas the
    // size of its picture kept out of sight, and laid over the picture each time it's drawn (renderTv)
    if (opts.room) {
      const box = doc.createElement('div');
      box.style.cssText = 'position:absolute;left:-10000px;top:0;width:640px;height:360px;visibility:hidden;pointer-events:none';
      box.innerHTML = '<canvas aria-hidden="true"></canvas>';
      host.appendChild(box);
      tvCanvas = box.firstChild;
      tvHud = mods.hud.createHud(tvCanvas, { theme: theme(), dpr: 1, project: (p, w, h) => mods.project(directed(), w, h, p), motion: () => !prefersReducedMotion() });
    }
    const box = host.querySelector('.gds-park');
    if (win?.ResizeObserver && box) { ro = new win.ResizeObserver(() => { if (size()) draw(); hud?.paint(); }); ro.observe(box); }
    // the city round the park: the venue this browser holds, then any newer one the server sends
    setCity();
    unVenue = onVenue((sport) => { if (sport === 'baseball') { setCity(); draw(); } });
    unClubs = onClubs((sport) => { if (sport === 'baseball') redress(); });
    return true;
  }
  function setCity() {
    const v = opts.venue || venueOf('baseball');
    if (!v || !R) return;
    try { R.setVenue(v); } catch (err) { console.warn('[grandstand] the city round the park would not build:', err && err.message); }
  }
  // The tier this screen starts on: a phone's (a coarse pointer and a short side under 600 CSS
  // pixels) or the full one, unless the player's asked GLASS for the full tier anyway.
  function screenTier() {
    let coarse = false, stored = null;
    try { coarse = !!win?.matchMedia?.('(pointer: coarse)')?.matches; } catch { /* no media queries */ }
    try { stored = win?.localStorage?.getItem('architect_gl_tier') ?? null; } catch { /* no storage */ }
    return mods.parkTier({ coarse, shortSide: Math.min(win?.screen?.width || 0, win?.screen?.height || 0), stored });
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
    if (R.pending() && R.pump(14)) { lastNow = now; govAt = 0; draw(); return; }
    if (live) {
      // a final's last out holds still a moment before the champions' finish
      const dt = Math.min(0.25, Math.max(0, (now - (lastNow || now)) / 1000)) * speed * (now < frozenUntil ? 0 : 1);
      acc += dt;
      while (acc >= mods.DT) { W.step(mods.DT); acc -= mods.DT; }
      // the park's sounds, from what the live world did this frame
      const loud = roar.at(W.t);
      snd?.hear(W, { fx: D.fx, roar: loud });
      if (replayDue && W.t >= replayDue.at) startReplay();
      // a replay plays its own world, slower; the live one carries on behind it
      const RW = replay ? replay.W : W;
      if (replay && !replay.still) {
        replay.acc += dt * mods.REPLAY.rate;
        while (replay.acc >= mods.DT && RW.t < replay.to) { RW.step(mods.DT); replay.acc -= mods.DT; }
      }
      // The picture is drawn at the frame's own time, between the world's steps: the poses, the
      // ball and the camera are all functions of time, so only what's queued waits for a step. A
      // replay at 0.4 drawn on whole steps would hold every fifth frame at 60 fps.
      const tR = drawT();
      // each pose carries the body's own weight as it's drawn (diamond/secondary.js), the replay's
      // men on their own, since they're other bodies in the same slots
      const sec = replay ? (settleR ??= mods.createSettle()) : (settle ??= mods.createSettle());
      const posed = new Set();
      for (const b of RW.bodies.values()) { const P = RW.pose(b.slot, tR); if (P) { R.setPose(b.slot, sec.settle(b.slot, P, tR)); posed.add(b.slot); } }
      // whoever nothing's playing breathes where he stands
      R.idle?.(tR, posed);
      // the ball, and where it was half a 60 Hz frame of the screen's time before, for its smear
      const shutter = BALL_SHUTTER * speed * (replay ? mods.REPLAY.rate : 1);
      R.setBall(RW.ballAt(tR), shutter > 0 ? RW.ballAt(tR - shutter) : null);
      R.setBats?.(RW.batsAt(tR));
      R.setSpectacle?.(replay ? replay.D.fx : D.fx, tR);
      // the fans move by how stirred they are, which follows the noise and settles before it does
      R.setCrowd?.(roar.stir(replay ? W.t : tR), replay ? W.t : tR, !calm);
      R.setTime?.(tR);
      if (marks.length) { R.markDirt?.(marks); marks = []; }
      dragFrame();
      if (replay && (replay.still ? W.t >= replay.until : RW.t >= replay.to - 1e-9)) endReplay();
    }
    lastNow = now;
    // the governor, on frames that run back to back: a rung's quality goes to the renderer, and a
    // new resolution to the canvas just below
    // A rung that changes how the field's lit (how many towers cast, whether the stands and roof
    // do) waits for the play in flight to land, so the light never jumps mid-play; the rest goes now.
    if (live && govAt && gov) { const q = gov.frame((now - govAt) / 1000); if (q) govNext = q; }
    if (govNext && R.quality) {
      const relight = govNext.shadows !== R.quality.shadows || govNext.stands !== R.quality.stands;
      if (!relight || !cur || cur.landed) { Object.assign(R.quality, govNext); govNext = null; }
    }
    govAt = live ? now : 0;
    size();
    // the suite's big screen: the director's shot drawn on its own every few frames (renderTv)
    const tvMode = opts.seat?.mode === 'tv';
    // the graphics move between your eyes and the box's screen as you put it up full size
    if (opts.room && tvMode !== tvWas) { tvWas = tvMode; paintHud(); }
    // with no ballgame the screen carries another picture instead (opts.tvSource, the hockey)
    if (R.room && !tvMode && (tvFrame++ % TV_EVERY) === 0) { if (opts.tvSource) R.setTvImage?.(opts.tvSource()); else R.renderTv(directed(), tvCanvas); }
    if (!R.render(view(), { room: !tvMode }) && R.lost) { fallback('the WebGL context was lost'); return; }
    // on to the next frame while the at-bat plays or a replay's due or playing; once everyone's
    // at rest the last one stays up. A stopped clock draws only when something asks. A seat in the
    // stands never rests: you're sitting in the park, so the clock runs on between plays and the
    // birds, the crowd, the players breathing and the city's lights keep moving.
    if (live && (opts.seat || D.busy() || replayDue || replay || W.t < flyUntil)) { if (speed > 0) draw(); }
    else { live = false; govAt = 0; }
    // the roof rolling over the park keeps the picture going until it's there
    // (and a seat looking up at it keeps going until it's looked back down)
    if (!raf && (R.roof?.moving || seatLift > 0.01)) draw();
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
  // A long lens in a well drifts a little in its operator's hands (diamond/camera.js handheld),
  // except with reduced motion.
  const directed = () => (mods && shot && typeof shot === 'object' ? mods.shotAt(shot, drawT()) : mods && !calm && !prefersReducedMotion() ? mods.handheld(shot, drawT()) : shot);
  // a seat on 'tv' is a suite's big screen at full size: the director's picture, no seat under it
  const view = () => (opts.seat && mods && opts.seat.mode !== 'tv' ? seatShot(opts.seat, directed()) : directed());
  let tvFrame = 0;
  const TV_EVERY = 3;
  // A SEAT IN THE STANDS (stands.js): the eye bolted to `seat.eye`, in the field's feet. Following,
  // it turns to what the director's shot looks at, eased so a cut is a turn of the head; free, it
  // looks where the viewer turned it (`seat.yaw`, radians from +z toward +x, `seat.pitch` up
  // positive). Following writes its heading back, so free look starts where you were looking.
  // The seat's eye is the ticket's, moved onto the nearest seated fan's place, whose seat the
  // renderer then leaves empty (gl/ballpark.js seatFor); a box's suite walks its own eye.
  let seatAt = null, seatClock = 0, seatLift = 0, seatFrom = null, seatEye = null;
  // how far up (radians) a following seat looks while the roof is moving
  const ROOF_LOOK = 0.7;
  function seatShot(s, d) {
    if (s.eye !== seatFrom) { seatFrom = s.eye; seatEye = !opts.room && R?.seatFor ? R.seatFor(s.eye) || s.eye : (R?.seatFor?.(null), s.eye); }
    const base = typeof d === 'string' ? mods.SHOTS[d] || mods.SHOTS.high : d || mods.SHOTS.high, eye = seatEye;
    const now = win?.performance?.now?.() ?? Date.now(), dt = seatClock ? Math.min(0.1, (now - seatClock) / 1000) : 0;
    seatClock = now;
    if (s.mode !== 'free') {
      const k = !seatAt || !(dt > 0) ? 1 : 1 - Math.exp(-dt * 4);
      seatAt = seatAt ? seatAt.map((v, i) => v + (base.at[i] - v) * k) : [...base.at];
      const q = [seatAt[0] - eye[0], seatAt[1] - eye[1], seatAt[2] - eye[2]];
      s.yaw = Math.atan2(q[0], q[2]); s.pitch = Math.atan2(q[1], Math.hypot(q[0], q[2]));
      // while the roof rolls, the whole park looks up at it, and so does the seat: the head comes
      // up to ROOF_LOOK and back down to the play once it's there
      const goal = R?.roof?.moving ? 1 : 0;
      seatLift += (goal - seatLift) * (!(dt > 0) ? 1 : 1 - Math.exp(-dt * 1.5));
      s.pitch += Math.max(0, ROOF_LOOK - s.pitch) * seatLift;
    } else { seatAt = null; seatLift = 0; }
    const cp = Math.cos(s.pitch || 0), at = [eye[0] + Math.sin(s.yaw || 0) * cp * 100, eye[1] + Math.sin(s.pitch || 0) * 100, eye[2] + Math.cos(s.yaw || 0) * cp * 100];
    return { eye, at, fov: Math.max(12, Math.min(90, s.fov || 50)), shadow: base.shadow, ...(s.near ? { near: s.near } : {}) };
  }
  // The time the picture is drawn at: the world's last step and what's left over toward the next
  // (the replay's, capped at its end, while one plays).
  function drawT() {
    if (replay) return replay.still ? replay.W.t : Math.min(replay.to, replay.W.t + Math.min(replay.acc, mods.DT));
    return W ? W.t + (live ? Math.min(Math.max(acc, 0), mods.DT) : 0) : 0;
  }

  // ── replays ───────────────────────────────────────────────────────────────
  // The play staged again in its own world and played slower from its second camera, or with
  // reduced motion held still on its moment, under the REPLAY bug; then back to the live camera.
  function startReplay() {
    const due = replayDue;
    replayDue = null;
    replay = mods.stageReplay(due.p, due.spec, { cast: due.cast, motion: !due.calm });
    if (!replay) return;
    replay.acc = 0;
    settleR?.reset();
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
    dressed = { cast, teams: { home: top ? p.fieldingTeam : p.battingTeam, away: top ? p.battingTeam : p.fieldingTeam } };
    R?.setCast(dressed.cast, dressed.teams);
    dressFans();
    return cast;
  }
  // the fans in the two clubs' colours (gl/crowd.js): the colour each side wears on the graphics
  function dressFans() {
    const t = dressed?.teams;
    if (t) R?.setFanColours?.(linear(sideColours('home', t.home)[0]), linear(sideColours('away', t.away)[0]));
  }
  // A club's kit arriving (club-crest.js) dresses the side on now in it, and its colours
  // go on the graphics.
  function redress() {
    if (dressed && R) { R.setCast(dressed.cast, dressed.teams); dressFans(); }
    paintHud(); draw();
  }
  // The camera button, beside the full-screen one: the pitches from behind the batter or from behind
  // the pitcher. A pitch on screen now cuts to the other at once; the next at-bat is shot from it.
  function addCamButton(into) {
    if (!into || !doc) return;
    const btn = doc.createElement('button');
    btn.type = 'button'; btn.className = 'gds-cam';
    const paintBtn = () => {
      btn.innerHTML = CAM_ICON;
      btn.title = pitchCam === 'cf' ? 'Watching from behind the pitcher (switch to the batter)' : 'Watching from behind the batter (switch to the pitcher)';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', String(pitchCam === 'cf'));
    };
    paintBtn();
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pitchCam = pitchCam === 'cf' ? 'bat' : 'cf';
      try { win?.localStorage?.setItem(CAM_KEY, pitchCam); } catch { /* no storage: this session only */ }
      paintBtn();
      if (!opts.shot && (shot === 'bat' || shot === 'cf')) setShot(pitchCam);
    });
    into.appendChild(btn);
  }
  function readCam() { try { return win?.localStorage?.getItem(CAM_KEY) === 'cf' ? 'cf' : 'bat'; } catch { return 'bat'; } }
  function stopLoop() { if (raf && win) win.cancelAnimationFrame(raf); raf = 0; }
  function setShot(s) { shot = s; draw(); paintHud(); }

  // What the graphics show now (diamond/hud.js layoutHud says the shape). Before the first
  // payload there's no game to show, only a card the broadcast throws (the pre-game matchup).
  function hudState() {
    if (!S.half) return S.splash ? { splash: S.splash, gold: S.gold } : null;
    return {
      score: { away: S.away, home: S.home, aScore: S.aScore, hScore: S.hScore, half: S.half, inning: S.inning, bases: S.bases, awayTeam: S.awayTeam, homeTeam: S.homeTeam },
      count: { balls: S.balls, strikes: S.strikes, outs: S.outs },
      pitch: S.pitch, pitches: S.pitches, bats: S.bats, zone: (shot === 'bat' || shot === 'cf') && !!S.pitch,
      matchup: S.matchup, steal: S.steal, dist: S.dist, splash: S.splash, gold: S.gold, replay: S.replay,
      final: S.final, intro: S.intro, champ: S.champ,
      leaders: S.tableRace ? { race: S.tableRace, rows: S.leaders?.[S.tableRace] || [], season: S.seasonN, foot: S.tableFoot } : null,
    };
  }
  // A seat in the stands is in the park, not watching the broadcast: none of its splash words,
  // cards, pitch zone or replays go up over the picture, only the score and the count.
  function paintHud() {
    const h = hudState();
    // the box's screen gets the lot; in person in the box the graphics are on that screen, not
    // over your eyes, and on the screen full size (T) they're the broadcast's again
    tvHud?.set(h && { ...h });
    if (opts.room) { hud?.set(inPerson() ? null : h); return; }
    if (h && opts.seat) Object.assign(h, { splash: null, matchup: null, steal: null, dist: null, replay: false, intro: null, champ: null, final: null, leaders: null, zone: false });
    hud?.set(h);
  }
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
    const said = /^(.+?) says, "([\s\S]*)"$/.exec(String(text || ''));
    capWho = said ? said[1] : anchorWho || capWho;
    caption = said ? said[2] : String(text || '');
    const tag = host && host.querySelector('.gds-cap-tag');
    if (tag) tag.textContent = '◆ ' + capWho;
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
    // the play's own sting, the announcer's call and the crowd's word on it
    snd?.land(p);
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
    // the last out of a final crowns the champions, and that's all its dead time is
    if (p.end?.champion) { crown(c); return; }
    // a big play gets its replay once the line's up and any fireworks are out (it would hide
    // them), and a home run's once the batter's round the bags and off the plate (the director's
    // trot, D.homer), if the hold has room for it before the next payload's due: a payload that
    // doesn't say how long it holds gets none, and a home run on a short one keeps its trot
    const spec = c.cast && D.play && !inPerson() ? mods.replayOf(p, D.play, D.log) : null;
    let replayEnd = null;
    if (spec && Number.isFinite(p.hold)) {
      const calm = prefersReducedMotion(), long = calm ? mods.REPLAY.still : (spec.to - spec.from) / mods.REPLAY.rate;
      const at = Math.max(W.t + mods.REPLAY.after, D.homer?.until ?? -Infinity, ...(D.fx || []).filter((e) => e.kind === 'burst').map(mods.fxEnd));
      if (at + long <= c.t0 + p.hold / 1000 - REPLAY_MARGIN) { replayDue = { at, spec, p, calm, cast: c.cast }; replayEnd = at + long; }
    }
    // and the dead time till the next payload's due (diamond/between.js): the field walks back, the
    // pitcher rubs up the ball and the cameras go round the park, once any replay's done
    // In person the field gets all the time it needs, and the next payload waits for it.
    const near = inPerson(), was = D.until || W.t;
    const until = Number.isFinite(p.hold) ? c.t0 + p.hold / 1000 : null;
    const B = until != null && c.cast ? D.planBetween?.({ until: near ? Math.max(until, W.t + PARK_ROOM) : until, from: replayEnd != null ? replayEnd + 0.3 : undefined }) : null;
    if (near) parkHold = PARK_BEAT + (B ? Math.max(B.from, ...B.gone.map((g) => Math.max(g.end, g.visit?.until ?? 0, g.argue?.until ?? 0, g.scrum?.until ?? 0))) : was);
  }
  // What the director says as it stages: a cut to another camera, a sound on its moment, and each
  // pitch as it's decided, for the count, the speed and the zone (the count never shows a fourth
  // ball or a third strike).
  function fromDirector(name, d) {
    if (name === 'shot') { liveShot = d; if (!opts.shot && !replay) setShot(d); return; }
    if (name === 'sound') {
      sfx(d);
      // the booth's call at the crack, in words too
      if (d === 'crack' && cur && mods.crackPitch(cur.p, cur.cracks = (cur.cracks || 0) + 1)?.result === 'inplay' && cur.p.contact?.text) say(cur.p.contact.text);
      return;
    }
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
    S.pitch = q; S.pitches = (cur.p.pitches || []).slice(0, d.i + 1);
    paint();
    say(pitchText(q, last));
  }
  // The play landed: the held line and any held card go up now.
  function land() {
    playing = false;
    // the booth's line waits for the announcer's call, if he made one
    if (pendingCaption) { const p = pendingCaption; pendingCaption = null; showCaption(p.text); if (p.speak) (snd ? snd.afterCall(p.speak) : p.speak()); }
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
    if (p.season) {
      S.seasonN = p.season.n ?? null; S.gold = p.season.phase === 'final';
      // a final: its name and the seeds go up with the score, and the park's dressed for it
      S.final = S.gold ? { name: p.season.name || 'Final', seeds: { away: p.season.seedAway ?? null, home: p.season.seedHome ?? null } } : null;
      R?.setFinal?.(S.final);
      if (!S.final) S.champ = null;
    }
  }
  // Before a final's first pitch: searchlights over the city, the organ's anthem, and the public
  // address reading both line-ups, a card a man, the visitors first, as many as the hold has room
  // for. Returns whether it ran (the leaders' table gives way to it).
  function introduce(p) {
    const L = p.season?.lineups;
    if (!S.final || !L || (p.inning | 0) !== 1 || p.half !== 'top') return false;
    const until = Number.isFinite(p.hold) ? p.hold : 30000;
    const cards = [];
    for (const side of ['away', 'home']) {
      const T = L[side];
      if (!T) continue;
      (T.lineup || []).forEach((name, k) => cards.push({ team: T.team, side, i: k + 1, n: 9, name, num: mods.numberOf(name) }));
    }
    const fit = Math.max(1, Math.floor((until - 3000) / INTRO_CARD_MS));
    cards.slice(0, fit).forEach((it, k) => later(800 + k * INTRO_CARD_MS, () => {
      S.intro = it; paintHud(); say(mods.hud.introSaid(it)); snd?.introduce(it);
    }));
    later(800 + Math.min(fit, cards.length) * INTRO_CARD_MS, () => { S.intro = null; paintHud(); });
    D.fx = [...(D.fx || []), ...mods.planSearchlights({ from: W.t + 0.5, to: W.t + until / 1000 - 1, motion: !calm })];
    D.until = Math.max(D.until || 0, W.t + until / 1000 - 0.5);
    snd?.anthem();
    return true;
  }
  // The last out of a final: the frame held a moment, then the champions' word, their card, the
  // trophy out by the mound, confetti off the upper deck, fireworks over the outfield and the city,
  // and the champions piling on (director.js planPile) till the next payload's due.
  function crown(c) {
    const p = c.p, e = p.end, side = e.winner === S.homeTeam ? 'home' : 'away';
    frozenUntil = (win?.performance?.now?.() ?? Date.now()) + FINAL_HOLD_MS;
    const t = W.t + FINAL_HOLD_MS / 1000;
    const score = `${S.awayTeam} ${S.aScore | 0}, ${S.homeTeam} ${S.hScore | 0}`;
    later(FINAL_HOLD_MS, () => {
      R?.setChampion?.(true);
      hold('splash', { kind: 'champion', word: 'CHAMPIONS!' }, OWN_SPLASH_MS);
      hold('champ', { team: e.winner, side, name: e.name || S.final?.name, score, mvp: e.mvp || null }, CHAMP_MS);
      say(mods.hud.champSaid(S.champ));
    });
    const fx = mods.planChampion({ t, colour: linear(sideColours(side, side === 'home' ? S.homeTeam : S.awayTeam)[0]), motion: !calm, seed: (p.inning | 0) * 977 + (S.hScore | 0) * 31 + (S.aScore | 0) });
    D.fx = [...(D.fx || []), ...fx];
    D.until = Math.max(D.until || 0, ...fx.map(mods.fxEnd));
    parkHold = D.until + PARK_BEAT;
    roar.cheer(side === 'home' ? 0 : 1, 1, t, 8);
    if (Number.isFinite(p.hold) && c.cast) D.planPile?.({ from: t + 0.3, until: c.t0 + p.hold / 1000 });
  }
  // "Live from" the park: the game's first line. The camera comes in high over the city and down
  // onto the park, landing on the main gate from the street with the crowd going in (the wide shot
  // over the outfield with no city round it), and the venue's name goes up over the picture. With
  // reduced motion it cuts straight to the gate. Nobody's on the field yet; the season this first
  // payload carries dresses the park for a final.
  function arrive(p, pend) {
    if (p.season) sides({ ...p, half: '' });
    // before the game: no score, count or bags on the graphics yet
    Object.assign(S, { half: '', inning: 0, awayTeam: p.away || S.awayTeam, homeTeam: p.home || S.homeTeam });
    dropHolds();
    calm = prefersReducedMotion();
    const to = R?.streetCam || (R?.city ? 'street' : 'sky');
    // from a seat you're already in the park: no flight in over the city
    shot = opts.shot || (opts.seat ? 'high' : calm ? to : mods.approachShot(to, W.t));
    flyUntil = calm || opts.seat ? 0 : W.t + mods.APPROACH.dur + 1;
    live = true; acc = 0;
    letterArrive(p);
    say(`Live from ${p.venue || 'the park'}${p.final ? `, for the ${p.final}` : ''}.`);
    pendingCaption = null;
    if (pend) { showCaption(pend.text); pend.speak?.(); }
    paint();
  }
  // The venue's name over the picture, the way a network opens a game: LIVE, then where from, and a
  // final's name under it. Up a beat into the fly-in and down a while after it's landed.
  function letterArrive(p) {
    const park = host?.querySelector('.gds-park');
    if (!park || !p.venue) return;
    park.querySelector('.gds-arrive')?.remove();
    const el = doc.createElement('div');
    el.className = `gds-arrive${p.final ? ' final' : ''}`;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<div class="gds-arrive-tag"><i></i>LIVE</div><div class="gds-arrive-from">from</div>` +
      `<div class="gds-arrive-venue">${_esc(p.venue)}</div>${p.final ? `<div class="gds-arrive-sub">${_esc(p.final)}</div>` : ''}`;
    park.appendChild(el);
    // its own clocks, not `later`'s: the next payload clears those, and the name stays up its time
    const at = (ms, fn) => (win || globalThis).setTimeout(fn, ms);
    at(calm ? 0 : 1500, () => el.classList.add('in'));
    at((calm ? 6 : mods.APPROACH.dur + 4) * 1000, () => { el.classList.remove('in'); at(800, () => el.remove()); });
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
    // the last play's call, if it's still waiting on that play, goes up now: never on this one
    if (pendingCaption?.call) flushCaption();
    stopTimers(); stopTable(); stopWorld();
    snd?.payload(p);
    const pend = pendingCaption;
    freshGame(p);
    // the sky at the minute the line aired (diamond/sky.js), a payload without one at night, and the
    // weather over the park as it aired (diamond/weather.js), its lightning not flashing for a
    // viewer who's asked for less motion
    R?.setHour?.(Number.isFinite(p.clock) ? p.clock / 60 : null);
    R?.setMoon?.(Number.isFinite(p.moon) ? p.moon : null);
    R?.setWeather?.(p.wx || null, { flash: !prefersReducedMotion() });
    // and the park's roof as it was when the line aired (1 shut, 0 open), which rolls over the map's
    // ninety seconds when it changes; a payload without one leaves it where it is
    if (p.roof != null) { R?.setRoof?.(p.roof); draw(); }
    if (p.phase === 'arrive') { arrive(p, pend); return; }
    const cast = castFor(p);
    S.pitch = null; S.pitches = []; S.bats = p.bats || '';
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
      parkHold = (D.until || W.t) + PARK_BEAT;
      paint();
      if (!introduce(p) && !startTable(p)) renderCard({ kind: 'half', inningOrd: p.inningOrd, half: p.half, batting: p.battingTeam, duration: 3.4 });
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
    parkHold = Infinity;
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
      R?.setEmpty?.(false);
      stage(p);
    };
    if (mods) go(); else loadMods().then(go).catch((err) => fallback(err && err.message));
  }
  // The booth's line. Not held, it goes up and is spoken at once (talk between plays, and talk over
  // the pitches). Held, it's a play's call and waits for the play to land: either it comes just
  // before its payload (the old shape), or, with `o.call`, after a payload that rode the plate
  // appearance's first line (`p.lead`), when it waits for that play if it's still in the air and
  // goes up at once if it's landed. A call never waits for the next play: one still pending when
  // the next payload comes goes up as it's staged.
  function setCaption(text, o) {
    if (o && o.who) anchorWho = o.who;
    if (flat) { flat.setCaption(text, o); return; }
    const speak = o && o.speak;
    if (o && o.held && o.call) {
      if (cur && !cur.landed) {
        if (pendingCaption) flushCaption();
        pendingCaption = { text: String(text || ''), speak, call: true };
      } else { showCaption(text); speak?.(); }
      return;
    }
    // A play's line comes just before its payload. One that comes while the last play is still
    // in the air (frames stopped in a hidden tab) lands that play first, so its line isn't lost.
    if (o && o.held && pendingCaption && cur && !cur.landed) landPlay(cur);
    if (o && o.held) pendingCaption = { text: String(text || ''), speak };
    else { showCaption(text); speak?.(); }
  }
  // A pending line up and spoken now.
  function flushCaption() {
    const p = pendingCaption;
    pendingCaption = null;
    if (p) { showCaption(p.text); p.speak?.(); }
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
      if (!last) { R?.setEmpty?.(true); shot = opts.shot || 'high'; paint(); }
      // in a box's suite nobody needs telling: the room is the thing to look at till the game starts
      if (opts.room || host.querySelector('.gds-idle')) return;
      const veil = doc.createElement('div');
      veil.className = 'gds-idle';
      veil.innerHTML = `<div class="gds-idle-title">DEADBALL</div><div class="gds-idle-sub">Waiting for the first pitch…</div>`;
      host.querySelector('.gds-park')?.appendChild(veil);
    };
    if (mods) go(); else loadMods().then(go).catch((err) => fallback(err && err.message));
  }
  function clear() {
    if (flat) { flat.clear(); flat = null; }
    parkQueue = []; clearInterval(parkTimer); parkTimer = null; parkHold = 0;
    stopTimers(); stopLoop(); stopTable(); dropHolds(); stopWorld();
    unVenue?.(); unVenue = null; unClubs?.(); unClubs = null; dressed = null;
    ro?.disconnect(); ro = null;
    try { R?.dispose(); } catch { /* already gone */ }
    hud?.dispose(); tvHud?.dispose(); tvHud = null; tvCanvas = null; tvWas = null;
    snd?.dispose(); snd = null;
    leaveFullscreen(host);
    if (host) host.innerHTML = '';
    R = null; hud = null; canvas = null; mounted = false; W = null; D = null;
    last = null; caption = ''; pendingCaption = null; pendingCard = null; playing = false; shown = null; marks = []; dirtGame = null;
  }

  // the day's weather cells (a seat's `field`), which the 3-D park draws overhead; kept for a
  // renderer that mounts after it arrives (skyField, declared with R)
  function setSkyField(f) { skyField = f || null; R?.setSkyField?.(skyField); }

  // ── in person ─────────────────────────────────────────────────────────────
  // The broadcast's calls, in the order they came, held while the field's still coming back. A
  // play's line comes before its payload, so it waits with it; the frames stopping (a hidden tab)
  // or too long a queue lets them through as they'd have gone.
  const parkWaits = () => {
    if (!inPerson() || !W || flat) return false;
    if ((win?.performance || performance).now() - lastNow > LAND_SLACK_MS) return false;
    return W.t < parkHold || (cur && !cur.landed);
  };
  function parkDrain() {
    const over = parkQueue.filter((q) => q[0] === apply).length > PARK_BACKLOG;
    while (parkQueue.length && (over || !parkWaits())) {
      const [fn, args] = parkQueue.shift();
      fn(...args);
      if (fn === apply && !over) break;   // its play goes on before anything after it
    }
    if (!parkQueue.length) { clearInterval(parkTimer); parkTimer = null; }
  }
  const inLine = (fn) => (...args) => {
    if (!parkQueue.length && !parkWaits()) return fn(...args);
    parkQueue.push([fn, args]);
    parkTimer ??= setInterval(parkDrain, PARK_POLL_MS);
  };

  return {
    apply: inLine(apply), clear, setCaption: inLine(setCaption), showIdle, showCard: inLine(showCard), setSkyField,
    // for the sandbox and the gates
    setShot, ready: () => loadMods(),
    get renderer() { return R; }, get hud() { return hud; }, get flat() { return flat; }, get state() { return S; },
    get world() { return W; }, get director() { return D; }, get shot() { return shot; }, get replay() { return replay; }, get replayDue() { return replayDue; },
    get speed() { return speed; }, set speed(k) { speed = Math.max(0, Number(k) || 0); draw(); },
    // the governor's rung (0 the tier as it started) and how many there are
    get rung() { return gov ? gov.rung : 0; }, get rungs() { return gov ? gov.rungs : 0; },
    redraw: () => draw(),
    // a point in the field's feet to the view's pixels ({ x, y, d } or null behind the eye)
    project: (pt, w, h) => (mods ? mods.project(view(), w, h, pt) : null),
    busy: () => playing || live || !!replayDue || !!replay,
  };
}
