// Flight plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player is grounded, aboard nothing, at no airfield, so we
// exercise the gated no-mutation paths across every submodule (verbs route, gate
// correctly, and delegate to the shadowed owner off-context) plus pure helpers.
import { _test } from './index.js';
import { withinShift, pilotTarget, charterOwnsPilot, stepToward, charterFare, pilotColor } from './charter.js';
import { signatureMult, signatureScore, colorName, describeExterior,
  normalizeLivery, sanitizeLivery, conspicuousnessMult, paintCost, isPaintable,
  readSchemes, schemeOf } from './livery.js';
import { crashSeverity, collateralBill, isSeverelyImpaired } from './collateral.js';
import { sellAircraft, cancelRental, flushAirborne, pushHangarBay } from './hangars.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { computeStats, perfAxes, tuneRange, installedKits, KITS, TUNE_DIAL_MAX,
  PARTS, PART_SLOTS, slotsFor, installedParts, partDefs, partEnvelope, PYLON_MIN_TOW,
  shearRoll, surfacesWire, anyWingLost, resetSurfaces, SURFACE_KEYS,
  isWalkableCabin, cabinTypeOf, cabinEntryZone, isCabinZone, liveAircraft, getZone, loadAircraft, stalledState, CONTINUOUS_TYPES, listAirfields, nearestAirfield, listRegions, worldTerrainMap, salvoOf, bombLoad, bombAmmo, waypointFor, bounds as flightBounds,
  vtolOnlyField, acquirableTypes, hangarRampFor, HANGAR_REACH, BANDS, airfieldOf, fieldName } from './state.js';
import { isFreightLicensed, ensureFreightDrops, isAirCargoUnlocked, hasCacheStanding,
  openOrders, placeCacheOrder, rawsCatalogue, trustFor, unitsPerPallet, palletPrice,
  waitingDropAt, FENCE_CACHES } from './contracts.js';
import { isPilotLicensed, _test as checkrideTest } from './checkride.js';
import { diveQuality } from './combat.js';
import { setFlag, clearFlag } from '../../server/engine/flags.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { buyFromVendor } from '../../server/engine/vendor.js';

const nowSec = () => Math.floor(Date.now() / 1000);
import { prefersTextTravel, textTravelTick, TEXT_TRAVEL_FLAG } from './textmode.js';
import { startTextPilot, stopTextPilot, textPilotTick, landingGrade, statusLines, panelPayload, cmdTextLand, _test as tpTest } from './textpilot.js';
import { query } from '../../server/models/db.js';
import { TYPES as FM_TYPES, SURFACES as FM_SURFACES, createState as fmCreate, step as fmStep } from '../../client/game/js/panels/flight-model.js';

