// Wanted-level HUD — neon stars, server-driven. Pulses + stings when heat rises.
let stars = 0;
let audioCtx = null;

function stinger() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [[440, 0], [590, 0.12]].forEach(([f, dt]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f; g.gain.value = 0.05;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.05, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.22);
      o.start(t + dt); o.stop(t + dt + 0.22);
    });
  } catch { /* no audio */ }
}

export function updateWantedHud(n) {
  const el = document.getElementById('wanted-hud');
  if (!el) return;
  const rising = n > stars;
  stars = Math.max(0, Math.min(5, n | 0));
  if (stars <= 0) { el.classList.remove('active', 'wanted-pulse'); el.innerHTML = ''; return; }
  el.classList.add('active');
  el.innerHTML =
    `<span class="wanted-label">WANTED</span>` +
    `<span class="wanted-stars">${'★'.repeat(stars)}<span class="wanted-empty">${'☆'.repeat(5 - stars)}</span></span>`;
  if (rising) {
    el.classList.remove('wanted-pulse');
    void el.offsetWidth;           // restart the animation
    el.classList.add('wanted-pulse');
    stinger();
  }
}

export function initWantedHud() {
  const el = document.getElementById('wanted-hud');
  if (el) { el.classList.remove('active'); el.innerHTML = ''; }
}
