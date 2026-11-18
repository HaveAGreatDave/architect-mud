// Mound smoke: the trips to the mound (sim v5's `mound`, client/game/js/panels/diamond/mound.js),
// staged headlessly in the 3-D park's world off real v5 games' payloads. Fails if a trip throws, a
// cut names no camera, a pose goes non-finite, somebody moves faster than a man can (52 ft/s) outside
// a cut, the staff man or the man coming out isn't in the trip's cast, the visitors don't get to the
// knot behind the mound (4 ft) and talk there, the new man isn't on the mound by the time the
// manager hands him the ball, or the battery isn't back where the cast has it as the at-bat cuts in.
// Also that the sim's pitch count is the park's: pitchCountOf is synthPitches' length.
//
// Run:  node scripts/shapes/mound-smoke.mjs [games]

import { __install } from './rink-dom-stub.mjs';

__install();
const P = '../../client/game/js/panels/';
const { createWorld, DT, toPark } = await import(P + 'diamond/world.js');
const { createDirector } = await import(P + 'diamond/director.js');
const { castOf, tripCast } = await import(P + 'diamond/cast.js');
const { MOUND } = await import(P + 'diamond/mound.js');
const { tripOf, TRIP } = await import(P + 'diamond/timing.js');
const { isShot } = await import(P + 'diamond/camera.js');
const { sportsRng, sportsHash } = await import('../../plugins/broadcast/rng.js');
const B = await import('../../plugins/broadcast/sports/baseball.js');
const { gamedayPayloads } = await import('../../plugins/broadcast/sports/baseball-gameday.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  if (failures <= 40) console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

// the pitch count the sim keeps is the pitches the park throws
const KINDS = ['strikeout', 'walk', 'single', 'groundout', 'flyout', 'hitbypitch', 'doubleplay', 'homerun', 'error', 'sacfly'];
let bad = 0;
for (let s = 1; s < 4000; s++) { const k = KINDS[s % KINDS.length]; if (B.pitchCountOf(s * 7919, k) !== B.synthPitches(s * 7919, k).length) bad++; }
check('pitchCountOf is synthPitches\' length', bad === 0, `${bad} of 3999`);

// a league with its pens, as the .bsm has it
const teams = ['Rats', 'Kings', 'Gulls', 'Owls'];
const players = Array.from({ length: 60 }, (_, i) => `Player${i}`);
const bullpens = Object.fromEntries(teams.map((t, i) => [t, { manager: `Skip ${t}`, coach: `Coach ${t}`, pen: Array.from({ length: 6 }, (_, k) => `Arm${i}x${k}`) }]));
const abbr = (n) => String(n || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'TBD';
const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const GAMES = Number(process.argv[2]) || 6;
const seen = { visit: 0, change: 0, between: 0, run: 0 };
for (let g = 0; g < GAMES; g++) {
  const seed = sportsHash(g + 11, 0x7);
  const game = B.BASEBALL.simGame({ away: teams[g % 4], home: teams[(g + 1) % 4], teams, bullpens }, players, sportsRng(seed), { version: 5, seed, day: 24700 + g });
  check('a v5 game has its pitchers and its dugouts', Array.isArray(game.away.pitchers) && game.dugouts?.[game.home.name]?.manager, `game ${g}`);
  const order = gamedayPayloads(game, seed, { abbr, ordinal }).order;
  for (const p0 of order) {
    if (p0.mound?.between) { seen.between++; check('a change between innings stages no trip', !tripCast(p0) && tripOf(p0) === 0, `game ${g} ${p0.inning}${p0.half[0]}`); continue; }
    if (!p0.mound || p0.phase === 'half') continue;
    const p = { ...p0, hold: 70000 };
    const label = `game ${g} ${p.inning}${p.half[0]} ${p.mound.kind} ${p.batter}`;
    seen[p.mound.kind]++;
    if (p.phase === 'run') seen.run++;
    const cast = castOf(p);
    const staff = cast.find((c) => c.look.trip === 'staff'), out = cast.find((c) => c.look.trip === 'out');
    check('the trip\'s staff man is in the cast', staff && staff.id === (p.mound.kind === 'change' ? p.mound.manager : p.mound.coach), label);
    if (p.mound.kind === 'change') check('the man coming out is in the cast as a pitcher', out && out.id === p.mound.out && out.look.role === 'pitcher', label);
    const W = createWorld();
    const shots = [];
    let cutAt = -Infinity;
    const D = createDirector(W, { emit: (n, d) => { if (n === 'shot') { shots.push({ t: W.t, d }); cutAt = W.t; } } });
    try { D.stage(p, cast); } catch (e) { check('a trip stages', false, `${label}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); continue; }
    const T = D.trip;
    check('the trip is planned', !!T && T.kind === p.mound.kind, label);
    if (!T) continue;
    const t1 = D.t0;
    check('the trip takes its time before the at-bat', Math.abs(t1 - W.t - TRIP[p.mound.kind] - 0.05) < 0.06, `${label}: ${(t1 - W.t).toFixed(2)}`);
    const slots = T.bodies.map((b) => b.slot);
    const last = new Map();
    const pSlot = cast.find((c) => c.look.role === 'pitcher' && c.look.slot % 12 === 0).look.slot, cSlot = cast.find((c) => c.look.role === 'catcher').look.slot;
    let talked = 0;
    const talks = new Set(T.talks.map((x) => x.slot));
    try {
      while (W.t < t1 + 0.5) {
        const was = W.t;
        W.step(DT);
        for (const s of slots) {
          const Q = W.pose(s, W.t);
          if (!Q) continue;
          const pv = toPark(Q, Q.pelvis);
          check('every pose in the trip is finite', pv.every(Number.isFinite), `${label} slot ${s}`);
          const prev = last.get(s);
          if (prev && W.t - cutAt > 0.05 && was - cutAt > 0.05) {
            const v = flat(prev, pv) / DT;
            check('nobody in the trip moves faster than 52 ft/s outside a cut', v <= 52, `${label} slot ${s} at ${(W.t - (t1 - TRIP[p.mound.kind])).toFixed(2)}s: ${v.toFixed(1)} ft/s`);
          }
          last.set(s, pv);
          // talking in the knot behind the mound
          const playing = W.bodies.get(s);
          if (playing?.clip?.id === 'talk_mound' && talks.has(s)) {
            const d = flat(pv, MOUND.centre);
            check('a man talks in the knot behind the mound (4 ft)', d <= 4.2, `${label} slot ${s}: ${d.toFixed(2)} ft`);
            talked++;
          }
        }
        if (W.t > t1 + 0.02 && W.t - DT <= t1 + 0.02) {
          for (const s of [pSlot, cSlot]) {
            const b = W.bodies.get(s), c = cast.find((x) => x.look.slot === s);
            check('the battery is back where the cast has it as the at-bat cuts in', b && flat(b.at, c.at) < 0.5, `${label} slot ${s}`);
          }
          for (const s of slots) if (s !== pSlot && s !== cSlot) check('the staff man and the man out are back on the bench as stills', !W.bodies.has(s), `${label} slot ${s}`);
        }
      }
    } catch (e) { check('a trip plays', false, `${label}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
    check('the trip talks', talked > 0, label);
    const tripShots = shots.filter((x) => x.t < t1 - 1e-6);
    check('the trip cuts to its own cameras', tripShots.length >= (p.mound.kind === 'change' ? 4 : 2), `${label}: ${tripShots.length}`);
    for (const x of tripShots) check('every trip shot is a camera', isShot(x.d), `${label}: ${JSON.stringify(x.d)?.slice(0, 60)}`);
    if (T.kind === 'change') check('the new man is on the mound before the at-bat', T.arrive < t1 - 3, `${label}: arrives ${(T.arrive - t1).toFixed(2)} s from the cut in`);
  }
}
check('the games have visits and changes, mid-inning and between innings', seen.visit > 0 && seen.change > 0 && seen.between > 0, JSON.stringify(seen));
console.log(`mound-smoke: ${passes}/${passes + failures} passed  ${JSON.stringify(seen)}`);
process.exit(failures ? 1 : 0);
