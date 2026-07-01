/**
 * SIFT + FATE — unified target resolution system.
 *
 * FATE (Fast Action Target Engine): used in combat — always returns exactly
 *   one best candidate, no UI, deterministic via tie-breakers.
 * SIFT (System for Intent Filtering & Targeting): used outside combat —
 *   fuzzy scoring with paged disambiguation when candidates are too close.
 *
 * Public surface:
 *   resolveForCommand(query, candidates, player, context) → decides SIFT vs FATE
 *   resolve(query, candidates, context)                   → SIFT only
 *   getSelectionState / createSelectionState / advanceSelectionState / clearSelectionState
 *   formatSelectionPage
 */

// ---------------------------------------------------------------------------
// Scoring — shared by SIFT and FATE (0 = no match, 100 = exact)
// ---------------------------------------------------------------------------

function scoreCandidate(name, query) {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (n === q) return 100;
  if (n.includes(q)) return 90 + Math.min(9, Math.floor(9 * q.length / n.length));
  if (n.startsWith(q)) return 70 + Math.min(19, Math.floor(19 * q.length / n.length));
  const nWords = new Set(n.split(/\s+/));
  const qWords = q.split(/\s+/);
  const overlap = qWords.filter(w => nWords.has(w)).length;
  if (overlap > 0) return 40 + Math.min(29, Math.floor(29 * overlap / qWords.length));
  if ([...nWords].some(w => w.startsWith(q))) return 10 + Math.min(29, Math.floor(29 * q.length / n.length));
  return 0;
}

// ---------------------------------------------------------------------------
// FATE — internal, never exported
// ---------------------------------------------------------------------------

const tieBreakers = [
  // 1. Last attacked target wins
  (a, b, ctx) => {
    if (!ctx.lastAttackedTargetId) return 0;
    const aLast = a.instanceId === ctx.lastAttackedTargetId ? -1 : 0;
    const bLast = b.instanceId === ctx.lastAttackedTargetId ? -1 : 0;
    return aLast - bLast;
  },
  // 2. Stable fallback: lowest ID
  (a, b) => (String(a.instanceId) < String(b.instanceId) ? -1 : 1),
  // future tie-breakers can be added here without modifying the sort logic
];

function fateResolve(query, candidates, context = {}) {
  if (!candidates.length) return { type: 'none' };
  const scored = candidates
    .map(c => ({ candidate: c, score: scoreCandidate(c.name, query) }))
    .filter(s => s.score > 0);
  if (!scored.length) return { type: 'none' };
  scored.sort((a, b) => {
    const d = b.score - a.score;
    if (d !== 0) return d;
    for (const tb of tieBreakers) {
      const r = tb(a.candidate, b.candidate, context);
      if (r !== 0) return r;
    }
    return 0;
  });
  return { type: 'auto_target', candidate: scored[0].candidate, score: scored[0].score };
}

// ---------------------------------------------------------------------------
// SIFT — exported
// ---------------------------------------------------------------------------

