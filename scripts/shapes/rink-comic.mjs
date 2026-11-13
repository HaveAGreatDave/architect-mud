// GATE · THE RINK'S COMIC REPLAYS (client/game/js/panels/rink/comic.js, rink/replay.js, rink/director.js).
//
// With the comic look on, the rink replays a goal, a shot off the post, a big save, a hit and the
// punch that wins a fight as a comic: run, freeze, what follows, and a page. What has to hold, with
// no browser:
//
//   - every kind has its word (the same each time for the same play), its captions, its headline
//     and a narration that says more than the headline; `comicPlan` steps down from the page to the
//     freeze to nothing; the page tells it in three frames (the action, what it did, how it ended),
//     so frame 2's caption runs on into frame 3's, and the clip runs on past the moment;
//   - the replay's clock: the run reaches the moment and stops on it for the freeze, runs on, and
//     holds at the end for the page; `left` counts the freeze and the page; the overlay draws every
//     beat and takes its three panels;
//   - a real game (slot 289, sim v5) played through the view with the comic look on: every kind of
//     moment it has is replayed as a comic, each one's beats in order and inside its window, the
//     stand-in world still through the freeze, the live clock never held, and nothing throws.
//
// No GL (the 2-D renderer under the DOM stub), no database, no files written.

import fs from 'fs';
import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const { COMIC, tellsMore, storyLayout, paintStory, printPanel } = await import('../../client/game/js/panels/comic-print.js');
const { comicSpecOf, comicPlan, comicExtra, periodOf, drawComic, RINK_COMIC, RINK_WORDS, COMIC_CHANCES } = await import('../../client/game/js/panels/rink/comic.js');
const { createRinkView } = await import('../../client/game/js/panels/gameday-rink.js');
const { DT } = await import('../../client/game/js/panels/rink/rig.js');
const { sportsRng, sportsHash, sportsPick, sportsFill } = await import('../../plugins/broadcast/rng.js');
const HOCKEY = (await import('../../plugins/broadcast/sports/hockey.js')).default;
const { paceCalls } = await import('../../plugins/broadcast/sports/hockey-pacing.js');

let fails = 0;
const check = (ok, what, detail = '') => { if (!ok) { fails++; console.error('✗ ' + what + (detail ? ` (${detail})` : '')); } };

// ── the words ─────────────────────────────────────────────────────────────────────────────────────
const KINDS = [['goal', null], ['goal', null, { strength: 'pp' }], ['goal', null, { strength: 'en' }], ['post', 'post'], ['save', 'glove'], ['save', 'pad'], ['save', 'breakaway'],
  ['hit', 'shoulder'], ['hit', 'glass'], ['hit', 'elbow'], ['hit', 'crosscheck'], ['fight', 'knockdown']];
