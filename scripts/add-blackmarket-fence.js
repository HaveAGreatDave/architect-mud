// One-shot content: the black-market fence + the dealer's tip (Phase 2 dialogue rework).
//   Run once (AFTER scripts/add-raw-supply.js so the raw items exist):
//     node scripts/add-blackmarket-fence.js
//   Restart / reload the world after — NPC + item caches load at boot.
//
// Wires up ordering-via-dialogue:
//   1. item_mule_crate — the cipher-locked airdrop crate the smuggle plugin drops
//      at the Scald. Tagged mule_crate (so `unpack` resolves it) + raw_drug +
//      contraband at cook_tier 5, so hauling a *sealed* crate through a checkpoint
//      is the hardest possible sneak (you're meant to unpack at the drop first).
//   2. The Fixer (covert dealer, npc_the_fixer) — a configurable inner-circle line
//      (flags.inner_circle_line) so hitting his max trust *names the fence*. The
//      inner-circle flag (dealer_inner_circle) is what unlocks Sully's back-room.
//   3. Sully (npc_barkeep, the fence) — a generated black-market dialogue branch,
//      merged into his existing tree: a root option gated on dealer_inner_circle →
//      a raw menu gated by bm_trust tiers → per-raw quantity nodes that fire the
//      PLACE_SMUGGLE_ORDER action. The menu is built from the live raw items, so
//      re-run this whenever the drug roster changes.
// Idempotent (upserts + regenerates the branch each run).
import { query } from '../server/models/db.js';

const FENCE_ID = 'npc_barkeep';        // Sully Holt, the Pigeon Bar
const DEALER_ID = 'npc_the_fixer';     // the covert Shadow Dealer
const MARKUP = 2;                       // must match plugins/smuggle/index.js MARKUP
const QTYS = [1, 3, 5];                 // crate counts offered per raw
// bm_trust needed before a raw of each cook_tier shows on the menu (built by pickups).
const TIER_TRUST = { 1: 0, 2: 2, 3: 4, 4: 7, 5: 10 };

const DEALER_TIP =
  `The Fixer's whisper drops lower still. "You don't want to just *deal*, do you. You want to cook. ` +
  `Then you want raw, not street-cut product. Go see Sully — the barkeep at the Pigeon Bar, over in the Marquee. ` +
  `Tell him the static's clean tonight. He'll open the back-room list for you."`;

const asObj = (v) => (v && typeof v === 'object') ? v : (() => { try { return JSON.parse(v || '{}'); } catch { return {}; } })();
const DRY = process.argv.includes('--dry'); // preview: read-only, prints the generated tree, writes nothing

