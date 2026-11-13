// The shared look of falling weather (client/shared/precip-look.js), which the room overlay, the
// windscreen and the hangar backdrops all draw from. Checks the model's promises and that every
// 2D painter runs on a bare canvas context without throwing. No DOM, so the sprites are null and
// the painters take their stroke fallback.
import {
  precipKind, rainRGB, rainLit, glintAmount, dropSize, RAIN_DAY, RAIN_NIGHT,
  paintRain2D, paintSnow2D, paintFogBand, paintFlash2D,
} from '../../client/shared/precip-look.js';
import { lightAt, nightAt } from '../../client/shared/sky-keys.js';

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.error('FAIL', msg); } };

// what falls
for (const [t, want] of [['rain', 'rain'], ['storm', 'rain'], ['thunderstorm', 'rain'], ['acid', 'rain'], ['drizzle', 'rain'],
  ['snow', 'snow'], ['blizzard', 'snow'], ['ash', 'ash'], ['none', null], ['', null], [undefined, null], ['fog', null]]) {
  check(precipKind(t) === want, `precipKind(${t}) is ${precipKind(t)}, want ${want}`);
}
// sleet is snow, as the ground counts it (ground-accum.js SNOW_PTYPES)
check(precipKind('sleet') === 'snow', 'sleet is snow');
// the shared daylight every view dims by
check(lightAt(12) === 1 && lightAt(0) === 0 && lightAt(18.5) > 0 && lightAt(18.5) < 1, 'lightAt: day, night and a dusk between');
check(nightAt(22) && nightAt(3) && !nightAt(12) && !nightAt(9) && !nightAt(undefined), 'nightAt: lamps on at night only');
// light: the ends are the named colours, night is dimmer, glints only after dark
check(rainRGB(1).join() === RAIN_DAY.join(), 'rain at noon is RAIN_DAY');
check(rainRGB(0).join() === RAIN_NIGHT.join(), 'rain at night is RAIN_NIGHT');
check(rainLit(0) < rainLit(1) && rainLit(0) > 0.3, 'night rain is dimmer but still shows');
check(glintAmount(1) === 0 && glintAmount(0) === 1, 'lamp glint is night-only');
check(rainRGB(0.5, { acid: true })[1] > rainRGB(0.5)[1], 'acid rain is greener');
// size: nearer and heavier is longer, and a drop stays a streak, not a rod
for (const I of [0, 0.5, 1]) {
  check(dropSize(1, I).len > dropSize(0, I).len, `near drops longer than far at I=${I}`);
  check(dropSize(1, I).len <= 32, `nearest drop at I=${I} is ${dropSize(1, I).len.toFixed(1)} px, over 32`);
  check(dropSize(1, I).wid <= 1.6, `nearest drop at I=${I} is ${dropSize(1, I).wid} px wide, over 1.6`);
}
check(dropSize(0.5, 1).len > dropSize(0.5, 0).len, 'heavier rain has longer streaks');

// the painters run on a stub context
const noop = () => {};
const ctx = new Proxy({ globalAlpha: 1 }, {
  get: (o, k) => (k in o ? o[k] : k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop),
  set: (o, k, v) => { o[k] = v; return true; },
});
try {
  for (const light of [0, 0.5, 1]) {
    paintRain2D(ctx, { x: 10, y: 10, w: 400, h: 300, t: 12.3, rate: 0.7, windKph: 30, light, ground: 250, groundBot: 310, acid: light === 0.5 });
    paintSnow2D(ctx, { w: 400, h: 300, t: 4, rate: 0.6, windKph: 50, light });
    paintFogBand(ctx, { w: 400, yBot: 300, h: 120, amount: 0.4, light });
    paintFlash2D(ctx, { w: 400, h: 300, flash: 0.8 });
  }
  paintRain2D(ctx, { w: 0, h: 0, t: 0 });
} catch (e) { fails++; console.error('FAIL a painter threw', e); }
check(ctx.globalAlpha === 1, 'painters restore globalAlpha');

if (fails) { console.error(`precip-look: ${fails} failed`); process.exit(1); }
