// PETS (docs/proposals/pets.md): an animal that lives in somebody's home.
//
// A pet is two rows. Its NPC (npcs, flags.pet naming the pet's row) is the animal in the text world: its name, its
// description, its home, and everything the engine already does for an NPC: it's listed in the room, `look` and
// `pet` work on it, and boot puts it home. Its row in `pets` is the body and nature: the cat kit's numbers
// (client/game/js/panels/gl/cat-kit.js) and its personality. The Room Stage asks this plugin, per NPC, whether the
// NPC is an animal (`roomstage.npcBeast`); a pet answers with its body, so the stage draws a cat where it would have
// drawn a person.
//
// Nothing here knows any particular cat or owner. Scrappy is the first row and nothing more.
//
// Phase 2 so far: the table, the NPC and the cat in ROOM. Needs, carers and the verbs are next.
import { query } from '../../server/models/db.js';

// pet id → { id, npcId, species, look, personality }, and NPC id → the same
const PETS = new Map(), BY_NPC = new Map();

export async function loadPets() {
  const { rows } = await query('SELECT id, npc_id, species, look, personality FROM pets');
  PETS.clear(); BY_NPC.clear();
  for (const r of rows) {
    const p = { id: r.id, npcId: r.npc_id, species: r.species, look: r.look || {}, personality: r.personality || {} };
    PETS.set(p.id, p); BY_NPC.set(p.npcId, p);
  }
  return PETS.size;
}

/** The pet an NPC is, or null. Sync and RAM-only. */
export function petOfNpc(npc) {
  if (!npc) return null;
  return BY_NPC.get(npc.id) || (npc.flags?.pet ? PETS.get(npc.flags.pet) || null : null);
}

// The Room Stage's question: is this NPC an animal, and what's it drawn from? A cat answers with its numbers; the
// client works out where it lies and how it sits from the clock and its id, so this costs no messages.
function npcBeast(npc) {
  const p = petOfNpc(npc);
  if (!p || p.species !== 'cat') return null;
  return { id: npc.id, name: npc.name, cat: p.look, pet: p.id };
}

await loadPets().catch((e) => console.error(`[pets] failed to load: ${e.message}`));

export const hooks = {
  'roomstage.npcBeast': npcBeast,
};

export const _test = { PETS, BY_NPC, loadPets, petOfNpc, npcBeast };

console.log(`[pets] Plugin loaded (${PETS.size} pet${PETS.size === 1 ? '' : 's'}).`);
