import { world, tickSpawns, getRandomAmbient, getWeatherAmbient, getLivePlayer, getInterruptLoudness, registerInterrupt, createCorpse, tryBattleCry, setApartmentCache, hasActivePlayers, resolveLanding, getZone, reconcileZoneMembership, bodyZoneOf } from './world.js';
import { wakeFromDream } from './dreamscape.js';
import { tickUnconscious, knockOut, isOut, KO_MS } from './unconscious.js';
import { tickStealth } from './stealth.js';
import { tickPanic } from './panic.js';
import { getZoneRadiation } from './zone-tags.js';
import { randomUUID } from 'crypto';
import { propagateSound } from './sounds.js';
import { enemyAttackPlayer, enemyAttackNpc, npcAttackNpc, npcAttackPlayer, isOnCooldown, clearCooldown, pvpSwing, formatBattleCry, getPlayerCombat, flushDirtyResources, applyStrikeToEnemy } from './combat.js';
import { setStance, DEFAULT_STANCE } from './stance.js';
import { setFlag } from './flags.js';
import { tickEntityAI, moveEntity, ensureBehaviourGraph } from './ai-behaviour.js';
import { npcBanterTick } from './npc-banter.js';
import { restockAllVendors } from './vendor.js';
import { tickEffects, applyEffect, tickMobEffects } from './effects.js';
import { impairmentOf } from './impairment.js';
import { tickSleep, releaseApartment, gameToday, ymd, addGameDays, gameDaysBetween, RENT_PERIOD_DAYS } from './apartments.js';
import { isDeepCleanDay, isOwnedZone, filthCount } from './zone-filth.js';
import { fireHook } from './plugins.js';
import { emit, on } from './events.js';
import { schedule } from './scheduler.js';
import { resumeDueWaits } from './graph.js';
import { hasExit, neighborZoneIds } from './exits.js';
import { setPosture, forceStand } from './posture.js';
import { carryCapacity } from './commands/inventory.js';
import { flushDirtyPositions } from './commands/movement.js';
import { flushAllRelations } from './relations.js';
import { flushAllWear } from './durability.js';
import { flushAllMutations } from './mutations.js';
import { effectiveStat, fatigueOf, fatigueLabel, FATIGUE_RUINED, adjustSanity } from './condition.js';
import { query, logActivity } from '../models/db.js';
import { addSweat } from './hygiene.js';
import { warmthBonus, tickWarmth } from './warmth.js';
import { appetiteMessages } from './appetite.js';
import { getEnvironmentState, getZoneTemperature, getZoneApparentTemperature, windChillDelta, waterTemperature, getZoneHumidity, getWindKph, recordLightningKill, getZoneStormIntensity, getWeatherFieldSnapshot, getZonePrecip } from './environment.js';
import { tickDrugDecayAll, tickDrugs, tickOnsets, tickWithdrawalAll, clearActiveDrugState } from './drugs.js';
import { getTimeScale } from './gametime.js';
import { escAttr } from './text.js';

// Rest/regen tunables (restRegenTick, every 15 seconds).
// Stamina only regenerates once you've been idle (no movement) for a short delay,
// and faster while sitting. HP only starts recovering — slowly, and only while
// sitting — once stamina is back to full.
const IDLE_REGEN_MS = 8000;       // no-movement grace before stamina recovers
const STAND_STAMINA_REGEN = 1;    // stamina per tick when idle & standing (slow)
const SIT_STAMINA_REGEN = 6;      // stamina per tick when sitting (faster rest)
const SIT_REGEN_HP = 3;           // HP per tick while sitting, once stamina is full
const WINDED_REGEN_MULT = 0.5;    // stamina regen while winded (ran the tank dry, movement.js) — halved
// A well-fed player recovers stamina appreciably faster. This is what the whole
// cooking quality ladder finally BUYS — see rewardFor() in the cooking plugin,
// where a masterful meal is worth several times a poor one in duration.
const WELL_FED_REGEN_MULT = 1.5;

// Cloning-vat emergence beats (ms after respawn), played only on the normal vat
// path: consciousness arrives immediately, the body reports in, then a dressing
// robot clothes you and bills your account. A jail override takes custody of the
// body instead and runs none of this.
const VAT_ASSIMILATE_MS = 2600;
const VAT_DRESS_MS = 5200;

let broadcastFn = null;
let lastNoCombatWarn = 0;
let minuteTick = 0;

