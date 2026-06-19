import { world, tickSpawns, getRandomAmbient, getLivePlayer } from './world.js';
import { enemyAttackPlayer, tickStatuses } from './combat.js';
import { checkMutationTrigger } from './mutations.js';
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
      }
    }
    if (enemy.targetId) {
      const target = getLivePlayer(enemy.targetId);
      if (!target || target.current_zone !== enemy.zoneId) { enemy.targetId = null; continue; }
      const result = enemyAttackPlayer(enemy, target);
      if (!result) continue;
      if (result.hit) {
        target.hp = Math.max(0, target.hp - result.damage);
        query('UPDATE players SET hp=$1 WHERE id=$2', [target.hp, target.id]).catch(()=>{});
        broadcastFn(null, { type:'combat_incoming', message:result.message, damage:result.damage, hp:target.hp, hp_max:target.hp_max }, null, target.id);
        if (target.hp <= 0) handlePlayerDeath(target, enemy);
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
    // Radiation decay: -1 per minute naturally
    if ((player.radiation || 0) > 0) {
      player.radiation = Math.max(0, player.radiation - 1);
      await query('UPDATE players SET radiation=$1 WHERE id=$2', [player.radiation, playerId]);
      if (player.radiation % 10 === 0 && player.radiation > 0) {
        broadcastFn(null, { type:'player_update', radiation: player.radiation }, null, playerId);
      }
    }
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

  broadcastFn(null, {
    type:'player_death',
    message:`\n<span class="death-message">☠ ${msg}${killerMsg}</span>`,
    respawn_zone: player.anchor_zone || 'zone_start',
  }, null, player.id);

  query('UPDATE players SET hp=10, current_zone=anchor_zone WHERE id=$1', [player.id]).catch(()=>{});
  player.hp = 10;

  // Move player back to anchor in memory
  for (const [,zone] of world.zones) zone.players.delete(player.id);
  world.zones.get(player.anchor_zone || 'zone_start')?.players.add(player.id);
  player.current_zone = player.anchor_zone || 'zone_start';

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

async function resourceTick() {
  for (const [playerId, player] of world.players) {
    player.hunger = Math.max(0, player.hunger - 2);
    player.thirst = Math.max(0, player.thirst - 3);
    const messages = [];
    if (player.hunger < 20) messages.push('You are very hungry.');
    if (player.thirst < 20) messages.push('You are very thirsty.');
    if (player.hunger === 0) { player.hp = Math.max(1, player.hp - 3); messages.push('Starvation is taking its toll. (-3 HP)'); }
    if (player.thirst === 0) { player.hp = Math.max(1, player.hp - 5); messages.push('Dehydration is killing you. (-5 HP)'); }
    await query('UPDATE players SET hunger=$1,thirst=$2,hp=$3 WHERE id=$4', [player.hunger,player.thirst,player.hp,playerId]);
    if (messages.length) broadcastFn(null, { type:'resource_tick', messages, player_update:{hunger:player.hunger,thirst:player.thirst,hp:player.hp} }, null, playerId);
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
