// parley: talking about somebody else. Name another person ("do you know Molly?") and the
// one you're talking to says what they are to them: family, a partner, an ex, a friend,
// a flatmate, somebody from work, somebody they can't stand, or nobody they know.
//
// Who knows whom is worked out from what the world already holds, strongest first:
//   - `flags.parley.knows: { npcId: kind }` on either side (lover, ex, rival, friend,
//     family, boss, crush): authored, wins;
//   - `flags.kin`, or one home and one surname: family;
//   - one home: flatmate;
//   - the outings network (friendsOf): friend;
//   - one workplace: workmate.
// Partners and exes are guarded below `familiar`: a stranger asking gets a short answer.
//
// Sync and query-free. The name index is rebuilt when the NPC count changes.

import { world } from '../../server/engine/world.js';
import { relationAtLeast } from '../../server/engine/relations.js';
import { friendsOf } from '../outings/index.js';
import { normalise } from './parse.js';

const RECIPROCAL = { boss: 'staff', staff: 'boss' };
const proper = (w) => /^[A-Z]/.test(w) && !/^(The|A|An)$/.test(w);
const words = (npc) => String(npc?.name || '').trim().split(/\s+/).filter(Boolean);
export const firstOf = (npc) => { const w = words(npc)[0] || ''; return proper(w) ? w : null; };
const surnameOf = (npc) => { const w = words(npc); return w.length > 1 && proper(w[0]) ? w[w.length - 1] : null; };

// ── Who's named ──────────────────────────────────────────────────────────────
let index = { size: -1, full: [], first: new Map() };
function nameIndex() {
  if (index.size === world.npcs.size) return index;
  const full = [], first = new Map(), clash = new Set();
  for (const n of world.npcs.values()) {
    if (n.flags?.set_aside || n.instanceId != null) continue;
    const f = firstOf(n);
    if (!f) continue;
    const nf = normalise(n.name);
    if (words(n).length > 1) full.push([nf, n.id]);
    const k = normalise(f);
    if (k.length < 3) continue;
    if (first.has(k) && first.get(k) !== n.id) clash.add(k); else first.set(k, n.id);
  }
  for (const k of clash) first.delete(k);
  full.sort((a, b) => b[0].length - a[0].length);
  index = { size: world.npcs.size, full, first };
  return index;
}
export function _resetNames() { index = { size: -1, full: [], first: new Map() }; }

const ASKING = /\b(?:know|about|who is|who are|seen|met|heard|think of|friend|like|what is .* like|tell me about|where is|is .* around)\b/;

// The NPC named in a line, other than `self`. A first name alone counts when it was
// written with a capital, or the line is asking about somebody, so "will" isn't Will.
export function namedPerson(parsed, self) {
  const t = ` ${parsed.text || ''} `;
  const idx = nameIndex();
  const hit = (k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t);
  for (const [k, id] of idx.full) if (id !== self.id && hit(k)) return world.npcs.get(id) || null;
  const raw = String(parsed.raw || '');
  const asking = ASKING.test(t) || parsed.question;
  for (const [k, id] of idx.first) {
    if (id === self.id || !hit(k)) continue;
    const capped = new RegExp(`\\b${k.charAt(0).toUpperCase()}${k.slice(1)}\\b`).test(raw);
    if (capped || asking) return world.npcs.get(id) || null;
  }
  return null;
}

// ── What they are to each other ──────────────────────────────────────────────
export function relationBetween(a, b) {
  if (!a || !b || a.id === b.id) return null;
  const mine = a.flags?.parley?.knows?.[b.id];
  if (mine) return typeof mine === 'string' ? mine : mine.kind || 'friend';
  const theirs = b.flags?.parley?.knows?.[a.id];
  if (theirs) { const k = typeof theirs === 'string' ? theirs : theirs.kind || 'friend'; return RECIPROCAL[k] || k; }
  const kin = (x, y) => [].concat(x.flags?.kin || []).includes(y.id);
  if (kin(a, b) || kin(b, a)) return 'family';
  if (a.home_zone && a.home_zone === b.home_zone) return surnameOf(a) && surnameOf(a) === surnameOf(b) ? 'family' : 'flatmate';
  let friends = [];
  try { friends = friendsOf(a.id); } catch { /* outings not loaded */ }
  if (friends.includes(b.id)) return 'friend';
  if (a.work_zone_id && a.work_zone_id === b.work_zone_id) return 'workmate';
  return 'stranger';
}