export function startGameLoop(broadcast) {
  broadcastFn = broadcast;
  setInterval(tick, 1000); // 1s combat tick stays raw — latency-critical hot path
  schedule('1m', minuteTickFn);
  schedule('45s', ambientTick);
  schedule('5s', stormTick);
  schedule('1m', resourceTick);
  schedule('10s', () => tickSpawns(broadcastFn));
  schedule('15s', restRegenTick);
  // NPC AI clock. 15s (not 1m) because at one tile per minute an NPC was 60x
  // slower than the player standing next to them — you never saw one cross a
  // room. Cheap to raise: paths are cached on ai.patrolPath and NPC positions
  // are RAM-only, so a tick that doesn't change target is a shift() + broadcast.
  // NPC_TICK_SECONDS in ai-behaviour.js must match this cadence.
  schedule('15s', npcWanderTick);
  schedule('1m', flushDirtyPositions); // checkpoint moved players' current_zone/stamina in one batched write
  schedule('1m', flushAllRelations);   // coalesced upsert of who's met whom (engine/relations.js); logout flushes again
  schedule('1m', flushAllWear);        // coalesced gear-condition write (engine/durability.js) — wear accrues in memory on the swing path
  schedule('1m', flushAllMutations);   // coalesced expression write (engine/mutations.js); logout flushes again

  schedule('30s', () => npcBanterTick({ broadcast: broadcastFn }));
  // Zone broadcasts are delivered by walking zone.players, so a player missing
  // from that set silently stops hearing their room. Pure in-memory sweep, no
  // DB — it bounds any such drift to 30s and names the culprit in the log.
  schedule('30s', () => reconcileZoneMembership());
  // Parked long `wait` continuations (script_waits). Idle-gated by the scheduler,
  // so an empty world costs nothing; a row whose player is offline stays owed.
  schedule('1m', () => resumeDueWaits(broadcastFn));
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
      if (npc._aboard || npc._escorting || npc._charterHeld) continue;   // riding aboard a vehicle, walking with a player, or placed by a plugin — frozen
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
  // Idle gate: everything below is player-scoped (enemy AI only matters with a
  // player in-zone, auto-attack/NPC-retaliation need a live target, status/drug
  // effects iterate world.players) — all no-ops on an empty world. This tick is a
  // raw setInterval (latency-critical, deliberately off the scheduler), so it does
  // NOT inherit the scheduler's hasActivePlayers gate; without this the enemy loop
  // ticks every instance every second forever, pinning Neon awake via any AI query.
  // Catch-up is benign: the next tick after a login re-derives everything.
  if (!hasActivePlayers()) return;

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
          target._resDirty = true; // coalesced into the 1s flushDirtyResources write
          broadcastFn(null, { type:'combat_incoming', message:result.message, player_update:{ hp:target.hp, hp_max:target.hp_max } }, null, target.id);
          if (target.hp <= 0) {
            // TAKEN ALIVE. A police manhunt unit (`_takesAlive`, set by
            // surveillance at ≥4★) beats you unconscious instead of killing you.
            // The only place in the engine where hp reaching zero is not death,
            // and it is deliberately not general: an ordinary enemy kills you.
            if (enemy._takesAlive) {
              knockOut(target, { ms: KO_MS, by: enemy });
              broadcastFn(target.current_zone, { type: 'zone_event', message: `${enemy.name} puts ${target.handle} on the ground and cuffs them there.`, refresh: true }, target.id);
              broadcastFn(null, { type: 'combat', message: `<span class="msg-combat">The world goes sideways. Somebody is kneeling on your back.</span>` }, null, target.id);
              emit('police.tookAlive', { player: target, officer: enemy });
              return;
            }
            await handlePlayerDeath(target, enemy);
            return;
          }

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

  // Anyone whose knockout has run out comes round here, rather than on a timer
  // per victim: this walk already exists, and a KO is far too short-lived to
  // justify timer bookkeeping across logout, death and reconnect.
  tickUnconscious(world.players.values(), (b, msg) =>
    broadcastFn(null, { type: 'output', message: `<span class="msg-system">${msg}</span>` }, null, b.id));
  tickUnconscious(world.npcs.values(), null);

  // Sneakers whose window has run out get looked at again. Same walk, same
  // reason as the KO sweep above — no per-sneaker timer, and it costs a posture
  // read per live player.
  tickStealth(world.players.values());

  // And anyone who saw something they couldn't handle gets one second of being
  // frightened: a shout, and a try at the door. Returns immediately on an empty
  // map, which is the normal case.
  tickPanic();

  // Player auto-attack: sustain combat against combatTargetId each tick
  for (const [playerId, player] of world.players) {
    if (!playerCombat) break;
    if (!player.combatTargetId) continue;
    const combatEnemy = world.enemies.get(player.combatTargetId);
    if (!combatEnemy || combatEnemy.zoneId !== player.current_zone) {
      player.combatTargetId = null;
      continue;
    }
    // Auto-attack never finishes an unconscious body. Standing over one and
    // killing it has to be a thing you TYPE — it is charged as `execution` at
    // 5 stars, and a crime that severe must never be committed by a background
    // tick on your behalf. This is also what makes a mid-fight knockout visible
    // at all rather than being undone a second later.
    if (isOut(combatEnemy)) {
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

  // Contested flee: a player who tried to walk out of a fight has an intent
  // armed by the weapon plugin's move gate. Retry it once per attack cycle —
  // the attempt burns the attack cooldown, so this and the auto-attack loops
  // can never both fire in the same cycle.
  for (const [, player] of world.players) {
    if (!player._fleeIntent || !playerCombat?.tickFleeIntent) continue;
    playerCombat.tickFleeIntent(player).catch(() => {});
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

  // NPC retaliation against players — and, since NPCs can now target each other,
  // against other NPCs. `_combatTargetId` no longer implies "a player": resolve it
  // as an NPC first and hand those off to npcAttackNpc, so a brawl between two
  // NPCs runs on the same to-hit, crit and body-part rules as everything else
  // rather than on a bespoke flavour path.
  for (const [npcId, npc] of world.npcs) {
    if (!npc._combatTargetId || npc._dead) continue;
    const npcFoe = world.npcs.get(npc._combatTargetId);
    if (npcFoe) {
      if (npcFoe._dead || npcFoe.zone_id !== npc.zone_id) { npc._combatTargetId = null; continue; }
      // The scrap is capped unless someone meant it: `_brawlFloorHp` is set by
      // whoever started the fight (npc-drugs sets it for a drunken scuffle) and
      // left unset for anything that should be able to finish the job.
      const floorHp = npc._brawlFloorHp ?? 0;
      npcAttackNpc(npc, npcFoe, { floorHp }).then(result => {
        if (!result) return;
        broadcastFn(npc.zone_id, { type: 'zone_event', message: result.message });
        if (result.killed) {
          npc._combatTargetId = null;
          emit('npc.killed', { npc: npcFoe, killer: npc });
        }
      }).catch(() => {});
      continue;
    }
    const target = getLivePlayer(npc._combatTargetId);
    if (!target || target.current_zone !== npc.zone_id) {
      npc._combatTargetId = null;
      continue;
    }
    npcAttackPlayer(npc, target).then(async result => {
      if (!result) return;
      if (result.hit) {
        target.hp = Math.max(0, target.hp - result.damage);
        target._resDirty = true; // coalesced into the 1s flushDirtyResources write
        broadcastFn(null, { type: 'combat_incoming', message: result.message, player_update: { hp: target.hp, hp_max: target.hp_max } }, null, target.id);
        if (target.hp <= 0) {
          await handlePlayerDeath(target, null, { type: 'combat', label: `Killed by ${npc.name}` });
        } else if (!target.npcCombatTargetId && !((target.disengagedUntil || 0) > Date.now())) {
          // The NPC threw the first punch at a player who wasn't fighting it. Fires
          // once per fight (this branch only runs while the player has no NPC target),
          // and it's what lets the wanted system tell an instigator from someone
          // defending themselves — swinging back at this NPC is not assault.
          target.npcCombatTargetId = npcId;
          emit('npc.aggressed', { npc, target });
        }
      } else {
        broadcastFn(null, { type: 'combat_miss', message: result.message }, null, target.id);
      }
    }).catch(() => {});
  }

  // Status effects on ENEMIES — a mob that is on fire or bleeding out.
  //
  // Separate from the player pass below because the two resolve differently: a
  // player's effect writes hp directly, while a mob's must go through
  // applyStrikeToEnemy so the part roll, the typed soak, the injury observers and
  // the loot/removal path all still happen. tickMobEffects returns intents and
  // applies nothing — see the note on `mob` in effects.js.
  //
  // The list is SNAPSHOT before anything is applied: a lethal tick calls
  // removeEnemyInstance, which deletes from the very Map we would be iterating.
  // Almost always empty, so the walk is the whole cost on a normal second — and it
  // collects only the afflicted rather than spreading every live enemy into an array
  // first, so an empty second allocates nothing at all.
  const afflicted = [];
  for (const e of world.enemies.values()) if (e.statuses?.length) afflicted.push(e);
  for (const enemy of afflicted) {
    const zoneId = enemy.zoneId;
    for (const intent of tickMobEffects(enemy)) {
      // Resolved fresh every tick: whoever lit this thing up may have logged out,
      // died or walked away since, and a stale object would credit a ghost.
      const killer = intent.source ? getLivePlayer(intent.source) : null;
      const result = await applyStrikeToEnemy(killer, enemy, intent).catch(() => null);
      if (!result) break;   // already dead — the rest of its statuses are moot
      // `refresh` rides the spoken beat rather than every tick: the Hostiles line
      // is where the HP bar and the (Burning) label live, and re-rendering the
      // room once a second for the whole twenty is not worth the accuracy.
      if (intent.speak) broadcastFn(zoneId, { type: 'zone_event', message: intent.message, refresh: true });
      if (result.killed) {
        // The kill is announced and looted exactly as a swing's would be. Corpse
        // creation lives in the weapon plugin (registerPlayerCombat) — the engine
        // reaches it through the provider rather than importing it.
        if (killer) { killer.combatTargetId = null; emit('enemy.killed', { actor: killer, enemy }); }
        const combat = getPlayerCombat();
        const corpseLink = combat?.spawnEnemyCorpse
          ? await combat.spawnEnemyCorpse(zoneId, enemy.name, result).catch(() => null)
          : null;
        broadcastFn(zoneId, {
          type: 'zone_event',
          message: `${enemy.name} ${intent.effect === 'burning' ? 'stops moving, still burning' : 'bleeds out and falls'}.${corpseLink ? ` ${corpseLink}` : ''}`,
          refresh: true,
        });
        break;
      }
    }
  }

  // Status effects + phased drug effects
  for (const [playerId, player] of world.players) {
    // (Water is no longer instantly lethal — the swimming plugin governs it:
    // stamina drain, breath underwater, and a `drowning` status effect that bleeds
    // HP when you run dry. The old insta-drown failsafe was retired with swimming.)
    const hpBefore = player.hp;
    const stamBefore = player.stamina;
    const messages = [...tickEffects(player), ...tickDrugs(player), ...tickOnsets(player)];
    if (messages.length) broadcastFn(null, { type:'status_tick', messages }, null, playerId);
    // Effects mutate hp/stamina in memory but this per-second tick historically
    // neither persisted nor pushed them — so effect damage was invisible on the
    // HUD until the minute tick. Persist + broadcast when an effect changed them.
    const hpChanged = player.hp !== hpBefore;
    const stamChanged = player.stamina !== stamBefore;
    if (hpChanged || stamChanged) {
      player._resDirty = true; // coalesced into flushDirtyResources at the end of the tick
      broadcastFn(null, { type:'resource_tick', messages:[], player_update:{ hp: player.hp, stamina: player.stamina } }, null, playerId);
    }
    if ((messages.length || hpChanged) && player.hp <= 0) await handlePlayerDeath(player, null, { type: 'survival', label: 'Succumbed to your condition' });
  }

  // One coalesced write for every player whose hp/stamina changed this second —
  // from a swing (async, may land any tick) or a status-effect tick above. Bounds
  // combat crash-loss to ≤1s while collapsing the per-swing write storm to one round
  // trip. Self-gates to a no-op when nobody is dirty (empty world included).
  await flushDirtyResources();
}

// Irradiated ground: a tile whose radiation tag is hot, or a transient void-
// crossing room (off-grid waste). Exposure is driven by the RADIATION MODEL (the
// tag), not by which district you stand in — so any hot tile trickles RAD up
// regardless of place, and a clean tile lets it wash out. Used by the minute tick.
function irradiatedGround(player) {
  const z = getZone(player.current_zone);
  if (!z) return false;
  if (z.flags?.void_crossing) return true; // mid-journey, off the grid
  return getZoneRadiation(z) > 0;
}

async function minuteTickFn() {
  minuteTick++;
  await fireHook('tick.minute', { broadcast: broadcastFn });
  emit('tick.minute', { broadcast: broadcastFn });

  // Radiation moves in memory for everyone first; the DB write is collected and
  // flushed as ONE statement below. Same reasoning as the drug batch further down —
  // an awaited UPDATE per player inside this loop is N sequential round trips to a
  // remote Postgres every single minute.
  const radDirty = [];
  for (const [playerId, player] of world.players) {
    // On irradiated ground (a hot tile, or mid-void-crossing), the exposure slowly
    // trickles up — a gentle +1 every 10 minutes — and the normal wash-out is
    // suspended (nothing here scrubs the rad off). On clean ground, radiation decays
    // as usual: -1/min, -2/min while hydrated.
    if (irradiatedGround(player)) {
      if (minuteTick % 10 === 0 && (player.radiation || 0) < 100) {
        player.radiation = Math.min(100, (player.radiation || 0) + 1);
        radDirty.push([playerId, player.radiation]);
        broadcastFn(null, { type:'player_update', radiation: player.radiation }, null, playerId);
      }
    } else if ((player.radiation || 0) > 0) {
      const hydrated = player.hydratedUntil && Date.now() < player.hydratedUntil;
      const decay = hydrated ? 2 : 1;
      player.radiation = Math.max(0, player.radiation - decay);
      radDirty.push([playerId, player.radiation]);
      if (player.radiation % 10 === 0 && player.radiation > 0) {
        broadcastFn(null, { type:'player_update', radiation: player.radiation }, null, playerId);
      }
    }
    if (player.hydratedUntil && Date.now() >= player.hydratedUntil) player.hydratedUntil = null;
  }
  if (radDirty.length) {
    // Both columns are cast explicitly — in a bare VALUES list Postgres has no
    // context to infer a parameter's type from and errors out otherwise.
    const values = radDirty.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::int)`).join(',');
    await query(
      `UPDATE players p SET radiation = v.rad
         FROM (VALUES ${values}) AS v(id, rad)
        WHERE p.id = v.id`,
      radDirty.flat()
    );
  }

  // Drugs run ONCE for the whole player set, not once per player. Postgres is
  // remote in prod, so a per-player call here would be N sequential round trips
  // inside the minute tick; batched it is a fixed two regardless of population.
  const roster = [...world.players.values()];

  // Drug decay: once a dose's active window has expired, doses_in_system sheds a
  // fraction of itself per minute (a half-life, not a flat step), so a heavy load
  // clears fast and overdose thresholds recover instead of accumulating forever.
  await tickDrugDecayAll(roster.map(p => p.id));

  // Withdrawal: apply/clear addiction debuffs; decay addiction toward sobriety.
  const wdByPlayer = await tickWithdrawalAll(roster);
  for (const [playerId, messages] of wdByPlayer) {
    broadcastFn(null, { type: 'status_tick', messages }, null, playerId);
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
  // Carried credits fall with the body as a lootable credit chip stamped with the
  // exact amount. Banked (ATM) credits — bank_credits — are untouched and stay safe.
  const carried = Number(victim.credits) || 0;
  if (carried > 0) {
    await query(
      `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data)
       VALUES ($1,$2,'item_credit_chip',1,1.0,$3)`,
      [randomUUID(), corpseId, JSON.stringify({ credits: carried, name: `credit chip (₵${carried})` })]
    ).catch(() => {});
    await query('UPDATE players SET credits=0 WHERE id=$1', [victim.id]).catch(() => {});
    victim.credits = 0;
  }
  createCorpse({ id: corpseId, name: corpseName, zoneId, expiresAt, capacity });
  return { corpseId, corpseName };
}

// Re-equip the default starter outfit (underwear layer 1 + basics layer 2) after death,
// skipping anything already equipped. Shared by both death paths.
//
// Returns a promise that settles when every insert has landed. Callers that clear
// an "I'm being dressed, don't book me for indecent exposure" window MUST await
// it: the inserts are fire-and-forget, so dropping the window the instant this
// returns leaves a gap in which the surveillance scan reads the player as still
// naked and starts an offence against a body the game is dressing itself.
export function equipStarterOutfit(victimId, sex) {
  const underwear = sex === 'male'
    ? [['item_underwear_male', 'legs']]
    : [['item_underwear_female_top', 'torso'], ['item_underwear_female_bottom', 'legs']];
  const equip = (itemId, slot, layer) =>
    query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot,layer)
           SELECT $1,$2,i.id,1,1.0,1,$3,$4 FROM items i WHERE i.id=$5
           AND NOT EXISTS (SELECT 1 FROM player_inventory WHERE player_id=$2 AND item_id=$5 AND is_equipped=1)`,
      [randomUUID(), victimId, slot, layer, itemId]).catch(() => {});
  const pending = underwear.map(([itemId, slot]) => equip(itemId, slot, 1));
  for (const [itemId, slot] of [['item_basic_shirt','torso'],['item_basic_pants','legs'],['item_basic_shoes','feet']]) pending.push(equip(itemId, slot, 2));
  return Promise.all(pending);
}

// How long after the gantry finishes before the witness system is allowed to look
// at you again. The inserts have landed by then; this is slack for a scan tick
// that sampled you mid-dress and would otherwise resolve against a stale read.
export const VAT_DRESS_GRACE_MS = 4000;

// The clone-vat emergence sequence for a normal respawn, played on timers after
// the initial death/consciousness message: the body assimilates, then a dressing
// robot clothes you and prints an invoice against your account. Cloning is free
// for everyone — the invoice reads COMPLIMENTARY and the balance is left untouched.
function scheduleVatEmergence(player) {
  const send = (message) => broadcastFn(null, { type: 'output', message }, null, player.id);

  // The clone is naked until the dressing gantry clothes it (VAT_DRESS_MS). Mark
  // that window so the witness system doesn't charge indecent exposure for a body
  // that is mid-emergence and being dressed against its will.
  player._vatDressing = true;

  setTimeout(() => {
    send(`<span class="clone-vat-message">Your new body reports in, one seam at a time. Nerve endings find their sockets and announce themselves — cold, ache, the dumb weight of your own hands. Muscle remembers what muscle is for. You are, unmistakably, meat again.</span>`);
  }, VAT_ASSIMILATE_MS);

  setTimeout(async () => {
    // Await the inserts, THEN hold the window open a moment longer — see
    // VAT_DRESS_GRACE_MS. Dropping it the instant the call returned was a race:
    // the equips are fire-and-forget, so a scan tick landing in between charged
    // a fresh clone for indecent exposure while the gantry was still dressing it.
    await equipStarterOutfit(player.id, player.biological_sex || 'male');
    setTimeout(() => { player._vatDressing = false; }, VAT_DRESS_GRACE_MS);
    // Cloning is free for everyone — the vat still dresses you and prints the invoice,
    // it just stamps the total COMPLIMENTARY and never touches the balance.
    const balance = player.credits ?? 0;
    send(`<span class="clone-vat-message">A dressing gantry unfolds on too many arms and plants you upright in the lab. It sheathes you — underwear, pants, a t-shirt, a pair of shoes — with the tenderness of an industrial press, then slaps an invoice against your account and stamps it before you can read the line items: <span class="credits">COMPLIMENTARY</span>. The Architect eats the cost of cloning, tailoring, and incidental resurrection — not out of generosity but because a debt you could die to escape is no leash at all. Balance: <span class="credits">₵${balance}</span>.</span>`);
    broadcastFn(null, { type: 'player_update', credits: balance }, null, player.id);
  }, VAT_DRESS_MS);
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
  // OUT OF THE DREAM FIRST, before anything reads current_zone.
  //
  // Killed instantly in your sleep, `current_zone` is a transient dream room —
  // so the corpse spawned THERE, and dissolveDreamscape then took the room and
  // every item on the body with it. The "X has died" line went to a room with
  // nobody in it, and the killer standing over the body saw no corpse to loot.
  // Waking here puts current_zone back to the bed before deathZone is captured;
  // it's idempotent and a no-op on anyone who wasn't dreaming.
  wakeFromDream(player);
  const deathZone = player.current_zone;

  // Respawn override seam: a plugin (e.g. jail) may divert a downed player
  // somewhere other than their anchor and take custody of their body/gear.
  // The hook runs while inventory is still intact — before spawnPlayerCorpse
  // strips it — so it can confiscate rather than drop into a lootable corpse.
  // A truthy return { zone, message } routes respawn there and skips the corpse.
  const respawnOverride = await fireHook('player.respawnZone', player, killer);
  // resolveLanding: an anchor pointing at an enterable building facade lands
  // the respawn inside the building, never on the pass-through tile.
  const respawnZone = resolveLanding(respawnOverride?.zone || player.anchor_zone || 'zone_start');

  // Resolve the cause the systems broadcast to any listeners (e.g. the deaths
  // catalogue). A caller that knows the specific cause passes it explicitly;
  // otherwise derive from the killer — a player killer (has .id) is pvp, an
  // enemy (has .name, no .id) is combat — falling back to unknown when the
  // death is environmental and unlabelled.
  const resolvedCause = cause
    || (killer
      ? { type: killer.id ? 'pvp' : 'combat', label: `Killed by ${killer.name || killer.handle}` }
      : { type: 'unknown', label: 'Unknown causes' });

  // Tell the player HOW they died, not just THAT they did. Every non-combat caller
  // already hands us a written label ('Overdose', 'Bailed out without a parachute')
  // for the deaths catalogue — the death message just never showed it, so drowning,
  // an OD and a lightning strike all read as the same bare "You die." A named killer
  // still wins the line; only the genuinely unattributed death stays silent.
  const killerMsg = killer
    ? ` Killed by: ${killer.name}.`
    : (resolvedCause.type !== 'unknown' && resolvedCause.label ? ` Cause of death: ${resolvedCause.label}.` : '');

  // No corpse ONLY when a plugin took literal custody of the body — the cops
  // bagged your gear, so there is nothing left in the room to loot.
  //
  // ⚠ THIS KEYS ON `custody`, NOT ON "an override exists", AND THE DIFFERENCE IS
  // LOAD-BEARING. It used to be `respawnOverride ? no corpse : ...`, which meant
  // the Ascendant cortical restore — an override, but not an arrest — silently
  // suppressed the corpse too. That gave a paid-up player's killer nothing, and
  // it skipped spawnPlayerCorpse's credit-chip conversion below, so carried
  // credits survived death for free. An Ascendant now dies like anybody else and
  // leaves a body; what they pay for is the CLONE, not the bag. Any future hook
  // that genuinely takes the body away must opt in by returning `custody: true`.
  const { corpseId, corpseName } = respawnOverride?.custody
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
  adjustSanity(player, player.sanity_max, 'respawn');   // a gain, so it lands whole; clamping makes it exact
  player.hunger = 100;
  player.thirst = 100;
  player.radiation = 0;
  player.stamina = player.stamina_max ?? 100;
  player.body_temp_c = 37.0;
  player.clothing_contamination = {};
  player._dangerousTempTicks = 0;
  player.sleeping = null;   // the dream itself was already torn down above
  setPosture(player, 'standing');
  // A stance is a choice you make for a fight; the fight is over and so is the
  // body that held it. Comes out of the vat neutral, and the 60s lock goes with
  // the old one — dying shouldn't leave you stuck in berserk. The persisted flag
  // resets too, or the old stance would come back on the next login.
  setStance(player, DEFAULT_STANCE);
  clearCooldown(player.id, 'stance');
  setFlag('player', 'combat_stance', DEFAULT_STANCE, player).catch(() => {});
  player._dodgeUntil = 0;
  player._powQueued = false;
  player._fleeIntent = null;
  // Whatever had hold of you doesn't, on the other side of a respawn.
  player._grabbedBy = null;
  player.combatTargetId = null;
  player.pvpTargetId = null;
  player.offlinePvpTargetId = null;

  const vatLine = respawnOverride?.message
    || `<span class="clone-vat-message">Nothing. Then less than nothing — a dark so total it has weight. Then, without ceremony, you: consciousness arrives the way a switch does, no dimmer and no warning, just ON, a self where a moment ago there was only the Architect's arithmetic.</span>`;
  broadcastFn(null, {
    type:'player_death',
    message:`\n<span class="death-message">☠ ${msg}${killerMsg}</span>\n${vatLine}`,
    respawn_zone: respawnZone,
    player_update: { hp:player.hp, sanity:player.sanity, hunger:player.hunger, thirst:player.thirst, radiation:player.radiation, stamina:player.stamina, body_temp_c:player.body_temp_c, credits:player.credits, combat_stance:DEFAULT_STANCE },
  }, null, player.id);

  emit('player.respawn', { player });

  // Notify others in the death zone that a corpse has appeared (skipped only
  // when a plugin took custody of the body — there's no corpse to loot). This
  // fires on the Ascendant restore path too, and is meant to: their killer gets
  // the same lootable body anyone else leaves.
  if (corpseId) {
    const corpseLink = `<span class="action-link corpse-link" data-action="loot" data-target="${corpseId}" data-label="${escAttr(corpseName)}" title="Loot ${escAttr(corpseName)}">${corpseName}</span>`;
    broadcastFn(deathZone, { type:'zone_event', message:`${player.handle} has died. ${corpseLink}`, refresh: true }, player.id);
  }

  query('UPDATE players SET hp=$1, sanity=$2, hunger=$3, thirst=$4, radiation=$5, stamina=$6, body_temp_c=$7, clothing_contamination=$8, current_zone=$9 WHERE id=$10',
    [player.hp, player.sanity, player.hunger, player.thirst, player.radiation, player.stamina, player.body_temp_c, JSON.stringify({}), respawnZone, player.id]).catch(()=>{});

  // Move player back to anchor in memory
  for (const [,zone] of world.zones) zone.players.delete(player.id);
  world.zones.get(respawnZone)?.players.add(player.id);
  player.current_zone = respawnZone;
  player._posDirty = false; // death write above already checkpointed current_zone (see cmdMove)
  player._resDirty = false; // death write above already persisted hp/stamina (see flushDirtyResources)

  // Equip fresh underwear (layer 1) and basic clothing (layer 2) on respawn.
  // On a jail override the body is already in custody, so dress it immediately;
  // on the normal vat path the dressing robot does it on a timed beat, along
  // with the assimilation narration and the cloning bill. An override may still
  // set skipOutfit if it dresses the player itself — nothing does today (the
  // cortical restore used to, back when it rebuilt your wardrobe from a
  // snapshot; it no longer touches inventory at all, so it takes the starter
  // kit like everyone else rather than emerging naked).
  if (respawnOverride && !respawnOverride.skipOutfit) equipStarterOutfit(player.id, player.biological_sex || 'male');
  else if (!respawnOverride) scheduleVatEmergence(player);

  logActivity('death', player.handle);
  fireHook('player.death', player, killer).catch(()=>{});
  // `corpseId` rides along because a subscriber that wants to put something ON
  // the body needs to know there IS one.
  //
  // The other three are about who owns this death. `custody` is the narrow one —
  // somebody physically took the body, so state-destroying subscribers must not
  // fire (jail confiscates gear; nothing is left to wreck). `claimed` is the
  // broad one: ANY plugin returned a respawn override. They are deliberately
  // different, because a cortical restore claims the death without taking the
  // body, and it now WANTS corruption to run — the old chrome is destroyed for
  // real and the vats re-print it from the pattern, which is what stops a
  // restore conjuring an augment the player had already sold.
  //
  // `override` is the winning object itself, so a subscriber can tell whether it
  // was the one that won. That matters because fireHook keeps only the LAST
  // non-undefined return: a plugin whose hook ran can still have been overruled,
  // and must not spend anything until it knows it wasn't.
  emit('player.death', {
    player, killer, cause: resolvedCause, deathZone,
    corpseId: corpseId || null,
    claimed: !!respawnOverride,
    custody: !!respawnOverride?.custody,
    override: respawnOverride || null,
  });

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
      broadcastFn(zoneId, { type:'ambient', message:`<span class="msg-ambient">${pluginAmbient}</span>`, flavour: true });
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
    // flavour: the periodic room ambient is scene-setting, so it is dropped at the
    // Display Mode `log` rung. Sounds raised by an EVENT still come through here
    // unmarked and are always spoken.
    propagateSound(zoneId, ambient.message, ambient.loudness, broadcastFn, true);

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

// Fires lightning across the storm field every 5s. The SERVER is the single strike
// authority so the flight sim shows the SAME lightning as the ground: every strike
// is emitted as `weather.lightningStrike` (world coords + intensity), which the
// flight plugin relays to any pilot within view as a 3-D bolt out the canopy. Two
// sources feed it:
//   • Ground cadence — each populated outdoor storm zone rolls a local strike. At
//     5s the per-zone chance is 1/6 the old 30s chance, so the per-minute flash
//     (and the rare kill that rides on it) rate is UNCHANGED — it's just spread
//     across ticks instead of flashing every zone at once every 30s.
//   • Sky fill — a few strikes scattered inside each storm cell so a pilot flying
//     a storm sees lightning even with nobody on the ground below. Visual only;
//     the ground roll is the sole path that can kill.
/**
 * The set of zones that currently contain a BODY.
 *
 * Weather is a per-room effect that only matters where somebody is standing, so a
 * physics sweep wants the handful of occupied rooms — not a walk of all ~5,800
 * zones to find them, once every 5 s, for the whole duration of a storm.
 *
 * Uses `bodyZoneOf`, NOT `current_zone`, and that distinction is the whole reason
 * this is a named function with a test: a dreamer's `current_zone` is a dreamscape
 * with no sky, while the body it belongs to lies in a room that may well be in the
 * storm. That body IS in `zone.players`, so the full sweep this replaces did reach
 * it — keying on `current_zone` would silently stop weather happening to any room
 * whose only occupants are asleep.
 *
 * NOT the same as `getOccupiedZones` (server/index.js, passed into environment.js),
 * which walks live WS sessions and keys on `current_zone` deliberately: that one is
 * for PRESENTATION — pushing a weather update to the room a client is currently
 * rendering — and a dreamer's client is rendering the dreamscape. Physics follows
 * the body, delivery follows the eyes. Don't collapse them into one helper.
 */
export function occupiedBodyZones() {
  const occupied = new Set();
  for (const p of world.players.values()) {
    const zid = bodyZoneOf(p);
    if (zid) occupied.add(zid);
  }
  return occupied;
}

async function stormTick() {
  const { weatherType } = getEnvironmentState();
  if (!STORM_WEATHER_TYPES.has(weatherType)) return;

  for (const zoneId of occupiedBodyZones()) {
    const zone = world.zones.get(zoneId);
    if (!zone || zone.players.size === 0) continue;
    if (zone.flags?.is_interior || zone.flags?.is_apartment || zone.flags?.is_building) continue;
    // Per-tile: only zones actually under a storm cell flash, and denser cells
    // flash (and kill) more often. Field disabled → uniform 0.5 (old behaviour).
    const intensity = getZoneStormIntensity(zoneId);
    if (intensity <= 0) continue;
    if (Math.random() > intensity / 6) continue;   // 5s tick: 1/6 the 30s odds → same per-minute rate

    // Flash the ground players + emit the world-coord strike the flight sim renders.
    broadcastFn(zoneId, { type: 'lightning' });
    emit('weather.lightningStrike', { gx: zone.grid_x, gy: zone.grid_y, intensity });

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
      // flavour: thunder repeats for as long as the storm runs. The storm's
      // actual danger is carried by the ⚠ forecast band and the room's own
      // warning line, both of which survive at every rung.
      broadcastFn(zoneId, { type: 'ambient', message: msg, flavour: true });
      emit('weather.thunder', { zoneId });
    }, delay);
  }

  // Sky fill — strikes inside each storm cell so a pilot overhead sees a live
  // storm even with no ground players below. Scattered across the tick window so
  // they don't all arrive on the tick boundary. Visual only (no ground effect).
  const snap = getWeatherFieldSnapshot();
  for (const cell of snap?.systems || []) {
    if (cell.type !== 'storm') continue;
    const expected = cell.intensity * 1.2;   // ~1 strike / 4s per cell at full intensity
    const n = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
    for (let i = 0; i < Math.min(n, 4); i++) {
      const rr = Math.sqrt(Math.random()) * cell.radius * 0.9, th = Math.random() * 6.2832;
      const gx = cell.x + Math.cos(th) * rr, gy = cell.y + Math.sin(th) * rr;
      setTimeout(() => emit('weather.lightningStrike', { gx, gy, intensity: cell.intensity }), Math.random() * 4500);
    }
  }
}

