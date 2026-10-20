// sports-banter regression suite: run by tests/regress.js (never loaded in production).
// The live path needs a broadcast tick, a set tuned to a game and a player in the room,
// which is manual QA. What's locked down here: the broadcast really tags its plays, a
// play means the right thing to each fan, the right two people argue, and every line
// can be said.
import { readFileSync } from 'node:fs';
import { _test } from './index.js';
import { makeLeague, primaryClub, clubFor, stanceOf, pairTypeOf } from './fans.js';
import { SOLO, AT, THREADS, GROUP_OF, STANCES, GROUPS, TOKENS } from './lines.js';
import { _test as broadcast } from '../broadcast/index.js';
import { _test as gossip } from '../gossip/index.js';
import { world } from '../../server/engine/world.js';

export default async function regress({ check, getPlayer }) {
  // ── The broadcast tags its plays ────────────────────────────────────────────
  // Every tagged line names both clubs of the game, for and against, and the kinds
  // are the ones this plugin has lines for. A game with no tagged final is a room
  // that never reacts to a result.
  const rowOf = (file) => JSON.parse(readFileSync(new URL(`../../content/media_broadcasts/${file}`, import.meta.url), 'utf8')).sports_pools;
  for (const [sport, file] of [['baseball', 'bc_1783289744953.json'], ['hockey', 'bc_cluster_puck.json']]) {
    const script = rowOf(file);
    const kinds = new Map(), bad = [];
    let finals = 0, games = 0;
    for (const slot of [3, 41, 206, 777, 1203, 4001]) {
      const g = broadcast.assembleSportsGraph(script, `bc_regress_banter_${sport}`, slot, null);
      if (!g) continue;
      games++;
      const teams = new Set([g._game.away, g._game.home]);
      for (const n of Object.values(g.nodes)) {
        const p = n.data?.play;
        if (!p) continue;
        kinds.set(p.kind, (kinds.get(p.kind) || 0) + 1);
        if (p.kind === 'final') finals++;
        if (p.sport !== sport || !teams.has(p.for) || !teams.has(p.against) || p.for === p.against || !GROUP_OF[p.kind] || n.data._recap) {
          bad.push(JSON.stringify(p));
        }
      }
    }
    check(`${sport}: games assemble`, games > 0, String(games));
    check(`${sport}: every game tags its final`, finals === games, `${finals} finals in ${games} games`);
    check(`${sport}: scoring plays are tagged`, (kinds.get(sport === 'hockey' ? 'goal' : 'run') || 0) + (kinds.get('homerun') || 0) > 0, JSON.stringify([...kinds]));
    check(`${sport}: every play names both clubs, the right sport and a known kind`, bad.length === 0, bad.slice(0, 3).join(' | '));
  }

  // ── Fans ────────────────────────────────────────────────────────────────────
  const league = makeLeague({
    teams: ['Ashway Anvils', 'Brine Street Bats', 'Canal Kings', 'Dockside Dogs', 'East End Eels', 'Foundry Foxes'],
    rivals: { 'Ashway Anvils': 'Brine Street Bats', 'Brine Street Bats': 'Ashway Anvils', 'Canal Kings': 'Dockside Dogs', 'Dockside Dogs': 'Canal Kings' },
    sports: { 'Ashway Anvils': 'hockey', 'Brine Street Bats': 'hockey', 'Canal Kings': 'hockey', 'Dockside Dogs': 'hockey', 'East End Eels': 'baseball', 'Foundry Foxes': 'baseball' },
  });
  const A = 'Ashway Anvils', B = 'Brine Street Bats', C = 'Canal Kings', D = 'Dockside Dogs';
  const play = (kind, forTeam, against, over = {}) => ({ sport: 'hockey', kind, for: forTeam, against, away: forTeam, home: against, player: 'Teddy Grist', ...over });

  check('stance: my club did it', stanceOf(A, B, play('goal', A, C)) === 'up');
  check('stance: done to my club', stanceOf(A, B, play('goal', C, A)) === 'down');
  check('stance: done to my rival', stanceOf(A, B, play('goal', C, B)) === 'gloat');
  check('stance: my rival did it', stanceOf(A, B, play('goal', B, C)) === 'sour');
  check('stance: nothing to me', stanceOf(A, B, play('goal', C, D)) === 'neutral');
  check('stance: no club, no stake', stanceOf(null, null, play('goal', A, B)) === 'neutral');

  const fan = (id, club) => ({ id, name: id, flags: club ? { fav_team: club } : {} });
  check('club: an authored fav_team in this league wins', clubFor(fan('npc_x', C), 'hockey', league) === C);
  const both = [...Array(40)].map((_, i) => fan(`npc_sb_${i}`));
  check('club: the same NPC backs the same club every time',
    both.every(n => clubFor(n, 'hockey', league) === clubFor({ ...n }, 'hockey', league)), 'stable');
  check('club: whoever has a primary in a league backs it there',
    both.every(n => { const p = primaryClub(n, league); return league.sportOf.get(p) !== 'hockey' || clubFor(n, 'hockey', league) === p; }), 'primary');
  const followers = both.filter(n => clubFor(n, 'baseball', league)).length;
  check('club: some people don\'t follow both leagues, most follow one', followers > 0 && followers < both.length, `${followers}/${both.length}`);
  // The primary club is gossip's favTeam: one man, one club, in a rumour and at the set.
  if (gossip.teamRoster.size) {
    const real = makeLeague({ teams: [...gossip.teamRoster] });
    const disagree = both.filter(n => primaryClub(n, real) !== gossip.favTeam(n));
    check('club: the primary club is the one gossip names', disagree.length === 0, disagree.map(n => n.id).join(', '));
  }

  const c = (id, club, rival, stance) => ({ npc: { id }, club, rival, stance });
  check('pair: two rival fans, one hurt by it, feud', pairTypeOf(c(1, A, B, 'up'), c(2, B, A, 'down')) === 'feud');
  check('pair: two ordinary opposite fans, clash', pairTypeOf(c(1, A, B, 'up'), c(2, C, D, 'down')) === 'clash');
  check('pair: a rival fan watching mine lose, needle', pairTypeOf(c(1, A, B, 'gloat'), c(2, B, A, 'down')) === 'needle');
  check('pair: my club scores in front of a rival fan, brag', pairTypeOf(c(1, A, B, 'up'), c(2, B, A, 'sour')) === 'brag');
  check('pair: two fans of the club that scored', pairTypeOf(c(1, A, B, 'up'), c(2, A, B, 'up')) === 'together_up');
  check('pair: two strangers watching neutral', pairTypeOf(c(1, A, B, 'neutral'), c(2, C, D, 'neutral')) === null);

  // ── Words ───────────────────────────────────────────────────────────────────
  check('club word: the last word', _test.clubWord('Canal Kings') === 'the Kings', _test.clubWord('Canal Kings'));
  check('club word: an ordinary plural keeps its qualifier', _test.clubWord('Waterfront Wharf Rats') === 'the Wharf Rats' && _test.clubWord('Yard Birds') === 'the Yard Birds');
  check('fill: a club opens a sentence with a capital', _test.fill('"{mine}. Again."', { mine: 'the Kings' }) === '"The Kings. Again."');
  check('fill: and after a full stop', _test.fill('"Huh. {team}."', { team: 'the Kings' }) === '"Huh. The Kings."');
  check('fill: but not mid-sentence', _test.fill('"Look at {rival}."', { rival: 'the Kings' }) === '"Look at the Kings."');
  check('fill: a missing token rejects the line', _test.fill('"{to}, look."', { to: null }) === null);

  // ── Every line is sayable ───────────────────────────────────────────────────
  const known = new Set([...Object.keys(GROUP_OF), ...GROUPS]);
  const holes = [];
  for (const g of GROUPS) for (const s of STANCES) if (!SOLO[g]?.[s]?.length) holes.push(`${g}.${s}`);
  check('every group has a line for every stance', holes.length === 0, holes.join(', '));
  check('every kind with its own lines is a known kind', Object.keys(SOLO).every(k => known.has(k)), Object.keys(SOLO).filter(k => !known.has(k)).join(', '));
  const threads = Object.entries(THREADS).flatMap(([type, list]) => list.map(t => ({ type, ...t })));
  check('every thread is two people and names what it fits',
    threads.every(t => t.turns.length >= 2 && t.on.length && t.on.every(k => known.has(k))),
    threads.filter(t => t.turns.length < 2 || !t.on.length || !t.on.every(k => known.has(k))).map(t => t.turns[0]).join(' | '));
  const lines = [...Object.values(SOLO).flatMap(o => Object.values(o).flat()), ...Object.values(AT).flat(), ...threads.flatMap(t => t.turns)];
  const tokenRe = new RegExp(`\\{(?!(?:${TOKENS.join('|')})\\})[a-z_]+\\}`);
  check('no line uses an unknown token', !lines.some(l => tokenRe.test(l)), lines.filter(l => tokenRe.test(l)).join(' | '));
  check('no line uses an em dash', !lines.some(l => l.includes('—')), lines.filter(l => l.includes('—')).join(' | '));
  check('every AT line names who it is aimed at', Object.values(AT).flat().every(l => l.includes('{to}')));

  // ── The room ────────────────────────────────────────────────────────────────
  // Two fans dropped into the player's room, with rand pinned to 0 so every chance
  // passes: what they do is then down to who they back.
  const p = getPlayer();
  const zone = world.zones.get(p?.current_zone);
  if (zone) {
    const saved = _test.getLeague();
    _test.setLeague(league);
    const fans = [
      { id: 'npc_sb_regress_anvil', name: 'Morag Pell', zone_id: zone.id, flags: { fav_team: A }, _ai: {} },
      { id: 'npc_sb_regress_bat', name: 'Lenny Coyle', zone_id: zone.id, flags: { fav_team: B }, _ai: {} },
    ];
    // The room's own idle NPCs would join in; take them out of it for the test.
    const others = [...zone.npcs];
    zone.npcs.clear();
    for (const n of fans) { world.npcs.set(n.id, n); zone.npcs.add(n.id); }
    try {
      const zero = () => 0;
      const plan = _test.planReaction(zone.id, play('goal', A, B), Date.now(), zero);
      check('room: rival fans on opposite sides of a goal feud', plan?.type === 'pair' && plan.pairType === 'feud', JSON.stringify(plan && { type: plan.type, pairType: plan.pairType }));
      check('room: the fan the goal was good for speaks first', plan?.speakers?.[0]?.id === 'npc_sb_regress_anvil', plan?.speakers?.map(s => s.id).join(','));
      check('room: every turn is filled', plan?.turns?.every(t => !/\{[a-z]+\}/.test(t)), plan?.turns?.join(' | '));
      const again = _test.planReaction(zone.id, play('goal', A, B), Date.now(), zero, new Set([plan?.key]));
      check('room: a room doesn\'t hear the same exchange twice running', !!again?.key && again.key !== plan?.key, `${plan?.key} then ${again?.key}`);
      const needle = _test.planReaction(zone.id, play('goal', C, B), Date.now(), zero);
      check('room: a rival fan needles the fan whose club conceded', needle?.pairType === 'needle', needle?.pairType || needle?.type);
      // Whatever the play, the room can always say something about it.
      const silent = [];
      for (const kind of Object.keys(GROUP_OF)) {
        for (const [f, a] of [[A, B], [B, A], [C, D]]) {
          const r = _test.planReaction(zone.id, play(kind, f, a, { grand: true, champion: true, loser: 'Abe Strand' }), Date.now(), zero);
          if (!r?.turns?.length || r.turns.some(t => /\{[a-z]+\}/.test(t))) silent.push(`${kind} ${f}>${a}`);
        }
      }
      check('room: every kind of play gets a reaction', silent.length === 0, silent.join(', '));
      // A fan who just spoke sits this one out.
      fans[0]._ai.lastSay = Date.now();
      const after = _test.planReaction(zone.id, play('goal', A, B), Date.now(), zero);
      check('room: somebody who just spoke stays quiet', after && after.speakers.every(s => s.id !== 'npc_sb_regress_anvil'), after?.speakers?.map(s => s.id).join(','));
    } finally {
      for (const n of fans) { world.npcs.delete(n.id); zone.npcs.delete(n.id); }
      for (const id of others) zone.npcs.add(id);
      _test.setLeague(saved);
    }
  }

  // ── The gates ───────────────────────────────────────────────────────────────
  // None of these may claim the room: a claimed slot with nothing said mutes it for 40 s.
  _test.lastReactAt.clear();
  const beat = (over = {}) => ({ zoneId: 'zone_sb_nowhere', text: 'He scores!', mode: 'sports', style: 'raw', play: play('goal', A, B), ...over });
  _test.onBroadcastMessage(beat({ play: undefined }));
  _test.onBroadcastMessage(beat({ onStage: true }));
  _test.onBroadcastMessage(beat());
  _test.onBroadcastMessage(null);
  check('gates: no play, a studio floor or an empty room never claim the room', _test.lastReactAt.size === 0, [..._test.lastReactAt.keys()].join(','));
}
