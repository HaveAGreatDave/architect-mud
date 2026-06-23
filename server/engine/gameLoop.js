import { world, tickSpawns, getRandomAmbient, getWeatherAmbient, getLivePlayer, getInterruptLoudness, registerInterrupt, createCorpse } from './world.js';
import { propagateSound } from './sounds.js';
import { enemyAttackPlayer, isOnCooldown } from './combat.js';
import { tickEffects } from './effects.js';
import { resolveAttack } from './commands/index.js';
import { tickSleep } from './apartments.js';
import { fireHook } from './plugins.js';
import { schedule } from './scheduler.js';
import { query } from '../models/db.js';
import { getEnvironmentState } from './environment.js';

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

          // Auto-retaliate: fight back rather than standing there. Stick to the
          // target we're already fighting — a second attacker doesn't pull our
          // focus. Only engage this attacker if we have no current target.
          if (!isOnCooldown(target.id, 'attack')) {
            let retaliateTarget = enemy;
            const current = target.combatTargetId ? world.enemies.get(target.combatTargetId) : null;
            if (current && current.zoneId === target.current_zone) retaliateTarget = current;
            resolveAttack(target, retaliateTarget, broadcastFn)
              .then(atkResult => {
                if (atkResult?.type === 'combat') {
                  broadcastFn(null, { ...atkResult, auto:true }, null, target.id);
                }
              })
              .catch(() => {});
          }
        } else {
          broadcastFn(null, { type:'combat_miss', message:result.message }, null, enemy.targetId);
        }
      }).catch(() => {});
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
  player.sleeping = null;

  broadcastFn(null, {
    type:'player_death',
    message:`\n<span class="death-message">☠ ${msg}${killerMsg}</span>\n<span class="clone-vat-message">A vending-machine-shaped cloning vat hums, dispenses a fresh you, and prints a receipt nobody asked for. Everything you knew, you still know. Everything that hurt, doesn't anymore.</span>`,
    respawn_zone: respawnZone,
    player_update: { hp:player.hp, sanity:player.sanity, hunger:player.hunger, thirst:player.thirst, radiation:player.radiation, stamina:player.stamina, body_temp_c:player.body_temp_c },
  }, null, player.id);

  query('UPDATE players SET hp=$1, sanity=$2, hunger=$3, thirst=$4, radiation=$5, stamina=$6, body_temp_c=$7, current_zone=anchor_zone WHERE id=$8',
    [player.hp, player.sanity, player.hunger, player.thirst, player.radiation, player.stamina, player.body_temp_c, player.id]).catch(()=>{});

  // Move player back to anchor in memory
  for (const [,zone] of world.zones) zone.players.delete(player.id);
  world.zones.get(respawnZone)?.players.add(player.id);
  player.current_zone = respawnZone;

  // Fire hook
  fireHook('player.death', player, killer).catch(()=>{});
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
  // cold: every 4 ticks
  if (tempC >= 30 && tempC < 34 && tick % 4 === 0) {
    const msgs = ['You begin to shiver.', 'The cold is getting to you.', 'Your breath fogs in the air.', 'Your fingers are going numb.'];
    return msgs[tick % msgs.length];
  }
  // freezing: every 3 ticks
  if (tempC < 30 && tick % 3 === 0) {
    const msgs = ['You feel dangerously cold. (-1 HP)', 'The cold is killing you. (-1 HP)', 'You can barely feel your extremities. (-1 HP)'];
    return msgs[tick % msgs.length];
  }
  // slightly hot: every 6 ticks
  if (tempC > 38 && tempC <= 40 && tick % 6 === 0) {
    const msgs = ['You feel uncomfortably warm.', 'Sweat beads on your skin.', 'The heat is oppressive.'];
    return msgs[tick % msgs.length];
  }
  // hot: every 4 ticks
  if (tempC > 40 && tempC <= 42 && tick % 4 === 0) {
    const msgs = ['The heat is draining you.', 'You\'re sweating through your clothes.', 'The heat makes it hard to breathe.'];
    return msgs[tick % msgs.length];
  }
  // overheating: every 3 ticks
  if (tempC > 42 && tick % 3 === 0) {
    const msgs = ['The desert heat is becoming unbearable. (-1 HP)', 'You are overheating. (-1 HP)', 'Heat exhaustion sets in. (-1 HP)'];
    return msgs[tick % msgs.length];
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
    const insulation = player.insulation || 0;
    // Drift rate: 0.5°C/tick at insulation=0, down to ~0.05 at insulation=180+
    const driftRate = Math.max(0.05, 0.5 * (1 - insulation / 200));
    const delta = effectiveAmbient - (player.body_temp_c ?? 37.0);
    player.body_temp_c = Math.round(((player.body_temp_c ?? 37.0) + Math.sign(delta) * Math.min(Math.abs(delta), driftRate)) * 10) / 10;

    // Temperature effects
    const tempC = player.body_temp_c;
    const isFreezing = tempC < 30;
    const isOverheating = tempC > 42;
    const isHot = tempC > 40 && tempC <= 42;

    if (isFreezing || isOverheating) {
      player.hp = Math.max(0, player.hp - 1);
      hpChanged = true;
    }
    // Hot: increased thirst drain (50% extra chance each tick)
    if (isHot && Math.random() < 0.5) {
      player.thirst = Math.max(0, player.thirst - 1);
    }

    const flavorMsg = tempFlavorMessage(tempC, player._tickCounter);
    if (flavorMsg) messages.push(flavorMsg);

    // --- Stamina regen/drain ---
    const staminaMax = player.stamina_max ?? 100;
    player.stamina = player.stamina ?? staminaMax;
    if (isFreezing || isOverheating) {
      // Extreme temps drain stamina
      player.stamina = Math.max(0, player.stamina - 2);
    } else if (player.stamina < staminaMax) {
      // Passive regen, reduced by temperature penalty
      const regen = Math.max(0, Math.floor(2 * tempRegenMultiplier(tempC)));
      if (regen > 0) player.stamina = Math.min(staminaMax, player.stamina + regen);
    }

    await query('UPDATE players SET hunger=$1,thirst=$2,hp=$3,stamina=$4,body_temp_c=$5 WHERE id=$6',
      [player.hunger, player.thirst, player.hp, player.stamina, player.body_temp_c, playerId]);

    if (messages.length) broadcastFn(null, { type:'resource_tick', messages, player_update:{hunger:player.hunger,thirst:player.thirst,hp:player.hp,stamina:player.stamina,body_temp_c:player.body_temp_c} }, null, playerId);

    if (player.hp <= 0) handlePlayerDeath(player, null);
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
