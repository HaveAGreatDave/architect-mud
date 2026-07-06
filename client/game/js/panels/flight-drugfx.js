// FLIGHT DRUG FX — drug/booze impairment rendered on the out-the-window view.
//
// While you're aboard, being drunk or tripping should be VISIBLE through the
// windscreen: the world sways and double-visions when you're hammered, and
// breathes/streaks/shifts colour when you're tripping. It's a purely cosmetic
// layer — the flight physics never see it (the same principle as turbulence),
// and it only warps the world CANVAS + a colour overlay, leaving the reticle,
// warnings and instruments crisp and readable.
//
// State is fed by the message layer (dispatch.js):
//   • trip_start / trip_fx / trip_end  → setDrugFx('trip', profile, intensity)
//   • intox_fx (level)                 → setDrugFx('intox', 'drunk', level/100)
// The flight sim reads getDrugFx() every frame and paints accordingly. Two
// sources can be live at once (drunk AND tripping); the stronger one drives.

// ── Shared impairment-FX state ────────────────────────────────────────────────
// source ('trip' | 'intox') -> { profile, intensity }
const _sources = new Map();

export function setDrugFx(source, profile, intensity) {
  const i = Math.max(0, Math.min(1, Number(intensity) || 0));
  if (i <= 0.001) { _sources.delete(source); return; }
  _sources.set(source, { profile: profile || 'psychedelic', intensity: i });
}

export function clearDrugFx(source) { _sources.delete(source); }

// The dominant live effect (strongest intensity), or null when sober.
export function getDrugFx() {
  let best = null;
  for (const fx of _sources.values()) if (!best || fx.intensity > best.intensity) best = fx;
  return best;
}

// ── Per-frame flight renderer ─────────────────────────────────────────────────
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

