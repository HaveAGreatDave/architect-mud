// Shared plumbing for the client-side minigame overlays — Circuit Breach
// (circuithack.js), Hololock Bypass (hololock.js), Vault Crack (vaultcrack.js),
// and Synth Lab (synthlab.js). Each game keeps its own board, styles, and
// win/lose logic; this module only holds the pieces that were copy-pasted
// verbatim across all of them: the guarded SFX call, the skill-tunable clamps,
// the HTML escaper, and the fullscreen-overlay mount/teardown boilerplate.

// Fire a one-shot SFX through the shared engine's bus, guarded — silent if the
// audio engine hasn't initialised. Accepts either a catalog cue id (string) —
// resolved through window.SFXCatalog so dev-panel overrides apply — or a raw
// synth def object (for dynamic, parameterised one-shots that aren't catalogued).
export function sfx(idOrDef) {
  try {
    const def = typeof idOrDef === 'string' ? window.SFXCatalog?.get(idOrDef) : idOrDef;
    if (def) window.AudioEngine?.playSfx(def);
  } catch { /* no audio */ }
}

export const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
export const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Physical-device chrome ───────────────────────────────────────────────────
// Shared "hardware" dressing modelled directly on the ATM terminal (#atm-box):
// a moulded top-lit chassis, a branded chassis head (glowing mark + nameplate +
// bolt + close), a recessed bezel cradling a bulged-glass CRT, and a physical
// deck strip. Accent-only tinting comes from each overlay's --mg-accent; the
// shell base hue is set per game via --mg-base. Inject once with
// ensureChassisStyles(); compose with deviceHeader() / bezelScrews() /
// crtOverlays() / deckStrip().
export function ensureChassisStyles() {
  if (document.getElementById('minigame-chassis-styles')) return;
  const s = document.createElement('style');
  s.id = 'minigame-chassis-styles';
  s.textContent = `
    /* Moulded terminal housing — the ATM's top-lit multi-stop shell + layered
       shadow. --mg-base is the dark body hue; accent only tints the outer glow. */
    .mg-chassis { position:relative; border:1px solid #05070a; border-radius:20px;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(0,0,0,0.5),
        0 18px 50px rgba(0,0,0,0.72), 0 0 40px color-mix(in srgb, var(--mg-accent,#fff) 16%, transparent); }
    /* Branded chassis head: glowing mark, nameplate, subtitle, a bolt + close. */
    .mg-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding:2px 2px 0; }
    .mg-brandplate { display:flex; align-items:center; gap:8px; }
    .mg-brand-mark { font-size:16px; color:var(--mg-accent,#fff); text-shadow:0 0 9px color-mix(in srgb, var(--mg-accent,#fff) 70%, transparent); animation:mg-mark-breathe 3.2s ease-in-out infinite; }
    @keyframes mg-mark-breathe { 0%,100%{text-shadow:0 0 9px color-mix(in srgb, var(--mg-accent,#fff) 65%, transparent)} 50%{text-shadow:0 0 17px color-mix(in srgb, var(--mg-accent,#fff) 95%, transparent)} }
    .mg-brand-text { display:flex; flex-direction:column; line-height:1.15; }
    .mg-brand-name { font-size:13px; font-weight:bold; letter-spacing:2px; color:var(--mg-accent,#fff); text-shadow:0 0 6px color-mix(in srgb, var(--mg-accent,#fff) 45%, transparent); }
    .mg-subtitle { font-size:9px; letter-spacing:3px; opacity:0.5; color:var(--mg-accent,#fff); margin-top:2px; }
    .mg-headbolts { display:flex; align-items:center; gap:11px; }
    .mg-close { background:none; border:none; color:#8496a8; font-size:14px; cursor:pointer; padding:0 2px; line-height:1; font-family:inherit; }
    .mg-close:hover { color:#ff4a5b; }
    /* Phillips screw — inline in the head, absolute on a bezel's corners. */
    .mg-screw { position:relative; width:8px; height:8px; border-radius:50%; flex-shrink:0;
      background:radial-gradient(circle at 35% 30%, #6b7075, #2a2d30 70%, #16181a); box-shadow:inset 0 0 0 1px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.05); }
    .mg-screw::after { content:''; position:absolute; inset:2px 1px; border-top:1px solid rgba(0,0,0,0.55); transform:rotate(var(--r,35deg)); }
    .mg-bezel .mg-screw { position:absolute; width:7px; height:7px; z-index:6; }
    .mg-bezel .mg-screw-tl{top:7px;left:7px} .mg-bezel .mg-screw-tr{top:7px;right:7px} .mg-bezel .mg-screw-bl{bottom:7px;left:7px} .mg-bezel .mg-screw-br{bottom:7px;right:7px}
    /* Recessed bezel cradling a bulged-glass CRT (asymmetric radius fakes the tube). */
    .mg-bezel { position:relative; background:linear-gradient(160deg,#0a0c0e,#05070a); border-radius:14px; padding:14px 12px;
      box-shadow:inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.03); }
    .mg-screen { position:relative; border-radius:24px / 16px; overflow:hidden;
      box-shadow:inset 0 0 30px rgba(0,0,0,0.92), inset 0 0 8px color-mix(in srgb, var(--mg-accent,#fff) 26%, transparent), 0 0 0 1px rgba(0,0,0,0.8); }
    /* CRT treatment layers, stacked over the screen contents like the ATM tube. */
    .mg-crt { position:absolute; inset:0; pointer-events:none; border-radius:inherit; }
    .mg-crt-scan { z-index:3; background:repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.17) 2px 3px); }
    /* Futuristic: a faint holographic grid drifting behind the play area. */
    .mg-crt-grid { z-index:2; opacity:0.5;
      background-image:linear-gradient(color-mix(in srgb, var(--mg-accent,#fff) 10%, transparent) 1px, transparent 1px),
        linear-gradient(90deg, color-mix(in srgb, var(--mg-accent,#fff) 10%, transparent) 1px, transparent 1px);
      background-size:22px 22px, 22px 22px; animation:mg-grid 6s linear infinite; }
    @keyframes mg-grid { 0%{background-position:0 0, 0 0} 100%{background-position:0 22px, 0 0} }
    .mg-crt-glass { z-index:4; box-shadow:inset 0 0 22px rgba(0,0,0,0.6);
      background:linear-gradient(115deg, transparent 0 40%, rgba(220,240,255,0.10) 47%, rgba(220,240,255,0.03) 52%, transparent 60% 100%),
        radial-gradient(80% 55% at 26% 18%, rgba(255,255,255,0.12), transparent 60%),
        radial-gradient(120% 120% at 50% 50%, transparent 62%, rgba(0,0,0,0.5) 100%); }
    /* Futuristic: a bright scan bar drifting down the tube. */
    .mg-crt-sweep { position:absolute; left:0; right:0; top:0; height:40px; z-index:3; pointer-events:none; border-radius:inherit;
      background:linear-gradient(180deg, transparent, color-mix(in srgb, var(--mg-accent,#fff) 45%, transparent), transparent);
      mix-blend-mode:screen; opacity:0.5; animation:mg-sweep 4.2s linear infinite; }
    @keyframes mg-sweep { 0%{transform:translateY(-40px)} 100%{transform:translateY(var(--mg-sweep-h,300px))} }
    /* Futuristic: corner reticle brackets framing the play area. */
    .mg-reticle { position:absolute; inset:0; z-index:5; pointer-events:none; }
    .mg-reticle i { position:absolute; width:14px; height:14px; border:1.5px solid color-mix(in srgb, var(--mg-accent,#fff) 60%, transparent); opacity:0.7; animation:mg-reticle-pulse 3.4s ease-in-out infinite; }
    @keyframes mg-reticle-pulse { 0%,100%{opacity:0.7} 50%{opacity:0.34} }
    .mg-reticle i:nth-child(1){top:6px;left:6px;border-right:0;border-bottom:0}
    .mg-reticle i:nth-child(2){top:6px;right:6px;border-left:0;border-bottom:0}
    .mg-reticle i:nth-child(3){bottom:6px;left:6px;border-right:0;border-top:0}
    .mg-reticle i:nth-child(4){bottom:6px;right:6px;border-left:0;border-top:0}
    /* Physical deck — pulsing LEDs, label, a moulded data port, signal readout. */
    .mg-deck { display:flex; align-items:center; gap:8px; margin-top:12px; padding:7px 10px; font-size:8px; letter-spacing:1.5px; color:#8496a8;
      background:linear-gradient(180deg,#12161a,#0a0d10); border:1px solid #05070a; border-radius:6px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -2px 4px rgba(0,0,0,0.6); }
    /* Threat-tier LEDs: dark until lit by setDeckLevel(); the higher the meter,
       the more light up and the faster red flickers. */
    .mg-led { width:8px; height:8px; border-radius:50%; background:#20262b; box-shadow:inset 0 0 0 1px rgba(0,0,0,0.55); transition:background .2s, box-shadow .25s; }
    .mg-led.on.green { background:#46e05a; box-shadow:0 0 6px #46e05a, 0 0 2px #fff; animation:mg-led-pulse 2.4s ease-in-out infinite; }
    .mg-led.on.amber { background:#ffb23e; box-shadow:0 0 7px #ffb23e, 0 0 2px #fff; animation:mg-led-pulse 1.8s ease-in-out infinite; }
    .mg-led.on.red { background:#ff4a5b; box-shadow:0 0 8px #ff4a5b, 0 0 2px #fff; animation:mg-led-pulse 1.3s ease-in-out infinite; }
    .mg-led.on.red.crit { animation-duration:0.55s; }
    @keyframes mg-led-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
    .mg-port { margin-left:auto; width:30px; height:7px; border-radius:2px; background:linear-gradient(180deg,#05070a,#0d1013); box-shadow:inset 0 1px 2px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.04); }
    .mg-deck-sig { letter-spacing:2px; color:color-mix(in srgb, var(--mg-accent,#fff) 80%, #9fb0c8); }
    .mg-deck-bars { color:var(--mg-accent,#fff); letter-spacing:1px; }
  `;
  document.head.appendChild(s);
}

