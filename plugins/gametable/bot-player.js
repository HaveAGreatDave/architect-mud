// Bot poker player — server-driven seat occupant (no WebSocket).
//
// A bot seat's `playerId` is `npc:<npcId>`. Real player ids are numeric, so this
// never collides and every existing `s.playerId === x` comparison keeps working.
//
// Phase 2: a real (but beatable) strategy engine. Preflop hand strength via a
// Chen-style score; postflop made-hand tiers + draw detection reusing the rules
// module's `bestHand`; decisions from pot odds + personality (tightness,
// aggression, bluffFreq, semiBluffFreq, betSizing). Table talk & tilt come later.

import { bestHand } from './games/holdem.js';

export function botId(npcId) { return `npc:${npcId}`; }
export function isBotId(id) { return typeof id === 'string' && id.startsWith('npc:'); }

const RV = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
const rankVal = c => RV[c.rank];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ── Hand strength ──────────────────────────────────────────────────────────

// Chen "point" for the higher card of a starting hand.
function chenPoint(v) {
  if (v === 14) return 10;  // A
  if (v === 13) return 8;   // K
  if (v === 12) return 7;   // Q
  if (v === 11) return 6;   // J
  return v / 2;
}

// Preflop strength 0..1 from the two hole cards (normalised Chen formula).
// AA ≈ 1.0, KK ≈ 0.8, AKs ≈ 0.6, mid pairs ≈ 0.4–0.5, junk ≈ 0.
function preflopStrength(hand) {
  const [hi, lo] = hand.map(rankVal).sort((a, b) => b - a);
  const suited = hand[0].suit === hand[1].suit;
  let score;
  if (hi === lo) {
    score = Math.max(chenPoint(hi) * 2, 5); // pair
  } else {
    score = chenPoint(hi);
    if (suited) score += 2;
    const gap = hi - lo - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && hi < 12) score += 1; // straighty bonus, low cards
  }
  return clamp(score / 20, 0, 1);
}

// Made-hand strength 0..1 given the best 5-card eval plus board context, so a
// "pair" is graded by whether it's top pair, an overpair, or bottom pair.
function madeStrength(made, hand, community) {
  const rank = made.rank;
  if (rank >= 7) return 1.0;   // quads / straight flush
  if (rank === 6) return 0.95; // full house
  if (rank === 5) return 0.85; // flush
  if (rank === 4) return 0.82; // straight
  if (rank === 3) return 0.78; // trips
  if (rank === 2) return 0.68; // two pair
  if (rank === 1) {
    const pairVal = made.tiebreakers[0];
    const boardVals = community.map(rankVal);
    const maxBoard = Math.max(...boardVals);
    const holeVals = hand.map(rankVal);
    if (!holeVals.includes(pairVal)) return 0.30; // board pair, we hold only kickers
    if (holeVals[0] === holeVals[1]) return pairVal > maxBoard ? 0.72 : 0.42; // over/underpair
    if (pairVal >= maxBoard) return 0.60; // top pair
    const higher = boardVals.filter(v => v > pairVal).length;
    return higher <= 1 ? 0.45 : 0.32; // middle vs bottom pair
  }
  return 0.15; // high card
}

