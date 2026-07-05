import { world, tickSpawns, getRandomAmbient, getWeatherAmbient, getLivePlayer, getInterruptLoudness, registerInterrupt, createCorpse, removeCorpse, tryBattleCry, setApartmentCache } from './world.js';
import { randomUUID } from 'crypto';
import { propagateSound } from './sounds.js';
import { enemyAttackPlayer, enemyAttackNpc, npcAttackPlayer, isOnCooldown, pvpSwing, formatBattleCry, getPlayerCombat } from './combat.js';
import { tickEntityAI, moveEntity, ensureBehaviourGraph } from './ai-behaviour.js';
import { npcBanterTick } from './npc-banter.js';
import { restockAllVendors } from './vendor.js';
import { tickEffects, applyEffect } from './effects.js';
import { tickSleep, releaseApartment, gameToday, ymd, addGameDays, gameDaysBetween, RENT_PERIOD_DAYS } from './apartments.js';
import { fireHook } from './plugins.js';
import { emit, on } from './events.js';
import { schedule } from './scheduler.js';
import { hasExit, neighborZoneIds } from './exits.js';
import { setPosture, forceStand } from './posture.js';
import { carryCapacity } from './commands/inventory.js';
import { query, logActivity } from '../models/db.js';
import { getEnvironmentState, getZoneTemperature, getZoneApparentTemperature, recordLightningKill, getZoneStormIntensity } from './environment.js';
import { tickDrugDecay, tickDrugs, tickWithdrawal, clearActiveDrugState } from './drugs.js';
import { getTimeScale } from './gametime.js';

// HP restored per sitting tick (every 15 seconds)
const SIT_REGEN_HP = 5;

let broadcastFn = null;
let lastNoCombatWarn = 0;
let minuteTick = 0;

export function startGameLoop(broadcast) {
  broadcastFn = broadcast;
  setInterval(tick, 1000); // 1s combat tick stays raw — latency-critical hot path
  schedule('1m', minuteTickFn);
  schedule('45s', ambientTick);
  schedule('30s', stormTick);
  schedule('1m', resourceTick);
  schedule('10s', () => tickSpawns(broadcastFn));
  schedule('15s', sittingRegenTick);
  schedule('1m', npcWanderTick);
  schedule('30s', () => npcBanterTick({ broadcast: broadcastFn }));
  // Once-per-GAME-day housekeeping + rent collection. Driven by the environment's
  // day-rollover event (not the real '24h'/'1m' cadences) so both track the
  // game-speed knob — at 3× they run every 8 real hours, in lockstep with the
  // calendar advancing.
  on('environment.dayRollover', dailyMaintenance);
  on('environment.dayRollover', rentCollectionTick);
  // A dev-panel clock jump (environment.devSetTime) can put NPCs on or off shift.
  // Force every employed NPC to re-check work now instead of waiting for the next
  // wander tick — otherwise a sleeping NPC would stay asleep until its old
  // scheduled wake and shops wouldn't open/close to match the new time.
  on('environment.timeSet', () => { forceNpcWorkRecheck().catch(() => {}); });
  console.log('✓ Game loop started');
}

// Coalesced so spamming the time slider can't stack overlapping sweeps.
let workRecheckInFlight = false;
async function forceNpcWorkRecheck() {
  if (workRecheckInFlight) return;
  workRecheckInFlight = true;
  try {
    for (const [, npc] of world.npcs) {
      if (npc._dead) continue;
      if (npc._aboard) continue;   // riding aboard a vehicle (e.g. a charter pilot) — frozen
      const ai = npc._ai;
      if (!ai || !npc.behaviour_graph?._start) continue;
      ai.waitUntil = null; // drop any pending WAIT (work-wait, have-life, or sleep)
      await tickEntityAI(npc, { broadcast: broadcastFn, query }).catch(() => {});
    }
  } finally {
    workRecheckInFlight = false;
  }
}

