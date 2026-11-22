// THE GATE FOR THE HALLARD LANNER'S COCKPIT (client/shared/interior-lanner.js).
//
// The class's questions are cockpit-hovercar-lib.mjs's. What is the Lanner's own: its lift is on two
// stalks behind the wheel, its dials are needles that have to swing, and its toggles have to flick.
// `node scripts/shapes/cockpit-lanner.mjs`, exit 1 on failure.
import { runCockpitGate } from './cockpit-hovercar-lib.mjs';
import { lannerProfile } from '../../client/shared/interior-lanner.js';
import { LANNER } from '../../client/shared/cabin-lanner.js';

runCockpitGate({
  id: 'lanner', label: 'Hallard Lanner', profile: lannerProfile, cabin: LANNER,
  pedalAt: [0, 0.66, 0.12], lift: 'click', budget: [2500, 12000],
  extra({ P, ok, REST, sig, near, grip, shellFaces }) {
    // Each dial's needle swings: the faces round the board in front of the driver differ with its reading.
    const board = (live) => near(shellFaces(P, live, { rich: true }), grip('ck:boost', REST), 0.3);
    for (const [k, a, b] of [['ias', 0, 200], ['alt', 0, 700], ['fuel', 0.2, 1], ['rpm', 0.1, 1], ['throttle', 0, 1]]) {
      const centre = k === 'fuel' || k === 'rpm' || k === 'throttle' ? grip('ck:gps', REST) : grip('ck:boost', REST);
      const fa = near(shellFaces(P, { ...REST, [k]: a }, { rich: true }), centre, 0.3), fb = near(shellFaces(P, { ...REST, [k]: b }, { rich: true }), centre, 0.3);
      ok(fa.length > 20 && Math.abs(sig(fa) - sig(fb)) > 1e-6, k + ': its dial does not move');
    }
    ok(board(REST).length > 100, 'the driver\'s board is nearly empty');
    // A toggle is a lever: it stands differently on and off.
    const c = grip('ck:land', REST);
    const off = near(shellFaces(P, { ...REST, landingLight: false }, { rich: true }), c, 0.04), on = near(shellFaces(P, { ...REST, landingLight: true }, { rich: true }), c, 0.04);
    ok(off.length > 4 && Math.abs(sig(off) - sig(on)) > 1e-6, 'the LIGHTS toggle does not flick');
  },
});
