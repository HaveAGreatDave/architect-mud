// concealment plugin regression suite (harness-only, never loaded in production).
//
// Drives the real furniture rows: the drum-basement chem lab starts sealed behind
// the Cachet Vantage 900, so the checks below double as a guard on that content
// staying authored the way the feature needs (the cabinet naming the lab, the lab
// carrying `concealed`).
import { _test, hooks } from './index.js';
import { getFurnitureById, getZoneFurniture } from '../../server/engine/world.js';
import { availableActions } from '../../server/engine/specializedActions.js';
import { registerOwnedZoneProvider } from '../../server/engine/zone-filth.js';

const CABINET = 'furn_cachet_v900';
const LAB = 'furn_chem_lab';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const savedZone = p.current_zone;

  // Away from any keypad, `keypad` must fall through (undefined) rather than claim
  // the verb — some other plugin may want it later.
  p.current_zone = 'zone_regress_no_keypad_here';
  const away = await _test.resolveDisguise(p, '');
  check('no keypad in an ordinary room', !!away.error, JSON.stringify(away));

  const cabinet = getFurnitureById(CABINET);
  const lab = getFurnitureById(LAB);
  check('the Cachet cabinet exists', !!cabinet, 'furn_cachet_v900 missing');
  check('the chem lab exists', !!lab, 'furn_chem_lab missing');

  if (cabinet && lab) {
    check('cabinet names the lab it hides', cabinet.flags?.conceal_hides === LAB, JSON.stringify(cabinet.flags));
    check('cabinet and lab share a zone', cabinet.zone_id === lab.zone_id, `${cabinet.zone_id} vs ${lab.zone_id}`);
    check('factory code is set', /^\d{4,8}$/.test(_test.codeOf(cabinet)), _test.codeOf(cabinet));

    p.current_zone = cabinet.zone_id;

    // A wrong code changes nothing and says nothing useful.
    const wasOpen = _test.isOpen(cabinet);
    const bad = await run('keypad cachet 9999');
    check('wrong code is refused', bad?.type === 'error', bad?.message);
    check('wrong code leaks nothing about the lab', !/chem|lab/i.test(bad?.message || ''), bad?.message);
    check('wrong code does not move the wall', _test.isOpen(cabinet) === wasOpen, 'state changed on a bad code');

    // The real code toggles it. Run it twice so the suite leaves the world exactly
    // as it found it — a regress that leaves a dealer's lab hanging open is a bug
    // in the test, not a passing feature.
    const code = _test.codeOf(cabinet);
    const first = await run(`keypad cachet ${code}`);
    check('right code is accepted', first?.type === 'output', first?.message);
    check('the wall pivots', _test.isOpen(cabinet) !== wasOpen, 'nothing moved on a good code');

    const revealed = _test.isOpen(cabinet);
    const listed = getZoneFurniture(cabinet.zone_id).some((f) => f.id === LAB && !f.flags?.concealed);
    check('open ⇒ the lab is visible furniture', listed === revealed, `open=${revealed} listed=${listed}`);

    if (revealed) {
      // Open ⇒ the cabinet STANDS ASIDE. The room shows the lab in the slot the
      // cabinet held, never both — the fiction has one piece of furniture there,
      // and a room that listed a bar wall AND the lab it folded into would be
      // telling on you. Phrased as "never both" so the check survives the room
      // being dark, where the furniture list is lights-only and neither appears.
      const body = (await run('look'))?.message || '';
      const named = (f) => new RegExp(f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(body);
      check('open ⇒ cabinet and lab are never both listed', !(named(lab) && named(cabinet)), body.slice(0, 400));

      // …and the pad that shuts it again rides on the piece still standing there.
      // Read off examine's Actions row, not the describe hook — the revealed piece
      // is a crafting station and its own plugin's furniture.describe wins there.
      const labDesc = await run(`examine ${lab.name}`);
      check('open ⇒ the keypad rides on the lab', /data-action="keypad"/.test(labDesc?.message || ''), labDesc?.message);
      check('open ⇒ the lab resolves as a keypad target', !!(await _test.resolveDisguise(p, lab.name)).furniture,
        'the lab name did not resolve back to its cabinet');
      check('the lab back-points at its cabinet', lab.flags?.conceal_hidden_by === CABINET, JSON.stringify(lab.flags));
      // Re-read the row: updateFurniture REPLACES the cached object rather than
      // mutating it, so the `lab` captured up top still carries `concealed`.
      const liveLab = getFurnitureById(LAB);
      check('open ⇒ the lab advertises the keypad action', availableActions(liveLab, p).includes('keypad'),
        JSON.stringify(liveLab?.flags));
    }

    await run(`keypad cachet ${code}`);
    check('toggles back to how it started', _test.isOpen(cabinet) === wasOpen, 'left the cabinet in the wrong state');
    check('sealed ⇒ the lab is not a keypad advert', !availableActions(getFurnitureById(LAB), p).includes('keypad'),
      'a sealed lab advertised its own keypad');

    // While sealed, examine advertises the pad and nothing else.
    const desc = await run('examine cachet vantage 900 cabinet');
    check('examine shows a keypad, not a lab', /keypad/i.test(desc?.message || '') && !/chem lab/i.test(desc?.message || ''), desc?.message);
  }

  // --- Owner-only keypad ----------------------------------------------------
  // In an OWNED room the pad is the owner's business: a guest is never told it's
  // there (describe hook, examine Actions row and the smart bar's data-actions
  // all read the same gate). An unowned room reads exactly as it always did.
  const OWNED = '__conceal_owned_zone__';
  registerOwnedZoneProvider((z) => (z === OWNED ? p.id : null));
  const fake = { id: 'furn_fake_v900', name: 'test cabinet', zone_id: OWNED, flags: { conceal_hides: 'furn_nothing' } };
  const stranger = { id: `${p.id}-not-me` };

  check('owner sees the keypad hint', /keypad/i.test(hooks['furniture.describe'](fake, p) || ''),
    'owner was not offered the pad in their own room');
  check('a guest is told nothing', hooks['furniture.describe'](fake, stranger) === undefined,
    'the pad advertised itself to a stranger');
  check('owner gets the keypad action', availableActions(fake, p).includes('keypad'),
    JSON.stringify(availableActions(fake, p)));
  check('guest gets no keypad action', !availableActions(fake, stranger).includes('keypad'),
    JSON.stringify(availableActions(fake, stranger)));

  // Unowned space is unchanged — nobody to be private from.
  const openRoom = { ...fake, zone_id: '__conceal_unowned_zone__' };
  check('unowned room still shows the pad to anyone', availableActions(openRoom, stranger).includes('keypad'),
    'owner-gating leaked into unowned space');

  // Hiding the advert must NOT lock the verb: resolution is by name in the room,
  // with no owner test anywhere on the path, so a guest with the code still works it.
  p.current_zone = getFurnitureById(CABINET)?.zone_id || savedZone;
  const asStranger = await _test.resolveDisguise(stranger.id ? { ...p, id: stranger.id } : p, 'cachet');
  check('the verb itself is not owner-locked', !!asStranger.furniture, JSON.stringify(asStranger));

  p.current_zone = savedZone;
}