async function tick() {
  // Player-initiated combat lives in the weapon plugin (registerPlayerCombat).
  // Raw function references — never the Action dispatcher (ADR-0001 hot path).
  // If the plugin failed to load, players can't fight: shout, don't go silent.
  const playerCombat = getPlayerCombat();
  if (!playerCombat && Date.now() - lastNoCombatWarn > 10000) {
    lastNoCombatWarn = Date.now();
    console.error('[gameLoop] No player-combat provider registered — is the weapon plugin loaded? Player attacks are DEAD.');
  }

  // Enemy AI
  for (const [instanceId, enemy] of world.enemies) {
    // Self-heal: give auto-aggressive enemies without a graph the default combat
    // graph so they run on VINE (idempotent — no-op once a graph is present).
    ensureBehaviourGraph(enemy, 'enemy');
    // Ambient threat escalation — runs for all enemies when no target yet
    if (!enemy.targetId) {
      const zone = world.zones.get(enemy.zoneId);
      if (zone && zone.players.size > 0) {
        const now = Date.now();
        if (!enemy._lastThreatTick || now - enemy._lastThreatTick >= 5000) {
          enemy._lastThreatTick = now;
          enemy._threatLevel = (enemy._threatLevel || 0) + 1;

          // Battlecry — throttled to once per 30 s per individual enemy; also suppressed for 10 s if same type just shouted
          const cries = enemy.flags?.battle_cries;
          if (Array.isArray(cries) && cries.length && now - (enemy._lastBattleCry || 0) >= 30000 && tryBattleCry(enemy.templateId)) {
            enemy._lastBattleCry = now;
            const randomPlayer = getLivePlayer([...zone.players][Math.floor(Math.random() * zone.players.size)]);
            const cry = cries[Math.floor(Math.random() * cries.length)]
              .replace(/\$enemy/g, enemy.name)
              .replace(/\$player/g, randomPlayer?.handle || 'you');
            broadcastFn(enemy.zoneId, { type: 'output', message: formatBattleCry(enemy.name, cry) });
          }

          // Escalating aggro roll — chance grows 5% per 5-second tick.
          // Filter out admins for enemies that have ignores_admins set.
          const canAggro = enemy.behavior === 'aggressive' || enemy.behavior === 'territorial' || enemy.behaviour_graph?._start;
          if (canAggro && Math.random() < Math.min(enemy._threatLevel * 0.05, 0.95)) {
            let candidates = [...zone.players].map(id => getLivePlayer(id)).filter(Boolean);
            if (enemy.flags?.ignores_admins) candidates = candidates.filter(p => p.role !== 'admin');
            if (candidates.length) {
              enemy.targetId = candidates[Math.floor(Math.random() * candidates.length)].id;
              enemy.aggroedAt = now;
            }
          }
        }
      } else {
        // No players in zone — reset threat counter
        enemy._threatLevel = 0;
        enemy._lastThreatTick = null;
      }
    } else {
      // In combat — reset threat so it starts fresh if they drop target later
      enemy._threatLevel = 0;
      enemy._lastThreatTick = null;
    }

    if (enemy.behaviour_graph?._start) {
      // Behaviour graph drives this enemy — delegate to AI runtime.
      tickEntityAI(enemy, { broadcast: broadcastFn, query }).catch(() => {});
      continue;
    }

    // Hardcoded fallback for enemies without a behaviour graph.
    if (!enemy.targetId) {
      const zone = world.zones.get(enemy.zoneId);
      if (!zone || zone.players.size === 0) continue;
      if (!enemy.targetId && (enemy.behavior === 'aggressive' || enemy.behavior === 'territorial')) {
        enemy.targetId = [...zone.players][Math.floor(Math.random() * zone.players.size)];
        enemy.aggroedAt = Date.now();
      }
    }
    if (enemy.targetId) {
      const target = getLivePlayer(enemy.targetId);
      if (!target || target.current_zone !== enemy.zoneId) { enemy.targetId = null; enemy.aggroedAt = null; continue; }

      // Some enemies hesitate before their first swing (lore-appropriate —
      // a skittish scavenger sizing you up, a slow mutant lumbering closer).
      // first_strike_delay_ms lives in the enemy's flags JSON.
      const firstStrikeDelay = enemy.flags?.first_strike_delay_ms || 0;
      if (firstStrikeDelay > 0 && enemy.lastAttack === 0) {
        const elapsedSinceAggro = Date.now() - (enemy.aggroedAt || Date.now());
        if (elapsedSinceAggro < firstStrikeDelay) continue;
      }

      enemyAttackPlayer(enemy, target).then(async result => {
        if (!result) return;
        // Any hit attempt interrupts activity postures (sitting, lying,
        // kneeling, butchering, scavenging) — posture is the orchestrator; the
        // activity plugins' ticks see the change and discard their own state.
        if (forceStand(target, 'attacked')) {
          broadcastFn(null, { type: 'output', message: `You scramble to your feet as the attack comes in!` }, null, target.id);
        }
        if (result.hit) {
          target.hp = Math.max(0, target.hp - result.damage);
          query('UPDATE players SET hp=$1 WHERE id=$2', [target.hp, target.id]).catch(()=>{});
          broadcastFn(null, { type:'combat_incoming', message:result.message, player_update:{ hp:target.hp, hp_max:target.hp_max } }, null, target.id);
          if (target.hp <= 0) { await handlePlayerDeath(target, enemy); return; }

          // Retaliation: start attacking the attacker only if not already engaged.
          // The player auto-attack loop in tick() sustains combat from here on.
          const currentCombatEnemy = target.combatTargetId ? world.enemies.get(target.combatTargetId) : null;
          const currentTargetAlive = currentCombatEnemy && currentCombatEnemy.zoneId === target.current_zone;
          if (!currentTargetAlive && !((target.disengagedUntil || 0) > Date.now())) target.combatTargetId = enemy.instanceId;
        } else {
          broadcastFn(null, { type:'combat_miss', message:result.message }, null, enemy.targetId);
        }
      }).catch(() => {});
    }
  }

  // Player auto-attack: sustain combat against combatTargetId each tick
  for (const [playerId, player] of world.players) {
    if (!playerCombat) break;
    if (!player.combatTargetId) continue;
    const combatEnemy = world.enemies.get(player.combatTargetId);
    if (!combatEnemy || combatEnemy.zoneId !== player.current_zone) {
      player.combatTargetId = null;
      continue;
    }
    if (!isOnCooldown(playerId, 'attack')) {
      playerCombat.resolveAttack(player, combatEnemy, broadcastFn)
        .then(atkResult => {
          if (atkResult?.type === 'combat') {
            broadcastFn(null, { ...atkResult, auto: true }, null, playerId);
          } else {
            // Target gone (killed by another player, etc.) — stop
            player.combatTargetId = null;
          }
        })
        .catch(() => {});
    }
  }

  // PvP auto-attack: sustain combat between players each tick
  for (const [playerId, player] of world.players) {
    if (!player.pvpTargetId) continue;
    const pvpTarget = getLivePlayer(player.pvpTargetId);
    if (!pvpTarget || pvpTarget.current_zone !== player.current_zone) {
      if (pvpTarget) {
        pvpTarget.pvpTargetId = null;
        broadcastFn(null, { type: 'output', message: `${player.handle} has left. Combat ends.` }, null, pvpTarget.id);
      }
      broadcastFn(null, { type: 'output', message: 'Your opponent has left. Combat ends.' }, null, playerId);
      player.pvpTargetId = null;
      continue;
    }
    if (isOnCooldown(playerId, 'attack')) continue;
    pvpSwing(player, pvpTarget).then(async result => {
      if (!result) return;
      // Same rule as the PvE handler above: any hit attempt clears any
      // non-standing posture, not just sitting.
      if (forceStand(pvpTarget, 'attacked')) {
        broadcastFn(null, { type: 'output', message: `You scramble to your feet as the attack comes in!` }, null, pvpTarget.id);
      }
      broadcastFn(null, { type: 'combat', message: result.attackerMsg, auto: true }, null, playerId);
      broadcastFn(null, { type: 'combat_incoming', message: result.defenderMsg, player_update: { hp: result.defenderHp, hp_max: result.defenderHpMax } }, null, pvpTarget.id);
      if (result.killed) {
        player.pvpTargetId = null;
        pvpTarget.pvpTargetId = null;
        await handlePlayerDeath(pvpTarget, player);
      }
    }).catch(() => {});
  }

  // One-sided auto-attack against offline sleeping players
  for (const [playerId, player] of world.players) {
    if (!playerCombat) break;
    if (!player.offlinePvpTargetId) continue;
    if (isOnCooldown(playerId, 'attack')) continue;
    playerCombat.offlineSleepSwing(player, player.offlinePvpTargetId, broadcastFn).catch(() => {});
  }

  // Player auto-attack against NPC
  for (const [playerId, player] of world.players) {
    if (!playerCombat) break;
    if (!player.npcCombatTargetId) continue;
    const npc = world.npcs.get(player.npcCombatTargetId);
    if (!npc || npc._dead || npc.zone_id !== player.current_zone) {
      player.npcCombatTargetId = null;
      continue;
    }
    if (!isOnCooldown(playerId, 'attack')) {
      playerCombat.resolveAttackNpc(player, npc, broadcastFn)
        .then(atkResult => {
          if (atkResult?.type === 'combat') {
            broadcastFn(null, { ...atkResult, auto: true }, null, playerId);
          } else {
            player.npcCombatTargetId = null;
          }
        })
        .catch(() => {});
    }
  }

  // NPC retaliation against players
  for (const [npcId, npc] of world.npcs) {
    if (!npc._combatTargetId || npc._dead) continue;
    const target = getLivePlayer(npc._combatTargetId);
    if (!target || target.current_zone !== npc.zone_id) {
      npc._combatTargetId = null;
      continue;
    }
    npcAttackPlayer(npc, target).then(async result => {
      if (!result) return;
      if (result.hit) {
        target.hp = Math.max(0, target.hp - result.damage);
        query('UPDATE players SET hp=$1 WHERE id=$2', [target.hp, target.id]).catch(() => {});
        broadcastFn(null, { type: 'combat_incoming', message: result.message, player_update: { hp: target.hp, hp_max: target.hp_max } }, null, target.id);
        if (target.hp <= 0) {
          await handlePlayerDeath(target, null, { type: 'combat', label: `Killed by ${npc.name}` });
        } else if (!target.npcCombatTargetId && !((target.disengagedUntil || 0) > Date.now())) {
          target.npcCombatTargetId = npcId;
        }
      } else {
        broadcastFn(null, { type: 'combat_miss', message: result.message }, null, target.id);
      }
    }).catch(() => {});
  }

  // Status effects + phased drug effects
  for (const [playerId, player] of world.players) {
    const hpBefore = player.hp;
    const stamBefore = player.stamina;
    const messages = [...tickEffects(player), ...tickDrugs(player)];
    if (messages.length) broadcastFn(null, { type:'status_tick', messages }, null, playerId);
    // Effects mutate hp/stamina in memory but this per-second tick historically
    // neither persisted nor pushed them — so effect damage was invisible on the
    // HUD until the minute tick. Persist + broadcast when an effect changed them.
    const hpChanged = player.hp !== hpBefore;
    const stamChanged = player.stamina !== stamBefore;
    if (hpChanged || stamChanged) {
      await query('UPDATE players SET hp=$1, stamina=$2 WHERE id=$3', [player.hp, player.stamina, playerId]);
      broadcastFn(null, { type:'resource_tick', messages:[], player_update:{ hp: player.hp, stamina: player.stamina } }, null, playerId);
    }
    if ((messages.length || hpChanged) && player.hp <= 0) await handlePlayerDeath(player, null, { type: 'survival', label: 'Succumbed to your condition' });
  }
}

