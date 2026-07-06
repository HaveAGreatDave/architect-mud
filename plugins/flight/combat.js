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
  sendToZone, sendToPlayer, getZone, getLivePlayer, BANDS, isContinuous,
  CONTACT_RANGE, airContact, bearingDeg, toDeg, pushContext,
  GUN_RANGE_GATE, GUN_CONE_GATE, GUN_DMG, GUN_COOLDOWN_MS,
} from './state.js';
import { conspicuousnessMult } from './livery.js';

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// ── Air-to-air contacts (Phase A: relay other airborne craft to nearby pilots) ─
// Other airborne, non-wreck craft within CONTACT_RANGE of `live`, nearest first.
export function contactsNear(live) {
  const a = live.row, res = [];
  for (const other of liveAircraft.values()) {
    if (other === live || !other.row.airborne || other.row.is_wreck) continue;
    if (other.cont?.onGround) continue;   // taxiing/rolling out is not a flying contact
    const dist = cheb(a.grid_x, a.grid_y, other.row.grid_x, other.row.grid_y);
    if (dist > CONTACT_RANGE) continue;
    res.push({ live: other, dist });
  }
  return res.sort((x, y) => x.dist - y.dist);
}

// Push a fresh contact list to one continuous craft's pilot.
function pushContacts(live) {
  if (!isContinuous(live)) return;   // only the continuous cockpit renders contacts
  const contacts = contactsNear(live).map(n => airContact(n.live));
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (p && p.seat === 'pilot') sendToPlayer(pid, { type: 'flight_contacts', contacts });
  }
}

// Event-driven relay: when `live` reports a new position (each flightsync), refresh
// its own picture AND poke every neighbour so they see this craft's fresh position
// immediately — freshness ≈ the mover's sync cadence, no extra tick latency. N is
// bounded by CONTACT_RANGE (a local furball), so the N² poke is cheap.
export function relayContacts(live) {
  const near = contactsNear(live);
  pushContacts(live);
  for (const n of near) pushContacts(n.live);
}

// ── Air-to-air guns (Phase B) ─────────────────────────────────────────────────
// Apply cannon damage to a target craft: hull ladder → crash (attributed to the
// shooter) on hull-out, else battle-damage feedback + a fresh hull readout. Returns
// true if the target was killed.
async function applyAirDamage(targetLive, amount, byPlayer, reason = 'shotdown') {
  const t = targetLive.row;
  t.damage = Math.min(1, (t.damage || 0) + amount);
  if (t.damage >= 1) { await crash(targetLive, reason, byPlayer); return true; }
  const hullPct = Math.round((1 - t.damage) * 100);
  toOccupants(targetLive, `<span class="text-red">⚠ TAKING FIRE — cannon rounds rake the airframe. Hull ${hullPct}%.</span>`);
  for (const pid of targetLive.occupants) {
    const p = getLivePlayer(pid);
    if (p && p.seat === 'pilot') sendToPlayer(pid, { type: 'air_hit', role: 'taken', hullPct, by: byPlayer?.handle || null });
  }
  if (isContinuous(targetLive)) pushContext(targetLive);   // refresh their hull gauge now, not next tick
  return false;
}

