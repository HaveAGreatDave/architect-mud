// Party plugin regression suite — run by tests/regress.js (never in production).
// Uses a second synthetic live player so we can act as both inviter and invitee
// (the harness `run` only dispatches as its one player), calling the exported
// command directly.
import { setLivePlayer, removeLivePlayer, getLivePlayer, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { commands, getPartyView, _test } from './index.js';

const noop = () => {};

export default async function regress({ check, getPlayer }) {
  const leader = getPlayer();
  const BOB = 'p_party_bob_test';
  const bob = { id: BOB, handle: 'Bob', current_zone: leader.current_zone, following: null };
  setLivePlayer(BOB, bob);
  addPlayerToZone(BOB, leader.current_zone);
  const savedFollowing = leader.following;

  try {
    const P = (sub) => commands.party(sub, '', leader, noop);
    const B = (sub) => commands.party(sub, '', bob, noop);

    // Invite creates a party (leader) with a pending invite for Bob.
    P(['invite', 'Bob']);
    let v = getPartyView(leader.id);
    check('party invite creates a party with the inviter as leader',
      !!v && v.leaderId === leader.id && v.members.length === 1, JSON.stringify(v?.members?.map(m => m.handle)));
    check('party invite records a pending invite', v?.invites?.some(i => i.id === BOB), JSON.stringify(v?.invites));

    // Bob accepts → joins, and is now following the leader (the follow wiring).
    B(['accept']);
    v = getPartyView(leader.id);
    check('party accept adds the member', v?.members?.length === 2 && v.members.some(m => m.id === BOB), JSON.stringify(v?.members?.map(m => m.handle)));
    check('joining a party sets the member to follow the leader', getLivePlayer(BOB).following === leader.id, String(getLivePlayer(BOB).following));
    check('accepting clears the pending invite', !getPartyView(leader.id).invites.some(i => i.id === BOB), JSON.stringify(getPartyView(leader.id).invites));

    // A member leaving clears their follow and (party of 1) disbands.
    B(['leave']);
    check('leaving clears the member follow', getLivePlayer(BOB).following == null, String(getLivePlayer(BOB).following));
    check('a party dropping below 2 dissolves', getPartyView(leader.id) === null && getPartyView(BOB) === null, 'still present');

    // Kick path: re-form, then leader removes Bob.
    P(['invite', 'Bob']); B(['accept']);
    const kick = P(['kick', 'Bob']);
    check('leader can kick a member', /remove Bob/i.test(kick?.message || '') && getPartyView(leader.id) === null && getLivePlayer(BOB).following == null, kick?.message);

    // Only the leader may invite/kick.
    P(['invite', 'Bob']); B(['accept']);
    const memberInvite = B(['invite', 'Nobody']);
    check('a non-leader cannot invite', /only the party leader/i.test(memberInvite?.message || ''), memberInvite?.message);

    // Leader leaving disbands the whole party and clears everyone's follow.
    P(['leave']);
    check('leader leaving disbands the party', getPartyView(leader.id) === null && getPartyView(BOB) === null && getLivePlayer(BOB).following == null, 'not disbanded');

    // Accept with nothing pending is a gentle no-op.
    const emptyAccept = B(['accept']);
    check('accept with no invite is a gentle no-op', /no pending party invites/i.test(emptyAccept?.message || ''), emptyAccept?.message);
  } finally {
    // Tear down any lingering party state + the synthetic player.
    _test.parties.clear();
    _test.playerParty.clear();
    removePlayerFromZone(BOB, leader.current_zone);
    removeLivePlayer(BOB);
    leader.following = savedFollowing;
  }
}
