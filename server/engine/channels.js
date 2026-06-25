import { getAllLivePlayers } from './world.js';

const ADMIN_ROLES = new Set(['admin', 'dev', 'builder', 'designer']);

// Channel definitions. Each entry has: id, permanent, isMember(player) -> bool.
const CHANNEL_DEFS = {
  '#arcnet': {
    id: '#arcnet',
    permanent: true,
    isMember: (player) => ADMIN_ROLES.has(player.role),
  },
};

export function getPlayerChannels(player) {
  return Object.values(CHANNEL_DEFS)
    .filter(c => c.isMember(player))
    .map(c => ({ id: c.id, permanent: c.permanent }));
}

export function canAccessChannel(channelId, player) {
  const def = CHANNEL_DEFS[channelId.toLowerCase()];
  return def ? def.isMember(player) : false;
}

export function broadcastToChannel(channelId, msg, broadcast) {
  const def = CHANNEL_DEFS[channelId.toLowerCase()];
  if (!def) return false;
  for (const p of getAllLivePlayers().filter(p => def.isMember(p))) {
    broadcast(null, msg, null, p.id);
  }
  return true;
}
