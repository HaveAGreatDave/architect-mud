// Tablet OS — Bar app. A reader over the drinks catalogue: what you can make,
// what goes in it, and what you're carrying toward it. It owns no mixing logic
// and can't pour anything (you pour by putting things in a glass, not by
// pressing a button here) — same rule the Cookbook follows.
//
// ONE DELIBERATE DIFFERENCE FROM THE COOKBOOK. Cooking hides the recipes you
// haven't discovered, because working out that meat plus liquid plus potato is
// a stew IS the cooking game. Drinks are not that game: a negroni is public
// knowledge, printed on the back of every bottle in the world, and pretending a
// bartender has to reverse-engineer one would be tedious rather than mysterious.
// So nothing here is ever LOCKED and the SKILL is in pouring it well — the band
// you hit, not whether you knew it existed.
//
// It is, however, FILTERED. The default list is what you can actually pour right
// now, because a wall of forty drinks you can't make is a worse answer to "what
// can I do with this" than a short list of three. One tap shows the whole
// catalogue, with the missing ingredients spelled out — so the filter is a
// convenience, never a gate, and the paragraph above still holds.
import { query } from '../../server/models/db.js';
import { DRINKS, measureLine, methodOf, bestPossibleBand } from '../drinks/recipes.js';
import { DRINK_PROFILES } from '../drinks/profiles.js';
import { POUR_ML } from '../drinks/config.js';
import { registerTabletApp } from './registry.js';

const titleFor = key => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// What the player is carrying, by drink class — one query, and the only reason
// this app touches the database at all.
async function carriedProfiles(playerId) {
  const { rows } = await query(
    `SELECT i.tags->>'drink_profile' AS profile, COALESCE(SUM(pi.quantity),0)::int AS n
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND i.tags->>'drink_profile' IS NOT NULL
      GROUP BY 1`,
    [playerId]
  );
  const have = {};
  for (const r of rows) if (r.profile) have[r.profile] = r.n;
  return have;
}

// Do you hold at least one of everything this drink requires? Cheap, and it's
// what turns the list from a menu into a plan.
function canMake(template, have) {
  for (const profile of Object.keys(template.needs || {})) {
    if (!(have[profile] > 0)) return false;
  }
  return true;
}

// The list is reached with no params; a drink id opens its card. SHOW_ALL is a
// sentinel id rather than a second screen because a list row's id arrives as the
// screen's PARAMS (the tablet's nav keeps the current screen and swaps params) —
// so a row is the only control an app-defined list actually has.
const SHOW_ALL = '*all';

// What's missing, in the player's words rather than the schema's — this is the
// whole reason showing an unmakeable drink is worth anything.
function missingLabels(t, have) {
  return Object.keys(t.needs || {})
    .filter(p => !(have[p] > 0))
    .map(p => (DRINK_PROFILES[p]?.label || p));
}

async function buildScreen(player, screenId, params) {
  const id = (params || '').trim();
  const have = await carriedProfiles(player.id);

  if (id && id !== SHOW_ALL) {
    if (!DRINKS[id]) return { view: 'error', message: "Never heard of it." };
    return drinkDetail(id, have);
  }

  const showAll = id === SHOW_ALL;

  const all = Object.entries(DRINKS).map(([key, t]) => {
    const ready = canMake(t, have);
    const bits = [t.vessels ? t.vessels[0] : 'anything'];
    if (t.hot) bits.push('needs heat');
    if (t.shaken) bits.push('shaken');
    let sub = `${bits.join(' · ')} · difficulty ${t.difficulty}/10`;
    if (!ready) {
      // Name the gap. "missing" alone tells you nothing you can act on.
      const gaps = missingLabels(t, have);
      sub = gaps.length ? `need ${gaps.join(', ')}` : sub;
    }
    return {
      id: key,
      label: titleFor(key),
      sub,
      badge: ready ? 'ready' : 'missing',
      _ready: ready,
    };
  });

  const readyCount = all.filter(i => i._ready).length;
  const shown = (showAll ? all : all.filter(i => i._ready))
    .sort((a, b) => (a._ready === b._ready ? 0 : a._ready ? -1 : 1) || a.label.localeCompare(b.label));

  // The toggle, always last, always present — including when the filtered list is
  // empty, which is exactly when you most want to see what you're missing.
  const hidden = all.length - readyCount;
  shown.push(showAll
    ? {
        id: '', label: `Showing all ${all.length}`,
        sub: `${readyCount} you could pour right now. Tap a drink for what it needs.`,
        badge: 'ready',
      }
    : {
        id: SHOW_ALL,
        label: hidden ? `Show everything (${hidden} more)` : 'Show everything',
        sub: readyCount
          ? 'What you could pour if you went shopping.'
          : "You aren't carrying the makings of anything. That's its own kind of clarity.",
        badge: 'missing',
      });

  return { view: 'list', breadcrumb: showAll ? ['Mixology', 'Everything'] : ['Mixology'], items: shown };
}

function drinkDetail(key, have) {
  const t = DRINKS[key];
  const rows = [];

  // Real measures, converted from pours at 25ml each — the same arithmetic the
  // text card runs, over the same template the matcher uses.
  for (const [profile, need] of Object.entries(t.needs || {})) {
    const n = have[profile] || 0;
    rows.push({
      label: (DRINK_PROFILES[profile]?.label || profile).replace(/\b\w/g, c => c.toUpperCase()),
      value: `${measureLine(profile, need, POUR_ML).replace(/ of .*$/, '')} · carrying ${n} ${n > 0 ? '✓' : '✗'}`,
    });
  }
  for (const profile of t.optional || []) {
    const label = (DRINK_PROFILES[profile]?.label || profile).replace(/\b\w/g, c => c.toUpperCase());
    rows.push({ label, value: `optional · carrying ${have[profile] || 0}` });
  }

  rows.push({ label: '—', value: '' });
  rows.push({ label: 'Method', value: methodOf(t) });
  rows.push({ label: 'Serve in', value: t.vessels ? t.vessels.join(' or ') : 'anything to hand' });
  if (t.hot) rows.push({ label: 'Needs', value: 'a kettle or better' });
  if (t.keyItems?.length) rows.push({ label: 'Non-negotiable', value: 'the right bottle — no substitutions' });
  rows.push({ label: 'Difficulty', value: `${t.difficulty}/10` });
  rows.push({ label: 'Best possible', value: bestPossibleBand(t) || '—' });

  return {
    view: 'detail',
    breadcrumb: ['Mixology', titleFor(key)],
    detail: { id: key, name: titleFor(key), desc: t.blurb || '', rows },
    actions: [],
  };
}

registerTabletApp({
  // id stays 'bar' — it is the nav token and the TOS_APP_ICONS key, and renaming it
  // would break every saved home-screen order. Only the display name changed.
  id: 'bar', name: 'Mixology', icon: '🥃', category: 'General',
  verbs: ['mix', 'brew'],
  buildScreen,
});
