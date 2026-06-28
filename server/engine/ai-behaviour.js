import { world, getLivePlayer } from './world.js';
import { findPath, getZonesInRadius } from './pathfinding.js';
import { enemyAttackPlayer } from './combat.js';
import { getEnvironmentState } from './environment.js';

// ── Blackboard ────────────────────────────────────────────────────────────────

export function initBlackboard() {
  return {
    currentNode:  null,  // persistent execution cursor — resume point for next tick
    waitUntil:    null,  // timestamp — WAIT node suspend
    patrolTarget: null,  // zone_id currently walking toward
    patrolPath:   [],    // remaining BFS path steps
    patrolMode:   'walk',
    patrolIndex:  0,     // index into PATROL.waypoints
    alertCooldown: 0,    // timestamp — CALL_BACKUP debounce
    lastSay:      0,     // timestamp — SAY debounce
    flags:        {},    // SET_FLAG scope:self values
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function entityZone(entity) {
  return entity.zoneId ?? entity.zone_id;
}

function isEnemy(entity) {
  return entity.instanceId != null;
}

function moveEntity(entity, newZoneId, broadcast) {
  const oldZoneId = entityZone(entity);
  if (oldZoneId === newZoneId) return;

  if (isEnemy(entity)) {
    world.zones.get(oldZoneId)?.enemies.delete(entity.instanceId);
    entity.zoneId = newZoneId;
    world.zones.get(newZoneId)?.enemies.add(entity.instanceId);
    // Broadcast arrival so players can see the entity
    broadcast(newZoneId, { type: 'zone_event', message: `${entity.name} arrives.`, refresh: true });
    broadcast(oldZoneId, { type: 'zone_event', message: `${entity.name} leaves.`, refresh: true });
  } else {
    world.zones.get(oldZoneId)?.npcs.delete(entity.id);
    entity.zone_id = newZoneId;
    world.zones.get(newZoneId)?.npcs.add(entity.id);
  }
}

// Resolve an edge from a node (looks up fromNode+fromPort in edges array).
function resolveEdge(edges, fromNode, fromPort) {
  return edges.find(e => e.fromNode === fromNode && e.fromPort === fromPort)?.toNode || null;
}

// ── Condition evaluation ──────────────────────────────────────────────────────

function evalCondition(node, entity) {
  const { condition_type: type, params = {} } = node.data;
  const zoneId = entityZone(entity);
  const zone = world.zones.get(zoneId);

  switch (type) {
    case 'HAS_TARGET':
      return !!entity.targetId;

    case 'HP_BELOW':
      return (entity.hp / entity.hp_max) * 100 < (params.pct ?? 30);

    case 'HP_ABOVE':
      return (entity.hp / entity.hp_max) * 100 > (params.pct ?? 70);

    case 'IN_ZONE':
      return zoneId === params.zone_id;

    case 'PLAYER_IN_ZONE':
      return (zone?.players.size ?? 0) >= (params.min ?? 1);

    case 'TARGET_HP_BELOW': {
      const target = getLivePlayer(entity.targetId);
      if (!target) return false;
      return (target.hp / target.hp_max) * 100 < (params.pct ?? 30);
    }

    case 'FACTION_MATCH': {
      const target = getLivePlayer(entity.targetId);
      if (!target) return false;
      return target.faction === params.faction;
    }

    case 'FLAG_SET':
      if (params.scope === 'self') return !!entity._ai?.flags?.[params.flag];
      // world flag — checked via world_flags table; use blackboard as fallback
      return !!entity._ai?.flags?.[params.flag];

    case 'RANDOM_CHANCE':
      return Math.random() < (params.chance ?? 0.5);

    case 'IS_DAYTIME': {
      const { timePhase } = getEnvironmentState();
      return timePhase === 'day' || timePhase === 'dawn' || timePhase === 'dusk';
    }

    default:
      return false;
  }
}

// ── Action execution ──────────────────────────────────────────────────────────

async function execAction(node, entity, ctx) {
  const { broadcast, query } = ctx;
  const { action_type: type, params = {} } = node.data;
  const ai = entity._ai;
  const zoneId = entityZone(entity);
  const zone = world.zones.get(zoneId);

  switch (type) {
    case 'ATTACK': {
      if (!entity.targetId) break;
      const target = getLivePlayer(entity.targetId);
      if (!target || target.current_zone !== zoneId) {
        entity.targetId = null;
        if (ai) ai.patrolPath = [];
        break;
      }
      const firstStrikeDelay = entity.flags?.first_strike_delay_ms || 0;
      if (firstStrikeDelay > 0 && entity.lastAttack === 0) {
        const elapsed = Date.now() - (entity.aggroedAt || Date.now());
        if (elapsed < firstStrikeDelay) break;
      }
      enemyAttackPlayer(entity, target).then(async result => {
        if (!result) return;
        if (result.hit) {
          target.hp = Math.max(0, target.hp - result.damage);
          query('UPDATE players SET hp=$1 WHERE id=$2', [target.hp, target.id]).catch(() => {});
          broadcast(null, { type: 'combat_incoming', message: result.message, damage: result.damage, hp: target.hp, hp_max: target.hp_max }, null, target.id);
          if (target.hp <= 0) {
            const { handlePlayerDeath } = await import('./gameLoop.js');
            await handlePlayerDeath(target, entity);
          } else {
            if (!target.combatTargetId) target.combatTargetId = entity.instanceId;
          }
        } else {
          broadcast(null, { type: 'combat_miss', message: result.message }, null, entity.targetId);
        }
      }).catch(() => {});
      break;
    }

    case 'ACQUIRE_TARGET': {
      if (!zone || zone.players.size === 0) break;
      const players = [...zone.players].map(id => getLivePlayer(id)).filter(Boolean);
      if (!players.length) break;
      if (params.prefer === 'lowest_hp') {
        players.sort((a, b) => a.hp - b.hp);
        entity.targetId = players[0].id;
      } else {
        entity.targetId = players[Math.floor(Math.random() * players.length)].id;
      }
      entity.aggroedAt = Date.now();
      break;
    }

    case 'DROP_TARGET':
      entity.targetId = null;
      entity.aggroedAt = null;
      if (ai) { ai.patrolPath = []; ai.patrolTarget = null; }
      break;

    case 'PATROL': {
      if (!ai) break;
      const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
      if (!waypoints.length) break;

      const loop = params.loop !== false;
      const mode = params.mode || 'walk';

      // Advance waypoint index if we've arrived at the current target
      if (ai.patrolTarget && zoneId === ai.patrolTarget) {
        ai.patrolPath = [];
        ai.patrolTarget = null;
        if (loop) {
          ai.patrolIndex = (ai.patrolIndex + 1) % waypoints.length;
        } else {
          ai.patrolIndex = Math.min(ai.patrolIndex + 1, waypoints.length - 1);
        }
      }

      const target = waypoints[ai.patrolIndex % waypoints.length];
      if (!target || zoneId === target) break;

      if (mode === 'teleport') {
        moveEntity(entity, target, broadcast);
        ai.patrolTarget = null;
        ai.patrolPath = [];
        if (isEnemy(entity) === false && query) {
          query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [target, entity.id]).catch(() => {});
        }
        break;
      }

      // Walk mode: BFS path, step one zone per tick
      if (!ai.patrolPath.length || ai.patrolTarget !== target) {
        const path = findPath(zoneId, target);
        if (!path || path.length < 2) break;
        ai.patrolPath = path.slice(1); // skip current zone
        ai.patrolTarget = target;
        ai.patrolMode = mode;
      }

      const nextZone = ai.patrolPath.shift();
      if (nextZone) {
        moveEntity(entity, nextZone, broadcast);
        if (!isEnemy(entity) && query) {
          query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [nextZone, entity.id]).catch(() => {});
        }
        return 'RUNNING'; // still en route — stay at PATROL node next tick
      }
      break;
    }

    case 'FLEE': {
      if (!ai) break;
      const targetPlayer = getLivePlayer(entity.targetId);
      const targetZoneId = targetPlayer?.current_zone;
      const exits = Object.values(zone?.exits || {});
      if (!exits.length) break;

      // Move to any adjacent zone that doesn't contain the target
      const safeExits = exits.filter(z => z !== targetZoneId);
      const dest = safeExits.length
        ? safeExits[Math.floor(Math.random() * safeExits.length)]
        : exits[Math.floor(Math.random() * exits.length)];

      moveEntity(entity, dest, broadcast);
      if (!isEnemy(entity) && query) {
        query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [dest, entity.id]).catch(() => {});
      }
      // Clear target after fleeing
      entity.targetId = null;
      entity.aggroedAt = null;
      break;
    }

    case 'SAY': {
      if (!ai) break;
      const msg = params.message || '';
      if (!msg) break;
      const cooldown = (params.cooldown_s ?? 30) * 1000;
      if (params.once && ai.lastSay > 0) break;
      if (Date.now() - ai.lastSay < cooldown) break;
      ai.lastSay = Date.now();
      broadcast(zoneId, {
        type: 'output',
        message: `<span style="color:var(--yellow)">${entity.name} says: "${msg}"</span>`,
      });
      break;
    }

    case 'CALL_BACKUP': {
      if (!ai) break;
      const radius = params.radius ?? 2;
      const factionOnly = params.faction_only !== false;
      if (Date.now() - ai.alertCooldown < 30000) break; // 30s cooldown
      ai.alertCooldown = Date.now();

      const reach = getZonesInRadius(zoneId, radius);
      for (const [reachZoneId] of reach) {
        const rZone = world.zones.get(reachZoneId);
        if (!rZone) continue;
        for (const eid of rZone.enemies) {
          const ally = world.enemies.get(eid);
          if (!ally || ally.instanceId === entity.instanceId) continue;
          if (factionOnly && ally.faction !== entity.faction) continue;
          if (!ally.targetId && entity.targetId) {
            ally.targetId = entity.targetId;
            ally.aggroedAt = Date.now();
          }
        }
        for (const nid of rZone.npcs) {
          const ally = world.npcs.get(nid);
          if (!ally || ally.id === entity.id) continue;
          if (factionOnly && ally.faction !== entity.faction) continue;
          if (!ally.targetId && entity.targetId) {
            ally.targetId = entity.targetId;
          }
        }
      }
      break;
    }

    case 'TELEPORT': {
      const dest = params.zone_id;
      if (!dest) break;
      moveEntity(entity, dest, broadcast);
      if (!isEnemy(entity) && query) {
        query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [dest, entity.id]).catch(() => {});
      }
      if (ai) { ai.patrolPath = []; ai.patrolTarget = null; }
      break;
    }

    case 'IDLE':
      break;

    case 'SET_FLAG': {
      if (!ai) break;
      if (params.scope === 'self') {
        ai.flags[params.flag] = params.value ?? 'true';
      }
      // world scope: would need async world_flags DB write — skip for now
      break;
    }

    default:
      break;
  }
}