// Hunger and thirst decay by 1 point every N minutes of being awake — at
// 60s real-time ticks, this is what actually makes "several hours to
// become fatal" true, rather than depleting from 100 inside one hour.
// Thirst depletes faster than hunger, matching real survival pacing and
// the brief's explicit ordering.
// Slowed 4× (2026-08-01): survival upkeep was a constant drumbeat rather than a
// background pressure — the meters now empty over a day-ish, not an afternoon.
const THIRST_DECAY_INTERVAL_MIN = 12; // 1 point per 12 min → 100 pts / 20 hours
const HUNGER_DECAY_INTERVAL_MIN = 16; // 1 point per 16 min → 100 pts / ~26.7 hours
// Diff-gate tripwire (Phase 6): thirst forces a write every 12 active game-minutes,
// so this many consecutive game-time-elapsing ticks with no write is anomalous.
const RESOURCE_NOWRITE_TRIPWIRE_TICKS = 24;

// Returns a multiplier (0.0–1.0) for stamina regen based on body temperature.
// Comfortable range (36–38°C) = full regen; further from it = reduced regen.
// An empty stomach is an empty tank. Hunger throttles the recovery of the one
// resource every physical action in the game spends, which is what finally makes
// eating a decision rather than a chore you do to silence a message.
//
// Deliberately multiplicative with temperature: cold AND starving is genuinely
// dire, because it should be.
function hungerRegenMultiplier(hunger) {
  const h = Number(hunger ?? 100);
  if (h > 40) return 1.0;
  if (h > 20) return 0.75;   // getting hollow
  if (h > 5)  return 0.5;    // very hungry — the warning band
  return 0.25;               // running on empty
}

