// Tablet OS — Party app. The visual front-end to the party plugin: see your
// roster, invite online players, accept/decline invites, kick, leave/disband.
// Reads getPartyView / getIncomingInvites and runs the `party` command for
// mutations — no party logic duplicated here, exactly as corp-app fronts corps.
import { getAllLivePlayers } from '../../server/engine/world.js';
import { registerTabletApp } from './registry.js';

function onlineHandles(player, exclude = new Set()) {
  return getAllLivePlayers()
    .filter(p => p.id !== player.id && p.handle && !exclude.has(p.handle.toLowerCase()))
    .map(p => p.handle)
    .sort((a, b) => a.localeCompare(b));
}

async function buildScreen(player, screenId, params, notice) {
  const { getPartyView, getIncomingInvites } = await import('../party/index.js');
  const view = getPartyView(player.id);
  const incoming = getIncomingInvites(player.id);

  // In a party → roster + leader/member controls.
  if (view) {
    const amLeader = view.leaderId === player.id;
    const rows = view.members.map(m => ({
      label: m.leader ? '★ Leader' : '· Member',
      value: `${m.handle}${m.id === player.id ? ' (you)' : ''}`,
    }));
    if (view.invites.length) rows.push({ label: 'Invited', value: view.invites.map(i => i.handle).join(', ') });

    const actions = [];
    if (amLeader) {
      const inParty = new Set(view.members.map(m => m.handle.toLowerCase()));
      const online = onlineHandles(player, inParty);
      if (online.length) actions.push({ id: 'invite', label: '➕ Invite Player', pick: online });
      const kickable = view.members.filter(m => m.id !== player.id).map(m => m.handle);
      if (kickable.length) actions.push({ id: 'kick', label: '➖ Remove Member', pick: kickable });
      actions.push({ id: 'leave', label: 'Disband Party', confirm: 'Disband the party for everyone?' });
    } else {
      actions.push({ id: 'leave', label: 'Leave Party', confirm: 'Leave the party?' });
    }
    return {
      view: 'detail', breadcrumb: [],
      detail: { name: 'Your Party', desc: `Led by ${view.leader} · ${view.members.length} member${view.members.length === 1 ? '' : 's'}`, rows },
      actions, notice,
    };
  }

  // Not in a party, but invited → accept/decline.
  if (incoming.length) {
    return {
      view: 'detail', breadcrumb: [],
      detail: {
        name: 'Party Invite',
        desc: incoming.length === 1 ? `${incoming[0].leader} invited you to their party.` : `You've been invited by: ${incoming.map(i => i.leader).join(', ')}.`,
        rows: incoming.map(i => ({ label: 'From', value: i.leader })),
      },
      actions: [{ id: 'accept', label: '✓ Accept' }, { id: 'decline', label: '✗ Decline' }],
      notice,
    };
  }

  // No party, no invites → start one.
  const online = onlineHandles(player);
  return {
    view: 'detail', breadcrumb: [],
    detail: { name: 'Party', desc: 'You are not in a party. Invite someone to form one — a party travels together, and crosses the void as one.', rows: [] },
    actions: online.length ? [{ id: 'invite', label: '➕ Invite Player', pick: online }] : [],
    notice,
  };
}

async function handleAction(player, actionId, params, broadcast) {
  const { commands } = await import('../party/index.js');
  const run = (args) => commands.party(args, `party ${args.join(' ')}`, player, broadcast);
  let notice;
  if (actionId === 'invite') { const h = (params || '').trim(); notice = h ? run(['invite', h])?.message : 'Pick a player to invite.'; }
  else if (actionId === 'accept') notice = run(['accept'])?.message || 'You join the party.';
  else if (actionId === 'decline') notice = run(['decline'])?.message;
  else if (actionId === 'leave') notice = run(['leave'])?.message || 'You left the party.';
  else if (actionId === 'kick') { const h = (params || '').trim(); notice = h ? run(['kick', h])?.message : 'Pick a member to remove.'; }
  return buildScreen(player, null, '', notice);
}

registerTabletApp({
  id: 'party', name: 'Party', icon: '👥', category: 'Social',
  buildScreen, handleAction,
});