// ── Flight-model harness ──────────────────────────────────────────────────────
// The continuous flight model is pure and DOM-free, so it can be stepped headless. It had
// no automated coverage at all until the AoA rework; these guard the properties that the
// rework is FOR, so a future tuning pass can't quietly undo them. Deliberately loose
// bounds — this is a regression net, not a tuning rig (that's scripts/stall-tune.mjs).
const FM_DT = 1 / 60;
const fmIn = (o = {}) => ({ elevator: 0, aileron: 0, throttle: 0.6, flaps: 0, pedal: 0, ...o });
function fmAir(p, spd, alt = 8000) {
  const s = fmCreate(p); s.onGround = false; s.altitude = alt; s.airspeed = spd; s.rpm = 0.6; s.pitch = 0;
  return s;
}
// Decelerating wings-level entry: hold height with an increasing pull until the wing lets go.
function fmStall1g(p) {
  const s = fmAir(p, p.cruise);
  for (let t = 0; t < 180; t += FM_DT) {
    fmStep(s, fmIn({ elevator: Math.min(1, Math.max(0, -s.vs / 400) + 0.06), throttle: 0 }), p, FM_DT);
    if (s.stalled) return s;
  }
  return null;
}

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // ── Flight model: the stall is an ANGLE OF ATTACK event ─────────────────────
  const may = FM_TYPES.mayfly;
  const br = fmStall1g(may);
  check('flight model: a decelerating wings-level aircraft stalls at all', !!br);
  // The stall speed is now an OUTPUT of the AoA model, not an input — it must still land on
  // the airframe's authored vs0, or every approach speed in the fleet has quietly moved.
  check('flight model: the 1g break lands on the authored vs0',
    !!br && br.airspeed > may.vs0 * 0.9 && br.airspeed < may.vs0 * 1.1, br && Math.round(br.airspeed));
  check('flight model: the break happens AT the critical angle of attack',
    !!br && br.aoa > may.aoaCrit - 1 && br.aoa < may.aoaCrit + 4, br && +br.aoa.toFixed(1));
  // The whole point of the rework: a hard pull at a healthy speed can depart. The old
  // speed-triggered stall made this impossible, so this check is the load-bearing one.
  {
    const s = fmAir(may, may.cruise); let broke = null;
    for (let t = 0; t < 60 && !broke; t += FM_DT) {
      fmStep(s, fmIn({ elevator: t > 1.5 ? 1 : 0.1, aileron: 1, throttle: 1 }), may, FM_DT);
      if (s.stalled) broke = { spd: s.airspeed, g: s.g };
    }
    check('flight model: an ACCELERATED stall exists (hard pull, banked, well above vs0)',
      !!broke && broke.spd > may.vs0 * 1.25, broke && Math.round(broke.spd));
    // √n is the textbook relation between load factor and stall speed. If the derived g and
    // the AoA stall ever stop agreeing on it, one of the two has drifted off physics.
    // 25%, not 20%: √n is exact only at the instant of the break, and the wing is detected
    // a step after it lets go — by which time the pull has already bled speed off the
    // number the relation predicts. The mayfly sits at 20.4%, which was passing on the
    // strength of nothing. This is a net for "drifted off physics", not a tuning rig.
    check('flight model: the accelerated break obeys the √n rule against the derived g',
      !!broke && Math.abs(broke.spd - Math.sqrt(broke.g) * may.vs0) < may.vs0 * 0.25, broke && broke.g.toFixed(2));
  }
  // Load factor must be real and derived — a wings-level pull used to produce exactly 1.0g.
  {
    const s = fmAir(may, may.cruise); let peak = 0;
    for (let t = 0; t < 6; t += FM_DT) { fmStep(s, fmIn({ elevator: 1, throttle: 1 }), may, FM_DT); peak = Math.max(peak, s.g); }
    check('flight model: a wings-level pull loads the wing past 1g', peak > 2, peak.toFixed(2));
  }
  check('flight model: level cruise sits near 1g', (() => {
    const s = fmAir(may, may.cruise);
    for (let t = 0; t < 20; t += FM_DT) fmStep(s, fmIn({ throttle: 0.7 }), may, FM_DT);
    return s.g > 0.7 && s.g < 1.4;
  })());
  // Hysteresis + the departure: a HELD stall must stay stalled (it's a departure, not a
  // speed bump), a released one must recover on its own, and it must sink while it lasts.
  {
    const s = fmStall1g(may);
    for (let i = 0; i < 180; i++) fmStep(s, fmIn({ elevator: 1, throttle: 0 }), may, FM_DT);
    check("flight model: a HELD stall doesn't self-recover", s.stalled);
    check('flight model: a stalled aircraft actually falls', s.vs < -250, Math.round(s.vs));
    let rec = null;
    for (let i = 0; i < 60 * 25 && rec == null; i++) { fmStep(s, fmIn({ elevator: 0, throttle: 0 }), may, FM_DT); if (!s.stalled) rec = i * FM_DT; }
    check('flight model: releasing the stick recovers the stall', rec != null && rec < 12, rec && rec.toFixed(1));
  }
  // Every airframe must carry a real drag polar now — no per-type glideDrag special cases.
  // Rotorcraft and GROUND vehicles are excluded on the same grounds: neither has a wing, so a
  // best-glide speed is not a thing they can have. A ground type is not skipped silently, though —
  // it gets its own invariants below, because a TYPES entry with no assertions at all is how a
  // vehicle ends up shipping with numbers nobody ever checked.
  for (const [id, t] of Object.entries(FM_TYPES)) {
    if (t.heli || t.ground) continue;
    check(`flight model: ${id} has a derived best-glide speed above its stall speed`,
      t.bestGlide > t.vs0 && t.bestGlide < t.cruise, t.bestGlide);
  }
  for (const [id, t] of Object.entries(FM_TYPES)) {
    if (!t.ground) continue;
    // THE LONG HAUL's load-bearing tuning invariant. Every surface must leave the engine more
    // drive authority than the surface costs in rolling resistance — otherwise the truck cannot
    // move on it at all, and "the verge is slow" has quietly become "the verge is a wall".
    // An early offroad drag of 4.2 did exactly that (resistance 8.8 vs 5.6 of drive).
    for (const [name, sf] of Object.entries(FM_SURFACES)) {
      check(`flight model: ${id} can actually drive on ${name}`,
        t.thrustMax * sf.drive > t.rollFric * sf.drag * 1.15,
        `${(t.thrustMax * sf.drive).toFixed(2)} drive vs ${(t.rollFric * sf.drag).toFixed(2)} resist`);
    }
    check(`flight model: ${id} has a sane corridor time-scale`, t.tileMph > 0 && t.topSpeed > 0);
  }
  check('flight model: the buffet warns BEFORE the break', (() => {
    const s = fmAir(may, may.cruise); let sawBuffet = false;
    for (let t = 0; t < 180; t += FM_DT) {
      fmStep(s, fmIn({ elevator: Math.min(1, Math.max(0, -s.vs / 400) + 0.06), throttle: 0 }), may, FM_DT);
      if (!s.stalled && s.buffet > 0.25) sawBuffet = true;
      if (s.stalled) break;
    }
    return sawBuffet;
  })());
  check('flight model: a grounded aircraft never reads stalled or buffeting', (() => {
    const s = fmCreate(may);   // idle: she stays on the wheels, yoke fully back, for the whole run
    for (let t = 0; t < 10; t += FM_DT) fmStep(s, fmIn({ elevator: 1, throttle: 0 }), may, FM_DT);
    return s.onGround && !s.stalled && s.buffet === 0 && s.stallMargin === 1;
  })());
  // The heli branch has no wing: it must not pick up any of the fixed-wing stall state.
  check('flight model: the heli branch reports no aerodynamic stall', (() => {
    const d = FM_TYPES.dragonfly, s = fmCreate(d); s.onGround = false; s.altitude = 500;
    for (let t = 0; t < 5; t += FM_DT) fmStep(s, fmIn({ elevator: 1, throttle: 0.9 }), d, FM_DT);
    return !s.stalled && s.stallDepth === 0 && s.buffet === 0;
  })());

  // ── Crash collateral (pure) ─────────────────────────────────────────────────
  check('crash severity scales with airframe', crashSeverity(8) === 1 && crashSeverity(30) === 2 && crashSeverity(85) === 3);
  check('collateral bill rises with casualties', collateralBill(2, 3, true) > collateralBill(2, 1, true));
  check('an empty tile has no cleanup charge', collateralBill(3, 0, false) === 0 && collateralBill(3, 0, true) > 0);

  // ── Authoritative stall read (lenient anti-spoof) ───────────────────────────
  const stallT = { cruise_speed: 80 };
  check('stall: client-reported stall is always honoured',
    stalledState(stallT, { airborne: true, onGround: false, stalled: true, ias: 90, pitch: 0, vs: 0 }) === true);
  check('stall spoof: slow + nose-up + sinking reads stalled despite a "not stalled" client',
    stalledState(stallT, { airborne: true, onGround: false, stalled: false, ias: 20, pitch: 10, vs: -800 }) === true);
  check('stall: honest slow flapped approach (nose ~level, gentle sink) is NOT flagged',
    stalledState(stallT, { airborne: true, onGround: false, stalled: false, ias: 34, pitch: 1, vs: -300 }) === false);
  check('stall: a recovering pilot (nose down) is NOT flagged even when slow',
    stalledState(stallT, { airborne: true, onGround: false, stalled: false, ias: 20, pitch: -8, vs: -900 }) === false);
  check('stall: grounded/rolling never reads stalled',
    stalledState(stallT, { airborne: true, onGround: true, stalled: false, ias: 10, pitch: 10, vs: -900 }) === false);

  // ── Unified model: every airframe flies the continuous path (banded model deleted) ──
  const { rows: acTypes } = await query('SELECT id FROM aircraft_types');
  const offContinuous = acTypes.filter(r => !CONTINUOUS_TYPES.has(r.id)).map(r => r.id);
  check(`every aircraft_type is continuous — none falls to the deleted banded model${offContinuous.length ? ' (offenders: ' + offContinuous.join(', ') + ')' : ''}`,
    acTypes.length > 0 && offContinuous.length === 0);

  // ── Fit-to-fly: severe impairment (any kind) is detected ────────────────────
  check("a sober pilot isn't impaired", isSeverelyImpaired({ intoxication: 10, activeDrugs: [] }) === false);
  check('blackout-drunk is impaired', isSeverelyImpaired({ intoxication: 70 }) === true);
  check('a real active drug dose is impaired', isSeverelyImpaired({ activeDrugs: [{ potency: 0.9 }] }) === true);
  check("a faded comedown tail isn't severe", isSeverelyImpaired({ intoxication: 20, activeDrugs: [{ potency: 0.3 }] }) === false);
  check("a null pilot isn't impaired", isSeverelyImpaired(null) === false);

  // ── Pure helpers ────────────────────────────────────────────────────────────
  check('DIRS has all 8 compass steps', Object.keys(_test.DIRS).length === 8, Object.keys(_test.DIRS).join(','));
  check('surfaceAt off the map is open air (null)', _test.surfaceAt(9999, 9999) === null);
  const clean = { type: { handling: -1 }, row: { damage: 0, custom_data: {} } };
  const hurt = { type: { handling: -1 }, row: { damage: 0.5, custom_data: {} } };
  check('landDifficulty rises with damage', _test.landDifficulty(hurt, false) > _test.landDifficulty(clean, false));
  check('emergency landing is harder', _test.landDifficulty(clean, true) > _test.landDifficulty(clean, false));

  // Ground stop: the field closes above GROUND_STOP_SEVERITY. An airborne craft has
  // no parked zone, so it can never be caught by it — only departures are blocked.
  check('ground-stop threshold sits above the in-air buffeting threshold (0.35)',
    _test.GROUND_STOP_SEVERITY > 0.35 && _test.GROUND_STOP_SEVERITY <= 1, String(_test.GROUND_STOP_SEVERITY));
  check('ground stop never fires on an airborne craft', _test.groundStop({ row: { parked_zone_id: null } }) === null);
  check('ground stop is clear in fair weather', _test.groundStop({ row: { parked_zone_id: 'zone_start' } }) === null);

  // Airfield desks are three independent capabilities: dealer (buy), rental
  // (self-fly), charter (an NPC flies you). Rental used to be implied by charter,
  // which made a charter desk impossible to open without also opening a rental
  // counter — the Reach wants the ride, not the hire desk.
  //
  // Reads the airfields TABLE through the same accessor gameplay uses, joined to
  // the tiles by flags.airfield_id. A tile whose airfield_id has no row answers
  // null everywhere, so this doubles as the check that all five rows loaded.
  {
    const { rows: tiles } = await query(
      `SELECT id, flags->>'airfield_id' AS af FROM zones WHERE flags ? 'airfield_id'`);
    const fields = tiles.map(t => ({ id: t.id, row: airfieldOf(getZone(t.id)) }))
      .filter(f => f.row).map(f => ({ id: f.id, name: f.row.name, rent: f.row.rental, charter: f.row.charter }));
    check('airfields exist to check', fields.length > 0, `${fields.length}`);
    check('every airfield tile resolves to a row', fields.length === tiles.length,
      `${fields.length}/${tiles.length} — an airfield_id with no airfields row reads as "no field here"`);
    const buzzard = fields.find(f => f.id === 'zone_the_reach_870_1958');
    check('Buzzard Field charters', buzzard?.charter === true, JSON.stringify(buzzard));
    check('Buzzard Field has no rental desk', buzzard?.rent !== true, JSON.stringify(buzzard));
    // The capability must be genuinely separable, not just unset everywhere.
    check("some field still rents (the split didn't close every desk)",
      fields.some(f => f.rent === true), fields.filter(f => f.rent === true).map(f => f.name).join(',') || 'NONE');

    // A helipad has no runway: it must never OFFER an airframe it can't launch.
    // acquirableTypes is the SSOT for both the text desk and the hangar-bay lot —
    // they used to run separate queries and the lot's was unfiltered.
    let offender = null, sawVtolOnly = false, sawFull = false;
    for (const f of fields) {
      const zone = getZone(f.id);
      const roster = await acquirableTypes(zone);
      if (vtolOnlyField(zone)) {
        sawVtolOnly = true;
        const fixed = roster.filter(t => t.takeoff_mode !== 'vtol');
        if (fixed.length) { offender = `${f.name}: ${fixed.map(t => t.id).join(',')}`; break; }
      } else if (roster.some(t => t.takeoff_mode !== 'vtol')) sawFull = true;
    }
    check('a VTOL-only field never offers a fixed-wing', offender === null, offender || '');

    // A FIELD ONLY SELLS WHAT IT CAN FUEL. Without this, turning any field's
    // dealer on hands it the entire catalogue — a lawless dust strip offering the
    // same ₵120,000 jet gunship as the international-standard field, which makes
    // the two interchangeable. Selling an airframe you then cannot refuel is a
    // bug in its own right, so the constraint was always implied.
    let unfuelable = null;
    for (const f of fields) {
      const zone = getZone(f.id);
      const stocked = airfieldOf(zone)?.fuels;
      if (!Array.isArray(stocked) || !stocked.length) continue;
      const bad = (await acquirableTypes(zone)).filter(t => !stocked.includes(t.fuel_type));
      if (bad.length) { unfuelable = `${f.name} stocks ${stocked.join('/')} but offers ${bad.map(t => `${t.id}(${t.fuel_type})`).join(',')}`; break; }
    }
    check("no field offers an airframe it can't fuel", unfuelable === null, unfuelable || '');

    // Positive control: the filter must not have emptied everything. Buzzard is
    // the case it was written for — props and helis, no jets.
    const buzzZone = getZone(fields.find(f => /buzzard/i.test(f.name))?.id);
    const buzzRoster = buzzZone ? await acquirableTypes(buzzZone) : [];
    check('Buzzard Field still sells something, and none of it burns jet',
      buzzRoster.length > 0 && buzzRoster.every(t => t.fuel_type !== 'jet'),
      buzzRoster.map(t => `${t.id}(${t.fuel_type})`).join(',') || 'EMPTY');

    // vtolOnlyField is also the ONLY key for the out-the-canopy render: a field it
    // calls VTOL-only draws a circle-H pad instead of a departure strip
    // (state.contextPayload → ground.helipad → windshield.drawGroundHelipad). Any
    // future helipad inherits it by setting vtol_only on its airfields row.
    const pads = fields.filter(f => vtolOnlyField(getZone(f.id))).map(f => f.name);
    check('both helipads read as VTOL-only (→ pad art, not a runway)',
      pads.length >= 2, pads.join(', ') || 'NONE');
    check('the VTOL filter is real (a helipad and a full field both exist)', sawVtolOnly && sawFull,
      `vtolOnly=${sawVtolOnly} full=${sawFull}`);

    // Landing files the craft at a HANGAR, not wherever the rollout stopped — otherwise
    // `embark` from inside the hangar office (the only place you can board) finds nothing
    // on a field whose airfield_id tile isn't the tile carrying the hangar interior.
    let stranded = null;
    for (const f of fields) {
      const zone = getZone(f.id);
      const ramp = hangarRampFor(zone);
      if (!ramp) continue;                            // no hangar in reach — parks where it lands
      if (!getZone(ramp.id)?.flags?.hangar_interior_zone) { stranded = `${f.name} → ${ramp.id}`; break; }
    }
    check('every field that resolves a hangar ramp resolves one with a hangar interior',
      stranded === null, stranded || '');
    check('a field with its own hangar resolves to itself', (() => {
      const own = fields.map(f => getZone(f.id)).find(z => z?.flags?.hangar_interior_zone);
      return !own || hangarRampFor(own)?.id === own.id;
    })());
    check('a non-airfield tile never resolves a hangar ramp', hangarRampFor(getZone('zone_start')) === null);
    check('the hangar reach is a real, bounded search', HANGAR_REACH > 0 && HANGAR_REACH <= 8, `${HANGAR_REACH}`);
  }

  // ── Structural battle-damage surfaces ───────────────────────────────────────
  check('an intact craft reports no surfaces on the wire',
    surfacesWire({ custom_data: {} }) === null && surfacesWire({ custom_data: { surfaces: { leftWing: 1, rightWing: 1 } } }) === null);
  check('a sheared surface shows on the wire', (() => {
    const w = surfacesWire({ custom_data: { surfaces: { leftWing: 0 } } });
    return !!w && w.leftWing === 0 && w.rightWing === 1;
  })());
  check('anyWingLost detects a gone wing, not a gone tail',
    anyWingLost({ custom_data: { surfaces: { rightWing: 0 } } }) === true
    && anyWingLost({ custom_data: { surfaces: { tail: 0 } } }) === false);
  check('shear is gated behind the hull threshold', shearRoll({ damage: 0.3, custom_data: {} }, 1) === null);
  check('a heavy hit deep in the red shears a valid surface', (() => {
    for (let i = 0; i < 300; i++) {
      const a = { damage: 0.95, custom_data: {} };
      const k = shearRoll(a, 0.5);
      if (k) return SURFACE_KEYS.includes(k) && a.custom_data.surfaces[k] === 0;
    }
    return false;
  })());
  check('shear never re-takes an already-lost surface', (() => {
    const a = { damage: 1, custom_data: { surfaces: { leftWing: 0, rightWing: 0, tail: 0, rudder: 0 } } };
    return shearRoll(a, 1) === null;   // nothing intact left to lose
  })());
  check('resetSurfaces clears battle damage', (() => {
    const a = { custom_data: { surfaces: { leftWing: 0 } } }; resetSurfaces(a);
    return !a.custom_data.surfaces && surfacesWire(a) === null;
  })());

  // Engine-noise propagation: bigger/louder craft carry farther; altitude silences.
  const quiet = { type: { noise: 1, engines: 1, max_takeoff_weight: 90 }, row: { throttle: 60, altitude_band: 'low' } };
  const loud = { type: { noise: 3, engines: 4, max_takeoff_weight: 1400 }, row: { throttle: 60, altitude_band: 'low' } };
  const high = { type: { noise: 3, engines: 4, max_takeoff_weight: 1400 }, row: { throttle: 60, altitude_band: 'high' } };
  check('a big loud craft is heard farther than an ultralight', _test.noiseReach(loud) > _test.noiseReach(quiet), `${_test.noiseReach(loud)} vs ${_test.noiseReach(quiet)}`);
  check('high flight is inaudible from the ground', _test.noiseReach(high) === 0, String(_test.noiseReach(high)));

  // ── Tuning model (pure; SSOT for flight + bench graphs) ─────────────────────
  const TT = { max_takeoff_weight: 300, fuel_burn_base: 2, cruise_speed: 4, handling: 0, altitude_ceiling: 2, fuel_capacity: 40 };
  const stock = computeStats(TT, {}), lean = computeStats(TT, { mixture: 1 }), boosted = computeStats(TT, { boost: 1 });
  check('lean mixture saves fuel', lean.burn < stock.burn, `${lean.burn} vs ${stock.burn}`);
  check('lean mixture runs hotter', lean.heatBias > stock.heatBias);
  check('boost buys cruise speed (was a no-op before)', boosted.cruise > stock.cruise, `${boosted.cruise} vs ${stock.cruise}`);
  check('boost costs heat', boosted.heatBias > stock.heatBias);
  check('intercooler kit cuts the heat penalty', computeStats(TT, { boost: 1 }, 0, ['kit_intercooler']).heatBias < boosted.heatBias);
  check('installedKits filters unknown ids', installedKits({ kits: ['kit_precision', 'lolnope'] }).length === 1);
  check('tuneRange widens with Fabrication', tuneRange(20, []) > tuneRange(0, []));
  check('a range-widening kit widens the dials', tuneRange(0, ['kit_precision']) > tuneRange(0, []));
  check('tuneRange never exceeds the hard dial cap', tuneRange(999, ['kit_precision', 'kit_intercooler']) <= TUNE_DIAL_MAX);
  const axStock = perfAxes(TT, {}), axBoost = perfAxes(TT, { boost: 1 }), axLean = perfAxes(TT, { mixture: 1 });
  check('perfAxes reads 50 (=stock) on every axis at zero tune', Object.values(axStock).every(v => v === 50), JSON.stringify(axStock));
  check('boost lifts the SPEED axis above stock', axBoost.speed > 50);
  check('lean lifts ECON but drops COOL', axLean.economy > 50 && axLean.cool < 50, JSON.stringify(axLean));
  check('every kit in the catalogue has a name + price', Object.values(KITS).every(k => k.name && k.price > 0));

  // ── Parts & slots (pure) ────────────────────────────────────────────────────
  // The catalogue itself: every part must name a real slot, a price and an item id,
  // because the item id is the ONLY link between the mechanic and the content row a
  // player can carry — a typo there is a part that can be bought and never fitted.
  check('every part names a real slot, a price and an item', Object.entries(PARTS).every(([k, p]) =>
    PART_SLOTS.some(s2 => s2.id === p.slot) && p.price > 0 && p.item && p.name && p.blurb), Object.keys(PARTS).join(','));
  check('every part id equals its item id', Object.entries(PARTS).every(([k, p]) => k === p.item));
  check('installedParts rejects a part in the wrong slot', Object.keys(installedParts({ parts: { engine: 'part_tank_aux', fuel: 'part_tank_aux' } })).join() === 'fuel');
  check('installedParts survives junk', Object.keys(installedParts({ parts: { engine: 'nope' } })).length === 0 && Object.keys(installedParts({})).length === 0);

  // Slots are DERIVED from the type row — a pylon needs an airframe to hang off, so
  // an ultralight can never become a gunship by shopping.
  const light = { max_takeoff_weight: 200, hardpoints: 0 };
  const heavy = { max_takeoff_weight: PYLON_MIN_TOW, hardpoints: 0 };
  const armed = { max_takeoff_weight: 200, hardpoints: 2 };
  check('an ultralight has no pylon slot', !slotsFor(light).some(s2 => s2.id === 'pylon'));
  check('a big airframe can take pylons', slotsFor(heavy).some(s2 => s2.id === 'pylon'));
  check('a factory-armed airframe always has the slot', slotsFor(armed).some(s2 => s2.id === 'pylon'));
  check('the four universal slots are on everything', ['engine', 'avionics', 'fuel', 'frame'].every(id => slotsFor(light).some(s2 => s2.id === id)));

  // The envelope: parts move the numbers the flight model already reads.
  const dEngine = partDefs({ parts: { engine: 'part_engine_hotsection' } });
  const dTank = partDefs({ parts: { fuel: 'part_tank_ferry' } });
  const dPlate = partDefs({ parts: { frame: 'part_frame_plate' } });
  const dPylon = partDefs({ parts: { pylon: 'part_pylon_light' } });
  check('a hot section buys cruise and costs heat', computeStats(TT, {}, 0, [], dEngine).cruise > stock.cruise
    && computeStats(TT, { boost: 1 }, 0, [], dEngine).heatBias > boosted.heatBias);
  check('a ferry tank is a bigger tank', computeStats(TT, {}, 0, [], dTank).fuelCap > stock.fuelCap);
  check('fitted hardware eats payload', computeStats(TT, {}, 0, [], dTank).burn > stock.burn);
  check('armour plate soaks, and soak can never reach 1', computeStats(TT, {}, 0, [], dPlate).soak > 0
    && partEnvelope([...dPlate, ...dPlate, ...dPlate, ...dPlate]).soak < 1);
  check('a pylon set arms an unarmed airframe', computeStats(TT, {}, 0, [], dPylon).hardpoints === 1
    && computeStats(TT, {}, 0, []).hardpoints === 0);
  check('the airframe keeps its own hardpoints when they beat the part',
    computeStats({ ...TT, hardpoints: 4 }, {}, 0, [], dPylon).hardpoints === 4);
  check('no parts is exactly stock (the migration invariant)',
    JSON.stringify(computeStats(TT, {}, 0, [], [])) === JSON.stringify(computeStats(TT, {}, 0, [])));

  // Per-knob dial travel: a part widens the knob it is ABOUT and nothing else.
  check('a hot section widens boost travel only', tuneRange(0, [], dEngine, 'boost') > tuneRange(0, [], dEngine, 'cg')
    && tuneRange(0, [], dEngine, 'cg') === tuneRange(0, [], [], 'cg'));
  check('a glass panel widens every dial', tuneRange(0, [], partDefs({ parts: { avionics: 'part_avionics_glass' } })) > tuneRange(0, []));
  check('parts can never push a dial past the hard cap',
    tuneRange(999, ['kit_precision'], Object.values(PARTS), 'boost') <= TUNE_DIAL_MAX);
  // The graph measures the TUNE against a same-parts stock ghost, so fitting hardware
  // must not move the axes that are pure ratios — but AGILITY is absolute (it reads the
  // knobs and the load directly), and 16kg of armour plate is load. It is supposed to
  // drop. That asymmetry is the same one cargo already has.
  const axPlate = perfAxes(TT, {}, 0, [], dPlate);
  check('fitting parts leaves the ratio axes at stock', ['speed', 'economy', 'range', 'cool'].every(k => axPlate[k] === 50), JSON.stringify(axPlate));
  check('bolted-on mass shows up as lost agility', axPlate.agility < 50, String(axPlate.agility));

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
  check("rentals and wrecks aren't paintable; a plain owned craft is", !isPaintable({ rental: 1 }) && !isPaintable({ is_wreck: 1 }) && isPaintable({}));
  // The warbird scheme. Two assertions, because it is the one pattern whose renderer derives
  // extra tones from `base` — and the thing that would break silently is the ID going out of the
  // catalog (leaving every aeroplane wearing it to normalise back to bare on the next save).
  check('warbird is a real pattern, so a painted craft keeps it', normalizeLivery({ livery: { pattern: 'warbird' } }).pattern === 'warbird');
  check("…and it's described rather than falling through to the bare clause",
    /cowl/i.test(describeExterior({ base: '#4c5340', trim: '#e2b21c', pattern: 'warbird', finish: 'matte' }, 'Shrike')));
  // Slice 2 — decals + saved schemes.
  check('a decal is described in the exterior prose', /shark/i.test(describeExterior({ base: '#334455', trim: '#889', pattern: 'solid', finish: 'satin', decal: 'sharkmouth' }, 'Reaper')));
  check('a bad decal falls back to none', normalizeLivery({ livery: { decal: 'lolnope' } }).decal === 'none');
  check('decal is cosmetic — no effect on signature', signatureMult({ base: '#808080', pattern: 'solid', finish: 'satin', decal: 'none' }) === signatureMult({ base: '#808080', pattern: 'solid', finish: 'satin', decal: 'sharkmouth' }));
  check('schemeOf captures the core paint fields', (() => { const s = schemeOf({ base: '#010203', trim: '#040506', pattern: 'hazard', finish: 'gloss', decal: 'sigil', cabin: '#070809', uphol: 'leather' }); return s.base === '#010203' && s.pattern === 'hazard' && s.decal === 'sigil' && !('schemes' in s) && !('text' in s); })());
  check('readSchemes returns saved schemes as a map', Object.keys(readSchemes({ livery: { schemes: { fast: { base: '#111111' } } } })).includes('fast') && Object.keys(readSchemes({})).length === 0);
  check('the Shrike decal is a real decal and describes itself', /thorn/i.test(describeExterior({ base: '#3d5245', trim: '#222', pattern: 'solid', finish: 'satin', decal: 'shrike' }, 'Shrike')));
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

  // Ownership of where a pilot stands. Off-duty and unbooked belongs to their own
  // behaviour graph — if this ever returns true there, charter.js and the graph
  // both place them every tick and the room hears one side of the argument
  // ("Old Kessler leaves." on a loop) because only the graph's step broadcasts.
  check('on shift → charter owns the pilot', charterOwnsPilot({ onShift: true }) === true);
  check('mid-booking off shift → charter still owns them', charterOwnsPilot({ busy: true, onShift: false }) === true);
  check('off shift and unbooked → the graph owns them, so they walk home',
    charterOwnsPilot({ busy: false, onShift: false }) === false);

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

  // ── Continuous-flight seam (whole fleet, incl. the Dragonfly hover model) ────
  check('fixed-wing fleet flies the continuous sim', _test.isContinuous({ type: { id: 'ac_mayfly' } }) === true && _test.isContinuous({ type: { id: 'ac_reaper' } }) === true);
  check('the Dragonfly (VTOL heli) flies the continuous sim too', _test.isContinuous({ type: { id: 'ac_dragonfly' } }) === true);
  // Swarm airframe: salvo count comes off the type's data (the Viper ripples 4; every other frame is 1).
  check('salvoOf reads the airframe salvo (Viper 4; a lock-only frame 1)',
    salvoOf({ type: { data: { salvo: 4 } } }) === 4 && salvoOf({ type: {} }) === 1 && salvoOf({ type: { data: {} } }) === 1);
  check('bandFromAltitude: on the deck → ground', _test.bandFromAltitude(0, true) === 'ground');
  check('bandFromAltitude: 300ft → low', _test.bandFromAltitude(300) === 'low');
  check('bandFromAltitude: 800ft → cruise', _test.bandFromAltitude(800) === 'cruise');
  check('bandFromAltitude: 2000ft → high', _test.bandFromAltitude(2000) === 'high');
  // ── The Shrike: the dive bomber ─────────────────────────────────────────────
  check('the Shrike flies the continuous sim', _test.isContinuous({ type: { id: 'ac_shrike' } }) === true);
  // ⚠ The trap this exists for: the flight model is keyed by craftType, and a missing row
  // silently falls back to the Mayfly's — a ₵48,000 dive bomber that flies like the trainer
  // and can never reach the speed its own bomb gate demands. It must be its own aeroplane.
  check('the Shrike has her own flight-model row', !!FM_TYPES.shrike && FM_TYPES.shrike !== FM_TYPES.mayfly);
  check('…and can actually reach the dive gate (Vne well past the 140kt release floor)', FM_TYPES.shrike.vne > 200, FM_TYPES.shrike.vne);
  check('…and stalls through the shared harness like any other airframe', !!fmStall1g(FM_TYPES.shrike));
  // Bombs are their own stores question: an airframe with no authored rack can never carry one,
  // whatever its hardpoint count says.
  check('bombLoad reads the authored rack', bombLoad({ type: { data: { bombs: 4 } } }) === 4);
  check('…and a frame with no rack carries none, hardpoints or not', bombLoad({ type: { hardpoints: 8, data: {} } }) === 0 && bombLoad({ type: {} }) === 0);
  check('bombAmmo falls back to the full rack, then tracks the sortie', bombAmmo({ type: { data: { bombs: 4 } } }) === 4 && bombAmmo({ bombs: 1, type: { data: { bombs: 4 } } }) === 1);
  check('…and floors at zero rather than going negative', bombAmmo({ bombs: -3, type: { data: { bombs: 4 } } }) === 0);
  // Dive quality. TWO SEPARATE gate cases on purpose: a single combined "bad dive" case can
  // pass for the wrong reason, and the two halves of the gate fail differently.
  check('dive quality is zero in level flight, however fast', diveQuality(0, 400) === 0);
  check('⚠ steep but SLOW scores zero', diveQuality(-70, 0) === 0);
  check('⚠ fast but SHALLOW scores zero', diveQuality(-10, 400) === 0);
  check('a full commit — 80° at the release speed — scores 1', diveQuality(-80, 140) === 1);
  check('dive quality rises monotonically with angle', diveQuality(-45, 200) < diveQuality(-60, 200) && diveQuality(-60, 200) < diveQuality(-75, 200));
  check('…and is never outside 0..1', diveQuality(-179, 9999) <= 1 && diveQuality(90, 0) >= 0);
  r = await run('bomb'); check('bomb off an aircraft refuses and mutates nothing', /not aboard/i.test(r?.message || ''), r?.message);
  // ⚠ SHE IS DRAWN ON A TAILWHEEL AND MUST BE FLOWN OFF ONE. The mesh has carried
  // `gearStyle: 'taildragger'` and its own groundPitch since she was built; the flight-model row
  // did not, so she sat nose-high in the picture and flew off flat, and the tail never came up on
  // the roll. The two numbers are one fact in two files — this is the assertion that keeps them
  // the same fact. (aircraft3d.js: FW_PARAMS.divebomber.groundPitch)
  check('the Shrike is a taildragger in the sim, not just in the mesh', FM_TYPES.shrike.groundPitch === 9, FM_TYPES.shrike.groundPitch);

  // ── Tile waypoint (the tablet map's "Target here") ───────────────────────────
  // The shape must be STABLE: the cockpit reads `waypoint` on every context push, so an
  // unset one has to be an explicit null rather than a missing key.
  check('no waypoint set → null, not undefined', waypointFor({ row: { grid_x: 0, grid_y: 0 }, occupants: [], pilotId: null }) === null);
  // Pick a tile that is genuinely inside the world — the command clamps to bounds(), and
  // Coldwater does not live near the origin, so an arbitrary small coordinate would be
  // clamped and the test would be asserting the clamp rather than the storage.
  const wb = flightBounds();
  const wpx = Math.round((wb.minx + wb.maxx) / 2), wpy = Math.round((wb.miny + wb.maxy) / 2);
  r = await run(`flightwaypoint ${wpx} ${wpy}`);
  check('a waypoint can be set with no aircraft at all', /designated/i.test(r?.message || ''), r?.message);
  check("…and says it'll be waiting", /waiting when you board/i.test(r?.message || ''), r?.message);
  check('…and is held on the PLAYER, not on an airframe', getPlayer().flightWaypoint?.x === wpx && getPlayer().flightWaypoint?.y === wpy, JSON.stringify(getPlayer().flightWaypoint));
  r = await run('flightwaypoint clear');
  check('…and clears', /cleared/i.test(r?.message || '') && !getPlayer().flightWaypoint, r?.message);
  r = await run('flightwaypoint banana 3');
  check('a non-numeric tile is refused rather than clamped to 0,0', r?.type === 'error' && !getPlayer().flightWaypoint, r?.message);
  r = await run('flightwaypoint -99999 -99999');
  check('an out-of-world tile is clamped into the map, never stored raw', getPlayer().flightWaypoint && getPlayer().flightWaypoint.x > -99999, JSON.stringify(getPlayer().flightWaypoint));
  await run('flightwaypoint clear');

  r = await run('flightsync 0 0 0 0 0 0 0 1 0'); check('flightsync not aboard no-ops', r?.type === 'noop', r?.type);
  r = await run('flightevent takeoff'); check('flightevent not aboard no-ops', r?.type === 'noop', r?.type);

  // ── Hazard / utility verbs gate when not aboard ─────────────────────────────
  r = await run('extinguish'); check('extinguish not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('hover'); check('hover not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('chart'); check('chart not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);

  // ── Combat verbs gate; strafresolve is a silent no-op unarmed ───────────────
  r = await run('arm'); check('arm not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('strafe'); check('strafe not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('strafresolve tok 1'); check('strafresolve unarmed no-ops', r?.type === 'noop', r?.type);
  r = await run('airfire guns x 1'); check('airfire (A2A guns) not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('airfire missile x'); check('airfire (A2A missile) not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('airfire swarm x'); check('airfire (A2A swarm) not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('airfire swarm ground'); check('airfire (air-to-ground swarm) not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('airlock x'); check('airlock not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('airunlock'); check('airunlock not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('flares'); check('flares not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('jettison'); check('jettison not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('spray'); check('spray not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  r = await run('loadhopper'); check('loadhopper not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);
  // The hangar bench's Hopper tab pours a PARKED craft by id, so a craft-id first argument must
  // NOT fall into the aboard path — off a field it has to fail on the field, not on the seat.
  r = await run('loadhopper aircraft_nope with can');
  check('loadhopper <craftId> takes the parked route (not the aboard one)', !/not aboard/i.test(r?.message || '') && /airfield/i.test(r?.message || ''), r?.message);
  r = await run('hopperbay'); check('hopperbay not aboard blocked', /not aboard/i.test(r?.message || ''), r?.message);

  // ── Acquisition / contracts / hangars gate off an airfield ──────────────────
  r = await run('charter'); check('charter off-field reports no desk', /no .*(charter|dealer)/i.test(r?.message || ''), r?.message);
  r = await run('contracts'); check('contracts off-field reports the board is elsewhere', /board/i.test(r?.message || ''), r?.message);
  r = await run('hangar'); check('hangar off-field reports airfields', /airfield/i.test(r?.message || ''), r?.message);
  r = await run('showroom'); check('showroom off-field points to the airfields', /airfield|showroom/i.test(r?.message || ''), r?.message);
  r = await run('view mayfly'); check("view off-field falls through (doesn't hijack the generic verb)", r?.type === 'error' && /unknown command/i.test(r?.message || ''), `${r?.type}:${r?.message}`);
  r = await run('loadout'); check('loadout with no craft here reports it', /no aircraft of yours/i.test(r?.message || ''), r?.message);
  r = await run('salvage'); check('salvage with no wreck reports it', /no wreck/i.test(r?.message || ''), r?.message);
  r = await run('modify'); check('modify requires an owned aircraft', /own|no aircraft of your own/i.test(r?.message || ''), r?.message);
  r = await run('tuneset 0 0 0 0'); check('tuneset requires an owned aircraft', /own|no aircraft of your own/i.test(r?.message || ''), r?.message);
  r = await run('installkit x kit_precision'); check('installkit requires an owned aircraft', /own|no aircraft of your own/i.test(r?.message || ''), r?.message);
  // The parts bench rides the same gate — and every sub-verb has to, or "fit" becomes
  // a way to bolt hardware onto somebody else's aeroplane from the middle of a field.
  for (const sub of ['parts', 'fit part_tank_aux', 'pull fuel', 'buy part_tank_aux']) {
    r = await run(`modify ${sub}`);
    check(`modify ${sub.split(' ')[0]} requires an owned aircraft`, /own|no aircraft of your own/i.test(r?.message || ''), r?.message);
  }
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
    check("sellAircraft refuses an aircraft you don't own", sr?.type === 'error', JSON.stringify(sr));
    await query('UPDATE aircraft SET owner_id=$1, airborne=1 WHERE id=$2', [p.id, strangerId]);
    sr = await sellAircraft(p, strangerId);
    check('sellAircraft refuses an airborne aircraft', sr?.type === 'error' && /air/i.test(sr.message || ''), JSON.stringify(sr));
    await query('DELETE FROM aircraft WHERE id=$1', [strangerId]);

    // flushAirborne grounds a DB-only ghost stuck airborne (no live instance) so it
    // becomes sellable again; leaves genuinely-parked craft untouched.
    const ghostId = 'aircraft_regress_ghost';
    const parkedId = 'aircraft_regress_parked';
    await query('DELETE FROM aircraft WHERE id = ANY($1)', [[ghostId, parkedId]]);
    await query(
      `INSERT INTO aircraft (id,type_id,name,owner_id,rental,is_wreck,airborne,altitude_band) VALUES
        ($1,$3,'REGR-04',$4,0,0,1,'cruise'), ($2,$3,'REGR-05',$4,0,0,0,'ground')`,
      [ghostId, parkedId, acType.id, p.id]
    );
    const flushed = await flushAirborne(p);
    check('flushAirborne grounds the stranded aircraft (count)', flushed === 1, `flushed=${flushed}`);
    const { rows: after } = await query('SELECT id, airborne FROM aircraft WHERE id = ANY($1) ORDER BY id', [[ghostId, parkedId]]);
    check('flushAirborne clears the ghost airborne flag', after.find(a => a.id === ghostId)?.airborne === 0, JSON.stringify(after));
    check('flushAirborne leaves a parked craft alone', after.find(a => a.id === parkedId)?.airborne === 0, JSON.stringify(after));
    await query('DELETE FROM aircraft WHERE id = ANY($1)', [[ghostId, parkedId]]);
  }

  // ── Licensed freight drops (air-freight licence gate + pool top-up) ─────────
  r = await run('freightlicense'); check('freightlicense off-field points to the airfields', /airfield/i.test(r?.message || ''), r?.message);

  const FREIGHT_FIELD = 'zone_regress_freight_field';
  await query("DELETE FROM cargo_drops WHERE owner_id=$1 AND kind='freight'", [p.id]);
  await setFlag('player', 'air_freight_licensed', '0', p);
  check('isFreightLicensed false before licensing', (await isFreightLicensed(p)) === false);
  await ensureFreightDrops(p, FREIGHT_FIELD);
  let { rows: fd } = await query("SELECT COUNT(*)::int n FROM cargo_drops WHERE owner_id=$1 AND kind='freight' AND origin_zone=$2", [p.id, FREIGHT_FIELD]);
  check('ensureFreightDrops is a no-op for the unlicensed', fd[0]?.n === 0, JSON.stringify(fd[0]));

  await setFlag('player', 'air_freight_licensed', '1', p);
  check('isFreightLicensed true once the flag is set', (await isFreightLicensed(p)) === true);
  await ensureFreightDrops(p, FREIGHT_FIELD);
  ({ rows: fd } = await query("SELECT COUNT(*)::int n FROM cargo_drops WHERE owner_id=$1 AND kind='freight' AND origin_zone=$2 AND status='waiting'", [p.id, FREIGHT_FIELD]));
  check('ensureFreightDrops tops the licensed pilot pool up', fd[0]?.n === 4, JSON.stringify(fd[0]));
  await ensureFreightDrops(p, FREIGHT_FIELD); // idempotent — already at the cap
  ({ rows: fd } = await query("SELECT COUNT(*)::int n FROM cargo_drops WHERE owner_id=$1 AND kind='freight' AND origin_zone=$2 AND status='waiting'", [p.id, FREIGHT_FIELD]));
  check('ensureFreightDrops holds the pool at the cap (no runaway)', fd[0]?.n === 4, JSON.stringify(fd[0]));
  await query("DELETE FROM cargo_drops WHERE owner_id=$1 AND kind='freight'", [p.id]);
  await setFlag('player', 'air_freight_licensed', '0', p);

  // ── Fence dead drops (raw-drug caches out on the Reach hardpan) ─────────────
  // The pallets are heavy and the caches are off-strip, so the aircraft gate is
  // pure physics — what's tested here is the STANDING gate (both ends of the
  // ground trade must vouch), the rotation (never all caches at once), and that
  // every cache id names a tile a player could actually put down on. A cache
  // pointing at a nonexistent or built-over tile would spawn unreachable pallets.
  for (const c of FENCE_CACHES) {
    const z = getZone(c.zone);
    check(`fence cache ${c.name} names a real world tile`, !!z, c.zone);
    if (!z) continue;
    check(`fence cache ${c.name} is landable ground (not a building/water)`,
      !z.flags?.is_building && !z.flags?.water && z.flags?.terrain !== 'water',
      JSON.stringify({ b: z.flags?.is_building, t: z.flags?.terrain }));
  }

  await query("DELETE FROM cargo_drops WHERE owner_id=$1 AND kind='fence'", [p.id]);
  await clearFlag('player', 'air_cargo_unlocked', p);
  await clearFlag('player', 'dealer_inner_circle', p);
  await setFlag('player', 'bm_trust', '0', p);
  check('hasCacheStanding false with no vouch and no standing', (await hasCacheStanding(p)) === false);
  await setFlag('player', 'bm_trust', '25', p);
  check('hasCacheStanding false on standing alone (needs the dealer vouch)', (await hasCacheStanding(p)) === false);
  await setFlag('player', 'dealer_inner_circle', '1', p);
  await setFlag('player', 'bm_trust', '4', p);
  check('hasCacheStanding false on the vouch alone (needs the standing)', (await hasCacheStanding(p)) === false);
  await setFlag('player', 'bm_trust', '10', p);
  check('hasCacheStanding true once both ends vouch', (await hasCacheStanding(p)) === true);

  // The action re-checks standing itself, so a stale dialogue option can't hand out
  // the caches — and it must not have unlocked anything on the way to refusing.
  await setFlag('player', 'bm_trust', '4', p);
  let ua = await dispatchAction({ type: 'UNLOCK_AIR_CARGO', actor: p });
  check('UNLOCK_AIR_CARGO refuses the unvouched to raws_unvouched', ua?.node === 'raws_unvouched', JSON.stringify(ua));
  check('UNLOCK_AIR_CARGO leaves the run locked when it refuses', (await isAirCargoUnlocked(p)) === false);
  let { rows: cd } = await query("SELECT COUNT(*)::int n FROM cargo_drops WHERE owner_id=$1 AND kind='fence'", [p.id]);
  check('a refused unlock spawns no pallets', cd[0]?.n === 0, JSON.stringify(cd[0]));

  await setFlag('player', 'bm_trust', '10', p);
  ua = await dispatchAction({ type: 'UNLOCK_AIR_CARGO', actor: p });
  check('UNLOCK_AIR_CARGO opens the run for the vouched', (await isAirCargoUnlocked(p)) === true, JSON.stringify(ua));
  ({ rows: cd } = await query("SELECT COUNT(*)::int n FROM cargo_drops WHERE owner_id=$1 AND kind='fence'", [p.id]));
  check('nothing spawns unbidden — the unlock alone puts no pallets in the caches', cd[0]?.n === 0, JSON.stringify(cd[0]));

  // ── The raws catalogue: the ladder, and the legal rung at the bottom ────────
  const cat = await rawsCatalogue();
  check('the raws catalogue is populated', cat.length > 0, `n=${cat.length}`);
  // A MULE crate is tagged raw_drug at cook_tier 5 but is a SHELL, not a precursor:
  // ordered or rolled into a pallet it arrives with no custom_data, an unopenable dud
  // `unpack` calls a bad drop, whose tier 5 inflated the customs difficulty for nothing.
  check('the catalogue excludes the MULE crate shell (an unopenable dud)',
    !cat.some(e => e.id === 'item_mule_crate'), JSON.stringify(cat.filter(e => e.id === 'item_mule_crate')));
  const crops = cat.filter(e => e.legal);
  check("the bottom rung is legal crop, and there's some", crops.length >= 2, JSON.stringify(crops.map(e => e.id)));
  check('every legal crop is tier 0', crops.every(e => e.tier === 0), JSON.stringify(crops.map(e => [e.id, e.tier])));
  // The whole point of the legal rung: a bale is NOT a manufacturing felony, so the
  // crop items must never carry the tags that make one.
  const { rows: cropTags } = await query(
    `SELECT id, jsonb_exists(tags,'raw_drug') rawdrug, jsonb_exists(tags,'contraband') contra
       FROM items WHERE id = ANY($1)`, [crops.map(e => e.id)]);
  check('legal crop carries neither raw_drug nor contraband (no 4-star manufacturing)',
    cropTags.length > 0 && cropTags.every(r => !r.rawdrug && !r.contra), JSON.stringify(cropTags));
  check('every contraband entry is tier 1+ (the felony rungs sit above the legal one)',
    cat.filter(e => !e.legal).every(e => e.tier >= 1), JSON.stringify(cat.filter(e => !e.legal && e.tier < 1)));
  // The ladder has to actually be a ladder, and the legal rung has to be reachable the
  // moment you're vouched — otherwise a newly-vouched pilot can order nothing at all.
  check('tier 0 is orderable at the moment the caches unlock', trustFor(0) === 10, `${trustFor(0)}`);
  const ladder = [0, 1, 2, 3, 4, 5].map(trustFor);
  check('the trust ladder is strictly increasing', ladder.every((v, i) => i === 0 || v > ladder[i - 1]), JSON.stringify(ladder));
  const units = [0, 1, 2, 3, 4, 5].map(unitsPerPallet);
  check('a pallet holds fewer units as the grade climbs', units.every((v, i) => i === 0 || v < units[i - 1]), JSON.stringify(units));

  // ── Placing an order ───────────────────────────────────────────────────────
  const crop = crops[0];
  // A pallet costs roughly a pallet's worth of money at every grade — the units-per-
  // pallet table trades volume for value as the tier climbs, deliberately. So what
  // standing buys is ACCESS to grade, not a bigger load, and the payoff is on the far
  // side (what the raw cooks into). Guard the shape of the pricing rather than a
  // monotonic curve the item values don't actually have: every entry is priced, and
  // ordering more pallets costs proportionally more.
  check('every catalogue entry has a real price', cat.every(e => palletPrice(e) > 0),
    JSON.stringify(cat.filter(e => !(palletPrice(e) > 0)).map(e => e.id)));
  check('pallet price scales with the item value at a fixed grade', (() => {
    const t1 = cat.filter(e => e.tier === 1).sort((a, b) => a.value - b.value);
    return t1.length < 2 || palletPrice(t1[t1.length - 1]) > palletPrice(t1[0]);
  })(), 'a dearer raw of the same grade must cost more');

  // Fund the fake player enough to cover two pallets — TOP UP to the figure rather than
  // adding to it, because earlier suites can leave these credits deep in the red.
  // adjustCredits needs a real `players` row to charge (it debits via a guarded UPDATE
  // and reports failure when nothing was updated), and the suite's fake player has
  // none. Insert one for the duration, then take it back out.
  const need = palletPrice(crop) * 2 + 500;
  const { rows: had } = await query('SELECT id FROM players WHERE id=$1', [p.id]);
  await query(
    `INSERT INTO players (id, username, password_hash, handle, credits) VALUES ($1,$1,'x',$1,$2)
     ON CONFLICT (id) DO UPDATE SET credits=$2`, [p.id, need]);
  p.credits = need;
  const beforeCredits = p.credits || 0;
  const ord = await placeCacheOrder(p, crop, 2);
  check('placeCacheOrder reports the cache it was run out to', !!ord.cache?.zone, JSON.stringify(ord));
  check('placeCacheOrder charges up front', (p.credits || 0) === beforeCredits - ord.cost, `${beforeCredits} → ${p.credits} (cost ${ord.cost})`);
  const { rows: ordered } = await query(
    "SELECT origin_zone, weight_kg, contents FROM cargo_drops WHERE owner_id=$1 AND kind='fence' AND status='waiting'", [p.id]);
  check('an order inserts one row per pallet', ordered.length === 2, `n=${ordered.length}`);
  check('every pallet of one order goes to the SAME cache (one place to fly)',
    new Set(ordered.map(d => d.origin_zone)).size === 1, JSON.stringify(ordered.map(d => d.origin_zone)));
  check('pallets only ever land in a declared cache',
    ordered.every(d => FENCE_CACHES.some(c => c.zone === d.origin_zone)), JSON.stringify(ordered.map(d => d.origin_zone)));
  check('a pallet is a heavy load, not a hand-carry', ordered.every(d => d.weight_kg >= 150),
    JSON.stringify(ordered.map(d => d.weight_kg)));
  check('an ordered pallet holds exactly what was asked for, in bulk',
    ordered.every(d => (d.contents || []).length === 1
      && d.contents[0].itemId === crop.id && d.contents[0].qty === unitsPerPallet(crop.tier)),
    JSON.stringify(ordered.map(d => d.contents)));
  check('a legal-crop manifest is marked legal (this is what exempts it from customs)',
    ordered.every(d => d.contents[0].legal === true), JSON.stringify(ordered.map(d => d.contents[0].legal)));

  // The lead time is derived from created_at — no tick, no column. A pallet you just
  // ordered is real but not yet out there, so loadcargo must not see it.
  let ords = await openOrders(p);
  check('openOrders groups the order into one cache line', ords.length === 1, JSON.stringify(ords));
  check('a fresh order reports pallets and units', ords[0]?.pallets === 2 && ords[0]?.units === unitsPerPallet(crop.tier) * 2, JSON.stringify(ords[0]));
  check("a fresh order isn't out there yet (lead time)", ords[0]?.readyIn > 0, `readyIn=${ords[0]?.readyIn}`);
  check('a pallet still in transit is NOT loadable at the cache',
    (await waitingDropAt(ords[0].cache.zone, p.id)) === null, 'waitingDropAt saw an in-transit pallet');
  await query("UPDATE cargo_drops SET created_at=$2 WHERE owner_id=$1 AND kind='fence'", [p.id, nowSec() - 3600]);
  ords = await openOrders(p);
  check('once the lead time is up the order reads as delivered to the cache', ords[0]?.readyIn === 0, `readyIn=${ords[0]?.readyIn}`);
  check('a landed pallet IS loadable at its cache', !!(await waitingDropAt(ords[0].cache.zone, p.id)));

  // ── The counter as a vendor shelf (the purchase-delivery seam) ─────────────
  // The GUI shop panel sells pallets, and a 150kg pallet must NOT land in anyone's
  // pockets: the engine's purchase-delivery seam hands the sale to flight, which
  // writes cargo_drops instead. Guard both halves — the goods go to a cache, and
  // nothing appears in inventory.
  {
    const counter = {
      id: 'npc_regress_raws_counter', name: 'a regress quartermaster',
      flags: { raws_counter: true, trust_flag: 'bm_trust', trust_per_buy: 0, trust_max: 100 },
      vendor_inventory: [{ item_id: crop.id, price: palletPrice(crop), min_trust: 0 }],
      vendor_stock: [], vendor_credits: 0,
    };
    await query(
      `INSERT INTO npcs (id, name, description, vendor_inventory, vendor_stock, vendor_credits, flags)
       VALUES ($1,$2,'a regress quartermaster',$3::jsonb,'[]'::jsonb,0,$4::jsonb)
       ON CONFLICT (id) DO UPDATE SET vendor_inventory=EXCLUDED.vendor_inventory, flags=EXCLUDED.flags`,
      [counter.id, counter.name, JSON.stringify(counter.vendor_inventory), JSON.stringify(counter.flags)]);
    await query("DELETE FROM cargo_drops WHERE owner_id=$1 AND kind='fence'", [p.id]);
    await query('UPDATE players SET credits=$2 WHERE id=$1', [p.id, palletPrice(crop) * 4]);
    p.credits = palletPrice(crop) * 4;

    const buy = await buyFromVendor(p, counter, crop.id, 2);
    check('buying a pallet at the counter succeeds', buy.success === true, JSON.stringify(buy.message));
    check('the receipt names the cache it was run out to', /Bonepile|Sump|Sisters/.test(buy.message || ''), buy.message);
    const { rows: bought } = await query(
      "SELECT origin_zone FROM cargo_drops WHERE owner_id=$1 AND kind='fence' AND status='waiting'", [p.id]);
    check('a shop purchase writes pallets to a cache', bought.length === 2, `n=${bought.length}`);
    const { rows: inInv } = await query(
      'SELECT COUNT(*)::int n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [p.id, crop.id]);
    check("a shop purchase puts NOTHING in inventory (a pallet isn't a hand-carry)", inInv[0]?.n === 0, JSON.stringify(inInv[0]));

    // The seam is keyed on the VENDOR, not the goods, so two fences selling the same
    // raws can't collide. A shop with no counter flag therefore has no delivery
    // handler and sells a bale the ordinary way — which is right: legal produce is
    // legal produce, and only a raws counter runs it out to a cache.
    const notCounter = { ...counter, id: 'npc_regress_not_counter', flags: { trust_flag: 'bm_trust', trust_per_buy: 0 } };
    await query(
      `INSERT INTO npcs (id, name, description, vendor_inventory, vendor_stock, vendor_credits, flags)
       VALUES ($1,$2,'a regress shopkeep',$3::jsonb,'[]'::jsonb,0,$4::jsonb)
       ON CONFLICT (id) DO UPDATE SET vendor_inventory=EXCLUDED.vendor_inventory, flags=EXCLUDED.flags`,
      [notCounter.id, notCounter.name, JSON.stringify(notCounter.vendor_inventory), JSON.stringify(notCounter.flags)]);
    const plainBuy = await buyFromVendor(p, notCounter, crop.id, 1);
    check('a vendor with no counter flag sells a bale the ordinary way', plainBuy.success === true, JSON.stringify(plainBuy.message));
    const { rows: handed } = await query(
      'SELECT COUNT(*)::int n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [p.id, crop.id]);
    check('…and hands it across the counter into inventory', handed[0]?.n === 1, JSON.stringify(handed[0]));
    const { rows: noNew } = await query(
      "SELECT COUNT(*)::int n FROM cargo_drops WHERE owner_id=$1 AND kind='fence'", [p.id]);
    check('…and books no cache pallet', noNew[0]?.n === 2, JSON.stringify(noNew[0]));
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [p.id, crop.id]);

    // A counter refusal (over the pallet cap) must roll the whole sale back — never
    // take the money and deliver nowhere. This is the path `withTransaction` used to
    // commit, because a falsy RETURN commits and only a throw rolls back.
    await query('UPDATE players SET credits=$2 WHERE id=$1', [p.id, palletPrice(crop) * 20]);
    p.credits = palletPrice(crop) * 20;
    const capBuy = await buyFromVendor(p, counter, crop.id, 6);   // 2 already out + 6 > MAX_OPEN_PALLETS
    check('a counter refuses an order over the outstanding-pallet cap', capBuy.success === false, JSON.stringify(capBuy.message));
    check('the refusal explains itself (not "you can\'t afford that")', /pallet/i.test(capBuy.message || ''), capBuy.message);
    const { rows: after } = await query('SELECT credits FROM players WHERE id=$1', [p.id]);
    check('a refused delivery rolls the sale back (no credits taken)', after[0]?.credits === palletPrice(crop) * 20,
      `${palletPrice(crop) * 20} → ${after[0]?.credits}`);
    check("…and the live player object isn't left showing the phantom debit", p.credits === after[0]?.credits,
      `live=${p.credits} db=${after[0]?.credits}`);

    await query('DELETE FROM npcs WHERE id = ANY($1)', [[counter.id, notCounter.id]]);
    await query("DELETE FROM cargo_drops WHERE owner_id=$1 AND kind='fence'", [p.id]);
    await query('UPDATE players SET credits=$2 WHERE id=$1', [p.id, palletPrice(crop) * 4]);
    p.credits = palletPrice(crop) * 4;
    await placeCacheOrder(p, crop, 2);   // restore the two pallets the checks below expect
    await query("UPDATE cargo_drops SET created_at=$2 WHERE owner_id=$1 AND kind='fence'", [p.id, nowSec() - 3600]);
  }

  // Ordering happens at a counter NPC, and the fake player is nowhere near Amos. An
  // unlocked pilot gets pointed at him; nothing is ordered and no ledger is printed.
  r = await run('raws');
  check('raws away from a counter points at the counter instead of ordering',
    /ledger/i.test(r?.message || '') && !/pallet/i.test(r?.message || ''), JSON.stringify(r));
  ({ rows: cd } = await query("SELECT COUNT(*)::int n FROM cargo_drops WHERE owner_id=$1 AND kind='fence'", [p.id]));
  check('raws away from a counter orders nothing', cd[0]?.n === 2, JSON.stringify(cd[0]));

  // …and a player who was never let in on the trade never learns the verb exists: with
  // no counter present and no unlock, it falls through as if unregistered.
  await clearFlag('player', 'air_cargo_unlocked', p);
  r = await run('raws');
  check('raws is invisible to a player outside the trade', /unknown command/i.test(r?.message || ''), JSON.stringify(r));

  await query("DELETE FROM cargo_drops WHERE owner_id=$1 AND kind='fence'", [p.id]);
  await clearFlag('player', 'air_cargo_unlocked', p);
  await clearFlag('player', 'dealer_inner_circle', p);
  await setFlag('player', 'bm_trust', '0', p);
  if (!had.length) await query('DELETE FROM players WHERE id=$1', [p.id]);   // leave no row behind

  // ── Pilot licence + checkride (hard gate to fly; distinct from the freight licence) ──
  const savedRole = p.role;
  p.role = 'player';
  await setFlag('player', 'air_pilot_licensed', '0', p);
  check('isPilotLicensed false before the checkride', (await isPilotLicensed(p)) === false);
  p.role = 'admin';
  check('admins are auto-rated (role bypass)', (await isPilotLicensed(p)) === true);
  p.role = 'player';
  await setFlag('player', 'air_pilot_licensed', '1', p);
  check('isPilotLicensed true once the licence flag is set', (await isPilotLicensed(p)) === true);
  await setFlag('player', 'air_pilot_licensed', '0', p);
  p.role = savedRole;

  // Ring course + stage constants (pure).
  check('the checkride has a 4-ring pilot-wings course', checkrideTest.GATES.length === 4);
  check('every ring carries a position, altitude and tolerances', checkrideTest.GATES.every(g => Number.isFinite(g.gx) && Number.isFinite(g.gy) && g.alt > 0 && g.r > 0 && g.altTol > 0));
  check('the ride runs STARTUP → TAKEOFF → RINGS → LAND', checkrideTest.STAGE.STARTUP === 0 && checkrideTest.STAGE.LAND === 3);

  // The `checkride` verb is player-facing (NOT admin-gated) — an already-flying player is
  // told to climb out first (a cheap path that proves access without spawning a loaner).
  const savedAcC = p.aircraftId; p.aircraftId = 'aircraft_regress_dummy';
  r = await run('checkride');
  check('checkride is player-accessible (not access-denied) and gates on being aboard', /climb out/i.test(r?.message || ''), r?.message);
  if (savedAcC) p.aircraftId = savedAcC; else delete p.aircraftId;

  // ── Text-only passenger travel (textmode.js) ────────────────────────────────
  // The accessibility opt-out: a passenger who never wants the graphical cabin.
  // No longer a flight-owned flag — it reads the game-wide Display Mode
  // (server/engine/presentation.js), the same switch the poker table reads.
  // What's load-bearing is that the preference is LATCHED onto the live player at
  // board time — pushHud is sync and runs on the 3s tick, so it can only skip a
  // text-only rider by reading a property, never by awaiting a flag.
  await clearFlag('player', TEXT_TRAVEL_FLAG, p);
  check('text travel is OFF by default', (await prefersTextTravel(p)) === false);
  // The legacy word — still the bottom rung, so an existing text player is
  // unchanged by the ladder landing.
  await setFlag('player', TEXT_TRAVEL_FLAG, 'text', p);
  check('the legacy "text" value still turns text travel on', (await prefersTextTravel(p)) === true);
  await setFlag('player', TEXT_TRAVEL_FLAG, 'log', p);
  check('...and so does the bottom rung by its real name', (await prefersTextTravel(p)) === true);
  await setFlag('player', TEXT_TRAVEL_FLAG, 'visual', p);
  check('an explicit visual reads as off (not merely "set")', (await prefersTextTravel(p)) === false);
  // THE AXIS SPLIT — the subtle half of the ladder, and the thing most likely to
  // be got wrong by a future call site. RIDING is a panel: delete the cabin window
  // and the player is not stuck, so it only goes away on the bottom rung. FLYING
  // is a minigame: delete the cockpit and the aircraft is unusable, so the text
  // cockpit arrives one rung earlier. A player on `textgames` therefore flies by
  // command AND keeps the view when they're only a passenger — which is precisely
  // what the middle rung is for.
  await setFlag('player', TEXT_TRAVEL_FLAG, 'textgames', p);
  check('a textgames player still gets the cabin window as a PASSENGER',
    (await prefersTextTravel(p)) === false, 'the middle rung took the window away');
  {
    const { prefersTextMinigamesOrDefault } = await import('../../server/engine/presentation.js');
    check('...but flies by command as a PILOT',
      (await prefersTextMinigamesOrDefault(p)) === true, 'the middle rung left the 3D cockpit on');
  }

  // ⚠ THE OLD PER-SYSTEM FLAG NO LONGER PROMOTES ANYBODY. An earlier cut landed a
  // player carrying `flight_text_only` straight on `log` — the most aggressive
  // rung, which strips every panel in the game. That is far more than the flag
  // ever meant: it turned off a cabin window, not a map, a hangar and a television.
  // They read as NEVER CHOSEN and land on `visual`, opting in fresh from Settings.
  await clearFlag('player', TEXT_TRAVEL_FLAG, p);
  await setFlag('player', 'flight_text_only', 'true', p);
  check('the old flight_text_only flag no longer forces text travel',
    (await prefersTextTravel(p)) === false, 'an old flag still promotes to the log rung');
  {
    const { displayRung } = await import('../../server/engine/presentation.js');
    // Never-chosen rather than an explicit `visual` is what keeps poker's
    // `config.textTable` alive for them — an old-school felt still opens
    // called-aloud.
    check('…and reads as NEVER CHOSEN, not as an explicit visual',
      (await displayRung(p)) === undefined, String(await displayRung(p)));
  }
  await clearFlag('player', 'flight_text_only', p);
  // The narrator must be safe to run against whatever is aloft at any moment — it's
  // on its own 45s schedule with no guard around it beyond its own.
  await setFlag('player', TEXT_TRAVEL_FLAG, 'text', p);
  let ttThrew = null;
  try { textTravelTick(); } catch (e) { ttThrew = e.message; }
  check('the narration tick survives the live-aircraft set as it stands', ttThrew === null, ttThrew);
  await clearFlag('player', TEXT_TRAVEL_FLAG, p);

  // The preference covers the HANGAR too, not just the ride. The 3D bay auto-opens
  // when you walk through a hangar door, so a player who asked for a text display
  // would have had a graphics panel thrown at them without ever typing anything.
  // The gate lives in pushHangarBay (not cmdHangar) precisely so every entry point
  // — bare `hangar`, `fleet`, `showroom`, `view`, the zone.entered auto-open, and
  // each command's post-action refresh — is covered by construction.
  {
    const savedBc = getBroadcast(), savedZoneH = p.current_zone;
    // A residents-only pad is deliberately invisible to a non-resident — fieldFor()
    // returns null there, so the bay never opens and both halves of this check would
    // read "nothing sent". Which field comes back first depends on world load order,
    // so pick a PUBLIC one explicitly rather than trusting the head of the list.
    const field = listAirfields().find(f => {
      const z = getZone(f.id);
      return z?.flags?.airfield_id && !airfieldOf(z)?.residents_only;
    });
    if (!field) check('an airfield exists to open a hangar at', false, 'no airfield zones loaded');
    else {
      const sent = [];
      p.current_zone = field.id;
      setBroadcast((zoneId, message, excludeId, targetId) => { sent.push({ targetId, message }); });
      try {
        await setFlag('player', TEXT_TRAVEL_FLAG, 'text', p);
        await pushHangarBay(p);
        check('text flight display gets the text hangar, never the 3D bay panel',
          !sent.some(s => s.message?.type === 'hangar_bay_open')
          && sent.some(s => s.message?.type === 'output' && /HANGAR —/.test(s.message.message || '')),
          sent.map(s => s.message?.type).join(',') || 'nothing sent');

        // A background refresh has nothing to say in text — reprinting the whole
        // floor after every action would be a wall of scroll.
        sent.length = 0;
        await pushHangarBay(p, null, { refreshOnly: true });
        // What's asserted is that the HANGAR PUSH is silent, not that no other
        // plugin in the world may speak during it. Walking into the bay above can
        // earn an accolade, and that grant isn't awaited — so it landed in this
        // window or the previous one depending on timing, and failed this check at
        // random. Filtered rather than slept on: a timing-dependent gate blocks
        // pushes for reasons that have nothing to do with the change being pushed.
        const own = sent.filter(s => s.message?.type !== 'accolade_unlocked');
        check('a refresh-only push says nothing at all in text mode', own.length === 0,
          own.map(s => s.message?.type).join(','));

        // The MIDDLE rung takes the bay too — it is a full-screen app with its own
        // WASD camera that auto-opens through a door, not a readout you skim.
        sent.length = 0;
        await setFlag('player', TEXT_TRAVEL_FLAG, 'textgames', p);
        await pushHangarBay(p);
        check('the middle rung gets the text hangar as well',
          !sent.some(s => s.message?.type === 'hangar_bay_open')
          && sent.some(s => s.message?.type === 'output' && /HANGAR —/.test(s.message.message || '')),
          sent.map(s => s.message?.type).join(',') || 'nothing sent');

        // …and the graphical player is untouched by any of this.
        sent.length = 0;
        await clearFlag('player', TEXT_TRAVEL_FLAG, p);
        await pushHangarBay(p);
        check('with the flag off the 3D bay still opens as before',
          sent.some(s => s.message?.type === 'hangar_bay_open'),
          sent.map(s => s.message?.type).join(',') || 'nothing sent');
      } finally {
        setBroadcast(savedBc); p.current_zone = savedZoneH;
        await clearFlag('player', TEXT_TRAVEL_FLAG, p);
      }
    }
  }

  // ── Text-native piloting (textpilot.js) ─────────────────────────────────────
  // The pure seams first: the grade curve, the heading arithmetic, and the assist.
  check('landing grade follows the cockpit report card curve',
    landingGrade(50) === 'A+' && landingGrade(200) === 'B+' && landingGrade(400) === 'B-' && landingGrade(9999) === 'F-');
  check('a passing checkride grade is reachable by a soft text landing', ['A+', 'A', 'A-', 'B+', 'B', 'B-'].includes(landingGrade(300)));
  // A reciprocal is genuinely ambiguous — it resolves to a left turn, which is a choice,
  // not a bug; what matters is that it never takes the 340° way round.
  check('heading error takes the short way round',
    tpTest.headingError(350, 10) === 20 && tpTest.headingError(10, 350) === -20 && Math.abs(tpTest.headingError(0, 180)) === 180);
  // ── A helicopter's service ceiling is REAL ───────────────────────────────────
  // The heli branch used to ignore `p.ceiling` outright: an authored number no rotorcraft
  // code read, so a helicopter climbed at a constant rate to any altitude you had the
  // patience for and editing the figure in TYPES changed nothing. These pin the fade down
  // so it can't quietly go inert again.
  {
    const vip = FM_TYPES.viper;
    const climbAt = (alt) => {
      const s = fmCreate(vip); s.onGround = false; s.altitude = alt; s.rpm = 1; s.airspeed = 0;
      for (let t = 0; t < 120; t += FM_DT) fmStep(s, fmIn({ throttle: 0.7 }), vip, FM_DT);
      return s.vs;
    };
    const low = climbAt(500), mid = climbAt(vip.ceiling * 0.5), top = climbAt(vip.ceiling);
    check('a helicopter climbs willingly down low', low > 300, `${Math.round(low)} fpm`);
    check('...climbs worse in thin air (the ceiling fade is wired to the heli branch at all)',
      mid < low * 0.75, `${Math.round(mid)} fpm at half ceiling vs ${Math.round(low)} on the deck`);
    check('...and has nothing left at the authored ceiling', Math.abs(top) < 60, `${Math.round(top)} fpm`);
    // Thin air must never stop you coming DOWN — sink is deliberately outside the fade.
    const sink = fmCreate(vip); sink.onGround = false; sink.altitude = vip.ceiling; sink.rpm = 1;
    for (let t = 0; t < 20; t += FM_DT) fmStep(sink, fmIn({ throttle: 0 }), vip, FM_DT);
    check('...but can still descend from up there (the fade is climb-only)', sink.vs < -400, `${Math.round(sink.vs)} fpm`);
    // Full collective is NOT best rate — it droops the rotor. Guards the droop knee.
    const rocAt = (c) => { const s = fmCreate(vip); s.onGround = false; s.altitude = 500; s.rpm = 1;
      for (let t = 0; t < 120; t += FM_DT) fmStep(s, fmIn({ throttle: c }), vip, FM_DT); return s.vs; };
    check('best rate sits at the droop knee, not at full collective', rocAt(0.7) > rocAt(1.0) * 1.5,
      `${Math.round(rocAt(0.7))} fpm at 0.7 vs ${Math.round(rocAt(1.0))} at full`);
  }

  check('every continuous airframe has a physics profile to fly in text',
    [...CONTINUOUS_TYPES].every(id => !!tpTest.fmTypeOf({ type: { id } })), 'a continuous type with no flight-model entry would silently fall back to the 3D sim');

  // End-to-end on a live aircraft: start the server-side sim, fly it, and confirm it
  // writes the SAME live.cont contract reconcile does — that contract is the whole
  // reason hazards/combat/contacts can't tell a text-flown craft from a client-flown one.
  const savedZoneTP = p.current_zone;
  const tpId = 'aircraft_regress_textpilot';
  await query('DELETE FROM aircraft WHERE id=$1', [tpId]);
  await query(`INSERT INTO aircraft (id,type_id,name,owner_id,rental,is_wreck,airborne,parked_zone_id,fuel,grid_x,grid_y,heading) VALUES ($1,'ac_mayfly','REGR-TP',$2,0,0,0,$3,40,925,903,'n')`, [tpId, p.id, savedZoneTP]);
  const tpLive = await loadAircraft(tpId);
  // try/finally, not straight-line: this row is PARKED IN THE PLAYER'S ZONE, so if a
  // check throws before the cleanup below, the leftover row survives into the NEXT run
  // and every earlier "no aircraft here" check finds one. (That is exactly what happened
  // once — a throw here failed three unrelated suites on the following run.)
  try {
  if (tpLive) {
    liveAircraft.set(tpId, tpLive);
    const started = startTextPilot(p, tpLive);
    check('startTextPilot arms the server-side sim on a Mayfly', started === true && !!tpLive.fmState && tpLive.textPilot === true);
    check('a text pilot is latched on the player too (so the sync push paths can skip them)', p.textPilot === true);

    // A cold, parked aeroplane must simply not be simulated — the tick's early-out.
    tpLive.fx = 925; tpLive.fy = 903;
    await textPilotTick();
    check("a cold parked craft isn't simulated", tpLive.fmState.airspeed === 0 && (tpLive.cont === undefined || tpLive.cont === null));

    // Full power on the deck: she must actually accelerate and then fly.
    tpLive.row.engine_on = 1;
    tpLive.textTargets.throttle = 100;
    tpLive.textTargets.takeoff = true;
    for (let i = 0; i < 30 && tpLive.fmState.onGround; i++) await textPilotTick();
    check('full power + takeoff intent rolls her down the strip and flies her off',
      !tpLive.fmState.onGround && tpLive.fmState.airspeed > 0, `onGround=${tpLive.fmState.onGround} ias=${Math.round(tpLive.fmState.airspeed)}`);
    check('the sim writes the same seven-field live.cont contract reconcile does',
      tpLive.cont && ['altitude', 'airspeed', 'vs', 'bank', 'pitch', 'onGround', 'stalled'].every(k => k in tpLive.cont), JSON.stringify(tpLive.cont));
    check('flying moves her across the map (the tile position is integrated, not frozen)',
      tpLive.fx !== 925 || tpLive.fy !== 903, `${tpLive.fx},${tpLive.fy}`);
    check('altitude_band tracks the sim height', BANDS.includes(tpLive.row.altitude_band));

    // The assist is the whole point: hold a commanded altitude, and never leave her stalled.
    tpLive.textTargets.altitude = 1200;
    for (let i = 0; i < 60; i++) await textPilotTick();
    check('the autopilot climbs toward a commanded altitude', tpLive.fmState.altitude > 200, `alt=${Math.round(tpLive.fmState.altitude)}`);
    check("the assist doesn't leave her parked in a stall", !tpLive.fmState.stalled);
    check('status reads out real instruments', /ALT/.test(statusLines(tpLive)) && /HDG/.test(statusLines(tpLive)));

    // The live ASCII panel: every field the renderer reads must actually be present,
    // because a missing one draws as `undefined` in the middle of the instruments.
    const panel = panelPayload(tpLive);
    check('the live panel payload carries a full instrument set',
      panel && panel.type === 'text_cockpit' &&
      ['alt', 'ias', 'hdg', 'vs', 'pitch', 'bank', 'throttle', 'vr', 'vs0', 'fuelPct', 'hull', 'x', 'y']
        .every(k => Number.isFinite(panel[k])), JSON.stringify(panel && Object.keys(panel)));
    check('the panel carries the map data the ASCII minimap rasterizes', panel && 'minimap' in panel && 'surface' in panel);
    check('the panel carries a chart radius and the airframe landing rule the HUD prints',
      panel && Number.isFinite(panel.mapR) && panel.mapR > 3 && ['vtol', 'stol', 'strip'].includes(panel.landMode), panel && `${panel.mapR}/${panel.landMode}`);

    // `land` is three verbs wearing one name, keyed off takeoff_mode — the check that stops
    // every airframe from landing identically, which is what it used to do.
    p.aircraftId = tpId; p.seat = 'pilot';   // the verb resolves the craft off the seated player, as dispatch would
    tpLive.row.airborne = 1;                 // the takeoff edge routes through cmdFlightEvent, which isn't wired in the harness
    const stolType = tpLive.type;
    // The Mayfly is STOL: rough-field rated, so she'll go in anywhere — but only once she's slow.
    const tooFast = cmdTextLand([], p);
    check('a rough-field craft still refuses to be set down at flying speed',
      /too fast/i.test(tooFast?.message || ''), tooFast?.message);
    tpLive.fmState.airspeed = 4;   // well under the Mayfly's stall — the approach gate opens
    tpLive.textTargets.altitude = 900;
    const slowEnough = cmdTextLand([], p);
    check('...and takes the order once she is slow, configuring her for the approach',
      tpLive.textTargets.gear === 1 && tpLive.textTargets.flaps === 100 && tpLive.textTargets.altitude === 0, slowEnough?.message);
    // The same aircraft rated for tarmac only: now the SAME order out over the city is refused
    // for want of a runway, however slow she is.
    try {
      tpLive.type = { ...stolType, takeoff_mode: 'strip' };
      tpLive.row.grid_x = 940; tpLive.row.grid_y = 940;
      const offStrip = cmdTextLand([], p);
      check('a strip-rated craft refuses a land order with no runway under her',
        /needs a runway/i.test(offStrip?.message || ''), offStrip?.message);
      check('...and names the nearest strip instead of just saying no',
        /nearest strip/i.test(offStrip?.message || '') || !nearestAirfield(940, 940, { needsRunway: true }), offStrip?.message);
      tpLive.row.grid_x = 925; tpLive.row.grid_y = 903;
      const onStrip = cmdTextLand([], p);
      check('...but takes it with a runway under her', /final/i.test(onStrip?.message || ''), onStrip?.message);
    } finally { tpLive.type = stolType; }

    // The ENGINE-master pair. A text pilot has no panel, so the verbs ARE their switch; a 3D
    // cockpit pilot has one, and the verb must send them to it. `shutdown` had only half of
    // that: it wrote engine_on=0 on a craft whose client sim was still flying, so the prop
    // kept turning and the row disagreed with the aeroplane.
    p.aircraftId = tpId; p.seat = 'pilot';
    tpLive.row.airborne = 0; tpLive.row.engine_on = 1;
    let sd = await run('shutdown');
    check('a text pilot can shut down with the verb', /kill the engine/i.test(sd?.message || ''), sd?.message);
    tpLive.row.engine_on = 1; tpLive.textPilot = false;
    sd = await run('shutdown');
    check('a 3D-cockpit pilot is sent to the ENGINE switch, not silently desynced',
      /ENGINE<\/b> switch/i.test(sd?.message || '') && tpLive.row.engine_on === 1, sd?.message);
    tpLive.textPilot = true; tpLive.row.engine_on = 0;

    // The cockpit HOPPER button's data route. A Mayfly has no spray gear, so the answer is the
    // refusal — the button is only mounted on a sprayer, and the verb agrees without being told.
    const hb = await run('hopperbay');
    check('hopperbay refuses a craft with no chemical hopper', /no chemical hopper/i.test(hb?.message || ''), hb?.message);

    stopTextPilot(tpLive);
    check('stopTextPilot tears the sim down', !tpLive.textPilot && !tpLive.fmState);
  }
  } finally {
    if (tpLive) stopTextPilot(tpLive);
    delete p.textPilot;
    liveAircraft.delete(tpId);
    await query('DELETE FROM aircraft WHERE id=$1', [tpId]);
    p.current_zone = savedZoneTP; delete p.aircraftId; delete p.seat;
  }

  // ── Walkable aircraft cabin — the Leviathan flying base, Phase 1 ─────────────
  // Pure seams: which craft carry a walkable interior.
  check('leviathan is a walkable-cabin craft; the mayfly is not',
    isWalkableCabin({ type: { id: 'ac_leviathan' } }) === true && isWalkableCabin({ type: { id: 'ac_mayfly' } }) === false);
  check('cabinTypeOf strips the ac_ prefix', cabinTypeOf({ type: { id: 'ac_leviathan' } }) === 'leviathan');
  // The authored cabin shell (git content, loaded into the world).
  const lvCabin = getZone('zone_leviathan_cabin'), lvFd = getZone('zone_leviathan_flightdeck'),
    lvGalley = getZone('zone_leviathan_galley'), lvHold = getZone('zone_leviathan_hold'),
    lvBelly = getZone('zone_util_zone_leviathan_cabin');
  check('the Leviathan cabin shell loaded (5 always-lit interior rooms, tagged aircraft_cabin)',
    [lvCabin, lvFd, lvGalley, lvHold, lvBelly].every(z => z?.flags?.always_lit && z?.flags?.is_interior && z?.flags?.aircraft_cabin === 'leviathan'));
  // The belly crawlspace is the room power self-heal dug under her before that
  // could be stopped (environment.js now skips vehicles). It was adopted into the
  // shell rather than deleted — so it has to BE a cabin room, not a basement: same
  // craft tag, reciprocal hatch, and no window to look out of down there.
  check('the belly crawlspace is part of the cabin, not a basement under it',
    isCabinZone(lvBelly, { type: { id: 'ac_leviathan' } }) === true
    && lvCabin?.exits?.down === 'zone_util_zone_leviathan_cabin'
    && lvBelly?.exits?.up === 'zone_leviathan_cabin'
    && !lvBelly?.flags?.cabin_window,
    `${JSON.stringify(lvBelly?.exits)} cabin.down=${lvCabin?.exits?.down}`);
  check('cabinEntryZone resolves the boarding room', cabinEntryZone({ type: { id: 'ac_leviathan' } })?.id === 'zone_leviathan_cabin');
  check('isCabinZone matches a room to its craft type only',
    isCabinZone(lvCabin, { type: { id: 'ac_leviathan' } }) === true && isCabinZone(lvCabin, { type: { id: 'ac_mule' } }) === false);
  check('cabin rooms wire nose→tail with reciprocal exits',
    lvFd?.exits?.south === 'zone_leviathan_cabin' && lvCabin?.exits?.north === 'zone_leviathan_flightdeck' &&
    lvCabin?.exits?.south === 'zone_leviathan_galley' && lvGalley?.exits?.north === 'zone_leviathan_cabin' &&
    lvGalley?.exits?.south === 'zone_leviathan_hold' && lvHold?.exits?.north === 'zone_leviathan_galley');

  // End-to-end: seat the fake player as a PASSENGER in a live Leviathan, walk the
  // cabin fore/aft (every other craft blocks walking while aboard), and disembark
  // back onto the parked ramp.
  const savedZoneW = p.current_zone;
  if (lvCabin && getZone(savedZoneW)) {
    const wAcId = 'aircraft_regress_leviathan';
    await query('DELETE FROM aircraft WHERE id=$1', [wAcId]);
    await query(`INSERT INTO aircraft (id,type_id,name,owner_id,rental,is_wreck,airborne,parked_zone_id) VALUES ($1,'ac_leviathan','REGR-LV',$2,0,0,0,$3)`, [wAcId, p.id, savedZoneW]);
    const wLive = await loadAircraft(wAcId);
    if (wLive) {
      liveAircraft.set(wAcId, wLive);
      wLive.occupants.add(p.id); wLive.occupants.add('npc_regress_pilot'); wLive.pilotId = 'npc_regress_pilot';
      p.aircraftId = wAcId; p.seat = 'passenger'; p.posture = 'standing';
      p.current_zone = 'zone_leviathan_cabin'; lvCabin.players.add(p.id);
      // Window overlay: opens the through-hull moving-world view from a windowed cabin room, toggles closed.
      let wr = await run('window');
      check('window opens the through-hull view from a windowed cabin room', p.cabinWindowOpen === true && wr?.type === 'noop', `${wr?.type}:${p.cabinWindowOpen}`);
      wr = await run('window');
      check('a second window turns back to the cabin', p.cabinWindowOpen !== true, String(p.cabinWindowOpen));
      // One live hop proves the move gate lets an aboard passenger walk the cabin
      // (the reciprocal-exits check above proves every room is then reachable); the
      // movement-pacing plugin defers rapid back-to-back steps, so we don't chain them.
      const mv = await run('south');
      check('a cabin passenger can WALK aft to the galley', p.current_zone === 'zone_leviathan_galley', `${mv?.type}:${p.current_zone}`);
      wr = await run('window');
      check('a windowless room (the galley) has nothing to look out of', /no window/i.test(wr?.message || ''), wr?.message);
      await run('disembark');
      check('disembark from the cabin sets them down on the ground (not in a cabin room)',
        !getZone(p.current_zone)?.flags?.aircraft_cabin && !p.aircraftId,
        `${p.current_zone} ac=${p.aircraftId} parked=${wLive.row.parked_zone_id} saved=${savedZoneW}`);
    }
    liveAircraft.delete(wAcId);
    for (const z of [lvCabin, lvFd, lvGalley, lvHold]) z?.players.delete(p.id);
    await query('DELETE FROM aircraft WHERE id=$1', [wAcId]);
  }
  p.current_zone = savedZoneW; delete p.aircraftId; delete p.seat; delete p.cabinWindowOpen;

  // ── Walkable base: take the controls / hand off at the flight deck (Phase 2) ──
  // From INSIDE the base you fly her by stepping to the flight deck and taking the
  // controls (into the cockpit sim); `handoff` (ground only) steps you back out to walk.
  if (lvFd && lvCabin && getZone(savedZoneW)) {
    const cAcId = 'aircraft_regress_lv_ctrl';
    await query('DELETE FROM aircraft WHERE id=$1', [cAcId]);
    await query(`INSERT INTO aircraft (id,type_id,name,owner_id,rental,is_wreck,airborne,parked_zone_id) VALUES ($1,'ac_leviathan','REGR-LVC',$2,0,0,0,$3)`, [cAcId, p.id, savedZoneW]);
    const cLive = await loadAircraft(cAcId);
    if (cLive) {
      liveAircraft.set(cAcId, cLive);
      cLive.occupants.add(p.id); cLive.pilotId = null;
      p.aircraftId = cAcId; p.seat = 'passenger'; p.posture = 'standing';
      // A licensed non-admin, so the licence gate is exercised as a real pass (not a role bypass).
      const roleC = p.role; p.role = 'player'; await setFlag('player', 'air_pilot_licensed', '1', p);
      // From the cabin (not the deck) the controls are out of reach.
      p.current_zone = 'zone_leviathan_cabin'; lvCabin.players.add(p.id);
      let tc = await run('takecontrols');
      check('takecontrols is refused away from the flight deck', /flight deck/i.test(tc?.message || ''), tc?.message);
      // At the deck with no pilot: take the controls → seated as pilot, cockpit opens (noop).
      lvCabin.players.delete(p.id); p.current_zone = 'zone_leviathan_flightdeck'; lvFd.players.add(p.id);
      tc = await run('takecontrols');
      check('takecontrols at the deck seats you as pilot and opens the cockpit', p.seat === 'pilot' && cLive.pilotId === p.id && tc?.type === 'noop', `${tc?.type}:${p.seat}:${cLive.pilotId}`);
      check('taking the controls steps you out of the flight-deck room', !lvFd.players.has(p.id), String([...lvFd.players]));
      // NAV console (flight-deck only): list airfields, chart one — it becomes the hand-off course.
      let nv = await run('nav');
      check('nav lists airfields to chart from the flight deck', nv?.type === 'output' && /NAV/i.test(nv?.message || ''), nv?.message);
      const navField = listAirfields({ needsRunway: true }).find(f => f.id !== cLive.row.parked_zone_id);
      if (navField) {
        nv = await run(`nav ${navField.id}`);
        check('nav <field> charts a course', /course charted/i.test(nv?.message || '') && cLive.navDest?.destZone === navField.id, `${cLive.navDest?.destZone}`);
      }
      // Mid-air hand-off engages the crew autopilot — to the CHARTED course when one is set.
      cLive.row.airborne = 1; cLive.row.grid_x = 0; cLive.row.grid_y = 0; cLive.fx = 0; cLive.fy = 0;
      let ho = await run('handoff');
      check('mid-air handoff hands off to the crew and returns you to the cabin',
        p.seat === 'passenger' && cLive.pilotId === null && !!cLive.crew && !!getZone(p.current_zone)?.flags?.aircraft_cabin,
        `${p.seat}:${cLive.pilotId}:crew=${!!cLive.crew}:${p.current_zone}`);
      check('the crew fly the charted NAV course, not just the nearest field',
        !navField || cLive.crew?.destZone === navField.id, `${cLive.crew?.destZone} vs ${navField?.id}`);
      // You can't take the controls back until the crew set her down.
      lvCabin.players.delete(p.id); p.current_zone = 'zone_leviathan_flightdeck'; lvFd.players.add(p.id);
      let tc2 = await run('takecontrols');
      check('takecontrols is refused while the crew have the controls', /crew have the controls/i.test(tc2?.message || ''), tc2?.message);
      delete cLive.crew; cLive.row.airborne = 0;
      // On the ground, handing off is a plain step out of the seat back into a cabin room.
      lvFd.players.delete(p.id); p.seat = 'pilot'; cLive.pilotId = p.id;
      ho = await run('handoff');
      check('handoff on the ground returns you to a cabin room as a passenger',
        p.seat === 'passenger' && cLive.pilotId === null && !cLive.crew && !!getZone(p.current_zone)?.flags?.aircraft_cabin, `${p.seat}:${cLive.pilotId}:${p.current_zone}`);
      // Departure from PARKED: `landat <field>` in the cabin is a takeoff order, not a landing one —
      // the crew spin her up and go. Previously refused ("she's already on the ground"), so the only
      // way to launch a crew-flown base was to fly her off yourself and hand off in the air.
      {
        const df = listAirfields({ needsRunway: true }).find(f => f.id !== cLive.row.parked_zone_id) || listAirfields({ needsRunway: true })[0];
        cLive.row.airborne = 0; delete cLive.crew; cLive.row.fuel = cLive.type?.fuel_capacity || 1760;
        p.seat = 'passenger'; cLive.pilotId = null;
        const dep = await run(`landat ${df.id}`);
        check('landat from a PARKED cabin launches the crew (takeoff, not a refusal)',
          cLive.row.airborne === 1 && cLive.crew?.mode === 'field' && cLive.crew.destZone === df.id,
          `air=${cLive.row.airborne} crew=${JSON.stringify(cLive.crew)} msg=${dep?.message}`);
        // Dry tank: the crew wave it off rather than launching on fumes.
        cLive.row.airborne = 0; delete cLive.crew; cLive.row.fuel = 0;
        const dry = await run(`landat ${df.id}`);
        check('the crew refuse to launch on a dry tank', cLive.row.airborne === 0 && !cLive.crew && /dry/i.test(dry?.message || ''), dry?.message);
        // At the controls yourself → the aeroplane must not leap off the deck under you.
        cLive.row.fuel = cLive.type?.fuel_capacity || 1760; p.seat = 'pilot'; cLive.pilotId = p.id;
        const own = await run(`landat ${df.id}`);
        check('a parked launch is refused while YOU have the controls',
          cLive.row.airborne === 0 && !cLive.crew && /controls/i.test(own?.message || ''), own?.message);
        p.seat = 'passenger'; cLive.pilotId = null; cLive.row.airborne = 0; delete cLive.crew; delete cLive.navDest;
      }
      // A helipad has no runway, so it is not a destination for a fixed-wing — the crew must never
      // be dispatchable to one, from the NAV list, the DEADHEAD map, or a typed `landat`. This is
      // load-bearing: before it, listAirfields() returned the pads too and the FIRST field in the
      // world is Threshold Helipad, so the obvious dispatch sent a 400-tonne freighter to a helipad.
      {
        const pads = listAirfields().filter(f => !listAirfields({ needsRunway: true }).some(r => r.id === f.id));
        check('the world actually has VTOL-only pads to exclude (else this proves nothing)', pads.length > 0, `pads=${pads.length}`);
        check('the runway-only list excludes every helipad',
          listAirfields({ needsRunway: true }).every(f => !pads.some(p2 => p2.id === f.id)));
        if (pads.length) {
          cLive.row.airborne = 0; delete cLive.crew; cLive.row.fuel = cLive.type?.fuel_capacity || 1760;
          p.seat = 'passenger'; cLive.pilotId = null;
          const bad = await run(`landat ${pads[0].id}`);
          check('the crew refuse to fly a fixed-wing base to a helipad',
            !cLive.crew && cLive.row.airborne === 0 && /no airfield matches/i.test(bad?.message || ''), bad?.message);
        }
        // The same rule on the TOW paths. A recovery crew dragging a fixed-wing home must not pick
        // a helipad as "the nearest airfield" either — and since the pads sit inside the city they
        // very often ARE the nearest thing to where you came down, so this is the common case, not
        // the edge one. Asserted straight against the helper both tow paths call.
        for (const pad of pads) {
          const z = getZone(pad.id); if (z?.grid_x == null) continue;
          const forJet = nearestAirfield(z.grid_x, z.grid_y, { needsRunway: true });
          const forHeli = nearestAirfield(z.grid_x, z.grid_y, { needsRunway: false });
          check(`tow: a fixed-wing down ON ${pad.name} is recovered to a RUNWAY, not that pad`,
            forJet && forJet.id !== pad.id, `${forJet?.id}`);
          check(`tow: a rotorcraft down on ${pad.name} may still be recovered to it`,
            forHeli?.id === pad.id, `${forHeli?.id}`);
        }
        delete cLive.crew; delete cLive.navDest; cLive.row.airborne = 0;
      }
      // Crew arrival shuts her down. Load-bearing for the CABIN: engine_on going false is the edge
      // pushHud turns into a spool-down, so without it the aeroplane just goes quiet on landing and
      // a passenger never hears the engines wind off.
      {
        const lf2 = listAirfields({ needsRunway: true })[0];
        cLive.row.airborne = 1; cLive.row.engine_on = 1; delete cLive.crew;
        await _test.crewLand(cLive, lf2.id, lf2.name);
        check('the crew shut the engines down once she is on the blocks',
          !cLive.row.engine_on && !cLive.row.airborne && !cLive.crew,
          `eng=${cLive.row.engine_on} air=${cLive.row.airborne}`);
      }
      // DEADHEAD "Depart": charting from ABOARD only sets navDest (the map tap dispatches when
      // you're remote, but merely charts when you're in her cabin), so without a go button the
      // obvious flow — tap a field, look for the launch — dead-ended with the aeroplane still parked.
      {
        const df = listAirfields({ needsRunway: true }).find(f => f.id !== cLive.row.parked_zone_id) || listAirfields({ needsRunway: true })[0];
        cLive.row.airborne = 0; delete cLive.crew; delete cLive.navDest;
        cLive.row.fuel = cLive.type?.fuel_capacity || 1760;
        p.seat = 'passenger'; cLive.pilotId = null;
        await run(`tabletaction deadhead chart ${df.id}`);
        check('DEADHEAD chart from aboard sets a course WITHOUT launching her',
          cLive.navDest?.destZone === df.id && cLive.row.airborne === 0 && !cLive.crew,
          `dest=${cLive.navDest?.destZone} air=${cLive.row.airborne}`);
        const dep = await run('tabletaction deadhead depart');
        check('DEADHEAD Depart launches the crew on the charted course',
          cLive.row.airborne === 1 && cLive.crew?.destZone === df.id,
          `air=${cLive.row.airborne} crew=${JSON.stringify(cLive.crew)} notice=${dep?.notice}`);
        // Depart with nothing charted must say so rather than silently launching somewhere.
        cLive.row.airborne = 0; delete cLive.crew; delete cLive.navDest;
        const bare = await run('tabletaction deadhead depart');
        check('DEADHEAD Depart with no course charted refuses and explains',
          cLive.row.airborne === 0 && !cLive.crew && /chart a course/i.test(bare?.notice || ''), bare?.notice);
        delete cLive.navDest; delete cLive.crew; cLive.row.airborne = 0;
      }
      // Region rectangles for the DEADHEAD zoomed-out overlay. A region carries no stored bounds —
      // they're swept out of per-tile flags.region_id — so this is derived geometry with nothing
      // else checking it, and a silently empty list would just render a blank map.
      {
        const regs = listRegions();
        check('regions derive at least one rectangle from tile membership', regs.length > 0, `n=${regs.length}`);
        check('every region rectangle is well-formed (max >= min, centre inside it)',
          regs.every(r => r.maxX >= r.minX && r.maxY >= r.minY
            && r.cx >= r.minX && r.cx <= r.maxX && r.cy >= r.minY && r.cy <= r.maxY),
          JSON.stringify(regs[0]));
        check('every region resolves a display name (never a bare id)', regs.every(r => r.name && r.name !== r.id) || regs.every(r => !!r.name),
          regs.map(r => r.name).join(','));
        check('the region sweep is memoised (same array identity on a second call)', listRegions() === regs);
        // Coarse whole-world terrain. It ships on a 2s poll, so both its SIZE and its content matter:
        // a downsampler that quietly returned an all-'.' grid would render a black rectangle and
        // nothing would fail.
        const wm = worldTerrainMap();
        check('the world map downsamples to a bounded grid', wm.w > 0 && wm.h > 0 && wm.w <= 84 && wm.h <= 84 && wm.cell >= 1,
          `${wm.w}x${wm.h} cell=${wm.cell}`);
        check('the world map has one row string per grid row, each the full width',
          wm.rows.length === wm.h && wm.rows.every(r => r.length === wm.w), `rows=${wm.rows.length}/${wm.h}`);
        const chars = new Set(wm.rows.join(''));
        check("the world map isn't blank (real terrain got classified, not all void)",
          [...chars].some(c => c !== '.') && chars.size >= 3, [...chars].join(''));
        check('airfields survive the downsample (priority beats majority vote)', chars.has('A'), [...chars].join(''));
        check('the world map is memoised too', worldTerrainMap() === wm);
        // Payload size guard: this rides a 2s poll, so a regression to object-per-cell must be loud.
        const bytes = JSON.stringify(wm).length;
        check('the world map payload stays small enough to poll', bytes < 12000, `${bytes} bytes`);
        // The DEADHEAD payload must actually carry them, or the toggle has nothing to draw.
        const dhr = await run('tabletnav deadhead');
        check('DEADHEAD ships the region rectangles to the client', (dhr?.deadhead?.regions?.length || 0) === regs.length,
          `payload=${dhr?.deadhead?.regions?.length} derived=${regs.length}`);
        check('DEADHEAD ships a live heading + fractional position for the aircraft marker',
          typeof dhr?.deadhead?.hdg === 'number' && typeof dhr?.deadhead?.fx === 'number',
          `hdg=${dhr?.deadhead?.hdg} fx=${dhr?.deadhead?.fx}`);
      }
      // DEADHEAD tablet app — the portable NAV/crew console reads the live base state.
      if (navField) cLive.navDest = { destZone: navField.id, destName: navField.name, tx: navField.gx, ty: navField.gy };
      let dhp = await run('tabletnav deadhead');
      check('DEADHEAD app shows the base as aboard with the airfield map',
        dhp?.deadhead?.aboard === true && (dhp?.deadhead?.fields?.length || 0) > 0, `aboard=${dhp?.deadhead?.aboard} fields=${dhp?.deadhead?.fields?.length}`);
      dhp = await run('tabletaction deadhead clear');
      check('DEADHEAD "clear" drops the charted course', !dhp?.deadhead?.charted && !cLive.navDest, `charted=${dhp?.deadhead?.charted?.id}`);
      // Loiter: tap a bare tile (DEADHEAD map's tap-empty 'loiter' action) → the crew orbit it,
      // burning fuel, until bingo fuel forces a divert. Use an airfield's own tile so a divert is
      // always reachable (the fuel maths otherwise depend on how far the nearest field is).
      const lf = listAirfields({ needsRunway: true })[0];
      if (lf) {
        await run(`tabletaction deadhead loiter ${lf.gx} ${lf.gy}`);
        check('DEADHEAD map tap charts a bare HOLD tile (loiter), not an airfield course',
          cLive.navDest?.loiter === true && cLive.navDest.tx === lf.gx && cLive.navDest.ty === lf.gy, JSON.stringify(cLive.navDest));
        cLive.row.airborne = 1; cLive.row.grid_x = lf.gx; cLive.row.grid_y = lf.gy; cLive.fx = lf.gx; cLive.fy = lf.gy;
        cLive.crew = { mode: 'loiter', phase: 'loiter', loiterX: lf.gx, loiterY: lf.gy, tx: lf.gx, ty: lf.gy, name: `${lf.gx},${lf.gy}`, theta: 0 };
        cLive.row.fuel = cLive.type?.fuel_capacity || 1760;
        await _test.crewStep(cLive);
        const orbitR = Math.hypot(cLive.fx - lf.gx, cLive.fy - lf.gy);
        check('crew hold a GENTLE wide orbit with fuel in the tank (not a tight turn on the tile)',
          cLive.crew?.phase === 'loiter' && orbitR > 1.5 && orbitR < 3.5, `phase=${cLive.crew?.phase} r=${orbitR.toFixed(2)}`);
        cLive.row.fuel = 1;   // bingo
        await _test.crewStep(cLive);
        check('on bingo fuel the crew break off to divert and land',
          cLive.crew?.phase === 'divert' || (!cLive.crew && cLive.row.airborne === 0), `phase=${cLive.crew?.phase} air=${cLive.row.airborne}`);
        // Orders: tell the flying crew to land at an airport, or circle a tile.
        cLive.row.airborne = 1; cLive.row.grid_x = lf.gx; cLive.row.grid_y = lf.gy; cLive.fx = lf.gx; cLive.fy = lf.gy;
        cLive.crew = { mode: 'loiter', phase: 'loiter', loiterX: lf.gx, loiterY: lf.gy, tx: lf.gx, ty: lf.gy, name: `${lf.gx},${lf.gy}`, theta: 0 };
        await run(`landat ${lf.id}`);
        check('landat redirects a LOITERING crew to fly-and-land (mode switches out of loiter)',
          cLive.crew?.mode === 'field' && cLive.crew?.destZone === lf.id, `mode=${cLive.crew?.mode} dest=${cLive.crew?.destZone}`);
        await run('circle 7 8');
        check('circle redirects the flying crew to hold the named tile',
          cLive.crew?.mode === 'loiter' && cLive.crew?.loiterX === 7 && cLive.crew?.loiterY === 8, `mode=${cLive.crew?.mode} ${cLive.crew?.loiterX},${cLive.crew?.loiterY}`);
        delete cLive.crew; cLive.row.airborne = 0; delete cLive.navDest;
      }
      // Remote dispatch: own a live Leviathan but not aboard → tell her where to go from the app,
      // and the crew take her up and fly her there (a "charter" of your own base).
      const savedAcR = p.aircraftId; delete p.aircraftId;   // step off — you still own the live cLive
      cLive.row.airborne = 0; cLive.row.parked_zone_id = savedZoneW; delete cLive.crew; delete cLive.navDest;
      const rem = await run('tabletnav deadhead');
      check('DEADHEAD is a REMOTE dispatcher when you own a live Leviathan but aren\'t aboard',
        rem?.deadhead?.remote === true && rem?.deadhead?.aboard === false && (rem?.deadhead?.fields?.length || 0) > 0,
        `remote=${rem?.deadhead?.remote} aboard=${rem?.deadhead?.aboard} fields=${rem?.deadhead?.fields?.length}`);
      const rf = listAirfields({ needsRunway: true }).find(f => f.id !== savedZoneW);
      if (rf) {
        await run(`tabletaction deadhead chart ${rf.id}`);
        check('remote dispatch launches the PARKED base by crew to the chosen field',
          cLive.row.airborne === 1 && cLive.crew?.mode === 'field' && cLive.crew?.destZone === rf.id, `air=${cLive.row.airborne} mode=${cLive.crew?.mode} dest=${cLive.crew?.destZone}`);
        delete cLive.crew; cLive.row.airborne = 0; cLive.row.parked_zone_id = savedZoneW;
      }
      if (savedAcR) p.aircraftId = savedAcR; else delete p.aircraftId;
      // Visibility gate: the DEADHEAD Home tile only appears when you have a Leviathan live.
      const homeIn = await run('tabletnav home');
      check('DEADHEAD tile shows on the Home screen while a Leviathan is live', (homeIn?.apps || []).some(a => a.id === 'deadhead'), (homeIn?.apps || []).map(a => a.id).join(','));
      p.role = roleC; await setFlag('player', 'air_pilot_licensed', '0', p);
    }
    liveAircraft.delete(cAcId);
    for (const z of [lvCabin, lvFd, lvGalley, lvHold]) z?.players.delete(p.id);
    await query('DELETE FROM aircraft WHERE id=$1', [cAcId]);
  }
  p.current_zone = savedZoneW; delete p.aircraftId; delete p.seat; delete p.cabinWindowOpen;
  // …and it's gone from Home once you have no Leviathan live in the world.
  const homeOut = await run('tabletnav home');
  check('DEADHEAD tile is hidden with no Leviathan in the world', !(homeOut?.apps || []).some(a => a.id === 'deadhead'), (homeOut?.apps || []).map(a => a.id).join(','));

  p.posture = savedPosture; p.npcCombatTargetId = savedCombat;
  if (savedAc) p.aircraftId = savedAc; else { delete p.aircraftId; delete p.seat; }

  // ── STREET ACTORS ───────────────────────────────────────────────────────────
  // The population feed the windshield draws pedestrians from. The contract worth guarding is
  // that it is 1:1 and that INDOORS IS ABSENCE — an interior is its own map with no overworld
  // coordinates, so nobody inside a building may ever appear in it. That is what stops the layer
  // becoming a free occupancy read on every premises in the city, and it holds by construction
  // rather than by a flag, which is exactly the kind of thing that is one refactor from silently
  // reversing.
  {
    const { streetActors, _resetActorTally } = await import('../../server/engine/street-actors.js');
    const { world } = await import('../../server/engine/world.js');
    // A real surface tile with somebody standing on it: take the first NPC the world placed on a
    // map_world z=0 zone, and read the feed centred on them.
    let sx = null, sy = null, hits = 0, interiorNpc = null;
    for (const npc of world.npcs.values()) {
      const z = world.zones.get(npc.zone_id);
      if (!z) continue;
      if (z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 && z.grid_x != null) {
        if (sx == null) { sx = z.grid_x; sy = z.grid_y; }
        if (z.grid_x === sx && z.grid_y === sy) hits++;
      } else if (!interiorNpc) interiorNpc = npc;
    }
    if (sx != null) {
      _resetActorTally();
      const near = streetActors(sx, sy, 4);
      const onTile = near.filter(a => a.x === sx && a.y === sy);
      check('street actors: the feed is 1:1 with the tile occupancy', onTile.length === hits, `feed=${onTile.length} world=${hits}`);
      check('street actors: every entry carries a token and absolute coords',
        near.every(a => typeof a.t === 'string' && a.t.length > 0 && Number.isInteger(a.x) && Number.isInteger(a.y)));
      check('street actors: the window is square and honoured',
        near.every(a => Math.abs(a.x - sx) <= 4 && Math.abs(a.y - sy) <= 4));
      // A token must never be the id — that is the whole reason it exists (see street-actors.js).
      const ids = new Set([...world.npcs.keys(), ...world.players.keys()]);
      check('street actors: the token is opaque, never the entity id', near.every(a => !ids.has(a.t)));
      // Far away from everybody: empty is a real and correct answer, not a fallback crowd.
      _resetActorTally();
      check('street actors: an empty stretch reports nobody rather than filler',
        streetActors(sx + 9000, sy + 9000, 4).length === 0);
    }
    if (interiorNpc) {
      const z = world.zones.get(interiorNpc.zone_id);
      _resetActorTally();
      // Centre on the facade tile this interior hangs off, so the NPC would be well inside the
      // window if interiors leaked into the feed at all.
      let fx = 0, fy = 0;
      for (const m of world.maps.values()) {
        if (m.id !== z.map_id) continue;
        const par = world.zones.get(m.parent_zone_id);
        if (par && par.grid_x != null) { fx = par.grid_x; fy = par.grid_y; }
      }
      // The token is opaque by design, so we cannot look this NPC up in the feed directly. Ask for
      // the feed twice — once plain, once with this NPC excluded by id — and assert the two are the
      // same length. If they differ, the exclusion removed something, which means they were in it.
      const all = streetActors(fx, fy, 40).length;
      _resetActorTally();
      const without = streetActors(fx, fy, 40, interiorNpc.id).length;
      check('street actors: somebody indoors is ABSENT from the street feed',
        all === without, `${all} vs ${without} — an interior occupant reached the feed`);
    }
  }

  // ── A running cockpit is a heated cabin ───────────────────────────────────
  // hvac.js registers live aircraft as cabin providers. This matters more here than anywhere
  // else: a pilot's `current_zone` is still the airfield they took off from, so without the
  // cabin every thermal question about them was answered by the weather on a patch of ramp.
  {
    const { cabinTemperature, stepCabinTemps, getZoneTemperature } =
      await import('../../server/engine/environment.js');
    const p = getPlayer();
    const acId = 'flight_regress_hvac_ac';
    const fake = { row: { engine_on: 1 }, type: { id: 'ac_regress_none' }, occupants: new Set([p.id]) };
    liveAircraft.set(acId, fake);
    try {
      for (let i = 0; i < 20; i++) stepCabinTemps();
      check('a running cockpit is held at the 20C setpoint',
        cabinTemperature(p.id) === 20, String(cabinTemperature(p.id)));

      fake.row.engine_on = 0;
      for (let i = 0; i < 200; i++) stepCabinTemps();
      const cold = cabinTemperature(p.id), out = getZoneTemperature(p.current_zone);
      check('dead engines bleed the cockpit back to the weather',
        Math.abs(cold - out) < 0.5, `${cold} vs ${out} outside`);
    } finally {
      liveAircraft.delete(acId);
      stepCabinTemps();
    }
    check('stepping out of the aircraft leaves no cabin behind',
      cabinTemperature(p.id) === null);
  }

  // ── A DUST STRIP IS MARKED, A PAVED ONE IS NOT ────────────────────────────
  // A lawless field is `surface: 'dust'` — graded dirt, no paint, no PAPI, no edge lights — which
  // is right for the fiction and meant Buzzard Field's runway was indistinguishable from the dirt
  // roads it sits among. It is now marked the way a frontier strip actually is: drums down the
  // edges, a bar across each threshold. DERIVED from `flags.runway` plus the neighbours, so
  // nothing is authored and a second dust strip gets it for free.
  {
    const { surfaceAt, deriveSurfaceCell } = await import('./state.js');
    const der = (x, y) => { const c = surfaceAt(x, y); return c ? deriveSurfaceCell(c, x, y, surfaceAt) : null; };

    // The Reach, north end → south end. Buzzard Field's hangar sits BESIDE the strip (910,1042),
    // which is the layout that once made a clean landing read as off-field — see the ⚠ in the
    // `land` handler. The strip itself is x=909.
    const strip = [1039, 1040, 1041, 1042].map(y => der(909, y));
    check('every tile of the dust strip is marked as one', strip.every(d => d?.mark === 'strip'),
      strip.map(d => d?.mark).join(','));
    check('…and carries the axis it runs on', strip.every(d => d?.strip?.ax === 'ns'));

    // ⚠ EXACTLY TWO THRESHOLDS, however long the strip is. `end` is -1 and 1 at the two ends and 0
    // between, so the bar lands twice — not on every tile, which would be a ladder, and not once,
    // which would mark one approach and not the other.
    check('the two ends are thresholds and the middle is not',
      strip.map(d => d.strip.end).join(',') === '-1,0,0,1', strip.map(d => d.strip.end).join(','));

    // The hangar tile is not part of the strip and must not be marked — it is a building, and a
    // threshold bar across a hangar door would be nonsense.
    check('the field\'s own tile isn\'t a strip tile', der(910, 1042)?.mark !== 'strip');
    // …and the tiles either side of the ends are outside it, or the strip would grow every pass.
    check('the strip stops where it stops', der(909, 1038)?.mark !== 'strip' && der(909, 1043)?.mark !== 'strip');

    // ⚠ AND A PAVED FIELD IS LEFT ALONE. Coldwater Regional already has paint, lights and a PAPI;
    // drums down the side of it would read as roadworks. The gate is the DUST surface, not the
    // runway flag, and this is the case that proves the difference is being read.
    const paved = [898, 899, 900, 901, 902, 903].map(y => der(925, y));
    check('a paved runway carries the flag but is never drum-marked',
      paved.every(d => d && d.mark !== 'strip'), paved.map(d => d?.mark).join(','));
  }
}