// The same dial for water, and the more realistic of the two: dehydration costs
// blood volume, so the heart works harder for less and recovery drops off before
// hunger's does. Thirst used to feed only a Cool penalty, which was a pun rather
// than a symptom; this is where being parched should actually be felt.
//
// Bands match the ones the player is already warned at, same as everywhere else.
function thirstRegenMultiplier(thirst) {
  const t = Number(thirst ?? 100);
  if (t > 40) return 1.0;
  if (t > 20) return 0.7;    // dry
  if (t > 5)  return 0.45;   // very thirsty — the warning band
  return 0.2;                // wrung out
}

// Hunger and thirst are multiplicative — starving AND parched should be worse
// than either alone — but floored together, because `gain` is FLOORED to an
// integer and 0.25 × 0.2 would round a sitting player's recovery to literally
// zero. Deprivation should make you slow, never stuck.
const DEPRIVATION_FLOOR = 0.2;
function deprivationRegenMultiplier(player) {
  return Math.max(DEPRIVATION_FLOOR,
    hungerRegenMultiplier(player.hunger) * thirstRegenMultiplier(player.thirst));
}

// Endurance is the stat that says how long your body keeps going, so it governs
// the rate you get it back. It had been doing nothing but setting max HP, which
// left a whole raisable stat with one static consequence.
//
// Deliberately read through effectiveStat, not the raw column: that is what makes
// dehydration's Endurance penalty land somewhere a player can feel it, and it
// means anything else that ever drags on Endurance reaches recovery for free.
//
// END 5 is baseline (×1.0); 8% per point either side, clamped so a low-Endurance
// character is slower rather than punished and a high one is quick rather than
// exempt from resting.
const ENDURANCE_REGEN_BASELINE = 5;
const ENDURANCE_REGEN_PER_POINT = 0.08;
function enduranceRegenMultiplier(player) {
  const end = effectiveStat(player, 'stat_endurance');
  return Math.max(0.6, Math.min(1.4,
    1 + (end - ENDURANCE_REGEN_BASELINE) * ENDURANCE_REGEN_PER_POINT));
}

