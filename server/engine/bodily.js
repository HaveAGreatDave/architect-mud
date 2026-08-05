/**
 * Bodily substrate — stains and digestion loads. This is deliberately ALL that
 * remains engine-side of the bodily system: stains are written by multiple
 * systems (bodily, mis, butchering) and rendered by describe/appearance, and
 * the digestion loads are read by drugs, inventory, fillable, and water. The
 * pressure simulation and the pee/poop/flush verbs live in plugins/bodily/
 * (Phase 2, docs/proposals/engine-plugin-boundary.md).
 */
import { query } from '../models/db.js';
import { world } from './world.js';
import { setEpisodeHandler } from './effects.js';
import { sendToZone } from './messaging.js';

// How much load consuming food/drink adds. Scales with restore value. Tuned so
// that, with no passive decay, steady eating/drinking builds a genuine urge:
// bladder ~every 4h, bowel ~every 8h. Slowed 4× (2026-08-01) along with
// hunger/thirst/fatigue: eating +25 hunger now adds ~4.4 load, drinking +25
// thirst adds ~6.3, so relief is an occasional errand rather than a metronome.
// See plugins/bodily/index.js tickBodily.
export function foodLoad(restoreHunger)  { return (restoreHunger || 0) * 0.175; }
export function drinkLoad(restoreThirst) { return (restoreThirst || 0) * 0.25; }

// Apply a drink's thirst restore in-memory: bump the thirst meter (capped at 100)
// and the bladder load. Shared by item consumption (cmdUse) and furniture water
// sources so both stay in sync. Caller is responsible for persisting.
export function applyThirst(player, amount) {
  player.thirst = Math.min(100, (player.thirst || 0) + amount);
  player.hydration_load = Math.min(120, (player.hydration_load || 0) + drinkLoad(amount));
}

export async function stainClothing(player, slots, type) {
  const contamination = player.clothing_contamination || {};
  for (const slot of slots) contamination[slot] = type;
  player.clothing_contamination = contamination;
  await query('UPDATE players SET clothing_contamination=$1 WHERE id=$2',
    [JSON.stringify(contamination), player.id]);
}

// Where food poisoning actually lands. effects.js owns the timing and the
// numbers but imports nothing — the world, the stains and the broadcast are
// injected here, in the module that already owns all three.
//
// An episode is PUBLIC. It goes on your clothes, it goes on the floor, and
// everyone in the room sees it happen. That's the whole point: the HP cost is
// trivial, the humiliation is the mechanic.
setEpisodeHandler(async (player, type) => {
  const slots = type === 'vomit' ? ['torso', 'hands'] : ['legs', 'feet'];
  await stainClothing(player, slots, type).catch(() => {});
  stainZone(player.current_zone, type);
  sendToZone(player.current_zone, {
    type: 'zone_event',
    message: type === 'vomit'
      ? `${player.handle} is violently sick.`
      : `${player.handle} soils themselves. Nobody can pretend not to notice.`,
  }, player.id);
});

export function stainZone(zoneId, type) {
  const zone = world.zones.get(zoneId);
  if (!zone) return;
  zone.stains = zone.stains || {};
  zone.stains[type] = (zone.stains[type] || 0) + 1;
  // Stains are ephemeral (registry-excluded, wiped by dailyMaintenance) and read
  // live from world.zones — RAM is the source of truth, so no DB write.
}

// AIR TAINT — a smell with no stain under it.
//
// A stain is a mark on the floor: it persists until maintenance wipes it, and
// anyone who looks can see it. A fart is not that. It's an event that hangs in
// the air for a minute and then genuinely is gone, and the difference matters
// because the joke only works if leaving the room escapes it.
//
// Same storage discipline as stains — live on the zone object in RAM, never
// written to the DB, wiped with everything else by dailyMaintenance. The decay
// is derived from the timestamp at read time; nothing ticks.
export const TAINT_MS = 90 * 1000;

export function taintAir(zoneId, type, at = Date.now()) {
  const zone = world.zones.get(zoneId);
  if (!zone) return;
  zone.air = zone.air || {};
  // A second one while the first still hangs makes it worse, not newer.
  const prev = zone.air[type];
  const stacked = prev && at - prev.at < TAINT_MS ? Math.min(3, (prev.n || 1) + 1) : 1;
  zone.air[type] = { at, n: stacked };
}

// What's still hanging, strongest first. Expired entries are dropped as they're
// read, so nothing has to sweep them.
export function zoneAir(zoneId, now = Date.now()) {
  const zone = world.zones.get(zoneId);
  if (!zone?.air) return [];
  const live = [];
  for (const [type, v] of Object.entries(zone.air)) {
    if (!v?.at || now - v.at > TAINT_MS) { delete zone.air[type]; continue; }
    live.push({ type, n: v.n || 1, age: (now - v.at) / TAINT_MS });
  }
  return live.sort((a, b) => a.age - b.age);
}