// FIRE (guns): the client owns aim and reports `guns <targetId> <aimQuality0..1>`; the
// server validates a lenient anti-spoof envelope off the last reconciled positions, then
// resolves damage as GUN_DMG × aimQuality, cut by the defender's opposed jink / active
// evade / armour. Cooldown is server-enforced so a modified client can't rapid-fire.
async function cmdAirFire(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  const weapon = (args[0] || '').toLowerCase();
  if (weapon !== 'guns') return { type: 'noop' };                    // missiles land in Phase C
  if (!live.row.airborne || !live.row.weapons_hot || (live.type.hardpoints || 0) < 1) return { type: 'noop' };
  const nowMs = Date.now();
  if (live.lastGun && nowMs - live.lastGun < GUN_COOLDOWN_MS) return { type: 'noop' };   // burst-rate cap

  const target = args[1] ? liveAircraft.get(args[1]) : null;
  if (!target || target === live || !target.row.airborne || target.row.is_wreck) return { type: 'noop' };
  const aimQuality = Math.max(0, Math.min(1, Number(args[2]) || 0));

  // Anti-spoof gate — must be roughly pointing at a target within gun reach + altitude.
  const a = live.row, b = target.row;
  if (cheb(a.grid_x, a.grid_y, b.grid_x, b.grid_y) > GUN_RANGE_GATE) return { type: 'noop' };
  if (Math.abs(BANDS.indexOf(a.altitude_band) - BANDS.indexOf(b.altitude_band)) > 1) return { type: 'noop' };
  const off = Math.abs(((bearingDeg(a.grid_x, a.grid_y, b.grid_x, b.grid_y) - toDeg(a.heading) + 540) % 360) - 180);
  if (off > GUN_CONE_GATE) return { type: 'noop' };
  live.lastGun = nowMs;

  // Opposed: a jinking defender (piloting check vs the shooter's skill), an active
  // evade break, and an armoured tub all cut the damage the burst lands.
  let mult = 1;
  if (target.evadeUntil && nowMs < target.evadeUntil) mult *= 0.4;
  const defPilot = pilotOf(target);
  if (defPilot) { const jink = await skillCheck(defPilot, 'piloting', await effectiveSkill(player, 'piloting')); if (jink.success) mult *= 0.45; }
  if (target.type.class === 'gunship') mult *= 0.6;
  const dmg = GUN_DMG * aimQuality * mult;
  if (dmg < 0.008) return { type: 'noop' };                          // grazing burst — no real bite

  const killed = await applyAirDamage(target, dmg, player, 'shotdown');
  await awardSkillUse(player.id, 'piloting', 1);
  if (!killed) {
    const hullPct = Math.round((1 - target.row.damage) * 100);
    out(player.id, `<span class="text-green">Guns — hits on the ${target.type.name}. Hull ${hullPct}%.</span>`);
    sendToPlayer(player.id, { type: 'air_hit', role: 'dealt', hullPct });
    relayContacts(live);                                             // push the target's new hull to the shooter's picture
  }
  return { type: 'noop' };
}

// The nearest active emplacement whose ring we're inside, its bearing, and whether
// we're CURRENTLY exposed (low/cruise, within its band-adjusted reach) or have climbed
// clear of it. Drives the cockpit's threat telegraph so a pilot sees the envelope — and
// the way out — before the first round arrives, not after.
function threatFrom(a, sites, bandIdx) {
  let best = null, bestD = Infinity;
  for (const s of sites) {
    if (s.grid_x == null) continue;
    const d = cheb(a.grid_x, a.grid_y, s.grid_x, s.grid_y);
    if (d > s.range + 1) continue;                 // not even near the ring
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best) return null;
  const reach = best.range + (bandIdx === 1 ? 0 : -1);
  return {
    name: best.name,
    bearing: Math.round(bearingDeg(a.grid_x, a.grid_y, best.grid_x, best.grid_y)),
    dist: bestD,
    exposed: bandIdx < 3 && bestD <= Math.max(0, reach),   // false = climbed above the guns
  };
}

