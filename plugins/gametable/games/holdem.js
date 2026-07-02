// Texas Hold'em game plugin for GameTable.
// Contains all rules, no networking or persistence — that lives in game-table.js.

const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['s','h','d','c'];

// ── Deck ─────────────────────────────────────────────────────────────────────

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ── Hand evaluation ───────────────────────────────────────────────────────────

const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2])); // 2=2, A=14

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map(c => [first, ...c]),
    ...combinations(rest, k),
  ];
}

// Evaluate a 5-card hand. Returns { rank (0-8), tiebreakers: [] }.
// rank 8=straight flush, 7=quads, 6=full house, 5=flush, 4=straight,
//      3=trips, 2=two pair, 1=pair, 0=high card
function eval5(hand) {
  const vals = hand.map(c => RANK_VAL[c.rank]).sort((a, b) => b - a);
  const suits = hand.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  // Check straight (handle A-2-3-4-5 wheel)
  let isStraight = false;
  let straightHigh = vals[0];
  if (vals[0] - vals[4] === 4 && new Set(vals).size === 5) {
    isStraight = true;
  } else if (vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) {
    isStraight = true;
    straightHigh = 5; // wheel
  }

  if (isFlush && isStraight) return { rank: 8, tiebreakers: [straightHigh] };

  // Count frequencies
  const freq = {};
  for (const v of vals) freq[v] = (freq[v] || 0) + 1;
  const counts = Object.entries(freq)
    .map(([v, c]) => ({ v: +v, c }))
    .sort((a, b) => b.c - a.c || b.v - a.v);

  const [top, sec] = counts;
  if (top.c === 4) return { rank: 7, tiebreakers: [top.v, sec.v] };
  if (top.c === 3 && sec?.c === 2) return { rank: 6, tiebreakers: [top.v, sec.v] };
  if (isFlush) return { rank: 5, tiebreakers: vals };
  if (isStraight) return { rank: 4, tiebreakers: [straightHigh] };
  if (top.c === 3) return { rank: 3, tiebreakers: [top.v, ...counts.slice(1).map(x => x.v)] };
  if (top.c === 2 && sec?.c === 2) {
    const pairs = counts.filter(x => x.c === 2).map(x => x.v).sort((a, b) => b - a);
    const kicker = counts.find(x => x.c === 1)?.v;
    return { rank: 2, tiebreakers: [...pairs, kicker] };
  }
  if (top.c === 2) return { rank: 1, tiebreakers: [top.v, ...counts.slice(1).map(x => x.v)] };
  return { rank: 0, tiebreakers: vals };
}

// Best 5 from 7 cards (hole + community).
export function bestHand(cards) {
  let best = null;
  for (const five of combinations(cards, 5)) {
    const result = eval5(five);
    if (!best || compareEval(result, best) > 0) best = result;
  }
  return best;
}

