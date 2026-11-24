// A ROOM'S LIGHT, FOR SOMETHING DRAWN IN IT IN GLASS (one-world, docs/proposals/one-world-interiors.md). The uniforms
// gl/room-light.js's ROOM_LIGHT_GLSL reads, filled from a room's own lamps rather than the Room Stage's whole light: the
// close-up figure (gl/street-hd.js drawRoom) and a cat (gl/cat-layer.js) drawn in a room walked in GLASS both take it.
// No panes and no next door: GLASS draws the day through the windows itself. `uStreet` hands GLASS's float target linear
// light and leaves out the Stage's vignette.
import { LIN } from './colour.js';

const LAMPS = 14;
// filled again every draw (uniform*fv copies them, so one set does every program and context)
const LP = new Float32Array(LAMPS * 3), LK = new Float32Array(LAMPS), TINT = new Float32Array(LAMPS * 3), NO_ROOM = new Float32Array(LAMPS);

// `P.u(name)` a program's uniform; `env.eye` in the room's frame, `env.lamps` [{ p, k, c }] there too (a lamp's
// strength about 1 at a couple of metres), `env.amb` the room's all-round light; cssW, cssH the picture.
export function setRoomLight(gl, P, env, cssW, cssH) {
  gl.uniform3fv(P.u('uEye'), env.eye);
  const lp = LP.fill(0), lk = LK.fill(0), tint = TINT.fill(1);
  let n = 0;
  for (const q of env.lamps || []) {
    if (n >= LAMPS) break;
    lp.set(q.p, n * 3);
    lk[n] = (q.k ?? 1) * (1 + 1.1 * 2.5 * 2.5);
    tint.set(q.c || [1, 0.92, 0.8], n * 3);
    n++;
  }
  gl.uniform3fv(P.u('uLampP'), lp);
  gl.uniform1fv(P.u('uLampK'), lk);
  gl.uniform1fv(P.u('uLampRoom'), NO_ROOM);
  gl.uniform1i(P.u('uLampN'), n);
  gl.uniform1i(P.u('uLampHome'), n);
  gl.uniform1i(P.u('uNextN'), 0);
  gl.uniform3f(P.u('uLampC'), 1, 1, 1);
  gl.uniform3fv(P.u('uLampTint'), tint);
  gl.uniform1i(P.u('uLampTinted'), 1);
  gl.uniform1i(P.u('uWinCount'), 0);
  gl.uniform3f(P.u('uWinC'), 0.8, 0.85, 0.95);
  gl.uniform4f(P.u('uAnnex'), 0, 0, 0, 0);
  gl.uniform1f(P.u('uOutZ'), 1e9);
  gl.uniform3f(P.u('uOutRing'), -1e9, 1e9, -1e9);
  const a = env.amb || [0.12, 0.12, 0.13];
  gl.uniform3f(P.u('uAmb'), a[0], a[1], a[2]);
  gl.uniform1f(P.u('uExpo'), 1.15);
  gl.uniform1f(P.u('uComic'), 1);
  gl.uniform2f(P.u('uRes'), cssW, cssH);
  gl.uniform1f(P.u('uStreet'), LIN.out ? 2 : 1);
}
