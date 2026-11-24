// Street cred regression suite: the arithmetic in cred.js, and that Tibs is a contact.
import { decayCred, trustStep, credForSteps, addCred, standing, seedTrust, band, CRED_MAX, HALF_LIFE_DAYS } from './cred.js';
import { isContact, streetPose, regardOf } from './index.js';
import { getNpc } from '../../server/engine/world.js';

export default async function regress({ check }) {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_700_000_000_000;

  check('cred halves over one half-life', Math.abs(decayCred(40, now - HALF_LIFE_DAYS * DAY, now) - 20) < 1e-9);
  check('cred never decays below 0', decayCred(-5, now - DAY, now) === 0);
  check('no timestamp means no decay', decayCred(30, 0, now) === 30);

  check('trust steps are 25 wide', trustStep(24) === 0 && trustStep(25) === 1 && trustStep(100) === 4);
  check('cred pays per step crossed, not per purchase', credForSteps(1, 1, 5) === 0 && credForSteps(1, 3, 5) === 10);
  check('cred is capped', addCred(CRED_MAX - 1, 10) === CRED_MAX && addCred(0, -10) === 0);

  check('a wary contact discounts cred', standing(0, 60, 0.5) === 30 && standing(10, 60, 1) === 10);
  check('a new contact starts from discounted cred', seedTrust(60, 0.5) === 30 && seedTrust(0, 0) === 0);
  check('bands', band(0) === 'stranger' && band(10) === 'known' && band(40) === 'trusted');

  const tibs = getNpc('npc_shingles_tibs_klimek');
  check('Tibs is loaded', !!tibs);
  if (tibs) {
    check('Tibs is a street contact', isContact(tibs));
    const zeroTier = (tibs.vendor_inventory || []).filter(e => (e.min_trust || 0) === 0).map(e => e.item_id).sort();
    check('Tibs sells only weed to a stranger', zeroTier.join(',') === 'item_joint,item_loose_cannabis');
    check('Tibs vouches to a dealer that exists', (tibs.flags.street.vouches_to || []).every(id => !!getNpc(id)));

    // GLASS: on his post only while he's at work, and a stare for a stranger, a nod for a regular
    const atWork = { ...tibs, zone_id: tibs.work_zone_id }, away = { ...tibs, zone_id: tibs.home_zone };
    const post = streetPose(atWork);
    check('Tibs minds his post at work', post && post.k === 'post' && post.f === 'w');
    check('Tibs is off his post at home', streetPose(away) === undefined);
    const viewer = (flags) => ({ _flags: new Map(Object.entries(flags)) });
    check('a stranger gets stared at', regardOf(tibs, viewer({})) === 'stare');
    check('a regular gets a nod', regardOf(tibs, viewer({ tibs_trust: '60' })) === 'nod');
    check('somebody in between gets the ordinary look', regardOf(tibs, viewer({ tibs_trust: '20' })) === undefined);
    check('cred alone, discounted, can lift a stranger', regardOf(tibs, viewer({ street_cred: '30', street_cred_at: String(Date.now()) })) === undefined);
    check('an unhydrated viewer gets nothing', regardOf(tibs, {}) === undefined);
  }
}
