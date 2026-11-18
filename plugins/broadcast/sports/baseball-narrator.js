// DEADBALL's play-by-play: a simulated game's beats turned into the booth's lines, in air order.
//
// assembleSportsGraph (broadcast/index.js) keeps the sport-agnostic scaffolding (the node chain,
// the `say` and `pick` helpers, the seeded narration streams, the pacing and the graph) and hands
// the middle to the sport: hockey through its `narrate` (sports/hockey-narrator.js), baseball
// through this. It was the `else` of that function until the park clock's gate
// (scripts/shapes/parkclock-smoke.mjs) needed a game's real lines without importing index.js,
// which loads the plugin's state from the database as it's imported. Moved whole: the same
// lines come out in the same order from the same draws.
//
// Pure. Everything that reads the live server comes in on `c`: the league table and the
// season (`recordOf`, `pregame`, `standings`, `leaders`, `ledger`, `seasonState`), the venue's
// words and stamp (`venueSaid`, `venueRev`, `liveHoldS`), and the final's package
// (`finalPackage`). A gate passes its own (scripts/shapes/parkclock-season.mjs).
//
//   c.say(line, tok, sb, graphic, gd, meta)
//                            fill a pool line and append it to the chain as a say node
//   c.pick, c.xpick, c.nrng  draw from the narration stream and from the venue's own
//   c.nodes, c.startId       the chain so far, which the payloads are stamped on at the end
//   c.fillMs                 the play-by-play's share of the slot (ms)
//   c.lastId()               the chain's last node, so the caller knows where the outro starts
//   c.desk(when, at, sb, cut) a show's segment at a moment, the desk's or the booth's (`booth_*`);
//                            true when one aired
//   c.boothCut               the one cut to the booth this game gets (facts.js boothCuts), or null
//
// Returns { outroId }: the final's line, which the pacer holds to the slot's end.
import { sportsRng, sportsHash, sportsFill, sportsPickTagged } from '../rng.js';
import { BASEBALL } from './baseball.js';
import { gamedayPayloads, gameMvp } from './baseball-gameday.js';
import { makeBooth, exciteFor as exciteOf } from './baseball-booth.js';
import { rivalOf } from './hockey.js';
import { landBy, afterLand, tripOf } from '../../../client/game/js/panels/diamond/timing.js';
import { venueField } from '../../../client/game/js/panels/diamond/geo.js';