// And the other end of the same dial. A GOOD meal doesn't just refill the meter,
// it leaves you recovering faster than baseline for a while — which is the only
// thing that makes the whole cooking ladder worth climbing. A microwave dinner
// fills you up; a masterful one makes the next hour easier.
function wellFedRegenMultiplier(player, now) {
  return (player.wellFedUntil ?? 0) > now ? WELL_FED_REGEN_MULT : 1;
}

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

// Drift one body's core temperature by `gm` game-minutes. Mutates and clamps
// `player.body_temp_c`; reads nothing it doesn't own.
//
// EXTRACTED SO THE SLEEPING BODY USES THE SAME PHYSICS. Sleep used to be a total, free
// immunity to temperature — `resourceTick` skipped a sleeper before it reached this code, so
// the canonical way to die of cold (fall asleep in it) was the one guaranteed way not to. It
// also made a blizzard trivially survivable: lie down. A sleeper now drifts exactly like a
// waking body, and `tickSleep` wakes them once the cold bites, which is both what a real body
// does and the same courtesy hunger and thirst already extend ("your stomach wakes you up
// before you starve in your sleep"). There is deliberately no sleep-specific rate: two copies
// of this equation would drift apart, and the bed's protection is that it is usually INDOORS.
//
// Uses the BODY's zone, not `current_zone` — a dreamer's mind is in a dreamscape with no sky,
// while the body it belongs to may be lying in the weather.
// ── Metabolic heat ───────────────────────────────────────────────────────────
// Below 10°C → cooling; above 35°C → heating; in the comfort band between, the body's own
// thermoregulation restores the 37°C setpoint. THE THRESHOLD IS THE MODEL OF
// THERMOREGULATION: a real body holds 37°C exactly until its defences are outmatched, and
// only then starts losing ground. Everything past it is a body that has already lost.
// Module-scope because `bodyHeatTerms` needs them to decide whether to shiver or sweat.
const COLD_THRESHOLD = 10;
const HOT_THRESHOLD = 35;

// ── Rewarming ────────────────────────────────────────────────────────────────
// The comfort band's pull back to 37°C. `REWARM_BASE` is the old flat constant and is now the
// FLOOR — a body barely inside the band recovers exactly as slowly as it always did — while
// every degree of genuine warmth above the threshold buys speed, to a hard ceiling.
// The knee is set so a clothed body in a heated room (~22°C effective) lands near 2×, and only
// something deliberately hot — a heater plus real winter gear — approaches the cap.
const REWARM_BASE = 0.05;
const REWARM_KNEE_C = 12;     // °C above COLD_THRESHOLD per +1× of recovery speed
const REWARM_MAX_MULT = 3;    // …capped, so a fire is a strong advantage, never an instant reset

// How much of its rated insulation a non-`hydrophobic` garment loses when completely soaked.
// Real wet down loses ~90% of its loft; 0.8 keeps a sliver so a soaked coat is still marginally
// better than bare skin, which is also true — it's a windbreak even when it isn't a blanket.
const WET_INSULATION_LOSS = 0.8;
// Sweat feeds the hygiene substrate's own meter (server/engine/hygiene.js) so a long hot day
// smells like one. Thermal sweat was listed there as a source from the beginning and was the
// one that never actually arrived.
const SWEAT_HYGIENE_PER_MIN = 3;

// A body is a furnace, not a rock, and this is the term the model was missing entirely: a
// person who keeps moving in the cold survives conditions that kill a person who stands
// still, and that is the single most iconic fact about cold survival there is.
//
// Both terms are expressed in °C of effective ambient, the same currency as `insulation`, so
// they can be read against a garment at a glance: shivering is worth about a hoodie, running
// about a wetsuit. That is roughly right in physiological terms too — resting metabolism is
// ~100 W, brisk walking ~300 W, and shivering can reach ~500 W.
const EXERTION_WINDOW_MS = 120_000;   // how long the furnace stays lit after you stop moving
const EXERTION_WALK_C = 3;
const EXERTION_RUN_C = 6;
const SHIVER_WARMTH_C = 4;
const SHIVER_STAMINA_PER_MIN = 2;
// Shivering STOPS below ~32°C in a real body — the muscles can no longer be driven, and its
// absence is a classic marker that mild hypothermia has become moderate. Keeping that here
// is what turns the cold from a slope into a cliff: while you can shiver you hold the line,
// and the moment you can't — out of stamina, or too far gone — the cooling rate jumps.
const SHIVER_FLOOR_C = 32;

// ── Sweat: the heat side's answer to shivering ───────────────────────────────
// Humans are the best sweaters in the animal kingdom, and it is the whole reason we survive
// heat that kills other mammals — so it is worth more than shivering is. But it is
// EVAPORATIVE, which makes it not a flat bonus but a bonus multiplied by whether the air
// will take the water. That is the wet-bulb story, and it is why humid heat kills at
// temperatures dry heat doesn't.
const SWEAT_COOLING_C = 7;
const SWEAT_THIRST_PER_MIN = 2;   // sweating is spending water, and there is only so much
// ANHIDROSIS. Sweating fails at the top exactly as shivering fails at the bottom: production
// stops and the skin goes hot and dry. It is the classic sign that heat exhaustion has become
// heat stroke — and the flavour pool has said "You're not sweating anymore. That's very bad."
// for a long time while nothing in the model made it true.
const SWEAT_CEILING_C = 41;
// Below this much of the thirst bar, sweat starts to throttle. Dehydration doesn't just make
// you thirsty, it takes away the thing keeping you alive.
const SWEAT_HYDRATION_KNEE = 40;

// How much of its rated cooling sweat actually delivers here, 0..1.
function sweatEfficiency(player, zoneId) {
  // Saturated air cannot accept more water: the sweat runs off you and cools nothing.
  const hum = getZoneHumidity(zoneId);
  let eff = Math.max(0, 1 - (hum ?? 50) / 100);
  // Moving air carries the vapour away — the one place wind is your friend, and the exact
  // mirror of wind chill. It scales rather than adds, because it cannot manufacture headroom
  // that saturated air doesn't have.
  eff *= 1 + Math.min(0.5, (getWindKph() || 0) / 60);
  // You cannot sweat water you haven't got.
  eff *= Math.max(0, Math.min(1, (player.thirst ?? 100) / SWEAT_HYDRATION_KNEE));
  // A sealed shell is boil-in-the-bag: the garment that saves you in a gale traps every drop
  // against your skin in a heatwave. Deliberately reuses `windproof` — one real property,
  // honestly cutting both ways.
  eff *= 1 - 0.5 * (player.windproof || 0);
  return Math.max(0, Math.min(1, eff));
}

// The body's own contribution, in °C, to each side of the ledger.
//   warmth — added to the COLD side (exertion + shivering)
//   load   — added to the HOT side  (exertion − sweating)
// Exertion appears in BOTH, with the same sign, because a working body produces the same
// watts whichever way the weather is trying to kill it. That is what makes the optimal play
// opposite at the two extremes: keep moving in the cold, sit still in the heat.
function bodyHeatTerms(player, cooling, heating, zoneId) {
  const sinceMove = Date.now() - (player._lastMoveAt ?? 0);
  const exertion = sinceMove < EXERTION_WINDOW_MS
    ? (player.running ? EXERTION_RUN_C : EXERTION_WALK_C) : 0;

  player._shivering = false;
  let shiver = 0;
  if (cooling && (player.body_temp_c ?? 37) >= SHIVER_FLOOR_C && (player.stamina ?? 0) >= SHIVER_STAMINA_PER_MIN) {
    player._shivering = true;
    shiver = SHIVER_WARMTH_C;
  }

  player._sweating = false;
  let sweat = 0;
  if (heating && (player.body_temp_c ?? 37) <= SWEAT_CEILING_C && (player.thirst ?? 0) >= SWEAT_THIRST_PER_MIN) {
    const eff = sweatEfficiency(player, zoneId);
    if (eff > 0.01) { player._sweating = true; sweat = SWEAT_COOLING_C * eff; }
  }

  // A hot drink or a hand warmer. Cold side only, and see warmth.js for why: a mug of cocoa
  // is thermally negligible, so it is honestly modelled as a DEFENCE rather than as calories.
  return { warmth: exertion + shiver + warmthBonus(player), load: exertion - sweat };
}

// ── The drift curve ──────────────────────────────────────────────────────────
// °C per game-minute the core moves, given how far past the threshold the body is.
//
// The exponent was 1.75, and the tail it produced was the least realistic number in the
// model: at a 50° deficit (arctic air on bare skin) it cooled 37→30 in three and a half
// minutes, against a couple of HOURS in reality — while ordinary cold, where players
// actually spend their time, was only about 4× fast. The error was concentrated almost
// entirely in the extremes.
//
// It is 1.25 now, for a reason rather than a nerf. The steep curve was standing in for
// something real — a body's defences collapsing as it loses — but that collapse is
// SHIVERING, and shivering is now an explicit term above (worth +4°C, costing stamina, and
// switching off below 32°C). Modelling it twice was the mistake. With the compensation
// explicit, what remains below the threshold is a body whose defence is already saturated,
// and that is close to Newton's law: heat loss roughly linear in ΔT, with a little
// steepening for radiative loss and failing vasoconstriction. 1.25 is that.
//
// PIVOTED, not merely flattened: the coefficient is solved so the rate at a 10° deficit is
// exactly what it always was. Ordinary cold is therefore untouched — it was the closest to
// right and is the case players meet most — and only the tail stretches, roughly doubling
// survival time in genuinely extreme conditions. At a 50° deficit that is 3.5 minutes → 8.
// Still lethal, but now long enough to be a journey to shelter rather than a coin flip.
const DRIFT_EXPONENT   = 1.25;
const DRIFT_PIVOT_DIFF = 10;        // the deficit the curve is anchored at…
const DRIFT_PIVOT_RATE = 0.1125;    // …and the °C/min there, carried over from the old curve
const DRIFT_COEFF = DRIFT_PIVOT_RATE / Math.pow(DRIFT_PIVOT_DIFF, DRIFT_EXPONENT);
const driftRate = (absDiff) => DRIFT_COEFF * Math.pow(absDiff, DRIFT_EXPONENT);

