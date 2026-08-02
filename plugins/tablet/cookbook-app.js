// Tablet OS — Cookbook app. A reader over the cooking plugin's dish catalog and
// the player's own recipe knowledge; it owns no cooking logic and can't launch a
// cook (you cook by putting things in a pan, not by pressing a button here).
//
// What shows up:
//   • Every recipe you know — by discovery, by recipe card, or from an NPC —
//     with the best band you've ever achieved on it.
//   • A count of what you don't know yet, and nothing else about it. The
//     undiscovered half of the book is deliberately blank: the whole point of
//     the system is that combinations are found by trying them, and a checklist
//     of exact ingredient counts would turn discovery into data entry.
//
// The one exception is what you're holding: the detail screen tells you which
// of a known recipe's ingredient classes you currently carry, because that's
// planning rather than spoiling.
import { query } from '../../server/models/db.js';
import { DISHES, ingredientLine, methodLines, estimateCookMs } from '../cooking/dishes.js';
import { PROFILES } from '../cooking/profiles.js';
import { cookbookState, UNTRIED } from '../cooking/knowledge.js';
import { getList, holdings, answer, addShortfall, buyableExamples } from '../cooking/shoplist.js';
import { getItem, getItemCache } from '../../server/engine/items-cache.js';
import { DISCOVERY_ATTEMPTS, COOK_SECONDS_PER_KG } from '../cooking/config.js';
import { registerTabletApp } from './registry.js';

const BAND_ICON = {
  masterful: '★★★', excellent: '★★', good: '★', acceptable: '·', poor: '✗', [UNTRIED]: '—',
};

const titleFor = key => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const range = need => (Array.isArray(need) ? need : [need, need]);

function needLine(profile, need) {
  const [min, max] = range(need);
  const label = PROFILES[profile]?.label || profile.replace(/_/g, ' ');
  const qty = min === max ? `${min}` : `${min}–${max}`;
  return { label: label.replace(/\b\w/g, c => c.toUpperCase()), value: `${qty}` };
}

// Which food profiles the player is currently carrying, as a count per profile.
// One query, and it's the only reason this app touches the DB beyond the flags.
async function carriedProfiles(playerId) {
  const { rows } = await query(
    `SELECT i.tags->>'food_profile' AS profile, COUNT(*)::int AS n
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND i.tags->>'food_profile' IS NOT NULL
      GROUP BY 1`,
    [playerId]
  );
  const have = {};
  for (const r of rows) if (r.profile) have[r.profile] = r.n;
  return have;
}

// ── Ingredient detail ────────────────────────────────────────────────────────
// A shopping-list line used to lead nowhere: every row carried an empty id, and
// clicking one navigated the app with no params — which is the app root. So the
// list's own rows behaved like a Back button. They now open the thing they name.
//
// Two subjects, one screen id space, because a list holds two kinds of line:
//   __ing:p:<profile>   a CLASS  ("800g of liquid") — what would answer it
//   __ing:i:<item_id>   a THING  (a bottle of gin)  — what it is and what it counts as
// Both are read-only and derived; opening a line can't change the list.
const ING_PREFIX = '__ing:';

// The item a buyable example noun stands for. The list stores nouns (they're what
// you say over a counter, and they persist in a flag), so the id is resolved here
// at read time against the shelf — which also means an option whose item has since
// left the catalog quietly stops being clickable instead of opening a dead screen.
function itemForNoun(profile, noun) {
  const want = String(noun || '').toLowerCase().trim();
  if (!want) return null;
  for (const item of getItemCache().values()) {
    const tags = item?.tags || {};
    if (tags.food_profile !== profile) continue;
    if (String(tags.food_noun || item.name || '').toLowerCase().trim() === want) return item;
  }
  return null;
}

const itemRow = id => { try { return getItem(id); } catch { return null; } };

