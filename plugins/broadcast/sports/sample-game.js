// A GAME TO DESIGN AGAINST. The Broadcast Studio and the gate need a game's facts with no server, so
// this plays one through the real sim from a broadcast's own row, after a run of games that gives its
// men a season. Same seed, same game. Nothing here goes to air.

import { HOCKEY } from './hockey.js';
import { BASEBALL } from './baseball.js';
import { sportsRng } from '../rng.js';
import { factsAt, momentBeat } from './facts.js';

const SEASON_GAMES = 24;
const names = (row) => (row.teams || []).map((t) => (typeof t === 'string' ? t : t.name));

export function sampleGame(row, seed = 1) {
  const sport = row.sport === 'hockey' ? HOCKEY : BASEBALL, teams = names(row), acc = {}, record = new Map();
  const play = (s, day) => {
    const a = teams[s % teams.length], h = teams[(s * 7 + 3 + (s % 5)) % teams.length];
    const home = h === a ? teams[(teams.indexOf(a) + 1) % teams.length] : h;
    return sport.simGame({ away: a, home, teams, clubs: row.clubs }, row.players, sportsRng(s), { seed: s, version: row.sim, day });
  };
  for (let i = 0; i < SEASON_GAMES; i++) {
    const g = play(seed * 131 + i + 1, i);
    sport.season.foldExtras?.(acc, g);
    for (const [t, won] of [[g.away.name, g.awayScore > g.homeScore], [g.home.name, g.homeScore > g.awayScore]]) {
      const r = record.get(t) || { team: t, wins: 0, losses: 0 };
      if (won) r.wins++; else r.losses++;
      record.set(t, r);
    }
  }
  const game = play(seed, SEASON_GAMES);
  const rows = [...record.values()].sort((a, b) => b.wins - a.wins);
  const ctx = { season: sport.season.summariseExtras?.(acc) || {}, clubs: row.clubs, rows, records: (t) => { const r = record.get(t); return r ? `${r.wins}-${r.losses}` : '0-0'; } };
  return { sport: sport.id, game, ctx };
}

// The facts at a moment of a sample game, with what the row itself says.
export function sampleFacts(row, seed, when, n = 0) {
  const { sport, game, ctx } = sampleGame(row, seed);
  return {
    ...factsAt(sport, game, momentBeat(sport, game, when, n), ctx),
    announcer: row.announcer || '', analyst: row.analyst || '', venue: row.venue?.said || row.venue?.name || '',
  };
}
