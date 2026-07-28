// Swimming plugin.
//
// Water tiles (flags.terrain === 'water', or an underwater flags.underwater tile
// below one) are passable on foot now — the engine:water gate no longer walls
// them. This plugin turns that crossing into a real swim:
//
//   • Stroking between two water tiles costs stamina, scaled by the Swimming skill
//     (Endurance+Brawn) — the stronger the swimmer, the cheaper the stroke.
//   • Treading water (staying put on a water tile) bleeds a little stamina over time.
//   • Wading in from land / hauling out onto land is free.
//   • Running out of stamina in the water → you start to DROWN (HP loss until you
//     reach land) — modelled as the `drowning` status effect so the engine's
//     per-second effect tick persists/broadcasts/kills for us (no death import).
//   • Diving `down` onto an underwater tile starts a BREATH timer; when it hits 0
//     you drown even with stamina left. Surfacing refills it.
//   • Carrying an uncontained `boat`-tagged item = you're riding, not swimming:
//     no stamina cost, no submersion (wetness/cold), no drowning. Underwater
//     tiles are always submerged — a boat doesn't help once you're under.
//
// The single signal the wetness and body-temperature systems read is the runtime
// flag `player._submerged`, owned here (set on move + refreshed each tick).
//
// No player verbs of its own — everything is automatic on movement. The ONE seam
// out of here is BOARDING. A `flags.vessel` zone is a boat sitting on the map, and it
// works like a boat should:
//
//   • Her tile is CLOSED to swimmers — that water is under her hull (move gate
//     `swimming:vessel-hull`). You stop at her waterline, not under her keel.
//   • From any tile alongside, `embark` climbs the hull: a one-off Swimming check
//     (a boat item skips it) and a bite of stamina. `disembark` goes back over the
//     side into the water beside her.
//
// Both are VESSEL_EMBARK / VESSEL_DISEMBARK actions, which the flight plugin's
// `embark`/`disembark` fall through to when there's no aircraft to board (it owns
// those verbs; see docs/plugins.md precedence). Nothing here knows what a yacht is —
// whether a given deck defends itself is the vessel's own business.

import { query } from '../../server/models/db.js';
import { getZone, getAllLivePlayers, getAllZones, zoneTerrain } from '../../server/engine/world.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { getMinimapData } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { effectiveSkill, skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getItem } from '../../server/engine/items-cache.js';
import { registerStatusEffect, applyEffect } from '../../server/engine/effects.js';
import { markWashed } from '../../server/engine/hygiene.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
// Stroke cost runs a WIDE linear band (18→4 over effective skill 0..14) so the
// Swimming skill keeps paying off instead of saturating at the floor almost at
// once — a brawny, enduring novice still starts high and trains their way down.
// effectiveSkill = avg(Endurance,Brawn) + floor(ip/100), so ~3 for a fresh char.
const BASE_STROKE   = 18;   // stamina per water→water stroke at effective skill 0
const MIN_STROKE    = 4;    // floor — even an olympian pays this per stroke
const DIVE_EXTRA    = 3;    // extra stamina to stroke DOWN into deeper water (buoyancy)
const SWIM_DIFF     = 5;    // difficulty of the per-stroke Swimming check (drives IP gain)
const TREAD_MS      = 8000; // how often treading water drains stamina (a gentle, sustainable bleed)
const TREAD_BASE    = 2;    // tread drain per TREAD_MS for an unskilled swimmer (min 1) → ~6–13 min afloat
const DROWN_HP      = 6;    // HP lost per second while drowning (~17s from struggle to dead)
const BREATH_BASE   = 30;   // seconds of breath underwater before drowning, at skill 0
const BREATH_PER    = 3;    // +seconds of breath per point of effective Swimming skill
const AMBIENCE_CHANCE = 0.05; // per-second chance of an underwater flavour line
// Climbing aboard is EASY by default and meant to be: a boat has a ladder or a swim
// platform, and the check exists to catch the swimmer who's SPENT — not to make the
// rail a puzzle. At difficulty 2 a fresh character gets up nearly every time. What
// makes you slide back down is arriving on an empty tank: below BOARD_TIRED_AT of your
// stamina the difficulty jumps, so a long cold swim out to a boat is the thing that
// leaves you clawing at the hull, not a bad roll on arrival.
const BOARD_DIFF    = 2;    // Swimming check to haul yourself over a hull (a boat item skips it)
const BOARD_TIRED_AT  = 0.3;  // below this fraction of max stamina you're climbing tired…
const BOARD_TIRED_DIFF = 5;   // …and the climb is this much harder
const BOARD_COST    = 6;    // stamina for a successful climb aboard
const BOARD_FAIL_COST = 3;  // stamina burnt failing one — you're still treading water after

