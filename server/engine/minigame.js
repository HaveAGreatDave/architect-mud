// Minigame presentation fork — the ONE line every minigame call site gains.
//
// All the puzzle minigames share a payload contract, discovered when the Display
// Mode ladder was designed and worth stating plainly because it is what makes the
// text rung affordable:
//
//   server → client   { type, deviceName, skill, difficulty, resolveCmd, <idField> }
//   client → server   `<resolveCmd> <id> <0|1>`   (or a 0–100 score for synth)
//
// The game runs ENTIRELY CLIENT-SIDE once opened. The server hands over the two
// numbers that scale it and is told the outcome. So a character-drawn equivalent
// needs no new protocol at all — the same payload, a different renderer, the same
// resolve verb. This helper just stamps which renderer the player wants.
//
// Call it on the payload as you return it:
//
//   return await textRender(player, { type: 'circuit_hack', ... });
//
// A payload marked `render: 'text'` opens the character board; without the mark
// the client opens the graphical one, so a client that has never heard of this
// field behaves exactly as before.
//
// FALL BACK UP, NEVER TO NOTHING: if a family has no character renderer yet, the
// client ignores the mark and opens the graphical one. A rung with no
// implementation must never leave the player unable to act.
import { prefersTextMinigamesOrDefault, prefersLoggedPanelsOrDefault } from './presentation.js';

// ── The bottom rung resolves instead of rendering ────────────────────────────
// A character board repaints at frame rate. That is fine for `textgames`, whose
// audience WANTS text — but it is unreadable by a screen reader, which is the
// `log` rung's whole audience. Opening one there would be a dead end: a game the
// player can see is happening and cannot play.
//
// So at `log` a minigame is RESOLVED rather than drawn. One 2d8−2d8 skill check
// against the same difficulty the board would have been built from, narrated, and
// reported through the same resolve verb. The player still wins or loses on their
// skill against that target; they simply don't play it by hand.
//
// This is explicitly an INTERIM shape, and the doc says so: the designed
// non-reflex equivalents (a turn-based breach, a paced cast) replace it per family
// when someone writes them. What it guarantees today is that **no minigame is ever
// a dead end** — which is the rule the whole ladder rests on.
//
// It also covers a family that has no character board at all (splice, the cook
// game, fishing): those fall back UP to the graphical one at `textgames`, which is
// correct there, but at `log` they resolve here instead.
const RESULT_LINE = (won, name) => won
  ? `<span class="msg-system">You work the ${name} until it gives. <b>Open.</b></span>`
  : `<span class="msg-system">You work the ${name} and it holds. <span class="text-red">No good.</span></span>`;

// TWO RESULT SHAPES, because the families genuinely differ: most report a boolean
// `won`, but the synth/splice family reports a 0–100 SCORE (batch quality). A
// resolution that only produced a boolean would silently score every log-rung cook
// as zero, which is worse than not resolving at all.
//
// The score is derived from the same check's margin so the two shapes agree: a
// comfortable win is a clean batch, a squeaker is a messy one, a fail is under the
// 60 the cook game itself treats as the pass mark.
export async function resolveForLogRung(player, payload, { skill = 'hacking' } = {}) {
  const { skillCheck } = await import('./skills.js');
  const r = await skillCheck(player, skill, payload.difficulty ?? 5);
  const score = Math.max(0, Math.min(100, Math.round(50 + r.margin * 5)));
  return {
    won: r.success,
    score,
    margin: r.margin,
    line: RESULT_LINE(r.success, payload.deviceName || payload.recipeName || 'mechanism'),
  };
}

// `skill` names the check the LOG rung resolves on. It defaults to hacking
// because every family that existed when the ladder was built was an intrusion
// game. Calibrating an implant is not, so a family whose board is not about
// breaking into something must say which skill it is actually about — otherwise
// the bottom rung silently grades a different competence than the other two.
export async function textRender(player, payload, { skill = 'hacking' } = {}) {
  if (!payload) return payload;
  // The bottom rung never opens a board — see above. `render: 'resolve'` tells the
  // client to fire the resolve verb straight away with the server's own outcome,
  // so the authoritative path is unchanged: the same verb, the same arguments.
  if (await prefersLoggedPanelsOrDefault(player)) {
    const { won, score, line } = await resolveForLogRung(player, payload, { skill });
    // Both shapes ride along; the client hands both to `onResult`, and each
    // family's own callback reads whichever one it already read.
    return { ...payload, render: 'resolve', autoWon: won, autoScore: score, message: line };
  }
  return (await prefersTextMinigamesOrDefault(player))
    ? { ...payload, render: 'text' }
    : payload;
}

// ── The panel half ───────────────────────────────────────────────────────────
// Same idea one rung down, for a surface you only READ. A payload marked
// `render: 'log'` tells the client not to open its panel; the log carries it
// instead.
//
// This is only ever correct for a panel whose RECORD ALREADY REACHES THE LOG —
// the card machine's own comment states the principle it relies on: *"the overlay
// is the show, never the record, so closing it loses nothing but the
// presentation."* Suppressing a panel whose record does NOT reach the log deletes
// information rather than re-presenting it, which is strictly worse than leaving
// the panel alone. Check before you use this (docs/systems-display-mode.md: "if a
// system's record doesn't reach the log, the log rung isn't done for it").
export async function logRender(player, payload) {
  if (!payload) return payload;
  return (await prefersLoggedPanelsOrDefault(player))
    ? { ...payload, render: 'log' }
    : payload;
}
