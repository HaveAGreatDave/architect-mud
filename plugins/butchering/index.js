// Butchering plugin.
//
// A timed, posture-based carve action. `posture === "butchering"` is the
// authoritative activity flag (see docs/systems-posture.md) — it inherits every
// engine force-stand interruption (moving, attacking, being attacked) for free.
// A companion `player.butcherState = { corpseId, completeAt }` carries the
// bookkeeping the posture string can't; posture is authoritative, so when it stops
// reading "butchering" this plugin discards the stale state.
//
// Coupling with the engine loot router is purely through the action registry:
// the plugin registers the BUTCHER action, and `loot <corpse>` dispatches it when
// the corpse is empty-but-butcherable (no imports in either direction).

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getLivePlayer, getAllLivePlayers, getCorpse, getZoneCorpses, removeCorpse } from '../../server/engine/world.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { isStackable } from '../../server/engine/tags.js';
import { stainClothing } from '../../server/engine/bodily.js';
import { on } from '../../server/engine/events.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { setPosture } from '../../server/engine/posture.js';

const BUTCHER_MS = 5000;

// Resolve a corpse in the player's current zone by id (preferred, from a click
// or the loot router) or by a substring of its name (typed command).
function resolveCorpse(targetStr, player) {
	const direct = getCorpse(targetStr);
	if (direct && direct.zoneId === player.current_zone) return direct;
	const corpses = getZoneCorpses(player.current_zone);
	if (!targetStr) return corpses.length === 1 ? corpses[0] : null;
	const t = targetStr.toLowerCase();
	return corpses.find((c) => c.name.toLowerCase().includes(t)) || null;
}

async function hasButcheringTool(playerId) {
	const { rows } = await query(
		`SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'butchering') LIMIT 1`,
		[playerId],
	);
	return rows.length > 0;
}

async function cmdButcher(targetStr, player, broadcast) {
	if (player.posture === "butchering")
		return { type: "emote", message: "You're already elbow-deep in that." };
	if ((player.posture || "standing") !== "standing")
		return { type: "emote", message: "You need to be on your feet to butcher." };
	if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId)
		return { type: "emote", message: "You're too busy fighting to butcher." };

	const corpse = resolveCorpse(targetStr, player);
	if (!corpse) return { type: "error", message: "No corpse to butcher here." };
	const table = corpse.butcher_table || [];
	if (!table.length)
		return { type: "error", message: `${corpse.name} can't be butchered.` };
	if (!(await hasButcheringTool(player.id)))
		return {
			type: "error",
			message: "You need a butchering tool (a knife will do) to do that.",
		};

	setPosture(player, "butchering");
	player.butcherState = { corpseId: corpse.id, completeAt: Date.now() + BUTCHER_MS };
	sendToPlayer(player.id, {
		type: "progress",
		action: "butcher",
		label: `Butchering ${corpse.name}`,
		durationMs: BUTCHER_MS,
	});
	broadcast(
		player.current_zone,
		{ type: "zone_event", message: `${player.handle} starts butchering ${corpse.name}.` },
		player.id,
	);
	// The client closes any open loot panel when it receives the `progress`
	// message above; no closeLoot/look churn needed here.
	return { type: "emote", message: `You set to work butchering ${corpse.name}.` };
}

// Clear the butchering activity and hide the client progress bar.
function clearButcher(player, tellMsg) {
	const cur = getLivePlayer(player.id) || player;
	delete cur.butcherState;
	if (cur.posture === "butchering") setPosture(cur, "standing");
	sendToPlayer(player.id, { type: "progress", action: "butcher", done: true });
	if (tellMsg) sendToPlayer(player.id, { type: "emote", message: tellMsg });
}

// Runs the actual carve once the 5s bar completes. Delivers results out-of-band
// (the start path already returned), and always hides the bar.
async function resolveButcher(player) {
	const st = player.butcherState;
	const corpse = st ? getCorpse(st.corpseId) : null;
	if (!corpse || !(corpse.butcher_table || []).length) {
		clearButcher(player);
		return;
	}
	if (!(await hasButcheringTool(player.id))) {
		clearButcher(player, "You've lost your butchering tool.");
		return;
	}
	const table = corpse.butcher_table;
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
		if (check.success) {
			await awardSkillUse(player.id, "butchering", check.margin);
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
		const { rows: stainRows } = await query(
			`SELECT pi.slot FROM player_inventory pi WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot = ANY($2)`,
			[player.id, ['torso', 'hands', 'legs']],
		);
		const slotsToStain = stainRows.map(r => r.slot);
		if (slotsToStain.length) await stainClothing(player, slotsToStain, 'blood');
	}
	await removeCorpse(corpse.id);
	sendToZone(
		player.current_zone,
		{ type: "zone_event", message: `${player.handle} butchers ${corpse.name}.`, refresh: true },
		player.id,
	);

	clearButcher(player);
	let message = `You butcher ${corpse.name}.`;
	if (carved.length) message += `\nYou carve free: ${carved.join(", ")}.`;
	if (ruined.length) message += `\nYou botch and ruin: ${ruined.join(", ")}.`;
	if (ruined.length) message += `\nYou're covered in blood.`;
	sendToPlayer(player.id, { type: "loot", message, closeLoot: true });
}

// ── Butchering tick: completes the 5s action, or cleans up if interrupted
// (force-stood by movement/combat) — mirrors the scavenging plugin's tick.
let butcherTicking = false;
async function butcherTick() {
	if (butcherTicking) return;
	butcherTicking = true;
	try {
		const nowMs = Date.now();
		for (const player of getAllLivePlayers()) {
			const st = player.butcherState;
			if (player.posture === "butchering") {
				if (!st) continue;
				if (nowMs >= st.completeAt) await resolveButcher(player);
			} else if (st) {
				clearButcher(player, "You stop butchering.");
			}
		}
	} finally {
		butcherTicking = false;
	}
}

setInterval(
	() => butcherTick().catch((e) => console.error("[butchering] tick error:", e.message)),
	1000,
);

// The unified STOP command halts butchering like any other repeating action.
on("player.stop", ({ player, stopped }) => {
	if (player.posture !== "butchering") return;
	clearButcher(player); // stop command prints "You stop butchering." from `stopped`
	sendToZone(
		player.current_zone,
		{ type: "zone_event", message: `${player.handle} stops butchering.` },
		player.id,
	);
	stopped.push("butchering");
});

// BUTCHER is the canonical mutation path (ADR-0001): the typed command below and
// the engine loot router (empty-but-butcherable corpse) both dispatch it.
registerAction({
	type: 'BUTCHER',
	handler: ({ actor, params, context }) =>
		cmdButcher(params.targetStr, actor, context.broadcast),
});

export const commands = {
	butcher: (args, raw, player, broadcast) =>
		dispatchAction({ type: 'BUTCHER', actor: player, params: { targetStr: args.join(' ') }, context: { broadcast } }),
};

console.log('[butchering] Plugin loaded.');
