import { world, tickSpawns, getRandomAmbient, getZoneEnemies, getLivePlayer } from './world.js';
import { enemyAttackPlayer, tickStatuses } from './combat.js';
import { getDb } from '../models/migrate.js';

let broadcastFn = null;
let tickInterval = null;

export function startGameLoop(broadcast) {
  broadcastFn = broadcast;
  tickInterval = setInterval(tick, 1000);
  setInterval(ambientTick, 45000);
  setInterval(resourceTick, 60000);
  setInterval(tickSpawns, 10000);
  setInterval(cleanCorpses, 30000);
  console.log('✓ Game loop started');
}

function tick() {
  // Enemy AI — attack players in same zone
  for (const [instanceId, enemy] of world.enemies) {
    if (!enemy.targetId) {
      // Scan for players in zone
      const zone = world.zones.get(enemy.zoneId);
      if (!zone || zone.players.size === 0) continue;
      if (enemy.behavior === 'aggressive' || enemy.behavior === 'territorial') {
        const targetId = [...zone.players][Math.floor(Math.random() * zone.players.size)];
        enemy.targetId = targetId;
      }
    }

    if (enemy.targetId) {
      const target = getLivePlayer(enemy.targetId);
      if (!target || target.current_zone !== enemy.zoneId) {
        enemy.targetId = null;
        continue;
      }

      const result = enemyAttackPlayer(enemy, target);
      if (!result) continue;

      if (result.hit) {
        target.hp = Math.max(0, target.hp - result.damage);

        const db = getDb();
        db.prepare('UPDATE players SET hp = ? WHERE id = ?').run(target.hp, target.id);
        db.close();

        broadcastFn(null, {
          type: 'combat_incoming',
          message: result.message,
          damage: result.damage,
          hp: target.hp,
          hp_max: target.hp_max,
        }, null, target.id);

        if (target.hp <= 0) {
          handlePlayerDeath(target, enemy);
        }
      } else {
        broadcastFn(null, {
          type: 'combat_miss',
          message: result.message,
        }, null, target.id);
      }
    }
  }

  // Tick player statuses
  for (const [playerId, player] of world.players) {
    const messages = tickStatuses(player);
    if (messages.length) {
      broadcastFn(null, { type: 'status_tick', messages }, null, playerId);
      if (player.hp <= 0) handlePlayerDeath(player, null);
    }
  }
}

function handlePlayerDeath(player, killer) {
  const deathMessages = [
    "You die. Statistically speaking, this was inevitable.",
    "You die. The world continues without you, which feels rude.",
    "You die. Someone, somewhere, does not notice.",
    "Death arrives. You were not ready, but death has a schedule.",
    "You are dead. The Architect notes this. The Architect does not care.",
    "You die in a way that will be described differently by everyone who witnessed it.",
  ];

  const msg = deathMessages[Math.floor(Math.random() * deathMessages.length)];
  const killerMsg = killer ? ` Killed by: ${killer.name}.` : '';

  broadcastFn(null, {
    type: 'player_death',
    message: `\n<span class="death-message">☠ ${msg}${killerMsg}</span>`,
    respawn_zone: player.anchor_zone || 'zone_start',
  }, null, player.id);

  // Reset player
  const db = getDb();
  db.prepare(`
    UPDATE players SET hp = 10, current_zone = anchor_zone, radiation = MAX(0, radiation - 10)
    WHERE id = ?
  `).run(player.id);
  db.close();

  player.hp = 10;
  player.current_zone = player.anchor_zone || 'zone_start';

  // Remove from current zone, add to anchor
  for (const [zoneId, zone] of world.zones) {
    zone.players.delete(player.id);
  }
  const anchorZone = world.zones.get(player.anchor_zone || 'zone_start');
  if (anchorZone) anchorZone.players.add(player.id);
}

function ambientTick() {
  // Fire ambient events for zones with players
  for (const [zoneId, zone] of world.zones) {
    if (zone.players.size === 0) continue;
    if (Math.random() < 0.4) {
      const ambient = getRandomAmbient(zoneId);
      if (ambient) {
        broadcastFn(zoneId, {
          type: 'ambient',
          message: `<span class="ambient">${ambient}</span>`,
        });
      }
    }
  }
}

function resourceTick() {
  // Drain hunger/thirst slowly
  const db = getDb();
  for (const [playerId, player] of world.players) {
    player.hunger = Math.max(0, player.hunger - 2);
    player.thirst = Math.max(0, player.thirst - 3);

    const messages = [];
    if (player.hunger < 20) messages.push('You are very hungry.');
    if (player.thirst < 20) messages.push('You are very thirsty.');

    if (player.hunger === 0) {
      player.hp = Math.max(1, player.hp - 3);
      messages.push('Starvation is taking its toll. (-3 HP)');
    }
    if (player.thirst === 0) {
      player.hp = Math.max(1, player.hp - 5);
      messages.push('Dehydration is killing you. (-5 HP)');
    }

    db.prepare('UPDATE players SET hunger = ?, thirst = ?, hp = ? WHERE id = ?')
      .run(player.hunger, player.thirst, player.hp, playerId);

    if (messages.length) {
      broadcastFn(null, {
        type: 'resource_tick',
        messages,
        player_update: { hunger: player.hunger, thirst: player.thirst, hp: player.hp },
      }, null, playerId);
    }
  }
  db.close();
}

function cleanCorpses() {
  const now = Date.now();
  for (const [id, corpse] of world.corpses) {
    if (corpse.expiresAt < now) {
      const zone = world.zones.get(corpse.zoneId);
      if (zone) zone.corpses.delete(id);
      world.corpses.delete(id);
    }
  }
}

export function stopGameLoop() {
  if (tickInterval) clearInterval(tickInterval);
}