export function narrateBaseball(c) {
  const {
    script, game, gs, ws, announcer, pools, nrng, pick, xpick, winner, nodes, startId,
    sport: sportMod, fillMs, abbr: sportsAbbr, ordinal: sportsOrdinal,
    recordOf, standings, leaders, ledger, seasonState, venueRev: venueStamp, venueSaid, liveHoldS: LIVE_HOLD_S,
  } = c;
  const { away, home, awayScore, homeScore } = game;
  // In a final every call runs hotter: the same play means more, and the booth sounds it. The
  // lean-in before a pitch comes in a smaller spot too.
  const exciteFor = (b, h, phase = 'call', bases = null) => {
    const v = exciteOf(b, h, phase, bases);
    if (!ws) return v;
    if (phase === 'before' && !v) return exciteOf({ ...b, inning: Math.max(9, b.inning || 0) }, h, phase, bases);
    return Math.min(1, Math.round((v * 1.25 + (v > 0 ? 0.08 : 0)) * 100) / 100);
  };
  // How excited the booth is at the play it's on (exciteFor), on every line it says until it
  // moves on; a line that brings its own wins.
  let curExcite = 0;
  const say = (line, tok, sb, graphic, gd, meta) => c.say(line, tok, sb, graphic, gd, curExcite && !(meta && meta.excite) ? { ...meta, excite: curExcite } : meta);

  // Persistent score-bug snapshot attached to each spoken line. The shape is
  // sport-agnostic (teams + scores + a free-text status line); baseball adds the
  // sport-specific `outs` + `bases` so the client can draw the diamond. Another
  // sport just sets `status` (e.g. "Q3 08:42") and omits outs/bases — same bug,
  // no diamond. See docs/bsm-format.md#score-bug-overlay.
  const awayAbbr = sportsAbbr(away.name), homeAbbr = sportsAbbr(home.name);
  const bug = (status, aScore, hScore, outs, bases) => ({
    sport: 'baseball',
    away: away.name, home: home.name, awayAbbr, homeAbbr,
    awayScore: aScore, homeScore: hScore, status,
    ...(outs != null ? { outs } : {}),
    ...(bases ? { bases } : {}),
    // the Curtain Call: the Coliseum on the map seats a full house for it (world-feed.js venuePlay)
    ...(ws ? { final: true } : {}),
  });
  const beatBug = (b) => bug(
    `${b.half === 'top' ? 'TOP' : 'BOT'} ${sportsOrdinal(b.inning)}`,
    b.awayScore, b.homeScore, b.outs ?? 0, b.bases || [false, false, false],
  );

  // A play's ball in play (sports/baseball-gameday.js), once the payloads are built below.
  let playOf = () => null;
  const beatTok = (b) => ({
    announcer, away: away.name, home: home.name,
    team: b.battingName, batter: b.batter || '', pitcher: b.pitcher || '',
    inning: b.inning, inningOrd: sportsOrdinal(b.inning), half: b.half || '',
    section: 'inning', sectionOrd: sportsOrdinal(b.inning),
    outs: b.outs ?? '', rbi: b.rbi ?? 0, runs: b.runs ?? b.rbi ?? 0,
    // The sport's own words for a play, where it has them: Deadball's sim v2 names the
    // man running, the bag in play and the fielder charged with an error, and a ball in
    // play names who fielded it.
    ...(sportMod.playTokens?.(b, playOf(b)) || {}),
    awayScore: b.awayScore, homeScore: b.homeScore,
    battingScore: b.half === 'top' ? b.awayScore : b.homeScore,
    fieldingScore: b.half === 'top' ? b.homeScore : b.awayScore,
    leader: b.homeScore === b.awayScore ? '' : (b.homeScore > b.awayScore ? home.name : away.name),
    lead: Math.abs(b.homeScore - b.awayScore),
  });

  // Rich per-at-bat snapshot for the animated Gameday sub-screen. Rides one say node
  // per beat (the lead line) exactly like the score-bug/FX, and is pushed to watchers
  // when that line airs; the client animates it. Carries the same structured data Chip
  // is narrating (batter/pitcher/kind/bases before→after), the line score so far and a
  // pitch sequence seeded off the game seed, so every TV renders it identically. Built
  // by a pure module the gates can run without a server (sports/baseball-gameday.js);
  // the league table, the leaders and the season ride only the first payload (see below),
  // and every play carries the batter's and pitcher's lines, folded from the same season.
  const GD = gamedayPayloads(game, gs.seed, { abbr: sportsAbbr, ordinal: sportsOrdinal, ledger, venue: script.venue || null });
  const gdStandings = standings;
  const gdLeaders = leaders;
  // the booth's call at the crack for every ball in play (BASEBALL.contactCall), drawn from a
  // stream of its own so the lines the booth already picks don't move
  const crng = sportsRng(sportsHash(gs.seed, 0xc0ac));
  for (const p of GD.order) if (p.play && !p.phase) { const c = BASEBALL.contactCall(p, pools, crng, sportsFill); if (c) p.contact = { text: c, by: announcer }; }
  // a game between rivals (rivalOf over this league, the pairing the hockey side uses too) says
  // so on every payload, so the 3-D park knows a hit batter can empty the benches
  const bbLeague = (Array.isArray(script.teams) ? script.teams : []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
  if (rivalOf(away.name, bbLeague) === home.name) for (const p of GD.order) p.rivals = true;
  const beatGameday = (b) => GD.atbat.get(b);
  playOf = (b) => GD.atbat.get(b)?.play || null;
  // A ball in play's line agrees with its picture: the play's tags (where it went, how it was
  // fielded) open the pools that say so, beside the bare pool (sportsPickTagged).
  const fence = venueField(script.venue).fence;
  const pickPlay = (b, ...keys) => {
    const gd = GD.atbat.get(b);
    return sportsPickTagged(pools, nrng, BASEBALL.playTags(b.kind, gd?.play, { bats: gd?.bats, fence }), ...keys);
  };
  // The half-inning break: `phase: 'half'`, so a client never animates it as a play.
  const halfGameday = (b) => GD.half.get(b);
  // The score after a run. A level score has lines of its own: the leader line reads
  // "out in front by 0" when nobody is. One draw either way, so no other line moves.
  const scoreUpdate = (b) => pick(...(b.awayScore === b.homeScore ? ['score.tied', 'score.update'] : ['score.update']));
  const hrGraphic = (b) => ({ overlayType: 'sportsfx', kind: 'homerun', batter: b.batter || '', team: b.battingName || '', grand: b.rbi >= 4, duration: 3.8 });
  const walkoffGraphic = (b) => ({ overlayType: 'sportsfx', kind: 'walkoff', batter: b.batter || '', team: b.battingName || '', home: home.name, away: away.name, homeScore: b.homeScore, awayScore: b.awayScore, duration: 4.4 });
  const dpGraphic = (b) => ({ overlayType: 'sportsfx', kind: 'doubleplay', batter: b.batter || '', duration: 2.4 });
  // The triple play holds a beat longer than the double play. It's the rarest thing the
  // sim can produce (~1 per 400 games) and the card is most of the payoff.
  const tpGraphic = (b) => ({ overlayType: 'sportsfx', kind: 'tripleplay', batter: b.batter || '', duration: 3.6 });
  // The play a line calls, for the room watching (see `say`). `for` is the side it was
  // good for. A run that ends the game is the walk-off, on the line that says the score,
  // so a room reacts to the game ending and not to the run before it.
  const playMeta = (b, kind, over = {}) => ({ play: {
    sport: 'baseball', kind, for: b.battingName, against: b.fieldingName, player: b.batter || '',
    away: away.name, home: home.name, awayScore: b.awayScore, homeScore: b.homeScore, ...over,
  } });
  const runMeta = (b) => playMeta(b, b.walkoff ? 'walkoff' : 'run', { runs: b.runs ?? b.rbi ?? 1 });

  // Pre-game records from the live standings (module cache, refreshed before airing).
  // When either team has a record on the board, the announcer works it into the
  // matchup; before any games are played it's plain (avoids "the 0-0 X" on opening day).
  const awayRecord = recordOf(away.name), homeRecord = recordOf(home.name);
  const hasRecords = awayRecord !== '0-0' || homeRecord !== '0-0';
  const gameTok = { announcer, away: away.name, home: home.name, awayRecord, homeRecord };
  const pregameBug = bug('PRE-GAME', 0, 0, 0, [false, false, false]);
  // The pregame open goes up with the first line and holds through the matchup, so the
  // matchup line carries a card of its own only on the night of the final.
  const pregame = c.pregame({ away: away.name, home: home.name, awayRecord, homeRecord, show: 'DEADBALL' });
  // Live from the park: the first line after the title card, and the 3-D view flies in over the
  // city onto it (`phase: 'arrive'`; a TV without the view puts up the LIVE card).
  const venue = venueSaid(script);
  if (venue) {
    say(xpick(...(ws ? ['worldseries.live', 'live'] : ['live'])), { ...gameTok, venue, final: sportMod.season?.finalName || 'Final' }, pregameBug,
      { overlayType: 'sportsfx', kind: 'live', sport: 'baseball', venue: script.venue?.name || venue, show: 'DEADBALL', ...(ws ? { final: sportMod.season?.finalName || 'Final' } : {}), duration: LIVE_HOLD_S },
      { sport: 'baseball', phase: 'arrive', venue: script.venue?.name || venue, away: away.name, home: home.name, ...(ws ? { final: sportMod.season?.finalName || 'Final' } : {}) },
      ws && script.venue?.finalOpen?.song ? { song: script.venue.finalOpen.song } : null);
  }
  // A final opens on its package instead of the table: the tape has each club's record and place.
  say(pick(...(ws ? ['worldseries.intro', 'intro'] : ['intro'])), gameTok, pregameBug, ws ? null : pregame);
  // The final's package: the tale of the tape, the road here and the men to watch, read out.
  if (ws) c.finalPackage('worldseries.', pregameBug, { show: 'DEADBALL' });
  const muGraphic = ws
    ? { overlayType: 'sportsfx', kind: 'worldseries', final: sportMod.season?.finalName || 'Final', away: away.name, home: home.name, awayRecord, homeRecord, duration: 4.6 }
    : null;
  say(pick(...(ws ? ['worldseries.matchup', 'matchup.records', 'matchup'] : (hasRecords ? ['matchup.records', 'matchup'] : ['matchup']))), gameTok, pregameBug, muGraphic);
  c.desk?.('open', null, pregameBug);
  // and the desk throws to the booth: the two men calling it, on camera in the press box
  c.desk?.('booth_open', null, pregameBug);

  // The half-innings, each narrated in full: every plate appearance is called, so the park
  // never jumps a man the booth skipped, and between them the booth talks
  // (sports/baseball-booth.js): who's up and his season, what the pitcher throws, tonight's
  // storylines, the situation, and the two men in the booth passing the time. Each plate
  // appearance gets an even share of the slot, and the booth spends what the play and its call
  // leave of it. The pacer (sports/baseball-pacing.js) settles the exact holds.
  const halves = GD.halves;

  // Regulation (innings 1–9) is narrated full and dry. Extras are narrated as tight
  // "cut to the drama" innings below — only the plays that matter.
  const regHalves = halves.filter(h => h.start.inning <= 9);
  const extraHalves = halves.filter(h => h.start.inning >= 10);

  // A line that names a club (its full name, or the name less its place: "Blue Birds") only
  // airs when that club is playing; the booth talks about the two teams on the field.
  const benched = bbLeague.filter((t) => t !== home.name && t !== away.name)
    .flatMap((t) => [t, t.split(/\s+/).slice(1).join(' ')]).filter(Boolean)
    .map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  const boothPools = benched.length
    ? Object.fromEntries(Object.entries(pools || {}).map(([k, L]) => [k, Array.isArray(L) ? L.filter((l) => typeof l !== 'string' || !benched.some((re) => re.test(l))) : L]))
    : pools;
  const talkers = makeBooth({
    pools: boothPools, rand: sportsRng(sportsHash(gs.seed, 0xb007)), announcer, analyst: script.analyst || '', game,
    leaders: gdLeaders, recordOf: (team) => recordOf(team), ledger,
    // the clubs' history (sports/club-lore.js), told at the changeovers off its own stream
    lore: c.lore || null, loreRand: c.loreRand || null,
    // the Curtain Call: how each club got here, the stakes and the pressure (baseball-booth.js)
    final: ws ? { name: sportMod.season?.finalName || 'Final', ...(c.finalFacts?.() || {}) } : null,
  });
  const brng = sportsRng(sportsHash(gs.seed, 0xb008));
  // One plate appearance's share of the slot (s), a changeover counting as one and a half, and
  // the seconds of it the pitches, the play and its call take (an estimate; the pacer is exact).
  const paCount = regHalves.reduce((n, h) => n + h.atbats.filter((b) => b.type === 'atbat').length, 0);
  const share = Math.max(10, (fillMs / 1000 - 90) / Math.max(1, paCount + 1.5 * regHalves.length));
  // the park's own clock (diamond/timing.js): the pitches and the play, then the call
  const landSecs = (b) => landBy({ ...beatGameday(b), hold: share * 1000 });
  const callSecs = (b) => landSecs(b) + 7 + ((b.runs ?? b.rbi ?? 0) > 0 ? 5 : 0);
  const talk = (lines, sb) => { for (const l of lines) say(l.text, {}, sb, null, null, { opt: l.opt }); return lines.reduce((a, l) => a + l.secs, 0); };
  let bank = 0;   // the booth's seconds in hand

  const finalTok = {
    announcer, away: away.name, home: home.name, awayScore, homeScore,
    leader: winner(), lead: Math.abs(homeScore - awayScore),
    inning: game.innings, inningOrd: sportsOrdinal(game.innings),
  };
  const finalBug = bug('FINAL', awayScore, homeScore);   // game over: no outs or bases, just the score
  const winName = winner();
  const winGraphic = {
    overlayType: 'sportsfx', kind: ws ? 'champion' : 'gamewin',
    ...(ws ? { label: `${sportMod.season?.finalName || 'Final'} Champions` } : {}),
    winner: winName,
    loser: winName === away.name ? home.name : away.name,
    winScore: winName === away.name ? awayScore : homeScore,
    loseScore: winName === away.name ? homeScore : awayScore,
    away: away.name, home: home.name, awayScore, homeScore,
    extras: game.innings > 9, inningOrd: sportsOrdinal(game.innings),
    duration: ws ? 5.4 : 4.4,
  };
  // The final, said once, the moment the game ends: straight off the last out's call (`final.out`)
  // or the walk-off's (`final.walkoff`), with nothing in between. If neither said it, it's said below.
  let finalSaid = false;
  const sayFinal = (...lead) => {
    if (finalSaid) return;
    finalSaid = true;
    say(pick(...lead, ...(ws ? ['worldseries.final', 'final'] : ['final'])), finalTok, finalBug, winGraphic, null, winName ? { play: {
      sport: 'baseball', kind: 'final', for: winName, against: winName === away.name ? home.name : away.name,
      away: away.name, home: home.name, awayScore, homeScore, champion: !!ws,
    } } : null);
  };
  // THE CHAMPIONS (a final, after its last line). The field's theirs while the booth says how they
  // won it, the game and then the season, and the losers get a word; then the Memorial Cup: its
  // line carries a payload of its own (`phase: 'crown'`), and the 3-D park cuts to the trophy's
  // table with the champions round it, where the night's stars lift it one after another
  // (diamond/ceremony.js). Its lines draw from the venue's stream (xpick), so the outro's line and
  // everything the booth picked before stay as they were. The last-out payload's hold runs to the
  // cup's, so the park's celebration lasts as long as this talk (and at least AFTER.champion,
  // diamond/timing.js, which the pacer makes room for).
  const champions = () => {
    const W0 = winName === away.name ? away : home, L0 = W0 === away ? home : away;
    const mvp = gameMvp(GD.order, winName);
    const stars = cupStars(GD.order, winName, W0, mvp);
    // the run that put them ahead for good: the last payload that took the winners from level or
    // behind to in front
    let decider = null, was = 0;
    for (const p of GD.order) {
      if (p.phase === 'half' || p.phase === 'arrive' || !Number.isFinite(p.awayScore) || !Number.isFinite(p.homeScore)) continue;
      const lead = winName === away.name ? p.awayScore - p.homeScore : p.homeScore - p.awayScore;
      if (lead > 0 && was <= 0 && p.battingTeam === winName) decider = p;
      was = lead;
    }
    const deciderName = decider ? (decider.phase === 'run' ? decider.runner || '' : decider.batter || '') : '';
    const seed = winName === seasonState.finalistA ? 1 : winName === seasonState.finalistB ? 2 : null;
    const ws_ = Math.max(awayScore, homeScore), ls_ = Math.min(awayScore, homeScore);
    const tok = {
      ...finalTok, loser: L0.name, score: `${ws_} to ${ls_}`, record: recordOf(winName),
      seedSaid: seed === 1 ? 'the top seed' : seed === 2 ? 'the second seed' : 'the underdog',
      mvp: mvp?.name || stars[0] || winName, mvpLine: mvpSaid(mvp?.line), decider: deciderName,
      deciderOrd: decider ? sportsOrdinal(decider.inning) : '',
      cup: CUP_NAME, star1: stars[0] || '', star2: stars[1] || stars[0] || '', star3: stars[2] || stars[1] || stars[0] || '',
      chip: String(announcer).split(' ')[0], dusty: String(script.analyst || '').split(' ')[0],
    };
    // a pool's line as the booth says it: Chip's turns plain, the colour man's as "Name says"
    const exchange = (line, first = {}) => {
      if (!line) return;
      String(line).split(/\s*\|\|\s*/).forEach((t, i) => {
        const said = sportsFill(t, tok).trim();
        if (!said) return;
        const colour = i % 2 === 1 && script.analyst;
        say(colour ? `${script.analyst} says, "${said.replace(/"/g, "'")}"` : said, {}, finalBug, i === 0 ? first.graphic : null, i === 0 ? first.gd : null);
      });
    };
    exchange(xpick(deciderName ? 'worldseries.celebrate.game' : 'worldseries.celebrate.game.nodecider', 'worldseries.celebrate.game.nodecider'));
    exchange(xpick('worldseries.celebrate.season'));
    exchange(xpick('worldseries.celebrate.loser'));
    // the Cup: the park turns over to the ceremony on this line
    const top = W0 === away;
    exchange(xpick('worldseries.cup') || 'The {cup}, for the {leader}.', {
      graphic: { ...winGraphic, label: CUP_NAME, duration: 4.6 },
      gd: {
        sport: 'baseball', phase: 'crown', cup: CUP_NAME, final: sportMod.season?.finalName || 'Final',
        winner: winName, loser: L0.name, away: away.name, home: home.name, awayScore, homeScore,
        // the champions take the field for it, so the cast is theirs (diamond/cast.js crownCast)
        half: top ? 'bottom' : 'top', fieldingTeam: winName, battingTeam: L0.name,
        fieldingAbbr: top ? awayAbbr : homeAbbr, battingAbbr: top ? homeAbbr : awayAbbr,
        inning: game.innings, pitcher: W0.pitcher || '', stars, mvp: mvp || null,
      },
    });
    exchange(xpick('worldseries.cup.lift'));
    if (stars.length > 1) exchange(xpick('worldseries.cup.pass'));
  };

  // The game's last play is known up front: the last beat of the last half. In regulation the booth
  // sees it coming (one out away) and calls it as the end; extras are cut to the drama below.
  const endsInRegulation = !extraHalves.length;
  const lastHalf = regHalves[regHalves.length - 1];
  const lastBeat = endsInRegulation ? lastHalf?.atbats[lastHalf.atbats.length - 1] : null;
  // The score and outs before beat i of half h.
  const before = (h, i) => {
    const p = h.atbats.slice(0, i).reverse().find((x) => x.awayScore != null) || h.start;
    return { a: p.awayScore, h: p.homeScore, outs: i ? (h.atbats[i - 1].outs ?? 0) : 0 };
  };

  for (const h of regHalves) {
    // the stretch is the game's one break: the desk has it before the bottom of the seventh
    // (the booth sends it there first)
    if (h.start.inning === 7 && h.start.half === 'bottom') { c.desk?.('booth_break', h.start, beatBug(h.start)); c.desk?.('break', h.start, beatBug(h.start)); }
    say(pick(`half.${h.start.half}`, 'half'), beatTok(h.start), beatBug(h.start), null, halfGameday(h.start));
    bank += 1.5 * share - 6;
    // a new man on the mound for the half (sim v5): who he is, before anything else
    if (h.start.mound) bank -= talk(talkers.mound(h.start, { ...halfGameday(h.start), pl: beatGameday(h.atbats.find((x) => x.type === 'atbat'))?.pl }), beatBug(h.start));
    bank -= talk(talkers.changeover(h.start, { ...halfGameday(h.start), pl: beatGameday(h.atbats.find((x) => x.type === 'atbat'))?.pl }, bank * 0.6), beatBug(h.start));
    let walkoffHalf = false;
    let oneAwaySaid = false;

    for (const b of h.atbats) {
      const tok = beatTok(b), sb = beatBug(b);
      const gd = beatGameday(b);
      curExcite = exciteFor(b, home.name, 'call', gd?.basesBefore);
      if (b.type === 'run') {
        // A play on the bases while the batter is up (sim v2). A steal, an out on the
        // bases and anything that scores is always called; a throw over the runner beats
        // back is colour, called about half the time.
        // (never one with a trip to the mound before it: the park shows the trip on its payload)
        if (b.kind === 'throwover' && brng() < 0.5 && !b.mound) continue;
        const scored = (b.runs || 0) > 0;
        const keys = b.kind === 'doublesteal' && b.out ? ['run.doublesteal.out', 'run.caughtstealing']
          : (scored ? [`run.${b.kind}.score`, `run.${b.kind}`] : [`run.${b.kind}`]);
        // a trip to the mound before it (sim v5): said first, with the payload, and the play is its call
        const trip = b.mound || b.warm ? talkers.mound(b, gd) : [];
        trip.forEach((l, i) => say(l.text, {}, beatBug(h.atbats[h.atbats.indexOf(b) - 1] || h.start), null, i === 0 ? { ...gd, lead: true } : null, i === 0 ? null : { opt: l.opt }));
        if (trip.length) say(pick(...keys), tok, sb, null, null, { call: true });
        else say(pick(...keys), tok, sb, null, gd);
        if (scored) say(scoreUpdate(b), tok, sb, null, null, runMeta(b));
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); walkoffHalf = true; }
        // a steal or a ball that got by that put a man in scoring position: the booth says where that leaves it
        else if (!b.out && !scored) bank -= talk(talkers.risp(b, gd), sb);
        talkers.trackRun(b, gd);
        if (walkoffHalf || b === lastBeat) { curExcite = 0; sayFinal(walkoffHalf ? 'final.walkoff' : 'final.out'); break; }
        if (c.boothCut?.beat === b) c.desk?.('booth_cut', b, sb, c.boothCut);
        continue;
      }
      // The batter coming up. The booth talks over the pitches: the at-bat's payload rides the first
      // line of its talk (`lead`), so the park starts the at-bat as the talk does, and the call is a
      // line of its own that the park holds till the ball lands (`call`). The talk is sized to end
      // by then; the pacer makes sure of it. With nothing to say, the payload rides the call.
      bank += share - callSecs(b);
      curExcite = exciteFor(b, home.name, 'before', gd?.basesBefore);
      // One out from the end with the fielding side ahead, in the half that ends the game: the booth
      // says so before the pitches, once a half.
      if (endsInRegulation && h === lastHalf && h.start.inning >= 9 && !oneAwaySaid) {
        const i = h.atbats.indexOf(b), s = before(h, i);
        const top = h.start.half === 'top';
        if (s.outs === 2 && (top ? s.h > s.a : s.a > s.h)) {
          oneAwaySaid = true;
          say(pick('lastout.up'), { ...tok, fielding: top ? home.name : away.name, batting: top ? away.name : home.name, lead: Math.abs(s.h - s.a) }, beatBug(h.atbats[i - 1] || h.start));
        }
      }
      // a trip to the mound first (sim v5): the park shows it before the pitches, so the booth says it
      // first, and the man coming up gets what's left of the time
      const trip = b.mound || b.warm ? talkers.mound(b, gd) : [];
      const tripSecs = trip.reduce((a, l) => a + l.secs, 0);
      const pre = [...trip, ...talkers.before(b, gd, Math.max(0, landSecs(b) - 2 - Math.max(tripSecs, tripOf(gd))))];
      const preBug = beatBug(h.atbats[h.atbats.indexOf(b) - 1] || h.start);
      pre.forEach((l, i) => say(l.text, {}, preBug, null, i === 0 ? { ...gd, lead: true } : null, i === 0 ? null : { opt: l.opt }));
      curExcite = exciteFor(b, home.name, 'call', gd?.basesBefore);
      const G = pre.length ? null : gd;
      const CM = (m) => (pre.length ? { ...(m || {}), call: true } : m);
      if (b.kind === 'homerun') {
        const key = b.rbi >= 4 ? 'hr.grand' : (b.rbi === 1 ? 'hr.solo' : 'hr');
        say(pickPlay(b, key, 'hr'), tok, sb, hrGraphic(b), G, CM(playMeta(b, b.walkoff ? 'walkoff' : 'homerun', { homerun: true, grand: b.rbi >= 4, runs: b.rbi })));
        say(scoreUpdate(b), tok, sb);
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); walkoffHalf = true; }
      } else if (b.kind === 'sacfly') {
        say(pickPlay(b, 'atbat.sacfly'), tok, sb, null, G, CM());
        say(scoreUpdate(b), tok, sb, null, null, runMeta(b));
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); walkoffHalf = true; }
      } else if (b.kind === 'productout') {
        say(pickPlay(b, 'atbat.productout', 'atbat.groundout'), tok, sb, null, G, CM());
        if ((b.runs ?? b.rbi) > 0) say(scoreUpdate(b), tok, sb, null, null, runMeta(b));
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); walkoffHalf = true; }
      } else if (b.kind === 'tripleplay') {
        // A triple play ends the half and is the only thing anyone in the park is going to
        // talk about.
        say(pickPlay(b, 'atbat.tripleplay', 'atbat.doubleplay'), tok, sb, tpGraphic(b), G, CM(playMeta(b, 'tripleplay', { for: b.fieldingName, against: b.battingName })));
      } else if (b.kind === 'doubleplay') {
        say(pickPlay(b, 'atbat.doubleplay'), tok, sb, dpGraphic(b), G, CM(playMeta(b, 'doubleplay', { for: b.fieldingName, against: b.battingName })));
        // A double play can drive in a run (man on third, nobody out). The scoreboard
        // has to say so — the DP line itself never mentions it. (Sim v2 credits no RBI for
        // it, so it's the run that counts here.)
        if ((b.runs ?? b.rbi) > 0) say(scoreUpdate(b), tok, sb);
      } else if (b.kind === 'error') {
        // Sim v2: an error is always called; it goes up on the board as an E.
        say(pickPlay(b, `atbat.error.${b.errorType}`, 'atbat.error'), tok, sb, null, G, CM(b.walkoff ? null : playMeta(b, 'error', { player: b.fielder || '' })));
        if (b.runs > 0) say(scoreUpdate(b), tok, sb, null, null, b.walkoff ? runMeta(b) : null);
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); walkoffHalf = true; }
      } else if ((b.kind === 'hitbypitch' || b.kind === 'walk') && b.runs != null) {
        // Sim v2's free passes: a hit batter has lines of its own, and a run forced in by
        // either is called with the score, not as a base hit.
        say(pick(`atbat.${b.kind}`, 'atbat.walk'), tok, sb, null, G, CM());
        if (b.runs > 0) say(scoreUpdate(b), tok, sb, null, null, runMeta(b));
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); walkoffHalf = true; }
      } else if (b.rbi > 0) {
        say(pickPlay(b, 'rbi'), tok, sb, null, G, CM());
        say(scoreUpdate(b), tok, sb, null, null, runMeta(b));
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); walkoffHalf = true; }
      } else if (b.out) {
        say(pickPlay(b, `atbat.${b.kind}`, 'atbat.out'), tok, sb, null, G, CM());
      } else {
        say(pickPlay(b, `atbat.${b.kind}`, 'atbat.single'), tok, sb, null, G, CM());
      }
      talkers.track(b, gd);
      // The game's over on this play: the booth says so now, not after a word from the analyst.
      if (walkoffHalf || b === lastBeat) { curExcite = 0; sayFinal(walkoffHalf ? 'final.walkoff' : 'final.out'); break; }
      // and what the play earns, never over a walk-off or the third out's changeover
      // (a home run's trot and replay is time the park takes anyway, so the booth talks over it)
      // Now and then the picture goes up to the booth after a big moment (facts.js boothCuts), and
      // the two of them on camera take the place of the after-talk.
      // The after-talk is still drawn and its seconds still spent, only not said: the talkers keep
      // state (the picks they've used, the bank), and skipping the draw moved every line after it.
      const cut = c.boothCut?.beat === b && c.desk?.('booth_cut', b, sb, c.boothCut);
      curExcite = exciteFor(b, home.name, 'after', gd?.basesBefore);
      if (!walkoffHalf && b.outs < 3) {
        const lines = talkers.after(b, gd, Math.max(0, bank, b.kind === 'homerun' ? afterLand(gd) - 8 : 0));
        bank -= cut ? lines.reduce((a, l) => a + l.secs, 0) : talk(lines, sb);
      }
      curExcite = 0;
    }

    curExcite = 0;
    // Sparse score checkpoints — end of every third full inning.
    if (!finalSaid && h.start.half === 'bottom' && h.start.inning % 3 === 0) say(pick('recap.half'), beatTok(h.end), beatBug(h.end));
  }


  // ── Extra innings: cut to the drama. Only the decisive at-bats get called — the
  // go-ahead run (top or bottom) or a walk-off — because in extras the offense is
  // cranked and you never know which side breaks it until it happens. Always a winner.
  if (extraHalves.length) {
    const narrateScore = (b, h) => {
      const tok = beatTok(b), sb = beatBug(b);
      const gd = beatGameday(b);
      // Sim v2's scoring plays that aren't hits: a play on the bases, an error, a run forced
      // in, a double play that scores.
      if (b.type === 'run') say(pick(`run.${b.kind}.score`, `run.${b.kind}`), tok, sb, null, gd);
      else if (b.kind === 'error') say(pickPlay(b, `atbat.error.${b.errorType}`, 'atbat.error'), tok, sb, null, gd);
      else if ((b.kind === 'hitbypitch' || b.kind === 'walk' || b.kind === 'doubleplay') && b.runs != null) say(pickPlay(b, `atbat.${b.kind}`, 'atbat.walk'), tok, sb, null, gd);
      else if (b.kind === 'homerun') { const key = b.rbi >= 4 ? 'hr.grand' : (b.rbi === 1 ? 'hr.solo' : 'hr'); say(pickPlay(b, key, 'hr'), tok, sb, hrGraphic(b), gd, playMeta(b, b.walkoff ? 'walkoff' : 'homerun', { homerun: true, grand: b.rbi >= 4, runs: b.rbi })); }
      else if (b.kind === 'sacfly') say(pickPlay(b, 'atbat.sacfly'), tok, sb, null, gd);
      else if (b.kind === 'productout') say(pickPlay(b, 'atbat.productout', 'atbat.groundout'), tok, sb, null, gd);
      else say(pickPlay(b, 'rbi'), tok, sb, null, gd);
      say(scoreUpdate(b), tok, sb, null, null, b.kind === 'homerun' ? null : runMeta(b));
      if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); sayFinal('final.walkoff'); }
    };
    say(pick('extras.intro'), gameTok, beatBug(extraHalves[0].start),
      { overlayType: 'sportsfx', kind: 'extras', inningOrd: sportsOrdinal(extraHalves[0].start.inning), duration: 3.2 });
    for (const h of extraHalves) {
      // A top half always starts tied (the sim only continues on a tie); a bottom half
      // can start with the away side already ahead, so the "still knotted" framing and
      // the "still tied" hold line would be a lie. Frame the trailing home half as a
      // last-licks answer instead, and let winning.top narrate the road win — don't
      // claim it's still tied.
      const trailingHome = h.start.half === 'bottom' && h.start.awayScore !== h.start.homeScore;
      say(trailingHome
        ? pick('extras.bottom.trail', 'extras.bottom', 'extras.cut')
        : pick(`extras.${h.start.half}`, 'extras.cut'),
        beatTok(h.start), beatBug(h.start));
      const scorers = h.atbats.filter(b => (b.runs ?? b.rbi) > 0);
      if (scorers.length) for (const b of scorers) { curExcite = exciteFor(b, home.name); narrateScore(b, h); curExcite = 0; }
      else if (!trailingHome) say(pick('extras.hold'), beatTok(h.end), beatBug(h.end));
    }
    // A go-ahead run in the top that the home side couldn't answer = a road win in extras.
    if (!finalSaid && winner() === away.name) say(pick('winning.top'), finalTok, finalBug);
  }

  sayFinal();
  // How it ended, from the booth on camera: what decided it, the walk-off or the extras, who won it.
  // A final has the champions instead, where the booth says how they won it over the celebration.
  if (ws && winName) champions();
  else c.desk?.('booth_end', 'end', finalBug);
  c.desk?.('close', 'end', finalBug);
  const outroId = c.lastId();
  say(pick(...(ws ? ['worldseries.outro', 'outro'] : ['outro'])), finalTok, finalBug);

  // The league table rides the game's first Gameday payload only: the view keeps it
  // for the game, and a late tuner gets it with the catch-up (sendCatchUp). That one
  // payload also carries the leaders, the venue's stamp and the season: its number,
  // regular season or final, and in a final the final's name, each side's seed and both line-ups
  // (the public address reads them before the first pitch). The last payload carries the game's
  // end: who won, and in a final that they're champions and the game's most valuable player.
  {
    const s = seasonState;
    const seedOf = (team) => (team === s.finalistA ? 1 : team === s.finalistB ? 2 : null);
    // the venue's stamp: a client without that revision asks for it once (tv_venue)
    const venueRev = venueStamp || '';
    // and the clubs' stamp, on every payload as hockey's are (a dozen characters): a client
    // without that revision asks once (tv_clubs) and dresses the clubs that have identities
    const clubsRev = sportMod.clubsRevOf?.(script.clubs) || '';
    const side = (t) => ({ team: t.name, pitcher: t.pitcher || '', lineup: Array.isArray(t.lineup) ? t.lineup.slice(0, 9) : [] });
    const season = { n: s.seasonNo ?? null, phase: ws ? 'final' : 'regular',
      ...(ws ? { name: sportMod.season?.finalName || 'Final', seedAway: seedOf(away.name), seedHome: seedOf(home.name), lineups: { away: side(away), home: side(home) } } : {}) };
    let first = true, lastId = null;
    const all = [];
    for (let id = startId; id; id = nodes[id].next) {
      const gd = nodes[id].gameday;
      if (!gd) continue;
      // the Cup's payload comes after the game's last: it's not a play, and the game's end isn't on it
      if (gd.phase === 'crown') { if (clubsRev) nodes[id].gameday = { ...gd, clubsRev }; continue; }
      all.push(gd); lastId = id;
      const stamp = clubsRev ? { clubsRev } : {};
      nodes[id].gameday = first ? { ...gd, standings: gdStandings, leaders: gdLeaders, season, ...(venueRev ? { venueRev } : {}), ...stamp } : { ...gd, ...stamp };
      first = false;
    }
    if (lastId != null && winName) {
      nodes[lastId].gameday = { ...nodes[lastId].gameday, end: { winner: winName, champion: !!ws, ...(ws ? { name: season.name, mvp: gameMvp(all, winName) } : {}) } };
    }
  }
  return { outroId };
}

