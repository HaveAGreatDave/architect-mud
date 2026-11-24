// A LOCKED DOORWAY'S LINES, for every view of a room (docs/proposals/room-hololock.md). The server says how each
// doorway's lock stands for you (`room_view.locks`, `room_locks`: { to, dir, locked, open, pass, staff, hack, yours,
// lock, shop, annex, glass }); this says what you can do about it. Pure: the Room Stage's hologram
// (panels/room-lock.js) and GLASS's card inside a building (panels/oneworld-card.js) both read it, so they can't
// offer different things at one door. Each line is a typed verb the server answers; nothing here opens a door.

// the door's name on the card
export const DOOR_WORD = { north: 'North', south: 'South', east: 'East', west: 'West', up: 'Upper', down: 'Lower', in: 'Inner', out: 'Outer' };
export const doorName = (k) => `${DOOR_WORD[k.dir] || k.dir} door`;

// What a door offers you.
//   standing open: Close.
//   shut and unlocked: Open, and Lock where it has a lock.
//   locked, and the lock knows you: Open, which unlocks it and then opens it (`then`).
//   locked otherwise: Unlock, and Hack where the lock can be hacked.
// ⚠ A DOOR IS SHUT UNTIL SOMEBODY OPENS IT. Nothing here opens one because you walked up to it: each of these is
// a verb sent to the server, and the leaves follow the door's own `open` when it comes back.
export function lockActs(k) {
  const d = `door ${k.dir}`;
  // a shop shut for the night (plugins/roomstage locksOf): nothing to press, the hours are the card
  if (k.shop) return [];
  if (k.open) return [{ verb: 'close', label: 'Close', cmd: `close ${d}` }];
  if (!k.locked) return [{ verb: 'open', label: 'Open', cmd: `open ${d}` }, ...(k.lock !== false ? [{ verb: 'lock', label: 'Lock', cmd: `lock ${d}` }] : [])];
  // staff at a lock that doesn't know them: the unlock is an override, and the card plays it as one
  if (k.staff) return [{ verb: 'unlock', label: 'Unlock', cmd: `unlock ${d}`, then: `open ${d}` }];
  if (k.pass) return [{ verb: 'unlock', label: 'Unlock', cmd: `unlock ${d}`, then: `open ${d}` }];
  return [{ verb: 'unlock', label: 'Unlock', cmd: `unlock ${d}` }, ...(k.hack && !k.yours ? [{ verb: 'hack', label: 'Hack', cmd: `hack ${d}` }] : [])];
}

// Whether walking into the doorway gets you through: a door standing open does, and a shut one that'll let you (`pass`:
// the step opens it, as in the room text); any other shut door doesn't, and a bathroom's never opens for a step. The
// Stage's `enter` (panels/room-lock.js) says the same, with its leaves.
export const lockLetsThrough = (k) => !k || !!k.glass || !!k.open || (!!k.pass && !k.annex);