async function minuteTickFn() {
  minuteTick++;
  await fireHook('tick.minute', { broadcast: broadcastFn });
  emit('tick.minute', { broadcast: broadcastFn });

  for (const [playerId, player] of world.players) {
    // Radiation decay: -1 per minute naturally, -2 per minute while hydrated
    // (water "slightly accelerates radiation removal," per design).
    if ((player.radiation || 0) > 0) {
      const hydrated = player.hydratedUntil && Date.now() < player.hydratedUntil;
      const decay = hydrated ? 2 : 1;
      player.radiation = Math.max(0, player.radiation - decay);
      await query('UPDATE players SET radiation=$1 WHERE id=$2', [player.radiation, playerId]);
      if (player.radiation % 10 === 0 && player.radiation > 0) {
        broadcastFn(null, { type:'player_update', radiation: player.radiation }, null, playerId);
      }
    }
    if (player.hydratedUntil && Date.now() >= player.hydratedUntil) player.hydratedUntil = null;

    // Drug decay: once a dose's active window has expired, doses_in_system drops by 1/min
    // so overdose thresholds clear over time instead of accumulating forever.
    await tickDrugDecay(playerId);

    // Withdrawal: apply/clear addiction debuffs; decay addiction toward sobriety.
    const wdMessages = await tickWithdrawal(player);
    if (wdMessages.length) broadcastFn(null, { type: 'status_tick', messages: wdMessages }, null, playerId);
  }
}

// Spawn a lootable corpse for a dead player: strip non-quest inventory into it, persist
// the row, and register it in memory. Shared by the live-death path and the offline
// sleep-kill path so corpse capacity + strip rules can't drift. Returns id + name.
export async function spawnPlayerCorpse(victim, zoneId) {
  const corpseId = `corpse_player_${victim.id}_${Date.now()}`;
  const corpseName = `${victim.handle}'s corpse`;
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const capacity = carryCapacity(victim);
  // Strip all non-quest items into the corpse (flatten container nesting)
  await query(
    `UPDATE player_inventory pi SET player_id=$1, is_equipped=0, slot=NULL, layer=NULL, container_id=NULL
     FROM items i WHERE i.id=pi.item_id AND pi.player_id=$2
     AND NOT (i.tags @> '{"quest_item":true}')`,
    [corpseId, victim.id]
  ).catch(() => {});
  // Persist corpse so it survives server restart
  await query(
    `INSERT INTO player_corpses (id, player_id, zone_id, death_message, expires_at, capacity) VALUES ($1, $2, $3, $4, $5, $6)`,
    [corpseId, victim.id, zoneId, corpseName, expiresAt, capacity]
  ).catch(() => {});
  createCorpse({ id: corpseId, name: corpseName, zoneId, expiresAt, capacity });
  return { corpseId, corpseName };
}

