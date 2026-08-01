/**
 * DEADBALL — the baseball sport module.
 *
 * Extracted verbatim from plugins/broadcast/index.js with NO behaviour change:
 * same tables, same tunables, same RNG call order, so `sportsGameForSlot(script, N)`
 * still returns byte-identical games. `plugins/broadcast/regress.js` asserts that
 * determinism, which is what makes this extraction safe to verify.
 *
 * WHAT BELONGS HERE: anything that only makes sense for baseball — the at-bat
 * table, the base/out situational rules, innings, pitch synthesis, play labels.
 *
 * WHAT DOES NOT: the slot clock, the round-robin schedule, the standings fold,
 * line pacing, the recap reel, the graph cache, the heartbeat. Those are
 * sport-agnostic and stay in index.js, which is the whole point of the split —
 * a second sport should add a file here and change nothing there.
 *
 * The default export is a SPORT DESCRIPTOR. The registry only has one entry today,
 * but the shape is what a second sport plugs into, so it exists now rather than
 * being retrofitted around hockey later.
 */
import { sportsRng, sportsShuffle } from '../rng.js';

// ── At-bat outcomes ──────────────────────────────────────────────────────────
// One plate appearance → an outcome. Weights are tuned to real MLB per-PA rates:
// K ~22.7%, reach-base ~32% (the single weight also absorbs reach-on-error so run
// production lands right), HR ~3%, 2B ~4.2%, 3B ~0.4%. Ground outs outnumber fly
// outs so double-play chances land near MLB. See the sim-tuning notes.
export const ATBAT_TABLE = [
  { kind: 'strikeout', w: 225, bases: 0, out: true },
  { kind: 'groundout', w: 240, bases: 0, out: true },
  { kind: 'flyout',    w: 160, bases: 0, out: true },
  { kind: 'popout',    w: 60,  bases: 0, out: true },
  { kind: 'single',    w: 162, bases: 1, out: false },
  { kind: 'walk',      w: 94,  bases: 1, out: false },
  { kind: 'double',    w: 42,  bases: 2, out: false },
  { kind: 'triple',    w: 4,   bases: 3, out: false },
  { kind: 'homerun',   w: 31,  bases: 4, out: false },
];
const ATBAT_TOTAL = ATBAT_TABLE.reduce((s, o) => s + o.w, 0);
export function rollAtBat(rand = Math.random) {
  let roll = rand() * ATBAT_TOTAL;
  for (const o of ATBAT_TABLE) { roll -= o.w; if (roll <= 0) return o; }
  return ATBAT_TABLE[0];
}

// Situational-out tunables — base/out-aware outcomes layered over the flat at-bat
// roll. Double plays kill rallies (and tame blowouts); sac flies and productive
// groundouts trade an out for a run or a base.
const DP_CHANCE = 0.38;              // groundout, runner on 1st, <2 outs → two (~0.75 DP/team/game)
const SACFLY_CHANCE = 0.90;          // flyout, runner on 3rd, <2 outs → run scores, out
const FORCE_ADVANCE_CHANCE = 0.60;   // non-DP groundout, runner on 1st → batter out at first, runners forced up (else fielder's choice, bases hold)
const PRODUCTIVE_OUT_CHANCE = 0.35;  // other groundout nudges a runner on 2nd/3rd up (3rd scores)

// Extra innings. There is ALWAYS a winner — no ties, ever. The 10th plays out free;
// after that, each extra frame that ends still tied carries an escalating chance the
// next big swing simply decides it — a walk-off, or a go-ahead that holds. The chance
// climbs every inning, so the tie can never drag on and always resolves to a winner —
// you just don't know which side breaks it until it happens. STEP is the per-inning rise.
const EXTRAS_DECIDE_STEP = 0.34;     // +34%/inning past the 10th; forced-decisive by ~the 13th
const MAX_INNINGS = 20;              // safety cap; a winner is forced if it's ever reached

