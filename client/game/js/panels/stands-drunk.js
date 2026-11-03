// Drunk in a box. The seat draws on the page body, not in the area pane, so the drunk warp in
// flight-drugfx.js never reaches it; this reads the same level (setDrugFx('intox', 'drunk', …),
// fed by the intoxication plugin's intox_fx) and bends the box's own picture.
//
// It builds in stages, each easing in over the one before:
//   a drink or two   warm and soft, and the lamps and the field lights bloom
//   a few more       you can't hold focus, the picture swims, the room leans
//   walking drunk    the lean gets worse on your feet, and you drift off line
//   heavy            the edges close in; the blackout itself is the plugin's curtain (z 9999)
import { getDrugFx } from './flight-drugfx.js';
import { prefersReducedMotion } from '../../../shared/settings.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// 0 below a, 1 above b, smooth between
const ramp = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function createDrunk(root, host, { walking = () => false } = {}) {
  let raf = 0, last = 0, t = 0, eased = 0, gait = 0, on = false;
  // The bloom: a blurred, brightened copy of what's behind it, screened over the picture, so
  // the bright things (lamps, the field lights, the screen) spill and the dark stays dark.
  const glow = document.createElement('div');
  glow.className = 'st-drunk-glow';
  // the warm tint and the closing edges
  const tint = document.createElement('div');
  tint.className = 'st-drunk-tint';
  for (const el of [glow, tint]) { el.hidden = true; host.after(el); }

  const level = () => { const fx = getDrugFx(); return fx && fx.profile === 'drunk' ? fx.intensity : 0; };
  const off = () => {
    for (const p of ['transform', 'filter']) host.style.removeProperty(p);
    glow.hidden = tint.hidden = true; on = false; eased = 0; gait = 0; t = 0;
  };

  const frame = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60; last = now;
    const want = level();
    eased += (want - eased) * Math.min(1, dt * 1.5);
    gait += ((walking() ? 1 : 0) - gait) * Math.min(1, dt * 3);
    t += dt;
    if (want <= 0 && eased < 0.01) { off(); last = 0; return; }
    on = true;
    const i = eased, m = prefersReducedMotion() ? 0 : 1;
    const warm = ramp(i, 0, 0.3);      // the first drink
    const blur = ramp(i, 0.3, 0.65);   // can't fix your eyes on it
    const heavy = ramp(i, 0.65, 1);    // the edges going

    // The lean. Barely there sitting down early on, much worse on your feet.
    const lean = (0.15 * warm + 0.6 * blur + 0.6 * heavy) * (1 + 1.8 * gait) * m;
    const sway = Math.sin(t * 0.9) * 0.6 + Math.sin(t * 0.37 + 1) * 0.4;
    const rot = sway * 2.4 * lean;
    const tx = (Math.sin(t * 0.7) * 9 + Math.sin(t * 2.6) * 3 * gait) * lean;
    const ty = (Math.sin(t * 1.1 + 0.5) * 6 + Math.abs(Math.sin(t * 3.4)) * 5 * gait) * lean;
    const scale = 1 + 0.02 * warm + 0.05 * Math.min(1, lean);   // overscan hides the edges the lean shows
    host.style.setProperty('transform', `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`, 'important');
    const px = 0.35 * warm + (1.2 + 1.3 * (0.5 + 0.5 * Math.sin(t * 1.4) * m)) * blur + 1.2 * heavy;
    host.style.setProperty('filter',
      `blur(${px.toFixed(2)}px) sepia(${(0.22 * warm + 0.1 * blur).toFixed(2)}) saturate(${(1 + 0.25 * warm - 0.4 * heavy).toFixed(2)}) brightness(${(1 + 0.06 * warm - 0.15 * heavy).toFixed(2)})`, 'important');

    glow.hidden = tint.hidden = false;
    // under the bar, over the picture
    root.style.setProperty('--sd-top', `${host.offsetTop}px`);
    glow.style.opacity = (0.55 * warm + 0.25 * blur).toFixed(3);
    glow.style.setProperty('--sd-blur', `${(8 + 10 * blur).toFixed(1)}px`);
    // the second image of double vision rides on the glow once you're properly drunk
    const dx = (Math.sin(t * 0.8) * 6 + 4) * blur * m;
    glow.style.transform = `translate(${dx.toFixed(1)}px, ${(dx * 0.3).toFixed(1)}px)`;
    tint.style.setProperty('--sd-warm', (0.18 * warm).toFixed(3));
    tint.style.setProperty('--sd-dark', (0.25 * blur + 0.7 * heavy).toFixed(3));
    tint.style.setProperty('--sd-open', `${(78 - 22 * blur - 30 * heavy).toFixed(1)}%`);
    raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
  // the level changes on a server message, so look for it a few times a second while sober
  const poll = setInterval(() => { if (!on && level() > 0) kick(); }, 400);
  kick();
  return {
    stop() { clearInterval(poll); if (raf) cancelAnimationFrame(raf); raf = 0; off(); glow.remove(); tint.remove(); },
  };
}
