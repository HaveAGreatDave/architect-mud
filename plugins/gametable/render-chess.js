// Isometric chess renderer — the 3/4 view neon board.
//
// Server-renders the whole pane as HTML, exactly like render-pane.js does for
// the felt: the client holds no board model and decides nothing. Squares are
// `.poker-cmd` elements carrying a literal verb, which is what lets the existing
// delegated click listener in main.js drive the board with no new client code.
//
// The 3/4 view is CSS, not sprites. `.chess-stage` tips the whole board with
// rotateX/rotateZ; every piece then counter-rotates by the same angles so it
// stands UP off the surface instead of lying flat on it. That single trick is
// the difference between a tilted picture of a board and a board you're looking
// across. Pieces are glyphs, so a piece is always crisp at any zoom and the
// whole set costs nothing to ship.
//
// Selection is server-side and two-step: `chesspick e2` marks a piece and
// re-renders with its legal destinations lit, then a destination click sends the
// full move. The extra round trip buys the legal-target glow for free and keeps
// the rule that the client never computes legality.

import { toAlgebraic, fromAlgebraic, generateMoves, typeOf, colorOf, PIECE_NAMES } from './games/chess.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Solid glyphs for both armies. Colour, not shape, tells the sides apart — an
// outline set reads as "missing" against a dark board, and at this tilt the
// hollow pieces vanish entirely.
const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

// Captured-rail ordering: heaviest first, so a queen never hides behind pawns.
const RAIL_ORDER = ['q', 'r', 'b', 'n', 'p'];

// table:    ChessTable instance
// viewerId: playerId receiving this render
export function renderChessPane(table, viewerId) {
  const game = table.game;
  const seats = table.seats;
  const viewerSeat = seats.find(s => s && s.playerId === viewerId) || null;
  const isSpectator = !viewerSeat;

  // Orientation: you look across the board from your own side. Spectators and
  // anyone waiting get White's view, which is the one people expect.
  const viewerColor = game?.seatByPlayer?.(viewerId)?.color || 'w';
  const flipped = viewerColor === 'b';

  const parts = [];
  parts.push('<div class="chess-pane">');
  parts.push(headerHTML(table, game, viewerId));

  if (!game) {
    parts.push(idleBoardHTML(table, viewerId));
  } else {
    parts.push(railHTML(table, game, flipped, 'top'));
    parts.push(boardHTML(table, game, viewerId, flipped));
    parts.push(railHTML(table, game, flipped, 'bottom'));
    parts.push(statusHTML(table, game, viewerId));
    parts.push(logHTML(game));
  }

  parts.push(actionsHTML(table, game, viewerId, isSpectator));
  parts.push('</div>');
  return parts.join('');
}

// ── Header ───────────────────────────────────────────────────────────────────

function headerHTML(table, game, viewerId) {
  const dealer = table.dealerName();
  const bubble = table.dealerBubble
    ? `<div class="chess-host-bubble">${esc(table.dealerBubble)}</div>` : '';
  const phase = game
    ? (game.isOver() ? 'GAME OVER' : (game.turn === 'w' ? "WHITE TO MOVE" : "BLACK TO MOVE"))
    : (table.phase === 'WaitingForPlayers' ? 'WAITING FOR A CHALLENGER' : table.phase.toUpperCase());

  return `<div class="chess-head">
    <div class="chess-title">${esc(table.name)}</div>
    <div class="chess-phase">${esc(phase)}</div>
    ${dealer ? `<div class="chess-host">${esc(dealer)}</div>` : ''}
    ${bubble}
  </div>`;
}

// ── The board ────────────────────────────────────────────────────────────────

