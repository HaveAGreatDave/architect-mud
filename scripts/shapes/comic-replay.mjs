// GATE · THE COMIC REPLAY (client/game/js/panels/diamond/comic.js).
//
// With the comic look on, a big play's replay runs, freezes on its moment, runs on, and ends on a
// comic page. What has to hold, with no browser: its length is the replay's at REPLAY.rate plus
// the freeze and the page (the grandstand books the slot off it, so a wrong one runs into the
// next payload); the worm's-eye camera is down on the grass, on the field and looking at the
// moment; the panels are taken in order inside the replay's window; every kind of replay has its
// word, the same each time for the same play; the page's panels sit inside the picture without
// overlapping; and the painters draw something at every beat without throwing.
//
// No DOM, no GL, no files written.

import { COMIC, COMIC_WORDS, comicWordOf, comicLength, comicFit, wormShot, panelAt, pageLayout, paintFreeze, paintPage } from '../../client/game/js/panels/diamond/comic.js';
import { REPLAY } from '../../client/game/js/panels/diamond/replay.js';
import { onField } from '../../client/game/js/panels/diamond/play.js';

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

// the panels: in order, inside the window, the second on the moment
check(panelAt(spec, 0) > spec.from && panelAt(spec, 0) < spec.key && panelAt(spec, 1) === spec.key && panelAt(spec, 2) > spec.key && panelAt(spec, 2) < spec.to, 'panels in order inside the replay, the second on its moment');

// the words
for (const kind of ['homerun', 'walkoff', 'catch', 'doubleplay', 'tripleplay', 'triple', 'close']) {
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

if (fails) { console.error(`comic-replay: ${fails} failed`); process.exit(1); }
