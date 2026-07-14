import { query } from "../../models/db.js";
import { getZoneCorpses, getZonePlayers, getCorpse } from "../world.js";
import { getZoneProtection } from "../protection.js";
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from "../sift.js";
import { awardSkillUse, skillCheck } from "../skills.js";
import { isStackable } from "../tags.js";
import { titleCaseName } from "../text.js";
import { emit } from "../events.js";
import { randomUUID } from "crypto";

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
		`SELECT pi.id,pi.item_id,pi.quantity,pi.custom_data,i.name,i.weight,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 ORDER BY i.name`,
		[corpseId],
	);
	return rows;
}

export async function buildLootView(corpse, player) {
	const items = await corpseLootRows(corpse.id);
	const { rows: invItems } = await query(
		`SELECT pi.id,pi.item_id,pi.quantity,i.name,i.weight,i.tags
		 FROM player_inventory pi JOIN items i ON i.id=pi.item_id
		 WHERE pi.player_id=$1 AND pi.container_id IS NULL AND pi.is_equipped=0
		 ORDER BY i.name`,
		[player.id],
	);
	const used = items.reduce((sum, r) => sum + (Number(r.weight) || 0) * (Number(r.quantity) || 0), 0);
	// A credit chip carries its denomination in custom_data.name — show that; else Title Case.
	for (const r of items) {
		const cn = (typeof r.custom_data === 'string' ? (() => { try { return JSON.parse(r.custom_data); } catch { return null; } })() : r.custom_data)?.name;
		r.name = cn || titleCaseName(r.name);
	}
	for (const r of invItems) r.name = titleCaseName(r.name);
	return {
		type: "loot_view",
		corpseId: corpse.id,
		corpseName: corpse.name,
		butcherable: (corpse.butcher_table || []).length > 0,
		items,
		invItems,
		capacity: corpse.capacity != null ? corpse.capacity : null,
		usedWeight: used,
	};
}

// Move one inventory row to a player, stacking onto an existing stack when the
// item is stackable. Returns the item's display name. Emits item.taken like the
// ground-pickup path so quest 'retrieve' objectives advance on corpse loot too.
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
			emit('item.taken', { actor: player, item, zone: player.current_zone });
			emit('inventory.changed', { actor: player, zone: player.current_zone });
			return item.name;
		}
	}
	await query("UPDATE player_inventory SET player_id=$1 WHERE id=$2", [
		player.id,
		item.id,
	]);
	emit('item.taken', { actor: player, item, zone: player.current_zone });
	emit('inventory.changed', { actor: player, zone: player.current_zone });
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
	if (corpse) {
		const items = await corpseLootRows(corpse.id);
		if (!items.length && (corpse.butcher_table || []).length) {
			// Empty-but-butcherable: start the carve. Coupling to the butchering
			// plugin is purely through the action registry (no imports either way).
			const { dispatchAction } = await import("../actions.js");
			return dispatchAction({ type: "BUTCHER", actor: player, params: { targetStr: corpse.id }, context: { broadcast } });
		}
		return buildLootView(corpse, player);
	}

	// No corpse — check for a player in the zone (live first, then offline)
	const liveOthers = getZonePlayers(player.current_zone).filter((p) => p.id !== player.id);
	const lootPool = liveOthers.map(p => ({ ...p, name: p.handle }));
	const lootr = siftResolve(targetStr, lootPool);
	if (lootr.type === 'ambiguous') {
		createSelectionState(player.id, lootr.candidates, { verb: 'loot' });
		return { type: 'output', message: formatSelectionPage({ allCandidates: lootr.candidates, visibleIndex: 0, pageSize: 5 }) };
	}
	let targetPlayer = lootr.type === 'match' ? lootr.candidate : null;
	if (!targetPlayer) {
		const { rows } = await query(
			`SELECT id, handle, offline_sleeping FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND id!=$3 LIMIT 1`,
			[`%${targetStr.toLowerCase()}%`, player.current_zone, player.id],
		);
		if (rows.length) targetPlayer = rows[0];
	}
	if (!targetPlayer) return { type: "error", message: "No corpse to loot here." };
	if (getZoneProtection(player.current_zone)) {
		return { type: "error", message: `A quantum forcefield crackles between you and ${targetPlayer.handle}. You can't touch them.` };
	}

	// Rifling through a sleeping victim's pockets is a deeply shady act. Announce
	// the deed, and — if anyone's awake to see it — roll Deception to keep a
	// straight face. Fail in front of witnesses and you bottle it, sheepishly.
	const isSleeping = !!targetPlayer.sleeping || !!targetPlayer.offline_sleeping;
	if (isSleeping) {
		const lootView = () => buildLootView({ id: targetPlayer.id, name: targetPlayer.handle, butcher_table: [] }, player);
		const result = await attemptSneakyLoot(player, targetPlayer, broadcast);
		return result === "proceed" ? lootView() : result;
	}
	return buildLootView({ id: targetPlayer.id, name: targetPlayer.handle, butcher_table: [] }, player);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// The shady-looting encounter. Broadcasts the devious attempt to any bystanders