export const DEFAULT_NAMES = ['Rodriguez', 'Kane', 'Okafor', 'Bishop', 'Hale', 'Vance', 'Cruz', 'Doyle', 'Reyes', 'Park', 'Sato', 'Mundt', 'Nagy', 'Flynn', 'Ruiz', 'Abara', 'Cole', 'Voss', 'Dunn', 'Marsh'];

// ── Gameday: synthesized pitch-by-pitch + play descriptions ───────────────────
// The DEADBALL sim resolves at the AT-BAT level — it has no pitch data. For the
// animated Gameday sub-screen we synthesize a plausible pitch sequence per at-bat,
// PURELY from a seed, so every TV renders the identical sequence and it always ends
// on the pitch that matches Chip's called outcome (a K ends on strike three, a walk
// on ball four, everything else on a ball put in play). This is cosmetic colour, not
// a change to the game result — the outcome still comes solely from simGame.
const PITCH_TYPES = [
  { type: 'Four-Seam Fastball', lo: 92, hi: 99, w: 34 },
  { type: 'Sinker',             lo: 90, hi: 96, w: 16 },
  { type: 'Slider',             lo: 82, hi: 89, w: 20 },
  { type: 'Changeup',           lo: 82, hi: 89, w: 12 },
  { type: 'Curveball',          lo: 74, hi: 82, w: 10 },
  { type: 'Cutter',             lo: 87, hi: 92, w: 8  },
];
const PITCH_TOTAL = PITCH_TYPES.reduce((s, o) => s + o.w, 0);
// Neutral, factual play-card label (distinct from Chip's flavour narration).
const PLAY_DESC = {
  strikeout: 'Strikeout', groundout: 'Groundout', flyout: 'Flyout', popout: 'Pop Out',
  single: 'Single', double: 'Double', triple: 'Triple', walk: 'Walk', homerun: 'Home Run',
  doubleplay: 'Double Play', sacfly: 'Sacrifice Fly', productout: 'Groundout',
};
export function playDesc(b) {
  if (b.kind === 'homerun') return b.rbi >= 4 ? 'Grand Slam' : (b.rbi > 1 ? `Home Run — ${b.rbi} RBI` : 'Home Run');
  const base = PLAY_DESC[b.kind] || 'In Play';
  return (b.rbi > 0 && b.kind !== 'walk') ? `${base} — ${b.rbi} RBI` : base;
}

// Build the pitch sequence for one at-bat. Returns pitches ending in the terminal
// pitch that produces `kind`. Each pitch: {n, type, velo, x, y, result, balls, strikes}
// where x,y ∈ [0,1] (the strike zone is the box ~0.25–0.75) and result is one of
// ball | called | swinging | foul | inplay. balls/strikes are the count AFTER the pitch.
export function synthPitches(seed, kind) {
  const rand = sportsRng(seed);
  const pickType = () => { let r = rand() * PITCH_TOTAL; for (const p of PITCH_TYPES) { r -= p.w; if (r <= 0) return p; } return PITCH_TYPES[0]; };
  const zone = (result) => {
    if (result === 'ball') {
      // At least one axis off the plate.
      const out = () => (rand() < 0.5 ? 0.04 + rand() * 0.16 : 0.80 + rand() * 0.16);
      return rand() < 0.5 ? { x: out(), y: 0.20 + rand() * 0.60 } : { x: 0.20 + rand() * 0.60, y: out() };
    }
    // In or on the edge of the zone (fouls hug the edge a bit more).
    const edge = result === 'foul' ? 0.16 : 0.24;
    return { x: 0.5 + (rand() - 0.5) * (1 - edge), y: 0.5 + (rand() - 0.5) * (1 - edge) };
  };
  const terminal = kind === 'strikeout' ? 'strike' : (kind === 'walk' ? 'ball' : 'inplay');
  let preBalls, preStrikes;
  if (terminal === 'strike') { preBalls = Math.floor(rand() * 4); preStrikes = 2; }      // K on strike three
  else if (terminal === 'ball') { preBalls = 3; preStrikes = Math.floor(rand() * 3); }    // BB on ball four
  else { preBalls = Math.floor(rand() * 4); preStrikes = Math.floor(rand() * 3); }        // in play, any count

  const pre = [];
  for (let i = 0; i < preBalls; i++) pre.push('ball');
  for (let i = 0; i < preStrikes; i++) pre.push(rand() < 0.45 ? 'called' : 'swinging');
  for (let i = pre.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pre[i], pre[j]] = [pre[j], pre[i]]; }
  // A little texture: an extra foul or two once there are two strikes.
  if (preStrikes === 2) { let extra = 0; while (rand() < 0.30 && extra++ < 2) pre.push('foul'); }

  const terminalResult = terminal === 'strike' ? (rand() < 0.5 ? 'called' : 'swinging')
    : (terminal === 'ball' ? 'ball' : 'inplay');
  const results = [...pre, terminalResult];

  let balls = 0, strikes = 0;
  return results.map((result, i) => {
    if (result === 'ball') balls++;
    else if (result === 'foul') { if (strikes < 2) strikes++; }
    else strikes++;
    const p = pickType();
    const z = zone(result);
    return {
      n: i + 1, type: p.type,
      velo: Math.round(p.lo + rand() * (p.hi - p.lo)),
      x: Math.round(z.x * 1000) / 1000, y: Math.round(z.y * 1000) / 1000,
      result, balls, strikes,
    };
  });
}