function boardHTML(table, game, viewerId, flipped) {
  const grid = game.grid();                    // rows[0] is rank 8
  const selected = table.selectionFor(viewerId); // 0x88 index | null
  const myTurn = !game.isOver() && game.getCurrentActor()?.playerId === viewerId;

  // Legal destinations from the selected square — the glow the two-step buys.
  let targets = new Map(); // toSquare → move
  if (selected != null && myTurn) {
    for (const m of generateMoves(game.position)) {
      if (m.from === selected) targets.set(m.to, m);
    }
  }

  const last = game.lastMove();
  const checkedKing = game.inCheck() ? kingSquareOf(game, game.turn) : null;

  const rows = [];
  for (let r = 0; r < 8; r++) {
    const rank = flipped ? 7 - r : r;
    const cells = [];
    for (let f = 0; f < 8; f++) {
      const file = flipped ? 7 - f : f;
      const sq = rank * 16 + file;
      const piece = grid[rank][file];
      cells.push(squareHTML({
        sq, piece, r, f,
        fileLabel: r === 7 ? (flipped ? 'hgfedcba' : 'abcdefgh')[f] : null,
        rankLabel: f === 0 ? (flipped ? '12345678' : '87654321')[r] : null,
        light: (rank + file) % 2 === 0,
        selected: sq === selected,
        target: targets.get(sq) || null,
        lastFrom: last && last.from === sq,
        lastTo: last && last.to === sq,
        checked: sq === checkedKing,
        myTurn,
        viewerColor: game.seatByPlayer(viewerId)?.color || null,
        selectedSq: selected,
      }));
    }
    rows.push(cells.join(''));
  }

  // Coordinates ride INSIDE the edge squares (see squareHTML). A strip outside a
  // board rotated 45° lines up with nothing, so there isn't one.
  return `<div class="chess-stage-wrap">
    <div class="chess-stage">
      <div class="chess-glow"></div>
      <div class="chess-board">
        <div class="chess-plate"></div>
        ${rows.join('')}
      </div>
    </div>
  </div>`;
}

function squareHTML(o) {
  const cls = ['chess-sq'];
  cls.push(o.light ? 'sq-light' : 'sq-dark');
  if (o.selected) cls.push('sq-selected');
  if (o.target) cls.push(o.target.captured ? 'sq-capture' : 'sq-target');
  if (o.lastFrom) cls.push('sq-last-from');
  if (o.lastTo) cls.push('sq-last-to');
  if (o.checked) cls.push('sq-check');

  const alg = toAlgebraic(o.sq);

  // What does clicking this square mean right now? A piece of yours picks it up;
  // a lit destination completes the move; anything else is inert. The verb is a
  // literal command string — the same one a player could type.
  let cmd = null;
  if (o.myTurn) {
    if (o.target) {
      // A promotion always offers a queen from the board; `chessmove e7e8r` by
      // hand is the underpromotion route, which is rare enough to be typed.
      cmd = `chessmove ${toAlgebraic(o.selectedSq)}${alg}${o.target.promotion ? 'q' : ''}`;
    } else if (o.piece && colorOf(o.piece) === o.viewerColor) {
      cmd = o.sq === o.selectedSq ? 'chesspick none' : `chesspick ${alg}`;
    }
  }
  if (cmd) cls.push('poker-cmd', 'sq-live');

  const attrs = cmd ? ` data-cmd="${esc(cmd)}"` : '';
  const label = cmd
    ? ` title="${esc(o.piece ? `${PIECE_NAMES[typeOf(o.piece)]} on ${alg}` : alg)}"` : '';

  const piece = o.piece ? pieceHTML(o.piece, o.checked) : '';
  // The dot marks an empty legal destination; a capture ring marks an occupied
  // one. Two different marks because "I can move here" and "I can take that"
  // are different decisions.
  const mark = o.target && !o.piece ? '<span class="chess-dot"></span>' : '';

  // Coordinates sit on the edge squares themselves and counter-rotate with the
  // pieces, so they stay upright and readable however the board is spun.
  const coords = (o.fileLabel ? `<span class="chess-coord coord-file">${o.fileLabel}</span>` : '')
    + (o.rankLabel ? `<span class="chess-coord coord-rank">${o.rankLabel}</span>` : '');

  return `<div class="${cls.join(' ')}"${attrs}${label} data-sq="${alg}">
    <span class="chess-sq-face"></span>${coords}${mark}${piece}
  </div>`;
}

