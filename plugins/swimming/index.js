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
// No player verbs — everything is automatic on movement. Boarding a boat from the
// water is the flight plugin's embark/disembark (it owns those verbs).

import { query } from '../../server/models/db.js';
import { getZone, getAllLivePlayers, zoneTerrain } from '../../server/engine/world.js';
import { effectiveSkill, skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getItem } from '../../server/engine/items-cache.js';
import { registerStatusEffect, applyEffect } from '../../server/engine/effects.js';

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

// ── Per-move cost + submersion state (fires after a committed move) ───────────
on('zone.entered', async ({ actor: player, from, opts }) => {
  if (!player || opts?.bypassEncumbrance) return;   // system/teleport move — no swim toll
  const toZone = getZone(player.current_zone);

  if (!isSwimZone(toZone)) {                          // stepped onto dry land
    if (player._submerged) {
      player._submerged = false; player._breath = null; player._hasBoat = false;
      sendToPlayer(player.id, { type: 'output', message: sys('You haul yourself out of the water, dripping and heavy.') });
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
setInterval(() => swimTick().catch(e => console.error('[swimming] tick error:', e.message)), 1000);

export const _test = { isSwimZone, isUnderwater, hasBoatItem, hasRebreather, strokeCost, treadCost, BASE_STROKE, MIN_STROKE, DIVE_EXTRA, TREAD_BASE };

console.log('[swimming] Plugin loaded.');
