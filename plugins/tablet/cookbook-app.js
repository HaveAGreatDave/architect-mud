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
import { getList, holdings, answer, addShortfall } from '../cooking/shoplist.js';
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

async function buildScreen(player, screenId, params) {
  const id = (params || '').trim();
  const { known, progress } = await cookbookState(player.id);

  // SHOPPING LIST — what you still have to go and buy.
  //
  // Every line is ANSWERED against your inventory at the moment you look, never
  // stored as "bought". So walking out of a shop with the onion ticks the box on
  // its own, with nothing having to fire when you bought it.
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
    const items = rows.map((e, i) => ({
      id: '',
      label: `${e.done ? '☑' : '☐'} ${e.label}`,
      sub: e.for ? `for ${e.for}${e.done ? ' · in hand' : ''}` : (e.done ? 'in hand' : ''),
      badge: e.done ? 'ready' : 'missing',
      _sort: e.done ? 1 : 0,
    })).sort((a, b) => a._sort - b._sort);
    const got = rows.filter(e => e.done).length;
    items.push({ id: '', label: `${got} of ${rows.length} in hand`, sub: '"shoplist tidy" crosses those off for good.', badge: got === rows.length ? 'ready' : 'missing' });
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
  return {
    message: r.added.length
      ? `Added ${r.added.length} to your shopping list.`
      : `You've already got everything that wants.`,
  };
}

registerTabletApp({
  id: 'cookbook', name: 'Cookbook', icon: '🍳', category: 'General',
  buildScreen, handleAction,
});
