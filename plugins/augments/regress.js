// plugins/augments/regress.js — never loaded in production, only by the harness.
// Covers routing + clinic gate + the three step-2 seams (soak contribution,
// player.chromed derivation, and the cortical-backup respawn hook's jail yield).
import { query } from '../../server/models/db.js';
import { setFlag } from '../../server/engine/flags.js';
import { world } from '../../server/engine/world.js';
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  // ── Routing + clinic gate ──────────────────────────────────────────────────
  const list = await run('augments');
  check('augments lists', list?.type === 'augments', list?.type || 'no result');

  const bare = await run('augment');
  check('augment (bare) lists', bare?.type === 'augments', bare?.type || 'no result');

  const inst = await run('augment install dermal jack');
  check('install refused off-clinic',
    inst?.type === 'error' && /clinic/i.test(inst.message || ''),
    inst?.message || inst?.type);

  const rem = await run('augment remove dermal jack');
  check('remove refused off-clinic',
    rem?.type === 'error' && /clinic/i.test(rem.message || ''),
    rem?.message || rem?.type);

  const noarg = await run('augment install');
  check('install needs a name',
    noarg?.type === 'error' && /install what/i.test(noarg.message || ''),
    noarg?.message || noarg?.type);

  // ── Backup / policy location gates ─────────────────────────────────────────
  const bk = await run('backup');
  check('backup refused off-registry',
    bk?.type === 'error' && /registry/i.test(bk.message || ''),
    bk?.message || bk?.type);

  const pol = await run('assurance');
  check('assurance refused off assurance desk',
    pol?.type === 'error' && /desk/i.test(pol.message || ''),
    pol?.message || pol?.type);

  // ── Seam 1 + 2: soak contribution + chromed derivation ─────────────────────
  const p = getPlayer();
  const augId = `augtest_${p.id}`;
  await query('DELETE FROM augments WHERE id=$1', [augId]).catch(() => {});
  await query('DELETE FROM player_augments WHERE player_id=$1 AND augment_id=$2', [p.id, augId]).catch(() => {});
  await query(
    `INSERT INTO augments (id,name,description,slot,tier,cost,rep_gate,stat_modifiers,soak,visible,special)
       VALUES ($1,'Test Weave','t','torso',1,0,'unknown','{}',$2,0,null)`,
    [augId, JSON.stringify({ torso: { kinetic: 5 } })]
  );
  await _test.loadAugments();  // refresh the memory cache so the test row is visible

  // No augment installed → not chromed, no augment soak.
  const clean = { id: p.id };
  const bySlotA = {};
  await _test.contributeAugmentState(clean, bySlotA);
  check('no augments → not chromed', clean.chromed === 0, clean.chromed);

  // Install the test augment → chromed + torso soak layered in.
  await query('INSERT INTO player_augments (player_id,augment_id,slot) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [p.id, augId, 'torso']);
  const chromedP = { id: p.id };
  const bySlotB = { torso: { soak: { kinetic: 2 } } };  // pretend some armor already there
  await _test.contributeAugmentState(chromedP, bySlotB);
  check('an augment → chromed', chromedP.chromed === 1, chromedP.chromed);
  check('subdermal soak stacks onto the slot', bySlotB.torso?.soak?.kinetic === 7, bySlotB.torso?.soak?.kinetic);

  // ── Seam 3: cortical-backup respawn hook ───────────────────────────────────
  await query('DELETE FROM player_backups WHERE player_id=$1', [p.id]).catch(() => {});

  // No backup on file → hook yields (normal clone-vat).
  await setFlag('player', 'wanted', '0', p);
  const noBk = await _test.onRespawnZone({ id: p.id, handle: p.handle }, null);
  check('no backup → hook yields', noBk === undefined, JSON.stringify(noBk)?.slice(0, 80));

  // A paid backup exists BUT the player is wanted → jail must win, hook yields.
  await query(
    `INSERT INTO player_backups (player_id,snapshot,restores_remaining) VALUES ($1,$2,1)
       ON CONFLICT (player_id) DO UPDATE SET snapshot=EXCLUDED.snapshot, restores_remaining=1`,
    [p.id, JSON.stringify({ credits: 0, inventory: [] })]
  );
  await setFlag('player', 'wanted', '3', p);
  const wantedDeath = await _test.onRespawnZone({ id: p.id, handle: p.handle }, null);
  check('wanted death yields to jail even with a paid backup', wantedDeath === undefined, JSON.stringify(wantedDeath)?.slice(0, 80));

  // Full restore round-trip: an isolated synthetic id (its own inventory + backup,
  // no wanted flag) and a stubbed Vats zone, so no imported campus is required.
  const rid = `augrestore_${p.id}`;
  const item = (await query('SELECT id FROM items LIMIT 1').catch(() => ({ rows: [] }))).rows[0]?.id;
  if (item) {
    world.zones.set('zone_test_vats', { id: 'zone_test_vats', flags: { ascendant_vats: true }, players: new Set() });
    await query('DELETE FROM player_inventory WHERE player_id=$1', [rid]).catch(() => {});
    await query(
      `INSERT INTO player_backups (player_id,snapshot,restores_remaining) VALUES ($1,$2,2)
         ON CONFLICT (player_id) DO UPDATE SET snapshot=EXCLUDED.snapshot, restores_remaining=2`,
      [rid, JSON.stringify({ credits: 777, inventory: [{ old_id: 'x', item_id: item, quantity: 1, condition: 1.0, is_equipped: 0, slot: null, custom_data: {}, container_id: null }] })]
    );
    const syn = { id: rid, handle: 'Restorer', credits: 0 };
    const res = await _test.onRespawnZone(syn, null);
    check('backup restore lands at a Vats hall (skipOutfit)',
      res?.skipOutfit === true && !!world.zones.get(res?.zone)?.flags?.ascendant_vats,
      JSON.stringify({ zone: res?.zone, skipOutfit: res?.skipOutfit })?.slice(0, 80));
    const inv = await query('SELECT item_id FROM player_inventory WHERE player_id=$1', [rid]);
    check('restore rebuilds inventory from the snapshot', inv.rows.length === 1 && inv.rows[0].item_id === item, inv.rows.length);
    check('restore rolls credits back to the snapshot', syn.credits === 777, syn.credits);
    const bk = await _test.getBackup(rid);
    check('restore consumes one restore', bk?.restores_remaining === 1, bk?.restores_remaining);
    await query('DELETE FROM player_inventory WHERE player_id=$1', [rid]).catch(() => {});
    await query('DELETE FROM player_backups WHERE player_id=$1', [rid]).catch(() => {});
    world.zones.delete('zone_test_vats');
  }

  // cleanup
  await setFlag('player', 'wanted', '0', p);
  await query('DELETE FROM player_backups WHERE player_id=$1', [p.id]).catch(() => {});
  await query('DELETE FROM player_augments WHERE player_id=$1 AND augment_id=$2', [p.id, augId]).catch(() => {});
  await query('DELETE FROM augments WHERE id=$1', [augId]).catch(() => {});
  await _test.loadAugments();  // drop the test row from cache
}
