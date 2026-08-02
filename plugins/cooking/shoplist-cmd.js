// `shoplist` — the verb over shoplist.js.
//
// Everything it prints is DERIVED: the list stores what you want, and whether
// each line is ticked is answered against your inventory at the moment you look.
// So there is no "mark as bought" step, and no way for the list to be wrong.
import { getList, holdings, answer, addShortfall, tidy, clearList, removeAt, catalogTemplate } from './shoplist.js';
import { savedRecipes } from './knowledge.js';
import { DISHES } from './dishes.js';
import { getItem } from '../../server/engine/items-cache.js';

// A saved recipe's signature read back as a `needs` map, so the player's own
// inventions go on the list exactly like the catalog's do.
function savedNeeds(blob) {
  const [, parts] = String(blob.sig || '').split('|');
  if (!parts) return null;
  const needs = {};
  for (const p of parts.split(',')) {
    const [name, n] = p.split(':');
    if (name) needs[name] = Number(n) || 1;
  }
  return Object.keys(needs).length ? { needs, keyItems: [], vessel: blob.vessel } : null;
}

export async function cmdShoplist(args, raw, player) {
  const sub = (args[0] || '').toLowerCase();
  const rest = String(raw || '').trim().split(/\s+/).slice(2).join(' ').trim();

  if (sub === 'clear') {
    await clearList(player.id);
    return { type: 'output', message: `List cleared.` };
  }

  if (sub === 'tidy') {
    const r = await tidy(player.id);
    return {
      type: 'output',
      message: r.removed
        ? `Crossed off ${r.removed} you've already got. ${r.left} left.`
        : `Nothing on it you've got yet.`,
    };
  }

  if (sub === 'drop' || sub === 'remove') {
    const n = parseInt(rest, 10);
    if (!Number.isInteger(n)) return { type: 'error', message: `Drop which line? ("shoplist drop 2")` };
    const r = await removeAt(player.id, n - 1);
    return r.ok
      ? { type: 'output', message: `Crossed off ${r.gone.label}.` }
      : { type: 'error', message: `There's no line ${n}.` };
  }

  if (sub === 'add') {
    if (!rest) return { type: 'error', message: `Add what? ("shoplist add stew")` };
    const hit = catalogTemplate(rest);
    let template = hit?.template, label = hit ? hit.key.replace(/_/g, ' ') : null;
    if (!template) {
      const mine = await savedRecipes(player.id);
      for (const [, blob] of mine) {
        if (blob.name.toLowerCase() !== rest.toLowerCase()) continue;
        template = savedNeeds(blob);
        label = blob.name;
        break;
      }
    }
    if (!template) return { type: 'error', message: `"${rest}" isn't a recipe you know.` };

    const r = await addShortfall(player.id, template, { label });
    return {
      type: 'output',
      message: r.added.length
        ? `Added to the list:\n${r.added.map(e => `  <span class="text-bright">${e.label}</span>`).join('\n')}`
        : `You've already got everything ${label} wants.`,
    };
  }

  // Bare `shoplist` — the list, answered.
  const list = await getList(player.id);
  if (!list.length) {
    return { type: 'output', message: `<span class="text-dim">Nothing on your list. <b>shoplist add &lt;recipe&gt;</b> puts what you're short of on it.</span>` };
  }
  const lines = [`<span class="text-bright">Shopping list</span>`];
  const rows = answer(list, await holdings(player.id));
  let done = 0;

  // Under the recipe that wanted them, not one flat run with "— for penne alla
  // gin" repeated down the side. A dish is several separate purchases; the
  // heading says which dish, the lines under it say what to hand over the
  // counter. The NUMBER on each line is still its index in the stored list, so
  // `shoplist drop 3` means the same thing it always did.
  const groups = new Map();
  rows.forEach((e, i) => {
    const key = e.for || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ e, i });
  });
  const ordered = [...groups.entries()].sort((a, b) =>
    (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || a[0].localeCompare(b[0]));

  for (const [forWhat, entries] of ordered) {
    const left = entries.filter(x => !x.e.done).length;
    const head = forWhat || 'odds and ends';
    lines.push(`  <span class="text-bright">${head}</span> <span class="text-dim">— ${
      left ? `${left} of ${entries.length} still to buy, separately` : 'all in hand'}</span>`);
    // Things you just buy, then the things you assemble. A `parts` group is one
    // object you buy in several pieces (the sauce is tomato AND gin AND cream);
    // the alternatives below are one errand you finish with any ONE of several.
    // Both are indented, so both have to say outright which they are — and the
    // group goes LAST, because a list reads as a walk down the aisles and a
    // composed thing is a stop on it rather than an item in the basket.
    const seen = new Set();
    const emit = ({ e, i }, indent) => {
      if (seen.has(i)) return;
      seen.add(i);
      if (e.done) done++;
      const mark = e.done ? `<span class="text-dim">[x]</span>` : `[ ]`;
      const opts = e.done ? [] : (e.ex || []);
      const head = e.done ? `<span class="text-dim">${e.label}</span>` : (e.base || e.label);
      lines.push(`${indent}${mark} ${i + 1}. ${head}`);
      // "or" between them, not a comma-separated run — a comma reads as a list of
      // things to buy, which is the exact opposite of what these are.
      if (opts.length) lines.push(`${indent}     <span class="text-dim">any one of: ${opts.join(' <b>or</b> ')}</span>`);
    };

    const partOrder = [];
    const byPart = new Map();
    // Inside a group the order is the order you make it in, which `partAt`
    // carries from the recipe — tomato, then gin, then cream.
    for (const x of entries.slice().sort((a, b) => (a.e.partAt ?? 0) - (b.e.partAt ?? 0))) {
      if (!x.e.part) continue;
      if (!byPart.has(x.e.part)) { byPart.set(x.e.part, []); partOrder.push(x.e.part); }
      byPart.get(x.e.part).push(x);
    }
    for (const x of entries) if (!x.e.part) emit(x, '    ');
    for (const partLabel of partOrder) {
      const members = byPart.get(partLabel);
      const short = members.filter(x => !x.e.done).length;
      lines.push(`    <span class="text-bright">${partLabel}</span> <span class="text-dim">— ${
        short ? `${members.length} thing${members.length === 1 ? '' : 's'} make it, all of them` : 'all in hand'}</span>`);
      for (const x of members) emit(x, '      ');
    }
  }
  lines.push(`<span class="text-dim">${done} of ${rows.length} in hand. <b>shoplist tidy</b> crosses those off for good.</span>`);
  return { type: 'output', message: lines.join('\n') };
}

