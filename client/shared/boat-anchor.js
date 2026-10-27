// THE ANCHOR'S SWING CIRCLE, shared by the server (plugins/powerboat/anchor.js, the clamp in
// helm.js `cmdBoatSync`, the text helm's tick) and the seat (boat-view.js). One radius, so the circle
// the seat holds her to is the circle the server clamps her back onto. Pure: no DOM, no world.
//
// Coordinates are world tiles in the boat's own convention (a tile's centre on the integer, the
// one `zoneUnder` rounds). The anchor point is `{ x, y, at }`, `at` being when it went down.

/** The most she swings from the point the anchor went down, in tiles. */
export const SWING_R = 0.3;
/** Where the seat lies her: this share of the radius downwind of the anchor, inside the clamp. */
export const LIE_FRAC = 0.75;

/** A point pulled back onto the swing circle round `a` when it's outside it. */
export function clampToSwing(x, y, a, r = SWING_R) {
  const dx = x - a.x, dy = y - a.y, d = Math.hypot(dx, dy);
  if (!(d > r)) return { x, y, clamped: false };
  return { x: a.x + (dx / d) * r, y: a.y + (dy / d) * r, clamped: true };
}

/**
 * Is a stored anchor still where she is? A row keeps `custom_data.anchored` after a tow or a move,
 * so an anchor is only adopted when it's within a tile of the tile she's lying on.
 */
export function anchorNear(a, x, y) {
  return !!a && Number.isFinite(a.x) && Number.isFinite(a.y)
    && Number.isFinite(x) && Number.isFinite(y) && Math.hypot(a.x - x, a.y - y) <= 1.5;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** A whole number from 0 to 999 in words ("thirty", "forty-two"); anything else as digits. */
export function numberWords(n) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  const rest = n % 100;
  return ONES[Math.floor(n / 100)] + ' hundred' + (rest ? ' and ' + numberWords(rest) : '');
}
