// GATE · THE COMIC REPLAY (client/game/js/panels/diamond/comic.js).
//
// With the comic look on, a big play's replay runs, freezes on its moment, runs on, and ends on a
// comic page. What has to hold, with no browser: its length is the replay's at REPLAY.rate plus
// the freeze and the page (the grandstand books the slot off it, so a wrong one runs into the
// next payload); the worm's-eye camera is down on the grass, on the field and looking at the
// moment; the panels are taken in order inside the replay's window; every kind of replay has its
// word, the same each time for the same play; the page's panels sit inside the picture without
// overlapping; and the painters draw something at every beat without throwing. Also here: which
// plays earn a replay without a staged play to ask (a big strikeout, a steal), and the videoboard's
// reel (diamond/jumbo.js): taken by the clock, never cut off, and not played out behind a prompt.
//
// No DOM, no GL, no files written.

import { COMIC, COMIC_WORDS, COMIC_CAPTIONS, COMIC_INKS, comicWordOf, comicCaptionsOf, comicHeadlineOf, comicInksOf, comicLength, comicFit, wormShot, followShot, freezeLayout, tellsMore, panelAt, pageLayout, paintFreeze, paintPage, paintRun } from '../../client/game/js/panels/diamond/comic.js';
import { REPLAY, replayOf, anchorOf } from '../../client/game/js/panels/diamond/replay.js';
import { afterLand, AFTER, bigStrikeout } from '../../client/game/js/panels/diamond/timing.js';
import { createJumbo, JUMBO } from '../../client/game/js/panels/diamond/jumbo.js';
import { onField } from '../../client/game/js/panels/diamond/play.js';
import { project } from '../../client/game/js/panels/diamond/camera.js';

let fails = 0;
const check = (ok, what, detail = '') => { if (!ok) { fails++; console.error('✗ ' + what + (detail ? ` (${detail})` : '')); } };

// the length
const spec = { from: -1.1, key: 0, to: 1.3 };
check(Math.abs(comicLength(spec) - ((spec.to - spec.from) / REPLAY.rate + COMIC.freeze + COMIC.page)) < 1e-9, 'comicLength is the slow run plus the freeze and the page');
check(comicLength(spec) > (spec.to - spec.from) / REPLAY.rate, 'a comic replay is longer than a plain one, so it gets a longer slot');
// stepping down: the whole thing, then the freeze without the page, then only the plain replay
check(comicFit(spec, comicLength(spec)) === 'page' && comicFit(spec, comicLength(spec) - 0.01) === 'freeze'
  && comicFit(spec, comicLength(spec, false)) === 'freeze' && comicFit(spec, comicLength(spec, false) - 0.01) === null, 'comicFit steps down from the page to the freeze to nothing');
check(Math.abs(comicLength(spec, false) - (comicLength(spec) - COMIC.page)) < 1e-9, 'the shorter one is the page shorter');

// the worm's-eye camera: at the plate, for each hand; and out on the field, either side
const moments = [[[1.5, 3, 1.2], 'R'], [[-1.5, 3, 1.2], 'L'], [[120, 8, 260], 'R'], [[-180, 6, 200], 'R'], [[-66, 3, 67], 'R'], [[0, 4, 310], 'R']];
for (const [s, bats] of moments) {
  const w = wormShot(s, bats);
  const label = `wormShot(${JSON.stringify(s)}, ${bats})`;
  check(w && w.shot === 'fly' && typeof w.track === 'function', `${label}: a fly shot with a track`);
  if (!w) continue;
  const d = Math.hypot(w.eye[0] - s[0], w.eye[2] - s[2]);
  check(w.eye[1] < 1.5 && d > 6 && d < 20, `${label}: low on the grass, a dozen feet off`, `eye ${w.eye.map((v) => v.toFixed(1))}, ${d.toFixed(1)} ft`);
  check(w.at[1] >= w.eye[1], `${label}: looking up at it`);
  check(Math.hypot(w.track(0)[0] - s[0], w.track(0)[2] - s[2]) < 0.01, `${label}: aimed at the moment`);
  if (Math.hypot(s[0], s[2]) >= 20) check(onField(w.eye, 0), `${label}: standing on the field`);
}
// at the plate, out in front, on the side the batter faces
check(wormShot([1.5, 3, 1.2], 'R').eye[2] > 1.2 && wormShot([1.5, 3, 1.2], 'R').eye[0] < wormShot([1.5, 3, 1.2], 'L').eye[0], 'at the plate: out in front, on the side each hand faces');
check(wormShot(null) === null && wormShot([NaN, 0, 0]) === null, 'no moment, no camera');
check(wormShot([1.5, 3, 1.2]).dof === 0, 'the worm\'s-eye lens is sharp: no blur for the print to ink');