const sys  = (s) => `<span class="msg-system">${s}</span>`;
const dim  = (s) => `<span class="text-dim">${s}</span>`;
const bad  = (s) => `<span class="msg-bad">${s}</span>`;

const staminaOf = (p) => p.stamina ?? (p.stamina_max ?? 100);

// A swim tile: painted water (flags.terrain), deep open water (flags.water), or an
// underwater tile hung below one (flags.underwater).
export function isSwimZone(zone) {
  return !!zone && (zoneTerrain(zone) === 'water' || !!zone.flags?.water || !!zone.flags?.underwater);
}
export function isUnderwater(zone) {
  return !!zone?.flags?.underwater;
}

// Capability items carried loose or worn (uncontained inventory), checked the same
// way the old water gate checked for a boat: a `boat` tag rides you across the
// surface dry; a `rebreather` tag feeds you air underwater (no breath timer).
async function carriedTag(playerId, tag) {
  const { rows } = await query(
    `SELECT item_id FROM player_inventory WHERE player_id=$1 AND container_id IS NULL`, [playerId]);
  return rows.some(r => getItem(r.item_id)?.tags?.[tag]);
}
const hasBoatItem   = (playerId) => carriedTag(playerId, 'boat');
const hasRebreather = (playerId) => carriedTag(playerId, 'rebreather');

async function breathMax(player) {
  const eff = await effectiveSkill(player, 'swimming');
  return BREATH_BASE + Math.max(0, eff) * BREATH_PER;
}

// Pure cost math (unit-tested): a stroke gets cheaper with skill (floored), plus a
// buoyancy surcharge when stroking DOWN into deeper water; treading is a small
// per-interval bleed that skill lessens but never zeroes.
export function strokeCost(eff, divingDown = false) {
  return Math.max(MIN_STROKE, Math.round(BASE_STROKE - Math.max(0, eff))) + (divingDown ? DIVE_EXTRA : 0);
}
export function treadCost(eff) {
  return Math.max(1, TREAD_BASE - Math.floor(Math.max(0, eff) / 5));
}

// Drowning = HP bleed. Registered here; the engine's per-second effect tick runs
// it, persists+broadcasts hp, and calls the death path at hp<=0 for us.
registerStatusEffect({
  name: 'drowning',
  label: 'Drowning',
  onTick(player) {
    player.hp = Math.max(0, (player.hp ?? 0) - DROWN_HP);
    return bad(`Water closes over your head — you're drowning! (-${DROWN_HP} HP)`);
  },
});

const UNDERWATER_AMBIENCE = [
  'Silt curls in the dim green light. Everything is muffled down here.',
  'Your own heartbeat booms in your ears. Bubbles trail up past your face.',
  'The cold presses in from every side, patient and total.',
  'Something long and pale slides away into the murk before you can focus on it.',
  'Light ripples down from the surface far above, thin and cold.',
];

function drainStamina(player, cost, messages = []) {
  const before = staminaOf(player);
  player.stamina = Math.max(0, before - cost);
  sendToPlayer(player.id, { type: 'resource_tick', messages, player_update: { stamina: player.stamina } });
  query('UPDATE players SET stamina=$1 WHERE id=$2', [player.stamina, player.id]).catch(() => {});
}