function compareEval(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const diff = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

// ── Side pot calculation ──────────────────────────────────────────────────────

// Returns array of { amount, eligibleSeats: Set<seatIdx> }.
function calcSidePots(seats) {
  // seats: [{ seatIdx, contributed, folded, chips }]
  const active = seats.filter(s => s.contributed > 0);
  if (!active.length) return [];

  const levels = [...new Set(active.map(s => s.contributed))].sort((a, b) => a - b);
  const pots = [];
  let prevLevel = 0;

  for (const level of levels) {
    const slice = level - prevLevel;
    const eligible = active.filter(s => s.contributed >= level && !s.folded);
    const contributing = active.filter(s => s.contributed >= level);
    const amount = slice * contributing.length;
    if (amount > 0) {
      pots.push({ amount, eligibleSeats: new Set(eligible.map(s => s.seatIdx)) });
    }
    prevLevel = level;
  }
  return pots;
}

// ── HoldemGame class ──────────────────────────────────────────────────────────

export class HoldemGame {
  constructor(config = {}) {
    this.smallBlind = config.smallBlind || 10;
    this.bigBlind   = config.bigBlind   || 20;
    this.phase = 'idle'; // idle → preflop → flop → turn → river → showdown
    this.deck = [];
    this.community = [];
    this.seats = []; // [{ seatIdx, playerId, handle, chips, hand: [], bet, contributed, folded, allIn, sitOut }]
    this.pot = 0;
    this.sidePots = [];
    this.dealerIdx = -1;  // seat array index of current dealer
    this.actionIdx = -1;  // seat array index whose turn it is
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastRaiserIdx = -1;
    this.streetStartIdx = -1; // first seat to act this street; closes an unraised round
    this.dealPhase = false; // true for one render cycle after dealing
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  // Attach seats from the GameTable.
  // activePlayers: [{ seatIdx, playerId, handle, chips }] ordered by seat index.
  startHand(activePlayers, dealerSeatIdx) {
    this.dealPhase = true;
    this.deck = shuffle(makeDeck());
    this.community = [];
    this.pot = 0;
    this.sidePots = [];
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastRaiserIdx = -1;

    this.seats = activePlayers.map(p => ({
      seatIdx: p.seatIdx,
      playerId: p.playerId,
      handle: p.handle,
      chips: p.chips,
      hand: [],
      bet: 0,
      contributed: 0,
      folded: false,
      allIn: false,
      sitOut: false,
    }));

    // Advance dealer button
    const prevDealer = this.seats.findIndex(s => s.seatIdx === dealerSeatIdx);
    this.dealerIdx = prevDealer >= 0 ? prevDealer : 0;

    // Deal 2 hole cards to each player (one at a time, dealer-left order)
    const order = this._actingOrder(this.dealerIdx);
    for (let pass = 0; pass < 2; pass++) {
      for (const i of order) {
        this.seats[i].hand.push(this.deck.pop());
      }
    }

    // Post blinds
    const sbIdx = this._nextActive(this.dealerIdx);
    const bbIdx = this._nextActive(sbIdx);
    this._postBlind(sbIdx, this.smallBlind);
    this._postBlind(bbIdx, this.bigBlind);
    this.currentBet = this.bigBlind;

    // Action starts left of BB
    this.actionIdx = this._nextActive(bbIdx);
    this.streetStartIdx = this.actionIdx;
    this.lastRaiserIdx = bbIdx;
    this.phase = 'preflop';
    return { sbIdx, bbIdx, sbHandle: this.seats[sbIdx].handle, bbHandle: this.seats[bbIdx].handle };
  }

  _postBlind(idx, amount) {
    const seat = this.seats[idx];
    const actual = Math.min(amount, seat.chips);
    seat.chips -= actual;
    seat.bet += actual;
    seat.contributed += actual;
    this.pot += actual;
    if (seat.chips === 0) seat.allIn = true;
  }

  // ── Betting ───────────────────────────────────────────────────────────────

  // Returns { ok, error, events: [] } where events are narration strings.
  handleAction(playerId, action, amount = 0) {
    const idx = this.seats.findIndex(s => s.playerId === playerId);
    if (idx < 0) return { ok: false, error: 'You are not at the table.' };
    if (idx !== this.actionIdx) return { ok: false, error: 'It is not your turn.' };
    const seat = this.seats[idx];
    if (seat.folded) return { ok: false, error: 'You have already folded.' };

    const events = [];

    switch (action) {
      case 'fold':
        seat.folded = true;
        events.push(`${seat.handle} folds.`);
        break;

      case 'check': {
        if (seat.bet < this.currentBet) return { ok: false, error: `You must call ${this.currentBet - seat.bet} or raise.` };
        events.push(`${seat.handle} checks.`);
        break;
      }

      case 'call': {
        const toCall = Math.min(this.currentBet - seat.bet, seat.chips);
        if (toCall <= 0) return { ok: false, error: 'Nothing to call. Use check.' };
        seat.chips -= toCall;
        seat.bet += toCall;
        seat.contributed += toCall;
        this.pot += toCall;
        if (seat.chips === 0) { seat.allIn = true; events.push(`${seat.handle} calls ${toCall} and is all in!`); }
        else events.push(`${seat.handle} calls ${toCall}.`);
        break;
      }

      case 'bet':
      case 'raise': {
        const total = Number(amount);
        if (!total || total <= 0) return { ok: false, error: 'Specify an amount.' };
        const raiseBy = total - seat.bet;
        if (total <= this.currentBet) return { ok: false, error: `Raise must be above ${this.currentBet}.` };
        if (raiseBy < this.minRaise && seat.chips > raiseBy)
          return { ok: false, error: `Minimum raise is ${this.minRaise}.` };
        const actual = Math.min(raiseBy, seat.chips);
        this.minRaise = Math.max(this.minRaise, raiseBy);
        seat.chips -= actual;
        seat.bet += actual;
        seat.contributed += actual;
        this.pot += actual;
        this.currentBet = seat.bet;
        this.lastRaiserIdx = idx;
        if (seat.chips === 0) { seat.allIn = true; events.push(`${seat.handle} raises to ${seat.bet} and is all in!`); }
        else events.push(`${seat.handle} raises to ${seat.bet}.`);
        break;
      }

      case 'allin': {
        const all = seat.chips;
        seat.chips = 0;
        seat.bet += all;
        seat.contributed += all;
        this.pot += all;
        seat.allIn = true;
        if (seat.bet > this.currentBet) {
          this.minRaise = Math.max(this.minRaise, seat.bet - this.currentBet);
          this.currentBet = seat.bet;
          this.lastRaiserIdx = idx;
        }
        events.push(`${seat.handle} goes all in for ${all}!`);
        break;
      }

      default:
        return { ok: false, error: `Unknown action: ${action}` };
    }

    this.dealPhase = false;

    // Advance action
    const advanced = this._advanceAction(idx);
    if (!advanced) {
      // Betting round over — advance phase
      const phaseResult = this._nextPhase();
      return { ok: true, events, phaseResult };
    }
    return { ok: true, events };
  }

  // ── Phase progression ─────────────────────────────────────────────────────

  _nextPhase() {
    // Reset bets for next round
    for (const s of this.seats) s.bet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    // Check if only one player remains
    const alive = this.seats.filter(s => !s.folded);
    if (alive.length === 1) {
      return this._rundown(alive);
    }

    switch (this.phase) {
      case 'preflop':
        this.deck.pop(); // burn
        this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this.phase = 'flop';
        break;
      case 'flop':
        this.deck.pop(); // burn
        this.community.push(this.deck.pop());
        this.phase = 'turn';
        break;
      case 'turn':
        this.deck.pop(); // burn
        this.community.push(this.deck.pop());
        this.phase = 'river';
        break;
      case 'river':
        this.phase = 'showdown';
        return this._showdown();
    }

    // Set action to first active left of dealer
    this.actionIdx = this._nextActive(this.dealerIdx);
    this.streetStartIdx = this.actionIdx;
    this.lastRaiserIdx = -1;
    return { phase: this.phase };
  }

  // ── Showdown & rundown ────────────────────────────────────────────────────

  _rundown(alive) {
    // Only one player left — they win everything.
    const winner = alive[0];
    winner.chips += this.pot;
    this.pot = 0;
    this.phase = 'showdown';
    return { phase: 'showdown', winners: [{ seat: winner, chips: winner.chips, reason: 'everyone folded', handName: null }] };
  }

  _showdown() {
    const contestants = this.seats.filter(s => !s.folded);
    // Evaluate hands
    for (const s of contestants) {
      s.bestHand = bestHand([...s.hand, ...this.community]);
      s.handName = HAND_NAMES[s.bestHand.rank];
    }

    // Build side pots
    const potContribs = this.seats.map(s => ({
      seatIdx: s.seatIdx,
      contributed: s.contributed,
      folded: s.folded,
      chips: s.chips,
    }));
    const pots = calcSidePots(potContribs);
    if (!pots.length) pots.push({ amount: this.pot, eligibleSeats: new Set(contestants.map(s => s.seatIdx)) });

    const winners = [];
    for (const pot of pots) {
      const eligible = contestants.filter(s => pot.eligibleSeats.has(s.seatIdx));
      if (!eligible.length) continue;
      // Find best hand among eligible
      let best = null;
      for (const s of eligible) {
        if (!best || compareEval(s.bestHand, best.bestHand) > 0) best = s;
      }
      // Check for ties
      const tied = eligible.filter(s => compareEval(s.bestHand, best.bestHand) === 0);
      const share = Math.floor(pot.amount / tied.length);
      const remainder = pot.amount - share * tied.length;
      for (const s of tied) {
        s.chips += share;
        winners.push({ seat: s, chips: share, reason: s.handName, handName: s.handName });
      }
      // Remainder to first winner (closest to dealer)
      if (remainder > 0) tied[0].chips += remainder;
    }

    this.pot = 0;
    return { phase: 'showdown', winners };
  }

  // ── Action ordering helpers ───────────────────────────────────────────────

  _actingOrder(fromIdx) {
    const n = this.seats.length;
    const order = [];
    for (let i = 1; i <= n; i++) order.push((fromIdx + i) % n);
    return order;
  }

  _nextActive(fromIdx) {
    const n = this.seats.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromIdx + i) % n;
      const s = this.seats[idx];
      if (!s.folded && !s.allIn) return idx;
    }
    return -1;
  }

  // Returns true if action should continue, false if betting round is over.
  _advanceAction(justActedIdx) {
    const n = this.seats.length;
    // Round closes when action returns to the last raiser, or — on an unraised
    // street — to whoever acted first. Without the latter, a check-around never
    // terminates because every matched seat keeps getting handed the action.
    const closer = this.lastRaiserIdx >= 0 ? this.lastRaiserIdx : this.streetStartIdx;
    for (let i = 1; i <= n; i++) {
      const idx = (justActedIdx + i) % n;
      if (idx === closer) break; // full circle
      const s = this.seats[idx];
      if (s.folded || s.allIn) continue;
      if (s.bet < this.currentBet) { this.actionIdx = idx; return true; }
      // uncalled player still to act
      if (this.lastRaiserIdx === -1) { this.actionIdx = idx; return true; }
    }
    // No more action needed
    this.actionIdx = -1;
    return false;
  }

  // True while at least two players can still put chips in (i.e. betting is
  // possible). When false, remaining streets should be dealt without action.
  bettingOpen() {
    return this.seats.filter(s => !s.folded && !s.allIn).length >= 2;
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  toJSON() {
    return {
      phase: this.phase,
      community: this.community,
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerIdx: this.dealerIdx,
      actionIdx: this.actionIdx,
      streetStartIdx: this.streetStartIdx,
      lastRaiserIdx: this.lastRaiserIdx,
      seats: this.seats,
      dealPhase: this.dealPhase,
    };
  }

  static fromJSON(data, config) {
    const g = new HoldemGame(config);
    Object.assign(g, data);
    return g;
  }

  // ── Helpers for plugin ────────────────────────────────────────────────────

  getActiveSeat(playerId) {
    return this.seats.find(s => s.playerId === playerId) || null;
  }

  getCurrentActor() {
    return this.actionIdx >= 0 ? this.seats[this.actionIdx] : null;
  }

  getDealerSeat() {
    return this.dealerIdx >= 0 ? this.seats[this.dealerIdx] : null;
  }

  isOver() {
    return this.phase === 'showdown';
  }

  canCheck(playerId) {
    const s = this.seats.find(x => x.playerId === playerId);
    return s && s.bet >= this.currentBet;
  }
}