let _eased = 0;         // intensity eased for a smooth come-up / come-down
let _t = 0;             // local FX clock (seconds)
let _lastProfile = 'psychedelic';
// Accessibility: motion-sensitive pilots keep the colour/haze cues but not the
// wobble, breathing, or streak-sweep. `m` gates every time-varying motion term.
const _reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Warp `canvas` (the world render) + drive the colour overlay inside `view`
// (.fsim-view). Call every flight frame; it self-clears when the effect fades.
export function applyFlightDrugFx(view, canvas, dt) {
  if (!view || !canvas) return;
  const fx = getDrugFx();
  const target = fx ? fx.intensity : 0;
  if (fx) _lastProfile = fx.profile;
  _eased += (target - _eased) * Math.min(1, (dt || 0.016) * 2.5);
  _t += (dt || 0.016);

  // Sober (and finished fading) → strip everything and bail.
  if (!fx && _eased < 0.01) { clearFlightDrugFx(view, canvas); return; }

  const i = _eased, t = _t, prof = _lastProfile, m = _reduceMotion ? 0 : 1;
  const ov = ensureOverlay(view);

  if (prof === 'drunk') {
    // Boozy sway: a slow, lolling roll + drift, the world swimming in and out of
    // focus (an oscillating blur — you can't quite fix your eyes on it), a greasy
    // desaturated dimming, and a tunnel vignette that closes toward blackout.
    const sway = (Math.sin(t * 0.9) * 0.6 + Math.sin(t * 0.37 + 1) * 0.4);
    const rot = sway * 3.6 * i * m;
    const tx = Math.sin(t * 0.7) * 11 * i * m;
    const ty = Math.sin(t * 1.1 + 0.5) * 7 * i * m;
    const scale = 1 + 0.05 * i + Math.sin(t * 0.5) * 0.02 * i * m;        // overscan hides the translate edges
    const blur = (1.1 + 0.9 * (0.5 + 0.5 * Math.sin(t * 1.4) * m)) * i;   // focus swims (~can't-focus double-vision feel)
    canvas.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    canvas.style.filter = `blur(${blur.toFixed(2)}px) saturate(${(1 - 0.35 * i).toFixed(2)}) brightness(${(1 - 0.12 * i).toFixed(2)})`;
    ov.className = 'fdfx fdfx-drunk';
    ov.style.opacity = String(clamp(0.25 + 0.75 * i, 0, 1));
    ov.style.setProperty('--fdfx-i', i.toFixed(3));
    // Vignette drifts with the sway so the tunnel lolls around too.
    ov.style.setProperty('--fdfx-cx', (50 + Math.sin(t * 0.6) * 6 * i * m).toFixed(1) + '%');
    ov.style.setProperty('--fdfx-cy', (50 + Math.sin(t * 0.9 + 1) * 5 * i * m).toFixed(1) + '%');
  } else {
    // Psychedelic: the world breathes and melts, colours cycle and oversaturate,
    // and rainbow streaks sweep off the edges (the overlay's conic `from` angle).
    const hue = _reduceMotion ? 40 * i : (t * 42 * (0.4 + 0.6 * i)) % 360;
    const scale = 1 + 0.045 * i + Math.sin(t * 1.3) * 0.045 * i * m;   // breathing
    const skew = Math.sin(t * 0.6) * 4.5 * i * m;
    const rot = Math.sin(t * 0.4) * 1.6 * i * m;
    canvas.style.transform = `rotate(${rot.toFixed(2)}deg) skewX(${skew.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    canvas.style.filter =
      `hue-rotate(${hue.toFixed(1)}deg) saturate(${(1 + 1.3 * i).toFixed(2)}) contrast(${(1 + 0.28 * i).toFixed(2)}) brightness(${(1 + 0.08 * i).toFixed(2)})`;
    ov.className = 'fdfx fdfx-psy';
    ov.style.opacity = String(clamp(0.2 + 0.7 * i, 0, 1));
    ov.style.setProperty('--fdfx-i', i.toFixed(3));
    ov.style.setProperty('--fdfx-hue', hue.toFixed(1));
  }
}

// Remove the warp + overlay (sobered up, or the sim closed).
export function clearFlightDrugFx(view, canvas) {
  if (canvas) { canvas.style.transform = ''; canvas.style.filter = ''; }
  const ov = view && view.querySelector('.fdfx');
  if (ov) ov.remove();
  _eased = 0; _t = 0;
}

function ensureOverlay(view) {
  let ov = view.querySelector('.fdfx');
  if (!ov) {
    ensureStyles();
    ov = document.createElement('div');
    ov.className = 'fdfx';
    // Sits above the world canvas but below the reticle/warnings (z 4–5) so
    // aiming and annunciators stay legible through the haze.
    view.appendChild(ov);
  }
  return ov;
}

function ensureStyles() {
  if (document.getElementById('fdfx-styles')) return;
  const st = document.createElement('style'); st.id = 'fdfx-styles';
  st.textContent = `
    .fdfx { position:absolute; inset:0; z-index:2; pointer-events:none; }
    /* Drunk: a warm tunnel that closes as you approach blackout. */
    .fdfx-drunk {
      background:
        radial-gradient(ellipse 78% 78% at var(--fdfx-cx,50%) var(--fdfx-cy,50%),
          transparent calc(48% - 34% * var(--fdfx-i,0)),
          rgba(30,12,6, calc(0.55 * var(--fdfx-i,0))) calc(78% - 20% * var(--fdfx-i,0)),
          rgba(6,3,2, calc(0.9 * var(--fdfx-i,0))) 100%),
        linear-gradient(0deg, rgba(70,40,20, calc(0.10 * var(--fdfx-i,0))), transparent);
    }
    /* Psychedelic: rotating rainbow streaks bleeding off the edges + a colour wash. */
    .fdfx-psy {
      background:
        conic-gradient(from calc(var(--fdfx-hue,0) * 1deg) at 50% 50%,
          hsla(0,90%,60%,0.0), hsla(60,90%,60%,0.5), hsla(140,90%,60%,0.0),
          hsla(200,90%,60%,0.5), hsla(280,90%,60%,0.0), hsla(340,90%,60%,0.5), hsla(360,90%,60%,0.0)),
        radial-gradient(circle at 50% 50%, transparent 30%, hsla(calc(var(--fdfx-hue,0)*1deg + 40),90%,55%,0.28) 100%);
      mix-blend-mode: screen;
      -webkit-mask: radial-gradient(circle at 50% 50%, transparent 22%, #000 78%);
              mask: radial-gradient(circle at 50% 50%, transparent 22%, #000 78%);
    }
  `;
  document.head.appendChild(st);
}
