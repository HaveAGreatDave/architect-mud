// THE GATE FOR THE BRAKK WOLVERINE'S COCKPIT (client/shared/interior-wolverine.js).
//
// The class's questions are cockpit-hovercar-lib.mjs's. What is the Wolverine's own: its lift is a
// lever on the floor that you drag, its speed is a ribbon and its height a counter, and the fans'
// tachometer stands on top of the dash without getting in the way of the road.
// `node scripts/shapes/cockpit-wolverine.mjs`, exit 1 on failure.
import { runCockpitGate } from './cockpit-hovercar-lib.mjs';
import { wolverineProfile } from '../../client/shared/interior-wolverine.js';
import { WOLVERINE } from '../../client/shared/cabin-wolverine.js';

runCockpitGate({
  id: 'wolverine', label: 'Brakk Wolverine', profile: wolverineProfile, cabin: WOLVERINE,
  pedalAt: [0, 0.7, 0.12], lift: 'drag', budget: [2500, 12000],
  extra({ P, ok, REST, sig, near, grip, shellFaces }) {
    // The lever goes where the lift is: its grip moves fore and aft, and the shaft is drawn to it.
    const g0 = grip('throttle', { ...REST, throttle: 0 }), g1 = grip('throttle', { ...REST, throttle: 1 });
    ok(g1[1] - g0[1] > 0.15, 'the lift lever does not travel forward with the lift (' + (g1[1] - g0[1]).toFixed(2) + ' m)');
    const fa = near(shellFaces(P, { ...REST, throttle: 0 }, { rich: true }), g0, 0.12), fb = near(shellFaces(P, { ...REST, throttle: 0 }, { rich: true }), g1, 0.12);
    ok(fa.length > 6 && fa.length > fb.length, 'the lever is not drawn where its grip is');
    // The ribbon, the counter, the bars and the tachometer each move with their reading.
    for (const [k, a, b, at] of [['ias', 0, 200, 'ck:hud'], ['alt', 0, 700, 'ck:hud'], ['fuel', 0.2, 1, 'ck:hud'], ['throttle', 0, 1, 'ck:hud'], ['rpm', 0.1, 1, 'ck:hud']]) {
      const c = grip(at, REST).map((v, i) => (i === 0 ? 0 : v));
      const f0 = near(shellFaces(P, { ...REST, [k]: a }, { rich: true }), c, 0.32), f1 = near(shellFaces(P, { ...REST, [k]: b }, { rich: true }), c, 0.32);
      ok(f0.length > 20 && Math.abs(sig(f0) - sig(f1)) > 1e-6, k + ': its gauge does not move');
    }
    // A rocker tips: it stands differently on and off.
    const c = grip('ck:land', REST);
    const off = near(shellFaces(P, { ...REST, landingLight: false }, { rich: true }), c, 0.04), on = near(shellFaces(P, { ...REST, landingLight: true }, { rich: true }), c, 0.04);
    ok(off.length > 4 && Math.abs(sig(off) - sig(on)) > 1e-6, 'the LIGHTS rocker does not tip');
  },
});
