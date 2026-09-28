// Murmuration wash: the count→level curve (client/game/js/panels/murmur-audio.js).
//
// The wash is the one layer of the murmuration bed whose level follows the head count. What can go
// wrong silently: the curve inverting (big flocks quieter), flattening (every flock the same), or
// going linear (twenty thousand birds 160 times louder than 120). No AudioContext is needed.
import { washLevelDb } from '../../client/game/js/panels/murmur-audio.js';

let fail = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fail++; };

const at = (n) => washLevelDb(n);
const lo = at(120), hi = at(20000);
check(Math.abs(lo - -30) < 1e-9 && Math.abs(hi - -4) < 1e-9, `anchors: 120 birds ${lo.toFixed(1)} dB, 20,000 birds ${hi.toFixed(1)} dB`);

let mono = true;
for (let n = 120; n < 20000; n *= 1.3) if (!(at(n * 1.3) >= at(n))) mono = false;
check(mono, 'louder with every increase in count');

// Log, not linear: each doubling adds the same number of dB.
const steps = [150, 300, 600, 1200, 2400, 4800].map((n) => at(n * 2) - at(n));
const spread = Math.max(...steps) - Math.min(...steps);
check(spread < 1e-9 && steps[0] > 2, `each doubling adds a constant ${steps[0].toFixed(2)} dB`);

check(at(1) === lo && at(1e6) === hi, 'clamped outside the anchors');

if (fail) { console.log(`murmur-smoke: ${fail} FAILED`); process.exit(1); }
console.log('murmur-smoke: all passed');