// Draw equity 0..~0.25 for semi-bluff/calling purposes (flop & turn only).
function drawEquity(hand, community) {
  if (community.length >= 5 || community.length < 3) return 0;
  const cards = [...hand, ...community];

  let eq = 0;
  const suitCounts = {};
  for (const c of cards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  if (Object.values(suitCounts).some(n => n === 4)) eq = Math.max(eq, 0.25); // flush draw

  const set = new Set(cards.map(rankVal));
  if (set.has(14)) set.add(1); // wheel ace
  for (let low = 1; low <= 10; low++) {
    const window = [low, low + 1, low + 2, low + 3, low + 4];
    const present = window.filter(v => set.has(v));
    if (present.length !== 4) continue;
    const missing = window.find(v => !set.has(v));
    if (missing === low || missing === low + 4) eq = Math.max(eq, 0.20); // open-ended
    else eq = Math.max(eq, 0.08); // gutshot
  }
  return eq;
}

function evaluateStrength(game, gs) {
  const community = game.community || [];
  if (community.length === 0) return { strength: preflopStrength(gs.hand), draw: 0 };
  const made = bestHand([...gs.hand, ...community]);
  return { strength: madeStrength(made, gs.hand, community), draw: drawEquity(gs.hand, community) };
}

// ── Bet sizing ─────────────────────────────────────────────────────────────

// Open the betting (no bet owed): a pot-fraction bet, rounded to the small blind.
function sizeBet(game, gs, p) {
  const sb = game.smallBlind || 10;
  let amount = Math.round((game.pot * (p.betSizing ?? 0.6)) / sb) * sb;
  const min = game.currentBet > 0 ? game.currentBet + game.minRaise : (game.bigBlind || sb * 2);
  amount = Math.max(amount, min);
  if (amount >= gs.bet + gs.chips) return { action: 'allin', amount: 0 };
  return { action: game.currentBet > 0 ? 'raise' : 'bet', amount };
}

// Raise facing a bet: raise-to = current bet + a pot-fraction increment.
function sizeRaise(game, gs, p) {
  const sb = game.smallBlind || 10;
  const toCall = game.currentBet - gs.bet;
  const raw = Math.round(((game.pot + toCall) * (p.betSizing ?? 0.6)) / sb) * sb;
  const total = game.currentBet + Math.max(game.minRaise, raw);
  if (total >= gs.bet + gs.chips) return { action: 'allin', amount: 0 };
  return { action: 'raise', amount: total };
}

// ── Decision ───────────────────────────────────────────────────────────────

// Decide the bot's action for the current spot. Returns { action, amount }.
export function decideBotAction(table, seat) {
  const game = table.game;
  const gs = game?.getActiveSeat(seat.playerId);
  if (!gs) return { action: 'fold', amount: 0 };

  const p = seat.persona || {};
  const aggression    = clamp(p.aggression ?? 0.5, 0, 1);
  const tightness     = clamp(p.tightness ?? 0.5, 0, 1);
  const bluffFreq     = p.bluffFreq ?? 0.15;
  const semiBluffFreq = p.semiBluffFreq ?? 0.4;

  const { strength, draw } = evaluateStrength(game, gs);
  const toCall = Math.max(0, game.currentBet - gs.bet);

  if (toCall === 0) {
    // Nothing owed — check, or bet for value / as a semi-bluff / as a pure bluff.
    const wantValue     = strength >= 0.55 - aggression * 0.15;
    const wantSemiBluff = draw >= 0.15 && Math.random() < semiBluffFreq;
    const wantBluff     = strength < 0.30 && draw < 0.15 && Math.random() < bluffFreq;
    if (wantValue || wantSemiBluff || wantBluff) return sizeBet(game, gs, p);
    return { action: 'check', amount: 0 };
  }

  // Facing a bet — fold, call, or raise.
  const potOdds = toCall / (game.pot + toCall);
  const callStrength = Math.max(strength, 0.5 * strength + draw);

  const wantValueRaise     = strength >= 0.78 - aggression * 0.20 && Math.random() < 0.5 + aggression * 0.4;
  const wantSemiBluffRaise = draw >= 0.18 && strength < 0.5 && Math.random() < semiBluffFreq * 0.7;
  // Pure-air bluff-raises only into cheap bets — never shove a big bet with nothing.
  const wantBluffRaise     = strength < 0.22 && draw < 0.10 && toCall <= game.pot * 0.5 && Math.random() < bluffFreq * 0.5;
  if (wantValueRaise || wantSemiBluffRaise || wantBluffRaise) return sizeRaise(game, gs, p);

  const cushion = 0.03 + tightness * 0.10; // tighter players demand a better price
  if (callStrength >= potOdds + cushion) return { action: 'call', amount: 0 };
  if (potOdds < 0.15 && (strength > 0.25 || draw > 0.10)) return { action: 'call', amount: 0 }; // cheap peel
  return { action: 'fold', amount: 0 };
}
