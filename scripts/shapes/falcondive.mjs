// THE FALCON IS DRAWN STRIKING — falconDiveState in windshield.js.
//
// A stoop is an event derived by a pure function the server also runs (falconStoop). The renderer bends the
// hawk's drawn path onto its prey for the stoop's three seconds. This gate finds real stoops over the city
// and checks the four things that are silent when wrong:
//   1. at one second the hawk is at the prey (the shared stoop point plus the prey's measured offset),
//   2. at three seconds it is back on its own circuit,
//   3. outside a stoop, and with RENDER_TUNE.falconDive 0, nothing moves,
//   4. the prey's measured offset (MURMUR_MEASURED) is what the dive aims at, not the shared point.
// No browser, DB or network.
import { loadWindshield } from './dom-stub.mjs';
import { flocksNear, flockState, falconStoop, speciesAt, spOf } from '../../client/shared/birds.js';
import { MURMUR_MEASURED } from '../../client/game/js/panels/murmur.js';

const ws = await loadWindshield();
const fail = [];

// every flock round the city centre, on the ground each species lives on
const habitat = (wx, wy) => speciesAt('citycore', wx, wy) || speciesAt('forest', wx, wy) || speciesAt('redrock', wx, wy) || false;
const flocks = [...flocksNear(900, 900, 60, 1, habitat)];
const falcons = flocks.filter((f) => !!spOf(f).stoop);   // the hunters: the peregrine, since the red-tail takes no birds
if (!falcons.length) { console.error('✗ falcondive — no falcon near the seed tile, so nothing can be checked'); process.exit(1); }

// the first few stoops each hawk makes, found by walking the clock
const stoops = [];
for (const h of falcons) {
  for (let t = 1e9; t < 1e9 + 4 * 3600e3 && stoops.filter((x) => x.h === h).length < 3; t += 250) {
    const s = falconStoop(h, t, flocks);
    if (s && s.age < 0.25) { stoops.push({ h, t0: t - s.age * 1000 }); t += 5000; }
  }
}
if (!stoops.length) { console.error('✗ falcondive — no stoop found in four hours of any hawk, so nothing can be checked'); process.exit(1); }

const at = (h, t) => { const s = falconStoop(h, t, flocks); const st = flockState(h, t); return { s, st }; };
let worstHit = 0, worstBack = 0, checked = 0;
for (const { h, t0 } of stoops) {
  const hit = at(h, t0 + 1000);
  if (!hit.s || !hit.st.airborne) continue;
  checked++;
  const preyKey = hit.s.prey.sp + ':' + hit.s.prey.ax + ',' + hit.s.prey.ay;
  // 1 and 4: aimed at the prey carried by a measured offset
  MURMUR_MEASURED.set(preyKey, { dx: 0.7, dy: -0.4, dz: 0.2 });
  const d = ws.falconDiveState(hit.st, hit.s, t0 + 1000);
  const tz = flockState(hit.s.prey, t0 + 1000).z + 0.2;
  worstHit = Math.max(worstHit, Math.hypot(d.cx - (hit.s.x + 0.7), d.cy - (hit.s.y - 0.4), d.z - tz));
  MURMUR_MEASURED.delete(preyKey);
  // 2: back on the circuit at the end of the climb
  const back = at(h, t0 + 2999);
  if (back.s) { const b = ws.falconDiveState(back.st, back.s, t0 + 2999); worstBack = Math.max(worstBack, Math.hypot(b.cx - back.st.cx, b.cy - back.st.cy, b.z - back.st.z)); }
}
if (!checked) fail.push('no stoop had an airborne hawk at its strike, so the dive was never measured');
if (!(worstHit < 0.02)) fail.push(`at the strike the hawk was ${worstHit.toFixed(3)} tiles from where the birds are — it is not diving onto the prey's measured position`);
if (!(worstBack < 0.02)) fail.push(`at the end of the climb the hawk was ${worstBack.toFixed(3)} tiles off its own circuit — it does not come back`);

