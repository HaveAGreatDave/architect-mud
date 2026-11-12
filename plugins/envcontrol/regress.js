// envcontrol regression suite, run by tests/regress.js (never loaded in production). Drives the four
// verbs against the first panel in content (Solenne Residence 30-B) and puts every row it touches
// back as it found it in the finally.
import { getFurnitureById, updateFurniture } from '../../server/engine/world.js';
import { getZoneHeatBonus } from '../../server/engine/environment.js';
import { furnitureActs } from '../../server/engine/furnitureActions.js';
import { archetypeOf, formOf } from '../../client/shared/room-layout.js';
import { _test } from './index.js';

const FLAT = 'zone_solenne_apt_b', BATH = 'zone_solenne_apt_b_bath', PANEL = 'furn_solenne_apt_b_envctl';

export default async function regress({ run, check, getPlayer }) {
  const { isPanel, panelFor, lightsOf, heldAt, ramps } = _test;

  // ── what a panel is, without the world ─────────────────────────────────────
  check('a row with flags.envctl is a panel', isPanel({ flags: { envctl: {} } }) === true);
  check("a row without it isn't", isPanel({ flags: {} }) === false && isPanel(null) === false);
  const fake = { id: '__envctl_fake__', zone_id: '__nowhere__', flags: { envctl: { target_c: 20 } } };
  ramps.set(fake.id, { fromC: 10, at: Date.now() - 3 * 60000 });
  // __nowhere__ has no power status, so the plant isn't running and holds nothing
  check('an unpowered panel holds nothing', heldAt(fake, 10) === null, String(heldAt(fake, 10)));
  ramps.delete(fake.id);
  check('the panel lays out as a hung cabinet', archetypeOf({ look: { arche: 'cabinet', form: 'cupboard' } }) === 'cabinet' && formOf('cabinet', { look: { form: 'cupboard' } }) === 'cupboard');

  const panel = getFurnitureById(PANEL);
  check('30-B has its control panel', !!panel && isPanel(panel), PANEL);
  if (!panel) return;
  check('the panel runs the en-suite too', panelFor(BATH)?.id === PANEL, panelFor(BATH)?.id);
  const acts = furnitureActs(panel).map((a) => a.verb);
  check('the card offers the screen first, then lights and the door', acts[0] === 'panel' && acts.includes('lights') && acts.includes('doorcam'), acts.join(','));

  const p = getPlayer(), wasZone = p.current_zone;
  const savedFlags = JSON.parse(JSON.stringify(panel.flags));
  const savedLights = lightsOf(panel).map((l) => [l.id, l.light_on ? 1 : 0]);
  try {
    p.current_zone = '__envctl_nowhere__';
    let r = await run('panel');
    check('no panel, no screen', r?.type === 'error', r?.message);

    p.current_zone = FLAT;
    r = await run('panel');
    check('`panel` opens the screen with the state', r?.type === 'envctl' && r.open === true && Array.isArray(r.lights) && r.climate && r.cam, JSON.stringify(r)?.slice(0, 200));
    check('the panel sees both rooms\' lights', r.lights.some((l) => l.zone === FLAT) && r.lights.some((l) => l.zone === BATH), JSON.stringify(r.lights));
    r = await run('panel refresh');
    check('a refresh writes nothing to the log', r?.type === 'envctl' && r.message === '' && !r.open);

    r = await run('lights off');
    check('`lights off` puts every light out', r?.type === 'envctl' && r.lights.every((l) => !l.on), JSON.stringify(r?.lights));
    r = await run('lights');
    check('bare `lights` toggles them back on (when there is power)', r?.type === 'envctl' && (r.power === 'unpowered' || r.lights.every((l) => l.on)), JSON.stringify(r?.lights));
    r = await run('lights sideways');
    check('a bad word is a usage error', r?.type === 'error');

    r = await run('thermostat 99');
    check('a setting is held to the panel\'s range', r?.climate?.target === 28, String(r?.climate?.target));
    r = await run('thermostat down');
    check('`thermostat down` takes a degree off', r?.climate?.target === 27, String(r?.climate?.target));
    // the plant ramps: just after a change the room is where it was, not at the setting
    const live = getFurnitureById(PANEL);
    ramps.set(PANEL, { fromC: 10, at: Date.now() });
    const held = heldAt(live, 10);
    check('the room moves toward the setting, not to it', held === null || (held >= 10 && held < 11), String(held));
    ramps.delete(PANEL);
    if (heldAt(live, 10) !== null) check('the heat source drives the room to the setting', getZoneHeatBonus(FLAT, 10) >= 17, String(getZoneHeatBonus(FLAT, 10)));
    r = await run('thermostat off');
    check('`thermostat off` stops the plant', r?.climate?.target === null && getZoneHeatBonus(FLAT, 10) === 0, String(r?.climate?.target));
    r = await run('thermostat warm');
    check('a word that isn\'t a temperature is a usage error', r?.type === 'error');

    r = await run('doorcam');
    check('`doorcam` answers with the door camera', r?.type === 'envctl' && r.cam && /DOOR/.test(r.message), r?.message);
    check('the door camera is the hall outside', r.cam.status === 'gone' || /Residences|hall/i.test(r.cam.label || ''), r.cam.label);
  } finally {
    p.current_zone = wasZone;
    ramps.delete(PANEL);
    await updateFurniture(PANEL, { flags: JSON.stringify(savedFlags) }).catch(() => {});
    for (const [id, on] of savedLights) await updateFurniture(id, { light_on: on }).catch(() => {});
  }
}
