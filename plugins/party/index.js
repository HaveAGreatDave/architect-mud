// Party plugin — first-class player groups.
//
// A party is a consent-based group with a leader and members. It's the deliberate
// counterpart to the engine's raw `follow` primitive (player.following): follow is
// unilateral and used for casually tailing someone; a party is invite→accept and
// is the group that travels together — notably the cohort that crosses the void
// together (docs/systems-overland-void-travel.md, Parties).
//
// It DRIVES follow rather than replacing it: joining a party sets your `following`
// to the leader, so the engine's dragFollowers pulls the whole party along on every
// move for free (no party-aware code in movement). Leaving clears it. That keeps
// `follow` the single movement substrate; party is the identity + consent layer on
// top, and the thing the Tablet Party app renders.
//
// State is RAM-only runtime state, exactly like follow — parties dissolve on a
// server restart, so there is no table and nothing to persist.

import { getLivePlayer, getAllLivePlayers } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';

const INVITE_TTL_MS = 120000; // a pending invite lapses after 2 minutes

// partyId -> { id, leaderId, members:Set<pid> (incl. leader), invites:Map<pid,expiresAt> }
const parties = new Map();
const playerParty = new Map(); // pid -> partyId
let _seq = 0;

function handleOf(pid) { return getLivePlayer(pid)?.handle || 'someone'; }
function partyOf(pid) { const id = playerParty.get(pid); return id ? parties.get(id) : null; }
function isLeader(pid) { const p = partyOf(pid); return !!p && p.leaderId === pid; }

// Follow wiring — a party member follows the leader so dragFollowers carries them.
function setFollow(pid, leaderId) { const lp = getLivePlayer(pid); if (lp) lp.following = leaderId; }
function clearFollowIf(pid, leaderId) { const lp = getLivePlayer(pid); if (lp && lp.following === leaderId) lp.following = null; }

function notify(pid, message) { sendToPlayer(pid, { type: 'output', message }); }
function announce(party, message, exceptId = null) {
  for (const pid of party.members) if (pid !== exceptId) notify(pid, message);
}
function changed(party) { emit('party.changed', { partyId: party.id, leaderId: party.leaderId, members: [...party.members] }); }

// Read API for the Tablet Party app / other systems (never import this plugin —
// call through here or read the follow substrate).
// Pending invites addressed TO this player (parties they're not in yet) — for the
// Tablet Party app, which getPartyView can't show (it returns the party you're IN).
export function getIncomingInvites(pid) {
  const now = Date.now();
  const out = [];
  for (const party of parties.values()) {
    const exp = party.invites.get(pid);
    if (exp == null) continue;
    if (exp < now) { party.invites.delete(pid); continue; }
    out.push({ partyId: party.id, leaderId: party.leaderId, leader: handleOf(party.leaderId) });
  }
  return out;
}

export function getPartyView(pid) {
  const p = partyOf(pid);
  if (!p) return null;
  return {
    id: p.id,
    leaderId: p.leaderId,
    leader: handleOf(p.leaderId),
    members: [...p.members].map(id => ({ id, handle: handleOf(id), leader: id === p.leaderId })),
    invites: [...p.invites.keys()].map(id => ({ id, handle: handleOf(id) })),
  };
}

function disband(party, reason) {
  for (const pid of party.members) { clearFollowIf(pid, party.leaderId); playerParty.delete(pid); }
  parties.delete(party.id);
  for (const pid of party.members) notify(pid, reason || 'The party breaks up.');
}

function removeMember(party, pid, leaveMsg) {
  clearFollowIf(pid, party.leaderId);
  party.members.delete(pid);
  playerParty.delete(pid);
  notify(pid, leaveMsg || 'You leave the party.');
  announce(party, `${handleOf(pid)} leaves the party.`);
  if (party.members.size <= 1) { disband(party, 'With everyone gone, the party dissolves.'); return; }
  changed(party);
}

// ── Subcommands ───────────────────────────────────────────────────────────────
function findOnlineByHandle(handle, selfId) {
  const h = handle.toLowerCase();
  return getAllLivePlayers().find(p => p.handle?.toLowerCase() === h && p.id !== selfId) || null;
}

