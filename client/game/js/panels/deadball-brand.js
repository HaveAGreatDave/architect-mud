// Deadball's mark, as cphl-brand.js is the CPhL's: a ball with its seams, crossed out like a
// dead man's eyes in a cartoon. Inline SVG, styled in matchup-card.css.

export function deadballMark(size = '22px', cls = '') {
  return (
    `<svg class="db-mark ${cls}" viewBox="0 0 68 68" width="${size}" height="${size}" aria-hidden="true">` +
      `<circle class="db-mark-ball" cx="34" cy="34" r="30"/>` +
      `<path class="db-mark-seam" d="M14 12 C26 24 26 44 14 56"/>` +
      `<path class="db-mark-seam" d="M54 12 C42 24 42 44 54 56"/>` +
      `<path class="db-mark-stitch" d="M14 12 C26 24 26 44 14 56"/>` +
      `<path class="db-mark-stitch" d="M54 12 C42 24 42 44 54 56"/>` +
      `<path class="db-mark-x" d="M28 26 L40 38 M40 26 L28 38"/>` +
    `</svg>`
  );
}

export function deadballLockup(sub = '', size = '30px') {
  return (
    `<div class="db-lockup">` +
      deadballMark(size) +
      `<span class="db-lockup-word">DEAD<i>BALL</i></span>` +
      (sub ? `<span class="db-lockup-sub">${String(sub).replace(/[<&]/g, '')}</span>` : '') +
    `</div>`
  );
}
