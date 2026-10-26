// DEADBALL · THE PARK'S CLOCK. How long the 3-D park takes over a plate appearance, as plain numbers
// the server can size its lines by without loading the park.
//
// The booth's line for a play is held until the park lands it (gameday-grandstand.js), so the next
// line the booth speaks has to wait for the landing, and the next payload has to wait for what the
// park does after it: a home run's trot, a replay. Everything here is a pure function of the payload
// and imports nothing, so plugins/broadcast can import it as cheaply as the director does
// (diamond/director.js re-exports all of it).
//
//   budgetOf(p)   the seconds the director gives the pitches and the play, from the payload to the
//                 landing. A long at-bat on a short hold leaves pitches out to fit; a play that
//                 needs more than the budget runs over it (see landBy).
//   landBy(p)     the most seconds from the payload to the landing: the budget, or the last pitch
//                 and the play where those need more. The booth's next line belongs after it.
//   playRoom(p)   the most seconds from the bat meeting the ball to the landing, by what came of it.
//   afterLand(p)  the seconds the park wants after the landing for what follows the play before the
//                 next payload: a home run's trot round the bags, the welcome at the plate and its
//                 replay; another big play's replay; the field walking back. A shorter gap cuts it
//                 short (the replay goes first), never the play.
//
// The numbers are measured off staged games (scripts/shapes/diamond-smoke.mjs checks that no
// landing comes later than landBy says, and that a home run's batter is home within afterLand).

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const holdS = (p) => (Number.isFinite(p?.hold) ? p.hold / 1000 : 0);

// The budget: `share` of the payload's hold, between `min` and `max` seconds. A typical four to six
// pitch at-bat staged in full (the throw back, the set, a look over at a runner, a batter stepping
// out for a practice swing) takes 25 to 34 seconds; under the budget the director leaves the
// rituals out first and then pitches out of the middle.
export const BUDGET = Object.freeze({ share: 0.6, min: 13, max: 34 });
export const budgetOf = (p) => clamp(BUDGET.share * holdS(p), BUDGET.min, BUDGET.max);

// The most a ball in play takes from the bat to the landing (s), by kind: the ball fielded or down
// and every man on his bag. A home run lands as it comes down in the seats (the trot comes after).
// A strikeout, a walk or a hit batsman lands on the call, well inside `LAST_PITCH`.
export const PLAY_ROOM = Object.freeze({
  homerun: 5.5, triple: 13, double: 13, single: 9, error: 10, fielderschoice: 8, sacfly: 11,
  groundout: 6.5, productout: 6, doubleplay: 7, tripleplay: 9, flyout: 7.5, popout: 8, other: 10,
});
// The last pitch from its cut in to the bat or the call, at its quickest (s).
export const LAST_PITCH = 3.5;
const IN_PLAY = new Set(Object.keys(PLAY_ROOM));
export const playRoom = (p) => (p?.kind && IN_PLAY.has(p.kind) ? PLAY_ROOM[p.kind] : p?.kind === 'strikeout' || p?.kind === 'walk' || p?.kind === 'hitbypitch' ? 2.5 : PLAY_ROOM.other);
export const landBy = (p) => Math.max(budgetOf(p), LAST_PITCH + playRoom(p));

// After the landing (s). A home run: the batter round the bags at a trot (`trot`, from the ball
// coming down to his foot on the plate), the welcome there (`welcome`), its replay (`replay`, which
// is REPLAY.span played at REPLAY.rate in diamond/replay.js, and a beat either side) and the field
// back (`reset`). A play that earns a replay (a walk-off, a double or triple play, a great catch, a
// triple, a close call at first): `replay` and `reset`. Anything else: `reset`, the field walking
// back and the pitcher rubbing up the ball.
export const AFTER = Object.freeze({ trot: 21.5, welcome: 3.5, replay: 10, reset: 10 });
export function afterLand(p) {
  if (!p || p.phase === 'half') return 0;
  if (p.kind === 'homerun') return AFTER.trot + AFTER.welcome + AFTER.replay + AFTER.reset;
  const big = p.walkoff || p.kind === 'triple' || p.kind === 'doubleplay' || p.kind === 'tripleplay'
    || ['diving', 'sliding', 'leaping', 'rail'].includes(p.play?.g);
  return (big ? AFTER.replay : 0) + AFTER.reset;
}