// Re-equip the default starter outfit (underwear layer 1 + basics layer 2) after death,
// skipping anything already equipped. Shared by both death paths.
export function equipStarterOutfit(victimId, sex) {
  const underwear = sex === 'male'
    ? [['item_underwear_male', 'legs']]
    : [['item_underwear_female_top', 'torso'], ['item_underwear_female_bottom', 'legs']];
  const equip = (itemId, slot, layer) =>
    query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot,layer)
           SELECT $1,$2,i.id,1,1.0,1,$3,$4 FROM items i WHERE i.id=$5
           AND NOT EXISTS (SELECT 1 FROM player_inventory WHERE player_id=$2 AND item_id=$5 AND is_equipped=1)`,
      [randomUUID(), victimId, slot, layer, itemId]).catch(() => {});
  for (const [itemId, slot] of underwear) equip(itemId, slot, 1);
  for (const [itemId, slot] of [['item_basic_shirt','torso'],['item_basic_pants','legs'],['item_basic_shoes','feet']]) equip(itemId, slot, 2);
}

export async function handlePlayerDeath(player, killer, cause = null) {
  // Re-entrancy guard: several attacks can resolve in the same tick and each land a
  // "killing" blow on an already-dead player. Without this, each call inserts another
  // corpse and increments deaths again. The flag clears once respawn completes below.
  if (player._dying) return;
  player._dying = true;

  player.deaths = (player.deaths || 0) + 1;
  query('UPDATE players SET deaths=deaths+1 WHERE id=$1', [player.id]).catch(() => {});
  if (killer && killer.id) {
    killer.player_kills = (killer.player_kills || 0) + 1;
    query('UPDATE players SET player_kills=player_kills+1 WHERE id=$1', [killer.id]).catch(() => {});
  }
  const msgs = [
    "You die. Statistically speaking, this was inevitable.",
    "You die. The world continues without you, which feels rude.",
    "You die. Someone, somewhere, does not notice.",
    "Death arrives. You were not ready, but death has a schedule.",
    "You are dead. The Architect notes this. The Architect does not care.",
    "You die in a way that will be described differently by everyone who witnessed it.",
  ];
  const msg = msgs[Math.floor(Math.random() * msgs.length)];
  const killerMsg = killer ? ` Killed by: ${killer.name}.` : '';
  const deathZone = player.current_zone;

  // Respawn override seam: a plugin (e.g. jail) may divert a downed player
  // somewhere other than their anchor and take custody of their body/gear.
  // The hook runs while inventory is still intact — before spawnPlayerCorpse
  // strips it — so it can confiscate rather than drop into a lootable corpse.
  // A truthy return { zone, message } routes respawn there and skips the corpse.
  const respawnOverride = await fireHook('player.respawnZone', player, killer);
  const respawnZone = respawnOverride?.zone || player.anchor_zone || 'zone_start';

  // Resolve the cause the systems broadcast to any listeners (e.g. the deaths
  // catalogue). A caller that knows the specific cause passes it explicitly;
  // otherwise derive from the killer — a player killer (has .id) is pvp, an
  // enemy (has .name, no .id) is combat — falling back to unknown when the
  // death is environmental and unlabelled.
  const resolvedCause = cause
    || (killer
      ? { type: killer.id ? 'pvp' : 'combat', label: `Killed by ${killer.name || killer.handle}` }
      : { type: 'unknown', label: 'Unknown causes' });

  // No corpse when a plugin took custody of the body (the cops bagged your gear).
  const { corpseId, corpseName } = respawnOverride
    ? { corpseId: null, corpseName: null }
    : await spawnPlayerCorpse(player, deathZone);

  // Shed active drug state BEFORE the restore: reverse every timed buff (so hp_max
  // is the true base, not a drug-inflated cap), drop phased drugs, and clear
  // doses-in-system (so a fresh clone isn't one dose from an instant re-overdose).
  clearActiveDrugState(player);

  // Full restore on respawn — you come out of the vat whole, not wounded.
  // Skills/rank/xp live in a separate table untouched by any of this, so
  // everything learned carries over; only the body resets.
  player.hp = player.hp_max;
  player.sanity = player.sanity_max;
  player.hunger = 100;
  player.thirst = 100;
  player.radiation = 0;
  player.stamina = player.stamina_max ?? 100;
  player.body_temp_c = 37.0;
  player.clothing_contamination = {};
  player._dangerousTempTicks = 0;
  player.sleeping = null;
  setPosture(player, 'standing');
  player.combatTargetId = null;
  player.pvpTargetId = null;
  player.offlinePvpTargetId = null;

  const vatLine = respawnOverride?.message
    || `<span class="clone-vat-message">A vending-machine-shaped cloning vat hums, dispenses a fresh you, and prints a receipt nobody asked for. Everything you knew, you still know. Everything that hurt, doesn't anymore.</span>`;
  broadcastFn(null, {
    type:'player_death',
    message:`\n<span class="death-message">☠ ${msg}${killerMsg}</span>\n${vatLine}`,
    respawn_zone: respawnZone,
    player_update: { hp:player.hp, sanity:player.sanity, hunger:player.hunger, thirst:player.thirst, radiation:player.radiation, stamina:player.stamina, body_temp_c:player.body_temp_c },
  }, null, player.id);

  emit('player.respawn', { player });

  // Notify others in the death zone that a corpse has appeared (skipped when a
  // plugin took custody of the body — there's no corpse to loot).
  if (corpseId) {
    const corpseLink = `<span class="action-link corpse-link" data-action="loot" data-target="${corpseId}" data-label="${corpseName}" title="Loot ${corpseName}">${corpseName}</span>`;
    broadcastFn(deathZone, { type:'zone_event', message:`${player.handle} has died. ${corpseLink}`, refresh: true }, player.id);
  }

  query('UPDATE players SET hp=$1, sanity=$2, hunger=$3, thirst=$4, radiation=$5, stamina=$6, body_temp_c=$7, clothing_contamination=$8, current_zone=$9 WHERE id=$10',
    [player.hp, player.sanity, player.hunger, player.thirst, player.radiation, player.stamina, player.body_temp_c, JSON.stringify({}), respawnZone, player.id]).catch(()=>{});

  // Move player back to anchor in memory
  for (const [,zone] of world.zones) zone.players.delete(player.id);
  world.zones.get(respawnZone)?.players.add(player.id);
  player.current_zone = respawnZone;

  // Equip fresh underwear (layer 1) and basic clothing (layer 2) on respawn
  equipStarterOutfit(player.id, player.biological_sex || 'male');

  logActivity('death', player.handle);
  fireHook('player.death', player, killer).catch(()=>{});
  emit('player.death', { player, killer, cause: resolvedCause, deathZone });

  player._dying = false; // respawn complete — a future death may process again
}

// Weather types that produce distinct ambient sounds outdoors.
const WEATHER_AMBIENT_TYPES = new Set(['rain','sleet','thunderstorm','storm','snow','blizzard','fog','haze','ash']);

async function ambientTick() {
  const { weatherType } = getEnvironmentState();
  const weatherTheme = `weather_${weatherType}`;
  const hasWeatherSounds = WEATHER_AMBIENT_TYPES.has(weatherType);

  for (const [zoneId, zone] of world.zones) {
    if (zone.players.size === 0 || Math.random() > 0.4) continue;

    // Plugin hook first
    const pluginAmbient = await fireHook('zone.describeAmbient', zone);
    if (pluginAmbient) {
      broadcastFn(zoneId, { type:'ambient', message:`<span class="msg-ambient">${pluginAmbient}</span>` });
      continue;
    }

    const ambient = getRandomAmbient(zoneId);
    if (!ambient) continue;

    // Directional ambients (a door "above you", footsteps "below you") only make
    // sense when there's actually a room in that direction. Skip them otherwise.
    const msgText = ambient.message || '';
    if (/\babove you\b/i.test(msgText) && !hasExit(zone, 'up')) continue;
    if (/\bbelow you\b/i.test(msgText) && !hasExit(zone, 'down')) continue;

    // Suppress this ambient if a louder sound recently fired in this zone.
    const interrupt = getInterruptLoudness(zoneId);
    if (interrupt > ambient.loudness * 1.5) continue;

    // Propagate with sound reach — quiet ambients stay local, louder ones spread.
    registerInterrupt(zoneId, ambient.loudness, 6000);
    propagateSound(zoneId, ambient.message, ambient.loudness, broadcastFn);

    // For exterior zones during active weather, occasionally layer a weather sound.
    const isExterior = !zone.flags?.is_interior;
    if (isExterior && hasWeatherSounds && Math.random() < 0.4) {
      const weatherAmbient = getWeatherAmbient(zoneId, weatherTheme);
      if (weatherAmbient && interrupt <= weatherAmbient.loudness * 1.5) {
        propagateSound(zoneId, weatherAmbient.message, weatherAmbient.loudness, broadcastFn);
      }
    }
  }
}

const STORM_WEATHER_TYPES = new Set(['thunderstorm', 'storm']);

const THUNDER_MESSAGES = [
  '<span class="msg-ambient">A crack of thunder splits the air — close, loud, and felt in the chest.</span>',
  '<span class="msg-ambient">Thunder rolls across the sky in a long, rumbling wave.</span>',
  '<span class="msg-ambient">A deep boom of thunder rattles the buildings around you.</span>',
  '<span class="msg-ambient">Lightning, then a violent crack of thunder half a second behind it.</span>',
  '<span class="msg-ambient">Thunder detonates overhead. The ground seems to shudder with it.</span>',
];

