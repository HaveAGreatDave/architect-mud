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
import { getDrugCache } from '../../server/engine/drugs.js';
import { setFlag } from '../../server/engine/flags.js';
import { displayRung, setDisplayRung, DISPLAY_MODE_FLAG } from '../../server/engine/presentation.js';
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

  // ── Splicing by typing ──────────────────────────────────────────────────────
  // The designer is a panel, so without verbs nobody could splice from a macro and
  // a `log`-rung player couldn't splice at all. The typed draft has to reach the
  // SAME cmdSplicePreview/cmdSpliceBegin math the panel's base64 payload does: an
  // accessibility path changes the interface, never the odds.
  {
    const p = getPlayer();
    const { spliceDrafts } = _test;
    const LAB = 'furn_synth_splice_regress';
    const Z = 'zone_synth_splice_regress';
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
    const hasBlocks = (e) => {
      if (!e) return false;
      const structured = ['instant', 'phases', 'hallucination', 'tolerance', 'withdrawal', 'overdose'].some(k => k in e);
      return structured ? !!(Object.keys(e.instant || {}).length || e.phases || e.hallucination) : Object.keys(e).length > 0;
    };
    const picks = Object.values(getDrugCache()).filter(d => d.id !== 'drug_compound' && d.item_id && hasBlocks(d.effects)).slice(0, 2);
    check('two spliceable drugs exist to exercise the typed designer', picks.length === 2, picks.length);
    if (picks.length === 2) {
      const savedZone = p.current_zone;
      const savedRung = await displayRung(p);
      const savedStats = [p.stat_brains, p.stat_reflexes];
      const { rows: names } = await query('SELECT id, name FROM items WHERE id = ANY($1)', [picks.map(d => d.item_id)]);
      const nameOf = (d) => names.find(n => n.id === d.item_id)?.name;
      const [A, B] = picks;
      const invIds = ['pi_splice_rg_a', 'pi_splice_rg_b', 'pi_splice_rg_stab'];
      try {
        // The harness player has no players row, so it can't hold skill IP. Its
        // Chemistry is the average of the two governing stats: 7 clears the splice
        // gate (6) and stays under the three-way one (10).
        p.stat_brains = 7; p.stat_reflexes = 7;
        await insertFurniture({
          id: LAB, name: 'test chem lab', description: 'a test lab', object_type: 'container',
          zone_id: Z, flags: JSON.stringify({ crafting_station: 'chem_lab' }),
        }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id, object_type=EXCLUDED.object_type');
        await query(
          `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES
             ($1,$4,$5,3,1.0), ($2,$4,$6,3,1.0), ($3,$4,'item_stabilizer',1,1.0)
           ON CONFLICT (id) DO UPDATE SET quantity=EXCLUDED.quantity`,
          [...invIds, p.id, A.item_id, B.item_id]
        );
        p.current_zone = Z;
        spliceDrafts.delete(p.id);

        // ── the bottom rung reads the bench instead of opening the panel ──
        await setDisplayRung(p, 'log');
        let r = await run('splice');
        check('at log, `splice` writes the bench rather than opening the designer',
          r?.type === 'output' && r.message.includes(nameOf(A)) && r.message.includes(nameOf(B)), r?.type);
        check('…and names every verb that works it',
          ['splice add', 'splice remove', 'splice qty', 'splice name', 'splice preview', 'splice begin'].every(v => r.message.includes(v)), r?.message?.slice(-200));

        r = await run(`splice add ${nameOf(A)} 2`);
        check('`splice add <drug> <qty>` sets the base', r?.type === 'output' && /Base: .* ×2/.test(r.message), r?.message?.slice(0, 160));
        await run(`splice add ${nameOf(B)}`);
        r = await run(`splice add ${nameOf(A)}`);
        check('the same drug twice is refused, as the panel refuses it', r?.type === 'error' && /already in the cradle/.test(r.message), r?.message);
        r = await run('splice add zzqx no such drug');
        check('a drug you do not carry is refused', r?.type === 'error', r?.type);

        // ── preview: typed and panel reach one result ──
        const payload = { base: { drug: A.id, qty: 2 }, splice: { drug: B.id, qty: 1 } };
        const typedPreview = await run('splice preview');
        const panelPreviewAtLog = await run(`splicepreview ${b64(payload)}`);
        check('at log, the panel preview is written to the log too',
          panelPreviewAtLog?.type === 'output' && panelPreviewAtLog.message === typedPreview?.message, panelPreviewAtLog?.type);
        await setDisplayRung(p, 'visual');
        const panelPreview = await run(`splicepreview ${b64(payload)}`);
        check('the panel preview is unchanged at visual', panelPreview?.type === 'splice_preview' && panelPreview.ok, panelPreview?.type);
        check('the typed preview reports the panel\'s difficulty and instability',
          typedPreview?.message?.includes(`Difficulty ${panelPreview.difficulty}.`)
          && typedPreview.message.includes(`Instability ${Math.round(panelPreview.instability * 100)}%`), typedPreview?.message?.slice(0, 160));

        // ── begin: typed and panel launch the same reaction ──
        await setDisplayRung(p, 'log');
        const typedBegin = await run('splice begin');
        const recipeName = `${nameOf(A)} splice`.slice(0, 28);
        const panelBegin = await run(`splicebegin ${b64({ ...payload, name: recipeName })}`);
        check('a typed `splice begin` launches the splice reaction', typedBegin?.type === 'synth_minigame' && typedBegin.kind === 'splice', JSON.stringify(typedBegin)?.slice(0, 160));
        check('…resolved at log, never a canvas', typedBegin?.render === 'resolve', typedBegin?.render);
        check('…with the panel\'s difficulty, instability and name',
          typedBegin?.difficulty === panelBegin?.difficulty && typedBegin?.instability === panelBegin?.instability
          && typedBegin?.recipeName === panelBegin?.recipeName, `${typedBegin?.difficulty}/${panelBegin?.difficulty} ${typedBegin?.recipeName}/${panelBegin?.recipeName}`);

        // ── graphical rungs: the draft rides into the designer ──
        await setDisplayRung(p, 'visual');
        r = await run('splice');
        check('at visual, `splice` still opens the designer', r?.type === 'splice_designer', r?.type);
        check('…pre-filled with the typed draft, not committed',
          r?.preset?.drugs?.length === 2 && r.preset.drugs[0].drug === A.id && r.preset.drugs[0].qty === 2 && !r.preset.autoCommit, JSON.stringify(r?.preset));
        r = await run('splice begin');
        check('at visual, `splice begin` opens the designer set to commit the same payload',
          r?.type === 'splice_designer' && r.preset?.autoCommit === true && r.preset.name === recipeName, JSON.stringify(r?.preset));

        // ── editing ──
        r = await run('splice name <b>Night</b> Shift');
        check('a typed name drops markup, as cmdSpliceBegin does', !/[<>]/.test(spliceDrafts.get(p.id)?.name || '<'), spliceDrafts.get(p.id)?.name);
        // The harness player may already carry some of B, so read what it holds.
        const { rows: [{ n: haveB }] } = await query('SELECT COALESCE(SUM(quantity),0)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0', [p.id, B.item_id]);
        r = await run(`splice qty ${nameOf(B)} 99`);
        check('`splice qty` clamps to what you carry and one batch', spliceDrafts.get(p.id)?.slots.find(s => s.drug === B.id)?.qty === Math.min(10, haveB), JSON.stringify(spliceDrafts.get(p.id)));
        await run(`splice remove ${nameOf(A)}`);
        check('`splice remove` empties that slot', spliceDrafts.get(p.id)?.slots.length === 1 && spliceDrafts.get(p.id).slots[0].drug === B.id, JSON.stringify(spliceDrafts.get(p.id)));
        r = await run('splice begin');
        check('one drug is not a splice', r?.type === 'error', r?.type);
        await run('splice clear');
        check('`splice clear` drops the draft', !spliceDrafts.has(p.id));
      } finally {
        spliceDrafts.delete(p.id);
        p.current_zone = savedZone;
        if (savedRung) await setDisplayRung(p, savedRung);
        else { await setFlag('player', DISPLAY_MODE_FLAG, '', p).catch(() => {}); p.displayRung = undefined; }
        await query('DELETE FROM player_inventory WHERE id = ANY($1)', [invIds]);
        [p.stat_brains, p.stat_reflexes] = savedStats;
        await deleteFurniture(LAB).catch(() => {});
      }
    }
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
    // Through the funnel: container lookups read the furniture cache, so a raw
    // INSERT would leave the vault invisible to `pullid`.
    await insertFurniture(
      { id: 'furn_regress_vault', zone_id: zone, name: 'chem vault', description: 'test vault', flags: '{}', object_type: 'container' },
      `ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id, object_type='container'`
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
      await deleteFurniture('furn_regress_vault');
    }
  }
}