// °C of warmth the body is currently generating for itself. `cooling` gates shivering: you
// don't shiver in a warm room, and you certainly don't shiver in a heatwave.
function metabolicWarmth(player, cooling) {
  let warmth = 0;
  const sinceMove = Date.now() - (player._lastMoveAt ?? 0);
  if (sinceMove < EXERTION_WINDOW_MS) warmth += player.running ? EXERTION_RUN_C : EXERTION_WALK_C;
  player._shivering = false;
  if (cooling && (player.body_temp_c ?? 37) >= SHIVER_FLOOR_C && (player.stamina ?? 0) >= SHIVER_STAMINA_PER_MIN) {
    player._shivering = true;
    warmth += SHIVER_WARMTH_C;
  }
  return warmth;
}

export function driftBodyTemperature(player, gm) {
  const bodyZone = bodyZoneOf(player);
  const tempOffset = world.zones.get(bodyZone)?.flags?.temp_offset || 0;
  // Apparent ("feels like") temperature — folds the day's wind chill and
  // humidity into the ambient the body actually has to cope with (outdoors).
  // A SUBMERGED swimmer (player._submerged, owned by the swimming plugin) drifts
  // toward the cold WATER temperature instead, and is soaked (full wet multiplier)
  // regardless of gear — a long cold swim pulls the core toward hypothermia via
  // the existing cold-drift + <30°C lethal path. Insulation (a wetsuit) still
  // applies, so gear can offset the pull.
  const submerged = !!player._submerged;
  // WINDPROOFING gives back the wind's share of the feels-like temperature for the slots a
  // shell covers. It has to happen here rather than inside getZoneApparentTemperature because
  // the chill is a property of the ZONE and the shell is a property of the PLAYER; without
  // it, wind chill was applied to the ambient before any clothing and so bit a bundled-up
  // player exactly as hard as a naked one, which is the opposite of what a shell is for.
  // Underwater there is no wind, and no shell.
  const chill = submerged ? 0 : windChillDelta(bodyZone, tempOffset);
  const effectiveAmbient = submerged
    ? waterTemperature(bodyZone)
    : getZoneApparentTemperature(bodyZone, tempOffset) - chill * (player.windproof || 0);

  const playerWetness = submerged ? 100 : (player.wetness ?? 0);

  // WET INSULATION. Soaked clothing stops being clothing — wet down loses most of its loft,
  // which is the whole reason "cotton kills" is a saying. Only the `hydrophobic` share
  // (`player.insulationWet`: wool, neoprene, sealed shells, wicking synthetics) survives a
  // soaking; the rest is interpolated away on `player.wetness`. Before this, wetness was a
  // flat multiplier on the drift RATE and never touched insulation at all, so a soaked
  // arctic parka insulated exactly as well as a dry one — the single largest inaccuracy left
  // in the model. It applies to BOTH sides on purpose: wet clothing traps less heat too, so
  // the same rule that makes a wet hoodie dangerous in the cold makes it cooler in a heatwave.
  const insDry  = player.insulation || 0;
  const insKept = Math.min(insDry, player.insulationWet || 0);
  const insulation = insKept + (insDry - insKept) * (1 - (playerWetness / 100) * WET_INSULATION_LOSS);

  // Effective temperature = ambient + clothing insulation (insulation in °C offset).
  // Bare core skin (no torso/legs clothing) subtracts an exposure penalty on the
  // cold side only — nakedness bites in the cold but still vents heat when hot.
  const clothed = effectiveAmbient + insulation;
  const bared   = clothed - (player.exposurePenalty || 0);

  // The body's own terms, evaluated against the PRE-metabolic figures so the decision to
  // shiver or sweat is about the environment rather than about how well it's already working.
  const { warmth, load } = bodyHeatTerms(player, bared < COLD_THRESHOLD, clothed > HOT_THRESHOLD, bodyZone);
  const warmthTemp = bared + warmth;
  const heatTemp   = clothed + load;
  // Neither defence is free, and that is what makes weather a RESOURCE problem rather than a
  // timer. Shivering burns stamina; sweating burns water. Hold out long enough either way and
  // the tank empties, the defence stops, and the drift steps up at the worst possible moment.
  if (player._shivering) player.stamina = Math.max(0, (player.stamina ?? 0) - SHIVER_STAMINA_PER_MIN * gm);
  tickWarmth(player, gm);
  if (player._sweating) {
    player.thirst = Math.max(0, (player.thirst ?? 0) - SWEAT_THIRST_PER_MIN * gm);
    // The smell of it is somebody else's system; this just tells them it happened.
    addSweat(player, SWEAT_HYGIENE_PER_MIN * gm);
  }

  const cooling = warmthTemp < COLD_THRESHOLD;
  const heating = heatTemp > HOT_THRESHOLD;
  // Drift rates are °C per GAME-minute, so multiply by the game-minutes elapsed
  // this tick (gm) — at 3× the core cools/warms three times as fast per real
  // minute, keeping thermal exposure proportional to the sped-up day.
  if (cooling) {
    const absDiff = COLD_THRESHOLD - warmthTemp;
    const wetMult = 1 + (playerWetness / 100);
    player.body_temp_c = (player.body_temp_c ?? 37.0) - driftRate(absDiff) * wetMult * gm;
  } else if (heating) {
    const absDiff = heatTemp - HOT_THRESHOLD;
    const wetMult = Math.max(0.70, 1 - playerWetness * 0.003);
    player.body_temp_c = (player.body_temp_c ?? 37.0) + driftRate(absDiff) * wetMult * gm;
  } else {
    // Comfort band: metabolic thermoregulation pulls the core back to 37°C, by exponential
    // relaxation, compounded over gm so it tracks the game-speed knob.
    //
    // WARMTH IS A GRADIENT, NOT A DOOR. This rate used to be a flat 0.05/min with
    // `warmthTemp` nowhere in it, which meant a 20°C room, a 35°C sauna and a freezing
    // corridor-with-a-good-coat all rewarmed you at exactly the same speed. Being WARMER than
    // merely comfortable did nothing at all — and that, not missing content, is why the game
    // had no fires, heaters, blankets or hot drinks: there was no mechanic that would have
    // rewarded authoring one. A brazier would have been a decoration.
    //
    // So recovery now scales with how far past the cold threshold you actually are, capped so
    // that huddling somewhere hot is a strong advantage rather than an instant reset. The
    // floor is the old constant, so being barely-in-the-band is exactly as slow as it ever
    // was; everything above it is new headroom that clothing, shelter and heat sources buy.
    const cur = player.body_temp_c ?? 37.0;
    const diff = 37.0 - cur;
    const over = Math.max(0, warmthTemp - COLD_THRESHOLD);
    const mult = 1 + Math.min(REWARM_MAX_MULT - 1, over / REWARM_KNEE_C);
    const rate = 1 - Math.pow(1 - REWARM_BASE * mult, gm);
    player.body_temp_c = Math.abs(diff) < 0.1 ? 37.0 : cur + diff * rate;
  }

  // Clamp to survivable range; prevents runaway values on extreme ticks.
  player.body_temp_c = Math.round(Math.max(25, Math.min(45, player.body_temp_c ?? 37.0)) * 10) / 10;
  return player.body_temp_c;
}

// What being awake far too long does to the inside of your head. Deliberately
// unglamorous — this is not a trip, it is the room going wrong at the edges.
const SLEEP_DEPRIVED_MESSAGES = [
  `<span class="text-dim">Something crosses the corner of your vision. Nothing is there when you look.</span>`,
  `<span class="text-dim">You lose a few seconds standing up, and don't know where they went.</span>`,
  `<span class="text-dim">Your own thoughts arrive slightly out of order, like someone else is saying them.</span>`,
  `<span class="text-dim">The light has a grain to it now. You need to sleep.</span>`,
  `<span class="text-dim">You blink and the room is a half-step to the left of where you left it.</span>`,
];

