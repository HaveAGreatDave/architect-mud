// Flare and float diagnostic: how each fixed-wing type arrives. Each type is settled on a powered
// 3° final at `k`·Vs0 with full flap, then brought down to the deck; at the flare height the pilot
// cuts the power and eases the yoke back. Prints the sink rate at the wheels and how far she floated
// from the flare to touchdown. Runs at 1.3·Vs0 (on speed) and 1.6·Vs0 (fast), and with the deck at
// sea level and on a 1,700 ft roof, which must agree.
//   node scripts/flare-tune.mjs [typeId]
import { TYPES, createState, step } from '../client/game/js/panels/flight-model.js';
const DT = 1 / 60, FT_PER_NM = 6076;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The yoke flies speed (speed error moves a pitch target, pitch error moves the yoke); the throttle
// is fixed, found by bisection so the settled final is a 3° path.
function fly(s, ctl, vApp) {
  ctl.pitchTgt = clamp(ctl.pitchTgt + (s.airspeed - vApp) * 0.5 * DT - s.vs * 0.00002, -15, 15);
  ctl.elev = clamp(0.15 * (ctl.pitchTgt - s.pitch), -1, 1);
}
function settle(p, vApp, thr, deck) {
  const s = createState(p);
  s.onGround = false; s.groundFt = deck; s.altitude = deck + 3000; s.airspeed = vApp;
  const ctl = { pitchTgt: 0, elev: 0, thr };
  for (let t = 0; t < 80; t += DT) {
    fly(s, ctl, vApp);
    step(s, { elevator: ctl.elev, throttle: thr, flaps: 1, power: true }, p, DT);
    s.altitude = deck + 3000;
  }
  return { s, ctl };
}

export function arrival(p, k, deck, flareFt = 20) {
  const vApp = p.vs0 * k, vsWant = -vApp * 101.33 * Math.sin(3 * Math.PI / 180);
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (settle(p, vApp, mid, deck).s.vs < vsWant) lo = mid; else hi = mid;
  }
  const { s, ctl } = settle(p, vApp, (lo + hi) / 2, deck);
  const inp = () => ({ elevator: ctl.elev, aileron: 0, throttle: ctl.thr, flaps: 1, power: true, pedal: 0 });
  s.altitude = deck + 150;
  let flared = false, float = 0, vsLast = 0, flareT = 0;
  for (let t = 0; t < 300; t += DT) {
    if (!flared && s.altitude - deck <= flareFt) flared = true;
    if (!flared) fly(s, ctl, vApp);
    else { ctl.thr = 0; flareT += DT; ctl.elev = clamp(ctl.elev + DT * 0.6, -1, 0.45); }
    vsLast = s.vs;
    step(s, inp(), p, DT);
    if (flared) float += s.airspeed * DT / 3600 * FT_PER_NM;
    if (s.onGround) return { vs: vsLast, float, spd: s.airspeed, flareT };
  }
  return { vs: NaN, float: NaN, spd: NaN, flareT: NaN };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  for (const [id, p] of Object.entries(TYPES)) {
    if (only && id !== only) continue;
    if (p.heli || p.ground || p.water || !p.vs0) continue;
    const row = [];
    for (const [k, deck] of [[1.3, 0], [1.6, 0], [1.3, 1700]]) {
      const r = arrival(p, k, deck);
      row.push(`${k}${deck ? ' roof' : '     '} ${String(Math.round(r.vs)).padStart(5)} fpm ${String(Math.round(r.float)).padStart(5)} ft`);
    }
    console.log(`${id.padEnd(12)} ${row.join('  | ')}`);
  }
}
