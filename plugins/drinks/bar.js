// The bar: a counter that stocks everything, and the mixology HUD over it.
//
// A zone is a bar when a piece of its furniture carries `flags.bar_counter`. Every
// bar keeps the same stock: every item with a `drink_profile` in the freezer, and
// the glassware on the rack. Nothing is stocked as rows. `measure <thing>` charges
// you and hands you ONE measure (one pour, `custom_data.pours = 1`) of it, or a
// glass off the rack, and from there it's the ordinary game: `mix <x> into <glass>`,
// `mix <glass>`, `drink <glass>`.
//
// The HUD is a `workspace.provider` (plugins/workspace), so every button is a verb
// a player could have typed. The flow it lays out:
//   1. take a glass off the rack (paid)
//   2. tick what you want out of the freezer, press `→ tumbler`
//      (`prepare tumbler with rum, cola, ice`: the planner pays for each measure
//      you aren't already holding, then pours it in)
//   3. `mix tumbler` to finish it, then `drink tumbler`
//
// Cost: one query per build (what you carry). The stock is the item cache.
import { query } from '../../server/models/db.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { getItemCache } from '../../server/engine/items-cache.js';
import { giveItemById } from '../../server/engine/inventory.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { escapeHtml as esc } from '../../server/engine/html.js';
import { DRINKS } from './recipes.js';
import { DRINK_PROFILES, poursOf } from './profiles.js';
import { isDrinkware, drinkwareKind, buildOf, drinkOf, isDirty, capacityOf } from './vessel.js';

// What a measure costs over the bottle's own price per pour. It's a bar.
export const BAR_MARKUP = 2;
// The glasses a bar keeps on its rack. Mugs, cups and teapots are a café's.
const RACK_KINDS = new Set(['glass', 'tumbler', 'coupe', 'tankard', 'shaker']);

export const isBarZone = (zoneId) => getZoneFurniture(zoneId).some((f) => f.flags?.bar_counter);
const counterOf = (zoneId) => getZoneFurniture(zoneId).find((f) => f.flags?.bar_counter) || null;

// "bottle of dark rum" pours as "dark rum". The measure carries this as its name.
export const measureName = (item) => String(item?.name || '')
  .replace(/^(bottle|can|crate|carton|pot|hip flask|jar) of\s+/i, '').trim() || item?.name;

export const measurePrice = (item) => {
  const per = (Number(item?.value) || 0) / Math.max(1, Number(item?.tags?.pour_units) || 1);
  return Math.max(1, Math.ceil(per * BAR_MARKUP));
};

