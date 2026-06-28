import { query } from "../../models/db.js";
import { getZoneEnemies, getZoneCorpses, getZonePlayers, createCorpse, getCorpse, removeCorpse } from "../world.js";
import { playerAttackEnemy, isOnCooldown } from "../combat.js";
import { resolveForCommand } from "../sift.js";
import { awardSkillUse, skillCheck } from "../skills.js";
import { hasTag, tagValue, isStackable } from "../tags.js";
import { adjustCredits } from "../economy.js";
import { emit } from "../events.js";
import { randomUUID } from "crypto";

export async function resolveAttack(player, target, broadcast) {
	const { rows } = await query(
		`SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND jsonb_exists(i.tags,'weapon') LIMIT 1`,
		[player.id],
	);
	const equipped = rows[0];
	const dmg = equipped ? tagValue(equipped, "damage", {}) || {} : {};
	const wskill = equipped
		? tagValue(equipped, "weapon_skill") || "brawling"
		: "brawling";
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
				weapon_skill: "brawling",
				damage_type: "kinetic",
			};
	const result = await playerAttackEnemy(
		player,
		target.instanceId,
		weaponStats,
	);
	if (!result.success) return { type: "error", message: result.message };

	if (result.hit) {
		const skillId =
			wskill === "bladed"
				? "bladed"
				: wskill === "energy"
					? "electronics"
					: "brawling";
		await awardSkillUse(player.id, skillId, result.margin ?? 1);
	}

	// Emit the player→enemy outcome here — the single chokepoint every player
	// swing passes through: manual `attack`/`kill` and the auto-attack loop in
	// gameLoop.js. Quest objective tracking hangs off enemy.killed/enemy.attacked.
	if (result.killed) emit("enemy.killed", { actor: player, enemy: target });
	else emit("enemy.attacked", { actor: player, enemy: target });

	if (result.killed) {
		player.combatTargetId = null;
		const corpseId = `corpse_${result.enemyId || randomUUID()}`;
		// Loot now stays ON the corpse (owner = corpseId) until a player loots it,
		// instead of dropping to the zone ground.
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
			name: `${target.name}'s corpse`,
			zoneId: player.current_zone,
			expiresAt: Date.now() + 60 * 60 * 1000,
			butcher_table: result.butcher_table || [],
			butcher_difficulty: result.butcher_difficulty ?? 5,
		});
		const corpseLink = `<span class="action-link corpse-link" data-action="loot" data-target="${corpseId}" data-label="${target.name}'s corpse" title="Loot ${target.name}'s corpse">${target.name}'s corpse</span>`;
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

async function cmdAttack(targetStr, player, broadcast) {
	if (!targetStr) return { type: "error", message: "Attack what?" };
	if (targetStr === 'door' || targetStr.startsWith('door ')) {
		const { cmdAttackDoor } = await import('./doors.js');
		return cmdAttackDoor(targetStr.replace(/^door\s*/,'').trim(), player, broadcast);
	}
	const enemies = getZoneEnemies(player.current_zone);
	if (!enemies.length)
		return { type: "error", message: "Nothing to attack here." };
	const result = resolveForCommand(targetStr, enemies, player, { verb: 'attack', combatScope: true });
	if (result.type === 'none')
		return { type: "error", message: `Can't find "${targetStr}" here.` };
	const target = result.candidate;

	// On cooldown: switch target for next swing instead of erroring
	if (isOnCooldown(player.id, 'attack')) {
		player.combatTargetId = target.instanceId;
		return { type: "output", message: `Switching target to ${target.name}.` };
	}

	player.combatTargetId = target.instanceId;
	return resolveAttack(player, target, broadcast);
}

// Resolve a corpse in the player's current zone by id (preferred, from a click)
// or by a substring of its name (typed command).
function resolveCorpse(targetStr, player) {
	const direct = getCorpse(targetStr);
	if (direct && direct.zoneId === player.current_zone) return direct;
	const corpses = getZoneCorpses(player.current_zone);
	if (!targetStr) return corpses.length === 1 ? corpses[0] : null;
	const t = targetStr.toLowerCase();
	return corpses.find((c) => c.name.toLowerCase().includes(t)) || null;
}

async function corpseLootRows(corpseId) {
	const { rows } = await query(
		`SELECT pi.id,pi.item_id,pi.quantity,i.name,i.rarity,i.weight,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 ORDER BY i.name`,
		[corpseId],
	);
	return rows;
}

async function buildLootView(corpse, player) {
	const items = await corpseLootRows(corpse.id);
	const { rows: invItems } = await query(
		`SELECT pi.id,pi.item_id,pi.quantity,i.name,i.rarity,i.weight,i.tags
		 FROM player_inventory pi JOIN items i ON i.id=pi.item_id
		 WHERE pi.player_id=$1 AND pi.container_id IS NULL AND pi.is_equipped=0
		 ORDER BY i.name`,
		[player.id],
	);
	return {
		type: "loot_view",
		corpseId: corpse.id,
		corpseName: corpse.name,
		butcherable: (corpse.butcher_table || []).length > 0,
		items,
		invItems,
	};
}