for (const [kind, sub, extra] of KINDS) {
  const f = { a: 'Rory Ashdown', b: 'Mats Kettle', shot: 'wrist shot', period: 2, clock: 731, ...extra };
  const s = comicSpecOf(kind, sub, f), again = comicSpecOf(kind, sub, f), label = `${kind}/${sub}${extra ? '/' + JSON.stringify(extra) : ''}`;
  check(typeof s.word === 'string' && /!$/.test(s.word) && s.word === again.word, `${label}: a word, ending in a bang, the same each time`, s.word);
  check(Array.isArray(s.captions) && s.captions.length === 2 && s.captions.every((c) => typeof c === 'string' && c.length), `${label}: two captions`);
  // the story: frame 2 runs on into frame 3, which is the end of it
  check(/\.\.\.$/.test(s.captions[0]) && /^\.\.\..*!$/.test(s.captions[1]), `${label}: what it did runs on into how it ended`, s.captions.join(' / '));
  check(typeof s.headline === 'string' && /!$/.test(s.headline), `${label}: a headline`, s.headline);
  check(tellsMore(s.desc, s.headline), `${label}: the narration says more than the headline`, s.desc);
  check(!/—/.test(s.desc + s.word + s.headline + s.captions.join('')), `${label}: no em dash`);
  check(Array.isArray(s.inks) && s.inks.length === 4 && s.inks.every((c) => /^#[0-9a-f]{6}$/i.test(c)), `${label}: four inks`);
  check(s.issue === 2 && s.note === 'SECOND PERIOD', `${label}: numbered by the period, and says it`, `${s.issue} ${s.note}`);
}
check(comicSpecOf('goal', null, { strength: 'pp' }).headline === 'POWER-PLAY GOAL!', 'a power-play goal says so');
check(comicSpecOf('hit', 'glass', {}).inks !== comicSpecOf('goal', null, {}).inks && comicSpecOf('save', 'glove', {}).inks !== comicSpecOf('goal', null, {}).inks, 'a hit and a save are inked apart from a goal');
check(comicSpecOf('hit', 'shoulder', { note: 'ASHDOWN ON KETTLE' }).note === 'ASHDOWN ON KETTLE', 'a hit\'s run says who hit whom');
check(Object.values(RINK_WORDS).every((l) => l.length >= 3), 'every style has at least three words to pick from');
check(!('jersey' in RINK_WORDS) && comicSpecOf('fight', 'jersey', {}).headline === 'KNOCKOUT!', 'no turtle: a fight\'s comic replay is a knockdown\'s');
check(RINK_COMIC.after >= 1.5 && RINK_COMIC.goalAfter >= RINK_COMIC.after && RINK_COMIC.before > 0.2 && RINK_COMIC.before < 0.9, 'the clip runs on past the moment, and "before" is taken in the run-up');
check(['post', 'glove', 'pad', 'breakaway'].every((k) => COMIC_CHANCES.has(k)) && !COMIC_CHANCES.has('save') && !COMIC_CHANCES.has('wide'), 'a post and the big saves are kept; a routine save and a miss aren\'t');
check(periodOf({ section: '2nd' }) === 2 && periodOf({ section: 'OT' }) === 4 && periodOf({ section: '2OT' }) === 4 && periodOf({ period: 3 }) === 3 && periodOf({}) === null, 'the period from a payload');
check(comicSpecOf('goal', null, { section: 'x' }).issue === null, 'no period, no number');
// the plan
const full = RINK_COMIC.run + COMIC.freeze + COMIC.page, mid = RINK_COMIC.run + COMIC.freeze;
check(comicPlan(full) === 'page' && comicPlan(full - 0.01) === 'freeze' && comicPlan(mid) === 'freeze' && comicPlan(mid - 0.01) === null && comicPlan(NaN) === null, 'comicPlan steps down from the page to the freeze to nothing');
check(comicExtra('page') === COMIC.freeze + COMIC.page && comicExtra('freeze') === COMIC.freeze && comicExtra(null) === 0, 'comicExtra is what the plan adds');
check(RINK_COMIC.room >= full + 1, 'a stoppage\'s room fits the whole comic replay with slow motion to spare');

// the story page: the action big on the right, just before it and just after it small down the left
for (const [w, h] of [[900, 506], [742, 381], [1600, 900]]) {
  const L = storyLayout(w, h), [B, A, X] = L.panels, label = `storyLayout ${w}x${h}`;
  const inside = (P) => P.x >= 0 && P.y > L.caption.y && P.x + P.w <= w && P.y + P.h <= h;
  check(L.panels.length === 3 && L.panels.every(inside), `${label}: three panels inside the picture, under the headline`);
  check(B.x === A.x && B.y < A.y && B.y + B.h <= A.y && X.x >= B.x + B.w, `${label}: before above after on the left, the action to their right`);
  check(X.w * X.h > 2 * B.w * B.h && Math.abs(X.y - B.y) < 1 && Math.abs(X.y + X.h - (A.y + A.h)) < 1, `${label}: the action the big one, as tall as the two beside it`);
}
{
  let n = 0;
  const g = new Proxy({ canvas: { width: 900, height: 506 } }, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 8 }) : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => { n++; }), set: (t, k, v) => { t[k] = v; return true; } });
  const shot = { width: 960, height: 540 }, spec = comicSpecOf('fight', 'knockdown', { a: 'Ashdown', b: 'Kettle', period: 2 });
  let threw = null;
  for (const t of [0, 0.2, 0.5, 0.9, 1.4, 2.8]) {
    try { paintStory(g, 900, 506, [shot, shot, null], spec.word, spec.headline, t, { desc: spec.desc, captions: spec.captions, at: [0.5, 0.4], subject: { x: 0.5, y: 0.5, r: 0.2 }, seed: spec.seed, inks: spec.inks, issue: 2, masthead: 'RINKSIDE COMICS' }); }
    catch (e) { threw = e.message; }
  }
  check(!threw && n > 200, 'paintStory draws at every point of the page, a blank frame included', threw || `${n} calls`);
}

