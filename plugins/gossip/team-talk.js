// plugins/gossip/team-talk.js
//
// Fans who hear their club named. Pure: no world, no I/O. index.js owns the
// roster (favTeam) and the player.say hook; this file finds the clubs a line
// names and picks what a fan says back.
//
// A club is named by its full name, or by a short form nobody else in the league
// shares: the nickname ("Kingfishers", "Ash-Kickers") or the last two words of a
// longer name ("Wharf Rats"). A nickname that's an ordinary word in this city
// ("rats", "saints") needs the full name, or every pest complaint starts a fight.

import { pick } from '../../server/engine/util.js';

const COMMON_WORDS = new Set(['rats', 'birds', 'saints', 'goons', 'ghouls']);

const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

// [{ alias, team }], longest alias first, rebuilt when the roster changes.
export function buildAliases(teams) {
  const out = [];
  const shortForms = new Map();   // alias -> Set(team)
  const addShort = (alias, team) => {
    if (!alias.trim() || COMMON_WORDS.has(alias.trim())) return;
    if (!shortForms.has(alias)) shortForms.set(alias, new Set());
    shortForms.get(alias).add(team);
  };
  for (const team of teams) {
    out.push({ alias: norm(team), team });
    const words = String(team).split(/\s+/).filter(Boolean);
    if (words.length >= 2) addShort(norm(words[words.length - 1]), team);
    if (words.length >= 3) addShort(norm(words.slice(-2).join(' ')), team);
  }
  const full = new Set(out.map(a => a.alias));
  for (const [alias, owners] of shortForms) {
    if (owners.size === 1 && !full.has(alias)) out.push({ alias, team: [...owners][0] });
  }
  return out.sort((a, b) => b.alias.length - a.alias.length);
}

// The clubs a line names, as a Set of full team names.
export function teamsNamed(text, aliases) {
  let hay = norm(text);
  const found = new Set();
  for (const { alias, team } of aliases) {
    if (!hay.includes(alias)) continue;
    found.add(team);
    // Blank the match so "Wharf Rats" can't also count as a shorter alias inside it.
    hay = hay.split(alias).join(' ');
  }
  return found;
}

// What a fan of `fav` says when `named` (a Set) includes their club, their rival,
// or both. null when it's nothing to them.
export function fanReaction(fav, rival, named) {
  if (!fav || !named?.size) return null;
  const T = fav, R = rival;
  const mine = named.has(T);
  const theirs = !!R && named.has(R);
  if (mine && theirs) return pick([
    `"${T} and ${R} in one breath? Mind yourself. That's a blood feud, not small talk."`,
    `leans in. "${T} over ${R}, every time. Put it on my headstone."`,
    `"When ${T} play ${R} the whole street goes quiet. Then the windows go."`,
    `"${T} are the club. ${R} are what the club scrapes off its boots."`,
  ]);
  if (mine) return pick([
    `grins. "${T}? Now you're talking. Best club in the Basin, and I'll fight anyone who says different."`,
    `"${T} fan? Good. You can stay."`,
    `perks up. "${T}! I've got their colours tattooed somewhere I can't show you in public."`,
    `"You said ${T}. Say it louder. This room needs educating."`,
    `thumps the nearest surface. "${T}! Bled for that club my whole life. Mostly literally."`,
    ...(R ? [`"${T}. Lovely. Anything beats hearing about ${R}."`] : []),
  ]);
  if (theirs) return pick([
    `spits. "${R}? Don't say that name in here. I'm ${T} to the bone."`,
    `"${R} are a pack of cheats and their mothers know it. ${T} forever."`,
    `scowls. "You a ${R} fan? Keep it to yourself if you like your teeth."`,
    `"${R}. Every time ${T} play them I lose a week's wages and a friend."`,
    `"Only good thing about ${R} is watching ${T} put them in the ground."`,
  ]);
  return null;
}