// Move one inventory row to a player, stacking onto an existing stack when the
// item is stackable. Returns the item's display name.
async function giveRowToPlayer(item, player) {
	if (isStackable(item)) {
		const { rows: existing } = await query(
			"SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 AND container_id IS NULL",
			[player.id, item.item_id],
		);
		if (existing.length) {
			await query(
				"UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2",
				[item.quantity, existing[0].id],
			);
			await query("DELETE FROM player_inventory WHERE id=$1", [item.id]);
			return item.name;
		}
	}
	await query("UPDATE player_inventory SET player_id=$1 WHERE id=$2", [
		player.id,
		item.id,
	]);
	return item.name;
}

// Router for `loot <corpse>` (and corpse clicks): open the loot GUI if there's
// loot, butcher directly if empty-but-butcherable, else nothing. Also handles
// the by-hand form `loot <item> from <target>` to pull a single item.
async function cmdLootCorpse(targetStr, player, broadcast) {
	const fromMatch = targetStr.match(/^(.*?)\s+from\s+(.+)$/i);
	if (fromMatch) {
		const [, itemStr, corpseStr] = fromMatch;
		const corpse = resolveCorpse(corpseStr.trim(), player);
		if (!corpse) return { type: "error", message: "No corpse to loot here." };
		const items = await corpseLootRows(corpse.id);
		const match = items.find((r) =>
			r.name.toLowerCase().includes(itemStr.trim().toLowerCase()),
		);
		if (!match)
			return { type: "error", message: `No "${itemStr.trim()}" on ${corpse.name}.` };
		const name = await giveRowToPlayer(match, player);
		return { type: "loot", message: `You loot ${name} from ${corpse.name}.` };
	}
	const corpse = resolveCorpse(targetStr, player);
	if (!corpse) return { type: "error", message: "No corpse to loot here." };
	const items = await corpseLootRows(corpse.id);
	if (!items.length && (corpse.butcher_table || []).length)
		return cmdButcher(corpse.id, player, broadcast);
	// Always open the loot dialog — even if empty, so the player sees the state.
	return buildLootView(corpse, player);
}

// Take every item from a corpse at once.
async function cmdLootAll(args, player) {
	const corpseId = args[0];
	const corpse = corpseId ? getCorpse(corpseId) : null;
	if (!corpse || corpse.zoneId !== player.current_zone)
		return { type: "error", message: "That corpse is gone." };
	const items = await corpseLootRows(corpse.id);
	if (!items.length) {
		const view = await buildLootView(corpse, player);
		view.notify = "Nothing left to take.";
		return view;
	}
	let taken = 0;
	for (const item of items) {
		await giveRowToPlayer(item, player);
		taken++;
	}
	const view = await buildLootView(corpse, player);
	view.notify = `${taken} item${taken !== 1 ? 's' : ''} transferred to inventory.`;
	return view;
}

// Pull a single item from a corpse into inventory (GUI take button).
async function cmdLootId(args, player) {
	const [invId, corpseId] = args;
	const corpse = corpseId ? getCorpse(corpseId) : null;
	if (!corpse || corpse.zoneId !== player.current_zone)
		return { type: "error", message: "That corpse is gone." };
	const { rows } = await query(
		`SELECT pi.id,pi.item_id,pi.quantity,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2`,
		[invId, corpseId],
	);
	if (!rows.length) return { type: "error", message: "It's already gone." };
	const name = await giveRowToPlayer(rows[0], player);
	const view = await buildLootView(corpse, player);
	view.mainMsg = `You take ${name}.`;
	return view;
}

async function cmdButcher(targetStr, player, broadcast) {
	const corpse = resolveCorpse(targetStr, player);
	if (!corpse) return { type: "error", message: "No corpse to butcher here." };
	const table = corpse.butcher_table || [];
	if (!table.length)
		return { type: "error", message: `${corpse.name} can't be butchered.` };
	const { rows: tools } = await query(
		`SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'butchering') LIMIT 1`,
		[player.id],
	);
	if (!tools.length)
		return {
			type: "error",
			message: "You need a butchering tool (a knife will do) to do that.",
		};

	const difficulty = corpse.butcher_difficulty ?? 5;
	const ids = table.map((e) => e.item);
	const { rows: itemRows } = await query(
		"SELECT id,name,rarity,tags FROM items WHERE id = ANY($1)",
		[ids],
	);
	const itemById = new Map(itemRows.map((r) => [r.id, r]));

	const carved = [];
	const ruined = [];
	for (const entry of table) {
		const meta = itemById.get(entry.item);
		const itemName = meta?.name || entry.item;
		const check = await skillCheck(player, "butchering", difficulty);
		await awardSkillUse(player.id, "butchering", check.margin);
		if (check.success) {
			const qty = Array.isArray(entry.qty)
				? Math.floor(Math.random() * (entry.qty[1] - entry.qty[0] + 1)) +
					entry.qty[0]
				: entry.qty || 1;
			const { rows: existing } = isStackable(meta)
				? await query(
						"SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 AND container_id IS NULL LIMIT 1",
						[player.id, entry.item],
					)
				: { rows: [] };
			if (existing.length) {
				await query(
					"UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2",
					[qty, existing[0].id],
				);
			} else {
				await query(
					"INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,1.0)",
					[randomUUID(), player.id, entry.item, qty],
				);
			}
			const label = qty > 1 ? `${qty}x ${itemName}` : itemName;
			const rarity = meta?.rarity || "common";
			carved.push(
				`<span class="action-link room-item item-rarity-${rarity}" data-action="examine" data-target="${itemName}" title="Examine ${itemName}">${label}</span>`,
			);
		} else {
			ruined.push(itemName);
		}
	}

	if (ruined.length) {
		player.covered_in_blood = 1;
		await query("UPDATE players SET covered_in_blood=1 WHERE id=$1", [player.id]);
	}
	await removeCorpse(corpse.id);
	broadcast(
		player.current_zone,
		{ type: "zone_event", message: `${player.handle} butchers ${corpse.name}.`, refresh: true },
		player.id,
	);

	let message = `You butcher ${corpse.name}.`;
	if (carved.length) message += `\nYou carve free: ${carved.join(", ")}.`;
	if (ruined.length) message += `\nYou botch and ruin: ${ruined.join(", ")}.`;
	if (ruined.length) message += `\nYou're covered in blood.`;
	return { type: "loot", message, closeLoot: true };
}

