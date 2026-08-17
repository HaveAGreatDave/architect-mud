/**
 * TRAFFIC SIGNALS — the phase, and nothing else.
 *
 * Shared because a traffic light is one of the few things in this game that has to look the same
 * from two completely different surfaces: the flight/cab windshield paints three lamps on a post,
 * and the text game prints a sentence about the junction. If those two ever disagree, a driver
 * reads "the signals show green" and drives at a red light, and there is nothing in either file
 * that would look wrong. So the phase lives here once and both import it.
 *
 * ⚠ THE SIGNAL IS SET DRESSING. Nothing obeys it — no verb reads it, the truck is not stopped by
 * one, and NPCs do not cross roads. It is deliberately never placed where it could be mistaken for
 * a rule: there is no stop line, no camera and no ticket. If traffic law ever becomes real, this
 * is the seam it reads; until then a light that looked enforced and was not would be worse than
 * no light at all.
 *
 * THE PHASE IS DERIVED FROM THE CLOCK. It costs nothing, needs no server state and no table: two
 * players at the same junction see the same colour because they share a wall clock and the same
 * per-junction offset, not because anybody synchronised them. Storing a phase would be a second
 * copy of something time already tells us, on every junction in the city, for as long as the
 * server runs.
 */

export const SIGNAL_CYCLE = 14000;                  // ms for a full green → amber → red → green turn
export const SIGNAL_GREEN = 0.40, SIGNAL_AMBER = 0.48;   // fractions of the cycle; the rest is red

/**
 * A stable per-junction offset in [0,1) from its world tile.
 *
 * Two jobs. It puts neighbouring junctions out of step with each other — a whole city changing in
 * unison is the single most obvious tell that a thing is faked — and it is deterministic off the
 * WORLD coordinate rather than an array index, so a junction keeps its own rhythm as the client's
 * map window recentres and as the server answers about it from anywhere.
 */
export function junctionOffset(x, y) {
  const v = (Math.round(x) + 512) * 3.71 + (Math.round(y) + 512) * 7.13;
  return v - Math.floor(v);
}

/**
 * Which lamp is lit for the arm pointing `dir` ('n'|'e'|'s'|'w') at time `now` (ms), at a junction
 * whose offset is `off`. Returns 'g' | 'a' | 'r'.
 *
 * The two axes are half a cycle apart, so a crossroads can never show green both ways — the one
 * arrangement that would read as broken to anybody who has ever stood at a road.
 */
export function signalLamp(dir, now, off = 0) {
  const axis = (dir === 'n' || dir === 's') ? 0 : 0.5;
  const t = (((now / SIGNAL_CYCLE) + off + axis) % 1 + 1) % 1;
  return t < SIGNAL_GREEN ? 'g' : t < SIGNAL_AMBER ? 'a' : 'r';
}

/** The connector letters that make a tile a junction worth signalling: a T or a crossroads. */
export function isJunction(rd) { return typeof rd === 'string' && rd.length >= 3; }

export const LAMP_WORD = { g: 'green', a: 'amber', r: 'red' };
