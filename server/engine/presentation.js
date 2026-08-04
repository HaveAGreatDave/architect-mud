// Display Mode — one ordered preference covering every system that ships a
// graphical presentation AND a written one for the same thing.
//
// THREE RUNGS. Each strips one more category of graphics:
//
//   visual    — graphics everywhere they exist. The default.
//   textgames — the GAMES come to you as text; maps, hangars, scores and other
//               readouts stay on screen.
//   log       — nothing but the scrolling log. Panels are written out instead.
//
// The middle rung is not a downgrade and must never be built as one. A text
// minigame is a live, timed, character-drawn equivalent — same clock, same
// difficulty, same win condition — the way textcockpit.js is an instrument panel
// somebody built out of a terminal rather than a worse glass cockpit.
//
// Two rungs, two audiences, and conflating them ruins both:
//   · `textgames` is for players who WANT text. A character board repainting at
//     frame rate is emphatically not screen-reader friendly, and that's fine.
//   · `log` is for players who NEED a screen reader. Append-only, paced for a
//     human, no modals. Everything they must know reaches #output.
//
// ── The two predicates ───────────────────────────────────────────────────────
// Deliberately share no words, so a call site cannot read as the wrong axis:
// there is no `prefersTextPanels`, so a typo is a crash rather than a wrong
// answer. Ask the classification question to pick one:
//
//   "If I delete this surface, is the player STUCK?"
//     yes → it's a minigame  → prefersTextMinigames
//     no  → it's a panel     → prefersLoggedPanels
//
// A composite surface (the poker felt both shows the board and is how you bet) is
// classified by its blocking half and ignores the panel rung.
//
// ── Falling back ─────────────────────────────────────────────────────────────
// A rung with no implementation falls back to the rung ABOVE it — never to
// "nothing happens". Flight already does this by accident: startTextPilot
// returning false drops the player back into the 3D sim.
//
// Read tier: player_flags, hydrated at login (engine/flags.js) — awaited, but not
// a round trip. Safe on a board/sit/look path. NEVER call one from a tick: latch
// it at an entry moment the way flight latches `player.textTravel` at boarding.
import { getFlag, setFlag } from './flags.js';

export const DISPLAY_MODE_FLAG = 'display_mode';

export const RUNGS = ['visual', 'textgames', 'log'];

// ⚠ THE MIDDLE RUNG IS NOT CALLED `text`, and that is load-bearing.
//
// Before the ladder, `display_mode='text'` meant what `log` means now: a text
// poker player got the pane handed back to the room and everything narrated, and
// a text passenger got no panel at all. If the new middle rung reused the string,
// every existing text player would be silently promoted a rung on deploy and
// start receiving panels they had turned off. So `'text'` still parses, and it
// still means the bottom rung.
const LEGACY_RUNG = { text: 'log', visual: 'visual' };

// The player's rung, or undefined if they have never chosen. `undefined` is a
// real answer and is not the same as `visual` — poker opens an old-school felt in
// text for someone who has never expressed a view, and can only do that if it can
// tell the difference. Keep the fourth state.
//
// ⚠ THE OLD PER-SYSTEM FLAGS (`flight_text_only`, `poker_text_mode`) ARE NOT READ.
// An earlier cut promoted anyone carrying one straight onto `log` — the most
// aggressive rung, which strips every panel in the game. That is far more than
// either flag ever meant: one turned off a cabin window, the other called a card
// game out loud.
//
// So such a player reads as NEVER CHOSEN and lands on `visual` — no change on
// deploy; they opt in fresh from Settings. Reading as never-chosen rather than as
// an explicit `visual` also keeps poker's `config.textTable` alive for them, so an
// old-school felt still opens called-aloud.
//
// This is a two-line omission rather than a migration because in practice nobody
// had ever touched either flag. If that were not true it would want a notice at
// login instead: silently reverting somebody's accessibility choice is the thing
// not to do.
export async function displayRung(player) {
  const v = await getFlag('player', DISPLAY_MODE_FLAG, player).catch(() => undefined);
  if (RUNGS.includes(v)) return v;
  if (LEGACY_RUNG[v]) return LEGACY_RUNG[v];
  return undefined;
}


// ── CONTEST surfaces — the ones you have to act through ──────────────────────
// true at `textgames` AND `log`; false at `visual`; undefined if never chosen.
export async function prefersTextMinigames(player) {
  const r = await displayRung(player);
  return r === undefined ? undefined : (r === 'textgames' || r === 'log');
}

// For callers with no meaningful "never chosen" behaviour: unset means visual,
// because a graphical client is what a new player gets.
export async function prefersTextMinigamesOrDefault(player) {
  return (await prefersTextMinigames(player)) === true;
}

// ── READOUT surfaces — the ones you only read ────────────────────────────────
// true ONLY at `log`. A `textgames` player keeps their maps and hangars.
export async function prefersLoggedPanels(player) {
  const r = await displayRung(player);
  return r === undefined ? undefined : r === 'log';
}

export async function prefersLoggedPanelsOrDefault(player) {
  return (await prefersLoggedPanels(player)) === true;
}

// ── Writes ───────────────────────────────────────────────────────────────────
// Setting the rung also latches it onto the live player, so anything on a hot
// path (the look renderer) can read it synchronously without an await.
export async function setDisplayRung(player, rung) {
  const r = RUNGS.includes(rung) ? rung : (LEGACY_RUNG[rung] || 'visual');
  await setFlag('player', DISPLAY_MODE_FLAG, r, player).catch(() => {});
  if (player) player.displayRung = r;
  return r;
}

// ── The pre-login seed ───────────────────────────────────────────────────────
// The auth screen carries a "Playing with a screen reader?" disclosure, because
// this preference lives in a tablet the prologue does not hand you for another
// ten minutes — and the first thing a new character gets is a ~50-second
// WORDLESS cold open. The choice rides the auth/register message and lands here,
// from finishAuth, ahead of the `player.login` emit the prologue listens on.
//
// TWO RULES, both load-bearing:
//
//  · NEVER CLOBBER. The rung is server state precisely so it follows you between
//    machines. Somebody who set `log` on their phone must not be reset by a
//    library computer whose auth screen remembers nothing, so an existing value
//    always wins and the seed is dropped on the floor.
//  · UNTOUCHED SENDS NOTHING. No radio on that disclosure is pre-checked, so an
//    untouched screen arrives here as undefined. Seeding an explicit `visual`
//    for every new account would collapse the never-chosen fourth state above —
//    the one poker's called-aloud felt reads.
//
// Returns the rung it actually applied, or undefined if it declined to.
export async function seedDisplayRungIfUnset(player, seed) {
  if (!player?.id || !RUNGS.includes(seed)) return undefined;
  if ((await displayRung(player)) !== undefined) return undefined;
  return await setDisplayRung(player, seed);
}

// Latch at login (called from finishAuth alongside the other hydrations) so the
// synchronous readers below never have to await. Undefined stays undefined.
export async function hydrateDisplayRung(player) {
  if (!player?.id) return;
  player.displayRung = await displayRung(player);
}


// SYNC readers, for the paths that genuinely cannot await — the room-look
// renderer runs on every move. They read the latch and nothing else, so a player
// whose latch never got set reads as the default rather than as wrong.
export function loggedPanelsSync(player) {
  return player?.displayRung === 'log';
}
export function textMinigamesSync(player) {
  return player?.displayRung === 'textgames' || player?.displayRung === 'log';
}

// (The one-switch API — prefersTextDisplay / setDisplayMode — is gone. It existed
// for half a day between the two-value switch and this ladder; every call site
// moved to whichever axis it actually meant, which is the point of the rename.)