// Fires lightning flashes and thunder messages to outdoor players during storms.
// Runs every 30s; each zone has a random chance of a strike per tick.
// Very rarely (1 in 500 per zone per tick) a player in that zone is struck and killed.
async function stormTick() {
  const { weatherType } = getEnvironmentState();
  if (!STORM_WEATHER_TYPES.has(weatherType)) return;

  for (const [zoneId, zone] of world.zones) {
    if (zone.players.size === 0) continue;
    if (zone.flags?.is_interior) continue;
    // Per-tile: only zones actually under a storm cell flash, and denser cells
    // flash (and kill) more often. Field disabled → uniform 0.5 (old behaviour).
    const intensity = getZoneStormIntensity(zoneId);
    if (intensity <= 0) continue;
    if (Math.random() > intensity) continue;

    // Send lightning flash to all players in zone
    broadcastFn(zoneId, { type: 'lightning' });

    // Very rare: one player in the zone gets struck by lightning, scaled by
    // local storm intensity (1 in 500 per flash at a cell core).
    if (Math.random() < (1 / 500) * intensity) {
      const playerIds = [...zone.players];
      const victimId = playerIds[Math.floor(Math.random() * playerIds.length)];
      const victim = getLivePlayer(victimId);
      if (victim && !victim.sleeping) {
        broadcastFn(null, {
          type: 'output',
          message: `<span class="death-message">⚡ ⚡ ⚡ LIGHTNING STRIKES! ⚡ ⚡ ⚡\nA blinding bolt of lightning tears through the sky and strikes you squarely. Thunder explodes overhead as the world disappears in a flash of searing white.</span>`,
        }, null, victim.id);
        broadcastFn(zoneId, { type: 'zone_event', message: `A bolt of lightning strikes ${victim.handle} dead.` }, victim.id);
        const kill = await recordLightningKill(victim.handle);
        console.log(`[weather] Lightning killed ${victim.handle} in zone ${zoneId} at ${kill.date} ${kill.time}.`);
        await handlePlayerDeath(victim, null, { type: 'weather', label: 'Lightning Strike' });
      }
    }

    // Thunder follows 0.5–3s later (simulated with a small delay)
    const delay = 500 + Math.random() * 2500;
    const msg = THUNDER_MESSAGES[Math.floor(Math.random() * THUNDER_MESSAGES.length)];
    setTimeout(() => {
      broadcastFn(zoneId, { type: 'ambient', message: msg });
      emit('weather.thunder', { zoneId });
    }, delay);
  }
}

// Hunger and thirst decay by 1 point every N minutes of being awake — at
// 60s real-time ticks, this is what actually makes "several hours to
// become fatal" true, rather than depleting from 100 inside one hour.
// Thirst depletes faster than hunger, matching real survival pacing and
// the brief's explicit ordering.
const THIRST_DECAY_INTERVAL_MIN = 3;  // 1 point per 3 min → 100 pts / 5 hours
const HUNGER_DECAY_INTERVAL_MIN = 4;  // 1 point per 4 min → 100 pts / ~6.7 hours

// Returns a multiplier (0.0–1.0) for stamina regen based on body temperature.
// Comfortable range (36–38°C) = full regen; further from it = reduced regen.
function tempRegenMultiplier(tempC) {
  if (tempC >= 36 && tempC <= 38) return 1.0;
  if (tempC >= 34 && tempC < 36) return 0.8;  // slightly cold
  if (tempC >= 30 && tempC < 34) return 0.6;  // cold
  if (tempC > 38 && tempC <= 40) return 1.0;  // slightly hot — regen unaffected
  if (tempC > 40 && tempC <= 42) return 0.8;  // hot
  return 0.0; // freezing (<30) or overheating (>42) — no passive regen
}

// Returns a flavor message for the given temp band, or null if comfortable.
// Only fires at certain tick counts to avoid spam.
function tempFlavorMessage(tempC, tick) {
  if (tempC >= 36 && tempC <= 38) return null;

  // slightly chilly (36–34°C): every 6 ticks
  if (tempC >= 34 && tempC < 36 && tick % 6 === 0) {
    const msgs = [
      'You feel a little chilly.',
      'A cold draft finds its way through your clothing.',
      'You pull your clothes tighter against the chill.',
      'The air has a bite to it.',
      'You rub your hands together for warmth.',
      'Your skin prickles with cold.',
    ];
    return msgs[(tick / 6) % msgs.length | 0];
  }

  // cold (34–32°C): every 5 ticks
  if (tempC >= 32 && tempC < 34 && tick % 5 === 0) {
    const msgs = [
      'You begin to shiver.',
      'The cold is getting to you.',
      'Your breath fogs in the air.',
      'Your fingers are going numb.',
      'You stamp your feet trying to stay warm.',
      'The chill has settled deep into your bones.',
      'Your teeth chatter involuntarily.',
    ];
    return msgs[(tick / 5) % msgs.length | 0];
  }

  // very cold (32–30°C): every 4 ticks — escalating, approaching danger
  if (tempC >= 30 && tempC < 32 && tick % 4 === 0) {
    const msgs = [
      'Your shivering is getting violent.',
      'You can barely feel your hands anymore.',
      'Your core is struggling to stay warm.',
      'Everything feels heavy and slow in the cold.',
      'The cold is making it hard to think straight.',
      'Your lips are going blue.',
      'You desperately need to find warmth.',
    ];
    return msgs[(tick / 4) % msgs.length | 0];
  }

  // freezing (< 30°C): every 4 ticks — dangerous, HP draining
  if (tempC < 30 && tick % 4 === 0) {
    const msgs = [
      'You feel dangerously cold. Your body is shutting down.',
      'Hypothermia is setting in. You need warmth NOW.',
      'You can barely feel your extremities. This is how people die.',
      'Your vision is narrowing at the edges. The cold is killing you.',
      'Uncontrollable shaking wracks your body.',
      'You can\'t stop shivering. Your muscles are giving out.',
      'The cold has become a physical weight pressing down on you.',
      'Your thoughts are fragmenting. Warmth. You need warmth.',
    ];
    return msgs[(tick / 4) % msgs.length | 0];
  }

  // slightly warm (38–39°C): every 6 ticks
  if (tempC > 38 && tempC <= 39 && tick % 6 === 0) {
    const msgs = [
      'You feel uncomfortably warm.',
      'Sweat beads on your skin.',
      'The heat is oppressive.',
      'You fan yourself uselessly.',
      'Your shirt is sticking to your back.',
      'The air feels thick and hot.',
    ];
    return msgs[(tick / 6) % msgs.length | 0];
  }

  // hot (39–41°C): every 5 ticks
  if (tempC > 39 && tempC <= 41 && tick % 5 === 0) {
    const msgs = [
      'The heat is draining you.',
      'You\'re sweating through your clothes.',
      'The heat makes it hard to breathe.',
      'Your head is starting to throb.',
      'Salt stings your eyes as sweat pours down your face.',
      'Everything smells like hot asphalt and misery.',
      'You need water — a lot of it, soon.',
    ];
    return msgs[(tick / 5) % msgs.length | 0];
  }

  // very hot (41–42°C): every 4 ticks — escalating, approaching danger
  if (tempC > 41 && tempC <= 42 && tick % 4 === 0) {
    const msgs = [
      'Your skin feels like it\'s on fire.',
      'The heat is making you dizzy.',
      'You can\'t seem to sweat fast enough.',
      'Your pulse is pounding in your temples.',
      'The world swims unpleasantly in the heat haze.',
      'You urgently need shade and water.',
    ];
    return msgs[(tick / 4) % msgs.length | 0];
  }

  // overheating (> 42°C): every 4 ticks — dangerous, HP draining
  if (tempC > 42 && tick % 4 === 0) {
    const msgs = [
      'The heat is becoming unbearable. Your organs are cooking.',
      'Heat stroke. This is what heat stroke feels like.',
      'You\'re not sweating anymore. That\'s very bad.',
      'Your vision pulses with your heartbeat. The heat is killing you.',
      'You can barely stand. The heat is consuming you.',
      'Everything is white and burning.',
      'Core temperature critical. You are dying.',
    ];
    return msgs[(tick / 4) % msgs.length | 0];
  }

  return null;
}

