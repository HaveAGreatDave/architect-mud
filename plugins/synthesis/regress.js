// Synthesis plugin regression suite — run by tests/regress.js (never in prod).
// Guards on the reverse-engineering verbs, the chem-lab hub (furniture.describe),
// and the chem-lab storage vault: a lab cook/splice deposits its finished product
// into the lab container, and withdrawing it must keep each distinct-potency batch
// as its own row (the instanced-merge guard on pull). The cook/splice minigames
// themselves are driven client-side and covered by their own client flow.
import { query } from '../../server/models/db.js';
import { insertFurniture, deleteFurniture } from '../../server/engine/world.js';
import { getRegisteredCommands } from '../../server/engine/plugins.js';
import { builtinCommandNames } from '../../server/engine/commands/index.js';
import { hooks, _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  // ── Splicing a hallucination ────────────────────────────────────────────────
  // `mode: 'dreamzone'` is infectious — splice something that takes you out of
  // the room into something that doesn't, and the result takes you out of the
  // room. What it must NOT do any more is carry a destination: the authored
  // SHARED dreamzones are retired (two people on the same drug used to meet
  // inside the hallucination), and the trip plugin now BUILDS a private one.
  {
    const { composeSplice } = _test;
    const overlay  = { eff: { hallucination: { mode: 'overlay', intensity: 0.4, palette: 'green' } }, form: 'pill', color: '#00ff00', qty: 1 };
    const dreamzed = { eff: { hallucination: { mode: 'dreamzone', intensity: 0.8, palette: 'cyan' } }, form: 'pill', color: '#00ffff', qty: 1 };

    // composeSplice returns { effects, difficulty, … } — read the blend, not the wrapper.
    const hallOf = (r) => r.effects?.hallucination;

    const spliced = hallOf(composeSplice([overlay, dreamzed]));
    check('the splice actually produced a hallucination to inspect', !!spliced, JSON.stringify(spliced));
    check('splicing a dreamzone trip into an overlay yields a dreamzone trip',
      spliced?.mode === 'dreamzone', spliced?.mode);
    check('a spliced dreamzone trip names no room to send anyone to',
      !!spliced && !('dreamzone_id' in spliced), JSON.stringify(spliced));

    // Order must not matter — the dreamzone input was second above, first here.
    const flipped = hallOf(composeSplice([dreamzed, overlay]));
    check('dreamzone infects regardless of input order', flipped?.mode === 'dreamzone', flipped?.mode);

    // A legacy drug row can still carry the retired field; the splice must strip
    // it rather than propagate a destination nothing will ever read.
    const legacy = { eff: { hallucination: { mode: 'dreamzone', intensity: 0.5, dreamzone_id: 'zone_dream_khole' } }, form: 'pill', color: '#0000ff', qty: 1 };
    const cleaned = hallOf(composeSplice([legacy, overlay]));
    check('a legacy dreamzone_id is stripped, not carried through the splice',
      !!cleaned && !('dreamzone_id' in cleaned), JSON.stringify(cleaned));

    // Two overlays stay an overlay — the infection needs an actual source.
    const both = hallOf(composeSplice([overlay, { ...overlay, color: '#ff0000' }]));
    check('splicing two overlays stays an overlay', (both?.mode || 'overlay') === 'overlay', both?.mode);
  }

  // reclaim needs a chem lab — the fake player has none, so it must error cleanly.
  const r = await run('reclaim nonexistent');
  check('reclaim without a lab errors cleanly', r?.type === 'error', r?.type);

  const p = getPlayer();

  // ── the chem-lab hub (furniture.describe) ──────────────────────────────────
  const lab = { id: 'furn_regress_hub', name: 'chem lab', flags: { crafting_station: 'chem_lab' } };
  const hub = await hooks['furniture.describe'](lab, p);
  check('hub surfaces cook + vault on a chem lab',
    /data-raw-cmd="cook"/.test(hub || '') && /data-raw-cmd="open chem lab"/.test(hub || ''), hub);
  check('hub hides splice from a non-splicer', !/data-raw-cmd="splice"/.test(hub || ''), hub);
  check('hub ignores non-lab furniture',
    (await hooks['furniture.describe']({ id: 'x', name: 'a chair', flags: {} }, p)) === undefined);

  // ── the `chembench` workspace provider ─────────────────────────────────────
  //
  // The point of these is not the chemistry — it's that a SECOND workspace works
  // through the same seam as the first. Nothing in plugins/workspace or its
  // client panel knows this domain exists, and none of it changed to add it.
  {
    const saved = p.current_zone;
    const BENCH = 'furn_synth_workspace_regress';
    const Z = 'zone_synth_workspace_regress';
    try {
      await insertFurniture({
        id: BENCH, name: 'test chem bench', description: 'a test bench', object_type: 'container',
        zone_id: Z, flags: JSON.stringify({ crafting_station: 'chem_lab', station_quality: 'refined' }),
      }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id, object_type=EXCLUDED.object_type');
      p.current_zone = Z;

      let w = await run('workspace');
      check('a chem lab makes the room a chembench workspace',
        w?.type === 'workspace_view' && w.provider === 'chembench', JSON.stringify(w?.type ?? w));
      check('...rendering through the SAME payload the kitchen uses',
        Array.isArray(w.storage) && Array.isArray(w.area) && Array.isArray(w.status), Object.keys(w).join(','));
      check('...reporting the bench, its rank gate and the station bonus',
        w.status.some(s => s.label === 'Bench' && /test chem bench/.test(s.value))
        && w.status.some(s => s.label === 'Chemistry')
        && w.status.some(s => s.label === 'Splice'), JSON.stringify(w.status));
      check('...with the station quality bonus spelled out',
        w.status.some(s => s.label === 'Station bonus' && s.value === '+2'), JSON.stringify(w.status));
      check('the bench is the Preparation Area, and offers its own verbs',
        w.area[0]?.id === BENCH && w.area[0].actions.some(a => a.command === 'synthesize'), JSON.stringify(w.area));
      check('the Assistant lists what this bench could turn out',
        !!w.assistant && w.assistant.groups.length > 0, JSON.stringify(w.assistant?.note));

      // The rule holds across domains: every action is still a real verb.
      const acts = [
        ...w.area.flatMap(a => a.actions || []),
        ...w.components.flatMap(c => c.actions || []),
        ...(w.assistant?.groups || []).flatMap(g => g.recipes.flatMap(x => x.actions || [])),
      ];
      const known = new Set([...builtinCommandNames(), ...getRegisteredCommands()]);
      const bad = acts.map(a => a.command.trim().split(/\s+/)[0]).filter(v => !known.has(v));
      check('every chembench action is a verb a player could have typed',
        bad.length === 0, [...new Set(bad)].join(', '));

      // A concealed lab is not a lab you can work at — the same check the cook
      // path makes, and the one hole that would make the disguise pointless.
      await insertFurniture({
        id: BENCH, name: 'test chem bench', description: 'a test bench', object_type: 'container',
        zone_id: Z, flags: JSON.stringify({ crafting_station: 'chem_lab', concealed: true }),
      }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags');
      w = await run('workspace');
      check('a concealed lab offers no workspace at all',
        w?.type === 'error', JSON.stringify(w?.type ?? w));
    } finally {
      p.current_zone = saved;
      await deleteFurniture(BENCH).catch(() => {});
    }
  }

  // ── deposit → shared vault, withdraw keeps distinct-potency batches apart ───
  const zone = p.current_zone;
  const anyItem = (await query('SELECT id FROM items LIMIT 1')).rows[0]?.id;
  check('an item exists to exercise the vault round-trip', !!anyItem, anyItem);
  if (anyItem) {
    await query(
      `INSERT INTO furniture (id,zone_id,name,description,flags,object_type)
       VALUES ('furn_regress_vault',$1,'chem vault','test vault','{}'::jsonb,'container')
       ON CONFLICT (id) DO UPDATE SET zone_id=$1, object_type='container'`,
      [zone]
    );
    const owner = '_vault_furn_regress_vault';
    try {
      await query(`DELETE FROM player_inventory WHERE container_id='furn_regress_vault' OR player_id=$1`, [owner]);
      await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2`, [p.id, anyItem]);
      // Two batches of the SAME item at different potency, deposited as the vault sentinel.
      await query(
        `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data,container_id)
         VALUES ('pi_rv1',$1,$2,1,1.0,'{"potency":1.6,"spliced":true}'::jsonb,'furn_regress_vault'),
                ('pi_rv2',$1,$2,1,1.0,'{"potency":0.7,"spliced":true}'::jsonb,'furn_regress_vault')`,
        [owner, anyItem]
      );
      // Withdraw both through the container pull-by-id path the vault UI uses.
      await run('pullid pi_rv1');
      await run('pullid pi_rv2');
      const { rows } = await query(
        `SELECT custom_data->>'potency' AS potency FROM player_inventory
          WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL
          ORDER BY (custom_data->>'potency')::float`,
        [p.id, anyItem]
      );
      check('vault withdraw keeps both batches as distinct rows', rows.length === 2, rows.length);
      check('vault withdraw preserves distinct potencies',
        rows[0]?.potency === '0.7' && rows[1]?.potency === '1.6', rows.map(x => x.potency).join(','));
    } finally {
      await query(`DELETE FROM player_inventory WHERE id IN ('pi_rv1','pi_rv2')`);
      await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2`, [p.id, anyItem]);
      await query(`DELETE FROM player_inventory WHERE player_id=$1`, [owner]);
      await query(`DELETE FROM furniture WHERE id='furn_regress_vault'`);
    }
  }
}