// ── The sim ──────────────────────────────────────────────────────────────────
// Pure and seeded: same (matchup, players, rand) → same game, every time, on every
// client. Returns { away, home, awayScore, homeScore, beats, innings }.
export function simGame(matchup, players, rand = Math.random) {
  const awayName = matchup?.away || 'Away', homeName = matchup?.home || 'Home';
  const names = sportsShuffle((Array.isArray(players) && players.length) ? players : DEFAULT_NAMES, rand);
  const mk = (name, off) => ({
    name, score: 0, idx: 0,
    lineup: Array.from({ length: 9 }, (_, k) => names[(off + k) % names.length]),
    pitcher: names[(off + 9) % names.length],
  });
  const away = mk(awayName, 0);
  const home = mk(homeName, 9 % Math.max(names.length, 1));

  const beats = [];
  let gameOver = false, inning = 0;

  const playHalf = (half, batting, fielding) => {
    beats.push({ type: 'half_start', inning, half, battingName: batting.name, fieldingName: fielding.name, pitcher: fielding.pitcher, awayScore: away.score, homeScore: home.score });
    let outs = 0, walkoff = false;
    const bases = [false, false, false];   // 1st, 2nd, 3rd occupied?
    while (outs < 3) {
      const batter = batting.lineup[batting.idx % 9];
      batting.idx++;
      const ab = rollAtBat(rand);
      let kind = ab.kind, runs = 0;

      if (ab.out) {
        // Base/out-aware outs. A grounder with a man on first can turn two; a fly
        // ball with a man on third can be traded for a run; other grounders can
        // still push a runner over — a "productive out".
        if (ab.kind === 'groundout' && bases[0] && outs < 2 && rand() < DP_CHANCE) {
          kind = 'doubleplay';                 // batter + the force at second
          bases[0] = false;
          outs += 2;
        } else if (ab.kind === 'flyout' && bases[2] && outs < 2 && rand() < SACFLY_CHANCE) {
          kind = 'sacfly';                      // runner tags from third and scores
          bases[2] = false; runs = 1;
          outs += 1;
        } else {
          outs += 1;
          // Groundout base-running. A runner on first is FORCED: either the batter is
          // retired at first and every runner is pushed up a base (a run scores from
          // third), or the defense takes the fielder's choice — the lead runner is out
          // at second, the batter reaches, and the runners hold (bases untouched). With
          // no man on first, a right-side grounder still nudges a runner on 2nd/3rd up.
          if (ab.kind === 'groundout' && outs < 3 && bases[0] && rand() < FORCE_ADVANCE_CHANCE) {
            kind = 'productout';                // batter out at first; runners forced up 90 ft
            if (bases[2]) runs += 1;            // forced run scores from third
            bases[2] = bases[1];                // second → third
            bases[1] = bases[0];                // first → second
            bases[0] = false;
          } else if (ab.kind === 'groundout' && outs < 3 && !bases[0] && (bases[1] || bases[2]) && rand() < PRODUCTIVE_OUT_CHANCE) {
            kind = 'productout';                // grounder to the right side moves 'em up
            if (bases[2]) { runs += 1; bases[2] = false; }
            if (bases[1]) { bases[2] = true; bases[1] = false; }
          }
        }
        batting.score += runs;
        walkoff = half === 'bottom' && inning >= 9 && runs > 0 && home.score > away.score;
        beats.push({ type: 'atbat', inning, half, battingName: batting.name, fieldingName: fielding.name, batter, pitcher: fielding.pitcher, kind, out: true, outs, rbi: runs, awayScore: away.score, homeScore: home.score, walkoff, bases: [bases[0], bases[1], bases[2]] });
        if (walkoff) break;
        continue;
      }

      // Reached base. A walk pushes only forced runners; hits advance runners with
      // realistic aggressiveness — a single often scores a man from second and can
      // send the trail runner first-to-third; a double clears second and third and
      // frequently scores one from first. Advancement odds tuned to MLB run output.
      if (ab.kind === 'walk') {
        if (bases[0]) { if (bases[1]) { if (bases[2]) runs = 1; bases[2] = true; } bases[1] = true; }
        bases[0] = true;
      } else {
        const r0 = bases[0], r1 = bases[1], r2 = bases[2];
        bases[0] = bases[1] = bases[2] = false;
        if (ab.kind === 'single') {
          if (r2) runs++;
          if (r1) { if (rand() < 0.72) runs++; else bases[2] = true; }
          if (r0) { if (rand() < 0.42 && !bases[2]) bases[2] = true; else bases[1] = true; }
          bases[0] = true;
        } else if (ab.kind === 'double') {
          if (r2) runs++;
          if (r1) runs++;
          if (r0) { if (rand() < 0.62) runs++; else bases[2] = true; }
          bases[1] = true;
        } else if (ab.kind === 'triple') {
          runs += (r0 ? 1 : 0) + (r1 ? 1 : 0) + (r2 ? 1 : 0);
          bases[2] = true;
        } else { // homerun
          runs += 1 + (r0 ? 1 : 0) + (r1 ? 1 : 0) + (r2 ? 1 : 0);
        }
      }
      batting.score += runs;
      walkoff = half === 'bottom' && inning >= 9 && runs > 0 && home.score > away.score;
      beats.push({ type: 'atbat', inning, half, battingName: batting.name, fieldingName: fielding.name, batter, pitcher: fielding.pitcher, kind, out: false, outs, rbi: runs, awayScore: away.score, homeScore: home.score, walkoff, bases: [bases[0], bases[1], bases[2]] });
      if (walkoff) break;
    }
    beats.push({ type: 'half_end', inning, half, battingName: batting.name, fieldingName: fielding.name, awayScore: away.score, homeScore: home.score });
    return walkoff;
  };

  // Force a decisive frame: one swing ends it — a walk-off for the home side or a
  // go-ahead that holds up for the visitors (coin-flip which). Used both when the
  // extra-inning "decide" roll fires and as the never-a-tie backstop at the cap.
  const forceFinish = () => {
    inning = Math.max(inning, 10);
    const homeWins = rand() < 0.5;
    const bat = homeWins ? home : away, fld = homeWins ? away : home;
    const half = homeWins ? 'bottom' : 'top';
    const r = rand();
    const kind = r < 0.15 ? 'homerun' : (r < 0.5 ? 'double' : 'single');
    bat.score += 1;
    beats.push({ type: 'half_start', inning, half, battingName: bat.name, fieldingName: fld.name, pitcher: fld.pitcher, awayScore: away.score - (homeWins ? 0 : 1), homeScore: home.score - (homeWins ? 1 : 0) });
    beats.push({ type: 'atbat', inning, half, battingName: bat.name, fieldingName: fld.name, batter: bat.lineup[bat.idx % 9], pitcher: fld.pitcher, kind, out: false, outs: 0, rbi: 1, awayScore: away.score, homeScore: home.score, walkoff: homeWins, bases: [false, false, false] });
    beats.push({ type: 'half_end', inning, half, battingName: bat.name, fieldingName: fld.name, awayScore: away.score, homeScore: home.score });
  };

  while (!gameOver && inning < MAX_INNINGS) {
    inning++;
    playHalf('top', away, home);
    // Home already ahead entering the bottom of the 9th+ → they've won; skip the half.
    if (inning >= 9 && home.score > away.score) { gameOver = true; break; }
    if (playHalf('bottom', home, away)) { gameOver = true; break; }   // walk-off
    if (inning >= 9 && away.score !== home.score) { gameOver = true; break; }   // decided after a full inning
    // Still tied in extras. Past the 10th, an escalating chance the next big swing
    // decides it outright — so a tie can never drag on and always ends with a winner.
    if (inning >= 10) {
      const decide = Math.min(1, (inning - 10) * EXTRAS_DECIDE_STEP);
      if (decide > 0 && rand() < decide) { forceFinish(); gameOver = true; break; }
    }
  }

  // Never a tie: if the cap was somehow reached dead even, one swing settles it.
  if (away.score === home.score) forceFinish();

  return { away, home, awayScore: away.score, homeScore: home.score, beats, innings: inning };
}