async function resourceTick() {
  for (const [playerId, player] of world.players) {
    if (player.sleeping) {
      const result = await tickSleep(player, broadcastFn);
      if (result) broadcastFn(null, result, null, playerId);
      continue;
    }

    // Game-minutes elapsed this real tick, per the game-speed knob (state.timeScale).
    // A fractional scale (e.g. 1.5×) is carried in _gmAccum so no partial minute is
    // ever lost between ticks. At 1× this is exactly 1 per tick — unchanged behaviour.
    const gm = (() => {
      player._gmAccum = (player._gmAccum || 0) + getTimeScale();
      const whole = Math.floor(player._gmAccum);
      player._gmAccum -= whole;
      return whole;
    })();
    player._tickCounter = (player._tickCounter || 0) + gm;
    const messages = [];
    let hpChanged = false;
    // The survival system labels its own kill: whichever hazard last dealt
    // damage this tick is what the deaths catalogue is told killed the player.
    let lethalCause = null;

    // Thirst/hunger drain one point per N GAME-minutes — accumulate the game-minutes
    // elapsed and drain whole points, so the pacing holds at any speed.
    player._thirstAccum = (player._thirstAccum || 0) + gm;
    while (player._thirstAccum >= THIRST_DECAY_INTERVAL_MIN) { player._thirstAccum -= THIRST_DECAY_INTERVAL_MIN; if (player.thirst > 0) player.thirst = Math.max(0, player.thirst - 1); }
    // Appetite suppression (the smoking plugin's `appetiteSuppressedUntil`, ms): while
    // active, hunger simply stops decaying. Plugin owns the field, engine reacts — the
    // posture pattern. No login init needed: undefined > now is false, so decay runs normally.
    const appetiteSuppressed = player.appetiteSuppressedUntil > Date.now();
    if (!appetiteSuppressed) {
      player._hungerAccum = (player._hungerAccum || 0) + gm;
      while (player._hungerAccum >= HUNGER_DECAY_INTERVAL_MIN) { player._hungerAccum -= HUNGER_DECAY_INTERVAL_MIN; if (player.hunger > 0) player.hunger = Math.max(0, player.hunger - 1); }
    }

    if (player.hunger > 0 && player.hunger <= 20) messages.push('You are very hungry.');
    if (player.thirst > 0 && player.thirst <= 20) messages.push('You are very thirsty.');

    // Starvation/dehydration are slow but genuinely lethal if ignored —
    // small, steady damage rather than a hard floor that can never kill.
    // Thirst kills faster than hunger, same as the decay pacing above.
    if (player.hunger === 0) { player.hp = Math.max(0, player.hp - 1); messages.push('Starvation is taking its toll. (-1 HP)'); hpChanged = true; lethalCause = { type: 'survival', label: 'Starvation' }; }
    if (player.thirst === 0) { player.hp = Math.max(0, player.hp - 2); messages.push('Dehydration is killing you. (-2 HP)'); hpChanged = true; lethalCause = { type: 'survival', label: 'Dehydration' }; }

    // Heal-over-time from bandages and similar items — process each active
    // application, dropping any that have finished.
    if (player.healOverTime?.length) {
      let totalHeal = 0;
      player.healOverTime = player.healOverTime.filter(hot => {
        if (player.hp >= player.hp_max) return false; // no point tracking once full
        totalHeal += hot.perTick;
        hot.ticksRemaining--;
        return hot.ticksRemaining > 0;
      });
      if (totalHeal > 0) {
        const before = player.hp;
        player.hp = Math.min(player.hp_max, player.hp + totalHeal);
        if (player.hp !== before) { hpChanged = true; }
      }
    }

    // Well-fed: natural HP regen ticks faster while food is "working."
    // Only kicks in below full HP, same logic as any other regen.
    if (player.wellFedUntil && Date.now() < player.wellFedUntil && player.hp < player.hp_max) {
      player.hp = Math.min(player.hp_max, player.hp + 2);
      hpChanged = true;
    } else if (player.wellFedUntil && Date.now() >= player.wellFedUntil) {
      player.wellFedUntil = null;
    }

    // --- Body temperature drift ---
    const prevBodyTemp = player.body_temp_c ?? 37.0;
    const zone = world.zones.get(player.current_zone);
    const tempOffset = zone?.flags?.temp_offset || 0;
    // Apparent ("feels like") temperature — folds the day's wind chill and
    // humidity into the ambient the body actually has to cope with (outdoors).
    const effectiveAmbient = getZoneApparentTemperature(player.current_zone, tempOffset);

    // Effective temperature = ambient + clothing insulation (insulation in °C offset).
    // Bare core skin (no torso/legs clothing) subtracts an exposure penalty on the
    // cold side only — nakedness bites in the cold but still vents heat when hot.
    const warmthTemp = effectiveAmbient + (player.insulation || 0) - (player.exposurePenalty || 0);
    const heatTemp   = effectiveAmbient + (player.insulation || 0);
    const playerWetness = player.wetness ?? 0;

    // Below 10°C → cooling; above 35°C → heating; in the comfort band between,
    // the body's own thermoregulation restores the 37°C setpoint.
    // Drift rate = 0.002 * |diff|^1.75 °C/min (e.g. diff=10 → 0.11°C/min; diff=20 → 0.38°C/min).
    const COLD_THRESHOLD = 10;
    const HOT_THRESHOLD = 35;
    const cooling = warmthTemp < COLD_THRESHOLD;
    const heating = heatTemp > HOT_THRESHOLD;
    // Drift rates are °C per GAME-minute, so multiply by the game-minutes elapsed
    // this tick (gm) — at 3× the core cools/warms three times as fast per real
    // minute, keeping thermal exposure proportional to the sped-up day.
    if (cooling) {
      const absDiff = COLD_THRESHOLD - warmthTemp;
      const baseDrift = 0.002 * Math.pow(absDiff, 1.75); // °C per minute
      const wetMult = 1 + (playerWetness / 100);
      player.body_temp_c = (player.body_temp_c ?? 37.0) - baseDrift * wetMult * gm;
    } else if (heating) {
      const absDiff = heatTemp - HOT_THRESHOLD;
      const baseDrift = 0.002 * Math.pow(absDiff, 1.75); // °C per minute
      const wetMult = Math.max(0.70, 1 - playerWetness * 0.003);
      player.body_temp_c = (player.body_temp_c ?? 37.0) + baseDrift * wetMult * gm;
    } else {
      // Comfort band: metabolic thermoregulation pulls core back to 37°C.
      // Exponential relaxation (~0.05/min): a 3°C deficit recovers in ~35 min —
      // enough to warm up indoors without trivializing cold exposure. Compounded
      // over gm game-minutes so it tracks the game-speed knob.
      const cur = player.body_temp_c ?? 37.0;
      const diff = 37.0 - cur;
      player.body_temp_c = Math.abs(diff) < 0.1 ? 37.0 : cur + diff * (1 - Math.pow(0.95, gm));
    }

    // Clamp to survivable range; prevents runaway values on extreme ticks.
    player.body_temp_c = Math.round(Math.max(25, Math.min(45, player.body_temp_c ?? 37.0)) * 10) / 10;

    // Temperature effects
    const tempC = player.body_temp_c;
    const isFreezing = tempC < 30;
    const isCold = tempC >= 30 && tempC < 34;
    const isOverheating = tempC > 42;
    const isHot = tempC > 40 && tempC <= 42;

    // Sustained dangerous temperature causes HP loss only after 20 minutes of
    // continuous exposure — short spells in the extreme cold/heat don't kill.
    const isDangerous = isFreezing || isOverheating;
    if (isDangerous) {
      player._dangerousTempTicks = (player._dangerousTempTicks ?? 0) + gm;
    } else {
      player._dangerousTempTicks = 0;
    }
    if (isDangerous && player._dangerousTempTicks >= 5) {
      player.hp = Math.max(0, player.hp - 10);
      hpChanged = true;
      if (isFreezing) { messages.push(`Hypothermia is damaging your body. (-10 HP) [${player.hp}/${player.hp_max ?? 100} HP]`); lethalCause = { type: 'survival', label: 'Exposure (cold)' }; }
      else { messages.push(`Heat stroke is damaging your body. (-10 HP) [${player.hp}/${player.hp_max ?? 100} HP]`); lethalCause = { type: 'survival', label: 'Exposure (heat)' }; }
    }
    // Hot/overheating: increased thirst drain
    if ((isHot || isOverheating) && Math.random() < 0.5) {
      player.thirst = Math.max(0, player.thirst - 1);
    }

    const flavorMsg = tempFlavorMessage(tempC, player._tickCounter);
    if (flavorMsg) messages.push(flavorMsg);

    // --- Ashfall breathing hazard ---
    // Outdoors during ashfall with no sealed mask → choking (drains stamina, then
    // HP). Re-applied each minute at 65-tick duration so it lapses ~5s after the
    // player masks up or gets indoors. Ash is a global weather state, not localized.
    const isIndoor = !!(zone?.flags?.is_interior || zone?.flags?.is_apartment || zone?.flags?.is_building);
    if (!isIndoor && !player.sealed) {
      let wx; try { wx = getEnvironmentState(); } catch { wx = null; }
      if (wx?.weatherType === 'ash') applyEffect(player, 'choking', 65);
    }

    // --- Stamina regen/drain ---
    const staminaMax = player.stamina_max ?? 100;
    player.stamina = player.stamina ?? staminaMax;
    if (isFreezing || isOverheating) {
      player.stamina = Math.max(0, player.stamina - 3);
    } else if (isCold || isHot) {
      player.stamina = Math.max(0, player.stamina - 1);
    } else if (player.stamina < staminaMax) {
      // Passive regen, reduced by temperature penalty
      const regen = Math.max(0, Math.floor(2 * tempRegenMultiplier(tempC)));
      if (regen > 0) player.stamina = Math.min(staminaMax, player.stamina + regen);
    }

    await query('UPDATE players SET hunger=$1,thirst=$2,hp=$3,stamina=$4,body_temp_c=$5 WHERE id=$6',
      [player.hunger, player.thirst, player.hp, player.stamina, player.body_temp_c, playerId]);

    const bodyTempChanged = player.body_temp_c !== prevBodyTemp;
    if (messages.length || bodyTempChanged) broadcastFn(null, { type:'resource_tick', messages, player_update:{hunger:player.hunger,thirst:player.thirst,hp:player.hp,stamina:player.stamina,body_temp_c:player.body_temp_c} }, null, playerId);

    if (player.hp <= 0) await handlePlayerDeath(player, null, lethalCause);

    // Bodily pressure lives in the bodily plugin; horniness decay in the MIS
    // plugin (both on their own 1m ticks).
  }
}