async function main() {
  if (DRY) console.log('— DRY RUN: no writes —');
  // 1. The MULE crate item.
  if (!DRY) await query(
    `INSERT INTO items (id,name,description,type,subtype,weight,value,is_stackable,tags,flags)
     VALUES ('item_mule_crate','a sealed MULE crate',
             'A scuffed airdrop crate, still warm from the drone. A cipher-lock winks on the lid — keyed to whoever placed the order. Crack it open (unpack) to get at what''s inside.',
             'chemical','crate',4,0,0,
             '{"mule_crate":true,"raw_drug":true,"contraband":true}'::jsonb,
             '{"cook_tier":5}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, type=EXCLUDED.type,
       subtype=EXCLUDED.subtype, weight=EXCLUDED.weight, value=EXCLUDED.value, is_stackable=EXCLUDED.is_stackable,
       tags=EXCLUDED.tags, flags=EXCLUDED.flags`);
  console.log('✓ item_mule_crate');

  // 2. The Fixer's tip + drug-buyer premium. Both the Fixer and Sully BUY finished
  // drugs at an underworld premium (vendor.js drug_buyer → 0.7×value×potency) — the
  // payoff that makes cooking worth the risk.
  const fx = DRY ? 1 : (await query(
    `UPDATE npcs SET flags = COALESCE(flags,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ inner_circle_flag: 'dealer_inner_circle', inner_circle_line: DEALER_TIP, drug_buyer: true }), DEALER_ID])).rowCount;
  console.log(fx ? `✓ ${DEALER_ID}: inner-circle tip + drug-buyer premium` : `⚠ ${DEALER_ID} not found — no dealer tip wired`);
  if (!DRY) await query(`UPDATE npcs SET flags = COALESCE(flags,'{}'::jsonb) || '{"drug_buyer":true}'::jsonb WHERE id=$1`, [FENCE_ID]);

  // 3. Sully's black-market branch, generated from the live raw items.
  const { rows: raws } = await query(
    `SELECT id, name, value, flags FROM items
      WHERE jsonb_exists(tags,'raw_drug') AND id LIKE 'item_raw_%'
      ORDER BY COALESCE((flags->>'cook_tier')::int,1), name`);
  if (!raws.length && !DRY) {
    console.error('✗ no item_raw_* found — run scripts/add-raw-supply.js FIRST. Refusing to overwrite Sully with an empty back-room menu.');
    process.exit(1);
  }
  if (!raws.length) console.warn('⚠ (dry) no item_raw_* found — the live run would abort here.');

  const { rows: fenceRows } = await query(`SELECT dialogue_tree FROM npcs WHERE id=$1`, [FENCE_ID]);
  if (!fenceRows.length) { console.error(`✗ fence ${FENCE_ID} not found`); process.exit(1); }
  const tree = asObj(fenceRows[0].dialogue_tree);

  // Build the raw menu + a quantity node per raw.
  const menuOpts = [];
  let qy = 40;
  for (const r of raws) {
    const key = r.id.replace(/^item_raw_/, '');
    const tier = Math.max(1, Math.min(5, Number(asObj(r.flags).cook_tier) || 1));
    const price = Math.max(1, Math.round((r.value || 1) * MARKUP));
    const qNode = 'bm_q_' + key;
    const need = TIER_TRUST[tier] || 0;
    const opt = { next: qNode, label: `${r.name} — ${price}₵/crate` };
    if (need > 0) opt.conditions = [{ flag: 'bm_trust', scope: 'player', op: 'gt', value: String(need - 1) }]; // ≥ need
    menuOpts.push(opt);

    tree[qNode] = {
      text: `"${r.name}. How many crates?" Sully doesn't write anything down. "${price}₵ apiece, dropped at the Scald."`,
      _vine: { x: 1040, y: qy },
      actions: [],
      options: [
        ...QTYS.map(q => ({
          label: `${q} crate${q === 1 ? '' : 's'} — ${q * price}₵`,
          actions: [{ action: 'PLACE_SMUGGLE_ORDER', params: { itemId: r.id, qty: q } }],
          next: 'bm_ordered',
        })),
        { next: 'bm_menu', label: 'On second thought — back.' },
      ],
    };
    qy += 40;
  }
  menuOpts.push({ next: 'root', label: 'Nothing tonight.' });

  tree.bm_menu = {
    text: `Sully sets down the glass he's been not-cleaning and leans in. "Back-room list. I don't touch the stuff — I just know a drone pilot who owes me. You point, it lands out at the Scald, and getting it home past the checkpoint is *your* lookout. What're you after?"`,
    _vine: { x: 700, y: 60 },
    actions: [],
    options: menuOpts,
  };
  tree.bm_ordered = {
    text: `"Done. Wheels are turning." He finally meets your eye, flat and level. "It'll be at the Scald inside a few minutes. Don't get pinched dragging it back through the checkpoint — that's a manufacturing beef, and I have never seen you before in my life."`,
    _vine: { x: 1360, y: 60 },
    actions: [],
    options: [{ next: 'root', label: 'Understood.' }],
  };
  tree.bm_broke = {
    text: `Sully snorts and goes back to the glass. "Come back when your credits clear. I run a cash business, and you're not the kind of face I extend credit to."`,
    _vine: { x: 1360, y: 240 },
    actions: [],
    options: [{ next: 'bm_menu', label: 'Fair. Let me look again.' }, { next: 'root', label: 'Never mind.' }],
  };

  // Inject the gated entry option into root (idempotent: drop any prior one first).
  const root = tree.root || (tree.root = { text: `Drink or don't, but don't just stand there breathing on my bar.`, _vine: { x: 40, y: 60 }, actions: [], options: [] });
  root.options = (root.options || []).filter(o => o.next !== 'bm_menu');
  const entry = {
    next: 'bm_menu',
    label: `[quietly] I hear you move more than drinks.`,
    conditions: [{ flag: 'dealer_inner_circle', scope: 'player', op: 'set' }],
  };
  const lastIsExit = root.options.length && !root.options[root.options.length - 1].next;
  root.options.splice(lastIsExit ? root.options.length - 1 : root.options.length, 0, entry); // before a trailing "Never mind."

  if (DRY) {
    console.log('\n— generated fence menu (root entry → bm_menu) —');
    for (const o of menuOpts) console.log(`  ${o.label}${o.conditions ? `   [needs ${o.conditions[0].flag} > ${o.conditions[0].value}]` : ''}`);
    console.log('\n— node keys written —\n  ' + Object.keys(tree).sort().join(', '));
    console.log('\n(dry run — nothing written)');
    process.exit(0);
  }
  await query(`UPDATE npcs SET dialogue_tree = $1::jsonb WHERE id=$2`, [JSON.stringify(tree), FENCE_ID]);
  console.log(`✓ ${FENCE_ID}: black-market branch (${raws.length} raw${raws.length === 1 ? '' : 's'} across tiers) wired into dialogue.`);
  console.log('Restart / reload the world so NPC + item caches pick this up.');
  process.exit(0);
}
main().catch((e) => { console.error('✗ add-blackmarket-fence failed:', e.message); process.exit(1); });