async function resourceTick() {
  // Idle short-circuit (Phase 7c): the loop below already no-ops with zero
  // players — this just makes idle-safety explicit so future pre-loop work
  // doesn't silently start running against an empty server.
  if (!hasActivePlayers()) return;
  // Players whose five tracked resources changed this minute — persisted in ONE
  // batched write after the loop instead of a per-player round trip inside it. A
  // player who dies mid-loop is dropped (their respawn write already persisted them).
  const dirtyResources = new Set();
  // Weather is a GLOBAL state, identical for every player this tick — but it was
  // being re-derived inside the loop below, once per player, to read a single
  // string. getEnvironmentState() spreads getHUDPayload() + getForecast() +
  // getPowerMap(), and getPowerMap() allocates one object per power-model zone,
  // so a 50-player world was rebuilding a thousands-of-zones map fifty times a
  // minute for one field. Resolve it once.
  let worldWeather = null;
  try { worldWeather = getEnvironmentState(); } catch { worldWeather = null; }
  const isAshfall = worldWeather?.weatherType === 'ash';
  for (const [playerId, player] of world.players) {
    // Game-minutes elapsed this real tick, per the game-speed knob (state.timeScale).
    // A fractional scale (e.g. 1.5×) is carried in _gmAccum so no partial minute is
    // ever lost between ticks. At 1× this is exactly 1 per tick — unchanged behaviour.
    // Computed BEFORE the sleep branch: time passes for a sleeping body too, and the
    // temperature drift below needs the same clock the waking one gets.
    const gm = (() => {
      player._gmAccum = (player._gmAccum || 0) + getTimeScale();
      const whole = Math.floor(player._gmAccum);
      player._gmAccum -= whole;
      return whole;
    })();

    if (player.sleeping) {
      // The one piece of survival physics that follows you into bed. Everything else a
      // sleeper needs (hunger, thirst, healing, dreams) is tickSleep's business; core
      // temperature is not, because it's the same equation as the waking body's and must
      // not become a second copy of it. tickSleep reads the result and wakes on cold.
      driftBodyTemperature(player, gm);
      const result = await tickSleep(player, broadcastFn);
      if (result) broadcastFn(null, result, null, playerId);
      continue;
    }
    player._tickCounter = (player._tickCounter || 0) + gm;
    const prevSanity = player.sanity;
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

    // Hunger and thirst, banded. Unequal widths (fine resolution where the danger is), a
    // cadence that shortens as it worsens, and crossing treated as an event — see
    // appetite.js for why the single every-minute "You are very hungry." it replaced was
    // worse than saying nothing.
    for (const line of appetiteMessages(player, gm)) messages.push(line);

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
    driftBodyTemperature(player, gm);

    // SHIVERING, and the moment it stops. Starting to shiver is a warning; stopping is the
    // emergency, because it only happens two ways and both are bad — the tank is empty, or
    // you're already too cold to drive the muscles. Called out explicitly because the player
    // otherwise experiences the resulting jump in cooling rate as the game misbehaving.
    if (player._shivering && !player._wasShivering) messages.push('You start to shiver.');
    else if (!player._shivering && player._wasShivering) {
      messages.push((player.body_temp_c ?? 37) < 34
        ? '<span style="color:var(--red)">You stop shivering. That should frighten you more than it does.</span>'
        : 'You stop shivering.');
    }
    player._wasShivering = player._shivering;

    // …and its mirror. Sweating failing at the top is anhidrosis, and it is exactly as bad a
    // sign as shivering failing at the bottom — the difference between heat exhaustion and
    // heat stroke. The flavour pool has claimed this line for a long time; now it is earned.
    if (player._sweating && !player._wasSweating) messages.push('You break out in a sweat.');
    else if (!player._sweating && player._wasSweating) {
      messages.push((player.body_temp_c ?? 37) > 40
        ? '<span style="color:var(--red)">You stop sweating. Your skin goes hot and dry, and that is the worst thing that has happened today.</span>'
        : 'You stop sweating.');
    }
    player._wasSweating = player._sweating;

    // Temperature effects
    const tempC = player.body_temp_c;
    const isFreezing = tempC < 30;
    const isCold = tempC >= 30 && tempC < 34;
    const isOverheating = tempC > 42;
    const isHot = tempC > 40 && tempC <= 42;

    // Sustained dangerous temperature causes HP loss only after 5 minutes of
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
    // No separate "hot bodies get thirsty" drain any more: SWEATING owns thirst in the heat
    // now, and it does it better — it drains while you're actually defending yourself rather
    // than only once your core is already over 40°C, and it stops when anhidrosis sets in,
    // which is both correct and quietly the most sinister readout in the game. Keeping the
    // old flat drain alongside it would have been the same double-count that put a schwa on
    // the wrong formant: two models of one phenomenon, fighting.

    const flavorMsg = tempFlavorMessage(tempC, player._tickCounter);
    if (flavorMsg) messages.push(flavorMsg);

    // --- Ashfall breathing hazard ---
    // Outdoors during ashfall with no sealed mask → choking (drains stamina, then
    // HP). Re-applied each minute at 65-tick duration so it lapses ~5s after the
    // player masks up or gets indoors. Ash is a global weather state, not localized.
    const isIndoor = !!(zone?.flags?.is_interior || zone?.flags?.is_apartment || zone?.flags?.is_building);
    if (!isIndoor && !player.sealed && isAshfall) applyEffect(player, 'choking', 65);

    // --- Acid rain hazard ---
    // Unlike ash this is LOCAL: only tiles actually under the acid downpour bite
    // (getZonePrecip reports precipType 'acid' at the acid_rain event's peak).
    // Protection is coverage-based, so anything short of a full rainsuit still
    // hurts — see recomputeInsulation's player.acidCover.
    if (!isIndoor && (player.acidCover || 0) < 1) {
      let precip; try { precip = getZonePrecip(player.current_zone); } catch { precip = null; }
      if (precip?.precipType === 'acid') applyEffect(player, 'corroding', 65);
    }

    // --- Stamina drain ---
    // Extreme temperature saps stamina here; passive *regen* lives in restRegenTick
    // (15s), gated on being idle and boosted while sitting.
    const staminaMax = player.stamina_max ?? 100;
    player.stamina = player.stamina ?? staminaMax;
    if (isFreezing || isOverheating) {
      player.stamina = Math.max(0, player.stamina - 3);
    } else if (isCold || isHot) {
      player.stamina = Math.max(0, player.stamina - 1);
    }

    // --- Sleep deprivation ---
    // Past the point where fatigue is merely a stat penalty, staying up starts
    // costing you your mind. This is the tooth the fatigue system was missing:
    // the stat bands are deliberately gentle (condition.js says so in as many
    // words), so without this the correct play at 100% wrecked was to shrug and
    // keep going. Sanity is the right currency for it — the sanity plugin already
    // owns the consequences of a low meter, so this needs no new failure mode of
    // its own, and sleep is one of the few things that restores it.
    //
    // Reads fatigueOf, which a stimulant has already moved: being wired genuinely
    // holds the madness off, and the crash genuinely brings it on.
    const tired = fatigueOf(player);
    if (tired >= FATIGUE_RUINED && player.sanity > 0) {
      // Ramped, not flat: the second night frays you and the third one takes you
      // apart. Game-minutes per point of sanity, so at the top the meter empties
      // in about half an hour of play and staying up stops being a choice you can
      // keep making.
      const perPoint = tired >= 99 ? 1 : tired >= 93 ? 3 : 6;
      player._sleepDeprivedAccum = (player._sleepDeprivedAccum || 0) + gm;
      // Count the points the clock owes first, then take them in ONE call.
      // Not a tidy-up: adjustSanity resists losses and rounds, so draining a
      // point at a time would hand the whole drain to the rounding and let a
      // cool head stay up indefinitely for free.
      let owed = 0;
      while (player._sleepDeprivedAccum >= perPoint && owed < (player.sanity || 0)) {
        player._sleepDeprivedAccum -= perPoint;
        owed++;
      }
      const lost = owed ? -adjustSanity(player, -owed, 'sleep_deprivation') : 0;
      if (lost && Math.random() < 0.25) messages.push(SLEEP_DEPRIVED_MESSAGES[Math.floor(Math.random() * SLEEP_DEPRIVED_MESSAGES.length)]);
    } else {
      player._sleepDeprivedAccum = 0;
    }

    // Diff-gate the write (Phase 6): only persist when one of the five tracked
    // values actually changed since the last successful write in this process.
    // Basis is the in-memory stamp, never a DB re-read — avoids a round-trip and
    // any write-vs-read float drift, same rationale as the power-zone fix. An
    // idle player at full stats in a comfort zone now writes nothing.
    // body_temp_c is compared at 0.5°C granularity — it drifts a fraction of a
    // degree every outdoor tick, which would defeat the gate for every outdoor
    // player. The exact value is still written whenever any write happens; a
    // crash loses at most half a degree.
    const last = player._lastSavedResources;
    const changed = !last
      || last.hunger !== player.hunger || last.thirst !== player.thirst
      || last.hp !== player.hp || last.stamina !== player.stamina
      || last.sanity !== player.sanity
      || Math.round(last.body_temp_c * 2) !== Math.round(player.body_temp_c * 2);
    if (changed) {
      // Defer the write to the batched flush after the loop; the _lastSavedResources
      // stamp + counter resets happen there, only once the batch actually succeeds.
      dirtyResources.add(player);
    } else if (gm > 0) {
      // Tripwire: with game-time elapsing, thirst trends down (and forces a
      // write) within a few minutes — a long dry spell means the diff above is
      // wrongly reading "unchanged". Warn once rather than silently never saving.
      player._resourceNoWriteTicks = (player._resourceNoWriteTicks || 0) + 1;
      if (player._resourceNoWriteTicks >= RESOURCE_NOWRITE_TRIPWIRE_TICKS && !player._resourceTripwireWarned) {
        player._resourceTripwireWarned = true;
        console.warn(`[resourceTick] ${playerId}: no resource write in ${player._resourceNoWriteTicks} active ticks — diff-gate may be stuck "unchanged".`);
      }
    }

    const bodyTempChanged = player.body_temp_c !== prevBodyTemp;
    // FATIGUE RIDES A TICK IT WAS ALREADY PAYING FOR. `tired` is derived above,
    // sync and query-free, so carrying it costs nothing on the wire beyond a
    // number — but the gate above it fires on messages and temperature, and a
    // player standing still with a stable body temp could go a long while
    // without one. The BAND is what the HUD shows, and it changes four times
    // between sleeps, so pushing on a band change keeps the pane honest and the
    // socket quiet. Not a meter and not a per-tick write: nothing here is stored.
    const tiredBand = fatigueLabel(tired);
    const bandChanged = player._lastFatigueBand !== tiredBand;
    player._lastFatigueBand = tiredBand;
    if (messages.length || bodyTempChanged || bandChanged || player.sanity !== prevSanity) broadcastFn(null, { type:'resource_tick', messages, player_update:{hunger:player.hunger,thirst:player.thirst,hp:player.hp,stamina:player.stamina,body_temp_c:player.body_temp_c,sanity:player.sanity,fatigue:Math.round(tired)} }, null, playerId);

    if (player.hp <= 0) {
      await handlePlayerDeath(player, null, lethalCause);
      dirtyResources.delete(player); // respawn write already persisted this row — don't clobber it with pre-death stats
    }

    // Bodily pressure lives in the bodily plugin; horniness decay in the MIS
    // plugin (both on their own 1m ticks).
  }

  // One coalesced write for every player whose resources changed this minute.
  if (dirtyResources.size) {
    const players = [...dirtyResources];
    const rows = [], params = [];
    players.forEach((p, i) => {
      const b = i * 7;
      rows.push(`($${b + 1}::text, $${b + 2}::int, $${b + 3}::int, $${b + 4}::int, $${b + 5}::int, $${b + 6}::real, $${b + 7}::int)`);
      params.push(p.id, p.hunger, p.thirst, p.hp, p.stamina, p.body_temp_c, p.sanity);
    });
    try {
      await query(
        // sanity rides this write rather than a second one: the sleep-deprivation
        // bleed above is the first thing in resourceTick to move the meter, and a
        // per-minute round trip of its own for one integer would be the exact
        // mistake the batched write was built to stop.
        `UPDATE players AS pl SET hunger=v.hunger, thirst=v.thirst, hp=v.hp, stamina=v.stamina, body_temp_c=v.btemp, sanity=v.sanity
         FROM (VALUES ${rows.join(', ')}) AS v(id, hunger, thirst, hp, stamina, btemp, sanity)
         WHERE pl.id = v.id`,
        params
      );
      // Stamp + counter resets only after the batch succeeds (matches the old
      // per-row semantics: the stamp reflects the last SUCCESSFUL persist).
      for (const p of players) {
        p._lastSavedResources = { hunger: p.hunger, thirst: p.thirst, hp: p.hp, stamina: p.stamina, body_temp_c: p.body_temp_c, sanity: p.sanity };
        p._resourceNoWriteTicks = 0;
        p._resourceTripwireWarned = false;
      }
    } catch (err) {
      console.error(`resourceTick batched write failed: ${err.message}`);
    }
  }
}

