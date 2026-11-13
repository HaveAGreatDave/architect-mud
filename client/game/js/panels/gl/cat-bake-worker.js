// The worker behind gl/cat-bake.js: carves one pose of one cat and sends back the bake's arrays and the bones' pose,
// leaving out the rig and the look, which hold functions and are rebuilt on the other side.
import { bakeCat } from './cat-kit.js';

self.onmessage = ({ data: { id, look, pose, o } }) => {
  try {
    const b = bakeCat(look, pose, o);
    const { rig, look: _l, pose: _p, ...rest } = b;
    const moved = [rest.P, rest.N, rest.C, rest.F, rest.M, rest.Wb, rest.Ww, rest.Bm, rest.Rest, rest.Q].map((a) => a.buffer);
    self.postMessage({ id, bake: rest }, moved);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
