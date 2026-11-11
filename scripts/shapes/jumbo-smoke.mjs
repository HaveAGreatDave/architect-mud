// GATE · THE VIDEOBOARD IN PERSON (diamond/jumbo.js, through gameday-grandstand.js).
//
// From a seat in the stands nobody shows you a replay, so the videoboard stages its own and draws
// it from the replay's camera just for the board, and a box's own screen carries the board's
// picture while one's on it. diamond-smoke plays the broadcast's replays; nothing else plays these.
// Here a home run is fed to the real grandstand from a seat, with a recording renderer in place of
// the GL park and the hand-cranked clock:
//
//   - the board takes its replay (frames go up to it while it's taken), and plays it again after;
//   - with the comic look on, the replay freezes on its moment (the replay's world stood still for
//     COMIC.freeze of the live clock) from the worm's-eye camera, and runs on to its end;
//   - the live game is never held behind it: the live world's clock runs on through all of it;
//   - in a suite, the box's screen gets the board's picture while the replay's on it, at the
//     screen's size, and the director's shot again after.
//
// No GL, no files written.   Run:  node scripts/shapes/jumbo-smoke.mjs

import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const P = '../../client/game/js/panels/';
const { createGrandstandView } = await import(P + 'gameday-grandstand.js');
const { COMIC } = await import(P + 'diamond/comic.js');
const { sportsRng } = await import('../../plugins/broadcast/rng.js');
const { simGameV2 } = await import('../../plugins/broadcast/sports/baseball.js');
const { gamedayPayloads } = await import('../../plugins/broadcast/sports/baseball-gameday.js');

let fails = 0, passes = 0;
const check = (what, ok, detail = '') => { if (ok) { passes++; return; } fails++; console.log(`  FAIL ${what}${detail ? ` (${detail})` : ''}`); };

