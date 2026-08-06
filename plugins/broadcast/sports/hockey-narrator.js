/**
 * CPhL play-by-play — turns the hockey sim's beats into spoken broadcast lines.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE BASEBALL NARRATOR. Deadball's narrator is
 * built around a half-inning: three outs, a bases state, a batter, a line score.
 * None of that exists here. Hockey's unit is a running clock with live strength
 * state, and the interesting beats (a man in the box, a man on a stretcher, a man
 * dead in overtime) are OFF-PUCK — they happen between chances and change how every
 * chance after them reads. Reskinning innings into periods would have produced
 * baseball on ice. So `assembleSportsGraph` keeps the sport-agnostic scaffolding —
 * the node chain, the pacing, the graph — and hands the middle to whichever sport
 * module exports `narrate`. Baseball has no `narrate` and its body is untouched.
 *
 * THE SELECTION PROBLEM. The sim emits ~300 beats a game and a slot can only hold
 * ~60 spoken lines. Baseball thins by sampling routine outs; hockey can't sample
 * blind, because ~85% of its beats are ordinary saves and a naive sample would air
 * a period of nothing but "{goalie} takes it in the chest". So beats are tiered:
 *
 *   ALWAYS  goals · penalties · fights · injuries · deaths · hat tricks · the
 *           pulled goalie · every shootout attempt · period framing · the final
 *   OFTEN   posts, breakaways, blocked-in-front — the near-miss beats that carry
 *           the shape of a period even when nothing goes in
 *   SAMPLED ordinary saves/wide shots, to a per-period budget, with booth chatter
 *           threaded in when a period runs quiet
 *
 * Nothing is invented here that the sim didn't emit — the narrator never decides
 * anything, it only chooses which of the sim's facts get said out loud.
 *
 * TEXT PARITY. Every pool in data/scripts/hockey.bsm is reachable from this file,
 * and every beat type the sim can emit has a branch. A text-only viewer gets the
 * penalties, the casualties and the pulled goalie, not just the goals.
 */
// Every barn's horn is that barn's horn. The soundset already varies a preset from a
// seed, so a stable hash of the club name is the whole feature — no per-club audio, no
// authoring, and the Ashway horn sounds like the Ashway horn forever.
function hornSeedFor(name) {
  let x = 0x9e3779b9 >>> 0;
  for (let i = 0; i < String(name).length; i++) x = (Math.imul(x ^ String(name).charCodeAt(i), 16777619) >>> 0);
  return x >>> 0;
}
// A club's chatter key — the first word of its name, lowercased. `chatter.ashway`
// falls back to the general `chatter` pool, so authoring a barn is optional and a club
// with nothing written for it behaves exactly as before.
const barnKey = (name) => `chatter.${String(name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')}`;

// Per-period budget for beats that carry no consequence (ordinary saves, wide
// shots). Goals and violence are never counted against it — they're always called.
const ROUTINE_PER_PERIOD = 7;
// Chances that are always worth a line: they're the near-misses a period is
// remembered for.
const LOUD_CHANCE = new Set(['post', 'breakaway']);

// How often the booth bothers describing HOW a routine chance was built. Every one and
// the call becomes a stream of breakouts nobody can follow; never, and every chance in
// the game arrives out of nowhere. A goal or a near-miss always gets one.
const BUILDUP_ROUTINE = 0.45;