// ── the print (both sports'): thin lines, and no specks off texture ─────────────────────────────────
// A frame with one hard step down its middle (grey 0.3 to 0.7) and a grain of ±0.06 over all of it,
// and a busy crowd-like band (±0.15 checker) along its foot, printed through a canvas that hands
// its pixels back. The step gets a line one or two pixels wide on every row, and the grain and the
// crowd get none.
{
  const W0 = 1280, H0 = 720, rnd = ((s) => () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296))(7);
  const px = new Uint8ClampedArray(W0 * H0 * 4);
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
    let v = (x < W0 / 2 ? 0.3 : 0.7) + (rnd() - 0.5) * 0.12;
    if (y > H0 * 0.8) v += ((x + y) % 2 ? 0.15 : -0.15);
    const p = (y * W0 + x) * 4; px[p] = px[p + 1] = px[p + 2] = Math.max(0, Math.min(1, v)) * 255; px[p + 3] = 255;
  }
  const canvasOf = (w, h, data = null) => {
    const cv = { width: w, height: h, data: data || new Uint8ClampedArray(w * h * 4) };
    cv.getContext = () => ({
      drawImage(src) { cv.data.set(src.data); },
      getImageData: () => ({ data: new Uint8ClampedArray(cv.data) }),
      putImageData(im) { cv.data.set(im.data); },
    });
    return cv;
  };
  const fakeDoc = { createElement: () => canvasOf(0, 0) };
  fakeDoc.createElement = () => { const c = canvasOf(1, 1); Object.defineProperty(c, 'width', { set(v) { this._w = v; if (this._h) this.data = new Uint8ClampedArray(v * this._h * 4); }, get() { return this._w; } }); Object.defineProperty(c, 'height', { set(v) { this._h = v; if (this._w) this.data = new Uint8ClampedArray(this._w * v * 4); }, get() { return this._h; } }); return c; };
  const t0 = performance.now(), out = printPanel(fakeDoc, canvasOf(W0, H0, px)), ms = performance.now() - t0;
  const ink = (x, y) => { const p = (y * W0 + x) * 4; return out.data[p] < 60; };
  let widest = 0, missed = 0, specks = 0, crowd = 0;
  for (let y = 20; y < H0 * 0.78; y += 7) {
    let n = 0; for (let x = W0 / 2 - 12; x < W0 / 2 + 12; x++) if (ink(x, y)) n++;
    widest = Math.max(widest, n); if (!n) missed++;
    for (let x = 20; x < W0 / 2 - 30; x += 3) if (ink(x, y)) specks++;
  }
  for (let y = Math.ceil(H0 * 0.84); y < H0 - 4; y += 3) for (let x = 20; x < W0 - 20; x += 3) if (ink(x, y) && Math.abs(x - W0 / 2) > 12) crowd++;
  check(out !== null && out.data && out.width === W0, 'the print reads and writes a frame\'s pixels');
  check(widest <= 2 && missed === 0, 'a hard edge gets a thin line, on every row', `widest ${widest} px, ${missed} rows missed`);
  check(specks === 0 && crowd === 0, 'grain and a busy crowd make no specks of ink', `${specks} in the grain, ${crowd} in the crowd`);
  if (process.argv.includes('--verbose')) console.log(`print: 1280x720 in ${ms.toFixed(0)} ms`);
  // THE MODELS' OWN COLOUR: a kit's blue, a red, an ice white and a dark pant come out of the print
  // near what went in, each channel within 26 of 255 and none of them swapping order (no hue shift)
  const off = [];
  for (const rgb of [[47, 111, 208], [200, 56, 47], [232, 240, 246], [40, 36, 50]]) {
    const n0 = 64 * 64, pc = new Uint8ClampedArray(n0 * 4);
    for (let i = 0; i < n0; i++) { pc[i * 4] = rgb[0]; pc[i * 4 + 1] = rgb[1]; pc[i * 4 + 2] = rgb[2]; pc[i * 4 + 3] = 255; }
    const pr = printPanel(fakeDoc, canvasOf(64, 64, pc)), p = (32 * 64 + 32) * 4, got = [pr.data[p], pr.data[p + 1], pr.data[p + 2]];
    const far = Math.max(...got.map((v, j) => Math.abs(v - rgb[j]))), order = (a) => [0, 1, 2].sort((i, j) => a[j] - a[i]).join('');
    if (far > 26 || (Math.max(...rgb) - Math.min(...rgb) > 20 && order(got) !== order(rgb))) off.push(`${rgb} → ${got}`);
  }
  check(!off.length, 'the print keeps a model\'s own colour', off.join('; '));
}

