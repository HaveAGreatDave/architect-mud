// THE GOAL LIGHTS. A goal sets W.lamp to LAMP_T seconds and W.lampSide to the net it went in
// (rink/director.js), and both renderers (rink/render.js, gl/arena.js) ask this for what the
// building looks like while it burns down:
//   · dim: the house lights go down (0 to 1), fast at the horn and back up over the last second
//   · on: the red lamp behind the net is lit this instant. It strobes at 2.5 flashes a second,
//     under the 3 a second that WCAG 2.3.1 allows a red flash, and holds steady instead when the
//     viewer has asked for less motion
//   · wash: how much red light falls over the whole picture this instant
// A replay copies W.lamp with the rest of the frame (rink/replay.js), so it flashes there too.

export const LAMP_T = 4.5;
const PERIOD = 0.4, LIT = 0.18;   // 2.5 Hz, lit for 45% of each

const DARK = { dim: 0, on: false, wash: 0 };

// the viewer's less-motion setting (settings.js prefersReducedMotion, the same test), looked at
// once a second rather than every frame
let calmAt = -1e9, calmWas = false;
function calmNow() {
  const now = globalThis.performance?.now?.() ?? Date.now();
  if (now - calmAt < 1000) return calmWas;
  calmAt = now;
  try {
    calmWas = globalThis.document?.documentElement?.getAttribute?.('data-motion') === 'off'
      || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch { calmWas = false; }
  return calmWas;
}

export function goalLights(W, calm = calmNow()) {
  if (!W || !(W.lamp > 0) || !W.lampSide) return DARK;
  const age = Math.max(0, LAMP_T - W.lamp);
  const dim = Math.min(1, age / 0.35) * Math.min(1, W.lamp / 1.2);
  const on = calm ? true : (age % PERIOD) < LIT;
  const fade = Math.min(1, W.lamp);
  const wash = (calm ? 0.07 : on ? 0.16 : 0.025) * fade;
  return { dim, on, wash };
}
