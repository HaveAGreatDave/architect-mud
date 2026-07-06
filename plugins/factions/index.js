import { getPlayerFactionRep, adjustReputation } from '../../server/engine/factions.js';
import { registerAction } from '../../server/engine/actions.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';

async function cmdFactions(args, raw, player) {
  const reps = await getPlayerFactionRep(player.id);
  let msg = '<span class="skills-header">FACTION STANDING</span>\n\n';
  for (const f of reps) {
    msg += `<span style="color:${f.tier_color}">${f.name.padEnd(24)}</span> ${f.tier_label} (${f.reputation})\n`;
  }
  return { type: 'factions', message: msg };
}

export const commands = {
  factions: cmdFactions,
  rep: cmdFactions,
};

// --- Standing-shifting dialogue Actions ------------------------------------
//
// Let a *choice* in conversation quietly move where the player stands with the
// world's forces — the lever behind the early "philosophical encounters." Nothing
// here is labelled good or bad; it just shifts standing. Both dispatch through the
// canonical Action path (like SET_FLAG) and are authored on dialogue options via
// the VINE editor (see client/devpanel/js/vine/vine-action-types.js).

// ADJUST_REPUTATION {faction_id, delta, reason?} — moves faction standing over the
// existing player_faction_rep substrate. The five NPC factions are the "forces":
// faction_custodians / faction_breakers / faction_archivists / faction_franchise /
// faction_glitch. Players read their standing with `rep` / `factions`.
registerAction({
  type: 'ADJUST_REPUTATION',
  handler: async ({ actor, params }) => {
    const factionId = params.faction_id || params.faction;
    const delta = Number(params.delta) || 0;
    if (!actor?.id || !factionId) {
      return { type: 'error', message: 'ADJUST_REPUTATION requires an actor and faction_id.' };
    }
    const res = await adjustReputation(actor.id, factionId, delta, params.reason || 'dialogue');
    return { type: 'reputation', ...res };
  },
});

// ADJUST_ARCHITECT {delta} — moves a HIDDEN per-player axis (player flag
// `architect_axis`, clamped -100..100) tracking the player's relationship to the
// Architect itself. Deliberately never surfaced — the machine just notes how you
// answer. Dialogue/scripts gate on it with { flag:'architect_axis', op:'gt'|'lt' }.
// It lives here as the sibling of faction standing: the two together are "where you
// stand with the forces of the world."
registerAction({
  type: 'ADJUST_ARCHITECT',
  handler: async ({ actor, params }) => {
    if (!actor?.id) return { type: 'error', message: 'ADJUST_ARCHITECT requires an actor.' };
    const delta = Number(params.delta) || 0;
    const current = Number(await getFlag('player', 'architect_axis', actor)) || 0;
    const next = Math.max(-100, Math.min(100, current + delta));
    await setFlag('player', 'architect_axis', next, actor);
    return { type: 'architect', axis: next, delta };
  },
});
