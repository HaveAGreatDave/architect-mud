// Sports cards on the client: the face's stylesheet and the TURN OVER button. The faces
// themselves are drawn on the server (plugins/cards/sports.js), so the pack reveal and the
// Binder show the same card. Imported by cardpack.js and tablet-os.js; whichever loads
// first installs both, once. It also swaps each card's drawn photo for the man shot in 3-D and
// printed (card-photo.js) once the shot is ready; the drawing stays wherever it can't be shot.
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
  // every card that arrives, however it was put on the page (the reveal, the Binder)
  const scan = (root) => { for (const el of root.querySelectorAll?.('.spc-photo[data-photo]:not([data-shot])') || []) shoot(el); };
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n.matches?.('.spc-photo') ? n.parentNode : n); })
    .observe(document.body, { childList: true, subtree: true });
  scan(document);
}

let photoMod = null;
async function shoot(el) {
  el.dataset.shot = 'pending';
  let spec;
  try { spec = JSON.parse(el.dataset.photo); } catch { el.dataset.shot = 'none'; return; }
  photoMod ??= import('./card-photo.js');
  const url = await (await photoMod).cardPhoto(spec).catch(() => null);
  if (!url || !el.isConnected) { el.dataset.shot = 'none'; return; }
  const img = document.createElement('img');
  img.className = 'spc-shot'; img.alt = ''; img.src = url;
  el.appendChild(img);
  el.dataset.shot = 'done';
}