// A named body part maps to whichever equip slot would actually cover it, so
// aiming at "face" or "chest" checks the same slot a hat/shirt occupies.
const PART_TO_SLOT = {
  face: 'head', hair: 'head', head: 'head', scalp: 'head',
  chest: 'torso', torso: 'torso', back: 'torso', stomach: 'torso', belly: 'torso',
  hands: 'hands', arms: 'hands', arm: 'hands',
  legs: 'legs', leg: 'legs', thighs: 'legs', groin: 'legs', crotch: 'legs',
  feet: 'feet', foot: 'feet', shoes: 'feet',
};

// Stain a specific body part on a player target: soaks the garment covering it
// if one's worn there, otherwise leaves a visible residue note on bare skin
// (rendered like ejaculate_state — see appearance.js). Always leaves a mark
// somewhere on the target, never a no-op.
export async function stainCreatureBodyPart(target, type, part) {
  const label = (part || 'body').toLowerCase();
  const slot = PART_TO_SLOT[label];
  if (slot) {
    const { rows } = await query(
      `SELECT 1 FROM player_inventory WHERE player_id=$1 AND is_equipped=1 AND slot=$2 LIMIT 1`,
      [target.id, slot]
    );
    if (rows.length) {
      await stainClothing(target, [slot], type);
      return;
    }
  }
  if (!target.appearance_data) target.appearance_data = {};
  target.appearance_data.soiled_state = { type, locations: [label] };
  await query('UPDATE players SET appearance_data=$1 WHERE id=$2',
    [JSON.stringify(target.appearance_data), target.id]);
}

// ── Filling a vessel with yourself ───────────────────────────────────────────
//
// The shared path behind `pee in <bowl>`, `poop in <bowl>` and `cum in <bowl>`.
// It lives here rather than in either plugin because BOTH need it and neither
// owns the other — same reason stainClothing/stainZone are engine.
//
// The product is an ordinary ITEM placed inside the vessel, not a custom_data
// fluid, which is the whole trick: the cooking plugin already resolves a vessel's
// contents as ingredients, so filth cooks through the normal pipeline with no
// changes to cooking at all. It carries a food_profile, a food-poisoning chance,
// and (for anything that can transmit) the donor's id.
export const FILTH_ITEMS = {
  ejaculate: 'item_vessel_seed',
  urine:     'item_vessel_piss',
  feces:     'item_vessel_filth',
};

// The shared insert. `containerId` null means it lands loose in the player's
// hands rather than inside a vessel — the only difference between filling a bowl
// and scooping a toilet out by hand. Everything downstream (drop, put, stow,
// cooking) is the ordinary inventory path either way, which is the point: filth
// is an ITEM, so nothing has to learn about it.
async function spawnFilth(player, type, containerId, extra = {}) {
  const itemId = FILTH_ITEMS[type];
  if (!itemId || !player?.id) return false;
  const { randomUUID } = await import('crypto');
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id, custom_data)
     VALUES ($1,$2,$3,1,1.0,$4,$5)`,
    [randomUUID(), player.id, itemId, containerId,
     JSON.stringify({ donor_id: player.id, donor: player.handle, produced_at: Date.now(), ...extra })]
  );
  return true;
}

export async function depositIntoVessel(player, vessel, type, extra = {}) {
  if (!vessel?.inv_id) return false;
  return spawnFilth(player, type, vessel.inv_id, extra);
}

// Straight into the hands, no vessel. The donor fields are still stamped, but a
// caller who did not produce it (scooping somebody else's leavings out of a
// bowl) passes its own `extra` to say so.
export async function takeFilthInHand(player, type, extra = {}) {
  return spawnFilth(player, type, null, extra);
}

// The third stain channel, alongside stainClothing (a garment) and stainZone (a
// floor): filth on BARE SKIN, for when there was no garment to catch it.
//
// It exists because losing control with nothing on used to leave you personally
// spotless — the floor took all of it and one room later you were clean, while
// the same accident in trousers followed you around for days. Being less dressed
// meant less consequence, which is exactly backwards.
//
// Same shape stainCreatureBodyPart writes, so `soilDescription` and `hygieneOf`
// read it with no changes and `clearBodyStain` still clears it.
export async function soilBareSkin(player, type, locations) {
  if (!player?.id || !locations?.length) return false;
  if (!player.appearance_data) player.appearance_data = {};
  player.appearance_data.soiled_state = { type, locations };
  await query('UPDATE players SET appearance_data=$1 WHERE id=$2',
    [JSON.stringify(player.appearance_data), player.id]).catch(() => {});
  return true;
}

// The counterpart to stainCreatureBodyPart: get one part clean again without
// touching the rest. `soiled_state` only ever holds one entry, so clearing a part
// that matches clears the state; a stain somewhere else survives, which is what
// stops "wash hands" from being a free shower.
export async function clearBodyStain(player, part) {
  const ad = player?.appearance_data;
  const s = ad?.soiled_state;
  if (!s) return false;
  const label = (part || '').toLowerCase();
  if (label && !(s.locations || []).some(l => String(l).toLowerCase() === label)) return false;
  ad.soiled_state = null;
  player.appearance_data = ad;
  await query('UPDATE players SET appearance_data=$1 WHERE id=$2',
    [JSON.stringify(ad), player.id]).catch(() => {});
  return true;
}
