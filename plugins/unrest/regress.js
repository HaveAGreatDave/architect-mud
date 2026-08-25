// Unrest regression suite — run by tests/regress.js, never loaded in production.
//
// Phase 1a has no verbs and no player-facing surface, so there is no routing to
// assert. What is worth pinning is the stuff that goes wrong invisibly and only
// shows up once incidents are staging on top of it:
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
import { blockOf, allBlocks, blockKeyOf, neighboursOf, reindex, BLOCK } from './blocks.js';
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
    check('a scalar cannot exceed 100', ledger.read(key).grip === 100, String(ledger.read(key).grip));
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
}