// What a profile does in a pan, in the words the recipe cards already use. Read
// off the profile itself, so a new class is described the day it's added.
function profileRows(profileName) {
  const p = PROFILES[profileName];
  if (!p) return [];
  const rows = [];
  if (p.unitWeight) rows.push({ label: 'One of these is', value: `${p.unitWeight}g` });
  rows.push({ label: 'Raw', value: p.targets?.raw || '—' });
  rows.push({ label: 'Cooked right', value: p.targets?.peak || '—' });
  rows.push({ label: 'Past its peak', value: `${p.targets?.over || '—'}, then ${p.targets?.burnt || '—'}` });
  rows.push({ label: 'Prep', value: p.needsPrep ? 'arrives whole — cut it down first' : 'goes in as it comes' });
  rows.push({
    label: 'In the pan',
    value: `${p.turns ? `turn it ${p.turns} time${p.turns === 1 ? '' : 's'}` : 'leave it alone'} · ${p.heatTolerance} heat`,
  });
  if (p.doneness) rows.push({ label: 'Doneness', value: p.doneness.levels.map(l => l.name).join(' / ') });
  if (p.modifier) rows.push({ label: 'Note', value: 'a seasoning, not an ingredient — it flavours the dish rather than being part of it' });
  rows.push({ label: 'Difficulty', value: `${p.difficulty}/10` });
  return rows;
}

// Which list lines want this thing, and how much of it is still outstanding.
// Answered against inventory like every other read of the list.
async function ingredientDetail(player, token) {
  const [kind, ...restParts] = String(token || '').split(':');
  const key = restParts.join(':');
  const rows = answer(await getList(player.id), await holdings(player.id));

  if (kind === 'p') {
    const p = PROFILES[key];
    if (!p) return { view: 'error', message: "Nothing on your list wants that." };
    const mine = rows.filter(e => e.k === 'p' && e.v === key);
    const name = (p.label || key).replace(/\b\w/g, c => c.toUpperCase());
    const out = [];
    for (const e of mine) {
      out.push({ label: e.for ? titleFor(e.for.replace(/ /g, '_')) : 'Odds and ends', value: `${e.base || e.label}${e.done ? ' · in hand' : ''}` });
    }
    if (mine.length) {
      const held = mine[0].have || 0;
      out.push({ label: 'Carrying', value: `${Math.round(held * 100) / 100} — about ${Math.round(held * (p.unitWeight || 0))}g` });
      // The alternatives, spelled out one per row rather than run together in a
      // sentence: this is the screen you read standing in the shop.
      const ex = buyableExamples(key);
      if (ex.length) ex.forEach((n, i) => out.push({ label: i === 0 ? 'Any one of' : '', value: n }));
      out.push({ label: '—', value: '' });
    }
    out.push(...profileRows(key));
    return {
      view: 'detail',
      breadcrumb: ['Cookbook', 'Shopping List', name],
      detail: {
        id: `${ING_PREFIX}p:${key}`, name,
        desc: `A class, not a thing — anything on the shelf that behaves like this counts towards the line.`,
        rows: out,
      },
    };
  }

  if (kind === 'i') {
    const item = itemRow(key);
    if (!item) return { view: 'error', message: "That isn't anything you can buy." };
    const tags = item.tags || {};
    const profile = tags.food_profile;
    const p = PROFILES[profile];
    const out = [];
    if (p) {
      out.push({ label: 'Counts as', value: (p.unitWeight && Number(item.weight))
        ? `${Math.round((Number(item.weight) / p.unitWeight) * 100) / 100} of ${p.label}`
        : p.label });
    }
    if (item.weight) out.push({ label: 'Weight', value: `${item.weight}g` });
    if (item.value) out.push({ label: 'Usually about', value: `₵${item.value}` });
    const wants = rows.filter(e => (e.k === 'i' && e.v === key) || (e.k === 'p' && e.v === profile));
    for (const e of wants) {
      out.push({ label: e.for ? titleFor(e.for.replace(/ /g, '_')) : 'On your list', value: `${e.base || e.label}${e.done ? ' · in hand' : ''}` });
    }
    if (p) { out.push({ label: '—', value: '' }); out.push(...profileRows(profile)); }
    return {
      view: 'detail',
      breadcrumb: ['Cookbook', 'Shopping List', item.name],
      detail: { id: `${ING_PREFIX}i:${key}`, name: item.name, desc: item.description || '', rows: out },
    };
  }

  return { view: 'error', message: "Nothing on your list wants that." };
}

