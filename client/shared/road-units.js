// Tiles into kilometres: the one conversion the road is measured with.
//
// ── WHY THIS IS IN client/shared RATHER THAN IN corridor.js ──────────────────
//
// It started in plugins/trucking/corridor.js under a comment saying it lives there "and nowhere
// else", for exactly the right reason: a sign on the verge, the `route` verb and the GPS screen
// all answer the same question, and the one failure that matters is a board saying 240 while the
// dash says 720, at which point a driver can't budget a tank against either of them.
//
// The comment was right and the LOCATION was not, because one of those three surfaces is drawn in
// the browser. `legLeft` on the dash strip has to be re-derived every frame from the cab's own
// live `s` (a value shipped from the server would only step four times a second, and a distance
// readout that ticks is a distance readout nobody trusts), so the client genuinely needs the
// number rather than the answer. A server plugin file can't be imported into a panel, so the
// panel did what panels do when a constant is out of reach: it made one up. `/12` sat on that
// dash for months printing a quarter of the truth, and it looked plausible the whole time.
//
// So the conversion lives where both halves can reach it, and corridor.js re-exports it, so every
// server-side importer is untouched and there's still one definition.
//
// ── KILOMETRES, ON THE RULER ────────────────────────────────────────────────
//
// Roads read km (docs/proposals/world-scale.md, Decided). The corridor's measure is unchanged:
// three tiles to the mile, so a 90-tile void room is 48 km of real road. It's PACE.corridor in
// world-scale.js now, not a number of its own here.
import { tripM, kmOf } from './world-scale.js';

// A corridor distance in tiles, as whole kilometres for a board, a call or a route row.
// ⚠ FLOORED AT 1, deliberately. A sign reading "0" is a sign that has stopped being a sign;
// anything close enough to round to zero is close enough to call one kilometre and let the driver
// see it out of the windscreen.
export const roadKm = (tiles) => kmOf(tripM('corridor', tiles));

// What a truck burns on the road: its tank in litres over its range. The range is the tuned number
// (`tank` in flight-model.js, in tiles); this is the same fact in the unit on the dealer's card.
export const litresPerKm = (t) => t.tankL / (tripM('corridor', t.tank) / 1000);