// plus the actor, and — only when awake witnesses are present — gates the loot
// behind a Deception check. Returns "proceed" to open the loot GUI, or a result
// object (the sheepish bail-out) to abort.
async function attemptSneakyLoot(player, targetPlayer, broadcast) {
	const name = targetPlayer.handle;
	const witnesses = getZonePlayers(player.current_zone)
		.filter((p) => p.id !== player.id && p.id !== targetPlayer.id && !p.sleeping);

	const selfDevious = pick([
		`You lower yourself beside the sleeping ${name} and start rifling through their belongings with the tenderness of a raccoon at a bin.`,
		`Holding your breath, you slip a hand toward ${name}'s pockets, moving with all the grace of a man defusing a bomb made of loose change.`,
		`You get to work on ${name}'s pockets, telling yourself this is basically a wellness check. A wellness check with upside.`,
	]);

	if (witnesses.length) {
		broadcast(player.current_zone, { type: "zone_event", message: pick([
			`${player.handle} sinks into a crouch and begins picking through ${name}'s pockets with the focus of a surgeon and the morals of a seagull.`,
			`${player.handle} tiptoes up to the sleeping ${name}, hands hovering, doing a truly unconvincing impression of someone who belongs there.`,
			`${player.handle} leans over ${name}'s sleeping body and starts *very slowly* patting them down, glancing around like a meerkat with a guilty conscience.`,
		]) }, player.id);

		const check = await skillCheck(player, "deception", 4 + 3 * witnesses.length);
		await awardSkillUse(player.id, "deception", check.margin);
		if (!check.success) {
			broadcast(player.current_zone, { type: "zone_event", message: pick([
				`${player.handle} freezes mid-reach as the room turns to look, then loudly insists they were 'just checking ${name} was still breathing.' Nobody is convinced.`,
				`Caught red-handed over ${name}, ${player.handle} snatches their hand back and gives the room a weak, guilty little wave.`,
				`${player.handle} jolts upright from ${name}'s sleeping form, pockets suspiciously empty, and announces to no one in particular that they 'dropped a coin.'`,
			]) }, player.id);
			return { type: "emote", message: pick([
				`Eyes on the back of your neck. You withdraw your hand and pretend to tuck ${name}'s blanket in with the warmth of a man who has definitely never stolen anything. Better leave it — for now.`,
				`Someone's watching. You straighten up fast, flash a thumbs-up as if that has ever worked for anyone ever, and abandon the heist with as much dignity as you can fake.`,
				`Caught. You pat ${name} gently on the shoulder like a concerned friend and back away whistling. The pockets will keep.`,
			]) };
		}
	}

	broadcast(null, { type: "action", message: selfDevious }, null, player.id);
	return "proceed";
}

// Resolve a corpse by ID, falling back to a sleeping/offline player in the same zone.
export async function resolveCorpseOrPlayer(corpseId, player) {
	const corpse = corpseId ? getCorpse(corpseId) : null;
	if (corpse) return corpse;
	// Check if it's a sleeping/offline player still in the zone
	if (!corpseId) return null;
	const { rows } = await query(
		`SELECT id, handle FROM players WHERE id=$1 AND current_zone=$2`,
		[corpseId, player.current_zone],
	);
	if (!rows.length) return null;
	return { id: rows[0].id, name: rows[0].handle, zoneId: player.current_zone, butcher_table: [] };
}

// Take every item from a corpse at once.
async function cmdLootAll(args, player) {
	const corpseId = args[0];
	const corpse = await resolveCorpseOrPlayer(corpseId, player);
	if (!corpse || corpse.zoneId !== player.current_zone) {
		const label = args.slice(1).join(' ') || 'That corpse';
		return { type: "error", message: `${label} is gone.` };
	}
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
	const [invId, corpseId, ...rest] = args;
	// Optional qty as third arg (numeric); remaining args are corpseName for error messages
	let qty = null;
	let nameParts = rest;
	if (rest.length && /^\d+$/.test(rest[0])) {
		qty = parseInt(rest[0], 10);
		nameParts = rest.slice(1);
	}

	const corpse = await resolveCorpseOrPlayer(corpseId, player);
	if (!corpse || corpse.zoneId !== player.current_zone) {
		const label = nameParts.join(' ') || 'That corpse';
		return { type: "error", message: `${label} is gone.` };
	}
	const { rows } = await query(
		`SELECT pi.id,pi.item_id,pi.quantity,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2`,
		[invId, corpseId],
	);
	if (!rows.length) return { type: "error", message: "It's already gone." };
	const row = rows[0];

	// Partial take: split the stack if a valid qty less than the full amount was given
	const takeQty = (qty && qty > 0 && qty < row.quantity) ? qty : null;
	let name;
	if (takeQty) {
		if (isStackable(row)) {
			const { rows: existing } = await query(
				'SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 AND container_id IS NULL',
				[player.id, row.item_id],
			);
			if (existing.length) {
				await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [takeQty, existing[0].id]);
			} else {
				await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,1.0)', [randomUUID(), player.id, row.item_id, takeQty]);
			}
			await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [takeQty, row.id]);
		}
		name = row.name;
	} else {
		name = await giveRowToPlayer(row, player);
	}

	const view = await buildLootView(corpse, player);
	view.mainMsg = `You take ${takeQty ? takeQty + 'x ' : ''}${name}.`;
	return view;
}

export const handlers = {
	repair: async (args, raw, player, broadcast) => {
		const { cmdRepairDevice } = await import('./infrastructure.js');
		return cmdRepairDevice(args.join(" "), player, broadcast);
	},
	loot: (args, raw, player, broadcast) =>
		cmdLootCorpse(args.join(" "), player, broadcast),
	lootid: (args, raw, player) => cmdLootId(args, player),
	lootall: (args, raw, player) => cmdLootAll(args, player),
	closeloot: () => null,
};
