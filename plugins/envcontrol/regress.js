// envcontrol regression suite, run by tests/regress.js (never loaded in production). Drives the five
// verbs against the first panel in content (Solenne Residence 30-B) and puts every row it touches
// back as it found it in the finally.
import { getFurnitureById, updateFurniture } from '../../server/engine/world.js';
import { getZoneHeatBonus } from '../../server/engine/environment.js';
import { furnitureActs } from '../../server/engine/furnitureActions.js';
import { archetypeOf, formOf } from '../../client/shared/room-layout.js';
import { gatherHookSync } from '../../server/engine/plugins.js';
import { on } from '../../server/engine/events.js';
import { SHUTTER_KINDS } from '../../client/game/js/panels/gl/room-shutters.js';
import { SCENES, SCENE_IDS, scenesOf, findScene, paintOf, colourName } from './scenes.js';
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
    // a player's name is `handle`; `name` is undefined, and read that way it welcomed nobody by name
    check('`panel` welcomes whoever woke it by name', r.greet?.name === p.handle && typeof r.greet.owner === 'boolean', JSON.stringify(r?.greet));
    check('a refresh carries no welcome', !(await run('panel refresh')).greet);
    check('the panel sees both rooms\' lights', r.lights.some((l) => l.zone === FLAT) && r.lights.some((l) => l.zone === BATH), JSON.stringify(r.lights));
    r = await run('panel refresh');
    check('a refresh writes nothing to the log', r?.type === 'envctl' && r.message === '' && !r.open);

    r = await run('lights off');
    check('`lights off` puts every light out', r?.type === 'envctl' && r.lights.every((l) => !l.on), JSON.stringify(r?.lights));
    r = await run('lights');
    check('bare `lights` toggles them back on (when there is power)', r?.type === 'envctl' && (r.power === 'unpowered' || r.lights.every((l) => l.on)), JSON.stringify(r?.lights));
    r = await run('lights sideways');
    check('a bad word is a usage error', r?.type === 'error');
    // the dimmer: one light by its number on the list, to a level
    r = await run('dim 1 40');
    if (r?.power !== 'unpowered') {
      check('`dim 1 40` sets the first light to 40%', r?.lights?.[0]?.on === true && r.lights[0].dim === 40, JSON.stringify(r?.lights?.[0]));
      r = await run('dim 1 0');
      check('`dim 1 0` puts it out and keeps its level', r?.lights?.[0]?.on === false && r.lights[0].dim === 40, JSON.stringify(r?.lights?.[0]));
    }
    r = await run('dim 1 150');
    check('a level past 100 is a usage error', r?.type === 'error');
    r = await run('dim nosuchlamp 50');
    check("a light the panel hasn't got says so", r?.type === 'envctl' && /no light/.test(r.message), r?.message);

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

    // ── the shutters and blinds over the glass wall ──
    check('scene words find their scene', findScene('deep space') === 'space' && findScene('sea') === 'underwater' && findScene('northern lights') === 'aurora' && findScene('lava') === null);
    check('every scene has a painter the Room Stage knows', SCENE_IDS.every((id) => SHUTTER_KINDS.includes(SCENES[id].kind)), SCENE_IDS.filter((id) => !SHUTTER_KINDS.includes(SCENES[id].kind)).join(','));
    check('a row with no scenes listed offers them all', scenesOf({}).length === SCENE_IDS.length && scenesOf({ scenes: ['storm', 'nope'] }).join() === 'storm');
    check('30-B has a glass wall, so the card offers Shutters', _test.hasGlass(panel) && furnitureActs(panel).some((a) => a.verb === 'shutters'));
    // `shutters` is storefront's verb as well (a shop's roller shutter), and only one handler is kept: this
    // plugin's, which hands it back away from a panel. With storefront's winning, every press came back
    // "There's no shop unit here."
    p.current_zone = '__envctl_nowhere__';
    r = await run('shutters');
    check('away from a panel, `shutters` is a shop\'s shutter (storefront)', r?.type !== 'envctl' && /shop/i.test(r?.message || ''), r?.message);
    p.current_zone = FLAT;
    const sent = [];
    on('room.glassChanged', (e) => sent.push(e));
    r = await run('shutters up');
    check('`shutters up` leaves the glass clear', r?.type === 'envctl' && r.shutters && r.shutters.down === false, JSON.stringify(r?.shutters));
    check('the panel lists its scenes with swatches', r.shutters.scenes.length > 1 && r.shutters.scenes.every((x) => x.name && Array.isArray(x.swatch)), JSON.stringify(r.shutters.scenes?.[0]));
    r = await run('shutters lava');
    check('a scene the panel hasn\'t got is a usage error', r?.type === 'error' && /Deep space/.test(r.message), r?.message);
    r = await run('shutters colour mauve');
    check('a colour that isn\'t #rrggbb is a usage error', r?.type === 'error' && /colour/.test(r.message), r?.message);
    check('a picked colour reaches the blinds and no other scene', paintOf('blinds', '#b5552e').b === '#b5552e' && paintOf('space', '#b5552e').b === SCENES.space.b && paintOf('blinds', null).b === SCENES.blinds.b);
    check('colours get plain names for the log', colourName('#2f6b4a') === 'green' && colourName('#1b2a4a') === 'dark blue' && colourName('#777777') === 'grey');
    if (r && getFurnitureById(PANEL) && (await run('panel refresh'))?.power !== 'unpowered') {
      const n0 = sent.length;
      r = await run('shutters space');
      check('`shutters space` brings them down showing it', r?.shutters?.down === true && r.shutters.scene === 'space', JSON.stringify(r?.shutters));
      check('the change goes to the Room Stage', sent.length === n0 + 1 && sent.at(-1).zoneId === FLAT && sent.at(-1).glass?.paint?.kind === 'stars', JSON.stringify(sent.at(-1)));
      const glass = gatherHookSync('room.glass', FLAT)[0];
      check('`room_view` sees the same glass (room.glass)', glass?.down === true && glass.scene === 'space' && glass.lit === true, JSON.stringify(glass));
      check('a room with no panel has nothing over its glass', gatherHookSync('room.glass', '__envctl_nowhere__').length === 0);
      r = await run('shutters sea');
      check('a scene\'s word changes the picture', r?.shutters?.scene === 'underwater' && r.shutters.down, JSON.stringify(r?.shutters));
      r = await run('shutters sea');
      check('the same scene again changes nothing', r?.type === 'envctl' && /already/.test(r.message) && sent.length === n0 + 2, r?.message);
      r = await run('shutters blinds 33');
      check('`shutters blinds 33` draws the blinds at the nearest 5%', r?.shutters?.scene === 'blinds' && r.shutters.level === 35 && r.shutters.down, JSON.stringify(r?.shutters));
      r = await run('shutters 80%');
      check('a number alone turns the blinds', r?.shutters?.scene === 'blinds' && r.shutters.level === 80 && /80%/.test(r.message), r?.message);
      check('the Room Stage gets the blinds\' level', gatherHookSync('room.glass', FLAT)[0]?.level === 80);
      // the colour wheel sends `shutters colour <#rrggbb>`
      r = await run('shutters colour #2F6B4A');
      check('`shutters colour` colours the blinds, and says what colour', r?.shutters?.colour === '#2f6b4a' && r.shutters.scene === 'blinds' && /green/.test(r.message), r?.message);
      check('the Room Stage draws the cloth in it', gatherHookSync('room.glass', FLAT)[0]?.paint?.b === '#2f6b4a', JSON.stringify(gatherHookSync('room.glass', FLAT)[0]?.paint));
      check('the blinds\' swatch on the panel is in it', r.shutters.scenes.find((x) => x.id === 'blinds')?.swatch?.[1] === '#2f6b4a');
      r = await run('shutters 60');
      check('turning the blinds keeps their colour', r?.shutters?.level === 60 && r.shutters.colour === '#2f6b4a', JSON.stringify(r?.shutters));
      r = await run('shutters space 40');
      check('a number with a scene that isn\'t the blinds is a usage error', r?.type === 'error');
      r = await run('shutters');
      check('bare `shutters` toggles them up', r?.shutters?.down === false, JSON.stringify(r?.shutters));
      r = await run('shutters');
      check('and down again, as they were', r?.shutters?.down === true && r.shutters.scene === 'blinds', JSON.stringify(r?.shutters));
    }
  } finally {
    p.current_zone = wasZone;
    ramps.delete(PANEL);
    await updateFurniture(PANEL, { flags: JSON.stringify(savedFlags) }).catch(() => {});
    for (const [id, on] of savedLights) await updateFurniture(id, { light_on: on }).catch(() => {});
  }
}
