// A chip that floats off the credits counter on every spend ("−85₵") and on
// every refused one ("Can't afford 85₵"). Fed by the server's credits_delta,
// which adjustCredits sends, so every purchase in the game gets it for free.
// Fixed-position on top of everything, so it shows over open panels too.

function anchor() {
  // Whichever counter is on screen: the header's on desktop, the strip's on a phone.
  for (const id of ['credits-display', 'mob-credits']) {
    const el = document.getElementById(id);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

export function floatCredits(msg) {
  const el = anchor();
  const chip = document.createElement('div');
  if (msg.declined) {
    const have = msg.credits != null ? ` (you have ${msg.credits}₵)` : '';
    chip.className = 'cred-float cred-float-declined';
    chip.textContent = `Can't afford ${msg.cost}₵${have}`;
    if (el) { el.classList.remove('cred-shake'); void el.offsetWidth; el.classList.add('cred-shake'); setTimeout(() => el.classList.remove('cred-shake'), 600); }
  } else {
    chip.className = 'cred-float cred-float-spend';
    chip.textContent = `−${Math.abs(msg.delta)}₵`;
  }
  if (el) {
    const r = el.getBoundingClientRect();
    chip.style.left = `${Math.round(r.left + r.width / 2)}px`;
    chip.style.top = `${Math.round(r.bottom + 4)}px`;
  } else {
    chip.style.left = '50%';
    chip.style.top = '56px';
  }
  document.body.appendChild(chip);
  chip.addEventListener('animationend', () => chip.remove(), { once: true });
  setTimeout(() => chip.remove(), 4000);   // belt and braces if animations are off
}
