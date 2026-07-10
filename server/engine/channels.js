import { getAllLivePlayers, getPlayerMembership, getOrg } from './world.js';
import { query } from '../models/db.js';

// A player's private corp channel id, or null if they're not in a corp.
// Convention: '#corp:<orgId>'. Membership drives access (dynamic, unlike the
// static CHANNEL_DEFS). channel_messages already keys on arbitrary text.
function corpChannelIdFor(player) {
  const m = getPlayerMembership(player.id);
  return m ? `#corp:${m.org_id}` : null;
}

// Human-readable display label for the corp channel — '#<corp name>'. Purely
// cosmetic: the id stays '#corp:<orgId>' (stable DB key + whisper routing),
// so renames/spaces/name-collisions never break message delivery.
function corpChannelLabel(player) {
  const m = getPlayerMembership(player.id);
  const org = m ? getOrg(m.org_id) : null;
  return org ? `#${org.name}` : null;
}

// How many recent messages to retain/replay per channel.
const HISTORY_LIMIT = 50;

const ADMIN_ROLES = new Set(['admin', 'dev', 'builder', 'designer']);

// Channel definitions. Each entry has: id, permanent, systemOnly, isMember(player) -> bool.
// systemOnly: true means players cannot send to this channel; only the server can.
export const CHANNEL_DEFS = {
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
  const list = Object.values(CHANNEL_DEFS)
    .filter(c => c.isMember(player))
    .map(c => ({ id: c.id, permanent: c.permanent, systemOnly: c.systemOnly || false }));
  const corpId = corpChannelIdFor(player);
  if (corpId) list.push({ id: corpId, permanent: true, systemOnly: false, label: corpChannelLabel(player) || corpId });
  return list;
}

export function canAccessChannel(channelId, player) {
  if (channelId.startsWith('#corp:')) return corpChannelIdFor(player) === channelId;
  const def = CHANNEL_DEFS[channelId.toLowerCase()];
  return def ? def.isMember(player) : false;
}

export function sendToChatChannel(channelId, msg, broadcast) {
  // Dynamic per-corp channel: recipients are live players in the same corp.
  if (channelId.startsWith('#corp:')) {
    const orgId = channelId.slice('#corp:'.length);
    for (const p of getAllLivePlayers()) {
      if (getPlayerMembership(p.id)?.org_id === orgId) broadcast(null, msg, null, p.id);
    }
    if (msg.from && msg.message != null) storeChannelMessage(channelId, msg.from, msg.message);
    return true;
  }
  const def = CHANNEL_DEFS[channelId.toLowerCase()];
  if (!def) return false;
  for (const p of getAllLivePlayers().filter(p => def.isMember(p))) {
    broadcast(null, msg, null, p.id);
  }
  // Persist player-authored messages so they replay on next login.
  if (!def.systemOnly && msg.from && msg.message != null) {
    storeChannelMessage(def.id, msg.from, msg.message);
  }
  return true;
}

// Return messages posted after `since` (epoch seconds) for channels the player can access.
// Shape: { '#arcnet': [{ from, message, ts }, ...] }
export async function getChannelMessagesSince(player, since) {
  const channelIds = Object.values(CHANNEL_DEFS)
    .filter(c => !c.systemOnly && c.isMember(player))
    .map(c => c.id);
  const corpId = corpChannelIdFor(player);
  if (corpId) channelIds.push(corpId);
  if (!channelIds.length) return {};
  const { rows } = await query(
    `SELECT channel_id, from_handle, message, created_at
       FROM channel_messages
      WHERE channel_id = ANY($1) AND created_at > $2
      ORDER BY created_at ASC`,
    [channelIds, Math.floor(since || 0)],
  );
  const out = {};
  for (const id of channelIds) out[id] = [];
  for (const r of rows) {
    out[r.channel_id].push({ from: r.from_handle, message: r.message, ts: Number(r.created_at) * 1000 });
  }
  return out;
}

// Insert a message and prune the channel back to HISTORY_LIMIT rows.
async function storeChannelMessage(channelId, fromHandle, message) {
  try {
    await query(
      'INSERT INTO channel_messages (channel_id, from_handle, message) VALUES ($1, $2, $3)',
      [channelId, fromHandle, message],
    );
    await query(
      `DELETE FROM channel_messages
         WHERE channel_id = $1
           AND id <= (
             SELECT id FROM channel_messages
              WHERE channel_id = $1
              ORDER BY id DESC
              OFFSET $2 LIMIT 1
           )`,
      [channelId, HISTORY_LIMIT],
    );
  } catch (err) {
    console.error('storeChannelMessage failed:', err.message);
  }
}

// Return the last HISTORY_LIMIT messages (oldest first) for each channel the
// player can access. Shape: { '#arcnet': [{ from, message, ts }, ...] }.
export async function getChannelHistory(player) {
  const channelIds = Object.values(CHANNEL_DEFS)
    .filter(c => !c.systemOnly && c.isMember(player))
    .map(c => c.id);
  const corpId = corpChannelIdFor(player);
  if (corpId) channelIds.push(corpId);
  if (!channelIds.length) return {};
  const { rows } = await query(
    `SELECT channel_id, from_handle, message, created_at FROM (
       SELECT channel_id, from_handle, message, created_at,
              ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY id DESC) AS rn
         FROM channel_messages
        WHERE channel_id = ANY($1)
     ) t WHERE rn <= $2 ORDER BY channel_id, created_at ASC, rn DESC`,
    [channelIds, HISTORY_LIMIT],
  );
  const out = {};
  for (const id of channelIds) out[id] = [];
  for (const r of rows) {
    out[r.channel_id].push({ from: r.from_handle, message: r.message, ts: Number(r.created_at) * 1000 });
  }
  return out;
}