const SIT_REGEN_MESSAGES = [
  `You relax and feel your body knitting itself back together.`,
  `The rest does you good. Your wounds feel a little less severe.`,
  `Sitting quietly, you feel some of the damage fading.`,
  `Your body takes advantage of the pause to recover.`,
  `A moment of stillness. You feel marginally less terrible.`,
];

async function sittingRegenTick() {
  for (const [playerId, player] of world.players) {
    if (player.posture !== 'sitting') continue;
    if (player.combatTargetId || player.pvpTargetId) {
      forceStand(player, 'combat');
      continue;
    }
    if (player.hp >= player.hp_max) continue;
    const healed = Math.min(SIT_REGEN_HP, player.hp_max - player.hp);
    player.hp += healed;
    await query('UPDATE players SET hp=$1 WHERE id=$2', [player.hp, player.id]).catch(() => {});
    const msg = SIT_REGEN_MESSAGES[Math.floor(Math.random() * SIT_REGEN_MESSAGES.length)];
    broadcastFn(null, {
      type: 'resource_tick',
      messages: [`${msg} (+${healed} HP)`],
      player_update: { hp: player.hp },
    }, null, playerId);
  }
}

async function npcWanderTick() {
  const now = Date.now();
  for (const [id, npc] of world.npcs) {
    // Respawn dead NPCs at their home zone after 60s
    if (npc._dead) {
      if (npc._respawnAt && now >= npc._respawnAt) {
        npc._dead = false;
        npc._respawnAt = null;
        npc._combatTargetId = null;
        npc._lastAttack = 0;
        npc.hp = npc.hp_max ?? 20;
        const dest = npc.home_zone || npc.zone_id;
        npc.zone_id = dest;
        world.zones.get(dest)?.npcs.add(id);
        broadcastFn(dest, { type: 'zone_event', message: `${npc.name} returns.`, refresh: true });
        query('UPDATE npcs SET zone_id=$1, hp=$2 WHERE id=$3', [dest, npc.hp, id]).catch(() => {});
      }
      continue;
    }

    // Frozen while riding aboard a vehicle (e.g. a charter pilot flying a run) —
    // no AI, no wander; the plugin restores them to the world when they land.
    if (npc._aboard) continue;

    // Self-heal: legacy autonomous NPCs (vendor/employed/unemployed/actor) seeded
    // without a graph get their type default so they tick on VINE instead of the
    // dumb wander below (idempotent; skips static 'npc' extras and phantoms).
    ensureBehaviourGraph(npc, 'npc');

    if (npc.behaviour_graph?._start) {
      // Behaviour graph drives this NPC — delegate to AI runtime.
      await tickEntityAI(npc, { broadcast: broadcastFn, query }).catch(() => {});
      continue;
    }

    // Hardcoded fallback wander for NPCs without a behaviour graph.
    if (!npc.wanders) continue;
    if (npc._ai?.shopPaused) continue; // don't wander while a player is shopping
    if (Math.random() > 0.2) continue; // ~20% chance per minute → wanders roughly every 5 min
    const permitted = Array.isArray(npc.wander_zones) && npc.wander_zones.length ? npc.wander_zones : null;
    let candidates;
    if (permitted) {
      candidates = permitted.filter(z => z !== npc.zone_id);
    } else {
      const zone = world.zones.get(npc.zone_id);
      candidates = zone ? neighborZoneIds(zone) : [];
    }
    if (!candidates.length) continue;
    const dest = candidates[Math.floor(Math.random() * candidates.length)];
    // moveEntity handles the zone-set swap, door passage, and depart/arrive
    // announcements (same path as graph-driven NPCs). Returns false if blocked
    // by a locked door — only persist the new position if the move happened.
    if (moveEntity(npc, dest, broadcastFn, query)) {
      await query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [dest, id]).catch(() => {});
    }
  }
}

