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
    check('factory code is set', /^\d{4,8}$/.test(_test.factoryOf(cabinet)), _test.factoryOf(cabinet));

    p.current_zone = cabinet.zone_id;
    // The code the dev DB had, put back at the end: a suite that leaves somebody's
    // cabinet on a code they didn't pick is a bug in the suite.
    const priorCode = await _test.ownCode(cabinet);
    const wasOpen = _test.isOpen(cabinet);
    const factory = _test.factoryOf(cabinet);
    const OWN = factory === '5807' ? '5808' : '5807', NEXT = OWN === '5807' ? '4416' : '4417';

    // --- The factory code asks for a new one, and won't take itself back ---------
    await _test.restoreCode(cabinet, null);
    const first = await run(`keypad cachet ${factory}`);
    check('factory code asks for a new code', first?.type === 'output' && /factory code/i.test(first?.message || ''), first?.message);
    check("factory code doesn't move the wall yet", _test.isOpen(cabinet) === wasOpen, 'the wall moved before a code was set');
    const overlay = await run(`concealcode ${CABINET} ${factory}`);
    check('the overlay is sent to its setup stage', overlay?.type === 'conceal_keypad' && overlay?.stage === 'setup', JSON.stringify(overlay));
    const same = await run(`keypad cachet ${factory} ${factory}`);
    check("the factory code can't be the new code", same?.type === 'error', same?.message);
    const set = await run(`keypad cachet ${factory} ${OWN}`);
    check('a new code is set', set?.type === 'output' && /new code set/i.test(set?.message || ''), set?.message);
    check('setting the first code opens the wall', _test.isOpen(cabinet) !== wasOpen, 'the wall stayed put');
    check('the code is stored', (await _test.ownCode(cabinet)) === OWN, String(await _test.ownCode(cabinet)));
    const stale = await run(`keypad cachet ${factory}`);
    check('the factory code stops working', stale?.type === 'error', stale?.message);
    check("the stale code doesn't move the wall", _test.isOpen(cabinet) !== wasOpen, 'the factory code moved it');
    await run(`keypad cachet ${OWN}`);
    check('the new code works the wall', _test.isOpen(cabinet) === wasOpen, "the owner's code didn't move it");

    // --- The reset key: the current code first, then a new one ----------------
    const wrongReset = await run(`concealsetcode ${CABINET} ${factory}`);
    check('reset refuses a wrong current code', wrongReset?.type === 'error', JSON.stringify(wrongReset));
    const askNew = await run(`concealsetcode ${CABINET} ${OWN}`);
    check('reset asks for the new code', askNew?.type === 'conceal_keypad' && askNew?.stage === 'new', JSON.stringify(askNew));
    const reset = await run(`concealsetcode ${CABINET} ${OWN} ${NEXT}`);
    check('reset sets the new code', reset?.type === 'output' && (await _test.ownCode(cabinet)) === NEXT, reset?.message);
    check("reset doesn't move the wall", _test.isOpen(cabinet) === wasOpen, 'a reset opened it');

    // A wrong code changes nothing and says nothing useful.
    const bad = await run('keypad cachet 9999');
    check('wrong code is refused', bad?.type === 'error', bad?.message);
    check('wrong code leaks nothing about the lab', !/chem|lab/i.test(bad?.message || ''), bad?.message);
    check("wrong code doesn't move the wall", _test.isOpen(cabinet) === wasOpen, 'state changed on a bad code');

    // The real code toggles it. Run it twice so the suite leaves the world exactly
    // as it found it — a regress that leaves a dealer's lab hanging open is a bug
    // in the test, not a passing feature.
    const code = await _test.codeOf(cabinet);
    const right = await run(`keypad cachet ${code}`);
    check('right code is accepted', right?.type === 'output', right?.message);
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
        "the lab name didn't resolve back to its cabinet");
      check('the lab back-points at its cabinet', lab.flags?.conceal_hidden_by === CABINET, JSON.stringify(lab.flags));
      // Re-read the row: updateFurniture REPLACES the cached object rather than
      // mutating it, so the `lab` captured up top still carries `concealed`.
      const liveLab = getFurnitureById(LAB);
      check('open ⇒ the lab advertises the keypad action', availableActions(liveLab, p).includes('keypad'),
        JSON.stringify(liveLab?.flags));
    }

    await run(`keypad cachet ${code}`);
    check('toggles back to how it started', _test.isOpen(cabinet) === wasOpen, 'left the cabinet in the wrong state');
    check("sealed ⇒ the lab isn't a keypad advert", !availableActions(getFurnitureById(LAB), p).includes('keypad'),
      'a sealed lab advertised its own keypad');

    // While sealed, examine advertises the pad and nothing else.
    const desc = await run('examine cachet vantage 900 cabinet');
    check('examine shows a keypad, not a lab', /keypad/i.test(desc?.message || '') && !/chem lab/i.test(desc?.message || ''), desc?.message);

    await _test.restoreCode(cabinet, priorCode);
    check('the code is put back how the suite found it', (await _test.ownCode(cabinet)) === priorCode, String(await _test.ownCode(cabinet)));
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
    "owner wasn't offered the pad in their own room");
  check('a guest is told nothing', hooks['furniture.describe'](fake, stranger) === undefined,
    'the pad advertised itself to a stranger');
  check('owner gets the keypad action', availableActions(fake, p).includes('keypad'),
    JSON.stringify(availableActions(fake, p)));
  check('guest gets no keypad action', !availableActions(fake, stranger).includes('keypad'),
    JSON.stringify(availableActions(fake, stranger)));
  // …and only the owner sets the code, so a guest who knows it can't lock them out
  check('owner may set the code', _test.canSetCode(fake, p), 'the owner was refused');
  check("a guest can't set the code", !_test.canSetCode(fake, stranger), 'a guest could change the code');

  // Unowned space is unchanged — nobody to be private from.
  const openRoom = { ...fake, zone_id: '__conceal_unowned_zone__' };
  check('unowned room still shows the pad to anyone', availableActions(openRoom, stranger).includes('keypad'),
    'owner-gating leaked into unowned space');

  // Hiding the advert must NOT lock the verb: resolution is by name in the room,
  // with no owner test anywhere on the path, so a guest with the code still works it.
  p.current_zone = getFurnitureById(CABINET)?.zone_id || savedZone;
  const asStranger = await _test.resolveDisguise(stranger.id ? { ...p, id: stranger.id } : p, 'cachet');
  check("the verb itself isn't owner-locked", !!asStranger.furniture, JSON.stringify(asStranger));

  p.current_zone = savedZone;
}
