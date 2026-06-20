import { getPlayerFactionRep } from '../../server/engine/factions.js';

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
