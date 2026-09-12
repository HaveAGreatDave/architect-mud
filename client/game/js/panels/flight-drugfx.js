import { prefersReducedMotion } from '/shared/settings.js';
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
const _reduceMotion = () => prefersReducedMotion();

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

  const i = _eased, t = _t, prof = _lastProfile, m = _reduceMotion() ? 0 : 1;
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
  } else if (prof === 'dissociative') {
    // You are not in the aircraft, you are watching a recording of it. The world
    // DRIFTS rather than sways — a slow slide that never comes back to centre the
    // way the drunk lean does — the colour goes, and the scale is wrong in a way
    // you cannot argue with. No vignette: the complaint is distance, not closure.
    const dx = Math.sin(t * 0.21) * 26 * i * m + Math.sin(t * 0.07 + 2) * 14 * i * m;
    const dy = Math.sin(t * 0.17 + 1.2) * 16 * i * m;
    const scale = 1 + 0.09 * i - Math.sin(t * 0.13) * 0.05 * i * m;
    canvas.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(3)})`;
    canvas.style.filter = `saturate(${(1 - 0.7 * i).toFixed(2)}) contrast(${(1 - 0.18 * i).toFixed(2)}) brightness(${(1 + 0.06 * i).toFixed(2)}) blur(${(0.5 * i).toFixed(2)}px)`;
    ov.className = 'fdfx fdfx-diss';
    ov.style.opacity = String(clamp(0.2 + 0.6 * i, 0, 1));
    ov.style.setProperty('--fdfx-i', i.toFixed(3));
  } else if (prof === 'opiate') {
    // Heavy and warm, and getting smaller. Almost no lateral motion — an opiate
    // does not make the world move, it makes you stop caring that it does — so
    // this is a slow sag, a thickening blur and a tunnel that keeps closing.
    const sag = Math.sin(t * 0.28) * 4 * i * m;
    const scale = 1 + 0.03 * i;
    canvas.style.transform = `translate(0px, ${sag.toFixed(2)}px) scale(${scale.toFixed(3)})`;
    canvas.style.filter = `blur(${(1.4 * i).toFixed(2)}px) saturate(${(1 - 0.45 * i).toFixed(2)}) brightness(${(1 - 0.2 * i).toFixed(2)}) sepia(${(0.3 * i).toFixed(2)})`;
    ov.className = 'fdfx fdfx-opiate';
    ov.style.opacity = String(clamp(0.3 + 0.7 * i, 0, 1));
    ov.style.setProperty('--fdfx-i', i.toFixed(3));
  } else if (prof === 'stimulant') {
    // Too much of everything. Over-sharp, over-bright, and never quite still —
    // a fast micro-shake rather than a sway, because the problem is not balance.
    // ⚠ The shake is a continuous sine, not a step: a hard flicker at this rate
    // is a photosensitivity risk and no dose is worth one.
    const jx = Math.sin(t * 13.0) * 1.6 * i * m + Math.sin(t * 7.3) * 0.9 * i * m;
    const jy = Math.sin(t * 11.4 + 1) * 1.3 * i * m;
    const scale = 1 + 0.012 * i;
    canvas.style.transform = `translate(${jx.toFixed(2)}px, ${jy.toFixed(2)}px) scale(${scale.toFixed(3)})`;
    canvas.style.filter = `saturate(${(1 + 0.9 * i).toFixed(2)}) contrast(${(1 + 0.5 * i).toFixed(2)}) brightness(${(1 + 0.14 * i).toFixed(2)})`;
    ov.className = 'fdfx fdfx-stim';
    ov.style.opacity = String(clamp(0.15 + 0.5 * i, 0, 1));
    ov.style.setProperty('--fdfx-i', i.toFixed(3));
  } else if (prof === 'deliriant') {
    // The worst one to fly on, and it does not announce itself. Barely any warp
    // — a murky, under-lit, slightly-wrong picture — because the deliriant
    // illusion is that nothing is wrong with your eyes. What moves is at the
    // edge, and the overlay is where it lives.
    const dx = Math.sin(t * 0.41) * 3 * i * m;
    canvas.style.transform = `translate(${dx.toFixed(2)}px, 0px) scale(${(1 + 0.02 * i).toFixed(3)})`;
    canvas.style.filter = `saturate(${(1 - 0.4 * i).toFixed(2)}) brightness(${(1 - 0.26 * i).toFixed(2)}) contrast(${(1 + 0.2 * i).toFixed(2)})`;
    ov.className = 'fdfx fdfx-delir';
    ov.style.opacity = String(clamp(0.25 + 0.65 * i, 0, 1));
    ov.style.setProperty('--fdfx-i', i.toFixed(3));
    ov.style.setProperty('--fdfx-cx', (50 + Math.sin(t * 0.33) * 22 * m).toFixed(1) + '%');
    ov.style.setProperty('--fdfx-cy', (50 + Math.sin(t * 0.27 + 2) * 18 * m).toFixed(1) + '%');
  } else {
    // Psychedelic: the world breathes and melts, colours cycle and oversaturate,
    // and rainbow streaks sweep off the edges (the overlay's conic `from` angle).
    const hue = _reduceMotion() ? 40 * i : (t * 42 * (0.4 + 0.6 * i)) % 360;
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
    /* Dissociative: a cold grey wash with the edges going soft, and no vignette —
       the complaint is that everything is far away, not that it is closing in. */
    .fdfx-diss {
      background:
        radial-gradient(ellipse 90% 90% at 50% 50%,
          rgba(120,140,170, calc(0.06 * var(--fdfx-i,0))) 0%,
          rgba(70,86,110, calc(0.30 * var(--fdfx-i,0))) 100%);
    }
    /* Opiate: warm, heavy, and closing. The tunnel is tighter than the drunk one
       and does not loll — it just keeps shutting. */
    .fdfx-opiate {
      background:
        radial-gradient(ellipse 70% 70% at 50% 50%,
          transparent calc(38% - 30% * var(--fdfx-i,0)),
          rgba(36,18,8, calc(0.6 * var(--fdfx-i,0))) calc(70% - 22% * var(--fdfx-i,0)),
          rgba(8,4,2, calc(0.95 * var(--fdfx-i,0))) 100%),
        linear-gradient(0deg, rgba(120,70,30, calc(0.12 * var(--fdfx-i,0))), transparent);
    }
    /* Stimulant: a hot bright rim, as if the instruments were being overdriven.
       No motion of its own — the canvas underneath is already shaking. */
    .fdfx-stim {
      background:
        radial-gradient(ellipse 96% 96% at 50% 50%,
          transparent 55%,
          hsla(48,100%,60%, calc(0.16 * var(--fdfx-i,0))) 100%);
      mix-blend-mode: screen;
    }
    /* Deliriant: a murk that is DARKEST somewhere other than the middle, and the
       somewhere moves. That drifting centre is the whole effect — there is
       something in the corner of the canopy and it is not staying in one corner. */
    .fdfx-delir {
      background:
        radial-gradient(ellipse 60% 60% at var(--fdfx-cx,50%) var(--fdfx-cy,50%),
          rgba(10,14,10, calc(0.42 * var(--fdfx-i,0))) 0%,
          transparent 62%),
        linear-gradient(180deg, rgba(18,24,18, calc(0.22 * var(--fdfx-i,0))), transparent 60%);
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
