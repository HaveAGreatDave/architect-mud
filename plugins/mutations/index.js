import { getPlayerMutations, checkMutationTrigger } from '../../server/engine/mutations.js';
import { world } from '../../server/engine/world.js';

async function cmdMutations(args, raw, player) {
  const muts = await getPlayerMutations(player.id);
  if (!muts.length) return { type: 'mutations', message: "No mutations yet. Keep absorbing radiation. Or don't. Your call." };
  let msg = '<span class="skills-header">YOUR MUTATIONS</span>\n\n';
  for (const m of muts) {
    msg += `<span class="zone-name">${m.name}</span>\n${m.description}\n`;
    if (Object.keys(m.stat_modifiers || {}).length) {
      msg += `  Stats: ${Object.entries(m.stat_modifiers).map(([k, v]) => `${k.replace('stat_', '')}${v > 0 ? '+' : ''}${v}`).join(', ')}\n`;
    }
    if (m.drawbacks?.length) msg += `  <span class="msg-error">Drawbacks: ${m.drawbacks.join(', ')}</span>\n`;
    msg += '\n';
  }
  return { type: 'mutations', message: msg };
}

export const hooks = {
  'tick.minute': async ({ broadcast } = {}) => {
    for (const [playerId, player] of world.players) {
      if ((player.radiation || 0) < 40) continue;
      const mutation = await checkMutationTrigger(player);
      if (mutation && broadcast) {
        broadcast(null, {
          type: 'mutation_gained',
          message: `\n<span class="rad-warning">⚠ MUTATION: ${mutation.name}</span>\n${mutation.description}\n${mutation.drawbacks?.length ? `Drawbacks: ${mutation.drawbacks.join(', ')}` : ''}`,
        }, null, playerId);
      }
    }
  },
};

export const commands = {
  mutations: cmdMutations,
};