async function buildScreen(player, screenId, params) {
  const id = (params || '').trim();
  const { known, progress } = await cookbookState(player.id);

  // SHOPPING LIST — what you still have to go and buy.
  //
  // Every line is ANSWERED against your inventory at the moment you look, never
  // stored as "bought". So walking out of a shop with the onion ticks the box on
  // its own, with nothing having to fire when you bought it.
  // A line on the list, opened. Never a navigation back — see ingredientDetail.
  if (id.startsWith(ING_PREFIX)) return ingredientDetail(player, id.slice(ING_PREFIX.length));

  if (id === '__shop') {
    const list = await getList(player.id);
    if (!list.length) {
      return {
        view: 'list', breadcrumb: ['Cookbook', 'Shopping List'],
        items: [{
          id: '', label: 'Nothing on it',
          sub: 'Open a recipe and add what you\'re short of, or type "shoplist add <recipe>".',
          badge: 'missing',
        }],
      };
    }
    const rows = answer(list, await holdings(player.id));
    // GROUPED UNDER THE RECIPE THAT WANTED THEM. A dish is not a thing you buy —
    // it's several things you buy and then cook, and a flat list of ingredients
    // with "for penne alla gin" repeated down the side read as one shopping
    // decision when it is four. The heading is the dish; the lines under it are
    // the shopping. Anything added without a recipe behind it keeps its own
    // heading at the bottom, because a list of loose wants is still a list.
    const groups = new Map();
    for (const e of rows) {
      const key = e.for || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const ordered = [...groups.entries()].sort((a, b) =>
      (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || a[0].localeCompare(b[0]));

    const items = [];
    for (const [forWhat, entries] of ordered) {
      const left = entries.filter(e => !e.done).length;
      items.push({
        id: '', group: true,
        label: forWhat ? titleFor(forWhat.replace(/ /g, '_')) : 'Odds and ends',
        sub: left
          ? `${left} of ${entries.length} still to buy — buy each one separately, then cook`
          : `everything it wants is in hand`,
        badge: left ? 'missing' : 'ready',
      });
      // COMPONENTS FIRST, under the thing they compose. A `parts` group is one
      // object made of several purchases — penne alla gin's sauce is tomato AND
      // gin AND cream — so it gets a parent line of its own and its members keep
      // their checkboxes underneath. That is the opposite of the alternatives
      // below, and the two must never render alike.
      const sorted = entries.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
      const loose = sorted.filter(e => !e.part);
      const parts = new Map();
      for (const e of sorted.filter(e => e.part)) {
        if (!parts.has(e.part)) parts.set(e.part, []);
        parts.get(e.part).push(e);
      }
      for (const [partLabel, members] of parts) {
        const short = members.filter(e => !e.done).length;
        // No checkbox on the parent: you don't buy "the sauce", you buy the three
        // things it's made of. A box here would be a fifth thing to shop for.
        items.push({
          id: '', child: true, label: partLabel,
          sub: short ? `${members.length} things that make it — you need all of them` : 'all of it is in hand',
          badge: short ? 'missing' : 'ready',
        });
        for (const e of members) {
          items.push({
            id: `${ING_PREFIX}${e.k}:${e.v}`, part: true,
            label: `${e.done ? '☑' : '☐'} ${e.done ? e.label : (e.base || e.label)}`,
            sub: e.done ? 'in hand' : '',
            badge: e.done ? 'ready' : 'missing',
          });
        }
      }
      for (const e of loose) {
        // A CLASS line is itself made of parts you have to go and buy, so it
        // gets the same treatment one level down — except its parts are
        // ALTERNATIVES, not a checklist. "400g of liquid" is one errand that
        // tinned tomatoes OR cream OR gin would each finish, and nesting them as
        // more checkboxes would have said "buy three", which is wrong. Hence the
        // options render without boxes, and the parent says how to read them.
        const opts = e.done ? [] : (e.ex || []);
        items.push({
          // The line opens the thing it names — the class, or the specific item.
          id: `${ING_PREFIX}${e.k}:${e.v}`, child: true,
          label: `${e.done ? '☑' : '☐'} ${e.done ? e.label : (e.base || e.label)}`,
          sub: e.done ? 'in hand' : (opts.length ? 'any one of these will do:' : ''),
          badge: e.done ? 'ready' : 'missing',
        });
        // An option opens the ITEM it names when the shelf has one, and stays a
        // quiet aside when it doesn't. Either way it never becomes a checkbox —
        // and every one after the first carries an OR, so a run of alternatives
        // can't be misread as a run of things to buy.
        opts.forEach((noun, n) => {
          const shelf = e.k === 'p' ? itemForNoun(e.v, noun) : null;
          items.push({ id: shelf ? `${ING_PREFIX}i:${shelf.id}` : '', option: true, or: n > 0, label: noun });
        });
      }
    }
    const got = rows.filter(e => e.done).length;
    items.push({ id: '', group: true, label: `${got} of ${rows.length} in hand`, sub: '"shoplist tidy" crosses those off for good.', badge: got === rows.length ? 'ready' : 'missing' });
    return { view: 'list', breadcrumb: ['Cookbook', 'Shopping List'], items };
  }

  // DETAIL
  if (id) {
    if (!DISHES[id] || !known.has(id)) return { view: 'error', message: "That's not in your cookbook." };
    return recipeDetail(player, id, known.get(id));
  }

  // ROOT
  const items = [...known.entries()]
    .filter(([key]) => DISHES[key])
    .map(([key, band]) => {
      const d = DISHES[key];
      const tried = band !== UNTRIED;
      return {
        id: key,
        label: `${BAND_ICON[band] || ''} ${titleFor(key)}`.trim(),
        sub: tried ? `${d.vessel} · best: ${band}` : `${d.vessel} · never cooked`,
        badge: tried ? 'ready' : 'missing',
        _sort: tried ? 0 : 1,
      };
    })
    .sort((a, b) => a._sort - b._sort || a.label.localeCompare(b.label));

  // Half-learned recipes: you know you're onto something, but not what it is
  // yet. Named only by its vessel and how far along you are — the whole point
  // of the repetition gate is that you earn the name by repeating the result.
  for (const [key, n] of progress.entries()) {
    if (known.has(key) || !DISHES[key]) continue;
    items.push({
      id: '', label: `◌ Something in a ${DISHES[key].vessel}`,
      sub: `You've made this ${n} time${n === 1 ? '' : 's'} — ${DISCOVERY_ATTEMPTS - n} more to write it down`,
      badge: 'missing', _sort: 2,
    });
  }
  items.sort((a, b) => (a._sort || 0) - (b._sort || 0) || a.label.localeCompare(b.label));

  const total = Object.keys(DISHES).length;
  if (!items.length) {
    return {
      view: 'list',
      breadcrumb: ['Cookbook'],
      items: [{
        id: '', label: 'Nothing written down yet',
        sub: `Put ingredients in a pan, pot or tray and cook them together. ${total} recipes exist.`,
        badge: 'missing',
      }],
    };
  }

  // The list sits at the top of the book, where a shopping list belongs.
  {
    const rows = answer(await getList(player.id), await holdings(player.id));
    const outstanding = rows.filter(e => !e.done).length;
    items.unshift({
      id: '__shop',
      label: `🛒 Shopping List${rows.length ? ` (${outstanding})` : ''}`,
      sub: rows.length
        ? (outstanding ? `${outstanding} still to buy` : 'everything on it is in hand')
        : 'nothing on it yet',
      badge: rows.length && !outstanding ? 'ready' : 'missing',
      _sort: -1,
    });
  }

  items.push({
    id: '', label: `${known.size} of ${total} recorded`,
    sub: `${total - known.size} still out there. Nobody's going to tell you what they are.`,
    badge: 'missing',
  });

  return { view: 'list', breadcrumb: ['Cookbook'], items };
}

async function recipeDetail(player, key, band) {
  const d = DISHES[key];
  const have = await carriedProfiles(player.id);

  // REAL MEASURES, not bare counts. Every number here is derived from the same
  // data the pan runs on — grams from each profile's unitWeight, the estimate
  // from its cook rate, the method from its turns/heat/doneness — so the card
  // can never promise something the cook won't do. Bare counts ("2 needed") were
  // technically true and useless: nobody has ever weighed out "2 dense meat".
  const rows = [];
  for (const [profile, need] of Object.entries(d.needs)) {
    const [min] = range(need);
    const n = have[profile] || 0;
    // The weight, then whatever the dish has to say about what that class is
    // FOR — "800g–1.2kg of liquid" alone is three ingredients hiding in one
    // number, and the note is where a named dish explains itself.
    const weight = ingredientLine(profile, need, d).replace(/ of [^—]*/, ' ');
    rows.push({
      label: (PROFILES[profile]?.label || profile).replace(/\b\w/g, c => c.toUpperCase()),
      value: `${weight.trim()} · carrying ${n} ${n >= min ? '✓' : '✗'}`,
    });
  }
  for (const profile of d.optional || []) {
    const label = (PROFILES[profile]?.label || profile).replace(/\b\w/g, c => c.toUpperCase());
    rows.push({ label, value: `optional · carrying ${have[profile] || 0}` });
  }

  rows.push({ label: '—', value: '' });
  methodLines(d).forEach((l, i) => rows.push({ label: i === 0 ? 'Method' : '', value: l }));

  const ms = estimateCookMs(d, COOK_SECONDS_PER_KG);
  if (ms > 0) {
    const mins = ms / 60000;
    rows.push({ label: 'Roughly', value: mins < 1 ? `${Math.round(ms / 1000)}s` : `${Math.round(mins * 2) / 2} min on an ordinary stove` });
  }
  rows.push({ label: 'Cook it in', value: d.vessel ? `a ${d.vessel}` : 'anything, or straight on the heat' });
  rows.push({ label: 'Difficulty', value: `${d.difficulty}/10` });
  rows.push({ label: 'Ceiling', value: d.ceiling });
  rows.push({ label: 'Your best', value: band === UNTRIED ? 'never cooked it' : band });

  return {
    view: 'detail',
    breadcrumb: ['Cookbook', titleFor(key)],
    detail: { id: key, name: titleFor(key), desc: d.blurb || '', rows },
    // The one action a recipe card should have: write down what you're short of.
    actions: [{ id: `shop:${key}`, label: 'Add missing to shopping list' }],
  };
}

// Adding to the list from a recipe card. It calls the same `addShortfall` the
// `shoplist add` verb does, so the app and the verb can't drift.
async function handleAction(player, actionId) {
  if (!String(actionId || '').startsWith('shop:')) return null;
  const key = actionId.slice(5);
  const d = DISHES[key];
  if (!d) return { message: `That isn't a recipe.` };
  const r = await addShortfall(player.id, d, { label: key.replace(/_/g, ' ') });
  // Land on the list itself. A bare { message } carries no `view`, so the shell
  // fell through every renderer and drew "Unknown screen." — and the one thing
  // you want to see after adding to a shopping list is the shopping list.
  const screen = await buildScreen(player, null, '__shop');
  return {
    ...screen,
    notice: r.added.length
      ? `Added ${r.added.length} to your shopping list.`
      : `You've already got everything that wants.`,
  };
}

registerTabletApp({
  id: 'cookbook', name: 'Cookbook', icon: '🍳', category: 'General',
  buildScreen, handleAction,
});
