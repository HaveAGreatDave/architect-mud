// Gate for client/shared/sea-breakers.js: breakers are deterministic, sit on the crests the sea
// draws, cover the share of the sea their wind says, and don't jump when seaClock wraps.
import {
  breakersNear, breakerAt, breakChance, breakerShape, BREAK_SHARE, BREAK_LIFE_S, BREAK_EPOCH_S,
} from '../../client/shared/sea-breakers.js';
import { seaAmpsFor, seaWind, whitecapFraction, setSeaHeading, SEA_PERIOD_S } from '../../client/shared/sea-swell.js';

let fails = 0;
const fail = (m) => { fails++; console.log('FAIL ' + m); };

// A small deterministic PRNG, so the gate measures the same points every run.
let seed = 12345;
const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

for (const heading of [0, 0.9]) {
  setSeaHeading(heading);
  for (const kt of [15, 30, 45]) {
    const windA = seaAmpsFor(kt).wind;

    // 1. Same question, same answer.
    const a = JSON.stringify(breakersNear(40, -12, 30, 123.4, kt, windA));
    const b = JSON.stringify(breakersNear(40, -12, 30, 123.4, kt, windA));
    if (a !== b) fail(`h${heading} ${kt}kt: breakersNear isn't deterministic`);

    // 2. Each breaker sits on a crest: higher than the water a quarter wavelength either side.
    let checked = 0, off = 0;
    for (let i = 0; i < 40; i++) {
      const t = rnd() * SEA_PERIOD_S;
      for (const br of breakersNear(rnd() * 200, rnd() * 200, 25, t, kt, windA)) {
        const q = (br.ahead + br.behind) / 0.3 * 0.25;
        const h0 = seaWind(br.x, br.y, t, 1);
        const hf = seaWind(br.x + br.dir[0] * q, br.y + br.dir[1] * q, t, 1);
        const hb = seaWind(br.x - br.dir[0] * q, br.y - br.dir[1] * q, t, 1);
        checked++;
        if (!(h0 > hf && h0 > hb)) off++;
      }
    }
    // The sidebands move the drawn crest off the peak train's, so a few lose on one side; most mustn't.
    if (checked && off / checked > 0.1) fail(`h${heading} ${kt}kt: ${off}/${checked} breakers aren't on a crest`);

    // 3. Coverage: the footprints cover BREAK_SHARE of Monahan's fraction, within 30%.
    if (heading === 0) {
      let hit = 0; const N = 6000;
      for (let i = 0; i < N; i++) {
        const t = rnd() * SEA_PERIOD_S;
        const bk = breakerAt(rnd() * 400, rnd() * 400, t, kt, windA);
        if (bk) hit++;
      }
      const got = hit / N, want = Math.min(1, BREAK_SHARE * whitecapFraction(kt));
      if (breakChance(kt) < 1 && want > 0.002 && Math.abs(got / want - 1) > 0.3) {
        fail(`${kt}kt: breakers cover ${(got * 100).toFixed(2)}% of the sea, want ${(want * 100).toFixed(2)}%`);
      }
    }
  }
}
setSeaHeading(0);

// 4. A breaker lives inside one epoch, and epochs divide the period, so the wrap can't cut one.
if (BREAK_LIFE_S >= BREAK_EPOCH_S) fail('a breaker outlives its epoch');
if (Math.abs(SEA_PERIOD_S / BREAK_EPOCH_S - Math.round(SEA_PERIOD_S / BREAK_EPOCH_S)) > 1e-9) fail('epochs don\'t divide the sea period');

// 5. The shape: mid-throw the crest stands up and the face ahead of it folds (J well under 1); a
// breaker that has turned to foam has given its shape back to the sea.
{
  const b = { x: 0, y: 0, dir: [1, 0], along: [0, 1], len: 2, height: 0.1, phase: 0.45, kind: 'plunge' };
  let peak = 0, minJ = 1;
  for (let x = -1; x <= 1.5; x += 0.01) { const s = breakerShape(b, x, 0); peak = Math.max(peak, s.dh); minJ = Math.min(minJ, s.J); }
  if (!(peak > 0.08)) fail(`a plunging breaker mid-throw lifts its crest by only ${peak.toFixed(3)} tiles`);
  if (!(minJ < 0.35 && minJ > 0)) fail(`a plunging breaker's face folds to J ${minJ.toFixed(3)}, want 0..0.35`);
  const gone = breakerShape({ ...b, phase: 0.95 }, 0.05, 0);
  if (Math.abs(gone.dh) > 1e-6 || Math.abs(gone.J - 1) > 1e-6) fail('a spent breaker still shapes the sea');
  const end = breakerShape(b, 0.05, 1.01);
  if (Math.abs(end.dh) > 1e-6) fail('a breaker shapes the sea past its own end');
}

// 6. Calm water doesn't break.
if (breakersNear(0, 0, 50, 10, 3, seaAmpsFor(3).wind).length) fail('a 3 kt sea has breakers');

if (fails) { console.log(`breakers: ${fails} failed`); process.exit(1); }
