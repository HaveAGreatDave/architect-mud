// Thievery plugin — pocket-picking live players. Extracted from
// server/engine/commands/combat.js (Phase 2, docs/proposals/engine-plugin-boundary.md).
//
// Changes from the engine version, both from the proposal's discovery log:
// - The 60s cooldown persists in the Flag store (player-scoped
//   `steal_cooldown_until`) instead of an in-memory Map that reset on restart.
// - The SIFT ambiguous pick replays through the `thievery.steal` Action
//   (dispatchType/dispatchParam) — the builtin replay path can't reach plugin
//   verbs (the documented SIFT replay trap).

import { query } from '../../server/models/db.js';
import { getZonePlayers } from '../../server/engine/world.js';
import { skillCheck } from '../../server/engine/skills.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { getZoneProtection } from '../../server/engine/protection.js';

const STEAL_COOLDOWN_MS = 60000;

async function stealFrom(target, player, broadcast) {
	// Same protection law as attack/loot/shove — a shielded zone blocks reach.
	// (Previously a gap: steal ignored forcefields; proposal discovery log.)
	if (getZoneProtection(target.current_zone || player.current_zone)) {
		return { type: "error", message: `A quantum forcefield crackles between you and ${target.handle}. You can't reach them.` };
	}
	await setFlag('player', 'steal_cooldown_until', Date.now() + STEAL_COOLDOWN_MS, player);
	if ((target.credits || 0) <= 0)
		return { type: "error", message: `${target.handle} isn't carrying any credits.` };

	const result = await skillCheck(player, "deception", 7);
	if (!result.success) {
		broadcast(
			player.current_zone,
			{ type: "zone_event", message: `${player.handle} tries to pick ${target.handle}'s pocket and gets caught red-handed.` },
			player.id,
		);
		return { type: "error", message: `You go for ${target.handle}'s pocket. They notice immediately. Everyone noticed, actually.` };
	}

	const amount = Math.min(
		target.credits,
		Math.ceil(target.credits * (0.1 + Math.random() * 0.2)),
	);
	await adjustCredits(target, -amount);
	await adjustCredits(player, amount);
	return {
		type: "steal",
		message: `You lift ${amount}c off ${target.handle} without them noticing a thing.`,
		player_update: { credits: player.credits },
	};
}

async function cmdSteal(targetStr, player, broadcast) {
	if (!targetStr) return { type: "error", message: "Steal from whom?" };
	const until = await getFlag('player', 'steal_cooldown_until', player);
	if (until && Date.now() < until) {
		return {
			type: "error",
			message: `Too soon to try that again. (${Math.ceil((until - Date.now()) / 1000)}s)`,
		};
	}

	const liveOthers = getZonePlayers(player.current_zone).filter((p) => p.id !== player.id);
	const stealPool = liveOthers.map(p => ({ ...p, name: p.handle }));
	const stlr = siftResolve(targetStr, stealPool);
	if (stlr.type === 'ambiguous') {
		createSelectionState(player.id, stlr.candidates, { dispatchType: 'thievery.steal', dispatchParam: 'target' });
		return { type: 'output', message: formatSelectionPage({ allCandidates: stlr.candidates, visibleIndex: 0, pageSize: 5 }) };
	}
	let target = stlr.type === 'match' ? stlr.candidate : null;
	if (!target) {
		const { rows } = await query(
			`SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND id!=$3 LIMIT 1`,
			[`%${targetStr.toLowerCase()}%`, player.current_zone, player.id],
		);
		if (rows.length) target = rows[0];
	}
	if (!target)
		return { type: "error", message: `Can't find "${targetStr}" here.` };

	return stealFrom(target, player, broadcast);
}

// SIFT selection replay for a plugin verb goes through the action dispatcher.
registerAction({
	type: 'thievery.steal',
	handler: ({ actor, params, context }) => stealFrom(params.target, actor, context.broadcast),
});

export const commands = {
	steal: (args, raw, player, broadcast) => cmdSteal(args.join(" "), player, broadcast),
};

console.log('[thievery] Plugin loaded.');
