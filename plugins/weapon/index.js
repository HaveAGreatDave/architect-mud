/**
 * Weapon plugin — owns the player-initiated combat path (ADR-0001): target
 * resolution (`cmdAttack`), the player→enemy and player→NPC swing
 * (`resolveAttack` / `resolveAttackNpc`, including kill handling, corpse+loot
 * creation, and the enemy.killed / enemy.attacked emissions), and the
 * one-sided sleep-kill loop (`offlineSleepSwing`).
 *
 * The 1-second auto-attack tick stays raw in gameLoop.js (latency-critical);
 * it reaches these functions through registerPlayerCombat() — a plain function
 * reference injected at plugin load, never the Action dispatcher. Typed
 * `attack`/`kill`/`k` dispatch the ATTACK Action registered below.
 *
 * Combat *math* (playerAttackEnemy, pvpSwing, cooldowns, enemy AI) stays in
 * the engine — it's shared with the enemy-combat tick.
 */
import { randomUUID } from 'crypto';
import { query, logActivity } from '../../server/models/db.js';
import { getZoneEnemies, getZonePlayers, getZoneNpcs, getLivePlayer, createCorpse } from '../../server/engine/world.js';
import { playerAttackEnemy, playerAttackNpc, isOnCooldown, getCooldownRemaining, pvpSwingSleeping, registerPlayerCombat, killEnemyInstance, killNpcInstance } from '../../server/engine/combat.js';
import { resolveForCommand, resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { awardSkillUse } from '../../server/engine/skills.js';
import { tagValue } from '../../server/engine/tags.js';
import { emit } from '../../server/engine/events.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { forceStand } from '../../server/engine/posture.js';
import { getZoneProtection } from '../../server/engine/protection.js';

// The weapon_skill tag now carries the combat skill id directly. Guard against
// stale/garbage values (and the old blunt/bladed/energy strings on un-migrated
// weapons) by falling back to fists.
const COMBAT_WEAPON_SKILLS = new Set(['fists', 'blades', 'clubs', 'firearms', 'science']);
function weaponSkillId(wskill) {
	return COMBAT_WEAPON_SKILLS.has(wskill) ? wskill : 'fists';
}

// Turn a killed-result (from playerAttackEnemy or killEnemyInstance) into a
// lootable corpse: loot rides on the corpse (owner = corpseId) until looted, not
// dropped to the ground. Returns the clickable corpse link. Caller broadcasts.
async function spawnEnemyCorpse(player, targetName, result) {
	const corpseId = `corpse_${result.enemyId || randomUUID()}`;
	if (result.loot?.length) {
		for (const drop of result.loot) {
			await query(
				"INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,0.8)",
				[randomUUID(), corpseId, drop.item_id, drop.quantity],
			);
		}
	}
	createCorpse({
		id: corpseId,
		name: `${targetName}'s corpse`,
		zoneId: player.current_zone,
		expiresAt: Date.now() + 60 * 60 * 1000,
		butcher_table: result.butcher_table || [],
		butcher_difficulty: result.butcher_difficulty ?? 5,
	});
	return `<span class="action-link corpse-link" data-action="loot" data-target="${corpseId}" data-label="${targetName}'s corpse" title="Loot ${targetName}'s corpse">${targetName}'s corpse</span>`;
}

export async function resolveAttack(player, target, broadcast) {
	const { rows } = await query(
		`SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND jsonb_exists(i.tags,'weapon') LIMIT 1`,
		[player.id],
	);
	const equipped = rows[0];
	const dmg = equipped ? tagValue(equipped, "damage", {}) || {} : {};
	const wskill = equipped
		? tagValue(equipped, "weapon_skill") || "fists"
		: "fists";
	const weaponStats = equipped
		? {
				damage_min: dmg.min,
				damage_max: dmg.max,
				status_chance: tagValue(equipped, "status_chance"),
				weapon_skill: wskill,
				damage_type: tagValue(equipped, "damage_type") || "kinetic",
			}
		: {
				damage_min: 2,
				damage_max: 4,
				weapon_skill: "fists",
				damage_type: "kinetic",
			};
	const result = await playerAttackEnemy(
		player,
		target.instanceId,
		weaponStats,
	);
	if (!result.success) return { type: "error", message: result.message };

	// The weapon_skill tag is the skill id directly (fists/blades/clubs/firearms/
	// science). Train it on every swing — hit or miss — the closer the roll, the
	// better you learn (abs margin, see awardIp).
	await awardSkillUse(player.id, weaponSkillId(wskill), result.margin ?? 1);

	// Emit the player→enemy outcome here — the single chokepoint every player
	// swing passes through: manual `attack`/`kill` and the auto-attack loop in
	// gameLoop.js. Quest objective tracking hangs off enemy.killed/enemy.attacked.
	if (result.killed) emit("enemy.killed", { actor: player, enemy: target });
	else emit("enemy.attacked", { actor: player, enemy: target, critical: result.critical });

	if (result.killed) {
		player.combatTargetId = null;
		const corpseLink = await spawnEnemyCorpse(player, target.name, result);
		broadcast(
			player.current_zone,
			{
				type: "zone_event",
				message: `${target.name} has fallen. ${corpseLink}`,
				refresh: true,
			},
			player.id,
		);
		result.corpseLink = corpseLink;
	} else {
		broadcast(
			player.current_zone,
			{
				type: "zone_event",
				message: `${player.handle} attacks ${target.name}.`,
				refresh: true,
			},
			player.id,
		);
	}
	return {
		type: "combat",
		message: result.message,
		killed: result.killed || false,
		corpseLink: result.corpseLink || null,
	};
}

function broadcastNpcSpeech(npc, speech, zoneId, broadcast) {
	if (!speech) return;
	const verb = speech.shout ? 'shouts' : 'says';
	broadcast(zoneId, { type: 'zone_event', message: `${npc.name} ${verb}, "${speech.line}"` });
}

export async function resolveAttackNpc(player, npc, broadcast) {
	const { rows } = await query(
		`SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND jsonb_exists(i.tags,'weapon') LIMIT 1`,
		[player.id],
	);
	const equipped = rows[0];
	const dmg = equipped ? tagValue(equipped, "damage", {}) || {} : {};
	const wskill = equipped ? tagValue(equipped, "weapon_skill") || "fists" : "fists";
	const weaponStats = equipped
		? { damage_min: dmg.min, damage_max: dmg.max, weapon_skill: wskill, damage_type: tagValue(equipped, "damage_type") || "kinetic" }
		: { damage_min: 2, damage_max: 4, weapon_skill: "fists", damage_type: "kinetic" };

	const result = await playerAttackNpc(player, npc.id, weaponStats);
	if (!result.success) return { type: "error", message: result.message };

	// Assaulting an NPC is a crime (and killing a police NPC a graver one) — the
	// surveillance/wanted system charges it if witnessed. Emit the act, not the hit.
	emit("npc.attacked", { actor: player, npc });
	if (result.killed) emit("npc.killed", { actor: player, npc });

	if (result.hit) broadcastNpcSpeech(npc, result.npcSpeech, player.current_zone, broadcast);
	if (result.killed) {
		player.npcCombatTargetId = null;
		broadcast(player.current_zone, { type: "zone_event", message: `${npc.name} has been killed by ${player.handle}.`, refresh: true }, player.id);
	} else {
		broadcast(player.current_zone, { type: "zone_event", message: `${player.handle} attacks ${npc.name}.`, refresh: true }, player.id);
	}
	return { type: "combat", message: result.message, killed: result.killed || false };
}

export async function cmdAttack(targetStr, player, broadcast) {
	if (!targetStr) return { type: "error", message: "Attack what?" };
	// Initiating an attack interrupts any activity posture (sitting, butchering,
	// scavenging, …) — posture is the orchestrator; the activity plugins' ticks
	// see the posture change and discard their own state.
	forceStand(player, 'attacking');
	if (targetStr === 'door' || targetStr.startsWith('door ')) {
		const { cmdAttackDoor } = await import('../../server/engine/commands/doors.js');
		return cmdAttackDoor(targetStr.replace(/^door\s*/,'').trim(), player, broadcast);
	}
	const enemies = getZoneEnemies(player.current_zone);
	const result = enemies.length
		? resolveForCommand(targetStr, enemies, player, { verb: 'attack', combatScope: true })
		: { type: 'none' };

	if (result.type !== 'none') {
		const target = result.candidate;
		if (isOnCooldown(player.id, 'attack')) {
			player.combatTargetId = target.instanceId;
			player.npcCombatTargetId = null;
			return { type: "output", message: `Switching target to ${target.name}.` };
		}
		player.combatTargetId = target.instanceId;
		player.npcCombatTargetId = null;
		return resolveAttack(player, target, broadcast);
	}

	// No enemy matched — check for an NPC in the zone
	const zoneNpcs = getZoneNpcs(player.current_zone).filter(n => !n._dead);
	if (zoneNpcs.length) {
		const npcPool = zoneNpcs.map(n => ({ ...n, name: n.name }));
		const npcr = siftResolve(targetStr, npcPool);
		if (npcr.type === 'match') {
			const targetNpc = npcr.candidate;
			if (isOnCooldown(player.id, 'attack')) {
				player.npcCombatTargetId = targetNpc.id;
				player.combatTargetId = null;
				return { type: "output", message: `Switching target to ${targetNpc.name}.` };
			}
			player.npcCombatTargetId = targetNpc.id;
			player.combatTargetId = null;
			return resolveAttackNpc(player, targetNpc, broadcast);
		}
	}

	// No enemy or NPC matched — check for destructible infrastructure (generators,
	// junction boxes) before falling through to players.
	{
		const { cmdAttackDestructible } = await import('../../server/engine/commands/infrastructure.js');
		const infra = await cmdAttackDestructible(targetStr, player, broadcast);
		if (infra) return infra;
	}

	// No enemy or NPC matched — check for a player in the zone (live first, then offline)
	const liveOthers = getZonePlayers(player.current_zone).filter((p) => p.id !== player.id);
	const attackPool = liveOthers.map(p => ({ ...p, name: p.handle }));
	const atkr = siftResolve(targetStr, attackPool);
	if (atkr.type === 'ambiguous') {
		// SIFT's builtin replay path doesn't cover plugin verbs — replay the pick
		// through the ATTACK Action instead (dispatchParam feeds params.candidate).
		createSelectionState(player.id, atkr.candidates, { verb: 'attack', dispatchType: 'ATTACK', dispatchParam: 'candidate' });
		return { type: 'output', message: formatSelectionPage({ allCandidates: atkr.candidates, visibleIndex: 0, pageSize: 5 }) };
	}
	let targetPlayer = atkr.type === 'match' ? (getLivePlayer(atkr.candidate.id) || atkr.candidate) : null;
	let targetIsLive = !!targetPlayer;
	if (!targetPlayer) {
		const { rows } = await query(
			`SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND id!=$3 LIMIT 1`,
			[`%${targetStr.toLowerCase()}%`, player.current_zone, player.id],
		);
		if (rows.length) {
			const live = getLivePlayer(rows[0].id);
			targetPlayer = live || rows[0];
			targetIsLive = !!live;
		}
	}
	if (!targetPlayer)
		return { type: "error", message: `Can't find "${targetStr}" here.` };

	// Live player: engage mutual auto-attack — pvpSwing handles all actual hits.
	if (targetIsLive) {
		if (player.pvpTargetId === targetPlayer.id)
			return { type: "output", message: `You're already fighting ${targetPlayer.handle}.` };
		if (isOnCooldown(player.id, 'attack'))
			return { type: "error", message: `You're still recovering. (${(getCooldownRemaining(player.id, 'attack') / 1000).toFixed(1)}s)` };
		player.pvpTargetId = targetPlayer.id;
		targetPlayer.pvpTargetId = player.id;
		if (targetPlayer.sleeping) {
			// Wake the sleeping player so they can fight back.
			targetPlayer.sleeping = null;
			broadcast(null, { type: 'output', message: `${player.handle} attacks you, jolting you awake!` }, null, targetPlayer.id);
		} else {
			broadcast(null, { type: 'output', message: `${player.handle} is attacking you!` }, null, targetPlayer.id);
		}
		broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} engages ${targetPlayer.handle} in combat!` }, player.id, null, targetPlayer.id);
		emit('player.attacked', { attacker: player, target: targetPlayer });
		return { type: "combat", message: `You close in on ${targetPlayer.handle}. Combat begins.` };
	}

	// Offline sleeping player: start a one-sided auto-attack loop.
	if (getZoneProtection(targetPlayer.current_zone)) {
		return { type: "error", message: `A quantum forcefield crackles between you and ${targetPlayer.handle}. You can't reach them.` };
	}

	if (isOnCooldown(player.id, 'attack'))
		return { type: "error", message: `You're still recovering. (${(getCooldownRemaining(player.id, 'attack') / 1000).toFixed(1)}s)` };

	if (player.offlinePvpTargetId === targetPlayer.id)
		return { type: "output", message: `You're already attacking ${targetPlayer.handle}.` };

	player.offlinePvpTargetId = targetPlayer.id;
	broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} attacks ${targetPlayer.handle} in their sleep!` }, player.id);
	emit('player.attacked', { attacker: player, target: targetPlayer });
	return { type: "combat", message: `You begin attacking ${targetPlayer.handle} while they sleep.` };
}

export async function offlineSleepSwing(attacker, targetId, broadcast) {
	const { rows } = await query(`SELECT * FROM players WHERE id=$1`, [targetId]);
	if (!rows.length) { attacker.offlinePvpTargetId = null; return; }
	const target = rows[0];

	// Zone protection (forcefield): abort attack and notify attacker.
	if (getZoneProtection(target.current_zone)) {
		attacker.offlinePvpTargetId = null;
		broadcast(null, { type: 'output', message: `A quantum forcefield repels your attack. ${target.handle} is protected.` }, null, attacker.id);
		return;
	}

	// If target came online, switch to mutual PvP.
	const liveTarget = getLivePlayer(targetId);
	if (liveTarget) {
		attacker.offlinePvpTargetId = null;
		attacker.pvpTargetId = liveTarget.id;
		liveTarget.pvpTargetId = attacker.id;
		if (liveTarget.sleeping) liveTarget.sleeping = null;
		broadcast(null, { type: 'output', message: `${attacker.handle} attacks you, jolting you awake!` }, null, liveTarget.id);
		broadcast(attacker.current_zone, { type: 'zone_event', message: `${attacker.handle} engages ${liveTarget.handle} in combat!` }, attacker.id, null, liveTarget.id);
		broadcast(null, { type: 'combat', message: `${liveTarget.handle} woke up — combat begins!` }, null, attacker.id);
		return;
	}

	if (target.current_zone !== attacker.current_zone) {
		attacker.offlinePvpTargetId = null;
		broadcast(null, { type: 'output', message: `${target.handle} is no longer here. Combat ends.` }, null, attacker.id);
		return;
	}

	const result = await pvpSwingSleeping(attacker, target);
	if (!result) return;

	broadcast(null, { type: 'combat', message: result.attackerMsg, auto: true }, null, attacker.id);
	broadcast(attacker.current_zone, { type: 'zone_event', message: `${attacker.handle} attacks ${target.handle} in their sleep.` }, attacker.id);

	if (result.killed) {
		attacker.offlinePvpTargetId = null;
		// Reuse the canonical death mechanics so corpse capacity + starter outfit can't
		// drift from the live-death path. (Dynamic import avoids a load-time cycle with gameLoop.)
		const { spawnPlayerCorpse, equipStarterOutfit } = await import("../../server/engine/gameLoop.js");
		const { fireHook } = await import("../../server/engine/plugins.js");
		await query(`UPDATE players SET hp=0, offline_sleeping=FALSE, died_offline=TRUE WHERE id=$1`, [target.id]);
		const { corpseId, corpseName } = await spawnPlayerCorpse(target, attacker.current_zone);
		await query(`UPDATE players SET hp=$1, current_zone=anchor_zone, deaths=deaths+1 WHERE id=$2`, [target.hp_max ?? 100, target.id]);
		equipStarterOutfit(target.id, target.biological_sex || 'male');

		attacker.player_kills = (attacker.player_kills || 0) + 1;
		query('UPDATE players SET player_kills=player_kills+1 WHERE id=$1', [attacker.id]).catch(() => {});
		logActivity('pvp_kill', attacker.handle, null, target.handle);
		// Fire the same death signals the live path does, so murder news, death SFX, and
		// admin-protection retaliation apply to sleep-kills too (previously skipped).
		emit('player.death', { player: target, killer: attacker, cause: { type: 'pvp', label: `Killed by ${attacker.handle}` }, deathZone: attacker.current_zone });
		fireHook('player.death', target, attacker).catch(() => {});
		const corpseLink = `<span class="action-link corpse-link" data-action="loot" data-target="${corpseId}" data-label="${corpseName}" title="Loot ${corpseName}">${corpseName}</span>`;
		broadcast(attacker.current_zone, { type: "zone_event", message: `${target.handle} has died. ${corpseLink}`, refresh: true }, attacker.id);
		broadcast(null, { type: "combat", message: `You kill ${target.handle}.`, killed: true, corpseLink, auto: true }, null, attacker.id);
	}
}

// Admin toy: a screen-clearing energy beam that instantly kills through the real
// death paths — enemies (kill credit + loot + lootable corpse), NPCs (dead +
// 60s respawn), and players (the canonical handlePlayerDeath: corpse + respawn).
// `kamehameha <name>` targets one of any type (resolved enemy→NPC→player, exactly
// like `attack`); a bare `kamehameha` blasts every ENEMY in the room (it won't
// mass-wipe NPCs/players — name them to gib those). Emits the same kill events a
// real swing does, so quest tracking / audio / gossip / crime-witnessing fire.
// Admin-only.
const siftPick = (r) => r.type === 'match' ? r.candidate : r.type === 'ambiguous' ? r.candidates[0] : null;

export async function cmdKamehameha(targetStr, player, broadcast) {
	if (player.role !== 'admin') {
		return { type: 'error', message: `Unknown command: "kamehameha". Type HELP for commands.` };
	}
	const zoneId = player.current_zone;
	const enemies = getZoneEnemies(zoneId);

	let enemyTargets = [];
	let npcTarget = null;
	let playerTarget = null;

	if (targetStr) {
		// Same precedence as `attack`: enemy → NPC → live player in the room.
		const er = enemies.length ? resolveForCommand(targetStr, enemies, player, { verb: 'kamehameha', combatScope: true }) : { type: 'none' };
		if (er.type !== 'none') {
			enemyTargets = [er.candidate];
		} else {
			const npcs = getZoneNpcs(zoneId).filter(n => !n._dead);
			npcTarget = npcs.length ? siftPick(siftResolve(targetStr, npcs)) : null;
			if (!npcTarget) {
				const others = getZonePlayers(zoneId).filter(p => p.id !== player.id).map(p => ({ ...p, name: p.handle }));
				const cand = others.length ? siftPick(siftResolve(targetStr, others)) : null;
				if (cand) playerTarget = getLivePlayer(cand.id) || null;
			}
		}
		if (!enemyTargets.length && !npcTarget && !playerTarget) {
			return { type: 'error', message: `Nothing here matches "${targetStr}".` };
		}
	} else {
		if (!enemies.length) return { type: 'error', message: 'Nothing here to obliterate.' };
		enemyTargets = enemies;
	}

	// Charge-up, seen by the whole room (caller included).
	broadcast(zoneId, {
		type: 'zone_event',
		message: `<span class="battle-cry">${player.handle} draws both hands back — a sphere of blue-white light screams into being. KA…ME…HA…ME…</span>`,
	});

	const corpseLinks = [];
	for (const target of enemyTargets) {
		const kill = killEnemyInstance(player, target.instanceId);
		if (!kill) continue;
		emit('enemy.killed', { actor: player, enemy: target });
		corpseLinks.push(await spawnEnemyCorpse(player, target.name, kill));
	}
	if (npcTarget) {
		const npc = killNpcInstance(npcTarget.id);
		if (npc) emit('npc.killed', { actor: player, npc });
	}
	if (playerTarget) {
		// The canonical player-death path (corpse + respawn + death signals). killer
		// null + an admin cause, so it isn't logged as a PvP kill.
		const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
		await handlePlayerDeath(playerTarget, null, { type: 'admin', label: 'Erased by a kamehameha' });
	}
	player.combatTargetId = null;

	const blast = `<span class="crit-tag">HAAAAAAA!</span> A pillar of light tears through the room.${corpseLinks.length ? ' ' + corpseLinks.join(' ') : ''}`;
	broadcast(zoneId, { type: 'zone_event', message: blast, refresh: true }, player.id);

	return { type: 'combat', message: blast, killed: true };
}

// Universal self-kill: run yourself through the canonical death path (corpse +
// clone-vat respawn + all death signals), killer null so it isn't a PvP kill.
// No item, target, or role required — an escape hatch for a player wedged in a
// broken state (e.g. a stuck flight session) as much as it is a quick way to
// test the respawn flow.
export async function cmdSeppuku(player, broadcast) {
	broadcast(player.current_zone, {
		type: 'zone_event',
		message: `<span class="crit-tag">${player.handle} kneels, draws a blade, and commits seppuku.</span>`,
		refresh: true,
	}, player.id);
	const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
	await handlePlayerDeath(player, null, { type: 'suicide', label: 'Seppuku' });
	return { type: 'combat', message: '', killed: true };
}

// The auto-attack tick in gameLoop.js sustains combat through these — raw
// function references, never the Action dispatcher (ADR-0001 hot path).
registerPlayerCombat({ resolveAttack, resolveAttackNpc, offlineSleepSwing });

// Player-initiated combat is an Action. `params.candidate` carries a SIFT
// selection replay (a player pick from an ambiguous `attack <name>`).
registerAction({
	type: 'ATTACK',
	handler: async ({ actor, params, context }) => {
		const targetStr = params.targetStr ?? params.candidate?.name;
		return cmdAttack(targetStr, actor, context.broadcast);
	},
});

async function attack(args, raw, player, broadcast) {
	const targetStr = args.join(' ');
	return dispatchAction({ type: 'ATTACK', actor: player, params: { targetStr }, context: { broadcast } });
}

export const specializedActions = [
	{ verb: 'attack', handler: attack },
	{ verb: 'kill',   handler: attack },
	{ verb: 'k',      handler: attack },
];

export const commands = {
	kamehameha: (args, raw, player, broadcast) => cmdKamehameha(args.join(' '), player, broadcast),
	seppuku: (args, raw, player, broadcast) => cmdSeppuku(player, broadcast),
};

console.log('[weapon] Plugin loaded.');
