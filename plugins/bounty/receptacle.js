// THE RECEPTACLE — the head-shaped hole in a board.
//
// A board is a machine. It has a coin slot for taking a contract in and it has
// somewhere to put a head for taking one out, and both of those were already
// written into the furniture prose before any of this existed. This file is the
// half that redeeming reads.
//
// ── Two rules ─────────────────────────────────────────────────────────────────
//
// 1. THE PROSE IS AUTHORED, NOT SWITCHED ON A ZONE ID.
//    Every line is `flags.receptacle` on the furniture row, so a new board is a
//    content file and never an edit here. A board with nothing authored still
//    works — GENERIC below is a complete set, and it is deliberately plain
//    rather than colourful, because a board whose flavour nobody has written yet
//    should read as a machine doing its job and not as somebody else's bar.
//
// 2. THE HEAD GOES IN A THING, AND THE THING IS NAMED EVERYWHERE.
//    `noun` reaches the refusal, the acceptance, the room and the board's own
//    description, so the Grind House's hatch is a hatch in all four places. That
//    is the whole reason it is one field and not four sentences that agree by
//    hand.
//
// Tokens: {noun} {handle} {amount} — substituted by `line()`. Anything else is
// left alone, because a typo'd token that silently vanished would read as prose
// somebody wrote badly.

const GENERIC = {
  noun: 'the receptacle',
  // Said when you have nothing to hand in.
  empty: `A contract pays on delivery, and delivery means the head, in your hands, at {noun}.`,
  // Said to you as the machine takes it.
  accept: `You put it in {noun}. Something inside takes hold of it and gets on with the arithmetic.`,
  // Said to the room.
  room: `{handle} puts something into {noun}, and the board counts out {amount} without asking a single question about it.`,
  // Said when the power is out.
  dark: `{noun} is dead. No power to it, and nothing inside is going to weigh anything today.`,
  // Said when the power is out and you are trying to POST rather than collect.
  darkPost: `The printer is dead. No power, no sheet, and a contract nobody can read isn't a contract.`,
};

// Read the authored half off a furniture row. Anything absent falls back, so a
// board can author one line and inherit the rest.
export function receptacleOf(board) {
  const authored = board?.flags?.receptacle;
  if (!authored || typeof authored !== 'object') return GENERIC;
  const out = { ...GENERIC };
  for (const k of Object.keys(GENERIC)) {
    const v = authored[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

// Substitute the tokens. `noun` resolves first so the other lines can carry it.
export function line(rec, key, vars = {}) {
  const src = rec?.[key] ?? GENERIC[key] ?? '';
  const all = { noun: rec?.noun ?? GENERIC.noun, ...vars };
  return String(src).replace(/\{(\w+)\}/g, (m, k) => (k in all ? String(all[k]) : m));
}

export { GENERIC };