// 3: outside a stoop nothing moves
{
  const { h, t0 } = stoops[0];
  const st = flockState(h, t0 + 10000);
  const fake = { age: 5, x: 0, y: 0, prey: falcons[0] };
  const d = ws.falconDiveState(st, fake, t0 + 10000);
  if (d !== st) fail.push('a stoop five seconds old still bent the hawk\'s path');
}
// and the switch is read where the dive is applied
{
  const src = (await import('node:fs')).readFileSync(new URL('../../client/game/js/panels/windshield.js', import.meta.url), 'utf8');
  if (!/RENDER_TUNE\.falconDive !== 0 && FALCON_STOOPS\.get\(fl\)\)/.test(src)) fail.push('the dive is no longer applied behind RENDER_TUNE.falconDive where the flock state is taken');
  if (!/if \(st\.airborne\) st = falconDiveState\(st, strike, now\)/.test(src)) fail.push('the strike is no longer handed to falconDiveState where the flock state is taken');
  // ⚠ A STRIKE FROM A PERCH MUST PUT THE BIRD IN THE AIR FIRST, or it is never drawn (the dive only
  // bends an airborne bird) — which is how every perched stoop went unseen until this existed.
  if (!/if \(!st\.airborne && RENDER_TUNE\.perchStrike !== 0\) st = perchStrikeBase\(/.test(src)) fail.push('a strike from a perch is no longer lifted off the perch, so it is never drawn');
}

// ── THE RED-TAIL: A GROUND STRIKE ON A CRITTER ──────────────────────────────
// Critter ground on every tile, so the hunt can be found without a map. What this proves: a red-tail
// strikes, the dive reaches the critter ON THE GROUND at one second, and a taken critter is gone only
// from the moment the strike lands.
let groundChecked = 0, groundWorst = 0, takenEarly = 0, takenLate = 0, mantleLost = 0, mantleWorst = 0;
{
  const { groundStrike, crittersAt, critterTaken, MANTLE_S } = await import('../../client/shared/birds.js');
  const redtails = flocksNear(900, 900, 60, 1, (wx, wy) => speciesAt('redrock', wx, wy) || false).filter((f) => !!spOf(f).groundHunt);
  if (!redtails.length) fail.push('no red-tail near the seed tile, so the ground hunt cannot be checked');
  const preyFor = (h, t) => {
    const out = [];
    for (let wy = h.ay - 3; wy <= h.ay + 3; wy++) for (let wx = h.ax - 3; wx <= h.ax + 3; wx++) out.push(...crittersAt(wx, wy, t));
    return out;
  };
  for (const h of redtails.slice(0, 6)) {
    for (let t = 1e9; t < 1e9 + 6 * 3600e3 && groundChecked < 12; t += 500) {
      const s = groundStrike(h, t, preyFor(h, t));
      if (!s || s.age > 0.25) continue;
      const t0 = t - s.age * 1000;
      const hit = groundStrike(h, t0 + 1000, preyFor(h, t0 + 1000));
      if (!hit) continue;
      const st = { ...flockState(h, t0 + 1000), airborne: true };
      const d = ws.falconDiveState(st, hit, t0 + 1000);
      groundWorst = Math.max(groundWorst, Math.hypot(d.cx - hit.x, d.cy - hit.y, d.z - hit.tz));
      groundChecked++;
      if (hit.hit) {
        // Still on its catch halfway through the hold (MANTLE_S), not climbing away.
        const tm = t0 + 1000 + MANTLE_S * 500;
        const m = groundStrike(h, tm, preyFor(h, tm));
        if (!m) mantleLost++;
        else {
          const dm = ws.falconDiveState({ ...flockState(h, tm), airborne: true }, m, tm);
          mantleWorst = Math.max(mantleWorst, Math.hypot(dm.cx - m.x, dm.cy - m.y, dm.z - m.tz));
        }
        if (critterTaken(hit.prey, t0 + 500, [h], preyFor(h, t0 + 500))) takenEarly++;
        if (!critterTaken(hit.prey, t0 + 1500, [h], preyFor(h, t0 + 1500))) takenLate++;
      }
      t += 60000;
    }
  }
  if (redtails.length && !groundChecked) fail.push('no red-tail ground strike found in six hours, so the ground dive was never measured');
  if (!(groundWorst < 0.02)) fail.push(`at the strike the red-tail was ${groundWorst.toFixed(3)} tiles from the critter — the dive is not reaching the ground`);
  if (mantleLost) fail.push(`${mantleLost} kill(s) ended before the hawk had finished mantling over the catch`);
  if (!(mantleWorst < 0.02)) fail.push(`mid-mantle the hawk was ${mantleWorst.toFixed(3)} tiles off its catch — it is not staying down`);
  if (takenEarly) fail.push(`${takenEarly} critter(s) vanished before the strike landed`);
  if (takenLate) fail.push(`${takenLate} critter(s) were still there after a killing strike landed`);
}

