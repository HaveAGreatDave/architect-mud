// CPhL brand furniture — the one place the Cluster Puck identity is drawn.
//
// A broadcast reads as a broadcast because the same mark turns up in the open, in the
// corner bug, on every full-screen graphic and on the sub-screen. If each of those
// draws its own approximation they stop looking like one channel, so all of them import
// from here and none of them draw a puck of their own.
//
// The mark is the league in one image: a puck with a single straight red line struck
// through it. Nobody founded the CPhL, nobody administers it, and the only thing that
// has never failed is the scheduler — so the mark is a disc with one line through it
// that always arrives at the same angle.
//
// Kept as inline SVG strings rather than files: everything here ships inside the game
// client with no request, scales to any size, and inherits the surrounding colour.

// The disc mark. `size` is a CSS length; `cls` lets a caller theme it per surface.
export function cphlMark(size = '22px', cls = '') {
  return (
    `<svg class="cphl-mark ${cls}" viewBox="0 0 68 68" width="${size}" height="${size}" aria-hidden="true">` +
      `<circle class="cphl-mark-disc" cx="34" cy="34" r="31"/>` +
      `<circle class="cphl-mark-inner" cx="34" cy="34" r="23.5"/>` +
      `<path class="cphl-mark-slash" d="M9 51 L59 19"/>` +
      `<text class="cphl-mark-cp" x="34" y="42.5" text-anchor="middle">CP</text>` +
    `</svg>`
  );
}

// The horizontal lockup: mark + wordmark, for card headers and the idle screen.
// `sub` is the small line under the wordmark (a show name, a round, a strapline).
export function cphlLockup(sub = 'CPhL · COLDWATER HOCKEY', size = '30px') {
  return (
    `<div class="cphl-lockup">` +
      cphlMark(size) +
      `<span class="cphl-lockup-word">CLUSTER<i>PUCK</i></span>` +
      (sub ? `<span class="cphl-lockup-sub">${String(sub).replace(/[<&]/g, '')}</span>` : '') +
    `</div>`
  );
}

// The persistent corner bug — the small always-on identifier a real channel leaves in
// frame. Deliberately low-contrast: it is not competing with the game.
export function cphlBug(label = 'CPhL') {
  return `<div class="cphl-bug">${cphlMark('16px')}<span>${String(label).replace(/[<&]/g, '')}</span></div>`;
}
