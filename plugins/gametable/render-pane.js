// Renders the poker table as HTML for the area pane.
// The viewing player is always at the South position.
// Other seats are arranged N / E / W based on their distance from the viewer's seat.

import { renderHandHTML, renderCommunityHTML } from './cards.js';

// ── Money ───────────────────────────────────────────────────────────────────
// Break an amount into physical denominations: 100/50/20/10/5 ₵ bills, then 1 ₵
// coins for the remainder. Greedy is optimal for this set.
const MONEY_BILLS = [100, 50, 20, 10, 5];
function denominate(amount) {
  const pieces = [];
  let rem = Math.max(0, Math.floor(amount || 0));
  for (const b of MONEY_BILLS) { while (rem >= b) { pieces.push(b); rem -= b; } }
  while (rem >= 1) { pieces.push(1); rem -= 1; }
  return pieces;
}

// A fanned pile of bills/coins for `amount`. Every piece is drawn (no cap on
// count); positional spread caps so a huge pile stays tidy instead of unbounded.
// animClass: '' | 'tossing' (drop-in) | 'sweeping' (gather to pot).
function moneyPileHTML(amount, animClass = '') {
  const pieces = denominate(amount);
  if (!pieces.length) return '';
  const spreadCap = 11;
  const step = 7;
  const shown = Math.min(pieces.length, spreadCap);
  const base = -((shown - 1) * step) / 2;
  const items = pieces.map((v, i) => {
    const k = Math.min(i, spreadCap - 1);
    const dx = base + k * step;
    const dy = -k * 3;
    const rot = ((i * 47) % 15) - 7; // deterministic tilt — no jitter on re-render
    const style = `transform:translate(${dx}px,${dy}px) rotate(${rot}deg);z-index:${i};`;
    return v === 1
      ? `<span class="coin" style="${style}"></span>`
      : `<span class="bill bill-${v}" style="${style}">${v}</span>`;
  }).join('');
  return `<div class="money-pile ${animClass}">${items}</div>`;
}

// Compass positions relative to viewer (south): by how many seats clockwise.
// With 4 seats: +1 = east, +2 = north, +3 = west
const OFFSET_TO_COMPASS = { 1: 'east', 2: 'north', 3: 'west' };

const PHASE_LABELS = {
  preflop: 'PRE-FLOP',
  flop:    'FLOP',
  turn:    'TURN',
  river:   'RIVER',
  showdown:'SHOWDOWN',
  idle:    '',
};