// ── AA + air-to-air, run each airborne tick from index.flightTick ─────────────
export async function tickCombat(live) {
  const a = live.row;
  if (!a.airborne) { live.aaThreat = null; live.aaWarned = false; return; }
  const bandIdx = BANDS.indexOf(a.altitude_band);
  const evading = live.evadeUntil && Date.now() < live.evadeUntil;
  const pilot = pilotOf(live);

  const { rows: sites } = await query(
    `SELECT s.id, s.name, s.range, s.damage, s.accuracy, z.grid_x, z.grid_y
     FROM aa_sites s JOIN zones z ON z.id = s.zone_id WHERE s.active = 1`
  );

  // Threat telegraph: refresh the picture every tick (even at HIGH, so the HUD can flip
  // to "clear") and announce the envelope once on entry / once on exit.
  live.aaThreat = threatFrom(a, sites, bandIdx);
  const exposed = !!live.aaThreat?.exposed;
  if (exposed && !live.aaWarned) {
    live.aaWarned = true;
    toOccupants(live, `<span class="text-red">⚠ AA THREAT — you've flown into the guns at ${live.aaThreat.name}. Climb to HIGH to top the envelope, or firewall the throttle and <b>evade</b> to spoil their aim.</span>`);
  } else if (!exposed && live.aaWarned) {
    live.aaWarned = false;
    toOccupants(live, `<span class="text-green">Clear of the guns — out of the AA envelope.</span>`);
  }

  // High and fast = hard to engage; only low/cruise overflights are exposed to fire.
  if (bandIdx >= 3) return;
  for (const s of sites) {
    if (s.grid_x == null) continue;
    const reach = s.range + (bandIdx === 1 ? 0 : -1);   // cruise is a tougher shot than low
    if (cheb(a.grid_x, a.grid_y, s.grid_x, s.grid_y) > Math.max(0, reach)) continue;
    // Slow, low, loud craft are easy meat; speed + evade + altitude help. A bright,
    // glossy, high-signature paint job hands the gunners a cleaner solution; a dark
    // matte camo scheme makes the shot harder (±~15% around the ±25% signature band).
    let hitChance = 0.5 + s.accuracy * 0.04 - (a.throttle / 100) * 0.2 - bandIdx * 0.12;
    hitChance += (conspicuousnessMult(live) - 1) * 0.6;
    if (evading) hitChance -= 0.3;
    // A skilled pilot instinctively jinks.
    if (pilot) { const chk = await skillCheck(pilot, 'piloting', s.accuracy); if (chk.success) hitChance -= 0.25; }
    if (Math.random() < Math.max(0.05, hitChance)) {
      // Armoured gun platforms (the A-10-style Reaper) shrug off ground fire — their
      // titanium tub soaks half the hit, so they can loiter over a target and survive.
      const armor = live.type.class === 'gunship' ? 0.5 : 1;
      a.damage = Math.min(1, a.damage + s.damage * armor);
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

  // Continuous cockpit: no modal reticle deck — resolve the gun pass with a piloting
  // check inline (the FIRE button drives this straight from the flying cockpit).
  if (isContinuous(live)) {
    const chk = await skillCheck(player, 'piloting', target.accuracy || 6);
    await applyStrafeResult(live, player, target.id, target.name, chk.success);
    return { type: 'noop' };
  }
  // Deck craft: arm the targeting-reticle minigame (server-authoritative on `strafresolve`).
  const token = randomUUID();
  live.pendingStrafe = { token, targetId: target.id, targetName: target.name };
  sendToPlayer(player.id, {
    type: 'flight_target', token, deviceName: target.name,
    skill: await effectiveSkill(player, 'piloting'), difficulty: target.accuracy || 6,
  });
  return { type: 'emote', message: `<span class="text-cyan">Rolling in on ${target.name} — pipper on, guns hot.</span>` };
}

// Apply a gun-pass outcome: silence the site on a hit, or wake it on a miss. Shared by
// the deck minigame (strafresolve) and the continuous cockpit's inline fire.
async function applyStrafeResult(live, player, targetId, targetName, won) {
  const below = surfaceAt(live.row.grid_x, live.row.grid_y);
  const { rows } = await query('SELECT active FROM aa_sites WHERE id=$1', [targetId]);
  if (!rows.length || !rows[0].active) return;   // already dead / gone
  if (won) {
    await query('UPDATE aa_sites SET active=0 WHERE id=$1', [targetId]);
    await awardSkillUse(player.id, 'piloting', 2);
    if (below) sendToZone(below.id, { type: 'zone_event', message: `${targetName} vanishes in a string of impacts and a secondary blast.`, refresh: true });
    out(player.id, `<span class="text-green">Guns, guns — you walk fire straight through ${targetName}. It's a smoking hole.</span>`);
  } else {
    out(player.id, `<span class="text-amber">Your burst goes wide of ${targetName} — and now it knows you're here.</span>`);
  }
}

async function cmdStrafeResolve(args, raw, player) {
  const token = args[0], won = args[1] === '1';
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || player.seat !== 'pilot' || live.pendingStrafe?.token !== token) return { type: 'noop' };
  const { targetId, targetName } = live.pendingStrafe;
  live.pendingStrafe = null;
  await applyStrafeResult(live, player, targetId, targetName, won);
  return { type: 'noop' };
}

export const commands = {
  arm: cmdArm,
  safe: cmdSafe,
  evade: cmdEvade,
  strafe: cmdStrafe,
  fire: cmdStrafe,
  strafresolve: cmdStrafeResolve,
  airfire: cmdAirFire,
};