// ── the clock, through the real world ─────────────────────────────────────────────────────────────
globalThis.__houseComic = true;
{
  const host = stub.makeHost(), view = createRinkView(host);
  await view.ready();
  view.showIdle();
  const W = view.world, R = W.replay;
  check(typeof W.comicReplays === 'function' && W.comicReplays() === true, 'the view turns comic replays on with the comic look');
  for (let i = 0; i < 6 / DT; i++) { W.step(DT); R.record(); }
  const t = W.t, spec = comicSpecOf('goal', null, { a: 'Ashdown', b: 'Kettle', period: 1 });
  check(R.start(t - 4, t - 0.5, 0.5, { spec, key: t - 1.5, page: true, at: 'puck' }), 'a comic replay starts');
  const C = R.comic;
  check(C && C.beat === 'run' && Math.abs(C.key - (t - 1.5)) < 1e-9, 'it starts in the run, its moment where it was asked');
  const total = R.left(), expect = (R.to - R.from) / R.speed + COMIC.freeze + COMIC.page;
  check(Math.abs(total - expect) < 1e-6, 'left counts the slow motion, the freeze and the page', `${total.toFixed(3)} vs ${expect.toFixed(3)}`);
  const beats = [], at = {};
  let el = 0, heldRt = null, heldOk = true, live0 = W.t;
  const g = globalThis.document.createElement('canvas').getContext('2d'), pic = globalThis.document.createElement('canvas');
  pic.width = 900; pic.height = 506;
  const P = (x, y, z) => ({ x: 450 + (x - 100) * 3, y: 300 - y * 2 - z * 4, s: 1, d: 50 });
  let drewAll = true;
  while (R.active && el < 40) {
    R.tick(DT); el += DT;
    const src = R.frame();
    if (beats[beats.length - 1] !== C.beat) { beats.push(C.beat); at[C.beat] = el; }
    if (C.beat === 'freeze') { if (heldRt == null) heldRt = R.rt; else if (R.rt !== heldRt || src.t !== heldRt) heldOk = false; }
    if (Math.round(el / DT) % 4 === 0 && R.active) drewAll = drawComic(g, src, 900, 506, 1, { P, picture: pic }) && drewAll;
  }
  check(beats.join(',') === 'run,freeze,after,page', 'the beats in order', beats.join(','));
  check(heldOk && Math.abs(heldRt - C.key) < 1e-9, 'the freeze stands the replay world still on its moment');
  check(Math.abs(at.after - at.freeze - COMIC.freeze) < 2 * DT && Math.abs(el - at.page - COMIC.page) < 2 * DT, 'the freeze and the page hold for their lengths', `${(at.after - at.freeze).toFixed(3)} ${(el - at.page).toFixed(3)}`);
  check(Math.abs(el - total) < 3 * DT, 'it ends when left said it would', `${el.toFixed(3)} vs ${total.toFixed(3)}`);
  check(drewAll, 'the overlay draws every beat');
  check(C.shots && C.shots.every(Boolean) && C.prints && C.prints.every(Boolean) && C.place && Number.isFinite(C.place.x), 'the three frames are taken and printed, and the moment placed on screen');
  check(W.t === live0, 'the replay\'s clock is its own (ticked here without the world)');
  // the plain replay is untouched
  // A REPLAY ON A GOALIE LEAVES OUT THE MEN IN FRONT OF HIM: a camera put beyond a skater from the
  // goalie, so the skater is right in the way; and nobody's left out without a camera, or before the
  // freeze when it's only from the freeze on
  {
    const sp = { spec, key: t - 1.5, page: true, at: 'puck' };
    R.start(t - 4, t - 0.5, 0.5, sp);
    const all = R.frame().bodies(), gk = all.find((q) => q.kind === 'goalie');
    const sk = all.filter((q) => q.kind === 'skater' && !q.rag).sort((p, q) => Math.hypot(p.x - gk.x, p.y - gk.y) - Math.hypot(q.x - gk.x, q.y - gk.y)).find((q) => Math.hypot(q.x - gk.x, q.y - gk.y) > 6);
    const d = Math.hypot(sk.x - gk.x, sk.y - gk.y), eye = [sk.x + (sk.x - gk.x) / d * 20, sk.y + (sk.y - gk.y) / d * 20, 6];
    const has = (b) => R.source.bodies().some((q) => q.seed === b.seed && q.side === b.side && q.kind === b.kind);
    R.start(t - 4, t - 0.5, 0.5, { ...sp, clear: { seed: gk.seed, side: gk.side } });
    R.source.eye = null; R.frame();
    check(has(sk), 'no camera yet, nobody left out');
    R.source.eye = eye; R.frame();
    const kept = R.source.bodies().length;
    check(!has(sk) && has(gk), 'the skater between the camera and the goalie is left out, the goalie kept');
    check(kept >= all.length - 4, 'only the men in the way are left out', `${all.length - kept} of ${all.length}`);
    R.start(t - 4, t - 0.5, 0.5, { ...sp, clear: { seed: gk.seed, side: gk.side, after: true } });
    R.source.eye = eye; R.frame();
    check(has(sk), 'a clear from the freeze on leaves the run-up as it was');
    R.source.eye = null;
  }
  check(R.start(t - 4, t - 0.5, 0.5) && R.comic === null && Math.abs(R.left() - (R.to - R.from) / 0.5) < 1e-6, 'without a comic spec a replay is the plain one');
  R.stop();
  check(drawComic(g, R.source, 900, 506, 1, {}) === false, 'no comic replay on, nothing drawn: the plain one is');
  view.dispose?.();
}