// Open water as a bath. Clears what a shower clears — blood, contamination,
// dried fluid — and resets the body clock, but NOT the laundry clock: rinsing
// clothes on your back isn't washing them. Returns true if anything came off.
async function rinseOff(player) {
  let cleaned = false;

  if (player.covered_in_blood) {
    player.covered_in_blood = 0;
    await query('UPDATE players SET covered_in_blood=0 WHERE id=$1', [player.id]).catch(() => {});
    cleaned = true;
  }
  if (Object.keys(player.clothing_contamination || {}).length) {
    player.clothing_contamination = {};
    await query(`UPDATE players SET clothing_contamination='{}'::jsonb WHERE id=$1`, [player.id]).catch(() => {});
    cleaned = true;
  }
  const ad = player.appearance_data || {};
  if (ad.ejaculate_state || ad.soiled_state) {
    ad.ejaculate_state = null;
    ad.soiled_state = null;
    player.appearance_data = ad;
    await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(ad), player.id]).catch(() => {});
    cleaned = true;
  }
  if ((player._sweat || 0) > 0) cleaned = true;

  await markWashed(player);
  return cleaned;
}

// ── Per-move cost + submersion state (fires after a committed move) ───────────
on('zone.entered', async ({ actor: player, from, opts }) => {
  if (!player || opts?.bypassEncumbrance) return;   // system/teleport move — no swim toll
  const toZone = getZone(player.current_zone);

  if (!isSwimZone(toZone)) {                          // stepped onto dry land
    if (player._submerged) {
      player._submerged = false; player._breath = null; player._hasBoat = false;
      // Going fully under is a wash, and a free one — the poor man's shower.
      // Not in water that's worse than you are: a sewer outfall or a chem-slick
      // pool leaves you dirtier, so those only cost you the swim.
      const water = getZone(from);
      const foul = !!(water?.flags?.toxic || water?.flags?.polluted || water?.flags?.sewage);
      const rinsed = foul ? false : await rinseOff(player);
      sendToPlayer(player.id, { type: 'output', message: sys(
        foul
          ? 'You haul yourself out, dripping and heavy, wearing a film of whatever that water was carrying.'
          : rinsed
            ? 'You haul yourself out, dripping and heavy — and noticeably cleaner than you went in.'
            : 'You haul yourself out of the water, dripping and heavy.') });
    }
    return;
  }

  const underwater = isUnderwater(toZone);
  player._hasBoat = underwater ? false : await hasBoatItem(player.id);
  player._hasRebreather = await hasRebreather(player.id);
  const submerged = underwater || !player._hasBoat;
  player._submerged = submerged;

  if (!submerged) {                                  // riding a boat across the surface — dry & free
    player._breath = null;
    return;
  }

  // Breath: entering an underwater tile arms it (unless a rebreather feeds you air);
  // surfacing clears it.
  if (underwater && !player._hasRebreather) { if (player._breath == null) player._breath = await breathMax(player); }
  else player._breath = null;

  const wasSwim = from && isSwimZone(getZone(from));
  if (!wasSwim) {                                    // waded/dove in from land or a deck — free
    sendToPlayer(player.id, { type: 'output', message: sys(underwater ? 'You slip beneath the surface.' : 'You wade into the water and start to swim.') });
    return;
  }

  // A stroke between two water tiles (incl. diving up/down) — costs stamina,
  // scaled by Swimming skill, and trains it.
  const eff = await effectiveSkill(player, 'swimming');
  const divingDown = underwater && !!from && !isUnderwater(getZone(from));
  drainStamina(player, strokeCost(eff, divingDown));
  const chk = await skillCheck(player, 'swimming', SWIM_DIFF);
  awardSkillUse(player.id, 'swimming', Math.max(0, chk.margin));
});