const STEAL_COOLDOWN_MS = 60000;
const stealCooldowns = new Map();

async function cmdSteal(targetStr, player, broadcast) {
	if (!targetStr) return { type: "error", message: "Steal from whom?" };
	const { getZone } = await import("../world.js");
	const zone = getZone(player.current_zone);
	if (zone?.is_safe_zone)
		return { type: "error", message: "Too many witnesses. Not here." };

	const last = stealCooldowns.get(player.id) || 0;
	if (Date.now() - last < STEAL_COOLDOWN_MS) {
		return {
			type: "error",
			message: `Too soon to try that again. (${Math.ceil((STEAL_COOLDOWN_MS - (Date.now() - last)) / 1000)}s)`,
		};
	}

	const others = getZonePlayers(player.current_zone).filter(
		(p) => p.id !== player.id,
	);
	let target = others.find((p) =>
		p.handle.toLowerCase().includes(targetStr.toLowerCase()),
	);
	let targetSleeping = false;
	if (!target) {
		const { rows } = await query(
			`SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
			[`%${targetStr.toLowerCase()}%`, player.current_zone],
		);
		if (rows.length) { target = rows[0]; targetSleeping = true; }
	}
	if (!target)
		return { type: "error", message: `Can't find "${targetStr}" here.` };

	stealCooldowns.set(player.id, Date.now());
	if ((target.credits || 0) <= 0)
		return {
			type: "error",
			message: `${target.handle} isn't carrying any credits.`,
		};

	if (!targetSleeping) {
		const result = await skillCheck(player, "deception", 7);
		const caught = !result.success;

		if (caught) {
			broadcast(
				player.current_zone,
				{
					type: "zone_event",
					message: `${player.handle} tries to pick ${target.handle}'s pocket and gets caught red-handed.`,
				},
				player.id,
			);
			return {
				type: "error",
				message: `You go for ${target.handle}'s pocket. They notice immediately. Everyone noticed, actually.`,
			};
		}
	}

	const amount = Math.min(
		target.credits,
		Math.ceil(target.credits * (0.1 + Math.random() * 0.2)),
	);
	await adjustCredits(target, -amount);
	await adjustCredits(player, amount);
	return {
		type: "steal",
		message: targetSleeping
			? `You rifle through ${target.handle}'s pockets while they sleep. ${amount}c richer.`
			: `You lift ${amount}c off ${target.handle} without them noticing a thing.`,
		player_update: { credits: player.credits },
	};
}

function cmdStop(player) {
	if (!player.combatTargetId)
		return { type: "output", message: "You aren't attacking anything." };
	player.combatTargetId = null;
	return { type: "output", message: "You disengage." };
}

export const handlers = {
	attack: (args, raw, player, broadcast) =>
		cmdAttack(args.join(" "), player, broadcast),
	kill: (args, raw, player, broadcast) =>
		cmdAttack(args.join(" "), player, broadcast),
	k: (args, raw, player, broadcast) =>
		cmdAttack(args.join(" "), player, broadcast),
	stop: (args, raw, player) => cmdStop(player),
	disengage: (args, raw, player) => cmdStop(player),
	loot: (args, raw, player, broadcast) =>
		cmdLootCorpse(args.join(" "), player, broadcast),
	lootid: (args, raw, player) => cmdLootId(args, player),
	lootall: (args, raw, player) => cmdLootAll(args, player),
	butcher: (args, raw, player, broadcast) =>
		cmdButcher(args.join(" "), player, broadcast),
	closeloot: () => null,
	steal: (args, raw, player, broadcast) =>
		cmdSteal(args.join(" "), player, broadcast),
};