// Ambiguity threshold: gap < 8 (equivalent to 0.08 on a 0–1 scale).
export function resolve(query, candidates, context = {}) {
  if (!candidates.length) return { type: 'none' };
  const scored = candidates
    .map(c => ({ candidate: c, score: scoreCandidate(c.name, query) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { type: 'none' };
  if (scored.length === 1 || scored[0].score - scored[1].score >= 8)
    return { type: 'match', candidate: scored[0].candidate, score: scored[0].score };
  // Identical names at the top score are interchangeable — pick the first one silently.
  const topScore = scored[0].score;
  const topName = scored[0].candidate.name.toLowerCase();
  if (scored.every(s => s.score < topScore || s.candidate.name.toLowerCase() === topName))
    return { type: 'match', candidate: scored[0].candidate, score: topScore };
  return { type: 'ambiguous', candidates: scored.map(s => s.candidate) };
}

// All candidates SIFT considers a match (score > 0), best-first. Used by bulk
// verbs like "drop all <filter>" that act on every match instead of prompting
// to disambiguate — the same scoring, no ambiguity gate.
export function matchAll(query, candidates) {
  return candidates
    .map(c => ({ candidate: c, score: scoreCandidate(c.name, query) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.candidate);
}

// ---------------------------------------------------------------------------
// Public entry point — decides SIFT vs FATE based on combat context
// ---------------------------------------------------------------------------

const COMBAT_VERBS = new Set(['attack', 'hit', 'strike', 'shoot', 'kill', 'k', 'a']);

export function resolveForCommand(query, candidates, player, context = {}) {
  const useFate =
    (player.combatTargetId != null) ||
    context.combatScope === true ||
    COMBAT_VERBS.has(context.verb);
  if (useFate) {
    return fateResolve(query, candidates, {
      ...context,
      lastAttackedTargetId: player.combatTargetId,
    });
  }
  return resolve(query, candidates, context);
}

// ---------------------------------------------------------------------------
// Selection state — per-player, in-memory, non-combat only
// ---------------------------------------------------------------------------

const selectionState = new Map();
const PAGE_SIZE = 5;
const TTL = 60_000;

export function getSelectionState(playerId) {
  return selectionState.get(playerId) ?? null;
}

export function clearSelectionState(playerId) {
  selectionState.delete(playerId);
}

export function createSelectionState(playerId, allCandidates, context) {
  selectionState.set(playerId, {
    allCandidates,
    visibleIndex: 0,
    pageSize: PAGE_SIZE,
    context,  // { verb, dispatchType?, dispatchParam? }
    expiresAt: Date.now() + TTL,
  });
}

/**
 * Advance or resolve the player's active selection state.
 * Returns:
 *   { type:'selected', candidate }   — player picked a number
 *   { type:'page', state }           — next/prev paging
 *   { type:'cancel' }                — player cancelled
 *   { type:'refine', query }         — treat as fresh command against same candidates
 *   null                             — state expired; caller falls through to normal pipeline
 */
export function advanceSelectionState(playerId, input) {
  const state = selectionState.get(playerId);
  if (!state || Date.now() > state.expiresAt) {
    selectionState.delete(playerId);
    return null;
  }
  const t = input.trim().toLowerCase();
  if (t === 'cancel' || t === 'exit') {
    clearSelectionState(playerId);
    return { type: 'cancel' };
  }
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= PAGE_SIZE) {
    const idx = state.visibleIndex + (n - 1);
    if (idx < state.allCandidates.length) {
      const candidate = state.allCandidates[idx];
      clearSelectionState(playerId);
      return { type: 'selected', candidate };
    }
  }
  if (t === 'next') {
    state.visibleIndex = Math.min(state.visibleIndex + PAGE_SIZE, state.allCandidates.length - 1);
    return { type: 'page', state };
  }
  if (t === 'prev') {
    state.visibleIndex = Math.max(0, state.visibleIndex - PAGE_SIZE);
    return { type: 'page', state };
  }
  // Anything else: refinement query — clear state and re-process as fresh input
  clearSelectionState(playerId);
  return { type: 'refine', query: input };
}

// ---------------------------------------------------------------------------
// Display helper
// ---------------------------------------------------------------------------

export function formatSelectionPage({ allCandidates, visibleIndex, pageSize }) {
  const page = allCandidates.slice(visibleIndex, visibleIndex + pageSize);
  const lines = page.map((c, i) => `  [${i + 1}] ${c.name}`).join('\n');
  const total = allCandidates.length;
  const hasNext = visibleIndex + pageSize < total;
  const hasPrev = visibleIndex > 0;
  let nav = '';
  if (hasPrev && hasNext) nav = '\n  [prev] / [next] / [cancel]';
  else if (hasNext) nav = '\n  [next] / [cancel]';
  else if (hasPrev) nav = '\n  [prev] / [cancel]';
  else nav = '\n  [cancel]';
  const showing = `${visibleIndex + 1}–${Math.min(visibleIndex + pageSize, total)} of ${total}`;
  return `Which one? (${showing})\n${lines}${nav}`;
}