// ── Per-second tick: tread drain, breath, drowning, ambience ─────────────────
let ticking = false;
async function swimTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const player of getAllLivePlayers()) {
      if (player.sleeping) continue;
      const zone = getZone(player.current_zone);
      if (!isSwimZone(zone)) {
        if (player._submerged) { player._submerged = false; player._breath = null; }
        continue;
      }
      const underwater = isUnderwater(zone);
      const submerged = underwater || !player._hasBoat;
      player._submerged = submerged;
      if (!submerged) continue;                       // riding a boat — no swim effects

      // Breath countdown underwater — a rebreather supplies air, so it never runs out.
      if (underwater && !player._hasRebreather) {
        if (player._breath == null) player._breath = await breathMax(player);
        else player._breath -= 1;
      } else {
        player._breath = null;
      }

      const outOfAir  = underwater && !player._hasRebreather && (player._breath ?? 0) <= 0;
      const exhausted = staminaOf(player) <= 0;

      if (outOfAir || exhausted) {
        if (!player._drowning) {
          player._drowning = true;
          sendToPlayer(player.id, { type: 'output', message: bad(outOfAir ? "Your lungs are screaming — you're out of air!" : "You can't keep your head up any longer — you're going under!") });
        }
        applyEffect(player, 'drowning', 3);            // engine per-second tick bleeds HP + handles death
        continue;
      }
      player._drowning = false;

      // Treading water slowly bleeds stamina (skill lessens it, min 1).
      if (now - (player._lastTreadAt ?? 0) >= TREAD_MS) {
        player._lastTreadAt = now;
        const eff = await effectiveSkill(player, 'swimming');
        drainStamina(player, treadCost(eff));
      }

      if (underwater && Math.random() < AMBIENCE_CHANCE) {
        sendToPlayer(player.id, { type: 'output', message: dim(UNDERWATER_AMBIENCE[Math.floor(Math.random() * UNDERWATER_AMBIENCE.length)]) });
      }
    }
  } finally {
    ticking = false;
  }
}
schedule('1s', () => swimTick().catch(e => console.error('[swimming] tick error:', e.message)));

// ── Boarding a vessel from the water ─────────────────────────────────────────
// A zone flagged `vessel` is a boat sitting ON the map: it shares its tile with the
// ordinary water zone beneath it, and the two are NOT joined by an exit (they can't
// be — a vessel sails, so any link between hull and water has to be re-derived from
// her position, never authored). So boarding is a verb, not a step: tread water at
// her waterline and haul yourself up over the side.
//
// Deliberately UNGATED by whatever guest list the vessel keeps. The gangway is the
// front door and has its own bouncer (the yacht plugin's move gate); the waterline
// is the back of the boat, and swimming out to it is meant to be a real way aboard.
// A vessel that wants its deck defended should defend it with something a swimmer
// can see coming.
const isVesselZone = (zone) => !!zone?.flags?.vessel;

// A vessel OCCUPIES her tile — the water zone sharing those coordinates is underneath
// her hull, and nobody swims through a boat. So her own tile is closed (the move gate
// below turns it back), and boarding is done from the four tiles around her.
const sameTile = (a, b) =>
  a && b && a.map_id === b.map_id && (a.grid_z ?? 0) === (b.grid_z ?? 0) &&
  a.grid_x != null && a.grid_x === b.grid_x && a.grid_y === b.grid_y;

// Vessels are a handful of zones and they MOVE, so there's no coordinate index to
// keep honest — scan by position, and only on a verb or a blocked step (never on the
// ordinary move path).
function vesselAt(zone) {
  if (!zone || zone.grid_x == null) return null;
  for (const v of getAllZones()) if (isVesselZone(v) && v.id !== zone.id && sameTile(v, zone)) return v;
  return null;
}
function vesselNear(zone) {
  if (!zone || zone.grid_x == null) return null;
  for (const v of getAllZones()) {
    if (!isVesselZone(v) || v.map_id !== zone.map_id) continue;
    if ((v.grid_z ?? 0) !== (zone.grid_z ?? 0)) continue;
    const dx = Math.abs(v.grid_x - zone.grid_x), dy = Math.abs(v.grid_y - zone.grid_y);
    if (dx + dy === 1) return v;   // alongside her, at her waterline
  }
  return null;
}

// The water a swimmer drops back into: never the tile under her hull (that's inside
// the boat), always one alongside. Null keeps a boarder aboard rather than dropping
// them into a zone that doesn't exist.
function waterUnder(vessel) {
  if (!vessel || vessel.grid_x == null) return null;
  for (const z of getAllZones()) {
    if (z.id === vessel.id || z.map_id !== vessel.map_id) continue;
    if ((z.grid_z ?? 0) !== (vessel.grid_z ?? 0) || !isSwimZone(z) || isUnderwater(z)) continue;
    const dx = Math.abs(z.grid_x - vessel.grid_x), dy = Math.abs(z.grid_y - vessel.grid_y);
    if (dx + dy === 1) return z;
  }
  return null;
}

// Shared move + room render, so embark and disembark read identically to a walk.
async function moveTo(player, destId, broadcast, line) {
  await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: destId }, context: { broadcast } });
  const zone = getZone(destId);
  if (!zone) return { type: 'emote', message: line };
  return { type: 'move', message: `${line}\n${await describeZone(zone, player)}`, zone: destId, minimap: getMinimapData(destId, 8, player) };
}