// Branded chassis head — a glowing mark, a two-line nameplate, a moulded bolt,
// and the close button (wire it via '.mg-close'). Mirrors the ATM chassis head.
export const deviceHeader = (mark, name, subtitle) =>
  `<div class="mg-head">` +
    `<div class="mg-brandplate"><span class="mg-brand-mark">${mark}</span>` +
      `<div class="mg-brand-text"><div class="mg-brand-name">${name}</div><div class="mg-subtitle">${subtitle}</div></div></div>` +
    `<div class="mg-headbolts"><span class="mg-screw" style="--r:30deg"></span><button class="mg-close" aria-label="Close">&#10005;</button></div>` +
  `</div>`;

// Four corner screws for a .mg-bezel (absolute-positioned by the scoped rules).
export const bezelScrews = () =>
  `<span class="mg-screw mg-screw-tl" style="--r:38deg"></span><span class="mg-screw mg-screw-tr" style="--r:-24deg"></span>` +
  `<span class="mg-screw mg-screw-bl" style="--r:71deg"></span><span class="mg-screw mg-screw-br" style="--r:13deg"></span>`;

// Corner reticle brackets (futuristic HUD framing) — also usable standalone over
// a non-CRT surface (e.g. the vault's metal dial plate).
export const reticleCorners = () => `<div class="mg-reticle"><i></i><i></i><i></i><i></i></div>`;