const SIT_REGEN_MESSAGES = [
  `You relax and feel your body knitting itself back together.`,
  `The rest does you good. Your wounds feel a little less severe.`,
  `Sitting quietly, you feel some of the damage fading.`,
  `Your body takes advantage of the pause to recover.`,
  `A moment of stillness. You feel marginally less terrible.`,
];

// Rest/regen: stamina first (idle-gated, faster while sitting), then — only once
// stamina is topped off and only while sitting — slow HP recovery. Runs every 15s.
async function restRegenTick() {
  const now = Date.now();
  for (const [playerId, player] of world.players) {
    // Combat interrupts sitting outright; standing players just don't rest.
    if (player.posture === 'sitting' && (player.combatTargetId || player.pvpTargetId)) {
      forceStand(player, 'combat');
      continue;
    }

    const sitting = player.posture === 'sitting';
    // A comfortable home heals faster: flags.rest_multiplier on the current zone
    // scales both stamina recovery and HP knit-back (luxury units, safehouses).
    // Default 1 ⇒ no effect anywhere it isn't authored.
    const restMult = world.zones.get(player.current_zone)?.flags?.rest_multiplier ?? 1;
    const staminaMax = player.stamina_max ?? 100;
    player.stamina = player.stamina ?? staminaMax;
    const idle = now - (player._lastMoveAt ?? 0) >= IDLE_REGEN_MS;

    let hp = player.hp;
    let stamina = player.stamina;

    // Stamina recovers only when you've held still for the grace period. Sitting
    // recovers faster; either way it's scaled down by temperature stress.
    if (idle && stamina < staminaMax) {
      const base = sitting ? SIT_STAMINA_REGEN : STAND_STAMINA_REGEN;
      // Winded (ran the tank dry) throttles recovery until the penalty window lapses.
      const windedMult = (player._windedUntil ?? 0) > now ? WINDED_REGEN_MULT : 1;
      const gain = Math.max(0, Math.floor(base
        * tempRegenMultiplier(player.body_temp_c ?? 37)
        * deprivationRegenMultiplier(player)
        * enduranceRegenMultiplier(player)
        * wellFedRegenMultiplier(player, now)
        // A wounded torso is the one that shows up here: a body busy mending
        // itself has less left over to give back as stamina.
        * impairmentOf(player).staminaRegenMult
        * windedMult * restMult));
      if (gain > 0) stamina = Math.min(staminaMax, stamina + gain);
    }

    // HP only starts knitting back together once stamina is full — and only while
    // sitting. Deliberately slow.
    let healed = 0;
    if (sitting && stamina >= staminaMax && hp < player.hp_max) {
      healed = Math.min(Math.ceil(SIT_REGEN_HP * restMult), player.hp_max - hp);
      hp += healed;
    }

    if (hp === player.hp && stamina === player.stamina) continue;
    player.hp = hp;
    player.stamina = stamina;
    player._resDirty = true; // hp/stamina only — piggybacks the 1s flushDirtyResources write

    const messages = [];
    if (healed > 0) {
      const msg = SIT_REGEN_MESSAGES[Math.floor(Math.random() * SIT_REGEN_MESSAGES.length)];
      messages.push(`${msg} (+${healed} HP)`);
    }
    broadcastFn(null, {
      type: 'resource_tick',
      messages,
      player_update: { hp, stamina },
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
        // Position is RAM-only (boot places NPCs at home_zone); persist only hp.
        query('UPDATE npcs SET hp=$1 WHERE id=$2', [npc.hp, id]).catch(() => {});
      }
      continue;
    }

    // Frozen while riding aboard a vehicle (e.g. a charter pilot flying a run) —
    // no AI, no wander; the plugin restores them to the world when they land.
    // Same freeze while being escorted by a player (plugins/escort): the escortee
    // walks only when the player does, so its own graph must not stroll it back
    // to its shift between the player's steps.
    //
    // And the same again while a plugin owns the NPC's position outright
    // (`_charterHeld`: a charter pilot on shift or mid-booking, placed by
    // plugins/flight/charter.js). Two owners of one position means the graph walks
    // them out while the plugin puts them back, once a second, and the room hears
    // every departure and none of the returns.
    if (npc._aboard || npc._escorting || npc._charterHeld) continue;

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
    if (Math.random() > 0.05) continue; // ~5% chance per 15s tick → wanders roughly every 5 min (unchanged when the tick sped up)
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
    // announcements (same path as graph-driven NPCs). Position is RAM-only —
    // boot places NPCs back at home_zone.
    moveEntity(npc, dest, broadcastFn, query);
  }
}

// Runs every 24 hours (and on devpanel force-tick). Clears all corpses,
// ground items outside rented apartments, and zone stains.
export async function dailyMaintenance() {
  // --- Corpses (player + monster) ---
  // Dropped in memory here rather than through removeCorpse(): that helper spends
  // two round trips PER CORPSE deleting exactly the rows the two wholesale DELETEs
  // below are about to remove anyway. Everything else it does is this loop.
  for (const [id, c] of world.corpses) world.zones.get(c.zoneId)?.corpses.delete(id);
  world.corpses.clear();
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
  // The city cleans itself nightly; YOUR place doesn't. A zone a player owns keeps
  // its stains for a full rent cycle so that living somewhere clean means picking up
  // a mop (plugins/cleaning) — see server/engine/zone-filth.js for the why. Every
  // STAIN_KEEP_DAYS-th game day the sweep takes everything, as an absentee backstop.
  const deepClean = isDeepCleanDay(gameToday());
  const spared = [];
  for (const [zoneId, zone] of world.zones) {
    if (!deepClean && isOwnedZone(zoneId)) { if (filthCount(zoneId)) spared.push(zoneId); continue; }
    zone.stains = {};
  }
  // Stains are RAM-authoritative (stainZone writes no DB), so this statement only
  // keeps the column from carrying stale rows forward; the spared list is excluded
  // so a reboot can't hand an owner back a floor they already mopped.
  const { rowCount: stainsCleared } = spared.length
    ? await query(`UPDATE zones SET stains='{}' WHERE stains != '{}' AND id <> ALL($1::text[])`, [spared])
    : await query(`UPDATE zones SET stains='{}' WHERE stains != '{}'`);
  if (stainsCleared > 0) console.log(`[dailyMaintenance] Cleared stains from ${stainsCleared} zone(s).`);
  if (spared.length) console.log(`[dailyMaintenance] Left ${spared.length} owned room(s) dirty — their owners can mop.`);

  // --- Everything else that runs on the city's cleaning cadence ---
  // Plugins that hold their own nightly-swept state listen here rather than the
  // engine importing them (bodily's unflushed toilets is the first). `deepClean`
  // is passed so a listener can honour the same owned-room exemption the stains
  // above do, without re-deriving the cadence and drifting from it.
  emit('world.dailyMaintenance', { deepClean, gameDay: gameToday() });

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

  // One read for every landlord's tenant instead of one per apartment. The money
  // writes below are deliberately left per-player and untouched — batching a
  // credit deduction is not where I want to be clever.
  //
  // The cached row is UPDATED IN PLACE after each deduction, because a player who
  // owns two units must see the balance the first unit already took. Pre-fetching
  // without that would let them pay two rents out of one balance.
  const ownerIds = [...new Set(apts.map(a => a.owner_id).filter(Boolean))];
  const { rows: ownerRows } = ownerIds.length
    ? await query('SELECT id,credits,bank_credits,handle FROM players WHERE id = ANY($1)', [ownerIds])
    : { rows: [] };
  const ownersById = new Map(ownerRows.map(r => [r.id, r]));

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

    // Zone name for the message — zones live in the world Map, no query needed.
    const zoneName = world.zones.get(apt.zone_id)?.name ?? apt.zone_id;

    // Check if player has enough credits (pre-fetched above, kept current below)
    const p = ownersById.get(apt.owner_id);
    if (!p) {
      // Player deleted — release the apartment
      await releaseApartment(apt, apt.zone_id);
      continue;
    }
    const carried = p.credits || 0;
    const banked = p.bank_credits || 0;

    if (carried + banked < cost) {
      // Can't cover from the bank or on hand — evict
      await releaseApartment(apt, apt.zone_id);
      broadcastFn(null, {
        type: 'output',
        message: `<span style="color:var(--red)">EVICTION NOTICE — You couldn't cover the ${cost}₵ rent for <em>${zoneName}</em> in ${buildingName}. Your lease has been terminated and the unit re-listed. Next time, keep credits banked or on hand.</span>`,
      }, null, p.id);
      continue;
    }

    // Draft rent from the bank first, then carried credits for any shortfall.
    const fromBank = Math.min(banked, cost);
    const fromCarried = cost - fromBank;
    await query('UPDATE players SET bank_credits=bank_credits-$1, credits=credits-$2 WHERE id=$3', [fromBank, fromCarried, p.id]);
    // Keep the pre-fetched row honest for this player's OTHER units this cycle.
    p.bank_credits = banked - fromBank;
    p.credits = carried - fromCarried;

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
        message: `<span style="color:var(--yellow)">RENT COLLECTED — ${cost}₵ deducted for <em>${zoneName}</em> in ${buildingName}. Banked: ${live.bank_credits}₵ · On hand: ${live.credits}₵.</span>`,
        player_update: { credits: live.credits, bank_credits: live.bank_credits },
      }, null, p.id);
    }
  }
}
