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
  MISSILE_RANGE_GATE, MISSILE_FLIGHT_MS, MISSILE_PK, MISSILE_DMG, MISSILE_COOLDOWN_MS,
  FLARE_DEFEAT, FLARE_WINDOW_MS, FLARE_COOLDOWN_MS, mslAmmo,
} from './state.js';
import { conspicuousnessMult } from './livery.js';
import { getZonePlayers, getZoneNpcs, getZoneEnemies } from '../../server/engine/world.js';
import { applyStrikeToPlayer, killNpcInstance, killEnemyInstance } from '../../server/engine/combat.js';
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { emit } from '../../server/engine/events.js';

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
  pushAASites(live).catch(() => {});   // refresh this pilot's ground-emplacement picture
}

// ── Ground AA emplacements → cockpit 3D models ────────────────────────────────
// The pilot's windshield draws a persistent radar-dish SAM turret at each active AA
// site so the thing shooting at you is a place you can SEE and line a gun pass up on,
// not just a bearing on the glass. Sites barely change, so the list is cached briefly
// (a ~5Hz sync must not hit the DB each time) and the push itself throttled to ~1Hz.
// Absolute world tiles go over the wire; the client anchors them to its own smooth
// position each frame, exactly like the AA tracers.
let aaSiteCache = { at: 0, rows: [] };
export function invalidateAASiteCache() { aaSiteCache.at = 0; }
async function activeAASites() {
  const now = Date.now();
  if (now - aaSiteCache.at < 4000) return aaSiteCache.rows;
  const { rows } = await query(
    `SELECT s.name, z.grid_x, z.grid_y FROM aa_sites s JOIN zones z ON z.id=s.zone_id
     WHERE s.active=1 AND z.grid_x IS NOT NULL`
  );
  aaSiteCache = { at: now, rows };
  return rows;
}

const AA_RENDER_RANGE = 16;   // tiles: push emplacements within this of the craft
async function pushAASites(live) {
  if (!isContinuous(live) || !live.row.airborne) return;
  const now = Date.now();
  if (live.lastAAPush && now - live.lastAAPush < 900) return;   // ~1Hz — the ground doesn't move
  live.lastAAPush = now;
  const a = live.row;
  const sites = (await activeAASites())
    .filter(s => cheb(a.grid_x, a.grid_y, s.grid_x, s.grid_y) <= AA_RENDER_RANGE)
    .map(s => ({ x: s.grid_x, y: s.grid_y, name: s.name }));
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (p && p.seat === 'pilot') sendToPlayer(pid, { type: 'flight_aasites', sites });
  }
}

// ── Air-to-air guns (Phase B) ─────────────────────────────────────────────────
// Apply cannon damage to a target craft: hull ladder → crash (attributed to the
// shooter) on hull-out, else battle-damage feedback + a fresh hull readout. Returns
// true if the target was killed.
async function applyAirDamage(targetLive, amount, byPlayer, reason = 'shotdown', message) {
  const t = targetLive.row;
  t.damage = Math.min(1, (t.damage || 0) + amount);
  if (t.damage >= 1) { await crash(targetLive, reason, byPlayer); return true; }
  const hullPct = Math.round((1 - t.damage) * 100);
  const dmg = Math.round(amount * 100);   // this hit's bite (hull %), for the cockpit shake
  toOccupants(targetLive, message || `<span class="text-red">⚠ TAKING FIRE — cannon rounds rake the airframe. Hull ${hullPct}%.</span>`);
  for (const pid of targetLive.occupants) {
    const p = getLivePlayer(pid);
    if (p && p.seat === 'pilot') sendToPlayer(pid, { type: 'air_hit', role: 'taken', hullPct, dmg, by: byPlayer?.handle || null });
  }
  if (isContinuous(targetLive)) pushContext(targetLive);   // refresh their hull gauge now, not next tick
  return false;
}

// RWR push to a craft's pilot: cockpit lock/missile/clear warnings (Phase C).
function airThreatTo(live, payload) {
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (p && p.seat === 'pilot') sendToPlayer(pid, { type: 'air_threat', ...payload });
  }
}

