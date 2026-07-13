// Yacht plugin regression suite — run by tests/regress.js (never in production).
// Covers the invite verbs' admin gate and — the security-critical part — the
// yacht:board move gate + isInvited auth against the real loaded Echelon zones.
import { runMoveGates } from '../../server/engine/movement-gates.js';
import { getZone, getMinimapData } from '../../server/engine/world.js';
import { isInvited } from './index.js';

const YACHT_NEAR = 'zone_district_896_898'; // a water tile beside the Echelon's home
const seesYacht = (viewer) => getMinimapData(YACHT_NEAR, 8, viewer).some(n => n.id === 'zone_echelon_exterior');

export default async function regress({ run, check, getPlayer }) {
  // ── Invite verbs: admin gate ──
  let r = await run('invite Somebody');
  check('invite refused for non-admin', r?.type === 'error' && /clearance/i.test(r.message || ''), r?.message);

  r = await run('invites');
  check('invites refused for non-admin', r?.type === 'error' && /clearance/i.test(r.message || ''), r?.message);

  // ── Access core: isInvited + the boarding move gate ──
  const p = getPlayer();
  const outside = getZone(p.current_zone);          // a plain, non-yacht harness zone
  const foyer = getZone('zone_echelon_foyer');       // a real yacht zone (loaded from DB)
  check('echelon foyer loaded', !!foyer?.flags?.yacht, `foyer=${!!foyer}`);

  check('non-admin is not invited', (await isInvited(p)) === false);

  // The owner (Cyd) — and ONLY the owner or an invited player — is approved. An admin
  // who is not Cyd and not on the list is NOT approved: no access, no minimap boat.
  const owner = { id: 'cyd_rx', handle: 'Cyd', role: 'admin' };
  const plainAdmin = { id: 'adm_rx', handle: 'SomeAdmin', role: 'admin' };
  check('owner (Cyd) is approved', (await isInvited(owner)) === true);
  check('a non-Cyd admin is NOT approved', (await isInvited(plainAdmin)) === false);

  // Minimap visibility: hidden from a non-invitee AND from a non-Cyd admin; shown to the owner.
  check('non-invitee does not see the yacht on the minimap', seesYacht(p) === false);
  check('null viewer does not see the yacht', seesYacht(null) === false);
  check('a non-Cyd admin does not see the yacht', seesYacht(plainAdmin) === false);
  check('the owner sees the yacht on the minimap', seesYacht(owner) === true);

  let g = await runMoveGates({ player: p, from: outside, to: foyer, direction: 'in' });
  check('uninvited player is blocked at the gangway', g?.block === true && /gangway|Echelon/i.test(g?.message || ''), g?.message);

  g = await runMoveGates({ player: plainAdmin, from: outside, to: foyer, direction: 'in' });
  check('a non-Cyd admin is blocked at the gangway', g?.block === true, JSON.stringify(g));

  g = await runMoveGates({ player: owner, from: outside, to: foyer, direction: 'in' });
  check('the owner boards freely', g === null || !g?.block, JSON.stringify(g));

  // Elevate the fake player to admin for the MANAGEMENT verbs (invite/sail stay
  // role-gated — an admin runs the console even before being added to the list).
  const savedRole = p.role;
  p.role = 'admin';
  try {
    r = await run('invite');
    check('invite with no args prompts usage', r?.type === 'error' && /usage/i.test(r.message || ''), r?.message);

    r = await run('invite __nobody_nowhere__');
    check('invite of unknown player is refused', r?.type === 'error' && /no player named/i.test(r.message || ''), r?.message);

    r = await run('invites');
    check('invites lists for admin', r?.type === 'system' && /invite list/i.test(r.message || ''), r?.message);

    // Helm is bridge-gated: a non-admin can't sail, and an admin off the bridge can't either.
    r = await run('sail north');
    check('sail off the bridge is refused', r?.type === 'error' && /bridge/i.test(r.message || ''), r?.message);
  } finally {
    p.role = savedRole;
  }

  // Non-admin is refused the helm outright.
  r = await run('sail north');
  check('sail refused for non-admin', r?.type === 'error' && /clearance/i.test(r.message || ''), r?.message);

  r = await run('dock');
  check('dock refused for non-admin', r?.type === 'error' && /clearance/i.test(r.message || ''), r?.message);
}