// what follows at the plate: behind the batter's back, low, looking out over him; none out on the field
for (const bats of ['R', 'L']) {
  const f = followShot([1.5, 3, 1.2], bats), side = bats === 'L' ? 1 : -1;
  check(f && f.dof === 0 && f.eye[2] < -8 && f.eye[1] < 5 && f.at[2] > 20 && f.at[1] > f.eye[1], `followShot ${bats}: low behind the plate, looking up and out`, JSON.stringify(f));
  check(f && Math.sign(f.eye[0]) === -side, `followShot ${bats}: off the batter's own shoulder`, JSON.stringify(f?.eye));
  // clear of the umpire and the catcher, who stand on the line behind the plate (x near 0, z -2 to -5):
  // where the line from the eye to the batter crosses z -3.5, it's well out to his side
  const bx = -side * 3.25, k = (f.eye[2] - -3.5) / (f.eye[2] - 0), xAt = f.eye[0] + (bx - f.eye[0]) * k;
  // and he's in the frame, well in from its edge (the cast stands him 3.25 ft off the plate, cast.js)
  for (const [w, h] of [[720, 352], [900, 600]]) {
    const head = project(f, w, h, [bx, 5.8, 0.75]), umpire = project(f, w, h, [0.5, 4, -4]);
    check(head && head.x > w * 0.12 && head.x < w * 0.88 && head.y > 0 && head.y < h, `followShot ${bats} ${w}×${h}: the batter in the frame, in from its edge`, head ? `${(head.x / w).toFixed(2)}, ${(head.y / h).toFixed(2)}` : 'behind');
    check(!umpire || umpire.x < 0 || umpire.x > w, `followShot ${bats} ${w}×${h}: the umpire out of the frame`, umpire ? `${(umpire.x / w).toFixed(2)}` : '');
  }
  check(f && Math.abs(xAt) > 4.5, `followShot ${bats}: the umpire and the catcher aren't between it and the batter`, `${xAt.toFixed(1)} ft off the line behind the plate`);
}
check(followShot([120, 8, 260]) === null && followShot(null) === null, 'followShot: none out on the field');

// the freeze keeps the player clear: the burst beside the ball on his far side, the lines stopping
// short of him, the word in a corner off him and the burst
for (const [w, h] of [[900, 600], [720, 352], [420, 600]]) {
  const S = { x: w * 0.38, y: h * 0.55, r: h * 0.3 }, cx = w * 0.52, cy = h * 0.6, F = freezeLayout(w, h, cx, cy, S, null);
  const toBurst = Math.hypot(F.burst.x - S.x, F.burst.y - S.y), toBall = Math.hypot(cx - S.x, cy - S.y);
  check(toBurst > toBall, `freeze ${w}×${h}: the burst on the far side of the ball from him`, `${toBurst.toFixed(0)} vs ${toBall.toFixed(0)}`);
  check(F.clear >= S.r && F.fc[0] === S.x && F.fc[1] === S.y, `freeze ${w}×${h}: the focus lines close on him and stop short of him`);
  const inWord = (p) => Math.abs(p.x - F.word.x) < Math.min(w * 0.41, h * 0.39) && Math.abs(p.y - F.word.y) < Math.min(w, h) * 0.11;
  check(!inWord(S), `freeze ${w}×${h}: the word isn't on him`, JSON.stringify(F.word));
  check(F.burst.x >= 0 && F.burst.x <= w && F.burst.y >= 0 && F.burst.y <= h, `freeze ${w}×${h}: the burst in the picture`);
}
{
  const F = freezeLayout(900, 600, 450, 300, null, null);
  check(Number.isFinite(F.burst.x) && Number.isFinite(F.word.x), 'freeze with no player known still lays out');
}