export function narrate(ctx) {
  const {
    script, game, gs, ws, announcer,
    say, pick, nrng, abbr, recordOf,
  } = ctx;
  const { away, home, awayScore, homeScore, beats } = game;
  const awayAbbr = abbr(away.name), homeAbbr = abbr(home.name);
  const leader = () => (homeScore === awayScore ? '' : (homeScore > awayScore ? home.name : away.name));

  // ── the score bug ─────────────────────────────────────────────────────────
  // Same overlay as baseball's, minus the diamond: teams, scores, a free-text
  // status line ("2nd 07:12"), plus the one thing hockey has that baseball
  // doesn't — live strength, so the bug can show PP/SH/EN while it's true.
  // See docs/bsm-format.md#score-bug-overlay.
  // Running shots on goal, for the bug. Hockey's second number: a 1-0 game is a
  // different game at 9 shots than at 40, and the bug is where a viewer checks.
  let sogAway = 0, sogHome = 0;
  // A rivalry night is flagged on EVERY bug and payload, not just the pre-game — a
  // viewer who tunes in during the second period should be able to tell why these two
  // have taken nine penalties, and the sim really did make it a nastier game.
  const rivalry = !!game.rivalry;
  const bug = (status, aScore, hScore, strength) => ({
    sport: 'hockey',
    away: away.name, home: home.name, awayAbbr, homeAbbr,
    awayScore: aScore ?? 0, homeScore: hScore ?? 0, status,
    shotsAway: sogAway, shotsHome: sogHome,
    ...(rivalry ? { rivalry: true } : {}),
    ...(strength && strength !== 'even' ? { strength } : {}),
  });
  const beatBug = (b) => bug(
    `${b.section || ''}${b.clockStr ? ` ${b.clockStr}` : ''}`.trim() || 'LIVE',
    b.awayScore, b.homeScore, b.strength,
  );

  // ── tokens ────────────────────────────────────────────────────────────────
  // One flat bag per beat. Everything any pool in hockey.bsm references is here
  // whether or not this particular beat has it, because a pool line is chosen at
  // random and an unfilled {token} on air reads as a bug. Missing values fill
  // empty, never as the literal brace.
  const tok = (b) => ({
    announcer, away: away.name, home: home.name,
    awayScore: b.awayScore ?? 0, homeScore: b.homeScore ?? 0,
    leader: (b.homeScore === b.awayScore) ? '' : (b.homeScore > b.awayScore ? home.name : away.name),
    lead: Math.abs((b.homeScore ?? 0) - (b.awayScore ?? 0)),
    section: b.section || '', sectionOrd: b.section || '',
    clock: b.clockStr || '',
    team: b.teamName || b.hitterTeam || b.winnerTeam || b.winTeam || '',
    // Faceoff. `zone` is the dot said out loud the way a booth says it — the END it's
    // in, named by the team defending it, because "the away end" is what a listener
    // can picture and "aZL" is not.
    winTeam: b.winTeam || '', loseTeam: b.loseTeam || '',
    zone: b.dot === 'C' ? 'centre ice'
      : b.dot ? `${(b.dot[0] === 'a' ? away.name : home.name)}${/Z/.test(b.dot) ? ' end' : ' side of the red line'}`
      : '',
    foAway: b.foAway ?? 0, foHome: b.foHome ?? 0,
    rivalry: rivalry ? 'rivalry' : '',
    teamName: b.teamName || '',
    opp: b.oppName || '',
    shooter: b.shooter || b.player || '',
    goalie: b.goalie || '',
    assist: b.assist || '',
    // How the chance was built, read off the same keyframes the rink animates — so a
    // pool line can put the rush in front of the outcome and the booth stops describing
    // only the last half-second of a ten-second play. Empty on beats with no possession.
    rush: b.rush || '',
    // What he hit it with — so a pool line can say "slapshot" on the beat the rink is
    // drawing a slapshot on.
    shotType: b.shotType || '', shotLabel: b.shotLabel || '',
    player: b.player || b.shooter || '',
    strength: b.strength || '',
    infraction: b.infraction || '', penaltyMin: b.penaltyMin ?? '',
    fighters: Array.isArray(b.fighters) ? b.fighters.join(' and ') : '',
    winner: b.winner || '', loser: b.loser || '',
    winnerTeam: b.winnerTeam || '', loserTeam: b.loserTeam || '',
    hitter: b.hitter || '', victim: b.victim || '',
    remaining: b.remaining ?? '', down: b.down ?? '',
    soAway: b.soAway ?? 0, soHome: b.soHome ?? 0,
  });

  // ── the Gameday payload ───────────────────────────────────────────────────
  // The hockey analogue of baseball's per-at-bat card: the same structured facts
  // the announcer is narrating, plus the sim's own possession keyframes so the
  // rink view and the words can never disagree. Cosmetic — the outcome is already
  // fixed by the time this is built.
  const mod = ctx.sport;
  const gameday = (b, idx) => ({
    sport: 'hockey',
    shooter: b.shooter || b.player || '', goalie: b.goalie || '',
    assist: b.assist || '',
    // The rush, in words, on the same payload as the keyframes it was read from — so
    // the rink can print the build-up while it is animating that exact build-up.
    rush: b.rush || '',
    // And WHAT HE HIT IT WITH, on the same payload again: the rink plays the wind-up the
    // sim named, so a call of "slapshot" is a slapshot on screen. One fact, two outputs.
    shotType: b.shotType || '', shotLabel: b.shotLabel || '',
    attackingTeam: b.teamName || '', defendingTeam: b.oppName || '',
    attackingAbbr: abbr(b.teamName || ''), defendingAbbr: abbr(b.oppName || ''),
    // The scoreboard is away/home and never attacking/defending — those flip beat to
    // beat, and a header that flipped with them would look like the score had swapped.
    awayTeam: away.name, homeTeam: home.name,
    awayAbbr, homeAbbr,
    // Club colours, so the rink dresses the two sides in their own sweaters instead
    // of a generic gold-and-blue. Derived from the club name by the sim, so the
    // client needs no palette of its own and can never disagree about who is who.
    awayColours: away.profile?.colours || null,
    homeColours: home.profile?.colours || null,
    rivalry,
    // A seed for the club's own goal horn — every barn's horn should sound like that
    // barn's horn, and the soundset already varies a preset from a seed.
    hornSeed: hornSeedFor(b.teamName || away.name),
    attackingColours: (b.teamName === home.name ? home : away).profile?.colours || null,
    defendingColours: (b.teamName === home.name ? away : home).profile?.colours || null,
    section: b.section || '', clock: b.clockStr || '', clockSecs: b.clock ?? 0,
    kind: b.kind || b.type, type: b.type, strength: b.strength || 'even',
    awayScore: b.awayScore ?? 0, homeScore: b.homeScore ?? 0,
    desc: mod.playDesc(b),
    // Only a shot has a rush behind it. A faceoff or a fight carrying fabricated
    // possession keyframes would have the rink view animate a zone entry that never
    // happened — the view reads `possession` as the truth, so it has to be absent
    // when there wasn't one.
    possession: b.possession || null,
    frozen: !!b.frozen,
    // Faceoff facts, so the view can put the right two men on the right dot. `winnerSide`
    // is which of the two on-ice sides won it, in the view's own att/def frame.
    dot: b.dot || '', reason: b.reason || '',
    winner: b.winner || '', loser: b.loser || '',
    winTeam: b.winTeam || '', loseTeam: b.loseTeam || '',
    winnerTeam: b.winnerTeam || '', loserTeam: b.loserTeam || '',
    // Which of the two on-ice sides won it, in the view's own att/def frame. A fight's
    // exchange names its thrower by NAME, so the view needs to know which end of the
    // rink that name is standing at, and only the server knows whose team he's on.
    winnerSide: b.type === 'faceoff' ? (b.winTeam === away.name ? 'att' : 'def')
      : b.type === 'fight' ? (b.winnerTeam === away.name ? 'att' : 'def') : '',
    fighters: Array.isArray(b.fighters) ? b.fighters.slice() : null,
    exchange: b.exchange || null,
    // ── the violence ────────────────────────────────────────────────────────
    // A hit, an injury, a death and a scrum are beats the announcer has always
    // called and the ice has never shown, which made the rink a highlight reel of
    // the polite half of the sport. They ride the same payload as everything else;
    // what they need beyond it is WHO and, for a hit, WHICH SIDE ate it — a body
    // going into the boards is only legible if it's the right body.
    hitter: b.hitter || '', victim: b.victim || b.player || '',
    hitterTeam: b.hitterTeam || '', victimTeam: b.victimTeam || b.teamName || '',
    // In the view's own att/def frame, so the client never has to know club names.
    victimSide: (b.victimTeam || b.teamName) ? ((b.victimTeam || b.teamName) === away.name ? 'att' : 'def') : '',
    hitterSide: b.hitterTeam ? (b.hitterTeam === away.name ? 'att' : 'def') : '',
    slotsOut: b.slotsOut || 0,
    // A compact league snapshot, so the rink can carry a standings dock the way the
    // baseball Gameday does. Warmed before the graph assembles; empty before the
    // CPhL has played a game, which the dock renders as simply absent.
    standings: ctx.standings || [],
  });

  const goalFx = (b) => ({
    overlayType: 'sportsfx', kind: 'hockeygoal',
    shooter: b.shooter || '', assist: b.assist || '', team: b.teamName || '',
    strength: b.strength || 'even', hattrick: !!b.hattrick,
    away: away.name, home: home.name, awayScore: b.awayScore, homeScore: b.homeScore,
    duration: 3.6,
  });
  const fightFx = (b) => ({
    overlayType: 'sportsfx', kind: 'hockeyfight',
    winner: b.winner || '', loser: b.loser || '', team: b.winnerTeam || '', duration: 3.4,
  });
  const deathFx = (b) => ({
    overlayType: 'sportsfx', kind: 'hockeydeath',
    player: b.player || '', team: b.teamName || '', winner: b.winnerTeam || '', duration: 4.6,
  });

  // ── pre-game ──────────────────────────────────────────────────────────────
  const awayRecord = recordOf(away.name), homeRecord = recordOf(home.name);
  // A club that's in the table but hasn't played reads '0-0-0', which is not a record
  // worth saying out loud — "the 0-0-0 Slaglands Slashers" on opening night is the
  // announcer sounding like a database. Any all-zero record counts as no record.
  const hasRecord = (r) => /[1-9]/.test(String(r || ''));
  const hasRecords = hasRecord(awayRecord) || hasRecord(homeRecord);
  const gameTok = { announcer, away: away.name, home: home.name, awayRecord, homeRecord };
  // Who is missing tonight, and who came up to replace them. A club walking wounded is
  // the whole point of injuries persisting, so it is said out loud before the drop —
  // otherwise the absence is invisible and the feature may as well not exist.
  const callups = [...(away.dressed || []), ...(home.dressed || [])].filter(d => d.callup);
  const preBug = bug('PRE-GAME', 0, 0);
  say(pick(...(ws ? ['cup.intro', 'intro'] : rivalry ? ['rivalry.intro', 'intro'] : ['intro'])), gameTok, preBug);
  // The Cup outranks a rivalry (it IS the bigger night); otherwise a grudge match gets
  // its own matchup line and its own card.
  say(
    pick(...(ws ? ['cup.matchup', 'matchup.records', 'matchup']
      : rivalry ? ['rivalry.matchup', 'matchup.records', 'matchup']
      : (hasRecords ? ['matchup.records', 'matchup'] : ['matchup']))),
    gameTok, preBug,
    {
      overlayType: 'sportsfx', kind: ws ? 'hockeycup' : rivalry ? 'hockeyrivalry' : 'matchup',
      rivalry,
      // `brand` is what tells a shared card (the matchup graphic is Deadball's too) to
      // wear this show's identity instead of the channel's default one.
      brand: 'cphl', show: 'CLUSTER PUCK',
      away: away.name, home: home.name, awayRecord, homeRecord, duration: ws ? 4.6 : 4.0,
    },
  );

  // The injury report, read between the matchup and the opening face-off. Counted
  // separately because it is spoken BEFORE the beat loop declares its line tally.
  let preGameLines = 0;
  if (callups.length) {
    say(pick('injury.report'), {
      ...gameTok,
      missing: callups.map(c => c.replacing).join(', '),
      callups: callups.map(c => c.name).join(', '),
      player: callups[0].replacing, callup: callups[0].name,
      count: callups.length,
    }, preBug); preGameLines++;
  }

  // ── the game ──────────────────────────────────────────────────────────────
  // A penalty puts a clock on the ice that nothing else tracks: the sim tells us a
  // man went in the box and for how long, but never that the kill succeeded. So the
  // narrator carries the box itself and calls `powerplay.kill` on the first beat
  // past the expiry — that beat's own strength being back to even is the proof.
  const boxes = [];   // { team, until } — `until` is a countdown clock, so LOWER is later
  let routine = 0, idx = 0, said = preGameLines;

  // ── the intermission ──────────────────────────────────────────────────────
  // A period ending is not the end of anything on air: there are fifteen minutes of
  // dead ice before the next one, and a broadcast that skips them jumps from a horn
  // straight into a faceoff. So the narrator keeps a running tally of the period it's
  // in and, when the horn goes, reads it back — the scoring summary first, because
  // that's the only part a viewer who left the room needs.
  //
  // Everything here is counted from beats already seen. The sim isn't asked for a
  // single extra field, which is why an intermission can't disagree with the game.
  let per = null;
  const freshPeriod = (section) => ({ section, goals: [], shotsAway: 0, shotsHome: 0, pens: 0, fights: 0, hits: 0, casualties: [] });
  const intermission = (b, sb) => {
    if (!per) return;
    const t = tok(b);
    const stat = {
      ...t,
      shotsAway: per.shotsAway, shotsHome: per.shotsHome,
      shots: per.shotsAway + per.shotsHome,
      // The period they're coming BACK for — an outro that says "back for the 1st"
      // after the first period is the one line in this segment that can be flatly wrong.
      nextOrd: { '1st': '2nd', '2nd': '3rd' }[per.section] || 'overtime',
      penalties: per.pens, fights: per.fights, hits: per.hits,
    };
    // The rink gets an intermission payload of its own, so the sub-screen shows the
    // period summary the announcer is reading instead of holding the last shot on
    // screen for a minute and a half. Same data, so the two can't disagree.
    say(pick('intermission.intro', 'section.end'), stat, sb, null, {
      sport: 'hockey', type: 'intermission',
      section: per.section, nextOrd: stat.nextOrd,
      awayTeam: away.name, homeTeam: home.name, awayAbbr, homeAbbr,
      awayScore: b.awayScore ?? 0, homeScore: b.homeScore ?? 0,
      goals: per.goals.slice(), casualties: per.casualties.slice(),
      shotsAway: per.shotsAway, shotsHome: per.shotsHome,
      penalties: per.pens, fights: per.fights, hits: per.hits,
      standings: ctx.standings || [],
    }); said++;
    if (per.goals.length) {
      say(pick('intermission.summary'), stat, sb); said++;
      // One line per goal, in the order they went in — the scoring summary is a list,
      // and a pool line pretending to be a list would get the order wrong.
      for (const g of per.goals) {
        const gt = { ...t, ...g, shooter: g.shooter, assist: g.assist || 'unassisted', team: g.teamName, clock: g.clockStr };
        say(pick('intermission.goal'), gt, sb); said++;
      }
    } else {
      say(pick('intermission.scoreless'), stat, sb); said++;
    }
    say(pick('intermission.stats'), stat, sb); said++;
    if (per.casualties.length) {
      say(pick('intermission.casualties'), { ...stat, player: per.casualties[0], casualties: per.casualties.join(', '), count: per.casualties.length }, sb); said++;
    }
    say(pick('intermission.outro', 'chatter'), stat, sb); said++;
  };
  // The home barn's own colour first, the league-wide pool behind it.
  const chatter = (b) => { const l = pick(barnKey(home.name), 'chatter'); if (l) { say(l, tok(b), beatBug(b)); said++; } };

  // THE PLAY BEFORE THE OUTCOME. The booth used to describe only the last half-second of
  // a ten-second passage: the viewer watched a breakout, a zone entry and two passes and
  // heard "saved". `b.rush` is the sim's own reading of the very keyframes the rink is
  // about to animate, so this line and the picture are the same play by construction
  // rather than by two authors happening to agree.
  //
  // Spoken FIRST and WITHOUT a gameday payload, deliberately: the outcome line still
  // owns the cut to the new beat, so nothing about the existing timing moves and a beat
  // that has no rush behaves exactly as it did before.
  const buildUp = (b, t, sb, loud) => {
    if (!b.rush) return;
    if (!loud && nrng() >= BUILDUP_ROUTINE) return;
    say(b.rush, t, sb); said++;
  };

  for (const b of beats) {
    idx++;
    // Shots first, so the bug attached to THIS beat already counts this shot — a
    // goal that doesn't move the shot clock on the same line looks broken.
    if ((b.type === 'chance' && b.shot) || b.type === 'goal') {
      if (b.teamName === away.name) sogAway++; else sogHome++;
    }
    const t = tok(b), sb = beatBug(b);

    // Tally the period as it happens — every counter the intermission reads back.
    if (per) {
      if (b.type === 'goal') per.goals.push({ shooter: b.shooter, assist: b.assist, teamName: b.teamName, clockStr: b.clockStr, strength: b.strength });
      else if (b.type === 'chance' && b.shot) { if (b.teamName === away.name) per.shotsAway++; else per.shotsHome++; }
      else if (b.type === 'penalty') per.pens++;
      else if (b.type === 'fight') per.fights++;
      else if (b.type === 'boards') per.hits++;
      else if (b.type === 'injury' || b.type === 'death') per.casualties.push(b.player);
    }
    // A goal is a shot too, and the shot clock is the one stat viewers check.
    if (per && b.type === 'goal') { if (b.teamName === away.name) per.shotsAway++; else per.shotsHome++; }

    // Retire expired penalties before narrating this beat, so the kill is called
    // in the right place in the chain rather than after the next goal.
    if (boxes.length && Number.isFinite(b.clock)) {
      for (let i = boxes.length - 1; i >= 0; i--) {
        if (b.clock <= boxes[i].until) {
          const killed = boxes.splice(i, 1)[0];
          if (!boxes.length) { say(pick('powerplay.kill'), { ...t, team: killed.against }, sb); said++; }
        }
      }
    }

    switch (b.type) {
      case 'period_start':
        routine = 0;
        per = freshPeriod(b.section);
        if (b.sudden) say(pick('ot.intro'), t, sb);
        else say(pick('section.start', 'section'), t, sb);
        said++;
        break;

      case 'period_end':
        // A quiet period gets padded before the horn rather than after it.
        for (let g = 0; g < 3 && routine < 3; g++) { chatter(b); routine++; }
        say(pick('section.end'), t, sb); said++;
        // Then the break. Overtime has no intermission — they resurface and go again,
        // and a recap segment in sudden death would be the broadcast looking away at
        // the exact moment it must not.
        if (!b.sudden) intermission(b, sb);
        per = null;
        break;

      case 'goal': {
        const key = b.strength === 'pp' ? 'goal.pp' : b.strength === 'sh' ? 'goal.sh' : b.strength === 'en' ? 'goal.en' : 'goal';
        buildUp(b, t, sb, true);
        say(pick(key, 'goal'), t, sb, goalFx(b), gameday(b, idx)); said++;
        say(pick('score.update'), t, sb); said++;
        break;
      }

      // The drop. The sim already decided which of the nine dots and who won it, so
      // the announcer only has to say it — but he can't say all of them: a game has
      // ~40 stoppages and most are a frozen puck nobody remembers. The ones that
      // MEAN something (centre ice after a goal, the drop that starts a period, a
      // draw taken in your own end while a man sits in the box) are always called;
      // the routine ones are colour, aired only when the period is quiet.
      case 'faceoff': {
        const key = b.dot === 'C' ? 'faceoff.center'
          : /Z/.test(b.dot) ? 'faceoff.zone' : 'faceoff.neutral';
        const loud = b.reason === 'goal' || b.reason === 'period' || b.reason === 'penalty';
        if (!loud && routine >= ROUTINE_PER_PERIOD) break;
        say(pick(key, 'faceoff'), t, sb, null, gameday(b, idx)); said++;
        if (!loud) routine++;
        break;
      }

      case 'hattrick':
        say(pick('hattrick'), t, sb); said++;
        break;

      case 'chance': {
        const loud = LOUD_CHANCE.has(b.kind);
        if (!loud && routine >= ROUTINE_PER_PERIOD) break;
        buildUp(b, t, sb, loud);
        say(pick(`shot.${b.kind}`, 'shot.save'), t, sb, null, gameday(b, idx)); said++;
        if (!loud) routine++;
        // Booth colour rides on the quiet beats, never on top of a goal.
        if (!loud && nrng() < 0.22) { chatter(b); routine++; }
        break;
      }

      case 'penalty':
        say(pick(b.penaltyMin >= 5 ? 'penalty.major' : 'penalty', 'penalty'), t, sb); said++;
        // The team that DIDN'T take it goes on the power play.
        boxes.push({ against: b.teamName, until: b.clock - b.penaltyMin * 60 });
        say(pick('powerplay.start'), { ...t, team: b.teamName === away.name ? home.name : away.name }, sb); said++;
        break;

      case 'fight':
        say(pick('penalty.fight'), t, sb, null, gameday(b, idx)); said++;
        say(pick('fight.result'), t, sb, fightFx(b)); said++;
        boxes.push({ against: b.loserTeam, until: b.clock - 5 * 60 });
        break;

      // The violent beats carry a Gameday payload for the same reason a goal does:
      // the rink is supposed to be showing what the announcer is describing, and a
      // league where men are carried off and occasionally killed cannot have those
      // be the only calls the ice sits still through.
      case 'boards':
        say(pick('boards'), t, sb, null, gameday(b, idx)); said++;
        break;

      case 'injury':
        say(pick('injury'), t, sb, null, gameday(b, idx)); said++;
        break;

      case 'death':
        say(pick('death'), t, sb, deathFx(b), gameday(b, idx)); said++;
        break;

      case 'scrum':
        say(pick('scrum'), t, sb, null, gameday(b, idx)); said++;
        break;

      case 'pull':
        say(pick('pull'), t, sb); said++;
        break;

      case 'shootout_start':
        say(pick('shootout.intro'), t, bug('SO', b.awayScore, b.homeScore)); said++;
        break;

      case 'shootout':
        say(pick(b.scored ? 'shootout.score' : 'shootout.miss'), t,
          bug(`SO ${b.soAway}-${b.soHome}`, b.awayScore, b.homeScore)); said++;
        break;

      case 'shootout_end':
        say(pick('shootout.winner'), t, bug('SO FINAL', b.awayScore, b.homeScore)); said++;
        break;

      case 'final':
        break;   // called below off the settled score, not the beat

      default:
        break;
    }
  }

  // ── final ─────────────────────────────────────────────────────────────────
  const winName = leader();
  const finalTok = {
    announcer, away: away.name, home: home.name, awayScore, homeScore,
    leader: winName, lead: Math.abs(homeScore - awayScore),
    section: 'FINAL', sectionOrd: 'FINAL', clock: '0:00',
  };
  const finalBug = bug('FINAL', awayScore, homeScore);
  say(pick(...(ws ? ['cup.final', 'final'] : ['final'])), finalTok, finalBug, {
    overlayType: 'sportsfx', kind: ws ? 'champion' : 'gamewin',
    winner: winName, loser: winName === away.name ? home.name : away.name,
    winScore: winName === away.name ? awayScore : homeScore,
    loseScore: winName === away.name ? homeScore : awayScore,
    away: away.name, home: home.name, awayScore, homeScore,
    label: ws ? 'Coldwater Cup Champions' : '',
    duration: ws ? 5.4 : 4.4,
  });
  const outroId = ctx.lastId();
  say(pick(...(ws ? ['cup.outro', 'outro'] : ['outro'])), finalTok, finalBug);
  return { outroId, lines: said };
}

export default narrate;