// Lines by kind. Kinds that are private have `guarded` (below familiar) and `open`.
// {other} their first name, {full} their whole name.
export const LINES = {
  lover: {
    guarded: ['*goes a bit pink.* We\'re... yeah. Don\'t make it a thing.', 'That\'s my business, thanks.', 'We\'re close. Leave it there.', '*smiles despite themself.* Maybe.'],
    open: ['{Other}? *softens.* Yeah. That\'s my person.', 'Don\'t tell anyone, but I\'d do anything for {other}.', 'We\'ve been together a while now. Still makes my stomach go.', '{Other} snores like a generator. I wouldn\'t change it.', 'If you see {other}, tell them I\'ll be home late. And that I love them. Actually, don\'t say that bit.'],
  },
  crush: {
    guarded: ['*a bit too quickly.* Who? No. Barely know them.', '{Other}? They\'re alright. Why, what did they say?'],
    open: ['*lowers voice.* Don\'t you dare tell {other} I said this, but... yeah.', 'I can\'t talk to {other}. I go stupid.', 'Do you think {other} likes anyone? Asking for nobody.'],
  },
  ex: {
    guarded: ['*jaw tightens.* We used to know each other.', 'Old history. Not getting into it.', 'Next question.'],
    open: ['{Other} and me were together. Didn\'t end well.', 'Two years with {other}. Feels like ten. Feels like none.', 'I still have some of {other}\'s stuff. Should give it back.', 'We were good once. Then we weren\'t.'],
  },
  family: [
    '{Other}? That\'s family. You leave them alone.', 'We\'re family. Same blood, worse luck.', '*sighs fondly.* {Other}. Yes. Related, God help me.',
    'Family. We fight, but nobody else gets to.', 'Course I know {other}. Grew up with them.',
  ],
  flatmate: [
    'I live with {other}. Never washes a cup.', '{Other}\'s my flatmate. We get on. Mostly.', 'Share a place with {other}. Thin walls. Very thin walls.',
    '{Other}? Same flat. Pays rent on time, so that\'s something.',
  ],
  friend: [
    '{Other}? Yeah, we\'re mates.', 'Good sort, {other}. Known them years.', '*grins.* {Other}. Trouble, that one. Good trouble.',
    'Me and {other} go out most weekends.', 'I\'d trust {other} with my life. Not my money.', '{Other}\'s alright. Tell them I said hi.',
  ],
  workmate: [
    'I work with {other}.', '{Other}? We\'re on the same shifts sometimes.', 'Know them from work. Can\'t say more than that.',
    '{Other}\'s alright to work with. Doesn\'t steal your lunch.',
  ],
  boss: ['{Other} works for me. Good worker. Don\'t tell them.', '{Other}\'s one of mine. Keeps the place running.'],
  staff: ['{Other}\'s my boss. *glances around.* Nothing to say about that.', 'I work for {other}. It pays.'],
  rival: [
    '*face sours.* {Other}. Don\'t.', 'Don\'t mention {other} in here.', '{Other} and me don\'t get on. Leave it.',
    'If {other} sent you, you can go back and tell them nothing.',
  ],
  stranger: [
    'Never heard of them.', '{Other}? Can\'t say I know them.', 'Doesn\'t ring a bell.', 'Who?',
    'The name sort of rings a bell. No idea why.', 'Don\'t know a {other}. Sorry.',
  ],
};
// When the person's in the room, a look first.
const HERE = {
  lover: '*glances at {other} and smiles.*', crush: '*goes very still, not looking at {other}.*', ex: '*won\'t look at {other}.*',
  family: '*nods at {other}.*', flatmate: '*nods at {other}.*', friend: '*nudges {other}.*', workmate: '*glances at {other}.*',
  boss: '*glances at {other}.*', staff: '*glances at {other}, careful.*', rival: '*stares at {other}.*', stranger: '*looks at {other}, blank.*',
};

const cap = (s) => s && s.charAt(0).toUpperCase() + s.slice(1);
const fill = (l, o) => String(l).replace(/\{Other\}/g, cap(firstOf(o) || 'them')).replace(/\{other\}/g, firstOf(o) || 'them').replace(/\{full\}/g, o.name);

// What `npc` says about `other` to `player` → { line, kind } or null.
export function aboutPerson(npc, other, { rel, here = false, used = new Set(), rand = Math.random } = {}) {
  const kind = relationBetween(npc, other);
  if (!kind) return null;
  const e = LINES[kind] || LINES.friend;
  const pool = Array.isArray(e) ? e : relationAtLeast(rel, 'familiar') ? e.open : e.guarded;
  const fresh = pool.filter((l) => !used.has(l));
  const raw = (fresh.length ? fresh : pool)[Math.floor(rand() * (fresh.length ? fresh : pool).length)];
  used.add(raw);
  let line = fill(raw, other);
  if (here && HERE[kind] && !/^\s*\*/.test(line)) line = `${fill(HERE[kind], other)} ${line}`;
  return { line, kind };
}

// A passing mention of somebody close, for hints.js. Never a stranger.
const HINTS = {
  lover: ['{Other}\'s cooking tonight. I\'ll pretend to like it.', '*checks the time.* {Other}\'ll be wondering where I am.'],
  family: ['*mutters.* Supposed to ring {other}. Forgot again.', '{Other} would like you. Or argue with you.'],
  friend: ['{Other} still owes me a drink.', '*laughs at something.* Sorry. Thinking about something {other} said.'],
  flatmate: ['If {other} ate my bread again I swear.'],
  ex: ['*goes quiet for a second.* Thought I saw {other}. Never mind.'],
};
export function peopleHint(npc, rand = Math.random) {
  const close = [];
  const pushAll = (ids, kindHint) => { for (const id of ids || []) { const o = world.npcs.get(id); if (o && firstOf(o)) close.push(o); } };
  pushAll(Object.keys(npc.flags?.parley?.knows || {}));
  pushAll([].concat(npc.flags?.kin || []));
  try { pushAll(friendsOf(npc.id).slice(0, 4)); } catch { /* none */ }
  if (!close.length) return null;
  const o = close[Math.floor(rand() * close.length)];
  const kind = relationBetween(npc, o);
  const pool = HINTS[kind];
  return pool ? fill(pool[Math.floor(rand() * pool.length)], o) : null;
}
