/**
 * Phase 2 props — the Uplink terminal, and the two rungs at the top of the
 * ladder that make climbing the favour meter worth doing.
 *
 * THE TERMINAL is the only genuinely new object. `flags.asc_rite` is what
 * plugins/ascendant/rite.js gates `ascend` on, exactly as the Purifier gates
 * `purify` on `flags.psi_purifier` — content decides where the ritual stands and
 * the plugin never names a room.
 *
 * THE CHROME. The ladder already ran the full six rungs (dermal jack at unknown,
 * up to the cortical backup at inner_circle) — what it lacked was a reason to
 * WANT the top of it, because the summit rung is a backup and a backup is
 * insurance rather than a toy. These two are the reward for the climb: one at
 * Trusted, one at Inner Circle, both licensed, both plainly better than anything
 * a back-alley shop will ever fit you. Nothing new is wired for them; `rep_gate`
 * has been read by `installAugment` all along.
 *
 * ⚠ An overclockable augment with no authored `failure_messages` FAILS the build
 * (docs/systems-augments.md) — a piece that can be pushed past spec must have a
 * voice for coming apart, or the player gets "Bionic malfunction."
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const ROOT = path.resolve(process.cwd(), 'content');
const write = (dir, obj) => {
  const file = path.join(ROOT, dir, `${obj.id}.json`);
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, canonicalJson(obj), 'utf8');
  console.log(`  ${existed ? 'updated' : 'created'} content/${dir}/${obj.id}.json`);
};

console.log('— the Uplink —');

write('furniture', {
  id: 'furn_asc_uplink_terminal',
  name: 'the Uplink terminal',
  zone_id: 'zone_asc_shrine_uplink',
  object_type: 'machine',
  description: 'A single slab of dark glass set directly into the Curtain, so that the hard white light is behind it rather than on it. There is no keyboard and no seat. There are two shallow depressions at hand height, worn smooth, and they are worn smooth from the inside of the glass as well, which takes a moment to work out and then does not stop being true.\n\nA line of text stands in the surface, unlit, the way a thing waits rather than advertises: COMMIT.',
  flags: { asc_rite: true },
  hp: null, hp_max: null,
  light_type: null, lumen_output: null,
  power_draw_kw: 4.0,
  price: 0,
});

console.log('— the top of the ladder —');

// Trusted. A visible piece, deliberately: the Ascendants want their people
// legible on the street, and the social half of "free rein over the city" only
// works if the city can see what you are.
write('augments', {
  id: 'aug_halo_collar',
  name: 'Halcyon Halo Collar',
  description: 'The chromed half-collar the Curators wear, issued rather than sold — a ring of pattern-grade sensor weave that sits behind the neck and reads the room a half-second before you do. It is not subtle and is not meant to be. On this campus it is a uniform. In Coldwater it is a statement somebody else has to decide how to take.',
  slot: 'neural',
  tier: 3,
  cost: 3400,
  rep_gate: 'trusted',
  item_id: 'item_aug_halo_collar',
  salvage_item_id: 'item_ruined_halo_collar',
  licensed: 1,
  visible: 1,
  install_difficulty: 10,
  overclock_max: 2,
  power_draw: 2.2,
  heat_rate: 0.45,
  special: null,
  soak: {},
  stat_modifiers: { stat_senses: 2, stat_cool: 1 },
  failure_messages: {
    strain: 'The collar runs hot against the back of your neck and the room arrives a half-second LATE, which is worse than not having it at all.',
    dead: 'The halo collar dulls, goes grey, and becomes a heavy ring of scrap you are wearing on your spine.',
    burnout: 'The collar browns out and the room goes flat and simultaneous, every sound arriving at once with equal weight.',
    fault: 'The collar drops half a second behind and hands you a room you were standing in a moment ago.',
  },
});

// Inner Circle. The reward for the whole climb, and priced so it reads as one.
write('augments', {
  id: 'aug_seraph_lattice',
  name: 'Seraph Lattice',
  description: 'Subdermal weave of the grade The First wears, laid in a lattice from throat to hip so the whole torso answers at once. Halcyon does not list it. There is no shelf it sits on and no price on any board — there is an account, and either it is the kind of account this goes on or it is not.',
  slot: 'torso',
  tier: 4,
  cost: 9500,
  rep_gate: 'inner_circle',
  item_id: 'item_aug_seraph_lattice',
  salvage_item_id: 'item_ruined_seraph_lattice',
  licensed: 1,
  visible: 1,
  install_difficulty: 14,
  overclock_max: 3,
  power_draw: 3.4,
  heat_rate: 0.55,
  special: null,
  soak: { kinetic: 4, energy: 3 },
  stat_modifiers: { stat_brawn: 1, stat_endurance: 2 },
  failure_messages: {
    strain: 'The lattice tightens across the ribs and forgets to let go, and for a moment breathing is something you are doing on purpose.',
    dead: 'The lattice goes slack under the skin all at once, and you feel every separate strand of it stop.',
    burnout: 'The whole torso locks rigid, throat to hip, and holds you upright in a way that has nothing to do with standing.',
    fault: 'A band of the lattice drops out across the ribs and that stripe of you stops reporting in.',
  },
});

// The hardware half. Chrome is an ORDINARY INVENTORY ITEM until it is fitted
// (docs/systems-augments.md), so every augment needs the thing you carry and the
// ruined thing a botched fitting hands back.
//
// ⚠ `installAugment` finds the hardware by `augments.item_id`, NOT by the tag —
// the `augment_hardware` tag is dev-panel/catalog metadata (client/shared/
// tagCatalog.js) and is set here for convention, not for function. `weight` is
// in grams, and `value` is the field; `price`/`item_type` are not item columns.
const hardware = (id, name, value, augId, description) => ({
  id, name, description, value,
  type: 'misc',
  weight: 240,
  flags: {},
  tags: { augment_hardware: augId },
});

const ruined = (id, name, value, description) => ({
  id, name, description, value,
  type: 'misc',
  weight: 240,
  flags: {},
  tags: { no_install: true, no_repair: true, scrap: true },
});

console.log('— the hardware —');
write('items', hardware('item_aug_halo_collar', 'a cased halo collar', 3400, 'aug_halo_collar',
  'A chromed half-collar in a fitted case, the sensor weave inside it still and grey until somebody powers it. Curator issue. The case is nicer than most furniture in the Basin.'));
write('items', ruined('item_ruined_halo_collar', 'a dulled halo collar', 90,
  'A chromed half-collar with the weave burned out of it. It still looks the part, which is the only thing anybody will ever buy it for.'));
write('items', hardware('item_aug_seraph_lattice', 'a sealed seraph lattice', 9500, 'aug_seraph_lattice',
  "A folded sheet of subdermal weave in a sterile pack, so fine it moves like fabric and weighs like water. There is no maker's mark on the pack. There is an account number."));
write('items', ruined('item_ruined_seraph_lattice', 'a dead lattice', 240,
  'A tangle of fine dead weave that will not lie flat again. Somewhere in it is a great deal of money that stopped being money.'));

console.log('done.');