// Everything still outstanding, as a lookup a shop can highlight against. Used
// by the vendor path — a list you have to hold up against the shelf yourself is
// only half a list.
export async function outstanding(player) {
  const list = await getList(player.id);
  if (!list.length) return null;
  const rows = answer(list, await holdings(player.id)).filter(e => !e.done);
  if (!rows.length) return null;
  return {
    profiles: new Set(rows.filter(e => e.k === 'p').map(e => e.v)),
    items: new Set(rows.filter(e => e.k === 'i').map(e => e.v)),
  };
}

// The shelf, marked. A shopping list you have to hold up against the stock
// yourself is only half a list — this is the other half, and it is the reason
// the list stores CLASSES rather than item ids: "500g of dense meat" can be
// satisfied by whatever this particular shop happens to stock, and the mark
// lands on it without anybody authoring a mapping.
//
// Read-only and derived: it sets a flag on entries the shelf already built.
export async function markShelf({ stock, playerId }) {
  if (!stock?.length || !playerId) return;
  const want = await outstanding({ id: playerId });
  if (!want) return;
  for (const entry of stock) markRow(entry, entry.item_id, getItem(entry.item_id)?.tags, want);
}

// One row, one question, asked the same way in both places: does this thing
// answer something still on the list? `food_also` counts because a tin of
// tomatoes is a liquid that is also a vegetable, and either answer is a real
// one at the shelf.
function markRow(entry, itemId, tags, want) {
  if (!entry || !itemId) return;
  const profile = tags?.food_profile || tags?.food_also || null;
  if (want.items.has(itemId) || (profile && want.profiles.has(profile))) entry.wanted = true;
}

// The same mark, on the boxes rather than the vendor's board. Half of a shop's
// stock is reached by opening the case it sits in rather than by talking to the
// clerk — and a shelf you have to hold the list up against yourself is only
// half a list, wherever you are standing when you read it.
//
// Every container, not just a shop's: your own fridge answering "this is the
// thing you wrote down" is the same question with the same answer.
export async function markContainer({ view, playerId }) {
  const boxes = [view?.containerItems, view?.secondary?.containerItems].filter(b => b?.length);
  if (!boxes.length || !playerId) return;
  const want = await outstanding({ id: playerId });
  if (!want) return;
  for (const box of boxes) for (const row of box) markRow(row, row.item_id, row.tags, want);
}
