// Equip gate chain — the veto seam for EQUIP/UNEQUIP.
//
// The sibling of movement-gates.js, and deliberately the same shape: gates run
// in registration order before any part of an equip mutates state, and the first
// { block: true } wins and its message is returned to the player.
//
// ── Why this exists ──────────────────────────────────────────────────────────
//
// Before 2026-08 there were exactly three ways to be refused a garment — a stat
// `requires` you didn't meet, a missing slot, and an invalid row — and all three
// were inline `if`s in equipResolved. Nothing outside that function could say
// no. That was fine while the only question was "are you strong enough", and
// stops being fine the moment a BODY can be the reason: a hand with claws does
// not go into a glove, and the glove is not the thing that knows it.
//
// The alternative would have been mutation data on every clothing item, which is
// the duplicate-authoring trap docs/tags.md exists to prevent — 400 garments
// each carrying a list of what they don't fit.
//
// gate({ player, item, row, slot, layer, action }) → { block, message } | undefined
//   item    — the item definition (tags), or null when only the row is known
//   row     — the player_inventory row being equipped
//   slot    — the resolved equip slot
//   layer   — the resolved layer index
//   action  — 'equip' | 'unequip'
//
// ── Phase 1 registers NOTHING ────────────────────────────────────────────────
//
// The seam ships empty on purpose. `getClothingConflicts` (engine/mutations.js)
// reports what a body cannot wear, and Phase 1 surfaces that as a warning on
// examine and gear rather than a refusal — so the chain is proven by the regress
// suite without changing a single player's ability to get dressed. Turning it
// into an actual refusal later is one registerEquipGate call in the mutations
// plugin and no change to this file or to inventory.js.

const gates = [];

export function registerEquipGate(gate, owner = 'plugin') {
  if (typeof gate !== 'function') throw new Error('registerEquipGate: gate function required');
  gates.push({ gate, owner });
}

// Returns the first blocking result, or null if every gate passes. A gate that
// throws is skipped (logged) — an erroring gate must not leave a player unable
// to put their coat on.
export async function runEquipGates(ctx) {
  for (const { gate, owner } of gates) {
    try {
      const r = await gate(ctx);
      if (r?.block) return r;
    } catch (e) {
      console.error(`[equipGate:${owner}] error: ${e.message}`);
    }
  }
  return null;
}

export function getRegisteredEquipGates() { return gates.map(g => g.owner); }
