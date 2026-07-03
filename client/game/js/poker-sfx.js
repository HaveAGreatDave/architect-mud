// Poker table sound effects. The server (plugins/gametable) decides *when* a
// sound plays and pushes a `poker_sfx` cue over the WS; this module maps the
// short cue name to a catalog id, resolves the (possibly dev-overridden) synth
// def from window.SFXCatalog (client/shared/sfx-catalog.js), and renders it
// through window.AudioEngine — no samples, same synth path as the minigames.
//
// The cue defs themselves live in the shared SFX catalog so they show up in the
// dev panel's Sounds tab (Interface / Game SFX) and can be tuned there; this
// module only owns *when* and *how loud* they play on the client.

// Keep the table sounds gentle — they fire often and should sit under speech and
// music, never jump out. This scales every cue's synth gain on the shared SFX bus.
const POKER_SFX_GAIN = 0.55;

// The server can occasionally deliver the same cue twice in quick succession
// (overlapping broadcast recipients, a rapid re-push). Swallow an identical cue
// fired within this window so it doesn't double up. Legitimate repeats of a cue
// (e.g. `deal` on each street) are seconds apart and unaffected.
const DEDUPE_MS = 120;
const _lastPlayed = {};

export function playPokerSfx(cue) {
  const def = window.SFXCatalog?.get('poker-' + cue);
  if (!def) return;
  const now = Date.now();
  if (now - (_lastPlayed[cue] || 0) < DEDUPE_MS) return;
  _lastPlayed[cue] = now;
  window.AudioEngine?.playSfx(def, POKER_SFX_GAIN);
}
