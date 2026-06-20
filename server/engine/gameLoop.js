import { world, tickSpawns, getRandomAmbient, getLivePlayer } from './world.js';
import { enemyAttackPlayer, tickStatuses, isOnCooldown } from './combat.js';
import { resolveAttack } from './commands.js';
import { checkMutationTrigger } from './mutations.js';
import { tickSleep } from './apartments.js';
import { fireHook } from './plugins.js';
import { query } from '../models/db.js';

let broadcastFn = null;
let minuteTick = 0;

export function startGameLoop(broadcast) {
  broadcastFn = broadcast;
  setInterval(tick, 1000);
  setInterval(minuteTickFn, 60000);
  setInterval(ambientTick, 45000);
  setInterval(resourceTick, 60000);
  setInterval(() => tickSpawns().catch(console.error), 10000);
  setInterval(cleanCorpses, 30000);
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

      const result = enemyAttackPlayer(enemy, target);
      if (!result) continue;
      if (result.hit) {
        target.hp = Math.max(0, target.hp - result.damage);
        query('UPDATE players SET hp=$1 WHERE id=$2', [target.hp, target.id]).catch(()=>{});
        broadcastFn(null, { type:'combat_incoming', message:result.message, damage:result.damage, hp:target.hp, hp_max:target.hp_max }, null, target.id);
        if (target.hp <= 0) { handlePlayerDeath(target, enemy); continue; }

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
    }
  }

  // Status effects + mutation checks
  for (const [playerId, player] of world.players) {
    const messages = tickStatuses(player);
    if (messages.length) {
      broadcastFn(null, { type:'status_tick', messages }, null, playerId);
      if (player.hp <= 0) handlePlayerDeath(player, null);
    }
  }
}

async function minuteTickFn() {
  minuteTick++;
  // Fire plugin minute hook
  await fireHook('tick.minute');

  // Check mutations for all online players
  for (const [playerId, player] of world.players) {
    if ((player.radiation || 0) >= 40) {
      const mutation = await checkMutationTrigger(player);
      if (mutation) {
        broadcastFn(null, {
          type: 'mutation_gained',
          message: `\n<span class="rad-warning">⚠ MUTATION: ${mutation.name}</span>\n${mutation.description}\n${mutation.drawbacks?.length ? `Drawbacks: ${mutation.drawbacks.join(', ')}` : ''}`,
        }, null, playerId);
      }
    }
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

function handlePlayerDeath(player, killer) {
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

  // Full restore on respawn — you come out of the vat whole, not wounded.
  // Skills/rank/xp live in a separate table untouched by any of this, so
  // everything learned carries over; only the body resets.
  player.hp = player.hp_max;
  player.sanity = player.sanity_max;
  player.hunger = 100;
  player.thirst = 100;
  player.radiation = 0;
  player.sleeping = null;

  broadcastFn(null, {
    type:'player_death',
    message:`\n<span class="death-message">☠ ${msg}${killerMsg}</span>\n<span class="clone-vat-message">A vending-machine-shaped cloning vat hums, dispenses a fresh you, and prints a receipt nobody asked for. Everything you knew, you still know. Everything that hurt, doesn't anymore.</span>`,
    respawn_zone: respawnZone,
    player_update: { hp:player.hp, sanity:player.sanity, hunger:player.hunger, thirst:player.thirst, radiation:player.radiation },
  }, null, player.id);

  query('UPDATE players SET hp=$1, sanity=$2, hunger=$3, thirst=$4, radiation=$5, current_zone=anchor_zone WHERE id=$6',
    [player.hp, player.sanity, player.hunger, player.thirst, player.radiation, player.id]).catch(()=>{});

  // Move player back to anchor in memory
  for (const [,zone] of world.zones) zone.players.delete(player.id);
  world.zones.get(respawnZone)?.players.add(player.id);
  player.current_zone = respawnZone;

  // Fire hook
  fireHook('player.death', player, killer).catch(()=>{});
}

async function ambientTick() {
  for (const [zoneId, zone] of world.zones) {
    if (zone.players.size === 0 || Math.random() > 0.4) continue;
    // Try plugin hook first, fall back to zone ambients
    const pluginAmbient = await fireHook('zone.describeAmbient', zone);
    const ambient = pluginAmbient || getRandomAmbient(zoneId);
    if (ambient) broadcastFn(zoneId, { type:'ambient', message:`<span class="ambient">${ambient}</span>` });
  }
}

// Hunger and thirst decay by 1 point every N minutes of being awake — at
// 60s real-time ticks, this is what actually makes "several hours to
// become fatal" true, rather than depleting from 100 inside one hour.
// Thirst depletes faster than hunger, matching real survival pacing and
// the brief's explicit ordering.
const THIRST_DECAY_INTERVAL_MIN = 3;  // 1 point per 3 min → 100 pts / 5 hours
const HUNGER_DECAY_INTERVAL_MIN = 4;  // 1 point per 4 min → 100 pts / ~6.7 hours

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

    if (hpChanged) await query('UPDATE players SET hunger=$1,thirst=$2,hp=$3 WHERE id=$4', [player.hunger,player.thirst,player.hp,playerId]);
    else await query('UPDATE players SET hunger=$1,thirst=$2 WHERE id=$3', [player.hunger,player.thirst,playerId]);

    if (messages.length) broadcastFn(null, { type:'resource_tick', messages, player_update:{hunger:player.hunger,thirst:player.thirst,hp:player.hp} }, null, playerId);

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
