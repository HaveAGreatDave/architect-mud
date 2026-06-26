import { world, tickSpawns, getRandomAmbient, getWeatherAmbient, getLivePlayer, getInterruptLoudness, registerInterrupt, createCorpse } from './world.js';
import { randomUUID } from 'crypto';
import { propagateSound } from './sounds.js';
import { enemyAttackPlayer, isOnCooldown } from './combat.js';
import { tickEffects } from './effects.js';
import { resolveAttack } from './commands/index.js';
import { tickSleep, releaseApartment } from './apartments.js';
import { fireHook } from './plugins.js';
import { emit } from './events.js';
import { schedule } from './scheduler.js';
import { query } from '../models/db.js';
import { getEnvironmentState } from './environment.js';
import { tickBodily } from './bodily.js';
import { addHorniness } from './mis.js';

let broadcastFn = null;
let minuteTick = 0;

export function startGameLoop(broadcast) {
  broadcastFn = broadcast;
  setInterval(tick, 1000); // 1s combat tick stays raw — latency-critical hot path
  schedule('1m', minuteTickFn);
  schedule('45s', ambientTick);
  schedule('1m', resourceTick);
  schedule('10s', () => tickSpawns());
  schedule('30s', cleanCorpses);
  schedule('1m', rentCollectionTick);
  schedule('1m', npcWanderTick);
  schedule('24h', cleanGroundItems);
  console.log('✓ Game loop started');
}

