// Emergency Security Protocol — client-side state management.
// Toggling body.esp-active drives all CSS pulse animations.
// The siren audio is handled separately via audio_ambience / audio_stop messages.

export function applyEspState({ active, message }) {
  document.body.classList.toggle('esp-active', !!active);
  const banner = document.getElementById('esp-banner');
  if (!banner) return;
  if (active) {
    banner.textContent = message || 'EMERGENCY SECURITY PROTOCOL ACTIVE';
    banner.classList.remove('esp-hidden');
  } else {
    banner.classList.add('esp-hidden');
  }
}