function pieceHTML(piece, checked) {
  const type = typeOf(piece);
  const color = colorOf(piece);
  const cls = ['chess-piece', color === 'w' ? 'pc-white' : 'pc-black', `pc-${type}`];
  if (checked && type === 'k') cls.push('pc-checked');
  // The plinth is a separate element that stays FLAT on the board plane; the
  // piece stands up off it. Without it the pieces float and the tilt stops
  // reading as depth. It carries the colour so it can glow in the team's neon.
  return `<span class="chess-plinth ${color === 'w' ? 'pl-white' : 'pl-black'}"></span>`
       + `<span class="${cls.join(' ')}"><span class="chess-glyph">${GLYPHS[type]}</span></span>`;
}

function kingSquareOf(game, color) {
  const target = color === 'w' ? 'K' : 'k';
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    if (game.position.board[sq] === target) return sq;
  }
  return null;
}

// An empty board with the seats offered, before anyone has sat down.
function idleBoardHTML(table, viewerId) {
  const seated = table.seatedIndex(viewerId) >= 0;
  const seats = [0, 1].map(i => {
    const s = table.seats[i];
    const side = i === 0 ? 'WHITE' : 'BLACK';
    if (s) return `<div class="chess-seat filled"><span class="chess-seat-side">${side}</span><span>${esc(s.handle)}</span></div>`;
    // Sitting alone at a two-seat board is a dead end, so the empty chair
    // opposite is the offer to call somebody over rather than a dim label.
    if (seated) return `<div class="chess-seat poker-cmd" data-cmd="summon"><span class="chess-seat-side">${side}</span><span class="chess-sit">call an opponent</span></div>`;
    return `<div class="chess-seat poker-cmd" data-cmd="seat ${i + 1}"><span class="chess-seat-side">${side}</span><span class="chess-sit">sit down</span></div>`;
  }).join('');
  return `<div class="chess-idle">
    <div class="chess-idle-art">♜ ♞ ♝ ♛ ♚ ♝ ♞ ♜</div>
    <div class="chess-seats">${seats}</div>
  </div>`;
}

// ── Rails, status, log ───────────────────────────────────────────────────────

// The captured pieces belonging to one side, plus the material edge. Shown on
// the rail of the player who TOOK them.
function railHTML(table, game, flipped, edge) {
  const caps = game.captured();
  // Top rail belongs to the far player.
  const bottomColor = flipped ? 'b' : 'w';
  const color = edge === 'bottom' ? bottomColor : (bottomColor === 'w' ? 'b' : 'w');
  const seat = game.seatByColor(color);
  const taken = (caps[color] || []).slice()
    .sort((a, b) => RAIL_ORDER.indexOf(a) - RAIL_ORDER.indexOf(b))
    .map(t => `<span class="rail-pc">${GLYPHS[t]}</span>`).join('');

  const balance = game.materialBalance();
  const edgeFor = color === 'w' ? balance : -balance;
  const adv = edgeFor > 0 ? `<span class="rail-adv">+${Math.round(edgeFor / 100)}</span>` : '';
  const toMove = !game.isOver() && game.turn === color ? ' rail-active' : '';

  // Chat rides the RAIL, which is this board's answer to poker's seat. The
  // bubbles were already being collected — `say` at a table is intercepted into
  // `playerSay` on TableBase, which every table game shares — chess just never
  // drew them, so a line spoken across the board went to the log and nowhere
  // else. Each player has exactly one rail and it is unambiguously theirs, so
  // there is no seat geometry to solve: the near rail's bubble opens upward and
  // the far rail's opens down, both pointing back at whoever said it.
  const chat = seat && table.chatBubbles?.[seat.playerId];
  const bubble = chat ? `<span class="chess-chat chat-${edge}">${esc(chat)}</span>` : '';

  return `<div class="chess-rail${toMove} rail-${color === 'w' ? 'white' : 'black'}">
    <span class="rail-name">${esc(seat?.handle || (color === 'w' ? 'White' : 'Black'))}</span>
    <span class="rail-taken">${taken}</span>${adv}${bubble}
  </div>`;
}

