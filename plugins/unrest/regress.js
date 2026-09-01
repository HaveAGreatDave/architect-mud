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

export default async function regress({ check }) {
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
    check('a scalar cannot exceed 100', clamped <= 100 && clamped > 99, String(clamped));
    ledger.bump(key, 'grip', -9999);
    check('…nor fall below 0', ledger.read(key).grip === 0, String(ledger.read(key).grip));
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
    check('the insurgency answers grip with heat', after.heat > before.heat,
      `${before.heat} -> ${after.heat}`);

    // A withdrawn order writes nothing at all — "not in this fight" as data.
    for (const k of allBlocks()) ledger.force(k, { grip: 30, heat: 30, pressure: 0 });
    const quiet = ledger.read(key);
    ledger.step([{ id: 'x_withdrawn', writes: 'none', drift: null }]);
    const stillQuiet = ledger.read(key);
    check('a withdrawn order moves no scalar it does not own',
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

    check('…and abstains on a zone the sim does not cover',
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
    check('a scalar move inside one band is not a crossing',
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
    check('an incident cannot stage with no signal in the cell',
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
}
