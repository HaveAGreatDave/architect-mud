// plugins/augments/regress.js — never loaded in production, only by the harness.
//
// Covers routing, the clinic gate, the four engine seams (derived stats, soak,
// strain, respawn), and the maintenance model: the calibration migration
// invariant, the install bands, the tuning bounds, heat, death corruption and
// the two interlocks that corruption exposed.
import { query } from '../../server/models/db.js';
import { setFlag } from '../../server/engine/flags.js';
import { world } from '../../server/engine/world.js';
import { _test } from './index.js';
import {
  hydrateAugments, rosterOf, augScale, augmentStatBonus, catalog, loadAugments,
  BOTCHED_CALIBRATION_CAP,
} from './state.js';
import { bandFor, INSTALL_BANDS, DESTROY_MARGIN } from './install.js';
import { onStrain, heatOf, HEAT_COOL_PER_SEC, heatBand, CRITICAL } from './overclock.js';
import { survivalChance } from './death.js';
import { BOARD_SWING } from './tuning.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // ── Routing + clinic gate ──────────────────────────────────────────────────
  const list = await run('augments');
  check('augments lists', list?.type === 'augments', list?.type || 'no result');

  const bare = await run('augment');
  check('augment (bare) lists', bare?.type === 'augments', bare?.type || 'no result');

  const inst = await run('augment install dermal jack');
  check('install refused off-clinic',
    inst?.type === 'error' && /clinic/i.test(inst.message || ''), inst?.message || inst?.type);

  const rem = await run('augment remove dermal jack');
  check('remove refused off-clinic',
    rem?.type === 'error' && /clinic/i.test(rem.message || ''), rem?.message || rem?.type);

  const noarg = await run('augment install');
  check('install needs a name',
    noarg?.type === 'error' && /install what/i.test(noarg.message || ''), noarg?.message || noarg?.type);

  const rep = await run('augment repair nothing-at-all');
  check('repair off-clinic refused',
    rep?.type === 'error', rep?.message || rep?.type);

  const bk = await run('backup');
  check('backup refused off-registry',
    bk?.type === 'error' && /registry/i.test(bk.message || ''), bk?.message || bk?.type);

  const pol = await run('assurance');
  check('assurance refused off assurance desk',
    pol?.type === 'error' && /desk/i.test(pol.message || ''), pol?.message || pol?.type);

  // ── Catalog authoring guard ────────────────────────────────────────────────
  // A machine that can be pushed past spec MUST be able to say how it lets go.
  // This is the inverse of mutations' unconsumed-effect-key warning, and it is a
  // hard failure rather than a boot warning because the alternative is shipping
  // "Bionic malfunction." to a player.
  const cache = await catalog();
  const voiceless = Object.values(cache)
    .filter(a => Number(a.overclock_max) > 0 && !Object.keys(a.failure_messages || {}).length)
    .map(a => a.id);
  check('every overclockable augment authors failure_messages', voiceless.length === 0, voiceless.join(', '));

  // Every item_id / salvage_item_id must resolve, or a typo ships chrome nobody
  // can ever fit and nobody notices for weeks.
  const itemIds = [...new Set(Object.values(cache).flatMap(a => [a.item_id, a.salvage_item_id]).filter(Boolean))];
  if (itemIds.length) {
    const { rows } = await query('SELECT id FROM items WHERE id = ANY($1)', [itemIds]);
    const have = new Set(rows.map(r => r.id));
    const missing = itemIds.filter(i => !have.has(i));
    check('every augment item_id/salvage_item_id resolves to a real item', missing.length === 0, missing.join(', '));
  }

  // ── The test augment ───────────────────────────────────────────────────────
  const augId = `augtest_${p.id}`;
  await query('DELETE FROM player_augments WHERE player_id=$1 AND augment_id=$2', [p.id, augId]).catch(() => {});
  await query('DELETE FROM augments WHERE id=$1', [augId]).catch(() => {});
  await query(
    `INSERT INTO augments (id,name,description,slot,tier,cost,rep_gate,stat_modifiers,soak,visible,special,
                           overclock_max,heat_rate,failure_messages,install_difficulty)
       VALUES ($1,'Test Weave','t','torso',1,0,'unknown',$2,$3,0,null,3,4.0,$4,5)`,
    [augId, JSON.stringify({ stat_brawn: 4 }), JSON.stringify({ torso: { kinetic: 5 } }),
     JSON.stringify({ fault: 'The test weave seizes.' })]
  );
  await loadAugments();

  // ── Seam 2: soak + chromed, now read from the hydrated roster ──────────────
  const clean = { id: p.id };
  await hydrateAugments(clean);
  const bySlotA = {};
  _test.contributeAugmentState(clean, bySlotA);
  check('no augments → not chromed', clean.chromed === 0, clean.chromed);

  await query('INSERT INTO player_augments (player_id,augment_id,slot) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [p.id, augId, 'torso']);
  const chromedP = { id: p.id, stat_brawn: 5 };
  await hydrateAugments(chromedP);
  check('an augment → chromed', (() => { const b = {}; _test.contributeAugmentState(chromedP, b); return chromedP.chromed === 1; })(), chromedP.chromed);

  // The harness player is the one `run()` dispatches against, so it needs the
  // roster in RAM too — every verb below reads memory, never the row.
  await hydrateAugments(p);

  const bySlotB = { torso: { soak: { kinetic: 2 } } };
  _test.contributeAugmentState(chromedP, bySlotB);
  check('subdermal soak stacks onto the slot', bySlotB.torso?.soak?.kinetic === 7, bySlotB.torso?.soak?.kinetic);

  // ── THE MIGRATION INVARIANT ────────────────────────────────────────────────
  // calibration 100 + condition 1 + overclock 0 must reproduce the authored value
  // EXACTLY. This is what makes every augment already installed on a live
  // character arithmetically unchanged by the move off baked players.stat_*.
  const rec = rosterOf(chromedP).get(augId);
  check('default calibration is 100 (migration invariant)', rec?.calibration === 100, rec?.calibration);
  check('scale at calibration 100 is exactly 1', augScale(rec) === 1, augScale(rec));
  check('stat bonus at calibration 100 is the authored value', augmentStatBonus(chromedP, 'stat_brawn') === 4,
    augmentStatBonus(chromedP, 'stat_brawn'));

  // Calibration 0 gives exactly half — chrome that does nothing until you play a
  // minigame is a tax, not a system.
  rec.calibration = 0;
  check('calibration 0 gives exactly half', augScale(rec) === 0.5, augScale(rec));
  check('…and the stat bonus halves with it', augmentStatBonus(chromedP, 'stat_brawn') === 2,
    augmentStatBonus(chromedP, 'stat_brawn'));
  rec.calibration = 100;

  // Condition reads in the same currency as a coat.
  rec.condition = 0.5;                       // battered band
  check('a battered augment contributes less', augScale(rec) < 1 && augScale(rec) > 0, augScale(rec));
  rec.condition = 0;
  check('dead chrome contributes nothing', augScale(rec) === 0, augScale(rec));
  check('…and plates nothing', (() => { const b = {}; _test.contributeAugmentState(chromedP, b); return !b.torso; })(), 'plated while dead');
  rec.condition = 1;

  // Overclock raises output.
  rec.overclock_level = 2;
  check('overclock raises output above spec', augScale(rec) === 1.5, augScale(rec));
  rec.overclock_level = 0;

  // ── STATS ARE NEVER BAKED ──────────────────────────────────────────────────
  const before = (await query('SELECT stat_brawn FROM players WHERE id=$1', [p.id])).rows[0]?.stat_brawn;
  await run('augments');
  const after = (await query('SELECT stat_brawn FROM players WHERE id=$1', [p.id])).rows[0]?.stat_brawn;
  check('players.stat_* is never written by the augment path', before === after, `${before} → ${after}`);

  // ── Install bands ──────────────────────────────────────────────────────────
  check('band: a huge margin is flawless', bandFor(12).id === 'flawless', bandFor(12).id);
  check('band: a comfortable margin is clean', bandFor(5).id === 'clean', bandFor(5).id);
  check('band: a bare pass is sound', bandFor(1).id === 'sound', bandFor(1).id);
  check('band: a near miss is rough', bandFor(-3).id === 'rough', bandFor(-3).id);
  check('band: a bad miss is botched', bandFor(-8).id === 'botched', bandFor(-8).id);
  check('every band seeds calibration BELOW 100 (fresh chrome under-performs)',
    INSTALL_BANDS.every(b => b.calibration < 100), INSTALL_BANDS.map(b => b.calibration).join(','));
  // Destruction sits below the worst band that still leaves you with hardware
  // (rough); botched's floor is the open-ended catch-all, so compare to rough.
  check('the destroy threshold is worse than any survivable band',
    DESTROY_MARGIN < INSTALL_BANDS.find(b => b.id === 'rough').min, DESTROY_MARGIN);

  // ── Tuning ─────────────────────────────────────────────────────────────────
  const stale = await run(`calibrateresolve ${augId} 100 not-a-real-nonce`);
  check('calibrateresolve with no pending entry is a noop', stale?.type === 'noop', stale?.type);
  check('the board authority is bounded', BOARD_SWING > 0 && BOARD_SWING <= 20, BOARD_SWING);

  // Knock it off spec first — calibrate refuses a fully-tuned augment before it
  // ever looks for a rig, which is correct behaviour and the wrong thing to test.
  rosterOf(p).get(augId).calibration = 40;
  const noRig = await run(`calibrate Test Weave`);
  check('calibrate needs a rig or a bench',
    noRig?.type === 'error' && /rig|bench/i.test(noRig.message || ''), noRig?.message || noRig?.type);

  check('a botched fitting caps calibration below spec', BOTCHED_CALIBRATION_CAP < 100, BOTCHED_CALIBRATION_CAP);

  // ── Overclock ──────────────────────────────────────────────────────────────
  const ocHigh = await run('augment overclock Test Weave 9');
  check('overclock above the authored max is refused',
    ocHigh?.type === 'error' && /tops out/i.test(ocHigh.message || ''), ocHigh?.message || ocHigh?.type);

  const ocOk = await run('augment overclock Test Weave 2');
  check('overclock within the max is accepted', ocOk?.type === 'output', ocOk?.message || ocOk?.type);

  // ── Strain: sync by contract, and heat cools off a clock ───────────────────
  const heater = { id: `augheat_${p.id}`, stat_brawn: 5 };
  heater._augments = new Map([[augId, {
    augment_id: augId, slot: 'torso', condition: 1, calibration: 100,
    install_quality: 'sound', overclock_level: 2, custom_data: {},
  }]]);
  heater._augHeat = new Map();
  heater._augWearPending = new Map();
  const ret = onStrain(heater, 'swing');
  check('strain() is synchronous (returns no promise)', !(ret instanceof Promise), typeof ret);
  const h1 = heatOf(heater, augId);
  check('a swing heats overclocked chrome', h1 > 0, h1);

  // Cooling is derived from the timestamp, not a tick. Push the stamp back and
  // the heat must have fallen without anything having run.
  const entry = heater._augHeat.get(augId);
  entry.at = Date.now() - 10_000;
  const h2 = heatOf(heater, augId);
  check('heat cools lazily off the timestamp, with no tick',
    h2 < h1 && Math.abs((h1 - h2) - HEAT_COOL_PER_SEC * 10) < 0.5, `${h1.toFixed(2)} → ${h2.toFixed(2)}`);
  entry.at = Date.now() - 10_000_000;
  check('heat never goes negative', heatOf(heater, augId) === 0, heatOf(heater, augId));

  // A level-0 augment with heat_rate accrues from working; an augment with
  // heat_rate 0 must cost the hot path literally nothing.
  const cold = { id: 'augcold', _augments: new Map([[augId, {
    augment_id: augId, slot: 'torso', condition: 0, calibration: 100,
    install_quality: 'sound', overclock_level: 0, custom_data: {},
  }]]), _augHeat: new Map(), _augWearPending: new Map() };
  onStrain(cold, 'swing');
  check('dead chrome makes no heat', cold._augHeat.size === 0, cold._augHeat.size);

  // Above Hot, strain converts to durable condition loss.
  heater._augHeat.set(augId, { heat: CRITICAL + 20, at: Date.now() });
  heater._augWearPending.clear();
  onStrain(heater, 'swing');
  check('heat above Hot burns condition', (heater._augWearPending.get(augId) || 0) > 0,
    heater._augWearPending.get(augId));
  check('heat bands read in order', heatBand(0).id === 'cool' && heatBand(CRITICAL).id === 'critical',
    `${heatBand(0).id}/${heatBand(CRITICAL).id}`);

  // ── Death corruption ───────────────────────────────────────────────────────
  check('pristine chrome sometimes survives death', survivalChance(1) > 0, survivalChance(1));
  check('dead chrome never survives death', survivalChance(0) === 0, survivalChance(0));
  check('corruption is graded, never certain-loss for good hardware',
    survivalChance(1) > survivalChance(0.3), `${survivalChance(1)} vs ${survivalChance(0.3)}`);

  const victim = { id: `augdead_${p.id}`, handle: 'Victim' };
  await query('INSERT INTO player_augments (player_id,augment_id,slot) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [victim.id, augId, 'torso']);
  await hydrateAugments(victim);
  // Force total corruption by wrecking the condition first — survivalChance(0) is 0.
  rosterOf(victim).get(augId).condition = 0;
  await _test.corruptOnDeath(victim, null);
  const left = await query('SELECT 1 FROM player_augments WHERE player_id=$1', [victim.id]);
  check('death corrupts installed chrome', left.rows.length === 0, left.rows.length);
  check('…and the in-memory roster agrees with the rows', rosterOf(victim).size === 0, rosterOf(victim).size);

  // ── INTERLOCK 1: chromed_ever survives corruption ──────────────────────────
  // Without this, a death that corrupted every augment would silently re-open the
  // flesh path — undoing the one irreversible decision in the game.
  const everP = { id: `augever_${p.id}` };
  await hydrateAugments(everP);
  everP._chromedEver = true;
  const b2 = {};
  _test.contributeAugmentState(everP, b2);
  check('chromed_ever keeps you chromed with an empty roster', everP.chromed === 1, everP.chromed);

  // ── Seam 4: the cortical-backup respawn hook ───────────────────────────────
  await query('DELETE FROM player_backups WHERE player_id=$1', [p.id]).catch(() => {});
  await setFlag('player', 'wanted', '0', p);
  const noBk = await _test.onRespawnZone({ id: p.id, handle: p.handle }, null);
  check('no backup → hook yields', noBk === undefined, JSON.stringify(noBk)?.slice(0, 80));

  await query(
    `INSERT INTO player_backups (player_id,snapshot,restores_remaining) VALUES ($1,$2,1)
       ON CONFLICT (player_id) DO UPDATE SET snapshot=EXCLUDED.snapshot, restores_remaining=1`,
    [p.id, JSON.stringify({ credits: 0, inventory: [] })]
  );
  await setFlag('player', 'wanted', '3', p);
  const wantedDeath = await _test.onRespawnZone({ id: p.id, handle: p.handle }, null);
  check('wanted death yields to jail even with a paid backup', wantedDeath === undefined,
    JSON.stringify(wantedDeath)?.slice(0, 80));

  // ── INTERLOCK 2: the restore rebuilds the chrome, tuning and all ───────────
  const rid = `augrestore_${p.id}`;
  const item = (await query('SELECT id FROM items LIMIT 1').catch(() => ({ rows: [] }))).rows[0]?.id;
  if (item) {
    world.zones.set('zone_test_vats', { id: 'zone_test_vats', flags: { ascendant_vats: true }, players: new Set() });
    await query('DELETE FROM player_inventory WHERE player_id=$1', [rid]).catch(() => {});
    await query('DELETE FROM player_augments WHERE player_id=$1', [rid]).catch(() => {});
    await query(
      `INSERT INTO player_backups (player_id,snapshot,restores_remaining) VALUES ($1,$2,2)
         ON CONFLICT (player_id) DO UPDATE SET snapshot=EXCLUDED.snapshot, restores_remaining=2`,
      [rid, JSON.stringify({
        credits: 777,
        inventory: [{ old_id: 'x', item_id: item, quantity: 1, condition: 1.0, is_equipped: 0, slot: null, custom_data: {}, container_id: null }],
        augments: [{ augment_id: augId, slot: 'torso', condition: 0.66, calibration: 41, install_quality: 'botched', overclock_level: 1, custom_data: {} }],
      })]
    );
    const syn = { id: rid, handle: 'Restorer', credits: 1234 };
    const res = await _test.onRespawnZone(syn, null);
    check('backup restore lands at a Vats hall (skipOutfit)',
      res?.skipOutfit === true && !!world.zones.get(res?.zone)?.flags?.ascendant_vats,
      JSON.stringify({ zone: res?.zone, skipOutfit: res?.skipOutfit })?.slice(0, 80));
    const inv = await query('SELECT item_id FROM player_inventory WHERE player_id=$1', [rid]);
    check('restore rebuilds inventory from the snapshot', inv.rows.length === 1 && inv.rows[0].item_id === item, inv.rows.length);
    // The snapshot carries credits: 777 from an OLD backup; the restore must
    // ignore it. Rolling a balance back was mintable (bank it, die, get it back).
    const credRow = (await query('SELECT credits FROM players WHERE id=$1', [rid])).rows[0];
    check('restore leaves credits alone (never rolled back)',
      syn.credits === 1234 && Number(credRow?.credits ?? 1234) !== 777, `${syn.credits}/${credRow?.credits}`);

    const back = (await query('SELECT calibration, condition, install_quality FROM player_augments WHERE player_id=$1 AND augment_id=$2', [rid, augId])).rows[0];
    check('restore rebuilds the augment roster', !!back, 'no augment row restored');
    check('…with its calibration, not a fresh one', Number(back?.calibration) === 41, back?.calibration);
    check('…and the botched ceiling still on it', back?.install_quality === 'botched', back?.install_quality);
    check('…and the roster in RAM agrees', rosterOf(syn).get(augId)?.calibration === 41, rosterOf(syn).get(augId)?.calibration);

    const bkr = await _test.getBackup(rid);
    check('restore consumes one restore', bkr?.restores_remaining === 1, bkr?.restores_remaining);

    await query('DELETE FROM player_inventory WHERE player_id=$1', [rid]).catch(() => {});
    await query('DELETE FROM player_augments WHERE player_id=$1', [rid]).catch(() => {});
    await query('DELETE FROM player_backups WHERE player_id=$1', [rid]).catch(() => {});
    world.zones.delete('zone_test_vats');
  }

  // cleanup
  await setFlag('player', 'wanted', '0', p);
  await query('DELETE FROM player_backups WHERE player_id=$1', [p.id]).catch(() => {});
  await query('DELETE FROM player_augments WHERE augment_id=$1', [augId]).catch(() => {});
  await query('DELETE FROM augments WHERE id=$1', [augId]).catch(() => {});
  await loadAugments();

  // AND un-chrome the harness player. The suites share one live player object,
  // and `chromed` is the flesh→machine interlock: leaving it set makes every
  // mutation grant in the mutations suite silently refuse, hundreds of lines and
  // one plugin away from anything that mentions augments. Re-hydrating from the
  // now-empty table is the honest reset.
  await hydrateAugments(p);
  p._chromedEver = false;
  p.chromed = 0;
}