function statusHTML(table, game, viewerId) {
  if (game.isOver()) {
    // How it ended is carried as a CLASS, not left for a reader to recover from
    // the sentence. The 3D board topples the losing king on a checkmate and must
    // not do it on a resignation — and a king can be standing in check when its
    // player resigns, so "the king is attacked and the game is over" is not the
    // same fact as "checkmate".
    const mate = game.result?.reason === 'checkmate' ? ' chess-status-mate' : '';
    return `<div class="chess-status chess-status-over${mate}">${esc(game.resultLine())}</div>`;
  }
  const actor = game.getCurrentActor();
  const mine = actor?.playerId === viewerId;
  const check = game.inCheck() ? '<span class="chess-check-tag">CHECK</span>' : '';
  const offer = table.drawOfferText(viewerId);
  const line = mine
    ? 'Your move.'
    : `Waiting on ${esc(actor?.handle || 'the other player')}.`;
  return `<div class="chess-status">${check}<span>${line}</span>${offer}</div>`;
}

// The move log, in numbered pairs, most recent last with the latest highlighted.
function logHTML(game) {
  if (!game.history.length) return '';
  const rows = [];
  for (let i = 0; i < game.history.length; i += 2) {
    const n = i / 2 + 1;
    const w = game.history[i];
    const b = game.history[i + 1];
    const isLast = i + 1 >= game.history.length - 1;
    rows.push(`<span class="log-move${isLast ? ' log-recent' : ''}">`
      + `<span class="log-no">${n}.</span>${esc(w?.san || '')}`
      + (b ? ` ${esc(b.san)}` : '') + '</span>');
  }
  return `<div class="chess-log">${rows.join('')}</div>`;
}

// ── Actions ──────────────────────────────────────────────────────────────────

function actionsHTML(table, game, viewerId, isSpectator) {
  const btns = [];
  if (isSpectator) {
    if (table.openSeats() > 0) btns.push(btn('join', 'SIT DOWN'));
    btns.push(btn('leave', 'STOP WATCHING'));
  } else if (game && !game.isOver()) {
    if (table.drawOfferedTo(viewerId)) {
      btns.push(btn('acceptdraw', 'ACCEPT DRAW', 'ok'));
      btns.push(btn('declinedraw', 'DECLINE'));
    } else {
      btns.push(btn('offerdraw', 'OFFER DRAW'));
    }
    btns.push(btn('resign', 'RESIGN', 'danger'));
  } else {
    btns.push(btn('leave', 'LEAVE TABLE'));
  }
  return `<div class="chess-actions">${btns.join('')}${viewControlsHTML(game)}</div>`;
}

// Camera controls. These are NOT commands — they carry no data-cmd and never
// reach the server; the 3D renderer (client/game/js/panels/chess3d.js) picks
// them up by data-view and remembers the angle per browser. Dragging the board
// does the same thing; the bar is the touch route to it, and the only way back
// from a wild orbit. The board is one player's viewpoint, not table state.
function viewControlsHTML(game) {
  if (!game) return '';
  const b = (v, glyph, title) =>
    `<button class="chess-view" data-view="${v}" title="${esc(title)}">${glyph}</button>`;
  return `<div class="chess-viewbar">
    ${b('left', '↺', 'Orbit left (or middle-drag the board)')}${b('right', '↻', 'Orbit right')}
    ${b('up', '▲', 'Look down on the board')}${b('down', '▼', 'Drop to a low angle')}
    ${b('reset', '⌂', 'Reset the view')}
  </div>`;
}

function btn(cmd, label, kind = '') {
  return `<button class="poker-cmd chess-btn${kind ? ' chess-btn-' + kind : ''}" data-cmd="${esc(cmd)}">${esc(label)}</button>`;
}