// the narration says more than the headline or nothing
check(!tellsMore('Home Run', 'HOME RUN!') && !tellsMore('home run!', 'HOME RUN!') && !tellsMore('Solo shot', 'HOME RUN!'), 'no narration that only repeats the headline or says next to nothing');
check(tellsMore('Cardenas launches it into the dark', 'HOME RUN!'), 'a real line is told');

// the panels: in order, inside the window, the second on the moment
check(panelAt(spec, 0) > spec.from && panelAt(spec, 0) < spec.key && panelAt(spec, 1) === spec.key && panelAt(spec, 2) > spec.key && panelAt(spec, 2) < spec.to, 'panels in order inside the replay, the second on its moment');

// the words
const KINDS = ['homerun', 'walkoff', 'catch', 'robbed', 'doubleplay', 'tripleplay', 'triple', 'close', 'plate', 'caught', 'steal', 'strikeout'];
for (const kind of KINDS) {
  check(Array.isArray(COMIC_CAPTIONS[kind]) && comicCaptionsOf(kind).length === 2, `${kind} has its two captions`);
  const inks = comicInksOf(kind);
  check(Array.isArray(inks) && inks.length === 4 && inks.every((c) => /^#[0-9a-f]{6}$/.test(c)), `${kind} has its four inks`);
}
check(comicInksOf('homerun') === COMIC_INKS.hot && comicInksOf('catch') === COMIC_INKS.cold && comicInksOf('plate') === COMIC_INKS.dust && comicInksOf('nonsense') === COMIC_INKS.hot, 'off the bat is hot, into the glove cold, at a bag dust');
check(comicHeadlineOf('robbed') === 'ROBBED!' && comicHeadlineOf('homerun') === null && comicHeadlineOf('homerun', { kind: 'homerun', rbi: 4 }) === 'GRAND SLAM!', 'the page\'s headline: the comic\'s own, the HUD\'s where it has one, and a grand slam says so');
for (const kind of KINDS) {
  const w = comicWordOf(kind, 'Boothe parks one');
  check(COMIC_WORDS[kind].includes(w), `${kind} has its word`, w);
  check(w === comicWordOf(kind, 'Boothe parks one'), `${kind}: the same play gets the same word`);
}
check(COMIC_WORDS.homerun.includes(comicWordOf('nonsense', 'x')), 'an unknown kind falls back to the home run\'s word');

// the page: three panels inside the picture, none over another, at a phone's and a TV's shape
for (const [w, h] of [[420, 288], [1800, 1230], [900, 1600]]) {
  const L = pageLayout(w, h), P = L.panels;
  check(P.length === 3 && P.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h && p.w > 0 && p.h > 0), `page ${w}×${h}: the panels are inside the picture`);
  const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  check(!over(P[0], P[1]) && !over(P[0], P[2]) && !over(P[1], P[2]), `page ${w}×${h}: no panel over another`);
  check(P[1].w * P[1].h > P[0].w * P[0].h, `page ${w}×${h}: the moment's panel is the big one`);
}

// the painters, on a context that counts what's drawn
const ctx = () => {
  const n = { fill: 0, stroke: 0, text: 0, image: 0 };
  const g = new Proxy({ canvas: { width: 900, height: 600 }, measureText: (t) => ({ width: String(t).length * 20 }) }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'fill' || k === 'fillRect') return () => { n.fill++; };
      if (k === 'stroke' || k === 'strokeRect') return () => { n.stroke++; };
      if (k === 'fillText' || k === 'strokeText') return () => { n.text++; };
      if (k === 'drawImage') return () => { n.image++; };
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { g, n };
};
for (const t of [0, 0.05, 0.3, COMIC.freeze]) {
  const { g, n } = ctx();
  let threw = null;
  try { paintFreeze(g, 900, 600, 450, 300, 'CRACK!', t); paintFreeze(g, 900, 600, NaN, NaN, 'THWACK!', t); } catch (e) { threw = e.message; }
  check(!threw && n.fill > 50 && (t < 0.02 || n.text > 0), `the freeze at ${t}s paints its lines and, once it lands, its word`, threw || JSON.stringify(n));
}
{
  const shot = { width: 720, height: 480 };
  for (const t of [0.05, 0.6, COMIC.page]) {
    const { g, n } = ctx();
    let threw = null;
    try { paintPage(g, 900, 600, [shot, shot, null], 'CRACK!', 'HOME RUN!', t); } catch (e) { threw = e.message; }
    check(!threw && n.fill > 0, `the page at ${t}s paints`, threw || JSON.stringify(n));
    if (t >= COMIC.page) check(n.image === 2 && n.text >= 2, 'the finished page has both shots, a blank, the word and the caption', JSON.stringify(n));
  }
}

// the page the other way round: still inside the picture, the moment on the right
for (const [w, h] of [[420, 288], [1800, 1230]]) {
  const P = pageLayout(w, h, true).panels, Q = pageLayout(w, h).panels;
  check(P.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h), `page ${w}×${h} flipped: the panels are inside the picture`);
  check(P[1].x > P[0].x && Q[1].x < Q[0].x, `page ${w}×${h}: flipped puts the moment on the right`);
}
// the run's frame: its lines, its tag and its note
{
  const { g, n } = ctx();
  let threw = null;
  try { paintRun(g, 900, 600, 0.5, 0, { note: 'Bottom of the 7th' }); paintRun(g, 900, 600, 0.5, 1); } catch (e) { threw = e.message; }
  check(!threw && n.fill > 40 && n.text >= 3, 'the run paints its speed lines, its tag and its note', threw || JSON.stringify(n));
}
// a page in a kind's inks, flipped, with its masthead
{
  const { g, n } = ctx();
  let threw = null;
  try { paintPage(g, 900, 600, [{ width: 720, height: 480 }, { width: 720, height: 480 }, null], 'THWAP!', 'ROBBED!', COMIC.page, { inks: comicInksOf('robbed'), flip: true, issue: 7, at: [0.5, 0.5] }); } catch (e) { threw = e.message; }
  check(!threw && n.text >= 4, 'a flipped page in the cold inks paints its word, its headline and its masthead', threw || JSON.stringify(n));
}

