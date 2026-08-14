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
  // Exact instance-id match — clicking a specific enemy link sends its unique
  // instanceId, which lets the player target the second of two same-named enemies
  // (name-based scoring alone can only ever reach the FATE default).
  const q = query.trim();
  const byId = candidates.find(c => String(c.instanceId) === q);
  if (byId) return { type: 'auto_target', candidate: byId, score: 100 };
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

// A query wrapped in matching quotes ("foo" or 'foo') is a literal exact-match
// request: the player is disambiguating explicitly, so skip fuzzy scoring and
// only accept a candidate whose name equals the quoted text (case-insensitive).
// Returns the unquoted inner string, or null if the query isn't quoted.
function unquote(query) {
  const q = String(query).trim();
  if (q.length >= 2 && ((q[0] === '"' && q.at(-1) === '"') || (q[0] === "'" && q.at(-1) === "'")))
    return q.slice(1, -1).trim();
  return null;
}

// Ambiguity threshold: gap < 8 (equivalent to 0.08 on a 0–1 scale).
export function resolve(query, candidates, context = {}) {
  if (!candidates.length) return { type: 'none' };
  const literal = unquote(query);
  if (literal !== null) {
    const target = literal.toLowerCase();
    const exact = candidates.find(c => c.name.toLowerCase() === target);
    return exact ? { type: 'match', candidate: exact, score: 100 } : { type: 'none' };
  }
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
  const literal = unquote(query);
  if (literal !== null) {
    const target = literal.toLowerCase();
    return candidates.filter(c => c.name.toLowerCase() === target);
  }
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

// THE PICKER IS A DECISION, AND A DECISION DOES NOT BELONG IN SCROLLBACK.
//
// Sixty-eight call sites open a SIFT picker, and every one of them does the same
// two things: createSelectionState(), then return the text of formatSelectionPage()
// as an ordinary `output`. That text is a numbered list with an implicit modal
// state behind it — the next thing you type means something different than it did
// a second ago — and in the log it is indistinguishable from any other line. It
// scrolls away. Nothing announces it. There is no control to focus.
//
// Rather than edit sixty-eight sites, the state records a PENDING PAYLOAD whenever
// it is created or paged, and the socket send in server/index.js takes it and
// staples it to whatever reply was already going out. One site, and it cannot
// drift — the same argument as stampToLog next to it.
//
// The text is unchanged and still reaches the log at every rung. This is additive:
// the record stays, the decision gets a control.
const pendingPayload = new Map();

export function getSelectionState(playerId) {
  return selectionState.get(playerId) ?? null;
}

export function clearSelectionState(playerId) {
  selectionState.delete(playerId);
}

/**
 * The structured twin of formatSelectionPage — same page, same numbering, no markup.
 * `commands` are the literal strings a player could have typed, so the dialog holds
 * no logic of its own (the workspace-HUD rule).
 */
export function selectionPayload(state) {
  const { allCandidates, visibleIndex, pageSize, context } = state;
  const page = allCandidates.slice(visibleIndex, visibleIndex + pageSize);
  return {
    verb: context?.verb || null,
    total: allCandidates.length,
    from: visibleIndex + 1,
    to: Math.min(visibleIndex + pageSize, allCandidates.length),
    options: page.map((c, i) => ({ n: i + 1, label: c.name, command: String(i + 1) })),
    hasPrev: visibleIndex > 0,
    hasNext: visibleIndex + pageSize < allCandidates.length,
  };
}

// Marks the player's current page as needing to be sent as a dialog. Called on
// open and on every page turn; consumed once, by the socket send.
function markPending(playerId) {
  const st = selectionState.get(playerId);
  if (st) pendingPayload.set(playerId, selectionPayload(st));
}

export function takePendingSelection(playerId) {
  const p = pendingPayload.get(playerId);
  pendingPayload.delete(playerId);
  return p ?? null;
}

// The picker is over — tell the client to close whatever it opened. Distinct from
// "nothing pending", because a dialog that is already up has to be dismissed.
export function markSelectionClosed(playerId) {
  pendingPayload.set(playerId, { close: true });
}

export function createSelectionState(playerId, allCandidates, context) {
  selectionState.set(playerId, {
    allCandidates,
    visibleIndex: 0,
    pageSize: PAGE_SIZE,
    context,  // { verb, dispatchType?, dispatchParam? }
    expiresAt: Date.now() + TTL,
  });
  markPending(playerId);
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
    // Sixty seconds passed with the dialog up. The state behind it is gone, so
    // the dialog has to go too or the next number typed into it does nothing.
    if (state) markSelectionClosed(playerId);
    selectionState.delete(playerId);
    return null;
  }
  const t = input.trim().toLowerCase();
  // Every exit from the picker marks it closed, and every page turn re-marks it.
  // A branch that forgets leaves the dialog on screen with nothing behind it.
  if (t === 'cancel' || t === 'exit') {
    clearSelectionState(playerId);
    markSelectionClosed(playerId);
    return { type: 'cancel' };
  }
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= PAGE_SIZE) {
    const idx = state.visibleIndex + (n - 1);
    if (idx < state.allCandidates.length) {
      const candidate = state.allCandidates[idx];
      clearSelectionState(playerId);
      markSelectionClosed(playerId);
      return { type: 'selected', candidate };
    }
  }
  if (t === 'next') {
    state.visibleIndex = Math.min(state.visibleIndex + PAGE_SIZE, state.allCandidates.length - 1);
    markPending(playerId);
    return { type: 'page', state };
  }
  if (t === 'prev') {
    state.visibleIndex = Math.max(0, state.visibleIndex - PAGE_SIZE);
    markPending(playerId);
    return { type: 'page', state };
  }
  // Anything else: refinement query — clear state and re-process as fresh input.
  // The refinement may open a fresh picker of its own, which will mark itself
  // pending and overwrite this close — correct in both directions.
  clearSelectionState(playerId);
  markSelectionClosed(playerId);
  return { type: 'refine', query: input };
}

// ---------------------------------------------------------------------------
// Display helper
// ---------------------------------------------------------------------------

function siftLink(cmd, label) {
  return `<span class="action-link" data-raw-cmd="${cmd}" title="${cmd}">${label}</span>`;
}

export function formatSelectionPage({ allCandidates, visibleIndex, pageSize }) {
  const page = allCandidates.slice(visibleIndex, visibleIndex + pageSize);
  const lines = page.map((c, i) => `  ${siftLink(String(i + 1), `[${i + 1}] ${c.name}`)}`).join('\n');
  const total = allCandidates.length;
  const hasNext = visibleIndex + pageSize < total;
  const hasPrev = visibleIndex > 0;
  const navParts = [];
  if (hasPrev) navParts.push(siftLink('prev', '[prev]'));
  if (hasNext) navParts.push(siftLink('next', '[next]'));
  navParts.push(siftLink('cancel', '[cancel]'));
  const nav = `\n  ${navParts.join(' / ')}`;
  const showing = `${visibleIndex + 1}–${Math.min(visibleIndex + pageSize, total)} of ${total}`;
  return `Which one? (${showing})\n${lines}${nav}`;
}
