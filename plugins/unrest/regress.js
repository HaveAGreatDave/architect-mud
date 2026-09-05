// Unrest regression suite — run by tests/regress.js, never loaded in production.
//
// The plugin has no verbs and never will (rule 2), so there is no routing to
// assert. What is worth pinning is everything that goes wrong INVISIBLY — a sim
// whose output is mood fails quietly, and every one of these was a real way for
// it to look like it was working while doing nothing:
//
//   1. Decay is monotone toward baseline and never crosses it. An overshoot reads
//      as the sim spontaneously producing tension out of a quiet city.
//   2. The blob round-trips a restart, and a corrupt one rebuilds instead of
//      throwing. A ledger is not worth a failed boot.
//   3. Pressure makes the fast pair limit-cycle. Without it a quiet cell can never
//      generate what would make it loud, and dead cells stay dead for ever — the
//      single reason there are three scalars and not two.
//   4. No interior lands in block 0,0 and no transient zone takes a cell at all.
import { world } from '../../server/engine/world.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import * as ledger from './ledger.js';
import { blockOf, allBlocks, blockKeyOf, neighboursOf, reindex, blockInfo, BLOCK } from './blocks.js';
import { _test } from './index.js';

export default async function regress({ check, getPlayer }) {
  const { roles } = _test;

  // ── The cell index ────────────────────────────────────────────────────────
  reindex();
  const blocks = allBlocks();
  check('the block index finds the built city', blocks.length > 0 && blocks.length < 60, String(blocks.length));

  check('blockKeyOf floors onto the grid', blockKeyOf(BLOCK * 3 + 1, BLOCK * 4 + 11) === '3,4', blockKeyOf(BLOCK * 3 + 1, BLOCK * 4 + 11));

  // ⚠ grid 0,0 is an unset column, never a tile. If an interior read its own
  // coordinates instead of following world_exit_zone to its facade, every
  // interior in the game would land in one corner.
  check('no cell is the 0,0 sinkhole', !blocks.includes('0,0'), blocks.slice(0, 5).join(' '));

  // A void-crossing room is synthetic and off-map; giving it a cell would let a
  // later phase stage a checkpoint inside somebody's crossing.
  const transientPlaced = [...world.transientZones].filter(id => blockOf(id));
  check('transient zones take no cell', transientPlaced.length === 0, transientPlaced.join(','));

  // Interiors resolve through their facade rather than being dropped.
  const anInterior = [...world.zones.values()].find(z => z.flags?.is_interior && (z.flags?.world_exit_zone || z.world_exit_zone));
  if (anInterior) {
    const viaFacade = blockOf(anInterior.flags?.world_exit_zone || anInterior.world_exit_zone);
    check('an interior inherits its facade cell', blockOf(anInterior.id) === viaFacade,
      `${blockOf(anInterior.id)} vs ${viaFacade}`);
  }

  const key = blocks[0];
  check('a neighbour list never contains the cell itself', !neighboursOf(key).includes(key));

  // ── Roles ─────────────────────────────────────────────────────────────────
  const r = roles();
  const WRITES = ['grip', 'heat', 'assets', 'none'];
  check('every non-expansion org with a role declares what it writes',
    r.every(x => WRITES.includes(x.writes)), JSON.stringify(r));
  check('the authority and the resident insurgency both exist',
    r.some(x => x.writes === 'grip') && r.some(x => x.writes === 'heat' && x.reads === 'grip'),
    JSON.stringify(r));
  // ⚠ The Wildblood write heat too, and must NOT be in the ledger's own cycle —
  // they are an external clock firing into it (phase 3), not a participant.
  check('the Wildblood are a driver, not part of the loop',
    r.every(x => x.id !== 'ideology_wildblood' || x.reads === 'clock'), JSON.stringify(r));
  const expansion = [...world.orgs.values()].filter(o => o.flags?.expansion).map(o => o.id);
  check('expansion orders take no role', !r.some(x => expansion.includes(x.id)), expansion.join(','));

  // ── Decay ─────────────────────────────────────────────────────────────────
  {
    const { BASELINE, decayed } = ledger._test;
    const hot = decayed({ grip: 90, heat: 90, pressure: 90, at: Date.now() - 60 * 60 * 1000 });
    check('decay pulls a hot cell DOWN toward baseline',
      hot.heat < 90 && hot.heat > BASELINE.heat, `${hot.heat}`);
    // ⚠ Monotone: an exponential approach can only close the gap, so a value above
    // baseline stays above it however long you wait.
    const ancient = decayed({ grip: 90, heat: 90, pressure: 90, at: 0 });
    check('…and never crosses it, however long', ancient.heat >= BASELINE.heat, `${ancient.heat}`);
    const cold = decayed({ grip: 0, heat: 0, pressure: 0, at: 0 });
    check('a cold cell rises to baseline and stops', cold.heat <= BASELINE.heat && cold.heat >= 0, `${cold.heat}`);
    check('decay is a no-op when no time has passed',
      decayed({ grip: 42, heat: 7, pressure: 3, at: Date.now() }).heat === 7);
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  {
    ledger._reset();
    await ledger.load();
    ledger.force(key, { grip: 71, heat: 63, pressure: 12 });
    await ledger.flush();

    // Simulated restart: drop RAM, reload from the blob.
    ledger._reset();
    await ledger.load();
    const back = ledger.read(key);
    check('the blob round-trips a restart', Math.round(back.grip) === 71 && Math.round(back.heat) === 63,
      JSON.stringify(back));

    // A corrupt blob rebuilds from baselines rather than throwing.
    const saved = await getFlag('world', ledger.FLAG);
    await setFlag('world', ledger.FLAG, '{ not json at all');
    ledger._reset();
    let threw = false;
    try { await ledger.load(); } catch { threw = true; }
    check('a corrupt blob rebuilds instead of throwing', !threw);
    check('…and the rebuilt cell is at baseline', ledger.read(key).grip === ledger._test.BASELINE.grip,
      String(ledger.read(key).grip));

    // A blob from a future version is discarded, not misread — the cell key
    // changes if the districts are ever painted.
    await setFlag('world', ledger.FLAG, JSON.stringify({ v: 999, cells: { [key]: { g: 99, h: 99, p: 99, t: Date.now() } } }));
    ledger._reset();
    await ledger.load();
    check('a blob from another version is discarded', ledger.read(key).grip === ledger._test.BASELINE.grip,
      String(ledger.read(key).grip));

    await setFlag('world', ledger.FLAG, saved || '');
    ledger._reset();
    await ledger.load();
  }

  // ── Clamping and the scalar guard ─────────────────────────────────────────
  {
    ledger.force(key, { grip: 100 });
    ledger.bump(key, 'grip', 500);
    // ⚠ NOT `=== 100`. `rowFor` runs `decayed()` on EVERY access, `read` included, so
    // the value comes back 100 minus however many milliseconds elapsed since the bump
    // — 99.99999422377368 on a slow run. That is the ledger working; asserting exact
    // equality made the test a race that only passed when the two calls landed inside
    // the same millisecond, and it blocked a push on 2026-08-30 having been latent
    // since the ledger shipped.
    //
    // The invariant is the one the name states: it did not exceed 100. The lower bound
    // is what still proves the CLAMP happened rather than the raw 600 being stored.
    const clamped = ledger.read(key).grip;
    check("a scalar can't exceed 100", clamped <= 100 && clamped > 99, String(clamped));
    ledger.bump(key, 'grip', -9999);
    // ⚠ SAME RACE, and it was left here when the upper bound above was fixed. Grip
    // decays toward a baseline of 10, so a value clamped to 0 starts climbing back
    // the moment a millisecond passes and `=== 0` only holds when the bump and the
    // read land inside the same one. It failed on 2026-09-02 at 6.4e-7. The invariant
    // is that the clamp happened rather than -9899 being stored.
    const floored = ledger.read(key).grip;
    check('…nor fall below 0', floored >= 0 && floored < 1, String(floored));
    let bad = false;
    try { ledger.bump(key, 'morale', 1); } catch { bad = true; }
    check('an unknown scalar throws rather than writing a stray field', bad);
  }

  // ── The band, which is all anything downstream ever sees ──────────────────
  {
    ledger.force(key, { grip: 0, heat: 0, pressure: 0 });
    check('a quiet cell reads quiet', ledger.bandOf(key) === 'quiet', ledger.bandOf(key));
    ledger.force(key, { grip: 100, heat: 100 });
    check('a hot cell reads flashpoint', ledger.bandOf(key) === 'flashpoint', ledger.bandOf(key));
    check('bandFor(zone) resolves through the block index',
      typeof ledger.bandOf(key) === 'string');
  }

  // ── The forcing tick, and why pressure exists ─────────────────────────────
  {
    // Hand-built roster: the tick never reads world state, so this is the whole
    // sim under test with no world involved.
    // ⚠ `reads: 'grip'` is load-bearing, not decoration: step() enlists an
    // insurgency on "writes heat AND reads grip", so a roster missing it produces
    // an empty insurgency list and heat that never moves — which is what this
    // assertion caught the first time it ran.
    const roster = [
      { id: 'x_authority', writes: 'grip', reads: 'heat', drift: null },
      { id: 'x_insurgency', writes: 'heat', reads: 'grip', drift: 'north' },
    ];
    // A clock-driven order writes heat too and must be ignored by the cycle.
    const driverOnly = [{ id: 'x_incursion', writes: 'heat', reads: 'clock', drift: 'east' }];
    for (const k of allBlocks()) ledger.force(k, { grip: 40, heat: 5, pressure: 0 });
    const before = ledger.read(key);
    for (let i = 0; i < 12; i++) ledger.step(roster);
    const after = ledger.read(key);

    check('grip under heat rises', after.grip >= before.grip, `${before.grip} -> ${after.grip}`);
    // The whole reason there are three scalars: pressure integrates grip, so a
    // cell being squeezed accumulates something the fast pair cannot decay away.
    check('pressure integrates grip over the run', after.pressure > before.pressure,
      `${before.pressure} -> ${after.pressure}`);

    // ── Ignition, and why the loop needs a negative term ─────────────────────
    // ⚠ THESE ARE THE CASES THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. The first
    // model had no negative term anywhere: grip drove pressure, pressure drove
    // heat, heat drove grip. Three positive couplings and a single fixed point, so
    // the tick could only ever converge to it — and it converged at band 10.7,
    // permanently quiet, in every cell, for ever. No value of any rate changed
    // that; turning them up slid the fixed point straight past every band to a
    // pinned flashpoint instead, with nothing in between. Ten of the fourteen
    // authored incidents were unreachable the whole time.
    //
    // A sim that cannot leave quiet and a sim that cannot return to it are both
    // green against every assertion that only ever looks at one step, which is why
    // the last pair below runs the clock.
    const { IGNITE_HI, IGNITE_LO, DRIFT_AT, RATE, HALF_LIFE_MIN, BASELINE: BASE } = ledger._test;
    const decayPerTick = (k) => 1 - Math.pow(0.5, 30 / HALF_LIFE_MIN[k]);

    check("a cell below the trigger doesn't ignite", after.heat === before.heat,
      `heat ${before.heat} -> ${after.heat} at pressure ${after.pressure.toFixed(1)}`);

    ledger.force(key, { grip: 40, heat: BASE.heat, pressure: IGNITE_HI + 1 });
    ledger.step(roster);
    const lit = ledger.read(key);
    check('crossing the trigger ignites the block', lit.heat > BASE.heat, `${lit.heat}`);

    // ⚠ The vent reads the heat the tick STARTED with, and the block was still
    // quiet when this one began — so the igniting tick charges like any other and
    // venting only starts on the next. Asserting the drop on the ignition tick
    // fails on correct behaviour, which is what the first draft of this did.
    ledger.step(roster);
    const venting = ledger.read(key);
    check('…and the burn then spends the grievance that caused it',
      venting.pressure < lit.pressure,
      `${lit.pressure.toFixed(1)} -> ${venting.pressure.toFixed(1)}`);

    // Hysteresis, not a bare threshold. A bare threshold self-limits AT the
    // trigger and settles there, which is the fixed point again wearing a fuse.
    // Just under the trigger: a bare threshold would go out here, hysteresis does
    // not. ⚠ Not the midpoint — one tick of venting from there lands within 0.05
    // of IGNITE_LO, so the case would pass or fail on rounding rather than on the
    // behaviour it names.
    ledger.force(key, { grip: 40, heat: 50, pressure: IGNITE_HI - 1 });
    ledger.step(roster);
    check('a lit block keeps burning between the two thresholds',
      ledger.read(key).heat > 50, `${ledger.read(key).heat}`);

    ledger.force(key, { grip: 40, heat: 50, pressure: IGNITE_LO - 1 });
    ledger.step(roster);
    check('…and goes out once the grievance is spent', ledger.read(key).heat === 50,
      `${ledger.read(key).heat}`);

    // ⚠ THE SILENT-DEATH INVARIANT. Pressure approaches
    // `restingGrip * RATE.pressure / decayPerTick`, and the resting grip is
    // baseline plus what baseline heat keeps pushing into it — NOT baseline. Put
    // the trigger above that ceiling and no cell ignites, the city is dead, and
    // every other case on this page still passes. Derived from the rates rather
    // than hardcoded, so retuning either knob re-checks it.
    const restingGrip = BASE.grip + (BASE.heat * RATE.authority * 0.1) / decayPerTick('grip');
    const ceiling = restingGrip * RATE.pressure / decayPerTick('pressure');
    check('the trigger sits below the grievance ceiling it waits on',
      IGNITE_HI < ceiling, `IGNITE_HI ${IGNITE_HI} vs ceiling ${ceiling.toFixed(1)}`);

    // The same shape one level down: a drift threshold above the heat a burn
    // actually reaches is a branch nothing can ever enter.
    const burnHeat = BASE.heat + RATE.burn / decayPerTick('heat');
    check('a burn gets hot enough to reach the drift threshold', DRIFT_AT < burnHeat,
      `DRIFT_AT ${DRIFT_AT} vs sustained burn ${burnHeat.toFixed(1)}`);

    // ── The cycle itself, with the clock running ─────────────────────────────
    // ⚠ Every other case here steps in a tight loop, where no wall-clock time
    // passes and so nothing decays. Decay is half of this sim, so the cycle can
    // only be tested by advancing time. Date.now is stubbed for the length of one
    // synchronous run and restored in a finally; nothing inside it awaits.
    const realNow = Date.now;
    let rose = false, returned = false, ticks = 0;
    try {
      let clock = realNow();
      Date.now = () => clock;
      for (const k of allBlocks()) ledger.force(k, { ...BASE });
      for (; ticks < 48 * 30 && !returned; ticks++) {
        clock += 30 * 60000;
        ledger.step(roster);
        const b = ledger.bandOf(key);
        if (b === 'tense' || b === 'flashpoint') rose = true;
        else if (rose && b === 'quiet') returned = true;
      }
    } finally { Date.now = realNow; }
    check('the sim leaves quiet on its own', rose,
      `still quiet after ${ticks} ticks (${(ticks / 48).toFixed(1)} days)`);
    check('…and comes back down on its own', returned,
      `never returned to quiet within ${(ticks / 48).toFixed(1)} days`);

    // A withdrawn order writes nothing at all — "not in this fight" as data.
    for (const k of allBlocks()) ledger.force(k, { grip: 30, heat: 30, pressure: 0 });
    const quiet = ledger.read(key);
    ledger.step([{ id: 'x_withdrawn', writes: 'none', drift: null }]);
    const stillQuiet = ledger.read(key);
    check("a withdrawn order moves no scalar it doesn't own",
      stillQuiet.grip === quiet.grip && stillQuiet.heat === quiet.heat,
      `${JSON.stringify(quiet)} -> ${JSON.stringify(stillQuiet)}`);

    // ⚠ The Wildblood shape: writes heat, reads a clock. It must move NOTHING
    // here, because an incursion is a burst fired INTO the ledger from outside
    // rather than a participant in its cycle. Collapsing that back to "writes
    // heat" would quietly give the ledger a second resident insurgency.
    for (const k of allBlocks()) ledger.force(k, { grip: 50, heat: 20, pressure: 0 });
    const preDriver = ledger.read(key);
    ledger.step(driverOnly);
    const postDriver = ledger.read(key);
    check('a clock-driven order adds no heat to the cycle',
      postDriver.heat === preDriver.heat,
      `${preDriver.heat} -> ${postDriver.heat}`);

    ledger._reset();
    await ledger.load();
  }

  // ══ 1b — perceivability ═══════════════════════════════════════════════════
  // What goes wrong invisibly here is not the prose. It is the plumbing: a beat
  // that fires per delta rather than per crossing, an ambient hook that answers
  // at baseline and so silently outranks district-ambience on every tick, and a
  // signal record that never fills, which would make rule 1 vacuous the moment
  // 1c starts asking it.
  {
    const voice = await import('./voice.js');
    const pool = await import('../gossip/pool.js');
    const { setBroadcast, getBroadcast } = await import('../../server/engine/messaging.js');
    const signals = _test.signals;

    signals._reset();
    for (const k of allBlocks()) ledger.force(k, { grip: 0, heat: 0, pressure: 0 });

    // ── Rule 3: never a name ─────────────────────────────────────────────────
    // A part of town is given by ORIENTATION. A named district invites a mental
    // map with a status per name, which is one step from the readout rule 2 bans.
    // ⚠ Names built ENTIRELY out of ordinary English are skipped, and that is not
    // a loophole — it is the only way the check means anything. There is a zone
    // called "The Wall", and "at the walls again" is a sentence about walls. The
    // test is for "Bodega Vu" and "Ironside Street" leaking into a line, so a name
    // qualifies only if it carries at least one word that is not street furniture.
    const GENERIC = new Set(['the', 'a', 'an', 'of', 'and', 'old', 'new', 'wall', 'walls',
      'street', 'road', 'alley', 'lane', 'park', 'gate', 'water', 'corner', 'end', 'ends',
      'side', 'room', 'hall', 'door', 'house', 'shop', 'bar', 'lot', 'yard', 'path',
      'bridge', 'tower', 'block', 'floor', 'stairs', 'entrance', 'north', 'south',
      'east', 'west', 'middle', 'town', 'city']);
    const placeNames = new Set();
    for (const z of world.zones.values()) {
      for (const n of [z.name, z.flags?.building_name, z.flags?.district]) {
        if (typeof n !== 'string' || n.length < 6) continue;
        const words = n.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
        if (words.some(w => !GENERIC.has(w))) placeNames.add(n.toLowerCase());
      }
    }
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let named = null;
    for (const k of allBlocks()) {
      for (const writes of ['grip', 'heat']) {
        for (const band of ['watchful', 'tense', 'flashpoint']) {
          const lines = [voice.streetLine(k, writes), voice.wireLine(k, writes),
            voice.ambientLine(band, writes), voice.crossingLine(band), voice.quarterOf(k)];
          for (const line of lines) {
            if (!line) continue;
            const low = line.toLowerCase();
            for (const n of placeNames) {
              if (new RegExp(`\\b${esc(n)}\\b`).test(low)) { named = `${n} in "${line}"`; break; }
            }
            if (named) break;
          }
          if (named) break;
        }
        if (named) break;
      }
      if (named) break;
    }
    check('no signal line names a place', !named, named || '');

    // ── Rule 7: the split is in the punctuation ─────────────────────────────
    // The wire carries the Ascendant version and the street carries the street
    // version; they contradict each other and nothing reconciles them. Per house
    // style the em dash is the Ascendant voice tell, so it belongs to exactly one
    // of the two and the faction split is readable before a word of it is.
    const aCell = allBlocks()[0];
    let streetDash = false, wireDash = 0, wireTotal = 0;
    for (let i = 0; i < 60; i++) {
      for (const w of ['grip', 'heat']) {
        if ((voice.streetLine(aCell, w) || '').includes('—')) streetDash = true;
        const wl = voice.wireLine(aCell, w) || '';
        wireTotal++;
        if (wl.includes('—')) wireDash++;
      }
    }
    check('the street never takes an em dash', !streetDash);
    check('the wire always does', wireDash === wireTotal, `${wireDash}/${wireTotal}`);

    // ── The ambient hook ─────────────────────────────────────────────────────
    // ⚠ HARD ABSTENTION AT BASELINE. fireHook keeps the LAST non-undefined result
    // and 'unrest' sorts after 'district-ambience', so an answer at baseline would
    // silently delete the district signature layer from every quiet street in the
    // game — which is all of them, most of the time.
    const aZone = signals.anchorZone(aCell);
    const zoneObj = world.zones.get(aZone);
    ledger.force(aCell, { grip: 0, heat: 0, pressure: 0 });
    let spokeAtBaseline = false;
    for (let i = 0; i < 400; i++) if (signals.describeAmbient(zoneObj) !== undefined) spokeAtBaseline = true;
    check('the ambient hook abstains at baseline', !spokeAtBaseline, ledger.bandOf(aCell));

    check("…and abstains on a zone the sim doesn't cover",
      signals.describeAmbient({ id: 'zone_does_not_exist' }) === undefined);

    ledger.force(aCell, { grip: 100, heat: 100, pressure: 0 });
    let spokeHot = 0;
    for (let i = 0; i < 400; i++) if (signals.describeAmbient(zoneObj) !== undefined) spokeHot++;
    check('…and does speak at a flashpoint', spokeHot > 0, `${spokeHot}/400`);
    // Deliberately a minority of ticks even at the top band: the neighbourhood's
    // own signature is the thing this layer sits on top of, not a replacement.
    check('…on a minority of ticks even then', spokeHot < 260, `${spokeHot}/400`);

    // ── The signal record rule 1 reads ───────────────────────────────────────
    signals._reset();
    check('a cell with no signal answers no', !signals.hadSignal(aCell, 'heat'));
    signals.noteSignal(aCell, 'heat');
    check('…and answers yes once one lands', signals.hadSignal(aCell, 'heat'));
    check('…for that order only', !signals.hadSignal(aCell, 'grip'));
    check('…and stops answering past the window',
      !signals.hadSignal(aCell, 'heat', 1000, Date.now() + 5000));
    check('the ambient line counts as a perceivable signal', (() => {
      signals._reset();
      ledger.force(aCell, { grip: 100, heat: 100 });
      for (let i = 0; i < 400 && !signals.hadSignal(aCell, 'heat'); i++) signals.describeAmbient(zoneObj);
      return signals.hadSignal(aCell, 'heat');
    })());

    // ── Attribution ─────────────────────────────────────────────────────────
    // Whose mood it is decides which order a 1c incident may answer, so getting
    // this backwards would let the authority stage against its own sweep.
    ledger.force(aCell, { grip: 90, heat: 5, pressure: 0 });
    check('a squeezed cell belongs to the authority', signals.dominantWrites(aCell) === 'grip');
    ledger.force(aCell, { grip: 5, heat: 90, pressure: 0 });
    check('a loud cell belongs to the insurgency', signals.dominantWrites(aCell) === 'heat');

    // ── The sweep ───────────────────────────────────────────────────────────
    signals._reset();
    for (const k of allBlocks()) ledger.force(k, { grip: 100, heat: 100, pressure: 0 });
    // ⚠ The first call PRIMES and fires nothing. Band memory is RAM only, so
    // after a restart every non-quiet cell looks like a fresh crossing and a
    // deploy would announce the entire city in one go.
    const firstSweep = await signals.sweep();
    check('the first sweep primes and announces nothing', firstSweep.length === 0, String(firstSweep.length));

    ledger.force(aCell, { grip: 0, heat: 0, pressure: 0 });
    const second = await signals.sweep();
    check('a band crossing is reported once', second.filter(c => c.key === aCell).length === 1,
      JSON.stringify(second.map(c => c.key)));
    const third = await signals.sweep();
    check('…and not again while the band holds', third.length === 0, JSON.stringify(third));

    // Per DELTA it would fire on every tick, because the scalars move on every
    // tick. Per CROSSING it fires when the mood changes, which is the thing a
    // player could notice.
    ledger.force(aCell, { grip: 2, heat: 2, pressure: 0 });
    check("a scalar move inside one band isn't a crossing",
      (await signals.sweep()).length === 0);

    // ── The two voices, and the cap ─────────────────────────────────────────
    const before = pool.all().filter(i => i.capGroup === 'unrest').length;
    for (const k of allBlocks()) {
      ledger.force(k, { grip: 90, heat: 90, pressure: 0 });
      await signals.speak(k, 'flashpoint', 'heat');
    }
    const unrestItems = pool.all().filter(i => i.capGroup === 'unrest');
    check('speaking fills the gossip pool', unrestItems.length > before, String(unrestItems.length));
    // ⚠ Ten cells all shouting is a city of nothing else. The cap is what keeps
    // an NPC's mouth mostly full of everything that is not this system.
    check('…but gossip respects its group cap', unrestItems.length <= 3, String(unrestItems.length));
    for (const i of unrestItems) pool.remove(i.id);

    // ── The crossing beat ───────────────────────────────────────────────────
    // ⚠ Fires on a real BLOCK change, never on a move. zone.entered fires on
    // every step, and most steps stay in the same block — including every step
    // through a shop door, since an interior inherits its facade's cell.
    const sent = [];
    const savedBroadcast = getBroadcast();
    setBroadcast((zoneId, message, exclude, target) => sent.push({ target, message }));
    try {
      signals._reset();
      for (const k of allBlocks()) ledger.force(k, { grip: 100, heat: 100, pressure: 0 });
      const info = blockInfo(aCell);
      const twoHere = info.zones.slice(0, 2);
      const other = allBlocks().find(k => k !== aCell);
      const there = blockInfo(other).zones[0];
      const actor = { id: 'regress_unrest_walker' };

      signals.onEntered({ actor, zone: twoHere[0] });
      const afterFirst = sent.length;
      check('walking into a hot block speaks once', afterFirst === 1, String(afterFirst));

      if (twoHere.length > 1) {
        signals.onEntered({ actor, zone: twoHere[1] });
        check('…and moving inside that block says nothing more', sent.length === afterFirst,
          String(sent.length));
      }

      // A cooldown, because a player pacing a boundary is not arriving anywhere.
      signals.onEntered({ actor, zone: there });
      check('crossing again inside the cooldown stays quiet', sent.length === afterFirst,
        String(sent.length));

      // Quiet ground never gets a beat at all.
      signals._reset();
      sent.length = 0;
      for (const k of allBlocks()) ledger.force(k, { grip: 0, heat: 0, pressure: 0 });
      signals.onEntered({ actor: { id: 'regress_unrest_walker2' }, zone: twoHere[0] });
      check('a quiet block says nothing', sent.length === 0, String(sent.length));

      // A zone off the index (a void crossing, an interior with no facade) must
      // not throw and must not speak.
      let blew = false;
      try { signals.onEntered({ actor, zone: 'zone_not_in_the_index' }); } catch { blew = true; }
      check('an unindexed zone is a no-op, not a throw', !blew && sent.length === 0);
    } finally {
      setBroadcast(savedBroadcast);
      signals._reset();
    }

    for (const k of allBlocks()) ledger.force(k, { ...ledger.BASELINE });
    ledger._reset();
    await ledger.load();
  }

  // ══ 1c — incidents ════════════════════════════════════════════════════════
  // The two things that go wrong here are both invisible from the outside: an
  // incident that stages with nothing to attribute it to (which reads as spawn
  // noise and undoes the whole point), and a teardown that does not put back
  // everything it took, which leaves permanent world state nobody authored.
  {
    const incidents = _test.incidents;
    const signals = _test.signals;
    const stageMod = await import('./stage.js');
    const pool = await import('../gossip/pool.js');
    const graffiti = await import('../graffiti/index.js');
    const { query } = await import('../../server/models/db.js');
    const { on, off } = await import('../../server/engine/events.js');
    const { setBroadcast, getBroadcast } = await import('../../server/engine/messaging.js');
    const { dispatchAction } = await import('../../server/engine/actions.js');

    await _test.ensureLoaded();
    await incidents._reset();
    stageMod._reset();
    signals._reset();

    const cat = incidents.getCatalogue();
    check('the incident catalogue loads', cat.length > 0, String(cat.length));

    // ⚠ An authored key that nothing reads is the failure mode that hid inside
    // `mutations.effects` for months. Every `do` in every authored incident must
    // name a registered step, or the row is prose pretending to be behaviour.
    const known = new Set(incidents.stepNames());
    const orphans = [];
    for (const def of cat) {
      for (const step of def.stage) if (!known.has(step.do)) orphans.push(`${def.id}:${step.do}`);
    }
    check('every authored stage step is registered', orphans.length === 0, orphans.join(' '));
    check('both orders have something to stage',
      cat.some(d => d.writes === 'grip') && cat.some(d => d.writes === 'heat'));

    const cell = allBlocks()[0];
    const def = cat.find(d => d.writes === 'heat' && d.minBand === 'watchful');

    // ── RULE 1: signal before effect ────────────────────────────────────────
    for (const k of allBlocks()) ledger.force(k, { grip: 100, heat: 100, pressure: 0 });
    signals._reset();
    check("an incident can't stage with no signal in the cell",
      incidents.eligible(def, cell) === 'signal', String(incidents.eligible(def, cell)));
    // ⚠ SAME ORDER. A cell whose mood belongs to the authority may not host an
    // insurgency incident, which is what makes every staging attributable to
    // somebody rather than to the weather.
    signals.noteSignal(cell, def.writes === 'heat' ? 'grip' : 'heat');
    check('…nor on a signal from the other order',
      incidents.eligible(def, cell) === 'signal', String(incidents.eligible(def, cell)));
    signals.noteSignal(cell, def.writes);
    check('…and may once its own order has said something',
      incidents.eligible(def, cell) === null, String(incidents.eligible(def, cell)));
    // The window closes.
    check('…but not on a signal from last week',
      incidents.eligible(def, cell, Date.now() + signals.SIGNAL_WINDOW_MS + 1000) === 'signal');

    // ── Staging, the audit row, and the event ───────────────────────────────
    const staged = [];
    const onStaged = (p) => staged.push(p);
    on('unrest.incident.staged', onStaged);
    const evBefore = (await query(`SELECT COUNT(*)::int AS n FROM world_events WHERE event_type = 'unrest.incident'`)).rows[0].n;

    const poolBefore = pool.all().length;
    const inc = await incidents.stage(def, cell);
    check('staging returns a live instance', !!inc?.instanceId, String(inc?.instanceId));

    const evAfter = (await query(`SELECT COUNT(*)::int AS n FROM world_events WHERE event_type = 'unrest.incident'`)).rows[0].n;
    // ⚠ world_events is the AUDIT LOG, not the ledger. Exactly one row, or an
    // operator reconstructing a night is reading a different night.
    check('exactly one world_events row per staging', evAfter - evBefore === 1, `${evBefore} -> ${evAfter}`);

    check('the staged event fires once', staged.length === 1, String(staged.length));
    // ⚠ script-triggers normalises the zone as payload.zone ?? payload.zoneId, so
    // the field has to be named one of those or an authored trigger row filtering
    // on zone_id silently never matches anything.
    check('…carrying a real zone id under the name script-triggers reads',
      typeof staged[0]?.zone === 'string' && world.zones.has(staged[0].zone), String(staged[0]?.zone));
    {
      const src = await import('node:fs').then(fs => fs.readFileSync('server/engine/script-triggers.js', 'utf8'));
      check('…and script-triggers really does read that field',
        /payload\??\.zone\s*\?\?\s*payload\??\.zoneId/.test(src));
    }
    off('unrest.incident.staged', onStaged);

    check('the cell is now occupied', incidents.eligible(def, cell) === 'occupied',
      String(incidents.eligible(def, cell)));

    // ── Teardown restores what it took ──────────────────────────────────────
    const hadOverride = !!signals.ambientOverrideAt(cell);
    check('a staged ambient override is live', hadOverride);
    const tagZone = signals.anchorZone(cell);
    const hadTag = !!graffiti.tagAt(tagZone);

    await incidents.teardown(inc.instanceId);
    check('teardown clears the ambient override', !signals.ambientOverrideAt(cell));
    check('teardown returns the gossip pool to its prior size',
      pool.all().length === poolBefore, `${poolBefore} -> ${pool.all().length}`);
    if (hadTag) check('teardown scrubs the wall', !graffiti.tagAt(tagZone));
    check('teardown removes the live instance', incidents.liveIncidents().length === 0);
    // ⚠ …but the cooldown SURVIVES teardown. Otherwise tearing an incident down
    // is how you get the same one back on the very next tick.
    check('the cooldown outlives the teardown', incidents.eligible(def, cell) === 'cooldown',
      String(incidents.eligible(def, cell)));

    await query(`DELETE FROM world_events WHERE id = $1`, [`we_${inc.instanceId}`]).catch(() => {});

    // ── The cap, under a storm ──────────────────────────────────────────────
    await incidents._reset();
    signals._reset();
    for (const k of allBlocks()) {
      ledger.force(k, { grip: 100, heat: 100, pressure: 0 });
      signals.noteSignal(k, 'heat');
      signals.noteSignal(k, 'grip');
    }
    // ⚠ The lockdown definition is held OUT of the storm on purpose. Its step
    // activates the real citywide ESP, and a storm that fires it leaves every NPC
    // in the game sheltering for whatever suite runs next — the shared-state trap
    // that has broken unrelated suites before. It gets its own guarded test below.
    const fullCat = incidents.getCatalogue();
    incidents._test.setCatalogue(fullCat.filter(d => !d.stage.some(s => s.do === 'esp')));
    const capIds = [];
    for (let i = 0; i < 12; i++) {
      const r = await incidents.tick();
      if (r) capIds.push(r.instanceId);
    }
    check('a tick stages at most one incident', capIds.length <= 12);
    // ⚠ Citywide, not per cell. Ten simultaneous incidents over ten blocks is a
    // city where the sim is the only thing happening.
    check('the cap holds under a forced storm',
      incidents.liveIncidents().length <= incidents.MAX_LIVE,
      `${incidents.liveIncidents().length}/${incidents.MAX_LIVE}`);
    const cells = new Set(incidents.liveIncidents().map(i => i.key));
    check('…and never two in one cell', cells.size === incidents.liveIncidents().length);

    await incidents._reset();
    incidents._test.setCatalogue(fullCat);
    for (const id of capIds) await query(`DELETE FROM world_events WHERE id = $1`, [`we_${id}`]).catch(() => {});

    // ══ 1d — danger ═══════════════════════════════════════════════════════════
    // Every assertion here is about something that outlives what put it there:
    // a mob nobody tore down, a gate that persisted, a lockdown two incidents
    // both think they own.
    {
      const sounds = [];
      const savedBroadcast = getBroadcast();
      setBroadcast((zoneId, message) => sounds.push({ zoneId, message }));
      try {
        signals._reset();
        for (const k of allBlocks()) {
          ledger.force(k, { grip: 100, heat: 100, pressure: 0 });
          signals.noteSignal(k, 'heat');
          signals.noteSignal(k, 'grip');
        }

        // ── hostile ─────────────────────────────────────────────────────────
        const fightDef = incidents.getCatalogue().find(d => d.stage.some(s => s.do === 'hostile'));
        check('an incident stages real hostiles', !!fightDef, String(fightDef?.id));
        if (fightDef) {
          const enemiesBefore = world.enemies.size;
          sounds.length = 0;
          const hostileCell = allBlocks().find(k => neighboursOf(k).length > 0) || allBlocks()[0];
          const live = await incidents.stage(fightDef, hostileCell);
          const spawned = world.enemies.size - enemiesBefore;
          check('…and they actually exist', spawned > 0, String(spawned));

          // ⚠ RULE 5. Danger must be audible from the tile you are standing on.
          // The warning is inside the hostile step, before the first spawn, so an
          // author cannot forget it — there is nowhere to forget it from.
          check('nothing hostile stages without a warning first',
            stageMod.warnedAt(hostileCell) != null && stageMod.warnedAt(hostileCell) <= Date.now());
          check('…and the warning reached more than the tile it landed on',
            new Set(sounds.map(s => s.zoneId)).size > 1, String(new Set(sounds.map(s => s.zoneId)).size));

          await incidents.teardown(live.instanceId);
          // ⚠ A leaked mob is a permanent hostile nobody authored, standing on a
          // street that has been quiet for a week.
          check('every spawned instance comes back down on teardown',
            world.enemies.size === enemiesBefore, `${enemiesBefore} -> ${world.enemies.size}`);
          const orphanZones = [...world.zones.values()].filter(z =>
            [...(z.enemies || [])].some(id => !world.enemies.has(id)));
          check('…and no zone is left holding a dead instance id', orphanZones.length === 0,
            orphanZones.map(z => z.id).join(','));
          await query(`DELETE FROM world_events WHERE id = $1`, [`we_${live.instanceId}`]).catch(() => {});
        }

        // ── checkpoint ──────────────────────────────────────────────────────
        const cordonDef = incidents.getCatalogue().find(d => d.stage.some(s => s.do === 'checkpoint'));
        check('an incident stages a real checkpoint', !!cordonDef, String(cordonDef?.id));
        if (cordonDef) {
          const cKey = allBlocks().find(k => !incidents.liveIncidents().some(i => i.key === k));
          const live = await incidents.stage(cordonDef, cKey);
          const gated = blockInfo(cKey).zones
            .map(id => world.zones.get(id)).filter(z => z?.flags?.checkpoint_cfg);
          check('the gate is on a street in the cell', gated.length >= 1, String(gated.length));
          const gateZone = gated[0];

          // ⚠ RAM ONLY. world.zones is never written back, so a restart is what
          // takes this down — which is rule 6 holding without anybody having to
          // remember it. A checkpoint_cfg that reached the zones table would be a
          // permanent gate nobody authored.
          const persisted = await query(
            `SELECT flags -> 'checkpoint_cfg' AS cfg FROM zones WHERE id = $1`, [gateZone.id]);
          check('…and nothing about it reached the database',
            persisted.rows[0]?.cfg == null, JSON.stringify(persisted.rows[0]?.cfg));

          await incidents.teardown(live.instanceId);
          check('teardown takes the gate off the street', !gateZone.flags.checkpoint_cfg);
          await query(`DELETE FROM world_events WHERE id = $1`, [`we_${live.instanceId}`]).catch(() => {});
        }

        // ── ESP ─────────────────────────────────────────────────────────────
        // ⚠ THE ESP IS A SINGLETON in plugins/emergency: one module-level boolean
        // beside one zone set. Two incidents cannot each own a lockdown, so
        // exactly one may hold it and the second declines rather than joining.
        const a1 = await dispatchAction({ type: 'ESP_ACTIVATE', params: { message: 'regress' } });
        const a2 = await dispatchAction({ type: 'ESP_ACTIVATE', params: { message: 'regress' } });
        check('ESP_ACTIVATE is idempotent under double dispatch',
          a1?.activated === true && a2?.activated === false, `${a1?.activated}/${a2?.activated}`);
        const d1 = await dispatchAction({ type: 'ESP_DEACTIVATE' });
        const d2 = await dispatchAction({ type: 'ESP_DEACTIVATE' });
        check('…and so is ESP_DEACTIVATE',
          d1?.deactivated === true && d2?.deactivated === false, `${d1?.deactivated}/${d2?.deactivated}`);

        const espStep = incidents._test.STEPS.get('esp');
        const ctxA = { key: allBlocks()[0], zone: signals.anchorZone(allBlocks()[0]), defId: 'x_a', writes: 'grip' };
        const ctxB = { key: allBlocks()[1] || allBlocks()[0], zone: signals.anchorZone(allBlocks()[1] || allBlocks()[0]), defId: 'x_b', writes: 'grip' };
        const undoA = await espStep(ctxA, {});
        const undoB = await espStep(ctxB, {});
        check('only one incident may hold the lockdown',
          typeof undoA === 'function' && undoB === null, `${typeof undoA}/${undoB}`);
        check('…and it knows which one', stageMod.espHeldBy() != null);
        if (typeof undoA === 'function') await undoA();
        check('…and lets go on teardown', stageMod.espHeldBy() === null);
      } finally {
        // Never leave the world in lockdown for the suites that come after.
        await dispatchAction({ type: 'ESP_DEACTIVATE' }).catch(() => {});
        setBroadcast(savedBroadcast);
        stageMod._reset();
      }
    }

    await incidents._reset();
    signals._reset();
    for (const k of allBlocks()) ledger.force(k, { ...ledger.BASELINE });
    ledger._reset();
    await ledger.load();
  }

  // ── Phase 2: favours ──────────────────────────────────────────────────────
  {
    const { evalCondition } = await import('../../server/engine/flags.js');
    const incidents = _test.incidents;
    const p = getPlayer();
    const savedZone = p.current_zone;
    const anyZone = [...world.zones.values()].find((z) => z.grid_x != null && blockOf(z.id));
    try {
      await incidents._reset();
      p.current_zone = anyZone.id;
      const cell = blockOf(anyZone.id);

      // ⚠ RULE 3. A favour cannot be turned in for an incident that is over, and
      // the gate is a LIVE lookup rather than a flag set at staging time because an
      // instanceId does not survive a restart — anything remembered about a
      // specific staging is a thing that can outlive it.
      const cold = await evalCondition({ unrest_incident: 'here' }, p, {});
      check('favour: no live incident, no favour', cold === false, String(cold));

      // Stage one by hand into the live map — the selector's own eligibility rules
      // are phase 1's business and are tested above.
      incidents._test.live.set('inc_regress_1', {
        instanceId: 'inc_regress_1', defId: 'inc_regress_def', name: 'Regress Incident',
        key: cell, zone: anyZone.id, writes: 'ideology_ascendants', band: 'hot',
        startedAt: Date.now(), endsAt: Date.now() + 600000, undo: [],
      });

      check('favour: a live incident here opens the favour',
        (await evalCondition({ unrest_incident: 'here' }, p, {})) === true);
      check('favour: …and content can name the order that staged it',
        (await evalCondition({ unrest_incident: 'here', writes: 'ideology_ascendants' }, p, {})) === true);
      check("favour: …and a different order doesn't match",
        (await evalCondition({ unrest_incident: 'here', writes: 'ideology_long_watch' }, p, {})) === false);

      // A typo must hide the favour, never offer it everywhere — the same direction
      // every other condition shape fails.
      check('favour: an unknown scope fails closed',
        (await evalCondition({ unrest_incident: 'everywhere-ish' }, p, {})) === false);

      // Ending it closes the turn-in, which is rule 3 stated as a test.
      incidents._test.live.delete('inc_regress_1');
      check('favour: a resolved incident can no longer be turned in',
        (await evalCondition({ unrest_incident: 'here' }, p, {})) === false);
    } finally {
      p.current_zone = savedZone;
      await incidents._reset();
    }

    // ⚠ RULE 1. The sim never moves ideology standing implicitly: rep moves only
    // through an authored ADJUST_REPUTATION on a turn-in. If this plugin ever grows
    // its own reputation call, the ledger becomes an invisible alignment tracker —
    // exactly the thing drugwar's header records being removed once already.
    const { readFileSync, readdirSync } = await import('node:fs');
    const src = readdirSync('plugins/unrest')
      .filter((f) => f.endsWith('.js') && f !== 'regress.js')
      .map((f) => readFileSync(`plugins/unrest/${f}`, 'utf8')).join('\n');
    check('favour: the plugin never moves rep itself',
      !/\badjustReputation\s*\(/.test(src), 'an adjustReputation caller appeared in plugins/unrest');

    // ⚠ RULE 2. A favour is a job you can do again, never a rung. A repeatable
    // quest that writes an <order>_arc flag turns in a second time and writes an
    // OLDER arc number over a newer one, walking the player backwards.
    const arcFlag = /_arc$/;
    let offenders = [];
    for (const f of readdirSync('content/quests')) {
      if (!f.endsWith('.json')) continue;
      const q = JSON.parse(readFileSync(`content/quests/${f}`, 'utf8'));
      if (!q.repeatable) continue;
      const flags = q.rewards?.flags || {};
      for (const k of Object.keys(flags)) if (arcFlag.test(k)) offenders.push(`${q.id}:${k}`);
    }
    check('favour: no repeatable quest writes an arc flag', offenders.length === 0, offenders.join(', '));
  }

  // ── Phase 3: the Null and the Wildblood ───────────────────────────────────
  //
  // Phases 1 and 2 had ONE eligibility rule, and it is correct for exactly the
  // two orders that fight over ground. The two added here do not, and each of
  // them breaks the rule in a different direction: the Null want a cell phase 1
  // would refuse for being quiet, and the Wildblood want no local precondition at
  // all. So the gate became a registry, and these are the cases that pin the
  // three ways that goes silently wrong — a vendetta that quietly needs heat
  // after all, an incursion whose target moves at midnight, and an order that
  // opted out of the fight staging anyway because 'none' is a truthy string.
  {
    const roleMod = await import('./roles.js');
    const incidents = _test.incidents;
    const signals = _test.signals;
    const { readdirSync, readFileSync } = await import('node:fs');
    const { eligible } = incidents;

    await _test.ensureLoaded();
    await incidents._reset();
    signals._reset();

    const mk = (id, writes, driver) => ({
      id, name: id, writes, minBand: 'flashpoint', weight: 10,
      durationMin: 10, cooldownMin: 10, stage: [], flags: driver ? { driver } : {},
    });
    // ⚠ minBand 'flashpoint' on every one of these, deliberately. It is the
    // strictest band there is, and both phase-3 drivers must clear it on a quiet
    // cell — if either ever starts consulting the band again, these go red.
    const vendetta = mk('x_vendetta', 'assets', 'vendetta');
    const incursion = mk('x_incursion', 'heat', 'incursion');
    const withdrawn = mk('x_withdrawn', 'none', null);

    const cells = allBlocks();
    const cell = cells[0];

    // ── The registry itself ──────────────────────────────────────────────────
    check('phase 3: the default driver is still phase 1',
      roleMod.driverNameFor(mk('x_plain', 'heat', null)) === 'ground');
    check('phase 3: an unknown authored driver falls back rather than throwing',
      roleMod.driverNameFor(mk('x_typo', 'heat', 'vendettta')) === 'ground');

    // ⚠ Both directions of the orphan-key rule. An authored driver nothing
    // registers is prose pretending to be behaviour; a registered driver nothing
    // authors is code pretending to be a feature, which is how the mutations
    // effects vocabulary sat unread for months.
    const known = new Set(roleMod.driverNames());
    const authored = new Map();
    const badDrivers = [];
    for (const f of readdirSync('content/incidents')) {
      if (!f.endsWith('.json')) continue;
      const d = JSON.parse(readFileSync('content/incidents/' + f, 'utf8'));
      const name = d.flags?.driver;
      if (!name) continue;
      if (!known.has(name)) badDrivers.push(d.id + ':' + name);
      authored.set(name, (authored.get(name) || 0) + 1);
    }
    check('phase 3: every authored driver is registered', badDrivers.length === 0, badDrivers.join(' '));
    check('phase 3: the vendetta driver has incidents to run', (authored.get('vendetta') || 0) > 0);
    check('phase 3: the incursion driver has incidents to run', (authored.get('incursion') || 0) > 0);

    // ── WITHDRAWN NEVER STAGES ANYTHING ──────────────────────────────────────
    // ⚠ 'none' is a truthy string, so an order that opted out sails through every
    // filter that merely tests for a role at all. The Exodus are not in this
    // fight and nothing attributed to them may ever appear on a street.
    check("withdrawn: an order that isn't in the fight stages nothing",
      eligible(withdrawn, cell) === 'withdrawn', String(eligible(withdrawn, cell)));
    const exodus = roleMod.roles().find(r => r.id === 'ideology_exodus');
    check('withdrawn: …and the Exodus are authored that way', exodus?.writes === 'none', JSON.stringify(exodus));

    // ── VENDETTA: grip, regardless of heat ───────────────────────────────────
    // The Null do not want the block. They want what is bolted to it, so their
    // target is the street the authority has already finished pacifying — the one
    // with the most licensed hardware on it and nobody left outside to watch it
    // stop working. Phase 1's gate would refuse that cell for being quiet.
    signals._reset();
    // grip 40 with no heat is band t=20, i.e. QUIET, and still well over
    // VENDETTA_GRIP. Above grip 50 the band alone would carry the cell into
    // watchful and the test would stop proving the thing it is here to prove.
    ledger.force(cell, { grip: 40, heat: 0, pressure: 0 });
    check('vendetta: a heavily held cell can read completely quiet',
      ledger.bandOf(cell) === 'quiet', ledger.bandOf(cell));
    check('vendetta: …and refuses with no signal at all',
      eligible(vendetta, cell) === 'signal', String(eligible(vendetta, cell)));

    // ⚠ RULE 1 STILL HOLDS, POINTED AT SOMEBODY ELSE. The Null have no street
    // voice and want none, so the signal they answer is the AUTHORITY'S. Asking
    // for a signal from 'assets' would make them announce themselves first.
    signals.noteSignal(cell, 'heat');
    check("vendetta: …and the insurgency talking isn't the signal it answers",
      eligible(vendetta, cell) === 'signal', String(eligible(vendetta, cell)));
    signals.noteSignal(cell, 'grip');
    check('vendetta: a quiet cell under a visible hand IS the target',
      eligible(vendetta, cell) === null, String(eligible(vendetta, cell)));

    // The other direction, which is the half that actually says "regardless of
    // heat": a cell that is going off but has never been squeezed is not a target.
    ledger.force(cell, { grip: 5, heat: 100, pressure: 0 });
    check('vendetta: …while a loud cell nobody is holding is not',
      eligible(vendetta, cell) === 'grip', String(eligible(vendetta, cell)));
    check("vendetta: …even though it's at flashpoint",
      ledger.bandOf(cell) === 'flashpoint', ledger.bandOf(cell));

    // ⚠ The Null are not fighting over the ground the ledger measures, so a
    // vendetta contributes nothing to it. A sim that scored one would be counting
    // the wrong thing entirely.
    check('vendetta: the Null put nothing into the ledger',
      roleMod.driverFor(vendetta).onStage === null);

    // ⚠ Roles are DATA. Take the Null out of content and their incidents stop
    // staging, rather than staging anonymously off a driver nobody backs.
    const nullOrg = world.orgs.get('ideology_null');
    try {
      world.orgs.delete('ideology_null');
      check('vendetta: no Null in content, no vendetta',
        eligible(vendetta, cell) === 'no-order', String(eligible(vendetta, cell)));
    } finally {
      if (nullOrg) world.orgs.set('ideology_null', nullOrg);
    }

    // ── INCURSION: the clock, and nothing else ───────────────────────────────
    // They are not a fifth participant in the city's argument. They arrive.
    const night = { date: '2087-03-05', minutes: 23 * 60 };
    const day = { date: '2087-03-05', minutes: 13 * 60 };
    const target = roleMod.nightTarget(night);
    check('incursion: the night has a way in', !!target && cells.includes(target), String(target));

    signals._reset();
    ledger.force(target, { ...ledger.BASELINE, pressure: 0 });
    check('incursion: the target cell is at baseline and silent',
      ledger.bandOf(target) === 'quiet', ledger.bandOf(target));
    // ⚠ NO LOCAL PRECONDITION OF ANY KIND. No band, no signal, no grip, no heat.
    // The moment one of those creeps back in, an incursion reads as the city's own
    // trouble coming to a head, which is the one thing it must never be.
    check('incursion: nothing local is required',
      eligible(incursion, target, Date.now(), night) === null,
      String(eligible(incursion, target, Date.now(), night)));
    check('incursion: …but the clock is',
      eligible(incursion, target, Date.now(), day) === 'clock',
      String(eligible(incursion, target, Date.now(), day)));
    const other = cells.find(k => k !== target);
    check("incursion: …and there's one way in per night, not ten",
      eligible(incursion, other, Date.now(), night) === 'elsewhere',
      String(eligible(incursion, other, Date.now(), night)));

    // ⚠ THE MIDNIGHT TRAP. A night spans midnight, so the small hours belong to
    // the night before. Key it on the calendar date and the way in moves at 00:00
    // — half a raid in one part of town and half in another, on the one system
    // whose entire promise is that it came from somewhere.
    check('incursion: the small hours belong to the night before',
      roleMod.nightOf({ date: '2087-03-06', minutes: 60 }) === roleMod.nightOf(night));
    check("incursion: …so the way in doesn't move during a night",
      roleMod.nightTarget({ date: '2087-03-06', minutes: 60 }) === target);
    check('incursion: …and tomorrow night is a different night',
      roleMod.nightOf({ date: '2087-03-06', minutes: 23 * 60 }) !== roleMod.nightOf(night));

    // An unbooted environment must read as "the window is shut", never as an
    // error and never as "open". This suite never boots the environment, so this
    // is also why no incursion can spawn a Thornwarren raid into another suite.
    check('incursion: no clock means no incursion',
      roleMod.readClock() === null && roleMod.nightOpen(null) === false);

    // ── THE BURST LEAVES NO BASELINE ─────────────────────────────────────────
    // Heat's half-life is twenty minutes, so the block is loud by morning and
    // back to exactly what it was by lunchtime. ⚠ Pressure is the scalar that
    // raises heat's OWN baseline over days: an incursion that moved it would make
    // the Wildblood a permanent tenant of a city they have no interest in holding.
    const before = ledger.read(target);
    roleMod.driverFor(incursion).onStage(incursion, target);
    const after = ledger.read(target);
    check('incursion: the burst goes into heat',
      after.heat >= before.heat + roleMod.INCURSION_BURST - 1,
      before.heat + ' -> ' + after.heat);
    check('incursion: …and never into pressure',
      after.pressure === before.pressure, before.pressure + ' -> ' + after.pressure);
    check('incursion: …and never into grip',
      after.grip === before.grip, before.grip + ' -> ' + after.grip);

    // Leave the ledger where the rest of the suite expects to find it.
    for (const k of cells) ledger.force(k, { ...ledger.BASELINE });
    signals._reset();
    await incidents._reset();
  }
}