// ── Main tick ────────────────────────────────────────────────────────────────

const MAX_STEPS = 50;

export async function tickEntityAI(entity, ctx) {
  const graph = entity.behaviour_graph;
  if (!graph || !graph._start) return;

  const ai = entity._ai;
  if (!ai) return;

  // Check if suspended in a WAIT — currentNode already points to the resume target
  if (ai.waitUntil && Date.now() < ai.waitUntil) return;
  ai.waitUntil = null;

  const nodes = graph.nodes;
  if (!nodes) return;
  const edges = graph.edges || [];

  // Resume from cursor if set, else restart from _start
  let nodeId = ai.currentNode || graph._start;
  ai.currentNode = null; // clear — will be re-set if execution suspends

  let steps = 0;

  while (nodeId && steps++ < MAX_STEPS) {
    const node = nodes[nodeId];
    if (!node) break;

    switch (node.type) {
      case 'start':
        nodeId = resolveEdge(edges, nodeId, 'next');
        break;

      case 'condition': {
        const result = evalCondition(node, entity);
        nodeId = resolveEdge(edges, nodeId, result ? 'ifTrue' : 'ifFalse');
        break;
      }

      case 'action': {
        const result = await execAction(node, entity, ctx);
        // RUNNING: stay at this node next tick. Otherwise advance cursor.
        ai.currentNode = (result === 'RUNNING')
          ? nodeId
          : resolveEdge(edges, nodeId, 'next');
        return;
      }

      case 'wait': {
        const seconds = node.data?.seconds ?? 1;
        ai.waitUntil = Date.now() + seconds * 1000;
        ai.currentNode = resolveEdge(edges, nodeId, 'next'); // resume here after wait
        return;
      }

      case 'loop': {
        // Explicit jump — follow 'next' edge or fall back to _start
        nodeId = resolveEdge(edges, nodeId, 'next') || graph._start;
        break;
      }

      case 'random': {
        const branches = node.data?.branches || [];
        if (!branches.length) { nodeId = null; break; }
        const totalWeight = branches.reduce((s, b) => s + (b.weight ?? 1), 0);
        let roll = Math.random() * totalWeight;
        let chosen = 0;
        for (let i = 0; i < branches.length; i++) {
          roll -= branches[i].weight ?? 1;
          if (roll <= 0) { chosen = i; break; }
        }
        nodeId = resolveEdge(edges, nodeId, `branch_${chosen}`);
        break;
      }

      default:
        nodeId = null;
    }
  }
  // Natural end or MAX_STEPS — currentNode stays null, next tick restarts from _start
}