// table: GameTable instance (see game-table.js)
// viewerId: playerId of the player receiving this render
export function renderPane(table, viewerId) {
  const game = table.game; // HoldemGame | null
  const seats = table.seats; // Array(4) of null | { playerId, handle, chips, seatIdx }
  const phase = game ? game.phase : 'idle';
  const isDealing = game?.dealPhase ?? false;

  // Find viewer's seat index (0-3)
  const viewerSeatIdx = seats.findIndex(s => s && s.playerId === viewerId);
  // Seat objects ordered by seat index 0-3
  // We map each seat to a compass position relative to the viewer.
  const seatPositions = {}; // 'north'|'east'|'south'|'west' → seat row or null

  for (let i = 0; i < 4; i++) {
    const offset = viewerSeatIdx < 0
      ? i                             // spectator: seat 0 = south, etc.
      : (i - viewerSeatIdx + 4) % 4; // viewer always south (offset 0)
    const compass = offset === 0 ? 'south' : (OFFSET_TO_COMPASS[offset] || 'north');
    seatPositions[compass] = seats[i] || null;
  }

  // Build HTML for one seat
  function seatHTML(compass) {
    const seat = seatPositions[compass];
    const isViewer = seat && seat.playerId === viewerId;
    const isSpectator = viewerSeatIdx < 0;

    // Game seat data (chips, hand, etc.) from game.seats if game active
    const gameSeat = game ? game.seats.find(s => s && s.playerId === seat?.playerId) : null;
    const isCurrentActor = game && game.actionIdx >= 0 && game.seats[game.actionIdx]?.playerId === seat?.playerId;
    const isDealerBtn = game && game.dealerIdx >= 0 && game.seats[game.dealerIdx]?.playerId === seat?.playerId;
    const isActive = isCurrentActor;

    let seatClass = `poker-seat seat-${compass}`;
    if (!seat) seatClass += ' seat-empty';
    if (isViewer) seatClass += ' seat-viewer';
    if (isActive) seatClass += ' seat-active';
    if (seat && table.lastWinners?.includes(seat.playerId)) seatClass += ' seat-winner';

    let inner = '';

    if (!seat) {
      inner = `<span class="seat-name">[ empty ]</span>`;
    } else {
      const chips = gameSeat ? gameSeat.chips : seat.chips;
      const folded = gameSeat?.folded;
      const allIn = gameSeat?.allIn;

      // Name row
      const dealerBadge = isDealerBtn ? ' <span class="dealer-btn">D</span>' : '';
      const statusStr = folded ? '<span class="seat-status">FOLDED</span>' : (allIn ? '<span class="seat-status">ALL IN</span>' : '');
      inner += `<span class="seat-name">${esc(seat.handle)}${dealerBadge}</span>`;
      if (statusStr) inner += statusStr;
      inner += `<span class="seat-chips${chips === 0 ? ' empty' : ''}">₵ ${chips.toLocaleString()}</span>`;

      // Cards
      if (game && gameSeat && !folded) {
        const hand = gameSeat.hand || [];
        if (hand.length) {
          const dealDir = isDealing ? compass : null;
          // Viewer sees own cards face-up (with flip animation), others see face-down
          const showFaceUp = isViewer || (phase === 'showdown' && !folded);
          const html = renderHandHTML(hand, {
            faceDown: !showFaceUp,
            dealDir,
            viewer: isViewer && isDealing,
          });
          inner += `<div class="seat-cards">${html}</div>`;
        }
      } else if (!game) {
        // No active game — show empty card placeholders
        inner += `<div class="seat-cards"></div>`;
      }

      // Last-action tag (FOLD / RAISE 50 / …)
      const bubble = table.bubbles?.[seat.playerId];
      if (bubble) {
        inner += `<span class="poker-bubble">${esc(bubble)}</span>`;
      }

      // Player chat speech bubble (from the `say` command)
      const chat = table.chatBubbles?.[seat.playerId];
      if (chat) {
        inner += `<span class="poker-chat">${esc(chat)}</span>`;
      }
    }

    return `<div class="${seatClass}">${inner}</div>`;
  }

  // A bet pile sits on the felt between a seat and the center, until it's swept.
  function betPileHTML(compass) {
    const seat = seatPositions[compass];
    if (!seat || !game) return '';
    const gs = game.seats.find(s => s.playerId === seat.playerId);
    if (!gs || gs.folded || !gs.bet) return '';
    const toss = table._betAnimPlayer === seat.playerId ? 'tossing' : '';
    return `<div class="bet-money bet-${compass}">${moneyPileHTML(gs.bet, toss)}<span class="bet-amt">₵ ${gs.bet.toLocaleString()}</span></div>`;
  }

  // Clickable command bar. Labels use the natural word; data-cmd carries the
  // real (collision-free) verb — `sit`→`seat`, `watch`→`spectate`. Amount verbs
  // (data-fill) prompt for the amount before firing. Disabled buttons show but
  // don't relay.
  function pbtn(label, cmd, { fill = false, disabled = false, highlight = false } = {}) {
    if (disabled) return `<button class="poker-cmd disabled" disabled>${label}</button>`;
    const attr = fill ? `data-fill="${cmd} "` : `data-cmd="${cmd}"`;
    const cls = highlight ? 'poker-cmd highlight' : 'poker-cmd';
    return `<button class="${cls}" ${attr}>${label}</button>`;
  }
  function cmdBarHTML() {
    const parts = [];
    if (viewerSeatIdx >= 0) {
      const myGs = game?.seats.find(s => s.playerId === viewerId);
      const myTurn = !!(game && game.actionIdx >= 0 && game.seats[game.actionIdx]?.playerId === viewerId);
      const canCheck = !!(myGs && game && myGs.bet >= game.currentBet);
      parts.push(pbtn('check', 'check', { disabled: !myTurn || !canCheck }));
      parts.push(pbtn('call',  'call',  { disabled: !myTurn || canCheck }));
      parts.push(pbtn('bet',   'bet',   { fill: true, disabled: !myTurn }));
      parts.push(pbtn('raise', 'raise', { fill: true, disabled: !myTurn }));
      parts.push(pbtn('fold',  'fold',  { disabled: !myTurn }));
      parts.push(pbtn('all-in','allin', { disabled: !myTurn }));
      // One-click ways to fill the table: an AI opponent, or the dealer if he's stepped away.
      if (!game && table.openSeats() > 0) parts.push(pbtn('call AI', 'summon'));
      if (!game && table.seats.some(s => s && s.isBot)) parts.push(pbtn('evict AI', 'evict'));
      if (!table.hasDealer()) parts.push(pbtn('call dealer', 'calldealer', { highlight: true }));
      parts.push(pbtn('leave', 'leave'));
    } else {
      parts.push(pbtn('sit',   'seat'));     // alias: shows "sit", relays `seat`
      parts.push(pbtn('watch', 'spectate')); // alias: shows "watch", relays `spectate`
      if (!table.hasDealer()) parts.push(pbtn('call dealer', 'calldealer', { highlight: true }));
      if (table.spectators?.has?.(viewerId)) parts.push(pbtn('leave', 'leave'));
    }
    parts.push(pbtn('help', 'help'));
    return `<div class="poker-cmdbar">${parts.join('')}</div>`;
  }

  // Community board (center)
  const community = game?.community || [];
  const pot = game?.pot || 0;
  // Money already swept to the middle = total pot minus what's still in front of
  // players this street. That committed amount is what the center pile shows.
  const committed = game ? Math.max(0, game.pot - game.seats.reduce((a, s) => a + (s.bet || 0), 0)) : 0;
  const phaseLabel = PHASE_LABELS[phase] || '';
  // Between hands, show a status so a lone player knows why nothing's happening.
  const seatedCount = seats.filter(Boolean).length;
  const waitLabel = game ? '' : (
    table.phase === 'WaitingForDealer' ? 'NO DEALER — TABLE PAUSED' :
    seatedCount < 2 ? 'WAITING FOR PLAYERS' : 'SHUFFLING UP…'
  );

  const deckHTML = `
    <div class="poker-deck${table._shuffleAnim ? ' shuffling' : ''}">
      <div class="poker-deck-pile poker-deck-pile-left">
        <div class="poker-deck-card"></div>
        <div class="poker-deck-card"></div>
      </div>
      <div class="poker-deck-pile poker-deck-pile-right">
        <div class="poker-deck-card"></div>
        <div class="poker-deck-card"></div>
      </div>
    </div>`;

  const boardInner = community.length
    ? `<div class="poker-board-cards">${renderCommunityHTML(community)}</div>`
    : deckHTML;

  const boardHTML = `
    <div class="poker-board">
      ${boardInner}
      ${waitLabel ? `<span class="poker-status">${waitLabel}</span>` : ''}
      ${phaseLabel ? `<span class="poker-phase">${phaseLabel}</span>` : ''}
      ${pot > 0 ? `<div class="poker-pot">${moneyPileHTML(committed, table._sweepAnim ? 'sweeping' : '')}<span class="pot-amt">POT ₵ ${pot.toLocaleString()}</span></div>` : ''}
    </div>`;

  const headerLabel = esc(table.name);

  // Dealer figure with speech bubble (top-left, opening inward). When he's not
  // at the table the avatar dims and a status replaces his speech bubble.
  const dealerText = table.dealerBubble;
  const dealerPresent = table.hasDealer();
  const dealerHTML = `
    <div class="poker-dealer${dealerPresent ? '' : ' dealer-absent'}">
      <span class="dealer-avatar">♠</span>
      ${dealerText ? `<span class="dealer-speech">${esc(dealerText)}</span>`
        : !dealerPresent ? `<span class="dealer-speech dealer-absent-tag">NO DEALER</span>` : ''}
    </div>`;

  return `
<div class="poker-table-wrap">
  <div class="poker-felt"></div>
  <div class="poker-header">${headerLabel}</div>
  ${dealerHTML}
  ${seatHTML('north')}
  ${seatHTML('east')}
  ${boardHTML}
  ${seatHTML('south')}
  ${seatHTML('west')}
  ${betPileHTML('north')}
  ${betPileHTML('east')}
  ${betPileHTML('south')}
  ${betPileHTML('west')}
</div>
${cmdBarHTML()}`.trim();
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
