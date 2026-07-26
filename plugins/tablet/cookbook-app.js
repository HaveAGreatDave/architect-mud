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
import { DISHES } from '../cooking/dishes.js';
import { PROFILES } from '../cooking/profiles.js';
import { cookbookState, UNTRIED } from '../cooking/knowledge.js';
import { DISCOVERY_ATTEMPTS } from '../cooking/config.js';
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

  const rows = [
    { label: 'Vessel', value: d.vessel || 'any' },
    { label: 'Difficulty', value: `${d.difficulty}` },
    { label: 'Ceiling', value: d.ceiling },
    { label: 'Your best', value: band === UNTRIED ? 'never cooked it' : band },
  ];

  for (const [profile, need] of Object.entries(d.needs)) {
    const line = needLine(profile, need);
    const [min] = range(need);
    const n = have[profile] || 0;
    rows.push({ label: line.label, value: `${line.value} needed · carrying ${n} ${n >= min ? '✓' : '✗'}` });
  }
  for (const profile of d.optional || []) {
    const label = (PROFILES[profile]?.label || profile).replace(/\b\w/g, c => c.toUpperCase());
    rows.push({ label, value: `optional · carrying ${have[profile] || 0}` });
  }

  return {
    view: 'detail',
    breadcrumb: ['Cookbook', titleFor(key)],
    detail: { id: key, name: titleFor(key), desc: d.blurb || '', rows },
    actions: [],
  };
}

registerTabletApp({
  id: 'cookbook', name: 'Cookbook', icon: '🍳', category: 'General',
  buildScreen,
});