// ── which plays earn one (replay.js replayOf), for the kinds that need no staged play ──
{
  const K = { kind: 'strikeout', outs: 3, basesBefore: [false, true, false], inning: 4, bats: 'L', awayScore: 0, homeScore: 5 };
  const log = [{ catch: { t: 12 }, call: { t: 12.6 } }];
  const spec = replayOf(K, null, log);
  check(spec && spec.kind === 'strikeout' && spec.shot === 'sideL' && spec.bare && spec.from < 0 && spec.key === 0 && spec.to > 1 && spec.to - spec.from <= REPLAY.span, 'strike three to end an inning with a man on earns a replay, through the call, from the side he faces', JSON.stringify(spec));
  check(replayOf({ ...K, outs: 2 }, null, log) === null && replayOf({ ...K, basesBefore: [false, false, false] }, null, log) === null, 'an ordinary strikeout earns none');
  check(replayOf({ ...K, basesBefore: [], inning: 9, awayScore: 4 }, null, log)?.kind === 'strikeout', 'nor does it need a man on in a close game\'s ninth');
  check(anchorOf({ contact: { t: 3 }, catch: { t: 9 } }) === 3 && anchorOf({ catch: { t: 9 } }) === 9 && Number.isNaN(anchorOf({})), 'a replay\'s times count from the bat, or with no contact from the mitt');
  // the server leaves these the replay's room (timing.js), and no other strikeout
  check(bigStrikeout(K) && afterLand(K) === AFTER.replay + AFTER.reset && afterLand({ ...K, outs: 2 }) === AFTER.reset, 'the server leaves a big strikeout room for its replay');
  check(afterLand({ phase: 'run', kind: 'caughtstealing' }) === AFTER.replay + AFTER.reset && afterLand({ phase: 'run', kind: 'steal' }) === AFTER.reset, 'and a man thrown out stealing');
  // on the bases: thrown out always, safe only when the tag nearly had him
  const plan = (touch) => ({ log: { throw: { catch: { t: 14 } }, tag: { t: 14.1 }, runners: [{ touch }] } });
  const run = { phase: 'run', kind: 'caughtstealing', base: 2 }, rl = [{ catch: { t: 12 } }];
  const c = replayOf(run, plan(14.2), rl);
  check(c && c.kind === 'caught' && c.shot === 'bag' && Math.abs(c.key - 2) < 1e-9, 'a man thrown out stealing earns one at his bag, on the throw arriving', JSON.stringify(c));
  check(replayOf({ ...run, kind: 'steal' }, plan(14.0), rl)?.kind === 'steal' && replayOf({ ...run, kind: 'steal' }, plan(13.8), rl) === null, 'a steal earns one only when the tag nearly had him');
  check(replayOf({ ...run, kind: 'steal', base: 3 }, plan(14.0), rl)?.shot === 'third' && replayOf({ phase: 'run', kind: 'wildpitch' }, plan(14), rl) === null, 'at third from third\'s camera, and nothing else on the bases');
}

