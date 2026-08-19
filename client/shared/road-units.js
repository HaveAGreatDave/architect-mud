// Tiles into miles — the one conversion the road is measured with.
//
// ── WHY THIS IS IN client/shared RATHER THAN IN corridor.js ──────────────────
//
// It started in plugins/trucking/corridor.js under a comment saying it lives there "and nowhere
// else", for exactly the right reason: a sign on the verge, the `route` verb and the GPS screen
// all answer the same question, and the one failure that matters is a board saying 240 while the
// dash says 720 — at which point a driver cannot budget a tank against either of them.
//
// The comment was right and the LOCATION was not, because one of those three surfaces is drawn in
// the browser. `legLeft` on the dash strip has to be re-derived every frame from the cab's own
// live `s` (a value shipped from the server would only step four times a second, and a distance
// readout that ticks is a distance readout nobody trusts), so the client genuinely needs the
// number rather than the answer. A server plugin file cannot be imported into a panel, so the
// panel did what panels do when a constant is out of reach: it made one up. `/12` sat on that
// dash for months printing a quarter of the truth, and it looked plausible the whole time.
//
// So the constant moves to the one place both halves can reach — the same move `truck-livery.js`
// already made for the paint conversion, which the server imports from here for the same reason.
// corridor.js re-exports it, so every existing server-side importer is untouched and there is
// still exactly ONE definition.
//
// Three tiles to the mile is unchanged: it puts a 90-tile void room at 30 miles, which is the
// scale the prose in this plugin has always used for a haul.
export const TILES_PER_MILE = 3;

// ⚠ FLOORED AT 1, deliberately. A sign reading "0 MILES" is a sign that has stopped being a sign;
// anything close enough to round to zero is close enough to call one mile and let the driver see
// it out of the windscreen.
export const milesOf = (tiles) => Math.max(1, Math.round(tiles / TILES_PER_MILE));