// Runs every 24 hours (and on devpanel force-tick). Clears all corpses,
// ground items outside rented apartments, and zone stains.
export async function dailyMaintenance() {
  // --- Corpses (player + monster) ---
  // Remove all in-memory corpses and their DB records.
  for (const [id] of world.corpses) await removeCorpse(id);
  // removeCorpse may not purge player_corpses rows; do it explicitly.
  await query(`DELETE FROM player_corpses`).catch(() => {});
  // Also wipe inventory owned by any corpse pseudo-player that removeCorpse left behind.
  await query(`DELETE FROM player_inventory WHERE player_id LIKE 'corpse_%'`).catch(() => {});

  // --- Ground items (non-apartment zones) ---
  const { rows: rented } = await query(
    `SELECT zone_id FROM apartments WHERE owner_id IS NOT NULL`
  );
  const rentedZoneIds = new Set(rented.map(r => r.zone_id));
  const { rowCount: itemsRemoved } = await query(`
    DELETE FROM player_inventory
    WHERE player_id LIKE '_ground_%'
      AND NOT (substring(player_id FROM 9) = ANY($1::text[]))
  `, [rentedZoneIds.size ? [...rentedZoneIds] : ['__none__']]);
  if (itemsRemoved > 0) console.log(`[dailyMaintenance] Removed ${itemsRemoved} ground item(s).`);

  // --- Zone stains ---
  const { rowCount: stainsCleared } = await query(`UPDATE zones SET stains='{}' WHERE stains != '{}'`);
  for (const zone of world.zones.values()) zone.stains = {};
  if (stainsCleared > 0) console.log(`[dailyMaintenance] Cleared stains from ${stainsCleared} zone(s).`);

  // --- Vendor stock restock ---
  await restockAllVendors().catch(err =>
    console.error('[dailyMaintenance] Vendor restock failed:', err.message)
  );
}

// Rent runs on the GAME calendar: due every RENT_PERIOD_DAYS *game* days, so it
// scales with the game-speed knob. Driven by the environment's day-rollover event
// (once per game-day) rather than a real-world midnight, so at 3× rent comes due
// three times as often in real time. Evicts automatically if they can't pay.
async function rentCollectionTick() {
  const today = gameToday();
  if (!today) return;

  const { rows: apts } = await query(
    // owner_type='player' excludes corp HQs — they have no rent in Phase 0
    // (and their owner_id is an org id, not a player, which the loop below assumes).
    `SELECT * FROM apartments WHERE owner_id IS NOT NULL AND owner_type = 'player'`
  );

  for (const apt of apts) {
    let due = ymd(apt.rent_due_date);
    // Lazily anchor pre-existing rentals (rented before rent_due_date existed):
    // grant a fresh full cycle from today rather than charging retroactively.
    if (!due) {
      const seeded = addGameDays(today, RENT_PERIOD_DAYS);
      await query('UPDATE apartments SET rent_due_date=$1 WHERE zone_id=$2', [seeded, apt.zone_id]).catch(() => {});
      setApartmentCache(apt.zone_id, { ...apt, rent_due_date: seeded });
      continue;
    }
    // Not due yet — today is still before the due date.
    if (gameDaysBetween(today, due) > 0) continue;

    const cost = apt.rent_cost ?? 100;
    const buildingName = apt.building_name ?? 'the building';

    // Get the zone name for the message
    const { rows: zoneRows } = await query('SELECT name FROM zones WHERE id=$1', [apt.zone_id]);
    const zoneName = zoneRows[0]?.name ?? apt.zone_id;

    // Check if player has enough credits
    const { rows: playerRows } = await query('SELECT id,credits,bank_credits,handle FROM players WHERE id=$1', [apt.owner_id]);
    if (!playerRows.length) {
      // Player deleted — release the apartment
      await releaseApartment(apt, apt.zone_id);
      continue;
    }
    const p = playerRows[0];
    const carried = p.credits || 0;
    const banked = p.bank_credits || 0;

    if (carried + banked < cost) {
      // Can't cover from the bank or on hand — evict
      await releaseApartment(apt, apt.zone_id);
      broadcastFn(null, {
        type: 'output',
        message: `<span style="color:var(--red)">EVICTION NOTICE — You couldn't cover the ${cost}c rent for <em>${zoneName}</em> in ${buildingName}. Your lease has been terminated and the unit re-listed. Next time, keep credits banked or on hand.</span>`,
      }, null, p.id);
      continue;
    }

    // Draft rent from the bank first, then carried credits for any shortfall.
    const fromBank = Math.min(banked, cost);
    const fromCarried = cost - fromBank;
    await query('UPDATE players SET bank_credits=bank_credits-$1, credits=credits-$2 WHERE id=$3', [fromBank, fromCarried, p.id]);

    // Advance the due date by whole cycles until it's back in the future. Normally
    // one cycle; the loop covers a dev date-jump that skipped several so the tenant
    // is charged once, not once per skipped game-day.
    let next = due;
    do { next = addGameDays(next, RENT_PERIOD_DAYS); } while (gameDaysBetween(today, next) <= 0);
    await query('UPDATE apartments SET rent_due_date=$1 WHERE zone_id=$2', [next, apt.zone_id]);
    setApartmentCache(apt.zone_id, { ...apt, rent_due_date: next });

    const live = getLivePlayer(p.id);
    if (live) {
      live.bank_credits = Math.max(0, (live.bank_credits || 0) - fromBank);
      live.credits = Math.max(0, (live.credits || 0) - fromCarried);
      broadcastFn(null, {
        type: 'output',
        message: `<span style="color:var(--yellow)">RENT COLLECTED — ${cost}c deducted for <em>${zoneName}</em> in ${buildingName}. Banked: ${live.bank_credits}c · On hand: ${live.credits}c.</span>`,
        player_update: { credits: live.credits, bank_credits: live.bank_credits },
      }, null, p.id);
    }
  }
}