// The trophy the Curtain Call is played for, named for the man the ballpark is.
export const CUP_NAME = 'Charles B. Hughson Memorial Cup';

// The men who lift the Cup, in turn: the night's most valuable player, the winners' pitcher, and
// their next best bat on the night (bases and runs batted in, as gameMvp counts), else the first
// of their line-up who isn't already named. Three at most, each once.
const HIT_BASES = { single: 1, double: 2, triple: 3, homerun: 4 };
export function cupStars(payloads, winner, team, mvp) {
  const by = new Map();
  for (const p of payloads || []) {
    if (p.phase || !p.batter || p.battingTeam !== winner) continue;
    by.set(p.batter, (by.get(p.batter) || 0) + (HIT_BASES[p.kind] || 0) + 1.5 * (p.rbi | 0));
  }
  const out = [];
  const add = (n) => { if (n && !out.includes(n) && out.length < 3) out.push(n); };
  add(mvp?.name);
  add(team?.pitcher);
  [...by.entries()].sort((a, b) => b[1] - a[1]).forEach(([n]) => add(n));
  for (const x of Array.isArray(team?.lineup) ? team.lineup : []) add(typeof x === 'string' ? x : x?.name);
  return out;
}

// gameMvp's line ('2-4, HR, 3 RBI') as the booth says it: "2 for 4, a home run, 3 runs batted in".
export function mvpSaid(line) {
  return String(line || '').split(/,\s*/).filter(Boolean).map((s) => {
    let m = /^(\d+)-(\d+)$/.exec(s);
    if (m) return `${m[1]} for ${m[2]}`;
    if (s === 'HR') return 'a home run';
    m = /^(\d+) HR$/.exec(s);
    if (m) return `${m[1]} home runs`;
    m = /^(\d+) RBI$/.exec(s);
    if (m) return m[1] === '1' ? '1 run batted in' : `${m[1]} runs batted in`;
    return s;
  }).join(', ') || 'a big night';
}
