// Sports cards on the client: the face's stylesheet and the TURN OVER button. The faces
// themselves are drawn on the server (plugins/cards/sports.js), so the pack reveal and the
// Binder show the same card. Imported by cardpack.js and tablet-os.js; whichever loads
// first installs both, once.
import { loadCss } from '../../../shared/dom.js';

const SPC_CSS = await loadCss(new URL('./sportcard.css', import.meta.url));

export function ensureSportCards() {
  if (document.getElementById('sportcard-styles')) return;
  const s = document.createElement('style');
  s.id = 'sportcard-styles';
  s.textContent = SPC_CSS;
  document.head.appendChild(s);
  // Capture phase, and stopped there: the reveal treats a click on a card as zoom, and
  // turning a card over mustn't also zoom it.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-spc-flip]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    btn.closest('.spc')?.classList.toggle('flipped');
  }, true);
}
