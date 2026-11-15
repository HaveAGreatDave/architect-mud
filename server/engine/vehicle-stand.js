// THE VEHICLE STAND: one of your vehicles brought out onto a depot's floor, where you walk up to it and
// climb in (docs/reference/depot-shell.md, "Call it up").
//
// Every depot keeps its vehicles somewhere you can't walk: the garage under a truck shed, the back of a
// hangar, the wet store behind a marina's water gate, the racer bay's yard. `callup` brings one of yours
// out onto the floor of the room you're standing in, the Room Stage draws it there, and a key comes up when
// you're beside it that sends the seat's own verb (`drive <id>`, `hangaract launch <id>`, `boat take <id>`,
// `podracer take <id>`). Nothing here seats anybody.
//
// ⚠ RAM ONLY, AND A PICTURE OF WHERE THE VEHICLE ALREADY IS. A vehicle on a stand is the same row in the
// same depot; no column moves. A restart puts everything back where its row says it always was, and one
// left standing goes back on its own after half an hour.
//
// ⚠ ONE VEHICLE A ROOM. Anyone in the room sees it; only its owner can send it back or climb in.
//
// Each vehicle plugin registers its kind (`registerStandKind`) with how to tell its bays, how to list the
// player's vehicles in one (one query, on a verb, never on a move), the verb that boards one and the words
// for it. A room is a bay of a kind when its spec says so (`flags.room.stand.kind`), or when the kind's
// own `isBay` does (a truck shed is any `truck_depot` room). The Stage reads the stand through the sync
// `room.vehicles` gather, which each plugin answers with `standVehicles` for its own kind, and is told of
// a change by `room.vehiclesChanged`.
import { emit } from './events.js';
import { getZone } from './world.js';

// a vehicle left standing goes back on its own after this long
const STAND_MS = 30 * 60 * 1000;
// how long the move takes when a kind doesn't say, ms; the client plays the same clock
const MOVE_MS = 9000;

const KINDS = new Map();   // kind -> { moveMs, from, label, isBay(zone), board(id), list(player, zone), call?, busy?, words }
const stands = new Map();  // bay zone id -> { kind, id, ownerId, name, look, since, down? }
const hands = new Map();   // player id -> { bay, list: [{ id, name }] }: their vehicles in that bay, as last listed

/**
 * A kind of vehicle that can be called up. `def`:
 * - `isBay(zone)`: is this room one of yours without a `flags.room.stand` saying so (optional)
 * - `list(player, zone)`: async, this player's vehicles kept here, `[{ id, name, look }]`; `look` is what the
 *   client draws (`{ cls, variant, armed, livery }`, the card's own descriptor)
 * - `board(id)`: the verb that seats you in it
 * - `call(player, words, zone)`: optional, a kind's own `callup` (trucking's `hoist`)
 * - `busy(player)`: optional, a line if this player can't call one up now (already in a seat)
 * - `moveMs`, `from` ('below' a lift, or the wall it comes through: 'back', 'front', 'left', 'right'),
 *   `label` (the panel's title: LIFT, TUG, SLIP, DOLLY)
 * - `words`: `{ up(name), down(name), none, noun }`, what the room says
 */
export function registerStandKind(kind, def) {
  KINDS.set(kind, { moveMs: MOVE_MS, from: 'back', label: 'BAY', words: {}, ...def });
}
export const standKindDef = (kind) => KINDS.get(kind) || null;

/** The kind of vehicle this room is a bay for, or null. */
export function bayKindOf(zone) {
  if (!zone) return null;
  const s = zone.flags?.room?.stand;
  if (s && typeof s === 'object' && KINDS.has(s.kind)) return s.kind;
  for (const [k, d] of KINDS) { try { if (d.isBay?.(zone)) return k; } catch { /* a kind's own test */ } }
  return null;
}

/** What stands on this bay's floor, or null. A stand left too long goes back first. */
export function standAt(bayId) {
  const S = stands.get(bayId);
  if (S && !S.down && Date.now() - S.since > STAND_MS) lowerStand(bayId);
  return stands.get(bayId) || null;
}

/** The vehicles this player has in this bay, as last listed (by the counter or by `callup`). */
export function noteStandHand(playerId, bayId, list) {
  hands.set(playerId, { bay: bayId, list: (list || []).map((v) => ({ id: v.id, name: v.name })) });
}
export const forgetStandHand = (playerId) => hands.delete(playerId);

export function raiseStand(bayId, ownerId, v) {
  stands.set(bayId, { kind: v.kind, id: v.id, name: v.name, look: v.look || null, ownerId, since: Date.now() });
  emit('room.vehiclesChanged', { zoneId: bayId });
}

export function lowerStand(bayId) {
  const S = stands.get(bayId);
  if (!S || S.down) return;
  S.down = Date.now();
  emit('room.vehiclesChanged', { zoneId: bayId });
  const ms = KINDS.get(S.kind)?.moveMs || MOVE_MS;
  setTimeout(() => { if (stands.get(bayId) === S) { stands.delete(bayId); emit('room.vehiclesChanged', { zoneId: bayId }); } }, ms).unref?.();
}

