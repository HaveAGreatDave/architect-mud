// THE LONG HAUL — the bunk.
//
// The two big rigs have been DRAWN with a sleeper since the mesh was written (`sleeper` in
// TRUCK_SHAPES, the raised box behind the cab on a Drayman and an Orlov) and it has never been
// anything. This makes it a bed.
//
// It is deliberately a small file, because the whole design is "reuse the sleep system":
//
//  1. NOTHING HERE IMPLEMENTS SLEEPING. The engine already owns rest, restore rates, the alarm the
//     tablet sets, the dreamscape, the vulnerable body left lying in the room, and waking on any
//     command. A bunk is a new ANSWER to "can I sleep here", not a second way to sleep — so it
//     arrives through `registerShelterProvider` and every one of those behaviours comes free.
//
//  2. IT IS THE TRUCK THAT DECIDES, and it decides by being the truck it is. A Barrow and a Courier
//     are day cabs: their mesh has no sleeper on it and neither does their answer here. Nobody had
//     to author a "has_bunk" field — the shape table already says which trucks have one, and a
//     second place saying the same thing is a second place to get it wrong.
//
//  3. YOU CANNOT SLEEP AT SIXTY. Stopped, and stopped means stopped — the same threshold the
//     hijack door uses, from the same constant, because they are the same question about the same
//     truck and a driver should never find that one of them agrees and the other does not.
//
// AND THE THING THAT MAKES IT A DECISION RATHER THAN A FREE HOTEL: a stopped cab is exactly what a
// hijacker works. The safe box is only safe while you are awake enough to drive out of it. Where
// you choose to stop for the night is the whole play here, and it is why the restore rate is the
// SAFE-ZONE one rather than the home one — a bunk is somewhere you get through the night, not
// somewhere you rest properly.

import { registerShelterProvider } from '../../server/engine/apartments.js';
import { rigOf } from './state.js';
import { STOPPED_MPH } from './hijack.js';
import { TYPES } from '../../client/game/js/panels/flight-model.js';

// Which trucks have a bunk, derived from the one place that already knows: the tier. The two
// long-haul rigs (Drayman, Orlov) are drawn with a sleeper box; the two day cabs are not.
// ⚠ Keyed on `tier` rather than on the id list, so a fifth truck slotted into the ladder inherits
// the right answer instead of silently having no bed.
export const hasBunk = (typeId) => (TYPES[typeId]?.tier ?? 0) >= 2;

// The one line of restore this file has an opinion about, and it is a deliberate downgrade from a
// bed: you sleep in your clothes, sitting up half the night, with the engine ticking as it cools.
const BUNK_RESTORE = { hp: 0.06, sanity: 0.04, stamina: 0.30 };

registerShelterProvider((player) => {
  const rig = rigOf(player);
  if (!rig) return null;
  if (!hasBunk(rig.typeId)) return null;
  if (Math.abs(rig.speed || 0) > STOPPED_MPH) return null;
  return { canSleep: true, restore: BUNK_RESTORE, reason: 'bunk' };
});

// Why the verb refused, when it refused for a reason this file owns. The engine's own "it's not
// safe enough to sleep here" is the right answer for a day cab parked in the waste — but it is the
// WRONG answer for a driver in an Orlov doing forty, and a system that cannot tell you which of
// those you are is a system you argue with. Read by cmdDrive's own sleep hint.
export function bunkRefusal(rig) {
  if (!rig) return null;
  if (!hasBunk(rig.typeId)) return "There's no bunk in this cab. It's a day truck, and this is a day truck seat.";
  if (Math.abs(rig.speed || 0) > STOPPED_MPH) return "Not while it's rolling.";
  return null;
}
