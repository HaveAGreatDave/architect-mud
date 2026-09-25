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
  if (!/RENDER_TUNE\.falconDive !== 0 && FALCON_STOOPS\.has\(fl\)\) st = falconDiveState\(/.test(src)) fail.push('the dive is no longer applied behind RENDER_TUNE.falconDive where the flock state is taken');
}

if (fail.length) { console.error(`✗ falcondive — ${fail.length} problem(s):\n  ` + fail.join('\n  ')); process.exit(1); }
console.log(`✓ falcondive — ${checked} stoop(s) over ${falcons.length} falcon(s): the falcon reaches the prey's measured position at the strike (worst ${worstHit.toFixed(4)} tiles), is back on its circuit by the end of the climb (worst ${worstBack.toFixed(4)}), and leaves its path alone outside a stoop.`);