function doInvite(player, targetHandle) {
  if (!targetHandle) return { type: 'error', message: 'Invite whom? (party invite <player>)' };
  const existing = partyOf(player.id);
  if (existing && existing.leaderId !== player.id) return { type: 'emote', message: 'Only the party leader can invite.' };
  const target = findOnlineByHandle(targetHandle, player.id);
  if (!target) return { type: 'error', message: `No player named "${targetHandle}" is online.` };
  if (partyOf(target.id)) return { type: 'emote', message: `${target.handle} is already in a party.` };

  let party = existing;
  if (!party) {
    party = { id: `party_${++_seq}`, leaderId: player.id, members: new Set([player.id]), invites: new Map() };
    parties.set(party.id, party);
    playerParty.set(player.id, party.id);
  }
  party.invites.set(target.id, Date.now() + INVITE_TTL_MS);
  notify(target.id, `<b>${player.handle}</b> invites you to their party. Type <b>party accept</b> to join, or <b>party decline</b>.`);
  return { type: 'emote', message: `You invite ${target.handle} to your party.` };
}

function doAccept(player, fromHandle) {
  // Find a party that has a live invite for me (optionally from a named leader).
  const now = Date.now();
  let chosen = null;
  for (const party of parties.values()) {
    const exp = party.invites.get(player.id);
    if (exp == null) continue;
    if (exp < now) { party.invites.delete(player.id); continue; }
    if (fromHandle && handleOf(party.leaderId).toLowerCase() !== fromHandle.toLowerCase()) continue;
    chosen = party; break;
  }
  if (!chosen) return { type: 'emote', message: fromHandle ? `You have no pending invite from ${fromHandle}.` : 'You have no pending party invites.' };
  if (partyOf(player.id)) return { type: 'emote', message: "You're already in a party — leave it first." };

  chosen.invites.delete(player.id);
  chosen.members.add(player.id);
  playerParty.set(player.id, chosen.id);
  setFollow(player.id, chosen.leaderId);
  notify(player.id, `You join ${handleOf(chosen.leaderId)}'s party. You'll follow the leader's lead.`);
  announce(chosen, `${player.handle} joins the party.`, player.id);
  changed(chosen);
  return null; // messaging already handled
}

function doDecline(player) {
  let n = 0;
  for (const party of parties.values()) if (party.invites.delete(player.id)) n++;
  return { type: 'emote', message: n ? 'You decline the invitation.' : 'You have no pending party invites.' };
}

function doLeave(player) {
  const party = partyOf(player.id);
  if (!party) return { type: 'emote', message: "You aren't in a party." };
  if (party.leaderId === player.id) { disband(party, `${player.handle} disbands the party.`); return { type: 'emote', message: 'You disband the party.' }; }
  removeMember(party, player.id, 'You leave the party.');
  return null;
}

function doKick(player, targetHandle) {
  const party = partyOf(player.id);
  if (!party) return { type: 'emote', message: "You aren't in a party." };
  if (party.leaderId !== player.id) return { type: 'emote', message: 'Only the party leader can remove members.' };
  if (!targetHandle) return { type: 'error', message: 'Remove whom? (party kick <player>)' };
  const target = [...party.members].map(getLivePlayer).find(p => p && p.handle?.toLowerCase() === targetHandle.toLowerCase() && p.id !== player.id);
  if (!target) return { type: 'emote', message: `${targetHandle} isn't in your party.` };
  removeMember(party, target.id, 'You have been removed from the party.');
  return { type: 'emote', message: `You remove ${target.handle} from the party.` };
}

function doStatus(player) {
  const view = getPartyView(player.id);
  if (!view) return { type: 'output', message: "You aren't in a party. Invite someone with: party invite <player>" };
  const roster = view.members.map(m => `  ${m.leader ? '★' : '·'} ${m.handle}${m.id === player.id ? ' (you)' : ''}`).join('\n');
  const pending = view.invites.length ? `\nPending invites: ${view.invites.map(i => i.handle).join(', ')}` : '';
  return { type: 'output', message: `<b>Your party</b> (led by ${view.leader}):\n${roster}${pending}` };
}

function cmdParty(args, raw, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1).join(' ').trim();
  switch (sub) {
    case '':          return doStatus(player);
    case 'invite':    return doInvite(player, rest);
    case 'accept':    return doAccept(player, rest);
    case 'decline':   return doDecline(player);
    case 'leave':
    case 'disband':   return doLeave(player);
    case 'kick':
    case 'remove':    return doKick(player, rest);
    default:          return { type: 'error', message: 'Usage: party [invite <player> | accept | decline | leave | kick <player>]' };
  }
}

// Clean up when a member drops offline — treat it as leaving.
on('player.logout', ({ id }) => {
  const party = parties.get(playerParty.get(id));
  if (!party) return;
  if (party.leaderId === id) disband(party, 'The leader vanished; the party dissolves.');
  else { party.members.delete(id); playerParty.delete(id); if (party.members.size <= 1) disband(party); else { announce(party, `${handleOf(id)} drops out of sight.`); changed(party); } }
});

export const commands = {
  party: cmdParty,
};

export const _test = { parties, playerParty };

console.log('[party] Plugin loaded.');
