// Flight — airspace combat: ground anti-aircraft fire (the danger layer) and the
// armed-craft air-to-ground pass. AA sites fire on low/slow overflights each tick;
// flying HIGH or FAST cuts exposure, `evade` throws them off, and an armed craft
// can `strafe` a site to silence it. Air-to-air vs. other players is a lighter
// proximity duel resolved on the same tick seam.
//
// Kept deliberately thin over the existing combat feel (piloting-checked rolls,
// hull-damage ladder → breakup → crash) rather than a parallel combat engine.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import {
  liveAircraft, surfaceAt, crash, toOccupants, out, pushHud, persist, pilotOf,
  sendToZone, sendToPlayer, getZone, BANDS,
} from './state.js';

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// ── AA + air-to-air, run each airborne tick from index.flightTick ─────────────
export async function tickCombat(live) {
  const a = live.row;
  if (!a.airborne) return;
  const bandIdx = BANDS.indexOf(a.altitude_band);
  // High and fast = hard to engage; only low/cruise overflights are exposed.
  if (bandIdx >= 3) return;
  const evading = live.evadeUntil && Date.now() < live.evadeUntil;
  const pilot = pilotOf(live);

  const { rows: sites } = await query(
    `SELECT s.id, s.name, s.range, s.damage, s.accuracy, z.grid_x, z.grid_y
     FROM aa_sites s JOIN zones z ON z.id = s.zone_id WHERE s.active = 1`
  );
  for (const s of sites) {
    if (s.grid_x == null) continue;
    const reach = s.range + (bandIdx === 1 ? 0 : -1);   // cruise is a tougher shot than low
    if (cheb(a.grid_x, a.grid_y, s.grid_x, s.grid_y) > Math.max(0, reach)) continue;
    // Slow, low, loud craft are easy meat; speed + evade + altitude help.
    let hitChance = 0.5 + s.accuracy * 0.04 - (a.throttle / 100) * 0.2 - bandIdx * 0.12;
    if (evading) hitChance -= 0.3;
    // A skilled pilot instinctively jinks.
    if (pilot) { const chk = await skillCheck(pilot, 'piloting', s.accuracy); if (chk.success) hitChance -= 0.25; }
    if (Math.random() < Math.max(0.05, hitChance)) {
      a.damage = Math.min(1, a.damage + s.damage);
      toOccupants(live, `<span class="text-red">💥 ${s.name} opens up — rounds walk across the airframe. Hull ${Math.round((1 - a.damage) * 100)}%.</span>`);
      if (a.damage >= 1) { await crash(live, 'shotdown'); return; }
    } else {
      toOccupants(live, `<span class="text-amber">Tracer arcs past from ${s.name} below — a near miss.</span>`);
    }
    break;   // one emplacement engages per tick — don't stack a firing squad
  }
  if (a.damage > 0 && live.persistCtr % 2 === 0) await persist(live);
}

function requirePilot(player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { err: { type: 'emote', message: "You're not aboard an aircraft." } };
  if (player.seat !== 'pilot') return { err: { type: 'emote', message: "You're not in the pilot's seat." } };
  return { live };
}

// ── Verbs ─────────────────────────────────────────────────────────────────────
async function cmdArm(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if ((live.type.hardpoints || 0) < 1) return { type: 'emote', message: `The ${live.type.name} is a civilian airframe — no hardpoints, no guns.` };
  live.row.weapons_hot = 1; pushHud(live);
  return { type: 'emote', message: '<span class="text-red">Master arm HOT. Weapons live.</span>' };
}

async function cmdSafe(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  live.row.weapons_hot = 0; pushHud(live);
  return { type: 'emote', message: 'Master arm safe. Weapons cold.' };
}

async function cmdEvade(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'Nothing to evade on the ground.' };
  live.evadeUntil = Date.now() + 6000;
  return { type: 'emote', message: '<span class="text-cyan">You break hard and jink, throwing chaff — a harder target for the next few seconds.</span>' };
}

async function cmdStrafe(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'You strafe from the air.' };
  if (!live.row.weapons_hot) return { type: 'emote', message: 'Weapons are cold — `arm` first.' };
  if (live.row.altitude_band !== 'low') return { type: 'emote', message: 'Come down to LOW for a gun pass.' };
  const a = live.row;
  const { rows: sites } = await query(
    `SELECT s.id, s.name, s.accuracy, z.grid_x, z.grid_y FROM aa_sites s JOIN zones z ON z.id = s.zone_id WHERE s.active = 1`
  );
  const wanted = args.join(' ').toLowerCase();
  const inRange = sites.filter(s => s.grid_x != null && cheb(a.grid_x, a.grid_y, s.grid_x, s.grid_y) <= 1);
  const target = wanted ? inRange.find(s => s.name.toLowerCase().includes(wanted)) : inRange[0];
  if (!target) return { type: 'emote', message: 'Nothing in gun range on this pass. Line it up and come around.' };

  // Arm the targeting-reticle deck (server-authoritative on `strafresolve`).
  const token = randomUUID();
  live.pendingStrafe = { token, targetId: target.id, targetName: target.name };
  sendToPlayer(player.id, {
    type: 'flight_target', token, deviceName: target.name,
    skill: await effectiveSkill(player, 'piloting'), difficulty: target.accuracy || 6,
  });
  return { type: 'emote', message: `<span class="text-cyan">Rolling in on ${target.name} — pipper on, guns hot.</span>` };
}

async function cmdStrafeResolve(args, raw, player) {
  const token = args[0], won = args[1] === '1';
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || player.seat !== 'pilot' || live.pendingStrafe?.token !== token) return { type: 'noop' };
  const { targetId, targetName } = live.pendingStrafe;
  live.pendingStrafe = null;
  const below = surfaceAt(live.row.grid_x, live.row.grid_y);
  // Target may already be dead / out of range by now.
  const { rows } = await query('SELECT active FROM aa_sites WHERE id=$1', [targetId]);
  if (!rows.length || !rows[0].active) return { type: 'noop' };
  if (won) {
    await query('UPDATE aa_sites SET active=0 WHERE id=$1', [targetId]);
    await awardSkillUse(player.id, 'piloting', 2);
    if (below) sendToZone(below.id, { type: 'zone_event', message: `${targetName} vanishes in a string of impacts and a secondary blast.`, refresh: true });
    out(player.id, `<span class="text-green">Guns, guns — you walk fire straight through ${targetName}. It's a smoking hole.</span>`);
  } else {
    out(player.id, `<span class="text-amber">Your burst goes wide of ${targetName} — and now it knows you're here.</span>`);
  }
  return { type: 'noop' };
}

export const commands = {
  arm: cmdArm,
  safe: cmdSafe,
  evade: cmdEvade,
  strafe: cmdStrafe,
  fire: cmdStrafe,
  strafresolve: cmdStrafeResolve,
};
