// plugins/sports-banter/fans.js
//
// Who backs which club, and what a play means to them. Pure: no world, no I/O.
// index.js owns the league (pinned from broadcast.getSportsTeams) and hands it in.
//
// An NPC has a PRIMARY club across both leagues, and it is the same club gossip's
// favTeam gives them: an authored `flags.fav_team`, or a stable hash of their id into
// the whole sorted roster. That keeps a man who argues about the Crows at the bar
// from cheering for somebody else when the game is on. The primary is in one league;
// for the other, a second hash decides whether they follow it at all (most do) and
// which club. Nothing is stored and nothing changes between restarts.

// Of the NPCs whose primary is in the other league, how many follow this one too.
const FOLLOW_OTHER_PCT = 60;

const hashOf = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

// { teams: [..], rivals: { team: rival }, sports: { team: sport } } → the shape the
// rest of this file reads. Sorting is what makes the hash stable: clubs arrive in
// whatever order the broadcast library loaded them.
export function makeLeague({ teams = [], rivals = {}, sports = {} } = {}) {
  const all = [...new Set(teams)].sort();
  const bySport = new Map();
  for (const t of all) {
    const s = sports[t];
    if (!s) continue;
    if (!bySport.has(s)) bySport.set(s, []);
    bySport.get(s).push(t);
  }
  return { teams: all, bySport, rivals: new Map(Object.entries(rivals)), sportOf: new Map(Object.entries(sports)) };
}

// The club gossip's favTeam names, worked out the same way.
export function primaryClub(npc, league) {
  if (!npc?.id || !league?.teams.length) return null;
  const own = npc.flags?.fav_team;
  if (own && league.teams.includes(own)) return own;
  return league.teams[hashOf(String(npc.id)) % league.teams.length];
}

// The club this NPC backs in `sport`, or null if they don't follow it.
export function clubFor(npc, sport, league) {
  if (!npc?.id || !sport || !league) return null;
  const clubs = league.bySport.get(sport);
  if (!clubs?.length) return null;
  const primary = primaryClub(npc, league);
  if (primary && league.sportOf.get(primary) === sport) return primary;
  const h = hashOf(`${npc.id}|${sport}`);
  if (h % 100 >= FOLLOW_OTHER_PCT) return null;
  return clubs[Math.floor(h / 100) % clubs.length];
}

export const rivalOf = (club, league) => (club && league?.rivals.get(club)) || null;

// What a play is to somebody who backs `club`:
//   up     their club did it          down   it was done to their club
//   gloat  it was done to their rival  sour   their rival did it
//   neutral nothing to them
export function stanceOf(club, rival, play) {
  if (!club || !play) return 'neutral';
  if (club === play.for) return 'up';
  if (club === play.against) return 'down';
  if (rival && rival === play.against) return 'gloat';
  if (rival && rival === play.for) return 'sour';
  return 'neutral';
}

export const POSITIVE = new Set(['up', 'gloat']);
export const NEGATIVE = new Set(['down', 'sour']);

// The pair worth a two-hander, best first. `cands` are { npc, club, rival, stance }.
// A rivalry is the point: two fans of clubs that hate each other, watching one of
// them get hurt, beat two strangers on opposite sides of an ordinary game.
const PAIR_RANK = { feud: 0, needle: 1, clash: 2, brag: 3, together_up: 4, together_down: 5 };
export function pairTypeOf(a, b) {
  if (!a?.club || !b?.club || a.npc === b.npc) return null;
  if (a.stance === 'up' && b.stance === 'down') return a.rival === b.club ? 'feud' : 'clash';
  if (a.stance === 'gloat' && b.stance === 'down') return 'needle';
  if (a.stance === 'up' && b.stance === 'sour') return 'brag';
  if (a.club === b.club && a.stance === 'up' && b.stance === 'up') return 'together_up';
  if (a.club === b.club && a.stance === 'down' && b.stance === 'down') return 'together_down';
  return null;
}

// Every pair in the room, ranked. A is always the one the play was good for (or, for
// two fans of one club, either of them), so a thread's even turns are the happy side.
export function rankPairs(cands, rand = Math.random) {
  const out = [];
  for (const a of cands) {
    for (const b of cands) {
      const type = pairTypeOf(a, b);
      if (type) out.push({ type, a, b, roll: rand() });
    }
  }
  return out.sort((x, y) => PAIR_RANK[x.type] - PAIR_RANK[y.type] || x.roll - y.roll);
}
