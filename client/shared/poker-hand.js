// What a hold'em hand is, in words, for the player holding it: the best five of your two and the board ("Flush, ace
// high", "Two pair, kings and sevens"), and what you're drawing to while there's board to come ("flush draw",
// "open-ended straight draw"). Pure, so a gate reads it. It decides nothing: the table (plugins/gametable
// games/holdem.js) settles every pot itself. Cards are { rank: '2'..'10'|'J'|'Q'|'K'|'A' (or 'T'), suit: s|h|d|c }.

const VAL = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const ONE = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };
const plural = (v) => (v === 6 ? 'sixes' : ONE[v] + 's');
export const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const valOf = (c) => VAL[String(c?.rank || '').toUpperCase()] || 0;

// the top of a straight in a set of values, or 0 (the wheel, A-2-3-4-5, is five high)
function straightTop(vals) {
  const has = new Set(vals);
  if (has.has(14)) has.add(1);
  for (let top = 14; top >= 5; top--) {
    let run = true;
    for (let k = 0; k < 5; k++) if (!has.has(top - k)) { run = false; break; }
    if (run) return top;
  }
  return 0;
}

// Whether a card is one of the five that make the hand, so a picture can light those up: `hand` handOf's answer.
export const inHand = (hand, c) => !!hand && !!c && (hand.suit ? c.suit === hand.suit && (!hand.vals || hand.vals.has(valOf(c)) || (valOf(c) === 14 && hand.vals.has(1))) : hand.vals?.has(valOf(c)) || (valOf(c) === 14 && hand.vals?.has(1)));
const run = (top) => new Set([0, 1, 2, 3, 4].map((k) => top - k));
// { rank 0..8, name, suit?, vals } for any two to seven cards; rank orders the categories, high card 0 to straight
// flush 8; `suit` and `vals` say which cards make it (inHand)
export function handOf(cards) {
  const cs = (cards || []).filter((c) => c && valOf(c));
  if (!cs.length) return null;
  const bySuit = {};
  for (const c of cs) (bySuit[c.suit] ||= []).push(valOf(c));
  const flushSuit = Object.keys(bySuit).find((s) => bySuit[s].length >= 5);
  if (flushSuit) {
    const top = straightTop(bySuit[flushSuit]);
    if (top) return { rank: 8, name: top === 14 ? 'Royal flush' : `Straight flush, ${ONE[top]} high`, suit: flushSuit, vals: run(top) };
  }
  const count = new Map();
  for (const c of cs) count.set(valOf(c), (count.get(valOf(c)) || 0) + 1);
  const groups = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [v1, n1] = groups[0], [v2, n2] = groups[1] || [0, 0];
  if (n1 === 4) return { rank: 7, name: `Four ${plural(v1)}`, vals: new Set([v1]) };
  if (n1 === 3 && n2 >= 2) return { rank: 6, name: `Full house, ${plural(v1)} over ${plural(v2)}`, vals: new Set([v1, v2]) };
  if (flushSuit) return { rank: 5, name: `Flush, ${ONE[Math.max(...bySuit[flushSuit])]} high`, suit: flushSuit, vals: new Set(bySuit[flushSuit].sort((a, b) => b - a).slice(0, 5)) };
  const top = straightTop([...count.keys()]);
  if (top) return { rank: 4, name: `Straight, ${ONE[top]} high`, vals: run(top) };
  if (n1 === 3) return { rank: 3, name: `Three ${plural(v1)}`, vals: new Set([v1]) };
  if (n1 === 2 && n2 === 2) return { rank: 2, name: `Two pair, ${plural(v1)} and ${plural(v2)}`, vals: new Set([v1, v2]) };
  if (n1 === 2) return { rank: 1, name: `Pair of ${plural(v1)}`, vals: new Set([v1]) };
  return { rank: 0, name: `${ONE[v1][0].toUpperCase()}${ONE[v1].slice(1)} high`, vals: new Set([v1]) };
}

// What two hole cards and a board short of five are drawing to, as words, or [] (a made flush or straight draws to nothing)
export function drawsOf(hole, board) {
  const all = [...(hole || []), ...(board || [])].filter((c) => c && valOf(c));
  if ((board || []).length >= 5 || all.length < 4) return [];
  const made = handOf(all)?.rank || 0, out = [];
  if (made < 5) {
    const bySuit = {};
    for (const c of all) bySuit[c.suit] = (bySuit[c.suit] || 0) + 1;
    // a flush draw counts only when one of yours is in it
    if (Object.entries(bySuit).some(([s, n]) => n === 4 && hole.some((c) => c?.suit === s))) out.push('flush draw');
  }
  if (made < 4) {
    const has = new Set(all.map(valOf));
    if (has.has(14)) has.add(1);
    let open = false, gut = false;
    for (let lo = 1; lo <= 10; lo++) {
      const n = [0, 1, 2, 3, 4].filter((k) => has.has(lo + k)).length;
      if (n !== 4) continue;
      // four in a row with room at both ends is open-ended; any other four of five is a gutshot
      const row = [0, 1, 2, 3].every((k) => has.has(lo + k)) && lo + 4 <= 14 && lo > 1 && !has.has(lo + 4);
      if (row) open = true; else gut = true;
    }
    if (open) out.push('open-ended straight draw'); else if (gut) out.push('gutshot');
  }
  return out;
}
