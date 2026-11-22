// THE GATE FOR THE MINIM PIPIT'S COCKPIT (client/shared/interior-pipit.js).
//
// The class's questions are cockpit-hovercar-lib.mjs's. What is the Pipit's own: one dial in the
// middle of the car carries the speed, the height, the charge, the lift and the fans, so each has
// to move it; the lift is on two thumb keys that turn with the wheel; and the eight piano keys tip.
// `node scripts/shapes/cockpit-pipit.mjs`, exit 1 on failure.
import { runCockpitGate } from './cockpit-hovercar-lib.mjs';
import { pipitProfile } from '../../client/shared/interior-pipit.js';
import { PIPIT } from '../../client/shared/cabin-pipit.js';

runCockpitGate({
  id: 'pipit', label: 'Minim Pipit', profile: pipitProfile, cabin: PIPIT,
  pedalAt: [0, 0.72, 0.13], lift: 'click', budget: [2500, 12000],
  extra({ P, ok, REST, sig, near, grip, shellFaces }) {
    // The one dial: everything it shows moves it. It stands on the tray in the middle of the car.
    const c = [P.xCentre, 0.8, grip('ck:gps', REST)[2]];
    for (const [k, a, b] of [['ias', 0, 160], ['alt', 0, 700], ['fuel', 0.2, 1], ['throttle', 0, 1], ['rpm', 0.1, 1]]) {
      const f0 = near(shellFaces(P, { ...REST, [k]: a }, { rich: true }), c, 0.16), f1 = near(shellFaces(P, { ...REST, [k]: b }, { rich: true }), c, 0.16);
      ok(f0.length > 20 && Math.abs(sig(f0) - sig(f1)) > 1e-6, k + ': the dial does not show it');
    }
    // The thumb keys ride the wheel.
    const t0 = grip('ck:padUp', { ...REST, stickX: -1 }), t1 = grip('ck:padUp', { ...REST, stickX: 1 });
    ok(Math.hypot(...t0.map((v, i) => v - t1[i])) > 0.05, 'the lift keys do not turn with the wheel');
    // A piano key tips: a circuit's key sits differently on and off.
    const kc = grip('ck:land', REST);
    const off = near(shellFaces(P, { ...REST, landingLight: false }, { rich: true }), kc, 0.05), on = near(shellFaces(P, { ...REST, landingLight: true }, { rich: true }), kc, 0.05);
    ok(off.length > 4 && Math.abs(sig(off) - sig(on)) > 1e-6, 'the LIGHTS key does not tip');
  },
});