// ── a real game ───────────────────────────────────────────────────────────────────────────────────
const src = fs.readFileSync(new URL('../../data/scripts/hockey.bsm', import.meta.url), 'utf8');
const block = (k) => (src.split(`::${k}`)[1]?.split(`::end${k}`)[0] || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).map((s) => s.replace(/"/g, ''));
const pools = {};
{ let key = null; for (const raw of src.split(/\r?\n/)) { const l = raw.trim(); if (l.startsWith('::lines ')) { key = l.slice(8).trim(); pools[key] = []; continue; } if (l.startsWith('::')) { key = null; continue; } if (key && l && !l.startsWith('#')) pools[key].push(l); } }
const teams = block('teams'), players = block('players');
const clubs = JSON.parse(fs.readFileSync(new URL('../../content/media_broadcasts/bc_cluster_puck.json', import.meta.url), 'utf8')).sports_pools?.clubs || null;
function gameLines(slot, version) {
  const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams, clubs };
  const seed = sportsHash(slot, 0);
  const game = HOCKEY.simGame(matchup, players, sportsRng(seed), { version });
  const nrng = sportsRng(seed ^ 0x9e3779b9);
  const lines = [];
  HOCKEY.narrate({
    script: {}, game, gs: { seed, game }, slot, ws: false, announcer: 'Tug Brennan', pools, nrng, sport: HOCKEY, add: () => {},
    say: (line, tok, sb, fx, gd, meta) => { if (line) lines.push({ text: sportsFill(line, tok).trim(), graphic: fx || null, gameday: gd || null, _cue: meta && meta.cue, _opt: (meta && meta.opt) || false }); },
    pick: (...keys) => sportsPick(pools, nrng, ...keys),
    abbr: (n) => String(n).slice(0, 3).toUpperCase(), recordOf: () => '8-4-1', lastId: () => null,
  });
  const { holds, gaps, dropped } = paceCalls(lines, 3600 * 1000 * 0.85, 1000, { spareMs: 480000 });
  return lines.filter((l) => !dropped.has(l)).map((l) => ({ text: l.text, fx: l.graphic, gd: l.gameday, hold: holds.get(l) + (gaps.get(l) || 0) }));
}
{
  const SLOT = 289;
  const host = stub.makeHost(), view = createRinkView(host);
  await view.ready();
  view.showIdle();
  const W = view.world, R = W.replay;
  const shown = {}, bad = [], frozenMoved = [];
  let cur = null, lastLive = W.t, liveHeld = 0, renders = 0, threw = null, pages = 0;
  const short = [], flights = [];
  // a comic replay as it runs: its kind, the beats it went through, and the replay clock in the freeze
  const watch = () => {
    const C = R.active ? R.comic : null;
    if (C && (!cur || cur.C !== C)) { cur = { C, beats: [C.beat], heldRt: null, kind: C.spec.kind }; shown[cur.kind] = (shown[cur.kind] || 0) + 1;
      if (cur.kind === 'goal' && C.pathFrom != null) flights.push({ path: C.path ? C.path.length : 0, past: C.past ? C.key - C.pathFrom : null }); }
    if (cur && cur.C === C) {
      if (cur.beats[cur.beats.length - 1] !== C.beat) cur.beats.push(C.beat);
      if (C.beat === 'freeze') { if (cur.heldRt == null) cur.heldRt = R.rt; else if (R.rt !== cur.heldRt) frozenMoved.push(cur.kind); }
      if (R.rt < R.from - 1e-9 || R.rt > R.to + 1e-9) bad.push(`${cur.kind}: the replay clock outside its window`);
      // (the page's last frame is the clip's: it has to run on long enough past the moment to be the end)
      if (C.page && C.to - C.key < 1.0) short.push(`${cur.kind} ${(C.to - C.key).toFixed(2)} s`);
    }
    if (cur && cur.C !== C) {
      const seq = cur.beats.join(',');
      if (!/^run(,freeze(,after(,page)?)?)?$/.test(seq)) bad.push(`${cur.kind}: beats ${seq}`);
      if (/page/.test(seq)) pages++;
      cur = null;
    }
  };
  let next = W.t;
  const run = (secs) => {
    const t0 = W.t;
    while (W.t - t0 < secs) {
      W.step(DT);
      if (W.t <= lastLive) liveHeld++;
      lastLive = W.t;
      watch();
      // a frame now and then, and four a second through a comic replay, so every beat is drawn
      if (W.t >= next) {
        next = W.t + (R.active && R.comic ? 0.25 : 10);
        try { view.renderer.render(W.t * 1000); renders++; } catch (e) { threw ??= e.stack.split('\n').slice(0, 3).join(' '); }
      }
    }
    stub.runTimers(0);
  };
  // (played until every kind has been replayed and the last has finished: the whole game was
  // twice the CPU for nothing more)
  const KINDS4 = ['goal', 'save', 'hit', 'fight'];
  for (const l of gameLines(SLOT, 5)) {
    if (KINDS4.every((k) => shown[k]) && !cur && pages) break;
    view.setCaption(l.text, { held: !!l.gd });
    if (!l.gd) { run((l.hold || 400) / 1000); continue; }
    try { view.apply(l.gd); } catch (e) { threw ??= e.stack.split('\n').slice(0, 3).join(' '); continue; }
    run(Math.max(2, (l.hold || 0) / 1000));
  }
  check(!threw, 'the game plays through with comic replays on', threw || '');
  check(liveHeld === 0, 'the live clock never stops for a comic replay', `${liveHeld} steps held`);
  check(!bad.length, 'every comic replay\'s beats are in order and inside its window', bad.slice(0, 4).join('; '));
  check(!frozenMoved.length, 'the freeze holds the replay world still', frozenMoved.slice(0, 4).join(', '));
  for (const k of KINDS4) check((shown[k] || 0) > 0, `${SLOT}: a ${k} is replayed as a comic`, JSON.stringify(shown));
  check(pages > 0, 'a comic replay gets as far as its page');
  check(!short.length, 'every page\'s last frame is at least a second past its moment', [...new Set(short)].slice(0, 4).join(', '));
  // a goal's freeze is the puck going past the goalie, its flight from the stick inked in
  check(flights.length > 0 && flights.every((f) => f.path >= 2), 'a goal comic replay keeps the flight of the shot', JSON.stringify(flights.slice(0, 4)));
  check(flights.some((f) => f.past != null && f.past > 0.05), 'a goal freeze moves on from the release to the puck beating the goalie', JSON.stringify(flights.slice(0, 4)));
  check(renders > 50, 'the comic beats were drawn', `${renders} frames`);
  if (process.argv.includes('--verbose')) console.log(`${SLOT}: comic replays by kind ${JSON.stringify(shown)}, ${pages} with a page, ${renders} frames drawn`);
  view.dispose?.();
}

if (fails) { console.error(`rink-comic: ${fails} failed`); process.exit(1); }
