// Card rendering for the gametable plugin.
// ASCII for the output pane; HTML (with colored suits) for the area pane.

const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_CLASS   = { s: 'suit-black', h: 'suit-red', d: 'suit-red', c: 'suit-black' };
const SUIT_FALL    = { s: 'S', h: 'H', d: 'D', c: 'C' }; // ASCII fallback

// ── ASCII (output pane) ───────────────────────────────────────────────────────

// One card rendered as 6 lines of 11 chars each.
function cardLines(card, faceDown) {
  if (faceDown) {
    return [
      '+---------+',
      '|#########|',
      '|#########|',
      '|#########|',
      '|#########|',
      '+---------+',
    ];
  }
  const r = card.rank;
  const s = SUIT_SYMBOL[card.suit] || SUIT_FALL[card.suit];
  const rPad = r.length === 1 ? r + ' ' : r;     // '10' is 2 chars
  const rPadR = r.length === 1 ? ' ' + r : r;
  return [
    '+---------+',
    `| ${rPad}      |`,
    '|         |',
    `|    ${s}    |`,
    '|         |',
    `|      ${rPadR} |`,
    '+---------+',
  ];
}

// Render one or more cards side by side as a monospaced ASCII block.
export function renderHandASCII(cards, faceDown = false) {
  if (!cards.length) return '';
  const rows = cards.map(c => cardLines(c, faceDown));
  // rows[i] is array of lines for card i — zip into horizontal layout
  const lines = [];
  for (let line = 0; line < 7; line++) {
    lines.push(rows.map(r => r[line]).join(' '));
  }
  return lines.join('\n');
}

// ── HTML (area pane) ──────────────────────────────────────────────────────────

// Single card HTML. dealDir is 'south'|'north'|'east'|'west'|null (no animation).
// cardIdx is 0 or 1 (for animation-delay stagger on card 2).
// viewer=true means the card starts face-down and flips to face-up.
export function renderCardHTML(card, { faceDown = true, dealDir = null, cardIdx = 0, viewer = false } = {}) {
  const suit = card?.suit;
  const rank = card?.rank;
  const suitSym = suit ? (SUIT_SYMBOL[suit] || SUIT_FALL[suit]) : '';
  const suitCls = suit ? (SUIT_CLASS[suit] || 'suit-black') : '';

  const dealClass = dealDir ? ` dealing-${dealDir}${cardIdx === 1 ? ' card-2' : ''}` : '';
  // A statically face-up card must rotate its inner to show the front; otherwise
  // the back (rotateY 0) faces the viewer. The deal flip only runs once, so
  // without this the front would revert to face-down on every re-render.
  const faceUpClass = !faceDown ? ' face-up' : '';

  const front = `
    <div class="poker-card-front">
      <span class="rank-top ${suitCls}">${rank}</span>
      <span class="suit-center ${suitCls}">${suitSym}</span>
      <span class="rank-bot ${suitCls}">${rank}</span>
    </div>`.trim();

  const back = `<div class="poker-card-back"></div>`;

  // viewer cards: back visible initially, flip animation reveals front
  // opponent cards: back always visible (no flip)
  // If faceDown and not viewer: just show back, no front element needed
  const innerContent = (faceDown && !viewer)
    ? back
    : `${back}${front}`;

  return `<div class="poker-card-wrap${dealClass}${faceUpClass}"><div class="poker-card-inner">${innerContent}</div></div>`;
}

// Row of card HTML elements for a seat.
export function renderHandHTML(cards, { faceDown = true, dealDir = null, viewer = false } = {}) {
  if (!cards || !cards.length) return '';
  return cards.map((c, i) =>
    renderCardHTML(c, { faceDown, dealDir, cardIdx: i, viewer })
  ).join('');
}

// Community cards — always face-up, no deal animation.
export function renderCommunityHTML(cards) {
  if (!cards || !cards.length) return '';
  return cards.map(c => renderCardHTML(c, { faceDown: false })).join('');
}
