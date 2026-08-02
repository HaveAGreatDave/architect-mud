// Tablet OS — BINDER. Where your cards actually live.
//
// The `cards` verb prints a shelf into the log, which is fine for "what have I
// got" and hopeless for the thing a collection is actually for: seeing the shape
// of it. A binder is a different question — how far through a rank am I, what is
// doubled up, whose face have I never pulled — and none of that reads as text in
// a scrolling window.
//
// TWO DECISIONS WORTH NOT UNDOING:
//
//  1. THE DENOMINATOR IS REAL, unlike the Accolades file next door. That app
//     hides its total on purpose, because naming an unearned joke spoils it. A
//     card set is the opposite: "31 of 214" IS the feature, and a collection
//     with no visible completion is just a pile. So the binder counts the live
//     pool and shows exactly how far off you are.
//
//  2. IT SHOWS SLOTS YOU HAVEN'T FILLED, but never who is in them. An empty slot
//     is the ache the whole system runs on; an empty slot with a NAME on it is a
//     shopping list, and it would also leak the roster of every player who has
//     minted. So a gap is drawn as a gap, counted but anonymous.
//
// Cold path — two reads, only when a player opens the app. No tick, no cache.
import { registerTabletApp, normScreen } from './registry.js';
import { query } from '../../server/models/db.js';

// Cached module rather than a static import, so the tablet stays load-order
// agnostic with respect to the cards plugin (matches accolades-app/surveillance-app).
const cards = () => import('../cards/index.js');

const RANK_ORDER = ['architect', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
const RANK_LABEL = {
  architect: 'Architect', legendary: 'Legendary', epic: 'Epic',
  rare: 'Rare', uncommon: 'Uncommon', common: 'Common',
};

async function buildScreen(player, screenId, params) {
  const norm = normScreen(screenId);

  // ── one card, read in full ──────────────────────────────────────────────────
  // Reachable two ways because the tablet has two shapes of navigation: the
  // client sends the id as a separate token (`tabletnav binder card 12`), while
  // a hand-typed `tabletnav binder card_12` arrives normalised into one string.
  // Both are legitimate input, so both resolve rather than one silently missing.
  const one = norm.match(/^card (\d+)$/)
    || (norm === 'card' ? String(params || '').trim().match(/^(\d+)$/) : null);
  if (one) {
    const { renderCard } = await cards();
    const { rows } = await query(
      `SELECT c.*, h.qty FROM cards c JOIN card_holdings h ON h.card_id = c.id
       WHERE c.id = $1 AND h.player_id = $2`,
      [Number(one[1]), player.id]
    );
    // Not on your shelf is not an error worth a stack trace — you can only reach
    // this screen from a card you own, so a miss means it was scrapped in another
    // window. Fall back to the binder rather than showing a dead end.
    if (!rows.length) return buildScreen(player, null);
    const c = rows[0];
    return {
      view: 'binder_card',
      breadcrumb: ['Binder', c.subject_name],
      card: {
        id: c.id, name: c.subject_name, type: c.subject_type, rarity: c.rarity,
        qty: Number(c.qty) || 1, series: c.series, serial: c.serial,
        marks: c.text_blocks?.marks || '',
        face: renderCard(c),
      },
    };
  }

  // ── the binder ──────────────────────────────────────────────────────────────
  const [{ rows: held }, { rows: pool }] = await Promise.all([
    query(
      `SELECT c.id, c.subject_name, c.subject_type, c.rarity, c.power, c.series, c.serial,
              c.text_blocks, h.qty
       FROM card_holdings h JOIN cards c ON c.id = h.card_id
       WHERE h.player_id = $1 ORDER BY c.series, c.serial`,
      [player.id]
    ),
    // pool_weight > 0 is the SET: the architect rank never rolls, so counting it
    // in the denominator would make 100% unreachable by design and the meter a
    // lie. It gets its own shelf below instead, with no total.
    query(`SELECT rarity, COUNT(*)::int AS n FROM cards WHERE pool_weight > 0 GROUP BY rarity`),
  ]);

  const totalBy = {};
  for (const r of pool) totalBy[r.rarity] = r.n;
  const setTotal = Object.values(totalBy).reduce((a, b) => a + b, 0);

  const byRank = {};
  for (const c of held) (byRank[c.rarity] ||= []).push(c);

  const ranks = RANK_ORDER.filter(r => totalBy[r] || byRank[r]?.length).map(rank => {
    const owned = byRank[rank] || [];
    const total = totalBy[rank] || 0;
    return {
      rarity: rank,
      label: RANK_LABEL[rank] || rank,
      owned: owned.length,
      total,                                  // 0 for architect — the client hides the ratio
      // A gap is a gap. Counted, never named — see the header note.
      gaps: Math.max(0, total - owned.length),
      cards: owned.map(c => ({
        id: c.id, name: c.subject_name, type: c.subject_type, rarity: c.rarity,
        qty: Number(c.qty) || 1, power: c.power, serial: c.serial,
        marks: c.text_blocks?.marks || '',
      })),
    };
  });

  const distinct = held.length;
  const dupes = held.reduce((a, c) => a + Math.max(0, (Number(c.qty) || 1) - 1), 0);

  return {
    view: 'binder',
    breadcrumb: [],
    distinct,
    setTotal,
    dupes,
    // Completion is against the ROLLABLE set, so it can actually reach 100.
    pct: setTotal ? Math.round((distinct / setTotal) * 100) : 0,
    ranks,
  };
}

registerTabletApp({
  id: 'binder', name: 'Binder', icon: '🃏', category: 'Fun',
  buildScreen,
});