// Full CRT screen treatment: a holographic grid + scanlines + a drifting
// scan-sweep + curved-glass sheen + corner reticles. Drop as the last children
// of a .mg-screen container.
export const crtOverlays = () =>
  `<div class="mg-crt mg-crt-grid"></div><div class="mg-crt mg-crt-scan"></div><div class="mg-crt-sweep"></div><div class="mg-crt mg-crt-glass"></div>` + reticleCorners();

// Physical deck strip — a green/amber/red threat LED cluster (driven live by
// setDeckLevel), a label, a moulded data port, and a bar readout. `sigLabel` is
// the word beside the bars (e.g. TAMPER / FEEDBACK).
export const deckStrip = (label, sigLabel) =>
  `<div class="mg-deck"><span class="mg-led green on"></span><span class="mg-led amber"></span><span class="mg-led red"></span>` +
  `<span>${label}</span><span class="mg-port"></span>` +
  `<span class="mg-deck-sig">${sigLabel} <b class="mg-deck-bars">&#9647;&#9647;&#9647;&#9647;&#9647;</b></span></div>`;

// Drive the deck's threat LEDs + bar readout from a 0..1 meter (e.g. a game's
// tamper/feedback level). Green idles, amber lights past ~45%, red past ~78%
// and flickers critically near the top.
export function setDeckLevel(overlay, frac) {
  if (!overlay) return;
  const f = Math.max(0, Math.min(1, frac || 0));
  const leds = overlay.querySelectorAll('.mg-deck .mg-led');
  if (leds[0]) leds[0].classList.add('on');
  if (leds[1]) leds[1].classList.toggle('on', f > 0.45);
  if (leds[2]) { leds[2].classList.toggle('on', f > 0.78); leds[2].classList.toggle('crit', f > 0.9); }
  const bars = overlay.querySelector('.mg-deck-bars');
  if (bars) { const n = Math.round(f * 5); bars.innerHTML = '&#9646;'.repeat(n) + '&#9647;'.repeat(5 - n); }
}

// Mount a fullscreen minigame overlay and wire the boilerplate the games share:
// append to <body>, Escape-to-close, and (optionally) backdrop-click-to-close.
// Returns { overlay, close }. `close` is idempotent and runs the caller's
// `onClose` teardown (cancel RAF, drop drag/pointer listeners, null state)
// before removing the node and the key handler. `onKey(e, close)` receives any
// keydown the overlay didn't itself consume, for game-specific keys (Space to
// act, arrows to spin, etc.).
export function mountOverlay({ id, html, onKey, onClose, closeOnBackdrop = true }) {
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.innerHTML = html;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', keyHandler);
    if (onClose) onClose();
    if (overlay.parentNode) overlay.remove();
  }
  function keyHandler(e) {
    if (e.key === 'Escape') { close(); return; }
    if (onKey) onKey(e, close);
  }
  if (closeOnBackdrop) overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('keydown', keyHandler);
  document.body.appendChild(overlay);
  return { overlay, close };
}