function tick() {
  // Enemy AI
  for (const [instanceId, enemy] of world.enemies) {
    if (!enemy.targetId) {
      const zone = world.zones.get(enemy.zoneId);
      if (!zone || zone.players.size === 0) continue;
      if (enemy.behavior === 'aggressive' || enemy.behavior === 'territorial') {
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

      enemyAttackPlayer(enemy, target).then(result => {
        if (!result) return;
        if (result.hit) {
          target.hp = Math.max(0, target.hp - result.damage);
          query('UPDATE players SET hp=$1 WHERE id=$2', [target.hp, target.id]).catch(()=>{});
          broadcastFn(null, { type:'combat_incoming', message:result.message, damage:result.damage, hp:target.hp, hp_max:target.hp_max }, null, target.id);
          if (target.hp <= 0) { handlePlayerDeath(target, enemy); return; }

          // Retaliation: start attacking the attacker only if not already engaged.
          // The player auto-attack loop in tick() sustains combat from here on.
          const currentCombatEnemy = target.combatTargetId ? world.enemies.get(target.combatTargetId) : null;
          const currentTargetAlive = currentCombatEnemy && currentCombatEnemy.zoneId === target.current_zone;
          if (!currentTargetAlive) target.combatTargetId = enemy.instanceId;
        } else {
          broadcastFn(null, { type:'combat_miss', message:result.message }, null, enemy.targetId);
        }
      }).catch(() => {});
    }
  }

  // Player auto-attack: sustain combat against combatTargetId each tick
  for (const [playerId, player] of world.players) {
    if (!player.combatTargetId) continue;
    const combatEnemy = world.enemies.get(player.combatTargetId);
    if (!combatEnemy || combatEnemy.zoneId !== player.current_zone) {
      player.combatTargetId = null;
      continue;
    }
    if (!isOnCooldown(playerId, 'attack')) {
      resolveAttack(player, combatEnemy, broadcastFn)
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

  // Status effects
  for (const [playerId, player] of world.players) {
    const messages = tickEffects(player);
    if (messages.length) {
      broadcastFn(null, { type:'status_tick', messages }, null, playerId);
      if (player.hp <= 0) handlePlayerDeath(player, null);
    }
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
  }
}

export function handlePlayerDeath(player, killer) {
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
  const respawnZone = player.anchor_zone || 'zone_start';
  const deathZone = player.current_zone;

  createCorpse({
    id: `corpse_player_${player.id}_${Date.now()}`,
    name: `${player.handle}'s corpse`,
    zoneId: deathZone,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });

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
  player.combatTargetId = null;

  broadcastFn(null, {
    type:'player_death',
    message:`\n<span class="death-message">☠ ${msg}${killerMsg}</span>\n<span class="clone-vat-message">A vending-machine-shaped cloning vat hums, dispenses a fresh you, and prints a receipt nobody asked for. Everything you knew, you still know. Everything that hurt, doesn't anymore.</span>`,
    respawn_zone: respawnZone,
    player_update: { hp:player.hp, sanity:player.sanity, hunger:player.hunger, thirst:player.thirst, radiation:player.radiation, stamina:player.stamina, body_temp_c:player.body_temp_c },
  }, null, player.id);

  query('UPDATE players SET hp=$1, sanity=$2, hunger=$3, thirst=$4, radiation=$5, stamina=$6, body_temp_c=$7, clothing_contamination=$8, current_zone=anchor_zone WHERE id=$9',
    [player.hp, player.sanity, player.hunger, player.thirst, player.radiation, player.stamina, player.body_temp_c, JSON.stringify({}), player.id]).catch(()=>{});

  // Move player back to anchor in memory
  for (const [,zone] of world.zones) zone.players.delete(player.id);
  world.zones.get(respawnZone)?.players.add(player.id);
  player.current_zone = respawnZone;

  // Equip fresh underwear — fresh clone, fresh start
  const sex = player.biological_sex || 'male';
  if (sex === 'male') {
    query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot)
           SELECT $1,$2,i.id,1,1.0,1,'legs' FROM items i WHERE i.id='item_underwear_male'
           AND NOT EXISTS (SELECT 1 FROM player_inventory WHERE player_id=$2 AND item_id='item_underwear_male' AND is_equipped=1)`,
      [randomUUID(), player.id]).catch(() => {});
  } else {
    query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot)
           SELECT $1,$2,i.id,1,1.0,1,'torso' FROM items i WHERE i.id='item_underwear_female_top'
           AND NOT EXISTS (SELECT 1 FROM player_inventory WHERE player_id=$2 AND item_id='item_underwear_female_top' AND is_equipped=1)`,
      [randomUUID(), player.id]).catch(() => {});
    query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot)
           SELECT $1,$2,i.id,1,1.0,1,'legs' FROM items i WHERE i.id='item_underwear_female_bottom'
           AND NOT EXISTS (SELECT 1 FROM player_inventory WHERE player_id=$2 AND item_id='item_underwear_female_bottom' AND is_equipped=1)`,
      [randomUUID(), player.id]).catch(() => {});
  }

  fireHook('player.death', player, killer).catch(()=>{});
  emit('player.death', { player, killer });
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
  // slightly cold: every 5 ticks
  if (tempC >= 34 && tempC < 36 && tick % 5 === 0) {
    const msgs = ['You feel chilly.', 'A cold draft finds its way through your clothing.', 'You pull your clothes tighter against the chill.'];
    return msgs[tick % msgs.length];
  }
  // cold: every 5 ticks
  if (tempC >= 30 && tempC < 34 && tick % 5 === 0) {
    const msgs = ['You begin to shiver.', 'The cold is getting to you.', 'Your breath fogs in the air.', 'Your fingers are going numb.'];
    return msgs[(tick / 5) % msgs.length];
  }
  // freezing: every 5 ticks (-10 HP once sustained)
  if (tempC < 30 && tick % 5 === 0) {
    const msgs = ['You feel dangerously cold.', 'The cold is killing you.', 'You can barely feel your extremities.'];
    return msgs[(tick / 5) % msgs.length];
  }
  // slightly hot: every 6 ticks
  if (tempC > 38 && tempC <= 40 && tick % 6 === 0) {
    const msgs = ['You feel uncomfortably warm.', 'Sweat beads on your skin.', 'The heat is oppressive.'];
    return msgs[tick % msgs.length];
  }
  // hot: every 5 ticks
  if (tempC > 40 && tempC <= 42 && tick % 5 === 0) {
    const msgs = ['The heat is draining you.', 'You\'re sweating through your clothes.', 'The heat makes it hard to breathe.'];
    return msgs[(tick / 5) % msgs.length];
  }
  // overheating: every 5 ticks (-10 HP once sustained)
  if (tempC > 42 && tick % 5 === 0) {
    const msgs = ['The heat is becoming unbearable.', 'You are overheating.', 'Heat exhaustion is setting in.'];
    return msgs[(tick / 5) % msgs.length];
  }
  return null;
}

async function resourceTick() {
  for (const [playerId, player] of world.players) {
    if (player.sleeping) {
      const result = await tickSleep(player);
      if (result) broadcastFn(null, result, null, playerId);
      continue;
    }

    player._tickCounter = (player._tickCounter || 0) + 1;
    const messages = [];
    let hpChanged = false;

    if (player._tickCounter % THIRST_DECAY_INTERVAL_MIN === 0 && player.thirst > 0) player.thirst = Math.max(0, player.thirst - 1);
    if (player._tickCounter % HUNGER_DECAY_INTERVAL_MIN === 0 && player.hunger > 0) player.hunger = Math.max(0, player.hunger - 1);

    if (player.hunger > 0 && player.hunger <= 20) messages.push('You are very hungry.');
    if (player.thirst > 0 && player.thirst <= 20) messages.push('You are very thirsty.');

    // Starvation/dehydration are slow but genuinely lethal if ignored —
    // small, steady damage rather than a hard floor that can never kill.
    // Thirst kills faster than hunger, same as the decay pacing above.
    if (player.hunger === 0) { player.hp = Math.max(0, player.hp - 1); messages.push('Starvation is taking its toll. (-1 HP)'); hpChanged = true; }
    if (player.thirst === 0) { player.hp = Math.max(0, player.hp - 2); messages.push('Dehydration is killing you. (-2 HP)'); hpChanged = true; }

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
    const envState = getEnvironmentState();
    const zone = world.zones.get(player.current_zone);
    const tempOffset = zone?.flags?.temp_offset || 0;
    const rawAmbient = (envState.tempC ?? 18) + tempOffset;
    // Interior zones are climate-controlled — clamp to a temperate range.
    const effectiveAmbient = zone?.flags?.is_interior
      ? Math.max(15, Math.min(25, rawAmbient))
      : rawAmbient;

    // Effective temperature = ambient + clothing insulation (insulation in °C offset).
    const effectiveTemp = effectiveAmbient + (player.insulation || 0);
    const playerWetness = player.wetness ?? 0;
    const DELTA_TIME = 60; // seconds per tick

    // Body temp drifts toward zone temperature. Neutral point is 20°C for a
    // naked player — no drift at 20°C, increasing rate as you deviate further.
    // Rate = 0.001 * |diff|^1.5 °C/min, so each 10°C step meaningfully
    // accelerates change (e.g. diff=10 → 0.032°C/min; diff=30 → 0.164°C/min).
    const NEUTRAL_TEMP = 20;
    const tempDrift = effectiveTemp - NEUTRAL_TEMP;
    if (tempDrift !== 0) {
      const absDiff = Math.abs(tempDrift);
      const baseDrift = 0.001 * Math.pow(absDiff, 1.5); // °C per minute
      if (tempDrift < 0) {
        // Cooling — wet clothing accelerates heat loss
        const wetMult = 1 + (playerWetness / 100);
        player.body_temp_c = (player.body_temp_c ?? 37.0) - baseDrift * wetMult;
      } else {
        // Heating — wet clothing slows heat gain via evaporative cooling
        const wetMult = Math.max(0.70, 1 - playerWetness * 0.003);
        player.body_temp_c = (player.body_temp_c ?? 37.0) + baseDrift * wetMult;
      }
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
      player._dangerousTempTicks = (player._dangerousTempTicks ?? 0) + 1;
    } else {
      player._dangerousTempTicks = 0;
    }
    if (isDangerous && player._dangerousTempTicks >= 20) {
      player.hp = Math.max(0, player.hp - 10);
      hpChanged = true;
    }
    // Hot/overheating: increased thirst drain
    if ((isHot || isOverheating) && Math.random() < 0.5) {
      player.thirst = Math.max(0, player.thirst - 1);
    }

    const flavorMsg = tempFlavorMessage(tempC, player._tickCounter);
    if (flavorMsg) messages.push(flavorMsg);

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

    if (messages.length) broadcastFn(null, { type:'resource_tick', messages, player_update:{hunger:player.hunger,thirst:player.thirst,hp:player.hp,stamina:player.stamina,body_temp_c:player.body_temp_c} }, null, playerId);

    if (player.hp <= 0) handlePlayerDeath(player, null);

    // Bodily pressure tick
    const bodilyMsgs = await tickBodily(player, broadcastFn);
    if (bodilyMsgs.length) broadcastFn(null, { type:'resource_tick', messages: bodilyMsgs }, null, playerId);

    // Horniness decay — only starts 5 minutes after last increase
    if ((player.horniness || 0) > 0) {
      const lastIncrease = player.horniness_last_increased || 0;
      const decayDelayMs = 5 * 60 * 1000;
      if (!lastIncrease || (Date.now() - lastIncrease) >= decayDelayMs) {
        player.horniness = Math.max(0, player.horniness - 1);
        await query('UPDATE players SET horniness=$1 WHERE id=$2', [player.horniness, playerId]);
        broadcastFn(null, { type:'resource_tick', messages: [], player_update: { horniness: player.horniness, mis_enabled: player.mis_enabled } }, null, playerId);
      }
    }
  }
}

async function npcWanderTick() {
  for (const [id, npc] of world.npcs) {
    if (!npc.wanders) continue;
    if (Math.random() > 0.2) continue; // ~20% chance per minute → wanders roughly every 5 min
    const permitted = Array.isArray(npc.wander_zones) && npc.wander_zones.length ? npc.wander_zones : null;
    let candidates;
    if (permitted) {
      candidates = permitted.filter(z => z !== npc.zone_id);
    } else {
      const zone = world.zones.get(npc.zone_id);
      candidates = zone ? Object.values(zone.exits || {}) : [];
    }
    if (!candidates.length) continue;
    const dest = candidates[Math.floor(Math.random() * candidates.length)];
    // Update zone NPC sets
    world.zones.get(npc.zone_id)?.npcs.delete(id);
    npc.zone_id = dest;
    world.zones.get(dest)?.npcs.add(id);
    await query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [dest, id]).catch(() => {});
  }
}

function cleanCorpses() {
  const now = Date.now();
  for (const [id, corpse] of world.corpses) {
    if (corpse.expiresAt < now) {
      world.zones.get(corpse.zoneId)?.corpses.delete(id);
      world.corpses.delete(id);
    }
  }
}

// Runs every 24 hours. Deletes items left on the ground in non-apartment zones
// (or unrented apartment zones). Rented apartments keep their floor items.
async function cleanGroundItems() {
  // Get all rented apartment zone IDs so we can exempt them.
  const { rows: rented } = await query(
    `SELECT zone_id FROM apartments WHERE owner_id IS NOT NULL`
  );
  const rentedZoneIds = new Set(rented.map(r => r.zone_id));

  // player_id for ground items is '_ground_<zone_id>'.
  // Delete any ground items whose zone is not a rented apartment.
  const { rowCount } = await query(`
    DELETE FROM player_inventory
    WHERE player_id LIKE '_ground_%'
      AND NOT (substring(player_id FROM 9) = ANY($1::text[]))
  `, [rentedZoneIds.size ? [...rentedZoneIds] : ['__none__']]);

  if (rowCount > 0) console.log(`[cleanGroundItems] Removed ${rowCount} ground item(s).`);
}

// Runs every real-world minute. Collects weekly rent from apartment owners
// on the same day-of-month they first rented (or +7 days, clamped to the
// same month/year). Evicts automatically if they can't pay.
async function rentCollectionTick() {
  const now = new Date();
  const todayDay   = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear  = now.getFullYear();
  const todayHour  = now.getHours();
  const todayMin   = now.getMinutes();

  // Only fire once per day, at midnight (00:00).
  if (todayHour !== 0 || todayMin !== 0) return;

  const { rows: apts } = await query(
    `SELECT * FROM apartments WHERE owner_id IS NOT NULL AND date_rented IS NOT NULL`
  );

  for (const apt of apts) {
    const rented = new Date(apt.date_rented * 1000);
    const rentedDay   = rented.getDate();
    const rentedMonth = rented.getMonth();
    const rentedYear  = rented.getFullYear();

    // Due on the same calendar day-of-month as when rented, 7 days later.
    // Only collect if we're in the same month+year and the day matches day+7,
    // or if the rent date was in a prior month and today's day matches.
    const daysDiff = Math.round((now - rented) / (1000 * 60 * 60 * 24));
    if (daysDiff === 0 || daysDiff % 7 !== 0) continue;

    const cost = apt.rent_cost ?? 100;
    const roomName     = apt.zone_id;   // will be replaced by zone name below
    const buildingName = apt.building_name ?? 'the building';

    // Get the zone name for the message
    const { rows: zoneRows } = await query('SELECT name FROM zones WHERE id=$1', [apt.zone_id]);
    const zoneName = zoneRows[0]?.name ?? apt.zone_id;

    // Check if player has enough credits
    const { rows: playerRows } = await query('SELECT id,credits,handle FROM players WHERE id=$1', [apt.owner_id]);
    if (!playerRows.length) {
      // Player deleted — release the apartment
      await releaseApartment(apt, apt.zone_id);
      continue;
    }
    const p = playerRows[0];

    if (p.credits < cost) {
      // Can't pay — evict
      await releaseApartment(apt, apt.zone_id);
      broadcastFn(null, {
        type: 'output',
        message: `<span style="color:var(--red)">EVICTION NOTICE — You couldn't cover the ${cost}c weekly rent for <em>${zoneName}</em> in ${buildingName}. Your lease has been terminated and the unit re-listed. Next time, keep some credits on hand.</span>`,
      }, null, p.id);
      continue;
    }

    // Deduct rent
    await query('UPDATE players SET credits=credits-$1 WHERE id=$2', [cost, p.id]);
    const live = getLivePlayer(p.id);
    if (live) {
      live.credits = Math.max(0, live.credits - cost);
      broadcastFn(null, {
        type: 'output',
        message: `<span style="color:var(--yellow)">RENT COLLECTED — ${cost}c deducted for <em>${zoneName}</em> in ${buildingName}. Remaining credits: ${live.credits}c.</span>`,
        player_update: { credits: live.credits },
      }, null, p.id);
    }
  }
}