// You can't swim through a hull. The water zone sharing a vessel's tile is under her
// keel, so the last stroke toward her stops at her waterline — and that's the moment
// to tell you the way up is `embark`. Generic: any `flags.vessel` zone closes its own
// tile, the Echelon included. Cheap by construction — the scan only runs on a step
// that has ALREADY resolved to a water tile, and stops at the first vessel.
registerMoveGate(({ to }) => {
  if (!isSwimZone(to) || isUnderwater(to)) return;   // her draught doesn't reach the deep tiles below
  const vessel = vesselAt(to);
  if (!vessel) return;
  return { block: true, message: `The ${vessel.name} fills the water ahead — there's no swimming under her. Come alongside and <b>embark</b> to climb aboard.` };
}, 'swimming:vessel-hull');

registerAction({
  type: 'VESSEL_EMBARK',
  handler: async ({ actor, context }) => {
    const here = getZone(actor.current_zone);
    if (!isSwimZone(here)) return null;                 // not in the water — not our verb
    if (isUnderwater(here)) return { type: 'emote', message: 'You\'d have to surface first.' };
    const vessel = vesselNear(here);
    if (!vessel) return null;                           // nothing alongside — caller falls through
    const bc = context?.broadcast;
    // Hauling your own bodyweight over a hull is the one place the Swimming skill is
    // asked for a single hard effort rather than a per-stroke toll — and it's an easy
    // one unless you swam here on fumes. Failing costs the stamina and leaves you
    // treading; it never drowns you outright, though the drain can get you there.
    const riding = await hasBoatItem(actor.id);
    const tired = staminaOf(actor) < (actor.stamina_max ?? 100) * BOARD_TIRED_AT;
    const diff = BOARD_DIFF + (tired ? BOARD_TIRED_DIFF : 0);
    const chk = riding ? null : await skillCheck(actor, 'swimming', diff);
    if (chk && !chk.success) {
      drainStamina(actor, BOARD_FAIL_COST);
      bc?.(here.id, { type: 'zone_event', message: `${actor.handle} grabs at the ${vessel.name} and slides back into the water.` }, actor.id);
      return { type: 'emote', message: bad(tired
        ? `You get a hand to the rail — and your arms simply won't do it. You slide back into the water, breathing hard.`
        : `You get a hand to the hull, miss your grip and slide back down. Try again.`) };
    }
    if (chk) awardSkillUse(actor.id, 'swimming', Math.max(0, chk.margin));
    drainStamina(actor, riding ? 0 : BOARD_COST);   // stepping off your own boat costs nothing
    bc?.(here.id, { type: 'zone_event', message: `${actor.handle} hauls themselves out of the water and over the side of the ${vessel.name}.` }, actor.id);
    bc?.(vessel.id, { type: 'zone_event', message: `${actor.handle} comes over the side, dripping.` }, actor.id);
    return moveTo(actor, vessel.id, bc, sys(`You get a grip on the hull and haul yourself up out of the water, over the side and onto the deck.`));
  },
});

registerAction({
  type: 'VESSEL_DISEMBARK',
  handler: async ({ actor, context }) => {
    const here = getZone(actor.current_zone);
    if (!isVesselZone(here)) return null;               // not on a deck — caller falls through
    const water = waterUnder(here);
    if (!water) return { type: 'emote', message: 'There\'s no water alongside to go over the side into.' };
    const bc = context?.broadcast;
    bc?.(here.id, { type: 'zone_event', message: `${actor.handle} goes over the side into the water.` }, actor.id);
    bc?.(water.id, { type: 'zone_event', message: 'Someone comes over the side of the boat and hits the water.' }, actor.id);
    return moveTo(actor, water.id, bc, sys('You swing your legs over the rail and drop into the water.'));
  },
});

export const _test = { isSwimZone, isUnderwater, hasBoatItem, hasRebreather, strokeCost, treadCost, isVesselZone, vesselAt, vesselNear, waterUnder, BASE_STROKE, MIN_STROKE, DIVE_EXTRA, TREAD_BASE };

console.log('[swimming] Plugin loaded.');
