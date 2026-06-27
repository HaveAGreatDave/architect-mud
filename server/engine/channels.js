import { getAllLivePlayers } from './world.js';

const ADMIN_ROLES = new Set(['admin', 'dev', 'builder', 'designer']);

// Channel definitions. Each entry has: id, permanent, systemOnly, isMember(player) -> bool.
// systemOnly: true means players cannot send to this channel; only the server can.
const CHANNEL_DEFS = {
  '#system': {
    id: '#system',
    permanent: true,
    systemOnly: true,
    isMember: () => true,
  },
  '#arcnet': {
    id: '#arcnet',
    permanent: true,
    systemOnly: false,
    isMember: (player) => ADMIN_ROLES.has(player.role),
  },
};

export function getPlayerChannels(player) {
  return Object.values(CHANNEL_DEFS)
    .filter(c => c.isMember(player))
    .map(c => ({ id: c.id, permanent: c.permanent, systemOnly: c.systemOnly || false }));
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
