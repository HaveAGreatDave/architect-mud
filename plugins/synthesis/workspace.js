// The `chembench` Preparation Workspace provider.
//
// This file exists to prove a claim the workspace plugin has been making since
// phase 1: that the HUD is domain-agnostic, and a second workspace costs a
// provider rather than a rewrite. It is the test of that, and the answer is that
// NOTHING in plugins/workspace or client/game/js/panels/workspace.js changed to
// add a chemistry bench — the payload shape, the renderer, the action dispatch
// and the plan runner are all reused untouched.
//
// The vocabulary is completely different from the kitchen's — reagents, tiers,
// a station quality bonus, a shared vault instead of a pan — and none of it
// leaked upward. What the two providers share is the SHAPE: storage, an area you
// work at, components, tools, status, an assistant, and actions that are verb
// strings a player could have typed.
//
// Cost, same contract as the kitchen: two queries (what you carry; what the
// room's containers hold). Recipes, drugs, furniture and station quality are all
// in-memory caches.
//
// The import from ./index.js is a deliberate cycle (index imports this file to
// register the hook). It is safe because both `synthRecipes` and
// `resolveIngredients` are hoisted FUNCTION DECLARATIONS and are only called at
// request time, never while the module graph is still initialising.
import { query } from '../../server/models/db.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { getZonePowerStatus } from '../../server/engine/environment.js';
import { getItem } from '../../server/engine/items-cache.js';
import { effectiveSkill } from '../../server/engine/skills.js';
import { synthRecipes, resolveIngredients, drugForOutput, cookTier, cookDiff, SPLICE_MIN_SKILL } from './index.js';

const titleise = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());

// A lab you can actually work at. A lab behind a concealment cabinet is not one:
// `flags.concealed` is what keeps it out of the room description, and a HUD that
// listed it would be the one hole that made the disguise pointless — the same
// check `findWorkspace` makes before it will cook anything.
function labsInZone(zoneId) {
  return getZoneFurniture(zoneId).filter(f => f.flags?.crafting_station && !f.flags?.concealed);
}

const QUALITY_BONUS = { pristine: 4, refined: 2 };

// Every item id any cookable recipe asks for. Built from the in-memory recipe
// cache, so tagging a new reagent into a recipe makes it show up here with no
// edit — the same "one tag and it works" property the cooking profiles have.
function reagentIds() {
  const out = new Set();
  for (const r of synthRecipes()) for (const ing of r.ingredients || []) if (ing.item_id) out.add(ing.item_id);
  return out;
}

const component = (row, kind, actions = []) => ({
  id: row.id,
  name: row.custom_data?.name || row.name,
  qty: Number(row.quantity) > 1 ? Number(row.quantity) : null,
  kind,
  state: null,
  notes: [],
  live: false,
  actions,
});