// The freezer and the rack, from the item cache. Rebuilt on demand; cheap.
export function barStock() {
  const freezer = [], rack = [];
  for (const it of getItemCache().values()) {
    const t = it?.tags || {};
    if (t.drink_profile && DRINK_PROFILES[t.drink_profile]) freezer.push({ item: it, name: measureName(it), price: measurePrice(it), profile: t.drink_profile });
    else if (t.drinkware && RACK_KINDS.has(t.drinkware_kind)) rack.push({ item: it, name: it.name, price: Math.max(1, Number(it.value) || 1), glass: true });
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  freezer.sort((a, b) => a.profile.localeCompare(b.profile) || byName(a, b));
  rack.sort(byName);
  return { freezer, rack };
}

// The stock entry a typed name means: the whole name, then a word of it.
export function findStock(str) {
  const q = String(str || '').toLowerCase().trim();
  if (!q) return null;
  const { freezer, rack } = barStock(), all = [...freezer, ...rack];
  return all.find((s) => s.name.toLowerCase() === q || s.item.name.toLowerCase() === q)
    || all.find((s) => s.name.toLowerCase().includes(q) || s.item.name.toLowerCase().includes(q))
    || null;
}

// `measure <thing>`: pay, and take one measure out of the freezer, or a glass off the rack.
export async function cmdMeasure(args, raw, player) {
  if (!isBarZone(player.current_zone)) return { type: 'error', message: `There's no bar here to take anything from.` };
  const str = args.join(' ').trim();
  if (!str) return { type: 'error', message: `Measure what? The freezer has the lot: try <b>workspace</b> to see it.` };
  const s = findStock(str);
  if (!s) return { type: 'error', message: `The bar doesn't keep "${esc(str)}".` };
  if (!(await adjustCredits(player, -s.price, query, 'bar:measure'))) {
    return { type: 'error', message: `That's ₵${s.price}, and you haven't got it.` };
  }
  if (s.glass) {
    await giveItemById(player.id, s.item.id, 1, { stack: true });
    return { type: 'use', message: `You take a ${esc(s.name)} off the rack. <span class="text-dim">₵${s.price}.</span>` };
  }
  await giveItemById(player.id, s.item.id, 1, { stack: false, customData: { pours: 1, name: s.name, bar_measure: true } });
  return { type: 'use', message: `You pour a measure of ${esc(s.name)} out of the freezer. <span class="text-dim">₵${s.price}.</span>` };
}

const label = (p) => DRINK_PROFILES[p]?.label || p;

// ── the HUD ─────────────────────────────────────────────────────────────────

async function carried(player) {
  const { rows } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data, i.name, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.is_equipped = 0 AND pi.container_id IS NULL`,
    [player.id]);
  return rows.map((r) => ({ ...r, custom_data: typeof r.custom_data === 'string' ? JSON.parse(r.custom_data) : r.custom_data }));
}
const shownName = (r) => r.custom_data?.name || r.name;

export async function buildBar(player) {
  const rows = await carried(player);
  const glasses = rows.filter(isDrinkware);
  const ingredients = rows.filter((r) => r.tags?.drink_profile && DRINK_PROFILES[r.tags.drink_profile]);
  const open = glasses.find((g) => !drinkOf(g)) || null;   // where the per-row chips pour

  const { freezer, rack } = barStock();
  const storage = [
    {
      id: 'bar_freezer', name: 'The freezer', preserves: 'frozen', other: 0,
      items: freezer.map((s) => ({
        id: `stock:${s.item.id}`, name: s.name, qty: null, kind: 'food', state: label(s.profile), live: false,
        notes: [`₵${s.price} a measure`, ...(s.item.tags?.abv ? [`${s.item.tags.abv}%`] : [])],
        actions: [{ label: `take ₵${s.price}`, command: `measure ${s.name}`, role: 'take', hint: 'one measure, paid for as you take it' }],
      })),
    },
    {
      id: 'bar_rack', name: 'The glass rack', preserves: null, other: 0,
      items: rack.map((s) => ({
        id: `rack:${s.item.id}`, name: s.name, qty: null, kind: 'tool', state: `holds ${capacityOf(s.item)}`, live: false,
        notes: [`₵${s.price}, yours to keep`],
        actions: [{ label: `take ₵${s.price}`, command: `measure ${s.name}`, hint: 'off the rack and into your hand' }],
      })),
    },
  ];

  // The glasses in your hand are the working area: a glass is a station.
  const area = glasses.map((g) => {
    const name = shownName(g).toLowerCase(), drink = drinkOf(g), build = buildOf(g);
    const actions = [];
    if (drink) {
      actions.push({ label: 'drink', command: `drink ${name}`, hint: 'one serving' });
    } else {
      if (build.length) actions.push({ label: drinkwareKind(g) === 'shaker' ? 'shake it' : 'mix it', command: `mix ${name}`, hint: 'finish the drink' });
      if (isDirty(g) || build.length) actions.push({ label: 'rinse', command: `rinse ${name}`, hint: 'tip it out and start again' });
    }
    return {
      id: g.id, name: shownName(g), place: 'in hand', heat: null, hot: false,
      state: drink ? `${drink.name}, ${drink.band} · ${drink.servings}/${drink.capacity}` : build.length ? 'part-built' : isDirty(g) ? 'dirty' : 'empty',
      contents: build.map((c, i) => ({ id: `${g.id}:${i}`, name: c.name, qty: null, kind: 'food', state: label(c.profile), notes: [], live: false, actions: [] })),
      ...(drink ? {} : { batch: { label: `→ ${name}`, prefix: `prepare ${name} with `, sep: ', ', hint: `pour everything ticked into the ${name}, paying for what you aren't holding` } }),
      actions,
    };
  });

  const components = ingredients.map((r) => ({
    id: r.id, name: shownName(r), qty: Number(r.quantity) > 1 ? Number(r.quantity) : null, kind: 'food',
    state: label(r.tags.drink_profile), live: false,
    notes: [`${poursOf({ ...r, quantity: 1 })} pour${poursOf({ ...r, quantity: 1 }) === 1 ? '' : 's'}`],
    actions: open ? [{ label: `→ ${shownName(open).toLowerCase()}`, command: `mix ${shownName(r).toLowerCase()} into ${shownName(open).toLowerCase()}`, role: 'stow' }] : [],
  }));

  const counter = counterOf(player.current_zone);
  const status = [
    { label: 'Bar', value: counter?.name || 'the bar', state: 'ok' },
    { label: 'Credits', value: `₵${player.credits ?? 0}`, state: Number(player.credits) > 0 ? 'ok' : 'warn' },
    { label: 'Glass', value: open ? shownName(open) : glasses.length ? 'all full' : 'take one off the rack', state: open ? 'ok' : 'warn' },
  ];

  // Every cold classic, with what it wants. Drinks are public knowledge (systems-drinks.md).
  const recipes = Object.entries(DRINKS).filter(([, t]) => !t.hot).map(([key, t]) => {
    const want = Object.entries(t.needs || {}).map(([p, n]) => `${Array.isArray(n) ? n[0] : n}× ${label(p)}`);
    return {
      key, name: t.noun, known: true, pct: null, missing: [], ingredients: want,
      suggestion: `${want.join(', ')} · in a ${(t.vessels || ['glass']).join(' or ')}`,
      method: [t.blurb, `Take a ${(t.vessels || ['glass'])[0]} off the rack, tick ${want.join(', ')} in the freezer, pour, then mix.`],
      actions: [{ label: 'card', command: `recipes ${key}`, hint: 'the full recipe card' }],
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const assistant = {
    groups: [{ label: 'On the menu', recipes }],
    unknown: 0,
    note: 'Take a glass off the rack, tick what you want in the freezer, pour it in, then mix it. You pay for each measure as it comes out.',
  };

  return { storage, area, components, tools: [], status, assistant };
}

// `prepare <glass> with a, b, c`: one measure per name, poured in, in the order ticked.
// A name you're already holding a measure of uses that; otherwise it's bought first.
export async function planBar(player, target, items) {
  const rows = await carried(player);
  const tq = String(target || '').toLowerCase();
  const glass = rows.find((r) => isDrinkware(r) && shownName(r).toLowerCase().includes(tq));
  const steps = [];
  if (!glass) {
    const s = findStock(target);
    if (!s?.glass) return { error: `You haven't got a ${target} to pour into.` };
    steps.push(`measure ${s.name}`);
  } else if (drinkOf(glass)) return { error: `The ${shownName(glass)} has a drink in it already. Drink it or rinse it.` };
  const held = rows.filter((r) => r.tags?.drink_profile);
  const used = new Set();
  for (const n of items) {
    const q = n.toLowerCase();
    const mine = held.find((r) => !used.has(r.id) && shownName(r).toLowerCase() === q);
    if (mine) used.add(mine.id);
    else {
      const s = findStock(n);
      if (!s || s.glass) return { error: `The bar doesn't keep "${n}".` };
      steps.push(`measure ${s.name}`);
    }
    steps.push(`mix ${n} into ${glass ? shownName(glass).toLowerCase() : tq}`);
  }
  return { label: `Building it in the ${glass ? shownName(glass) : target}:`, steps, vessel: glass ? shownName(glass) : target };
}

export function barProvider(player) {
  if (!isBarZone(player.current_zone)) return undefined;
  // Above the kitchen (20): a bar with a back kitchen opens on the bar.
  return { key: 'bar', label: 'THE BAR', priority: 25, build: buildBar, planLoad: planBar };
}