const abbr = (n) => String(n || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'TBD';
const ordinal = (n) => ['', '1st', '2nd', '3rd'][n] || `${n}th`;
const gameOf = (seed) => gamedayPayloads(simGameV2({ away: 'Rats', home: 'Kings' }, null, sportsRng(seed * 2654435761 + 7), { seed }), seed, { abbr, ordinal }).order;
const isHr = (x) => !x.phase && x.kind === 'homerun' && (x.pitches || []).length;
let hr = null;
for (let s = 16; !hr && s <= 76; s++) hr = gameOf(s).find(isHr);
check('a home run to show', !!hr);

// A renderer that records the board's uploads, the suite's screen and every camera it's drawn from.
function recorder(room) {
  const rec = { jumbo: 0, tvImage: [], tvShots: 0, cams: [], frames: 0 };
  const R = {
    kind: 'stub', lost: false, quality: { dpr: 1, tube: false }, casters: [],
    setCast() { return 0; }, setPose() {}, setBall() {}, setCrowd() {}, markDirt() {}, resetDirt() {}, setHour() {}, setWeather() {}, setTime() {},
    render(cam) { rec.frames++; rec.cams.push(cam); return true; },
    setRoof() {}, roof: { p: 1, to: 1, moving: false },
    setBoard() {}, setVenue() { return null; }, pump() { return 0; }, pending: () => 0, dispose() {},
    setJumbo(c) { if (c && c.width > 0) rec.jumbo++; return true; },
    seatFor: () => null,
    city: { buildings: 1 },
    ...(room ? { room: {}, setRoom() { return {}; }, renderTv() { rec.tvShots++; return true; }, setTvImage(c) { rec.tvImage.push([c?.width, c?.height]); return true; } } : {}),
  };
  return { rec, renderer: () => R };
}

for (const [name, comic, room] of [['plain', false, false], ['comic', true, false], ['comic, in a suite', true, true]]) {
  if (!hr) break;
  if (comic) globalThis.__houseComic = 1; else delete globalThis.__houseComic;
  const { rec, renderer } = recorder(room);
  const host = stub.makeHost();
  const seat = { eye: [-70, 38, -95], mode: 'follow', fov: 50 };
  const v = createGrandstandView(host, { force: true, renderer, seat, mute: true, ...(room ? { room: { at: [-70, -95], face: 0, floor: 30 } } : {}) });
  await v.ready();
  v.showIdle();
  v.setCaption('Gone.', { held: true });
  v.apply({ ...hr, hold: 75000 });
  const W = v.world, D = v.director;
  check(`${name}: the seat's game is the director's`, !!W && !!D && D.payload && D.payload.kind === 'homerun');
  if (!W || !D) continue;
  // through the play, the trot and the board's replay: a minute and a half of frames at 30 a second
  const beats = [], held = { n: 0, moved: 0 };
  let ups0 = rec.jumbo, lowCams = 0, tvDuring = 0, tvAfter = 0, lastT = W.t, stalled = 0, sawReplay = false, shotsAtReplayEnd = null;
  const t0 = W.t;
  for (let i = 0; i < 30 * 95; i++) {
    const before = rec.cams.length, tv0 = rec.tvImage.length;
    const B0 = v.boardReplay, bt0 = B0?.W.t, was = B0?.comic?.phase;
    stub.runFrames(1, 1000 / 30);
    // the board's replay, beat by beat, and its world through the freeze
    const B = v.boardReplay, beat = B ? B.comic?.phase || 'plain' : null;
    if (beat && beats[beats.length - 1] !== beat) beats.push(beat);
    if (B && B === B0 && was === 'freeze' && beat === 'freeze') { held.n++; if (Math.abs(B.W.t - bt0) > 1e-9) held.moved++; }
    if (W.t <= lastT) stalled++;
    lastT = W.t;
    // a camera down on the grass is the worm's-eye one (the seat's own eye is up in the stands)
    for (const c of rec.cams.slice(before)) if (c && typeof c === 'object' && Array.isArray(c.eye) && c.eye[1] < 1.5) lowCams++;
    if (rec.tvImage.length > tv0) { sawReplay = true; tvDuring++; shotsAtReplayEnd = rec.tvShots; }
  }
  if (room) tvAfter = rec.tvShots - (shotsAtReplayEnd ?? rec.tvShots);
  check(`${name}: the live game runs on through the board's replay`, stalled < 5 && W.t - t0 > 80, `${stalled} frames stood still, ${(W.t - t0).toFixed(1)} s`);
  check(`${name}: the board takes its replay and plays it again`, rec.jumbo - ups0 > 80, `${rec.jumbo - ups0} uploads`);
  if (comic) {
    check(`${name}: the board's replay runs, freezes on its moment and runs on`, beats.join('>') === 'run>freeze>after', beats.join('>'));
    check(`${name}: its world stands still through the freeze, for COMIC.freeze of the live clock`, held.moved === 0 && Math.abs(held.n / 30 - COMIC.freeze) < 0.2, `${held.n} frames, ${held.moved} moved`);
  } else check(`${name}: a plain replay has no beats`, beats.join('>') === 'plain', beats.join('>'));
  if (comic) check(`${name}: the board's replay runs up from the worm's-eye camera`, lowCams > 5, `${lowCams} frames from the grass`);
  else check(`${name}: no worm's-eye camera without the comic look`, lowCams === 0, `${lowCams}`);
  if (room) {
    check(`${name}: the box's screen carries the board's replay, at the screen's size`, sawReplay && tvDuring > 20 && rec.tvImage.every(([w, h]) => w === 640 && h === 360), `${tvDuring} frames, ${JSON.stringify(rec.tvImage[0])}`);
    check(`${name}: and the director's shot again after`, tvAfter > 5, `${tvAfter} shots after`);
  }
  v.clear?.();
}
delete globalThis.__houseComic;

console.log(`jumbo-smoke: ${passes}/${passes + fails} passed`);
if (fails) process.exit(1);
