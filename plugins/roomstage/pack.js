// THE PACK: ROOM's own inventory, with a paper doll of you (client panels/room-pack.js draws it).
//
// `roompack` is the panel's one verb and nobody types it (scripts/docs/verbs.mjs NOT_PLAYER_TYPED). Bare, it
// answers what you carry and wear as one `room_pack` payload. With an op it changes something and answers the
// same payload with the server's line for it in `say`:
//
//   roompack wear <id> [<id> ...]   put on or wield each, in order (the doll's drag, and Dress again)
//   roompack off <id>               take it off or put it away
//   roompack drop <id> [qty]        leave it on the floor
//
// ⚠ IT DECIDES NOTHING OF ITS OWN. Wear, off and drop are cmdEquipById, cmdUnequipById and cmdDropById, the
// functions the tablet's Gear app calls (plugins/tablet/gear-app.js), so every equip gate, layer rule and refusal
// is theirs. Eating, drinking and everything else the panel offers is the ordinary typed verb, or ROOM's
// first-person ritual that ends in one (acts.js ritualOf). Going through dispatch as a verb keeps the gates a typed
// line meets (asleep, dead, jailed) in front of it too.
//
// One query for the rows and the cached carried weight, on a click; never on a tick.

import { query } from '../../server/models/db.js';
import { getItem } from '../../server/engine/items-cache.js';
import { itemVerbs, consumeVerb } from '../../server/engine/itemActions.js';
import { hasTag } from '../../server/engine/tags.js';
import { titleCaseName } from '../../server/engine/text.js';
import { conditionBand, wears } from '../../server/engine/durability.js';
import { cmdEquipById, cmdUnequipById, cmdDropById, computeCarriedWeight, carryCapacity } from '../../server/engine/commands/inventory.js';
import { lookOfPlayer } from '../../client/shared/player-figure.js';
import { wardrobeForPack, wearOutfitForPack } from '../wardrobe/index.js';
import { ritualOf, sprayOf, RITUAL_VERB } from './acts.js';

const LAYER_N = { underwear: 1, outerwear: 2, armor: 3 };
const ID_RE = /^[\w-]{1,64}$/;
const cdOf = (r) => {
  let cd = r.custom_data;
  if (typeof cd === 'string') { try { cd = JSON.parse(cd); } catch { cd = null; } }
  return cd && typeof cd === 'object' ? cd : {};
};
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// One carried row as the panel draws it.
function packRow(r, it) {
  const t = it.tags || {}, cd = cdOf(r);
  const out = {
    id: r.id, item: r.item_id,
    name: cd.name || titleCaseName(it.name),
    qty: r.quantity || 1,
    weight: Number(it.weight) || 0,
    verbs: itemVerbs({ ...r, tags: t }),
  };
  if (it.description) out.desc = short(it.description, 300);
  if (t.slot) {
    out.slot = t.slot;
    // the layer it goes on: as worn when it's on, else the tag's (the engine's own default is outerwear)
    out.layer = r.is_equipped && r.layer ? Number(r.layer) : (LAYER_N[t.layer] || (t.slot === 'weapon_hand' || t.slot === 'accessory' ? 0 : 2));
    if (Array.isArray(t.covers) && t.covers.length) out.covers = t.covers.filter((s) => typeof s === 'string');
    if (t.armor_soak && typeof t.armor_soak === 'object') {
      const soak = Object.values(t.armor_soak).reduce((a, v) => a + (Number(v) || 0), 0);
      if (soak > 0) out.soak = soak;
    }
    // what kind of thing is in the doll's hand (paper-doll.js draws a blade, a club or a gun)
    if (typeof t.weapon_skill === 'string') out.skill = t.weapon_skill;
    if (Number(t.insulation) > 0) out.warm = Math.round(Number(t.insulation) * 10) / 10;
    // how it looks worn, where the name can't say (paper-doll.js garmentOf): `col` hex, `print`
    if (t.wear_look && typeof t.wear_look === 'object') out.look = t.wear_look;
  }
  if (r.is_equipped) out.worn = true;
  if (hasTag({ tags: t }, 'consumable')) out.consume = consumeVerb({ tags: t });
  if (hasTag({ tags: t }, 'container')) out.bag = true;
  // how ROOM takes it in first person, when it can (the old Pockets list): never a sealed pack
  const how = !cd.packaged && (ritualOf(it, r.item_id) || sprayOf(it));
  if (how) out.take = { act: how.act, hold: how.hold, verb: how.verb || RITUAL_VERB[how.act] };
  if (wears({ tags: t }) && Number(r.condition ?? 1) < 0.9999) {
    const b = conditionBand(r.condition);
    out.cond = { label: b.label, colour: b.colour };
  }
  return out;
}

export async function packOf(player) {
  const [{ rows }, weight] = await Promise.all([
    query(`SELECT id, item_id, quantity, condition, is_equipped, slot, layer, custom_data FROM player_inventory WHERE player_id=$1 AND container_id IS NULL`, [player.id]),
    computeCarriedWeight(player),
  ]);
  const items = [];
  for (const r of rows) {
    const it = getItem(r.item_id);
    if (it) items.push(packRow(r, it));
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return {
    type: 'room_pack', items, weight, capacity: carryCapacity(player), credits: player.credits || 0,
    // the doll is drawn from the same columns the Room Stage draws you from (client/shared/player-figure.js)
    sex: player.biological_sex === 'female' ? 'female' : 'male', look: lookOfPlayer(player), you: player.id,
  };
}

export async function cmdRoomPack(args, raw, player, broadcast) {
  const op = String(args[0] || '').toLowerCase();
  const ids = args.slice(1).filter((a) => ID_RE.test(a));
  let say = null, ok = true;
  const tell = (res) => {
    if (!res) return;
    if (res.type === 'error') ok = false;
    if (res.message) say = say ? `${say}\n${res.message}` : res.message;
  };
  if (op === 'wear') {
    if (!ids.length) return { type: 'error', message: 'Wear what?' };
    for (const id of ids.slice(0, 24)) tell(await cmdEquipById(id, player, broadcast));
  } else if (op === 'off') {
    if (!ids[0]) return { type: 'error', message: 'Take off what?' };
    tell(await cmdUnequipById(ids[0], player));
  } else if (op === 'drop') {
    if (!ids[0]) return { type: 'error', message: 'Drop what?' };
    const qty = Math.max(0, parseInt(args[2], 10) || 0);
    tell(await cmdDropById(ids[0], player, broadcast, qty));
  } else if (op === 'outfit') {
    // `roompack outfit <wardrobe> <name>`: Wear Now on a saved outfit (plugins/wardrobe orders in what's missing)
    const res = await wearOutfitForPack(player, String(args[1] || ''), args.slice(2).join(' '), broadcast);
    ok = res.ok !== false; say = res.message;
  } else if (op && op !== 'wardrobe') {
    return { type: 'error', message: `roompack: no such thing as ${short(op, 20)}.` };
  }
  // at a wardrobe (`roompack wardrobe <id>`, and every `outfit`): its saved outfits come with the pack
  const furnId = op === 'wardrobe' || op === 'outfit' ? String(args[1] || '') : null;
  const [view, wardrobe] = await Promise.all([packOf(player), furnId ? wardrobeForPack(player, furnId) : null]);
  if (wardrobe) view.wardrobe = wardrobe;
  return say ? { ...view, say, ok } : view;
}
