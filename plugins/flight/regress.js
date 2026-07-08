// Flight plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player is grounded, aboard nothing, at no airfield, so we
// exercise the gated no-mutation paths across every submodule (verbs route, gate
// correctly, and delegate to the shadowed owner off-context) plus pure helpers.
import { _test } from './index.js';
import { withinShift, pilotTarget, stepToward, charterFare, pilotColor } from './charter.js';
import { signatureMult, signatureScore, colorName, describeExterior,
  normalizeLivery, sanitizeLivery, conspicuousnessMult, paintCost, isPaintable,
  readSchemes, schemeOf } from './livery.js';
import { crashSeverity, collateralBill, isSeverelyImpaired } from './collateral.js';
import { sellAircraft, cancelRental } from './hangars.js';
import { query } from '../../server/models/db.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // ── Crash collateral (pure) ─────────────────────────────────────────────────
  check('crash severity scales with airframe', crashSeverity(8) === 1 && crashSeverity(30) === 2 && crashSeverity(85) === 3);
  check('collateral bill rises with casualties', collateralBill(2, 3, true) > collateralBill(2, 1, true));
  check('an empty tile has no cleanup charge', collateralBill(3, 0, false) === 0 && collateralBill(3, 0, true) > 0);

  // ── Fit-to-fly: severe impairment (any kind) is detected ────────────────────
  check('a sober pilot is not impaired', isSeverelyImpaired({ intoxication: 10, activeDrugs: [] }) === false);
  check('blackout-drunk is impaired', isSeverelyImpaired({ intoxication: 70 }) === true);
  check('a real active drug dose is impaired', isSeverelyImpaired({ activeDrugs: [{ potency: 0.9 }] }) === true);
  check('a faded comedown tail is not severe', isSeverelyImpaired({ intoxication: 20, activeDrugs: [{ potency: 0.3 }] }) === false);
  check('a null pilot is not impaired', isSeverelyImpaired(null) === false);

  // ── Pure helpers ────────────────────────────────────────────────────────────
  check('DIRS has all 8 compass steps', Object.keys(_test.DIRS).length === 8, Object.keys(_test.DIRS).join(','));
  check('surfaceAt off the map is open air (null)', _test.surfaceAt(9999, 9999) === null);
  const clean = { type: { handling: -1 }, row: { damage: 0, custom_data: {} } };
  const hurt = { type: { handling: -1 }, row: { damage: 0.5, custom_data: {} } };
  check('landDifficulty rises with damage', _test.landDifficulty(hurt, false) > _test.landDifficulty(clean, false));
  check('emergency landing is harder', _test.landDifficulty(clean, true) > _test.landDifficulty(clean, false));

  // Engine-noise propagation: bigger/louder craft carry farther; altitude silences.
  const quiet = { type: { noise: 1, engines: 1, max_takeoff_weight: 90 }, row: { throttle: 60, altitude_band: 'low' } };
  const loud = { type: { noise: 3, engines: 4, max_takeoff_weight: 1400 }, row: { throttle: 60, altitude_band: 'low' } };
  const high = { type: { noise: 3, engines: 4, max_takeoff_weight: 1400 }, row: { throttle: 60, altitude_band: 'high' } };
  check('a big loud craft is heard farther than an ultralight', _test.noiseReach(loud) > _test.noiseReach(quiet), `${_test.noiseReach(loud)} vs ${_test.noiseReach(quiet)}`);
  check('high flight is inaudible from the ground', _test.noiseReach(high) === 0, String(_test.noiseReach(high)));

  // ── Livery / paint signature (pure) ─────────────────────────────────────────
  const darkLv = { base: '#111214', trim: '#111214', pattern: 'splinter', finish: 'matte' };
  const brightLv = { base: '#f2f4f6', trim: '#f2b01e', pattern: 'hazard', finish: 'gloss' };
  check('dark matte camo is stealthier than bright glossy hazard', signatureMult(darkLv) < signatureMult(brightLv), `${signatureMult(darkLv)} vs ${signatureMult(brightLv)}`);
  check('signature multiplier stays inside the ±25% band', signatureMult(brightLv) <= 1.25 && signatureMult(darkLv) >= 0.75);
  check('signature score spans 0..100', signatureScore(darkLv) >= 0 && signatureScore(brightLv) <= 100);
  check('colorName maps a red hex to a warm word', /red|crimson|rust/.test(colorName('#c81f22')), colorName('#c81f22'));
  check('normalizeLivery upgrades a legacy free-text string', normalizeLivery({ livery: 'shark mouth' }).text === 'shark mouth' && normalizeLivery({ livery: 'shark mouth' }).pattern === 'bare');
  check('describeExterior names the craft', /Mule/.test(describeExterior({ base: '#b81f24', trim: '#eeeeee', pattern: 'stripes', finish: 'gloss' }, 'Mule', 'R-DAV1')));
  check('conspicuousnessMult reads paint off a live row', conspicuousnessMult({ row: { custom_data: { livery: darkLv } } }) < conspicuousnessMult({ row: { custom_data: { livery: brightLv } } }));
  check('paintCost scales by class (heavy dearer than ultralight)', paintCost({ class: 'heavy' }) > paintCost({ class: 'ultralight' }));
  check('rentals and wrecks are not paintable; a plain owned craft is', !isPaintable({ rental: 1 }) && !isPaintable({ is_wreck: 1 }) && isPaintable({}));
  // Slice 2 — decals + saved schemes.
  check('a decal is described in the exterior prose', /shark/i.test(describeExterior({ base: '#334455', trim: '#889', pattern: 'solid', finish: 'satin', decal: 'sharkmouth' }, 'Reaper')));
  check('a bad decal falls back to none', normalizeLivery({ livery: { decal: 'lolnope' } }).decal === 'none');
  check('decal is cosmetic — no effect on signature', signatureMult({ base: '#808080', pattern: 'solid', finish: 'satin', decal: 'none' }) === signatureMult({ base: '#808080', pattern: 'solid', finish: 'satin', decal: 'sharkmouth' }));
  check('schemeOf captures the core paint fields', (() => { const s = schemeOf({ base: '#010203', trim: '#040506', pattern: 'hazard', finish: 'gloss', decal: 'sigil', cabin: '#070809', uphol: 'leather' }); return s.base === '#010203' && s.pattern === 'hazard' && s.decal === 'sigil' && !('schemes' in s) && !('text' in s); })());
  check('readSchemes returns saved schemes as a map', Object.keys(readSchemes({ livery: { schemes: { fast: { base: '#111111' } } } })).includes('fast') && Object.keys(readSchemes({})).length === 0);
  check('sanitizeLivery keeps a valid decal, drops junk', sanitizeLivery({ decal: 'killmarks' }).decal === 'killmarks' && sanitizeLivery({ decal: 'x' }, { decal: 'sigil' }).decal === 'sigil');

  // ── Charter lifecycle cores (pure; content-independent state machine) ────────
  check('shift wraps midnight: 16:00 start covers 20:00', withinShift(16, 20) === true);
  check('shift wraps midnight: 16:00 start excludes 08:00', withinShift(16, 8) === false);
  check('graveyard 00:00 start covers 04:00', withinShift(0, 4) === true);
  check('graveyard 00:00 start excludes 23:00', withinShift(0, 23) === false);
  check('shift end is exclusive at +8h', withinShift(8, 16) === false && withinShift(8, 15) === true);

  const T = (o) => pilotTarget({ field: 'F', home: 'H', ...o });
  check('free + on-shift + hangar → sits inside the hangar', T({ onShift: true, interior: 'I' }) === 'I');
  check('free + on-shift + no hangar → the field tile', T({ onShift: true, interior: null }) === 'F');
  check('free + off-shift → home', T({ onShift: false, interior: 'I' }) === 'H');
  check('flying a run (enroute) → home', T({ busyPhase: 'enroute', onShift: true, interior: 'I' }) === 'H');
  check('deadheading back (returning) → home', T({ busyPhase: 'returning', interior: 'I' }) === 'H');
  check('staged at the hangar (boarding) → the field tile', T({ busyPhase: 'boarding', interior: 'I' }) === 'F');
  check('taxiing out (departing) → the field tile', T({ busyPhase: 'departing', interior: 'I' }) === 'F');

  const near = stepToward(0, 0, 1, 1, 2);
  check('autoflight snaps to target within a cruise step', near.arrived === true && near.fx === 1 && near.fy === 1);
  const far = stepToward(0, 0, 10, 0, 2);
  check('autoflight advances one cruise step when far', far.arrived === false && Math.abs(far.fx - 2) < 1e-9 && far.fy === 0);
  check('autoflight reports the remaining distance', Math.abs(far.d - 10) < 1e-9);
  check('charter fare is ~100c for a short hop', charterFare(0, 0, 1, 1) === 95, charterFare(0, 0, 1, 1));
  check('charter fare rises with distance', charterFare(0, 0, 10, 0) > charterFare(0, 0, 1, 1));
  check('off-airfield (anywhere) fare is a premium over the same-distance Mule fare', charterFare(0, 0, 5, 0, true) > charterFare(0, 0, 5, 0, false));
  check('a zero-distance fare is still the flat base', charterFare(0, 0, 0, 0) === 90);
  check('pilotColor gives every known pilot a distinct hex, and a sane fallback for unknowns', /^#[0-9a-f]{6}$/i.test(pilotColor('npc_charter_doyle')) && pilotColor('npc_charter_doyle') !== pilotColor('npc_charter_kessler') && /^#[0-9a-f]{6}$/i.test(pilotColor('nobody')));

  const savedPosture = p.posture, savedCombat = p.npcCombatTargetId, savedAc = p.aircraftId;
  p.posture = 'standing'; p.npcCombatTargetId = null; delete p.aircraftId; delete p.seat;

  // ── Core verbs gate when not aboard ─────────────────────────────────────────
  // `embark` (primary) is aircraft-only; `board` (backup) delegates to poker off-context.
  let r = await run('embark');
  check('embark with no craft here reports it', /no aircraft here to embark/i.test(r?.message || ''), r?.message);
  r = await run('board');
  check('board with no craft here delegates to poker board', /no active hand|not.*seat|table/i.test(r?.message || ''), r?.message);
  r = await run('startup'); check('startup not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('throttle 50'); check('throttle not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('takeoff'); check('takeoff not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('takeoffresolve tok 1'); check('takeoffresolve unarmed no-ops', r?.type === 'noop', r?.type);
  r = await run('landresolve tok 1'); check('landresolve unarmed no-ops', r?.type === 'noop', r?.type);

  // ── Continuous-flight seam (whole fleet, incl. the Dragonfly hover model) ────
  check('fixed-wing fleet flies the continuous sim', _test.isContinuous({ type: { id: 'ac_mayfly' } }) === true && _test.isContinuous({ type: { id: 'ac_reaper' } }) === true);
  check('the Dragonfly (VTOL heli) flies the continuous sim too', _test.isContinuous({ type: { id: 'ac_dragonfly' } }) === true);
  check('bandFromAltitude: on the deck → ground', _test.bandFromAltitude(0, true) === 'ground');
  check('bandFromAltitude: 300ft → low', _test.bandFromAltitude(300) === 'low');
  check('bandFromAltitude: 800ft → cruise', _test.bandFromAltitude(800) === 'cruise');
  check('bandFromAltitude: 2000ft → high', _test.bandFromAltitude(2000) === 'high');
  r = await run('flightsync 0 0 0 0 0 0 0 1 0'); check('flightsync not aboard no-ops', r?.type === 'noop', r?.type);
  r = await run('flightevent takeoff'); check('flightevent not aboard no-ops', r?.type === 'noop', r?.type);

  // ── Hazard / utility verbs gate when not aboard ─────────────────────────────
  r = await run('recover'); check('recover not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('hover'); check('hover not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('chart'); check('chart not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);

  // ── Combat verbs gate; strafresolve is a silent no-op unarmed ───────────────
  r = await run('arm'); check('arm not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('strafe'); check('strafe not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('strafresolve tok 1'); check('strafresolve unarmed no-ops', r?.type === 'noop', r?.type);
  r = await run('airfire guns x 1'); check('airfire (A2A guns) not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('jettison'); check('jettison not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);

  // ── Acquisition / contracts / hangars gate off an airfield ──────────────────
  r = await run('charter'); check('charter off-field reports no desk', /no .*(charter|dealer)/i.test(r?.message || ''), r?.message);
  r = await run('contracts'); check('contracts off-field reports the board is elsewhere', /board/i.test(r?.message || ''), r?.message);
  r = await run('hangar'); check('hangar off-field reports airfields', /airfield/i.test(r?.message || ''), r?.message);
  r = await run('showroom'); check('showroom off-field points to the airfields', /airfield|showroom/i.test(r?.message || ''), r?.message);
  r = await run('view mayfly'); check('view off-field falls through (does not hijack the generic verb)', r?.type === 'error' && /unknown command/i.test(r?.message || ''), `${r?.type}:${r?.message}`);
  r = await run('loadout'); check('loadout with no craft here reports it', /no aircraft of yours/i.test(r?.message || ''), r?.message);
  r = await run('salvage'); check('salvage with no wreck reports it', /no wreck/i.test(r?.message || ''), r?.message);
  r = await run('modify'); check('modify requires an owned aircraft', /own|no aircraft of your own/i.test(r?.message || ''), r?.message);
  r = await run('paintset nope #111111 #222222 solid matte #333333 standard none'); check('paintset on an unknown craft is refused', /no such aircraft/i.test(r?.message || ''), r?.message);
  r = await run('scheme save fast'); check('scheme with no owned craft is refused', /no aircraft of your own|own/i.test(r?.message || ''), r?.message);
  r = await run('hangaract store x'); check('hangaract off-field reports airfields', /airfield/i.test(r?.message || ''), r?.message);
  r = await run('examine mayfly'); check('examine off-field delegates past the flight plugin', !/sits here/i.test(r?.message || ''), r?.message);
  r = await run('charter mule 1'); check('charter <ride> <dest> off-field reports no desk', /no .*(charter|dealer|desk)/i.test(r?.message || ''), r?.message);
  r = await run('charterinfo'); check('charterinfo (dialog alias) off-field reports no desk', /no .*(charter|dealer)/i.test(r?.message || ''), r?.message);
  r = await run('charterbook zone_outskirts'); check('charterbook off-field reports no desk', /no .*(charter|dealer)/i.test(r?.message || ''), r?.message);
  r = await run('fleet'); check('fleet (hangar-bay alias) off-field reports airfields', /airfield/i.test(r?.message || ''), r?.message);
  r = await run('carousel'); check('carousel (hangar-bay alias) off-field reports airfields', /airfield/i.test(r?.message || ''), r?.message);
  r = await run('flyto 1'); check('flyto is retired (destination is chosen at the desk now)', r?.type === 'error' && /unknown command/i.test(r?.message || ''), `${r?.type}:${r?.message}`);
  r = await run('cancel'); check('cancel with no charter is a clean no-op (falls through)', !/called off|refunded/i.test(r?.message || ''), r?.message);
  r = await run('testfly dragonfly'); check('testfly is admin-gated', /access denied/i.test(r?.message || ''), r?.message);

  // ── Collision routers fall through / delegate off-context ───────────────────
  r = await run('repair'); check('repair off-context falls through to gear repair', !/aircraft/i.test(r?.message || ''), r?.message);

  // ── Sell / cancel rental (Tablet OS "Vehicles" app) ──────────────────────────
  const { rows: types } = await query("SELECT id, price_buy FROM aircraft_types WHERE class <> 'wreck' ORDER BY price_buy LIMIT 1");
  const acType = types[0];
  if (acType) {
    const soldId = 'aircraft_regress_sell';
    const rentedId = 'aircraft_regress_rental';
    const strangerId = 'aircraft_regress_stranger';
    await query('DELETE FROM aircraft WHERE id = ANY($1)', [[soldId, rentedId, strangerId]]);

    await query(
      `INSERT INTO aircraft (id,type_id,name,owner_id,rental,is_wreck,airborne,damage) VALUES ($1,$2,'REGR-01',$3,0,0,0,0.2)`,
      [soldId, acType.id, p.id]
    );
    const before = p.credits || 0;
    let sr = await sellAircraft(p, soldId);
    check('sellAircraft pays out and reports the aircraft', sr?.type === 'output' && /Sold/.test(sr.message || ''), JSON.stringify(sr));
    check('sellAircraft credits the expected refund (50% of price, damage-scaled)', p.credits === before + Math.max(1, Math.round(acType.price_buy * 0.5 * (1 - 0.2 * 0.5))), `before=${before} after=${p.credits}`);
    let { rows: gone } = await query('SELECT 1 FROM aircraft WHERE id=$1', [soldId]);
    check('sellAircraft deletes the aircraft row', gone.length === 0, JSON.stringify(gone));

    await query(
      `INSERT INTO aircraft (id,type_id,name,owner_id,rental,is_wreck,airborne,damage) VALUES ($1,$2,'REGR-02',$3,1,0,0,0)`,
      [rentedId, acType.id, p.id]
    );
    const beforeCredits = p.credits || 0;
    let cr = await cancelRental(p, rentedId);
    check('cancelRental reports the aircraft returned', cr?.type === 'output' && /Returned/.test(cr.message || ''), JSON.stringify(cr));
    check('cancelRental gives no refund', p.credits === beforeCredits, `before=${beforeCredits} after=${p.credits}`);
    ({ rows: gone } = await query('SELECT 1 FROM aircraft WHERE id=$1', [rentedId]));
    check('cancelRental deletes the aircraft row', gone.length === 0, JSON.stringify(gone));

    // Ownership + airborne gating, both entry points.
    await query(
      `INSERT INTO aircraft (id,type_id,name,owner_id,rental,is_wreck,airborne,damage) VALUES ($1,$2,'REGR-03','someone_else',0,0,0,0)`,
      [strangerId, acType.id]
    );
    sr = await sellAircraft(p, strangerId);
    check('sellAircraft refuses an aircraft you do not own', sr?.type === 'error', JSON.stringify(sr));
    await query('UPDATE aircraft SET owner_id=$1, airborne=1 WHERE id=$2', [p.id, strangerId]);
    sr = await sellAircraft(p, strangerId);
    check('sellAircraft refuses an airborne aircraft', sr?.type === 'error' && /air/i.test(sr.message || ''), JSON.stringify(sr));
    await query('DELETE FROM aircraft WHERE id=$1', [strangerId]);
  }

  p.posture = savedPosture; p.npcCombatTargetId = savedCombat;
  if (savedAc) p.aircraftId = savedAc; else { delete p.aircraftId; delete p.seat; }
}