// ── Sport descriptor ─────────────────────────────────────────────────────────
// The shape a second sport plugs into. `section` is the {section}/{sectionOrd}
// token vocabulary from docs/bsm-format.md — hockey sets this to 'period'.
// ── the season ───────────────────────────────────────────────────────────────
// How a game folds into a league table, and how that table sorts. Lifted verbatim
// out of broadcast/index.js's computeStandings when hockey arrived: a second sport
// counts a different set of things (a hockey table has three result columns, not
// two), and the alternative was a sport branch sitting in the engine forever.
//
// `fold` is called once per scheduled game over the season's slot window. It must
// stay PURE and cheap — the standings are a recomputed fold over thousands of slots,
// never a stored row, so this runs a lot.
// What counts as a hit. Deliberately a set rather than a regex: a new at-bat
// outcome must be classified on purpose, not caught by accident.
const HIT_KINDS = new Set(['single', 'double', 'triple', 'homerun']);

export const SEASON = {
  finalName: 'World Series',
  finalShort: 'WS',
  // Column labels for the on-air standings bug and the `standings` command.
  columns: ['W', 'L', 'RD'],
  fold(table, game) {
    const { awayScore, homeScore } = game;
    if (awayScore === homeScore) return;                   // the sim never ties; guard anyway
    const bump = (team, w, l, rf, ra) => {
      const t = table.get(team) || { team, wins: 0, losses: 0, runs_for: 0, runs_against: 0 };
      t.wins += w; t.losses += l; t.runs_for += rf; t.runs_against += ra; table.set(team, t);
    };
    const awayWon = awayScore > homeScore;
    bump(game.away.name, awayWon ? 1 : 0, awayWon ? 0 : 1, awayScore, homeScore);
    bump(game.home.name, awayWon ? 0 : 1, awayWon ? 1 : 0, homeScore, awayScore);
  },
  sort(rows) {
    const rd = (r) => (r.runs_for || 0) - (r.runs_against || 0);
    return rows.sort((a, b) => {
      const pa = a.wins / (a.wins + a.losses), pb = b.wins / (b.wins + b.losses);
      if (pb !== pa) return pb - pa;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (rd(b) !== rd(a)) return rd(b) - rd(a);
      return a.team.localeCompare(b.team);
    });
  },
  // ── The hitting race ───────────────────────────────────────────────────────
  // Deadball's batting leaders, accumulated across the season exactly the way
  // hockey accumulates its scoring race.
  //
  // This costs nothing extra to compute: `simGame` already emits a full at-bat
  // beat for every plate appearance (batter, kind, rbi) on the RESULT-ONLY path
  // too, so the numbers were being generated and thrown away every time the
  // table was folded. Reading them back is a walk over an array the sim just
  // built — no second simulation, no stored rows, and the leaders can never
  // disagree with the games that aired because they are the same games.
  //
  // SCORING RULES, because a batting average computed the naive way is wrong in
  // a way people notice:
  //   • A WALK is not an at-bat. It counts as a plate appearance and nothing else.
  //   • A SACRIFICE FLY is not an at-bat either — you gave yourself up for the run.
  //   • Everything else (including a double play or a productive out, which are
  //     just outs the batter is charged with) is an at-bat.
  // Get those two exclusions wrong and every average in the league reads low.
  foldExtras(acc, game) {
    acc.bats = acc.bats || new Map();
    for (const b of game.beats || []) {
      if (b.type !== 'atbat' || !b.batter) continue;
      const r = acc.bats.get(b.batter)
        || { name: b.batter, team: b.battingName, pa: 0, ab: 0, hits: 0, hr: 0, rbi: 0 };
      // Last team seen wins — the pool is shuffled per game, so a name can turn
      // out for either side across a season and the recent one reads truer.
      r.team = b.battingName || r.team;
      r.pa += 1;
      if (b.kind !== 'walk' && b.kind !== 'sacfly') r.ab += 1;
      if (HIT_KINDS.has(b.kind)) r.hits += 1;
      if (b.kind === 'homerun') r.hr += 1;
      r.rbi += b.rbi || 0;
      acc.bats.set(b.batter, r);
    }
  },
  summariseExtras(acc) {
    const all = [...(acc.bats || new Map()).values()];
    // A qualifier gate, or the leaderboard is whoever went 2-for-2 in April. Scaled
    // to the season actually played rather than a fixed number, so an early-season
    // table still has names on it instead of being empty for a fortnight.
    const maxAb = all.reduce((m, r) => Math.max(m, r.ab), 0);
    const minAb = Math.max(5, Math.floor(maxAb * 0.4));
    const avg = (r) => (r.ab ? r.hits / r.ab : 0);
    const qualified = all.filter(r => r.ab >= minAb);
    const pool = qualified.length ? qualified : all;   // never show an empty race
    const top = (key, cmp) => [...pool].sort(cmp).slice(0, 5).map(r => ({ ...r, avg: avg(r) }));
    return {
      batters: top('avg', (a, b) => avg(b) - avg(a) || b.hits - a.hits || a.name.localeCompare(b.name)),
      homers:  top('hr',  (a, b) => b.hr - a.hr || avg(b) - avg(a) || a.name.localeCompare(b.name)),
      rbis:    top('rbi', (a, b) => b.rbi - a.rbi || b.hits - a.hits || a.name.localeCompare(b.name)),
      minAb,
    };
  },
};

export const BASEBALL = {
  id: 'baseball',
  // How the league names itself on a listing or a table. The TV guide and the
  // standings button read this rather than the word DEADBALL, which used to be
  // written into both and put a ballgame's name on a hockey night.
  brand: 'DEADBALL',
  finalIcon: '⚾',
  season: SEASON,
  section: 'inning',
  sectionPlural: 'innings',
  simGame,
  synthDetail: synthPitches,
  playDesc,
  defaultNames: DEFAULT_NAMES,
};

export default BASEBALL;
