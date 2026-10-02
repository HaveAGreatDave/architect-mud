// Guest characters: a `players` row with role 'guest', made without a username,
// password or email (server/index.js `auth_guest`). They play the same game, but
// can't move value to another player or leave public text that outlives them,
// because a guest costs nothing to make and an unclaimed one is deleted
// GUEST_TTL_DAYS after it was last seen (plugins/guest). `register` turns one into a
// full account and lifts all of this.
//
// The verb gate is read at dispatch (commands/index.js), so a plugin verb is
// covered without touching the plugin. A verb shared with harmless uses (a
// gametable `join`) is gated in its own handler with isGuest() instead.

export const GUEST_ROLE = 'guest';
export const GUEST_TTL_DAYS = 7;

export function isGuest(player) {
  return player?.role === GUEST_ROLE;
}

// Verb -> what the refusal names. Value out of the account, or text that stays
// up after the guest has gone.
export const GUEST_DENIED_VERBS = new Map([
  ['give', 'hand things over'],
  ['pay', 'pay anyone'],
  ['acceptpay', 'take payment'],
  ['trade', 'trade'], ['tradeoffer', 'trade'], ['tradeready', 'trade'],
  ['corp', 'join a corp'], ['org', 'join a corp'], ['shakedown', 'run a racket'],
  ['buyshop', 'own a shop'], ['stock', 'sell from a shop'], ['buyware', 'buy from a player shop'],
  ['buyorder', 'post buy orders'], ['supply', 'fill buy orders'],
  ['bounty', 'post bounties'], ['redeem', 'collect bounties'],
  ['wager', 'bet against players'], ['takewager', 'bet against players'],
  ['rent', 'rent a room'],
  ['tag', 'tag walls'], ['spraycan', 'tag walls'], ['sprayapply', 'tag walls'],
  ['spread', 'spread rumours'], ['rumor', 'spread rumours'],
  ['mint', 'mint cards'], ['mintquote', 'mint cards'],
  ['pirate', 'hijack a broadcast'],
]);

export function guestRefusal(what) {
  return {
    type: 'error',
    message: `Guests can't ${what}. Type <b>register</b> to make this character permanent.`,
  };
}

// The dispatch check: a refusal for a guest typing a denied verb, else null.
export function guestVerbGate(player, cmd) {
  if (!isGuest(player)) return null;
  const what = GUEST_DENIED_VERBS.get(cmd);
  return what ? guestRefusal(what) : null;
}