// ── the videoboard (diamond/jumbo.js) ──
{
  const canvasOf = () => { const c = { width: 0, height: 0 }; const x = ctx().g; x.canvas = c; c.getContext = () => x; return c; };
  const doc = { createElement: () => canvasOf() };
  let ups = 0;
  const J = createJumbo({ doc, upload: () => { ups++; } });
  const src = { width: 1280, height: 720 };
  // a thirteen-second replay at 60 frames a second: all of it kept, never more than maxFrames
  J.recordStart('homerun', 'KRAKK!');
  let took = 0;
  for (let i = 0; i <= 13 * 60; i++) { const was = J.due(i / 60); J.record(src, null, i / 60); if (was) took++; J.tick(i / 60, {}); }
  check(J.recording && J.showing === 'replay', 'the board shows a replay while it\'s taken');
  check(took >= 13 * JUMBO.take * 0.9 && took <= JUMBO.maxFrames, 'a replay is taken by the clock: about JUMBO.take a second through all thirteen seconds, however fast the screen', `${took} frames`);
  // a longer one is thinned, never cut off
  J.recordStart('homerun', '');
  for (let i = 0; i <= 40 * 30; i++) J.record(src, null, 100 + i / 30);
  let last = 0;
  for (let t = 138; t < 140.5; t += 1 / 60) { if (J.due(t)) last = t; J.record(src, null, t); }
  check(last > 139.5, 'a replay longer than the reel is thinned and taken on, not stopped', `last frame wanted at ${last.toFixed(2)} s`);
  // it plays again after a prompt that was up when it ended: the prompt doesn't run its loops out
  J.prompt('homerun', 141, 4);
  J.recordEnd();
  for (let t = 141; t < 145; t += 1 / 30) J.tick(t, {});
  check(J.showing === 'prompt' || J.showing === 'replay', 'a prompt goes over the replay');
  J.tick(145.1, {});
  let shown = 0;
  for (let t = 145.2; t < 150; t += 1 / 30) { J.tick(t, {}); if (J.showing === 'replay') shown++; }
  check(shown > 60, 'the replay plays again once the prompt\'s done, not behind it', `${shown} ticks`);
  for (let t = 150; t < 400; t += 1 / 10) J.tick(t, {});
  check(J.showing === 'score' && ups > 10, 'and the score comes back after its loops');
  // the score repaints when the clubs\' colours come in
  const before = ups;
  J.tick(401, { S: { away: 'RAT', home: 'KNG' }, colours: { home: ['#111111', '#222222'], away: ['#333333', '#444444'] } });
  J.tick(402, { S: { away: 'RAT', home: 'KNG' }, colours: { home: ['#111111', '#222222'], away: ['#333333', '#444444'] } });
  J.tick(403, { S: { away: 'RAT', home: 'KNG' }, colours: { home: ['#aa1111', '#222222'], away: ['#333333', '#444444'] } });
  check(ups === before + 2, 'the score repaints when the clubs\' colours change, and not otherwise', `${ups - before} uploads`);
}

if (fails) { console.error(`comic-replay: ${fails} failed`); process.exit(1); }