export async function buildBench(player) {
  const zoneId = player.current_zone;
  const labs = labsInZone(zoneId);
  const lab = labs[0];
  const boxes = getZoneFurniture(zoneId).filter(f => f.object_type === 'container' && !f.flags?.concealed);
  const boxIds = new Set(boxes.map(f => f.id));

  const reagents = reagentIds();

  // ── Query 1: what you carry ───────────────────────────────────────────────
  const { rows: carried } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data, pi.container_id, i.name, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.is_equipped = 0`,
    [player.id]
  );

  // ── Query 2: what the room's containers hold — the lab vault included ─────
  //
  // The vault's rows are owned by a per-lab sentinel rather than by any player
  // (`_vault_<labId>`), which is exactly why a plain inventory read misses them
  // and this second query is not optional.
  const { rows: stored } = boxes.length
    ? await query(
      `SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data, pi.container_id, i.name, i.tags
         FROM player_inventory pi
         JOIN items i ON i.id = pi.item_id
         JOIN furniture f ON f.id = pi.container_id
        WHERE f.zone_id = $1 AND (f.object_type = 'container' OR f.flags ? 'crafting_station')`,
      [zoneId]
    )
    : { rows: [] };

  const byId = new Map();
  for (const r of [...carried, ...stored]) if (!byId.has(r.id)) byId.set(r.id, r);
  const childrenOf = new Map();
  for (const r of byId.values()) {
    if (!r.container_id) continue;
    if (!childrenOf.has(r.container_id)) childrenOf.set(r.container_id, []);
    childrenOf.get(r.container_id).push(r);
  }

  const isReagent = r => reagents.has(r.item_id);
  const isDrug = r => !!r.tags?.drug || !!r.custom_data?.potency;
  const kindOf = r => (isReagent(r) ? 'food' : isDrug(r) ? 'tool' : null);

  // ── Preparation Area — the bench, and what's sitting in its vault ─────────
  const area = labs.map(f => ({
    id: f.id,
    name: f.name,
    place: f.flags?.station_quality ? `${f.flags.station_quality} station` : 'a working bench',
    heat: null,
    hot: false,
    contents: (childrenOf.get(f.id) || []).map(r => component(r, kindOf(r) || 'tool', [
      { label: 'take', command: `pullid ${r.id}`, hint: 'out of the vault and into your hands' },
    ])),
    actions: [
      { label: 'synthesize', command: 'synthesize', hint: 'open the cook list at this bench' },
      { label: 'open', command: `opencontainer ${f.id}`, hint: 'the vault' },
    ],
  }));

  // ── Components — reagents and drugs on you ───────────────────────────────
  const onYou = r => !boxIds.has(r.container_id) && !labs.some(f => f.id === r.container_id);
  const stowActions = r => (lab ? [{ label: '→ vault', command: `stowid ${r.id} ${lab.id}` }] : []);

  const components = carried.filter(r => onYou(r) && isReagent(r))
    .map(r => component(r, 'food', stowActions(r)));
  const tools = carried.filter(r => onYou(r) && isDrug(r) && !isReagent(r))
    .map(r => component(r, 'tool', stowActions(r)));

  // ── Storage — ordinary room containers, minus the bench itself ───────────
  const storage = boxes.filter(f => !labs.some(l => l.id === f.id)).map(f => {
    const inside = childrenOf.get(f.id) || [];
    const shown = inside.filter(r => kindOf(r));
    return {
      id: f.id,
      name: f.name,
      preserves: f.flags?.preserves ?? null,
      items: shown.map(r => component(r, kindOf(r), [{ label: 'take', command: `pullid ${r.id}` }])),
      other: inside.length - shown.length,
    };
  }).filter(s => s.items.length || s.other);

  // ── Status ───────────────────────────────────────────────────────────────
  const powered = getZonePowerStatus(zoneId) === 'powered';
  const chem = await effectiveSkill(player, 'chemistry');
  const status = [
    { label: 'Power', value: powered ? 'ONLINE' : 'OFFLINE', state: powered ? 'ok' : 'off' },
    lab
      ? { label: 'Bench', value: `${lab.name} · ${lab.flags.station_quality || 'standard'}`, state: 'ok' }
      : { label: 'Bench', value: 'NONE', state: 'off' },
    { label: 'Chemistry', value: `rank ${chem}`, state: 'ok' },
    {
      label: 'Splice',
      value: chem >= SPLICE_MIN_SKILL ? 'AVAILABLE' : `LOCKED — rank ${SPLICE_MIN_SKILL}`,
      state: chem >= SPLICE_MIN_SKILL ? 'ok' : 'warn',
    },
  ];
  const bonus = QUALITY_BONUS[lab?.flags?.station_quality];
  if (bonus) status.push({ label: 'Station bonus', value: `+${bonus}`, state: 'ok' });

  // ── Assistant — what this bench could turn out right now ─────────────────
  //
  // Deliberately UNLIKE the kitchen's, and the difference is the point: chemistry
  // recipes are not discovered by experiment, they're gated on rank, so there is
  // nothing to spoil by listing them. The kitchen hides its undiscovered half
  // because discovery is its whole mechanic; this one has no such thing to
  // protect, and a chemist who can't see what the bench does can't plan a buy.
  const invForResolve = carried.map(r => ({ id: r.id, item_id: r.item_id, quantity: r.quantity, name: r.name }));
  const groups = { ready: [], close: [], short: [], locked: [] };
  for (const recipe of synthRecipes()) {
    const drug = drugForOutput(recipe);
    const tier = cookTier(drug);
    const missing = [];
    const uses = [];
    const ingredients = [];
    for (const ing of recipe.ingredients || []) {
      if (!ing.item_id || !ing.quantity) continue;
      const label = getItem(ing.item_id)?.name || ing.item_id.replace(/^item_/, '').replace(/_/g, ' ');
      ingredients.push(`${ing.quantity}x ${label}`);
      // The exact rows this cook would consume, so the panel can point at them
      // wherever they are — the same job `uses` does for the kitchen.
      const held = invForResolve.filter(x => x.item_id === ing.item_id);
      let got = 0;
      for (const row of held) { if (got >= ing.quantity) break; got += Number(row.quantity || 0); uses.push(row.id); }
      if (got < ing.quantity) missing.push(`${ing.quantity - got}x ${label}`);
    }
    const need = (recipe.ingredients || []).filter(i => i.item_id && i.quantity).length || 1;
    const locked = Object.entries(recipe.skill_req || {}).some(([sid, rank]) => sid === 'chemistry' && chem < rank);
    const entry = {
      key: recipe.id,
      name: drug?.name ? titleise(drug.name) : recipe.name,
      vessel: 'chem lab',
      band: null,
      pct: Math.round(100 * (need - missing.length) / need),
      missing,
      equipment: lab ? [] : ['a chem lab'],
      uses,
      ingredients,
      // Derived, like the kitchen's — a bench cook is one skill check and one
      // minigame, so the method is short and honest rather than padded out.
      method: [
        `Load the bench with the reagents above.`,
        `<b>synthesize ${recipe.name}</b> arms the reaction; hold it stable to score.`,
        `Difficulty ${cookDiff(tier)} against Chemistry${bonus ? `, +${bonus} from this station` : ''}.`,
        `The finished product goes into the bench vault, not your pockets — pull it out.`,
      ],
      suggestion: `Tier ${tier} · difficulty ${cookDiff(tier)}`,
      actions: (!missing.length && lab && !locked)
        ? [{ label: 'synthesize', command: `synthesize ${recipe.name}`, hint: 'arms the stabilise minigame' }]
        : [],
    };
    const bucket = locked ? 'locked'
      : (entry.equipment.length && !missing.length) ? 'close'
      : !missing.length ? 'ready'
      : 'short';
    groups[bucket].push(entry);
  }

  const LABELS = { ready: 'Available Now', close: 'Missing Equipment', short: 'Missing Reagents', locked: 'Above Your Rank' };
  const assistant = {
    groups: Object.entries(groups)
      .filter(([, list]) => list.length)
      .map(([k, list]) => ({ label: LABELS[k], recipes: list.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name)) })),
    unknown: 0,
    note: chem >= SPLICE_MIN_SKILL
      ? `Chemistry ${chem}. You can splice — <b>splice</b> at the bench.`
      : `Chemistry ${chem}. Splicing opens at ${SPLICE_MIN_SKILL}.`,
  };

  return { storage, area, components, tools, status, assistant };
}

export function workspaceProvider(player) {
  if (!labsInZone(player.current_zone).length) return undefined;
  return {
    key: 'chembench',
    // Between the kitchen's two: a room with a STOVE (20) defaults to the
    // kitchen, because that's what a stove is for; a room with only a dish
    // cabinet (10) and a lab defaults to the bench. Either way the other is one
    // `workspace <key>` away, and the panel shows a chip for it — which is the
    // honest answer to an ambiguity `cook` itself resolves with a SIFT prompt.
    priority: 15,
    build: buildBench,
  };
}
