// pets plugin regression suite: run by tests/regress.js, never loaded in production.
//
// What has to hold: every pet row loads and points at an NPC that exists, is flagged as that pet and as an animal; the
// Room Stage draws a pet as a cat and never also as a person; and nothing is special to any one cat.
import { _test as pets } from './index.js';
import { _test as stage } from '../roomstage/index.js';
import { world } from '../../server/engine/world.js';
import { catLook } from '../../client/game/js/panels/gl/cat-kit.js';

export default async function regress({ check }) {
  const { PETS, petOfNpc, npcBeast } = pets;
  check('pets: the table loads', PETS.size >= 1, `${PETS.size} rows`);

  for (const p of PETS.values()) {
    const npc = world.npcs.get(p.npcId);
    check(`pets: ${p.id} has its NPC`, !!npc, p.npcId);
    if (!npc) continue;
    check(`pets: ${p.id}'s NPC names it in flags.pet`, npc.flags?.pet === p.id, String(npc.flags?.pet));
    check(`pets: ${p.id}'s NPC is an animal`, npc.flags?.animal === true);
    check(`pets: ${p.id} resolves from its NPC`, petOfNpc(npc) === p);
    let ok = true;
    try { catLook(JSON.parse(JSON.stringify(p.look))); } catch { ok = false; }
    check(`pets: ${p.id}'s look is a cat the kit can build`, p.species !== 'cat' || ok);

    // the stage: in its home it's a beast with a cat body, and never also one of the people
    const zone = npc.zone_id || npc.home_zone;
    if (!zone) continue;
    const beasts = stage.beastsIn(zone), people = stage.peopleIn(zone, []);
    const as = beasts.find((b) => b.id === npc.id);
    check(`pets: ${p.id} is drawn as a cat in ${zone}`, !!as?.cat, JSON.stringify(beasts.map((b) => b.id)));
    check(`pets: ${p.id} is not drawn as a person too`, !people.some((x) => x.id === npc.id));
  }

  // a person is never answered for, and an animal that isn't a pet isn't either
  check('pets: a person is no beast', npcBeast({ id: 'npc_nobody', name: 'Nobody', flags: {} }) === null);
  check('pets: an animal with no pet row is no beast', npcBeast({ id: 'npc_nobody', name: 'Nobody', flags: { animal: true } }) === null);
}
