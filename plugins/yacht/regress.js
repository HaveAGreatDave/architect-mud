// Yacht plugin regression suite — run by tests/regress.js (never in production).
// Covers the invite verbs' admin gate and — the security-critical part — the
// yacht:board move gate + isInvited auth against the real loaded Echelon zones.
import { runMoveGates } from '../../server/engine/movement-gates.js';
import { getZone, getMinimapData, getAllZones } from '../../server/engine/world.js';
import { isInvited } from './index.js';

// Center the minimap on a tile beside the Echelon's CURRENT exterior position. She's a
// mobile vessel — a persisted `yacht_echelon_pos` (restored async at boot) or an in-run
// sail can leave her anywhere, so a hardcoded "home" tile makes this test position-racy.
// Derive her neighbour live; this asserts the ownership-visibility invariant (owner sees,
// others don't) regardless of where she's berthed.
const seesYacht = (viewer) => {
  const ext = getZone('zone_echelon_exterior');
  const near = getAllZones().find(z =>
    z.map_id === ext.map_id && !z.flags?.yacht && z.grid_x != null &&
    Math.abs(z.grid_x - ext.grid_x) <= 1 && Math.abs(z.grid_y - ext.grid_y) <= 1);
  return getMinimapData((near || ext).id, 8, viewer).some(n => n.id === 'zone_echelon_exterior');
};

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

  // ── The waterline hole, and its edges ──
  // Her weather deck is `vessel`-flagged and reachable from the water by anyone (the
  // swimming plugin teleports a boarder onto it, so no gate runs). What must NOT leak
  // is the rest of her: the deck counts as OUTSIDE on the way in, and walking up the
  // gangway from a pier is still refused.
  const deck = getZone('zone_echelon_exterior');
  check('the weather deck is flagged as a boardable vessel', deck?.flags?.vessel === true, JSON.stringify(deck?.flags?.vessel));

  g = await runMoveGates({ player: p, from: deck, to: foyer, direction: 'in' });
  check('an uninvited swimmer on deck is still stopped at the hatch', g?.block === true, JSON.stringify(g));

  g = await runMoveGates({ player: p, from: outside, to: deck, direction: 'north' });
  check('walking aboard from the pier is still refused', g?.block === true, JSON.stringify(g));

  g = await runMoveGates({ player: owner, from: deck, to: foyer, direction: 'in' });
  check('the owner crosses his own deck freely', g === null || !g?.block, JSON.stringify(g));

  // Owner access: guest-list verbs answer to the OWNER (Cyd) even without admin role —
  // it's his boat. Prove it's ownership, not staff privilege, by using a non-admin Cyd.
  const ownerSavedHandle = p.handle, ownerSavedRole = p.role;
  p.handle = 'Cyd'; p.role = 'player';
  try {
    r = await run('invites');
    check('owner (Cyd) can list invites without admin', r?.type === 'system' && /invite list/i.test(r.message || ''), r?.message);
  } finally {
    p.handle = ownerSavedHandle; p.role = ownerSavedRole;
  }

  // Elevate the fake player to admin for the MANAGEMENT verbs (sail stays bridge+role
  // gated — an admin runs the helm even before being added to the invite list).
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