// ── THE WEATHER TELL: A RED-TAIL SITS TIGHT BEFORE A STORM ──────────────────
// Share of samples airborne over many cycles, under a given weather pair. The control is the same
// flock with nothing told, which must be the bird exactly as it always flew.
let tellNote = '';
{
  const { weatherTell } = await import('../../client/shared/birds.js');
  const hawk = { ax: 731, ay: 959, sp: 'hawk' }, falcon = { ax: 916, ay: 902, sp: 'peregrine' };
  const airShare = (f, opts) => {
    let up = 0; const N = 4000;
    for (let i = 0; i < N; i++) if (flockState(f, 1e12 + i * 7919, null, opts).airborne) up++;
    return up / N;
  };
  const fair = airShare(hawk, { hour: 13, wx: ['clear', 'clear'] });
  const storm = airShare(hawk, { hour: 13, wx: ['storm', 'clear'] });
  const eve = airShare(hawk, { hour: 16, wx: ['clear', 'storm'] });
  const none = airShare(hawk, null);
  if (!(storm < fair * 0.4)) fail.push(`a red-tail is up ${(storm * 100).toFixed(0)}% of the time in a storm against ${(fair * 100).toFixed(0)}% in fair weather — the weather tell is not keeping it down`);
  if (!(eve < fair && eve > storm)) fail.push(`the afternoon before a storm (${(eve * 100).toFixed(0)}%) does not sit between fair (${(fair * 100).toFixed(0)}%) and storm (${(storm * 100).toFixed(0)}%)`);
  if (Math.abs(fair - none) > 1e-9) fail.push('fair weather is not the bird as it always flew');
  const fFair = airShare(falcon, { hour: 13, wx: ['clear', 'clear'] }), fStorm = airShare(falcon, { hour: 13, wx: ['storm', 'clear'] });
  if (Math.abs(fFair - fStorm) > 1e-9) fail.push('the peregrine reads the weather tell, which only the red-tail should');
  if (weatherTell('clear', 'storm', 9) !== 0) fail.push('a storm tomorrow is already keeping the hawks down in the morning');
  // Both surfaces hand the pair over: the room text and the windscreen.
  const fs = await import('node:fs');
  const desc = fs.readFileSync(new URL('../../server/engine/commands/describe.js', import.meta.url), 'utf8');
  if (!/wx: \[weather, getForecast\(\)/.test(desc)) fail.push('the room description no longer hands the weather pair to flockState, so it and the window disagree about the hawks');
  const wsrc = fs.readFileSync(new URL('../../client/game/js/panels/windshield.js', import.meta.url), 'utf8');
  if (!/wx: RENDER_TUNE\.wxForce \? \[RENDER_TUNE\.wxForce, null\] : BIRD_WX/.test(wsrc)) fail.push('the windscreen no longer hands the weather pair to the bird clock');
  tellNote = ` Weather tell: a red-tail is up ${(fair * 100).toFixed(0)}% in fair weather, ${(eve * 100).toFixed(0)}% the afternoon before a storm, ${(storm * 100).toFixed(0)}% in one.`;
}

if (fail.length) { console.error(`✗ falcondive — ${fail.length} problem(s):\n  ` + fail.join('\n  ')); process.exit(1); }
console.log(`✓ falcondive — ${checked} stoop(s) over ${falcons.length} falcon(s): the falcon reaches the prey's measured position at the strike (worst ${worstHit.toFixed(4)} tiles), is back on its circuit by the end of the climb (worst ${worstBack.toFixed(4)}), and leaves its path alone outside a stoop; ${groundChecked} red-tail ground strike(s) reach the critter (worst ${groundWorst.toFixed(4)} tiles).${tellNote}`);