/** Taken out (driven, flown, cast off): the floor is empty at once, nothing to watch go back. */
export function standTaken(id, kind = null) {
  for (const [bay, S] of stands) {
    if (String(S.id) === String(id) && (!kind || S.kind === kind)) { stands.delete(bay); emit('room.vehiclesChanged', { zoneId: bay }); }
  }
}

/**
 * The `room.vehicles` answer for one viewer, for one kind: what stands on the floor (with how far through
 * its move it is, as an age, so the client's clock needn't agree with ours), the viewer's own vehicles here
 * to call up, and the verbs. Undefined in a room that isn't a bay of this kind.
 */
export function standVehicles(zoneId, player, kind) {
  const zone = getZone(zoneId);
  if (!zone || bayKindOf(zone) !== kind) return undefined;
  const def = KINDS.get(kind);
  const S = standAt(zoneId), now = Date.now();
  const h = hands.get(player?.id);
  return {
    kind, moveMs: def.moveMs, hoistMs: def.moveMs, from: zone.flags?.room?.stand?.from || def.from, label: def.label,
    noun: def.words?.noun || 'vehicle', call: 'callup', back: 'callup back',
    lift: S ? { id: S.id, name: S.name, look: S.look, ...(S.look?.legacy || {}),
      mine: String(S.ownerId) === String(player?.id), board: def.board(S.id),
      age: now - S.since, ...(S.down ? { down: now - S.down } : {}) } : null,
    mine: h && h.bay === zoneId ? h.list : [],
  };
}

/**
 * One of yours is coming out onto this floor: the Room Stage opens round you if it isn't up (plugins/roomstage),
 * so a counter's Call it up leaves you stood in the room as it comes out. A kind with its own `call` says so too.
 */
export const noteCalled = (player, zoneId) => emit('vehicle.calledUp', { player, zoneId });

const say = (message) => ({ type: 'emote', message });
const dim = (s) => `<span class="text-dim">${s}</span>`;

// one of the list by what was typed: its id, its place in the list, or the start of its name
function pick(list, want) {
  if (!want) return list.length === 1 ? list[0] : null;
  const w = want.toLowerCase();
  return list.find((v) => String(v.id).toLowerCase() === w)
    || (/^\d+$/.test(w) && list[Number(w) - 1])
    || list.find((v) => String(v.name || '').toLowerCase() === w)
    || list.find((v) => String(v.name || '').toLowerCase().startsWith(w))
    || null;
}

/**
 * `callup [vehicle]` brings one of yours out onto this room's floor; `callup back` sends it away again.
 * Works typed, at every rung; the Stage's panel sends the same words.
 */
export async function callUp(player, words = []) {
  const zone = getZone(player?.current_zone);
  const kind = bayKindOf(zone);
  if (!kind) return say("There's nothing to call up here. Vehicles are brought out onto the floor of a depot: a truck shed, a hangar, a marina's covered slip, the racer bay.");
  const def = KINDS.get(kind);
  if (def.call) return def.call(player, words, zone);
  const busy = def.busy?.(player);
  if (busy) return say(busy);
  const want = words.join(' ').trim();
  const up = standAt(zone.id), noun = def.words?.noun || 'vehicle';
  if (/^(back|down|away|stow|return|lower)$/i.test(want)) {
    if (!up || up.down) return say(`There's nothing out on the floor to send back.`);
    if (String(up.ownerId) !== String(player.id)) return say(`The ${up.name} isn't yours to send back.`);
    lowerStand(zone.id);
    return say(`<span class="text-amber">${def.words?.down?.(up.name) || `The ${up.name} goes back.`}</span>`);
  }
  if (up?.down) return say(`The ${up.name} is still on its way back. Give it a moment.`);
  if (up) {
    return say(String(up.ownerId) === String(player.id)
      ? `The ${up.name} is already out. Walk up to it and climb in, or ${dim('callup back')} sends it away.`
      : `Somebody's ${up.name} is out on the floor. Wait for it to go.`);
  }
  const list = await def.list(player, zone);
  noteStandHand(player.id, zone.id, list);
  emit('room.vehiclesChanged', { zoneId: zone.id });
  if (!list.length) return say(def.words?.none || `Nothing of yours is kept here. Buy or hire one at the counter.`);
  const v = pick(list, want);
  if (!v) {
    const names = list.map((x, i) => `${i + 1}. ${x.name} ${dim('(' + x.id + ')')}`).join('\n  ');
    return say(want ? `You've no ${noun} here called "${want}". Yours here:\n  ${names}` : `Which ${noun}? ${dim('callup <name>')}\n  ${names}`);
  }
  raiseStand(zone.id, player.id, { kind, id: v.id, name: v.name, look: v.look });
  noteCalled(player, zone.id);
  return say(`<span class="text-amber">${def.words?.up?.(v.name) || `The ${v.name} is brought out onto the floor.`}</span>`);
}

export const _resetStands = () => { stands.clear(); hands.clear(); };