// FIRE (guns): the client owns aim and reports `guns <targetId> <aimQuality0..1>`; the
// server validates a lenient anti-spoof envelope off the last reconciled positions, then
// resolves damage as GUN_DMG × aimQuality, cut by the defender's opposed jink / active
// evade / armour. Cooldown is server-enforced so a modified client can't rapid-fire.
//
// FIRE (missile, Phase C): needs a server-recorded lock (`airlock`) on that target. The
// launch is instant feedback; the OUTCOME is fully server-authoritative — the shot rides
// as an inbound on the target's live object and resolves MISSILE_FLIGHT_MS later on the
// target's combat tick (flares / a hard break / the defender's notch can defeat it).
async function cmdAirFire(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  const weapon = (args[0] || '').toLowerCase();
  if (weapon === 'missile') return fireMissile(live, args, player);
  if (weapon !== 'guns') return { type: 'noop' };
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
  // Mark the guns hot so nearby pilots' cockpits render this craft's tracers. Push the
  // fresh picture on the FIRST burst of a squeeze (transition into firing); the window
  // covers the burst gap so we don't re-relay every round.
  const wasFiring = (live.firingUntil || 0) > nowMs;
  live.firingUntil = nowMs + 500;
  if (!wasFiring) relayContacts(live);

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

// Launch a missile at a locked target: gate-validate, spend a rail, ride the shot as an
// inbound on the TARGET's live object (it resolves there — the defender's state at impact
// time is what decides the outcome, so flares popped mid-flight actually matter).
function fireMissile(live, args, player) {
  if (!live.row.airborne || !live.row.weapons_hot || (live.type.hardpoints || 0) < 1) return { type: 'noop' };
  if (mslAmmo(live) < 1) return { type: 'emote', message: '<span class="text-amber">Rails are empty — rearm at a field.</span>' };
  const nowMs = Date.now();
  if (live.lastMsl && nowMs - live.lastMsl < MISSILE_COOLDOWN_MS) return { type: 'noop' };
  const target = args[1] ? liveAircraft.get(args[1]) : null;
  if (!target || target === live || !target.row.airborne || target.row.is_wreck) return { type: 'noop' };
  if (live.lockTargetId !== target.row.id) return { type: 'emote', message: '<span class="text-amber">No lock — hold the seeker on the target first.</span>' };
  const a = live.row, b = target.row;
  if (cheb(a.grid_x, a.grid_y, b.grid_x, b.grid_y) > MISSILE_RANGE_GATE) return { type: 'noop' };
  live.lastMsl = nowMs;
  live.msl = mslAmmo(live) - 1;
  pushContext(live);   // authoritative ammo pips, now
  target.inboundMsl = [...(target.inboundMsl || []), { shooterId: player.id, launchedAt: nowMs, resolveAt: nowMs + MISSILE_FLIGHT_MS }];
  airThreatTo(target, { kind: 'missile', ms: MISSILE_FLIGHT_MS, by: player.handle || null });
  toOccupants(target, '<span class="text-red">⚠ MISSILE INBOUND — pop <b>flares</b> and break!</span>');
  return { type: 'emote', message: `<span class="text-cyan">FOX TWO — missile away at the ${target.type.name}.</span>` };
}

// Break a shooter's seeker lock (target gone / out of range / deliberate unlock) and
// tell both cockpits, so neither side flies on a stale warning.
function breakLock(live, reason) {
  const target = live.lockTargetId ? liveAircraft.get(live.lockTargetId) : null;
  live.lockTargetId = null;
  const pilot = pilotOf(live);
  if (pilot) sendToPlayer(pilot.id, { type: 'air_threat', kind: 'lockbreak', reason });
  if (target) airThreatTo(target, { kind: 'clear' });
}

// Missile lifecycle, run from tickCombat: keep the shooter's lock honest, then resolve
// any inbound shots that have flown their time. Returns true if the craft was killed
// (the caller must stop touching a deleted live).
async function tickMissiles(live) {
  const nowMs = Date.now();
  // Lock maintenance (as shooter): the seeker drops a target that lands, dies, or opens the range.
  if (live.lockTargetId) {
    const t = liveAircraft.get(live.lockTargetId);
    if (!t || !t.row.airborne || t.row.is_wreck
      || cheb(live.row.grid_x, live.row.grid_y, t.row.grid_x, t.row.grid_y) > MISSILE_RANGE_GATE) breakLock(live, 'range');
  }
  // Inbound resolution (as target).
  if (!live.inboundMsl?.length) return false;
  const due = live.inboundMsl.filter(m => m.resolveAt <= nowMs);
  if (!due.length) return false;
  live.inboundMsl = live.inboundMsl.filter(m => m.resolveAt > nowMs);
  for (const m of due) {
    const shooter = getLivePlayer(m.shooterId);
    // Flares popped while the shot was in the air can drag the seeker off onto the decoys.
    if ((live.flaredUntil || 0) > m.launchedAt && Math.random() < FLARE_DEFEAT) {
      toOccupants(live, '<span class="text-green">The missile bites on the flares and detonates behind you.</span>');
      airThreatTo(live, { kind: 'clear' });
      if (shooter) out(shooter.id, '<span class="text-amber">Flares — your missile goes stupid and eats a decoy.</span>');
      continue;
    }
    // A hard defensive break + a good last-second notch both shave the kill probability.
    let pk = MISSILE_PK;
    if (live.evadeUntil && nowMs < live.evadeUntil) pk *= 0.55;
    const defPilot = pilotOf(live);
    if (defPilot && (await skillCheck(defPilot, 'piloting', 8)).success) pk *= 0.7;
    if (Math.random() >= pk) {
      toOccupants(live, '<span class="text-amber">The missile streaks past and self-destructs — a clean notch.</span>');
      airThreatTo(live, { kind: 'clear' });
      if (shooter) out(shooter.id, '<span class="text-amber">Miss — the shot loses the picture and goes ballistic.</span>');
      continue;
    }
    const armor = live.type.class === 'gunship' ? 0.6 : 1;
    const hullAfter = Math.round((1 - Math.min(1, (live.row.damage || 0) + MISSILE_DMG * armor)) * 100);
    const killed = await applyAirDamage(live, MISSILE_DMG * armor, shooter, 'shotdown',
      `<span class="text-red">💥 MISSILE IMPACT — the airframe bucks hard and sheds metal. Hull ${hullAfter}%.</span>`);
    if (shooter) {
      await awardSkillUse(shooter.id, 'piloting', 2);
      if (!killed) {
        out(shooter.id, `<span class="text-green">Splash — missile impact on the ${live.type.name}. Hull ${hullAfter}%.</span>`);
        sendToPlayer(shooter.id, { type: 'air_hit', role: 'dealt', hullPct: hullAfter });
      }
    }
    if (killed) return true;
    airThreatTo(live, { kind: 'clear' });
  }
  return false;
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

// A visible tracer streak from the AA site's bearing, converging on the cockpit — purely
// client-side feedback (no damage/state here, that's resolved by the caller). Sent to the
// pilot only; the windshield has no forward-firing gun deck for passengers to render it on.
// `near` (0..1) rides the crack/whiz SFX's volume+pitch — a shot from right on the edge of
// the site's engagement ring is a faint distant whiz, one from point-blank is a sharp crack.
// `x`/`y` = the emplacement's world tile, so the windshield can raise the volley from the
// actual gun on the ground as 3D world tracers (bearing stays for its screen-space fallback).
function sendAaTracer(live, site, bearing, dist) {
  const near = 1 - Math.max(0, Math.min(1, dist / Math.max(1, site.range)));
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (p && p.seat === 'pilot') sendToPlayer(pid, { type: 'aa_tracer', bearing, near, by: site.name, x: site.grid_x, y: site.grid_y });
  }
}

// ── AA + air-to-air, run each airborne tick from index.flightTick ─────────────
export async function tickCombat(live) {
  const a = live.row;
  if (!a.airborne) { live.aaThreat = null; live.aaWarned = false; return; }
  // Missiles first (Phase C): keep this craft's seeker lock honest and resolve any
  // inbound shots whose flight time is up. A kill deletes the live — stop here.
  if (await tickMissiles(live)) return;
  const bandIdx = BANDS.indexOf(a.altitude_band);
  const evading = live.evadeUntil && Date.now() < live.evadeUntil;
  const pilot = pilotOf(live);

  // AA now engages CRIMINALS ONLY — the guns are a deterrent against wanted griefers, not a
  // toll on every overflight. A clean pilot passes untouched; straying into restricted airspace
  // still raises your wanted level first, which then arms the guns against you as before. No
  // pilot (NPC/charter) ⇒ no wanted state ⇒ left alone.
  let wantedStars = 0;
  if (pilot) { try { const r = await dispatchAction({ type: 'WANTED_STARS', actor: pilot }); wantedStars = Number(r?.stars) || 0; } catch {} }
  if (!wantedStars) {
    if (live.aaWarned) { toOccupants(live, '<span class="text-green">Clear of the guns — out of the AA envelope.</span>'); live.aaWarned = false; }
    live.aaThreat = null;
    return;
  }

  const { rows: sites } = await query(
    `SELECT s.id, s.name, s.range, s.damage, s.accuracy, s.zone_id, z.grid_x, z.grid_y
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
    hitChance += 0.15 + Math.min(wantedStars, 5) * 0.04;   // you're the target now — the gunners are locked on
    if (evading) hitChance -= 0.3;
    // A skilled pilot instinctively jinks.
    if (pilot) { const chk = await skillCheck(pilot, 'piloting', s.accuracy); if (chk.success) hitChance -= 0.25; }
    // Show the pilot where it's coming from — a tracer streak from the gun's bearing,
    // converging on the cockpit whether it hits or not (misses arc past just as visibly).
    sendAaTracer(live, s, Math.round(bearingDeg(a.grid_x, a.grid_y, s.grid_x, s.grid_y)), cheb(a.grid_x, a.grid_y, s.grid_x, s.grid_y));
    if (Math.random() < Math.max(0.05, hitChance)) {
      // Armoured gun platforms (the A-10-style Reaper) shrug off ground fire — their
      // titanium tub soaks half the hit, so they can loiter over a target and survive.
      const armor = live.type.class === 'gunship' ? 0.5 : 1;
      // Lethal against criminals: the guns hit HARD (and harder the more wanted you are), so a
      // wanted griefer can't just tank the fire loitering over new players. Scales 1.6×→2.4×.
      const lethal = 1.6 + Math.min(wantedStars, 5) * 0.16;
      const dmg = s.damage * armor * lethal;
      // Reuse the PvP damage path so ground AA gets the same client feedback a gun hit
      // does — red screen flash, hit sound, and an immediate hull-gauge refresh — instead
      // of just a text log line.
      const killed = await applyAirDamage(live, dmg, null, 'shotdown',
        `<span class="text-red">💥 ${s.name} opens up — rounds walk across the airframe. Hull ${Math.round((1 - Math.min(1, a.damage + dmg)) * 100)}%.</span>`);
      emit('flight.aaFired', { zoneId: s.zone_id, siteId: s.id, siteName: s.name, hit: true });
      if (killed) return;
    } else {
      toOccupants(live, `<span class="text-amber">Tracer arcs past from ${s.name} below — a near miss.</span>`);
      emit('flight.aaFired', { zoneId: s.zone_id, siteId: s.id, siteName: s.name, hit: false });
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

// Grant a seeker lock (Phase C). The client only asks after holding the bogey in the
// seeker cone for the lock time; the server just gate-validates and records it — and
// warns the target's RWR, so a lock is never silent.
async function cmdAirLock(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne || !live.row.weapons_hot || (live.type.hardpoints || 0) < 1) return { type: 'noop' };
  const target = args[0] ? liveAircraft.get(args[0]) : null;
  if (!target || target === live || !target.row.airborne || target.row.is_wreck) return { type: 'noop' };
  const a = live.row, b = target.row;
  if (cheb(a.grid_x, a.grid_y, b.grid_x, b.grid_y) > MISSILE_RANGE_GATE) return { type: 'noop' };
  if (live.lockTargetId === target.row.id) return { type: 'noop' };   // already have it
  live.lockTargetId = target.row.id;
  airThreatTo(target, { kind: 'lock', by: player.handle || null });
  toOccupants(target, '<span class="text-red">⚠ RWR — MISSILE LOCK. Someone\'s seeker has you.</span>');
  return { type: 'emote', message: `<span class="text-green">◉ LOCK — seeker tone on the ${target.type.name}.</span>` };
}

async function cmdAirUnlock(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (live.lockTargetId) breakLock(live, 'dropped');
  return { type: 'noop' };
}

// Pop countermeasures (Phase C). Not gated to armed craft — a civilian Mayfly needs the
// counter as much as the Reaper does. The burst covers a window; any missile launched
// before flares that resolves inside it rolls the FLARE_DEFEAT decoy chance.
async function cmdFlares(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'Nothing up here to decoy.' };
  const nowMs = Date.now();
  if (live.lastFlare && nowMs - live.lastFlare < FLARE_COOLDOWN_MS) {
    return { type: 'emote', message: '<span class="text-amber">Flare launchers cycling — not ready.</span>' };
  }
  live.lastFlare = nowMs;
  live.flaredUntil = nowMs + FLARE_WINDOW_MS;
  airThreatTo(live, { kind: 'flares' });   // the cockpit plays the launch FX on confirmation
  return { type: 'emote', message: '<span class="text-cyan">FLARES — burning stars tumble away behind you.</span>' };
}

// ── Ground strafe: raking the tile directly below ─────────────────────────────
// A continuous gun pass at LOW doesn't just silence AA — it walks cannon fire
// through whatever is standing on the tile under the nose. Players take heavy,
// soak-reduced hits (a vest still helps); NPCs and enemies take heavy damage but
// can survive a pass. Gated by its own cooldown so the ~8×/s held trigger resolves
// as ~1.5 passes/sec, not a per-frame massacre. Opening up on another player is an
// assault the instant it's witnessed on the ground, and a kill is murder — both
// charged in the TARGET tile (where the cameras/cops are), not the empty sky.
const GROUND_GUN_COOLDOWN_MS = 650;
const STRAFE_HIT_CHANCE = 0.5;
const STRAFE_DMG = { min: 16, max: 30 };
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// A confirmed kill announced back to the pilot's own output pane, so they see WHO they
// just cut down (or cratered) — a strafing run is fired blind from altitude otherwise.
function announceKill(pilotId, name) {
  out(pilotId, `<span class="text-green">★ KILL — you cut down ${name} with cannon fire.</span>`);
  sendToPlayer(pilotId, { type: 'flight_kill', name });   // big top-of-glass kill banner in the cockpit
}

async function rakeGroundBelow(live, player) {
  const zone = surfaceAt(live.row.grid_x, live.row.grid_y);
  if (!zone) return;
  const occ = new Set(live.occupants);
  const players = getZonePlayers(zone.id).filter(p => p && !occ.has(p.id));

  // SOUND fires on EVERY burst (this runs at the gun's ~8/s cadence), so the people on the
  // tile hear the strafing IN SYNC with the real gunfire. The audio plugin plays the ground
  // side of it — incoming impacts + a distant report + rounds cracking past — not the
  // shooter's muzzle sound. No damage/text here; only listeners on the ground matter.
  if (players.length) emit('flight.strafeIncoming', { zoneId: zone.id });

  // DAMAGE is cooldown-gated so the 8/s trigger resolves as ~1.5 passes/sec, not a per-frame
  // massacre — the sound stays at full cadence above while the hits come at a survivable rate.
  const now = Date.now();
  if (live.lastGroundGun && now - live.lastGroundGun < GROUND_GUN_COOLDOWN_MS) return;
  const npcs = getZoneNpcs(zone.id).filter(n => n && !n._dead);
  const enemies = getZoneEnemies(zone.id).filter(e => e && (e.hp ?? 1) > 0);
  if (!players.length && !npcs.length && !enemies.length) return;
  live.lastGroundGun = now;

  // Everyone on the tile feels the pass — the terror is the point.
  sendToZone(zone.id, { type: 'zone_event',
    message: '<span class="text-red">The sky splits with a ripping roar — a low pass walks a line of cannon fire across the ground, dirt and sparks kicking up in a straight seam.</span>' });

  let hitPlayer = false, killedPlayer = false;
  for (const p of players) {
    if (Math.random() >= STRAFE_HIT_CHANCE) {
      out(p.id, '<span class="text-amber">Cannon rounds hammer the ground a body-length away — the shockwave punches the air out of you.</span>');
      continue;
    }
    const r = await applyStrikeToPlayer(p, { min: STRAFE_DMG.min, max: STRAFE_DMG.max, damageType: 'kinetic' });
    hitPlayer = true;
    if (r.killed) {
      killedPlayer = true;
      out(p.id, '<span class="text-red">A cannon round catches you square. There is not enough left to call a body.</span>');
      announceKill(player.id, p.handle);
      await handlePlayerDeath(p, player, { type: 'strafe', label: `Strafed from the air by ${player.handle}` });
    } else {
      out(p.id, `<span class="text-red">A cannon round tears through your <span class="hit-part">${r.partLabel}</span> for <span class="dmg-taken">${r.damage}</span>.</span>`);
    }
  }
  // NPCs and enemies caught in the same seam — heavy, but they can ride out a pass.
  for (const n of npcs) {
    if (Math.random() >= STRAFE_HIT_CHANCE) continue;
    n.hp = Math.max(0, (n.hp ?? n.hp_max ?? 20) - rnd(STRAFE_DMG.min, STRAFE_DMG.max));
    if (n.hp <= 0) { const dead = killNpcInstance(n.id); if (dead) { announceKill(player.id, dead.name); emit('npc.killed', { actor: player, npc: dead }); } }
  }
  for (const e of enemies) {
    if (Math.random() >= STRAFE_HIT_CHANCE) continue;
    e.hp = Math.max(0, (e.hp ?? e.hp_max ?? 20) - rnd(STRAFE_DMG.min, STRAFE_DMG.max));
    if (e.hp <= 0) { announceKill(player.id, e.name); killEnemyInstance(player, e.instanceId); }
  }

  if (hitPlayer) await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'attack_player', zoneId: zone.id } });
  if (killedPlayer) await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'murder', zoneId: zone.id } });
}

async function cmdStrafe(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  // The continuous cockpit routes its held-trigger gun bursts here (~8×/s) as the ground
  // gun-pass path; it has its own visual tracer feedback, so the "can't set up a pass"
  // advisories stay SILENT there (a typed/deck `strafe` still gets them once).
  const advise = (msg) => isContinuous(live) ? { type: 'noop' } : { type: 'emote', message: msg };
  if (!live.row.airborne) return advise('You strafe from the air.');
  if (!live.row.weapons_hot) return advise('Weapons are cold — `arm` first.');
  if (live.row.altitude_band !== 'low') return advise('Come down to LOW for a gun pass.');
  // Continuous cockpit: the same held trigger rakes people/NPCs/enemies on the tile
  // below (its own cooldown gates the rate); the AA-silencing pass resolves alongside.
  if (isContinuous(live)) await rakeGroundBelow(live, player);
  const a = live.row;
  const { rows: sites } = await query(
    `SELECT s.id, s.name, s.accuracy, z.grid_x, z.grid_y FROM aa_sites s JOIN zones z ON z.id = s.zone_id WHERE s.active = 1`
  );
  const wanted = args.join(' ').toLowerCase();
  const inRange = sites.filter(s => s.grid_x != null && cheb(a.grid_x, a.grid_y, s.grid_x, s.grid_y) <= 1);
  const target = wanted ? inRange.find(s => s.name.toLowerCase().includes(wanted)) : inRange[0];
  if (!target) return advise('Nothing in gun range on this pass. Line it up and come around.');

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
  const { rows } = await query('SELECT active, zone_id FROM aa_sites WHERE id=$1', [targetId]);
  if (!rows.length || !rows[0].active) return;   // already dead / gone
  if (won) {
    await query('UPDATE aa_sites SET active=0 WHERE id=$1', [targetId]);
    invalidateAASiteCache();   // drop the silenced turret from pilots' 3D pictures next push
    emit('flight.aaSilenced', { siteId: targetId, siteName: targetName, zoneId: rows[0].zone_id });
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
  airlock: cmdAirLock,
  airunlock: cmdAirUnlock,
  flares: cmdFlares,
};
