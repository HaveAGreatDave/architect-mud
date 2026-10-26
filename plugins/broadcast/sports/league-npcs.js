// League players who are also NPCs: a few men on each CPhL club live in the city, keep a
// home and turn up at the Gardens for their club's games. The NPC names the roster man
// he is in `flags.cphl` ({ player, club, role }), and everything else follows from the
// league: the schedule says when his club plays, the injury chain says whether he's hurt
// or in the vat, and the season fold says how his season is going. Nothing is stored.
//
// Pure. plugins/broadcast/index.js reads the live state once a minute (`leagueNpcTick`)
// and answers the NPC schedule checker from it; regress drives these directly.

export const LEAGUE_ROLES = ['captain', 'goalie', 'star'];

// The binding on an NPC, or null for anybody else.
export function bindingOf(npc) {
  const b = npc?.flags?.cphl;
  return b && typeof b.player === 'string' && b.player && typeof b.club === 'string' ? b : null;
}

// Where he should be: 'vat' while the vat has him, 'game' from the call before his club's
// game to its end, 'off' otherwise. A man on the injury list misses the game and lives
// his day as usual. `st` is one slot's state:
//   { playing: Set<club> now, next: Set<club> next slot, call: bool (inside the call before
//     the next slot), out: Set<name> unavailable now, inVat: Set<name> }
export function whereabouts(bind, st) {
  if (!bind || !st) return 'off';
  if (st.inVat?.has(bind.player)) return 'vat';
  if (st.out?.has(bind.player)) return 'off';
  if (st.playing?.has(bind.club)) return 'game';
  if (st.call && st.next?.has(bind.club)) return 'game';
  return 'off';
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const num = (n) => WORDS[n] ?? String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${num(n)} times`);
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

// What he says when asked how his season's going, in his own words: his line from the
// season fold, then what it's cost him. `extras` is the hockey fold's summary (players,
// goalies, toll, career); `st` as above, plus `back: Set<name>` for a man not yet played
// since the vat.
export function seasonLine(bind, extras, st) {
  if (!bind) return '';
  const name = bind.player;
  const out = [];
  if (bind.role === 'goalie') {
    const g = extras?.goalies?.[name];
    if (!g?.gp) out.push("I haven't been in net yet this season.");
    else out.push(`${cap(plural(g.gp, 'game', 'games'))}, ${plural(g.w, 'win', 'wins')}. I've stopped ${g.sa - g.ga} of ${g.sa}.`);
  } else {
    const s = extras?.players?.[name];
    if (!s?.gp) out.push("I haven't played a game yet this season.");
    else out.push(`${cap(plural(s.gp, 'game', 'games'))}, ${plural(s.g, 'goal', 'goals')} and ${plural(s.a, 'assist', 'assists')}.`);
  }
  const t = extras?.toll?.[name] || { hurt: 0, died: 0 };
  if (t.hurt && t.died) out.push(`Carried off ${times(t.hurt)} and died ${times(t.died)}.`);
  else if (t.died) out.push(`I've died ${times(t.died)}.`);
  else if (t.hurt) out.push(`They've carried me off ${times(t.hurt)}.`);
  const careerDied = (extras?.career?.[name]?.died || 0) + (t.died || 0);
  if (careerDied > (t.died || 0)) out.push(`That's ${times(careerDied)} in the vat, all told.`);
  if (st?.out?.has(name) && !st?.inVat?.has(name)) out.push("I'm on the injury list for now.");
  else if (st?.back?.has(name)) out.push("Next game's my first back from the vat.");
  return out.join(' ');
}
