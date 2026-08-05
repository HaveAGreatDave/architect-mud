// Workspace plugin regression — the provider seam, the payload shape, and the
// one invariant the whole design rests on: a workspace build is DERIVED.
//
// The load-bearing cases here are (a) a room with no provider refuses cleanly
// rather than rendering an empty HUD, (b) building twice returns the same
// payload and writes nothing, and (c) the two-level storage read finds a pot
// left in a cabinet AND what is inside that pot — the half a plain join misses.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { insertFurniture, deleteFurniture } from '../../server/engine/world.js';
import { getRegisteredCommands } from '../../server/engine/plugins.js';
import { builtinCommandNames } from '../../server/engine/commands/index.js';
import { getRegisteredSpecializedActions } from '../../server/engine/specializedActions.js';
import { clearFlagsByPrefix, setFlagById } from '../../server/engine/flags.js';
import { learnRecipe, FLAG_PREFIX, SAVED_PREFIX } from '../cooking/knowledge.js';
import { DISHES } from '../cooking/dishes.js';

// Every action in a payload, flattened — the panel's whole reachable surface.
function allActions(view) {
  const out = [];
  const eat = (list) => { for (const c of list || []) out.push(...(c.actions || [])); };
  eat(view.components); eat(view.tools);
  for (const v of view.area || []) { out.push(...(v.actions || [])); eat(v.contents); }
  for (const s of view.storage || []) eat(s.items);
  // The Assistant carries no actions today; walking it anyway means phase 4's
  // "Prepare Recipe" is swept by the verb check the day it lands, rather than
  // the day somebody remembers to widen this.
  for (const g of view.assistant?.groups || []) {
    eat(g.recipes);
    // The runbook is the same claim as an action — "this is a command you could
    // have typed" — so it is swept by the same verb check. A step with no
    // command is prose ("leave it alone"), and there is no verb to check.
    for (const r of g.recipes || []) {
      for (const s of r.walkthrough || []) if (s.command) out.push({ label: s.text, command: s.command });
    }
  }
  return out;
}
const labels = (list) => (list || []).map(a => a.label);

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const saved = player.current_zone;

  const Z = 'zone_workspace_regress';
  const BARE = 'zone_workspace_regress_bare';
  const STOVE = 'furn_workspace_regress_stove';
  const CAB = 'furn_workspace_regress_cabinet';
  const LAB = 'furn_workspace_regress_lab';
  const PAN = 'item_workspace_regress_pan';
  const STEAK = 'item_workspace_regress_steak';
  const JUNK = 'item_workspace_regress_junk';
  const BLADE = 'item_workspace_regress_knife';
  const POT = 'item_workspace_regress_pot';
  const BROTH = 'item_workspace_regress_broth';
  const SPUD = 'item_workspace_regress_spud';
  const PENNE = 'item_workspace_regress_penne';
  const TAP = 'furn_workspace_regress_sink';

  const made = [];

  try {
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test workspace pan','a test pan','misc',10,900,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2`,
      [PAN, JSON.stringify({ vessel: true, vessel_kind: 'pan', container: 4000, heat_distribution: 1, heat_retention: 1 })]
    );
    await reloadItem(PAN);
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test workspace cutlet','a test cutlet','consumable',5,400,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2, weight=400`,
      [STEAK, JSON.stringify({ consumable: true, needs_cooking: true, food_profile: 'dense_meat', restore_hunger: 20, stackable: false })]
    );
    await reloadItem(STEAK);
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test workspace spanner','a test spanner','misc',5,300,'{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [JUNK]
    );
    await reloadItem(JUNK);
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test workspace knife','a test knife','misc',5,200,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2`,
      [BLADE, JSON.stringify({ can_chop: true })]
    );
    await reloadItem(BLADE);
    // Stew's three requirements, at exactly one unit each (liquid 400g,
    // starchy_vegetable 250g), plus the pot it has to be made in.
    for (const [id, name, weight, tags] of [
      [POT, 'test workspace pot', 1200, { vessel: true, vessel_kind: 'pot', container: 6000 }],
      [BROTH, 'test workspace broth', 400, { consumable: true, needs_cooking: true, food_profile: 'liquid' }],
      [SPUD, 'test workspace spud', 250, { consumable: true, needs_cooking: true, food_profile: 'starchy_vegetable' }],
    ]) {
      await query(
        `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,$2,$2,'misc',5,$3,$4)
         ON CONFLICT (id) DO UPDATE SET tags=$4, weight=$3`,
        [id, name, weight, JSON.stringify(tags)]
      );
      await reloadItem(id);
    }

    // ── A room that is nobody's workspace ────────────────────────────────────
    player.current_zone = BARE;
    let r = await run('workspace');
    check('a room with no provider refuses instead of rendering an empty HUD',
      r?.type === 'error' && /nothing here to work at/i.test(r.message), JSON.stringify(r));

    // ── A kitchen ───────────────────────────────────────────────────────────
    await insertFurniture({
      id: STOVE, name: 'test workspace cooktop', description: 'a test cooktop', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({ stove_tier: 'mid' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');
    await insertFurniture({
      id: CAB, name: 'test workspace cabinet', description: 'a test cabinet', object_type: 'container',
      zone_id: Z, flags: JSON.stringify({ dish_cabinet: true, container: 40000 }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id, object_type=EXCLUDED.object_type');
    player.current_zone = Z;

    r = await run('workspace');
    check('a stove makes the room a kitchen workspace',
      r?.type === 'workspace_view' && r.provider === 'kitchen', JSON.stringify(r?.type ?? r));
    check('...and the alias reaches the same view', (await run('bench'))?.type === 'workspace_view');
    check('...reporting the stove and the power state in Status',
      r.status?.some(s => s.label === 'Stove' && /cooktop/.test(s.value))
      && r.status?.some(s => s.label === 'Power'), JSON.stringify(r.status));
    check('an empty kitchen reports itself empty rather than pretending otherwise',
      r.empty === true && !r.area.some(v => !v.idle) && !r.components.length,
      JSON.stringify({ empty: r.empty, area: r.area.length }));
    // A free ring is listed as a place to put a pan — the panel's own answer to
    // "is there a burner going spare". It must NOT make the room read as busy,
    // which is the whole reason `empty` skips idle rows above.
    check('...while still listing the cold burner as free',
      r.area.some(v => v.idle && /cooktop/.test(v.name) && /free/.test(v.place)), JSON.stringify(r.area));

    // ── Carried food and a carried pan ──────────────────────────────────────
    const panId = randomUUID(), steakId = randomUUID(), looseId = randomUUID();
    made.push(panId, steakId, looseId);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [panId, player.id, PAN]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [steakId, player.id, STEAK, panId]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [looseId, player.id, STEAK]);

    r = await run('workspace');
    const carriedPan = r.area?.find(v => v.id === panId);
    check('a carried pan is in the Preparation Area, in hand', carriedPan?.place === 'in hand', JSON.stringify(r.area));
    check('...with what is in it listed as its contents',
      carriedPan?.contents?.length === 1 && carriedPan.contents[0].id === steakId, JSON.stringify(carriedPan?.contents));
    check('food that is not in a pan is a loose Component, not a vessel',
      r.components?.some(c => c.id === looseId) && !r.components.some(c => c.id === steakId), JSON.stringify(r.components));
    check('...and raw food reads as raw', r.components.find(c => c.id === looseId)?.state === 'raw');
    check('the room is no longer reported empty', r.empty === false);

    // ── The two-level storage read ──────────────────────────────────────────
    // A pot in a cabinet is one join away; what is IN that pot is two, because
    // its contents are parented to the pot rather than to the cabinet. This is
    // the case the UNION exists for.
    const boxPanId = randomUUID(), boxSteakId = randomUUID(), boxJunkId = randomUUID();
    made.push(boxPanId, boxSteakId, boxJunkId);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [boxPanId, player.id, PAN, CAB]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [boxSteakId, player.id, STEAK, boxPanId]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [boxJunkId, player.id, JUNK, CAB]);

    r = await run('workspace');
    const stored = r.area?.find(v => v.id === boxPanId);
    check('a pan left in a cabinet is in the Preparation Area, and says where',
      stored?.place === 'in the test workspace cabinet', JSON.stringify(r.area?.map(a => a.place)));
    check('...and what is inside THAT pan is found too (the two-level read)',
      stored?.contents?.length === 1 && stored.contents[0].id === boxSteakId, JSON.stringify(stored?.contents));

    const box = r.storage?.find(s => s.id === CAB);
    check('Storage lists the cabinet', !!box, JSON.stringify(r.storage));
    check('...listing what a kitchen cares about', box?.items?.some(i => i.id === boxPanId));
    check('...and counting the rest rather than listing it',
      box?.other === 1 && !box.items.some(i => i.id === boxJunkId), JSON.stringify({ other: box?.other, items: box?.items?.length }));

    // ── The invariant: a build is DERIVED ───────────────────────────────────
    const before = (await query(
      `SELECT id, quantity, container_id, custom_data FROM player_inventory WHERE player_id=$1 ORDER BY id`, [player.id]
    )).rows;
    const a = await run('workspace');
    const b = await run('workspace');
    check('two consecutive builds return the same payload',
      JSON.stringify(a) === JSON.stringify(b), 'payload drifted between identical builds');
    const after = (await query(
      `SELECT id, quantity, container_id, custom_data FROM player_inventory WHERE player_id=$1 ORDER BY id`, [player.id]
    )).rows;
    check('...and building writes nothing', JSON.stringify(before) === JSON.stringify(after),
      'a workspace build mutated player_inventory');

    // ── The rule, mechanically ──────────────────────────────────────────────
    //
    // This is THE case for the whole design: every action the HUD offers must be
    // a verb a player could have typed. If one isn't, the panel has grown a
    // private code path and the rule is broken — which is exactly the failure
    // that turns a HUD into a second, divergent implementation.
    const known = new Set([
      ...builtinCommandNames(),
      ...getRegisteredCommands(),
      ...Object.keys(getRegisteredSpecializedActions()),
    ]);
    const acts = allActions(a);
    check('the panel offers actions at all', acts.length > 0);
    const unknown = acts.map(x => x.command.trim().split(/\s+/)[0]).filter(v => !known.has(v));
    check('every action is a verb a player could have typed', unknown.length === 0, [...new Set(unknown)].join(', '));
    check('...and every action carries a literal command, never an opaque id',
      acts.every(x => typeof x.command === 'string' && x.command.length), JSON.stringify(acts.slice(0, 3)));

    // ── The gates are coarse, but they are not absent ───────────────────────
    const looseActs = labels(a.components.find(c => c.id === looseId)?.actions);
    check('raw meat offers the prep that applies to it',
      looseActs.includes('score') && looseActs.includes('tenderise'), looseActs.join(','));
    check('...and offers to put it in the pan you are holding',
      looseActs.some(l => l.startsWith('→')), looseActs.join(','));
    check('...but not mince, with no blade in reach', !looseActs.includes('mince'), looseActs.join(','));

    const bladeId = randomUUID();
    made.push(bladeId);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [bladeId, player.id, BLADE]);
    const withBlade = labels((await run('workspace')).components.find(c => c.id === looseId)?.actions);
    check('a knife in reach is what puts mince on the panel', withBlade.includes('mince'), withBlade.join(','));

    // Two pans are in play — one in hand, one in the cabinet — and only the one
    // in hand is a stow target, because `stow x in y` cannot reach into a room
    // box. Offering the other would be offering a command that fails.
    check('a vessel stored in a room box is never offered as a stow target',
      withBlade.filter(l => l.startsWith('→')).length === 1, withBlade.join(','));

    // Storage offers exactly one thing: get it out.
    const boxItemActs = labels(a.storage.find(s => s.id === CAB)?.items?.find(i => i.id === boxPanId)?.actions);
    check('storage offers taking, and nothing else', boxItemActs.join(',') === 'take', boxItemActs.join(','));

    // A partial command is marked by its trailing space — the client fills the
    // input line rather than firing it, because the verb wants an object the HUD
    // cannot choose.
    const partials = acts.filter(x => x.command.endsWith(' '));
    check('a two-object verb is offered as a PREFIX, not a guess',
      partials.every(x => /…$/.test(x.label)), JSON.stringify(partials));

    // ── Phase 3: the Recipe Assistant ───────────────────────────────────────
    //
    // The rule it exists under: it scores only recipes you KNOW. Listing all 47
    // templates with their exact shortfalls would be the ingredient checklist
    // the Cookbook app deliberately refuses to be, delivered faster — and
    // discovery is the whole point of the cooking system.
    await clearFlagsByPrefix(player.id, FLAG_PREFIX);
    let view = await run('workspace');
    check('an empty cookbook suggests nothing, and says so',
      view.assistant && !view.assistant.groups.length && /Nothing written down yet/.test(view.assistant.note),
      JSON.stringify(view.assistant));
    check('...and never names a recipe you have not discovered',
      !JSON.stringify(view.assistant).toLowerCase().includes('stew'), JSON.stringify(view.assistant));

    await learnRecipe(player.id, 'stew');
    view = await run('workspace');
    const findRecipe = (v, key) => (v.assistant.groups || [])
      .flatMap(g => g.recipes.map(r => ({ ...r, group: g.label })))
      .find(r => r.key === key);

    let stew = findRecipe(view, 'stew');
    check('a known recipe is scored against what is in the room', !!stew, JSON.stringify(view.assistant));
    check('...with meat in hand but no liquid or starch, it is short two things',
      stew.group === 'Missing Ingredients' && stew.missing.length === 2, JSON.stringify(stew));
    check('...and the shortfall is a real weight, not a bare count',
      stew.missing.some(m => /g of /.test(m)), JSON.stringify(stew.missing));
    check('...and it reports the pot it has no way to be made in',
      stew.equipment.includes('a pot'), JSON.stringify(stew.equipment));
    check('...at a completion under 100%', stew.pct > 0 && stew.pct < 100, stew.pct);

    // Everything stew wants, in the room. A pot in the CABINET still counts:
    // the Assistant is planning, not execution.
    const potId = randomUUID(), brothId = randomUUID(), spudId = randomUUID();
    made.push(potId, brothId, spudId);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [potId, player.id, POT, CAB]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [brothId, player.id, BROTH]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [spudId, player.id, SPUD]);

    view = await run('workspace');
    stew = findRecipe(view, 'stew');
    check('with every requirement in reach it reads Available Now',
      stew.group === 'Available Now' && stew.pct === 100 && !stew.missing.length, JSON.stringify(stew));
    check('...and suggests a first step rather than dictating one', !!stew.suggestion, JSON.stringify(stew));
    check('the undiscovered half is a COUNT and nothing more',
      view.assistant.unknown === Object.keys(DISHES).length - 1
      && !/ricotta|liquid:/i.test(view.assistant.note), view.assistant.note);

    // A dish already made is dinner, not an ingredient.
    await query(`UPDATE player_inventory SET custom_data = '{"dish":"stew","cooked":true}'::jsonb WHERE id=$1`, [brothId]);
    stew = findRecipe(await run('workspace'), 'stew');
    check('a finished dish is never counted as an ingredient toward another',
      stew.group !== 'Available Now' && stew.missing.length === 1, JSON.stringify(stew));
    await query(`UPDATE player_inventory SET custom_data = '{}'::jsonb WHERE id=$1`, [brothId]);

    // ── A room that is two workspaces at once ───────────────────────────────
    //
    // The seam's real test: a kitchen with a chem lab in the back. Both
    // providers answer, the highest priority renders, and the other is reachable
    // by name — through the same verb, with no special case anywhere.
    {
      await insertFurniture({
        id: LAB, name: 'test workspace chem bench', description: 'a test bench', object_type: 'container',
        zone_id: Z, flags: JSON.stringify({ crafting_station: 'chem_lab' }),
      }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id, object_type=EXCLUDED.object_type');

      const both = await run('workspace');
      check('a room that is two workspaces reports both',
        (both.providers || []).length === 2, JSON.stringify(both.providers));
      const other = await run('workspace chembench');
      check('...and naming one picks it', other.provider === 'chembench', other.provider);
      check('...rendering the other domain through the identical payload',
        other.type === 'workspace_view' && Array.isArray(other.status) && Array.isArray(other.area),
        Object.keys(other).join(','));
      check('...while the default stays the higher-priority one — a stove means a kitchen',
        both.provider === 'kitchen', both.provider);
      await deleteFurniture(LAB).catch(() => {});
    }

    // ── Your own recipes score alongside the catalog's ──────────────────────
    {
      await setFlagById(player.id, `${SAVED_PREFIX}house-special`, JSON.stringify({
        name: 'House Special', sig: 'pot|dense_meat:1,liquid:1,starchy_vegetable:1',
        vessel: 'pot', family: 'stew', complexity: 3, best: 'good', author: player.handle,
      }));
      const v = await run('workspace');
      const own = (v.assistant.groups || []).flatMap(g => g.recipes).find(x => x.name === 'House Special');
      check('a recipe you invented is scored on the same arithmetic as the catalog',
        !!own && own.own === true, JSON.stringify(v.assistant.groups?.map(g => g.recipes.map(r => r.name))));
      check('...and prepares under the name YOU gave it',
        own.actions?.[0]?.command === 'prepare House Special', JSON.stringify(own.actions));
      check('...and the count line says the book has two halves',
        /of your own/.test(v.assistant.note), v.assistant.note);
      await clearFlagsByPrefix(player.id, SAVED_PREFIX);
    }

    // ── Phase 4: Prepare is a PLAN, not a claim ─────────────────────────────
    stew = findRecipe(await run('workspace'), 'stew');   // the dish above is undone; it's ready again
    check('a ready recipe offers to prepare itself',
      (stew.actions || []).some(x => x.command === 'prepare stew'), JSON.stringify(stew.actions));

    // ── The runbook: the whole dish, written as commands ────────────────────
    {
      const w = stew.walkthrough || [];
      check('a ready recipe carries a step-by-step runbook', w.length >= 3, JSON.stringify(w));
      check('...that loads the pan before it lights it',
        w.findIndex(s => /^stow /.test(s.command || '')) < w.findIndex(s => /^cook /.test(s.command || '')),
        JSON.stringify(w.map(s => s.command)));
      check('...and ends on plating, which is the player\'s call and never prepare\'s',
        /^plate /.test(w[w.length - 1]?.command || ''), JSON.stringify(w[w.length - 1]));
      check('...while every step names a row or a vessel, never an id',
        !w.some(s => /\b(inv|item)_[0-9a-f-]{8}/.test(s.command || '') && !/^pullid /.test(s.command)),
        JSON.stringify(w.map(s => s.command)));
    }

    // ── The whole method, and exactly which rows it would use ───────────────
    check('a recipe carries its whole method, not just the first line',
      Array.isArray(stew.method) && stew.method.length >= 1 && stew.method[0] === stew.suggestion,
      JSON.stringify(stew.method));
    check('...and the ingredient list in real weights',
      (stew.ingredients || []).some(l => /g of /.test(l)), JSON.stringify(stew.ingredients));
    check('...and names the exact rows it would use, wherever they are',
      stew.uses.includes(looseId) && stew.uses.includes(brothId)
      && stew.uses.includes(spudId) && stew.uses.includes(potId), JSON.stringify(stew.uses));
    check('...including the pot that is still in the cabinet — that is the point',
      stew.uses.includes(potId), JSON.stringify(stew.uses));
    const promised = new Set(stew.uses);

    let r2 = await run('prepare nonsense soufflé');
    check('preparing a recipe you do not know is refused, and says where to look',
      r2?.type === 'error' && /isn't a recipe you know/.test(r2.message), JSON.stringify(r2));

    r2 = await run('prepare stew');
    check('prepare gathers the recipe into the pot', r2?.type === 'output' && /Ready/.test(r2.message), JSON.stringify(r2));
    check('...naming every step it ran, so it reads as commands and not magic',
      /pullid /.test(r2.message) && /stow .* in /.test(r2.message), JSON.stringify(r2));

    const potRow = (await query('SELECT container_id FROM player_inventory WHERE id=$1', [potId])).rows[0];
    check('...having pulled the pot out of the cabinet first', potRow.container_id === null, potRow.container_id);
    const inPot = (await query('SELECT id FROM player_inventory WHERE container_id=$1', [potId])).rows.map(x => x.id);
    check('...and everything the recipe needs is now in it',
      inPot.includes(brothId) && inPot.includes(spudId) && inPot.includes(looseId), JSON.stringify(inPot));
    // THE case for sharing one picker: the panel highlighted these rows, and
    // these are the rows that moved. Two implementations of "which onion" would
    // show you one thing and hand you another.
    check('prepare takes exactly the rows the panel highlighted',
      inPot.every(id => promised.has(id)) && [...promised].filter(id => id !== potId).every(id => inPot.includes(id)),
      JSON.stringify({ promised: [...promised], inPot }));

    // It stops at a loaded vessel. Heat is where the skill is — which burner,
    // when to turn, when to plate — and a planner that cooked for you would be
    // playing the interesting half of the game.
    check('prepare never cooks — the pot is loaded, not lit',
      !(await query('SELECT 1 FROM player_inventory WHERE container_id=$1 AND jsonb_exists(custom_data,$2)', [potId, 'cooking'])).rows.length);

    r2 = await run('prepare stew');
    check('a second prepare has nothing left to do', r2?.type === 'error', JSON.stringify(r2));

    // THE case for the whole design: the world moved, so the step that depended
    // on it fails and the run stops — no reservation, nothing stranded.
    await query('UPDATE player_inventory SET container_id=NULL WHERE container_id=$1', [potId]);
    await query('DELETE FROM player_inventory WHERE id=$1', [spudId]);
    made.splice(made.indexOf(spudId), 1);
    r2 = await run('prepare stew');
    check('an ingredient that vanished between plan and run stops it cleanly, not silently',
      r2?.type === 'error' && /short/i.test(r2.message), JSON.stringify(r2));

    // ── The tap, end to end ─────────────────────────────────────────────────
    //
    // Dry starch now refuses to cook without liquid, which means the HUD has a
    // new way to strand somebody: offer `cook` on a pan the stove will reject.
    // Everything below is one chain — the tap is in the room, the panel says so,
    // the panel offers the verb, the verb puts water in the pan, and the pan
    // then cooks. A break anywhere in it is a player standing at a stove being
    // told no by a system that never told them why.
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test workspace penne','a test penne','misc',5,125,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2, weight=125`,
      [PENNE, JSON.stringify({ consumable: true, needs_cooking: true, food_profile: 'dry_starch' })]
    );
    await reloadItem(PENNE);

    // Clear the bench so the only pan in play is the one this case is about.
    await query('UPDATE player_inventory SET container_id=NULL WHERE container_id=$1', [potId]);
    const penneId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,container_id) VALUES ($1,$2,$3,1,$4)`,
      [penneId, player.id, PENNE, potId]);
    made.push(penneId);

    let w = await run('workspace');
    check('a kitchen with no tap says so rather than staying silent about it',
      w.status?.some(s => s.label === 'Water' && s.value === 'NONE'), JSON.stringify(w.status));

    let dry = await run(`cook test workspace pot`);
    check('dry starch on a dry stove is refused, not quietly cooked',
      dry?.type === 'error' && /scorch/.test(dry.message), JSON.stringify(dry));

    await insertFurniture({
      id: TAP, name: 'test workspace sink', description: 'a test sink', object_type: 'sink',
      zone_id: Z, flags: JSON.stringify({ water_source: true }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    w = await run('workspace');
    check('...and with a tap in the room the Status board names it',
      w.status?.some(s => s.label === 'Water' && /SINK/i.test(s.value)), JSON.stringify(w.status));
    const potActs = labels(w.area.find(v => v.id === potId)?.actions);
    check('...and the pan of pasta is offered the tap as a command',
      potActs.includes('fill'), JSON.stringify(potActs));

    const filled = await run('fill test workspace pot');
    check('fill puts water in the pan', filled?.type === 'use' && /fill/i.test(filled.message), JSON.stringify(filled));
    const water = (await query(
      `SELECT id, item_id FROM player_inventory WHERE container_id=$1 AND item_id='item_water'`, [potId])).rows;
    check('...as an ordinary ingredient ROW, not a flag on the vessel', water.length === 1, JSON.stringify(water));
    if (water.length) made.push(water[0].id);

    check('...and filling twice is refused rather than flooding the pan',
      (await run('fill test workspace pot'))?.type === 'error');

    check('empty tips it back out again', (await run('empty test workspace pot'))?.type === 'use');
    check('...and the pan is dry afterwards',
      !(await query(`SELECT 1 FROM player_inventory WHERE container_id=$1 AND item_id='item_water'`, [potId])).rows.length);

    // `prepare` plans the fill rather than handing back a pan the stove will
    // refuse. A saved recipe is the cheapest way to state "a dish of starch and
    // nothing wet" — every starch dish in the catalog wants four other things in
    // the pan before it reaches this branch.
    {
      await query('UPDATE player_inventory SET container_id=NULL WHERE id=$1', [penneId]);
      await setFlagById(player.id, `${SAVED_PREFIX}boiled-penne`, JSON.stringify({
        name: 'Boiled Penne', sig: 'pot|dry_starch:1',
        vessel: 'pot', family: 'pasta', complexity: 1, best: 'good', author: player.handle,
      }));
      const planned = await run('prepare Boiled Penne');
      check('prepare plans the tap when the dish needs water',
        planned?.type === 'output' && /fill /.test(planned.message), JSON.stringify(planned));
      check('...and the pan really is wet when it stops',
        (await query(`SELECT 1 FROM player_inventory WHERE container_id=$1 AND item_id='item_water'`, [potId])).rows.length === 1);
      await clearFlagsByPrefix(player.id, SAVED_PREFIX);
      for (const row of (await query(
        `SELECT id FROM player_inventory WHERE container_id=$1 AND item_id='item_water'`, [potId])).rows) made.push(row.id);
    }

    const wet = await run('cook test workspace pot');
    check('...and now the same pan cooks', wet?.type !== 'error', JSON.stringify(wet));

    const drained = await run('drain test workspace pot');
    check('drain takes the starch off the heat', drained?.type === 'output', JSON.stringify(drained));
    check('...and the water actually goes down the drain',
      !(await query(`SELECT 1 FROM player_inventory WHERE container_id=$1 AND item_id='item_water'`, [potId])).rows.length);

    // The other half of the routing: `empty` on a pan holding nothing of ours
    // must NOT be claimed here, or the day a pan becomes fillable the drinks
    // path silently loses the verb.
    check('empty falls through for a pan holding no water of ours',
      (await run('empty test workspace pot'))?.type !== 'use');

  } finally {
    player.current_zone = saved;
    if (made.length) await query(`DELETE FROM player_inventory WHERE id = ANY($1)`, [made]);
    await deleteFurniture(STOVE).catch(() => {});
    await deleteFurniture(CAB).catch(() => {});
    await deleteFurniture(TAP).catch(() => {});
    await clearFlagsByPrefix(player.id, FLAG_PREFIX).catch(() => {});
    const items = [PAN, STEAK, JUNK, BLADE, POT, BROTH, SPUD, PENNE];
    await query('DELETE FROM items WHERE id = ANY($1)', [items]).catch(() => {});
    for (const id of items) deleteItemCache(id);
  }

  // ── The written workspace (bottom Display Mode rung) ───────────────────────
  // This one could NOT be a suppression the way the card reveal is: the HUD
  // aggregates state that is nowhere else in the log. So it renders the SAME
  // payload the panel does, and what matters is that nothing is dropped and that
  // every action stays a verb string a player could have typed.
  {
    const { _test: ws } = await import('./index.js');
    const view = {
      title: 'KITCHEN',
      status: [{ label: 'Power', value: 'ONLINE', state: 'ok' }, { label: 'Stove', value: 'NONE', state: 'off' }],
      area: [{ id: 'a', name: 'iron pan', state: 'a finished dish', live: true,
               actions: [{ label: 'plate', command: 'plate iron pan' }] }],
      storage: [{ id: 'b', name: 'rat haunch', qty: 3, kind: 'food', state: 'raw', notes: ['minced'] }],
      components: [], tools: [{ id: 'c', name: 'boning knife' }],
      providers: [{ key: 'kitchen', label: 'Kitchen' }, { key: 'chembench', label: 'Chem Bench' }],
      assistant: {
        groups: [{ label: 'Ready', recipes: [
          { name: 'rat stew', pct: 100, missing: [], equipment: [],
            actions: [{ label: 'prepare', command: 'prepare rat stew' }] },
          { name: 'hash', pct: 60, missing: ['onion'], equipment: [] },
        ] }],
        note: '3 of 47 recorded. 44 still out there.',
      },
      empty: false,
    };
    const t = ws.renderWorkspaceText(view);

    check('workspace text: names the working area', /KITCHEN/.test(t), t.slice(0, 60));
    check('workspace text: carries the status readout', /Power/.test(t) && /ONLINE/.test(t));
    check('workspace text: an offline status is flagged, not silently dropped', /text-red/.test(t));
    check('workspace text: lists what is on the surface', /iron pan/.test(t));
    check('workspace text: lists what is within reach', /rat haunch/.test(t));
    check('workspace text: carries quantity and prep notes', /×3/.test(t) && /minced/.test(t), t);
    check('workspace text: lists tools', /boning knife/.test(t));
    // A cook in progress is the one thing on the panel that MOVES; the panel dims
    // everything else to say so, and the log has to say it in words.
    check('workspace text: marks the live cook', /text-cyan/.test(t));
    // The founding rule: every action is a verb string, not an opaque id.
    check('workspace text: component actions are real commands',
      t.includes('data-cmd="plate iron pan"'), t);
    check('workspace text: assistant actions are real commands',
      t.includes('data-cmd="prepare rat stew"'));
    check('workspace text: a shortfall says WHAT is short', /onion/.test(t));
    // …but only for recipes you already know — the provider decides that, and the
    // renderer must not invent a listing of the undiscovered half.
    check('workspace text: closes on the provider note about what is undiscovered',
      /44 still out there/.test(t), t.slice(-120));
    check('workspace text: offers the other provider in the room',
      t.includes('workspace chembench'));

    const bare = ws.renderWorkspaceText({ title: 'KITCHEN', empty: true, providers: [] });
    check('workspace text: a bare bench says so rather than rendering blank', /bare/.test(bare), bare);
  }
}
