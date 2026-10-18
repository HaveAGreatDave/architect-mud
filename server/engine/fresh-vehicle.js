// THE VEHICLE YOU HAVE JUST BOUGHT OR HIRED, for the depot's next push.
//
// A purchase at a depot used to end on the dealer's screen (or, at the marina, in a conversation
// with the clerk), and the way into the new vehicle was a card on another screen or a verb in the
// log. The depot shell answers a purchase with one key that seats you (depot-shell.js `readyHtml`),
// and this is how the counter knows which vehicle that key is for.
//
// The buy and hire verbs note the new row's id here; the depot's panel builder takes it and sends
// it as `fresh`. It is a note rather than an argument because the push does not always follow the
// verb directly: the hangar re-asks with a `hangar` a moment later, and the marina clerk's sale is
// a dialogue action whose push goes out from the action.
//
// ⚠ RAM ONLY, AND IT GOES STALE. A purchase on the log rung pushes no counter, so the note is never
// taken; without the TTL it would surface on the next counter, an hour later, for a boat bought
// in text.

const fresh = new Map();   // playerId → { id, at }
const TTL_MS = 60_000;

/** Say that `vehicleId` is the vehicle this player has just bought or hired. */
export function noteFreshVehicle(playerId, vehicleId) {
  if (playerId && vehicleId) fresh.set(playerId, { id: vehicleId, at: Date.now() });
}

/** The vehicle this player has just bought or hired, or null. Taking it clears it. */
export function takeFreshVehicle(playerId) {
  const f = fresh.get(playerId);
  if (!f) return null;
  fresh.delete(playerId);
  return Date.now() - f.at < TTL_MS ? f.id : null;
}
